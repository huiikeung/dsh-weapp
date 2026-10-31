// Home "all sessions" scope: the workspace card menu gains an "All sessions" entry
// that groups every visible session by workspace, with per-section expansion.
// The projection rules mirror dsh-mobile WorkspaceSessionList.swift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', 'miniprogram');
const homeFile = path.join(root, 'pages/home/home.js');
const wxml = fs.readFileSync(path.join(root, 'pages/home/home.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'pages/home/home.wxss'), 'utf8');

const mainWorkspaces = [
  { workspaceId: 'w1', title: '工作区 A', sessionIds: ['a2', 'a1', 'a3', 'hidden', 'blank', 'archived'] },
  { workspaceId: 'w2', title: '工作区 B', sessionIds: ['b1'] }
];
const mainSessions = [
  { sessionId: 'a1', title: 'A 一', updatedAt: 1000 },
  { sessionId: 'a2', title: 'A 二', updatedAt: 3000 },
  { sessionId: 'a3', title: 'A 三', updatedAt: 2000 },
  { sessionId: 'b1', title: 'B 一', updatedAt: 4000 },
  { sessionId: 'free1', title: '未归属一', updatedAt: 5000 },
  { sessionId: 'archived', title: '已归档', updatedAt: 9000 },
  { sessionId: 'blank', blank: true, updatedAt: 9500 },
  { sessionId: 'hidden', hasConversation: false, updatedAt: 9800 }
];

function fixture(config) {
  const options = config || {};
  const memory = options.memory || new Map();
  const modals = [];
  const navigations = [];
  const toasts = [];
  const profiles = [{ id: 'host-a', endpoints: [] }, { id: 'host-b', endpoints: [] }];
  const hostMock = {
    loadProfiles: () => profiles,
    loadActiveID: () => 'host-a',
    setActiveID() {},
    loadCredential: () => null,
    saveCredential() {},
    saveProfiles() {},
    connectionEndpoints: () => [],
    displayName: () => '测试主机'
  };
  const wx = {
    getStorageSync: (key) => memory.get(key),
    setStorageSync: (key, value) => memory.set(key, value),
    removeStorageSync: (key) => memory.delete(key),
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 44, safeArea: { bottom: 667 } }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 44, language: 'zh_CN' }),
    getAppBaseInfo: () => ({ theme: 'dark', language: 'zh_CN' }),
    getMenuButtonBoundingClientRect: () => ({ top: 60, height: 32 }),
    createSelectorQuery: () => ({
      in() { return this; },
      select() { return this; },
      boundingClientRect(callback) { callback({ left: 40, top: 300, width: 295, height: 60 }); return this; },
      exec() { return this; }
    }),
    showModal: (opts) => modals.push(opts || {}),
    showToast: (opts) => toasts.push(opts || {}),
    navigateTo: (opts) => navigations.push(opts || {})
  };
  class Client {
    constructor(callbacks) { this.callbacks = callbacks || {}; this.created = []; }
    requestSessions() { return Promise.resolve(); }
    requestWorkspaces() { return Promise.resolve(); }
    searchSessions() { return Promise.resolve([]); }
    createSession(workspaceId) { this.created.push(workspaceId); return Promise.resolve('created-session'); }
    disconnect() {}
  }
  const storeModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/store.js'), 'utf8'), {
    module: storeModule,
    wx,
    Date,
    console,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    require(name) {
      if (name === './gateway') return { GatewayClient: Client };
      if (name === './hosts') return hostMock;
      return require(path.join(root, 'utils', name));
    }
  });
  const store = storeModule.exports;
  Object.assign(store.state, {
    activeID: 'host-a',
    profiles,
    workspaces: options.workspaces || mainWorkspaces,
    sessions: options.sessions || mainSessions,
    archivedSessionIds: options.archivedSessionIds || ['archived'],
    currentWorkspaceId: options.currentWorkspaceId === undefined ? 'w1' : options.currentWorkspaceId,
    connection: 'connected',
    everConnected: true
  });
  let definition;
  vm.runInNewContext(fs.readFileSync(homeFile, 'utf8'), {
    Page: (value) => { definition = value; },
    wx,
    require(name) {
      if (name === '../../utils/store' || String(name).slice(-6) === '/store') return store;
      return require(path.resolve(root, 'pages/home', name));
    }
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    topbarTop: 0,
    topbarH: 0,
    syncHostUI() {},
    syncSessionStatusPolling() {},
    loadCostMeterSummary() {},
    setData(patch) { Object.assign(this.data, patch); }
  });
  store.subscribe((snapshot) => page.syncFromStore(snapshot));
  page.syncFromStore({ app: store.state, session: store.sessionState });
  return { store, page, memory, modals, navigations, toasts };
}

function entriesOf(page) { return Array.from(page.data.displayEntries || []); }
function entriesOfType(page, type) { return entriesOf(page).filter((entry) => entry.type === type); }
function entrySessionIds(page) { return entriesOfType(page, 'session').map((entry) => entry.sessionId); }
function sectionIds(page) { return entriesOfType(page, 'section').map((entry) => entry.sectionId); }
function syncPage(store, page) {
  page.syncFromStore({ app: store.state, session: store.sessionState });
}
function collapseFixture() {
  const sessions = [];
  for (let i = 6; i >= 1; i -= 1) sessions.push({ sessionId: 'b' + i, title: '大 ' + i, updatedAt: i * 1000 });
  sessions.push({ sessionId: 's2', title: '小 二', updatedAt: 9000 });
  sessions.push({ sessionId: 's1', title: '小 一', updatedAt: 8000 });
  return fixture({
    sessions,
    workspaces: [
      { workspaceId: 'wbig', title: '大工作区', sessionIds: ['b6', 'b5', 'b4', 'b3', 'b2', 'b1'] },
      { workspaceId: 'wsmall', title: '小工作区', sessionIds: ['s2', 's1'] }
    ]
  });
}

test('selecting all sessions uses the cross-workspace scope and closes the picker', () => {
  const { store, page } = fixture();
  assert.equal(store.state.isAllWorkspacesSelected, false);
  assert.equal(page.data.allWorkspacesSelected, false);
  page.openWorkspacePicker();
  assert.equal(page.data.workspacePickerOpen, true, 'the menu is open before choosing');
  page.selectAll();
  assert.equal(store.state.isAllWorkspacesSelected, true);
  assert.equal(store.state.currentWorkspaceId, null);
  assert.equal(store.state.isUngroupedWorkspaceSelected, false);
  assert.equal(page.data.workspacePickerOpen, false, 'choosing all sessions closes the menu');
  assert.equal(page.data.allWorkspacesSelected, true);
  assert.deepEqual({ ...page.data.currentWorkspace }, {
    title: '全部会话',
    path: '5 个会话',
    workspaceId: '',
    ungrouped: false,
    all: true
  });
  // The card count is every visible session and does not shrink with a search.
  store.state.searchQuery = 'A 二';
  store.state.searchResults = [{ sessionId: 'a2' }];
  syncPage(store, page);
  assert.equal(page.data.currentWorkspace.path, '5 个会话');
});

test('all sessions group visible sessions by workspace with section and session order', () => {
  const { page } = fixture();
  page.selectAll();
  assert.deepEqual(entriesOf(page).map((entry) => entry.type), [
    'section', 'session',
    'section', 'session',
    'section', 'session', 'session', 'session'
  ]);
  const sections = entriesOfType(page, 'section');
  assert.equal(sections.length, 3, 'one section per workspace that has visible sessions');
  // Ungrouped first (newest session), then workspace B (4000), then workspace A (3000).
  assert.equal(sections[0].title, '未分组');
  assert.equal(sections[0].count, 1);
  assert.equal(sections[0].countLabel, '1 个会话');
  assert.equal(sections[0].sectionLabel, '工作区 未分组，1 个会话', 'section headers expose an accessible label');
  assert.equal(sections[0].first, true);
  assert.ok(sections[0].sectionId, 'the ungrouped section exposes a stable id');
  assert.equal(sections[0].key, 'section-' + sections[0].sectionId);
  assert.equal(sections[1].title, '工作区 B');
  assert.equal(sections[1].sectionId, 'w2');
  assert.equal(sections[1].count, 1);
  assert.equal(sections[1].countLabel, '1 个会话');
  assert.equal(sections[1].key, 'section-w2');
  assert.equal(sections[1].first, false);
  assert.equal(sections[2].title, '工作区 A');
  assert.equal(sections[2].sectionId, 'w1');
  assert.equal(sections[2].count, 3);
  assert.equal(sections[2].countLabel, '3 个会话');
  assert.equal(sections[2].key, 'section-w1');
  assert.equal(sections[2].first, false);
  const sessionEntries = entriesOfType(page, 'session');
  assert.deepEqual(sessionEntries.map((entry) => entry.sessionId), ['free1', 'b1', 'a2', 'a3', 'a1']);
  assert.deepEqual(sessionEntries.map((entry) => entry.displayTitle), ['未归属一', 'B 一', 'A 二', 'A 三', 'A 一']);
  assert.deepEqual(sessionEntries.map((entry) => entry.key),
    ['session-free1', 'session-b1', 'session-a2', 'session-a3', 'session-a1']);
  const rendered = page.data.displaySessions;
  assert.equal(rendered.length, sessionEntries.length, 'displaySessions is exactly the rendered rows');
  sessionEntries.forEach((entry, index) => {
    assert.equal(entry.index, index);
    assert.equal(rendered[index].sessionId, entry.sessionId);
    assert.equal(rendered[index].index, index);
  });
  assert.equal(new Set(entriesOf(page).map((entry) => entry.key)).size, entriesOf(page).length,
    'every display entry key is unique');
  ['archived', 'blank', 'hidden'].forEach((id) => {
    assert.ok(!sessionEntries.some((entry) => entry.sessionId === id), id + ' must be filtered out');
  });
});

test('sections and sessions break ordering ties by stable ids', () => {
  const { page } = fixture({
    sessions: [
      { sessionId: 'z9', title: 'Z', updatedAt: 9000 },
      { sessionId: 'a9', title: 'A', updatedAt: 9000 },
      { sessionId: 'b9', title: 'B', updatedAt: 9000 }
    ],
    workspaces: [
      { workspaceId: 'w2', title: 'Beta', sessionIds: ['b9'] },
      { workspaceId: 'w1', title: 'Alpha', sessionIds: ['z9', 'a9'] }
    ]
  });
  page.selectAll();
  assert.deepEqual(sectionIds(page), ['w1', 'w2'], 'equal newest activity orders sections by id');
  assert.deepEqual(entrySessionIds(page), ['a9', 'z9', 'b9'], 'equal updatedAt orders sessions by sessionId');
});

test('sections collapse to five rows and expand independently', () => {
  const { page } = collapseFixture();
  page.selectAll();
  assert.deepEqual(sectionIds(page), ['wsmall', 'wbig']);
  let toggles = entriesOfType(page, 'toggle');
  assert.equal(toggles.length, 1, 'only sections with more than five sessions collapse');
  assert.equal(toggles[0].sectionId, 'wbig');
  assert.equal(toggles[0].key, 'toggle-wbig');
  assert.equal(toggles[0].remaining, 1);
  assert.equal(toggles[0].expanded, false);
  assert.equal(toggles[0].label, '展开其余 1 个会话');
  assert.deepEqual(Array.from(page.data.displaySessions, (session) => session.sessionId),
    ['s2', 's1', 'b6', 'b5', 'b4', 'b3', 'b2']);
  assert.equal(entriesOfType(page, 'section')[1].count, 6, 'the section header counts every session, not just visible rows');
  const totalBefore = page.data.displaySessions.length;

  page.toggleSessionSection({ currentTarget: { dataset: { id: 'wbig' } } });
  assert.deepEqual(Array.from(page.data.expandedSectionIds), ['wbig']);
  assert.equal(page.data.displaySessions.length, totalBefore + 1);
  toggles = entriesOfType(page, 'toggle');
  assert.equal(toggles.length, 1);
  assert.equal(toggles[0].expanded, true);
  assert.equal(toggles[0].label, '收起');
  assert.equal(toggles[0].remaining, 1);
  const expandedIds = entrySessionIds(page);
  assert.deepEqual(expandedIds.slice(0, 2), ['s2', 's1'], 'other sections are untouched');
  assert.equal(expandedIds[expandedIds.length - 1], 'b1');
  assert.equal(entriesOfType(page, 'section')[1].count, 6);
  assert.equal(new Set(entriesOf(page).map((entry) => entry.key)).size, entriesOf(page).length);

  page.toggleSessionSection({ currentTarget: { dataset: { id: 'wbig' } } });
  assert.deepEqual(Array.from(page.data.expandedSectionIds), []);
  assert.equal(page.data.displaySessions.length, totalBefore);
  assert.equal(entriesOfType(page, 'toggle')[0].label, '展开其余 1 个会话');
});

test('search filters across workspaces while the card count keeps every visible session', () => {
  const { store, page } = fixture();
  page.selectAll();
  store.state.searchQuery = 'needle';
  store.state.searchResults = [{ sessionId: 'b1' }];
  syncPage(store, page);
  assert.deepEqual(entrySessionIds(page), ['b1'], 'a gateway search hit keeps its workspace group');
  assert.deepEqual(sectionIds(page), ['w2']);
  assert.equal(page.data.currentWorkspace.path, '5 个会话');

  store.state.searchQuery = 'A 二';
  store.state.searchResults = [];
  syncPage(store, page);
  assert.deepEqual(entrySessionIds(page), ['a2'], 'titles match across every workspace');
  assert.deepEqual(sectionIds(page), ['w1']);

  store.state.searchQuery = 'free';
  store.state.searchResults = [];
  syncPage(store, page);
  assert.deepEqual(entrySessionIds(page), ['free1'], 'session ids match too');

  store.state.searchQuery = '';
  store.state.searchResults = null;
  syncPage(store, page);
  assert.equal(page.data.displaySessions.length, 5, 'clearing the search restores the full grouped list');
  assert.equal(entriesOfType(page, 'section').length, 3);
});

test('creating a session while all sessions are selected only prompts for a workspace', () => {
  const { store, page, modals, navigations } = fixture();
  page.selectAll();
  const created = [];
  store.createAndOpenSession = (workspaceId) => { created.push(workspaceId); return Promise.resolve('created-session'); };
  page.newSession();
  assert.deepEqual(created, [], 'all sessions is not a concrete workspace');
  assert.deepEqual(navigations, [], 'the guard never navigates');
  assert.equal(modals.length, 1);
  assert.equal(modals[0].title, '请先选择工作区');
  assert.equal(modals[0].content, '请先选择一个具体工作区，再创建新会话。');
  assert.equal(modals[0].showCancel, false);
  assert.equal(modals[0].confirmText, '知道了');
});

test('the store rejects anonymous creation while all sessions are selected', async () => {
  const { store, page } = fixture();
  page.selectAll();
  await assert.rejects(store.createAndOpenSession(), /请先选择一个具体工作区，再创建新会话/,
    'the guard also protects non-home entry points that pass no workspace');
  assert.equal(store.state.isAllWorkspacesSelected, true, 'a rejected creation keeps the all-sessions scope');
  assert.ok(!store.sessionState.creating, 'the guard runs before the optimistic creating state');
});

test('choosing a concrete workspace creates a new session again', () => {
  const { store, page, modals, navigations } = fixture();
  page.selectAll();
  const created = [];
  store.createAndOpenSession = (workspaceId) => { created.push(workspaceId); return Promise.resolve('created-session'); };
  page.selectWorkspace({ currentTarget: { dataset: { id: 'w2' } } });
  assert.equal(page.data.allWorkspacesSelected, false);
  page.newSession();
  assert.equal(modals.length, 0);
  assert.deepEqual(created, ['w2']);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/session/session');
});

test('the all-sessions selection is cached per host and restored on restart', () => {
  const { page, memory } = fixture();
  page.selectAll();
  const saved = JSON.parse(memory.get('dsh_home_cache.host-a')).value;
  assert.equal(saved.isAllWorkspacesSelected, true);
  assert.equal(saved.currentWorkspaceId, null, 'the cache must not fall back to the first workspace');
  const restarted = fixture({ memory });
  restarted.store.init();
  syncPage(restarted.store, restarted.page);
  assert.equal(restarted.store.state.isAllWorkspacesSelected, true);
  assert.equal(restarted.page.data.allWorkspacesSelected, true);
  assert.equal(restarted.page.data.currentWorkspace.title, '全部会话');
  assert.equal(restarted.page.data.currentWorkspace.path, '5 个会话');
});

test('choosing a workspace, ungrouped, or another host clears the all-sessions flag', () => {
  const { store, page, memory } = fixture();
  page.selectAll();
  page.selectWorkspace({ currentTarget: { dataset: { id: 'w2' } } });
  assert.equal(store.state.isAllWorkspacesSelected, false);
  assert.equal(page.data.allWorkspacesSelected, false);
  assert.equal(page.data.currentWorkspace.title, '工作区 B');
  assert.equal(JSON.parse(memory.get('dsh_home_cache.host-a')).value.isAllWorkspacesSelected, false);

  page.selectAll();
  page.selectUngrouped();
  assert.equal(store.state.isAllWorkspacesSelected, false);
  assert.equal(page.data.allWorkspacesSelected, false);
  assert.equal(page.data.currentWorkspace.title, '未分组');

  page.selectAll();
  store.selectHost('host-b');
  assert.equal(store.state.isAllWorkspacesSelected, false);
  assert.equal(page.data.allWorkspacesSelected, false);
});

test('expanded sections do not leak across hosts', () => {
  const { store, page } = collapseFixture();
  page.selectAll();
  page.toggleSessionSection({ currentTarget: { dataset: { id: 'wbig' } } });
  assert.deepEqual(Array.from(page.data.expandedSectionIds), ['wbig']);
  store.selectHost('host-b');
  syncPage(store, page);
  assert.deepEqual(Array.from(page.data.expandedSectionIds), [], 'host switch clears expansion state');
});

test('the regular recent-sessions list keeps its twelve-row cap and entry indexes', () => {
  const sessions = Array.from({ length: 20 }, (_, index) => ({
    sessionId: 's' + index,
    title: 'S' + index,
    updatedAt: index + 1
  }));
  const { page } = fixture({
    sessions,
    workspaces: [{ workspaceId: 'w1', title: '工作区 A', sessionIds: sessions.map((session) => session.sessionId) }]
  });
  assert.equal(page.data.allWorkspacesSelected, false);
  assert.equal(page.data.displaySessions.length, 12);
  assert.equal(page.data.displaySessions[0].sessionId, 's19');
  assert.equal(page.data.displaySessions[11].sessionId, 's8');
  const entries = entriesOf(page);
  assert.equal(entries.length, 12);
  assert.ok(entries.every((entry) => entry.type === 'session'), 'the regular list has no section entries');
  entries.forEach((entry, index) => {
    assert.equal(entry.index, index);
    assert.equal(entry.sessionId, 's' + (19 - index));
  });
  assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
});

test('the workspace menu lists all sessions first and the grouped list markup is wired', () => {
  const menuStart = wxml.indexOf('workspace-menu');
  assert.ok(menuStart >= 0, 'the workspace menu exists');
  const menu = wxml.slice(menuStart);
  const allIndex = menu.indexOf('全部会话');
  const ungroupedIndex = menu.indexOf('未分组');
  assert.ok(allIndex >= 0, 'the all-sessions entry is in the workspace menu');
  assert.ok(ungroupedIndex >= 0, 'the ungrouped entry is in the workspace menu');
  assert.ok(allIndex < ungroupedIndex, 'all sessions must appear before ungrouped');
  assert.match(menu, /bindtap="selectAll"/);
  assert.match(wxml, /wx:for="\{\{\s*displayEntries\s*\}\}"/);
  assert.match(wxml, /wx:key="key"/);
  assert.match(wxml, /id="session-row-\{\{item\.index\}\}"/);
  assert.match(wxml, /data-index="\{\{item\.index\}\}"/);
  assert.match(wxml, /bindtap="toggleSessionSection"/);
  assert.match(wxml, /data-id="\{\{item\.sectionId\}\}"/);
  assert.match(wxml, /item\.countLabel/);
  assert.match(wxml, /allWorkspacesSelected\s*\?\s*ui\['全部会话'\]\s*:\s*ui\['最近会话'\]/);
  const sectionClasses = wxml.match(/class="[^"]*section[^"]*"/g) || [];
  assert.ok(sectionClasses.length > 0, 'section markup carries section classes');
  sectionClasses.forEach((attr) => {
    attr.replace(/^class="/, '').replace(/"$/, '').split(/\s+/).forEach((cls) => {
      if (!/^[a-z][a-z0-9-]*$/i.test(cls)) return;
      assert.ok(wxss.indexOf('.' + cls) >= 0, 'wxss must style .' + cls);
    });
  });
});
