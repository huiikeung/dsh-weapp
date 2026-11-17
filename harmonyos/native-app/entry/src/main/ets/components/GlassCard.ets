@Component
export struct GlassCard {
  @BuilderParam content: () => void;
  @Prop dark: boolean = false;
  build() {
    Column() { this.content() }
    .padding(14).borderRadius(14)
    .backgroundColor(this.dark ? '#1C1C1ECC' : '#FFFFFFCC')
    .border({ width: 1, color: this.dark ? '#FFFFFF22' : '#00000012' })
    .shadow({ radius: 12, color: '#00000018', offsetY: 4 })
  }
}
