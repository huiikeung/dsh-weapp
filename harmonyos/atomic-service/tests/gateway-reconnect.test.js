'use strict';

// 回归：网关连接「反复重连」的两类根因
// 1) 抖动链路每次都能握手成功，旧实现每次 connected 都把退避清零 → 永远 1s 重连一次；
// 2) App.onShow / 网络回调在拨号途中重复 connect() 会把正在建立的 socket 拆掉重拨。
// 另外固定心跳语义：单次回包慢不算断链，连续 miss 两次才重连。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const storage = new Map();
const sockets = [];

function makeSocket(options) {
  const socket = {
    options,
    events: {},
    closed: false,
    closedWith: null,
    sent: [],
    onOpen(fn) { this.events.open = fn; },
    onMessage(fn) { this.events.message = fn; },
    onError(fn) { this.events.error = fn; },
    onClose(fn) { this.events.close = fn; },
    send(payload) { this.sent.push(payload); },
    close(args) { this.closed = true; this.closedWith = args || null; },
    fire(type, arg) { if (this.events[type]) this.events[type](arg); }
  };
  sockets.push(socket);
  return socket;
}

const previousHas = global.has;
global.has = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  connectSocket: options => makeSocket(options),
  getDeviceInfo: () => ({ brand: 'HUAWEI', model: 'Mate 90 Pro Max' }),
  getSystemInfoSync: () => ({ windowWidth: 1280, windowHeight: 2832 })
};

const { GatewayClient } = require(path.join(__dirname, '..', 'ascf', 'ascf_src', 'utils', 'gateway.js'));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TOKEN = 't'.repeat(43);

function createClient(t) {
  sockets.length = 0;
  const states = [];
  const client = new GatewayClient({
    onState(state, message) { states.push({ state, message }); }
  });
  // 单个测试文件在独立进程里跑：global.has 全程保留（各用例都需要），
  // 只在本用例结束时断开客户端，清掉心跳/稳定计时器。
  t.after(() => client.disconnect());
  return { client, states };
}

test('退避按指数增长并带抖动，不是恒定 1s', t => {
  const { client } = createClient(t);
  const expected = [1000, 2000, 4000, 8000, 16000, 30000];
  const delays = expected.map((base, index) => client.reconnectDelay(index + 1));
  delays.forEach((delay, index) => {
    const base = expected[index];
    assert.ok(delay >= base * 0.7 && delay <= base * 1.3,
      'retry ' + (index + 1) + ' should stay near ' + base + 'ms, got ' + delay);
  });
  assert.ok(delays.at(-1) >= 20000, 'later retries back off to tens of seconds: ' + JSON.stringify(delays));
});

test('短命连接不会清零退避：反复握手后重连间隔递增', async t => {
  const { client } = createClient(t);
  const dials = [];
  let watching = true;
  const watch = setInterval(() => {
    sockets.forEach(socket => {
      if (socket._opened) return;
      socket._opened = true;
      dials.push(Date.now());
      socket.events.open();
      // 50ms 后服务端/链路把连接断掉：典型的抖动（如中继桥接被拆除）
      setTimeout(() => socket.fire('close', { code: 1006, reason: '' }), 50);
    });
  }, 5);
  t.after(() => { watching = false; clearInterval(watch); });

  client.connect('wss://flap.example.test/ws', { token: TOKEN });
  await sleep(9000);
  clearInterval(watch);

  assert.ok(dials.length <= 4, 'flapping must not dial once per second: ' + dials.length + ' dials');
  const gaps = dials.slice(1).map((at, index) => at - dials[index]);
  assert.ok(gaps.length >= 2, 'expected a few retries, got ' + gaps.length);
  assert.ok(gaps.at(-1) > gaps[0] * 1.5, 'retry gaps must grow: ' + JSON.stringify(gaps));
  assert.ok(client.reconnectAttempts >= 2, 'backoff did not reset on short-lived connections');
});

test('拨号途中的重复 connect() 不会拆掉正在建立的 socket', t => {
  const { client } = createClient(t);
  client.connect('wss://dup.example.test/ws', { token: TOKEN });
  const first = sockets[0];
  assert.equal(sockets.length, 1);

  client.connect('wss://dup.example.test/ws', { token: TOKEN });
  assert.equal(sockets.length, 1, 'duplicate connect while connecting must be ignored');
  assert.equal(first.closed, false, 'in-flight socket must stay open');

  // 换线路（不同 endpoint）仍然需要重建
  client.connect('wss://other.example.test/ws', { token: TOKEN });
  assert.equal(sockets.length, 2, 'a different endpoint still redials');
});

test('连接稳定存活后（不是一进入 connected）才清零退避', t => {
  const { client } = createClient(t);
  client.reconnectAttempts = 3;
  client.setState('connected');
  assert.equal(client.reconnectAttempts, 3, 'connected alone must not reset backoff');
  assert.ok(client.stableTimer, 'a stability timer is armed after connecting');
  client.setState('failed', 'dropped');
  assert.equal(client.stableTimer, null, 'leaving connected clears the stability timer');
});

test('心跳连续 miss 两次才断链，单次超时不动连接', async t => {
  const { client } = createClient(t);
  client.setState('connected');
  client.socketTask = makeSocket({});
  const failures = [];
  client.request = () => Promise.reject(new Error('请求超时：ping'));
  client.handleTransportFailure = message => { failures.push(message); };

  client.runHeartbeat();
  await sleep(0);
  assert.equal(failures.length, 0, 'one slow pong is not a dead link');
  assert.equal(client.heartbeatMisses, 1);

  client.runHeartbeat();
  await sleep(0);
  assert.equal(failures.length, 1, 'two consecutive misses tear the link down');
  assert.match(failures[0], /无响应/);
});

test('心跳与前台自检使用各自 lane，单个 pong 不会互相取代', async t => {
  const { client } = createClient(t);
  const sent = [];
  client.state = 'connected';
  client.socketTask = { send(frame) { sent.push(JSON.parse(frame.data)); } };

  const foreground = client.ping(8000);
  const heartbeat = client.request({ type: 'ping' }, { matchType: 'pong', key: 'heartbeat:ping', timeout: 8000 });
  assert.equal(Object.keys(client.pendingRequests).length, 2, 'both lanes are pending');
  client.handleFrame(JSON.stringify({ kind: 'pong', at: Date.now() }));
  await Promise.all([foreground, heartbeat]);
  assert.equal(Object.keys(client.pendingRequests).length, 0);
  assert.ok(sent.every(frame => frame.type === 'ping'));
});

test('心跳只在 connected 时运行，断开即停', t => {
  const { client } = createClient(t);
  client.setState('connected');
  assert.ok(client.heartbeatTimer, 'heartbeat starts when connected');
  client.setState('failed', 'dropped');
  assert.equal(client.heartbeatTimer, null, 'heartbeat stops when leaving connected');
  client.setHeartbeatEnabled(false);
  client.setState('connected');
  assert.equal(client.heartbeatTimer, null, 'disabled heartbeat stays off (background)');
});
test('中继残帧/重复帧不会拆连接，只有真解密失败才断链', t => {
  const { client } = createClient(t);
  client.connect('wss://relay.example.test/c/node-1', {
    token: TOKEN,
    relay: { authMode: 'gateway', nodeId: 'node-1', agentPubKey: 'fixture-key' }
  });
  client.setState('connected');
  const failures = [];
  client.handleTransportFailure = message => { failures.push(message); };
  const session = {
    ready: true,
    rxCounter: 7,
    lastOpenFailure: null,
    packetCounter: () => -1,
    open() { this.lastOpenFailure = null; return null; }
  };
  client.relaySession = session;

  // 中继杂帧（首字节不是 0x03）：丢弃即可，不能断链
  session.open = function () { this.lastOpenFailure = 'format'; return null; };
  client.handleRelayMessage(Uint8Array.from([10, 1, 2, 3]).buffer);
  assert.equal(failures.length, 0, 'a stray relay frame must not tear the link down');

  // 重复帧（计数器已处理过）：同样只丢弃
  session.open = function () { this.lastOpenFailure = 'duplicate'; return null; };
  client.handleRelayMessage(Uint8Array.from([3, 0, 0, 0, 0, 0, 0, 0, 6]).buffer);
  assert.equal(failures.length, 0, 'a duplicate frame must not tear the link down');

  // 真解密失败（密钥不一致）仍然要断开，交给重连
  session.open = function () { this.lastOpenFailure = 'decrypt'; return null; };
  client.handleRelayMessage(Uint8Array.from([3, 0, 0, 0, 0, 0, 0, 0, 9]).buffer);
  assert.equal(failures.length, 1, 'a real decrypt failure still reconnects');
});

test('连接器拆桥（4001 gateway-closed）快速重建，且不显示成离线', async t => {
  const { client, states } = createClient(t);
  client.connect('wss://relay.example.test/c/node-1', {
    token: TOKEN,
    relay: { authMode: 'gateway', nodeId: 'node-1', agentPubKey: 'fixture-key' }
  });
  const socket = sockets[0];
  client.setState('connected');
  const dialsBefore = sockets.length;

  socket.fire('close', { code: 4001, reason: 'gateway-closed' });
  assert.equal(client.state, 'connecting', 'a connector teardown is transient, not failed/offline');
  assert.match(states.at(-1).message || '', /正在重新连接/);
  assert.ok(client.reconnectTimer, 'a fast retry is scheduled');

  await sleep(1200);
  assert.ok(sockets.length > dialsBefore, 'the client reconnects automatically');
});

test('已连上后同目标重复 connect 被忽略，显式 force 才重拨', t => {
  const { client } = createClient(t);
  client.connect('wss://same.example.test/ws', { token: TOKEN });
  const first = sockets[0];
  first.events.open();
  assert.equal(client.state, 'connected');
  assert.equal(sockets.length, 1);

  client.connect('wss://same.example.test/ws', { token: TOKEN });
  assert.equal(sockets.length, 1, 'duplicate connect on a healthy link is ignored');
  assert.equal(first.closed, false);

  client.connect('wss://same.example.test/ws', { token: TOKEN, force: true });
  assert.equal(sockets.length, 2, 'force is required for an intentional re-dial');
});
