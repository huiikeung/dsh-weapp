@Component
export struct HarnessAnimatedBackground {
  @Prop dark: boolean = false;
  build() {
    Column().width('100%').height('100%')
      .linearGradient({ angle: 165, colors: this.dark ? [['#07182B', 0], ['#0D2742', 0.6], ['#123A5E', 1]] : [['#EAF2F8', 0], ['#F7FAFC', 0.6], ['#FFFFFF', 1]] })
  }
}
