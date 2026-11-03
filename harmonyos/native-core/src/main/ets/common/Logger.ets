import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN: number = 0x0001;
const TAG: string = 'WhaletailApp';

/** 统一日志出口：后续接 hilog 落盘/上报都在这里改。 */
export class Logger {
  static debug(message: string): void {
    hilog.debug(DOMAIN, TAG, '%{public}s', message);
  }

  static info(message: string): void {
    hilog.info(DOMAIN, TAG, '%{public}s', message);
  }

  static warn(message: string): void {
    hilog.warn(DOMAIN, TAG, '%{public}s', message);
  }

  static error(message: string): void {
    hilog.error(DOMAIN, TAG, '%{public}s', message);
  }
}
