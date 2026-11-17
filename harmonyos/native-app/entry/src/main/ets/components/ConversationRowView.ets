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
  @State private loaderPhase: number = 0;
  /** 已展开的步骤 id（每一步都能点开看详情） */
  @State private expandedSteps: string[] = [];
  private loaderTimer: number = -1;
  /** 运行中过程体：限高滚动条，跟随最新一步 */
  private processScroller: Scroller = new Scroller();
  @Prop isDark: boolean = false;
  /** 会话正文/用户气泡字号档位（设置页「字号大小」，响应式） */
  @StorageProp('contentFontSize') contentFontSize: string = '标准';
  /** 执行图标动效样式（设置页「执行图标」，13 种） */
  /** 执行图标样式（由 ConversationPage 下传，保证 LazyForEach 行能重渲染） */
  @Prop procIconStyle: string = 'spin-ring';
  onToggle: (id: string) => void = () => {};
  onCopy: (text: string) => void = () => {};
  onShowDetail: (title: string, body: string) => void = () => {};

  aboutToAppear(): void {
    this.loaderTimer = setInterval(() => {
      this.loaderPhase = (this.loaderPhase + 1) % 4;
    }, 300);
  }

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
    if (this.loaderTimer >= 0) {
      clearInterval(this.loaderTimer);
      this.loaderTimer = -1;
    }
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
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.10)';
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

  private cellOpacity(index: number): number {
    return this.loaderPhase === index ? 1 : 0.22;
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
        isDark: this.isDark,
        fontSize: this.contentSize(),
        textColor: this.entry.isError ? DANGER : this.primaryText()
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
        // 图标槽（对齐小程序 .command-icon-slot：32rpx=18.77vp；chevron 24rpx=14.08vp 叠放其中）
        // 折叠：活动图标；展开：图标淡出、换成向上 chevron；运行中：四格闪动；TURN：只有 chevron（.turn-process-slot）
        Stack({ alignContent: Alignment.Center }) {
          if (running) {
            this.procLoader()
          } else if (this.entry.kind === KIND_TURN) {
            if (expandable) {
              Image($r('app.media.chev_right_gray'))
                .width(14.08)
                .height(14.08)
                .objectFit(ImageFit.Contain)
                .rotate({ angle: expanded ? -90 : 90 })
                .opacity(0.65)
            }
          } else {
            Image(this.procIcon(this.entry.activityKind))
              .width(18.77)
              .height(18.77)
              .objectFit(ImageFit.Contain)
              .opacity(expanded && expandable ? 0 : 1)
            if (expandable) {
              Image($r('app.media.chev_right_gray'))
                .width(14.08)
                .height(14.08)
                .objectFit(ImageFit.Contain)
                .rotate({ angle: expanded ? -90 : 90 })
                .opacity(expanded ? 0.65 : 0)
            }
          }
        }
        .width(18.77)
        .height(18.77)

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

  /** 单个步骤的状态文案（对齐小程序 tool.statusText）。 */
  private stepStatus(item: ConversationItem): string {
    const kind: string = item.kind as string;
    if (kind === 'TOOL_RESULT') {
      if (item.isError === true) {
        return '失败';
      }
      // 运行中还谈不上「完成」：进行中不显示完成态
      return this.entry.running ? '' : '完成';
    }
    return '';
  }

  /** 步骤详情正文（点开后显示的完整内容）。 */
  private stepDetail(item: ConversationItem): string {
    const text: string = item.text === undefined ? '' : item.text.trim();
    if (text.length > 0) {
      return text;
    }
    return ConversationFeed.toolFace(item.title, item.text).detail;
  }

  /** 步骤展开后的内容形态：0=普通文本 1=命令卡 2=思考阅读卡 */
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
        isDark: this.isDark,
        fontSize: this.contentSize(),
        textColor: this.primaryText()
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ left: 0, top: 2.35, bottom: 9.39, right: 0 })
  }

  /**
   * 思考卡片（运行中直接展示、不显示上面的步骤标题行）。
   * 结束后该步骤只保留折叠标题，不再渲染卡片。
   */
  @Builder
  thinkingCard(item: ConversationItem) {
    Column() {
      Row() {
        Text('思考')
          .fontSize(12)
          .fontWeight(FontWeight.Normal)
          .fontColor(this.secondaryText())
        Blank()
      }
      .width('100%')
      .margin({ bottom: 10.57 })

      Scroll() {
        Text(this.stepDetail(item))
          .fontSize(13.2)
          .lineHeight(24)
          .fontColor(this.secondaryText())
          .width('100%')
          .padding({ right: 5.87 })
          .copyOption(CopyOptions.LocalDevice)
      }
      .height(this.readingHeight(this.stepDetail(item)))
      .scrollBar(BarState.Auto)
      .width('100%')
    }
    .width('100%')
    .padding({ left: 16.43, right: 16.43, top: 11.73, bottom: 11.73 })
    .borderRadius(11.73)
    .border({ width: 0.5, color: this.ruleColor() })
    .backgroundColor(this.readingBgColor())
    .margin({ top: 5.87, bottom: 7.04 })
    .clip(true)
  }

  @Builder
  expandedBody(item: ConversationItem) {
    if (this.stepShape(item) === 2) {
      // 已结束的思考：点开后就是纯文本，不再套阅读卡外壳；内容为空则不渲染
      if (this.stepDetail(item).length === 0) {
        Column()
      } else {
      Column() {
        Text(this.stepDetail(item))
          .fontSize(13.2)
          .lineHeight(24)
          .fontColor(this.secondaryText())
          .width('100%')
          .copyOption(CopyOptions.LocalDevice)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 18.77, top: 4.69, bottom: 7.04 })
      }
    } else if (this.stepShape(item) === 1) {
      // 命令卡（对齐小程序 .command-card / .command-card-head / .command-code-lines / .command-output）
      Column() {
        Row({ space: 8.21 }) {
          Circle({ width: 5.87, height: 5.87 })
            .fill(item.isError === true ? '#DC555C' : '#28B970')
          Text(ConversationFeed.toolFace(item.title, item.text).cwdLabel.length > 0
            ? ConversationFeed.toolFace(item.title, item.text).cwdLabel
            : '命令')
            .fontSize(11.73)
            .fontColor(this.tertiaryText())
            .fontFamily('monospace')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Blank()
          Text('复制')
            .fontSize(14.08)
            .fontColor(this.secondaryText())
            .padding({ left: 8.21, top: 2.35, bottom: 2.35 })
            .onClick(() => {
              this.onCopy(ConversationFeed.toolFace(item.title, item.text).commandText);
            })
        }
        .width('100%')
        .padding({ top: 10.56, left: 11.73, right: 11.73, bottom: 4.69 })
        .alignItems(VerticalAlign.Center)

        if (ConversationFeed.toolFace(item.title, item.text).commandText.length > 0) {
          Row({ space: 8.21 }) {
            Text('$')
              .fontSize(12.91)
              .lineHeight(20.66)
              .fontColor(this.tertiaryText())
              .fontFamily('monospace')
            Text(ConversationFeed.toolFace(item.title, item.text).commandText)
              .fontSize(12.91)
              .lineHeight(20.66)
              .fontColor(this.primaryText())
              .fontFamily('monospace')
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .copyOption(CopyOptions.LocalDevice)
          }
          .width('100%')
          .padding({ top: 2.35, left: 11.73, right: 11.73, bottom: 11.73 })
          .alignItems(VerticalAlign.Center)
        } else {
          Text(item.isError === true ? '未记录命令内容' : '正在接收命令…')
            .fontSize(12.91)
            .fontColor(this.tertiaryText())
            .width('100%')
            .padding({ top: 9.39, left: 14.08, right: 14.08, bottom: 9.39 })
        }

        if (this.stepDetail(item).length > 0) {
          Scroll() {
            Text(this.stepDetail(item))
              .fontSize(12.91)
              .lineHeight(20.66)
              .fontColor(item.isError === true ? '#D4545B' : this.primaryText())
              .fontFamily('monospace')
              .width('100%')
              .copyOption(CopyOptions.LocalDevice)
          }
          .constraintSize({ maxHeight: 258.13 })
          .scrollBar(BarState.Auto)
          .width('100%')
          .padding({ top: 11.73, bottom: 11.73, left: 25.81, right: 25.81 })
          .border({ width: { top: 0.5 }, color: this.ruleColor() })
        } else {
          Text('无输出')
            .fontSize(12.91)
            .fontColor(this.tertiaryText())
            .width('100%')
            .padding({ top: 9.39, left: 14.08, right: 14.08, bottom: 9.39 })
            .border({ width: { top: 0.5 }, color: this.ruleColor() })
        }
      }
      .width('100%')
      .borderRadius(12.91)
      .border({ width: 0.5, color: this.ruleColor() })
      .backgroundColor(this.fillColor())
      .margin({ bottom: 9.39 })
      .clip(true)
    } else {
      // 普通工具详情（对齐小程序 .tool-detail：左缩进 44rpx；.tool-detail-section / .tool-detail-code）
      Column() {
        if (this.stepDetail(item).length > 0) {
          Text('结果')
            .fontSize(14.08)
            .fontWeight(FontWeight.Medium)
            .fontColor(item.isError === true ? '#E5484D' : this.secondaryText())
            .width('100%')
            .margin({ top: 5.87, bottom: 5.87 })
          Text(this.stepDetail(item))
            .fontSize(14.08)
            .lineHeight(21.12)
            .fontColor(this.primaryText())
            .fontFamily('monospace')
            .width('100%')
            .padding(11.73)
            .borderRadius(11.73)
            .backgroundColor(this.fill2Color())
            .copyOption(CopyOptions.LocalDevice)
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 18.77, bottom: 7.04 })
    }
  }

  /**
   * 步骤行的 key 必须带上内容指纹：
   * 投影层对同一步骤是原地替换（id 不变、text/status 变），
   * 只用 item.id 会让 ForEach 复用旧节点、运行中内容不刷新。
   */
  /** 运行中的思考步骤：直接显示卡片（结束后只留折叠标题）；内容为空时回落到步骤行，避免空框 */
  private showThinkingCard(item: ConversationItem): boolean {
    if (!this.entry.running || (item.kind as string) !== 'REASONING') {
      return false;
    }
    return this.stepDetail(item).length > 0;
  }

  private stepKey(item: ConversationItem): string {
    const expanded: boolean = this.expandedSteps.indexOf(item.id) >= 0;
    return item.id + '#' + item.text.length.toString() + '#' + (item.isError === true ? '1' : '0')
      + '#' + (expanded ? '1' : '0');
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
          } else if (this.showThinkingCard(item)) {
            // 运行中的思考：直接铺卡片，不再显示上面的「思考 + 预览」标题行
            this.thinkingCard(item)
          } else if ((item.kind as string) === 'TOOL_RESULT') {
            // 工具结果行整行不显示（对齐小程序：结果并入工具行，不单独占一行）
          } else {
          // 步骤行（对齐小程序 .disclosure-head.tool）：gap 10rpx、padding 8rpx 0、min-height 56rpx
          Row({ space: 5.87 }) {
            Image(this.stepIcon(item))
              .width(18.77)
              .height(18.77)
              .objectFit(ImageFit.Contain)
              .flexShrink(0)
            if ((item.kind as string) === 'ASSISTANT') {
              this.narrationBlock(item)
            } else if (item.kind === 'REASONING') {
              // .event-title 26rpx / --text-2，max-width 46%
              Text('思考')
                .fontSize(13.2)
                .fontColor(this.secondaryText())
                .flexShrink(0)
                .constraintSize({ maxWidth: '46%' })
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(ConversationFeed.preview(item.text, 72))
                .fontSize(13.2)
                .fontColor(this.secondaryText())
                .layoutWeight(1)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            } else if (item.kind === 'CONTEXT') {
              Text(item.title.length > 0 ? item.title : '上下文')
                .fontSize(13.2)
                .fontColor(this.secondaryText())
                .flexShrink(0)
                .constraintSize({ maxWidth: '46%' })
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              Text(ConversationFeed.preview(item.text, 72))
                .fontSize(13.2)
                .fontColor(this.secondaryText())
                .layoutWeight(1)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            } else if (item.kind === 'STATUS') {
              Text(ConversationFeed.collapse(item.title + ' ' + item.text))
                .fontSize(13.2)
                .fontColor(item.isError === true ? DANGER : this.secondaryText())
                .layoutWeight(1)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            } else if (item.kind === 'TOOL_RESULT') {
              // .tool-status 20rpx / --text-3；.tool-status.err #E5533C 600
              Text(this.stepStatus(item))
                .fontSize(10.6)
                .fontWeight(item.isError === true ? FontWeight.Bold : FontWeight.Normal)
                .fontColor(item.isError === true ? '#E5533C' : this.tertiaryText())
                .flexShrink(0)
                .maxLines(1)
              Text(ConversationFeed.preview(item.text, 72))
                .fontSize(12)
                .fontColor(this.tertiaryText())
                .layoutWeight(1)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            } else {
              // .tool-act 26rpx 400 / --text-2，max-width 48%
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
                // .tool-separator 24rpx / --text-3
                Text('·')
                  .fontSize(12.6)
                  .fontColor(this.tertiaryText())
                  .flexShrink(0)
                // .tool-note 23rpx / --text-3
                Text(ConversationFeed.toolFace(item.title, item.text).detail)
                  .fontSize(12)
                  .lineHeight(18.6)
                  .fontColor(this.tertiaryText())
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
            }
            // .command-chevron 24rpx：折叠 90°、展开 -90°，opacity 0 → .65
            Image($r('app.media.chev_right_gray'))
              .width(14.08)
              .height(14.08)
              .objectFit(ImageFit.Contain)
              .opacity(this.expandedSteps.indexOf(item.id) >= 0 ? 0.65 : 0)
              .rotate({ angle: this.expandedSteps.indexOf(item.id) >= 0 ? -90 : 90 })
              .flexShrink(0)
          }
          .width('100%')
          // 对齐小程序 .disclosure-head.tool：只有竖向 padding，没有左缩进
          .padding({ top: 4.69, bottom: 4.69 })
          .constraintSize({ minHeight: 32.86 })
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            const at: number = this.expandedSteps.indexOf(item.id);
            if (at >= 0) {
              this.expandedSteps.splice(at, 1);
            } else {
              this.expandedSteps.push(item.id);
            }
          })

          if (this.expandedSteps.indexOf(item.id) >= 0) {
            this.expandedBody(item)
          }
          }
        }
        .width('100%')
      }, (item: ConversationItem, index: number) => this.stepKey(item))
    }
    .width('100%')
    // 对齐小程序 .process-body { padding: 2rpx 0 6rpx }
    .padding({ top: 1.17, bottom: 3.52 })
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

      // 失败卡（对齐小程序 turn-error-card）
      if (this.entry.isError && this.entry.summary.length > 0) {
        Row({ space: 8 }) {
          Text('!')
            .fontSize(15)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .width(20)
            .height(20)
            .textAlign(TextAlign.Center)
            .borderRadius(10)
            .backgroundColor('#DC555C')
          Text(this.entry.summary)
            .fontSize(14)
            .fontColor('#D4545B')
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ left: 12, right: 12, top: 10, bottom: 10 })
        .borderRadius(9)
        .border({ width: 0.5, color: 'rgba(235,87,87,0.42)' })
        .backgroundColor('rgba(235,87,87,0.08)')
        .margin({ top: 6 })
      }
    }
    .width('100%')
    .padding({ top: 2, bottom: 2 })
  }

  // ==================== TURN（回合收拢行）====================
  @Builder
  turnRow() {
    Column() {
      Column() {
        this.groupHead(this.entry.title, this.entry.summary, this.entry.isError, this.entry.expanded, this.entry.expandable, false)
      }
      .width('100%')
      .onClick(() => {
        if (this.entry.expandable) {
          this.onToggle(this.entry.id);
        }
      })

      // 展开「已完成」：逐组显示，每组复用与顶层过程组相同的策略化渲染
      if (this.entry.expanded && this.entry.expandable) {
        Column() {
          ForEach(this.entry.children, (child: ConversationFeedEntryModel, index: number) => {
            ConversationRowView({
              entry: child,
              isDark: this.isDark,
              onToggle: (id: string) => {
                this.onToggle(id);
              },
              onCopy: (text: string) => {
                this.onCopy(text);
              },
              onShowDetail: (title: string, body: string) => {
                this.onShowDetail(title, body);
              }
            })
          }, (child: ConversationFeedEntryModel, index: number) => child.id + '#' + (child.expanded ? '1' : '0'))
        }
        .width('100%')
      }
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
