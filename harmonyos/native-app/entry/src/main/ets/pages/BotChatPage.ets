/**
 * Bot 独立聊天页（对齐 dsh-mobile BotPrivateChatView + docs/bot-mode-ios-spec.md §4）。
 *
 * 顶部：原生标题栏（HdsNavDestination）—— 内容从标题栏下滚过时系统渐变模糊 + 沉浸光感材质，
 *       与工作模式会话页（ConversationPage）完全同一套；标题栏内是「玻璃返回圆钮 + 身份（头像/名字/
 *       副标题）+ 玻璃更多圆钮」三件套（按钮 36、图标与文字色同一套 navIcon 色）。
 * 正文：消息时间线（§4.3）—— 头像 28、头像与气泡间距 8、气泡内边距 14×12、圆角 20、
 *       内容最大宽 292（手机）/ 720（平板）、行间距 18；气泡下方 11pt 时间与发送状态；
 *       群聊发言者 12pt；活动行居中（文案 + 头像 18 + 名字）；实时工作行头像 28 +「· N 秒」。
 * 底部：待处理交互卡（提问 / 审批，时间线内 BotCard）+ 工作模式同款输入条：
 *       收起 / 展开都走 HdsGlassSurface 沉浸光感组件（系统液态玻璃材质 + 圆角），
 *       与工作模式会话页（ConversationPage / ConversationComposer）完全同一套。
 *       「+」菜单与工作模式一致：相册图片 / 本地文件（图片走 images base64，文件走 receipts 上传）。
 */
import {
  BOT_BG_DEFAULT, BotPalette, botPalette,
  BotAnswerChoice, BotChat, BotChatImage, BotChatMessage, BotInteraction,
  BotPresentedFile, BotQuestionAnswer, BotSnapshot, BotStore, emptyBotSnapshot,
  BotImageCache, GatewayClient, Logger, pickDocuments, pickImages, uploadAttachment, downloadAttachment,
  SpeechFailure, SpeechInput, buildSendImagePayload
} from 'nativecore';
import type { DownloadResult, PickedAttachment, SpeechLimits, UploadResult } from 'nativecore';
import { common } from '@kit.AbilityKit';
import { abilityAccessCtrl } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { fileIo, fileUri } from '@kit.CoreFileKit';
import { filePreview } from '@kit.PreviewKit';
import { pdfViewManager, PdfView } from '@kit.PDFKit';
import { util } from '@kit.ArkTS';
import { HdsNavDestination, HdsTitleBarContentStyle, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { KeyboardAvoidMode } from '@kit.ArkUI';
import { MarkdownBodyView } from '../components/MarkdownBodyView';
import { fileKindIcon, fileKindOf as botFileKindOf } from '../common/FileKind';
import { BotMessageImage } from '../components/BotMessageImage';
import { BotGroupAvatar, BotBubblePalette } from '../components/BotGroupAvatar';
import { BotRoleSheet } from '../components/BotRoleSheet';
import { immersiveSheetSupported, sheetFallbackColor, sheetSystemMaterial } from '../common/SheetMaterial';
import { NavBackButton } from '../components/NavBackButton';
import { VoiceRipplePanel } from '../components/VoiceRipplePanel';
import { HdsGlassSurface } from '../components/HdsGlassSurface';
import { currentGlassMaterialLevel } from '../common/GlassMaterial';
import { isWideWidth, wideSideInset } from '../common/Responsive';

/** 标题栏内容风格：滚动模糊生效时保持正文色标题（系统默认会切成白字） */
const TITLE_BAR_CONTENT: HdsTitleBarContentStyle = {
  titleStyle: { mainTitleColor: $r('sys.color.font_primary') },
  menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') }
};

// ==================== §8.4 关键尺寸 ====================

/** 消息头像 */
const MESSAGE_AVATAR: number = 28;
/** 头像与气泡间距 */
const MESSAGE_AVATAR_GAP: number = 8;
/** 气泡圆角 */
const BUBBLE_RADIUS: number = 20;
/** 气泡内边距（水平 / 垂直） */
const BUBBLE_PAD_H: number = 14;
const BUBBLE_PAD_V: number = 12;
/** 每条消息行底部间距 */
const MESSAGE_ROW_GAP: number = 18;
/** 助手行内容最大宽：手机 292 / 平板 720 */
const BUBBLE_MAX_COMPACT: number = 292;
const BUBBLE_MAX_WIDE: number = 720;
/** 原生标题栏高度（HdsNavDestination titleBar） */
const TITLE_BAR_HEIGHT: number = 56;
/**
 * 标题栏圆钮直径：与工作模式 ConversationPage.headerBtnSize(embedded) 取同一个 40
 * （HdsGlassSurface 的 HdsTabs 背板有最小尺寸，40 渲染出来约 45vp，与系统返回键同视觉大小）。
 */
const HEADER_BTN_SIZE: number = 40;
/** 输入条：左右留白 / 距屏幕底部 / 圆角 / 收起态胶囊高度 / 发送圆钮 */
const DOCK_SIDE: number = 14;
const DOCK_BOTTOM: number = 18;
const DOCK_RADIUS: number = 28;
const CAPSULE_RADIUS: number = 26;
const CAPSULE_HEIGHT: number = 52;
const SEND_SIZE: number = 34;
/** 展开态发送圆钮（工作模式 primaryButton 36） */
const SEND_EXPANDED_SIZE: number = 36;

const WEEK_LABELS: string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 随消息发送的图片载荷（网关 images[]：mediaType + base64 + 文件名） */
interface BotImagePayload {
  mediaType: string;
  data: string;
  name: string;
}

@Component
export struct BotChatPage {
  /** 正文字号档位：与工作模式对话页共用「设置 → 字号大小」 */
  @StorageProp('contentFontSize') contentFontSize: string = '标准';
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  /** 设置 → Bot 背景配色：对话卡片底色跟着它走 */
  @StorageLink('botBgTheme') botBgTheme: string = BOT_BG_DEFAULT;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onStateChanged') state: BotSnapshot = emptyBotSnapshot();

  /** 角色弹窗（就地弹出，不离开对话页） */
  @State roleSheetOpen: boolean = false;
  @State roleBotId: string = '';

  @State draft: string = '';
  @State sending: boolean = false;
  /** 发送开始时间：发图卡住时靠它解锁，避免后续点击全被吞 */
  private sendStartedAt: number = 0;
  @State picked: string[] = [];
  @State pickedFor: string = '';
  @State customAnswer: string = '';
  @State moreOpen: boolean = false;
  /** 输入条是否展开（聚焦或有草稿）：收起为玻璃胶囊、展开为磨砂卡片 */
  @State composerFocused: boolean = false;
  /** 输入区实测高度：时间线底部留白（内容滚到玻璃后面，对齐工作模式） */
  @State dockHeight: number = 96;
  /** 页面宽度（宽屏限宽 / 气泡最大宽） */
  @State pageW: number = 0;
  /** 实时工作行计时：每秒刷新一次（读它让该行随定时器重绘） */
  @State liveClock: number = 0;
  /** 「+」附件的已选图片（发送时转 base64 随消息发出） */
  @State pickedAttachments: PickedAttachment[] = [];
  /** 「+」菜单展开态 */
  @State attachMenuOpen: boolean = false;
  /** 输入框上方的轻提示（附件失败等） */
  @State hint: string = '';
  /** 正文图片/附件图片缓存代次：拉取完成后 +1 触发 Markdown 与图片块重绘 */
  @State imageRevision: number = 0;
  /** 交付文件里的图片：path → 本地缓存路径（imageRevision 变化时重绘） */
  private fileImagePaths: Map<string, string> = new Map<string, string>();
  private fileImageBusy: string[] = [];
  private fileImageFailures: string[] = [];
  /** 最近一条消息带的会话 id：Bot 聊天里 chat.sessionId 可能为空，交付文件下载需要它 */
  private fileSessionHint: string = '';
  /** 语音输入开关（设置页「语音输入」）与当前是否处于语音模式 */
  @StorageLink('voiceInputEnabled') voiceInputEnabled: boolean = true;
  @State voiceMode: boolean = false;
  @State voiceRecording: boolean = false;
  @State voiceCancelArmed: boolean = false;
  @State voiceStatus: string = '';
  @State voicePhase: string = 'idle';
  /** 边说边转的实时文字（录音中持续刷新，松手后作为最终结果兜底） */
  @State voiceLiveText: string = '';
  private voiceLiveTimer: number = -1;
  private voiceLiveBusy: boolean = false;
  /** 在途的「边说边转」请求：最终转写前必须等它结束，否则网关会因为「request busy」拒掉最终结果 */
  private voiceLiveInFlight: Promise<void> | null = null;
  private dictation: SpeechInput = new SpeechInput();
  private speechLimits: SpeechLimits | null = null;
  private voiceHoldToken: number = 0;
  private voiceHoldTimer: number = -1;
  private voiceStartX: number = 0;
  private voiceStartY: number = 0;
  private voiceHolding: boolean = false;
  private voiceArmedLocal: boolean = false;
  private voiceHoldConsumed: boolean = false;
  /**
   * 最近一次「点输入框展开」的时间戳。
   * 展开时键盘弹起会让时间线自动滚到底（scheduleScroll / scrollEdge），
   * 那也会触发 onScrollStart —— 之前没有这层保护，展开后立刻被当成「用户在滚动」收回胶囊，
   * 表现就是「点开了、键盘也弹了，但输入条还是胶囊没变化」。
   */
  private composerExpandedAt: number = 0;
  /** 图片大图预览（与工作模式同一套：底部玻璃 sheet + 双指缩放） */
  @State previewOpen: boolean = false;
  /** 交付文件预览弹窗（底部原生玻璃 sheet） */
  @State filePreviewOpen: boolean = false;
  @State filePreviewName: string = '';
  @State filePreviewLocalPath: string = '';
  @State filePreviewText: string = '';
  @State filePreviewSize: string = '';
  @State filePreviewLoading: boolean = false;
  @State filePreviewError: string = '';
  @State filePreviewIsImage: boolean = false;
  /** PDF 直接在底部弹窗里用 PDFKit 的 PdfView 渲染（可以嵌进任意容器，不必跳系统预览） */
  @State filePreviewIsPdf: boolean = false;
  private pdfController: pdfViewManager.PdfController = new pdfViewManager.PdfController();
  private filePreviewSource: BotPresentedFile | null = null;
  @State previewPath: string = '';
  @State previewZoom: number = 1;
  private previewZoomBase: number = 1;

  private scroller: Scroller = new Scroller();
  private lastTailKey: string = '';
  private liveTimer: number = -1;
  private hintTimer: number = -1;
  /** §8.7 气泡色板：按名册 id 排序稳定取色（状态变化时重建） */
  private palette: BotBubblePalette = new BotBubblePalette([], '');

  aboutToAppear(): void {
    this.rebuildImageIndex();
    BotStore.get().setForeground(true);
    this.rebuildPalette();
    this.liveClock = Date.now();
    this.ensureLiveTimer();
    this.scheduleScroll();
  }

  aboutToDisappear(): void {
    this.stopLiveTimer();
  }

  onStateChanged(): void {
    // 消息变化时重建「附件 id → 会话 id」索引，正文里的 /__bot_image__/ 才能解析
    this.rebuildImageIndex();
    // 记下最近一条消息的会话 id：Bot 聊天的 chat.sessionId 常为空，
    // 而交付文件的 file-resolve / file-download 必须带会话 id
    for (let i = this.state.messages.length - 1; i >= 0; i--) {
      const sid: string = this.state.messages[i].sessionId;
      if (sid.length > 0) {
        this.fileSessionHint = sid;
        break;
      }
    }
    const chatId: string = this.state.selectedChatId ?? '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId && interaction.kind === 'question' && interaction.id !== this.pickedFor) {
        this.pickedFor = interaction.id;
        this.picked = [];
        this.customAnswer = '';
      }
    }
    this.rebuildPalette();
    this.ensureLiveTimer();
    this.scheduleScroll();
  }

  private rebuildPalette(): void {
    this.palette = new BotBubblePalette(this.state.chats, this.state.mainBotId ?? '');
  }

  private stopLiveTimer(): void {
    if (this.liveTimer >= 0) {
      clearInterval(this.liveTimer);
      this.liveTimer = -1;
    }
  }

  /** 有实时工作才开秒表，避免空转重绘 */
  private ensureLiveTimer(): void {
    const exists: boolean = this.liveStartedAtMs() > 0;
    if (exists && this.liveTimer < 0) {
      this.liveClock = Date.now();
      this.liveTimer = setInterval(() => {
        this.liveClock = Date.now();
      }, 1000);
    } else if (!exists) {
      this.stopLiveTimer();
    }
  }

  /** 末条消息 / 交互变化才滚底（流式增量也跟随） */
  private scheduleScroll(): void {
    const messages: BotChatMessage[] = this.state.messages;
    let tail: string = messages.length === 0 ? '' : messages[messages.length - 1].id
      + ':' + messages[messages.length - 1].text.length.toString();
    tail = tail + '#' + this.interactionKey();
    if (tail === this.lastTailKey) {
      return;
    }
    this.lastTailKey = tail;
    setTimeout(() => {
      try {
        this.scroller.scrollEdge(Edge.Bottom);
      } catch (error) {
      }
    }, 30);
  }

  private interactionKey(): string {
    const chatId: string = this.state.selectedChatId ?? '';
    let key: string = '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId) {
        key = key + interaction.id + ',';
      }
    }
    return key;
  }

  private chat(): BotChat | null {
    const id: string = this.state.selectedChatId ?? '';
    for (const chat of this.state.chats) {
      if (chat.id === id) {
        return chat;
      }
    }
    return null;
  }

  private pendingQuestion(): BotInteraction | null {
    const chatId: string = this.state.selectedChatId ?? '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId && interaction.kind === 'question') {
        return interaction;
      }
    }
    return null;
  }

  private pendingApproval(): BotInteraction | null {
    const chatId: string = this.state.selectedChatId ?? '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId && interaction.kind === 'approval') {
        return interaction;
      }
    }
    return null;
  }

  // ==================== 主题（§8.1 Bot token） ====================

  private ink(): string {
    return this.isDark ? '#F2EEF6' : '#252332';
  }

  private subColor(): string {
    return this.isDark ? '#D8D2E1' : '#5C536C';
  }

  private pageBg(): string {
    // 与工作模式对话页（ConversationPage.pageBg）完全一致：深色纯黑 / 浅色浅灰。
    // 之前用 BotLavender 浅紫，HDS 沉浸玻璃会把它「染色」到输入框、返回键与「⋯」上，
    // 换成中性底色后玻璃恢复成工作模式那种干净的白/灰。
    return this.isDark ? '#000000' : '#F2F2F4';
  }

  /** Bot 背景配色（设置 → Bot 背景配色），深/浅各一套 */
  private themePalette(): BotPalette {
    return botPalette(this.botBgTheme);
  }

  /** 卡片底（提问 / 审批 / 已答卡片）：跟随 Bot 背景配色（半透明主题色，深浅各一档） */
  private cardColor(): string {
    const palette: BotPalette = this.themePalette();
    return this.isDark ? palette.veilDark + '0.82)' : palette.veil + '0.92)';
  }

  private lineColor(): string {
    return this.isDark ? '#484354' : '#DAD6E3';
  }

  /** 用户气泡：浅 #E8EFFC / 深 #2A3D57 */
  private userBubble(): string {
    return this.isDark ? '#2A3D57' : '#E8EFFC';
  }

  private botBlue(): string {
    return this.isDark ? '#A1BFF6' : '#2E6BE6';
  }

  /** 顶栏图标色：与工作模式 navIconColor 同一套（深色近白 / 浅色近墨） */
  private navIconColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.92)' : 'rgba(16,19,24,0.88)';
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  /** 时间线可视区底边 = 输入框卡片底边（距屏幕底部）：正文滑到这里就消失，与工作模式一致 */
  private timelineClipBottom(): number {
    return DOCK_BOTTOM + this.safeBottom;
  }


  private wideInset(): number {
    return wideSideInset(this.pageW);
  }

  /** 助手行内容最大宽（§8.4：手机 292 / 平板 720） */
  private bubbleMaxWidth(): number {
    return isWideWidth(this.pageW) ? BUBBLE_MAX_WIDE : BUBBLE_MAX_COMPACT;
  }

  // ==================== 消息判定 ====================

  /** 会话正文字号（vp）：与工作模式 ConversationRowView.contentSize 完全一致 */
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

  private isMine(message: BotChatMessage): boolean {
    return message.kind === 'user';
  }

  private isStreaming(message: BotChatMessage): boolean {
    return message.streaming === true || message.kind === 'stream';
  }

  /** §4.3(7) 活动行：成员动态（已创建 / 已发消息给） */
  private isActivity(message: BotChatMessage): boolean {
    const activity: string | undefined = message.activity;
    return activity !== undefined && activity.length > 0;
  }

  /**
   * 是否是「一行纯文本」（没有 Markdown 块/行内标记）。
   * 纯文本走 Text 渲染：可以按内容自然收缩；含标记的走 MarkdownBodyView（容器固定宽度换行）。
   */
  private isPlainText(text: string): boolean {
    if (text.indexOf('\n') >= 0) {
      return false;
    }
    const markers: string[] = ['**', '`', '~~', '](', '# ', '> ', '- ', '* ', '|', '1. '];
    for (const marker of markers) {
      if (text.indexOf(marker) >= 0) {
        return false;
      }
    }
    return true;
  }

  /** 群聊里非自己且带名字时显示发言者 */
  private showSpeaker(message: BotChatMessage): boolean {
    const chat: BotChat | null = this.chat();
    return chat !== null && chat.room && !this.isMine(message) && !this.isActivity(message)
      && message.name.length > 0;
  }

  /** 头像：群聊按 message.botId 取名册成员，未知/私聊回落当前聊天 */
  private faceChat(message: BotChatMessage): BotChat | null {
    const id: string | undefined = message.botId;
    if (id !== undefined && id.length > 0) {
      for (const chat of this.state.chats) {
        if (chat.id === id) {
          return chat;
        }
      }
    }
    return this.chat();
  }

  private hasImage(chat: BotChat): boolean {
    const image: string | undefined = chat.image;
    return image !== undefined && image.length > 0;
  }

  private imageOf(chat: BotChat): string {
    const image: string | undefined = chat.image;
    return image === undefined ? '' : image;
  }

  private firstChar(chat: BotChat): string {
    return chat.name.length > 0 ? chat.name.substring(0, 1) : 'B';
  }

  private isMainBot(chat: BotChat): boolean {
    return chat.id === (this.state.mainBotId ?? '');
  }

  // ==================== 时间 / 发送状态（§4.3 通用） ====================

  private two(value: number): string {
    return value < 10 ? '0' + value.toString() : value.toString();
  }

  private timeLabel(message: BotChatMessage): string {
    const ms: number | undefined = message.timeMs;
    if (ms === undefined || ms <= 0) {
      return '';
    }
    if (message.kind !== 'user' && message.kind !== 'bot' && message.kind !== 'post') {
      return '';
    }
    const date: Date = new Date(ms);
    const now: Date = new Date();
    const clock: string = this.two(date.getHours()) + ':' + this.two(date.getMinutes());
    const week: string = WEEK_LABELS[date.getDay()];
    const sameDay: boolean = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
    if (sameDay) {
      return week + ' ' + clock;
    }
    return (date.getMonth() + 1).toString() + '月' + date.getDate().toString() + '日 ' + week + ' ' + clock;
  }

  private deliveryLabel(message: BotChatMessage): string {
    if (!this.isMine(message)) {
      return '';
    }
    const delivery: string = message.delivery ?? '';
    if (delivery === 'sending') {
      return '发送中';
    }
    if (delivery === 'sent') {
      return '已发送';
    }
    if (delivery === 'unknown') {
      return '发送状态待确认，请同步聊天后核对';
    }
    return '';
  }

  // ==================== 实时工作行（§4.3(10)） ====================

  private liveKind(): string {
    const chatId: string = this.state.selectedChatId ?? '';
    const work = this.state.liveWork[chatId];
    return work === undefined ? '' : work.kind;
  }

  private liveStartedAtMs(): number {
    const chatId: string = this.state.selectedChatId ?? '';
    const work = this.state.liveWork[chatId];
    if (work === undefined || work.startedAtMs === undefined) {
      return 0;
    }
    return work.startedAtMs;
  }

  private liveSeconds(): number {
    const started: number = this.liveStartedAtMs();
    if (started <= 0) {
      return 0;
    }
    const elapsed: number = Math.floor((this.liveClock - started) / 1000);
    return elapsed > 0 ? elapsed : 0;
  }

  private liveText(): string {
    const kind: string = this.liveKind();
    if (kind === 'web-search') {
      return '上网搜索…';
    }
    if (kind === 'web-read') {
      return '正在浏览网页…';
    }
    if (kind === 'image') {
      return '正在生成图片…';
    }
    if (kind === 'switching-folder') {
      return '正在切换工作文件夹…';
    }
    if (kind === 'thinking') {
      return '正在思考…';
    }
    return '正在处理…';
  }

  /** 显示条件：有实时工作；同一聊天有提问/审批卡时不显示；thinking 且末条在流式时不显示 */
  private showLiveWork(): boolean {
    if (this.liveKind().length === 0) {
      return false;
    }
    if (this.pendingQuestion() !== null || this.pendingApproval() !== null) {
      return false;
    }
    const messages: BotChatMessage[] = this.state.messages;
    if (this.liveKind() === 'thinking' && messages.length > 0) {
      return !this.isStreaming(messages[messages.length - 1]);
    }
    return true;
  }

  // ==================== 输入 / 交互动作 ====================

  private placeholderText(): string {
    const chat: BotChat | null = this.chat();
    if (chat === null) {
      return '描述你想要构建的内容';
    }
    return chat.room ? '发消息到群聊…' : '发消息给 ' + chat.name + '…';
  }

  private canSend(): boolean {
    return (this.draft.trim().length > 0 || this.pickedAttachments.length > 0) && !this.sending;
  }

  /** 发送：图片走 images(base64)，其余文件走 receipts 上传（与工作模式同一条链路） */
  private onSend(): void {
    const text: string = this.draft.trim();
    const selected: PickedAttachment[] = this.pickedAttachments.slice();
    if ((text.length === 0 && selected.length === 0) || this.sending) {
      return;
    }
    // 上一次卡死（超过 60s）先解锁，否则点发送永远没反应
    if (this.sending && this.sendStartedAt > 0 && Date.now() - this.sendStartedAt > 60000) {
      this.sending = false;
      this.sendStartedAt = 0;
    }
    this.sending = true;
    this.sendStartedAt = Date.now();
    this.sendWithAttachments(text, selected).then((ok: boolean) => {
      this.sending = false;
      this.sendStartedAt = 0;
      if (ok) {
        this.draft = '';
        this.pickedAttachments = [];
        this.composerFocused = false;
        this.hint = '';
      } else {
        // 发送被拒/超时也要可见，不能静默变成"点了没反应"
        this.showHint('发送失败：请检查连接后重试');
      }
    }).catch((error: Error) => {
      this.sending = false;
      this.sendStartedAt = 0;
      this.showHint('发送失败：' + error.message);
    });
  }

  private async sendWithAttachments(text: string, selected: PickedAttachment[]): Promise<boolean> {
    const images: Object[] = [];
    const files: PickedAttachment[] = [];
    for (const attachment of selected) {
      if (this.isImageAttachment(attachment.name)) {
        // 与工作模式同一条管线：HEIC/BMP/超大图先转 JPEG，避免网关按 mediaType 拒绝
        this.showHint('正在处理图片 ' + attachment.name);
        const payload: Object | undefined = await this.imagePayloadWithTimeout(attachment);
        if (payload !== undefined) {
          images.push(payload);
          continue;
        }
        throw new Error('图片处理失败：' + attachment.name);
      }
      files.push(attachment);
    }
    const receipts: string[] = [];
    if (files.length > 0) {
      // 文件必须先传到主机换 receiptId（bot 协议 send-attachments 的 receipts[]）
      const chat: BotChat | null = this.chat();
      const sessionId: string = chat === null ? '' : (chat.sessionId ?? '');
      if (sessionId.length === 0) {
        throw new Error('当前聊天没有官方会话，暂不能发送文件');
      }
      const client: GatewayClient = GatewayClient.get();
      if (!client.isConnected()) {
        throw new Error('未连接主机，暂不能发送文件');
      }
      for (const attachment of files) {
        this.showHint('正在上传 ' + attachment.name);
        const result: UploadResult = await uploadAttachment(client, sessionId, attachment);
        receipts.push(result.receiptId);
      }
    }
    return BotStore.get().sendMessage(text, images, receipts);
  }



  // ==================== 长按语音输入（与工作模式对话页同一套 SpeechInput 链路） ====================

  private clearVoiceTimer(): void {
    if (this.voiceHoldTimer >= 0) {
      clearTimeout(this.voiceHoldTimer);
      this.voiceHoldTimer = -1;
    }
  }

  /** 折叠态占位区/展开态「按住说话」统一的触摸处理：按住 350ms 起录、上滑 64 取消、松手转文字 */
  private onVoiceTouch(event: TouchEvent): void {
    if (!this.voiceInputEnabled) {
      return;
    }
    let touch: TouchObject | undefined = undefined;
    if (event.touches.length > 0) {
      touch = event.touches[0];
    } else if (event.changedTouches.length > 0) {
      touch = event.changedTouches[0];
    }
    if (touch === undefined) {
      return;
    }
    if (event.type === TouchType.Down) {
      this.voiceStartX = touch.x;
      this.voiceStartY = touch.y;
      this.voiceHolding = false;
      this.voiceArmedLocal = false;
      this.clearVoiceTimer();
      this.voiceHoldTimer = setTimeout(() => {
        this.voiceHoldTimer = -1;
        this.voiceHolding = true;
        this.voiceHoldConsumed = true;
        this.onVoiceHoldStart();
      }, 350);
      return;
    }
    if (event.type === TouchType.Move) {
      const dy: number = touch.y - this.voiceStartY;
      const dx: number = touch.x - this.voiceStartX;
      if (!this.voiceHolding) {
        if (Math.abs(dy) > 12 || Math.abs(dx) > 12) {
          this.clearVoiceTimer();
        }
        return;
      }
      const cancel: boolean = dy < -64;
      if (cancel !== this.voiceArmedLocal) {
        this.voiceArmedLocal = cancel;
        this.onVoiceHoldMove(cancel);
      }
      return;
    }
    if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
      this.clearVoiceTimer();
      if (this.voiceHolding) {
        this.voiceHolding = false;
        const cancel: boolean = this.voiceArmedLocal || (event.type === TouchType.Cancel)
          || (touch.y - this.voiceStartY < -64);
        this.onVoiceHoldEnd(cancel);
        return;
      }
      // 轻点：文字态展开输入（与工作模式一致）
      if (!this.voiceMode) {
        this.focusComposer();
      }
    }
  }

  private setVoicePhase(phase: string): void {
    this.voicePhase = phase;
    // 「转写中」也要让浮层留着（显示「正在识别…」），所以 recording 只覆盖前三个阶段
    this.voiceRecording = phase === 'authorizing' || phase === 'starting' || phase === 'recording';
    if (this.voiceCancelArmed) {
      this.voiceStatus = '松手取消';
    } else if (phase === 'authorizing') {
      this.voiceStatus = '正在获取麦克风权限';
    } else if (phase === 'starting') {
      this.voiceStatus = '正在开启麦克风';
    } else if (phase === 'recording') {
      this.voiceStatus = '松手转文字 · 上滑取消';
    } else if (phase === 'transcribing') {
      this.voiceStatus = '正在转文字…';
    } else {
      this.voiceStatus = '';
    }
  }

  private resetVoice(): void {
    this.stopLiveTranscribe();
    this.speechLimits = null;
    this.voiceCancelArmed = false;
    this.setVoicePhase('idle');
    // 录音/识别结束后回到文字输入态，保证识别出来的字能立刻看见、可以直接发
    if (this.draft.trim().length > 0) {
      this.voiceMode = false;
      this.composerFocused = true;
    }
  }

  /** 只在按住时申请一次麦克风权限（已授权时系统直接返回，不反复弹窗） */
  private async requestMicPermission(): Promise<boolean> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(context, ['ohos.permission.MICROPHONE']);
      if (result.authResults.length === 0) {
        return false;
      }
      return result.authResults[0] === 0;
    } catch (err) {
      return false;
    }
  }

  private async onVoiceHoldStart(): Promise<void> {
    if (this.voicePhase !== 'idle') {
      return;
    }
    const token: number = ++this.voiceHoldToken;
    this.voiceCancelArmed = false;
    this.speechLimits = null;
    this.setVoicePhase('authorizing');
    try {
      const limits: SpeechLimits = await this.dictation.catalog();
      if (token !== this.voiceHoldToken) {
        this.resetVoice();
        return;
      }
      this.speechLimits = limits;
      Logger.info('BOT_VOICE catalog provider=' + limits.providerId + ' lang=' + limits.language
        + ' maxBytes=' + limits.maxBytes.toString());
      const granted: boolean = await this.requestMicPermission();
      Logger.info('BOT_VOICE mic granted=' + (granted ? '1' : '0'));
      if (token !== this.voiceHoldToken) {
        if (granted) {
          this.showHint('麦克风已授权，按住输入框再说一次');
        }
        this.resetVoice();
        return;
      }
      if (!granted) {
        throw new SpeechFailure('voice/permission', SpeechFailure.messageFor('voice/permission'));
      }
      this.setVoicePhase('starting');
      await this.dictation.start(limits, (message: string) => {
        Logger.warn('BOT_VOICE capture error: ' + message);
        this.resetVoice();
      });
      if (token !== this.voiceHoldToken) {
        this.dictation.cancel();
        this.resetVoice();
        return;
      }
      this.setVoicePhase('recording');
      this.startLiveTranscribe();
      Logger.info('BOT_VOICE recording started');
    } catch (err) {
      Logger.warn('BOT_VOICE start failed: ' + (err instanceof Error ? err.message : String(err)));
      this.failVoice(err);
    }
  }

  private onVoiceHoldMove(cancel: boolean): void {
    if (this.voiceCancelArmed === cancel) {
      return;
    }
    this.voiceCancelArmed = cancel;
    if (!this.voiceRecording) {
      return;
    }
    this.voiceStatus = cancel ? '松手取消' : '松手转文字 · 上滑取消';
  }

  private onVoiceHoldEnd(cancel: boolean): void {
    this.voiceHoldToken++;
    this.voiceCancelArmed = false;
    if (cancel) {
      this.dictation.cancel();
      this.resetVoice();
      return;
    }
    const limits: SpeechLimits | null = this.speechLimits;
    if (this.voicePhase !== 'recording' || limits === null) {
      if (this.dictation.isActive()) {
        this.dictation.cancel();
      }
      this.resetVoice();
      // 松手太快（还没进入 recording）时也要给用户明确反馈，而不是静默什么都不发生
      if (!this.voiceHoldConsumed) {
        this.showHint('说话时间太短，按住再说话');
      }
      this.voiceHoldConsumed = false;
      return;
    }
    this.stopLiveTranscribe();
    this.setVoicePhase('transcribing');
    Logger.info('BOT_VOICE hold end, transcribing');
    // 先等在途的中间转写结束，再发最终转写，避免 request busy 把最终结果吞掉
    this.waitLiveIdle().then(() => {
      return this.dictation.stopAndTranscribe(limits);
    }).then((text: string) => {
      Logger.info('BOT_VOICE transcript len=' + text.length.toString() + ' text=' + text.substring(0, 60));
      // 最终结果为空时用「边说边转」的最后一次中间结果兜底，避免松手太快时丢字
      const finalText: string = text.trim().length > 0 ? text : this.voiceLiveText;
      this.voiceLiveText = '';
      this.insertVoiceText(finalText);
      this.resetVoice();
    }).catch((err: Object) => {
      Logger.warn('BOT_VOICE transcribe failed: ' + (err instanceof Error ? err.message : String(err)));
      // 最终转写失败时，只要边说边转已经拿到文字，就直接用它，不要丢掉用户说的话
      if (this.voiceLiveText.trim().length > 0) {
        const fallback: string = this.voiceLiveText;
        this.voiceLiveText = '';
        this.insertVoiceText(fallback);
        this.resetVoice();
        return;
      }
      this.failVoice(err);
    });
  }

  private failVoice(err: Object): void {
    this.resetVoice();
    // 失败后退出语音态，回到键盘输入，避免用户「说完了但界面没反应」
    this.voiceMode = false;
    const failure: SpeechFailure | null = err instanceof SpeechFailure ? err : null;
    const message: string = failure !== null
      ? failure.message
      : (err instanceof Error ? err.message : SpeechFailure.messageFor(''));
    this.showHint(message);
    // 同时弹一次 toast：输入框上方的提示容易被忽略，语音失败必须让用户看到
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 3000 });
    } catch (ignored) {
    }
  }

  private insertVoiceText(text: string): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    // 识别结果直接写进草稿并退出语音态（输入框重新显示，用户能立刻看到文字）
    this.draft = this.draft + trimmed;
    this.voiceMode = false;
    this.composerFocused = true;
  }

  private toggleVoiceMode(): void {
    this.voiceMode = !this.voiceMode;
    if (this.voiceMode) {
      try {
        this.getUIContext().getFocusController().clearFocus();
      } catch (ignored) {
      }
    } else {
      this.focusComposer();
    }
  }

  // ==================== 图片预览 / 文件卡（对齐工作模式 + iOS FileReferenceCard） ====================

  /** 可复制（有正文；用户与助手气泡都有，对齐工作模式 user/assistant 行都有复制） */
  private canCopyMessage(message: BotChatMessage): boolean {
    return message.text.trim().length > 0;
  }

  /** 只有助手回复才给「引用」（对齐工作模式：引用只出现在助手回复页脚） */
  private canQuoteMessage(message: BotChatMessage): boolean {
    return !this.isMine(message) && message.text.trim().length > 0;
  }

  private copyMessageText(message: BotChatMessage): void {
    const text: string = message.text;
    if (text.trim().length === 0) {
      return;
    }
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        this.getUIContext().getPromptAction().showToast({ message: '已复制' });
      }).catch(() => {
        this.showHint('复制失败');
      });
    } catch (error) {
      this.showHint('复制失败');
    }
  }

  /** 引用回复：把引文拼进草稿并展开输入条（同工作模式 quoteReply） */
  private quoteMessageText(message: BotChatMessage): void {
    const raw: string = message.text.trim();
    if (raw.length === 0) {
      return;
    }
    let preview: string = '';
    const lines: string[] = raw.split(String.fromCharCode(10));
    for (const line of lines) {
      const trimmed: string = line.trim();
      if (trimmed.length > 0) {
        preview = trimmed;
        break;
      }
    }
    if (preview.length > 24) {
      preview = preview.substring(0, 24) + '...';
    }
    this.draft = this.draft + String.fromCharCode(10) + '> ' + raw + String.fromCharCode(10);
    this.composerFocused = true;
    this.voiceMode = false;
    if (preview.length > 0) {
      this.showHint('已引用：' + preview);
    }
  }

  /** attachmentId → sessionId（Markdown 正文里 /__bot_image__/<id> 需要它才能拉图） */
  private botImageIndex: Map<string, string> = new Map<string, string>();

  private rebuildImageIndex(): void {
    this.botImageIndex.clear();
    for (const message of this.state.messages) {
      for (const image of message.images) {
        this.botImageIndex.set(image.attachmentId, image.sessionId);
      }
    }
  }

  /**
   * 正文里 ![](/__bot_image__/<attachmentId>) / ![](/__bot_image__/<id>/<name>) 的图片：
   * 解析成 BotImageCache 的本地路径；尚未缓存时后台拉取，拉完用 imageRevision 触发重绘。
   * 这样助手回复正文里的图片会**直接显示成图片预览**（可点开大图），而不是留一行裸路径。
   */
  private resolveBotImage(src: string): string {
    const marker: string = '/__bot_image__/';
    const at: number = src.indexOf(marker);
    if (at < 0) {
      return '';
    }
    let rest: string = src.substring(at + marker.length);
    const cut: number = rest.indexOf('/');
    if (cut >= 0) {
      rest = rest.substring(0, cut);
    }
    const attachmentId: string = rest.trim();
    if (attachmentId.length === 0) {
      return '';
    }
    const sessionId: string = this.botImageIndex.get(attachmentId) ?? '';
    if (sessionId.length === 0) {
      return '';
    }
    const key: string = sessionId + ':' + attachmentId;
    const cached: string = BotImageCache.get().cachedPath(key);
    if (cached.length > 0) {
      return cached;
    }
    BotImageCache.get().load(key, this.state.selectedChatId ?? '', sessionId, attachmentId, 'image/png',
      (ready: string) => {
        this.imageRevision += 1;
      });
    return '';
  }

  /** 单图/多图的自适应尺寸：按图片宽高比给接近 iOS 的预览大小 */
  private imageBoxWidth(image: BotChatImage, single: boolean): number {
    const maxWidth: number = Math.min(this.bubbleMaxWidth(), 292);
    if (!single) {
      return Math.round((maxWidth - 6) / 2);
    }
    return maxWidth;
  }

  private imageBoxHeight(image: BotChatImage, single: boolean): number {
    const width: number = this.imageBoxWidth(image, single);
    const ratio: number = image.width > 0 && image.height > 0 ? image.height / image.width : 0.75;
    const height: number = Math.round(width * ratio);
    return Math.max(80, Math.min(height, 360));
  }

  /** 交付文件里那些「其实是图片」的（png/jpg/...）：下载后直接当图片预览，不再显示文件卡 */
  private isImageFile(name: string): boolean {
    const ext: string = this.fileExtension(name);
    return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif'
      || ext === 'webp' || ext === 'bmp' || ext === 'heic';
  }

  /** 交付图片是否已尝试过且失败（用于显示「点击重试」，避免一直转圈） */
  private fileImageFailed(file: BotPresentedFile): boolean {
    return this.fileImageFailures.indexOf(file.path) >= 0;
  }

  /** 会话 id 兜底顺序：消息自带 → 页面缓存 → 当前会话 */
  private sessionIdForFiles(hint: string): string {
    if (hint.length > 0) {
      return hint;
    }
    if (this.fileSessionHint.length > 0) {
      return this.fileSessionHint;
    }
    const chat: BotChat | null = this.chat();
    return chat !== null && chat.sessionId !== undefined ? chat.sessionId : '';
  }

  private retryFileImage(file: BotPresentedFile): void {
    const at: number = this.fileImageFailures.indexOf(file.path);
    if (at >= 0) {
      this.fileImageFailures.splice(at, 1);
    }
    const busyAt: number = this.fileImageBusy.indexOf(file.path);
    if (busyAt >= 0) {
      this.fileImageBusy.splice(busyAt, 1);
    }
    this.imageRevision += 1;
  }

  /**
   * 交付图片的本地路径。sessionId 优先用消息自带的（Bot 聊天里 chat.sessionId 可能为空，
   * 之前就是因为取不到会话 id 直接 return，图片永远停在「加载中」）。
   */
  private fileImagePath(file: BotPresentedFile, sessionIdHint: string): string {
    const key: string = file.path;
    const cached: string = this.fileImagePaths.get(key) ?? '';
    if (cached.length > 0) {
      return cached;
    }
    if (this.fileImageBusy.indexOf(key) >= 0 || this.fileImageFailures.indexOf(key) >= 0) {
      return '';
    }
    const sessionId: string = this.sessionIdForFiles(sessionIdHint);
    if (sessionId.length === 0) {
      this.fileImageFailures.push(key);
      this.imageRevision += 1;
      Logger.warn('BOT_FILE no sessionId for ' + file.path);
      return '';
    }
    const context = getContext(this) as common.UIAbilityContext;
    if (context === undefined) {
      return '';
    }
    this.fileImageBusy.push(key);
    // 交付文件给的是主机上的**绝对路径**，而 file-download-open 只接受工作区相对路径：
    // 先用 file-resolve 解析出相对路径，再分块下载。
    const client: GatewayClient = GatewayClient.get();
    Logger.info('BOT_FILE resolve ' + file.path);
    client.resolveFile(sessionId, file.path).then((resolved) => {
      const rel: string = resolved.path !== undefined ? String(resolved.path) : '';
      if (rel.length === 0) {
        throw new Error('empty resolved path');
      }
      return downloadAttachment(context, client, sessionId, rel);
    }).then((result: DownloadResult) => {
      Logger.info('BOT_FILE downloaded ' + result.localPath);
      this.fileImagePaths.set(key, result.localPath);
      this.imageRevision += 1;
    }).catch((error: Error) => {
      Logger.warn('BOT_FILE failed: ' + (error instanceof Error ? error.message : String(error)));
      this.fileImageFailures.push(key);
      this.imageRevision += 1;
    });
    return '';
  }

  /** 交付图片的展示尺寸：单图铺满气泡宽、多图两列（与附件图片同一套） */
  @Builder
  fileImageCard(file: BotPresentedFile, single: boolean, sessionIdHint: string) {
    Stack({ alignContent: Alignment.Center }) {
      if (this.fileImagePath(file, sessionIdHint).length > 0) {
        Image(this.fileUri(this.fileImagePath(file, sessionIdHint)))
          .width('100%')
          .height(single ? 220 : 140)
          .objectFit(ImageFit.Cover)
          .borderRadius(12)
      } else if (this.fileImageFailed(file)) {
        // 失败不再一直转圈：给明确状态，点一下重试
        Column({ space: 6 }) {
          Text('图片加载失败')
            .fontSize(13)
            .fontColor(this.subColor())
          Text('点击重试')
            .fontSize(13)
            .fontColor(this.botBlue())
        }
        .width('100%')
        .height(single ? 180 : 120)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)')
        .borderRadius(12)
      } else {
        Row({ space: 8 }) {
          LoadingProgress()
            .width(16)
            .height(16)
            .color(this.subColor())
          Text('图片加载中…')
            .fontSize(13)
            .fontColor(this.subColor())
        }
        .width('100%')
        .height(single ? 180 : 120)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)')
        .borderRadius(12)
      }
    }
    .width(single ? '100%' : '48%')
    .margin({ bottom: 8 })
    .onClick(() => {
      const ready: string = this.fileImagePath(file, sessionIdHint);
      if (ready.length > 0) {
        // 点击打开底部玻璃弹窗大图预览
        this.openImagePreview(this.fileUri(ready));
        return;
      }
      if (this.fileImageFailed(file)) {
        this.retryFileImage(file);
        return;
      }
      this.showHint('图片还在加载，请稍候');
    })
  }

  /**
   * ArkUI 的 Image 只认 file:// 前缀的本地文件：
   * downloadAttachment 返回的是裸绝对路径（/data/storage/...），
   * 直接丢给 Image 会「什么都看不到」，这里统一补前缀。
   */
  private fileUri(path: string): string {
    if (path.length === 0) {
      return '';
    }
    return path.startsWith('file://') ? path : 'file://' + path;
  }

  private openImagePreview(path: string): void {
    Logger.info('[BotPreview] tap pathLen=' + path.length.toString());
    if (path.length === 0) {
      return;
    }
    this.previewPath = this.fileUri(path);
    this.previewZoom = 1;
    this.previewZoomBase = 1;
    this.previewOpen = true;
  }

  /** 大图 + 双指缩放（1~4 倍，松手保持）—— 与工作模式 zoomablePreviewImage 同一套 */
  @Builder
  zoomablePreviewImage(path: string) {
    if (path.length > 0) {
      Image(path)
        .width('100%')
        .layoutWeight(1)
        .objectFit(ImageFit.Contain)
        .margin({ bottom: 12 })
        .scale({ x: this.previewZoom, y: this.previewZoom })
        .gesture(
          PinchGesture({ fingers: 2 })
            .onActionStart(() => {
              this.previewZoomBase = this.previewZoom;
            })
            .onActionUpdate((event: GestureEvent) => {
              const next: number = this.previewZoomBase * event.scale;
              this.previewZoom = next < 1 ? 1 : (next > 4 ? 4 : next);
            })
        )
    }
  }

  /** 图片预览弹窗内容（底部玻璃 sheet，下拉/点空白关闭，与工作模式同构） */
  @Builder
  imagePreviewSheet() {
    Column() {
      Row() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.30)' : 'rgba(16,19,24,0.18)')
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 8, bottom: 6 })

      this.zoomablePreviewImage(this.previewPath)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 12, right: 12, top: 4, bottom: 8 })
    .backgroundColor(Color.Transparent)
  }

  private fileExtension(name: string): string {
    const normalized: string = name.replace(/\\/g, '/');
    const base: string = normalized.substring(normalized.lastIndexOf('/') + 1).toLowerCase();
    const dot: number = base.lastIndexOf('.');
    return dot >= 0 ? base.substring(dot + 1) : '';
  }

  private fileNameOf(file: BotPresentedFile): string {
    const normalized: string = file.name.length > 0 ? file.name : file.path;
    const base: string = normalized.replace(/\\/g, '/');
    const at: number = base.lastIndexOf('/');
    return at >= 0 ? base.substring(at + 1) : base;
  }

  /** 文件类型主色（对齐 iOS FileIconKind.colorRgb，按扩展名分组） */
  private fileTint(kind: string): string {
    if (kind === 'pdf') return '#D92D20';
    if (kind === 'document') return '#155EEF';
    if (kind === 'sheet') return '#079455';
    if (kind === 'slides') return '#E62E05';
    if (kind === 'code') return '#444CE7';
    if (kind === 'image') return '#7F56D9';
    if (kind === 'media') return '#DD2590';
    if (kind === 'video') return '#155EEF';
    return '#344054';
  }

  /** 扩展名 → 图标分组（对齐 shared FileIconKind 的映射口径） */
  private fileKindOf(name: string): string {
    const ext: string = this.fileExtension(name);
    if (ext === 'pdf') return 'pdf';
    if (ext === 'doc' || ext === 'docx' || ext === 'odt' || ext === 'epub' || ext === 'rtf') return 'document';
    if (ext === 'xls' || ext === 'xlsx' || ext === 'csv' || ext === 'tsv' || ext === 'ods') return 'sheet';
    if (ext === 'ppt' || ext === 'pptx' || ext === 'odp') return 'slides';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg') return 'image';
    if (ext === 'mp3' || ext === 'wav' || ext === 'm4a') return 'media';
    if (ext === 'mp4' || ext === 'mov' || ext === 'mkv') return 'video';
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') return 'text';
    const code: string[] = ['c', 'cpp', 'h', 'hpp', 'cs', 'java', 'kt', 'swift', 'py', 'js', 'jsx', 'ts', 'tsx',
      'html', 'css', 'scss', 'vue', 'svelte', 'go', 'rs', 'dart', 'rb', 'php', 'sh', 'ps1', 'sql', 'json',
      'yaml', 'yml', 'xml', 'toml', 'ini', 'conf', 'env', 'gradle', 'cmake', 'make', 'bat'];
    if (code.indexOf(ext) >= 0) return 'code';
    if (ext === 'zip' || ext === 'rar' || ext === '7z') return 'archive';
    if (ext === 'apk' || ext === 'ipa') return 'package';
    return 'unknown';
  }

  /** 文件卡背景色：主色 8%（浅色）/16%（深色）与白/近黑表面混色（对齐 iOS cardBackgroundRgb） */
  private fileCardBg(kind: string): string {
    const tint: string = this.fileTint(kind);
    const amount: number = this.isDark ? 0.16 : 0.08;
    const surface: number[] = this.isDark ? [28, 28, 30] : [255, 255, 255];
    const value: number = parseInt(tint.substring(1), 16);
    const red: number = Math.round(((value >> 16) & 255) * amount + surface[0] * (1 - amount));
    const green: number = Math.round(((value >> 8) & 255) * amount + surface[1] * (1 - amount));
    const blue: number = Math.round((value & 255) * amount + surface[2] * (1 - amount));
    return 'rgb(' + red.toString() + ',' + green.toString() + ',' + blue.toString() + ')';
  }

  /**
   * 文件卡左侧彩色图标（对齐 dsh-mobile 安卓端截图）：
   * 该类型主色填充的圆角方块 + 白色大写扩展名文字（DOCX / PNG / PDF …）。
   */
  /**
   * 文件图标：和工作模式共用现成的 Untitled UI 文件图标（ficon_*.svg，自带页面折角），
   * 不再自绘「彩色方块 + 扩展名字」。
   */
  @Builder
  fileGlyph(name: string) {
    Image(fileKindIcon(botFileKindOf(name)))
      .width(48)
      .height(48)
      .objectFit(ImageFit.Contain)
      .flexShrink(0)
  }

  /** 文件卡图标里的扩展名徽标（大写，最多 4~5 个字符） */
  private fileBadge(name: string): string {
    const ext: string = this.fileExtension(name);
    if (ext.length === 0) {
      return 'FILE';
    }
    const upper: string = ext.toUpperCase();
    return upper.length > 5 ? upper.substring(0, 5) : upper;
  }

  /**
   * 文件卡（对齐 iOS FileReferenceCard）：图标 + 文件名 + 描述，宽度自适应、最大 320，
   * 背景按文件类型着色，圆角 12，点按交给页面处理。
   */
  @Builder
  fileCard(file: BotPresentedFile) {
    Row({ space: 12 }) {
      this.fileGlyph(this.fileNameOf(file))
      Column({ space: 4 }) {
        Text(this.fileNameOf(file))
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.ink())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Text(file.description !== undefined && file.description.length > 0
          ? file.description
          : this.fileKindLabel(this.fileKindOf(this.fileNameOf(file))))
          .fontSize(13)
          .fontColor(this.subColor())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    // 与回复气泡完全同宽（气泡正文统一用 bubbleMaxWidth）
    .width(this.bubbleMaxWidth())
    .constraintSize({ minHeight: 76 })
    .backgroundColor(this.fileCardBg(this.fileKindOf(this.fileNameOf(file))))
    .borderRadius(14)
    .onClick(() => {
      this.onOpenFile(file);
    })
  }

  /** 没有 description 时的兜底副标题（文档/图片/表格…） */
  private fileKindLabel(kind: string): string {
    if (kind === 'pdf') return 'PDF 文档';
    if (kind === 'document') return '文档';
    if (kind === 'sheet') return '表格';
    if (kind === 'slides') return '演示文稿';
    if (kind === 'image') return '图片';
    if (kind === 'code') return '代码文件';
    if (kind === 'media') return '音频';
    if (kind === 'video') return '视频';
    if (kind === 'archive') return '压缩包';
    if (kind === 'package') return '安装包';
    return '文件';
  }

  /**
   * 应用内文档预览：交给系统 PreviewKit（docx/xlsx/pptx/pdf 都能渲染）。
   * 返回 false 表示这台设备/该类型不支持，调用方回退到原来的文件信息卡片。
   */
  private async previewInApp(context: common.UIAbilityContext, localPath: string, title: string): Promise<boolean> {
    try {
      const uri: string = fileUri.getUriFromPath(localPath);
      const can: boolean = await filePreview.canPreview(context, uri);
      if (!can) {
        return false;
      }
      // mimeType 传空串：由系统按 URI 后缀推断（避免自己维护扩展名映射表）
      const info: filePreview.PreviewInfo = { uri: uri, mimeType: '', title: title };
      await filePreview.openPreview(context, info);
      Logger.info('BOT_FILE previewInApp ok ' + title);
      return true;
    } catch (err) {
      Logger.warn('BOT_FILE previewInApp failed ' + title + ' '
        + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  /**
   * 点交付文件卡：图片看大图、文本看内容；docx/xlsx/pptx/pdf 先交给系统 PreviewKit 在应用内预览，
   * 真正不支持时才回退到底部玻璃弹窗里的文件信息卡。
   */
  private onOpenFile(file: BotPresentedFile): void {
    const sessionId: string = this.sessionIdForFiles('');
    if (sessionId.length === 0) {
      this.showHint('会话未就绪，稍后再试');
      return;
    }
    this.filePreviewSource = file;
    this.filePreviewName = this.fileNameOf(file);
    this.filePreviewLocalPath = '';
    this.filePreviewText = '';
    this.filePreviewError = '';
    this.filePreviewSize = '';
    this.filePreviewIsImage = this.isImageFile(this.filePreviewName);
    this.filePreviewIsPdf = this.isPdfFile(this.filePreviewName);
    const isText: boolean = this.isTextFile(this.filePreviewName);
    // 图片 / 文本 / PDF 走自家底部弹窗；其它文档（docx / xlsx / pptx …）不弹弹窗，
    // 下载完直接交给系统 PreviewKit 全屏预览（它没法嵌进我们的弹窗）
    const systemPreviewOnly: boolean = !this.filePreviewIsImage && !this.filePreviewIsPdf && !isText;
    this.filePreviewLoading = true;
    this.filePreviewOpen = !systemPreviewOnly;
    const context = getContext(this) as common.UIAbilityContext;
    const client: GatewayClient = GatewayClient.get();
    Logger.info('BOT_FILE preview ' + file.path + ' system=' + (systemPreviewOnly ? '1' : '0'));
    client.resolveFile(sessionId, file.path).then((resolved) => {
      const rel: string = resolved.path !== undefined ? String(resolved.path) : '';
      if (rel.length === 0) {
        throw new Error('empty resolved path');
      }
      return downloadAttachment(context, client, sessionId, rel);
    }).then((result: DownloadResult): Promise<void> => {
      this.filePreviewLocalPath = result.localPath;
      this.filePreviewSize = this.formatFileSize(result.size);
      if (this.filePreviewIsImage) {
        this.filePreviewLoading = false;
        this.imageRevision += 1;
        return Promise.resolve();
      }
      if (this.isTextFile(this.filePreviewName)) {
        return this.readTextFile(result.localPath).then((text: string) => {
          this.filePreviewText = text;
          this.filePreviewLoading = false;
        });
      }
      if (this.filePreviewIsPdf) {
        // PDF：不走系统预览，直接用 PDFKit 的 PdfView 嵌在底部弹窗里渲染
        return this.loadPdfPreview(result.localPath);
      }
      // 其它文档：系统 PreviewKit 全屏预览（弹窗根本没打开，失败给提示）
      return this.previewInApp(context, result.localPath, this.filePreviewName).then((opened: boolean) => {
        this.filePreviewLoading = false;
        if (!opened) {
          this.showHint('该格式暂不支持在应用内预览');
        }
      });
    }).catch((error: Error) => {
      Logger.warn('BOT_FILE preview failed: ' + error.message);
      this.filePreviewLoading = false;
      if (systemPreviewOnly) {
        this.showHint('文件下载失败，请确认主机在线后重试');
      } else {
        this.filePreviewError = '文件下载失败，请确认主机在线后重试';
      }
    });
  }

  /** 本地文件大小的人话格式 */
  private formatFileSize(bytes: number): string {
    if (bytes <= 0) {
      return '';
    }
    if (bytes < 1024) {
      return bytes.toString() + ' B';
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private isPdfFile(name: string): boolean {
    return this.fileExtension(name) === 'pdf';
  }

  /** 把 PDF 载入 PdfView；失败时在弹窗里给错误文案 */
  private loadPdfPreview(localPath: string): Promise<void> {
    return this.pdfController.loadDocument(localPath).then(() => {
      this.filePreviewLoading = false;
    }).catch((error: Error) => {
      Logger.warn('BOT_FILE pdf load failed: ' + error.message);
      this.filePreviewLoading = false;
      this.filePreviewError = 'PDF 解析失败，请重试';
    });
  }

  private isTextFile(name: string): boolean {
    const ext: string = this.fileExtension(name);
    return ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'csv' || ext === 'log'
      || ext === 'xml' || ext === 'yml' || ext === 'yaml' || ext === 'html' || ext === 'css'
      || ext === 'js' || ext === 'ts' || ext === 'ets' || ext === 'kt' || ext === 'java'
      || ext === 'py' || ext === 'swift' || ext === 'sh';
  }

  private async readTextFile(localPath: string): Promise<string> {
    try {
      const content: string = fileIo.readTextSync(localPath);
      // 太长就截断，避免一次渲染巨大文本卡住页面
      return content.length > 40000 ? content.substring(0, 40000) + '\n\n…（内容过长，仅显示前 40000 字）' : content;
    } catch (error) {
      return '';
    }
  }

  /** 交付文件预览弹窗（底部原生玻璃 sheet，与图片预览/角色弹窗同一套材质） */
  @Builder
  filePreviewSheet() {
    Column() {
      // 标题行：彩色徽标 + 文件名 + 大小
      Row({ space: 12 }) {
        this.fileGlyph(this.filePreviewName)
        Column({ space: 3 }) {
          Text(this.filePreviewName)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.ink())
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          if (this.filePreviewSize.length > 0) {
            Text(this.filePreviewSize)
              .fontSize(12)
              .fontColor(this.subColor())
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Row() {
          SymbolGlyph($r('sys.symbol.xmark'))
            .fontSize(16)
            .fontColor([this.subColor()])
        }
        .width(30)
        .height(30)
        .borderRadius(15)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
        .onClick(() => {
          this.filePreviewOpen = false;
        })
      }
      .width('100%')
      .padding({ top: 14, bottom: 12 })
      .alignItems(VerticalAlign.Center)

      // 内容区
      Column() {
        if (this.filePreviewLoading) {
          Column({ space: 10 }) {
            LoadingProgress()
              .width(26)
              .height(26)
              .color(this.botBlue())
            Text('正在从主机加载…')
              .fontSize(13)
              .fontColor(this.subColor())
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
        } else if (this.filePreviewError.length > 0) {
          Text(this.filePreviewError)
            .fontSize(14)
            .fontColor(this.subColor())
            .padding(24)
        } else if (this.filePreviewIsPdf && this.filePreviewLocalPath.length > 0) {
          // PDF 用 PDFKit 的 PdfView 在弹窗里渲染（可滚动、可缩放，由组件自己处理）
          PdfView({ controller: this.pdfController })
            .width('100%')
            .layoutWeight(1)
        } else if (this.filePreviewIsImage && this.filePreviewLocalPath.length > 0) {
          this.zoomablePreviewImage(this.fileUri(this.filePreviewLocalPath))
        } else if (this.filePreviewText.length > 0) {
          Scroll() {
            Text(this.filePreviewText)
              .fontSize(13)
              .lineHeight(20)
              .fontFamily('monospace')
              .fontColor(this.ink())
              .width('100%')
              .textAlign(TextAlign.Start)
              .padding({ left: 14, right: 14, top: 12, bottom: 20 })
          }
          .width('100%')
          .layoutWeight(1)
          .scrollBar(BarState.Off)
          .borderRadius(14)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.04)')
        } else {
          // 不支持内联预览的格式（docx / pdf / ppt …）：给文件信息 + 明确说明
          Column({ space: 14 }) {
            this.fileGlyph(this.filePreviewName)
            Text('该格式暂不支持在应用内预览')
              .fontSize(14)
              .fontColor(this.subColor())
            Text('文件已下载到本机，可在主机侧打开查看')
              .fontSize(12)
              .fontColor(this.subColor())
          }
          .width('100%')
          .height('100%')
          .justifyContent(FlexAlign.Center)
        }
      }
      .width('100%')
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 16, right: 16, top: 4, bottom: 16 })
  }

  // ==================== 「+」附件（对齐工作模式 composer 的加号菜单） ====================

  /** 主机是否支持随消息发图片（bot 能力位） */
  private attachSupported(): boolean {
    return this.state.supported && this.state.attachmentsSupported;
  }

  private showHint(message: string): void {
    if (message.length === 0) {
      return;
    }
    if (this.hintTimer >= 0) {
      clearTimeout(this.hintTimer);
      this.hintTimer = -1;
    }
    this.hint = message;
    this.hintTimer = setTimeout(() => {
      this.hint = '';
      this.hintTimer = -1;
    }, 2600);
  }

  private isImageAttachment(name: string): boolean {
    const lower: string = name.toLowerCase();
    return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')
      || lower.endsWith('.webp') || lower.endsWith('.heic') || lower.endsWith('.heif')
      || lower.endsWith('.gif') || lower.endsWith('.bmp');
  }

  private appendPicked(picked: PickedAttachment[]): void {
    if (picked.length === 0) {
      this.showHint('未选择附件');
      return;
    }
    const merged: PickedAttachment[] = this.pickedAttachments.slice();
    for (const one of this.localizeImages(picked)) {
      if (merged.length >= 8) {
        this.showHint('一次最多添加 8 个附件');
        break;
      }
      merged.push(one);
    }
    this.pickedAttachments = merged;
    this.composerFocused = true;
  }

  private pickAttachmentImages(): void {
    if (!this.attachSupported()) {
      this.showHint('当前主机不支持在 Bot 里发送图片');
      return;
    }
    pickImages(4).then((picked: PickedAttachment[]) => {
      this.appendPicked(picked);
    }).catch((error: Error) => {
      this.showHint('选择图片失败：' + error.message);
    });
  }

  /** 本地文件：与工作模式同一个文档选择器（图片也可选，发送时按扩展名分流） */
  private pickAttachmentFiles(): void {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      pickDocuments(context, 4).then((picked: PickedAttachment[]) => {
        this.appendPicked(picked);
      }).catch((error: Error) => {
        this.showHint('选择文件失败：' + error.message);
      });
    } catch (error) {
      this.showHint('选择文件失败');
    }
  }

  /** 选择器返回的 URI 可能是临时授权，复制到应用缓存目录后再读 */
  private localizeImages(picked: PickedAttachment[]): PickedAttachment[] {
    const out: PickedAttachment[] = [];
    let dir: string = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      dir = context.cacheDir + '/bot-picked-images';
      try {
        fileIo.mkdirSync(dir);
      } catch (ignored) {
      }
    } catch (error) {
      dir = '';
    }
    for (const one of picked) {
      if (dir.length === 0) {
        out.push(one);
        continue;
      }
      const raw: string = one.uri.startsWith('file://') ? one.uri.substring(7) : one.uri;
      const dot: number = raw.lastIndexOf('.');
      const ext: string = dot > raw.lastIndexOf('/') ? raw.substring(dot) : '.jpg';
      const dest: string = dir + '/' + Date.now().toString() + '-' + out.length.toString() + ext;
      try {
        const source: fileIo.File = fileIo.openSync(one.uri, fileIo.OpenMode.READ_ONLY);
        try {
          fileIo.copyFileSync(source.fd, dest);
        } finally {
          fileIo.closeSync(source);
        }
        out.push({ uri: 'file://' + dest, name: one.name });
      } catch (error) {
        out.push(one);
      }
    }
    return out;
  }

  private removePickedImage(uri: string): void {
    this.pickedAttachments = this.pickedAttachments.filter((item: PickedAttachment) => item.uri !== uri);
  }

  private imageMediaTypeOf(name: string): string {
    const lower: string = name.toLowerCase();
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.bmp')) {
      return 'image/bmp';
    }
    if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
      return 'image/heic';
    }
    return 'image/jpeg';
  }

  /** 图片载荷带超时：解码/转码卡住不能拖死整次发送 */
  private imagePayloadWithTimeout(attachment: PickedAttachment): Promise<Object | undefined> {
    return new Promise<Object | undefined>((resolve: (value: Object | undefined) => void) => {
      let settled: boolean = false;
      const timer: number = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        Logger.warn('[WriteBody] bot image payload timeout ' + attachment.name);
        resolve(undefined);
      }, 20000);
      buildSendImagePayload(attachment.uri, attachment.name).then((payload: Object | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      }).catch((error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        Logger.warn('bot image payload failed ' + attachment.name + ': ' + error.message);
        resolve(undefined);
      });
    });
  }

  /** 图片附件 → { mediaType, data(base64), name }（单张 ≤12MB） */
  private imagePayloadOf(attachment: PickedAttachment): Object | undefined {
    try {
      const raw: string = attachment.uri.startsWith('file://') ? attachment.uri.substring(7) : attachment.uri;
      const source: fileIo.File = fileIo.openSync(raw, fileIo.OpenMode.READ_ONLY);
      try {
        const size: number = fileIo.statSync(source.fd).size;
        if (size <= 0 || size > 12 * 1024 * 1024) {
          return undefined;
        }
        const buffer: ArrayBuffer = new ArrayBuffer(size);
        fileIo.readSync(source.fd, buffer);
        const bytes: Uint8Array = new Uint8Array(buffer);
        const encoded: string = new util.Base64Helper().encodeToStringSync(bytes);
        const payload: BotImagePayload = {
          mediaType: this.imageMediaTypeOf(attachment.name),
          data: encoded,
          name: attachment.name
        };
        return payload as Object;
      } finally {
        fileIo.closeSync(source);
      }
    } catch (error) {
      return undefined;
    }
  }

  private focusComposer(): void {
    this.composerExpandedAt = Date.now();
    // 与工作模式同一套展开动画：250ms EaseOut（与系统键盘弹出同长，卡片和胶囊一起变）
    this.getUIContext().animateTo({ duration: 250, curve: Curve.EaseOut }, () => {
      this.composerFocused = true;
    });
    // 节点刚由 Visibility.None 转可见：延迟两次拉起键盘，保证真机一次点按即弹
    setTimeout(() => {
      try {
        this.getUIContext().getFocusController().requestFocus('bot-chat-draft');
      } catch (error) {
      }
    }, 60);
    setTimeout(() => {
      try {
        this.getUIContext().getFocusController().requestFocus('bot-chat-draft');
      } catch (error) {
      }
    }, 220);
  }

  private composerExpanded(): boolean {
    return this.composerFocused || this.draft.trim().length > 0 || this.pickedAttachments.length > 0;
  }

  /**
   * 收起输入条（对齐工作模式）：点聊天区/滚动时收键盘；有草稿或附件时只收键盘、保持展开，
   * 草稿为空才真正折叠回胶囊。250ms 与键盘收起动画同长。
   */
  private collapseComposer(): void {
    const keepExpanded: boolean = this.draft.trim().length > 0 || this.pickedAttachments.length > 0;
    this.getUIContext().animateTo({ duration: 250, curve: Curve.EaseOut }, () => {
      this.composerFocused = keepExpanded;
    });
    try {
      this.getUIContext().getFocusController().clearFocus();
    } catch (ignored) {
    }
  }

  /** 「+」圆钮：折叠态 36、展开态 27（与工作模式 composer 的加号同尺寸） */
  @Builder
  plusButton(size: number) {
    Stack() {
      Text('+')
        .fontSize(size >= 36 ? 17 : 15)
        .fontColor(this.isDark ? '#F2EEF6' : '#252332')
    }
    .width(size)
    .height(size)
    .borderRadius(size / 2)
    .border({ width: 0.9, color: this.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(16,19,24,0.14)' })
    .opacity(this.attachSupported() ? 1 : 0.4)
    .enabled(true)
    .onClick(() => {
      this.attachMenuOpen = !this.attachMenuOpen;
    })
    .bindMenu(this.attachMenuOpen, this.attachMenu(), {
      placement: Placement.TopLeft,
      offset: { x: 0, y: 4 },
      onDisappear: () => {
        this.attachMenuOpen = false;
      }
    })
  }

  /** 「+」菜单的一行：左图标 + 标题，右侧灰色说明（与工作模式 ConversationComposer.attachMenuRow 同一套） */
  @Builder
  attachMenuRow(icon: Resource, iconDark: Resource, tintDark: boolean, label: string, desc: string,
    onTap: () => void) {
    Row({ space: 8 }) {
      if (this.isDark) {
        Image(iconDark)
          .width(20)
          .height(20)
          .objectFit(ImageFit.Contain)
          .colorFilter(tintDark ? this.navIconTint() : this.noTint())
      } else {
        Image(icon)
          .width(20)
          .height(20)
          .objectFit(ImageFit.Contain)
      }
      Text(label)
        .fontSize(14)
        .fontColor(this.ink())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: 84 })
      Text(desc)
        .fontSize(11.5)
        .fontColor(this.subColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.End)
        .layoutWeight(2)
    }
    .width('100%')
    .height(46)
    .padding({ left: 16, right: 20 })
    .borderRadius(10)
    .stateStyles({
      pressed: {
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
      },
      normal: {
        .backgroundColor(Color.Transparent)
      }
    })
    .onClick(() => {
      this.attachMenuOpen = false;
      onTap();
    })
  }

  @Builder
  attachMenu() {
    Column({ space: 0 }) {
      this.attachMenuRow($r('app.media.menu_image'), $r('app.media.menu_image'), true,
        '相册图片', '从相册选择', () => {
          this.pickAttachmentImages();
        })
      this.attachMenuRow($r('app.media.menu_external_file'), $r('app.media.menu_external_file'), true,
        '文件', '选择本地文件', () => {
          this.pickAttachmentFiles();
        })
    }
    .width(236)
    .padding({ top: 6, bottom: 8 })
    .alignItems(HorizontalAlign.Start)
  }

  /** 不改变颜色的颜色矩阵（图标自带配色，只在需要跟随主题时才着色） */
  private noTint(): number[] {
    return [
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 1, 0
    ];
  }

  /** 图标按 navIcon 色（深色近白 / 浅色近墨）着色 */
  private navIconTint(): number[] {
    const rgba: number[] = this.rgbaOf(this.navIconColor());
    return [
      0, 0, 0, 0, rgba[0],
      0, 0, 0, 0, rgba[1],
      0, 0, 0, 0, rgba[2],
      0, 0, 0, rgba[3], 0
    ];
  }

  private rgbaOf(color: string): number[] {
    const match: RegExpMatchArray | null = color.match(/[\d.]+/g);
    if (match === null || match.length < 3) {
      return [255, 255, 255, 1];
    }
    const alpha: number = match.length > 3 ? Number(match[3]) : 1;
    return [Number(match[0]), Number(match[1]), Number(match[2]), alpha];
  }

  /** 已选附件：图片 52×52 缩略图、文件 回形针 + 文件名胶囊，右上角圆形删除钮 */
  @Builder
  attachmentRow() {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(this.pickedAttachments, (attachment: PickedAttachment) => {
          Stack({ alignContent: Alignment.TopEnd }) {
            if (this.isImageAttachment(attachment.name)) {
              Image(attachment.uri)
                .width(52)
                .height(52)
                .borderRadius(10)
                .objectFit(ImageFit.Cover)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)')
            } else {
              Row({ space: 5 }) {
                SymbolGlyph($r('sys.symbol.paperclip'))
                  .fontSize(13)
                  .fontColor([this.ink()])
                Text(attachment.name)
                  .fontSize(12)
                  .fontColor(this.ink())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: 110 })
              }
              .height(30)
              .padding({ left: 9, right: 9 })
              .borderRadius(9)
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
              .alignItems(VerticalAlign.Center)
            }
            // 右上角圆形删除钮（半透明黑底 + 白 ×），向内收避免被 Scroll 裁掉
            Stack() {
              Text('×')
                .fontSize(11)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
            }
            .width(18)
            .height(18)
            .borderRadius(9)
            .backgroundColor('rgba(0,0,0,0.62)')
            .alignContent(Alignment.Center)
            .margin({ top: 2, right: 2 })
            .onClick(() => {
              this.removePickedImage(attachment.uri);
            })
          }
          .height(56)
          .padding({ right: 4 })
        }, (attachment: PickedAttachment) => attachment.uri)
      }
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
    .margin({ bottom: 10 })
  }

  private togglePick(label: string, multi: boolean): void {
    if (!multi) {
      this.picked = this.picked.indexOf(label) >= 0 ? [] : [label];
      return;
    }
    const index: number = this.picked.indexOf(label);
    const next: string[] = this.picked.slice();
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push(label);
    }
    this.picked = next;
  }

  /**
   * 点头像不再进二级页：写待打开的角色 id 后返回 Bot 首页，
   * 由首页弹出与 Chief 卡完全相同的底部弹窗（内容一致）。
   */
  private openIdentity(): void {
    const chat: BotChat | null = this.chat();
    if (chat === null || chat.room) {
      return;
    }
    this.openRoleSheet(chat.id);
  }

  // ==================== 组件 ====================

  /**
   * BotFace（对齐 iOS §8.6 + 首页/我的 Bot）：有主机图 → 渲染图；主 Bot 无图 → 鲸鱼标记
   * （深色切白色变体）；其余 → 首字（BotBlue on BotLavenderSoft）。圆角 size/3。
   */
  @Builder
  botFace(chat: BotChat, size: number) {
    Stack({ alignContent: Alignment.Center }) {
      if (this.hasImage(chat)) {
        Image(this.imageOf(chat))
          .width(size)
          .height(size)
          .objectFit(ImageFit.Cover)
          .draggable(false)
      } else if (this.isMainBot(chat)) {
        // 与首页一致：不铺方形底，鲸鱼放大
        Image($r('app.media.dsh_whale'))
          .width(size * 0.82)
          .height(size * 0.82)
          .objectFit(ImageFit.Contain)
      } else {
        Text(this.firstChar(chat))
          .fontSize(size * 0.56)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.botBlue())
      }
    }
    .width(size)
    .height(size)
    .borderRadius(size / 3)
    // 对齐 iOS BotFace：头像本体不铺底板（主 Bot 是鲸鱼、其余是首字，均为透明底）
    .clip(true)
    .flexShrink(0)
    // 对话里的头像也能点：打开与 Chief 卡相同的角色弹窗（群聊不响应）
    .onClick(() => {
      this.openRoleFor(chat);
    })
  }

  /** 点某个 Bot 的头像：就地弹出与首页 Chief 卡同一个角色弹窗（不离开对话页） */
  private openRoleFor(chat: BotChat): void {
    if (chat.room) {
      return;
    }
    this.openRoleSheet(chat.id);
  }

  private openRoleSheet(id: string): void {
    if (id.length === 0) {
      return;
    }
    this.roleBotId = id;
    // sheet 内容只构建一次，目标 Bot 走 AppStorage 才能跟着切换
    AppStorage.setOrCreate<string>('botSheetTargetId', id);
    BotStore.get().openRole(id);
    this.roleSheetOpen = true;
  }

  /** 顶栏身份头像：群聊走成员拼贴（§8.6），私聊走 BotFace */
  @Builder
  identityFace(chat: BotChat) {
    if (chat.room) {
      BotGroupAvatar({
        chatId: chat.id,
        chats: this.state.chats,
        mainBotId: this.state.mainBotId ?? '',
        faceSize: 36,
        isDark: this.isDark
      })
    } else {
      this.botFace(chat, 36)
    }
  }

  private subtitleText(chat: BotChat | null): string {
    if (chat === null) {
      return '';
    }
    if (chat.room) {
      return '群聊';
    }
    return chat.role.length > 0 ? chat.role : '随时为你效劳';
  }

  /** 顶栏内容（交给原生标题栏承载：滚动时系统渐变模糊 + 沉浸光感材质） */
  @Builder
  nativeTitleBar() {
    Row({ space: 10 }) {
      // 与工作模式会话页同一尺寸：内嵌标题栏里按 40 给（渲染约 45vp，与系统返回键同视觉大小）
      NavBackButton({
        isDark: this.isDark,
        diameter: HEADER_BTN_SIZE,
        onBack: () => {
          BotStore.get().closeChat();
          this.pageStack.pop();
        }
      })
        .id('bot-chat-back')

      // 身份按钮：头像 36 + 名字 17 semibold + 副标题 12 secondary（§4.1）
      // 宽度按内容收缩（最多 220，与 iOS principal 的 maxWidth 一致）：不再用 layoutWeight，
      // 否则 layoutWeight 会先占满剩余空间再被 maxWidth 夹住，右侧「⋯」被顶到离右缘 50vp 开外。
      Row({ space: 10 }) {
        if (this.chat() !== null) {
          this.identityFace(this.chat() as BotChat)
        }
        Column({ space: 2 }) {
          Text(this.chat() !== null ? (this.chat() as BotChat).name : '聊天')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.ink())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 174 })
          Text(this.subtitleText(this.chat()))
            .fontSize(12)
            .fontColor(this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 174 })
        }
        .alignItems(HorizontalAlign.Start)
      }
      .constraintSize({ maxWidth: 220 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.openIdentity();
      })

      // 弹性留白：把「⋯」推到与工作模式会话页一致的最右侧（right 14）
      Blank()

      // 更多：与工作模式「⋯」完全同一套 —— HdsGlassSurface 沉浸光感背板 +
      // 系统 more 符号（字号 = 直径 × 0.45、Medium 字重、navIconColor）+ 透明底 + 关掉按压缩放
      Stack({ alignContent: Alignment.Center }) {
        HdsGlassSurface() {
          Row().width(HEADER_BTN_SIZE).height(HEADER_BTN_SIZE).backgroundColor(Color.Transparent)
        }
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.more'))
            .fontSize(HEADER_BTN_SIZE * 0.45)
            .fontColor([this.navIconColor()])
            .fontWeight(FontWeight.Medium)
        }
        .id('bot-chat-more')
        .width(HEADER_BTN_SIZE)
        .height(HEADER_BTN_SIZE)
        .backgroundColor(Color.Transparent)
        .stateEffect(false)
        .accessibilityText('更多')
        .onClick(() => {
          this.moreOpen = !this.moreOpen;
        })
        .bindMenu(this.moreOpen, this.moreMenu(), {
          placement: Placement.BottomRight,
          offset: { x: 0, y: 4 },
          onDisappear: () => {
            this.moreOpen = false;
          }
        })
      }
      .width(HEADER_BTN_SIZE)
      .height(HEADER_BTN_SIZE)
    }
    .width('100%')
    .height(TITLE_BAR_HEIGHT)
    .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  moreMenu() {
    Menu() {
      MenuItem({ content: '重新同步' })
        .onClick(() => {
          BotStore.get().refreshAll();
        })
      MenuItem({ content: '查看角色资料' })
        .onClick(() => {
          this.openIdentity();
        })
      MenuItem({ content: '加载更早消息' })
        .onClick(() => {
          BotStore.get().loadEarlier();
        })
    }
  }

  /** 时间线顶部：加载更早消息（§4.2） */
  @Builder
  earlierRow() {
    Row() {
      Text(this.state.historyLoading ? '正在读取更早消息…' : '加载更早消息')
        .fontSize(12.5)
        .fontColor(this.subColor())
    }
    .width('100%')
    .height(36)
    .justifyContent(FlexAlign.Center)
    .opacity(this.state.historyLoading ? 0.5 : 1)
    .onClick(() => {
      if (!this.state.historyLoading && this.state.hasEarlier) {
        BotStore.get().loadEarlier();
      }
    })
  }

  /** §4.3(7) 活动行：居中「已创建 / 已发消息给」+ 头像 18 + 名字 */
  @Builder
  activityRow(message: BotChatMessage) {
    Row({ space: 6 }) {
      Text(message.activity === 'bot-created' ? '已创建' : '已发消息给')
        .fontSize(12)
        .fontColor(this.subColor())
      if (this.faceChat(message) !== null) {
        this.botFace(this.faceChat(message) as BotChat, 18)
      }
      Text(message.name)
        .fontSize(12)
        .fontColor(this.subColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
  }

  /** §4.3(9) 已回答问答卡：字母徽标 + 选项 */
  @Builder
  answeredCard(message: BotChatMessage) {
    Column({ space: 10 }) {
      ForEach(message.questionAnswers, (answer: BotQuestionAnswer) => {
        Column({ space: 8 }) {
          Text(answer.question)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.subColor())
            .width('100%')
          Row({ space: 10 }) {
            ForEach(answer.choices, (choice: BotAnswerChoice, index: number) => {
              Row({ space: 8 }) {
                Text(choice.letter !== undefined && choice.letter.length > 0
                  ? choice.letter
                  : String.fromCharCode(65 + index))
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.botBlue())
                  .padding({ left: 8, right: 8, top: 5, bottom: 5 })
                  .backgroundColor(this.isDark ? 'rgba(161,191,246,0.12)' : 'rgba(46,107,230,0.12)')
                  .borderRadius(7)
                Text(choice.label)
                  .fontSize(16)
                  .fontColor(this.ink())
                  .layoutWeight(1)
              }
              .alignItems(VerticalAlign.Center)
            })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      })
    }
    .width('100%')
    .constraintSize({ maxWidth: 360 })
    .padding({ left: 16, right: 12, top: 16, bottom: 16 })
    .backgroundColor(this.cardColor())
    .borderRadius(20)
    .border({ width: 1, color: this.lineColor() })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  messageRow(message: BotChatMessage) {
    Column({ space: 4 }) {
      if (this.showSpeaker(message)) {
        Text(message.name)
          .fontSize(12)
          .fontColor(this.subColor())
          .margin({ left: MESSAGE_AVATAR + MESSAGE_AVATAR_GAP })
          .width('100%')
      }
      if (this.isActivity(message)) {
        this.activityRow(message)
      } else if (message.kind === 'answer' && message.questionAnswers.length > 0) {
        Row() {
          if (this.faceChat(message) !== null) {
            Column() {
              this.botFace(this.faceChat(message) as BotChat, MESSAGE_AVATAR)
            }
            .margin({ right: MESSAGE_AVATAR_GAP, top: 2 })
          }
          Column() {
            this.answeredCard(message)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
          Blank()
        }
        .width('100%')
        .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
        .alignItems(VerticalAlign.Top)
      } else if (message.kind === 'event' || message.kind === 'divider' || message.kind === 'closed'
        || message.kind === 'view') {
        Text(message.text.length > 0 ? message.text : '协作动态')
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
          .textAlign(TextAlign.Center)
          .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
      } else {
        Row() {
          if (this.isMine(message)) {
            Blank()
          } else if (this.faceChat(message) !== null) {
            Column() {
              this.botFace(this.faceChat(message) as BotChat, MESSAGE_AVATAR)
            }
            .margin({ right: MESSAGE_AVATAR_GAP, top: 2 })
          }
          Column({ space: 6 }) {
            if (this.isMine(message)) {
              Text(message.text)
                .fontSize(this.contentSize())
                .lineHeight(this.contentSize() * 1.45)
                .fontColor(this.ink())
                .padding({ left: BUBBLE_PAD_H, right: BUBBLE_PAD_H, top: BUBBLE_PAD_V, bottom: BUBBLE_PAD_V })
                .backgroundColor(this.userBubble())
                .borderRadius(BUBBLE_RADIUS)
                .border({ width: this.isDark ? 0 : 0.7, color: 'rgba(46,107,230,0.08)' })
                .textAlign(TextAlign.Start)
            } else if (message.text.length > 0 && this.isPlainText(message.text)) {
              // 纯文本按内容收缩（§4.3：短消息按内容收缩），换行由最大宽控制
              Text(message.text)
                .fontSize(this.contentSize())
                .lineHeight(this.contentSize() * 1.45)
                .fontColor(this.ink())
                .padding({ left: BUBBLE_PAD_H, right: BUBBLE_PAD_H, top: BUBBLE_PAD_V, bottom: BUBBLE_PAD_V })
                .backgroundColor(this.palette.rgb(message.botId, this.isDark))
                .borderRadius(BUBBLE_RADIUS)
                .constraintSize({ maxWidth: this.bubbleMaxWidth() })
                .textAlign(TextAlign.Start)
            } else if (message.text.length > 0) {
              // Markdown 正文：内部各块是 width 100%，必须给容器一个确定宽度，
              // 否则百分比会按最大约束先算再被外层裁剪（文字左右被切掉）
              Column() {
                // 正文里的 ![](/__bot_image__/...) 直接渲染成图片并支持点开大图（与工作模式一致）
                MarkdownBodyView({
                  text: message.text,
                  fontSize: this.contentSize(),
                  resolveImage: (src: string): string => this.resolveBotImage(src),
                  imageRevision: this.imageRevision,
                  onImageTap: (src: string) => {
                    if (src.length > 0) {
                      this.openImagePreview(src);
                    }
                  }
                })
              }
              .width(this.bubbleMaxWidth())
              .padding({ left: BUBBLE_PAD_H, right: BUBBLE_PAD_H, top: BUBBLE_PAD_V, bottom: BUBBLE_PAD_V })
              .backgroundColor(this.palette.rgb(message.botId, this.isDark))
              .borderRadius(BUBBLE_RADIUS)
              .clip(true)
            }
            if (message.images.length > 0) {
              // 图片区：单图铺满气泡宽（按宽高比自适应高度），多图两列 —— 更接近 iOS 的图片预览
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(message.images, (image: BotChatImage) => {
                  BotMessageImage({
                    chatId: this.state.selectedChatId ?? '',
                    attachmentId: image.attachmentId,
                    sessionId: image.sessionId,
                    mediaType: image.mediaType,
                    boxWidth: this.imageBoxWidth(image, message.images.length === 1),
                    boxHeight: this.imageBoxHeight(image, message.images.length === 1),
                    onOpen: (ready: string) => {
                      this.openImagePreview(ready);
                    }
                  })
                    .margin({ right: message.images.length === 1 ? 0 : 6, bottom: 6 })
                }, (image: BotChatImage) => image.sessionId + ':' + image.attachmentId)
              }
            }
            if (message.files.length > 0) {
              // 图片类交付物直接显示成图片（缩略图，点开是大图）；其余文件仍用文件卡。
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(message.files, (file: BotPresentedFile) => {
                  if (this.isImageFile(this.fileNameOf(file))) {
                    this.fileImageCard(file, message.files.length === 1, message.sessionId)
                  } else {
                    Column() {
                      this.fileCard(file)
                    }
                    .width('100%')
                    .alignItems(HorizontalAlign.Start)
                    .margin({ bottom: 8 })
                  }
                }, (file: BotPresentedFile) => file.path
                  + (this.isImageFile(this.fileNameOf(file)) ? ':img' : ':file'))
              }
              .width(this.bubbleMaxWidth())
            }
            // 页脚（对齐工作模式）：助手回复 = 复制 / 引用 / 时间；用户气泡 = 时间 / 复制（复制在时间右边）。
            if (!this.isStreaming(message)
              && (this.timeLabel(message).length > 0 || this.deliveryLabel(message).length > 0
                || this.canCopyMessage(message))) {
              Row({ space: 7 }) {
                if (!this.isMine(message) && this.canCopyMessage(message)) {
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
                    this.copyMessageText(message);
                  })
                }
                if (!this.isMine(message) && this.canQuoteMessage(message)) {
                  Row() {
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
                    this.quoteMessageText(message);
                  })
                }
                if (this.timeLabel(message).length > 0) {
                  Text(this.timeLabel(message))
                    .fontSize(11)
                    .fontColor(this.subColor())
                }
                if (this.deliveryLabel(message).length > 0) {
                  Text(this.deliveryLabel(message))
                    .fontSize(11)
                    .fontColor(this.subColor())
                }
                if (this.isMine(message) && this.canCopyMessage(message)) {
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
                    this.copyMessageText(message);
                  })
                }
              }
              .margin({ top: 2 })
              .alignItems(VerticalAlign.Center)
            }
          }
          .constraintSize({ maxWidth: this.bubbleMaxWidth() })
          .alignItems(this.isMine(message) ? HorizontalAlign.End : HorizontalAlign.Start)
          if (!this.isMine(message)) {
            Blank()
          }
        }
        .width('100%')
        .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
        .alignItems(VerticalAlign.Top)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ bottom: MESSAGE_ROW_GAP })
  }

  /** 实时工作行：头像 28 + 文案 + 「· N 秒」 */
  @Builder
  liveWorkRow() {
    Row({ space: MESSAGE_AVATAR_GAP }) {
      if (this.chat() !== null) {
        this.botFace(this.chat() as BotChat, MESSAGE_AVATAR)
      }
      Text(this.liveText() + ' · ' + this.liveSeconds().toString() + ' 秒')
        .fontSize(14)
        .fontColor(this.subColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Blank()
    }
    .width('100%')
    .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
    .alignItems(VerticalAlign.Center)
  }

  /** §5.1 提问卡：时间线内卡片（BotCard、圆角 20、maxWidth 748） */
  @Builder
  questionCard(interaction: BotInteraction) {
    Column({ space: 12 }) {
      Column({ space: 6 }) {
        Text('助理在等你回答')
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
        Text(interaction.title)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.ink())
          .width('100%')
        if (interaction.detail.length > 0) {
          Text(interaction.detail)
            .fontSize(15)
            .fontColor(this.subColor())
            .width('100%')
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(interaction.options, (option: string, index: number) => {
          Row({ space: 8 }) {
            Text(String.fromCharCode(65 + index))
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.picked.indexOf(option) >= 0 ? '#FFFFFF' : this.botBlue())
              .padding({ left: 8, right: 8, top: 5, bottom: 5 })
              .backgroundColor(this.picked.indexOf(option) >= 0
                ? this.botBlue()
                : (this.isDark ? 'rgba(161,191,246,0.12)' : 'rgba(46,107,230,0.12)'))
              .borderRadius(7)
            Text(option)
              .fontSize(16)
              .fontColor(this.ink())
          }
          .alignItems(VerticalAlign.Center)
          .padding({ right: 8 })
          .margin({ right: 6, bottom: 6 })
          .onClick(() => {
            this.togglePick(option, interaction.multiSelect);
          })
        })
      }
      .width('100%')

      TextArea({ text: this.customAnswer, placeholder: '补充回答（可留空）' })
        .fontSize(15)
        .height(64)
        .fontColor(this.ink())
        .placeholderColor(this.subColor())
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)')
        .borderRadius(12)
        .onChange((value: string) => {
          this.customAnswer = value;
        })

      Button('提交回答')
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
        .backgroundColor(this.picked.length === 0 && this.customAnswer.trim().length === 0
          ? 'rgba(46,107,230,0.4)' : this.botBlue())
        .borderRadius(14)
        .height(44)
        .width('100%')
        .enabled(this.picked.length > 0 || this.customAnswer.trim().length > 0)
        .onClick(() => {
          const ok: boolean = BotStore.get().answerQuestion(interaction.id, this.picked, this.customAnswer);
          if (ok) {
            this.picked = [];
            this.customAnswer = '';
          }
        })
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .borderRadius(20)
    .border({ width: 1, color: this.lineColor() })
    .margin({ bottom: MESSAGE_ROW_GAP })
    .alignItems(HorizontalAlign.Start)
  }

  /** §5.2 审批卡：拒绝 / 仅允许这一次 */
  @Builder
  approvalCard(interaction: BotInteraction) {
    Column({ space: 12 }) {
      Column({ space: 6 }) {
        Text('需要你批准')
          .fontSize(12)
          .fontColor('#E0A03C')
          .width('100%')
        Text(interaction.title)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.ink())
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (interaction.detail.length > 0) {
          Text(interaction.detail)
            .fontSize(15)
            .fontColor(this.subColor())
            .maxLines(4)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Row({ space: 10 }) {
        Button('拒绝')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#D9413A')
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.04)')
          .borderRadius(14)
          .height(44)
          .layoutWeight(1)
          .onClick(() => {
            BotStore.get().answerApproval(interaction.id, false);
          })
        Button('仅允许这一次')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .backgroundColor(this.botBlue())
          .borderRadius(14)
          .height(44)
          .layoutWeight(1)
          .onClick(() => {
            BotStore.get().answerApproval(interaction.id, true);
          })
      }
      .width('100%')
    }
    .width('100%')
    .padding(16)
    .backgroundColor(this.cardColor())
    .borderRadius(20)
    .border({ width: 1, color: this.lineColor() })
    .margin({ bottom: MESSAGE_ROW_GAP })
    .alignItems(HorizontalAlign.Start)
  }

  // ==================== 输入条（对齐工作模式会话页） ====================

  /**
   * 收起态细胶囊：底色/描边全部交给外层 HdsGlassSurface 的系统沉浸光感材质，
   * 这里只排内容（与工作模式 ConversationComposer 收起态同一套做法：内容透明、玻璃由背板渲染）。
   */
  @Builder
  composerCapsule() {
    Row({ space: 6 }) {
          // 左「+」：与工作模式折叠态 composer-plus-inline 同尺寸（36 圆 + 0.9 描边）
          this.plusButton(36)
          // 占位文字区：文字态轻点展开输入；语音态按住说话（与工作模式 voice-touch-surface 一致）
          Stack({ alignContent: Alignment.Start }) {
            Text(this.voiceRecording ? this.voiceStatus
              : (this.voiceInputEnabled && this.voiceMode ? '按住说话' : this.placeholderText()))
              .fontSize(this.voiceRecording ? 13 : 15)
              .fontColor(this.voiceCancelArmed ? '#D9413A'
                : (this.isDark ? 'rgba(241,244,250,0.42)' : 'rgba(16,19,24,0.34)'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
            if (this.voiceInputEnabled) {
              Column()
                .width('100%')
                .height('100%')
                .backgroundColor('#00000000')
                .onTouch((event: TouchEvent) => this.onVoiceTouch(event))
            }
          }
          .layoutWeight(1)
          .height(36)
          .onClick(() => {
            if (this.voiceHoldConsumed) {
              this.voiceHoldConsumed = false;
              return;
            }
            if (this.voiceRecording) {
              return;
            }
            if (this.voiceMode) {
              this.toggleVoiceMode();
              return;
            }
            this.focusComposer();
          })
          // 右侧主圆钮：与工作模式同一套三态（发送箭头 / 麦克风键盘切换），
          // 收起与展开时都固定在同一个蓝色圆钮位置。
          this.composerPrimaryButton()
    }
    .width('100%')
    .height(CAPSULE_HEIGHT)
    .padding({ left: 8, right: 8, top: 8, bottom: 8 })
    .alignItems(VerticalAlign.Center)
    // 圆角与材质由外层 HdsGlassSurface 提供（与工作模式一致），内容自身透明
    .backgroundColor(Color.Transparent)
  }

  /**
   * 展开态：与工作模式对话页输入框的展开样式逐项一致 ——
   * 自绘磨砂卡（backdropBlur 22）+ 半透明白底（深色 rgba(30,30,32,0.72) / 浅色 rgba(255,255,255,0.72)）
   * + 1vp #66FFFFFF 细亮边 + 圆角 28 + 内边距 14/14/12/12；底部 chip 行「+」27 + 发送 36。
   */
  @Builder
  composerCard() {
    Column() {
      if (this.pickedAttachments.length > 0) {
        this.attachmentRow()
      }
      // 语音模式：展开卡原地切成「按住说话」（与工作模式一致：不再显示键盘输入，改为长按录音面）
      if (this.voiceMode && this.voiceInputEnabled) {
        Stack({ alignContent: Alignment.Start }) {
          Text(this.voiceRecording ? this.voiceStatus : '按住说话')
            .fontSize(this.voiceRecording ? 14 : 16)
            .fontColor(this.voiceCancelArmed ? '#D9413A' : this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          Column()
            .width('100%')
            .height('100%')
            .backgroundColor('#00000000')
            .onTouch((event: TouchEvent) => this.onVoiceTouch(event))
        }
        .width('100%')
        .height(38)
      } else {
      TextArea({ text: this.draft, placeholder: this.placeholderText() })
        .id('bot-chat-draft')
        .fontSize(16)
        .fontColor(this.ink())
        .placeholderColor(this.isDark ? 'rgba(241,244,250,0.42)' : 'rgba(16,19,24,0.34)')
        .backgroundColor(Color.Transparent)
        .padding(0)
        .constraintSize({ minHeight: 38, maxHeight: 132 })
        .borderRadius(0)
        .onChange((value: string) => {
          this.draft = value;
        })
        .onFocus(() => {
          this.composerFocused = true;
        })
        .onBlur(() => {
          // 与工作模式一致：有草稿/附件时失焦只收键盘，输入条保持展开高度
          const keepExpanded: boolean = this.draft.trim().length > 0 || this.pickedAttachments.length > 0;
          this.getUIContext().animateTo({ duration: 250, curve: Curve.EaseOut }, () => {
            this.composerFocused = keepExpanded;
          });
        })
      }

      // 展开态底部 chip 行：左「+」（27 圆）+ Blank + 主圆钮（36 圆，与工作模式同一位置同一尺寸）
      // 主圆钮三态与工作模式 primaryButton 一致：有草稿/附件 → 发送箭头；
      // 否则开了语音 → 麦克风/键盘切换（始终占据这个蓝色圆钮的位置，不会左右跳）。
      Row({ space: 0 }) {
        this.plusButton(27)
        Blank()
        this.composerPrimaryButton()
      }
      .width('100%')
      .height(34)
      .margin({ top: 8 })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .padding({ left: DOCK_SIDE, right: DOCK_SIDE, top: 12, bottom: 12 })
    // 展开态自己画玻璃，不走 HdsGlassSurface 的悬浮胶囊背板：
    // 工作模式就是这样（展开 = 28 圆角玻璃卡 + 22 模糊 + 半透明底 + 1px 细亮边），
    // 若仍套悬浮 Bar，圆角会被胶囊几何带成椭圆。
    .borderRadius(DOCK_RADIUS)
    .backdropBlur(22)
    .backgroundColor(this.isDark ? 'rgba(30,30,32,0.72)' : 'rgba(255,255,255,0.72)')
    .border({ width: 1, color: '#66FFFFFF' })
    .clip(true)
    .alignItems(HorizontalAlign.Start)
  }

  /**
   * 输入条主圆钮（与工作模式 primaryButton 同一套位置/尺寸/三态）：
   *   可发送 → 发送箭头；否则开了语音 → 麦克风/键盘切换；都没开 → 置灰箭头。
   * 语音图标始终在这个蓝色圆钮里，不会因为展开/收起换位置。
   */
  @Builder
  composerPrimaryButton() {
    Stack() {
      if (this.canSend()) {
        Image($r('app.media.arrow_up_white'))
          .width(18)
          .height(18)
          .objectFit(ImageFit.Contain)
          .draggable(false)
      } else if (this.voiceInputEnabled) {
        Image(this.voiceMode ? $r('app.media.voice_keyboard') : $r('app.media.voice_wave'))
          .width(18)
          .height(18)
          .objectFit(ImageFit.Contain)
          .draggable(false)
          .syncLoad(true)
      } else {
        Image($r('app.media.arrow_up_white'))
          .width(18)
          .height(18)
          .objectFit(ImageFit.Contain)
          .draggable(false)
      }
    }
    .width(SEND_EXPANDED_SIZE)
    .height(SEND_EXPANDED_SIZE)
    .borderRadius(SEND_EXPANDED_SIZE / 2)
    .backgroundColor('#2E6BE6')
    .opacity(this.sending ? 0.66 : (this.canSend() || this.voiceInputEnabled ? 1 : 0.48))
    .enabled(!this.sending)
    .accessibilityText(this.canSend() ? '发送消息'
      : (this.voiceMode ? '切换到文字输入' : '切换到语音输入'))
    .onClick(() => {
      if (this.sending) {
        return;
      }
      if (this.canSend()) {
        this.onSend();
        return;
      }
      if (this.voiceInputEnabled) {
        this.toggleVoiceMode();
      }
    })
  }


  /**
   * 语音输入的全屏浮层（页面中间显示文字）：
   *   录音中 —— 大号「正在聆听…」+ 实时音量条 + 提示「松手转文字 / 上滑取消」；
   *   转写中 —— 「正在识别…」；
   * 松手后识别结果直接写进输入框草稿。挂载顺序在输入条之上，保证盖住其它内容。
   */
  @Builder
  voiceHud() {
    Column({ space: 14 }) {
      Text(this.voiceRecording ? (this.voiceCancelArmed ? '松手取消'
        : (this.voiceLiveText.length > 0 ? this.voiceLiveText : '正在聆听…')) : '正在识别…')
        .fontSize(this.voiceLiveText.length > 0 && this.voiceRecording ? 16 : 20)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
        .maxLines(4)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Center)
      Row({ space: 4 }) {
        ForEach([0, 1, 2, 3, 4, 5, 6], (index: number) => {
          Column()
            .width(4)
            .height(this.voiceLevelBar(index))
            .borderRadius(2)
            .backgroundColor('rgba(255,255,255,0.85)')
        }, (index: number) => index.toString())
      }
      .height(36)
      .alignItems(VerticalAlign.Bottom)
      Text(this.voiceRecording ? '松手转文字 · 上滑取消' : '马上就好')
        .fontSize(13)
        .fontColor('rgba(255,255,255,0.72)')
    }
    .width(220)
    .padding({ left: 24, right: 24, top: 22, bottom: 22 })
    .borderRadius(24)
    .backgroundColor('rgba(20,20,24,0.72)')
    .border({ width: 0.8, color: 'rgba(255,255,255,0.18)' })
    .backdropBlur(24)
    .alignItems(HorizontalAlign.Center)
  }

  /** 启动「边说边转」：录音期间每 900ms 把已录音频发给网关转一次，中间结果实时显示 */
  private startLiveTranscribe(): void {
    this.stopLiveTranscribe();
    this.voiceLiveText = '';
    this.voiceLiveTimer = setInterval(() => {
      const limits: SpeechLimits | null = this.speechLimits;
      if (limits === null || this.voicePhase !== 'recording' || this.voiceLiveBusy) {
        return;
      }
      this.voiceLiveBusy = true;
      const task: Promise<void> = this.dictation.transcribePartial(limits).then((text: string) => {
        this.voiceLiveBusy = false;
        if (text.length > 0 && this.voicePhase === 'recording') {
          this.voiceLiveText = text;
        }
      }).catch(() => {
        this.voiceLiveBusy = false;
      });
      this.voiceLiveInFlight = task;
      task.then(() => {
        if (this.voiceLiveInFlight === task) {
          this.voiceLiveInFlight = null;
        }
      });
    }, 900);
  }

  private stopLiveTranscribe(): void {
    if (this.voiceLiveTimer >= 0) {
      clearInterval(this.voiceLiveTimer);
      this.voiceLiveTimer = -1;
    }
  }

  /**
   * 等「边说边转」的在途请求结束（最多 2.5s）。
   * 网关同一时刻只允许一个转写：不等它结束就发最终转写，会被回 request busy，
   * 最终结果就丢了（表现出来就是「松手偶尔没字」）。
   */
  private async waitLiveIdle(): Promise<void> {
    const pending: Promise<void> | null = this.voiceLiveInFlight;
    if (pending === null) {
      return;
    }
    await Promise.race([
      pending.catch(() => {
      }),
      new Promise<void>((resolve: () => void) => {
        setTimeout(() => resolve(), 2500);
      })
    ]);
    this.voiceLiveBusy = false;
    this.voiceLiveInFlight = null;
  }

  /** 中间浮层的音量条高度：读 dictation 的实时音量，5 档随机化让它看起来在跳动 */
  private voiceLevelBar(index: number): number {
    const level: number = this.voiceRecording ? this.dictation.level() : 0.12;
    const seed: number = (index * 37) % 11;
    const scale: number = 0.35 + (seed / 11) * 0.9;
    const height: number = 6 + level * 26 * scale;
    return height < 4 ? 4 : height;
  }

  @Builder
  composerDock() {
    Column({ space: 8 }) {
      if (this.hint.length > 0) {
        Text(this.hint)
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
          .padding({ left: 4, right: 4 })
      }
      if (this.state.error !== undefined && this.state.error.length > 0) {
        Text(this.state.error)
          .fontSize(12)
          .fontColor('#D65D64')
          .width('100%')
          .padding({ left: 4, right: 4 })
      }
      // 与工作模式对话页完全同一套分层：
      //   收起态 —— 系统沉浸光感背板（HdsGlassSurface 悬浮胶囊，半径=高度一半）+ 透明内容；
      //   展开态 —— 不再叠背板（两个轮廓相叠会在圆角处露出胶囊弧线），改由 composerCard
      //             自己画 28 圆角玻璃卡（backdropBlur 22 + 半透明底 + 1px 细亮边）。
      if (this.composerExpanded()) {
        this.composerCard()
      } else {
        // 收起态：系统沉浸光感胶囊背板（HdsGlassSurface）负责材质与圆角，内容透明浮在上面。
        // 注意 ArkUI 不允许在 trailing closure 之后再链式挂属性，这里用外层 Column 撑满宽度。
        Column() {
          HdsGlassSurface({ radiusRatio: 0.5 }) {
            Column() {
              this.composerCapsule()
            }
            .width('100%')
          }
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding({
      left: DOCK_SIDE + this.wideInset(),
      right: DOCK_SIDE + this.wideInset(),
      bottom: DOCK_BOTTOM + this.safeBottom
    })
    .onAreaChange((_old: Area, next: Area) => {
      const height: number = Number(next.height);
      if (height > 0 && Math.abs(height - this.dockHeight) > 1) {
        this.dockHeight = height;
      }
    })
    // 输入区自己要参与命中测试：否则横向拖拽会穿透到底层列表
    .hitTestBehavior(HitTestMode.Default)
    .onClick(() => {
    })
    .gesture(
      PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 6 })
        .onActionStart(() => {
        })
        .onActionUpdate(() => {
        })
    )
  }

  @Builder
  unsupportedBody() {
    Column({ space: 8 }) {
      Text('主机未启用 DS-Bot')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.ink())
      Text('在电脑上安装并启用官方 DS-Bot 插件后，这里会显示 Bot 团队。')
        .fontSize(15)
        .fontColor(this.subColor())
        .textAlign(TextAlign.Center)
    }
    .layoutWeight(1)
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .padding(30)
  }

  build() {
    HdsNavDestination() {
      Stack({ alignContent: Alignment.Bottom }) {
        Column() {
          if (!this.state.supported) {
            this.unsupportedBody()
          } else {
            // 时间线视口：底边裁到输入框底边（对齐工作模式）：正文从输入框玻璃后面滚过、
            // 到输入框底部直接消失；视口下方不再铺任何遮罩/渐隐层。
            Stack({ alignContent: Alignment.Bottom }) {
            List({ scroller: this.scroller }) {
              // 顶部让位：状态栏 + 原生标题栏（内容从标题栏下滚过）
              ListItem() {
                Column()
                  .width('100%')
                  // 64 + safeTop：与工作模式会话页（64 + topSafe）完全一致
                  .height(this.topInset() + TITLE_BAR_HEIGHT + 8)
              }

              if (this.state.hasEarlier) {
                ListItem() {
                  this.earlierRow()
                }
              }

              ForEach(this.state.messages, (message: BotChatMessage) => {
                ListItem() {
                  this.messageRow(message)
                }
              }, (message: BotChatMessage) => message.id + '|' + message.text.length.toString()
                + '|' + (message.streaming ? '1' : '0') + '|' + (message.delivery ?? '')
                + '|' + message.images.length.toString() + '|' + message.files.length.toString()
                + '|' + message.questionAnswers.length.toString())

              // 待处理交互卡：时间线内（§5.1 / §5.2）
              if (this.pendingApproval() !== null) {
                ListItem() {
                  Row() {
                    this.approvalCard(this.pendingApproval() as BotInteraction)
                  }
                  .width('100%')
                  .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
                  .alignItems(VerticalAlign.Top)
                }
              }
              if (this.pendingQuestion() !== null) {
                ListItem() {
                  Row() {
                    this.questionCard(this.pendingQuestion() as BotInteraction)
                  }
                  .width('100%')
                  .padding({ left: DOCK_SIDE, right: DOCK_SIDE })
                  .alignItems(VerticalAlign.Top)
                }
              }

              if (this.showLiveWork()) {
                ListItem() {
                  this.liveWorkRow()
                }
              }

              if (this.state.messages.length === 0 && this.state.historyLoading) {
                ListItem() {
                  Column() {
                    LoadingProgress()
                      .width(22)
                      .height(22)
                      .color(this.botBlue())
                    Text('正在读取聊天…')
                      .fontSize(12.5)
                      .fontColor(this.subColor())
                      .margin({ top: 8 })
                  }
                  .width('100%')
                  .padding({ top: 40, bottom: 40 })
                  .justifyContent(FlexAlign.Center)
                }
              }

              // 末尾留白：滚到底时最后一条消息停在输入框上沿（不会缩到输入框底部）
              ListItem() {
                Column()
                  .width('100%')
                  .height(this.dockHeight + 8)
              }
            }
            .width('100%')
            .height('100%')
            .scrollBar(BarState.Off)
            .edgeEffect(EdgeEffect.Spring)
            // 与工作模式一致：开始滚动就收键盘（有草稿/附件时保持展开高度，只收键盘）
            .onScrollStart(() => {
              // 展开瞬间键盘弹起会带动时间线自动滚动，这不是用户滚动：给 1 秒宽限，避免刚展开就被收回。
              if (this.composerFocused && Date.now() - this.composerExpandedAt > 1000) {
                this.collapseComposer();
              }
            })
            .onReachStart(() => {
              if (this.state.hasEarlier && !this.state.historyLoading) {
                BotStore.get().loadEarlier();
              }
            })
            }
            .width('100%')
            .height('100%')
            // 可视区底边 = 输入框底边：再往下的正文不显示
            .padding({ bottom: this.timelineClipBottom() })
          }
        }
        .width('100%')
        .height('100%')
        .backgroundColor(this.pageBg())
        .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

        if (this.state.supported) {
          // 不再叠任何底部遮罩/渐变层：工作模式对话页的底边是「时间线直接裁到输入框底边」，
          // 正文从玻璃后面滚过、到输入框底部消失，没有额外的渐隐遮罩（ConversationPage.bottomFadeOverlay
          // 只定义了但并未渲染）。之前这里加过一层 44vp 渐变，看起来就是「输入框底部有一层灰罩」。
          this.composerDock()
        }

        // 长按语音全屏特效（与工作模式同一套 VoiceRipplePanel：画布光晕 + 粒子波形 + 状态文案）。
        // 必须放在 composerDock 之后：Stack 里后面的兄弟节点在上层，否则会被输入条压住。
        // 只在录音期间挂载 —— 空闲时若常驻一层全屏容器，即使 hitTestBehavior(None)
        // 在部分版本上仍会吃掉页面的点击/滑动手势。
        // 语音浮层：波纹特效 + 中间实时文字卡（录音中/识别中），不拦触摸（手指仍压在输入条上）
        if (this.voiceRecording || this.voicePhase === 'transcribing') {
          Stack({ alignContent: Alignment.Center }) {
            VoiceRipplePanel({
              visible: true,
              cancelArmed: this.voiceCancelArmed,
              isDark: this.isDark,
              status: this.voiceStatus,
              readLevel: (): number => this.dictation.level()
            })
              .width('100%')
              .height('100%')
            this.voiceHud()
          }
          .width('100%')
          .height('100%')
          .hitTestBehavior(HitTestMode.None)
        }

        // 图片预览：独立 1×1 透明锚点（根节点已被角色弹窗占用 bindSheet，同节点只能挂一个）
        Column()
          .width(1)
          .height(1)
          .opacity(0.01)
          .bindSheet($$this.previewOpen, this.imagePreviewSheet(), {
            height: '82%',
            dragBar: false,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: immersiveSheetSupported() ? Color.Transparent : sheetFallbackColor(this.isDark),
            systemMaterial: sheetSystemMaterial(this.isDark)
          })

        // 交付文件预览：1×1 透明锚点，用系统半模态承载（原生玻璃材质，与图片预览同一套）。
        // ArkUI 一个节点只能挂一个 bindSheet，所以单独放在这个节点上。
        Column()
          .width(1)
          .height(1)
          .opacity(0.01)
          .bindSheet($$this.filePreviewOpen, this.filePreviewSheet(), {
            // PDF 需要更大的阅读面积：弹窗拉高到 94%，其它类型维持 78%
            height: this.filePreviewIsPdf ? '94%' : '78%',
            dragBar: true,
            showClose: false,
            preferType: SheetType.BOTTOM,
            backgroundColor: immersiveSheetSupported() ? Color.Transparent : sheetFallbackColor(this.isDark),
            systemMaterial: sheetSystemMaterial(this.isDark),
            onDisappear: () => {
              this.filePreviewLocalPath = '';
              this.filePreviewText = '';
              this.filePreviewError = '';
              if (this.filePreviewIsPdf) {
                try {
                  this.pdfController.releaseDocument();
                } catch (ignored) {
                }
                this.filePreviewIsPdf = false;
              }
            }
          })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
      .onAreaChange((_old: Area, next: Area) => {
        const width: number = Number(next.width);
        if (width > 0 && Math.abs(width - this.pageW) > 1) {
          this.pageW = width;
        }
      })
    }
    // 原生标题栏：内容从标题栏下滚过时系统渐变模糊 + 沉浸光感材质（与工作模式会话页同一套）
    .titleBar({
      avoidLayoutSafeArea: true,
      content: { stackBuilder: (): void => { this.nativeTitleBar() } },
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.GRADIENT_BLUR
        },
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.IMMERSIVE,
          materialLevel: currentGlassMaterialLevel()
        },
        originalStyle: { contentStyle: TITLE_BAR_CONTENT },
        scrollEffectStyle: { contentStyle: TITLE_BAR_CONTENT }
      }
    })
    .hideBackButton(true)
    .bindToScrollable([this.scroller])
    .backgroundColor(this.pageBg())
    .onShown(() => {
      // 从设置等二级页返回时那些页面把键盘避让改成 NONE；这里恢复 RESIZE
      try {
        this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      } catch (ignored) {
      }
      this.liveClock = Date.now();
      this.ensureLiveTimer();
      setTimeout(() => {
        try {
          this.scroller.scrollEdge(Edge.Bottom);
        } catch (error) {
        }
      }, 60);
    })
    .onHidden(() => {
      this.stopLiveTimer();
    })
    // 角色弹窗挂在根节点上：和首页 Chief 卡同一个组件、同一套样式，就地弹出
    // 注意：ArkUI 一个节点只能挂一个 bindSheet。图片预览以前也挂在这个根节点上，
    // 结果被下面的角色弹窗顶掉 → 点回复里的图片完全没反应。现在挪到独立 1×1 锚点。
    .bindSheet($$this.roleSheetOpen, this.roleSheet(), {
      height: '92%',
      dragBar: false,
      showClose: false,
      preferType: SheetType.BOTTOM,
      backgroundColor: immersiveSheetSupported() ? Color.Transparent : sheetFallbackColor(this.isDark),
      systemMaterial: sheetSystemMaterial(this.isDark)
    })
  }

  @Builder
  roleSheet() {
    BotRoleSheet({
      botId: this.roleBotId,
      onClose: () => {
        this.roleSheetOpen = false;
      }
    })
  }
}
