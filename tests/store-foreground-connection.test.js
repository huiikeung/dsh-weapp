'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('foreground keeps a healthy connection and only reconnects when its ping fails', async t => {
  const file = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} };
  const storage = new Map();
  const clients = [];
  const profileId = '12345678-1234-4234-8234-123456789012';
  storage.set('gateway.profiles.v1', JSON.stringify([{
    id: profileId,
    gatewayName: 'DSH',
    endpoints: ['wss://gateway.example.test/ws/mobile'],
    preferredEndpoint: 'wss://gateway.example.test/ws/mobile'
  }]));
  storage.set('gateway.activeID', profileId);
  storage.set('dsh_creds.' + profileId, JSON.stringify({
    endpoint: 'wss://gateway.example.test/ws/mobile',
    token: 'saved-device-token'
  }));

  class Client {
    constructor(callbacks) {
      this.callbacks = callbacks;
      this.connectGeneration = 1;
      this.state = 'disconnected';
      this.connectCalls = [];
      this.pingCalls = [];
      clients.push(this);
      return new Proxy(this, {
        get(target, key) {
          if (key in target) return target[key];
          return () => true;
        }
      });
    }
    connect(endpoint, options) {
      this.connectCalls.push({ endpoint, options });
      this.state = 'connecting';
      this.callbacks.onState('connecting');
    }
    ping(timeout) {
      this.pingCalls.push(timeout);
      return new Promise((resolve, reject) => {
        this.resolvePing = resolve;
        this.rejectPing = reject;
      });
    }
    disconnect() { this.state = 'disconnected'; }
  }

  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  };
  const previousWx = global.wx;
  global.wx = wx;
  t.after(() => {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  });
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, wx, Date, console,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require(name) {
      return name === './gateway'
        ? { GatewayClient: Client }
        : require(path.resolve(path.dirname(file), name));
    }
  }, { filename: file });

  const store = module.exports;
  store.init();
  const client = clients[0];
  assert.equal(client.connectCalls.length, 1, JSON.stringify({
    connection: store.state.connection,
    error: store.state.connectionMessage,
    activeID: store.state.activeID,
    profiles: store.state.profiles
  }));

  // Initial app onShow must not cancel the connect started by onLaunch.
  store.appDidBecomeActive();
  assert.equal(client.connectCalls.length, 1);

  client.callbacks.onState('connected');
  store.appDidEnterBackground();
  store.appDidBecomeActive();
  assert.equal(client.connectCalls.length, 1, 'a healthy socket is not needlessly re-handshaken');
  assert.deepEqual(client.pingCalls, [2500], 'resume validates the existing socket with a bounded ping');
  client.resolvePing({ kind: 'pong' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.connectCalls.length, 1);

  store.appDidEnterBackground();
  store.appDidBecomeActive();
  assert.equal(client.pingCalls.length, 2);
  client.rejectPing(new Error('stale socket'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.connectCalls.length, 2, 'a failed connection can still be retried on foreground');
});
