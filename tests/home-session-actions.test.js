// Home session list actions: long-press opens an anchored menu on the row
// (workspace-picker style) instead of a native action sheet, and a left swipe
// reveals rename / archive buttons on the row itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferences = require('../miniprogram/utils/ui-preferences');

const pageFile = path.resolve(__dirname, '../miniprogram/pages/home/home.js');
const wxml = fs.readFileSync(pageFile.replace(/home\.js$/, 'home.wxml'), 'utf8');
const wxss = fs.readFileSync(pageFile.replace(/home\.js$/, 'home.wxss'), 'utf8');

function fixture(sessions, options) {
  const opts = options || {};
  let definition;
  const calls = [];
  const modals = [];
  const sheets = [];
  const store = {
    state: { connection: 'connected', sessions: sessions || [], workspaces: [] },
    client: {
      archiveSession(id) { calls.push(['archive', id]); },
      renameSession(id, title) { calls.push(['rename', id, title]); },
      requestSessions() { calls.push(['refresh']); }
    },
    openSession(...args) { calls.push(['open', ...args]); },
    updateSearch() {}
  };
  const wx = {
    getStorageSync: () => undefined,
    setStorageSync() {},
    removeStorageSync() {},
    getMenuButtonBoundingClientRect: () => ({ top: 60, height: 32 }),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 44, safeArea: { bottom: 667 } }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 44 }),
    getAppBaseInfo: () => ({ theme: 'dark' }),
    getSystemSetting: () => ({}),
    connectSocket: () => null,
    showToast() {},
    showModal(options) { modals.push(options); if (options && options.success) options.success({ confirm: true, content: '新标题' }); },
    showActionSheet(options) { sheets.push(options); },
    createSelectorQuery: () => ({
      in() { return this; },
      select() { return this; },
      boundingClientRect(cb) { cb(opts.rect === undefined ? { left: 40, top: 300, width: 295, height: 60 } : opts.rect); return this; },
      exec() { return this; }
    }),
    navigateTo(options) { calls.push(['navigate', options.url]); if (opts.navigateFail) options.fail(); },
    navigateBack() {},
    stopPullDownRefresh() {},
    setNavigationBarTitle() {},
    onThemeChange() {}
  };
  vm.runInNewContext(fs.readFileSync(pageFile, 'utf8'), {
    Page: (value) => { definition = value; },
    wx,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    require: (name) => {
      if (name === '../../utils/store') return store;
      if (name === '../../utils/theme') return { applyTo() {}, getMode: () => 'dark' };
      if (name === '../../utils/ui-preferences') return preferences;
      if (name === '../../utils/haptics') return { tick() {}, vibrate() {} };
      return require(path.resolve(path.dirname(pageFile), name));
    }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  return { page, calls, modals, sheets, store };
}

const sessions = [
  { sessionId: 's1', displayTitle: '会话一', idLabel: '刚刚', running: false },
  { sessionId: 's2', displayTitle: '会话二', idLabel: '昨天', running: false }
];

test('long press opens the anchored session menu instead of a native action sheet', () => {
  const { page, modals, sheets } = fixture(sessions);
  page.data.displaySessions = sessions;
  page.sessionActions({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(sheets.length, 0, 'the native action sheet is gone');
  assert.equal(page.data.sessionMenuOpen, true);
  assert.equal(page.data.sessionMenuId, 's2');
  assert.equal(page.data.sessionMenuTitle, '会话二');
  assert.ok(page.data.popTop > 0 && page.data.popWidth > 0, 'the menu is anchored on the row');
  assert.match(wxml, /class="ws-pop session-menu"/);
  assert.match(wxml, /bindtap="sessionMenuAction" data-action="rename"/);
  assert.match(wxml, /bindtap="sessionMenuAction" data-action="archive"/);
  assert.match(wxml, /id="session-row-\{\{index\}\}"/, 'the row has a stable id selector');
  assert.match(wxml, /session-row-hidden/, 'the pressed row is hidden while its menu is open');
  assert.match(wxss, /\.session-row-hidden[^{]*\{[^}]*visibility:\s*hidden/);

  page.sessionMenuAction({ currentTarget: { dataset: { action: 'rename' } } });
  assert.equal(page.data.sessionMenuOpen, false);
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, preferences.t('重命名会话'));
});

test('opening a conversation pauses the home renderer and initializes the store only once', () => {
  const { page, calls } = fixture(sessions);
  let paused = false;
  page.selectComponent = () => ({ pause() { paused = true; } });
  page.openSession({ currentTarget: { dataset: { id: 's1', title: '会话一', preset: 'standard' } } });
  assert.equal(page.data.oceanActive, false);
  assert.equal(paused, true);
  assert.equal(page._homeHidden, true, 'store emissions cannot rebuild the home list during navigation');
  page.openSession({ currentTarget: { dataset: { id: 's2' } } });
  assert.deepEqual(calls, [
    ['open', 's1', '会话一', 'standard'],
    ['navigate', '/pages/session/session?id=s1']
  ]);
});

test('failed session navigation restores the home and allows retry', () => {
  const { page, calls } = fixture(sessions, { navigateFail: true });
  let syncs = 0; page.syncFromStore = () => { syncs++; };
  const event = { currentTarget: { dataset: { id: 's1' } } };
  page.openSession(event);
  assert.equal(page._homeHidden, false);
  assert.equal(page._openingSession, false);
  assert.equal(page.data.oceanActive, true);
  assert.equal(syncs, 1);
  page.openSession(event);
  assert.equal(calls.filter(call => call[0] === 'navigate').length, 2);
});

test('home formats only the newest twelve sessions without reordering the store', () => {
  let titlesRead = 0;
  const source = Array.from({ length: 2000 }, (_, i) => ({
    sessionId: 's' + i, updatedAt: i + 1,
    get title() { titlesRead++; return 'Session ' + i; }
  }));
  const { page, store } = fixture(source);
  page.syncSessionStatusPolling = () => {};
  page.loadCostMeterSummary = () => {};
  page.syncHostUI = () => {};
  page.syncFromStore({ app: store.state });
  assert.equal(page.data.displaySessions.length, 12);
  assert.equal(page.data.displaySessions[0].sessionId, 's1999');
  assert.equal(page.data.displaySessions[11].sessionId, 's1988');
  assert.equal(titlesRead, 12, 'offscreen rows do not incur title/time formatting');
  assert.equal(store.state.sessions[0].sessionId, 's0');
});

test('the menu falls back to the long-press point when the row rect is unavailable', () => {
  const { page } = fixture(sessions, { rect: null });
  page.data.displaySessions = sessions;
  page.sessionActions({ currentTarget: { dataset: { index: 1 } }, touches: [{ clientX: 200, clientY: 500 }] });
  assert.equal(page.data.sessionMenuOpen, true);
  // 弹窗以触点为中心：top = 500 - height/2（height = 2×84rpx + 32rpx = 100px）
  assert.equal(Math.round(page.data.popTop), 450);
  assert.equal(page.data.popLeft, 200 - page.data.popWidth / 2, 'centered on the touch x');
});

test('the session menu archive action confirms before archiving', () => {
  const { page, modals, calls } = fixture(sessions);
  page.data.displaySessions = sessions;
  page.sessionActions({ currentTarget: { dataset: { index: 0 } } });
  page.sessionMenuAction({ currentTarget: { dataset: { action: 'archive' } } });
  assert.equal(page.data.sessionMenuOpen, false);
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, preferences.t('归档会话'));
  assert.deepEqual(calls.filter((call) => call[0] === 'archive'), [['archive', 's1']]);
});

test('a left swipe reveals rename and archive and a tap dismisses it', () => {
  const { page } = fixture(sessions);
  page.data.displaySessions = sessions;
  page._swipeActionPx = 150; // 300rpx on a 375px screen
  page.onSessionTouchStart({ currentTarget: { dataset: { id: 's1', index: 0 } }, touches: [{ clientX: 300, clientY: 400 }] });
  page.onSessionTouchMove({ touches: [{ clientX: 240, clientY: 401 }] });
  page.onSessionTouchMove({ touches: [{ clientX: 150, clientY: 402 }] });
  assert.equal(page.data.swipeId, 's1');
  assert.equal(page.data.swipeOffset, 150);
  assert.match(wxml, /class="session-swipe/);
  assert.match(wxml, /catchtap="sessionSwipeAction" data-action="rename"/);
  assert.match(wxml, /catchtap="sessionSwipeAction" data-action="archive"/);
  assert.match(wxml, /class="session-actions \{\{swipeId === item\.sessionId \? 'show' : ''\}\}"/,
    'only the swiped row shows the action layer');
  assert.match(wxss, /\.session-actions\s*\{[^}]*visibility:\s*hidden/);
  assert.match(wxss, /\.session-actions\.show\s*\{[^}]*visibility:\s*visible/);
  assert.match(wxss, /\.session-action\.rename\s*\{[^}]*rgba\(46,\s*107,\s*230/);
  assert.match(wxss, /\.session-action\.archive\s*\{[^}]*rgba\(214,\s*69,\s*69/);

  page.openSession({ currentTarget: { dataset: { id: 's1' } } });
  assert.equal(page.data.swipeId, '', 'tapping an open row dismisses the actions');
  assert.equal(page.data.swipeOffset, 0);
});

test('a short horizontal drag snaps back and vertical scrolling is untouched', () => {
  const { page } = fixture(sessions);
  page.data.displaySessions = sessions;
  page._swipeActionPx = 150;
  page.onSessionTouchStart({ currentTarget: { dataset: { id: 's2', index: 1 } }, touches: [{ clientX: 200, clientY: 300 }] });
  page.onSessionTouchMove({ touches: [{ clientX: 170, clientY: 340 }] });
  assert.equal(page.data.swiping, false, 'a mostly vertical drag never locks the list scroll');
  assert.equal(page.data.swipeId, '');
  page.onSessionTouchEnd();
  assert.equal(page.data.swiping, false);
  assert.equal(page.data.swipeId, '');
});

test('a right swipe that closes the row actions does not open the drawer', () => {
  const { page } = fixture(sessions);
  page.data.displaySessions = sessions;
  page._swipeActionPx = 150;
  page.data.swipeId = 's1'; // 操作按钮已展开
  page.onSessionTouchStart({ currentTarget: { dataset: { id: 's1', index: 0 } }, touches: [{ clientX: 300, clientY: 400 }] });
  page.onContentTouchStart({ touches: [{ clientX: 300, clientY: 400 }] });
  page.onSessionTouchMove({ touches: [{ clientX: 380, clientY: 401 }] });
  page.onSessionTouchEnd();
  page.onContentTouchEnd({ changedTouches: [{ clientX: 380, clientY: 401 }] });
  assert.equal(page.data.swipeId, '', 'the actions close');
  assert.equal(page.data.swipeOffset, 0);
  assert.equal(page.data.drawerOpen, false, 'the drawer must not open for this gesture');
});

test('a plain right swipe on the content still opens the drawer', () => {
  const { page } = fixture(sessions);
  page.data.displaySessions = sessions;
  page.onContentTouchStart({ touches: [{ clientX: 100, clientY: 500 }] });
  page.onContentTouchEnd({ changedTouches: [{ clientX: 220, clientY: 501 }] });
  assert.equal(page.data.drawerOpen, true);
});

test('a cancelled row gesture releases the scroll lock', () => {
  const { page } = fixture(sessions);
  page.data.displaySessions = sessions;
  page._swipeActionPx = 150;
  page.onSessionTouchStart({ currentTarget: { dataset: { id: 's1', index: 0 } }, touches: [{ clientX: 300, clientY: 400 }] });
  page.onSessionTouchMove({ touches: [{ clientX: 240, clientY: 401 }] });
  assert.equal(page.data.swiping, true);
  page.onSessionTouchCancel();
  assert.equal(page.data.swiping, false, 'the list keeps scrolling after a cancelled gesture');
  assert.equal(page.data.swipeId, '');
});

test('swipe actions rename and archive the row they belong to', () => {
  const { page, modals, calls } = fixture(sessions);
  page.data.displaySessions = sessions;
  page.sessionSwipeAction({ currentTarget: { dataset: { action: 'rename', index: 1 } } });
  assert.equal(modals[0].placeholderText, '会话二');
  page.sessionSwipeAction({ currentTarget: { dataset: { action: 'archive', index: 0 } } });
  assert.equal(modals[1].title, preferences.t('归档会话'));
  assert.deepEqual(calls.filter((call) => call[0] === 'archive'), [['archive', 's1']]);
  assert.equal(page.data.swipeId, '', 'the row closes after an action');
});
