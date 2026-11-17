@Component
export struct CodeSyntaxHighlighter {
  @Prop code: string = '';
  @Prop language: string = '';
  @State private highlighted: string = '';
  aboutToAppear(): void { this.highlighted = CodeSyntaxHighlighter.highlight(this.code); }
  static highlight(code: string): string {
    const keywords: string[] = ['class','function','const','let','var','if','else','return','import','export','interface','struct','void','async','await','new','this','static','private','public'];
    let result: string = code;
    for (const word of keywords) result = result.split(word).join('«' + word + '»');
    return result;
  }
  build() {
    Column() {
      Text(this.language.length > 0 ? this.language : 'code').fontSize(11).fontColor('#8E8E93')
      Text(this.highlighted).fontSize(13).fontFamily('monospace').fontColor('#D8DEE9').width('100%')
    }.padding(10).backgroundColor('#1E2430').borderRadius(8)
  }
}
