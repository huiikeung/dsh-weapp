// 预览会话设置的选择弹层（预设 / 模型 / 权限 / 诊断 / 清理缓存），深色为主 + 预设与缓存的浅色。
// 用法: node preview/picker-popover/shoot.cjs
// 弹层样式直接从 session-settings.wxss 抽取并把 rpx 折算成 px，避免预览与实现脱节；
// 宽度/高度上限用页面同一个 pickerPopoverLayout 计算，纵向位置由页面内脚本按锚点行实测，避免模仿页排版误差。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pickerPopoverLayout } = require('../../miniprogram/pages/session-settings/utils/picker-popover');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/session-settings/session-settings.wxss'), 'utf8');
const marker = '/* ---------- 选择弹层：与首页工作区选择同款的锚点玻璃弹窗 ----------';
const start = wxss.indexOf(marker);
if (start < 0) throw new Error('picker popover styles not found in session-settings.wxss');
const popoverCss = wxss.slice(start).replace(/(\d+(?:\.\d+)?)rpx/g, (_, value) => {
  const px = Number(value) / 2;
  return (Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')) + 'px';
});

// 390×844、状态栏 47、胶囊行 32 → 导航下沿 93。纵向位置由页面内脚本实测锚点行后写入。
const windowInfo = { windowWidth: 390, windowHeight: 844, statusBarHeight: 47, safeArea: { bottom: 810 } };
const navBottom = 93;
const anchors = {
  preset: { left: 20, top: 129, width: 350, height: 53 },
  model: { left: 20, top: 182, width: 350, height: 53 },
  permission: { left: 20, top: 235, width: 350, height: 53 },
  diagnostics: { left: 20, top: 380, width: 350, height: 53 },
  cache: { left: 20, top: 433, width: 350, height: 53 }
};
const icon = file => '../../miniprogram/assets/icons/' + file;

const presetRows = [
  { file: 'check-fill-white.png', name: '标准模式', desc: '功能完整的编码 Agent，支持文件编辑、Shell、检索、Skills、计划与工作流。', checked: true },
  { file: 'circle-white.png', name: 'PTC 模式', desc: '通过 Code Mode SDK 组合多步工具操作。' },
  { file: 'circle-white.png', name: '极简模式', desc: '精简工具集合，适合轻量、直接的编码任务。' },
  { file: 'circle-white.png', name: '创造模式', desc: '用于创建和维护自定义 Agent 预设。' }
].map(item => `        <div class="picker-pop-row picker-pop-preset ${item.checked ? 'checked' : ''}">
          <img class="picker-pop-ic" src="${icon(item.file)}">
          <div class="picker-pop-body">
            <span class="picker-pop-name">${item.name}</span>
            <span class="picker-pop-desc">${item.desc}</span>
          </div>
        </div>`).join('') + `
        <div class="picker-pop-divider"></div>
        <div class="picker-pop-row">
          <img class="picker-pop-ic" src="${icon('plus-white.png')}">
          <div class="picker-pop-body">
            <span class="picker-pop-name">添加自定义 Agent 预设</span>
            <span class="picker-pop-desc">新建创造模式会话，让 Agent 创建或维护预设</span>
          </div>
        </div>`;

const modelRows = [
  { group: 'DeepSeek 账号' },
  { name: 'DeepSeek V4', suffix: 'Max', checked: true },
  { name: 'DeepSeek V4 Flash' },
  { name: 'DeepSeek R1' },
  { group: 'OpenAI 兼容' },
  { name: 'GPT-5.2' },
  { name: 'GLM-5 Code' }
].map(item => item.group
  ? `        <div class="picker-pop-group">${item.group}</div>`
  : `        <div class="picker-pop-row picker-pop-model ${item.checked ? 'checked' : ''}">
          <img class="picker-pop-ic" src="${icon(item.checked ? 'check-fill-white.png' : 'circle-white.png')}">
          <div class="picker-pop-model-line">
            <span class="picker-pop-name">${item.name}</span>
            ${item.suffix ? `<span class="picker-pop-suffix">· ${item.suffix}</span>` : ''}
          </div>
        </div>`).join('');

const permissionRows = [
  { icon: 'shield-check-gray.png', name: '仅可查看', desc: '以只读方式使用工作区，适合查看和分析任务。' },
  { icon: 'shield-write-gray.png', name: '工作区内修改', desc: '允许在工作区中修改文件，适合日常开发。', checked: true },
  { icon: 'shield-excla-gray.png', name: '完全权限', desc: '启用完整访问能力，风险较高，请谨慎选择。' },
  { icon: 'shield-auto-gray.svg', name: '自动审查', desc: '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。', badge: 'EXP' }
].map(item => `        <div class="picker-pop-row picker-pop-permission ${item.checked ? 'checked' : ''}">
          <img class="picker-pop-ic picker-pop-shield" src="${icon(item.icon)}">
          <div class="picker-pop-body">
            <div class="picker-pop-permission-line">
              <span class="picker-pop-name">${item.name}</span>
              ${item.badge ? `<span class="picker-pop-badge">${item.badge}</span>` : ''}
              ${item.checked ? `<img class="picker-pop-check" src="${icon('check-fill-white.png')}">` : ''}
            </div>
            <span class="picker-pop-desc">${item.desc}</span>
          </div>
        </div>`).join('');

const diagnosticsRows = [
  { label: '连接状态', value: '已连接' },
  { label: '公网标识', value: '7f3a9c2d', mono: true },
  { label: '网关', value: '客厅 Mac mini' },
  { label: '帧统计', value: '显示 1×  布局 2×  用户 1×', mono: true }
].map(item => `        <div class="picker-pop-row picker-pop-kv">
          <span class="picker-pop-kv-label">${item.label}</span>
          <span class="picker-pop-kv-value ${item.mono ? 'text-mono' : ''}">${item.value}</span>
        </div>`).join('');

const cacheRows = `
        <div class="picker-pop-cache-copy">
          <span class="picker-pop-cache-desc">仅清理本机的会话列表与正文缓存，下次打开时重新加载。</span>
          <span class="picker-pop-cache-note">不会删除聊天记录、配对信息或公网有效期。</span>
        </div>
        <div class="picker-pop-divider"></div>
        <div class="picker-pop-row picker-pop-action-row">
          <img class="picker-pop-ic picker-pop-action-ic" src="${icon('trash-gray.png')}">
          <span class="picker-pop-action-label picker-pop-danger">确认清理</span>
        </div>
        <div class="picker-pop-row picker-pop-action-row">
          <img class="picker-pop-ic picker-pop-action-ic" src="${icon('collab-close.svg')}">
          <span class="picker-pop-action-label">取消</span>
        </div>`;

const hints = {
  preset: '预设决定 Agent 使用的工具、提示词与能力。选择后只对新建会话生效。',
  model: '为之后新建的会话设置默认模型与思考等级。这会更新部署级设置，同步影响 WebUI，运行中的会话保持启动时的配置。',
  permission: '权限预设用于控制新会话可以执行的操作。'
};

function popover(kind) {
  const layout = pickerPopoverLayout(anchors[kind], windowInfo, navBottom);
  const content = kind === 'preset' ? presetRows
    : kind === 'model' ? modelRows
      : kind === 'permission' ? permissionRows
        : kind === 'diagnostics' ? diagnosticsRows
          : cacheRows;
  const hint = hints[kind] ? `
          <div class="picker-pop-hint">${hints[kind]}</div>` : '';
  return `
    <div class="picker-pop-mask"></div>
    <div class="picker-pop" style="left: ${layout.pickerPopLeft}px; top: ${layout.pickerPopTop}px; width: ${layout.pickerPopWidth}px; max-height: ${layout.pickerPopMaxH}px; transform-origin: ${layout.pickerPopOrigin};">
      <div class="picker-pop-scroll" style="max-height: ${layout.pickerPopMaxH}px;">
        <div class="picker-pop-content">${content}${hint}
        </div>
      </div>
    </div>`;
}

const row = (kind, anchor, label, value) => `        <div class="card-row ${kind === anchor ? 'anchor' : ''}"><span>${label}</span><span class="row-value">${value || ''}<img class="chevron" src="${icon('chev-right-gray.png')}"></span></div>`;

function stage(theme, kind) {
  return `
  <section class="stage theme-${theme}">
    <div class="page">
      <div class="nav">会话设置</div>
      <div class="group-title">新会话默认配置</div>
      <div class="card">
        ${row(kind, 'preset', 'Agent 预设', '标准模式')}
        ${row(kind, 'model', '默认模型', 'DeepSeek V4 · Max')}
        ${row(kind, 'permission', '权限', '工作区内修改')}
      </div>
      <div class="hint">与 WebUI 使用同一份部署级设置。修改只影响之后新建的会话，运行中的会话保持启动时的配置。</div>
      <div class="group-title">功能</div>
      <div class="card">
        ${row(kind, 'diagnostics', '诊断信息')}
        ${row(kind, 'cache', '清理缓存')}
      </div>
    </div>
    ${popover(kind)}
    <script>
      (function () {
        var stage = document.querySelector('.stage');
        var anchor = document.querySelector('.stage .anchor');
        var pop = document.querySelector('.stage .picker-pop');
        if (!stage || !anchor || !pop) return;
        var s = stage.getBoundingClientRect();
        var a = anchor.getBoundingClientRect();
        pop.style.top = (a.bottom + 8 - s.top) + 'px';
        pop.style.left = (s.width / 2 - pop.offsetWidth / 2) + 'px';
        pop.style.transformOrigin = '50% 0';
      })();
    </script>
  </section>`;
}

const shell = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace('/*__PICKER_POP_CSS__*/', popoverCss);

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

const shots = [
  { name: 'preview-preset-dark.png', theme: 'dark', kind: 'preset' },
  { name: 'preview-preset-light.png', theme: 'light', kind: 'preset' },
  { name: 'preview-model-dark.png', theme: 'dark', kind: 'model' },
  { name: 'preview-permission-dark.png', theme: 'dark', kind: 'permission' },
  { name: 'preview-diagnostics-dark.png', theme: 'dark', kind: 'diagnostics' },
  { name: 'preview-cache-dark.png', theme: 'dark', kind: 'cache' },
  { name: 'preview-cache-light.png', theme: 'light', kind: 'cache' }
];
for (const shot of shots) {
  const page = shell.replace('__STAGES__', stage(shot.theme, shot.kind));
  const temp = path.join(dir, 'shot-tmp.html');
  fs.writeFileSync(temp, page);
  try {
    // DPR 2：1rpx 正好一个物理像素，与真机 @2x 发丝线一致。
    execFileSync(browser, [
      '--headless=new', '--no-sandbox', '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=452,900',
      '--screenshot=' + path.join(dir, shot.name),
      'file://' + temp
    ], { stdio: 'ignore' });
    console.log('wrote', shot.name);
  } finally {
    fs.unlinkSync(temp);
  }
}
