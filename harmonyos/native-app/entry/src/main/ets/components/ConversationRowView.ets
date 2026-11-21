/**
 * ConversationRowView —— 会话时间线单行（对齐微信小程序 pages/session 的渲染）。
 *
 * 小程序侧的关键形态（不是 iOS 风格）：
 *   USER       右侧气泡，无头像、无「你」标题
 *   ASSISTANT  左侧无气泡裸正文（Markdown），标题行只有流式标记
 *   PROCESS    一条 process-head 行：图标槽 + 活动标题 + 摘要 + 箭头，展开后按子项平铺
 *   TURN       回合收拢行「已完成」/「工具执行失败」，展开后逐组显示过程组
 *   STATUS/SYSTEM 单行小字
 */

import { display } from '@kit.ArkUI';
import { ConversationFeed, ConversationFeedEntryModel, ToolActivity } from 'nativecore';
import type { ConversationItem, ToolFace } from 'nativecore';
import { MarkdownBodyView } from './MarkdownBodyView';
import { ProcLoaderView } from './ProcLoaderView';

const OCEAN: string = '#2E6BE6';
const DANGER: string = '#D4545B';
const KIND_USER: string = 'USER';
const KIND_ASSISTANT: string = 'ASSISTANT';
const KIND_PROCESS: string = 'PROCESS';
const KIND_TURN: string = 'TURN';
const KIND_STATUS: string = 'STATUS';
const KIND_SYSTEM: string = 'SYSTEM';
const KIND_CHANGES: string = 'CHANGES';
const KIND_FILES: string = 'FILES';

@Component
export struct ConversationRowView {
  @ObjectLink entry: ConversationFeedEntryModel;
  /** 运行中四格加载动画相位 */

  /**
   * rpx → vp：小程序 750rpx 等于屏宽，这里按当前屏宽实时换算。
   * 图标尺寸必须走这一步——写死 18.77vp 只在 440vp 宽的屏上等于 32rpx，
   * 窄屏上就会比小程序明显偏大。
   */
  private rpx(value: number): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      return value * screenW / 750;
    } catch (err) {
      return value * 0.53;
    }
  }
  /** 运行中过程体：限高滚动条，跟随最新一步 */
  private processScroller: Scroller = new Scroller();
  /** 实时主题：LazyForEach 创建的行不会跟随父级 @Prop 刷新，直接订阅 AppStorage */
  @StorageLink('isDark') @Watch('onThemeChanged') isDark: boolean = false;
  /** 主题换代号：拼进 ForEach key，切主题时强制重建步骤节点（否则旧配色被复用） */
  @State themeGeneration: number = 0;
  /** 运行中思考卡固定高度；正文变长时只在卡内向上滚，页面高度不变（不抖） */
  private readonly RUNNING_CARD_HEIGHT: number = 210;
  /** 思考卡内部滚动控制器 */
  private reasonScroller: Scroller = new Scroller();
  private reasonFollowAt: number = 0;
  /** 会话正文/用户气泡字号档位（设置页「字号大小」，响应式） */
  @StorageProp('contentFontSize') contentFontSize: string = '标准';
  /** 执行图标动效样式（设置页「执行图标」，13 种） */
  /** 执行图标样式（由 ConversationPage 下传，保证 LazyForEach 行能重渲染） */
  @Prop procIconStyle: string = 'spin-ring';
  onToggle: (id: string) => void = () => {};
  onCopy: (text: string) => void = () => {};
  onShowDetail: (title: string, body: string) => void = () => {};
  /** 已展开的步骤行 id（会话页统一持有；用数组而不是 Map 传参——Map 传参会崩） */
  @Prop stepOpenIds: string[] = [];
  /** 用户手动折叠的思考卡（优先级高于「运行中自动展开」） */
  @Prop stepClosedIds: string[] = [];
  /** 点过「完整内容」的思考卡：整段展开显示全部内容 */
  @Prop reasonFullIds: string[] = [];
  onToggleReasonFull: (id: string) => void = (id: string) => {};
  /** 思考卡展开/折叠（底部两个按钮都走这个） */
  onToggleReasonCard: (id: string) => void = (id: string) => {};
  onToggleStep: (id: string) => void = () => {};
  /** 本条消息图片的本地路径（会话页预取后下传，顺序即展示顺序） */
  @Prop imagePaths: string[] = [];
  /** 过程步骤里的图片路径点击（如「读取图片 · /tmp/a.jpg」）→ 会话页下载并预览 */
  onImagePathTap: (path: string) => void = (path: string) => {};
  /**
   * 图片本地路径（会话页拉取后写入 AppStorage）。LazyForEach 的行不会因父级 @State 变化而重建，
   * 订阅 AppStorage 才能「图片下载完成后原行直接出图」，不必重进页面。编码：entryId + '\u0001' + 路径。
   */
  @StorageProp('imagePathEntries') imagePathEntries: string[] = [];
  /** 点击缩略图：会话页打开全屏预览 */
  onImageTap: (path: string) => void = () => {};
  /** 文件附件 chip（编码：kind\u0001name\u0001path\u0001attachmentId\u0001mediaType） */
  @Prop attachmentChips: string[] = [];
  /** 点击文件附件：会话页下载并预览 */
  onAttachmentTap: (name: string, path: string, mediaType: string) => void = () => {};
  /** 已编辑 / 交付文件卡片（编码：path\u0001name\u0001added\u0001deleted\u0001status） */
  @Prop fileCards: string[] = [];
  /** 点击文件卡片：会话页弹窗显示差异 / 内容 */
  onFileTap: (name: string, path: string, index: number, hasCounts: boolean) => void = () => {};
  /** 文件列表是否展开（超过 4 个时） */
  @State filesExpanded: boolean = false;

  /** 步骤是否展开 */
  private stepOpen(id: string): boolean {
    return this.stepOpenIds.indexOf(id) >= 0;
  }

  private stepClosed(id: string): boolean {
    return this.stepClosedIds.indexOf(id) >= 0;
  }

  private reasonFull(id: string): boolean {
    return this.reasonFullIds.indexOf(id) >= 0;
  }

  // 注意：这里原本挂了一个 300ms 的 setInterval，每行都在跑，但它的输出（cellOpacity）
  // 已经没有任何地方使用。结果是每个可见行每秒被无意义地重渲染 3 次，页面空转占满 CPU。
  // 运行中图标的相位由 ProcLoaderView 自己的定时器驱动，这里不需要再定时。

  /** 上次渲染看到的步骤数：用于判断「新增了一步」并让限高框滚到底 */
  private lastItemCount: number = 0;

  /** 运行中每来一步都贴到底部（对齐小程序 process body 跟随最新步骤） */
  private followTail(): void {
    if (!this.entry.running) {
      return;
    }
    setTimeout(() => {
      try {
        this.processScroller.scrollEdge(Edge.Bottom);
      } catch (err) {
      }
    }, 30);
  }

  aboutToDisappear(): void {
  }

  private primaryText(): string {
    return this.isDark ? '#F1F4FA' : '#10131A';
  }

  /** 小程序 --text-2：实色，不再用低透明度（暗底上会糊掉） */
  private secondaryText(): string {
    return this.isDark ? '#B9C2D0' : '#4A5160';
  }

  /** 小程序 --text-3：实色 */
  private tertiaryText(): string {
    return this.isDark ? '#8C97A8' : '#767E8C';
  }

  /** 小程序 --fill：命令卡等面背景 */
  private fillColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)';
  }

  /** 小程序 --fill-2：代码块背景 */
  private fill2Color(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.07)';
  }

  /** 小程序 --border */
  /** 分隔线颜色（改名避开 CustomComponent 基类的 borderColor 属性） */
  onThemeChanged(): void {
    this.themeGeneration += 1;
  }

  private ruleColor(): string {
    // 深色下 10% 白几乎看不见（尤其 0.5vp 发丝线），提到 24% 保证「运行中」嵌套竖线清晰
    return this.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(16,19,24,0.12)';
  }

  /** 上下文详情左侧 2vp 竖线：跟随主题，深色用偏冷灰避免糊在黑底上 */
  private contextRuleColor(): string {
    return this.isDark ? 'rgba(150,162,180,0.50)' : 'rgba(142,142,147,0.30)';
  }

  /** 小程序 .reasoning-card --reading-bg */
  private readingBgColor(): string {
    return this.isDark ? '#17191D' : '#F5F6F7';
  }

  /** 小程序 .process-title：failed=#D4545B，running=#18365A / 暗色 #A8BEDB */
  /**
   * 过程组标题颜色：默认用普通文字色；只有「点一下能展开」的组才用蓝色提示可点。
   * 之前运行中一律染蓝，导致过程中的普通文字看起来像链接。
   */
  private processTitleColor(isError: boolean, running: boolean, expandable: boolean): string {
    if (isError) {
      return '#D4545B';
    }
    // 过程文字统一用默认文字色（用户要求：不要用蓝色）
    return this.secondaryText();
  }

  private userBubbleFill(): string {
    return this.isDark ? '#173052' : '#E9EFFF';
  }

  private userBubbleEdge(): string {
    return this.isDark ? '#294B75' : '#D5E0FC';
  }

  /**
   * 过程活动图标：严格按 DSH 客户端 PROCESS_ICONS 映射。
   *   thinking→IconThink  read/readImage/webFetch→IconBrowse  search→IconSearch
   *   edit/write→IconEdit  commands→IconApi  code→IconCode  webSearch→IconGlobe
   *   subagents→IconAgentPreset  plan→IconPlan  questions→IconQuestion
   *   tools→IconSparkle  context→IconContextInjection
   */
  private procIcon(kind: string): Resource {
    const dark: boolean = this.isDark;
    if (kind === 'thinking') {
      return dark ? $r('app.media.proc_think_dark') : $r('app.media.proc_think');
    }
    if (kind === 'read' || kind === 'readImage' || kind === 'webFetch') {
      return dark ? $r('app.media.proc_read_dark') : $r('app.media.proc_read');
    }
    if (kind === 'search') {
      return dark ? $r('app.media.proc_search_dark') : $r('app.media.proc_search');
    }
    if (kind === 'edit' || kind === 'write') {
      return dark ? $r('app.media.proc_edit_dark') : $r('app.media.proc_edit');
    }
    if (kind === 'commands') {
      return dark ? $r('app.media.proc_api_dark') : $r('app.media.proc_api');
    }
    if (kind === 'code') {
      return dark ? $r('app.media.proc_code_dark') : $r('app.media.proc_code');
    }
    if (kind === 'webSearch') {
      return dark ? $r('app.media.proc_web_dark') : $r('app.media.proc_web');
    }
    if (kind === 'subagents') {
      return dark ? $r('app.media.proc_agent_dark') : $r('app.media.proc_agent');
    }
    if (kind === 'plan') {
      return dark ? $r('app.media.proc_plan_dark') : $r('app.media.proc_plan');
    }
    if (kind === 'questions') {
      return dark ? $r('app.media.proc_question_dark') : $r('app.media.proc_question');
    }
    if (kind === 'context') {
      return dark ? $r('app.media.proc_context_dark') : $r('app.media.proc_context');
    }
    return dark ? $r('app.media.proc_process_tool_dark') : $r('app.media.proc_process_tool');
  }

  /** 运行中加载图标：13 种样式统一由 ProcLoaderView 渲染 */
  @Builder
  procLoader() {
    ProcLoaderView({ style: this.procIconStyle, isDark: this.isDark })
  }

  /**
   * 会话正文字号（vp）：设置页「字号大小」四档 → 与小程序 appFontSize 一致。
   * 小程序正文默认 14px（--dsh-content-font-size），这里 1px≈1vp。
   */
  private contentSize(): number {
    const mode: string = this.contentFontSize;
    if (mode === '小') {
      return 13;
    }
    if (mode === '大') {
      return 16;
    }
    if (mode === '特大') {
      return 17;
    }
    return 14;
  }

  private assistantBody(): string {
    const value: string = this.entry.text;
    return value.length > 12000 ? value.substring(0, 12000) + '…' : value;
  }

  // ==================== 复制 ====================
  /**
   * 复制按钮（对齐小程序 .copy-btn / .copy-ic：52rpx 命中区 + 32rpx 图标，margin-top 10rpx）。
   * 用图标而不是文字，字号不再受正文字号影响。
   */
  @Builder
  copyButton(alignEnd: boolean) {
    Row() {
      Image($r('app.media.copy_gray'))
        .width(11)
        .height(11)
        .objectFit(ImageFit.Contain)
        .opacity(0.45)
    }
    .width(22)
    .height(22)
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
    .margin({ top: 4 })
    .onClick(() => {
      this.onCopy(this.entry.text);
    })
    .alignSelf(alignEnd ? ItemAlign.End : ItemAlign.Start)
  }

  /** 十六进制色 → 4x5 颜色矩阵（给 SVG 图标上色） */
  private tintMatrix(color: string): number[] {
    const hex: string = color.length === 7 ? color : '#101318';
    const red: number = parseInt(hex.substring(1, 3), 16) / 255;
    const green: number = parseInt(hex.substring(3, 5), 16) / 255;
    const blue: number = parseInt(hex.substring(5, 7), 16) / 255;
    return [
      0, 0, 0, 0, red,
      0, 0, 0, 0, green,
      0, 0, 0, 0, blue,
      0, 0, 0, 1, 0
    ];
  }

  // ==================== 已编辑 / 交付文件 ====================
  private filePart(chip: string, index: number): string {
    const parts: string[] = chip.split('\u0001');
    return index < parts.length ? parts[index] : '';
  }

  /** 单个文件 chip 的字段（编码：path\u0001name\u0001display\u0001added\u0001deleted\u0001hasCounts\u0001statusNote） */
  private fileAt(chip: string, index: number): string {
    const parts: string[] = chip.split('\u0001');
    return index < parts.length ? parts[index] : '';
  }

  /** 文件图标按扩展名分类（对齐小程序 file-deliverables.describe 的 icon） */
  private fileIcon(chip: string): Resource {
    const path: string = this.fileAt(chip, 0).length > 0 ? this.fileAt(chip, 0) : this.fileAt(chip, 2);
    const base: string = path.replace(/\\/g, '/').split('/').pop() ?? '';
    const dot: number = base.lastIndexOf('.');
    const ext: string = dot > 0 ? base.substring(dot + 1).toLowerCase() : '';
    if (/^(png|jpe?g|gif|webp|bmp)$/.test(ext)) {
      return $r('app.media.deliverable_image');
    }
    if (ext === 'pdf') {
      return $r('app.media.deliverable_pdf');
    }
    if (/^(docx?|md|markdown|txt)$/.test(ext)) {
      return $r('app.media.deliverable_document');
    }
    if (/^(xlsx?|csv)$/.test(ext)) {
      return $r('app.media.deliverable_table');
    }
    if (/^pptx?$/.test(ext)) {
      return $r('app.media.deliverable_slides');
    }
    if (/^(md|markdown|txt|html?|css|wxss|wxml|wxs|vue|svelte|scss|less|js|jsx|mjs|cjs|ts|tsx|json|jsonl|csv|log|ya?ml|xml|svg|py|sh|sql|swift|kt|java|c|h|cpp|rs|go|toml|ini)$/.test(ext)) {
      return $r('app.media.deliverable_code');
    }
    return $r('app.media.deliverable_file');
  }

  private surfaces(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private borderStrongColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.12)';
  }

  private dividerLineColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)';
  }

  private addedColor(): string {
    return this.isDark ? '#39C975' : '#138547';
  }

  private deletedColor(): string {
    return this.isDark ? '#FF6B70' : '#CE3439';
  }

  /** 卡片标题：单文件「已编辑 xxx.ets」，多文件「已编辑 N 个文件」（对齐小程序 decorateChanges） */
  private filesTitle(): string {
    if (this.fileCards.length === 1) {
      return '已编辑 ' + this.fileAt(this.fileCards[0], 1);
    }
    return '已编辑 ' + this.fileCards.length.toString() + ' 个文件';
  }

  private filesAdded(): number {
    let sum: number = 0;
    for (const chip of this.fileCards) {
      const value: number = Number(this.fileAt(chip, 3));
      if (!isNaN(value)) {
        sum += value;
      }
    }
    return sum;
  }

  private filesDeleted(): number {
    let sum: number = 0;
    for (const chip of this.fileCards) {
      const value: number = Number(this.fileAt(chip, 4));
      if (!isNaN(value)) {
        sum += value;
      }
    }
    return sum;
  }

  /**
   * 已编辑 / 交付文件卡片，逐项对齐小程序：
   * .file-card-wrap > .changed-files（1rpx 描边 / 24rpx 圆角 / var(--surface)）
   *   .changed-files-head（padding 20rpx / gap 18rpx / min-height 84rpx）
   *     .delivered-file-icon（64×68rpx / 16rpx 圆角 / 灰底 / 1rpx 描边 / 内部 40×46rpx）
   *     .delivered-file-name（28rpx / 500）+ .changed-counts（24rpx，+绿 −红）
   *   .changed-file-list（上边框）> .changed-file-row（min-height 88rpx / padding 14rpx 24rpx / gap 16rpx）
   *     .changed-file-icon（30×36rpx）+ 名称 26rpx + 路径 22rpx + 每行 +N −N
   *   超过 4 个显示「显示全部文件 (N)」。
   */
  @Builder
  filesCard() {
    if (this.fileCards.length > 0) {
      Column() {
        Column() {
          Row({ space: this.rpx(18) }) {
            Stack({ alignContent: Alignment.Center }) {
              Image(this.fileCards.length === 1 ? this.fileIcon(this.fileCards[0]) : $r('app.media.deliverable_code'))
                .width(this.rpx(40))
                .height(this.rpx(46))
                .objectFit(ImageFit.Contain)
            }
            .width(this.rpx(64))
            .height(this.rpx(68))
            .borderRadius(this.rpx(16))
            .backgroundColor('rgba(128,128,128,0.08)')
            .border({ width: 1, color: this.dividerLineColor() })

            Column({ space: this.rpx(6) }) {
              Text(this.filesTitle())
                .fontSize(this.rpx(28))
                .fontWeight(FontWeight.Medium)
                .fontColor(this.primaryText())
                .maxLines(2)
              if (this.fileCards.length === 1 && this.fileAt(this.fileCards[0], 6).length > 0) {
                Text(this.fileAt(this.fileCards[0], 6))
                  .fontSize(this.rpx(23))
                  .fontColor(this.secondaryText())
                  .maxLines(2)
              } else if (this.entry.kind === KIND_CHANGES) {
                Row({ space: this.rpx(14) }) {
                  Text('+' + this.filesAdded().toString())
                    .fontSize(this.rpx(24))
                    .fontColor(this.addedColor())
                  Text('−' + this.filesDeleted().toString())
                    .fontSize(this.rpx(24))
                    .fontColor(this.deletedColor())
                }
              } else {
                Text(this.fileAt(this.fileCards[0], 2))
                  .fontSize(this.rpx(23))
                  .fontColor(this.secondaryText())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .constraintSize({ minHeight: this.rpx(84) })
          .padding(this.rpx(20))
          .onClick(() => {
            this.onFileTap(this.fileAt(this.fileCards[0], 1), this.fileAt(this.fileCards[0], 0), 0,
              this.fileAt(this.fileCards[0], 5) === '1');
          })

          if (this.fileCards.length > 1) {
            Column() {
              ForEach(this.fileCards.slice(0, this.filesExpanded ? this.fileCards.length : 4),
                (chip: string, index: number) => {
                  Row({ space: this.rpx(16) }) {
                    Image(this.fileIcon(chip))
                      .width(this.rpx(30))
                      .height(this.rpx(36))
                      .objectFit(ImageFit.Contain)
                    Column({ space: this.rpx(4) }) {
                      Text(this.fileAt(chip, 1))
                        .fontSize(this.rpx(26))
                        .lineHeight(this.rpx(26) * 1.5)
                        .fontColor(this.primaryText())
                        .maxLines(2)
                      Text(this.fileAt(chip, 2))
                        .fontSize(this.rpx(22))
                        .fontColor(this.secondaryText())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                    .layoutWeight(1)
                    .alignItems(HorizontalAlign.Start)
                    if (this.fileAt(chip, 5) === '1') {
                      Row({ space: this.rpx(14) }) {
                        Text('+' + this.fileAt(chip, 3))
                          .fontSize(this.rpx(24))
                          .fontColor(this.addedColor())
                        Text('−' + this.fileAt(chip, 4))
                          .fontSize(this.rpx(24))
                          .fontColor(this.deletedColor())
                      }
                    }
                  }
                  .width('100%')
                  .constraintSize({ minHeight: this.rpx(88) })
                  .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(14), bottom: this.rpx(14) })
                  .onClick(() => {
                    this.onFileTap(this.fileAt(chip, 1), this.fileAt(chip, 0), index,
                      this.fileAt(chip, 5) === '1');
                  })
                }, (chip: string) => chip)
            }
            .width('100%')
            .border({ width: { top: 1 }, color: this.dividerLineColor() })
          }

          if (this.fileCards.length > 4) {
            Text(this.filesExpanded ? '收起' : '显示全部文件 (' + this.fileCards.length.toString() + ')')
              .fontSize(this.rpx(24))
              .fontColor(this.secondaryText())
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(this.rpx(16))
              .onClick(() => {
                this.filesExpanded = !this.filesExpanded;
              })
          }
        }
        .width('100%')
        .border({ width: 1, color: this.borderStrongColor() })
        .borderRadius(this.rpx(24))
        .backgroundColor(this.surfaces())
        .clip(true)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
  }

  // ==================== 文件附件 ====================
  /** 文件附件 chip 列表（对齐小程序 .message-attachment：胶囊 + 图标 + 文件名） */
  @Builder
  attachmentList(alignEnd: boolean) {
    if (this.attachmentChips.length > 0) {
      Column({ space: this.rpx(16) }) {
        ForEach(this.attachmentChips, (chip: string) => {
          Row({ space: this.rpx(14) }) {
            Image(chip.startsWith('directory')
              ? $r('app.media.deliverable_document')
              : (this.entry.kind === KIND_ASSISTANT ? $r('app.media.deliverable_code') : $r('app.media.deliverable_document')))
              .width(this.rpx(34))
              .height(this.rpx(34))
              .objectFit(ImageFit.Contain)
              .colorFilter(this.tintMatrix(this.primaryText()))
            Text(this.attachmentName(chip))
              .fontSize(this.rpx(26))
              .fontColor(this.primaryText())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: this.rpx(440) })
          }
          .constraintSize({ minHeight: this.rpx(72) })
          .padding({ left: this.rpx(30), right: this.rpx(30), top: this.rpx(12), bottom: this.rpx(12) })
          .borderRadius(this.rpx(999))
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)')
          .onClick(() => {
            this.onAttachmentTap(this.attachmentName(chip), this.attachmentPath(chip), this.attachmentMediaType(chip));
          })
        }, (chip: string) => chip)
      }
      .width('100%')
      .alignItems(alignEnd ? HorizontalAlign.End : HorizontalAlign.Start)
      .margin({ top: this.rpx(12) })
    }
  }

  private attachmentName(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    return parts.length > 1 ? parts[1] : chip;
  }

  private attachmentPath(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    return parts.length > 2 ? parts[2] : '';
  }

  private attachmentMediaType(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    return parts.length > 4 ? parts[4] : '';
  }

  // ==================== 图片附件 ====================
  /** 图片来源：本地路径补 file://，file:///datashare:// /http(s) 原样使用（相册 URI 本身带 scheme） */
  private imageSource(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')
      || path.startsWith('file://') || path.startsWith('datashare://')) {
      return path;
    }
    return 'file://' + path;
  }

  /** 本行图片：本地乐观图 + 已下载附件图（订阅 AppStorage，下载完自动出图） */
  private imageList(): string[] {
    const list: string[] = this.entry.localImages.slice();
    const prefix: string = this.entry.id + '\u0001';
    for (const item of this.imagePathEntries) {
      if (item.startsWith(prefix)) {
        list.push(item.substring(prefix.length));
      }
    }
    for (const extra of this.imagePaths) {
      if (list.indexOf(extra) < 0) {
        list.push(extra);
      }
    }
    return list;
  }

  /** 图片缩略图（单张按 4:3 大图，多张 96rpx 网格；对齐小程序 attach-grid / user-image-one） */
  @Builder
  imageGrid() {
    if (this.imageList().length === 1) {
      Image(this.imageSource(this.imageList()[0]))
        .width(this.rpx(560))
        .height(this.rpx(420))
        .objectFit(ImageFit.Cover)
        .borderRadius(this.rpx(20))
        .margin({ top: this.rpx(12) })
        .onClick(() => {
          this.onImageTap(this.imageList()[0]);
        })
    } else if (this.imageList().length > 1) {
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.imageList(), (path: string) => {
          Image(this.imageSource(path))
            .width(this.rpx(180))
            .height(this.rpx(180))
            .objectFit(ImageFit.Cover)
            .borderRadius(this.rpx(16))
            .margin({ right: this.rpx(10), top: this.rpx(10) })
            .onClick(() => {
              this.onImageTap(path);
            })
        }, (path: string) => path)
      }
      .margin({ top: this.rpx(2) })
    }
  }

  // ==================== USER ====================
  /** 用户消息（对齐小程序 .row-user / .row-user-bubble / .row-user-text） */
  @Builder
  userRow() {
    Column() {
      Column() {
        if (this.entry.text.length > 0) {
          // 用户消息字号与助手正文一致（不再额外放大）
          Text(this.entry.text)
            .fontSize(this.contentSize())
            .lineHeight(this.contentSize() * 1.45)
            .fontColor(this.primaryText())
        }
        this.imageGrid()
        this.attachmentList(true)
        // 图片还在下载（或下载失败）：给一个占位，避免气泡里什么都没有
        if (this.entry.imageCount > 0 && this.imageList().length === 0) {
          Row({ space: 4 }) {
            LoadingProgress().width(11).height(11).color(this.secondaryText())
            Text('图片 ' + this.entry.imageCount.toString() + ' 张加载中…')
              .fontSize(11.73)
              .fontColor(this.secondaryText())
          }
          .alignItems(VerticalAlign.Center)
          .margin({ top: 2.35 })
          Text('图片 × ' + this.entry.imageCount.toString())
            .fontSize(11.73)
            .fontColor(this.secondaryText())
            .margin({ top: 2.35 })
        }
      }
      .alignItems(HorizontalAlign.Start)
      // .row-user-bubble：圆角 30rpx、padding 20rpx 28rpx
      .padding({ left: 16.43, right: 16.43, top: 11.73, bottom: 11.73 })
      .borderRadius(17.6)
      .backgroundColor(this.userBubbleFill())
      .border({ width: 0.7, color: this.userBubbleEdge() })
      .constraintSize({ maxWidth: '100%' })

      if (this.entry.copyable) {
        this.copyButton(true)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.End)
    // .row-user：padding 24rpx 0 24rpx 68rpx
    .padding({ left: 39.9, top: 14.08, bottom: 14.08 })
  }

  // ==================== ASSISTANT ====================
  /** 助手回复（对齐小程序 .row-assistant + .turn-footer） */
  @Builder
  assistantRow() {
    Column() {
      if (this.entry.streaming) {
        Row({ space: 2.93 }) {
          LoadingProgress().width(5.87).height(5.87).color(OCEAN)
          // .row-streaming-title 30rpx 500 --text-2
          Text(this.entry.title)
            .fontSize(17.6)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.secondaryText())
        }
        .margin({ bottom: 8.21 })
      }
      if (this.entry.isError && this.entry.failureTitle.length > 0) {
        // 失败提示（对齐客户端 error 提示条：红色小字，位于正文上方）
        Text(this.entry.failureTitle)
          .fontSize(13)
          .lineHeight(18)
          .fontColor(DANGER)
          .width('100%')
          .margin({ bottom: 6 })
      }
      // 正文恢复 Markdown 渲染（用户要求：纯文本里 ** 看着别扭）。
      // MarkdownBodyView 内部有「解析丢字 > 20% 就退回整段纯文本」的安全网，
      // 所以样式和完整性可以兼顾。
      MarkdownBodyView({
        text: this.assistantBody(),
        fontSize: this.contentSize(),
        textColor: this.entry.isError ? DANGER : '',
        onImageTap: (src: string) => {
          this.onImageTap(src);
        }
      })
      this.imageGrid()
      this.attachmentList(false)
      if (this.entry.footerVisible) {
        // .turn-footer：gap 14rpx、padding 4rpx 0；左组 gap 10rpx
        Row() {
          Row({ space: 5.87 }) {
            Image($r('app.media.copy_gray'))
              .width(11)
              .height(11)
              .objectFit(ImageFit.Contain)
              .opacity(0.45)
              .padding(4)
              .onClick(() => {
                this.onCopy(this.entry.text);
              })
            if (this.entry.turnMetaText.length > 0) {
              // .turn-meta：高 44rpx、padding 0 14rpx、胶囊填充；文字 23rpx --text-2
              Text(this.entry.turnMetaText)
                .fontSize(11)
                .lineHeight(15)
                .fontColor(this.secondaryText())
                .maxLines(1)
                .constraintSize({ minHeight: 20 })
                .padding({ left: 6, right: 6 })
                .borderRadius(10)
                .backgroundColor(this.fillColor())
            }
          }
          .alignItems(VerticalAlign.Center)

          if (this.entry.turnTimeText.length > 0) {
            // .turn-time 23rpx --text-3
            Text(this.entry.turnTimeText)
              .fontSize(11)
              .lineHeight(15)
              .fontColor(this.tertiaryText())
              .maxLines(1)
          }
        }
        .width('100%')
        .padding({ top: 2.35, bottom: 2.35 })
        .alignItems(VerticalAlign.Center)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    // .row-assistant：padding 20rpx 0
    .padding({ top: 11.73, bottom: 11.73 })
  }

  // ==================== PROCESS / TURN 组头 ====================
  @Builder
  groupHead(title: string, summary: string, isError: boolean, expanded: boolean, expandable: boolean, running: boolean) {
    Column() {
      Row({ space: 7.04 }) {
        // 图标槽（对齐小程序 .command-icon-slot：32rpx；chevron 24rpx 叠放其中）。
        // 用 rpx() 实时换算：写死 18.77vp 只在 440vp 宽的屏上等于 32rpx，窄屏会明显偏大。
        // 折叠：活动图标；展开：图标淡出、换成向上 chevron；运行中：四格闪动；TURN：只有 chevron（.turn-process-slot）
        Stack({ alignContent: Alignment.Center }) {
          if (running) {
            this.procLoader()
          } else if (this.entry.kind === KIND_TURN) {
            if (expandable) {
              Image($r('app.media.chev_right_gray'))
                .width(this.rpx(24))
                .height(this.rpx(24))
                .objectFit(ImageFit.Contain)
                .rotate({ angle: expanded ? -90 : 90 })
                .opacity(0.65)
            }
          } else {
            Image(this.procIcon(this.entry.activityKind))
              .width(this.rpx(32))
              .height(this.rpx(32))
              .objectFit(ImageFit.Contain)
              .opacity(expanded && expandable ? 0 : 1)
            if (expandable) {
              Image($r('app.media.chev_right_gray'))
                .width(this.rpx(24))
                .height(this.rpx(24))
                .objectFit(ImageFit.Contain)
                .rotate({ angle: expanded ? -90 : 90 })
                .opacity(expanded ? 0.65 : 0)
            }
          }
        }
        .width(this.rpx(32))
        .height(this.rpx(32))

        // 组标题：14vp（比正文略小）；简洁档换行显示、不省略
        Text(title)
          .fontSize(14)
          .fontWeight(FontWeight.Normal)
          .fontColor(this.processTitleColor(isError, running, expandable))
          .maxLines(this.entry.titleWrap ? 3 : 1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: this.entry.titleWrap ? '100%' : '48%' })

        if (this.entry.liveDetail.length > 0) {
          // 运行中细节：标题后单独一段（对齐小程序 .process-live-detail 24rpx / --text-3）
          Text('· ' + this.entry.liveDetail)
            .fontSize(14.08)
            .fontColor(this.tertiaryText())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        } else if (summary.length > 0) {
          // 对齐小程序 .process-summary 22rpx / --text-3，无前缀点
          Text(summary)
            .fontSize(12.91)
            .lineHeight(19.37)
            .fontColor(this.tertiaryText())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        } else {
          Blank()
        }

      }
      .width('100%')
      .padding({ top: 3.52, bottom: 3.52 })
      .constraintSize({ minHeight: 29.33 })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
  }

  /** 单个步骤的图标：严格按客户端 VARIANT_ICONS（search/read/bash/write/edit/code/others）。 */
  private stepIcon(item: ConversationItem): Resource {
    const kind: string = item.kind as string;
    if (kind === 'REASONING') {
      return this.procIcon('thinking');
    }
    if (kind === 'CONTEXT') {
      return this.procIcon('context');
    }
    if (kind === 'STATUS') {
      return this.procIcon('commands');
    }
    if (kind === 'TOOL_RESULT') {
      return this.procIcon('tools');
    }
    const face: ToolFace = ConversationFeed.toolFace(item.title, item.text);
    if (face.isCommand) {
      return this.procIcon('commands');
    }
    return this.procIcon(ToolActivity.kind(item.title));
  }

  /** 步骤状态（对齐小程序 tool.statusText：失败 / 运行中 / 未返回结果，完成后不显示） */
  private stepStatus(item: ConversationItem): string {
    const status: string = item.status === undefined ? '' : item.status;
    if (item.isError === true || status === 'error') {
      return '失败';
    }
    if (status === 'running') {
      return this.entry.running ? '运行中' : '未返回结果';
    }
    return '';
  }

  /** 步骤是否可以点开（有参数、结果或详情） */
  private expandableStep(item: ConversationItem): boolean {
    const kind: string = item.kind as string;
    if (kind === 'STATUS') {
      return false;
    }
    if (kind === 'REASONING' || kind === 'CONTEXT') {
      return this.stepDetail(item).length > 0;
    }
    return this.argsText(item).length > 0 || this.resultText(item).length > 0 || this.stepDetail(item).length > 0;
  }

  /** 调用参数原文（对齐小程序 tool.argumentsText） */
  private argsText(item: ConversationItem): string {
    const explicit: string = item.argumentsText === undefined ? '' : item.argumentsText;
    if (explicit.length > 0) {
      return explicit;
    }
    const kind: string = item.kind as string;
    if (kind === 'TOOL' || kind === 'JSON_TOOL') {
      return item.text;
    }
    return '';
  }

  /** 工具结果原文（对齐小程序 tool.resultText） */
  private resultText(item: ConversationItem): string {
    return item.resultText === undefined ? '' : item.resultText;
  }

  /** 步骤详情正文（思考/上下文用；工具行改由参数与结果两段展示）。 */
  private stepDetail(item: ConversationItem): string {
    const text: string = item.text === undefined ? '' : item.text.trim();
    if (text.length > 0) {
      return text;
    }
    return ConversationFeed.toolFace(item.title, item.text).detail;
  }

  /** 步骤展开后的内容形态：0=普通工具详情 1=命令卡 2=思考阅读卡 */
  private stepShape(item: ConversationItem): number {
    const kind: string = item.kind as string;
    if (kind === 'REASONING') {
      return 2;
    }
    if (kind === 'TOOL' || kind === 'JSON_TOOL') {
      return ConversationFeed.toolFace(item.title, item.text).isCommand ? 1 : 0;
    }
    return 0;
  }

  /** 子步骤嵌套深度（对齐 .tool-node 每级 28rpx 缩进，最多 3 级） */
  private depthOf(item: ConversationItem): number {
    const depth: number = item.depth === undefined ? 0 : item.depth;
    if (depth <= 0) {
      return 0;
    }
    return depth > 3 ? 3 : depth;
  }

  /** 思考阅读卡高度：clamp(51, 210, 行数*25.7)（对齐小程序 readingHeight） */
  private readingHeight(text: string): number {
    // 只数换行是不够的：流式思考基本是一整段没有换行的长文本，
    // 结果算出 lines=1 → 高度只有 51（约一行），卡片里只看到开头几个字 + 滚动条，
    // 这就是「文本显示不全 / 每一行只显示一半」的根因。
    // 这里再按「折行」估算一遍：一行约 28 个字符（中英混排的保守值）。
    let newlineLines: number = 1;
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) {
        newlineLines += 1;
      }
    }
    const wrappedLines: number = Math.ceil(text.length / 28);
    const lines: number = Math.max(newlineLines, wrappedLines);
    const estimate: number = lines * 25.7;
    return estimate < 77 ? 77 : (estimate > 210 ? 210 : estimate);
  }

  /** 过程叙述：回合中段的助手文字，独立成行（对齐小程序 narration） */
  @Builder
  narrationBlock(item: ConversationItem) {
    Column() {
      MarkdownBodyView({
        text: item.text,
        fontSize: this.contentSize(),
        textColor: '',
        onImageTap: (src: string) => {
          this.onImageTap(src);
        }
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 0, top: 2.35, bottom: 9.39, right: 0 })
  }

  /**
   * 思考阅读卡（对齐小程序 .reasoning-card）：标题行 + 定高滚动正文 + 「完整内容 / 收起阅读」底栏。
   * 运行中直接展开（policy 把思考默认打开），收起后回到折叠标题行。
   */
  @Builder
  reasoningCard(item: ConversationItem) {
    Column() {
      Row() {
        Text('思考')
          .fontSize(11)
          .fontWeight(FontWeight.Normal)
          .fontColor(this.secondaryText())
        Blank()
      }
      .width('100%')
      .margin({ bottom: this.rpx(18) })

      if (this.reasonFull(item.id)) {
        // 「完整内容」：整段展开显示全部正文（不再定高滚动）
        Text(this.stepDetail(item))
          .fontSize(13)
          .lineHeight(this.rpx(48))
          .fontColor(this.secondaryText())
          .width('100%')
          .padding({ right: this.rpx(10) })
          .copyOption(CopyOptions.LocalDevice)
      } else {
        Scroll() {
          Text(this.stepDetail(item))
            .fontSize(13)
            .lineHeight(this.rpx(48))
            .fontColor(this.secondaryText())
            .width('100%')
            .padding({ right: this.rpx(10) })
            .copyOption(CopyOptions.LocalDevice)
        }
      .height(this.readingHeight(this.stepDetail(item)))
        .scrollBar(BarState.Auto)
        .width('100%')
        // 思考卡是「列表里的定高滚动区」：默认 SELF_FIRST 会把竖向滑动全吃掉，
        // 手指一落到卡片上整页就滑不动。改成父列表优先，滑到边了才轮到卡片内部。
        .nestedScroll({
          scrollForward: NestedScrollMode.PARENT_FIRST,
          scrollBackward: NestedScrollMode.PARENT_FIRST
        })
      }

      Row() {
        Text('完整内容')
          .fontSize(11)
          .fontColor(this.secondaryText())
          .onClick(() => {
            // 点「完整内容」：把卡片整段展开，显示全部内容
            this.onToggleReasonFull(item.id);
          })
        Blank()
        Row({ space: this.rpx(8) }) {
          Text('收起阅读')
            .fontSize(11)
            .fontColor(this.secondaryText())
          Image($r('app.media.chev_right_gray'))
            .width(this.rpx(20))
            .height(this.rpx(20))
            .objectFit(ImageFit.Contain)
            .rotate({ angle: -90 })
            .opacity(0.7)
        }
        .constraintSize({ minHeight: this.rpx(52) })
        .padding({ left: this.rpx(16) })
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
          // 点「收起阅读」：收成一行紧凑的「思考 + 预览」行（原样式），再点这一行展开回卡片
          this.onToggleReasonCard(item.id);
        })
      }
      .width('100%')
      .margin({ top: this.rpx(12) })
      .constraintSize({ minHeight: this.rpx(52) })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding({ left: this.rpx(28), right: this.rpx(28), top: this.rpx(20), bottom: this.rpx(12) })
    .borderRadius(this.rpx(20))
    .border({ width: 0.5, color: this.ruleColor() })
    .backgroundColor(this.readingBgColor())
    .margin({ top: this.rpx(14), bottom: this.rpx(18) })
    .clip(true)
  }

  /** 命令卡（对齐小程序 .command-card：状态点 + cwd + 复制 + $ 命令行 + 输出区） */
  @Builder
  commandCard(item: ConversationItem) {
    Column() {
      Row({ space: this.rpx(14) }) {
        Circle({ width: this.rpx(10), height: this.rpx(10) })
          .fill(item.isError === true ? '#DC555C' : (this.stepStatus(item) === '运行中' ? '#D59A31' : '#28B970'))
        Text(ConversationFeed.toolFace(item.title, item.text).cwdLabel.length > 0
          ? ConversationFeed.toolFace(item.title, item.text).cwdLabel
          : '命令')
          .fontSize(10)
          .fontColor(this.tertiaryText())
          .fontFamily('monospace')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Blank()
        Text('复制')
          .fontSize(12)
          .fontColor(this.secondaryText())
          .padding({ left: this.rpx(14), top: this.rpx(4), bottom: this.rpx(4) })
          .onClick(() => {
            this.onCopy(ConversationFeed.toolFace(item.title, item.text).commandText);
          })
      }
      .width('100%')
      .padding({ top: this.rpx(18), left: this.rpx(20), right: this.rpx(20), bottom: this.rpx(8) })
      .alignItems(VerticalAlign.Center)

      if (ConversationFeed.toolFace(item.title, item.text).commandText.length > 0) {
        Row({ space: this.rpx(14) }) {
          Text('$')
            .fontSize(11)
            .lineHeight(16)
            .fontColor(this.tertiaryText())
            .fontFamily('monospace')
          Text(ConversationFeed.toolFace(item.title, item.text).commandText)
            .fontSize(11)
            .lineHeight(16)
            .fontColor(this.primaryText())
            .fontFamily('monospace')
            .layoutWeight(1)
            .copyOption(CopyOptions.LocalDevice)
        }
        .width('100%')
        .padding({ top: this.rpx(4), left: this.rpx(20), right: this.rpx(20), bottom: this.rpx(20) })
        .alignItems(VerticalAlign.Top)
      } else {
        Text(item.isError === true ? '未记录命令内容' : '正在接收命令…')
          .fontSize(11)
          .fontColor(this.tertiaryText())
          .width('100%')
          .padding({ top: this.rpx(16), left: this.rpx(24), right: this.rpx(24), bottom: this.rpx(16) })
      }

      if (this.resultText(item).length > 0) {
        Scroll() {
          Text(this.resultText(item))
            .fontSize(11)
            .lineHeight(16)
            .fontColor(item.isError === true ? '#D4545B' : this.primaryText())
            .fontFamily('monospace')
            .width('100%')
            .copyOption(CopyOptions.LocalDevice)
        }
        .constraintSize({ maxHeight: this.rpx(440) })
        .scrollBar(BarState.Auto)
        .width('100%')
        // 同思考卡：工具结果再长也不能把整页的滑动锁死在这里
        .nestedScroll({
          scrollForward: NestedScrollMode.PARENT_FIRST,
          scrollBackward: NestedScrollMode.PARENT_FIRST
        })
        .padding({ top: this.rpx(20), bottom: this.rpx(20), left: this.rpx(44), right: this.rpx(44) })
        .border({ width: { top: 0.5 }, color: this.ruleColor() })
      } else if (this.stepStatus(item).length === 0) {
        Text('无输出')
          .fontSize(11)
          .fontColor(this.tertiaryText())
          .width('100%')
          .padding({ top: this.rpx(16), left: this.rpx(24), right: this.rpx(24), bottom: this.rpx(16) })
          .border({ width: { top: 0.5 }, color: this.ruleColor() })
      }
    }
    .width('100%')
    .borderRadius(this.rpx(22))
    .border({ width: 0.5, color: this.ruleColor() })
    .backgroundColor(this.fillColor())
    .margin({ bottom: this.rpx(16) })
    .clip(true)
  }

  /** 普通工具详情（对齐小程序 .tool-detail：左缩进 44rpx，「调用参数」+「结果」两段代码块） */
  @Builder
  toolDetail(item: ConversationItem) {
    Column() {
      if (this.argsText(item).length > 0) {
        Text('调用参数')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.secondaryText())
          .width('100%')
          .margin({ top: this.rpx(10), bottom: this.rpx(10) })
        Text(this.argsText(item))
          .fontSize(11)
          .lineHeight(this.rpx(34))
          .fontColor(this.primaryText())
          .fontFamily('monospace')
          .width('100%')
          .padding(this.rpx(20))
          .borderRadius(this.rpx(20))
          .backgroundColor(this.fill2Color())
          .copyOption(CopyOptions.LocalDevice)
      }
      if (this.resultText(item).length > 0) {
        Text(item.isError === true ? '错误' : '结果')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor(item.isError === true ? '#E5484D' : this.secondaryText())
          .width('100%')
          .margin({ top: this.rpx(10), bottom: this.rpx(10) })
        Text(this.resultText(item))
          .fontSize(11)
          .lineHeight(this.rpx(34))
          .fontColor(this.primaryText())
          .fontFamily('monospace')
          .width('100%')
          .padding(this.rpx(20))
          .borderRadius(this.rpx(20))
          .backgroundColor(this.fill2Color())
          .copyOption(CopyOptions.LocalDevice)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: this.rpx(44), bottom: this.rpx(12) })
  }

  /** 上下文详情（对齐小程序 .event-body：左侧 2rpx 竖线 + 缩进正文） */
  @Builder
  contextDetail(item: ConversationItem) {
    Column() {
      Text(this.stepDetail(item))
        .fontSize(this.contentSize())
        .lineHeight(this.contentSize() * 1.65)
        .fontColor(this.secondaryText())
        .width('100%')
        .copyOption(CopyOptions.LocalDevice)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ left: this.rpx(15) })
    .padding({ left: this.rpx(27), top: this.rpx(10), bottom: this.rpx(6) })
    .border({ width: { left: 2 }, color: this.contextRuleColor() })
  }

  @Builder
  stepDetailBody(item: ConversationItem) {
    if (this.stepShape(item) === 2) {
      this.reasoningCard(item)
    } else if (this.stepShape(item) === 1) {
      this.commandCard(item)
    } else if ((item.kind as string) === 'CONTEXT') {
      this.contextDetail(item)
    } else {
      this.toolDetail(item)
    }
  }

  /**
   * 步骤行的 key 必须带上内容指纹：
   * 投影层对同一步骤是原地替换（id 不变、text/status 变），
   * 只用 item.id 会让 ForEach 复用旧节点、运行中内容不刷新。
   */
  private stepKey(item: ConversationItem): string {
    const open: boolean = this.stepOpen(item.id);
    // 运行中的步骤会原地刷新三处内容，key 必须都带上，否则 ForEach 复用旧节点、界面停在首帧：
    //   status：running → done/error（转圈、完成标记）
    //   argumentsText：调用参数流式增长（命令逐字出现）
    //   resultText：结果/输出流式增长（运行中实时输出）
    const args: number = item.argumentsText === undefined ? 0 : item.argumentsText.length;
    const result: number = item.resultText === undefined ? 0 : item.resultText.length;
    const status: string = item.status === undefined ? '' : item.status;
    return item.id + '#' + item.text.length.toString() + '#' + status + '#'
      + args.toString() + '#' + result.toString() + '#' + (item.isError === true ? '1' : '0')
      + '#' + (open ? '1' : '0');
  }

  /**
   * 图标槽（对齐小程序 .command-icon-slot / .disclosed）：
   * 折叠时显示工具图标，展开时图标淡出、同一位置叠出向上箭头。
   */
  @Builder
  stepIconSlot(item: ConversationItem) {
    // 「已收起」的思考卡不算展开态：否则图标会显示成箭头，而用户要的是思考图标。
    Stack({ alignContent: Alignment.Center }) {
      Image(this.stepIcon(item))
        .width(this.rpx(32))
        .height(this.rpx(32))
        .objectFit(ImageFit.Contain)
        .opacity(this.stepOpen(item.id) && !this.stepClosed(item.id) && this.expandableStep(item) ? 0 : 1)
      if (this.expandableStep(item)) {
        Image($r('app.media.chev_right_gray'))
          .width(this.rpx(24))
          .height(this.rpx(24))
          .objectFit(ImageFit.Contain)
          .rotate({ angle: this.stepOpen(item.id) && !this.stepClosed(item.id) ? -90 : 90 })
          .opacity(this.stepOpen(item.id) && !this.stepClosed(item.id) ? 0.65 : 0)
      }
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
    .flexShrink(0)
  }

  /** 从工具步骤的细节/参数/结果里找出第一个图片文件路径（对齐小程序：图片路径可点开预览） */
  private stepImagePath(item: ConversationItem): string {
    const face: ToolFace = ConversationFeed.toolFace(item.title, item.text);
    const candidates: string[] = [face.detail, item.text,
      item.argumentsText === undefined ? '' : item.argumentsText,
      item.resultText === undefined ? '' : item.resultText];
    for (const text of candidates) {
      if (text.length === 0) {
        continue;
      }
      const tokens: string[] = text.split(/\s+/);
      for (const raw of tokens) {
        const token: string = raw.replace(/["'`]/g, '').replace(/[,;:)\]]+$/, '');
        if (token.indexOf('/') < 0) {
          continue;
        }
        const dot: number = token.lastIndexOf('.');
        if (dot < 0) {
          continue;
        }
        const ext: string = token.substring(dot + 1).toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].indexOf(ext) >= 0) {
          return token;
        }
      }
    }
    return '';
  }

  /** 步骤行（对齐 .disclosure-head.tool：gap 10rpx、padding 8rpx 0、min-height 56rpx） */
  @Builder
  stepHead(item: ConversationItem) {
    Row({ space: this.rpx(10) }) {
      this.stepIconSlot(item)
      if ((item.kind as string) === 'REASONING') {
        Text('思考')
          .fontSize(13.2)
          .fontColor(this.secondaryText())
          .flexShrink(0)
          .constraintSize({ maxWidth: '46%' })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.stepDetail(item).length > 0) {
          Text(ConversationFeed.preview(this.stepDetail(item), 72))
            .fontSize(13.2)
            .fontColor(this.secondaryText())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      } else if ((item.kind as string) === 'CONTEXT') {
        // 上下文注入行：标题「上下文注入 · <来源>」与注入内容预览必须同一行
        // （对齐小程序 .disclosure-head 的单行布局）。标题过长自己省略，预览吃满余宽。
        if (this.stepDetail(item).length > 0) {
          Text(item.title.length > 0 ? item.title : '上下文')
            .fontSize(13.2)
            .fontColor(this.secondaryText())
            .flexShrink(0)
            .constraintSize({ maxWidth: '70%' })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(ConversationFeed.preview(this.stepDetail(item), 72))
            .fontSize(12)
            .fontColor(this.tertiaryText())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        } else {
          Text(item.title.length > 0 ? item.title : '上下文')
            .fontSize(13.2)
            .fontColor(this.secondaryText())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      } else if ((item.kind as string) === 'STATUS') {
        Text(ConversationFeed.collapse(item.title + ' ' + item.text))
          .fontSize(13.2)
          .fontColor(item.isError === true ? DANGER : this.secondaryText())
          .layoutWeight(1)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      } else {
        Text(ConversationFeed.toolFace(item.title, item.text).label)
          .fontSize(13.2)
          .fontWeight(FontWeight.Normal)
          .fontColor(this.secondaryText())
          .flexShrink(0)
          .constraintSize({ maxWidth: '48%' })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.stepStatus(item).length > 0) {
          Text(this.stepStatus(item))
            .fontSize(10.6)
            .fontWeight(item.isError === true ? FontWeight.Bold : FontWeight.Normal)
            .fontColor(item.isError === true ? '#E5533C' : this.tertiaryText())
            .flexShrink(0)
            .maxLines(1)
        }
        if (ConversationFeed.toolFace(item.title, item.text).detail.length > 0) {
          Text('·')
            .fontSize(12.6)
            .fontColor(this.tertiaryText())
            .flexShrink(0)
          Text(ConversationFeed.toolFace(item.title, item.text).detail)
            .fontSize(11.5)
            .lineHeight(16.5)
            // 过程文字统一用默认色（用户明确要求：不要蓝色）。
            // 图片路径仍然可以点开预览，但不再靠颜色区分。
            .fontColor(this.tertiaryText())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .onClick(() => {
              const imagePath: string = this.stepImagePath(item);
              if (imagePath.length > 0) {
                this.onImagePathTap(imagePath);
              }
            })
        }
      }
    }
    .width('100%')
    .padding({ top: this.rpx(8), bottom: this.rpx(8) })
    .constraintSize({ minHeight: this.rpx(56) })
    .alignItems(VerticalAlign.Center)
  }

  /** 一级步骤节点：头行 +（展开时）详情 */
  @Builder
  stepNodeBase(item: ConversationItem) {
    Column() {
      Column() {
        this.stepHead(item)
      }
      .width('100%')
      .onClick(() => {
        if (this.expandableStep(item)) {
          this.onToggleStep(item.id);
        }
      })
      if (this.stepOpen(item.id)) {
        this.stepDetailBody(item)
      }
    }
    .width('100%')
  }

  /** 带竖线的步骤块：竖线画在块首，内容再右移 14rpx */
  @Builder
  stepRailed(item: ConversationItem) {
    Column() {
      this.stepNodeBase(item)
    }
    .width('100%')
    .border({ width: { left: 0.75 }, color: this.ruleColor() })
    .padding({ left: this.rpx(14) })
  }

  /**
   * 子步骤（run_code/PTC 派生）：竖线对齐上级步骤文字的左边——
   * 行首图标槽 32rpx + 图标与文字间距 10rpx = 42rpx，子行再往右 14rpx 起排；
   * 更深的层级按 28rpx 一档继续外扩，每档一条竖线（对齐 .tool-node / .tool-branch-track）。
   */
  @Builder
  stepNode(item: ConversationItem) {
    if (this.depthOf(item) >= 3) {
      Column() {
        this.stepNode2(item)
      }
      .width('100%')
      .padding({ left: this.rpx(42) })
    } else if (this.depthOf(item) === 2) {
      Column() {
        this.stepNode1(item)
      }
      .width('100%')
      .padding({ left: this.rpx(42) })
    } else if (this.depthOf(item) === 1) {
      Column() {
        this.stepRailed(item)
      }
      .width('100%')
      .padding({ left: this.rpx(42) })
    } else {
      this.stepNodeBase(item)
    }
  }

  @Builder
  stepNode1(item: ConversationItem) {
    Column() {
      this.stepRailed(item)
    }
    .width('100%')
    .padding({ left: this.rpx(28) })
    .border({ width: { left: 0.75 }, color: this.ruleColor() })
  }

  @Builder
  stepNode2(item: ConversationItem) {
    Column() {
      this.stepNode1(item)
    }
    .width('100%')
    .padding({ left: this.rpx(28) })
    .border({ width: { left: 0.75 }, color: this.ruleColor() })
  }

  @Builder
  processBody(items: ConversationItem[]) {
    Column() {
      ForEach(items, (item: ConversationItem, index: number) => {
        Column() {
          if ((item.kind as string) === 'ASSISTANT') {
            // 叙述行：没有正文时不占位（避免空灰条）
            if (item.text.trim().length > 0) {
              this.narrationBlock(item)
            }
          } else if ((item.kind as string) === 'TOOL_RESULT') {
            // 结果已并入工具行（对齐小程序：结果不单独占一行）
          } else if ((item.kind as string) === 'REASONING' && this.stepClosed(item.id)) {
            // 收起态：直接用标准步骤行头（stepHead）渲染，和运行中的过程行样式完全一致
            // （图标 + 「思考」+ 预览，间距/字号/缩进都同源，不自己写样式）。
            Column() {
              this.stepHead(item)
            }
            .width('100%')
            .onClick(() => {
              this.onToggleReasonCard(item.id);
            })
          } else if ((item.kind as string) === 'REASONING' && (this.stepOpen(item.id) || this.entry.running)) {
            // 有思考正文就用「思考阅读卡」（左上角带「思考」标题 + 完整内容/收起阅读底栏）。
            // 之前只有「展开状态或运行中」才用卡片，结算后思考会变成一行紧凑步骤，样式就变了。
            // 展开的思考：直接铺阅读卡（对齐小程序 reasoning 展开态）
            this.reasoningCard(item)
          } else {
            this.stepNode(item)
          }
        }
        .width('100%')
      }, (item: ConversationItem, index: number) => this.stepKey(item) + '#' + this.themeGeneration)
    }
    .width('100%')
    // 对齐小程序 .process-body { padding: 2rpx 0 6rpx }
    .padding({ top: this.rpx(2), bottom: this.rpx(6) })
  }

  // ==================== PROCESS ====================

  /**
   * 组体是否显示：完全由 ConversationFeed.applyWorkStepPolicy 决定
   * （对齐小程序 work-step-presentation.apply：processBodyVisible / processAutoOpen）。
   */
  private bodyVisible(): boolean {
    return this.entry.expandable && this.entry.processBodyVisible;
  }

  @Builder
  bodyBlock() {
    if (this.entry.processBodyCapped) {
      // 限高滚动（对齐小程序 .process-body-capped: min(400px, 50vh)）并跟随最新一步
      Scroll(this.processScroller) {
        // 内层 Column 的面积随步骤增长而变化：这里的 onAreaChange 才是「新增一步」的可靠信号
        // （Scroll 自身的 onAreaChange 只在视口尺寸变化时触发，内容变长不触发，所以运行中不跟手）。
        Column() {
          this.processBody(this.entry.items)
        }
        .width('100%')
        // 不再「内容一长就自动滚内层」：
        // 内层自动跟随 + 外层列表吸底两个滚动面同时改变位置，是页面持续抖动的来源。
        // 内层交给用户手动滑（滚到边界会接力滚整页）。
      }
      .constraintSize({ maxHeight: 400 })
      .scrollBar(BarState.Off)
      .width('100%')
      // 限高过程体（min(400px,50vh)）：对齐小程序 overflow-y:auto 的行为——
      // 手指落在框内时先滚框内内容，滚到边界再接力滚整页（SELF_FIRST 的链式滚动）。
      // 之前用 PARENT_FIRST 是「父列表先滚」，结果框内永远滚不动（已完成的过程点开也滑不了）。
      .nestedScroll({
        scrollForward: NestedScrollMode.SELF_FIRST,
        scrollBackward: NestedScrollMode.SELF_FIRST
      })
      // 运行中：容器内自动向上滚，跟随最新步骤（用户要求）。
      // 节流由 followTail 内部负责，避免每帧都改滚动位置造成抖动。
      .onAreaChange(() => {
        if (this.entry.running) {
          this.followTail();
        }
      })
    } else {
      // 完全展开档：不设上限，整段铺开
      this.processBody(this.entry.items)
    }
  }

  @Builder
  processRow() {
    Column() {
      // 运行中：组体在上、组头贴底（对齐 .process-block.running 的 order: body 0 / head 1）
      if (this.entry.running && this.bodyVisible()) {
        this.bodyBlock()
      }

      // 组标题：完全展开档不显示标题；简洁档运行中只留活动组标题
      if (!this.entry.headingHidden) {
        Column() {
          this.groupHead(this.entry.title, this.entry.summary, this.entry.isError,
            this.entry.expanded || this.entry.running, this.entry.expandable, this.entry.running)
        }
        .width('100%')
        .onClick(() => {
          if (this.entry.expandable) {
            this.onToggle(this.entry.id);
          }
        })
      }

      if (!this.entry.running && this.bodyVisible()) {
        this.bodyBlock()
      }

      // 失败卡（对齐小程序 turn-error-card）：只有回合真的失败（带失败文案）才显示，
      // 工具单步失败只在该步骤上标红，不升级成整组错误卡。
    }
    .width('100%')
    .padding({ top: 2, bottom: 2 })
  }

  // ==================== TURN（回合收拢行）====================
  @Builder
  turnRow() {
    Column() {
      Column() {
        this.groupHead(this.entry.title,
          this.entry.expanded && this.entry.expandedSummary.length > 0 ? this.entry.expandedSummary : this.entry.summary,
          this.entry.isError, this.entry.expanded, this.entry.expandable && this.entry.foldable, false)
      }
      .width('100%')
      .onClick(() => {
        if (this.entry.expandable && this.entry.foldable) {
          this.onToggle(this.entry.id);
        }
      })

      // 展开「已完成」时，组行由会话页摊平成同级行渲染（见 ConversationPage.rebuildEntries），
      // 这里不再嵌套子组件：嵌套 @ObjectLink 行在本机会崩。
    }
    .width('100%')
    .padding({ top: 2, bottom: 2 })
  }

  // ==================== STATUS / SYSTEM ====================
  @Builder
  statusRow() {
    Row({ space: 8 }) {
      Text(this.entry.isError ? '✕' : '·')
        .fontSize(11)
        .fontColor(this.entry.isError ? DANGER : this.tertiaryText())
      Text(ConversationFeed.collapse(this.entry.title + (this.entry.text.length > 0 ? ' · ' + this.entry.text : '')))
        .fontSize(12)
        .fontColor(this.entry.isError ? DANGER : this.tertiaryText())
        .layoutWeight(1)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding({ top: 3, bottom: 3 })
  }

  @Builder
  systemRow() {
    Column({ space: 2 }) {
      Text(this.entry.title)
        .fontSize(11)
        .fontColor(this.entry.isError ? DANGER : this.secondaryText())
      if (this.entry.text.length > 0) {
        Text(this.entry.text)
          .fontSize(11)
          .fontColor(this.tertiaryText())
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(8)
    .borderRadius(10)
    .backgroundColor(this.isDark ? 'rgba(46,107,230,0.14)' : 'rgba(46,107,230,0.06)')
  }

  build() {
    Column() {
      if (this.entry.kind === KIND_USER) {
        this.userRow()
      } else if (this.entry.kind === KIND_ASSISTANT) {
        this.assistantRow()
      } else if (this.entry.kind === KIND_TURN) {
        this.turnRow()
      } else if (this.entry.kind === KIND_PROCESS) {
        this.processRow()
      } else if (this.entry.kind === KIND_CHANGES || this.entry.kind === KIND_FILES) {
        this.filesCard()
      } else if (this.entry.kind === KIND_STATUS) {
        this.statusRow()
      } else {
        this.systemRow()
      }
    }
    .width('100%')
    .alignItems(this.entry.kind === KIND_USER ? HorizontalAlign.End : HorizontalAlign.Start)
  }
}
