import { GatewayFrame } from '../protocol/GatewayDtos';
import { str } from '../protocol/GatewayFrameCodec';
import { Logger } from '../common/Logger';

export interface ScheduleTask {
  id: string;
  title: string;
  status: string;
  kind: string;
  scheduledAt: string;
}

/** 自动化任务目录：schedule-catalog 帧 → 列表。 */
export class ScheduleStore {
  private static instance: ScheduleStore = new ScheduleStore();

  static get(): ScheduleStore {
    return ScheduleStore.instance;
  }

  consume(frame: GatewayFrame): void {
    if (frame.kind !== 'schedule-catalog') {
      return;
    }
    const rawItems: Object[] = frame.items !== undefined ? frame.items : [];
    const tasks: ScheduleTask[] = [];
    for (const raw of rawItems) {
      const id: string = str(raw, 'id') ?? '';
      const title: string = str(raw, 'title') ?? '';
      if (id.length === 0 || title.length === 0) {
        continue;
      }
      tasks.push({
        id: id,
        title: title,
        status: str(raw, 'status') ?? '',
        kind: str(raw, 'kind') ?? '',
        scheduledAt: str(raw, 'scheduledAt') ?? ''
      });
    }
    AppStorage.setOrCreate<ScheduleTask[]>('scheduleTasks', tasks);
    AppStorage.setOrCreate<number>('scheduleTaskCount', tasks.length);
    Logger.info('schedule tasks=' + tasks.length);
  }
}
