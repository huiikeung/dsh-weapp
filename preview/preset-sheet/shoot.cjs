// 预览会话设置页「Agent 预设」玻璃底部弹窗（深/浅色各一张）。
// 用法: node preview/preset-sheet/shoot.cjs
// 玻璃材质直接从 session-settings.wxss 抽取并把 rpx 折算成 px，避免预览与实现脱节；
// 弹窗骨架（底部对齐、根部抓手、底部添加入口）按 session-settings.wxss 的取值模仿。无第三方依赖。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/session-settings/session-settings.wxss'), 'utf8');
// 从锚点玻璃菜单段开始抽取：包含 picker-pop 行样式、玻璃预设底部弹窗与浅色主题覆盖。
const marker = '/* ---------- 选择弹层：与首页工作区选择同款的锚点玻璃弹窗';
const start = wxss.indexOf(marker);
if (start < 0) throw new Error('session-settings picker styles not found');
const sheetCss = wxss.slice(start, wxss.indexOf('/* ---------- 设置页卡片')).replace(/(\d+(?:\.\d+)?)rpx/g, (_, value) => {
  const px = Number(value) / 2;
  return (Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')) + 'px';
});

const icon = file => '../../miniprogram/assets/icons/' + file;
const presets = [
  { name: '标准模式', desc: '通用任务，工具与提示词按默认配置', checked: false },
  { name: '编程', desc: '用于编码工作', checked: true },
  { name: '最小模式', desc: '只保留最少的工具与提示词', checked: false },
  { name: '创造模式', desc: '新建创造模式会话，让 Agent 创建或维护预设', checked: false }
];

function stage(theme) {
  const rows = presets.map(preset => `
          <div class="picker-pop-row picker-pop-preset ${preset.checked ? 'checked' : ''}">
            <img class="picker-pop-ic" src="${icon(preset.checked ? 'check-fill-white.png' : 'circle-white.png')}">
            <div class="picker-pop-body">
              <span class="picker-pop-name">${preset.name}</span>
              <span class="picker-pop-desc">${preset.desc}</span>
            </div>
          </div>`).join('');
  return `
  <section class="stage theme-${theme}">
    <div class="page">
      <div class="nav">会话设置</div>
      <div class="group-title">新会话默认配置</div>
      <div class="card">
        <div class="card-row"><span>Agent 预设</span><span class="row-value">编程 ›</span></div>
        <div class="card-row"><span>默认模型</span><span class="row-value">思考模型 · High ›</span></div>
        <div class="card-row"><span>权限</span><span class="row-value">工作区写入 ›</span></div>
      </div>
      <div class="group-hint">与 WebUI 使用同一份部署级设置。</div>
    </div>
    <div class="pair-sheet-mask">
      <div class="picker-glass-sheet" style="max-height: 703px;">
        <div class="sheet-grabber-zone"><div class="sheet-grabber"></div></div>
        <div class="pair-sheet-head">
          <span class="pair-sheet-title">Agent 预设</span>
          <div class="pair-sheet-close"><div class="sheet-close-x"></div></div>
        </div>
        <div class="picker-sheet-scroll">
          <div class="picker-pop-content">
            <div class="picker-sheet-hint">预设决定 Agent 使用的工具、提示词与能力。选择后只对新建会话生效。</div>${rows}
          </div>
        </div>
        <div class="picker-sheet-footer">
          <div class="picker-pop-divider"></div>
          <div class="picker-pop-row">
            <img class="picker-pop-ic" src="${icon('plus-white.png')}">
            <div class="picker-pop-body">
              <span class="picker-pop-name">添加自定义 Agent 预设</span>
              <span class="picker-pop-desc">新建创造模式会话，让 Agent 创建或维护预设</span>
            </div>
          </div>
        </div>
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
      '--window-size=470,900',
      '--screenshot=' + path.join(dir, 'preview-' + theme + '.png'),
      'file://' + temp
    ], { stdio: 'ignore' });
    console.log('wrote preview-' + theme + '.png');
  } finally {
    fs.unlinkSync(temp);
  }
}
