/**
 * Bot 模式专用背景（对齐 iOS HarnessAnimatedBackground 的 Bot 变体）。
 *
 * 分层：
 *   1) 底层 Canvas（静态）：主机的「流体光带」位图 + 技术网格。
 *      光带不是直线，而是和 iOS harnessFluid 同一套 fbm/丝带公式算出来的弯曲光弧，
 *      只是最后按 lavenderPalette 分支做了亮度重映射（浅色 #C9B3E3→#FCF8FF，深色 #332B3D→#574C5E）。
 *      用 TaskPool 以 144px 宽低分辨率渲染一次，主线程只缩放贴图（与工作模式 OceanBackground 同策略）。
 *   2) 上层 Canvas（逐帧，30fps）：鲸鱼点阵（iOS HarnessWhaleField 的 drift / 摆尾 / shimmer）
 *      + 一层极淡的缓慢游移高光 + 底部收敛。整层加 blur 做雾面颗粒感（iOS 该层 .opacity(0.56) + .blur(0.18)）。
 */
import { LengthMetricsUnit } from '@kit.ArkUI';
import { taskpool } from '@kit.ArkTS';
import { BOT_BG_DEFAULT, BotPalette, botPalette, WHALE_PIXELS_IOS, WHALE_PIXELS_PAD,
  prepareBotFlow, renderBotFlow } from 'nativecore';

const FRAME_MS: number = 33;

@Component
export struct BotBackground {
  @StorageLink('isDark') @Watch('onSchemeChange') isDark: boolean = false;
  /** 背景配色预设（设置 → Bot 背景），空串回落默认 */
  @StorageLink('botBgTheme') @Watch('onSchemeChange') themeId: string = BOT_BG_DEFAULT;

  private baseCtx: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private waveCtx: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private canvasWidth: number = 0;
  private canvasHeight: number = 0;
  private baseReady: boolean = false;
  private waveReady: boolean = false;
  private timerId: number = -1;
  private startMs: number = 0;
  private padStyle: boolean = false;
  private flow: ImageBitmap | undefined = undefined;
  private flowBusy: boolean = false;
  private flowRevision: number = 0;
  private alive: boolean = true;

  private palette(): BotPalette {
    return botPalette(this.themeId);
  }

  aboutToAppear(): void {
    this.startMs = Date.now();
    this.alive = true;
    this.startLoop();
  }

  aboutToDisappear(): void {
    this.alive = false;
    this.stopLoop();
    this.flow?.close();
    this.flow = undefined;
  }

  private startLoop(): void {
    if (this.timerId !== -1) {
      return;
    }
    this.timerId = setInterval(() => {
      this.drawFrame();
    }, FRAME_MS);
  }

  private stopLoop(): void {
    if (this.timerId === -1) {
      return;
    }
    clearInterval(this.timerId);
    this.timerId = -1;
  }

  private onSchemeChange(): void {
    this.flowRevision++;
    this.flow?.close();
    this.flow = undefined;
    this.rebuildFlow();
    this.drawBase();
    this.drawFrame();
  }

  private elapsedSeconds(): number {
    const ms: number = Date.now() - this.startMs;
    return (ms % 4096000) / 1000;
  }

  /** 首帧同步渲染一张很小的流体，保证一进页面就有光带 */
  private buildInitialFlow(): ImageBitmap | undefined {
    if (this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return undefined;
    }
    const style: boolean = this.padStyle;
    const artAspect: number = style ? 1.0 : this.canvasWidth / Math.max(1, this.canvasHeight);
    const w: number = 64;
    const h: number = Math.max(1, Math.round(w / Math.max(0.2, artAspect)));
    try {
      const buffer = renderBotFlow(w, h, artAspect, 0, this.isDark, this.themeId);
      return this.toBitmap(buffer, w, h);
    } catch (err) {
      return undefined;
    }
  }

  private toBitmap(buffer: ArrayBuffer, w: number, h: number): ImageBitmap {
    const offscreen = new OffscreenCanvas(w, h, LengthMetricsUnit.PX);
    const ctx = offscreen.getContext('2d');
    ctx.putImageData(new ImageData(w, h, new Uint8ClampedArray(buffer), LengthMetricsUnit.PX), 0, 0);
    return offscreen.transferToImageBitmap();
  }

  /** 后台渲染高分辨率流体（只做一次/主题变化时） */
  private async updateFlow(): Promise<void> {
    if (!this.alive || this.flowBusy || this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      return;
    }
    const revision: number = this.flowRevision;
    const style: boolean = this.padStyle;
    const artAspect: number = style ? 1.0 : this.canvasWidth / Math.max(1, this.canvasHeight);
    const w: number = 144;
    const h: number = Math.max(1, Math.min(520, Math.round(w / Math.max(0.2, artAspect))));
    const night: boolean = this.isDark;
    this.flowBusy = true;
    try {
      const buffer = await taskpool.execute(
        new taskpool.Task(prepareBotFlow, w, h, artAspect, night, this.themeId)) as ArrayBuffer;
      if (!this.alive || revision !== this.flowRevision) {
        return;
      }
      const next: ImageBitmap = this.toBitmap(buffer, w, h);
      this.flow?.close();
      this.flow = next;
      this.drawBase();
    } catch (err) {
    } finally {
      this.flowBusy = false;
    }
  }

  private rebuildFlow(): void {
    const initial: ImageBitmap | undefined = this.buildInitialFlow();
    if (initial !== undefined) {
      this.flow = initial;
    }
    this.updateFlow();
  }

  /** 底层：流体光带位图（cover 铺满）+ 技术网格 */
  private drawBase(): void {
    if (!this.baseReady) {
      return;
    }
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const ctx: CanvasRenderingContext2D = this.baseCtx;
    const palette: BotPalette = this.palette();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = this.isDark ? palette.baseDark : palette.base;
    ctx.fillRect(0, 0, w, h);
    if (this.flow === undefined) {
      // 先同步渲一张很小的流体，保证这一帧就有光带（不然会先只看到底色、几百毫秒后光带才"浮"出来）
      const initial: ImageBitmap | undefined = this.buildInitialFlow();
      if (initial !== undefined) {
        this.flow = initial;
      }
      this.updateFlow();
    }
    if (this.flow !== undefined) {
      // cover：等比放大，两边多余部分溢出裁掉
      const fw: number = this.flow.width;
      const fh: number = this.flow.height;
      const scale: number = Math.max(w / Math.max(1, fw), h / Math.max(1, fh));
      const dw: number = fw * scale;
      const dh: number = fh * scale;
      ctx.imageSmoothingEnabled = true;
      // 半透明叠在基色上：保留弯曲光弧的结构，但不会被流体场整屏染成粉色
      ctx.globalAlpha = this.isDark ? 0.72 : 0.58;
      ctx.drawImage(this.flow, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.globalAlpha = 1;
    }
    this.paintGrid(ctx, w, h);
  }

  private drawFrame(): void {
    if (!this.waveReady) {
      return;
    }
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const ctx: CanvasRenderingContext2D = this.waveCtx;
    const t: number = this.elapsedSeconds();
    ctx.clearRect(0, 0, w, h);
    this.paintHighlight(ctx, w, h, t);
    this.paintWhale(ctx, w, h, t);
    this.paintVeil(ctx, w, h);
  }

  /** 淡技术网格：浅色用墨色 #6E529E、深色用黑紫，透明度都很低 */
  private paintGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const gap: number = Math.min(w, h) >= 600 ? 56 : 42;
    // 深色下网格用「比底色更暗」的线（iOS night 就是 black @0.043），不用亮线，
    // 亮线在暗底上对比过强，看着扎眼
    const palette: BotPalette = this.palette();
    ctx.strokeStyle = this.isDark ? palette.gridInkDark : palette.gridInk;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = gap; x < w; x += gap) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = gap; y < h; y += gap) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.fillStyle = this.isDark ? palette.gridDotDark : palette.gridDot;
    const rows: number = Math.ceil(h / gap);
    const cols: number = Math.ceil(w / gap);
    for (let row = 0; row <= rows; row++) {
      for (let col = 0; col <= cols; col++) {
        if ((row * 11 + col * 7) % 13 === 0) {
          ctx.fillRect(col * gap - 1.1, row * gap - 1.1, 2.2, 2.2);
        }
      }
    }
  }

  /** 极淡的缓慢游移柔光：给静态流体位图一点"活着"的感觉（不出硬边光带） */
  private paintHighlight(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const span: number = Math.max(w, h);
    const breathe: number = 0.5 + 0.5 * Math.sin(t * 0.30);
    const cx: number = w * (0.62 + 0.05 * Math.sin(t * 0.13));
    const cy: number = h * (0.16 + 0.02 * Math.cos(t * 0.11));
    const grad: CanvasGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, span * 0.60);
    const palette: BotPalette = this.palette();
    if (this.isDark) {
      const accentDark: string = palette.accentDark;
      grad.addColorStop(0, accentDark + (0.045 + 0.025 * breathe).toFixed(3) + ')');
      grad.addColorStop(1, accentDark + '0)');
    } else {
      const accent: string = palette.accent;
      grad.addColorStop(0, accent + (0.30 + 0.10 * breathe).toFixed(3) + ')');
      grad.addColorStop(1, accent + '0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    let x: number = (value - edge0) / (edge1 - edge0);
    if (x < 0) {
      x = 0;
    }
    if (x > 1) {
      x = 1;
    }
    return x * x * (3 - 2 * x);
  }

  /**
   * 鲸鱼点阵（逐帧）：对齐 iOS HarnessWhaleField ——
   * 每颗粒子按正弦漂移（边缘更强）、尾部随 x 摆尾、整体 shimmer 微闪；点用圆角小方块画，比 arc 便宜。
   */
  private paintWhale(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
    const pad: boolean = this.padStyle;
    const source: number[][] = pad ? WHALE_PIXELS_PAD : WHALE_PIXELS_IOS;
    if (source.length === 0) {
      return;
    }
    let square: number = 0;
    let cx: number = 0;
    let cy: number = 0;
    let baseDot: number = 0;
    let motionScale: number = 1;
    if (pad) {
      const aspect: number = w / Math.max(1, h);
      const wideProgress: number = Math.min(1, Math.max(0, (aspect - 0.65) / 0.75));
      square = Math.min(Math.max(w * 1.15, h * 0.48), h * 1.12) * 0.82;
      cx = w * (0.55 + 0.05 * wideProgress);
      cy = h * (0.34 + 0.12 * wideProgress);
      baseDot = Math.min(2.4, Math.max(0.8, square / 360));
      motionScale = Math.min(2, Math.max(1, square / 460));
    } else {
      square = Math.max(w * 1.15, h * 0.48);
      cx = w * 0.55;
      cy = h * 0.34;
      baseDot = Math.max(1.45, square / 220);
    }
    const whaleWidth: number = square * 1.08;
    const driftX: number = 2.8 * motionScale;
    const driftY: number = 2.6 * motionScale;
    const night: boolean = this.isDark;
    const buckets: number = 6;
    try {
      ctx.globalCompositeOperation = night ? 'screen' : 'source-over';
    } catch (err) {
    }
    for (let bucket = 0; bucket < buckets; bucket++) {
      // iOS 这一整层还有 .opacity(0.56)，直接乘进 alpha，否则点会显得又黑又实
      const alphaBase: number = (0.10 + (bucket / (buckets - 1)) * 0.38) * 0.56;
      const palette: BotPalette = this.palette();
      ctx.fillStyle = night
        ? palette.whaleDark + (alphaBase * 0.9).toFixed(3) + ')'
        : palette.whale + alphaBase.toFixed(3) + ')';
      for (let i = 0; i < source.length; i++) {
        const point: number[] = source[i];
        const lum: number = Math.min(1, Math.max(0, point[2]));
        const slot: number = Math.min(buckets - 1, Math.floor(lum * buckets));
        if (slot !== bucket) {
          continue;
        }
        const edge: number = 0.35 + 0.65 * Math.min(1, Math.max(0, point[3]));
        const phase: number = point[4];
        const x0: number = point[0];
        const y0: number = point[1];
        const tail: number = this.smoothstep(0.54, 0.94, x0);
        const dx: number = Math.sin(t * 0.50 + phase * 0.53) * driftX * edge;
        const dy: number = Math.cos(t * 0.42 + phase * 0.71) * driftY * edge;
        const tailWave: number = Math.sin(t * 1.10 - x0 * 7.0) * 7.0 * tail * motionScale;
        const shimmer: number = 0.90 + 0.10 * Math.sin(t * 1.5 + x0 * 15 + y0 * 9);
        const dot: number = baseDot * (0.72 + lum * 0.58);
        const x: number = cx + (x0 - 0.5) * whaleWidth + dx;
        const y: number = cy + (y0 - 0.5) * square + dy + tailWave;
        ctx.fillRect(x - dot * 0.5, y - dot * 0.5, dot * shimmer, dot * shimmer);
      }
    }
    try {
      ctx.globalCompositeOperation = 'source-over';
    } catch (err) {
    }
  }

  /** 底部收敛：浅色向基色聚拢、深色压暗，保证列表与面板文字可读 */
  private paintVeil(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const veil: CanvasGradient = ctx.createLinearGradient(0, h * 0.52, 0, h);
    const palette: BotPalette = this.palette();
    if (this.isDark) {
      const c: string = palette.veilDark;
      veil.addColorStop(0, c + '0)');
      veil.addColorStop(1, c + '0.62)');
    } else {
      const c: string = palette.veil;
      veil.addColorStop(0, c + '0)');
      veil.addColorStop(1, c + '0.55)');
    }
    ctx.fillStyle = veil;
    ctx.fillRect(0, h * 0.52, w, h * 0.48);
  }

  build() {
    Stack() {
      Canvas(this.baseCtx)
        .width('100%')
        .height('100%')
        .onReady(() => {
          this.baseReady = true;
          this.drawBase();
        })
        .hitTestBehavior(HitTestMode.None)
        .accessibilityLevel('no')
      Canvas(this.waveCtx)
        .width('100%')
        .height('100%')
        // 雾面颗粒感：iOS 该层 .opacity(0.56) + .blur(0.18)，这里按 vp 放大到明显可辨的柔化
        .blur(2.4)
        .onReady(() => {
          this.waveReady = true;
          this.drawFrame();
        })
        .hitTestBehavior(HitTestMode.None)
        .accessibilityLevel('no')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.isDark ? this.palette().baseDark : this.palette().base)
    .onAreaChange((_before: Area, area: Area) => {
      const w: number = Number(area.width);
      const h: number = Number(area.height);
      if (w === this.canvasWidth && h === this.canvasHeight) {
        return;
      }
      this.canvasWidth = w;
      this.canvasHeight = h;
      this.padStyle = Math.min(w, h) >= 600;
      this.flowRevision++;
      this.flow?.close();
      this.flow = undefined;
      this.drawBase();
      this.drawFrame();
    })
  }
}
