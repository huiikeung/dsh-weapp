'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pickerPopoverLayout: layout } = require('../miniprogram/pages/session-settings/utils/picker-popover');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');
const phone = { windowWidth: 390, windowHeight: 844, statusBarHeight: 47, safeArea: { bottom: 810 } };
const navBottom = 93;

test('picker popover opens below the anchor row like the home workspace menu', () => {
  const row = { left: 20, top: 240, width: 350, height: 56 };
  const pop = layout(row, phone, navBottom);
  assert.equal(pop.pickerPopOrigin, '50% 0');
  assert.equal(pop.pickerPopTop, row.top + row.height + 8);
  assert.ok(pop.pickerPopWidth >= 224 && pop.pickerPopWidth <= 280);
  assert.equal(pop.pickerPopLeft + pop.pickerPopWidth / 2, row.left + row.width / 2);
  assert.ok(pop.pickerPopMaxH > 0 && pop.pickerPopMaxH <= 420);
});

test('picker popover flips above the row when there is no room below', () => {
  const row = { left: 20, top: 700, width: 350, height: 56 };
  const pop = layout(row, phone, navBottom);
  assert.equal(pop.pickerPopOrigin, '50% 100%');
  assert.equal(pop.pickerPopTop + pop.pickerPopMaxH, row.top - 8);
  assert.ok(pop.pickerPopTop >= navBottom + 8);
});

test('picker popover stays inside safe bounds on narrow and wide screens', () => {
  for (const width of [320, 375, 390, 430, 768]) {
    for (const top of [120, 260, 420, 700]) {
      const info = { windowWidth: width, windowHeight: 640, safeArea: { bottom: 612 } };
      const pop = layout({ left: 16, top, width: width - 32, height: 52 }, info, 88);
      assert.ok(pop.pickerPopLeft >= 16);
      assert.ok(pop.pickerPopLeft + pop.pickerPopWidth <= width - 16);
      assert.ok(pop.pickerPopTop >= 96);
      assert.ok(pop.pickerPopMaxH > 0);
      assert.ok(pop.pickerPopTop + pop.pickerPopMaxH <= 612);
    }
  }
});

test('diagnostics and cache use a wider popover while other pickers keep the menu width', () => {
  const row = { left: 20, top: 240, width: 350, height: 56 };
  const normal = layout(row, phone, navBottom);
  const wide = layout(row, phone, navBottom, { wide: true });
  assert.ok(wide.pickerPopWidth > normal.pickerPopWidth);
  assert.ok(wide.pickerPopWidth >= 280 && wide.pickerPopWidth <= 340);
  assert.ok(wide.pickerPopLeft >= 16);
  assert.ok(wide.pickerPopLeft + wide.pickerPopWidth <= 390 - 16);
});

test('a row scrolled above the viewport keeps the popover below the navigation bar', () => {
  const pop = layout({ left: 20, top: -80, width: 350, height: 56 }, phone, navBottom);
  assert.ok(pop.pickerPopTop >= navBottom + 8);
  assert.ok(pop.pickerPopMaxH > 0);
});

test('missing anchor metrics fall back to a finite, visible popover', () => {
  for (const rect of [null, undefined, {}, { left: 20, top: 200, width: 0, height: 0 }]) {
    const pop = layout(rect, null, 0);
    assert.ok(Number.isFinite(pop.pickerPopLeft) && Number.isFinite(pop.pickerPopTop));
    assert.ok(Number.isFinite(pop.pickerPopWidth) && Number.isFinite(pop.pickerPopMaxH));
    assert.equal(pop.pickerPopOrigin, '50% 0');
    assert.ok(pop.pickerPopTop >= 24);
  }
});

test('preset keeps a glass bottom sheet while model and permission feed the anchored glass menu', () => {
  const html = read('pages/session-settings/session-settings.wxml');
  const css = read('pages/session-settings/session-settings.wxss');
  const js = read('pages/session-settings/session-settings.js');
  for (const [id, handler] of [['agent-preset-row', 'pickAgentPreset'], ['default-model-row', 'pickDefaultModel'], ['default-permission-row', 'pickDefaultPermission']]) {
    assert.match(html, new RegExp('id="' + id + '"[^>]*bindtap="' + handler + '"'));
  }
  // Agent 预设：玻璃界面下仍是与原生一致的底部弹窗，只是换成玻璃材质。
  assert.match(html, /wx:if="\{\{picker === 'preset' && settingsGlassEnabled\}\}" class="pair-sheet-mask" catchtap="closePickerSheet"/);
  assert.match(html, /class="picker-glass-sheet resizable[\s\S]*?data-sheet="picker"[\s\S]*?class="sheet-grabber"/);
  assert.match(html, /class="picker-glass-sheet resizable[\s\S]*?bindtap="closePickerSheet"[\s\S]*?sheet-close-x/);
  assert.match(html, /class="picker-sheet-scroll"[\s\S]*?picker-pop-preset/);
  assert.match(html, /class="picker-sheet-footer"[\s\S]*?createCustomAgentPreset/);
  // 其余入口继续用锚点玻璃菜单，预设不再走这条路径。
  assert.match(html, /class="picker-pop-mask" catchtap="closePickerPopover"/);
  assert.match(html, /picker && settingsGlassEnabled && picker !== 'preset'/);
  assert.match(html, /class="picker-pop"\s+style="left: \{\{pickerPopLeft\}\}px; top: \{\{pickerPopTop\}\}px; width: \{\{pickerPopWidth\}\}px; max-height: \{\{pickerPopMaxH\}\}px; transform-origin: \{\{pickerPopOrigin\}\};"/);
  assert.match(html, /scroll-view class="picker-pop-scroll"/);
  for (const kind of ['preset', 'model', 'effort', 'permission']) {
    assert.match(html, new RegExp("picker === '" + kind + "'"));
  }
  assert.match(html, /picker && !settingsGlassEnabled/);
  assert.match(html, /utilitySheet && !settingsGlassEnabled/);
  // 玻璃弹窗参数：与首页工作区弹窗同款材质，但保持底部弹窗的形态（只圆上两角）。
  assert.match(css, /\.picker-glass-sheet \{[\s\S]*?border-radius: 32rpx;[\s\S]*?linear-gradient\(165deg, rgba\(255, 255, 255, 0\.10\), rgba\(255, 255, 255, 0\.04\)\)[\s\S]*?backdrop-filter: blur\(8rpx\)/);
  // 左右各让出 2px：玻璃边框不贴屏幕边缘，底部仍贴底。
  assert.match(css, /\.picker-glass-sheet \{[^}]*width: calc\(100% - 24px\)[^}]*margin: 0 12px 24px;[^}]*border-radius: 32rpx;/);
  assert.match(css, /@keyframes picker-sheet-rise/);
  assert.match(css, /\.theme-light \.picker-glass-sheet \{/);
  assert.match(js, /pickerPopoverLayout\(rect, windowInfo, navigationBottom, \{ wide \}\)/);
  assert.match(js, /select\(anchorSelector\)/);
  assert.match(js, /settingsGlassEnabled \|\| kind === 'preset'/);
  for (const anchor of ['#agent-preset-row', '#default-model-row', '#default-permission-row']) {
    assert.ok(js.includes("'" + anchor + "'"), anchor);
  }
});
