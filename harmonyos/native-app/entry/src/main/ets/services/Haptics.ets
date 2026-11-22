import { vibrator } from '@kit.SensorServiceKit';
import { PreferencesStore } from 'nativecore';

/**
 * 全局触感反馈：强度档位来自「设置 → 震动反馈」
 * （PreferencesStore: hapticsLevel，off / light / medium / heavy）。
 * 时间型震动没有振幅参数，因此用时长区分强弱：轻 12ms / 中 24ms / 重 40ms。
 * 设置页的「测试震动」与首页右滑展开侧栏都走这里，保证和左侧栏设置一致。
 */
export class Haptics {
  /** 按当前设置触发一次触感；关闭档位或设备不支持时静默忽略 */
  static play(): void {
    const duration: number = Haptics.durationOf(Haptics.level());
    if (duration <= 0) {
      return;
    }
    try {
      vibrator.startVibration({ type: 'time', duration: duration }, { id: 0, usage: 'touch' }).catch(() => {
      });
    } catch (ignored) {
    }
  }

  /** 预览某个档位的触感（选择震动等级时立即感受强弱，不读写当前偏好） */
  static preview(level: string): void {
    const duration: number = Haptics.durationOf(level);
    if (duration <= 0) {
      return;
    }
    try {
      vibrator.startVibration({ type: 'time', duration: duration }, { id: 0, usage: 'touch' }).catch(() => {
      });
    } catch (ignored) {
    }
  }

  /** 设置页未写过时按「中」处理；兼容旧版按中文保存的档位 */
  private static level(): string {
    try {
      return PreferencesStore.get().getString('hapticsLevel', 'medium');
    } catch (ignored) {
      return 'medium';
    }
  }

  private static durationOf(level: string): number {
    if (level === 'light' || level === '轻') {
      return 12;
    }
    if (level === 'heavy' || level === '强') {
      return 40;
    }
    if (level === 'off' || level === '关闭') {
      return 0;
    }
    return 24;
  }
}
