import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { PreferencesStore } from '../common/PreferencesStore';
import { Logger } from '../common/Logger';
import { NotificationService } from '../common/NotificationService';

interface AlarmEntry {
  id: string;
  reminderId: number;
  title: string;
  fireDate: string;
  timeZone: string;
}

interface AlarmRow {
  id: string;
  title: string;
  fireDate: string;
  timeZone: string;
  state: string;
}

interface AlarmCreated {
  id: string;
  title: string;
  fireDate: string;
  timeZone: string;
  state: string;
  operationId: string;
  status: string;
}

interface AlarmListed {
  items: AlarmRow[];
  truncated: boolean;
  source: string;
}

interface AlarmCanceled {
  id: string;
  operationId: string;
  status: string;
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string): string => {
    const r: number = Math.floor(Math.random() * 16);
    const v: number = c === 'x' ? r : (r % 4 + 8);
    return v.toString(16);
  });
}

class AlarmsConnector implements ConnectorAdapter {
  id: string = 'alarms';
  private authorized: boolean = false;

  available(): boolean {
    return true;
  }

  async authorize(): Promise<boolean> {
    if (this.authorized) {
      return true;
    }
    const context: common.UIAbilityContext | undefined = AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
    if (context === undefined) {
      return false;
    }
    const permissions: Permissions[] = ['ohos.permission.PUBLISH_AGENT_REMINDER'];
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(context, permissions);
      // 代理提醒依赖系统通知：通知未开启时发布会报 1700002（数量超限）
      const notifications: boolean = await NotificationService.ensureAuthorized(context);
      this.authorized = result.authResults.every((code: number) => code === 0) && notifications;
      return this.authorized;
    } catch (err) {
      Logger.warn('alarms authorize failed');
      return false;
    }
  }

  private load(): AlarmEntry[] {
    try {
      const raw: string = PreferencesStore.get().getString('connectors.alarms', '[]');
      return JSON.parse(raw) as AlarmEntry[];
    } catch (err) {
      return [];
    }
  }

  private save(list: AlarmEntry[]): void {
    PreferencesStore.get().putString('connectors.alarms', JSON.stringify(list));
  }

  /** 清理已过期/已失效的本机闹钟，释放系统「代理提醒」配额。 */
  private async pruneExpired(): Promise<void> {
    const now: number = Date.now();
    const list: AlarmEntry[] = this.load();
    const keep: AlarmEntry[] = [];
    for (const entry of list) {
      const at: number = Date.parse(entry.fireDate);
      if (Number.isFinite(at) && at <= now) {
        try {
          await reminderAgentManager.cancelReminder(entry.reminderId);
        } catch (err) {
        }
        continue;
      }
      keep.push(entry);
    }
    if (keep.length !== list.length) {
      this.save(keep);
      Logger.info('alarms pruned expired n=' + (list.length - keep.length).toString());
    }
  }

  /**
   * 清掉本 App 历史遗留的「按天重复」闹钟提醒（REMINDER_TYPE_ALARM），释放系统配额。
   * 系统返回的 ReminderRequest 不带 reminderId，只有在「全部现存提醒都是闹钟类型」时才敢整体清空；
   * 若还混有提醒事项（TIMER/CALENDAR），保留不动，避免误删用户的提醒事项。
   */
  private async clearLegacyAlarmReminders(): Promise<void> {
    try {
      const valid: reminderAgentManager.ReminderRequest[] = await reminderAgentManager.getValidReminders();
      let alarmCount: number = 0;
      for (const item of valid) {
        if (item.reminderType === reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM) {
          alarmCount += 1;
        }
      }
      if (valid.length > 0 && alarmCount === valid.length) {
        await reminderAgentManager.cancelAllReminders();
        Logger.info('alarms cleared all legacy alarm reminders n=' + alarmCount.toString());
      } else {
        Logger.warn('alarms quota full but has non-alarm reminders valid=' + valid.length.toString()
          + ' alarms=' + alarmCount.toString());
      }
    } catch (err) {
      Logger.warn('alarms list valid reminders failed');
    }
  }

  /** 系统提醒配额满了：清掉本机记录的旧闹钟后再试一次。 */
  private async cancelAllTracked(): Promise<void> {
    const list: AlarmEntry[] = this.load();
    for (const entry of list) {
      try {
        await reminderAgentManager.cancelReminder(entry.reminderId);
      } catch (err) {
      }
    }
    this.save([]);
    Logger.info('alarms cleared tracked n=' + list.length.toString());
  }

  private async create(args: Record<string, Object>): Promise<AlarmCreated> {
    const fireDate: string = String(args.fireDate);
    const date: Date = new Date(Date.parse(fireDate));
    const title: string = String(args.title);
    const timeZone: string = String(args.timeZone);
    // 一次性闹钟：用「日历提醒」在指定日期时间响铃（REMINDER_TYPE_ALARM 会按天重复，配额很快耗尽）
    const reminder: reminderAgentManager.ReminderRequestCalendar = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
      dateTime: {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
      },
      title: title,
      content: title,
      notificationId: Math.floor(Math.random() * 100000) + 1
    };
    await this.pruneExpired();
    let reminderId: number = 0;
    try {
      reminderId = await reminderAgentManager.publishReminder(reminder);
    } catch (err) {
      const message: string = err instanceof Error ? err.message : JSON.stringify(err);
      Logger.warn('alarms publishReminder failed: ' + message);
      // 通知未开启时系统同样报 1700002
      try {
        const ctx: common.UIAbilityContext | undefined = AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
        if (ctx !== undefined) {
          await NotificationService.ensureAuthorized(ctx);
        }
      } catch (ensureErr) {
      }
      // 1700002 = 提醒数量超过上限：先清掉历史遗留的 ALARM 类型提醒（旧版本按天重复创建，配额被占满）
      if (message.indexOf('1700002') >= 0) {
        await this.clearLegacyAlarmReminders();
        await this.cancelAllTracked();
        try {
          reminderId = await reminderAgentManager.publishReminder(reminder);
        } catch (retryErr) {
          const retryMessage: string = retryErr instanceof Error ? retryErr.message : JSON.stringify(retryErr);
          Logger.warn('alarms publishReminder retry failed: ' + retryMessage);
          throw new Error('reminder_limit_reached');
        }
      } else {
        throw new Error(message.length > 0 ? message : 'publish_reminder_failed');
      }
    }
    const id: string = uuid();
    const entry: AlarmEntry = {
      id: id, reminderId: reminderId, title: title, fireDate: fireDate, timeZone: timeZone
    };
    const list: AlarmEntry[] = this.load();
    list.push(entry);
    this.save(list);
    Logger.info('alarms created id=' + id.slice(0, 8) + ' fire=' + fireDate);
    return {
      id: id, title: title, fireDate: fireDate, timeZone: timeZone,
      state: 'scheduled', operationId: String(args.operationId), status: 'created'
    };
  }

  private async list(): Promise<AlarmListed> {
    await this.pruneExpired();
    const rows: AlarmRow[] = [];
    this.load().forEach((entry: AlarmEntry) => {
      rows.push({
        id: entry.id, title: entry.title, fireDate: entry.fireDate,
        timeZone: entry.timeZone, state: 'scheduled'
      });
    });
    return {
      items: rows.slice(0, 100), truncated: rows.length > 100,
      source: 'whaleness-host-alarms'
    };
  }

  private async cancelAlarm(args: Record<string, Object>): Promise<AlarmCanceled> {
    const id: string = String(args.alarmId);
    const list: AlarmEntry[] = this.load();
    const index: number = list.findIndex((entry: AlarmEntry) => entry.id === id);
    if (index >= 0) {
      try {
        await reminderAgentManager.cancelReminder(list[index].reminderId);
      } catch (err) {
        Logger.warn('alarm cancel failed');
      }
      list.splice(index, 1);
      this.save(list);
    }
    return {
      id: id, operationId: String(args.operationId), status: 'cancelled'
    };
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool === 'alarms.create') {
      return await this.create(args) as Object;
    }
    if (tool === 'alarms.list') {
      return await this.list() as Object;
    }
    if (tool === 'alarms.cancel') {
      return await this.cancelAlarm(args) as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
  }
}

export const alarmsConnector: AlarmsConnector = new AlarmsConnector();
