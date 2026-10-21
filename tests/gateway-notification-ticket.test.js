'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('GatewayClient attaches only valid one-time completion tickets to message frames', t => {
  global.wx = { getStorageSync: () => 'fixture-device-id' };
  t.after(() => { delete global.wx; });
  const { GatewayClient } = require('../miniprogram/utils/gateway');
  const client = new GatewayClient();
  let frame;
  client.state = 'connected';
  client.socketTask = { send: options => { frame = JSON.parse(options.data); } };
  assert.equal(client.sendMessage('task', 'session', 'workspace', [], 'queue', 't'.repeat(43)), true);
  assert.equal(frame.notificationTicket, 't'.repeat(43));
  client.sendMessage('task', 'session', null, [], undefined, 'not-a-ticket');
  assert.equal(Object.hasOwn(frame, 'notificationTicket'), false);
});
