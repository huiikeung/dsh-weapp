'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const accessApi = require('../miniprogram/utils/access-api');

function fixture(t, options) {
  const sockets = [];
  const states = [];
  global.wx = {
    getStorageSync: () => 'fixture-device-123',
    setStorageSync() {},
    connectSocket(connectOptions) {
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
      sockets.push({ options: connectOptions, socket });
      if (options && options.failSynchronously) connectOptions.fail({ errMsg: 'request:fail (fixture)' });
      return socket;
    }
  };
  const client = new GatewayClient({
    onState(state, message) { states.push({ state, message }); }
  });
  t.after(() => {
    client.disconnect();
    delete global.wx;
  });
  return { client, sockets, states };
}

test('failed one-time pairing cleans up and does not retry an unusable code', t => {
  const f = fixture(t);
  f.client.connect('wss://gateway.example.test/ws/mobile', { pairingCode: 'one-time-code' });
  const attempt = f.sockets[0];

  attempt.options.fail({ errMsg: 'request:fail (network unavailable)' });

  assert.equal(f.client.state, 'failed');
  assert.match(f.client.cb.onState && f.states.at(-1).message, /network unavailable/);
  assert.equal(f.client.wantsConnection, false);
  assert.equal(f.client.pairingCode, null);
  assert.equal(f.client.reconnectTimer, null);
  assert.equal(f.client.timeoutTimer, null);
  assert.equal(attempt.socket.closed, true);
  attempt.socket.events.error({ errMsg: 'late duplicate error' });
  assert.equal(f.states.at(-1).state, 'failed', 'late socket events are ignored');
});

test('one-time pairing falls back through the QR candidate endpoints', async t => {
  const f = fixture(t);
  f.client.connect('wss://public.example.test/ws/mobile', {
    pairingCode: 'one-time-code',
    endpointCandidates: ['ws://192.168.1.20:3081/ws/mobile'],
  });
  f.sockets[0].options.fail({ errMsg: 'request:fail (public network unavailable)' });
  assert.equal(f.client.state, 'connecting');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.sockets.length, 2);
  assert.equal(f.sockets[1].options.url, 'ws://192.168.1.20:3081/ws/mobile');
  assert.ok(f.sockets[1].options.protocols.includes('dsh-pair.one-time-code'));
  f.sockets[1].options.fail({ errMsg: 'request:fail (LAN unavailable)' });
  assert.equal(f.client.state, 'failed');
  assert.equal(f.client.wantsConnection, false);
});

test('synchronous connectSocket failure is handled after the task is assigned', t => {
  const f = fixture(t, { failSynchronously: true });

  f.client.connect('wss://gateway.example.test/ws/mobile', { pairingCode: 'one-time-code' });

  assert.equal(f.client.state, 'failed');
  assert.equal(f.client.socketTask, null);
  assert.equal(f.client.wantsConnection, false);
  assert.equal(f.sockets[0].socket.closed, true);
});

test('saved-token connection failure keeps bounded backoff and clears the attempt timeout', t => {
  const f = fixture(t);
  f.client.connect('wss://gateway.example.test/ws/mobile', { token: 'saved-device-token' });
  const attempt = f.sockets[0];

  attempt.options.fail({ errMsg: 'request:fail (temporary network error)' });

  assert.equal(f.client.state, 'failed');
  assert.equal(f.client.wantsConnection, true);
  assert.ok(f.client.reconnectTimer, 'saved credentials can reconnect automatically');
  assert.equal(f.client.timeoutTimer, null);
  assert.equal(attempt.socket.closed, true);
  f.client.disconnect();
  assert.equal(f.client.reconnectTimer, null);
});

test('a stale failure from a replaced socket cannot break the new connection', t => {
  const f = fixture(t);
  f.client.connect('wss://first.example.test/ws/mobile', { token: 'saved-device-token' });
  const first = f.sockets[0];
  f.client.connect('wss://second.example.test/ws/mobile', { token: 'saved-device-token' });

  first.options.fail({ errMsg: 'late failure from first route' });

  assert.equal(f.client.state, 'connecting');
  assert.equal(f.client.endpoint, 'wss://second.example.test/ws/mobile');
  assert.equal(f.client.socketTask, f.sockets[1].socket);
  assert.equal(f.client.reconnectTimer, null);
});

test('relay connector offline close keeps an actionable state and retries saved credentials', t => {
  const f = fixture(t);
  const relayNodeId = '12345678-1234-4234-8234-123456789012';
  f.client.reconnectAttempts = 2;
  f.client.connectTransport('wss://relay.example.test/c/fixture-node', {
    token: 'saved-device-token',
    relay: {
      authMode: 'gateway',
      nodeId: relayNodeId,
      agentPubKey: Buffer.alloc(32, 3).toString('base64')
    }
  });
  const attempt = f.sockets[0];

  attempt.socket.events.open();
  assert.equal(f.client.reconnectAttempts, 2,
    'opening the relay transport does not reset backoff before gateway authentication succeeds');
  attempt.socket.events.close({ code: 4001, reason: 'connector-offline' });

  assert.equal(f.client.state, 'failed');
  assert.equal(f.client.wantsConnection, true);
  assert.match(f.states.at(-1).message, /连接器已离线/);
  assert.ok(f.client.reconnectTimer, 'a temporarily offline desktop connector is retried with backoff');
  assert.equal(f.client.reconnectAttempts, 3, 'retry backoff continues across failed relay handshakes');
});

test('transient lease-service network errors retain relay credentials and retry', async t => {
  const originals = {
    isManagedRelay: accessApi.isManagedRelay,
    cachedLease: accessApi.cachedLease,
    publicLease: accessApi.publicLease
  };
  t.after(() => Object.assign(accessApi, originals));
  accessApi.isManagedRelay = () => true;
  accessApi.cachedLease = () => null;
  accessApi.publicLease = () => Promise.reject(Object.assign(new Error('temporary lease network failure'), {
    code: 'NETWORK_ERROR'
  }));

  const f = fixture(t);
  f.client.connect('wss://relay.example.test/c/fixture-node', {
    token: 'saved-device-token',
    relay: { authMode: 'gateway', nodeId: 'fixture-node', agentPubKey: 'fixture-key' }
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(f.client.state, 'failed');
  assert.equal(f.client.wantsConnection, true);
  assert.ok(f.client.reconnectTimer, 'temporary account-service failures use bounded backoff');
  assert.equal(f.client.endpoint, 'wss://relay.example.test/c/fixture-node');
  assert.equal(f.client.lastConnectOpts.token, 'saved-device-token');
  assert.equal(f.client.lastConnectOpts.relay.nodeId, 'fixture-node');
});

test('session subscription carries a validated durable resume cursor', t => {
  const f = fixture(t);
  const sent = [];
  f.client.state = 'connected';
  f.client.socketTask = { send(frame) { sent.push(JSON.parse(frame.data)); } };

  assert.equal(f.client.subscribe('session-1', 91), true);
  assert.equal(sent[0].afterSeq, 91);
  assert.equal(f.client.subscribe('session-1', -1), true);
  assert.equal(Object.hasOwn(sent[1], 'afterSeq'), false);
});

test('device removal resolves only after the server confirms the authenticated socket', async t => {
  const f = fixture(t);
  const sent = [];
  f.client.state = 'connected';
  f.client.send = payload => { sent.push(payload); return true; };
  const pending = f.client.forgetDevice(1000);
  assert.equal(sent[0].type, 'device-forget');
  assert.equal(typeof sent[0].requestId, 'string');
  f.client.handleFrame(JSON.stringify({ kind: 'device-forgotten', requestId: 'not-this-request' }));
  f.client.handleFrame(JSON.stringify({ kind: 'device-forgotten', requestId: sent[0].requestId }));
  assert.equal((await pending).requestId, sent[0].requestId);
});

test('public history requests keep a small default and accept bounded larger-page retries', t => {
  const f = fixture(t);
  f.client.relayMeta = { nodeId: 'fixture-node' };
  const payloads = [];
  f.client.send = payload => { payloads.push(payload); return true; };

  f.client.requestHistory('session', 30, 1);
  f.client.requestHistory('session', 30, 1, 512 * 1024);
  f.client.requestHistory('session', 30, 1, 8 * 1024 * 1024);
  f.client.requestHistory('session');

  assert.deepEqual(payloads.map(payload => payload.maxBytes), [256 * 1024, 512 * 1024, 2 * 1024 * 1024, 128 * 1024]);
  assert.equal(payloads[0].maxMessages, 40);
  assert.equal(payloads[3].maxMessages, 12, 'public session entry prioritizes a smaller, faster latest-history tail');
});
