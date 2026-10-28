'use strict';
// CDP screenshot helper (vendored for preview/whale-asset/shoot.cjs).
// headless=new enforces a ~500 CSS px minimum window on macOS, which distorts
// vw-based layouts; this drives Page.captureScreenshot with
// Emulation.setDeviceMetricsOverride so the viewport is exactly 390x844 @3x.
// Usage: node preview/whale-asset/cdp-shot.cjs <url> <out.png> [width] [height] [dpr] [waitMs] [evalFile]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];
const CHROME = CANDIDATES.find(candidate => { try { fs.accessSync(candidate); return true; } catch (error) { return false; } });
if (!CHROME) throw new Error('no local Chrome found');
const url = process.argv[2];
const out = process.argv[3];
const width = Number(process.argv[4] || 390);
const height = Number(process.argv[5] || 844);
const dpr = Number(process.argv[6] || 3);
const waitMs = Number(process.argv[7] || 600);
const evalFile = process.argv[8] || '';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0; const pending = new Map();
    const events = [];
    ws.onopen = () => resolve({ send(method, params) { return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params: params || {} })); }); }, events, close() { ws.close(); } });
    ws.onerror = reject;
    ws.onmessage = ev => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result); } else events.push(msg); };
  });
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + userDir, '--no-first-run', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  try {
    let version;
    for (let i = 0; i < 100; i++) { try { version = await (await fetch('http://127.0.0.1:9333/json/version')).json(); break; } catch (e) { await sleep(100); } }
    if (!version) throw new Error('chrome did not expose CDP');
    const browser = await connect(version.webSocketDebuggerUrl);
    const t = await browser.send('Target.createTarget', { url: 'about:blank' });
    const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
    const target = list.find(item => item.id === t.targetId);
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true });
    const loaded = new Promise(resolve => { const timer = setInterval(() => { if (page.events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(timer); resolve(); } }, 50); });
    await page.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(5000)]);
    await sleep(waitMs);
    if (evalFile) {
      const expression = fs.readFileSync(evalFile, 'utf8');
      const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      console.log('EVAL ' + JSON.stringify(result.result && result.result.value));
    }
    const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log('wrote ' + out + ' ' + width + 'x' + height + '@' + dpr);
    page.close(); browser.close();
  } finally { chrome.kill('SIGKILL'); }
})().catch(error => { console.error(error); process.exit(1); });
