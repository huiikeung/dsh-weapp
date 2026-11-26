/**
 * 输入条里的文件附件卡（与图片缩略图同款式）：
 *   [彩色扩展名徽标] 文件名
 *                    大小
 * 之前是「回形针 + 文件名」细胶囊，跟图片缩略图卡混排时高低不齐、观感也不统一。
 */
import { fileIo } from '@kit.CoreFileKit';
import { attachmentExtColor, attachmentExtLabel, attachmentSizeText } from './AttachmentVisual';

@Component
export struct FileAttachmentCard {
  @Prop name: string = '';
  @Prop uri: string = '';
  @Prop isDark: boolean = false;
  @State private sizeText: string = '';

  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private sub(): string {
    return this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.50)';
  }

  private tileBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)';
  }

  /** 副标题：类型 + 大小，对齐 dsh 桌面端（PDF 7.3MB） */
  private subtitleText(): string {
    const label: string = attachmentExtLabel(this.name);
    return this.sizeText.length > 0 ? label + ' ' + this.sizeText : label;
  }

  aboutToAppear(): void {
    try {
      const raw: string = this.uri.startsWith('file://') ? this.uri.substring(7) : this.uri;
      this.sizeText = attachmentSizeText(fileIo.statSync(raw).size);
    } catch (err) {
      this.sizeText = '';
    }
  }

  build() {
    Row({ space: 8 }) {
      // 扩展名徽标
      Stack({ alignContent: Alignment.Center }) {
        Text(attachmentExtLabel(this.name))
          .fontSize(attachmentExtLabel(this.name).length > 3 ? 8 : 11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .maxLines(1)
      }
      .width(34)
      .height(34)
      .borderRadius(8)
      .backgroundColor(attachmentExtColor(this.name))

      // 文件名 + 类型/大小（对齐 dsh 桌面端文件卡：PDF 7.3MB）
      Column({ space: 2 }) {
        Text(this.name)
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.ink())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 150 })
        Text(this.subtitleText())
          .fontSize(11)
          .fontColor(this.sub())
          .maxLines(1)
      }
      .alignItems(HorizontalAlign.Start)
    }
    .height(52)
    .padding({ left: 8, right: 10 })
    .borderRadius(12)
    .backgroundColor(this.tileBg())
    .alignItems(VerticalAlign.Center)
    .constraintSize({ maxWidth: 196 })
  }
}
