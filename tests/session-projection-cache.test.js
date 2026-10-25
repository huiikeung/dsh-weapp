'use strict';
// 大会话（上千行）里每个流式帧都会重新投影全部行：工具标签、图片堆叠、Markdown 块。
// 这里守两件事：内容没变的行复用上一次投影；内容变了必须重新投影。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition; let timerId = 0;
  const timers = new Map();
  const store = { state: { sessions: [], archivedSessionIds: [] },
    sessionState: { sessionId: 's1', running: true, rows: [], cwd: '/repo' },
    openSession() {}, loadOlderHistory() {}, client: {} };
  const rectQuery = () => {
    const query = { in() { return query; }, select() { return query; }, selectAll() { return query; },
      boundingClientRect() { return query; }, scrollOffset() { return query; }, exec(fn) { if (fn) fn([{ height: 120, top: 480, bottom: 600, width: 390, scrollTop: 0 }]); } };
    return query;
  };
  const wx = { hideKeyboard() {}, nextTick(fn) { fn(); }, showModal() {}, navigateTo() {}, navigateBack() {},
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 44 }),
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 3, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 60, height: 32, left: 300 }),
    createSelectorQuery: rectQuery };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx, console,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    require: name => name.endsWith('/store') ? store : name.endsWith('/haptics')
      ? { vibrate() {}, tick() {} }
      : require(path.resolve(path.dirname(file), name)) });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = this.data;
      parts.slice(0, -1).forEach((part, i) => { if (target[part] == null) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {}; target = target[part]; });
      target[parts.at(-1)] = value;
    }
  }, startScrollPolling() {}, stopScrollPolling() {}, refreshBottomAnchor() {} };
  return { page, store, timers };
}

const snapshot = (rows) => ({ app: { sessions: [], archivedSessionIds: [] }, session: { sessionId: 's1', running: true, rows, cwd: '/repo' } });
const assistantRow = (text, toolStatus) => ({
  kind: 'assistant', key: 'a1', text, streaming: true, turn: 1, phase: 'assistant/message',
  tools: [{ key: 't1', name: 'bash', argumentsText: 'ls', status: toolStatus, phase: 'preparing' }]
});

test('unchanged rows reuse the previous projection, changed rows re-project', () => {
  const { page } = fixture();
  page.syncFromStore(snapshot([{ kind: 'user', key: 'u1', text: '你好', turn: 1 }, assistantRow('hello', 'running')]));
  const first = page._projectedRows.get('a1');
  assert.ok(first && first.row, 'the assistant row was projected and cached');

  // 同一个快照再来一次（流式帧里常见：只有别的行变了）：必须原样复用同一份投影。
  page.syncFromStore(snapshot([{ kind: 'user', key: 'u1', text: '你好', turn: 1 }, assistantRow('hello', 'running')]));
  const second = page._projectedRows.get('a1');
  assert.equal(second.row, first.row, 'unchanged row reuses the cached projection');
  assert.equal(second.row.tools, first.row.tools, 'tool decorations are not rebuilt');

  // 工具状态变了 → 签名不同 → 必须重新投影。
  page.syncFromStore(snapshot([{ kind: 'user', key: 'u1', text: '你好', turn: 1 }, assistantRow('hello', 'done')]));
  const third = page._projectedRows.get('a1');
  assert.notEqual(third.row, first.row, 'a changed tool status re-projects the row');

  // 文本增长（流式追加）同样要重新投影。
  const beforeText = third.row;
  page.syncFromStore(snapshot([{ kind: 'user', key: 'u1', text: '你好', turn: 1 }, assistantRow('hello world', 'done')]));
  assert.notEqual(page._projectedRows.get('a1').row, beforeText, 'streaming text growth re-projects');
});

test('in-place protocol mutations are detected even when tool text keeps the same length', () => {
  const { page } = fixture();
  const source = assistantRow('hello', 'running');
  const rows = [{ kind: 'user', key: 'u1', text: '你好', turn: 1 }, source];
  page.syncFromStore(snapshot(rows));
  const first = page._projectedRows.get('a1').row;

  source.tools[0].argumentsText = 'ps';
  page.syncFromStore(snapshot(rows));
  const second = page._projectedRows.get('a1').row;
  assert.notEqual(second, first, 'same-length argument edits invalidate the decorated row');
  assert.equal(second.tools[0].argumentsText, 'ps');

  source.tools[0].resultText = 'ok';
  page.syncFromStore(snapshot(rows));
  assert.equal(page._projectedRows.get('a1').row.tools[0].resultText, 'ok', 'tool result edits are also detected');
});

test('switching sessions drops the projection cache', () => {
  const { page } = fixture();
  page.syncFromStore(snapshot([{ kind: 'user', key: 'u1', text: '你好', turn: 1 }]));
  assert.ok(page._projectedRows.size > 0);
  page.syncFromStore({ app: { sessions: [], archivedSessionIds: [] },
    session: { sessionId: 's2', running: false, rows: [{ kind: 'user', key: 'u2', text: '换个会话', turn: 1 }], cwd: '/repo' } });
  assert.equal(typeof page._projectedRows.has, 'function', 'cache is a Map (created inside the page realm)');
  assert.ok(!page._projectedRows.has('u1'), '上一会话的行不会跨会话复用');
  assert.ok(page._projectedRows.has('u2'), '新会话重新投影');
});

const { buildEntries } = require('../miniprogram/utils/conversation-workflow');

test('cached entry grouping matches a full rebuild, including while the tail streams', () => {
  const { page } = fixture();
  const semantic = [];
  for (let turn = 1; turn <= 6; turn += 1) {
    semantic.push({ kind: 'user', key: 'u' + turn, text: '问题 ' + turn, turn });
    semantic.push({ kind: 'reasoning', key: 'r' + turn, text: '思考 ' + turn, turn });
    semantic.push({ kind: 'tool', key: 't' + turn, name: 'bash', argumentsText: 'ls', status: 'done', phase: 'done', turn });
    semantic.push({ kind: 'assistant', key: 'a' + turn, text: '回答 ' + turn, turn, streaming: false, tools: [] });
  }
  const opts = { running: true, completedEntryKey: 'a5', lastDurationMs: 5000 };
  const normalise = (value) => JSON.parse(JSON.stringify(value));

  assert.deepEqual(normalise(page.buildEntriesCached(semantic, opts)), normalise(buildEntries(semantic, opts)),
    'cold call equals the plain full build');

  for (let step = 1; step <= 3; step += 1) {
    const tail = semantic[semantic.length - 1];
    tail.text = '回答 6 追加 ' + step;
    tail.streaming = true;
    assert.deepEqual(normalise(page.buildEntriesCached(semantic, opts)), normalise(buildEntries(semantic, opts)),
      'streaming tail step ' + step + ' still equals the full build');
  }
});

test('the incremental grouping actually reuses the prefix work', () => {
  const { page } = fixture();
  const semantic = [];
  for (let turn = 1; turn <= 20; turn += 1) {
    semantic.push({ kind: 'user', key: 'u' + turn, text: 'q' + turn, turn });
    semantic.push({ kind: 'assistant', key: 'a' + turn, text: 'a' + turn, turn, tools: [] });
  }
  const opts = { running: true, completedEntryKey: '', lastDurationMs: 0 };
  const first = page.buildEntriesCached(semantic, opts);
  const cachedPrefix = page._entriesCache;
  assert.ok(cachedPrefix && Array.isArray(cachedPrefix.entries) && cachedPrefix.entries.length > 0);
  const prefixEntries = cachedPrefix.entries;
  const second = page.buildEntriesCached(semantic, opts);
  assert.equal(page._entriesCache.entries, prefixEntries, 'the prefix entry array is reused, not rebuilt');
  assert.equal(second[0], first[0], 'prefix entries keep object identity (so the diff layer can skip them)');
});

test('a replaced historical row invalidates cached prefix grouping', () => {
  const { page } = fixture();
  const semantic = [];
  for (let turn = 1; turn <= 6; turn += 1) {
    semantic.push({ kind: 'user', key: 'u' + turn, text: 'q' + turn, turn });
    semantic.push({ kind: 'assistant', key: 'a' + turn, text: 'a' + turn, turn, tools: [] });
  }
  const opts = { running: false, completedEntryKey: '', lastDurationMs: 0 };
  const first = page.buildEntriesCached(semantic, opts);
  const firstAnswer = first.find(row => row.key === 'a1');
  semantic[1] = Object.assign({}, semantic[1], { text: 'revised historical answer' });
  const second = page.buildEntriesCached(semantic, opts);
  const secondAnswer = second.find(row => row.key === 'a1');
  assert.notEqual(secondAnswer, firstAnswer, 'a changed projected prefix is rebuilt rather than served stale');
  assert.equal(secondAnswer.text, 'revised historical answer');
});

test('the reply footer only stays on the last card when the turn grows', () => {
  const { page } = fixture();
  const filesRow = (key, turn) => ({ kind: 'files', key, turn, files: [{ key: key + '-f', name: key + '.png', path: key + '.png' }] });
  const base = [
    { kind: 'user', key: 'u1', text: '问题', turn: 1 },
    { kind: 'assistant', key: 'a1', text: '回答正文', turn: 1 }
  ];
  const app = { sessions: [], archivedSessionIds: [] };
  const sync = (rows) => page.syncFromStore({ app, session: { sessionId: 's1', running: false, rows, cwd: '/repo' } });
  const entry = (key) => page.data.rows.find((row) => row.key === key);

  // 第一帧：本轮最后一张卡是文件卡，页脚（复制/用量/时间）沉到它下面。
  sync(base.concat([filesRow('f1', 1)]));
  assert.ok(entry('f1') && entry('f1').copyText, 'the file card carries the turn footer');
  assert.ok(!entry('a1').copyText, 'the assistant body does not keep a second copy button');

  // 新一轮又追加了一张卡片：页脚必须整体挪到最后一张卡，旧的不能再留在前一张卡上。
  sync(base.concat([filesRow('f1', 1), filesRow('f2', 2)]));
  assert.ok(!entry('f1').copyText, 'the earlier card no longer shows a stale footer');
  assert.ok(entry('f2') && entry('f2').copyText, 'the footer moved to the very last card');
  assert.ok(!entry('a1').copyText);
  const footerRows = page.data.rows.filter((row) => row.copyText).map((row) => row.key);
  assert.deepEqual(footerRows, ['f2'], 'exactly one footer per turn');
});

test('lazily formatted history keeps its blocks after the next sync', () => {
  const { page, timers } = fixture();
  const rows = [];
  for (let n = 1; n <= 40; n += 1) {
    rows.push({ kind: 'user', key: 'u' + n, text: '问题 ' + n, turn: n });
    rows.push({ kind: 'assistant', key: 'a' + n, text: '回答 ' + n + ' 的正文', turn: n, streaming: false });
  }
  const snap = (list) => ({ app: { sessions: [], archivedSessionIds: [] },
    session: { sessionId: 's1', running: false, rows: list, cwd: '/repo' } });

  page.syncFromStore(snap(rows));
  // 找一个"在窗口里但超出末尾 12 行"的助手行：它第一次投影时 blocks 为空，走懒格式化。
  const pendingKey = [...page._pendingHistoryFormat.keys()]
    .find(key => (page.data.rows || []).some(row => row.key === key && row.kind === 'assistant'));
  assert.ok(pendingKey, 'a windowed assistant row waits for lazy formatting');

  // 跑一遍真实的定时器（scheduleHistoryFormatting 会解析 Markdown 并把 blocks 写回）。
  page.scheduleHistoryFormatting();
  let guard = 0;
  while (timers.size && guard++ < 50) {
    const [id, job] = timers.entries().next().value;
    timers.delete(id);
    job.fn();
  }
  const formatted = page._conversationRows.find(row => row.key === pendingKey);
  assert.ok(formatted && (formatted.blocks || []).length, 'the row is now formatted');
  // 关键：写回必须同时落到投影缓存，否则下一次复用缓存投影时 blocks 又变空。
  const cachedProjection = page._projectedRows.get(pendingKey);
  assert.ok(cachedProjection && (cachedProjection.row.blocks || []).length,
    'the formatted blocks are written back into the projection cache');

  // 下一帧行内容完全没变：复用缓存投影时正文必须还在（否则真机上整轮回复会消失）。
  page.syncFromStore(snap(rows));
  const after = page._conversationRows.find(row => row.key === pendingKey);
  assert.ok(after && (after.blocks || []).length, 'the cached projection keeps the formatted blocks');
});

test('a formatted row survives eviction from the page window', () => {
  const { page } = fixture();
  const rows = [];
  for (let n = 1; n <= 30; n += 1) {
    rows.push({ kind: 'user', key: 'u' + n, text: '问题 ' + n, turn: n });
    rows.push({ kind: 'assistant', key: 'a' + n, text: '正文 ' + n, turn: n, streaming: false });
  }
  const snap = (list) => ({ app: { sessions: [], archivedSessionIds: [] },
    session: { sessionId: 's1', running: false, rows: list, cwd: '/repo' } });
  page.syncFromStore(snap(rows));
  // Markdown 缓存里有解析结果、但投影缓存还是空 blocks 时，复用路径要能自愈。
  page._markdownCache.parse('a2', '正文 2');
  page._pendingHistoryFormat.clear();
  page.syncFromStore(snap(rows));
  const cached = page._projectedRows.get('a2');
  assert.ok((cached.row.blocks || []).length > 0, 'blocks are rehydrated from the markdown cache on reuse');
});

test('the turn footer keeps its usage when the store has no turnUsage map entry', () => {
  const { page } = fixture();
  const rows = [
    { kind: 'user', key: 'u1', text: '问题', turn: 1 },
    { kind: 'assistant', key: 'a1', text: '回答正文', turn: 1, usageTokens: 176082 }
  ];
  // 历史缓存里 s.turnUsage 可能没有这一轮：页脚用量必须用行上的 usageTokens 兜底。
  page.syncFromStore({ app: { sessions: [], archivedSessionIds: [] },
    session: { sessionId: 's1', running: false, rows, cwd: '/repo', turnUsage: {} } });
  const entry = page.data.rows.find(row => row.key === 'a1');
  assert.ok(entry && entry.copyText, 'the assistant carries the turn footer');
  assert.match(entry.turnMetaText, /176/, 'usage is rendered from usageTokens: ' + entry.turnMetaText);
});

test('the turn footer usage survives a second sync with the same rows', () => {
  const { page } = fixture();
  const rows = [
    { kind: 'user', key: 'u1', text: '问题', turn: 1 },
    { kind: 'assistant', key: 'a1', text: '回答正文', turn: 1, usageTokens: 4200 },
    { kind: 'files', key: 'f1', turn: 1, files: [{ key: 'f1-file', name: 'a.png', path: 'a.png' }] }
  ];
  const snap = { app: { sessions: [], archivedSessionIds: [] },
    session: { sessionId: 's1', running: false, rows, cwd: '/repo', turnUsage: {} } };
  page.syncFromStore(snap);
  const card = () => page.data.rows.find(row => row.key === 'f1');
  assert.ok(card() && card().copyText, 'the footer sinks onto the last card');
  assert.match(card().turnMetaText, /4\.2K|4200/, 'the card shows the turn usage');
  // 再同步一次：页脚要先清空再重算，重算不能丢掉用量。
  page.syncFromStore(snap);
  assert.match(card().turnMetaText, /4\.2K|4200/, 'usage is still there after the reset + recompute');
});
