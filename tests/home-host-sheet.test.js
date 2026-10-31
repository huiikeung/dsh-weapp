'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');

test('切换主机弹窗固定沿用现在这套玻璃面板，不受玻璃 UI 开关控制', () => {
  const wxml = read('pages/home/home.wxml');
  const css = read('pages/home/home.wxss');
  const js = read('pages/home/home.js');
  // 不受开关控制
  assert.match(wxml, /class="host-sheet \{\{hostSheetExpanded \? 'expanded' : ''\}\}/);
  assert.doesNotMatch(wxml, /host-sheet[^"]*settingsGlassEnabled/);
  assert.doesNotMatch(wxml, /host-sheet-glass/);
  assert.doesNotMatch(js, /hostSheetGlass/);
  // 固定玻璃：浮起 12px / 底部 24px、32rpx 圆角、白纱渐变 + 发丝边 + blur 8rpx（与设置页玻璃弹窗同一套）
  const sheet = css.slice(css.indexOf('.host-sheet {'), css.indexOf('.host-sheet {') + 900);
  assert.match(sheet, /left: 12px;/);
  assert.match(sheet, /right: 12px;/);
  assert.match(sheet, /bottom: 24px;/);
  assert.ok(sheet.includes('border-radius: var(--glass-radius-sheet, 32rpx);'));
  assert.match(sheet, /linear-gradient\(165deg, rgba\(255, 255, 255, var\(--glass-alpha-top, 0\.10\)\), rgba\(255, 255, 255, var\(--glass-alpha-bottom, 0\.04\)\)\)/);
  assert.ok(sheet.includes('1rpx solid rgba(255, 255, 255, var(--glass-edge-alpha, 0.38))'));
  assert.ok(sheet.includes('backdrop-filter: blur(var(--glass-blur-sheet, 8rpx))'));
  assert.doesNotMatch(css, /host-sheet-glass/);
  // 展开高度扣除底部 24px，顶边不抬高
  assert.match(css, /\.host-sheet\.expanded \{[\s\S]{0,40}?height: calc\(100vh - 200rpx - 24px\)/);
});
test('添加工作区弹窗沿用同一套玻璃面板', () => {
  const css = read('pages/home/home.wxss');
  const wxml = read('pages/home/home.wxml');
  assert.match(wxml, /class="dir-sheet"/);
  const sheet = css.slice(css.indexOf('.dir-sheet {'), css.indexOf('.dir-sheet {') + 900);
  assert.match(sheet, /left: 12px;/);
  assert.match(sheet, /right: 12px;/);
  assert.match(sheet, /bottom: 24px;/);
  assert.match(sheet, /height: calc\(80vh - 24px\);/);
  assert.ok(sheet.includes('border-radius: var(--glass-radius-sheet, 32rpx);'));
  assert.match(sheet, /linear-gradient\(165deg, rgba\(255, 255, 255, var\(--glass-alpha-top, 0\.10\)\), rgba\(255, 255, 255, var\(--glass-alpha-bottom, 0\.04\)\)\)/);
  assert.ok(sheet.includes('1rpx solid rgba(255, 255, 255, var(--glass-edge-alpha, 0.38))'));
  assert.ok(sheet.includes('backdrop-filter: blur(var(--glass-blur-sheet, 8rpx))'));
});
test('添加工作区弹窗：上一级行与箭头用白色高亮，+ 号是蓝色圆形徽标', () => {
  const css = read('pages/home/home.wxss');
  const rowName = css.slice(css.indexOf('.dir-row-name {'), css.indexOf('.dir-row-name {') + 200);
  assert.match(rowName, /color: #FFFFFF;/);
  const rowSub = css.slice(css.indexOf('.dir-row-sub {'), css.indexOf('.dir-row-sub {') + 200);
  assert.match(rowSub, /color: rgba\(255, 255, 255, 0\.82\)/);
  // 右侧箭头改为纯白图标并旋转指向右侧
  const chev = css.slice(css.indexOf('.dir-row-chev {'), css.indexOf('.dir-row-chev {') + 220);
  assert.match(chev, /transform: rotate\(-90deg\)/);
  assert.doesNotMatch(chev, /brightness/);
  // 深色玻璃圆钮 + 白色文件夹 + 白色加号（加号小、嵌在文件夹右上角）
  const headBtn = css.slice(css.indexOf('.dir-head-btn {'), css.indexOf('.dir-head-btn {') + 400);
  assert.match(headBtn, /background: rgba\(255, 255, 255, 0\.08\);/);
  const badge = css.slice(css.indexOf('.dir-head-badge {'), css.indexOf('.dir-head-badge {') + 320);
  assert.doesNotMatch(badge, /background:/);
  assert.doesNotMatch(badge, /border:/);
  const add = css.slice(css.indexOf('.dir-head-add {'), css.indexOf('.dir-head-add {') + 200);
  assert.match(add, /width: 18rpx;/);
  assert.match(add, /drop-shadow/);
  const wxml = read('pages/home/home.wxml');
  assert.match(wxml, /class="dir-head-folder" src="\/assets\/icons\/workspace-folder-white\.svg"/);
  assert.match(wxml, /class="dir-head-badge"><image class="dir-head-add" src="\/assets\/icons\/ic-dir-add-white\.png"/);
  assert.doesNotMatch(wxml, /dir-head-badge"><text>\+<\/text>/);
  // 上一级行：恢复原来的返回箭头，颜色改成问号徽标的蓝色；行文字纯白
  assert.match(wxml, /dir-row-icon"><image class="dir-row-ic" src="\/assets\/icons\/ic-dir-parent-blue\.png"/);
  assert.doesNotMatch(wxml, /back-white\.png/);
  assert.match(wxml, /class="dir-row-chev" src="\/assets\/icons\/chev-down-white\.png"/);
  const nameCss = css.slice(css.indexOf('.dir-row-name {'), css.indexOf('.dir-row-name {') + 200);
  assert.match(nameCss, /color: #FFFFFF;/);
  const subCss = css.slice(css.indexOf('.dir-row-sub {'), css.indexOf('.dir-row-sub {') + 200);
  assert.match(subCss, /color: rgba\(255, 255, 255, 0\.82\)/);
  // 到根目录时上一级不可点，但整行不再变灰
  const disabled = css.slice(css.indexOf('.dir-row.disabled {'), css.indexOf('.dir-row.disabled {') + 160);
  assert.match(disabled, /opacity: 1;/);
});
test('新建文件夹改成居中透明弹窗，不再调用系统 showModal', () => {
  const wxml = read('pages/home/home.wxml');
  const css = read('pages/home/home.wxss');
  const js = read('pages/home/home.js');
  assert.match(wxml, /class="dir-prompt-mask" catchtap="closeDirCreate"/);
  assert.match(wxml, /class="dir-prompt-sheet"/);
  assert.match(wxml, /bindtap="confirmDirCreate"/);
  assert.match(wxml, /class="dir-prompt-btn dir-prompt-confirm/);
  // 居中 + 透明玻璃面板
  const mask = css.slice(css.indexOf('.dir-prompt-mask {'), css.indexOf('.dir-prompt-mask {') + 320);
  assert.match(mask, /align-items: center;/);
  assert.match(mask, /justify-content: center;/);
  const sheet = css.slice(css.indexOf('.dir-prompt-sheet {'), css.indexOf('.dir-prompt-sheet {') + 700);
  assert.match(sheet, /width: 620rpx;/);
  assert.ok(sheet.includes('border-radius: var(--glass-radius-sheet, 32rpx);'));
  assert.match(sheet, /linear-gradient\(165deg, rgba\(255, 255, 255, var\(--glass-alpha-top, 0\.10\)\), rgba\(255, 255, 255, var\(--glass-alpha-bottom, 0\.04\)\)\)/);
  assert.ok(sheet.includes('1rpx solid rgba(255, 255, 255, var(--glass-edge-alpha, 0.38))'));
  assert.ok(sheet.includes('backdrop-filter: blur(var(--glass-blur-sheet, 8rpx))'));
  const confirm = css.slice(css.indexOf('.dir-prompt-confirm {'), css.indexOf('.dir-prompt-confirm {') + 200);
  assert.match(confirm, /background: transparent;/);
  assert.match(confirm, /1rpx solid rgba\(255, 255, 255, 0\.38\)/);
  assert.match(confirm, /color: #FFFFFF;/);
  // 新建文件夹不再使用系统可编辑弹窗（其他地方的 showModal 不受影响）
  assert.doesNotMatch(js, /showModal\(\{[\s\S]{0,120}?新建文件夹/);
  assert.match(js, /confirmDirCreate\(\)/);
  assert.match(js, /createDirectory\(parent, name\)/);
});
test('目录弹窗：左上角图标下沉、底部创建工作区按钮改为透明', () => {
  const css = read('pages/home/home.wxss');
  const folder = css.slice(css.indexOf('.dir-head-folder {'), css.indexOf('.dir-head-folder {') + 200);
  assert.match(folder, /width: 42rpx;/);
  assert.match(folder, /transform: translate\(-3rpx, 3rpx\)/);
  const btn = css.slice(css.indexOf('.dir-create-btn {'), css.indexOf('.dir-create-btn {') + 500);
  assert.match(btn, /background: transparent;/);
  assert.match(btn, /1rpx solid rgba\(255, 255, 255, 0\.38\)/);
  assert.match(btn, /color: #FFFFFF;/);
});
