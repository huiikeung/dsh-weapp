'use strict';

// v2 上下文浏览器 + 原生 WXML 渲染回归：
// - 浏览器游标/下拉/折叠行的纯派生与页面交互；
// - wcc 编译后的 session.wxml 在 ready / loading / unsupported 三种面板状态下渲染不抛错。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const contextView = require('../miniprogram/utils/context-view');
const preferences = require('../miniprogram/utils/ui-preferences');
const root = path.resolve(__dirname, '../miniprogram');
const compiler = process.env.WECHAT_WCC
  || 'D:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';

function sampleBrowserValue(overrides) {
  const requests = [];
  for (let i = 0; i < 4; i += 1) {
    requests.push({
      seq: 10 + i * 10,
      time: 1791807408490 + i * 1000,
      turn: i + 1,
      step: 1,
      system: 2154,
      tools: 10439 + i,
      user: 123,
      inject: 0,
      skill: 0,
      assistant: 900,
      tool: 300,
      total: 13916 + i,
      items: { system: 1, tools: 79 + i, user: 2 },
      prompt: 11200 + i * 10,
      output: 191 + i
    });
  }
  return Object.assign({
    v: 2,
    model: 'glm-5.3-flash',
    provider: 'zaicoding',
    contextWindow: 262144,
    current: { system: 2154, tools: 10439, user: 123, inject: 0, skill: 0, assistant: 900, tool: 300, total: 13916 },
    counts: { humanInputs: 12, answers: 4, toolCalls: 43, skillLoads: 0, injects: 7, compactions: 1, prunes: 2 },
    tools: { total: 43, names: [{ name: 'bash', count: 21 }, { name: 'read', count: 12 }] },
    timing: {
      wallMs: 60000, ttftMs: 2000, reasoningMs: 1000, textMs: 3000,
      toolArgMs: 500, toolsMs: 4000, otherMs: 100,
      waitCount: 4, reasoningCount: 3, textCount: 3, toolArgCount: 4, toolCount: 5,
      speedTokens: 900, speedMs: 3000
    },
    spans: [[0, 1000, 2000], [1, 2000, 2500], [2, 2500, 4000], [3, 4000, 4200], [4, 4200, 5000], [5, 5000, 5050]],
    lastAnswer: '同步完成。',
    requests: requests,
    events: [{ seq: 20, time: 1791807500000, kind: 'compaction', tokens: 1024 }],
    usage: { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 50, outputTokens: 80 },
    breakdown: { systemTokens: 2154, toolsTokens: 10439, messageTokens: 1323 }
  }, overrides || {});
}

// ---------- 页面交互（与 tests/context-fleet-view.test.js 相同的加载方式） ----------

function pageFixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition;
  const calls = [];
  const store = {
    state: { sessions: [], archivedSessionIds: [], connection: 'connected' },
    sessionState: {
      sessionId: 'session-1',
      running: true,
      contextFleet: null,
      contextDashboard: { loading: false, error: null, code: '', unsupported: false, asOfSeq: 3, value: sampleBrowserValue() }
    },
    openSession: (...args) => calls.push(['open', ...args]),
    loadOlderHistory: () => calls.push(['loadOlderHistory']),
    setFleetActive: active => calls.push(['fleetActive', active]),
    setContextActive: active => calls.push(['contextActive', active]),
    refreshContextDashboard: () => calls.push(['refreshDashboard']),
    refreshContextFleet: () => calls.push(['refreshFleet']),
    client: {}
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; }, wx: { hideKeyboard() {}, nextTick: fn => fn() }, console,
    setTimeout: () => 1, clearTimeout: () => {},
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/haptics') ? { vibrate: () => calls.push(['haptic']), tick: () => calls.push(['tick']) }
        : require(path.resolve(path.dirname(file), name))
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let target = this.data;
        parts.slice(0, -1).forEach((part, i) => {
          if (target[part] == null) target[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
          target = target[part];
        });
        target[parts.at(-1)] = value;
      }
    },
    startScrollPolling() {}, stopScrollPolling() {}, refreshBottomAnchor() {}
  };
  return { page, calls, store };
}

test('browser cursor handlers walk requests and reset to the current composition', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  const browser = page.data.contextPanel.browser;
  assert.equal(browser.isCurrent, true);
  assert.equal(browser.selectedIndex, browser.options.length - 1);
  // 上一步 → 停在最新一条历史请求。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  assert.equal(page.data.contextBrowserSeq, 40);
  assert.equal(page.data.contextPanel.browser.isCurrent, false);
  assert.equal(page.data.contextPanel.browser.promptText, '11.2k');
  // 继续往更早走。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  assert.equal(page.data.contextBrowserSeq, 30);
  // 下一步回到更新的请求，最后回到「当前（下一次请求）」。
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  assert.equal(page.data.contextBrowserSeq, 40);
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  assert.equal(page.data.contextBrowserSeq, null);
  assert.equal(page.data.contextPanel.browser.isCurrent, true);
  assert.equal(page.data.contextPanel.browser.canNext, false);
});

test('browser picker jumps to the chosen request and the fold rows toggle', () => {
  const { page } = pageFixture();
  page.data.tab = 'context';
  page.setData(page.contextPanelPatch());
  page.contextBrowserPick({ detail: { value: '0' } });
  assert.equal(page.data.contextBrowserSeq, 10);
  assert.equal(page.data.contextPanel.browser.selectedLabel, '请求 #10');
  const row = page.data.contextPanel.browser.rows[1];
  assert.equal(row.expanded, false);
  page.toggleContextBrowserRow({ currentTarget: { dataset: { key: row.key } } });
  assert.deepEqual(page.data.contextBrowserExpanded, ['tools']);
  assert.equal(page.data.contextPanel.browser.rows[1].expanded, true);
  page.toggleContextBrowserRow({ currentTarget: { dataset: { key: row.key } } });
  assert.deepEqual(page.data.contextBrowserExpanded, []);
  assert.equal(page.data.contextPanel.browser.rows[1].expanded, false);
});

test('browser handlers survive a panel without browser data (loading/error states)', () => {
  const { page, calls } = pageFixture();
  page.data.contextPanel = contextView.buildPanel(null, { connected: true, hasSession: true });
  page.contextBrowserStep({ currentTarget: { dataset: { step: '-1' } } });
  page.contextBrowserStep({ currentTarget: { dataset: { step: '1' } } });
  page.contextBrowserPick({ detail: { value: 0 } });
  page.toggleContextBrowserRow({ currentTarget: { dataset: { key: 'system' } } });
  assert.equal(page.data.contextBrowserSeq, null);
  assert.deepEqual(page.data.contextBrowserExpanded, []);
  assert.equal(calls.filter(call => call[0] === 'refreshDashboard').length, 0);
});

// ---------- 原生 WXML 渲染（ready / loading / unsupported） ----------

test('native session template renders v2 context/fleet panels without throwing', { skip: !fs.existsSync(compiler) }, () => {
  const output = path.join(os.tmpdir(), 'dsh-context-v2-' + process.pid + '.js');
  execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(fs.readFileSync(output, 'utf8'), context);
  const render = context.$gwx('pages/session/session.wxml');
  const snapshot = preferences.snapshot();

  const readyPanel = contextView.buildPanel(
    { loading: false, error: null, code: '', unsupported: false, asOfSeq: 5, value: sampleBrowserValue() },
    { connected: true, hasSession: true, running: true, browserSeq: 20, expanded: ['tools'] }
  );
  const fleetPanel = contextView.buildFleetPanel({
    loading: false,
    error: null,
    code: '',
    unsupported: false,
    asOfSeq: 6,
    value: {
      rootSessionId: 'session-1',
      currentSessionId: 'session-1',
      counts: { agents: 2, running: 1, subagents: 1 },
      agents: [
        { sessionId: 'session-1', title: '主会话', depth: 0, isRoot: true, running: true, phase: 'active', lastAnswer: '正在同步', contextWindow: 1000, pressureTokens: 250, tokensTotal: 500, turns: 2, steps: 4, activeMs: 60000, composition: { system: 10, tools: 5, user: 3, total: 18 } },
        { sessionId: 'session-child', title: '子会话', depth: 1, running: false, phase: 'idle', lastAnswer: '子任务完成' }
      ],
      team: { members: [{ id: 'session-1', role: 'lead', phase: 'active' }], tasks: [{ id: 't1', subject: '实现组件', status: 'in_progress', ownerName: '阿青' }] }
    }
  }, { connected: true, hasSession: true, running: true });

  const base = {
    ...snapshot,
    tab: 'context',
    theme: 'light',
    themeClass: '',
    contextMounted: true,
    fleetMounted: true,
    rows: [], images: [], queue: [], tasks: [], folds: {},
    ui: snapshot.ui || {},
    stats: {}, commandMenu: null,
    contextPanel: readyPanel,
    fleetPanel: fleetPanel
  };
  const readyTree = JSON.stringify(render({ ...base }, {}, {}));
  assert.ok(readyTree.includes('ctx-browser'), 'browser card renders');
  assert.ok(readyTree.includes('ctx-timeline'), 'timing timeline renders');
  assert.ok(readyTree.includes('ctx-donut'), 'donuts render');
  assert.ok(readyTree.includes('fleet-answer'), 'fleet latest answer renders');
  assert.ok(readyTree.includes('fleet-task'), 'fleet task card renders');

  const loading = contextView.buildPanel({ loading: true, value: null }, { connected: true, hasSession: true });
  const loadingFleet = contextView.buildFleetPanel({ loading: true, value: null }, { connected: true, hasSession: true });
  const loadingTree = JSON.stringify(render({ ...base, contextPanel: loading, fleetPanel: loadingFleet }, {}, {}));
  assert.ok(loadingTree.length > 0);

  const unsupported = contextView.buildPanel({ unsupported: true }, { connected: true, hasSession: true });
  const unsupportedFleet = contextView.buildFleetPanel({ unsupported: true }, { connected: true, hasSession: true });
  const unsupportedTree = JSON.stringify(render({ ...base, contextPanel: unsupported, fleetPanel: unsupportedFleet }, {}, {}));
  assert.ok(unsupportedTree.includes('dsh-plugin-mobile-gateway'), 'upgrade hint renders');
});
