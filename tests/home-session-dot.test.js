const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storeFile = path.resolve(__dirname, '../miniprogram/utils/store.js');
const TTL = 24 * 60 * 60 * 1000;

// 用真实的 store 模块跑会话列表状态机：只替换 wx 存储与 gateway。
function fixture(storage = {}) {
  const file = storeFile;
  const mod = { exports: {} };
  class FakeClient {
    constructor(callback) {
      this.callbacks = callback;
      this.connectGeneration = 1;
      return new Proxy(this, { get(t, k) { return k in t ? t[k] : () => true; } });
    }
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: mod,
    Date,
    console,
    wx: {
      getStorageSync: (key) => storage[key],
      setStorageSync: (key, value) => { storage[key] = value; },
      removeStorageSync: (key) => { delete storage[key]; },
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    require: (name) => (name === './gateway'
      ? { GatewayClient: FakeClient }
      : require(path.resolve(path.dirname(file), name))),
  });
  const store = mod.exports;
  store.state.connection = 'connected';
  const push = (items) => store.client.callbacks.onFrame({ sessionId: '', kind: 'sessions', items });
  const byId = (id) => store.state.sessions.find((item) => item.sessionId === id) || {};
  return { store, push, byId, storage };
}

test('a session that stops running is stamped with its completion time', () => {
  const f = fixture();
  f.push([{ sessionId: 'a', title: 'A', running: true, updatedAt: Date.now() }]);
  assert.ok(!f.byId('a').completedAt, 'a running session is not marked complete');

  const before = Date.now();
  f.push([{ sessionId: 'a', title: 'A', running: false, updatedAt: Date.now() }]);
  const stamped = f.byId('a').completedAt;
  assert.ok(stamped >= before, 'finishing stamps the completion time');
  assert.ok(f.storage.dsh_session_completed.a >= before, 'the stamp is persisted locally');
});

test('the completion stamp expires after 24 hours so the dot returns to grey', () => {
  const storage = { dsh_session_completed: { a: Date.now() - TTL + 60_000 } };
  const fresh = fixture(storage);
  fresh.push([{ sessionId: 'a', title: 'A', running: false, updatedAt: Date.now() }]);
  assert.ok(fresh.byId('a').completedAt > 0, 'within 24h the stamp survives');
  assert.ok(Date.now() - fresh.byId('a').completedAt < TTL, 'still inside the grey-out window');

  // 超过 24h：重新加载时被清掉，绿点回到默认灰点
  const stale = fixture({ dsh_session_completed: { a: Date.now() - TTL - 60_000 } });
  stale.push([{ sessionId: 'a', title: 'A', running: false, updatedAt: Date.now() }]);
  assert.equal(stale.byId('a').completedAt, 0, 'past 24h no completion stamp is restored');
  assert.ok(!stale.byId('a').completedAt, 'so the home list falls back to the default grey dot');
});

test('opening a session clears its stamp so the dot greys out immediately', () => {
  const f = fixture();
  f.push([{ sessionId: 'a', title: 'A', running: true, updatedAt: Date.now() }]);
  f.push([{ sessionId: 'a', title: 'A', running: false, updatedAt: Date.now() }]);
  assert.ok(f.byId('a').completedAt > 0, 'finished and unread: stamped');

  f.store.openSession('a', 'A');
  assert.ok(!f.byId('a').completedAt, 'opening the conversation clears the stamp');
  assert.ok(!f.storage.dsh_session_completed || !f.storage.dsh_session_completed.a,
    'the persisted stamp is removed too, so a restart does not resurrect the green dot');
});

test('a desktop read clears the green dot through the gateway timestamp', () => {
  const f = fixture();
  f.push([{ sessionId: 'a', title: 'A', running: true, updatedAt: Date.now() }]);
  f.push([{ sessionId: 'a', title: 'A', running: false, updatedAt: Date.now() }]);
  assert.ok(f.byId('a').completedAt > 0, 'finished and unread: green');

  // 电脑端点进这个会话：网关在 subscribe/history 时记账，随 sessions 帧下发。
  const finishedAt = f.byId('a').completedAt;
  f.push([{ sessionId: 'a', title: 'A', running: false, updatedAt: Date.now(), lastOpenedAt: finishedAt + 500 }]);
  const row = f.byId('a');
  assert.equal(row.lastOpenedAt, finishedAt + 500, 'the gateway timestamp reaches the store');
  const green = !row.running && !!row.completedAt && (Date.now() - row.completedAt) < 86400000
    && Math.max(row.lastOpenedAt || 0, row.viewedAt || 0) < row.completedAt;
  assert.ok(!green, 'read after finishing: grey even though the phone never opened it');
});

test('a read that predates the finish does not clear the dot', () => {
  const f = fixture();
  f.push([{ sessionId: 'b', title: 'B', running: true, updatedAt: Date.now(), lastOpenedAt: Date.now() - 60_000 }]);
  f.push([{ sessionId: 'b', title: 'B', running: false, updatedAt: Date.now(), lastOpenedAt: Date.now() - 60_000 }]);
  const row = f.byId('b');
  const green = !row.running && !!row.completedAt && (Date.now() - row.completedAt) < 86400000
    && Math.max(row.lastOpenedAt || 0, row.viewedAt || 0) < row.completedAt;
  assert.ok(green, 'you looked before it finished: it still counts as newly done');
});

test('viewing one session leaves other finished sessions green', () => {
  const f = fixture();
  f.push([
    { sessionId: 'a', title: 'A', running: true, updatedAt: Date.now() },
    { sessionId: 'b', title: 'B', running: true, updatedAt: Date.now() },
  ]);
  f.push([
    { sessionId: 'a', title: 'A', running: false, updatedAt: Date.now() },
    { sessionId: 'b', title: 'B', running: false, updatedAt: Date.now() },
  ]);
  assert.ok(f.byId('a').completedAt > 0 && f.byId('b').completedAt > 0, 'both finished');

  f.store.openSession('a', 'A');
  assert.ok(!f.byId('a').completedAt, 'viewed session greys out');
  assert.ok(f.byId('b').completedAt > 0, 'the unviewed session keeps its green dot');
});

test('only sessions that actually stopped running get a stamp', () => {
  const f = fixture();
  f.push([
    { sessionId: 'idle', title: 'Idle', running: false, updatedAt: Date.now() },
    { sessionId: 'busy', title: 'Busy', running: true, updatedAt: Date.now() },
  ]);
  assert.ok(!f.byId('idle').completedAt, 'a session that was never running is not "just finished"');
  assert.ok(!f.byId('busy').completedAt, 'a running session is not "just finished"');
});

test('the home list renders four dot states and greys out when the stamp is gone', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8');
  assert.match(wxml, /session-dot \{\{item\.running \? 'running' : \(item\.hasUnread \? 'unread' : \(item\.recentlyCompleted \? 'done' : ''\)\)\}\}/,
    'running / unread / recently-completed / default are all reachable');
  assert.match(wxss, /\.session-dot \{[^}]*background: rgba\(255, 255, 255, 0\.4\)/, 'the default dot stays grey');
  assert.match(wxss, /\.session-dot\.done \{[^}]*background: var\(--success\)/, 'the 24h dot is green');
  assert.match(wxss, /\.session-dot\.running \{[^}]*animation: sessionDotSpin/, 'the running dot is the spinning ring');
  // 「看过即灰」必须同时看本机 viewedAt 与网关 lastOpenedAt。
  const home = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.js'), 'utf8');
  assert.match(home, /var seen = Math\.max\(Number\(s\.lastOpenedAt\) \|\| 0, Number\(s\.viewedAt\) \|\| 0\)/,
    'the dot considers both the gateway read stamp and the local one');
  assert.match(home, /return seen < done/, 'and greys out once the session was read after finishing');
  // 运行中的圆环保持中性灰白，不抢绿点/蓝点的语义色。
  const running = wxss.match(/\.session-dot\.running \{([^}]*)\}/)[1];
  assert.ok(!/--success|46, 184, 92/.test(running), 'the spinning ring must not use the success colour');
  assert.match(running, /rgba\(255, 255, 255, 0\.82\)/, 'the arc is a neutral white');
});
