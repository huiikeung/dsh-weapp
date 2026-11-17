/**
 * 鸿蒙原生玻璃卡片（ArkUI backgroundEffect 模糊 + 半透明填充 + 描边）。
 * 与小程序 settings-glass-card / glass 类保持一致：18vp 圆角、1px 玻璃边、背景高斯模糊。
 */
@Component
export struct GlassCard {
  /** 圆角（vp） */
  @Prop cardRadius: number = 18;
  /** 模糊半径（vp），0 表示不模糊 */
  @Prop blurRadius: number = 12;
  /** 填充色 */
  @Prop fillColor: string = 'rgba(255,255,255,0.07)';
  /** 描边色（不可命名为 borderColor：会与组件通用属性重名） */
  @Prop strokeColor: string = 'rgba(255,255,255,0.20)';
  /** 是否显示投影 */
  @Prop showShadow: boolean = true;
  /** 内容 */
  @BuilderParam content: () => void;

  build() {
    Column() {
      this.content()
    }
    .width('100%')
    .borderRadius(this.cardRadius)
    .backgroundColor(this.fillColor)
    .backgroundEffect({
      radius: this.blurRadius,
      saturation: 1.4,
      brightness: 1.0
    })
    .border({ width: 1, color: this.strokeColor })
    .shadow(this.showShadow
      ? { radius: 18, color: 'rgba(3,14,30,0.22)', offsetY: 6 }
      : { radius: 0, color: Color.Transparent, offsetY: 0 })
  }
}
