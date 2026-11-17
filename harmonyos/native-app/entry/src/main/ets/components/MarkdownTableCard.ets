@Component
export struct MarkdownTableCard {
  @Prop headers: string[] = [];
  @Prop rows: string[][] = [];
  build() {
    Column() {
      Row() { ForEach(this.headers, (h: string) => Text(h).fontSize(12).fontWeight(FontWeight.Bold).layoutWeight(1), (h: string) => h) }
        .padding(6).backgroundColor('#F2F2F7')
      ForEach(this.rows, (row: string[]) => {
        Row() { ForEach(row, (cell: string) => Text(cell).fontSize(12).layoutWeight(1), (cell: string, i: number) => i + cell) }.padding(6)
      }, (row: string[], i: number) => 'row' + i)
    }.border({ width: 1, color: '#E5E5EA' }).borderRadius(8)
  }
}
