// Pure view-model helpers for the cross-session Context Insights page.
const CATEGORY_KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'output'];
const SESSION_RING_KEYS = CATEGORY_KEYS.filter((key) => key !== 'output');
const SESSION_RING_COLORS = {
  system: 'var(--ins-session-c-blue)',
  tools: 'var(--ins-session-c-orange)',
  user: 'var(--ins-session-c-green)',
  inject: 'var(--ins-session-c-light-blue)',
  skill: 'var(--ins-session-c-amber)',
  assistant: 'var(--ins-session-c-blue)',
  tool: 'var(--ins-session-c-deep-green)'
};
const CATEGORY_LABELS = { system: '系统提示词', tools: '工具定义', user: '用户消息', inject: '注入内容', skill: '技能注入', assistant: '助手消息', tool: '工具结果', output: '输出' };
const SKILL_COLORS = ['#2B7FFF', '#00C950', '#AD46FF', '#FF6900', '#00BBA7', '#F6339A', '#615FFF', '#FE9A00'];
const RANGES = ['today', 7, 30, 0]; // 0 = all
const PAGE_SIZE = 12;

function num(value) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function compact(value) {
  const n = num(value);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

function duration(ms) {
  const value = num(ms);
  if (value <= 0) return '—';
  if (value < 1000) return Math.round(value) + 'ms';
  if (value < 60000) return (value / 1000).toFixed(1) + 's';
  const totalSec = Math.floor(value / 1000);
  const minutes = Math.floor(totalSec / 60);
  if (value < 3600000) return minutes + 'm' + (totalSec % 60) + 's';
  return Math.floor(minutes / 60) + 'h' + (minutes % 60) + 'm';
}

function relativeAge(ms, now, t) {
  if (num(ms) <= 0) return '—';
  const age = Math.max(0, num(now) - num(ms));
  if (age < 60000) return t('刚刚');
  if (age < 3600000) return t('{n} 分钟前', { n: Math.floor(age / 60000) });
  if (age < 86400000) return t('{n} 小时前', { n: Math.floor(age / 3600000) });
  if (age < 30 * 86400000) return t('{n} 天前', { n: Math.floor(age / 86400000) });
  return dayKeyOf(ms);
}

function percent(part, total) {
  const p = num(part);
  const t = num(total);
  if (t <= 0) return '—';
  if (p <= 0) return '0.0%';
  const pct = Math.min(1, p / t) * 100;
  if (pct < 0.1) return '<0.1%';
  return pct.toFixed(1) + '%';
}

function text(value) { return typeof value === 'string' ? value : ''; }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function skillColor(name) {
  let hash = 5381;
  for (let index = 0; index < name.length; index += 1) hash = ((hash << 5) + hash + name.charCodeAt(index)) >>> 0;
  return SKILL_COLORS[hash % SKILL_COLORS.length];
}

// Known discovery sources localize (dsh-context overviewSkills.ts); other values display raw.
function skillSourceLabel(source, t) {
  const value = text(source);
  if (value === 'project-dsh' || value === 'project-agents' || value === 'project') return t('项目');
  if (value === 'user-dsh' || value === 'user-agents' || value === 'user') return t('用户');
  if (value === 'bundled') return t('内置');
  return value;
}

// dsh-context's donut dims every other slice while a legend row is hovered; the
// touch equivalent keeps those states on a tapped row. `focusStyle` overlays a
// colored rim on the conic-gradient ring because box-shadow follows its radius.
const TIMING_COLOR_VARS = {
  ttft: 'var(--ins-time-ttft)',
  reasoning: 'var(--ins-time-reasoning)',
  text: 'var(--ins-time-text)',
  'tool-args': 'var(--ins-time-tool-args)',
  tools: 'var(--ins-time-tools)',
  other: 'var(--ins-time-other)'
};

function withRingFocus(ring, focusKey, kind) {
  const source = isObject(ring) ? ring : {};
  const key = text(focusKey);
  const mark = (row) => ({
    ...row,
    focused: key !== '' && text(row && row.key) === key,
    focusDim: key !== '' && text(row && row.key) !== key
  });
  const next = { ...source, rows: (Array.isArray(source.rows) ? source.rows : []).map(mark) };
  if (Array.isArray(source.visibleRows)) next.visibleRows = source.visibleRows.map(mark);
  const color = kind === 'timing'
    ? TIMING_COLOR_VARS[key]
    : (key !== '' ? 'var(--ctx-c-' + key + ')' : '');
  const style = text(source.style);
  if (key !== '' && color && style) next.focusStyle = style + ';box-shadow:inset 0 0 0 4rpx ' + color;
  return next;
}

function dayKeyOf(ms) {
  const date = new Date(num(ms));
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (v) => (v < 10 ? '0' + v : String(v));
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function localMidnight(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function rangeStart(range, now) {
  if (range === 'today') return localMidnight(now);
  if (Number(range) > 0) {
    const date = new Date(localMidnight(now));
    date.setDate(date.getDate() - (Number(range) - 1));
    return date.getTime();
  }
  return 0;
}

function sessionInRange(session, range, now, customRange) {
  if (customRange) {
    const from = Date.parse(customRange.from + 'T00:00:00');
    const to = Date.parse(customRange.to + 'T23:59:59');
    if ((num(session.lastActive) >= from && num(session.lastActive) <= to)
      || (num(session.createdAt) >= from && num(session.createdAt) <= to)) return true;
    const byDay = isObject(session.days) ? session.days : {};
    return Object.keys(byDay).some((key) => key >= customRange.from && key <= customRange.to
      && (num(byDay[key].tokens) > 0 || num(byDay[key].requests) > 0));
  }
  if (range === 0 || range === '0') return true;
  const floor = rangeStart(range, now);
  if (num(session.lastActive) >= floor || num(session.createdAt) >= floor) return true;
  const byDay = isObject(session.days) ? session.days : {};
  return Object.keys(byDay).some((key) => Date.parse(key + 'T00:00:00') >= floor && (range !== 'today' || key <= dayKeyOf(now))
    && (num(byDay[key].tokens) > 0 || num(byDay[key].requests) > 0));
}

function dailyChart(days) {
  const list = Array.isArray(days) ? days.slice(-7) : [];
  const max = list.reduce((best, item) => Math.max(best, num(item && item.tokens)), 0);
  const maxCost = list.reduce((best, item) => Math.max(best, num(item && item.costUsd)), 0);
  return list.map((item, index) => {
    const tokens = num(item && item.tokens);
    const date = new Date(num(item && item.time) || Date.parse((item && item.day) + 'T00:00:00'));
    return {
      key: 'day-' + index,
      day: text(item && item.day),
      label: text(item && item.day).slice(5) || (Number.isFinite(date.getTime()) ? String(date.getDate()) : ''),
      tokensText: tokens > 0 ? compact(tokens) : '',
      costText: costText(item && item.costUsd, item && item.currency),
      ariaLabel: text(item && item.day) + ' · ' + compact(tokens) + ' token · ' + costText(item && item.costUsd, item && item.currency),
      height: max > 0 && tokens > 0 ? Math.max(4, Math.round((tokens / max) * 100)) : 0,
      costHeight: maxCost > 0 && item && item.costUsd !== null && item.costUsd !== undefined
        ? Math.max(4, Math.round((Number(item.costUsd) / maxCost) * 100)) : 0
    };
  });
}

function heatmap(days, metric, now, selectedDay, locale) {
  const source = new Map((Array.isArray(days) ? days : []).map((item) => [text(item && item.day), item]));
  const today = localMidnight(now);
  const todayDate = new Date(today);
  const lastSunday = new Date(today);
  lastSunday.setDate(lastSunday.getDate() - todayDate.getDay());
  const firstSunday = new Date(lastSunday);
  firstSunday.setDate(firstSunday.getDate() - 49);
  const cells = [];
  for (let index = 0; index < 56; index += 1) {
    const date = new Date(firstSunday);
    date.setDate(date.getDate() + index);
    const time = localMidnight(date.getTime());
    const key = dayKeyOf(time);
    const entry = source.get(key) || {};
    const sessions = num(entry.sessions);
    const tokens = num(entry.tokens);
    cells.push({
      key: 'heat-' + index,
      day: key,
      tokens,
      sessions,
      available: tokens > 0 || sessions > 0,
      ariaLabel: key + ' · ' + sessions + ' 个活跃会话 · ' + compact(tokens) + ' token',
      value: metric === 'sessions' ? sessions : tokens,
      selected: key === selectedDay,
      future: time > today
    });
  }
  const max = cells.reduce((best, cell) => Math.max(best, cell.value), 0);
  cells.forEach((cell) => {
    const ratio = max > 0 ? cell.value / max : 0;
    cell.level = cell.future || cell.value <= 0 ? 0 : ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
  });
  return {
    weeks: Array.from({ length: 8 }, (_, week) => {
      const weekCells = cells.slice(week * 7, week * 7 + 7);
      const first = weekCells[0] && weekCells[0].day;
      const last = weekCells[6] && weekCells[6].day;
      const opensMonth = week === 0 || (first && last && first.slice(0, 7) !== last.slice(0, 7))
        || (first && first.slice(-2) === '01');
      const month = last ? Number(last.slice(5, 7)) : 0;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return {
        key: 'week-' + week,
        monthLabel: opensMonth && month > 0 ? (locale === 'en' ? monthNames[month - 1] : month + '月') : '',
        cells: weekCells
      };
    }),
    weekdayLabels: locale === 'en' ? ['', 'M', '', 'W', '', 'F', ''] : ['', '一', '', '三', '', '五', ''],
    maxText: max > 0 ? compact(max) : '—',
    selectedDay: selectedDay || '',
    hasActivity: cells.some((cell) => !cell.future && cell.available)
  };
}

function weeklyTicks(days, currency) {
  const maxTokens = (Array.isArray(days) ? days : []).reduce((max, day) => Math.max(max, num(day && day.tokens)), 0);
  const maxCost = (Array.isArray(days) ? days : []).reduce((max, day) => Math.max(max, num(day && day.costUsd)), 0);
  const cost = (value) => maxCost <= 0 ? '—'
    : (currency === 'cny' ? '¥' : '$') + (value >= 1 ? value.toFixed(2) : value.toPrecision(2));
  return [100, 75, 50, 25, 0].map((share) => ({
    key: 'tick-' + share,
    tokens: compact(maxTokens * share / 100),
    cost: share === 0 && maxCost > 0 ? '0' : cost(maxCost * share / 100)
  }));
}

function compositionRing(composition, t) {
  const source = isObject(composition) ? composition : {};
  const total = CATEGORY_KEYS.reduce((sum, key) => sum + num(source[key]), 0);
  let acc = 0;
  const stops = [];
  const rows = CATEGORY_KEYS.map((key) => {
    const value = num(source[key]);
    if (value > 0 && total > 0) {
      const start = (acc / total) * 100;
      const end = ((acc + value) / total) * 100;
      stops.push('var(--ctx-c-' + key + ') ' + start.toFixed(2) + '% ' + end.toFixed(2) + '%');
      acc += value;
    }
    const valueText = (key === 'output' ? '' : '≈') + compact(value);
    return {
      key,
      label: t(CATEGORY_LABELS[key] || key),
      valueText,
      subText: key === 'output' ? valueText + ' · ' + t('含思考') : valueText,
      pctText: percent(value, total),
      dim: value <= 0
    };
  });
  return { available: stops.length > 0, style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '', rows, visibleRows: total > 0 ? rows.filter((row) => !row.dim) : [], totalText: compact(total) };
}

function currentRing(session) {
  const composition = isObject(session.composition) ? session.composition : {};
  // This card depicts current context only; lifetime generated output belongs in usage stats, not this ring.
  const total = SESSION_RING_KEYS.reduce((sum, key) => sum + num(composition[key]), 0);
  let acc = 0;
  const stops = [];
  SESSION_RING_KEYS.forEach((key) => {
    const value = num(composition[key]);
    if (value > 0 && total > 0) {
      const start = (acc / total) * 100;
      acc += value;
      stops.push(SESSION_RING_COLORS[key] + ' ' + start.toFixed(2) + '% ' + ((acc / total) * 100).toFixed(2) + '%');
    }
  });
  return { total, style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '' };
}

function timingRing(timing, t) {
  const ttftMs = num(timing.ttftMs);
  const reasoningMs = num(timing.reasoningMs);
  const textMs = num(timing.textMs);
  const toolArgMs = num(timing.toolArgMs);
  const toolsMs = num(timing.toolsMs);
  const total = num(timing.wallMs);
  const otherMs = Math.max(num(timing.timingOtherMs), total - ttftMs - reasoningMs - textMs - toolArgMs - toolsMs);
  const measuredParts = [
    { key: 'ttft', label: t('模型等待'), value: ttftMs, count: num(timing.waitCount), color: 'var(--ins-time-ttft)' },
    { key: 'reasoning', label: t('模型思考'), value: reasoningMs, count: num(timing.reasoningCount), color: 'var(--ins-time-reasoning)' },
    { key: 'text', label: t('模型回复'), value: textMs, count: num(timing.textCount), color: 'var(--ins-time-text)' },
    { key: 'tool-args', label: t('工具参数'), value: toolArgMs, count: num(timing.toolArgCount), color: 'var(--ins-time-tool-args)' },
    { key: 'tools', label: t('工具执行'), value: toolsMs, count: num(timing.toolCount), color: 'var(--ins-time-tools)' }
  ];
  // A gateway that only reports a session wall time has no timing breakdown;
  // render the honest empty note instead of a fabricated "其他开销 100%".
  const measuredTotalMs = measuredParts.reduce((sum, part) => sum + part.value, 0);
  if (measuredTotalMs <= 0) {
    return { totalText: duration(total), style: '', rows: [] };
  }
  let remaining = total;
  const parts = measuredParts.map((part) => {
    const ringValue = Math.min(part.value, remaining);
    remaining = Math.max(0, remaining - ringValue);
    return { ...part, ringValue };
  });
  parts.push({ key: 'other', label: t('其他开销'), value: otherMs, ringValue: remaining, count: 0, color: 'var(--ins-time-other)' });
  let offset = 0;
  const stops = [];
  parts.forEach((part) => {
    if (part.ringValue <= 0 || total <= 0) return;
    const start = offset / total * 100;
    offset += part.ringValue;
    stops.push(part.color + ' ' + start.toFixed(2) + '% ' + (offset / total * 100).toFixed(2) + '%');
  });
  const rows = parts.map((part) => {
    const countText = part.count > 0 ? compact(part.count) + ' ' + t('次') : '';
    const valueText = duration(part.value);
    return {
      ...part,
      valueText,
      countText,
      subText: valueText + (countText ? ' · ' + countText : ''),
      pctText: percent(part.ringValue, total),
      dim: part.value <= 0
    };
  });
  return {
    totalText: duration(total),
    style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '',
    rows: total > 0 ? rows.filter((row) => !row.dim || row.key === 'other') : []
  };
}

function sortSessions(sessions, sort) {
  const copy = sessions.slice();
  if (sort === 'tokens') copy.sort((a, b) => num(b.billedTokens) - num(a.billedTokens) || num(b.lastActive) - num(a.lastActive));
  else if (sort === 'context') copy.sort((a, b) => num(b.contextTokens !== undefined ? b.contextTokens : b.pressureTokens) - num(a.contextTokens !== undefined ? a.contextTokens : a.pressureTokens) || num(b.lastActive) - num(a.lastActive));
  else copy.sort((a, b) => num(b.lastActive) - num(a.lastActive));
  return copy;
}

function emptyComposition() {
  const result = {};
  CATEGORY_KEYS.forEach((key) => { result[key] = 0; });
  return result;
}

function workspaceData(options, sessions) {
  const workspaces = Array.isArray(options.workspaces) ? options.workspaces : [];
  const groups = Object.create(null);
  const archived = new Set(Array.isArray(options.archivedSessionIds) ? options.archivedSessionIds : []);
  const titles = [];
  workspaces.forEach((workspace) => {
    if (!isObject(workspace)) return;
    const title = text(workspace.title || workspace.name || workspace.workspaceName);
    if (!title || !Array.isArray(workspace.sessionIds)) return;
    titles.push(title);
    workspace.sessionIds.forEach((id) => { if (typeof id === 'string' && groups[id] === undefined) groups[id] = title; });
  });
  return { groups, archived, titles };
}

function costText(usd, currency) {
  if (usd === null || usd === undefined || !Number.isFinite(Number(usd))) return '—';
  const amount = currency === 'cny' ? Number(usd) / 0.15 : Number(usd);
  return (currency === 'cny' ? '¥' : '$') + (amount >= 1 ? amount.toFixed(2) : amount.toPrecision(2));
}

function projectName(cwd) {
  const normalized = text(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized ? normalized.slice(normalized.lastIndexOf('/') + 1) : '';
}

/** Build a mobile-sized, filtered page; filters run before pagination and never mutate the wire payload. */
function deriveInsights(value, rangeDays, t, now, options) {
  const source = isObject(value) ? value : {};
  const today = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const range = RANGES.indexOf(rangeDays) >= 0 ? rangeDays : 7;
  const opts = options || {};
  const query = text(opts.query).trim().toLowerCase();
  const requestedCustom = isObject(opts.customRange) ? opts.customRange : null;
  const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && Number.isFinite(Date.parse(value + 'T00:00:00'));
  let customRange = requestedCustom && validDay(requestedCustom.from) && validDay(requestedCustom.to)
    ? { from: requestedCustom.from, to: requestedCustom.to } : null;
  if (customRange && customRange.from > customRange.to) customRange = { from: customRange.to, to: customRange.from };
  const selectedDay = text(opts.day);
  const selectedSkill = text(opts.skill);
  const sort = ['tokens', 'context'].includes(opts.sort) ? opts.sort : 'recent';
  const allSessions = (Array.isArray(source.sessions) ? source.sessions : []).filter(isObject);
  const workspace = workspaceData(opts, allSessions);
  const coverage = ['active', 'archived'].includes(opts.coverage) ? opts.coverage : 'all';
  const coveredSessions = allSessions.filter((session) => {
    const archived = workspace.archived.has(text(session.id)) || session.archived === true;
    return coverage === 'all' || archived === (coverage === 'archived');
  });
  const inRange = coveredSessions.filter((session) => sessionInRange(session, range, today, customRange));
  const dayScoped = inRange.filter((session) => {
    if (selectedDay) {
      const day = isObject(session.days) ? session.days[selectedDay] : null;
      if (!isObject(day) || (num(day.tokens) <= 0 && num(day.requests) <= 0)) return false;
    }
    if (!query) return true;
    return [session.title, session.id, session.model, session.provider, session.cwd, session.lastUser].some((item) => text(item).toLowerCase().includes(query));
  });
  const groupCounts = Object.create(null);
  let ungroupedCount = 0;
  dayScoped.forEach((session) => {
    const name = workspace.groups[text(session.id)];
    if (name === undefined) ungroupedCount += 1;
    else groupCounts[name] = (groupCounts[name] || 0) + 1;
  });
  const groupOptions = workspace.titles.filter((name, index) => workspace.titles.indexOf(name) === index
    && ((groupCounts[name] || 0) > 0 || opts.group === name))
    .map((name) => ({ key: name, label: name, count: groupCounts[name] || 0 }));
  if (ungroupedCount > 0 || opts.group === '__ungrouped__') groupOptions.push({ key: '__ungrouped__', label: '未分组', count: ungroupedCount });
  const listScoped = dayScoped.filter((session) => {
    const name = workspace.groups[text(session.id)];
    if (opts.group && (opts.group === '__ungrouped__' ? name !== undefined : name !== opts.group)) return false;
    if (selectedSkill && !(Array.isArray(session.skillNames) && session.skillNames.includes(selectedSkill))) return false;
    return true;
  });
  const visible = sortSessions(listScoped, sort);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(Math.floor(num(opts.page)), pageCount - 1));
  const knownTitles = isObject(opts.sessionTitles) ? opts.sessionTitles : {};
  const cards = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((session, index) => {
    const window = num(session.contextWindow);
    const pressure = num(session.pressureTokens);
    const ring = currentRing(session);
    const parts = CATEGORY_KEYS.filter((key) => key !== 'output').map((key) => ({
      key,
      width: num(session.composition && session.composition[key]) > 0 && pressure > 0
        ? Math.min(100, (num(session.composition[key]) / pressure) * 100) : 0
    })).filter((part) => part.width > 0);
    const contextTokens = typeof session.contextTokens === 'number' && Number.isFinite(session.contextTokens)
      ? Math.max(0, session.contextTokens) : pressure;
    const percentUsed = window > 0 ? contextTokens / window : 0;
    const archived = workspace.archived.has(text(session.id)) || session.archived === true;
    const group = workspace.groups[text(session.id)] || '';
    const project = projectName(session.cwd);
    // A workspace named after its own project shows the name once (overviewCard).
    const groupLabel = group !== '' && group !== project ? group : '';
    const activityDays = Object.keys(isObject(session.days) ? session.days : {}).sort();
    const createdDay = num(session.createdAt) > 0 ? dayKeyOf(session.createdAt) : activityDays[0] || '';
    return {
      key: 'session-' + page + '-' + index + '-' + text(session.id),
      id: text(session.id),
      // Legacy wires leave the title blank; the cached session list still
      // knows the task name, so the cards never fall back to a bare id.
      title: text(session.title) || text(knownTitles[text(session.id)]) || text(session.id),
      model: text(session.model),
      provider: text(session.provider),
      cwd: text(session.cwd),
      group: groupLabel,
      project,
      archived,
      running: session.running === true,
      current: session.current === true || text(opts.currentSessionId) === text(session.id),
      createdDay,
      createdText: createdDay,
      billedText: compact(session.billedTokens),
      inputText: compact(session.inputTokens),
      outputText: compact(session.outputTokens),
      cacheWriteText: compact(session.cacheWriteTokens),
      turnsText: compact(session.turns),
      stepsText: compact(session.steps),
      turnsStepsText: t('{n} 轮 {s} 步', { n: compact(session.turns), s: compact(session.steps) }),
      toolText: compact(session.toolCalls),
      activeText: duration(session.activeMs),
      parts,
      ringStyle: ring.style,
      ringTotalText: compact(ring.total),
      contextCenterText: compact(contextTokens),
      hasContextData: window > 0 || contextTokens > 0 || num(session.billedTokens) > 0,
      pctText: window > 0 ? percent(contextTokens, window) : '—',
      pctColor: percentUsed >= 0.9 ? '#FB2C36' : percentUsed >= 0.7 ? '#FE9A00' : '#00C950',
      contextText: window > 0 ? compact(pressure) + ' / ' + compact(window) : '',
      workspaceText: [group, projectName(session.cwd)].filter(Boolean).filter((name, partIndex, names) => names.indexOf(name) === partIndex).join(' / '),
      metaText: [text(session.model), text(session.provider)].filter(Boolean).join(' · '),
      lastMessage: text(session.lastUser),
      costText: costText(session.costUsd, opts.currency),
      updatedText: relativeAge(num(session.lastActive) || num(session.createdAt), today, t)
    };
  });
  const tokenFloor = customRange ? customRange.from : range === 0 ? null : dayKeyOf(rangeStart(range, today));
  const tokenCeiling = customRange ? customRange.to : dayKeyOf(today);
  const hasScopedTokenDays = tokenFloor !== null && inRange.some((session) => Object.keys(isObject(session.days) ? session.days : {})
    .some((key) => key >= tokenFloor && key <= tokenCeiling
      && (num(session.days[key].tokens) > 0 || num(session.days[key].requests) > 0
        || num(session.days[key].inputTokens) > 0 || num(session.days[key].outputTokens) > 0)));
  const hasScopedActivityDays = tokenFloor !== null && inRange.some((session) => Object.keys(isObject(session.days) ? session.days : {})
    .some((key) => key >= tokenFloor && key <= tokenCeiling
      && (num(session.days[key].turns) > 0 || num(session.days[key].toolCalls) > 0 || num(session.days[key].wallMs) > 0)));
  const hasScopedCostDays = tokenFloor !== null && inRange.some((session) => Object.keys(isObject(session.days) ? session.days : {})
    .some((key) => key >= tokenFloor && key <= tokenCeiling && session.days[key].costUsd !== undefined));
  const totals = inRange.reduce((sum, session) => {
    let billedInput = 0;
    let billedOutput = 0;
    if (tokenFloor === null || !hasScopedTokenDays) {
      sum.billedTokens += num(session.billedTokens);
      sum.inputTokens += num(session.inputTokens);
      sum.cacheReadTokens += num(session.cacheReadTokens);
      sum.cacheWriteTokens += num(session.cacheWriteTokens);
      sum.outputTokens += num(session.outputTokens);
      billedInput = num(session.inputTokens);
      billedOutput = num(session.outputTokens);
    } else {
      const days = isObject(session.days) ? session.days : {};
      Object.keys(days).forEach((key) => {
        if (key < tokenFloor || key > tokenCeiling) return;
        const daily = days[key];
        // Provider-billed days carry input (uncached + cache read/write) and output;
        // the request-total estimate is only a fallback for ledgers without them.
        const dailyBilled = (daily.inputTokens !== undefined || daily.outputTokens !== undefined)
          ? num(daily.inputTokens) + num(daily.outputTokens) : num(daily.tokens);
        sum.billedTokens += dailyBilled;
        sum.inputTokens += num(daily.inputTokens);
        sum.cacheReadTokens += num(daily.cacheReadTokens);
        sum.cacheWriteTokens += num(daily.cacheWriteTokens);
        sum.outputTokens += num(daily.outputTokens);
        billedInput += num(daily.inputTokens);
        billedOutput += num(daily.outputTokens);
      });
    }
    const timing = isObject(session.timing) ? session.timing : {};
    const timingWallMs = num(timing.wallMs) || num(session.activeMs);
    if (timingWallMs > 0) {
      sum.timingWallMs += timingWallMs;
      sum.ttftMs += num(timing.ttftMs);
      sum.reasoningMs += num(timing.reasoningMs);
      sum.textMs += num(timing.textMs);
      sum.toolArgMs += num(timing.toolArgMs);
      sum.timingToolsMs += num(timing.toolsMs) || num(session.toolMs);
      sum.timingOtherMs += num(timing.otherMs);
      sum.generationMs += num(timing.generationMs) || num(timing.reasoningMs) + num(timing.textMs) + num(timing.toolArgMs);
      sum.waitCount += num(timing.waitCount);
      sum.reasoningCount += num(timing.reasoningCount);
      sum.textCount += num(timing.textCount);
      sum.toolArgCount += num(timing.toolArgCount);
      sum.toolCount += num(timing.toolCount);
      sum.speedTokens += num(timing.speedTokens);
      sum.speedMs += num(timing.speedMs);
    }
    if (tokenFloor !== null && hasScopedActivityDays) {
      Object.keys(isObject(session.days) ? session.days : {}).forEach((key) => {
        if (key < tokenFloor || key > tokenCeiling) return;
        const daily = session.days[key];
        sum.turns += num(daily.turns);
        sum.steps += num(daily.requests);
        sum.toolCalls += num(daily.toolCalls);
        sum.toolsMs += num(daily.toolsMs);
        sum.wallMs += num(daily.wallMs);
      });
    } else {
      sum.turns += num(session.turns);
      sum.steps += num(session.steps);
      sum.toolCalls += num(session.toolCalls);
      sum.activeMs += num(session.activeMs);
      const sessionToolsMs = num(timing.toolsMs) || num(session.toolMs);
      const sessionWallMs = num(timing.wallMs) || num(session.activeMs);
      sum.toolsMs += sessionToolsMs;
      sum.wallMs += sessionWallMs;
    }
    let cost = session.costUsd;
    if (tokenFloor !== null && hasScopedCostDays) {
      cost = null;
      Object.keys(isObject(session.days) ? session.days : {}).forEach((key) => {
        if (key < tokenFloor || key > tokenCeiling) return;
        const dailyCost = session.days[key].costUsd;
        if (dailyCost !== null && dailyCost !== undefined && Number.isFinite(Number(dailyCost))) cost = (cost || 0) + Number(dailyCost);
      });
    }
    if (cost !== null && cost !== undefined && Number.isFinite(Number(cost))) {
      sum.costUsd += Number(cost);
      sum.costSessions += 1;
    }
    const promptKeys = CATEGORY_KEYS.filter((key) => key !== 'output');
    const composition = isObject(session.composition) ? session.composition : {};
    const rawTotal = promptKeys.reduce((total, key) => total + num(composition[key]), 0);
    let assigned = 0;
    let largestKey = promptKeys[0];
    promptKeys.forEach((key) => {
      const raw = num(composition[key]);
      if (raw > num(composition[largestKey])) largestKey = key;
      const value = rawTotal > 0 ? Math.round(billedInput * raw / rawTotal) : 0;
      sum.composition[key] += value;
      assigned += value;
    });
    if (rawTotal > 0) sum.composition[largestKey] += billedInput - assigned;
    sum.composition.output += billedOutput;
    return sum;
  }, { billedTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, turns: 0, steps: 0, toolCalls: 0, activeMs: 0, toolsMs: 0, timingToolsMs: 0, wallMs: 0, timingWallMs: 0, generationMs: 0, ttftMs: 0, reasoningMs: 0, textMs: 0, toolArgMs: 0, timingOtherMs: 0, waitCount: 0, reasoningCount: 0, textCount: 0, toolArgCount: 0, toolCount: 0, speedTokens: 0, speedMs: 0, costUsd: 0, costSessions: 0, composition: emptyComposition() });
  const cacheHit = totals.inputTokens > 0 ? totals.cacheReadTokens / totals.inputTokens * 100 : null;
  const cacheSessions = inRange.filter((session) => {
    if (tokenFloor === null) return num(session.inputTokens) > 0;
    return Object.keys(isObject(session.days) ? session.days : {}).some((key) => key >= tokenFloor && key <= tokenCeiling
      && num(session.days[key].inputTokens) > 0);
  }).length;
  // The 7-day chart and the 8-week heatmap always read a fixed local-day window
  // ending today (dsh-context overviewUsage/heatmap), independent of the picked
  // range; session day buckets win, the wire's daily ledger is the fallback.
  const allDays = (Array.isArray(source.days) ? source.days : []).filter(isObject);
  const wireDays = new Map(allDays.map((day) => [text(day.day), day]));
  const daySessionCount = Object.create(null);
  const dayTokens = Object.create(null);
  const dayCost = Object.create(null);
  coveredSessions.forEach((session) => {
    Object.keys(isObject(session.days) ? session.days : {}).forEach((key) => {
      const daily = session.days[key];
      dayTokens[key] = (dayTokens[key] || 0) + num(daily.tokens);
      if (num(daily.tokens) > 0 || num(daily.requests) > 0) daySessionCount[key] = (daySessionCount[key] || 0) + 1;
      if (daily.costUsd !== null && daily.costUsd !== undefined && Number.isFinite(Number(daily.costUsd))) {
        dayCost[key] = (dayCost[key] || 0) + Number(daily.costUsd);
      }
    });
  });
  const dayKeyWindow = [];
  const windowAnchor = new Date(localMidnight(today));
  for (let offset = 55; offset >= 0; offset -= 1) {
    const date = new Date(windowAnchor.getTime());
    date.setDate(date.getDate() - offset);
    dayKeyWindow.push(dayKeyOf(date.getTime()));
  }
  const enrichedDays = dayKeyWindow.map((key) => {
    const wire = wireDays.get(key) || {};
    const dailyCost = dayCost[key] === undefined ? wire.costUsd : dayCost[key];
    return {
      day: key,
      tokens: Object.prototype.hasOwnProperty.call(dayTokens, key) ? dayTokens[key] : num(wire.tokens),
      sessions: daySessionCount[key] || 0,
      costUsd: dailyCost === null || dailyCost === undefined || !Number.isFinite(Number(dailyCost)) ? null : Number(dailyCost),
      currency: opts.currency
    };
  });
  const weekly = dailyChart(enrichedDays.slice(-7));
  const weeklyTicksList = weeklyTicks(enrichedDays.slice(-7), opts.currency);
  const weeklyEmpty = !weekly.some((day) => num(day.height) > 0 || num(day.costHeight) > 0);
  const weeklyCostDays = enrichedDays.slice(-7).filter((day) => day.costUsd !== null && day.costUsd !== undefined);
  const weeklyCostText = weeklyCostDays.length
    ? costText(weeklyCostDays.reduce((sum, day) => sum + Number(day.costUsd), 0), opts.currency)
    : t('暂无可计价数据');
  const timingSummary = {
    wallMs: totals.timingWallMs,
    toolsMs: totals.timingToolsMs,
    generationMs: totals.generationMs,
    ttftMs: totals.ttftMs,
    reasoningMs: totals.reasoningMs,
    textMs: totals.textMs > 0 ? totals.textMs : Math.max(0, totals.generationMs - totals.reasoningMs - totals.toolArgMs),
    toolArgMs: totals.toolArgMs,
    timingOtherMs: totals.timingOtherMs,
    waitCount: totals.waitCount,
    reasoningCount: totals.reasoningCount,
    textCount: totals.textCount || totals.steps,
    toolArgCount: totals.toolArgCount,
    toolCount: totals.toolCount
  };
  const speedText = totals.speedMs > 0
    ? (totals.speedTokens / (totals.speedMs / 1000) >= 10
      ? String(Math.round(totals.speedTokens / (totals.speedMs / 1000)))
      : (totals.speedTokens / (totals.speedMs / 1000)).toFixed(1)) + ' tok/s'
    : '';
  const ring = compositionRing(totals.composition, t);
  const skillsByName = Object.create(null);
  coveredSessions.forEach((session) => {
    const loadedInSession = new Set();
    const days = isObject(session.days) ? session.days : {};
    Object.keys(days).forEach((key) => {
      if ((selectedDay && key !== selectedDay) || (tokenFloor !== null && (key < tokenFloor || key > tokenCeiling))) return;
      const skills = isObject(days[key].skills) ? days[key].skills : {};
      Object.keys(skills).forEach((name) => {
        const tally = skills[name];
        if (!isObject(tally)) return;
        const current = skillsByName[name] || (skillsByName[name] = { name, loads: 0, sessionDays: 0, last: '', lastTime: 0, selected: name === selectedSkill });
        current.loads += num(tally.loads);
        if (num(tally.last) > 0) {
          const lastDay = dayKeyOf(tally.last);
          if (lastDay > current.last) current.last = lastDay;
          current.lastTime = Math.max(current.lastTime, num(tally.last));
        }
        loadedInSession.add(name);
      });
    });
    loadedInSession.forEach((name) => { skillsByName[name].sessionDays += 1; });
  });
  // Older gateways only expose aggregate skill-day buckets.
  if (!Object.keys(skillsByName).length) {
    (Array.isArray(source.skillDays) ? source.skillDays : []).filter(isObject).forEach((day) => {
      const key = text(day.day);
      if ((selectedDay && key !== selectedDay) || (tokenFloor !== null && (key < tokenFloor || key > tokenCeiling))) return;
      (Array.isArray(day.skills) ? day.skills : []).forEach((skill) => {
        if (!isObject(skill) || !text(skill.name)) return;
        const current = skillsByName[skill.name] || (skillsByName[skill.name] = { name: skill.name, loads: 0, sessionDays: 0, last: '', lastTime: 0, selected: skill.name === selectedSkill });
        current.loads += num(skill.loads);
        current.sessionDays += num(skill.sessions);
        if (text(skill.lastDay) > current.last) current.last = text(skill.lastDay);
      });
    });
  }
  const catalog = Object.create(null);
  (Array.isArray(source.skillCatalog) ? source.skillCatalog : []).forEach((item) => {
    if (isObject(item) && text(item.name)) catalog[item.name] = item;
  });
  const skillSort = opts.skillSort === 'recent' ? 'recent' : 'loads';
  const skillQuery = text(opts.skillQuery).trim().toLowerCase();
  const allSkillStats = Object.keys(skillsByName).map((name) => {
    const info = catalog[name] || null;
    return { ...skillsByName[name], color: skillColor(name), info, infoSourceLabel: info ? skillSourceLabel(info.source, t) : '' };
  })
    .sort((a, b) => skillSort === 'recent' ? b.lastTime - a.lastTime || b.last.localeCompare(a.last) || b.loads - a.loads : b.loads - a.loads || a.name.localeCompare(b.name));
  const visibleSkillStats = allSkillStats.filter((skill) => !skillQuery || skill.name.toLowerCase().includes(skillQuery));
  const maxSkillLoads = allSkillStats.reduce((max, skill) => Math.max(max, skill.loads), 0);
  const skillLoads = visibleSkillStats.reduce((sum, skill) => sum + skill.loads, 0);
  const skillStats = visibleSkillStats.slice(0, 20);
  skillStats.forEach((skill) => {
    skill.width = maxSkillLoads > 0 ? Math.max(4, Math.round(skill.loads / maxSkillLoads * 100)) : 0;
    skill.loadText = compact(skill.loads);
    skill.sessionDaysText = compact(skill.sessionDays);
    if (skill.lastTime > 0) {
      skill.lastText = relativeAge(skill.lastTime, today, t);
    } else skill.lastText = skill.last;
  });
  const ranges = RANGES.map((days) => ({
    key: String(days),
    label: days === 'today' ? t('今天') : days === 0 ? t('全部') : t('近 {n} 天', { n: days }),
    active: customRange === null && days === range
  }));
  const coverageOptions = ['all', 'active', 'archived'].map((key) => ({ key, label: t(key === 'all' ? '全部会话' : key === 'active' ? '活跃会话' : '已归档'), active: coverage === key }));
  // 覆盖范围改成下拉框（对齐桌面端右上角的「全部会话（显示已归档）」），
  // 所以除了选项列表还要给出当前下标和当前文案。
  const coverageIndex = Math.max(0, coverageOptions.findIndex((item) => item.active));
  const coverageLabel = coverage === 'archived'
    ? t('全部会话（显示已归档）')
    : (coverageOptions[coverageIndex] || coverageOptions[0]).label;
  const sessionsLabel = coverage === 'archived' ? t('已归档会话') : coverage === 'active' ? t('活跃会话') : t('全部会话');
  const sessionsSub = coverage === 'all'
    ? t('含归档 {n} 个', { n: inRange.filter((session) => workspace.archived.has(text(session.id)) || session.archived === true).length })
    : t('总计 {n} 个', { n: allSessions.length });
  return {
    hasData: allSessions.length > 0,
    empty: allSessions.length === 0,
    truncated: source.sessionsTruncated === true,
    range,
    customRange: customRange || { from: '', to: '' },
    customRangeActive: customRange !== null,
    ranges,
    query: text(opts.query),
    sort,
    sortOptions: [
      { key: 'recent', label: t('最近活跃'), active: sort === 'recent' },
      { key: 'tokens', label: t('Token 用量'), active: sort === 'tokens' },
      { key: 'context', label: t('上下文占用'), active: sort === 'context' }
    ],
    selectedDay,
    selectedDayText: selectedDay ? t('{day} 当日活跃', { day: selectedDay }) : '',
    selectedSkill,
    selectedSkillText: selectedSkill ? t('技能：{name}', { name: selectedSkill }) : '',
    coverage,
    coverageOptions,
    coverageIndex,
    coverageLabel,
    group: text(opts.group),
    groupOptions: groupOptions.map((item) => ({ ...item, active: item.key === opts.group })),
    allGroupCount: dayScoped.length,
    skillSort,
    skillSortVisible: allSkillStats.length > 1,
    metric: opts.metric === 'sessions' ? 'sessions' : 'tokens',
    metrics: [
      { key: 'tokens', label: t('Token'), active: opts.metric !== 'sessions' },
      { key: 'sessions', label: t('会话'), active: opts.metric === 'sessions' }
    ],
    kpi: [
      { key: 'sessions', label: sessionsLabel, valueText: compact(inRange.length), subText: sessionsSub },
      { key: 'tokens', label: t('Token 消耗'), valueText: compact(totals.billedTokens), subText: t('轮次 {n}', { n: compact(totals.turns) }) },
      { key: 'cost', label: t('费用'), valueText: totals.costSessions ? costText(totals.costUsd, opts.currency) : '—', subText: t('已计价会话 {n} / {total}', { n: totals.costSessions, total: inRange.length }) },
      { key: 'cache', label: t('缓存命中'), valueText: cacheHit === null ? '—' : cacheHit.toFixed(1) + '%', subText: t('包含会话 {n}', { n: cacheSessions }) },
      { key: 'tools', label: t('工具调用'), valueText: compact(totals.toolCalls), subText: t('工具时长 {n}', { n: duration(totals.toolsMs) }) },
      { key: 'wall', label: t('活跃时长'), valueText: duration(totals.wallMs), subText: t('模型调用 {n}', { n: compact(totals.steps) }) }
    ],
    tokenStats: [
      { key: 'input', label: t('输入'), valueText: compact(totals.inputTokens) },
      { key: 'output', label: t('输出'), valueText: compact(totals.outputTokens) },
      { key: 'cache', label: t('缓存读取'), valueText: compact(totals.cacheReadTokens) },
      { key: 'cache-write', label: t('缓存写入'), valueText: compact(totals.cacheWriteTokens) },
      { key: 'total', label: t('总用量'), valueText: compact(totals.billedTokens) }
    ],
    timingStats: [
      { key: 'ttft', label: t('首字延迟'), valueText: duration(totals.ttftMs) },
      { key: 'reasoning', label: t('推理'), valueText: duration(totals.reasoningMs) },
      { key: 'text', label: t('文本生成'), valueText: duration(totals.textMs) },
      { key: 'tool-args', label: t('工具参数生成'), valueText: duration(totals.toolArgMs) },
      { key: 'model', label: t('模型生成'), valueText: duration(totals.generationMs) },
      { key: 'tools', label: t('工具'), valueText: duration(totals.toolsMs) },
      { key: 'other', label: t('其他'), valueText: duration(Math.max(totals.timingOtherMs, totals.wallMs - totals.ttftMs - totals.generationMs - totals.toolsMs)) },
      { key: 'total', label: t('活跃时长'), valueText: duration(totals.wallMs) }
    ],
    timingRing: timingRing(timingSummary, t),
    speedText,
    weekly,
    weeklyTicks: weeklyTicksList,
    weeklyEmpty,
    weeklyCostText,
    weeklyMaxText: weekly.reduce((best, item) => (item.height === 100 ? item.tokensText : best), '—'),
    heatmap: heatmap(enrichedDays, opts.metric, today, selectedDay, opts.locale),
    ring,
    skillStats,
    skillCount: visibleSkillStats.length,
    skillTotalCount: allSkillStats.length,
    skillHasMatches: visibleSkillStats.length > 0,
    skillMoreCount: Math.max(0, visibleSkillStats.length - skillStats.length),
    skillMoreText: t('还有 {n} 个技能', { n: Math.max(0, visibleSkillStats.length - skillStats.length) }),
    skillLoadsText: compact(skillLoads),
    skillSummaryText: t('{skills} 个技能 · {loads} 次加载', { skills: compact(visibleSkillStats.length), loads: compact(skillLoads) }),
    cards,
    visibleCount: visible.length,
    page,
    pageCount,
    canPrev: page > 0,
    canNext: page + 1 < pageCount,
    costLabel: t('费用'),
    asOfText: num(source.asOf) > 0 ? new Date(num(source.asOf)).toLocaleDateString() : ''
  };
}

module.exports = { deriveInsights, withRingFocus, compact, percent, duration, RANGES, PAGE_SIZE };
