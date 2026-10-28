// Screenshots the trajectory ledger preview (light + dark) for review.
// Usage: node preview/trajectory/shoot.cjs
// No third-party deps: probes local Edge/Chrome/Chromium builds and drives the
// headless screenshot flag directly.
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const url = 'file://' + path.join(dir, 'index.html');
const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium'
];
const browser = candidates.find(candidate => {
  try { require('node:fs').accessSync(candidate); return true; } catch (error) { return false; }
});
if (!browser) {
  console.error('no headless browser found; install Edge/Chrome or adapt the candidate list');
  process.exit(1);
}
for (const name of ['preview-light.png', 'preview-dark.png']) {
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=860,1000',
    '--screenshot=' + path.join(dir, name),
    url
  ], { stdio: 'ignore' });
  console.log('wrote', name);
}
