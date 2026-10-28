// Screenshots + benchmark for the home ocean background preview.
//
//   node preview/ocean/shoot.cjs
//
// Drives the real Chrome (Metal/ANGLE when available) through playwright-core:
//   * 390x844 CSS phones at deviceScaleFactor 3 for pixel-level BEFORE/AFTER/NATIVE
//   * comparison sheets and whale closeups
//   * renderer.draw() + toDataURL() timing for ratios 0.4..1.0 x JPEG qualities
//   * end-to-end draw -> encode -> decode pipeline timings
//
// Outputs land next to this file. Browser numbers are a desktop proxy; see
// device-probe for the WeChat runtime measurements.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const repoRoot = path.resolve(dir, '../..');

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_MODULE,
  '/Users/0the/node_modules/playwright',
  '/Users/0the/node_modules/playwright-core',
  '/Users/0the/Library/Application Support/QClaw/openclaw/node_modules/playwright-core',
  'playwright',
  'playwright-core'
].filter(Boolean);

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try { return require(candidate); } catch (error) { /* next candidate */ }
  }
  return null;
}

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => {
    try { fs.accessSync(candidate); return true; } catch (error) { return false; }
  });
}

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const target = path.join(dir, urlPath === '/' ? 'index.html' : urlPath);
    if (!target.startsWith(dir)) { res.statusCode = 403; return res.end('forbidden'); }
    fs.readFile(target, (error, data) => {
      if (error) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', MIME[path.extname(target).toLowerCase()] || 'application/octet-stream');
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server: server, port: server.address().port }));
  });
}

function findBox(page, selector) {
  return page.locator(selector).first().boundingBox();
}

async function waitReady(page) {
  await page.waitForFunction('window.__PREVIEW_READY === true', null, { timeout: 60000 });
  const error = await page.evaluate('document.body.dataset.error || ""');
  if (error) throw new Error('preview failed: ' + error);
}

async function shoot(context, url, options) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await waitReady(page);
  const afterEnabled = await page.evaluate('!!window.OCEAN_PREVIEW.after');
  const shots = [
    { stage: 'before', selector: '[data-phone="before"]', file: 'before.png' },
    { stage: 'fallback', selector: '[data-phone="fallback"]', file: 'fallback.png' },
    { stage: 'native', selector: '[data-stage="native"] .phone', file: 'native.png' }
  ];
  if (afterEnabled) {
    shots.push(
      { stage: 'after', selector: '[data-phone="after"]', file: 'after.png' },
      { stage: 'after-base', selector: '[data-phone="after-base"]', file: 'after-base.png' },
      { stage: 'after-crossfade', selector: '[data-phone="after-crossfade"]', file: 'after-crossfade.png' }
    );
  }
  const screens = [];
  for (const shot of shots) {
    const box = await findBox(page, shot.selector);
    if (!box) continue;
    const file = path.join(dir, shot.file);
    await page.locator(shot.selector).first().screenshot({ path: file });
    screens.push({ stage: shot.stage, file: shot.file, box: box, bytes: fs.statSync(file).size });
  }

  // Whale/closeup crop: same CSS rectangle in BEFORE / AFTER / NATIVE so the
  // dot crispness and JPEG blocking can be compared 1:1.
  const cropsDir = path.join(dir, 'crops');
  fs.mkdirSync(cropsDir, { recursive: true });
  const cropRect = { x: 40, y: 118, width: 270, height: 160 }; // clean band above native headline
  const cropStages = afterEnabled ? ['before', 'after', 'native'] : ['before', 'native'];
  const crops = [];
  // element screenshots above scroll the page; crops are page coordinates
  await page.evaluate('window.scrollTo(0, 0)');
  for (const stage of cropStages) {
    const selector = stage === 'native' ? '[data-stage="native"] .phone' : '[data-phone="' + stage + '"]';
    const box = await findBox(page, selector);
    if (!box) continue;
    const name = path.join(cropsDir, 'whale-' + stage + '.png');
    const clip = { x: box.x + cropRect.x, y: box.y + cropRect.y, width: cropRect.width, height: cropRect.height };
    try {
      await page.screenshot({ path: name, clip: clip });
    } catch (error) {
      await page.screenshot({ path: name, fullPage: true, clip: clip });
    }
    crops.push({ stage: stage, file: path.relative(dir, name), bytes: fs.statSync(name).size });
  }

  const config = await page.evaluate('window.OCEAN_PREVIEW');
  const summary = await page.evaluate('({ glRenderer: (function(){ var c=document.createElement("canvas"); var g=c.getContext("webgl"); var e=g.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; })() })');

  const skipBenchmark = process.argv.includes('--no-benchmark');

  // Benchmarks: BEFORE renderer (whole-frame shader) and AFTER renderer (fluid only).
  const benchmark = { before: null, after: null };
  const pipeline = { before: null, after: null };
  let artifacts = null;
  if (afterEnabled) artifacts = await page.evaluate('window.__OCEAN_PREVIEW_API.measureAfterArtifacts()');
  if (!skipBenchmark) {
    benchmark.before = await page.evaluate('window.__OCEAN_PREVIEW_API.runBenchmark("before")');
    pipeline.before = await page.evaluate('window.__OCEAN_PREVIEW_API.runPipeline("before")');
    if (afterEnabled) {
      benchmark.after = await page.evaluate('window.__OCEAN_PREVIEW_API.runBenchmark("after")');
      pipeline.after = await page.evaluate('window.__OCEAN_PREVIEW_API.runPipeline("after")');
    }
  }

  if (!skipBenchmark) {
    fs.writeFileSync(path.join(dir, 'benchmark-before.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      browser: summary.glRenderer,
      benchmark: benchmark.before,
      pipeline: pipeline.before,
      config: config.before
    }, null, 2));
  }
  if (afterEnabled) {
    fs.writeFileSync(path.join(dir, 'benchmark-after.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      browser: summary.glRenderer,
      benchmark: benchmark.after,
      pipeline: pipeline.after,
      artifacts: artifacts,
      config: {
        ratio: config.after.ratio,
        quality: config.after.quality,
        crossfadeMs: config.after.crossfadeMs,
        whalePath: config.after.whalePath
      }
    }, null, 2));
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    url: url,
    dpr: 3,
    browser: summary.glRenderer,
    viewport: { width: config.width, height: config.height },
    before: config.before,
    after: config.after ? {
      ratio: config.after.ratio,
      quality: config.after.quality,
      crossfadeMs: config.after.crossfadeMs,
      whalePath: config.after.whalePath
    } : null,
    screens: screens,
    crops: crops
  };
  fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(meta, null, 2));
  await page.close();
  return {
    benchmark: { before: benchmark.before, after: benchmark.after },
    pipeline: pipeline,
    artifacts: artifacts,
    summary: summary,
    afterEnabled: afterEnabled
  };
}

function markdownTable(result) {
  const lines = [];
  for (const which of ['before', 'after']) {
    const data = result.benchmark[which];
    if (!data) continue;
    lines.push('');
    lines.push('### ' + (which === 'before' ? 'BEFORE renderer (whole-frame: fluid + grid + whale)' : 'AFTER renderer (fluid only)') + ' — GL: ' + data.glRenderer);
    lines.push('| ratio | buffer | q | draw ms | encode ms | draw+encode ms | p95 ms | dataURL bytes |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of data.rows) {
      const ratioLabel = row.clamped ? row.ratio + ' → ' + row.effectiveRatio : String(row.ratio);
      lines.push('| ' + ratioLabel + ' | ' + row.buffer[0] + '×' + row.buffer[1] + ' | ' + row.quality + ' | ' +
        row.avgDrawMs + ' | ' + row.avgEncodeMs + ' | ' + row.avgTotalMs + ' | ' + row.p95TotalMs + ' | ' + row.dataUrlBytes + ' |');
    }
  }
  lines.push('');
  for (const which of ['before', 'after']) {
    const data = result.pipeline[which];
    if (!data) continue;
    lines.push('pipeline ' + which + ': ratio ' + data.ratio + ' (' + data.buffer[0] + '×' + data.buffer[1] + ') q' + data.quality +
      ' → draw ' + data.avgDrawMs + 'ms + encode ' + data.avgEncodeMs + 'ms + decode ' + data.avgDecodeMs +
      'ms = ' + data.avgTotalMs + 'ms, ' + data.dataUrlBytes + ' bytes');
  }
  return lines.join('\n');
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('playwright/playwright-core not found. Set PLAYWRIGHT_MODULE=<path> and retry.');
    process.exit(1);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error('no Chrome/Chromium found; adapt CHROME_CANDIDATES');
    process.exit(1);
  }
  const { server, port } = await startServer();
  const url = 'http://127.0.0.1:' + port + '/index.html';
  const browser = await playwright.chromium.launch({
    executablePath: chrome,
    headless: true,
    args: [
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--enable-gpu',
      '--use-angle=metal',
      '--ignore-gpu-blocklist'
    ]
  });
  try {
    const dpr3 = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 3 });
    const result = await shoot(dpr3, url);
    await dpr3.close();

    const sheet = await browser.newContext({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1.5 });
    const sheetPage = await sheet.newPage();
    await sheetPage.goto(url, { waitUntil: 'load' });
    await waitReady(sheetPage);
    await sheetPage.screenshot({ path: path.join(dir, 'compare.png'), fullPage: true });
    await sheet.close();

    console.log(markdownTable(result));
    if (result.artifacts) {
      console.log('');
      console.log('AFTER artifacts: ' + JSON.stringify(result.artifacts, null, 2));
    }
    console.log('');
    console.log('screenshots: preview/ocean/{before,after,after-base,after-crossfade,fallback,native,compare}.png');
    console.log('closeups:    preview/ocean/crops/whale-{before,after,native}.png');
    console.log('data:        preview/ocean/{benchmark-before,benchmark-after,screens}.json');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
