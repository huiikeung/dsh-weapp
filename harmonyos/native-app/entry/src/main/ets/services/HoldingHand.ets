import { motion } from '@kit.MultimodalAwarenessKit';

/**
 * 智感握姿（HarmonyOS 原生能力）：订阅左手 / 右手持握与操作手变化。
 *
 * - `holdingHandChanged`（API 20+，权限 ohos.permission.DETECT_GESTURE，system_grant）
 * - `operatingHandChanged`（API 15+，作为低版本/无持握数据时的兜底）
 *
 * 结果统一写进 AppStorage('holdingHand')：
 *   1 = 左手，2 = 右手，3 = 双手，0 = 未持握，16 = 未知
 * 不支持或未授权时静默跳过，页面保持默认（胶囊在右侧）。
 */
export class HoldingHand {
  static readonly NOT_HELD: number = 0;
  static readonly LEFT: number = 1;
  static readonly RIGHT: number = 2;
  static readonly BOTH: number = 3;
  static readonly UNKNOWN: number = 16;

  private static started: boolean = false;
  private static holdHandler: ((status: motion.HoldingHandStatus) => void) | null = null;
  private static opHandler: ((status: motion.OperatingHandStatus) => void) | null = null;

  static start(): void {
    if (HoldingHand.started) {
      return;
    }
    // ① 持握手（API 20+）：手掌握持手机的那只手
    try {
      const holdHandler: (status: motion.HoldingHandStatus) => void = (status: motion.HoldingHandStatus) => {
        console.info('[HoldHand] holding=' + status);
        AppStorage.setOrCreate<number>('holdingHand', Number(status));
      };
      HoldingHand.holdHandler = holdHandler;
      motion.on('holdingHandChanged', holdHandler);
      console.info('[HoldHand] holdingHandChanged ok');
    } catch (err) {
      console.info('[HoldHand] holdingHandChanged failed: ' + JSON.stringify(err));
    }
    // ② 操作手（API 15+）：正在用手指操作的那只手，作为兜底
    try {
      const opHandler: (status: motion.OperatingHandStatus) => void = (status: motion.OperatingHandStatus) => {
        const mapped: number = status === motion.OperatingHandStatus.LEFT_HAND_OPERATED
          ? HoldingHand.LEFT
          : (status === motion.OperatingHandStatus.RIGHT_HAND_OPERATED ? HoldingHand.RIGHT : -1);
        if (mapped < 0) {
          return;
        }
        console.info('[HoldHand] operating=' + status);
        // 已有持握数据时以持握为准，避免两种信号互相覆盖
        const current: number = AppStorage.get<number>('holdingHand') ?? 0;
        if (current === 0 || current === 16) {
          AppStorage.setOrCreate<number>('holdingHand', mapped);
        }
      };
      HoldingHand.opHandler = opHandler;
      motion.on('operatingHandChanged', opHandler);
      console.info('[HoldHand] operatingHandChanged ok');
    } catch (err) {
      console.info('[HoldHand] operatingHandChanged failed: ' + JSON.stringify(err));
    }
    HoldingHand.started = true;
  }

  static stop(): void {
    if (!HoldingHand.started) {
      return;
    }
    try {
      const holdHandler = HoldingHand.holdHandler;
      if (holdHandler !== null) {
        motion.off('holdingHandChanged', holdHandler);
      }
    } catch (ignored) {
    }
    try {
      const opHandler = HoldingHand.opHandler;
      if (opHandler !== null) {
        motion.off('operatingHandChanged', opHandler);
      }
    } catch (ignored) {
    }
    HoldingHand.holdHandler = null;
    HoldingHand.opHandler = null;
    HoldingHand.started = false;
  }
}
