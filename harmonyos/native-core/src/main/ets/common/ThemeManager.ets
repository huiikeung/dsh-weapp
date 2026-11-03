import { ConfigurationConstant } from '@kit.AbilityKit';
import { PreferencesStore } from './PreferencesStore';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_KEY_MODE: string = 'themeMode';
export const THEME_KEY_DARK: string = 'isDark';

/**
 * 主题管理：跟随系统 / 强制浅色 / 强制深色，等价于小程序 utils/theme.js。
 * 解析结果写进 AppStorage，页面用 @StorageLink 直接响应。
 */
export class ThemeManager {
  private static instance: ThemeManager = new ThemeManager();
  private mode: ThemeMode = 'dark';
  private systemDark: boolean = false;

  static get(): ThemeManager {
    return ThemeManager.instance;
  }

  init(colorMode?: ConfigurationConstant.ColorMode): void {
    const saved: string = PreferencesStore.get().getString(THEME_KEY_MODE, 'dark');
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      this.mode = saved as ThemeMode;
    } else {
      this.mode = 'system';
    }
    if (colorMode !== undefined) {
      this.systemDark = colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    }
    this.publish();
  }

  setMode(mode: ThemeMode): void {
    this.mode = mode;
    PreferencesStore.get().putString(THEME_KEY_MODE, mode);
    this.publish();
  }

  getMode(): ThemeMode {
    return this.mode;
  }

  applySystemColorMode(colorMode?: ConfigurationConstant.ColorMode): void {
    if (colorMode !== undefined) {
      this.systemDark = colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
    }
    this.publish();
  }

  isDark(): boolean {
    return this.mode === 'dark' || (this.mode === 'system' && this.systemDark);
  }

  private publish(): void {
    AppStorage.setOrCreate<boolean>(THEME_KEY_DARK, this.isDark());
    AppStorage.setOrCreate<string>(THEME_KEY_MODE, this.mode);
  }
}
