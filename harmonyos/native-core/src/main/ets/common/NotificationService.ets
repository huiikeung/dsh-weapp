import { common, Want, wantAgent } from '@kit.AbilityKit';
import { notificationManager } from '@kit.NotificationKit';
import { Logger } from './Logger';

/** Best-effort local notification equivalent for background/session updates. */
export class NotificationService {
  /** 由 EntryAbility 注入：没有页面上下文时（后台收到 turn/end）也能发系统通知 */
  private static abilityContext: common.UIAbilityContext | null = null;

  static attachContext(context: common.UIAbilityContext): void {
    NotificationService.abilityContext = context;
  }

  /**
   * 回合完成通知：已授权时才发，同一会话复用同一个 id（新通知替换旧通知）。
   * 调用方负责判断开关与前后台状态。
   */
  static async notifyTaskDone(sessionId: string, title: string, text: string): Promise<boolean> {
    const context: common.UIAbilityContext | null = NotificationService.abilityContext;
    if (context === null) {
      Logger.warn('notify skipped: no ability context');
      return false;
    }
    try {
      const enabled: boolean = await notificationManager.isNotificationEnabled();
      Logger.info('notify check session=' + sessionId + ' systemEnabled=' + enabled);
      if (!enabled) {
        Logger.warn('notify skipped: system notification disabled');
        return false;
      }
      await NotificationService.ensureHighSlot();
      let hash: number = 0;
      for (let i = 0; i < sessionId.length; i++) {
        hash = (hash * 31 + sessionId.charCodeAt(i)) % 90000;
      }
      const ok: boolean = await NotificationService.publishSessionUpdate(context, title, text, sessionId, 7100 + hash);
      Logger.info('notify publish result=' + ok + ' id=' + (7100 + hash) + ' titleLen=' + title.length);
      return ok;
    } catch (err) {
      Logger.warn('notify failed: ' + String(err));
      return false;
    }
  }

  /**
   * 横幅通知要求通知通道等级为 LEVEL_HIGH；这里确保 SOCIAL_COMMUNICATION 通道存在且等级正确
   * （历史版本可能创建过低等级通道，需要删掉重建）。
   */
  static async ensureHighSlot(): Promise<void> {
    try {
      const slot: notificationManager.NotificationSlot = await notificationManager.getSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
      const level: number = (slot.notificationLevel !== undefined ? slot.notificationLevel
        : (slot.level !== undefined ? slot.level : 0));
      Logger.info('notify slot level=' + level + ' type=' + String(slot.notificationType));
      if (level >= notificationManager.SlotLevel.LEVEL_HIGH) {
        return;
      }
      await notificationManager.removeSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
      await notificationManager.addSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
      Logger.info('notify slot recreated as high level');
    } catch (err) {
      try {
        await notificationManager.addSlot(notificationManager.SlotType.SOCIAL_COMMUNICATION);
        Logger.info('notify slot created');
      } catch (inner) {
        Logger.warn('notify slot ensure failed: ' + String(inner));
      }
    }
  }

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
        // 角标：通知携带 badgeNumber=1，桌面图标显示未读角标（回前台会清零）
        badgeNumber: 1,
        content: {
          notificationContentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT,
          normal: { title: title, text: text }
        },
        wantAgent: agent ?? undefined
      });
      try {
        await notificationManager.setBadgeNumber(1);
      } catch (badgeErr) {
        Logger.warn('notify badge failed: ' + String(badgeErr));
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /** 回前台/打开会话后清除桌面角标。 */
  static async clearBadge(): Promise<void> {
    try {
      await notificationManager.setBadgeNumber(0);
    } catch (err) {
      Logger.warn('notify clear badge failed: ' + String(err));
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
