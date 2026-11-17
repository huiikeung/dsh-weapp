@Component
export struct WorkspaceLoadingLogo {
  @Prop label: string = '加载中…';
  @State private angle: number = 0;
  build() {
    Column({ space: 10 }) {
      Circle({ width: 34, height: 34 }).stroke('#2E6BE6').strokeWidth(3).fill('#00000000')
      Text(this.label).fontSize(12).fontColor('#8E8E93')
    }.width('100%').height('100%').justifyContent(FlexAlign.Center)
  }
}
