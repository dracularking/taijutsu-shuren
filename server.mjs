/* ============================================================
   体術修煉 · server.mjs
   零依赖本地服务：静态文件 + 账号系统 + 按账号分文件的训练数据。
   用法：node server.mjs [--port 4173] [--host 127.0.0.1] [--data-dir ./data] [--open]
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as Auth from './auth.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function argValue(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const HOST = argValue('--host', process.env.HOST || '127.0.0.1');
const START_PORT = Number(argValue('--port', process.env.PORT || 4173));
const OPEN_BROWSER = argv.includes('--open');

const DATA_DIR = path.resolve(argValue('--data-dir', path.join(ROOT, 'data')));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
/* 旧版单用户数据：放在数据目录旁边，第一个注册的账号会自动接管它 */
const LEGACY_FILE = path.resolve(argValue('--legacy', path.join(path.dirname(DATA_DIR), 'data.json')));

const SESSION_COOKIE = 'tr_session';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_AUTH_BODY = 64 * 1024;
const limiter = Auth.createLoginLimiter();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function emptyState() {
  return {
    version: 1,
    settings: {
      items: ['基本功', '型・套路', '组手・对练', '柔韧・开胯', '核心力量', '力量训练',
        '有氧・跑步', '步法・身法', '兵器训练', '打靶・沙袋', '体能・间歇', '拉伸放松', '冥想・呼吸'],
      theme: 'dark'
    },
    records: []
  };
}

/* ------------------------- 通用读写 ------------------------- */

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`[warn] ${path.basename(file)} 读取失败：`, err.message);
    return fallback;
  }
}

async function writeJsonFile(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const json = JSON.stringify(value, null, 2);
  const tmp = file + '.tmp';
  try { await fs.copyFile(file, file + '.bak'); } catch (err) { /* 首次写入没有 bak */ }
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, file);
  return json.length;
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(body);
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error('请求体过大');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req, limit) {
  const text = await readBody(req, limit || MAX_BODY);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (err) {
    const e = new Error('JSON 解析失败：' + err.message);
    e.status = 400;
    throw e;
  }
}

/* ------------------------- 账号存储 ------------------------- */

async function readUsers() {
  const data = await readJsonFile(USERS_FILE, null);
  if (!data || !Array.isArray(data.users)) return { version: 1, users: [] };
  return data;
}

async function writeUsers(db) {
  return writeJsonFile(USERS_FILE, db);
}

function findUser(db, name) {
  const key = Auth.usernameKey(name);
  return db.users.find((u) => (u.key || Auth.usernameKey(u.name)) === key) || null;
}

function publicUser(user) {
  return { id: user.id, name: user.name, createdAt: user.createdAt };
}

function userDataFile(user) {
  return path.join(DATA_DIR, user.id + '.json');
}

/* ------------------------- 会话 ------------------------- */

async function readSessions() {
  const data = await readJsonFile(SESSIONS_FILE, null);
  if (!data || typeof data.sessions !== 'object' || !data.sessions) return { version: 1, sessions: {} };
  return data;
}

async function saveSessions(db) {
  const now = Date.now();
  Object.keys(db.sessions).forEach((sid) => {
    if (!db.sessions[sid] || db.sessions[sid].expiresAt <= now) delete db.sessions[sid];
  });
  return writeJsonFile(SESSIONS_FILE, db);
}

async function createSession(user) {
  const db = await readSessions();
  const sid = Auth.newToken(32);
  const now = Date.now();
  db.sessions[sid] = { userId: user.id, createdAt: now, expiresAt: Auth.sessionExpiry(now) };
  await saveSessions(db);
  return sid;
}

async function currentSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const db = await readSessions();
  const item = db.sessions[sid];
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    delete db.sessions[sid];
    await saveSessions(db);
    return null;
  }
  return { sid, item };
}

async function destroySession(req, res) {
  const cookies = parseCookies(req);
  const sid = cookies[SESSION_COOKIE];
  if (sid) {
    const db = await readSessions();
    if (db.sessions[sid]) {
      delete db.sessions[sid];
      await saveSessions(db);
    }
  }
  clearSessionCookie(res);
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, sid, maxAgeSec) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* 认证闸门：未登录就回 401，前端据此弹登录框 */
async function requireUser(req, res) {
  const session = await currentSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: '未登录', authRequired: true });
    return null;
  }
  const db = await readUsers();
  const user = db.users.find((u) => u.id === session.item.userId);
  if (!user) {
    sendJson(res, 401, { ok: false, error: '账号不存在或已被删除', authRequired: true });
    return null;
  }
  return user;
}

/* ------------------------- 训练数据（按账号） ------------------------- */

async function readUserData(user) {
  const file = userDataFile(user);
  const parsed = await readJsonFile(file, null);
  if (!parsed || !Array.isArray(parsed.records)) return emptyState();
  return parsed;
}

async function writeUserData(user, payload) {
  return writeJsonFile(userDataFile(user), payload);
}

/* 第一个注册的账号接管旧的单用户 data.json（只复制，不动原文件，留作备份） */
async function adoptLegacyData(user) {
  const legacy = await readJsonFile(LEGACY_FILE, null);
  if (!legacy || !Array.isArray(legacy.records) || !legacy.records.length) return 0;
  await writeUserData(user, legacy);
  console.log(`  已把旧数据 ${path.basename(LEGACY_FILE)} 的 ${legacy.records.length} 条记录并入账号「${user.name}」`);
  return legacy.records.length;
}

/* ------------------------- 静态文件 ------------------------- */

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(ROOT, rel);
  const insideRoot = target === path.join(ROOT, 'index.html') || target.startsWith(ROOT + path.sep);
  const isPrivate = /(^|[\\/])tests[\\/]/.test(target)
    || /(^|[\\/])data[\\/]/.test(target)
    || /(^|[\\/])data\.json(\.bak|\.tmp)?$/.test(target)
    || /(^|[\\/])(users|sessions)\.json(\.bak|\.tmp)?$/.test(target)
    || /\.(bak|tmp)$/.test(target)
    || rel.indexOf('..') >= 0;
  if (!insideRoot || isPrivate) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
    return;
  }
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: pathname.replace(/\/?$/, '/') + 'index.html' }).end();
      return;
    }
    const ext = path.extname(target).toLowerCase();
    const body = await fs.readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found: ' + rel);
  }
}

/* ------------------------- 路由 ------------------------- */

async function handleRegister(req, res) {
  const body = await readJsonBody(req, MAX_AUTH_BODY);
  const nameCheck = Auth.validateUsername(body.username);
  if (!nameCheck.ok) return sendJson(res, 400, { ok: false, error: nameCheck.error });
  const pwdCheck = Auth.validatePassword(body.password);
  if (!pwdCheck.ok) return sendJson(res, 400, { ok: false, error: pwdCheck.error });

  const db = await readUsers();
  if (findUser(db, nameCheck.value)) {
    return sendJson(res, 409, { ok: false, error: '这个用户名已经被注册了' });
  }
  const firstUser = db.users.length === 0;
  const { salt, hash } = await Auth.hashPassword(pwdCheck.value);
  const user = {
    id: Auth.newToken(8),
    name: nameCheck.value,
    key: Auth.usernameKey(nameCheck.value),
    salt: salt,
    hash: hash,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  await writeUsers(db);

  let adopted = 0;
  if (firstUser) adopted = await adoptLegacyData(user);

  const sid = await createSession(user);
  setSessionCookie(res, sid, Auth.SESSION_DAYS * 24 * 3600);
  return sendJson(res, 200, { ok: true, user: publicUser(user), adopted });
}

async function handleLogin(req, res) {
  const body = await readJsonBody(req, MAX_AUTH_BODY);
  const name = Auth.normalizeUsername(body.username);
  const password = String(body.password == null ? '' : body.password);
  const key = Auth.usernameKey(name);

  const wait = limiter.blocked(key);
  if (wait > 0) {
    return sendJson(res, 429, { ok: false, error: `尝试次数过多，请 ${Math.ceil(wait / 1000)} 秒后再试` });
  }
  if (!name || !password) {
    return sendJson(res, 400, { ok: false, error: '请输入用户名和密码' });
  }

  const db = await readUsers();
  const user = findUser(db, name);
  const ok = user ? await Auth.verifyPassword(password, user.salt, user.hash) : false;
  if (!ok) {
    limiter.fail(key);
    return sendJson(res, 401, { ok: false, error: '用户名或密码不对' });
  }
  limiter.reset(key);
  const sid = await createSession(user);
  setSessionCookie(res, sid, Auth.SESSION_DAYS * 24 * 3600);
  return sendJson(res, 200, { ok: true, user: publicUser(user) });
}

async function handleChangePassword(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const body = await readJsonBody(req, MAX_AUTH_BODY);
  const oldPwd = String(body.oldPassword == null ? '' : body.oldPassword);
  const newCheck = Auth.validatePassword(body.newPassword);
  if (!newCheck.ok) return sendJson(res, 400, { ok: false, error: newCheck.error });
  if (!await Auth.verifyPassword(oldPwd, user.salt, user.hash)) {
    return sendJson(res, 401, { ok: false, error: '原密码不对' });
  }
  const { salt, hash } = await Auth.hashPassword(newCheck.value);
  const db = await readUsers();
  const target = db.users.find((u) => u.id === user.id);
  if (!target) return sendJson(res, 404, { ok: false, error: '账号不存在' });
  target.salt = salt;
  target.hash = hash;
  target.updatedAt = new Date().toISOString();
  await writeUsers(db);
  return sendJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || HOST));
  const pathname = url.pathname;

  try {
    /* ---- 账号 ---- */
    if (pathname === '/api/register' && req.method === 'POST') return handleRegister(req, res);
    if (pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') {
      await destroySession(req, res);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/password' && req.method === 'POST') return handleChangePassword(req, res);
    if (pathname === '/api/me') {
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end('Method Not Allowed'); return; }
      const user = await requireUser(req, res);
      if (!user) return;
      const data = await readUserData(user);
      return sendJson(res, 200, {
        ok: true, user: publicUser(user), authRequired: true,
        records: data.records.length, dataFile: 'data/' + user.id + '.json'
      });
    }

    /* ---- 训练数据 ---- */
    if (pathname === '/api/data') {
      const user = await requireUser(req, res);
      if (!user) return;
      if (req.method === 'GET') {
        return sendJson(res, 200, await readUserData(user));
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const payload = await readJsonBody(req, MAX_BODY);
        if (!payload || typeof payload !== 'object' || !Array.isArray(payload.records)) {
          return sendJson(res, 400, { ok: false, error: '数据格式不正确：缺少 records 数组' });
        }
        const bytes = await writeUserData(user, payload);
        return sendJson(res, 200, {
          ok: true, records: payload.records.length, bytes, file: userDataFile(user)
        });
      }
      res.writeHead(405, { Allow: 'GET, PUT' }).end('Method Not Allowed');
      return;
    }

    if (pathname === '/api/health') {
      const db = await readUsers();
      return sendJson(res, 200, {
        ok: true, auth: true, users: db.users.length, root: ROOT, dataDir: DATA_DIR, pid: process.pid
      });
    }

    await serveStatic(req, res, pathname);
  } catch (err) {
    if (err && err.status) {
      sendJson(res, err.status, { ok: false, error: err.message });
      return;
    }
    console.error('[error]', err);
    sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
  }
});

/* 在服务真正监听成功之后才打开浏览器，端口顺延时也不会开错地址 */
function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    console.log('  （没能自动打开浏览器，请手动访问上面的地址）');
  }
}

function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      // 不再顺延到别的端口：等占用释放后仍然占回同一个端口
      console.log(`端口 ${port} 还没释放，${attemptsLeft} 次重试…`);
      setTimeout(() => listen(port, attemptsLeft - 1), 500);
    } else {
      console.error('启动失败：', err.message);
      if (err.code === 'EADDRINUSE') {
        console.error(`端口 ${port} 被占用且无法接管。可以改用别的端口：node server.mjs --port 4180`);
      }
      if (process.stdin.isTTY) {
        console.error('按回车键关闭窗口…');
        process.stdin.once('data', () => process.exit(1));
      } else {
        process.exit(1);
      }
    }
  });
  server.listen(port, HOST, () => {
    const url = `http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${port}/`;
    console.log('');
    console.log('  体術修煉 · 訓練記録帖');
    console.log('  ─────────────────────────────');
    console.log('  地址：' + url);
    console.log('  账号：' + USERS_FILE);
    console.log('  数据：' + DATA_DIR + path.sep + '<账号>.json');
    console.log('  停止：Ctrl + C（或直接关闭本窗口）');
    console.log('');
    if (OPEN_BROWSER) openBrowser(url);
  });
}

/* 探测端口上跑的是不是本程序的服务（返回它报告的 pid 等信息） */
async function probeOurServer(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    const info = await res.json();
    return info && info.ok && info.pid ? info : null;
  } catch (err) {
    return null;
  }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || '') });
    });
  });
}

/* 找出正在监听某端口的进程号 */
async function findPortOwners(port) {
  if (process.platform === 'win32') {
    const { out } = await run('netstat', ['-ano', '-p', 'TCP']);
    const pids = new Set();
    out.split(/\r?\n/).forEach((line) => {
      const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (m && Number(m[1]) === port) pids.add(Number(m[2]));
    });
    return Array.from(pids);
  }
  const { out } = await run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']);
  return out.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

async function processName(pid) {
  if (process.platform === 'win32') {
    const { out } = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const m = /^"([^"]+)"/.exec(out.trim());
    return m ? m[1] : '';
  }
  const { out } = await run('ps', ['-p', String(pid), '-o', 'comm=']);
  return out.trim();
}

async function killPid(pid) {
  if (process.platform === 'win32') return run('taskkill', ['/PID', String(pid), '/F']);
  return run('kill', ['-9', String(pid)]);
}

async function waitForPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeOurServer(port)) && (await findPortOwners(port)).length === 0) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/* 双击启动时：端口被占用就先结束占用者，把端口抢回来（不切换到别的端口） */
async function takeOverPort(port) {
  const ours = await probeOurServer(port);
  if (ours) {
    console.log(`  端口 ${port} 上已有本程序的服务（PID ${ours.pid}），先结束它再重新启动…`);
    await killPid(ours.pid);
    if (await waitForPortFree(port, 6000)) return true;
    console.error(`  结束旧服务后端口 ${port} 仍未释放。`);
    return false;
  }

  const owners = await findPortOwners(port);
  if (!owners.length) return true;

  for (const pid of owners) {
    const name = await processName(pid);
    if (/^node(\.exe)?$/i.test(name.trim())) {
      console.log(`  端口 ${port} 被 node 进程占用（PID ${pid}），先结束它再启动…`);
      await killPid(pid);
    } else {
      // 只结束本程序 / node，别的软件不碰，避免误杀正在用的程序
      console.error(`  端口 ${port} 被「${name || '未知程序'}」(PID ${pid}) 占用，它不是本程序，我没有动它。`);
      console.error(`  请关闭它，或改用别的端口：node server.mjs --port 4180`);
      return false;
    }
  }

  if (await waitForPortFree(port, 8000)) return true;
  console.error(`  占用者已结束，但端口 ${port} 还没释放，请稍等再双击一次。`);
  return false;
}

async function start() {
  const port = Number.isFinite(START_PORT) ? START_PORT : 4173;
  await fs.mkdir(DATA_DIR, { recursive: true });

  if (OPEN_BROWSER) {
    const cleared = await takeOverPort(port);
    if (!cleared) {
      if (process.stdin.isTTY) {
        console.error('按回车键关闭窗口…');
        process.stdin.once('data', () => process.exit(1));
      } else {
        process.exit(1);
      }
      return;
    }
  }

  listen(port, 10);
}

start();
