import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { PreferencesStore } from '../common/PreferencesStore';
import { Logger } from '../common/Logger';

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
      this.authorized = result.authResults.every((code: number) => code === 0);
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

  private async create(args: Record<string, Object>): Promise<AlarmCreated> {
    const fireDate: string = String(args.fireDate);
    const date: Date = new Date(Date.parse(fireDate));
    const title: string = String(args.title);
    const timeZone: string = String(args.timeZone);
    const reminder: reminderAgentManager.ReminderRequestAlarm = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_ALARM,
      hour: date.getHours(),
      minute: date.getMinutes(),
      title: title,
      content: title,
      notificationId: Math.floor(Math.random() * 100000) + 1
    };
    const reminderId: number = await reminderAgentManager.publishReminder(reminder);
    const id: string = uuid();
    const entry: AlarmEntry = {
      id: id, reminderId: reminderId, title: title, fireDate: fireDate, timeZone: timeZone
    };
    const list: AlarmEntry[] = this.load();
    list.push(entry);
    this.save(list);
    return {
      id: id, title: title, fireDate: fireDate, timeZone: timeZone,
      state: 'scheduled', operationId: String(args.operationId), status: 'created'
    };
  }

  private list(): AlarmListed {
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
      return this.list() as Object;
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
