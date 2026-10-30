// 回到底部圆钮预览：node preview/jump-button/shot.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const css = fs.readFileSync(path.join(root, 'miniprogram/pages/session/session.wxss'), 'utf8');
const blocks = [];
const re = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1].trim();
  if (sel.indexOf('@') >= 0) continue;
  if (sel.indexOf('jump') >= 0) blocks.push(sel + '{' + m[2] + '}');
}
const rpx = (s) => s.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const jumpCss = rpx(blocks.join('\n'));

const assets = (name) => 'file://' + path.join(root, 'miniprogram/assets/icons', name);
const button = (variant) => '<div class="jump-wrap"><div class="jump-bottom">'
  + '<img class="jump-ic" src="' + assets(variant === 'light' ? 'arrow-down-dark.png' : 'arrow-down-light.png') + '"/>'
  + '</div></div>';

const stage = (theme) => '<div class="stage theme-' + theme + ' session-glass">'
  + '<div class="bg"></div>'
  + '<div class="label">' + (theme === 'dark' ? '深色' : '浅色') + '</div>'
  + '<div class="dock">' + button(theme) + '</div>'
  + '</div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:18px}"
  + '.row{display:flex;gap:24px}'
  + '.stage{position:relative;width:260px;height:260px;border-radius:22px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.theme-dark{--text:#F1F4FA;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1;--card-dark-fill:.62;--card-light-fill:.86;--card-light-glow-top:.5;--card-light-glow-bottom:.35;--card-light-glow-all:.3;--card-light-edge:rgba(255,255,255,.114);--card-light-float:0 1px 4px rgba(7,24,43,.035)}'
  + '.theme-light{--text:#10131A;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1;--card-dark-fill:.62;--card-light-fill:.86;--card-light-glow-top:.5;--card-light-glow-bottom:.35;--card-light-glow-all:.3;--card-light-edge:rgba(255,255,255,.114);--card-light-float:0 1px 4px rgba(7,24,43,.035)}'
  + '.theme-dark .bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 0%,#0d1b33 0%,#05070c 65%)}'
  + '.theme-light .bg{position:absolute;inset:0;background:linear-gradient(180deg,#FFFFFF,#FAFBFC)}'
  + '.label{position:absolute;left:14px;top:12px;font-size:12px;color:rgba(255,255,255,.55)}'
  + '.theme-light .label{color:rgba(16,19,24,.55)}'
  + '.dock{position:absolute;left:14px;right:14px;bottom:14px;height:110px;border-radius:18px;background:rgba(255,255,255,.06);padding:0 12px;box-sizing:border-box;display:flex;justify-content:flex-end;align-items:flex-start}'
  + '.theme-light .dock{background:rgba(16,19,24,.05)}'
  + '.jump-ic{width:32px;height:32px;display:block}'
  + jumpCss
  + '</style></head><body><div class="row">' + stage('dark') + stage('light') + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=620,330', '--allow-file-access-from-files', '--screenshot=' + path.join(dir, 'jump-button.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote jump-button.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }