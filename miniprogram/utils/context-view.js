// 会话「上下文」面板的纯数据派生（对齐 dsh-context v0.74.0 的 Context tab）。
//
// 输入是网关 `context-dashboard` 帧的 value（mobileContext wire view +
// breakdown/usage/stats），输出是页面可直接渲染的视图模型：所有 label 在
// 这里通过注入的 t() 本地化，所有数字格式化、比例、堆叠柱、✂ 标记都在
// 这里算好，WXML 只做插值（不写复杂表达式）。
//
// 该模块不依赖 wx / 页面，可直接在 Node 中 require 测试。
// 数据来自 DSH 事件日志，属于不可信输入：任何缺字段/类型错误都要降级成
// 空值或错误态，绝不能让页面抛异常。

'use strict';

// 固定顺序与颜色语义（dsh-context categories.ts）：前 7 类是 prompt 组成，
// output 是 provider 精确输出。
var CATEGORY_KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
var CATEGORY_LABELS = {
  system: '系统提示词',
  tools: '工具定义',
  user: '用户消息',
  inject: '注入内容',
  skill: '技能注入',
  assistant: '助手消息',
  tool: '工具结果',
  output: '输出'
};
var MESSAGE_KEYS = ['user', 'inject', 'skill', 'assistant', 'tool'];
var TREND_KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool'];
var MAX_TREND_BARS = 120;
var TREND_LABEL_GAP = 5;
// 趋势柱列宽（rpx）：与 session.wxss 的 .ctx-trend-col / gap 保持一致。
var TREND_BAR_PITCH = 24;
var TREND_BAR_GAP = 6;
var MAX_EVENTS = 12;
var MAX_TOOL_ROWS = 3;
// ---------- v2 常量 ----------
var MAX_BROWSER_REQUESTS = 30;
var RESERVE_RATIO = 0.1;
var RESERVE_MAX_WIDTH = 10;
var MAX_TIMELINE_SPANS = 600;
var TIMELINE_MIN_WIDTH = 600;
var TIMELINE_MAX_WIDTH = 2400;
var MAX_TEAM_TASKS = 20;
var MAX_LAST_ANSWER = 240;
var TIMING_KINDS = ['wait', 'reasoning', 'text', 'toolarg', 'tools', 'other'];
var TIMING_LABELS = { wait: '模型等待', reasoning: '模型思考', text: '模型回复', toolarg: '工具参数', tools: '工具执行', other: '其他开销' };
var ACTIVITY_KEYS = ['userInputs', 'reads', 'writes', 'searches', 'images'];
var ACTIVITY_LABELS = { userInputs: '用户输入', reads: '读取', writes: '写入', searches: '搜索', images: '图片' };
var PHASE_LABELS = { active: '运行中', running: '运行中', idle: '空闲', waiting: '等待中', pending: '等待中', done: '已完成', completed: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', blocked: '已阻塞' };
var TASK_STATUS_LABELS = { pending: '待处理', todo: '待处理', in_progress: '进行中', inprogress: '进行中', active: '进行中', running: '进行中', completed: '已完成', done: '已完成', failed: '失败', cancelled: '已取消', canceled: '已取消', blocked: '已阻塞' };

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function num(value) {
  var n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function text(value) {
  return typeof value === 'string' && value !== '' ? value : '';
}

function identity(t) {
  if (typeof t === 'function') return t;
  // 页面注入 ui-preferences.t()；Node 单测可直接省略，占位符就地替换。
  return function (key, values) {
    var text = String(key);
    if (values && typeof values === 'object') {
      Object.keys(values).forEach(function (name) {
        text = text.split('{' + name + '}').join(String(values[name]));
      });
    }
    return text;
  };
}

// ---------- 数字格式化（k/M 一位小数） ----------

function formatCompact(value) {
  var n = num(value);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function formatPercent(part, total) {
  var p = num(part);
  var t = num(total);
  if (t <= 0) return '—';
  if (p <= 0) return '0.0%';
  var pct = Math.min(1, p / t) * 100;
  if (pct < 0.1) return '<0.1%';
  return pct.toFixed(1) + '%';
}

function formatDuration(ms) {
  var value = num(ms);
  if (value <= 0) return '—';
  if (value < 1000) return Math.round(value) + 'ms';
  if (value < 60000) return (value / 1000).toFixed(1) + 's';
  var totalSec = Math.floor(value / 1000);
  var minutes = Math.floor(totalSec / 60);
  var seconds = totalSec % 60;
  if (value < 3600000) return minutes + 'm' + seconds + 's';
  return Math.floor(minutes / 60) + 'h' + (minutes % 60) + 'm';
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

function formatTime(value) {
  var ms = typeof value === 'number' && Number.isFinite(value) ? value : NaN;
  if (!Number.isFinite(ms)) return '—';
  var date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '—';
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
}

// ---------- Prompt 组成（官方值锚定 + 残差） ----------

function surfaceOf(current) {
  return MESSAGE_KEYS.reduce(function (sum, key) { return sum + num(current[key]); }, 0);
}

/** 官方 breakdown 优先，缺失时退回 fold 自己的合计；五类消息按 current 比例拆分，最大类吸收残差。 */
function officialParts(current, breakdown) {
  var c = isObject(current) ? current : {};
  var b = isObject(breakdown) ? breakdown : {};
  var system = b.systemTokens != null && Number.isFinite(Number(b.systemTokens)) ? num(b.systemTokens) : num(c.system);
  var tools = b.toolsTokens != null && Number.isFinite(Number(b.toolsTokens)) ? num(b.toolsTokens) : num(c.tools);
  var surface = surfaceOf(c);
  var messages = b.messageTokens != null && Number.isFinite(Number(b.messageTokens)) ? num(b.messageTokens) : surface;
  var values = { system: system, tools: tools };
  var largest = MESSAGE_KEYS[0];
  var largestWeight = -1;
  MESSAGE_KEYS.forEach(function (key) {
    if (num(c[key]) > largestWeight) { largestWeight = num(c[key]); largest = key; }
  });
  if (surface > 0) {
    var assigned = 0;
    var rounded = {};
    MESSAGE_KEYS.forEach(function (key) {
      var value = Math.round(messages * (num(c[key]) / surface));
      rounded[key] = value;
      assigned += value;
    });
    rounded[largest] = Math.max(0, rounded[largest] + messages - assigned);
    MESSAGE_KEYS.forEach(function (key) { values[key] = rounded[key]; });
  } else {
    MESSAGE_KEYS.forEach(function (key) { values[key] = 0; });
  }
  return CATEGORY_KEYS.map(function (key) {
    return { key: key, value: num(values[key]) };
  });
}

/** 按估算比例缩放到 provider 的 prompt 总量；最大类吸收四舍五入残差，保证合计精确。 */
function scaleParts(parts, target) {
  var list = parts.map(function (part) { return { key: part.key, value: num(part.value) }; });
  var total = list.reduce(function (sum, part) { return sum + part.value; }, 0);
  var goal = num(target);
  if (goal <= 0) {
    list.forEach(function (part) { part.value = 0; });
    return list;
  }
  if (total <= 0) return list;
  var largest = 0;
  for (var i = 1; i < list.length; i += 1) {
    if (list[i].value > list[largest].value) largest = i;
  }
  var assigned = 0;
  list.forEach(function (part) {
    part.value = Math.round(part.value * goal / total);
    assigned += part.value;
  });
  list[largest].value = Math.max(0, list[largest].value + goal - assigned);
  return list;
}

// ---------- Token 统计 ----------

function deriveTokens(value, t) {
  t = identity(t);
  var usage = isObject(value.usage) ? value.usage : null;
  var input = usage
    ? num(usage.uncachedInputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens)
    : 0;
  var output = usage ? num(usage.outputTokens) : 0;
  var cacheRead = usage ? num(usage.cacheReadTokens) : 0;
  var total = input + output;
  var parts = scaleParts(officialParts(value.current, value.breakdown), input);
  var rows = parts.map(function (part) {
    return tokenRow(part.key, part.value, true, total, usage, t);
  });
  rows.push(tokenRow('output', output, false, total, usage, t));
  var cacheHit = input > 0 ? Math.min(100, (cacheRead / input) * 100) : null;
  var donut = tokenDonut(rows, total);
  return {
    available: usage !== null,
    input: input,
    output: output,
    total: total,
    totalText: usage !== null ? formatCompact(total) : '—',
    inputText: formatCompact(input),
    outputText: formatCompact(output),
    cacheHit: cacheHit,
    cacheHitText: cacheHit === null ? '—' : cacheHit.toFixed(1) + '%',
    cacheHitLabel: t('缓存命中'),
    rows: rows,
    bar: rows.filter(function (row) { return row.value > 0; }),
    donut: donut
  };
}

function tokenRow(key, value, estimate, total, usage, t) {
  var available = usage !== null;
  return {
    key: key,
    label: t(CATEGORY_LABELS[key] || key),
    value: num(value),
    display: available ? (estimate ? '≈' : '') + formatCompact(value) : '—',
    pct: available ? formatPercent(value, total) : '—',
    width: available && num(total) > 0 ? (num(value) / num(total)) * 100 : 0,
    estimate: estimate && available
  };
}

// ---------- 统计卡 ----------

/** 输入输出 5 chip（v2 activity；旧帧缺失时整组显示 —）。 */
function deriveActivity(value, t) { t = identity(t); var a = isObject(value.activity) ? value.activity : null; var chips = ACTIVITY_KEYS.map(function (k) { var on = a !== null && finiteNumber(a[k]); return { key: k, label: t(ACTIVITY_LABELS[k]), text: on ? formatCompact(a[k]) : '—' }; }); return { hasData: chips.some(function (c) { return c.text !== '—'; }), chips: chips }; }

/** Agent 网络：当前 Agent token + 子 Agent 数（来自 context-fleet；缺失隐藏）。 */
function deriveNetwork(value, tokens, fleet, t) { t = identity(t); if (isObject(fleet) !== true) return { hasData: false, agentTokensText: '', subagentsText: '', subagents: 0 }; var agents = Array.isArray(fleet.agents) ? fleet.agents.filter(isObject) : null; var counts = isObject(fleet.counts) ? fleet.counts : {}; var currentSessionId = text(fleet.currentSessionId); var current = null; if (agents) { for (var i = 0; i < agents.length; i += 1) { if (agents[i].isCurrent === true || (currentSessionId && text(agents[i].sessionId) === currentSessionId)) { current = agents[i]; break; } } } var tokensTotal = current && finiteNumber(current.tokensTotal) ? num(current.tokensTotal) : (tokens && tokens.available ? num(tokens.total) : null); var subagents = finiteNumber(counts.subagents) ? num(counts.subagents) : (agents ? Math.max(0, agents.length - 1) : 0); return { hasData: !!(finiteNumber(counts.agents) || (agents && agents.length)), agentsText: finiteNumber(counts.agents) ? formatCompact(counts.agents) : (agents ? formatCompact(agents.length) : '0'), agentTokensText: tokensTotal === null ? '—' : formatCompact(tokensTotal), subagents: subagents, subagentsText: formatCompact(subagents), subagentLabel: t('子 Agent') }; }

function deriveStats(value, tokens, t, fleet) {
  t = identity(t);
  var counts = isObject(value.counts) ? value.counts : {};
  var tools = isObject(value.tools) ? value.tools : {};
  var stats = isObject(value.stats) ? value.stats : {};
  var toolTotal = num(tools.total) || num(counts.toolCalls);
  var names = Array.isArray(tools.names) ? tools.names : [];
  var top = names
    .filter(function (item) { return isObject(item) && typeof item.name === 'string' && item.name !== ''; })
    .slice(0, MAX_TOOL_ROWS)
    .map(function (item) {
      return { name: item.name, count: num(item.count), countText: formatCompact(item.count) };
    });
  var topSum = top.reduce(function (sum, item) { return sum + item.count; }, 0);
  var otherCount = Math.max(0, toolTotal - topSum);
  return {
    toolTotal: toolTotal,
    toolTotalText: formatCompact(toolTotal),
    toolNames: top,
    otherText: otherCount > 0 ? t('其他') + ' +' + formatCompact(otherCount) : '',
    turns: num(stats.turns),
    turnsText: formatCompact(stats.turns),
    steps: num(stats.steps),
    stepsText: formatCompact(stats.steps),
    skills: num(counts.skillLoads),
    skillsText: formatCompact(counts.skillLoads),
    answers: num(counts.answers),
    answersText: formatCompact(counts.answers),
    chips: [
      { key: 'inject', label: t('注入'), value: num(counts.injects), text: formatCompact(counts.injects) },
      { key: 'compaction', label: t('压缩'), value: num(counts.compactions), text: formatCompact(counts.compactions) },
      { key: 'prune', label: t('剪枝'), value: num(counts.prunes), text: formatCompact(counts.prunes) }
    ],
    activity: deriveActivity(value, t),
    network: deriveNetwork(value, tokens, fleet, t),
    usageTotalText: tokens.totalText,
    usageCacheText: tokens.cacheHitText,
    usageCacheLabel: tokens.cacheHitLabel
  };
}

// ---------- 当前上下文 / 环形图 ----------

/** 当前上下文：窗口占用 + 7 类组成 + 窗口剩余/压缩保留区（压力缺失时用 current.total）。 */
function deriveCurrent(value, t) {
  t = identity(t);
  var cur = isObject(value.current) ? value.current : {};
  var win = num(value.contextWindow);
  var values = CATEGORY_KEYS.map(function (k) { return num(cur[k]); });
  var pressure = num(cur.total) || values.reduce(function (a, b) { return a + b; }, 0);
  var hasData = win > 0 && pressure > 0;
  var usedWidth = hasData ? Math.min(100, (pressure / win) * 100) : 0;
  var remainingWidth = Math.max(0, 100 - usedWidth);
  var reserveWidth = Math.min(RESERVE_MAX_WIDTH, remainingWidth);
  remainingWidth -= reserveWidth;
  var rows = CATEGORY_KEYS.map(function (k, i) {
    return {
      key: k,
      label: t(CATEGORY_LABELS[k] || k),
      width: hasData ? (values[i] / pressure) * usedWidth : 0,
      tokenText: values[i] > 0 ? '≈' + formatCompact(values[i]) : '0',
      pctText: formatPercent(values[i], pressure)
    };
  });
  return {
    hasData: hasData,
    usedWidth: usedWidth,
    pressureText: hasData ? '≈' + formatCompact(pressure) : '—',
    windowText: win > 0 ? formatCompact(win) : '—',
    usedPctText: hasData ? formatPercent(pressure, win) : '—',
    remainingWidth: remainingWidth,
    reserveWidth: reserveWidth,
    remainingText: hasData ? '≈' + formatCompact(Math.max(0, win - pressure)) : '—',
    reserveText: win > 0 ? '≈' + formatCompact(Math.round(win * RESERVE_RATIO)) : '—',
    segments: rows.filter(function (r) { return r.width > 0; }),
    rows: rows,
    remainingLabel: t('窗口剩余'),
    reserveLabel: t('压缩保留区')
  };
}

/** 环形图（conic-gradient）：rows 的占比；色值走主题 CSS 变量。 */
function tokenDonut(rows, total) { var goal = num(total), acc = 0, stops = []; if (goal <= 0) return { available: false, style: '' }; rows.forEach(function (r) { if (r.value <= 0) return; var end = Math.min(100, ((acc + r.value) / goal) * 100); stops.push('var(--ctx-c-' + r.key + ') ' + acc.toFixed(2) + '% ' + end.toFixed(2) + '%'); acc += r.value; }); return { available: stops.length > 0, style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '' }; }

// ---------- 耗时统计 ----------

function timingHasV2(timing) { if (!isObject(timing)) return false; return ['ttftMs', 'reasoningMs', 'textMs', 'toolArgMs', 'toolsMs', 'otherMs', 'waitCount', 'reasoningCount', 'textCount', 'toolArgCount', 'toolCount', 'speedTokens', 'speedMs'] .some(function (k) { return finiteNumber(timing[k]); }); }

/** v2 六段耗时：模型等待/思考/回复/工具参数/工具执行/其他开销。 */
function timingDetailRows(value, t) { var timing = isObject(value.timing) ? value.timing : {}; var ms = { wait: num(timing.ttftMs), reasoning: num(timing.reasoningMs), text: num(timing.textMs), toolarg: num(timing.toolArgMs), tools: num(timing.toolsMs), other: num(timing.otherMs) }; var counts = { wait: num(timing.waitCount), reasoning: num(timing.reasoningCount), text: num(timing.textCount), toolarg: num(timing.toolArgCount), tools: num(timing.toolCount) }; var sum = TIMING_KINDS.reduce(function (a, k) { return a + ms[k]; }, 0); return TIMING_KINDS.map(function (k) { var c = counts[k] || 0; return { key: k, label: t(TIMING_LABELS[k]), ms: ms[k], pctText: formatPercent(ms[k], sum), width: sum > 0 ? (ms[k] / sum) * 100 : 0, durationText: formatDuration(ms[k]), countText: c > 0 ? t('{n} 次', { n: formatCompact(c) }) : '' }; }); }

/** 时间轴：spans [kind,start,end] → 按总时长比例定位色段。 */
function deriveTimeline(value) { var spans = []; (Array.isArray(value.spans) ? value.spans : []).forEach(function (span) { if (!Array.isArray(span) || span.length < 3) return; var start = Number(span[1]), end = Number(span[2]); if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return; spans.push({ kind: TIMING_KINDS[Math.floor(num(span[0]))] || 'other', start: start, end: end }); }); spans = spans.slice(-MAX_TIMELINE_SPANS); if (!spans.length) return { hasData: false, items: [], trackWidth: TIMELINE_MIN_WIDTH }; var min = Infinity, max = -Infinity; spans.forEach(function (span) { if (span.start < min) min = span.start; if (span.end > max) max = span.end; }); var range = max - min > 0 ? max - min : 1; var items = spans.map(function (span, index) { var left = Math.max(0, Math.min(100, ((span.start - min) / range) * 100)); var width = Math.max(0.15, Math.min(100 - left, ((span.end - span.start) / range) * 100)); return { key: 'span-' + index + '-' + span.start, kind: span.kind, style: 'left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%;' }; }); return { hasData: true, items: items, trackWidth: Math.round(Math.max(TIMELINE_MIN_WIDTH, Math.min(TIMELINE_MAX_WIDTH, items.length * 6))) }; }

function deriveTiming(value, t) {
  t = identity(t);
  var stats = isObject(value.stats) ? value.stats : {};
  var counts = isObject(value.counts) ? value.counts : {};
  var timing = isObject(value.timing) ? value.timing : {};
  var waitMs = num(stats.ttftMs), replyMs = num(stats.decodeMs), toolMs = num(stats.toolMs);
  var sum = waitMs + replyMs + toolMs;
  var seg = function (key, label, ms, count) {
    return {
      key: key, label: label, ms: ms,
      pctText: formatPercent(ms, sum),
      width: sum > 0 ? (ms / sum) * 100 : 0,
      durationText: formatDuration(ms),
      countText: count > 0 ? t('{n} 次', { n: formatCompact(count) }) : ''
    };
  };
  var legacy = [
    seg('wait', t('模型等待'), waitMs, num(stats.ttftSteps)),
    seg('reply', t('模型回复'), replyMs, num(counts.answers) || num(stats.steps)),
    seg('tools', t('工具执行'), toolMs, num(counts.toolCalls))
  ];
  var v2 = timingHasV2(timing);
  var rows = v2 ? timingDetailRows(value, t) : legacy;
  var ringSum = 0, acc = 0, stops = [];
  rows.forEach(function (row) { ringSum += num(row.ms); });
  rows.forEach(function (row) {
    if (row.ms <= 0 || ringSum <= 0) return;
    var end = Math.min(100, ((acc + row.ms) / ringSum) * 100);
    stops.push('var(--ctx-t-' + row.key + ') ' + acc.toFixed(2) + '% ' + end.toFixed(2) + '%');
    acc += row.ms;
  });
  var speedMs = num(timing.speedMs);
  var timeline = deriveTimeline(value, t);
  return {
    activeText: formatDuration(timing.wallMs),
    activeLabel: t('活跃时长'),
    totalMs: sum,
    hasData: num(timing.wallMs) > 0 || sum > 0 || ringSum > 0,
    v2: v2,
    rows: rows,
    donutStyle: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '',
    hasSpeed: num(timing.speedTokens) > 0 && speedMs > 0,
    speedText: speedTextOf(speedMs > 0 ? num(timing.speedTokens) / (speedMs / 1000) : 0),
    timeline: timeline.items,
    timelineWidth: timeline.trackWidth,
    hasTimeline: timeline.hasData
  };
}

function speedTextOf(speed) { if (!(speed > 0)) return '—'; return (speed >= 100 ? String(Math.round(speed)) : speed.toFixed(speed >= 10 ? 1 : 2)) + ' tok/s'; }

// ---------- 上下文趋势 ----------

function normalizeRequest(request) {
  var source = isObject(request) ? request : {};
  var items = isObject(source.items) ? source.items : null;
  var normalizedItems = null;
  if (items) {
    normalizedItems = {};
    CATEGORY_KEYS.forEach(function (key) {
      if (items[key] !== undefined && items[key] !== null) normalizedItems[key] = num(items[key]);
    });
  }
  return {
    seq: num(source.seq),
    time: num(source.time),
    turn: num(source.turn),
    total: num(source.total),
    system: num(source.system),
    tools: num(source.tools),
    user: num(source.user),
    inject: num(source.inject),
    skill: num(source.skill),
    assistant: num(source.assistant),
    tool: num(source.tool),
    items: normalizedItems,
    prompt: finiteNumber(source.prompt) ? num(source.prompt) : null,
    output: finiteNumber(source.output) ? num(source.output) : null
  };
}

function deriveTrend(value, t) {
  t = identity(t);
  var requests = (Array.isArray(value.requests) ? value.requests : [])
    .map(normalizeRequest)
    .filter(function (request) { return Number.isFinite(request.seq); })
    .sort(function (a, b) { return a.seq - b.seq; });
  var totalCount = requests.length;
  var bars = requests;
  var aggregated = false;
  if (totalCount > MAX_TREND_BARS) {
    // 按 turn 聚合：取该轮最后一条（与 dsh-context trendChart.aggregateByTurn 一致）。
    var lastByTurn = {};
    var order = [];
    requests.forEach(function (request) {
      if (!Object.prototype.hasOwnProperty.call(lastByTurn, request.turn)) order.push(request.turn);
      lastByTurn[request.turn] = request;
    });
    bars = order.map(function (turn) { return lastByTurn[turn]; });
    aggregated = true;
  }
  var maxTotal = 0;
  var rows = bars.map(function (request) {
    var total = request.total;
    var sum = TREND_KEYS.reduce(function (acc, key) { return acc + request[key]; }, 0);
    if (total <= 0) total = sum;
    if (total > maxTotal) maxTotal = total;
    return { request: request, total: total };
  });
  if (maxTotal <= 0) maxTotal = 1;
  var events = (Array.isArray(value.events) ? value.events : []).filter(function (event) {
    return isObject(event) && (event.kind === 'compaction' || event.kind === 'prune');
  });
  var markers = {};
  events.forEach(function (event) {
    var seq = num(event.seq);
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].request.seq >= seq) {
        markers[i] = (markers[i] || 0) + 1;
        break;
      }
    }
  });
  var lastLabel = -TREND_LABEL_GAP;
  var axis = [];
  var result = rows.map(function (row, index) {
    var request = row.request;
    var turnChanged = index === 0 || request.turn !== rows[index - 1].request.turn;
    var showTurn = index === 0 || (turnChanged && index - lastLabel >= TREND_LABEL_GAP);
    if (showTurn) {
      lastLabel = index;
      axis.push({ key: 'axis-' + index, left: index * TREND_BAR_PITCH, text: t('第 {n} 轮', { n: request.turn }) });
    }
    var segments = [];
    TREND_KEYS.forEach(function (key) {
      var value = request[key];
      if (value > 0) segments.push({ key: key, weight: value });
    });
    return {
      // seq 唯一且稳定：刷新时未变化的柱子可以继续做深比较，避免整块 setData。
      key: 'bar-' + request.seq,
      seq: request.seq,
      seqText: '#' + request.seq,
      total: row.total,
      totalText: formatCompact(row.total),
      height: row.total > 0 ? Math.max(1.5, Math.round((row.total / maxTotal) * 100)) : 0,
      hasData: row.total > 0,
      segments: segments,
      marker: markers[index] ? '✂' + (markers[index] > 1 ? '×' + markers[index] : '') : '',
      showTurn: showTurn,
      turnText: showTurn ? t('第 {n} 轮', { n: request.turn }) : ''
    };
  });
  return {
    empty: result.length === 0,
    count: result.length,
    totalCount: totalCount,
    aggregated: aggregated,
    maxTotalText: formatCompact(maxTotal === 1 && rows.length === 0 ? 0 : maxTotal),
    bars: result,
    axis: axis,
    // 末尾留出轮次标签的宽度，避免最后一条轴文字被 scroll-view 裁掉。
    trackWidth: result.length ? (result.length * TREND_BAR_PITCH - TREND_BAR_GAP + 72) : 0
  };
}

// ---------- 上下文浏览器（v2：逐请求查看 7 类组成） ----------

function sortedRequests(value) { return (Array.isArray(value.requests) ? value.requests : []).map(normalizeRequest) .filter(function (r) { return Number.isFinite(r.seq); }).sort(function (a, b) { return a.seq - b.seq; }); }

function currentRequestOf(value) { var cur = isObject(value.current) ? value.current : {}; var request = { seq: null, time: 0, turn: 0, items: null, prompt: null, output: null }; var sum = 0; CATEGORY_KEYS.forEach(function (k) { request[k] = num(cur[k]); sum += request[k]; }); request.total = num(cur.total) || sum; return request; }

function categoryDelta(current, previous, key) { if (!previous) return { text: '—', className: '' }; var diff = num(current) - num(previous.request[key]); if (diff === 0) return { text: '0', className: 'flat' }; return diff > 0 ? { text: '+' + formatCompact(diff), className: 'up' } : { text: '−' + formatCompact(-diff), className: 'down' }; }

/** 请求下拉（最近 30 条 +「当前（下一次请求）」）、上/下一步、7 类折叠行。 */
function deriveBrowser(value, t, options) {
  t = identity(t);
  var opts = options || {};
  var expanded = Array.isArray(opts.expanded) ? opts.expanded : [];
  var requests = sortedRequests(value).slice(-MAX_BROWSER_REQUESTS);
  var entries = requests.map(function (r) {
    return { key: 'req-' + r.seq, seq: r.seq, isCurrent: false, request: r, label: t('请求 #{n}', { n: formatCompact(r.seq) }) };
  });
  entries.push({ key: 'req-current', seq: null, isCurrent: true, request: currentRequestOf(value), label: t('当前（下一次请求）') });
  var selectedIndex = entries.length - 1;
  if (finiteNumber(opts.seq)) {
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].seq === num(opts.seq)) { selectedIndex = i; break; }
    }
  }
  var selected = entries[selectedIndex];
  var previous = selectedIndex > 0 ? entries[selectedIndex - 1] : null;
  var request = selected.request;
  var estimated = request.total > 0 ? request.total
    : CATEGORY_KEYS.reduce(function (a, k) { return a + num(request[k]); }, 0);
  var rows = CATEGORY_KEYS.map(function (key) {
    var v = num(request[key]);
    var delta = categoryDelta(v, previous, key);
    var pctText = formatPercent(v, estimated);
    return {
      key: key,
      label: t(CATEGORY_LABELS[key] || key),
      itemsText: request.items && finiteNumber(request.items[key]) ? formatCompact(request.items[key]) : '—',
      tokenText: '≈' + formatCompact(v),
      pctText: pctText,
      deltaText: delta.text,
      deltaClass: delta.className,
      expanded: expanded.indexOf(key) >= 0,
      detailText: t('≈{tokens} tok · 占本请求 {pct} · 明细暂不展示', { tokens: formatCompact(v), pct: pctText })
    };
  });
  return {
    empty: requests.length === 0,
    count: requests.length,
    countText: requests.length > 0 ? t('最近 {n} 条', { n: formatCompact(requests.length) }) : '',
    options: entries.map(function (e) { return { key: e.key, seq: e.seq, label: e.label }; }),
    selectedIndex: selectedIndex,
    selectedLabel: selected.label,
    isCurrent: selected.isCurrent,
    canPrev: selectedIndex > 0,
    canNext: selectedIndex < entries.length - 1,
    prevSeq: selectedIndex > 0 ? entries[selectedIndex - 1].seq : null,
    nextSeq: selectedIndex < entries.length - 1 ? entries[selectedIndex + 1].seq : null,
    estimated: estimated,
    estimatedText: estimated > 0 ? '≈' + formatCompact(estimated) : '—',
    promptText: request.prompt === null ? '—' : formatCompact(request.prompt),
    timeText: selected.isCurrent ? '' : formatTime(selected.request.time),
    rows: rows,
    estimatedLabel: t('估算合计'),
    promptLabel: t('实际 prompt')
  };
}

// ---------- 最近上下文事件 ----------

function eventKindText(kind, t) {
  if (kind === 'compaction') return t('压缩');
  if (kind === 'prune') return t('剪枝');
  if (kind === 'inject') return t('注入');
  return t('其他');
}

function deriveEvents(value, t) {
  t = identity(t);
  var events = Array.isArray(value.events) ? value.events : [];
  var rows = events
    .filter(function (event) { return isObject(event); })
    .slice(-MAX_EVENTS)
    .reverse()
    .map(function (event, index) {
      var kind = text(event.kind) || 'inject';
      var tokens = Number.isFinite(Number(event.tokens)) ? num(event.tokens) : null;
      return {
        key: 'ev-' + index + '-' + num(event.seq),
        timeText: formatTime(num(event.time)),
        kindText: eventKindText(kind, t),
        kindClass: kind,
        name: text(event.name),
        tokensText: tokens !== null ? '−' + formatCompact(tokens) : '',
        countText: num(event.count) > 1 ? '×' + formatCompact(event.count) : ''
      };
    });
  return { rows: rows, empty: rows.length === 0 };
}

// ---------- 面板 ----------

var SECTIONS = ['current', 'usage', 'counts', 'tools', 'timing', 'stats', 'requests', 'events', 'breakdown'];

function hasContextShape(value) {
  if (!isObject(value)) return false;
  for (var i = 0; i < SECTIONS.length; i += 1) {
    if (value[SECTIONS[i]] !== undefined && value[SECTIONS[i]] !== null) return true;
  }
  return false;
}

function emptyPanel(t, status, stateText) {
  return {
    status: status,
    loading: status === 'loading',
    running: false,
    errorText: '',
    stateText: stateText || '',
    hintText: '',
    asOfSeq: null,
    // 状态面板也保留空 meta，WXML 顶栏可以直接取 meta.model 而不必判空。
    meta: { model: '', provider: '', contextWindow: 0, contextWindowText: '' },
    stats: null,
    tokens: null,
    timing: null,
    current: null,
    browser: null,
    trend: null,
    events: null
  };
}

/**
 * 把 store 的 `sessionState.contextDashboard` 转成面板视图模型。
 *
 * @param {object|null} dashboard { loading, error, code, unsupported, asOfSeq, value }
 * @param {object} [options] { t, connected, hasSession }
 * @returns {object} { status: loading|disconnected|empty|unsupported|error|ready, ... }
 */
function buildPanel(dashboard, options) {
  var opts = options || {};
  var t = identity(opts.t);
  var connected = opts.connected !== false;
  var hasSession = opts.hasSession !== false;
  if (!connected) return emptyPanel(t, 'disconnected', t('连接网关后可查看上下文'));
  if (!hasSession) return emptyPanel(t, 'empty', t('打开会话后可查看上下文'));
  if (!isObject(dashboard)) return emptyPanel(t, 'loading');
  if (dashboard.unsupported === true) {
    var unsupported = emptyPanel(t, 'unsupported', t('需升级网关以显示上下文'));
    unsupported.hintText = t('当前网关未提供上下文数据，请升级 dsh-plugin-mobile-gateway 与 DSH。');
    return unsupported;
  }
  if (text(dashboard.error)) {
    var failed = emptyPanel(t, 'error', '');
    failed.errorText = text(dashboard.error) || t('上下文数据加载失败');
    return failed;
  }
  var value = dashboard.value;
  if (!isObject(value) || !hasContextShape(value)) {
    if (dashboard.loading === true) return emptyPanel(t, 'loading');
    var malformed = emptyPanel(t, 'error', '');
    malformed.errorText = t('上下文数据格式异常');
    return malformed;
  }
  try {
    var tokens = deriveTokens(value, t);
    var fleetValue = isObject(opts.fleet) ? opts.fleet : null;
    var panel = {
      status: 'ready',
      loading: dashboard.loading === true,
      running: opts.running === true,
      errorText: '',
      stateText: '',
      hintText: '',
      asOfSeq: Number.isFinite(Number(dashboard.asOfSeq)) ? Number(dashboard.asOfSeq) : num(value.asOfSeq),
      meta: {
        model: text(value.model),
        provider: text(value.provider),
        contextWindow: num(value.contextWindow),
        contextWindowText: num(value.contextWindow) > 0 ? formatCompact(value.contextWindow) : ''
      },
      stats: deriveStats(value, tokens, t, fleetValue),
      tokens: tokens,
      timing: deriveTiming(value, t),
      current: deriveCurrent(value, t),
      browser: deriveBrowser(value, t, { seq: opts.browserSeq, expanded: opts.expanded }),
      trend: deriveTrend(value, t),
      events: deriveEvents(value, t)
    };
    return panel;
  } catch (error) {
    var broken = emptyPanel(t, 'error', '');
    broken.errorText = t('上下文数据格式异常');
    return broken;
  }
}

// ---------- 编队（Fleet：当前 Agent 的家族网络） ----------

var MAX_FLEET_AGENTS = 40;            // 与宿主上限一致；超出只渲染前 40 个
var FLEET_INDENT_RPX = 24;            // 每层 depth 缩进
var FLEET_MAX_INDENT_DEPTH = 5;       // 缩进最多 5 层，再深的层级不再右移
var FLEET_MODE_LABELS = { 'one-shot': '一次性', continuable: '可续' };

function finiteNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function emptyFleetPanel(status, stateText) {
  return {
    status: status,
    loading: status === 'loading',
    running: false,
    errorText: '',
    stateText: stateText || '',
    hintText: '',
    asOfSeq: null,
    overview: null,
    agents: [],
    team: null,
    subagentHint: ''
  };
}

/** 任务状态徽标：未知状态原样展示（数据，不是文案）。 */
function taskStatusClassOf(raw) { var value = text(raw).toLowerCase(); if (value === 'in_progress' || value === 'inprogress' || value === 'active' || value === 'running') return 'active'; if (value === 'completed' || value === 'done') return 'done'; if (value === 'failed') return 'failed'; if (value === 'blocked') return 'blocked'; if (value === 'cancelled' || value === 'canceled') return 'cancelled'; return 'pending'; }

function taskStatusOf(status, t) { var raw = text(status); var label = TASK_STATUS_LABELS[raw]; return { statusText: label ? t(label) : (raw || t('待处理')), statusClass: taskStatusClassOf(raw) }; }

function normalizedPhaseOf(raw) { var value = text(raw).toLowerCase(); if (!value) return ''; if (value === 'active' || value === 'running' || value === 'inprogress' || value === 'in_progress') return 'active'; if (value === 'failed') return 'failed'; if (value === 'blocked') return 'blocked'; if (value === 'done' || value === 'completed') return 'done'; if (value === 'cancelled' || value === 'canceled') return 'cancelled'; if (value === 'waiting' || value === 'pending') return 'waiting'; return 'idle'; }

/** 单个 Agent 卡片：宿主字段全部可选，缺失按空/0 处理，类型错误降级。 */
function fleetAgentCard(raw, rootSessionId, currentSessionId, t, membersById) {
  var source = isObject(raw) ? raw : {};
  var sessionId = text(source.sessionId) || text(source.id);
  if (!sessionId) return null;
  var depth = Math.max(0, Math.floor(num(source.depth)));
  var isRoot = source.isRoot === true || (!!rootSessionId && sessionId === rootSessionId);
  var isCurrent = source.isCurrent === true || (!!currentSessionId && sessionId === currentSessionId);
  var running = source.running === true;
  var label = text(source.label);
  var title = text(source.title) || label || sessionId;
  var mode = text(source.mode);
  var modeText = FLEET_MODE_LABELS[mode] ? t(FLEET_MODE_LABELS[mode]) : '';

  var member = membersById && membersById[sessionId] ? membersById[sessionId] : null;
  var role = member ? text(member.role) || text(member.name) : '';
  var rawPhase = text(source.phase) || (member ? text(member.phase) : '');
  var phaseKey = normalizedPhaseOf(rawPhase);
  var knownPhase = rawPhase ? PHASE_LABELS[rawPhase.toLowerCase()] : '';
  // 已知 phase 走字典；未知 phase 原样当作数据展示，不误标成「空闲」。
  var phaseLabel = knownPhase ? t(knownPhase) : rawPhase;
  var lastAnswer = text(source.lastAnswer).replace(/\s+/g, ' ');
  if (lastAnswer.length > MAX_LAST_ANSWER) lastAnswer = lastAnswer.slice(0, MAX_LAST_ANSWER) + '…';

  var pressureTokens = finiteNumber(source.pressureTokens) ? num(source.pressureTokens) : null;
  var contextWindow = finiteNumber(source.contextWindow) ? num(source.contextWindow) : 0;
  var hasOccupancy = pressureTokens !== null && contextWindow > 0;
  var used = hasOccupancy ? pressureTokens : 0;
  var occupancy = {
    hasData: hasOccupancy,
    width: hasOccupancy ? Math.min(100, (used / contextWindow) * 100) : 0,
    pctText: hasOccupancy ? formatPercent(used, contextWindow) : '',
    usedText: hasOccupancy ? formatCompact(used) : '',
    windowText: hasOccupancy ? formatCompact(contextWindow) : ''
  };

  // 7 类组成色条：宿主给 composition.total 时以它为分母（与文档一致），
  // 缺失时退回 7 类合计，避免整除 0。
  var composition = isObject(source.composition) ? source.composition : null;
  var compositionTotal = composition && finiteNumber(composition.total) ? num(composition.total) : null;
  var segments = [];
  var partsTotal = 0;
  if (composition) {
    CATEGORY_KEYS.forEach(function (key) {
      var partValue = num(composition[key]);
      partsTotal += partValue;
      if (partValue > 0) segments.push({ key: key, value: partValue });
    });
  }
  // total 缺失（或宿主异常置 0）时退回 7 类合计，避免整条色条消失。
  if (!(compositionTotal > 0)) compositionTotal = partsTotal;
  var hasComposition = compositionTotal > 0;
  if (!hasComposition) segments = [];
  else {
    segments = segments.map(function (segment) {
      return { key: segment.key, width: (segment.value / compositionTotal) * 100 };
    });
  }

  var tokensTotal = finiteNumber(source.tokensTotal) ? num(source.tokensTotal) : null;
  var turns = finiteNumber(source.turns) ? num(source.turns) : null;
  var steps = finiteNumber(source.steps) ? num(source.steps) : null;
  var activeMs = finiteNumber(source.activeMs) ? num(source.activeMs) : 0;
  var indentDepth = Math.min(depth, FLEET_MAX_INDENT_DEPTH);
  return {
    key: sessionId,
    sessionId: sessionId,
    title: title,
    label: label,
    depth: depth,
    indentStyle: 'margin-left:' + (indentDepth * FLEET_INDENT_RPX) + 'rpx;',
    isCurrent: isCurrent,
    isRoot: isRoot,
    running: running,
    stateText: running ? t('运行中') : t('空闲'),
    modeText: modeText,
    role: role,
    roleText: role ? t('角色') + ' ' + role : '',
    phase: phaseKey,
    phaseText: phaseLabel || '',
    phaseClass: phaseKey,
    lastAnswer: lastAnswer,
    hasAnswer: lastAnswer !== '',
    occupancy: occupancy,
    composition: {
      hasData: hasComposition,
      totalText: hasComposition ? formatCompact(compositionTotal) : '',
      segments: segments
    },
    tokensText: tokensTotal === null ? '—' : formatCompact(tokensTotal),
    turnsText: turns === null ? '—' : formatCompact(turns),
    stepsText: steps === null ? '—' : formatCompact(steps),
    activeText: formatDuration(activeMs)
  };
}

function deriveFleetOverview(value, rawAgents, cards) {
  var counts = isObject(value.counts) ? value.counts : {};
  var agentsCount = finiteNumber(counts.agents) ? num(counts.agents) : cards.length;
  var runningFallback = 0;
  cards.forEach(function (card) { if (card.running) runningFallback += 1; });
  var runningCount = finiteNumber(counts.running) ? num(counts.running) : runningFallback;
  var rootCount = 0;
  cards.forEach(function (card) { if (card.isRoot) rootCount += 1; });
  var subagentsCount = finiteNumber(counts.subagents) ? num(counts.subagents) : Math.max(0, cards.length - rootCount);
  var totalTokens = 0;
  rawAgents.forEach(function (agent) {
    if (isObject(agent) && finiteNumber(agent.tokensTotal)) totalTokens += num(agent.tokensTotal);
  });
  return {
    agents: agentsCount,
    agentsText: formatCompact(agentsCount),
    running: runningCount,
    runningText: formatCompact(runningCount),
    subagents: subagentsCount,
    subagentsText: formatCompact(subagentsCount),
    tokensTotal: totalTokens,
    tokensText: formatCompact(totalTokens)
  };
}

/**
 * 把 store 的 `sessionState.contextFleet` 转成「编队」面板视图模型。
 *
 * @param {object|null} fleet { loading, error, code, unsupported, asOfSeq, value }
 * @param {object} [options] { t, connected, hasSession }
 * @returns {object} { status: loading|disconnected|empty|unsupported|error|ready, overview, agents }
 */
function buildFleetPanel(fleet, options) {
  var opts = options || {};
  var t = identity(opts.t);
  var connected = opts.connected !== false;
  var hasSession = opts.hasSession !== false;
  if (!connected) return emptyFleetPanel('disconnected', t('连接网关后可查看编队'));
  if (!hasSession) return emptyFleetPanel('empty', t('打开会话后可查看编队'));
  if (!isObject(fleet)) return emptyFleetPanel('loading');
  if (fleet.unsupported === true) {
    var unsupported = emptyFleetPanel('unsupported', t('需升级网关以显示编队'));
    unsupported.hintText = t('当前网关未提供编队数据，请升级 dsh-plugin-mobile-gateway 与 DSH。');
    return unsupported;
  }
  if (text(fleet.error)) {
    var failed = emptyFleetPanel('error', '');
    failed.errorText = text(fleet.error) || t('编队数据加载失败');
    return failed;
  }
  var value = isObject(fleet.value) ? fleet.value : null;
  var hasAgentList = !!value && Array.isArray(value.agents);
  var hasFamilyShape = !!value && (hasAgentList || isObject(value.counts) || value.rootSessionId != null);
  if (!hasFamilyShape) {
    if (fleet.loading === true) return emptyFleetPanel('loading');
    var malformed = emptyFleetPanel('error', '');
    malformed.errorText = t('编队数据格式异常');
    return malformed;
  }
  try {
    var rootSessionId = text(value.rootSessionId);
    var currentSessionId = text(value.currentSessionId);
    var rawAgents = (hasAgentList ? value.agents : []).slice(0, MAX_FLEET_AGENTS);
    var team = isObject(value.team) ? value.team : null;
    var membersById = {};
    if (team && Array.isArray(team.members)) {
      team.members.forEach(function (member) {
        if (!isObject(member)) return;
        var memberId = text(member.id) || text(member.sessionId);
        if (memberId) membersById[memberId] = member;
      });
    }
    var cards = [];
    rawAgents.forEach(function (raw) {
      var card = fleetAgentCard(raw, rootSessionId, currentSessionId, t, membersById);
      if (card) cards.push(card);
    });
    var asOfSeq = finiteNumber(fleet.asOfSeq) ? Number(fleet.asOfSeq)
      : (finiteNumber(value.asOfSeq) ? Number(value.asOfSeq) : null);
    if (!cards.length) {
      var empty = emptyFleetPanel('empty', t('暂无编队'));
      empty.loading = fleet.loading === true;
      empty.asOfSeq = asOfSeq;
      empty.running = opts.running === true;
      return empty;
    }
    return {
      status: 'ready',
      loading: fleet.loading === true,
      running: opts.running === true,
      errorText: '',
      stateText: '',
      hintText: '',
      asOfSeq: asOfSeq,
      overview: deriveFleetOverview(value, rawAgents, cards),
      agents: cards,
      subagentHint: cards.length <= 1
        ? t('还没有子 Agent —— 当 Agent 通过 subagent 工具委派任务时，协作网络会在这里展开')
        : '',
      team: deriveFleetTeam(team, t)
    };
  } catch (error) {
    var broken = emptyFleetPanel('error', '');
    broken.errorText = t('编队数据格式异常');
    return broken;
  }
}

/** 编队任务列表：team.tasks（subject/status/ownerName）；空态提示。 */
function deriveFleetTeam(team, t) { if (!team) { return { hasTeam: false, tasks: [], tasksEmpty: true, tasksEmptyText: t('暂无任务，可以通过对话创建'), taskCountText: '', failure: '' }; } var tasks = (Array.isArray(team.tasks) ? team.tasks : []) .filter(function (task) { return isObject(task); }) .slice(0, MAX_TEAM_TASKS) .map(function (task, index) { var status = taskStatusOf(task.status, t); var owner = text(task.ownerName); return { key: 'task-' + index + '-' + (text(task.id) || index), subject: text(task.subject) || text(task.title) || t('任务'), statusText: status.statusText, statusClass: status.statusClass, ownerText: owner, hasOwner: owner !== '' }; }); return { hasTeam: true, tasks: tasks, tasksEmpty: tasks.length === 0, tasksEmptyText: t('暂无任务，可以通过对话创建'), taskCountText: tasks.length > 0 ? formatCompact(tasks.length) : '', failure: text(team.failure), label: t('任务') }; }

module.exports = {
  CATEGORY_KEYS: CATEGORY_KEYS,
  CATEGORY_LABELS: CATEGORY_LABELS,
  MAX_TREND_BARS: MAX_TREND_BARS,
  MAX_FLEET_AGENTS: MAX_FLEET_AGENTS,
  formatCompact: formatCompact,
  formatPercent: formatPercent,
  formatDuration: formatDuration,
  formatTime: formatTime,
  officialParts: officialParts,
  scaleParts: scaleParts,
  deriveTokens: deriveTokens,
  deriveStats: deriveStats,
  deriveActivity: deriveActivity,
  deriveNetwork: deriveNetwork,
  deriveCurrent: deriveCurrent,
  deriveTiming: deriveTiming,
  deriveTimeline: deriveTimeline,
  deriveTrend: deriveTrend,
  deriveBrowser: deriveBrowser,
  deriveEvents: deriveEvents,
  hasContextShape: hasContextShape,
  buildPanel: buildPanel,
  buildFleetPanel: buildFleetPanel
};
