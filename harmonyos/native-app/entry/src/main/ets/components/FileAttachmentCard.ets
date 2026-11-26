/**
 * 输入条里的文件附件卡（与图片缩略图同款式）：
 *   [彩色扩展名徽标] 文件名
 *                    大小
 * 之前是「回形针 + 文件名」细胶囊，跟图片缩略图卡混排时高低不齐、观感也不统一。
 */
import { fileIo } from '@kit.CoreFileKit';

/** 扩展名 → 徽标底色（参考 GUI 附件卡的配色） */
const EXT_COLORS: Map<string, string> = new Map<string, string>([
  ['pdf', '#E5484D'],
  ['doc', '#2E6BE6'], ['docx', '#2E6BE6'], ['rtf', '#2E6BE6'],
  ['xls', '#1F9D55'], ['xlsx', '#1F9D55'], ['csv', '#1F9D55'],
  ['ppt', '#E8730C'], ['pptx', '#E8730C'],
  ['zip', '#8250DF'], ['rar', '#8250DF'], ['7z', '#8250DF'],
  ['md', '#6E7681'], ['txt', '#6E7681'], ['log', '#6E7681'],
  ['json', '#6E7681'], ['xml', '#6E7681'], ['yaml', '#6E7681'], ['yml', '#6E7681']
]);

@Component
export struct FileAttachmentCard {
  @Prop name: string = '';
  @Prop uri: string = '';
  @Prop isDark: boolean = false;
  @State private sizeText: string = '';

  private ext(): string {
    const dot: number = this.name.lastIndexOf('.');
    return dot >= 0 ? this.name.substring(dot + 1).toLowerCase() : '';
  }

  private badgeLabel(): string {
    const ext: string = this.ext();
    return ext.length > 0 ? ext.substring(0, 4).toUpperCase() : '文件';
  }

  private badgeColor(): string {
    const color: string | undefined = EXT_COLORS.get(this.ext());
    return color !== undefined ? color : '#6E7681';
  }

  private ink(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private sub(): string {
    return this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.50)';
  }

  private tileBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)';
  }

  aboutToAppear(): void {
    try {
      const raw: string = this.uri.startsWith('file://') ? this.uri.substring(7) : this.uri;
      const size: number = fileIo.statSync(raw).size;
      if (size < 1024) {
        this.sizeText = size + ' B';
      } else if (size < 1024 * 1024) {
        this.sizeText = Math.round(size / 1024) + ' KB';
      } else {
        this.sizeText = (size / (1024 * 1024)).toFixed(1) + ' MB';
      }
    } catch (err) {
      this.sizeText = '';
    }
  }

  build() {
    Row({ space: 8 }) {
      // 扩展名徽标
      Stack({ alignContent: Alignment.Center }) {
        Text(this.badgeLabel())
          .fontSize(this.badgeLabel().length > 3 ? 8 : 11)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .maxLines(1)
      }
      .width(34)
      .height(34)
      .borderRadius(8)
      .backgroundColor(this.badgeColor())

      // 文件名 + 大小
      Column({ space: 2 }) {
        Text(this.name)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.ink())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 118 })
        if (this.sizeText.length > 0) {
          Text(this.sizeText)
            .fontSize(10)
            .fontColor(this.sub())
        }
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
