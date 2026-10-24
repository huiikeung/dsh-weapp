const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'miniprogram');
const workspaces = [
  { workspaceId: 'a', title: '工作区 A', sessionIds: ['grouped-a'] },
  { workspaceId: 'b', title: '工作区 B', sessionIds: ['grouped-b'] }
];
const sessions = [
  { sessionId: 'grouped-a', title: '项目 A', updatedAt: 1 },
  { sessionId: 'grouped-b', title: '项目 B', updatedAt: 2 },
  { sessionId: 'loose-1', title: '未归属分析', updatedAt: 3 },
  { sessionId: 'loose-2', title: '独立讨论', updatedAt: 4 },
  { sessionId: 'archived', title: '已归档', updatedAt: 5 },
  { sessionId: 'blank', blank: true },
  { sessionId: 'hidden', hasConversation: false }
];

function fixture(memory = new Map()) {
  const profiles = [{ id: 'host-a', endpoints: [] }, { id: 'host-b', endpoints: [] }];
  const hostMock = { loadProfiles: () => profiles, loadActiveID: () => 'host-a', setActiveID() {},
    loadCredential: () => null, connectionEndpoints: () => [], displayName: () => '测试主机' };
  const wx = { getStorageSync: k => memory.get(k), setStorageSync: (k, v) => memory.set(k, v) };
  class Client {
    constructor(callbacks) { this.callbacks = callbacks; this.created = []; }
    requestSessions() { return Promise.resolve(); }
    requestWorkspaces() { return Promise.resolve(); }
    createSession(id) { this.created.push(id); return Promise.resolve('new-session'); }
    disconnect() {}
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/store.js'), 'utf8'), {
    module, wx, Date, console, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require(name) {
      if (name === './gateway') return { GatewayClient: Client };
      if (name === './hosts') return hostMock;
      return require(path.join(root, 'utils', name));
    }
  });
  const store = module.exports;
  Object.assign(store.state, { activeID: 'host-a', profiles, workspaces, sessions, archivedSessionIds: ['archived'], currentWorkspaceId: 'a', connection: 'connected', everConnected: true });
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/home/home.js'), 'utf8'), {
    Page: d => { definition = d; }, wx,
    require(name) {
      return name.endsWith('/store') ? store : require(path.resolve(root, 'pages/home', name));
    }
  });
  const page = { ...definition, data: { ...definition.data }, syncHostUI() {},
    setData(patch) { Object.assign(this.data, patch); } };
  store.subscribe(snapshot => page.syncFromStore(snapshot));
  page.syncFromStore({ app: store.state });
  return { store, page, memory };
}

test('ungrouped click excludes sessions in every workspace, hidden and archived sessions', () => {
  const { store, page } = fixture();
  assert.equal(page.data.currentWorkspace.title, '工作区 A');
  page.selectUngrouped();
  assert.equal(store.state.isUngroupedWorkspaceSelected, true);
  assert.equal(store.state.currentWorkspaceId, null);
  assert.equal(page.data.currentWorkspace.title, '未分组');
  assert.equal(page.data.currentWorkspace.path, '2 个未归属会话');
  assert.equal(page.data.currentWorkspace.ungrouped, true);
  assert.deepEqual(Array.from(page.data.displaySessions, s => s.sessionId), ['loose-2', 'loose-1']);
  assert.equal(page.data.workspacePickerOpen, false);
});

test('search stays inside ungrouped scope and count does not change with search', () => {
  const { store, page } = fixture();
  page.selectUngrouped();
  store.state.searchQuery = '分析';
  store.state.searchResults = [{ sessionId: 'grouped-a' }];
  page.syncFromStore({ app: store.state });
  assert.deepEqual(Array.from(page.data.displaySessions, s => s.sessionId), ['loose-1']);
  assert.equal(page.data.currentWorkspace.path, '2 个未归属会话');
});

test('no ungrouped sessions shows an explicit empty state instead of the first workspace', () => {
  const { store, page } = fixture();
  store.state.sessions = sessions.slice(0, 2);
  page.selectUngrouped();
  assert.equal(page.data.displaySessions.length, 0);
  assert.equal(page.data.currentWorkspace.path, '0 个未归属会话');
  assert.ok(page.data.emptySessionsText.startsWith('暂无未分组会话'));
});

test('selection survives workspace refresh, cache and restart but switching workspace clears it', () => {
  const { store, page, memory } = fixture();
  page.selectUngrouped();
  store.client.callbacks.onFrame({ kind: 'workspaces', items: workspaces, archivedSessionIds: ['archived'] });
  assert.equal(store.state.currentWorkspaceId, null);
  const saved = JSON.parse(memory.get('dsh_home_cache.host-a'));
  assert.equal(saved.isUngroupedWorkspaceSelected, true);
  assert.equal(saved.currentWorkspaceId, null);
  const restarted = fixture(memory); restarted.store.init();
  assert.equal(restarted.store.state.isUngroupedWorkspaceSelected, true);
  assert.equal(restarted.page.data.currentWorkspace.title, '未分组');
  page.selectWorkspace({ currentTarget: { dataset: { id: 'b' } } });
  assert.equal(store.state.isUngroupedWorkspaceSelected, false);
  assert.equal(page.data.currentWorkspace.title, '工作区 B');
  assert.deepEqual(Array.from(page.data.displaySessions, s => s.sessionId), ['grouped-b']);
  assert.equal(JSON.parse(memory.get('dsh_home_cache.host-a')).isUngroupedWorkspaceSelected, false);
});

test('legacy/default selections still select the first workspace and another host resets ungrouped', () => {
  const { store, page } = fixture();
  store.state.currentWorkspaceId = null;
  page.syncFromStore({ app: store.state });
  assert.equal(page.data.currentWorkspace.title, '工作区 A');
  page.selectUngrouped(); store.selectHost('host-b');
  assert.equal(store.state.isUngroupedWorkspaceSelected, false);
});

test('ungrouped creation and retry send no workspace even after selection changes', async () => {
  const { store, page } = fixture();
  store.openSession = () => {};
  page.selectUngrouped();
  await store.createAndOpenSession();
  store.setCurrentWorkspace('b');
  await store.retryCreateSession();
  assert.deepEqual(store.client.created, [null, null]);
});
