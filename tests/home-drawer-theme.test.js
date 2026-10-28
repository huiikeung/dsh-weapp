const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('resources/runtime-markup/pages/home/home.wxss', 'utf8');
const runtime = fs.readFileSync('miniprogram/pages/home/home.wxss', 'utf8');
const page = fs.readFileSync('miniprogram/pages/home/home.js', 'utf8');
const template = fs.readFileSync('miniprogram/pages/home/home.wxml', 'utf8');

test('the shifted home panel floats above the DSH backplate with leading corners', () => {
  for (const [name, css] of [['source', source], ['runtime', runtime]]) {
    assert.match(css, /\.drawer\.drawer-dark\s*\{\s*background:\s*#000000\s*;/,
      `${name} keeps the dark drawer pure black`);
    assert.match(css, /\.home-content-wrap\s*\{[^}]*z-index:\s*53\s*;/,
      `${name} page stays above the drawer, including when the drawer is closed`);
    assert.match(css, /\.home-content-wrap\.drawer-anim\s*\{[^}]*border-radius\s+0\.38s/,
      `${name} animates the page corner radius when the drawer settles`);
    assert.match(css, /\.home-content-wrap\.drawer-anim\s*\{[^}]*box-shadow\s+0\.38s/,
      `${name} fades the floating shadow in step with the page slide`);
    assert.doesNotMatch(css, /\.drawer\s*\{[^}]*border-radius:/,
      `${name} does not clip or round the drawer itself`);
    assert.match(css, /\.home-root\s*\{[^}]*background:\s*#FFFFFF;/,
      `${name} provides a full-screen light drawer surface under the home panel`);
    assert.match(css, /\.home-root\.theme-dark\s*\{\s*background:\s*#000000;/,
      `${name} keeps the dark surface under the page corners pure black`);
    assert.doesNotMatch(css, /\.drawer-visible\s*\{[^}]*box-shadow:/,
      `${name} does not add a second shadow line at the drawer edge`);
    assert.match(css, /\.home-content-wrap\.shifted\s*\{[^}]*box-shadow:\s*-4rpx 0 18rpx rgba\(0, 0, 0, 0\.12\), -8rpx 0 52rpx rgba\(0, 0, 0, 0\.30\)/,
      `${name} floats the home panel above the drawer with the two-layer DSH shadow`);
    assert.match(css, /\.theme-dark \.home-content-wrap\.shifted\s*\{[^}]*border-left:\s*2rpx solid rgba\(255, 255, 255, 0\.18\)/,
      `${name} outlines the floating page with a neutral rim light on pure black`);
    assert.match(css, /\.theme-dark \.home-content-wrap\.shifted\s*\{[^}]*box-shadow:\s*-4rpx 0 18rpx rgba\(0, 0, 0, 0\.45\), -8rpx 0 52rpx rgba\(0, 0, 0, 0\.65\)/,
      `${name} deepens the shadow on the near-black dark backplate`);
  }
  assert.match(page, /contentCornerRadius:\s*48\s*\*\s*p/,
    'the 48px DSH corner radius follows drawer progress');
  assert.match(page, /dimProgress = Math\.max\(0, Math\.min\(1, \(p - 0\.45\) \/ 0\.55\)\)/,
    'the content dim starts after 45% drawer progress like iOS');
  assert.match(page, /maskOpacity = 0\.16 \* dimProgress \* dimProgress \* \(3 - 2 \* dimProgress\)/,
    'the content dim uses the iOS smoothstep curve');
  assert.match(template, /border-radius:\s*\{\{contentCornerRadius\}\}px\s+0\s+0\s+\{\{contentCornerRadius\}\}px/,
    'only the shifted page upper-left and lower-left corners are rounded');
  assert.doesNotMatch(template, /drawer-underlay-extension/,
    'the full-screen root surface, not a narrow strip, continues behind the page');
});

test('drawer dim lives inside the moving content layer, not on the root surface', () => {
  for (const [name, css] of [['source', source], ['runtime', runtime]]) {
    const mask = (css.match(/\.drawer-mask\s*\{[^}]*\}/) || [''])[0];
    assert.ok(mask, `${name} defines the drawer dim mask`);
    assert.match(mask, /position:\s*absolute;/, `${name} mask is positioned inside the content layer`);
    assert.match(mask, /z-index:\s*30;/, `${name} mask sits above the scrolling content but below the page frame`);
    assert.match(mask, /background:\s*#000000;/, `${name} mask dims with an opaque black surface`);
    assert.doesNotMatch(mask, /rgba\(0,\s*0,\s*0,\s*0\.16\)/,
      `${name} must not double-apply the dim alpha`);
  }

  // Mask must be the last child of home-content-wrap: rendered inside it so the root
  // surface around the rounded page corners stays pure white/black instead of dimmed.
  const wrapStart = template.indexOf('class="home-content-wrap');
  const maskStart = template.indexOf('class="drawer-mask');
  const scrollEnd = template.indexOf('</scroll-view>', wrapStart);
  const dialogsStart = template.indexOf('<!-- 删除主机确认弹窗 -->', wrapStart);
  assert.ok(wrapStart >= 0, 'template still has the moving home content wrap');
  assert.ok(maskStart > scrollEnd && maskStart < dialogsStart,
    'drawer mask is inside the content wrap, after the scroll view and before the dialogs');
  const maskBlock = template.slice(maskStart, template.indexOf('></view>', maskStart));
  assert.match(maskBlock, /catchtap="closeDrawer"/, 'tapping the dimmed content still closes the drawer');
  assert.match(maskBlock, /opacity:\s*\{\{maskOpacity\}\}/, 'the mask opacity still follows drawer progress');
});