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
  @StorageLink('isDark') isDark: boolean = false;
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
  onToggleStep: (id: string) => void = () => {};

  /** 步骤是否展开 */
  private stepOpen(id: string): boolean {
    return this.stepOpenIds.indexOf(id) >= 0;
  }

  // 注意：这里原本挂了一个 300ms 的 setInterval，每行都在跑，但它的输出（cellOpacity）
  // 已经没有任何地方使用。结果是每个可见行每秒被无意义地重渲染 3 次，页面空转占满 CPU。
  // 运行中图标的相位由 ProcLoaderView 自己的定时器驱动，这里不需要再定时。

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
  private processTitleColor(isError: boolean, running: boolean): string {
    if (running) {
      return this.isDark ? '#A8BEDB' : '#18365A';
    }
    if (isError) {
      return '#D4545B';
    }
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
        if (this.entry.imageCount > 0) {
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
      MarkdownBodyView({
        text: this.assistantBody(),
        fontSize: this.contentSize(),
        // 只有错误态覆盖成红色；正常正文由组件自己跟随实时主题
        textColor: this.entry.isError ? DANGER : ''
      })
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
          .fontColor(this.processTitleColor(isError, running))
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
    let lines: number = 1;
    for (let index = 0; index < text.length; index++) {
      if (text.charCodeAt(index) === 10) {
        lines += 1;
      }
    }
    const estimate: number = lines * 25.7;
    return estimate < 51 ? 51 : (estimate > 210 ? 210 : estimate);
  }

  /** 过程叙述：回合中段的助手文字，独立成行（对齐小程序 narration） */
  @Builder
  narrationBlock(item: ConversationItem) {
    Column() {
      MarkdownBodyView({
        text: item.text,
        fontSize: this.contentSize(),
        textColor: ''
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

      Row() {
        Text('完整内容')
          .fontSize(11)
          .fontColor(this.secondaryText())
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
          this.onToggleStep(item.id);
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
            .lineHeight(this.rpx(34))
            .fontColor(this.tertiaryText())
            .fontFamily('monospace')
          Text(ConversationFeed.toolFace(item.title, item.text).commandText)
            .fontSize(11)
            .lineHeight(this.rpx(34))
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
            .lineHeight(this.rpx(34))
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
    return item.id + '#' + item.text.length.toString() + '#' + (item.isError === true ? '1' : '0')
      + '#' + (open ? '1' : '0');
  }

  /**
   * 图标槽（对齐小程序 .command-icon-slot / .disclosed）：
   * 折叠时显示工具图标，展开时图标淡出、同一位置叠出向上箭头。
   */
  @Builder
  stepIconSlot(item: ConversationItem) {
    Stack({ alignContent: Alignment.Center }) {
      Image(this.stepIcon(item))
        .width(this.rpx(32))
        .height(this.rpx(32))
        .objectFit(ImageFit.Contain)
        .opacity(this.stepOpen(item.id) && this.expandableStep(item) ? 0 : 1)
      if (this.expandableStep(item)) {
        Image($r('app.media.chev_right_gray'))
          .width(this.rpx(24))
          .height(this.rpx(24))
          .objectFit(ImageFit.Contain)
          .rotate({ angle: this.stepOpen(item.id) ? -90 : 90 })
          .opacity(this.stepOpen(item.id) ? 0.65 : 0)
      }
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
    .flexShrink(0)
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
        Text(item.title.length > 0 ? item.title : '上下文')
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
            .lineHeight(this.rpx(36))
            .fontColor(this.tertiaryText())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
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
          } else if ((item.kind as string) === 'REASONING' && (this.stepOpen(item.id) || this.entry.running)) {
            // 展开的思考：直接铺阅读卡（对齐小程序 reasoning 展开态）
            this.reasoningCard(item)
          } else {
            this.stepNode(item)
          }
        }
        .width('100%')
      }, (item: ConversationItem, index: number) => this.stepKey(item))
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
        this.processBody(this.entry.items)
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
      .onAreaChange(() => {
        this.followTail();
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
