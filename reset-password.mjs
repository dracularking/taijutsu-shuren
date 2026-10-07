/* ============================================================
   体術修煉 · reset-password.mjs
   忘记密码时的救命工具（要先关掉服务再运行）：
     node reset-password.mjs 用户名 新密码
     node reset-password.mjs --list
   可选：--data-dir ./data
   ============================================================ */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Auth from './auth.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function argValue(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const DATA_DIR = path.resolve(argValue('--data-dir', path.join(ROOT, 'data')));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { return fallback; }
}

async function writeJson(file, value) {
  const tmp = file + '.tmp';
  try { await fs.copyFile(file, file + '.bak'); } catch (e) { /* 首次没有 bak */ }
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function main() {
  const db = await readJson(USERS_FILE, { version: 1, users: [] });
  if (!Array.isArray(db.users) || !db.users.length) {
    console.error(`\n✗ 没有找到任何账号（${USERS_FILE}）。先启动服务并在网页里注册。\n`);
    process.exitCode = 1;
    return;
  }

  if (argv.includes('--list')) {
    console.log('\n现有账号：');
    db.users.forEach((u) => {
      console.log(`  - ${u.name}（${u.id}）${u.createdAt ? '  注册于 ' + u.createdAt : ''}`);
    });
    console.log('\n改密码： node reset-password.mjs 用户名 新密码\n');
    return;
  }

  const args = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--data-dir');
  const name = args[0];
  const newPassword = args[1];

  if (!name || !newPassword) {
    console.error('\n用法： node reset-password.mjs 用户名 新密码');
    console.error('      node reset-password.mjs --list\n');
    process.exitCode = 1;
    return;
  }

  const key = Auth.usernameKey(name);
  const user = db.users.find((u) => (u.key || Auth.usernameKey(u.name)) === key);
  if (!user) {
    console.error(`\n✗ 没有这个账号：${name}`);
    console.error('  看看有哪些账号： node reset-password.mjs --list\n');
    process.exitCode = 1;
    return;
  }

  const check = Auth.validatePassword(newPassword);
  if (!check.ok) {
    console.error('\n✗ ' + check.error + '\n');
    process.exitCode = 1;
    return;
  }

  const { salt, hash } = await Auth.hashPassword(check.value);
  user.salt = salt;
  user.hash = hash;
  user.updatedAt = new Date().toISOString();
  await writeJson(USERS_FILE, db);

  // 改完密码，旧会话一律作废
  const sessions = await readJson(SESSIONS_FILE, { version: 1, sessions: {} });
  sessions.sessions = {};
  try { await writeJson(SESSIONS_FILE, sessions); } catch (e) { /* 没有会话文件也无所谓 */ }

  console.log(`\n✓ 已重置账号「${user.name}」的密码。`);
  console.log(`  数据文件： data/${user.id}.json（记录没有动）`);
  console.log('  现在可以启动服务并用新密码登录了。\n');
}

main().catch((err) => {
  console.error('出错：', err.message);
  process.exitCode = 1;
});
