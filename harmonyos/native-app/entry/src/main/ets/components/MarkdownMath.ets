@Component
export struct MarkdownMath {
  @Prop expression: string = '';
  @Prop inline: boolean = true;
  build() {
    Text(this.inline ? '$' + this.expression + '$' : '$$' + this.expression + '$$')
      .fontSize(this.inline ? 14 : 16).fontFamily('serif').fontColor('#2E6BE6')
  }
}
