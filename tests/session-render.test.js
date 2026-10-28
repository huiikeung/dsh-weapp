const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { dataPatch, createMarkdownCache } = require('../miniprogram/pages/session/utils/session-render');
const clone = value => JSON.parse(JSON.stringify(value));
function apply(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let parent = data;
    parts.slice(0, -1).forEach((part, i) => {
      if (parent[part] == null) parent[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      parent = parent[part];
    });
    parent[parts.at(-1)] = clone(value);
  });
}
test('data bridge updates append, shrink, reorder and removed properties correctly', () => {
  const before = { rows: [{ key: 'a', text: 'old', blocks: [{ html: 'old' }] }], running: true };
  const next = { rows: [{ key: 'a', text: 'new', blocks: [{ html: 'new' }] }, { key: 'b', text: 'reply' }], running: false };
  const patch = dataPatch(before, next);
  assert.equal(patch.rows, undefined); assert.equal(patch['rows[0].text'], 'new');
  apply(before, patch); assert.deepEqual(before, next);
  for (const target of [
    { rows: [{ key: 'b', text: 'reply' }, { key: 'a', text: 'new' }], running: false },
    { rows: [], running: false }, { rows: [{ key: 'a' }], running: false },
    { rows: [{ key: 'a', blocks: [{ html: 'first' }, { html: 'second' }] }], running: false }
  ]) { apply(before, dataPatch(before, target)); assert.deepEqual(before, target); }
  assert.deepEqual(dataPatch(before, clone(before)), {});
});
test('markdown cache checks actual text and prunes removed messages', () => {
  let calls = 0;
  const cache = createMarkdownCache(text => { calls++; return [{ text }]; });
  const original = cache.parse('a', 'same');
  assert.equal(cache.parse('a', 'same'), original);
  assert.notEqual(cache.parse('a', 'changed'), original);
  cache.retain([]); cache.parse('a', 'changed'); assert.equal(calls, 3);
});
function fixture(source) {
  let definition, parses = 0, scrolls = 0, measurements = 0;
  let presetRequests = 0;
  const patches = [], ticks = [], timers = new Map(); let timerId = 0;
  const app = { globalData: { foregroundEpoch: 1 } };
  const store = { state: { connection: 'connected', sessions: [], agentPresets: null }, client: {
    connectGeneration: 1,
    requestSessionAgentPreset() { presetRequests += 1; return Promise.resolve({}); }
  }, sessionState: {
    sessionId: 'performance-test', rows: [], trajectory: [], running: true,
    runStartMs: Date.now() - 3000, historyState: 'loaded:300ev', stats: null
  }, beginNativeOverlay: () => {}, endNativeOverlay: () => {}, nativeOverlayActive: () => false };
  for (let i = 0; i < 150; i++) {
    store.sessionState.rows.push({ kind: 'user', key: 'u' + i, text: '问题' + i });
    store.sessionState.rows.push({ kind: 'assistant', key: 'a' + i, text: '## 标题 ' + i + '\n\n' + '历史回复内容。'.repeat(150), tools: [] });
  }
  store.sessionState.rows.push({ kind: 'assistant', key: 'current', reasoning: '检查完成', text: '测试完成', streaming: true, tools: [] });
  const filename = path.join(__dirname, '../miniprogram/pages/session/session.js');
  vm.runInNewContext(source || fs.readFileSync(filename, 'utf8'), {
    Page: value => { definition = value; }, Date, console,
    getApp: () => app,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    wx: { nextTick: fn => ticks.push(fn) },
    require(name) {
      if (name.endsWith('/store')) return store;
      if (name.endsWith('/markdown')) return { parse(text) { parses++; return require('../miniprogram/utils/markdown').parse(text); } };
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const page = { ...definition, data: clone(definition.data),
    setData(patch, callback) { patches.push(clone(patch)); apply(this.data, patch); if (callback) callback(); },
    syncRunningStrip() {}, updateDockInset() { measurements++; }, refreshBottomAnchor() { scrolls++; } };
  const sync = () => page.syncFromStoreInner({ app: store.state, session: store.sessionState });
  const reset = () => { patches.length = 0; parses = 0; scrolls = 0; measurements = 0; };
  return { page, store, app, definition, ticks, timers, sync, reset, patches,
    presetRequests: () => presetRequests,
    report: () => ({ parses, scrolls, measurements, bytes: Buffer.byteLength(JSON.stringify(patches)) }) };
}
test('composer metrics use DSH whole-session projections and prefer projected context occupancy', () => {
  const f = fixture();
  f.store.sessionState.stats = {
    stats: { turns: 2, steps: 11 },
    tokenUsage: { uncachedInputTokens: 1200, cacheReadTokens: 300, cacheWriteTokens: 0, outputTokens: 75 },
    pressure: { projectedTokens: 16384, pressureTokens: 8192, contextWindow: 32768 }
  };
  // A partial-window cache must not be summed and shown as a whole-session total.
  f.store.sessionState.turnUsage = {
    1: { uncachedInputTokens: 99999, outputTokens: 99999, cacheReadTokens: 99999, cacheWriteTokens: 99999 }
  };
  f.sync();

  assert.equal(f.page.data.composerRunMetric, '2 轮 11 步');
  assert.equal(f.page.data.composerTokenMetric, '1.6K tok · 20%');
  assert.equal(f.page.data.composerCacheMetric, '1.6K tok · 20%');
  assert.equal(f.page.data.composerContextMetric, '50%');
});
test('missing DSH projections stay unknown instead of using partial local history estimates', () => {
  const f = fixture();
  f.store.sessionState.turnUsage = {
    1: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 25, cacheWriteTokens: 0 }
  };
  f.sync();

  assert.equal(f.page.data.composerRunMetric, '— 轮 — 步');
  assert.equal(f.page.data.composerTokenMetric, '— tok');
  assert.equal(f.page.data.composerContextMetric, '—%');
});
test('session mode header uses the DSH roster name and refreshes every opened or resumed session', () => {
  const f = fixture();
  f.store.state.agentPresets = { presets: [
    { id: 'custom-review', name: '代码审查模式' }
  ] };
  f.store.sessionState.agentPreset = 'custom-review';
  f.sync();
  assert.equal(f.page.data.presetLabel, '代码审查模式');
  assert.equal(f.presetRequests(), 1, 'mode is queried for an existing conversation, not only an empty draft');

  f.sync();
  assert.equal(f.presetRequests(), 1, 'regular store updates do not repeat the same query');
  f.store.client.connectGeneration += 1;
  f.sync();
  assert.equal(f.presetRequests(), 2, 'a reconnect refreshes the session mode');
  f.page.refreshSessionPreset(true);
  assert.equal(f.presetRequests(), 3, 'foreground resume can refresh even when the socket stayed connected');
});
test('first paint renders a bounded tail and formats history only when it enters the window', () => {
  const f = fixture();
  let bottomAnchors = 0;
  f.page.refreshBottomAnchor = () => { bottomAnchors++; };
  f.sync();
  assert.ok(f.report().parses <= 12);
  assert.ok(f.page.data.rows.length <= 40);
  assert.ok(!f.page.data.rows.some(row => row.key === 'a0'));
  assert.ok(f.page.data.rows.find(row => row.key === 'current').blocks.length);
  assert.equal(f.page.data.scrollTarget, 'conv-bottom', 'first tail rows and bottom target enter the view together');
  assert.ok(f.patches.some(patch => patch.scrollTarget === 'conv-bottom'
    && (patch.rows || Object.keys(patch).some(key => key.startsWith('rows[')))),
  'the initial anchor is part of the first conversation-row render');
  assert.equal(bottomAnchors, 0, 'initial projection does not schedule a second post-paint jump');
  f.reset();
  f.page._convPinned = false; f.page.updateConversationWindow(0); f.patches.length = 0;
  let batches = 0;
  while (f.timers.size && batches++ < 100) {
    const [id, fn] = f.timers.entries().next().value; f.timers.delete(id);
    const before = f.report().parses; fn();
    assert.ok(f.report().parses - before <= 4);
  }
  assert.ok(f.page._pendingHistoryFormat.size > 0, 'offscreen messages stay unformatted');
  assert.ok(f.page.data.rows.find(row => row.key === 'a0').blocks.length);
  assert.ok(f.patches.every(patch => Object.keys(patch).every(key => /^rows\[\d+\]\.blocks$/.test(key))));
});
test('nested process narration markdown drains in bounded batches without standalone rows', () => {
  const f = fixture();
  f.sync();
  f.timers.clear(); f.page._historyFormatTimer = null; f.patches.length = 0;
  const children = Array.from({ length: 7 }, (_, index) => ({
    kind: 'narration', key: 'n' + index, sourceKey: 'process-source-' + index,
    text: 'Process step ' + index, blocks: []
  }));
  f.page.data.rows = [{ kind: 'processGroup', key: 'process-group', children }];
  f.page._pendingHistoryFormat = new Map(children.map(child => [child.sourceKey, child.text]));
  f.page._voiceHidden = false;
  f.page._unloaded = false;
  f.page.measureConversationWindow = () => {};
  f.page.refreshBottomAnchor = () => {};
  f.page.scheduleHistoryFormatting();
  let batches = 0;
  while (f.timers.size && batches++ < 5) {
    const [id, fn] = f.timers.entries().next().value; f.timers.delete(id); fn();
  }
  assert.equal(f.page._pendingHistoryFormat.size, 0);
  assert.ok(f.page.data.rows[0].children.every(child => child.blocks.length > 0));
  const nestedPatches = f.patches.flatMap(patch => Object.keys(patch)).filter(key => key.includes('.children[') && key.endsWith('.blocks'));
  assert.equal(nestedPatches.length, 7);
  assert.ok(batches >= 2, 'all process children are formatted in small batches');
});
test('a running process body follows its tail and pauses when the reader scrolls away', () => {
  const f = fixture();
  f.store.sessionState.rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a', turn: 1, text: '先说明', reasoning: '想一下',
      tools: [{ callId: 'c', key: 't', name: 'read', status: 'running', argumentsText: '{}' }] }
  ];
  // 目标在渲染后的下一个 tick 才设：组体刚挂载时 scroll-into-view 会在布局前触发
  const flush = () => { while (f.ticks.length) f.ticks.shift()(); };
  f.sync(); flush();
  const group = () => f.page.data.rows.find(row => row.kind === 'processGroup');
  const follow = () => f.page.data.processFollowTarget;
  const live = group();
  assert.ok(live, 'the live turn projects a process group');
  assert.equal(live.processBodyVisible, true, 'detailed keeps the live process open');
  assert.equal(live.processBodyCapped, true, 'inside the bounded scroll container');
  assert.equal(follow(), live.key + '/tail', 'entering a running session focuses the latest');
  // 新内容到达：继续贴底
  f.store.sessionState.rows[1].reasoning += '继续想';
  f.sync(); flush();
  assert.equal(follow(), live.key + '/tail', 'new content keeps the body on the latest');
  // Programmatic layout events do not count as the user's interruption.
  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } },
    detail: { scrollTop: 0, height: 300, scrollHeight: 900 } });
  assert.equal(follow(), live.key + '/tail');
  // 用户翻上去看旧内容：暂停跟随；滚回底部后遇到新内容：恢复
  f.page.onProcessBodyTouchStart({ currentTarget: { dataset: { key: live.key } }, touches: [{ clientY: 200 }] });
  f.page.onProcessBodyTouchMove({ currentTarget: { dataset: { key: live.key } }, touches: [{ clientY: 170 }] });
  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } },
    detail: { scrollTop: 0, height: 300, scrollHeight: 900 } });
  f.page.onProcessBodyTouchEnd();
  f.store.sessionState.rows[1].reasoning += '更多内容';
  f.sync(); flush();
  assert.equal(follow(), '', 'scrolling away from the bottom pauses the follow');
  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } },
    detail: { scrollTop: 600, height: 300, scrollHeight: 900 } });
  f.store.sessionState.rows[1].reasoning += '恢复后的内容';
  f.sync(); flush();
  assert.equal(follow(), live.key + '/tail', 'returning to the bottom resumes the follow');
  // 收工后不再跟随
  f.store.sessionState.rows[1].tools[0].status = 'done';
  f.store.sessionState.rows.push({ kind: 'assistant', key: 'a2', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' });
  f.store.sessionState.running = false;
  f.sync(); flush();
  assert.equal(follow(), '', 'a settled group stops following');
});

test('compact mode keeps a single live status line and folds the process text away', () => {
  const previousWx = global.wx;
  global.wx = { getStorageSync: (key) => key === 'workStepPresentation' ? { mode: 'compact', timing: 'completion' } : '' };
  try {
    const f = fixture();
    f.store.sessionState.rows = [
      { kind: 'user', key: 'u', text: '任务' },
      { kind: 'assistant', key: 'a1', turn: 1, reasoning: '想一下', text: '先检查文件。',
        tools: [{ callId: 'c1', key: 't1', name: 'read', status: 'done', argumentsText: '{}' }], settled: true },
      { kind: 'assistant', key: 'a2', turn: 1, text: '正在修改。',
        tools: [{ callId: 'c2', key: 't2', name: 'edit', status: 'running', argumentsText: '{}' }] }
    ];
    f.sync();
    const groups = f.page.data.rows.filter(row => row.kind === 'processGroup');
    const narrations = f.page.data.rows.filter(row => row.kind === 'assistant');
    assert.equal(groups.length, 2, 'both groups are still projected');
    assert.equal(groups[0].headingHidden, true, 'the settled group heading folds away');
    assert.equal(groups[1].headingHidden, false, 'only the active group keeps its line');
    assert.ok(/^正在/.test(groups[1].title), groups[1].title);
    assert.equal(groups[1].summary, '', 'compact headings carry no tool count');
    assert.equal(groups[1].processBodyVisible, false, 'the process stays folded until tapped');
    assert.deepEqual(narrations.map(row => row.text), [],
      '过程文字全部收起，运行中只留一行状态');
    // 收工后叙述与各组标题回来（在默认折叠的「已完成」disclosure 里）
    f.store.sessionState.rows[1].tools[0].status = 'done';
    f.store.sessionState.rows[2].tools[0].status = 'done';
    f.store.sessionState.rows.push({ kind: 'assistant', key: 'a3', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' });
    f.store.sessionState.running = false;
    f.sync();
    assert.equal(f.page._compactLiveNarration, false);
    assert.ok(f.page.data.rows.some(row => row.kind === 'assistant' && row.text === '完成'));
    const settled = f.page._allConversationRows.filter(row => row.kind === 'processGroup');
    assert.ok(settled.every(row => row.headingHidden === false), 'settled group headings come back');
    assert.ok(settled.every(row => !/次工具调用/.test(row.summary || '')), 'and still carry no tool count');
  } finally {
    global.wx = previousWx;
  }
});

test('expanding a settled turn in detailed mode opens its process groups', () => {
  const f = fixture();
  f.store.sessionState.rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a1', turn: 1, reasoning: '想一下', text: '先检查。',
      tools: [{ callId: 'c1', key: 't1', name: 'read', status: 'done', argumentsText: '{}' }], settled: true },
    { kind: 'assistant', key: 'a2', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed', durationMs: 9000 }
  ];
  f.sync();
  const turn = f.page.data.rows.find(row => row.kind === 'turnProcess');
  f.page.toggleFold({ currentTarget: { dataset: { key: turn.key } } });
  const groups = f.page.data.rows.filter(row => row.kind === 'processGroup');
  assert.ok(groups.length > 0, 'the turn expands into its process groups');
  assert.ok(groups.every(group => group.processBodyVisible), 'detailed opens every group together with the turn');
  // 组头仍可单独收起，且跨同步保持
  f.page.toggleFold({ currentTarget: { dataset: { key: groups[0].key } } });
  assert.equal(f.page.data.rows.find(row => row.key === groups[0].key).processBodyVisible, false);
  f.sync();
  const after = f.page.data.rows.filter(row => row.kind === 'processGroup');
  assert.equal(after[0].processBodyVisible, false, 'the manually folded group stays folded');
  assert.ok(after.slice(1).every(group => group.processBodyVisible), 'the rest stay open');
});

test('completion does not reparse or resend historical Markdown', () => {
  const f = fixture(); f.sync(); f.reset();
  assert.equal(f.page.data.rows.find(row => row.key === 'current').copyText, '');
  const beforeBytes = Buffer.byteLength(JSON.stringify(f.page.data.rows));
  f.store.sessionState.running = false; f.store.sessionState.rows.at(-1).streaming = false; f.sync();
  const report = f.report();
  assert.equal(report.parses, 0); assert.equal(report.scrolls, 1); assert.equal(report.measurements, 1); // Docked whale disappears at completion.
  const replacedRows = f.patches.flatMap(patch => Object.entries(patch))
    .filter(([key]) => /^rows\[\d+\]$/.test(key)).map(([, row]) => row);
  assert.ok(report.bytes < 10000, JSON.stringify({ report, beforeBytes }));
  assert.ok(replacedRows.every(row => row.key === 'current' || (row.sourceKeys || []).includes('current')),
    'completion replaces only the active response/process rows, never historical Markdown');
  assert.ok(f.patches.every(patch => !Object.hasOwn(patch, 'rows')));
  assert.equal(f.page.data.running, false); assert.equal(f.page.data.rows.at(-1).text, '测试完成');
  assert.equal(f.page.data.rows.find(row => row.key === 'current').copyText, '测试完成');
  assert.ok(f.page.data.rows.some(row => row.kind === 'turnProcess'), 'the settled turn disclosure stays visible');
  assert.ok(f.page._allConversationRows.some(row => row.kind === 'processGroup' && row.completed),
    'the completed process group remains available behind the collapsed turn');
  f.reset();
  for (let i = 0; i < 8; i++) { f.store.sessionState.stats = { stats: { turns: 151, steps: i + 1 } }; f.sync(); }
  assert.equal(f.report().parses, 0); assert.equal(f.report().scrolls, 0);
  assert.ok(f.patches.every(p => !Object.keys(p).some(k => k === 'rows' || k.startsWith('rows['))));
});
test('fleet link redraw mounts the fallback canvas instead of leaving a stale image over it', () => {
  const f = fixture();
  const page = f.page;
  page.data.tab = 'fleet';
  page.data.fleetLinksSrc = '/tmp/previous-links.png';
  page.data.fleetPanel = { graph: { width: 343, height: 420, links: [
    { p: [10, 20, 12, 30, 40, 50, 42, 60], color: '#123456', live: false }
  ] } };
  const calls = [];
  const ctx = {
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    bezierCurveTo: (...args) => calls.push(['bezierCurveTo', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    stroke: () => calls.push(['stroke'])
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  page.createSelectorQuery = () => ({
    select(selector) {
      assert.equal(selector, '#fleetLinks');
      assert.equal(page.data.fleetLinksSrc, '', 'old image is cleared before querying the fallback canvas');
      return { fields: () => ({ exec(callback) { callback([{ node: canvas }]); } }) };
    }
  });

  page.drawFleetLinks();

  assert.equal(canvas.width, 686);
  assert.equal(canvas.height, 840);
  assert.deepEqual(calls.find(call => call[0] === 'clearRect'), ['clearRect', 0, 0, 686, 840]);
  assert.deepEqual(calls.find(call => call[0] === 'moveTo'), ['moveTo', 20, 40]);
  assert.deepEqual(calls.find(call => call[0] === 'bezierCurveTo'), ['bezierCurveTo', 24, 60, 80, 100, 84, 120]);
});
test('final text, in-place tool updates, history prepend and session switch still render', () => {
  const f = fixture(); f.sync(); f.reset();
  f.store.sessionState.rows.at(-1).text = '**新的最终答复**'; f.sync();
  assert.equal(f.report().parses, 1);
  assert.ok(f.page.data.rows.find(row=>row.key==='current').blocks[0].html.includes('<strong>新的最终答复</strong>'));
  f.store.sessionState.rows.at(-1).tools = [{ callId: 'tool', name: 'read', status: 'running' }]; f.sync();
  f.store.sessionState.rows.at(-1).tools[0].status = 'done'; f.sync();
  const group = f.page.data.rows.find(row => row.kind === 'processGroup');
  assert.equal(group.children.find(child => child.kind === 'toolBundle').tools[0].waiting, false);
  f.store.sessionState.rows.unshift({ kind: 'user', key: 'older', text: '更早历史' }); f.sync();
  assert.equal(f.page._conversationRows[0].key, 'older');
  f.page._convPinned = false; f.page.revealConversationRow('older');
  assert.equal(f.page.data.rows[0].key, 'older');
  f.store.sessionState.sessionId = 'another'; f.store.sessionState.rows = [{ kind: 'assistant', key: 'a0', text: '另一会话' }]; f.sync();
  assert.equal(f.page.data.rows.length, 1); assert.equal(f.page.data.rows[0].text, '另一会话');
});
test('switching sessions keeps independent unsent drafts and image attachments', () => {
  const f = fixture(); f.sync();
  f.page.data.draft = 'Draft for first conversation';
  f.page.data.images = [{ path: '/tmp/first.png' }];
  f.store.sessionState.sessionId = 'second-session';
  f.store.sessionState.rows = [{ kind: 'user', key: 'second-user', text: 'second' }];
  f.sync();
  assert.equal(f.page.data.draft, ''); assert.deepEqual(f.page.data.images, []);
  f.page.data.draft = 'Draft for second conversation';
  f.page.data.images = [{ path: '/tmp/second.png' }];
  f.store.sessionState.sessionId = 'performance-test';
  f.store.sessionState.rows = [{ kind: 'user', key: 'first-user', text: 'first' }];
  f.sync();
  assert.equal(f.page.data.draft, 'Draft for first conversation');
  assert.deepEqual(f.page.data.images, [{ path: '/tmp/first.png' }]);
});
test('bottom scrolling coalesces callbacks and never updates an unloaded page', () => {
  const f = fixture(); f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.refreshBottomAnchor(); f.page.refreshBottomAnchor(); assert.equal(f.ticks.length, 1);
  f.page._unloaded = true; f.ticks.shift()(); assert.equal(f.patches.length, 1);
});
module.exports = { fixture };
test('reentering a loaded conversation scrolls to the latest message even without new rows', () => {
  const f = fixture(); f.sync(); f.reset();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.syncVoicePreference = () => {};
  f.page.startScrollPolling = () => {};
  f.page._convPinned = false;
  f.page._lastTouchAt = Date.now();
  f.page._lastScrollTop = 200;
  f.page.data.showJump = true;
  f.page.data.scrollAnim = true;
  f.page._voiceHidden = true;
  f.page.onShow();
  while (f.ticks.length) f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget, 'conv-bottom');
  assert.equal(f.page._convPinned, true);
  assert.equal(f.page._lastTouchAt, 0);
  assert.equal(f.page._lastScrollTop, undefined);
  assert.equal(f.page.data.showJump, false);
  assert.equal(f.page.data.scrollAnim, false);
});
test('the first page show preserves the anchor supplied with its first conversation render', () => {
  const f = fixture(); f.sync();
  let jumps = 0, anchors = 0;
  f.page._initialPageShowPending = true;
  f.page.jumpToBottom = () => { jumps++; };
  f.page.refreshBottomAnchor = () => { anchors++; };
  f.page.syncVoicePreference = () => {};
  f.page.startScrollPolling = () => {};
  f.page.updateDockInset = () => {};
  f.page.measureConversationViewport = () => {};
  f.page.onShow();
  assert.equal(jumps, 0, 'onShow must not clear and replay the first-render bottom target');
  assert.equal(anchors, 0, 'the first show must not schedule a second post-paint correction');
  assert.equal(f.page.data.scrollTarget, 'conv-bottom');
});
test('initial tail anchor recovers after layout if the first scroll-into-view was missed', () => {
  const f = fixture(); f.sync();
  while (f.ticks.length) f.ticks.shift()();
  f.page.data.scrollTarget = '';
  f.page._convPinned = false; // An early scroll measurement can mistake the initial top for reader intent.
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.updateDockInset = () => {};
  f.page.measureConversationViewport = () => {};
  f.page.startScrollPolling = () => {};

  f.page.onReady();
  assert.equal(f.ticks.length, 1, 'recovery waits until the page has completed its first render');
  f.ticks.shift()();
  assert.equal(f.page._convPinned, true, 'an un-touched initial viewport is restored to follow mode');
  assert.equal(f.ticks.length, 1, 'the target is reapplied after clearing the stale initial anchor');
  f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget, 'conv-bottom');
});
test('initial tail recovery never overrides a manual scroll before the retry', () => {
  const f = fixture(); f.sync();
  while (f.ticks.length) f.ticks.shift()();
  f.page.data.scrollTarget = '';
  f.page._convPinned = false;
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.updateDockInset = () => {};
  f.page.measureConversationViewport = () => {};
  f.page.startScrollPolling = () => {};

  f.page.onReady();
  f.page.onConvTouch();
  f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget, '', 'a touch cancels recovery and keeps the reader-owned position');
  assert.equal(f.page._convPinned, false);
  assert.equal(f.ticks.length, 0);
});
test('history arriving after page ready still gets an initial bottom-anchor recovery', () => {
  const f = fixture();
  f.store.sessionState.rows = [];
  f.store.sessionState.running = false;
  f.store.sessionState.historyState = 'loading';
  f.sync();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.updateDockInset = () => {};
  f.page.measureConversationViewport = () => {};
  f.page.startScrollPolling = () => {};
  f.page.onReady();

  f.store.sessionState.rows = [{ kind: 'assistant', key: 'latest', text: '最新回复' }];
  f.store.sessionState.historyState = 'loaded:1ev';
  f.sync();
  f.page.data.scrollTarget = '';
  f.page._convPinned = false;
  assert.equal(f.ticks.length, 1, 'late rows schedule a post-render recovery once they mount');
  f.ticks.shift()();
  assert.equal(f.page._convPinned, true);
  f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget, 'conv-bottom');
});
test('reentering a conversation remounts the latest virtual window before anchoring', () => {
  const f = fixture(); f.sync();
  f.page._convPinned = false;
  f.page._lastScrollTop = 9000;
  apply(f.page.data, f.page.conversationWindowPatch(f.page._conversationRows));
  assert.ok(!f.page.data.rows.some(row => row.key === 'current'), 'the previous viewport is mounted on an older slice');

  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.syncVoicePreference = () => {};
  f.page.startScrollPolling = () => {};
  f.page.updateDockInset = () => {};
  f.page.measureConversationViewport = () => {};
  f.page._lastSyncAt = Date.now(); // onShow intentionally skips a duplicate store projection
  f.page.onShow();
  while (f.ticks.length) f.ticks.shift()();

  assert.ok(f.page.data.rows.some(row => row.key === 'current'), 'latest row is in the mounted window before the bottom anchor fires');
  assert.equal(f.page.data.scrollTarget, 'conv-bottom');
});
test('returning from WeChat background preserves the conversation viewport', () => {
  const f = fixture(); f.sync(); f.reset();
  f.page.syncVoicePreference = () => {};
  f.page.startScrollPolling = () => {};
  f.page._lastSyncAt = Date.now();
  f.page._lastForegroundEpoch = f.app.globalData.foregroundEpoch;
  f.page._convPinned = false;
  f.page._lastScrollTop = 260;
  f.page.data.showJump = true;
  let resets = 0;
  f.page.resetConversationScroll = () => { resets++; };

  f.app.globalData.foregroundEpoch++;
  f.page.onShow();

  assert.equal(resets, 0, 'an app foreground transition is not a page re-entry');
  assert.equal(f.page._convPinned, false);
  assert.equal(f.page._lastScrollTop, 260);
  assert.equal(f.page.data.showJump, true);
});
test('switching conversations resets history reading even when rendered rows are identical', () => {
  const f = fixture(); f.sync(); f.reset();
  f.page._convPinned = false; f.page._lastTouchAt = Date.now();
  f.store.sessionState.sessionId = 'another-session';
  f.sync();
  assert.equal(f.page._convPinned, true);
  assert.equal(f.page._lastTouchAt, 0);
  assert.equal(f.page.data.scrollTarget, 'conv-bottom', 'the new session is mounted at its tail on the first render');
  assert.equal(f.report().scrolls, 0, 'session switches do not schedule a second post-render jump');
});
test('delayed history stays pinned on entry but manual upward scrolling still stops following', () => {
  const f = fixture();
  f.store.sessionState.rows = []; f.store.sessionState.running = false;
  f.store.sessionState.historyState = 'loading'; f.sync(); f.reset();
  f.page.applyScrollPosition({ scrollTop: 0, scrollHeight: 1600, clientHeight: 400 });
  assert.equal(f.page._convPinned, true);
  f.store.sessionState.rows = [{ kind: 'assistant', key: 'latest', text: '最新回复' }];
  f.store.sessionState.historyState = 'loaded:1ev'; f.sync();
  assert.ok(f.report().scrolls > 0);
  f.page.applyScrollPosition({ scrollTop: 1200, scrollHeight: 1600, clientHeight: 400 });
  f.page.onConvTouch();
  f.page.applyScrollPosition({ scrollTop: 800, scrollHeight: 1600, clientHeight: 400 });
  f.reset(); f.store.sessionState.rows[0].text += '更新'; f.sync();
  assert.equal(f.page._convPinned, false);
  assert.equal(f.report().scrolls, 0);
});
test('downward swipe disables live auto-follow before streamed content grows', () => {
  const f = fixture(); f.sync(); f.reset();
  f.page._convPinned = true;
  f.page._lastScrollTop = 1200;
  f.page.onPanelTouchStart({ touches: [{ clientX: 180, clientY: 120 }] });
  f.page.onPanelTouchMove({ touches: [{ clientX: 184, clientY: 142 }] });
  assert.equal(f.page._convPinned, false, 'older-history scroll intent immediately opts out of following');
  f.page.applyScrollPosition({ scrollTop: 1200, scrollHeight: 1600, clientHeight: 400 });
  assert.equal(f.page._convPinned, false, 'near-bottom tolerance does not re-enable following without scrolling back down');
  f.store.sessionState.rows.at(-1).text += ' newer streamed text';
  f.sync();
  assert.equal(f.report().scrolls, 0, 'live output updates do not jump back to the active response');

  f.page.onPanelTouchStart({ touches: [{ clientX: 180, clientY: 142 }] });
  f.page.onPanelTouchMove({ touches: [{ clientX: 180, clientY: 120 }] });
  f.page.applyScrollPosition({ scrollTop: 1210, scrollHeight: 1600, clientHeight: 400, userScroll: true });
  assert.equal(f.page._convPinned, true, 'scrolling back to the newest edge resumes following');
});
test('native upward scroll pauses follow inside the near-bottom tolerance', () => {
  const f = fixture(); f.sync(); f.reset();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page._convPinned = true;
  f.page._lastScrollTop = 1000;
  f.page.data.scrollTarget = 'conv-bottom';

  // Some scroll-view/nested-view gestures deliver scroll without a useful touchmove.
  f.page.onPanelTouchStart({ touches: [{ clientX: 180, clientY: 120 }] });
  f.page.onConvScroll({ detail: { scrollTop: 970, scrollHeight: 1400, clientHeight: 400 } });

  assert.equal(f.page._followPausedByUser, true);
  assert.equal(f.page._convPinned, false, 'a 30px move away from latest is reader intent, despite the 56px threshold');
  assert.equal(f.page.data.scrollTarget, '', 'native upward movement cancels a persistent tail anchor');

  // The reader may keep browsing after the finger event; later stream completion
  // must not interpret the old near-bottom position as permission to snap back.
  f.page._lastTouchAt = Date.now() - 1100;
  f.store.sessionState.rows.at(-1).text += ' more streamed text';
  f.sync();
  assert.equal(f.report().scrolls, 0);
});
test('files arriving after completion publish immediately and respect history reading', () => {
  for (const pinned of [true, false]) {
    const f=fixture();f.sync();f.store.sessionState.running=false;f.sync();f.reset();f.page._convPinned=pinned;
    f.store.sessionState.rows.push({kind:'files',key:'delivered',turn:1,sessionId:'performance-test',files:[{key:'file-1',path:'output/report.pdf',description:'Completed report',seq:900,index:0}]});
    f.sync();
    const card=f.page._conversationRows.find(row=>row.kind==='files');
    assert.equal(card.files[0].name,'report.pdf');assert.equal(card.files[0].subtitle,'Completed report');
    assert.equal(f.report().parses,0);assert.equal(f.report().scrolls,Number(pinned));
    if (pinned) assert.ok(f.patches.some(p=>Object.keys(p).some(key=>key.startsWith('rows['))));
  }
});
test('bottom anchor reset commits before targeting and a new touch cancels the pending jump', () => {
  const f=fixture(), commits=[];
  f.page.refreshBottomAnchor=f.definition.refreshBottomAnchor;
  f.page.setData=(patch, callback)=>{apply(f.page.data,patch);if(callback)commits.push(callback);};
  f.page.refreshBottomAnchor();assert.equal(f.ticks.length,0);assert.equal(f.page.data.scrollTarget,'');
  commits.shift()();assert.equal(f.ticks.length,1);f.ticks.shift()();assert.equal(f.page.data.scrollTarget,'conv-bottom');
  f.page.refreshBottomAnchor();commits.shift()();f.page.onConvTouch();f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget,'');assert.equal(f.page._bottomAnchorPending,false);
});

test('a pinned conversation catches up after a tap, but a manual swipe cancels the deferred anchor', () => {
  const f = fixture();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    f.page.onConvTouch();
    f.page.refreshBottomAnchor();
    assert.equal(f.ticks.length, 0, 'updates do not pull content from under the finger');
    assert.ok(f.page._bottomAnchorTimer, 'the latest anchor is deferred rather than dropped');
    now += 900;
    f.page._bottomAnchorTimer && f.timers.get(f.page._bottomAnchorTimer)();
    while (f.ticks.length) f.ticks.shift()();
    assert.equal(f.page.data.scrollTarget, 'conv-bottom', 'the settled tap returns to the latest content');

    f.page.data.scrollTarget = '';
    f.page.onConvTouch();
    f.page.refreshBottomAnchor();
    f.page.onPanelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
    f.page.onPanelTouchMove({ touches: [{ clientX: 100, clientY: 130 }] });
    now += 900;
    f.page._bottomAnchorTimer && f.timers.get(f.page._bottomAnchorTimer)();
    while (f.ticks.length) f.ticks.shift()();
    assert.equal(f.page.data.scrollTarget, '', 'manual browsing remains in control');
  } finally {
    Date.now = realNow;
  }
});
test('bottom anchors cannot override a reader-owned scroll gesture', () => {
  const f = fixture();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page._convPinned = false;
  f.page.refreshBottomAnchor();
  assert.equal(f.ticks.length, 0, 'reading older messages is never auto-pinned');

  f.page._convPinned = true;
  f.page._panelGesture = { tab: 'conversation', axis: 'vertical', x: 20, y: 80 };
  f.page.refreshBottomAnchor();
  assert.equal(f.ticks.length, 0, 'a pending layout correction waits until the finger lifts');
  assert.equal(f.page._bottomAnchorDeferred, true);

  f.page.onPanelTouchEnd({ changedTouches: [{ clientX: 20, clientY: 80 }] });
  assert.equal(f.ticks.length, 1, 'a still-pinned conversation can apply the deferred anchor after touch end');
});
test('empty conversation keeps its centered state instead of jumping to the bottom anchor', () => {
  const f = fixture();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.data.historyLoaded = true;
  f.page.data.rows = [];
  f.page.refreshBottomAnchor();
  assert.equal(f.ticks.length, 0);            // 空态不触发 scroll-into-view，避免被贴底顶高
  assert.equal(f.page.data.scrollTarget, '');
  assert.ok(!f.page._bottomAnchorPending);
  f.page.data.rows = [{ kind: 'user', key: 'u1', text: 'hi' }];
  f.page.refreshBottomAnchor();
  assert.equal(f.ticks.length, 1);            // 有消息后恢复贴底
});

test('inactive trajectory does no presentation work and activation uses the latest events', () => {
  const f = fixture();
  const view = require('../miniprogram/utils/trajectory-presentation');
  const original = view.listRow; let projections = 0;
  view.listRow = row => { projections++; return original(row); };
  try {
    f.store.sessionState.trajectory = [{ kind: 'event', key: 'event-1', badge: 'USER', label: 'User', seq: 1, text: 'first' }];
    f.sync();
    assert.equal(projections, 0); assert.equal(f.page.data.trajectory.length, 0);
    assert.equal(f.page.data.trajectoryMounted, false);
    f.store.sessionState.trajectory = [{ kind: 'event', key: 'event-2', badge: 'USER', label: 'User', seq: 2, text: 'latest' }];
    f.sync(); assert.equal(projections, 0);
    f.page.data.tab = 'trajectory'; f.sync();
    assert.equal(projections, 1); assert.equal(f.page.data.trajectory[0].key, 'event-2');
    f.reset(); f.sync(); assert.equal(projections, 1);
    assert.ok(f.patches.every(patch => !Object.keys(patch).some(key => key.startsWith('trajectory') || key.startsWith('traceOverview'))));
    f.store.sessionState.sessionId = 'next-session';
    f.store.sessionState.trajectory = []; f.sync();
    assert.equal(f.page.data.trajectory.length, 0);
  } finally { view.listRow = original; }
});

test('identical history is not replayed and hidden trajectory builds only when dirty and activated', () => {
  const real = require('../miniprogram/utils/protocol');
  let applies = 0, trajectories = 0, builds = 0;
  const protocol = { ...real,
    applyEvent(...args) { applies++; return real.applyEvent(...args); },
    buildRows(...args) { builds++; return real.buildRows(...args); },
    buildTrajectory(...args) { trajectories++; return real.buildTrajectory(...args); }
  };
  const filename = path.join(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} };
  class Client { constructor(callbacks) { this.callbacks = callbacks; } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, Date, console, wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require(name) {
      if (name === './gateway') return { GatewayClient: Client };
      if (name === './protocol') return protocol;
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const store = module.exports;
  store.sessionState.sessionId = 'history-test';
  const events = [
    { type: 'user/message', seq: 1, time: 1, data: { message: { role: 'user', content: [{ type: 'text', text: '问题' }] } } },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { role: 'assistant', content: [{ type: 'text', text: '完整回复' }] } } }
  ];
  store.client.callbacks.onFrame({ kind: 'history', sessionId: 'history-test', events });
  const expected = clone(store.sessionState.rows);
  applies = 0; trajectories = 0; builds = 0;
  store.client.callbacks.onFrame({ kind: 'history', sessionId: 'history-test', events });
  assert.deepEqual(clone(store.sessionState.rows), expected);
  assert.equal(applies, 0); assert.equal(trajectories, 0); assert.equal(builds, 0);
  store.setTrajectoryActive(true); assert.equal(trajectories, 1);
  store.setTrajectoryActive(true); assert.equal(trajectories, 1);
  store.setTrajectoryActive(false);
  store.client.callbacks.onFrame({ kind: 'history', sessionId: 'history-test', events: [...events, { type: 'user/message', seq: 3, data: { text: 'next' } }] });
  assert.equal(applies, 1, 'only the appended event is applied');
  assert.equal(trajectories, 1);
  store.setTrajectoryActive(true); assert.equal(trajectories, 2);
});
