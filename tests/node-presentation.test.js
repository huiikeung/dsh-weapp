const test = require('node:test');
const assert = require('node:assert/strict');
const { nodePresentation } = require('../miniprogram/utils/node-presentation');

test('public node views contain identifiers but no public address, port or credential', () => {
  for (const relay of [false, true]) {
    const profile = { id: 'node', gatewayId: 'GW-123', gatewayName: 'private.example.test', relay,
      endpoints: ['wss://private.example.test:8443/ws/mobile'], relayAccessToken: 'secret-credential' };
    const value = nodePresentation(profile, { activeID: 'node', connection: 'connected', endpoint: profile.endpoints[0], port: 8443 });
    assert.equal(value.isPublic, true);
    assert.equal(value.identifier, 'GW-123');
    assert.equal(value.name, '公网节点');
    assert.equal(value.endpoint, ''); assert.equal(value.port, '');
    assert.doesNotMatch(JSON.stringify(value), /private\.example|8443|secret-credential/);
  }
});
test('LAN node views retain IPv4, IPv6 and local hostname address and port', () => {
  for (const endpoint of ['ws://192.168.0.8:9000/ws/mobile', 'wss://10.0.0.2:9000/ws/mobile', 'ws://[fd00::1]:9000/ws/mobile', 'ws://mac.local:9000/ws/mobile']) {
    const value = nodePresentation({ id: 'node', endpoints: [endpoint] }, { activeID: 'node', connection: 'connecting' });
    assert.equal(value.isPublic, false, endpoint); assert.equal(value.endpoint, endpoint); assert.equal(value.port, '9000');
    assert.equal(value.canPing, false); assert.equal(value.canDisconnect, true);
  }
});
test('inactive node never inherits active node endpoint, port or connection state', () => {
  const value = nodePresentation({ id: 'other', preferredEndpoint: 'ws://192.168.0.9:8080/ws/mobile' },
    { activeID: 'active', endpoint: 'wss://private.example.test:443/ws/mobile', port: 443, connection: 'connected' });
  assert.equal(value.endpoint, 'ws://192.168.0.9:8080/ws/mobile'); assert.equal(value.port, '8080');
  assert.equal(value.connectionLabel, '未连接此节点'); assert.equal(value.canPing, false); assert.equal(value.canDisconnect, false);
  assert.equal(nodePresentation(null, {}), null);
});
