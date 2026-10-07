/* 服务端接口测试（含账号系统）：
   先起服务：node server.mjs --port 4188 --data-dir tests/.tmp-data --legacy tests/.tmp-legacy.json
   再运行：  node tests/server.test.cjs
   可用 TEST_BASE / TEST_DATA_DIR / TEST_LEGACY 覆盖。 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:4188';
const DATA_DIR = process.env.TEST_DATA_DIR
  ? path.resolve(process.env.TEST_DATA_DIR)
  : path.join(__dirname, '.tmp-data');
const LEGACY = process.env.TEST_LEGACY
  ? path.resolve(process.env.TEST_LEGACY)
  : path.join(__dirname, '.tmp-legacy.json');

let passed = 0;
const failures = [];

function record(name, ok, extra) {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failures.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

async function test(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    record(name, false, err && err.message);
  }
}

async function api(route, options) {
  const opt = options || {};
  const headers = { 'Content-Type': 'application/json' };
  if (opt.cookie) headers.Cookie = opt.cookie;
  const res = await fetch(BASE + route, {
    method: opt.method || 'GET',
    headers: headers,
    body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
    redirect: 'manual'
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  const rawCookie = res.headers.get('set-cookie') || '';
  const m = /tr_session=([^;]*)/.exec(rawCookie);
  return {
    status: res.status,
    data: data,
    text: text,
    setCookie: rawCookie,
    cookie: m && m[1] ? 'tr_session=' + m[1] : null
  };
}

function userDataFile(id) { return path.join(DATA_DIR, id + '.json'); }

/* 起跑前清掉上一轮的临时账号与数据 */
function cleanTmp() {
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (/\.json(\.bak|\.tmp)?$/.test(f)) fs.unlinkSync(path.join(DATA_DIR, f));
    }
  } catch (e) { /* 目录还不存在 */ }
  try { fs.unlinkSync(LEGACY + '.bak'); } catch (e) { /* ignore */ }
  /* 预置一份「旧版单用户数据」，用来验证第一个账号会自动接管 */
  fs.writeFileSync(LEGACY, JSON.stringify({
    version: 1,
    settings: { items: ['力量训练'], theme: 'light' },
    records: [
      { id: 'legacy-1', date: '2026-10-01', items: ['力量训练'], minutes: 30, content: '旧数据 A' },
      { id: 'legacy-2', date: '2026-10-02', items: ['有氧・跑步'], minutes: 20, content: '旧数据 B' }
    ]
  }, null, 2), 'utf8');
}

(async function main() {
  console.log('\nserver.mjs 接口 / 账号测试（' + BASE + '）\n');
  cleanTmp();

  let alice = null;      // { id, name, cookie }
  let bob = null;

  /* ---------------- 静态资源与安全 ---------------- */
  await test('GET / 返回首页 HTML', async () => {
    const res = await fetch(BASE + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.ok(html.includes('体術修煉'));
    assert.ok(html.includes('js/app.js'));
  });

  await test('静态资源可访问且 MIME 正确', async () => {
    const css = await fetch(BASE + '/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(BASE + '/js/core.js')).status, 200);
  });

  await test('路径穿越、账号文件、数据目录都不对外暴露', async () => {
    assert.equal((await fetch(BASE + '/%2e%2e%2fserver.mjs')).status, 403, '编码穿越');
    assert.equal((await fetch(BASE + '/users.json')).status, 403, 'users.json');
    assert.equal((await fetch(BASE + '/sessions.json')).status, 403, 'sessions.json');
    assert.equal((await fetch(BASE + '/data.json')).status, 403, '旧 data.json');
    assert.equal((await fetch(BASE + '/data/whatever.json')).status, 403, 'data 目录');
    assert.equal((await fetch(BASE + '/tests/.tmp-legacy.json')).status, 403, 'tests 目录');
    assert.equal((await fetch(BASE + '/nope.txt')).status, 404, '未知文件');
  });

  /* ---------------- 未登录一律 401 ---------------- */
  await test('未登录访问 /api/data 与 /api/me 都是 401', async () => {
    const data = await api('/api/data');
    assert.equal(data.status, 401);
    assert.equal(data.data.authRequired, true);
    assert.equal((await api('/api/me')).status, 401);
  });

  await test('未登录不能写入数据', async () => {
    const res = await api('/api/data', { method: 'PUT', body: { records: [] } });
    assert.equal(res.status, 401);
  });

  /* ---------------- 注册 ---------------- */
  await test('注册校验：用户名太短 / 非法字符 / 密码为空', async () => {
    assert.equal((await api('/api/register', { method: 'POST', body: { username: 'a', password: 'abcd' } })).status, 400);
    assert.equal((await api('/api/register', { method: 'POST', body: { username: 'bad/name', password: 'abcd' } })).status, 400);
    assert.equal((await api('/api/register', { method: 'POST', body: { username: 'okname', password: '' } })).status, 400, '空密码应拒绝');
    assert.equal((await api('/api/register', { method: 'POST', body: { username: 'okname' } })).status, 400, '缺少密码应拒绝');
  });

  await test('注册成功 → 拿到会话 Cookie，并自动接管旧数据', async () => {
    const res = await api('/api/register', { method: 'POST', body: { username: 'alice', password: 'alice-pwd' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    assert.equal(res.data.user.name, 'alice');
    assert.equal(res.data.adopted, 2, '第一个账号应接管 2 条旧记录');
    assert.ok(res.cookie, '应设置会话 Cookie');
    assert.match(res.setCookie, /HttpOnly/i, 'Cookie 应为 HttpOnly');
    alice = { id: res.data.user.id, name: 'alice', cookie: res.cookie };

    const data = await api('/api/data', { cookie: alice.cookie });
    assert.equal(data.data.records.length, 2);
    assert.ok(data.data.records.some((r) => r.content === '旧数据 A'));
    assert.ok(fs.existsSync(userDataFile(alice.id)), '应生成 data/<id>.json');
  });

  await test('密码只有 1 位也能注册和登录（不限制复杂度）', async () => {
    const one = await api('/api/register', { method: 'POST', body: { username: 'onepwd', password: '7' } });
    assert.equal(one.status, 200, '1 位密码应可注册');
    const login = await api('/api/login', { method: 'POST', body: { username: 'onepwd', password: '7' } });
    assert.equal(login.status, 200, '1 位密码应可登录');
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'onepwd', password: '8' } })).status, 401);
  });

  await test('重复用户名注册被拒绝（且不区分大小写）', async () => {
    assert.equal((await api('/api/register', { method: 'POST', body: { username: 'alice', password: 'abcd' } })).status, 409);
    assert.equal((await api('/api/register', { method: 'POST', body: { username: 'ALICE', password: 'abcd' } })).status, 409);
  });

  await test('/api/me 返回当前账号，不泄露密码散列', async () => {
    const res = await api('/api/me', { cookie: alice.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.data.user.name, 'alice');
    assert.equal(res.data.user.salt, undefined);
    assert.equal(res.data.user.hash, undefined);
    assert.equal(res.data.records, 2);
  });

  /* ---------------- 数据读写 ---------------- */
  await test('PUT /api/data 落盘到本账号文件并可读回', async () => {
    const payload = {
      version: 1,
      settings: { items: [{ name: '力量训练', children: ['俯卧撑'] }], theme: 'dark' },
      records: [{ id: 'r1', date: '2026-10-07', items: ['力量训练'], subItems: [{ parent: '力量训练', name: '俯卧撑' }], minutes: 45 }]
    };
    const put = await api('/api/data', { method: 'PUT', body: payload, cookie: alice.cookie });
    assert.equal(put.status, 200);
    assert.equal(put.data.records, 1);

    const onDisk = JSON.parse(fs.readFileSync(userDataFile(alice.id), 'utf8'));
    assert.equal(onDisk.records.length, 1);
    assert.equal(onDisk.records[0].subItems[0].name, '俯卧撑');
    assert.ok(fs.existsSync(userDataFile(alice.id) + '.bak'), '应留一份 .bak');

    const back = await api('/api/data', { cookie: alice.cookie });
    assert.equal(back.data.records[0].id, 'r1');
  });

  await test('数据格式错误返回 400，方法不支持返回 405', async () => {
    assert.equal((await api('/api/data', { method: 'PUT', body: { foo: 1 }, cookie: alice.cookie })).status, 400);
    assert.equal((await api('/api/data', { method: 'DELETE', cookie: alice.cookie })).status, 405);
  });

  /* ---------------- 多账号隔离 ---------------- */
  await test('第二个账号注册成功，且看不到别人的记录', async () => {
    const res = await api('/api/register', { method: 'POST', body: { username: 'bob', password: 'bob-pwd' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.adopted, 0, '旧数据只给第一个账号');
    bob = { id: res.data.user.id, name: 'bob', cookie: res.cookie };
    assert.notEqual(alice.id, bob.id);

    const bobData = await api('/api/data', { cookie: bob.cookie });
    assert.equal(bobData.data.records.length, 0, 'bob 应是干净的新账号');

    await api('/api/data', {
      method: 'PUT', cookie: bob.cookie,
      body: { version: 1, settings: { items: [], theme: 'dark' }, records: [{ id: 'b1', date: '2026-10-08', items: [], minutes: 10, content: 'bob 的记录' }] }
    });

    const aliceAgain = await api('/api/data', { cookie: alice.cookie });
    assert.equal(aliceAgain.data.records.length, 1);
    assert.equal(aliceAgain.data.records[0].id, 'r1');
    assert.ok(!JSON.stringify(aliceAgain.data).includes('bob 的记录'), 'alice 不应看到 bob 的数据');

    const bobAgain = await api('/api/data', { cookie: bob.cookie });
    assert.equal(bobAgain.data.records[0].id, 'b1');
  });

  await test('伪造的会话 Cookie 无效', async () => {
    const res = await api('/api/data', { cookie: 'tr_session=' + 'f'.repeat(64) });
    assert.equal(res.status, 401);
  });

  /* ---------------- 登录 / 限流 / 改密码 / 登出 ---------------- */
  await test('密码错误 → 401，连续失败会被限流到 429', async () => {
    const wrong = await api('/api/login', { method: 'POST', body: { username: 'alice', password: 'nope' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.error, '用户名或密码不对');

    for (let i = 0; i < 5; i++) {
      await api('/api/login', { method: 'POST', body: { username: 'bob', password: 'bad-' + i } });
    }
    const limited = await api('/api/login', { method: 'POST', body: { username: 'bob', password: 'bad-again' } });
    assert.equal(limited.status, 429, '连续失败应被限流');
    assert.match(limited.data.error, /尝试次数过多/);
  });

  await test('用户名不区分大小写登录，且返回新会话', async () => {
    const res = await api('/api/login', { method: 'POST', body: { username: '  ALICE  ', password: 'alice-pwd' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.user.name, 'alice');
    assert.ok(res.cookie);
    assert.notEqual(res.cookie, alice.cookie, '应发放新的会话');
    alice.cookie = res.cookie;
  });

  await test('修改密码：原密码错误 401，成功后新密码可登录、旧密码失效', async () => {
    const bad = await api('/api/password', { method: 'POST', cookie: alice.cookie, body: { oldPassword: 'wrong', newPassword: 'new-pwd' } });
    assert.equal(bad.status, 401);

    const empty = await api('/api/password', { method: 'POST', cookie: alice.cookie, body: { oldPassword: 'alice-pwd', newPassword: '' } });
    assert.equal(empty.status, 400, '空的新密码应拒绝');

    const ok = await api('/api/password', { method: 'POST', cookie: alice.cookie, body: { oldPassword: 'alice-pwd', newPassword: 'new-pwd' } });
    assert.equal(ok.status, 200);

    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'alice', password: 'alice-pwd' } })).status, 401, '旧密码应失效');
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'alice', password: 'new-pwd' } })).status, 200, '新密码应可登录');
  });

  await test('改密码也可以只填 1 位', async () => {
    const login = await api('/api/login', { method: 'POST', body: { username: 'alice', password: 'new-pwd' } });
    assert.equal(login.status, 200);
    const change = await api('/api/password', { method: 'POST', cookie: login.cookie, body: { oldPassword: 'new-pwd', newPassword: 'x' } });
    assert.equal(change.status, 200, '1 位的新密码应接受');
    assert.equal((await api('/api/login', { method: 'POST', body: { username: 'alice', password: 'x' } })).status, 200);
    alice.cookie = login.cookie;
  });

  await test('未登录不能改密码', async () => {
    assert.equal((await api('/api/password', { method: 'POST', body: { oldPassword: 'x', newPassword: 'yyyy' } })).status, 401);
  });

  await test('登出后原会话立即失效', async () => {
    const out = await api('/api/logout', { method: 'POST', cookie: alice.cookie });
    assert.equal(out.status, 200);
    assert.match(out.setCookie, /tr_session=;/, '应清除 Cookie');
    assert.equal((await api('/api/data', { cookie: alice.cookie })).status, 401, '旧 Cookie 不应再能用');
  });

  await test('账号文件里不存明文密码', async () => {
    const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8'));
    assert.equal(users.users.length, 3);
    const raw = fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8');
    assert.ok(!raw.includes('new-pwd'), '不能出现明文密码');
    assert.ok(!raw.includes('bob-pwd'), '不能出现明文密码');
    const aliceRow = users.users.find((u) => u.name === 'alice');
    assert.ok(aliceRow.salt && aliceRow.hash, '应有 salt 与 hash');
    assert.equal(aliceRow.hash.length, 128);
  });

  await test('/api/health 报告账号数与数据目录', async () => {
    const res = await api('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.auth, true);
    assert.equal(res.data.users, 3);
    assert.equal(res.data.dataDir, DATA_DIR);
  });

  console.log('\n' + (failures.length ? '✗ ' + failures.length + ' 项失败' : '✓ 全部通过') + '（' + passed + ' 项）\n');
  process.exitCode = failures.length ? 1 : 0;
})();
