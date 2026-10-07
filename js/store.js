/* ============================================================
   体術修煉 · store.js
   持久化层：同目录 server.mjs 提供「账号 + 每人一份数据文件」；
   直接双击打开 index.html（file://）时退回浏览器本地存储，不启用账号。
   ============================================================ */
(function (root) {
  'use strict';

  const Core = root.TRCore;
  const KEY = 'taijutsu-shuren.state.v1';
  const API = 'api/data';

  let state = Core.emptyState();
  let mode = 'local';          // 'file' | 'local'
  let note = '';
  let auth = { required: false, user: null, dataFile: '' };
  let saveTimer = null;
  let saving = false;
  let dirty = false;
  const listeners = [];

  function notify() { listeners.forEach(function (fn) { try { fn(state, mode); } catch (e) { console.error(e); } }); }

  function loggedIn() { return mode === 'file' ? !!auth.user : true; }

  function localStorageAvailable() {
    try {
      const probe = '__tr_probe__';
      root.localStorage.setItem(probe, '1');
      root.localStorage.removeItem(probe);
      return true;
    } catch (e) { return false; }
  }

  const hasLS = localStorageAvailable();

  function readLocal() {
    if (!hasLS) return null;
    try {
      const raw = root.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { console.warn('读取本地缓存失败', e); return null; }
  }

  function writeLocal(snapshot) {
    if (!hasLS) return false;
    try { root.localStorage.setItem(KEY, JSON.stringify(snapshot)); return true; }
    catch (e) { console.warn('写入本地缓存失败', e); return false; }
  }

  function fileAvailable() {
    return typeof fetch === 'function' && location.protocol !== 'file:';
  }

  async function detectMode() {
    if (!fileAvailable()) { mode = 'local'; note = '直接打开文件（file://），使用浏览器本地存储（不含账号）'; return; }
    try {
      const res = await fetch('api/health', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      mode = 'file';
      note = '由本地服务提供文件存储（每人一份 data/<账号>.json）';
    } catch (e) {
      mode = 'local';
      note = '未检测到本地服务，使用浏览器本地存储（不含账号）';
    }
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({ cache: 'no-store' }, options || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  /* 问服务端「我是谁」：登录了就返回用户，401 表示要登录 */
  async function fetchMe() {
    const res = await api('api/me');
    if (res.ok && res.data && res.data.user) {
      auth = { required: true, user: res.data.user, dataFile: res.data.dataFile || '' };
      return true;
    }
    auth = { required: true, user: null, dataFile: '' };
    return false;
  }

  async function readRemote() {
    const res = await api(API);
    if (res.status === 401) {
      auth = { required: true, user: null, dataFile: '' };
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.data && Array.isArray(res.data.records) ? res.data : null;
  }

  async function writeRemote(snapshot) {
    const res = await api(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot)
    });
    if (res.status === 401) {
      auth = { required: true, user: null, dataFile: '' };
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.data;
  }

  /* --------------------------- 对外接口 --------------------------- */

  async function init() {
    await detectMode();

    if (mode === 'file') {
      const signedIn = await fetchMe();
      if (!signedIn) {
        state = Core.emptyState();
        notify();
        return state;                       // 等用户登录 / 注册
      }
      try {
        const loaded = await readRemote();
        state = Core.normalizeState(loaded || Core.emptyState());
      } catch (e) {
        state = Core.emptyState();
      }
      notify();
      return state;
    }

    state = Core.normalizeState(readLocal() || Core.emptyState());
    notify();
    return state;
  }

  /* 登录 / 注册成功后加载该账号的数据 */
  async function loadAfterAuth() {
    dirty = false;
    try {
      const loaded = await readRemote();
      state = Core.normalizeState(loaded || Core.emptyState());
    } catch (e) {
      state = Core.emptyState();
    }
    notify();
    return state;
  }

  async function register(name, password) {
    if (mode !== 'file') return { ok: false, error: '当前是本地模式（直接打开 index.html），没有账号功能' };
    const res = await api('api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: password })
    });
    if (!res.ok) return { ok: false, error: res.data.error || '注册失败（HTTP ' + res.status + '）' };
    auth = { required: true, user: res.data.user, dataFile: '' };
    await loadAfterAuth();
    return { ok: true, user: res.data.user, adopted: res.data.adopted || 0 };
  }

  async function login(name, password) {
    if (mode !== 'file') return { ok: false, error: '当前是本地模式（直接打开 index.html），没有账号功能' };
    const res = await api('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: password })
    });
    if (!res.ok) return { ok: false, error: res.data.error || '登录失败（HTTP ' + res.status + '）' };
    auth = { required: true, user: res.data.user, dataFile: '' };
    await loadAfterAuth();
    return { ok: true, user: res.data.user };
  }

  async function logout() {
    if (mode === 'file') {
      try { await api('api/logout', { method: 'POST' }); } catch (e) { /* 忽略 */ }
    }
    clearTimeout(saveTimer);
    dirty = false;
    if (mode === 'file') auth = { required: true, user: null, dataFile: '' };
    state = Core.emptyState();
    notify();
  }

  async function changePassword(oldPassword, newPassword) {
    const res = await api('api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPassword, newPassword: newPassword })
    });
    if (!res.ok) return { ok: false, error: res.data.error || '修改失败（HTTP ' + res.status + '）' };
    return { ok: true };
  }

  function get() { return state; }
  function getMode() { return mode; }
  function getNote() { return note; }
  function getAuth() { return auth; }
  function subscribe(fn) { listeners.push(fn); return function () { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; }

  function snapshot() { return Core.normalizeState(state); }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 350);
  }

  async function flush() {
    if (saving || !dirty || !loggedIn()) return;
    saving = true;
    const snap = snapshot();
    if (mode === 'file') {
      try {
        await writeRemote(snap);
        dirty = false;
      } catch (e) {
        if (String(e && e.message) === 'unauthorized') {
          note = '登录已过期，请重新登录';
        } else {
          console.warn('保存到文件失败，转为浏览器存储', e);
          mode = 'local';
          note = '写入数据文件失败，已切到浏览器存储';
        }
      }
    }
    if (mode === 'local') {
      if (writeLocal(snap)) dirty = false;
      else { dirty = false; note = '浏览器存储不可用，数据仅保留在本次会话'; }
    }
    saving = false;
    notify();
    if (dirty) persist();
  }

  function changed() {
    dirty = true;
    notify();
    persist();
  }

  function replace(next) {
    state = Core.normalizeState(next);
    changed();
    return state;
  }

  /* --------------------------- 记录操作 --------------------------- */

  function addRecord(input) {
    const rec = Core.normalizeRecord(input);
    rec.createdAt = new Date().toISOString();
    rec.updatedAt = rec.createdAt;
    state.records.push(rec);
    changed();
    return rec;
  }

  function updateRecord(input) {
    const rec = Core.normalizeRecord(input);
    const i = state.records.findIndex(function (r) { return r.id === rec.id; });
    rec.updatedAt = new Date().toISOString();
    if (i >= 0) {
      rec.createdAt = state.records[i].createdAt || rec.createdAt;
      state.records[i] = rec;
    } else {
      state.records.push(rec);
    }
    changed();
    return rec;
  }

  function deleteRecord(id) {
    const i = state.records.findIndex(function (r) { return r.id === id; });
    if (i < 0) return false;
    state.records.splice(i, 1);
    changed();
    return true;
  }

  function getRecord(id) {
    return state.records.find(function (r) { return r.id === id; }) || null;
  }

  /* --------------------------- 设置操作 --------------------------- */

  /* 添加项目；给了 parent 就是给该项目加子项目 */
  function addItem(name, parent) {
    const clean = String(name || '').trim().slice(0, 20);
    if (!clean) return false;
    if (parent) {
      const node = state.settings.items.find(function (n) { return n.name === parent; });
      if (!node) return false;
      if (node.children.indexOf(clean) >= 0) return false;
      if (node.name === clean) return false;
      node.children.push(clean);
      changed();
      return true;
    }
    if (state.settings.items.some(function (n) { return n.name === clean; })) return false;
    state.settings.items.push({ name: clean, children: Core.defaultChildren(clean) });
    changed();
    return true;
  }

  /* 删除项目；给了 parent 就是删该项目下的一个子项目 */
  function removeItem(name, parent) {
    if (parent) {
      const node = state.settings.items.find(function (n) { return n.name === parent; });
      if (!node) return false;
      const i = node.children.indexOf(name);
      if (i < 0) return false;
      node.children.splice(i, 1);
      changed();
      return true;
    }
    const i = state.settings.items.findIndex(function (n) { return n.name === name; });
    if (i < 0) return false;
    state.settings.items.splice(i, 1);
    changed();
    return true;
  }

  /* 项目树合并（导入时用）：同名项目的子项目取并集 */
  function mergeItems(a, b) {
    const out = Core.normalizeItems(a).map(function (n) {
      return { name: n.name, children: n.children.slice() };
    });
    Core.normalizeItems(b).forEach(function (node) {
      const hit = out.find(function (n) { return n.name === node.name; });
      if (hit) hit.children = Core.uniqueStrings(hit.children.concat(node.children), 30);
      else out.push({ name: node.name, children: node.children.slice() });
    });
    return out;
  }

  function itemTree() { return state.settings.items; }

  function setTheme(theme) {
    state.settings.theme = theme === 'light' ? 'light' : 'dark';
    changed();
  }

  function merge(payload) {
    const incoming = payload && Array.isArray(payload.records) ? payload : Core.parseImport(JSON.stringify(payload));
    const byId = new Map(state.records.map(function (r) { return [r.id, r]; }));
    let added = 0, updated = 0;
    incoming.records.forEach(function (r) {
      if (byId.has(r.id)) { byId.set(r.id, r); updated++; }
      else { byId.set(r.id, r); added++; }
    });
    state.records = Array.from(byId.values());
    if (incoming.settings && Array.isArray(incoming.settings.items)) {
      state.settings.items = mergeItems(state.settings.items, incoming.settings.items);
    }
    changed();
    return { added: added, updated: updated, total: state.records.length };
  }

  function clearAll() {
    state.records = [];
    changed();
    return true;
  }

  root.Store = {
    init: init, get: get, getMode: getMode, getNote: getNote, getAuth: getAuth, subscribe: subscribe,
    register: register, login: login, logout: logout, changePassword: changePassword,
    replace: replace, flush: flush, snapshot: snapshot,
    addRecord: addRecord, updateRecord: updateRecord, deleteRecord: deleteRecord, getRecord: getRecord,
    addItem: addItem, removeItem: removeItem, setTheme: setTheme, itemTree: itemTree,
    merge: merge, clearAll: clearAll,
    get dirty() { return dirty; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
