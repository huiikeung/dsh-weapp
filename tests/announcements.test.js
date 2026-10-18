'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function pageFixture(name, overrides = {}) {
  let definition; const calls = [];
  const api = { appContent: async () => ({ items: [{ id: 'one', title: '公告', content: '正文', revision: 1 }], shareEnabled: false }), ensureAccount: async () => ({ isAdmin: true }),
    announcements: async () => ({ items: [] }), saveAnnouncement: async x => { calls.push(x); return {}; }, deleteAnnouncement: async () => ({}), ...overrides };
  const wx = { showToast() {}, pageScrollTo() {}, stopPullDownRefresh() {}, showModal(o) { wx.modal = o; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', name, name + '.js'), 'utf8'), { Page: d => { definition = d; }, require: n => n.endsWith('access-api') ? api : { applyTo() {} }, wx, Date, Set });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(v) { Object.assign(this.data, v); } };
  return { page, api, calls, wx };
}
test('announcement reader is anonymous, expands cards and rejects stale responses', async () => {
  const f = pageFixture('announcements', { ensureAccount: () => { throw new Error('must not login'); } });
  await f.page.onShow(); assert.equal(f.page.data.items.length, 1);
  f.page.toggle({ currentTarget: { dataset: { id: 'one' } } }); assert.equal(f.page.data.items[0].expanded, true);
  await f.page.refresh(); assert.equal(f.page.data.items[0].expanded, true);
  let resolve; f.api.appContent = () => new Promise(r => { resolve = r; });
  const pending = f.page.refresh(); f.page.onHide(); resolve({ items: [], shareEnabled: true }); await pending;
  assert.equal(f.page.data.items.length, 1);
});
test('announcement admin denies ordinary navigation and preserves unsaved drafts on save errors', async () => {
  const f = pageFixture('announcement-admin', { ensureAccount: async () => ({ isAdmin: false }) });
  await f.page.onShow(); assert.equal(f.page.data.isAdmin, false); await f.page.save(); assert.equal(f.calls.length, 0);
  f.api.ensureAccount = async () => ({ isAdmin: true }); await f.page.refresh();
  f.page.setData({ title: '测试公告', content: '仅用于测试' });
  f.api.saveAnnouncement = async () => { throw new Error('网络失败'); }; await f.page.save();
  assert.equal(f.page.data.content, '仅用于测试'); assert.equal(f.page.data.busy, false);
  f.api.saveAnnouncement = async () => { throw Object.assign(new Error('权限撤销'), { code: 'FORBIDDEN' }); };
  await f.page.save(); assert.equal(f.page.data.isAdmin, false); assert.equal(f.page.data.content, '');
});
test('announcement admin ignores a completed write after leaving the page', async () => {
  const f = pageFixture('announcement-admin'); await f.page.onShow(); f.page.setData({ title: '公告', content: '正文' });
  let resolve; f.api.saveAnnouncement = () => new Promise(r => { resolve = r; });
  const pending = f.page.save(); f.page.onHide(); resolve({}); await pending;
  assert.equal(f.page.data.isAdmin, false); assert.equal(f.page.data.items.length, 0); assert.equal(f.page.data.busy, false);
});
test('about entries, one WX ID, natural truncation and activity button visibility use the requested layout', () => {
  const html = fs.readFileSync(path.join(root, 'pages/settings/settings.wxml'), 'utf8');
  const about = html.slice(html.indexOf('<view class="group-title">关于</view>'));
  assert.ok(about.indexOf('开发者公告') < about.indexOf('联系客服'));
  assert.ok(about.includes('open-type="contact"'));
  assert.equal((html.match(/data-id="{{accountDeviceId}}"/g) || []).length, 1);
  assert.ok(html.includes('>设备ID</text>')); assert.ok(!html.includes('>当前设备 ID</text>')); assert.ok(!html.includes('{{publicId}}'));
  assert.ok(html.includes('wx:if="{{referralEnabled}}" class="public-share"'));
  const css = fs.readFileSync(path.join(root, 'pages/settings/settings.wxss'), 'utf8');
  assert.match(css, /\.public-device-value[^}]*min-width: 0[^}]*text-overflow: ellipsis/);
  const activity = fs.readFileSync(path.join(root, 'pages/share-activity/share-activity.wxml'), 'utf8');
  assert.ok(activity.includes('wx:if="{{enabled}}" class="activity-primary" open-type="share"'));
});
test('global sharing wrapper honors manual control and returns lifecycle promises', async () => {
  let wrapped; const menus = [];
  const context = { Page: o => { wrapped = o; }, module: { exports: {} }, wx: { showShareMenu: () => menus.push('show'), hideShareMenu: () => menus.push('hide') } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/share.js'), 'utf8'), context);
  context.module.exports.install(); context.Page({ manualShareMenu: true, onShow: async () => 'done' });
  assert.equal(await wrapped.onShow(), 'done'); assert.deepEqual(menus, ['hide']);
});
