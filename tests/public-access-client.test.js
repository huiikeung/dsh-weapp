'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const endpoint = 'wss://dsh.ahwe.top/relay/c/fixture-node';
const relay = { nodeId: 'fixture-node', authMode: 'gateway', agentPubKey: 'fixture-key' };
function fixture(lease, cached) {
  const sockets = [], leases = [], timers = new Map();
  let onboardingPrompts = 0;
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
  let forgotten = 0;
  const access = { isManagedRelay: value => value === endpoint, publicLease(nodeId, deviceId) {
    leases.push({ nodeId, deviceId }); return lease();
  }, cachedLease(nodeId) { return forgotten ? null : (cached ? cached(nodeId) : null); },
  forgetGrant() { forgotten += 1; } };
  const publicAccessPrompt = { promptFirstAuthorizedUse(proceed) { onboardingPrompts++; proceed(); } };
  class Session { constructor() { this.hello = new Uint8Array([1]); } }
  const context = { module: { exports: {} }, wx, Date, Uint8Array, ArrayBuffer,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === './access-api') return access;
      if (name === './relay-e2ee') return { ClientSession: Session };
      if (name === './public-access-prompt') return publicAccessPrompt;
      return require(path.join(__dirname, '../miniprogram/utils', name));
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/gateway.js'), 'utf8'), context);
  const client = new context.module.exports.GatewayClient();
  client.reportDeviceInfo = () => {};
  return { client, sockets, leases, timers, onboardingPrompts: () => onboardingPrompts, forgotten: () => forgotten };
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
test('public entitlement error codes survive the gateway status callback', async () => {
  const error = Object.assign(new Error('Public access has expired'), { code: 'PUBLIC_ACCESS_EXPIRED' });
  const f = fixture(() => Promise.reject(error));
  const statuses = [];
  f.client.cb.onState = (...args) => statuses.push(args);
  await f.client.connect(endpoint, { relay });
  assert.deepEqual(statuses.at(-1), ['failed', 'Public access has expired', 'PUBLIC_ACCESS_EXPIRED', false]);
  assert.equal(f.onboardingPrompts(), 0, 'expired users never see the first-authorized-use prompt');
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
test('a still-valid cached lease opens the relay socket without any account-server round trip', async () => {
  const token = 'c'.repeat(43);
  const f = fixture(() => { throw new Error('must not ask the account server'); },
    nodeId => (nodeId === 'fixture-node' ? { token, expiresAt: Date.now() + 60000 } : null));
  f.client.connect(endpoint, { relay });
  // 同步直达 socket：不再等 wx.login + 两次 HTTPS
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].options.url, endpoint);
  assert.equal(f.sockets[0].options.protocols.includes('dsh-public.' + token), true);
  assert.equal(f.leases.length, 0, 'no lease request is made');
  assert.equal(f.onboardingPrompts(), 0, 'a cached grant already answered the first-use prompt');
  f.client.disconnect(); assert.equal(f.timers.size, 0);
});
test('a missing or foreign cached lease still falls back to the account server', async () => {
  const missing = fixture(() => Promise.resolve({ token: 'f'.repeat(43), expiresAt: Date.now() + 60000 }), () => null);
  await missing.client.connect(endpoint, { relay });
  assert.equal(missing.leases.length, 1);
  assert.equal(missing.sockets[0].options.protocols.includes('dsh-public.' + 'f'.repeat(43)), true);

  const foreign = fixture(() => Promise.resolve({ token: 'g'.repeat(43), expiresAt: Date.now() + 60000 }),
    nodeId => (nodeId === 'other-node' ? { token: 'x'.repeat(43), expiresAt: Date.now() + 60000 } : null));
  await foreign.client.connect(endpoint, { relay });
  assert.equal(foreign.leases.length, 1, 'a lease for another node must not be reused');
  assert.equal(foreign.sockets[0].options.protocols.includes('dsh-public.' + 'g'.repeat(43)), true);
  foreign.client.disconnect();
});
test('a relay rejection of the cached lease drops it and re-leases instead of retrying a dead token', async () => {
  const stale = 's'.repeat(43), fresh = 'n'.repeat(43);
  const f = fixture(
    () => Promise.resolve({ token: fresh, expiresAt: Date.now() + 60000 }),
    nodeId => (nodeId === 'fixture-node' ? { token: stale, expiresAt: Date.now() + 60000 } : null)
  );
  // 命中本地缓存的旧租赁：直接开 socket，不请求账号服务（正常快路径）。
  f.client.connect(endpoint, { relay });
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].options.protocols.includes('dsh-public.' + stale), true);
  assert.equal(f.leases.length, 0);

  // 服务端重启后内存里的租赁全部失效：中继以 4003 public-access-* 关闭连接。
  f.sockets[0].events.close({ code: 4003, reason: 'public-access-unavailable' });
  assert.equal(f.forgotten(), 1, 'the stale cached lease is discarded');
  assert.equal(f.client.state, 'connecting');

  const pending = [...f.timers.values()]; f.timers.clear();
  assert.equal(pending.length, 1, 'one immediate retry is scheduled');
  pending[0].fn();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(f.leases.length, 1, 'the retry asks the account server for a fresh lease');
  assert.equal(f.sockets.length, 2);
  assert.equal(f.sockets[1].options.protocols.includes('dsh-public.' + fresh), true);
  assert.equal(f.sockets[1].options.protocols.includes('dsh-public.' + stale), false);
});

test('the lease refresh retries only once, then surfaces the real reason', async () => {
  const stale = 's'.repeat(43);
  const expired = Object.assign(new Error('公网访问有效期已到期，请在设置→公网访问兑换续期；局域网连接不受影响。'), { code: 'PUBLIC_ACCESS_EXPIRED' });
  const f = fixture(() => Promise.reject(expired),
    nodeId => (nodeId === 'fixture-node' ? { token: stale, expiresAt: Date.now() + 60000 } : null));
  f.client.connect(endpoint, { relay });
  const statuses = [];
  f.client.cb.onState = (...args) => statuses.push(args);
  f.sockets[0].events.close({ code: 4003, reason: 'public-access-expired' });
  const pending = [...f.timers.values()]; f.timers.clear();
  pending.forEach(timer => timer.fn());
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  // 拿不到新租赁就停下，把真实原因交给用户，不能无限重连。
  assert.equal(f.client.state, 'failed');
  assert.equal(statuses.at(-1)[0], 'failed');
  assert.equal(statuses.at(-1)[1], expired.message);
  assert.equal(f.forgotten(), 1, 'the stale lease was dropped once, not repeatedly');
});
