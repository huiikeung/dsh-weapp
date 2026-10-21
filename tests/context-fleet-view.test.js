'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contextView = require('../miniprogram/utils/context-view');

/** 文档第 7.2 节的示例 value（当前 Agent + 父链 + 子 Agent）。 */
function sampleFleet(overrides) {
  return Object.assign({
    rootSessionId: 'session-root',
    currentSessionId: 'session-child',
    counts: { agents: 3, running: 1, subagents: 2 },
    agents: [
      {
        sessionId: 'session-root', title: '主会话', depth: 0,
        isCurrent: false, isRoot: true, running: false,
        mode: null, createdAt: 1791806835279,
        model: 'glm-5.3-flash', provider: 'zaicoding',
        contextWindow: 262144, pressureTokens: 1500,
        tokensTotal: 10461, turns: 2, steps: 3, activeMs: 12000,
        composition: { system: 2154, tools: 10439, user: 120, inject: 0, skill: 0, assistant: 900, tool: 300, total: 13913 }
      },
      {
        sessionId: 'session-child', title: '审阅子会话', label: 'reviewer', depth: 1,
        isCurrent: true, isRoot: false, running: true,
        mode: 'one-shot', createdAt: 1791806840000,
        contextWindow: 1000, pressureTokens: 250,
        tokensTotal: 2500, turns: 1, steps: 2, activeMs: 61000,
        composition: { system: 100, tools: 50, user: 25, inject: 0, skill: 0, assistant: 20, tool: 5, total: 200 }
      },
      {
        sessionId: 'session-grandchild', title: '孙会话', depth: 2,
        isCurrent: false, isRoot: false, running: false,
        mode: 'continuable', createdAt: 1791806850000,
        contextWindow: 0, pressureTokens: 9,
        tokensTotal: 0, turns: 0, steps: 0, activeMs: 0
      }
    ]
  }, overrides || {});
}

function fleetState(value, extra) {
  return Object.assign({
    loading: false, error: null, code: '', unsupported: false, asOfSeq: 42, value: value
  }, extra || {});
}

function build(value, extra, options) {
  return contextView.buildFleetPanel(fleetState(value, extra), Object.assign({
    connected: true, hasSession: true
  }, options || {}));
}

/** 视图模型必须能被 setData 序列化：任何 undefined 都会在 WXML 里丢字段。 */
function assertNoUndefined(value, path) {
  if (value === undefined) assert.fail('undefined at ' + (path || 'root'));
  if (value === null || typeof value !== 'object') return;
  Object.keys(value).forEach(function (key) {
    assert.notEqual(value[key], undefined, 'undefined at ' + (path ? path + '.' : '') + key);
    assertNoUndefined(value[key], (path ? path + '.' : '') + key);
  });
}

// ---------- 状态机 ----------

test('buildFleetPanel reports disconnected / no-session / loading before any snapshot', () => {
  assert.equal(contextView.buildFleetPanel(null, { connected: false }).status, 'disconnected');
  assert.equal(
    contextView.buildFleetPanel(null, { connected: false }).stateText,
    '连接网关后可查看编队'
  );
  assert.equal(contextView.buildFleetPanel(null, { connected: true, hasSession: false }).status, 'empty');
  assert.equal(
    contextView.buildFleetPanel(null, { connected: true, hasSession: false }).stateText,
    '打开会话后可查看编队'
  );
  assert.equal(contextView.buildFleetPanel(null, { connected: true, hasSession: true }).status, 'loading');
  assert.equal(contextView.buildFleetPanel(null, { connected: true, hasSession: true }).loading, true);
});

test('buildFleetPanel maps unsupported gateways and request errors to explicit states', () => {
  const unsupported = contextView.buildFleetPanel(
    fleetState(null, { unsupported: true, code: 'context-unavailable' }),
    { connected: true, hasSession: true }
  );
  assert.equal(unsupported.status, 'unsupported');
  assert.match(unsupported.stateText, /需升级网关/);
  assert.match(unsupported.hintText, /dsh-plugin-mobile-gateway/);
  assert.equal(unsupported.agents.length, 0);

  const failed = contextView.buildFleetPanel(
    fleetState(null, { error: 'boom' }),
    { connected: true, hasSession: true }
  );
  assert.equal(failed.status, 'error');
  assert.equal(failed.errorText, 'boom');
});

test('buildFleetPanel rejects a value without any fleet section but keeps loading during refresh', () => {
  assert.equal(build({}).status, 'error');
  assert.equal(build({}).errorText, '编队数据格式异常');
  assert.equal(build(42).status, 'error');
  assert.equal(build({}, { loading: true }).status, 'loading');
  // 刷新期间已有旧值 → 保持 ready，避免整块闪空。
  const stale = build(sampleFleet(), { loading: true });
  assert.equal(stale.status, 'ready');
  assert.equal(stale.loading, true);
  assert.equal(stale.agents.length, 3);
});

test('buildFleetPanel shows an empty state when the family has no agents', () => {
  const empty = build({ rootSessionId: 'session-root', agents: [], counts: { agents: 0, running: 0, subagents: 0 } });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.stateText, '暂无编队');
  assert.equal(empty.agents.length, 0);
  assert.equal(empty.overview, null);
  const emptyDuringRefresh = build({ agents: [] }, { loading: true });
  assert.equal(emptyDuringRefresh.status, 'empty');
  assert.equal(emptyDuringRefresh.loading, true);
});

// ---------- 总览 ----------

test('overview uses host counts and sums the family token usage', () => {
  const panel = build(sampleFleet());
  assert.equal(panel.status, 'ready');
  assert.equal(panel.asOfSeq, 42);
  assert.equal(panel.overview.agents, 3);
  assert.equal(panel.overview.agentsText, '3');
  assert.equal(panel.overview.running, 1);
  assert.equal(panel.overview.runningText, '1');
  assert.equal(panel.overview.subagents, 2);
  assert.equal(panel.overview.subagentsText, '2');
  assert.equal(panel.overview.tokensTotal, 10461 + 2500 + 0);
  assert.equal(panel.overview.tokensText, '13.0k');
  assertNoUndefined(panel);
});

test('overview falls back to the agent list when counts are missing', () => {
  const panel = build(sampleFleet({ counts: undefined }));
  assert.equal(panel.overview.agents, 3);
  assert.equal(panel.overview.running, 1, 'one running agent is counted from the cards');
  assert.equal(panel.overview.subagents, 2, 'agents minus the root are subagents');
});

// ---------- Agent 卡片 ----------

test('agent cards preserve hierarchy order and indent by depth', () => {
  const panel = build(sampleFleet());
  const cards = panel.agents;
  assert.deepEqual(cards.map(function (card) { return card.sessionId; }),
    ['session-root', 'session-child', 'session-grandchild']);
  assert.equal(cards[0].depth, 0);
  assert.equal(cards[0].indentStyle, 'margin-left:0rpx;');
  assert.equal(cards[1].depth, 1);
  assert.equal(cards[1].indentStyle, 'margin-left:24rpx;');
  assert.equal(cards[2].depth, 2);
  assert.equal(cards[2].indentStyle, 'margin-left:48rpx;');
  assert.equal(cards[0].isRoot, true);
  assert.equal(cards[1].isCurrent, true);
  assert.equal(cards[2].isRoot, false);
  assert.equal(cards[2].isCurrent, false);
  assert.equal(cards[0].title, '主会话');
  assert.equal(cards[1].title, '审阅子会话');
});

test('agent cards cap indentation but keep the reported depth', () => {
  const panel = build({
    agents: [{ sessionId: 'deep', title: 'deep', depth: 9, isRoot: false }]
  });
  assert.equal(panel.agents[0].depth, 9);
  assert.equal(panel.agents[0].indentStyle, 'margin-left:120rpx;');
});

test('agent cards expose running pulse, mode badges and state text', () => {
  const panel = build(sampleFleet());
  const [root, child, grand] = panel.agents;
  assert.equal(root.running, false);
  assert.equal(root.stateText, '空闲');
  assert.equal(root.modeText, '');
  assert.equal(child.running, true);
  assert.equal(child.stateText, '运行中');
  assert.equal(child.modeText, '一次性');
  assert.equal(grand.modeText, '可续');
  // 未知 mode 不渲染徽标，避免透传宿主脏值。
  const dirty = build({ agents: [{ sessionId: 's', mode: 'weird' }] });
  assert.equal(dirty.agents[0].modeText, '');
});

test('agent cards derive context occupancy from pressureTokens / contextWindow', () => {
  const panel = build(sampleFleet());
  const [root, child, grand] = panel.agents;
  assert.equal(child.occupancy.hasData, true);
  assert.equal(child.occupancy.width, 25);
  assert.equal(child.occupancy.pctText, '25.0%');
  assert.equal(child.occupancy.usedText, '250');
  assert.equal(child.occupancy.windowText, '1.0k');
  assert.equal(root.occupancy.hasData, true);
  assert.equal(root.occupancy.pctText, '0.6%');
  assert.equal(grand.occupancy.hasData, false, 'a zero context window cannot show a ratio');
  assert.equal(grand.occupancy.width, 0);
  const over = build({ agents: [{ sessionId: 's', pressureTokens: 5000, contextWindow: 1000 }] });
  assert.equal(over.agents[0].occupancy.width, 100, 'the bar is clamped at 100%');
  assert.equal(over.agents[0].occupancy.pctText, '100.0%');
});

test('agent cards stack the seven composition categories in canonical order', () => {
  const panel = build(sampleFleet());
  const card = panel.agents[1];
  assert.equal(card.composition.hasData, true);
  assert.equal(card.composition.totalText, '200');
  assert.deepEqual(card.composition.segments.map(function (seg) { return seg.key; }),
    ['system', 'tools', 'user', 'assistant', 'tool']);
  const width = card.composition.segments.reduce(function (sum, seg) { return sum + seg.width; }, 0);
  assert.ok(Math.abs(width - 100) < 0.001, 'segment widths cover the whole bar');
  assert.equal(card.composition.segments[0].width, 50);

  // total 缺失时按 7 类合计归一。
  const fallback = build({ agents: [{ sessionId: 's', composition: { system: 10, tools: 30 } }] });
  assert.equal(fallback.agents[0].composition.totalText, '40');
  assert.deepEqual(fallback.agents[0].composition.segments.map(function (seg) { return seg.width; }), [25, 75]);
  // total 被宿主异常置 0 时同样退回 7 类合计，不丢色条。
  const zeroTotal = build({ agents: [{ sessionId: 's', composition: { system: 10, tools: 30, total: 0 } }] });
  assert.equal(zeroTotal.agents[0].composition.hasData, true);
  assert.equal(zeroTotal.agents[0].composition.totalText, '40');
  // 全 0 组成不渲染空色条。
  const blank = build({ agents: [{ sessionId: 's', composition: { system: 0, total: 0 } }] });
  assert.equal(blank.agents[0].composition.hasData, false);
  assert.equal(blank.agents[0].composition.segments.length, 0);
});

test('agent cards degrade missing numeric fields to placeholders instead of NaN', () => {
  const panel = build({ agents: [{ sessionId: 'bare', title: 'bare' }] });
  const card = panel.agents[0];
  assert.equal(card.tokensText, '—');
  assert.equal(card.turnsText, '—');
  assert.equal(card.stepsText, '—');
  assert.equal(card.activeText, '—');
  assert.equal(card.stateText, '空闲');
  assert.equal(card.occupancy.hasData, false);
  assert.equal(card.composition.hasData, false);
  assertNoUndefined(panel);
});

test('agent cards survive hostile types and skip entries without a session id', () => {
  const panel = build({
    agents: [
      null, 42, 'nope', {}, { sessionId: '' },
      { sessionId: 'ok', title: 5, depth: '2', running: 'yes', mode: 7 },
      { sessionId: 'huge', depth: -3, pressureTokens: '250', contextWindow: '1000', tokensTotal: '2500', activeMs: '61000' }
    ]
  });
  assert.equal(panel.status, 'ready');
  assert.deepEqual(panel.agents.map(function (card) { return card.sessionId; }), ['ok', 'huge']);
  assert.equal(panel.agents[0].label, '');
  assert.equal(panel.agents[0].running, false);
  assert.equal(panel.agents[0].depth, 2);
  assert.equal(panel.agents[1].depth, 0, 'negative depth is clamped to the root level');
  assert.equal(panel.agents[1].occupancy.hasData, true);
  assert.equal(panel.agents[1].tokensText, '2.5k');
  assert.equal(panel.agents[1].activeText, '1m1s');
  // agents 不是数组时按空家族处理，不抛出。
  const notList = build(sampleFleet({ agents: 'nope' }));
  assert.equal(notList.status, 'empty');
  assert.equal(build({ counts: { agents: 0 } }).status, 'empty');
});

test('buildFleetPanel localises authored labels through the injected t()', () => {
  const translate = function (key, values) {
    let result = 'E:' + key;
    if (values) Object.keys(values).forEach(function (name) {
      result = result.split('{' + name + '}').join(String(values[name]));
    });
    return result;
  };
  const panel = contextView.buildFleetPanel(fleetState(sampleFleet()), {
    t: translate, connected: true, hasSession: true
  });
  assert.equal(panel.agents[0].stateText, 'E:空闲');
  assert.equal(panel.agents[1].stateText, 'E:运行中');
  assert.equal(panel.agents[1].modeText, 'E:一次性');
  const unsupported = contextView.buildFleetPanel(fleetState(null, { unsupported: true }), {
    t: translate, connected: true, hasSession: true
  });
  assert.equal(unsupported.stateText, 'E:需升级网关以显示编队');
});

// ---------- store 帧处理（context-fleet） ----------

/** 用与 tests/context-view.test.js 相同的方式加载 store，验证帧路由与刷新点。 */
function storeFixture() {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const filename = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const storeModule = { exports: {} };
  const timers = [];
  const requested = [];
  class Client {
    constructor(callbacks) { this.callbacks = callbacks; }
    requestContextFleet(sessionId) { requested.push(['fleet', sessionId]); return Promise.resolve(); }
    requestContextDashboard(sessionId) { requested.push(['dashboard', sessionId]); return Promise.resolve(); }
    requestSessionStats() { return Promise.resolve(); }
    requestContextUsage() { return Promise.resolve(); }
    subscribe() { return true; }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: storeModule, Date: Date, console: console,
    wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    require(name) {
      return name === './gateway' ? { GatewayClient: Client }
        : require(path.resolve(path.dirname(filename), name));
    }
  });
  const store = storeModule.exports;
  store.state.connection = 'connected';
  store.sessionState.sessionId = 'session-1';
  const frame = value => store.client.callbacks.onFrame(Object.assign({ sessionId: 'session-1' }, value));
  return { store: store, frame: frame, requested: requested, timers: timers };
}

test('store accepts context-fleet frames and ignores stale snapshots', () => {
  const f = storeFixture();
  f.frame({ kind: 'context-fleet', asOfSeq: 100, value: sampleFleet() });
  const fleet = f.store.sessionState.contextFleet;
  assert.equal(fleet.asOfSeq, 100);
  assert.equal(fleet.loading, false);
  assert.equal(fleet.error, null);
  assert.equal(fleet.value.rootSessionId, 'session-root');
  f.frame({ kind: 'context-fleet', asOfSeq: 90, value: { rootSessionId: 'older' } });
  assert.equal(f.store.sessionState.contextFleet.asOfSeq, 100, 'older snapshots are dropped');
  f.frame({ kind: 'context-fleet', asOfSeq: 120, value: { rootSessionId: 'newer' } });
  assert.equal(f.store.sessionState.contextFleet.value.rootSessionId, 'newer');
  // 编队帧不会写入上下文面板状态。
  assert.equal(f.store.sessionState.contextDashboard.value, null);
});

test('store maps context-fleet errors to the upgrade state without touching the dashboard', () => {
  const f = storeFixture();
  f.frame({ kind: 'error', code: 'context-unavailable', requestType: 'context-fleet', message: 'not registered' });
  assert.equal(f.store.sessionState.contextFleet.unsupported, true);
  assert.equal(f.store.sessionState.contextFleet.error, null);
  assert.equal(f.store.sessionState.contextFleet.code, 'context-unavailable');
  assert.equal(f.store.sessionState.contextDashboard.unsupported, false, 'dashboard state stays independent');
  f.frame({ kind: 'error', code: 'unknown-command', requestType: 'context-fleet', message: 'unknown message type: context-fleet' });
  assert.equal(f.store.sessionState.contextFleet.unsupported, true);
  f.frame({ kind: 'error', code: 'boom', requestType: 'context-fleet', message: 'kaboom' });
  assert.equal(f.store.sessionState.contextFleet.unsupported, false);
  assert.equal(f.store.sessionState.contextFleet.error, 'kaboom');
});

test('store requests the fleet only while the fleet tab is visible', () => {
  const f = storeFixture();
  f.store.setContextActive(true);
  assert.deepEqual(f.requested, [['dashboard', 'session-1']], 'context tab does not request the fleet');
  f.store.setFleetActive(true);
  assert.deepEqual(f.requested, [['dashboard', 'session-1'], ['fleet', 'session-1']]);
  assert.equal(f.store.sessionState.contextFleet.loading, true);
  f.store.setFleetActive(false);
  f.store.setFleetActive(false);
  assert.equal(f.requested.filter(function (item) { return item[0] === 'fleet'; }).length, 1,
    're-activating an already-visible tab does not refetch');
  f.store.setFleetActive(true);
  assert.equal(f.requested.filter(function (item) { return item[0] === 'fleet'; }).length, 2);
  assert.deepEqual(f.store.refreshContextFleet(), true);
  assert.equal(f.requested.filter(function (item) { return item[0] === 'fleet'; }).length, 3);
});

test('turn/end schedules a fleet refresh after 800ms while the fleet tab is visible', () => {
  const f = storeFixture();
  f.store.setFleetActive(true);
  const before = f.requested.filter(function (item) { return item[0] === 'fleet'; }).length;
  f.frame({ kind: 'event', seq: 7, event: { type: 'turn/end' } });
  const pending = f.timers.splice(0, f.timers.length);
  assert.ok(pending.length > 0, 'turn/end schedules the stats/fleet refresh timer');
  pending.forEach(function (fn) { fn(); });
  const after = f.requested.filter(function (item) { return item[0] === 'fleet'; }).length;
  assert.equal(after, before + 1, 'the visible fleet tab refreshes when the turn settles');
});

test('closing a session clears the fleet state', () => {
  const f = storeFixture();
  f.frame({ kind: 'context-fleet', asOfSeq: 10, value: sampleFleet() });
  f.store.closeSession();
  const fleet = f.store.sessionState.contextFleet;
  assert.equal(fleet.value, null);
  assert.equal(fleet.asOfSeq, null);
  assert.equal(fleet.unsupported, false);
  assert.equal(fleet.error, null);
});

// ---------- 页面集成：手势与点击 ----------

/** 与 tests/session-navigation.test.js 相同的方式加载会话页定义。 */
function pageFixture() {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const file = path.resolve(__dirname, '../miniprogram/pages/session/session.js');
  let definition;
  const calls = [];
  const store = {
    state: { sessions: [], archivedSessionIds: [], connection: 'connected' },
    sessionState: { sessionId: 'session-1', running: false, contextFleet: null, contextDashboard: null },
    openSession: (...args) => calls.push(['open', ...args]),
    loadOlderHistory: () => calls.push(['loadOlderHistory']),
    setFleetActive: active => calls.push(['fleetActive', active]),
    setContextActive: active => calls.push(['contextActive', active]),
    refreshContextFleet: () => calls.push(['refreshFleet']),
    client: {}
  };
  const wx = {
    hideKeyboard: () => calls.push(['hideKeyboard']),
    nextTick: fn => fn()
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; }, wx, console,
    setTimeout: () => 1, clearTimeout: () => {},
    require: name => name.endsWith('/store') ? store : name.endsWith('/haptics')
      ? { vibrate: () => calls.push(['haptic']), tick: () => calls.push(['tick']) }
      : require(path.resolve(path.dirname(file), name))
  });
  // 测试只关心页面 patch 是否落在 data 上，这里直接合并，保留嵌套路径。
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

test('horizontal gestures walk conversation ⇄ trajectory ⇄ context ⇄ fleet', () => {
  const { page, calls } = pageFixture();
  page.updateDockInset = function () {};
  const gesture = function (x, y, dx, dy) {
    page.onPanelTouchStart({ touches: [{ clientX: x, clientY: y }] });
    page.onPanelTouchMove({ touches: [{ clientX: x + dx, clientY: y + dy }] });
    page.onPanelTouchEnd({ changedTouches: [{ clientX: x + dx, clientY: y + dy }] });
  };
  page.data.tab = 'context';
  gesture(100, 100, -150, 10);
  assert.equal(page.data.tab, 'fleet', 'left swipe from context reaches fleet');
  assert.equal(page.data.fleetMounted, true);
  assert.ok(calls.some(function (call) { return call[0] === 'fleetActive' && call[1] === true; }));
  gesture(300, 100, 150, 10);
  assert.equal(page.data.tab, 'context', 'right swipe from fleet returns to context');
  gesture(300, 100, 150, 10);
  assert.equal(page.data.tab, 'trajectory', 'context still swipes back to trajectory');
  gesture(100, 100, -150, 10);
  gesture(100, 100, -150, 10);
  assert.equal(page.data.tab, 'fleet');
  gesture(100, 100, -150, 10);
  assert.equal(page.data.tab, 'fleet', 'the fleet tab is the right edge');
});

test('tapping a fleet agent opens its session and switches to the context tab', () => {
  const { page, calls } = pageFixture();
  page.data.tab = 'fleet';
  page.openFleetAgent({ currentTarget: { dataset: { id: 'session-child', title: '审阅子会话' } } });
  const opened = calls.find(function (call) { return call[0] === 'open'; });
  assert.deepEqual(opened, ['open', 'session-child', '审阅子会话', null]);
  assert.equal(page.data.tab, 'context');
  assert.ok(calls.some(function (call) { return call[0] === 'contextActive' && call[1] === true; }));
  // 没有 sessionId 的脏数据不触发打开。
  calls.length = 0;
  page.data.tab = 'fleet';
  page.openFleetAgent({ currentTarget: { dataset: {} } });
  assert.equal(calls.filter(function (call) { return call[0] === 'open'; }).length, 0);
  assert.equal(page.data.tab, 'fleet');
});

