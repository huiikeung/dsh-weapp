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
  assert.deepEqual(timing.rows.map(row => row.pctText), ['16.7%', '50.0%', '33.3%']);
  assert.deepEqual(timing.rows.map(row => row.durationText), ['1.0s', '3.0s', '2.0s']);
  assert.deepEqual(timing.rows.map(row => row.countText), ['2 次', '4 次', '2 次']);
  const width = timing.rows.reduce((sum, row) => sum + row.width, 0);
  assert.ok(Math.abs(width - 100) < 1e-9);
  assert.match(timing.donutStyle, /ctx-t-wait\) 0\.00% 16\.67%/);
  const donutStops = Array.from(timing.donutStyle.matchAll(/(\d+(?:\.\d+)?)%/g), match => Number(match[1]));
  assert.ok(donutStops.every(value => value <= 100));
});

test('deriveTiming falls back to steps for replies and shows dashes when nothing ran', () => {
  const timing = contextView.deriveTiming({ counts: {}, stats: { decodeMs: 900, steps: 3 }, timing: {} });
  assert.equal(timing.rows[1].countText, '3 次');
  assert.equal(timing.activeText, '—');
  const empty = contextView.deriveTiming({});
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.rows.map(row => row.pctText), ['—', '—', '—']);
});

// ---------- 趋势 ----------

test('deriveTrend sorts requests ascending and stacks only non-zero categories', () => {
  const trend = contextView.deriveTrend({ requests: [requests(1)[0], Object.assign({}, requests(1)[0], { seq: 5, turn: 0 })] }, key => key);
  assert.equal(trend.count, 2);
  assert.deepEqual(trend.bars.map(bar => bar.seq), [0, 5]);
  assert.deepEqual(trend.bars[0].segments.map(segment => segment.key), ['system', 'tools', 'user', 'assistant', 'tool']);
  // px heights on the chart's own scale (not % against an indefinite base).
  assert.equal(trend.bars[0].segments[0].px, Math.max(1, Math.round(requests(1)[0].system / trend.maxTotal * contextView.TREND_CHART_H)));
  // 5 axis ticks, dsh-context .lc-axis: top/q3/mid/q1/bot.
  assert.deepEqual(trend.axis.map(item => item.key), ['top', 'q3', 'mid', 'q1', 'bot']);
  assert.deepEqual(trend.axis.map(item => item.top), [13, 41, 69, 97, 125]);
  assert.equal(trend.axis[4].text, '0');
  // Track width: bars × pitch − one trailing gap (no label overhang reserve).
  assert.equal(trend.trackWidth, 2 * contextView.TREND_BAR_PITCH - contextView.TREND_BAR_GAP);
  // 5 grid lines; the zero line is solid in both modes.
  assert.equal(trend.grid.length, 5);
  assert.deepEqual(trend.grid.map(item => item.key), ['top', 'q3', 'q1', 'mid', 'zero']);
  assert.equal(trend.grid[4].show, true);
  // Every 5th step column carries a flag; step 1 does not.
  assert.equal(trend.bars[0].flag, null);
  assert.equal(trend.bars[1].flag, null);
});

test('adaptive trend scales to its visible window and duration can be toggled independently', () => {
  const value = { requests: [
    { seq: 1, turn: 1, step: 1, system: 100, total: 100, activeMs: 100 },
    { seq: 2, turn: 2, step: 1, system: 1000, total: 1000, activeMs: 1000 },
    { seq: 3, turn: 3, step: 1, system: 200, total: 200, activeMs: 200 }
  ] };
  const adaptive = contextView.deriveTrend(value, key => key, {
    groupBy: 'step', adaptive: true, showDuration: true, visibleRange: { from: 0, to: 0 }
  });
  assert.equal(adaptive.adaptive, true);
  assert.equal(adaptive.maxTotal, 100);
  assert.equal(adaptive.maxActiveMs, 100);
  assert.equal(adaptive.bars[0].segments[0].px, contextView.TREND_CHART_H);
  assert.equal(adaptive.hasDuration, true);

  const withoutDuration = contextView.deriveTrend(value, key => key, {
    groupBy: 'step', showDuration: false, overview: true
  });
  assert.equal(withoutDuration.showDuration, false);
  assert.equal(withoutDuration.hasDuration, false);
  assert.deepEqual(withoutDuration.ribbon.durationRuns, []);
});

test('deriveTrend flags every fifth step column', () => {
  const trend = contextView.deriveTrend({ requests: requests(7) }, key => key);
  assert.deepEqual(trend.bars.map(bar => bar.flag), [null, null, null, null, 5, null, null]);
  // Turn granularity never shows step flags.
  const turns = contextView.deriveTrend({ requests: requests(7) }, key => key, { groupBy: 'turn' });
  assert.deepEqual(turns.bars.map(bar => bar.flag), [null, null, null, null, null, null, null]);
});

test('deriveTrend exposes the turn strip on the same grid as the bars', () => {
  const trend = contextView.deriveTrend({
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 200, total: 300 },
      { seq: 2, turn: 1, step: 2, system: 150, tools: 150, total: 300 },
      { seq: 3, turn: 2, step: 1, system: 120, tools: 130, total: 250 }
    ]
  }, key => key);
  assert.equal(trend.turnStrip.length, 2);
  assert.deepEqual(trend.turnStrip.map(item => item.turn), [1, 2]);
  // Turn 1 spans two step columns, so its block is two pitches minus one gap.
  assert.equal(trend.turnStrip[0].width, 2 * contextView.TREND_BAR_PITCH - contextView.TREND_BAR_GAP);
  assert.equal(trend.turnStrip[1].width, contextView.TREND_BAR_PITCH - contextView.TREND_BAR_GAP);
  assert.equal(trend.turnStrip[0].left, 0);
  assert.equal(trend.turnStrip[1].left, trend.turnStrip[0].width + contextView.TREND_BAR_GAP);
  // Neutral zebra, never the category palette.
  assert.equal(trend.turnStrip[0].zebra, 'even');
  assert.equal(trend.turnStrip[1].zebra, 'odd');
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

test('deriveTrend attaches compaction events to the first bar at/after the event seq', () => {
  const trend = contextView.deriveTrend({
    requests: requests(5),
    events: [
      { seq: 3, kind: 'compaction' },
      { seq: 4, kind: 'prune' },
      { seq: 99, kind: 'inject' }
    ]
  }, key => key);
  assert.equal(trend.bars[2].marker, 'event');
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
  assert.equal(trend.turnStrip.length, 0);
  assert.equal(trend.trackWidth, 0);
  assert.equal(trend.hasDuration, false);
});

test('deriveTrend switches step/turn grouping and shows positive and negative changes', () => {
  const value = {
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 200, total: 300 },
      { seq: 2, turn: 1, step: 2, system: 150, tools: 150, total: 300 },
      { seq: 3, turn: 2, step: 1, system: 120, tools: 130, total: 250 }
    ]
  };
  const delta = contextView.deriveTrend(value, key => key, {
    groupBy: 'step', displayMode: 'delta', selectedSeq: 2
  });
  assert.equal(delta.groupBy, 'step');
  assert.equal(delta.displayMode, 'delta');
  assert.deepEqual(delta.bars.map(bar => bar.selected), [false, true, false]);
  assert.deepEqual(delta.bars[1].segments.map(segment => segment.key), ['system']);
  assert.deepEqual(delta.bars[1].decreaseSegments.map(segment => segment.key), ['tools']);
  // Delta geometry as primitives: signed segment px plus one zero-line offset.
  assert.ok(delta.bars[1].segments[0].px > 0);
  assert.ok(delta.bars[1].decreaseSegments[0].px > 0);
  assert.ok(delta.bars[1].growth > 0);
  assert.ok(delta.bars[1].decrease > 0);
  assert.equal(delta.bars[1].growthText.charAt(0), '+');
  assert.equal(delta.bars[1].decreaseText.charAt(0), '−');
  assert.equal(delta.upPx + delta.downPx, contextView.TREND_CHART_H);
  // Delta axis reads the signed span, and the quarter marks yield to the zero label.
  assert.deepEqual(delta.axis.map(item => item.key), ['top', 'q3', 'mid', 'q1', 'bot']);
  assert.equal(delta.axis[0].text.charAt(0), '+');
  assert.equal(delta.axis[4].text.charAt(0), '−');
  assert.equal(delta.axis[2].text, '0');
  assert.equal(delta.grid[4].top, contextView.TREND_CHART_H);

  const turns = contextView.deriveTrend(value, key => key, { groupBy: 'turn' });
  assert.equal(turns.count, 2);
  assert.deepEqual(turns.bars.map(bar => bar.seq), [2, 3], 'turn grouping keeps each turn final request');
  assert.equal(turns.selectedSeq, 3);
});

test('deriveTrend sums activeMs across a turn and feeds the duration curve', () => {
  const value = {
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 0, total: 100, activeMs: 400 },
      { seq: 2, turn: 1, step: 2, system: 120, tools: 0, total: 120, activeMs: 600 },
      { seq: 3, turn: 2, step: 1, system: 130, tools: 0, total: 130, activeMs: 200 }
    ]
  };
  // Turn granularity: turn 1's two steps collapse to one bar whose activeMs is their SUM (1000).
  const turns = contextView.deriveTrend(value, key => key, { groupBy: 'turn' });
  assert.equal(turns.hasDuration, true);
  assert.equal(turns.maxActiveMs, 1000);
  assert.equal(turns.durationRuns.length, 1);
  let points = turns.durationRuns[0].split(' ');
  assert.equal(points.length, 2, 'turn grouping draws one point per turn');
  // x sits on each column's centre: i * pitch + barW / 2.
  assert.equal(Number(points[0].split(',')[0]), contextView.TREND_BAR_W / 2);
  assert.equal(Number(points[1].split(',')[0]), contextView.TREND_BAR_PITCH + contextView.TREND_BAR_W / 2);
  // The largest activeMs (turn 1's 1000ms sum) reaches the plot floor.
  assert.equal(Number(points[0].split(',')[1]), 0);
  // Turn 2's 200ms rides 4/5 of the way down the 224rpx plot.
  assert.equal(Number(points[1].split(',')[1]), Math.round((contextView.TREND_CHART_H - 200 / 1000 * contextView.TREND_CHART_H) * 100) / 100);

  // Step granularity keeps every request's own activeMs.
  const steps = contextView.deriveTrend(value, key => key, { groupBy: 'step' });
  assert.equal(steps.maxActiveMs, 600);
  points = steps.durationRuns[0].split(' ');
  assert.equal(points.length, 3);
  assert.equal(Number(points[1].split(',')[1]), 0, 'the 600ms step is the tallest');
});

test('deriveTrend omits the duration curve when no request carries activeMs', () => {
  const trend = contextView.deriveTrend({
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 0, total: 100 },
      { seq: 2, turn: 1, step: 2, system: 120, tools: 0, total: 120 }
    ]
  }, key => key);
  assert.equal(trend.hasDuration, false);
  assert.equal(trend.durationRuns.length, 0);
  assert.equal(trend.durationDots.length, 0);
});

test('deriveTrend keeps the duration curve inside the plot on hostile input', () => {
  // A record whose activeMs exceeds the fold's own maximum, plus a negative one:
  // both must clamp into [0, CHART_H] so the polyline never paints outside the module.
  const trend = contextView.deriveTrend({
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 0, total: 100, activeMs: 100 },
      { seq: 2, turn: 1, step: 2, system: 120, tools: 0, total: 120, activeMs: 999999 },
      { seq: 3, turn: 2, step: 1, system: 130, tools: 0, total: 130, activeMs: -50 }
    ]
  }, key => key, { groupBy: 'step' });
  const points = trend.durationRuns[0].split(' ').map((point) => point.split(',').map(Number));
  assert.equal(points.length, 3);
  points.forEach(([, y]) => {
    assert.ok(y >= 0, 'y never goes above the plot');
    assert.ok(y <= contextView.TREND_CHART_H, 'y never drops below the baseline');
  });
  // The tallest record sits exactly on the floor; the negative one clamps to the ceiling.
  assert.equal(points[1][1], 0);
  assert.equal(points[2][1], contextView.TREND_CHART_H);
});

test('deriveTrend reports a chart width that covers the bars plus side padding', () => {
  const trend = contextView.deriveTrend({ requests: requests(3) }, key => key);
  // .ctx-trend-chart is border-box with 4rpx padding on each side; the content box
  // must hold exactly the bar track or the overflow clip would shave the columns.
  assert.equal(trend.chartWidth, trend.trackWidth + 2 * contextView.TREND_BAR_GAP);
  assert.equal(trend.trackWidth, 3 * contextView.TREND_BAR_PITCH - contextView.TREND_BAR_GAP);
});

test('deriveTrend exposes a right-hand duration axis alongside the curve', () => {
  const trend = contextView.deriveTrend({
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 0, total: 100, activeMs: 1000 },
      { seq: 2, turn: 1, step: 2, system: 120, tools: 0, total: 120, activeMs: 500 }
    ]
  }, key => key, { groupBy: 'step' });
  assert.equal(trend.hasDuration, true);
  assert.equal(trend.hasDurationAxis, true);
  assert.deepEqual(trend.durationAxis.map(item => item.key), ['top', 'q3', 'mid', 'q1', 'bot']);
  // Same five offsets as the token axis, so the two columns line up.
  assert.deepEqual(trend.durationAxis.map(item => item.top), [13, 41, 69, 97, 125]);
  assert.equal(trend.durationAxis[0].text, contextView.formatDuration(1000));
  assert.equal(trend.durationAxis[1].text, contextView.formatDuration(750));
  assert.equal(trend.durationAxis[2].text, contextView.formatDuration(500));
  assert.equal(trend.durationAxis[3].text, contextView.formatDuration(250));
  assert.equal(trend.durationAxis[4].text, '0');

  // Without readable activeMs there is no curve, so no second axis either.
  const bare = contextView.deriveTrend({ requests: [{ seq: 1, turn: 1, step: 1, system: 1, tools: 1, total: 2 }] }, key => key);
  assert.equal(bare.hasDuration, false);
  assert.equal(bare.hasDurationAxis, false);
});

test('deriveTrend DNA mode lays one band per read item in reading order', () => {
  const value = {
    requests: [
      { seq: 10, turn: 1, step: 1, system: 500, tools: 0, user: 100, total: 600 },
      { seq: 30, turn: 1, step: 2, system: 500, tools: 0, user: 100, assistant: 200, total: 800 }
    ],
    surface: [
      { seq: 30, cat: 'assistant', tokens: 200 },
      { seq: 10, cat: 'user', tokens: 100 },
      { seq: 40, cat: 'tool', tokens: 900 }
    ],
    // Removed at 30, so the model still read it at seq 10 but not at seq 30.
    archive: [{ seq: 5, cat: 'skill', tokens: 50, gone: 30 }]
  };
  const trend = contextView.deriveTrend(value, key => key, { groupBy: 'step', dna: true });
  assert.equal(trend.dna, true);
  assert.equal(trend.bars[0].dnaCount, 2, 'system + user + archived skill');
  // Reading order is by seq, not by the surface array's storage order.
  assert.deepEqual(trend.bars[0].dna.map(band => band.key), ['skill', 'user']);
  assert.deepEqual(trend.bars[1].dna.map(band => band.key), ['user', 'assistant']);
  assert.equal(trend.bars[1].dnaCount, 2, 'the skill was compacted away by seq 30');

  // DNA and delta are incompatible: DNA shows composition, not signed change.
  const delta = contextView.deriveTrend(value, key => key, { groupBy: 'step', dna: true, displayMode: 'delta' });
  assert.equal(delta.dna, false);
  assert.equal(delta.bars[0].dna, null);

  // DNA and the overview are mutually exclusive faces.
  const both = contextView.deriveTrend(value, key => key, { dna: true, overview: true });
  assert.equal(both.dna, false);
  assert.equal(both.overview, true);
});

test('deriveTrend overview squashes the session into one stretched ribbon', () => {
  const trend = contextView.deriveTrend({
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 200, user: 50, total: 350 },
      { seq: 2, turn: 1, step: 2, system: 100, tools: 260, user: 50, total: 410 },
      { seq: 3, turn: 2, step: 1, system: 100, tools: 300, user: 50, total: 450 }
    ]
  }, key => key, { groupBy: 'step', overview: true });
  assert.equal(trend.overview, true);
  assert.equal(trend.ribbon.count, 3);
  assert.equal(trend.ribbon.width, 3, 'x is one unit per record');
  assert.equal(trend.ribbon.height, contextView.TREND_CHART_H);
  // One polygon per category — zero-value bands are emitted too and flagged, so
  // the template can skip them without a second pass.
  assert.equal(trend.ribbon.bands.length, contextView.CATEGORY_KEYS.length);
  const systemBand = trend.ribbon.bands.find(band => band.key === 'system');
  assert.ok(systemBand.hasValue);
  const points = systemBand.points.split(' ');
  assert.equal(points.length, 6, '3 top-edge points then 3 bottom-edge points');
  // x runs 0,1,2 across the top edge and 2,1,0 back along the bottom.
  assert.deepEqual(points.slice(0, 3).map(p => Number(p.split(',')[0])), [0, 1, 2]);
  assert.deepEqual(points.slice(3).map(p => Number(p.split(',')[0])), [2, 1, 0]);
  // system is constant 100/450 of the plot, so both edges sit near the floor.
  const systemTop = Number(points[0].split(',')[1]);
  const systemBottom = Number(points[5].split(',')[1]);
  assert.ok(systemBottom > systemTop, 'the band has thickness');
  assert.ok(systemTop > 0 && systemBottom <= contextView.TREND_CHART_H);
  // Categories with no value are flagged so the template can skip them.
  assert.equal(trend.ribbon.bands.find(band => band.key === 'skill').hasValue, false);

  // Quartile + full-span flags, and the pinned cursor at the record's centre.
  assert.deepEqual(trend.ribbon.flags.map(flag => flag.key), ['q1', 'mid', 'q3', 'end']);
  assert.equal(trend.ribbon.flags[3].left, 100);
  // The newest of 3 records is pinned at its own centre, i.e. 2.5/3 of the width.
  assert.ok(Math.abs(trend.ribbon.cursorLeft - (2.5 / 3) * 100) < 1e-9);
  assert.equal(trend.ribbon.cursorSeq, 3);
  // The turn strip stretches: each block takes the share of records it covers.
  assert.deepEqual(trend.turnStrip.map(item => item.flex), [2, 1]);
  // Off by default.
  const plain = contextView.deriveTrend({ requests: trend.bars.map(b => ({ seq: b.seq, turn: 1, step: 1, system: 1, total: 1 })) }, key => key);
  assert.equal(plain.overview, false);
  assert.equal(plain.ribbon.bands.length, 0);
});

test('deriveTrend dims other turns when one turn is focused', () => {
  const trend = contextView.deriveTrend({
    requests: [
      { seq: 1, turn: 1, step: 1, system: 100, tools: 0, total: 100 },
      { seq: 2, turn: 2, step: 1, system: 120, tools: 0, total: 120 }
    ]
  }, key => key, { activeTurn: 2 });
  assert.deepEqual(trend.bars.map(bar => bar.inTurn), [false, true]);
  assert.deepEqual(trend.bars.map(bar => bar.dimmed), [true, false]);
  assert.deepEqual(trend.turnStrip.map(item => item.on), [false, true]);
  assert.deepEqual(trend.turnStrip.map(item => item.dimmed), [true, false]);
});

test('deriveTrendSelection explains compaction without adding a scissors glyph', () => {
  const value = {
    requests: [
      { seq: 10, turn: 1, step: 1, system: 100, tools: 0, total: 100 },
      { seq: 20, turn: 1, step: 2, system: 100, tools: 0, total: 260 },
      { seq: 30, turn: 2, step: 1, system: 100, tools: 0, total: 260 }
    ],
    events: [
      { seq: 25, kind: 'compaction', tokens: 1024, count: 3 },
      { seq: 99, kind: 'prune', tokens: 40 }
    ]
  };
  const detail = contextView.deriveTrendSelection(value, 30, key => key);
  assert.equal(detail.hasData, true);
  // The compaction at seq 25 landed on/before seq 30, so it explains that bar.
  assert.ok(detail.markerText.indexOf('压缩') === 0, 'names the event kind without a leading icon');
  assert.equal(detail.markerText.includes('✂'), false);
  assert.ok(detail.markerText.indexOf('1.0k') > 0, 'reports the reclaimed tokens');
  assert.ok(detail.markerText.indexOf('3') > 0, 'reports the removed-message count');

  // The prune at seq 99 is in the future: it belongs to a later bar.
  const earlier = contextView.deriveTrendSelection(value, 10, key => key);
  assert.equal(earlier.markerText, '', 'no event has happened yet at seq 10');
});

test('deriveTrendSelection reports no marker when nothing was compacted', () => {
  const detail = contextView.deriveTrendSelection({
    requests: [{ seq: 1, turn: 1, step: 1, system: 1, tools: 1, total: 2 }],
    events: [{ seq: 1, kind: 'inject', tokens: 5 }]
  }, 1, key => key);
  assert.equal(detail.markerText, '', 'inject events do not create a compaction note');
});

test('deriveTrendSelection exposes request composition and provider usage details', () => {
  const value = { requests: [
    { seq: 10, turn: 2, step: 3, time: 1700000001000, system: 20, tools: 30, user: 10, total: 60, prompt: 55, output: 8, items: { tools: 2 } },
    { seq: 20, turn: 2, step: 4, time: 1700000002000, system: 25, tools: 25, user: 10, total: 60, prompt: 58, output: 9, items: { tools: 3 } }
  ] };
  const detail = contextView.deriveTrendSelection(value, 20, (key, values) => {
    return Object.keys(values || {}).reduce((label, name) => label.replace('{' + name + '}', String(values[name])), key);
  });
  assert.equal(detail.requestLabel, '请求 #20');
  assert.equal(detail.turnText, '第 2 轮');
  assert.equal(detail.stepText, '第 4 步');
  assert.equal(detail.estimatedText, '≈60');
  assert.equal(detail.actualPromptText, '58');
  assert.equal(detail.outputText, '9');
  assert.equal(detail.deltaText, '0');
  assert.equal(detail.rows.find(row => row.key === 'tools').itemsText, '3');
  assert.equal(detail.rows.find(row => row.key === 'tools').pctText, '41.7%');
  assert.equal(detail.rows.find(row => row.key === 'tools').deltaText, '−5');
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

test('deriveFileActivity aggregates operations by path and honors the selected step cutoff', () => {
  const value = {
    fileOps: [
      { seq: 2, time: 1000, path: 'src/a.js', kind: 'read', tool: 'read', err: false, added: 0, removed: 0, readCount: 20 },
      { seq: 3, time: 1100, path: 'src/a.js', kind: 'write', tool: 'edit', err: false, added: 4, removed: 2 },
      { seq: 5, time: 1200, path: 'tests/a.test.js', kind: 'search', tool: 'grep', err: true, added: 0, removed: 0 }
    ],
    fileOpsFloor: 1
  };
  const files = contextView.deriveFileActivity(value, null, 3);
  assert.equal(files.totalRows, 1);
  assert.equal(files.rows[0].path, 'src/a.js');
  assert.equal(files.rows[0].readsText, '读取 1');
  assert.equal(files.rows[0].writesText, '写入 1');
  assert.equal(files.rows[0].deltaText, '+4 / −2 行');
  assert.equal(files.rows[0].lastSeq, 3);
  assert.equal(files.truncated, true);
  const filtered = contextView.deriveFileActivity(value, key => key, null, { filter: 'write', sort: 'recent' });
  assert.equal(filtered.filter, 'write');
  assert.equal(filtered.sort, 'recent');
  assert.deepEqual(filtered.rows.map(row => row.path), ['src/a.js']);
  const searches = contextView.deriveFileActivity(value, key => key, null, { filter: 'search' });
  assert.deepEqual(searches.rows.map(row => row.path), ['tests/a.test.js']);
  const noMatch = contextView.deriveFileActivity(value, key => key, 3, { filter: 'search' });
  assert.equal(noMatch.empty, false, 'records still exist outside the selected cutoff/filter');
  assert.equal(noMatch.noMatches, true, 'the UI keeps its filter controls visible');
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
  assert.equal(ready.timing.rows.length, 3);
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
  assert.equal(panel.timing.rows[0].label, 'E:模型等待');
  assert.equal(panel.timing.rows[0].countText, 'E:4.6k 次');
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
    requestContextDashboard(sessionId) { requested.push(['dashboard', sessionId]); return Promise.resolve(); }
    requestContextFleet(sessionId) { requested.push(['fleet', sessionId]); return Promise.resolve(); }
    requestSessionStats() { return Promise.resolve(); }
    requestContextUsage() { return Promise.resolve(); }
    subscribe() { return true; }
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: module, Date: Date, console: console,
    wx: { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} },
    setTimeout(fn, delay) { if (fn) fn.delay = delay; timers.push(fn); return timers.length; }, clearTimeout() {},
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
  const dashboards = () => f.requested.filter(item => item[0] === 'dashboard').length;
  assert.equal(dashboards(), 1);
  assert.deepEqual(f.requested[0], ['dashboard', 'session-1']);
  assert.equal(f.store.sessionState.contextDashboard.loading, true);
  f.store.setContextActive(false);
  f.store.setContextActive(false);
  assert.equal(dashboards(), 1, 're-activating an already-visible tab does not refetch');
  f.store.setContextActive(true);
  assert.equal(dashboards(), 2);
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

// ---------- v2：统计 / 当前上下文 / 环形 / 耗时六段 / 浏览器 ----------

/** docs/context-dashboard.md 8.1 的 v2 增量示例（叠加在 v1 样例之上）。 */
function sampleV2Value(overrides) {
  return Object.assign(sampleValue(), {
    activity: { userInputs: 16, reads: 36, writes: 38, searches: 26, images: 4 },
    timing: {
      wallMs: 4980000, ttftMs: 1598000, reasoningMs: 1825000, textMs: 99000,
      toolArgMs: 617000, toolsMs: 840000, otherMs: 1500,
      waitCount: 313, reasoningCount: 201, textCount: 16, toolArgCount: 313, toolCount: 318,
      speedTokens: 204000, speedMs: 2550000
    },
    spans: [[0, 1000, 2000], [1, 2000, 5000], [2, 5000, 5100], [4, 5100, 6000], [5, 6000, 6100]],
    lastAnswer: '同步完成，本地已经和 GitHub 对齐。',
    requests: [{
      seq: 53, time: 1791807408490, turn: 2, step: 1,
      system: 2154, tools: 10439, user: 123, inject: 456, skill: 78, assistant: 9000, tool: 3000,
      total: 25250, items: { system: 1, tools: 79, user: 3 }, prompt: 11200, output: 191
    }]
  }, overrides || {});
}

test('v2 statistics expose the five input/output chips and the tool/event groups', () => {
  const stats = contextView.deriveStats(sampleV2Value(), contextView.deriveTokens(sampleV2Value(), key => key), key => key);
  assert.equal(stats.activity.hasData, true);
  assert.deepEqual(stats.activity.chips.map(chip => chip.key), ['userInputs', 'reads', 'writes', 'searches', 'images']);
  assert.deepEqual(stats.activity.chips.map(chip => chip.text), ['16', '36', '38', '26', '4']);
  assert.deepEqual(stats.activity.chips.map(chip => chip.label), ['用户输入', '读取', '写入', '搜索', '图片']);
  // 工具/事件 v1 字段保持不变。
  assert.equal(stats.toolTotalText, '4.3k');
  assert.deepEqual(stats.chips.map(chip => chip.text), ['700', '12', '42']);
  // 没有 v2 activity 的旧帧：整组 chip 显示占位符，不凭空造 0。
  const legacy = contextView.deriveStats(sampleValue(), contextView.deriveTokens(sampleValue(), key => key), key => key);
  assert.equal(legacy.activity.hasData, false);
  assert.ok(legacy.activity.chips.every(chip => chip.text === '—'));
});

test('v2 Agent network derives current-agent tokens and subagent count from the fleet snapshot', () => {
  const tokens = contextView.deriveTokens(sampleV2Value(), key => key);
  const fleet = { currentSessionId: 'session-child', counts: { agents: 3, running: 1, subagents: 2 },
    agents: [{ sessionId: 'session-root', tokensTotal: 10 }, { sessionId: 'session-child', tokensTotal: 2500 }] };
  const network = contextView.deriveNetwork(sampleV2Value(), tokens, fleet, key => key);
  assert.equal(network.hasData, true);
  assert.equal(network.agentTokensText, '2.5k');
  assert.equal(network.subagentsText, '2');
  // 旧网关没有编队快照 → 整块隐藏，避免显示假的 ×0。
  const hidden = contextView.deriveNetwork(sampleV2Value(), tokens, null, key => key);
  assert.equal(hidden.hasData, false);
});

test('v2 current context fills the window with seven categories plus remaining/reserve zones', () => {
  const current = contextView.deriveCurrent({
    current: { system: 100, tools: 200, user: 50, inject: 20, skill: 10, assistant: 400, tool: 20, total: 800 },
    contextWindow: 1000
  }, key => key);
  assert.equal(current.hasData, true);
  assert.equal(current.usedWidth, 80);
  assert.equal(current.usedPctText, '80.0%');
  assert.equal(current.remainingWidth, 10);
  assert.equal(current.reserveWidth, 10);
  assert.equal(current.rows.length, 7);
  const totalWidth = current.remainingWidth + current.reserveWidth
    + current.rows.reduce((sum, row) => sum + row.width, 0);
  assert.ok(Math.abs(totalWidth - 100) < 1e-6, 'the stacked bar always fills the window');
  assert.equal(current.rows[0].tokenText, '≈100');
  assert.equal(current.rows[0].pctText, '12.5%');
  // 窗口几乎占满时保留区被挤掉，不出现负宽度。
  const full = contextView.deriveCurrent({ current: { system: 1000, total: 1000 }, contextWindow: 1000 }, key => key);
  assert.equal(full.usedWidth, 100);
  assert.equal(full.remainingWidth, 0);
  assert.equal(full.reserveWidth, 0);
  // 没有窗口/上下文时明确空态，不渲染空条。
  assert.equal(contextView.deriveCurrent({ current: {}, contextWindow: 0 }, key => key).hasData, false);
});

test('v2 token donut builds a conic-gradient from the eight legend rows and keeps v1 fields', () => {
  const tokens = contextView.deriveTokens(sampleV2Value(), key => key);
  assert.equal(tokens.available, true);
  assert.equal(tokens.rows.length, 8);
  assert.match(tokens.donut.style, /^background:conic-gradient\(/);
  assert.match(tokens.donut.style, /var\(--ctx-c-system\)/);
  assert.match(tokens.donut.style, /var\(--ctx-c-output\)/);
  assert.equal(tokens.inputText, '1.4B');
  assert.equal(tokens.outputText, '2.0M');
  const unavailable = contextView.deriveTokens({ current: {}, usage: null }, key => key);
  assert.equal(unavailable.donut.available, false);
  assert.equal(unavailable.donut.style, '');
});

test('v2 timing splits six segments with shares, durations, counts, speed and timeline spans', () => {
  const timing = contextView.deriveTiming(sampleV2Value());
  assert.equal(timing.v2, true);
  assert.deepEqual(timing.rows.map(row => row.key), ['wait', 'reasoning', 'text', 'toolarg', 'tools', 'other']);
  assert.deepEqual(timing.rows.map(row => row.label), ['模型等待', '模型思考', '模型回复', '工具参数', '工具执行', '其他开销']);
  assert.deepEqual(timing.rows.map(row => row.pctText), ['32.1%', '36.6%', '2.0%', '12.4%', '16.9%', '<0.1%']);
  assert.deepEqual(timing.rows.map(row => row.durationText), ['26m38s', '30m25s', '1m39s', '10m17s', '14m0s', '1.5s']);
  assert.deepEqual(timing.rows.map(row => row.countText), ['313 次', '201 次', '16 次', '313 次', '318 次', '']);
  assert.match(timing.donutStyle, /conic-gradient/);
  assert.equal(timing.hasSpeed, true);
  assert.equal(timing.speedText, '80.0 tok/s');
  assert.equal(timing.hasTimeline, true);
  assert.deepEqual(timing.timeline.map(span => span.kind), ['wait', 'reasoning', 'text', 'tools', 'other']);
  assert.match(timing.timeline[0].style, /left:0\.00%;width:19\.61%;/);
  // v1 只有 stats 时仍显示三段，不被 v2 空字段吞掉。
  const legacy = contextView.deriveTiming({ counts: { answers: 4 }, stats: { ttftMs: 1000, decodeMs: 3000, toolMs: 2000 } }, key => key);
  assert.equal(legacy.v2, false);
  assert.equal(legacy.rows.length, 3);
  assert.equal(legacy.hasSpeed, false);
  assert.equal(legacy.hasTimeline, false);
});

test('v2 timing tolerates hostile spans and missing speed counters', () => {
  const timing = contextView.deriveTiming({
    timing: { wallMs: 1000, ttftMs: 1000, speedTokens: 0, speedMs: 0 },
    spans: [[0, 'x', 'y'], 'nope', [9, 500, 400], [1, 100, 200]]
  }, key => key);
  assert.equal(timing.v2, true);
  assert.equal(timing.hasSpeed, false);
  assert.equal(timing.speedText, '—');
  assert.deepEqual(timing.timeline.map(span => span.kind), ['reasoning']);
});

test('v2 context browser defaults to the current composition and walks historical requests', () => {
  const browser = contextView.deriveBrowser(sampleV2Value(), key => key, {});
  assert.equal(browser.empty, false);
  assert.equal(browser.isCurrent, true);
  assert.equal(browser.options.length, 2, 'one historical request plus "current"');
  assert.equal(browser.options[1].label, '当前（下一次请求）');
  assert.equal(browser.selectedIndex, 1);
  assert.equal(browser.canPrev, true);
  assert.equal(browser.canNext, false);
  assert.equal(browser.estimated, 25250);
  assert.equal(browser.estimatedText, '≈25.3k');
  assert.equal(browser.promptText, '—');
  assert.equal(browser.rows.length, 7);
  assert.ok(browser.rows.every(row => row.itemsText === '—'));
  // 切到历史请求：显示该请求 total 与实际 prompt，并与上一条（无）对比。
  const historical = contextView.deriveBrowser(sampleV2Value(), key => key, { seq: 53 });
  assert.equal(historical.selectedIndex, 0);
  assert.equal(historical.isCurrent, false);
  assert.equal(historical.promptText, '11.2k');
  assert.equal(historical.estimatedText, '≈25.3k');
  assert.equal(historical.canPrev, false);
  assert.equal(historical.canNext, true);
  assert.equal(historical.rows[0].itemsText, '1');
  assert.equal(historical.rows[1].itemsText, '79');
  assert.equal(historical.rows[0].deltaText, '—');
  assert.equal(historical.timeText.length, 8);
});

test('v2 context browser compares each category with the previous request', () => {
  const requests = [
    { seq: 10, time: 1000, turn: 1, system: 100, tools: 200, total: 300, items: { system: 1, tools: 5 }, prompt: 280, output: 10 },
    { seq: 20, time: 2000, turn: 2, system: 120, tools: 180, total: 300, items: { system: 2, tools: 4 }, prompt: 290, output: 20 }
  ];
  const browser = contextView.deriveBrowser({ requests: requests, current: { system: 130, tools: 170, total: 300 } }, key => key, { seq: 20 });
  assert.equal(browser.selectedIndex, 1);
  assert.equal(browser.rows[0].deltaText, '+20');
  assert.equal(browser.rows[0].deltaClass, 'up');
  assert.equal(browser.rows[1].deltaText, '−20');
  assert.equal(browser.rows[1].deltaClass, 'down');
  assert.equal(browser.rows[2].deltaText, '0');
  // 「当前（下一次请求）」与最后一条历史请求对比。
  const currentEntry = contextView.deriveBrowser({ requests: requests, current: { system: 130, tools: 170, total: 300 } }, key => key, { seq: null });
  assert.equal(currentEntry.selectedIndex, 2);
  assert.equal(currentEntry.rows[0].deltaText, '+10');
  assert.equal(currentEntry.rows[2].deltaText, '0');
  // 展开行的明细文案与宽度。
  const expanded = contextView.deriveBrowser({ requests: requests }, key => key, { seq: 20, expanded: ['system'] });
  assert.equal(expanded.rows[0].expanded, true);
  assert.equal(expanded.rows[1].expanded, false);
  assert.doesNotMatch(expanded.rows[0].detailText, /明细暂不展示/);
  assert.deepEqual(expanded.rows[0].nodes, []);
});

test('context browser reconstructs the selected surface and exposes expandable request-header entries', () => {
  const value = {
    requests: [
      { seq: 10, time: 1000, turn: 1, system: 10, tools: 20, user: 5, total: 35 },
      { seq: 20, time: 2000, turn: 1, system: 10, tools: 20, user: 5, total: 35 }
    ],
    surface: [
      { seq: 5, cat: 'user', tokens: 5 },
      { seq: 15, cat: 'assistant', tokens: 4, text: 'working' },
      { seq: 25, cat: 'user', tokens: 8 }
    ],
    archive: [
      { seq: 3, cat: 'user', tokens: 2, gone: 8 },
      { seq: 7, cat: 'user', tokens: 3, gone: 25 }
    ],
    headerEpochs: [{ seq: 2, tools: [{ name: 'read_file' }, { name: 'write_file' }] }]
  };
  const browser = contextView.deriveBrowser(value, key => key, { seq: 20, expanded: ['user', 'tools'] });
  assert.deepEqual(browser.rows.find(row => row.key === 'user').nodes.map(node => node.seq), [7, 5]);
  assert.deepEqual(browser.rows.find(row => row.key === 'tools').nodes.map(node => node.label), ['read_file', 'write_file']);
  assert.deepEqual(contextView.deriveBrowser(value, key => key, { seq: null }).rows.find(row => row.key === 'user').nodes.map(node => node.seq), [25, 5]);
});

test('context browser warns when archive trimming makes a selected historical view incomplete', () => {
  const value = { archiveFloor: 12, requests: [{ seq: 10, total: 1 }], current: { total: 2 } };
  const old = contextView.deriveBrowser(value, key => key, { seq: 10 });
  assert.equal(old.historyPartial, true);
  assert.equal(old.historyPartialText, '历史明细可能不完整');
  const current = contextView.deriveBrowser(value, key => key, { seq: null });
  assert.equal(current.historyPartial, false);
});

test('v2 context browser caps at the latest 30 requests and degrades hostile data', () => {
  const many = requests(45);
  const browser = contextView.deriveBrowser({ requests: many }, key => key, {});
  assert.equal(browser.count, 30);
  assert.equal(browser.options.length, 31);
  assert.equal(browser.options[30].label, '当前（下一次请求）');
  assert.equal(browser.options[0].seq, 30, 'the window keeps the latest 30 records');
  const empty = contextView.deriveBrowser({ requests: [] }, key => key, {});
  assert.equal(empty.empty, true);
  assert.equal(empty.canPrev, false);
  assert.equal(empty.canNext, false);
  const hostile = contextView.deriveBrowser({ requests: [{ seq: 1, items: 'x', prompt: 'nope' }, null, 'x'] }, key => key, { seq: '1' });
  assert.equal(hostile.rows.length, 7);
  assert.equal(hostile.promptText, '—');
  assert.ok(hostile.rows.every(row => row.itemsText === '—'));
});

test('buildPanel v2 keeps every ready field defined and renderable', () => {
  const panel = contextView.buildPanel(dashboard(sampleV2Value()), {
    connected: true, hasSession: true, running: true,
    fleet: { currentSessionId: 'session-1', counts: { agents: 2, subagents: 1 }, agents: [{ sessionId: 'session-1', tokensTotal: 500 }] },
    browserSeq: 53, expanded: ['tools']
  });
  assert.equal(panel.status, 'ready');
  assert.equal(panel.running, true);
  assert.equal(panel.stats.activity.hasData, true);
  assert.equal(panel.stats.network.hasData, true);
  assert.equal(panel.current.hasData, true);
  assert.equal(panel.tokens.donut.available, true);
  assert.equal(panel.timing.v2, true);
  assert.equal(panel.timing.hasTimeline, true);
  assert.equal(panel.browser.selectedIndex, 0);
  assert.equal(panel.browser.rows[1].expanded, true);
  assertNoUndefined(panel);
});

/** 视图模型必须能被 setData 序列化：任何 undefined 都会在 WXML 里丢字段。 */
function assertNoUndefined(value, path) {
  if (value === undefined) assert.fail('undefined at ' + (path || 'root'));
  if (value === null || typeof value !== 'object') return;
  Object.keys(value).forEach(function (key) {
    assert.notEqual(value[key], undefined, 'undefined at ' + (path ? path + '.' : '') + key);
    assertNoUndefined(value[key], (path ? path + '.' : '') + key);
  });
}

// ---------- store v2 动态刷新 ----------

test('running context tab auto-refreshes every 2.5s without stacking requests', () => {
  const f = storeFixture();
  f.frame({ kind: 'sent' }); // running = true
  f.store.setContextActive(true);
  const dashboards = () => f.requested.filter(item => item[0] === 'dashboard').length;
  assert.equal(dashboards(), 1);
  f.frame({ kind: 'context-dashboard', asOfSeq: 1, value: { current: { system: 1 } } });
  const flush = delay => f.timers.filter(fn => delay === undefined || fn.delay === delay)
    .forEach(fn => fn());
  const poll = () => f.timers.filter(fn => fn.delay === 2500).forEach(fn => fn());
  // 运行中：下一拍自动刷新。
  poll();
  assert.equal(dashboards(), 2);
  // 上一帧未返回：这一拍被跳过，不叠加请求。
  poll();
  assert.equal(dashboards(), 2);
  // 帧返回后恢复；看门狗超时也会释放 in-flight 标记。
  f.frame({ kind: 'context-dashboard', asOfSeq: 2, value: { current: { system: 2 } } });
  poll();
  assert.equal(dashboards(), 3);
  flush(8000);
  poll();
  assert.equal(dashboards(), 4);
  // 停止运行：timer 到点也不再请求。
  f.frame({ kind: 'event', event: { type: 'turn/end' } });
  poll();
  assert.equal(dashboards(), 4);
  // 切走分段：重新运行也不会自动刷新（手动刷新仍可用）。
  f.frame({ kind: 'event', event: { type: 'turn/start' } });
  f.store.setContextActive(false);
  poll();
  assert.equal(dashboards(), 4);
  // 手动刷新仍然可用（切走分段不会禁用刷新按钮）。
  assert.equal(f.store.refreshContextDashboard(), true);
  assert.equal(dashboards(), 5);
});

test('visible fleet tab polls only while running and clears its timer when switched away', () => {
  const f = storeFixture();
  const fleets = () => f.requested.filter(item => item[0] === 'fleet').length;
  f.store.setFleetActive(true);
  assert.equal(fleets(), 1);
  f.frame({ kind: 'context-fleet', asOfSeq: 1, value: { agents: [] } });
  // 空闲时不轮询。
  f.timers.filter(fn => fn.delay === 2500).forEach(fn => fn());
  assert.equal(fleets(), 1);
  f.frame({ kind: 'sent' });
  f.timers.filter(fn => fn.delay === 2500).forEach(fn => fn());
  assert.equal(fleets(), 2);
  f.store.setFleetActive(false);
  f.timers.filter(fn => fn.delay === 2500).forEach(fn => fn());
  assert.equal(fleets(), 2);
});
