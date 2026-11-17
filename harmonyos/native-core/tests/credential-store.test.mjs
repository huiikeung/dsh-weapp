import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/main/ets/state/CredentialStore.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const code = stripTypeScriptTypes(source) + ';globalThis.store = CredentialStore.get();';
const gateway = (token) => ({ id: 'one', name: 'one', wsUrl: 'ws://host', token, pairCode: '',
  relayNodeId: '', relayAgentPubKey: '', inviteToken: '', accessToken: '', pairedAt: 1, lastConnectedAt: 1 });

function setup({ secure = '', fallback = '', ready = true, writes = true } = {}) {
  const values = { savedGateways: fallback };
  const state = { secure, ready, writes };
  const prefs = { isReady: () => state.ready, getString: (key, def) => values[key] ?? def,
    putString: (key, value) => { values[key] = value; } };
  const vault = { read: () => state.secure || null, write: value => {
    if (!state.writes) return false;
    state.secure = value; return true;
  }, clear: () => { state.secure = ''; } };
  const context = { PreferencesStore: { get: () => prefs }, SecureCredentialStore: vault,
    Logger: { info() {}, warn() {} }, store: null };
  runInNewContext(code, context);
  return { store: context.store, state, values };
}

test('fallback wins over stale asset and migrates', () => {
  const s = setup({ secure: JSON.stringify([gateway('old')]), fallback: JSON.stringify([gateway('new')]) });
  assert.equal(s.store.load().token, 'new');
  assert.equal(JSON.parse(s.state.secure)[0].token, 'new');
  assert.equal(s.values.savedGateways, '');
});

test('failed migration preserves fallback', () => {
  const fallback = JSON.stringify([gateway('new')]);
  const s = setup({ fallback, writes: false });
  assert.equal(s.store.load().token, 'new');
  assert.equal(s.values.savedGateways, fallback);
});

test('malformed fallback never overwrites the asset', () => {
  const secure = JSON.stringify([gateway('old')]);
  const s = setup({ secure, fallback: '{bad' });
  assert.equal(s.store.load(), null);
  assert.equal(s.state.secure, secure);
  assert.equal(s.values.savedGateways, '{bad');
});

test('forget persists tombstone when secure store fails', () => {
  const s = setup({ secure: JSON.stringify([gateway('old')]), writes: false });
  s.store.clear();
  assert.equal(s.values.savedGateways, '[]');
  const restarted = setup({ secure: s.state.secure, fallback: s.values.savedGateways });
  assert.equal(restarted.store.load(), null);
  assert.equal(restarted.state.secure, '[]');
});

test('early read does not poison later initialization', () => {
  const s = setup({ fallback: JSON.stringify([gateway('ready')]), ready: false });
  assert.equal(s.store.load(), null);
  s.state.ready = true;
  assert.equal(s.store.load().token, 'ready');
});
