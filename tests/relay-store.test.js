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
const hosts = require('../miniprogram/utils/hosts');
const instances = [];
class Client {
  constructor(cb) { this.cb = cb; instances.push(this); }
  connect(endpoint, options) { this.endpoint = endpoint; this.options = options; }
  forgetDevice() { this.forgetCalled = true; return Promise.resolve({ kind: 'device-forgotten' }); }
  disconnect() {}
}
const moduleObject = { exports: {} };
const file = path.join(__dirname, '../miniprogram/utils/store.js');
vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  module: moduleObject, wx: global.wx, Date, console,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  require(name) { return name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(file), name)); }
}, { filename: file });
const store = moduleObject.exports;
const nodeId = '12345678-1234-4234-8234-123456789012';
const gatewayId = '87654321-4321-4321-8321-210987654321';
const payload = { version: 3, mode: 'relay', relay: 'wss://relay.example.com', nodeId,
  agentPubKey: Buffer.alloc(32, 1).toString('base64'), pairingCode: 'a'.repeat(43), expiresAt: Date.now() + 60000, accessDays: 365, accessExpiresAt: Date.now() + 365 * 86400000,
  hostPlatform: 'linux' };
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
assert.equal(profile.deviceKind, 'server.rack', 'Relay payload hostPlatform selects the device kind');
assert.equal(profile.deviceKindSource, 'payload');
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

memory.set('dsh_trusted_endpoints', ['wss://previously-trusted.example/ws/mobile']);
const manualResult = store.pairManual('wss://new-endpoint.example/ws/mobile', 'd'.repeat(43));
assert.equal(manualResult.ok, false, 'manual address entry still requires a previously trusted endpoint');

const directQr = {
  version: 2,
  publicUrl: 'ws://192.168.1.20:3081/ws/mobile',
  endpoints: ['ws://192.168.1.20:3081/ws/mobile'],
  pairingCode: 'c'.repeat(43),
  expiresAt: Date.now() + 60000,
  gatewayId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  miniProgramRoute: {
    mode: 'direct',
    publicUrl: 'wss://gateway.example.com/ws/mobile',
    endpoints: ['wss://gateway.example.com/ws/mobile', 'ws://192.168.1.20:3081/ws/mobile'],
  },
};
const directResult = store.pairWithPayload(Buffer.from(JSON.stringify(directQr)).toString('base64url'));
assert.equal(directResult.ok, true, 'an explicit mini-program QR can authorize its Cloudflare endpoint');
assert.equal(instances[0].endpoint, 'wss://gateway.example.com/ws/mobile');
assert.equal(instances[0].options.pairingCode, directQr.pairingCode);
assert.deepEqual(instances[0].options.endpointCandidates, ['ws://192.168.1.20:3081/ws/mobile'],
  'initial pairing keeps LAN fallbacks when the public route is unreachable');
assert.equal(instances[0].options.relay, undefined, 'Cloudflare direct pairing stays on the normal gateway protocol');

const automaticLanQr = {
  version: 2,
  publicUrl: 'ws://192.168.1.21:3081/ws/mobile',
  endpoints: ['ws://192.168.1.21:3081/ws/mobile'],
  pairingCode: 'e'.repeat(43),
  expiresAt: Date.now() + 60000,
  gatewayId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};
const automaticResult = store.pairWithPayload(Buffer.from(JSON.stringify(automaticLanQr)).toString('base64url'));
assert.equal(automaticResult.ok, true, 'a scanned automatic-mode QR confirms a new LAN endpoint without a mini-program route');
assert.equal(instances[0].endpoint, automaticLanQr.publicUrl);
assert.equal(instances[0].options.pairingCode, automaticLanQr.pairingCode);

(async function () {
  const remote = hosts.newProfile({ gatewayId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    gatewayName: '远程主机', endpoints: ['wss://remote.example.com/ws/mobile'] });
  store.state.profiles.push(remote);
  hosts.saveProfiles(store.state.profiles);
  hosts.saveCredential(remote.id, remote.endpoints[0], 'remote-device-token');
  store.state.activeID = null;
  store.state.connection = 'disconnected';
  const remoteRemoval = store.forgetHosts([remote.id]);
  const temporary = instances[1];
  assert.equal(temporary.options.probe, true, 'non-active hosts are revoked using a short-lived authenticated socket');
  assert.equal(temporary.options.token, 'remote-device-token');
  temporary.cb.onState('connected');
  const remoteResult = await remoteRemoval;
  assert.equal(temporary.forgetCalled, true);
  assert.equal(remoteResult.revoked, 1);
  assert.equal(store.state.profiles.some(item => item.id === remote.id), false);

  store.state.activeID = profile.id;
  store.state.connection = 'connected';
  client.state = 'connected';
  let selfForgetCalled = false;
  client.forgetDevice = () => { selfForgetCalled = true; return Promise.resolve({ kind: 'device-forgotten' }); };
  const result = await store.forgetHosts([profile.id]);
  assert.equal(selfForgetCalled, true, 'deleting an active host revokes the device through its existing connection');
  assert.equal(result.revoked, 1);
  assert.equal(result.failed, 0);
  assert.equal(store.state.profiles.some(item => item.id === profile.id), false);
delete global.wx;
console.log('relay store identity and reconnect persistence: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
