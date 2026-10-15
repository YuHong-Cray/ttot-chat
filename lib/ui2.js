/**
 * ttot-chat UI half v2 — DSH Web-GUI entry button + same-origin chat proxy.
 *
 * Why a proxy: the button must open the chat however the DSH page is reached
 * (loopback, LAN name, SSH tunnel). The plugin therefore publishes the chat
 * server under /ttot/ (HTTP prefix) and /ttot-ws (one WebSocket upgrade route)
 * and the button links to the same origin. The proxy
 *   - strips the prefix before forwarding to 127.0.0.1:<TTOT_HTTP_PORT>,
 *   - rewrites the chat client's absolute '/api/...' calls and its
 *     WebSocket URL so they stay inside the prefix,
 *   - injects an auto-login into the chat index (the actor's chat token from
 *     app/.ttot-sessions.json) so the entry opens already signed in.
 *
 * The client script is re-read from lib/button-client.js on every index
 * render, so button tweaks (position, wording) need no module reload — the
 * loader never re-imports a row by name and module HMR is config-only.
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

export const name = 'ttot-ui2'
export const inject = ['webServer']

const UI_KEY = '__ttotChatUiMountedV3'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = path.join(HERE, 'button-client.js')
const STATE_FILE = path.join(HERE, '..', 'app', '.ttot-sessions.json')
const PREFIX = '/ttot'
const WS_PATH = '/ttot-ws'
const CHAT_HOST = '127.0.0.1'
const WS_FROM = '`${proto}//${location.host}`'
const WS_TO = '`${proto}//${location.host}' + WS_PATH + '`'

let mounts = 0

function chatPort() {
  return Number(process.env.TTOT_HTTP_PORT || 3000)
}

/**
 * The DSH tenant for a per-user instance home, e.g. /srv/dsh-users/tty3 -> 'tty3'.
 * The hub home is /root/.dsh (basename '.dsh'), which is not a tenant.
 */
function currentInstanceUser() {
  const base = String(process.env.DSH_HOME || '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || ''
  return (base && base !== '.dsh') ? base : undefined
}

/**
 * The chat session used for auto-login.
 *  - If an explicit actor is configured, that is the only user we may log in as.
 *  - Otherwise, on a per-user instance, auto-login as THAT tenant only.
 *  - Never fall back to the admin session for a tenant: that is what logged the
 *    admin (wyh) in when tty3 opened the chat. The hub (no tenant) still uses
 *    the admin session as before.
 */
function actorSession(preferred) {
  if (preferred || currentInstanceUser()) {
    const want = preferred || currentInstanceUser()
    let state
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return undefined }
    const sessions = Array.isArray(state && state.sessions) ? state.sessions : []
    return sessions.find((s) => s && s.username === want)
  }
  let state
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) } catch { return undefined }
  const sessions = Array.isArray(state && state.sessions) ? state.sessions : []
  return sessions.find((s) => s && s.role === 'admin') || sessions[0]
}

function rewriteClientJs(body) {
  return body
    .split("'/api/").join("'" + PREFIX + '/api/')
    .split('\"/api/').join('\"' + PREFIX + '/api/')
    .split('`/api/').join('`' + PREFIX + '/api/')
    .split(WS_FROM).join(WS_TO)
}

function autoLoginTag(actor, tenant) {
  const esc = (s) => String(s).split('<').join('\\u003c')
  const data = actor && actor.token ? JSON.stringify({ token: actor.token, username: actor.username }).split('<').join('\\u003c') : 'null'
  const t = tenant ? JSON.stringify(tenant) : 'null'
  if (!data || data === 'null') {
    if (!tenant) return ''
    // Tenant with no chat session yet: clear a stale token that belongs to a
    // different user (e.g. the admin wyh), so the login page appears instead.
    return '<script id="ttot-auto-login">(function(){try{var t=' + t + ';var u=localStorage.getItem("chat_username");if(u&&u!==t){localStorage.removeItem("chat_token");localStorage.removeItem("chat_username");}}catch(e){}})()</script>'
  }
  return '<script id="ttot-auto-login">(function(){try{var d=' + data + ';var u=localStorage.getItem("chat_username");if(!localStorage.getItem("chat_token")||u!==d.username){localStorage.setItem("chat_token",d.token);localStorage.setItem("chat_username",d.username);}}catch(e){}})()</script>'
}

function injectAutoLogin(html, tag) {
  if (!tag) return html
  const head = html.indexOf('</head>')
  if (head !== -1) return html.slice(0, head) + tag + html.slice(head)
  const appJs = html.indexOf('<script src="app.js"></script>')
  if (appJs !== -1) return html.slice(0, appJs) + tag + html.slice(appJs)
  return html + tag
}

/** Raw-HTML transform for the floating entry button. */
function makeTap(cfg) {
  return (html) => {
    if (html.indexOf('__TTOT_CHAT_UI__') !== -1) return html
    let src
    try { src = fs.readFileSync(CLIENT_FILE, 'utf8') } catch { return html }
    const script = '<script id="ttot-chat-ui">' + src.split('__TTOT_CFG__').join(JSON.stringify(cfg)) + '</script>'
    const idx = html.lastIndexOf('</body>')
    return idx === -1 ? html + script : html.slice(0, idx) + script + '\n' + html.slice(idx)
  }
}

function makeHttpHandler(port, preferredActor) {
  return (req, res) => {
    let url = req.url || '/'
    if (url === PREFIX) url = '/'
    else if (url.startsWith(PREFIX + '/')) url = url.slice(PREFIX.length)
    const headers = { ...req.headers }
    delete headers['accept-encoding']
    delete headers.connection
    headers.host = CHAT_HOST + ':' + port
    const upstream = http.request({ host: CHAT_HOST, port, method: req.method, path: url, headers }, (up) => {
      const type = String(up.headers['content-type'] || '')
      const isHtml = type.includes('text/html')
      const isJs = type.includes('javascript')
      if (!isHtml && !isJs) {
        res.writeHead(up.statusCode || 502, up.headers)
        up.pipe(res)
        return
      }
      const chunks = []
      up.on('data', (chunk) => chunks.push(chunk))
      up.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8')
        if (isJs) body = rewriteClientJs(body)
        if (isHtml) body = injectAutoLogin(body, autoLoginTag(actorSession(preferredActor), currentInstanceUser()))
        const out = Buffer.from(body, 'utf8')
        const outHeaders = { ...up.headers }
        delete outHeaders['content-length']
        outHeaders['content-length'] = String(out.length)
        res.writeHead(up.statusCode || 200, outHeaders)
        res.end(out)
      })
    })
    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('ttot-chat: chat server is not running')
      } else { try { res.end() } catch { /* ignore */ } }
    })
    req.pipe(upstream)
  }
}

/** Raw TCP tunnel for the chat WebSocket: replay the handshake at '/'. */
function makeWsHandler(port) {
  return (req, socket, head) => {
    const up = net.connect(port, CHAT_HOST)
    up.on('connect', () => {
      const headers = { ...req.headers }
      headers.host = CHAT_HOST + ':' + port
      const lines = ['GET / HTTP/1.1']
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue
        lines.push(key + ': ' + (Array.isArray(value) ? value.join(', ') : String(value)))
      }
      up.write(lines.join('\r\n') + '\r\n\r\n')
      if (head && head.length > 0) up.write(head)
      socket.pipe(up)
      up.pipe(socket)
    })
    const destroy = () => { try { socket.destroy() } catch { /* ignore */ } try { up.destroy() } catch { /* ignore */ } }
    up.on('error', destroy)
    socket.on('error', destroy)
    socket.on('close', () => { try { up.destroy() } catch { /* ignore */ } })
    up.on('close', () => { try { socket.destroy() } catch { /* ignore */ } })
  }
}

export function apply(ctx, config) {
  if (globalThis[UI_KEY]) return
  const webServer = ctx && (ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null))
  if (!webServer || typeof webServer.tapIndex !== 'function') return
  globalThis[UI_KEY] = true
  mounts += 1
  const port = chatPort()
  const preferredActor = config && typeof config.webActor === 'string' ? config.webActor : undefined
  const teardown = []
  let proxied = false
  try {
    teardown.push(webServer.register({ kind: 'prefix', path: PREFIX, handler: makeHttpHandler(port, preferredActor) }))
    teardown.push(webServer.registerUpgrade({ path: WS_PATH, handler: makeWsHandler(port) }))
    proxied = true
  } catch {
    for (const dispose of teardown) { try { dispose() } catch { /* ignore */ } }
    teardown.length = 0
  }
  const cfg = proxied ? { sameOrigin: true, prefix: PREFIX + '/' } : { sameOrigin: false, port }
  teardown.push(webServer.tapIndex(makeTap(cfg)))
  try {
    fs.writeFileSync(path.join(HERE, '..', 'app', '.ttot-ui.json'), JSON.stringify({
      rev: 4,
      via: 'lib/ui2.js',
      proxied,
      actor: preferredActor || null,
      pid: process.pid,
      mountedAt: new Date().toISOString(),
    }, null, 2))
  } catch { /* best effort */ }
  try {
    ctx.effect(() => () => {
      mounts -= 1
      if (mounts > 0) return
      mounts = 0
      delete globalThis[UI_KEY]
      for (const dispose of teardown) { try { dispose() } catch { /* ignore */ } }
    })
  } catch { /* no effect API available: routes live until process end */ }
}