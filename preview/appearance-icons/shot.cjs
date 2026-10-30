// 外观（界面）弹窗图标预览：node preview/appearance-icons/shot.cjs
// 直接读取小程序 settings.wxss 里的 .appearance-* 规则，按 750rpx 设计宽度换算成 px 渲染，
// 避免预览与真机样式脱节。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;
const root = path.resolve(dir, '..', '..');

const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.wxss'), 'utf8');
const start = wxss.indexOf('.appearance-options {');
const end = wxss.indexOf('/* ---------- 公网访问弹窗内的兑换表单');
if (start < 0 || end < 0) { console.error('appearance css block not found'); process.exit(1); }
const rpxToPx = (css) => css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const appearanceCss = rpxToPx(wxss.slice(start, end));

const modes = [
  { mode: 'auto', label: '跟随微信' },
  { mode: 'light', label: '浅色' },
  { mode: 'dark', label: '深色' }
];
const row = (m, selected) => '<div class="appearance-option' + (selected === m.mode ? ' selected' : '') + '">'
  + '<div class="appearance-option-icon"><div class="appearance-glyph appearance-glyph-' + m.mode + '"></div></div>'
  + '<span class="appearance-option-label">' + m.label + '</span>'
  + '<span class="appearance-option-check">' + (selected === m.mode ? '✓' : '') + '</span></div>';

const sheet = (theme, selected) => '<div class="stage ' + theme + '"><div class="page-bg"></div><div class="mask"></div>'
  + '<div class="sheet"><div class="grabber"></div>'
  + '<div class="head"><div><span class="title">外观</span><span class="subtitle">跟随微信</span></div><span class="close"></span></div>'
  + '<div class="appearance-options">' + modes.map((m) => row(m, selected)).join('') + '</div>'
  + '</div></div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:20px}"
  + '.row{display:flex;gap:20px}.col{display:flex;flex-direction:column}'
  + '.caption{font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px}'
  + '.stage{position:relative;width:390px;height:520px;border-radius:26px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.light{--surface:#FFFFFF;--fill:rgba(16,19,24,.05);--fill-2:rgba(16,19,24,.07);--border:rgba(16,19,24,.10);--text:#10131A;--text-2:rgba(16,19,24,.62);--ocean:#2E6BE6}'
  + '.dark{--surface:#1C1C1E;--fill:rgba(255,255,255,.06);--fill-2:rgba(255,255,255,.10);--border:rgba(255,255,255,.10);--text:#F1F4FA;--text-2:rgba(241,244,250,.62);--ocean:#4C6CE0}'
  + '.light .page-bg{position:absolute;inset:0;background:#F2F2F7}'
  + '.dark .page-bg{position:absolute;inset:0;background:#000}'
  + '.mask{position:absolute;inset:0;background:rgba(0,0,0,.42)}'
  + '.sheet{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;padding:5px 21px 18px;border-radius:17px 17px 0 0;background:var(--surface);color:var(--text)}'
  + '.grabber{width:34px;height:4px;border-radius:2px;margin:5px auto 2px;background:var(--fill-2)}'
  + '.head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 12px}'
  + '.head>div:first-child{flex:1;min-width:0}'
  + '.title{display:block;font-size:18px;font-weight:650}'
  + '.subtitle{display:block;margin-top:4px;font-size:12px;color:var(--text-2)}'
  + '.close{position:relative;width:32px;height:32px;border-radius:50%;background:var(--fill)}'
  + '.close::before,.close::after{content:"";position:absolute;left:50%;top:50%;width:12px;height:1.5px;background:var(--text-2);border-radius:1px}'
  + '.close::before{transform:translate(-50%,-50%) rotate(45deg)}'
  + '.close::after{transform:translate(-50%,-50%) rotate(-45deg)}'
  + appearanceCss
  + '</style></head><body><div class="row">'
  + '<div class="col"><div class="caption">外观弹窗 · 浅色</div>' + sheet('light', 'light') + '</div>'
  + '<div class="col"><div class="caption">外观弹窗 · 深色</div>' + sheet('dark', 'dark') + '</div>'
  + '<div class="col"><div class="caption">选中态（跟随微信）</div>' + sheet('light', 'auto') + '</div>'
  + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=1240,590', '--screenshot=' + path.join(dir, 'appearance-sheet.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote appearance-sheet.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }
