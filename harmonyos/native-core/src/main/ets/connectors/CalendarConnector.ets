import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { calendarManager } from '@kit.CalendarKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';

interface BusyInterval {
  start: string;
  end: string;
}

interface BusyResult {
  busyIntervals: BusyInterval[];
  collectedAt: string;
  timeZone: string;
  source: string;
}

interface CreatedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  timeZone: string;
  allDay: boolean;
  operationId: string;
  status: string;
}

function iso(date: Date): string {
  return date.toISOString();
}

function parseDate(value: string): Date {
  return new Date(value);
}

class CalendarConnector implements ConnectorAdapter {
  id: string = 'calendar';
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
    const permissions: Permissions[] = ['ohos.permission.READ_CALENDAR', 'ohos.permission.WRITE_CALENDAR'];
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(context, permissions);
      this.authorized = result.authResults.every((code: number) => code === 0);
      return this.authorized;
    } catch (err) {
      Logger.warn('calendar authorize failed');
      return false;
    }
  }

  private manager(context: common.UIAbilityContext): calendarManager.CalendarManager {
    return calendarManager.getCalendarManager(context);
  }

  private async calendars(context: common.UIAbilityContext): Promise<calendarManager.Calendar[]> {
    return await this.manager(context).getAllCalendars();
  }

  private async busy(context: common.UIAbilityContext, args: Record<string, Object>): Promise<BusyResult> {
    const startMs: number = Date.parse(String(args.start));
    const endMs: number = Date.parse(String(args.end));
    const list: calendarManager.Calendar[] = await this.calendars(context);
    const intervals: BusyInterval[] = [];
    for (let i = 0; i < list.length; i++) {
      try {
        const filter: calendarManager.EventFilter = calendarManager.EventFilter.filterByTime(startMs / 1000, endMs / 1000);
        const events: calendarManager.Event[] = await list[i].getEvents(filter);
        events.forEach((event: calendarManager.Event) => {
          const s: number = event.startTime * 1000;
          const e: number = event.endTime * 1000;
          if (e > startMs && s < endMs) {
            intervals.push({
              start: iso(new Date(Math.max(s, startMs))),
              end: iso(new Date(Math.min(e, endMs)))
            });
          }
        });
      } catch (err) {
        Logger.warn('calendar events read failed');
      }
    }
    return {
      busyIntervals: intervals.slice(0, 2000),
      collectedAt: iso(new Date()),
      timeZone: String(args.timeZone),
      source: 'harmonyos-calendar'
    };
  }

  private async create(context: common.UIAbilityContext, args: Record<string, Object>): Promise<CreatedEvent> {
    const list: calendarManager.Calendar[] = await this.calendars(context);
    if (list.length === 0) {
      throw new Error('no_calendar');
    }
    const startMs: number = Date.parse(String(args.start));
    const endMs: number = Date.parse(String(args.end));
    const allDay: boolean = args.allDay === true;
    const event: calendarManager.Event = {
      title: String(args.title),
      type: calendarManager.EventType.NORMAL,
      startTime: Math.floor(startMs / 1000),
      endTime: Math.floor(endMs / 1000),
      isAllDay: allDay,
      description: args.notes !== undefined ? String(args.notes) : '',
      location: { location: args.location !== undefined ? String(args.location) : '' } as calendarManager.Location
    };
    if (args.alertMinutesBefore !== undefined) {
      event.reminderTime = [Number(args.alertMinutesBefore)];
    }
    const id: number = await list[0].addEvent(event);
    return {
      id: String(id),
      title: String(args.title),
      start: iso(new Date(startMs)),
      end: iso(new Date(endMs)),
      timeZone: String(args.timeZone),
      allDay: allDay,
      operationId: String(args.operationId),
      status: 'created'
    };
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    const context: common.UIAbilityContext | undefined = AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
    if (context === undefined) {
      throw new Error('no_context');
    }
    if (tool === 'calendar.busy') {
      return await this.busy(context, args) as Object;
    }
    if (tool === 'calendar.create') {
      return await this.create(context, args) as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
  }
}

export const calendarConnector: CalendarConnector = new CalendarConnector();
