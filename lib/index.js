/**
 * ttot-chat — DSH plugin for the T-to-T (聊聊) instant-messaging web app.
 *
 * Registers one model-facing tool, `ttot`, which:
 *  - manages the bundled chat server (start/stop/status);
 *  - manages USERS from the dsh-login account base (the MySQL dsh-login
 *    table configured by $DSH_HOME/dsh-login.json): list dsh users, create
 *    dsh users, and mirror each approved dsh user into a matching chat
 *    account (same username, dsh admins become chat admins);
 *  - operates the chat: friends, private messages over WebSocket, generic
 *    API/WS escape hatches; keeps classic phone+SMS registration for
 *    standalone (web-UI human) accounts.
 *
 * Dependency-free at the dsh side except packages resolved from this
 * package's own node_modules (mysql2, bcryptjs, uuid, better-sqlite3).
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ServerManager } from './server-manager.js'
import { ChatAPI } from './chat-api.js'
import { MiniWS } from './ws-client.js'
import { DshUsers, resolveDshDbConfig } from './dsh-users.js'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import Database from 'better-sqlite3'
import { chatButtonTransform } from './button-script.js'

export const name = 'ttot-chat'
export const inject = ['tools']

// The `ttot` row may appear twice in a booted tree (the bundle layer after a
// restart plus a user-patch row kept for the live-reload path). Both rows
// import this same module instance, so the second apply() is a no-op.
const MOUNT_KEY = '__ttotChatPluginMounted'
let activeMounts = 0

const ACTIONS = [
  'status', 'start', 'stop',
  'users', 'dsh-add', 'dsh-sync',
  'register', 'login',
  'add-friend', 'approve-friend',
  'send-message', 'read-messages',
  'ws-send', 'api',
]

const TOOL_DESCRIPTION = [
  'T-to-T (聊聊) instant-messaging app: manage the bundled chat server and operate it.',
  'User management uses the dsh-login account base: users lists all dsh-login users (with',
  '  their chat provisioning state); dsh-add creates a dsh-login user (approved, 8-128 char',
  '  password) and mirrors it into chat; dsh-sync mirrors every approved dsh-login user into',
  '  a same-username chat account (dsh admins become chat admins).',
  'Actions: status; start (spawn the server, return its URL — the Web UI is served there);',
  '  stop; users; dsh-add {username, password}; dsh-sync {username?};',
  '  register {phone, password} (standalone phone+SMS account, dev mode returns the code);',
  '  login {username, password}; add-friend {targetUsername};',
  '  approve-friend {requesterUsername}; send-message {to, text};',
  '  read-messages {from?, limit?}; ws-send {type, payload?}; api {method, path, body?}.',
  'Optional `from` selects which stored user to act as (default: admin session, else first).',
  'Typical flow: start -> dsh-sync -> add-friend (A->B) -> approve-friend (from: B, requesterUsername: A)',
  '  -> send-message (from: A, to: B, text) -> read-messages (from: B).',
].join(' ')

/**
 * UI half for the LEGACY row style (`name: 'ttot-chat'` + `config: {role: 'ui'}`).
 * The dsh-login provisioning template still emits that style until the hub
 * restarts, and a fresh process loads this module, so the role must stay
 * supported. Registers the same tap as lib/ui.js (idempotent on the marker).
 */
const LEGACY_UI_KEY = '__ttotChatUiMounted'
let legacyUiMounts = 0

function applyUiHalf(ctx) {
  if (globalThis[LEGACY_UI_KEY]) return
  const webServer = ctx && (ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null))
  if (!webServer || typeof webServer.tapIndex !== 'function') return
  globalThis[LEGACY_UI_KEY] = true
  legacyUiMounts += 1
  const disposer = webServer.tapIndex(chatButtonTransform(Number(process.env.TTOT_HTTP_PORT || 3000)))
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    fs.writeFileSync(path.join(here, '..', 'app', '.ttot-ui.json'), JSON.stringify({
      rev: 3,
      via: 'lib/index.js (legacy role ui row)',
      pid: process.pid,
      mountedAt: new Date().toISOString(),
    }, null, 2))
  } catch { /* best effort */ }
  try {
    ctx.effect(() => () => {
      legacyUiMounts -= 1
      if (legacyUiMounts > 0) return
      legacyUiMounts = 0
      delete globalThis[LEGACY_UI_KEY]
      try { disposer() } catch { /* best effort */ }
    })
  } catch { /* no effect API available: the tap lives until process end */ }
}

export function apply(ctx, config) {
  if (config && config.role === 'ui') {
    applyUiHalf(ctx)
    return
  }
  if (globalThis[MOUNT_KEY]) return
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') return
  globalThis[MOUNT_KEY] = true
  activeMounts += 1

  const here = path.dirname(fileURLToPath(import.meta.url))
  const appDir = path.resolve(here, '..', 'app')
  const httpPort = Number(process.env.TTOT_HTTP_PORT || 3000)
  const httpsPort = Number(process.env.TTOT_HTTPS_PORT || 3443)
  const manager = new ServerManager(appDir, { httpPort, httpsPort })
  const api = new ChatAPI(manager.url())

  // ── persistent state: stored chat sessions (tokens survive DSH restarts) ──
  const stateFile = path.join(appDir, '.ttot-sessions.json')
  const sessions = loadState()
  function loadState() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      if (raw && Array.isArray(raw.sessions)) {
        return raw.sessions.filter((s) => s && typeof s.username === 'string' && typeof s.token === 'string')
      }
    } catch { /* fresh state */ }
    return []
  }
  function saveState() {
    try { fs.writeFileSync(stateFile, JSON.stringify({ sessions }, null, 2)) } catch { /* best effort */ }
  }
  function upsertSession(username, token, role, source, chatPassword) {
    const existing = sessions.find((s) => s.username === username)
    if (existing) {
      existing.token = token
      if (role) existing.role = role
      if (source) existing.source = source
      if (chatPassword) existing.chatPassword = chatPassword
    } else {
      const entry = { username, token, role: role || 'user', source: source || 'phone' }
      if (chatPassword) entry.chatPassword = chatPassword
      sessions.push(entry)
    }
    saveState()
  }
  function actorOf(from) {
    if (from) {
      const s = sessions.find((x) => x.username === from)
      if (!s) throw new Error('unknown stored user ' + from + ' (known: ' + sessions.map((x) => x.username).join(', ') + ')')
      return s
    }
    if (sessions.length === 0) throw new Error('no stored sessions yet — use action:dsh-sync (or register) first')
    return sessions.find((s) => s.role === 'admin') || sessions[0]
  }

  // ── dsh-login user base (MySQL) ──
  function dshAdmins(cfg) {
    return cfg && Array.isArray(cfg.adminUsers) ? cfg.adminUsers : []
  }
  async function openDsh() {
    const found = resolveDshDbConfig()
    if (!found) {
      throw new Error('no dsh-login db config found (need a db section in $DSH_HOME/dsh-login.json)')
    }
    const dsh = new DshUsers(found.cfg)
    const health = await dsh.health()
    if (health !== 'up') {
      await dsh.close()
      throw new Error('dsh-login database not reachable: ' + health)
    }
    return { dsh, found }
  }

  // ── chat-side provisioning (direct SQLite, same file the server uses) ──
  let chatDb = null
  function chatDbOpen() {
    if (chatDb) return chatDb
    const file = path.join(appDir, 'data.db')
    if (!fs.existsSync(file)) throw new Error('chat database not found — start the server first')
    chatDb = new Database(file)
    chatDb.pragma('journal_mode = WAL')
    chatDb.pragma('busy_timeout = 4000')
    return chatDb
  }
  function provisionChatUser(username, role, knownPassword) {
    const db = chatDbOpen()
    let row = db.prepare('SELECT id, role, status FROM users WHERE username = ?').get(username)
    const existed = !!row
    let chatPassword = knownPassword
    if (!row) {
      if (!chatPassword) chatPassword = randomBytes(9).toString('base64url')
      const info = db.prepare("INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, 'active')").run(username, bcrypt.hashSync(chatPassword, 10), role)
      row = { id: Number(info.lastInsertRowid), role }
    }
    const token = uuidv4()
    db.prepare('INSERT INTO tokens (token, user_id) VALUES (?, ?)').run(token, row.id)
    return { id: row.id, role: row.role || role, existed, token, chatPassword }
  }
  function chatStatusOf(username) {
    try {
      const row = chatDbOpen().prepare('SELECT role, status FROM users WHERE username = ?').get(username)
      if (!row) return { provisioned: false }
      return { provisioned: true, role: row.role, status: row.status }
    } catch {
      return { provisioned: false, note: 'chat server not running' }
    }
  }

  // ── username -> chat user id index (from the chat admin endpoint) ──
  let userIndex = {}
  async function ensureUserIndex(actor) {
    if (actor.role !== 'admin') return userIndex
    const body = await api.listUsers(actor.token)
    const list = Array.isArray(body) ? body : (body && Array.isArray(body.users) ? body.users : [])
    const idx = {}
    for (const u of list) {
      if (u && typeof u.username === 'string') idx[u.username] = { id: u.id, role: u.role, status: u.status }
    }
    userIndex = idx
    return idx
  }
  async function refreshIndexIfAdmin() {
    const admin = sessions.find((s) => s.role === 'admin')
    if (admin) await ensureUserIndex(admin)
  }

  // ── per-user WebSocket connections with a small received-message inbox ──
  const wsConns = new Map()
  function dropConn(username) {
    const c = wsConns.get(username)
    if (!c) return
    try { c.client.close() } catch { /* ignore */ }
    wsConns.delete(username)
  }
  async function ensureConn(username) {
    const s = sessions.find((x) => x.username === username)
    if (!s) throw new Error('unknown stored user ' + username)
    let c = wsConns.get(username)
    if (c && c.client.isOpen) return c
    if (c) dropConn(username)
    if (!(await manager.probe())) await manager.ensureStarted()
    const client = new MiniWS('ws://127.0.0.1:' + httpPort)
    c = { client, inbox: [] }
    wsConns.set(username, c)
    client.on('message', (text) => {
      let msg = null
      try { msg = JSON.parse(text) } catch { msg = { raw: text } }
      c.inbox.push({ at: new Date().toISOString(), ...msg })
      if (c.inbox.length > 100) c.inbox.splice(0, c.inbox.length - 100)
    })
    client.on('close', () => { wsConns.delete(username) })
    client.on('error', () => { /* lazy reconnect on next use */ })
    await client.connect()
    client.send({ type: 'auth', token: s.token })
    const authResult = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timeout: true }), 5000)
      const onMsg = (text) => {
        let m = null
        try { m = JSON.parse(text) } catch { return }
        if (m.type === 'auth_ok' || m.type === 'auth_error') {
          clearTimeout(timer)
          client.removeListener('message', onMsg)
          resolve(m)
        }
      }
      client.on('message', onMsg)
    })
    if (authResult === undefined || authResult.timeout) {
      dropConn(username)
      throw new Error('websocket auth timed out for ' + username)
    }
    if (authResult.type === 'auth_error') {
      dropConn(username)
      throw new Error('websocket auth failed for ' + username + ': ' + (authResult.error || 'unknown'))
    }
    return c
  }

  const ok = (action, detail, data) => ({ ok: true, action, detail, data: data || {} })
  const err = (action, error) => ({ ok: false, action, detail: String((error && error.message) || error), data: {} })

  async function run(args) {
    const action = args.action
    const from = typeof args.from === 'string' && args.from !== '' ? args.from : undefined
    switch (action) {
      case 'status': {
        const running = await manager.probe()
        const data = {
          running,
          url: manager.url(),
          httpsUrl: 'https://127.0.0.1:' + httpsPort,
          pid: running ? manager.readPid() : null,
          appDir,
          logFile: manager.logfile,
          startedAt: manager.startedAt,
          smsProvider: manager.smsProvider,
          storedUsers: sessions.map((s) => ({ username: s.username, role: s.role, source: s.source })),
        }
        try {
          const found = resolveDshDbConfig()
          if (found) {
            const dsh = new DshUsers(found.cfg)
            const health = await dsh.health()
            data.dshLogin = { db: health, table: found.cfg.db.table, adminUsers: dshAdmins(found.cfg) }
            if (health === 'up') data.dshUserCount = (await dsh.listUsers()).length
            await dsh.close()
          }
        } catch { data.dshLogin = { db: 'error' } }
        try {
          const admin = sessions.find((s) => s.role === 'admin')
          if (admin && running) {
            const body = await api.listUsers(admin.token)
            const list = Array.isArray(body) ? body : (body && Array.isArray(body.users) ? body.users : [])
            data.chatUserCount = list.length
          }
        } catch { /* not running or not admin */ }
        return ok('status', running ? 'chat server running at ' + manager.url() : 'chat server not running', data)
      }
      case 'start': {
        const r = await manager.ensureStarted()
        return ok('start', 'chat server running at ' + r.url + (r.started ? '' : ' (already running)'), { url: r.url, pid: r.pid, started: r.started })
      }
      case 'stop': {
        const r = await manager.stop()
        for (const key of [...wsConns.keys()]) dropConn(key)
        return ok('stop', r.stopped ? 'chat server stopped (pid ' + r.pid + ')' : (r.reason || 'not stopped'), r)
      }
      case 'users': {
        const { dsh, found } = await openDsh()
        const all = await dsh.listUsers()
        const admins = dshAdmins(found.cfg)
        const list = all.map((u) => {
          const chat = chatStatusOf(u.username)
          const stored = sessions.find((s) => s.username === u.username)
          if (stored && stored.chatPassword) chat.password = stored.chatPassword
          return {
            username: u.username,
            status: u.status,
            dshAdmin: admins.includes(u.username),
            lastLoginAt: u.lastLoginAt,
            chat,
          }
        })
        await dsh.close()
        return ok('users', all.length + ' dsh-login users', { users: list, dshConfigSource: found.source })
      }
      case 'dsh-add': {
        if (!args.username || !args.password) throw new Error('dsh-add requires username and password')
        const { dsh, found } = await openDsh()
        let created = false
        const res = await dsh.createUser(args.username, args.password, 'approved')
        if (res.ok) created = true
        else if (res.code !== 'exists') { await dsh.close(); throw new Error('dsh user creation failed: ' + res.code) }
        await manager.ensureStarted()
        const role = dshAdmins(found.cfg).includes(args.username) ? 'admin' : 'user'
        const p = provisionChatUser(args.username, role, args.password)
        upsertSession(args.username, p.token, p.role, 'dsh', p.chatPassword)
        await refreshIndexIfAdmin()
        await dsh.close()
        return ok('dsh-add', (created ? 'created dsh user ' : 'existing dsh user ') + args.username + ' — chat ' + p.role + ' ready', { username: args.username, dshUser: created ? 'created' : 'existing', chatRole: p.role, chatUserExisted: p.existed })
      }
      case 'dsh-sync': {
        const { dsh, found } = await openDsh()
        const all = await dsh.listUsers()
        const approved = all.filter((u) => u.status === 'approved')
        const targets = args.username ? approved.filter((u) => u.username === args.username) : approved
        if (targets.length === 0) { await dsh.close(); throw new Error('no approved dsh users' + (args.username ? ' named ' + args.username : '')) }
        await manager.ensureStarted()
        const admins = dshAdmins(found.cfg)
        targets.sort((a, b) => (admins.includes(b.username) ? 1 : 0) - (admins.includes(a.username) ? 1 : 0))
        const results = []
        for (const u of targets) {
          const role = admins.includes(u.username) ? 'admin' : 'user'
          const p = provisionChatUser(u.username, role)
          upsertSession(u.username, p.token, p.role, 'dsh', p.chatPassword)
          results.push({ username: u.username, chatRole: p.role, chatUserExisted: p.existed })
        }
        await refreshIndexIfAdmin()
        await dsh.close()
        return ok('dsh-sync', 'provisioned ' + results.length + ' chat account(s) from dsh-login users', { users: results, dshConfigSource: found.source })
      }
      case 'register': {
        if (!args.phone || !args.password) throw new Error('register requires phone and password')
        const sent = await api.sendCode(args.phone)
        const code = sent && sent.code
        if (!code) throw new Error('no verification code returned (SMS provider not in mock mode? check server log)')
        const reg = await api.register(args.phone, code, args.password)
        upsertSession(reg.username, reg.token, reg.role, 'phone')
        await refreshIndexIfAdmin()
        return ok('register', 'registered ' + reg.username + ' as ' + reg.role, { username: reg.username, role: reg.role, message: (reg.message || ''), phone: args.phone })
      }
      case 'login': {
        if (!args.username || !args.password) throw new Error('login requires username and password')
        const lg = await api.login(args.username, args.password)
        const existing = sessions.find((s) => s.username === lg.username)
        upsertSession(lg.username, lg.token, lg.role, existing ? existing.source : 'phone')
        if (lg.role === 'admin') await ensureUserIndex(sessions.find((s) => s.username === lg.username))
        return ok('login', 'logged in as ' + lg.username + ' (' + lg.role + ')', { username: lg.username, role: lg.role })
      }
      case 'add-friend': {
        if (!args.targetUsername) throw new Error('add-friend requires targetUsername')
        const actor = actorOf(from)
        const idx = await ensureUserIndex(actor)
        const target = idx[args.targetUsername]
        if (!target) throw new Error('unknown chat user ' + args.targetUsername + ' (known: ' + Object.keys(idx).join(', ') + ')')
        const r = await api.addFriend(actor.token, target.id)
        return ok('add-friend', 'friend request status: ' + r.status + ' (from ' + actor.username + ' to ' + args.targetUsername + ')', r)
      }
      case 'approve-friend': {
        if (!args.requesterUsername) throw new Error('approve-friend requires requesterUsername')
        const actor = actorOf(from)
        const idx = await ensureUserIndex(actor)
        const requester = idx[args.requesterUsername]
        if (!requester) throw new Error('unknown chat user ' + args.requesterUsername)
        const st = await api.friendStatuses(actor.token)
        const inc = (st.incoming || []).find((x) => x.userId === requester.id)
        if (!inc) {
          const alreadyFriends = (st.friendIds || []).includes(requester.id)
          if (alreadyFriends) return ok('approve-friend', 'already friends with ' + args.requesterUsername, { status: 'friends' })
          throw new Error('no pending friend request from ' + args.requesterUsername)
        }
        const r = await api.respondFriend(actor.token, inc.requestId, true)
        return ok('approve-friend', 'accepted friend request from ' + args.requesterUsername, r)
      }
      case 'send-message': {
        if (!args.to || !args.text) throw new Error('send-message requires to and text')
        const actor = actorOf(from)
        const idx = await ensureUserIndex(actor)
        const target = idx[args.to]
        if (!target) throw new Error('unknown chat user ' + args.to + ' (known: ' + Object.keys(idx).join(', ') + ')')
        const conn = await ensureConn(actor.username)
        conn.client.send({ type: 'private_message', text: String(args.text), targetUserId: target.id })
        return ok('send-message', 'sent ' + args.text.length + ' chars from ' + actor.username + ' to ' + args.to, { from: actor.username, to: args.to, toUserId: target.id })
      }
      case 'read-messages': {
        const actor = actorOf(from)
        const conn = await ensureConn(actor.username)
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 20))
        const msgs = conn.inbox.slice(-limit)
        return ok('read-messages', msgs.length + ' recent message(s) for ' + actor.username, { username: actor.username, messages: msgs })
      }
      case 'ws-send': {
        if (!args.type) throw new Error('ws-send requires type')
        const actor = actorOf(from)
        const conn = await ensureConn(actor.username)
        const msg = { type: args.type, ...(args.payload && typeof args.payload === 'object' ? args.payload : {}) }
        conn.client.send(msg)
        return ok('ws-send', 'ws ' + args.type + ' sent as ' + actor.username, { sent: msg })
      }
      case 'api': {
        if (!args.method || !args.path) throw new Error('api requires method and path')
        const actor = actorOf(from)
        const r = await api.call(actor.token, String(args.method).toUpperCase(), args.path, args.body)
        return ok('api', 'HTTP ' + r.status, r.body ? { status: r.status, body: r.body } : { status: r.status })
      }
      default:
        throw new Error('unknown action ' + action + ' (valid: ' + ACTIONS.join(', ') + ')')
    }
  }

  ctx.tools.register({
    name: 'ttot',
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS, description: 'What to do. See the tool description for the typical flow.' },
        username: { type: 'string', description: 'dsh-add: new dsh user name (2-32 chars). login: existing user name or phone. dsh-sync: limit sync to one user.' },
        password: { type: 'string', description: 'dsh-add: new user password (8-128 chars). login: existing password.' },
        phone: { type: 'string', description: '11-digit mobile number (register, standalone phone accounts).' },
        targetUsername: { type: 'string', description: 'Username to add as a friend (add-friend).' },
        requesterUsername: { type: 'string', description: 'Username whose pending friend request to accept (approve-friend).' },
        to: { type: 'string', description: 'Recipient username (send-message).' },
        text: { type: 'string', description: 'Message body (send-message).' },
        from: { type: 'string', description: 'Act as this stored username (default: admin session, else first stored).' },
        type: { type: 'string', description: 'WebSocket message type (ws-send), e.g. private_message, group_message.' },
        payload: { type: 'object', description: 'Extra WebSocket fields (ws-send), e.g. { targetUserId, text }.' },
        method: { type: 'string', description: 'HTTP method (api), e.g. GET/POST/PUT/DELETE.' },
        path: { type: 'string', description: 'API path starting with / (api).' },
        body: { type: 'object', description: 'JSON body (api).' },
        limit: { type: 'integer', description: 'Max messages to return (read-messages, default 20).' },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          detail: { type: 'string' },
          data: { type: 'object' },
        },
        required: ['ok', 'action', 'detail'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.ok ? '' : 'ttot error: ') + value.detail,
      }],
    },
    async execute(args) {
      try {
        return await run(args)
      } catch (error) {
        return err(String((args && args.action) || '?'), error)
      }
    },
  })

  // Mount marker: lets an operator verify this exact process mounted the plugin.
  try {
    fs.writeFileSync(path.join(appDir, '.ttot-plugin.json'), JSON.stringify({
      mountedAt: new Date().toISOString(),
      pid: process.pid,
      appDir,
      httpPort,
      httpsPort,
    }, null, 2))
  } catch { /* best effort */ }

  // Unload cleanup (the harness already auto-unwinds the tool registration):
  // clear the mount guard and drop plugin-lifetime connections once the last
  // ttot row is gone, so a later re-mount in this process starts fresh.
  ctx.effect(() => {
    return () => {
      activeMounts -= 1
      if (activeMounts > 0) return
      activeMounts = 0
      delete globalThis[MOUNT_KEY]
      for (const key of [...wsConns.keys()]) dropConn(key)
      if (chatDb) {
        try { chatDb.close() } catch { /* best effort */ }
        chatDb = null
      }
    }
  })
}
