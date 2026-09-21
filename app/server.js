const express = require('express');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const path = require('path');
const sqlite3 = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

const app = express();

// ── dsh-login bridge ────────────────────────────────────────────────────────
// The chat accepts the SAME username/password as DSH: when the local bcrypt
// check fails, the credentials are verified against the dsh_login account base
// (scrypt hash format `scrypt$N$r$p$salt$hash`, base64url) and the matching
// chat account is created or re-synced on the spot. Config comes from
// $DSH_HOME/dsh-login.json, else the hub's /root/.dsh/dsh-login.json.
let dshPool = null;
let dshConfigCache;

function loadDshConfig() {
  if (dshConfigCache !== undefined) return dshConfigCache;
  const candidates = [];
  if (process.env.DSH_HOME) candidates.push(path.join(process.env.DSH_HOME, 'dsh-login.json'));
  candidates.push('/root/.dsh/dsh-login.json');
  for (const file of candidates) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg && cfg.db && cfg.db.host) {
        dshConfigCache = { file, cfg };
        return dshConfigCache;
      }
    } catch { /* try the next candidate */ }
  }
  dshConfigCache = null;
  return null;
}

function getDshPool() {
  if (dshPool) return dshPool;
  const found = loadDshConfig();
  if (!found) return null;
  const mysql = require('mysql2/promise');
  const d = found.cfg.db;
  dshPool = mysql.createPool({
    host: d.host,
    port: Number(d.port || 3306),
    user: d.user,
    password: d.password,
    database: d.database,
    connectionLimit: 2,
  });
  return dshPool;
}

function verifyDshPassword(password, encoded) {
  const parts = String(encoded).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch { return false; }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = crypto.scryptSync(String(password), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

async function verifyDshAccount(username, password) {
  const found = loadDshConfig();
  if (!found) return { ok: false };
  const pool = getDshPool();
  if (!pool) return { ok: false };
  try {
    const table = String(found.cfg.db.table || 'dsh_login').replace(/[^A-Za-z0-9_]/g, '');
    const [rows] = await pool.query('SELECT username, password_hash, status FROM `' + table + '` WHERE username = ? LIMIT 1', [username]);
    const row = rows && rows[0];
    if (!row) return { ok: false };
    if (String(row.status) !== 'approved') return { ok: false, status: String(row.status) };
    if (!verifyDshPassword(password, row.password_hash)) return { ok: false };
    const admins = Array.isArray(found.cfg.adminUsers) ? found.cfg.adminUsers : [];
    const name = String(row.username);
    return { ok: true, username: name, role: admins.includes(name) ? 'admin' : 'user' };
  } catch { return { ok: false }; }
}

// ── Self-signed certificate for HTTPS (needed for getUserMedia on LAN) ──
let httpsOptions = null;
const certPath = path.join(__dirname, 'cert.pem');
const keyPath = path.join(__dirname, 'key.pem');

function generateCert() {
  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/CN=ChatApp"`,
      { stdio: 'pipe', timeout: 10000 }
    );
    return true;
  } catch { return false; }
}

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  httpsOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
} else if (generateCert()) {
  httpsOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
} else {
  console.log('⚠ OpenSSL 未安装，无法生成HTTPS证书。语音/视频通话需要HTTPS才能在局域网IP下使用。');
  console.log('   解决方案: 安装 OpenSSL 或从本地主机(localhost)访问。');
}

let wss;
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

// HTTP server + WebSocket (always)
const httpServer = http.createServer(app);
wss = new WebSocketServer({ server: httpServer });
httpServer.listen(HTTP_PORT, () => {
  console.log(`   HTTP  服务器运行在 http://localhost:${HTTP_PORT}`);
  console.log(`   局域网访问: http://192.168.1.23:${HTTP_PORT}`);
});

if (httpsOptions) {
  const httpsServer = https.createServer(httpsOptions, app);
  // Attach the SAME WebSocket server to HTTPS (ws detects the incoming request's socket)
  httpsServer.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`🔒 HTTPS 服务器运行在 https://192.168.1.23:${HTTPS_PORT}`);
    console.log(`   语音/视频通话需通过 HTTPS 地址访问`);
  });
}

// ── Database ──
const db = sqlite3(path.join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

// Users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// Migration: add role & status columns
const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
if (!userCols.includes('role'))   db.exec("ALTER TABLE users ADD COLUMN role   TEXT DEFAULT 'user'");
if (!userCols.includes('status')) db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
if (!userCols.includes('phone'))  db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL");

// Ensure first user is admin
const hasAdmin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
if (!hasAdmin) {
  const first = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (first) db.prepare("UPDATE users SET role = 'admin', status = 'active' WHERE id = ?").run(first.id);
}

// SMS verification codes table
db.exec(`
  CREATE TABLE IF NOT EXISTS sms_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    code       TEXT NOT NULL,
    used       INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);
// Clean expired codes older than 10 minutes periodically
db.prepare("DELETE FROM sms_codes WHERE used = 0 AND created_at < datetime('now', '-10 minutes')").run();

// Tokens
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Friend requests
db.exec(`
  CREATE TABLE IF NOT EXISTS friend_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id  INTEGER NOT NULL,
    to_user_id    INTEGER NOT NULL,
    status        TEXT DEFAULT 'pending',
    created_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id)   REFERENCES users(id)
  );
`);

// Friends
db.exec(`
  CREATE TABLE IF NOT EXISTS friends (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id_1   INTEGER NOT NULL,
    user_id_2   INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id_1) REFERENCES users(id),
    FOREIGN KEY (user_id_2) REFERENCES users(id)
  );
`);

// Profiles
db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    user_id     INTEGER PRIMARY KEY,
    avatar      TEXT DEFAULT '',
    full_name   TEXT DEFAULT '',
    nickname    TEXT DEFAULT '',
    birth_date  TEXT DEFAULT '',
    occupation  TEXT DEFAULT '',
    birthplace  TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Groups
db.exec(`
  CREATE TABLE IF NOT EXISTS groups_table (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    creator_id  INTEGER NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (creator_id) REFERENCES users(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS group_members (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    role      TEXT DEFAULT 'member',
    joined_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES groups_table(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(group_id, user_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS group_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id   INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    type       TEXT DEFAULT 'text',
    content    TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES groups_table(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Moments (朋友圈)
db.exec(`
  CREATE TABLE IF NOT EXISTS moments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    content    TEXT DEFAULT '',
    link_url   TEXT DEFAULT '',
    link_title TEXT DEFAULT '',
    music_url  TEXT DEFAULT '',
    video_url  TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS moment_images (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id  INTEGER NOT NULL,
    url        TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (moment_id) REFERENCES moments(id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS moment_likes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id  INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (moment_id) REFERENCES moments(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(moment_id, user_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS moment_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id  INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (moment_id) REFERENCES moments(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ── File Upload ──
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, uuidv4() + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp|mp4|webm|mov|avi|mkv)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('只允许图片和视频文件 (jpg, png, gif, mp4, webm 等)'));
  },
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));
app.use(express.json());


// ── SMS Provider ──
// 环境变量配置:
//   SMS_PROVIDER=mock|aliyun    (默认 mock, 验证码打印到控制台)
//   ALIYUN_ACCESS_KEY=xxx        (阿里云 SMS 时需配置)
//   ALIYUN_SECRET_KEY=xxx
//   SMS_SIGN_NAME=聊聊            (短信签名)
//   SMS_TEMPLATE_CODE=SMS_xxxxx  (短信模板 Code)
const SMS_PROVIDER = (process.env.SMS_PROVIDER || 'mock').toLowerCase();
const SMS_CONFIG = {
  aliyun: {
    accessKey: process.env.ALIYUN_ACCESS_KEY || '',
    secretKey: process.env.ALIYUN_SECRET_KEY || '',
    signName: process.env.SMS_SIGN_NAME || '聊聊',
    templateCode: process.env.SMS_TEMPLATE_CODE || '',
  },
};

// 生成 n 位随机验证码
function generateSMSCode(n = 6) {
  return String(Math.floor(Math.random() * Math.pow(10, n))).padStart(n, '0');
}

// 发送短信验证码，返回 { sent: boolean, provider: string }
async function sendSMS(phone, code) {
  if (SMS_PROVIDER === 'aliyun') {
    const cfg = SMS_CONFIG.aliyun;
    if (!cfg.accessKey || !cfg.secretKey || !cfg.templateCode) {
      console.error(`[SMS] 阿里云配置不完整，请设置 ALIYUN_ACCESS_KEY, ALIYUN_SECRET_KEY, SMS_TEMPLATE_CODE`);
      console.log(`\n========================================`);
      console.log(`  [SMS Fallback] 验证码: ${code}`);
      console.log(`  手机号: ${phone}`);
      console.log(`========================================\n`);
      return { sent: false, provider: 'fallback' };
    }
    try {
      // 通过 HTTP 调用阿里云短信 API
      const crypto = require('crypto');
      const params = {
        AccessKeyId: cfg.accessKey,
        Format: 'json',
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: uuidv4(),
        SignatureVersion: '1.0',
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Action: 'SendSms',
        Version: '2017-05-25',
        RegionId: 'cn-hangzhou',
        PhoneNumbers: phone,
        SignName: cfg.signName,
        TemplateCode: cfg.templateCode,
        TemplateParam: JSON.stringify({ code }),
      };
      // 计算签名
      const sortedKeys = Object.keys(params).sort();
      const canonicalized = sortedKeys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
      const stringToSign = 'GET&%2F&' + encodeURIComponent(canonicalized);
      const signature = crypto.createHmac('sha1', cfg.secretKey + '&').update(stringToSign).digest('base64');
      params.Signature = signature;
      const qs = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      const http = require('http');
      await new Promise((resolve, reject) => {
        http.get(`http://dysmsapi.aliyuncs.com/?${qs}`, (res) => {
          let body = '';
          res.on('data', d => body += d);
          res.on('end', () => {
            const r = JSON.parse(body);
            if (r.Code === 'OK') resolve();
            else reject(new Error(r.Message || 'SMS send failed'));
          });
        }).on('error', reject);
      });
      console.log(`[SMS] 验证码已发送至 ${phone}`);
      return { sent: true, provider: 'aliyun' };
    } catch (err) {
      console.error(`[SMS] 发送失败: ${err.message}`);
      console.log(`[SMS Fallback] 验证码 ${code} 可用于 ${phone}`);
      return { sent: false, provider: 'error' };
    }
  } else {
    // Mock provider: 打印到控制台
    console.log(`\n========================================`);
    console.log(`  [SMS Mock] 验证码: ${code}`);
    console.log(`  手机号: ${phone}`);
    console.log(`  请在客户端输入此验证码完成注册`);
    console.log(`========================================\n`);
    return { sent: false, provider: 'mock' };
  }
}

// 验证码有效期 (分钟)
const SMS_CODE_TTL_MINUTES = 5;
function getUserByToken(token) {
  const row = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token);
  if (!row) return null;
  return db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(row.user_id);
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: '未提供认证信息' });
  const user = getUserByToken(auth.replace('Bearer ', ''));
  if (!user || user.status !== 'active') return res.status(401).json({ error: '认证失效' });
  req.user = user;
  next();
}

function adminRequired(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });
  next();
}

// ── SMS: Send verification code ──
app.post('/api/sms/send-code', async (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: '请输入正确的11位手机号' });
  }

  // 限流: 同一手机号 60 秒内只能发一次
  const recent = db.prepare(
    "SELECT created_at FROM sms_codes WHERE phone = ? AND used = 0 AND created_at > datetime('now', '-1 minutes') ORDER BY created_at DESC LIMIT 1"
  ).get(phone);
  if (recent) {
    return res.status(429).json({ error: '验证码已发送，请60秒后再试' });
  }

  const code = generateSMSCode();
  db.prepare('INSERT INTO sms_codes (phone, code) VALUES (?, ?)').run(phone, code);

  // 发送短信（等待结果，确定是否真的发送成功）
  const result = await sendSMS(phone, code);
  const resp = { success: true };

  if (result.sent) {
    resp.message = '验证码已发送';
  } else {
    // 未实际发送（mock/配置错误/发送失败），把验证码返回给客户端
    resp.message = `验证码: ${code}（未实际发送短信，开发模式）`;
    resp.code = code;
  }
  res.json(resp);
});

// ── Register with phone + SMS code ──
app.post('/api/register', (req, res) => {
  const { phone, code, password } = req.body;
  if (!phone || !code || !password) {
    return res.status(400).json({ error: '手机号、验证码和密码不能为空' });
  }
  if (!/^1\d{10}$/.test(phone)) {
    return res.status(400).json({ error: '请输入正确的11位手机号' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: '密码至少 4 个字符' });
  }

  // 验证手机号是否已注册
  const phoneUser = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
  if (phoneUser) {
    return res.status(409).json({ error: '该手机号已注册' });
  }

  // 验证短信验证码 (5分钟内有效，未使用)
  const smsRow = db.prepare(
    "SELECT id, code FROM sms_codes WHERE phone = ? AND code = ? AND used = 0 AND created_at > datetime('now', '-5 minutes') ORDER BY created_at DESC LIMIT 1"
  ).get(phone, code);
  if (!smsRow) {
    return res.status(400).json({ error: '验证码错误或已过期' });
  }

  // 标记验证码已使用
  db.prepare('UPDATE sms_codes SET used = 1 WHERE id = ?').run(smsRow.id);

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  const isFirst = userCount.cnt === 0;

  const hash = bcrypt.hashSync(password, 10);
  const role = isFirst ? 'admin' : 'user';
  // 新注册用户直接 active (免审批)
  const status = 'active';
  // 用手机号作为用户名 (用户后续可在个人资料修改昵称)
  const username = phone;

  const info = db.prepare('INSERT INTO users (username, password, role, status, phone) VALUES (?, ?, ?, ?, ?)').run(username, hash, role, status, phone);

  if (isFirst) {
    const token = uuidv4();
    db.prepare('INSERT INTO tokens (token, user_id) VALUES (?, ?)').run(token, info.lastInsertRowid);
    return res.json({ token, username, role: 'admin', message: '您是第一个用户，已自动成为管理员' });
  }

  // 新用户直接登录 (免审批)
  const token = uuidv4();
  db.prepare('INSERT INTO tokens (token, user_id) VALUES (?, ?)').run(token, info.lastInsertRowid);
  res.json({ token, username, role, message: '注册成功' });
});

// ── Login (支持手机号或用户名) ──
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '手机号/用户名和密码不能为空' });

  // 支持手机号或用户名登录
  let user = db.prepare('SELECT * FROM users WHERE username = ? OR phone = ?').get(username, username);
  let authed = Boolean(user) && bcrypt.compareSync(password, user.password);

  // Fallback: the DSH account base. A dsh user signs in with the same
  // username/password, and the chat row is created or its hash re-synced.
  if (!authed) {
    const dsh = await verifyDshAccount(String(username), String(password));
    if (dsh.ok) {
      if (user) {
        db.prepare('UPDATE users SET password = ?, status = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), 'active', user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      } else {
        const info = db.prepare("INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, 'active')")
          .run(dsh.username, bcrypt.hashSync(String(password), 10), dsh.role);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
      }
      authed = true;
    }
  }

  if (!authed) return res.status(401).json({ error: '手机号/用户名或密码错误' });
  if (user.status === 'pending') return res.status(403).json({ error: '账号待管理员审批', pending: true });
  if (user.status === 'rejected') return res.status(403).json({ error: '注册申请已被拒绝' });

  const token = uuidv4();
  db.prepare('INSERT INTO tokens (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.json({ token, username: user.username, role: user.role });
});

// ── Admin Routes ──
app.get('/api/admin/pending', authRequired, adminRequired, (req, res) => {
  const users = db.prepare("SELECT id, username, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC").all();
  res.json({ users });
});

app.post('/api/admin/approve', authRequired, adminRequired, (req, res) => {
  const { userId } = req.body;
  const user = db.prepare('SELECT id, username FROM users WHERE id = ? AND status = ?').get(userId, 'pending');
  if (!user) return res.status(404).json({ error: '用户不存在或已处理' });
  db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(userId);
  notifyUser(userId, { type: 'account_approved', message: '您的账号已被管理员批准，请刷新页面登录' });
  res.json({ success: true });
});

app.post('/api/admin/reject', authRequired, adminRequired, (req, res) => {
  const { userId } = req.body;
  const user = db.prepare('SELECT id, username FROM users WHERE id = ? AND status = ?').get(userId, 'pending');
  if (!user) return res.status(404).json({ error: '用户不存在或已处理' });
  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(userId);
  res.json({ success: true });
});

// Get all users (admin only)
app.get('/api/admin/users', authRequired, adminRequired, (req, res) => {
  const users = db.prepare('SELECT id, username, role, status, created_at FROM users ORDER BY created_at ASC').all();
  res.json({ users });
});

// Delete user (admin only)
app.post('/api/admin/delete-user', authRequired, adminRequired, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少用户ID' });
  if (userId == req.user.id) return res.status(400).json({ error: '不能删除自己' });

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (user.role === 'admin') return res.status(400).json({ error: '不能删除管理员' });

  // Disconnect WebSocket if online and remove immediately to prevent race
  connections.forEach((u, ws) => {
    if (u.userId == userId) {
      ws.send(JSON.stringify({ type: 'system', text: '您的账号已被管理员删除' }));
      connections.delete(ws);
      ws.close();
    }
  });

  // Clean up all related data
  db.prepare('DELETE FROM tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM friend_requests WHERE from_user_id = ? OR to_user_id = ?').run(userId, userId);
  db.prepare('DELETE FROM friends WHERE user_id_1 = ? OR user_id_2 = ?').run(userId, userId);
  db.prepare('DELETE FROM group_members WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM profiles WHERE user_id = ?').run(userId);
  // Delete user's moment data
  const myMoments = db.prepare('SELECT id FROM moments WHERE user_id = ?').all(userId);
  const momentIds = myMoments.map(m => m.id);
  if (momentIds.length > 0) {
    const ph = momentIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM moment_images WHERE moment_id IN (${ph})`).run(...momentIds);
    db.prepare(`DELETE FROM moment_likes WHERE moment_id IN (${ph})`).run(...momentIds);
    db.prepare(`DELETE FROM moment_comments WHERE moment_id IN (${ph})`).run(...momentIds);
    db.prepare(`DELETE FROM moments WHERE id IN (${ph})`).run(...momentIds);
  }
  // Also clean likes/comments on other users' moments
  db.prepare('DELETE FROM moment_likes WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM moment_comments WHERE user_id = ?').run(userId);
  // Delete user
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);

  broadcastUserList();
  broadcast({ type: 'friends_updated' });
  res.json({ success: true, message: `用户 ${user.username} 已删除` });
});

// Admin: delete any moment
app.post('/api/admin/delete-moment', authRequired, adminRequired, (req, res) => {
  const { momentId } = req.body;
  if (!momentId) return res.status(400).json({ error: '缺少动态ID' });
  const m = db.prepare('SELECT id FROM moments WHERE id = ?').get(momentId);
  if (!m) return res.status(404).json({ error: '动态不存在' });
  db.prepare('DELETE FROM moment_images WHERE moment_id = ?').run(momentId);
  db.prepare('DELETE FROM moment_likes WHERE moment_id = ?').run(momentId);
  db.prepare('DELETE FROM moment_comments WHERE moment_id = ?').run(momentId);
  db.prepare('DELETE FROM moments WHERE id = ?').run(momentId);
  res.json({ success: true, message: '动态已删除' });
});

// Admin: delete any moment comment
app.post('/api/admin/delete-comment', authRequired, adminRequired, (req, res) => {
  const { commentId } = req.body;
  if (!commentId) return res.status(400).json({ error: '缺少评论ID' });
  const c = db.prepare('SELECT id FROM moment_comments WHERE id = ?').get(commentId);
  if (!c) return res.status(404).json({ error: '评论不存在' });
  db.prepare('DELETE FROM moment_comments WHERE id = ?').run(commentId);
  res.json({ success: true, message: '评论已删除' });
});

// Admin: delete any group message
app.post('/api/admin/delete-group-message', authRequired, adminRequired, (req, res) => {
  const { messageId } = req.body;
  if (!messageId) return res.status(400).json({ error: '缺少消息ID' });
  const msg = db.prepare('SELECT id, group_id FROM group_messages WHERE id = ?').get(messageId);
  if (!msg) return res.status(404).json({ error: '消息不存在' });
  db.prepare('DELETE FROM group_messages WHERE id = ?').run(messageId);
  // Notify group members about deletion
  notifyGroup(msg.group_id, { type: 'group_message_deleted', messageId: parseInt(messageId) });
  res.json({ success: true, message: '消息已删除' });
});

// ── Friend Routes ──
app.get('/api/friends/statuses', authRequired, (req, res) => {
  const outgoing = db.prepare(
    "SELECT to_user_id as userId FROM friend_requests WHERE from_user_id = ? AND status = 'pending'"
  ).all(req.user.id);

  const incoming = db.prepare(
    "SELECT fr.id as requestId, fr.from_user_id as userId FROM friend_requests fr WHERE fr.to_user_id = ? AND fr.status = 'pending'"
  ).all(req.user.id);

  const friendRows = db.prepare(
    'SELECT user_id_1, user_id_2 FROM friends WHERE user_id_1 = ? OR user_id_2 = ?'
  ).all(req.user.id, req.user.id);
  let friendIds = friendRows.map(r => r.user_id_1 == req.user.id ? r.user_id_2 : r.user_id_1);
  // Filter out friends that no longer exist in users table (orphaned entries)
  if (friendIds.length > 0) {
    const placeholders = friendIds.map(() => '?').join(',');
    const validIds = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...friendIds);
    const validSet = new Set(validIds.map(r => r.id));
    friendIds = friendIds.filter(id => validSet.has(id));
  }

  res.json({ friendIds, outgoingIds: outgoing.map(r => r.userId), incoming: incoming.map(r => ({ requestId: r.requestId, userId: r.userId })) });
});

app.post('/api/friends/request', authRequired, (req, res) => {
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: '缺少目标用户' });
  if (targetUserId == req.user.id) return res.status(400).json({ error: '不能添加自己为好友' });

  // Already friends?
  const f = db.prepare(
    'SELECT id FROM friends WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)'
  ).get(req.user.id, targetUserId, targetUserId, req.user.id);
  if (f) return res.json({ status: 'friends' });

  // Existing request?
  const existing = db.prepare(
    "SELECT status FROM friend_requests WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status != 'rejected'"
  ).get(req.user.id, targetUserId, targetUserId, req.user.id);
  if (existing) {
    if (existing.status === 'pending') return res.json({ status: 'pending' });
    if (existing.status === 'accepted') return res.json({ status: 'friends' });
  }

  db.prepare('INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?)').run(req.user.id, targetUserId);

  const targetName = db.prepare('SELECT username FROM users WHERE id = ?').get(targetUserId);
  notifyUser(targetUserId, {
    type: 'friend_request',
    fromUserId: req.user.id,
    fromName: req.user.username,
  });
  res.json({ status: 'sent' });
});

app.post('/api/friends/respond', authRequired, (req, res) => {
  const { requestId, accept } = req.body;
  const r = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ?').get(requestId, req.user.id);
  if (!r) return res.status(404).json({ error: '请求不存在' });
  if (r.status !== 'pending') return res.status(400).json({ error: '请求已处理' });

  if (accept) {
    db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(requestId);
    const uid1 = Math.min(r.from_user_id, r.to_user_id);
    const uid2 = Math.max(r.from_user_id, r.to_user_id);
    db.prepare('INSERT OR IGNORE INTO friends (user_id_1, user_id_2) VALUES (?, ?)').run(uid1, uid2);
    notifyUser(r.from_user_id, { type: 'friend_accepted', userId: req.user.id, name: req.user.username });
    res.json({ success: true });
  } else {
    db.prepare("UPDATE friend_requests SET status = 'rejected' WHERE id = ?").run(requestId);
    res.json({ success: true });
  }
});

// ── Change Password ──
app.post('/api/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码不能为空' });
  if (newPassword.length < 4) return res.status(400).json({ error: '新密码至少 4 个字符' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(401).json({ error: '旧密码不正确' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true, message: '密码修改成功' });
});

// ── Upload Route ──
app.post('/api/upload', authRequired, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) return res.status(400).json({ error: '文件太大，最大 10MB' });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: '请选择图片文件' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

// ── Avatar upload (separate, images only, 2MB limit) ──
const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('头像只允许图片文件'));
  },
});

// ── Profile Routes ──
app.post('/api/profile/avatar', authRequired, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '头像上传失败' });
    if (!req.file) return res.status(400).json({ error: '请选择头像图片' });
    const url = `/uploads/${req.file.filename}`;
    // Merge: preserve existing profile fields when updating avatar
    const existing = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id) || {};
    db.prepare(
      'INSERT OR REPLACE INTO profiles (user_id, avatar, full_name, nickname, birth_date, occupation, birthplace) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, url,
      existing.full_name || '',
      existing.nickname || '',
      existing.birth_date || '',
      existing.occupation || '',
      existing.birthplace || ''
    );
    // Broadcast profile update
    broadcast({ type: 'profile_updated', userId: req.user.id, avatar: url });
    res.json({ url });
  });
});

app.get('/api/profile/:userId', authRequired, (req, res) => {
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.params.userId);
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.userId);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({ userId: u.id, username: u.username, ...p });
});

app.post('/api/profile', authRequired, (req, res) => {
  const { full_name, nickname, birth_date, occupation, birthplace } = req.body;
  // Merge: preserve avatar when updating profile fields
  const existing = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id) || {};
  db.prepare(
    'INSERT OR REPLACE INTO profiles (user_id, full_name, nickname, birth_date, occupation, birthplace, avatar) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id,
    full_name || existing.full_name || '',
    nickname || existing.nickname || '',
    birth_date || existing.birth_date || '',
    occupation || existing.occupation || '',
    birthplace || existing.birthplace || '',
    existing.avatar || ''
  );
  const p = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(req.user.id);
  broadcast({ type: 'profile_updated', userId: req.user.id, ...p });
  res.json({ success: true });
});

// ── Group Routes ──

// Create group
app.post('/api/groups', authRequired, (req, res) => {
  const { name, memberIds } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '群名称不能为空' });
  if (!memberIds || !Array.isArray(memberIds)) return res.status(400).json({ error: '请选择成员' });

  // 禁止创建与已有群同名的群
  const dup = db.prepare('SELECT id FROM groups_table WHERE name = ? COLLATE NOCASE').get(name.trim());
  if (dup) return res.status(409).json({ error: `已存在同名群聊「${name.trim()}」，请换一个名称` });

  const info = db.prepare('INSERT INTO groups_table (name, creator_id) VALUES (?, ?)').run(name.trim(), req.user.id);
  const groupId = info.lastInsertRowid;

  // Add creator as admin
  db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(groupId, req.user.id, 'admin');
  // Add members
  const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)');
  memberIds.forEach(mid => addMember.run(groupId, mid));

  // Notify added members
  const msg = { type: 'group_created', groupId, name: name.trim(), creatorId: req.user.id, creatorName: req.user.username };
  memberIds.forEach(mid => notifyUser(mid, msg));

  res.json({ success: true, groupId, name: name.trim() });
});

// Get my groups
app.get('/api/groups', authRequired, (req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.creator_id, g.created_at FROM groups_table g
    INNER JOIN group_members m ON g.id = m.group_id
    WHERE m.user_id = ?
    ORDER BY g.created_at DESC
  `).all(req.user.id);
  res.json({ groups: rows });
});

// Get group messages
app.get('/api/groups/:id/messages', authRequired, (req, res) => {
  const groupId = req.params.id;
  // Check membership
  const member = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
  if (!member) return res.status(403).json({ error: '您不在该群中' });

  const msgs = db.prepare(`
    SELECT gm.*, u.username as user_name FROM group_messages gm
    LEFT JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = ? ORDER BY gm.created_at ASC LIMIT 200
  `).all(groupId);
  res.json({ messages: msgs });
});

// Get group members
app.get('/api/groups/:id/members', authRequired, (req, res) => {
  const groupId = req.params.id;
  const member = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
  if (!member) return res.status(403).json({ error: '您不在该群中' });

  const members = db.prepare(`
    SELECT u.id, u.username, m.role, m.joined_at FROM group_members m
    INNER JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ? ORDER BY m.joined_at ASC
  `).all(groupId);
  res.json({ members });
});

// Invite to group
app.post('/api/groups/:id/invite', authRequired, (req, res) => {
  const groupId = req.params.id;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少用户' });

  // Check requester is member
  const me = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
  if (!me) return res.status(403).json({ error: '您不在该群中' });

  // Check target not already member
  const existing = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
  if (existing) return res.status(400).json({ error: '该用户已在群中' });

  db.prepare('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, userId);

  const groupName = db.prepare('SELECT name FROM groups_table WHERE id = ?').get(groupId);
  notifyUser(userId, {
    type: 'group_invited', groupId, groupName: groupName.name,
    fromUserId: req.user.id, fromName: req.user.username,
  });
  notifyGroup(groupId, {
    type: 'group_member_joined', groupId, userId: req.user.id, name: req.user.username, newUserId: userId,
  });
  res.json({ success: true });
});

// Leave group
app.post('/api/groups/:id/leave', authRequired, (req, res) => {
  const groupId = req.params.id;
  const me = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, req.user.id);
  if (!me) return res.status(403).json({ error: '您不在该群中' });
  if (me.role === 'admin') return res.status(400).json({ error: '群主不能退出，请先转让群主' });

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, req.user.id);
  notifyGroup(groupId, {
    type: 'group_member_left', groupId, userId: req.user.id, name: req.user.username,
  });
  res.json({ success: true });
});

// Rename group (only creator)
app.put('/api/groups/:id', authRequired, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '群名称不能为空' });
  const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '仅群主可修改群名' });
  // 禁止改名为与已有群相同的名称
  if (name.trim() !== group.name) {
    const dup = db.prepare('SELECT id FROM groups_table WHERE name = ? COLLATE NOCASE AND id != ?').get(name.trim(), req.params.id);
    if (dup) return res.status(409).json({ error: `已存在同名群聊「${name.trim()}」，请换一个名称` });
  }
  db.prepare('UPDATE groups_table SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  notifyGroup(req.params.id, { type: 'group_renamed', groupId: parseInt(req.params.id), name: name.trim() });
  res.json({ success: true });
});

// Delete group (only creator)
app.delete('/api/groups/:id', authRequired, (req, res) => {
  const group = db.prepare('SELECT * FROM groups_table WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: '群不存在' });
  if (group.creator_id !== req.user.id) return res.status(403).json({ error: '仅群主可删除群' });
  // Notify all members
  notifyGroup(req.params.id, { type: 'group_deleted', groupId: parseInt(req.params.id), name: group.name });
  db.prepare('DELETE FROM group_messages WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM group_members WHERE group_id = ?').run(req.params.id);
  db.prepare('DELETE FROM groups_table WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Moments Routes (朋友圈) ──

// Upload moment images (max 9)
app.post('/api/moments/upload-images', authRequired, (req, res) => {
  upload.array('images', 9)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请选择图片' });
    const urls = req.files.map(f => `/uploads/${f.filename}`);
    res.json({ urls });
  });
});

// Create a moment
app.post('/api/moments', authRequired, (req, res) => {
  const { content, imageUrls, link_url, link_title, music_url, video_url } = req.body;
  if (!content && (!imageUrls || imageUrls.length === 0) && !link_url && !music_url && !video_url) {
    return res.status(400).json({ error: '内容不能为空' });
  }
  const info = db.prepare(
    'INSERT INTO moments (user_id, content, link_url, link_title, music_url, video_url) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, content || '', link_url || '', link_title || '', music_url || '', video_url || '');
  const momentId = info.lastInsertRowid;

  if (imageUrls && imageUrls.length > 0) {
    const ins = db.prepare('INSERT INTO moment_images (moment_id, url, sort_order) VALUES (?, ?, ?)');
    imageUrls.forEach((url, i) => ins.run(momentId, url, i));
  }
  res.json({ success: true, momentId });
});

// Get friends' moments (feed)
app.get('/api/moments/friends', authRequired, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  // Get friend IDs (mutual)
  const friendRows = db.prepare(
    'SELECT user_id_1, user_id_2 FROM friends WHERE user_id_1 = ? OR user_id_2 = ?'
  ).all(req.user.id, req.user.id);
  const friendIds = friendRows.map(r => r.user_id_1 == req.user.id ? r.user_id_2 : r.user_id_1);
  friendIds.push(req.user.id); // Include own posts

  if (friendIds.length === 0) return res.json({ moments: [], page, hasMore: false });

  const placeholders = friendIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT m.*, u.username FROM moments m
    INNER JOIN users u ON m.user_id = u.id
    WHERE m.user_id IN (${placeholders})
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(...friendIds, limit + 1, offset);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  // Attach images, likes, comments
  const moments = rows.map(m => formatMoment(m, req.user.id));
  res.json({ moments, page, hasMore });
});

// Get a user's moments (only friends or self)
app.get('/api/moments/user/:userId', authRequired, (req, res) => {
  const targetId = parseInt(req.params.userId);
  if (targetId !== req.user.id) {
    const areF = areFriends(req.user.id, targetId);
    if (!areF) return res.status(403).json({ error: '仅好友可查看' });
  }
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
    SELECT m.*, u.username FROM moments m
    INNER JOIN users u ON m.user_id = u.id
    WHERE m.user_id = ? ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(targetId, limit + 1, offset);

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();

  const moments = rows.map(m => formatMoment(m, req.user.id));
  res.json({ moments, page, hasMore });
});

// Toggle like
app.post('/api/moments/:id/like', authRequired, (req, res) => {
  const momentId = req.params.id;
  const existing = db.prepare('SELECT id FROM moment_likes WHERE moment_id = ? AND user_id = ?').get(momentId, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM moment_likes WHERE id = ?').run(existing.id);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO moment_likes (moment_id, user_id) VALUES (?, ?)').run(momentId, req.user.id);
    res.json({ liked: true });
  }
});

// Add comment
app.post('/api/moments/:id/comment', authRequired, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '评论不能为空' });
  const info = db.prepare('INSERT INTO moment_comments (moment_id, user_id, content) VALUES (?, ?, ?)').run(req.params.id, req.user.id, content.trim());
  const comment = db.prepare(`
    SELECT mc.*, u.username FROM moment_comments mc
    INNER JOIN users u ON mc.user_id = u.id WHERE mc.id = ?
  `).get(info.lastInsertRowid);
  res.json({ success: true, comment });
});

// Delete own moment
app.delete('/api/moments/:id', authRequired, (req, res) => {
  const m = db.prepare('SELECT id FROM moments WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!m) return res.status(404).json({ error: '动态不存在或无权删除' });
  db.prepare('DELETE FROM moment_images WHERE moment_id = ?').run(req.params.id);
  db.prepare('DELETE FROM moment_likes WHERE moment_id = ?').run(req.params.id);
  db.prepare('DELETE FROM moment_comments WHERE moment_id = ?').run(req.params.id);
  db.prepare('DELETE FROM moments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Delete own comment
app.delete('/api/moments/:id/comment/:commentId', authRequired, (req, res) => {
  const c = db.prepare('SELECT id FROM moment_comments WHERE id = ? AND user_id = ?').get(req.params.commentId, req.user.id);
  if (!c) return res.status(404).json({ error: '评论不存在或无权删除' });
  db.prepare('DELETE FROM moment_comments WHERE id = ?').run(req.params.commentId);
  res.json({ success: true });
});

// Helper: format a moment with images, likes, comments
function formatMoment(row, currentUserId) {
  const images = db.prepare('SELECT url FROM moment_images WHERE moment_id = ? ORDER BY sort_order ASC').all(row.id).map(r => r.url);
  const likes = db.prepare(`
    SELECT ml.user_id, u.username FROM moment_likes ml
    INNER JOIN users u ON ml.user_id = u.id WHERE ml.moment_id = ? ORDER BY ml.created_at ASC
  `).all(row.id);
  const comments = db.prepare(`
    SELECT mc.*, u.username FROM moment_comments mc
    INNER JOIN users u ON mc.user_id = u.id WHERE mc.moment_id = ? ORDER BY mc.created_at ASC
  `).all(row.id);
  const liked = likes.some(l => l.user_id === currentUserId);
  return {
    id: row.id, userId: row.user_id, username: row.username,
    content: row.content, link_url: row.link_url, link_title: row.link_title,
    music_url: row.music_url, video_url: row.video_url,
    created_at: row.created_at, images, likes, comments, liked,
    likeCount: likes.length, commentCount: comments.length,
  };
}

// ── Translation API (中英互译) ──
app.post('/api/translate', authRequired, async (req, res) => {
  const { text, targetLang } = req.body;
  if (!text || !targetLang) return res.status(400).json({ error: '缺少参数' });
  // Detect source language (simple heuristic)
  const isChinese = /[一-鿿]/.test(text);
  const sourceLang = isChinese ? 'zh' : 'en';
  try {
    // Use Google Translate API via fetch
    const fetch = require('http');
    const url = `http://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await new Promise((resolve, reject) => {
      fetch.get(url, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    const parsed = JSON.parse(response);
    const translated = parsed[0].map(p => p[0]).filter(Boolean).join('');
    res.json({ translated, sourceLang });
  } catch (err) {
    // Fallback: return original text on failure
    res.json({ translated: text, sourceLang });
  }
});

// ── Conference Rooms ──
const conferenceRooms = new Map();
let conferenceIdCounter = 0;

function generateRoomCode() {
  return 'conf_' + (++conferenceIdCounter) + '_' + Date.now().toString(36);
}

// ── WebSocket ──
const connections = new Map(); // ws -> { userId, username, role }

wss.on('connection', (ws) => {
  let authed = false;
  let userId = null;
  let username = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.type === 'auth') {
      const user = getUserByToken(data.token);
      if (!user || user.status !== 'active') {
        ws.send(JSON.stringify({ type: 'auth_error', error: '认证失败' }));
        return;
      }
      authed = true;
      userId = user.id;
      username = user.username;
      connections.set(ws, { userId, username, role: user.role });

      ws.send(JSON.stringify({ type: 'auth_ok', username, userId, role: user.role }));
      broadcastUserList();
      return;
    }

    if (!authed) return;

    switch (data.type) {
      // PUBLIC CHAT REMOVED — moments feed replaces it

      case 'private_message':
        if (data.text && data.text.trim() && data.targetUserId) {
          if (!areFriends(userId, data.targetUserId)) {
            ws.send(JSON.stringify({ type: 'system', text: '你们还不是好友，无法发送私密消息' }));
            return;
          }
          sendToUser(ws, { type: 'private_message', text: data.text.trim(), fromUserId: userId, fromName: username }, data.targetUserId);
        }
        break;

      case 'private_image':
        if (data.url && data.targetUserId) {
          if (!areFriends(userId, data.targetUserId)) {
            ws.send(JSON.stringify({ type: 'system', text: '你们还不是好友，无法发送私密图片' }));
            return;
          }
          sendToUser(ws, { type: 'private_image', url: data.url, fromUserId: userId, fromName: username }, data.targetUserId);
        }
        break;

      case 'private_video':
        if (data.url && data.targetUserId) {
          if (!areFriends(userId, data.targetUserId)) {
            ws.send(JSON.stringify({ type: 'system', text: '你们还不是好友，无法发送私密视频' }));
            return;
          }
          sendToUser(ws, { type: 'private_video', url: data.url, fromUserId: userId, fromName: username }, data.targetUserId);
        }
        break;

      case 'private_typing':
        if (data.targetUserId) {
          sendToUser(ws, { type: 'private_typing', fromUserId: userId, fromName: username, isTyping: !!data.isTyping }, data.targetUserId);
        }
        break;

      // ── Call Signaling ──
      case 'call_request':
        if (data.targetUserId && data.mode) {
          sendToUser(ws, {
            type: 'call_request', fromUserId: userId, fromName: username, mode: data.mode,
          }, data.targetUserId);
        }
        break;

      case 'call_response':
        if (data.targetUserId) {
          sendToUser(ws, {
            type: 'call_response', fromUserId: userId, accept: !!data.accept,
          }, data.targetUserId);
        }
        break;

      case 'call_offer':
      case 'call_answer':
        if (data.targetUserId && data.sdp) {
          sendToUser(ws, {
            type: data.type, sdp: data.sdp, fromUserId: userId, fromName: username,
          }, data.targetUserId);
        }
        break;

      case 'call_ice':
        if (data.targetUserId && data.candidate) {
          sendToUser(ws, {
            type: 'call_ice', candidate: data.candidate, fromUserId: userId,
          }, data.targetUserId);
        }
        break;

      case 'call_end':
        if (data.targetUserId) {
          sendToUser(ws, { type: 'call_end', fromUserId: userId }, data.targetUserId);
        }
        break;

      case 'call_toggle_video':
        if (data.targetUserId) {
          sendToUser(ws, {
            type: 'call_toggle_video', fromUserId: userId, videoEnabled: !!data.videoEnabled,
          }, data.targetUserId);
        }
        break;

      // ── Group messages ──
      case 'group_message':
        if (data.text && data.text.trim() && data.groupId) {
          if (!isGroupMember(userId, data.groupId)) {
            ws.send(JSON.stringify({ type: 'system', text: '您不在该群中' }));
            return;
          }
          db.prepare('INSERT INTO group_messages (group_id, user_id, type, content) VALUES (?, ?, ?, ?)')
            .run(data.groupId, userId, 'text', data.text.trim());
          const msgId = db.prepare('SELECT last_insert_rowid() as id').get().id;
          notifyGroup(data.groupId, {
            type: 'group_message', id: msgId, groupId: data.groupId, text: data.text.trim(),
            userId, name: username,
          });
        }
        break;

      case 'group_image':
      case 'group_video':
        if (data.url && data.groupId) {
          if (!isGroupMember(userId, data.groupId)) {
            ws.send(JSON.stringify({ type: 'system', text: '您不在该群中' }));
            return;
          }
          const msgType = data.type === 'group_image' ? 'image' : 'video';
          db.prepare('INSERT INTO group_messages (group_id, user_id, type, content) VALUES (?, ?, ?, ?)')
            .run(data.groupId, userId, msgType, data.url);
          const msgId = db.prepare('SELECT last_insert_rowid() as id').get().id;
          notifyGroup(data.groupId, {
            type: msgType === 'image' ? 'group_image' : 'group_video',
            id: msgId, groupId: data.groupId, url: data.url,
            userId, name: username,
          });
        }
        break;

      // ── Conference (会议) Signaling ──
      case 'conference_create':
        {
          const roomCode = generateRoomCode();
          const room = { code: roomCode, creatorId: userId, hostId: userId, participants: new Map() };
          room.participants.set(userId, { ws, username, streams: ['audio'] });
          conferenceRooms.set(roomCode, room);
          // Track which rooms this ws is in for cleanup
          if (!ws._conferenceRooms) ws._conferenceRooms = new Set();
          ws._conferenceRooms.add(roomCode);
          ws.send(JSON.stringify({ type: 'conference_created', roomCode }));
        }
        break;

      case 'conference_join':
        {
          const room = conferenceRooms.get(data.roomCode);
          if (!room) { ws.send(JSON.stringify({ type: 'conference_error', message: '会议不存在' })); return; }
          room.participants.set(userId, { ws, username, streams: ['audio'] });
          if (!ws._conferenceRooms) ws._conferenceRooms = new Set();
          ws._conferenceRooms.add(data.roomCode);
          // Notify all participants about the new participant
          notifyConference(data.roomCode, { type: 'conference_participant_joined', userId, username }, userId);
          // Send current participants list to the joiner
          const participantList = [];
          room.participants.forEach((p, id) => participantList.push({ userId: id, username: p.username }));
          ws.send(JSON.stringify({ type: 'conference_participants', participants: participantList, hostId: room.hostId }));
          // Also notify existing participants about the new participant (for WebRTC connections)
          notifyConferenceOthers(data.roomCode, {
            type: 'conference_new_peer', userId, username,
          }, userId);
        }
        break;

      case 'conference_leave':
        leaveConference(ws, userId, data.roomCode);
        break;

      case 'conference_invite':
        if (data.targetUserId && data.roomCode) {
          notifyUser(data.targetUserId, {
            type: 'conference_invite', roomCode: data.roomCode,
            fromUserId: userId, fromName: username,
          });
        }
        break;

      case 'conference_offer':
      case 'conference_answer':
        if (data.targetUserId && data.sdp && data.roomCode) {
          sendToUserInConference(data.roomCode, {
            type: data.type, sdp: data.sdp, fromUserId: userId, fromName: username,
          }, data.targetUserId);
        }
        break;

      case 'conference_ice':
        if (data.targetUserId && data.candidate && data.roomCode) {
          sendToUserInConference(data.roomCode, {
            type: 'conference_ice', candidate: data.candidate, fromUserId: userId,
          }, data.targetUserId);
        }
        break;

      case 'conference_screen_share':
        if (data.roomCode) {
          notifyConference(data.roomCode, {
            type: 'conference_screen_share', fromUserId: userId, enabled: !!data.enabled,
          });
        }
        break;

      case 'conference_host_transfer':
        if (data.roomCode && data.targetUserId) {
          const room = conferenceRooms.get(data.roomCode);
          if (room && room.hostId === userId) {
            room.hostId = data.targetUserId;
            notifyConference(data.roomCode, {
              type: 'conference_host_changed', hostId: data.targetUserId, fromUserId: userId,
            });
          }
        }
        break;

      case 'conference_end':
        {
          const room = conferenceRooms.get(data.roomCode);
          if (room && room.hostId === userId) {
            // Notify all participants (including the host — they'll handle it)
            notifyConference(data.roomCode, { type: 'conference_ended' });
            conferenceRooms.delete(data.roomCode);
          }
        }
        break;

      case 'conference_toggle_media':
        if (data.roomCode) {
          notifyConference(data.roomCode, {
            type: 'conference_media_toggle', fromUserId: userId, mediaType: data.mediaType, enabled: !!data.enabled,
          });
        }
        break;

      // ── Translation subtitles ──
      case 'conference_subtitle':
        if (data.roomCode && data.text) {
          notifyConference(data.roomCode, {
            type: 'conference_subtitle', fromUserId: userId, fromName: username,
            text: data.text, translated: data.translated || '',
          });
        }
        break;
    }
  });

  ws.on('close', () => {
    // Leave all conference rooms
    if (ws._conferenceRooms) {
      ws._conferenceRooms.forEach(rc => leaveConference(ws, null, rc));
    }
    connections.delete(ws);
    if (username) {
      broadcastUserList();
    }
  });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

function broadcastUserList() {
  const list = [];
  const avatars = {};
  const profiles = {};
  db.prepare('SELECT user_id, avatar, full_name, nickname FROM profiles').all().forEach(r => {
    avatars[r.user_id] = r.avatar;
    profiles[r.user_id] = { full_name: r.full_name || '', nickname: r.nickname || '' };
  });
  const validUserIds = new Set(db.prepare('SELECT id FROM users').all().map(r => r.id));
  connections.forEach((u) => {
    if (!validUserIds.has(u.userId)) return;
    const p = profiles[u.userId] || {};
    list.push({ id: u.userId, name: u.username, avatar: avatars[u.userId] || '', full_name: p.full_name, nickname: p.nickname });
  });
  broadcast({ type: 'users', users: list });
}

function dbg(...args) {
  require('fs').appendFileSync(__dirname + '/debug.log', args.join(' ') + '\n');
}

function sendToUser(senderWs, data, targetUserId) {
  dbg(`[sendToUser] targetUserId=${targetUserId}, data=${JSON.stringify(data)}`);
  const sender = connections.get(senderWs);
  dbg(`[sendToUser] sender found: ${!!sender}, connections size: ${connections.size}`);
  if (!sender) return;
  let targetWs = null;
  connections.forEach((u, ws) => {
    dbg(`[sendToUser] checking conn: userId=${u.userId}, readyState=${ws.readyState}`);
    if (u.userId == targetUserId && ws.readyState === 1) targetWs = ws;
  });
  if (!targetWs) {
    dbg(`[sendToUser] target NOT found`);
    senderWs.send(JSON.stringify({ type: 'system', text: '对方已离线或不在线' }));
    return;
  }
  dbg(`[sendToUser] target FOUND, sending`);
  targetWs.send(JSON.stringify(data));
}

function notifyUser(targetUserId, data) {
  const msg = JSON.stringify(data);
  connections.forEach((u, ws) => { if (u.userId == targetUserId && ws.readyState === 1) ws.send(msg); });
}

function areFriends(uid1, uid2) {
  const row = db.prepare(
    'SELECT id FROM friends WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)'
  ).get(uid1, uid2, uid2, uid1);
  return !!row;
}

function isGroupMember(userId, groupId) {
  const row = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId);
  return !!row;
}

function leaveConference(ws, uid, roomCode) {
  const room = conferenceRooms.get(roomCode);
  if (!room) return;
  const user_id = uid || [...room.participants].find(([id, p]) => p.ws === ws)?.[0];
  if (!user_id) return;
  room.participants.delete(user_id);
  notifyConference(roomCode, { type: 'conference_participant_left', userId: user_id });
  if (room.participants.size === 0) {
    conferenceRooms.delete(roomCode);
  } else if (room.hostId === user_id) {
    // Transfer host to next participant
    const next = room.participants.keys().next().value;
    if (next) {
      room.hostId = next;
      notifyConference(roomCode, { type: 'conference_host_changed', hostId: next });
    }
  }
}

function notifyConference(roomCode, data, excludeUserId) {
  const room = conferenceRooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(data);
  room.participants.forEach((p, id) => {
    if (id !== excludeUserId && p.ws.readyState === 1) p.ws.send(msg);
  });
}

function notifyConferenceOthers(roomCode, data, excludeUserId) {
  const room = conferenceRooms.get(roomCode);
  if (!room) return;
  const msg = JSON.stringify(data);
  room.participants.forEach((p, id) => {
    if (id !== excludeUserId && p.ws.readyState === 1) p.ws.send(msg);
  });
}

function sendToUserInConference(roomCode, data, targetUserId) {
  const room = conferenceRooms.get(roomCode);
  if (!room) return;
  const p = room.participants.get(targetUserId);
  if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(data));
}

function notifyGroup(groupId, data) {
  const msg = JSON.stringify(data);
  const memberIds = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId).map(r => r.user_id);
  connections.forEach((u, ws) => {
    if (memberIds.includes(u.userId) && ws.readyState === 1) ws.send(msg);
  });
}

// ── Start ──
// (servers already started above)
