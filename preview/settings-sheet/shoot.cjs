// 预览设置页「公网访问」底部弹窗的新玻璃背景（深/浅色各一张）。
// 用法: node preview/settings-sheet/shoot.cjs
// 玻璃样式直接从 settings.wxss 抽取并把 rpx 折算成 px，避免预览与实现脱节；
// 弹窗骨架（底部对齐、顶部圆角、抓手）按 settings.wxss 的取值模仿。无第三方依赖。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.wxss'), 'utf8');
// 玻璃卡片 / 弹窗材质在共用的 styles/glass-ui.wxss；选择菜单在 settings.wxss。
const glassCss = fs.readFileSync(path.join(root, 'miniprogram/styles/glass-ui.wxss'), 'utf8');
const choiceCss = ''; // 选择弹窗样式已并入 styles/glass-ui.wxss
const sheetCss = (choiceCss + '\n' + glassCss).replace(/(\d+(?:\.\d+)?)rpx/g, (_, value) => {
  const px = Number(value) / 2;
  return (Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')) + 'px';
});

const icon = file => '../../miniprogram/assets/icons/' + file;

function stage(theme) {
  return `
  <section class="stage theme-${theme}">
    <div class="page">
      <div class="nav">设置</div>
      <div class="group-title">连接</div>
      <div class="card settings-glass-card">
        <div class="card-row"><span>公网访问</span><span class="row-value">2026-11-05 ›</span></div>
        <div class="card-row"><span>节点管理</span><span class="row-value">2 个 ›</span></div>
      </div>
      <div class="settings-choice" style="left: 24px; top: 720px; width: 243px; height: 188px; z-index: 300;">
        <div class="settings-choice-content">
          <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">标准</span></div>
          <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/check-fill-white.png"><span class="settings-choice-label">简洁</span></div>
          <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">详细</span></div>
          <div class="settings-choice-row"><img class="settings-choice-ic" src="../../miniprogram/assets/icons/circle-white.png"><span class="settings-choice-label">完全展开</span></div>
        </div>
      </div>
      <div class="group-title">外观</div><div class="card settings-glass-card"><div class="card-row"><span>玻璃UI样式</span><span class="row-value">已开启</span></div><div class="card-row"><span>底部弹窗</span><span class="row-value">已开启</span></div><div class="card-row glass-alpha-row"><span>玻璃透明度</span><div class="glass-alpha-control"><span class="glass-alpha-fake-track"><span class="glass-alpha-fake-fill" style="width: 17%"></span><span class="glass-alpha-fake-knob" style="left: 17%"></span></span><span class="glass-alpha-value">10%</span></div></div><div class="card-row glass-alpha-row"><span>玻璃模糊</span><div class="glass-alpha-control"><span class="glass-alpha-fake-track"><span class="glass-alpha-fake-fill" style="width: 33%"></span><span class="glass-alpha-fake-knob" style="left: 33%"></span></span><span class="glass-alpha-value">8rpx</span></div></div><div class="card-row glass-alpha-row"><span>玻璃亮边</span><div class="glass-alpha-control"><span class="glass-alpha-fake-track"><span class="glass-alpha-fake-fill" style="width: 47%"></span><span class="glass-alpha-fake-knob" style="left: 47%"></span></span><span class="glass-alpha-value">38%</span></div></div><div class="card-row glass-alpha-row"><span>玻璃圆角</span><div class="glass-alpha-control"><span class="glass-alpha-fake-track"><span class="glass-alpha-fake-fill" style="width: 60%"></span><span class="glass-alpha-fake-knob" style="left: 60%"></span></span><span class="glass-alpha-value">32rpx</span></div></div></div>
      <div class="group-title">对话</div>
      <div class="card settings-glass-card">
        <div class="card-row"><span>语音输入</span><span class="row-value">已开启</span></div>
        <div class="card-row"><span>工作步骤展示</span><span class="row-value">标准 ›</span></div>
      </div>
    </div>
    <div class="pair-sheet-mask">
      <div class="pair-sheet management-sheet management-sheet-glass" style="height: 62vh;">
        <div class="sheet-grabber-zone"><div class="sheet-grabber"></div></div>
        <div class="pair-sheet-head">
          <div>
            <span class="pair-sheet-title">公网访问</span>
            <span class="pair-sheet-subtitle">管理当前微信账号的公网有效期</span>
          </div>
          <div class="pair-sheet-close"><div class="close-x"></div></div>
        </div>
        <div class="card public-card">
          <div class="public-head">
            <img class="public-icon" src="${icon('node-router.svg')}">
            <div>
              <span class="public-title">公网访问已开启</span>
              <span class="public-sub">外网可经中继访问这台设备</span>
            </div>
          </div>
          <div class="public-detail-row"><span class="public-detail-label">访问状态</span><span class="public-pill"><span class="public-pill-dot"></span>已授权</span></div>
          <div class="public-detail-row"><span class="public-detail-label">设备 ID</span><span class="public-detail-value text-mono">7f3a9c2d</span></div>
          <div class="public-detail-row"><span class="public-detail-label">访问有效期</span><span class="public-detail-value">2026-11-05 23:59</span></div>
          <div class="public-actions">
            <button class="public-share">分享</button>
            <button class="public-redeem">兑换续期</button>
          </div>
        </div>
        <div class="group-hint">公网访问只分享服务、不分享设备权限；关闭后外网入口立即失效。</div>
      </div>
    </div>
  </section>`;
}

const sliderCss = ".glass-alpha-row { align-items: center; } .glass-alpha-control { display: flex; align-items: center; gap: 8px; flex: 1; max-width: 58%; } .glass-alpha-fake-track { position: relative; flex: 1; height: 4px; border-radius: 2px; background: rgba(150,150,155,.35); } .glass-alpha-fake-fill { position: absolute; inset: 0 auto 0 0; border-radius: 2px; background: currentColor; } .glass-alpha-fake-knob { position: absolute; top: 50%; width: 11px; height: 11px; border-radius: 50%; background: currentColor; transform: translate(-50%, -50%); } .glass-alpha-value { min-width: 44px; text-align: right; font-size: 12px; opacity: .72; font-variant-numeric: tabular-nums; }";
const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('/*__SHEET_CSS__*/', sheetCss + '\n' + sliderCss);

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

for (const theme of ['dark', 'light']) {
  const page = shell.replace('__STAGES__', stage(theme));
  const temp = path.join(dir, 'shot-tmp.html');
  fs.writeFileSync(temp, page);
  try {
    execFileSync(browser, [
      '--headless=new', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=452,900',
      '--screenshot=' + path.join(dir, 'preview-' + theme + '.png'),
      'file://' + temp
    ], { stdio: 'ignore' });
    console.log('wrote preview-' + theme + '.png');
  } finally {
    fs.unlinkSync(temp);
  }
}
