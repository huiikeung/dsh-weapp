// 定时任务模型与文案格式化。
// 对齐 dsh-mobile GatewayModels.ScheduledTask / RootView.ScheduledTaskFormat
// （v1.6.x schedule protocol：schedule-catalog / schedule-update / schedule-delete）。

/**
 * 解析 schedule-catalog 帧中的任务记录；字段缺失返回 null（与 iOS init?(raw:) 一致）。
 */
function parseTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const required = ['id', 'sessionId', 'title', 'prompt', 'kind', 'status', 'scheduledAt'];
  for (let i = 0; i < required.length; i += 1) {
    if (typeof raw[required[i]] !== 'string') return null;
  }
  return {
    id: raw.id,
    sessionId: raw.sessionId,
    title: raw.title,
    prompt: raw.prompt,
    kind: raw.kind,
    status: raw.status,
    scheduledAt: raw.scheduledAt,
    raw: raw,
    lastDelivery: raw.lastDelivery || null
  };
}

/** 卡片顶部短规则：每天 / 每周 / 每 X / Cron / 一次。 */
function shortRule(task) {
  switch (task.kind) {
    case 'daily': return '每天';
    case 'weekly': return '每周';
    case 'every': return '每 ' + durationText(Number(task.raw && task.raw.everySeconds) || 0);
    case 'cron': return 'Cron';
    default: return '一次';
  }
}

/** 详情中的完整规则描述。 */
function fullRule(task) {
  const raw = task.raw || {};
  switch (task.kind) {
    case 'daily':
      return '每天 ' + (raw.time || '') + ' · ' + (raw.timeZone || '');
    case 'weekly': {
      const days = Array.isArray(raw.weekdays) ? raw.weekdays : [];
      const names = ['一', '二', '三', '四', '五', '六', '日'];
      const list = days
        .filter(function (d) { return d >= 1 && d <= 7; })
        .map(function (d) { return names[d - 1]; });
      return '每周' + list.join('、周') + ' · ' + (raw.time || '') + ' · ' + (raw.timeZone || '');
    }
    case 'every':
      return '每 ' + durationText(Number(raw.everySeconds) || 0) + '执行一次';
    case 'cron':
      return (raw.expression || '') + ' · ' + (raw.timeZone || '');
    case 'after':
      return (Number(raw.afterSeconds) || 0) + ' 秒后执行一次';
    default:
      return '指定时间执行一次';
  }
}

/** 秒数 → 「2 天 / 3 小时 / 30 分钟 / 45 秒」。 */
function durationText(seconds) {
  if (seconds > 0 && seconds % 86400 === 0) return (seconds / 86400) + ' 天';
  if (seconds > 0 && seconds % 3600 === 0) return (seconds / 3600) + ' 小时';
  if (seconds > 0 && seconds % 60 === 0) return (seconds / 60) + ' 分钟';
  return seconds + ' 秒';
}

/** ISO8601 → 「2026年10月12日 20:30」（对齐 iOS .dateTime.year().month().day().hour().minute()）。 */
function formatDate(value) {
  const ms = parseISOms(value);
  if (ms === null) return value || '';
  const d = new Date(ms);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** ISO8601 解析（兼容带/不带毫秒），失败返回 null。 */
function parseISOms(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (!isNaN(t)) return t;
  // 兜底：无时区的 "YYYY-MM-DDTHH:mm:ss(.SSS)" 按本地时区处理
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(value);
  if (!m) return null;
  return new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] || 0), Number((m[7] || '0').slice(0, 3).padEnd(3, '0'))
  ).getTime();
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 编辑页时间选择初值「HH:mm」（来自 raw.time，缺省取当前时刻）。 */
function initialClock(raw) {
  const time = String((raw && raw.time) || '');
  const parts = time.split(':');
  if (parts.length >= 2 && /^\d{1,2}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
    return pad2(Number(parts[0])) + ':' + pad2(Number(parts[1]));
  }
  const now = new Date();
  return pad2(now.getHours()) + ':' + pad2(now.getMinutes());
}

/** 任务时区：raw.timeZone 优先，否则本机时区（对齐 iOS zone）。 */
function taskZone(raw) {
  return (raw && raw.timeZone) || localZone();
}

function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (e) {
    return 'UTC';
  }
}

/**
 * 本地时刻 → 带时分秒+毫秒+时区偏移的 ISO8601
 * （对齐 iOS ISO8601DateFormatter [.withInternetDateTime, .withFractionalSeconds]）。
 */
function toLocalISO(ms) {
  const d = new Date(ms);
  const offsetMinutes = -d.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
    '.' + pad2(Math.floor(d.getMilliseconds() / 10)) +
    sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60);
}

/** 日期选择器值「YYYY-MM-DD」+ 时间选择器值「HH:mm」→ 当地时刻 ms。 */
function combineDateTime(dateStr, timeStr) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const t = /^(\d{1,2}):(\d{1,2})$/.exec(String(timeStr || ''));
  if (!d || !t) return null;
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0).getTime();
}

/** 今天「YYYY-MM-DD」（picker start 属性）。 */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 编辑页 timing change 计算；无变化返回 null（对齐 iOS timingChange）。 */
function timingChange(task, opts) {
  const raw = task.raw || {};
  const isRepeating = task.kind !== 'at' && task.kind !== 'after';
  if (opts.useSpecificDate) {
    const ms = combineDateTime(opts.date, opts.time);
    if (ms === null) return null;
    const original = parseISOms(task.scheduledAt);
    // 循环任务或原本无法解析时：只要选了时间就算变更；一次性任务与原时间相同则不算
    if (isRepeating || original === null || Math.abs(ms - original) > 1000) {
      return { kind: 'at', at: toLocalISO(ms) };
    }
    return null;
  }
  const clock = String(opts.time || '');
  if (clock.slice(0, 5) === String(raw.time || '').slice(0, 5)) return null;
  const timeZone = taskZone(raw);
  if (task.kind === 'daily') {
    return { kind: 'daily', daily: { time: clock + ':00', time_zone: timeZone } };
  }
  if (task.kind === 'weekly') {
    return {
      kind: 'weekly',
      weekly: { time: clock + ':00', time_zone: timeZone, weekdays: raw.weekdays || [] }
    };
  }
  return null;
}

module.exports = {
  parseTask: parseTask,
  shortRule: shortRule,
  fullRule: fullRule,
  formatDate: formatDate,
  parseISOms: parseISOms,
  initialClock: initialClock,
  taskZone: taskZone,
  localZone: localZone,
  toLocalISO: toLocalISO,
  combineDateTime: combineDateTime,
  todayStr: todayStr,
  timingChange: timingChange
};
