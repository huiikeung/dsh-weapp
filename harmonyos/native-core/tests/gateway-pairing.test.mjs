import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const requestSource = readFileSync(new URL('../src/main/ets/protocol/GatewayRequest.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const source = readFileSync(new URL('../src/main/ets/network/GatewayClient.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const code = stripTypeScriptTypes(requestSource + '\n' + source, { mode: 'transform' }) + ';globalThis.client = GatewayClient.get();';
function setup() {
  const sockets = [], timers = [], saved = [], values = new Map();
  const webSocket = { createWebSocket() { const socket = { handlers: {}, on(type, fn) { this.handlers[type] = fn; },
    off() {}, close() {}, connect(url, options, cb) { this.url = url; this.options = options; this.callback = cb; },
    send(_text, cb) { if (cb) cb(null); }, emit(type, ...args) { this.handlers[type]?.(...args); } };
    sockets.push(socket); return socket; } };
  const gateway = { id: 'other', name: 'other', wsUrl: 'ws://other/ws', pairCode: '', token: 'existing',
    relayNodeId: '', relayAgentPubKey: '', inviteToken: '', accessToken: '', pairedAt: 1, lastConnectedAt: 1 };
  const credentials = { list: () => saved, save: item => saved.push(item), setActive: id => id === 'other' ? gateway : null,
    load: () => gateway, clear() {} };
  const noopStore = { count: 0, consume() { this.count++; }, clearPendingPrompts() {}, prepareGateway() {}, resumeAfterConnect() {} };
  const context = { webSocket, AppStorage: { setOrCreate: (k,v) => values.set(k,v), get: k => values.get(k) },
    Logger: { info() {}, warn() {}, error() {} }, KEY_CONNECTION: 'state', decodeFrame: JSON.parse,
    GatewayRequests: new Proxy({}, { get: () => () => '{}' }), randomBytes: n => new Uint8Array(n).fill(1),
    PreferencesStore: { get: () => ({ getString: () => '', putString() {} }) },
    CredentialStore: { get: () => credentials }, PluginStore: { get: () => noopStore },
    ScheduleStore: { get: () => noopStore }, SessionStore: { get: () => noopStore },
    NotificationService: {}, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    Map, Number, Math, Date, JSON, Error, Uint8Array, String, Object };
  runInNewContext(code, context);
  const pairing = { ok: true, pairCode: 'code', expiresAt: Date.now() + 60000, candidates: ['ws://one/ws', 'ws://two/ws'],
    gatewayName: 'one', relayNodeId: '', relayAgentPubKey: '' };
  return { client: context.client, sockets, timers, saved, pairing, values, noopStore };
}
test('session frame is dispatched only through its registered listener', () => {
  const s = setup(); s.client.connectPairing(s.pairing);
  s.client.onFrame(frame => s.noopStore.consume(frame));
  s.sockets[0].emit('message', null, JSON.stringify({ kind: 'history', sessionId: 's' }));
  // PluginStore and ScheduleStore use the same test mock and account for two calls.
  assert.equal(s.noopStore.count, 3);
});
test('pairing token becomes bearer for reconnect', () => {
  const s = setup(); s.client.connectPairing(s.pairing);
  s.sockets[0].emit('message', null, JSON.stringify({ kind: 'paired', token: 'secret' }));
  s.sockets[0].emit('message', null, JSON.stringify({ kind: 'hello' }));
  s.sockets[0].emit('close', null, {});
  s.timers.at(-1)();
  assert.equal(s.sockets[1].options.header.Authorization, 'Bearer secret');
  assert.equal(s.sockets[1].options.protocol, 'dsh-mobile-v1');
});
test('stale candidate retry cannot replace a manually selected gateway', () => {
  const s = setup(); s.client.connectPairing(s.pairing);
  s.sockets[0].emit('error', { code: 1 });
  const retry = s.timers.at(-1); s.client.switchGateway('other'); retry();
  assert.equal(s.sockets.length, 2); assert.equal(s.sockets[1].url, 'ws://other/ws');
});
test('connect callback failure advances candidate only once', () => {
  const s = setup(); s.client.connectPairing(s.pairing);
  s.sockets[0].callback({ code: 1 }); s.sockets[0].emit('close', null, {});
  assert.equal(s.timers.length, 1); s.timers[0]();
  assert.equal(s.sockets.length, 2); assert.equal(s.sockets[1].url, 'ws://two/ws');
});
