/**
 * 二级页面的返回按钮（鸿蒙原生写法）。
 *
 * 组成全部用系统原生组件，不画自定义图形：
 *   · Button + ButtonType.Circle  → 原生圆形按钮与按压波纹
 *   · backgroundBlurStyle(COMPONENT_THICK) → 与右上角「⋯」系统菜单同族的玻璃材质
 *   · SymbolGlyph(sys.symbol.chevron_backward) → 系统符号字体里的返回箭头
 *
 * 光圈厚度 1.3vp，与对话页输入框卡片的光圈一致。
 */
@Component
export struct NavBackButton {
  /** 深色主题：玻璃在深色下更通透、箭头用亮色 */
  @Prop isDark: boolean = false;
  /** 无障碍文案 */
  @Prop label: string = '返回';
  /** 是否显示玻璃底（对话框内嵌等场景可关掉） */
  @Prop glass: boolean = true;

  /** 箭头颜色：与页面正文同色系 */
  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  /** 玻璃底：背景模糊之上再叠一层半透明底色，深色贴黑、浅色接近纯白 */
  private glassTint(): string {
    return this.isDark ? 'rgba(8,8,10,0.60)' : 'rgba(255,255,255,0.80)';
  }

  /** 外圈光圈：玻璃外层再包一圈实色环，深浅色都用白色 */
  private ringColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.96)';
  }

  /** 悬浮投影：中性色、向下偏移，只负责把圆盘从背景上「托起来」 */
  private floatShadow(): string {
    return this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)';
  }

  /** 玻璃内缘的 0.5vp 细边，让玻璃面和光圈之间有一层分隔 */
  private glassEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  }

  build() {
    // 光圈层：1.3vp 实色环包住玻璃圆盘（与输入框卡片的光圈厚度一致）
    Stack({ alignContent: Alignment.Center }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.chevron_backward'))
          .fontSize(18)
          .fontColor([this.ink()])
          .fontWeight(FontWeight.Medium)
      }
      .width(37.4)
      .height(37.4)
      .backgroundColor(this.glassTint())
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .border({ width: 0.5, color: this.glassEdge() })
      .accessibilityText(this.label)
    }
    .width(40)
    .height(40)
    .borderRadius(20)
    .padding(1.3)
    .backgroundColor(this.glass ? this.ringColor() : Color.Transparent)
    // 悬浮感：很轻的中性投影（只托起一点点，不喧宾夺主）
    .shadow(this.glass
      ? { radius: 6, color: this.floatShadow(), offsetX: 0, offsetY: 2 }
      : { radius: 0, color: Color.Transparent, offsetX: 0, offsetY: 0 })
  }
}
