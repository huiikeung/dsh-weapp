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
    require: name => name.endsWith('access-api') ? api : name.endsWith('theme') ? { applyTo() {} } : { state: { profiles: [{ relay: true, gatewayId: 'fixture-node' }] } },
    wx: {}, Date
  };
  const file = path.join(__dirname, '../pages/redeem-admin/redeem-admin.js');
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
