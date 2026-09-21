/**
 * dsh-users — read/write access to the dsh-login MySQL user table.
 *
 * The dsh-login gate (installed in the web profile) stores its users in a
 * MySQL table configured by $DSH_HOME/dsh-login.json (db section) with the
 * schema:
 *
 *   id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY
 *   username      VARCHAR(64) UNIQUE NOT NULL
 *   password_hash VARCHAR(255) NOT NULL      -- scrypt verifier
 *   status        VARCHAR(16) NOT NULL DEFAULT 'approved'
 *   created_at    TIMESTAMP
 *   last_login_at TIMESTAMP NULL
 *
 * This module speaks the same dialect (scrypt$N$R$P$salt$hash, base64url,
 * N=16384 r=8 p=1) so a user created here also works at the DSH web login,
 * and ttot chat accounts mirror the dsh user base by username.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'

/** dsh-login's username rule (2-32 chars, CJK/ASCII/dot/underscore/dash). */
export const USERNAME_PATTERN = /^[\u4e00-\u9fff\u3400-\u4dbfA-Za-z0-9._-]{2,32}$/

/** DSH home for this process ($DSH_HOME, else ~/.dsh). */
export function dshHomeOf() {
  return process.env.DSH_HOME || path.join(os.homedir() || '/root', '.dsh')
}

/**
 * Locate a dsh-login config that carries a usable db section.
 * Instance-mode configs ($DSH_HOME per user) have no db section, so fall
 * back to the machine's hub config at /root/.dsh/dsh-login.json.
 * @returns {{cfg: object, source: string} | null}
 */
export function resolveDshDbConfig() {
  const candidates = [path.join(dshHomeOf(), 'dsh-login.json'), '/root/.dsh/dsh-login.json']
  for (const file of candidates) {
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const db = raw && raw.db
    if (db && db.host && db.database && db.table && /^[A-Za-z0-9_-]+$/.test(db.table)) {
      return { cfg: raw, source: file }
    }
  }
  return null
}

/** Hash a password exactly like dsh-login (scrypt verifier string). */
export function hashPassword(password) {
  const N = 16384
  const R = 8
  const P = 1
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N, r: R, p: P })
  return 'scrypt$' + N + '$' + R + '$' + P + '$' + salt.toString('base64url') + '$' + hash.toString('base64url')
}

/** Verify a password against a dsh-login scrypt verifier. */
export function verifyPassword(password, encoded) {
  const parts = String(encoded).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  const salt = Buffer.from(parts[4], 'base64url')
  const expected = Buffer.from(parts[5], 'base64url')
  if (salt.length !== 16 || expected.length === 0) return false
  const actual = scryptSync(password, salt, expected.length, { N, r, p })
  return timingSafeEqual(actual, expected)
}

function ts(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * One lazily-pooled connection to the dsh-login account table.
 */
export class DshUsers {
  /**
   * @param {object} cfg - the dsh-login.json document (must carry a db section).
   */
  constructor(cfg) {
    this.cfg = cfg
    this.dbCfg = cfg.db
    this.pool = undefined
    this.lastError = ''
  }

  table() {
    return '`' + this.dbCfg.table + '`'
  }

  poolInstance() {
    if (this.pool === undefined) {
      const d = this.dbCfg
      this.pool = mysql.createPool({
        host: d.host,
        port: Number(d.port) || 3306,
        user: d.user,
        password: d.password,
        database: d.database,
        waitForConnections: true,
        connectionLimit: 2,
        connectTimeout: 8000,
      })
    }
    return this.pool
  }

  /** @returns {Promise<'up' | string>} 'up' or a short failure reason. */
  async health() {
    try {
      const [rows] = await this.poolInstance().query('SELECT 1')
      this.lastError = ''
      return Array.isArray(rows) && rows.length > 0 ? 'up' : 'down'
    } catch (err) {
      this.lastError = String((err && err.message) || err)
      return 'down: ' + this.lastError
    }
  }

  /** @returns {Promise<Array<{id: number, username: string, status: string, createdAt: string|null, lastLoginAt: string|null}>>} */
  async listUsers() {
    const [rows] = await this.poolInstance().query(
      'SELECT id, username, status, created_at, last_login_at FROM ' + this.table() + ' ORDER BY id ASC',
    )
    return rows.map((r) => ({
      id: Number(r.id),
      username: r.username,
      status: r.status || 'approved',
      createdAt: ts(r.created_at),
      lastLoginAt: ts(r.last_login_at),
    }))
  }

  async userExists(username) {
    const [rows] = await this.poolInstance().query(
      'SELECT 1 FROM ' + this.table() + ' WHERE username = ? LIMIT 1',
      [username],
    )
    return Array.isArray(rows) && rows.length > 0
  }

  /**
   * Insert one account (status approved by default, like the column default).
   * @returns {Promise<{ok: true, status: string} | {ok: false, code: 'exists'}>}
   */
  async createUser(username, password, status = 'approved') {
    if (!USERNAME_PATTERN.test(String(username))) {
      throw new Error('invalid username (2-32 chars: CJK, letters, digits, dot, underscore, dash)')
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new Error('password must be 8-128 characters')
    }
    const safeStatus = ['approved', 'pending', 'rejected'].includes(status) ? status : 'approved'
    try {
      await this.poolInstance().query(
        'INSERT INTO ' + this.table() + ' (username, password_hash, status) VALUES (?, ?, ?)',
        [username, hashPassword(password), safeStatus],
      )
      return { ok: true, status: safeStatus }
    } catch (err) {
      if (err && (err.errno === 1062 || err.code === 'ER_DUP_ENTRY')) return { ok: false, code: 'exists' }
      throw err
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end().catch(() => {})
      this.pool = undefined
    }
  }
}
