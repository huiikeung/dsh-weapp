/**
 * 二级页面的返回按钮（鸿蒙原生写法）。
 *
 * 边缘和阴影对齐「⋯」「协作」系统菜单容器：
 *   bindMenu 那边就是 outlineColor: dividerColor() + outlineWidth: 1，
 *   也就是深色白 16% / 浅色黑 10% 的中性 1vp 细边，配系统菜单那种柔和投影。
 *   底色用中性玻璃（不偏蓝），不加外发光——菜单本身也没有发光。
 */
@Component
export struct NavBackButton {
  /** 深色主题 */
  @Prop isDark: boolean = false;
  /** 无障碍文案 */
  @Prop label: string = '返回';
  /** 是否显示玻璃底（对话框内嵌等场景可关掉） */
  @Prop glass: boolean = true;
  /** 圆钮直径（对话页顶栏与右侧 36vp 小圆钮保持一致） */
  @Prop diameter: number = 40;

  /** 箭头颜色：与页面正文同色系 */
  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  /** 玻璃底：深色中性深灰 / 浅色半透明白（保持原样不动） */
  private glassTint(): string {
    return this.isDark ? 'rgba(44,44,48,0.46)' : 'rgba(255,255,255,0.24)';
  }

  /** 边缘：白色细边（深浅色都用白，浅色下更亮更通透） */
  private menuOutline(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)';
  }

  /** 投影：系统菜单那种柔和下拉阴影 */
  private menuShadow(): string {
    return this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)';
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.chevron_backward'))
          .fontSize(this.diameter * 0.45)
          .fontColor([this.ink()])
          .fontWeight(FontWeight.Medium)
      }
      .width(this.diameter)
      .height(this.diameter)
      .backgroundColor(this.glass ? this.glassTint() : Color.Transparent)
      .clip(true)
      .backdropBlur(this.glass ? 14 : 0)
      // 与系统菜单同款 1vp 中性描边（Button 自己画，避免被外层圆角影响）
      .border(this.glass
        ? { width: 1, color: this.menuOutline() }
        : { width: 0, color: Color.Transparent })
      .accessibilityText(this.label)
    }
    .width(this.diameter)
    .height(this.diameter)
    .borderRadius(this.diameter / 2)
    // 投影画在不裁剪的容器上（Button 会裁剪自身 shadow）
    .shadow(this.glass
      ? { radius: 14, color: this.menuShadow(), offsetX: 0, offsetY: 6 }
      : { radius: 0, color: Color.Transparent, offsetX: 0, offsetY: 0 })
  }
}
