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
    Row({ space: 8 }) {
      Circle()
        .width(6)
        .height(6)
        .fill('#2E6BE6')
      Text(this.message)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
    }
    .width('92%')
    .constraintSize({ maxWidth: 520 })
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
    .borderRadius(16)
    .backgroundColor('rgba(28,32,40,0.92)')
    .backdropBlur(18)
    .shadow({ radius: 24, color: 'rgba(0,0,0,0.22)', offsetY: 8 })
    .opacity(this.shown ? 1 : 0)
    .translate({ y: this.offsetY })
    .animation({ duration: 180, curve: Curve.EaseOut })
    .margin({ top: (this.safeTop > 0 ? this.safeTop : 38.9) + 8 })
    .hitTestBehavior(HitTestMode.None)
  }
}
