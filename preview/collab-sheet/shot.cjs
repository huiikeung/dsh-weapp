// 协作详情浮层预览：node preview/collab-sheet/shot.cjs
// 读 session.wxss 真实规则渲染；内容结构保持原样，仅宽/离底距离参考首页「切换主机」弹窗。
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
  if (sel === '.sheet' || sel.indexOf('collab') >= 0 || sel === '.sheet-handle') blocks.push(sel + '{' + m[2] + '}');
}
const rpx = (s) => s.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const sheetCss = rpx(blocks.join('\n'));

const row = (title, sub, status, meta, current) => '<div class="collab-row' + (current ? ' current' : '') + '">'
  + '<span class="collab-state ' + status + '"></span>'
  + '<span class="collab-row-copy"><span class="collab-row-title">' + title + '</span><span class="collab-subtitle">' + sub + '</span></span>'
  + '<span class="collab-row-meta"><span class="collab-status">' + meta + '</span></span>'
  + '<span class="collab-chevron"></span></div>';

const tabs = '<div class="collab-tabs"><div class="collab-tabs-track">'
  + '<div class="collab-tab active"><span class="collab-tab-summary"><span class="collab-tab-count">2</span></span><span class="collab-tab-label">成员</span><span class="collab-tab-indicator"></span></div>'
  + '<div class="collab-tab"><span class="collab-tab-summary"><span class="collab-tab-count">3</span></span><span class="collab-tab-label">任务</span></div>'
  + '<div class="collab-tab"><span class="collab-tab-summary"><span class="collab-tab-count">1</span></span><span class="collab-tab-label">子智能体</span></div>'
  + '<div class="collab-tab"><span class="collab-tab-summary"><span class="collab-tab-count">0</span></span><span class="collab-tab-label">通讯</span></div>'
  + '</div></div>';

const stage = (theme) => '<div class="stage theme-' + theme + ' session-glass"><div class="bg"></div><div class="mask"></div>'
  + '<div class="sheet collab-sheet">'
  + '<div class="collab-resize-handle"><span class="sheet-handle"></span></div>'
  + '<div class="collab-heading"><span class="collab-title">协作</span>'
  + '<div class="collab-mode"><span class="collab-mode-text">默认 · Harness</span></div>'
  + '<div class="collab-action collab-refresh online is-running"><span class="collab-action-disc"><span class="collab-breathe"><span class="collab-breathe-dot"></span><span class="collab-breathe-halo"></span></span></span></div>'
  + '<div class="collab-action collab-close"><span class="collab-action-disc"><span class="collab-action-icon">✕</span></span></div>'
  + '</div>'
  + tabs
  + '<div class="collab-scroll"><div class="collab-list">'
  + row('lead', '主智能体 · 当前会话', 'running', '运行中', true)
  + row('designer', '视觉与交互 · 空闲', 'done', '空闲', false)
  + row('reviewer', '代码审查 · 进行中', 'pending', '空闲', false)
  + row('writer', '文案整理 · 已阻塞', 'failed', '空闲', false)
  + '</div></div>'
  + '</div></div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:18px}"
  + '.row{display:flex;gap:20px}'
  + '.stage{position:relative;width:390px;height:700px;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.theme-dark{--surface:#1C1C1E;--fill:rgba(255,255,255,.06);--fill-2:rgba(255,255,255,.10);--border:rgba(255,255,255,.10);--border-strong:rgba(255,255,255,.16);--divider:rgba(255,255,255,.08);--text:#F1F4FA;--text-2:rgba(241,244,250,.62);--text-3:rgba(241,244,250,.55);--text-4:rgba(241,244,250,.45);--ink:#F1F4FA;--success:#2EB85C;--bg:#000;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1;--glass-radius-sheet:16.6px;--card-dark-fill:.62;--card-light-fill:.86;--card-light-glow-top:.5;--card-light-glow-bottom:.35;--card-light-glow-all:.3;--card-light-edge:rgba(255,255,255,.114);--card-light-float:0 1px 4px rgba(7,24,43,.035)}'
  + '.theme-light{--surface:#FFFFFF;--fill:rgba(16,19,24,.05);--fill-2:rgba(16,19,24,.07);--border:rgba(16,19,24,.10);--border-strong:rgba(16,19,24,.16);--divider:rgba(16,19,24,.08);--text:#10131A;--text-2:rgba(16,19,24,.62);--text-3:rgba(16,19,24,.55);--text-4:rgba(16,19,24,.45);--ink:#10131A;--success:#2EB85C;--bg:#FFFFFF;--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-blur:20px;--glass-frost-edge:.114;--glass-backdrop-brightness:1;--glass-radius-sheet:16.6px;--card-dark-fill:.62;--card-light-fill:.86;--card-light-glow-top:.5;--card-light-glow-bottom:.35;--card-light-glow-all:.3;--card-light-edge:rgba(255,255,255,.114);--card-light-float:0 1px 4px rgba(7,24,43,.035)}'
  + '.theme-dark .bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 0%,#0d1b33 0%,#05070c 65%)}'
  + '.theme-light .bg{position:absolute;inset:0;background:linear-gradient(180deg,#FFFFFF,#FAFBFC)}'
  + '.mask{position:absolute;inset:0;background:rgba(0,0,0,.42)}'
  + '.collab-chevron{width:7px;height:7px;border-right:1.4px solid var(--text-3);border-top:1.4px solid var(--text-3);transform:rotate(45deg);flex:none;margin-left:4px}'
  + '.collab-action-icon{display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--text);width:auto;height:auto}'
  + sheetCss
  + '.sheet.collab-sheet{position:absolute !important;left:12px;right:12px;bottom:24px;width:auto !important;margin:0 !important;height:520px;max-height:none}'
  + '.collab-scroll{overflow-y:auto;overflow-x:hidden}'
  + '</style></head><body><div class="row">'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">协作详情 · 深色</div>' + stage('dark') + '</div>'
  + '<div><div style="font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px">协作详情 · 浅色</div>' + stage('light') + '</div>'
  + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=860,760', '--screenshot=' + path.join(dir, 'collab-sheet.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote collab-sheet.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }
