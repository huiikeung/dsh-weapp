'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const routeTable = require('../miniprogram/utils/route-table');
const runtime = require('../miniprogram/utils/runtime');
const { parse } = require('../miniprogram/utils/pairing');
const { GatewayClient } = require('../miniprogram/utils/gateway');

const raw = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');
const relayNodeId = '12345678-1234-4234-8234-123456789012';
const relayEntry = {
  relay: 'wss://dsh.ahwe.top/relay',
  nodeId: relayNodeId,
  agentPubKey: Buffer.alloc(32, 3).toString('base64'),
  gatewayName: '家里电脑',
  authMode: 'gateway'
};

function withWx(extra) {
  const storage = new Map();
  global.wx = Object.assign({
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key)
  }, extra || {});
  return storage;
}

// ---------- pure route selection ----------

test('classifyEndpoint sorts addresses into LAN and public families', () => {
  assert.equal(routeTable.classifyEndpoint('ws://192.168.1.20:3081/ws/mobile'), 'lan');
  assert.equal(routeTable.classifyEndpoint('ws://127.0.0.1:3081/ws/mobile'), 'lan');
  assert.equal(routeTable.classifyEndpoint('wss://nas.example.com/ws/mobile'), 'public');
  assert.equal(routeTable.classifyEndpoint('wss://192.168.1.20/ws/mobile'), 'lan', 'wss on a private host is still LAN');
  assert.equal(routeTable.classifyEndpoint('http://example.com'), null);
  assert.equal(routeTable.classifyEndpoint(''), null);
});

test('parseRouteTable reads the explicit routes field and drops invalid entries', () => {
  const table = routeTable.parseRouteTable({
    routes: {
      lan: ['ws://192.168.1.20:3081/ws/mobile', 'ws://192.168.1.20:3081/ws/mobile', 'not-a-url'],
      public: ['wss://nas.example.com/ws/mobile'],
      relay: relayEntry
    }
  });
  assert.deepEqual(table.lan, ['ws://192.168.1.20:3081/ws/mobile']);
  assert.deepEqual(table.public, ['wss://nas.example.com/ws/mobile']);
  assert.equal(table.relay.nodeId, relayNodeId);
  assert.equal(table.relay.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId);

  const broken = routeTable.parseRouteTable({
    routes: { lan: ['ws://10.0.0.2/ws/mobile'], public: [], relay: { ...relayEntry, agentPubKey: 'short' } }
  });
  assert.deepEqual(broken.lan, ['ws://10.0.0.2/ws/mobile']);
  assert.equal(broken.relay, null, 'an invalid relay entry is ignored, direct routes still work');
  assert.equal(routeTable.parseRouteTable({ routes: { relay: { ...relayEntry, relay: 'ws://insecure.example' } } }).relay, null);
  assert.equal(routeTable.parseRouteTable({ routes: { relay: { ...relayEntry, nodeId: '../bad' } } }).relay, null);
});

test('parseRouteTable derives the same table from legacy payloads without routes', () => {
  const table = routeTable.parseRouteTable({
    publicUrl: 'wss://nas.example.com/ws/mobile',
    endpoints: ['wss://nas.example.com/ws/mobile', 'ws://192.168.1.20:3081/ws/mobile']
  });
  assert.deepEqual(table.public, ['wss://nas.example.com/ws/mobile']);
  assert.deepEqual(table.lan, ['ws://192.168.1.20:3081/ws/mobile']);
  assert.equal(table.relay, null);
});

test('the mini program uses the managed relay as its public route and skips direct public', () => {
  const table = routeTable.parseRouteTable({
    routes: {
      lan: ['ws://192.168.1.20:3081/ws/mobile'],
      public: ['wss://nas.example.com/ws/mobile'],
      relay: relayEntry
    }
  });
  const wechat = routeTable.orderCandidates(table, { client: 'wechat' });
  assert.deepEqual(wechat.map(c => c.kind), ['relay', 'lan'],
    'the operator Cloudflare/reverse-proxy address is not in the WeChat socket domain list');
  assert.equal(wechat[0].relay.nodeId, relayNodeId);

  const native = routeTable.orderCandidates(table, { client: 'native' });
  assert.deepEqual(native.map(c => c.kind), ['public', 'lan'],
    'the App has no domain whitelist and no WeChat login, so it dials the public address directly');
});

test('orderCandidates puts the last working endpoint first without demoting a relay', () => {
  const table = routeTable.parseRouteTable({
    routes: { lan: ['ws://192.168.1.20:3081/ws/mobile'], public: ['wss://nas.example.com/ws/mobile'], relay: relayEntry }
  });
  const relayFirst = routeTable.orderCandidates(table, {
    client: 'wechat',
    preferred: 'wss://dsh.ahwe.top/relay/c/' + relayNodeId
  });
  assert.deepEqual(relayFirst.map(c => c.kind), ['relay', 'lan']);
  assert.ok(relayFirst[0].relay, 'the preferred relay endpoint keeps its relay metadata');

  const lanFirst = routeTable.orderCandidates(table, {
    client: 'wechat',
    preferred: 'ws://192.168.1.20:3081/ws/mobile'
  });
  assert.deepEqual(lanFirst.map(c => c.kind), ['lan', 'relay']);

  const publicFirst = routeTable.orderCandidates(table, {
    client: 'native',
    preferred: 'wss://nas.example.com/ws/mobile'
  });
  assert.deepEqual(publicFirst.map(c => c.kind), ['public', 'lan']);
});

test('onlyLocalAreaNetwork detects LAN-only candidate sets', () => {
  assert.equal(routeTable.onlyLocalAreaNetwork([{ kind: 'lan' }, { kind: 'lan' }]), true);
  assert.equal(routeTable.onlyLocalAreaNetwork([{ kind: 'lan' }, { kind: 'public' }]), false);
  assert.equal(routeTable.onlyLocalAreaNetwork([]), false);
});

// ---------- runtime detection ----------

test('runtime detection distinguishes the WeChat mini program from native containers', () => {
  const wechat = withWx({ getAccountInfoSync: () => ({ miniProgram: { appId: 'wx123' } }) });
  assert.equal(runtime.isWeChatMiniProgram(), true);
  assert.equal(runtime.clientKind(), 'wechat');
  delete global.wx;

  const native = withWx({});
  assert.equal(runtime.isWeChatMiniProgram(), false);
  assert.equal(runtime.clientKind(), 'native');
  delete global.wx;

  const broken = withWx({ getAccountInfoSync: () => { throw new Error('not available'); } });
  assert.equal(runtime.isWeChatMiniProgram(), false);
  assert.equal(runtime.clientKind(), 'native', 'an unusable probe degrades to native, never crashes');
  delete global.wx;
  assert.ok(wechat && native && broken);
});

// ---------- pairing payload to route table ----------

test('pairing attaches a route table to v2 payloads with routes', () => {
  const result = parse(raw({
    version: 2,
    publicUrl: 'wss://nas.example.com/ws/mobile',
    endpoints: ['wss://nas.example.com/ws/mobile', 'ws://192.168.1.20:3081/ws/mobile'],
    pairingCode: 'a'.repeat(43),
    expiresAt: Date.now() + 60000,
    gatewayId: '87654321-4321-4321-8321-210987654321',
    routes: {
      lan: ['ws://192.168.1.20:3081/ws/mobile'],
      public: ['wss://nas.example.com/ws/mobile'],
      relay: relayEntry
    }
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.routeTable.lan, ['ws://192.168.1.20:3081/ws/mobile']);
  assert.deepEqual(result.payload.routeTable.public, ['wss://nas.example.com/ws/mobile']);
  assert.equal(result.payload.routeTable.relay.nodeId, relayNodeId);
});

test('pairing keeps legacy payloads selectable by deriving the table', () => {
  const result = parse(raw({
    version: 2,
    publicUrl: 'ws://192.168.1.20:3081/ws/mobile',
    endpoints: ['ws://192.168.1.20:3081/ws/mobile'],
    pairingCode: 'b'.repeat(43),
    expiresAt: Date.now() + 60000
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.routeTable, { lan: ['ws://192.168.1.20:3081/ws/mobile'], public: [], relay: null });
});

test('v3 relay payloads carry a relay-only route table', () => {
  const result = parse(raw({
    version: 3, mode: 'relay', relay: relayEntry.relay, nodeId: relayNodeId,
    agentPubKey: relayEntry.agentPubKey, pairingCode: 'c'.repeat(43), expiresAt: Date.now() + 60000
  }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.routeTable.lan, []);
  assert.deepEqual(result.payload.routeTable.public, []);
  assert.equal(result.payload.routeTable.relay.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId);
});

// ---------- gateway client: candidate fallback and hints ----------

function socketFixture(t) {
  const sockets = [];
  const states = [];
  const storage = new Map([['appLanguage', 'en']]);
  global.wx = {
    getStorageSync: (key) => (key === 'dsh_device_id' ? 'fixture-device-id' : storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    // 托管中继的已保存凭据重连会先取一次公网租赁；沙箱里给它一个可用的登录桩，
    // 否则 connect() 在拿到 socket 之前就失败了。
    login: (options) => options && options.success && options.success({ code: 'fixture-login-code' }),
    request: (options) => options && options.success && options.success({ statusCode: 200, data: {} }),
    connectSocket(options) {
      const socket = {
        events: {},
        closed: false,
        onOpen(fn) { this.events.open = fn; },
        onMessage(fn) { this.events.message = fn; },
        onError(fn) { this.events.error = fn; },
        onClose(fn) { this.events.close = fn; },
        close() { this.closed = true; },
        send() {}
      };
      sockets.push({ options, socket });
      return socket;
    }
  };
  const client = new GatewayClient({
    onState(state, message) { states.push({ state, message }); }
  });
  t.after(() => { client.disconnect(); delete global.wx; });
  return { client, sockets, states, storage };
}

test('pairing walks the ordered candidates and reports each route kind', async t => {
  const f = socketFixture(t);
  f.client.connect('wss://nas.example.com/ws/mobile', {
    pairingCode: 'one-time-code',
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
    relayCandidates: [null],
    candidateKinds: ['public', 'lan'],
    routeKind: 'public'
  });
  f.sockets[0].options.fail({ errMsg: 'request:fail (public unreachable)' });
  assert.equal(f.client.state, 'connecting');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.sockets[1].options.url, 'ws://192.168.1.20:3081/ws/mobile');
  assert.equal(f.client.routeKind, 'lan', 'the fallback attempt carries its own route kind');
  assert.ok(f.sockets[1].options.protocols.includes('dsh-pair.one-time-code'));
});

test('the relay fallback keeps its E2EE metadata when direct routes fail', async t => {
  const f = socketFixture(t);
  f.client.connect('wss://nas.example.com/ws/mobile', {
    pairingCode: 'one-time-code',
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile', 'wss://relay.example.com/c/' + relayNodeId],
    relayCandidates: [null, {
      relay: 'wss://relay.example.com',
      nodeId: relayNodeId,
      agentPubKey: relayEntry.agentPubKey,
      authMode: 'gateway'
    }],
    candidateKinds: ['public', 'lan', 'relay'],
    routeKind: 'public'
  });
  f.sockets[0].options.fail({ errMsg: 'request:fail (public unreachable)' });
  await new Promise(resolve => setTimeout(resolve, 0));
  f.sockets[1].options.fail({ errMsg: 'request:fail (lan unreachable)' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.sockets.length, 3);
  assert.equal(f.sockets[2].options.url, 'wss://relay.example.com/c/' + relayNodeId);
  assert.equal(f.client.routeKind, 'relay');
  assert.equal(f.client.relayMeta.nodeId, relayNodeId,
    'the relay fallback must carry its E2EE metadata, not degrade to a plain socket');
  assert.equal(f.client.relayMeta.authMode, 'gateway');
  assert.equal(f.sockets[2].options.protocols.includes('dsh-pair.one-time-code'), false,
    'a gateway-auth relay receives the pairing code inside E2EE, not as a subprotocol');
});

test('a missing public lease during pairing falls back to the LAN candidate', async t => {
  const f = socketFixture(t);
  // 托管中继 + 未兑换：publicLease 在没有 wx.login/request 的沙箱里直接失败，
  // 必须继续候选链，否则没兑换的用户即使在同一局域网也连不上。
  f.client.connect('wss://dsh.ahwe.top/relay/c/' + relayNodeId, {
    pairingCode: 'one-time-code',
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey },
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
    relayCandidates: [null],
    candidateKinds: ['relay', 'lan'],
    routeKind: 'relay'
  });
  await flush();
  assert.equal(f.sockets.length, 1, 'the LAN candidate is attempted after the lease failure');
  assert.equal(f.sockets[0].options.url, 'ws://192.168.1.20:3081/ws/mobile');
  assert.equal(f.client.routeKind, 'lan');
  assert.ok(f.sockets[0].options.protocols.includes('dsh-pair.one-time-code'),
    'the one-time pairing code is still valid for the next candidate');
});

test('a relay-only QR reports the lease reason without blaming the pairing code', async t => {
  const f = socketFixture(t);
  f.client.connect('wss://dsh.ahwe.top/relay/c/' + relayNodeId, {
    pairingCode: 'one-time-code',
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey },
    candidateKinds: ['relay'],
    routeKind: 'relay'
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.client.state, 'failed');
  assert.doesNotMatch(f.states.at(-1).message, /pairing code expired/i,
    'the pairing code is still valid; the lease is what failed');
  assert.doesNotMatch(f.states.at(-1).message, /only contains LAN addresses/);
});

test('a relay rejection during pairing falls back to the LAN candidate', async t => {
  const f = socketFixture(t);
  // 自建中继（非托管）：connect() 直接走 E2EE，不经过租赁。
  f.client.connect('wss://relay.example.com/c/' + relayNodeId, {
    pairingCode: 'one-time-code',
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey },
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
    relayCandidates: [null],
    candidateKinds: ['relay', 'lan'],
    routeKind: 'relay'
  });
  // 中继报告电脑端连接器不在线（4001）：插件 direct 模式下连接器没跑就会这样。
  f.sockets[0].socket.events.close({ code: 4001, reason: 'gateway-offline' });
  await flush();
  assert.equal(f.sockets.length, 2, 'the LAN candidate is attempted after the relay rejection');
  assert.equal(f.sockets[1].options.url, 'ws://192.168.1.20:3081/ws/mobile');
  assert.equal(f.client.routeKind, 'lan');
  assert.ok(f.sockets[1].options.protocols.includes('dsh-pair.one-time-code'),
    'the pairing code survives a relay-side rejection');
});

test('a relay rejection during reconnect stays terminal with its reason', async t => {
  const f = socketFixture(t);
  f.client.connect('wss://relay.example.com/c/' + relayNodeId, {
    token: 'b'.repeat(43),
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey }
  });
  f.sockets[0].socket.events.close({ code: 4001, reason: 'gateway-offline' });
  assert.equal(f.client.state, 'failed');
  assert.match(f.states.at(-1).message, /public connector on the computer is offline/i,
    'saved-credential reconnects keep reporting the reason instead of silently switching lines');
  assert.equal(f.sockets.length, 1, 'no other line is attempted for a reconnect');
});

test('a gateway-auth rejection inside E2EE during pairing falls back to LAN', async t => {
  const f = socketFixture(t);
  f.client.connect('wss://relay.example.com/c/' + relayNodeId, {
    pairingCode: 'one-time-code',
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey },
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
    relayCandidates: [null],
    candidateKinds: ['relay', 'lan'],
    routeKind: 'relay'
  });
  // 连接器回拨网关被拒（DSH 未确认设备认证）：密封帧里的 relay-auth-error。
  f.client.relaySession = { ready: true };
  f.client.handleFrame(JSON.stringify({ kind: 'relay-auth-error', message: 'DSH 未确认设备认证' }));
  await flush();
  assert.equal(f.sockets.length, 2, 'the LAN candidate is attempted after the E2EE rejection');
  assert.equal(f.sockets[1].options.url, 'ws://192.168.1.20:3081/ws/mobile');
});

test('a LAN-only QR explains that the public route is missing', async t => {
  const f = socketFixture(t);
  f.client.connect('ws://192.168.1.20:3081/ws/mobile', {
    pairingCode: 'one-time-code',
    endpointCandidates: ['ws://192.168.1.21:3081/ws/mobile'],
    candidateKinds: ['lan', 'lan'],
    routeKind: 'lan'
  });
  f.sockets[0].options.fail({ errMsg: 'request:fail (lan unreachable)' });
  await new Promise(resolve => setTimeout(resolve, 0));
  f.sockets[1].options.fail({ errMsg: 'request:fail (lan unreachable)' });
  assert.equal(f.client.state, 'failed');
  assert.match(f.states.at(-1).message, /only contains LAN addresses/);
  assert.match(f.states.at(-1).message, /configure a public address or relay/);
});

test('a mixed-family QR does not claim the LAN-only cause', async t => {
  const f = socketFixture(t);
  f.client.connect('wss://nas.example.com/ws/mobile', {
    pairingCode: 'one-time-code',
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
    candidateKinds: ['public', 'lan'],
    routeKind: 'public'
  });
  f.sockets[0].options.fail({ errMsg: 'request:fail (public unreachable)' });
  await new Promise(resolve => setTimeout(resolve, 0));
  f.sockets[1].options.fail({ errMsg: 'request:fail (lan unreachable)' });
  assert.equal(f.client.state, 'failed');
  assert.doesNotMatch(f.states.at(-1).message, /only contains LAN addresses/);
});

// ---------- store: runtime-aware candidate ordering ----------

function storeSandbox(t, options) {
  const opts = options || {};
  const memory = new Map();
  const wx = {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    removeStorageSync: (key) => memory.delete(key),
    getAccountInfoSync: opts.wechat === false ? undefined : () => ({ miniProgram: { appId: 'wx-fixture' } })
  };
  global.wx = wx;
  const instances = [];
  class Client {
    constructor(cb) { this.cb = cb; instances.push(this); }
    connect(endpoint, connectOptions) {
      this.endpoint = endpoint;
      this.options = connectOptions;
      (this.connectCalls || (this.connectCalls = [])).push({ endpoint, options: connectOptions });
    }
    disconnect() {}
  }
  const moduleObject = { exports: {} };
  const file = path.join(__dirname, '..', 'miniprogram', 'utils', 'store.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: moduleObject, wx, Date, console,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require(name) { return name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(file), name)); }
  }, { filename: file });
  t.after(() => { delete global.wx; });
  return { store: moduleObject.exports, instances, memory, wx };
}

const fullRoutesPayload = (pairingCode) => ({
  version: 2,
  publicUrl: 'wss://nas.example.com/ws/mobile',
  endpoints: ['wss://nas.example.com/ws/mobile', 'ws://192.168.1.20:3081/ws/mobile'],
  pairingCode: pairingCode,
  expiresAt: Date.now() + 60000,
  gatewayId: '87654321-4321-4321-8321-210987654321',
  routes: {
    lan: ['ws://192.168.1.20:3081/ws/mobile'],
    public: ['wss://nas.example.com/ws/mobile'],
    relay: relayEntry
  }
});

// 回退链经由 setTimeout(0) 跳转，断言前多刷几个宏任务回合。
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
};

function commitPairing(sandbox, client, gatewayId) {
  client.lastToken = 'b'.repeat(43);
  client.cb.onPaired({ kind: 'paired', gatewayId, token: client.lastToken, device: { id: 'd' } });
  client.cb.onFrame({ kind: 'hello', gatewayId, gatewayName: 'DSH', device: { id: 'd' } });
}

test('the mini program pairs through the relay first and keeps the LAN fallback', t => {
  const sandbox = storeSandbox(t);
  const result = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(result.ok, true);
  const client = sandbox.instances[0];
  assert.equal(client.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId,
    'the relay is the mini program public route; the Cloudflare address is not offered');
  assert.deepEqual(client.options.endpointCandidates, ['ws://192.168.1.20:3081/ws/mobile']);
  assert.deepEqual(client.options.candidateKinds, ['relay', 'lan']);
  assert.equal(client.options.routeKind, 'relay');
  assert.equal(client.options.relay.nodeId, relayNodeId);
  // 沙箱里中继取不到租赁，按候选链回退到局域网并提交档案（routeTable 已持久化）。
  commitPairing(sandbox, client, '87654321-4321-4321-8321-210987654321');
  const profile = sandbox.store.state.profiles[0];
  assert.equal(profile.routeTable.relay.nodeId, relayNodeId, 'the full route table is persisted');
  assert.deepEqual(profile.endpoints, ['wss://nas.example.com/ws/mobile', 'ws://192.168.1.20:3081/ws/mobile']);
  assert.equal(profile.relay, false, 'a LAN win keeps the profile direct');
});

test('the multi-platform App pairs through the public address first', t => {
  const sandbox = storeSandbox(t, { wechat: false });
  const result = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(result.ok, true);
  const client = sandbox.instances[0];
  assert.equal(client.endpoint, 'wss://nas.example.com/ws/mobile');
  assert.deepEqual(client.options.endpointCandidates, ['ws://192.168.1.20:3081/ws/mobile']);
  assert.deepEqual(client.options.candidateKinds, ['public', 'lan'],
    'the App cannot use the managed relay, so it is not offered as a fallback');
  assert.equal(client.options.relay, undefined);
});

test('a LAN-paired profile can authenticate through its advertised gateway relay on cellular', t => {
  const sandbox = networkSandbox(t, { network: 'wifi' });
  sandbox.store.init();
  const result = sandbox.store.pairWithPayload(raw({
    version: 2,
    publicUrl: 'ws://192.168.1.20:3081/ws/mobile',
    endpoints: ['ws://192.168.1.20:3081/ws/mobile'],
    pairingCode: 'a'.repeat(43),
    expiresAt: Date.now() + 60000,
    gatewayId: '87654321-4321-4321-8321-210987654321',
    routes: { lan: ['ws://192.168.1.20:3081/ws/mobile'], public: [], relay: relayEntry }
  }));
  assert.equal(result.ok, true);
  // Simulate the initial relay candidate failing over to a LAN pairing.
  const pairing = sandbox.instances[0];
  pairing.endpoint = 'ws://192.168.1.20:3081/ws/mobile';
  pairing.routeKind = 'lan';
  pairing.cb.onState('connecting');
  commitPairing(sandbox, pairing, '87654321-4321-4321-8321-210987654321');
  const profile = sandbox.store.state.profiles[0];
  assert.equal(profile.relay, false, 'a LAN pairing keeps the profile direct');
  assert.equal(profile.preferredEndpoint, 'ws://192.168.1.20:3081/ws/mobile');

  // The gateway token issued by LAN pairing is also the device credential sent
  // inside the authenticated E2EE relay, so cellular startup should use it.
  sandbox.wx.getNetworkType = query => query.success({ networkType: '4g' });
  sandbox.store.init();
  const reconnect = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(reconnect.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId);
  assert.equal(reconnect.options.routeKind, 'relay');
  assert.deepEqual(reconnect.options.candidateKinds, ['relay']);
  assert.equal(reconnect.options.relay.authMode, 'gateway');
  assert.equal(reconnect.options.relay.nodeId, relayNodeId);
  assert.equal(reconnect.options.token, 'b'.repeat(43));
});

test('a relay-paired profile reconnects through the relay with its own node identity', t => {
  const sandbox = storeSandbox(t, { wechat: false });
  const result = sandbox.store.pairWithPayload(raw({
    version: 3, mode: 'relay', relay: relayEntry.relay, nodeId: relayNodeId,
    agentPubKey: relayEntry.agentPubKey, pairingCode: 'a'.repeat(43), expiresAt: Date.now() + 60000,
    accessExpiresAt: Date.now() + 86400000
  }));
  assert.equal(result.ok, true);
  commitPairing(sandbox, sandbox.instances[0], relayNodeId);
  sandbox.store.init();
  const reconnect = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(reconnect.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId);
  assert.equal(reconnect.options.routeKind, 'relay');
  assert.equal(reconnect.options.relay.nodeId, relayNodeId,
    'runtime detection must not strip the relay from an already paired relay profile');
  assert.equal(reconnect.options.token, 'b'.repeat(43));
});

test('legacy relay profiles without a route table rebuild their E2EE relay candidate', t => {
  const sandbox = storeSandbox(t);
  const profileId = '12345678-1234-4234-8234-123456789012';
  const endpoint = relayEntry.relay + '/c/' + relayNodeId;
  sandbox.memory.set('gateway.profiles.v1', JSON.stringify([{
    id: profileId,
    gatewayId: relayNodeId,
    gatewayName: 'DSH',
    endpoints: [endpoint],
    preferredEndpoint: endpoint,
    relay: true,
    relayAgentPubKey: relayEntry.agentPubKey,
    relayAuthMode: 'gateway'
  }]));
  sandbox.memory.set('gateway.activeID', profileId);
  sandbox.memory.set('dsh_creds.' + profileId, JSON.stringify({ endpoint, token: 'b'.repeat(43) }));

  sandbox.store.init();

  const reconnect = sandbox.instances[0];
  assert.equal(reconnect.endpoint, endpoint);
  assert.equal(reconnect.options.routeKind, 'relay');
  assert.deepEqual(reconnect.options.candidateKinds, ['relay']);
  assert.equal(reconnect.options.relay.nodeId, relayNodeId);
  assert.equal(reconnect.options.token, 'b'.repeat(43));
});

test('manual pairing refuses a public address in the mini program with a precise reason', t => {
  const wechat = storeSandbox(t);
  const refused = wechat.store.pairManual('wss://nas.example.com/ws/mobile', 'a'.repeat(43));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /不能直接连接公网地址/);
  assert.equal(wechat.instances[0].endpoint, undefined, 'no connection attempt is made');

  const native = storeSandbox(t, { wechat: false });
  // 白名单非空时，手动地址仍受「本机确认过的地址」约束（与运行时无关）。
  native.memory.set('dsh_trusted_endpoints', ['wss://other.example.com/ws/mobile']);
  const attempted = native.store.pairManual('wss://nas.example.com/ws/mobile', 'a'.repeat(43));
  assert.equal(attempted.ok, false);
  assert.match(attempted.error, /地址未经此主机确认/);
});

// ---------- 无缝热切换：按当前网络类型选路 ----------

test('networkFamily maps WeChat network types onto route families', () => {
  assert.equal(routeTable.networkFamily('wifi'), 'wifi');
  assert.equal(routeTable.networkFamily('2g'), 'cellular');
  assert.equal(routeTable.networkFamily('4g'), 'cellular');
  assert.equal(routeTable.networkFamily('5g'), 'cellular');
  assert.equal(routeTable.networkFamily('unknown'), '', 'unknown must not filter anything');
  assert.equal(routeTable.networkFamily('none'), '');
  assert.equal(routeTable.networkFamily(''), '');
  assert.equal(routeTable.networkFamily(undefined), '');
});

test('a cellular network drops every LAN candidate instead of burning an 8s timeout', () => {
  const table = routeTable.parseRouteTable({
    routes: { lan: ['ws://192.168.1.20:3081/ws/mobile'], public: ['wss://nas.example.com/ws/mobile'], relay: relayEntry }
  });
  const cellular = routeTable.orderCandidates(table, {
    client: 'wechat', network: '4g', preferred: 'ws://192.168.1.20:3081/ws/mobile'
  });
  assert.deepEqual(cellular.map(c => c.kind), ['relay'],
    'the LAN preferred endpoint is unreachable on cellular and is not tried at all');
  assert.deepEqual(routeTable.orderCandidates(table, { client: 'native', network: '5g' }).map(c => c.kind), ['public']);
  // WiFi / 未知：不过滤，保持原顺序。
  assert.deepEqual(routeTable.orderCandidates(table, { client: 'wechat', network: 'wifi' }).map(c => c.kind), ['relay', 'lan']);
  assert.deepEqual(routeTable.orderCandidates(table, { client: 'wechat' }).map(c => c.kind), ['relay', 'lan']);
});

test('promoteLan only reorders the families, it never invents a candidate', () => {
  const table = routeTable.parseRouteTable({
    routes: { lan: ['ws://192.168.1.20:3081/ws/mobile'], public: ['wss://nas.example.com/ws/mobile'], relay: relayEntry }
  });
  const promoted = routeTable.orderCandidates(table, {
    client: 'wechat', network: 'wifi', promoteLan: true, preferred: 'wss://dsh.ahwe.top/relay/c/' + relayNodeId
  });
  assert.deepEqual(promoted.map(c => c.kind), ['lan', 'relay'],
    'coming back onto WiFi puts the LAN ahead of the endpoint that worked on cellular');
  assert.equal(promoted[1].relay.nodeId, relayNodeId, 'the relay keeps its metadata');
  // 没有局域网候选时 promoteLan 什么也不做。
  const lanless = routeTable.parseRouteTable({ routes: { public: ['wss://nas.example.com/ws/mobile'], relay: relayEntry } });
  assert.deepEqual(routeTable.orderCandidates(lanless, { client: 'wechat', promoteLan: true }).map(c => c.kind), ['relay']);
});

// store 集成：网络类型真实参与选路，且网络族变化会触发一次重连。
function networkSandbox(t, options) {
  const opts = options || {};
  const sandbox = storeSandbox(t, opts);
  let changeHandler = null;
  sandbox.wx.getNetworkType = (query) => query.success({ networkType: opts.network || 'wifi' });
  sandbox.wx.onNetworkStatusChange = (handler) => { changeHandler = handler; };
  sandbox.fireNetworkChange = (payload) => { if (changeHandler) changeHandler(payload); };
  return sandbox;
}

// 把当前档案置成「中继档案」：只有它同时拥有中继凭据和网关 nodeId，重连时中继
// 才是合法候选（store 的 relayReady 判断）。v2 直连二维码连通中继后就是这么升级的。
function markRelayPaired(sandbox, network) {
  const profile = sandbox.store.state.profiles[0];
  profile.relay = true;
  profile.relayAgentPubKey = relayEntry.agentPubKey;
  profile.relayAuthMode = 'gateway';
  profile.gatewayId = relayNodeId;
  profile.preferredEndpoint = 'wss://dsh.ahwe.top/relay/c/' + relayNodeId;
  profile.preferredNetwork = network;
  return profile;
}

test('a cellular network switches the mini program off LAN without trying it first', t => {
  const sandbox = networkSandbox(t, { network: 'wifi' });
  sandbox.store.init();
  const paired = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(paired.ok, true);
  assert.deepEqual(sandbox.instances[0].options.candidateKinds, ['relay', 'lan'],
    'scanning on WiFi still offers the LAN candidate');
  commitPairing(sandbox, sandbox.instances[0], relayNodeId);
  // 模拟「曾经经中继连通过」：v2 直连二维码连通中继后，store 会把档案升级成中继档案
  // （routeKind === 'relay' 那个分支），这里直接把结果落到档案上。
  markRelayPaired(sandbox, 'wifi');

  // 手机离开局域网：网络族变了，就地重连，且不再去试局域网。
  sandbox.fireNetworkChange({ isConnected: true, networkType: '4g' });
  const cellularClient = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(cellularClient.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId,
    'the relay is used immediately; no LAN attempt is made');
  assert.deepEqual(cellularClient.options.candidateKinds, ['relay']);
});

test('coming back onto WiFi promotes the LAN ahead of the relay', t => {
  const sandbox = networkSandbox(t, { network: '4g' });
  sandbox.store.init();
  const paired = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(paired.ok, true);
  commitPairing(sandbox, sandbox.instances[0], relayNodeId);
  markRelayPaired(sandbox, 'cellular');
  const cellularClient = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(cellularClient.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId,
    'on cellular the relay stays the endpoint');
  assert.deepEqual(cellularClient.options.candidateKinds, ['relay'],
    'the LAN candidate is not offered at all on cellular');

  sandbox.fireNetworkChange({ isConnected: true, networkType: 'wifi' });
  const wifiClient = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(wifiClient.endpoint, 'ws://192.168.1.20:3081/ws/mobile', 'back home the LAN is tried first');
  assert.deepEqual(wifiClient.options.candidateKinds, ['lan', 'relay']);
});

test('a same-family network change does not disturb a working connection', t => {
  const sandbox = networkSandbox(t, { network: 'wifi' });
  sandbox.store.init();
  const paired = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(paired.ok, true);
  commitPairing(sandbox, sandbox.instances[0], '87654321-4321-4321-8321-210987654321');
  const before = sandbox.instances.length;
  // 4G→5G、换个 WiFi：同族变化，已有连接不被打扰。
  sandbox.fireNetworkChange({ isConnected: true, networkType: '5g' });
  assert.equal(sandbox.instances.length, before, 'no reconnect is forced inside the same family');
});

test('a LAN-paired profile switches to its gateway-auth relay when the network turns cellular', t => {
  const sandbox = networkSandbox(t, { network: 'wifi' });
  sandbox.store.init();
  const paired = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(paired.ok, true);
  // The one-time pairing fell back to LAN, but its saved device token remains
  // valid for the gateway-auth relay advertised by the same QR code.
  commitPairing(sandbox, sandbox.instances[0], '87654321-4321-4321-8321-210987654321');
  const profile = sandbox.store.state.profiles[0];
  assert.equal(profile.relay, false, 'the fixture is a LAN-paired profile');
  profile.preferredEndpoint = 'ws://192.168.1.20:3081/ws/mobile';
  profile.preferredNetwork = 'wifi';

  // Leaving WiFi should immediately route through the relay rather than dial
  // the now-unreachable saved LAN endpoint.
  sandbox.fireNetworkChange({ isConnected: true, networkType: '4g' });
  const cellularClient = sandbox.instances[sandbox.instances.length - 1];
  assert.deepEqual(cellularClient.options.candidateKinds, ['relay']);
  assert.equal(cellularClient.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId);
  assert.equal(cellularClient.options.relay.authMode, 'gateway');
  assert.equal(cellularClient.options.token, 'b'.repeat(43));
});

test('cold start on cellular corrects the initial LAN route as soon as network type resolves', t => {
  const sandbox = networkSandbox(t, { network: '4g' });
  let resolveNetworkType;
  sandbox.wx.getNetworkType = query => { resolveNetworkType = query.success; };
  const profileId = '12345678-1234-4234-8234-123456789012';
  const profile = {
    id: profileId,
    gatewayId: relayNodeId,
    gatewayName: 'DSH',
    endpoints: ['ws://192.168.1.20:3081/ws/mobile'],
    preferredEndpoint: 'ws://192.168.1.20:3081/ws/mobile',
    routeTable: {
      lan: ['ws://192.168.1.20:3081/ws/mobile'],
      public: [],
      relay: routeTable.normalizeRelay(relayEntry)
    },
    relay: true,
    relayAgentPubKey: relayEntry.agentPubKey,
    relayAuthMode: 'gateway'
  };
  sandbox.memory.set('gateway.profiles.v1', JSON.stringify([profile]));
  sandbox.memory.set('gateway.activeID', profileId);
  sandbox.memory.set('dsh_creds.' + profileId, JSON.stringify({
    endpoint: profile.preferredEndpoint,
    token: 'b'.repeat(43)
  }));

  sandbox.store.init();

  const client = sandbox.instances[0];
  assert.equal(client.connectCalls[0].endpoint, profile.preferredEndpoint,
    'the stored route is used before the asynchronous network query resolves');
  resolveNetworkType({ networkType: '4g' });
  const corrected = client.connectCalls[1];
  assert.equal(corrected.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId,
    'the resolved cellular network immediately replaces an unreachable saved LAN route');
  assert.deepEqual(corrected.options.candidateKinds, ['relay']);
});

test('a working connection is never torn down by a transient network report', t => {
  const sandbox = networkSandbox(t, { network: 'wifi' });
  sandbox.store.init();
  const paired = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(paired.ok, true);
  commitPairing(sandbox, sandbox.instances[0], relayNodeId);
  markRelayPaired(sandbox, 'wifi');
  // 沙箱的 Client 不会走完握手，这里显式把状态置为已连接，才能验到「不拆好连接」。
  sandbox.store.state.connection = 'connected';

  // 微信偶尔会报一次瞬时的 4g / unknown。曾经的实现按「网络族变了」就强制重连，
  // 于是一条好连接被拆掉；失败后候选 ≤1 又不再重试，真机表现就是连上一下就断、再也不回。
  const before = sandbox.instances.length;
  sandbox.fireNetworkChange({ isConnected: true, networkType: '4g' });
  assert.equal(sandbox.instances.length, before, 'a transient cellular report must not drop a live relay connection');

  sandbox.fireNetworkChange({ isConnected: true, networkType: 'unknown' });
  assert.equal(sandbox.instances.length, before, 'an unknown network type must not drop a live connection');

  // 回家连上 WiFi：中继照样能用，也不拆——下次自然重连会按新网络把局域网排到前面。
  sandbox.fireNetworkChange({ isConnected: true, networkType: 'wifi' });
  assert.equal(sandbox.instances.length, before, 'switching back to WiFi keeps the working relay until a natural reconnect');
});

test('a LAN connection is re-established as soon as the network turns cellular', t => {
  const sandbox = networkSandbox(t, { network: 'wifi' });
  sandbox.store.init();
  const paired = sandbox.store.pairWithPayload(raw(fullRoutesPayload('a'.repeat(43))));
  assert.equal(paired.ok, true);
  // 中继档案：有中继凭据，蜂窝下中继才是可用的公网线路。
  commitPairing(sandbox, sandbox.instances[0], relayNodeId);
  markRelayPaired(sandbox, 'cellular');
  // 先让 store 真正按「当前在 WiFi、上次在蜂窝」选一次路，把当前候选落在局域网上。
  sandbox.store.state.connection = 'disconnected';
  sandbox.fireNetworkChange({ isConnected: true, networkType: 'wifi' });
  const lanClient = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(lanClient.endpoint, 'ws://192.168.1.20:3081/ws/mobile', 'back on WiFi the LAN is used');
  sandbox.store.state.connection = 'connected';

  // 局域网线路在蜂窝下确定不可通，socket 迟早会断：这时才值得就地重连，直接走公网。
  sandbox.fireNetworkChange({ isConnected: true, networkType: '4g' });
  const after = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(after.endpoint, 'wss://dsh.ahwe.top/relay/c/' + relayNodeId,
    'the dead LAN route is replaced by the relay immediately');
  assert.deepEqual(after.options.candidateKinds, ['relay'], 'no LAN attempt is made on cellular');
});



test('a saved-credential relay rejection with an unknown reason refreshes the lease', async t => {
  const f = socketFixture(t);
  let leaseRefreshes = 0;
  let terminalFailures = 0;
  f.client.refreshManagedLease = () => { leaseRefreshes += 1; };
  f.client.handleAuthorizationFailure = () => { terminalFailures += 1; };
  // 预置一份仍在有效期内的公网租赁：命中缓存即可跳过 wx.login + 两次 HTTPS，
  // 直接拿到 relay socket——这正是手机上「已经兑换过」的状态。
  f.storage.set('public-access.grant.v1', JSON.stringify({
    nodeId: relayNodeId, token: 'c'.repeat(43), expiresAt: Date.now() + 3600000
  }));
  // 手机在蜂窝网络下走托管中继：连接由中继侧关断，reason 不一定是那两种已知值。
  // 这里只验证「路由到哪条分支」，租赁刷新的完整链路由 access-api 自己负责。
  f.client.connect('wss://dsh.ahwe.top/relay/c/' + relayNodeId, {
    token: 'b'.repeat(43),
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey }
  });
  await flush();
  assert.equal(f.sockets.length, 1, 'the relay socket is established');
  f.sockets[0].socket.events.close({ code: 4003, reason: 'lease-replaced' });
  assert.equal(leaseRefreshes, 1,
    'an unknown 4003 reason is treated as a lease problem and retried, not a dead credential');
  assert.equal(terminalFailures, 0, 'the credential is not declared dead');
});

test('a pairing-time relay rejection still walks the candidate chain', async t => {
  const f = socketFixture(t);
  f.storage.set('public-access.grant.v1', JSON.stringify({
    nodeId: relayNodeId, token: 'c'.repeat(43), expiresAt: Date.now() + 3600000
  }));
  let leaseRefreshes = 0;
  f.client.refreshManagedLease = () => { leaseRefreshes += 1; };
  f.client.connect('wss://dsh.ahwe.top/relay/c/' + relayNodeId, {
    pairingCode: 'one-time-code',
    relay: { authMode: 'gateway', nodeId: relayNodeId, agentPubKey: relayEntry.agentPubKey },
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
    relayCandidates: [null],
    candidateKinds: ['relay', 'lan'],
    routeKind: 'relay'
  });
  await flush();
  // 配对期：二维码里还有局域网候选，继续往下走，不刷新租赁、不终止。
  f.sockets[0].socket.events.close({ code: 4003, reason: 'lease-replaced' });
  assert.equal(leaseRefreshes, 0, 'pairing keeps walking the candidate chain');
  await flush();
  assert.equal(f.sockets.length, 2, 'the LAN candidate is attempted');
  assert.equal(f.sockets[1].options.url, 'ws://192.168.1.20:3081/ws/mobile');
});
