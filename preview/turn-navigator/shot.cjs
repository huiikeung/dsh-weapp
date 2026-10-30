// 三横线「对话节点定位」预览：node preview/turn-navigator/shot.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const css = fs.readFileSync(path.join(root, 'miniprogram/pages/session/session.wxss'), 'utf8');
const keywords = ['turn-overlay', 'turn-scrub', 'turn-nav', 'turn-history-status'];
const blocks = [];
const re = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1].trim();
  if (sel.indexOf('@') >= 0) continue;
  if (keywords.some((k) => sel.indexOf(k) >= 0)) blocks.push(sel + '{' + m[2] + '}');
}
const rpx = (s) => s.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const overlayCss = rpx(blocks.join('\n'));

const row = (title, active) => '<div class="turn-scrub-row' + (active ? ' active' : '') + '">'
  + '<div class="turn-scrub-row-copy"><span class="turn-scrub-row-title">' + title + '</span></div>'
  + '<span class="turn-scrub-tick-slot"><span class="turn-scrub-tick"></span></span></div>';

const stage = (theme) => '<div class="stage theme-' + theme + ' session-glass' + '">'
  + '<div class="convo">'
  + '<div class="bubble user">帮我把设置页外观重做一下</div>'
  + '<div class="bubble bot">已换成磨砂材质，浅色加了一层柔光。</div>'
  + '<div class="bubble user">再做一版深色，不要加光</div>'
  + '<div class="bubble bot">深色已回到第一版中性暗底 + 细描边。</div>'
  + '</div>'
  + '<div class="turn-overlay"><div class="turn-overlay-glass"></div>'
  + '<div class="turn-overlay-inner"><div class="turn-scrub-body">'
  + '<div class="turn-history-status">全部历史 · 4</div>'
  + '<div class="turn-scrub-list">'
  + row('设置页外观重做', false)
  + row('统一磨砂材质', false)
  + row('深色回到第一版', true)
  + row('协作弹层宽高', false)
  + '</div></div></div></div></div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:18px}"
  + '.row{display:flex;gap:20px}'
  + '.stage{position:relative;width:390px;height:700px;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.theme-dark{--text:#F1F4FA;--text-2:rgba(241,244,250,.62);--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1}'
  + '.theme-light{--text:#10131A;--text-2:rgba(16,19,24,.62);--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1}'
  + '.theme-dark .convo{position:absolute;inset:0;padding:60px 18px;display:flex;flex-direction:column;gap:14px;background:radial-gradient(120% 70% at 50% 0%,#0d1b33 0%,#05070c 65%)}'
  + '.theme-light .convo{position:absolute;inset:0;padding:60px 18px;display:flex;flex-direction:column;gap:14px;background:linear-gradient(180deg,#FFFFFF,#F4F6F9)}'
  + '.bubble{max-width:78%;padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.5}'
  + '.theme-dark .bubble.user{align-self:flex-end;background:rgba(46,107,230,.85);color:#fff}'
  + '.theme-dark .bubble.bot{align-self:flex-start;background:rgba(255,255,255,.10);color:#F1F4FA}'
  + '.theme-light .bubble.user{align-self:flex-end;background:#2E6BE6;color:#fff}'
  + '.theme-light .bubble.bot{align-self:flex-start;background:#EEF1F5;color:#10131A}'
  + overlayCss
  + '.stage > .turn-overlay{position:absolute !important;inset:0 !important;z-index:2}'
  + '</style></head><body><div class="row">'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">节点定位 · 玻璃</div>' + stage('dark') + '</div>'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">节点定位 · 浅色页面 + 玻璃</div>' + stage('light') + '</div>'
  + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=860,760', '--screenshot=' + path.join(dir, 'turn-navigator.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote turn-navigator.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }