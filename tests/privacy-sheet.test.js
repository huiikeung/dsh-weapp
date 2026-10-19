const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'miniprogram');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function setup() {
  let definition; const events = []; const timers = new Map(); let id = 0;
  const wx = { getMenuButtonBoundingClientRect: () => ({ bottom: 86 }), showToast: o => events.push(o.title) };
  vm.runInNewContext(read('components/privacy-sheet/privacy-sheet.js'), {
    Component: d => { definition = d; }, wx,
    require: n => n.endsWith('ui-preferences') ? require('../miniprogram/utils/ui-preferences') : require('../miniprogram/utils/privacy-policy'),
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key)
  });
  const component = { ...definition.methods, data: { ...definition.data }, setData(v) { Object.assign(this.data, v); }, triggerEvent(e) { events.push(e); } };
  return { component, definition, wx, events, timers, flush() { for (const fn of [...timers.values()]) fn(); timers.clear(); } };
}
test('privacy sheet opens locally, honors safe inset and closes once after animation', () => {
  const { component: c, events, timers, flush } = setup();
  c.onVisibilityChange(true); assert.equal(c.data.mounted, true); assert.equal(c.data.topInset, 94);
  c.close(); c.close(); assert.equal(c.data.closing, true); assert.equal(timers.size, 1);
  flush(); assert.equal(c.data.mounted, false); assert.deepEqual(events, ['close']);
  c.onVisibilityChange(true); assert.equal(c.data.scrollTop, 0);
  c.close(); c.onVisibilityChange(false); assert.equal(timers.size, 0);
});
test('grabber follows downward touch and dismisses only after threshold; cancel restores', () => {
  const { component: c, flush, events } = setup(); c.onVisibilityChange(true);
  c.onDragStart({ touches: [{ clientY: 100 }] }); c.onDragMove({ touches: [{ clientY: 70 }] }); assert.equal(c.data.dragOffset, 0);
  c.onDragMove({ touches: [{ clientY: 140 }] }); c.onDragEnd(); assert.equal(c.data.dragOffset, 0); assert.equal(c.data.closing, false);
  c.onDragStart({ touches: [{ clientY: 100 }] }); c.onDragMove({ touches: [{ clientY: 250 }] }); c.onDragCancel(); assert.equal(c.data.dragOffset, 0);
  c.onDragStart({ touches: [{ clientY: 100 }] }); c.onDragMove({ touches: [{ clientY: 210 }] }); c.onDragEnd(); flush(); assert.deepEqual(events, ['close']);
});
test('privacy API is optional and detached component clears pending callbacks', () => {
  const { component: c, definition, wx, events, timers } = setup();
  c.openPlatformPrivacy(); assert.match(events[0], /升级微信/);
  wx.openPrivacyContract = o => o.fail(); c.openPlatformPrivacy(); assert.match(events[1], /暂时无法/);
  c.onVisibilityChange(true); c.close(); definition.lifetimes.detached.call(c); assert.equal(timers.size, 0);
});
test('privacy is fullscreen, scrollable, themed, and no longer an external webview', () => {
  const html = read('components/privacy-sheet/privacy-sheet.wxml'), css = read('components/privacy-sheet/privacy-sheet.wxss');
  assert.match(html, /scroll-view scroll-y/); assert.match(html, /privacy-grabber/); assert.match(html, /catchtouchmove="onDragMove"/);
  assert.match(css, /position: fixed; inset: 0/); assert.match(css, /privacy-dark/); assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(read('pages/privacy/privacy.wxml'), /web-view/);
  assert.doesNotMatch(read('pages/privacy/privacy.js'), /github.io|PRIVACY_URL/);
  const policy = JSON.stringify(require('../miniprogram/utils/privacy-policy'));
  for (const term of ['鲸尾助手', 'OpenID', 'WX-', '局域网', '朋友圈', '清理缓存', '联系客服']) assert.ok(policy.includes(term), term);
});
test('announcement publish button is transparent with a translucent border in all states', () => {
  const css = read('pages/announcement-admin/announcement-admin.wxss');
  assert.match(css, /\.editor-page \.editor-primary\s*\{[^}]*background: transparent;[^}]*border: 1rpx solid var\(--border-strong\)/);
  assert.match(css, /\.editor-primary\[disabled\]\s*\{[^}]*background: transparent/);
  assert.match(read('pages/announcement-admin/announcement-admin.wxml'), /hover-class="editor-primary-hover"/);
});
