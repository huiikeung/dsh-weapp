/**
 * MarkdownBodyView —— 会话正文的轻量 Markdown 渲染。
 *
 * 解析由 native-core 的 MarkdownLite 完成（块 + 行内片段），这里只负责排版，
 * 排版口径对齐小程序 pages/session/utils/markdown.js + session.wxss 的 .md-* 规则：
 *   段落 / 标题（加粗并按 h1..h6 放大）/ 引用（次要色 + 左侧竖线）/
 *   列表 / 分隔线 / 表格 / 围栏代码块（横向滚动）。
 * 行内片段用 Span 渲染：**粗体** 加粗、行内代码等宽 + 底色圆角、链接主色下划线、斜体倾斜。
 */
import { Logger, MarkdownLite } from 'nativecore';
import type { MarkdownBlock, InlineSpan } from 'nativecore';

/** 流式 Markdown 的最小解析间隔：正文越长，单次解析越贵 */
const MARKDOWN_PARSE_INTERVAL_MS: number = 100;
/** 主色（链接） */
const ACCENT: string = '#2E6BE6';
/** 正文字体 / 等宽字体 */
const BODY_FONT: string = 'HarmonyOS Sans';
const MONO_FONT: string = 'monospace';

@Component
export struct MarkdownBodyView {
  @Prop @Watch('onTextChanged') text: string = '';
  /** 实时主题：直接订阅 AppStorage，避免所在行（LazyForEach 行）的 @Prop 没刷新时颜色不跟随 */
  @StorageProp('isDark') @Watch('onThemeChanged') isDark: boolean = false;
  /**
   * 主题换代号：ForEach 的 key 里带上它。
   * ArkUI 的 ForEach 在 key 不变时会直接复用旧节点、不重跑 item builder，
   * 而 Markdown 的颜色/底色是在 builder 里算的 —— 不带代次就会出现「切主题后正文颜色不变」。
   */
  @State themeGeneration: number = 0;
  /** 正文字号（助手 16 / 紧凑场景 13） */
  @Prop fontSize: number = 18.5;
  /** 正文色覆盖：只用于错误态（红色）；空串表示跟随主题 */
  @Prop textColor: string = '';

  @State private blocks: MarkdownBlock[] = [];
  private parseTimer: number = -1;
  private lastParseAt: number = 0;

  aboutToAppear(): void {
    this.parseNow();
  }

  onThemeChanged(): void {
    this.themeGeneration += 1;
  }

  aboutToDisappear(): void {
    if (this.parseTimer >= 0) {
      clearTimeout(this.parseTimer);
      this.parseTimer = -1;
    }
  }

  /**
   * 流式文本更新：重新解析，保证 Markdown 在生成过程中逐步成形。
   * 但解析是 O(正文长度)，长回答 + 高频 delta 会把 UI 线程吃满（页面点不动），
   * 这里压到最多 10 次/秒，并保留一次尾随解析。
   */
  private onTextChanged(): void {
    const elapsed: number = Date.now() - this.lastParseAt;
    if (elapsed >= MARKDOWN_PARSE_INTERVAL_MS) {
      this.parseNow();
      return;
    }
    if (this.parseTimer >= 0) {
      return;
    }
    this.parseTimer = setTimeout(() => {
      this.parseTimer = -1;
      this.parseNow();
    }, MARKDOWN_PARSE_INTERVAL_MS - elapsed);
  }

  private parseNow(): void {
    this.lastParseAt = Date.now();
    this.blocks = MarkdownLite.parse(this.text);
  }

  /** 正文色：调用方给了覆盖色（错误红）就用它，否则跟随实时主题 */
  private bodyColor(): string {
    if (this.textColor.length > 0) {
      return this.textColor;
    }
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  /** 小程序 --text-2：实色（低透明度在暗底上会糊） */
  private secondaryColor(): string {
    return this.isDark ? '#B9C2D0' : '#4A5160';
  }

  /** 小程序 --fill：代码块与行内代码底色 */
  private fillColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)';
  }

  /** 小程序 .md-quote 左边线：rgba(191,212,255,.45) */
  private quoteBorderColor(): string {
    return this.isDark ? 'rgba(191,212,255,0.45)' : 'rgba(16,19,24,0.16)';
  }

  /** 小程序 .md-hr / 表格边线：--border-strong */
  private strongBorderColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.16)' : 'rgba(16,19,24,0.12)';
  }

  /** 标题字号：对齐小程序 40/36/33/31rpx（正文 32rpx） */
  private headingSize(level: number): number {
    if (level === 1) {
      return this.fontSize * 1.25;
    }
    if (level === 2) {
      return this.fontSize * 1.125;
    }
    if (level === 3) {
      return this.fontSize * 1.031;
    }
    return this.fontSize * 0.969;
  }

  /** 列表正文 30rpx、引用 29rpx、表格 30rpx：按正文比例缩放 */
  private listSize(): number {
    return this.fontSize * 0.9375;
  }

  private quoteSize(): number {
    return this.fontSize * 0.906;
  }

  /** 单元格字号：小程序 .session .md-td 被覆盖成正文字号，这里保持一致 */
  private cellSize(): number {
    return this.fontSize;
  }

  /**
   * 行内片段渲染：一个 Span 对应一个片段。
   * 粗体加粗、行内代码等宽 + 底色圆角、链接主色下划线、斜体倾斜。
   */
  @Builder
  inline(spans: InlineSpan[], size: number, color: string, weight: FontWeight, lineHeight: number) {
    Text() {
      ForEach(spans, (span: InlineSpan, index: number) => {
        Span(span.text)
          .fontSize(span.style === 'code' ? size - 1 : size)
          .fontColor(span.style === 'link' ? ACCENT : color)
          .fontWeight(span.style === 'bold' ? FontWeight.Bold : weight)
          .fontStyle(span.style === 'italic' ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.style === 'code' ? MONO_FONT : BODY_FONT)
          .textBackgroundStyle(span.style === 'code'
            ? { color: this.fillColor(), radius: 6 }
            : { color: Color.Transparent, radius: 0 })
          .decoration(span.style === 'link'
            ? { type: TextDecorationType.Underline, color: ACCENT }
            : { type: TextDecorationType.None, color: Color.Transparent })
      }, (span: InlineSpan, index: number) => index.toString() + '_' + span.style + '_' + this.themeGeneration)
    }
    .width('100%')
    .fontSize(size)
    .fontColor(color)
    .fontWeight(weight)
    .fontFamily(BODY_FONT)
    .lineHeight(lineHeight)
  }

  /** 表格单元格：小程序对单元格也走行内 HTML，这里同样按行内片段渲染（宽度由外层 flex 决定） */
  @Builder
  cell(spans: InlineSpan[], header: boolean) {
    Text() {
      ForEach(spans, (span: InlineSpan, index: number) => {
        Span(span.text)
          .fontSize(span.style === 'code' ? this.cellSize() - 1 : this.cellSize())
          .fontColor(span.style === 'link' ? ACCENT : this.bodyColor())
          .fontWeight(header || span.style === 'bold' ? 600 : FontWeight.Normal)
          .fontStyle(span.style === 'italic' ? FontStyle.Italic : FontStyle.Normal)
          .fontFamily(span.style === 'code' ? MONO_FONT : BODY_FONT)
          .textBackgroundStyle(span.style === 'code'
            ? { color: this.fillColor(), radius: 4 }
            : { color: Color.Transparent, radius: 0 })
      }, (span: InlineSpan, index: number) => index.toString() + '_' + span.style + '_' + this.themeGeneration)
    }
    .fontSize(this.cellSize())
    .fontColor(this.bodyColor())
    .fontFamily(BODY_FONT)
    .lineHeight(this.cellSize() * 1.5)
    .width('100%')
  }

  /**
   * 表格一行：等分 flex 单元格 + 行底分隔线，对齐小程序 .md-tr / .md-td。
   * 小程序：padding 16rpx 20rpx、单元格 1rpx 左分隔、奇数数据行 var(--fill)、表头 600 + var(--fill)。
   */
  @Builder
  tableRow(cells: string[], header: boolean, rowIndex: number, last: boolean) {
    Row() {
      ForEach(cells, (cell: string, cellIndex: number) => {
        Column() {
          this.cell(MarkdownLite.inline(cell), header)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
        .padding({ left: 11, right: 11, top: 9, bottom: 9 })
        .border({ width: { left: cellIndex === 0 ? 0 : 0.5 }, color: this.strongBorderColor() })
      }, (cell: string, cellIndex: number) => 'td' + rowIndex.toString() + '-' + cellIndex.toString() + '_' + this.themeGeneration)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .backgroundColor(header || rowIndex % 2 === 1 ? this.fillColor() : Color.Transparent)
    .border({ width: { bottom: last ? 0 : 0.5 }, color: this.strongBorderColor() })
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
            .fontFamily(MONO_FONT)
            .fontColor(this.bodyColor())
            .lineHeight(17)
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
      .backgroundColor(this.fillColor())
      .border({ width: 0.5, color: this.strongBorderColor() })
      .margin({ top: 4, bottom: 8 })
    } else if (block.kind === 'divider') {
      Divider()
        .strokeWidth(0.5)
        .color(this.strongBorderColor())
        .margin({ top: 12, bottom: 12 })
    } else if (block.kind === 'heading') {
      Column() {
        this.inline(block.spans, this.headingSize(block.level), this.bodyColor(),
          FontWeight.Bold, this.headingSize(block.level) + 9)
      }
      .width('100%')
      .margin({ top: 8, bottom: 4 })
    } else if (block.kind === 'quote') {
      Row({ space: 8 }) {
        Divider().vertical(true).strokeWidth(2.5).color(this.quoteBorderColor())
        Column() {
          this.inline(block.spans, this.quoteSize(), this.secondaryColor(),
            FontWeight.Normal, this.quoteSize() + 9)
        }
        .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ top: 4, bottom: 6 })
    } else if (block.kind === 'list') {
      Row({ space: 6 }) {
        Text(block.index > 0 ? block.index.toString() + '.' : '•')
          .fontSize(this.listSize())
          .fontColor(this.secondaryColor())
          .width(18)
        Column() {
          this.inline(block.spans, this.listSize(), this.bodyColor(),
            FontWeight.Normal, this.listSize() + 9)
        }
        .layoutWeight(1)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .margin({ top: 2, bottom: 2 })
    } else if (block.kind === 'table') {
      // 小程序 .md-table: margin 20rpx 0 / 1rpx 描边 / 10rpx 圆角 / 表内分割线；
      // 宽度铺满容器，单元格 flex:1 等分，长内容在格内换行，不再用固定 120vp 窄列。
      Scroll() {
        Column() {
          this.tableRow(block.headers, true, -1, false)
          ForEach(block.rows, (row: string[], rowIndex: number) => {
            this.tableRow(row, false, rowIndex, rowIndex === block.rows.length - 1)
          }, (row: string[], rowIndex: number) => 'r' + rowIndex.toString() + '_' + this.themeGeneration)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .borderRadius(6)
        .border({ width: 0.5, color: this.strongBorderColor() })
        .clip(true)
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .margin({ top: 8, bottom: 10 })
    } else {
      Column() {
        this.inline(block.spans, this.fontSize, this.bodyColor(),
          FontWeight.Normal, this.fontSize + 11)
      }
      .width('100%')
      .margin({ top: 2, bottom: 6 })
    }
  }

  build() {
    Column({ space: 0 }) {
      ForEach(this.blocks, (block: MarkdownBlock, index: number) => {
        this.blockView(block)
      }, (block: MarkdownBlock, index: number) => index.toString() + block.kind + '_' + this.themeGeneration)
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }
}
