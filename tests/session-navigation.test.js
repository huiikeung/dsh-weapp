const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition; const calls = [], ticks = [], timers = new Map(), patches = [];
  let timerId = 0;
  const store = { state: { sessions: [], archivedSessionIds: [] }, sessionState: { sessionId: 's1', running: true }, openSession: (...args) => calls.push(['open', ...args]), client: {
    renameSession: (...args) => calls.push(['rename', ...args]), archiveSession: (...args) => calls.push(['archive', ...args]), cancelSession: (...args) => calls.push(['cancel', ...args])
  } };
  const wx = { hideKeyboard: () => calls.push(['hideKeyboard']), nextTick: fn => ticks.push(fn),
    showModal: options => calls.push(['modal', options]), navigateTo: options => calls.push(['navigateTo', options]), navigateBack: () => calls.push(['back']) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: value => { definition = value; }, wx, console,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    require: name => name.endsWith('/store') ? store : require(path.resolve(path.dirname(file), name)) });
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
test('more menu works on trajectory, opens standalone stats and dispatches existing actions', () => {
  const { page, calls, store } = fixture(); page.data.tab = 'trajectory';
  page.moreActions(); assert.equal(page.data.moreSheetOpen, true);
  page.selectMoreAction(event('action', 'stats')); assert.equal(page.data.statsSheetOpen, true); assert.equal(page.data.moreSheetOpen, false);
  // 工作区文件：改为页内底部弹窗
  page.moreActions(); page.selectMoreAction(event('action', 'files'));
  assert.equal(page.data.filesSheetOpen, true);
  assert.ok(!calls.some(call => call[0] === 'navigate'), '不应再跳转文件页面');
  page.closeFilesSheet();
  // 重命名：页内输入弹窗
  page.moreActions(); page.selectMoreAction(event('action', 'rename'));
  assert.equal(page.data.renameSheetOpen, true);
  page.onRenameInput({ detail: { value: ' New name ' } });
  page.confirmRename();
  assert.equal(page.data.navTitle, 'New name'); assert.deepEqual(calls.at(-1), ['rename', 's1', 'New name']);
  // 取消回合：确认弹窗
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
  assert.deepEqual(page.data.sessionSwitcherItems.map(item => item.sessionId), ['s2', 's1']);
  assert.equal(page.data.sessionSwitcherItems[1].current, true);
  page.onSessionSwitcherSearch({ detail: { value: 'second' } });
  assert.deepEqual(page.data.sessionSwitcherItems.map(item => item.sessionId), ['s2']);
  page.switchSessionFromSwitcher(event('sessionId', 's2'));
  assert.equal(page.data.sessionSwitcherOpen, false);
  assert.deepEqual(calls.find(call => call[0] === 'open'), ['open', 's2', 'Second task', 'standard']);
  assert.equal(page.sessionId, 's2');
});

test('quick switch controls use a narrow bottom sheet and a wide right-side popover', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.ok(xml.includes('bindtap="openSessionSwitcher"'));
  assert.ok(xml.includes('class="session-switch-mask'));
  assert.ok(xml.includes('class="session-switch-handle-zone"'), 'the mobile sheet keeps its visible drag handle');
  assert.ok(xml.includes('bindtap="switchSessionFromSwitcher"'));
  assert.match(css, /\.session-switch-panel\s*\{[^}]*border-radius: 32rpx 32rpx 0 0;/);
  assert.match(css, /@media\s*\(min-width:\s*700px\)[\s\S]*?\.session-switch-panel\s*\{[\s\S]*?right:\s*16px;/);
  assert.match(css, /\.session-switch-handle\s*\{[^}]*flex: 0 0 84rpx;/, 'drag handle keeps its full pill width');
  assert.match(css, /\.session-switch-lines\s*\{\s*gap: 12rpx;/, 'hamburger bars have wider vertical spacing');
  assert.match(css, /\.session \.segmented-row \.nav-actions \.nav-more::before\s*\{[^}]*width: 48rpx;[^}]*height: 48rpx;/, 'ellipsis circle is smaller than its tap target');
});

test('quick switch sheet expands to 90 percent by tapping or dragging its handle', () => {
  const { page } = fixture();
  page.sessionSwitcherGrabStart({ touches: [{ clientY: 120 }] });
  page.sessionSwitcherGrabEnd();
  assert.equal(page.data.sessionSwitcherHeight, 90, 'a tap completed through the caught touch handlers expands the sheet');
  page.data.sessionSwitcherHeight = 60;
  page.data.sessionSwitcherExpanded = false;
  page.expandSessionSwitcher();
  assert.equal(page.data.sessionSwitcherExpanded, true);
  assert.equal(page.data.sessionSwitcherHeight, 90);
  page.data.sessionSwitcherHeight = 60;
  page.data.sessionSwitcherExpanded = false;
  page.sessionSwitcherGrabStart({ touches: [{ clientY: 120 }] });
  page.sessionSwitcherGrabMove({ touches: [{ clientY: 0 }] });
  assert.ok(page.data.sessionSwitcherHeight > 60 && page.data.sessionSwitcherHeight <= 90);
  page.sessionSwitcherGrabEnd();
  assert.equal(page.data.sessionSwitcherExpanded, true);
  assert.equal(page.data.sessionSwitcherHeight, 90);
  page.expandSessionSwitcher(); // A completed drag must not also trigger a tap.
  assert.equal(page.data.sessionSwitcherExpanded, true);
  page.sessionSwitcherGrabStart({ touches: [{ clientY: 60 }] });
  page.sessionSwitcherGrabMove({ touches: [{ clientY: 100 }] });
  page.sessionSwitcherGrabEnd();
  assert.equal(page.data.sessionSwitcherExpanded, false);
  assert.equal(page.data.sessionSwitcherHeight, 60);
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.match(xml, /height: \{\{sessionSwitcherHeight\}\}vh/);
  assert.match(xml, /session-switch-state \{\{item.current \? 'current' : ''\}\}/);
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.match(css, /\.session-switch-panel\s*\{[^}]*max-height: 90vh;/, 'the mobile sheet can reach its configured 90vh height');
  assert.match(css, /\.session-switch-state\.current\s*\{[^}]*background: #31b77a;/);
});
module.exports = { fixture, event };
test('more sheet omits the session subtitle and uses larger theme-aware red close text', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  const menu = xml.slice(xml.indexOf('class="sheet session-menu"'), xml.indexOf('<view wx:if="{{statsSheetOpen}}"'));
  assert.ok(menu.includes("ui['更多']")); assert.ok(menu.includes('class="sheet-close-x"'));
  assert.ok(!menu.includes('navTitle'));
  assert.match(xml, /class="trace-native-row[^"]*" bindtap="openTraceDetail"/);
  assert.ok(xml.includes('catchtap="openTraceRequest"'), 'request dot must not also open the parent detail');
  // 关闭按钮统一为圆形 × 图标并右对齐
  assert.match(css, /\.session-menu-close\s*\{[^}]*justify-content: flex-end;/);
  assert.ok(xml.includes('class="session-menu-close" bindtap="closeMoreActions" role="button"><view class="sheet-close-x">'));
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

test('compiled template retains hidden panels and pre-mounts the menu in both themes', { skip: !fs.existsSync(process.env.WECHAT_WCC || '') }, t => {
  const os = require('node:os'); const { execFileSync } = require('node:child_process');
  const root = path.resolve(__dirname, '../miniprogram');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-template-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'session.js');
  execFileSync(process.env.WECHAT_WCC, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
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

test('typing prioritizes input and measures dock only when actual textarea height changes', () => {
  const { page } = fixture(); let measured = 0;
  page.updateDockInset = () => { measured++; };
  for (const value of ['测', '测试', '测试输入']) page.onDraftInput({ detail: { value, cursor: value.length } });
  assert.equal(measured, 0); assert.equal(page.data.draft, '测试输入');
  assert.equal(page.data.canSend, true); assert.ok(page._interactionUntil > Date.now());
  page.onComposerLineChange({ detail: { height: 32 } });
  page.onComposerLineChange({ detail: { height: 32 } });
  assert.equal(measured, 1);
  page.onComposerLineChange({ detail: { height: 64 } }); assert.equal(measured, 2);
});

test('hidden conversations discard scheduled projection without losing source updates', () => {
  const { page, timers } = fixture(); const rendered = [];
  page.syncFromStore = value => rendered.push(value);
  page.scheduleStoreSync({ session: { title: 'pending' } });
  const late = [...timers.values()][0]; page.onHide();
  late.fn(); page.scheduleStoreSync({ session: { title: 'hidden' } });
  assert.equal(timers.size, 0); assert.equal(rendered.length, 0);
});
