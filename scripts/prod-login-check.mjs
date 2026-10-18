/**
 * 生产站登录体检：用无头浏览器真的打开登录页、输密码、点提交，把现场抓回来。
 *
 * 为什么要这么做：接口层面用 curl 已经证明"账号密码是对的"（HTTP 200），
 * 那么用户"登录不上"就只可能是**页面那一侧**的问题 —— 白屏、JS 没加载、
 * 代理把资源吞了、或者根本打开的不是这个站。这些只有真的渲染一遍才看得出来。
 *
 * 用法：
 *   node scripts/prod-login-check.mjs                          # 默认打 http://haoxianawa.xyz
 *   BASE_URL=http://1.2.3.4 node scripts/prod-login-check.mjs
 *   PASSWORD=xxx node scripts/prod-login-check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://haoxianawa.xyz';
const USERNAME = process.env.USERNAME_LOGIN ?? 'keeper';
const PASSWORD = process.env.PASSWORD ?? 'B7i48JbiAwZuca99';
const CDP_PORT = Number(process.env.CDP_PORT ?? 9334);

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean).find((p) => fs.existsSync(p));

let pass = 0;
let fail = 0;
const failures = [];
const consoleErrors = [];
const failedRequests = [];

function check(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra === undefined ? '' : `  → ${String(extra).slice(0, 400)}`}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method && this.handlers.has(msg.method)) this.handlers.get(msg.method)(msg.params, msg.sessionId);
    });
  }
  send(method, params = {}, sessionId) {
    this.id += 1;
    const id = this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 超时：${method}`));
        }
      }, 30000);
    });
  }
  on(m, fn) {
    this.handlers.set(m, fn);
  }
}

async function main() {
  if (!EDGE) {
    console.error('找不到 msedge.exe');
    process.exit(2);
  }
  console.log(`\n▶ 生产站登录体检：${BASE}/admin/login\n`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cjw-prod-'));
  const proc = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  if (!version) {
    console.error('无头浏览器起不来');
    process.exit(2);
  }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') consoleErrors.push((p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    consoleErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'unknown');
  });
  cdp.on('Network.loadingFailed', (p) => {
    failedRequests.push(`${p.type} ${p.errorText}`);
  });
  cdp.on('Network.responseReceived', (p) => {
    if (p.response && p.response.status >= 400) failedRequests.push(`HTTP ${p.response.status} ${p.response.url}`);
  });

  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);

  const evalIn = async (expr) =>
    String((await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)).result?.value ?? '');

  // ---- 1. 打开登录页
  await cdp.send('Page.navigate', { url: `${BASE}/admin/login` }, sessionId);
  await sleep(3500);
  const text1 = await evalIn('document.body ? document.body.innerText : ""');
  const url1 = await evalIn('location.href');

  check('登录页能打开且不是白屏', text1.trim().length > 20, { url: url1, text: text1.slice(0, 200) });
  check('页面上有「管理」字样', text1.includes('管理'), text1.slice(0, 200));
  check('★ 账号输入框存在（说明前端 JS 加载成功）', (await evalIn('!!document.querySelector("#admin-user")')) === 'true', '找不到 #admin-user');
  check('密码输入框存在', (await evalIn('!!document.querySelector("#admin-pass")')) === 'true', '找不到 #admin-pass');
  check('账号已预填 keeper', (await evalIn('document.querySelector("#admin-user")?.value ?? ""')) === USERNAME, await evalIn('document.querySelector("#admin-user")?.value ?? ""'));

  // ---- 2. 输密码并提交（用 React 能感知的方式写值）
  await evalIn(`
    (() => {
      const el = document.querySelector('#admin-pass');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(PASSWORD)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()
  `);
  await sleep(400);
  check('密码确实写进了输入框', (await evalIn('document.querySelector("#admin-pass")?.value ?? ""')) === PASSWORD, '写值失败');

  const clicked = await evalIn(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => (x.textContent||'').includes('进入后台'));
      if (!b) return 'NO_BUTTON';
      b.click();
      return 'CLICKED';
    })()
  `);
  check('找到并点击了「进入后台」', clicked === 'CLICKED', clicked);

  await sleep(4000);
  const text2 = await evalIn('document.body ? document.body.innerText : ""');
  const url2 = await evalIn('location.href');
  const hasToken = await evalIn('String(localStorage.getItem("cjw:token") ?? "").length > 0');

  console.log(`\n  登录后 URL：${url2}`);
  console.log(`  登录后正文前 200 字：${text2.slice(0, 200).replace(/\n/g, ' | ')}\n`);

  check('★ 登录后跳转到了后台（URL 含 /admin 且不在登录页）', /\/admin/.test(url2) && !url2.includes('/admin/login'), url2);
  check('★ 浏览器里存下了登录令牌', hasToken === 'true', 'localStorage 里没有 cjw:token');
  check('页面上出现了后台分区（仪表盘/会员/灵石…）', /仪表盘|会员|灵石|文稿/.test(text2), text2.slice(0, 300));
  check('没有出现"账号或密码错误"这类提示', !/密码错误|登录失败|不正确/.test(text2), text2.slice(0, 300));

  // ---- 3. 资源与控制台
  const realFailed = failedRequests.filter((f) => !/favicon/i.test(f));
  check('没有资源加载失败（4xx/5xx 或网络错误）', realFailed.length === 0, realFailed.slice(0, 5));
  const realErrors = consoleErrors.filter((e) => e && !/favicon|React DevTools|GroupMarkerNotSet|no adapter|WebGPU|opening\/index\.html/i.test(e));
  check('没有 JS 控制台报错', realErrors.length === 0, realErrors.slice(0, 3));

  try {
    await cdp.send('Browser.close');
  } catch { /* 忽略 */ }
  await sleep(300);
  proc.kill();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch { /* 忽略 */ }

  console.log(`\n══════════════════════════════════════`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  if (fail > 0) console.log(`  失败用例：\n    - ${failures.join('\n    - ')}`);
  console.log(`══════════════════════════════════════\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n脚本异常：', err);
  process.exit(1);
});
