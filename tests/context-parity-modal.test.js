// /context 等价弹窗 ⇄ dsh-context v0.74.0 契约（spec-fleet.md §9）。
//
// 页面里没有斜杠命令，入口放上下文工具栏；弹窗 = 居中卡片（82vh，宽 100vw-64rpx，
// radius 24rpx），内容是 Current Composition + Context Browser 概览；
// 关闭 = 点遮罩 / 右上 ×；点类别行则关闭弹窗回到页面浏览器卡片并展开该类别。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');

test('modal is a fixed centered card with the plugin dimensions', () => {
  assert.match(wxss, /\.ctx-modal-mask\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*300;[^}]*rgba\(0,\s*0,\s*0,\s*\.45\)/);
  assert.match(wxss, /\.ctx-modal\s*\{[^}]*width:\s*calc\(100vw - 64rpx\)[^}]*max-height:\s*82vh[^}]*border-radius:\s*24rpx/);
  assert.match(wxss, /\.ctx-modal\s*\{[^}]*padding:\s*32rpx 36rpx 36rpx/);
  assert.match(wxss, /\.ctx-modal-body\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0/);
  assert.match(wxml, /class="ctx-modal-mask" bindtap="closeContextModal"/);
  assert.match(wxml, /class="ctx-modal-close" bindtap="closeContextModal"/);
});

test('modal composes Current Composition and the browser overview', () => {
  const body = wxml.slice(wxml.indexOf('class="ctx-modal"'));
  assert.match(body, /ctx-overview-num/);
  assert.match(body, /ctx-compose-bar/);
  assert.match(body, /ctx-compose-trigger/);
  assert.match(body, /ctx-slice-grid/);
  assert.match(body, /ctx-browser-picker/);
  assert.match(body, /data-base="step"/);
  assert.match(body, /data-base="turn"/);
  assert.match(body, /ctx-modal-cats/);
  // 类别行沿用页面浏览器的双 delta / token / 占比结构。
  assert.match(body, /ctx-br-count/);
  assert.match(body, /ctx-br-delta ctx-delta-\{\{item\.countDeltaClass\}\}/);
  assert.match(body, /ctx-br-token/);
  assert.match(body, /ctx-br-pct/);
});

test('page handlers open/close the modal and hand category taps back to the browser card', () => {
  assert.match(session, /openContextModal\(\)\s*\{[\s\S]*?contextModalOpen:\s*true/);
  assert.match(session, /closeContextModal\(\)\s*\{[\s\S]*?contextModalOpen:\s*false/);
  assert.match(session, /contextModalCategoryTap\(e\)[\s\S]*?contextModalOpen:\s*false[\s\S]*?setContextBrowser\([\s\S]*?jumpContextTo\('ctxBrowserCard'\)/);
  assert.match(wxml, /class="context-modal-open" bindtap="openContextModal"/);
  // 打开时收起跳到底部的胶囊，避免两个浮层叠在一起。
  assert.match(session, /openContextModal\(\)[\s\S]*?showJump:\s*false/);
  // 会话切换时弹窗必须关闭。
  assert.match(session, /contextModalOpen:\s*false[\s\S]*?contextBrowserBase:\s*contextPreferences\.read\(\)\.base/);
});
