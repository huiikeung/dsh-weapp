import { GatewayFrame } from '../protocol/GatewayDtos';
import { asRec, bool, num, str } from '../protocol/GatewayFrameCodec';
import { Logger } from '../common/Logger';

/**
 * 自动化任务（对齐小程序 utils/schedule.js 的 parseTask 与 dsh-mobile 的 scheduledTasks）。
 *
 * 除展示字段外，保留 `raw` 原始记录：编辑时作为 `expected` 回传，
 * 让 Host 做乐观并发校验（记录不一致就拒绝，避免覆盖另一台设备的修改）。
 */
export interface ScheduleTask {
  id: string;
  sessionId: string;
  title: string;
  prompt: string;
  kind: string;
  status: string;
  scheduledAt: string;
  /** daily / weekly 的执行时刻（HH:mm:ss） */
  time: string;
  /** IANA 时区（daily / weekly / cron） */
  timeZone: string;
  /** weekly 的星期（1 = 周一 … 7 = 周日） */
  weekdays: number[];
  /** every 的间隔秒数 */
  everySeconds: number;
  /** cron 表达式 */
  expression: string;
  /** after 的延迟秒数 */
  afterSeconds: number;
  /** 原始记录（编辑时作为 expected） */
  raw: Record<string, Object>;
}

/** 读取字符串数组（weekdays） */
function numbers(o: Object | undefined, key: string): number[] {
  const list: Object[] | undefined = asRecArr(o, key);
  if (list === undefined) {
    return [];
  }
  const out: number[] = [];
  for (const item of list) {
    if (typeof item === 'number') {
      out.push(item as number);
    }
  }
  return out;
}

function asRecArr(o: Object | undefined, key: string): Object[] | undefined {
  if (o === undefined || o === null) {
    return undefined;
  }
  const rec: Record<string, Object> | undefined = asRec(o);
  if (rec === undefined) {
    return undefined;
  }
  const value: Object | undefined = rec[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return Array.isArray(value) ? (value as Object[]) : undefined;
}

/** 解析一条任务记录；必填字符串缺失时返回 undefined（对齐小程序 parseTask 的 fail-closed） */
export function parseScheduleTask(raw: Object): ScheduleTask | undefined {
  const id: string | undefined = str(raw, 'id');
  const sessionId: string | undefined = str(raw, 'sessionId');
  const title: string | undefined = str(raw, 'title');
  const prompt: string | undefined = str(raw, 'prompt');
  const kind: string | undefined = str(raw, 'kind');
  const status: string | undefined = str(raw, 'status');
  const scheduledAt: string | undefined = str(raw, 'scheduledAt');
  if (id === undefined || sessionId === undefined || title === undefined || prompt === undefined ||
    kind === undefined || status === undefined || scheduledAt === undefined) {
    return undefined;
  }
  const rec: Record<string, Object> = asRec(raw) ?? {};
  return {
    id: id,
    sessionId: sessionId,
    title: title,
    prompt: prompt,
    kind: kind,
    status: status,
    scheduledAt: scheduledAt,
    time: str(raw, 'time') ?? '',
    timeZone: str(raw, 'timeZone') ?? '',
    weekdays: numbers(raw, 'weekdays'),
    everySeconds: num(raw, 'everySeconds') ?? 0,
    expression: str(raw, 'expression') ?? '',
    afterSeconds: num(raw, 'afterSeconds') ?? 0,
    raw: rec
  };
}

/** 任务排序：已开启在前，其次按下次计划时间升序（对齐小程序 store 的 schedule-catalog 排序） */
function compareTasks(a: ScheduleTask, b: ScheduleTask): number {
  if (a.status !== b.status) {
    return a.status === 'active' ? -1 : 1;
  }
  if (a.scheduledAt === b.scheduledAt) {
    return 0;
  }
  return a.scheduledAt < b.scheduledAt ? -1 : 1;
}

/**
 * 自动化任务目录：schedule-catalog 帧 → AppStorage.scheduleTasks。
 * schedule-changed 帧只累加一个序号，页面监听后自行重新拉取（与小程序一致）。
 */
export class ScheduleStore {
  private static instance: ScheduleStore = new ScheduleStore();

  static get(): ScheduleStore {
    return ScheduleStore.instance;
  }

  consume(frame: GatewayFrame): void {
    if (frame.kind === 'schedule-catalog') {
      this.applyCatalog(frame);
      return;
    }
    if (frame.kind === 'schedule-changed') {
      const seq: number = AppStorage.get<number>('scheduleChangedSeq') ?? 0;
      AppStorage.setOrCreate<number>('scheduleChangedSeq', seq + 1);
      Logger.info('schedule changed');
      return;
    }
    if (frame.kind === 'error' && frame.requestType === 'schedule-catalog') {
      const message: string = frame.message !== undefined && frame.message.length > 0
        ? frame.message : '自动化任务加载失败';
      AppStorage.setOrCreate<string>('scheduleTasksError', message);
      Logger.warn('schedule catalog failed: ' + message);
    }
  }

  private applyCatalog(frame: GatewayFrame): void {
    const items: Object[] = frame.items !== undefined ? frame.items : [];
    const tasks: ScheduleTask[] = [];
    for (const item of items) {
      const task: ScheduleTask | undefined = parseScheduleTask(item);
      if (task !== undefined) {
        tasks.push(task);
      }
    }
    tasks.sort(compareTasks);
    AppStorage.setOrCreate<ScheduleTask[]>('scheduleTasks', tasks);
    AppStorage.setOrCreate<number>('scheduleTaskCount', tasks.length);
    AppStorage.setOrCreate<string>('scheduleTasksError', '');
    Logger.info('schedule tasks=' + tasks.length.toString());
  }
}
