const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} }, timers = new Map(), storage = new Map(), requests = [], calls = [], metricRequests = [], subscriptions = [];
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
    subscribe(...args) { subscriptions.push(args); return true; }
    requestSessions(...args) { calls.push(['requestSessions', ...args]); return true; }
    requestSessionStats(...args) { metricRequests.push(['stats', ...args]); return true; }
    requestContextUsage(...args) { metricRequests.push(['context', ...args]); return true; }
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
  return { store, requests, calls, storage, metricRequests, subscriptions,
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

test('previously visited history pages load from the host-scoped local page cache, including offline', () => {
  const f = fixture();
  f.frame(history([user(50, 'latest')], 50));
  f.store.loadOlderHistory();
  assert.deepEqual(f.requests, [['s', 50, 1]]);
  f.frame(history([user(30, 'older page')], 30));
  assert.ok(f.store.sessionState.historyLastPageBytes > 0, 'the active page records its bounded warm-up byte cost');
  f.flush(500);
  const networkRequests = f.requests.length;

  // Re-entering the already visited turn range should use its immutable cached
  // page, even if the gateway is currently unavailable.
  f.store.sessionState.nextBeforeSeq = 50;
  f.store.state.connection = 'disconnected';
  f.store.loadOlderHistory();
  assert.equal(f.requests.length, networkRequests);
  assert.equal(f.store.sessionState.historyPaging, false);
  assert.equal(f.store.sessionState.nextBeforeSeq, 30);
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['older page', 'latest']);
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

test('sending while a cached session is displayed keeps the whole conversation', () => {
  // A bounded local window keeps several history pages available after a switch.
  const many = Array.from({ length: 200 }, (_, i) => user(i + 1, 'm' + (i + 1)));
  const f = fixture(); f.frame(history(many, 1)); f.flush(1000);
  f.store.openSession('other', 'Other'); f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.rows.length, 200);
  assert.equal(f.store.sessionState.rows[0].text, 'm1');

  // 发送：乐观回显必须追加在缓存后面，而不是把整段缓存顶掉
  f.store.appendLocalUserRow('我刚发的这一条', [], []);
  assert.equal(f.store.sessionState.rows.length, 201);
  assert.equal(f.store.sessionState.rows[0].text, 'm1');
  assert.equal(f.store.sessionState.rows.at(-1).text, '我刚发的这一条');

  // 权威历史到达：真实事件就地收养乐观回显，不产生双气泡
  f.frame(history(many.slice(180).concat([user(201, '我刚发的这一条')]), 181));
  const texts = Array.from(f.store.sessionState.rows, row => row.text);
  assert.equal(texts.filter(text => text === '我刚发的这一条').length, 1);
  assert.equal(texts.at(-1), '我刚发的这一条');
  assert.ok(texts.includes('m200'));

  // 退出再进入：缓存里仍有这条
  f.flush(1000);
  f.store.openSession('other', 'Other'); f.store.openSession('s', 'Original');
  assert.ok(Array.from(f.store.sessionState.rows, row => row.text).includes('我刚发的这一条'));
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

test('cached history renders instantly and still falls back to a fresh tail request', () => {
  const f = fixture();
  f.frame(history([user(30, 'latest')], 30)); f.flush(1000);
  f.store.openSession('other', 'Other');
  f.store.openSession('s', 'Original');
  // 缓存命中：本地内容立即可见，不等网关
  assert.equal(f.store.sessionState.historyState, 'loaded:cached');
  assert.equal(f.store.sessionState.cacheDisplay, true);

  // 快照优先架构下，权威尾部由订阅推送的 session-snapshot 提供；
  // 快照 1.2s 内没到才回落到 history——缓存行不能把这次兜底压掉。
  const beforeFallback = f.requests.length;
  f.flush(1200);
  assert.ok(f.requests.length > beforeFallback, 'cached rows must not suppress the history fallback');
  assert.ok(f.requests.slice(beforeFallback).some(args => args[0] === 's' && args.length === 1));
});

test('cached sequence is sent on subscribe and replay events survive the opening snapshot', () => {
  const f = fixture();
  f.frame(history([user(10, 'old'), user(20, 'cached tail')], 10, true)); f.flush();
  f.store.openSession('other', 'Other');
  f.store.openSession('s', 'Original');
  assert.deepEqual(f.subscriptions.at(-1), ['s', 20]);

  // The gateway's complete replay arrives before its calibrating snapshot.
  f.frame({ kind: 'event', resumed: true, events: [user(21, 'replayed gap')] }); f.flush();
  f.frame({ kind: 'session-snapshot', replace: true, recovery: 'replayed', resumeFromSeq: 20,
    resumeToSeq: 22, cursor: 22, events: [user(22, 'snapshot tail')], hasMore: true });
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text),
    ['old', 'cached tail', 'replayed gap', 'snapshot tail']);
});

test('a lightweight resume calibration keeps replayed history and avoids replacing the local tail', () => {
  const f = fixture();
  f.frame(history([user(10, 'cached tail')], 10));
  f.frame({ kind: 'event', seq: 11, time: 11,
    event: { type: 'user/message', text: 'replayed after reconnect' }, resumed: true });
  f.frame({ kind: 'session-snapshot', sessionId: 's', replace: false, events: [], cursor: 11,
    hasMore: true, historyFormatVersion: 1, recovery: 'replayed',
    assistantStream: { revision: 0 } });
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text),
    ['cached tail', 'replayed after reconnect']);
  assert.equal(f.store.sessionState.historyState, 'loaded:cached');
});

test('an incomplete gateway replay keeps its snapshot visible and requests tail reconciliation', () => {
  const f = fixture();
  f.frame(history([user(10, 'cached')], 10, true));
  f.store.openSession('other', 'Other');
  f.store.openSession('s', 'Original');
  const before = f.requests.length;
  f.frame({ kind: 'session-snapshot', replace: true, recovery: 'snapshot', resumeFromSeq: 10,
    resumeToSeq: 25, cursor: 25, events: [user(25, 'fresh tail')], hasMore: true });
  assert.ok(f.requests.length > before);
  assert.equal(f.store.sessionState.rows.at(-1).text, 'fresh tail');
});

test('an empty opening snapshot with a positive cursor falls back even without hasMore', () => {
  const f = fixture();
  f.store.openSession('s', 'Long conversation');
  const before = f.requests.length;
  f.frame({ kind: 'session-snapshot', replace: true, cursor: 7482, hasMore: false, events: [] });
  assert.ok(f.requests.length > before, 'an empty bounded snapshot must not strand an older session on the empty state');
  assert.deepEqual(f.requests.at(-1), ['s']);
});

test('an empty versioned snapshot pages the host tail instead of reporting an empty conversation', () => {
  const f = fixture();
  f.store.openSession('s', 'Long conversation');
  f.frame({ kind: 'session-snapshot', replace: true, cursor: 7482, hasMore: false,
    historyFormatVersion: 4, events: [] });
  assert.deepEqual(f.requests.at(-1), ['s', 7483, 4]);
  assert.equal(f.store.sessionState.historyPaging, true);
  assert.equal(f.store.sessionState.hasMoreHistory, true);
  assert.notEqual(f.store.sessionState.historyState, 'loaded:0ev');
});

test('an empty snapshot at sequence zero does not trigger a redundant history request', () => {
  const f = fixture();
  f.store.openSession('s', 'Actually empty conversation');
  const before = f.requests.length;
  f.frame({ kind: 'session-snapshot', replace: true, cursor: 0, hasMore: false, events: [] });
  assert.equal(f.requests.length, before);
});

test('an empty history tail with a non-zero cursor gets one bounded fallback request', () => {
  const f = fixture();
  f.store.openSession('s', 'Long conversation');
  const before = f.requests.length;
  f.frame({ kind: 'history', cursor: 7482, hasMore: false, events: [] });
  assert.deepEqual(f.requests.slice(before), [['s']]);
  f.frame({ kind: 'history', cursor: 7482, hasMore: false, events: [] });
  assert.deepEqual(f.requests.slice(before), [['s']], 'a repeated empty reply must not create a request loop');
});

test('an empty versioned history tail requests the latest page once and exposes a failed empty page', () => {
  const f = fixture();
  f.store.openSession('s', 'Long conversation');
  f.frame({ kind: 'history', cursor: 7482, hasMore: false, historyFormatVersion: 4, events: [] });
  assert.deepEqual(f.requests, [['s', 7483, 4]]);
  assert.equal(f.store.sessionState.historyPaging, true);

  f.frame({ kind: 'history', beforeSeq: 7483, cursor: 7482, hasMore: false,
    historyFormatVersion: 4, events: [] });
  assert.equal(f.store.sessionState.historyPaging, false);
  assert.ok(f.store.sessionState.historyError, 'a non-empty host cursor with no returned page is not a valid empty chat');
  f.frame({ kind: 'history', cursor: 7482, hasMore: false, historyFormatVersion: 4, events: [] });
  assert.equal(f.requests.length, 1, 'the repeated empty tail must not trigger a request loop');
});

test('a delayed older snapshot cannot replace newer local conversation content', () => {
  const f = fixture();
  f.frame(history([user(10, 'latest local message')], 10, false));
  f.frame({ kind: 'session-snapshot', replace: true, cursor: 9, historyFormatVersion: 4,
    events: [user(9, 'stale gateway message')] });
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['latest local message']);
  assert.equal(f.store.sessionState.historyState, 'loaded:cached');
  assert.deepEqual(f.requests.at(-1), ['s']);
});

test('a delayed older tail cannot move the visible latest message or pagination cursor backward', () => {
  const f = fixture();
  f.frame(history([user(10, 'latest local message')], 10, false));
  f.frame({ kind: 'history', events: [user(9, 'delayed stale tail')], cursor: 9,
    nextBeforeSeq: 3, hasMore: true, historyFormatVersion: 1 });
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text),
    ['delayed stale tail', 'latest local message']);
  assert.equal(f.store.sessionState.nextBeforeSeq, 10);
  assert.equal(f.store.sessionState.historyState, 'loaded:cached');
});

test('conversation cache entries are isolated by active gateway', () => {
  const f = fixture();
  f.store.state.activeID = 'gateway-a';
  f.frame(history([user(10, 'private history')], 10, false));
  f.store.openSession('other', 'Other');
  f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.rows[0].text, 'private history');

  f.store.state.activeID = 'gateway-b';
  f.store.openSession('s', 'Same ID on another gateway');
  assert.equal(f.store.sessionState.rows.length, 0);
  assert.equal(f.store.sessionState.cacheDisplay, false);
});

test('an unscoped legacy conversation cache migrates only for its sole known gateway', () => {
  const f = fixture();
  f.store.state.activeID = 'gateway-a';
  f.store.state.profiles = [{ id: 'gateway-a' }];
  f.storage.set('dsh_session_cache.s', JSON.stringify({
    events: [user(7, 'legacy record')], rows: [], hasMore: false,
    nextBeforeSeq: 0, historyFormatVersion: 1
  }));
  f.store.openSession('s', 'Legacy');
  assert.equal(f.store.sessionState.rows[0].text, 'legacy record');
  assert.equal(f.store.sessionState.cacheDisplay, true);
});

test('a reconnect refreshes an already-loaded tail and does not trust the old connection state', () => {
  const f = fixture();
  f.frame(history([user(30, 'old tail')], 30));
  f.store.state.connection = 'disconnected';
  const beforeReconnect = f.requests.length;

  f.store.client.callbacks.onState('connected');
  assert.equal(f.store.sessionState.historyState, 'requested');
  assert.equal(f.store.sessionState.cacheDisplay, true);
  f.flush(1200);

  assert.ok(f.requests.length > beforeReconnect, 'a missing reconnect reply must be retried');
  assert.ok(f.requests.slice(beforeReconnect).some(args => args[0] === 's'));
});

test('cached composer stats and per-turn usage restore with the conversation', () => {
  const f = fixture();
  const events = [
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 3, type: 'assistant/message', data: {
      turn: 1, step: 1,
      message: { content: [{ type: 'text', text: 'done' }] },
      usage: { inputTokens: 100, outputTokens: 25, cacheReadTokens: 50, cacheWriteTokens: 0, totalTokens: 175 }
    } },
    { seq: 4, type: 'step/end', data: { turn: 1, step: 1 } },
    { seq: 5, type: 'turn/end', data: { turn: 1 } }
  ];
  f.frame(history(events, 0, false));
  f.frame({ kind: 'session-stats', sessionStats: { turns: 1, steps: 1 },
    tokenUsage: { totals: { inputTokens: 125, outputTokens: 25 }, uncachedInputTokens: 100, cacheReadTokens: 25 },
    contextPressure: { pressureTokens: 40, contextWindow: 100 } });
  f.flush(1000);

  f.store.openSession('other', 'Other');
  f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.stats.stats.turns, 1);
  assert.equal(f.store.sessionState.stats.pressure.contextWindow, 100);
  assert.equal(f.store.sessionState.turnUsage[1].totalTokens, 175);
});

test('session projections hydrate composer metrics directly from the history snapshot', () => {
  const f = fixture();
  f.frame({ ...history([user(30, 'latest')], 30, false), projections: {
    asOfSeq: 30,
    values: {
      sessionStats: { turns: 2, steps: 11 },
      tokenUsage: { uncachedInputTokens: 1000, cacheReadTokens: 500, cacheWriteTokens: 20, outputTokens: 80 },
      contextPressure: { projectedTokens: 60, pressureTokens: 50, contextWindow: 100 }
    }
  } });

  assert.equal(f.store.sessionState.stats.stats.turns, 2);
  assert.equal(f.store.sessionState.stats.stats.steps, 11);
  assert.equal(f.store.sessionState.stats.tokenUsage.cacheReadTokens, 500);
  assert.equal(f.store.sessionState.stats.pressure.projectedTokens, 60);
  f.flush(700);
  assert.deepEqual(f.metricRequests, [], 'complete DSH projections avoid a redundant full-log stats scan');
});

test('session snapshots also hydrate the DSH metrics before the async stats RPC', () => {
  const f = fixture();
  f.frame({ kind: 'session-snapshot', replace: true, events: [user(40, 'latest')], projections: {
    asOfSeq: 40,
    values: {
      sessionStats: { turns: 4, steps: 13 },
      tokenUsage: { uncachedInputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 0, outputTokens: 10 },
      contextPressure: { projectedTokens: 80, contextWindow: 100 }
    }
  } });

  assert.equal(f.store.sessionState.stats.stats.turns, 4);
  assert.equal(f.store.sessionState.stats.tokenUsage.outputTokens, 10);
  assert.equal(f.store.sessionState.stats.pressure.projectedTokens, 80);
  f.flush(700);
  assert.deepEqual(f.metricRequests, []);
});

test('partial metric frames merge without clearing the other DSH projections', () => {
  const f = fixture();
  f.frame({ kind: 'context-usage',
    tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 25, cacheWriteTokens: 5, outputTokens: 20 },
    contextPressure: { projectedTokens: 40, pressureTokens: 35, contextWindow: 100 } });
  f.frame({ kind: 'session-stats', sessionStats: { turns: 3, steps: 9 } });

  assert.equal(f.store.sessionState.stats.stats.turns, 3);
  assert.equal(f.store.sessionState.stats.stats.steps, 9);
  assert.equal(f.store.sessionState.stats.tokenUsage.uncachedInputTokens, 100);
  assert.equal(f.store.sessionState.stats.tokenUsage.cacheWriteTokens, 5);
  assert.equal(f.store.sessionState.stats.pressure.projectedTokens, 40);
});

test('older history projections cannot roll composer metrics back', () => {
  const f = fixture();
  f.frame({ kind: 'history', projections: { asOfSeq: 70, values: {
    sessionStats: { turns: 7, steps: 21 }
  } } });
  f.frame({ kind: 'history', projections: { asOfSeq: 60, values: {
    sessionStats: { turns: 6, steps: 18 }
  } } });

  assert.equal(f.store.sessionState.stats.stats.turns, 7);
  assert.equal(f.store.sessionState.stats.stats.steps, 21);
  assert.equal(f.store.sessionState.stats.asOfSeq, 70);
});

test('partial session stats do not stop retries before token and context metrics arrive', () => {
  const f = fixture();
  f.frame(history([user(10, 'cached conversation')], 0, false));
  f.flush(700);
  assert.equal(f.metricRequests.length, 2, 'bootstrap requests both metric sources');

  f.frame({ kind: 'session-stats', sessionStats: { turns: 1, steps: 1 } });
  f.flush(2500);
  assert.equal(f.metricRequests.length, 4, 'a basic stats frame must not cancel retries for missing token/context data');

  f.frame({ kind: 'session-stats', sessionStats: { turns: 1, steps: 1 },
    tokenUsage: { totals: { inputTokens: 100, outputTokens: 20 } },
    contextPressure: { pressureTokens: 50, contextWindow: 100 } });
  f.flush(5000);
  assert.equal(f.metricRequests.length, 4, 'complete metric data cancels the next retry');
});

test('opening a session waits for the snapshot and only falls back to history when it is late', () => {
  const f = fixture();
  f.store.openSession('s', 'Current');
  // 订阅成功：等 session-snapshot，不立即补 history（快照与 history 都会让宿主
  // 重读整段会话日志，长会话读一次要好几秒）
  assert.deepEqual(f.requests, []);
  assert.deepEqual(f.calls, [['requestSessions']]);
  // 快照到达：撤销回落
  f.frame({ kind: 'session-snapshot', sessionId: 's', replace: true, events: [user(30, 'latest')],
    projections: { asOfSeq: 30, values: {} }, historyFormatVersion: 1 });
  f.flush(1200);
  assert.deepEqual(f.requests, [], 'a delivered snapshot must cancel the history fallback');
  assert.equal(f.store.sessionState.historyState, 'loaded:1ev');
  assert.equal(f.store.sessionState.rows.length, 1);
});

test('a missing snapshot falls back to a history request', () => {
  const f = fixture();
  f.store.openSession('s', 'Current');
  assert.deepEqual(f.requests, []);
  f.flush(1200);
  assert.deepEqual(f.requests, [['s']], 'no snapshot within the window must re-issue history');
});

test('live turn events update the home summary and beat a stale sessions response', () => {
  const f = fixture();
  f.store.state.sessions = [{ sessionId: 's', running: false, updatedAt: 1 }];
  f.frame({ kind: 'event', events: [{ seq: 1, type: 'turn/start', data: { turn: 1 } }] });
  assert.equal(f.store.sessionState.running, true);
  assert.equal(f.store.state.sessions[0].running, true);

  f.frame({ kind: 'sessions', items: [{ sessionId: 's', running: false }] });
  assert.equal(f.store.state.sessions[0].running, true, 'a response produced before the stream signal must not roll back the status');

  f.frame({ kind: 'event', events: [{ seq: 2, type: 'turn/end', data: { turn: 1 } }] });
  assert.equal(f.store.sessionState.running, false);
  assert.equal(f.store.state.sessions[0].running, false);
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
  f.flush(1000); assert.equal(f.requests.length, 1);
  f.flush(2000); assert.equal(f.requests.length, 1);
  f.flush(8000); f.flush(2000); f.flush();
  assert.equal(f.requests.length, 1); assert.ok(f.store.sessionState.historyError);
  f.store.loadOlderHistory(); assert.equal(f.requests.length, 2);
  f.frame({ kind: 'event', events: [user(40, 'live')] });
  f.frame(history([user(10, 'oldest')], 0, false));
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['oldest', 'latest', 'live']);
  assert.equal(f.store.sessionState.historyError, '');
});

test('a tail refresh cannot cancel an older-page request or overwrite its cursor', () => {
  const f = fixture();
  f.frame(history([user(100, 'latest')], 100)); f.flush();
  f.store.loadOlderHistory();
  assert.equal(f.store.sessionState.historyPaging, true);

  // A concurrent tail refresh is not the response to beforeSeq=100.
  f.frame(history([user(120, 'newer tail')], 120));
  assert.equal(f.store.sessionState.historyPaging, true);
  assert.equal(f.store.sessionState.nextBeforeSeq, 100);

  f.frame(history([user(90, 'older')], 90));
  assert.equal(f.store.sessionState.historyPaging, false);
  assert.equal(f.store.sessionState.nextBeforeSeq, 90);
  assert.deepEqual(Array.from(f.store.sessionState.rows, row => row.text), ['older', 'latest', 'newer tail']);
});

test('empty public history pages retry at a larger bounded frame size instead of spinning', () => {
  const f = fixture();
  f.store.client.relayMeta = { nodeId: 'public-node' };
  f.frame(history([user(100, 'latest')], 100));
  f.store.loadOlderHistory();
  assert.equal(f.requests.length, 1);

  for (const expected of [512 * 1024, 1024 * 1024, 2 * 1024 * 1024]) {
    f.frame(history([], 100, true));
    assert.equal(f.store.sessionState.historyPaging, true);
    assert.equal(f.requests.at(-1)[3], expected);
  }
  f.frame(history([], 100, true));
  assert.equal(f.store.sessionState.historyPaging, false);
  assert.ok(f.store.sessionState.historyError, 'exhausted pages expose a retry state');
});

test('history pages coalesce disk writes but memory and visible records update immediately', () => {
  const f = fixture();
  f.frame(history([user(30, 'latest')], 30)); f.flush();
  f.frame(history([user(20, 'middle')], 20)); f.flush();
  f.frame(history([user(10, 'oldest')], 0, false));
  assert.equal(f.store.sessionState.rows.length, 3);
  assert.equal(f.storage.has('dsh_session_cache.s'), false);
  f.flush(1000);
  const persisted = JSON.parse(f.storage.get('dsh_session_cache.s'));
  assert.equal(persisted.cacheVersion, 2);
  assert.equal(persisted.value.events.length, 3);
  assert.equal(persisted.value.rows, undefined, 'persisted event data avoids duplicate row text');
});

test('invalid cursors report an error instead of endlessly pretending to load', () => {
  const f = fixture(); f.frame(history([user(30, 'latest')], null)); f.store.loadOlderHistory();
  assert.equal(f.requests.length, 0); assert.ok(f.store.sessionState.historyError);
  assert.equal(f.store.sessionState.historyPaging, false);
});

test('large cached sessions restore thousands of local messages before requesting uncached history', () => {
  const f = fixture();
  f.frame(history(Array.from({ length: 3000 }, (_, i) => user(i + 1, 'Question ' + i)), 0, false));
  f.store.openSession('other', 'Other'); f.store.openSession('s', 'Original');
  assert.equal(f.store.sessionState.rows.length, 2000);
  assert.equal(f.store.sessionState.rows[0].seq, 1001);
  assert.equal(f.store.sessionState.rows.at(-1).seq, 3000);
  assert.equal(f.store.sessionState.hasMoreHistory, true);
  assert.equal(f.store.sessionState.trajectory.length, 0);
  f.store.loadOlderHistory(); assert.deepEqual(f.requests.at(-1), ['s', 1001, 1]);
});
