const test = require('node:test');
const assert = require('node:assert/strict');
const memory = new Map();
global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key)
};
const hosts = require('../miniprogram/utils/hosts');

test('device kind prefers explicit payload, then platform, host name, and defaults to computer', () => {
  assert.deepEqual(hosts.deriveDeviceKind({ deviceKind: 'server.rack', platform: 'darwin' }),
    { kind: 'server.rack', source: 'payload' });
  assert.deepEqual(hosts.deriveDeviceKind({ platform: 'darwin' }),
    { kind: 'desktopcomputer', source: 'platform' });
  assert.deepEqual(hosts.deriveDeviceKind({ platform: 'linux' }),
    { kind: 'server.rack', source: 'platform' });
  assert.deepEqual(hosts.deriveDeviceKind({ gatewayName: 'MacBook Pro' }),
    { kind: 'desktopcomputer', source: 'name' });
  assert.deepEqual(hosts.deriveDeviceKind({ gatewayName: 'vps-hk-01' }),
    { kind: 'server.rack', source: 'name' });
  // 协议没有平台信息时默认电脑：公网扫码的电脑不再被误判成服务器。
  assert.deepEqual(hosts.deriveDeviceKind({ gatewayName: '我的主机' }),
    { kind: 'desktopcomputer', source: 'default' });
  assert.equal(hosts.kindIconFile('server.rack'), 'server-white.png');
  assert.equal(hosts.kindIconFile('desktopcomputer'), 'desktop-white.png');
});

test('legacy address-based guesses are repaired on load, user choices are preserved', () => {
  const legacy = {
    id: '12345678-1234-4234-8234-123456789012',
    gatewayId: '87654321-4321-4321-8321-210987654321',
    gatewayName: '我的电脑',
    endpoints: ['wss://relay.example.com/c/node'],
    deviceKind: 'server.rack'
  };
  const manual = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    gatewayName: 'remote-node',
    endpoints: ['wss://relay.example.com/c/other'],
    deviceKind: 'server.rack',
    deviceKindSource: 'user'
  };
  memory.set('gateway.profiles.v1', JSON.stringify([legacy, manual]));
  const loaded = hosts.loadProfiles();
  assert.equal(loaded[0].deviceKind, 'desktopcomputer');
  assert.equal(loaded[0].deviceKindSource, 'auto');
  assert.equal(loaded[1].deviceKind, 'server.rack');
  assert.equal(loaded[1].deviceKindSource, 'user');
  // 修复结果写回存储，下次启动无需再猜。
  const persisted = JSON.parse(memory.get('gateway.profiles.v1'));
  assert.equal(persisted[0].deviceKind, 'desktopcomputer');
  assert.equal(persisted[1].deviceKind, 'server.rack');
});
