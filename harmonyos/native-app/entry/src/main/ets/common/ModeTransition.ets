/**
 * 模式切换波纹的全局触发入口：写入点击点与目标模式底色，并递增序号触发 ModeWave。
 * 页面切换必须用无动画的 push/pop（animated=false），避免左右推屏转场。
 */
export function startModeWave(x: number, y: number, color: string): void {
  AppStorage.setOrCreate<number>('modeWaveX', x);
  AppStorage.setOrCreate<number>('modeWaveY', y);
  AppStorage.setOrCreate<string>('modeWaveColor', color);
  const seq: number = AppStorage.get<number>('modeWaveSeq') ?? 0;
  AppStorage.setOrCreate<number>('modeWaveSeq', seq + 1);
}
