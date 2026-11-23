import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Logger } from './Logger';

const STORE_NAME: string = 'whaletail';

/** 本地偏好存储（对应小程序 utils/local-cache 的宿主部分）。 */
export class PreferencesStore {
  private static instance: PreferencesStore = new PreferencesStore();
  private store: preferences.Preferences | null = null;

  static get(): PreferencesStore {
    return PreferencesStore.instance;
  }

  async init(context: common.UIAbilityContext): Promise<void> {
    this.store = await preferences.getPreferences(context, { name: STORE_NAME });
    Logger.info('preferences ready');
  }

  isReady(): boolean {
    return this.store !== null;
  }

  /** 当前存储里的全部 key（用于一次性迁移旧版本按主机分键的开关）。 */
  allKeys(): string[] {
    if (this.store === null) {
      return [];
    }
    try {
      const all: Object = this.store.getAllSync();
      return Object.keys(all as Record<string, Object>);
    } catch (err) {
      return [];
    }
  }

  /** 删除一个 key（迁移完成后清理旧键）。 */
  deleteKey(key: string): void {
    if (this.store === null) {
      return;
    }
    try {
      this.store.deleteSync(key);
      this.store.flush();
    } catch (err) {
    }
  }

  getString(key: string, fallback: string): string {
    if (this.store === null) {
      return fallback;
    }
    const value: preferences.ValueType = this.store.getSync(key, fallback);
    if (typeof value === 'string') {
      return value;
    }
    return fallback;
  }

  putString(key: string, value: string): void {
    if (this.store === null) {
      return;
    }
    this.store.putSync(key, value);
    this.store.flush().catch((err: BusinessError) => {
      Logger.error('preferences flush failed: ' + JSON.stringify(err));
    });
  }

  /** 读取布尔偏好（小程序 wx.getStorageSync 布尔值的对应实现）。 */
  getBoolean(key: string, fallback: boolean): boolean {
    if (this.store === null) {
      return fallback;
    }
    const value: preferences.ValueType = this.store.getSync(key, fallback);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      return value === 'true';
    }
    return fallback;
  }

  /** 写入布尔偏好。 */
  putBoolean(key: string, value: boolean): void {
    if (this.store === null) {
      return;
    }
    this.store.putSync(key, value);
    this.store.flush().catch((err: BusinessError) => {
      Logger.error('preferences flush failed: ' + JSON.stringify(err));
    });
  }

  /** 统计前缀匹配的本地键值缓存字节数（近似：字符串长度，用于「存储空间」）。 */
  localCacheBytes(prefixes: string[]): number {
    if (this.store === null) {
      return 0;
    }
    let total: number = 0;
    const all: Object = this.store.getAllSync();
    const rec: Record<string, Object> = all as Record<string, Object>;
    const keys: string[] = Object.keys(rec);
    for (const key of keys) {
      let matched: boolean = false;
      for (const prefix of prefixes) {
        if (key.indexOf(prefix) === 0) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        continue;
      }
      const value: Object = rec[key];
      total += typeof value === 'string' ? (value as string).length : JSON.stringify(value).length;
    }
    return total;
  }

  /** 删除前缀匹配的本地缓存键，返回释放的字节数（近似）。 */
  removeLocalCacheByPrefixes(prefixes: string[]): number {
    if (this.store === null) {
      return 0;
    }
    let freed: number = 0;
    const all: Object = this.store.getAllSync();
    const rec: Record<string, Object> = all as Record<string, Object>;
    const keys: string[] = Object.keys(rec);
    for (const key of keys) {
      let matched: boolean = false;
      for (const prefix of prefixes) {
        if (key.indexOf(prefix) === 0) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        continue;
      }
      const value: Object = rec[key];
      freed += typeof value === 'string' ? (value as string).length : JSON.stringify(value).length;
      try {
        this.store.deleteSync(key);
      } catch (err) {
        // 单项删除失败不影响其它键
      }
    }
    this.store.flush().catch((err: BusinessError) => {
      Logger.error('preferences flush failed: ' + JSON.stringify(err));
    });
    return freed;
  }

  /** 读取数字偏好（字符串形式存储，兼容小程序）。 */
  getNumber(key: string, fallback: number): number {
    const raw: string = this.getString(key, '');
    if (raw.length === 0) {
      return fallback;
    }
    const parsed: number = Number(raw);
    if (isNaN(parsed)) {
      return fallback;
    }
    return parsed;
  }

  /** 写入数字偏好（以字符串存储，便于与小程序共享同一份配置）。 */
  putNumber(key: string, value: number): void {
    this.putString(key, String(value));
  }
}
