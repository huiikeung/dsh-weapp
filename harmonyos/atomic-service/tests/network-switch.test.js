'use strict';

// 回归：WiFi → 蜂窝 必须自动切到公网/中继线路，而不是停在「已离线」。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storeFile = path.resolve(__dirname, '../ascf/ascf_src/utils/store.js');
const LAN = 'ws://192.168.1.10:3081/ws/mobile';
const RELAY_BASE = 'wss://relay.example.test/relay';
const NODE_ID = 'node-12345678';
const AGENT_PUB = Buffer.alloc(32, 7).toString('base64');
const REAL_GATEWAY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function boot(t, networkType) {
  let networkListener = null;
  const net = { type: networkType };
  const storage = new Map();
  const clients = [];
  const profileId = '12345678-1234-4234-8234-123456789012';
  storage.set('gateway.profiles.v1', JSON.stringify([{
    id: profileId,
    gatewayId: REAL_GATEWAY_ID,
    gatewayName: '0the.local',
    endpoints: [LAN, RELAY_BASE + '/c/' + NODE_ID],
    preferredEndpoint: LAN,
    routeTable: {
      lan: [LAN],
      public: [],
      relay: { relay: RELAY_BASE, nodeId: NODE_ID, agentPubKey: AGENT_PUB, authMode: 'gateway' }
    },
    relay: true,
    relayNodeId: NODE_ID,
    relayAgentPubKey: AGENT_PUB,
    relayAuthMode: 'gateway'
  }]));
  storage.set('gateway.activeID', profileId);
  storage.set('dsh_creds.' + profileId, JSON.stringify({ endpoint: LAN, token: 'device-token' }));

  class Client {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.connectGeneration = 1;
      this.state = 'connecting';
      this.connectCalls = [];
      this.wantsConnection = false;
      this.reconnectTimer = null;
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
      this.wantsConnection = true;
      this.endpoint = endpoint;
      this.callbacks.onState('connecting');
    }
    disconnect() { this.state = 'disconnected'; this.wantsConnection = false; }
    handleTransportFailure(message) { this.callbacks.onState('failed', message); }
    setHeartbeatEnabled() {}
    ping() { return Promise.resolve({ kind: 'pong' }); }
  }

  const has = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    onNetworkStatusChange(listener) { networkListener = listener; },
    getNetworkType(request) {
      if (request && request.success) request.success({ networkType: net.type });
    }
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
  return {
    store,
    client: clients[0],
    setNetwork: type => { net.type = type; },
    fireNetwork: info => networkListener && networkListener(info)
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('WiFi 切到蜂窝：自动改用中继线路重连，而不是停在局域网候选上', async t => {
  const { store, client, fireNetwork, setNetwork } = boot(t, 'wifi');
  assert.equal(client.connectCalls.length, 1, 'initial connect');
  assert.equal(client.connectCalls[0].endpoint, LAN, 'wifi prefers the LAN route');

  client.callbacks.onState('connected');
  assert.equal(store.state.connection, 'connected');

  // 切到蜂窝：回调只带 isConnected（不带 networkType），必须补查网络类型后重新选路
  setNetwork('4g');
  fireNetwork({ isConnected: true });
  await sleep(30);
  assert.ok(client.connectCalls.length >= 2, 'cellular switch forces a reconnect');
  const last = client.connectCalls.at(-1);
  assert.equal(last.endpoint, RELAY_BASE + '/c/' + NODE_ID, 'cellular re-routes to the relay: ' + last.endpoint);
  assert.equal(last.options.force, true, 'route switch bypasses duplicate-connect dedupe');
  assert.equal(last.options.relay && last.options.relay.nodeId, NODE_ID, 'relay options carry the node id');
});

test('回到 WiFi 不打断已经连通的公网线路；下一次选路才切回局域网', async t => {
  const { client, store, fireNetwork, setNetwork } = boot(t, 'cellular');
  client.callbacks.onState('connected');
  assert.equal(store.state.connection, 'connected');
  assert.ok(client.connectCalls.some(call => call.endpoint === RELAY_BASE + '/c/' + NODE_ID),
    'cold start on cellular re-routes to the relay: ' + JSON.stringify(client.connectCalls.map(c => c.endpoint)));
  const before = client.connectCalls.length;

  // 回 WiFi 时公网线路仍然可用：不要为了“换回局域网”主动拆掉一条好连接
  setNetwork('wifi');
  fireNetwork({ isConnected: true, networkType: 'wifi' });
  await sleep(30);
  assert.equal(client.connectCalls.length, before, 'a healthy relay connection is not torn down on WiFi return');
});
