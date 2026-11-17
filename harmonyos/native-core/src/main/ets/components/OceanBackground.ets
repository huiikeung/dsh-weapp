import { LengthMetricsUnit, window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { taskpool } from '@kit.ArkTS';
import { prepareBrandFlow } from '../core/BrandFlowWorker';
import { BRAND_PIXELS, BRAND_WIDE_PIXELS } from '../core/BrandPixels';

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
interface Pixel { x: number; y: number; luminance: number; edge: number; light: number; }

@Component
export struct OceanBackground {
  @Prop @Watch('restart') active: boolean = true;
  @Prop @Watch('restart') reduceMotion: boolean = false;

  private bg: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private whale: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));

  private pixels: Pixel[] = [];
  private canvasWidth: number = 0;
  private canvasHeight: number = 0;
  private tick: number = -1;
  private phase: number = 0;
  private bgReady: boolean = false;
  private whaleReady: boolean = false;
  private flow?: ImageBitmap = undefined;
  private flowBusy: boolean = false;
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

  /** 流体光带：只渲染一次（低分辨率 TaskPool 渲染后放大） */
  private async updateFlow(): Promise<void> {
    if (!this.active || this.flowBusy || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return;
    }
    const totalH: number = this.canvasHeight + this.topInset + this.bottomInset;
    const aspect: number = this.canvasWidth / Math.max(1, totalH);
    const fw: number = 96;
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
      if (this.bgReady) {
        this.drawBackground();
      }
    } catch (err) {
      // 失败保留径向渐变兜底
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
    const totalH: number = h + this.topInset + this.bottomInset;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(0, -this.topInset);

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
    gridVeil.addColorStop(1, '#06172B');
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
    const totalH: number = h + this.topInset + this.bottomInset;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(0, -this.topInset);

    const wide: boolean = w >= 600;
    const sampleSize: number = wide ? 100 : 72;
    const size: number = wide ? Math.min(Math.max(w * 1.15, totalH * .48), totalH * 1.12) * .82 : Math.max(w * 1.15, totalH * .48);
    const progress: number = Math.max(0, Math.min(1, (w / totalH - .65) / .75));
    const cx: number = w * (wide ? .55 + .05 * progress : .55);
    const cy: number = totalH * (wide ? .34 + .12 * progress : .34);
    const baseDot: number = wide ? Math.max(.8, Math.min(2.4, size / 360)) : Math.max(1.45, size / 220) * (60 / 72);
    const t: number = this.reduceMotion ? 0 : this.phase;
    const stagger: number = size / sampleSize * .14;
    const staticPixel: number = this.getUIContext().px2vp(1);

    this.pixels.forEach((pixel: Pixel) => {
      const edge: number = .35 + .65 * pixel.edge;
      const column: number = pixel.x * sampleSize;
      const row: number = pixel.y * sampleSize;
      const dx: number = Math.sin(t * .50 + pixel.x * 5 + pixel.y * 3) * (this.reduceMotion ? 2.8 * staticPixel : 4) * edge;
      const dy: number = Math.cos(t * .42 + pixel.x * 4 - pixel.y * 3) * (this.reduceMotion ? 2.6 * staticPixel : 4) * edge;
      const sx: number = Math.sin(row * 1.05 + column * .35 + t * .50) * stagger;
      const sy: number = Math.sin(column * .90 - row * Math.PI / 2 + t * .42) * stagger * .7;
      const tail: number = Math.sin(t * 1.10 - pixel.x * 7) * (this.reduceMotion ? 7 * staticPixel : 10) * this.smoothstep(.54, .94, pixel.x);
      const shimmer: number = .90 + .10 * Math.sin(t * 1.5 + pixel.x * 15 + pixel.y * 9);
      ctx.globalAlpha = (.10 + pixel.luminance * .38) * shimmer * .42;
      ctx.fillStyle = 'rgb(' + Math.round((.73 + .15 * pixel.light) * 255) + ',' +
        Math.round((.79 + .12 * pixel.light) * 255) + ',' + Math.round((.92 + .08 * pixel.light) * 255) + ')';
      const dot: number = baseDot * (.72 + pixel.luminance * .58);
      const x: number = cx + (pixel.x - .5) * size * 1.08 + dx + sx;
      const y: number = cy + (pixel.y - .5) * size + dy + sy + tail;
      // 用 fillRect 直接填充：省掉每点一次 beginPath/roundRect 的路径构建开销。
      // dot 只有 1.4~3vp，18% 圆角在肉眼尺度上不可分辨。
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private smoothstep(a: number, b: number, value: number): number {
    const x: number = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return x * x * (3 - 2 * x);
  }

  private sample(): void {
    const source = this.canvasWidth >= 600 ? BRAND_WIDE_PIXELS : BRAND_PIXELS;
    this.pixels = source.map((point: number[]): Pixel => ({
      x: point[0], y: point[1], luminance: point[2], edge: point[3],
      light: Math.max(0, 1 - Math.hypot(point[0] - .30, point[1] - .28) / .92)
    }));
  }

  private restart(): void {
    clearInterval(this.tick);
    this.tick = -1;
    if (!this.whaleReady || !this.active) {
      return;
    }
    this.drawWhale();
    if (!this.flow) {
      this.updateFlow();
    }
    if (!this.reduceMotion) {
      let last: number = Date.now();
      this.tick = setInterval(() => {
        if (!this.alive) {
          return;
        }
        const now: number = Date.now();
        this.phase = (this.phase + (now - last) / 1000) % 4096;
        last = now;
        this.drawWhale();
      }, 200);
    }
  }

  build() {
    Stack() {
      // 底层：流体 + 网格（静态，画一次）
      Canvas(this.bg)
        .width('100%')
        .height('100%')
        .onReady(() => {
          this.bgReady = true;
          this.drawBackground();
          this.updateFlow();
        })
        .hitTestBehavior(HitTestMode.None)
        .accessibilityLevel('no')

      // 上层：鲸鱼点阵（200ms 逐帧）
      Canvas(this.whale)
        .width('100%')
        .height('100%')
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

      // settle 压暗
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#020711')
        .opacity(0.10)
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
      if (this.whaleReady) {
        this.sample();
        this.drawWhale();
      }
      if (this.bgReady) {
        this.drawBackground();
        this.updateFlow();
      }
    })
  }
}
