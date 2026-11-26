/**
 * 纯绘制小图标：桌面电脑 / 服务器（原来散在 HomePage / AppSettingsPage / HostSwitcherBar 里的 hostGlyph、serverGlyph）。
 *
 * 为什么改成 @Component 而不是 @Builder：
 *   @Builder 的参数是「按值传递」——把颜色当参数传进去以后，这个颜色只在首次创建时生效，
 *   状态（isDark）再变也不会刷新，所以手机直接切深/浅色时，页面上文字和背景都跟着变了，
 *   只有这类手绘图标的描边还停在上一个主题的颜色。
 *   这里把颜色放进组件内部，用 @StorageLink('isDark') 现算，切主题时组件自己重建。
 *   darkColor / lightColor 只表示「深色主题用哪个色、浅色主题用哪个色」，本身是静态值。
 *
 * 注意：入参叫 glyphSize 而不是 size —— ArkUI 的 CustomComponent 自带 size 属性，@Prop size 会冲突。
 */
@Component
export struct HostGlyph {
  @Prop glyphSize: number = 16;
  @Prop darkColor: string = '#FFFFFF';
  @Prop lightColor: string = '#000000';
  @StorageLink('isDark') isDark: boolean = false;

  private ink(): string {
    return this.isDark ? this.darkColor : this.lightColor;
  }

  /** iOS 风格「桌面电脑」图标（近似 SF Symbols desktopcomputer：屏幕 + 支架 + 底座） */
  build() {
    Column() {
      Column()
        .width(this.glyphSize * 0.94)
        .height(this.glyphSize * 0.60)
        .border({ width: 1.4, color: this.ink() })
        .borderRadius(this.glyphSize * 0.12)
      Column()
        .width(1.4)
        .height(this.glyphSize * 0.14)
        .backgroundColor(this.ink())
      Column()
        .width(this.glyphSize * 0.42)
        .height(1.4)
        .borderRadius(1)
        .backgroundColor(this.ink())
    }
    .width(this.glyphSize)
    .height(this.glyphSize)
    .justifyContent(FlexAlign.Center)
  }
}

@Component
export struct ServerGlyph {
  @Prop glyphSize: number = 16;
  @Prop darkColor: string = '#FFFFFF';
  @Prop lightColor: string = '#000000';
  @StorageLink('isDark') isDark: boolean = false;

  private ink(): string {
    return this.isDark ? this.darkColor : this.lightColor;
  }

  /** iOS 风格「服务器」图标（近似 SF Symbols server.rack：竖长机箱 + 两道分隔线 + 状态点） */
  build() {
    Stack({ alignContent: Alignment.Center }) {
      // 机箱外框（接近 SF Symbols：略扁的方形）
      Column()
        .width(this.glyphSize * 0.90)
        .height(this.glyphSize * 0.76)
        .border({ width: 1.4, color: this.ink() })
        .borderRadius(this.glyphSize * 0.14)
      // 两道分隔线（与机箱同宽，把它分成三层）
      Column()
        .width(this.glyphSize * 0.90)
        .height(1.2)
        .backgroundColor(this.ink())
        .translate({ y: -this.glyphSize * 0.127 })
      Column()
        .width(this.glyphSize * 0.90)
        .height(1.2)
        .backgroundColor(this.ink())
        .translate({ y: this.glyphSize * 0.127 })
      // 三层状态点（左侧）
      Circle({ width: this.glyphSize * 0.075, height: this.glyphSize * 0.075 }).fill(this.ink()).translate({ x: -this.glyphSize * 0.30, y: -this.glyphSize * 0.253 })
      Circle({ width: this.glyphSize * 0.075, height: this.glyphSize * 0.075 }).fill(this.ink()).translate({ x: -this.glyphSize * 0.30, y: 0 })
      Circle({ width: this.glyphSize * 0.075, height: this.glyphSize * 0.075 }).fill(this.ink()).translate({ x: -this.glyphSize * 0.30, y: this.glyphSize * 0.253 })
    }
    .width(this.glyphSize)
    .height(this.glyphSize)
  }
}
