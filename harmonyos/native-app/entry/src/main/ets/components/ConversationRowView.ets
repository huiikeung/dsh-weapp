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
import { Haptics } from '../services/Haptics';
import { ProcLoaderView } from './ProcLoaderView';
import { AttachmentImageCache, GatewayClient, Logger, SessionStore, downloadAttachment } from 'nativecore';
import type { DownloadResult } from 'nativecore';
import { common } from '@kit.AbilityKit';
import type { GatewayImageAttachment } from 'nativecore';
import { fileCardColor, fileCardSummary, fileKindIcon, fileKindOf, fileKindRgb } from '../common/FileKind';

/** 用户多图网格的一格：path + 折叠时最后一格的「+N」数量（0 = 普通格） */
interface UserImageTile {
  path: string;
  moreCount: number;
}

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
  /** 设置 → 对话 → 「AI 生成标识」开关（默认开启）：关闭后每轮回复开头不显示「AI 生成内容，仅供参考」 */
  @StorageLink('aiContentLabelEnabled') aiLabelEnabled: boolean = true;
  /** 主题换代号：拼进 ForEach key，切主题时强制重建步骤节点（否则旧配色被复用） */
  @State themeGeneration: number = 0;
  /** 运行中思考卡固定高度；正文变长时只在卡内向上滚，页面高度不变（不抖） */
  private readonly RUNNING_CARD_HEIGHT: number = 210;
  /** 思考卡内部滚动控制器 */
  private reasonScroller: Scroller = new Scroller();
  /** 自动跟随（对齐参考 ReasoningCard）：触摸即暂停，左下「继续跟随」恢复 */
  @State reasonAuto: boolean = true;
  @State reasonTouching: boolean = false;
  /** 步进节拍：平时 840ms 一拍向后走 2 行；落后超过 2 行按 120ms/拍追赶（单跳 ≤40 行） */
  private reasonPaceTimer: number = -1;
  private reasonNextAt: number = 0;
  /** 思考正文实测高度（内层 Column），节拍用它换算「落后行数」 */
  private reasonContentH: number = 0;
  private reasonFollowAt: number = 0;
  /** 打字机：已显示字符数 / 对应思考段 id / 推进 timer（仅运行中的思考卡启用） */
  @State reasonTyped: number = 0;
  @State reasonTypedFor: string = '';
  private reasonTypeTimer: number = -1;
  private reasonLiveId: string = '';
  private reasonLiveText: string = '';
  /** 会话正文/用户气泡字号档位（设置页「字号大小」，响应式） */
  @StorageProp('contentFontSize') contentFontSize: string = '标准';
  /** 执行图标动效样式（设置页「执行图标」，13 种） */
  /** 执行图标样式（由 ConversationPage 下传，保证 LazyForEach 行能重渲染） */
  @Prop procIconStyle: string = 'default';
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
  /** 过程步骤展示档位：compact / standard / detailed / verbose */
  @Prop workStepMode: string = 'reading';
  /** 思考卡展开/折叠（底部两个按钮都走这个） */
  onToggleReasonCard: (id: string) => void = (id: string) => {};
  onToggleStep: (id: string) => void = () => {};
  /** 展开态底部「查看」：跳到轨迹页对应行（由会话页实现） */
  onViewStep: (item: ConversationItem) => void = () => {};
  /** 本条消息图片的本地路径（会话页预取后下传，顺序即展示顺序） */
  @Prop imagePaths: string[] = [];
  /** 过程步骤里的图片路径点击（如「读取图片 · /tmp/a.jpg」）→ 会话页下载并预览 */
  onImagePathTap: (path: string) => void = (path: string) => {};
  /** 回合页脚「用量」按钮点击（参数是该回合的 turnKey） */
  onTurnUsage: (turnKey: string) => void = (turnKey: string) => {};
  /** 本轮用量明细（页面按 turnKey 从 SessionStore 取好传入，点击用量胶囊时在按钮正上方弹出）
   *  必须是 @Prop：行组件按 id 复用，普通成员只在创建时赋值，弹层内容会停在旧值。 */
  @Prop turnUsageDetail: string = '';
  /** 用量弹窗标题右侧的精确总量（如 8,853,566 tok） */
  @Prop turnUsageTotal: string = '';
  /** 用量弹窗分项行（label\u0001value） */
  @Prop turnUsageRows: string[] = [];
  /** 用量菜单是否展开（bindMenu 原生系统菜单，锚定在胶囊上方，与顶栏「⋯」同款） */
  @State usageMenuOpen: boolean = false;
  /**
   * 图片本地路径（会话页拉取后写入 AppStorage）。LazyForEach 的行不会因父级 @State 变化而重建，
   * 订阅 AppStorage 才能「图片下载完成后原行直接出图」，不必重进页面。编码：entryId + '\u0001' + 路径。
   */
  @StorageProp('imagePathEntries') imagePathEntries: string[] = [];
  /** 预取失败的条目 id（父页写入）：这些行不再显示「加载中」，改显示「加载失败」 */
  @StorageProp('imageFailedEntries') imageFailedEntries: string[] = [];
  /** 图片解码/读取失败时记下路径，行内直接显示出来（排查空白图用） */
  @State private brokenImagePaths: string[] = [];
  /** 本行自己解析出来的图片本地路径（按 attachmentId 拉取后缓存，不再依赖页面级预取） */
  @State private resolvedImages: string[] = [];
  /** 文件附件里的图片：chip\u0001本地路径（按网关 path 下载后缓存，行内直接出缩略图） */
  @State @Watch('onChipImagesChanged') private chipImages: string[] = [];
  /** 待打开的图片组：被点图片在 attachmentChips 里的下标（>=0 表示还在等本地图就绪） */
  private pendingImageChip: number = -1;
  private pendingImageFallbackChip: string = '';
  private pendingImageTimer: number = -1;
  private chipImageBusy: boolean = false;
  /** 点击「加载失败」重试（父页重新发起预取） */
  private onRetryImages: () => void = () => {
  };
  /** 点击缩略图：会话页打开全屏预览 */
  onImageTap: (path: string) => void = () => {};
  /** 多图点击：整组图片 + 起始下标交给页面弹多图预览 */
  onImageListTap: (paths: string[], index: number) => void = () => {};
  /** 正文里的链接点击：会话页按「文件路径 → 底部弹窗预览内容 / http → 复制链接」处理 */
  onMarkdownLink: (text: string, href: string) => void = (text: string, href: string) => {};
  /** 引用这条回复：在输入框里插入引用 chip（对齐 iOS 最新版回复左下角的箭头引用按钮） */
  onQuoteReply: (text: string) => void = () => {};
  /** 长按回复正文：交给会话页弹底部弹窗（可选中/复制） */
  onReplyLongPress: (text: string) => void = (text: string) => {};
  /** 文件附件 chip（编码：kind\u0001name\u0001path\u0001attachmentId\u0001mediaType） */
  @Prop attachmentChips: string[] = [];
  /** 点击文件附件：会话页下载并预览 */
  onAttachmentTap: (name: string, path: string, mediaType: string) => void = () => {};
  /** 已编辑 / 交付文件卡片（编码：path\u0001name\u0001added\u0001deleted\u0001status） */
  @Prop fileCards: string[] = [];
  /** 卡片内联在助手回复里（显示在复制/用量/时间页脚上方） */
  @Prop filesInline: boolean = false;
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

  /** 用户正在容器内滑动 / 刚滑完的暂停窗口：这期间不要自动跟底（否则会被新内容顶掉） */
  private innerScrolling: boolean = false;
  /** 思考卡「暂停跟随」状态（存在会话页，行重建后保持） */
  @Prop reasonFollowPaused: boolean = false;
  onToggleReasonFollow: () => void = () => {};
  /** 阅读档折叠条是否展开（状态存在会话页，行重建后也能保持） */
  @Prop liveFoldOpen: boolean = false;
  onToggleLiveFold: () => void = () => {};
  private innerPauseUntil: number = 0;

  /** 上次渲染看到的步骤数：用于判断「新增了一步」并让限高框滚到底 */
  private lastItemCount: number = 0;

  /** 运行中每来一步都贴到底部（对齐小程序 process body 跟随最新步骤） */
  private followTail(): void {
    if (!this.entry.running) {
      return;
    }
    // 用户正在滑/刚滑完：暂停自动跟底 1.5 秒，避免"滑一点就被顶回去"
    if (this.innerScrolling || Date.now() < this.innerPauseUntil) {
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
    if (this.reasonPaceTimer >= 0) {
      clearInterval(this.reasonPaceTimer);
      this.reasonPaceTimer = -1;
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
    // 之前这里硬截 12000 字：长回复的后半段（代码块、段落）会整段消失，
    // 而退出重进走的是历史行、不经过这里的截断，所以看起来「重进才完整」。
    // 现在只保留一个极高的兜底上限，避免病理输入撑爆内存。
    const LIMIT: number = 200000;
    return value.length > LIMIT ? value.substring(0, LIMIT) + '…' : value;
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
        .width(14)
        .height(14)
        .objectFit(ImageFit.Contain)
        .opacity(0.45)
    }
    .width(26)
    .height(26)
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

  /** 单个文件 chip 的字段（编码：path\u0003name\u0003display\u0003added\u0003deleted\u0003hasCounts\u0003statusNote） */
  private fileAt(chip: string, index: number): string {
    const parts: string[] = chip.split('\u0003');
    return index < parts.length ? parts[index] : '';
  }

  /** 路径最后一段（Windows 的 \\ 与 / 都认） */
  private fileShortName(path: string): string {
    const normalized: string = path.replace(/\\/g, '/');
    const cut: number = normalized.lastIndexOf('/');
    const base: string = cut >= 0 ? normalized.substring(cut + 1) : normalized;
    return base.length > 0 ? base : normalized;
  }

  /**
   * 卡片标题用的文件名：直接映射 dsh 端的 {{file.name}}（不做任何加工）。
   * 只有 name 为空时才退回路径末段，避免空标题。
   */
  private fileTitleOf(chip: string): string {
    const name: string = this.fileAt(chip, 1);
    if (name.length > 0) {
      return name;
    }
    const path: string = this.filePathOf(chip);
    return path.length > 0 ? this.fileShortName(path) : '';
  }

  private filePathOf(chip: string): string {
    return this.fileAt(chip, 0).length > 0 ? this.fileAt(chip, 0) : this.fileAt(chip, 2);
  }

  /** 文件类型（对齐 dsh 端 FileIconCatalog）：Word→docx、Excel→xlsx、PPT→pptx、PDF→pdf … */
  private fileKind(chip: string): string {
    return fileKindOf(this.filePathOf(chip));
  }

  /** 全彩文件图标（与 dsh 端同一套 Untitled UI 矢量图，不加 tint） */
  private fileIcon(chip: string): Resource {
    return fileKindIcon(this.fileKind(chip));
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
      return '已编辑 ' + this.fileTitleOf(this.fileCards[0]);
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

  /** 这批文件是否带增删行数（有 = 代码改动卡片，无 = 明确交付的文件） */
  private filesHaveCounts(): boolean {
    for (const chip of this.fileCards) {
      if (this.fileAt(chip, 5) === '1') {
        return true;
      }
    }
    return false;
  }

  /** 交付文件卡片（对齐 dsh 电脑端）：图标底板 + 彩色类型徽标 + 文件名 17 + 「Word 文档：说明」14 */
  @Builder
  deliverableCard(chip: string) {
    Row({ space: 14 }) {
      // 回复侧保持原样式：图标底板 + 彩色徽标（无折角）
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(52)
          .height(52)
          .borderRadius(13)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.04)')
        this.fileKindBadge(this.fileKind(chip), 34)
      }
      .width(52)
      .height(52)
      .flexShrink(0)

      Column({ space: 3 }) {
          Text(this.fileTitleOf(chip))
          .fontSize(this.contentSize())
          .lineHeight(this.contentSize() + 4)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.primaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(this.deliverableSubtitle(chip))
          .fontSize(this.contentSize() - 2)
          .lineHeight(this.contentSize() + 2)
          .fontColor(this.secondaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: 10, bottom: 10 })
    .borderRadius(14)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)')
    .border({ width: 0.5, color: this.dividerLineColor() })
    .margin({ top: 8 })
    .onClick(() => {
      this.onFileTap(this.fileAt(chip, 1), this.fileAt(chip, 0), 0, false);
    })
  }

  /**
   * 文件行第二行（路径）：完全按 dsh 端规则映射 ——
   *   {{file.display}} 只在 display !== name 时渲染（见 miniprogram session.wxml changed-file-row）。
   * 主机的 display 常常就是文件名本身，不做这个判断就会「标题显示两遍」。
   */
  /** 右侧状态标签：dsh 端把「二进制 / 过大」显示在 +N −N 的位置，而不是塞在文件名下面 */
  private fileTagOf(chip: string): string {
    if (this.fileAt(chip, 5) === '1') {
      return '';
    }
    const note: string = this.fileAt(chip, 6);
    if (note.indexOf('二进制') >= 0) {
      return '二进制';
    }
    if (note.indexOf('过大') >= 0) {
      return '过大';
    }
    return '';
  }

  private filePathLineOf(chip: string): string {
    const display: string = this.fileAt(chip, 2);
    const name: string = this.fileAt(chip, 1);
    return display !== name ? display : '';
  }

  /** 交付文件副标题：「Word 文档：说明」，没有说明只留类型 */
  private deliverableSubtitle(chip: string): string {
    const label: string = this.kindLabel(this.fileKind(chip));
    const description: string = fileCardSummary(this.fileAt(chip, 6));
    return description.length > 0 ? label + '：' + description : label;
  }

  /** 类型 → 中文名（Word 文档 / Excel 表格 / PDF 文档 …） */
  private kindLabel(kind: string): string {
    if (kind === 'pdf') {
      return 'PDF 文档';
    }
    if (kind === 'doc' || kind === 'docx') {
      return 'Word 文档';
    }
    if (kind === 'xls' || kind === 'xlsx') {
      return 'Excel 表格';
    }
    if (kind === 'csv') {
      return 'CSV 表格';
    }
    if (kind === 'ppt' || kind === 'pptx') {
      return 'PowerPoint 演示文稿';
    }
    if (kind === 'md') {
      return 'Markdown 文档';
    }
    if (kind === 'txt') {
      return '文本文件';
    }
    if (kind === 'html') {
      return '网页';
    }
    if (kind === 'code') {
      return '代码文件';
    }
    if (kind === 'image') {
      return '图片';
    }
    if (kind === 'audio') {
      return '音频';
    }
    if (kind === 'video') {
      return '视频';
    }
    if (kind === 'archive') {
      return '压缩包';
    }
    if (kind === 'package') {
      return '安装包';
    }
    return '文件';
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
      if (!this.filesHaveCounts() && this.entry.kind !== KIND_CHANGES && !this.filesInline) {
        // 明确交付的文件（没有增删行数）：用 dsh 电脑端的文件卡样式，不再套「已编辑 N 个文件」。
        // 注意必须排除「已编辑」行：一批纯二进制改动（没有 +N −N）也曾走进这里，
        // 被渲染成交付文件卡（副标题「文件：二进制文件已变更…」），看起来像图片卡片跑到结尾。
        Column({ space: 8 }) {
          ForEach(this.fileCards, (chip: string) => {
            this.deliverableCard(chip)
          }, (chip: string) => chip)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      } else {
      Column() {
        Column() {
          Row({ space: this.rpx(18) }) {
            // 单文件：直接显示该类型的全彩图标（对齐 dsh FileReferenceCard 的 FileTypeIcon 48dp）；
            // 多文件：沿用「多文件」标记块。
            if (this.fileCards.length === 1) {
              // 与交付文件卡片同一套图标：52 底板 + 彩色类型徽标
              Stack({ alignContent: Alignment.Center }) {
                Column()
                  .width(this.rpx(100))
                  .height(this.rpx(100))
                  .borderRadius(this.rpx(24))
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.04)')
                this.fileKindBadge(this.fileKind(this.fileCards[0]))
              }
              .width(this.rpx(100))
              .height(this.rpx(100))
              .flexShrink(0)
            } else {
              Stack({ alignContent: Alignment.Center }) {
                Image($r('app.media.deliverable_code'))
                  .width(this.rpx(40))
                  .height(this.rpx(46))
                  .objectFit(ImageFit.Contain)
              }
              .width(this.rpx(64))
              .height(this.rpx(68))
              .borderRadius(this.rpx(16))
              .backgroundColor('rgba(128,128,128,0.08)')
              .border({ width: 1, color: this.dividerLineColor() })
            }

            Column({ space: this.rpx(6) }) {
              Text(this.filesTitle())
                .fontSize(this.rpx(28))
                .fontWeight(FontWeight.Medium)
                .fontColor(this.primaryText())
                .maxLines(2)
              if (this.fileCards.length === 1 && this.fileAt(this.fileCards[0], 6).length > 0
                && (this.entry.kind === KIND_CHANGES || this.filesInline)) {
                Text(this.fileAt(this.fileCards[0], 6))
                  .fontSize(this.rpx(23))
                  .fontColor(this.secondaryText())
                  .maxLines(2)
              } else if (this.entry.kind === KIND_CHANGES || this.filesInline) {
                // 对齐客户端：多文件卡片副标题显示汇总 +A −R（内联在助手回复里的同理）
                Row({ space: this.rpx(14) }) {
                  Text('+' + this.filesAdded().toString())
                    .fontSize(this.rpx(24))
                    .fontColor(this.addedColor())
                  Text('−' + this.filesDeleted().toString())
                    .fontSize(this.rpx(24))
                    .fontColor(this.deletedColor())
                }
              } else if (this.filePathLineOf(this.fileCards[0]).length > 0) {
                Text(this.filePathLineOf(this.fileCards[0]))
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
                    // 全彩类型图标（Word/Excel/PPT/PDF…），与 dsh 端一致
                    Image(this.fileIcon(chip))
                      .width(this.rpx(52))
                      .height(this.rpx(52))
                      .objectFit(ImageFit.Contain)
                      .flexShrink(0)
                    Column({ space: this.rpx(4) }) {
                    Text(this.fileTitleOf(chip))
                        .fontSize(this.rpx(26))
                        .lineHeight(this.rpx(26) * 1.5)
                        .fontColor(this.primaryText())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      if (this.filePathLineOf(chip).length > 0) {
                        Text(this.filePathLineOf(chip))
                          .fontSize(this.rpx(22))
                          .fontColor(this.secondaryText())
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                      }
                      if (this.fileAt(chip, 6).length > 0 && this.fileTagOf(chip).length === 0) {
                        Text(this.fileAt(chip, 6))
                          .fontSize(this.rpx(21))
                          .fontColor(this.tertiaryText())
                          .maxLines(2)
                      }
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
                      .flexShrink(0)
                    } else if (this.fileTagOf(chip).length > 0) {
                      // 二进制 / 过大：右侧纯文字标签（无底色），对齐 dsh 端
                      Text(this.fileTagOf(chip))
                        .fontSize(this.rpx(21))
                        .fontColor(this.tertiaryText())
                        .flexShrink(0)
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
            // 对齐截图：「显示全部文件 (N)」居中，点击展开/收起
            Text(this.filesExpanded ? '收起' : '显示全部文件 (' + this.fileCards.length.toString() + ')')
              .fontSize(this.rpx(24))
              .fontColor(this.secondaryText())
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding({ top: this.rpx(18), bottom: this.rpx(18) })
              .onClick(() => {
                this.filesExpanded = !this.filesExpanded;
              })
          }
        }
        .width('100%')
        .border({ width: 1, color: this.borderStrongColor() })
        .borderRadius(this.rpx(24))
        // 直接透出页面底色
        .backgroundColor(Color.Transparent)
        .clip(true)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      }
    }
  }

  // ==================== 文件附件 ====================
  /** 文件附件 chip 列表（对齐小程序 .message-attachment：胶囊 + 图标 + 文件名） */
  @Builder
  attachmentList(alignEnd: boolean) {
    if (this.attachmentChips.length > 0) {
      Column({ space: this.rpx(16) }) {
        ForEach(this.attachmentChips, (chip: string, chipIndex: number) => {
          if (this.isImageAttachmentChip(chip) && alignEnd) {
            // 用户发送的图片：直接显示缩略图（与输入框里的预览一致），点击从底部弹出大图
            Stack({ alignContent: Alignment.Center }) {
              if (this.chipImagePath(chip).length > 0) {
                Image(this.imageSource(this.chipImagePath(chip)))
                  .width(this.rpx(220))
                  .height(this.rpx(220))
                  .borderRadius(this.rpx(18))
                  .objectFit(ImageFit.Cover)
              } else {
                LoadingProgress()
                  .width(this.rpx(30))
                  .height(this.rpx(30))
                  .color(this.secondaryText())
              }
            }
            .width(this.rpx(220))
            .height(this.rpx(220))
            .borderRadius(this.rpx(18))
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.035)')
            .border({ width: 1, color: this.dividerLineColor() })
            .clip(true)
            .margin({ top: this.rpx(8) })
            .onClick(() => {
              const local: string = this.chipImagePath(chip);
              if (local.length > 0) {
                this.onImageTap(local);
              } else {
                this.resolveChipImages();
              }
            })
          } else if (this.isImageAttachmentChip(chip)) {
            // 回复里的图片：卡片式（图标 + 文件名 + 说明 + 右侧分享/打开按钮，对齐截图）
            Row({ space: this.rpx(16) }) {
              Stack({ alignContent: Alignment.Center }) {
                Image($r('app.media.deliverable_image'))
                  .width(this.rpx(44))
                  .height(this.rpx(44))
                  .objectFit(ImageFit.Contain)
              }
              .width(this.rpx(64))
              .height(this.rpx(64))
              .borderRadius(this.rpx(16))
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
              .border({ width: 0.5, color: this.dividerLineColor() })

              Column({ space: this.rpx(4) }) {
                Text(this.attachmentName(chip))
                  .fontSize(this.rpx(28))
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.primaryText())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text('点击预览图片')
                  .fontSize(this.rpx(22))
                  .fontColor(this.secondaryText())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)

              Stack({ alignContent: Alignment.Center }) {
                SymbolGlyph($r('sys.symbol.share'))
                  .fontSize(this.rpx(30))
                  .fontColor([this.secondaryText()])
              }
              .width(this.rpx(64))
              .height(this.rpx(64))
              .borderRadius(this.rpx(16))
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
              .border({ width: 0.5, color: this.dividerLineColor() })
              .onClick(() => {
                this.onAttachmentTap(this.attachmentName(chip), this.attachmentPath(chip), this.attachmentMediaType(chip));
              })
            }
            .width('100%')
            .constraintSize({ minHeight: this.rpx(96) })
            .padding({ left: this.rpx(18), right: this.rpx(18), top: this.rpx(14), bottom: this.rpx(14) })
            .borderRadius(this.rpx(24))
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.035)')
            .border({ width: 0.5, color: this.dividerLineColor() })
            .margin({ top: this.rpx(8) })
            .onClick(() => {
              // 同一条回复里的图片当作一组：点卡片打开大图预览，可左右翻看整组；
              // 附件是 attachmentId 形式（无工作区路径）时先拉缓存/下载，就绪后再开
              this.openImageGroup(chipIndex, chip);
            })
          } else if (alignEnd) {
            // 自己发出去的文档：dsh 电脑端「彩色方块 + 文件名 + PDF 7.3MB」样式
            this.sentFileCard(chip)
          } else {
            // 回复里交付的文档：保持原样式（图标底板 + 文件名 + 类型：说明）
            this.fileReferenceCard(chip)
          }
        }, (chip: string) => chip)
      }
      .width('100%')
      .alignItems(alignEnd ? HorizontalAlign.End : HorizontalAlign.Start)
      .margin({ top: this.rpx(12) })
    }
  }

  /**
   * 文档图标：直接用现成的 Untitled UI 文件图标（ficon_*.svg，带页面折角的那套），
   * 和「已编辑文件」卡片行里用的是同一批图，不再自己画方块 + 字母。
   */
  @Builder
  fileKindBadge(kind: string, size: number = 34) {
    Image(fileKindIcon(kind))
      .width(size)
      .height(size)
      .objectFit(ImageFit.Contain)
  }

  /**
   * 交付/附件文件卡片：对齐 dsh 电脑端（截图）——
   * 中性卡片底 + 52 图标底板（内嵌彩色类型图标）+ 文件名 17 Medium + 「Word 文档：说明」14 次要色。
   */
  @Builder
  sentFileCard(chip: string) {
    Row({ space: 14 }) {
      // 用户发送的文档：直接放在卡片上（不套底板），与 dsh 电脑端一致
      this.fileKindBadge(this.attachmentFileKind(chip), 44)

      Column({ space: 3 }) {
        Text(this.attachmentName(chip))
          .fontSize(this.contentSize())
          .lineHeight(this.contentSize() + 4)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.primaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(this.sentFileSubtitle(chip))
          .fontSize(this.contentSize() - 2)
          .lineHeight(this.contentSize() + 2)
          .fontColor(this.secondaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: 10, bottom: 10 })
    .borderRadius(14)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)')
    .border({ width: 0.5, color: this.dividerLineColor() })
    .margin({ top: 8 })
    .onClick(() => {
      this.onAttachmentTap(this.attachmentName(chip), this.attachmentPath(chip), this.attachmentMediaType(chip));
    })
  }

  /**
   * 回复里交付的文档卡片（保持 dsh 电脑端原样式）：图标底板 + 彩色类型徽标 +
   * 文件名 17 + 「Word 文档：说明」。
   */
  @Builder
  fileReferenceCard(chip: string) {
    Row({ space: 14 }) {
      Stack({ alignContent: Alignment.Center }) {
        Column()
          .width(52)
          .height(52)
          .borderRadius(13)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(16,19,24,0.04)')
        this.fileKindBadge(this.attachmentFileKind(chip), 34)
      }
      .width(52)
      .height(52)
      .flexShrink(0)

      Column({ space: 3 }) {
        Text(this.attachmentName(chip))
          .fontSize(this.contentSize())
          .lineHeight(this.contentSize() + 4)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.primaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(this.fileReferenceSubtitle(chip))
          .fontSize(this.contentSize() - 2)
          .lineHeight(this.contentSize() + 2)
          .fontColor(this.secondaryText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: 10, bottom: 10 })
    .borderRadius(14)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)')
    .border({ width: 0.5, color: this.dividerLineColor() })
    .margin({ top: 8 })
    .onClick(() => {
      this.onAttachmentTap(this.attachmentName(chip), this.attachmentPath(chip), this.attachmentMediaType(chip));
    })
  }

  /** 回复卡片副标题：「Word 文档：<说明>」，没有说明时只留类型名 */
  private fileReferenceSubtitle(chip: string): string {
    const label: string = this.attachmentKindLabel(chip);
    // dsh 端会去掉说明末尾括号里的展开清单（FileCardDescription.summary）
    const description: string = fileCardSummary(this.attachmentDescription(chip));
    return description.length > 0 ? label + '：' + description : label;
  }

  /** 发送出去的文档卡片副标题：「PDF 7.3MB」 */
  private sentFileSubtitle(chip: string): string {
    const label: string = this.attachmentKindLabel(chip);
    const size: string = this.attachmentSizeText(chip);
    return size.length > 0 ? label + ' ' + size : label;
  }

  /** 附件字节数 → 人话大小（chip 第 6 段；0 表示未知） */
  private attachmentSizeText(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    const bytes: number = parts.length > 5 ? Number(parts[5]) : 0;
    if (isNaN(bytes) || bytes <= 0) {
      return '';
    }
    if (bytes < 1024) {
      return bytes.toString() + 'B';
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + 'KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  }

  /** 附件类型（走 dsh 端 FileIconCatalog 口径） */
  private attachmentFileKind(chip: string): string {
    return fileKindOf(this.attachmentName(chip), this.attachmentMediaType(chip));
  }

  /** 附件类型说明（Word 文档 / Excel 表格 / PDF …），作卡片副标题 */
  private attachmentKindLabel(chip: string): string {
    const kind: string = this.attachmentFileKind(chip);
    if (kind === 'pdf') {
      return 'PDF 文档';
    }
    if (kind === 'doc' || kind === 'docx') {
      return 'Word 文档';
    }
    if (kind === 'xls' || kind === 'xlsx') {
      return 'Excel 表格';
    }
    if (kind === 'csv') {
      return 'CSV 表格';
    }
    if (kind === 'ppt' || kind === 'pptx') {
      return 'PowerPoint 演示文稿';
    }
    if (kind === 'md') {
      return 'Markdown 文档';
    }
    if (kind === 'txt') {
      return '文本文件';
    }
    if (kind === 'html') {
      return '网页';
    }
    if (kind === 'code') {
      return '代码文件';
    }
    if (kind === 'image') {
      return '图片';
    }
    if (kind === 'audio') {
      return '音频';
    }
    if (kind === 'video') {
      return '视频';
    }
    if (kind === 'archive') {
      return '压缩包';
    }
    if (kind === 'package') {
      return '安装包';
    }
    return '文件';
  }

  /** 图片附件判定：mediaType 以 image/ 开头，或扩展名是图片 */
  private isImageAttachmentChip(chip: string): boolean {
    const mediaType: string = this.attachmentMediaType(chip).toLowerCase();
    if (mediaType.indexOf('image/') === 0) {
      return true;
    }
    const name: string = this.attachmentName(chip).toLowerCase();
    return /\.(jpg|jpeg|png|webp|heic|heif|gif|bmp)$/.test(name);
  }

  private attachmentDescription(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    return parts.length > 5 ? parts[5] : '';
  }

  /** 附件文件名：name 字段缺失或就是路径时，退回路径最后一段（避免标题显示整条 C:\\...） */
  private attachmentName(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    const name: string = parts.length > 1 ? parts[1] : '';
    const path: string = parts.length > 2 ? parts[2] : '';
    if (name.length > 0 && name.indexOf('/') < 0 && name.indexOf('\\') < 0 && name.indexOf(':') < 0) {
      return name;
    }
    if (path.length > 0) {
      return this.fileShortName(path);
    }
    return name.length > 0 ? name : chip;
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

  aboutToAppear(): void {
    this.resolveRowImages();
    this.resolveChipImages();
  }

  /** 该图片附件 chip 对应的本地路径（没下载好时为空） */
  private chipImagePath(chip: string): string {
    const prefix: string = chip + '\u0001';
    for (const item of this.chipImages) {
      if (item.startsWith(prefix)) {
        return item.substring(prefix.length);
      }
    }
    return '';
  }

  /**
   * 图片附件（type='file' + mediaType image/*，只有网关工作区路径、没有 attachmentId）：
   * 通过 file-download 拉到本地，行内直接当缩略图显示（对齐小程序「在侧边栏预览→缩略图」）。
   */
  private resolveChipImages(): void {
    if (this.chipImageBusy) {
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    const client: GatewayClient = GatewayClient.get();
    if (sessionId.length === 0 || !client.isConnected()) {
      return;
    }
    const pending: string[] = [];
    for (const chip of this.attachmentChips) {
      if (!this.isImageAttachmentChip(chip) || this.chipResolvedImage(chip).length > 0) {
        continue;
      }
      // 只有工作区路径的附件才走 file-download；attachmentId 形式的在 kickChipImageFetch 里处理
      if (this.attachmentPath(chip).length > 0) {
        pending.push(chip);
      }
    }
    if (pending.length === 0) {
      return;
    }
    this.chipImageBusy = true;
    const context = getContext(this) as common.UIAbilityContext;
    this.fetchChipImageAt(context, client, sessionId, pending, 0);
  }

  private fetchChipImageAt(context: common.UIAbilityContext, client: GatewayClient, sessionId: string,
    pending: string[], index: number): void {
    if (index >= pending.length) {
      this.chipImageBusy = false;
      return;
    }
    const chip: string = pending[index];
    downloadAttachment(context, client, sessionId, this.attachmentPath(chip), () => {})
      .then((result: DownloadResult) => {
        if (result.localPath.length > 0 && this.chipImages.indexOf(chip + '\u0001' + result.localPath) < 0) {
          this.chipImages = this.chipImages.concat([chip + '\u0001' + result.localPath]);
        }
        this.fetchChipImageAt(context, client, sessionId, pending, index + 1);
      })
      .catch((error: Error) => {
        Logger.warn('[IMG] chip download failed ' + error.message);
        this.fetchChipImageAt(context, client, sessionId, pending, index + 1);
      });
  }

  /** chip 里第 4 段是 attachmentId（kind\u0001name\u0001path\u0001attachmentId\u0001mediaType） */
  private chipAttachmentId(chip: string): string {
    const parts: string[] = chip.split('\u0001');
    return parts.length > 3 ? parts[3] : '';
  }

  /** 图片 chip 的本地可渲染路径：行内下载结果 → 附件缓存（按 attachmentId） */
  private chipResolvedImage(chip: string): string {
    const fromState: string = this.chipImagePath(chip);
    if (fromState.length > 0) {
      return fromState;
    }
    const id: string = this.chipAttachmentId(chip);
    if (id.length === 0) {
      return '';
    }
    return AttachmentImageCache.localPath(id, this.attachmentMediaType(chip), this.attachmentName(chip));
  }

  /** 为 attachmentId 形式的图片附件拉取本地缓存（缓存命中会同步返回） */
  private kickChipImageFetch(): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || !GatewayClient.get().isConnected()) {
      return;
    }
    for (const chip of this.attachmentChips) {
      if (!this.isImageAttachmentChip(chip) || this.chipResolvedImage(chip).length > 0) {
        continue;
      }
      const id: string = this.chipAttachmentId(chip);
      if (id.length === 0) {
        continue;
      }
      AttachmentImageCache.fetch(sessionId, id, this.attachmentMediaType(chip), this.attachmentName(chip))
        .then((path: string) => {
          if (path.length > 0 && this.chipImages.indexOf(chip + '\u0001' + path) < 0) {
            this.chipImages = this.chipImages.concat([chip + '\u0001' + path]);
          }
        })
        .catch(() => {
        });
    }
  }

  private allImageChipsResolved(): boolean {
    for (const chip of this.attachmentChips) {
      if (this.isImageAttachmentChip(chip) && this.chipResolvedImage(chip).length === 0) {
        return false;
      }
    }
    return true;
  }

  private onChipImagesChanged(): void {
    if (this.pendingImageChip >= 0 && this.allImageChipsResolved()) {
      this.tryOpenPendingImageGroup();
    }
  }

  /** 点回复图片卡片：打开整组大图（等所有图就绪，最多等 1.5s，超时用手上已就绪的） */
  private openImageGroup(chipIndex: number, fallbackChip: string): void {
    this.pendingImageChip = chipIndex;
    this.pendingImageFallbackChip = fallbackChip;
    this.kickChipImageFetch();
    this.resolveChipImages();
    if (this.allImageChipsResolved()) {
      this.tryOpenPendingImageGroup();
      return;
    }
    if (this.pendingImageTimer >= 0) {
      clearTimeout(this.pendingImageTimer);
    }
    this.pendingImageTimer = setTimeout(() => {
      this.pendingImageTimer = -1;
      if (this.pendingImageChip < 0) {
        return;
      }
      if (this.chipResolvedImage(this.pendingImageFallbackChip).length > 0) {
        this.tryOpenPendingImageGroup();
        return;
      }
      // 连被点的那张都没下来：退回原来的「打开附件」逻辑（会给出提示或外部预览）
      const chip: string = this.pendingImageFallbackChip;
      this.pendingImageChip = -1;
      this.pendingImageFallbackChip = '';
      this.onAttachmentTap(this.attachmentName(chip), this.attachmentPath(chip), this.attachmentMediaType(chip));
    }, 1500);
  }

  private tryOpenPendingImageGroup(): void {
    if (this.pendingImageChip < 0) {
      return;
    }
    const group: string[] = [];
    let current: number = -1;
    for (let i = 0; i < this.attachmentChips.length; i++) {
      const one: string = this.attachmentChips[i];
      if (!this.isImageAttachmentChip(one)) {
        continue;
      }
      const local: string = this.chipResolvedImage(one);
      if (local.length === 0) {
        continue;
      }
      if (i === this.pendingImageChip) {
        current = group.length;
      }
      group.push(local);
    }
    if (current < 0) {
      return;
    }
    if (this.pendingImageTimer >= 0) {
      clearTimeout(this.pendingImageTimer);
      this.pendingImageTimer = -1;
    }
    this.pendingImageChip = -1;
    this.pendingImageFallbackChip = '';
    this.onImageListTap(group, current);
  }

  /**
   * 本行图片自适应解析（对齐小程序 decorateRowImages + pumpAttachmentThumbs）：
   * 历史行的 images 只有 attachmentId，这里逐张查缓存/向网关拉取，拿到本地路径后写进
   * resolvedImages 直接渲染 —— 不依赖页面级 imagePathEntries 那条链路。
   */
  private resolveRowImages(): void {
    const images: GatewayImageAttachment[] = this.entry.images;
    if (images === undefined || images.length === 0) {
      return;
    }
    const sessionId: string = this.sessionIdForImages();
    for (const image of images) {
      if (image === null || image === undefined) {
        continue;
      }
      const id: string = image.attachmentId === undefined ? '' : image.attachmentId;
      if (id.length === 0) {
        continue;
      }
      const mediaType: string = image.mediaType === undefined ? 'image/jpeg' : image.mediaType;
      const name: string = image.name === undefined ? '' : image.name;
      const cached: string = AttachmentImageCache.localPath(id, mediaType, name);
      if (cached.length > 0) {
        this.appendResolved(cached);
        continue;
      }
      if (sessionId.length === 0) {
        continue;
      }
      AttachmentImageCache.fetch(sessionId, id, mediaType, name).then((path: string) => {
        this.appendResolved(path);
      }).catch((error: Error) => {
        Logger.warn('[IMG] row fetch failed ' + id.substring(0, 12) + ' ' + error.message);
      });
    }
  }

  private sessionIdForImages(): string {
    return SessionStore.get().currentSessionId();
  }

  private appendResolved(path: string): void {
    if (path.length === 0 || this.resolvedImages.indexOf(path) >= 0) {
      return;
    }
    this.resolvedImages = this.resolvedImages.concat([path]);
  }

  /** 本行图片：本地乐观图 + 已下载附件图（订阅 AppStorage，下载完自动出图） */
  /** 附件 id → 缓存文件名前缀（AttachmentImageCache.safeId 同规则） */
  private static safeAttachmentId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 120);
  }

  /** 正文里被 Markdown 引用的图片文件名（![](.../name)） */
  private referencedImageNames(): string[] {
    const names: string[] = [];
    const text: string = this.entry.text;
    let from: number = 0;
    while (true) {
      const at: number = text.indexOf('](', from);
      if (at < 0) {
        break;
      }
      const close: number = text.indexOf(')', at + 2);
      if (close < 0) {
        break;
      }
      const src: string = text.substring(at + 2, close).trim();
      const base: string = src.split('/').pop() ?? '';
      if (base.length > 0) {
        names.push(base);
      }
      from = close + 1;
    }
    return names;
  }

  /**
   * 这张图是否已在正文 Markdown 里内联显示（行尾图片网格要排除，避免同一张图显示两遍）。
   * 直接按 entry.text 里的引用 + entry.images 的文件名匹配，不依赖 feed 阶段的顺序/标记，
   * 流式阶段先于正文引用到达也能正确去重。
   */
  private isInlineImagePath(path: string): boolean {
    const imgs = this.entry.images;
    if (imgs === undefined || imgs.length === 0) {
      return false;
    }
    const names: string[] = this.referencedImageNames();
    if (names.length === 0) {
      return false;
    }
    const base: string = path.split('/').pop() ?? path;
    const text: string = this.entry.text;
    for (const img of imgs) {
      const name: string = img.name === undefined ? '' : img.name;
      if (name.length === 0) {
        continue;
      }
      // 宽松兜底：文件名在正文里出现过（Markdown 引用/路径都算）就认为已在正文内联显示，
      // 避免解析差异导致同一张图在行尾再出现一次。
      const cited: boolean = names.indexOf(name) >= 0 || text.indexOf(name) >= 0;
      if (!cited) {
        continue;
      }
      if (base.indexOf(ConversationRowView.safeAttachmentId(img.attachmentId)) >= 0) {
        return true;
      }
      if (text.indexOf(name) >= 0 && names.indexOf(name) >= 0) {
        return true;
      }
    }
    return false;
  }

  /** 正文里的所有 Markdown 图片（按出现顺序解析成本机路径），用于「整组大图预览」 */
  private markdownImageGroup(text: string): string[] {
    const group: string[] = [];
    const re: RegExp = new RegExp('!\\[[^\\]]*\\]\\(([^)\\s]+)', 'g');
    let match: RegExpExecArray | null = re.exec(text);
    while (match !== null) {
      const src: string = match[1];
      const local: string = this.resolveMarkdownImage(src);
      if (local.length > 0 && group.indexOf(local) < 0) {
        group.push(local);
      }
      match = re.exec(text);
    }
    return group;
  }

  /** 点正文内联图：同一条回复里的多张图按一组打开（可左右翻 + 双指缩放），单张走原来的单图预览 */
  private openMarkdownImage(src: string, text: string): void {
    const group: string[] = this.markdownImageGroup(text);
    const index: number = group.indexOf(src);
    if (group.length > 1 && index >= 0) {
      this.onImageListTap(group, index);
      return;
    }
    this.onImageTap(src);
  }

  /**
   * Markdown 内联图片地址 → 本机可渲染路径。
   * http(s) 原样；宿主机本地路径按文件名匹配本条消息里的图片附件，再用附件缓存/已下载路径兜底。
   */
  private resolveMarkdownImage(src: string): string {
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    const name: string = src.split('/').pop() ?? '';
    if (name.length === 0) {
      return '';
    }
    const imgs = this.entry.images;
    if (imgs === undefined) {
      return '';
    }
    for (const img of imgs) {
      const imgName: string = img.name === undefined ? '' : img.name;
      if (imgName !== name) {
        continue;
      }
      const cached: string = AttachmentImageCache.localPath(img.attachmentId, img.mediaType, imgName);
      if (cached.length > 0) {
        return this.imageSource(cached);
      }
      const prefix: string = this.entry.id + '\u0001';
      const safe: string = ConversationRowView.safeAttachmentId(img.attachmentId);
      for (const item of this.imagePathEntries) {
        if (!item.startsWith(prefix)) {
          continue;
        }
        const path: string = item.substring(prefix.length);
        const base: string = path.split('/').pop() ?? '';
        if (base.indexOf(safe) >= 0) {
          return this.imageSource(path);
        }
      }
      return '';
    }
    return '';
  }

  private imageList(): string[] {
    const list: string[] = [];
    const pushUnique = (path: string): void => {
      if (path.length > 0 && list.indexOf(path) < 0 && !this.isInlineImagePath(path)) {
        list.push(path);
      }
    };
    for (const one of this.entry.localImages) {
      pushUnique(one);
    }
    // 自己刚发的图：本地路径就是权威源，直接返回，避免网关卡回同一张图又叠一条 → 单图变「多图卡片」
    if (list.length > 0) {
      return list;
    }
    for (const path of this.resolvedImages) {
      pushUnique(path);
    }
    const prefix: string = this.entry.id + '\u0001';
    for (const item of this.imagePathEntries) {
      if (item.startsWith(prefix)) {
        pushUnique(item.substring(prefix.length));
      }
    }
    for (const extra of this.imagePaths) {
      if (list.indexOf(extra) < 0) {
        list.push(extra);
      }
    }
    return list;
  }

  /**
   * 图片：单张 640×560rpx 大图，多张 360×560rpx 竖图（max-width 46%）两列平铺，
   * 尺寸/圆角/描边逐项对齐小程序 attach-grid。
   * topRpx/bottomRpx 由调用方给：用户消息里图片在文字「上方」，所以是 bottom 间距；
   * 助手消息里图片接在正文「下方」，所以是 top 间距。
   */
  /**
   * 助手回复行尾的图片列表：只要正文里出现了 Markdown 图片引用，就整行不再追加图片
   * （引用的图已经在正文对应位置内联渲染，行尾再画一次就是重复）。
   * 这是不依赖附件名/文件名匹配的硬保证，避免任何命名差异导致重复。
   */
  private assistantGridImageList(): string[] {
    if (this.referencedImageNames().length > 0) {
      return [];
    }
    return this.imageList();
  }

  @Builder
  imageGrid(topRpx: number = 12, bottomRpx: number = 0) {
    if (this.assistantGridImageList().length === 1) {
      // 单图尺寸对齐小程序 .attach-grid.single .attach-img：640×560rpx、圆角 22rpx
      Image(this.imageSource(this.assistantGridImageList()[0]))
        .width(this.rpx(640))
        .height(this.rpx(560))
        .constraintSize({ maxWidth: '100%' })
        .objectFit(ImageFit.Cover)
        .borderRadius(this.rpx(22))
        .margin({ top: this.rpx(topRpx), bottom: this.rpx(bottomRpx) })
        .onError(() => {
          const source: string = this.imageSource(this.assistantGridImageList()[0]);
          if (this.brokenImagePaths.indexOf(source) < 0) {
            Logger.warn('[IMG] render failed ' + source);
            this.brokenImagePaths = this.brokenImagePaths.concat([source]);
          }
        })
        .onClick(() => {
          this.onImageTap(this.assistantGridImageList()[0]);
        })
    } else if (this.assistantGridImageList().length > 1) {
      // 多图：直接显示图片（不显示文件名/「点击预览图片」文案），点击大图预览。
      // 尺寸对齐小程序 .attach-grid:not(.single) .attach-img：360×560rpx、max-width 46%、圆角 22rpx、1rpx 描边
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(this.assistantGridImageList(), (path: string) => {
          Image(this.imageSource(path))
            .width(this.rpx(360))
            .height(this.rpx(560))
            .constraintSize({ maxWidth: '46%' })
            .objectFit(ImageFit.Cover)
            .borderRadius(this.rpx(22))
            .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.08)' })
            .margin({ right: this.rpx(12), bottom: this.rpx(12) })
            .onError(() => {
              const source: string = this.imageSource(path);
              if (this.brokenImagePaths.indexOf(source) < 0) {
                Logger.warn('[IMG] render failed ' + source);
                this.brokenImagePaths = this.brokenImagePaths.concat([source]);
              }
            })
            .onClick(() => {
              this.onImageTap(path);
            })
        }, (path: string) => path)
      }
      .margin({ top: this.rpx(topRpx > 2 ? 2 : 0), bottom: this.rpx(bottomRpx) })
    }
  }

  // ==================== 用户图片（多图用小图标网格，对齐 iOS 图片组） ====================
  private userImageTileList(): UserImageTile[] {
    const list: string[] = this.imageList();
    const maxVisible: number = 8;
    const shown: number = list.length > maxVisible ? maxVisible : list.length;
    const tiles: UserImageTile[] = [];
    for (let index = 0; index < shown; index++) {
      const isLast: boolean = index === maxVisible - 1;
      tiles.push({
        path: list[index],
        moreCount: isLast && list.length > maxVisible ? list.length - maxVisible : 0
      });
    }
    return tiles;
  }

  private userVisibleCount(): number {
    return Math.min(this.imageList().length, 3);
  }

  /** 叠卡边长（rpx）：min(328, max(192, 可视宽 - 24*(n-1)))，可视宽 = 750-148 */
  private userStackSide(): number {
    const visible: number = this.userVisibleCount();
    const available: number = 750 - 148;
    return Math.min(328, Math.max(192, available - 24 * (visible - 1)));
  }

  /** 单图按原图比例缩放到 640×640 与可视宽以内（拿不到原始尺寸时退回正方形） */
  private userSingleSize(): number[] {
    const available: number = 750 - 148;
    const imgs = this.entry.images;
    if (imgs !== undefined && imgs.length > 0) {
      const sw: number = imgs[0].width;
      const sh: number = imgs[0].height;
      if (sw > 0 && sh > 0) {
        const scale: number = Math.min(1, 640 / sw, 640 / sh, available / sw);
        const width: number = Math.max(1, Math.floor(sw * scale));
        const height: number = Math.max(1, Math.floor(sh * scale));
        return [width, height];
      }
    }
    const side: number = Math.min(640, available);
    return [side, side];
  }

  /** 用户单图：按原图比例的圆角大图（小程序 .user-image-single） */
  @Builder
  userImageSingle() {
    Image(this.imageSource(this.imageList()[0]))
      .width(this.rpx(this.userSingleSize()[0]))
      .height(this.rpx(this.userSingleSize()[1]))
      .constraintSize({ maxWidth: '100%' })
      .objectFit(ImageFit.Cover)
      .borderRadius(this.rpx(22))
      .margin({ bottom: this.entry.text.length > 0 ? this.rpx(16) : 0 })
      .onError(() => {
        const source: string = this.imageSource(this.imageList()[0]);
        if (this.brokenImagePaths.indexOf(source) < 0) {
          this.brokenImagePaths = this.brokenImagePaths.concat([source]);
        }
      })
      .onClick(() => {
        this.onImageTap(this.imageList()[0]);
      })
  }

  /**
   * 用户多图：4 列小图标网格（一行最多 4 张，多了换行）。
   * 超过 8 张折叠为 8 格，最后一格盖「+N」；点任意一格弹多图预览，可左右翻看每一张。
   */
  @Builder
  userImageGrid() {
    // 用户消息靠右：外层 Row 用 justifyContent(End) 把网格整体推到右侧
    Row() {
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.End, alignItems: ItemAlign.End }) {
      ForEach(this.userImageTileList(), (tile: UserImageTile, index: number) => {
        Stack({ alignContent: Alignment.Center }) {
          Image(this.imageSource(tile.path))
            .width(this.rpx(132))
            .height(this.rpx(132))
            .objectFit(ImageFit.Cover)
            .borderRadius(this.rpx(18))
            .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.08)' })
            .onError(() => {
              const source: string = this.imageSource(tile.path);
              if (this.brokenImagePaths.indexOf(source) < 0) {
                this.brokenImagePaths = this.brokenImagePaths.concat([source]);
              }
            })
          if (tile.moreCount > 0) {
            Column() {
              Text('+' + tile.moreCount.toString())
                .fontSize(this.rpx(30))
                .fontWeight(FontWeight.Medium)
                .fontColor('#FFFFFF')
            }
            .width(this.rpx(132))
            .height(this.rpx(132))
            .justifyContent(FlexAlign.Center)
            .alignItems(HorizontalAlign.Center)
            .borderRadius(this.rpx(18))
            .backgroundColor('rgba(0,0,0,0.48)')
          }
        }
        .width(this.rpx(132))
        .height(this.rpx(132))
        .margin({ right: this.rpx(14), bottom: this.rpx(14) })
        .onClick(() => {
          this.onImageListTap(this.imageList(), index);
        })
        }, (tile: UserImageTile) => tile.path)
      }
      .constraintSize({ maxWidth: '100%' })
    }
    .width('100%')
    .justifyContent(FlexAlign.End)
    .margin({ bottom: this.entry.text.length > 0 ? this.rpx(16) : 0 })
  }

  // ==================== USER ====================
  /** 用户消息（对齐小程序 .row-user / .row-user-bubble / .row-user-text） */
  @Builder
  userRow() {
    Column() {
      // ① 图片在文字上方（对齐小程序 .row-user：user-image-single / user-image-stack 是
      //    .row-user-bubble 的兄弟节点，排在文字前面，且不套蓝色气泡底）
      if (this.imageList().length === 1) {
        this.userImageSingle()
      } else if (this.imageList().length > 1) {
        this.userImageGrid()
      }

      // 图片还没拿到：下载中显示转圈，失败则显示可点重试（不再永远停在「加载中」）
      if (this.entry.imageCount > 0 && this.imageList().length === 0) {
        if (this.imageFailedEntries.indexOf(this.entry.id) >= 0) {
          Row({ space: 4 }) {
            Text('图片 ' + this.entry.imageCount.toString() + ' 张加载失败，点击重试')
              .fontSize(11.73)
              .fontColor(DANGER)
          }
          .alignItems(VerticalAlign.Center)
          .padding({ top: 2, bottom: 2 })
          .onClick(() => {
            this.onRetryImages();
          })
        } else {
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

      // ② 文字气泡（只有文字时才画气泡；纯图片消息不再套一层空蓝底）
      if (this.entry.text.length > 0) {
        Column() {
          // 用户消息字号与助手正文一致（不再额外放大）
          Text(this.entry.text)
            .fontSize(this.contentSize())
            .lineHeight(this.contentSize() * 1.45)
            .fontColor(this.primaryText())
        }
        .alignItems(HorizontalAlign.Start)
        // .row-user-bubble：圆角 30rpx、padding 20rpx 28rpx
        .padding({ left: 16.43, right: 16.43, top: 11.73, bottom: 11.73 })
        .borderRadius(17.6)
        .backgroundColor(this.userBubbleFill())
        .border({ width: 0.7, color: this.userBubbleEdge() })
        .constraintSize({ maxWidth: '100%' })
      }

      this.attachmentList(true)

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
  /** 用量分项行的标签 / 数值 */
  private usageRowLabel(line: string): string {
    const parts: string[] = line.split('\u0001');
    return parts.length > 0 ? parts[0] : line;
  }

  private usageRowValue(line: string): string {
    const parts: string[] = line.split('\u0001');
    return parts.length > 1 ? parts[1] : '';
  }

  /** 菜单标题行：库图标 + 本轮用量 + 右侧精确总量（与「⋯」菜单的行同口径，只做展示） */
  @Builder
  usageMenuHeader() {
    Row({ space: 12 }) {
      Image($r('app.media.dsh_storage'))
        .width(19)
        .height(19)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.tintMatrix(this.primaryText()))
      Text('本轮用量')
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.primaryText())
        .maxLines(1)
      Blank()
      if (this.turnUsageTotal.length > 0) {
        Text(this.turnUsageTotal)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.primaryText())
          .maxLines(1)
      }
    }
    .width(308)
    .height(48)
    .padding({ left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
  }

  /** 菜单分隔线（与「⋯」菜单同款：0.5vp 分隔色条 + 上下留白） */
  @Builder
  usageMenuDivider() {
    Column() {
      Row()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)')
    }
    .width(292)
    .padding({ top: 5, bottom: 5, left: 16, right: 16 })
  }

  /** 单行用量：左标签右数值（与「⋯」菜单行同为 52vp 高、15.4 字号） */
  @Builder
  usageMenuLine(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(13.5)
        .fontColor(this.secondaryText())
        .flexShrink(0)
        .maxLines(1)
      Text(value)
        .fontSize(13.5)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.primaryText())
        .layoutWeight(1)
        .textAlign(TextAlign.End)
        .margin({ left: 14 })
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width(308)
    .height(40)
    .padding({ left: 16, right: 16 })
    .alignItems(VerticalAlign.Center)
  }

  /** 用量菜单：原生系统菜单（bindMenu），样式与顶栏右上角「⋯」完全一致 */
  @Builder
  usageMenu() {
    Menu() {
      MenuItem(this.usageMenuHeader()).enabled(false)
      MenuItem(this.usageMenuDivider()).enabled(false)
      if (this.turnUsageRows.length > 0) {
        ForEach(this.turnUsageRows, (line: string) => {
          MenuItem(this.usageMenuLine(this.usageRowLabel(line), this.usageRowValue(line))).enabled(false)
        }, (line: string) => line)
      } else {
        MenuItem(this.usageMenuLine('本轮暂无用量数据', '')).enabled(false)
      }
    }
  }

  @Builder
  assistantRow() {
    Column() {
      if (this.entry.streaming) {
        Row({ space: this.rpx(10) }) {
          // 加载图与「执行图标」同大（过程组标题图标同为 rpx(32)），此前只有 5.87vp、几乎看不见
          LoadingProgress()
            .width(this.rpx(32))
            .height(this.rpx(32))
            .color(OCEAN)
          // .row-streaming-title 30rpx 500 --text-2
          Text(this.entry.title)
            .fontSize(17.6)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.secondaryText())
        }
        .alignItems(VerticalAlign.Center)
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
      // 正文容器挂长按：打开"可选中/复制"的底部弹窗（对话页统一定义弹窗本体）
      Column() {
        MarkdownBodyView({
          text: this.assistantBody(),
          fontSize: this.contentSize(),
          textColor: this.entry.isError ? DANGER : '',
          onImageTap: (src: string) => {
            this.openMarkdownImage(src, this.assistantBody());
          },
          resolveImage: (src: string) => this.resolveMarkdownImage(src),
          linkTapEnabled: true,
          onLinkTap: (text: string, href: string) => {
            this.onMarkdownLink(text, href);
          },
          imageRevision: this.imagePathEntries.length
        })
      }
      .width('100%')
      .gesture(LongPressGesture({ repeat: false, duration: 480 }).onAction(() => {
        const body: string = this.assistantBody();
        if (body.length > 0) {
          // 触感走全局「设置 → 震动反馈」档位（off 时不震）
          Haptics.play();
          this.onReplyLongPress(body);
        }
      }))
      this.imageGrid(12, 0)
      this.attachmentList(false)
      if (this.filesInline) {
        // 已编辑文件卡片：在回复正文之后、复制/用量/时间页脚之前。
        // 与上面的图片卡片 / 附件留出间距，避免两张卡片贴在一起。
        Column() {
          this.filesCard()
        }
        .width('100%')
        .margin({ top: this.rpx(12) })
      }
      if (this.entry.footerVisible) {
        // .turn-footer：gap 14rpx、padding 4rpx 0；左组 gap 10rpx
        // .turn-footer：gap 14rpx(≈7vp)、padding 4rpx 0；左组依次 复制 / 用量 / 时间，整体左对齐
        Row({ space: 7 }) {
          // 复制：与消息下方那个复制按钮完全一致（11vp 图标 + 22vp 命中区 + opacity 0.45）
          Row() {
            Image($r('app.media.copy_gray'))
              .width(14)
              .height(14)
              .objectFit(ImageFit.Contain)
              .opacity(0.45)
          }
          .width(26)
          .height(26)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.onCopy(this.entry.text);
          })

          // 复制右侧：引用（箭头图标，对齐 iOS 最新版回复左下角的引用按钮）
          Row() {
            // 引用箭头：20×20，左右只留 1vp 余量（之前 32 宽命中区导致左右间隙过大）
            Image($r('app.media.quote_reply'))
              .width(20)
              .height(20)
              .objectFit(ImageFit.Contain)
              .opacity(0.45)
          }
          .width(22)
          .height(30)
          .justifyContent(FlexAlign.Center)
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.onQuoteReply(this.entry.text);
          })

          if (this.entry.turnMetaText.length > 0) {
            // .turn-meta：图标 + 用量文字胶囊；点击 → 在胶囊正上方展开用量弹层
            Row({ space: 3 }) {
              Image($r('app.media.dsh_gauge'))
                .width(13)
                .height(13)
                .objectFit(ImageFit.Contain)
                .opacity(0.7)
              Text(this.entry.turnMetaText)
                .fontSize(11)
                .lineHeight(15)
                .fontColor(this.secondaryText())
                .maxLines(1)
            }
            .padding({ left: 7, right: 7 })
            .constraintSize({ minHeight: 20 })
            .borderRadius(10)
            .backgroundColor(this.fillColor())
            .alignItems(VerticalAlign.Center)
            // 与顶栏「⋯」同款系统菜单：锚定胶囊、向上展开、点空白收起
            .onClick(() => {
              if (this.turnUsageRows.length > 0) {
                this.usageMenuOpen = !this.usageMenuOpen;
              } else {
                this.onTurnUsage(this.entry.turnKey);
              }
            })
            .bindMenu(this.usageMenuOpen, this.usageMenu(), {
              placement: Placement.Top,
              offset: { x: 0, y: -4 },
              outlineColor: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)',
              outlineWidth: 1,
              onWillDisappear: () => {
                this.usageMenuOpen = false;
              },
              onDisappear: () => {
                this.usageMenuOpen = false;
              },
              onDidDisappear: () => {
                this.usageMenuOpen = false;
              }
            })
          }

          if (this.entry.turnElapsedText.length > 0) {
            // 本轮用时：用量胶囊右侧，时钟图标 + 「用时 5 分 19 秒」（对齐 iOS 回复页脚）
            Row({ space: 3 }) {
              Image($r('app.media.proc_clock'))
                .width(12)
                .height(12)
                .objectFit(ImageFit.Contain)
                .opacity(0.6)
                .colorFilter(this.tintMatrix(this.tertiaryText()))
              Text(this.entry.turnElapsedText)
                .fontSize(11)
                .lineHeight(15)
                .fontColor(this.tertiaryText())
                .maxLines(1)
            }
            .alignItems(VerticalAlign.Center)
          }

          if (this.entry.turnTimeText.length > 0) {
            // .turn-time 23rpx --text-3：紧跟在用量按钮右侧（小程序也是 flex 左对齐，不推到最右）
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
    // 后台任务类工具（job_output / job_list / job_kill）用任务清单图标
    if (ConversationFeed.jobToolLabel(item.title).length > 0) {
      return this.isDark ? $r('app.media.proc_checklist_dark') : $r('app.media.proc_checklist');
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
    // 后台任务类工具：完成后补「已完成」，让「读取任务输出 · <jobId> · 已完成」可读
    if (status === 'done' && ConversationFeed.jobToolLabel(item.title).length > 0) {
      return '已完成';
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
  /** 步骤标题：有子步骤的父过程只显示名称（去掉「运行」），单行步骤保留「运行xx」 */
  private stepTitle(item: ConversationItem): string {
    const label: string = ConversationFeed.toolFace(item.title, item.text).label;
    if (item.hasChildren === true && label.indexOf('运行') === 0) {
      return label.substring(2);
    }
    return label;
  }

  /** 展开区第一段标题：代码类给语言名（对齐 DSH 的代码块标题），其余为「调用参数」 */
  private argsLabel(item: ConversationItem): string {
    if (ToolActivity.kind(item.title) !== 'code') {
      return '调用参数';
    }
    const name: string = String(item.title === undefined ? '' : item.title).toLowerCase();
    if (name.indexOf('python') >= 0) {
      return 'Python';
    }
    return 'TypeScript';
  }

  /** 展开区第二段标题：代码类是「输出」，其余是「调用结果」 */
  private resultLabel(item: ConversationItem): string {
    return ToolActivity.kind(item.title) === 'code' ? '输出' : '调用结果';
  }

  /** 跟在详情后面的状态（前缀 · ），紧贴内容而不是右对齐；错误行用「错误：」表达，不再重复 */
  private trailingStatus(item: ConversationItem): string {
    if (item.isError === true) {
      return '';
    }
    const status: string = this.stepStatus(item);
    return status.length > 0 ? ' · ' + status : '';
  }

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
    return estimate < 77 ? 77 : (estimate > 320 ? 320 : estimate);
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
          this.openMarkdownImage(src, item.text);
        },
        resolveImage: (src: string) => this.resolveMarkdownImage(src),
        linkTapEnabled: true,
        onLinkTap: (text: string, href: string) => {
          this.onMarkdownLink(text, href);
        },
        imageRevision: this.imagePathEntries.length
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
  /**
   * 这一组是否还在「进行中」：不只是 entry.running，
   * 某些档位下运行态没有传到行上（liveDetail 有值/组体限高/最后一步仍在跑），
   * 用这几个信号兜底，避免思考卡按已结束处理→高度随内容增长把页面顶上去。
   */
  private cardIsLive(): boolean {
    if (this.entry.running) {
      return true;
    }
    if (this.entry.liveDetail.length > 0) {
      return true;
    }
    const items: ConversationItem[] = this.entry.items;
    if (items.length > 0) {
      const last: ConversationItem = items[items.length - 1];
      if (last.status === 'running') {
        return true;
      }
    }
    return false;
  }

  /** 这是本组里第几个「思考」（1 起），对齐插件右上角的「步骤 N」 */
  private reasoningStepNo(item: ConversationItem): number {
    let count: number = 0;
    for (const one of this.entry.items) {
      if ((one.kind as string) === 'REASONING') {
        count++;
        if (one.id === item.id) {
          return count;
        }
      }
    }
    return count;
  }


  /**
   * 逐行跟随节拍（对齐参考 reasoning-follow / ReasoningCard）：
   * 平时 840ms 一拍向后走 2 行（有序的「一行一行打出来」）；落后超过 2 行时以 120ms/拍追赶，
   * 单跳最多 40 行，保证最新一行始终跟着正文；触摸即暂停（reasonAuto=false），
   * 「继续跟随」或恢复后从当前位置重新起拍。
   */
  private startReasonPacer(): void {
    if (this.reasonPaceTimer >= 0) {
      return;
    }
    this.reasonNextAt = 0;
    this.reasonPaceTimer = setInterval(() => {
      if (!this.cardIsLive() || !this.reasonAuto || this.reasonTouching) {
        return;
      }
      const viewH: number = this.RUNNING_CARD_HEIGHT;
      const end: number = Math.max(0, this.reasonContentH - viewH);
      if (end <= 0) {
        return;
      }
      if (Date.now() < this.reasonNextAt) {
        return;
      }
      const off: number = this.reasonScroller.currentOffset().yOffset;
      const backlog: number = end - off;
      const lineH: number = this.rpx(48);
      const lines: number = Math.min(40, Math.max(2, Math.ceil(backlog / lineH)));
      const target: number = Math.min(end, off + lineH * lines);
      try {
        this.reasonScroller.scrollTo({ xOffset: 0, yOffset: target });
      } catch (err) {
      }
      this.reasonNextAt = Date.now() + (backlog > lineH * 2 ? 120 : 840);
    }, 60);
  }

  @Builder
  reasoningCard(item: ConversationItem) {
    Column() {
      Row() {
        Text('思考')
          .fontSize(11)
          .fontWeight(FontWeight.Normal)
          .fontColor(this.secondaryText())
        Blank()
        // 右上角：本组第几段思考（对齐插件「步骤 N」）
        Text('步骤 ' + this.reasoningStepNo(item).toString())
          .fontSize(11)
          .fontColor(this.tertiaryText())
          .margin({ left: this.rpx(10) })
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
        Scroll(this.reasonScroller) {
          Column() {
            Text(this.stepDetail(item))
              .fontSize(13)
              .lineHeight(this.rpx(48))
              .fontColor(this.secondaryText())
              .width('100%')
              .padding({ right: this.rpx(10) })
              .copyOption(CopyOptions.LocalDevice)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .onAreaChange((_old: Area, newVal: Area) => {
            // 思考正文实测高度：节拍用它算「落后多少行」
            const h: number = Number(newVal.height);
            if (h > 0) {
              this.reasonContentH = h;
            }
            if (this.cardIsLive()) {
              this.startReasonPacer();
            }
          })
        }
        // 运行中固定高度（不再随内容变高把页面往上顶）；结束后按内容估算高度
        .height(this.cardIsLive() ? this.RUNNING_CARD_HEIGHT : this.readingHeight(this.stepDetail(item)))
        .scrollBar(BarState.On)
        .scrollBarWidth(3)
        .scrollBarColor(this.tertiaryText())
        .width('100%')
        // 卡片内部滚动优先（SELF_FIRST）：手指落在卡上先滚卡内，滚到头才带动页面。
        // 之前用 PARENT_FIRST 会把竖向滚动全部交给外层列表，卡内永远不动、滚动条也拖不动。
        .nestedScroll({
          scrollForward: NestedScrollMode.SELF_FIRST,
          scrollBackward: NestedScrollMode.SELF_FIRST
        })
        // 手指一按下就暂停「跟随滚动」，否则自动滚到底会和手动拖动打架（表现为拖不动）
        .onTouch((event: TouchEvent) => {
          if (event.type === TouchType.Down) {
            this.reasonTouching = true;
            // 触摸即暂停自动跟随：只改本地状态（不触发页面重投影/行重建），
            // 卡内 SELF_FIRST 滚动可以正常拖动查看，不会被跟随节拍打断
            if (this.cardIsLive() && this.reasonAuto) {
              this.reasonAuto = false;
            }
          } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
            this.reasonTouching = false;
          }
        })
      }

      Row() {
        // 左下：生成中显示「暂停跟随 / 继续跟随」；结束后显示阅读状态（对齐插件）
        if (this.cardIsLive()) {
          Text(this.reasonAuto ? '暂停跟随' : '继续跟随')
            .fontSize(11)
            .fontColor(this.secondaryText())
            .onClick(() => {
              // 恢复跟随：节拍从当前位置重新走起
              this.reasonAuto = true;
              this.reasonNextAt = 0;
              this.onToggleReasonFollow();
            })
        } else {
          Text(this.reasonFull(item.id) ? '手动阅读' : '滚动阅读')
            .fontSize(11)
            .fontColor(this.secondaryText())
        }
        Blank()
        // 右下：展开阅读 / 收起
        Row({ space: this.rpx(8) }) {
          Text(this.reasonFull(item.id) ? '收起' : '展开阅读')
            .fontSize(11)
            .fontColor(this.secondaryText())
          Image($r('app.media.chev_right_gray'))
            .width(this.rpx(20))
            .height(this.rpx(20))
            .objectFit(ImageFit.Contain)
            .rotate({ angle: this.reasonFull(item.id) ? -90 : 90 })
            .opacity(0.7)
        }
        .constraintSize({ minHeight: this.rpx(52) })
        .padding({ left: this.rpx(16) })
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
          this.onToggleReasonFull(item.id);
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
    // 外层不铺底色：卡片本体在内层，底部「查看」落在卡片外（与代码行展开一致）
    Column() {
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
      .clip(true)

      // 查看：卡片外的左下角（行内左侧与卡片左缘齐平）
      Row() {
        Text('查看')
          .fontSize(11.5)
          .fontColor(this.secondaryText())
      }
      .padding({ left: this.rpx(14), right: this.rpx(14), top: this.rpx(5), bottom: this.rpx(5) })
      .borderRadius(this.rpx(12))
      .border({ width: 0.5, color: this.ruleColor() })
      .backgroundColor(this.fill2Color())
      .margin({ top: this.rpx(10) })
      .onClick(() => {
        this.onViewStep(item);
      })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: this.rpx(16) })
  }

  /** 普通工具详情（对齐小程序 .tool-detail：左缩进 44rpx，「调用参数」+「结果」两段代码块） */
  @Builder
  toolDetail(item: ConversationItem) {
    // 对齐 DSH：整块一张卡（淡底 + 细边），里面「调用参数 / 调用结果」各自一个代码块，
    // 底部左下角一个「查看」，点了跳到轨迹页对应行。
    Column({ space: 0 }) {
      if (this.argsText(item).length > 0) {
        Text(this.argsLabel(item))
          .fontSize(11.5)
          .fontColor(this.secondaryText())
          .width('100%')
          .margin({ bottom: this.rpx(6) })
        Text(this.argsText(item))
          .fontSize(11)
          .lineHeight(this.rpx(32))
          .fontColor(this.primaryText())
          .fontFamily('monospace')
          .width('100%')
          .padding(this.rpx(16))
          .borderRadius(this.rpx(14))
          .backgroundColor(this.fill2Color())
          .copyOption(CopyOptions.LocalDevice)
          .margin({ bottom: this.rpx(12) })
      }
      if (this.resultText(item).length > 0) {
        Text(item.isError === true ? '错误' : this.resultLabel(item))
          .fontSize(11.5)
          .fontColor(item.isError === true ? '#E5484D' : this.secondaryText())
          .width('100%')
          .margin({ bottom: this.rpx(6) })
        Text(this.resultText(item))
          .fontSize(11)
          .lineHeight(this.rpx(32))
          .fontColor(this.primaryText())
          .fontFamily('monospace')
          .width('100%')
          .padding(this.rpx(16))
          .borderRadius(this.rpx(14))
          .backgroundColor(this.fill2Color())
          .copyOption(CopyOptions.LocalDevice)
          .margin({ bottom: this.rpx(12) })
      }
      // 底部左下角：查看（跳轨迹）；后台任务行本身就在轨迹里另有入口，不再重复给「查看」
      if (ConversationFeed.jobToolLabel(item.title).length === 0) {
      Row() {
        Text('查看')
          .fontSize(11.5)
          .fontColor(this.secondaryText())
      }
      .padding({ left: this.rpx(14), right: this.rpx(14), top: this.rpx(5), bottom: this.rpx(5) })
      .borderRadius(this.rpx(12))
      .border({ width: 0.5, color: this.ruleColor() })
      .backgroundColor(this.fillColor())
      .onClick(() => {
        this.onViewStep(item);
      })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    // 不再给整块套背景：两段（TypeScript / 输出）各自已有背景块。
    // 缩进用 padding（不能用 margin）：width 100% + margin-left 会把内容推出父容器、看起来偏左且被裁。
    // 44rpx = 图标槽 32rpx + 图标与文字间距 10rpx，正好对齐上面「代码 · …」的文字左缘。
    .width('100%')
    .padding({ left: this.rpx(42), right: this.rpx(6), bottom: this.rpx(12) })
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

  /** 工具产出的图片（attachment 形式）：显示名 / 缓存路径 */
  private stepAttachmentName(item: ConversationItem): string {
    const images: Object[] | undefined = item.images;
    if (images === undefined || images.length === 0) {
      return '';
    }
    if (images.length > 1) {
      return '图片 × ' + images.length.toString();
    }
    const image = images[0] as GatewayImageAttachment;
    const name: string = image.name === undefined ? '' : image.name;
    return name.length > 0 ? name : '图片';
  }

  private stepAttachmentPath(item: ConversationItem): string {
    const images: Object[] | undefined = item.images;
    if (images === undefined || images.length === 0) {
      return '';
    }
    const image = images[0] as GatewayImageAttachment;
    const id: string = image.attachmentId === undefined ? '' : image.attachmentId;
    if (id.length === 0) {
      return '';
    }
    const safe: string = ConversationRowView.safeAttachmentId(id);
    const prefix: string = this.entry.id + '\u0001';
    for (const entry of this.imagePathEntries) {
      if (!entry.startsWith(prefix)) {
        continue;
      }
      const path: string = entry.substring(prefix.length);
      const base: string = path.split('/').pop() ?? '';
      if (base.indexOf(safe) >= 0) {
        return this.imageSource(path);
      }
    }
    const cached: string = AttachmentImageCache.localPath(id, image.mediaType, image.name ?? '');
    return cached.length > 0 ? this.imageSource(cached) : '';
  }

  /**
   * 折叠态步骤详情：超过 44 字符时按路径分段只保留末尾 N 级（前缀 .\），文件名必须可见；
   * 短文本/非路径文本原样返回。展开态（stepOpen）不走这里，显示完整多行。
   */
  private stepTailPreview(detail: string): string {
    if (detail.length <= 44) {
      return detail;
    }
    const sep: string = detail.indexOf('\\') >= 0 ? '\\' : '/';
    if (detail.indexOf(sep) < 0) {
      return detail;
    }
    const parts: string[] = detail.split(sep).filter((p: string) => p.length > 0);
    if (parts.length < 2) {
      return detail;
    }
    let take: number = 1;
    let out: string = '.' + sep + parts[parts.length - 1];
    while (take < parts.length) {
      const cand: string = '.' + sep + parts.slice(parts.length - take - 1).join(sep);
      if (cand.length > 44) {
        break;
      }
      out = cand;
      take++;
    }
    return out;
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
        if (this.stepDetail(item).length > 0 && this.workStepMode !== 'compact') {
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
        Text(this.stepTitle(item))
          .fontSize(13.2)
          .fontWeight(FontWeight.Normal)
          .fontColor(this.secondaryText())
          .flexShrink(0)
          .constraintSize({ maxWidth: '48%' })
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        // 工具产出的图片：默认只显示一行带下划线的文字链接，点击弹窗预览
        if (this.stepAttachmentName(item).length > 0) {
          Text('· ' + this.stepAttachmentName(item))
            .fontSize(11.5)
            .fontColor('#2E6BE6')
            .decoration({ type: TextDecorationType.Underline, color: '#2E6BE6' })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .flexShrink(0)
            .constraintSize({ maxWidth: '40%' })
            .onClick(() => {
              const imagePath: string = this.stepAttachmentPath(item);
              if (imagePath.length > 0) {
                this.onImageTap(imagePath);
              }
            })
        }
        // 失败步骤：标签后接「· 错误：<详情>」（对齐 DSH，不再在行尾重复「失败」）
        if (item.isError === true && (ConversationFeed.toolFace(item.title, item.text).detail.length > 0
          || this.stepAttachmentName(item).length > 0)) {
          Text('· 错误：')
            .fontSize(11.5)
            .fontColor('#E5484D')
            .flexShrink(0)
        }
        if (ConversationFeed.toolFace(item.title, item.text).detail.length > 0) {
          // 错误行前面已经输出过「· 错误：」，这里不再重复一个「·」
          if (item.isError !== true) {
            Text('·')
              .fontSize(12.6)
              .fontColor(this.tertiaryText())
              .flexShrink(0)
          }
          // 折叠态单行：路径按末尾 N 级缩短（.\xx\name），点开展开后显示完整多行
          Text((this.stepOpen(item.id)
            ? ConversationFeed.toolFace(item.title, item.text).detail
            : this.stepTailPreview(ConversationFeed.toolFace(item.title, item.text).detail)) + this.trailingStatus(item))
            .fontSize(11.5)
            .lineHeight(16.5)
            // 过程文字统一用默认色（用户明确要求：不要蓝色）。
            // 图片路径仍然可以点开预览，但不再靠颜色区分。
            .fontColor(this.tertiaryText())
            .layoutWeight(1)
            .maxLines(this.stepOpen(item.id) ? 6 : 1)
            .wordBreak(WordBreak.BREAK_ALL)
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
          } else if ((item.kind as string) === 'REASONING' && (this.stepOpen(item.id) || this.entry.running || this.workStepMode === 'verbose')) {
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
          this.processBody(this.displayItems())
        }
        .width('100%')
        // 不再「内容一长就自动滚内层」：
        // 内层自动跟随 + 外层列表吸底两个滚动面同时改变位置，是页面持续抖动的来源。
        // 内层交给用户手动滑（滚到边界会接力滚整页）。
      }
      .constraintSize({ maxHeight: 400 })
      .scrollBar(BarState.Off)
      // 手指一按下就暂停自动跟底；滑动结束后再等 1.5 秒恢复，
      // 这样容器内可以自由上下翻看，不会被下面新增的内容顶掉。
      .onTouch((event: TouchEvent) => {
        if (event.type === TouchType.Down) {
          this.innerPauseUntil = Date.now() + 2500;
        }
      })
      .onScrollStart(() => {
        this.innerScrolling = true;
      })
      .onScrollStop(() => {
        this.innerScrolling = false;
        this.innerPauseUntil = Date.now() + 1500;
      })
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
      this.processBody(this.displayItems())
    }
  }

  /** 阅读档实时折叠：要渲染的步骤（折叠时跳过已收进折叠条的前缀） */
  private displayItems(): ConversationItem[] {
    const items: ConversationItem[] = this.entry.items;
    if (this.workStepMode === 'reading' && this.entry.running && this.entry.liveFoldCount > 0
      && !this.liveFoldOpen) {
      return items.slice(this.entry.liveFoldCount);
    }
    return items;
  }

  /** 实时折叠条上的计数：只统计被收起来的那段步骤 */
  private liveFoldLabel(): string {
    let think: number = 0;
    let out: number = 0;
    let tool: number = 0;
    let record: number = 0;
    const end: number = Math.min(this.entry.liveFoldCount, this.entry.items.length);
    for (let index = 0; index < end; index++) {
      const kind: string = this.entry.items[index].kind as string;
      if (kind === 'REASONING') {
        think++;
      } else if (kind === 'TOOL' || kind === 'JSON_TOOL') {
        tool++;
      } else if (kind === 'ASSISTANT') {
        out++;
      } else {
        record++;
      }
    }
    const parts: string[] = [];
    if (think > 0) {
      parts.push('思考×' + think.toString());
    }
    if (out > 0) {
      parts.push('输出×' + out.toString());
    }
    if (tool > 0) {
      parts.push('工具×' + tool.toString());
    }
    if (record > 0) {
      parts.push('记录×' + record.toString());
    }
    return parts.length > 0 ? parts.join(' · ') : '此前步骤';
  }

  /** 实时折叠条（阅读档运行中：之前的步骤收成一行） */
  @Builder
  liveFoldRow() {
    Row({ space: this.rpx(6) }) {
      Text(this.liveFoldLabel())
        .fontSize(13.2)
        .fontColor(this.secondaryText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Image($r('app.media.chev_right_gray'))
        .flexShrink(0)
        .width(this.rpx(20))
        .height(this.rpx(20))
        .objectFit(ImageFit.Contain)
        .rotate({ angle: this.liveFoldOpen ? 90 : 0 })
        .opacity(0.7)
    }
    .width('100%')
    .padding({ top: this.rpx(6), bottom: this.rpx(6) })
    .onClick(() => {
      this.liveFoldOpen = !this.liveFoldOpen;
    })
  }

  /** 阅读档折叠行：思考× N · 工具× N · 记录× N，右侧箭头（对齐 iOS/交互阅读样式） */
  @Builder
  readingHead() {
    Row({ space: this.rpx(8) }) {
      // 标题只统计「已经折叠起来」的步骤（当前正在进行的这一段不计入）
      Text(this.liveFoldLabel())
        .fontSize(13.2)
        .fontColor(this.entry.isError ? DANGER : this.secondaryText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Image($r('app.media.chev_right_gray'))
        .flexShrink(0)
        .width(this.rpx(20))
        .height(this.rpx(20))
        .objectFit(ImageFit.Contain)
        .rotate({ angle: this.liveFoldOpen ? 90 : 0 })
        .opacity(0.7)
    }
    .width('100%')
    .padding({ top: this.rpx(8), bottom: this.rpx(8) })
    .constraintSize({ minHeight: this.rpx(56) })
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      // 阅读档：点折叠条 = 展开/收起之前链条的步骤（容器内）
      this.onToggleLiveFold();
    })
  }

  /**
   * 折叠摘要计数 —— 与 dsh-interactive-reader 的 foldSummary() 完全一致：
   * 思考×N（推理）· 输出×N（正文叙述）· 工具×N（工具调用）· 记录×N（其余步骤），
   * 无空格、按该顺序拼接；都为 0 时回退「此前步骤」。
   */
  private readingSummaryOf(items: ConversationItem[]): string {
    let reasoning: number = 0;
    let body: number = 0;
    let tools: number = 0;
    let extra: number = 0;
    for (const one of items) {
      const kind: string = one.kind as string;
      if (kind === 'REASONING') {
        reasoning = reasoning + 1;
      } else if (kind === 'ASSISTANT') {
        body = body + 1;
      } else if (kind === 'TOOL' || kind === 'JSON_TOOL') {
        tools = tools + 1;
      } else {
        extra = extra + 1;
      }
    }
    const parts: string[] = [];
    if (reasoning > 0) {
      parts.push('思考×' + reasoning.toString());
    }
    if (body > 0) {
      parts.push('输出×' + body.toString());
    }
    if (tools > 0) {
      parts.push('工具×' + tools.toString());
    }
    if (extra > 0) {
      parts.push('记录×' + extra.toString());
    }
    return parts.length > 0 ? parts.join(' · ') : '此前步骤';
  }

  private readingTurnCounts(): string {
    const all: ConversationItem[] = [];
    for (const group of this.entry.children) {
      for (const item of group.items) {
        all.push(item);
      }
    }
    return this.readingSummaryOf(all);
  }

  private readingCounts(): string {
    return this.readingSummaryOf(this.entry.items);
  }

  @Builder
  processRow() {
    Column() {
      // 阅读档：顶部计数行 → 步骤 → 执行图标行（保持原来的位置：贴底、在鲸尾行上方）
      if (this.workStepMode === 'reading') {
        // 折叠条（容器外顶部）：累计「之前链条」的思考×N · 工具×N · 记录×N，点击展开/收起
        if (this.workStepMode === 'reading' && this.entry.running && this.entry.liveFoldCount > 0) {
          this.readingHead()
        }
        if (this.bodyVisible()) {
          this.bodyBlock()
        }
        if (this.entry.running) {
          Column() {
            this.groupHead(this.entry.title, this.entry.summary, this.entry.isError, true,
              this.entry.expandable, true)
          }
          .width('100%')
          .onClick(() => {
            if (this.entry.expandable) {
              this.onToggle(this.entry.id);
            }
          })
        }
      } else {

      // 运行中：组体在上、组头贴底（对齐 .process-block.running 的 order: body 0 / head 1）
      if (this.entry.running && this.bodyVisible()) {
        this.bodyBlock()
      }

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
      }

      // 失败卡（对齐小程序 turn-error-card）：只有回合真的失败（带失败文案）才显示，
      // 工具单步失败只在该步骤上标红，不升级成整组错误卡。
    }
    .width('100%')
    .padding({ top: 2, bottom: 2 })
  }

  // ==================== TURN（回合收拢行）====================
  /** 阅读档回合行文案：「已完成 · 思考×… · 工具×… · 记录×…」 */
  private readingTurnLabel(): string {
    if (this.entry.text.length === 0) {
      return this.entry.title;
    }
    return this.entry.title.length > 0 ? this.entry.title + ' · ' + this.entry.text : this.entry.text;
  }

  @Builder
  turnRow() {
    Column() {
      // 阅读档：回合折叠成计数摘要行（右侧箭头），点击展开该回合的过程
      if (this.workStepMode === 'reading' && this.entry.title.length > 0) {
        Row({ space: this.rpx(6) }) {
          // 阅读档回合行：标题 + 步骤计数（页面在 rebuildEntries 里把计数写到 entry.text）
          Text(this.readingTurnLabel())
            .fontSize(13.2)
            .fontColor(this.secondaryText())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Image($r('app.media.chev_right_gray'))
            .width(this.rpx(20))
            .height(this.rpx(20))
            .objectFit(ImageFit.Contain)
            .rotate({ angle: this.entry.expanded ? 90 : 0 })
            .opacity(0.7)
            .flexShrink(0)
        }
        .width('100%')
        .padding({ top: this.rpx(6), bottom: this.rpx(6) })
        .onClick(() => {
          this.onToggle(this.entry.id);
        })
      }
      // 非阅读档 / 无计数：保持「已完成」标题行
      if (this.workStepMode !== 'reading' || this.entry.title.length === 0) {
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
      }

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

  /**
   * 回合结束状态行。
   * 失败态对齐小程序 .turn-error-card：红色描边卡片 + 圆形「!」+ 标题 + 可换行详情；
   * 非失败态（生成已取消等）保持低调的浅色提示。
   */
  @Builder
  systemRow() {
    if (this.entry.isError) {
      Column({ space: 10 }) {
        Row({ space: 10 }) {
          Text('!')
            .fontSize(12)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
            .width(18)
            .height(18)
            .borderRadius(9)
            .textAlign(TextAlign.Center)
            .backgroundColor(this.isDark ? '#FF7178' : '#EB5757')
          Text(this.entry.title)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.isDark ? '#FF9B9F' : '#C0392B')
            .layoutWeight(1)
            .maxLines(2)
          // 错误码徽标（对齐小程序 .turn-error-code 的红色小方块）
          if (this.entry.failureCode.length > 0) {
            Text(this.entry.failureCode)
              .fontSize(10.5)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.isDark ? '#FF9B9F' : '#C0392B')
              .padding({ left: 6, right: 6, top: 2, bottom: 2 })
              .borderRadius(4)
              .backgroundColor(this.isDark ? 'rgba(255,113,120,0.18)' : 'rgba(235,87,87,0.12)')
              .maxLines(1)
              .flexShrink(0)
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        if (this.entry.text.length > 0) {
          Text(this.entry.text)
            .fontSize(13)
            .lineHeight(19)
            .fontColor(this.secondaryText())
            .width('100%')
            .maxLines(8)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ left: 12, right: 12, top: 10, bottom: 10 })
      .borderRadius(this.rpx(16))
      .backgroundColor(this.isDark ? 'rgba(255,113,120,0.12)' : 'rgba(235,87,87,0.08)')
      .border({
        width: 1,
        color: this.isDark ? 'rgba(255,113,120,0.46)' : 'rgba(235,87,87,0.42)'
      })
      .margin({ top: 4, bottom: 2 })
    } else {
      Column({ space: 2 }) {
        Text(this.entry.title)
          .fontSize(11)
          .fontColor(this.secondaryText())
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
  }

  /**
   * AI 生成内容显式标识：每轮第一条助手侧行的顶部。
   * 回合组 / 过程行 / 正式回复都可能是这一行，所以挂在 build() 的最外层而不是只挂在回复行上。
   */
  @Builder
  aiBadge() {
    Row({ space: 5 }) {
      Text('AI')
        .fontSize(10)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
        .padding({ left: 5, right: 5, top: 1.5, bottom: 1.5 })
        .borderRadius(4)
        .backgroundColor(OCEAN)
      Text('生成内容，仅供参考')
        .fontSize(11)
        .lineHeight(15)
        .fontColor(this.tertiaryText())
    }
    .alignItems(VerticalAlign.Center)
    .margin({ bottom: 6 })
  }

  build() {
    Column() {
      if (this.entry.aiLabelVisible && this.aiLabelEnabled) {
        this.aiBadge()
      }
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
