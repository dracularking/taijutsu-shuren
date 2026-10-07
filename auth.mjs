/* ============================================================
   体術修煉 · auth.mjs
   账号相关的纯逻辑：用户名/密码校验、scrypt 散列与校验、会话令牌。
   不碰网络与磁盘，方便单独做单元测试。
   ============================================================ */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 1;      // 只要非空即可，不做任何字符/长度限制
export const SESSION_DAYS = 30;
export const MAX_LOGIN_FAILS = 5;
export const LOGIN_LOCK_MS = 30 * 1000;

const KEY_LEN = 64;
const USERNAME_RE = /^[\w.\-\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]+$/u;

/* ------------------------- 校验 ------------------------- */

export function normalizeUsername(name) {
  return String(name == null ? '' : name).trim();
}

/* 用户名不区分大小写：Alice 和 alice 视为同一个账号 */
export function usernameKey(name) {
  return normalizeUsername(name).toLowerCase();
}

export function validateUsername(name) {
  const value = normalizeUsername(name);
  if (!value) return { ok: false, error: '请输入用户名' };
  if (value.length < USERNAME_MIN) return { ok: false, error: `用户名至少 ${USERNAME_MIN} 个字符` };
  if (value.length > USERNAME_MAX) return { ok: false, error: `用户名最多 ${USERNAME_MAX} 个字符` };
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: '用户名里不能有空格' };
  if (!USERNAME_RE.test(value)) return { ok: false, error: '用户名只能用中英文、数字、下划线、点或减号' };
  return { ok: true, value: value };
}

export function validatePassword(password) {
  const value = String(password == null ? '' : password);
  if (!value) return { ok: false, error: '请输入密码' };
  return { ok: true, value: value };
}

/* ------------------------- 密码散列 ------------------------- */

export function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export async function hashPassword(password, salt) {
  const useSalt = salt || newSalt();
  const derived = await scrypt(String(password), useSalt, KEY_LEN);
  return { salt: useSalt, hash: Buffer.from(derived).toString('hex') };
}

export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const derived = await scrypt(String(password), String(salt), KEY_LEN);
  const target = Buffer.from(String(hash), 'hex');
  if (target.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, target);
}

/* ------------------------- 令牌 ------------------------- */

export function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sessionExpiry(now = Date.now()) {
  return now + SESSION_DAYS * 24 * 60 * 60 * 1000;
}

/* 连续失败就短暂锁定，挡住暴力猜测（内存计数即可，重启清零） */
export function createLoginLimiter(maxFails = MAX_LOGIN_FAILS, lockMs = LOGIN_LOCK_MS) {
  const attempts = new Map();
  return {
    blocked(key, now = Date.now()) {
      const item = attempts.get(key);
      if (!item || !item.until) return 0;
      return item.until > now ? item.until - now : 0;
    },
    fail(key, now = Date.now()) {
      const item = attempts.get(key) || { fails: 0, until: 0 };
      item.fails += 1;
      if (item.fails >= maxFails) {
        item.until = now + lockMs;
        item.fails = 0;
      }
      attempts.set(key, item);
      return item;
    },
    reset(key) {
      attempts.delete(key);
    }
  };
}
