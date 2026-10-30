// 预览添加工作区（目录浏览器）弹窗与新建文件夹居中弹窗：node preview/dir-sheet/shoot.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = __dirname;
const root = path.resolve(dir, '..', '..');
const rawCss = fs.readFileSync(path.join(root, 'miniprogram/pages/home/home.wxss'), 'utf8')
  .split('\n').filter(line => !line.startsWith('@import')).join('\n');
const toPx = s => s.replace(/(\d+(?:\.\d+)?)rpx/g, (_, v) => { const px = Number(v) / 2; return (Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')) + 'px'; });

const icon = name => '../../miniprogram/assets/icons/' + name;

function dirSheet() {
  return [
    '<div class="host-mask"></div>',
    '<div class="dir-sheet">',
    '  <div class="dir-sheet-handle"></div>',
    '  <div class="dir-head">',
    '    <div class="dir-head-btn"><img class="dir-head-folder" src="' + icon('workspace-folder-white.svg') + '"><div class="dir-head-badge"><img class="dir-head-add" src="' + icon('ic-dir-add-white.png') + '"></div></div>',
    '    <span class="dir-head-title">选择工作区目录</span>',
    '    <div class="dir-head-cancel">取消</div>',
    '  </div>',
    '  <div class="dir-loc">',
    '    <div class="dir-loc-row">',
    '      <div class="dir-loc-btn"><img class="dir-loc-btn-ic" src="' + icon('server-white.png') + '"><span>位置</span></div>',
    '      <div class="dir-crumbs"><div class="dir-crumbs-inner"><span class="dir-crumb">电脑</span><span class="dir-crumb-sep">›</span><span class="dir-crumb">Users</span><span class="dir-crumb-sep">›</span><span class="dir-crumb">me</span><span class="dir-crumb-sep">›</span><span class="dir-crumb current">workspace</span></div></div>',
    '      <div class="dir-loc-edit"><img class="dir-loc-edit-ic" src="' + icon('pencil-edit-white.svg') + '"></div>',
    '    </div>',
    '    <div class="dir-filter-row"><div class="dir-hidden-toggle"><img class="dir-hidden-ic" src="' + icon('ic-dir-badge-question.png') + '"><span>显示隐藏文件</span><span class="dir-hidden-count">12</span></div></div>',
    '  </div>',
    '  <div class="dir-body">',
    '    <div class="dir-list-card"><div class="dir-list">',
    '      <div class="dir-row"><div class="dir-row-icon"><img class="dir-row-ic" src="' + icon('ic-dir-parent-blue.png') + '"></div><div class="dir-row-body"><span class="dir-row-name">..</span><span class="dir-row-sub">返回上一级</span></div><img class="dir-row-chev" src="' + icon('chev-down-white.png') + '"></div>',
    '      <div class="dir-divider"></div>',
    '      <div class="dir-row"><div class="dir-row-icon"><img class="dir-row-ic" src="' + icon('workspace-folder-white.svg') + '"></div><div class="dir-row-body"><span class="dir-row-name">project-a</span></div><img class="dir-row-chev" src="' + icon('chev-down-white.png') + '"></div>',
    '      <div class="dir-divider"></div>',
    '      <div class="dir-row"><div class="dir-row-icon"><img class="dir-row-ic" src="' + icon('workspace-folder-white.svg') + '"></div><div class="dir-row-body"><span class="dir-row-name">dsh-weapp</span></div><img class="dir-row-chev" src="' + icon('chev-down-white.png') + '"></div>',
    '    </div></div>',
    '  </div>',
    '  <div class="dir-create-bar">',
    '    <span class="dir-create-path text-mono">/Users/me/workspace</span>',
    '    <div class="dir-create-btn"><img class="dir-create-add" src="' + icon('ic-dir-add-white.png') + '"><span>在当前目录创建工作区</span></div>',
    '  </div>',
    '</div>'
  ].join('\n');
}

function createModal() {
  return [
    '<div class="dir-prompt-mask"><div class="dir-prompt-sheet">',
    '  <span class="dir-prompt-title">新建文件夹</span>',
    '  <span class="dir-prompt-hint">将在当前目录中创建一个新的子文件夹。</span>',
    '  <input class="dir-prompt-input" placeholder="文件夹名称" value="cache">',
    '  <div class="dir-prompt-actions"><div class="dir-prompt-btn dir-prompt-cancel">取消</div><div class="dir-prompt-btn dir-prompt-confirm">创建</div></div>',
    '</div></div>'
  ].join('\n');
}

const stage = (inner) => '<section class="stage theme-dark">' + inner + '</section>';

const frame = (stages) => [
  '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>',
  '* { box-sizing: border-box; } html, body { margin: 0; }',
  'body { background: #e9edf3; font-family: -apple-system, "PingFang SC", sans-serif; padding: 28px; display: flex; gap: 24px; }',
  '.stage { position: relative; width: 390px; height: 844px; border-radius: 40px; overflow: hidden; box-shadow: 0 18px 60px rgba(7,24,43,.22); }',
  '.stage.theme-dark { background: #05070c; color: #F1F4FA; --bg:#000; --surface:#1C1C1E; --text:#F1F4FA; --text-2:rgba(241,244,250,.62); --text-3:rgba(241,244,250,.42); --border:rgba(255,255,255,.10); --divider:rgba(255,255,255,.08); --fill:rgba(255,255,255,.06); --fill-2:rgba(255,255,255,.10); --ocean:#2E6BE6; }',
  '.dir-mock-page { position: absolute; inset: 0; background: radial-gradient(120% 80% at 50% 0%, #0d1b33 0%, #05070c 60%); }',
  '.host-mask { position: absolute; } .dir-sheet { position: absolute; } .text-mono { font-family: ui-monospace, Menlo, monospace; }',
  toPx(rawCss),
  '</style></head><body>',
  stages,
  '</body></html>'
].join('\n');

const browser = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium']
  .find(p => { try { fs.accessSync(p); return true; } catch (e) { return false; } });
if (!browser) { console.error('no chrome'); process.exit(1); }

const shots = [
  ['dir-sheet-dark.png', '<div class="dir-mock-page"></div>' + dirSheet()],
  ['dir-create-dark.png', '<div class="dir-mock-page"></div>' + dirSheet() + createModal()]
];
for (const [name, inner] of shots) {
  const file = path.join(dir, 'shot-tmp.html');
  fs.writeFileSync(file, frame(stage(inner)));
  try {
    execFileSync(browser, ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=452,900', '--screenshot=' + path.join(dir, name), 'file://' + file], { stdio: 'ignore' });
    console.log('wrote ' + name);
  } finally { fs.unlinkSync(file); }
}