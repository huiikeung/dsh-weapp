// 对话页底部输入栈预览：node preview/composer-glass/shot.cjs
// 直接读取 session.wxss 里输入框 / 任务卡 / 排队卡 / 目标卡 / 模式胶囊 / 模式浮层的真实规则，
// 按 750rpx 设计宽换算成 px 渲染，避免预览和真机漂移。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const css = fs.readFileSync(path.join(root, 'miniprogram/pages/session/session.wxss'), 'utf8');

const keywords = ['composer', 'preset-capsule', 'mode-pop', 'opt-pop', 'opt-row', 'opt-label', 'opt-desc',
  'task-panel', 'goal-panel', 'queue-panel', 'task-head', 'task-summary', 'task-list', 'task-row', 'task-content',
  'queue-head', 'queue-row', 'queue-lead', 'queue-preview', 'queue-status', 'goal-phase', 'goal-objective', 'jump-'];
const blocks = [];
const re = /([^{}]+)\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const selector = m[1].trim();
  if (selector.indexOf('@') >= 0) continue;
  if (keywords.some((k) => selector.indexOf(k) >= 0)) blocks.push(selector + '{' + m[2] + '}');
}
if (!blocks.length) { console.error('dock css not found'); process.exit(1); }
const rpxToPx = (s) => s.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => (Number(n) * 0.52).toFixed(2) + 'px');
const dockCss = rpxToPx(blocks.join('\n'));

const icons = {
  plus: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor"/></svg>',
  ring: '<svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="34 17" stroke-linecap="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="19" height="19"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 12.5l4.2 4.3L19 7" fill="none" stroke="#2E6BE6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const chat = '<div class="chat">'
  + '<div class="msg" style="background:var(--bubble)">把外观弹窗的图标重画一下，现在太丑了。</div>'
  + '<div class="msg me" style="background:var(--bubble-me)">已经换成太阳 / 月牙 / 对比圆，深浅色都适配了。</div>'
  + '<div class="msg" style="background:var(--bubble)">输入框、任务卡、队列、目标卡和模式弹窗都统一成这种 iOS 磨砂。</div>'
  + '</div>';

const stage = (theme) => '<div class="stage session-glass ' + (theme === 'dark' ? 'theme-dark' : 'theme-light') + '">'
  + '<div class="bg"></div>'
  + chat
  + '<div class="blob"></div>'
  + '<div class="dock"><div class="jump-wrap"><div class="jump-bottom"><span class="jump-ic">↓</span></div></div>'
  + '<div class="queue-panel">'
  + '<div class="queue-head"><span class="queue-head-title">排队消息</span><span class="queue-head-count">2</span></div>'
  + '<div class="queue-row"><div class="queue-lead">' + icons.spark + '</div><div class="queue-content"><span class="queue-preview">把设置页外观改成玻璃样式</span></div><span class="queue-status">发送中</span></div>'
  + '<div class="queue-row"><div class="queue-lead">' + icons.spark + '</div><div class="queue-content"><span class="queue-preview">输入框也照苹果那种磨砂来</span></div><span class="queue-status">排队</span></div>'
  + '</div>'
  + '<div class="task-panel">'
  + '<div class="task-head"><span class="task-head-title">任务</span><span class="task-summary">2 / 3 完成</span></div>'
  + '<div class="task-list">'
  + '<div class="task-row"><span class="task-content">重画外观弹窗图标</span></div>'
  + '<div class="task-row completed"><span class="task-content">统一输入框磨砂材质</span></div>'
  + '</div>'
  + '</div>'
  + '<div class="goal-panel"><span class="goal-phase">进行中</span><span class="goal-objective">把底部输入栈统一成 iOS 磨砂</span></div>'
  + '<div class="composer-top-row"><div class="preset-capsule"><span class="preset-capsule-text">默认 · Harness</span><span class="preset-capsule-chev">›</span></div></div>'
  + '<div class="composer-surface"><div class="composer">'
  + '<div class="ph">描述你想要构建的内容</div>'
  + '<div class="row"><span class="round">' + icons.plus + '</span><span class="mode">' + icons.spark + 'danger-full-ac…</span><span class="grow"></span><span class="dim">' + icons.spark + '</span><span class="dim">' + icons.ring + '</span><span class="send">' + icons.mic + '</span></div>'
  + '</div></div>'
  + '</div>'
  + '<div class="opt-pop mode-pop">'
  + '<div class="opt-row current"><div class="opt-main"><span class="opt-label">默认</span><span class="opt-desc">标准工具与提示词</span></div>' + icons.check + '</div>'
  + '<div class="opt-row"><div class="opt-main"><span class="opt-label">创造</span><span class="opt-desc">用于创建和维护预设</span></div></div>'
  + '<div class="opt-row"><div class="opt-main"><span class="opt-label">只读</span><span class="opt-desc">只能查看和分析</span></div></div>'
  + '</div>'
  + '</div>';

const page = '<!doctype html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0}'
  + "body{background:#0d1016;font-family:-apple-system,'PingFang SC',sans-serif;padding:20px}"
  + '.row{display:flex;gap:20px}.col{display:flex;flex-direction:column}'
  + '.cap{font-size:12px;color:rgba(255,255,255,.55);margin:0 2px 8px}'
  + '.stage{position:relative;width:390px;height:620px;border-radius:26px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}'
  + '.theme-dark{--surface:#1C1C1E;--fill:rgba(255,255,255,.06);--fill-2:rgba(255,255,255,.10);--border:rgba(255,255,255,.10);--border-strong:rgba(255,255,255,.16);--text:#F1F4FA;--text-2:rgba(241,244,250,.62);--ocean:#2E6BE6;--float-shadow:0 10px 30px rgba(0,0,0,.45);--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-edge:.114;--glass-frost-ink-edge:.046;--glass-frost-blur:20px;--glass-backdrop-brightness:1;--bg:#000;--card-light-float:0 1rpx 4rpx rgba(7,24,43,.035);--card-light-edge:rgba(255,255,255,.114);--card-light-fill:.86;--card-light-glow-top:.50;--card-light-glow-bottom:.35;--card-light-glow-all:.30;--card-light-radius:36rpx;--card-dark-float:0 1rpx 4rpx rgba(7,24,43,.035);--card-dark-edge:rgba(255,255,255,.114);--card-dark-fill:.62;--card-dark-radius:36rpx;--bubble:rgba(255,255,255,.08);--bubble-me:rgba(46,107,230,.30)}'
  + '.theme-light{--surface:#FFFFFF;--fill:rgba(16,19,24,.05);--fill-2:rgba(16,19,24,.07);--border:rgba(16,19,24,.10);--border-strong:rgba(16,19,24,.16);--text:#10131A;--text-2:rgba(16,19,24,.62);--ocean:#2E6BE6;--float-shadow:0 10px 30px rgba(7,24,43,.10);--glass-alpha-top:.04;--glass-alpha-bottom:.016;--glass-frost-edge:.114;--glass-frost-ink-edge:.046;--glass-frost-blur:20px;--glass-backdrop-brightness:1;--bg:#FFFFFF;--card-float:0 1rpx 4rpx rgba(7,24,43,.035);--card-edge:rgba(255,255,255,.114);--card-edge-ink:rgba(16,19,24,.046);--card-light:rgba(255,255,255,.02);--card-radius:36rpx;--bubble:rgba(16,19,24,.06);--bubble-me:rgba(46,107,230,.14)}'
  + '.theme-dark .bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 0%,#0d1b33 0%,#05070c 65%)}'
  + '.theme-light .bg{position:absolute;inset:0;background:linear-gradient(180deg,#FFFFFF,#FAFBFC)}'
  + '.chat{position:absolute;left:16px;right:16px;top:16px;display:flex;flex-direction:column;gap:8px;font-size:12px;line-height:1.5;color:var(--text)}'
  + '.chat .msg{max-width:80%;padding:8px 10px;border-radius:12px}'
  + '.chat .me{align-self:flex-end}'
  + '.blob{position:absolute;left:40px;right:40px;bottom:120px;height:180px;border-radius:24px;background:linear-gradient(135deg,rgba(46,107,230,.55),rgba(122,84,199,.45));filter:blur(6px);opacity:.8}'
  + '.dock{position:absolute;left:14px;right:14px;bottom:16px;display:flex;flex-direction:column;gap:6px}'
  + '.opt-pop{position:absolute;right:20px;bottom:300px;z-index:5;min-width:0;width:236px;max-width:236px;padding:6px;border-radius:16px}'
  + '.opt-row{padding:9px 10px;border-radius:10px;display:flex;align-items:center;gap:8px}'
  + '.opt-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}'
  + '.opt-label{font-size:14px;font-weight:500;color:var(--text)}'
  + '.opt-desc{font-size:11px;color:var(--text-2)}'
  + '.composer{padding:14px 14px 12px;border-radius:26px;color:var(--text)}'
  + '.composer-top-row{display:flex;align-items:center}'
  + '.composer-surface{position:relative}'
  + '.jump-ic{display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--text)}'
  + '.ph{font-size:14px;color:var(--text-2);padding:2px 2px 18px}'
  + '.row{display:flex;align-items:center;gap:8px}'
  + '.round{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.4px solid var(--text-2);color:var(--text-2);flex:none}'
  + '.mode{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-2)}'
  + '.grow{flex:1}'
  + '.dim{display:flex;align-items:center;justify-content:center;color:var(--text-2);opacity:.8}'
  + '.send{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--ocean);color:#fff;flex:none}'
  + '.queue-panel{padding:2px 0;border-radius:18.7px}'
  + '.queue-head{display:flex;align-items:center;gap:10px;padding:4px 12px;height:auto;font-size:13px;color:var(--text)}'
  + '.queue-row{display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:12px;color:var(--text-2)}'
  + '.queue-content{flex:1;min-width:0}'
  + '.queue-preview{font-size:12px;color:var(--text-2)}'
  + '.queue-status{font-size:11px;color:var(--text-2)}'
  + '.task-panel{border-radius:18.7px;padding:4px 0 8px}'
  + '.task-head{display:flex;align-items:center;gap:8px;padding:0 14px;min-height:auto;font-size:14px;color:var(--text)}'
  + '.task-summary{font-size:12px;color:var(--text-2)}'
  + '.task-list{padding:2px 14px 6px}'
  + '.task-row{padding:3px 0;font-size:12px;color:var(--text)}'
  + '.completed .task-content{color:var(--text-2)}'
  + '.goal-panel{display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:18.7px;font-size:13px;color:var(--text)}'
  + '.goal-phase{color:var(--text-2);font-size:12px}'
  + '.goal-objective{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.preset-capsule{display:flex;align-items:center;height:34px;padding:0 12px;border-radius:16px;font-size:14px;color:var(--text)}'
  + '.preset-capsule-text{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.preset-capsule-chev{margin-left:8px;opacity:.4}'
  + dockCss
  + '</style></head><body><div class="row">'
  + '<div class="col"><div class="cap">输入栈 · 深色</div>' + stage('dark') + '</div>'
  + '<div class="col"><div class="cap">输入栈 · 浅色</div>' + stage('light') + '</div>'
  + '</div></body></html>';

fs.writeFileSync(path.join(dir, 'shot.html'), page);
const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium'].find((p) => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }
try {
  execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=860,700', '--screenshot=' + path.join(dir, 'composer-glass.png'), 'file://' + path.join(dir, 'shot.html')], { stdio: 'ignore' });
  console.log('wrote composer-glass.png');
} finally { fs.unlinkSync(path.join(dir, 'shot.html')); }