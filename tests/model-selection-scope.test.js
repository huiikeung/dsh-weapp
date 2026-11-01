const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const filename = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} };
  const calls = [];
  class Client {
    constructor(callbacks) { this.callbacks = callbacks; this.connectGeneration = 1; this.state = 'connected'; return new Proxy(this, {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => { calls.push({ method: key, args }); return true; };
      }
    }); }
    selectModel(...args) { calls.push({ method: 'selectModel', args }); return Promise.resolve(true); }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Date, console,
    wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    require(name) { return name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(filename), name)); }
  });
  const store = module.exports;
  store.client.state = 'connected';
  return { store, calls };
}

test('model selection stays scoped to the session that changed it', async () => {
  const { store, calls } = fixture();
  store.state.modelCatalog = { current: { provider: 'default-p', model: 'default-m' }, groups: [] };

  store.openSession('session-a', 'A');
  await store.selectModel('session-a', 'p1', 'm1', 'low');
  assert.deepEqual(plain(store.sessionState.selection), { provider: 'p1', model: 'm1', reasoningEffort: 'low' });
  assert.equal(calls.filter(c => c.method === 'selectModel')[0].args[0], 'session-a', 'the host request carries the session id');

  // 切换到另一个历史会话：不应继承上一个会话的选择。
  store.openSession('session-b', 'B');
  assert.equal(store.sessionState.selection, null, 'another session must not inherit the selection');
  assert.deepEqual(plain(store.state.modelCatalog.current), { provider: 'default-p', model: 'default-m' },
    'the default model is untouched by a session-scoped switch');

  // 切回原会话：恢复它自己的选择。
  store.openSession('session-a', 'A');
  assert.deepEqual(plain(store.sessionState.selection), { provider: 'p1', model: 'm1', reasoningEffort: 'low' });

  // 新建会话（空 id 的临时会话）同样从默认模型开始。
  store.openSession('session-new', 'New');
  assert.equal(store.sessionState.selection, null);
  assert.deepEqual(plain(store.state.modelCatalog.current), { provider: 'default-p', model: 'default-m' });
});

test('host select-model receipts update only the active session and the default stays put', () => {
  const { store } = fixture();
  store.state.modelCatalog = { current: { provider: 'default-p', model: 'default-m' }, groups: [] };
  store.openSession('session-a', 'A');
  store.client.callbacks.onFrame({ kind: 'select-model', sessionId: 'session-a', selected: { provider: 'p2', model: 'm2' } });
  assert.deepEqual(plain(store.sessionState.selection), { provider: 'p2', model: 'm2' });
  assert.deepEqual(plain(store.state.modelCatalog.current), { provider: 'default-p', model: 'default-m' });
  store.openSession('session-c', 'C');
  assert.equal(store.sessionState.selection, null);
});
