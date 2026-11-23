import { Logger, PreferencesStore } from 'nativecore';
import { PRIVACY_POLICY_UPDATED_AT, USER_AGREEMENT_VERSION } from '../common/LegalDocs';

const CONSENT_KEY: string = 'privacyConsentVersion';

/**
 * 当前协议版本 = 隐私政策更新日期 + 用户协议版本。
 * 任一变化都会让已同意的用户在下次启动时重新确认。
 */
export function currentConsentVersion(): string {
  return PRIVACY_POLICY_UPDATED_AT + '|' + USER_AGREEMENT_VERSION;
}

/**
 * 首次启动隐私同意。
 *
 * 未同意前：界面用系统弹窗盖住整个应用（见 Index 的 showConsentDialog），启动流程不初始化隧道、
 * 不自动连接网关（见 EntryAbility.startNetworking）。
 */
export class PrivacyConsent {
  /** 同意后要补执行一次的动作（目前只有启动联网） */
  private static grantedListeners: Array<() => void> = [];

  /** 是否已同意「当前版本」的协议 */
  static isAgreed(): boolean {
    return PreferencesStore.get().getString(CONSENT_KEY, '') === currentConsentVersion();
  }

  /** 用户点「同意并继续」：落盘 + 刷新 AppStorage + 通知启动流程开始联网 */
  static agree(): void {
    PreferencesStore.get().putString(CONSENT_KEY, currentConsentVersion());
    AppStorage.setOrCreate<string>('privacyConsentState', 'granted');
    const listeners: Array<() => void> = PrivacyConsent.grantedListeners;
    PrivacyConsent.grantedListeners = [];
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        Logger.error('privacy consent listener failed: ' + JSON.stringify(err));
      }
    }
  }

  /**
   * 注册「同意后执行一次」的动作。
   * 已同意时这里不会触发，调用方需要自己立即执行。
   */
  static onAgreed(listener: () => void): void {
    PrivacyConsent.grantedListeners.push(listener);
  }
}
