import fs from 'node:fs'
import { apply } from '/root/test/ttot-chat/lib/index.js'
import { DshUsers, resolveDshDbConfig } from '/root/test/ttot-chat/lib/dsh-users.js'
import mysql from 'mysql2/promise'
import Database from 'better-sqlite3'

const registered = {}
apply({ tools: { register: (def) => { registered[def.name] = def } }, effect: () => () => {} })
const ttot = registered['ttot']
if (!ttot) { console.log('NO TOOL'); process.exit(1) }

async function call(args) {
  const r = await ttot.execute(args)
  const extra = Object.keys(args).filter((k) => k !== 'action').map((k) => k + '=' + (typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])).join(' ')
  console.log('=== ' + args.action + (extra ? ' [' + extra + ']' : ''))
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.detail)
  if (r.data && Object.keys(r.data).length > 0) console.log(JSON.stringify(r.data, null, 1).slice(0, 1500))
  if (!r.ok) process.exitCode = 1
  return r
}

const state = () => JSON.parse(fs.readFileSync('/root/test/ttot-chat/app/.ttot-sessions.json', 'utf8'))
const results = []
results.push(await call({ action: 'status' }))
results.push(await call({ action: 'start' }))
results.push(await call({ action: 'dsh-sync' }))
let st = state()
const wyhPw = st.sessions.find((s) => s.username === 'wyh') && st.sessions.find((s) => s.username === 'wyh').chatPassword
console.log('state: wyh chatPassword stored = ' + !!wyhPw + ' (len ' + (wyhPw || '').length + ')')
results.push(await call({ action: 'users' }))
results.push(await call({ action: 'dsh-add', username: 'e2etester', password: 'Test12345678' }))
results.push(await call({ action: 'login', username: 'wyh', password: wyhPw }))
results.push(await call({ action: 'login', username: 'e2etester', password: 'Test12345678' }))
results.push(await call({ action: 'read-messages', from: 'wyh', limit: 3 }))
results.push(await call({ action: 'read-messages', from: 'tty', limit: 3 }))
results.push(await call({ action: 'add-friend', from: 'wyh', targetUsername: 'tty' }))
results.push(await call({ action: 'approve-friend', from: 'tty', requesterUsername: 'wyh' }))
results.push(await call({ action: 'send-message', from: 'wyh', to: 'tty', text: '你好 tty！这条消息是 wyh 通过 ttot DSH 插件发送的。' }))
results.push(await call({ action: 'send-message', from: 'tty', to: 'wyh', text: '收到！Received — chat over the DSH plugin works.' }))
await new Promise((r) => setTimeout(r, 800))
results.push(await call({ action: 'read-messages', from: 'tty', limit: 10 }))
results.push(await call({ action: 'status' }))

// ── cleanup: remove the temporary e2etester from dsh-login and chat ──
const found = resolveDshDbConfig()
const dsh = new DshUsers(found.cfg)
const pool = mysql.createPool({ host: found.cfg.db.host, port: 3306, user: found.cfg.db.user, password: found.cfg.db.password, database: found.cfg.db.database })
await pool.query('DELETE FROM `' + found.cfg.db.table + '` WHERE username = ?', ['e2etester'])
await pool.end()
const cdb = new Database('/root/test/ttot-chat/app/data.db')
const uid = cdb.prepare('SELECT id FROM users WHERE username = ?').get('e2etester')
if (uid) {
  cdb.prepare('DELETE FROM tokens WHERE user_id = ?').run(uid.id)
  cdb.prepare('DELETE FROM friends WHERE user_id_1 = ? OR user_id_2 = ?').run(uid.id, uid.id)
  cdb.prepare('DELETE FROM friend_requests WHERE from_user_id = ? OR to_user_id = ?').run(uid.id, uid.id)
  cdb.prepare('DELETE FROM users WHERE id = ?').run(uid.id)
}
cdb.close()
await dsh.close()
console.log('=== cleanup: e2etester removed from dsh-login + chat')

const fails = results.filter((r) => !r.ok).length
console.log('')
console.log(fails === 0 ? 'E2E V2 ALL OK (' + results.length + ' steps)' : 'E2E V2 FAILURES: ' + fails)