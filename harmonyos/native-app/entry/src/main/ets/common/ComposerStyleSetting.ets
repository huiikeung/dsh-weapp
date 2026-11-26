/**
 * 工作模式对话页输入条样式：
 *   开启（默认）：Bot 式布局（左箭头圆钮 + 输入胶囊 + 右蓝钮，三个玻璃圆自箭头向上展开）；
 *   关闭：原来的玻璃胶囊（左 + 圆钮、chip 行、右侧主按钮）；
 *         左圆钮是向上箭头，展开后变成竖排三个按钮（+ / 权限 / 模型）+ 向下箭头。
 */
import { PreferencesStore } from 'nativecore';

export const COMPOSER_COMPACT_KEY: string = 'composerCompactStyle';
export const COMPOSER_COMPACT_DEFAULT: boolean = true;
const COMPOSER_COMPACT_PREF: string = 'composerCompactStyle';

export function currentComposerCompact(): boolean {
  const stored: boolean | undefined = AppStorage.get<boolean>(COMPOSER_COMPACT_KEY);
  return stored === undefined ? COMPOSER_COMPACT_DEFAULT : stored;
}

export function applyComposerCompact(value: boolean): void {
  AppStorage.setOrCreate<boolean>(COMPOSER_COMPACT_KEY, value);
  const prefs: PreferencesStore = PreferencesStore.get();
  if (prefs.isReady()) {
    prefs.putBoolean(COMPOSER_COMPACT_PREF, value);
  }
}

export function ensureComposerCompact(): void {
  // 已经有内存值时不要覆盖：否则「设置里刚打开 → 回到会话页」会被落盘的旧值冲掉
  const live: boolean | undefined = AppStorage.get<boolean>(COMPOSER_COMPACT_KEY);
  if (live !== undefined) {
    return;
  }
  const prefs: PreferencesStore = PreferencesStore.get();
  let value: boolean = COMPOSER_COMPACT_DEFAULT;
  if (prefs.isReady()) {
    value = prefs.getBoolean(COMPOSER_COMPACT_PREF, COMPOSER_COMPACT_DEFAULT);
  }
  AppStorage.setOrCreate<boolean>(COMPOSER_COMPACT_KEY, value);
}
