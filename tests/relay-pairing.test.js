const assert = require('node:assert/strict');
const { parse, PairingError } = require('../miniprogram/utils/pairing');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const raw = (p) => Buffer.from(JSON.stringify(p)).toString('base64url');
const payload = { version: 3, mode: 'relay', relay: 'wss://relay.example.com',
  nodeId: '12345678-1234-4234-8234-123456789012', agentPubKey: Buffer.alloc(32, 1).toString('base64'),
  pairingCode: 'a'.repeat(43), expiresAt: Date.now() + 60000 };
const parsed = parse(raw(payload));
assert.equal(parsed.ok, true);
assert.equal(parsed.payload.authMode, 'gateway');
assert.equal(parsed.payload.pairingCode, payload.pairingCode);
assert.equal(parsed.payload.gatewayId, payload.nodeId);
const invite = parse(raw({ ...payload, inviteToken: 'b'.repeat(43) }));
assert.equal(invite.payload.authMode, 'invite');
assert.equal(invite.payload.pairingCode, null);
assert.equal(parse(raw({ ...payload, pairingCode: null })).error, PairingError.MISSING_RELAY_AUTH);
assert.equal(parse(raw({ ...payload, expiresAt: 1 })).error, PairingError.EXPIRED);
for (const patch of [{ relay: 'ws://relay.example.com' }, { relay: 'wss://user@relay.example.com' },
  { relay: 'wss://relay.example.com?token=x' }, { nodeId: '../bad-node' }, { agentPubKey: 'bad' }]) {
  assert.equal(parse(raw({ ...payload, ...patch })).error, PairingError.INVALID_RELAY);
}
let socketOptions;
const sent = [];
global.wx = { getStorageSync: () => 'fixture-device-id', setStorageSync() {},
  connectSocket(options) { socketOptions = options; return {
    onOpen() {}, onMessage() {}, onError() {}, onClose() {},
    send(value) { sent.push(value.data); }, close() {}
  }; } };
const client = new GatewayClient();
client.reportDeviceInfo = () => {};
client.connect(parsed.payload.publicUrl, { pairingCode: payload.pairingCode, relay: parsed.payload });
assert.deepEqual(socketOptions.protocols, ['dsh-mobile-v1']);
assert.equal(socketOptions.header.Authorization, undefined);
let auth;
client.relaySession = { ready: false, acceptAgentHello() { this.ready = true; return true; },
  seal(text) { auth = JSON.parse(text); return new Uint8Array([3]); } };
client.handleRelayMessage(new Uint8Array([2]).buffer);
assert.equal(client.state, 'connecting', 'E2EE alone must not report authenticated');
assert.equal(auth.type, 'relay-auth');
assert.equal(auth.pairingCode, payload.pairingCode);
client.handleRelayMessage(JSON.stringify({ kind: 'paired', token: 'forged' }));
assert.equal(client.lastToken, undefined, 'Plaintext relay must not inject gateway frames');
client.handleFrame(JSON.stringify({ kind: 'paired', token: 'c'.repeat(43) }));
client.handleFrame(JSON.stringify({ kind: 'hello' }));
assert.equal(client.state, 'connected');
assert.equal(client.pairingCode, null);
assert.equal(client.lastConnectOpts.token, 'c'.repeat(43));
client.connect(parsed.payload.publicUrl, client.lastConnectOpts);
assert.equal(socketOptions.header.Authorization, undefined, 'Reconnect token stays inside E2EE');
assert.deepEqual(socketOptions.protocols, ['dsh-mobile-v1']);
client.handleFrame(JSON.stringify({ kind: 'relay-auth-error', message: 'revoked' }));
assert.equal(client.wantsConnection, false);
assert.equal(client.state, 'failed');
client.disconnect();
delete global.wx;
console.log('relay pairing and encrypted authentication: PASS');
