// 会话「上下文」面板的纯数据派生（对齐 dsh-context v0.74.0 的 Context tab）。
//
// 输入是网关 `context-dashboard` 帧的 value（mobileContext wire view +
// breakdown/usage/stats），输出是页面可直接渲染的视图模型：所有 label 在
// 这里通过注入的 t() 本地化，所有数字格式化、比例和堆叠柱都在
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
// 趋势图几何：与 dsh-context trendWindow.ts / trendChart.tsx / trendChart.css 逐值对齐。
// dsh 用 px（14px 柱 + 2px 缝 + 112px 绘图区 + 18px 顶 padding），小程序按 rpx = px × 2
// 落地，在 375pt 机上得到与 Web 面板完全一致的真实像素几何。
var TREND_BAR_W = 28;
var TREND_BAR_GAP = 4;
var TREND_BAR_PITCH = TREND_BAR_W + TREND_BAR_GAP;
var TREND_CHART_H = 224;
var MAX_TREND_DNA_BANDS = 24;      // per-bar DNA slices (payload bound: setData caps at ~1MB)
var MAX_OVERVIEW_COLUMNS = 140;   // overview ribbon samples (CSS columns, no inline SVG in WXML)
// 耗时折线：微信小程序对内联 SVG 支持不稳定（会话页 ctx-flow 的连接带同为此改用
// 原生 view 线段），曲线因此每段拼一根旋转细条，halo 层垫在下层提对比。
// 几何与 dsh-context 的 DurationCurve 逐值对齐：core 2.5rpx = 1.25px × 2，
// halo 6rpx = 3px × 2；圆头（border-radius 半高）代替 stroke-linecap: round。
var DURATION_CORE_W = 2.5;
var DURATION_HALO_W = 6;
var DURATION_DOT_W = 6;           // 孤立单点：halo 直径（dsh-context r=2 → 直径 4px × 2 取 6）
var DURATION_DOT_CORE = 3;        // 孤立单点：core 直径（r=1.2 → 2.4px × 2 取 3）
// 总览带把整段会话拉伸到可视宽：折线 x 需要真实可视宽度（rpx）。测量不到时用
// 375pt 机的解析值兜底（屏 750 − 滚动区 32×2 − 卡片 16×2+1×2 − 轴 80）。
var OVERVIEW_PANE_FALLBACK_RPX = 572;
var MAX_BROWSER_DNA_ROWS = 40;
var TREND_TOP_PAD = 36;
var TREND_CHART_BOX = TREND_CHART_H + TREND_TOP_PAD;
// 轴/网格刻度：top 36 / q3 92 / mid 148 / q1 204 / zero 260（与 .lc-grid 一致）。
var TREND_AXIS_W = 80;
var TREND_TURN_H = 28;
var TREND_TURN_GAP = TREND_BAR_GAP;
var TREND_TURN_MARGIN = 8;
var TREND_STEP_FLAG_EVERY = 5;
var TREND_RISE_CAP = 200;
var TREND_WINDOW_MIN = 240;
var TREND_WINDOW_OVERSCAN = 36;
var TREND_WINDOW_HYSTERESIS = 8;
var TREND_LABEL_FONT = 20;
var TREND_LABEL_FONT_MIN = 12;
var TREND_MARKER_FONT = 22;
var TREND_FLAG_FONT = 18;
var TREND_AXIS_FONT = 22;
var MAX_EVENTS = 12;
var MAX_TOOL_ROWS = 3;
var MAX_FILE_ROWS = 30;
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

// 缓存命中率：截断两位小数（dsh-context fmt.cacheHitPercent），组件再拼「缓存命中 {x}%」。
function cacheHitPercent(reads, billed) {
  if (!(billed > 0)) return null;
  var scaled = Math.trunc((reads / billed) * 100 * 100 + 1e-9);
  return String(Math.floor(scaled / 100)) + '.' + pad2(scaled % 100);
}

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
  var hit = cacheHitPercent(cacheRead, input);
  var donut = tokenDonut(rows, total);
  return {
    available: usage !== null,
    input: input,
    output: output,
    total: total,
    totalText: usage !== null ? formatCompact(total) : '—',
    inputText: formatCompact(input),
    outputText: formatCompact(output),
    cacheHit: hit === null ? null : Number(hit),
    cacheHitText: hit === null ? '—' : hit + '%',
    hitText: hit,
    hasHit: hit !== null,
    cacheHitLabel: t('缓存命中'),
    // 环心：总数 + 「总用量」（dsh-context statsTokens centerTop/centerSub）。
    centerText: usage !== null ? formatCompact(total) : '—',
    centerSub: t('总用量'),
    rows: rows,
    bar: rows.filter(function (row) { return row.value > 0; }),
    donut: donut
  };
}

function tokenRow(key, value, estimate, total, usage, t) {
  var available = usage !== null;
  var v = num(value);
  var rounded = formatCompact(v);
  var display = available ? (estimate ? '≈' : '') + rounded : '—';
  // 图例副行：prompt 侧带 ≈（比例估算）；output 为 provider 精确值，改带「含思考」。
  var subText = estimate ? '≈' + rounded : rounded + ' · ' + t('含思考');
  if (!available) subText = estimate ? '≈0' : '0 · ' + t('含思考');
  return {
    key: key,
    label: t(CATEGORY_LABELS[key] || key),
    value: v,
    display: display,
    subText: subText,
    pct: available ? formatPercent(v, total) : '—',
    width: available && num(total) > 0 ? (v / num(total)) * 100 : 0,
    estimate: estimate && available,
    hidden: available && v <= 0
  };
}

// ---------- 统计卡 ----------

/** 输入输出 5 chip（v2 activity；旧帧缺失时整组显示 —）。 */
// 输入输出胶囊（dsh-context statsContext.tsx）：五枚横向胶囊，零值 dim；
// 搜索/图片为 0 时整枚不渲染（Ctx:479-480）。
function deriveActivity(value, t) {
  t = identity(t);
  var a = isObject(value.activity) ? value.activity : null;
  var chips = ACTIVITY_KEYS.map(function (k) {
    var on = a !== null && finiteNumber(a[k]);
    var raw = on ? num(a[k]) : 0;
    var zero = !on || raw === 0;
    return {
      key: k,
      label: t(ACTIVITY_LABELS[k]),
      text: on ? formatCompact(raw) : '—',
      dim: zero,
      hidden: zero && (k === 'searches' || k === 'images')
    };
  });
  var total = 0;
  ACTIVITY_KEYS.forEach(function (k) { if (a !== null && finiteNumber(a[k])) total += num(a[k]); });
  return { hasData: chips.some(function (c) { return c.text !== '—'; }), chips: chips, totalText: a === null ? '—' : formatCompact(total) };
}

/** Agent 网络：当前 Agent token + 子 Agent 数（来自 context-fleet；缺失隐藏）。 */
function deriveNetwork(value, tokens, fleet, t) {
  t = identity(t);
  if (isObject(fleet) !== true) return { hasData: false, agentTokensText: '', subTokensText: '', subagentsText: '', subagents: 0, rows: [] };
  var agents = Array.isArray(fleet.agents) ? fleet.agents.filter(isObject) : null;
  var counts = isObject(fleet.counts) ? fleet.counts : {};
  var currentSessionId = text(fleet.currentSessionId);
  var current = null;
  if (agents) {
    for (var i = 0; i < agents.length; i += 1) {
      if (agents[i].isCurrent === true || (currentSessionId && text(agents[i].sessionId) === currentSessionId)) {
        current = agents[i];
        break;
      }
    }
  }
  var tokensTotal = current && finiteNumber(current.tokensTotal) ? num(current.tokensTotal) : (tokens && tokens.available ? num(tokens.total) : null);
  var subTokens = null;
  if (agents) {
    agents.forEach(function (agent) {
      if (agent === current || !finiteNumber(agent.tokensTotal)) return;
      subTokens = (subTokens === null ? 0 : subTokens) + num(agent.tokensTotal);
    });
  }
  // DSH derives counts from its Agent forest, not the potentially stale wire summary.
  var hasAgentList = agents !== null;
  var agentsCount = hasAgentList ? agents.length : (finiteNumber(counts.agents) ? num(counts.agents) : 0);
  var subagentsCount = hasAgentList
    ? agents.filter(function (agent) { return agent !== current; }).length
    : (finiteNumber(counts.subagents) ? num(counts.subagents) : 0);
  var subagentsText = formatCompact(subagentsCount);
  return {
    hasData: hasAgentList ? agents.length > 0 : finiteNumber(counts.agents),
    agentsText: formatCompact(agentsCount),
    agentTokensText: tokensTotal === null ? '—' : formatCompact(tokensTotal),
    subTokensText: subTokens === null ? '—' : formatCompact(subTokens),
    subagents: subagentsCount,
    subagentsText: subagentsText,
    subagentLabel: t('子 Agent'),
    rows: [
      { key: 'current', label: t('当前 Agent'), tokensText: tokensTotal === null ? '—' : formatCompact(tokensTotal) },
      { key: 'subagents', label: t('子 Agent') + ' × ' + subagentsText, tokensText: subTokens === null ? '—' : formatCompact(subTokens) }
    ]
  };
}

function deriveStats(value, tokens, t, fleet) {
  t = identity(t);
  var counts = isObject(value.counts) ? value.counts : {};
  var activityValue = isObject(value.activity) ? value.activity : null;
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
  // 工具胶囊：单行贪心折叠，末尾恒有一枚「其他 +{n}」（n=未展示的工具个数，
  // 为 0 时仍渲染「其他 +0」，对齐 dsh-context statsContext ToolPills）。
  var visibleTools = top.slice(0, MAX_TOOL_ROWS);
  var toolDefinitionCount = finiteNumber(tools.count) ? num(tools.count) : names.length;
  var hiddenTools = Math.max(0, toolDefinitionCount - visibleTools.length);
  var toolPills = visibleTools.map(function (item) {
    return { key: 'pill-' + item.name, name: item.name, countText: item.countText, more: false };
  });
  toolPills.push({ key: 'pill-more', name: t('其他') + ' +' + formatCompact(hiddenTools), countText: '', more: true });
  var ioTotal = 0;
  if (activityValue !== null) {
    ['userInputs', 'reads', 'writes', 'searches', 'images'].forEach(function (k) { if (finiteNumber(activityValue[k])) ioTotal += num(activityValue[k]); });
  }
  var ioTotalText = activityValue === null ? '—' : formatCompact(ioTotal);
  var eventTotal = num(counts.injects) + num(counts.compactions) + num(counts.prunes);
  return {
    ioTotalText: ioTotalText,
    eventTotalText: formatCompact(eventTotal),
    toolTotal: toolTotal,
    toolTotalText: formatCompact(toolTotal),
    toolNames: top,
    toolPills: toolPills,
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
var RESERVE_HEADROOM = 65536;
var RESERVE_OUTPUT_RATIO = 0.1;

/** 当前上下文：窗口占用 + 7 类组成 + 压缩预留（dsh-context currentComposition + reserve.ts）。 */
function deriveCurrent(value, t, contextPressure, highlight) {
  t = identity(t);
  var cur = isObject(value.current) ? value.current : {};
  var pressureSource = isObject(value.contextPressure) ? value.contextPressure
    : (isObject(value.pressure) ? value.pressure : (isObject(contextPressure) ? contextPressure : {}));
  var win = num(value.contextWindow) || num(pressureSource.contextWindow);
  var values = CATEGORY_KEYS.map(function (k) { return num(cur[k]); });
  var compositionTotal = values.reduce(function (a, b) { return a + b; }, 0);
  var pressure = finiteNumber(pressureSource.pressureTokens)
    ? num(pressureSource.pressureTokens)
    : (num(cur.total) || compositionTotal);
  var hasData = win > 0 && pressure > 0;
  var scale = win > 0 ? win : (pressure || compositionTotal);
  var usedWidth = hasData ? Math.min(100, (pressure / win) * 100) : 0;
  var remainingWidth = Math.max(0, 100 - usedWidth);
  var reserveWidth = Math.min(RESERVE_MAX_WIDTH, remainingWidth);
  remainingWidth -= reserveWidth;
  var highlightKey = text(highlight);
  var rows = CATEGORY_KEYS.map(function (k, i) {
    return {
      key: k,
      label: t(CATEGORY_LABELS[k] || k),
      width: hasData && compositionTotal > 0 ? (values[i] / compositionTotal) * usedWidth : 0,
      tokenText: values[i] > 0 ? '≈' + formatCompact(values[i]) : '0',
      valueText: '≈' + formatCompact(values[i]),
      pctText: formatPercent(values[i], compositionTotal),
      // 点图例高亮一个类别：其余行/段淡出（触屏替代 hover 联动）。
      active: highlightKey !== '' && highlightKey === k,
      dim: highlightKey !== '' && highlightKey !== k
    };
  });
  // 条形按窗口比例（不是组成比例）：与 dsh-context StackedBar(max=window) 一致。
  var barSegments = CATEGORY_KEYS.map(function (k, i) {
    return {
      key: k,
      width: scale > 0 ? Math.min(100, (values[i] / scale) * 100) : 0,
      active: highlightKey !== '' && highlightKey === k,
      dim: highlightKey !== '' && highlightKey !== k
    };
  }).filter(function (segment) { return segment.width > 0; });
  // 压缩预留：headroom 固定 65536；输出预留取窗口的 10%（宿主未提供 maxOutputTokens 时的回退）。
  var freeWidth = Math.max(0, 100 - usedWidth);
  var headroomMask = null, outputMask = null, triggerLeft = null;
  var outReserve = win > 0 ? Math.min(finiteNumber(value.maxOutputTokens) ? num(value.maxOutputTokens) : Math.round(win * RESERVE_OUTPUT_RATIO), win) : 0;
  var maskStart = win - outReserve - RESERVE_HEADROOM;
  var trackPct = function (x) {
    return Math.round(Math.max(0, Math.min(100, (x / win) * 100)) * 10) / 10;
  };
  if (win > 0 && outReserve > 0 && maskStart > 0) {
    var headLeft = trackPct(maskStart);
    var headWidth = Math.max(0, trackPct(maskStart + RESERVE_HEADROOM) - headLeft);
    var outLeft = trackPct(win - outReserve);
    var outWidth = Math.max(0, trackPct(win) - outLeft);
    headroomMask = headWidth > 0 ? { left: headLeft, width: headWidth } : null;
    outputMask = outWidth > 0 ? { left: outLeft, width: outWidth } : null;
    var threshold = Math.min(Math.floor(win * 0.8), win - outReserve - RESERVE_HEADROOM);
    if (threshold > 0 && threshold < maskStart) triggerLeft = trackPct(threshold);
  }
  return {
    hasData: hasData,
    usedWidth: usedWidth,
    numText: hasData ? formatCompact(pressure) : '—',
    windowSuffix: win > 0 ? '/ ' + formatCompact(win) + ' tokens' : t('tokens（估算）'),
    occupancyText: hasData ? (Math.min(100, Math.round((pressure / win) * 1000) / 10)).toFixed(1) + '%' : '',
    pressureText: hasData ? '≈' + formatCompact(pressure) : '—',
    windowText: win > 0 ? formatCompact(win) : '—',
    usedPctText: hasData ? formatPercent(pressure, win) : '—',
    remainingWidth: remainingWidth,
    reserveWidth: reserveWidth,
    remainingText: hasData ? '≈' + formatCompact(Math.max(0, win - pressure)) : '—',
    reserveText: win > 0 ? '≈' + formatCompact(Math.round(win * RESERVE_OUTPUT_RATIO)) : '—',
    freeWidth: freeWidth,
    headroomMask: headroomMask,
    outputMask: outputMask,
    triggerLeft: triggerLeft,
    barSegments: barSegments,
    segments: rows.filter(function (r) { return r.width > 0; }),
    rows: rows,
    remainingLabel: t('窗口剩余'),
    reserveLabel: t('压缩预留区')
  };
}

/** 环形图（conic-gradient）：rows 的占比；色值走主题 CSS 变量。 */
function tokenDonut(rows, total) { var goal = num(total), acc = 0, stops = []; if (goal <= 0) return { available: false, style: '' }; rows.forEach(function (r) { if (r.value <= 0) return; var end = Math.min(100, ((acc + r.value) / goal) * 100); stops.push('var(--ctx-c-' + r.key + ') ' + (acc / goal * 100).toFixed(2) + '% ' + end.toFixed(2) + '%'); acc += r.value; }); return { available: stops.length > 0, style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '' }; }

// ---------- 耗时统计 ----------

function timingHasV2(timing) { if (!isObject(timing)) return false; return ['ttftMs', 'reasoningMs', 'textMs', 'toolArgMs', 'toolsMs', 'otherMs', 'waitCount', 'reasoningCount', 'textCount', 'toolArgCount', 'toolCount', 'speedTokens', 'speedMs'] .some(function (k) { return finiteNumber(timing[k]); }); }

/** 一段耗时：百分比以 wall 为分母（dsh-context fmtShare(ms, wall)），副行 = 时长 · 次数。 */
function timingSliceRow(key, label, ms, count, wall, t) {
  var v = num(ms);
  var duration = formatDuration(v);
  var countText = count > 0 ? t('{n} 次', { n: formatCompact(count) }) : '';
  return {
    key: key,
    label: label,
    ms: v,
    width: wall > 0 ? (v / wall) * 100 : 0,
    pctText: wall > 0 ? formatPercent(v, wall) : '—',
    durationText: duration,
    countText: countText,
    subText: v > 0 ? duration + (countText ? ' · ' + countText : '') : countText,
    dim: v <= 0
  };
}

/** 时间轴：各段按耗时占比紧凑铺排（dsh-context timingStrip，接缝不计空档）。 */
function deriveTimeline(value) {
  var spans = [];
  (Array.isArray(value.spans) ? value.spans : []).forEach(function (span) {
    if (!Array.isArray(span) || span.length < 3) return;
    var start = Number(span[1]), end = Number(span[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    spans.push({ kind: TIMING_KINDS[Math.floor(num(span[0]))] || 'other', start: start, end: end });
  });
  spans = spans.slice(-MAX_TIMELINE_SPANS);
  if (!spans.length) return { hasData: false, items: [], ticks: [] };
  var total = spans.reduce(function (sum, span) { return sum + (span.end - span.start); }, 0);
  if (!(total > 0)) return { hasData: false, items: [], ticks: [] };
  var acc = 0;
  var items = spans.map(function (span, index) {
    var dur = span.end - span.start;
    var left = (acc / total) * 100;
    var width = (dur / total) * 100;
    acc += dur;
    return {
      key: 'span-' + index + '-' + span.start,
      kind: span.kind,
      style: 'left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%;'
    };
  });
  // 刻度：零、四分位、全程（dsh-context TICK_FRACS）。
  var ticks = [0, 0.25, 0.5, 0.75, 1].map(function (frac, index) {
    var ms = total * frac;
    return {
      key: 'tick-' + index,
      left: (frac * 100).toFixed(2),
      text: ms > 0 ? formatDuration(ms) : '0',
      first: index === 0,
      last: index === 4
    };
  });
  return { hasData: true, items: items, ticks: ticks };
}

function deriveTiming(value, t) {
  t = identity(t);
  var stats = isObject(value.stats) ? value.stats : {};
  var counts = isObject(value.counts) ? value.counts : {};
  var timing = isObject(value.timing) ? value.timing : {};
  var wall = num(timing.wallMs);
  var v2 = timingHasV2(timing);
  var rows = [];
  var donutStyle = '';
  var totalMs = 0;
  if (v2) {
    var ttft = num(timing.ttftMs);
    var reasoning = num(timing.reasoningMs);
    var textMs = num(timing.textMs);
    var toolArg = num(timing.toolArgMs);
    var toolsMs = num(timing.toolsMs);
    var split = reasoning + textMs + toolArg > 0;
    var decodeMs = split ? reasoning + textMs + toolArg : num(stats.decodeMs);
    var slices = [{ key: 'wait', label: t('模型等待'), ms: ttft, count: num(timing.waitCount) }];
    if (split) {
      slices.push({ key: 'reasoning', label: t('模型思考'), ms: reasoning, count: num(timing.reasoningCount) });
      slices.push({ key: 'text', label: t('模型回复'), ms: textMs, count: num(timing.textCount) });
      slices.push({ key: 'toolarg', label: t('工具参数'), ms: toolArg, count: num(timing.toolArgCount) });
    } else {
      slices.push({ key: 'gen', label: t('模型生成'), ms: decodeMs, count: num(counts.answers) || num(stats.steps) });
    }
    slices.push({ key: 'tools', label: t('工具执行'), ms: toolsMs, count: num(timing.toolCount) });
    // 环窗口钳制：TTFT 吃 wall，生成窗口吃剩余，工具再吃剩余，残差为「其他开销」。
    var ttftRing = Math.min(ttft, wall);
    var genRing = Math.max(0, Math.min(decodeMs, wall - ttftRing));
    var used = ttftRing;
    var genEnd = ttftRing + genRing;
    var rings = [ttftRing];
    for (var i = 1; i < slices.length - 1; i += 1) {
      var take = Math.max(0, Math.min(slices[i].ms, genEnd - used));
      rings.push(take);
      used += take;
    }
    var toolRing = Math.max(0, Math.min(toolsMs, wall - ttftRing - genRing));
    var otherRing = Math.max(0, wall - ttftRing - genRing - toolRing);
    rings.push(toolRing, otherRing);
    var otherMs = wall > 0 ? otherRing : num(timing.otherMs);
    var all = slices.concat([{ key: 'other', label: t('其他开销'), ms: otherMs, count: 0 }]);
    totalMs = wall > 0 ? wall : rings.reduce(function (a, b) { return a + b; }, 0);
    rows = all.map(function (slice) {
      return timingSliceRow(slice.key, slice.label, slice.ms, slice.count, wall, t);
    });
    // 未发生的段隐藏，但「其他开销」恒保留（dsh-context statsTiming）。
    rows = rows.some(function (row) { return !row.dim; })
      ? rows.filter(function (row) { return !row.dim || row.key === 'other'; })
      : [];
    var ringTotal = rings.reduce(function (a, b) { return a + b; }, 0);
    var acc = 0, stops = [];
    rows.forEach(function (row, index) {
      var value = rings[index] || 0;
      if (value <= 0 || ringTotal <= 0) return;
      var start = (acc / ringTotal) * 100;
      var end = Math.min(100, ((acc + value) / ringTotal) * 100);
      stops.push('var(--ctx-t-' + row.key + ') ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
      acc += value;
    });
    donutStyle = stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '';
  } else {
    // v1 只有 stats（旧网关）：模型等待 / 模型回复 / 工具执行三段，分母为三段之和。
    var waitMs = num(stats.ttftMs), replyMs = num(stats.decodeMs), toolMs = num(stats.toolMs);
    var sum = waitMs + replyMs + toolMs;
    var seg = function (key, label, ms, count) {
      var duration = formatDuration(ms);
      var countText = count > 0 ? t('{n} 次', { n: formatCompact(count) }) : '';
      return {
        key: key, label: label, ms: ms,
        pctText: formatPercent(ms, sum),
        width: sum > 0 ? (ms / sum) * 100 : 0,
        durationText: duration,
        countText: countText,
        subText: ms > 0 ? duration + (countText ? ' · ' + countText : '') : countText,
        dim: ms <= 0
      };
    };
    rows = [
      seg('wait', t('模型等待'), waitMs, num(stats.ttftSteps)),
      seg('reply', t('模型回复'), replyMs, num(counts.answers) || num(stats.steps)),
      seg('tools', t('工具执行'), toolMs, num(counts.toolCalls))
    ];
    totalMs = sum;
    var ringSum = 0, acc2 = 0, stops2 = [];
    rows.forEach(function (row) { ringSum += num(row.ms); });
    rows.forEach(function (row) {
      if (row.ms <= 0 || ringSum <= 0) return;
      var start = (acc2 / ringSum) * 100;
      var end = Math.min(100, ((acc2 + row.ms) / ringSum) * 100);
      stops2.push('var(--ctx-t-' + row.key + ') ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
      acc2 += row.ms;
    });
    donutStyle = stops2.length ? 'background:conic-gradient(' + stops2.join(',') + ');' : '';
  }
  var speedMs = num(timing.speedMs);
  var timeline = deriveTimeline(value);
  return {
    activeText: wall > 0 ? formatDuration(wall) : '—',
    activeLabel: t('活跃时长'),
    scopeText: t('会话累计'),
    totalMs: totalMs,
    hasData: v2 ? rows.length > 0 && (wall > 0 || totalMs > 0) : totalMs > 0,
    v2: v2,
    rows: rows,
    donutStyle: donutStyle,
    hasSpeed: num(timing.speedTokens) > 0 && speedMs > 0,
    speedText: speedTextOf(speedMs > 0 ? num(timing.speedTokens) / (speedMs / 1000) : 0),
    emptyText: t('暂无耗时数据 · 对话开始后这里会显示时长分布'),
    timeline: timeline.items,
    timelineTicks: timeline.ticks,
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
    seq: finiteNumber(source.seq) && Number(source.seq) >= 0 ? Number(source.seq) : NaN,
    time: num(source.time),
    turn: num(source.turn),
    step: num(source.step),
    total: num(source.total),
    cacheRead: finiteNumber(source.cacheRead) ? num(source.cacheRead) : null,
    system: num(source.system),
    tools: num(source.tools),
    user: num(source.user),
    inject: num(source.inject),
    skill: num(source.skill),
    assistant: num(source.assistant),
    tool: num(source.tool),
    items: normalizedItems,
    prompt: finiteNumber(source.prompt) ? num(source.prompt) : null,
    output: finiteNumber(source.output) ? num(source.output) : null,
    // The duration curve's per-request active time; absent when the fold had no
    // step boundary to measure (undefined, not 0 — a 0 would draw a flat line).
    activeMs: finiteNumber(source.activeMs) ? num(source.activeMs) : undefined
  };
}

function deriveTrend(value, t, options) {
  t = identity(t);
  var opts = options || {};
  var requests = (Array.isArray(value.requests) ? value.requests : [])
    .map(normalizeRequest)
    .filter(function (request) { return Number.isFinite(request.seq); })
    .sort(function (a, b) { return a.seq - b.seq; });
  var totalCount = requests.length;
  // dsh-context defaults to step granularity; long histories switch to its
  // overview ribbon instead of silently changing the meaning of each bar.
  var groupBy = opts.groupBy === 'turn' ? 'turn' : 'step';
  var displayMode = opts.displayMode === 'delta' ? 'delta' : 'total';
  // The overview ribbon squashes the whole session into the pane width; it is
  // mutually exclusive with DNA and adaptive visible-window scaling.
  var overviewOn = opts.overview === true;
  var adaptiveOn = opts.adaptive === true && !overviewOn;
  var durationOn = opts.showDuration !== false;
  // dsh-context aggregateByTurn: a run of equal turns collapses to its LAST
  // record, tagged `stepCount`; `activeMs` is the run's SUM.
  var bars = requests;
  var aggregated = groupBy === 'turn';
  if (groupBy === 'turn') {
    var collapsed = [];
    var runSteps = 0;
    var runActiveMs = 0;
    var runHasActiveMs = false;
    requests.forEach(function (request) {
      var last = collapsed.length > 0 ? collapsed[collapsed.length - 1] : null;
      if (last !== null && (last.turn || 0) === (request.turn || 0)) {
        runSteps += 1;
        if (request.activeMs !== undefined) { runActiveMs += request.activeMs; runHasActiveMs = true; }
        // The LAST record stands for the run, tagged with the run's step count
        // and the SUM of its steps' active time (dsh-context aggregateByTurn).
        var merged = {};
        for (var key in request) merged[key] = request[key];
        merged.stepCount = runSteps;
        if (runHasActiveMs) merged.activeMs = runActiveMs;
        collapsed[collapsed.length - 1] = merged;
      } else {
        runSteps = 1;
        runActiveMs = request.activeMs || 0;
        runHasActiveMs = request.activeMs !== undefined;
        var first = {};
        for (var firstKey in request) first[firstKey] = request[firstKey];
        first.stepCount = 1;
        collapsed.push(first);
      }
    });
    bars = collapsed;
  }
  var maxTotal = 0;
  var maxUp = 0;
  var maxDown = 0;
  var maxActiveMs = 0;
  var rows = bars.map(function (request) {
    var total = request.total;
    var sum = TREND_KEYS.reduce(function (acc, key) { return acc + request[key]; }, 0);
    if (total <= 0) total = sum;
    if (total > maxTotal) maxTotal = total;
    if (request.activeMs !== undefined && request.activeMs > maxActiveMs) maxActiveMs = request.activeMs;
    return { request: request, total: total };
  });
  if (maxTotal <= 0) maxTotal = 1;
  rows.forEach(function (row, index) {
    var previous = index > 0 ? rows[index - 1].request : null;
    var positive = 0, negative = 0;
    TREND_KEYS.forEach(function (key) {
      var delta = previous ? row.request[key] - previous[key] : row.request[key];
      if (delta > 0) positive += delta;
      else negative -= delta;
    });
    row.positiveTotal = positive;
    row.negativeTotal = negative;
    if (positive > maxUp) maxUp = positive;
    if (negative > maxDown) maxDown = negative;
  });
  var visibleRange = isObject(opts.visibleRange) ? opts.visibleRange : null;
  if (adaptiveOn && visibleRange) {
    var from = Math.max(0, Math.floor(num(visibleRange.from)));
    var to = Math.min(rows.length - 1, Math.floor(num(visibleRange.to)));
    if (to >= from) {
      maxTotal = 0;
      maxUp = 0;
      maxDown = 0;
      maxActiveMs = 0;
      for (var visibleIndex = from; visibleIndex <= to; visibleIndex += 1) {
        var visibleRow = rows[visibleIndex];
        if (visibleRow.total > maxTotal) maxTotal = visibleRow.total;
        if (visibleRow.positiveTotal > maxUp) maxUp = visibleRow.positiveTotal;
        if (visibleRow.negativeTotal > maxDown) maxDown = visibleRow.negativeTotal;
        if (visibleRow.request.activeMs !== undefined && visibleRow.request.activeMs > maxActiveMs) {
          maxActiveMs = visibleRow.request.activeMs;
        }
      }
    }
  }
  if (maxActiveMs <= 0) maxActiveMs = 1;
  // dsh-context trendMaxima: the axis scale and the ribbon's px-per-token.
  var span = Math.max(1, maxUp + maxDown);
  var deltaScale = TREND_CHART_H / span;
  var upPx = Math.round(maxUp * deltaScale);
  var downPx = TREND_CHART_H - upPx;
  // A delta quarter mark yields when its label box would overlap the zero label.
  var q3Clear = Math.abs(92 - 13 - upPx) >= 22;
  var q1Clear = Math.abs(204 - 13 - upPx) >= 22;
  var events = (Array.isArray(value.events) ? value.events : []).filter(function (event) {
    return isObject(event) && (event.kind === 'compaction' || event.kind === 'prune');
  });
  // dsh-context attachMarkers: each boundary event attaches to the first
  // request logged at/after it, so the detail panel and the chart agree.
  var markers = {};
  events.forEach(function (event) {
    var seq = num(event.seq);
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].request.seq >= seq) {
        markers[i] = event;
        break;
      }
    }
  });
  // Turn strip groups: `span` counts the STEP columns the group covers, so the
  // strip blocks align with the bars in both granularities.
  var groups = [];
  rows.forEach(function (row) {
    var request = row.request;
    var turn = request.turn || 0;
    var grp = groups.length > 0 ? groups[groups.length - 1] : null;
    if (grp === null || grp.turn !== turn) {
      grp = { turn: turn, count: 0, span: 0 };
      groups.push(grp);
    }
    grp.count += 1;
    grp.span += 1;
  });
  var turnOffsets = [];
  var turnWidths = [];
  (function () {
    var x = 0;
    groups.forEach(function (grp) {
      var w = grp.span * TREND_BAR_PITCH - TREND_BAR_GAP;
      turnOffsets.push(x);
      turnWidths.push(w);
      x += w + TREND_BAR_GAP;
    });
  }());
  // Turn label auto-shrink: floor LABEL_FONT_MIN when the tightest adjacent
  // pair would collide (mirrors dsh-context's labelFont chain).
  var labelFont = '';
  (function () {
    var scale = 1;
    for (var i = 0; i + 1 < groups.length; i += 1) {
      var avail = (turnWidths[i] + turnWidths[i + 1]) / 2 + TREND_BAR_GAP;
      var need = (6.5 * String(groups[i].turn).length + 6.5 * String(groups[i + 1].turn).length) / 2 + 2;
      if (need > avail) scale = Math.min(scale, avail / need);
    }
    if (scale < 1) labelFont = Math.max(TREND_LABEL_FONT_MIN, Math.floor(TREND_LABEL_FONT * scale)) + 'rpx';
  }());
  var selectedSeq = finiteNumber(opts.selectedSeq) ? num(opts.selectedSeq) : null;
  var selectedIndex = -1;
  if (selectedSeq !== null) {
    for (var selectedAt = 0; selectedAt < rows.length; selectedAt += 1) {
      if (rows[selectedAt].request.seq === selectedSeq) { selectedIndex = selectedAt; break; }
    }
  }
  if (selectedIndex < 0 && rows.length) selectedIndex = rows.length - 1;
  if (selectedIndex >= 0) selectedSeq = rows[selectedIndex].request.seq;
  var riseFrom = Math.max(0, rows.length - TREND_RISE_CAP);
  var windowed = rows.length > TREND_WINDOW_MIN;
  // DNA and the overview ribbon are mutually exclusive faces of the same chart
  // (dsh-context: the overview is "exclusive with DNA mode and Adaptive").
  var dnaOn = opts.dna === true && displayMode !== 'delta' && !overviewOn && !adaptiveOn;
  var result = rows.map(function (row, index) {
    var request = row.request;
    var marker = markers[index];
    // Step flags: a pole every TREND_STEP_FLAG_EVERY columns, step granularity only.
    var flag = groupBy === 'step' && (index + 1) % TREND_STEP_FLAG_EVERY === 0 ? index + 1 : null;
    var segments = [];
    var decreaseSegments = [];
    TREND_KEYS.forEach(function (key) {
      var amount = request[key];
      if (displayMode === 'delta' && index > 0) amount -= rows[index - 1].request[key];
      if (amount > 0) segments.push({ key: key, px: Math.max(1, Math.round(amount * deltaScale)) });
      else if (displayMode === 'delta' && amount < 0) decreaseSegments.push({ key: key, px: Math.max(1, Math.round(-amount * deltaScale)) });
    });
    var growth = row.positiveTotal;
    var decrease = row.negativeTotal;
    // px (not %) heights: the stack is content-driven, so % heights would
    // collapse against an indefinite base (dsh-context .lc-bar-stack note).
    var stackSegments = segments.map(function (seg) {
      return { key: seg.key, px: displayMode === 'delta' ? seg.px : Math.max(1, Math.round(request[seg.key] / maxTotal * TREND_CHART_H)) };
    });
    // DNA face: one band per item the model read, in reading order, on the same
    // total/maxTotal scale as the segmented stack.
    var dnaBands = null;
    var dnaTotal = 0;
    if (dnaOn) {
      var rawBands = dnaBandsAt(value, request.seq);
      dnaTotal = rawBands.length;
      dnaBands = slimDnaBands(rawBands, MAX_TREND_DNA_BANDS).map(function (band) {
        return { key: band.key, px: Math.max(1, Math.round(band.tokens / maxTotal * TREND_CHART_H)), tokens: band.tokens };
      });
    }
    return {
      key: 'bar-' + request.seq,
      seq: request.seq,
      turn: request.turn,
      seqText: '#' + request.seq,
      total: row.total,
      totalText: formatCompact(row.total),
      hasData: row.total > 0,
      segments: stackSegments,
      decreaseSegments: decreaseSegments,
      dna: dnaBands,
      dnaCount: dnaBands === null ? 0 : dnaTotal,
      // Delta geometry as primitives: zero-line offsets in rpx, one scale for both arms.
      upPx: upPx,
      downPx: downPx,
      deltaScale: deltaScale,
      growth: growth,
      decrease: decrease,
      growthText: (growth > 0 ? '+' : '') + formatCompact(growth),
      decreaseText: decrease > 0 ? '−' + formatCompact(decrease) : '',
      marker: marker ? 'event' : '',
      markerTitle: marker ? eventLabelOf(marker) : '',
      markerLabel: marker ? eventLabelOf(marker) : '',
      markerTimeText: marker && finiteNumber(marker.time) ? formatTime(num(marker.time)) : '',
      flag: flag,
      rise: index >= riseFrom,
      selected: index === selectedIndex,
      inTurn: opts.activeTurn !== undefined && opts.activeTurn !== null && (request.turn || 0) === opts.activeTurn,
      dimmed: opts.activeTurn !== undefined && opts.activeTurn !== null && (request.turn || 0) !== opts.activeTurn
    };
  });
  // Axis ticks: total mode reads maxTotal, delta mode reads the signed span.
  var axis = displayMode === 'delta'
    ? [
      { key: 'top', top: 13, text: fmtSigned(maxUp) },
      { key: 'q3', top: 41, text: q3Clear ? fmtSigned(Math.round(maxUp - span / 4)) : '' },
      { key: 'mid', top: 69, text: '0' },
      { key: 'q1', top: 97, text: q1Clear ? fmtSigned(Math.round(maxUp - 3 * span / 4)) : '' },
      { key: 'bot', top: 125, text: fmtSigned(-maxDown) }
    ]
    : [
      { key: 'top', top: 13, text: formatCompact(maxTotal) },
      { key: 'q3', top: 41, text: formatCompact(Math.round(maxTotal * 3 / 4)) },
      { key: 'mid', top: 69, text: formatCompact(Math.round(maxTotal / 2)) },
      { key: 'q1', top: 97, text: formatCompact(Math.round(maxTotal / 4)) },
      { key: 'bot', top: 125, text: '0' }
    ];
  // Duration curve geometry: one polyline over the bar area, y scaled to maxActiveMs.
  // Every y is clamped into the plot: a stale maxActiveMs or a hostile record must
  // not push the curve outside the module. x 落在柱心（与实时探针竖线同一坐标）。
  var durationLine = durationOn
    ? durationLineOf(rows.map(function (row, index) {
      return { x: index * TREND_BAR_PITCH + TREND_BAR_W / 2 + TREND_BAR_GAP, ms: row.request.activeMs };
    }), maxActiveMs, 'd')
    : { segments: [], dots: [] };
  var turnStrip = groups.map(function (grp, gi) {
    return {
      key: 'turn-' + gi,
      turn: grp.turn,
      turnText: String(grp.turn),
      width: turnWidths[gi],
      // Overview stretches the strip to the pane width: each block takes the
      // share of records it covers, so it stays aligned with the ribbon.
      flex: grp.span,
      left: turnOffsets[gi],
      zebra: gi % 2 === 0 ? 'even' : 'odd',
      on: opts.activeTurn !== undefined && opts.activeTurn !== null && opts.activeTurn === grp.turn,
      dimmed: opts.activeTurn !== undefined && opts.activeTurn !== null && opts.activeTurn !== grp.turn
    };
  });
  // Right-hand duration axis (dsh-context .lc-axis-r), shown only with the curve.
  var durationAxis = [
    { key: 'top', top: 13, text: formatDuration(maxActiveMs) },
    { key: 'q3', top: 41, text: formatDuration(Math.round(maxActiveMs * 3 / 4)) },
    { key: 'mid', top: 69, text: formatDuration(Math.round(maxActiveMs / 2)) },
    { key: 'q1', top: 97, text: formatDuration(Math.round(maxActiveMs / 4)) },
    { key: 'bot', top: 125, text: '0' }
  ];
  // Overview ribbon geometry: x in record units (stretched edge to edge), y in px.
  // 总览把整段会话拉伸到可视宽：折线 x 由记录序号中心按可视宽（rpx）换算，
  // 页面量不到时退回 375pt 机的解析值，量到后重建即与列心对齐。
  var paneWidth = Number.isFinite(opts.paneWidth) && opts.paneWidth > 0
    ? opts.paneWidth : OVERVIEW_PANE_FALLBACK_RPX;
  var ribbonPoints = overviewOn && durationOn
    ? ribbonDurationPointsOf(rows, MAX_OVERVIEW_COLUMNS).map(function (point) {
      return { x: point.x / Math.max(1, rows.length) * paneWidth, ms: point.ms };
    })
    : [];
  var ribbonDuration = durationLineOf(ribbonPoints, maxActiveMs, 'r');
  var ribbon = {
    count: rows.length,
    width: rows.length,
    height: TREND_CHART_H,
    columns: overviewOn ? ribbonColumnsOf(rows, maxTotal, MAX_OVERVIEW_COLUMNS) : [],
    durationSegments: ribbonDuration.segments,
    durationDots: ribbonDuration.dots,
    // Quartile and full-span flags, as percentages of the stretched width.
    flags: overviewOn ? [
      { key: 'q1', left: (rows.length * 0.25 / Math.max(1, rows.length)) * 100, text: formatCompact(Math.round(rows.length / 4)) },
      { key: 'mid', left: (rows.length * 0.5 / Math.max(1, rows.length)) * 100, text: formatCompact(Math.round(rows.length / 2)) },
      { key: 'q3', left: (rows.length * 0.75 / Math.max(1, rows.length)) * 100, text: formatCompact(Math.round(rows.length * 0.75)) },
      { key: 'end', left: 100, text: formatCompact(rows.length) }
    ] : [],
    // The pinned record's cursor, as a percentage so it needs no px math.
    cursorLeft: selectedIndex >= 0 && rows.length
      ? ((selectedIndex + 0.5) / rows.length) * 100
      : -1,
    hoverLeft: -1,
    cursorSeq: selectedIndex >= 0 ? rows[selectedIndex].request.seq : null
  };
  var trackWidth = rows.length ? (rows.length * TREND_BAR_PITCH - TREND_BAR_GAP) : 0;
  // .ctx-trend-chart 用 box-sizing: border-box + 左右各 4rpx padding，
  // 所以外宽必须是轨道宽 + 两侧 padding，否则内容溢出会被裁剪切到柱子。
  var chartWidth = trackWidth + 2 * TREND_BAR_GAP;
  // The right-hand duration axis rides on the curve: both need readable activeMs.
  var hasDurationData = durationOn && rows.some(function (row) { return row.request.activeMs !== undefined; });
  return {
    empty: result.length === 0,
    count: result.length,
    totalCount: totalCount,
    aggregated: aggregated,
    groupBy: groupBy,
    displayMode: displayMode,
    selectedSeq: selectedSeq,
    // 实时拖动探针：页面触摸时回写这几个字段（-1/null = 无探针），面板重建时
    // 由 opts 原样带回，运行中 2.5s 自动刷新不会把竖线和指标卡闪掉。
    // hoverSeq 命中的柱子高亮；hoverX（rpx，柱模式）与 hoverLeft（%，总览模式）
    // 是竖线位置；tipLeft（px）是浮动指标卡在可视区内的钳制位置。
    hoverSeq: opts.hoverSeq == null ? null : opts.hoverSeq,
    hoverX: Number.isFinite(opts.hoverX) ? opts.hoverX : -1,
    hoverLeft: Number.isFinite(opts.hoverLeft) ? opts.hoverLeft : -1,
    tipLeft: Number.isFinite(opts.tipLeft) ? opts.tipLeft : -1,
    maxTotalText: formatCompact(maxTotal === 1 && rows.length === 0 ? 0 : maxTotal),
    maxTotal: maxTotal,
    maxActiveMs: maxActiveMs,
    maxActiveMsText: formatDuration(maxActiveMs),
    hasDuration: hasDurationData,
    bars: result,
    // Delta zero-line geometry (rpx): the arms hang off these in delta mode.
    upPx: upPx,
    downPx: downPx,
    axis: axis,
    grid: [
      { key: 'top', top: 0 },
      { key: 'q3', top: 56, show: displayMode === 'total' || q3Clear },
      { key: 'q1', top: 168, show: displayMode === 'total' || q1Clear },
      { key: 'mid', top: 112, show: displayMode === 'total' },
      { key: 'zero', top: TREND_CHART_H, show: true }
    ],
    turnStrip: turnStrip,
    turnStripWidth: turnStrip.length ? (turnOffsets[turnOffsets.length - 1] + turnWidths[turnWidths.length - 1]) : 0,
    labelFont: labelFont,
    durationAxis: durationAxis,
    hasDurationAxis: hasDurationData,
    // 折线的原生线段（halo + core 两层）与孤立点；不再用内联 SVG。
    durationSegments: durationLine.segments,
    durationDots: durationLine.dots,
    paneWidth: paneWidth,
    dna: dnaOn,
    adaptive: adaptiveOn,
    showDuration: durationOn,
    overview: overviewOn,
    ribbon: ribbon,
    windowed: windowed,
    trackWidth: trackWidth,
    chartWidth: chartWidth
  };
}

function fmtSigned(v) {
  if (v > 0) return '+' + formatCompact(v);
  if (v < 0) return '−' + formatCompact(-v);
  return '0';
}

/**
 * DNA bands for one request: every surface item the model actually read, in
 * reading order, each as its own slice (dsh-context `dnaAt`). Steps older than
 * a compaction are reconstructed from the removed-message archive.
 */
function dnaBandsAt(value, seq, includeZero) {
  var nodes = [];
  var surface = Array.isArray(value.surface) ? value.surface : [];
  surface.forEach(function (node) {
    if (!isObject(node) || !finiteNumber(node.seq)) return;
    if (num(node.seq) > seq) return;
    nodes.push(node);
  });
  var archive = Array.isArray(value.archive) ? value.archive : [];
  archive.forEach(function (node) {
    if (!isObject(node) || !finiteNumber(node.seq)) return;
    if (num(node.seq) > seq) return;
    // Still live at this request: removed later, so the model did read it.
    if (!finiteNumber(node.gone) || num(node.gone) <= seq) return;
    nodes.push(node);
  });
  nodes.sort(function (a, b) { return num(a.seq) - num(b.seq); });
  var bands = [];
  nodes.forEach(function (node) {
    var tokens = num(node.tokens);
    if (tokens < 0 || (tokens === 0 && includeZero !== true)) return;
    var key = text(node.cat);
    if (CATEGORY_KEYS.indexOf(key) < 0) return;
    bands.push({ key: key, tokens: tokens, seq: num(node.seq), node: node });
  });
  return bands;
}

/** Merge adjacent DNA slices down to `max` slices so a 200-bar chart stays under the setData cap. */
function slimDnaBands(bands, max) {
  if (bands.length <= max) return bands;
  var out = [];
  var size = bands.length / max;
  for (var i = 0; i < max; i += 1) {
    var start = Math.floor(i * size);
    var end = Math.max(start + 1, Math.floor((i + 1) * size));
    if (end > bands.length) end = bands.length;
    if (start >= end) continue;
    var tokens = 0;
    var best = bands[start];
    for (var j = start; j < end; j += 1) {
      tokens += bands[j].tokens;
      if (bands[j].tokens > best.tokens) best = bands[j];
    }
    out.push({ key: best.key, seq: best.seq, tokens: tokens });
  }
  return out;
}

/** Overview ribbon as CSS columns: WXML has no inline <svg>, so sample the
 *  session into a bounded number of stacked columns that read as one ribbon. */
function ribbonColumnsOf(rows, maxTotal, maxColumns) {
  var n = rows.length;
  if (!n) return [];
  var count = Math.min(n, maxColumns);
  var size = n / count;
  var columns = [];
  for (var c = 0; c < count; c += 1) {
    var start = Math.floor(c * size);
    var end = Math.min(n, Math.max(start + 1, Math.floor((c + 1) * size)));
    var totals = {};
    var k;
    for (k = 0; k < TREND_KEYS.length; k += 1) totals[TREND_KEYS[k]] = 0;
    for (var i = start; i < end; i += 1) {
      var request = rows[i].request;
      for (k = 0; k < TREND_KEYS.length; k += 1) totals[TREND_KEYS[k]] += num(request[TREND_KEYS[k]]);
    }
    var span = Math.max(1, end - start);
    var segments = [];
    for (k = 0; k < TREND_KEYS.length; k += 1) {
      var key = TREND_KEYS[k];
      var value = totals[key] / span;
      if (value > 0) segments.push({ key: key, px: Math.max(1, Math.round(value / maxTotal * TREND_CHART_H)) });
    }
    columns.push({ key: 'col-' + c, segments: segments });
  }
  return columns;
}

/** Sample the duration curve to the same bounded columns as the overview ribbon.
 *  x 用记录序号中心（与 ribbonColumnsOf 的列心对齐），ms 取桶内最大值；
 *  y 与线段几何由 durationLineOf 统一算。 */
function ribbonDurationPointsOf(rows, maxColumns) {
  var count = Math.min(rows.length, maxColumns);
  if (!count) return [];
  var size = rows.length / count;
  var points = [];
  for (var c = 0; c < count; c += 1) {
    var start = Math.floor(c * size);
    var end = Math.min(rows.length, Math.max(start + 1, Math.floor((c + 1) * size)));
    var activeMs = undefined;
    for (var i = start; i < end; i += 1) {
      var value = rows[i].request.activeMs;
      if (value !== undefined && (activeMs === undefined || value > activeMs)) activeMs = value;
    }
    points.push({ x: (start + end) / 2, ms: activeMs });
  }
  return points;
}

function round1(value) { return Math.round(value * 10) / 10; }

/** 折线某点的绘图区 y（rpx，相对绘图区顶）；钳在区内，过期/异常 scale 不会画出模块。 */
function durationYOf(ms, scale) {
  var y = TREND_CHART_H - ms * scale;
  return Math.max(0, Math.min(TREND_CHART_H, y));
}

/** 一段旋转细条的 inline style：原点在段首（transform-origin: 0 50%），圆头收口。 */
function durationSegmentStyle(x, y, length, angle, height) {
  return 'left:' + round1(x) + 'rpx;'
    + 'top:' + round1(TREND_TOP_PAD + y - height / 2) + 'rpx;'
    + 'width:' + round1(length) + 'rpx;'
    + 'height:' + height + 'rpx;'
    + 'transform:rotate(' + Math.round(angle * 100) / 100 + 'deg);'
    + 'transform-origin:0 50%;';
}

/**
 * 耗时折线的原生线段几何：points 里 ms 缺失即断线；连续段每相邻两点拼一根
 * halo + 一根 core 细条，孤立单点画圆点（dsh-context：单点 polyline 不可见）。
 * x 由调用方给出（柱模式是柱心 rpx；总览是记录序号中心，由调用方换算成 rpx）。
 */
function durationLineOf(points, maxActiveMs, prefix) {
  var result = { segments: [], dots: [] };
  if (!Array.isArray(points) || points.length === 0) return result;
  var scale = TREND_CHART_H / Math.max(1, maxActiveMs);
  var run = [];
  var flush = function () {
    var i;
    for (i = 1; i < run.length; i += 1) {
      var a = run[i - 1];
      var b = run[i];
      var ya = durationYOf(a.ms, scale);
      var yb = durationYOf(b.ms, scale);
      var dx = b.x - a.x;
      var dy = yb - ya;
      var length = Math.sqrt(dx * dx + dy * dy);
      if (!(length > 0)) continue;
      var angle = Math.atan2(dy, dx) * 180 / Math.PI;
      result.segments.push({ key: prefix + 'h' + i, halo: true, style: durationSegmentStyle(a.x, ya, length, angle, DURATION_HALO_W) });
      result.segments.push({ key: prefix + 'c' + i, style: durationSegmentStyle(a.x, ya, length, angle, DURATION_CORE_W) });
    }
    if (run.length === 1) {
      var only = run[0];
      var y = durationYOf(only.ms, scale);
      result.dots.push({
        key: prefix + 'dh', halo: true,
        style: 'left:' + round1(only.x - DURATION_DOT_W / 2) + 'rpx;top:' + round1(TREND_TOP_PAD + y - DURATION_DOT_W / 2)
          + 'rpx;width:' + DURATION_DOT_W + 'rpx;height:' + DURATION_DOT_W + 'rpx;'
      });
      result.dots.push({
        key: prefix + 'dc',
        style: 'left:' + round1(only.x - DURATION_DOT_CORE / 2) + 'rpx;top:' + round1(TREND_TOP_PAD + y - DURATION_DOT_CORE / 2)
          + 'rpx;width:' + DURATION_DOT_CORE + 'rpx;height:' + DURATION_DOT_CORE + 'rpx;'
      });
    }
    run = [];
  };
  for (var i = 0; i < points.length; i += 1) {
    var point = points[i];
    var ms = point && point.ms;
    if (ms === undefined || ms === null || !Number.isFinite(Number(ms))) { flush(); continue; }
    run.push({ x: Number(point.x), ms: Number(ms) });
  }
  flush();
  return result;
}

function eventLabelOf(event) {
  if (!isObject(event)) return '';
  var kind = text(event.kind);
  var at = num(event.time);
  var when = at > 0 ? formatTime(at) + ' — ' : '';
  return when + (kind === 'compaction' ? '压缩' : kind === 'prune' ? '剪枝' : kind);
}

/** Step brief 的单行：最多 3 枚 chip + 「+N」（dsh-context brief.ts / requestDetail.tsx）。 */
function briefRowOf(key, tag, nodes, t, emptyText) {
  var list = Array.isArray(nodes) ? nodes.filter(isObject) : [];
  var chips = list.slice(0, 3).map(function (node, index) {
    var cat = text(node.cat);
    var label = text(node.text) || text(node.name) || text(node.tool)
      || (Array.isArray(node.calls) ? node.calls.join(', ') : '') || t(CATEGORY_LABELS[cat] || '节点');
    if (label.length > 60) label = label.slice(0, 60) + '…';
    return {
      key: key + '-chip-' + index,
      seq: num(node.seq),
      cat: cat,
      label: label,
      error: node.err === true
    };
  });
  return {
    key: key,
    tag: tag,
    chips: chips,
    more: Math.max(0, list.length - chips.length),
    empty: chips.length === 0,
    emptyText: chips.length === 0 ? (emptyText || '') : '',
    locateSeq: chips.length ? chips[0].seq : null,
    locateCat: chips.length ? chips[0].cat : ''
  };
}

function deriveTrendSelection(value, seq, t, options) {
  t = identity(t);
  var opts = options || {};
  var requests = sortedRequests(value);
  var selectedIndex = requests.length - 1;
  if (finiteNumber(seq)) {
    for (var i = 0; i < requests.length; i += 1) {
      if (requests[i].seq === num(seq)) { selectedIndex = i; break; }
    }
  }
  if (selectedIndex < 0) return { hasData: false, rows: [], requestLabel: '', actualPromptText: '—', outputText: '—', deltaText: '—', brief: [] };
  var request = requests[selectedIndex];
  var previous = selectedIndex > 0 ? requests[selectedIndex - 1] : null;
  var estimated = request.total > 0 ? request.total : TREND_KEYS.reduce(function (sum, key) { return sum + request[key]; }, 0);
  var previousTotal = previous ? (previous.total || TREND_KEYS.reduce(function (sum, key) { return sum + previous[key]; }, 0)) : null;
  var difference = previousTotal === null ? null : estimated - previousTotal;
  // 压缩/剪枝钉柱信息（✂）：最近一条落在本请求之前的压缩事件。
  var marker = null;
  (Array.isArray(value.events) ? value.events : []).forEach(function (event) {
    if (!isObject(event)) return;
    if (event.kind !== 'compaction' && event.kind !== 'prune') return;
    if (finiteNumber(event.seq) && num(event.seq) > request.seq) return;
    if (marker !== null && num(marker.seq) >= num(event.seq)) return;
    marker = event;
  });
  var markerTimeText = marker !== null && finiteNumber(marker.time) ? formatTime(num(marker.time)) : '';
  var markerText = '';
  if (marker !== null) {
    var kind = text(marker.kind) === 'prune' ? t('剪枝') : t('压缩');
    var reclaimed = num(marker.tokens);
    markerText = kind
      + (reclaimed > 0 ? ' · ' + t('回收') + ' ' + formatCompact(reclaimed) : '')
      + (finiteNumber(marker.count) && num(marker.count) > 0 ? ' · ' + formatCompact(num(marker.count)) + ' ' + t('条') : '');
  }
  // 本轮末步标记：当前请求之后没有同 turn 的请求。
  var isLastStep = true;
  for (var ri = selectedIndex + 1; ri < requests.length; ri += 1) {
    if (num(requests[ri].turn) === num(request.turn)) { isLastStep = false; break; }
  }
  if (num(request.turn) <= 0) isLastStep = false;
  var tags = [];
  if (isLastStep) tags.push({ key: 'last', label: t('末步') });
  if (opts.delta === true) tags.push({ key: 'delta', label: t('增量') });

  // Step brief：surface 节点预览（archive 里的旧条目也能回放）。
  var surface = (Array.isArray(value.surface) ? value.surface : []).concat(
    Array.isArray(value.archive) ? value.archive.filter(function (node) {
      return isObject(node) && finiteNumber(node.gone) && num(node.gone) > num(request.seq);
    }) : []
  ).filter(function (node) {
    return isObject(node) && finiteNumber(node.seq) && num(node.seq) <= num(request.seq);
  }).sort(function (a, b) { return num(a.seq) - num(b.seq); });
  // 本轮第一条请求的 seq：User 行取它之前的最后一条用户消息。
  var turnFirstSeq = num(request.seq);
  requests.forEach(function (item) {
    if (num(item.turn) === num(request.turn) && num(item.seq) < turnFirstSeq) turnFirstSeq = num(item.seq);
  });
  var prevTurnFirstSeq = -1;
  requests.forEach(function (item) {
    if (num(item.turn) === num(request.turn) - 1 && num(item.seq) > prevTurnFirstSeq) prevTurnFirstSeq = num(item.seq);
  });
  var userNodes = surface.filter(function (node) {
    return node.cat === 'user' && num(node.seq) < turnFirstSeq && num(node.seq) > prevTurnFirstSeq;
  });
  var inputNodes = surface.filter(function (node) {
    var afterPrev = previous === null ? true : num(node.seq) > num(previous.seq);
    return afterPrev && num(node.seq) < num(request.seq) && !(node.cat === 'user' && num(node.seq) < turnFirstSeq);
  });
  var replyNodes = surface.filter(function (node) { return node.cat === 'assistant' && num(node.seq) === num(request.seq); });
  var brief = [
    briefRowOf('turn', t('本轮'), userNodes.slice(-1), t),
    briefRowOf('input', t('输入'), inputNodes, t, t('（无新增）')),
    briefRowOf('reply', t('回复'), replyNodes, t)
  ].filter(function (row, index) { return index !== 2 || !row.empty; });
  var rows = TREND_KEYS.map(function (key) {
    var delta = previous ? request[key] - previous[key] : null;
    return {
      key: key,
      label: t(CATEGORY_LABELS[key] || key),
      valueText: '≈' + formatCompact(request[key]),
      itemsText: request.items && finiteNumber(request.items[key]) ? formatCompact(request.items[key]) : '—',
      pctText: formatPercent(request[key], estimated),
      deltaText: delta === null ? '—' : (delta > 0 ? '+' : delta < 0 ? '−' : '') + formatCompact(Math.abs(delta)),
      deltaClass: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    };
  });
  var cacheText = '';
  if (request.cacheRead !== null && request.prompt !== null && num(request.prompt) > 0) {
    cacheText = Math.round((num(request.cacheRead) / num(request.prompt)) * 100) + '%';
  }
  return {
    hasData: true,
    seq: request.seq,
    turnText: request.turn > 0 ? t('第 {n} 轮', { n: formatCompact(request.turn) }) : '',
    stepText: request.step > 0 ? t('第 {n} 步', { n: formatCompact(request.step) }) : '',
    timeText: formatTime(request.time),
    requestLabel: t('请求 #{n}', { n: formatCompact(request.seq) }),
    estimatedText: estimated > 0 ? '≈' + formatCompact(estimated) : '—',
    activeMs: request.activeMs === undefined ? null : request.activeMs,
    durationText: request.activeMs === undefined ? '' : formatDuration(request.activeMs),
    durationLabel: t('耗时'),
    actualPromptText: request.prompt === null ? '—' : formatCompact(request.prompt),
    outputText: request.output === null ? '—' : formatCompact(request.output),
    cacheText: cacheText,
    deltaText: difference === null ? '—' : (difference > 0 ? '+' : difference < 0 ? '−' : '') + formatCompact(Math.abs(difference)),
    deltaClass: difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat',
    markerText: markerText,
    markerTimeText: markerTimeText,
    tags: tags,
    brief: brief,
    estimatedLabel: t('估算合计'),
    promptLabel: t('实际 prompt'),
    outputLabel: t('输出'),
    cacheLabel: t('缓存'),
    deltaLabel: t('较上次'),
    rows: rows
  };
}

// ---------- 上下文浏览器（v2：逐请求查看 7 类组成） ----------

function sortedRequests(value) { return (Array.isArray(value.requests) ? value.requests : []).map(normalizeRequest) .filter(function (r) { return Number.isFinite(r.seq); }).sort(function (a, b) { return a.seq - b.seq; }); }

function currentRequestOf(value) { var cur = isObject(value.current) ? value.current : {}; var request = { seq: null, time: 0, turn: 0, items: null, prompt: null, output: null }; var sum = 0; CATEGORY_KEYS.forEach(function (k) { request[k] = num(cur[k]); sum += request[k]; }); request.total = num(cur.total) || sum; return request; }

function categoryDelta(current, previous, key) { if (!previous) return { text: '—', className: '' }; var diff = num(current) - num(previous.request[key]); if (diff === 0) return { text: '0', className: 'flat' }; return diff > 0 ? { text: '+' + formatCompact(diff), className: 'up' } : { text: '−' + formatCompact(-diff), className: 'down' }; }

function browserNodes(value, request, previous, isCurrent) {
  var selectedSeq = isCurrent ? Infinity : num(request.seq);
  var nodes = [];
  var surface = Array.isArray(value.surface) ? value.surface : [];
  var archive = Array.isArray(value.archive) ? value.archive : [];
  surface.forEach(function (node) {
    if (!isObject(node) || !finiteNumber(node.seq) || num(node.seq) > selectedSeq) return;
    nodes.push(node);
  });
  if (!isCurrent) archive.forEach(function (node) {
    if (!isObject(node) || !finiteNumber(node.seq) || num(node.seq) > selectedSeq) return;
    if (!finiteNumber(node.gone) || num(node.gone) <= selectedSeq) return;
    nodes.push(node);
  });
  nodes.sort(function (a, b) { return num(a.seq) - num(b.seq); });
  var system = null;
  nodes.forEach(function (node) { if (node.cat === 'system' && num(node.tokens) > 0) system = node; });
  var header = null;
  (Array.isArray(value.headerEpochs) ? value.headerEpochs : []).forEach(function (epoch) {
    if (isObject(epoch) && finiteNumber(epoch.seq) && num(epoch.seq) <= selectedSeq) header = epoch;
  });
  var result = {};
  CATEGORY_KEYS.forEach(function (key) {
    result[key] = nodes.filter(function (node) { return node.cat === key; });
  });
  result.system = system ? [system] : [];
  result.tools = [];
  if (header && Array.isArray(header.tools)) {
    var metaList = Array.isArray(header.meta) ? header.meta : [];
    result.tools = header.tools.map(function (tool, index) {
      var name = text(tool && tool.name) || 'Tool ' + (index + 1);
      var meta = null;
      for (var mi = 0; mi < metaList.length; mi += 1) {
        if (isObject(metaList[mi]) && text(metaList[mi].name) === name) { meta = metaList[mi]; break; }
      }
      return {
        seq: num(header.seq),
        cat: 'tools',
        tokens: meta && finiteNumber(meta.tokens) ? num(meta.tokens) : 0,
        name: name,
        description: text(meta && meta.description) || text(tool && tool.description),
        params: meta && Array.isArray(meta.params) ? meta.params : [],
        source: text(meta && meta.source),
        metaOnly: meta === null
      };
    });
  }
  return result;
}

function browserNodeRows(nodes, t) {
  var list = Array.isArray(nodes) ? nodes : [];
  var isTools = list.length > 0 && list[0].cat === 'tools';
  var clipped = isTools ? list.slice(0, 20) : list.slice(-20).reverse();
  return clipped.map(function (node, index) {
    var label = text(node.name) || text(node.tool) || (Array.isArray(node.calls) && node.calls.length ? node.calls.join(', ') : '');
    if (!label) label = '#' + formatCompact(node.seq);
    return {
      key: 'node-' + node.seq + '-' + index,
      seq: num(node.seq),
      label: label,
      tokenText: num(node.tokens) > 0 ? '≈' + formatCompact(node.tokens) : '',
      timeText: finiteNumber(node.time) ? formatTime(node.time) : '',
      error: node.err === true
    };
  });
}

// ---------- 上下文浏览器（dsh-context browser.tsx / browserRows.ts） ----------

function signedCompact(delta) {
  var v = Number(delta);
  if (!Number.isFinite(v) || v === 0) return '';
  return (v > 0 ? '+' : '−') + formatCompact(Math.abs(v));
}

/** 请求的类别条目数：items 优先，system/tools 有专门口径，消息类退回节点数。 */
function categoryCountOf(request, key, nodes) {
  var items = isObject(request.items) ? request.items : null;
  if (items && finiteNumber(items[key])) return num(items[key]);
  if (key === 'system') return num(request.system) > 0 ? 1 : 0;
  if (key === 'tools') return items && finiteNumber(items.tools) ? num(items.tools) : 0;
  return Array.isArray(nodes) ? nodes.length : 0;
}

/** 节点时间戳→T/S：assistant 节点 seq 与请求记录同源；其余节点取其后第一条请求。 */
function nodeStamp(node, requests, seqToRequest) {
  var seq = num(node.seq);
  if (node.cat === 'assistant' && seqToRequest[seq]) {
    var own = seqToRequest[seq];
    return 'T' + (own.turn || 0) + ' S' + (own.step || 0);
  }
  for (var i = 0; i < requests.length; i += 1) {
    if (num(requests[i].seq) >= seq) return 'T' + (requests[i].turn || 0) + ' S' + (requests[i].step || 0);
  }
  return '';
}

function browserNodeRow(node, index, requests, seqToRequest, t, optsToolName) {
  var key = num(node.seq) + '-' + index;
  var cat = text(node.cat);
  var chips = [];
  var preview = text(node.text);
  var error = node.err === true;
  if (cat === 'tool') {
    chips.push(text(node.tool) || '?');
    if (!preview) preview = t('工具结果');
  } else if (cat === 'tools') {
    // 工具定义行：工具名作标签，描述作预览（dsh-context tool row）。
    if (text(node.name)) chips.push(text(node.name));
    preview = text(node.description) || '';
  } else if (cat === 'skill') {
    chips.push(t('技能') + ' · ' + (text(node.name) || text(node.source) || '?'));
  } else if (cat === 'assistant') {
    var calls = Array.isArray(node.calls) ? node.calls.filter(function (name) { return text(name) !== ''; }) : [];
    calls.slice(0, 3).forEach(function (name) { chips.push(name); });
    if (!preview) preview = calls.length ? '' : t('(空回复)');
  } else if (cat === 'user') {
    if (num(node.imgs) > 0) chips.push(t('附件') + ' ×' + formatCompact(node.imgs));
  } else if (cat === 'inject') {
    chips.push(t(INJECTION_FORM_LABELS[text(node.form)] || '上下文注入'));
  }
  if (!preview) preview = text(node.name) || (chips.length ? '' : '#' + formatCompact(node.seq));
  return {
    key: 'node-' + key,
    seq: num(node.seq),
    cat: cat,
    chips: chips,
    preview: preview,
    error: error,
    stamp: nodeStamp(node, requests, seqToRequest),
    timeText: finiteNumber(node.time) ? formatTime(node.time) : '',
    tokenText: num(node.tokens) > 0 ? '≈' + formatCompact(node.tokens) : '',
    description: text(node.description),
    source: text(node.source),
    metaOnly: node.metaOnly === true,
    expanded: optsToolName !== '' && cat === 'tools' && text(node.name) === optsToolName,
    params: (Array.isArray(node.params) ? node.params : []).map(function (param) {
      return {
        name: text(param.name),
        type: text(param.type),
        required: param.required === true,
        description: text(param.description)
      };
    })
  };
}

/** 请求下拉（最近 30 条 +「当前（下一次请求）」）、上/下一步、7 类折叠行。 */
function deriveBrowser(value, t, options) {
  t = identity(t);
  var opts = options || {};
  var expanded = Array.isArray(opts.expanded) ? opts.expanded : [];
  var query = text(opts.query).toLocaleLowerCase();
  var kind = ['think', 'tools', 'answer'].indexOf(opts.kind) >= 0 ? opts.kind : '';
  var baseMode = opts.base === 'turn' ? 'turn' : 'step';
  var requests = sortedRequests(value).slice(-MAX_BROWSER_REQUESTS);
  var seqToRequest = {};
  requests.forEach(function (r) { seqToRequest[num(r.seq)] = r; });
  var entries = requests.map(function (r) {
    return { key: 'req-' + r.seq, seq: r.seq, isCurrent: false, request: r, label: t('请求 #{n}', { n: formatCompact(r.seq) }) };
  });
  entries.push({ key: 'req-current', seq: null, isCurrent: true, request: currentRequestOf(value), label: t('当前（下一次请求）') });
  var selectedIndex = entries.length - 1;
  if (opts.current === true) selectedIndex = entries.length - 1;
  else if (finiteNumber(opts.seq)) {
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].seq === num(opts.seq)) { selectedIndex = i; break; }
    }
  }
  var selected = entries[selectedIndex];
  var previous = selectedIndex > 0 ? entries[selectedIndex - 1] : null;
  var request = selected.request;
  // 比前轮：回退到上一个 turn 的最后一条请求。
  var turnBase = null;
  for (var ti = selectedIndex - 1; ti >= 0; ti -= 1) {
    if (num(entries[ti].request.turn) < num(request.turn)) { turnBase = entries[ti]; break; }
  }
  var baseEntry = baseMode === 'turn' ? turnBase : previous;
  var indexedNodes = browserNodes(value, request, baseEntry && baseEntry.request, selected.isCurrent);
  var dnaRows = [];
  var dnaTotal = 0;
  if (opts.dna === true) {
    var bands = dnaBandsAt(value, selected.isCurrent ? Infinity : num(request.seq), true);
    dnaTotal = bands.length;
    dnaRows = bands.slice(0, MAX_BROWSER_DNA_ROWS).map(function (band, index) {
      var node = band.node;
      var label = text(node.skill) ? t(CATEGORY_LABELS.skill) + ' · ' + text(node.skill)
        : band.key === 'tool' ? (text(node.tool) || (Array.isArray(node.calls) ? node.calls.join(', ') : '') || t('工具结果'))
          : band.key === 'inject' ? t(CATEGORY_LABELS.inject) + (text(node.form) ? ' · ' + t(INJECTION_FORM_LABELS[text(node.form)] || '上下文注入') : '')
            : t(CATEGORY_LABELS[band.key] || band.key);
      var meta = [text(node.name), text(node.source), node.err === true ? t('失败') : ''].filter(Boolean).join(' · ');
      return {
        key: 'dna-' + band.seq + '-' + index,
        seq: band.seq,
        posText: '#' + formatCompact(index + 1),
        category: band.key,
        categoryText: t(CATEGORY_LABELS[band.key] || band.key),
        label: label,
        tokenText: '≈' + formatCompact(band.tokens) + ' tok',
        stamp: nodeStamp(node, requests, seqToRequest),
        timeText: finiteNumber(node.time) ? formatTime(node.time) : '',
        metaText: meta,
        expanded: false
      };
    });
  }
  var estimated = request.total > 0 ? request.total
    : CATEGORY_KEYS.reduce(function (a, k) { return a + num(request[k]); }, 0);
  var baseRequest = baseEntry ? baseEntry.request : null;
  var rows = CATEGORY_KEYS.map(function (key) {
    var v = num(request[key]);
    var allNodes = indexedNodes[key] || [];
    var count = categoryCountOf(request, key, allNodes);
    var baseCount = baseRequest ? categoryCountOf(baseRequest, key, []) : 0;
    var baseValue = baseRequest ? num(baseRequest[key]) : 0;
    var nodes = allNodes.filter(function (node) {
      if (query !== '') {
        var haystack = [text(node.name), text(node.text), text(node.tool), text(node.form), text(node.skill),
          Array.isArray(node.calls) ? node.calls.join(' ') : ''].join(' ').toLocaleLowerCase();
        if (haystack.indexOf(query) < 0) return false;
      }
      // 助手 kind chips 只作用于助手类别，其它类别不受影响（dsh-context browser.tsx 只在该类别渲染 chips）。
      if (kind !== '' && key === 'assistant') {
        return isObject(node.kinds) && num(node.kinds[kind]) > 0;
      }
      return true;
    });
    var tokenDelta = v - baseValue;
    return {
      key: key,
      swatch: 'ctx-c-' + key,
      label: t(CATEGORY_LABELS[key] || key),
      countText: count > 0 ? t('{n} 项', { n: formatCompact(count) }) : '',
      countDeltaText: baseRequest ? signedCompact(count - baseCount) : '',
      countDeltaClass: count - baseCount > 0 ? 'up' : count - baseCount < 0 ? 'down' : '',
      tokenText: '≈' + formatCompact(v),
      tokenDeltaText: baseRequest ? signedCompact(tokenDelta) : '',
      tokenDeltaClass: tokenDelta > 0 ? 'up' : tokenDelta < 0 ? 'down' : '',
      pctText: estimated > 0 ? formatPercent(v, estimated) : '—',
      empty: count <= 0 || v <= 0,
      // 消息类空类别不可展开；system/tools 即使为空也允许展开显示降级说明。
      disabled: (count <= 0 || v <= 0) && key !== 'system' && key !== 'tools',
      expanded: expanded.indexOf(key) >= 0,
      // 消息类按「最新在上」展示（dsh-context browserRows.ts .slice().reverse()）；工具定义保持头顺序。
      nodes: (key === 'tools' ? nodes : nodes.slice().reverse()).map(function (node, index) { return browserNodeRow(node, index, requests, seqToRequest, t, text(opts.toolName)); }),
      totalNodes: allNodes.length,
      moreNodes: Math.max(0, allNodes.length - nodes.length)
    };
  });
  var composition = CATEGORY_KEYS.map(function (key) {
    return { key: key, width: estimated > 0 ? Math.min(100, (num(request[key]) / estimated) * 100) : 0 };
  }).filter(function (segment) { return segment.width > 0; });
  return {
    empty: requests.length === 0,
    count: requests.length,
    countText: requests.length > 0 ? t('最近 {n} 条', { n: formatCompact(requests.length) }) : '',
    options: entries.map(function (e) { return { key: e.key, seq: e.seq, isCurrent: e.isCurrent, label: e.label }; }),
    selectedIndex: selectedIndex,
    selectedLabel: selected.label,
    selectedSeq: selected.isCurrent ? null : selected.seq,
    isCurrent: selected.isCurrent,
    base: baseMode,
    baseLabel: baseMode === 'turn' ? t('比前轮') : t('比前步'),
    historyPartial: !selected.isCurrent && finiteNumber(value.archiveFloor)
      && num(value.archiveFloor) > num(selected.seq),
    historyPartialText: !selected.isCurrent && finiteNumber(value.archiveFloor)
      && num(value.archiveFloor) > num(selected.seq) ? t('历史明细可能不完整') : '',
    canPrev: selectedIndex > 0,
    canNext: selectedIndex < entries.length - 1,
    prevSeq: selectedIndex > 0 ? entries[selectedIndex - 1].seq : null,
    nextSeq: selectedIndex < entries.length - 1 ? entries[selectedIndex + 1].seq : null,
    estimated: estimated,
    estimatedText: estimated > 0 ? '≈' + formatCompact(estimated) : '—',
    promptText: request.prompt === null ? '—' : formatCompact(request.prompt),
    timeText: selected.isCurrent ? '' : formatTime(selected.request.time),
    composition: composition,
    rows: rows,
    estimatedLabel: t('估算合计'),
    promptLabel: t('实际 prompt'),
    dna: opts.dna === true,
    dnaRows: dnaRows,
    dnaCountText: opts.dna === true ? t('{n} 个上下文条目', { n: formatCompact(dnaTotal) }) + (dnaTotal > dnaRows.length ? t('（仅列最近 40 项）') : '') : '',
    query: opts.query || '',
    kind: kind,
    kindChips: [
      { key: 'think', label: t('思考'), active: kind === 'think' },
      { key: 'tools', label: t('工具'), active: kind === 'tools' },
      { key: 'answer', label: t('回答'), active: kind === 'answer' }
    ]
  };
}

// ---------- 最近上下文事件 ----------

function eventKindText(kind, t) {
  if (kind === 'compaction') return t('压缩');
  if (kind === 'prune') return t('剪枝');
  if (kind === 'inject') return t('注入');
  if (kind === 'model') return t('模型');
  if (kind === 'mode') return t('模式');
  return t('其他');
}

var EVENT_KINDS = ['inject', 'compaction', 'prune', 'model', 'mode'];
var INJECTION_FORM_LABELS = {
  instructions: '指令注入', catalog: '目录更新', snapshot: '状态快照', notice: '通知',
  relay: '代理转发', recall: '历史召回', context: '上下文注入'
};

/** 事件位置：最近一条 seq 不大于该事件的请求 → `T{turn} S{step}`（dsh-context events.tsx 口径）。 */
function eventPositionOf(seq, requests) {
  var hit = null;
  for (var i = 0; i < requests.length; i += 1) {
    if (requests[i].seq <= seq) hit = requests[i];
    else break;
  }
  if (hit === null) return '';
  return 'T' + (hit.turn || 0) + ' S' + (hit.step || 0);
}

function deriveEvents(value, t, selectedFilter) {
  t = identity(t);
  var events = Array.isArray(value.events) ? value.events : [];
  var sessionCounts = isObject(value.counts) ? value.counts : null;
  var requests = sortedRequests(value);
  var eventCounts = { inject: 0, compaction: 0, prune: 0, model: 0, mode: 0, other: 0 };
  events.forEach(function (event) {
    if (!isObject(event)) return;
    var kind = text(event.kind) || 'other';
    eventCounts[EVENT_KINDS.indexOf(kind) >= 0 ? kind : 'other'] += 1;
  });
  // 选中集合：null/'all' = 全选；数组 = 多选（至少一枚）。
  var selected = Array.isArray(selectedFilter)
    ? selectedFilter.filter(function (kind) { return EVENT_KINDS.indexOf(kind) >= 0; })
    : (EVENT_KINDS.indexOf(selectedFilter) >= 0 ? [selectedFilter] : EVENT_KINDS.slice());
  if (!selected.length) selected = EVENT_KINDS.slice();
  // 前三种带全量计数（value.counts 是整段会话口径），model/mode 不计数。
  var counterOf = function (kind) {
    if (kind === 'inject') return sessionCounts && finiteNumber(sessionCounts.injects) ? num(sessionCounts.injects) : eventCounts.inject;
    if (kind === 'compaction') return sessionCounts && finiteNumber(sessionCounts.compactions) ? num(sessionCounts.compactions) : eventCounts.compaction;
    if (kind === 'prune') return sessionCounts && finiteNumber(sessionCounts.prunes) ? num(sessionCounts.prunes) : eventCounts.prune;
    return null;
  };
  var filters = EVENT_KINDS.map(function (kind) {
    var count = counterOf(kind);
    return {
      key: kind,
      label: eventKindText(kind, t),
      countText: count === null ? '' : formatCompact(count),
      active: selected.indexOf(kind) >= 0
    };
  });
  var rows = events.filter(function (event) {
    if (!isObject(event)) return false;
    var kind = text(event.kind) || 'other';
    return selected.indexOf(kind) >= 0;
  }).slice(-MAX_EVENTS).reverse().map(function (event, index) {
    var kind = text(event.kind) || 'other';
    if (EVENT_KINDS.indexOf(kind) < 0) kind = 'other';
    var tokens = Number.isFinite(Number(event.tokens)) ? num(event.tokens) : null;
    var name = text(event.name);
    var label = name;
    var icon = '•';
    if (kind === 'inject') {
      var form = text(event.form);
      var formLabel = t(INJECTION_FORM_LABELS[form] || '上下文注入');
      label = event.sub === 'skill'
        ? t('Skill 注入（{name}）', { name: name || '?' })
        : [formLabel, name, text(event.detail)].filter(function (part) { return part !== ''; }).join(' · ');
      icon = '+';
    } else if (kind === 'compaction') {
      var replaced = num(event.count);
      label = replaced > 0 ? t('压缩上下文（摘要替换 {n} 条消息）', { n: formatCompact(replaced) }) : t('压缩上下文');
      icon = '✂';
    } else if (kind === 'prune') {
      label = t('剪枝工具输出');
      icon = '✂';
    } else if (kind === 'model') {
      label = t('模型切换：{from} → {to}', { from: text(event.from) || '—', to: text(event.to) || '—' });
      icon = '⤳';
    } else if (kind === 'mode') {
      label = eventKindText(name, t) === name ? name : t(name === 'plan.off' ? '退出计划模式' : '进入计划模式');
      icon = '⇄';
    }
    return {
      key: 'ev-' + num(event.seq) + '-' + index,
      kindClass: kind,
      icon: icon,
      timeText: formatTime(num(event.time)),
      kindText: eventKindText(kind, t),
      name: label,
      positionText: eventPositionOf(num(event.seq), requests),
      tokensText: tokens !== null ? (kind === 'inject' ? '+' : '−') + formatCompact(tokens) : '',
      tokensClass: kind === 'inject' ? 'up' : 'down',
      countText: num(event.count) > 1 && kind === 'inject' ? '×' + formatCompact(event.count) : ''
    };
  });
  return {
    rows: rows,
    filters: filters,
    selected: selected,
    allSelected: selected.length === EVENT_KINDS.length,
    countText: formatCompact(events.length),
    hasData: events.length > 0,
    empty: rows.length === 0
  };
}

function isImageFile(row) {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(row.path)
    || row.ops.some(function (op) { return op.tool === 'read_image'; });
}

// 文件活动字形（dsh-context fileActivity.ts §4.3）：语言走文本徽标，其余走 emoji 桶。
var FILE_LANG_GLYPHS = {
  tsx: ['TSX', '#3178c6'], ts: ['TS', '#3178c6'], js: ['JS', '#f7df1e'], jsx: ['JS', '#f7df1e'],
  mjs: ['JS', '#f7df1e'], cjs: ['JS', '#f7df1e'], py: ['PY', '#3572a5'], go: ['GO', '#00add8'],
  rs: ['RS', '#dea584'], java: ['JV', '#b07219'], kt: ['KT', '#a97bff'], rb: ['RB', '#701516'],
  php: ['PHP', '#4f5d95'], c: ['C', '#555'], h: ['C', '#555'], cpp: ['C++', '#f34b7d'], cc: ['C++', '#f34b7d'],
  hpp: ['C++', '#f34b7d'], cs: ['C#', '#178600'], scss: ['SC', '#c22d40'], sass: ['SC', '#c22d40'],
  lua: ['LUA', '#000080'], dart: ['DA', '#00b4ab'], swift: ['SW', '#f05138'], vue: ['VUE', '#41b883'],
  svelte: ['SV', '#ff3e00'], sh: ['SH', '#89e051'], bash: ['SH', '#89e051'], zsh: ['SH', '#89e051'],
  html: ['HT', '#e34c26'], htm: ['HT', '#e34c26'], css: ['CSS', '#563d7c'], sql: ['SQL', '#e38c00']
};
var FILE_EMOJI_GLYPHS = {
  lock: '🔒', test: '🧪', docker: '🐳', script: '🛠️', ignore: '🚫', license: '⚖️', config: '⚙️',
  data: '🧾', markdown: '📝', log: '📜', sheet: '📊', doc: '📕', archive: '🗜️', font: '🔤', media: '🎬'
};
var FILE_EMOJI_BY_EXT = {
  json: 'config', yaml: 'config', yml: 'config', toml: 'config', ini: 'config', env: 'config',
  lock: 'lock', md: 'markdown', mdx: 'markdown', csv: 'data', tsv: 'data', xml: 'data',
  log: 'log', xls: 'sheet', xlsx: 'sheet', pdf: 'doc', docx: 'doc', txt: 'doc', zip: 'archive',
  gz: 'archive', tar: 'archive', ttf: 'font', woff: 'font', woff2: 'font', mp4: 'media', mov: 'media'
};
function fileGlyphOf(path) {
  var name = String(path).split('/').pop();
  var lower = name.toLocaleLowerCase();
  var ext = lower.indexOf('.') >= 0 ? lower.split('.').pop() : '';
  var lang = FILE_LANG_GLYPHS[ext];
  if (lang) return { label: lang[0], color: lang[1], emoji: false };
  if (isImageFile({ path: path, ops: [] })) return { emoji: true, label: '🖼' };
  var bucket = FILE_EMOJI_BY_EXT[ext] || '';
  if (!bucket) {
    var base = lower.replace(/\.[^.]+$/, '');
    if (/^dockerfile|^docker-compose|\.dockerfile$/.test(lower)) bucket = 'docker';
    else if (/test|spec/.test(base) || /[._]test\./.test(lower)) bucket = 'test';
    else if (lower.startsWith('.') || /ignore|gitkeep/.test(lower)) bucket = 'ignore';
    else if (/license|licence|copying/.test(lower)) bucket = 'license';
    else if (/^readme|^changelog|^contributing/.test(lower)) bucket = 'markdown';
    else if (/\.sh$|\.bash$|\.zsh$/.test(lower)) bucket = 'script';
  }
  return { emoji: true, label: FILE_EMOJI_GLYPHS[bucket] || '📄' };
}

function deriveFileActivity(value, t, beforeSeq, options) {
  t = identity(t);
  var opts = options || {};
  var filter = ['read', 'write', 'search', 'image'].indexOf(opts.filter) >= 0 ? opts.filter : 'all';
  // 排序键对齐插件：按次数 / 按行数 / 按最新 / 按路径 / 按文件名。
  var sort = ({ count: 'count', activity: 'count', lines: 'lines', latest: 'latest', recent: 'latest', path: 'path', name: 'name' })[opts.sort] || 'count';
  var query = text(opts.query).trim().toLocaleLowerCase();
  var expandedPath = text(opts.expandedPath);
  var requests = sortedRequests(value);
  var records = Array.isArray(value.fileOps) ? value.fileOps : [];
  var grouped = Object.create(null);
  var totals = { reads: 0, writes: 0, searches: 0, added: 0, removed: 0, errors: 0, imageFiles: 0 };
  records.forEach(function (op) {
    if (!isObject(op) || typeof op.path !== 'string' || !op.path) return;
    if (finiteNumber(beforeSeq) && num(op.seq) > num(beforeSeq)) return;
    var row = grouped[op.path];
    if (!row) row = grouped[op.path] = { path: op.path, reads: 0, writes: 0, searches: 0, added: 0, removed: 0, errors: 0, last: 0, lastSeq: 0, ops: [] };
    var bucket = op.kind === 'read' ? 'reads' : op.kind === 'write' ? 'writes' : op.kind === 'search' ? 'searches' : '';
    if (!bucket) return;
    row.ops.push(op);
    row[bucket] += 1;
    row.added += num(op.added);
    row.removed += num(op.removed);
    if (op.err === true) row.errors += 1;
    row.last = Math.max(row.last, num(op.time));
    row.lastSeq = Math.max(row.lastSeq, num(op.seq));
    totals[bucket] += 1;
    totals.added += num(op.added);
    totals.removed += num(op.removed);
    if (op.err === true) totals.errors += 1;
  });
  var allRows = Object.keys(grouped).map(function (path) { return grouped[path]; });
  allRows.forEach(function (row) {
    if (isImageFile(row)) totals.imageFiles += 1;
  });
  var rows = allRows.filter(function (row) {
    var queryMatch = !query || row.path.toLocaleLowerCase().indexOf(query) >= 0;
    return queryMatch && (filter === 'all' || (filter === 'read' && row.reads > 0)
      || (filter === 'write' && row.writes > 0) || (filter === 'search' && row.searches > 0)
      || (filter === 'image' && isImageFile(row)));
  }).sort(function (a, b) {
      if (sort === 'latest') return (b.last - a.last) || a.path.localeCompare(b.path);
      if (sort === 'lines') return ((b.added + b.removed) - (a.added + a.removed)) || (b.last - a.last) || a.path.localeCompare(b.path);
      if (sort === 'path') return a.path.localeCompare(b.path);
      if (sort === 'name') return a.path.split('/').pop().localeCompare(b.path.split('/').pop()) || a.path.localeCompare(b.path);
      var countA = a.reads + a.writes + a.searches;
      var countB = b.reads + b.writes + b.searches;
      return (countB - countA) || (b.last - a.last) || a.path.localeCompare(b.path);
    });
  var totalRows = rows.length;
  rows = rows.slice(0, MAX_FILE_ROWS).map(function (row, index) {
    var ops = row.ops.slice().sort(function (a, b) { return (num(b.time) - num(a.time)) || (num(b.seq) - num(a.seq)); });
    var slash = row.path.lastIndexOf('/');
    var dir = slash >= 0 ? row.path.slice(0, slash + 1) : '';
    var base = slash >= 0 ? row.path.slice(slash + 1) : row.path;
    var badges = [];
    if (row.reads) badges.push({ key: 'read', label: t('读取'), count: row.reads });
    if (row.writes) badges.push({ key: 'write', label: t('写入'), count: row.writes });
    if (row.searches) badges.push({ key: 'search', label: t('搜索'), count: row.searches });
    return {
      key: 'file-' + index + '-' + row.path,
      path: row.path,
      dirText: dir,
      nameText: base,
      glyph: fileGlyphOf(row.path),
      image: isImageFile(row),
      expanded: expandedPath === row.path,
      lastSeq: row.lastSeq,
      badges: badges,
      addedText: row.added ? '+' + formatCompact(row.added) : '',
      removedText: row.removed ? '−' + formatCompact(row.removed) : '',
      errorsText: row.errors ? t('失败 {n}', { n: row.errors }) : '',
      timeText: row.last ? formatTime(row.last) : '',
      ops: ops.slice(0, 12).map(function (op, opIndex) {
        var kind = op.kind === 'read' ? t('读取') : op.kind === 'write' ? t('写入') : t('搜索');
        var detail = text(op.detail) || text(op.pattern) || text(op.path);
        var readText = finiteNumber(op.readCount) && num(op.readCount) > 0
          ? (finiteNumber(op.readStart) ? t('读取第 {a}–{b} 行', { a: formatCompact(op.readStart), b: formatCompact(num(op.readStart) + num(op.readCount) - 1) })
            : t('≈{n} 行', { n: formatCompact(op.readCount) }))
          : '';
        var deltaText = num(op.added) || num(op.removed) ? '+' + formatCompact(op.added) + ' / −' + formatCompact(op.removed) : '';
        var stamp = eventPositionOf(num(op.seq), requests);
        return {
          key: 'op-' + num(op.seq) + '-' + opIndex,
          kindText: kind,
          toolText: text(op.tool),
          detail: detail,
          readText: readText,
          deltaText: deltaText,
          hitsText: finiteNumber(op.hits) && num(op.hits) > 0 ? '×' + formatCompact(op.hits) : '',
          error: op.err === true,
          stamp: stamp,
          stepSeq: stamp ? (function () {
            var hit = null;
            for (var i = 0; i < requests.length; i += 1) if (num(requests[i].seq) <= num(op.seq)) hit = requests[i];
            return hit ? num(hit.seq) : null;
          })() : null,
          timeText: finiteNumber(op.time) ? formatTime(num(op.time)) : ''
        };
      }),
      moreOps: Math.max(0, ops.length - 12)
    };
  });
  var chipCounts = { all: totals.reads + totals.writes + totals.searches, read: totals.reads, write: totals.writes, search: totals.searches, image: totals.imageFiles };
  var chips = [
    { key: 'all', label: t('全部') },
    { key: 'read', label: t('读取') },
    { key: 'write', label: t('写入') },
    { key: 'search', label: t('搜索') },
    { key: 'image', label: t('图片') }
  ].map(function (chip) {
    return { key: chip.key, label: chip.label, countText: formatCompact(chipCounts[chip.key]), active: filter === chip.key };
  });
  var sorts = [
    { key: 'count', label: t('按次数') },
    { key: 'lines', label: t('按行数') },
    { key: 'latest', label: t('按最新') },
    { key: 'path', label: t('按路径') },
    { key: 'name', label: t('按文件名') }
  ].map(function (item) { return { key: item.key, label: item.label, active: item.key === sort }; });
  return {
    rows: rows,
    empty: allRows.length === 0,
    noMatches: totalRows === 0 && allRows.length > 0,
    totalRows: totalRows,
    moreCount: Math.max(0, totalRows - MAX_FILE_ROWS),
    filter: filter,
    sort: sort,
    sorts: sorts,
    query: query,
    expandedPath: expandedPath,
    imageFiles: totals.imageFiles,
    chips: chips,
    reads: totals.reads,
    writes: totals.writes,
    searches: totals.searches,
    readsText: t('读取 {n}', { n: totals.reads }),
    writesText: t('写入 {n}', { n: totals.writes }),
    searchesText: t('搜索 {n}', { n: totals.searches }),
    deltaText: totals.added || totals.removed ? t('+{added} / −{removed} 行', { added: totals.added, removed: totals.removed }) : '',
    errorsText: totals.errors ? t('失败 {n}', { n: totals.errors }) : '',
    totalFilesText: t('{n} 个文件', { n: formatCompact(totalRows) }),
    truncated: finiteNumber(value.fileOpsFloor) && num(value.fileOpsFloor) > 0,
    floorText: finiteNumber(value.fileOpsFloor) && num(value.fileOpsFloor) > 0
      ? t('较早的文件记录已裁剪') : ''
  };
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
    trendDetail: null,
    events: null,
    files: null
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
    var current = deriveCurrent(value, t, opts.contextPressure, opts.currentHighlight);
    current.modelText = [text(value.model), text(value.provider)].filter(function (part) { return part !== ''; }).join(' · ');
    var fleetValue = isObject(opts.fleet) ? opts.fleet : null;
    var trend = deriveTrend(value, t, {
      groupBy: opts.trendGroupBy,
      displayMode: opts.trendDisplayMode,
      selectedSeq: opts.trendSeq,
      activeTurn: opts.trendActiveTurn,
      dna: opts.trendDna === true,
      overview: opts.trendOverview === true,
      adaptive: opts.trendAdaptive === true,
      showDuration: opts.trendShowDuration !== false,
      visibleRange: opts.trendVisibleRange,
      paneWidth: opts.trendPaneWidth,
      hoverSeq: opts.trendHoverSeq,
      hoverX: opts.trendHoverX,
      hoverLeft: opts.trendHoverLeft,
      tipLeft: opts.trendTipLeft
    });
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
      current: current,
      browser: deriveBrowser(value, t, {
        seq: opts.browserCurrent === true ? null : (finiteNumber(opts.browserSeq) ? opts.browserSeq : trend.selectedSeq),
        current: opts.browserCurrent === true,
        expanded: opts.expanded,
        dna: trend.dna,
        base: opts.browserBase,
        query: opts.browserQuery,
        kind: opts.browserKind,
        toolName: opts.browserTool
      }),
      trend: trend,
      trendDetail: deriveTrendSelection(value, trend.selectedSeq, t, { delta: trend.displayMode === 'delta' }),
      events: deriveEvents(value, t, opts.eventFilter),
      commands: deriveCommands(value, t, { filter: opts.commandFilter, expandedId: opts.commandExpandedId }),
      files: deriveFileActivity(value, t, opts.browserCurrent === true ? null : (finiteNumber(opts.browserSeq) ? opts.browserSeq : trend.selectedSeq), { filter: opts.fileFilter, sort: opts.fileSort, query: opts.fileQuery, expandedPath: opts.fileExpandedPath })
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
  // DSH's subagent identity label is the task name; the session title may be a
  // generic conversation title and must not mask it.
  var title = (source.origin === 'subagent' && label ? label : '') || text(source.title) || label || sessionId;
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
    parentSessionId: text(source.parentSessionId),
    origin: source.origin === 'subagent' ? 'subagent' : '',
    mode: mode === 'one-shot' || mode === 'continuable' ? mode : '',
    depth: depth,
    indentStyle: 'margin-left:' + (indentDepth * FLEET_INDENT_RPX) + 'rpx;',
    isCurrent: isCurrent,
    isRoot: isRoot,
    running: running,
    completed: source.completed === true,
    stateText: running ? t('运行中') : (phaseLabel || t('空闲')),
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

function deriveFleetOverview(rawAgents, cards) {
  // Match dsh-context FleetSummary: the rendered family nodes are authoritative.
  var agentsCount = cards.length;
  var runningFallback = 0;
  cards.forEach(function (card) { if (card.running) runningFallback += 1; });
  var runningCount = runningFallback;
  var subagentsCount = 0;
  cards.forEach(function (card) { if (!card.isCurrent) subagentsCount += 1; });
  var totalTokens = 0;
  rawAgents.forEach(function (agent) {
    // DSH FleetSummary sums each node's context headline, not billed tokens.
    if (isObject(agent) && finiteNumber(agent.pressureTokens)) totalTokens += num(agent.pressureTokens);
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

// ---------- 编队网络图（dsh-context agentTree.ts layoutForest + agentGraph.tsx） ----------
var FLEET_CARD_H = 140;          // 卡高，容纳三行标题 + 用量/组成条/脚注，连线端点贴卡边
var FLEET_LEVEL_H = 212;         // 层高 = 140 + 72 连线通道
var FLEET_PAD_Y = 48;            // 首层顶部留白
var FLEET_SLOT_MAX = 276;
var FLEET_SLOT_MIN = 150;        // 手机端调小，375pt 可放 2 列
var FLEET_CARD_GUTTER = 12;
var FLEET_MIN_CARD_W = 130;
var FLEET_BAND_GAP = 24;

function fleetHex(h, s, l) {
  var c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = l / 100 - c / 2;
  var rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(function (value) {
    var hex = Math.round((value + m) * 255).toString(16);
    return hex.length < 2 ? '0' + hex : hex;
  }).join('').toUpperCase();
}
/** 一级子树色相：黄金角序列（agentTree.ts familyHue）。 */
function fleetFamilyColor(family) {
  if (family < 0) return '#90A1B9';
  return fleetHex(Math.round(family * 137.508) % 360, 58, 52);
}

var FLEET_STATE_PHASES = { done: 'done', completed: 'done', failed: 'failed', cancelled: 'failed', canceled: 'failed', blocked: 'failed' };
/* 运行中 → 转圈；已完成/失败看 phase；没跑过的才算空闲。
   主 Agent 的 phase 恒为 active（表示"当前会话"而非"正在运行"），
   所以只要有用量或步数就认定它跑过 → 显示绿点。 */
function fleetStateKindOf(running, phaseKey, hasUsage) {
  if (running) return 'running';
  if (FLEET_STATE_PHASES[phaseKey]) return FLEET_STATE_PHASES[phaseKey];
  return hasUsage === true ? 'done' : 'idle';
}
function fleetHasUsage(raw) {
  if (!isObject(raw)) return false;
  return num(raw.tokensTotal) > 0 || num(raw.steps) > 0 || num(raw.turns) > 0
    || text(raw.lastAnswer) !== '' || text(raw.phase) === 'done' || text(raw.phase) === 'completed';
}

function buildFleetTree(agents) {
  var roots = [];
  var stack = [];
  agents.forEach(function (raw, index) {
    if (!isObject(raw)) return;
    var id = text(raw.sessionId) || text(raw.id);
    if (id === '') return;
    var depth = Math.max(0, Math.floor(num(raw.depth)));
    while (stack.length > depth) stack.pop();
    var node = { raw: raw, id: id, depth: depth, children: [], index: index, slot: 0, family: -1 };
    if (depth > 0 && stack[depth - 1]) {
      node.parent = stack[depth - 1];
      stack[depth - 1].children.push(node);
    } else {
      roots.push(node);
    }
    stack[depth] = node;
    stack.length = depth + 1;
  });
  var familyIndex = 0;
  roots.forEach(function (root) {
    root.children.forEach(function (child) {
      (function mark(node, family) {
        node.family = family;
        node.children.forEach(function (next) { mark(next, family); });
      })(child, familyIndex);
      familyIndex += 1;
    });
  });
  var leafCounter = 0;
  function place(node) {
    if (!node.children.length) {
      node.slot = leafCounter;
      leafCounter += 1;
      return node.slot;
    }
    // 每个子节点都要递归占位：只放第一个会让其余子树全部落在 slot 0，
    // 卡片重叠、连线长度为零（表现为「有节点没连线」）。
    var first = place(node.children[0]);
    var last = first;
    for (var i = 1; i < node.children.length; i += 1) last = place(node.children[i]);
    node.slot = (first + last) / 2;
    return node.slot;
  }
  var all = [];
  function walk(node) { all.push(node); node.children.forEach(walk); }
  roots.forEach(function (root) { place(root); walk(root); });
  return { roots: roots, nodes: all, leafCount: leafCounter };
}

/** tidy-tree 布局：自然布局放得下就一屏；放不下按一级子树折带（永不横向溢出）。 */
function layoutFleetGraph(agents, stageWidth, options) {
  var opts = options || {};
  var t = identity(opts.t);
  var width = Math.max(240, Math.round(num(stageWidth) || 343));
  var tree = buildFleetTree(Array.isArray(agents) ? agents : []);
  var result = { width: width, height: FLEET_PAD_Y + FLEET_CARD_H + 24, nodes: [], links: [], leafCount: tree.leafCount, banded: false };
  if (!tree.nodes.length) return result;
  var perLevel = Math.max(1, Math.floor((width - 8) / FLEET_SLOT_MIN));
  var slot = Math.min(FLEET_SLOT_MAX, Math.floor((width - 8) / Math.max(1, Math.min(tree.leafCount, perLevel))));
  var positioned = [];
  var maxDepth = 0;
  tree.nodes.forEach(function (node) { maxDepth = Math.max(maxDepth, node.depth); });
  // 统一布局：叶子按 perLevel 折行，父节点居中于首末子节点正上方。
  // 之前分成「自然/折带」两套，折带分支会漏掉根节点、且同层子节点坐标相同
  // （卡片重叠、连线长度为 0，看起来就是「有节点没连线」）。
  var slotW = Math.min(FLEET_SLOT_MAX, (width - 8) / Math.max(1, Math.min(tree.leafCount, perLevel)));
  var inset = Math.max(4, (width - slotW * Math.min(tree.leafCount, perLevel)) / 2);
  var leafIndex = 0;
  var maxRow = 0;
  tree.nodes.forEach(function (node) {
    if (node.children.length) return;
    node.row = Math.floor(leafIndex / perLevel);
    node.leafCol = leafIndex % perLevel;
    node.rowCount = Math.min(perLevel, tree.leafCount - node.row * perLevel);
    leafIndex += 1;
    maxRow = Math.max(maxRow, node.row);
  });
  function layoutX(node) {
    if (!node.children.length) {
      var rowInset = ((perLevel - node.rowCount) * slotW) / 2;
      node.x = inset + rowInset + slotW * (node.leafCol + 0.5);
      return node.x;
    }
    // 用子节点的最小/最大 x 取中：折行后首末子节点可能不同列，
    // 只取首末会把父节点带偏到一侧。
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < node.children.length; i += 1) {
      var cx = layoutX(node.children[i]);
      if (cx < min) min = cx;
      if (cx > max) max = cx;
    }
    node.x = (min + max) / 2;
    return node.x;
  }
  tree.nodes.forEach(function (node) { if (node.depth === 0) layoutX(node); });
  // 根节点独占一行：横向铺满舞台，不必和子节点同宽（一行只有一个卡片）。
  var rootCount = tree.roots.length;
  tree.nodes.forEach(function (node) {
    node.y = FLEET_PAD_Y + (node.children.length ? node.depth : node.depth + (node.row || 0)) * FLEET_LEVEL_H;
    node.w = Math.max(FLEET_MIN_CARD_W, slotW - FLEET_CARD_GUTTER);
    if (rootCount === 1 && node.depth === 0) {
      // 独占一行但不必铺满（约 72% 宽居中）。
      node.w = Math.round(Math.min(width - 16, width * 0.72));
      node.x = width / 2;
    }
    positioned.push(node);
  });
  result.height = FLEET_PAD_Y + (maxDepth + maxRow) * FLEET_LEVEL_H + FLEET_CARD_H + 24;
  result.leafCount = tree.leafCount;
  var currentId = text(opts.currentSessionId);
  var selectedId = text(opts.selectedId);
  var nodes = positioned.map(function (node) {
    var raw = node.raw;
    var card = opts.cardOf ? opts.cardOf(node.id) : null;
    var running = raw.running === true;
    var occupancyPct = card && card.occupancy.hasData ? card.occupancy.width : null;
    var barSegments = card && card.composition.hasData
      ? card.composition.segments.map(function (segment) {
        return { key: segment.key, width: segment.width * (occupancyPct === null ? 1 : occupancyPct / 100) };
      }).filter(function (segment) { return segment.width > 0; })
      : [];
    // A pressure snapshot can arrive before the category breakdown. Still render a truthful filled portion.
    if (!barSegments.length && occupancyPct !== null && occupancyPct > 0) {
      barSegments.push({ key: 'assistant', width: occupancyPct });
    }
    result.links.push.apply(result.links, node.children.map(function (child) {
      var x1 = node.x, y1 = node.y + FLEET_CARD_H;
      var x2 = child.x, y2 = child.y;
      var k = Math.min(96, Math.max(24, (y2 - y1) * 0.5));
      return {
        key: 'link-' + node.id + '>' + child.id,
        from: node.id,
        to: child.id,
        d: 'M ' + x1.toFixed(1) + ' ' + y1 + ' C ' + x1.toFixed(1) + ' ' + (y1 + k).toFixed(1) + ', ' + x2.toFixed(1) + ' ' + (y2 - k).toFixed(1) + ', ' + x2.toFixed(1) + ' ' + y2,
        // 画布绘制用的三次贝塞尔控制点（WXML 的 <svg> 在小程序里不渲染，连线改画布）
        p: [x1, y1, x1, y1 + k, x2, y2 - k, x2, y2],
        color: fleetFamilyColor(child.family),
        live: child.raw.running === true
      };
    }));
    return {
      key: node.id,
      id: node.id,
      sessionId: node.id,
      x: Math.round(node.x - node.w / 2),
      y: Math.round(node.y),
      w: Math.round(node.w),
      h: FLEET_CARD_H,
      title: card ? card.title : (text(raw.title) || node.id),
      duty: card && card.roleText ? card.roleText : '',
      isCurrent: node.id === currentId || raw.isCurrent === true,
      running: running,
      stateKind: fleetStateKindOf(running, card ? card.phase : '', fleetHasUsage(raw)),
      parentSessionId: text(raw.parentSessionId),
      mode: text(raw.mode),
      selected: selectedId !== '' && node.id === selectedId,
      badgeText: node.id === currentId ? t('当前') : '',
      tokensText: card ? card.tokensText : (finiteNumber(raw.tokensTotal) ? formatCompact(raw.tokensTotal) : '—'),
      // 左下角固定展示「运行时长 · 步数」：卡片缺失或没算出时长时回落到原始 timing，
      // 否则整行会塌成空白（设计稿这里一直有内容）。
      metaText: (function () {
        var active = card ? card.activeText : '';
        if (!active || active === '—') {
          var timing = isObject(raw.subagentTiming) ? raw.subagentTiming : null;
          var wall = timing !== null && finiteNumber(timing.settledMs) ? Number(timing.settledMs) : 0;
          if (!wall && isObject(raw.contextTimeline) && isObject(raw.contextTimeline.timing)
            && finiteNumber(raw.contextTimeline.timing.wallMs)) {
            wall = Number(raw.contextTimeline.timing.wallMs);
          }
          active = wall > 0 ? formatDuration(wall) : '—';
        }
        // 步数是计数，设计稿里就是「1500 步」而不是「1.5k 步」。
        var steps = finiteNumber(raw.steps) ? String(Math.round(Number(raw.steps))) + ' ' + t('步') : '—';
        return active + ' · ' + steps;
      })(),
      pctText: card && card.occupancy.hasData ? card.occupancy.pctText : '—',
      pctColor: card && card.occupancy.hasData
        ? (card.occupancy.width >= 90 ? '#FB2C36' : card.occupancy.width >= 70 ? '#FE9A00' : '#00C950') : 'var(--border)',
      segments: barSegments
    };
  });
  result.nodes = nodes;
  return result;
}

// ---------- 命令执行卡（dsh-context commandPanel.tsx） ----------
var COMMAND_FILTERS = ['all', 'failed', 'slow', 'background'];

function commandStatusOf(command) {
  var status = text(command.status);
  if (status === 'ok') return { key: 'ok', glyph: '✓', text: '正常' };
  if (status === 'killed') return { key: 'killed', glyph: '✕', text: '被终止' };
  return { key: 'failed', glyph: '✕', text: '失败' };
}

/** 命令账本视图模型：筛选 chips + 行 + 展开详情（参数来自宿主 tool/call↔result 配对）。 */
function deriveCommands(value, t, options) {
  var opts = options || {};
  var filter = COMMAND_FILTERS.indexOf(opts.filter) >= 0 ? opts.filter : 'all';
  var expandedId = text(opts.expandedId);
  var list = Array.isArray(value.commands) ? value.commands.filter(isObject) : [];
  var stats = isObject(value.commandStats) ? value.commandStats : {};
  var runs = finiteNumber(stats.runs) ? num(stats.runs) : list.length;
  var failed = finiteNumber(stats.failed) ? num(stats.failed) : 0;
  var totalMs = finiteNumber(stats.ms) ? num(stats.ms) : 0;
  var bg = finiteNumber(stats.bg) ? num(stats.bg) : 0;
  var slow = list.filter(function (command) { return num(command.durationMs) >= 1000; }).length;
  var counts = {
    all: runs,
    failed: failed,
    slow: slow,
    background: bg
  };
  var chips = [
    { key: 'all', label: t('全部') },
    { key: 'failed', label: t('失败') },
    { key: 'slow', label: t('慢') },
    { key: 'background', label: t('后台') }
  ].map(function (chip) {
    return { key: chip.key, label: chip.label, countText: formatCompact(counts[chip.key]), active: filter === chip.key };
  });
  var rows = list.slice().sort(function (left, right) {
    return (num(right.time) - num(left.time)) || (num(right.seq) - num(left.seq));
  }).filter(function (command) {
    if (filter === 'failed') return text(command.status) !== 'ok';
    if (filter === 'slow') return num(command.durationMs) >= 1000;
    if (filter === 'background') return command.background === true;
    return true;
  }).slice(0, 60).map(function (command, index) {
    var status = commandStatusOf(command);
    var facts = [];
    if (finiteNumber(command.exit)) facts.push(t('退出码') + ' ' + num(command.exit));
    if (text(command.signal)) facts.push(t('信号') + ' ' + text(command.signal));
    if (command.timedOut === true) facts.push(t('超时'));
    if (command.stderr === true) facts.push('stderr');
    if (finiteNumber(command.outChars)) facts.push(t('输出字符') + ' ' + formatCompact(command.outChars));
    var key = 'cmd-' + num(command.seq) + '-' + index;
    return {
      key: key,
      seq: num(command.seq),
      statusClass: status.key,
      statusGlyph: status.glyph,
      statusText: status.text,
      timeText: finiteNumber(command.time) ? formatTime(num(command.time)) : '—',
      toolText: text(command.name),
      commandText: text(command.command),
      commandPreview: text(command.command).replace(/\s+/g, ' '),
      durationText: formatDuration(num(command.durationMs)),
      background: command.background === true,
      expanded: expandedId !== '' && expandedId === key,
      description: text(command.description),
      factsText: facts.join(' · '),
      truncated: command.truncated === true || command.outTruncated === true
    };
  });
  return {
    available: runs > 0,
    empty: list.length === 0,
    noMatches: rows.length === 0 && list.length > 0,
    chunks: chips,
    filter: filter,
    rows: rows,
    kpi: [
      { key: 'runs', label: t('执行'), valueText: formatCompact(runs) },
      { key: 'failed', label: t('失败'), valueText: formatCompact(failed) },
      { key: 'ms', label: t('总耗时'), valueText: formatDuration(totalMs) },
      { key: 'bg', label: t('后台'), valueText: formatCompact(bg) }
    ],
    countText: t('{n} 次执行', { n: formatCompact(runs) }),
    truncatedText: t('仅覆盖最近 {n} 次执行', { n: formatCompact(list.length) }),
    emptyText: t('该会话没有执行过命令'),
    noMatchText: t('没有匹配当前过滤条件的命令'),
    copyText: t('复制命令'),
    copiedText: t('已复制'),
    locateText: t('在上下文浏览器中定位')
  };
}

// ---------- 通讯面板（dsh-context commsPanel.tsx / commsRow.tsx） ----------// ---------- 通讯面板（dsh-context commsPanel.tsx / commsRow.tsx） ----------
var COMMS_KIND_LABELS = { relay: '私信', mailbox: '邮箱', settled: '回报' };

function settledCommsText(message, t) {
  var value = text(message && message.text);
  if (value.endsWith('finished and will do no further work unless you send it more.')) {
    return t('完成了任务，等待新指令');
  }
  if (value.endsWith('finished. It cannot receive follow-up messages.')) {
    return t('已完成（一次性，无法追问）');
  }
  return value;
}

/** comms 视图模型：type 徽标 + from → to + 摘录；参与方用于筛选 chips。 */
function deriveFleetComms(cards, value, options) {
  var opts = options || {};
  var t = identity(opts.t);
  var filter = text(opts.filter);
  var stale = opts.stale === true;
  var cardById = {};
  (Array.isArray(cards) ? cards : []).forEach(function (card) {
    if (card && card.sessionId) cardById[card.sessionId] = card;
  });
  var memberNames = isObject(opts.memberNames) ? opts.memberNames : {};
  var labelOf = function (id, fallback) {
    if (memberNames[id]) return memberNames[id];
    var card = cardById[id];
    return (card && card.title) || fallback || id;
  };
  var messages = isObject(value) && Array.isArray(value.messages) ? value.messages.filter(isObject) : [];
  var participants = [];
  var seen = {};
  messages.forEach(function (message) {
    ['from', 'to'].forEach(function (side) {
      var id = text(message[side]);
      if (id === '' || seen[id]) return;
      seen[id] = true;
      participants.push({ id: id, label: labelOf(id, text(message[side + 'Name'])) });
    });
  });
  var rows = messages.filter(function (message) {
    if (filter === '') return true;
    return text(message.from) === filter || text(message.to) === filter;
  }).map(function (message, index) {
    var kind = text(message.kind) || 'relay';
    var fromId = text(message.from);
    var toId = text(message.to);
    return {
      key: 'comms-' + num(message.seq) + '-' + index,
      kind: kind,
      kindText: t(COMMS_KIND_LABELS[kind] || '私信'),
      kindClass: COMMS_KIND_LABELS[kind] ? kind : 'relay',
      timeText: finiteNumber(message.time) && num(message.time) > 0 ? formatTime(num(message.time)) : '—',
      fromId: fromId,
      fromLabel: fromId ? labelOf(fromId, text(message.fromName)) : text(message.fromName),
      toId: toId,
      toLabel: labelOf(toId, text(message.toName)),
      text: kind === 'settled' ? settledCommsText(message, t) : text(message.text)
    };
  });
  var filters = [{ key: '', label: t('全部 Agent'), active: filter === '' }].concat(participants.map(function (participant) {
    return { key: participant.id, label: participant.label, active: filter === participant.id };
  }));
  return {
    hasData: isObject(value),
    rows: rows,
    filters: filters,
    filter: filter,
    countText: isObject(value) ? t('{n} 条消息', { n: formatCompact(rows.length) }) : '',
    totalText: isObject(value) ? t('{n} 条消息', { n: formatCompact(num(value.total)) }) : '',
    scannedText: isObject(value) ? t('已扫描 {n} 个会话', { n: formatCompact(num(value.scanned)) }) : '',
    truncated: isObject(value) && value.truncated === true,
    truncatedText: t('仅展示摘录（已达路由上限）'),
    // 有会话日志读不出来（例如旧格式/损坏）时明确告知，而不是让卡片看起来只是"没有消息"。
    partial: isObject(value) && (Array.isArray(cards) ? cards.length : 0) > num(value.scanned),
    partialText: t('部分会话日志无法读取，记录可能不完整'),
    stale: stale,
    staleText: t('有新动态'),
    emptyText: t('没有发现跨 Agent 消息'),
    noMatchText: t('该 Agent 没有通讯记录'),
    // 只有一个 Agent 时没有可扫描的跨 Agent 通讯：卡片保留，给出说明而不是扫描按钮。
    solo: (Array.isArray(cards) ? cards.length : 0) <= 1,
    soloText: t('当前只有 1 个 Agent —— 委派出子 Agent 后，跨 Agent 消息会在这里按时间列出'),
    scanText: t('扫描 {n} 个会话的通讯', { n: formatCompact(Array.isArray(cards) ? cards.length : 0) }),
    rescanText: t('重新扫描'),
    scanningText: t('扫描中…'),
    errorText: t('扫描失败，请重试')
  };
}

// ---------- 编队成员板（dsh-context memberBoard.tsx / fleet.css） ----------// ---------- 编队成员板（dsh-context memberBoard.tsx / fleet.css） ----------
var FLEET_MEMBER_SORTS = ['derived', 'context', 'duration', 'steps', 'latest'];
var FLEET_MEMBER_STATUS = ['all', 'running', 'done', 'idle'];

/** 成员板：team roster 与 Agent 家族合并成一张卡一行；色相沿一级子树黄金角。 */
function deriveFleetMembers(cards, rawAgents, team, options) {
  var opts = options || {};
  var t = identity(opts.t);
  var query = text(opts.query).trim().toLocaleLowerCase();
  var status = FLEET_MEMBER_STATUS.indexOf(opts.status) >= 0 ? opts.status : 'all';
  var sort = FLEET_MEMBER_SORTS.indexOf(opts.sort) >= 0 ? opts.sort : 'derived';
  var selectedId = text(opts.selectedId);
  var roster = team && Array.isArray(team.members) ? team.members : [];
  var tasks = team && Array.isArray(team.tasks) ? team.tasks : [];
  var cardById = {};
  (Array.isArray(cards) ? cards : []).forEach(function (card) { cardById[card.sessionId] = card; });
  var rawById = {};
  (Array.isArray(rawAgents) ? rawAgents : []).forEach(function (raw) {
    if (!isObject(raw)) return;
    var rawId = text(raw.sessionId) || text(raw.id);
    if (rawId !== '') rawById[rawId] = raw;
  });
  var entries = [];
  var used = {};
  roster.forEach(function (member, index) {
    if (!isObject(member)) return;
    var id = text(member.id);
    if (id === '') return;
    used[id] = true;
    entries.push({ member: member, card: cardById[id] || null, order: index, rosterIndex: index });
  });
  (Array.isArray(cards) ? cards : []).forEach(function (card, index) {
    if (!card || used[card.sessionId]) return;
    entries.push({ member: null, card: card, order: roster.length + index, rosterIndex: -1 });
  });
  var rows = entries.map(function (entry) {
    var member = entry.member;
    var card = entry.card;
    var id = member ? text(member.id) : (card ? card.sessionId : '');
    var phase = member ? text(member.phase) : (card ? text(card.phase) : '');
    var phaseKey = normalizedPhaseOf(phase);
    var running = card ? card.running === true : (phaseKey === 'active' || phaseKey === 'running');
    var statusKey = running ? 'running' : (phaseKey === 'done' || phaseKey === 'completed') ? 'done' : 'idle';

    var hue = member && member.role === 'lead' ? 'var(--ocean)'
      : card && typeof card.family === 'number' && card.family >= 0 ? fleetFamilyColor(card.family)
        : fleetFamilyColor(entry.rosterIndex >= 0 ? entry.rosterIndex : entry.order);
    var title = member ? (text(member.name) || (card ? card.title : id)) : (card ? card.title : id);
    var ownerName = title;
    var raw = rawById[id] || null;
    var tokens = raw && finiteNumber(raw.tokensTotal) ? num(raw.tokensTotal) : null;
    var steps = raw && finiteNumber(raw.steps) ? num(raw.steps) : null;
    var metaParts = [];
    if (tokens !== null) metaParts.push(formatCompact(tokens));
    if (card && card.activeText && card.activeText !== '—') metaParts.push(card.activeText);
    if (steps !== null) metaParts.push(formatCompact(steps) + ' ' + t('步'));
    var answerText = raw ? text(raw.lastAnswer).replace(/\s+/g, ' ').trim() : '';
    if (answerText.length > 180) answerText = answerText.slice(0, 179) + '…';
    var activeTasks = tasks.filter(function (task) {
      if (!isObject(task)) return false;
      var taskOwner = text(task.ownerName) || text(task.ownerId);
      if (taskOwner !== id && taskOwner !== ownerName) return false;
      var taskStatus = text(task.status).toLowerCase();
      return taskStatus === 'in_progress' || taskStatus === 'inprogress' || taskStatus === 'active' || taskStatus === 'running';
    }).length;
    return {
      key: 'member-' + id,
      id: id,
      title: title,
      hue: hue,
      kind: member ? (member.role === 'lead' ? 'lead' : 'teammate') : 'agent',
      roleText: member ? t(member.role === 'lead' ? '主导' : '成员') : t('Agent'),
      isCurrent: card ? card.isCurrent === true : false,
      running: running,
      // DSH's member-board dot marks live/provisioning/error only; finished or inactive
      // roster members use the same quiet idle dot instead of inheriting graph completion.
      stateKind: running || phaseKey === 'provisioning' ? 'running' : phaseKey === 'failed' ? 'failed' : 'idle',
      statusKey: statusKey,
      statusText: running ? t('运行中') : phaseKey === 'done' || phaseKey === 'completed' ? t('已完成') : phaseKey === 'failed' ? t('失败') : phaseKey === 'waiting' || phaseKey === 'pending' ? t('准备中') : t('未运行'),
      model: raw ? text(raw.model) : '',
      answerLabel: t('最新回报'),
      answerText: answerText,
      error: member && text(member.error) ? text(member.error) : '',
      selected: selectedId !== '' && id === selectedId,
      tasksCount: activeTasks,
      tasksText: activeTasks > 0 ? t('{n} 项进行中任务', { n: formatCompact(activeTasks) }) : t('无进行中任务'),
      metaText: metaParts.join(' · '),
      stepsValue: steps === null ? 0 : steps,
      tokensValue: tokens === null ? 0 : tokens,
      lastActive: raw && finiteNumber(raw.createdAt) ? num(raw.createdAt) : 0,
      openable: card ? !card.isCurrent : false
    };
  });
  var counts = { all: rows.length, running: 0, done: 0, idle: 0 };
  rows.forEach(function (row) { counts[row.statusKey] += 1; });
  var filtered = rows.filter(function (row) {
    if (query !== '' && row.title.toLocaleLowerCase().indexOf(query) < 0) return false;
    return status === 'all' || row.statusKey === status;
  });
  filtered.sort(function (left, right) {
    if (sort === 'context') return right.tokensValue - left.tokensValue;
    if (sort === 'duration') return (right.lastActive - left.lastActive) || 0;
    if (sort === 'steps') return right.stepsValue - left.stepsValue;
    if (sort === 'latest') return right.lastActive - left.lastActive;
    return 0;
  });
  var statusChips = [
    { key: 'all', label: t('全部') },
    { key: 'running', label: t('运行中') },
    { key: 'done', label: t('已完成') },
    { key: 'idle', label: t('空闲') }
  ].map(function (chip) {
    return { key: chip.key, label: chip.label, countText: formatCompact(counts[chip.key]), active: chip.key === status };
  });
  var sortChips = [
    { key: 'derived', label: t('派生顺序') },
    { key: 'context', label: t('上下文用量') },
    { key: 'duration', label: t('最近活跃') },
    { key: 'steps', label: t('步数') }
  ].map(function (chip) { return { key: chip.key, label: chip.label, active: chip.key === sort }; });
  var teamRows = filtered.filter(function (row) { return row.kind !== 'agent'; });
  var agentRows = filtered.filter(function (row) { return row.kind === 'agent'; });
  var groups = [];
  if (teamRows.length) groups.push({ key: 'team', title: t('团队成员'), countText: formatCompact(teamRows.length), rows: teamRows });
  if (agentRows.length) groups.push({ key: 'agents', title: t('其他 Agent'), countText: formatCompact(agentRows.length), rows: agentRows });
  var sortIndex = 0;
  for (var sortIndexOf = 0; sortIndexOf < sortChips.length; sortIndexOf++) {
    if (sortChips[sortIndexOf].key === sort) { sortIndex = sortIndexOf; break; }
  }
  return {
    rows: filtered,
    groups: groups,
    total: rows.length,
    countText: t('{n} 个 Agent', { n: formatCompact(rows.length) }),
    query: opts.query || '',
    status: status,
    sort: sort,
    statusChips: statusChips,
    sortOptions: sortChips,
    sortLabel: sortChips[sortIndex].label,
    empty: rows.length === 0,
    noMatches: filtered.length === 0 && rows.length > 0,
    soloHint: rows.length <= 1 ? t('还没有可列出的成员 — 通过 subagent 工具委派任务后，它们会在这里列出') : '',
    toolbar: rows.length > 1 || query !== '' || status !== 'all',
    failure: team && text(team.failure) ? text(team.failure) : ''
  };
}

/**
 * 把 store 的 `sessionState.contextFleet` 转成「编队」面板视图模型。/**
 * 把 store 的 `sessionState.contextFleet` 转成「编队」面板视图模型。
 *
 * @param {object|null} fleet { loading, error, code, unsupported, asOfSeq, value }
 * @param {object} [options] { t, connected, hasSession }
 * @returns {object} { status: loading|disconnected|empty|unsupported|error|ready, overview, agents }
 */

/* 用会话列表补全编队家族：部分 DSH 版本的 context-fleet 投影拿不到子 Agent
   血缘，但会话列表帧带着 parentSessionId/origin。补齐缺失成员，已有成员不动。 */
function augmentFleetWithSessions(value, sessions, sessionId) {
  if (!isObject(value) || !Array.isArray(sessions) || !sessions.length) return value;
  var byId = {}, parentOf = {};
  sessions.forEach(function (s) {
    if (!isObject(s)) return;
    var id = text(s.sessionId) || text(s.id);
    if (id === '') return;
    byId[id] = s;
    parentOf[id] = text(s.parentSessionId) || text(s.parentSession);
  });
  var current = text(sessionId) || text(value.currentSessionId);
  if (current === '' || !byId[current]) return value;
  var root = current, guard = 0;
  while (text(byId[root].origin) === 'subagent' && parentOf[root] && byId[parentOf[root]] && guard++ < 64) root = parentOf[root];
  var family = {}, changed = true, rounds = 0;
  family[root] = 0;
  while (changed && rounds++ < 64) {
    changed = false;
    for (var id in byId) {
      if (!Object.prototype.hasOwnProperty.call(byId, id)) continue;
      var parent = parentOf[id];
      if (!parent || !Object.prototype.hasOwnProperty.call(family, parent)) continue;
      if (Object.prototype.hasOwnProperty.call(family, id)) continue;
      var origin = text(byId[id].origin);
      if (origin !== 'subagent') continue;   // Match DSH familyParentOf: only subagent-origin edges form a family.
      family[id] = family[parent] + 1;
      changed = true;
    }
  }
  var agents = Array.isArray(value.agents) ? value.agents.slice() : [], known = {}, added = false;
  agents.forEach(function (a) { if (isObject(a) && text(a.sessionId)) known[text(a.sessionId)] = true; });
  Object.keys(family).forEach(function (id) {
    if (known[id]) return;
    var s = byId[id];
    var isRunning = s.running === true;
    agents.push({
      sessionId: id,
      title: text(s.title) || text(s.projections && s.projections.values && s.projections.values.title) || id,
      depth: family[id],
      isCurrent: id === current,
      isRoot: id === root,
      running: isRunning,
      phase: text(s.phase),
      composition: isObject(s.composition) ? s.composition : null,
      pressureTokens: finiteNumber(s.pressureTokens) ? num(s.pressureTokens) : undefined,
      contextWindow: finiteNumber(s.contextWindow) ? num(s.contextWindow) : undefined,
      tokensTotal: finiteNumber(s.tokensTotal) ? num(s.tokensTotal) : undefined,
      steps: finiteNumber(s.steps) ? num(s.steps) : undefined,
      activeMs: finiteNumber(s.activeMs) ? num(s.activeMs) : undefined,
      completed: s.completed === true
    });
    known[id] = true;
    added = true;
  });
  if (!added) return value;
  var running = 0, subagents = 0;
  agents.forEach(function (a) {
    if (!isObject(a)) return;
    if (a.running === true) running += 1;
    if (text(a.origin) === 'subagent' || Number(a.depth) > 0) subagents += 1;
  });
  return {
    agents: agents,
    counts: { agents: agents.length, running: running, subagents: subagents },
    rootSessionId: text(value.rootSessionId) || root,
    currentSessionId: current,
    team: isObject(value.team) ? value.team : null,
    asOfSeq: value.asOfSeq
  };
}

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
  // 网关投影拿不到子 Agent 血缘时，用会话列表补齐（不影响已有成员的用量字段）。
  if (value !== null && Array.isArray(opts.familySessions) && opts.familySessions.length) {
    value = augmentFleetWithSessions(value, opts.familySessions, opts.sessionId);
  }
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
    var familyById = {};
    buildFleetTree(rawAgents).nodes.forEach(function (node) { familyById[node.id] = node.family; });
    var cards = [];
    rawAgents.forEach(function (raw) {
      var card = fleetAgentCard(raw, rootSessionId, currentSessionId, t, membersById);
      if (card) {
        card.family = finiteNumber(familyById[card.sessionId]) ? familyById[card.sessionId] : -1;
        cards.push(card);
      }
    });
    cards.forEach(function (card, index) {
      var depth = Math.min(card.depth, FLEET_MAX_INDENT_DEPTH);
      card.hasBranch = card.depth > 0;
      card.branchStyle = 'left:' + Math.max(0, depth * FLEET_INDENT_RPX - 12) + 'rpx;';
      var continuesAtDepth = cards.slice(index + 1).some(function (next) { return next.depth >= card.depth; });
      card.branchLineStyle = 'top:-18rpx;bottom:' + (continuesAtDepth ? '0' : '50%') + ';';
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
    var cardById = {};
    cards.forEach(function (card) { cardById[card.sessionId] = card; });
    var graph = layoutFleetGraph(rawAgents, opts.stageWidth, {
      currentSessionId: currentSessionId,
      selectedId: opts.selectedId,
      cardOf: function (id) { return cardById[id] || null; },
      t: t
    });
    var overview = deriveFleetOverview(rawAgents, cards);
    var agentById = {};
    rawAgents.forEach(function (agent) { if (agent && text(agent.sessionId)) agentById[text(agent.sessionId)] = agent; });
    var teamInfo = deriveFleetTeam(team, cards, t, agentById, { query: opts.taskQuery, status: opts.taskStatus });
    var doneCount = cards.filter(function (card) { return card.completed === true; }).length;
    var hasTeam = teamInfo.teamTaskCount > 0;
    var progressTotal = hasTeam ? teamInfo.teamTaskCount : overview.subagents;
    var progressDone = hasTeam
      ? teamInfo.teamTasks.filter(function (task) { return task.statusClass === 'done'; }).length
      : doneCount;
    var progressFraction = progressTotal > 0 ? Math.min(1, progressDone / progressTotal) : 0;
    var summaryChips = [
      { key: 'agents', text: t('{n} 个 Agent', { n: overview.agentsText }) },
      { key: 'running', text: t('{n} 个运行中', { n: overview.runningText }), on: overview.running > 0 }
    ];
    if (overview.subagents > 0) summaryChips.push({ key: 'done', text: t('{n} 已完成', { n: formatCompact(doneCount) }) });
    if (overview.tokensTotal > 0) summaryChips.push({ key: 'context', text: t('上下文合计 {n}', { n: overview.tokensText }) });
    var summary = {
      chips: summaryChips,
      progress: progressTotal > 0 ? {
        label: hasTeam ? t('任务进度') : t('子智能体进度'),
        done: progressDone,
        total: progressTotal,
        width: Math.round(progressFraction * 100),
        complete: progressTotal > 0 && progressDone >= progressTotal,
        text: progressDone + '/' + progressTotal
      } : null
    };
    var legend = CATEGORY_KEYS.map(function (key) {
      return { key: key, label: t(CATEGORY_LABELS[key]), swatch: 'ctx-c-' + key };
    }).concat([
      { key: 'free', label: t('空闲窗口'), free: true },
      { key: 'live', label: t('运行中'), live: true }
    ]);
    var agentChips = [
      { key: 'agents', text: t('{n} 个 Agent', { n: overview.agentsText }) },
      { key: 'running', text: t('{n} 个运行中', { n: overview.runningText }), on: overview.running > 0 },
      { key: 'context', text: t('上下文合计 {n}', { n: overview.tokensText }), hidden: overview.tokensTotal <= 0 },
      { key: 'team', text: hasTeam ? t('团队 · {m} 成员 · {n} 任务', { m: formatCompact((team && Array.isArray(team.members) ? team.members.length : 0)), n: teamInfo.teamTaskCount }) : '', hidden: !hasTeam, brand: true }
    ];
    // 通讯扫描的名册：rc.3 send_message 用成员名，宿主据此解析会话 id；
    // 没有 team roster 时用家族标题兜底，至少让路由显示可读名称。
    var commsMembers = [];
    var memberNameById = {};
    var seenCommsMember = {};
    if (team && Array.isArray(team.members)) {
      team.members.forEach(function (member) {
        if (!isObject(member)) return;
        var memberId = text(member.id);
        var memberName = text(member.name);
        if (memberId === '' || memberName === '' || seenCommsMember[memberId]) return;
        seenCommsMember[memberId] = true;
        memberNameById[memberId] = memberName;
        commsMembers.push({ id: memberId, name: memberName });
      });
    }
    cards.forEach(function (card) {
      if (!card || seenCommsMember[card.sessionId]) return;
      seenCommsMember[card.sessionId] = true;
      commsMembers.push({ id: card.sessionId, name: card.title });
    });
    return {
      status: 'ready',
      loading: fleet.loading === true,
      running: opts.running === true,
      errorText: '',
      stateText: '',
      hintText: '',
      asOfSeq: asOfSeq,
      overview: overview,
      summary: summary,
      graph: graph,
      legend: legend,
      commsMembers: commsMembers,
      members: deriveFleetMembers(cards, rawAgents, team, { t: t, query: opts.memberQuery, status: opts.memberStatus, sort: opts.memberSort, selectedId: opts.selectedId }),
      comms: deriveFleetComms(cards, opts.commsValue, { t: t, filter: opts.commsFilter, stale: opts.commsStale, memberNames: memberNameById }),
      agentChips: agentChips.filter(function (chip) { return chip.hidden !== true; }),
      soloHint: cards.length <= 1 ? t('还没有子 Agent —— 当 Agent 通过 subagent 工具委派任务时，协作网络会在这里展开') : '',
      agents: cards,
      subagentHint: cards.length <= 1
        ? t('还没有子 Agent —— 当 Agent 通过 subagent 工具委派任务时，协作网络会在这里展开')
        : '',
      team: teamInfo
    };
  } catch (error) {
    var broken = emptyFleetPanel('error', '');
    broken.errorText = t('编队数据格式异常');
    return broken;
  }
}

/* Agent Teams tasks and unrostered family sessions share DSH's task-board filters. */
function filterFleetTasks(tasks, t, query, status) {
  var q = text(query).toLowerCase(), st = text(status);
  if (st === 'all') st = '';
  var keys = ['all', 'in_progress', 'pending', 'done'];
  var labels = { all: '全部', in_progress: '进行中', pending: '待处理', done: '已完成' };
  var filterKey = function (task) { return task.statusClass === 'active' ? 'in_progress' : task.statusClass === 'done' ? 'done' : 'pending'; };
  var chips = keys.map(function (key) {
    return { key: key, label: t(labels[key]), count: key === 'all' ? tasks.length : tasks.filter(function (task) { return filterKey(task) === key; }).length, active: st === (key === 'all' ? '' : key) };
  });
  return { chips: chips, visible: tasks.filter(function (task) {
    return (st === '' || filterKey(task) === st) && (!q || (task.subject + ' ' + task.bodyText + ' ' + text(task.ownerText)).toLowerCase().indexOf(q) >= 0);
  }) };
}

function deriveFleetTeam(team, cards, t, agentById, options) {
  var opts2 = isObject(options) ? options : {}, byId = isObject(agentById) ? agentById : {};
  var roster = {}, query = text(opts2.query).toLowerCase(), status = text(opts2.status);
  if (team && Array.isArray(team.members)) team.members.forEach(function (member) {
    if (isObject(member)) roster[text(member.id) || text(member.sessionId)] = true;
  });
  var teamTasks = (team && Array.isArray(team.tasks) ? team.tasks : []).filter(isObject).slice(0, MAX_TEAM_TASKS).map(function (task, index) {
    var state = taskStatusOf(task.status, t), ownerId = text(task.ownerId), agent = byId[ownerId];
    return {
      key: 'task-' + (text(task.id) || index), kind: 'team',
      subject: text(task.subject) || text(task.title) || t('任务'),
      bodyText: text(task.body) || text(task.prompt) || text(task.description),
      statusText: state.statusText, statusClass: state.statusClass, ownerText: text(task.ownerName),
      metaText: agent ? [agent.tokensText, agent.metaText].filter(Boolean).join(' · ') : '',
      hue: fleetFamilyColor(index),
      stateKind: state.statusClass === 'active' ? 'running' : state.statusClass === 'done' ? 'done' : state.statusClass === 'failed' ? 'failed' : 'idle'
    };
  });
  var agentTasks = (Array.isArray(cards) ? cards : []).filter(function (card) { return card && !card.isCurrent && !roster[card.sessionId]; }).map(function (card) {
    var raw = byId[card.sessionId] || {}, state = taskStatusOf(card.running ? 'in_progress' : card.completed ? 'completed' : 'pending', t);
    return {
      key: 'agent-' + card.sessionId, kind: 'agent', subject: card.title,
      bodyText: text(raw.initialPrompt) || text(raw.prompt) || text(card.lastAnswer),
      statusText: state.statusText, statusClass: state.statusClass, ownerText: '', modelText: text(raw.model),
      metaText: [card.tokensText !== '—' && card.tokensText, card.activeText !== '—' && card.activeText, card.stepsText !== '—' && card.stepsText + ' ' + t('步')].filter(Boolean).join(' · '),
      hue: fleetFamilyColor(card.family), stateKind: card.running ? 'running' : card.completed ? 'done' : 'idle'
    };
  });
  var tasks = teamTasks.concat(agentTasks), filtered = filterFleetTasks(tasks, t, query, status);
  return {
    hasTeam: !!team, tasks: filtered.visible, teamTasks: teamTasks, teamTaskCount: teamTasks.length,
    statusChips: filtered.chips, query: text(opts2.query), tasksEmpty: !filtered.visible.length,
    tasksEmptyText: query || (status && status !== 'all') ? t('没有匹配的任务') : t('暂无任务，可以通过对话创建'),
    taskCountText: tasks.length ? formatCompact(tasks.length) : '', failure: team ? text(team.failure) : '', label: t('任务')
  };
}

module.exports = {
  augmentFleetWithSessions: augmentFleetWithSessions,
  CATEGORY_KEYS: CATEGORY_KEYS,
  CATEGORY_LABELS: CATEGORY_LABELS,
  // 趋势几何常量：测试用它核对与 dsh-context trendWindow/trendChart 的一致性。
  TREND_BAR_W: TREND_BAR_W,
  TREND_BAR_GAP: TREND_BAR_GAP,
  TREND_BAR_PITCH: TREND_BAR_PITCH,
  TREND_CHART_H: TREND_CHART_H,
  TREND_TOP_PAD: TREND_TOP_PAD,
  TREND_CHART_BOX: TREND_CHART_BOX,
  DURATION_CORE_W: DURATION_CORE_W,
  DURATION_HALO_W: DURATION_HALO_W,
  DURATION_DOT_W: DURATION_DOT_W,
  DURATION_DOT_CORE: DURATION_DOT_CORE,
  OVERVIEW_PANE_FALLBACK_RPX: OVERVIEW_PANE_FALLBACK_RPX,
  TREND_STEP_FLAG_EVERY: TREND_STEP_FLAG_EVERY,
  TREND_RISE_CAP: TREND_RISE_CAP,
  TREND_WINDOW_MIN: TREND_WINDOW_MIN,
  TREND_WINDOW_OVERSCAN: TREND_WINDOW_OVERSCAN,
  TREND_WINDOW_HYSTERESIS: TREND_WINDOW_HYSTERESIS,
  MAX_FLEET_AGENTS: MAX_FLEET_AGENTS,
  FLEET_CARD_H: FLEET_CARD_H,
  FLEET_LEVEL_H: FLEET_LEVEL_H,
  FLEET_SLOT_MAX: FLEET_SLOT_MAX,
  FLEET_SLOT_MIN: FLEET_SLOT_MIN,
  fleetFamilyColor: fleetFamilyColor,
  layoutFleetGraph: layoutFleetGraph,
  deriveFleetMembers: deriveFleetMembers,
  deriveFleetComms: deriveFleetComms,
  deriveCommands: deriveCommands,
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
  deriveTrendSelection: deriveTrendSelection,
  deriveBrowser: deriveBrowser,
  deriveEvents: deriveEvents,
  deriveFileActivity: deriveFileActivity,
  hasContextShape: hasContextShape,
  buildPanel: buildPanel,
  buildFleetPanel: buildFleetPanel
};
