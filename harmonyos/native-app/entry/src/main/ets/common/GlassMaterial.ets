/**
 * 沉浸光感材质档位：设置页选一次，所有用 HdsGlassSurface 的地方（首页按钮、置底按钮、
 * 模式按钮、消息队列/任务/目标面板）自动跟着换，不需要逐处改。
 *
 * 数值与 hdsMaterial.MaterialLevel 一致：EXQUISITE=0 / GENTLE=1 / SMOOTH=2 / ADAPTIVE=10
 */
import { hdsMaterial } from '@kit.UIDesignKit';
import { PreferencesStore } from 'nativecore';

export const GLASS_LEVEL_KEY: string = 'glassMaterialLevel';
const GLASS_LEVEL_PREF: string = 'glassMaterialLevel';

export interface GlassLevelOption {
  label: string;
  detail: string;
  value: number;
}

export const GLASS_LEVEL_OPTIONS: GlassLevelOption[] = [
  { label: '精美', detail: '最厚重，折射与高光最强', value: hdsMaterial.MaterialLevel.EXQUISITE as number },
  { label: '轻柔', detail: '中等厚度，省电一些', value: hdsMaterial.MaterialLevel.GENTLE as number },
  { label: '流畅', detail: '最薄，低算力设备更稳', value: hdsMaterial.MaterialLevel.SMOOTH as number },
  { label: '自适应', detail: '由系统按算力自动选档', value: hdsMaterial.MaterialLevel.ADAPTIVE as number }
];

/** 默认档：自适应（交给系统按设备算力选档） */
export const GLASS_LEVEL_DEFAULT: number = hdsMaterial.MaterialLevel.ADAPTIVE as number;

/** 档位 → 中文名（设置页与调试用） */
export function glassLevelLabel(value: number): string {
  for (let i = 0; i < GLASS_LEVEL_OPTIONS.length; i++) {
    if (GLASS_LEVEL_OPTIONS[i].value === value) {
      return GLASS_LEVEL_OPTIONS[i].label;
    }
  }
  return '自适应';
}

/** 当前档位（AppStorage 为准，缺失时回默认） */
export function currentGlassLevel(): number {
  const stored: number | undefined = AppStorage.get<number>(GLASS_LEVEL_KEY);
  return stored === undefined ? GLASS_LEVEL_DEFAULT : stored;
}

/** 当前档位（强类型版本，直接喂给 systemMaterialEffect.materialLevel） */
export function currentGlassMaterialLevel(): hdsMaterial.MaterialLevel {
  const stored: number | undefined = AppStorage.get<number>(GLASS_LEVEL_KEY);
  const value: number = stored === undefined ? GLASS_LEVEL_DEFAULT : stored;
  return value as hdsMaterial.MaterialLevel;
}

/** 切换档位：立刻生效（AppStorage 驱动所有组件）+ 落盘 */
export function applyGlassLevel(value: number): void {
  AppStorage.setOrCreate<number>(GLASS_LEVEL_KEY, value);
  const prefs: PreferencesStore = PreferencesStore.get();
  if (prefs.isReady()) {
    prefs.putString(GLASS_LEVEL_PREF, value.toString());
  }
}

/** 启动时把落盘值灌回 AppStorage */
export function ensureGlassLevel(): void {
  const prefs: PreferencesStore = PreferencesStore.get();
  let value: number = GLASS_LEVEL_DEFAULT;
  if (prefs.isReady()) {
    const raw: string = prefs.getString(GLASS_LEVEL_PREF, GLASS_LEVEL_DEFAULT.toString());
    const parsed: number = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed)) {
      value = parsed;
    }
  }
  AppStorage.setOrCreate<number>(GLASS_LEVEL_KEY, value);
}
