/**
 * Bot 聊天图片：经网关分块接口拉取后缓存到本机，渲染时用 file:// 路径。
 * 未就绪时显示占位块；失败保持占位（不打断聊天）。
 */
import { BotImageCache } from 'nativecore';

@Component
export struct BotMessageImage {
  chatId: string = '';
  @Prop attachmentId: string = '';
  @Prop sessionId: string = '';
  @Prop mediaType: string = 'image/png';
  @Prop boxWidth: number = 148;
  @Prop boxHeight: number = 148;
  @StorageLink('isDark') isDark: boolean = false;
  @State path: string = '';
  /** 点按回调：把已就绪的本地路径交给页面（打开与工作模式一致的大图预览）。普通成员，不受 @Prop 函数限制。 */
  onOpen: (path: string) => void = () => {
  };

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    if (this.attachmentId.length === 0 || this.sessionId.length === 0) {
      return;
    }
    const key: string = this.sessionId + ':' + this.attachmentId;
    const cached: string = BotImageCache.get().cachedPath(key);
    if (cached.length > 0) {
      this.path = cached;
      return;
    }
    BotImageCache.get().load(key, this.chatId, this.sessionId, this.attachmentId, this.mediaType,
      (ready: string) => {
        this.path = ready;
      });
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.path.length > 0) {
        Image(this.path)
          .width(this.boxWidth)
          .height(this.boxHeight)
          .objectFit(ImageFit.Cover)
          .borderRadius(12)
      } else {
        Column({ space: 6 }) {
          Text('🖼')
            .fontSize(18)
            .opacity(0.5)
        }
        .width(this.boxWidth)
        .height(this.boxHeight)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)')
        .borderRadius(12)
      }
    }
    .width(this.boxWidth)
    .height(this.boxHeight)
    .onClick(() => {
      if (this.path.length > 0) {
        this.onOpen(this.path);
      }
    })
  }
}
