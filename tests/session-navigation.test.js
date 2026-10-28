const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition; const calls = [], ticks = [], timers = new Map(), patches = [];
  let timerId = 0;
  const store = { state: { sessions: [], archivedSessionIds: [] }, sessionState: { sessionId: 's1', running: true },
    subscribe: () => () => {}, openSession: (...args) => calls.push(['open', ...args]),
    loadOlderHistory: () => calls.push(['loadOlderHistory']), client: {
    renameSession: (...args) => calls.push(['rename', ...args]), archiveSession: (...args) => calls.push(['archive', ...args]), cancelSession: (...args) => calls.push(['cancel', ...args])
  } };
  const wx = { hideKeyboard: () => calls.push(['hideKeyboard']), nextTick: fn => ticks.push(fn),
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 60, height: 32, left: 300 }),
    showModal: options => calls.push(['modal', options]), navigateTo: options => calls.push(['navigateTo', options]), navigateBack: () => calls.push(['back']) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx, console,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    require: name => name.endsWith('/store') ? store : name.endsWith('/haptics')
      ? { vibrate: () => calls.push(['haptic']), tick: () => calls.push(['tick']) }
      : name.endsWith('/theme') ? { applyTo() {} }
        : name.endsWith('/status-appearance') ? { read: () => ({}), view: () => ({}) }
          : name.endsWith('/proc-icon-style') ? { read: () => ({}), view: () => ({}) }
            : require(path.resolve(path.dirname(file), name)) });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) {
    patches.push(patch);
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = this.data;
      parts.slice(0, -1).forEach((part, i) => { if (target[part] == null) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {}; target = target[part]; });
      target[parts.at(-1)] = value;
    }
  },
    startScrollPolling: () => calls.push(['poll']), stopScrollPolling: () => calls.push(['stopPoll']), refreshBottomAnchor() {} };
  return { page, store, calls, ticks, timers, patches };
}
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
test('in-progress task icon follows the theme (ink on light, white on dark)', () => {
  const { page, store } = fixture();
  const rows = () => (page.data.tasks || []).map((t) => ({ status: t.status, icon: t.icon }));
  const drive = (theme) => {
    store.state = { connection: 'connected', sessions: [] };
    store.sessionState = Object.assign(store.sessionState, {
      sessionId: 's1', running: false,
      tasks: [
        { content: '正在做的任务', status: 'in_progress' },
        { content: '还没开始的任务', status: 'pending' },
        { content: '做完的任务', status: 'completed' },
      ],
    });
    page.data.theme = theme;
    page.syncFromStore({ app: store.state, session: store.sessionState });
    return rows();
  };
  const light = drive('light');
  assert.deepEqual(light.map((r) => r.icon), ['pinwheel-ink.png', 'dotted-gray.png', 'check-green.png']);
  const dark = drive('dark');
  assert.deepEqual(dark.map((r) => r.icon), ['pinwheel-white.png', 'dotted-gray.png', 'check-green.png']);
  // 两个变体资源都要存在（纯黑图标在深色背景下不可见）
  for (const icon of ['pinwheel-ink.png', 'pinwheel-white.png']) {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram/assets/icons', icon)), icon);
  }
});

test('opening a different session paints a loading shell before restoring its cache', () => {
  const { page, store, calls, ticks, timers } = fixture();
  assert.equal(page.data.historyLoading, true, 'the first page frame is a loading state, not a blank panel');
  let syncs = 0;
  page.syncLayoutStyles = () => {};
  page.syncFromStore = () => { syncs += 1; };
  page.onLoad({ id: 's2', title: 'Target', preset: 'cordis' });

  assert.equal(page.data.historyLoading, true);
  assert.equal(page.data.historyLoaded, false);
  assert.equal(page._pendingInitialSessionOpen, true);
  assert.equal(syncs, 0, 'the previous conversation is not projected during navigation');
  assert.equal(calls.some(call => call[0] === 'open'), false, 'cache restore is deferred');
  assert.equal(store.sessionState.sessionId, 's1', 'the old store session remains active during the transition');
  assert.equal(ticks.length, 1, 'initialization begins as soon as the loading shell reaches the view layer');

  ticks.shift()();
  assert.deepEqual(calls.find(call => call[0] === 'open'), ['open', 's2', 'Target', 'cordis']);
  assert.equal(page._pendingInitialSessionOpen, false);
  assert.equal(page._preferImmediateStoreSync, true, 'the first selected-session snapshot can paint without another debounce window');
  page.scheduleStoreSync({ session: { sessionId: 's2', rows: [] } });
  assert.equal([...timers.values()].some(item => item.delay === 0), true, 'cached rows start projecting during the page transition');
  assert.equal(page._preferImmediateStoreSync, false);

  const sameSession = fixture();
  sameSession.page.syncLayoutStyles = () => {};
  sameSession.page.syncFromStore = () => {};
  sameSession.page.onLoad({ id: 's1', reopen: '1' });
  assert.equal(sameSession.page._pendingInitialSessionOpen, true, 'home reopens retain their refresh semantics even for the active id');
  sameSession.ticks.shift()();
  assert.deepEqual(sameSession.calls.find(call => call[0] === 'open'), ['open', 's1', '', null]);
});

test('large outline selection patches nearby blur effects and auto-loads at the older edge', () => {
  const { page, patches, calls, store } = fixture();
  page.setData(page.turnNavigatorPatch(Array.from({ length: 2000 }, (_, i) => ({ kind: 'user', key: 'u' + i, text: 'Q' + i }))));
  page.applyTurnIndex(0, false); patches.length = 0; page.applyTurnIndex(1000);
  assert.ok(Object.keys(patches[0]).length <= 50);
  assert.ok(!('turnNavWidths' in patches[0]));
  assert.ok(!page.data.turnNavRowStyles[1000].includes('blur'), '不再使用高开销的逐行模糊滤镜');
  assert.match(page.data.turnNavRowStyles[1000], /opacity:1\.00/);
  page._turnListRect = { top: 100, height: 300, rowHeight: 38, spacer: 131 };
  page.data.turnNavOpen = true;
  page.data.hasMoreHistory = true;
  page.data.historyLoading = false;
  store.sessionState.nextBeforeSeq = 400;
  page._turnScrollTop = 650;
  page.onTurnListScroll({ detail: { scrollTop: 700, scrollHeight: 1000, clientHeight: 300 } });
  assert.equal(page.data.turnNavActiveIndex, 18, 'the row nearest the viewport center becomes active');
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1);
  page.onTurnListScroll({ detail: { scrollTop: 700, scrollHeight: 1000, clientHeight: 300 } });
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1, 'scroll events do not duplicate an in-flight page request');
  page.onTurnListScroll({ detail: { scrollTop: 650, scrollHeight: 1000, clientHeight: 300 } });
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1, 'scrolling back toward newer turns does not reload history');
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const outlineStart = xml.indexOf('class="turn-overlay');
  const outline = xml.slice(outlineStart, xml.indexOf('<!-- 更多菜单', outlineStart));
  assert.ok(outline.includes('bindscroll="onTurnListScroll"'));
  assert.ok(!outline.includes('bindtap="loadOlder"'), 'normal history loading is driven by scroll, not a manual button');
  // 空白区域（列表外/列表内非行位置）点击都要关闭大纲浮层。
  assert.match(outline, /class="turn-overlay-inner"[^>]*catchtap="closeTurnNavigator"/);
  assert.equal((xml.match(/bindscrolltoupper="loadOlder"/g) || []).length, 2);
});
test('horizontal gestures switch cached panels with feedback while vertical/cancelled gestures do not', () => {
  const { page, calls } = fixture();
  page.updateDockInset = () => {};
  let projections = 0; page.trajectoryPatch = () => { projections++; return {}; };
  const gesture = (x, y, dx, dy) => {
    page.onPanelTouchStart({ touches: [{ clientX: x, clientY: y }] });
    page.onPanelTouchMove({ touches: [{ clientX: x + dx, clientY: y + dy }] });
    page.onPanelTouchEnd({ changedTouches: [{ clientX: x + dx, clientY: y + dy }] });
  };
  gesture(300, 100, -150, 10); assert.equal(page.data.tab, 'trajectory');
  gesture(100, 100, 150, 10); assert.equal(page.data.tab, 'conversation');
  assert.equal(projections, 1, 'only entering trajectory activates its projection');
  assert.equal(calls.filter(call => call[0] === 'haptic').length, 2);
  gesture(300, 100, -30, 120); assert.equal(page.data.tab, 'conversation');
  page.onPanelTouchStart({ touches: [{ clientX: 300, clientY: 100 }] });
  page.onPanelTouchCancel();
  page.onPanelTouchEnd({ changedTouches: [{ clientX: 50, clientY: 100 }] });
  assert.equal(page.data.tab, 'conversation');
  page.data.moreSheetOpen = true; gesture(300, 100, -150, 10);
  assert.equal(page.data.tab, 'conversation');
});
test('navigator caches every turn and updates an open list while older history arrives', () => {
  const { page, calls, store } = fixture();
  const rows = Array.from({ length: 80 }, (_, index) => [
    { kind: 'user', key: 'u' + index, text: 'Question ' + index },
    { kind: 'assistant', key: 'a' + index, text: 'Answer ' + index }
  ]).flat();
  store.sessionState.rows = rows;
  page.setData(page.turnNavigatorPatch(rows));
  page.openTurnNavigator();
  assert.equal(page.data.turnNavActiveIndex, 0, 'default selection is ready before measurement');
  assert.equal(page.data.turnNavWidths, undefined, 'the removed slider has no width state');
  assert.equal(page.data.turnNavItems.length, 80);
  assert.ok(page.data.turnNavVisibleItems.length < page.data.turnNavItems.length, 'the outline renders only a viewport window');
  assert.equal(page.data.turnNavItems[0].key, 'u79');
  page.applyTurnIndex(20, false);
  const selected = page.data.turnNavItems[20].key;
  page.setData(page.turnNavigatorPatch([{ kind: 'user', key: 'older', text: 'Oldest' }, ...rows]));
  assert.equal(page.data.turnNavItems.length, 81);
  assert.equal(page.data.turnNavItems[page.data.turnNavActiveIndex].key, selected);
  page._turnListRect = { top: 0, rowHeight: 38, activeRowHeight: 64 };
  page.onTurnListScroll({ detail: { scrollTop: 80 } });
  assert.equal(page.data.turnNavActiveIndex, 2, 'scrolling keeps the center row selected');
  assert.equal(calls.filter(call => call[0] === 'tick').length, 1);
  page.applyTurnIndex(2); assert.equal(calls.filter(call => call[0] === 'tick').length, 1);
  page.onTurnScrubCancel(); page.onTurnScrubEnd(); assert.equal(page.data.turnNavOpen, true);
});
test('turn outline keeps cached nodes across openings and only adds newly observed turns', () => {
  const { page, store } = fixture();
  const original = Array.from({ length: 4 }, (_, index) => [
    { kind: 'user', key: 'u' + index, text: 'Question ' + index },
    { kind: 'assistant', key: 'a' + index, text: 'Answer ' + index }
  ]).flat();
  store.sessionState.rows = original;
  page.setData(page.turnNavigatorPatch(original));
  page.closeTurnNavigator();

  const newest = [
    { kind: 'user', key: 'u4', text: 'Question 4' },
    { kind: 'assistant', key: 'a4', text: 'Answer 4' }
  ];
  // Simulate a bounded source window: old cached turns are no longer in the snapshot.
  store.sessionState.rows = [original.at(-2), original.at(-1), ...newest];
  page.setData(page.turnNavigatorPatch(store.sessionState.rows));
  page.closeTurnNavigator();
  page.openTurnNavigator();

  assert.equal(page.data.turnNavItems.length, 5);
  assert.deepEqual(Array.from(page.data.turnNavItems, item => item.key), ['u4', 'u3', 'u2', 'u1', 'u0']);
  assert.equal(new Set(page.data.turnNavItems.map(item => item.key)).size, 5, 'reopening never duplicates cached nodes');
});
test('opening the outline automatically pages through all history without a page, turn, or byte cap', () => {
  const { page, calls, store, timers } = fixture();
  store.sessionState.running = false;
  store.sessionState.hasMoreHistory = true;
  store.sessionState.nextBeforeSeq = 100;
  page.data.turnNavOpen = true;
  page.data.turnNavItems = Array.from({ length: 40 }, (_, i) => ({ key: 'u' + i }));
  page.startTurnNavigatorWarmup();
  assert.equal(page.data.turnNavWarming, true);
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1);

  // More than the old 8-page / 500-turn / 4-MB limits must still be filled
  // automatically, one cursor-advancing page at a time.
  for (let pageNumber = 1; pageNumber <= 12; pageNumber += 1) {
    store.sessionState.nextBeforeSeq = 100 - pageNumber * 10;
    store.sessionState.hasMoreHistory = pageNumber < 12;
    store.sessionState.historyLastPageBytes = 400 * 1024;
    page.data.turnNavItems = Array.from({ length: 40 + pageNumber * 50 }, (_, i) => ({ key: 'u' + i }));
    page.pumpTurnNavigatorWarmup();
    if (pageNumber < 12) {
      const timer = [...timers.entries()].find(([, value]) => value.delay === 180);
      assert.ok(timer, 'next page is scheduled after the previous page completes');
      timers.delete(timer[0]); timer[1].fn();
    }
  }
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 12);
  assert.equal(page.data.turnNavItems.length, 640);
  assert.equal(page.data.turnNavWarming, false, 'warm-up ends only after the gateway reports no older history');
  assert.match(page.data.turnNavWarmText, /完整历史/);
  assert.equal(page._turnWarmup, null);
});
test('opening before the first history snapshot waits, then starts warming once pagination metadata arrives', () => {
  const { page, calls, store } = fixture();
  store.sessionState.running = false;
  store.sessionState.hasMoreHistory = false;
  page.data.turnNavOpen = true;
  page.startTurnNavigatorWarmup();
  assert.equal(page._turnWarmupStarted, false);
  store.sessionState.hasMoreHistory = true;
  store.sessionState.nextBeforeSeq = 70;
  page.startTurnNavigatorWarmup();
  assert.equal(page._turnWarmupStarted, true);
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1);
});
test('outline warm-up continues at a low rate even when the panel closes', () => {
  const { page, calls, store, timers } = fixture();
  store.sessionState.hasMoreHistory = true;
  store.sessionState.nextBeforeSeq = 90;
  page.data.turnNavOpen = true;
  page.startTurnNavigatorWarmup();
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1);
  assert.ok([...timers.values()].some(timer => timer.delay === 900), 'active-turn history reads are throttled');
  store.sessionState.nextBeforeSeq = 80;
  page.pumpTurnNavigatorWarmup();
  assert.equal(page.data.turnNavWarming, true, 'history backfill stays active while the live event stream continues');
  assert.equal(page._turnWarmup.waiting, false);
  assert.ok([...timers.values()].some(timer => timer.delay === 900));
  page.closeTurnNavigator();
  assert.equal(page.data.turnNavOpen, false);
  assert.equal(page.data.turnNavWarming, true);
  assert.ok(page._turnWarmup);
  page.pumpTurnNavigatorWarmup();
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 2);
  store.sessionState.hasMoreHistory = false;
  page.pumpTurnNavigatorWarmup();
  assert.equal(page._turnWarmup, null);
});

test('entering a session fills the outline before its first opening', () => {
  const { page, store, calls } = fixture();
  store.sessionState = { sessionId: 's1', running: false, rows: [{ kind: 'user', key: 'u1', seq: 50, text: 'Latest' }],
    historyState: 'loaded', hasMoreHistory: true, nextBeforeSeq: 50 };
  page.syncFromStore({ app: store.state, session: store.sessionState });
  assert.equal(page.data.turnNavOpen, false);
  assert.equal(page.data.turnNavItems[0].key, 'u1');
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1);
});

test('persisted full outline survives page recreation, merges new nodes and isolates hosts', () => {
  const cache = new Map();
  const setup = () => {
    const f = fixture(); f.store.state.activeID = 'host-a';
    f.store.getTurnOutline = id => JSON.parse(cache.get(f.store.state.activeID + id) || '[]');
    f.store.saveTurnOutline = (id, items) => cache.set(f.store.state.activeID + id, JSON.stringify(items));
    return f;
  };
  const first = setup();
  first.page.turnNavigatorPatch(Array.from({ length: 600 }, (_, i) => ({ kind: 'user', key: 'u' + i, seq: i, text: 'Q' + i })));
  const next = setup();
  next.store.sessionState.rows = [{ kind: 'user', key: 'u600', seq: 600, text: 'New' }];
  next.page.openTurnNavigator();
  assert.equal(next.page.data.turnNavItems.length, 601);
  assert.equal(next.page.data.turnNavItems[0].key, 'u600');
  assert.equal(next.page.data.turnNavItems.at(-1).key, 'u0');
  next.page.closeTurnNavigator(); next.page.openTurnNavigator();
  assert.equal(next.page.data.turnNavItems.length, 601);
  next.store.state.activeID = 'host-b';
  assert.equal(next.page.turnNavigatorPatch([]).turnNavItems.length, 0);
});

test('unchanged nodes do not rewrite the persistent outline on each opening', () => {
  const { page, store } = fixture(); let writes = 0;
  store.saveTurnOutline = () => { writes++; };
  const rows = [{ kind: 'user', key: 'u1', seq: 1, text: 'Question' }];
  store.sessionState.rows = rows;
  page.setData(page.turnNavigatorPatch(rows));
  page.openTurnNavigator(); page.closeTurnNavigator(); page.openTurnNavigator();
  assert.equal(writes, 1);
  rows.push({ kind: 'user', key: 'u2', seq: 2, text: 'New question' });
  page.setData(page.turnNavigatorPatch(rows));
  assert.equal(writes, 2);
  assert.equal(page.data.turnNavItems.length, 2);
});

test('cached outline target waits for its message page before jumping', () => {
  const { page, store, calls } = fixture();
  page._conversationRows = [{ key: 'new' }];
  store.sessionState.hasMoreHistory = true; store.sessionState.nextBeforeSeq = 20;
  page.data.turnNavOpen = true;
  page.jumpToTurn(event('key', 'old'));
  assert.equal(page._pendingTurnJump, 'old');
  assert.equal(page.data.turnNavOpen, true, 'do not silently jump to an unmounted anchor');
  assert.equal(calls.filter(call => call[0] === 'loadOlderHistory').length, 1);
});

test('background history arrival completes the selected cached-node jump', () => {
  const { page, store, calls } = fixture();
  store.sessionState = { sessionId: 's1', running: false, rows: [{ kind: 'user', key: 'new', seq: 20, text: 'New' }],
    historyState: 'loaded', hasMoreHistory: true, nextBeforeSeq: 20 };
  page.syncFromStore({ app: store.state, session: store.sessionState });
  page.data.turnNavOpen = true;
  page.jumpToTurn(event('key', 'old'));
  page.revealConversationRow = key => calls.push(['reveal', key]);
  store.sessionState.rows.unshift({ kind: 'user', key: 'old', seq: 1, text: 'Old' });
  store.sessionState.hasMoreHistory = false; store.sessionState.nextBeforeSeq = 1;
  page.syncFromStore({ app: store.state, session: store.sessionState });
  assert.equal(page._pendingTurnJump, null);
  assert.equal(page.data.turnNavOpen, false);
  assert.ok(calls.some(call => call[0] === 'reveal' && call[1] === 'old'));
});

test('outline has no right-hand slider or native scrollbar', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.ok(!xml.includes('turn-scrub-rail-cell'));
  assert.ok(!xml.includes('turn-scrub-row-line'));
  assert.ok(!xml.includes('turn-scrub-dot'));
  const start = xml.indexOf('class="turn-scrub-list"');
  assert.match(xml.slice(start - 100, start), /show-scrollbar="\{\{false\}\}"/);
});
test('turn wheel keeps the centered row highlighted while scrolling and only jumps when tapped', () => {
  const { page, calls, store } = fixture();
  const rows = Array.from({ length: 50 }, (_, i) => ({ kind: 'user', key: 'u' + i, text: 'Question ' + i }));
  store.sessionState.rows = rows;
  page.setData(page.turnNavigatorPatch(rows));
  page.openTurnNavigator();
  page._turnListRect = { top: 100, height: 400, rowHeight: 38, spacer: 181 };
  page.onTurnScrubStart({ touches: [{ clientY: 120 }] });
  assert.equal(page.data.turnNavActiveIndex, 0);
  page.onTurnListScroll({ detail: { scrollTop: 38 } });
  assert.equal(page.data.turnNavActiveIndex, 1);
  assert.ok(!page.data.turnNavRowStyles[1].includes('blur'));
  assert.ok(!page.data.turnNavRowStyles[0].includes('blur'));
  assert.match(page.data.turnNavRowStyles[1], /opacity:1\.00/);
  assert.equal(calls.filter(call => call[0] === 'tick').length, 1);
  page.onTurnScrubEnd();
  assert.equal(page.data.turnNavOpen, true, 'scrolling does not close the wheel selector');
  page.revealConversationRow = key => calls.push(['reveal', key]);
  page.jumpToTurn(event('key', page.data.turnNavItems[1].key));
  assert.equal(page.data.turnNavOpen, false, 'tapping a turn performs the jump');
  assert.ok(calls.some(call => call[0] === 'reveal'));
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const list = xml.slice(xml.indexOf('id="turn-scrub-list"'), xml.indexOf('<view class="turn-scrub-inner">'));
  assert.ok(list.includes('bindscroll="onTurnListScroll"'));
  assert.ok(list.includes('76vh'), 'the list keeps a stable viewport so its center does not shift');
  assert.ok(xml.includes('turnNavTopPadPx') && xml.includes('turnNavBottomPadPx'), 'virtual spacers preserve the full scroll range and centered endpoints');
  assert.ok(xml.includes('wx:for="{{turnNavVisibleItems}}"'), 'long outlines do not mount every row at once');
  assert.ok(xml.includes('catchtap="jumpToTurn"'));
});
test('trajectory tab clears keyboard/popovers but preserves draft and never measures hidden dock', () => {
  const { page, calls, ticks } = fixture();
  Object.assign(page.data, { draft: 'unsent', images: [{ id: 'image' }], kbHeight: 320, statsPopOpen: true, showContextSheet: true });
  page.switchTab(event('tab', 'trajectory'));
  assert.equal(page.data.tab, 'trajectory'); assert.equal(page.data.kbHeight, 0); assert.equal(page.data.trajectoryStyle, '');
  assert.equal(page.data.statsPopOpen, false); assert.equal(page.data.draft, 'unsent'); assert.equal(page.data.images.length, 1);
  page.updateDockInset(); assert.equal(ticks.length, 0);
  page.onKeyboardHeight({ detail: { height: 320 } }); assert.equal(page.data.kbHeight, 0);
  assert.ok(calls.some(call => call[0] === 'hideKeyboard'));
  page.updateDockInset = () => calls.push(['measure']); page.switchTab(event('tab', 'conversation'));
  assert.ok(calls.some(call => call[0] === 'measure')); assert.equal(page.data.draft, 'unsent');
});
test('more menu expands rename, stats and files inside the same sheet and dispatches existing actions', () => {
  const { page, calls, store } = fixture(); page.data.tab = 'trajectory';
  page.moreActions(); assert.equal(page.data.moreSheetOpen, true); assert.equal(page.data.morePane, 'menu');
  // 查看统计：在当前弹层内展开，不再另开底部弹窗
  page.selectMoreAction(event('action', 'stats'));
  assert.equal(page.data.moreSheetOpen, true); assert.equal(page.data.morePane, 'stats');
  assert.equal(page.data.statsSheet.length, 3);
  page.backToMoreMenu(); assert.equal(page.data.morePane, 'menu');
  // 重命名：同样在当前弹层内展开
  page.selectMoreAction(event('action', 'rename'));
  assert.equal(page.data.moreSheetOpen, true); assert.equal(page.data.morePane, 'rename');
  page.onRenameInput({ detail: { value: ' New name ' } });
  page.confirmRename();
  assert.equal(page.data.moreSheetOpen, false); assert.equal(page.data.morePane, 'menu');
  assert.equal(page.data.navTitle, 'New name'); assert.deepEqual(calls.at(-1), ['rename', 's1', 'New name']);
  // 工作区文件：也在「更多」弹层内展开
  page.moreActions(); page.selectMoreAction(event('action', 'files'));
  assert.equal(page.data.moreSheetOpen, true); assert.equal(page.data.morePane, 'files');
  assert.equal(page.data.filesSheetOpen, false, '不再另开文件底部弹窗');
  assert.ok(!calls.some(call => call[0] === 'navigateTo'), '不应再跳转文件页面');
  page.backToMoreMenu(); assert.equal(page.data.morePane, 'menu');
  // 取消回合：确认弹窗
  page.moreActions(); page.selectMoreAction(event('action', 'browsePlugins'));
  assert.equal(page.data.moreSheetOpen, false);
  assert.equal(calls.at(-1)[0], 'navigateTo');
  assert.equal(calls.at(-1)[1].url, '/pages/plugins/plugins?tab=discover');
  page.moreActions(); page.selectMoreAction(event('action', 'createPlugin'));
  assert.equal(calls.at(-1)[1].url, '/pages/plugins/plugins?action=create');
  const menuXml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.match(menuXml, /data-action="browsePlugins"[^>]*>[\s\S]*?浏览更多插件/);
  assert.match(menuXml, /data-action="createPlugin"[^>]*>[\s\S]*?创建你的插件/);
  // 更多菜单里的插件行用灰色变体：和其他行的 -gray 图标一致（ink 近黑会明显更深）
  assert.ok(menuXml.includes("theme === 'dark' ? 'pinwheel-white.png' : 'pinwheel-gray.png'"), 'browse plugins uses the gray pinwheel on light theme');
  assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram/assets/icons/pinwheel-gray.png')), 'pinwheel-gray.png');
  page.moreActions(); store.sessionState.running = false; page.selectMoreAction(event('action', 'cancel'));
  assert.equal(page.data.moreSheetOpen, true); assert.ok(!calls.some(call => call[0] === 'cancel'));
  store.sessionState.running = true; page.selectMoreAction(event('action', 'cancel'));
  assert.equal(page.data.confirmSheet, 'cancel'); page.runConfirmSheet();
  assert.deepEqual(calls.at(-1), ['cancel', 's1']);
  // 归档：确认弹窗
  page.moreActions(); page.selectMoreAction(event('action', 'archive'));
  assert.equal(page.data.confirmSheet, 'archive'); page.closeConfirmSheet();
  assert.ok(!calls.some(call => call[0] === 'archive'));
  page.moreActions(); page.selectMoreAction(event('action', 'archive')); page.runConfirmSheet();
  assert.ok(calls.some(call => call[0] === 'archive'));
});

test('more sheet handle expands on tap or upward drag and collapses again', () => {
  const { page } = fixture();
  page.moreActions(); assert.equal(page.data.moreSheetExpanded, false);
  page.moreSheetGrabStart({ touches: [{ clientY: 120 }] });
  page.moreSheetGrabEnd();
  assert.equal(page.data.moreSheetExpanded, true, 'tap on the handle floats the sheet up');
  page.moreSheetGrabStart({ touches: [{ clientY: 120 }] });
  page.moreSheetGrabEnd();
  assert.equal(page.data.moreSheetExpanded, false, 'tapping again restores the compact sheet');
  page.moreSheetGrabStart({ touches: [{ clientY: 160 }] });
  page.moreSheetGrabMove({ touches: [{ clientY: 40 }] });
  page.moreSheetGrabEnd();
  assert.equal(page.data.moreSheetExpanded, true, 'dragging the handle up expands it');
  page.moreSheetGrabStart({ touches: [{ clientY: 40 }] });
  page.moreSheetGrabMove({ touches: [{ clientY: 160 }] });
  page.moreSheetGrabEnd();
  assert.equal(page.data.moreSheetExpanded, false, 'dragging down collapses it');
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.ok(xml.includes('catchtouchstart="moreSheetGrabStart"'));
  assert.match(xml, /class="sheet session-menu \{\{moreSheetExpanded \? 'expanded' : ''\}\}"/);
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.match(css, /\.sheet\.session-menu\.expanded\s*\{[^}]*height: 86vh;/);
});

test('session quick switch filters recent sessions and switches in place', () => {
  const { page, store, calls } = fixture();
  store.state.sessions = [
    { sessionId: 's1', title: 'Current', updatedAt: 100, running: true },
    { sessionId: 's2', title: 'Second task', updatedAt: 200, agentPreset: 'standard' },
    { sessionId: 's3', title: 'Archived', updatedAt: 300 }
  ];
  store.state.archivedSessionIds = ['s3'];
  page.openSessionSwitcher();
  assert.equal(page.data.sessionSwitcherOpen, true);
  assert.deepEqual(Array.from(page.data.sessionSwitcherItems.filter(item => !item.header).map(item => item.sessionId)), ['s2', 's1']);
  assert.equal(page.data.sessionSwitcherItems.find(item => item.sessionId === 's1').current, true);
  page.onSessionSwitcherSearch({ detail: { value: 'second' } });
  assert.deepEqual(Array.from(page.data.sessionSwitcherItems.filter(item => !item.header).map(item => item.sessionId)), ['s2']);
  page.switchSessionFromSwitcher(event('sessionId', 's2'));
  assert.equal(page.data.sessionSwitcherOpen, false);
  assert.deepEqual(calls.find(call => call[0] === 'open'), ['open', 's2', 'Second task', 'standard']);
  assert.equal(page.sessionId, 's2');
});

test('quick switch opens as a full-screen overlay like the turn navigator', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  // 三横线按钮改为「对话节点定位」，会话快捷切换移入更多菜单并以蒙版呈现
  assert.ok(xml.includes('bindtap="openTurnNavigator"'));
  assert.ok(xml.includes('data-action="switchSessions"'));
  // 三横线按钮固定在右上角导航栏（和更多菜单同一排），只出现一次。
  assert.equal((xml.match(/session-switch-trigger/g) || []).length, 1, 'the trigger lives in exactly one place');
  assert.match(xml, /wx:if="\{\{rows\.length\}\}" class="session-switch-trigger/,
    'the turn navigator is hidden until the conversation has messages');
  // 顺序：nav-actions 开标签 → 更多菜单 → 三横线按钮（都在同一个导航容器里）
  const iNav = xml.indexOf('class="nav-actions"');
  const iMore = xml.indexOf('class="nav-more', iNav);
  const iSwitch = xml.indexOf('class="session-switch-trigger', iNav);
  assert.ok(iNav > 0 && iMore > iNav && iSwitch > iMore,
    'the trigger sits in the top-right nav, after the more menu');
  assert.ok(!/copyAssistantText[^\n]*session-switch-trigger/.test(xml),
    'the trigger is no longer in the reply footer');
  assert.ok(xml.includes('class="session-switch-overlay'));
  assert.ok(!xml.includes('session-switch-handle-zone'), 'overlay no longer uses a bottom-sheet handle');
  assert.ok(xml.includes('bindtap="switchSessionFromSwitcher"'));
  assert.match(css, /\.session-switch-overlay\s*\{[^}]*position: fixed;[^}]*inset: 0;/, 'overlay covers the viewport');
  assert.match(css, /\.session-switch-overlay\s*\{[^}]*background: rgba\(8, 10, 16/, 'overlay dims the page like the turn navigator');
  assert.match(css, /\.session-switch-panel\s*\{[^}]*max-height: 90vh;/, 'panel still caps at 90vh');
  // 图标是原来的 CSS 三横线（三个 view），按钮 64rpx 圆钮。
  assert.match(xml, /class="session-switch-lines" aria-hidden="true"><view\/><view\/><view\/><\/view>/,
    'the glyph is three view bars again');
  assert.match(css, /\.session-switch-trigger\s*\{[^}]*width: 64rpx;[^}]*height: 64rpx;/, 'trigger is the original 64rpx round button');
  // 字形保持原样：100% / 78% / 90%，右对齐
  assert.match(css, /\.session-switch-lines view:nth-child\(2\)\s*\{\s*width: 78%;/, 'middle bar stays at the original 78%');
  assert.match(css, /\.session-switch-lines view:nth-child\(3\)\s*\{\s*width: 90%;/, 'bottom bar stays at the original 90%');
  assert.match(css, /\.session-switch-lines\s*\{[^}]*align-items: flex-end;/, 'bars stay right-aligned as before');
  // 线加粗到 4rpx、间距收到 6rpx（字形不变）
  assert.match(css, /\.session-switch-lines view\s*\{[^}]*height: 3rpx;/, 'bars are the requested 3rpx thick');
  assert.match(css, /\.session-switch-lines\s*\{[^}]*width: 30rpx;/, 'bars are shortened to a 30rpx glyph');
  assert.match(css, /\.session-switch-lines\s*\{[^}]*gap: 8rpx;/, 'bar gap is 8rpx: tighter than the old 12rpx, looser than 6rpx');
  // 同一选择器只允许出现一次（避免旧值被后一条规则悄悄覆盖）
  const topLevel = []; let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) topLevel.push(css.slice(start, i).trim()); depth++; }
    if (css[i] === '}' && --depth === 0) start = i + 1;
  }
  assert.equal(topLevel.filter(selector => selector === '.session-switch-lines').length, 1, 'one base glyph rule, excluding responsive overrides');
  assert.equal(topLevel.filter(selector => selector === '.session-switch-lines view').length, 1, 'one base bar rule');
  assert.ok(!fs.existsSync(path.join(__dirname, '../miniprogram/assets/icons/turn-nav.svg')), 'the throwaway SVG asset is gone');
});

test('quick switch overlay keeps search, list and in-place switching', () => {
  const { page, store, calls } = fixture();
  store.state.sessions = [
    { sessionId: 's1', title: 'Current', updatedAt: 100, running: true },
    { sessionId: 's2', title: 'Second task', updatedAt: 200, agentPreset: 'standard' }
  ];
  page.openSessionSwitcher();
  assert.equal(page.data.sessionSwitcherOpen, true);
  page.onSessionSwitcherSearch({ detail: { value: 'second' } });
  assert.deepEqual(Array.from(page.data.sessionSwitcherItems.filter(item => !item.header).map(item => item.sessionId)), ['s2']);
  page.switchSessionFromSwitcher(event('sessionId', 's2'));
  assert.equal(page.data.sessionSwitcherOpen, false);
  assert.equal(page.sessionId, 's2');
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.match(xml, /session-switch-state \{\{item.current \? 'current' : ''\}\}/);
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.match(css, /\.session-switch-state\.current\s*\{[^}]*background: #31b77a;/);
  assert.ok(calls.find(call => call[0] === 'open'));
});

module.exports = { fixture, event };
test('more sheet omits the session subtitle and hosts rename/stats/files panes in place', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  const menu = xml.slice(xml.indexOf('class="sheet session-menu '), xml.indexOf('class="session-switch-mask'));
  assert.ok(menu.includes("ui['更多']")); assert.ok(menu.includes('class="sheet-close-x"'));
  assert.ok(!menu.includes('navTitle'));
  assert.ok(menu.includes("morePane === 'rename'"), '重命名在当前弹层内展开');
  assert.ok(menu.includes("morePane === 'stats'"), '统计在当前弹层内展开');
  assert.ok(menu.includes("morePane === 'files'"), '工作区文件在当前弹层内展开');
  assert.ok(!xml.includes('statsSheetOpen'), '统计不再单独开弹窗');
  assert.ok(!xml.includes('renameSheetOpen'), '重命名不再单独开弹窗');
  assert.match(xml, /class="trace-native-row[^"]*" bindtap="openTraceDetail"/);
  assert.ok(xml.includes('catchtap="openTraceRequest"'), 'request dot must not also open the parent detail');
  // 返回按钮是图标 + 圆形描边，不带填充底；关闭按钮统一为圆形 × 图标并右对齐
  assert.match(css, /\.session-menu-back\s*\{[^}]*background: transparent;[^}]*border: 1rpx solid var\(--border\);/);
  assert.match(css, /\.session-menu-close\s*\{[^}]*justify-content: flex-end;/);
  assert.ok(xml.includes('class="session-menu-close" bindtap="closeMoreActions" role="button"><view class="sheet-close-x">'));
  // 工作区文件底部弹窗保留给输入区「引用工作区文件」入口
  assert.ok(xml.includes('wx:if="{{filesSheetOpen}}"'));
});

test('trajectory summary metrics switch focus modes and timeline selection follows its lane', () => {
  const { page, ticks } = fixture();
  const rows = [
    { kind: 'event', key: 'user-1', badge: 'USER', turn: 1, durationMs: 100 },
    { kind: 'event', key: 'model-1', badge: 'ASSISTANT', turn: 1, durationMs: 300 },
    { kind: 'event', key: 'tool-1', badge: 'TOOL', turn: 1, durationMs: 100 },
    { kind: 'event', key: 'user-2', badge: 'USER', turn: 2, durationMs: 100 },
    { kind: 'event', key: 'model-2', badge: 'ASSISTANT', turn: 2, durationMs: 300 },
    { kind: 'event', key: 'tool-2', badge: 'SUBTOOL', turn: 2, durationMs: 100 }
  ];
  page._traceList = rows;
  page._traceByKey = new Map(rows.map(row => [row.key, row]));
  page._traceIndexByKey = new Map(rows.map((row, index) => [row.key, index]));
  page._traceOffsets = [0, 80, 160, 240, 320, 400, 480];
  page._traceTotalRpx = 480;
  page.data.trajectory = rows;
  page.data.traceOverview = require('../miniprogram/utils/trajectory-presentation').overview(rows);
  const target = page.data.traceOverview.lanes.find(lane => lane.id === 'tools').segments.find(segment => segment.key === 'tool-2');
  page.selectTraceAtPercent(target.centerPct, 'tools');
  assert.equal(page.data.traceFocusKey, 'tool-2');
  assert.equal(page.data.traceFocusMode, 'duration');
  assert.equal(page.data.traceFocusTouched, true);
  assert.equal(page.data.traceCursorPercent, target.centerPct, 'the cursor remains at the release position');
  assert.deepEqual(Array.from(page.data.traceOverview.lanes.map(lane => lane.id)), ['input', 'model', 'tools'], 'selecting a call keeps every lane visible');
  assert.ok(page.data.traceOverview.lanes.find(lane => lane.id === 'tools').segments.find(segment => segment.key === 'tool-2').selected);
  page.jumpToTrace(event('key', 'user-2'));
  assert.equal(page.data.traceFocusMode, 'duration', 'selecting a process does not switch the timeline metric mode');
  assert.equal(page.data.traceFocusTurn, null);

  while (ticks.length) ticks.shift()();
  assert.equal(page.data.traceScrollTarget, 'trace-user-2', 'the latest timeline selection wins the pending scroll target');
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.match(xml, /traceFocusMode === 'duration' \? 'active' : ''[^>]*bindtap="selectTraceMetric" data-mode="duration"/);
  assert.match(xml, /traceFocusMode === 'turns' \? 'active' : ''[^>]*bindtap="selectTraceMetric" data-mode="turns"/);
  assert.match(xml, /traceFocusMode === 'calls' \? 'active' : ''[^>]*bindtap="selectTraceMetric" data-mode="calls"/);
  assert.ok(xml.includes('data-lane=\"{{lane.id}}\"'), 'timeline taps retain their selected lane');
  assert.match(xml, /traceMetricTargetKey === item\.key \? 'metric-target' : ''/);
  assert.ok(!xml.includes('wx:else class="trace-dot-hit"'), 'only request-boundary rows receive a request dot');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/styles/trajectory.wxss'), 'utf8');
  assert.ok(!xml.includes('class="trace-rail"'), 'there is no separate left-side rail');
  assert.ok(!css.includes('.trace-rail'), 'the left-side rail has no styling');
  assert.match(css, /\.trace-overview-head-label\.active, \.trace-overview-stat\.active\s*\{[^}]*background:\s*var\(--trace-tint-select\);/,
    'the selected metric gets a subtle background');
  assert.ok(!xml.includes('trace-spine-line') && !css.includes('.trace-spine-line'), 'the left-side vertical spine is absent');
  assert.match(css, /\.trace-native-row::after\s*\{[^}]*bottom:\s*0;[^}]*height:\s*1rpx;/,
    'each event row ends with a fine horizontal separator');
  assert.match(css, /\.trace-dot-hit\s*\{[^}]*top:\s*0;[^}]*bottom:\s*0;/,
    'request dots are centered on the event-row separator');
  assert.match(css, /\.trace-node-dot\.request\s*\{[^}]*transform:\s*translateY\(50%\);/,
    'request dot centers sit directly on each event-row separator');
  assert.match(css, /\.trace-turn-line\s*\{[^}]*top:\s*0;/, 'each round begins below its separator');
  assert.match(css, /\.trace-turn-label\s*\{[^}]*margin-top:\s*6rpx;[^}]*margin-left:\s*-10rpx;/,
    'the round label sits below its separator and leans left of the content edge');
  assert.match(css, /\.trace-turn-line\s*\{[^}]*background:\s*var\(--trace-line\);/,
    'the round separator uses the faintest ledger line');
  assert.ok(!css.includes('.trace-overview { flex-shrink: 0; padding: 20rpx 36rpx 16rpx; background: var(--fill); border-bottom'),
    'the overview no longer draws a second separator where the round line already sits');
  assert.match(xml, /<view wx:if="\{\{item\.request\}\}" class="trace-dot-hit" catchtap="openTraceRequest"/,
    'request dots remain individually clickable');
  assert.ok(xml.includes('catchtouchmove="onTraceTimelineTouchMove"'), 'timeline dragging moves the vertical cursor');
  assert.ok(xml.includes('class="trace-overview-cursor"'), 'the timeline renders a cursor');
  assert.ok(xml.includes('dsh-checklist-dark.svg') && xml.includes('dsh-process-tool-dark.svg'), 'round and call metrics have theme-aware icons');
  assert.ok(!xml.includes('class="trace-overview-duration'), 'the call metric has no trailing duration value');

  page.selectTraceMetric({ currentTarget: { dataset: { mode: 'turns' } } });
  assert.equal(page.data.traceFocusMode, 'turns');
  assert.equal(page.data.traceFocusTurn, 2, 'round mode focuses the latest round unless a round is already selected');
  assert.deepEqual(Array.from(page.data.traceOverview.lanes.flatMap(lane => lane.segments.map(segment => segment.key))), ['user-2', 'model-2', 'tool-2']);
  assert.equal(page.data.traceFocusTouched, false);
  const roundTarget = page.data.traceOverview.lanes.find(lane => lane.id === 'model').segments[0];
  page.selectTraceAtPercent(roundTarget.centerPct, 'model');
  assert.equal(page.data.traceFocusMode, 'turns', 'scrubbing the round timeline keeps round mode active');
  assert.equal(page.data.traceFocusTurn, 2);
  page.selectTraceMetric({ currentTarget: { dataset: { mode: 'turns' } } });
  assert.equal(page.data.traceFocusTurn, 1, 'tapping the active round metric advances to the next round');
  page.selectTraceMetric({ currentTarget: { dataset: { mode: 'calls' } } });
  assert.equal(page.data.traceFocusMode, 'calls');
  assert.deepEqual(Array.from(page.data.traceOverview.lanes.map(lane => lane.id)), ['tools']);
  assert.deepEqual(Array.from(page.data.traceOverview.lanes[0].segments.map(segment => segment.key)), ['tool-2']);
  const callTarget = page.data.traceOverview.lanes[0].segments[0];
  page.selectTraceAtPercent(callTarget.centerPct, 'tools');
  assert.equal(page.data.traceFocusMode, 'calls', 'scrubbing the calls timeline keeps calls mode active');
  page.selectTraceMetric({ currentTarget: { dataset: { mode: 'calls' } } });
  assert.deepEqual(Array.from(page.data.traceOverview.lanes[0].segments.map(segment => segment.key)), ['tool-1'],
    'tapping the active calls metric advances to the next tool call');
  page.selectTraceMetric({ currentTarget: { dataset: { mode: 'duration' } } });
  assert.deepEqual(Array.from(page.data.traceOverview.lanes.map(lane => lane.id)), ['input', 'model', 'tools']);
});

test('timeline taps select the nearest process and large trace jumps mount the target window first', () => {
  const { page, ticks, timers } = fixture();
  const rows = Array.from({ length: 130 }, (_, index) => ({
    kind: 'event', key: 'event-' + index, badge: index % 3 === 0 ? 'USER' : index % 3 === 1 ? 'ASSISTANT' : 'TOOL',
    turn: Math.floor(index / 3) + 1, durationMs: 100, seq: index + 1
  }));
  page._traceList = rows;
  page._traceByKey = new Map(rows.map(row => [row.key, row]));
  page._traceIndexByKey = new Map(rows.map((row, index) => [row.key, index]));
  page._traceOffsets = [0]; rows.forEach((row, index) => { page._traceOffsets[index + 1] = page._traceOffsets[index] + (row.kind === 'turn' ? 60 : 80); });
  page._traceTotalRpx = page._traceOffsets[rows.length];
  page._traceWindowStart = 0;
  page.data.trajectory = rows.slice(0, 80);
  page.data.traceOverview = require('../miniprogram/utils/trajectory-presentation').overview(rows);

  const target = page.data.traceOverview.lanes.flatMap(lane => lane.segments).find(segment => segment.key === 'event-100');
  page.selectTraceAtPercent(target.centerPct);
  assert.equal(page.data.traceFocusKey, 'event-100');
  assert.equal(page.data.traceFocusTouched, true);
  assert.ok(page.data.traceOverview.lanes.flatMap(lane => lane.segments).some(segment => segment.dimmed));
  assert.ok(page.data.trajectory.some(row => row.key === 'event-100'), 'off-window process is rendered before scrolling');
  assert.equal(page.data.traceSpacerTopRpx, 50 * 80, 'the tail window clamps to the final eighty rows');
  while (ticks.length) ticks.shift()();
  assert.equal(page.data.traceScrollTarget, 'trace-event-100');
  if (page._traceHighlightTimer) { clearTimeout(page._traceHighlightTimer); page._traceHighlightTimer = null; }
  timers.clear();
});

test('detail cache parses only once for repeated clicks and no Markdown for raw tab', () => {
  const { page } = fixture(); const markdown = require('../miniprogram/utils/markdown');
  const original = markdown.parse; let parses = 0;
  markdown.parse = text => { parses++; return original(text); };
  try {
    const item = { kind: 'event', key: 'ev-1', badge: 'ASSISTANT', label: 'Assistant', seq: 1, outputText: '## Result\n\n' + 'Message. '.repeat(2000), completed: true,
      sourceRecords: Array.from({ length: 2000 }, (_, seq) => ({ seq, data: { text: 'stream chunk' } })) };
    page._renderSessionId = 's1'; page._traceByKey = new Map([[item.key, item]]);
    page.data.trajectory = [require('../miniprogram/utils/trajectory-presentation').listRow(item)];
    page.openTraceDetail(event('key', item.key)); const first = parses;
    assert.equal(first, 1); assert.equal(page.data.traceDetail.sourceRecords, undefined);
    page.closeTraceDetail(); page.openTraceDetail(event('key', item.key)); assert.equal(parses, first);
    page.selectTraceDetailTab(event('id', 'raw')); assert.equal(parses, first);
    page._traceByKey.set(item.key, { ...item, sourceRecords: [...item.sourceRecords] });
    page.traceSelectionPatch([]); assert.equal(parses, first);
    page._traceByKey.set(item.key, { ...item, outputText: '**new result**' });
    const patch = page.traceDetailPatch(page._traceByKey.get(item.key), 'summary');
    assert.equal(parses, first + 1); assert.ok(patch.traceDetailSection.text.includes('new result'));
  } finally { markdown.parse = original; }
});

const compiler = require('./helpers/wechat-wcc.cjs');
test('compiled template retains hidden panels and pre-mounts the menu in both themes', { skip: !compiler }, t => {
  const os = require('node:os'); const { execFileSync } = require('node:child_process');
  const root = path.resolve(__dirname, '../miniprogram');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-template-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'session.js');
  execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
  const context = vm.createContext({ window: {}, console }); vm.runInContext(fs.readFileSync(output, 'utf8'), context);
  const render = context.$gwx('pages/session/session.wxml');
  const { page } = fixture();
  const prefs = require('../miniprogram/utils/ui-preferences').snapshot();
  for (const theme of ['light', 'dark']) {
    const data = { ...page.data, ...prefs, theme, themeClass: 'theme-' + theme, moreSheetOpen: true, trajectoryMounted: true };
    const conversation = JSON.stringify(render({ ...data, tab: 'conversation' }, {}, {}));
    const trajectory = JSON.stringify(render({ ...data, tab: 'trajectory' }, {}, {}));
    assert.ok(conversation.includes('composer-input')); assert.ok(trajectory.includes('composer-input'), 'retain native textarea and draft without rendering it');
    assert.ok(trajectory.includes('session-panel-hidden')); assert.ok(trajectory.includes('trajectory-panel'));
    assert.ok(conversation.includes('trajectory-panel'), 'retain timeline nodes for repeat switches');
    const closed = JSON.stringify(render({ ...data, moreSheetOpen: false }, {}, {}));
    const unformatted = JSON.stringify(render({ ...data, rows: [{ kind: 'assistant', key: 'old', text: '旧记录立即可见', blocks: [] }] }, {}, {}));
    assert.ok(unformatted.includes('assistant-plain-text'));
    assert.ok(unformatted.includes('旧记录立即可见'));
    assert.ok(closed.includes('session-menu-mask ')); assert.ok(!closed.includes('session-menu-mask is-open'));
    assert.ok(conversation.includes('session-menu-mask is-open'));
    for (const tree of [conversation, trajectory]) {
      assert.ok(tree.includes('session-menu'));
      for (const label of ['重命名会话', '查看统计', '工作区文件', '取消当前回合', '归档会话']) assert.ok(tree.includes(label));
    }
  }
});

test('fold arrow follows persistent expansion until a second tap', () => {
  const { page, patches } = fixture();
  const key = 'process-a/tools/call';
  page.toggleFold(event('key', key));
  assert.equal(page.data.folds[key], true);
  page.toggleFold(event('key', key));
  assert.equal(page.data.folds[key], false);
  assert.deepEqual(Object.keys(patches[0]), ['folds.' + key]);
});

test('detailed mode shows the live process while standard mode collapses each group to a heading', () => {
  const { buildEntries } = require('../miniprogram/pages/session/utils/conversation-workflow');
  const policy = require('../miniprogram/pages/session/utils/work-step-presentation');
  const source = () => ([
    { kind: 'user', key: 'u', text: '任务' },
    { kind: 'assistant', key: 'a', turn: 1, text: '先说明', reasoning: '想一下',
      tools: [{ callId: 'c', key: 't', name: 'read', status: 'done', argumentsText: '{}' }] }
  ]);
  // 详细模式：对话过程中不分组，过程照常展开
  const detailed = buildEntries(source(), { running: true });
  policy.apply(detailed, { mode: 'detailed', timing: 'completion' }, {}, [], true);
  const liveGroup = detailed.find(row => row.kind === 'processGroup');
  const narration = detailed.find(row => row.kind === 'assistant' && row.processNarration);
  assert.ok(liveGroup && narration, 'narration becomes an independent row beside the group');
  assert.equal(liveGroup.processBodyVisible, true, 'detailed shows the process during the conversation');
  assert.equal(liveGroup.processBodyCapped, true, 'and the live process rides in the capped scroll container');
  // 标准模式：每组折叠成一个标题，点组头当场展开
  const standard = buildEntries(source(), { running: true });
  const folds = policy.apply(standard, { mode: 'standard', timing: 'completion' }, {}, [], true);
  const group = standard.find(row => row.kind === 'processGroup');
  assert.equal(group.processBodyVisible, false, 'standard collapses the group to its heading');
  const { page } = fixture();
  page.data.rows = standard;
  page.data.folds = folds;
  page.toggleFold(event('key', group.key));
  assert.equal(page.data.folds[group.key], true);
  assert.equal(page.data.rows[standard.indexOf(group)].processBodyVisible, true, 'the body mounts on the tap itself');
  assert.equal(page.data.rows[standard.indexOf(group)].processBodyCapped, true, 'standard keeps the capped scroll body');
});

test('repeat tab switches and menu opening send no history and preserve scroll position', () => {
  const { page, store, patches, calls, ticks } = fixture();
  store.sessionState.trajectory = [{ key: 'ev1', kind: 'event', badge: 'USER', label: 'User', seq: 1, text: 'hello' }];
  page.data.rows = [{ key: 'a1', text: 'long reply'.repeat(1000) }];
  page._convPinned = false; page._lastScrollTop = 240;
  page.updateDockInset = () => {};
  page.switchTab(event('tab', 'trajectory'));
  assert.equal(page.data.trajectoryMounted, true);
  const initial = JSON.stringify(page.data.trajectory);
  page.switchTab(event('tab', 'conversation'));
  assert.equal(page._convPinned, false); assert.equal(page._lastScrollTop, 240); assert.equal(ticks.length, 0);
  patches.length = 0;
  page.switchTab(event('tab', 'trajectory'));
  assert.equal(patches.length, 1);
  assert.ok(!Object.keys(patches[0]).some(key => /^(rows|trajectory\[|traceOverview)/.test(key)));
  assert.equal(JSON.stringify(page.data.trajectory), initial);
  patches.length = 0; page.moreActions();
  assert.equal(patches.length, 1); assert.ok(!('rows' in patches[0]));
  assert.ok(!calls.some(call => call[0] === 'hideKeyboard'), 'no native keyboard roundtrip without focus');
});

test('stream snapshots coalesce and yield during taps without losing the newest state', () => {
  const { page, timers } = fixture(); const rendered = [];
  page.syncFromStore = snapshot => rendered.push(snapshot);
  page.scheduleStoreSync({ session: { title: 'old' } });
  page.scheduleStoreSync({ session: { title: 'latest' } });
  assert.equal(timers.size, 1);
  page.moreActions();
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.ok(timer.delay >= 100);
  timers.clear(); timer.fn();
  assert.equal(rendered.length, 1); assert.equal(rendered[0].session.title, 'latest');
  page.scheduleStoreSync({ session: { title: 'after unload' } });
  const stale = [...timers.values()][0];
  page.onUnload(); assert.equal(timers.size, 0);
  stale.fn(); assert.equal(rendered.length, 1);
});

test('stream projections wait for an active history scroll to settle', () => {
  const { page, timers } = fixture(); const rendered = [];
  page.data.tab = 'conversation';
  page._convPinned = false;
  page._lastConvScrollAt = Date.now();
  page.syncFromStore = snapshot => rendered.push(snapshot);
  page.scheduleStoreSync({ session: { title: 'during scroll' } });

  let [timerId, timer] = [...timers.entries()][0];
  timers.delete(timerId); timer.fn();
  assert.equal(rendered.length, 0, 'row projection does not rewrite visible WXML during the swipe');
  assert.ok(timers.size, 'the newest snapshot remains queued while scrolling');

  page._lastConvScrollAt = Date.now() - 200;
  [timerId, timer] = [...timers.entries()][0];
  timers.delete(timerId); timer.fn();
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].session.title, 'during scroll');
});

test('typing prioritizes input and measures dock only when actual textarea height changes', () => {
  const { page, timers } = fixture(); let measured = 0;
  page.updateDockInset = () => { measured++; };
  for (const value of ['测', '测试', '测试输入']) page.onDraftInput({ detail: { value, cursor: value.length } });
  assert.equal(measured, 0); assert.equal(page.data.draft, '测试输入');
  assert.equal(page.data.canSend, true); assert.ok(page._interactionUntil > Date.now());
  page.onComposerLineChange({ detail: { height: 32 } });
  page.onComposerLineChange({ detail: { height: 32 } });
  // 测量经 120ms 防抖合并：重复同高不重测，且只有一次挂起任务。
  const runDebounced = () => [...timers.entries()].filter(([, entry]) => entry.delay === 120)
    .forEach(([id, entry]) => { timers.delete(id); entry.fn(); });
  assert.ok(timers.size >= 1, 'linechange measures through a 120ms debounce');
  runDebounced();
  assert.equal(measured, 1);
  page.onComposerLineChange({ detail: { height: 64 } });
  runDebounced();
  assert.equal(measured, 2);
});

test('hidden conversations discard scheduled projection without losing source updates', () => {
  const { page, timers } = fixture(); const rendered = [];
  page.syncFromStore = value => rendered.push(value);
  page.scheduleStoreSync({ session: { title: 'pending' } });
  const late = [...timers.values()][0]; page.onHide();
  late.fn(); page.scheduleStoreSync({ session: { title: 'hidden' } });
  assert.equal(timers.size, 0); assert.equal(rendered.length, 0);
});
