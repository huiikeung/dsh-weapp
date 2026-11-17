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
