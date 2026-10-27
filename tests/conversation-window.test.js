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
