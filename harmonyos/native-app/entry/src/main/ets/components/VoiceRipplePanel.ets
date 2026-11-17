@Component
export struct VoiceRipplePanel {
  @Prop level: number = 0;
  @Prop cancelling: boolean = false;
  @Prop visible: boolean = false;
  @State private phase: number = 0;
  private bars(): number[] { return [0.3, 0.6, 1, 0.6, 0.3]; }
  build() {
    if (this.visible) {
      Row({ space: 6 }) {
        ForEach(this.bars(), (factor: number) => {
          Column().width(4).height(10 + factor * Math.max(8, this.level * 40))
            .backgroundColor(this.cancelling ? '#D9413A' : '#2E6BE6').borderRadius(2)
        }, (factor: number) => factor.toString())
      }.height(52).padding(12).backgroundColor(this.cancelling ? '#D9413A18' : '#2E6BE618').borderRadius(24)
    }
  }
}
