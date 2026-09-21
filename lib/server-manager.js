/**
 * Chat-server process manager: spawns T-to-T's `server.js` as a detached
 * child (survives the DSH process), discovers orphaned servers by port
 * probe and pidfile, and stops them by process group.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'

const PIDFILE = '.ttot.pid'
const LOGFILE = '.ttot-server.log'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class ServerManager {
  /**
   * @param {string} appDir - directory holding the app's server.js.
   * @param {{httpPort?: number, httpsPort?: number, smsProvider?: string}} opts
   */
  constructor(appDir, opts = {}) {
    this.appDir = appDir
    this.httpPort = opts.httpPort || 3000
    this.httpsPort = opts.httpsPort || 3443
    this.smsProvider = opts.smsProvider || 'mock'
    this.child = null
    this.startedAt = null
  }

  get pidfile() { return path.join(this.appDir, PIDFILE) }
  get logfile() { return path.join(this.appDir, LOGFILE) }

  /** True when any chat server answers HTTP on the configured port. */
  probe() {
    return new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: this.httpPort, path: '/', timeout: 900 }, (res) => {
        res.resume()
        resolve(true)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
  }

  async isRunning() {
    if (this.child && this.child.exitCode === null && !this.child.killed) {
      if (await this.probe()) return true
    }
    return this.probe()
  }

  /**
   * Ensure the server is running; spawns it when needed.
   * @returns {Promise<{running: true, pid?: number, started: boolean, url: string}>}
   */
  async ensureStarted() {
    if (await this.isRunning()) {
      return { running: true, started: false, pid: this.readPid(), url: this.url() }
    }
    const serverJs = path.join(this.appDir, 'server.js')
    if (!fs.existsSync(serverJs)) throw new Error('app server.js not found at ' + serverJs)
    const logFd = fs.openSync(this.logfile, 'a')
    const child = spawn(process.execPath, [serverJs], {
      cwd: this.appDir,
      env: {
        ...process.env,
        HTTP_PORT: String(this.httpPort),
        HTTPS_PORT: String(this.httpsPort),
        SMS_PROVIDER: this.smsProvider,
      },
      stdio: ['ignore', logFd, logFd],
      detached: true,
    })
    child.unref()
    this.child = child
    this.startedAt = new Date().toISOString()
    fs.writeFileSync(this.pidfile, String(child.pid))
    const deadline = Date.now() + 25000
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        const tail = this.logTail(40)
        throw new Error('chat server exited during startup (code ' + this.child.exitCode + '); log tail: ' + tail)
      }
      if (await this.probe()) return { running: true, started: true, pid: child.pid, url: this.url() }
      await sleep(300)
    }
    throw new Error('chat server did not answer on port ' + this.httpPort + ' within 25s; see ' + this.logfile)
  }

  url() { return 'http://127.0.0.1:' + this.httpPort }

  readPid() {
    if (this.child && this.child.exitCode === null) return this.child.pid
    try { return Number(fs.readFileSync(this.pidfile, 'utf8')) } catch { return null }
  }

  logTail(n) {
    try {
      const s = fs.readFileSync(this.logfile, 'utf8')
      return s.split('\n').slice(-n).join('\n')
    } catch { return '(no log)' }
  }

  /**
   * Stop the chat server (process group) if it is running.
   * @returns {Promise<{stopped: boolean, pid?: number, reason?: string}>}
   */
  async stop() {
    const pid = this.readPid()
    if (!pid || !(await this.isRunning())) {
      this.child = null
      try { fs.unlinkSync(this.pidfile) } catch { /* none */ }
      return { stopped: false, reason: 'no running server found' }
    }
    const signal = (sig) => {
      try { process.kill(-pid, sig) } catch {
        try { process.kill(pid, sig) } catch { /* already gone */ }
      }
    }
    signal('SIGTERM')
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      if (!(await this.probe())) break
      await sleep(200)
    }
    if (await this.probe()) signal('SIGKILL')
    this.child = null
    try { fs.unlinkSync(this.pidfile) } catch { /* none */ }
    return { stopped: true, pid }
  }
}
