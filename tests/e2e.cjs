/* ============================================================
   tests/e2e.cjs —— 浏览器端端到端自检
   用法：node tests/e2e.cjs
   做三件事：起一个临时服务（独立 data.json）、用无头 Chrome 打开注入了
   tests/e2e.browser.js 的首页副本、解析页面里的 PASS/FAIL 结果。
   ============================================================ */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT || 4189);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(__dirname, '.e2e-data');
const LEGACY = path.join(__dirname, '.e2e-legacy.json');
const PAGE = path.join(ROOT, '_e2e.html');
const INJECTED_JS = path.join(ROOT, '_e2e.browser.js');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch (e) { /* 继续找 */ }
  }
  return null;
}

function cleanup(server) {
  if (server && !server.killed) { try { server.kill(); } catch (e) { /* ignore */ } }
  [PAGE, INJECTED_JS].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
  });
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(LEGACY); } catch (e) { /* ignore */ }
}

/* 每轮用干净的账号库与数据目录（不碰你自己的 data/ 和 data.json） */
function resetDataDir() {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  [LEGACY, LEGACY + '.bak', path.join(__dirname, '.e2e-dump.html')].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
  });
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/api/health');
      if (res.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return false;
}

(async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('✗ 没有找到 Chrome / Edge，跳过浏览器端自检（可用 CHROME_PATH 环境变量指定）。');
    process.exitCode = 2;
    return;
  }

  // 1) 生成注入了测试脚本的首页副本，并重置测试用数据目录
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.copyFileSync(path.join(__dirname, 'e2e.browser.js'), INJECTED_JS);
  fs.writeFileSync(PAGE, html.replace('</body>', '<script src="_e2e.browser.js"></script>\n</body>'), 'utf8');
  resetDataDir();

  // 2) 起临时服务（独立账号库 + 独立数据目录）
  const server = spawn(process.execPath, [
    'server.mjs', '--port', String(PORT), '--data-dir', DATA_DIR, '--legacy', LEGACY
  ], { cwd: ROOT, stdio: 'ignore' });
  let exitCode = 1;

  try {
    if (!await waitForHealth(10000)) throw new Error('临时服务启动失败（' + BASE + '）');
    console.log('\n浏览器端自检（' + path.basename(browser) + ' + ' + BASE + '）\n');

    // 3) 无头浏览器跑一遍
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-e2e-'));
    const result = spawnSync(browser, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--user-data-dir=' + profile,
      '--window-size=1280,1200',
      '--virtual-time-budget=20000',
      '--dump-dom',
      BASE + '/_e2e.html#log'
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });

    const dom = ((result.stdout || '') + (result.stderr || '')).replace(/\r\n/g, '\n');
    const block = /E2E-BEGIN\n([\s\S]*?)\nE2E-END/.exec(dom);
    if (!block) {
      const dump = path.join(__dirname, '.e2e-dump.html');
      fs.writeFileSync(dump, dom, 'utf8');
      console.error('✗ 页面里没有拿到测试结果（浏览器可能启动失败）。');
      console.error('  浏览器退出码：' + result.status + '，错误：' + (result.error ? result.error.message : '无'));
      console.error('  原始 DOM 已写入：' + dump + '（' + dom.length + ' 字节）');
      exitCode = 1;
    } else {
      const lines = block[1].split('\n');
      lines.forEach(function (line) {
        const pass = line.startsWith('PASS');
        console.log((pass ? '  ✓ ' : '  ✗ ') + line.replace(/^(PASS|FAIL) \| /, ''));
      });
      const failed = lines.filter(function (l) { return l.startsWith('FAIL'); }).length;
      console.log('\n' + (failed ? '✗ ' + failed + ' 项失败' : '✓ 全部通过') + '（' + lines.length + ' 项）\n');
      exitCode = failed ? 1 : 0;
    }
  } catch (err) {
    console.error('✗ ' + err.message);
    exitCode = 1;
  } finally {
    cleanup(server);
  }

  process.exitCode = exitCode;
})();
