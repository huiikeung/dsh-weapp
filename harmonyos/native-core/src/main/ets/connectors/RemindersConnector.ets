import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';
import { NotificationService } from '../common/NotificationService';

interface ReminderRow {
  title: string;
  completed: boolean;
  dueDate: string | null;
}

interface RemindersResult {
  items: ReminderRow[];
  collectedAt: string;
  timeZone: string;
  source: string;
}

interface CreatedReminder {
  id: string;
  title: string;
  dueDate: string | null;
  timeZone: string;
  notify: boolean;
  priority: number;
  operationId: string;
  status: string;
}

class RemindersConnector implements ConnectorAdapter {
  id: string = 'reminders';
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
      Logger.warn('reminders authorize failed');
      return false;
    }
  }

  private async list(args: Record<string, Object>): Promise<RemindersResult> {
    const reminders: reminderAgentManager.ReminderRequest[] = await reminderAgentManager.getValidReminders();
    const rows: ReminderRow[] = [];
    reminders.forEach((item: reminderAgentManager.ReminderRequest) => {
      let due: string | null = null;
      if (item.reminderType === reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR) {
        const calendar = item as reminderAgentManager.ReminderRequestCalendar;
        const date: Date = new Date(calendar.dateTime.year, calendar.dateTime.month - 1, calendar.dateTime.day,
          calendar.dateTime.hour, calendar.dateTime.minute, 0);
        due = date.toISOString();
      }
      rows.push({
        title: item.title !== undefined ? item.title : '提醒',
        completed: false,
        dueDate: due
      });
    });
    return {
      items: rows.slice(0, 100),
      collectedAt: new Date().toISOString(),
      timeZone: String(args.timeZone),
      source: 'whaleness-agent-reminders'
    };
  }

  private async create(args: Record<string, Object>): Promise<CreatedReminder> {
    const title: string = String(args.title);
    const timeZone: string = String(args.timeZone);
    const notify: boolean = args.notify !== false;
    const priority: number = args.priority !== undefined ? Number(args.priority) : 0;
    const due: string | null = args.dueDate !== undefined ? String(args.dueDate) : null;
    const reminder: reminderAgentManager.ReminderRequestTimer = {
      reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_TIMER,
      title: title,
      content: args.notes !== undefined ? String(args.notes) : '',
      notificationId: Math.floor(Math.random() * 100000) + 1,
      triggerTimeInSeconds: due !== null ? Math.max(1, Math.floor((Date.parse(due) - Date.now()) / 1000)) : 60
    };
    let id: number = 0;
    try {
      id = await reminderAgentManager.publishReminder(reminder);
    } catch (err) {
      const message: string = err instanceof Error ? err.message : JSON.stringify(err);
      Logger.warn('reminders publish failed: ' + message);
      // 1700002：本 App 的提醒数量达到系统上限（历史测试/过期提醒也算）。清一次再重试。
      if (message.indexOf('exceeds the limit') >= 0 || message.indexOf('1700002') >= 0) {
        Logger.warn('reminders over limit, cancel all before retry');
        try {
          await reminderAgentManager.cancelAllReminders();
        } catch (cancelErr) {
          Logger.warn('reminders cancelAll failed');
        }
        id = await reminderAgentManager.publishReminder(reminder);
      } else {
        throw new Error(message);
      }
    }
    return {
      id: String(id),
      title: title,
      dueDate: due,
      timeZone: timeZone,
      notify: notify,
      priority: priority,
      operationId: String(args.operationId),
      status: 'created'
    };
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool === 'reminders.list') {
      return await this.list(args) as Object;
    }
    if (tool === 'reminders.create') {
      return await this.create(args) as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
  }
}

export const remindersConnector: RemindersConnector = new RemindersConnector();
