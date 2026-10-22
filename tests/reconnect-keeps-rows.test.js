// 回归测试：重连时不得清空会话内容。
//
// 背景：wx.chooseMedia / wx.chooseMessageFile 这类原生选择器会触发
// app.onHide → app.onShow，store.appDidBecomeActive() 随即重连。
// 重连曾经把 sessionState.rows 清空，页面因此闪出空态/骨架屏
// （用户看到的「选完图片页面重新加载」）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const memory = new Map();
global.wx = {
  getStorageSync: k => memory.get(k),
  setStorageSync: (k, v) => memory.set(k, v),
  removeStorageSync: k => memory.delete(k)
};

const instances = [];
class Client {
  constructor(cb) { this.cb = cb; instances.push(this); this.connectGeneration = 0; }
  connect(endpoint, options) { this.endpoint = endpoint; this.options = options; }
  disconnect() { this.connectGeneration = (this.connectGeneration || 0) + 1; }
  requestHistory() { return true; }
  subscribe() { return true; }
  requestQueue() { return Promise.resolve({}); }
  requestSessionStats() { return Promise.resolve({}); }
  requestContextUsage() { return Promise.resolve({}); }
  requestPermissionOptions() { return Promise.resolve({}); }
  requestModels() { return Promise.resolve({}); }
  requestCommands() { return Promise.resolve({}); }
  requestTasks() { return Promise.resolve({}); }
  requestGoal() { return Promise.resolve({}); }
  requestWorkspaces() { return Promise.resolve({}); }
  requestSessions() { return Promise.resolve({}); }
  requestHost() { return Promise.resolve({}); }
  requestDefaults() { return Promise.resolve({}); }
  requestDefaultModel() { return Promise.resolve({}); }
  requestAgentPresets() { return Promise.resolve({}); }
}

const moduleObject = { exports: {} };
const file = path.join(__dirname, '../miniprogram/utils/store.js');
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  module: moduleObject, wx: global.wx, Date, console, JSON, Math, Set, Map, Array, Object, Number, String, Boolean, Error, Promise, RegExp,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  require(name) { return name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(file), name)); }
}, { filename: file });

const store = moduleObject.exports;
const nodeId = '12345678-1234-4234-8234-123456789012';
const gatewayId = '87654321-4321-4321-8321-210987654321';
const payload = {
  version: 3, mode: 'relay', relay: 'wss://relay.example.com', nodeId,
  agentPubKey: Buffer.alloc(32, 1).toString('base64'), pairingCode: 'a'.repeat(43),
  expiresAt: Date.now() + 60000, accessDays: 365, accessExpiresAt: Date.now() + 365 * 86400000,
  hostPlatform: 'linux'
};
const result = store.pairWithPayload(Buffer.from(JSON.stringify(payload)).toString('base64url'));
assert.equal(result.ok, true);
const client = instances[0];
client.lastToken = 'b'.repeat(43);
client.cb.onPaired({ kind: 'paired', gatewayId, token: client.lastToken, device: { id: 'test-device' } });
client.cb.onFrame({ kind: 'hello', gatewayId, gatewayName: 'DSH', device: { id: 'test-device' } });
client.cb.onFrame({ kind: 'hello', gatewayId, gatewayPackage: 'dsh-plugin-weapp-gateway', gatewayVersion: '0.8.6' });
store.init();

// 打开一个会话并注入若干历史事件，使页面有内容可显示。
store.openSession('sess-reconnect', 'Reconnect', 'C:\\work', null);
client.cb.onFrame({
  kind: 'history',
  events: [
    { type: 'user/message', seq: 1, time: 1000, data: { text: 'hello' } },
    { type: 'assistant/message', seq: 2, time: 1001, data: { turn: 1, text: 'world' } }
  ]
});
const rowsBefore = store.sessionState.rows.length;
assert.ok(rowsBefore > 0, 'history frame should populate rows');

// 模拟原生选择器返回后 app.onShow 触发的重连：连接状态回调为 connected。
client.cb.onState('connected');
assert.equal(
  store.sessionState.rows.length, rowsBefore,
  'reconnect must not clear rows: clearing them makes the page flash the empty/loading state'
);
assert.equal(store.sessionState.rowsAgg.rows.length, rowsBefore, 'reconnect must keep the aggregator intact');

// 重连后再次推送历史，事件按 seq 去重，不应产生重复行。
client.cb.onFrame({
  kind: 'history',
  events: [
    { type: 'user/message', seq: 1, time: 1000, data: { text: 'hello' } },
    { type: 'assistant/message', seq: 2, time: 1001, data: { turn: 1, text: 'world' } },
    { type: 'user/message', seq: 3, time: 1002, data: { text: 'again' } }
  ]
});
assert.ok(
  store.sessionState.rows.length >= rowsBefore,
  'rows must never shrink after a reconnect + history replay'
);

delete global.wx;
console.log('reconnect keeps session rows (no page reload flash): PASS');
