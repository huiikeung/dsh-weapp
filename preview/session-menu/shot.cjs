// 三个点「更多」弹层预览：node preview/session-menu/shot.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const css = fs.readFileSync(path.join(root, 'miniprogram/pages/session/session.wxss'), 'utf8');
const exact = new Set(['.sheet', '.sheet-handle', '.sheet-close-x', '.sheet-close-x::before', '.sheet-close-x::after', '.theme-dark .sheet-close-x::before', '.theme-dark .sheet-close-x::after']);
const blocks = [];
const re = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1].trim();
  if (sel.indexOf('@') >= 0) continue;
  if (exact.has(sel) || sel.indexOf('session-menu') >= 0) blocks.push(sel + '{' + m[2] + '}');
}
const rpx = (s) => s.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const menuCss = rpx(blocks.join('\n'));

const row = (icon, label, chevron) => '<div class="session-menu-row">'
  + '<span class="session-menu-icon">' + icon + '</span><span class="session-menu-label">' + label + '</span>'
  + (chevron ? '<span class="session-menu-chevron">›</span>' : '') + '</div>';

const stage = (theme) => '<div class="stage theme-' + theme + ' session-glass"><div class="bg"></div><div class="mask"></div>'
  + '<div class="sheet session-menu">'
  + '<div class="session-menu-grabber-zone"><div class="sheet-handle"></div></div>'
  + '<div class="session-menu-head"><div class="session-menu-heading"><span class="session-menu-title">更多</span></div>'
  + '<div class="session-menu-close"><div class="sheet-close-x"></div></div></div>'
  + '<div class="session-menu-scroll">'
  + '<div class="session-menu-group">'
  + row('✎', '重命名会话', true) + row('◷', '查看统计', true) + row('▤', '工作区文件', true)
  + '</div>'
  + '<div class="session-menu-group">'
  + row('✳', '浏览更多插件', true) + row('＋', '创建你的插件', true)
  + '</div>'
  + '<div class="session-menu-group">'
  + row('■', '取消当前回合', false) + row('▣', '归档会话', false)
  + '</div>'
  + '</div></div></div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:18px}"
  + '.row{display:flex;gap:20px}'
  + '.stage{position:relative;width:390px;height:720px;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.theme-dark{--surface:#1C1C1E;--fill:rgba(255,255,255,.06);--fill-2:rgba(255,255,255,.10);--border:rgba(255,255,255,.10);--border-strong:rgba(255,255,255,.16);--divider:rgba(255,255,255,.08);--text:#F1F4FA;--text-2:rgba(241,244,250,.62);--ink:#F1F4FA;--bg:#000;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1;--glass-radius-sheet:16.6px;--card-dark-fill:.62;--card-light-fill:.86}'
  + '.theme-light{--surface:#FFFFFF;--fill:rgba(16,19,24,.05);--fill-2:rgba(16,19,24,.07);--border:rgba(16,19,24,.10);--border-strong:rgba(16,19,24,.16);--divider:rgba(16,19,24,.08);--text:#10131A;--text-2:rgba(16,19,24,.62);--ink:#10131A;--bg:#FFFFFF;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1;--glass-radius-sheet:16.6px;--card-dark-fill:.62;--card-light-fill:.86}'
  + '.theme-dark .bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 0%,#0d1b33 0%,#05070c 65%)}'
  + '.theme-light .bg{position:absolute;inset:0;background:linear-gradient(180deg,#FFFFFF,#FAFBFC)}'
  + '.mask{position:absolute;inset:0;background:rgba(0,0,0,.42)}'
  + '.session-menu-icon{display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--text-2)}'
  + '.session-menu-chevron{display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--text-3)}'
  + menuCss
  + '.sheet.session-menu{position:absolute !important;left:12px;right:12px;bottom:24px;width:auto !important;margin:0 !important;height:auto;min-height:0;max-height:640px}'
  + '.session-menu-scroll{max-height:none;overflow-y:auto}'
  + '</style></head><body><div class="row">'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">更多 · 深色</div>' + stage('dark') + '</div>'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">更多 · 浅色</div>' + stage('light') + '</div>'
  + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=860,780', '--screenshot=' + path.join(dir, 'session-menu.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote session-menu.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }