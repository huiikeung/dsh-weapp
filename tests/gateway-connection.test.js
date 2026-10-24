'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GatewayClient } = require('../miniprogram/utils/gateway');

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

test('relay connector offline close retains an actionable failed state', t => {
  const f = fixture(t);
  f.client.connectTransport('wss://relay.example.test/c/fixture-node', {
    token: 'saved-device-token',
    relay: { authMode: 'invite', nodeId: 'fixture-node', agentPubKey: 'fixture-key' }
  });
  const attempt = f.sockets[0];

  attempt.socket.events.close({ code: 4001, reason: 'connector-offline' });

  assert.equal(f.client.state, 'failed');
  assert.equal(f.client.wantsConnection, false);
  assert.match(f.states.at(-1).message, /连接器已离线/);
  assert.equal(f.client.reconnectTimer, null);
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
