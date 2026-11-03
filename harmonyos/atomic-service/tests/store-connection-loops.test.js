'use strict';

// 回归：连接的「自愈」路径不能把健康连接变成无限重连循环。
// 1) 前台恢复自检：单次回包慢不拆链，连续两次失败才重连；
// 2) 空会话列表的自愈重连跨连接有预算上限（空列表可能本来就是真实状态）。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storeFile = path.resolve(__dirname, '../ascf/ascf_src/utils/store.js');

function boot(t) {
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
      this.state = 'connecting';
      this.connectCalls = [];
      this.failureCalls = [];
      this.pings = [];
      this.pingQueue = [];
      clients.push(this);
      // 未显式实现的业务请求一律返回可 then 的占位值，避免触发真实网络逻辑
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
    handleTransportFailure(message) {
      this.failureCalls.push(message);
      this.state = 'failed';
      this.callbacks.onState('failed', message);
    }
    ping(timeout) {
      this.pings.push(timeout);
      const next = this.pingQueue.shift();
      return next ? next() : Promise.resolve({ kind: 'pong' });
    }
    setHeartbeatEnabled(enabled) { this.heartbeatEnabled = enabled; }
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

  // 记录 store 内部计时器，用例结束统一清理（数据看门狗是 20s，否则进程要等它）。
  const timers = new Set();
  const trackedSetTimeout = (fn, delay, ...args) => {
    const id = setTimeout(fn, delay, ...args);
    timers.add(id);
    return id;
  };
  const trackedClearTimeout = id => { timers.delete(id); clearTimeout(id); };
  const trackedSetInterval = (fn, delay, ...args) => {
    const id = setInterval(fn, delay, ...args);
    timers.add(id);
    return id;
  };
  const trackedClearInterval = id => { timers.delete(id); clearInterval(id); };
  t.after(() => { timers.forEach(id => { clearTimeout(id); clearInterval(id); }); timers.clear(); });

  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(storeFile, 'utf8'), {
    module, has, Date, console,
    setTimeout: trackedSetTimeout, clearTimeout: trackedClearTimeout,
    setInterval: trackedSetInterval, clearInterval: trackedClearInterval,
    require(name) {
      return name === './gateway'
        ? { GatewayClient: Client }
        : require(path.resolve(path.dirname(storeFile), name));
    }
  }, { filename: storeFile });

  const store = module.exports;
  store.init();
  const client = clients[0];
  return { store, client };
}

test('前台恢复自检：单次 ping 超时不会拆掉连接，连续两次才重连', async t => {
  const { store, client } = boot(t);
  client.callbacks.onState('connected');
  store.appDidBecomeActive();
  assert.equal(client.connectCalls.length, 1, 'initial connect only');
  assert.deepEqual(client.pings, [8000], 'foreground probe uses a tolerant timeout');
  await new Promise(resolve => setImmediate(resolve)); // 让首次探测链结算，避免挡住下一次 onShow

  // 第一次超时、第二次成功：保持连接，不重新握手
  let firstReject;
  client.pingQueue = [() => new Promise((resolve, reject) => { firstReject = reject; }), () => Promise.resolve({ kind: 'pong' })];
  store.appDidEnterBackground();
  store.appDidBecomeActive();
  assert.equal(client.pings.length, 2, 'background/foreground starts one probe');
  firstReject(new Error('slow pong'));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.connectCalls.length, 1, 'one slow pong must not trigger a re-handshake');

  // 两次都失败：才允许重连
  client.pingQueue = [() => Promise.reject(new Error('no pong 1')), () => Promise.reject(new Error('no pong 2'))];
  store.appDidEnterBackground();
  store.appDidBecomeActive();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.connectCalls.length, 2, 'two failed probes fall back to a reconnect');
});

test('空会话列表的自愈重连跨连接最多两次，拿到真实数据后恢复预算', t => {
  const { store, client } = boot(t);
  const emptyFrame = () => client.callbacks.onFrame({ kind: 'sessions', items: [] });
  const exhaustBudget = () => {
    store.state.sessionsRetries = 5;
    store.state.lastSessionsRetryAt = 0;
    emptyFrame();
  };

  client.callbacks.onState('connected');
  exhaustBudget();
  assert.equal(client.failureCalls.length, 1, 'first self-heal reconnect');

  client.callbacks.onState('connected');
  exhaustBudget();
  assert.equal(client.failureCalls.length, 2, 'second self-heal reconnect');

  client.callbacks.onState('connected');
  exhaustBudget();
  assert.equal(client.failureCalls.length, 2,
    'empty lists must stop forcing reconnects once the budget is spent');

  // 真实的非空列表归来：预算恢复
  client.callbacks.onFrame({ kind: 'sessions', items: [{ sessionId: 'session-1', title: '真实会话' }] });
  client.callbacks.onState('connected');
  exhaustBudget();
  assert.equal(client.failureCalls.length, 3, 'a real list restores the self-heal budget');
});
