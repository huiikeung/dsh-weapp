import { common, Want, wantAgent } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';

/** Best-effort local notification equivalent for background/session updates. */
export class NotificationService {
  static async ensureAuthorized(context: common.UIAbilityContext): Promise<boolean> {
    try {
      if (await notificationManager.isNotificationEnabled()) return true;
      await notificationManager.requestEnableNotification(context);
      return await notificationManager.isNotificationEnabled();
    } catch (err) {
      return false;
    }
  }

  static async publishSessionUpdate(context: common.UIAbilityContext, title: string, text: string, sessionId: string = '', id: number = 7001): Promise<boolean> {
    if (title.trim().length === 0 || text.trim().length === 0) return false;
    try {
      let agent: object | null = null;
      try {
        const want: Want = {
          deviceId: '',
          bundleName: context.abilityInfo.bundleName,
          abilityName: 'EntryAbility',
          parameters: { sessionId: sessionId }
        };
        const info: wantAgent.WantAgentInfo = {
          wants: [want],
          operationType: wantAgent.OperationType.START_ABILITY,
          requestCode: 0
        };
        agent = await wantAgent.getWantAgent(info);
      } catch (err) {
        agent = null;
      }
      await notificationManager.publish({
        id: id,
        groupName: sessionId.length > 0 ? 'dsh-session-' + sessionId : 'dsh-session',
        notificationSlotType: notificationManager.SlotType.SOCIAL_COMMUNICATION,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: { title: title, text: text }
        },
        wantAgent: agent ?? undefined
      });
      return true;
    } catch (err) {
      return false;
    }
  }

  static async cancel(id: number): Promise<boolean> {
    try {
      await notificationManager.cancel(id);
      return true;
    } catch (err) {
      return false;
    }
  }
}
