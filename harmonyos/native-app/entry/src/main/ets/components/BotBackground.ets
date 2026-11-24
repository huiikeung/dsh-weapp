/**
 * Bot 模式专用背景（浅紫主题）：
 *   · 浅色：基色 BotLavender #F4F1FA，叠柔和淡紫光斑（#EBE0F7 / #E0D4F0 近似）+ 淡技术网格（墨色 #6E529E 低透明度）。
 *   · 深色：基色 #17161F，叠黑紫（#3D3647 / #302B36）低透明度光斑与网格。
 * 对齐 iOS Bot 背景「只换色、不换几何、不换层序」：基色 → 光斑/光弧 → 技术网格 → 底部收敛。
 *
 * 与首页 OceanBackground 的分层实现不同：Bot 首页不需要流体与鲸鱼逐帧点阵，
 * 这里只用一层 Canvas，在首帧就绪与尺寸/主题变化时各静态绘制一次（无定时器、无逐帧重绘），
 * CPU 开销接近零；背景铺满父容器且不参与命中测试。
 */
import { WHALE_PIXELS_IOS, WHALE_PIXELS_PAD } from 'nativecore';

@Component
export struct BotBackground {
  @StorageLink('isDark') @Watch('onSchemeChange') isDark: boolean = false;

  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private canvasWidth: number = 0;
  private canvasHeight: number = 0;
  private ready: boolean = false;

  private onSchemeChange(): void {
    this.draw();
  }

  private draw(): void {
    if (!this.ready) {
      return;
    }
    const w: number = this.canvasWidth;
    const h: number = this.canvasHeight;
    if (w <= 0 || h <= 0) {
      return;
    }
    const ctx: CanvasRenderingContext2D = this.ctx;
    ctx.clearRect(0, 0, w, h);
    if (this.isDark) {
      this.paintDark(ctx, w, h);
    } else {
      this.paintLight(ctx, w, h);
    }
    this.paintGrid(ctx, w, h);
    // 鲸鱼点阵：与工作模式同一构图（iOS HarnessBackgroundComposition），Bot 主题只换配色
    this.paintWhale(ctx, w, h);
    this.paintVeil(ctx, w, h);
  }

  /** 柔和径向光斑：中心色 → 全透明，铺满一层 */
  private glow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number,
    inner: string, outer: string): void {
    const grad: CanvasGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
  }

  /**
   * 斜向光束：在旋转坐标系里画一条宽渐变光带（起点透明→中间提亮→尾部衰减），
   * 对齐 iOS/安卓 Bot 背景里那道从左上斜向右下的柔光。
   */
  private streak(ctx: CanvasRenderingContext2D, w: number, h: number, angle: number,
    offsetY: number, bandH: number, rgb: string, peakAlpha: number): void {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    const span: number = Math.max(w, h);
    const grad: CanvasGradient = ctx.createLinearGradient(-span * 1.1, 0, span * 1.1, 0);
    grad.addColorStop(0, 'rgba(' + rgb + ',0)');
    grad.addColorStop(0.36, 'rgba(' + rgb + ',' + peakAlpha.toString() + ')');
    grad.addColorStop(0.64, 'rgba(' + rgb + ',' + (peakAlpha * 0.55).toString() + ')');
    grad.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-span * 1.6, offsetY - bandH / 2, span * 3.2, bandH);
    ctx.restore();
  }

  /** 浅色：淡紫基色 + 柔光斑 + 斜向光束（对齐 dsh-mobile Bot 背景）+ 顶部提亮 */
  private paintLight(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#EFE9F6';
    ctx.fillRect(0, 0, w, h);
    const span: number = Math.max(w, h);
    // 柔光斑：左上更亮、右下偏深紫，整体像一层浅浅的雾光
    this.glow(ctx, w * 0.24, h * 0.06, span * 0.95, 'rgba(255,255,255,0.62)', 'rgba(255,255,255,0)');
    this.glow(ctx, w * 0.95, h * 0.26, span * 0.72, 'rgba(226,213,243,0.90)', 'rgba(226,213,243,0)');
    this.glow(ctx, w * 0.04, h * 0.94, span * 0.68, 'rgba(219,204,238,0.75)', 'rgba(219,204,238,0)');
    // 三道斜向光束：白 → 白 → 淡紫，营造柔和的流动光带
    this.streak(ctx, w, h, -0.34, -h * 0.34, h * 0.24, '255,255,255', 0.60);
    this.streak(ctx, w, h, -0.34, -h * 0.02, h * 0.34, '255,255,255', 0.44);
    this.streak(ctx, w, h, -0.34, h * 0.30, h * 0.20, '238,228,249', 0.55);
    // 顶部提亮，让品牌栏与标题区更透气
    const top: CanvasGradient = ctx.createLinearGradient(0, 0, 0, h * 0.34);
    top.addColorStop(0, 'rgba(255,255,255,0.30)');
    top.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, w, h * 0.34);
  }

  /** 深色：近黑紫基色 + 黑紫柔光 + 极淡的斜向光束（夜间不刺眼） */
  private paintDark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#17161F';
    ctx.fillRect(0, 0, w, h);
    const span: number = Math.max(w, h);
    this.glow(ctx, w * 0.16, h * 0.10, span * 0.82, 'rgba(61,54,71,0.85)', 'rgba(61,54,71,0)');
    this.glow(ctx, w * 0.95, h * 0.28, span * 0.70, 'rgba(48,43,54,0.80)', 'rgba(48,43,54,0)');
    this.glow(ctx, w * 0.20, h * 0.92, span * 0.66, 'rgba(110,82,158,0.16)', 'rgba(110,82,158,0)');
    this.streak(ctx, w, h, -0.34, -h * 0.30, h * 0.26, '200,181,232', 0.075);
    this.streak(ctx, w, h, -0.34, 0, h * 0.30, '200,181,232', 0.05);
    const arc: CanvasGradient = ctx.createLinearGradient(0, h * 0.30, w, h * 0.95);
    arc.addColorStop(0, 'rgba(119,96,180,0)');
    arc.addColorStop(0.48, 'rgba(119,96,180,0.12)');
    arc.addColorStop(1, 'rgba(119,96,180,0)');
    ctx.strokeStyle = arc;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(w * 0.62, h * 0.72, Math.min(w, h) * 0.64, Math.PI * 1.02, Math.PI * 1.72);
    ctx.stroke();
  }

  /** 淡技术网格：浅色用墨色 #6E529E、深色用黑紫，透明度都很低 */
  private paintGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const gap: number = Math.min(w, h) >= 600 ? 56 : 42;
    ctx.strokeStyle = this.isDark ? 'rgba(77,69,87,0.28)' : 'rgba(110,82,158,0.06)';
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
    ctx.fillStyle = this.isDark ? 'rgba(200,181,232,0.10)' : 'rgba(110,82,158,0.11)';
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

  /**
   * 鲸鱼点阵（静态绘制一次）：构图与工作模式 OceanBackground / iOS HarnessBackgroundComposition 一致，
   * Bot 主题只换配色（浅色淡紫、深色淡紫发光），不做逐帧动画。
   */
  private paintWhale(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const pad: boolean = Math.min(w, h) >= 600;
    const source: number[][] = pad ? WHALE_PIXELS_PAD : WHALE_PIXELS_IOS;
    if (source.length === 0) {
      return;
    }
    let square: number = 0;
    let cx: number = 0;
    let cy: number = 0;
    let baseDot: number = 0;
    if (pad) {
      const aspect: number = w / Math.max(1, h);
      const wideProgress: number = Math.min(1, Math.max(0, (aspect - 0.65) / 0.75));
      square = Math.min(Math.max(w * 1.15, h * 0.48), h * 1.12) * 1.02;
      cx = w * (0.55 + 0.05 * wideProgress);
      cy = h * (0.34 + 0.12 * wideProgress);
      baseDot = Math.min(2.2, Math.max(0.8, square / 420));
    } else {
      square = Math.max(w * 1.15, h * 0.48);
      cx = w * 0.55;
      cy = h * 0.34;
      baseDot = Math.max(1.45, square / 220);
    }
    const whaleWidth: number = square * 1.08;
    const colors: string[] = this.isDark
      ? ['rgba(200,181,232,0.10)', 'rgba(200,181,232,0.18)', 'rgba(220,205,242,0.26)']
      : ['rgba(119,96,180,0.10)', 'rgba(119,96,180,0.17)', 'rgba(88,65,144,0.24)'];
    try {
      ctx.globalCompositeOperation = this.isDark ? 'screen' : 'source-over';
    } catch (err) {
    }
    let current: number = -1;
    let open: boolean = false;
    for (let i = 0; i < source.length; i++) {
      const point: number[] = source[i];
      const level: number = Math.min(2, Math.max(0, Math.floor(point[2] * 3)));
      if (level !== current) {
        if (open) {
          ctx.fill();
        }
        current = level;
        ctx.fillStyle = colors[level];
        ctx.beginPath();
        open = true;
      }
      const dotSize: number = baseDot * (0.72 + point[2] * 0.58);
      const r: number = dotSize / 2;
      const x: number = cx + (point[0] - 0.5) * whaleWidth;
      const y: number = cy + (point[1] - 0.5) * square;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    if (open) {
      ctx.fill();
    }
    try {
      ctx.globalCompositeOperation = 'source-over';
    } catch (err) {
    }
  }

  /** 底部收敛：浅色向基色聚拢、深色压暗，保证列表与面板文字可读 */
  private paintVeil(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const veil: CanvasGradient = ctx.createLinearGradient(0, h * 0.52, 0, h);
    if (this.isDark) {
      veil.addColorStop(0, 'rgba(23,22,31,0)');
      veil.addColorStop(1, 'rgba(23,22,31,0.62)');
    } else {
      veil.addColorStop(0, 'rgba(244,241,250,0)');
      veil.addColorStop(1, 'rgba(244,241,250,0.52)');
    }
    ctx.fillStyle = veil;
    ctx.fillRect(0, h * 0.52, w, h * 0.48);
  }

  build() {
    Stack() {
      Canvas(this.ctx)
        .width('100%')
        .height('100%')
        .onReady(() => {
          this.ready = true;
          this.draw();
        })
        .hitTestBehavior(HitTestMode.None)
        .accessibilityLevel('no')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.isDark ? '#17161F' : '#F4F1FA')
    .onAreaChange((_before: Area, area: Area) => {
      const w: number = Number(area.width);
      const h: number = Number(area.height);
      if (w === this.canvasWidth && h === this.canvasHeight) {
        return;
      }
      this.canvasWidth = w;
      this.canvasHeight = h;
      this.draw();
    })
  }
}
