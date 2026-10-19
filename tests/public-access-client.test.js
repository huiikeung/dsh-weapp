'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const endpoint = 'wss://dsh.ahwe.top/relay/c/fixture-node';
const relay = { nodeId: 'fixture-node', authMode: 'gateway', agentPubKey: 'fixture-key' };
function fixture(lease) {
  const sockets = [], leases = [], timers = new Map();
  let timerId = 0;
  const wx = {
    getStorageSync: () => 'fixture-device', setStorageSync() {},
    login() { throw new Error('LAN must not call wx.login'); },
    request() { throw new Error('LAN must not call wx.request'); },
    connectSocket(options) {
      const socket = { options, events: {}, sent: [], closed: false,
        onOpen(fn) { this.events.open = fn; }, onMessage(fn) { this.events.message = fn; },
        onClose(fn) { this.events.close = fn; }, onError(fn) { this.events.error = fn; },
        send(frame) { this.sent.push(frame); }, close() { this.closed = true; } };
      sockets.push(socket); return socket;
    }
  };
  const access = { isManagedRelay: value => value === endpoint, publicLease(nodeId, deviceId) {
    leases.push({ nodeId, deviceId }); return lease();
  } };
  class Session { constructor() { this.hello = new Uint8Array([1]); } }
  const context = { module: { exports: {} }, wx, Date, Uint8Array, ArrayBuffer,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === './access-api') return access;
      if (name === './relay-e2ee') return { ClientSession: Session };
      return require(path.join(__dirname, '../miniprogram/utils', name));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/gateway.js'), 'utf8'), context);
  const client = new context.module.exports.GatewayClient();
  client.reportDeviceInfo = () => {};
  return { client, sockets, leases, timers };
}
test('LAN, direct WSS and self-hosted relay never depend on public subscription', () => {
  const f = fixture(() => { throw new Error('subscription unavailable'); });
  for (const url of ['ws://192.168.1.20:8090', 'wss://own.example.test/gateway', 'wss://own.example.test/relay/c/fixture-node']) {
    f.client.connect(url, { token: 'own-device-credential' });
    assert.equal(f.sockets.at(-1).options.url, url);
    assert.equal(f.sockets.at(-1).options.header.Authorization, 'Bearer own-device-credential');
    assert.deepEqual(Array.from(f.sockets.at(-1).options.protocols), ['dsh-mobile-v1']);
  }
  assert.equal(f.leases.length, 0); f.client.disconnect();
});
test('expired or unavailable public account cannot open a relay socket', async () => {
  const f = fixture(() => Promise.reject(new Error('公网已到期')));
  await f.client.connect(endpoint, { relay });
  assert.equal(f.sockets.length, 0); assert.equal(f.client.state, 'failed');
  assert.equal(f.leases.length, 1); f.client.disconnect();
});
test('switching to LAN cancels in-flight subscription response and ignores stale socket events', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  const pending = f.client.connect(endpoint, { relay });
  f.client.connect('ws://192.168.1.20:8090', { token: 'local' });
  resolve({ token: 'x'.repeat(43), expiresAt: Date.now() + 60000 }); await pending;
  assert.equal(f.sockets.length, 1);
  const old = f.sockets[0];
  f.client.connect('ws://192.168.1.21:8090', { token: 'second-local' });
  old.events.close({ code: 4003, reason: 'public-access-expired' });
  old.events.error({ errMsg: 'stale error' });
  assert.equal(f.client.state, 'connecting'); assert.equal(f.sockets[1].closed, false);
  f.client.disconnect();
});
test('reconnect gets a fresh lease but reuses only encrypted device token, not one-time code', async () => {
  let sequence = 0;
  const f = fixture(() => Promise.resolve({ token: String(++sequence).repeat(43), expiresAt: Date.now() + 60000 }));
  await f.client.connect(endpoint, { relay, pairingCode: 'one-time-device-code' });
  const first = f.sockets[0]; first.events.open();
  assert.deepEqual(Array.from(first.options.protocols), ['dsh-mobile-v1', 'dsh-public.' + '1'.repeat(43), 'dsh-gateway-auth']);
  assert.equal(first.options.header.Authorization, undefined);
  f.client.handleFrame(JSON.stringify({ kind: 'paired', token: 'saved-device-token' }));
  f.client.handleFrame(JSON.stringify({ kind: 'hello' }));
  assert.equal(f.client.state, 'connected'); assert.equal(f.client.pairingCode, null);
  await f.client.connect(endpoint, f.client.lastConnectOpts);
  assert.equal(f.leases.length, 2);
  assert.equal(f.sockets[1].options.protocols.includes('dsh-public.' + '2'.repeat(43)), true);
  assert.equal(f.client.lastConnectOpts.token, 'saved-device-token');
  assert.equal(f.sockets[1].options.header.Authorization, undefined);
  assert.equal(f.sockets[1].options.protocols.some(p => p.startsWith('dsh-pair.')), false);
  f.client.disconnect(); assert.equal(f.timers.size, 0);
});
