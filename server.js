/* =========================================================
 * 竞足预测汇总 - 本地服务
 * 1) 静态托管项目目录（http://0.0.0.0:8765）
 * 2) /api/update        手动/静默触发官方数据拉取（不保护，任意访问者可触发）
 * 3) /api/status        查询更新状态（前端决定是否提示刷新）
 * 4) /api/register      注册新用户（写 users/{手机号}.json + 设置 sid cookie）
 * 5) /api/login         校验密码 + 设置 sid cookie
 * 6) /api/logout        清 session + 清 cookie
 * 7) /api/me            当前登录用户（cookie sid → 手机号）
 * 8) /api/data          GET 读 / POST 写当前用户 8 个私有数据字段
 * 9) 定时自动更新：启动 8 秒后拉一次，之后每 2 小时一次
 *    （当天场次/赔率随在售页更新；完场比分随赛果大厅更新）
 * 仅用 Node 内置模块：http / fs / path / crypto / child_process
 * ======================================================= */
const http = require('http'), fs = require('fs'), path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const root = __dirname;
const NODE = process.execPath;
const FETCH = path.join(root, 'fetch_official.js');
const INTERVAL = 2 * 60 * 60 * 1000; /* 2小时 */
const START_DELAY = 8 * 1000;
const USERS_DIR = path.join(root, 'users');
const SESSIONS = new Map(); /* sid(hex32) -> phone */
const DATA_KEYS = new Set(['myFinal', 'customModels', 'preds', 'renames', 'order', 'bets', 'notes', 'tags']);
const MAX_BODY = 5 * 1024 * 1024; /* 5MB */
const SESSION_MAX_AGE = 30 * 24 * 3600; /* 30 天（秒） */

/* 启动时确保 users/ 目录存在 */
try { fs.mkdirSync(USERS_DIR, { recursive: true }); } catch (e) { /* 已存在或无权限 */ }

/* ---- 密码哈希：scrypt + 随机 16 字节 salt，哈希 64 字节 ---- */
function hashPass(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPass(password, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expect = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(password, salt, 64);
  /* 常量时间比较，防侧信道 */
  return got.length === expect.length && crypto.timingSafeEqual(got, expect);
}

/* ---- 请求体解析：JSON 上限 5MB ---- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY) { req.destroy(); return reject(new Error('body_too_large')); }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { resolve({}); /* 容错：非 JSON 当空对象 */ }
    });
    req.on('error', reject);
  });
}

/* ---- cookie 解析：req.headers.cookie 内取 sid ---- */
function getSessionPhone(req) {
  const ck = req.headers.cookie || '';
  const m = ck.match(/(?:^|;\s*)sid=([0-9a-f]{32})/i);
  if (!m) return null;
  return SESSIONS.get(m[1]) || null;
}

/* ---- 生成新的 32 位 hex sessionId + 对应 cookie 字符串 ---- */
function newSession(phone) {
  const sid = crypto.randomBytes(16).toString('hex');
  SESSIONS.set(sid, phone);
  return `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}
function clearSessionCookie() { return 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'; }

/* ---- 用户文件路径：仅允许 11 位数字手机号，防路径穿越 ---- */
function userFile(phone) {
  if (!/^\d{11}$/.test(phone)) return null;
  return path.join(USERS_DIR, phone + '.json');
}
function readUser(phone) {
  const f = userFile(phone);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
function writeUser(phone, obj) {
  const f = userFile(phone);
  if (!f) return false;
  try { fs.writeFileSync(f, JSON.stringify(obj, null, 2)); return true; } catch (e) { return false; }
}

function sendJson(s, status, obj, headers) {
  const h = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {});
  s.writeHead(status, h);
  s.end(JSON.stringify(obj));
}

const state = { updating: false, lastAt: 0, lastOk: null, lastLog: '', timer: null };

function runFetch(date) {
  return new Promise((resolve) => {
    const args = [FETCH];
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) args.push(date);
    const child = spawn(NODE, args, { cwd: root, windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function doUpdate(date, manual) {
  if (state.updating) return { skipped: true, updating: true };
  state.updating = true;
  try {
    const r = await runFetch(date);
    state.lastAt = Date.now();
    state.lastOk = r.code === 0;
    state.lastLog = (r.out + r.err).slice(-2000);
    return { ok: state.lastOk, log: state.lastLog };
  } catch (e) {
    state.lastAt = Date.now();
    state.lastOk = false;
    state.lastLog = String((e && e.message) || e);
    return { ok: false, log: state.lastLog };
  } finally {
    state.updating = false;
  }
}

/* 定时自动更新（无日期参数：拉当天在售+近两天赛果） */
setTimeout(() => { doUpdate(); state.timer = setInterval(() => doUpdate(), INTERVAL); }, START_DELAY);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const srv = http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://x');
  const p = u.pathname;

  if (p === '/api/status') {
    s.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return s.end(JSON.stringify({
      updating: state.updating,
      lastAt: state.lastAt,
      lastOk: state.lastOk,
      ageMin: state.lastAt ? Math.round((Date.now() - state.lastAt) / 60000) : null
    }));
  }

  if (p === '/api/update') {
    const date = u.searchParams.get('date') || '';
    s.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const r = await doUpdate(date);
    return s.end(JSON.stringify(r.skipped ? { ok: true, busy: true } : r));
  }

  /* ---- 注册：创建用户文件 + 设置 session cookie ---- */
  if (p === '/api/register' && q.method === 'POST') {
    const body = await readBody(q);
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    if (!/^\d{11}$/.test(phone)) return sendJson(s, 400, { ok: false, err: '手机号必须为 11 位数字' });
    if (password.length < 6 || password.length > 20) return sendJson(s, 400, { ok: false, err: '密码长度 6-20 位' });
    if (readUser(phone)) return sendJson(s, 400, { ok: false, err: '手机号已注册' });
    const { salt, hash } = hashPass(password);
    const ok = writeUser(phone, {
      phone, salt, passHash: hash, createdAt: new Date().toISOString(),
      data: { myFinal: {}, customModels: [], preds: {}, renames: {}, order: [], bets: [], notes: {}, tags: {} }
    });
    if (!ok) return sendJson(s, 500, { ok: false, err: '无法写入用户文件' });
    return sendJson(s, 200, { ok: true, phone }, { 'Set-Cookie': newSession(phone) });
  }

  /* ---- 登录：校验密码 + 设置 session cookie ---- */
  if (p === '/api/login' && q.method === 'POST') {
    const body = await readBody(q);
    const phone = String(body.phone || '').trim();
    const password = String(body.password || '');
    if (!/^\d{11}$/.test(phone) || !password) return sendJson(s, 400, { ok: false, err: '手机号或密码错误' });
    const user = readUser(phone);
    if (!user || !verifyPass(password, user.salt, user.passHash)) {
      return sendJson(s, 400, { ok: false, err: '手机号或密码错误' });
    }
    return sendJson(s, 200, { ok: true, phone }, { 'Set-Cookie': newSession(phone) });
  }

  /* ---- 退出：清 session + 清 cookie ---- */
  if (p === '/api/logout' && q.method === 'POST') {
    const ck = q.headers.cookie || '';
    const m = ck.match(/(?:^|;\s*)sid=([0-9a-f]{32})/i);
    if (m) SESSIONS.delete(m[1]);
    return sendJson(s, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
  }

  /* ---- 当前登录用户：cookie sid → 手机号 ---- */
  if (p === '/api/me' && q.method === 'GET') {
    const phone = getSessionPhone(q);
    if (phone) return sendJson(s, 200, { ok: true, phone });
    return sendJson(s, 401, { ok: false });
  }

  /* ---- 用户数据：GET 读 / POST 写单字段（需登录） ---- */
  if (p === '/api/data' && q.method === 'GET') {
    const phone = getSessionPhone(q);
    if (!phone) return sendJson(s, 401, { ok: false, err: '未登录' });
    const user = readUser(phone);
    if (!user) return sendJson(s, 404, { ok: false, err: '用户不存在' });
    return sendJson(s, 200, Object.assign({ ok: true }, user.data || {}));
  }
  if (p === '/api/data' && q.method === 'POST') {
    const phone = getSessionPhone(q);
    if (!phone) return sendJson(s, 401, { ok: false, err: '未登录' });
    const body = await readBody(q);
    const key = String(body.key || '');
    const value = body.value;
    if (!DATA_KEYS.has(key)) return sendJson(s, 400, { ok: false, err: '非法字段：' + key });
    const user = readUser(phone);
    if (!user) return sendJson(s, 404, { ok: false, err: '用户不存在' });
    user.data = user.data || {};
    user.data[key] = value;
    if (!writeUser(phone, user)) return sendJson(s, 500, { ok: false, err: '写入失败' });
    return sendJson(s, 200, { ok: true });
  }

  let fp = p === '/' ? '/index.html' : p;
  const f = path.join(root, decodeURIComponent(fp));
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); return s.end('404'); }
    s.writeHead(200, {
      'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    s.end(d);
  });
});
srv.on('error', (e) => {
  if (e.code === 'EADDRINUSE') process.exit(0); /* 已有实例在跑，静默退出 */
  throw e;
});
srv.listen(8765, '0.0.0.0', () => console.log('serving on http://0.0.0.0:8765'));
