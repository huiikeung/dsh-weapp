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
const marker = '/* ---------- 公网访问弹窗：背景沿用首页工作区选择弹窗的玻璃材质（仍是底部弹窗） ---------- */';
const start = wxss.indexOf(marker);
if (start < 0) throw new Error('public access sheet glass styles not found in settings.wxss');
const sheetCss = wxss.slice(start).replace(/(\d+(?:\.\d+)?)rpx/g, (_, value) => {
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
      <div class="card">
        <div class="card-row"><span>公网访问</span><span class="row-value">2026-11-05 ›</span></div>
        <div class="card-row"><span>节点管理</span><span class="row-value">2 个 ›</span></div>
      </div>
      <div class="group-title">对话</div>
      <div class="card">
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

const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('/*__SHEET_CSS__*/', sheetCss);

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
