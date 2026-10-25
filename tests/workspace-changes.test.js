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

function changesFixture() {
  const row = { kind: 'changes', key: 'c', sessionId: 's', turn: 1, changeSeq: 12, files: [{ path: '/old/expired.txt' }] };
  const store = { state: { connection: 'connected', gatewayCapabilities: ['workspace-changes-v1'] },
    sessionState: { sessionId: 's', rows: [row] }, client: { connectGeneration: 1 } };
  const filename = path.resolve(__dirname, '../miniprogram/pages/session/changes-actions.js'), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, Promise, Map, require(name) {
    if (name.endsWith('/store')) return store; return require(path.resolve(path.dirname(filename), name));
  } });
  const page = { ...module.exports, data: { tab: 'conversation', rows: [], fileExpanded: {} },
    setData(patch) { Object.assign(this.data, patch); },
    syncFromStore() { this.data.rows = store.sessionState.rows.map(item => item.kind === 'changes' ? this.decorateChanges(item) : item).filter(Boolean); } };
  const ready = (value = summary) => { page.changesContext().cache.set(12, { state: 'ready', value }); page.syncFromStore(); };
  return { page, row, store, ready };
}

test('DSH-style cards hide missing, expired, loading, invalid and unsupported snapshots without tool-path fallback', () => {
  const { page, row, store, ready } = changesFixture();
  assert.equal(page.decorateChanges(row), null);
  for (const state of ['loading', 'missing', 'error']) {
    page.changesContext().cache.set(12, { state });
    assert.equal(page.decorateChanges(row), null, state);
  }
  for (const value of [null, { ...summary, turn: 2 }, { ...summary, files: [] }]) {
    ready(value); assert.equal(page.decorateChanges(row), null);
  }
  ready();
  assert.equal(page.data.rows[0].title, '已编辑 2 个文件');
  assert.equal(page.data.rows[0].files[0].name, 'a.wxss');
  assert.equal(page.data.rows[0].files[1].name, 'b.wxml');
  assert.ok(page.data.rows[0].files.every(file => file.path !== '/old/expired.txt'));
  store.state.gatewayCapabilities = []; assert.equal(page.decorateChanges(row), null);
});

test('single edited file uses its real basename, type icon and binary status instead of invented counts', () => {
  const { page, ready } = changesFixture();
  ready({ ...summary, total: 1, files: [{ path: '/work/很长的目录/最终报告.pdf', display: '很长的目录/最终报告.pdf', added: 0, deleted: 0, binary: true }] });
  const card = page.data.rows[0];
  assert.equal(card.title, '已编辑 最终报告.pdf'); assert.equal(card.singleFile, true);
  assert.match(card.files[0].icon, /deliverable-pdf/);
  assert.equal(card.files[0].hasCounts, false); assert.match(card.statusNote, /二进制/);
  ready({ ...summary, total: 3, files: [summary.files[0]] });
  assert.equal(page.data.rows[0].singleFile, false); assert.equal(page.data.rows[0].title, '已编辑 3 个文件');
});

test('expired diff removes only the edited snapshot card while preserving explicit delivery cards', async () => {
  const { page, store, ready } = changesFixture();
  const delivered = { kind: 'files', key: 'delivered', files: [{ path: 'report.pdf' }] };
  store.sessionState.rows.push(delivered); ready();
  store.client.requestChangesDiff = async (sessionId, seq, index) => ({ sessionId, seq, index, value: null });
  await page.openChangedFile({ currentTarget: { dataset: { row: 'c', index: 0 } } });
  assert.equal(page.data.rows.length, 1); assert.equal(page.data.rows[0], delivered);
  assert.equal(page.changesContext().cache.get(12).state, 'missing');
  assert.match(page.data.changesDiff.note, /已失效/);
});

test('stale or mismatched diff replies never expire another session snapshot', async () => {
  for (const mode of ['session', 'reconnect', 'coordinates']) {
    const { page, store, ready } = changesFixture(); ready();
    store.client.requestChangesDiff = async (sessionId, seq, index) => {
      if (mode === 'session') store.sessionState.sessionId = 'another';
      if (mode === 'reconnect') store.client.connectGeneration++;
      return { sessionId, seq: mode === 'coordinates' ? seq + 1 : seq, index, value: null };
    };
    const cache = page.changesContext().cache;
    await page.openChangedFile({ currentTarget: { dataset: { row: 'c', index: 0 } } });
    assert.equal(cache.get(12).state, 'ready', mode);
  }
});

test('edited card rows show actual names and native page projection excludes hidden cards', () => {
  const xml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.js'), 'utf8');
  assert.ok(xml.includes('class="changed-file-name">{{file.name}}</text>'));
  assert.ok(xml.includes('class="changed-file-icon"'));
  assert.ok(!xml.includes('item.summaryNote'));
  // 投影结果统一走 emit() 登记进行缓存（大会话复用），不再直接 push 到 semanticRows。
  assert.ok(js.includes('if (changes) emit(changes)'), 'changed-file rows are projected through the row cache');
});

const compiler=require('./helpers/wechat-wcc.cjs');
test('native file cards and forwarding controls render correctly in light and dark themes', { skip: !compiler }, t => {
  const os = require('node:os'), { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-cards-')), output = path.join(dir, 'session.js');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: path.resolve(__dirname, '../miniprogram') });
  const context = vm.createContext({ window: {}, console }); vm.runInContext(fs.readFileSync(output, 'utf8'), context);
  const render = context.$gwx('pages/session/session.wxml');
  const { page, ready } = changesFixture(); ready();
  for (const theme of ['light', 'dark']) {
    const data = { ...require('../miniprogram/utils/ui-preferences').snapshot(), ...page.data, tab: 'conversation', theme,
      themeClass: 'theme-' + theme, filePreview: { key: 'preview', name: '完整报告.html', text: '<html>安全源码</html>' } };
    let tree = JSON.stringify(render(data, {}, {}));
    for (const text of ['a.wxss', 'b.wxml', '已编辑 2 个文件', '转发到微信', 'shareSelectedFile', 'changed-file-icon']) assert.ok(tree.includes(text), text);
    assert.ok(!tree.includes('expired.txt')); assert.ok(!tree.includes('该轮变更快照已失效'));
    tree = JSON.stringify(render({ ...data, fileBusyKey: 'preview', fileProgress: 42 }, {}, {}));
    assert.ok(tree.includes('正在下载文件 42%'));
    tree = JSON.stringify(render({ ...data, fileSharingKey: 'preview' }, {}, {}));
    assert.ok(tree.includes('正在打开微信转发…'));
  }
});

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
test('live change-sequence advancement cannot poison pending or newer summary cache entries', async () => {
  const {page,row,store}=changesFixture();const pending=[];
  store.client.requestChangesSummary=(sessionId,seq)=>new Promise(resolve=>pending.push({sessionId,seq,resolve}));
  page.loadChangesSummaries();await new Promise(setImmediate);
  row.changeSeq=13;page.loadChangesSummaries();await new Promise(setImmediate);
  assert.deepEqual(pending.map(p=>p.seq),[12,13]);
  pending[0].resolve({sessionId:'s',seq:12,value:summary});await new Promise(setImmediate);
  assert.equal(page.changesContext().cache.get(12).state,'ready');
  assert.equal(page.changesContext().cache.get(13).state,'loading');
  pending[1].resolve({sessionId:'s',seq:13,value:{...summary,added:21}});await new Promise(setImmediate);
  assert.equal(page.changesContext().cache.get(13).state,'ready');assert.equal(page.data.rows[0].added,21);
});
