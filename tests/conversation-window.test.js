const test = require('node:test');
const assert = require('node:assert/strict');
const { ConversationWindow } = require('../miniprogram/pages/session/utils/conversation-window');
const { recentWindow } = require('../miniprogram/utils/history-window');
const protocol = require('../miniprogram/utils/protocol');
const viewport = require('../miniprogram/pages/session/viewport-actions');
const rows = n => Array.from({ length: n }, (_, i) => ({ key: 'u' + i, kind: 'user', text: 'Message ' + i }));
test('ten thousand messages mount at most forty rows at top, middle, bottom and direct jumps', () => {
  const window = new ConversationWindow(); window.update(rows(10000));
  for (const top of [0, 500000, 999300]) {
    const patch = window.select(top, 700);
    assert.ok(patch.rows.length <= 40);
    assert.equal(patch.conversationTopSpace + patch.rows.length * 100 + patch.conversationBottomSpace, 1000000);
    assert.ok(patch.rows.some(row => row.key === 'u' + Math.floor(top / 100)));
  }
  const jump = window.select(700000, 700, 7000);
  assert.ok(jump.rows.some(row => row.key === 'u7000'));
});
test('variable height prefix offsets select the correct row including a very long reply', () => {
  const window = new ConversationWindow(); window.heights.set('u4', 5000); window.update(rows(10));
  assert.equal(window.indexAt(5399), 4); assert.equal(window.indexAt(5400), 5);
  assert.equal(window.select(4000, 700).rows.some(row => row.key === 'u4'), true);
});
test('long replies and image messages do not collapse virtual offsets to small fixed estimates', () => {
  const window = new ConversationWindow();
  window.update([
    { key: 'long', kind: 'assistant', text: 'x'.repeat(10000) },
    { key: 'image', kind: 'user', images: [{}], singleHeight: 640 },
    { key: 'group', kind: 'processGroup', processBodyVisible: true, processBodyCapped: true }
  ]);
  assert.ok(window.offsets[1] > 8000, 'long answers stay proportional beyond the old 1400px clamp');
  assert.ok(window.offsets[2] - window.offsets[1] > 300, 'a single image reserves its rendered height');
  assert.ok(window.offsets[3] - window.offsets[2] > 400, 'an open capped process reserves the scroll body');
});
test('the rendered conversation window stays stable until the viewport nears an edge', () => {
  const window = new ConversationWindow(); window.update(rows(100)); window.select(500, 400);
  assert.equal(window.shouldShiftForScroll(650, 400), false,
    'small finger movements do not replace keyed rows while scrolling');
  assert.equal(window.shouldShiftForScroll(900, 400), true,
    'the window advances before the viewport reaches its final buffered rows');
  assert.equal(window.shouldShiftForScroll(0, 400), true,
    'a fast fling beyond the current window is handled immediately');
});
test('scroll handling does not publish a new virtual slice for each crossed row', () => {
  let patches = 0;
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false,
    _lastScrollTop: 500, _convClientHeight: 400,
    setData(patch, callback) { patches++; Object.assign(this.data, patch); if (callback) callback(); },
    scheduleHistoryFormatting() {}, measureConversationWindow() {}, scheduleAttachmentThumbs() {} };
  const initial = page.conversationWindowPatch(rows(100));
  page.data = initial;

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
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false,
    _lastScrollTop: 500, _convClientHeight: 400,
    setData(patch, callback) { patches++; Object.assign(this.data, patch); if (callback) callback(); },
    scheduleHistoryFormatting() {}, measureConversationWindow() {}, scheduleAttachmentThumbs() {} };
  const initial = page.conversationWindowPatch(rows(100));
  page.data = initial;
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
test('prepending history preserves the visible anchor and offset while incoming tail does not move it', () => {
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false, _lastScrollTop: 5025 };
  const initial = rows(100); page.conversationWindowPatch(initial);
  const patch = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...initial]);
  assert.equal(patch.conversationScrollTop, 5125);
  assert.ok(patch.rows.some(row => row.key === 'u50'));
  const live = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...initial, { key: 'live', kind: 'assistant', text: 'live' }]);
  assert.equal(live.conversationScrollTop, undefined);
  assert.equal(page._lastScrollTop, 5125);
});
test('content re-estimation does not write scrollTop over a recent manual swipe', () => {
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false,
    _lastScrollTop: 5025, _lastTouchAt: Date.now() - 200 };
  const allRows = rows(100);
  page.data = page.conversationWindowPatch(allRows);
  page._conversationWindow.heights.set('u30', 200);

  const patch = page.conversationWindowPatch(allRows);
  assert.equal(patch.conversationScrollTop, undefined,
    'native scroll anchoring keeps the reader position during touch settling');
  assert.equal(page._lastScrollTop, 5025, 'the stale estimated correction is not recorded as the native position');
});
test('history prepends anchor the viewport with scroll-into-view instead of guessed scrollTop', () => {
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false, _lastScrollTop: 5025 };
  const initial = rows(100); page.conversationWindowPatch(initial);
  const patch = page.conversationWindowPatch([{ key: 'older', kind: 'user', text: 'old' }, ...initial], { anchor: true });
  assert.equal(patch.scrollTarget, 'u50');
  assert.equal(patch.scrollAnim, false);
  assert.equal(patch.conversationScrollTop, undefined);
  assert.equal(page._lastScrollTop, 5125);
});

test('measured height corrections preserve the first DOM-visible row, not the estimated index', () => {
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false, _lastScrollTop: 500, _convClientHeight: 700 };
  const allRows = rows(30);
  const initial = page.conversationWindowPatch(allRows);
  page.data = { tab: 'conversation', rows: initial.rows, conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  const viewportRect = { top: 100, bottom: 800 };
  // Estimates put row 5 at scrollTop 500, but the actual visible anchor is row 7.
  const rects = page.data.rows.map((row, index) => {
    const top = 100 + (index - 7) * 70;
    return { top, bottom: top + 70, height: 70 };
  });
  let applied;
  page.setData = patch => { applied = patch; Object.assign(page.data, patch); };
  const previousWx = global.wx;
  global.wx = {
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return { boundingClientRect: () => query }; },
        selectAll() { return { boundingClientRect: () => query }; },
        exec(callback) { callback([viewportRect, rects]); }
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
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false, _lastScrollTop: 500, _convClientHeight: 700 };
  const initial = page.conversationWindowPatch(rows(30));
  page.data = { tab: 'conversation', rows: initial.rows, conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  const rects = page.data.rows.map((row, index) => {
    const top = 100 + (index - 7) * 70;
    return { top, bottom: top + 70, height: 70 };
  });
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

test('measured height changes wait for touch and momentum to settle before correcting scrollTop', () => {
  const realNow = Date.now;
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let now = 2000, timerId = 0;
  const timers = new Map();
  const page = { ...viewport, data: {}, _renderSessionId: 's', _convPinned: false,
    _lastScrollTop: 500, _convClientHeight: 700, _lastTouchAt: now - 200,
    _lastConvScrollAt: now - 170 };
  const initial = page.conversationWindowPatch(rows(30));
  page.data = { tab: 'conversation', rows: initial.rows, conversationTopSpace: initial.conversationTopSpace,
    conversationBottomSpace: initial.conversationBottomSpace };
  const rects = page.data.rows.map((row, index) => {
    const top = 100 + (index - 7) * 70;
    return { top, bottom: top + 70, height: 70 };
  });
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
    assert.equal(page._conversationWindow.heights.get(page.data.rows[7].key), undefined,
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
