import { display } from '@kit.ArkUI';

/**
 * 模式切换波纹（对齐 iOS WorkspaceModeWave）：
 * 以点击点为圆心，用目标模式的底色画一个扩张圆覆盖整屏，覆盖完成后由调用方无动画切换页面，
 * 再淡出圆层露出新页面。整层不参与命中测试、不阻塞交互。
 */
@Component
export struct ModeWave {
  @StorageLink('modeWaveSeq') @Watch('onSeq') seq: number = 0;
  @StorageLink('modeWaveX') waveX: number = 0;
  @StorageLink('modeWaveY') waveY: number = 0;
  @StorageLink('modeWaveColor') waveColor: string = '#F4F1FA';
  @State radius: number = 0;
  @State waveFade: number = 1;
  @State active: boolean = false;
  private fadeTimer: number = -1;
  private endTimer: number = -1;

  aboutToDisappear(): void {
    if (this.fadeTimer > 0) {
      clearTimeout(this.fadeTimer);
    }
    if (this.endTimer > 0) {
      clearTimeout(this.endTimer);
    }
  }

  onSeq(): void {
    if (this.seq <= 0) {
      return;
    }
    this.active = true;
    this.waveFade = 1;
    this.radius = 0;
    let w: number = 400;
    let h: number = 800;
    try {
      const info = display.getDefaultDisplaySync();
      w = this.getUIContext().px2vp(info.width);
      h = this.getUIContext().px2vp(info.height);
    } catch (err) {
    }
    const maxR: number = Math.sqrt(w * w + h * h) * 1.12;
    this.getUIContext().animateTo({ duration: 420, curve: Curve.FastOutSlowIn }, () => {
      this.radius = maxR;
    });
    // 覆盖完成后淡出（调用方在 420ms 时无动画切页，这里从 430ms 开始淡出）
    this.fadeTimer = setTimeout(() => {
      this.getUIContext().animateTo({ duration: 200, curve: Curve.EaseOut }, () => {
        this.waveFade = 0;
      });
      this.endTimer = setTimeout(() => {
        this.active = false;
      }, 220);
    }, 430);
  }

  build() {
    if (this.active) {
      Stack() {
        Circle({ width: this.radius * 2, height: this.radius * 2 })
          .fill(this.waveColor)
          .position({ x: this.waveX - this.radius, y: this.waveY - this.radius })
      }
      .width('100%')
      .height('100%')
      .opacity(this.waveFade)
      .clip(true)
      .hitTestBehavior(HitTestMode.None)
      .accessibilityLevel('no')
    }
  }
}
