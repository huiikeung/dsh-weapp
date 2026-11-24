/**
 * Bot「完成提醒」本地通知（对 docs/bot-mode-ios-spec.md §9.6「done 提醒」的鸿蒙实现）。
 *
 * 硬约束：
 * - 只由 BotStore 的实时 notice 事件（kind=`done`）调用；notices 历史回放不触发，绝不猜测任务完成。
 * - 是否「前台且正打开该聊天」由 BotStore 判定后决定是否调用；done 不计未读，这里不碰 unreadCounts。
 * - 去重：同一 notice（boot:seq）只发一次；boot 变化 / 重连时由 BotStore 调 reset() 清空。
 * - 失败静默：无通知权限、服务未初始化、context 缺失、系统 API 异常等一律 try/catch 吞掉并 warn，
 *   不影响 Bot 主流程（不改变连接、recent、未读、发布）。
 * - 开关：PreferencesStore 的 botDoneNotifyEnabled，默认 '1' 开启。
 */
import { Logger } from '../common/Logger';
import { NotificationService } from '../common/NotificationService';
import { PreferencesStore } from '../common/PreferencesStore';

const FALLBACK_TITLE: string = 'DS Bot';
/** 正文截断长度（含省略号），规格要求 ~120 字 */
const MAX_BODY: number = 120;
/** 开关偏好键（字符串 '1' 开启 / '0' 关闭，缺省开启） */
const ENABLED_KEY: string = 'botDoneNotifyEnabled';
/** 已发集合上限：超长会话兜底，避免 Set 无界增长 */
const MAX_SEEN: number = 512;

export class BotNotify {
  /** 已发过的 notice（boot:seq），同一事件只发一次 */
  private static seen: Set<string> = new Set<string>();

  /** boot 变化 / 重连（BotStore.refreshAll）时清空，避免旧 boot 的 done 重复提醒 */
  static reset(): void {
    BotNotify.seen.clear();
  }

  /** 读取「Bot 完成提醒」开关：缺省 '1' 开启；Preferences 未就绪时保守跳过（先不打扰用户）。 */
  static isEnabled(): boolean {
    try {
      const prefs: PreferencesStore = PreferencesStore.get();
      if (!prefs.isReady()) {
        return false;
      }
      // 约定以字符串 '1'/'0' 存（默认 '1' 开启）；同时兼容页面用布尔值存储的情况。
      const raw: string = prefs.getString(ENABLED_KEY, '').trim().toLowerCase();
      if (raw.length > 0) {
        return raw === '1' || raw === 'true';
      }
      return prefs.getBoolean(ENABLED_KEY, true);
    } catch (error) {
      Logger.warn('bot notify switch failed: ' + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  /**
   * 发出「完成提醒」。
   * noticeId 用 boot:seq 去重；chatId 决定通知 id/分组（同一聊天新完成提醒覆盖旧的）；
   * chatName 取不到时回退「DS Bot」；正文只用主机下发的 notice 文本，不编造内容。
   */
  static onDoneNotice(noticeId: string, chatId: string, chatName: string, body: string): void {
    try {
      const id: string = noticeId.length > 0 ? noticeId : (chatId + ':' + body);
      if (BotNotify.seen.has(id)) {
        return;
      }
      if (BotNotify.seen.size >= MAX_SEEN) {
        BotNotify.seen.clear();
      }
      BotNotify.seen.add(id);
      if (!BotNotify.isEnabled()) {
        Logger.info('bot notify skipped: disabled id=' + id);
        return;
      }
      const title: string = chatName.trim().length > 0 ? chatName.trim() : FALLBACK_TITLE;
      const content: string = BotNotify.bodyText(body);
      if (content.length === 0) {
        Logger.warn('bot notify skipped: empty notice text id=' + id);
        return;
      }
      // 复用现有 NotificationService。注意：通知服务会把 sessionId 塞进点击回调的 Want 参数，
      // EntryAbility 会把它当作工作会话 id 去 open()；Bot 聊天 id 传过去会打开不存在的会话。
      // 本次不改 EntryAbility/页面，所以传空 sessionId（点击只回前台，不做 Bot 深链）；
      // 代价是 Bot 完成提醒共用一个通知 id（新提醒替换旧提醒）。
      BotNotify.deliver(id, '', title, content);
    } catch (error) {
      Logger.warn('bot notify failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /** 调系统通知并兜底：异步失败只 warn，不外抛、不影响 Bot 主流程。 */
  private static deliver(id: string, sessionKey: string, title: string, content: string): void {
    try {
      NotificationService.notifyTaskDone(sessionKey, title, content).then((sent: boolean) => {
        if (!sent) {
          Logger.warn('bot notify not delivered id=' + id);
        }
      }).catch((error: Error) => {
        Logger.warn('bot notify deliver failed: ' + error.message);
      });
    } catch (error) {
      Logger.warn('bot notify invoke failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /** notice 正文：压平换行、去首尾空白、截断到 ~120 字（内容全部来自主机 notice.text）。 */
  private static bodyText(value: string): string {
    const flat: string = value.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ').trim();
    if (flat.length <= MAX_BODY) {
      return flat;
    }
    return flat.substring(0, MAX_BODY - 1) + '…';
  }
}
