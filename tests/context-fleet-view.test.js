'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('fleet members module renders flat: transparent card and chip groups', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  // 编队成员模块透明化（作用域限定，不影响共享的 .ctx-card / .ctx-gran）
  // 编队模块每张卡片都去背景：members / summary / graph / comms / 任务板(.fleet-card)
  for (const selector of ['.ctx-card.fleet-members,', '.ctx-card.fleet-summary,', '.ctx-card.fleet-graph-card,', '.ctx-card.fleet-comms,', '.fleet-card {']) {
    assert.ok(styles.includes(selector), 'the transparent group covers ' + selector);
  }
  assert.match(styles, /\.ctx-card\.fleet-members,[\s\S]{0,200}?\.fleet-card\s*\{[^}]*background:\s*transparent/, 'one grouped rule makes every fleet card transparent');
  // 只去背景：边框/投影沿用共享规则，不另行移除
  assert.doesNotMatch(styles, /\.fleet-card\s*\{[^}]*border:\s*0/, 'the fleet cards keep their border');
  assert.doesNotMatch(styles, /\.fleet-card\s*\{[^}]*box-shadow:\s*none/, 'the fleet cards keep their shadow');
  assert.match(styles, /\.fleet-member-toolbar \.ctx-gran\s*\{[^}]*background:\s*transparent/, 'the member filter chips drop their group fill');
  // 任务模块同样去灰：行/空态/chip 组透明（行保留边框）
  assert.match(styles, /\.fleet-task-row\s*\{[^}]*background:\s*transparent/, 'the task rows drop their fill');
  assert.match(styles, /\.fleet-task-row\s*\{[^}]*border:\s*1rpx solid var\(--divider\)/, 'the task rows keep their border');
  assert.match(styles, /\.fleet-task-empty\s*\{[^}]*background:\s*transparent/, 'the task empty state drops its fill');
  assert.match(styles, /\.fleet-task-card \.fleet-task-gran\s*\{[^}]*background:\s*transparent/, 'the task filter chips drop their group fill');
  assert.match(styles, /\.fleet-task-status\{[^}]*background:\s*transparent/, 'the base task badge drops its gray fill');
  // 成员行与 Agent 网络 stage 也不能有填充：后者会把透明卡片透成灰色
  assert.doesNotMatch(styles, /\.fleet-member\s*\{[^}]*background:\s*var\(--fill\)/, 'the member rows drop their fill');
  // 成员行保留完整边框（透明内容 + 描边），与网络卡片一致
  assert.match(styles, /\.fleet-member\s*\{[^}]*border:\s*1rpx solid var\(--border\)/, 'the member rows keep a full border');
  assert.match(styles, /\.fleet-member\s*\{[^}]*background:\s*transparent/, 'the member rows stay transparent inside');
  assert.match(styles, /\.fleet-node\{[^}]*background:\s*transparent[^}]*border:\s*1rpx solid var\(--border\)/, 'the network cards stay border-only with transparent content');
  // 只要边框：基础态无投影（否则透明卡片在白页面上仍像填充卡）；选中态外环保留
  // 注意区分：transition 列表里的 "box-shadow .2s" 不是阴影声明，要求冒号
  assert.doesNotMatch(styles, /\.fleet-node\s*\{[^}]*box-shadow\s*:/, 'the resting network card casts no shadow');
  assert.match(styles, /\.fleet-node\.selected\s*\{[^}]*box-shadow/, 'the selected network card keeps its ring');
  assert.match(styles, /\.fleet-stage\s*\{[^}]*background:\s*transparent/, 'the graph stage drops its gradient so cards read transparent');
  assert.doesNotMatch(styles, /linear-gradient\(180deg,\s*var\(--surface\),\s*var\(--fill\)\)/, 'no gradient bleeding through the graph cards');
  assert.doesNotMatch(styles, /\.fleet-member-toolbar \.ctx-gran\s*\{[^}]*border:\s*0/, 'the chip group keeps its border');
  // 共享规则不被误伤：浏览器/趋势的 chip 组仍保有底色
  assert.match(styles, /\.ctx-gran\s*\{[^}]*background:\s*var\(--fill\)/, 'the shared chip group keeps its fill elsewhere');
  const template = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  assert.match(template, /class="ctx-card fleet-members"/, 'the members card carries the scoping class');
  assert.match(template, /class="fleet-member-toolbar"/, 'the member toolbar carries the scoping class');
});

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

test('overview derives counts and context-token totals from the DSH headline, not billed usage', () => {
  const panel = build(sampleFleet({ counts: { agents: 1, running: 0, subagents: 0 } }));
  assert.equal(panel.status, 'ready');
  assert.equal(panel.asOfSeq, 42);
  assert.equal(panel.overview.agents, 3);
  assert.equal(panel.overview.agentsText, '3');
  assert.equal(panel.overview.running, 1);
  assert.equal(panel.overview.runningText, '1');
  assert.equal(panel.overview.subagents, 2);
  assert.equal(panel.overview.subagentsText, '2');
  assert.equal(panel.overview.tokensTotal, 1500 + 250 + 9);
  assert.equal(panel.overview.tokensText, '1.8k');
  assert.equal(panel.summary.chips[0].text, '3 个 Agent');
  assert.equal(panel.summary.chips[1].text, '1 个运行中');
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
  assert.equal(cards[0].hasBranch, false);
  assert.equal(cards[1].hasBranch, true);
  assert.match(cards[1].branchStyle, /left:12rpx/);
  assert.match(cards[1].branchLineStyle, /bottom:0/);
  assert.equal(cards[0].title, '主会话');
  assert.equal(cards[1].title, '审阅子会话');
});

test('agent cards preserve subagent history addresses for communication scans', () => {
  const panel = build({
    rootSessionId: 'root', currentSessionId: 'root',
    agents: [
      { sessionId: 'root', depth: 0, isRoot: true },
      { sessionId: 'child', depth: 1, parentSessionId: 'root', origin: 'subagent', mode: 'continuable' },
      { sessionId: 'grandchild', depth: 2, parentSessionId: 'child', origin: 'subagent', mode: 'one-shot' }
    ]
  });
  assert.deepEqual(panel.agents.slice(1).map(function (card) {
    return [card.sessionId, card.origin, card.parentSessionId, card.mode];
  }), [
    ['child', 'subagent', 'root', 'continuable'],
    ['grandchild', 'subagent', 'child', 'one-shot']
  ]);
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

test('fleet comms localises the completed continuable and one-shot child reports', () => {
  const translate = key => 'E:' + key;
  const panel = build(sampleFleet(), null, {
    t: translate,
    commsValue: { scanned: 3, total: 2, messages: [
      { seq: 3, time: 3000, kind: 'settled', from: 'session-child', to: 'session-root', text: 'Background subagent child finished and will do no further work unless you send it more.' },
      { seq: 2, time: 2000, kind: 'settled', from: 'session-grandchild', to: 'session-child', text: 'Background subagent child finished. It cannot receive follow-up messages.' },
    ] }
  });
  assert.equal(panel.comms.rows[0].text, 'E:完成了任务，等待新指令');
  assert.equal(panel.comms.rows[1].text, 'E:已完成（一次性，无法追问）');
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
    setTimeout(fn, delay) { if (fn) fn.delay = delay; timers.push(fn); return timers.length; }, clearTimeout() {},
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

test('disconnecting the gateway stops context and fleet polling without throwing', () => {
  const f = storeFixture();
  f.store.setContextActive(true);
  f.store.setFleetActive(true);

  assert.doesNotThrow(function () {
    f.store.client.callbacks.onState('disconnected', 'connection closed');
  });
  assert.equal(f.store.state.connection, 'disconnected');
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

test('member sort expands under its control and closes after selecting an option', () => {
  const { page } = pageFixture();
  page.fleetPanelPatch = () => ({ fleetPanel: {} });
  page.openFleetMemberSort();
  assert.equal(page.data.fleetMemberSortOpen, true);
  page.openFleetMemberSort();
  assert.equal(page.data.fleetMemberSortOpen, false, 'tapping the control toggles the menu closed');
  page.openFleetMemberSort();
  page.setFleetMemberSort({ currentTarget: { dataset: { sort: 'steps' } } });
  assert.equal(page.data.fleetMemberSort, 'steps');
  assert.equal(page.data.fleetMemberSortOpen, false);
});

test('entering the fleet tab starts the on-demand comms scan after its panel is rendered', () => {
  const { page, calls } = pageFixture();
  page.data.tab = 'context';
  page.data.showFleetPanel = true;
  page.fleetPanelPatch = () => ({ fleetPanel: { agents: [{ sessionId: 'root' }, { sessionId: 'child' }] } });
  page.measureFleetStage = () => {};
  page.maybeAutoScanFleetComms = () => calls.push(['autoScanComms']);
  page.prioritizeInteraction = () => {};
  page.cancelVoice = () => {};
  page.closeAttachMenu = () => {};
  const setData = page.setData;
  page.setData = function (patch, callback) {
    setData.call(this, patch);
    if (typeof callback === 'function') callback();
  };

  page.switchTab({ currentTarget: { dataset: { tab: 'fleet' } } });

  assert.equal(page.data.tab, 'fleet');
  assert.ok(calls.some(call => call[0] === 'autoScanComms'), 'scan is kicked off after setData mounts the fleet panel');
});

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


// ---------- v2：team（成员 role/phase、最新回答、任务） ----------

function sampleTeamFleet(overrides) {
  return Object.assign(sampleFleet(), {
    team: {
      members: [
        { id: 'session-root', name: 'lead', role: 'lead', phase: 'active' },
        { id: 'session-child', name: 'reviewer', role: 'reviewer', phase: 'idle' }
      ],
      tasks: [
        { id: 'task-1', subject: '实现组件', status: 'in_progress', ownerName: '阿青', ownerId: 'session-root' },
        { id: 'task-2', subject: '审查实现', status: 'completed', ownerName: '小北' },
        { id: 'task-3', subject: '补充测试', status: 'pending' }
      ],
      failure: ''
    },
    agents: [
      Object.assign({}, sampleFleet().agents[0], {
        phase: 'active', lastAnswer: '同步完成，本地已经和 GitHub 对齐。\n等待下一步指令。'
      }),
      Object.assign({}, sampleFleet().agents[1], {
        phase: 'idle', lastAnswer: '审阅完成：没有发现阻塞问题。'
      }),
      sampleFleet().agents[2]
    ]
  }, overrides || {});
}

test('v2 fleet matches team members to agents and shows role / phase / latest answer', () => {
  const panel = build(sampleTeamFleet());
  assert.equal(panel.status, 'ready');
  const [root, child] = panel.agents;
  assert.equal(root.role, 'lead');
  assert.equal(root.roleText, '角色 lead');
  assert.equal(root.phaseText, '运行中');
  assert.equal(root.phaseClass, 'active');
  assert.equal(root.hasAnswer, true);
  assert.match(root.lastAnswer, /GitHub/);
  assert.equal(child.role, 'reviewer');
  assert.equal(child.phaseText, '空闲');
  assert.equal(child.phaseClass, 'idle');
  assert.equal(panel.agents[2].hasAnswer, false);
  assert.equal(panel.agents[2].phaseText, '');
  assert.equal(panel.members.rows.find(row => row.id === 'session-root').stateKind, 'idle',
    'inactive leads keep DSH’s neutral dot even when the session has recent activity');
  assertNoUndefined(panel);
});

test('v2 fleet truncates the latest answer and ignores hostile team payloads', () => {
  const long = 'x'.repeat(400);
  const panel = build(sampleFleet({
    team: { members: 'nope', tasks: 'nope', failure: 42 },
    agents: [{ sessionId: 's', title: 's', lastAnswer: long, phase: 'weird' }]
  }));
  assert.equal(panel.agents[0].lastAnswer.length, 241, 'the client caps the answer at 240 chars plus an ellipsis');
  assert.equal(panel.agents[0].phaseText, 'weird', 'unknown phases pass through as data');
  assert.equal(panel.team.hasTeam, true);
  assert.equal(panel.team.tasks.length, 1, 'unrostered family agents appear even if the persisted task array is malformed');
  assert.equal(panel.team.tasks[0].kind, 'agent');
});

test('v2 fleet task rows carry subject, status badge and owner with an empty state', () => {
  const panel = build(sampleTeamFleet());
  assert.equal(panel.team.hasTeam, true);
  assert.equal(panel.team.tasks.length, 4);
  assert.deepEqual(panel.team.tasks.slice(0, 3).map(task => task.subject), ['实现组件', '审查实现', '补充测试']);
  assert.deepEqual(panel.team.tasks.slice(0, 3).map(task => task.statusText), ['进行中', '已完成', '待处理']);
  assert.deepEqual(panel.team.tasks.slice(0, 3).map(task => task.statusClass), ['active', 'done', 'pending']);
  assert.deepEqual(panel.team.tasks.slice(0, 3).map(task => task.kind), ['team', 'team', 'team']);
  assert.equal(panel.team.tasks[3].kind, 'agent', 'unrostered family sessions are listed as delegated work');
  assert.equal(panel.team.tasks[3].subject, '孙会话');
  assert.equal(panel.team.tasks[0].ownerText, '阿青');
  assert.equal(panel.team.tasks[2].ownerText, '');
  assert.equal(panel.team.teamTaskCount, 3, 'only persisted tasks drive the team progress summary');
  assert.equal(panel.team.taskCountText, '4', 'the task-board count also includes delegated agents');
  // Match DSH's filters: real tasks and delegated agents share the same status buckets.
  const active = build(sampleTeamFleet(), null, { taskStatus: 'in_progress' });
  assert.deepEqual(active.team.tasks.map(task => task.subject), ['实现组件']);
  assert.equal(active.team.statusChips[1].count, 1);
  const all = build(sampleTeamFleet(), null, { taskStatus: 'all' });
  assert.equal(all.team.tasks.length, 4, 'the all filter remains inclusive');
  // Family sessions populate the board even if no Agent Teams projection is present.
  const noTeam = build(sampleFleet({ team: undefined }));
  assert.equal(noTeam.team.tasksEmpty, false);
  assert.equal(noTeam.team.tasks.length, 2);
  assert.equal(noTeam.team.tasks.every(task => task.kind === 'agent'), true);
  const emptyTeam = build(sampleTeamFleet({ team: { tasks: [] } }));
  assert.equal(emptyTeam.team.tasksEmpty, false, 'a family delegation still appears when the shared team task list is empty');
  assert.equal(emptyTeam.team.tasks.length, 2);
  const solo = build(sampleFleet({ rootSessionId: 'only', currentSessionId: 'only', agents: [{ sessionId: 'only', title: '当前会话', isCurrent: true }] }));
  assert.equal(solo.team.tasksEmpty, true);
  assert.ok(solo.team.tasksEmptyText.length > 0);
  assert.equal(build(sampleTeamFleet({ team: { tasks: [], members: [] } })).team.tasks.length, 2,
    'without a roster, both non-current family sessions are delegated rows');
});

test('v2 fleet shows the delegation hint only for a single agent', () => {
  const single = build({ rootSessionId: 'session-root', agents: [sampleFleet().agents[0]] });
  assert.equal(single.agents.length, 1);
  assert.match(single.subagentHint, /还没有子 Agent/);
  assert.match(single.subagentHint, /subagent/);
  assert.equal(build(sampleFleet()).subagentHint, '');
});

// ---------- store v2：编队轮询 ----------

test('visible fleet tab polls every 2.5s while running and stops on turn end', () => {
  const f = storeFixture();
  const fleets = () => f.requested.filter(item => item[0] === 'fleet').length;
  f.frame({ kind: 'sent' });
  f.store.setFleetActive(true);
  assert.equal(fleets(), 1);
  f.frame({ kind: 'context-fleet', asOfSeq: 1, value: sampleFleet() });
  const poll = () => f.timers.filter(fn => fn.delay === 2500).forEach(fn => fn());
  poll();
  assert.equal(fleets(), 2);
  // 上一帧未返回：自动轮询不叠加。
  poll();
  assert.equal(fleets(), 2);
  f.frame({ kind: 'context-fleet', asOfSeq: 2, value: sampleFleet() });
  poll();
  assert.equal(fleets(), 3);
  f.frame({ kind: 'event', event: { type: 'turn/end' } });
  poll();
  assert.equal(fleets(), 3);
  // 切走编队分段后再次运行也不轮询。
  f.frame({ kind: 'event', event: { type: 'turn/start' } });
  f.store.setFleetActive(false);
  poll();
  assert.equal(fleets(), 3);
});

test('closing a session stops both panel pollers', () => {
  const f = storeFixture();
  f.frame({ kind: 'sent' });
  f.store.setContextActive(true);
  f.store.setFleetActive(true);
  f.frame({ kind: 'context-dashboard', asOfSeq: 1, value: { current: { system: 1 } } });
  f.frame({ kind: 'context-fleet', asOfSeq: 1, value: sampleFleet() });
  f.store.closeSession();
  const before = f.requested.length;
  f.store.sessionState.running = true;
  f.timers.filter(fn => fn.delay === 2500).forEach(fn => fn());
  assert.equal(f.requested.length, before, 'no panel request after the session was closed');
});
