// Pure view-model helpers for the cross-session Context Insights page.
const CATEGORY_KEYS = ['system', 'tools', 'user', 'inject', 'skill', 'assistant', 'tool', 'output'];
const CATEGORY_LABELS = { system: '系统提示词', tools: '工具定义', user: '用户消息', inject: '注入内容', skill: '技能注入', assistant: '助手消息', tool: '工具结果', output: '输出' };
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
      label: Number.isFinite(date.getTime()) ? String(date.getDate()) : '',
      tokensText: tokens > 0 ? compact(tokens) : '',
      costText: costText(item && item.costUsd, item && item.currency),
      height: max > 0 && tokens > 0 ? Math.max(4, Math.round((tokens / max) * 100)) : 0,
      costHeight: maxCost > 0 && item && item.costUsd !== null && item.costUsd !== undefined
        ? Math.max(4, Math.round((Number(item.costUsd) / maxCost) * 100)) : 0
    };
  });
}

function heatmap(days, metric, now, selectedDay) {
  const source = new Map((Array.isArray(days) ? days : []).map((item) => [text(item && item.day), item]));
  const today = localMidnight(now);
  const todayDate = new Date(today);
  const sundayOffset = todayDate.getDay();
  const firstOffset = 55 + sundayOffset;
  const cells = [];
  for (let index = 0; index < 56; index += 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - firstOffset + index);
    const time = localMidnight(date.getTime());
    const key = dayKeyOf(time);
    const entry = source.get(key) || {};
    cells.push({
      key: 'heat-' + index,
      day: key,
      tokens: num(entry.tokens),
      sessions: num(entry.sessions),
      available: num(entry.tokens) > 0 || num(entry.sessions) > 0,
      value: metric === 'sessions' ? num(entry.sessions) : num(entry.tokens),
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
    weeks: Array.from({ length: 8 }, (_, week) => ({
      key: 'week-' + week,
      cells: cells.slice(week * 7, week * 7 + 7)
    })),
    maxText: max > 0 ? compact(max) : '—',
    selectedDay: selectedDay || ''
  };
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
    return { key, label: t(CATEGORY_LABELS[key] || key), valueText: compact(value), pctText: percent(value, total), dim: value <= 0 };
  });
  return { available: stops.length > 0, style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '', rows, totalText: compact(total) };
}

function currentRing(session) {
  const composition = isObject(session.composition) ? session.composition : {};
  const total = CATEGORY_KEYS.reduce((sum, key) => sum + num(composition[key]), 0);
  let acc = 0;
  const stops = [];
  CATEGORY_KEYS.forEach((key) => {
    const value = num(composition[key]);
    if (value > 0 && total > 0) {
      const start = (acc / total) * 100;
      acc += value;
      stops.push('var(--ctx-c-' + key + ') ' + start.toFixed(2) + '% ' + ((acc / total) * 100).toFixed(2) + '%');
    }
  });
  return { total, style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '' };
}

function timingRing(timing, t) {
  const modelMs = num(timing.ttftMs) + num(timing.generationMs);
  const toolsMs = num(timing.toolsMs);
  const total = num(timing.wallMs);
  const otherMs = Math.max(num(timing.timingOtherMs), total - modelMs - toolsMs);
  const parts = [
    { key: 'model', label: t('模型生成'), value: modelMs, color: 'var(--ins-time-model)' },
    { key: 'tools', label: t('工具'), value: toolsMs, color: 'var(--ins-time-tools)' },
    { key: 'other', label: t('其他'), value: otherMs, color: 'var(--ins-time-other)' }
  ];
  let offset = 0;
  const stops = [];
  parts.forEach((part) => {
    if (part.value <= 0 || total <= 0) return;
    const start = offset / total * 100;
    offset += part.value;
    stops.push(part.color + ' ' + start.toFixed(2) + '% ' + (offset / total * 100).toFixed(2) + '%');
  });
  return {
    totalText: duration(total),
    style: stops.length ? 'background:conic-gradient(' + stops.join(',') + ');' : '',
    rows: parts.map((part) => ({ ...part, valueText: duration(part.value), pctText: percent(part.value, total), dim: part.value <= 0 }))
  };
}

function sortSessions(sessions, sort) {
  const copy = sessions.slice();
  if (sort === 'tokens') copy.sort((a, b) => num(b.billedTokens) - num(a.billedTokens) || num(b.lastActive) - num(a.lastActive));
  else if (sort === 'context') copy.sort((a, b) => num(b.pressureTokens) - num(a.pressureTokens) || num(b.lastActive) - num(a.lastActive));
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
    return [session.title, session.id, session.model, session.provider, session.cwd, session.lastAnswer].some((item) => text(item).toLowerCase().includes(query));
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
  const cards = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((session, index) => {
    const window = num(session.contextWindow);
    const pressure = num(session.pressureTokens);
    const ring = currentRing(session);
    const parts = CATEGORY_KEYS.filter((key) => key !== 'output').map((key) => ({
      key,
      width: num(session.composition && session.composition[key]) > 0 && pressure > 0
        ? Math.min(100, (num(session.composition[key]) / pressure) * 100) : 0
    })).filter((part) => part.width > 0);
    const percentUsed = window > 0 ? pressure / window : 0;
    const ageMs = Math.max(0, today - num(session.lastActive));
    const archived = workspace.archived.has(text(session.id)) || session.archived === true;
    const group = workspace.groups[text(session.id)] || '';
    const activityDays = Object.keys(isObject(session.days) ? session.days : {}).sort();
    const createdDay = num(session.createdAt) > 0 ? dayKeyOf(session.createdAt) : activityDays[0] || '';
    return {
      key: 'session-' + page + '-' + index + '-' + text(session.id),
      id: text(session.id),
      title: text(session.title) || text(session.id),
      model: text(session.model),
      provider: text(session.provider),
      cwd: text(session.cwd),
      group,
      project: projectName(session.cwd),
      archived,
      running: session.running === true,
      current: session.current === true || text(opts.currentSessionId) === text(session.id),
      createdDay,
      createdText: createdDay ? ' · ' + createdDay : '',
      billedText: compact(session.billedTokens),
      inputText: compact(session.inputTokens),
      outputText: compact(session.outputTokens),
      cacheWriteText: compact(session.cacheWriteTokens),
      turnsText: compact(session.turns),
      stepsText: compact(session.steps),
      toolText: compact(session.toolCalls),
      activeText: duration(session.activeMs),
      parts,
      ringStyle: ring.style,
      ringTotalText: compact(ring.total),
      pctText: window > 0 ? percent(pressure, window) : '—',
      pctColor: percentUsed >= 0.9 ? '#FB2C36' : percentUsed >= 0.7 ? '#FE9A00' : '#00C950',
      contextText: window > 0 ? compact(pressure) + ' / ' + compact(window) : '',
      metaText: [text(session.model), text(session.provider)].filter(Boolean).join(' · '),
      lastAnswer: text(session.lastAnswer),
      costText: costText(session.costUsd, opts.currency),
      updatedText: ageMs < 60000 ? t('刚刚') : duration(ageMs) + ' ' + t('前')
    };
  });
  const tokenFloor = customRange ? customRange.from : range === 0 ? null : dayKeyOf(rangeStart(range, today));
  const tokenCeiling = customRange ? customRange.to : dayKeyOf(today);
  const hasScopedTokenDays = tokenFloor !== null && inRange.some((session) => Object.keys(isObject(session.days) ? session.days : {})
    .some((key) => key >= tokenFloor && key <= tokenCeiling));
  const hasScopedActivityDays = tokenFloor !== null && inRange.some((session) => Object.keys(isObject(session.days) ? session.days : {})
    .some((key) => key >= tokenFloor && key <= tokenCeiling && (session.days[key].turns !== undefined || session.days[key].toolCalls !== undefined || session.days[key].wallMs !== undefined)));
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
        sum.billedTokens += num(daily.tokens);
        sum.inputTokens += num(daily.inputTokens);
        sum.cacheReadTokens += num(daily.cacheReadTokens);
        sum.cacheWriteTokens += num(daily.cacheWriteTokens);
        sum.outputTokens += num(daily.outputTokens);
        billedInput += num(daily.inputTokens);
        billedOutput += num(daily.outputTokens);
      });
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
      const dayValues = Object.keys(isObject(session.days) ? session.days : {}).filter((key) => key >= tokenFloor && key <= tokenCeiling);
      dayValues.forEach((key) => {
        const daily = session.days[key];
        const wall = num(daily.wallMs);
        const tools = num(daily.toolsMs);
        sum.generationMs += Math.max(0, wall - tools);
      });
    } else {
      sum.turns += num(session.turns);
      sum.steps += num(session.steps);
      sum.toolCalls += num(session.toolCalls);
      sum.activeMs += num(session.activeMs);
      const timing = isObject(session.timing) ? session.timing : {};
      const sessionToolsMs = num(timing.toolsMs) || num(session.toolMs);
      const sessionWallMs = num(timing.wallMs) || num(session.activeMs);
      sum.toolsMs += sessionToolsMs;
      sum.wallMs += sessionWallMs;
      sum.ttftMs += num(timing.ttftMs);
      sum.reasoningMs += num(timing.reasoningMs);
      sum.textMs += num(timing.textMs);
      sum.toolArgMs += num(timing.toolArgMs);
      sum.generationMs += num(timing.reasoningMs) + num(timing.textMs) + num(timing.toolArgMs);
      sum.timingOtherMs += num(timing.otherMs);
      sum.speedTokens += num(timing.speedTokens);
      sum.speedMs += num(timing.speedMs);
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
  }, { billedTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, turns: 0, steps: 0, toolCalls: 0, activeMs: 0, toolsMs: 0, wallMs: 0, generationMs: 0, ttftMs: 0, reasoningMs: 0, textMs: 0, toolArgMs: 0, timingOtherMs: 0, speedTokens: 0, speedMs: 0, costUsd: 0, costSessions: 0, composition: emptyComposition() });
  const cacheHit = totals.inputTokens > 0 ? totals.cacheReadTokens / totals.inputTokens * 100 : null;
  const cacheSessions = inRange.filter((session) => {
    if (tokenFloor === null) return num(session.inputTokens) > 0;
    return Object.keys(isObject(session.days) ? session.days : {}).some((key) => key >= tokenFloor && key <= tokenCeiling
      && num(session.days[key].inputTokens) > 0);
  }).length;
  const allDays = (Array.isArray(source.days) ? source.days : []).filter(isObject);
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
  const enrichedDays = allDays.map((day) => ({ ...day,
    tokens: Object.keys(dayTokens).length ? dayTokens[text(day.day)] || 0 : num(day.tokens),
    sessions: daySessionCount[text(day.day)] || 0,
    costUsd: dayCost[text(day.day)] === undefined ? null : dayCost[text(day.day)],
    currency: opts.currency
  }));
  const weekly = dailyChart(enrichedDays.slice(-7));
  const weeklyCostDays = enrichedDays.slice(-7).filter((day) => day.costUsd !== null && day.costUsd !== undefined);
  const weeklyCostText = weeklyCostDays.length
    ? costText(weeklyCostDays.reduce((sum, day) => sum + Number(day.costUsd), 0), opts.currency)
    : t('暂无可计价数据');
  const timingSummary = {
    wallMs: totals.wallMs,
    toolsMs: totals.toolsMs,
    generationMs: totals.generationMs,
    ttftMs: totals.ttftMs,
    timingOtherMs: totals.timingOtherMs
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
  const allSkillStats = Object.keys(skillsByName).map((name) => ({ ...skillsByName[name], info: catalog[name] || null }))
    .sort((a, b) => skillSort === 'recent' ? b.lastTime - a.lastTime || b.last.localeCompare(a.last) || b.loads - a.loads : b.loads - a.loads || a.name.localeCompare(b.name));
  const skillStats = allSkillStats.filter((skill) => !skillQuery || skill.name.toLowerCase().includes(skillQuery)).slice(0, 20);
  const maxSkillLoads = skillStats.reduce((max, skill) => Math.max(max, skill.loads), 0);
  skillStats.forEach((skill) => {
    skill.width = maxSkillLoads > 0 ? Math.max(4, Math.round(skill.loads / maxSkillLoads * 100)) : 0;
    skill.loadText = compact(skill.loads);
    skill.sessionDaysText = compact(skill.sessionDays);
    if (skill.lastTime > 0) {
      const date = new Date(skill.lastTime);
      skill.lastText = skill.last + ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    } else skill.lastText = skill.last;
  });
  const ranges = RANGES.map((days) => ({
    key: String(days),
    label: days === 'today' ? t('今天') : days === 0 ? t('全部') : t('近 {n} 天', { n: days }),
    active: customRange === null && days === range
  }));
  const coverageOptions = ['all', 'active', 'archived'].map((key) => ({ key, label: t(key === 'all' ? '全部会话' : key === 'active' ? '活跃会话' : '已归档'), active: coverage === key }));
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
    selectedDayText: selectedDay ? t('日期：{day}', { day: selectedDay }) : '',
    selectedSkill,
    selectedSkillText: selectedSkill ? t('技能：{name}', { name: selectedSkill }) : '',
    coverage,
    coverageOptions,
    group: text(opts.group),
    groupOptions: groupOptions.map((item) => ({ ...item, active: item.key === opts.group })),
    allGroupCount: dayScoped.length,
    skillSort,
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
    weeklyCostText,
    weeklyMaxText: weekly.reduce((best, item) => (item.height === 100 ? item.tokensText : best), '—'),
    heatmap: heatmap(enrichedDays, opts.metric, today, selectedDay),
    ring,
    skillStats,
    skillCount: skillStats.length,
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

module.exports = { deriveInsights, compact, percent, duration, RANGES, PAGE_SIZE };
