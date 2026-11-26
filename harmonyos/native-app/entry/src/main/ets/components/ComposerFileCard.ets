/**
 * 输入条里的文件附件卡（对齐 Web GUI 附件样式，尺寸比桌面端略收小）：
 *
 *   ┌──────────────────────────┐
 *   │ [PDF] 文件名…          (×) │
 *   │  图标  PDF 7.3MB           │
 *   └──────────────────────────┘
 *
 * 图标直接用 App 现成的文件类型图标（ficon_*.svg，Untitled UI 那套带页面折角的矢量图，
 * 和文件卡片/已编辑文件行同一批），不自己画。
 */
import { fileIo } from '@kit.CoreFileKit';
import { fileKindIcon, fileKindOf } from '../common/FileKind';
import { attachmentExtLabel, attachmentSizeText } from './AttachmentVisual';

@Component
export struct ComposerFileCard {
  @Prop name: string = '';
  @Prop uri: string = '';
  @Prop isDark: boolean = false;
  @State private sizeText: string = '';
  /** 点右上角 × 删除该附件 */
  onRemove: () => void = () => {};

  aboutToAppear(): void {
    this.sizeText = this.readSizeText();
  }

  private readSizeText(): string {
    try {
      const raw: string = this.uri.startsWith('file://') ? this.uri.substring(7) : this.uri;
      return attachmentSizeText(fileIo.statSync(raw).size);
    } catch (err) {
      // 文档选择器返回的 URI 不一定能直接 stat：拿不到大小就只显示类型
      return '';
    }
  }

  private subtitle(): string {
    const label: string = attachmentExtLabel(this.name);
    return this.sizeText.length > 0 ? label + ' ' + this.sizeText : label;
  }

  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private sub(): string {
    return this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.50)';
  }

  private cardBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.04)';
  }

  private cardEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.05)';
  }

  private closeBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.92)' : 'rgba(16,19,24,0.08)';
  }

  private closeInk(): string {
    return this.isDark ? '#101318' : 'rgba(16,19,24,0.65)';
  }

  build() {
    Stack({ alignContent: Alignment.TopEnd }) {
      Row({ space: 10 }) {
        // 48×48 的图标里纸页占 0.8 宽、满高：30 的框刚好得到 ~24×30 的纸页
        Image(fileKindIcon(fileKindOf(this.name)))
          .width(30)
          .height(30)
          .objectFit(ImageFit.Contain)
          .draggable(false)

        Column({ space: 2 }) {
          Text(this.name)
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.ink())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(this.subtitle())
            .fontSize(10)
            .fontColor(this.sub())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .height(58)
      .padding({ left: 12, right: 10 })
      .borderRadius(16)
      .backgroundColor(this.cardBg())
      .border({ width: 1, color: this.cardEdge() })
      .alignItems(VerticalAlign.Center)

      // 删除钮：白圆 + 深色 ×，贴在卡片右上角内侧（截图里的位置）
      Stack() {
        Text('×')
          .fontSize(11)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.closeInk())
      }
      .width(18)
      .height(18)
      .borderRadius(9)
      .backgroundColor(this.closeBg())
      .alignContent(Alignment.Center)
      .margin({ top: 6, right: 6 })
      .onClick(() => {
        this.onRemove();
      })
    }
    .width(240)
  }
}
