'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../miniprogram/utils/share.js'), 'utf8');
const ui = { t: text => text, locale: () => 'zh' };

function fixture() {
  let registered; const calls = [];
  const context = {
    require: name => (name === './ui-preferences' ? ui : require(name)),
    Page: options => { registered = options; },
    module: { exports: {} },
    wx: {
      showShareMenu: options => calls.push(['show', ((options && options.menus) || []).join('|')]),
      hideShareMenu: options => calls.push(['hide', ((options && options.menus) || []).join('|')])
    }
  };
  vm.runInNewContext(source, context);
  context.module.exports.install();
  return { context, calls, page: () => registered };
}

test('friend sharing always lands on a page strangers can actually open', () => {
  const f = fixture();
  f.context.Page({});
  const page = { route: 'pages/session/session' };
  const message = f.page().onShareAppMessage.call(page);
  assert.equal(message.path, '/pages/home/home');
  assert.ok(message.title.includes('DeepSeek Harness'));
  assert.ok(message.imageUrl.includes('app-icon-share'));
  // 会话、设置等页面关闭朋友圈入口，避免对方打开缺参页面。
  f.page().onShow.call(page);
  assert.deepEqual(f.calls[0], ['show', 'shareAppMessage']);
  assert.deepEqual(f.calls[1], ['hide', 'shareTimeline']);
});

test('home page shares itself to both friends and Moments with the same copy', () => {
  const f = fixture();
  f.context.Page({});
  const page = { route: 'pages/home/home' };
  const friend = f.page().onShareAppMessage.call(page);
  const timeline = f.page().onShareTimeline.call(page);
  assert.equal(friend.path, '/pages/home/home');
  assert.equal(friend.title, timeline.title);
  assert.equal(timeline.query, '');
  assert.ok(timeline.imageUrl.includes('app-icon-share'));
  f.page().onShow.call(page);
  assert.deepEqual(f.calls[0], ['show', 'shareAppMessage|shareTimeline']);
  assert.ok(!f.calls.some(call => call[0] === 'hide'));
});

test('pages with their own share implementation are not overwritten and manual pages hide menus', () => {
  const f = fixture();
  const custom = () => ({ title: 'custom', path: '/pages/home/home' });
  f.context.Page({ manualShareMenu: true, onShareAppMessage: custom });
  assert.equal(f.page().onShareAppMessage, custom, 'page-level handler wins');
  f.page().onShow.call({ route: 'pages/privacy/privacy' });
  assert.deepEqual(f.calls, [['hide', 'shareAppMessage|shareTimeline']]);
});

test('install is idempotent and keeps the original page constructor', () => {
  const f = fixture();
  const before = f.context.Page;
  f.context.module.exports.install();
  assert.equal(f.context.Page, before, 'second install must not wrap twice');
});
