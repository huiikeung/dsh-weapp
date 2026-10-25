'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  let definition;
  const api = { ensureAccount: async options => { assert.equal(options.freshLogin, true); return { isAdmin: true, grantReady: true }; }, codes: async () => [], createCode: async () => ({ code: 'fixture-code', id: 'fixture-id', expiresAt: Date.now() + 60000 }) };
  const context = {
    Page: value => { definition = value; },
    require: name => name.endsWith('ui-preferences') ? require('../miniprogram/utils/ui-preferences') : name.endsWith('access-api') ? api : name.endsWith('theme') ? { applyTo() {} } : { state: { profiles: [{ relay: true, gatewayId: 'fixture-node' }] } },
    wx: {}, Date
  };
  const file = path.join(__dirname, '../miniprogram/pages/redeem-admin/redeem-admin.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(update) { Object.assign(this.data, update); } };
  return { page, api, wx: context.wx };
}
test('direct navigation cannot reveal admin controls for ordinary accounts', async () => {
  const { page, api } = fixture();
  api.ensureAccount = async () => ({ isAdmin: false });
  api.codes = () => { throw new Error('Must not request admin data'); };
  await page.onShow();
  assert.equal(page.data.isAdmin, false);
  assert.equal(page.data.loading, false);
});
test('hiding clears codes and busy flags; stale generation cannot repopulate them', async () => {
  const { page, api } = fixture();
  await page.onShow();
  let finish;
  api.createCode = () => new Promise(resolve => { finish = resolve; });
  const pending = page.generate();
  assert.equal(page.data.busy, true);
  page.onHide();
  assert.equal(page.data.isAdmin, false);
  assert.equal(page.data.busy, false);
  finish({ code: 'must-not-appear', id: 'fixture', expiresAt: Date.now() + 60000 });
  await pending;
  assert.equal(page.data.generatedCode, '');
  await page.onShow();
  assert.equal(page.data.busy, false);
  assert.equal(page.data.isAdmin, true);
});
test('real service grant readiness gates generation', async () => {
  const { page, api } = fixture();
  api.ensureAccount = async () => ({ isAdmin: true, grantReady: false });
  api.createCode = () => { throw new Error('Unconfigured grant must not issue a code'); };
  await page.onShow();
  await page.generate();
  assert.equal(page.data.generatedCode, '');
  assert.equal(page.data.grantReady, false);
});
test('copy/delete use server admin actions and ignore stale copy results', async () => {
  const { page, api, wx } = fixture(); await page.onShow();
  const copied=[];wx.setClipboardData=x=>copied.push(x.data);wx.showModal=x=>{wx.modal=x;};
  api.copyCode=async id=>({code:'copied-'+id});
  await page.copyItem({currentTarget:{dataset:{id:'one'}}});assert.deepEqual(copied,['copied-one']);
  let deleted='';api.deleteCode=async id=>{deleted=id;};page.setData({generatedId:'one',generatedCode:'secret'});
  page.deleteItem({currentTarget:{dataset:{id:'one'}}});assert.equal(deleted,'');
  await wx.modal.success({confirm:true});assert.equal(deleted,'one');assert.equal(page.data.generatedCode,'');
  let done;api.copyCode=()=>new Promise(r=>{done=r;});
  const pending=page.copyItem({currentTarget:{dataset:{id:'two'}}});page.onHide();done({code:'stale'});await pending;
  assert.deepEqual(copied,['copied-one']);
});
test('the list flags only exhausted codes and counts them for the clear button', async () => {
  const { page, api } = fixture();
  const now = Date.now();
  api.codes = async () => [
    { id: 'used', days: 7, uses: 1, used: 1, expiresAt: now + 60000 },
    { id: 'open', days: 7, uses: 5, used: 2, expiresAt: now + 60000 },
    { id: 'expired', days: 3, uses: 1, used: 0, expiresAt: now - 1000 },
    { id: 'revoked', days: 3, uses: 2, used: 2, expiresAt: now + 60000, revokedAt: now - 500 }
  ];
  await page.onShow();
  assert.equal(page.data.usedCodeCount, 1, 'only the exhausted card counts');
  const byId = Object.fromEntries(page.data.items.map(item => [item.id, item]));
  assert.equal(byId.used.usedUp, true);
  assert.equal(byId.open.usedUp, false, 'a partially redeemed code stays');
  assert.equal(byId.expired.usedUp, false, 'expired codes keep their audit trail');
  assert.equal(byId.revoked.usedUp, false, 'revoked codes are not swept up');
});

test('one-tap clear deletes exactly the used-up codes after confirmation', async () => {
  const { page, api, wx } = fixture();
  const now = Date.now();
  let items = [
    { id: 'used', days: 7, uses: 1, used: 1, expiresAt: now + 60000 },
    { id: 'open', days: 7, uses: 5, used: 1, expiresAt: now + 60000 }
  ];
  const deleted = [];
  api.codes = async () => items.map(item => ({ ...item }));
  api.deleteCode = async id => { deleted.push(id); items = items.filter(item => item.id !== id); };
  wx.showModal = update => { wx.modal = update; };
  wx.showToast = update => { wx.toast = update; };
  await page.onShow();

  page.clearUsedCodes();
  assert.deepEqual(deleted, [], 'nothing is deleted before the modal is confirmed');
  await wx.modal.success({ confirm: false });
  assert.deepEqual(deleted, [], 'cancelling keeps every code');
  assert.equal(page.data.actionId, '');

  page.clearUsedCodes();
  assert.match(wx.modal.content, /1/, 'the modal names how many codes will go');
  await wx.modal.success({ confirm: true });
  assert.deepEqual(deleted, ['used'], 'partially redeemed codes survive');
  assert.equal(page.data.usedCodeCount, 0, 'the button disappears with the last used-up code');
  assert.match(wx.toast.title, /1/);
  assert.equal(page.data.items.length, 1);
});

test('clearing is a no-op when every code is still redeemable', async () => {
  const { page, api, wx } = fixture();
  api.codes = async () => [{ id: 'open', days: 7, uses: 5, used: 1, expiresAt: Date.now() + 60000 }];
  wx.showModal = update => { wx.modal = update; };
  await page.onShow();
  assert.equal(page.data.usedCodeCount, 0);
  page.clearUsedCodes();
  assert.equal(wx.modal, undefined, 'no confirmation without used-up codes');
});
test('the clear button sits between the list title and refresh', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/redeem-admin/redeem-admin.wxml'), 'utf8');
  const head = wxml.slice(wxml.indexOf('admin-list-head'), wxml.indexOf('code-item'));
  const titleAt = head.indexOf('最近生成');
  const clearAt = head.indexOf('bindtap="clearUsedCodes"');
  const refreshAt = head.indexOf('bindtap="refresh"');
  assert.ok(titleAt > -1, 'the list title stays');
  assert.ok(clearAt > titleAt && refreshAt > clearAt, '清空已用完 sits between 最近生成 and 刷新');
  assert.match(head, /wx:if="\{\{usedCodeCount && !loading\}\}"/, 'the button only shows when something can be cleared');
  assert.match(head, /admin-link admin-link-danger/, 'the clear action reads as destructive');
  const dictionary = require('../miniprogram/i18n/interface');
  for (const key of ['清空已用完', '清空已用完的兑换码', '清空', '清空失败',
    '将删除 {n} 个已用完的兑换码，已兑换的公网时长不受影响。', '已清空 {n} 个兑换码', '{n} 个兑换码删除失败，请重试']) {
    assert.ok(dictionary[key], 'missing translation: ' + key);
  }
});
