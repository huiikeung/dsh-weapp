/**
 * 二级页面的返回按钮（鸿蒙原生写法）。
 *
 * 对齐 dsh-mobile（iOS）的 glassCircleButton：
 *   · 深色动态背景 → .glass(.clear.tint(navy 0.22))：极淡深蓝底 + 强模糊
 *   · 普通背景     → .glass：标准液态玻璃
 *   · 旧系统回退   → .ultraThinMaterial + 白色 25% 描边 0.8pt
 *
 * 所以不用实色外圈，只保留「强背景模糊 + 极淡同色调底 + 白色 25% 细边 + 柔和投影」。
 */
@Component
export struct NavBackButton {
  /** 深色主题：玻璃用深蓝 tint，箭头用亮色 */
  @Prop isDark: boolean = false;
  /** 无障碍文案 */
  @Prop label: string = '返回';
  /** 是否显示玻璃底（对话框内嵌等场景可关掉） */
  @Prop glass: boolean = true;

  /** 箭头颜色：与页面正文同色系 */
  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  /** 玻璃底：对齐 iOS .glass(.clear.tint(navy 0.22))，极低不透明度，透感交给模糊 */
  private glassTint(): string {
    return this.isDark ? 'rgba(10,30,60,0.22)' : 'rgba(255,255,255,0.10)';
  }

  /** 描边：iOS 用白色 25% / 0.8pt 勾边缘，不画实色圈 */
  private glassStroke(): string {
    return 'rgba(255,255,255,0.25)';
  }

  /** 悬浮投影：中性色、向下偏移，把圆盘从背景上「托起来」 */
  private floatShadow(): string {
    return this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)';
  }

  /** 可见玻璃圆盘直径 */
  private discSize(): number {
    return 40;
  }

  build() {
    // 单个玻璃圆盘：强模糊 + 极淡底 + 白色 25% 细边 + 柔和投影（对齐 iOS Liquid Glass）
    Button({ type: ButtonType.Circle }) {
      SymbolGlyph($r('sys.symbol.chevron_backward'))
        .fontSize(18)
        .fontColor([this.ink()])
        .fontWeight(FontWeight.Medium)
    }
    .width(this.discSize())
    .height(this.discSize())
    .backgroundColor(this.glass ? this.glassTint() : Color.Transparent)
    // ultraThinMaterial 的特征：模糊强、底色极淡
    .backdropBlur(this.glass ? 20 : 0)
    // 内缘高光（iOS 26 Liquid Glass 特征）：顶部边缘最亮、向下逐渐变暗，形成玻璃反光弧
    .border(this.glass
      ? {
        width: 0.8,
        color: {
          top: 'rgba(255,255,255,0.62)',
          left: 'rgba(255,255,255,0.30)',
          right: 'rgba(255,255,255,0.30)',
          bottom: 'rgba(255,255,255,0.12)'
        }
      }
      : { width: 0, color: Color.Transparent })
    .accessibilityText(this.label)
    .shadow(this.glass
      ? { radius: 16, color: this.floatShadow(), offsetX: 0, offsetY: 8 }
      : { radius: 0, color: Color.Transparent, offsetX: 0, offsetY: 0 })
  }
}
