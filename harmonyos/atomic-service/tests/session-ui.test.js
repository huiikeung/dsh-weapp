'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../ascf/ascf_src');

function loadSessionPage(store) {
  const filename = path.join(root, 'pages/session/session.js');
  const storage = new Map();
  const api = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, statusBarHeight: 44 }),
    nextTick: fn => fn(),
    createSelectorQuery() {
      const query = {
        in() { return this; },
        select() { return this; },
        boundingClientRect() { return this; },
        exec(fn) { fn([{ top: 120, left: 16, width: 350, height: 52 }, { bottom: 720 }]); return this; }
      };
      return query;
    }
  };
  const previousHas = global.has;
  global.has = api;
  let definition;
  try {
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      has: api,
      Page: value => { definition = value; },
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      require(name) {
        if (name === '../../utils/store') return store;
        if (name === '../../utils/haptics') return { vibrate() {} };
        if (name === '../../utils/ui-preferences') return { t: value => value, locale: () => 'en', snapshot: () => ({ ui: {} }) };
        return require(path.resolve(path.dirname(filename), name));
      }
    }, { filename });
  } catch (error) {
    if (previousHas === undefined) delete global.has;
    else global.has = previousHas;
    throw error;
  }
  return {
    definition,
    api,
    cleanup() {
      if (previousHas === undefined) delete global.has;
      else global.has = previousHas;
    }
  };
}

function fixtureStore() {
  return {
    state: { sessions: [], workspaces: [], archivedSessionIds: [] },
    sessionState: { sessionId: 'current', trajectory: [] },
    client: {}
  };
}

test('sidebar groups visible sessions and switches session in place', () => {
  const store = fixtureStore();
  store.state = {
    sessions: [
      { sessionId: 'current', title: 'Current', updatedAt: 1, running: true },
      { sessionId: 'shared', title: 'Shared', updatedAt: 3 },
      { sessionId: 'loose', title: 'Loose', updatedAt: 2 },
      { sessionId: 'blank', title: 'Blank', blank: true },
      { sessionId: 'archived', title: 'Archived', updatedAt: 9 },
      { sessionId: 'metadata-only', title: 'Metadata only', hasConversation: false }
    ],
    workspaces: [{ workspaceId: 'workspace-a', title: 'Project A', sessionIds: ['current', 'shared'] }],
    archivedSessionIds: ['archived']
  };
  store.sessionState = { sessionId: 'current', trajectory: [] };
  const loaded = loadSessionPage(store);
  try {
    const page = { _convSidebarExpanded: [] };
    const result = loaded.definition.convSidebarData.call(page, [], true);
    assert.deepEqual(Array.from(result.convSidebarGroups, group => group.id), ['workspace-a', '__ungrouped__']);
    assert.equal(result.convSidebarGroups[0].containsCurrent, true);
    assert.equal(result.convSidebarGroups[0].expanded, true);
    assert.deepEqual(Array.from(result.convSidebarGroups[0].sessions, session => session.id), ['shared', 'current']);
    assert.deepEqual(Array.from(result.convSidebarGroups[1].sessions, session => session.id), ['loose']);

    let opened;
    let closed = false;
    let pollingStarted = false;
    store.openSession = (...args) => { opened = args; };
    const sessionPage = {
      data: { convSidebarOpen: true, tab: 'conversation' },
      closeConversationSidebar() { closed = true; },
      startScrollPolling() { pollingStarted = true; }
    };
    loaded.definition.selectConvSidebarSession.call(sessionPage, { currentTarget: { dataset: { id: 'loose' } } });
    assert.deepEqual(opened, ['loose', 'Loose', null]);
    assert.equal(sessionPage.sessionId, 'loose');
    assert.equal(closed, true);
    assert.equal(pollingStarted, true);
  } finally {
    loaded.cleanup();
  }
});

test('sidebar opens at the nav/composer anchor and persists group state', () => {
  const store = fixtureStore();
  store.state = {
    sessions: [{ sessionId: 'current', title: 'Current', updatedAt: 1 }],
    workspaces: [{ workspaceId: 'workspace-a', title: 'Project A', sessionIds: ['current'] }],
    archivedSessionIds: []
  };
  store.sessionState = { sessionId: 'current' };
  const loaded = loadSessionPage(store);
  try {
    const page = Object.assign(Object.create(loaded.definition), {
      data: { convSidebarOpen: false },
      setData(patch) { Object.assign(this.data, patch); }
    });
    loaded.definition.openConversationSidebar.call(page);
    assert.equal(page.data.convSidebarOpen, true);
    assert.equal(page.data.convSidebarTop, 120);
    assert.equal(page.data.convSidebarHeight, 600);
    assert.equal(page.data.convSidebarGroups[0].expanded, true);
    loaded.definition.toggleConvSidebarGroup.call(page, { currentTarget: { dataset: { id: 'workspace-a' } } });
    assert.equal(page.data.convSidebarGroups[0].expanded, false);
    assert.equal(loaded.api.getStorageSync('conversationSidebarExpanded'), '[]');
  } finally {
    loaded.cleanup();
  }
});

test('tab switches keep panels mounted and skip unchanged trajectory projection', () => {
  const store = fixtureStore();
  const trajectory = [{ key: 'row-1' }];
  store.sessionState = { sessionId: 'session-1', trajectory, contextDashboard: {}, contextFleet: {} };
  store.setTrajectoryActive = () => {};
  store.setContextActive = () => {};
  store.setFleetActive = () => {};
  const loaded = loadSessionPage(store);
  try {
    let projections = 0;
    const contextPanel = { keep: 'context' };
    const fleetPanel = { keep: 'fleet' };
    const page = {
      data: {
        tab: 'conversation', showContextPanel: true, showFleetPanel: true,
        trajectoryMounted: false, contextMounted: false, fleetMounted: false,
        contextPanel, fleetPanel, contextFlowLinks: [], kbHeight: 0, composerFocused: false
      },
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
      cancelVoice() {}, closeAttachMenu() {}, closeFileMention() {}, prioritizeInteraction() {},
      trajectoryPatch() { projections += 1; return { trajectory }; },
      layoutPatch() { return {}; }, stopContextFlow() {}, stopScrollPolling() {},
      measureConversationViewport() {}, scheduleInitialConversationAnchorRecovery() {},
      updateDockInset() {}, startScrollPolling() {}, refreshBottomAnchor() {}
    };
    const change = tab => loaded.definition.switchTab.call(page, { currentTarget: { dataset: { tab } } });
    change('trajectory');
    assert.equal(page.data.trajectoryMounted, true);
    assert.equal(page.data.contextPanel, contextPanel);
    assert.equal(page.data.fleetPanel, fleetPanel);
    change('conversation');
    change('trajectory');
    assert.equal(projections, 1);
    assert.equal(page.data.trajectoryMounted, true);
    assert.equal(page.data.contextPanel, contextPanel);
    assert.equal(page.data.fleetPanel, fleetPanel);
  } finally {
    loaded.cleanup();
  }
});

test('session markup and timing retain the requested loading behavior', () => {
  const hxml = fs.readFileSync(path.join(root, 'pages/session/session.hxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'pages/session/session.css'), 'utf8');
  assert.ok(hxml.includes('class="nav-sidebar') && hxml.includes('toggleConversationSidebar'));
  assert.ok(hxml.includes('class="conv-sidebar-mask"') && hxml.includes('class="conv-sidebar-scroll"') && hxml.includes('selectConvSidebarSession'));
  assert.ok(hxml.includes('class="conv-skeleton"'));
  assert.ok(hxml.includes('rows.length && !historyLoading && hasMoreHistory'));
  assert.ok(hxml.indexOf('class="composer-images"') < hxml.indexOf('class="voice-input-wrap"'));
  assert.ok(hxml.indexOf('class="voice-input-wrap"') < hxml.indexOf('class="composer-input"'));
  assert.ok(js.includes('this.stopTurnNavigatorWarmup();') && js.includes('turnNavOpen: false'));
  assert.ok(js.includes('setInterval(() => this.pollScrollPosition(), 1000)'));
  const activeStart = css.indexOf('.turn-scrub-row.active {');
  const activeEnd = css.indexOf('}', activeStart);
  assert.ok(activeStart >= 0 && activeEnd > activeStart);
  assert.ok(!css.slice(activeStart, activeEnd).includes('box-shadow'));
});
