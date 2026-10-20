const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} }, timers = new Map(), storage = new Map(), requests = [];
  let serial = 0;
  class Client {
    constructor(callbacks) {
      this.callbacks = callbacks; this.connectGeneration = 1;
      return new Proxy(this, { get(target, key) {
        if (key in target) return target[key];
        return () => true;
      } });
    }
    requestHistory(...args) { requests.push(args); return true; }
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module, Date, console, wx: { getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) },
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout: id => timers.delete(id), setInterval() { return 0; }, clearInterval() {},
    require: name => name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(file), name))
  });
  const store = module.exports;
  store.state.connection = 'connected'; store.sessionState.sessionId = 's';
  return { store, requests, storage,
    frame: value => store.client.callbacks.onFrame({ sessionId: store.sessionState.sessionId, ...value }),
    flush(delay = 200) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } } };
}
const user = (seq, text) => ({ seq, type: 'user/message', data: { text, source: 'user' } });
const history = (events, cursor, hasMore = true) => ({ kind: 'history', events, nextBeforeSeq: cursor, hasMore, historyFormatVersion: 1 });

test('history loads one page per user request and never drains remaining pages automatically', () => {
  const f = fixture();
  f.frame(history([user(30, 'latest')], 30)); f.flush();
  assert.equal(f.requests.length, 0);
  f.store.loadOlderHistory();
  assert.deepEqual(f.requests, [['s', 30, 1]]);
  assert.equal(f.store.sessionState.historyPaging, true);
  f.store.loadOlderHistory(); assert.equal(f.requests.length, 1);
  f.frame(history([user(20, 'middle')], 20)); f.flush();
  assert.equal(f.requests.length, 1);
  f.store.loadOlderHistory();
  f.frame(history([user(10, 'oldest')], 10, false)); f.flush();
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['oldest', 'middle', 'latest']);
  assert.equal(f.requests.length, 2); assert.equal(f.store.sessionState.historyPaging, false);
  f.frame(history([], 20)); f.flush(); assert.equal(f.requests.length, 2);
  f.frame({ kind: 'session-snapshot', events: [], hasMore: true, cursor: 20 });
  f.flush(); assert.equal(f.requests.length, 2);
});

test('idle history does not prefetch and timeout allows manual retry', () => {
  for (const mode of ['session', 'connection', 'offline']) {
    const f = fixture(); f.frame(history([user(30, 'latest')], 30));
    if (mode === 'session') f.store.sessionState.sessionId = 'other';
    if (mode === 'connection') f.store.client.connectGeneration++;
    if (mode === 'offline') f.store.state.connection = 'disconnected';
    f.flush(); assert.equal(f.requests.length, 0, mode);
  }
  const f = fixture(); f.frame(history([user(30, 'latest')], 30)); f.store.loadOlderHistory(); f.flush(8000);
  assert.equal(f.store.sessionState.historyPaging, false);
  f.store.loadOlderHistory(); assert.equal(f.requests.length, 2);
});

test('reopening restores cached conversation and builds trajectory only on activation', () => {
  const f = fixture(); f.frame(history([user(10, 'old'), user(30, 'latest')], 0, false));
  assert.equal(f.store.sessionState.trajectory.length, 0);
  f.store.openSession('other', 'Other'); f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.rows.length, 2);
  assert.equal(f.store.sessionState.trajectory.length, 0);
  f.store.setTrajectoryActive(true);
  assert.ok(f.store.sessionState.trajectory.length);
  f.frame(history([user(30, 'updated')], 30));
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['old', 'updated']);
  f.frame({ kind: 'session-snapshot', replace: true, events: [user(30, 'snapshot')] });
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['old', 'snapshot']);
  f.frame({ ...history([user(40, 'reset')], 0, false), resetRequired: true });
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['reset']);
});

test('large histories retain complete in-memory cache despite disk capacity limit', () => {
  const f = fixture(); f.frame(history([user(10, 'x'.repeat(650000))], 0, false));
  f.store.openSession('other', 'Other'); f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.rows[0].text.length, 650000);
  f.store.setTrajectoryActive(true);
  assert.ok(f.store.sessionState.trajectory.length);
});

test('failed pages wait for manual retry and retain realtime records while paging', () => {
  const f = fixture(); f.frame(history([user(30, 'latest')], 30)); f.store.loadOlderHistory();
  f.flush(8000); f.flush(1000); assert.equal(f.requests.length, 1);
  f.flush(8000); f.flush(2000); assert.equal(f.requests.length, 1);
  f.flush(8000); f.flush(2000); f.flush();
  assert.equal(f.requests.length, 1); assert.ok(f.store.sessionState.historyError);
  f.store.loadOlderHistory(); assert.equal(f.requests.length, 2);
  f.frame({ kind: 'event', events: [user(40, 'live')] });
  f.frame(history([user(10, 'oldest')], 0, false));
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['oldest', 'latest', 'live']);
  assert.equal(f.store.sessionState.historyError, '');
});

test('history pages coalesce disk writes but memory and visible records update immediately', () => {
  const f = fixture();
  f.frame(history([user(30, 'latest')], 30)); f.flush();
  f.frame(history([user(20, 'middle')], 20)); f.flush();
  f.frame(history([user(10, 'oldest')], 0, false));
  assert.equal(f.store.sessionState.rows.length, 3);
  assert.equal(f.storage.has('dsh_session_cache.s'), false);
  f.flush(1000);
  assert.equal(JSON.parse(f.storage.get('dsh_session_cache.s')).rows.length, 3);
});

test('invalid cursors report an error instead of endlessly pretending to load', () => {
  const f = fixture(); f.frame(history([user(30, 'latest')], null)); f.store.loadOlderHistory();
  assert.equal(f.requests.length, 0); assert.ok(f.store.sessionState.historyError);
  assert.equal(f.store.sessionState.historyPaging, false);
});

test('large cached sessions reopen only the recent window and can still request earlier records', () => {
  const f = fixture();
  f.frame(history(Array.from({ length: 300 }, (_, i) => user(i + 1, 'Question ' + i)), 0, false));
  f.store.openSession('other', 'Other'); f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.rows.length, 80);
  assert.equal(f.store.sessionState.rows[0].seq, 221);
  assert.equal(f.store.sessionState.hasMoreHistory, true);
  assert.equal(f.store.sessionState.trajectory.length, 0);
  f.store.loadOlderHistory(); assert.deepEqual(f.requests.at(-1), ['s', 221, 1]);
});
