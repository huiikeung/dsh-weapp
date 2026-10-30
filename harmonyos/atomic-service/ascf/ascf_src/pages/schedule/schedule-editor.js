'use strict';
const { t: uiText } = require('../../utils/ui-preferences');
const schedule = require('../../utils/schedule');
const RULES = [{ id: 'at', title: uiText('仅一次') }, { id: 'every', title: uiText('固定间隔') }, { id: 'daily', title: uiText('每天') }, { id: 'weekdays', title: uiText('周一至周五') }, { id: 'weekly', title: uiText('每周') }, { id: 'cron', title: uiText('自定义 Cron') }];
function draft(task) {
  const raw = task.raw || {}, once = ['at', 'after'].includes(task.kind), date = new Date(task.scheduledAt);
  const pad = n => String(n).padStart(2, '0');
  const seconds = Number(raw.everySeconds) || 3600;
  const unit = seconds % 3600 === 0 ? 3600 : seconds % 60 === 0 ? 60 : 1;
  const kind = once ? 'at' : task.kind;
  return { title: task.title, prompt: task.prompt, kind, ruleIndex: Math.max(0, RULES.findIndex(r => r.id === kind)),
    date: Number.isFinite(date.getTime()) ? date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) : schedule.todayStr(),
    time: once && Number.isFinite(date.getTime()) ? pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()) : raw.time || '09:00:00',
    zone: once ? schedule.localZone() : raw.timeZone || schedule.localZone(),
    interval: String(seconds / unit), unit, unitIndex: unit === 3600 ? 0 : unit === 60 ? 1 : 2,
    weekdays: Array.isArray(raw.weekdays) ? raw.weekdays.slice() : [1], expression: raw.expression || '0 9 * * 1-5', error: '', saving: false, canSave: false };
}
function timingFields(d) { return JSON.stringify([d.kind, d.date, d.time, d.zone, d.interval, d.unit, d.weekdays, d.expression]); }
function buildChange(d, initial) {
  if (timingFields(d) === timingFields(initial)) return null;
  const time = String(d.time).trim(), zone = String(d.zone).trim();
  const validTime = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time);
  if (d.kind !== 'every' && !zone) throw Error(uiText('请输入 IANA 时区，例如 Asia/Shanghai'));
  if (!['every', 'cron'].includes(d.kind) && !validTime) throw Error(uiText('请输入有效时间，例如 09:00:00'));
  const clock = time.length === 5 ? time + ':00' : time;
  if (d.kind === 'at') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw Error(uiText('请选择有效日期'));
    const parsed = new Date(d.date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d.date) throw Error(uiText('请选择有效日期'));
    // Host validates IANA time zones, DST gaps and future timing, exactly as desktop.
    return { kind: 'at', at: { date: d.date, time: clock, time_zone: zone } };
  }
  if (d.kind === 'every') {
    const seconds = Number(d.interval) * Number(d.unit);
    if (!String(d.interval).trim() || !Number.isSafeInteger(seconds) || seconds < 60) throw Error(uiText('重复间隔至少 60 秒，且须为整秒'));
    return { kind: 'every', every_seconds: seconds };
  }
  if (d.kind === 'daily') return { kind: 'daily', daily: { time: clock, time_zone: zone } };
  if (d.kind === 'weekly' || d.kind === 'weekdays') {
    const days = d.kind === 'weekdays' ? [1, 2, 3, 4, 5] : d.weekdays;
    if (!days.length || days.some(v => !Number.isInteger(v) || v < 1 || v > 7)) throw Error(uiText('请至少选择一个星期'));
    return { kind: 'weekly', weekly: { time: clock, time_zone: zone, weekdays: days.slice().sort() } };
  }
  if (d.kind === 'cron') {
    const expression = d.expression.trim();
    if (expression.split(/\s+/).length !== 5) throw Error(uiText('请输入 5 字段 Cron 表达式，例如 0 9 * * 1-5'));
    return { kind: 'cron', cron: { expression, time_zone: zone } };
  }
  throw Error(uiText('不支持的执行规则'));
}
module.exports = { RULES, draft, buildChange };
