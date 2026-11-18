/**
 * 长按语音的全屏特效（对齐小程序 pages/session/components/voice-overlay + voice-field.js，
 * 几何与粒子参数来自 DSH iOS VoiceRipplePanel.swift）。
 *
 * 小程序的做法是「常驻一块 40vh 高的画布 + 白色光晕 + 蓝色色块 + 粒子汇聚成波形」：
 *   .voice-overlay      40vh、fixed 贴底、pointer-events:none
 *   .voice-halo         白色椭圆径向蒙版（色块外的一圈柔光）
 *   .voice-masked       蓝色底 + 椭圆蒙版；下 28% 不透明（盖住安全区）
 *   .voice-glow         更亮的一团模糊光，叠在色块里
 *   .voice-particles    45 × 13 = 585 个粒子；按下时先散开，随后 160ms 汇聚成 45 列波形
 *   .voice-status       文案放在 40% 高度处，居中
 *
 * 鸿蒙没有 CSS mask/filter，这里用一块 Canvas 直接把这些层按同样顺序画出来：
 *   光晕椭圆 → 色块（椭圆软边 + 下缘不透明）→ 光斑 → 粒子 → （Text 叠在最上面）
 * 粒子的位置/漂移/透明度公式与 voice-field.js 逐项一致，音量平滑同样是 0.55 上 / 0.18 下。
 */

import { Logger } from 'nativecore';

const TAU: number = Math.PI * 2;
const COLUMNS: number = 45;
const ROWS: number = 13;
const PARTICLE_COUNT: number = COLUMNS * ROWS;
const GATHER_MS: number = 160;
const FRAME_MS: number = 33;
/** 音量采样间隔：和小程序 onLevel 的 100ms 节流一致，避免每帧采样抖成噪点 */
const LEVEL_INTERVAL_MS: number = 100;
const LEVEL_FAST: number = 0.55;
const LEVEL_SLOW: number = 0.18;

/** 一个粒子：字段含义与 voice-field.js 一一对应 */
class VoiceParticle {
  i: number = 0;
  column: number = 0;
  edge: number = 0;
  row: number = 0;
  x: number = 0;
  y: number = 0;
  targetX: number = 0;
  sx: number = 0;
  sy: number = 0;
  dx: number = 0;
  dy: number = 0;
  phase: number = 0;
  freePhase: number = 0;
  radius: number = 1;
  alpha: number = 0;
  pulse: number = 0;
  shimmer: number = 0;
  waveRadius: number = 1;
  waveAlpha: number = 0.3;
}

/** 一套配色（浅/深 × 正常/取消，取值来自 voice-overlay.wxss 的 CSS 变量） */
class VoicePalette {
  base: number[] = [115, 169, 231];
  glow: number[] = [175, 215, 250];
  ink: number[] = [23, 60, 101];
}

@Component
export struct VoiceRipplePanel {
  @Prop @Watch('onVisibleChanged') visible: boolean = false;
  @Prop cancelArmed: boolean = false;
  @Prop isDark: boolean = false;
  @Prop status: string = '';
  /** 页面传入的音量采样函数（0..1）；由本组件按 100ms 自己拉，不让整页跟着 30fps 重排 */
  readLevel: () => number = () => 0;

  /** 是否挂在树上（淡出期间还要留着画布最后一帧） */
  @State private presented: boolean = false;
  /** 不透明度：进入 160ms / 离开 280ms，对齐小程序过渡时长 */
  @State private shown: boolean = false;
  /** 面板高度（vp），用于把文案压到 40% 高度 */
  @State private panelHeight: number = 0;

  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private particles: VoiceParticle[] = [];
  private levels: number[] = [];
  private px: number[] = [];
  private py: number[] = [];
  private pr: number[] = [];
  private pb: number[] = [];
  private pa: number[] = [];
  private canvasWidth: number = 0;
  private canvasHeight: number = 0;
  private frameTimer: number = -1;
  private enterTimer: number = -1;
  private exitTimer: number = -1;
  private levelAt: number = 0;
  private level: number = 0;
  private gatheredAt: number = -1;
  private gathering: number = 0;
  private lastFrame: number = 0;
  private ink: number[] = [23, 60, 101];
  private base: number[] = [115, 169, 231];
  private glow: number[] = [175, 215, 250];

  aboutToDisappear(): void {
    this.stopLoop();
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.enterTimer >= 0) {
      clearTimeout(this.enterTimer);
      this.enterTimer = -1;
    }
    if (this.exitTimer >= 0) {
      clearTimeout(this.exitTimer);
      this.exitTimer = -1;
    }
  }

  private onVisibleChanged(): void {
    this.clearTimers();
    if (this.visible) {
      this.resetField();
      this.presented = true;
      this.enterTimer = setTimeout(() => {
        this.enterTimer = -1;
        this.shown = true;
      }, 16);
      this.startLoop();
      return;
    }
    this.shown = false;
    // 等淡出走完再卸载：此时画布保留最后一帧，卸载瞬间不会闪一下空白
    this.exitTimer = setTimeout(() => {
      this.exitTimer = -1;
      this.presented = false;
      this.stopLoop();
    }, 300);
  }

  /** 每次重新按下都从头开始：粒子重新散开、音量归零、配色直接落到目标值（不做上一轮的收敛动画） */
  private resetField(): void {
    this.level = 0;
    this.gathering = 0;
    this.gatheredAt = -1;
    this.lastFrame = 0;
    this.levelAt = 0;
    this.levels = [];
    for (let i = 0; i < COLUMNS; i++) {
      this.levels.push(0);
    }
    // 一按下就开始汇聚：不等麦克风出声。以前 gatheredAt 要等 level>0.08 才置位，
    // 权限/开麦这几百毫秒里粒子是散开的「灰尘」，用户看到的就是「没有声波」。
    this.gatheredAt = Date.now();
    const palette: VoicePalette = this.palette();
    this.ink = palette.ink;
    this.base = palette.base;
    this.glow = palette.glow;
  }

  private startLoop(): void {
    if (this.frameTimer >= 0) {
      return;
    }
    this.frameTimer = setInterval(() => {
      this.frame();
    }, FRAME_MS);
  }

  private stopLoop(): void {
    if (this.frameTimer >= 0) {
      clearInterval(this.frameTimer);
      this.frameTimer = -1;
    }
  }

  private layout(nextWidth: number, nextHeight: number): void {
    if (!(nextWidth > 0) || !(nextHeight > 0)) {
      return;
    }
    if (Math.abs(this.canvasWidth - nextWidth) < 0.5 && Math.abs(this.canvasHeight - nextHeight) < 0.5) {
      return;
    }
    this.canvasWidth = nextWidth;
    this.canvasHeight = nextHeight;
    this.panelHeight = nextHeight;
    Logger.info('voice overlay layout=' + nextWidth.toFixed(1) + 'x' + nextHeight.toFixed(1));
    // 画布尺寸跟着组件走（ArkTS 里 ctx.width / height 是只读的），绘制坐标系就是 vp
    this.buildField();
  }

  /** 确定性粒子场（对齐 createField：同一 index 永远同一个位置） */
  private buildField(): void {
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const pitch: number = Math.min(6.4, (w - 48) / COLUMNS);
    const list: VoiceParticle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const p: VoiceParticle = new VoiceParticle();
      p.i = i;
      p.column = i % COLUMNS;
      p.edge = Math.sin((i % COLUMNS) / (COLUMNS - 1) * Math.PI);
      p.row = Math.floor(i / COLUMNS) / (ROWS - 1) - 0.5;
      p.x = 16 + this.seed(i, 1) * (w - 32);
      p.y = h * (0.16 + this.seed(i, 8) * 0.79);
      p.targetX = (w - pitch * (COLUMNS - 1)) / 2 + p.column * pitch;
      p.sx = 0.16 + this.seed(i, 3) * 0.18;
      p.sy = 0.12 + this.seed(i, 4) * 0.16;
      p.dx = this.seed(i, 10) * TAU;
      p.dy = this.seed(i, 11) * TAU;
      p.phase = this.seed(i, 9) * TAU;
      p.freePhase = this.seed(i, 12) * TAU;
      p.radius = 0.7 + this.seed(i, 5) * 0.8;
      p.alpha = 0.12 + this.seed(i, 6) * 0.26;
      p.pulse = 0.30 + this.seed(i, 13) * 0.20;
      p.shimmer = 0.24 + this.seed(i, 14) * 0.18;
      p.waveRadius = 0.8 + p.edge * 0.5 + (this.seed(i, 5) - 0.5) * 0.12;
      p.waveAlpha = 0.26 + p.edge * 0.4 + (this.seed(i, 6) - 0.5) * 0.06;
      list.push(p);
    }
    this.particles = list;
    this.px = [];
    this.py = [];
    this.pr = [];
    this.pb = [];
    this.pa = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.px.push(0);
      this.py.push(0);
      this.pr.push(0);
      this.pb.push(0);
      this.pa.push(0);
    }
  }

  private seed(index: number, salt: number): number {
    const value: number = Math.sin(index * 127.1 + salt) * 43758.5453;
    return value - Math.floor(value);
  }

  private frame(): void {
    if (!this.presented) {
      return;
    }
    if (this.canvasWidth <= 0 || this.canvasHeight <= 0) {
      // 兜底：万一 onAreaChange 没回（本机条件挂载时出现过），直接问 ctx 自己的尺寸。
      const fallbackW: number = Number(this.ctx.width);
      const fallbackH: number = Number(this.ctx.height);
      if (fallbackW > 0 && fallbackH > 0) {
        this.layout(fallbackW, fallbackH);
      } else {
        return;
      }
    }
    const now: number = Date.now();
    const dt: number = this.lastFrame > 0 ? Math.min(80, now - this.lastFrame) : 34;
    this.lastFrame = now;
    if (this.levelAt === 0 || now - this.levelAt >= LEVEL_INTERVAL_MS) {
      this.levelAt = now;
      // 还没出声（授权中/刚开麦）时给一条轻微的呼吸波，保证「按住就有波动」；
      // 真实电平更高时直接接管，所以说话时幅度仍然由麦克风决定。
      const raw: number = this.readLevel();
      const idle: number = 0.16 + 0.09 * Math.sin(now / 420) + 0.04 * Math.sin(now / 173);
      this.pushLevel(raw > idle ? raw : idle);
    }
    const target: VoicePalette = this.palette();
    const inkStep: number = Math.min(1, dt / 80);
    const colorStep: number = Math.min(1, dt / 200);
    this.ink = this.lerp(this.ink, target.ink, inkStep);
    this.base = this.lerp(this.base, target.base, colorStep);
    this.glow = this.lerp(this.glow, target.glow, colorStep);
    const progress: number = this.gatheredAt < 0 ? 0 : Math.min(1, (now - this.gatheredAt) / GATHER_MS);
    this.gathering = 1 - Math.pow(1 - progress, 3);
    this.draw(now / 1000);
  }

  private pushLevel(raw: number): void {
    const value: number = isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    this.level = this.level + (value - this.level) * (value > this.level ? LEVEL_FAST : LEVEL_SLOW);
    if (this.levels.length === COLUMNS) {
      this.levels.shift();
      this.levels.push(this.level);
    }
    if (this.gatheredAt < 0 && value > 0.08) {
      this.gatheredAt = Date.now();
    }
  }

  private draw(time: number): void {
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    const ctx: CanvasRenderingContext2D = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this.drawHalo(ctx, w, h);
    this.drawWash(ctx, w, h);
    this.drawGlow(ctx, w, h);
    this.drawParticles(ctx, w, h, time);
  }

  /** 白色椭圆光晕（小程序 .voice-halo）：把色块外圈托亮一层 */
  private drawHalo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const rgb: number[] = this.isDark ? [0, 0, 0] : [255, 255, 255];
    const stops: number[] = [0.45, 1, 0.55, 0.95, 0.64, 0.8, 0.72, 0.6, 0.8, 0.36, 0.9, 0.14, 1, 0];
    this.fillEllipse(ctx, w * 0.5, h * 0.78, w * 1.12, h * 0.312, rgb, stops);
  }

  /**
   * 主色块：椭圆软边 + 底部不透明（盖住安全区）。
   *
   * 这里以前是「椭圆渐变 + 从 0.72h 直接 fillRect 实色」：fillRect 一上来就是全不透明，
   * 两侧椭圆已经很淡，于是屏幕下方会出现一条非常明显的横向分界线（分层感）。
   * 现在改成纵向渐变把实色区「接进来」：从 0 → 0.35 → 0.82 → 1 平滑过渡，不再有硬边。
   */
  private drawWash(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const top: number = h * 0.72;
    // 色标给密一点，避免 8bit 通道上出现一圈圈色带
    const stops: number[] = [0, 1, 0.3, 1, 0.5, 0.96, 0.62, 0.86, 0.74, 0.66, 0.86, 0.38, 1, 0];
    this.fillEllipse(ctx, w * 0.5, top, w * 0.68, h * 0.46, this.base, stops);
    const ramp: number = Math.max(28, h * 0.26);
    const start: number = top - ramp * 0.5;
    const gradient: CanvasGradient = ctx.createLinearGradient(0, start, 0, top + ramp * 0.5);
    gradient.addColorStop(0, this.rgba(this.base, 0));
    gradient.addColorStop(0.35, this.rgba(this.base, 0.34));
    gradient.addColorStop(0.7, this.rgba(this.base, 0.8));
    gradient.addColorStop(1, this.rgba(this.base, 1));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, start, w, h - start);
  }

  /** 色块里更亮的一团光（小程序 .voice-glow，blur 34px）：不再用矩形裁剪，改成自身柔和收边 */
  private drawGlow(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const stops: number[] = [0, 0.8, 0.35, 0.66, 0.6, 0.4, 0.82, 0.14, 1, 0];
    this.fillEllipse(ctx, w * 0.5, h * 0.54, w * 0.8, h * 0.42, this.glow, stops);
  }

  /** 585 个粒子：先算一帧位置，再按透明度分 10 桶批量 fill（否则 585 次 arc+fill 撑不住 30fps） */
  private drawParticles(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
    const count: number = this.particles.length;
    if (count === 0) {
      return;
    }
    const free: number = 1 - this.gathering;
    const gather: number = this.gathering;
    for (let i = 0; i < count; i++) {
      const p: VoiceParticle = this.particles[i];
      const level: number = this.levels.length === COLUMNS ? this.levels[p.column] : 0;
      const waveHeight: number = 5 + level * 56 * (0.35 + 0.65 * p.edge);
      const driftX: number = Math.sin(time * p.sx + p.i) * 14 + Math.cos(time * 0.19 + p.dx) * 5;
      const driftY: number = Math.cos(time * p.sy + p.i) * 12 + Math.sin(time * 0.17 + p.dy) * 4;
      const x: number = (p.x + driftX) * free + p.targetX * gather;
      const y: number = (p.y + driftY) * free + (h * 0.68 + p.row * waveHeight) * gather;
      const radius: number = p.radius * (1 + Math.sin(time * p.pulse + p.freePhase) * 0.18) * free
        + p.waveRadius * (1 + Math.sin(time * Math.PI / 10 + p.phase) * 0.025) * gather;
      const alpha: number = p.alpha * (0.72 + Math.cos(time * p.shimmer + p.freePhase * 1.7) * 0.28) * free
        + p.waveAlpha * (0.98 + Math.cos(time * Math.PI / 10 + p.phase * 1.7) * 0.02) * gather;
      this.px[i] = x;
      this.py[i] = y;
      this.pr[i] = radius > 0.05 ? radius : 0;
      this.pa[i] = alpha;
      this.pb[i] = alpha <= 0.02 ? 0 : Math.min(10, Math.max(1, Math.ceil(alpha * 10)));
    }
    ctx.fillStyle = this.rgba(this.ink, 1);
    for (let bucket = 1; bucket <= 10; bucket++) {
      ctx.beginPath();
      let painted: boolean = false;
      for (let i = 0; i < count; i++) {
        if (this.pb[i] !== bucket || this.pr[i] <= 0) {
          continue;
        }
        ctx.moveTo(this.px[i] + this.pr[i], this.py[i]);
        ctx.arc(this.px[i], this.py[i], this.pr[i], 0, TAU);
        painted = true;
      }
      if (painted) {
        ctx.globalAlpha = bucket / 10;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 用 scale 把圆形径向渐变拉成椭圆（对齐 CSS 的 radial-gradient(ellipse …)） */
  private fillEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number,
    rgb: number[], stops: number[]): void {
    if (rx <= 0 || ry <= 0) {
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    const gradient: CanvasGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (let i = 0; i + 1 < stops.length; i += 2) {
      gradient.addColorStop(stops[i], this.rgba(rgb, stops[i + 1]));
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }

  private rgba(rgb: number[], alpha: number): string {
    return 'rgba(' + Math.round(rgb[0]).toString() + ',' + Math.round(rgb[1]).toString() + ','
      + Math.round(rgb[2]).toString() + ',' + alpha.toFixed(3) + ')';
  }

  private lerp(from: number[], to: number[], k: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < 3; i++) {
      out.push(from[i] + (to[i] - from[i]) * k);
    }
    return out;
  }

  private palette(): VoicePalette {
    const palette: VoicePalette = new VoicePalette();
    if (this.isDark) {
      if (this.cancelArmed) {
        palette.base = [91, 53, 67];
        palette.glow = [137, 86, 104];
        palette.ink = [250, 229, 235];
      } else {
        palette.base = [32, 59, 92];
        palette.glow = [57, 101, 143];
        palette.ink = [227, 240, 255];
      }
    } else {
      if (this.cancelArmed) {
        palette.base = [240, 172, 186];
        palette.glow = [255, 214, 218];
        palette.ink = [100, 36, 52];
      } else {
        palette.base = [115, 169, 231];
        palette.glow = [175, 215, 250];
        palette.ink = [23, 60, 101];
      }
    }
    return palette;
  }

  private inkCss(): string {
    if (this.isDark) {
      return this.cancelArmed ? '#FAE5EB' : '#E3F0FF';
    }
    return this.cancelArmed ? '#642434' : '#173C65';
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      if (this.presented) {
        Stack({ alignContent: Alignment.TopStart }) {
          Canvas(this.ctx)
            .width('100%')
            .height('100%')
            .onReady(() => {
              // onAreaChange 在本机可能晚一拍：先按 ctx 自己的尺寸兜底，别再等回调
              if (this.canvasWidth <= 0 || this.canvasHeight <= 0) {
                const cw: number = Number(this.ctx.width);
                const ch: number = Number(this.ctx.height);
                if (cw > 0 && ch > 0) {
                  this.layout(cw, ch);
                }
              }
              if (this.canvasWidth > 0 && this.canvasHeight > 0 && this.particles.length === 0) {
                this.buildField();
              }
              this.startLoop();
            })
            .onAreaChange((previous: Area, next: Area) => {
              this.layout(Number(next.width), Number(next.height));
            })
          if (this.panelHeight > 0 && this.status.length > 0) {
            Text(this.status)
              .width('100%')
              .textAlign(TextAlign.Center)
              .fontSize(17)
              .lineHeight(24)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.inkCss())
              .opacity(0.9)
              .margin({ top: this.panelHeight * 0.4 - 12 })
              .hitTestBehavior(HitTestMode.None)
          }
        }
        .width('100%')
        .height('40%')
        .opacity(this.shown ? 1 : 0)
        .translate({ y: this.shown ? 0 : 18 })
        .animation({ duration: this.shown ? 160 : 280, curve: Curve.FastOutSlowIn })
      }
    }
    .width('100%')
    .height('100%')
    // 对齐 CSS pointer-events:none：特效不参与触摸，手指还压在下面的输入条上
    .hitTestBehavior(HitTestMode.None)
    .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])
  }
}
