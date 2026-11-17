import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = file => readFileSync(new URL('../src/main/ets/' + file, import.meta.url), 'utf8').replace(/^import[\s\S]*?;$/gm, '').replace(/export /g, '');
const context = { Map, Set, Object, Array, JSON, Number, Error, asRec: v => v && typeof v === 'object' ? v : undefined, str: (v, k) => typeof v?.[k] === 'string' ? v[k] : undefined };
for (const file of ['facade/SharedMviEvents.ets', 'domain/ApprovalReducer.ets', 'domain/QuestionReducer.ets', 'domain/SessionListReducer.ets', 'domain/SessionControlReducer.ets']) {
  runInNewContext(stripTypeScriptTypes(load(file)) + ';globalThis.api = { ...(globalThis.api || {}), ' + ({
    'facade/SharedMviEvents.ets': 'SharedMviEventEmitter, SharedMviEventValidator, SharedMviEventConsumer', 'domain/ApprovalReducer.ets': 'ApprovalReducer',
    'domain/QuestionReducer.ets': 'QuestionReducer', 'domain/SessionListReducer.ets': 'SessionListReducer',
    'domain/SessionControlReducer.ets': 'SessionControlReducer'
  })[file] + ' };', context);
}
const { SharedMviEventEmitter: E, SharedMviEventValidator: V, SharedMviEventConsumer: Consumer, ApprovalReducer: A, QuestionReducer: Q, SessionListReducer: L, SessionControlReducer: C } = context.api;
test('MVI snapshots and reentrant transactions are ordered and isolate observers', () => {
  const emitter = new E('questions'); const seen = [];
  emitter.subscribe(e => { seen.push('a' + e.sequence); if (e.kind === 'transition' && e.sequence === 1) emitter.emitTransition('two', '{}'); }, '{}');
  const sub = emitter.subscribe(e => { seen.push('b' + e.sequence); if (e.sequence === 1) throw Error('observer'); }, '{}');
  const event = emitter.emitTransition('one', '{}', '[{"type":"send"}]');
  assert.deepEqual(seen, ['a0', 'b0', 'a1', 'b1', 'a2', 'b2']);
  assert.equal(V.validate(event, 1, 'questions'), true); assert.equal(V.validate(event, 2, 'questions'), false);
  assert.equal(V.validate({ ...event, effectsJson: '{}' }, 1, 'questions'), false);
  assert.throws(() => emitter.emitTransition(' ', '{}')); sub.cancel(); sub.cancel(); emitter.emitError('three', 'bad', null);
  assert.equal(seen.at(-1), 'a3');
});
test('MVI applies validated state before effects and rejects malformed or out-of-order transactions', () => {
  const emitter = new E('d'); let snapshot; emitter.subscribe(e => { snapshot = e; }, '{"value":0}');
  const consumer = new Consumer('d'); const log = [];
  const apply = event => consumer.apply(event, payload => payload === null || JSON.parse(payload).value !== undefined,
    effects => Array.isArray(JSON.parse(effects)), payload => log.push('state:' + payload), effects => log.push('effects:' + effects));
  assert.equal(apply(snapshot), true); log.length = 0;
  const event = emitter.emitTransition('x', '{"value":1}', '[{"type":"send"}]');
  assert.equal(apply({ ...event, effectsJson: '{}' }), false); assert.deepEqual(log, []);
  assert.equal(apply({ ...event, sequence: 2 }), false); assert.deepEqual(log, []);
  assert.equal(apply(event), true); assert.deepEqual(log, ['state:{"value":1}', 'effects:[{"type":"send"}]']);
  assert.equal(apply(event), false); assert.equal(log.length, 2);
});
test('approval retains accepted request until resolved and scopes failure', () => {
  const req = { rpcId: 'r', sessionId: 's', approvalId: 'a', toolName: 'read', replay: false };
  let s = A.reduce(A.initial(), { kind: 'RequestReceived', request: req });
  s = A.reduce(s, { kind: 'Submit', request: req, outcome: 'allowed-once', isConnected: false });
  assert.equal(s.requestStatuses.get('r').failure.code, 'DISCONNECTED');
  s = A.reduce(s, { kind: 'ResponseReceived', rpcId: 'r', outcome: 'allowed-once', accepted: true });
  assert.equal(s.pendingRequests.length, 1); assert.equal(s.requestStatuses.get('r').kind, 'Accepted');
  s = A.reduce(s, { kind: 'Resolved', rpcId: 'r' }); assert.equal(s.pendingRequests.length, 0);
});
test('questions reject unordered, duplicate and mixed single selections', () => {
  const req = { rpcId: 'q', sessionId: 's', replay: false, questions: [{ id: 'one', question: 'Choose', options: [{ label: 'a' }, { label: 'b' }] }] };
  assert.equal(Q.validate(req, [{ id: 'bad', selected: [] }]).code, 'INVALID_ANSWER_ORDER');
  assert.equal(Q.validate(req, [{ id: 'one', selected: ['a', 'a'] }]).code, 'INVALID_OR_DUPLICATE_OPTIONS');
  assert.equal(Q.validate(req, [{ id: 'one', selected: ['a'], custom: 'x' }]).code, 'SINGLE_SELECTION_REQUIRED');
  assert.equal(Q.validate(req, [{ id: 'one', selected: ['a'], custom: ' ' }]), null);
});
test('session list respects title sequence and latest history boundary', () => {
  let s = L.initial(); const ev = (seq, type, text) => ({ sessionId: 's', seq, time: 1000, event: { type, text } });
  s = L.reduce(s, { kind: 'EventReceived', event: ev(4, 'session/title', 'new'), insertedAtEpochSeconds: 1 });
  s = L.reduce(s, { kind: 'EventReceived', event: ev(3, 'session/title', 'old'), insertedAtEpochSeconds: 1 });
  assert.equal(s.sessions[0].title, 'new');
  s = L.reduce(s, { kind: 'EventReceived', event: ev(5, 'turn/start'), insertedAtEpochSeconds: 1 });
  s = L.reduce(s, { kind: 'HistoryReceived', sessionId: 's', events: [ev(6, 'turn/end'), ev(7, 'turn/start')] });
  assert.equal(s.sessions[0].isRunning, true);
  s = L.reduce(s, { kind: 'HistoryReceived', sessionId: 's', events: [ev(8, 'turn/end')] }); assert.equal(s.sessions[0].isRunning, false);
});
test('session control retains omitted fields and clears request target state', () => {
  let s = C.initial(); s = C.reduce(s, { kind: 'PermissionsReceived', sessionId: 's', permissions: { options: [{ value: 'x', name: 'X' }] } });
  s = C.reduce(s, { kind: 'PermissionsReceived', sessionId: 's', permissions: { currentValue: 'x' } });
  assert.equal(s.sessionPermissions.get('s').options[0].value, 'x');
  s = C.reduce(s, { kind: 'ModelsRequestTargeted', sessionId: 's' });
  s = C.reduce(s, { kind: 'RequestStarted', requestKind: 'models', token: 't' });
  s = C.reduce(s, { kind: 'RequestTimedOut', requestKind: 'models' });
  assert.equal(s.pendingModelsSessionId, null); assert.equal(s.requestTokens.has('models'), false);
});
