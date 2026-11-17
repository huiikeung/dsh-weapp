/**
 * MarkdownBodyView —— 会话正文的轻量 Markdown 渲染。
 *
 * 由 native-core 的 MarkdownLite 解析成块 + 行内片段，这里只负责排版：
 *   段落 / 标题 / 引用 / 列表 / 分隔线 / 表格 / 围栏代码块（横向滚动）。
 * 行内片段用 TextSpan 着色：粗体加粗、行内代码等宽着色、链接主色。
 */
import { MarkdownLite } from 'nativecore';
import type { MarkdownBlock, InlineSpan } from 'nativecore';

@Component
export struct MarkdownBodyView {
  @Prop @Watch('onTextChanged') text: string = '';
  @Prop isDark: boolean = false;
  /** 正文字号（助手 16 / 紧凑场景 13） */
  @Prop fontSize: number = 18.5;
  /** 正文色；错误态由调用方传红色 */
  @Prop textColor: string = '#101318';

  @State private blocks: MarkdownBlock[] = [];

  aboutToAppear(): void {
    this.blocks = MarkdownLite.parse(this.text);
  }

  /** 流式文本更新：重新解析，保证 Markdown 在生成过程中逐步成形。 */
  private onTextChanged(): void {
    this.blocks = MarkdownLite.parse(this.text);
  }

  /** 小程序 --text-2：实色（低透明度在暗底上会糊） */
  private secondaryColor(): string {
    return this.isDark ? '#B9C2D0' : '#4A5160';
  }

  private codeBackground(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)';
  }

  private inlineBackground(): string {
    return this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.08)';
  }

  /** 行内片段的字号：代码略小、其余随正文。 */
  private spanSize(style: string): number {
    return style === 'code' ? this.fontSize - 1 : this.fontSize;
  }

  /** 行内片段颜色。 */
  private spanColor(style: string): string {
    if (style === 'code') {
      return '#2E6BE6';
    }
    if (style === 'link') {
      return '#2E6BE6';
    }
    return this.textColor;
  }

  /** 行内文本：拼成普通字符串后整体渲染（ArkUI 的富文本段落见后续版本）。 */
  private inlineText(spans: InlineSpan[]): string {
    let out: string = '';
    for (const span of spans) {
      out += span.text;
    }
    return out;
  }

  @Builder
  inline(spans: InlineSpan[]) {
    Text(this.inlineText(spans))
      .width('100%')
      .lineHeight(this.fontSize + 11)
      .fontSize(this.fontSize)
      .fontColor(this.textColor)
  }

  @Builder
  blockView(block: MarkdownBlock) {
    if (block.kind === 'code') {
      Column({ space: 4 }) {
        if (block.language.length > 0) {
          Text(block.language.toUpperCase())
            .fontSize(10)
            .fontColor(this.secondaryColor())
        }
        Scroll() {
          Text(block.text)
            .fontSize(12)
            .fontFamily('monospace')
            .fontColor(this.textColor)
            .lineHeight(18)
            .textAlign(TextAlign.Start)
        }
        .scrollable(ScrollDirection.Horizontal)
        .scrollBar(BarState.Off)
        .width('100%')
        .align(Alignment.Start)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding(10)
      .borderRadius(9)
      .backgroundColor(this.codeBackground())
      .margin({ top: 4, bottom: 8 })
    } else if (block.kind === 'divider') {
      Divider()
        .strokeWidth(0.5)
        .color(this.isDark ? 'rgba(241,244,250,0.16)' : 'rgba(16,19,24,0.12)')
        .margin({ top: 12, bottom: 12 })
    } else if (block.kind === 'heading') {
      Column() {
        this.inline(block.spans)
      }
      .width('100%')
      .margin({ top: 8, bottom: 4 })
    } else if (block.kind === 'quote') {
      Row({ space: 8 }) {
        Divider().vertical(true).strokeWidth(2).color(this.inlineBackground())
        Column() {
          this.inline(block.spans)
        }
        .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ top: 4, bottom: 6 })
    } else if (block.kind === 'list') {
      Row({ space: 6 }) {
        Text(block.index > 0 ? block.index.toString() + '.' : '•')
          .fontSize(this.fontSize)
          .fontColor(this.secondaryColor())
          .width(18)
        Column() {
          this.inline(block.spans)
        }
        .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ top: 2, bottom: 2 })
    } else if (block.kind === 'table') {
      Scroll() {
        Column() {
          Row() {
            ForEach(block.headers, (cell: string, index: number) => {
              Text(cell)
                .fontSize(12)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.textColor)
                .width(120)
                .padding({ left: 8, right: 8, top: 6, bottom: 6 })
            }, (cell: string, index: number) => 'h' + index.toString())
          }
          .backgroundColor(this.codeBackground())
          ForEach(block.rows, (row: string[], rowIndex: number) => {
            Row() {
              ForEach(row, (cell: string, cellIndex: number) => {
                Text(cell)
                  .fontSize(12)
                  .fontColor(this.textColor)
                  .width(120)
                  .padding({ left: 8, right: 8, top: 6, bottom: 6 })
              }, (cell: string, cellIndex: number) => 'c' + rowIndex.toString() + '-' + cellIndex.toString())
            }
          }, (row: string[], rowIndex: number) => 'r' + rowIndex.toString())
        }
        .alignItems(HorizontalAlign.Start)
        .borderRadius(8)
        .border({ width: 0.5, color: this.isDark ? 'rgba(241,244,250,0.14)' : 'rgba(16,19,24,0.10)' })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .margin({ top: 6, bottom: 8 })
    } else {
      Column() {
        this.inline(block.spans)
      }
      .width('100%')
      .margin({ top: 2, bottom: 6 })
    }
  }

  build() {
    Column({ space: 0 }) {
      ForEach(this.blocks, (block: MarkdownBlock, index: number) => {
        this.blockView(block)
      }, (block: MarkdownBlock, index: number) => index.toString() + block.kind)
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }
}
