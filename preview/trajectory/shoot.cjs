// Screenshots the trajectory ledger preview (light + dark) for review.
// Usage: node preview/trajectory/shoot.cjs
// No third-party deps: probes local Edge/Chrome/Chromium builds and drives the
// headless screenshot flag directly. index.html holds both themes side by side,
// so each shot is taken from a temporary single-theme copy.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const source = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium'
];
const browser = candidates.find(candidate => {
  try { fs.accessSync(candidate); return true; } catch (error) { return false; }
});
if (!browser) {
  console.error('no headless browser found; install Edge/Chrome or adapt the candidate list');
  process.exit(1);
}

const shots = [
  { name: 'preview-light.png', hide: '.col-dark' },
  { name: 'preview-dark.png', hide: '.col-light' }
];
for (const shot of shots) {
  const page = source.replace('</head>', '<style>' + shot.hide + '{display:none !important}</style></head>');
  const temp = path.join(dir, 'shot-tmp.html');
  fs.writeFileSync(temp, page);
  try {
    // DPR 2 keeps 1rpx at exactly one physical pixel, matching a @2x phone hairline.
    execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=440,1060',
      '--screenshot=' + path.join(dir, shot.name),
      'file://' + temp
    ], { stdio: 'ignore' });
    console.log('wrote', shot.name);
  } finally {
    fs.unlinkSync(temp);
  }
}
