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
    connect(endpoint, connectOptions) { this.endpoint = endpoint; this.options = connectOptions; }
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
  return { store: moduleObject.exports, instances, memory };
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

test('a LAN-paired profile reconnects over LAN without a relay candidate it cannot authenticate', t => {
  const sandbox = storeSandbox(t);
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
  // 小程序首选是中继，但沙箱里取不到租赁：按候选链回退到局域网并提交档案。
  const pairing = sandbox.instances[0];
  commitPairing(sandbox, pairing, '87654321-4321-4321-8321-210987654321');
  const profile = sandbox.store.state.profiles[0];
  assert.equal(profile.relay, false, 'a LAN pairing keeps the profile direct');
  sandbox.store.init();
  const reconnect = sandbox.instances[sandbox.instances.length - 1];
  assert.equal(reconnect.endpoint, 'ws://192.168.1.20:3081/ws/mobile');
  assert.equal(reconnect.options.routeKind, 'lan');
  assert.equal(reconnect.options.relay, undefined,
    'a profile without relay credentials must not be handed a relay candidate');
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
