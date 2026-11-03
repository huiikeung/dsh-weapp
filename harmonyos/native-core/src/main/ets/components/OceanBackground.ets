import { Logger } from '../common/Logger';

/** 小程序 ocean-background 的 ArkUI 1:1 移植：
 * 海洋底图 + 42vp 技术网格 + 鲸鱼点阵(定时器驱动漂移/摆尾/呼吸) + 底部压暗。 */
@Component
export struct OceanBackground {
  @State driftX: number = -2.8;
  @State driftDir: number = 1;
  @State shimmer: number = 0.9;
  @State shimmerDir: number = 1;
  @State tailAngle: number = 2;
  @State tailDir: number = 1;
  private timerId: number = -1;

  aboutToAppear(): void {
    this.timerId = setInterval(() => {
      // 漂移 ±2.8px（13s 一个来回 → 每 100ms 约 0.056px）
      this.driftX += 0.056 * this.driftDir;
      if (this.driftX >= 2.8) { this.driftX = 2.8; this.driftDir = -1; }
      if (this.driftX <= -2.8) { this.driftX = -2.8; this.driftDir = 1; }
      // 呼吸 0.9↔1.0（2.1s 半程 → 每 100ms 约 0.0048）
      this.shimmer += 0.0048 * this.shimmerDir;
      if (this.shimmer >= 1.0) { this.shimmer = 1.0; this.shimmerDir = -1; }
      if (this.shimmer <= 0.9) { this.shimmer = 0.9; this.shimmerDir = 1; }
      // 摆尾 ±2°（2.86s 半程 → 每 100ms 约 0.14°）
      this.tailAngle += 0.14 * this.tailDir;
      if (this.tailAngle >= 2) { this.tailAngle = 2; this.tailDir = -1; }
      if (this.tailAngle <= -2) { this.tailAngle = -2; this.tailDir = 1; }
    }, 100);
  }

  aboutToDisappear(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  build() {
    Stack() {
      // 1. 海洋底图
      Image($r('app.media.ocean_base'))
        .width('100%')
        .height('100%')
        .objectFit(ImageFit.Cover)

      // 2. 技术网格 42vp
      Column()
        .width('100%')
        .height('100%')
        .backgroundImage($r('app.media.grid_tile'), ImageRepeat.XY)

      // 3. 鲸鱼点阵（115% 屏宽正方形，中心 55%/34%，opacity 0.56；
      //    body 55% + tail 45% 横向拼接，尾巴绕接缝 skew 摆动）
      Row() {
        Image($r('app.media.whale_body'))
          .width('55%')
          .height('100%')
          .objectFit(ImageFit.Fill)
          .opacity(this.shimmer)
        Image($r('app.media.whale_tail'))
          .width('45%')
          .height('100%')
          .objectFit(ImageFit.Fill)
          .opacity(this.shimmer)
          .rotate({ centerX: '0%', centerY: '50%', angle: this.tailAngle })
      }
      .width('124.2%')
      .aspectRatio(0.926)
      .position({ x: '55%', y: '34%' })
      .markAnchor({ x: '50%', y: '50%' })
      .translate({ x: this.driftX, y: 0 })
      .opacity(0.56)

      // 4. 底部压暗
      Column()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: 180,
          colors: [['rgba(6,23,43,0)', 0], ['rgba(6,23,43,0.12)', 0.5], ['rgba(0,0,0,0.58)', 1]]
        })

      // 5. settle 压暗
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#020711')
        .opacity(0.10)
    }
    .width('100%')
    .height('100%')
  }
}
