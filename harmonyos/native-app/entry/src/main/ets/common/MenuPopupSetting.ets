/**
 * 输入条菜单（模型 / 权限 / ＋）的弹出方式：
 *   关闭（默认）：原生系统菜单（bindMenu，系统玻璃材质）—— 会抢焦点，输入法收起；
 *   开启：自定义弹层（bindPopup + focusable:false）—— 输入法保持展开，外观是自绘卡片。
 */
import { PreferencesStore } from 'nativecore';

export const MENU_KEEP_KEY: string = 'menuKeepKeyboard';
export const MENU_KEEP_DEFAULT: boolean = false;
const MENU_KEEP_PREF: string = 'menuKeepKeyboard';

/** 当前是否启用「保持输入法」弹层 */
export function currentMenuKeepKeyboard(): boolean {
  const stored: boolean | undefined = AppStorage.get<boolean>(MENU_KEEP_KEY);
  return stored === undefined ? MENU_KEEP_DEFAULT : stored;
}

/** 切换并落盘 */
export function applyMenuKeepKeyboard(value: boolean): void {
  AppStorage.setOrCreate<boolean>(MENU_KEEP_KEY, value);
  const prefs: PreferencesStore = PreferencesStore.get();
  if (prefs.isReady()) {
    prefs.putBoolean(MENU_KEEP_PREF, value);
  }
}

/** 启动时把落盘值灌回 AppStorage */
export function ensureMenuKeepKeyboard(): void {
  // 同样：已有内存值时不覆盖
  const live: boolean | undefined = AppStorage.get<boolean>(MENU_KEEP_KEY);
  if (live !== undefined) {
    return;
  }
  const prefs: PreferencesStore = PreferencesStore.get();
  let value: boolean = MENU_KEEP_DEFAULT;
  if (prefs.isReady()) {
    value = prefs.getBoolean(MENU_KEEP_PREF, MENU_KEEP_DEFAULT);
  }
  AppStorage.setOrCreate<boolean>(MENU_KEEP_KEY, value);
}
