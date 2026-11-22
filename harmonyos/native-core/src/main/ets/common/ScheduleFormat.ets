import { i18n } from '@kit.LocalizationKit';
import { ScheduleTask } from '../state/ScheduleStore';

/**
 * 自动化任务的时间规则：查询/展示/编辑逻辑，对齐小程序 utils/schedule.js + pages/schedule/schedule-editor.js。
 *
 * 规则种类（与小程序 RULES 一致）：
 *   at       仅一次
 *   every    固定间隔（秒）
 *   daily    每天 HH:mm:ss + IANA 时区
 *   weekdays 周一至周五
 *   weekly   每周（weekdays 1..7）
 *   cron     5 字段 Cron + IANA 时区
 */

export const SCHEDULE_RULE_AT: string = 'at';
export const SCHEDULE_RULE_EVERY: string = 'every';
export const SCHEDULE_RULE_DAILY: string = 'daily';
export const SCHEDULE_RULE_WEEKDAYS: string = 'weekdays';
export const SCHEDULE_RULE_WEEKLY: string = 'weekly';
export const SCHEDULE_RULE_CRON: string = 'cron';

export interface ScheduleRuleOption {
  id: string;
  title: string;
}

/** 编辑页「重复」菜单（顺序与小程序 RULES 一致） */
export const SCHEDULE_RULES: ScheduleRuleOption[] = [
  { id: SCHEDULE_RULE_AT, title: '仅一次' },
  { id: SCHEDULE_RULE_EVERY, title: '固定间隔' },
  { id: SCHEDULE_RULE_DAILY, title: '每天' },
  { id: SCHEDULE_RULE_WEEKDAYS, title: '周一至周五' },
  { id: SCHEDULE_RULE_WEEKLY, title: '每周' },
  { id: SCHEDULE_RULE_CRON, title: '自定义 Cron' }
];

/** 间隔单位：秒 */
export const SCHEDULE_INTERVAL_UNITS: number[] = [3600, 60, 1];
export const SCHEDULE_INTERVAL_UNIT_TITLES: string[] = ['小时', '分钟', '秒'];

const WEEK_SHORT_NAMES: string[] = ['一', '二', '三', '四', '五', '六', '日'];

/** 编辑草稿（@State 里整体替换，避免深层可变对象） */
export interface ScheduleDraft {
  title: string;
  prompt: string;
  /** 规则 id：at / every / daily / weekdays / weekly / cron */
  kind: string;
  ruleIndex: number;
  /** at：YYYY-MM-DD */
  date: string;
  /** daily / weekly / at：HH:mm 或 HH:mm:ss */
  time: string;
  /** IANA 时区 */
  zone: string;
  /** every：数量（字符串，便于输入框编辑） */
  interval: string;
  /** every：秒数 */
  unitSeconds: number;
  /** every：单位下标（0 小时 / 1 分钟 / 2 秒） */
  unitIndex: number;
  /** weekly：星期 1..7 */
  weekdays: number[];
  /** cron 表达式 */
  expression: string;
  /** 校验错误（空 = 通过） */
  error: string;
  /** 保存中 */
  saving: boolean;
  /** 是否可以保存（有改动且校验通过） */
  canSave: boolean;
}

export function pad2(value: number): string {
  return value < 10 ? '0' + value.toString() : value.toString();
}

export function localTimeZone(): string {
  try {
    const zone: i18n.TimeZone = i18n.getTimeZone();
    const id: string = zone.getID();
    if (id.length > 0) {
      return id;
    }
  } catch (err) {
  }
  return 'UTC';
}

/** ISO8601 → 毫秒；解析失败返回 undefined（兼容带/不带毫秒） */
export function parseScheduleIsoMs(value: string): number | undefined {
  if (value.length === 0) {
    return undefined;
  }
  const direct: number = Date.parse(value);
  if (!isNaN(direct)) {
    return direct;
  }
  const match: RegExpExecArray | null = new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?$').exec(value);
  if (match === null) {
    return undefined;
  }
  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const hour: number = Number(match[4]);
  const minute: number = Number(match[5]);
  const second: number = Number(match[6] !== undefined ? match[6] : '0');
  const ms: number = Number((match[7] !== undefined ? match[7] : '0').substring(0, 3));
  return new Date(year, month - 1, day, hour, minute, second, ms).getTime();
}

/** ISO8601 → 「2026年10月12日 20:30」 */
export function formatScheduleDate(value: string): string {
  const ms: number | undefined = parseScheduleIsoMs(value);
  if (ms === undefined) {
    return value;
  }
  const date: Date = new Date(ms);
  return date.getFullYear().toString() + '年' + (date.getMonth() + 1).toString() + '月' +
    date.getDate().toString() + '日 ' + pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

/** 秒数 → 「2 天 / 3 小时 / 30 分钟 / 45 秒」 */
export function scheduleDurationText(seconds: number): string {
  if (seconds > 0 && seconds % 86400 === 0) {
    return (seconds / 86400).toString() + ' 天';
  }
  if (seconds > 0 && seconds % 3600 === 0) {
    return (seconds / 3600).toString() + ' 小时';
  }
  if (seconds > 0 && seconds % 60 === 0) {
    return (seconds / 60).toString() + ' 分钟';
  }
  return seconds.toString() + ' 秒';
}

/** 卡片顶部短规则：每天 / 每周 / 每 X / Cron / 一次 */
export function shortScheduleRule(task: ScheduleTask): string {
  if (task.kind === SCHEDULE_RULE_DAILY) {
    return '每天';
  }
  if (task.kind === SCHEDULE_RULE_WEEKLY || task.kind === SCHEDULE_RULE_WEEKDAYS) {
    return '每周';
  }
  if (task.kind === SCHEDULE_RULE_EVERY) {
    return '每 ' + scheduleDurationText(task.everySeconds);
  }
  if (task.kind === SCHEDULE_RULE_CRON) {
    return 'Cron';
  }
  return '一次';
}

/** 详情中的完整规则描述 */
export function fullScheduleRule(task: ScheduleTask): string {
  if (task.kind === SCHEDULE_RULE_DAILY) {
    return '每天 ' + task.time + ' · ' + task.timeZone;
  }
  if (task.kind === SCHEDULE_RULE_WEEKLY || task.kind === SCHEDULE_RULE_WEEKDAYS) {
    const names: string[] = [];
    for (const day of task.weekdays) {
      if (day >= 1 && day <= 7) {
        names.push(WEEK_SHORT_NAMES[day - 1]);
      }
    }
    return '每周' + names.join('、周') + ' · ' + task.time + ' · ' + task.timeZone;
  }
  if (task.kind === SCHEDULE_RULE_EVERY) {
    return '每 ' + scheduleDurationText(task.everySeconds) + '执行一次';
  }
  if (task.kind === SCHEDULE_RULE_CRON) {
    return task.expression + ' · ' + task.timeZone;
  }
  if (task.kind === 'after') {
    return task.afterSeconds.toString() + ' 秒后执行一次';
  }
  return '指定时间执行一次';
}

/** 「今天」的 YYYY-MM-DD（一次性任务的日期初值） */
export function todayDateText(): string {
  const now: Date = new Date();
  return now.getFullYear().toString() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

/** 编辑草稿：对齐小程序 editor.draft */
export function makeScheduleDraft(task: ScheduleTask): ScheduleDraft {
  const once: boolean = task.kind === SCHEDULE_RULE_AT || task.kind === 'after';
  const ms: number | undefined = parseScheduleIsoMs(task.scheduledAt);
  const scheduled: Date | undefined = ms !== undefined ? new Date(ms) : undefined;
  const seconds: number = task.everySeconds > 0 ? task.everySeconds : 3600;
  const unitSeconds: number = seconds % 3600 === 0 ? 3600 : (seconds % 60 === 0 ? 60 : 1);
  let unitIndex: number = 2;
  if (unitSeconds === 3600) {
    unitIndex = 0;
  } else if (unitSeconds === 60) {
    unitIndex = 1;
  }
  const kind: string = once ? SCHEDULE_RULE_AT : task.kind;
  let ruleIndex: number = 0;
  for (let i = 0; i < SCHEDULE_RULES.length; i++) {
    if (SCHEDULE_RULES[i].id === kind) {
      ruleIndex = i;
      break;
    }
  }
  const dateText: string = scheduled !== undefined
    ? scheduled.getFullYear().toString() + '-' + pad2(scheduled.getMonth() + 1) + '-' + pad2(scheduled.getDate())
    : todayDateText();
  const timeText: string = once && scheduled !== undefined
    ? pad2(scheduled.getHours()) + ':' + pad2(scheduled.getMinutes()) + ':' + pad2(scheduled.getSeconds())
    : (task.time.length > 0 ? task.time : '09:00:00');
  const zoneText: string = once
    ? localTimeZone()
    : (task.timeZone.length > 0 ? task.timeZone : localTimeZone());
  const weekdays: number[] = task.weekdays.length > 0 ? task.weekdays.slice() : [1];
  const expression: string = task.expression.length > 0 ? task.expression : '0 9 * * 1-5';
  return {
    title: task.title,
    prompt: task.prompt,
    kind: kind,
    ruleIndex: ruleIndex,
    date: dateText,
    time: timeText,
    zone: zoneText,
    interval: (seconds / unitSeconds).toString(),
    unitSeconds: unitSeconds,
    unitIndex: unitIndex,
    weekdays: weekdays,
    expression: expression,
    error: '',
    saving: false,
    canSave: false
  };
}

/** 时间字段快照：相等说明「时间规则没改过」，保存时不必回传 change */
function timingFields(draft: ScheduleDraft): string {
  const parts: Object[] = [draft.kind, draft.date, draft.time, draft.zone, draft.interval,
    draft.unitSeconds, draft.weekdays, draft.expression];
  return JSON.stringify(parts);
}

function isValidTimeText(text: string): boolean {
  return new RegExp('^([01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$').test(text);
}

function isValidDateText(text: string): boolean {
  const match: RegExpExecArray | null = new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})$').exec(text);
  if (match === null) {
    return false;
  }
  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const probe: Date = new Date(year, month - 1, day, 12, 0, 0);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

/**
 * 由草稿生成 timing change（对齐小程序 editor.buildChange）：
 * 时间规则没变返回 undefined（只改名称/内容时不下发 timing，避免按时区/夏令时重算后顺延）。
 * 校验失败抛 Error，消息直接展示给用户。
 */
export function buildScheduleChange(draft: ScheduleDraft, initial: ScheduleDraft): Record<string, Object> | undefined {
  if (timingFields(draft) === timingFields(initial)) {
    return undefined;
  }
  const time: string = draft.time.trim();
  const zone: string = draft.zone.trim();
  if (draft.kind !== SCHEDULE_RULE_EVERY && zone.length === 0) {
    throw new Error('请输入 IANA 时区，例如 Asia/Shanghai');
  }
  if (draft.kind !== SCHEDULE_RULE_EVERY && draft.kind !== SCHEDULE_RULE_CRON && !isValidTimeText(time)) {
    throw new Error('请输入有效时间，例如 09:00:00');
  }
  const clock: string = time.length === 5 ? time + ':00' : time;
  if (draft.kind === SCHEDULE_RULE_AT) {
    if (!isValidDateText(draft.date)) {
      throw new Error('请选择有效日期');
    }
    const at: Record<string, Object> = {
      'date': draft.date, 'time': clock, 'time_zone': zone
    };
    return { 'kind': 'at', 'at': at };
  }
  if (draft.kind === SCHEDULE_RULE_EVERY) {
    const intervalText: string = draft.interval.trim();
    const seconds: number = Number(intervalText) * draft.unitSeconds;
    if (intervalText.length === 0 || !Number.isSafeInteger(seconds) || seconds < 60) {
      throw new Error('重复间隔至少 60 秒，且须为整秒');
    }
    return { 'kind': 'every', 'every_seconds': seconds };
  }
  if (draft.kind === SCHEDULE_RULE_DAILY) {
    const daily: Record<string, Object> = { 'time': clock, 'time_zone': zone };
    return { 'kind': 'daily', 'daily': daily };
  }
  if (draft.kind === SCHEDULE_RULE_WEEKLY || draft.kind === SCHEDULE_RULE_WEEKDAYS) {
    const days: number[] = draft.kind === SCHEDULE_RULE_WEEKDAYS
      ? [1, 2, 3, 4, 5]
      : draft.weekdays.slice().sort((a: number, b: number) => a - b);
    if (days.length === 0) {
      throw new Error('请至少选择一个星期');
    }
    const weekly: Record<string, Object> = { 'time': clock, 'time_zone': zone, 'weekdays': days };
    return { 'kind': 'weekly', 'weekly': weekly };
  }
  if (draft.kind === SCHEDULE_RULE_CRON) {
    const expression: string = draft.expression.trim();
    const fields: string[] = expression.split(' ').filter((item: string) => item.length > 0);
    if (fields.length !== 5) {
      throw new Error('请输入 5 字段 Cron 表达式，例如 0 9 * * 1-5');
    }
    const cron: Record<string, Object> = { 'expression': expression, 'time_zone': zone };
    return { 'kind': 'cron', 'cron': cron };
  }
  throw new Error('不支持的执行规则');
}

/** 标题/内容校验 + canSave 计算（对齐小程序 patchEditing） */
export function validateScheduleDraft(draft: ScheduleDraft, initial: ScheduleDraft,
  originalTitle: string, originalPrompt: string): ScheduleDraft {
  let error: string = '';
  let change: Record<string, Object> | undefined = undefined;
  const title: string = draft.title.trim();
  const prompt: string = draft.prompt.trim();
  if (title.length === 0 || title.length > 120) {
    error = '任务名称需为 1–120 个字符';
  } else if (prompt.length === 0) {
    error = '请输入任务内容';
  } else {
    try {
      change = buildScheduleChange(draft, initial);
    } catch (err) {
      error = err instanceof Error ? err.message : '执行规则无效';
    }
  }
  const changed: boolean = title !== originalTitle || prompt !== originalPrompt || change !== undefined;
  return {
    title: draft.title,
    prompt: draft.prompt,
    kind: draft.kind,
    ruleIndex: draft.ruleIndex,
    date: draft.date,
    time: draft.time,
    zone: draft.zone,
    interval: draft.interval,
    unitSeconds: draft.unitSeconds,
    unitIndex: draft.unitIndex,
    weekdays: draft.weekdays,
    expression: draft.expression,
    error: error,
    saving: draft.saving,
    canSave: error.length === 0 && changed
  };
}

/** 星期行：value 1..7，返回「一」…「日」 */
export function weekDayShortName(day: number): string {
  if (day >= 1 && day <= 7) {
    return WEEK_SHORT_NAMES[day - 1];
  }
  return '';
}
