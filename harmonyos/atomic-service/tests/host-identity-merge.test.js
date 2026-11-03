'use strict';

// 回归：同一台主机的「局域网 / 公网 / 中继」是同一份主机档案的不同线路，
// 不能分裂成两个主机条目，也不能因此多连一条 socket。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../ascf/ascf_src');
const storeFile = path.join(root, 'utils/store.js');
const pairingFile = path.join(root, 'utils/pairing.js');

const LAN = 'wss://192.168.1.10:3081/ws/mobile';
const LAN_V6 = 'wss://[fd00::1a]:3081/ws/mobile';
const PUBLIC = 'wss://dsh.example.test/ws/mobile';
const RELAY_BASE = 'wss://relay.example.test/relay';
const NODE_ID = 'node-12345678';
const REAL_GATEWAY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AGENT_PUB = Buffer.alloc(32, 7).toString('base64');
const CODE = 'pairing-code-1234567890';

function encode(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function loadPairing(t) {
  const previousHas = global.has;
  global.has = { getStorageSync: () => undefined };
  t.after(() => {
    if (previousHas === undefined) delete global.has;
    else global.has = previousHas;
  });
  delete require.cache[pairingFile];
  return require(pairingFile);
}

function boot(t, storedProfiles, activeID) {
  const storage = new Map();
  const clients = [];
  storage.set('gateway.profiles.v1', JSON.stringify(storedProfiles));
  storage.set('gateway.activeID', activeID || (storedProfiles[0] && storedProfiles[0].id));
  for (const profile of storedProfiles) {
    if (profile.__token) {
      storage.set('dsh_creds.' + profile.id, JSON.stringify({ endpoint: profile.preferredEndpoint, token: profile.__token }));
      delete profile.__token;
    }
  }

  class Client {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.connectGeneration = 1;
      this.state = 'connecting';
      this.connectCalls = [];
      this.relayMeta = null;
      this.routeKind = null;
      this.lastToken = null;
      clients.push(this);
      return new Proxy(this, {
        get(target, key) {
          if (key in target) return target[key];
          return () => Promise.resolve(null);
        }
      });
    }
    connect(endpoint, options) {
      this.connectCalls.push({ endpoint, options });
      this.state = 'connecting';
      this.callbacks.onState('connecting');
    }
    disconnect() { this.state = 'disconnected'; }
    handleTransportFailure(message) { this.callbacks.onState('failed', message); }
    setHeartbeatEnabled() {}
    ping() { return Promise.resolve({ kind: 'pong' }); }
  }

  const has = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  };
  const previousHas = global.has;
  global.has = has;
  t.after(() => {
    if (previousHas === undefined) delete global.has;
    else global.has = previousHas;
  });

  const timers = new Set();
  const trackedTimeout = (fn, delay, ...args) => { const id = setTimeout(fn, delay, ...args); timers.add(id); return id; };
  const trackedClear = id => { timers.delete(id); clearTimeout(id); };
  const trackedInterval = (fn, delay, ...args) => { const id = setInterval(fn, delay, ...args); timers.add(id); return id; };
  const trackedClearInterval = id => { timers.delete(id); clearInterval(id); };
  t.after(() => { timers.forEach(id => { clearTimeout(id); clearInterval(id); }); timers.clear(); });

  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(storeFile, 'utf8'), {
    module, has, Date, console,
    setTimeout: trackedTimeout, clearTimeout: trackedClear,
    setInterval: trackedInterval, clearInterval: trackedClearInterval,
    require(name) {
      return name === './gateway'
        ? { GatewayClient: Client }
        : require(path.resolve(path.dirname(storeFile), name));
    }
  }, { filename: storeFile });

  const store = module.exports;
  store.init();
  return { store, client: clients[0], storage };
}

function helloFrame(overrides) {
  return Object.assign({
    kind: 'hello',
    gatewayId: REAL_GATEWAY_ID,
    gatewayName: '0the.local',
    capabilities: [],
    protocol: 3
  }, overrides || {});
}

function v2LanPayload() {
  return encode({
    version: 2,
    publicUrl: LAN,
    endpoints: [LAN],
    routes: { lan: [LAN], public: [] },
    pairingCode: CODE,
    expiresAt: Date.now() + 60000,
    gatewayId: REAL_GATEWAY_ID,
    gatewayName: '0the.local'
  });
}

function v3RelayPayload(includeGatewayId) {
  const payload = {
    version: 3,
    mode: 'relay',
    relay: RELAY_BASE,
    nodeId: NODE_ID,
    agentPubKey: AGENT_PUB,
    pairingCode: CODE,
    expiresAt: Date.now() + 60000,
    gatewayName: '0the.local'
  };
  if (includeGatewayId !== false) payload.gatewayId = REAL_GATEWAY_ID;
  return encode(payload);
}

test('v3 中继载荷把网关 UUID 与中继 nodeId 分开，旧载荷退回 nodeId', t => {
  const pairing = loadPairing(t);
  const parsed = pairing.parse(v3RelayPayload(), Date.now());
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.payload.gatewayId, REAL_GATEWAY_ID);
  assert.equal(parsed.payload.relayNodeId, NODE_ID);
  assert.equal(parsed.payload.nodeId, NODE_ID);

  const legacy = pairing.parse(v3RelayPayload(false), Date.now());
  assert.equal(legacy.ok, true, legacy.error);
  assert.equal(legacy.payload.gatewayId, NODE_ID, '旧插件没有 gatewayId 时退回 nodeId，连上后由 hello 校正');
  assert.equal(legacy.payload.relayNodeId, NODE_ID);
});

test('先扫局域网码再扫中继码：复用同一份主机档案，线路取并集', t => {
  const { store, client } = boot(t, []);
  const first = store.pairWithPayload(v2LanPayload());
  assert.equal(first.ok, true, first.error);
  // 局域网配对是直连模式：身份在 paired/hello 时才提交入库
  client.callbacks.onPaired({ kind: 'paired', token: 'device-token', gatewayId: REAL_GATEWAY_ID, gatewayName: '0the.local' });
  client.callbacks.onFrame(helloFrame());
  assert.equal(store.state.profiles.length, 1, 'LAN pairing creates one host');
  const lanProfile = store.state.profiles[0];
  assert.equal(lanProfile.gatewayId, REAL_GATEWAY_ID);

  // 同一台主机改用中继二维码重新配对
  const second = store.pairWithPayload(v3RelayPayload());
  assert.equal(second.ok, true, second.error);
  assert.equal(store.state.profiles.length, 1, 'the same host must not be added twice: ' + JSON.stringify(store.state.profiles.map(p => p.gatewayId)));
  const profile = store.state.profiles[0];
  assert.equal(profile.id, lanProfile.id, 'existing host profile is reused');
  assert.equal(profile.gatewayId, REAL_GATEWAY_ID, 'gateway identity survives the relay pairing');
  assert.equal(profile.relayNodeId, NODE_ID, 'relay node id is stored separately');
  assert.ok(profile.endpoints.indexOf(LAN) >= 0, 'LAN route is kept: ' + JSON.stringify(profile.endpoints));
  assert.ok(profile.endpoints.indexOf(RELAY_BASE + '/c/' + NODE_ID) >= 0, 'relay route is added');
  assert.ok(profile.routeTable && profile.routeTable.lan.indexOf(LAN) >= 0, 'route table keeps the LAN family');
  assert.ok(profile.routeTable.relay && profile.routeTable.relay.nodeId === NODE_ID, 'route table gains the relay family');
});

test('旧中继档案（gatewayId 存的是 nodeId）连上后与局域网档案合并成一条', t => {
  const lanProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    gatewayId: REAL_GATEWAY_ID,
    gatewayName: '0the.local',
    endpoints: [LAN],
    preferredEndpoint: LAN,
    routeTable: { lan: [LAN], public: [], relay: null },
    __token: 'lan-device-token'
  };
  const relayProfile = {
    id: '22222222-2222-4222-8222-222222222222',
    gatewayId: NODE_ID,
    gatewayName: '0the.local',
    relay: true,
    relayAgentPubKey: AGENT_PUB,
    relayAuthMode: 'gateway',
    endpoints: [RELAY_BASE + '/c/' + NODE_ID],
    preferredEndpoint: RELAY_BASE + '/c/' + NODE_ID,
    routeTable: { lan: [], public: [], relay: { relay: RELAY_BASE, nodeId: NODE_ID, agentPubKey: AGENT_PUB, authMode: 'gateway' } }
  };
  const { store, client, storage } = boot(t, [lanProfile, relayProfile], relayProfile.id);
  assert.equal(store.state.profiles.length, 2);

  client.relayMeta = { nodeId: NODE_ID, agentPubKey: AGENT_PUB, authMode: 'gateway' };
  client.routeKind = 'relay';
  client.callbacks.onState('connected');
  client.callbacks.onFrame(helloFrame());

  assert.equal(store.state.profiles.length, 1, 'duplicate host profiles merge after hello: ' + JSON.stringify(store.state.profiles.map(p => ({ g: p.gatewayId, n: p.relayNodeId }))));
  const merged = store.state.profiles[0];
  assert.equal(merged.gatewayId, REAL_GATEWAY_ID);
  assert.equal(merged.relayNodeId, NODE_ID);
  assert.ok(merged.endpoints.indexOf(LAN) >= 0, 'LAN route survives the merge');
  assert.ok(merged.endpoints.indexOf(RELAY_BASE + '/c/' + NODE_ID) >= 0, 'relay route survives the merge');
  assert.ok(merged.routeTable.lan.indexOf(LAN) >= 0, 'route table keeps LAN');
  assert.ok(merged.routeTable.relay && merged.routeTable.relay.nodeId === NODE_ID, 'route table keeps relay');
  const saved = JSON.parse(storage.get('gateway.profiles.v1'));
  assert.equal(saved.length, 1, 'merge is persisted');
  const credential = JSON.parse(storage.get('dsh_creds.' + merged.id) || 'null');
  assert.ok(credential && credential.token, 'device token migrates to the surviving profile');
  assert.ok(store.state.activeID === merged.id, 'active host points at the surviving profile');
});

test('重复的 hello 帧不会把合并后的主机再拆回两条', t => {
  const lanProfile = {
    id: '33333333-3333-4333-8333-333333333333',
    gatewayId: REAL_GATEWAY_ID,
    gatewayName: '0the.local',
    endpoints: [LAN, PUBLIC],
    preferredEndpoint: LAN,
    routeTable: { lan: [LAN], public: [PUBLIC], relay: null }
  };
  const { store, client } = boot(t, [lanProfile]);
  client.callbacks.onState('connected');
  client.callbacks.onFrame(helloFrame());
  client.callbacks.onFrame(helloFrame());
  assert.equal(store.state.profiles.length, 1);
  assert.equal(store.state.profiles[0].id, lanProfile.id);
  assert.deepEqual(store.state.profiles[0].endpoints, [LAN, PUBLIC]);
});
