'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contextView = require('../miniprogram/utils/context-view');

/** 文档第 3 节的示例 value（mobileContext wire view + breakdown/usage/stats）。 */
function sampleValue(overrides) {
  return Object.assign({
    v: 1,
    model: 'glm-5.3-flash',
    provider: 'zaicoding',
    contextWindow: 262144,
    current: { system: 2154, tools: 10439, user: 123, inject: 456, skill: 78, assistant: 9000, tool: 3000, total: 25250 },
    counts: { humanInputs: 12, answers: 16, toolCalls: 4304, skillLoads: 0, injects: 700, compactions: 12, prunes: 42 },
    tools: { total: 4304, names: [{ name: 'bash', count: 221 }, { name: 'read', count: 32 }] },
    timing: { wallMs: 4980000 },
    requests: [{ seq: 53, time: 1791807408490, turn: 2, step: 1, system: 2154, tools: 10439, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 12593 }],
    events: [{ seq: 1065, time: 1791818836065, kind: 'compaction', tokens: 128609, count: 3 }],
    truncated: { requests: false, events: false, surface: false },
    breakdown: { systemTokens: 2154, toolsTokens: 10439, messageTokens: 475830 },
    usage: {
      uncachedInputTokens: 18428410,
      outputTokens: 2005193,
      cacheReadTokens: 1418019922,
      cacheWriteTokens: 757534
    },
    stats: {
      turns: 476, steps: 4586, llmMs: 42456270, toolMs: 12253849,
      ttftMs: 19504165, ttftSteps: 4566, decodeMs: 22898931, decodeTokens: 2005193
    }
  }, overrides || {});
}

function dashboard(value, extra) {
  return Object.assign({
    loading: false, error: null, code: '', unsupported: false, asOfSeq: 32619, value: value
  }, extra || {});
}

function requests(count, options) {
  const opts = options || {};
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const turn = opts.turnOf ? opts.turnOf(i) : i + 1;
    out.push({
      seq: i * 2,
      time: 1700000000000 + i * 1000,
      turn: turn,
      system: 100,
      tools: 200,
      user: 10,
      inject: 0,
      skill: 0,
      assistant: 5,
      tool: 5,
      total: 320 + (opts.totalOf ? opts.totalOf(i) : i)
    });
  }
  return out;
}

// ---------- 数字格式化 ----------

test('formatCompact keeps one decimal for k/M and leaves small integers whole', () => {
  assert.equal(contextView.formatCompact(0), '0');
  assert.equal(contextView.formatCompact(999), '999');
  assert.equal(contextView.formatCompact(1234), '1.2k');
  assert.equal(contextView.formatCompact(4304), '4.3k');
  assert.equal(contextView.formatCompact(75200000), '75.2M');
  assert.equal(contextView.formatCompact(undefined), '0');
  assert.equal(contextView.formatCompact('nope'), '0');
});

test('formatPercent handles zero totals, crumbs and caps', () => {
  assert.equal(contextView.formatPercent(0, 100), '0.0%');
  assert.equal(contextView.formatPercent(1, 3), '33.3%');
  assert.equal(contextView.formatPercent(1, 100000), '<0.1%');
  assert.equal(contextView.formatPercent(100, 0), '—');
  assert.equal(contextView.formatPercent(500, 100), '100.0%');
});

test('formatDuration renders compact locale-free durations', () => {
  assert.equal(contextView.formatDuration(0), '—');
  assert.equal(contextView.formatDuration(480), '480ms');
  assert.equal(contextView.formatDuration(1500), '1.5s');
  assert.equal(contextView.formatDuration(65000), '1m5s');
  assert.equal(contextView.formatDuration(4980000), '1h23m');
});

test('formatTime zero-pads and rejects unusable timestamps', () => {
  assert.match(contextView.formatTime(1791807408490), /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(contextView.formatTime(undefined), '—');
  assert.equal(contextView.formatTime(NaN), '—');
});

// ---------- Prompt 组成 / Token 分摊 ----------

test('officialParts anchors system/tools/messages on breakdown and keeps the largest class residual', () => {
  const parts = contextView.officialParts(
    { system: 1000, tools: 500, user: 100, inject: 100, skill: 100, assistant: 100, tool: 100 },
    { systemTokens: 2000, toolsTokens: 1000, messageTokens: 400 }
  );
  const byKey = {};
  parts.forEach(part => { byKey[part.key] = part.value; });
  assert.equal(byKey.system, 2000);
  assert.equal(byKey.tools, 1000);
  assert.equal(byKey.user + byKey.inject + byKey.skill + byKey.assistant + byKey.tool, 400);
  assert.equal(parts.length, 7);
});

test('officialParts falls back to the fold surface when breakdown is missing', () => {
  const parts = contextView.officialParts(
    { system: 10, tools: 20, user: 1, inject: 0, skill: 0, assistant: 0, tool: 0 },
    null
  );
  const byKey = {};
  parts.forEach(part => { byKey[part.key] = part.value; });
  assert.equal(byKey.system, 10);
  assert.equal(byKey.tools, 20);
  assert.equal(byKey.user, 1);
  assert.equal(byKey.inject + byKey.skill + byKey.assistant + byKey.tool, 0);
});

test('scaleParts proportions the heuristic composition onto the billed input exactly', () => {
  const parts = contextView.officialParts(
    { system: 1000, tools: 500, user: 100, inject: 100, skill: 100, assistant: 100, tool: 100 },
    { systemTokens: 2000, toolsTokens: 1000, messageTokens: 400 }
  );
  const scaled = contextView.scaleParts(parts, 5000);
  const sum = scaled.reduce((total, part) => total + part.value, 0);
  assert.equal(sum, 5000);
});

test('deriveTokens follows the doc billing rules: exact total, ≈ estimates, output exact, one-decimal cache hit', () => {
  const tokens = contextView.deriveTokens({
    current: { system: 1000, tools: 500, user: 100, inject: 100, skill: 100, assistant: 100, tool: 100 },
    breakdown: { systemTokens: 2000, toolsTokens: 1000, messageTokens: 400 },
    usage: { uncachedInputTokens: 1000, cacheReadTokens: 3000, cacheWriteTokens: 1000, outputTokens: 500 }
  }, key => key);
  assert.equal(tokens.available, true);
  assert.equal(tokens.input, 5000);
  assert.equal(tokens.output, 500);
  assert.equal(tokens.total, 5500);
  assert.equal(tokens.totalText, '5.5k');
  assert.equal(tokens.cacheHitText, '60.0%');
  assert.equal(tokens.rows.length, 8);
  const promptRows = tokens.rows.slice(0, 7);
  assert.equal(promptRows.reduce((sum, row) => sum + row.value, 0), 5000);
  promptRows.forEach(row => {
    assert.equal(row.estimate, true);
    assert.ok(row.display.indexOf('≈') === 0, row.key + ' uses the ≈ marker');
  });
  const output = tokens.rows[7];
  assert.equal(output.key, 'output');
  assert.equal(output.estimate, false);
  assert.equal(output.display, '500');
  assert.equal(output.value, 500);
});

test('deriveTokens reports an unavailable usage report instead of inventing values', () => {
  const tokens = contextView.deriveTokens({ current: {}, usage: null }, key => key);
  assert.equal(tokens.available, false);
  assert.equal(tokens.total, 0);
  assert.equal(tokens.totalText, '—');
  assert.equal(tokens.cacheHitText, '—');
  assert.ok(tokens.rows.every(row => row.display === '—'));
});

test('deriveTokens clamps cache hit to one decimal and handles a zero input', () => {
  const tokens = contextView.deriveTokens({
    current: { system: 1 },
    breakdown: null,
    usage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 7 }
  }, key => key);
  assert.equal(tokens.cacheHitText, '—');
  assert.equal(tokens.total, 7);
});

test('token labels go through the injected translator', () => {
  const tokens = contextView.deriveTokens(sampleValue(), (key, values) => {
    const text = 'E:' + key;
    return values ? text + ':' + JSON.stringify(values) : text;
  });
  assert.equal(tokens.rows[0].label, 'E:系统提示词');
  assert.equal(tokens.rows[7].label, 'E:输出');
});

// ---------- 统计卡 ----------

test('deriveStats converts counts, top tools and the other bucket into display strings', () => {
  const tokens = contextView.deriveTokens(sampleValue(), key => key);
  const stats = contextView.deriveStats(sampleValue(), tokens, key => key);
  assert.equal(stats.toolTotalText, '4.3k');
  assert.equal(stats.toolNames.length, 2);
  assert.deepEqual(stats.toolNames[0], { name: 'bash', count: 221, countText: '221' });
  assert.equal(stats.otherText, '其他 +4.1k');
  assert.equal(stats.turnsText, '476');
  assert.equal(stats.stepsText, '4.6k');
  assert.equal(stats.answersText, '16');
  assert.deepEqual(stats.chips.map(chip => chip.text), ['700', '12', '42']);
  assert.equal(stats.usageTotalText, tokens.totalText);
});

test('deriveStats tolerates missing sections', () => {
  const stats = contextView.deriveStats({}, { totalText: '—', cacheHitText: '—', cacheHitLabel: '缓存命中' }, key => key);
  assert.equal(stats.toolTotal, 0);
  assert.equal(stats.toolNames.length, 0);
  assert.equal(stats.otherText, '');
  assert.equal(stats.chips.length, 3);
});

// ---------- 耗时统计 ----------

test('deriveTiming splits wait / reply / tool execution with shares, durations and tallies', () => {
  const timing = contextView.deriveTiming({
    counts: { answers: 4, toolCalls: 2 },
    stats: { ttftMs: 1000, ttftSteps: 2, decodeMs: 3000, steps: 10, toolMs: 2000 },
    timing: { wallMs: 10000 }
  });
  assert.equal(timing.activeText, '10.0s');
  assert.deepEqual(timing.segments.map(segment => segment.pctText), ['16.7%', '50.0%', '33.3%']);
  assert.deepEqual(timing.segments.map(segment => segment.durationText), ['1.0s', '3.0s', '2.0s']);
  assert.deepEqual(timing.segments.map(segment => segment.countText), ['2 次', '4 次', '2 次']);
  const width = timing.segments.reduce((sum, segment) => sum + segment.width, 0);
  assert.ok(Math.abs(width - 100) < 1e-9);
});

test('deriveTiming falls back to steps for replies and shows dashes when nothing ran', () => {
  const timing = contextView.deriveTiming({ counts: {}, stats: { decodeMs: 900, steps: 3 }, timing: {} });
  assert.equal(timing.segments[1].countText, '3 次');
  assert.equal(timing.activeText, '—');
  const empty = contextView.deriveTiming({});
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.segments.map(segment => segment.pctText), ['—', '—', '—']);
});

// ---------- 趋势 ----------

test('deriveTrend sorts requests ascending and stacks only non-zero categories', () => {
  const trend = contextView.deriveTrend({ requests: [requests(1)[0], Object.assign({}, requests(1)[0], { seq: 5, turn: 0 })] }, key => key);
  assert.equal(trend.count, 2);
  assert.deepEqual(trend.bars.map(bar => bar.seq), [0, 5]);
  assert.deepEqual(trend.bars[0].segments.map(segment => segment.key), ['system', 'tools', 'user', 'assistant', 'tool']);
  assert.equal(trend.bars[0].height, 100);
  assert.equal(trend.bars[0].showTurn, true);
  assert.equal(trend.axis.length, 1, 'dense turn changes are thinned out');
  assert.equal(trend.axis[0].left, 0);
  assert.equal(trend.trackWidth, 2 * 24 - 6 + 72);
});

test('deriveTrend aggregates more than 120 requests by turn using each turn last record', () => {
  const trend = contextView.deriveTrend({
    requests: requests(130, { turnOf: index => Math.floor(index / 2) + 1 })
  }, key => key);
  assert.equal(trend.totalCount, 130);
  assert.equal(trend.aggregated, true);
  assert.equal(trend.count, 65);
  // 该轮最后一条（index 1）的 total = 320 + 1。
  assert.equal(trend.bars[0].total, 321);
  assert.equal(trend.bars[0].seq, 2);
});

test('deriveTrend attaches ✂ markers to the first bar at/after the event seq', () => {
  const trend = contextView.deriveTrend({
    requests: requests(5),
    events: [
      { seq: 3, kind: 'compaction' },
      { seq: 4, kind: 'prune' },
      { seq: 99, kind: 'inject' }
    ]
  }, key => key);
  assert.equal(trend.bars[2].marker, '✂×2');
  assert.equal(trend.bars[0].marker, '');
  assert.equal(trend.bars[4].marker, '');
  // inject 事件不参与压缩/剪枝标记。
  assert.equal(trend.bars.filter(bar => bar.marker).length, 1);
});

test('deriveTrend keeps bars empty and safe without requests', () => {
  const trend = contextView.deriveTrend({ requests: null }, key => key);
  assert.equal(trend.empty, true);
  assert.equal(trend.count, 0);
  assert.equal(trend.bars.length, 0);
});

// ---------- 事件列表 ----------

test('deriveEvents lists the latest events first with labels and token deltas', () => {
  const events = contextView.deriveEvents({
    events: [
      { seq: 10, time: 1700000000000, kind: 'inject', name: 'system prompt' },
      { seq: 20, time: 1700000001000, kind: 'compaction', tokens: 128609, count: 3 },
      { seq: 30, time: 1700000002000, kind: 'prune', tokens: 2048 }
    ]
  }, key => key);
  assert.equal(events.rows.length, 3);
  assert.equal(events.rows[0].kindText, '剪枝');
  assert.equal(events.rows[0].tokensText, '−2.0k');
  assert.equal(events.rows[1].kindText, '压缩');
  assert.equal(events.rows[1].countText, '×3');
  assert.equal(events.rows[1].tokensText, '−128.6k');
  assert.equal(events.rows[2].kindText, '注入');
  assert.equal(events.rows[2].name, 'system prompt');
  assert.match(events.rows[0].timeText, /^\d{2}:\d{2}:\d{2}$/);
});

// ---------- 面板状态 / 防御性校验 ----------

test('buildPanel distinguishes disconnected, empty, loading, unsupported, error and ready', () => {
  assert.equal(contextView.buildPanel(null, { connected: false, hasSession: true }).status, 'disconnected');
  assert.equal(contextView.buildPanel(null, { connected: true, hasSession: false }).status, 'empty');
  assert.equal(contextView.buildPanel(null, { connected: true, hasSession: true }).status, 'loading');
  assert.equal(contextView.buildPanel({ loading: true }, { connected: true, hasSession: true }).status, 'loading');

  const unsupported = contextView.buildPanel(dashboard(null, { unsupported: true }), { connected: true, hasSession: true });
  assert.equal(unsupported.status, 'unsupported');
  assert.ok(unsupported.stateText.length > 0);
  assert.ok(unsupported.hintText.length > 0);

  const failed = contextView.buildPanel(dashboard(null, { error: 'boom' }), { connected: true, hasSession: true });
  assert.equal(failed.status, 'error');
  assert.equal(failed.errorText, 'boom');

  const ready = contextView.buildPanel(dashboard(sampleValue()), { connected: true, hasSession: true });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.asOfSeq, 32619);
  assert.equal(ready.meta.model, 'glm-5.3-flash');
  assert.equal(ready.meta.contextWindowText, '262.1k');
  assert.equal(ready.stats.toolTotalText, '4.3k');
  assert.equal(ready.tokens.rows.length, 8);
  assert.equal(ready.timing.segments.length, 3);
  assert.equal(ready.trend.count, 1);
  assert.equal(ready.events.rows.length, 1);
});

test('buildPanel refuses a value without any recognisable context section', () => {
  const malformed = contextView.buildPanel(dashboard({}), { connected: true, hasSession: true });
  assert.equal(malformed.status, 'error');
  assert.ok(malformed.errorText.length > 0);
  const allNull = contextView.buildPanel(dashboard({
    current: null, usage: null, counts: null, tools: null, timing: null,
    stats: null, requests: null, events: null, breakdown: null
  }), { connected: true, hasSession: true });
  assert.equal(allNull.status, 'error');
  // 刷新中且还没有值 → 保持 loading，不闪错误。
  assert.equal(contextView.buildPanel({ loading: true, value: {} }, { connected: true, hasSession: true }).status, 'loading');
});

test('buildPanel never throws on hostile field types and degrades to zeros', () => {
  const panel = contextView.buildPanel(dashboard({
    current: 'x', usage: 5, counts: [], tools: null, timing: 0,
    stats: 's', requests: 'x', events: 7, breakdown: []
  }), { connected: true, hasSession: true });
  assert.equal(panel.status, 'ready');
  assert.equal(panel.tokens.available, false);
  assert.equal(panel.stats.toolTotal, 0);
  assert.equal(panel.timing.hasData, false);
  assert.equal(panel.trend.empty, true);
  assert.equal(panel.events.rows.length, 0);
});

test('buildPanel handles a partially filled value without crashing', () => {
  const panel = contextView.buildPanel(dashboard({ current: { system: 100 } }), { connected: true, hasSession: true });
  assert.equal(panel.status, 'ready');
  assert.equal(panel.tokens.available, false);
  const tokens = contextView.buildPanel(dashboard({
    current: { system: 100, tools: 50 },
    usage: { outputTokens: 25 }
  }), { connected: true, hasSession: true });
  assert.equal(tokens.status, 'ready');
  assert.equal(tokens.tokens.total, 25);
  assert.equal(tokens.tokens.input, 0);
});

test('buildPanel localises every authored label through the injected t()', () => {
  const translate = (key, values) => {
    let result = 'E:' + key;
    if (values) Object.keys(values).forEach(name => { result = result.split('{' + name + '}').join(String(values[name])); });
    return result;
  };
  const panel = contextView.buildPanel(dashboard(sampleValue()), { connected: true, hasSession: true, t: translate });
  assert.equal(panel.tokens.rows[0].label, 'E:系统提示词');
  assert.equal(panel.stats.chips[0].label, 'E:注入');
  assert.equal(panel.stats.otherText, 'E:其他 +4.1k');
  assert.equal(panel.timing.segments[0].label, 'E:模型等待');
  assert.equal(panel.timing.segments[0].countText, 'E:4.6k 次');
});

test('buildPanel keeps the previous value while a refresh is in flight', () => {
  const panel = contextView.buildPanel(dashboard(sampleValue(), { loading: true }), { connected: true, hasSession: true });
  assert.equal(panel.status, 'ready');
  assert.equal(panel.loading, true);
  assert.equal(panel.tokens.rows.length, 8);
});

// ---------- store 帧处理（context-dashboard） ----------

/** 用与 tests/desktop-live-session.test.js 相同的方式加载 store，验证帧路由与刷新点。 */
function storeFixture() {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const filename = path.resolve(__dirname, '../miniprogram/utils/store.js');
  const module = { exports: {} };
  const timers = [];
  const requested = [];
  class Client {
    constructor(callbacks) { this.callbacks = callbacks; }
    requestContextDashboard(sessionId) { requested.push(sessionId); return Promise.resolve(); }
    requestSessionStats() { return Promise.resolve(); }
    requestContextUsage() { return Promise.resolve(); }
    subscribe() { return true; }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, Date: Date, console: console,
    wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} },
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    require(name) {
      return name === './gateway' ? { GatewayClient: Client }
        : require(path.resolve(path.dirname(filename), name));
    }
  });
  const store = module.exports;
  store.state.connection = 'connected';
  store.sessionState.sessionId = 'session-1';
  const frame = value => store.client.callbacks.onFrame(Object.assign({ sessionId: 'session-1' }, value));
  return { store: store, frame: frame, requested: requested, timers: timers };
}

test('store accepts context-dashboard frames and ignores stale snapshots', () => {
  const f = storeFixture();
  f.frame({ kind: 'context-dashboard', asOfSeq: 32619, value: sampleValue() });
  const dashboard = f.store.sessionState.contextDashboard;
  assert.equal(dashboard.asOfSeq, 32619);
  assert.equal(dashboard.loading, false);
  assert.equal(dashboard.error, null);
  assert.equal(dashboard.value.counts.toolCalls, 4304);
  f.frame({ kind: 'context-dashboard', asOfSeq: 30000, value: { current: { system: 1 } } });
  assert.equal(f.store.sessionState.contextDashboard.asOfSeq, 32619, 'older snapshots are dropped');
  f.frame({ kind: 'context-dashboard', asOfSeq: 33000, value: { current: { system: 2 } } });
  assert.equal(f.store.sessionState.contextDashboard.value.current.system, 2);
});

test('store maps context-unavailable / unknown-command errors to the upgrade state', () => {
  const f = storeFixture();
  f.frame({ kind: 'error', code: 'context-unavailable', requestType: 'context-dashboard', message: 'not registered' });
  assert.equal(f.store.sessionState.contextDashboard.unsupported, true);
  assert.equal(f.store.sessionState.contextDashboard.error, null);
  assert.equal(f.store.sessionState.contextDashboard.code, 'context-unavailable');
  f.frame({ kind: 'error', code: 'unknown-command', requestType: 'context-dashboard', message: 'unknown message type: context-dashboard' });
  assert.equal(f.store.sessionState.contextDashboard.unsupported, true);
  f.frame({ kind: 'error', code: 'boom', requestType: 'context-dashboard', message: 'kaboom' });
  assert.equal(f.store.sessionState.contextDashboard.unsupported, false);
  assert.equal(f.store.sessionState.contextDashboard.error, 'kaboom');
});

test('store requests the dashboard when the context tab becomes visible', () => {
  const f = storeFixture();
  f.store.setContextActive(true);
  assert.equal(f.requested.length, 1);
  assert.equal(f.requested[0], 'session-1');
  assert.equal(f.store.sessionState.contextDashboard.loading, true);
  f.store.setContextActive(false);
  f.store.setContextActive(false);
  assert.equal(f.requested.length, 1, 're-activating an already-visible tab does not refetch');
  f.store.setContextActive(true);
  assert.equal(f.requested.length, 2);
});

test('closing a session clears the context dashboard', () => {
  const f = storeFixture();
  f.frame({ kind: 'context-dashboard', asOfSeq: 10, value: sampleValue() });
  f.store.closeSession();
  const dashboard = f.store.sessionState.contextDashboard;
  assert.equal(dashboard.value, null);
  assert.equal(dashboard.asOfSeq, null);
  assert.equal(dashboard.unsupported, false);
});
