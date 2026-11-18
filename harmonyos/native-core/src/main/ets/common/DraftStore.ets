import { PreferencesStore } from './PreferencesStore';

/** 每个会话一份草稿，落 Preferences（对齐小程序 sessionDraftStore 的会话维度） */
const KEY_PREFIX: string = 'draft:';
/** 单条草稿上限：避免异常长文本把偏好文件撑大（正常输入远达不到） */
const MAX_LENGTH: number = 200000;

/**
 * 会话草稿存储：按 sessionId 各存一份文本，重启后仍在，发送成功即清掉。
 *
 * 只存文本，不存附件：附件的 uri 是临时授权，跨重启没有意义（和小程序一致）。
 * 内存里再缓存一层，Preferences 尚未就绪（冷启动前 100ms）时也不会丢草稿。
 */
export class DraftStore {
  private static instance: DraftStore = new DraftStore();
  private memory: Map<string, string> = new Map();

  static get(): DraftStore {
    return DraftStore.instance;
  }

  private key(sessionId: string): string {
    return KEY_PREFIX + sessionId;
  }

  load(sessionId: string): string {
    if (sessionId.length === 0) {
      return '';
    }
    const cached: string | undefined = this.memory.get(sessionId);
    if (cached !== undefined) {
      return cached;
    }
    const stored: string = PreferencesStore.get().getString(this.key(sessionId), '');
    this.memory.set(sessionId, stored);
    return stored;
  }

  save(sessionId: string, text: string): void {
    if (sessionId.length === 0) {
      return;
    }
    if (this.memory.get(sessionId) === text) {
      return;
    }
    this.memory.set(sessionId, text);
    const trimmed: string = text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) : text;
    PreferencesStore.get().putString(this.key(sessionId), trimmed);
  }

  /** 发送成功后清空该会话草稿 */
  clear(sessionId: string): void {
    if (sessionId.length === 0) {
      return;
    }
    this.memory.delete(sessionId);
    if (PreferencesStore.get().getString(this.key(sessionId), '').length > 0) {
      PreferencesStore.get().putString(this.key(sessionId), '');
    }
  }
}
