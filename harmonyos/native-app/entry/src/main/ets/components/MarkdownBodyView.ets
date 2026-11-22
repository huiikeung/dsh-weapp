/**
 * MarkdownBodyView —— 会话正文的轻量 Markdown 渲染。
 *
 * 解析由 native-core 的 MarkdownLite 完成（块 + 行内片段），这里只负责排版，
 * 排版口径对齐小程序 pages/session/utils/markdown.js + session.wxss 的 .md-* 规则：
 *   段落 / 标题（加粗并按 h1..h6 放大）/ 引用（次要色 + 左侧竖线）/
 *   列表 / 分隔线 / 表格 / 围栏代码块（横向滚动）。
 * 行内片段用 Span 渲染：**粗体** 加粗、行内代码等宽 + 底色圆角、链接主色下划线、斜体倾斜。
 */
import { pasteboard } from '@kit.BasicServicesKit';
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
  /**
   * 点击正文里的图片（http(s)/file 地址），由会话页打开全屏预览。
   * 注意：API 23 起 @Prop 不能修饰函数类型，这里用普通成员，父组件构造时传入即可。
   */
  onImageTap: (src: string) => void = (src: string) => {};
  /**
   * 链接点击是否交给父级处理（会话页：文件路径 → 底部弹窗预览文件内容）。
   * ArkUI 里函数成员无法判断「是否被赋值」，所以用显式开关：不打开时保持原来的复制链接弹窗。
   */
  linkTapEnabled: boolean = false;
  /** 链接点击回调（对话正文里的蓝色下划线链接） */
  onLinkTap: (text: string, href: string) => void = (text: string, href: string) => {};
  /** 把 Markdown 图片地址解析成本机可渲染路径（宿主机路径由行组件按文件名匹配附件缓存；解析不到返回空串） */
  resolveImage: (src: string) => string = (src: string) => '';
  /** 附件缓存代次：缓存/下载进度变化时让内联图片重新解析并重绘（否则首帧解析不到就一直是空） */
  @Prop imageRevision: number = 0;

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
    // 安全网：解析结果如果明显丢字（各块文本拼起来远少于原文），
    // 直接退回「整段纯文本」渲染。自定义 Markdown 解析在某些混排（中文 + 行内代码 +
    // 全角标点）下会丢段，界面上就出现「每行只剩几个字、后半句没了」。
    // 统计「解析后仍然存在的字符」：表格内容在 rows / headers 里，不在 text/spans，
    // 之前漏算表格 → 含表格的回复会被误判成「丢字」，退回纯文本，界面上就出现 ** 符号。
    let parsedChars: number = 0;
    for (const block of this.blocks) {
      parsedChars += block.text === undefined ? 0 : block.text.length;
      for (const span of block.spans) {
        parsedChars += span.text.length;
      }
      for (const cell of block.headers) {
        parsedChars += cell.length;
      }
      for (const row of block.rows) {
        for (const cell of row) {
          parsedChars += cell.length;
        }
      }
    }
    const sourceChars: number = this.text.length;
    // 阈值放宽到 60%：Markdown 语法符号（**、#、- 等）本来就会少一些，
    // 只有真的丢了大段内容才退回纯文本。
    if (sourceChars > 40 && parsedChars < Math.floor(sourceChars * 0.6)) {
      const plain: MarkdownBlock = {
        kind: 'paragraph', level: 0, language: '', text: this.text, src: '',
        spans: MarkdownLite.inline(this.text), index: 0, headers: [], rows: []
      };
      this.blocks = [plain];
    }
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
   * 点击正文里的蓝色下划线链接：弹窗显示链接文字与完整地址，可一键复制。
   * 之前链接只有视觉样式（主色 + 下划线），点了没有任何反应。
   */
  private handleLink(text: string, href: string): void {
    if (this.linkTapEnabled) {
      this.onLinkTap(text, href);
      return;
    }
    this.openLinkDialog(text, href);
  }

  private openLinkDialog(text: string, href: string): void {
    const target: string = href.trim();
    const label: string = text.trim();
    if (target.length === 0 && label.length === 0) {
      return;
    }
    const title: string = target.length > 0 && label.length > 0 && label !== target ? label : '链接';
    const message: string = target.length > 0 ? target : label;
    try {
      this.getUIContext().getPromptAction().showDialog({
        title: title,
        message: message,
        buttons: [
          { text: '复制链接', color: ACCENT },
          { text: '关闭', color: this.secondaryColor() }
        ]
      }).then((result) => {
        if (result.index === 0) {
          this.copyLink(target.length > 0 ? target : label);
        }
      }).catch((err: Error) => {
      });
    } catch (err) {
    }
  }

  private copyLink(value: string): void {
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, value);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        this.toast('已复制链接');
      }).catch((err: Error) => {
        this.toast('复制失败');
      });
    } catch (err) {
      this.toast('复制失败');
    }
  }

  private toast(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2000 });
    } catch (err) {
    }
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
          // Span 只支持 onClick / onHover 两个通用事件：链接点击后弹窗看完整地址
          .onClick(() => {
            if (span.style === 'link') {
              this.handleLink(span.text, span.href);
            }
          })
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
          .onClick(() => {
            if (span.style === 'link') {
              this.handleLink(span.text, span.href);
            }
          })
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
    } else if (block.kind === 'image') {
      // 正文里的图片（![](url) 整行）：等比缩放，点击全屏预览。
      // 地址可能是 http(s)、也可能是宿主机本地路径 —— 统一交给 resolveImage 解析成
      // 本机可渲染路径（宿主机路径按文件名映射到工具结果的附件缓存），解析不到就不渲染。
      if (this.resolveImage(block.src).length > 0) {
        Image(this.resolveImage(block.src))
          .width('100%')
          .constraintSize({ maxHeight: 320, minHeight: 60 })
          .objectFit(ImageFit.Contain)
          .borderRadius(8)
          .backgroundColor(this.fillColor())
          .margin({ top: 4, bottom: 8 })
          .onClick(() => {
            this.onImageTap(this.resolveImage(block.src));
          })
      }
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
      // 引用块：左侧竖线用 border-left 画，高度跟随文字。
      // 之前用 Divider().vertical(true)：竖向 Divider 会撑满父容器高度，
      // 在列表里就变成贯穿整屏的长线（文字下面空一大截）。
      Column() {
        this.inline(block.spans, this.quoteSize(), this.secondaryColor(),
          FontWeight.Normal, this.quoteSize() + 9)
      }
      .width('100%')
      .padding({ left: 10 })
      .border({ width: { left: 2.5 }, color: this.quoteBorderColor() })
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
      }, (block: MarkdownBlock, index: number) => index.toString() + block.kind + '_' + this.themeGeneration
        + '_' + this.imageRevision.toString())
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }
}
