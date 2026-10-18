'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  let definition, nextTimer = 0; const timers = new Map();
  const state = { nodes: [{ id: 'server-node', name: '电脑', managedPairingReady: true, online: true }], durations: [3, 7, 30, 180, 365].map(days => ({ days, label: days + ' 天' })), items: [], syncedAt: Date.now() };
  const api = { ensureAccount: async options => { assert.equal(options.freshLogin, true); return { isAdmin: true }; }, pairings: async () => state, createPairing: async () => { throw new Error('Unexpected generation'); } };
  const wx = { showModal: options => { wx.modal = options; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/pairing-admin/pairing-admin.js'), 'utf8'), {
    Page: value => { definition = value; }, require: name => name.endsWith('access-api') ? api : { applyTo() {} }, wx, Date,
    setInterval: (fn, delay) => { assert.equal(delay, 10000); timers.set(++nextTimer, fn); return nextTimer; }, clearInterval: id => timers.delete(id)
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(update) { Object.assign(this.data, update); } };
  return { page, api, state, timers, wx };
}
test('pairing admin verifies WeChat identity and denies direct ordinary-user navigation', async () => {
  const { page, api, timers } = fixture(); api.ensureAccount = async () => ({ isAdmin: false });
  api.pairings = () => { throw new Error('Must not fetch administrator data'); };
  await page.onShow(); await page.generate();
  assert.equal(page.data.isAdmin, false); assert.equal(page.data.loading, false); assert.equal(timers.size, 0);
});
test('miniapp uses backend nodes and all five durations, then reflects shared history', async () => {
  const { page, api, state, timers } = fixture(); await page.onShow();
  assert.deepEqual(Array.from(page.data.durations, d => d.days), [3, 7, 30, 180, 365]);
  assert.equal(page.data.nodes[0].id, 'server-node'); assert.equal(page.data.durations[page.data.durationIndex].days, 30);
  page.pickDuration({ detail: { value: '4' } });
  api.createPairing = async (node, days) => {
    assert.equal(node, 'server-node'); assert.equal(days, 365);
    const result = { id: 'managed', qrPayload: 'fixture-pair-code', days, nodeName: '电脑', source: 'weapp', status: 'pending', accessExpiresAt: Date.now() + days * 86400000, expiresAt: Date.now() + 300000 };
    state.items = [result]; return result;
  };
  await page.generate(); assert.equal(page.data.generatedCode, 'fixture-pair-code');
  assert.equal(page.data.items[0].originLabel, '小程序签发'); assert.equal(timers.size, 1);
  state.items[0].status = 'active'; await page.sync(); assert.equal(page.data.generatedCode, '');
  assert.equal(page.data.items[0].statusLabel, '使用中');
  page.onHide(); assert.equal(timers.size, 0);
});
test('offline or unextended gateways cannot issue misleading duration codes', async () => {
  const { page, state } = fixture(); state.nodes[0].managedPairingReady = false;
  await page.onShow(); await page.generate(); assert.equal(page.data.generatedCode, ''); assert.equal(page.data.selectedReady, false); page.onUnload();
});
test('hiding cancels visibility of pending generation and clears polling timers', async () => {
  const { page, api, timers } = fixture(); await page.onShow();
  let finish; api.createPairing = () => new Promise(resolve => { finish = resolve; });
  const pending = page.generate(); assert.equal(page.data.busy, true); page.onHide();
  finish({ id: 'must-not-appear', qrPayload: 'secret', expiresAt: Date.now() + 10000 }); await pending;
  assert.equal(page.data.generatedCode, ''); assert.equal(page.data.isAdmin, false); assert.equal(page.data.busy, false); assert.equal(timers.size, 0);
});
test('revocation waits for server confirmation and admin permission loss clears results', async () => {
  const { page, api, state, wx, timers } = fixture();
  state.items = [{ id: 'managed', nodeName: '电脑', days: 3, status: 'active', source: 'web' }]; await page.onShow();
  api.revokePairing = async id => { assert.equal(id, 'managed'); state.items[0].status = 'revoking'; };
  page.revoke({ currentTarget: { dataset: { id: 'managed' } } }); await wx.modal.success({ confirm: true });
  assert.equal(page.data.items[0].statusLabel, '等待设备确认停用');
  api.pairings = async () => { throw Object.assign(new Error('已移除管理员'), { code: 'FORBIDDEN' }); };
  await page.sync(); assert.equal(page.data.isAdmin, false); assert.equal(page.data.items.length, 0); assert.equal(timers.size, 0);
});
