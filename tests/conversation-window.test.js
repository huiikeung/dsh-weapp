const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationWindow } = require('../miniprogram/pages/session/utils/conversation-window');
const { recentWindow } = require('../miniprogram/utils/history-window');
const protocol = require('../miniprogram/utils/protocol');
const viewport = require('../miniprogram/pages/session/viewport-actions');
const rows = n => Array.from({ length: n }, (_, i) => ({ key: 'u' + i, kind: 'user', text: 'Message ' + i }));

// 估算值跟着 session.wxss 的真实排版走（335px 文本列 / 32rpx 段落 / 1.6 行高）。
// 需要「估算 ≠ 实测」的用例先把逻辑高度钉住，再让实测返回别的值。
function pinHeights(window, list, height) { list.forEach(row => window.heights.set(row.key, height)); }
function pageWith(rowsList, extra, height) {
  const page = Object.assign({ ...viewport, data: {}, _renderSessionId: 's', _convPinned: false,
    _convClientHeight: 700, setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    scheduleHistoryFormatting() {}, scheduleAttachmentThumbs() {} }, extra);
  if (height) {
    page._conversationWindow = new ConversationWindow();
    page._windowSession = 's';
    pinHeights(page._conversationWindow, rowsList, height);
  }
  page.conversationWindowPatch(rowsList);
  return page;
}

test('ten thousand messages mount at most forty rows at top, middle, bottom and direct jumps', () => {
  const window = new ConversationWindow(); window.update(rows(10000));
  for (const top of [0, 500000, 999300]) {
    const patch = window.select(top, 700);
    assert.ok(patch.rows.length <= 40);
    // 占位 + 渲染行 + 占位必须精确等于总高：估算值只影响窗口边界，不影响这个恒等式。
    assert.equal(patch.conversationTopSpace
      + (window.offsets[window.end] - window.offsets[window.start])
      + patch.conversationBottomSpace, window.offsets[10000]);
    assert.ok(patch.rows.some(row => row.key === 'u' + window.indexAt(top)));
  }
  const jump = window.select(700000, 700, 7000);
  assert.ok(jump.rows.some(row => row.key === 'u7000'));
});

test('short conversations render whole so estimates never reach the layout', () => {
  const window = new ConversationWindow();
  window.update(Array.from({ length: 12 }, (_, i) => ({ key: 'a' + i, kind: 'assistant', text: '第 ' + i + ' 段回答，长度中等。'.repeat(20) })));
  const patch = window.select(0, 700);
  assert.equal(window.full, true, 'a few viewports of content skip virtualization');
  assert.equal(patch.conversationTopSpace, 0);
  assert.equal(patch.conversationBottomSpace, 0);
  assert.equal(patch.rows.length, 12);
  assert.equal(window.shouldShiftForScroll(2000, 700), false, 'scrolling a full window never swaps rows');
});

test('long conversations still virtualize and keep the DOM window stable', () => {
  const window = new ConversationWindow();
  pinHeights(window, rows(400), 100);
  window.update(rows(400));
  const patch = window.select(20000, 700);
  assert.equal(window.full, false);
  assert.ok(patch.rows.length <= 40);
  assert.ok(patch.conversationTopSpace > 0);
  assert.equal(window.shouldShiftForScroll(20030, 700), false,
    'small finger movements do not replace keyed rows while scrolling');
  assert.equal(window.shouldShiftForScroll(30000, 700), true,
    'a fast fling beyond the current window is handled immediately');
});

test('virtual origin rebases scroll coordinates without changing the native position', () => {
  const window = new ConversationWindow();
  pinHeights(window, rows(200), 60);
  window.update(rows(200));
  window.origin = 120;
  const patch = window.select(1320, 300);
  assert.ok(patch.rows.some(row => row.key === 'u20'), 'selection maps through the rebased origin');
  assert.equal(patch.conversationTopSpace + patch.conversationBottomSpace
    + (window.offsets[window.end] - window.offsets[window.start]), window.offsets[200],
  'rebasing redistributes spacer space without changing total content height');
  const baseline = new ConversationWindow();
  pinHeights(baseline, rows(200), 60);
  baseline.update(rows(200));
  const baselinePatch = baseline.select(1200, 300);
  assert.deepEqual(patch.rows.map(row => row.key), baselinePatch.rows.map(row => row.key),
    'rebased selection matches the equivalent unshifted logical offset');
  assert.equal(window.shouldShiftForScroll(1320, 300), baseline.shouldShiftForScroll(1200, 300),
    'window-edge checks use the same logical position after rebasing');
});

test('variable height prefix offsets select the correct row including a very long reply', () => {
  const window = new ConversationWindow();
  pinHeights(window, rows(10), 100);
  window.heights.set('u4', 5000);
  window.update(rows(10));
  assert.equal(window.indexAt(5399), 4); assert.equal(window.indexAt(5400), 5);
  assert.equal(window.select(4000, 700).rows.some(row => row.key === 'u4'), true);
});

test('height estimates track the rendered markdown metrics instead of a fixed clamp', () => {
  const window = new ConversationWindow();
  window.update([
    { key: 'long', kind: 'assistant', text: 'x'.repeat(10000) },
    { key: 'image', kind: 'user', images: [{}], singleHeight: 640 },
    { key: 'group', kind: 'processGroup', processBodyVisible: true, processBodyCapped: true }
  ]);
  // 10000 个半角字符按 37 字/行、27px 行高算 ≈ 7400px：既不是旧版 1400px 的封顶，
  // 也不是 28 字/行那种明显低估。
  assert.ok(window.offsets[1] > 6000 && window.offsets[1] < 9000, 'long answers stay proportional to their text');
  assert.ok(window.offsets[2] - window.offsets[1] > 300, 'a single image reserves its rendered height');
  assert.ok(window.offsets[3] - window.offsets[2] > 400, 'an open capped process reserves the scroll body');
});

test('scroll handling does not publish a new virtual slice for each crossed row', () => {
  let patches = 0;
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 500, _convClientHeight: 400,
    setData(patch, callback) { patches++; Object.assign(this.data, patch); if (callback) callback(); } }, 100);

  page.updateConversationWindow(650);
  assert.equal(patches, 0, 'the viewport remains inside the existing overscan window');
  page.updateConversationWindow(900);
  assert.equal(patches, 1, 'the virtual slice advances near its edge');
});

test('fast swipes coalesce nearby virtual-window replacements to the latest scroll position', () => {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let now = 1000, serial = 0;
  const timers = new Map();
  let patches = 0;
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 500, _convClientHeight: 400,
    setData(patch, callback) { patches++; Object.assign(this.data, patch); if (callback) callback(); } }, 100);
  page._lastWindowShiftAt = now;
  Date.now = () => now;
  global.setTimeout = (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; };
  global.clearTimeout = id => timers.delete(id);
  try {
    page.updateConversationWindow(900);
    page.updateConversationWindow(1500);
    assert.equal(patches, 0, 'the current DOM slice stays stable during the same short swipe burst');
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 32);
    now += 40;
    [...timers.values()][0].fn();
    assert.equal(patches, 1);
    assert.ok(page.data.rows.some(row => row.key === 'u15'), 'the newest position wins when the window advances');
  } finally {
    Date.now = realNow;
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
});

test('fast fling measures the mounted slice and preserves the visible anchor', () => {
  const list = rows(200);
  const page = pageWith(list, { _lastScrollTop: 1200, _lastNativeScrollTop: 1200, _convClientHeight: 300 }, 60);
  const initial = page._conversationWindow.select(1200, 300);
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace, conversationBottomSpace: initial.conversationBottomSpace };
  let completeMeasure;
  let applied;
  page.setData = (patch, callback) => {
    applied = patch;
    Object.assign(page.data, patch);
    if (callback) callback();
  };

  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { completeMeasure = callback; }
    };
    return query;
  } };
  try {
    page._lastNativeScrollTop = 1260;
    page.updateConversationWindow(1260);
    assert.equal(page._windowShiftMeasurePending, true, 'the old mounted rows are measured before replacement');

    // Momentum advances while the selector query is in flight. The pending
    // slice must follow this position, not the earlier threshold-crossing event.
    page._lastNativeScrollTop = 1400;
    page.updateConversationWindow(1400);
    // 视口 rect 从 0 开始：真实布局的内容 padding 不进入这套合成几何，
    // padding 感知补偿在这里必须退化为 0，老期望值保持成立。
    const viewportTop = 0;
    const measuredTop = 1260;
    const rowHeight = 62.5;
    const windowStart = page._conversationWindow.start;
    const topSpace = page.data.conversationTopSpace;
    const rects = page.data.rows.map(row => {
      const index = Number(row.key.slice(1));
      const top = viewportTop + topSpace + (index - windowStart) * rowHeight - measuredTop;
      return { top, bottom: top + rowHeight, height: rowHeight };
    });
    const visibleRow = rects.findIndex(rect => rect.bottom > viewportTop + 1 && rect.top < 300 - 1);
    const anchorIndex = Number(page.data.rows[visibleRow].key.slice(1));
    const oldStart = page._conversationWindow.start;
    const oldAnchorOffset = page._conversationWindow.offsets[anchorIndex];
    const oldStartOffset = page._conversationWindow.offsets[oldStart];
    const oldTopSpace = page.data.conversationTopSpace;
    const expectedAnchorTop = oldTopSpace + oldAnchorOffset - oldStartOffset - 1400;
    completeMeasure([{ top: 0, bottom: 300 }, { scrollTop: 1260 }, rects]);

    assert.equal(applied && applied.conversationScrollTop, undefined,
      'a fast swipe never feeds a corrective scrollTop back into the native scroller');
    assert.ok(page.data.rows.some(row => row.key === 'u23'), 'the row under the latest fling position remains mounted');
    assert.equal(page._lastNativeScrollTop, 1400, 'native momentum remains the source of truth');
    assert.equal(page._conversationWindow.heights.get('u23'), rowHeight,
      'real row heights are cached before the virtual slice changes');
    const start = page._conversationWindow.start;
    const rebasedTop = page.data.conversationTopSpace
      + page._conversationWindow.offsets[anchorIndex] - page._conversationWindow.offsets[start] - 1400;
    assert.equal(rebasedTop, expectedAnchorTop,
      'spacer rebasing restores the pre-measure anchor coordinate at the latest native offset');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('fast fling past the mounted slice discards height changes that have no visible anchor', () => {
  const list = rows(120);
  const page = pageWith(list, { _lastScrollTop: 500, _lastNativeScrollTop: 500, _convClientHeight: 300 }, 100);
  const initial = page._conversationWindow.select(500, 300);
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace, conversationBottomSpace: initial.conversationBottomSpace };
  page._lastTouchAt = Date.now();
  page._panelGesture = { tab: 'conversation', axis: 'vertical' };
  page._lastConversationGestureAt = page._lastTouchAt;

  let completeMeasure;
  let applied;
  page.setData = patch => { applied = patch; Object.assign(page.data, patch); };
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { completeMeasure = callback; }
    };
    return query;
  } };

  try {
    page._lastNativeScrollTop = 900;
    page.updateConversationWindow(900);
    page._lastNativeScrollTop = 1500;
    page.updateConversationWindow(1500);
    const rects = page.data.rows.map((row, index) => {
      const top = -10000 + index * 70;
      return { top, bottom: top + 70, height: 70 };
    });
    completeMeasure([{ top: 0, bottom: 300 }, { scrollTop: 900 }, rects]);

    assert.equal(page._conversationWindow.heights.get('u0'), 100,
      'offscreen measurements are rolled back because no visible row can anchor them');
    assert.equal(page._lastNativeScrollTop, 1500, 'the latest native fling position remains authoritative');
    assert.equal(applied.conversationScrollTop, undefined, 'the scroller is not corrected without a visible anchor');
    assert.ok(page.data.rows.some(row => row.key === 'u15'), 'the mounted slice follows the latest fling position');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('idle measurement outside the mounted slice moves the window before changing cached geometry', () => {
  const page = measuredPage({ _lastScrollTop: 1400, _lastNativeScrollTop: 1400 });
  const rects = page.data.rows.map((row, index) => {
    const top = -10000 + index * 70;
    return { top, bottom: top + 70, height: 70 };
  });
  let requestedTop;
  page.updateConversationWindow = top => { requestedTop = top; };
  page.setData = () => { throw new Error('offscreen geometry must not be committed'); };
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { callback([{ top: 0, bottom: 300 }, { scrollTop: 1400 }, rects]); }
    };
    return query;
  } };

  try {
    page.measureConversationWindow();
    assert.equal(page._conversationWindow.heights.get('u0'), 100,
      'an offscreen slice cannot change the geometry model');
    assert.equal(requestedTop, 1400, 'the next window is selected from the native scroll position');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('a pending measure cannot restore the old scroll position during an active gesture', () => {
  const list = rows(200);
  const page = pageWith(list, { _lastScrollTop: 1200, _lastNativeScrollTop: 1200, _convClientHeight: 300 }, 60);
  const initial = page._conversationWindow.select(1200, 300);
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace, conversationBottomSpace: initial.conversationBottomSpace };
  let completeMeasure;
  let applied;
  page.setData = (patch, callback) => {
    applied = patch;
    Object.assign(page.data, patch);
    if (callback) callback();
  };

  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { completeMeasure = callback; }
    };
    return query;
  } };
  try {
    page._lastTouchAt = Date.now();
    page._panelGesture = { tab: 'conversation', axis: 'vertical' };
    page._lastConvScrollAt = page._lastTouchAt;
    page.updateConversationWindow(1260);

    // Native momentum has moved, but the next bindscroll callback has not run.
    page._lastNativeScrollTop = 1400;
    const viewportTop = 0;
    const measuredTop = 1400;
    const rowHeight = 62.5;
    const windowStart = page._conversationWindow.start;
    const topSpace = page.data.conversationTopSpace;
    const rects = page.data.rows.map(row => {
      const index = Number(row.key.slice(1));
      const top = viewportTop + topSpace + (index - windowStart) * rowHeight - measuredTop;
      return { top, bottom: top + rowHeight, height: rowHeight };
    });
    const visibleRow = rects.findIndex(rect => rect.bottom > viewportTop + 1 && rect.top < 300 - 1);
    const anchorIndex = Number(page.data.rows[visibleRow].key.slice(1));
    const oldStart = page._conversationWindow.start;
    const oldAnchorOffset = page._conversationWindow.offsets[anchorIndex];
    const oldStartOffset = page._conversationWindow.offsets[oldStart];
    const oldTopSpace = page.data.conversationTopSpace;
    const expectedAnchorTop = oldTopSpace + oldAnchorOffset - oldStartOffset - 1400;
    completeMeasure([{ top: 0, bottom: 300 }, { scrollTop: measuredTop }, rects]);

    assert.equal(applied && applied.conversationScrollTop, undefined,
      'a query observing newer momentum rebases spacers instead of replaying an old scroll position');
    assert.ok(page.data.rows.some(row => row.key === 'u23'),
      'the rendered window follows the latest native position even before its scroll event arrives');
    assert.equal(page._lastNativeScrollTop, 1400);
    assert.equal(page._conversationWindow.heights.get('u23'), rowHeight,
      'real row heights are cached instead of estimated heights');
    const start = page._conversationWindow.start;
    const rebasedTop = page.data.conversationTopSpace
      + page._conversationWindow.offsets[anchorIndex] - page._conversationWindow.offsets[start] - 1400;
    assert.equal(rebasedTop, expectedAnchorTop,
      'the stable key remains at its pre-measure logical pixel position');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('window-shift measurement does not infer scrollTop from padded screen coordinates', () => {
  // 实际布局有视口 padding；rect 只用于找可见 key，不再反算 scrollTop。
  const list = rows(200);
  const page = pageWith(list, { _lastScrollTop: 1200, _lastNativeScrollTop: 1200, _convClientHeight: 300 }, 62.5);
  const initial = page._conversationWindow.select(1200, 300);
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace, conversationBottomSpace: initial.conversationBottomSpace };
  let completeMeasure;
  let applied;
  page.setData = (patch, callback) => {
    applied = patch;
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { completeMeasure = callback; }
    };
    return query;
  } };
  try {
    const viewportTop = 100;
    const pad = 8;
    const measuredTop = 1400;
    page._lastNativeScrollTop = 1400;
    page._lastScrollTop = 1400;
    page.updateConversationWindow(1400);
    const rowHeight = 62.5;
    const windowStart = page._conversationWindow.start;
    const topSpace = page.data.conversationTopSpace;
    const rects = page.data.rows.map(row => {
      const index = Number(row.key.slice(1));
      const top = viewportTop + pad + topSpace + (index - windowStart) * rowHeight - measuredTop;
      return { top, bottom: top + rowHeight, height: rowHeight };
    });
    const visibleRow = rects.findIndex(rect => rect.bottom > viewportTop + 1 && rect.top < 400 - 1);
    completeMeasure([{ top: viewportTop, bottom: viewportTop + 300 }, { scrollTop: measuredTop }, rects]);

    assert.equal(applied.conversationScrollTop, undefined,
      'with consistent geometry the padding-aware compensation produces no spurious scrollTop write');
    assert.equal(page._lastScrollTop, 1400, 'the latest native position is recorded without a corrective write');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('a window shift during an active swipe swaps rows without rewriting the scroll position', () => {
  const list = rows(200);
  const page = pageWith(list, { _lastScrollTop: 1200, _lastNativeScrollTop: 1200, _convClientHeight: 300 }, 60);
  const initial = page._conversationWindow.select(1200, 300);
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace, conversationBottomSpace: initial.conversationBottomSpace };
  let completeMeasure;
  let applied;
  page.setData = (patch, callback) => {
    applied = patch;
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { completeMeasure = callback; }
    };
    return query;
  } };
  try {
    page._lastTouchAt = Date.now();
    page._panelGesture = { tab: 'conversation', axis: 'vertical' };
    page._lastConversationGestureAt = page._lastTouchAt;
    page._lastConvScrollAt = page._lastTouchAt;
    page._lastNativeScrollTop = 1260;
    page.updateConversationWindow(1260);
    const viewportTop = 0;
    const measuredTop = 1260;
    const rowHeight = 70;
    const windowStart = page._conversationWindow.start;
    const topSpace = page.data.conversationTopSpace;
    const rects = page.data.rows.map(row => {
      const index = Number(row.key.slice(1));
      const top = viewportTop + topSpace + (index - windowStart) * rowHeight - measuredTop;
      return { top, bottom: top + rowHeight, height: rowHeight };
    });
    const visibleRow = rects.findIndex(rect => rect.bottom > viewportTop + 1 && rect.top < 300 - 1);
    const anchorIndex = Number(page.data.rows[visibleRow].key.slice(1));
    const oldStart = page._conversationWindow.start;
    const oldAnchorOffset = page._conversationWindow.offsets[anchorIndex];
    const oldStartOffset = page._conversationWindow.offsets[oldStart];
    const oldTopSpace = page.data.conversationTopSpace;
    const expectedAnchorTop = oldTopSpace + oldAnchorOffset - oldStartOffset - 1260;
    completeMeasure([{ top: viewportTop, bottom: 300 }, { scrollTop: measuredTop }, rects]);

    assert.equal(applied && applied.conversationScrollTop, undefined,
      'height corrections are absorbed by the spacers instead of interrupting momentum');
    assert.equal(page._lastNativeScrollTop, 1260, 'the native position is left to the running gesture');
    assert.ok(page.data.rows.some(row => row.key === 'u23'), 'the row under the fling position is mounted');
    assert.equal(page._conversationWindow.heights.get('u23'), 70, 'measured heights are committed');
    const start = page._conversationWindow.start;
    const rebasedTop = page.data.conversationTopSpace
      + page._conversationWindow.offsets[anchorIndex] - page._conversationWindow.offsets[start] - 1260;
    assert.equal(rebasedTop, expectedAnchorTop, 'the visible key keeps its pre-measure logical screen coordinate');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('prepending history preserves the visible anchor and offset while incoming tail does not move it', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025 }, 100);
  page._conversationWindow.heights.set('older', 100);
  const patch = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...list]);
  assert.equal(patch.conversationScrollTop, undefined);
  assert.equal(page._conversationWindow.origin, -100, 'the prepend shifts the virtual origin, not the reader');
  assert.equal(page._lastScrollTop, 5025);
  assert.ok(patch.rows.some(row => row.key === 'u50'));
  const live = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...list, { key: 'live', kind: 'assistant', text: 'live' }]);
  assert.equal(live.conversationScrollTop, undefined);
  assert.equal(page._lastScrollTop, 5025);
});

test('content re-estimation preserves the same visible row through spacer rebasing', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025, _lastNativeScrollTop: 5025 }, 100);
  const initial = page.conversationWindowPatch(list);
  const anchor = list[50];
  const oldScreenTop = initial.conversationTopSpace
    + page._conversationWindow.offsets[50] - page._conversationWindow.offsets[page._conversationWindow.start] - 5025;

  page._conversationWindow.heights.set('u30', 200);
  const patch = page.conversationWindowPatch(list);
  const nextIndex = page._conversationWindow.rows.findIndex(row => row.key === anchor.key);
  const newScreenTop = patch.conversationTopSpace
    + page._conversationWindow.offsets[nextIndex]
    - page._conversationWindow.offsets[page._conversationWindow.start] - 5025;

  assert.equal(patch.conversationScrollTop, undefined, 'the user-controlled scrollTop is untouched');
  assert.equal(newScreenTop, oldScreenTop, 'the anchor stays at the exact same pixel after an upstream height change');
});

test('row mutations anchor to the last measured stable key instead of an estimated index', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025, _lastNativeScrollTop: 5025 }, 100);
  page._lastMeasuredConversationAnchor = { key: 'u45', screenTop: -20, scrollTop: 5025 };
  page._conversationWindow.heights.set('u48', 200);

  const patch = page.conversationWindowPatch(list);

  assert.equal(page._conversationWindow.origin, 0,
    'a height change below the actually visible row does not rebase its position');
  assert.equal(patch.conversationScrollTop, undefined);
});

test('content re-estimation does not write scrollTop over a recent manual swipe', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025, _lastTouchAt: Date.now() - 200 }, 100);
  page._conversationWindow.heights.set('u30', 200);

  const patch = page.conversationWindowPatch(list);
  assert.equal(patch.conversationScrollTop, undefined,
    'estimated-height correction leaves the reader position alone during touch settling');
  assert.equal(page._lastScrollTop, 5025, 'the stale estimated correction is not recorded as the native position');
});

test('content re-estimation does not jump during momentum after the finger lifts', () => {
  const list = rows(100);
  const page = pageWith(list, {
    _lastScrollTop: 5025,
    _lastTouchAt: Date.now() - 1000,
    _lastConversationGestureAt: Date.now() - 100
  }, 100);
  page._conversationWindow.heights.set('u30', 200);

  const patch = page.conversationWindowPatch(list);
  assert.equal(patch.conversationScrollTop, undefined,
    'virtual offsets cannot restore the pre-fling position while native momentum is active');
  assert.equal(page._lastScrollTop, 5025);
});

test('a fully rendered conversation never rewrites scrollTop from estimated offsets', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ key: 'u' + i, kind: 'user', text: 'Message ' + i }));
  const page = pageWith(list, { _lastScrollTop: 137 });
  assert.equal(page._conversationWindow.full, true);
  const patch = page.conversationWindowPatch(list);
  assert.equal(patch.conversationScrollTop, undefined,
    'with no spacers the rendered height is the document height, so estimates cannot move the viewport');
  assert.equal(page._lastScrollTop, 137);
});

test('history prepends preserve the keyed row in spacer coordinates without scroll-into-view', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025 }, 100);
  page._lastTouchAt = Date.now();
  page._lastConversationGestureAt = page._lastTouchAt;
  page._panelGesture = { tab: 'conversation', axis: 'vertical' };
  const before = page._conversationWindow.patch();
  const oldAnchorIndex = 50;
  const oldScreenTop = before.conversationTopSpace
    + page._conversationWindow.offsets[oldAnchorIndex]
    - page._conversationWindow.offsets[page._conversationWindow.start] - 5025;
  page._conversationWindow.heights.set('older', 100);
  const patch = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...list], { anchor: true });
  assert.equal(patch.scrollTarget, '');
  assert.equal(patch.scrollAnim, false);
  assert.equal(patch.conversationScrollTop, undefined);
  assert.equal(page._scrollAnchorAt, undefined, 'history insertion does not masquerade as a programmatic scroll');
  assert.equal(page._lastScrollTop, 5025);
  const anchorIndex = page._conversationWindow.rows.findIndex(row => row.key === 'u50');
  const nextScreenTop = patch.conversationTopSpace
    + page._conversationWindow.offsets[anchorIndex]
    - page._conversationWindow.offsets[page._conversationWindow.start] - 5025;
  assert.equal(nextScreenTop, oldScreenTop, 'the prepended page does not move the existing reading anchor');
});

test('settled history prepends canonicalize the virtual origin without moving the visible row', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025, _lastNativeScrollTop: 5025,
    _convClientHeight: 700 }, 100);
  const initial = page._conversationWindow.patch();
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace,
    conversationScrollTop: 0 };
  page._conversationWindow.heights.set('older', 100);
  const prepend = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...list], { anchor: true });
  Object.assign(page.data, prepend);
  const anchorIndex = page._conversationWindow.rows.findIndex(row => row.key === 'u50');
  const oldScreenTop = page.data.conversationTopSpace
    + page._conversationWindow.offsets[anchorIndex]
    - page._conversationWindow.offsets[page._conversationWindow.start] - 5025;
  let applied;
  page.setData = (patch, callback) => {
    applied = patch;
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) {
        const top = page.data.conversationTopSpace - 5025;
        const rects = page.data.rows.map((_row, index) => {
          const rowTop = top + index * 100;
          return { top: rowTop, bottom: rowTop + 100, height: 100 };
        });
        callback([{ top: 0, bottom: 700 }, { scrollTop: 5025 }, rects]);
      }
    };
    return query;
  } };
  try {
    page.measureConversationWindow();
    assert.equal(page._conversationWindow.origin, 0, 'the temporary origin is folded into native coordinates');
    assert.equal(applied.conversationScrollTop, 5125, 'native scrollTop advances by the inserted-page offset');
    const newIndex = page._conversationWindow.rows.findIndex(row => row.key === 'u50');
    const newScreenTop = page.data.conversationTopSpace
      + page._conversationWindow.offsets[newIndex]
      - page._conversationWindow.offsets[page._conversationWindow.start] - applied.conversationScrollTop;
    assert.equal(newScreenTop, oldScreenTop, 'normalization changes coordinates, not the reader-visible pixel');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

// 120 行 × 100px 远超整段渲染阈值，实测后仍然走虚拟窗口 + spacer 重基准。
function measuredPage(extra) {
  const list = rows(120);
  const page = pageWith(list, Object.assign({ _lastScrollTop: 1400, _lastNativeScrollTop: 1400,
    _convClientHeight: 700 }, extra), 100);
  const initial = page._conversationWindow.patch();
  page.data = { tab: 'conversation', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  return page;
}

function rectsAt(page, rowHeight, scrollTop) {
  const top = page.data.conversationTopSpace - (scrollTop == null ? 1400 : scrollTop);
  return page.data.rows.map((row, index) => {
    const rowTop = top + index * rowHeight;
    return { top: rowTop, bottom: rowTop + rowHeight, height: rowHeight };
  });
}

test('measured height changes rebase spacers around the first visible key without writing scrollTop', () => {
  const page = measuredPage();
  const rects = rectsAt(page, 70, 1400);
  const visibleRow = rects.findIndex(rect => rect.bottom > 101 && rect.top < 799);
  const anchorIndex = page._conversationWindow.start + visibleRow;
  const oldStart = page._conversationWindow.start;
  const oldOffset = page._conversationWindow.offsets[anchorIndex];
  const oldStartOffset = page._conversationWindow.offsets[oldStart];
  const oldTopSpace = page.data.conversationTopSpace;
  const oldScreenTop = oldTopSpace + oldOffset - oldStartOffset - 1400;
  let applied;
  page.setData = patch => { applied = patch; Object.assign(page.data, patch); };
  const previousWx = global.wx;
  global.wx = {
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return { boundingClientRect: () => query }; },
        selectAll() { return { boundingClientRect: () => query }; },
        exec(callback) { callback([{ top: 100, bottom: 800 }, rects]); }
      };
      return query;
    }
  };
  try {
    page.measureConversationWindow();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  assert.equal(applied && applied.conversationScrollTop, undefined,
    'a measurement never feeds a corrective scrollTop into the native gesture');
  const newScreenTop = page.data.conversationTopSpace
    + page._conversationWindow.offsets[anchorIndex]
    - page._conversationWindow.offsets[page._conversationWindow.start] - 1400;
  assert.equal(newScreenTop, oldScreenTop, 'the same visible key keeps its old logical pixel position');
  assert.equal(page._lastScrollTop, 1400);
});

test('first-load measurement adopts native scrollTop when cached scroll state is stale', () => {
  const page = measuredPage({ _lastScrollTop: 1400, _lastNativeScrollTop: 1400 });
  const rects = rectsAt(page, 70, 520);
  let applied;
  page.setData = patch => { applied = patch; Object.assign(page.data, patch); };
  const previousWx = global.wx;
  global.wx = {
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return { boundingClientRect: () => query, scrollOffset: () => query }; },
        selectAll() { return { boundingClientRect: () => query }; },
        exec(callback) { callback([{ top: 100, bottom: 800 }, { scrollTop: 520 }, rects]); }
      };
      return query;
    }
  };
  try {
    page.measureConversationWindow();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  assert.equal(applied && applied.conversationScrollTop, undefined,
    'measuring the initial window does not issue a corrective scroll');
  assert.equal(page._lastNativeScrollTop, 520, 'the queried native offset replaces stale cached state');
  assert.equal(page._lastScrollTop, 520);
});

test('live-session entry keeps the first tail anchor and does not normalize scrollTop', () => {
  const list = rows(120);
  const page = pageWith(list, { _lastScrollTop: 1400, _lastNativeScrollTop: 1400,
    _convClientHeight: 700, _convPinned: true, _fastLiveSessionEntry: true,
    _initialConversationAnchorApplied: true, _initialConversationAnchorRecoveryPending: true }, 100);
  const initial = page._conversationWindow.patch();
  page.data = { tab: 'conversation', scrollTarget: 'conv-bottom', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  page._conversationWindow.origin = 100;
  Object.assign(page.data, page._conversationWindow.patch());
  const patches = [];
  page.setData = patch => { patches.push(patch); Object.assign(page.data, patch); };
  const rects = page.data.rows.map((_row, index) => ({
    top: index * 100, bottom: (index + 1) * 100, height: 100
  }));
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { callback([{ top: 0, bottom: 700 }, { scrollTop: 1400, scrollHeight: 3000 }, rects]); }
    };
    return query;
  } };
  try {
    page.measureConversationWindow();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  assert.equal(page._conversationWindow.origin, 100, 'entry measurement leaves the virtual origin alone');
  assert.equal(page._initialConversationAnchorApplied, true, 'the first anchor remains protected until recovery settles');
  assert.equal(page._fastLiveSessionEntry, true);
  assert.ok(patches.every(patch => patch.conversationScrollTop === undefined),
    'entry measurement never writes a compensating native scrollTop');
});

test('live-session entry absorbs measured height drift without a native position correction', () => {
  const list = rows(120);
  const page = pageWith(list, { _lastScrollTop: 1400, _lastNativeScrollTop: 1400,
    _convClientHeight: 700, _convPinned: true, _fastLiveSessionEntry: true,
    _initialConversationAnchorApplied: true, _initialConversationAnchorRecoveryPending: true }, 100);
  const initial = page._conversationWindow.patch();
  page.data = { tab: 'conversation', scrollTarget: 'conv-bottom', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  const patches = [];
  page.setData = (patch, callback) => {
    patches.push(patch);
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  const rowHeight = 2000;
  const rects = page.data.rows.map((_row, index) => ({
    top: (index - 10) * rowHeight, bottom: (index - 9) * rowHeight, height: rowHeight
  }));
  const previousWx = global.wx;
  global.wx = { createSelectorQuery() {
    const query = {
      in() { return this; },
      select() { return { boundingClientRect() { return query; }, scrollOffset() { return query; } }; },
      selectAll() { return { boundingClientRect() { return query; } }; },
      exec(callback) { callback([{ top: 0, bottom: 700 }, { scrollTop: 1400, scrollHeight: 3000 }, rects]); }
    };
    return query;
  } };
  try {
    page.measureConversationWindow();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  assert.ok(page._conversationWindow.heights.get(page.data.rows[0].key) > 100,
    'real row heights are still adopted during entry');
  assert.ok(patches.length > 0, 'spacers update to the measured geometry');
  assert.ok(patches.every(patch => patch.conversationScrollTop === undefined),
    'large initial estimate drift never feeds back into the native scroll position');
});

test('a tap measures immediately; only a real scroll defers the correction', () => {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let now = 2000, timerId = 0;
  const timers = new Map();
  const page = measuredPage({ _lastTouchAt: now - 40 });
  const rects = rectsAt(page, 70, 500);
  let applied;
  page.setData = patch => { applied = patch; Object.assign(page.data, patch); };
  const previousWx = global.wx;
  Date.now = () => now;
  global.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
  global.clearTimeout = id => timers.delete(id);
  global.wx = {
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return { boundingClientRect: () => query, scrollOffset: () => query }; },
        selectAll() { return { boundingClientRect: () => query }; },
        exec(callback) { callback([{ top: 100, bottom: 800 }, { scrollTop: 500 }, rects]); }
      };
      return query;
    }
  };
  try {
    page.measureConversationWindow();
    assert.equal(timers.size, 0, 'a tap without scrolling does not postpone the measurement');
    assert.equal(applied && applied.conversationScrollTop, undefined,
      'the disclosure measurement does not move the native scroller');
    assert.equal(page._conversationWindow.heights.get(page.data.rows[0].key), 70,
      'the tap measurement still updates row geometry immediately');
  } finally {
    Date.now = realNow;
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('measured height changes still wait for a real scroll to settle before correcting scrollTop', () => {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let now = 2000, timerId = 0;
  const timers = new Map();
  const page = measuredPage({ _lastTouchAt: now - 200, _lastConvScrollAt: now - 170 });
  const rects = rectsAt(page, 70, 500);
  let applied;
  page.setData = patch => { applied = patch; Object.assign(page.data, patch); };
  const previousWx = global.wx;
  Date.now = () => now;
  global.setTimeout = (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; };
  global.clearTimeout = id => timers.delete(id);
  global.wx = {
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return { boundingClientRect: () => query, scrollOffset: () => query }; },
        selectAll() { return { boundingClientRect: () => query }; },
        exec(callback) { callback([{ top: 100, bottom: 800 }, { scrollTop: 500 }, rects]); }
      };
      return query;
    }
  };
  try {
    page.measureConversationWindow();
    assert.equal(page._conversationWindow.heights.get(page.data.rows[7].key), 100,
      'the measurement callback does not mutate virtual geometry during touch settling');
    assert.equal(applied, undefined, 'no spacer or scrollTop patch is sent during the settling window');
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].delay, 600);

    now += 600;
    const deferred = [...timers.values()][0];
    timers.clear();
    deferred.fn();
    assert.equal(page._conversationWindow.heights.get(page.data.rows[7].key), 70,
      'cached measured heights update after touch and momentum settle');
    assert.equal(applied && applied.conversationScrollTop, undefined,
      'the settled measurement still does not write scrollTop');
  } finally {
    Date.now = realNow;
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('initial bottom anchoring remains stable while measured row heights settle', () => {
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: true,
    _initialConversationAnchorApplied: true, _convClientHeight: 700,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
  const initial = page.conversationWindowPatch(rows(30));
  page.data = { tab: 'conversation', scrollTarget: 'conv-bottom', rows: initial.rows,
    conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  let rects = page.data.rows.map((row, index) => {
    const top = 100 + index * 120;
    return { top, bottom: top + 120, height: 120 };
  });
  page._pendingHistoryFormat = new Map([['u29', 'history markdown pending']]);
  let anchors = 0;
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.refreshBottomAnchor = () => { anchors++; };
  const previousWx = global.wx;
  global.wx = {
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return { boundingClientRect: () => query }; },
        selectAll() { return { boundingClientRect: () => query }; },
        exec(callback) { callback([{ top: 100, bottom: 800 }, rects]); }
      };
      return query;
    }
  };
  try {
    page.measureConversationWindow();
    assert.equal(page._initialConversationAnchorApplied, true,
      'height corrections do not discard the still-active first-render tail anchor');
    assert.equal(anchors, 0, 'measured height corrections do not clear and replay the bottom target');

    page._pendingHistoryFormat.clear();
    page.measureConversationWindow();
    assert.equal(page._initialConversationAnchorApplied, false,
      'the initial anchor guard releases once visible formatting and geometry have settled');
    assert.equal(anchors, 1, 'the settled layout gets one final exact-bottom reconciliation');

    rects = page.data.rows.map((row, index) => {
      const top = 100 + index * 130;
      return { top, bottom: top + 130, height: 130 };
    });
    page.measureConversationWindow();
    assert.equal(anchors, 2, 'later content growth still follows the latest message');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('cache windows restore multiple local pages and preserve a paging cursor when bounded', () => {
  const events = Array.from({ length: 3000 }, (_, i) => ({ type: 'user/message', seq: i + 1, data: { text: 'Question ' + i } }));
  const cache = recentWindow({ events, rows: [], historyFormatVersion: 1, hasMore: false }, protocol, 's');
  assert.equal(cache.events.length, 2000); assert.equal(cache.rows.length, 2000);
  assert.equal(cache.events[0].seq, 1001); assert.equal(cache.nextBeforeSeq, 1001);
  assert.equal(cache.hasMore, true); assert.equal(cache.hasMoreKnown, true);
  assert.equal(cache.historyFormatVersion, 1);
  assert.equal(cache.rows.at(-1).text, 'Question 2999');
  const legacy = recentWindow({ rows: rows(2500) }, protocol, 's');
  assert.equal(legacy.rows.length, 2000); assert.equal(legacy.hasMore, true);
  assert.equal(legacy.hasMoreKnown, true, 'a truncated cache proves older rows exist');
  const boundary = recentWindow({ rows: rows(1), hasMore: false, hasMoreKnown: true }, protocol, 's');
  assert.equal(boundary.hasMoreKnown, true, 'explicit boundary metadata survives cache normalization');
  const legacyUnknown = recentWindow({ rows: rows(1), hasMore: false }, protocol, 's');
  assert.equal(legacyUnknown.hasMoreKnown, false, 'old caches with a default false are not trusted as complete');
});

test('cached rows restore without replaying a large event window on session entry', () => {
  let replays = 0;
  const countingProtocol = Object.assign({}, protocol, {
    applyEvent(...args) { replays++; return protocol.applyEvent(...args); }
  });
  const events = Array.from({ length: 3000 }, (_, i) => ({
    type: 'user/message', seq: i + 1, data: { text: 'Question ' + i }
  }));
  const cachedRows = Array.from({ length: 2000 }, (_, i) => ({
    kind: 'user', key: 'u' + (i + 1000), seq: i + 1001, text: 'Question ' + (i + 1000)
  }));
  const restored = recentWindow({ events: events.slice(-2000), rows: cachedRows, hasMore: true },
    countingProtocol, 's');
  assert.equal(replays, 0, 'a ready-to-render row snapshot avoids synchronous protocol replay');
  assert.equal(restored.rows.at(-1).text, 'Question 2999');
});
