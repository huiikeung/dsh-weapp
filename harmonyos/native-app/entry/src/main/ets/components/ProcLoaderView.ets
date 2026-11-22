/**
 * ProcLoaderView —— 执行图标动效（设置页「执行图标」13 种样式共用）。
 * 供会话页运行中过程组与设置二级页的预览同时使用，保证两处完全一致。
 *
 * 每种动画的尺寸 / 延时 / 缓动逐项对齐小程序 styles/proc-icon.wxss：
 * 旋转圆环、格子、思考球、变形方、点阵、轨道、波纹、声波、脉冲环、呼吸条、旋方、打字点、扫描线。
 * 所有实例共享一个模块级时钟（AppStorage('procClockMs')），避免每个图标各起一个定时器。
 */
const PROC_CLOCK_INTERVAL_MS: number = 33;
let procClockTimer: number = -1;
let procClockStartAt: number = 0;
let procClockRefs: number = 0;

function retainProcClock(): void {
  procClockRefs += 1;
  if (procClockTimer >= 0) {
    return;
  }
  procClockStartAt = Date.now();
  procClockTimer = setInterval(() => {
    AppStorage.setOrCreate<number>('procClockMs', Date.now() - procClockStartAt);
  }, PROC_CLOCK_INTERVAL_MS);
}

function releaseProcClock(): void {
  procClockRefs -= 1;
  if (procClockRefs > 0) {
    return;
  }
  procClockRefs = 0;
  if (procClockTimer >= 0) {
    clearInterval(procClockTimer);
    procClockTimer = -1;
  }
}

@Component
export struct ProcLoaderView {
  @Prop style: string = 'spin-ring';
  @Prop isDark: boolean = false;
  /** 图标外框边长（vp）：过程行 18.77、设置预览可用更大值 */
  @Prop boxSize: number = 18.77;
  @StorageProp('procClockMs') clockMs: number = 0;

  aboutToAppear(): void {
    retainProcClock();
  }

  aboutToDisappear(): void {
    releaseProcClock();
  }

  // ==================== 工具：颜色 / 相位 ====================
  private ink(): string {
    return this.isDark ? '#A6A6A6' : '#6C6C6C';
  }

  private inkAlpha(alpha: number): string {
    const prefix: string = this.isDark ? 'rgba(166,166,166,' : 'rgba(108,108,108,';
    return prefix + alpha.toString() + ')';
  }

  /** 周期相位 0..1；delayMs>0 表示该元素晚 delayMs 开始（对齐 CSS animation-delay） */
  private phase(durationMs: number, delayMs: number = 0): number {
    if (durationMs <= 0) {
      return 0;
    }
    const shifted: number = this.clockMs - delayMs;
    const mod: number = ((shifted % durationMs) + durationMs) % durationMs;
    return mod / durationMs;
  }

  private sine(p: number): number {
    return (1 - Math.cos(2 * Math.PI * p)) / 2;
  }

  private easeOut(p: number): number {
    return 1 - (1 - p) * (1 - p);
  }

  /** 0 → 1 → 0 的三角波 */
  private triangle(p: number): number {
    return p < 0.5 ? p * 2 : (1 - p) * 2;
  }

  private spin(durationMs: number, delayMs: number = 0): number {
    return this.phase(durationMs, delayMs) * 360;
  }

  /** 32rpx 设计稿尺寸 → 当前 boxSize 下的 vp */
  private rpx(value: number): number {
    return value * this.boxSize / 32;
  }

  // ==================== 旋转圆环（spin-ring）====================
  @Builder
  spinRing() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(this.rpx(22))
        .height(this.rpx(22))
        .borderRadius(this.rpx(11))
        .border({ width: this.rpx(2), color: this.inkAlpha(0.22) })
      Column()
        .width(this.rpx(22))
        .height(this.rpx(22))
        .borderRadius(this.rpx(11))
        .border({
          width: this.rpx(2),
          color: { top: this.ink(), right: Color.Transparent, bottom: Color.Transparent, left: Color.Transparent }
        })
        .rotate({ angle: this.spin(950) })
    }
  }

  // ==================== 格子（cells）====================
  private cellPhase(index: number): number {
    return this.phase(1200, index * 150);
  }

  private cellOpacity(index: number): number {
    const p: number = this.cellPhase(index);
    if (p < 0.4) {
      return 0.22 + 0.78 * (p / 0.4);
    }
    return 1 - 0.78 * ((p - 0.4) / 0.6);
  }

  private cellScale(index: number): number {
    const p: number = this.cellPhase(index);
    if (p < 0.4) {
      return 0.9 + 0.1 * (p / 0.4);
    }
    return 1 - 0.1 * ((p - 0.4) / 0.6);
  }

  @Builder
  cellDot(index: number) {
    Column()
      .width(this.rpx(10))
      .height(this.rpx(10))
      .borderRadius(this.rpx(2))
      .backgroundColor(this.ink())
      .opacity(this.cellOpacity(index))
      .scale({ x: this.cellScale(index), y: this.cellScale(index) })
  }

  @Builder
  cells() {
    Column() {
      Row() {
        this.cellDot(0)
        this.cellDot(1)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      Row() {
        this.cellDot(2)
        this.cellDot(3)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
    .padding(this.rpx(4))
    .justifyContent(FlexAlign.SpaceBetween)
    .alignItems(HorizontalAlign.Center)
    .borderRadius(this.rpx(8))
    .border({ width: 0.5, color: this.inkAlpha(0.32) })
    .backgroundColor(this.inkAlpha(0.06))
  }

  // ==================== 思考球（terra）====================
  private terraPulse(index: number): number {
    return this.sine(this.phase(1400, index * 160));
  }

  @Builder
  terraDot(index: number, offsetX: number, offsetY: number) {
    Column()
      .width(this.rpx(6))
      .height(this.rpx(6))
      .borderRadius(this.rpx(3))
      .backgroundColor(this.ink())
      .opacity(0.35 + 0.65 * this.terraPulse(index))
      .scale({
        x: 0.72 + 0.4 * this.terraPulse(index),
        y: 0.72 + 0.4 * this.terraPulse(index)
      })
      .offset({ x: offsetX, y: offsetY })
  }

  @Builder
  terra() {
    Stack({ alignContent: Alignment.Center }) {
      this.terraDot(0, 0, -this.rpx(12))
      this.terraDot(1, -this.rpx(10), -this.rpx(6))
      this.terraDot(2, this.rpx(10), -this.rpx(6))
      this.terraDot(3, -this.rpx(10), this.rpx(6))
      this.terraDot(4, this.rpx(10), this.rpx(6))
      this.terraDot(5, 0, this.rpx(12))
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
    .rotate({ angle: this.spin(3000) })
  }

  // ==================== 变形方（morph）====================
  /** 变形方：0 圆 / 1 三角 / 2 方，各延时 0.8s，周期 2.4s */
  private morphPhase(index: number): number {
    return this.phase(2400, index * 800);
  }

  /** 0%~5% 隐身、12%~23% 显示、31%~100% 隐身（对齐 procMorphShape 关键帧） */
  private morphOpacity(index: number): number {
    const p: number = this.morphPhase(index);
    if (p < 0.05 || p >= 0.31) {
      return 0;
    }
    if (p < 0.12) {
      return (p - 0.05) / 0.07;
    }
    if (p < 0.23) {
      return 1;
    }
    return 1 - (p - 0.23) / 0.08;
  }

  private morphScale(index: number): number {
    const p: number = this.morphPhase(index);
    if (p < 0.05 || p >= 0.31) {
      return 0.68;
    }
    if (p < 0.12) {
      return 0.68 + 0.32 * ((p - 0.05) / 0.07);
    }
    return 1;
  }

  @Builder
  morphShapes() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(this.rpx(16))
        .height(this.rpx(16))
        .borderRadius(this.rpx(8))
        .backgroundColor(this.ink())
        .opacity(this.morphOpacity(0))
        .scale({ x: this.morphScale(0), y: this.morphScale(0) })
        .rotate({ angle: 0 })
      // 三角形：用 Polygon（points 单位是 vp，顶点直接按 rpx 计算）。
      // 外接框 16rpx 与圆的直径一致（方 15rpx），视觉大小匹配，不再显得过大。
      Polygon({ width: this.rpx(16), height: this.rpx(16) })
        .points([[this.rpx(8), 0], [this.rpx(16), this.rpx(16)], [0, this.rpx(16)]])
        .fill(this.ink())
        .opacity(this.morphOpacity(1))
        .scale({ x: this.morphScale(1), y: this.morphScale(1) })
      Column()
        .width(this.rpx(15))
        .height(this.rpx(15))
        .borderRadius(this.rpx(2))
        .backgroundColor(this.ink())
        .opacity(this.morphOpacity(2))
        .scale({ x: this.morphScale(2), y: this.morphScale(2) })
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
  }

  // ==================== 点阵（grid）====================
  /** 九宫格：0.14s / 0.28s / 0.42s / 0.56s / 0.70s 错峰（对齐 proc-grid-dot） */
  private gridDelayMs(index: number): number {
    const delays: number[] = [0, 140, 280, 140, 420, 560, 280, 560, 700];
    return delays[index];
  }

  private gridPulse(index: number): number {
    return this.phase(1200, this.gridDelayMs(index));
  }

  private gridOpacity(index: number): number {
    const pulse: number = this.gridPulse(index);
    if (pulse < 0.45) {
      return 0.28 + 0.72 * (pulse / 0.45);
    }
    return 1 - 0.72 * ((pulse - 0.45) / 0.55);
  }

  private gridScale(index: number): number {
    const pulse: number = this.gridPulse(index);
    if (pulse < 0.45) {
      return 0.72 + 0.28 * (pulse / 0.45);
    }
    return 1 - 0.28 * ((pulse - 0.45) / 0.55);
  }

  @Builder
  gridDot(index: number) {
    Column()
      .width(this.rpx(6))
      .height(this.rpx(6))
      .borderRadius(this.rpx(2))
      .backgroundColor(this.ink())
      .opacity(this.gridOpacity(index))
      .scale({ x: this.gridScale(index), y: this.gridScale(index) })
  }

  @Builder
  grid() {
    Column({ space: this.rpx(2) }) {
      Row({ space: this.rpx(2) }) {
        this.gridDot(0)
        this.gridDot(1)
        this.gridDot(2)
      }
      Row({ space: this.rpx(2) }) {
        this.gridDot(3)
        this.gridDot(4)
        this.gridDot(5)
      }
      Row({ space: this.rpx(2) }) {
        this.gridDot(6)
        this.gridDot(7)
        this.gridDot(8)
      }
    }
  }

  // ==================== 轨道（orbit）====================
  @Builder
  orbit() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(this.rpx(22))
        .height(this.rpx(22))
        .borderRadius(this.rpx(5))
        .border({ width: 0.5, color: this.inkAlpha(0.45) })
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(this.rpx(6))
          .height(this.rpx(6))
          .borderRadius(this.rpx(3))
          .backgroundColor(this.ink())
          .offset({ x: 0, y: -this.rpx(12) })
      }
      .width(this.rpx(32))
      .height(this.rpx(32))
      .rotate({ angle: this.spin(1800) })
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(this.rpx(4))
          .height(this.rpx(4))
          .borderRadius(this.rpx(2))
          .backgroundColor(this.ink())
          .opacity(0.65)
          .offset({ x: this.rpx(1), y: -this.rpx(10) })
      }
      .width(this.rpx(32))
      .height(this.rpx(32))
      .rotate({ angle: -this.spin(2700) })
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
  }

  // ==================== 波纹（ripple）====================
  private ripplePhase(index: number): number {
    return this.phase(1500, index * 500);
  }

  private rippleScale(index: number): number {
    return 0.5 + 0.5 * this.easeOut(this.ripplePhase(index));
  }

  private rippleOpacity(index: number): number {
    const p: number = this.ripplePhase(index);
    if (p < 0.75) {
      return 0.9 - 0.82 * (p / 0.75);
    }
    return 0.08;
  }

  @Builder
  rippleRing(index: number, sizeRpx: number) {
    Column()
      .width(this.rpx(sizeRpx))
      .height(this.rpx(sizeRpx))
      .borderRadius(this.rpx(4))
      .border({ width: this.rpx(1.5), color: this.ink() })
      .scale({ x: this.rippleScale(index), y: this.rippleScale(index) })
      .opacity(this.rippleOpacity(index))
  }

  @Builder
  ripple() {
    Stack({ alignContent: Alignment.Center }) {
      this.rippleRing(0, 9)
      this.rippleRing(1, 17)
      this.rippleRing(2, 25)
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
  }

  // ==================== 声波（wave）====================
  private wavePhase(index: number): number {
    const delays: number[] = [100, 250, 0, 250, 100];
    return this.phase(800, delays[index]);
  }

  @Builder
  waveBar(index: number, heightRpx: number) {
    Column()
      .width(this.rpx(3))
      .height(this.rpx(heightRpx))
      .borderRadius(this.rpx(2))
      .backgroundColor(this.ink())
      .scale({ x: 1, y: 0.42 + 0.58 * this.sine(this.wavePhase(index)) })
      .opacity(0.55 + 0.45 * this.sine(this.wavePhase(index)))
  }

  @Builder
  wave() {
    Row({ space: this.rpx(2) }) {
      this.waveBar(0, 8)
      this.waveBar(1, 14)
      this.waveBar(2, 20)
      this.waveBar(3, 14)
      this.waveBar(4, 8)
    }
    .alignItems(VerticalAlign.Center)
  }

  // ==================== 脉冲环（pulse-ring）====================
  @Builder
  pulseRing() {
    Column()
      .width(this.rpx(26))
      .height(this.rpx(26))
      .borderRadius(this.rpx(13))
      .border({ width: this.rpx(1.6), color: this.ink() })
      .scale({
        x: 0.16 + 0.84 * this.easeOut(this.phase(1700)),
        y: 0.16 + 0.84 * this.easeOut(this.phase(1700))
      })
      .opacity(0.95 - 0.9 * Math.min(1, this.phase(1700) / 0.65))
  }

  // ==================== 呼吸条（breathe-bars）====================
  private breathePulse(index: number): number {
    return this.sine(this.phase(1400, index * 180));
  }

  @Builder
  breatheBar(index: number) {
    Column()
      .width(this.rpx(3))
      .height(this.rpx(20))
      .borderRadius(this.rpx(2))
      .backgroundColor(this.ink())
      .scale({ x: 1, y: 0.35 + 0.65 * this.breathePulse(index) })
      .opacity(0.4 + 0.6 * this.breathePulse(index))
  }

  @Builder
  breatheBars() {
    Row({ space: this.rpx(4) }) {
      this.breatheBar(0)
      this.breatheBar(1)
      this.breatheBar(2)
    }
    .alignItems(VerticalAlign.Center)
  }

  // ==================== 旋方（spin-square）====================
  @Builder
  spinSquare() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(this.rpx(18))
        .height(this.rpx(18))
        .borderRadius(this.rpx(4))
        .border({ width: this.rpx(1.6), color: this.ink() })
        .offset({ x: 0, y: 0 })
      Column()
        .width(this.rpx(5))
        .height(this.rpx(5))
        .borderRadius(this.rpx(2.5))
        .backgroundColor(this.ink())
        .offset({ x: -this.rpx(8.5), y: -this.rpx(8.5) })
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
    .rotate({ angle: this.spin(2400) })
  }

  // ==================== 打字点（typing-dots）====================
  private typingPhase(index: number): number {
    return this.phase(1200, index * 180);
  }

  private typingOpacity(index: number): number {
    const p: number = this.typingPhase(index);
    if (p < 0.3) {
      return 0.25 + 0.75 * (p / 0.3);
    }
    if (p < 0.6) {
      return 1 - 0.75 * ((p - 0.3) / 0.3);
    }
    return 0.25;
  }

  private typingOffset(index: number): number {
    const p: number = this.typingPhase(index);
    if (p < 0.3) {
      return -this.rpx(3) * (p / 0.3);
    }
    if (p < 0.6) {
      return -this.rpx(3) * (1 - (p - 0.3) / 0.3);
    }
    return 0;
  }

  @Builder
  typingDot(index: number) {
    Column()
      .width(this.rpx(6))
      .height(this.rpx(6))
      .borderRadius(this.rpx(3))
      .backgroundColor(this.ink())
      .opacity(this.typingOpacity(index))
      .offset({ x: 0, y: this.typingOffset(index) })
  }

  @Builder
  typingDots() {
    Row({ space: this.rpx(4) }) {
      this.typingDot(0)
      this.typingDot(1)
      this.typingDot(2)
    }
    .alignItems(VerticalAlign.Center)
  }

  // ==================== 扫描线（scan-line）====================
  @Builder
  scanLine() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width(this.rpx(22))
        .height(this.rpx(22))
        .borderRadius(this.rpx(4))
        .border({ width: 0.5, color: this.inkAlpha(0.32) })
      Column()
        .width(this.rpx(18))
        .height(this.rpx(2))
        .borderRadius(this.rpx(1))
        .backgroundColor(this.ink())
        .offset({ x: 0, y: this.rpx(-9) + this.rpx(18) * this.triangle(this.phase(1800)) })
        .opacity(0.45 + 0.55 * this.triangle(this.phase(1800)))
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
  }

  // ==================== 默认（系统加载图）====================
  @Builder
  systemLoader() {
    LoadingProgress()
      .width(this.boxSize)
      .height(this.boxSize)
      .color(this.ink())
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.style === 'default' || this.style === 'cells') {
        // 'cells' 是已下线的旧选项，存量设置统一落到系统默认加载图
        this.systemLoader()
      } else if (this.style === 'spin-ring') {
        this.spinRing()
      } else if (this.style === 'terra') {
        this.terra()
      } else if (this.style === 'morph') {
        this.morphShapes()
      } else if (this.style === 'grid') {
        this.grid()
      } else if (this.style === 'orbit') {
        this.orbit()
      } else if (this.style === 'ripple') {
        this.ripple()
      } else if (this.style === 'wave') {
        this.wave()
      } else if (this.style === 'pulse-ring') {
        this.pulseRing()
      } else if (this.style === 'breathe-bars') {
        this.breatheBars()
      } else if (this.style === 'spin-square') {
        this.spinSquare()
      } else if (this.style === 'typing-dots') {
        this.typingDots()
      } else if (this.style === 'scan-line') {
        this.scanLine()
      } else {
        this.systemLoader()
      }
    }
    .width(this.boxSize)
    .height(this.boxSize)
  }
}
