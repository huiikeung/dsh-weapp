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
  const runtimeWx = { nextTick: fn => ticks.push(fn) };
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
    wx: runtimeWx,
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
  return { page, store, app, definition, wx: runtimeWx, ticks, timers, sync, reset, patches,
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
test('first paint renders a bounded tail without reparsing the live answer', () => {
  const f = fixture();
  let bottomAnchors = 0;
  f.page.refreshBottomAnchor = () => { bottomAnchors++; };
  f.sync();
  assert.equal(f.report().parses, 0, 'the initial paint leaves Markdown parsing to the post-paint queue');
  assert.ok(f.page.data.rows.length <= 40);
  assert.ok(!f.page.data.rows.some(row => row.key === 'a0'));
  assert.equal(f.page.data.rows.find(row => row.key === 'current').blocks.length, 0,
    'streaming Markdown stays as plain text to avoid rebuilding rich-text nodes per chunk');
  assert.equal(f.page.data.rows.find(row => row.key === 'current').text, '测试完成');
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
test('tail changes are coalesced into the initial bottom landing until layout settles', () => {
  const f = fixture(); f.sync();
  f.page._initialConversationAnchorApplied = true;
  f.page.data.scrollTarget = 'conv-bottom';
  f.store.sessionState.running = false;
  f.store.sessionState.rows.at(-1).streaming = false;
  f.sync(); f.reset();
  const fileRow = key => ({ kind: 'files', key, turn: 1, sessionId: 'performance-test',
    files: [{ key: key + '-item', path: 'output/' + key + '.pdf', description: 'Output', seq: 900, index: 0 }] });
  f.store.sessionState.rows.push(fileRow('hydrated-tail'));
  f.sync();
  assert.equal(f.report().scrolls, 0,
    'history hydration does not restart the first bottom scroll while the initial target is settling');

  f.page._initialConversationAnchorApplied = false;
  f.store.sessionState.rows.push(fileRow('live-tail'));
  f.sync();
  assert.equal(f.report().scrolls, 1,
    'normal bottom following resumes after initial layout has settled');
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
  const initialTarget = follow();
  f.store.sessionState.rows[1].reasoning += '继续想';
  f.sync(); flush();
  assert.notEqual(follow(), initialTarget, 'content growth switches to the alternate tail anchor');
  assert.ok(follow() === live.key + '/tail' || follow() === live.key + '/tail-alt',
    'the live process remains anchored to the latest content');
  // Programmatic layout events do not count as the user's interruption.
  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } },
    detail: { scrollTop: 0, height: 300, scrollHeight: 900 } });
  assert.equal(follow(), initialTarget === live.key + '/tail' ? live.key + '/tail-alt' : live.key + '/tail');
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
  assert.ok(follow() === live.key + '/tail' || follow() === live.key + '/tail-alt',
    'returning to the bottom resumes the follow without clearing between anchors');
  // 收工后不再跟随
  f.store.sessionState.rows[1].tools[0].status = 'done';
  f.store.sessionState.rows.push({ kind: 'assistant', key: 'a2', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' });
  f.store.sessionState.running = false;
  f.sync(); flush();
  assert.equal(follow(), '', 'a settled group stops following');
});

test('the newest live process group keeps follow ownership while paused', () => {
  const f = fixture();
  const older = { kind: 'processGroup', key: 'older', running: true, processBodyVisible: true, processBodyCapped: true };
  const latest = { kind: 'processGroup', key: 'latest', running: true, processBodyVisible: true, processBodyCapped: true };
  f.page._processFollowPaused = { latest: true };

  assert.equal(f.page.processFollowCandidate([older, latest], [older, latest]), latest,
    'a paused newest group does not make an older running group the follow target');
  assert.equal(f.page.processFollowCandidate([older, latest], [older]), null,
    'a hidden latest group cannot fall back to following stale content');
  assert.equal(f.page.latestRunningProcessGroup([older, latest]), latest);
});

test('process follow rejects stale render callbacks and measures a missing scroll viewport height', () => {
  const f = fixture();
  f.store.sessionState.rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a', turn: 1, reasoning: '想一下',
      tools: [{ callId: 'c', key: 't', name: 'read', status: 'running', argumentsText: '{}' }] }
  ];
  const flush = () => { while (f.ticks.length) f.ticks.shift()(); };
  f.sync();
  const live = f.page.data.rows.find(row => row.kind === 'processGroup');
  assert.ok(live);
  f.sync();
  flush();
  assert.equal(f.page.data.processFollowTarget, live.key + '/tail',
    'an identical store sync does not invalidate the pending post-render follow');

  // A later sync supersedes a tail target that was queued for the previous render.
  const currentTarget = f.page.data.processFollowTarget;
  f.page.refreshProcessFollow(live.key);
  f.page._processFollowVersion += 1;
  f.page._processFollowKey = 'newer-group';
  flush();
  assert.equal(f.page.data.processFollowTarget, currentTarget, 'a stale callback cannot replace the current anchor');

  f.page._processFollowKey = live.key;
  f.page._processFollowVersion += 1;
  f.page.setData({ processFollowTarget: live.key + '/tail' });
  let rectCallback;
  f.page.createSelectorQuery = () => {
    const query = {
      select(selector) { assert.equal(selector, '#process-body-' + live.key); return query; },
      boundingClientRect(callback) { rectCallback = callback; return query; },
      exec() { return query; }
    };
    return query;
  };

  f.page.onProcessBodyTouchStart({ currentTarget: { dataset: { key: live.key } }, touches: [{ clientY: 200 }] });
  f.page.onProcessBodyTouchMove({ currentTarget: { dataset: { key: live.key } }, touches: [{ clientY: 170 }] });
  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } }, detail: { scrollTop: 0, scrollHeight: 900 } });
  f.page.onProcessBodyTouchEnd();
  assert.equal(typeof rectCallback, 'function', 'the missing scroll-view height is measured from its rendered node');
  rectCallback({ height: 300 });
  assert.equal(f.page._processFollowPaused[live.key], true, 'scrolling away pauses follow once height is known');
  assert.equal(f.page.data.processFollowTarget, '', 'manual scrolling clears the active tail anchor immediately');

  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } }, detail: { scrollTop: 600, scrollHeight: 900 } });
  flush();
  assert.equal(f.page._processFollowPaused[live.key], undefined, 'reaching the bottom resumes follow without a height event field');
  assert.equal(f.page.data.processFollowTarget, live.key + '/tail');
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

test('tapping a settled turn cancels the deferred tail jump and keeps the disclosure in view', () => {
  const f = fixture();
  f.store.sessionState.rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a1', turn: 1, reasoning: '想一下', text: '先检查。',
      tools: [{ callId: 'c1', key: 't1', name: 'read', status: 'done', argumentsText: '{}' }], settled: true },
    { kind: 'assistant', key: 'a2', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' }
  ];
  f.sync();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  const turn = f.page.data.rows.find(row => row.kind === 'turnProcess');
  f.page.onPanelTouchStart({ touches: [{ clientX: 80, clientY: 240 }] });
  f.page.onPanelTouchEnd({ changedTouches: [{ clientX: 80, clientY: 240 }] });
  const pendingAnchor = f.page._bottomAnchorTimer;
  assert.ok(pendingAnchor, 'a tap initially schedules the normal delayed tail correction');
  const staleAnchor = f.timers.get(pendingAnchor);

  let pinDuringWindowUpdate;
  const originalWindowPatch = f.page.conversationWindowPatch;
  f.page.conversationWindowPatch = function (rows, options) {
    pinDuringWindowUpdate = this._convPinned;
    return originalWindowPatch.call(this, rows, options);
  };
  f.page.toggleFold({ currentTarget: { dataset: { key: turn.key } } });
  staleAnchor(); // Even an already-queued callback must not reclaim the viewport.

  assert.equal(f.page.data.folds[turn.key], true, 'the first tap expands the completed turn');
  assert.equal(pinDuringWindowUpdate, false, 'the virtual window is rebuilt in reader-owned mode');
  assert.equal(f.page._bottomAnchorTimer, null);
  assert.equal(f.page._followPausedByUser, true);
  assert.equal(f.page._convPinned, false);
  assert.equal(f.page.data.scrollTarget, turn.key, 'the disclosure itself stays anchored during the expansion');
  assert.ok(f.page.data.rows.some(row => row.kind === 'processGroup'), 'the newly visible process remains mounted');
});

test('expanding a completed turn survives a stale scrollTop before the first native scroll event', () => {
  const f = fixture();
  f.store.sessionState.rows = Array.from({ length: 160 }, (_, index) => ({
    kind: 'user', key: 'history-' + index, text: 'Earlier message ' + index
  })).concat([
    { kind: 'user', key: 'latest-user', text: '任务' },
    { kind: 'assistant', key: 'latest-work', turn: 1, reasoning: '检查', text: '处理完成。',
      tools: [{ callId: 'latest-tool', key: 'latest-tool', name: 'read', status: 'done' }], settled: true },
    { kind: 'assistant', key: 'latest-answer', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' }
  ]);
  f.store.sessionState.running = false;
  f.sync();
  const turn = f.page.data.rows.find(row => row.kind === 'turnProcess');
  assert.ok(turn, 'the latest completed turn is mounted in the first tail window');

  // scroll-into-view may reach the tail before bindscroll publishes a fresh offset.
  f.page._lastScrollTop = 0;
  f.page._lastNativeScrollTop = undefined;
  f.page.toggleFold({ currentTarget: { dataset: { key: turn.key } } });

  assert.ok(f.page.data.rows.some(row => row.key === turn.key), 'the tapped disclosure remains in the virtual slice');
  assert.ok(f.page.data.rows.some(row => row.kind === 'processGroup'), 'its newly revealed process is mounted');
  assert.equal(f.page.data.scrollTarget, turn.key, 'the viewport is focused on the tapped row, not the stale top offset');
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
  assert.ok(groups.every(group => group.processBodyVisible), 'every process body appears in the tap render');
  groups.forEach(group => {
    const source = f.page._allConversationRows.find(row => row.kind === 'processGroup' && row.key === group.key);
    assert.equal(group.children.length, source.children.length, 'each expanded group includes its complete process');
    assert.equal(group.processBodyCapped, group.processBodyCapWhenExpanded,
      'each body uses the expanded-mode scroll policy immediately');
  });
  assert.equal(f.page._turnExpansionTimer, undefined, 'expanded details do not wait for a hydration timer');
  // 组头仍可单独收起，且跨同步保持
  f.page.toggleFold({ currentTarget: { dataset: { key: groups[0].key } } });
  assert.equal(f.page.data.rows.find(row => row.key === groups[0].key).processBodyVisible, false);
  f.sync();
  const after = f.page.data.rows.filter(row => row.kind === 'processGroup');
  assert.equal(after[0].processBodyVisible, false, 'the manually folded group stays folded');
  assert.ok(after.slice(1).every(group => group.processBodyVisible), 'the rest stay open');
});

test('detailed turn expansion renders every tool and its full output in the tap patch', () => {
  const f = fixture();
  const tools = Array.from({ length: 48 }, (_, index) => ({
    callId: 'call-' + index,
    key: 'tool-' + index,
    name: 'read',
    status: 'done',
    argumentsText: '{"path":"file-' + index + '"}',
    resultText: 'result-' + index + ' ' + 'detail '.repeat(350)
  }));
  f.store.sessionState.rows = [
    { kind: 'user', key: 'u', text: '检查文件' },
    { kind: 'assistant', key: 'work', turn: 1, text: '已检查', tools, settled: true },
    { kind: 'assistant', key: 'answer', turn: 1, text: '完成', turnClosed: true, turnEndReason: 'completed' }
  ];
  f.store.sessionState.running = false;
  f.sync();
  const turn = f.page.data.rows.find(row => row.kind === 'turnProcess');
  f.page.toggleFold({ currentTarget: { dataset: { key: turn.key } } });

  const group = f.page.data.rows.find(row => row.kind === 'processGroup');
  const source = f.page._allConversationRows.find(row => row.kind === 'processGroup');
  assert.equal(group.processBodyVisible, true, 'the process body appears in the tap render');
  assert.equal(group.children.length, source.children.length, 'the first patch contains every process step');
  assert.equal(source.children.filter(child => child.kind === 'toolBundle')
    .reduce((count, child) => count + child.tools.length, 0), tools.length,
  'the full process remains in page memory');
  const renderedTools = group.children.filter(child => child.kind === 'toolBundle')
    .flatMap(child => child.tools);
  assert.equal(renderedTools.length, tools.length, 'every tool is present before the tap handler returns');
  assert.equal(renderedTools[0].resultText, tools[0].resultText, 'tool output is not progressively truncated');
  assert.equal(f.page._turnExpansionTimer, undefined, 'large expanded content does not wait on a timer');
  assert.ok(Buffer.byteLength(JSON.stringify(f.patches.at(-1))) > 100000,
    'the tap patch carries the complete large process rather than a delayed partial body');
});

test('completion does not reparse or resend historical Markdown', () => {
  const f = fixture(); f.sync(); f.page._initialConversationAnchorApplied = false; f.reset();
  assert.equal(f.page.data.rows.find(row => row.key === 'current').copyText, '');
  const beforeBytes = Buffer.byteLength(JSON.stringify(f.page.data.rows));
  f.store.sessionState.running = false; f.store.sessionState.rows.at(-1).streaming = false; f.sync();
  const report = f.report();
  assert.equal(report.parses, 1, 'the live answer is parsed once when streaming settles');
  assert.equal(report.scrolls, 1); assert.equal(report.measurements, 1); // Docked whale disappears at completion.
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
  f.store.sessionState.rows.at(-1).text = '**新的最终答复**';
  f.store.sessionState.rows.at(-1).streaming = false; f.sync();
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
test('bottom follow uses one measured scrollTop instead of repeatedly clearing the tail target', () => {
  const f = fixture();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.data.rows = [{ key: 'latest', kind: 'assistant', text: 'live' }];
  f.page.data.scrollTarget = 'conv-bottom';
  f.page.data.conversationScrollTop = 0;
  f.page._convPinned = true;
  f.page._renderSessionId = 'performance-test';
  f.wx.createSelectorQuery = () => {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect: () => query, scrollOffset: () => query }; },
      exec(callback) { callback([{ height: 400 }, { scrollHeight: 1400, scrollTop: 1000 }]); }
    };
    return query;
  };

  f.page.refreshBottomAnchor();
  f.ticks.shift()();
  assert.equal(f.page.data.scrollTarget, '', 'the one-shot tail target is released after measuring the viewport');
  assert.equal(f.page.data.conversationScrollTop, 1000, 'the native view is placed directly at its measured bottom');
  assert.equal(f.page._initialConversationAnchorApplied, false, 'the first-layout guard releases after exact geometry is known');
  const patchesAfterLanding = f.patches.length;

  f.page.refreshBottomAnchor();
  f.ticks.shift()();
  assert.equal(f.patches.length, patchesAfterLanding,
    'an unchanged bottom position does not clear and replay scroll-into-view');
});
test('bottom follow retries a missed initial target when the bound scrollTop is already stale-equal', () => {
  const f = fixture();
  f.page.refreshBottomAnchor = f.definition.refreshBottomAnchor;
  f.page.data.rows = [{ key: 'latest', kind: 'assistant', text: 'live' }];
  f.page.data.scrollTarget = '';
  f.page.data.conversationScrollTop = 1000;
  f.page._convPinned = true;
  f.page._renderSessionId = 'performance-test';
  f.wx.createSelectorQuery = () => {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect: () => query, scrollOffset: () => query }; },
      exec(callback) { callback([{ height: 400 }, { scrollHeight: 1400, scrollTop: 0 }]); }
    };
    return query;
  };

  f.page.refreshBottomAnchor();
  f.ticks.shift()();
  assert.equal(f.page.data.conversationScrollTop, 1000, 'the bound numeric value happens to match the expected bottom');
  assert.equal(f.page.data.scrollTarget, 'conv-bottom',
    'the missed native position is recovered by changing the one-shot target instead of trusting stale bound data');
});
test('live process follow updates its measured inner scrollTop without alternating anchor ids', () => {
  const f = fixture();
  f.store.sessionState.rows = [
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a', turn: 1, reasoning: '先想一下',
      tools: [{ callId: 'c', key: 't', name: 'read', status: 'running', argumentsText: '{}' }] }
  ];
  let bodyHeight = 300;
  let bodyScrollHeight = 700;
  f.wx.createSelectorQuery = () => {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect: () => query, scrollOffset: () => query }; },
      exec(callback) { callback([{ height: bodyHeight }, { scrollHeight: bodyScrollHeight, scrollTop: 0 }]); }
    };
    return query;
  };
  const flush = () => { while (f.ticks.length) f.ticks.shift()(); };
  f.sync(); flush();
  const group = () => f.page.data.rows.find(row => row.kind === 'processGroup');
  const live = group();
  assert.ok(live);
  assert.equal(live.processBodyScrollTop, 400);
  assert.equal(f.page.data.processFollowTarget, '', 'measured scrolling leaves no competing scroll-into-view target');

  bodyScrollHeight = 940;
  f.store.sessionState.rows[1].reasoning += '，继续生成';
  f.sync(); flush();
  assert.equal(group().processBodyScrollTop, 640, 'new streamed content moves directly to the exact inner bottom');
  assert.equal(f.page.data.processFollowTarget, '', 'stream updates do not alternate tail sentinel ids');

  f.page.onProcessBodyTouchStart({ currentTarget: { dataset: { key: live.key } }, touches: [{ clientY: 200 }] });
  f.page.onProcessBodyTouchMove({ currentTarget: { dataset: { key: live.key } }, touches: [{ clientY: 170 }] });
  f.page.onProcessBodyScroll({ currentTarget: { dataset: { key: live.key } },
    detail: { scrollTop: 220, scrollHeight: 940, height: 300 } });
  f.page.onProcessBodyTouchEnd();
  bodyScrollHeight = 1100;
  f.store.sessionState.rows[1].reasoning += '，用户在看上面的过程';
  f.sync(); flush();
  assert.equal(group().processBodyScrollTop, 220,
    'a manual inner scroll stores its live offset so streamed rerenders do not snap back to the tail');
  assert.equal(f.page._processFollowPaused[live.key], true);
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
test('the first tail anchor is reapplied after the measured dock shortens the viewport', () => {
  const f = fixture();
  f.page.updateDockInset = f.definition.updateDockInset;
  f.page.data.tab = 'conversation';
  f.page.data.convBottomInset = 0;
  f.page.data.kbHeight = 0;
  f.page.data.scrollTarget = 'conv-bottom';
  f.page._convPinned = true;
  f.page._initialConversationAnchorPending = false;
  f.page._initialConversationAnchorApplied = true;
  let anchors = 0;
  f.page.refreshBottomAnchor = () => { anchors++; };
  const previousGetWindowInfo = f.wx.getWindowInfo;
  const previousCreateSelectorQuery = f.wx.createSelectorQuery;
  f.wx.getWindowInfo = () => ({ windowHeight: 800, windowWidth: 375 });
  f.wx.createSelectorQuery = () => {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect: () => query }; },
      exec(callback) { callback([{ top: 700, height: 100 }]); }
    };
    return query;
  };
  try {
    f.page.updateDockInset();
    f.ticks.shift()();
    assert.ok(f.page.data.convBottomInset > 0, 'the dock measurement commits the shorter viewport');
    assert.equal(anchors, 1, 'the pending initial target is re-applied against the final viewport');
  } finally {
    if (previousGetWindowInfo === undefined) delete f.wx.getWindowInfo;
    else f.wx.getWindowInfo = previousGetWindowInfo;
    if (previousCreateSelectorQuery === undefined) delete f.wx.createSelectorQuery;
    else f.wx.createSelectorQuery = previousCreateSelectorQuery;
  }
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
  f.page._initialConversationAnchorApplied = true;
  f.page._lastScrollTop = 1200;
  f.page.onPanelTouchStart({ touches: [{ clientX: 180, clientY: 120 }] });
  f.page.onPanelTouchMove({ touches: [{ clientX: 184, clientY: 142 }] });
  assert.equal(f.page._convPinned, false, 'older-history scroll intent immediately opts out of following');
  assert.equal(f.page._initialConversationAnchorApplied, false,
    'reader movement releases the initial-layout anchor guard');
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
test('programmatic height corrections are not misread as an upward reader gesture', () => {
  const f = fixture();
  f.page._convPinned = true;
  f.page._lastNativeScrollTop = 1000;
  f.page._lastScrollTop = 1000;
  f.page._suppressScrollUntil = Date.now() + 300;
  f.page._programmaticScrollAt = Date.now();
  f.page._programmaticScrollTop = 800;

  f.page.onConvScroll({ detail: { scrollTop: 900, scrollHeight: 1300, clientHeight: 400 } });

  assert.notEqual(f.page._followPausedByUser, true,
    'an intermediate scroll event inside a programmatic correction cannot take ownership from live follow');
  assert.equal(f.page._convPinned, true);
});
test('initial tail-anchor corrections do not cancel entry following', () => {
  const f = fixture();
  f.page._convPinned = true;
  f.page._initialConversationAnchorApplied = true;
  f.page._lastNativeScrollTop = 1000;
  f.page._lastScrollTop = 1000;
  f.page._suppressScrollUntil = Date.now() + 300;
  f.page.data.scrollTarget = 'conv-bottom';

  f.page.onConvScroll({ detail: { scrollTop: 970, scrollHeight: 1300, clientHeight: 400 } });

  assert.notEqual(f.page._followPausedByUser, true,
    'a native upward clamp during the initial layout is not treated as a manual swipe');
  assert.equal(f.page._convPinned, true);
  assert.equal(f.page.data.scrollTarget, 'conv-bottom');
});
test('transient pre-anchor scroll measurements cannot unpin or virtualize away the tail', () => {
  const f = fixture();
  f.page.onConvScroll = f.definition.onConvScroll;
  f.page.applyScrollPosition = f.definition.applyScrollPosition;
  f.page._convPinned = true;
  f.page._initialConversationAnchorApplied = true;
  f.page._lastNativeScrollTop = 1200;
  f.page._lastScrollTop = 1200;
  let windowShifts = 0;
  f.page.updateConversationWindow = () => { windowShifts++; };

  // A mount-time bindscroll can briefly report the old top before the native
  // scroll-into-view reaches the rendered tail. It is layout, not user intent.
  f.page.onConvScroll({ detail: { scrollTop: 180, scrollHeight: 3600, clientHeight: 400 } });
  assert.equal(f.page._convPinned, true);
  assert.notEqual(f.page._followPausedByUser, true);
  assert.equal(windowShifts, 0, 'the tail window remains mounted during initial positioning');

  // Selector-based viewport polling sees the same transient offset; it must not
  // independently flip the follow state while the anchor is active.
  f.page.applyScrollPosition({ scrollTop: 180, scrollHeight: 3600, clientHeight: 400 });
  assert.equal(f.page._convPinned, true);

  // A real upward gesture still takes over even if it starts during first layout.
  f.page.onConvTouch();
  f.page.onConvScroll({ detail: { scrollTop: 140, scrollHeight: 3600, clientHeight: 400 } });
  assert.equal(f.page._convPinned, false);
  assert.equal(f.page._followPausedByUser, true);
  assert.equal(f.page._initialConversationAnchorApplied, false);
  assert.equal(windowShifts, 1);
});
test('files arriving after completion publish immediately and respect history reading', () => {
  for (const pinned of [true, false]) {
    const f=fixture();f.sync();f.store.sessionState.running=false;f.sync();f.reset();
    f.page._initialConversationAnchorApplied=false;f.page._convPinned=pinned;
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
