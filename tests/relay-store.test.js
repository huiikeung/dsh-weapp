const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const memory = new Map();
global.wx = {
  getStorageSync: (k) => memory.get(k),
  setStorageSync: (k, v) => memory.set(k, v),
  removeStorageSync: (k) => memory.delete(k)
};
const hosts = require('../utils/hosts');
const instances = [];
class Client {
  constructor(cb) { this.cb = cb; instances.push(this); }
  connect(endpoint, options) { this.endpoint = endpoint; this.options = options; }
  disconnect() {}
}
const moduleObject = { exports: {} };
const file = path.join(__dirname, '../utils/store.js');
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  module: moduleObject, wx: global.wx, Date, console,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  require(name) { return name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(file), name)); }
}, { filename: file });
const store = moduleObject.exports;
const nodeId = '12345678-1234-4234-8234-123456789012';
const gatewayId = '87654321-4321-4321-8321-210987654321';
const payload = { version: 3, mode: 'relay', relay: 'wss://relay.example.com', nodeId,
  agentPubKey: Buffer.alloc(32, 1).toString('base64'), pairingCode: 'a'.repeat(43), expiresAt: Date.now() + 60000, accessDays: 365, accessExpiresAt: Date.now() + 365 * 86400000 };
const result = store.pairWithPayload(Buffer.from(JSON.stringify(payload)).toString('base64url'));
assert.equal(result.ok, true);
const client = instances[0];
assert.equal(client.options.pairingCode, payload.pairingCode);
assert.equal(client.options.relay.authMode, 'gateway');
client.lastToken = 'b'.repeat(43);
client.cb.onPaired({ kind: 'paired', gatewayId, token: client.lastToken, device: { id: 'test-device' } });
client.cb.onFrame({ kind: 'hello', gatewayId, gatewayName: 'DSH', device: { id: 'test-device' } });
client.cb.onFrame({ kind: 'hello', gatewayId, gatewayPackage: 'dsh-plugin-weapp-gateway', gatewayVersion: '0.8.6' });
assert.equal(store.state.gatewayMetadata.version, '0.8.6');
client.cb.onFrame({ kind: 'host', dshVersion: '0.1.7-rc.2', gatewayPackage: 'dsh-plugin-weapp-gateway', gatewayVersion: '0.8.7' });
assert.equal(store.state.gatewayMetadata.version, '0.8.7');
client.cb.onFrame({ kind: 'hello', gatewayId });
assert.equal(store.state.gatewayMetadata.version, '', 'An older node must not inherit a previous plugin version');
const profile = store.state.profiles[0];
assert.equal(profile.gatewayId, nodeId, 'Local gateway UUID must not replace the relay routing/signature ID');
assert.equal(hosts.loadCredential(profile.id).token, client.lastToken);
assert.equal(profile.relayExpiresAt, payload.accessExpiresAt);
client.cb.onRelayAuthorized({ role: 'guest', expiresAt: 0 }, { nodeId });
assert.equal(profile.relayExpiresAt, payload.accessExpiresAt, 'Relay frames must not erase gateway-managed device expiry');
store.init();
assert.equal(client.options.token, 'b'.repeat(43));
assert.equal(client.options.relay.nodeId, nodeId);
assert.equal(client.options.relay.authMode, 'gateway');
assert.equal(client.options.relay.expiresAt, payload.accessExpiresAt);
assert.equal(client.options.pairingCode, undefined, 'Never persist/replay a one-time pairing code');
delete global.wx;
console.log('relay store identity and reconnect persistence: PASS');
