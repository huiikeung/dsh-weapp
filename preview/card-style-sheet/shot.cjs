// 卡片样式设置弹窗预览：node preview/card-style-sheet/shot.cjs
// 读取 settings.wxss 真实规则渲染，检查新增「底色 / 柔光」两根滑杆后弹窗高度与预览卡片。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const css = fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.wxss'), 'utf8');

const keywords = ['glass-style-sheet', 'glass-style-head', 'glass-style-title', 'glass-style-actions', 'glass-style-reset', 'glass-style-done',
  'glass-alpha-row', 'glass-alpha-control', 'glass-style-label', 'glass-alpha-value', 'card-preview', 'sheet-grabber'];
const blocks = [];
const re = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1].trim();
  if (sel.indexOf('@') >= 0) continue;
  if (keywords.some((k) => sel.indexOf(k) >= 0)) blocks.push(sel + '{' + m[2] + '}');
}
const rpx = (s) => s.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const sheetCss = rpx(blocks.join('\n'));

const row = (label, pct, value) => '<div class="glass-alpha-row"><span class="glass-style-label">' + label + '</span>'
  + '<div class="glass-alpha-control"><span class="track"><span class="fill" style="width:' + pct + '%"></span><span class="knob" style="left:' + pct + '%"></span></span>'
  + '<span class="glass-alpha-value">' + value + '</span></div></div>';

const sheet = (theme, mode) => '<div class="stage ' + theme + '"><div class="page-bg"></div><div class="mask"></div>'
  + '<div class="glass-style-sheet">'
  + '<span class="grabber"></span>'
  + '<div class="glass-style-head"><span class="glass-style-title">卡片样式设置</span>'
  + '<span class="glass-style-actions"><span class="glass-style-reset">重置为默认</span><span class="glass-style-done">完成</span></span></div>'
  + '<div class="mode-tabs"><span class="' + (mode === 'light' ? 'on' : '') + '">浅色</span><span class="' + (mode === 'dark' ? 'on' : '') + '">深色</span></div>'
  + (mode === 'light'
    ? '<div class="card-preview-stage plain"><div class="card-preview-card" style="border-radius:36rpx;background:rgba(126,142,168,.34);box-shadow:inset 0 6px 16px rgba(255,255,255,.5),inset 0 -6px 16px rgba(255,255,255,.35),inset 0 0 22px rgba(255,255,255,.3),inset 0 0 0 1px rgba(255,255,255,.34),0 4px 16px rgba(7,24,43,.14);">'
      + '<span class="card-preview-dot"></span><span class="card-preview-copy"><span class="card-preview-title">预览</span><span class="card-preview-sub">悬浮 20 · 底色 86 · 光线 20 · 柔光 50 · 描边 38 · 圆角 36rpx</span></span></div></div>'
      + row('悬浮', 20, '20%') + row('底色', 86, '86%') + row('光线', 33, '20%') + row('柔光', 50, '50%') + row('描边', 47, '38%') + row('圆角', 60, '36rpx')
    : '<div class="card-preview-stage plain"><div class="card-preview-card" style="border-radius:36rpx;background:rgba(44,45,49,.62);box-shadow:inset 0 0 0 1px rgba(255,255,255,.34),0 4px 16px rgba(7,24,43,.14);">'
      + '<span class="card-preview-dot"></span><span class="card-preview-copy"><span class="card-preview-title">预览</span><span class="card-preview-sub">悬浮 20 · 底色 62 · 描边 38 · 圆角 36rpx</span></span></div></div>'
      + row('悬浮', 20, '20%') + row('底色', 62, '62%') + row('描边', 47, '38%') + row('圆角', 60, '36rpx'))
  + '</div></div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:18px}"
  + '.row{display:flex;gap:20px}'
  + '.stage{position:relative;width:390px;height:700px;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.light{--surface:#FFFFFF;--fill:rgba(16,19,24,.05);--fill-2:rgba(16,19,24,.07);--border:rgba(16,19,24,.10);--text:#10131A;--text-2:rgba(16,19,24,.62);--bg:#F2F2F7;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-edge-alpha:.114;--glass-radius-sheet:26px;--glass-radius-card:28px;--glass-backdrop-brightness:1}'
  + '.dark{--surface:#1C1C1E;--fill:rgba(255,255,255,.06);--fill-2:rgba(255,255,255,.10);--border:rgba(255,255,255,.10);--text:#F1F4FA;--text-2:rgba(241,244,250,.62);--bg:#000;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-edge-alpha:.114;--glass-radius-sheet:26px;--glass-radius-card:28px;--glass-backdrop-brightness:1}'
  + '.light .page-bg{position:absolute;inset:0;background:#F2F2F7}'
  + '.dark .page-bg{position:absolute;inset:0;background:#000}'
  + '.mask{position:absolute;inset:0;background:rgba(0,0,0,.42)}'
  + '.mode-tabs{display:flex;gap:4px;margin:4px 20px 2px;padding:2px;border-radius:8px;background:var(--fill)}'
  + '.mode-tabs span{flex:1;text-align:center;min-height:32px;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:13px;color:var(--text-2)}'
  + '.mode-tabs span.on{background:var(--surface);color:var(--text);font-weight:600}'
  + '.grabber{display:block;width:34px;height:4px;border-radius:2px;margin:5px auto 2px;background:var(--fill-2)}'
  + '.glass-alpha-control{display:flex;align-items:center;gap:8px;width:58%}'
  + '.track{position:relative;flex:1;height:4px;border-radius:2px;background:rgba(150,150,155,.35)}'
  + '.fill{position:absolute;inset:0 auto 0 0;border-radius:2px;background:var(--text)}'
  + '.knob{position:absolute;top:50%;width:11px;height:11px;border-radius:50%;background:var(--text);transform:translate(-50%,-50%)}'
  + '.card-preview-stage{margin:6px 20px 10px;padding:12px 10px 5px;border-radius:11px;background:transparent;display:flex}'
  + '.card-preview-card{display:flex;align-items:center;gap:8px;min-height:50px;padding:13px 12px;width:100%;box-sizing:border-box}'
  + '.card-preview-dot{width:15px;height:15px;border-radius:50%;background:var(--text-2);opacity:.5;flex:none}'
  + '.card-preview-copy{display:flex;flex-direction:column;gap:2px;min-width:0}'
  + '.card-preview-title{font-size:13px;color:var(--text)}'
  + '.card-preview-sub{font-size:11px;color:var(--text-2)}'
  + sheetCss
  + '.glass-style-sheet{position:absolute !important;left:12px;right:12px;bottom:24px}'
  + '</style></head><body><div class="row">'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">卡片样式设置 · 浅色页签</div>' + sheet('light', 'light') + '</div>'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">卡片样式设置 · 深色页签</div>' + sheet('dark', 'dark') + '</div>'
  + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=860,760', '--screenshot=' + path.join(dir, 'card-style-sheet.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote card-style-sheet.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }