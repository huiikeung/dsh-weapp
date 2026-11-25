/**
 * 顶部浮窗提示：切换模式/权限/模型等确认信息统一从顶部滑入，替代底部系统 Toast。
 * 用法：TopToast.show('已切换权限为「仅可查看」')；页面根容器挂 .overlay(TopToastView(), { align: Alignment.Top })。
 */
export class TopToast {
  static show(message: string): void {
    if (message.length === 0) {
      return;
    }
    AppStorage.setOrCreate<string>('topToastMessage', message);
    const next: number = (AppStorage.get<number>('topToastNonce') ?? 0) + 1;
    AppStorage.setOrCreate<number>('topToastNonce', next);
  }
}

@Component
export struct TopToastView {
  @StorageLink('topToastMessage') message: string = '';
  @StorageLink('topToastNonce') @Watch('onNonce') nonce: number = 0;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('isDark') isDark: boolean = false;
  @State private shown: boolean = false;
  @State private offsetY: number = -10;
  private timer: number = -1;

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearTimeout(this.timer);
      this.timer = -1;
    }
  }

  onNonce(): void {
    if (this.message.length === 0) {
      return;
    }
    this.shown = true;
    this.offsetY = 0;
    if (this.timer >= 0) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.shown = false;
      this.offsetY = -10;
      this.timer = -1;
    }, 2200);
  }

  build() {
    // 与对话页 topToast 完全一致的卡片样式：徽标 + 玻璃底 + 细描边 + 居中
    Column() {
      Row({ space: 9 }) {
        Text('!')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .width(18)
          .height(18)
          .borderRadius(9)
          .textAlign(TextAlign.Center)
          .backgroundColor('#2E6BE6')
        Text(this.message)
          .fontSize(13)
          .lineHeight(19)
          .fontColor(this.isDark ? '#F1F4FA' : '#101318')
          .layoutWeight(1)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .constraintSize({ maxWidth: '92%' })
      .padding({ left: 14, right: 18, top: 12, bottom: 12 })
      .borderRadius(16)
      .backgroundColor(this.isDark ? 'rgba(32,34,40,0.96)' : 'rgba(255,255,255,0.97)')
      .border({
        width: 0.5,
        color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)'
      })
      .shadow({ radius: 18, color: this.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(16,19,24,0.16)', offsetY: 4 })
      .opacity(this.shown ? 1 : 0)
      .translate({ y: this.offsetY })
      .animation({ duration: 180, curve: Curve.EaseOut })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    // 下移到状态栏+标题栏下沿（对齐对话页 topSafe+68）：+8 时会压住页头/状态栏区域
    .padding({ left: 16, right: 16, top: (this.safeTop > 0 ? this.safeTop : 38.9) + 68 })
    .hitTestBehavior(HitTestMode.None)
  }
}
