import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');
const code = stripTypeScriptTypes(load('../src/main/ets/state/HistoryPageMatcher.ets') + '\n' +
  load('../src/main/ets/state/SessionStore.ets')) + ';globalThis.store = SessionStore.get();';
function setup() {
  const state = {}, requests = [], opened = [];
  const projector = { consume() {}, reset() {} };
  const client = { onFrame() {}, isConnected: () => true, openSession: id => opened.push(id),
    // 会话打开时会顺带拉会话级模型目录与权限选项（这两个请求与分页无关，stub 掉即可）
    requestModelsCatalog: () => true, requestPermissionOptions: () => true,
    requestOlderHistory: (...args) => { requests.push(args); return true; } };
  // 对话投影依赖：本用例只验证分页与提示状态，投影本身在 history-projection.test.mjs 覆盖。
  class ConversationProjectorStub { get items() { return []; } fold() { return []; } }
  const context = { AppStorage: { setOrCreate: (key, value) => { state[key] = value; } },
    ConversationProjector: ConversationProjectorStub,
    EventProjector: { get: () => projector }, Logger: { info() {}, warn() {} },
    normalizeRawSessionEvent: raw => ({ seq: raw.seq, event: { type: raw.type, text: raw.data.text } }),
    Number, Map, JSON, Date, Object, Array, Error };
  runInNewContext(code, context); context.store.attach(client); context.store.open('one');
  return { store: context.store, state, requests, opened };
}
const ev = (seq, text = String(seq)) => ({ seq, type: 'user/message', time: seq, data: { text } });
test('tail refresh does not consume older-page ownership', () => {
  const s = setup();
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(100)], hasMore: true, historyFormatVersion: 3 });
  assert.equal(s.store.loadOlder(), true);
  assert.deepEqual(s.requests[0], ['one', 100, 3]);
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(110)], hasMore: false });
  assert.equal(s.state.historyHasMore, true);
  assert.equal(s.store.loadOlder(), false);
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(50)], hasMore: true, beforeSeq: 100, nextBeforeSeq: 50 });
  assert.equal(s.state.historyOldestSeq, 50);
  assert.equal(s.store.loadOlder(), true);
  assert.deepEqual(s.requests[1], ['one', 50, 3]);
});
test('pending prompts survive navigation and resolve by session and rpc', () => {
  const s = setup();
  s.store.consume({ kind: 'question-requested', sessionId: 'one', rpcId: 'q1', questions: [] });
  s.store.open('two');
  s.store.consume({ kind: 'approval-requested', sessionId: 'two', rpcId: 'a2', approvalId: 'approval', toolName: 'shell' });
  assert.equal(s.store.pendingQuestion('one').rpcId, 'q1');
  assert.equal(s.store.pendingApproval('two').rpcId, 'a2');
  s.store.consume({ kind: 'question-resolved', sessionId: 'two', rpcId: 'q1' });
  assert.equal(s.store.pendingQuestion('one').rpcId, 'q1');
  s.store.consume({ kind: 'question-resolved', sessionId: 'one', rpcId: 'q1' });
  assert.equal(s.store.pendingQuestion('one'), null);
  assert.equal(s.store.pendingApproval('two').rpcId, 'a2');
  s.store.clearPendingPrompts();
  assert.equal(s.store.pendingApproval('two'), null);
});
test('same gateway reconnect restores current session and releases pagination lock', () => {
  const s = setup(); s.store.prepareGateway('direct:one');
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(100)], hasMore: true });
  assert.equal(s.store.loadOlder(), true);
  s.store.prepareGateway('direct:one'); s.store.resumeAfterConnect();
  assert.deepEqual(s.opened, ['one', 'one']);
  assert.equal(s.store.loadOlder(), true);
});
test('switching gateways clears old session before reconnect', () => {
  const s = setup(); s.store.prepareGateway('direct:one');
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(100)], hasMore: true });
  s.store.prepareGateway('direct:two'); s.store.resumeAfterConnect();
  assert.equal(s.store.currentSessionId(), ''); assert.equal(s.state.sessionRows.length, 0);
  assert.deepEqual(s.opened, ['one']);
});
test('concurrent prompts remain ordered and ambiguous resolutions are ignored', () => {
  const s = setup();
  s.store.consume({ kind: 'question-requested', sessionId: 'one', rpcId: 'q1', questions: [] });
  s.store.consume({ kind: 'question-requested', sessionId: 'one', rpcId: 'q2', questions: [] });
  s.store.consume({ kind: 'question-requested', sessionId: 'two', rpcId: 'q1', questions: [] });
  assert.equal(s.store.pendingQuestion('one').rpcId, 'q1');
  s.store.consume({ kind: 'question-resolved', rpcId: 'q1' });
  assert.equal(s.store.pendingQuestion('one').rpcId, 'q1');
  assert.equal(s.store.pendingQuestion('two').rpcId, 'q1');
  s.store.consume({ kind: 'question-resolved', sessionId: 'one', rpcId: 'q1' });
  assert.equal(s.store.pendingQuestion('one').rpcId, 'q2');
  s.store.consume({ kind: 'question-resolved', sessionId: 'one', rpcId: 'q2' });
  assert.equal(s.store.pendingQuestion('one'), null);
  assert.equal(s.store.pendingQuestion('two').rpcId, 'q1');
});
test('frames for previous session do not update current history', () => {
  const s = setup(); s.store.open('two');
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(5)], hasMore: true });
  assert.equal(s.state.sessionRows.length, 0);
  assert.equal(s.state.historyHasMore, false);
});
test('reset terminates pending page and replaces stale events', () => {
  const s = setup();
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(100)], hasMore: true });
  assert.equal(s.store.loadOlder(), true);
  s.store.consume({ kind: 'history', sessionId: 'one', events: [ev(1, 'reset')], resetRequired: true, cursor: 100, hasMore: false });
  assert.equal(s.state.historyHasMore, false);
  assert.equal(s.state.sessionRows.length, 1);
  assert.equal(s.state.sessionRows[0].text, 'reset');
});
