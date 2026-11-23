import { LengthMetricsUnit, window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { taskpool } from '@kit.ArkTS';
import { prepareBrandFlow } from '../core/BrandFlowWorker';
import { WHALE_PIXELS_IOS } from '../core/WhalePixelsIOS';
import { renderBrandFlow } from '../core/BrandFlow';

/**
 * 首页深海鲸鱼背景：移植 dsh-mobile/harmonyApp 的 BrandBackground，按性能分层绘制。
 *
 * 分层原因：原实现每帧重绘「流体 + 约 400 条网格线 + 2000 个点阵 + 两层渐变」，
 * 实测 CPU 持续 ~100%。这里拆成两层 ——
 *   · 底层 Canvas：流体光带 + 技术网格（只在尺寸/安全区变化时重绘一次）
 *   · 上层 Canvas：鲸鱼点阵（200ms 逐帧重绘，仅 ~2000 个圆角点）
 * 底部压暗与 settle 用静态渐变组件，完全不参与重绘。
 * 流体光带只在首次渲染一次（周期性重算 fbm 噪声会把 CPU 从 ~15% 推到 ~75%）。
 */
interface Pixel { x: number; y: number; luminance: number; edge: number; phase: number; light: number; }

@Component
export struct OceanBackground {
  @Prop @Watch('restart') active: boolean = true;
  @Prop @Watch('restart') reduceMotion: boolean = false;
  @StorageLink('homeAnimationEnabled') @Watch('restart') homeAnimationEnabled: boolean = true;
  @StorageLink('appLifecycle') @Watch('restart') appLifecycle: string = 'foreground';

  @State private revealed: boolean = false;
  private bg: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private whale: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));

  private pixels: Pixel[] = [];
  private canvasWidth: number = 0;
  private canvasHeight: number = 0;
  private tick: number = -1;
  private bgFrame: number = 0;
  private phase: number = 0;
  private bgReady: boolean = false;
  private whaleReady: boolean = false;
  private flow?: ImageBitmap = undefined;
  private flowBusy: boolean = false;
  private flowLogged: boolean = false;
  private flowRevision: number = 0;
  private alive: boolean = false;
  private topInset: number = 0;
  private bottomInset: number = 0;
  private systemBottom: number = 0;
  private navigationBottom: number = 0;
  private hostWindow?: window.Window;
  private avoidChanged: (value: window.AvoidAreaOptions) => void = value => this.avoidArea(value.type, value.area);

  aboutToAppear(): void {
    this.alive = true;
    const context = this.getUIContext().getHostContext();
    if (!context) {
      return;
    }
    window.getLastWindow(context as common.UIAbilityContext).then((host: window.Window) => {
      if (!this.alive) {
        return;
      }
      this.hostWindow = host;
      host.on('avoidAreaChange', this.avoidChanged);
      this.avoidArea(window.AvoidAreaType.TYPE_SYSTEM, host.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM));
      this.avoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR, host.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR));
    }).catch(() => {
    });
  }

  aboutToDisappear(): void {
    this.alive = false;
    try {
      this.hostWindow?.off('avoidAreaChange', this.avoidChanged);
    } catch (ignored) {
    }
    this.hostWindow = undefined;
    this.bgReady = false;
    this.whaleReady = false;
    clearInterval(this.tick);
    this.tick = -1;
    this.flow?.close();
    this.flow = undefined;
  }

  private avoidArea(type: window.AvoidAreaType, area: window.AvoidArea): void {
    let top: number = this.topInset;
    if (type === window.AvoidAreaType.TYPE_SYSTEM) {
      top = this.getUIContext().px2vp(area.topRect.height);
      this.systemBottom = this.getUIContext().px2vp(area.bottomRect.height);
    } else if (type === window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR) {
      this.navigationBottom = this.getUIContext().px2vp(area.bottomRect.height);
    } else {
      return;
    }
    const bottom: number = Math.max(this.systemBottom, this.navigationBottom);
    if (top === this.topInset && bottom === this.bottomInset) {
      return;
    }
    this.topInset = top;
    this.bottomInset = bottom;
    this.flowRevision++;
    this.flow?.close();
    this.flow = undefined;
    if (this.bgReady) {
      this.drawBackground();
      this.updateFlow();
    }
    if (this.whaleReady) {
      this.drawWhale();
    }
  }

  /** 首帧同步渲染一张低分辨率流体：保证启动第一帧就有光带，不出现「晚出来」 */
  private buildInitialFlow(): ImageBitmap | undefined {
    const w: number = 96;
    const h: number = Math.max(1, Math.round(w * this.canvasHeight / Math.max(1, this.canvasWidth)));
    try {
      const aspect: number = this.canvasWidth / Math.max(1, this.canvasHeight);
      const buffer = renderBrandFlow(w, h, aspect, 0, this.canvasWidth >= 600);
      const offscreen = new OffscreenCanvas(w, h, LengthMetricsUnit.PX);
      const ctx = offscreen.getContext('2d');
      ctx.putImageData(new ImageData(w, h, new Uint8ClampedArray(buffer), LengthMetricsUnit.PX), 0, 0);
      return offscreen.transferToImageBitmap();
    } catch (err) {
      return undefined;
    }
  }

  /** 流体光带：只渲染一次（低分辨率 TaskPool 渲染后放大） */
  private async updateFlow(): Promise<void> {
    if (!this.active || this.flowBusy || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return;
    }
    const totalH: number = this.canvasHeight;
    const aspect: number = this.canvasWidth / Math.max(1, totalH);
    const fw: number = 160;
    const fh: number = Math.max(1, Math.min(256, Math.round(fw / aspect)));
    const revision: number = this.flowRevision;
    this.flowBusy = true;
    try {
      const buffer = await taskpool.execute(
        new taskpool.Task(prepareBrandFlow, fw, fh, aspect, this.phase, this.canvasWidth >= 600)) as ArrayBuffer;
      if (!this.alive || revision !== this.flowRevision) {
        return;
      }
      const offscreen = new OffscreenCanvas(fw, fh, LengthMetricsUnit.PX);
      const ctx = offscreen.getContext('2d');
      ctx.putImageData(new ImageData(fw, fh, new Uint8ClampedArray(buffer), LengthMetricsUnit.PX), 0, 0);
      const next: ImageBitmap = offscreen.transferToImageBitmap();
      this.flow?.close();
      this.flow = next;
      if (!this.flowLogged) {
        this.flowLogged = true;
        console.info('OCEAN flow ready ' + fw + 'x' + fh);
      }
      if (this.bgReady) {
        this.drawBackground();
      }
    } catch (err) {
      if (!this.flowLogged) {
        this.flowLogged = true;
        console.info('OCEAN flow failed ' + JSON.stringify(err));
      }
    } finally {
      this.flowBusy = false;
    }
  }

  /** 底层：流体 + 网格（静态，仅在尺寸/安全区变化时重绘） */
  private drawBackground(): void {
    const ctx: CanvasRenderingContext2D = this.bg;
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const totalH: number = h;
    ctx.clearRect(0, 0, w, h);
    ctx.save();

    if (this.flow) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.flow, 0, 0, w, totalH);
    } else {
      const glow = ctx.createRadialGradient(w * .46, totalH * .28, 0, w * .46, totalH * .28, Math.max(w, totalH) * .82);
      glow.addColorStop(0, '#234B79');
      glow.addColorStop(.48, '#101F3B');
      glow.addColorStop(1, '#010510');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, totalH);
      // 流体位图就绪前的静态近似：右下角暖光带，避免「光带晚出现」的视觉跳变
      const warm = ctx.createRadialGradient(w * 1.02, totalH * 0.96, 0, w * 1.02, totalH * 0.96, Math.max(w, totalH) * 0.42);
      warm.addColorStop(0, 'rgba(238,216,170,0.14)');
      warm.addColorStop(1, 'rgba(238,216,170,0)');
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, w, totalH);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.043)';
    ctx.lineWidth = .55;
    const spacing: number = w >= 600 ? Math.min(64, Math.max(42, Math.min(w, totalH) / 16)) : 42;
    for (let x = 0; x < w; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalH);
      ctx.stroke();
    }
    for (let y = 0; y < totalH; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let row = 0; row <= Math.ceil(totalH / spacing); row++) {
      for (let column = 0; column <= Math.ceil(w / spacing); column++) {
        if ((row * 11 + column * 7) % 13 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.085)';
          ctx.fillRect(column * spacing - 1.1, row * spacing - 1.1, 2.2, 2.2);
        }
      }
    }

    // 网格层自 56% 起向 Navy 收敛（位于鲸鱼之前）
    const gridVeil = ctx.createLinearGradient(0, 0, 0, totalH);
    gridVeil.addColorStop(0, 'rgba(6,23,43,0)');
    gridVeil.addColorStop(.56, 'rgba(6,23,43,0)');
    gridVeil.addColorStop(1, 'rgba(6,23,43,0.30)');
    ctx.fillStyle = gridVeil;
    ctx.fillRect(0, 0, w, totalH);
    ctx.restore();
  }

  /** 上层：鲸鱼点阵（逐帧，仅绘制点） */
  private drawWhale(): void {
    const ctx: CanvasRenderingContext2D = this.whale;
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    if (w <= 0 || h <= 0 || this.pixels.length === 0) {
      return;
    }
    // iOS 的 Canvas 覆盖整屏且不做安全区平移：这里同样用原始画布坐标
    const totalH: number = h;
    ctx.clearRect(0, 0, w, h);
    ctx.save();

    // 与 iOS HarnessWhaleField 相同的几何与参数
    // 与 iOS 完全一致：不做额外缩放
    const baseSquare: number = Math.max(w * 1.15, totalH * 0.48);
    const square: number = baseSquare * 1.10;
    const cx: number = w * 0.55;
    const cy: number = totalH * 0.34;
    const baseDot: number = Math.max(1.45, baseSquare / 220);
    const t: number = this.reduceMotion ? 0 : this.phase;

    this.pixels.forEach((pixel: Pixel) => {
      const tail: number = this.smoothstep(0.54, 0.94, pixel.x);
      const edgeDrift: number = 0.35 + 0.65 * pixel.edge;
      // iOS 用每颗粒子的固定 phase；这里用坐标做确定性伪随机，视觉一致
      const pphase: number = pixel.phase;
      const driftX: number = Math.sin(t * 0.50 + pphase * 0.53) * 2.8 * edgeDrift;
      const driftY: number = Math.cos(t * 0.42 + pphase * 0.71) * 2.6 * edgeDrift;
      const tailWave: number = Math.sin(t * 1.10 - pixel.x * 7.0) * 7.0 * tail;
      const shimmer: number = 0.90 + 0.10 * Math.sin(t * 1.5 + pixel.x * 15 + pixel.y * 9);
      const dotSize: number = baseDot * (0.72 + pixel.luminance * 0.58);
      const x: number = cx + (pixel.x - 0.5) * square + driftX;
      const y: number = cy + (pixel.y - 0.5) * square + driftY + tailWave;
      // iOS：alpha = (0.10 + lum*0.38) * shimmer，再叠 Canvas opacity 0.56
      // iOS 的整层 opacity 0.56 + blur 会让点更柔；这里降一点峰值，避免「抢眼」
      const alpha: number = Math.min(1, Math.max(0, (0.10 + pixel.luminance * 0.38) * shimmer * 0.50));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgb(' + Math.round((0.73 + 0.15 * pixel.light) * 255) + ',' +
        Math.round((0.79 + 0.12 * pixel.light) * 255) + ',' + Math.round((0.92 + 0.08 * pixel.light) * 255) + ')';
      // iOS 用 roundedRect（cornerRadius = dotSize*0.18），视觉上就是小方块
      ctx.fillRect(x - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private smoothstep(a: number, b: number, value: number): number {
    const x: number = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  private sample(): void {
    // 与 iOS HeroWhaleMask 60x60 采样结果一致（含 phase / light）
    this.pixels = WHALE_PIXELS_IOS.map((point: number[]): Pixel => ({
      x: point[0], y: point[1], luminance: point[2], edge: point[3],
      phase: point[4], light: point[5]
    }));
  }

  private restart(): void {
    clearInterval(this.tick);
    this.tick = -1;
    if (!this.whaleReady) {
      return;
    }
    this.drawWhale();
    if (!this.flow) {
      this.updateFlow();
    }
    if (!this.isAnimating()) {
      // 静态模式：只保留一帧（设置页关闭动画 / 后台 / 系统减少动效）
      this.drawBackground();
      return;
    }
    let last: number = Date.now();
    this.bgFrame = 0;
    this.tick = setInterval(() => {
      if (!this.alive || !this.isAnimating()) {
        return;
      }
      const now: number = Date.now();
      this.phase = (this.phase + (now - last) / 1000) % 4096;
      last = now;
      // 保持动效前提下继续省电：鲸鱼 20fps，流体约 4fps（Canvas 由 GPU 合成，CPU 只发少量绘制指令）
      this.drawWhale();
      this.bgFrame = (this.bgFrame + 1) % 5;
      if (this.bgFrame === 0) {
        this.updateFlow();
      }
    }, 50);
  }

  private isAnimating(): boolean {
    return this.alive && this.active && this.homeAnimationEnabled && !this.reduceMotion &&
      this.appLifecycle === 'foreground';
  }

  build() {
    Stack() {
      // 底层：流体 + 网格（静态，画一次）
      Canvas(this.bg)
        .width('100%')
        .height('100%')
        .onReady(() => {
          this.bgReady = true;
          if (!this.flow && this.canvasWidth > 0) {
            this.flow = this.buildInitialFlow();
          }
          this.drawBackground();
          this.updateFlow();
        })
        .hitTestBehavior(HitTestMode.None)
        .accessibilityLevel('no')

      // 上层：鲸鱼点阵（200ms 逐帧）
      Canvas(this.whale)
        .width('100%')
        .height('100%')
        .blur(0.6)
        .onReady(() => {
          this.whaleReady = true;
          this.sample();
          this.drawWhale();
          this.restart();
        })
        .hitTestBehavior(HitTestMode.None)
        .accessibilityLevel('no')

      // 底部压暗（静态）
      Column()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: 180,
          colors: [['rgba(6,23,43,0)', 0], ['rgba(6,23,43,0.12)', 0.5], ['rgba(0,0,0,0.58)', 1]]
        })
        .hitTestBehavior(HitTestMode.None)

    }
    .width('100%')
    .height('100%')
    .onAreaChange((_before: Area, area: Area) => {
      const w: number = Number(area.width);
      const h: number = Number(area.height);
      if (w === this.canvasWidth && h === this.canvasHeight) {
        return;
      }
      this.canvasWidth = w;
      this.canvasHeight = h;
      this.flowRevision++;
      this.flow?.close();
      this.flow = undefined;
      // 尺寸确定后立刻同步生成一张流体，保证第一次可见就是完整背景
      this.flow = this.buildInitialFlow();
      if (this.whaleReady) {
        this.sample();
        this.drawWhale();
      }
      if (this.bgReady) {
        this.drawBackground();
      }
      if (!this.revealed) {
        this.revealed = true;
      }
      this.updateFlow();
    })
    .backgroundColor('#05101f')
  }
}
