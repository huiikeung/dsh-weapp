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
    const anchorRelativeTop = rects[visibleRow].top - viewportTop;
    completeMeasure([{ top: 0, bottom: 300 }, { scrollTop: 1260 }, rects]);

    const expectedTop = page._conversationWindow.offsets[anchorIndex] - anchorRelativeTop + (1400 - 1260);
    const effectiveTop = applied.conversationScrollTop === undefined ? 1400 : applied.conversationScrollTop;
    assert.equal(effectiveTop, expectedTop,
      'the anchor compensation includes momentum and measured spacer geometry');
    assert.ok(page.data.rows.some(row => row.key === 'u23'), 'the row under the latest fling position remains mounted');
    assert.equal(page._lastNativeScrollTop, applied.conversationScrollTop === undefined ? 1400 : expectedTop,
      'the native position remains at the latest fling position unless geometry needs correction');
    assert.equal(page._conversationWindow.heights.get('u23'), rowHeight,
      'real row heights are cached before the virtual slice changes');
    assert.equal(page._conversationWindow.offsets[anchorIndex] - expectedTop, anchorRelativeTop - 140,
      'the same visible row stays at the screen position reached by the native fling');
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
    const anchorRelativeTop = rects[visibleRow].top - viewportTop;
    completeMeasure([{ top: 0, bottom: 300 }, { scrollTop: measuredTop }, rects]);

    const expectedTop = page._conversationWindow.offsets[anchorIndex] - anchorRelativeTop + (1400 - measuredTop);
    const effectiveTop = applied.conversationScrollTop === undefined ? 1400 : applied.conversationScrollTop;
    assert.equal(effectiveTop, expectedTop,
      'geometry correction preserves the current visible row without returning to the query snapshot');
    assert.ok(page.data.rows.some(row => row.key === 'u23'),
      'the rendered window follows the latest native position even before its scroll event arrives');
    assert.equal(page._lastNativeScrollTop, applied.conversationScrollTop === undefined ? 1400 : expectedTop);
    assert.equal(page._conversationWindow.heights.get('u23'), rowHeight,
      'real row heights are cached instead of estimated heights');
    assert.equal(page._conversationWindow.offsets[anchorIndex] - effectiveTop, anchorRelativeTop - (1400 - measuredTop),
      'the visible row follows native momentum during the active gesture');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});

test('window-shift compensation accounts for the conversation content padding', () => {
  // 真实布局：行 screen top = 视口 top + 内容 padding(8) + 占位 - scrollTop。
  // 补偿公式若漏掉 padding，每次平移都会多发一次 8px 的滚动 → 「多滑一截」。
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
    const measuredTop = 1260;
    page._lastNativeScrollTop = 1400;
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
    assert.equal(page._lastScrollTop, 1200, 'no correction is recorded as the native position');
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
    completeMeasure([{ top: viewportTop, bottom: 300 }, { scrollTop: measuredTop }, rects]);

    assert.equal(applied.conversationScrollTop, undefined,
      'the anchored compensation is a no-op for consistent geometry, so momentum is never interrupted');
    assert.equal(page._lastNativeScrollTop, 1200, 'the native position is left to the running gesture');
    assert.ok(page.data.rows.some(row => row.key === 'u23'), 'the row under the fling position is mounted');
    assert.equal(page._conversationWindow.heights.get('u23'), 70, 'measured heights are committed');
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
  assert.equal(patch.conversationScrollTop, 5125);
  assert.ok(patch.rows.some(row => row.key === 'u50'));
  const live = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...list, { key: 'live', kind: 'assistant', text: 'live' }]);
  assert.equal(live.conversationScrollTop, undefined);
  assert.equal(page._lastScrollTop, 5125);
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

test('history prepends anchor the viewport with scroll-into-view instead of guessed scrollTop', () => {
  const list = rows(100);
  const page = pageWith(list, { _lastScrollTop: 5025 }, 100);
  page._conversationWindow.heights.set('older', 100);
  const patch = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...list], { anchor: true });
  assert.equal(patch.scrollTarget, 'u50');
  assert.equal(patch.scrollAnim, false);
  assert.equal(patch.conversationScrollTop, undefined);
  assert.equal(page._lastScrollTop, 5125);
});

// 120 行 × 100px 远超整段渲染阈值，实测后仍然走虚拟窗口 + 校正这条路径。
function measuredPage(extra) {
  const list = rows(120);
  const page = pageWith(list, Object.assign({ _lastScrollTop: 500, _convClientHeight: 700 }, extra), 100);
  page.data = { tab: 'conversation', rows: page.conversationWindowPatch(list).rows,
    conversationTopSpace: 0, conversationBottomSpace: 10100 };
  return page;
}

function rectsAt(page, rowHeight) {
  return page.data.rows.map((row, index) => {
    const top = 100 + (index - 7) * rowHeight;
    return { top, bottom: top + rowHeight, height: rowHeight };
  });
}

test('measured height corrections preserve the first DOM-visible row, not the estimated index', () => {
  const page = measuredPage();
  const rects = rectsAt(page, 70);
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

  assert.equal(applied.conversationScrollTop, 290,
    'seven preceding rows each shrink by 30px, so the visible row stays at the same screen position');
  assert.equal(page._lastScrollTop, 290);
});

test('first-load height corrections use native scrollTop when cached scroll state is stale', () => {
  const page = measuredPage();
  const rects = rectsAt(page, 70);
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

  assert.equal(applied.conversationScrollTop, 310,
    'the correction is applied to the current native offset, not an earlier cached offset');
  assert.equal(page._lastScrollTop, 310);
});

test('a tap measures immediately; only a real scroll defers the correction', () => {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let now = 2000, timerId = 0;
  const timers = new Map();
  const page = measuredPage({ _lastTouchAt: now - 40 });
  const rects = rectsAt(page, 70);
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
    assert.equal(applied.conversationScrollTop, 290,
      'the disclosure height correction lands in the same frame as the tap');
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
  const rects = rectsAt(page, 70);
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
    assert.equal(applied.conversationScrollTop, 290,
      'the measured visible-row anchor keeps the viewport stationary when offsets change');
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
  assert.equal(cache.hasMore, true); assert.equal(cache.historyFormatVersion, 1);
  assert.equal(cache.rows.at(-1).text, 'Question 2999');
  const legacy = recentWindow({ rows: rows(2500) }, protocol, 's');
  assert.equal(legacy.rows.length, 2000); assert.equal(legacy.hasMore, true);
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
