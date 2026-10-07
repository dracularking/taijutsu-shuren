/* 账号逻辑单元测试：node tests/auth.test.cjs */
'use strict';

const assert = require('node:assert/strict');
const Auth = require('../auth.mjs');

let passed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failures.push(name);
    console.log('  ✗ ' + name + '\n      ' + err.message);
  }
}

(async function () {
  console.log('\nauth.mjs 单元测试\n');

  await test('用户名校验：长度、空格、非法字符', () => {
    assert.equal(Auth.validateUsername('').ok, false);
    assert.equal(Auth.validateUsername('a').ok, false);
    assert.equal(Auth.validateUsername('ab').ok, true);
    assert.equal(Auth.validateUsername('a'.repeat(21)).ok, false);
    assert.equal(Auth.validateUsername('有 空格').ok, false);
    assert.equal(Auth.validateUsername('张三').ok, true);
    assert.equal(Auth.validateUsername('user_01.x-y').ok, true);
    assert.equal(Auth.validateUsername('bad/name').ok, false);
    assert.equal(Auth.validateUsername('  trim me  ').ok, false, '包含内部空格应拒绝');
    assert.equal(Auth.validateUsername('  okname  ').value, 'okname', '两端空格应被去掉');
  });

  await test('用户名不区分大小写', () => {
    assert.equal(Auth.usernameKey('Alice'), Auth.usernameKey('alice'));
    assert.equal(Auth.usernameKey('  Bob '), 'bob');
  });

  await test('密码校验：只要非空即可（1 位也行，不限制字符与长度）', () => {
    assert.equal(Auth.validatePassword('').ok, false);
    assert.equal(Auth.validatePassword(null).ok, false);
    assert.equal(Auth.validatePassword(undefined).ok, false);
    assert.equal(Auth.validatePassword('1').ok, true, '1 位数字应通过');
    assert.equal(Auth.validatePassword('a').ok, true, '1 个字母应通过');
    assert.equal(Auth.validatePassword('密').ok, true, '1 个汉字应通过');
    assert.equal(Auth.validatePassword(' ').ok, true, '空格也是一位密码，不做内容限制');
    assert.equal(Auth.validatePassword('x'.repeat(500)).ok, true, '不做长度上限');
    assert.equal(Auth.validatePassword('!@#$%^&*()_+{}:"<>?').ok, true, '特殊字符不限制');
  });

  await test('密码散列：加盐、不可逆、可校验', async () => {
    const a = await Auth.hashPassword('hunter2');
    const b = await Auth.hashPassword('hunter2');
    assert.notEqual(a.salt, b.salt, '每次应使用不同的盐');
    assert.notEqual(a.hash, b.hash, '相同密码的散列也应不同');
    assert.ok(a.hash.length === 128, 'scrypt 64 字节 = 128 位十六进制');
    assert.equal(a.hash.includes('hunter2'), false, '不能出现明文');
    assert.equal(await Auth.verifyPassword('hunter2', a.salt, a.hash), true);
    assert.equal(await Auth.verifyPassword('hunter3', a.salt, a.hash), false);
  });

  await test('密码校验：损坏或缺失的数据不会通过', async () => {
    assert.equal(await Auth.verifyPassword('x', '', ''), false);
    assert.equal(await Auth.verifyPassword('x', 'abc', 'deadbeef'), false);
    assert.equal(await Auth.verifyPassword('x', 'abc', 'zzzz'), false);
  });

  await test('令牌：足够长且不重复', () => {
    const a = Auth.newToken();
    const b = Auth.newToken();
    assert.equal(a.length, 64);
    assert.notEqual(a, b);
  });

  await test('会话过期时间约为 30 天', () => {
    const now = 1_700_000_000_000;
    const exp = Auth.sessionExpiry(now);
    assert.equal(Math.round((exp - now) / 86400000), Auth.SESSION_DAYS);
  });

  await test('登录失败限流：连续失败后短暂锁定，成功即清零', () => {
    const limiter = Auth.createLoginLimiter(3, 1000);
    const now = 1000;
    assert.equal(limiter.blocked('u', now), 0);
    limiter.fail('u', now);
    limiter.fail('u', now);
    assert.equal(limiter.blocked('u', now), 0, '还没到阈值不应锁定');
    limiter.fail('u', now);
    assert.ok(limiter.blocked('u', now) > 0, '达到阈值应锁定');
    assert.equal(limiter.blocked('u', now + 2000), 0, '锁定时间过后应放行');
    limiter.fail('v', now);
    limiter.reset('v');
    assert.equal(limiter.blocked('v', now), 0);
  });

  console.log('\n' + (failures.length ? '✗ ' + failures.length + ' 项失败' : '✓ 全部通过') + '（' + passed + ' 项）\n');
  process.exitCode = failures.length ? 1 : 0;
})();
