/**
 * ConversationProgress —— 运行中指示条（严格对齐小程序 session 页 progress-row）
 *
 * 小程序实现（miniprogram/pages/session/session.wxml:349-354 + styles/status-appearance.wxss + status-tail-animation.wxss）：
 *  .conversation-progress .progress-row  min-height 52rpx / padding 10rpx 0 / 垂直居中
 *  .status-tail      36rpx×36rpx 槽位，居中，margin-right 12rpx
 *  .status-tail-ink  28rpx×28rpx，mask 雪碧图 + background-color 按样式色板关键帧循环
 *                    （classic 4s / neon 3s / terminal 6s 反向 / candy 5s / glitch 2s 反向 / original 2.2s）
 *                    + statusTailSwim 3s steps(59)（20fps 逐帧）
 *  .status-gradient  24rpx/400/行高 36rpx，linear-gradient 色板横向流动（background-size 200%），
 *                    方向与周期同色板；terminal 用等宽字体；neon/candy 叠加呼吸；glitch 叠加错色。
 *
 * 本实现：鲸尾用 60 帧 SVG 雪碧图逐帧平移（20fps、3s 一轮 = steps(59)），
 * 颜色按「相位 + 方向」从色板插值（等价于小程序 keyframes）；
 * 文字逐字取渐变相位色（等价于 background-clip:text 的横向渐变）。
 */
import { StatusAppearance } from 'nativecore';


/** 一个字符 + 它当前的颜色（逐字渐变用） */
interface GlyphColor {
  ch: string;
  color: string;
}

@Component
export struct ConversationProgress {
  @Prop appearance: string = 'classic';
  /** 实时主题：直接订阅 AppStorage，避免父级 @Prop 未刷新时颜色不跟随 */
  @StorageProp('statusAppearance') appearanceLive: string = 'classic';
  @Prop isDark: boolean = false;
  /** 如「推敲细节中，用时 12 秒…」 */
  @Prop label: string = '';
  /** 过程组可展开时点击整行回调 */
  @Prop expandable: boolean = false;

  private onTap: () => void = () => {
  };

  private startedAt: number = 0;
  private colorTimer: number = -1;
  private frameTimer: number = -1;
  private breatheTimer: number = -1;
  @State private frame: number = 0;
  @State private elapsedMs: number = 0;
  /** neon/candy：呼吸 0.74↔1（小程序 statusBreathe 3s） */
  @State private breathe: number = 1;
  /** glitch：错色相位（小程序 statusGlitch 4s，92%/94% 两帧闪烁） */
  @State private glitchTick: number = 0;

  // ==================== 色板采样（对齐小程序 keyframes） ====================

  private styleId(): string {
    return this.appearanceLive.length > 0 ? this.appearanceLive : this.appearance;
  }

  private reverse(): boolean {
    return this.styleId() === 'terminal' || this.styleId() === 'glitch';
  }

  /** 当前相位 0..1（按样式周期循环，terminal/glitch 反向） */
  private phase(): number {
    const duration: number = StatusAppearance.durationMs(this.styleId());
    const total: number = duration > 0 ? duration : 4000;
    const raw: number = (this.elapsedMs % total) / total;
    return this.reverse() ? 1 - raw : raw;
  }

  private mix(from: string, to: string, t: number): string {
    const r1: number = parseInt(from.substring(1, 3), 16);
    const g1: number = parseInt(from.substring(3, 5), 16);
    const b1: number = parseInt(from.substring(5, 7), 16);
    const r2: number = parseInt(to.substring(1, 3), 16);
    const g2: number = parseInt(to.substring(3, 5), 16);
    const b2: number = parseInt(to.substring(5, 7), 16);
    const r: number = Math.round(r1 + (r2 - r1) * t);
    const g: number = Math.round(g1 + (g2 - g1) * t);
    const b: number = Math.round(b1 + (b2 - b1) * t);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
  }

  /** 按相位从色板插值（色标等分，末段回到首色，与小程序 keyframes 一致） */
  private sampleAt(p: number): string {
    const colors: string[] = StatusAppearance.colors(this.styleId(), this.isDark);
    if (colors.length === 0) {
      return '#A8BEDB';
    }
    if (colors.length === 1) {
      return colors[0];
    }
    const safe: number = ((p % 1) + 1) % 1;
    const scaled: number = safe * colors.length;
    const index: number = Math.floor(scaled) % colors.length;
    const next: number = (index + 1) % colors.length;
    return this.mix(colors[index], colors[next], scaled - Math.floor(scaled));
  }

  /** 鲸尾颜色：小程序 .status-tail-ink 的 background-color 关键帧（reverse 感知） */
  private tailColor(): string {
    return StatusAppearance.sample(this.styleId(), this.isDark, this.elapsedMs);
  }

  /** 文字渐变色：逐字按横向位置 + 相位取色（小程序 background-size 200% 的横向渐变） */
  private glyphs(): GlyphColor[] {
    const chars: string[] = this.label.split('');
    const count: number = chars.length;
    const base: number = this.phase();
    const result: GlyphColor[] = [];
    for (let i = 0; i < count; i++) {
      // 小程序 background-size:200% 100% → 元素宽度只覆盖色板的一半
      // 小程序：background-size:200%（整条渐变铺两遍），元素宽度只占其中一半，
      // 因此文字横向覆盖「半个色板」；左端颜色 == 鲸尾颜色
      const at: number = count > 1 ? (i / count) * 0.5 : 0;
      // 与鲸尾同一条关键帧曲线，横向展开半个色板
      result.push({ ch: chars[i], color: StatusAppearance.sampleAtPhase(this.styleId(), this.isDark, base + at) });
    }
    return result;
  }

  /** 故障样式：错色偏移（-1 左红右青 / 1 左青右红 / 0 无） */
  private glitchDir(): number {
    if (this.styleId() !== 'glitch') {
      return 0;
    }
    const pos: number = (this.glitchTick % 40) / 40;
    if (pos >= 0.92 && pos < 0.94) {
      return 1;
    }
    if (pos >= 0.94 && pos < 0.96) {
      return -1;
    }
    return 0;
  }

  aboutToAppear(): void {
    this.startedAt = Date.now();
    // 逐帧 20fps（对齐小程序 steps(59) / 3s）。颜色也用同一拍采样：
    // 原来 90ms + 50ms 两个定时器各自 setState，等于每秒触发 31 次重渲染，
    // 合成一拍只要 20 次，动画看不出差别，空转 CPU 少一半。
    this.frameTimer = setInterval(() => {
      this.frame = (this.frame + 1) % 60;
      // 挂钟取模（与设置页预览同一把尺子），保证图标/文字颜色在两边一致
      this.elapsedMs = Date.now();
      this.glitchTick = this.glitchTick + 1;
    }, 50);
    // 呼吸：neon/candy 3s 周期 1 → 0.74 → 1
    this.breatheTimer = setInterval(() => {
      animateTo({ duration: 1500, curve: Curve.EaseInOut }, () => {
        this.breathe = this.breathe > 0.9 ? 0.74 : 1;
      });
    }, 1500);
  }

  aboutToDisappear(): void {
    if (this.colorTimer >= 0) {
      clearInterval(this.colorTimer);
      this.colorTimer = -1;
    }
    if (this.frameTimer >= 0) {
      clearInterval(this.frameTimer);
      this.frameTimer = -1;
    }
    if (this.breatheTimer >= 0) {
      clearInterval(this.breatheTimer);
      this.breatheTimer = -1;
    }
  }

  /** 呼吸只在 neon/candy 生效 */
  private textOpacity(): number {
    const id: string = this.styleId();
    return id === 'neon' || id === 'candy' ? this.breathe : 1;
  }

  build() {
    Row() {
      // ① 鲸尾槽位：36rpx≈21vp，内部 28rpx≈16.4vp，居中，右侧 12rpx≈7vp
      // 用矢量 Path 逐帧填充（而不是位图 fillColor）：颜色每帧都跟着色板走，
      // 与右侧逐字流光同相位，不会再出现「图标不变色 / 和文字不同步」。
      Stack() {
        Stack() {
          // 原始 SVG 雪碧图（矢量，边缘清晰）
          Image($r('app.media.whale_tail_sprite'))
            .width(984)
            .height(16.4)
            .objectFit(ImageFit.Fill)
            .translate({ x: -this.frame * 16.4 })
          // 用当前流光色以 SRC_ATOP 叠一层：只保留图形的 alpha，颜色就是 tailColor()，
          // 且不会像位图着色那样糊边。tailColor() 与右侧第一个字同相位。
          Rect()
            .width(16.4)
            .height(16.4)
            .fill(this.tailColor())
            .blendMode(BlendMode.SRC_ATOP, BlendApplyType.OFFSCREEN)
        }
        .width(16.4)
        .height(16.4)
        .clip(true)
        .alignContent(Alignment.TopStart)
      }
      .width(21)
      .height(21)
      .alignContent(Alignment.Center)
      .flexShrink(0)
      .margin({ right: 7 })

      // ② 流光文字：24rpx≈14.1vp / 400 / 行高 36rpx≈21vp，逐字渐变
      Row() {
        ForEach(this.glyphs(), (glyph: GlyphColor, index: number) => {
          Text(glyph.ch)
            .fontSize(14.1)
            .fontWeight(FontWeight.Regular)
            .lineHeight(21)
            .fontColor(glyph.color)
            .fontFamily(this.styleId() === 'terminal' ? 'monospace' : 'HarmonyOS Sans')
            .textShadow(this.glitchDir() === 0
              ? { radius: 0, color: '#00000000', offsetX: 0, offsetY: 0 }
              : (this.glitchDir() > 0
                ? { radius: 0, color: '#FF5F6D', offsetX: 1, offsetY: 0 }
                : { radius: 0, color: '#5FD4FF', offsetX: 1, offsetY: 0 }))
          // key 不带颜色：颜色每帧都在变，带进 key 会让 ForEach 每帧销毁重建所有 Text
        }, (glyph: GlyphColor, index: number) => index.toString() + glyph.ch)
      }
      .layoutWeight(1)
      .opacity(this.textOpacity())
      .clip(true)
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .constraintSize({ minHeight: 30.5 })
    .padding({ left: 0, right: 0, top: 5.9, bottom: 5.9 })
    .margin({ top: 9.4 })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      if (this.expandable) {
        this.onTap();
      }
    })
  }
}
