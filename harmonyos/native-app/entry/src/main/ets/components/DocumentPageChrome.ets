@Component
export struct DocumentPageChrome {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @BuilderParam content: () => void;
  build() {
    Column() {
      Row() { Text(this.title).fontSize(18).fontWeight(FontWeight.Bold); Blank(); Text(this.subtitle).fontSize(11).fontColor('#8E8E93') }
        .width('100%').padding({ left: 16, right: 16, top: 12, bottom: 8 })
      Scroll() { this.content() }.layoutWeight(1)
    }.width('100%').height('100%')
  }
}
