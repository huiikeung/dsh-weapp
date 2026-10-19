const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildRows, newAggregator, applyEvent, normalizeRawEvent } = require('../miniprogram/utils/protocol');
const { buildEntries } = require('../miniprogram/utils/conversation-workflow');
const { mutationPath, validSummary, validDiff } = require('../miniprogram/utils/workspace-changes');
const { transform } = require('../scripts/install-workspace-changes-bridge.cjs');
const event = (seq, type, data, surfaceOp) => ({ seq, type, data, ...(surfaceOp ? { surfaceOp } : {}) });
const summary = { turn: 1, total: 2, added: 13, deleted: 2, files: [
  { path: '/work/a.wxss', display: 'a.wxss', added: 13, deleted: 2 },
  { path: '/work/b.wxml', display: 'b.wxml', added: 0, deleted: 0 }
] };
const diff = { kind: 'text', path: '/work/a.wxss', display: 'a.wxss', before: true, after: true, coarse: false,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }] };

test('only supported successful mutations create edited file cards, stable on history and replay', () => {
  const events = [event(1, 'turn/start', { turn: 1 }),
    event(2, 'tool/call', { turn: 1, callId: 'a', name: 'write', arguments: JSON.stringify({ file_path: '/work/a.wxss', content: 'a' }) }),
    event(3, 'tool/result', { turn: 1, callId: 'a', preview: 'ok' }, 'append'),
    event(4, 'tool/call', { turn: 1, callId: 'b', name: 'edit', arguments: { file_path: '/work/a.wxss', old_string: 'a', new_string: 'b' } }),
    event(5, 'tool/result', { turn: 1, callId: 'b', preview: 'ok' }, 'append'),
    event(6, 'tool/call', { turn: 1, callId: 'bad', name: 'write', arguments: { file_path: 'failed', content: 'a' } }),
    event(7, 'tool/result', { turn: 1, callId: 'bad', isError: true }),
    event(8, 'tool/call', { turn: 1, callId: 'copy', name: 'write', arguments: { file_path: 'replacement', content: 'a' } }),
    event(9, 'tool/result', { turn: 1, callId: 'copy' }, 'replace'),
    event(10, 'assistant/message', { turn: 1, text: 'Done. /fake/prose.file' }),
    event(11, 'workspace/changes', { turn: 1 }), event(12, 'workspace/changes', { turn: 1 })];
  const rows = buildRows(events, 'session'), changes = rows.filter(row => row.kind === 'changes');
  assert.equal(changes.length, 1); assert.equal(changes[0].changeSeq, 12);
  assert.deepEqual(changes[0].files.map(file => file.path), ['/work/a.wxss']);
  const agg = newAggregator(); events.forEach(raw => applyEvent(agg, normalizeRawEvent(raw, 'session')));
  applyEvent(agg, normalizeRawEvent(events[10], 'session'));
  assert.deepEqual(agg.rows, rows); assert.equal(buildEntries(rows).at(-1).kind, 'changes');
  assert.equal(buildRows([event(1, 'workspace/changes', { turn: -1 })], 's').length, 0);
  const next = buildRows(events.concat(event(13, 'workspace/changes', { turn: 2 })), 'session');
  assert.equal(next.filter(row => row.kind === 'changes').length, 2);
});
test('mutation argument and summary validators reject guesses, malformed counts and diffs', () => {
  assert.equal(mutationPath('read', { file_path: 'a' }), null);
  assert.equal(mutationPath('bash', { command: 'touch a' }), null);
  assert.equal(mutationPath('edit', { file_path: 'a', old_string: '', new_string: 'x' }), null);
  assert.equal(mutationPath('write', '{'), null);
  assert.equal(mutationPath('str_replace_editor', { path: 'a', command: 'view' }), null);
  assert.equal(mutationPath('str_replace_editor', { path: 'a', command: 'insert', insert_line: 0, new_str: 'x' }), 'a');
  assert.equal(validSummary(summary, 1), true); assert.equal(validSummary(summary, 2), false);
  assert.equal(validSummary({ ...summary, added: -1 }), false);
  assert.equal(validDiff(diff), true); assert.equal(validDiff({ ...diff, hunks: [{ lines: ['x'] }] }), false);
});
test('gateway summary/diff bridge uses exact coordinates, redacts cwd and handles missing snapshots', async () => {
  const { handleWorkspaceChanges } = await import('../scripts/lib/workspace-changes-bridge.mjs');
  const calls = [], api = { workspaceChanges: { summary(id, seq) { calls.push([id, seq]); return { ...summary, cwd: '/private' }; },
    async diff(id, seq, index, signal) { assert.ok(signal); calls.push([id, seq, index]); return diff; } } };
  const query = { type: 'workspace-changes-summary', requestId: 'r', sessionId: 's', seq: 12 };
  const answer = await handleWorkspaceChanges(api, query);
  assert.deepEqual(answer.value, summary); assert.equal(answer.value.cwd, undefined);
  const details = await handleWorkspaceChanges(api, { ...query, type: 'workspace-changes-diff', index: 0 });
  assert.deepEqual(details.value, diff); assert.equal(details.index, 0);
  assert.deepEqual(calls, [['s', 12], ['s', 12], ['s', 12, 0]]);
  assert.equal((await handleWorkspaceChanges(api, { ...query, seq: -1 })).code, 'bad-request');
  assert.equal((await handleWorkspaceChanges({}, query)).code, 'workspace-changes-unavailable');
  assert.equal((await handleWorkspaceChanges({ workspaceChanges: { summary() {} } }, query)).value, null);
});
test('gateway patch is idempotent and applies the paired-device guard to both new requests', () => {
  const source = [
    "import { handlePluginQuery, PLUGIN_REQUEST_TYPES } from './plugin-management.mjs'",
    '  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)',
    '    const api = createDshHostAdapter(ctx.typertGateway)',
    '                       PLUGIN_REQUEST_TYPES.has(msg.type)) {',
    '              if (PLUGIN_REQUEST_TYPES.has(msg.type) && !ws.deviceId) {',
    "              ...(options.fileDownloadsEnabled ? ['file-downloads'] : []),"
  ].join('\n');
  const patched = transform(source); assert.equal(transform(patched), patched);
  assert.ok(patched.includes('(WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId'));
  assert.ok(patched.includes("ctx.inject(['workspaceChanges']"));
  assert.throws(() => transform('incompatible version'));
});
test('summary responses are cached and cannot write into a different session', async () => {
  let resolves = [], requests = 0, updates = 0;
  const store = { state: { connection: 'connected', gatewayCapabilities: ['workspace-changes-v1'] },
    sessionState: { sessionId: 's', rows: [{ kind: 'changes', key: 'c', sessionId: 's', turn: 1, changeSeq: 12, files: [] }] },
    client: { connectGeneration: 1, requestChangesSummary() { requests++; return new Promise(resolve => resolves.push(resolve)); } } };
  const filename = path.resolve(__dirname, '../miniprogram/pages/session/changes-actions.js'), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, Promise, Map, require(name) {
    if (name.endsWith('/store')) return store; return require(path.resolve(path.dirname(filename), name));
  } });
  const page = { ...module.exports, data: { tab: 'conversation' }, syncFromStore() { updates++; } };
  page.loadChangesSummaries(); page.loadChangesSummaries(); await new Promise(setImmediate);
  assert.equal(requests, 1);
  store.sessionState.sessionId = 'other';
  resolves.shift()({ sessionId: 's', seq: 12, value: summary }); await new Promise(setImmediate);
  assert.equal(updates, 0);
  store.sessionState.sessionId = 's'; store.client.connectGeneration++;
  page.loadChangesSummaries(); await new Promise(setImmediate);
  resolves.shift()({ sessionId: 's', seq: 12, value: summary }); await new Promise(setImmediate);
  assert.equal(updates, 1);
  const row = page.decorateChanges(store.sessionState.rows[0]);
  assert.equal(row.added, 13); assert.equal(row.files.length, 2); assert.equal(row.files[0].previewKind, 'text');
  page.loadChangesSummaries(); assert.equal(requests, 2);
});
