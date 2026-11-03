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
}
