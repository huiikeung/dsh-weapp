import { abilityAccessCtrl, common, Want } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { curves, display, KeyboardAvoidMode, uiMaterial, window as arkWindow } from '@kit.ArkUI';
import { wideSideInset } from '../common/Responsive';
import {
  APP_GLASS_RADIUS,
  appGlassBlur,
  appGlassBorderColor,
  appGlassFill,
  appGlassShadow
} from '../common/AppGlass';
import {
  arr, field, asRec, AttachmentCache, AttachmentImageCache, bool, ConversationFeed, ConversationFeedEntry, ConversationFeedEntryModel, ConversationItem, ConversationItemKind, downloadAttachment, emptySessionGoal, GatewayClient, GatewayRequestFactory, Logger, num,
  DraftStore, PI_NS, PickedAttachment, PreferencesStore, SessionStore, SessionSummary, SpeechFailure, SpeechInput, TeamStore, WorkStepPresentation,
  normalizeRawSessionEvent, parseNamespace, pickDocuments, pickImages, str, uploadAttachment
} from 'nativecore';
import type { DirEntry, GatewayEvent, GatewayFrame, GatewayTask, GatewayGoalReference, ModelMenuItem, ModelOption, PresetOption, QueueItem, RawSessionEvent, SessionEvent, SessionGoalView, WorkspaceRow } from 'nativecore';
import type { TeamMemberView, TeamTaskView } from 'nativecore';
import type { SpeechLimits } from 'nativecore';
import type { DownloadResult, GatewayImageAttachment, UploadResult } from 'nativecore';
import type { GatewayPendingQuestionRequest, GatewayQuestion, GatewayQuestionAnswer, GatewayQuestionOption } from 'nativecore';
import { currentGlassLevel, ensureGlassLevel, currentGlassMaterialLevel } from '../common/GlassMaterial';
import { ConversationRowView } from '../components/ConversationRowView';
import { ConversationComposer, MetricMenuPair, RefChipItem, RefDirItem, RefSessionItem, SkillItem } from '../components/ConversationComposer';
import { VoiceRipplePanel } from '../components/VoiceRipplePanel';
import { NavBackButton } from '../components/NavBackButton';
import { HdsNavDestination, HdsTitleBarContentStyle, ScrollEffectType, HdsTabs, HdsBarWidthRangeOptions, HdsTabsFloatingStyle, hdsMaterial, SystemMaterialParams } from '@kit.UIDesignKit';
import { ConversationProgress } from '../components/ConversationProgress';
import { TrajectoryPanel } from '../components/TrajectoryPanel';
import { FluKeCoin } from '../components/FluKeCoin';
import { HdsGlassSurface } from '../components/HdsGlassSurface';
import { StatusBarStyle } from '../services/StatusBarStyle';
import { Haptics } from '../services/Haptics';
import { HoldingHand } from '../services/HoldingHand';

// 标题栏内容风格：滚动模糊生效时保持正文色标题（系统默认会切成白字）
const TITLE_BAR_CONTENT: HdsTitleBarContentStyle = {
  titleStyle: { mainTitleColor: $r('sys.color.font_primary') },
  menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') }
};

/** 跨页面实例的文件变更摘要缓存：退出会话再进来不需要重新请求（否则第二次打开卡片会消失） */
const sharedFileSummaries: Map<string, string> = new Map<string, string>();

/** 协作面板「只读预览」里的一行消息（对齐小程序 collaborationPreview.rows） */

/** 确认选择弹窗：单个选项 */
interface QuestionOptionView {
  label: string;
  description: string;
}

/** 确认选择弹窗：单个问题 */
interface QuestionView {
  id: string;
  header: string;
  question: string;
  detail: string;
  multiSelect: boolean;
  options: QuestionOptionView[];
}

interface TeamPreviewRow {
  key: string;
  role: string;
  text: string;
}

/** 会话节点卡带：竖向胶囊轨道高度（vp），滑块为细条 */
const TURN_TRACK_HEIGHT: number = 78;
const TURN_TRACK_WIDTH: number = 36;
const TURN_THUMB_HEIGHT: number = 44;

/** 流式期间重排时间线的最小间隔：太密会把 UI 线程占满，手指点不动、也滑不动 */
// 时间线重排的最小间隔：≈一帧。以前是 90ms，流式正文一格一格地慢半拍；
// 实际耗时超过阈值时由 timelineInterval 自适应退让，避免把主线程压死。
const TIMELINE_MIN_INTERVAL_MS: number = 120;

/** 图片发送载荷（ArkTS 不允许未声明类型的对象字面量） */
interface ImagePayload {
  mediaType: string;
  data: string;
  name: string;
}

interface UploadReceipt {
  receiptId: string;
}

/** 工作区文件条目（对齐小程序 files sheet 的 filesEntries） */
interface WorkspaceFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  bytes: number;
}

/** 会话侧栏的会话行（对齐小程序 conversation-sidebar 的 sessions） */
interface ConvSidebarSession {
  id: string;
  title: string;
  running: boolean;
  selected: boolean;
  timeText: string;
  updatedAt: number;
}

/** 会话侧栏的分组（对齐小程序 conversation-sidebar.buildGroups 的 groups） */
interface ConvSidebarGroup {
  id: string;
  title: string;
  ungrouped: boolean;
  containsCurrent: boolean;
  expanded: boolean;
  sessions: ConvSidebarSession[];
}

/** iOS AgentAvatar 彩色智能体头像（取自 dsh-mobile Assets.xcassets）。 */
const TEAM_AVATARS: Resource[] = [
  $r('app.media.agent_avatar_00'),
  $r('app.media.agent_avatar_01'),
  $r('app.media.agent_avatar_02'),
  $r('app.media.agent_avatar_03'),
  $r('app.media.agent_avatar_04'),
  $r('app.media.agent_avatar_05'),
  $r('app.media.agent_avatar_06'),
  $r('app.media.agent_avatar_07'),
  $r('app.media.agent_avatar_08'),
  $r('app.media.agent_avatar_09'),
  $r('app.media.agent_avatar_10'),
  $r('app.media.agent_avatar_11'),
  $r('app.media.agent_avatar_12'),
  $r('app.media.agent_avatar_13'),
  $r('app.media.agent_avatar_14'),
  $r('app.media.agent_avatar_15')
];

/** 指标弹层的一行（label / value），预生成后交给 ForEach。 */
interface MetricPair {
  key: string;
  label: string;
  value: string;
}

/** 会话状态卡片（对齐小程序 buildStatsGroups：标题 + [label, value] 行） */
interface StatsGroup {
  title: string;
  rows: string[][];
}

/** 权限选项行（对齐小程序 permissionSheet） */
interface PermissionRow {
  value: string;
  label: string;
  icon: string;
  current: boolean;
}

/** 模型选项行 */
interface ModelRow {
  key: string;
  provider: string;
  model: string;
  label: string;
  current: boolean;
}

/** 推理等级行 */
interface EffortRow {
  id: string;
  label: string;
  current: boolean;
}

/** 会话节点：一条用户消息 = 一个可预览/跳转的节点 */
interface TurnNode {
  /** 在 entries 中的下标 */
  entryIndex: number;
  /** 1 起的序号 */
  ordinal: number;
  /** 消息摘要（用户原话） */
  label: string;
}

/**
 * 时间线数据源：只负责行集合；同 ID 行的正文更新由 @Observed 行模型驱动。
 */
class FeedDataSource implements IDataSource {
  private rows: ConversationFeedEntryModel[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.rows.length;
  }

  getData(index: number): ConversationFeedEntryModel {
    return this.rows[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const index: number = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 全量重载：行模型是 @Observed 实例，同 ID 行的正文更新由 LazyForEach 复用原有组件驱动；
   * 这里只负责通知结构变化。
   * 注意：不要改用手工 DataOperation 增量，ArkUI 的增量替换 + @ObjectLink 组合在本机会崩（SIGSEGV）。
   */
  /**
   * 强制整表重载。行 key 里带 itemsRevision，所以组体内容变化后
   * LazyForEach 会把该行当成新条目重建 —— 这是本机唯一验证过能让组体刷新的路径。
   */
  reload(): void {
    for (const listener of this.listeners) {
      listener.onDataReloaded();
    }
  }

  /** 让指定行重建（组体内容变化时用；只重建这一行，不整表重载） */
  notifyChanged(indexes: number[]): void {
    for (const index of indexes) {
      if (index < 0 || index >= this.rows.length) {
        continue;
      }
      for (const listener of this.listeners) {
        listener.onDataChange(index);
      }
    }
  }

  update(rows: ConversationFeedEntryModel[]): void {
    const previous: ConversationFeedEntryModel[] = this.rows;
    // 纯追加是最常见的运行中结构变化（新的用户气泡、新过程组、新的上下文行）。
    // 走 onDataAdd 只创建新行，已有的行一个都不重建 —— 之前一律 onDataReloaded，
    // 每加一行就把整屏可见行拆了重建，用户看到的就是「闪一下、内容消失再出现」。
    let appendOnly: boolean = rows.length >= previous.length;
    if (appendOnly) {
      for (let index = 0; index < previous.length; index++) {
        if (previous[index] !== rows[index]) {
          appendOnly = false;
          break;
        }
      }
    }
    this.rows = rows;
    if (!appendOnly) {
      for (const listener of this.listeners) {
        listener.onDataReloaded();
      }
      return;
    }
    const added: number = rows.length - previous.length;
    if (added === 0) {
      return;
    }
    for (let index = previous.length; index < rows.length; index++) {
      for (const listener of this.listeners) {
        listener.onDataAdd(index);
      }
    }
  }
}

/**
 * 会话页（对话视图）：对齐 dsh-mobile iOS 端 ConversationView。
 *
 * 结构（自上而下）：
 *   顶栏（返回 / 标题 + 连接状态 / 更多）
 *   加载更早记录
 *   时间线（分组行 + 吸底跟随）
 *   运行中指示器（仅生成中）
 *   输入条（玻璃卡片）
 */
interface ModelSheetRow {
  key: string;
  label: string;
  badge: string;
  provider: string;
  model: string;
  current: boolean;
}

interface ModelSheetGroup {
  name: string;
  rows: ModelSheetRow[];
}

@Component
export struct ConversationPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') @Watch('onIsDarkChanged') isDark: boolean = false;
  @StorageLink('connectionState') @Watch('onConnectionChanged') connection: string = 'disconnected';
  @StorageLink('sessions') @Watch('onSessionsChangedRun') sessions: SessionSummary[] = [];
  /** 列表里的 running 变化也要重算运行条（兜底来源） */
  private onSessionsChangedRun(): void {
    this.onSessionsChangedForRef();
    if (this.ready) {
      this.refreshProgress();
    }
  }
  @StorageLink('conversationItems') @Watch('onItemsChanged') items: ConversationItem[] = [];
  @StorageLink('conversationRunning') @Watch('onRunningChanged') running: boolean = false;
  @StorageLink('historyHasMore') hasMoreHistory: boolean = false;
  /** 首屏历史加载中：显示加载骨架，而不是「新建会话」空态 */
  @StorageLink('historyLoading') historyLoading: boolean = false;
  @StorageLink('defaultPermission') defaultPermission: string = '';
  @StorageLink('defaultModel') defaultModel: string = '';
  @StorageLink('defaultEffort') defaultEffort: string = '';
  /** 当前模型的推理等级 id 列表（网关实时下发） */
  @State modelEfforts: string[] = [];
  /** 与 modelEfforts 一一对应的显示名（网关下发，如 Max） */
  @State modelEffortNames: string[] = [];
  @StorageLink('contextUsage') contextUsage: Object | null = null;
  @StorageLink('contextDashboard') dashboard: Object | null = null;
  /** 部署级默认 Agent 预设（运行模式）：新会话没有 per-session 值时用它 */
  @StorageLink('defaultAgentPreset') defaultAgentPreset: string = '';
  /** 新会话左上角「模式切换」：弹窗开关与当前显示文案 */
  @State private modeChipOpen: boolean = false;
  @State private modeChipLabel: string = '标准模式';
  /** 每会话运行模式缓存（sessionId → preset id）：网关每会话回执/事件写入 */
  @StorageLink('sessionAgentPresets') sessionAgentPresets: Record<string, Object> = {};
  /** 预设详细列表：提供网关下发的显示名（自定义预设名优先） */
  @StorageLink('agentPresetDetails') agentPresetDetails: PresetOption[] = [];

  @State entries: ConversationFeedEntryModel[] = [];
  /** 「@」引用菜单可选的会话列表（全部会话） */
  @State refSessions: RefSessionItem[] = [];
  /** 「/」菜单的技能列表（网关 skill 指令） */
  @State skills: SkillItem[] = [];
  /** 「@」菜单的工作区条目（来自 directories 帧） */
  @State refDirs: RefDirItem[] = [];
  @StorageLink('dirEntries') @Watch('onDirEntriesChanged') dirEntries: DirEntry[] = [];
  /** 「@」菜单当前浏览的相对目录（空 = 工作区根目录） */
  @State refCurrentPath: string = '';
  /** 已选引用 chip（蓝字 + 图标，显示在输入框上方） */
  @State refChips: RefChipItem[] = [];
  @StorageLink('dirCurrent') dirCurrent: string = '';
  @State draft: string = '';

  // ===== 长按语音输入（对齐小程序 voice-actions.js） =====
  @StorageLink('voiceInputEnabled') voiceInputEnabled: boolean = true;
  /** 当前是语音输入态（右下角显示键盘图标） */
  @State voiceMode: boolean = false;
  /** 录音/识别进行中：输入条不展开、不给发送 */
  @State voiceRecording: boolean = false;
  /** 上滑已进入取消区 */
  @State voiceCancelArmed: boolean = false;
  /** 语音阶段：idle / authorizing / starting / recording / transcribing（对齐小程序 voicePhase） */
  @State voicePhase: string = 'idle';
  /** 全屏特效是否显示：只在授权/开启/录音三段显示（和文案同一个来源） */
  @State voiceOverlayVisible: boolean = false;
  /** 特效里的状态文案（正在获取麦克风权限 / 松手转文字 · 上滑取消 / 松手取消） */
  @State voiceStatus: string = '';
  private dictation: SpeechInput = new SpeechInput();
  /** 本次录音的网关限制（catalog 结果） */
  private speechLimits: SpeechLimits | null = null;
  /** 长按会话令牌：松手/重按时让在途的 catalog+permission+start 流程自动作废 */
  private voiceHoldToken: number = 0;
  @State hint: string = '';
  // ===== 顶部轻提示（队列操作等瞬时反馈，替代输入框上方的红色小字）=====
  @State toastText: string = '';
  /** 消息图片本地缓存：'行id\u0001本地路径'（预取后供行内缩略图使用） */
  @State imagePathEntries: string[] = [];
  /** 图片预取失败的条目 id：行内改显示「加载失败」（否则离线/附件失效时永远转圈） */
  @State imageFailedEntries: string[] = [];
  /** 全屏图片预览路径（空 = 关闭） */
  @State previewImagePath: string = '';
  /** 多图预览：整组图片路径 + 当前下标（Swiper 左右翻） */
  @State previewImageList: string[] = [];
  @State previewImageIndex: number = 0;
  /** 大图预览的双指缩放比例（1~4，切图/关闭时复位） */
  @State private previewZoom: number = 1;
  private previewZoomBase: number = 1;
  /** 图片预览底部弹窗开关（对齐小程序：点缩略图从底部弹出大图） */
  @State previewImageOpen: boolean = false;
  /** 下拉刷新（加载更早历史）的动画状态 */
  @State private refreshing: boolean = false;
  /** 运行中排队的消息若带图片：按消息文本缓存本地 uri，队列卡片里显示缩略图 */
  private queuedImagesByText: Map<string, string[]> = new Map<string, string[]>();
  @State private queuedImagesRevision: number = 0;
  private lastQueuedImageAt: number = 0;
  /** 本地立即生成的「排队消息（带图）」行：text\u0001uri\u0002uri，等主机队列到达后移除 */
  @State private localQueueRows: string[] = [];
  /** 队列消息图片：attachmentId\u0001本地路径（从主机队列项的 attachmentId 拉取） */
  @State private queueThumbPaths: string[] = [];
  private queueThumbInflight: Set<string> = new Set<string>();
  /** 拉取失败的图片 id：主机不允许读取「还没进会话」的排队附件，失败就不再重试 */
  private queueThumbFailed: Set<string> = new Set<string>();
  /** 底部玻璃材质：HDS 管线 IMMERSIVE（与顶栏同一套，仅 HDS 悬浮 TabBar 渲染） */


  /** 底部 dock（队列/任务/目标+输入条）实测高度：时间线底部留白与「回到底部」按钮避让用 */
  @State private dockHeight: number = 220;
  /** 排队消息 / 任务 / 目标卡片区实测高度：时间线末尾让出同样的高度，鲸尾行不被压住 */
  @State private dockStackH: number = 0;
  /** 输入卡实测高度（composer 上报）：玻璃背板用它精确对齐 */
  @State dockCardHeight: number = 0;
  /** 胶囊高度：单独用状态驱动并参与补间，保证它和输入卡同一条动画收缩 */
  @State private dockBarHeight: number = 52;
  /** 最近一次「展开态」输入卡高度（展开/收起切换时作为动画目标值） */
  private lastExpandedCardHeight: number = 96;
  /** 指标行高度（实测：13vp 文字 + 8vp 上边距 ≈ 26vp） */
  private dockMetricsRowHeight: number = 26;
  /**
   * 悬浮 TabBar 自带的手势条避让（实测约 5vp）：我们自己的底部留白已经把安全区算进去了，
   * 系统 bar 又会自己再避让一次，不减掉这个量的话胶囊会被顶高一截（看着「偏上」）。
   */
  private dockFloatingBarGap: number = 3.3;
  /** 下拉刷新连续补页：一直加载到顶部是「用户消息」为止 */
  private pullLoadAttempts: number = 0;
  private pullLoadTimer: number = -1;
  /** 回合文件变更摘要缓存：'行id\u0001state\u0001total\u0001added\u0001deleted\u0001chips' */
  @State fileSummaries: string[] = [];
  /** 下拉刷新：循环加载更早页，直到顶部是用户消息（或没有更早记录/次数上限） */
  private pullLoadToTurnBoundary(): void {
    if (this.pullLoadTimer >= 0) {
      clearTimeout(this.pullLoadTimer);
      this.pullLoadTimer = -1;
    }
    const store: SessionStore = SessionStore.get();
    if (!this.pageVisible || !this.refreshing) {
      return;
    }
    if (this.pullLoadAttempts >= 8) {
      this.refreshing = false;
      return;
    }
    // 已有内容：顶部第一行是用户消息就停
    if (this.pullLoadAttempts > 0) {
      const first: ConversationFeedEntryModel | undefined = this.entries.length > 0 ? this.entries[0] : undefined;
      if (first !== undefined && first.kind === 'USER') {
        this.refreshing = false;
        return;
      }
    }
    if (!store.hasOlderHistory()) {
      this.refreshing = false;
      if (this.pullLoadAttempts === 0) {
        this.showToast('没有更早的记录了', false);
      }
      return;
    }
    this.pullLoadAttempts += 1;
    const sent: boolean = store.loadOlder();
    Logger.info('[PULL] attempt=' + this.pullLoadAttempts.toString() + ' sent=' + (sent ? '1' : '0'));
    this.pullLoadTimer = setTimeout(() => {
      this.pullLoadTimer = -1;
      this.pullLoadToTurnBoundary();
    }, 450);
  }

  /** 系统下拉指示器留空（只保留我们贴正文的那一条，避免顶部再冒一个转圈） */
  @Builder
  emptyRefreshIndicator() {
    Column()
      .width(0)
      .height(0)
  }

  /** 下拉刷新指示器：紧凑高度（系统默认太高会被顶部标题栏盖住） */
  @Builder
  refreshIndicator() {
    Row() {
      LoadingProgress()
        .width(20)
        .height(20)
        .color(this.subColor())
    }
    .width('100%')
    .height(22)
    .padding({ top: 0, bottom: 0 })
    .justifyContent(FlexAlign.Center)
    .alignItems(VerticalAlign.Center)
  }

  /** 思考卡「暂停跟随」的行 id */
  private reasonFollowPausedIds: Set<string> = new Set<string>();
  /** 阅读档：哪些过程行的折叠条处于展开状态 */
  private liveFoldOpenIds: Set<string> = new Set<string>();
  /** 摘要请求失败的 changeSeq 对应的行 id：允许后续重试（网关忙/断线时第一次会失败） */
  private fileSummaryFailed: Set<string> = new Set<string>();
  private fileSummaryRetryTimer: number = -1;
  /** 已编辑文件卡片内联到助手回复（显示在复制/用量/时间行上方） */
  private inlineAssistantFiles: Map<string, string[]> = new Map<string, string[]>();
  /** 上一轮「已编辑文件」内联卡片的状态签名：摘要晚到时用它判断要不要整表重载 */
  private inlineFilesSig: string = '';
  /** 内联卡片对应的变更行 seq（点文件时按 seq 拉取差异） */
  private inlineChangeSeqByAssistant: Map<string, number> = new Map<string, number>();
  /** 助手产出的图片文件（deliverables）：内联成图片卡片显示在回复下方 */
  private inlineAssistantAttachments: Map<string, string[]> = new Map<string, string[]>();
  /** 文件差异/内容弹窗：标题 + 逐行内容（首字符 +/-/空格 决定配色）+ 底部说明 */
  @State fileDiffOpen: boolean = false;
  /** 长按回复正文的底部弹窗：可选中文字、复制全文 */
  @State replySheetOpen: boolean = false;
  @State replySheetText: string = '';
  @State fileDiffTitle: string = '';
  @State fileDiffLines: string[] = [];
  @State fileDiffNote: string = '';
  /** 正文蓝色链接 → 文件内容预览（底部弹窗）：路径 / 标题 / 内容 / 加载态 */
  @State linkPreviewOpen: boolean = false;
  @State linkPreviewTitle: string = '';
  @State linkPreviewPath: string = '';
  @State linkPreviewLines: string[] = [];
  @State linkPreviewBody: string = '';
  @State linkPreviewLoading: boolean = false;
  @State linkPreviewError: string = '';
  private fileSummaryRequested: Set<string> = new Set<string>();
  @State toastError: boolean = false;
  @State toastOpacity: number = 0;
  @State toastOffset: number = -10;
  private toastTimer: number = -1;
  /** steer 失败过的排队项（多半是回合已结束）：暂时收起「立即发送」，等运行态再允许 */
  @State steerFailedIds: string[] = [];
  @State autoStick: boolean = true;
  @State sending: boolean = false;
  @State pickedAttachments: PickedAttachment[] = [];
  @State attachmentHint: string = '';
  /**
   * 折叠状态表（对齐小程序 folds 对象）：组头/回合行/步骤行共用一份，
   * 重投影、翻页、切换会话都保留；缺省由 applyWorkStepPolicy 按档位算默认可见性。
   */
  private folds: Map<string, boolean> = new Map<string, boolean>();
  /** 已展开的步骤行 id（图标换成箭头那一层）；用数组做 @Prop 传给行组件（Map 传参会崩） */
  @State stepOpenIds: string[] = [];
  /** 用户手动折叠的思考卡 id */
  @State stepClosedIds: string[] = [];
  /** 点过「完整内容」的思考卡：整段展开 */
  @State reasonFullIds: string[] = [];
  @State progressLabel: string = '';
  /** 工作步骤展示档位与收起时机（对齐 DSH 客户端 presentation policy） */
  /** 工作步骤展示档位/收起时机：响应式绑定，设置页改完立刻重排 */
  @StorageProp('workStepMode') @Watch('onWorkStepPrefsChanged') workStepMode: string = 'detailed';
  @StorageProp('workStepTiming') @Watch('onWorkStepPrefsChanged') workStepTiming: string = 'completion';
  @StorageLink('statusAppearance') statusAppearance: string = 'original';

  /** 输入条是否聚焦（决定折叠/展开两态） */
  @State composerFocused: boolean = false;
  /** 输入法高度（vp，EntryAbility 写入 AppStorage）：归零即键盘收起 → 输入条塌回单栏 */
  @StorageLink('keyboardHeightVp') @Watch('onKeyboardChanged') keyboardHeightVp: number = 0;
  /** 指标弹层：'' | run | token | context */
  @State metricPopover: string = '';
  /** 会话页顶部双 Tab：0=对话，1=轨迹（对齐 iOS 会话页，支持左右滑动切换） */
  @State sessionTab: number = 0;
  /** 顶部分页指示点（iOS 那种「两个小眼睛」）：切换时淡入，停止后淡出 */
  @State tabDotsOpacity: number = 0;
  private sessionSwiper: SwiperController = new SwiperController();
  private tabDotsTimer: number = -1;
  /** 输入条 chip 弹层：'' | model（权限改用系统菜单） */
  @State composerSheet: string = '';
  /** 团队协作开关的 ⓘ 说明气泡 */
  @State private teamInfoOpen: boolean = false;
  /** 权限菜单展开态（仅用于 ▾ 旋转与底色） */
  @State permissionMenuOpen: boolean = false;
  /** 模型弹窗展开态 */
  @State modelMenuOpen: boolean = false;
  /** 目录回传的当前模型 / provider / 推理等级 */
  @StorageLink('selectedModel') selectedModel: string = '';
  @StorageLink('selectedProvider') selectedProvider: string = '';
  @StorageLink('selectedEffort') selectedEffort: string = '';
  @State permissionRows: PermissionRow[] = [];
  @State modelRows: ModelRow[] = [];
  @State effortRows: EffortRow[] = [];
  @StorageLink('permissionValues') permissionValues: string[] = [];
  @StorageLink('modelDetails') @Watch('onModelDetailsChanged') modelOptions: ModelOption[] = [];
  /** 已请求过推理等级的「会话|模型」键：防止 models 帧 → 再请求 → 再回帧的死循环 */
  private modelEffortsKey: string = '';
  @State metricTitle: string = '';
  @State metricPairs: MetricPair[] = [];

  // ===== 智能体团队（右上角协作入口 + 成员弹层 + 团队内容面板，对齐 dsh-mobile） =====
  @StorageLink('teamVisible') teamVisible: boolean = false;
  @StorageLink('teamEnabled') teamEnabled: boolean = false;
  @StorageLink('teamMembers') teamMembers: TeamMemberView[] = [];
  @StorageLink('teamTasks') teamTasks: TeamTaskView[] = [];
  // 协作面板只读预览（对齐小程序 collaborationPreview）：不切会话，可返回列表
  @State teamPreviewActive: boolean = false;
  @State teamPreviewTitle: string = '';
  @State teamPreviewLoading: boolean = false;
  @State teamPreviewError: string = '';
  @State teamPreviewRows: TeamPreviewRow[] = [];
  /** 预览请求令牌：切成员/返回列表时让在途请求作废 */
  private teamPreviewToken: number = 0;
  @StorageLink('teamLeadSessionId') teamLeadSessionId: string = '';
  @StorageLink('teamFailure') teamFailure: string = '';
  @State teamPopoverOpen: boolean = false;
  /** 「⋯」菜单是否展开：展开时按钮显示和「协作」同款高亮底 */
  @State moreMenuOpen: boolean = false;
  @State teamSheetOpen: boolean = false;
  @State teamTaskFilter: string = 'all';
  @State teamExpandedTasks: string[] = [];
@State metricTotal: string = '';
  /** 系统状态栏高度（vp）：EntryAbility 建窗时写入 AppStorage，页面据此避让。 */
  @StorageLink('safeTopVp') topInset: number = 0;
  /** 执行图标样式（设置页「执行图标」） */
  @StorageLink('procIconStyle') procIconStyle: string = 'default';
  /** 等待回答的问题（question-requested 帧由 SessionStore 发布到这里） */
  @StorageProp('pendingQuestionJson') @Watch('onPendingQuestionChanged') pendingQuestionJson: string = '';
  @State questionOpen: boolean = false;
  @State questionRpcId: string = '';
  @State questionViews: QuestionView[] = [];
  @State questionSelections: string[][] = [];
  @State questionCustom: string[] = [];
  @State questionBusy: boolean = false;
  /** 已点「立即发送」的队列项 id：本地先隐藏，等主机队列帧收敛，避免点完还挂在队列里 */
  @State hiddenQueueIds: string[] = [];
  /** 隐藏时间戳：主机队列帧迟到时不要马上清除隐藏标记，避免行又冒出来 */
  private hiddenQueueSince: Map<string, number> = new Map<string, number>();
  @State questionCollapsed: boolean = false;
  @State questionIndex: number = 0;
  @State questionReplay: boolean = false;
  /** 等待审批的工具调用（approval-requested 帧由 SessionStore 发布到这里） */
  @StorageProp('pendingApprovalJson') @Watch('onPendingApprovalChanged') pendingApprovalJson: string = '';
  @State approvalOpen: boolean = false;
  @State approvalRpcId: string = '';
  @State approvalId: string = '';
  @State approvalTool: string = '';
  @State approvalReason: string = '';
  @State approvalReplay: boolean = false;
  @State approvalBusy: boolean = false;
  // ===== 底部 dock：排队消息 / 任务 / 目标（对齐小程序 dock-stack）=====
  @StorageLink('queueItems') @Watch('onQueueChanged') queue: QueueItem[] = [];
  @StorageLink('sessionTasks') @Watch('onTasksChanged') tasks: GatewayTask[] = [];
  @StorageLink('sessionGoal') goal: SessionGoalView = emptySessionGoal();
  @StorageLink('goalBusy') goalBusy: boolean = false;
  @State queueExpanded: boolean = false;
  @State queueBusyId: string = '';
  @State tasksExpanded: boolean = false;
  @State goalEditing: boolean = false;
  @State goalDraft: string = '';
  /** 进入「编辑目标」前的草稿：保存/取消后还原，避免吞掉用户正在写的内容 */
  private goalEditBackup: string = '';
  private goalBusyTimer: number = -1;
  /** 系统手势条高度（vp）：输入条据此抬升。 */
  @StorageLink('safeBottomVp') bottomInset: number = 0;

  private scroller: Scroller = new Scroller();
  private source: FeedDataSource = new FeedDataSource();
  private progressTimer: number = -1;
  private lastTailKey: string = '';
  private ready: boolean = false;
  /** 当前是否是这个 NavDestination 的显示态：被设置页/任务面板盖住时不再重排时间线 */
  private pageVisible: boolean = true;
  private pendingItemsWhileHidden: boolean = false;
  /** 草稿归属的会话：切会话时先落盘旧的，再读新的 */
  private draftOwnerSessionId: string = '';
  private draftSaveTimer: number = -1;
  private draftRestoreRetries: number = 0;
  /** 手指是否压在时间线上（含刚松开的一小段时间）：这段时间绝不自动吸底 */
  private listTouching: boolean = false;
  /** 手指压着列表时发生结构变化：先记下，抬手后再重建，避免重建把拖动打断 */
  private pendingStructure: boolean = false;
  /** 正在自动加载更早记录：挡住触顶时的连续触发 */
  private olderLoading: boolean = false;
  /** 吸底心跳定时器：运行中每 250ms 把列表钉到底部（比事件驱动可靠） */
  private stickTimer: number = -1;
  /** running 变 false 的时刻：10 秒内不采纳会话列表的滞后「运行中」 */
  private runningFalseAt: number = 0;
  /** 临时诊断计数 */
  private diagTick: number = 0;
  private diagApplied: number = 0;
  /** 手指按下列表的时刻：用于识别「只有 Down 没有 Up」的卡死手势 */
  private listTouchStartedAt: number = 0;
  /** 程序化滚动保护窗口：这期间触发的 onScrollStart 不是用户拖动，不能停掉吸底 */
  private stickScrollUntil: number = 0;
  /** 上次吸底滚动的时刻（节流） */
  private lastStickAt: number = 0;
  /** 正在重建列表：这期间的 onReachEnd 是重建造成的，不能当成「用户滑到底」而恢复吸底 */
  private suppressReachEnd: boolean = false;
  /** 重载后的忽略窗口（毫秒时间戳）：onDataReloaded 的 reachEnd 往往下一帧才到，布尔标记来不及挡 */
  private suppressReachEndUntil: number = 0;
  /** 列表最后一条可见行下标（onScrollIndex 维护）：判断用户是否真的滑到了底部 */
  private lastVisibleEnd: number = -1;
  private lastTouchAt: number = 0;
  private lastUserScrollAt: number = 0;
  /** 时间线重排节流（流式期间用） */
  /** 主题在本页隐藏时被改过：回到本页需要整表重载一次配色 */
  private themeDirty: boolean = false;
  private timelineTimer: number = -1;
  /** 刚切换会话、新会话内容还没落地：期间绕过「胶囊展开就冻结时间线」的保护 */
  private pendingSessionRender: boolean = false;
  /** 顶栏标题依赖的当前会话 id：切换会话时更新，保证标题跟着变（否则 Text 不重算） */
  @State pageSessionId: string = '';
  private lastTimelineUpdateAt: number = 0;
  /** 自适应重排间隔：重建很快就跟到 16ms，重活时退到 24/48ms */
  private timelineInterval: number = TIMELINE_MIN_INTERVAL_MS;

  // ==================== 生命周期 ====================
  aboutToAppear(): void {
    // 玻璃材质档位：把设置页存的档位灌回 AppStorage，所有 HdsGlassSurface 一起生效
    ensureGlassLevel();
    // 诊断：确认设备是否支持 IMMERSIVE（液态玻璃）材质
    try {
      Logger.info('GLASSDIAG immersiveSupported=' + uiMaterial.isImmersiveMaterialSupported().toString());
    } catch (err) {
      Logger.warn('GLASSDIAG check failed');
    }
    // 其他页面（首页/设置）把全局键盘避让设成了 NONE，进对话页必须恢复：
    // RESIZE = 键盘弹出时根布局收缩，输入条整体上浮到输入法上方（标题栏不动）
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    // 键盘收起（系统返回键 / 键盘自带收起键）时在同一刻折叠输入条
    this.bindKeyboardHeightListener();
    // 状态栏内容色跟随页面背景：深色纯黑 → 白，浅色灰底 → 黑
    this.applyStatusBarColor();
    this.syncWorkStepPrefs();
    // 团队半模态是全局 StorageLink：上个会话/上个页面残留 true 时，新会话页一打开就被
    // 半模态的遮罩盖住，表现成「整页点不动、滑不动」。进门先收掉。
    this.teamSheetOpen = false;
    this.ready = true;
    this.pageSessionId = SessionStore.get().currentSessionId();
    SessionStore.get().refreshPendingQuestion();
    SessionStore.get().refreshPendingApproval();
    // 进入页面前可能已经有等待中的问题/审批：主动按当前值打开一次内嵌卡片
    this.onPendingQuestionChanged();
    this.onPendingApprovalChanged();
    this.onSessionsChangedForRef();
    this.loadSkills();
    this.loadRefDirectory();
    this.rebuildRefDirs();
    // 胶囊默认态：设置里控制「默认显示 / 默认收起」
    try {
      // 进入会话页默认收起为贴边把手（用户要求：进来先收起，点开才展开）
      this.capsuleExpanded = PreferencesStore.get().getBoolean('capsuleDefaultExpanded', false);
      this.capsuleAlwaysVisible = PreferencesStore.get().getBoolean('capsuleAlwaysVisible', true);
    } catch (ignored) {
    }
    // 智感握姿：订阅左右手持握变化，卡带据此左右切换（不支持的机型静默跳过）
    try {
      HoldingHand.start();
    } catch (ignored) {
    }

    this.requestDockData();
    this.rebuildEntries();
    this.refreshProgress();
    this.refreshModelEfforts();
    this.startStickTimer();
    this.progressTimer = setInterval(() => {
      if (!this.pageVisible) {
        return;
      }
      this.refreshProgress();
      // 工作步骤档位兜底轮询：无论设置页走哪条返回路径，1s 内都会按最新偏好重排
      this.syncWorkStepLive();
      // 结构变化兜底：任何原因被推迟的重排，1s 内一定补上（防「内容冻结」）
      this.flushPendingStructure();
    }, 1000);
    // 进页恢复该会话上次没发出去的草稿
    this.restoreDraft();
  }

  /** 运行中标题最短展示：id → 已展示标题与时间戳（对齐客户端防抖） */
  private titleHold: Map<string, string> = new Map<string, string>();
  private titleHoldAt: Map<string, number> = new Map<string, number>();

  /** 读取工作步骤展示偏好（对齐 DSH 客户端 presentation policy） */
  private syncWorkStepPrefs(): void {
    const mode: string = WorkStepPresentation.ensureDefaultMode(PreferencesStore.get());
    const timing: string = WorkStepPresentation.normalizeTiming(
      PreferencesStore.get().getString(WorkStepPresentation.TIMING_KEY, 'completion'));
    AppStorage.setOrCreate<string>('workStepMode', mode);
    AppStorage.setOrCreate<string>('workStepTiming', timing);
    this.workStepMode = mode;
    this.workStepTiming = timing;
  }

  /** 轮询兜底：偏好变了就重排（@StorageProp 的 watch 漏拍时靠它保证 1s 内生效） */
  private syncWorkStepLive(): void {
    const mode: string = WorkStepPresentation.normalizeMode(
      PreferencesStore.get().getString(WorkStepPresentation.MODE_KEY, WorkStepPresentation.DEFAULT_MODE));
    const timing: string = WorkStepPresentation.normalizeTiming(
      PreferencesStore.get().getString(WorkStepPresentation.TIMING_KEY, 'completion'));
    if (mode === this.workStepMode && timing === this.workStepTiming) {
      return;
    }
    Logger.info('MODE LIVE poll ' + mode + '/' + timing + ' (was ' + this.workStepMode + '/' + this.workStepTiming + ')');
    AppStorage.setOrCreate<string>('workStepMode', mode);
    AppStorage.setOrCreate<string>('workStepTiming', timing);
    this.workStepMode = mode;
    this.workStepTiming = timing;
    this.rebuildEntries();
  }

  /** 设置页切换档位/时机后立即重排（四档才能即时生效） */
  private onWorkStepPrefsChanged(): void {
    Logger.info('MODE WATCH ' + this.workStepMode + '/' + this.workStepTiming);
    if (this.ready) {
      this.rebuildEntries();
    }
  }

  /**
   * 返回键先收输入条：键盘被返回键收起时，如果等系统收完再 collapse，就是「键盘先落、
   * 输入条再塌」两段。这里直接走 collapseComposer（清焦点 + 补间收缩），和点空白完全一致。
   * 有草稿时 collapseComposer 只收键盘、输入条保持展开；此时再按一次返回（焦点已清）
   * 放行退出页面，草稿由 aboutToDisappear 落盘，不会丢。
   */
  onBackPress(): boolean {
    // 编辑目标中：返回 = 取消编辑，还原原草稿（不退出页面）
    if (this.goalEditing) {
      this.finishGoalEdit(false);
      return true;
    }
    if (this.composerFocused) {
      this.collapseComposer();
      return true;
    }
    return false;
  }

  aboutToDisappear(): void {
    this.unbindKeyboardHeightListener();
    this.stopStickTimer();
    HoldingHand.stop();
    this.ready = false;
    if (this.progressTimer >= 0) {
      clearInterval(this.progressTimer);
      this.progressTimer = -1;
    }
    if (this.timelineTimer >= 0) {
      clearTimeout(this.timelineTimer);
      this.timelineTimer = -1;
    }
    // 离页前把草稿落盘（含防抖里还没写的那一次）
    this.flushDraft();
    // 离页时收掉录音：不然麦克风会一直占着
    this.voiceHoldToken++;
    if (this.dictation.isActive()) {
      this.dictation.cancel();
    }
    this.resetVoice();
  }

  /** 输入法收起（高度归零）时塌回：无草稿无附件回单栏，有草稿保持展开卡片（对齐小程序 onKeyboardHide） */
  private onKeyboardChanged(propName: string): void {
    if (propName !== 'keyboardHeightVp' || this.keyboardHeightVp > 0 || !this.composerFocused) {
      return;
    }
    // 输入条弹层（权限/模型选择）开着时不塌回：塌回会连带卸载 chip 行，弹窗跟着消失
    if (this.composerSheet.length > 0) {
      return;
    }
    this.composerFocused = false;
  }

  // ==================== 输入条指标（对齐小程序 composer-metrics） ====================
  /** 占位符：未聚焦且空草稿时显示「描述你想要构建的内容」，聚焦后显示输入提示。 */
  private composerPlaceholder(): string {
    return '描述你想要构建的内容';
  }

  /** 权限胶囊图标字符（对齐小程序 permissionIcon）。 */
  private permissionIconGlyph(): string {
    if (this.defaultPermission === 'read-only') {
      return '◐';
    }
    if (this.defaultPermission === 'workspace-write') {
      return '✎';
    }
    if (this.defaultPermission === 'danger-full-access') {
      return '⚠';
    }
    return '⛨';
  }

  /** 模型徽章（会话内模型选择器未接入时为空）。 */
  private modelBadge(): string {
    return '';
  }

  /** 推理等级文案（low/medium/high → 低/中/高）。 */
  private effortLabel(): string {
    const effort: string = this.defaultEffort;
    if (effort === 'low') {
      return '低';
    }
    if (effort === 'medium') {
      return '中';
    }
    if (effort === 'high') {
      return '高';
    }
    return '';
  }

  /** 运行指标：「N 轮 M 步」（对齐小程序 composerRunMetric）。 */
  private runMetric(): string {
    const turns: number = this.sessionTurnCount();
    const steps: number = this.sessionStepCount();
    const turnText: string = turns >= 0 ? turns.toString() : '—';
    const stepText: string = steps >= 0 ? steps.toString() : '—';
    return turnText + ' 轮 ' + stepText + ' 步';
  }

  /** token 指标：「12.3K tok · 45%」（对齐小程序 composerTokenMetric）。 */
  private tokenMetric(): string {
    const total: number = this.sessionTokenTotal();
    if (total < 0) {
      return '— tok';
    }
    let compact: string = total.toString();
    if (total >= 1000000) {
      compact = (total / 1000000).toFixed(total % 1000000 === 0 ? 0 : 1) + 'M';
    } else if (total >= 1000) {
      compact = (total / 1000).toFixed(1) + 'K';
    }
    // 输入框底部指标：总量 + 缓存命中率（弹层内用 tokenTotalLabel，不带百分比）
    const hit: number = this.sessionCacheHitPercent();
    return hit >= 0 ? compact + ' tok · ' + hit.toString() + '%' : compact + ' tok';
  }

  /** Token 弹层标题行最右：只显示总量数字（不含命中率） */
  private tokenTotalLabel(): string {
    const total: number = this.sessionTokenTotal();
    if (total < 0) {
      return '';
    }
    if (total >= 1000000) {
      return (total / 1000000).toFixed(total % 1000000 === 0 ? 0 : 1) + 'M tok';
    }
    if (total >= 1000) {
      return (total / 1000).toFixed(1) + 'K tok';
    }
    return total.toString() + ' tok';
  }

  /** 上下文弹层标题行最右：已用 / 窗口（如 ~523K / 1M） */
  private contextTotalLabel(): string {
    const used: number = this.contextUsedTokens();
    const window: number = this.contextWindowTokens();
    if (used < 0 || window < 0) {
      return '';
    }
    return '~' + this.compactTok(used) + ' / ' + this.compactTok(window);
  }

  /** 上下文分段占比（系统提示词 / 工具定义 / 对话消息），用于标题下彩色用量条 */
  private contextSegmentPercent(key: string): number {
    // 口径：各分段占「上下文窗口」的比例（不是占分段合计），这样彩条长度 = 实际占用宽度，
    // 剩余部分留出底轨，视觉上和小程序 ctx-bar 一致。
    const window: number = this.contextWindowTokens();
    if (window <= 0) {
      return 0;
    }
    const system: number = this.breakdownNum('systemTokens');
    const tools: number = this.breakdownNum('toolsTokens');
    const messages: number = this.breakdownNum('messageTokens');
    if (system < 0 && tools < 0 && messages < 0) {
      // 网关没给 contextUsage.breakdown：彩条退回用 token 用量三项着色
      //   系统槽 ← 未缓存输入（灰）、工具槽 ← 缓存读取（紫）、消息槽 ← 模型输出（蓝）
      // 否则整条彩条只剩底轨，看起来就是「颜色块没有」。
      const uncached: number = Math.max(0, this.tokenValue('uncachedInputTokens', true));
      const cacheRead: number = Math.max(0, this.tokenValue('cacheReadTokens', false));
      const output: number = Math.max(0, this.tokenValue('outputTokens', false));
      const sum: number = uncached + cacheRead + output;
      if (sum <= 0) {
        return 0;
      }
      // 三项是会话累计量（可能远超上下文窗口），不能直接除以 window：
      // 先按三者占比分配，再整体缩放到「上下文已用比例」，彩条长度才等于 47% 这类真实占用。
      const usedPercent: number = this.contextPercent();
      const usedFraction: number = usedPercent >= 0 ? Math.min(1, usedPercent / 100) : 1;
      const fallback: number = key === 'systemTokens' ? uncached
        : (key === 'toolsTokens' ? cacheRead : output);
      return Math.min(1, (fallback / sum) * usedFraction);
    }
    const value: number = Math.max(0, key === 'systemTokens' ? system
      : (key === 'toolsTokens' ? tools : messages));
    return Math.min(1, value / window);
  }

  /** 上下文指标：「37%」。 */
  private contextMetric(): string {
    const percent: number = this.contextPercent();
    return percent >= 0 ? percent.toString() + '%' : '—%';
  }

  /** 上下文占用百分比（已用 / 窗口，来自 pressureRecord 的候选）。 */
  private contextPercent(): number {
    const used: number = this.contextUsedTokens();
    const window: number = this.contextWindowTokens();
    if (used < 0 || window <= 0) {
      return -1;
    }
    const percent: number = Math.round((used * 100) / window);
    return Math.max(0, Math.min(100, percent));
  }

  private sessionTurnCount(): number {
    if (this.dashboard === null) {
      return -1;
    }
    const record = asRec(this.dashboard);
    if (record === undefined) {
      return -1;
    }
    const stats = asRec(record['stats']);
    if (stats === undefined) {
      return -1;
    }
    const turns: number = num(stats, 'turns') ?? -1;
    return turns >= 0 ? turns : -1;
  }

  private sessionStepCount(): number {
    if (this.dashboard === null) {
      return -1;
    }
    const record = asRec(this.dashboard);
    if (record === undefined) {
      return -1;
    }
    const stats = asRec(record['stats']);
    if (stats === undefined) {
      return -1;
    }
    const steps: number = num(stats, 'steps') ?? -1;
    return steps >= 0 ? steps : -1;
  }

  /** 会话 token 总量：计费输入（未缓存 + 缓存读 + 缓存写）+ 输出。 */
  private sessionTokenTotal(): number {
    const tokens = asRec(this.tokenUsageRecord());
    if (tokens === undefined) {
      return -1;
    }
    const totals = asRec(tokens['totals']);
    const uncached: number = this.tokenBucket(tokens, totals, 'uncachedInputTokens');
    const cacheRead: number = this.tokenBucket(tokens, totals, 'cacheReadTokens');
    const cacheWrite: number = this.tokenBucket(tokens, totals, 'cacheWriteTokens');
    const input: number = this.tokenBucket(tokens, totals, 'inputTokens');
    const output: number = this.tokenBucket(tokens, totals, 'outputTokens');
    let billed: number = input;
    if (uncached >= 0 && cacheRead >= 0 && cacheWrite >= 0) {
      billed = uncached + cacheRead + cacheWrite;
    }
    if (billed < 0 || output < 0) {
      return -1;
    }
    return billed + output;
  }

  /** 缓存命中率（cacheRead / 计费输入）。 */
  private sessionCacheHitPercent(): number {
    const tokens = asRec(this.tokenUsageRecord());
    if (tokens === undefined) {
      return -1;
    }
    const totals = asRec(tokens['totals']);
    const cacheRead: number = this.tokenBucket(tokens, totals, 'cacheReadTokens');
    const uncached: number = this.tokenBucket(tokens, totals, 'uncachedInputTokens');
    const cacheWrite: number = this.tokenBucket(tokens, totals, 'cacheWriteTokens');
    const input: number = this.tokenBucket(tokens, totals, 'inputTokens');
    let billed: number = input;
    if (uncached >= 0 && cacheRead >= 0 && cacheWrite >= 0) {
      billed = uncached + cacheRead + cacheWrite;
    }
    if (cacheRead < 0 || billed <= 0) {
      return -1;
    }
    return Math.round((cacheRead * 100) / billed);
  }

  // ==================== 投影 ====================
  /** 把 native-core 的对话条目折叠成显示行，并保留展开状态。 */
  /** 拉取回合文件变更摘要（对齐小程序 loadChangesSummaries：最多 2 个并发，按 changeSeq 缓存） */
  private loadFileSummaries(rows: ConversationFeedEntry[]): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || !GatewayClient.get().isConnected()
      || !GatewayClient.get().supportsWorkspaceChanges()) {
      return;
    }
    // 先用跨实例缓存补上已拿到的摘要，避免「重新进入会话卡片消失」
    let seeded: boolean = false;
    for (const row of rows) {
      if (row.kind !== 'CHANGES') {
        continue;
      }
      const cached: string | undefined = sharedFileSummaries.get(row.id);
      if (cached === undefined) {
        continue;
      }
      let exists: boolean = false;
      for (const item of this.fileSummaries) {
        if (item.startsWith(row.id + '\u0001')) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        this.fileSummaries = this.fileSummaries.concat([cached]);
        seeded = true;
      }
    }
    if (seeded) {
      this.scheduleTimelineUpdate();
    }
    let inflight: number = 0;
    for (const item of this.fileSummaries) {
      if (item.indexOf('\u0001loading\u0001') > 0) {
        inflight++;
      }
    }
    for (const row of rows) {
      if (row.kind !== 'CHANGES' || row.changeSeq <= 0) {
        continue;
      }
      // 之前失败过的行允许重试，否则一次 request busy 就永远没有卡片
      if (this.fileSummaryRequested.has(row.id) && !this.fileSummaryFailed.has(row.id)) {
        continue;
      }
      if (inflight >= 2) {
        break;
      }
      inflight++;
      this.fileSummaryRequested.add(row.id);
      const key: string = row.id;
      this.fileSummaries = this.fileSummaries.concat([key + '\u0001loading\u00010\u00010\u00010\u0001']);
      GatewayClient.get().requestChangesSummary(sessionId, row.changeSeq).then((frame: GatewayFrame) => {
        // 网关把插件响应放在 frame.value（对齐小程序 changes-actions.js：frame.value），
        // 之前读 'summary' 永远 undefined → 摘要一直是 missing → 「已编辑」卡片永远不显示。
        const value = asRec(frame.value as Object) ?? asRec(field(frame as Object, 'summary'));
        if (value === undefined) {
          this.replaceFileSummary(key, 'missing', 0, 0, 0, '');
          return;
        }
        const total: number = num(value, 'total') ?? 0;
        Logger.info('[CHANGES] summary ok seq=' + row.changeSeq + ' total=' + total
          + ' files=' + ((arr(value, 'files') ?? []).length));
        const added: number = num(value, 'added') ?? 0;
        const deleted: number = num(value, 'deleted') ?? 0;
        const files = arr(value, 'files') ?? [];
        if (files.length > 0) {
          Logger.info('[CHANGES] file0=' + JSON.stringify(files[0]));
        }
        const chips: string[] = [];
        for (const file of files) {
          // 兼容不同实现：path 可能缺失，用 display 兜底；增删数也兼容 additions/deletions 命名
          const rawPath: string = str(file, 'path') ?? '';
          const path: string = rawPath.length > 0 ? rawPath : (str(file, 'display') ?? '');
          const display: string = str(file, 'display') ?? path;
          const name: string = display.split('/').pop() ?? display;
          const fileAdded: string = (num(file, 'added') ?? num(file, 'additions') ?? 0).toString();
          const fileDeleted: string = (num(file, 'deleted') ?? num(file, 'deletions') ?? 0).toString();
          const binary: boolean = bool(file, 'binary') === true;
          const oversized: boolean = bool(file, 'oversized') === true;
          const hasCounts: string = binary || oversized ? '0' : '1';
          const statusNote: string = binary ? '二进制文件已变更，无法显示文本差异'
            : (oversized ? '文件过大，无法显示文本差异' : '');
          // 编码：path\u0003name\u0003display\u0003added\u0003deleted\u0003hasCounts\u0003statusNote
          // chip 内部字段必须用 \u0003：外层摘要记录用 \u0001 分隔，同字符会让外层 split 把 chip 劈开。
          chips.push(path + '\u0003' + name + '\u0003' + display + '\u0003' + fileAdded + '\u0003'
            + fileDeleted + '\u0003' + hasCounts + '\u0003' + statusNote);
        }
        Logger.info('[CHANGES] chips built n=' + chips.length.toString() + ' joinedLen=' + chips.join('\u0002').length.toString()
          + ' first=' + (chips.length > 0 ? chips[0].substring(0, 80) : '-'));
        this.fileSummaryFailed.delete(row.id);
        this.replaceFileSummary(key, 'ready', total, added, deleted, chips.join('\u0002'));
      }).catch((err: Error) => {
        this.fileSummaryFailed.add(row.id);
        Logger.warn('[CHANGES] summary failed seq=' + row.changeSeq + ' ' + err.message);
        this.replaceFileSummary(key, 'error', 0, 0, 0, '');
      });
    }
  }

  private replaceFileSummary(key: string, state: string, total: number, added: number, deleted: number, chips: string): void {
    const prefix: string = key + '\u0001';
    const value: string = key + '\u0001' + state + '\u0001' + total.toString() + '\u0001'
      + added.toString() + '\u0001' + deleted.toString() + '\u0001' + chips;
    const next: string[] = [];
    for (const item of this.fileSummaries) {
      if (item.startsWith(prefix)) {
        continue;
      }
      next.push(item);
    }
    next.push(value);
    this.fileSummaries = next;
    sharedFileSummaries.set(key, value);
    // 摘要到达后要重新折叠时间线：内联卡片的数据是在 rebuildEntries 里算的，
    // 只改 @State 不会触发重算 → 卡片永远不出现。
    this.scheduleTimelineUpdate();
  }

  /** chip 是否至少有名字或路径（避免渲染空卡片） */
  private chipHasContent(chip: string): boolean {
    const parts: string[] = chip.split('\u0003');
    const name: string = parts.length > 1 ? parts[1] : '';
    const display: string = parts.length > 2 ? parts[2] : '';
    return name.length > 0 || display.length > 0;
  }

  /** 已编辑 / 交付文件卡片编码（display\u0001name\u0001added\u0001deleted\u0001binary\u0001path） */
  private fileCardsOf(entry: ConversationFeedEntryModel): string[] {
    if (entry.kind === 'CHANGES') {
      const prefix: string = entry.id + '\u0001';
      for (const item of this.fileSummaries) {
        if (!item.startsWith(prefix)) {
          continue;
        }
        const parts: string[] = item.split('\u0001');
        if (parts.length < 6 || parts[1] !== 'ready' || parts[5].length === 0) {
          // 摘要还没到/失败：先用行自带文件列表渲染，保证「已编辑」卡片始终显示
          return this.fileChipsFromEntry(entry);
        }
        Logger.info('[CHANGES] read row parts=' + parts.length.toString() + ' state=' + parts[1]
          + ' chipsLen=' + parts[5].length.toString() + ' head=' + parts[5].substring(0, 80));
        const chips: string[] = parts[5].split('\u0002');
        const valid: string[] = [];
        for (const chip of chips) {
          if (chip.length > 0 && this.chipHasContent(chip)) {
            valid.push(chip);
          }
        }
        Logger.info('[CHANGES] row=' + entry.id + ' state=' + parts[1] + ' total=' + parts[2]
          + ' added=' + parts[3] + ' deleted=' + parts[4] + ' chips=' + chips.length + ' valid=' + valid.length);
        return valid.length > 0 ? valid : this.fileChipsFromEntry(entry);
      }
      return this.fileChipsFromEntry(entry);
    }
    return this.fileChipsFromEntry(entry);
  }

  /** 阅读档：把一组 feed 行的步骤汇总成「思考×N · 输出×N · 工具×N · 记录×N」 */
  private readingCountsOfRows(rows: ConversationFeedEntry[]): string {
    let think: number = 0;
    let out: number = 0;
    let tool: number = 0;
    let record: number = 0;
    // 已完成回合行本身 items 为空，真正的步骤在 children 里，必须一起统计
    const allGroups: ConversationFeedEntry[] = [];
    for (const group of rows) {
      allGroups.push(group);
      if (group.kind === 'TURN') {
        for (const child of group.children) {
          allGroups.push(child);
        }
      }
    }
    for (const group of allGroups) {
      for (const item of group.items) {
        const kind: string = item.kind as string;
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

  /** 阅读档：按回合内条目统计「思考×N · 输出×N · 工具×N · 记录×N」 */
  private readingTurnCountsOf(children: ConversationFeedEntry[]): string {
    let think: number = 0;
    let out: number = 0;
    let tool: number = 0;
    let record: number = 0;
    for (const group of children) {
      for (const item of group.items) {
        const kind: string = item.kind as string;
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
    return parts.join(' · ');
  }

  /** 把 feed 行的 files 转成附件 chip（kind\u0001name\u0001path\u0001attachmentId\u0001mediaType） */
  private attachmentChipsFromFiles(entry: ConversationFeedEntry): string[] {
    const out: string[] = [];
    for (const file of entry.files) {
      const path: string = file.path === undefined ? '' : file.path;
      if (path.length === 0) {
        continue;
      }
      const name: string = file.name.length > 0 ? file.name : (path.split('/').pop() ?? path);
      const lower: string = name.toLowerCase();
      let mediaType: string = '';
      if (/\.(jpg|jpeg)$/.test(lower)) {
        mediaType = 'image/jpeg';
      } else if (/\.png$/.test(lower)) {
        mediaType = 'image/png';
      } else if (/\.webp$/.test(lower)) {
        mediaType = 'image/webp';
      } else if (/\.(heic|heif)$/.test(lower)) {
        mediaType = 'image/heic';
      } else if (/\.gif$/.test(lower)) {
        mediaType = 'image/gif';
      } else if (/\.bmp$/.test(lower)) {
        mediaType = 'image/bmp';
      }
      const description: string = file.status === undefined ? '' : file.status;
      out.push('image\u0001' + name + '\u0001' + path + '\u0001' + '\u0001' + mediaType
        + '\u0001' + description);
    }
    return out;
  }

  /** 给 feed 行直接生成卡片 chip（摘要 + 行自带文件列表兜底） */
  private chipsFromFeedEntry(entry: ConversationFeedEntry): string[] {
    const prefix: string = entry.id + '\u0001';
    for (const item of this.fileSummaries) {
      if (!item.startsWith(prefix)) {
        continue;
      }
      const parts: string[] = item.split('\u0001');
      if (parts.length < 6 || parts[1] !== 'ready' || parts[5].length === 0) {
        break;
      }
      const chips: string[] = parts[5].split('\u0002');
      const valid: string[] = [];
      for (const chip of chips) {
        if (chip.length > 0 && this.chipHasContent(chip)) {
          valid.push(chip);
        }
      }
      if (valid.length > 0) {
        return valid;
      }
      break;
    }
    const out: string[] = [];
    for (const file of entry.files) {
      const path: string = file.path === undefined ? '' : file.path;
      const name: string = file.name.length > 0 ? file.name : (path.split('/').pop() ?? path);
      const display: string = path.length > 0 ? path : name;
      if (path.length === 0 && name.length === 0) {
        continue;
      }
      const hasCounts: boolean = file.added !== undefined || file.deleted !== undefined;
      out.push(path + '\u0003' + name + '\u0003' + display + '\u0003' + (file.added ?? 0).toString()
        + '\u0003' + (file.deleted ?? 0).toString() + '\u0003' + (hasCounts ? '1' : '0')
        + '\u0003' + (file.status === undefined ? '' : file.status));
    }
    return out;
  }

  /** 用行自带文件列表生成卡片 chip（摘要未就绪时的兜底，保证卡片一直显示） */
  private fileChipsFromEntry(entry: ConversationFeedEntryModel): string[] {
    const out: string[] = [];
    const list = entry.files;
    if (list === undefined || list.length === 0) {
      return out;
    }
    if (list === undefined || list.length === 0) {
      return out;
    }
    for (const file of list) {
      const path: string = file.path === undefined ? '' : file.path;
      const name: string = file.name === undefined || file.name.length === 0
        ? (path.split('/').pop() ?? path) : file.name;
      const display: string = path.length > 0 ? path : name;
      const hasCounts: boolean = file.added !== undefined || file.deleted !== undefined;
      const added: string = (file.added ?? 0).toString();
      const deleted: string = (file.deleted ?? 0).toString();
      const statusNote: string = file.status === undefined ? '' : file.status;
      out.push(path + '\u0003' + name + '\u0003' + display + '\u0003' + added + '\u0003' + deleted
        + '\u0003' + (hasCounts ? '1' : '0') + '\u0003' + statusNote);
    }
    return out;
  }

  /** 行内文件附件 chip 编码（kind\u0001name\u0001path\u0001attachmentId\u0001mediaType） */
  private attachmentChipsOf(entry: ConversationFeedEntryModel): string[] {
    const out: string[] = [];
    const list = entry.attachments;
    if (list === undefined || list.length === 0) {
      return out;
    }
    for (const att of list) {
      const kind: string = att.kind === undefined ? 'file' : att.kind;
      const path: string = att.path === undefined ? '' : att.path;
      const id: string = att.attachmentId === undefined ? '' : att.attachmentId;
      const mediaType: string = att.mediaType === undefined ? '' : att.mediaType;
      out.push(kind + '\u0001' + att.name + '\u0001' + path + '\u0001' + id + '\u0001' + mediaType);
    }
    return out;
  }

  /** 打开消息里的文件附件：按工作区路径下载到本机缓存，再交给系统查看器 */
  private async openMessageAttachment(name: string, path: string, mediaType: string): Promise<void> {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (path.length === 0 || sessionId.length === 0) {
      this.showToast(name, false);
      return;
    }
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const result: DownloadResult = await downloadAttachment(context, GatewayClient.get(), sessionId, path);
      const mime: string = mediaType.length > 0 ? mediaType : result.mediaType;
      if (mime.indexOf('image/') === 0) {
        // 图片附件：应用内弹窗预览（之前直接交给系统看图器，用户看到的是「跳出 App」）
        this.previewImagePath = result.localPath;
        this.previewImageOpen = true;
        return;
      }
      await AttachmentCache.openExternally(context, result.localPath, mime.length > 0 ? mime : 'application/octet-stream');
    } catch (err) {
      this.showToast((err as Error).message, true);
    }
  }

  /** 取某行的图片本地路径（顺序即展示顺序） */
  /** 图片路径同步到 AppStorage：行组件订阅它，下载完成即可原行出图 */
  private publishImagePaths(): void {
    AppStorage.setOrCreate<string[]>('imagePathEntries', this.imagePathEntries.slice());
  }

  private publishImageFailures(): void {
    AppStorage.setOrCreate<string[]>('imageFailedEntries', this.imageFailedEntries.slice());
  }

  /** 手动重试某行的图片（行内「加载失败」点击触发） */
  private retryImages(entryId: string): void {
    if (this.imageFailedEntries.indexOf(entryId) >= 0) {
      const next: string[] = [];
      for (const item of this.imageFailedEntries) {
        if (item !== entryId) {
          next.push(item);
        }
      }
      this.imageFailedEntries = next;
      this.publishImageFailures();
    }
    this.rebuildEntries();
  }

  /** 是否正在下载「步骤里的图片路径」 */
  private hostImageBusy: boolean = false;

  /**
   * 打开过程步骤里出现的图片路径（如「读取图片 · /tmp/a.jpg」）：
   * 通过网关门控的 file-download 把该路径下载到本机缓存，再走全屏预览。
   */
  private openHostImage(path: string): void {
    if (path.length === 0 || this.hostImageBusy) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    const sessionId: string = SessionStore.get().currentSessionId();
    if (!client.isConnected()) {
      this.hint = '未连接网关：图片需要在连接后可预览';
      return;
    }
    if (sessionId.length === 0) {
      return;
    }
    this.hostImageBusy = true;
    this.hint = '正在加载图片…';
    const context = getContext(this) as common.UIAbilityContext;
    downloadAttachment(context, client, sessionId, path, (percent: number) => {
      this.hint = '正在加载图片 ' + percent.toString() + '%';
    }).then((result: DownloadResult) => {
      this.hostImageBusy = false;
      this.hint = '';
      this.previewImagePath = result.localPath;
      this.previewImageOpen = true;
    }).catch((err: Error) => {
      this.hostImageBusy = false;
      this.hint = err.message.length > 0 ? err.message : '图片加载失败';
    });
  }

  private imagePathsFor(entryId: string): string[] {
    const out: string[] = [];
    const prefix: string = entryId + '\u0001';
    for (const item of this.imagePathEntries) {
      if (item.startsWith(prefix)) {
        out.push(item.substring(prefix.length));
      }
    }
    return out;
  }

  /** 预取消息里的图片（本地缓存命中直接用，否则按 attachmentId 向网关拉取） */
  private preloadImages(rows: ConversationFeedEntry[]): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || !GatewayClient.get().isConnected()) {
      return;
    }
    let added: string[] = [];
    // 过程步骤里的工具图片（read_image / 截图工具）：步骤行只显示文件名链接，
    // 点击弹预览 —— 这里先按 attachmentId 预取，保证点的时候大概率已在本机缓存。
    for (const row of rows) {
      if (row.items === undefined || row.items.length === 0) {
        continue;
      }
      for (const stepItem of row.items) {
        const stepImages: Object[] | undefined = stepItem.images;
        if (stepImages === undefined || stepImages.length === 0) {
          continue;
        }
        for (const raw of stepImages) {
          const image = raw as GatewayImageAttachment;
          const stepId: string = image.attachmentId === undefined ? '' : image.attachmentId;
          if (stepId.length === 0) {
            continue;
          }
          if (AttachmentImageCache.localPath(stepId, image.mediaType, image.name ?? '').length > 0) {
            continue;
          }
          AttachmentImageCache.fetch(sessionId, stepId, image.mediaType, image.name ?? '')
            .then((path: string) => {
              const value: string = row.id + '\u0001' + path;
              if (this.imagePathEntries.indexOf(value) < 0) {
                this.imagePathEntries = this.imagePathEntries.concat([value]);
                this.publishImagePaths();
              }
            })
            .catch((error: Error) => {
              Logger.warn('[IMG] step fetch failed ' + stepId.substring(0, 12) + ' ' + error.message);
            });
        }
      }
    }
    for (const row of rows) {
      if (row.images === undefined || row.images.length === 0) {
        continue;
      }
      for (const image of row.images) {
        // 本地乐观回显（刚发出去的图片）：images 里是本地 URI 字符串，
        // 之前这里只认结构化 attachmentId，于是自己发的图永远停在「图片加载中…」。
        const rawImage: Object = image as Object;
        if (typeof rawImage === 'string') {
          const localPath: string = rawImage as string;
          if (localPath.length > 0) {
            const localValue: string = row.id + '\u0001' + localPath;
            if (this.imagePathEntries.indexOf(localValue) < 0 && added.indexOf(localValue) < 0) {
              added.push(localValue);
            }
          }
          continue;
        }
        const id: string = image.attachmentId;
        if (id.length === 0) {
          continue;
        }
        const cached: string = AttachmentImageCache.localPath(id, image.mediaType, image.name ?? '');
        if (cached.length > 0) {
          const value: string = row.id + '\u0001' + cached;
          if (this.imagePathEntries.indexOf(value) < 0 && added.indexOf(value) < 0) {
            added.push(value);
          }
          continue;
        }
        Logger.info('[IMG] fetch ' + id.substring(0, 12) + ' row=' + row.id);
        AttachmentImageCache.fetch(sessionId, id, image.mediaType, image.name ?? '')
          .then((path: string) => {
            const value: string = row.id + '\u0001' + path;
            if (this.imagePathEntries.indexOf(value) < 0) {
              this.imagePathEntries = this.imagePathEntries.concat([value]);
              this.publishImagePaths();
            }
            // 成功后清掉失败标记（重试成功的场合）
            if (this.imageFailedEntries.indexOf(row.id) >= 0) {
              const next: string[] = [];
              for (const item of this.imageFailedEntries) {
                if (item !== row.id) {
                  next.push(item);
                }
              }
              this.imageFailedEntries = next;
              this.publishImageFailures();
            }
          })
          .catch((error: Error) => {
            Logger.warn('[IMG] fetch failed ' + id.substring(0, 12) + ' row=' + row.id + ' ' + error.message);
            // 失败也要记下来：否则输入框上方那条「图片 N 张加载中…」永远转圈
            if (this.imageFailedEntries.indexOf(row.id) < 0) {
              this.imageFailedEntries = this.imageFailedEntries.concat([row.id]);
              this.publishImageFailures();
            }
          });
      }
    }
    if (added.length > 0) {
      this.imagePathEntries = this.imagePathEntries.concat(added);
      this.publishImagePaths();
    }
  }

  /** 打开文件变更差异（对齐小程序 openChangedFile：workspace-changes-diff → hunks） */
  private async openChangedFileDiff(entry: ConversationFeedEntryModel, index: number): Promise<void> {
    await this.openChangedFileDiffSeq(entry.changeSeq, index);
  }

  /** 内联「已编辑文件」卡片用：只知道变更 seq 也能打开差异弹窗 */
  private async openChangedFileDiffSeq(changeSeq: number, index: number): Promise<void> {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || changeSeq <= 0) {
      return;
    }
    this.fileDiffTitle = '文件差异';
    this.fileDiffLines = [];
    this.fileDiffNote = '正在加载文件差异…';
    this.fileDiffOpen = true;
    try {
      const frame: GatewayFrame = await GatewayClient.get().requestChangesDiff(sessionId, changeSeq, index);
      // 同上：插件响应在 frame.value，旧字段名 diff 仅作兼容兜底。
      const value = asRec(frame.value as Object) ?? asRec(field(frame as Object, 'diff'));
      if (value === undefined) {
        this.fileDiffNote = '该文件的变更快照已失效';
        return;
      }
      const display: string = str(value, 'display') ?? str(value, 'path') ?? '文件差异';
      const kind: string = str(value, 'kind') ?? 'text';
      const hunks = arr(value, 'hunks') ?? [];
      const lines: string[] = [];
      for (const hunk of hunks) {
        const oldStart: number = num(hunk, 'oldStart') ?? 0;
        const oldLines: number = num(hunk, 'oldLines') ?? 0;
        const newStart: number = num(hunk, 'newStart') ?? 0;
        const newLines: number = num(hunk, 'newLines') ?? 0;
        lines.push('@@ -' + oldStart.toString() + ',' + oldLines.toString()
          + ' +' + newStart.toString() + ',' + newLines.toString() + ' @@');
        for (const line of (arr(hunk, 'lines') ?? [])) {
          const text: string = typeof line === 'string' ? (line as string) : '';
          if (text.length > 0) {
            lines.push(text);
          }
        }
      }
      this.fileDiffTitle = display;
      this.fileDiffLines = lines;
      this.fileDiffNote = kind === 'binary' ? '二进制文件已变更，无法显示文本差异'
        : (kind === 'oversized' ? '文件过大，无法显示文本差异'
          : (lines.length > 1200 ? '仅显示前 1200 行差异' : ''));
    } catch (err) {
      this.fileDiffNote = '文件差异加载失败，请关闭后重试';
    }
  }

  /** 打开文件内容弹窗：文本文件读正文；其它类型交给系统查看器 */
  private async openFileContent(name: string, path: string, mediaType: string): Promise<void> {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (path.length === 0 || sessionId.length === 0) {
      this.showToast(name, false);
      return;
    }
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const result: DownloadResult = await downloadAttachment(context, GatewayClient.get(), sessionId, path);
      const mime: string = mediaType.length > 0 ? mediaType : result.mediaType;
      const lower: string = (result.name.length > 0 ? result.name : name).toLowerCase();
      if (mime.indexOf('image/') === 0) {
        // 图片附件：下载到本地缓存后直接弹图片预览
        this.previewImagePath = result.localPath;
        this.previewImageOpen = true;
        return;
      }
      const isText: boolean = mime.startsWith('text/') || mime.indexOf('json') >= 0
        || /\.(md|markdown|txt|json|jsonl|csv|log|ya?ml|xml|html?|css|js|ts|tsx|py|sh|sql|go|rs|c|h|cpp|java|kt|swift|toml|ini|svg)$/.test(lower);
      if (isText && result.size <= 512 * 1024) {
        const content: string = await fileIo.readText(result.localPath);
        this.fileDiffTitle = result.name.length > 0 ? result.name : name;
        this.fileDiffLines = content.split('\n');
        this.fileDiffNote = '';
        this.fileDiffOpen = true;
        return;
      }
      await AttachmentCache.openExternally(context, result.localPath,
        mime.length > 0 ? mime : 'application/octet-stream');
    } catch (err) {
      this.showToast((err as Error).message, true);
    }
  }

  /** 路径里的文件名（链接标题缺失时兜底） */
  private fileNameOf(path: string): string {
    const index: number = path.lastIndexOf('/');
    return index >= 0 && index + 1 < path.length ? path.substring(index + 1) : path;
  }

  /** http(s)/mailto 等外链：保持原来的「复制链接」弹窗 */
  private showWebLinkDialog(text: string, href: string): void {
    const title: string = text.length > 0 && text !== href ? text : '链接';
    try {
      this.getUIContext().getPromptAction().showDialog({
        title: title,
        message: href,
        buttons: [
          { text: '复制链接', color: '#2E6BE6' },
          { text: '关闭', color: this.subColor() }
        ]
      }).then((result) => {
        if (result.index === 0) {
          this.copyTextToClipboard(href, '已复制链接');
        }
      }).catch((err: Error) => {
      });
    } catch (err) {
    }
  }

  private copyTextToClipboard(text: string, toastMessage: string): void {
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        this.showToast(toastMessage, false);
      }).catch((err: Error) => {
        this.showToast('复制失败', true);
      });
    } catch (err) {
      this.showToast('复制失败', true);
    }
  }

  /**
   * 正文蓝色下划线链接点击：
   * - 文件路径（工作区相对路径 / 绝对路径 / file://）→ 底部弹窗预览文件内容（只读，可复制）；
   * - http(s) / mailto 等外链 → 复制链接弹窗。
   */
  private async openMarkdownLink(text: string, href: string): Promise<void> {
    const target: string = href.trim();
    if (target.length === 0) {
      return;
    }
    const lower: string = target.toLowerCase();
    if (lower.startsWith('#') || lower.startsWith('http://') || lower.startsWith('https://')
      || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('data:')) {
      this.showWebLinkDialog(text.trim(), target);
      return;
    }
    let path: string = target;
    if (path.startsWith('file://')) {
      path = path.substring('file://'.length);
    }
    try {
      path = decodeURIComponent(path);
    } catch (err) {
    }
    const hashIndex: number = path.indexOf('#');
    if (hashIndex >= 0) {
      path = path.substring(0, hashIndex);
    }
    const queryIndex: number = path.indexOf('?');
    if (queryIndex >= 0) {
      path = path.substring(0, queryIndex);
    }
    const requested: string = path.trim();
    if (requested.length === 0) {
      this.showWebLinkDialog(text.trim(), target);
      return;
    }
    this.linkPreviewTitle = text.trim().length > 0 ? text.trim() : this.fileNameOf(requested);
    this.linkPreviewPath = requested;
    this.linkPreviewBody = '';
    this.linkPreviewLines = [];
    this.linkPreviewError = '';
    this.linkPreviewLoading = true;
    this.linkPreviewOpen = true;
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      this.linkPreviewLoading = false;
      this.linkPreviewError = '当前没有会话，无法读取文件';
      return;
    }
    const context = getContext(this) as common.UIAbilityContext;
    try {
      // 先解析成工作区相对路径（网关的下载接口只接受相对路径，链接可能是绝对路径）
      let relativePath: string = requested;
      try {
        const resolved: GatewayFrame = await GatewayClient.get().resolveFile(sessionId, requested);
        const resolvedPath: string | undefined = str(resolved, 'path');
        if (resolvedPath !== undefined && resolvedPath.length > 0) {
          relativePath = resolvedPath;
        }
        const resolvedName: string | undefined = str(resolved, 'name');
        if (resolvedName !== undefined && resolvedName.length > 0) {
          this.linkPreviewTitle = resolvedName;
        }
        this.linkPreviewPath = relativePath;
      } catch (resolveErr) {
        // 解析失败：链接可能不是工作区文件，退回按原路径尝试
      }
      const result: DownloadResult = await downloadAttachment(context, GatewayClient.get(), sessionId, relativePath);
      const mime: string = result.mediaType.toLowerCase();
      if (mime.indexOf('image/') === 0) {
        // 链接指向图片：直接走图片预览弹窗
        this.linkPreviewOpen = false;
        this.previewImagePath = result.localPath;
        this.previewImageOpen = true;
        return;
      }
      const lowerName: string = (result.name.length > 0 ? result.name : relativePath).toLowerCase();
      const isText: boolean = mime.startsWith('text/') || mime.indexOf('json') >= 0
        || /\.(md|markdown|txt|json|jsonl|csv|log|ya?ml|xml|html?|css|js|ts|tsx|jsx|ets|py|sh|sql|go|rs|c|h|cpp|java|kt|swift|toml|ini|conf|properties|gradle|dart|rb|php|vue|svelte)$/.test(lowerName);
      if (!isText) {
        this.linkPreviewLoading = false;
        this.linkPreviewError = '该文件不是文本，暂不支持预览';
        return;
      }
      if (result.size > 512 * 1024) {
        this.linkPreviewLoading = false;
        this.linkPreviewError = '文件超过 512 KB，暂不支持预览';
        return;
      }
      const content: string = await fileIo.readText(result.localPath);
      this.linkPreviewBody = content;
      this.linkPreviewLines = content.split('\n');
      this.linkPreviewLoading = false;
      if (this.linkPreviewTitle.length === 0) {
        this.linkPreviewTitle = result.name.length > 0 ? result.name : this.fileNameOf(relativePath);
      }
    } catch (err) {
      this.linkPreviewLoading = false;
      this.linkPreviewError = this.linkPreviewErrorMessage((err as Error).message);
    }
  }

  /** 网关错误文案 → 中文提示（文件不存在 / 不在工作区 / 过大 / 不可读） */
  private linkPreviewErrorMessage(raw: string): string {
    const message: string = raw.toLowerCase();
    if (message.indexOf('not-found') >= 0 || message.indexOf('not exist') >= 0) {
      return '文件不存在或已被删除';
    }
    if (message.indexOf('not-allowed') >= 0 || message.indexOf('outside') >= 0
      || message.indexOf('inside the session') >= 0) {
      return '文件不在当前会话的工作目录内';
    }
    if (message.indexOf('too-large') >= 0) {
      return '文件太大，暂不支持预览';
    }
    if (message.indexOf('unreadable') >= 0 || message.indexOf('not-regular') >= 0) {
      return '该路径不是可预览的普通文件';
    }
    if (message.indexOf('download-disabled') >= 0) {
      return '当前网关未开启文件读取';
    }
    return raw.length > 0 ? raw : '文件读取失败';
  }

  /** 文件差异弹窗内容：原生沉浸玻璃半模态（与工作区文件/切换主机同款系统材质） */
  @Builder
  fileDiffSheet() {
    Column() {
        // 自绘抓取条：系统 dragBar 在沉浸材质下常常看不见，这里补一条显式的
        Row() {
          Column()
            .width(36)
            .height(4)
            .borderRadius(2)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(16,19,24,0.18)')
        }
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .padding({ top: 8, bottom: 2 })

        Row() {
          Text(this.fileDiffTitle)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text('关闭')
            .fontSize(14)
            .fontColor('#2E6BE6')
            .onClick(() => {
              this.fileDiffOpen = false;
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 12, bottom: 8 })

        if (this.fileDiffNote.length > 0) {
          Text(this.fileDiffNote)
            .fontSize(12)
            .fontColor(this.subColor())
            .padding({ left: 16, right: 16, bottom: 8 })
        }
        Scroll() {
          Column({ space: 1 }) {
            ForEach(this.fileDiffLines, (line: string, index: number) => {
              Text(line)
                .fontSize(12)
                .fontFamily('monospace')
                .lineHeight(18)
                .fontColor(line.startsWith('+') ? '#138547' : (line.startsWith('-') ? '#CE3439'
                  : (line.startsWith('@@') ? this.subColor() : this.textColor())))
                .width('100%')
              .padding({ left: 16, right: 16 })
            }, (line: string, index: number) => index.toString())
          }
          .padding({ top: 4, bottom: 16 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  /** 多图预览：整组图片 + 起始下标，底部弹窗里 Swiper 左右翻看每一张 */
  private openImagePreviewList(paths: string[], index: number): void {
    if (paths.length === 0) {
      return;
    }
    const safeIndex: number = index >= 0 && index < paths.length ? index : 0;
    this.previewImageList = paths;
    this.previewImageIndex = safeIndex;
    this.previewImagePath = paths[safeIndex];
    this.previewImageOpen = true;
  }

  /** 预览源：本地路径补 file://，http(s)/datashare 原样使用（正文里的网络图片、相册 URI） */
  private previewSource(path: string): string {
    if (path.startsWith('http://') || path.startsWith('https://')
      || path.startsWith('file://') || path.startsWith('datashare://')) {
      return path;
    }
    return 'file://' + path;
  }

  /** 正文文件链接预览底部弹窗：只读文本内容（可复制） */
  @Builder
  linkPreviewSheet() {
    Column() {
      // 自绘抓取条
      Row() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(16,19,24,0.18)')
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .padding({ top: 8, bottom: 2 })

      Row({ space: 10 }) {
        Column({ space: 2 }) {
          Text(this.linkPreviewTitle)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
          if (this.linkPreviewPath.length > 0) {
            Text(this.linkPreviewPath)
              .fontSize(11)
              .fontColor(this.subColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        if (!this.linkPreviewLoading && this.linkPreviewError.length === 0 && this.linkPreviewBody.length > 0) {
          Text('复制')
            .fontSize(14)
            .fontColor('#2E6BE6')
            .onClick(() => {
              this.copyTextToClipboard(this.linkPreviewBody, '已复制文件内容');
            })
        }
        Text('关闭')
          .fontSize(14)
          .fontColor('#2E6BE6')
          .onClick(() => {
            this.linkPreviewOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 8 })
      .alignItems(VerticalAlign.Center)

      if (this.linkPreviewLoading) {
        Column() {
          LoadingProgress()
            .width(28)
            .height(28)
            .color('#2E6BE6')
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.linkPreviewError.length > 0) {
        Column() {
          Text(this.linkPreviewError)
            .fontSize(13)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
            .padding({ left: 24, right: 24 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Scroll() {
          Column({ space: 1 }) {
            ForEach(this.linkPreviewLines, (line: string, index: number) => {
              Text(line.length > 0 ? line : ' ')
                .fontSize(12)
                .fontFamily('monospace')
                .lineHeight(18)
                .fontColor(this.textColor())
                .width('100%')
                .padding({ left: 16, right: 16 })
            }, (line: string, index: number) => index.toString())
          }
          .padding({ top: 4, bottom: 16 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .height('100%')
  }

  // ── 确认选择弹窗（question-requested）──

  private onPendingQuestionChanged(): void {
    Logger.info('[Q] page pending len=' + this.pendingQuestionJson.length.toString());
    if (this.pendingQuestionJson.length === 0) {
      this.questionOpen = false;
      return;
    }
    try {
      const raw: Record<string, Object> = JSON.parse(this.pendingQuestionJson) as Record<string, Object>;
      const sessionId: string = typeof raw['sessionId'] === 'string' ? raw['sessionId'] as string : '';
      if (sessionId.length === 0 || sessionId !== SessionStore.get().currentSessionId()) {
        this.questionOpen = false;
        return;
      }
      const rpcId: string = typeof raw['rpcId'] === 'string' ? raw['rpcId'] as string : '';
      const rawQuestions: Object[] = Array.isArray(raw['questions']) ? raw['questions'] as Object[] : [];
      const views: QuestionView[] = [];
      for (const item of rawQuestions) {
        const rec: Record<string, Object> = item as Record<string, Object>;
        const optionsRaw: Object[] = Array.isArray(rec['options']) ? rec['options'] as Object[] : [];
        const options: QuestionOptionView[] = [];
        for (const one of optionsRaw) {
          const opt: Record<string, Object> = one as Record<string, Object>;
          options.push({
            label: typeof opt['label'] === 'string' ? opt['label'] as string : '',
            description: typeof opt['description'] === 'string' ? opt['description'] as string : ''
          });
        }
        views.push({
          id: typeof rec['id'] === 'string' ? rec['id'] as string : '',
          header: typeof rec['header'] === 'string' ? rec['header'] as string : '',
          question: typeof rec['question'] === 'string' ? rec['question'] as string : '',
          detail: typeof rec['detail'] === 'string' ? rec['detail'] as string : '',
          multiSelect: rec['multiSelect'] === true,
          options: options
        });
      }
      const selections: string[][] = [];
      const customs: string[] = [];
      for (let i = 0; i < views.length; i++) {
        selections.push([]);
        customs.push('');
      }
      this.questionRpcId = rpcId;
      this.questionViews = views;
      this.questionSelections = selections;
      this.questionCustom = customs;
      this.questionBusy = false;
      this.questionIndex = 0;
      this.questionCollapsed = false;
      this.questionReplay = raw['replay'] === true;
      this.questionOpen = views.length > 0;
    } catch (err) {
      this.questionOpen = false;
    }
  }

  private isQuestionSelected(index: number, label: string): boolean {
    if (index < 0 || index >= this.questionSelections.length) {
      return false;
    }
    return this.questionSelections[index].indexOf(label) >= 0;
  }

  private toggleQuestionOption(index: number, label: string): void {
    if (index < 0 || index >= this.questionViews.length) {
      return;
    }
    const multi: boolean = this.questionViews[index].multiSelect;
    const current: string[] = this.questionSelections[index];
    let next: string[] = [];
    if (multi) {
      next = current.slice();
      const at: number = next.indexOf(label);
      if (at >= 0) {
        next.splice(at, 1);
      } else {
        next.push(label);
      }
    } else {
      next = current.indexOf(label) >= 0 ? [] : [label];
    }
    const all: string[][] = [];
    for (let i = 0; i < this.questionSelections.length; i++) {
      all.push(i === index ? next : this.questionSelections[i]);
    }
    this.questionSelections = all;
  }

  private setQuestionCustom(index: number, value: string): void {
    if (index < 0 || index >= this.questionCustom.length) {
      return;
    }
    const next: string[] = [];
    for (let i = 0; i < this.questionCustom.length; i++) {
      next.push(i === index ? value : this.questionCustom[i]);
    }
    this.questionCustom = next;
  }

  private async submitQuestion(): Promise<void> {
    if (this.questionBusy) {
      return;
    }
    if (this.questionRpcId.length === 0) {
      this.showToast('问题请求已失效，请重新触发', false);
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    const answers: GatewayQuestionAnswer[] = [];
    for (let i = 0; i < this.questionViews.length; i++) {
      const selected: string[] = i < this.questionSelections.length ? this.questionSelections[i] : [];
      const custom: string = i < this.questionCustom.length ? this.questionCustom[i].trim() : '';
      if (selected.length === 0 && custom.length === 0) {
        if (i !== this.questionIndex) {
          this.questionIndex = i;
        }
        this.showToast('第 ' + (i + 1).toString() + ' 题还没选，请先完成', false);
        return;
      }
      const answer: GatewayQuestionAnswer = { id: this.questionViews[i].id, selected: selected };
      if (custom.length > 0) {
        answer.custom = custom;
      }
      answers.push(answer);
    }
    this.questionBusy = true;
    GatewayClient.get().answerQuestion(this.questionRpcId, sessionId, answers).then((frame: GatewayFrame) => {
      this.questionBusy = false;
      if (frame.accepted === true) {
        this.questionOpen = false;
        SessionStore.get().refreshPendingQuestion();
        this.showToast('已提交回答', false);
      } else {
        this.showToast('提交失败：' + (frame.reason !== undefined ? frame.reason : '网关未接受'), true);
      }
    }).catch((err: Error) => {
      this.questionBusy = false;
      this.showToast(err.message.length > 0 ? err.message : '提交失败', true);
    });
  }

  private cancelQuestionPrompt(): void {
    if (this.questionRpcId.length === 0) {
      this.questionOpen = false;
      return;
    }
    const rpcId: string = this.questionRpcId;
    const sessionId: string = SessionStore.get().currentSessionId();
    this.questionOpen = false;
    GatewayClient.get().cancelQuestion(rpcId, sessionId).then((frame: GatewayFrame) => {
      SessionStore.get().refreshPendingQuestion();
    }).catch((err: Error) => {
    });
  }

  // ── 问题 / 批准：输入框上方的内嵌卡片（对齐小程序 pending-card，背景参考队列消息）──

  private questionCurrent(): QuestionView | undefined {
    if (this.questionIndex < 0 || this.questionIndex >= this.questionViews.length) {
      return undefined;
    }
    return this.questionViews[this.questionIndex];
  }

  private questionHeaderText(): string {
    const item: QuestionView | undefined = this.questionCurrent();
    return item !== undefined && item.header.length > 0 ? item.header : '确认';
  }

  private questionIsMulti(): boolean {
    const item: QuestionView | undefined = this.questionCurrent();
    return item !== undefined && item.multiSelect;
  }

  private questionPrevPage(): void {
    if (this.questionIndex > 0) {
      this.questionIndex -= 1;
    }
  }

  private questionNextPage(): void {
    if (this.questionIndex < this.questionViews.length - 1) {
      this.questionIndex += 1;
    }
  }

  @Builder
  questionDockCard() {
    if (this.questionOpen && this.questionViews.length > 0) {
      Column() {
        if (this.questionCollapsed) {
          Row({ space: this.rpx(20) }) {
            Stack({ alignContent: Alignment.Center }) {
              Column()
                .width(this.rpx(44))
                .height(this.rpx(44))
                .borderRadius(this.rpx(22))
                .backgroundColor('rgba(46,107,230,0.18)')
              Text('?')
                .fontSize(15)
                .fontWeight(FontWeight.Medium)
                .fontColor('#7FA7FF')
            }
            Column({ space: this.rpx(4) }) {
              Text('Agent 正在等待回答')
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.textColor())
              Text(this.questionCurrent() !== undefined ? this.questionCurrent()!.question : '')
                .fontSize(12)
                .fontColor(this.subColor())
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            Image($r('app.media.chev_right_gray'))
              .width(this.rpx(22))
              .height(this.rpx(22))
              .objectFit(ImageFit.Contain)
              .rotate({ angle: 90 })
              .opacity(0.72)
          }
          .width('100%')
          .constraintSize({ minHeight: this.rpx(92) })
          .padding({ left: this.rpx(24), right: this.rpx(24) })
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            this.questionCollapsed = false;
          })
        } else {
          Row({ space: this.rpx(12) }) {
            Text(this.questionHeaderText())
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor('#7FA7FF')
            if (this.questionReplay) {
              Text('已恢复')
                .fontSize(11)
                .fontColor(this.subColor())
            }
            Blank()
            Text('收起')
              .fontSize(12)
              .fontColor(this.subColor())
              .padding({ left: this.rpx(12), right: this.rpx(12), top: this.rpx(4), bottom: this.rpx(4) })
              .onClick(() => {
                this.questionCollapsed = true;
              })
            Text('✕')
              .fontSize(14)
              .fontColor(this.subColor())
              .padding({ left: this.rpx(6), right: this.rpx(2), top: this.rpx(4), bottom: this.rpx(4) })
              .onClick(() => {
                this.cancelQuestionPrompt();
              })
          }
          .width('100%')
          .padding({ left: this.rpx(28), right: this.rpx(20), top: this.rpx(20) })

          if (this.questionCurrent() !== undefined) {
            Column({ space: this.rpx(10) }) {
              Text(this.questionCurrent()!.question)
                .fontSize(17)
                .fontWeight(FontWeight.Medium)
                .lineHeight(this.rpx(44))
                .fontColor(this.textColor())
                .width('100%')
              if (this.questionCurrent()!.detail.length > 0) {
                Text(this.questionCurrent()!.detail)
                  .fontSize(12.5)
                  .lineHeight(this.rpx(38))
                  .fontColor(this.subColor())
                  .width('100%')
              }
              if (this.questionIsMulti()) {
                Text('☑ 可以选择多项')
                  .fontSize(11.5)
                  .fontColor(this.subColor())
                  .width('100%')
              }
              ForEach(this.questionCurrent()!.options, (opt: QuestionOptionView, oi: number) => {
                Row({ space: this.rpx(14) }) {
                  Stack({ alignContent: Alignment.Center }) {
                    Column()
                      .width(this.rpx(44))
                      .height(this.rpx(44))
                      .borderRadius(this.rpx(10))
                      .backgroundColor(this.isQuestionSelected(this.questionIndex, opt.label)
                        ? '#2E6BE6'
                        : (this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.10)'))
                    Text((oi + 1).toString())
                      .fontSize(13)
                      .fontColor(this.isQuestionSelected(this.questionIndex, opt.label) ? '#FFFFFF' : this.subColor())
                  }
                  .width(this.rpx(44))
                  .height(this.rpx(44))
                  Column({ space: this.rpx(4) }) {
                    Text(opt.label)
                      .fontSize(14.5)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.textColor())
                    if (opt.description.length > 0) {
                      Text(opt.description)
                        .fontSize(13)
                        .lineHeight(this.rpx(36))
                        .fontColor(this.subColor())
                    }
                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                }
                .width('100%')
                .padding({ left: this.rpx(4), right: this.rpx(4), top: this.rpx(10), bottom: this.rpx(10) })
                .borderRadius(this.rpx(16))
                .border({
                  width: 1,
                  color: this.isQuestionSelected(this.questionIndex, opt.label)
                    ? 'rgba(46,107,230,0.55)' : Color.Transparent
                })
                .backgroundColor(this.isQuestionSelected(this.questionIndex, opt.label)
                  ? 'rgba(46,107,230,0.10)' : Color.Transparent)
                .onClick(() => {
                  this.toggleQuestionOption(this.questionIndex, opt.label);
                })
              }, (opt: QuestionOptionView, oi: number) => this.questionIndex.toString() + '-' + oi.toString())
              if (this.questionCurrent()!.options.length > 0) {
                Row({ space: this.rpx(10) }) {
                  Text('✎')
                    .fontSize(13)
                    .fontColor(this.subColor())
                  TextInput({
                    text: this.questionIndex < this.questionCustom.length ? this.questionCustom[this.questionIndex] : '',
                    placeholder: '或输入自定义答案'
                  })
                    .fontSize(13)
                    .layoutWeight(1)
                    .height(this.rpx(64))
                    .backgroundColor(Color.Transparent)
                    .placeholderColor(this.subColor())
                    .onChange((value: string) => {
                      this.setQuestionCustom(this.questionIndex, value);
                    })
                }
                .width('100%')
                .padding({ left: this.rpx(16), right: this.rpx(16) })
                .borderRadius(this.rpx(20))
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)')
              } else {
                TextInput({
                  text: this.questionIndex < this.questionCustom.length ? this.questionCustom[this.questionIndex] : '',
                  placeholder: '输入你的答案'
                })
                  .fontSize(13)
                  .height(this.rpx(64))
                  .width('100%')
                  .padding({ left: this.rpx(16), right: this.rpx(16) })
                  .borderRadius(this.rpx(20))
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)')
                  .placeholderColor(this.subColor())
                  .onChange((value: string) => {
                    this.setQuestionCustom(this.questionIndex, value);
                  })
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ left: this.rpx(28), right: this.rpx(28), top: this.rpx(12) })
          }

          Row({ space: this.rpx(4) }) {
            Text('‹')
              .fontSize(14)
              .fontColor(this.questionIndex > 0 ? this.subColor() : 'rgba(128,128,128,0.35)')
              .width(this.rpx(40))
              .height(this.rpx(40))
              .textAlign(TextAlign.Center)
              .onClick(() => {
                this.questionPrevPage();
              })
            Text((this.questionIndex + 1).toString() + ' / ' + this.questionViews.length.toString())
              .fontSize(12)
              .fontFamily('monospace')
              .fontColor(this.subColor())
            Text('›')
              .fontSize(14)
              .fontColor(this.questionIndex < this.questionViews.length - 1 ? this.subColor() : 'rgba(128,128,128,0.35)')
              .width(this.rpx(40))
              .height(this.rpx(40))
              .textAlign(TextAlign.Center)
              .onClick(() => {
                this.questionNextPage();
              })
            Blank()
            Text('跳过问题')
              .fontSize(13)
              .fontColor(this.subColor())
              .padding({ left: this.rpx(20), right: this.rpx(20), top: this.rpx(12), bottom: this.rpx(12) })
              .borderRadius(this.rpx(36))
              .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(16,19,24,0.16)' })
              .onClick(() => {
                this.cancelQuestionPrompt();
              })
            if (this.questionIndex < this.questionViews.length - 1) {
              Text('下一题')
                .fontSize(13)
                .fontColor('#FFFFFF')
                .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(12), bottom: this.rpx(12) })
                .borderRadius(this.rpx(36))
                .backgroundColor('#2E6BE6')
                .margin({ left: this.rpx(14) })
                .onClick(() => {
                  this.questionNextPage();
                })
            } else {
              Text(this.questionBusy ? '提交中…' : '提交')
                .fontSize(13)
                .fontColor('#FFFFFF')
                .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(12), bottom: this.rpx(12) })
                .borderRadius(this.rpx(36))
                .backgroundColor('#2E6BE6')
                .opacity(this.questionBusy ? 0.5 : 1)
                .margin({ left: this.rpx(14) })
                .onClick(() => {
                  this.submitQuestion();
                })
            }
          }
          .width('100%')
          .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(18), bottom: this.rpx(20) })
          .alignItems(VerticalAlign.Center)
        }
      }
      .width('100%')
      .borderRadius(this.rpx(36))
      .backgroundColor(this.isDark ? 'rgba(44,44,48,0.46)' : 'rgba(255,255,255,0.24)')
      .backdropBlur(14)
      .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)' })
      .margin({ bottom: this.rpx(12) })
      .clip(true)
    }
  }

  private onPendingApprovalChanged(): void {
    if (this.pendingApprovalJson.length === 0) {
      this.approvalOpen = false;
      return;
    }
    try {
      const raw: Record<string, Object> = JSON.parse(this.pendingApprovalJson) as Record<string, Object>;
      const sessionId: string = typeof raw['sessionId'] === 'string' ? raw['sessionId'] as string : '';
      if (sessionId.length === 0 || sessionId !== SessionStore.get().currentSessionId()) {
        this.approvalOpen = false;
        return;
      }
      this.approvalRpcId = typeof raw['rpcId'] === 'string' ? raw['rpcId'] as string : '';
      this.approvalId = typeof raw['approvalId'] === 'string' ? raw['approvalId'] as string : '';
      this.approvalTool = typeof raw['toolName'] === 'string' ? raw['toolName'] as string : '工具操作';
      const reason: string = typeof raw['reason'] === 'string' ? raw['reason'] as string : '';
      this.approvalReason = reason.length > 0 ? reason : this.approvalTool + ' 请求执行需要审批的操作';
      this.approvalReplay = raw['replay'] === true;
      this.approvalBusy = false;
      this.approvalOpen = true;
    } catch (err) {
      this.approvalOpen = false;
    }
  }

  private answerApproval(outcome: string): void {
    if (this.approvalBusy || this.approvalRpcId.length === 0) {
      return;
    }
    this.approvalBusy = true;
    const sessionId: string = SessionStore.get().currentSessionId();
    GatewayClient.get().approvalResponse(this.approvalRpcId, sessionId, this.approvalId, outcome).then((frame: GatewayFrame) => {
      this.approvalBusy = false;
      this.approvalOpen = false;
      SessionStore.get().refreshPendingApproval();
    }).catch((err: Error) => {
      this.approvalBusy = false;
      this.hint = err.message.length > 0 ? err.message : '提交审批失败';
    });
  }

  @Builder
  approvalDockCard() {
    if (this.approvalOpen) {
      Column() {
        Row({ space: this.rpx(12) }) {
          Column()
            .width(this.rpx(18))
            .height(this.rpx(18))
            .borderRadius(this.rpx(9))
            .backgroundColor('#F59C0D')
          Text('等待审批')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.isDark ? '#F59C0D' : '#B26B00')
          if (this.approvalReplay) {
            Text('· 已恢复')
              .fontSize(12)
              .fontColor(this.subColor())
          }
          Blank()
        }
        .width('100%')
        .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(16), bottom: this.rpx(16) })
        .backgroundColor('rgba(245,156,13,0.10)')

        Column({ space: this.rpx(8) }) {
          Text(this.approvalTool)
            .fontSize(13)
            .fontFamily('monospace')
            .fontColor(this.subColor())
            .width('100%')
          Text(this.approvalReason)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .lineHeight(this.rpx(44))
            .fontColor(this.textColor())
            .width('100%')
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(20), bottom: this.rpx(8) })

        Row() {
          Blank()
          Text('拒绝')
            .fontSize(14)
            .fontColor(this.subColor())
            .padding({ left: this.rpx(28), right: this.rpx(28), top: this.rpx(12), bottom: this.rpx(12) })
            .borderRadius(this.rpx(36))
            .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(16,19,24,0.16)' })
            .opacity(this.approvalBusy ? 0.5 : 1)
            .onClick(() => {
              this.answerApproval('rejected');
            })
          Text('允许一次')
            .fontSize(14)
            .fontColor('#FFFFFF')
            .padding({ left: this.rpx(28), right: this.rpx(28), top: this.rpx(12), bottom: this.rpx(12) })
            .borderRadius(this.rpx(36))
            .backgroundColor('#2E6BE6')
            .opacity(this.approvalBusy ? 0.5 : 1)
            .margin({ left: this.rpx(18) })
            .onClick(() => {
              this.answerApproval('allowed-once');
            })
        }
        .width('100%')
        .padding({ left: this.rpx(24), right: this.rpx(24), top: this.rpx(8), bottom: this.rpx(20) })
        .alignItems(VerticalAlign.Center)
      }
      .width('100%')
      .borderRadius(this.rpx(36))
      .backgroundColor(this.isDark ? 'rgba(44,44,48,0.46)' : 'rgba(255,255,255,0.24)')
      .backdropBlur(14)
      .border({ width: 1, color: 'rgba(245,156,13,0.55)' })
      .margin({ bottom: this.rpx(12) })
      .clip(true)
    }
  }

  /** 图片预览底部弹窗内容：等比大图（点缩略图从底部弹起，下拉或点空白关闭） */
  @Builder
  imagePreviewSheet() {
    Column() {
      // 自绘抓取条（系统 dragBar 在沉浸材质/深色背景下常看不见）
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

      if (this.previewImageList.length > 1) {
        Swiper() {
          ForEach(this.previewImageList, (path: string) => {
            this.zoomablePreviewImage(path)
          }, (path: string) => path)
        }
        .index(this.previewImageIndex)
        .loop(false)
        .indicator(true)
        .width('100%')
        .layoutWeight(1)
        .margin({ bottom: 12 })
        .onChange((index: number) => {
          this.previewImageIndex = index;
          this.previewImagePath = this.previewImageList[index];
          // 翻到下一张时缩放复位，避免带着上一张的放大倍数
          this.previewZoom = 1;
          this.previewZoomBase = 1;
        })
      } else {
        this.zoomablePreviewImage(this.previewImagePath)
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 12, right: 12, top: 4, bottom: 8 })
    // 透出系统半模态的原生玻璃底（不再自己铺黑/灰实色）
    .backgroundColor(Color.Transparent)
  }

  /** 大图 + 双指缩放：图片跟着手指放大缩小（1~4 倍，松手保持） */
  @Builder
  zoomablePreviewImage(path: string) {
    if (path.length > 0) {
      Image(this.previewSource(path))
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

  /**
   * 引用一条回复：在输入框上方插入引用 chip，发送时把「> 引文」拼进正文。
   * 对齐 iOS 最新版回复左下角（复制按钮右边）的箭头引用按钮。
   */
  private quoteReply(text: string): void {
    const raw: string = text.trim();
    if (raw.length === 0) {
      return;
    }
    let preview: string = '';
    for (const line of raw.split('\n')) {
      const trimmed: string = line.trim();
      if (trimmed.length > 0) {
        preview = trimmed;
        break;
      }
    }
    preview = preview.replace(/^[#>*\-\s]+/, '');
    if (preview.length > 24) {
      preview = preview.substring(0, 24) + '…';
    }
    if (preview.length === 0) {
      return;
    }
    const chip: RefChipItem = {
      key: 'quote:' + Date.now().toString(),
      label: preview,
      kind: 'quote',
      token: '\n> ' + raw + '\n'
    };
    this.refChips = this.refChips.concat([chip]);
  }

  private rebuildEntries(): void {
    const source: ConversationItem[] = this.items === undefined ? [] : this.items;
    const built: ConversationFeedEntryModel[] = [];
    let rows: ConversationFeedEntry[] = ConversationFeed.build(source, this.runActive() && this.connection === 'connected');
    this.resolveQueueImages();
    // 任何时候都要算策略：运行中也要决定组体是否可见 / 限高 / 标题隐藏
    // （对齐小程序：workSteps.apply 每帧无条件执行，运行态由 policy 内部判断）
    ConversationFeed.applyWorkStepPolicy(rows, this.workStepMode, this.workStepTiming, this.folds,
      this.running && this.connection === 'connected');
    // 回合页脚「用量」：用 SessionStore 的每轮 token 累计填充（对齐小程序 turn-footer）
    const usageStore: SessionStore = SessionStore.get();
    for (const usageRow of rows) {
      if (usageRow.kind === 'ASSISTANT' && usageRow.turnKey.length > 0) {
        usageRow.turnMetaText = usageStore.turnUsageText(usageRow.turnKey);
        usageRow.turnUsageDetail = usageRow.turnMetaText.length > 0
          ? usageStore.turnUsageDetail(usageRow.turnKey) : '';
        usageRow.turnUsageTotal = usageRow.turnMetaText.length > 0
          ? usageStore.turnUsageTotalExact(usageRow.turnKey) : '';
        usageRow.turnUsageRows = usageRow.turnMetaText.length > 0
          ? usageStore.turnUsageRows(usageRow.turnKey) : [];
      }
    }
    // 回合展开时，把组行摊平到它下面当同级行（对齐小程序：turnProcess 行 + 各 processGroup 行，
    // 收起时按 turnProcessKey 过滤）。不嵌套组件——嵌套 @ObjectLink 行在本机会崩。
    // 阅读档：每个回合结束后折叠成「思考×N · 输出×N · 工具×N · 记录×N ›」一行，
    // 点开展开该回合内容（组行由下面摊平逻辑渲染）。
    if (this.workStepMode === 'reading') {
      for (const row of rows) {
        if (row.kind !== 'TURN') {
          continue;
        }
        row.text = this.readingTurnCountsOf(row.children);
        row.expandable = true;
        row.foldable = true;
      }
    }
    // 阅读档：把「当前运行回合之前」的过程收进一条计数折叠行；
    // 容器里只保留当前回合（从思考开始）的过程。点计数行展开历史过程。
    if (false && this.workStepMode === 'reading') {
      let runningIndex: number = -1;
      for (let index = 0; index < rows.length; index++) {
        if (rows[index].kind === 'PROCESS' && rows[index].running) {
          runningIndex = index;
          break;
        }
      }
      const boundary: number = runningIndex >= 0 ? runningIndex : rows.length;
      const historyMarks: boolean[] = [];
      const historyRows: ConversationFeedEntry[] = [];
      for (let index = 0; index < boundary; index++) {
        const one: ConversationFeedEntry = rows[index];
        const isProcessLike: boolean = one.kind === 'PROCESS' || one.kind === 'TURN';
        historyMarks.push(isProcessLike);
        if (isProcessLike) {
          historyRows.push(one);
        }
      }
      Logger.info('[READING] rows=' + rows.length.toString() + ' runningIndex=' + runningIndex.toString()
        + ' history=' + historyRows.length.toString());
      if (historyRows.length > 0) {
        const counts: string = this.readingCountsOfRows(historyRows);
        Logger.info('[READING] fold title=' + counts);
        const foldId: string = 'reading-history-fold';
        const foldEntry: ConversationFeedEntry = new ConversationFeedEntry();
        foldEntry.id = foldId;
        foldEntry.kind = 'TURN';
        foldEntry.title = counts;
        foldEntry.text = '';
        foldEntry.expandable = true;
        foldEntry.foldable = true;
        foldEntry.epochSeconds = Date.now() / 1000;
        const expanded: boolean = this.folds.get(foldId) === true;
        foldEntry.expanded = expanded;
        // 折叠行插在「当前回合容器」正上方（不要插到历史行原来的位置，
        // 否则它在滚出屏幕的上方，用户看不到这一行）。
        let insertAt: number = 0;
        const next: ConversationFeedEntry[] = [];
        for (let index = 0; index < rows.length; index++) {
          if (index < boundary && historyMarks[index]) {
            continue;
          }
          if (index < boundary) {
            insertAt++;
          }
          next.push(rows[index]);
        }
        next.splice(insertAt, 0, foldEntry);
        if (expanded) {
          const withHistory: ConversationFeedEntry[] = [];
          for (let index = 0; index < next.length; index++) {
            withHistory.push(next[index]);
            if (next[index] === foldEntry) {
              // 展开时铺开每个已完成回合的过程步骤（而不是「已完成」汇总行）
              for (const one of historyRows) {
                if (one.kind === 'TURN') {
                  for (const child of one.children) {
                    withHistory.push(child);
                  }
                } else {
                  withHistory.push(one);
                }
              }
            }
          }
          rows = withHistory;
        } else {
          rows = next;
        }
      }
    }
    const flat: ConversationFeedEntry[] = [];
    for (const row of rows) {
      flat.push(row);
      if (row.kind === 'TURN' && row.expanded) {
        for (const child of row.children) {
          flat.push(child);
        }
      }
    }
    rows = flat;
    // 「已编辑文件」卡片改为内联到最后一条助手回复里（显示在复制/用量/时间页脚上方），
    // 不再作为独立行追加在时间线末尾。
    this.inlineAssistantFiles.clear();
    this.inlineChangeSeqByAssistant.clear();
    this.inlineAssistantAttachments.clear();
    const changesRows: ConversationFeedEntry[] = [];
    for (const one of rows) {
      if (one.kind === 'CHANGES' || one.kind === 'FILES') {
        changesRows.push(one);
      }
    }
    if (changesRows.length > 0) {
      // 这些变更行马上会从 rows 里摘掉，摘掉前必须先发起摘要请求，
      // 否则 loadFileSummaries(rows) 永远看不到它们 → 卡片永远是空的。
      this.loadFileSummaries(changesRows);
      const lastAssistantByTurn: Map<string, string> = new Map<string, string>();
      for (const one of rows) {
        if (one.kind === 'ASSISTANT' && one.turnKey.length > 0) {
          lastAssistantByTurn.set(one.turnKey, one.id);
        }
      }
      // 只要这轮有助手回复，变更行一律内联（哪怕摘要还没到、chips 暂时为空）：
      // 否则「摘要未就绪」时会保留独立行 → 显示在页脚下面，位置就乱了。
      // 兜底：turnKey 对不上时（历史数据/空 turn），挂到最后一条助手回复上，
      // 否则会退回独立行 → 又被排到时间线末尾、显示在页脚和按钮下面。
      let lastAssistantId: string = '';
      for (const one of rows) {
        if (one.kind === 'ASSISTANT') {
          lastAssistantId = one.id;
        }
      }
      const inlinedIds: Set<string> = new Set<string>();
      for (const filesRow of changesRows) {
        let assistantId: string | undefined = lastAssistantByTurn.get(filesRow.turnKey);
        if (assistantId === undefined || assistantId.length === 0) {
          assistantId = lastAssistantId.length > 0 ? lastAssistantId : undefined;
        }
        if (assistantId === undefined) {
          continue;
        }
        inlinedIds.add(filesRow.id);
        if (filesRow.kind === 'FILES') {
          // 助手产出的文件（截图等）：内联成附件图片卡片，不并进「已编辑」卡片
          const attachChips: string[] = this.attachmentChipsFromFiles(filesRow);
          if (attachChips.length > 0) {
            this.inlineAssistantAttachments.set(assistantId, attachChips);
          }
          continue;
        }
        this.inlineChangeSeqByAssistant.set(assistantId, filesRow.changeSeq);
        const chips: string[] = this.chipsFromFeedEntry(filesRow);
        Logger.info('[CHANGES] inline assistant=' + assistantId.slice(-10) + ' seq=' + filesRow.changeSeq.toString()
          + ' chips=' + chips.length.toString() + ' summaries=' + this.fileSummaries.length.toString());
        if (chips.length > 0) {
          this.inlineAssistantFiles.set(assistantId, chips);
        } else {
          // 摘要还没到或失败：强制下次重试，并在 1.5s 后主动重排一次拿结果
          this.fileSummaryRequested.delete(filesRow.id);
          if (this.fileSummaryRetryTimer < 0) {
            this.fileSummaryRetryTimer = setTimeout(() => {
              this.fileSummaryRetryTimer = -1;
              this.scheduleTimelineUpdate();
            }, 1500);
          }
        }
      }
      if (inlinedIds.size > 0) {
        const keep: ConversationFeedEntry[] = [];
        for (const one of rows) {
          if (inlinedIds.has(one.id)) {
            continue;
          }
          keep.push(one);
        }
        rows = keep;
      }
    }
    // 运行中标题最短展示 150ms，避免快速切换闪烁（对齐客户端 PROCESS_TITLE_MINIMUM_MS）
    const nowMs: number = Date.now();
    for (const entry of rows) {
      if (entry.kind === 'PROCESS' && entry.running) {
        const held: string | undefined = this.titleHold.get(entry.id);
        const heldAt: number | undefined = this.titleHoldAt.get(entry.id);
        if (held !== undefined && heldAt !== undefined && held !== entry.title && nowMs - heldAt < 150) {
          entry.title = held;
        } else {
          this.titleHold.set(entry.id, entry.title);
          this.titleHoldAt.set(entry.id, nowMs);
        }
      }
    }
    // 图片附件：先挑本地缓存，没有的按 attachmentId 向网关预取（异步补进 imagePathEntries）
    this.preloadImages(rows);
    // 回合文件变更摘要：拉取后渲染「已编辑 N 个文件 +N −N」卡片
    this.loadFileSummaries(rows);
    // 同 id 行复用原实例（@ObjectLink 绑定的就是这个对象），否则展开状态更新不到列表项
    const previous: Map<string, ConversationFeedEntryModel> = new Map<string, ConversationFeedEntryModel>();
    for (const old of this.entries) {
      previous.set(old.id, old);
    }
    const grewIndexes: number[] = [];
    for (const entry of rows) {
      const existing: ConversationFeedEntryModel | undefined = previous.get(entry.id);
      if (existing !== undefined) {
        const beforeRevision: number = existing.itemsRevision;
        existing.assign(entry, entry.expanded);
        if (existing.itemsRevision !== beforeRevision) {
          grewIndexes.push(built.length);
        }
        built.push(existing);
      } else {
        const model: ConversationFeedEntryModel = ConversationFeedEntryModel.from(entry);
        model.expanded = entry.expanded;
        built.push(model);
      }
    }
    // 行 id 顺序没变 = 只是正文/状态在涨：行实例已经原地 assign 过，@ObjectLink 会把
    // 改动推给对应行，这里绝不能再重载列表。onDataReloaded 会把所有可见行拆掉重建
    // （连带重新解析 Markdown），流式期间每秒来十几次，页面就是被它拖死的。
    let structureChanged: boolean = built.length !== this.entries.length;
    if (!structureChanged) {
      for (let i = 0; i < built.length; i++) {
        if (built[i].id !== this.entries[i].id) {
          structureChanged = true;
          break;
        }
      }
    }
    // 「已编辑文件」卡片是异步摘要：回合结束后 1~2 秒才拿到 chips，
    // 行 key 里带了卡片数量，所以摘要晚到时必须整表（或该行）重载，否则卡片要退出重进才出现。
    let filesSig: string = '';
    for (const row of rows) {
      const chips: string[] | undefined = this.inlineAssistantFiles.get(row.id);
      filesSig += row.id + ':' + (chips === undefined ? 0 : chips.length).toString() + '|';
    }
    const filesChanged: boolean = filesSig !== this.inlineFilesSig;
    this.inlineFilesSig = filesSig;
    if (!structureChanged) {
      // 结构没变但组体内容涨了（运行中常见）。
      // 让 entries 换一个新数组引用，@State 才能触发 ForEach 重跑；
      // ForEach 的 key 里带 itemsRevision，于是只有内容变化的那几行会重建。
      if (grewIndexes.length > 0 || filesChanged) {
        this.entries = built;
        this.source.update(built);
        if (filesChanged) {
          // 卡片摘要晚到：key 变了但行实例没变，靠整表重载让 LazyForEach 重新算 key
          this.source.reload();
        }
      }
      return;
    }
    // 手指压在列表上时先不重建：onDataReloaded 会把可见行整体拆掉重建，
    // 正在拖的手势被中断 —— 表现出来就是「运行中滑不动」。抬手后补一次。
    // 只在这一下触摸确实还在进行时推迟重建。
    // 之前只看 listTouching 布尔：一旦漏掉 Up/Cancel（切后台、手势被系统打断、
    // uitest 注入的触摸不完整都会），它会一直为 true，于是结构变化被永久推迟 ——
    // 表现就是「内容冻结在某一步、鲸尾用时还在跳，只有退出重进才刷新」。
    if (this.listTouching && Date.now() - this.listTouchStartedAt < 1500) {
      this.pendingStructure = true;
      return;
    }
    if (this.listTouching) {
      this.listTouching = false;
      this.pendingStructure = false;
    }
    // 用户已经往上翻（不再吸底）时，重建后把滚动位置放回去，避免列表自己跳到顶部
    const keepOffset: boolean = !this.autoStick;
    const yOffset: number = keepOffset ? this.scroller.currentOffset().yOffset : 0;
    this.suppressReachEnd = true;
    // 重载产生的 reachEnd 可能在下一帧才到：留 300ms 窗口，别让它把用户「恢复吸底」
    this.suppressReachEndUntil = Date.now() + 300;
    const hadEntries: boolean = this.entries.length > 0;
    this.entries = built;
    this.source.update(built);
    // 首次进入会话：List 还留着上一个会话的滚动偏移，内容变短后偏移在内容之外 → 一片空白，
    // 只有触摸事件才会触发系统把偏移 clamp 回来。这里主动把偏移归零再贴底。
    if (!hadEntries) {
      try {
        this.scroller.scrollTo({ xOffset: 0, yOffset: 0, animation: false });
      } catch (err) {
      }
    }
    // 首次/重建赋值时列表尚未完成布局，立刻贴底可能落在「内容之外」→ 一片空白，
    // 要等一次触摸才被纠正。这里在布局完成后再补一次贴底。
    if (this.autoStick) {
      setTimeout(() => {
        if (!this.autoStick || this.listTouching || !this.pageVisible) {
          return;
        }
        try {
          this.scroller.scrollEdge(Edge.Bottom);
        } catch (err) {
        }
      }, 90);
    }
    setTimeout(() => {
      if (keepOffset) {
        // 用户已经往上翻：无条件把位置放回去（重建会让列表自己跳到别处）
        this.scroller.scrollTo({ xOffset: 0, yOffset: yOffset, animation: false });
      }
      this.suppressReachEnd = false;
    }, 0);
  }

  private onRunningChanged(): void {
    if (!this.running) {
      this.runningFalseAt = Date.now();
      // 回合结束：稍后补两次重排，让过程组按「已收工」折叠成「已完成」
      // （折叠条件里带 3 秒活跃窗口，结束后不一定还有新的数据推送来触发重排）。
      setTimeout(() => {
        this.flushPendingStructure();
      }, 900);
      setTimeout(() => {
        this.flushPendingStructure();
      }, 3600);
    } else {
      this.runningFalseAt = 0;
    }
    // 重新运行起来后允许再次尝试「立即发送」
    if (this.running && this.steerFailedIds.length > 0) {
      this.steerFailedIds = [];
    }
    // 运行状态翻转会改变折叠策略（运行中不收起过程组），必须重投影
    this.rebuildEntries();
    this.refreshProgress();
    if (this.running && this.autoStick) {
      setTimeout(() => {
        this.scroller.scrollEdge(Edge.Bottom);
      }, 40);
    }
  }

  /** 时间线变化：重排并吸底；运行指示器同步刷新。 */
  private onItemsChanged(): void {
    this.hideDeliveredQueueItems();
    // 临时诊断：确认 items 变化有没有真的进到页面重排
    this.diagTick += 1;
    if (this.diagTick % 25 === 1) {
      Logger.info('page items n=' + (this.items === undefined ? -1 : this.items.length).toString()
        + ' entries=' + this.entries.length.toString() + ' ready=' + (this.ready ? '1' : '0')
        + ' visible=' + (this.pageVisible ? '1' : '0')
        + ' tail=' + (this.entries.length > 0 ? this.entries[this.entries.length - 1].id : '-'));
    }
    if (!this.ready) {
      return;
    }
    if (!this.pageVisible) {
      // 被别的页面盖住时只记账，回到本页再统一重排
      this.pendingItemsWhileHidden = true;
      return;
    }
    // 会话刚切换：新会话的首屏历史正在路上，必须照常重排。
    // 否则胶囊默认展开态下会命中下面的「冻结」分支，页面一直停在旧会话（表现为点侧栏会话切不过去）。
    if (this.pendingSessionRender) {
      this.applyTimelineUpdate();
      this.applyTurnNodesPreview();
      if (this.items.length > 0) {
        this.pendingSessionRender = false;
      }
      if (this.capsuleExpanded) {
        this.scheduleWarmupRetry();
      }
      return;
    }
    // 节点弹层开着 / 胶囊展开预热中：完全不重建时间线（不重载列表＝屏幕不闪），
    // 只用原始 items 数一下轮次，让胶囊上的 N/总数动起来。
    if (this.turnNavOpen || this.turnNavMenuOpen || this.capsuleExpanded) {
      this.applyTurnNodesPreview();
      // 胶囊默认就是展开态（偏好里 capsuleDefaultExpanded=true），进页面时不会走 tapCapsule，
      // 这里兜底启动预热：只要展开着就保证历史会被拉完（重试定时器会自愈晚到的首屏）。
      if (this.capsuleExpanded) {
        this.scheduleWarmupRetry();
      }
      // 首屏必须建一次时间线：否则第一次点进会话时，胶囊是展开态 → 一直走这条「冻结」分支，
      // 页面空白，只有点一下（胶囊收起/其它状态变化）才触发重排 —— 就是「第一次点进去不加载」。
      if (this.entries.length === 0) {
        this.applyTimelineUpdate();
      }
      return;
    }
    this.scheduleTimelineUpdate();
  }

  /**
   * 网关一次生成会连着推很多帧（每个 delta 都会刷新 conversationItems），
   * 每帧都重排 + 吸底会把 UI 线程打满。这里收敛到最多 ~11 次/秒，
   * 并保留一次尾随执行，保证最后一段文字不会停在旧状态。
   */
  private scheduleTimelineUpdate(): void {
    if (this.timelineTimer >= 0) {
      return;
    }
    const wait: number = this.timelineInterval - (Date.now() - this.lastTimelineUpdateAt);
    if (wait <= 0) {
      this.applyTimelineUpdate();
      return;
    }
    this.timelineTimer = setTimeout(() => {
      this.timelineTimer = -1;
      if (this.ready) {
        this.applyTimelineUpdate();
      }
    }, wait);
  }

  private applyTimelineUpdate(): void {
    Logger.info('[PAGE] apply enter visible=' + (this.pageVisible ? '1' : '0') + ' ready=' + (this.ready ? '1' : '0')
      + ' touching=' + (this.listTouching ? '1' : '0') + ' entries=' + this.entries.length.toString()
      + ' running=' + (this.running ? '1' : '0'));
    const startedAt: number = Date.now();
    // 临时诊断：重排后的行数与尾行 id
    this.diagApplied += 1;
    if (this.diagApplied % 20 === 1) {
      if (this.diagApplied % 20 === 3) {
      let dump: string = '';
      for (let i = 0; i < this.entries.length && i < 8; i++) {
        const e: ConversationFeedEntryModel = this.entries[i];
        dump += '[' + e.kind + '|' + e.title.substring(0, 12) + '|' + e.text.length.toString()
          + '|vis=' + (e.processBodyVisible ? '1' : '0') + '] ';
      }
      Logger.info('page entries ' + dump);
    }
    Logger.info('page apply n=' + (this.items === undefined ? -1 : this.items.length).toString()
        + ' entries=' + this.entries.length.toString()
        + ' stick=' + (this.autoStick ? '1' : '0'));
    }
    this.lastTimelineUpdateAt = startedAt;
    this.rebuildEntries();
    const spent: number = Date.now() - startedAt;
    this.timelineInterval = spent >= 12 ? 220 : (spent >= 6 ? 160 : TIMELINE_MIN_INTERVAL_MS);
    this.refreshProgress();
    const tail: ConversationFeedEntryModel | null = this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
    // 吸底 key 必须包含「所有行内的步骤总数 + 尾行内容长度」：
    // 之前只看尾行 id + 正文长度，运行中新增步骤（行数不变、正文不变）不会触发跟随，
    // 表现就是「新过程出来了但页面不往上滚」。
    let stepCount: number = 0;
    let stepChars: number = 0;
    for (const one of this.entries) {
      if (one.items === undefined) {
        continue;
      }
      stepCount += one.items.length;
      for (const step of one.items) {
        stepChars += step.text.length;
        stepChars += step.resultText === undefined ? 0 : step.resultText.length;
      }
    }
    // key 里必须包含「组内每一步的正文长度」：
    // 第一段思考出现时组内只有 1 条 item，它的正文一直在长，
    // 但行数/步骤数/尾行正文都不变 —— 之前 key 不变，就不会跟底，
    // 思考越长把运行条挤得越远（这就是「第一个是思考时被挤掉」的原因）。
    const key: string = (tail === null ? '' : tail.id + ':' + tail.text.length.toString())
      + ':' + this.entries.length.toString() + ':' + stepCount.toString()
      + ':' + stepChars.toString();
    const contentChanged: boolean = key !== this.lastTailKey;
    if (contentChanged) {
      this.lastTailKey = key;
    }
    // 跟随：只在「内容真的变了」且还在吸底时贴底。
    // 之前每次重排都无条件 scrollEdge，配合 16ms 的重排间隔就是持续顶动 → 页面一直抖。
    // 注意：不要在这里把 autoStick 重新打开 —— 用户往上翻看历史时会被不断拽回底部。
    // 只有用户自己滑回底部（onScrollIndex/onReachEnd）、点「回到底部」或发消息才恢复跟随。
    // 吸底降频到 400ms：内容高度在连续变化时，过频的 scrollEdge 会让画面来回微调（抖）。
    if (contentChanged && this.entries.length > 0 && !this.listTouching && this.autoStick
      && Date.now() - this.lastStickAt > 400) {
      this.stickToBottom();
    }
  }

  /** 吸底心跳：运行中只要用户没按住列表，就持续把视图钉在底部 */
  private startStickTimer(): void {
    if (this.stickTimer >= 0) {
      return;
    }
    this.stickTimer = setInterval(() => {
      if (!this.pageVisible || this.listTouching || this.entries.length === 0) {
        return;
      }
      if (!this.autoStick || !this.runActive()) {
        return;
      }
      // 运行中无条件贴底：贴底判断失准会导致「跳回第一个内容」，这里直接滚到底。
      this.stickScrollUntil = Date.now() + 400;
      try {
        this.scroller.scrollEdge(Edge.Bottom);
      } catch (err) {
      }
    }, 400);
    return;
    // 心跳已停用：它会隔 600ms 把视图拉回底部，
    // 把「运行中滚到当前过程组顶部」的意图覆盖掉 —— 于是思考卡标题永远看不到。
    // 现在只保留内容变化驱动的跟随（见 applyTimelineUpdate）。
    this.stickTimer = -1;
  }

  private stopStickTimer(): void {
    if (this.stickTimer >= 0) {
      clearInterval(this.stickTimer);
      this.stickTimer = -1;
    }
  }

  /** 滚到内容底部：先平滑跟随（贴近桌面端观感），再兜底一次瞬时贴底 */
  private stickToBottom(): void {
    if (this.entries.length === 0) {
      return;
    }
    this.lastStickAt = Date.now();
    this.stickScrollUntil = Date.now() + 500;
    // 只用「瞬时贴底」：动画版 scrollToIndex 会被下一帧的新内容打断、不断重启动画，
    // 表现就是页面一直抖。内容本身是持续小步增长的，瞬时贴底看起来就是连续的跟随。
    try {
      this.scroller.scrollEdge(Edge.Bottom);
    } catch (err) {
    }
  }

  /**
   * 用户正在跟列表较劲就不要再吸底。
   * 以前流式期间每 90ms 强制 scrollEdge(Bottom)：手指刚上滑就被拽回底部，
   * 表现出来就是「滑不动、点了没反应」——这是对话页卡死的直接观感来源。
   */
  private userInteracting(): boolean {
    const now: number = Date.now();
    if (this.listTouching) {
      return true;
    }
    if (now - this.lastTouchAt < 800) {
      return true;
    }
    return now - this.lastUserScrollAt < 800;
  }

  /**
   * 恢复「吸底跟随」的唯一入口：必须确认是用户自己把列表拖到了末尾。
   * 流式期间正文增长、onDataReloaded 重排都会触发 onReachEnd / onScrollIndex，
   * 以前在 onReachEnd 里无条件 autoStick = true，用户往上翻两屏就被拽回底部
   * （表现就是「运行中一直翻不到上面的内容」）。
   */
  private maybeResumeAutoStick(): void {
    if (this.suppressReachEnd || Date.now() < this.suppressReachEndUntil) {
      return;
    }
    if (!this.userInteracting()) {
      return;
    }
    // 用「是否真的在底部」判断，而不是行下标：会话行数少时，任何一个位置都满足
    // end >= length-2，用户往上滑一点就又被判成在底部 → 被拽回去。
    let atEnd: boolean = false;
    try {
      atEnd = this.scroller.isAtEnd();
    } catch (err) {
      atEnd = false;
    }
    if (this.entries.length === 0 || !atEnd) {
      return;
    }
    this.autoStick = true;
  }

  /** 运行中的过程组 id（点击运行条时展开它） */
  private runningProcessId(): string {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry: ConversationFeedEntryModel = this.entries[index];
      if (entry.kind === 'PROCESS') {
        return entry.id;
      }
    }
    return '';
  }

  /** 点击运行条：展开/收起当前运行中的过程组 */
  private toggleRunningProcess(): void {
    const id: string = this.runningProcessId();
    if (id.length === 0) {
      return;
    }
    let visible: boolean = false;
    for (const row of this.entries) {
      if (row.id === id) {
        visible = row.kind === 'TURN' ? row.expanded : row.processBodyVisible;
      }
    }
    this.folds.set(id, !visible);
    this.rebuildEntries();
  }

  /**
   * 运行态兜底（对齐小程序 setRunning 的列表校准）：
   * 会话列表是主机权威状态，首页已能正确显示「运行中」；会话页若只信本地事件流，
   * 事件流没到或被历史重建打断时鲸尾条就不出现。两个来源任一为真即视为运行中。
   */
  private listRunning(): boolean {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return false;
    }
    for (const one of this.sessions) {
      if (one.id === sessionId) {
        return one.running === true;
      }
    }
    return false;
  }

  /** 运行中（本地事件流 或 列表权威状态） */
  private runActive(): boolean {
    if (this.running) {
      return true;
    }
    // 回合刚结束的 10 秒内，列表可能还报「运行中」——不能据此继续显示运行条/不折叠过程组
    if (this.runningFalseAt > 0 && Date.now() - this.runningFalseAt < 10000) {
      return false;
    }
    return this.listRunning();
  }

  /** 兜底：有被推迟的结构变化且已不在拖动，就补一次重排（防止任何原因导致的冻结） */
  private flushPendingStructure(): void {
    if (!this.pendingStructure) {
      return;
    }
    if (this.listTouching && Date.now() - this.listTouchStartedAt < 1500) {
      return;
    }
    this.pendingStructure = false;
    this.listTouching = false;
    this.scheduleTimelineUpdate();
  }

  private refreshProgress(): void {
    if (!this.runActive()) {
      if (this.progressLabel.length > 0) {
        this.progressLabel = '';
      }
      return;
    }
    const source: ConversationItem[] = this.items === undefined ? [] : this.items;
    const activity: string = ConversationFeed.runningActivity(source);
    const start: number = ConversationFeed.lastUserEpochSeconds(source);
    const label: string = ConversationFeed.runningLabel(activity, start, Math.floor(Date.now() / 1000));
    if (label !== this.progressLabel) {
      this.progressLabel = label;
    }
  }

  // ==================== 主题 ====================
  private pageBg(): string {
    // 浅色模式按参考截图改为浅灰底（不再是纯白），让白色胶囊输入条和光圈浮出层次；深色仍为纯黑
    return this.isDark ? '#000000' : '#F2F2F4';
  }

  /** 状态栏内容色跟随页面背景：深色纯黑 → 白，浅色灰底 → 黑。
   *  交给 StatusBarStyle 统一计算：它在首页以外按 isDark 取值，与这里完全一致，
   *  因此系统配色变化 / 回前台后能自动写回正确颜色。 */
  private applyStatusBarColor(): void {
    StatusBarStyle.set(this.isDark ? '#FFFFFF' : '#000000');
  }

  /** 切换深浅主题后立刻重写状态栏内容色，并强制重载时间线 */
  onIsDarkChanged(): void {
    this.applyStatusBarColor();
    if (!this.pageVisible) {
      // 在别的页面切的主题：先记一笔，回到本页时再整表重载（隐藏页重建意义不大）
      this.themeDirty = true;
      return;
    }
    // 时间线是 LazyForEach：已建好的行不会因父级状态变化重建，必须整表重载一次，
    // 让每行（含 Markdown 正文）用新配色重新创建。
    // 注意不能走 rebuildEntries()：它在「行结构没变」时会提前 return，主题切换正好不改结构。
    if (!this.ready) {
      return;
    }
    this.reloadForTheme();
  }

  /** 主题切换专用：无条件重载列表，保持当前滚动位置 */
  private reloadForTheme(): void {
    const yOffset: number = this.scroller.currentOffset().yOffset;
    this.suppressReachEnd = true;
    this.suppressReachEndUntil = Date.now() + 300;
    this.source.update(this.entries);
    setTimeout(() => {
      this.scroller.scrollTo({ xOffset: 0, yOffset: yOffset, animation: false });
      this.suppressReachEnd = false;
    }, 0);
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.62)';
  }

  private surfaceColor(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  // ==================== 悬浮胶囊同款玻璃（输入条收起态那一套） ====================
  // 置底按钮 / 排队消息 / 任务 / 目标 统一用这套底色和细亮边，和输入条胶囊保持一致。
  /** 胶囊底色：深色 rgba(35,35,35,0.90) / 浅色 60% 白 */
  private dockGlassFill(): string {
    return this.isDark ? 'rgba(35,35,35,0.90)' : 'rgba(255,255,255,0.60)';
  }

  /** 胶囊细亮边：与输入条同一条 #66FFFFFF */
  private dockGlassEdge(): string {
    return '#66FFFFFF';
  }

  /** 胶囊圆角：26vp —— 矮条会被自动夹成胶囊（半径=高度一半），多行面板则是圆角矩形 */
  private dockGlassRadius(): number {
    return 26;
  }

  /**
   * 展开态玻璃（队列展开 / 任务展开 / 目标编辑）：与输入框展开态同一套配方
   * —— backdropBlur(22) + 半透明底 + 1vp #66FFFFFF 细亮边 + 28 圆角。
   * 输入框那份见 ConversationComposer 展开态卡片；两边要同步改。
   */
  private expandedGlassBlur(): number {
    return 22;
  }

  private expandedGlassFill(): string {
    return this.isDark ? 'rgba(30,30,32,0.72)' : 'rgba(255,255,255,0.72)';
  }

  private expandedGlassRadius(): number {
    return 28;
  }

  /** 沉浸光感材质（与悬浮 TabBar 背板同一套 uiMaterial） */
  private dockMaterial(): uiMaterial.Material {
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THIN,
      interactive: true,
      lightEffect: {}
    });
  }

  /** 材质组的边缘：亮度对齐悬浮 TabBar 材质自带的边缘（深色实测峰值 ~76/255，即 22% 白） */
  private dockMaterialEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.90)';
  }

  /** 会话节点弹窗玻璃：比系统菜单更通透（模糊更重时基色再降一点不透明度） */
  private turnNavGlass(): string {
    return this.isDark ? 'rgba(58,58,60,0.56)' : 'rgba(250,250,252,0.62)';
  }

  /** 系统菜单（右上角「⋯」）的磨砂玻璃材质色：模糊会被压暗，故基色偏亮半透明 */
  private menuMaterial(): string {
    return this.isDark ? 'rgba(61,61,61,0.72)' : 'rgba(248,248,250,0.78)';
  }

  /** 卡片描边：浅色极淡黑边、深色极淡白边（弹层与输入框分层用） */
  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)';
  }

  private activeSessionTitle(): string {
    // 读 pageSessionId（@State）而不是只读 store：切会话时标题才会重建
    const storeId: string = SessionStore.get().currentSessionId();
    const id: string = this.pageSessionId.length > 0 ? this.pageSessionId : storeId;
    for (const session of this.sessions) {
      if (session.id === id) {
        return session.title.length > 0 ? session.title : id.substring(0, 8);
      }
    }
    return id.length > 0 ? id.substring(0, 8) : '会话';
  }

  /** 会话列表变化／进页面时重建「@」菜单的会话候选 */
  private onSessionsChangedForRef(): void {
    const out: RefSessionItem[] = [];
    for (const one of this.sessions) {
      const title: string = one.title.length > 0 ? one.title : one.id.substring(0, 8);
      out.push({ id: one.id, title: title, detail: one.cwd.length > 0 ? one.cwd : '' });
    }
    this.refSessions = out;
  }

  /** directories 帧变化后同步「@」菜单条目 */
  private onDirEntriesChanged(): void {
    this.rebuildRefDirs();
  }

  /** directories 帧 → 「@」菜单的工作区条目 */
  private rebuildRefDirs(): void {
    const out: RefDirItem[] = [];
    for (const one of this.dirEntries) {
      if (one.hidden) {
        continue;
      }
      out.push({ name: one.name, path: one.path, isDirectory: one.isDirectory });
    }
    this.refDirs = out;
  }

  /** 拉取当前会话工作区目录（供「@」菜单引用文件/文件夹） */
  private loadRefDirectory(): void {
    this.loadFileListAt(this.refCurrentPath);
  }

  /**
   * 读取工作区某个目录的文件列表（file-list，与小程序 requestFileList 同源）。
   * 网关用 kind: 'dir' / 'directory' 标记文件夹，这里同时兼容 isDirectory。
   */
  private loadFileListAt(path: string): void {
    const client: GatewayClient = GatewayClient.get();
    const sessionId: string = SessionStore.get().currentSessionId();
    if (!client.isConnected() || sessionId.length === 0) {
      return;
    }
    const target: string = path === '/' ? '' : path;
    client.requestFileList(sessionId, target.length > 0 ? target : undefined).then((frame: GatewayFrame) => {
      const rec: Record<string, Object> | undefined = asRec(frame);
      if (rec === undefined) {
        return;
      }
      const raw: Object | undefined = rec['entries'] !== undefined ? rec['entries'] : rec['items'];
      const items: Object[] = raw !== undefined && Array.isArray(raw) ? raw as Object[] : [];
      const out: RefDirItem[] = [];
      for (const one of items) {
        const item: Record<string, Object> | undefined = asRec(one);
        if (item === undefined) {
          continue;
        }
        const name: string = (str(item, 'name') ?? str(item, 'title') ?? '');
        if (name.length === 0) {
          continue;
        }
        const kind: string = str(item, 'kind') ?? '';
        const isDirectory: boolean = kind === 'dir' || kind === 'directory' || (str(item, 'type') ?? '') === 'dir';
        let itemPath: string = str(item, 'path') ?? '';
        if (itemPath.length === 0) {
          itemPath = target.length > 0 ? target + '/' + name : name;
        }
        out.push({ name: name, path: itemPath, isDirectory: isDirectory });
      }
      // 文件夹在前，文件在后（对齐桌面端文件树习惯）
      const dirs: RefDirItem[] = [];
      const files: RefDirItem[] = [];
      for (const one of out) {
        if (one.isDirectory) {
          dirs.push(one);
        } else {
          files.push(one);
        }
      }
      this.refDirs = dirs.concat(files);
      this.refCurrentPath = target;
    }).catch((ignored: Error) => {
    });
  }

  /** 拉取技能列表（网关 skill 指令） */
  private loadSkills(): void {
    const client: GatewayClient = GatewayClient.get();
    const sessionId: string = SessionStore.get().currentSessionId();
    if (!client.isConnected() || sessionId.length === 0) {
      return;
    }
    client.requestGateway(GatewayRequestFactory.slashCommands(sessionId), 12000).then((frame: GatewayFrame) => {
      const rec: Record<string, Object> | undefined = asRec(frame);
      if (rec === undefined) {
        return;
      }
      const groups = rec['groups'];
      if (groups === undefined || !Array.isArray(groups)) {
        return;
      }
      const out: SkillItem[] = [];
      for (const group of groups as Object[]) {
        const items = asRec(group)?.['items'];
        if (items === undefined || !Array.isArray(items)) {
          continue;
        }
        for (const one of items as Object[]) {
          const item = asRec(one);
          if (item === undefined) {
            continue;
          }
          if ((str(item, 'source') ?? '') !== 'skill') {
            continue;
          }
          const name: string = str(item, 'name') ?? '';
          if (name.length === 0) {
            continue;
          }
          out.push({ name: name, label: str(item, 'name') ?? name, description: str(item, 'description') ?? '' });
        }
      }
      this.skills = out;
    }).catch((ignored: Error) => {
    });
  }

  /**
   * 选中工作区文件/目录：清掉行尾 @query，加引用 chip（正文由 chip 呈现，发送时再拼）。
   * 文件夹引用按小程序协议带末尾斜杠（@path/），chip 也显示「名称/」+ 文件夹图标。
   */
  private insertPathRef(path: string, isDirectory: boolean): void {
    this.draft = this.stripRefTokens(this.draft);
    let normalized: string = path.replace(/\\/g, '/');
    if (isDirectory && normalized.length > 0 && !normalized.endsWith('/')) {
      normalized = normalized + '/';
    }
    const trimmed: string = normalized.endsWith('/') ? normalized.substring(0, normalized.length - 1) : normalized;
    const slash: number = trimmed.lastIndexOf('/');
    const name: string = slash >= 0 ? trimmed.substring(slash + 1) : trimmed;
    if (name.length === 0) {
      return;
    }
    const token: string = normalized.indexOf(' ') >= 0 ? '@"' + normalized + '"' : '@' + normalized;
    const chip: RefChipItem = {
      key: (isDirectory ? 'folder:' : 'file:') + normalized + ':' + Date.now().toString(),
      label: isDirectory ? name + '/' : name,
      kind: isDirectory ? 'folder' : 'file',
      token: token
    };
    this.refChips = this.refChips.concat([chip]);
    console.info('[RefChip] path added total=' + this.refChips.length + ' kind=' + chip.kind + ' path=' + normalized);
  }

  /** 选中会话引用：把行尾的 @query 换成 @标题，并加一个引用 chip */
  /** 清掉正文里残留的 @引用 token（历史版本会写入正文，避免与 chip 重复） */
  private stripRefTokens(text: string): string {
    let out: string = text;
    for (let guard = 0; guard < 10; guard++) {
      const next: string = out.replace(/\s*@[^\s]*\s*$/, '');
      if (next === out) {
        break;
      }
      out = next;
    }
    return out;
  }

  private insertSessionRef(id: string, title: string): void {
    // 只清掉正在输入的 @query，不把引用文本写进正文（正文里由 chip 呈现，发送时再拼）
    this.draft = this.stripRefTokens(this.draft);
    console.info('[RefChip] session draft="' + this.draft + '"');
    const chip: RefChipItem = {
      key: 'session:' + id + ':' + Date.now().toString(),
      label: title,
      kind: 'session',
      token: '@' + title
    };
    this.refChips = this.refChips.concat([chip]);
    console.info('[RefChip] session added total=' + this.refChips.length + ' title=' + title);
  }

  /** 移除引用 chip */
  private removeRefChip(key: string): void {
    const next: RefChipItem[] = [];
    for (const one of this.refChips) {
      if (one.key !== key) {
        next.push(one);
      }
    }
    this.refChips = next;
  }

  /** 当前会话是否在运行：实时事件优先，其次会话列表快照（外部客户端启动时没有本地事件）。 */
  private currentSessionRunning(): boolean {
    if (this.running) {
      return true;
    }
    const id: string = SessionStore.get().currentSessionId();
    for (const one of this.sessions) {
      if (one.id === id) {
        return one.running;
      }
    }
    return false;
  }

  /** 顶栏图标色：与返回键（NavBackButton.ink）完全一致 */
  private navIconColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  /** 连接状态点：连接中=琥珀、失败=红；已连接时随会话运行状态——运行中绿、空闲灰（对齐产品约定）。 */
  private connectionDotColor(): string {
    if (this.connection === 'connected') {
      return this.currentSessionRunning() ? '#2EB85C' : (this.isDark ? 'rgba(241,244,250,0.35)' : 'rgba(16,19,24,0.30)');
    }
    if (this.connection === 'connecting') {
      return '#FFAD1F';
    }
    if (this.connection === 'failed') {
      return '#D65D64';
    }
    return this.isDark ? 'rgba(241,244,250,0.40)' : 'rgba(16,19,24,0.35)';
  }

  /** 当前会话的 Agent 预设 id：会话快照优先，其次部署默认，最后标准模式。 */
  private currentAgentPresetId(): string {
    const sessionId: string = SessionStore.get().currentSessionId();
    // ① 网关每会话回执（session-agent-preset / 快照投影）最权威
    const live: string = String(this.sessionAgentPresets[sessionId] ?? '');
    if (live.length > 0) {
      return live;
    }
    // ② 会话列表快照里的 agentPreset
    for (const one of this.sessions) {
      if (one.id === sessionId && one.agentPreset.length > 0) {
        return one.agentPreset;
      }
    }
    // ③ 部署默认
    return this.defaultAgentPreset.length > 0 ? this.defaultAgentPreset : 'standard';
  }

  /** 预设内置名称（对齐 dsh-mobile L10n.presetModeName）。 */
  private presetModeName(id: string): string {
    const key: string = id.length > 0 ? id : 'standard';
    if (key === 'standard') {
      return '标准模式';
    }
    if (key === 'code' || key === 'ptc') {
      return 'PTC 模式';
    }
    if (key === 'minimal') {
      return '极简模式';
    }
    if (key === 'cordis') {
      return '创造模式';
    }
    return key + ' 模式';
  }

  /** 运行模式标签：网关自定义显示名优先，名字等于 id 时回退内置名称。 */
  private sessionModeLabel(): string {
    const id: string = this.currentAgentPresetId();
    for (const one of this.agentPresetDetails) {
      if (one.id !== id) {
        continue;
      }
      const custom: string = (one.label ?? '').trim();
      if (custom.length > 0 && custom.toLowerCase() !== id.toLowerCase()) {
        return custom;
      }
      break;
    }
    return this.presetModeName(id);
  }

  private connectionLabel(): string {
    if (this.connection === 'connected') {
      return '已连接';
    }
    if (this.connection === 'connecting') {
      return '正在连接';
    }
    if (this.connection === 'failed') {
      return '连接失败';
    }
    return '未连接';
  }

  /** 权限胶囊文案（对齐 spec §4.3 的图标映射文案）。 */
  private permissionTitle(): string {
    if (this.defaultPermission === 'read-only') {
      return '只读';
    }
    if (this.defaultPermission === 'workspace-write') {
      return '工作区写入';
    }
    if (this.defaultPermission === 'danger-full-access') {
      return '完全访问';
    }
    return '默认权限';
  }

  /** 模型胶囊文案（deepseek-chat → DeepSeek Chat）。 */
  private modelTitle(): string {
    if (this.defaultModel === 'deepseek-chat') {
      return 'DeepSeek Chat';
    }
    if (this.defaultModel === 'deepseek-reasoner') {
      return 'DeepSeek Reasoner';
    }
    return this.defaultModel.length > 0 ? this.defaultModel : '默认模型';
  }

  // ==================== 交互回调 ====================
  private onToggleEntry(id: string): void {
    // 先原地翻转：@Observed 会立即刷新该行，不依赖后续列表重建
    let next: boolean = true;
    for (const row of this.entries) {
      if (row.id === id) {
        if (row.kind === 'TURN') {
          row.expanded = !row.expanded;
          next = row.expanded;
        } else {
          // 过程组：按组体当前是否可见翻转（详细档对话过程中组体自动可见）
          next = !row.processBodyVisible;
        }
      }
    }
    this.folds.set(id, next);
    // 点行是明确的阅读动作，必须当场生效：如果 onClick 早于 onTouch(Up) 到达，
    // rebuildEntries 会被「手指按住 / 结构变化待重排」的守卫吞掉，表现就是点了没反应。
    this.listTouching = false;
    this.pendingStructure = false;
    this.rebuildEntries();
  }

  /** 步骤行展开/收起（图标槽换成箭头那一层） */
  private onToggleReasonFull(id: string): void {
    const at: number = this.reasonFullIds.indexOf(id);
    const next: string[] = this.reasonFullIds.slice();
    if (at >= 0) {
      next.splice(at, 1);
    } else {
      next.push(id);
    }
    this.reasonFullIds = next;
  }

  private onToggleReasonCard(id: string): void {
    const at: number = this.stepClosedIds.indexOf(id);
    const next: string[] = this.stepClosedIds.slice();
    if (at >= 0) {
      next.splice(at, 1);
    } else {
      next.push(id);
      // 收起成一行时，顺手清掉「整段展开」标记，下次展开回到正常卡片
      const fullAt: number = this.reasonFullIds.indexOf(id);
      if (fullAt >= 0) {
        const fullNext: string[] = this.reasonFullIds.slice();
        fullNext.splice(fullAt, 1);
        this.reasonFullIds = fullNext;
      }
    }
    this.stepClosedIds = next;
  }

  private onToggleStep(id: string): void {
    const at: number = this.stepOpenIds.indexOf(id);
    const next: string[] = this.stepOpenIds.slice();
    if (at < 0) {
      // 展开这一步时，把它从「已收起」里移除，否则卡片会被折叠态一直挡住
      const closedAt: number = this.stepClosedIds.indexOf(id);
      if (closedAt >= 0) {
        const closedNext: string[] = this.stepClosedIds.slice();
        closedNext.splice(closedAt, 1);
        this.stepClosedIds = closedNext;
      }
    }
    if (at >= 0) {
      next.splice(at, 1);
    } else {
      next.push(id);
    }
    this.stepOpenIds = next;
  }

  private onCopyEntry(text: string): void {
    if (text.length === 0) {
      return;
    }
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      this.getUIContext().getPromptAction().showToast({ message: '已复制' });
    }).catch(() => {
      this.hint = '复制失败';
    });
  }

  private onShowDetail(title: string, body: string): void {
    this.hint = body.length > 240 ? body.substring(0, 240) + '…' : body;
  }

  /** 长按回复文本 → 底部弹窗：正文可长按选中，右上角一键复制全文 */
  @Builder
  replySheet() {
    Column() {
      // 顶部拖动条：与轨迹详情弹窗一致（自绘，因为系统 dragBar 在玻璃底上不明显）
      Column()
        .width(36)
        .height(4)
        .borderRadius(2)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.18)')
        .margin({ top: 10, bottom: 8 })
      Row({ space: 8 }) {
        Text('回复内容')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Blank()
        Text('复制全文')
          .fontSize(13)
          .fontColor('#2E6BE6')
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .onClick(() => {
            this.onCopyEntry(this.replySheetText);
          })
        Text('关闭')
          .fontSize(13)
          .fontColor(this.subColor())
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .onClick(() => {
            this.replySheetOpen = false;
          })
      }
      .width('100%')
      .padding({ left: 20, right: 12, top: 6, bottom: 6 })
      .alignItems(VerticalAlign.Center)

      Text('长按正文可选择文字，选择后可直接复制')
        .fontSize(11)
        .fontColor(this.subColor())
        .width('100%')
        .padding({ left: 20, right: 20, bottom: 10 })

      Scroll() {
        Text(this.replySheetText)
          .fontSize(15)
          .lineHeight(23)
          .fontColor(this.textColor())
          .copyOption(CopyOptions.LocalDevice)
          .width('100%')
      }
      .layoutWeight(1)
      .width('100%')
      .padding({ left: 20, right: 20, bottom: 30 })
      .align(Alignment.TopStart)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  /** 发送时判断当前会话是否繁忙：页面状态 / store 运行态 / 主机会话列表 running 三级兜底。 */
  private sessionBusyNow(): boolean {
    if (this.running || SessionStore.get().isRunning()) {
      return true;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return false;
    }
    try {
      const list: SessionSummary[] = this.sessions;
      for (const one of list) {
        if (one.id === sessionId && one.running) {
          return true;
        }
      }
    } catch (err) {
    }
    return false;
  }

  private async onSend(): Promise<void> {
    // 「编辑目标」态下，发送 = 保存目标，不作为对话消息发出
    if (this.goalEditing) {
      this.finishGoalEdit(true);
      return;
    }
    const typed: string = this.draft.trim();
    let refPrefix: string = '';
    for (const chip of this.refChips) {
      refPrefix += chip.token + ' ';
    }
    const text: string = (refPrefix + typed).trim();
    if (this.sending || (text.length === 0 && this.pickedAttachments.length === 0)) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关：请先在设置页扫码配对';
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      this.hint = '请先打开一个会话';
      return;
    }
    this.sending = true;
    // 运行中（含规划/思考阶段）：发送应进入队列，而不是直接插进会话。
    const sessionBusy: boolean = this.sessionBusyNow();
    const generation: number = client.generation();
    const selected: PickedAttachment[] = this.pickedAttachments.slice();
    try {
      // 图片走 images(base64)，其余文件才走上传回执
      const imagePayloads: Object[] = [];
      const fileAttachments: PickedAttachment[] = [];
      for (const attachment of selected) {
        if (this.isImageAttachment(attachment.name)) {
          const payload: Object | undefined = this.imagePayloadOf(attachment);
          if (payload !== undefined) {
            imagePayloads.push(payload);
            continue;
          }
        }
        fileAttachments.push(attachment);
      }
      const uploaded: UploadResult[] = [];
      for (const attachment of fileAttachments) {
        if (client.generation() !== generation || sessionId !== SessionStore.get().currentSessionId()) {
          throw new Error('连接或会话已变化，草稿已保留');
        }
        const result: UploadResult = await uploadAttachment(client, sessionId, attachment, (percent: number) => {
          this.attachmentHint = '正在上传 ' + attachment.name + ' · ' + percent + '%';
        });
        uploaded.push(result);
      }
      if (client.generation() !== generation || sessionId !== SessionStore.get().currentSessionId()) {
        throw new Error('连接或会话已变化，草稿已保留');
      }
      if (uploaded.length > 0 || imagePayloads.length > 0) {
        const receipts: UploadReceipt[] = uploaded.map((item: UploadResult): UploadReceipt => ({ receiptId: item.receiptId }));
        const ack = await client.sendUserMessageWithMedia(text, sessionId, imagePayloads, receipts);
        if (ack.sessionId !== sessionId) {
          throw new Error('发送确认无效，草稿已保留');
        }
      } else if (!client.sendUserMessage(text, sessionId)) {
        throw new Error('发送失败，请检查连接');
      }
      if (sessionId !== SessionStore.get().currentSessionId() || this.draft.trim() !== typed) {
        return;
      }
      // 乐观回显（对齐小程序 store.appendLocalUserRow）：发送成功即本地插入用户气泡，
      // 真实 user/message 到达时由 adoptOptimisticUser 交棒；排队消息由队列行呈现，不重复插。
      Logger.info('[SEND] ok sid=' + sessionId.slice(-8) + ' running=' + (sessionBusy ? '1' : '0')
        + ' optimistic=' + (!sessionBusy ? '1' : '0') + ' len=' + text.length.toString());
      // 这次发送带图时先记下本地图片 uri：如果主机把它排进队列（运行中/忙），
      // 队列行只有 preview 文本和附件数量，靠这份记录才能显示缩略图。
      const sentImages: string[] = [];
      for (const one of selected) {
        if (this.isImageAttachment(one.name)) {
          sentImages.push(one.uri);
        }
      }
      Logger.info('[QUEUEIMG] send running=' + (sessionBusy ? '1' : '0')
        + ' selected=' + selected.length.toString() + ' images=' + sentImages.length.toString());
      // 只有「运行中发送」才会进主机队列；空闲发送直接进入对话，
      // 这时不能再生成排队行（否则会出现一条假排队消息）。
      if (sessionBusy && sentImages.length > 0) {
        this.queuedImagesByText.set(text, sentImages);
        this.lastQueuedImageAt = Date.now();
        this.queuedImagesRevision = this.queuedImagesRevision + 1;
        // 立即生成一条本地排队行（不等主机队列帧）：主机的队列项往往没有图片信息
        this.localQueueRows = this.localQueueRows.concat([text + '\u0001' + sentImages.join('\u0002')]);
        this.persistQueueImages(text, sentImages);
        Logger.info('[QUEUEIMG] record key="' + text.substring(0, 20) + '" images=' + sentImages.length.toString());
        setTimeout(() => {
          this.dropLocalQueueRow(text);
        }, 20000);
      } else if (sentImages.length > 0) {
        // 空闲发送：不记队列图，直接随用户气泡展示
        this.queuedImagesByText.delete(text);
      }
      if (!sessionBusy) {
        SessionStore.get().appendOptimisticUser(text, selected.length, sentImages);
      }
      this.hint = '';
      this.attachmentHint = '';
      this.pickedAttachments = [];
      this.refChips = [];
      this.draft = '';
      // 发送成功：清掉该会话草稿（含防抖里还没落盘的那一次）
      if (this.draftSaveTimer >= 0) {
        clearTimeout(this.draftSaveTimer);
        this.draftSaveTimer = -1;
      }
      DraftStore.get().clear(sessionId);
      this.autoStick = true;
      setTimeout(() => {
        this.scroller.scrollEdge(Edge.Bottom);
      }, 30);
    } catch (error) {
      this.attachmentHint = error instanceof Error ? error.message : '附件发送失败，已保留选择内容';
    } finally {
      this.sending = false;
    }
  }

  private onStop(): void {
    if (!SessionStore.get().stopGenerating()) {
      this.hint = '停止失败：请检查连接';
    }
  }

  // ==================== 长按语音（走网关语音插件，和微信小程序同一条链路） ====================
  /**
   * 按下 350ms：先问网关要能力（没有插件时没必要弹麦克风权限），再申请麦克风，最后开录。
   * 顺序对齐小程序 voice-input.js：catalog → permission → start。
   *
   * 之前这里缺了麦克风权限申请，也缺了 module.json5 里的 ohos.permission.MICROPHONE 声明，
   * 于是 createAudioCapturer 直接抛 6800301「system error」，用户只看到「麦克风启动失败，system error」。
   */
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
        // 拿限制期间已经松手了
        this.resetVoice();
        return;
      }
      this.speechLimits = limits;
      const granted: boolean = await this.requestMicPermission();
      if (token !== this.voiceHoldToken) {
        // 弹权限框期间手指已经松开了：授权成功就提示再按住一次，否则用户会以为没生效
        if (granted) {
          this.hint = '麦克风已授权，按住输入框再说一次';
        }
        this.resetVoice();
        return;
      }
      if (!granted) {
        throw new SpeechFailure('voice/permission', SpeechFailure.messageFor('voice/permission'));
      }
      this.setVoicePhase('starting');
      await this.dictation.start(limits, (message: string) => {
        // 录音中断属于「已经结束」的状态，不再用输入框上方那条红字提示，
        // 收起特效即可（红字留给真正需要用户处理的失败）。
        Logger.warn('speech interrupted: ' + message);
        this.resetVoice();
      });
      if (token !== this.voiceHoldToken) {
        this.dictation.cancel();
        this.resetVoice();
        return;
      }
      this.setVoicePhase('recording');
    } catch (err) {
      this.failVoice(err);
    }
  }

  /** 只在按住时申请一次：已授权时系统直接返回，不会反复弹窗 */
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
      Logger.warn('request microphone permission failed: ' + JSON.stringify(err));
      return false;
    }
  }

  /** 阶段切换：特效可见性、状态文案、输入条让位都从这里统一派发 */
  private setVoicePhase(phase: string): void {
    this.voicePhase = phase;
    this.voiceOverlayVisible = phase === 'authorizing' || phase === 'starting' || phase === 'recording';
    this.voiceRecording = phase !== 'idle';
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
    this.speechLimits = null;
    this.voiceCancelArmed = false;
    this.setVoicePhase('idle');
  }

  private onVoiceHoldMove(cancel: boolean): void {
    if (this.voiceCancelArmed === cancel) {
      return;
    }
    this.voiceCancelArmed = cancel;
    if (!this.voiceOverlayVisible) {
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
      return;
    }
    // 松手：结束采集 → 转 WAV → 网关转写（特效收起，输入条回来显示「正在转文字…」）
    this.setVoicePhase('transcribing');
    this.dictation.stopAndTranscribe(limits).then((text: string) => {
      this.insertVoiceText(text);
      this.resetVoice();
    }).catch((err: Object) => {
      this.failVoice(err);
    });
  }

  /** 失败统一收尾：把错误码翻成人话，并给出可执行动作（去设置 / 插件设置） */
  private failVoice(err: Object): void {
    this.resetVoice();
    const failure: SpeechFailure | null = err instanceof SpeechFailure ? err : null;
    const code: string = failure !== null ? failure.code : '';
    const message: string = failure !== null
      ? failure.message
      : (err instanceof Error ? err.message : SpeechFailure.messageFor(''));
    Logger.warn('speech failed code=' + code + ' message=' + message);
    this.showVoiceError(message, code);
  }

  private showVoiceError(message: string, code: string): void {
    const needsPermission: boolean = code === 'voice/permission' || code === 'voice/start-timeout';
    const needsPlugin: boolean = code === 'speech/not-ready' || code === 'speech/unavailable'
      || code === 'speech/invalid-response';
    if (!needsPermission && !needsPlugin) {
      AlertDialog.show({
        title: '语音输入',
        message: message,
        autoCancel: true,
        alignment: DialogAlignment.Center,
        confirm: { value: '知道了', action: () => {} }
      });
      return;
    }
    AlertDialog.show({
      title: '语音输入',
      message: message,
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: needsPermission ? '去设置' : '插件设置',
        action: () => {
          if (needsPermission) {
            this.openSystemPermissionPage();
          } else {
            this.pageStack.pushPathByName('plugins', null);
          }
        }
      }
    });
  }

  /** 跳到系统的「应用信息 / 权限」页；入口名各 ROM 不一，失败就退化成文案提示 */
  private openSystemPermissionPage(): void {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const want: Want = {
        bundleName: 'com.huawei.hmos.settings',
        abilityName: 'com.huawei.hmos.settings.MainAbility',
        uri: 'application_info_entry',
        parameters: { pushParams: context.abilityInfo.bundleName }
      };
      context.startAbility(want).catch(() => {
        this.hint = '请到「设置 > 应用和元服务 > 鲸尾 > 权限」中开启麦克风';
      });
    } catch (err) {
      this.hint = '请到「设置 > 应用和元服务 > 鲸尾 > 权限」中开启麦克风';
    }
  }

  private insertVoiceText(text: string): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.draft = this.draft + trimmed;
    this.voiceMode = false;
  }

  private toggleVoiceMode(): void {
    const next: boolean = !this.voiceMode;
    this.voiceMode = next;
    if (next) {
      // 收键盘。展开卡片原地切成「按住说话」（composer 的语音触摸层已覆盖文字域），
      // 不再塌回折叠条 —— 只有未展开的胶囊才需要塌下去露出长按区。
      try {
        this.getUIContext().getFocusController().clearFocus();
      } catch (err) {
      }
    }
  }

  private async pickImageAttachments(): Promise<void> {
    try {
      const picked: PickedAttachment[] = await pickImages(4);
      const localized: PickedAttachment[] = this.localizePickedImages(picked);
      this.pickedAttachments = localized;
      this.attachmentHint = localized.length > 0 ? '已选择 ' + localized.length + ' 张图片' : '';
    } catch (err) {
      this.attachmentHint = '未选择图片';
    }
  }

  /**
   * 相册选择器返回的是 file://media/... 这种「临时授权 URI」：
   * ① ArkUI 的 Image 不能直接渲染它（显示空白）；
   * ② 进程重启后授权失效，历史消息里的图片也会变空白。
   * 这里把字节复制进应用缓存目录，改用普通沙箱路径显示/上传
   * （对齐小程序 attachment-cache.js 的 adoptFromFile：发送前先把临时文件归入缓存）。
   */
  private localizePickedImages(picked: PickedAttachment[]): PickedAttachment[] {
    if (picked.length === 0) {
      return picked;
    }
    const out: PickedAttachment[] = [];
    let dir: string = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      dir = context.cacheDir + '/picked-images';
      try {
        fileIo.mkdirSync(dir);
      } catch (ignored) {
      }
    } catch (err) {
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
        Logger.info('[IMG] localized ' + one.uri.substring(0, 24) + ' -> ' + dest);
      } catch (err) {
        // 复制失败就沿用原 URI：至少当前会话内可能还能显示
        Logger.warn('[IMG] localize failed ' + one.uri.substring(0, 24) + ' '
          + (err instanceof Error ? err.message : String(err)));
        out.push(one);
      }
    }
    return out;
  }

  private async pickAttachments(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const picked: PickedAttachment[] = await pickDocuments(context, 4);
      this.pickedAttachments = picked;
      this.attachmentHint = picked.length > 0 ? '已选择 ' + picked.length + ' 个附件' : '';
    } catch (err) {
      this.attachmentHint = '未选择附件';
    }
  }

  private loadOlder(): void {
    if (!SessionStore.get().loadOlder()) {
      this.hint = '没有更早的记录了';
    }
  }

  private openSession(sessionId: string): void {
    if (sessionId !== SessionStore.get().currentSessionId()) {
      // 切会话：先把当前草稿落盘，再清空输入框并载入目标会话的草稿
      this.flushDraft();
      this.folds.clear();
      this.stepOpenIds = [];
      this.lastTailKey = '';
      SessionStore.get().open(sessionId);
      this.draft = '';
      this.draftRestoreRetries = 0;
      this.restoreDraft();
      this.afterSessionSwitched();
    }
  }

  /**
   * 会话切换后的页面自刷新：`store.open()` 只更新数据层与 AppStorage，
   * 顶栏标题/时间线/进度条读的是页面自身 @State，不主动重排会停留在上一个会话
   * （表现为「点了侧栏会话，页面还是旧会话/空态」）。
   */
  private afterSessionSwitched(): void {
    Logger.info('[SidebarTap] refresh page -> ' + SessionStore.get().currentSessionId());
    // 切换后的新会话历史还没到：这段时间禁止时间线冻结（胶囊展开态默认开着，
    // 不放过这一小段会让页面一直显示旧会话内容）
    this.pendingSessionRender = true;
    this.pageSessionId = SessionStore.get().currentSessionId();
    this.entries = [];
    this.autoStick = true;
    this.rebuildEntries();
    this.refreshProgress();
    this.refreshModelEfforts();
    this.requestDockData();
  }

  // ==================== 草稿持久化（对齐小程序 sessionDraftStore） ====================
  /** 每个会话各存一份草稿，重启后仍在；发送成功后清掉 */
  private restoreDraft(): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (!PreferencesStore.get().isReady()) {
      // 冷启动偏好还没就绪：稍后再读，别把草稿读成空
      if (this.draftRestoreRetries < 5) {
        this.draftRestoreRetries += 1;
        setTimeout(() => {
          this.restoreDraft();
        }, 300);
      }
      return;
    }
    if (sessionId.length === 0) {
      return;
    }
    this.draftOwnerSessionId = sessionId;
    const saved: string = DraftStore.get().load(sessionId);
    if (saved.length > 0 && this.draft.length === 0) {
      this.draft = saved;
    }
  }

  private scheduleDraftSave(): void {
    if (this.draftSaveTimer >= 0) {
      return;
    }
    this.draftSaveTimer = setTimeout(() => {
      this.draftSaveTimer = -1;
      this.flushDraft();
    }, 300);
  }

  private flushDraft(): void {
    if (this.draftSaveTimer >= 0) {
      clearTimeout(this.draftSaveTimer);
      this.draftSaveTimer = -1;
    }
    const sessionId: string = this.draftOwnerSessionId.length > 0
      ? this.draftOwnerSessionId : SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return;
    }
    DraftStore.get().save(sessionId, this.draft);
  }





  // ==================== 底部 dock：排队消息 / 任务 / 目标（对齐小程序 dock-stack）====================
  private rpx(value: number): number {
    try {
      const screenW: number = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
      return value * screenW / 750;
    } catch (err) {
      return value * 0.53;
    }
  }

  private onConnectionChanged(): void {
    if (this.connection === 'connected') {
      this.requestDockData();
      // 连上网关后补拉「/」技能列表与「@」工作区目录
      this.loadSkills();
      this.loadRefDirectory();
      // 断开时预取过的图片 / 文件变更摘要都失败了：连上后重排一次，
      // 让 preloadImages / loadFileSummaries 重新发起（否则占位会一直停着）。
      const stale: string[] = [];
      for (const item of this.fileSummaries) {
        if (item.indexOf('\u0001ready\u0001') < 0) {
          continue;
        }
        const parts: string[] = item.split('\u0001');
        if (parts.length > 0) {
          stale.push(parts[0]);
        }
      }
      this.fileSummaryRequested.clear();
      this.fileSummaries = [];
      this.imageFailedEntries = [];
      this.publishImageFailures();
      this.rebuildEntries();
    }
  }

  private requestDockData(): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || this.connection !== 'connected') {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    client.requestQueue(sessionId).catch(() => {});
    client.requestTasks(sessionId).catch(() => {});
    client.requestGoal(sessionId).catch(() => {});
  }

  /** 顶部轻提示：淡入 + 停留 2.6s + 淡出（不打断输入，不挡触摸） */
  private showToast(message: string, error: boolean = false): void {
    if (message.length === 0) {
      return;
    }
    if (this.toastTimer >= 0) {
      clearTimeout(this.toastTimer);
      this.toastTimer = -1;
    }
    this.toastText = message;
    this.toastError = error;
    this.toastOffset = -10;
    this.toastOpacity = 0;
    this.getUIContext().animateTo({ duration: 180, curve: Curve.EaseOut }, () => {
      this.toastOpacity = 1;
      this.toastOffset = 0;
    });
    this.toastTimer = setTimeout(() => {
      this.getUIContext().animateTo({ duration: 160, curve: Curve.EaseIn }, () => {
        this.toastOpacity = 0;
        this.toastOffset = -10;
      });
      setTimeout(() => {
        if (this.toastOpacity === 0) {
          this.toastText = '';
        }
      }, 200);
      this.toastTimer = -1;
    }, 2600);
  }

  @Builder
  topToast() {
    if (this.toastText.length > 0) {
      Row({ space: 9 }) {
        Text('!')
          .fontSize(12)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .width(18)
          .height(18)
          .borderRadius(9)
          .textAlign(TextAlign.Center)
          .backgroundColor(this.toastError ? '#E5533C' : '#2E6BE6')
        Text(this.toastText)
          .fontSize(13)
          .lineHeight(19)
          .fontColor(this.toastError ? (this.isDark ? '#FF9B9F' : '#C0392B') : this.textColor())
          .layoutWeight(1)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .constraintSize({ maxWidth: '92%' })
      .padding({ left: 14, right: 18, top: 12, bottom: 12 })
      .borderRadius(16)
      .backgroundColor(this.isDark ? 'rgba(32,34,40,0.96)' : 'rgba(255,255,255,0.97)')
      .border({
        width: 0.5,
        color: this.toastError
          ? 'rgba(235,87,87,0.38)'
          : (this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)')
      })
      .shadow({ radius: 18, color: this.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(16,19,24,0.16)', offsetY: 4 })
      .opacity(this.toastOpacity)
      .translate({ y: this.toastOffset })
    }
  }

  private onQueueChanged(): void {
    // 队列变化时立刻按 attachmentId 拉队列消息里的图片（缩略图要用）
    this.resolveQueueImages();
    // 队列清空后丢掉本地图片记录，避免一直缓存。
    // 注意刚发完的 15 秒内不清：发送后主机可能先推一帧空队列，再推带这条消息的队列，
    // 过早清掉会导致队列卡片永远拿不到本地缩略图。
    // 空闲且队列为空：本地排队行没有存在意义（那是运行中才有的东西），立即清掉
    if (this.queue.length === 0 && !this.runActive() && this.localQueueRows.length > 0) {
      this.localQueueRows = [];
    }
    if (this.queue.length === 0 && this.queuedImagesByText.size > 0
      && Date.now() - this.lastQueuedImageAt > 15000) {
      this.queuedImagesByText.clear();
      this.queuedImagesRevision = this.queuedImagesRevision + 1;
    }
    // 隐藏标记保留 60 秒：主机可能先推一帧不含该条的队列、随后又推回旧快照，
    // 过早清除会让已经发出的消息重新冒出来。
    if (this.hiddenQueueIds.length > 0) {
      const now: number = Date.now();
      const keep: string[] = [];
      for (const id of this.hiddenQueueIds) {
        const since: number = this.hiddenQueueSince.get(id) ?? now;
        if (now - since < 60000) {
          keep.push(id);
        } else {
          this.hiddenQueueSince.delete(id);
        }
      }
      if (keep.length !== this.hiddenQueueIds.length) {
        this.hiddenQueueIds = keep;
      }
    }
    // steer 失败标记：队列里已不存在该项就清掉，避免 id 列表无限增长
    if (this.steerFailedIds.length > 0) {
      const kept: string[] = [];
      for (const id of this.steerFailedIds) {
        for (const item of this.queue) {
          if (item.id === id) {
            kept.push(id);
            break;
          }
        }
      }
      this.steerFailedIds = kept;
    }
    if (this.queueBusyId.length === 0) {
      return;
    }
    const busyId: string = this.queueBusyId.split(':')[0];
    let found: boolean = false;
    for (const item of this.queue) {
      if (item.id === busyId) {
        found = true;
      }
    }
    if (!found) {
      this.queueBusyId = '';
    }
  }

  private onTasksChanged(): void {
  }

  private visibleQueueCount(): number {
    return this.visibleQueueItems().length;
  }

  /** 标记/取消某个队列项的本地隐藏（点发送后立刻从队列消失）。 */
  private setQueueItemHidden(id: string, hidden: boolean): void {
    const next: string[] = this.hiddenQueueIds.slice();
    const at: number = next.indexOf(id);
    if (hidden && at < 0) {
      next.push(id);
      this.hiddenQueueSince.set(id, Date.now());
    } else if (!hidden && at >= 0) {
      next.splice(at, 1);
      this.hiddenQueueSince.delete(id);
    } else {
      return;
    }
    this.hiddenQueueIds = next;
  }

  /** 消息已经在会话里出现（队列消息被主机处理完）：对应的队列行立刻隐藏，不等队列帧迟到。 */
  private hideDeliveredQueueItems(): void {
    if (this.queue.length === 0) {
      return;
    }
    const items: ConversationItem[] = this.items;
    if (items.length === 0) {
      return;
    }
    for (const queued of this.queue) {
      if (this.hiddenQueueIds.indexOf(queued.id) >= 0) {
        continue;
      }
      const text: string = queued.preview;
      if (text.length < 2) {
        continue;
      }
      const probe: string = text.substring(0, Math.min(12, text.length));
      let matched: boolean = false;
      let scanned: number = 0;
      for (let index = items.length - 1; index >= 0 && scanned < 12; index--) {
        const item: ConversationItem = items[index];
        if ((item.kind as string) === (ConversationItemKind.USER as string)) {
          matched = item.text === text || item.text.indexOf(probe) >= 0;
          break;
        }
        scanned += 1;
      }
      if (matched) {
        this.setQueueItemHidden(queued.id, true);
      }
    }
  }

  /** 发送成功后补一条本地用户气泡（主机回显到达时会按文本采纳，不会重复）。 */
  private appendSentUserBubble(text: string): void {
    const items: ConversationItem[] = this.items;
    let checked: number = 0;
    for (let index = items.length - 1; index >= 0 && checked < 6; index--) {
      const item: ConversationItem = items[index];
      if ((item.kind as string) === (ConversationItemKind.USER as string)) {
        if (item.text === text) {
          return;
        }
        break;
      }
      checked += 1;
    }
    SessionStore.get().appendOptimisticUser(text, 0, []);
  }

  private async queueAction(item: QueueItem, action: string): Promise<void> {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || this.queueBusyId.length > 0) {
      return;
    }
    if (action === 'steer') {
      this.queueBusyId = item.id + ':steer';
      // 点下发送就立刻从队列里消失，不再显示「还在队列」的状态
      this.setQueueItemHidden(item.id, true);
      let steered: boolean = false;
      try {
        // 立即发送 = 强行插入当前回合（steer）；主机 2.5 秒内不回执就回落为移出队列立即发新消息
        const frame: GatewayFrame = await GatewayClient.get().queueUpdateAndWait(sessionId, item.id, 'steer', 2500);
        const failed: boolean = frame.kind === 'error' || frame.code !== undefined;
        if (!failed) {
          steered = true;
          SessionStore.get().removeQueueItem(item.id);
          this.appendSentUserBubble(item.preview);
          this.hint = '';
          this.autoStick = true;
          setTimeout(() => {
            this.scroller.scrollEdge(Edge.Bottom);
          }, 60);
          setTimeout(() => {
            this.requestDockData();
          }, 600);
        }
      } catch (err) {
      }
      if (!steered) {
        try {
          await this.sendQueuedImmediately(item, sessionId);
        } catch (error) {
          this.setQueueItemHidden(item.id, false);
          this.showToast(error instanceof Error ? error.message : '立即发送失败，请重试', true);
          this.requestDockData();
        }
      }
      this.queueBusyId = '';
      return;
    }
    let operation: string = action;
    if (action === 'edit') {
      // 编辑：取回草稿并从队列移除（对齐小程序 queueAction edit 分支）
      const text: string = item.preview;
      this.draft = this.draft.length > 0 ? this.draft + '\n\n' + text : text;
      operation = 'remove';
    }
    this.queueBusyId = item.id + ':' + operation;
    try {
      const frame: GatewayFrame = await GatewayClient.get().queueUpdateAndWait(sessionId, item.id, operation);
      const failed: boolean = frame.kind === 'error' || frame.code !== undefined;
      if (failed) {
        const raw: string = frame.message !== undefined ? frame.message : '';
        let message: string = raw;
        if (raw.indexOf('no longer accepts steering') >= 0) {
          message = '当前回合已结束，这条排队消息会在下一轮发送';
        } else if (message.length === 0) {
          message = operation === 'steer' ? '立即发送失败，请重试' : '队列操作失败';
        }
        if (operation === 'steer' && this.steerFailedIds.indexOf(item.id) < 0) {
          const failedIds: string[] = this.steerFailedIds.slice();
          failedIds.push(item.id);
          this.steerFailedIds = failedIds;
        }
        this.showToast(message, true);
        this.requestDockData();
      } else {
        // 成功：先本地移除，队列数字/行立刻消失，再拉权威快照校正
        SessionStore.get().removeQueueItem(item.id);
        if (this.steerFailedIds.indexOf(item.id) >= 0) {
          const kept: string[] = [];
          for (const id of this.steerFailedIds) {
            if (id !== item.id) {
              kept.push(id);
            }
          }
          this.steerFailedIds = kept;
        }
        this.hint = '';
        if (operation === 'steer') {
          this.autoStick = true;
          setTimeout(() => {
            this.scroller.scrollEdge(Edge.Bottom);
          }, 60);
        }
        setTimeout(() => {
          this.requestDockData();
        }, 600);
      }
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : '队列操作超时，请重试', true);
      this.requestDockData();
    } finally {
      this.queueBusyId = '';
    }
  }

  /**
   * 队列里的消息「立即发送」：先让网关把它移出队列，再立刻作为一条新用户消息发出去。
   * 用于回合已结束（steer 不再被接受）或本来就没有运行中回合的情况。
   */
  private async sendQueuedImmediately(item: QueueItem, sessionId: string): Promise<void> {
    const frame: GatewayFrame = await GatewayClient.get().queueUpdateAndWait(sessionId, item.id, 'remove', 2500);
    const failed: boolean = frame.kind === 'error' || frame.code !== undefined;
    if (failed) {
      const raw: string = frame.message !== undefined ? frame.message : '';
      this.showToast(raw.length > 0 ? raw : '移出队列失败，请重试', true);
      this.requestDockData();
      return;
    }
    SessionStore.get().removeQueueItem(item.id);
    this.appendSentUserBubble(item.preview);
    const sent: boolean = GatewayClient.get().sendUserMessage(item.preview, sessionId);
    if (!sent) {
      this.showToast('未连接网关，无法立即发送', true);
      this.requestDockData();
      return;
    }
    this.hint = '';
    this.autoStick = true;
    setTimeout(() => {
      this.scroller.scrollEdge(Edge.Bottom);
    }, 60);
    setTimeout(() => {
      this.requestDockData();
    }, 600);
  }

  private goalReference(): GatewayGoalReference {
    const ref: GatewayGoalReference = { id: this.goal.id, revision: this.goal.revision };
    return ref;
  }

  /** 目标变更（pause/resume/clear/edit）：本地置忙 + 5s 兜底，回执帧会清掉忙碌态。 */
  private mutateGoal(type: string, objective: string = ''): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || this.goalBusy) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    let sent: boolean = false;
    if (type === 'goal-edit') {
      sent = client.goalEdit(sessionId, this.goalReference(), objective);
    } else {
      sent = client.goalAction(type, sessionId, this.goalReference());
    }
    if (!sent) {
      return;
    }
    this.goalBusy = true;
    if (this.goalBusyTimer >= 0) {
      clearTimeout(this.goalBusyTimer);
    }
    this.goalBusyTimer = setTimeout(() => {
      this.goalBusy = false;
      this.goalBusyTimer = -1;
    }, 5000);
  }

  /**
   * 进入「编辑目标」：目标文本直接放进输入框编辑。
   * 之前是在目标卡片里塞一个 TextArea，但卡片高度有限、长目标看不全，所以改成用主输入框。
   */
  private beginGoalEdit(): void {
    const text: string = this.goal.objective.trim();
    if (text.length === 0) {
      return;
    }
    if (!this.goalEditing) {
      this.goalEditBackup = this.draft;
    }
    this.goalEditing = true;
    this.draft = text;
    this.hint = '编辑目标中：发送即保存，返回键取消';
    // 展开输入条并聚焦（键盘随焦点弹出）
    this.composerFocused = true;
    this.dockBarHeight = this.lastExpandedCardHeight;
    setTimeout(() => {
      try {
        this.getUIContext().getFocusController().requestFocus('composer-draft-area');
      } catch (err) {
      }
    }, 80);
  }

  /** 退出「编辑目标」态：save=true 时把输入框内容写回目标；随后还原原草稿 */
  private finishGoalEdit(save: boolean): void {
    if (!this.goalEditing) {
      return;
    }
    const text: string = this.draft.trim();
    this.goalEditing = false;
    this.hint = '';
    this.draft = this.goalEditBackup;
    this.goalEditBackup = '';
    this.composerFocused = false;
    this.dockBarHeight = 52;
    if (save && text.length > 0 && text !== this.goal.objective) {
      this.mutateGoal('goal-edit', text);
    }
  }

  private clearGoal(): void {
    AlertDialog.show({
      title: '清除目标',
      message: '清除后将停止当前目标的后续自动轮次。',
      autoCancel: true,
      alignment: DialogAlignment.Center,
      primaryButton: { value: '取消', action: () => {} },
      secondaryButton: {
        value: '清除',
        fontColor: '#E5484D',
        action: () => {
          this.mutateGoal('goal-clear');
        }
      }
    });
  }

  private taskSummary(): string {
    let done: number = 0;
    let active: number = 0;
    let pending: number = 0;
    for (const task of this.tasks) {
      if (task.status === 'completed') {
        done += 1;
      } else if (task.status === 'in_progress') {
        active += 1;
      } else {
        pending += 1;
      }
    }
    const parts: string[] = [];
    if (done > 0) {
      parts.push(done.toString() + ' 已完成');
    }
    if (active > 0) {
      parts.push(active.toString() + ' 进行中');
    }
    if (pending > 0) {
      parts.push(pending.toString() + ' 待处理');
    }
    return parts.join(' · ');
  }

  /** 新会话是否显示模式切换（还没有任何消息、也没在跑） */
  private showModeChip(): boolean {
    return this.entries.length === 0 && !this.runActive() && this.queue.length === 0;
  }

  /** 内置模式的默认说明（网关没给 description 时兜底） */
  private defaultModeDesc(id: string): string {
    if (id === 'standard') {
      return '完整工具，适合日常开发';
    }
    if (id === 'code' || id === 'ptc') {
      return '用代码组合多步工具操作';
    }
    if (id === 'minimal') {
      return '仅用 Shell，轻量直接';
    }
    if (id === 'cordis') {
      return '创建和调试自定义 Agent';
    }
    return '自定义 Agent 模式';
  }

  /** 内置四个模式的固定中文名与说明（对齐小程序/iOS 文案） */
  private builtinModeLabel(id: string): string {
    if (id === 'standard') {
      return '标准模式';
    }
    if (id === 'code' || id === 'ptc') {
      return 'PTC 模式';
    }
    if (id === 'minimal') {
      return '极简模式';
    }
    if (id === 'cordis') {
      return '创造模式';
    }
    return '';
  }

  /** 模式选项：网关预设优先，否则用内置几个；内置模式统一中文名+固定说明 */
  private modeOptions(): PresetOption[] {
    const out: PresetOption[] = [];
    if (this.agentPresetDetails.length > 0) {
      for (const one of this.agentPresetDetails) {
        const builtin: string = this.builtinModeLabel(one.id);
        out.push({
          id: one.id,
          label: builtin.length > 0 ? builtin : (one.label.length > 0 ? one.label : one.id),
          description: this.defaultModeDesc(one.id),
          broken: one.broken,
          brokenReason: one.brokenReason
        });
      }
      return out;
    }
    out.push({ id: 'standard', label: '标准模式', description: this.defaultModeDesc('standard'), broken: false, brokenReason: '' });
    out.push({ id: 'code', label: 'PTC 模式', description: this.defaultModeDesc('code'), broken: false, brokenReason: '' });
    out.push({ id: 'minimal', label: '极简模式', description: this.defaultModeDesc('minimal'), broken: false, brokenReason: '' });
    out.push({ id: 'cordis', label: '创造模式', description: this.defaultModeDesc('cordis'), broken: false, brokenReason: '' });
    return out;
  }

  /** 左上角模式胶囊（玻璃交给 HdsGlassSurface：内容区自挂 systemMaterial 不生效） */
  @Builder
  modeChip() {
    // 平板/宽屏：rpx 会按整屏宽度放大（42rpx≈80vp，显得巨大），这里直接用 vp 定死小尺寸
    HdsGlassSurface() {
    Button({ type: ButtonType.Capsule, stateEffect: true }) {
      Row({ space: this.wideInset() > 0 ? 5 : this.rpx(8) }) {
        Text(this.modeChipLabel)
          .fontSize(this.wideInset() > 0 ? 11 : 12.5)
          .fontColor(this.textColor())
          .maxLines(1)
        Image($r('app.media.chev_right_gray'))
          .width(this.wideInset() > 0 ? 12 : this.rpx(18))
          .height(this.wideInset() > 0 ? 12 : this.rpx(18))
          .objectFit(ImageFit.Contain)
          .rotate({ angle: -90 })
          .opacity(0.7)
      }
      .alignItems(VerticalAlign.Center)
      .padding({
        left: this.wideInset() > 0 ? 12 : this.rpx(22),
        right: this.wideInset() > 0 ? 10 : this.rpx(18)
      })
    }
    .constraintSize({ minHeight: this.wideInset() > 0 ? 32 : this.rpx(56) })
    .buttonStyle(ButtonStyleMode.NORMAL)
    // 玻璃由外层 HdsGlassSurface 出；Button 自身必须透明，否则会盖住材质
    .backgroundColor('#00000000')
    .onClick(() => {
      this.modeChipOpen = !this.modeChipOpen;
    })
    // 原生菜单（与右上角「⋯」同款容器/描边/收起行为）
    .bindMenu(this.modeChipOpen, this.modeMenu(), {
      placement: Placement.TopLeft,
      offset: { x: 0, y: -6 },
      outlineColor: this.dividerColor(),
      outlineWidth: 1,
      onWillDisappear: () => {
        this.modeChipOpen = false;
      },
      onDisappear: () => {
        this.modeChipOpen = false;
      },
      onDidDisappear: () => {
        this.modeChipOpen = false;
      }
    })
    }
  }

  /** 模式菜单（原生 bindMenu 内容，与右上角「⋯」菜单同款） */
  /** 菜单行：模式名称 + 说明（放进原生 MenuItem） */
  @Builder
  modeMenuRow(item: PresetOption, current: boolean) {
    Column() {
      // hover 底色只铺在内容胶囊上，胶囊左右各留 12，避免贴着菜单边框
      Column({ space: 2 }) {
        Row() {
          Text(item.label.length > 0 ? item.label : item.id)
            .fontSize(15)
            .fontColor(item.broken ? this.subColor() : this.textColor())
            .maxLines(1)
          Blank()
          if (current) {
            // 选中标记：蓝色圆底 + 白色对勾，垂直居中
            Stack({ alignContent: Alignment.Center }) {
              Text('✓')
                .fontSize(11)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
            }
            .width(19)
            .height(19)
            .borderRadius(9.5)
            .backgroundColor('#2E6BE6')
          }
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)
        if (item.description.length > 0) {
          Text(item.description)
            .fontSize(11.5)
            .fontColor(this.subColor())
            .maxLines(2)
            .width('100%')
        }
      }
      .width('100%')
      .padding({ left: 18, right: 18, top: 9, bottom: 9 })
      // 只有选中项显示底色，圆角拉到最大；未选中保持全透明
      .borderRadius(current ? 20 : 12)
      .alignItems(HorizontalAlign.Start)
      .backgroundColor(current
        ? (this.isDark ? 'rgba(46,107,230,0.26)' : 'rgba(46,107,230,0.10)')
        : Color.Transparent)
      .stateStyles({
        normal: {
          .backgroundColor(current
            ? (this.isDark ? 'rgba(46,107,230,0.26)' : 'rgba(46,107,230,0.10)')
            : Color.Transparent)
        },
        pressed: {
          .backgroundColor(current
            ? (this.isDark ? 'rgba(46,107,230,0.34)' : 'rgba(46,107,230,0.16)')
            : (this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)'))
        }
      })
    }
    .width(236)
    .padding({ left: 6, right: 6 })
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: this.rpx(12) })
  }

  /** 模式菜单：原生 Menu + MenuItem（与右上角「⋯」完全同款容器/描边/收起） */
  @Builder
  modeMenu() {
    Menu() {
      ForEach(this.modeOptions(), (item: PresetOption) => {
        MenuItem(this.modeMenuRow(item, item.id === this.selectedModeId()))
          .enabled(!item.broken)
          .onClick(() => {
            if (item.broken) {
              return;
            }
            this.selectMode(item.id, item.label.length > 0 ? item.label : item.id);
          })
      }, (item: PresetOption) => item.id)
    }
  }

  /** 当前选择的模式 id（偏好 > AppStorage 默认） */
  private selectedModeId(): string {
    const stored: string = PreferencesStore.get().getString('defaultAgentPreset', '');
    if (stored.length > 0) {
      return stored;
    }
    return this.defaultAgentPreset.length > 0 ? this.defaultAgentPreset : 'standard';
  }

  private syncModeChipLabel(): void {
    const id: string = this.selectedModeId();
    let label: string = '';
    for (const one of this.modeOptions()) {
      if (one.id === id) {
        label = one.label.length > 0 ? one.label : one.id;
        break;
      }
    }
    this.modeChipLabel = label.length > 0 ? label : this.presetModeName(id);
  }

  private selectMode(id: string, label: string): void {
    PreferencesStore.get().putString('defaultAgentPreset', id);
    AppStorage.setOrCreate<string>('defaultAgentPreset', id);
    const sessionId: string = SessionStore.get().currentSessionId();
    const sent: boolean = GatewayClient.get().selectAgentPreset(sessionId, id);
    this.modeChipLabel = label;
    this.modeChipOpen = false;
    Logger.info('[MODE] select id=' + id + ' session=' + sessionId.slice(-8) + ' sent=' + (sent ? '1' : '0'));
    this.showToast('已切换为「' + label + '」' + (sent ? '' : '（未连接网关，仅记录偏好）'), false);
  }

  @Builder
  dockStack() {
    Column() {
      this.approvalDockCard()
      this.questionDockCard()
      this.localQueueRowsView()
      if (this.visibleQueueCount() > 0) {
        this.queueDock()
      }
      if (this.tasks.length > 0) {
        this.tasksPanel()
      }
      if (this.goal.id.length > 0) {
        this.goalPanel()
      }
    }
    .width('100%')
  }

  /**
   * 把排队消息的本地图片复制到应用沙箱，并写进偏好。
   * 原因：主机拒绝读取「还没进入会话」的队列附件（Image is not referenced by this session），
   * 唯一能显示缩略图的来源就是发送时的本地文件；进程重启后 picker 的临时 uri 可能失效，
   * 所以复制到 files/queue-images 持久化。
   */
  private persistQueueImages(text: string, uris: string[]): void {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const dirPath: string = context.filesDir + '/queue-images';
      if (!fileIo.accessSync(dirPath)) {
        fileIo.mkdirSync(dirPath, true);
      }
      const stored: string[] = [];
      let index: number = 0;
      for (const uri of uris) {
        index += 1;
        const source: string = uri.startsWith('file://') ? uri.substring(7) : uri;
        const ext: string = uri.toLowerCase().endsWith('.png') ? '.png' : '.jpg';
        const target: string = dirPath + '/q-' + Date.now().toString() + '-' + index.toString() + ext;
        try {
          fileIo.copyFileSync(source, target);
          stored.push('file://' + target);
        } catch (err) {
          stored.push(uri);
        }
      }
      const prefs = PreferencesStore.get();
      const existing: string = prefs.getString('queueImageEntries', '');
      const entries: string[] = existing.length > 0 ? existing.split('\u0003') : [];
      entries.push(text + '\u0001' + stored.join('\u0002'));
      while (entries.length > 8) {
        entries.shift();
      }
      prefs.putString('queueImageEntries', entries.join('\u0003'));
    } catch (err) {
    }
  }

  /** 启动时恢复持久化的排队图片（进程重启后队列还在的场景） */
  private restoreQueueImages(): void {
    try {
      const stored: string = PreferencesStore.get().getString('queueImageEntries', '');
      if (stored.length === 0) {
        return;
      }
      for (const entry of stored.split('\u0003')) {
        if (entry.length === 0) {
          continue;
        }
        const parts: string[] = entry.split('\u0001');
        if (parts.length >= 2 && parts[1].length > 0) {
          this.queuedImagesByText.set(parts[0], parts[1].split('\u0002'));
        }
      }
      // 只恢复「图片映射」，不恢复本地排队行：进程重启后队列行可能早已不存在，
      // 恢复出来会变成一条没有在进行的假排队消息（本行只为刚发送的图片补缩略图）。
    } catch (err) {
    }
  }

  /** 队列里已经出现这条消息时，移除本地占位行 */
  private dropLocalQueueRow(text: string): void {
    const keep: string[] = [];
    for (const row of this.localQueueRows) {
      const parts: string[] = row.split('\u0001');
      if (parts[0] !== text) {
        keep.push(row);
      }
    }
    if (keep.length !== this.localQueueRows.length) {
      this.localQueueRows = keep;
    }
  }

  /** 本地行始终显示（它带真实缩略图）；主机队列里同一条改由它顶替 */
  private localRowVisible(row: string): boolean {
    return true;
  }

  /** 需要渲染的主机队列项：已被本地带图行顶替、或已点「立即发送」正在发出的都不再渲染 */
  private visibleQueueItems(): QueueItem[] {
    const out: QueueItem[] = [];
    for (const item of this.queue) {
      if (this.hiddenQueueIds.indexOf(item.id) >= 0) {
        continue;
      }
      if (!this.hostItemCovered(item)) {
        out.push(item);
      }
    }
    return out;
  }

  /** 主机队列项是否已被本地带图行顶替（顶替时不再渲染主机那条，避免出现占位图标） */
  private hostItemCovered(item: QueueItem): boolean {
    const preview: string = item.preview;
    for (const row of this.localQueueRows) {
      const text: string = this.localRowText(row);
      if (text.length === 0) {
        continue;
      }
      const probe: string = text.substring(0, 12);
      if (preview.indexOf(probe) >= 0 || probe.indexOf(preview.substring(0, 12)) >= 0) {
        return true;
      }
    }
    return false;
  }

  /** 本地排队行：文字 + 图片 uri */
  private localRowText(row: string): string {
    const parts: string[] = row.split('\u0001');
    return parts.length > 0 ? parts[0] : '';
  }

  private localRowImages(row: string): string[] {
    const parts: string[] = row.split('\u0001');
    if (parts.length < 2 || parts[1].length === 0) {
      return [];
    }
    const out: string[] = [];
    for (const uri of parts[1].split('\u0002')) {
      if (uri.length > 0) {
        out.push(uri);
      }
    }
    return out;
  }

  /** 某条排队消息的本地图片预览（按文本匹配；队列里的 preview 可能是截断文本） */
  private queuedImagesOf(item: QueueItem): string[] {
    if (this.queuedImagesByText.size === 0) {
      return [];
    }
    // 队列里的 preview 可能被截断（末尾带「…」）或去掉换行，先归一化再比
    const normalize = (value: string): string => {
      let out: string = value.replace(/\n/g, ' ').trim();
      while (out.endsWith('…') || out.endsWith('...')) {
        out = out.substring(0, out.length - 1).trim();
      }
      return out;
    };
    const preview: string = normalize(item.preview);
    let matched: string[] = [];
    this.queuedImagesByText.forEach((uris: string[], key: string) => {
      const normalizedKey: string = normalize(key);
      if (normalizedKey.length === 0) {
        return;
      }
      if (preview.length === 0
        || preview.indexOf(normalizedKey.substring(0, 12)) >= 0
        || normalizedKey.indexOf(preview.substring(0, 12)) >= 0) {
        matched = uris;
      }
    });
    // 兜底：只有一条带图的本地记录、这条队列表明确有附件 → 就认为是它
    if (matched.length === 0 && item.attachmentCount > 0 && this.queuedImagesByText.size === 1) {
      this.queuedImagesByText.forEach((uris: string[]) => {
        matched = uris;
      });
    }
    if (matched.length === 0 && item.attachmentCount > 0) {
      let keys: string = '';
      this.queuedImagesByText.forEach((uris: string[], key: string) => {
        keys += '[' + key.substring(0, 20) + ']';
      });
      Logger.info('[QUEUEIMG] unmatched preview="' + item.preview.substring(0, 30)
        + '" attachments=' + item.attachmentCount.toString() + ' cached=' + this.queuedImagesByText.size.toString()
        + ' keys=' + keys);
    }
    return matched;
  }

  /** 排队消息图标（小程序同款 queue-message.svg，38rpx，0.72 透明度）。 */
  @Builder
  queueBubbleIcon(size: number) {
    Image(this.isDark ? $r('app.media.queue_message_dark') : $r('app.media.queue_message'))
      .width(size)
      .height(size)
      .objectFit(ImageFit.Contain)
      .opacity(0.72)
  }

  /** 任务状态图标（小程序同款：完成 check-green / 进行中 pinwheel / 待处理 dotted-gray）。 */
  @Builder
  taskStatusGlyph(status: string) {
    Stack({ alignContent: Alignment.Center }) {
      if (status === 'completed') {
        Image($r('app.media.check_green'))
          .width(this.rpx(32))
          .height(this.rpx(32))
          .objectFit(ImageFit.Contain)
      } else if (status === 'in_progress') {
        Image(this.isDark ? $r('app.media.pinwheel_white') : $r('app.media.pinwheel_ink'))
          .width(this.rpx(32))
          .height(this.rpx(32))
          .objectFit(ImageFit.Contain)
      } else {
        Image($r('app.media.dotted_gray'))
          .width(this.rpx(32))
          .height(this.rpx(32))
          .objectFit(ImageFit.Contain)
      }
    }
    .width(this.rpx(32))
    .height(this.rpx(32))
    .margin({ top: this.rpx(3) })
    .flexShrink(0)
  }

  /** 队列项里的图片：按 attachmentId 向网关拉取并缓存本地路径 */
  private resolveQueueImages(): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || this.queue.length === 0) {
      return;
    }
    for (const item of this.queue) {
      const refs = item.images === undefined ? [] : item.images;
      for (const ref of refs) {
        if (ref.attachmentId.length === 0 || this.queueThumbInflight.has(ref.attachmentId)
          || this.queueThumbFailed.has(ref.attachmentId)) {
          continue;
        }
        let known: boolean = false;
        for (const entry of this.queueThumbPaths) {
          if (entry.indexOf(ref.attachmentId + '\u0001') === 0) {
            known = true;
            break;
          }
        }
        if (known) {
          continue;
        }
        this.queueThumbInflight.add(ref.attachmentId);
        AttachmentImageCache.fetch(sessionId, ref.attachmentId, ref.mediaType, ref.name)
          .then((path: string) => {
            this.queueThumbInflight.delete(ref.attachmentId);
            if (path.length > 0) {
              this.queueThumbPaths = this.queueThumbPaths.concat([ref.attachmentId + '\u0001' + path]);
            }
          })
          .catch((err: Error) => {
            this.queueThumbInflight.delete(ref.attachmentId);
            this.queueThumbFailed.add(ref.attachmentId);
            Logger.warn('[QUEUEIMG] fetch failed id=' + ref.attachmentId.substring(0, 20) + ' ' + err.message);
          });
      }
    }
  }

  /** 队列项图片的本地路径列表（按 attachmentId 顺序） */
  private queueThumbPathsOf(item: QueueItem): string[] {
    const out: string[] = [];
    const refs = item.images === undefined ? [] : item.images;
    for (const ref of refs) {
      for (const entry of this.queueThumbPaths) {
        const parts: string[] = entry.split('\u0001');
        if (parts.length >= 2 && parts[0] === ref.attachmentId) {
          out.push(parts[1]);
        }
      }
    }
    return out;
  }

  /** 本地排队消息（带图）占位行：主机队列帧可能不含图片，先用本地记录把样式显示出来 */
  @Builder
  localQueueRowsView() {
    // 只有会话在运行（或主机队列里确实有消息）时才显示本地排队行；
    // 空闲发送是直接进对话的，不能留下一条「排队消息」。
    if (this.localQueueRows.length > 0 && (this.runActive() || this.queue.length > 0)) {
      Column({ space: this.rpx(6) }) {
        ForEach(this.localQueueRows, (row: string) => {
          if (this.localRowVisible(row)) {
          Row({ space: this.rpx(8) }) {
            this.queueBubbleIcon(this.rpx(38))
            ForEach(this.localRowImages(row), (uri: string) => {
              Image(uri)
                .width(this.rpx(56))
                .height(this.rpx(56))
                .borderRadius(this.rpx(8))
                .objectFit(ImageFit.Cover)
                .flexShrink(0)
                .onClick(() => {
                  this.previewImagePath = uri;
                  this.previewImageOpen = true;
                })
            }, (uri: string) => uri)
            Text(this.localRowText(row))
              .fontSize(13)
              .lineHeight(this.rpx(36))
              .fontColor(this.subColor())
              .layoutWeight(1)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .width('100%')
          .padding({ left: this.rpx(20), right: this.rpx(20), top: this.rpx(6), bottom: this.rpx(6) })
          .alignItems(VerticalAlign.Center)
          }
        }, (row: string) => row)
      }
      .width('100%')
      .padding({ top: this.rpx(8), bottom: this.rpx(4) })
      // 与输入条胶囊同一套玻璃：同底色 + 同细亮边 + 同圆角
      .borderRadius(this.dockGlassRadius())
      .backgroundColor(this.dockGlassFill())
      .border({ width: 1, color: this.dockGlassEdge() })
      .margin({ bottom: this.rpx(12) })
    }
  }

  /**
   * 单条排队消息：HDS 沉浸光感玻璃（矮条，材质天然是胶囊，圆角=半高，观感正合适）。
   * 多条 / 展开态：HDS 悬浮 Bar 的形状固定是胶囊（半径=高度一半），高面板会变成大椭圆，
   * 且系统材质层不受应用层 clip 裁剪、SDK 也没有圆角参数 —— 所以退回原自绘 26vp 圆角。
   */
  @Builder
  queueDock() {
    // 折叠态（单条，或有多条但未展开，都只是一行矮条）→ HDS 胶囊玻璃；
    // 展开成高面板才退回自绘，避免被拉成大椭圆。
    if (this.visibleQueueCount() === 1 || !this.queueExpanded) {
      Column() {
        HdsGlassSurface() {
          this.queueDockBody(false)
        }
      }
      .width('100%')
      .margin({ bottom: this.rpx(12) })
    } else {
      this.queueDockBody(true)
    }
  }

  @Builder
  queueDockBody(glass: boolean) {
    Column() {
      if (this.visibleQueueCount() > 1) {
        Row({ space: this.rpx(20) }) {
          this.queueBubbleIcon(this.rpx(38))
          Text('排队消息 · ' + this.visibleQueueCount().toString())
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Image($r('app.media.chev_right_gray'))
            .width(this.rpx(22))
            .height(this.rpx(22))
            .objectFit(ImageFit.Contain)
            .rotate({ angle: this.queueExpanded ? 90 : -90 })
            .opacity(0.72)
        }
        .width('100%')
        .height(this.rpx(72))
        .padding({ left: this.rpx(24), right: this.rpx(24) })
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
          this.queueExpanded = !this.queueExpanded;
        })
      }
      if (this.queueExpanded || this.visibleQueueCount() === 1) {
        Scroll() {
          Column() {
            ForEach(this.visibleQueueItems(), (item: QueueItem, index: number) => {
              Column() {
                Row({ space: this.rpx(8) }) {
                  this.queueBubbleIcon(this.rpx(38))
                  // 图片：优先用主机队列项里的 attachmentId 拉到的真实缩略图；
                  // 其次用发送时记录的本地图；都没有才显示占位图标。
                  if (this.queueThumbPathsOf(item).length > 0) {
                    ForEach(this.queueThumbPathsOf(item), (path: string) => {
                      Image(path)
                        .width(this.rpx(56))
                        .height(this.rpx(56))
                        .borderRadius(this.rpx(8))
                        .objectFit(ImageFit.Cover)
                        .flexShrink(0)
                        .onClick(() => {
                          this.previewImagePath = path;
                          this.previewImageOpen = true;
                        })
                    }, (path: string) => path)
                  } else if (this.queuedImagesRevision >= 0 && this.queuedImagesOf(item).length > 0) {
                    ForEach(this.queuedImagesOf(item), (uri: string) => {
                      Image(uri)
                        .width(this.rpx(56))
                        .height(this.rpx(56))
                        .borderRadius(this.rpx(8))
                        .objectFit(ImageFit.Cover)
                        .flexShrink(0)
                        .onClick(() => {
                          this.previewImagePath = uri;
                          this.previewImageOpen = true;
                        })
                    }, (uri: string) => uri)
                  }
                  // 没有本地缩略图但有附件：先摆一个图片占位块（看起来是图片样式，而不是「N 个附件」文字）
                  if (item.attachmentCount > 0 && this.queuedImagesOf(item).length === 0) {
                    Stack({ alignContent: Alignment.Center }) {
                      Image($r('app.media.deliverable_image'))
                        .width(this.rpx(32))
                        .height(this.rpx(32))
                        .objectFit(ImageFit.Contain)
                    }
                    .width(this.rpx(56))
                    .height(this.rpx(56))
                    .borderRadius(this.rpx(8))
                    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
                    .flexShrink(0)
                  }
                  Column({ space: this.rpx(4) }) {
                    if (item.preview.length > 0 || item.attachmentCount === 0) {
                      Text(item.preview.length > 0 ? item.preview : '（空消息）')
                        .fontSize(13)
                      .lineHeight(this.rpx(36))
                      .fontColor(this.subColor())
                        .width('100%')
                        .maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                    }

                  }
                  .layoutWeight(1)
                  .alignItems(HorizontalAlign.Start)
                  Row({ space: this.rpx(4) }) {
                    Stack({ alignContent: Alignment.Center }) {
                      if (this.queueBusyId === item.id + ':edit') {
                        LoadingProgress()
                          .width(this.rpx(26))
                          .height(this.rpx(26))
                          .color(this.subColor())
                      } else {
                        Image(this.isDark ? $r('app.media.queue_edit_dark') : $r('app.media.queue_edit'))
                          .width(this.rpx(34))
                          .height(this.rpx(34))
                          .objectFit(ImageFit.Contain)
                          .opacity(0.72)
                      }
                    }
                    .width(this.rpx(72))
                    .height(this.rpx(80))
                    .id('queue-action-edit')
                    .accessibilityText('编辑排队消息')
                    .onClick(() => {
                      this.queueAction(item, 'edit');
                    })
                    Stack({ alignContent: Alignment.Center }) {
                      if (this.queueBusyId === item.id + ':remove') {
                        LoadingProgress()
                          .width(this.rpx(26))
                          .height(this.rpx(26))
                          .color(this.subColor())
                      } else {
                        Image(this.isDark ? $r('app.media.queue_delete_dark') : $r('app.media.queue_delete'))
                          .width(this.rpx(34))
                          .height(this.rpx(34))
                          .objectFit(ImageFit.Contain)
                          .opacity(0.72)
                      }
                    }
                    .width(this.rpx(72))
                    .height(this.rpx(80))
                    .id('queue-action-remove')
                    .accessibilityText('删除排队消息')
                    .onClick(() => {
                      this.queueAction(item, 'remove');
                    })
                    // 立即发送常驻：回合中走 steer 插话；回合已结束则移出队列后立刻作为新消息发出。
                    Stack({ alignContent: Alignment.Center }) {
                        if (this.queueBusyId === item.id + ':steer') {
                          LoadingProgress()
                            .width(this.rpx(26))
                            .height(this.rpx(26))
                            .color('#2E6BE6')
                        } else {
                          Image(this.isDark ? $r('app.media.queue_send_dark') : $r('app.media.queue_send'))
                            .width(this.rpx(34))
                            .height(this.rpx(34))
                            .objectFit(ImageFit.Contain)
                            .opacity(0.72)
                        }
                      }
                      .width(this.rpx(72))
                      .height(this.rpx(80))
                      .id('queue-action-steer')
                      .accessibilityText('立即发送排队消息')
                      .onClick(() => {
                        this.queueAction(item, 'steer');
                      })
                  }
                  .alignItems(VerticalAlign.Center)
                }
                .width('100%')
                .constraintSize({ minHeight: this.rpx(80) })
                .padding({ left: this.rpx(24), right: this.rpx(8) })
                .alignItems(VerticalAlign.Center)
                .opacity(this.queueBusyId.indexOf(item.id + ':') === 0 ? 0.5 : 1)
                if (index < this.visibleQueueCount() - 1) {
                  Row()
                    .width('100%')
                    .height(1)
                    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)')
                    .margin({ left: this.rpx(20), right: this.rpx(20) })
                }
              }
              .width('100%')
            }, (item: QueueItem) => item.id)
          }
          .width('100%')
        }
        .width('100%')
        .constraintSize({ maxHeight: this.rpx(360) })
        .scrollBar(BarState.Off)
      }
    }
    .width('100%')
    .padding({ top: this.rpx(4), bottom: this.rpx(4) })
    // glass=true 走「展开态玻璃」：与输入框展开态同一套模糊/底色/亮边/圆角；
    // false 时完全透明，玻璃由外层 HdsGlassSurface 出
    .borderRadius(glass ? this.expandedGlassRadius() : 26)
    .backdropBlur(glass ? this.expandedGlassBlur() : 0)
    .backgroundColor(glass ? this.expandedGlassFill() : '#00000000')
    .border({ width: glass ? 1 : 0, color: this.dockGlassEdge() })
    .margin({ bottom: glass ? this.rpx(12) : 0 })
    .clip(true)
  }

  @Builder
  tasksPanel() {
    // 折叠态（未展开，只是一行矮条，单/多任务都一样）→ HDS 胶囊玻璃；展开成长面板才退回自绘。
    if (!this.tasksExpanded) {
      // 单个任务（矮条）：HDS 胶囊玻璃
      Column() {
        HdsGlassSurface() {
          this.tasksPanelBody(false)
        }
      }
      .width('100%')
      .margin({ bottom: this.rpx(12) })
    } else {
      // 多个任务 / 展开成长面板：原自绘 26vp 圆角（HDS 会变成大椭圆）
      this.tasksPanelBody(true)
    }
  }

  @Builder
  tasksPanelBody(glass: boolean) {
    Column() {
      Row({ space: this.rpx(16) }) {
        Image($r('app.media.tasks_list'))
          .width(this.rpx(36))
          .height(this.rpx(36))
          .objectFit(ImageFit.Contain)
          .flexShrink(0)
        Text('任务')
          .fontSize(15.5)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .flexShrink(0)
        Text(this.taskSummary())
          .fontSize(13.5)
          .fontColor(this.subColor())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Image($r('app.media.chev_right_gray'))
          .width(this.rpx(20))
          .height(this.rpx(20))
          .objectFit(ImageFit.Contain)
          .rotate({ angle: this.tasksExpanded ? 90 : -90 })
          .opacity(0.7)
      }
      .width('100%')
      .constraintSize({ minHeight: this.rpx(88) })
      .padding({ left: this.rpx(28), right: this.rpx(28) })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.tasksExpanded = !this.tasksExpanded;
      })
      if (this.tasksExpanded) {
        Column() {
          ForEach(this.tasks, (task: GatewayTask) => {
            Row({ space: this.rpx(18) }) {
              this.taskStatusGlyph(task.status)
              Text(task.content)
                .fontSize(15.5)
                .lineHeight(this.rpx(42))
                .fontColor(task.status === 'completed' ? this.subColor() : this.textColor())
                .layoutWeight(1)
            }
            .width('100%')
            .padding({ top: this.rpx(10), bottom: this.rpx(10) })
            .alignItems(VerticalAlign.Top)
          }, (task: GatewayTask) => task.content + '#' + task.status)
        }
        .width('100%')
        .padding({ left: this.rpx(28), right: this.rpx(28), bottom: this.rpx(24) })
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    // glass=true 走原自绘玻璃；false 时透明，玻璃由外层 HdsGlassSurface 出
    .borderRadius(glass ? this.dockGlassRadius() : 26)
    .backgroundColor(glass ? this.dockGlassFill() : '#00000000')
    .border({ width: glass ? 1 : 0, color: this.dockGlassEdge() })
    .margin({ bottom: glass ? this.rpx(12) : 0 })
    .clip(true)
  }

  @Builder
  goalPanel() {
    // 目标卡片永远只做展示（单行矮条，HDS 胶囊玻璃）；
    // 编辑走主输入框（点铅笔把目标文本填进去），卡片不再内嵌 TextArea。
    Column() {
      HdsGlassSurface() {
        this.goalPanelBody(false)
      }
    }
    .width('100%')
    .margin({ bottom: this.rpx(12) })
  }

  @Builder
  goalPanelBody(glass: boolean) {
      Row({ space: this.rpx(16) }) {
        Image(this.isDark ? $r('app.media.goal_target_dark') : $r('app.media.goal_target'))
          .width(this.rpx(34))
          .height(this.rpx(34))
          .objectFit(ImageFit.Contain)
          .flexShrink(0)
        Text(this.goal.phaseLabel)
          .fontSize(15.5)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .flexShrink(0)
        // 编辑中：正文已经搬进输入框，这里只提示状态
        Text(this.goalEditing ? '正在编辑…' : this.goal.objective)
          .fontSize(15)
          .fontColor(this.goalEditing ? this.subColor() : this.textColor())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        // 编辑中：右侧换成 ✅ 保存 / ❌ 取消，省得用户一个个删
        if (this.goalEditing) {
          Row({ space: this.rpx(8) }) {
            // 保存：标准实心圆 + 白色系统对勾（主操作）
            Stack({ alignContent: Alignment.Center }) {
              Circle({ width: 30, height: 30 })
                .fill('#2E6BE6')
              SymbolGlyph($r('sys.symbol.checkmark'))
                .fontSize(16)
                .fontColor(['#FFFFFF'])
            }
            .width(this.rpx(64))
            .height(this.rpx(64))
            .onClick(() => {
              this.finishGoalEdit(true);
            })
            // 取消：中性圆底 + 系统叉号（次要操作）
            Stack({ alignContent: Alignment.Center }) {
              Circle({ width: 30, height: 30 })
                .fill(this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.08)')
              SymbolGlyph($r('sys.symbol.xmark'))
                .fontSize(15)
                .fontColor([this.subColor()])
            }
            .width(this.rpx(64))
            .height(this.rpx(64))
            .onClick(() => {
              this.finishGoalEdit(false);
            })
          }
          .alignItems(VerticalAlign.Center)
        } else if (this.goalBusy) {
          LoadingProgress()
            .width(this.rpx(30))
            .height(this.rpx(30))
            .color('#2E6BE6')
        } else {
          Row() {
            Stack({ alignContent: Alignment.Center }) {
              Image(this.goal.active
                ? (this.isDark ? $r('app.media.goal_pause_dark') : $r('app.media.goal_pause'))
                : (this.isDark ? $r('app.media.goal_play_dark') : $r('app.media.goal_play')))
                .width(this.rpx(34))
                .height(this.rpx(34))
                .objectFit(ImageFit.Contain)
            }
            .width(this.rpx(64))
            .height(this.rpx(64))
            .onClick(() => {
              this.mutateGoal(this.goal.active ? 'goal-pause' : 'goal-resume');
            })
            Stack({ alignContent: Alignment.Center }) {
              Image(this.isDark ? $r('app.media.queue_edit_dark') : $r('app.media.queue_edit'))
                .width(this.rpx(34))
                .height(this.rpx(34))
                .objectFit(ImageFit.Contain)
            }
            .width(this.rpx(64))
            .height(this.rpx(64))
            .onClick(() => {
              this.beginGoalEdit();
            })
            Stack({ alignContent: Alignment.Center }) {
              Image(this.isDark ? $r('app.media.queue_delete_dark') : $r('app.media.queue_delete'))
                .width(this.rpx(34))
                .height(this.rpx(34))
                .objectFit(ImageFit.Contain)
            }
            .width(this.rpx(64))
            .height(this.rpx(64))
            .onClick(() => {
              this.clearGoal();
            })
          }
          .alignItems(VerticalAlign.Center)
        }
      }
      .width('100%')
      .constraintSize({ minHeight: this.rpx(92) })
      .padding({ left: this.rpx(28), right: this.rpx(24) })
      .alignItems(VerticalAlign.Center)
      // glass=true 走「展开态玻璃」：与输入框展开态同一套模糊/底色/亮边/圆角；
      // false 时透明，玻璃由外层 HdsGlassSurface 出
      .borderRadius(glass ? this.expandedGlassRadius() : 26)
      .backdropBlur(glass ? this.expandedGlassBlur() : 0)
      .backgroundColor(glass ? this.expandedGlassFill() : '#00000000')
      .border({ width: glass ? 1 : 0, color: this.dockGlassEdge() })
      .margin({ bottom: glass ? this.rpx(12) : 0 })
  }

  /** 底部浮层：队列/任务/目标 + 输入条（下方内容透过玻璃模糊，与顶部遮罩对称） */
  /** 底部玻璃条上沿的渐变过渡（透明 → 页面底色），避免内容与玻璃之间出现硬切边 */
  @Builder
  bottomFadeOverlay() {
    Column()
      .width('100%')
      // 渐变过渡带加高到 44vp、多档色阶：内容进入玻璃前逐级淡出，模拟顶部「越往上越糊」的渐进效果
      .height(44)
      .linearGradient({
        direction: GradientDirection.Bottom,
        colors: this.isDark
          ? [['rgba(0,0,0,0)', 0.0], ['rgba(0,0,0,0.18)', 0.45], ['rgba(0,0,0,0.45)', 0.75], ['rgba(0,0,0,0.72)', 1.0]]
          : [['rgba(242,242,247,0)', 0.0], ['rgba(242,242,247,0.28)', 0.45], ['rgba(242,242,247,0.62)', 0.75], ['rgba(242,242,247,0.86)', 1.0]]
      })
      .hitTestBehavior(HitTestMode.None)
  }

  /**
   * 沉浸光感玻璃胶囊（只作背板）：
   * 系统材质只在「底部 TabBar」合法作用域内渲染，所以这里用 HdsTabs 悬浮 TabBar 提供材质；
   * 但 TabBar 是固定高度的浏览器 chrome，把输入区放进去会被裁（展开态多行会互相叠字），
   * 因此 TabBar 里只放一个 1×1 的透明页签，真实输入区叠在它上面单独渲染（见 build 里的两层）。
   * 胶囊高度 = 输入区实测高度，两者像素对齐。
   */
  @Builder
  dockAsFloatingGlass() {
    HdsTabs({ barPosition: BarPosition.End, index: 0 }) {
      TabContent() {
        // 内容区不用：只借 TabBar 的位置与材质
        Column().width(1).height(1).opacity(0).hitTestBehavior(HitTestMode.None)
      }
      .tabBar(this.emptyTabItem())
    }
    .barMode(BarMode.Fixed)
    .scrollable(false)
    // 小艺同款三条件：横向 + 底部 + 浮在内容之上（缺一材质不生效）
    .vertical(false)
    .barOverlap(true)
    // 材质走 HDS 管线：systemMaterialEffect = IMMERSIVE + ADAPTIVE
    .barFloatingStyle(this.dockFloatingStyle())
    // 胶囊高度用状态驱动、参与补间：和输入卡在同一个 animateTo 里变，
    // 收缩是一整条变形，不会「先出现展开高度的椭圆、再跳到胶囊」
    .barHeight(this.dockBarHeight)
    .width('100%')
    .height('100%')
    // 背板只负责渲染材质：不能抢触摸，也不能抢焦点 —— 否则点输入框时焦点被 Tabs 拿走，
    // TextArea 立刻 onBlur，输入条刚展开又塌回去
    .hitTestBehavior(HitTestMode.None)
    .focusable(false)
    .enabled(false)
  }



  /** 空的页签内容：胶囊只当背板用 */
  @Builder
  emptyTabItem() {
    Column().width(1).height(1).opacity(0).hitTestBehavior(HitTestMode.None)
  }

  /**
   * 独立小号沉浸光感背板（置底按钮用）。
   * 普通组件的 systemMaterial 在内容区不生效（“out of scope”），只能借 HdsTabs 底部悬浮 Bar 出材质，
   * 与输入条胶囊同一套 systemMaterialEffect；按钮本体做透明可点层叠在上面。
   */
  @Builder
  hdsGlassBackplate(w: number, h: number) {
    HdsTabs({ barPosition: BarPosition.End, index: 0 }) {
      TabContent() {
        Column().width(1).height(1).opacity(0).hitTestBehavior(HitTestMode.None)
      }
      .tabBar(this.emptyTabItem())
    }
    .barMode(BarMode.Fixed)
    .scrollable(false)
    // 小艺同款三条件：横向 + 底部 + 浮在内容之上（缺一材质不生效）
    .vertical(false)
    .barOverlap(true)
    .barFloatingStyle({
      adaptToHandedness: false,
      barSideMargin: 0,
      barBottomMargin: 0,
      barWidth: { smallWidth: w, mediumWidth: w, largeWidth: w },
      systemMaterialEffect: this.dockGlassMaterial()
    })
    .barHeight(h)
    .width(w)
    .height(h)
    // TabBar 默认带一层不透明底色：在圆里就是背后那块「带四个直角的深色矩形」，先清掉
    .barBackgroundColor('#00000000')
    // 再按高度把整块（含材质）裁成圆形
    .borderRadius(h / 2)
    .clip(true)
    // 只当背板：不抢触摸、不抢焦点
    .hitTestBehavior(HitTestMode.None)
    .focusable(false)
    .enabled(false)
  }

  /** 输入区是否处于展开态（与 ConversationComposer.expanded() 同一套判定） */
  private composerExpanded(): boolean {
    // 与 ConversationComposer.expanded() 保持一致：草稿/附件算展开（收键盘不塌回单栏）
    return this.composerFocused || this.draft.trim().length > 0 || this.pickedAttachments.length > 0
      // 输入条按钮的弹层（模型/推理等级/权限）开着时同样视为展开：气泡位置不塌
      || this.permissionMenuOpen || this.modelMenuOpen;
  }

  /** 系统键盘高度监听（收起键盘时折叠输入条，不等 onBlur） */
  private keyboardHeightCallback: ((height: number) => void) | null = null;
  /** 键盘高度归 0 后的确认定时器（过滤过渡期的瞬时 0） */
  private keyboardCollapseTimer: number = -1;
  /** 最近一次手指落在输入条内部的时间：这类触摸不该触发任何折叠 */
  private lastInsideComposerTouchAt: number = 0;
  private hostWindowRef: arkWindow.Window | null = null;

  /**
   * 监听系统键盘高度：键盘完全收起的同一刻就折叠输入条。
   * 之前只靠 TextArea 的 onBlur —— 键盘先落完、输入条再塌一次，必然两段；
   * 这里和「点输入框以外」走同一条 collapseComposer，时序一致。
   */
  private bindKeyboardHeightListener(): void {
    if (this.keyboardHeightCallback !== null) {
      return;
    }
    const ctx = this.getUIContext().getHostContext();
    if (ctx === undefined) {
      return;
    }
    // 只有「之前在显示、现在变 0」才算键盘收起：
    // 键盘弹出的过渡里会先上报一次 0（此时 lastHeight 本来就是 0），
    // 以前把这种 0 当成收起 → 点输入框刚展开就被塌回去
    let lastHeight: number = 0;
    const cb = (height: number): void => {
      const wasShown: boolean = lastHeight > 0;
      lastHeight = height;
      if (height > 0) {
        if (this.keyboardCollapseTimer >= 0) {
          clearTimeout(this.keyboardCollapseTimer);
          this.keyboardCollapseTimer = -1;
        }
        return;
      }
      if (!wasShown) {
        return;
      }
      // 真收起：再等 60ms 确认没有被新的弹出抢先，然后走和点空白同一条折叠路径
      if (this.keyboardCollapseTimer >= 0) {
        return;
      }
      this.keyboardCollapseTimer = setTimeout(() => {
        this.keyboardCollapseTimer = -1;
        if (lastHeight <= 0) {
          this.collapseComposer();
        }
      }, 60);
    };
    this.keyboardHeightCallback = cb;
    arkWindow.getLastWindow(ctx).then((win: arkWindow.Window) => {
      this.hostWindowRef = win;
      win.on('keyboardHeightChange', cb);
    }).catch(() => {
    });
  }

  private unbindKeyboardHeightListener(): void {
    const cb = this.keyboardHeightCallback;
    const win = this.hostWindowRef;
    this.keyboardHeightCallback = null;
    this.hostWindowRef = null;
    if (win !== null && cb !== null) {
      try {
        win.off('keyboardHeightChange', cb);
      } catch (err) {
      }
    }
  }

  /**
   * 点输入区以外的区域 → 收起输入条。
   * 之前只依赖 TextArea 的 onBlur：点到的区域不可聚焦（消息卡片、空白）时 TextArea 根本不会失焦，
   * 所以输入条一直不收。这里显式清焦点 + 关掉面板，再让 expanded 判定自然回落。
   */
  private collapseComposer(): void {
    // 手指刚落在输入条内部（点空白、点 chip、点文本域）：这次失焦不是「点外面」，不要折叠
    if (Date.now() - this.lastInsideComposerTouchAt < 400) {
      return;
    }
    // 语音态（展开卡片原地按住说话）不折叠：上面的收键盘只是切输入方式，
    if (this.voiceMode) {
      return;
    }
    if (!this.composerFocused && this.composerSheet.length === 0
      && !this.permissionMenuOpen && !this.modelMenuOpen) {
      return;
    }
    this.composerSheet = '';
    this.permissionMenuOpen = false;
    this.modelMenuOpen = false;
    this.metricPopover = '';
    // 有草稿/附件时输入条保持展开：这里只收键盘（清焦点），高度不塌回 52
    const keepExpanded: boolean = this.draft.trim().length > 0 || this.pickedAttachments.length > 0;
    // 收键盘 + 收起输入条同时开始：两者都用 200ms 补间，视觉上是同步的一次过渡
    this.getUIContext().getFocusController().clearFocus();
    this.getUIContext().animateTo({ duration: 250, curve: Curve.EaseOut }, () => {
      this.composerFocused = false;
      if (!keepExpanded) {
        this.dockBarHeight = 52;
      }
    });
  }

  /** 胶囊离屏幕底部的距离：手势条安全区 + 平板额外留白 */
  private dockBarMargin(): number {
    return 18 + this.bottomInset + (this.wideInset() > 0 ? 14 : 0);
  }

  /** 输入区底部留白：与胶囊边距同值（指标行下方的空白） */
  private dockBottomPad(): number {
    return this.dockBarMargin();
  }

  /**
   * 玻璃胶囊只包住输入卡本身（指标行在胶囊外面，像小艺那样是一条细胶囊）：
   *   barHeight       = 输入卡实测高度
   *   barBottomMargin = 输入区总高度 - 输入卡高度（= 指标行 + 底部留白）
   * 两者都由实测值算，不写死尺寸。
   */
  private dockGlassHeight(): number {
    return this.dockCardHeight > 0 ? this.dockCardHeight : 52;
  }

  /** 胶囊底边与屏幕底部的距离 = 底部留白 + 玻璃条下方区域（chip 行 / 指标行）实测高度 */
  private dockBarBottomMargin(): number {
    // 胶囊底边落在指标行上方：底部留白 + 指标行高度 - bar 自带避让
    return this.dockBarMargin() + this.dockMetricsRowHeight - this.dockFloatingBarGap;
  }

  /** 时间线可视区底边 = 输入框底边（距屏幕底部）：文字滑到输入框底部就消失 */
  private timelineClipBottom(): number {
    return this.dockBarBottomMargin();
  }

  /** 输入框圆角半径（折叠 26 / 展开 28，取大值遮挡更保险） */
  private composerCornerRadius(): number {
    return 28;
  }

  /** 左右下角遮挡块宽度（时间线坐标系，页面已扣掉宽屏留白）：输入框左侧 14vp 留白 + 圆角半径 */
  private cornerMaskWidth(): number {
    return 14 + this.composerCornerRadius() + 1;
  }

  /** 遮挡块底边到时间线底边的距离：输入框底边（时间线容器已扣掉底部安全区） */
  private cornerMaskBottomMargin(): number {
    return 18 + (this.wideInset() > 0 ? 14 : 0) + this.dockMetricsRowHeight - this.dockFloatingBarGap;
  }

  /** 列表末尾留白：滚到底时最后一条消息停在输入框上沿，不被输入框盖住 */
  private timelineEndOffset(): number {
    // 末尾让出「输入卡实测高度 + 排队/任务卡片高度」：滚到底时鲸尾行停在卡片上方，不被压住。
    return this.dockGlassHeight() + 4 + this.dockStackH;
  }


  /** HDS IMMERSIVE 材质（与顶栏 systemMaterialEffect 同一套管线） */
  private dockGlassMaterial(): SystemMaterialParams {
    // 档位跟随设置页（玻璃材质：精美/轻柔/流畅/自适应）
    return { materialType: hdsMaterial.MaterialType.IMMERSIVE, materialLevel: currentGlassMaterialLevel() };
  }

  /** 悬浮胶囊样式：官方 HdsTabsFloatingStyle 类型 */
  private dockFloatingStyle(): HdsTabsFloatingStyle {
    const widthOpt: HdsBarWidthRangeOptions = {
      smallWidth: this.pageW > 0 ? this.pageW - 28 : 320,
      mediumWidth: this.pageW > 0 ? this.pageW - 28 : 320,
      largeWidth: this.pageW > 0 ? this.pageW - 28 : 320
    };
    return {
      adaptToHandedness: true,
      barSideMargin: 14,
      barBottomMargin: this.dockBarBottomMargin(),
      barWidth: widthOpt,
      systemMaterialEffect: this.dockGlassMaterial()
    };
  }

  @Builder
  bottomDockLayer() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
          if (this.hint.length > 0) {
            Text(this.hint)
              .fontSize(12)
              // 编辑目标的提示是引导、不是报错：用次要文字色，别吃错误红
              .fontColor(this.goalEditing ? this.subColor() : '#D65D64')
              .width('100%')
              .padding({ left: 20, right: 20, top: 2, bottom: 2 })
          }
          // 新会话：输入框左上方显示模式切换胶囊
          if (this.showModeChip()) {
            Row() {
              this.modeChip()
              Blank()
            }
            .width('100%')
            // 与输入框左缘对齐：输入条外层左右 14vp（+ 宽屏居中留白），再加输入框最外圈 1.3vp 白色光圈。
            // 之前这里用的是 rpx(14)（≈7vp），所以模式胶囊比输入框明显偏左。
            .padding({ left: 14 + this.wideInset() + 1.3, right: 14 + this.wideInset(), bottom: this.rpx(10) })
          }
          // 输入条容器：小程序 dock-stack 左右 14vp 内边距 + 底部安全区
          Column() {
          // 底部 dock：排队消息 / 任务 / 目标（对齐小程序 dock-stack）
          Column() {
            this.dockStack()
          }
          .width('100%')
          .onAreaChange((_o: Area, n: Area) => {
            const hgt: number = Number(n.height);
            if (hgt >= 0 && Math.abs(hgt - this.dockStackH) > 0.5) {
              this.dockStackH = hgt;
            }
          })
          // 指标弹层（会话统计 / Token 用量 / 上下文已用）：紧贴输入框上方，输入框保持可见可点
          // 之前这个 @Builder 只有定义、没有挂到 build 里，点「查看统计」只改了状态、什么都不会显示。
          if (this.metricPopover.length > 0) {
            this.metricPopoverPanel()
          }
          // 权限 / 模型面板：紧贴输入框上方展开，输入框保持可见
          if (this.composerSheet.length > 0) {
            this.composerSheetPanel()
          }
          ConversationComposer({
            isDark: this.isDark,
            draft: this.draft,
            placeholder: this.composerPlaceholder(),
            connected: this.connection === 'connected',
            running: this.running,
            sending: this.sending,
            voiceEnabled: this.voiceInputEnabled,
            voiceMode: this.voiceMode,
            voiceRecording: this.voiceRecording,
            voiceCancelArmed: this.voiceCancelArmed,
            voiceHint: this.voiceStatus,
            onToggleVoiceMode: () => {
              this.toggleVoiceMode();
            },
            onVoiceHoldStart: () => {
              this.onVoiceHoldStart().catch(() => {});
            },
            onVoiceHoldMove: (cancel: boolean) => {
              this.onVoiceHoldMove(cancel);
            },
            onVoiceHoldEnd: (cancel: boolean) => {
              this.onVoiceHoldEnd(cancel);
            },
            permissionTitle: this.permissionTitle(),
            permissionIcon: this.permissionIconGlyph(),
            permissionOpen: this.permissionMenuOpen,
            permissionLabels: this.permissionMenuLabels(),
            permissionValues: this.permissionMenuValues(),
            permissionCurrent: this.defaultPermission,
            modelOpen: this.modelMenuOpen,
            modelMenuItems: this.modelMenuItems(),
            modelProviders: this.modelProviderItems(),
            currentProvider: this.currentModelProvider(),
            modelMenuCurrent: this.currentModelId(),
            teamEnabled: this.teamEnabled,
            onToggleTeam: (next: boolean) => {
              this.toggleTeamEnabled(next);
            },
            effortValues: this.effortMenuValues(),
            effortLabels: this.effortMenuLabels(),
            effortCurrent: this.currentEffort(),
            effort: this.effortName(this.currentEffort()),
            modelTitle: this.currentModelLabel(),
            modelBadge: this.currentModelBadge(),
            effortLabel: this.effortLabel(),
            contextPercent: this.contextPercent(),
            runMetric: this.runMetric(),
            tokenMetric: this.tokenMetric(),
            tokenTotal: this.tokenTotalLabel(),
            contextMetric: this.contextMetric(),
            contextTotal: this.contextTotalLabel(),
            ctxSystemPct: this.contextSegmentPercent('systemTokens'),
            ctxToolsPct: this.contextSegmentPercent('toolsTokens'),
            ctxMsgPct: this.contextSegmentPercent('messageTokens'),
            attachmentCount: this.pickedAttachments.length,
            attachments: this.pickedAttachments,
            onRemoveAttachment: (uri: string) => {
              this.pickedAttachments = this.pickedAttachments.filter((item: PickedAttachment) => item.uri !== uri);
            },
            onInsideTouch: () => {
              this.lastInsideComposerTouchAt = Date.now();
            },
            onCardHeightChange: (height: number) => {
              const quantized: number = Math.round(height / 2) * 2;
              // 记录实测（收起态胶囊底边对齐用）
              if (Math.abs(quantized - this.dockCardHeight) >= 2) {
                this.dockCardHeight = quantized;
              }
              // 展开态（聚焦或有草稿/附件）都跟随（多行输入长高）；收起态目标固定 52，由补间负责
              // 有草稿未聚焦时也要跟随：进页面恢复草稿直接渲染展开卡，胶囊高度必须同步对齐
              if (this.composerExpanded() && Math.abs(quantized - this.lastExpandedCardHeight) >= 2) {
                this.lastExpandedCardHeight = quantized;
                this.dockBarHeight = quantized;
              }
            },
            metricPairsFor: (kind: string): MetricMenuPair[] => {
              const pairs: MetricMenuPair[] = [];
              const rows: MetricPair[] = this.buildMetricPairs(kind);
              for (const p of rows) {
                const pair: MetricMenuPair = { label: p.label, value: p.value };
                pairs.push(pair);
              }
              return pairs;
            },
            focused: this.composerFocused,
            onFocusChange: (focused: boolean) => {
              // 输入条弹层开着时不塌回：点弹窗会连带收起键盘并让输入框失焦，这时必须保住 chip 行
              if (!focused && this.composerSheet.length > 0) {
                return;
              }
              // 展开/收起用补间过渡：卡片高度和胶囊高度一起变，避免瞬间跳变看着卡
              // 250ms 与系统键盘收起动画同时长，两条动画同起同落，不会出现「键盘落完、卡片还在缩」
              // 有草稿/附件时失焦只收键盘，输入条保持展开高度（与 collapseComposer 同一判定）
              const keepExpanded: boolean = this.draft.trim().length > 0 || this.pickedAttachments.length > 0;
              this.getUIContext().animateTo({ duration: 250, curve: Curve.EaseOut }, () => {
                this.composerFocused = focused;
                this.dockBarHeight = (focused || keepExpanded) ? this.lastExpandedCardHeight : 52;
              });
            },
            onDraft: (value: string) => {
              this.draft = value;
              this.scheduleDraftSave();
            },
            onSend: () => {
              this.onSend();
            },
            onStop: () => {
              this.onStop();
            },
            onAddAttachment: () => {
              this.pickAttachments();
            },
            onPickImages: () => {
              this.pickImageAttachments();
            },
            onPickFiles: () => {
              this.pickAttachments();
            },
            onPickCommand: (name: string) => {
              this.draft = '/' + name + ' ';
            },
            refSessions: this.refSessions,
            onPickSessionRef: (id: string, title: string) => {
              this.insertSessionRef(id, title);
            },
            skills: this.skills,
            refDirs: this.refDirs,
            refDirPath: this.refCurrentPath.length > 0 ? this.refCurrentPath : '文件与文件夹',
            onRefDirOpen: (path: string) => {
              this.refCurrentPath = path;
              this.loadFileListAt(path);
            },
            onRequestRefDirs: () => {
              this.loadRefDirectory();
            },
            onPickRefPath: (path: string, isDirectory: boolean) => {
              this.insertPathRef(path, isDirectory);
            },
            refChips: this.refChips,
            onRemoveRefChip: (key: string) => {
              this.removeRefChip(key);
            },
            onPickPermission: () => {
              this.openComposerSheet('permission');
            },
            onPickPermissionOption: (value: string) => {
              this.permissionMenuOpen = false;
              this.selectPermission(value);
            },
            onPermissionMenuVisible: (visible: boolean) => {
              this.permissionMenuOpen = visible;
            },
            onPickModel: () => {
              this.openComposerSheet('model');
            },
            onPickModelOption: (provider: string, model: string) => {
              this.selectModel(provider, model);
            },
            onPickEffortOption: (value: string) => {
              this.selectEffortAndModel(value);
            },
            onModelMenuVisible: (visible: boolean) => {
              this.modelMenuOpen = visible;
              if (visible) {
                // 展开模型菜单时刷新当前模型的推理等级列表（含 Max 等，避免进页时拉取过早）
                this.refreshModelEfforts();
                // 同步 DSH 端团队协作开关状态，避免本地 UI 与主机不一致
                const teamSession: string = SessionStore.get().currentSessionId();
                if (teamSession.length > 0 && GatewayClient.get().isConnected()) {
                  GatewayClient.get().requestAgentTeam(teamSession).catch(() => {
                  });
                }
              }
            },
            onContext: () => {
              this.openMetricPopover('context');
            },
            onStats: () => {
              this.openMetricPopover('run');
            },
            onTokenStats: () => {
              this.openMetricPopover('token');
            }
          })
          }
          .width('100%')
          // 与玻璃胶囊对齐：左右留白 = 胶囊 barSideMargin，底部留白 = barBottomMargin，
          // 这样内容卡片正好落在胶囊内部（胶囊高度 = 内容高度 - 底部留白）
          .padding({
            left: 14 + this.wideInset(),
            right: 14 + this.wideInset(),
            bottom: this.dockBottomPad()
          })
          // 录音时整条输入区让位给全屏语音特效（对齐小程序 .dock-stack.voice-holding { opacity: 0 }）
          .opacity(this.voiceOverlayVisible ? 0 : 1)
      }
      .width('100%')
    }
    .width('100%')
    // 底部整块：透明容器，不铺模糊也不铺渐隐 —— 内容直接滚到输入框玻璃下面，
    // 由输入框自身的材质/半透明底去「盖住」它（这才是玻璃能看见背景变化的前提）
    .backgroundColor(Color.Transparent)
    // 输入区自己要参与命中测试：否则在输入框上的横向拖拽会穿透到底层 Swiper，
    // 表现为「在输入框上滑动，页面在左右翻」
    .hitTestBehavior(HitTestMode.Default)
    // 吞掉落在输入区上的点击：否则这个浮层是透明命中，点击会穿到底下的对话列表，
    // 被列表 onTouch(Down) 当成「点输入框以外」→ 刚点输入框就被折叠
    .onClick(() => {
    })
    .gesture(
      PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 6 })
        .onActionStart(() => {
        })
        .onActionUpdate(() => {
        })
    )
    .onAreaChange((oldArea: Area, newArea: Area) => {
      const height: number = Number(newArea.height);
      if (height > 0 && Math.abs(height - this.dockHeight) > 1) {
        this.dockHeight = height;
      }
    })
  }

  // ==================== 视图 ====================
  /** 切换时让分页点出现，并在停止 900ms 后自动淡出（对齐 iOS 翻页时的「两个小眼睛」） */
  private flashTabDots(): void {
    if (this.tabDotsTimer >= 0) {
      clearTimeout(this.tabDotsTimer);
      this.tabDotsTimer = -1;
    }
    if (this.tabDotsOpacity < 1) {
      this.getUIContext().animateTo({ duration: 120, curve: Curve.EaseOut }, () => {
        this.tabDotsOpacity = 1;
      });
    }
    this.tabDotsTimer = setTimeout(() => {
      this.tabDotsTimer = -1;
      this.getUIContext().animateTo({ duration: 260, curve: Curve.EaseIn }, () => {
        this.tabDotsOpacity = 0;
      });
    }, 900);
  }

  /** 顶部分页指示点：两个小圆点，点按可切换（隐藏时不拦触摸） */
  @Builder
  sessionPageDots() {
    // 左上角的当前页标签（文字 + 玻璃底），切换时淡入、停止后淡出；点它可切到另一页
    Column() {
      Text(this.sessionTab === 0 ? '对话' : '轨迹')
        .fontSize(11)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? 'rgba(241,244,250,0.92)' : 'rgba(16,19,24,0.78)')
        .padding({ left: 10, right: 10, top: 4, bottom: 4 })
        .borderRadius(11)
        .backgroundColor(this.isDark ? 'rgba(44,44,48,0.46)' : 'rgba(255,255,255,0.24)')
        .backdropBlur(14)
        .shadow({
          radius: 14,
          color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)',
          offsetX: 0,
          offsetY: 6
        })
        .onClick(() => {
          // 触感走全局「设置 → 震动反馈」档位（off 时不震）
          Haptics.play();
          const next: number = this.sessionTab === 0 ? 1 : 0;
          this.sessionTab = next;
          this.sessionSwiper.changeIndex(next, true);
          this.flashTabDots();
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: this.topSafe() + 52 })
    // 当前页标签（对话/轨迹）居中显示
    .alignItems(HorizontalAlign.Center)
    .opacity(this.tabDotsOpacity)
    .zIndex(45)
    .hitTestBehavior(this.tabDotsOpacity > 0.05 ? HitTestMode.Transparent : HitTestMode.None)
  }

  build() {
    HdsNavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        // 顶栏不再占位：时间线从屏幕顶部铺满，往上滚时内容直接在标题下面穿过去（对齐 iOS 导航栏）
        // 「加载更早记录」与运行条都在滚动内容内部（对齐小程序：横幅在 scroll-view 里，
        // 运行条在列表末尾），随内容一起滚动，而不是固定在容器外的两条横条。
        Swiper(this.sessionSwiper) {
          Column() {
            this.timeline()
          }
          .width('100%')
          .height('100%')
          // 点对话区域任意位置都算「点输入框以外」→ 收起输入条
          .onClick(() => {
            this.collapseComposer();
          })
          // 宽屏（平板）：正文居中一栏、左右留白（对齐 iOS iPad）
          .padding({ left: this.wideInset(), right: this.wideInset(), bottom: this.bottomInset })

          TrajectoryPanel({ topInset: this.topSafe() + 62 })
        }
        .layoutWeight(1)
        .width('100%')
        .indicator(false)
        .loop(false)
        .duration(220)
        .index(this.sessionTab)
        // 拖动中/切换动画期间显示分页点，停稳后自动隐藏
        .onGestureSwipe((index: number, extraInfo: SwiperAnimationEvent) => {
          this.flashTabDots();
        })
        .onAnimationStart((index: number, targetIndex: number) => {
          this.flashTabDots();
        })
        .onChange((index: number) => {
          if (this.sessionTab !== index) {
            this.sessionTab = index;
            // 滑动切页也震一下，强度取「设置 → 震动反馈」
            Haptics.play();
          }
          this.flashTabDots();
        })
        .onAnimationEnd((index: number) => {
          this.flashTabDots();
        })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
      // 上下都顶到屏幕边缘：内容可以一直滑到状态栏下面（对齐 iOS）
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])



      // 会话页顶部双 Tab 指示点：切换时淡入、停止后淡出（对齐 iOS 翻页小圆点）
      this.sessionPageDots()
      // 底部浮层：底下时间线内容以模糊方式透出（对齐顶部模糊遮罩）
      // 轨迹 Tab 不显示输入条：避免在只读轨迹页误触发送
      // 第一层：系统沉浸光感背板（ArkUI 原生 Tabs 悬浮 TabBar + FloatingTabBarStyle.systemMaterial）
      // 只在收起态显示：展开态用修改前那张卡片（半透明底 + 细亮边），
      // 两个轮廓叠在一起会在卡片圆角处露出胶囊的弧线。
      Column() {
        if (this.sessionTab === 0) {
          this.dockAsFloatingGlass()
        }
      }
      .width('100%')
      .height('100%')
      // 胶囊常驻不隐藏：之前按高度阈值隐藏，收起过程里会出现「底部一截透明、然后胶囊才出现」
      // 的断层。现在胶囊跟着输入卡实测高度连续收缩，是一次连续变形，不会闪也不会留透明带。
      .visibility(Visibility.Visible)
      .hitTestBehavior(HitTestMode.None)

      // 第二层：真实输入区，叠在背板之上
      Column() {
        if (this.sessionTab === 0) {
          this.bottomDockLayer()
        }
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.End)
      .hitTestBehavior(HitTestMode.Transparent)

      // 长按语音的全屏特效：盖在对话与输入条之上，但不拦触摸（手指还压在下面的输入条上）
      VoiceRipplePanel({
        visible: this.voiceOverlayVisible,
        cancelArmed: this.voiceCancelArmed,
        isDark: this.isDark,
        status: this.voiceStatus,
        readLevel: (): number => this.dictation.level()
      })
        .width('100%')
        .height('100%')
        // 组件内部的 hitTestBehavior(None) 只作用到组件根节点，外层这个 %100 的包装节点
        // 仍然会参与命中测试 → 整页被这层透明特效挡住（点、滑都失效）。这里一并关掉。
        .hitTestBehavior(HitTestMode.None)

      // 顶部轻提示：状态栏下方、标题栏下沿淡入的玻璃小卡（不挡触摸）
      Column() {
        this.topToast()
      }
      .width('100%')
      // 轻提示下移到标题栏下方（原来贴得太近，被标题栏压住）
      .padding({ left: 16, right: 16, top: this.topSafe() + 68 })
      .alignItems(HorizontalAlign.Center)
      // 悬浮在最上层：盖住胶囊/侧栏等所有浮层
      .zIndex(200)
      .hitTestBehavior(HitTestMode.None)

      // 图片大图预览：底部系统半模态（与工作区文件同一个 bindSheet 容器）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.previewImageOpen, this.imagePreviewSheet(), {
          height: '78%',
          dragBar: true,
          showClose: false,
          preferType: SheetType.BOTTOM,
          // 原生玻璃底（与文件差异 / 回复详情弹窗同一套材质）；不支持沉浸材质的设备退回纯色
          backgroundColor: this.immersiveSupported()
            ? Color.Transparent
            : (this.isDark ? '#1C1C1E' : '#F7F8FA'),
          systemMaterial: this.teamSheetMaterial(),
          onDisappear: () => {
            this.previewImagePath = '';
            this.previewImageList = [];
            this.previewImageIndex = 0;
            this.previewZoom = 1;
            this.previewZoomBase = 1;
          }
        })

      // 文件差异弹窗：1×1 透明锚点，用系统半模态承载（原生玻璃材质）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.fileDiffOpen, this.fileDiffSheet(), {
          height: '78%',
          dragBar: true,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
          systemMaterial: this.teamSheetMaterial()
        })

      // 长按回复正文的弹窗：可选中文字 / 复制全文（原生玻璃底，与文件差异弹窗一致）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.replySheetOpen, this.replySheet(), {
          height: '76%',
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
          systemMaterial: this.teamSheetMaterial(),
          onDisappear: () => {
            this.replySheetText = '';
          }
        })

      // 正文文件链接预览：1×1 透明锚点，系统半模态承载（原生玻璃材质）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.linkPreviewOpen, this.linkPreviewSheet(), {
          height: '78%',
          dragBar: true,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
          systemMaterial: this.teamSheetMaterial(),
          onDisappear: () => {
            this.linkPreviewLines = [];
            this.linkPreviewBody = '';
          }
        })

      // 会话节点弹层：自绘 overlay（系统菜单会因「按住黑色滑块」判为点空白而收起）
      if (this.turnNavOpen) {
        this.turnNavOverlay()
      }

      // 展开胶囊时：点胶囊以外的任何区域都收起为贴边把手（透明遮罩，Z 序压在胶囊下面）
      if (this.pageW > 0 && this.capsuleAlwaysVisible && this.capsuleExpanded
        && !this.sessionPickerOpen && !this.turnNavOpen && !this.turnNavMenuOpen) {
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor(Color.Transparent)
          .zIndex(59)
          .onClick(() => {
            this.collapseCapsuleByOutsideTap();
          })
      }

      // 会话节点胶囊：常显浮层（左右拖动吸附折叠，点击展开/打开弹层）
      // 侧栏弹窗展开时先收起，避免浮块压在弹窗旁边；设置里可整体关闭常显
      if (this.pageW > 0 && this.capsuleAlwaysVisible && !this.sessionPickerOpen) {
        this.floatingCapsule()
      }

      // 会话侧栏：小程序同款玻璃面板（自绘浮层——系统菜单一点就收，做不到原地展开工作区分组）
      if (this.sessionPickerOpen) {
        Stack({ alignContent: Alignment.TopEnd }) {
          // 遮罩只铺顶栏以下：顶栏按钮（协作 / 侧栏 / ⋯）保持可点，
          // 之前整屏遮罩把顶栏盖住，导致点旁边的按钮没反应、点侧栏按钮也关不掉弹窗
          Column()
            .width('100%')
            .height(this.pageH > 0 ? this.pageH - (this.topSafe() + 56) : 600)
            .margin({ top: this.topSafe() + 56 })
            .backgroundColor(Color.Transparent)
            .onClick(() => {
              this.sessionPickerOpen = false;
            })
          Column() {
            this.sidebarMenuPanel()
          }
          .padding({ top: 56 + this.topSafe(), right: 12 })
        }
        .width('100%')
        .height('100%')
        // 浮层层级压在顶栏(70)之下：遮罩/面板都不会盖住顶栏按钮的点击区域
        .zIndex(30)
      }

      // 重命名会话弹窗
      if (this.renameSessionOpen) {
        this.renameSessionAlert()
      }

      // 工作区文件 sheet 锚点（1×1 透明节点，仅用于承载半模态）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        // 工作区文件：与首页「切换主机」同款系统半模态（ImmersiveMaterial 沉浸光感）
        .bindSheet($$this.fileSheetOpen, this.workspaceFilesSheet(), {
          height: '72%',
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
          systemMaterial: this.teamSheetMaterial()
        })

      // 会话状态 sheet 锚点（与工作区文件同款系统半模态）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.statsSheetOpen, this.statsSheetContent(), {
          // 打开时按内容算高度，默认把执行 / Token 用量 / 上下文三组全部显示出来
          height: this.statsSheetHeight > 0 ? this.statsSheetHeight : '60%',
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
          systemMaterial: this.teamSheetMaterial()
        })

      }
      .width('100%')
      .height('100%')
      .onAreaChange((oldValue: Area, newValue: Area) => {
        this.pageW = Number(newValue.width);
        this.pageH = Number(newValue.height);
      })
      // 团队内容面板：系统半模态（对齐 dsh-mobile TeamContentSheet 的 detents）
      // 团队内容面板：与首页「切换主机」同款系统半模态（ImmersiveMaterial 沉浸光感）
      .bindSheet($$this.teamSheetOpen, this.teamSheetContent(), {
        height: '65%',
        dragBar: false,
        showClose: false,
        preferType: SheetType.BOTTOM,
        backgroundColor: this.immersiveSupported() ? Color.Transparent : (this.isDark ? '#2E2E2E' : '#F7F8FA'),
        systemMaterial: this.teamSheetMaterial(),
        onDisappear: () => {
          this.teamTaskFilter = 'all';
          this.teamExpandedTasks = [];
          // 关弹窗回到列表态，避免下次打开还停在预览
          this.backTeamPreview();
        }
      })
    }
    // 系统返回键隐藏：它的尺寸固定（45vp），和右侧三个圆（54vp）对不齐；
    // 返回键改由 headerBar 里自绘的 NavBackButton 承担（同一套 HdsGlassSurface）
    .hideBackButton(true)
    // 原生标题栏：内容从标题栏下滚过时系统渐变模糊 + 玻璃材质；标题栏内容用原 headerBar（保留标题/状态/三个圆钮）
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
    .bindToScrollable([this.scroller])
    .onShown(() => {
      // 从设置等二级页返回时，那些页面把键盘避让改成 NONE；这里恢复 RESIZE，否则输入法弹出时输入框不跟随
      try {
        this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      } catch (ignored) {
      }
      // 从会话设置返回：同步标题下方的模式标签（在设置里切换过 Agent 预设）
      this.syncModeChipLabel();
      // 空白新会话：把刚设置的新默认预设应用到当前草稿会话，标题下的模式立即变化
      const shownSessionId: string = SessionStore.get().currentSessionId();
      const emptyDraft: boolean = shownSessionId.length > 0 && this.items.length === 0 && !this.running;
      if (emptyDraft && this.defaultAgentPreset.length > 0 && this.currentAgentPresetId() !== this.defaultAgentPreset) {
        GatewayClient.get().selectAgentPreset(shownSessionId, this.defaultAgentPreset);
        const nextPresets: Record<string, Object> = {};
        for (const key of Object.keys(this.sessionAgentPresets)) {
          nextPresets[key] = this.sessionAgentPresets[key];
        }
        nextPresets[shownSessionId] = this.defaultAgentPreset;
        this.sessionAgentPresets = nextPresets;
      }
      Logger.info('[PAGE] onShown ready=' + (this.ready ? '1' : '0') + ' entries=' + this.entries.length.toString());
      this.pageVisible = true;
      this.restoreQueueImages();
      this.syncModeChipLabel();
      this.pageSessionId = SessionStore.get().currentSessionId();
      this.applyStatusBarColor();
      // 主题是在设置页之类的地方切的：回到本页整表重载一次，保证回复正文/过程文字按新配色重建
      if (this.themeDirty) {
        this.themeDirty = false;
        this.reloadForTheme();
      }
      // 每次回到会话页都重新读一次工作步骤偏好：设置页改完回来立刻按新档位重排，
      // 不依赖 @StorageProp 的 @Watch 是否触发（被压栈/重建的边界情况下它可能漏拍）。
      if (this.ready) {
        this.syncWorkStepPrefs();
        this.rebuildEntries();
      }
      if (this.pendingItemsWhileHidden) {
        this.pendingItemsWhileHidden = false;
        this.scheduleTimelineUpdate();
      }
      // 首屏兜底：内容可能在上屏前一刻才到（赋值落在组件还没建好的窗口里被吞掉）。
      // 这里在几个时间点各补一次重排+贴底，保证第一帧就能看到内容，不需要用户点一下。
      for (const delay of [60, 220, 600]) {
        setTimeout(() => {
          if (!this.pageVisible) {
            return;
          }
          this.rebuildEntries();
          try {
            this.scroller.scrollEdge(Edge.Bottom);
          } catch (err) {
          }
        }, delay);
      }
    })
    .onHidden(() => {
      Logger.info('[PAGE] onHidden entries=' + this.entries.length.toString());
      // 被压栈盖住：先把草稿落盘，再停掉重排与进度刷新
      this.flushDraft();
      this.teamSheetOpen = false;
      this.pageVisible = false;
      if (this.timelineTimer >= 0) {
        clearTimeout(this.timelineTimer);
        this.timelineTimer = -1;
      }
    })
    .backgroundColor(this.pageBg())
  }

  @State sessionPickerOpen: boolean = false;
  /** 侧栏弹出动画进度：0=收起（scale 0.9 透明）→1=展开，配合系统菜单同款「锚点缩放+淡入」 */
  @State sessionPickerAnim: number = 0;
  /** 重命名会话弹窗 */
  @State renameSessionOpen: boolean = false;
  @State renameValue: string = '';
  /** 工作区文件 sheet（对齐小程序 files sheet） */
  @State fileSheetOpen: boolean = false;
  /** 会话状态 sheet（对齐小程序 morePane='stats'：执行 / Token 用量 / 上下文 三张卡片） */
  @State statsSheetOpen: boolean = false;
  /** 会话状态弹窗高度：打开时按内容估算，默认一次把三组统计全部显示出来 */
  @State statsSheetHeight: number = 0;
  @State statsGroups: StatsGroup[] = [];
  @State fileEntries: WorkspaceFileEntry[] = [];
  @State filePath: string = '';
  @State fileLoading: boolean = false;
  @State fileHint: string = '';
  @State fileBusy: boolean = false;

  // ==================== 会话节点弹层（右上角三横线） ====================
  @State turnNavOpen: boolean = false;
  /** 点胶囊打开的原生系统菜单（长按滑块时改用自绘浮层做拖动跟随） */
  @State turnNavMenuOpen: boolean = false;
  @State turnNodes: TurnNode[] = [];
  /** 会话节点预热是否进行中（展开胶囊时就开始拉历史，避免开弹层才等） */
  private turnNavWarmupRunning: boolean = false;
  /** 预热的自愈重试定时器：首屏还没落地 / 某页偶发失败时，展开期间持续检查并续拉 */
  private warmupRetryTimer: number = -1;
  /** 当前预览/选中的节点下标 */
  @State turnNodeIndex: number = 0;
  /** 右侧卡带轨道高度（用于把拖动位移换算成节点下标） */
  @State turnTrackHeight: number = 0;
  /** 智感握姿：1 = 左手，2 = 右手（3 双手 / 0 / 16 未知） */
  @StorageLink('holdingHand') @Watch('onHoldingHand') holdingHand: number = 0;
  /** 胶囊停靠边（握姿去抖结果 + 手动拖动都写这里） */
  @State capsuleSide: string = 'right';
  /** 胶囊是否展开（拖动吸附到边后折叠成把手，点击再展开） */
  @State capsuleExpanded: boolean = true;
  /** 设置项「胶囊常显」：关闭后会话页不渲染侧边胶囊 */
  @StorageLink('capsuleAlwaysVisible') capsuleAlwaysVisible: boolean = true;
  /** 拖动位移：跟手反馈，松手回弹/吸附都用它 */
  @State capsuleDragX: number = 0;
  /** 页面尺寸（用于胶囊绝对定位） */
  @State pageW: number = 0;
  @State pageH: number = 0;
  /** 胶囊竖向偏移：上下拖动可调整停靠高度 */
  @State capsuleYOffset: number = 0;
  private capsuleDragStartY: number = 0;
  private holdTimer: number = -1;
  /** 当前拖动主轴：h 横向移动 / v 纵向切节点 */
  private capsuleAxis: string = '';
  private turnListScroller: Scroller = new Scroller();
  private turnScrubStartIndex: number = 0;
  /** 弹窗内上下滑动切换节点的起始下标与累计位移 */
  private turnSwipeBase: number = 0;
  private turnSwipeOffset: number = 0;
  /** 卡带拖动位移：黑色滑块随手指上下移动，松手回中 */
  @State turnBarOffset: number = 0;
  /** 会话侧栏（对齐小程序 conv-sidebar）：分组数据与展开的分组 id */
  @State convSidebarGroups: ConvSidebarGroup[] = [];
  @State convSidebarExpanded: string[] = [];
  @StorageLink('workspaces') workspaces: WorkspaceRow[] = [];

  // ==================== 输入条 chip 弹层（对齐小程序 permission-pop / model-menu） ====================
  private openComposerSheet(kind: string): void {
    if (this.composerSheet === kind) {
      this.composerSheet = '';
      return;
    }
    if (kind === 'permission') {
      this.permissionRows = this.buildPermissionRows();
    } else {
      this.modelRows = this.buildModelRows();
      this.effortRows = this.buildEffortRows();
    }
    this.composerSheet = kind;
  }

  /** 权限名（对齐小程序 labels.permissionName） */
  private permissionName(value: string): string {
    if (value === 'read-only') {
      return '只读';
    }
    if (value === 'workspace-write') {
      return '工作区写入';
    }
    if (value === 'danger-full-access') {
      return '完全访问';
    }
    if (value === 'auto') {
      return '自动审查';
    }
    return value.length > 0 ? value : '默认权限';
  }

  private permissionGlyph(value: string): string {
    if (value === 'read-only') {
      return '◐';
    }
    if (value === 'workspace-write') {
      return '✎';
    }
    if (value === 'danger-full-access') {
      return '⚠';
    }
    if (value === 'auto') {
      return '◈';
    }
    return '⛨';
  }

  /** 权限选项：网关下发优先，缺失时用固定三项 + 自动审查兜底（对齐小程序 pickPermission）。 */
  /** 权限菜单文案（对齐小程序 pickPermission：预设名优先，缺失时兜底三项 + 自动审查）。 */
  private permissionMenuLabels(): string[] {
    const labels: string[] = [];
    for (const value of this.permissionMenuValues()) {
      labels.push(this.permissionName(value));
    }
    return labels;
  }

  /** 权限菜单取值列表。 */
  private permissionMenuValues(): string[] {
    const values: string[] = [];
    for (const value of this.permissionValues) {
      if (value.length > 0 && values.indexOf(value) < 0) {
        values.push(value);
      }
    }
    if (values.length === 0) {
      values.push('read-only');
      values.push('workspace-write');
      values.push('danger-full-access');
    }
    if (values.indexOf('auto') < 0) {
      values.push('auto');
    }
    return values;
  }

  private buildPermissionRows(): PermissionRow[] {
    const rows: PermissionRow[] = [];
    const current: string = this.defaultPermission;
    const seen: string[] = [];
    for (const value of this.permissionValues) {
      if (value.length === 0 || seen.indexOf(value) >= 0) {
        continue;
      }
      seen.push(value);
      rows.push({ value: value, label: this.permissionName(value), icon: this.permissionGlyph(value), current: value === current });
    }
    if (seen.length === 0) {
      const fallback: string[] = ['read-only', 'workspace-write', 'danger-full-access'];
      for (const value of fallback) {
        rows.push({ value: value, label: this.permissionName(value), icon: this.permissionGlyph(value), current: value === current });
      }
    }
    if (seen.indexOf('auto') < 0) {
      rows.push({ value: 'auto', label: '自动审查', icon: this.permissionGlyph('auto'), current: current === 'auto' });
    }
    return rows;
  }

  /** 当前模型 id：目录 current 优先，其次会话默认模型。 */
  private currentModelId(): string {
    // 新建会话还没有会话级模型：优先跟随「新会话默认配置 → 默认模型」
    if (this.pageSessionId.length === 0 && this.defaultModel.length > 0) {
      for (const option of this.modelOptions) {
        if (option.model === this.defaultModel || option.label === this.defaultModel) {
          return option.model;
        }
      }
      return this.defaultModel;
    }
    if (this.selectedModel.length > 0) {
      return this.selectedModel;
    }
    // 会话回执可能只给显示名（如 DeepSeek-V4.1-Flash）：按 label 反查 id
    if (this.defaultModel.length > 0) {
      for (const option of this.modelOptions) {
        if (option.model === this.defaultModel || option.label === this.defaultModel) {
          return option.model;
        }
      }
      return this.defaultModel;
    }
    // 目录里的 current 兜底
    return '';
  }

  /** 当前模型显示名：按 id 在目录里找 label，找不到回退 id。 */
  private currentModelLabel(): string {
    const id: string = this.currentModelId();
    // 同名模型可能存在于多个 provider：优先按默认 provider 匹配
    const preferredProvider: string = AppStorage.get<string>('defaultProvider') ?? '';
    if (preferredProvider.length > 0) {
      for (const option of this.modelOptions) {
        if (option.model === id && option.provider === preferredProvider) {
          return option.label;
        }
      }
    }
    for (const option of this.modelOptions) {
      if (option.model === id) {
        return option.label;
      }
    }
    // 目录还没有（未连网关）或 id 不在目录里：直接显示模型 id，不要用占位词
    return id.length > 0 ? id : '模型';
  }

  /** 当前模型发布徽章。 */
  private currentModelBadge(): string {
    const id: string = this.currentModelId();
    for (const option of this.modelOptions) {
      if (option.model === id) {
        return option.badge;
      }
    }
    return '';
  }

  /** 当前推理等级（目录回传优先，其次会话默认）。 */
  private currentEffort(): string {
    const value: string = this.selectedEffort.length > 0 ? this.selectedEffort : this.defaultEffort;
    return value.length > 0 ? value : 'high';
  }

  /** 构建模型菜单条目：按 provider 分组（表头 + 条目）。 */
  private modelMenuItems(): ModelMenuItem[] {
    const items: ModelMenuItem[] = [];
    const currentModel: string = this.currentModelId();
    const currentProvider: string = this.currentModelProvider();
    let lastProvider: string = '';
    for (const option of this.modelOptions) {
      const providerName: string = option.providerName.length > 0 ? option.providerName : this.providerName(option.provider);
      if (providerName !== lastProvider) {
        lastProvider = providerName;
        items.push({
          key: 'header-' + providerName, label: providerName, isHeader: true, current: false,
          provider: '', model: '', effortValue: ''
        });
      }
      const badge: string = option.badge.length > 0 ? ' ' + option.badge : '';
      items.push({
        key: option.provider + '/' + option.model,
        label: option.label + badge,
        isHeader: false,
        // 仅「当前提供商 + 当前模型」打勾，避免同名模型在多提供商下出现多个 ✓
        current: option.model === currentModel && (currentProvider.length === 0 || option.provider === currentProvider),
        provider: option.provider,
        model: option.model,
        effortValue: ''
      });
    }
    // 推理等级不在模型列表里出现：第一层已经有独立的「推理等级」入口
    return items;
  }

  /** 提供商列表（模型菜单的上一级） */
  private modelProviderItems(): ModelMenuItem[] {
    const out: ModelMenuItem[] = [];
    const seen: string[] = [];
    const currentProvider: string = this.currentModelProvider();
    for (const option of this.modelOptions) {
      if (seen.indexOf(option.provider) >= 0) {
        continue;
      }
      seen.push(option.provider);
      const name: string = option.providerName.length > 0 ? option.providerName : this.providerName(option.provider);
      out.push({
        key: 'provider-' + option.provider,
        label: name,
        isHeader: false,
        current: option.provider === currentProvider,
        provider: option.provider,
        model: '',
        effortValue: ''
      });
    }
    return out;
  }

  /** 当前模型所属提供商 */
  private currentModelProvider(): string {
    const id: string = this.currentModelId();
    // 同名模型可能出现在多个提供商下：已显式选择过提供商时以它为准，否则用目录里的第一个匹配项
    if (this.selectedProvider.length > 0) {
      for (const option of this.modelOptions) {
        if (option.model === id && option.provider === this.selectedProvider) {
          return this.selectedProvider;
        }
      }
    }
    for (const option of this.modelOptions) {
      if (option.model === id) {
        return option.provider;
      }
    }
    return this.selectedProvider;
  }

  private modelMenuBadges(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      out.push(option.badge);
    }
    return out;
  }

  /** 模型菜单：provider 名（按小程序映射 DeepSeek 账号 / 官方 API）。 */
  private providerName(provider: string): string {
    if (provider === 'deepseek-account') {
      return 'DeepSeek 账号';
    }
    if (provider === 'deepseek-official') {
      return 'DeepSeek 官方 API';
    }
    return provider.length > 0 ? provider : '模型';
  }

  private modelMenuProviders(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      // 优先用网关给的 providerName，回退到内置映射
      out.push(option.providerName.length > 0 ? option.providerName : this.providerName(option.provider));
    }
    return out;
  }

  private modelMenuLabels(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      out.push(option.label);
    }
    return out;
  }

  private modelMenuModels(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      out.push(option.model);
    }
    return out;
  }

  /** 推理等级取值：实时映射当前模型配置的 reasoningEfforts 键（与 DSH 客户端一致），未取到配置时回退默认四档。 */
  private effortMenuValues(): string[] {
    const values: string[] = this.modelEfforts.length > 0
      ? this.modelEfforts
      : ['off', 'low', 'medium', 'high'];
    return values;
  }

  private effortMenuLabels(): string[] {
    const values: string[] = this.effortMenuValues();
    if (this.modelEffortNames.length === values.length && this.modelEffortNames.length > 0) {
      return this.modelEffortNames.slice();
    }
    const labels: string[] = [];
    for (const value of values) {
      labels.push(this.effortName(value));
    }
    return labels;
  }

  /** 只切推理等级：沿用当前模型下发 select-model（对齐小程序 pickEffortOption）。 */
  private selectEffortAndModel(effort: string): void {
    this.selectedEffort = effort;
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    // 沿用当前模型，只换推理等级（对齐小程序 pickEffortOption）
    const model: string = this.currentModelId();
    let provider: string = this.selectedProvider;
    if (provider.length === 0) {
      for (const option of this.modelOptions) {
        if (option.model === model) {
          provider = option.provider;
        }
      }
    }
    client.requestGateway(GatewayRequestFactory.selectModel(sessionId, provider, model, effort)).catch((error: Error) => {
      this.hint = '推理等级切换失败：' + error.message;
    });
  }

  private buildModelRows(): ModelRow[] {
    const rows: ModelRow[] = [];
    const current: string = this.defaultModel;
    for (const option of this.modelOptions) {
      rows.push({
        key: option.provider + '/' + option.model,
        provider: option.provider,
        model: option.model,
        label: option.label,
        current: option.model === current
      });
    }
    return rows;
  }

  private buildEffortRows(): EffortRow[] {
    const rows: EffortRow[] = [];
    const values: string[] = this.effortMenuValues();
    const labels: string[] = this.effortMenuLabels();
    for (let index = 0; index < values.length; index++) {
      const value: string = values[index];
      rows.push({ id: value, label: labels[index], current: this.currentEffort() === value });
    }
    return rows;
  }

  /** 推理等级文案（逐条对齐小程序 labels.reasoningEffortName） */
  private effortName(effort: string): string {
    const key: string = effort.toLowerCase();
    if (key === 'off' || key === 'none' || key === 'disabled') {
      return 'Off';
    }
    if (key === 'minimal') {
      return 'Minimal';
    }
    if (key === 'low') {
      return 'Low';
    }
    if (key === 'medium') {
      return 'Medium';
    }
    if (key === 'high') {
      return 'High';
    }
    if (key === 'xhigh') {
      return 'XHigh';
    }
    if (key === 'max') {
      return 'Max';
    }
    if (key === 'ultra') {
      return 'Ultra';
    }
    return effort;
  }

  private onModelDetailsChanged(): void {
    this.refreshModelEfforts();
  }

  /** 拉取模型目录帧：当前模型的 reasoning.efforts [{id, name}]（与 DSH 客户端同源、实时映射）。 */
  private refreshModelEfforts(): void {
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.modelEfforts = [];
      this.modelEffortNames = [];
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    // 断环：models 响应会写 AppStorage('modelDetails')，而本页对它挂了 @Watch，
    // 之前每次响应都再发一次 models 请求 —— 网关回一帧、页面再问一次，形成 60 次/秒的死循环，
    // 把连接打满，实时事件（工具步骤/流式正文）就再也送不进来了。
    // 这里按「会话 + 当前模型」去重：同一组合只请求一次。
    const effortKey: string = sessionId + '|' + this.currentModelId();
    if (effortKey === this.modelEffortsKey) {
      return;
    }
    this.modelEffortsKey = effortKey;
    const request = sessionId.length > 0
      ? GatewayRequestFactory.make('models', 'models', { 'sessionId': sessionId }, sessionId)
      : GatewayRequestFactory.simple('models');
    client.requestGateway(request, 15000).then((frame: GatewayFrame) => {
      const rec: Record<string, Object> = asRec(frame) ?? ({} as Record<string, Object>);
      const rawGroups = rec['groups'];
      const groups = rawGroups !== undefined && Array.isArray(rawGroups) ? rawGroups as Object[] : [];
      // 目标模型：网关帧里的 current 优先（权威当前模型），否则回退本地推算
      let targetId: string = this.currentModelId();
      const rawCurrent = rec['current'];
      if (rawCurrent !== undefined && !Array.isArray(rawCurrent)) {
        const cur = rawCurrent as Record<string, Object>;
        const cm: string = String(cur['model'] ?? '');
        if (cm.length > 0) {
          targetId = cm;
        }
      }
      const needle: string = targetId.toLowerCase();
      const ids: string[] = [];
      const names: string[] = [];
      for (const group of groups) {
        const g = group as Record<string, Object>;
        const rawModels = g['models'];
        if (rawModels === undefined || !Array.isArray(rawModels)) {
          continue;
        }
        for (const one of rawModels as Object[]) {
          const m = one as Record<string, Object>;
          if (String(m['id'] ?? '').toLowerCase() !== needle) {
            continue;
          }
          const reasoning = m['reasoning'] as Record<string, Object> | undefined;
          const efforts = reasoning === undefined ? undefined : reasoning['efforts'];
          if (efforts !== undefined && Array.isArray(efforts)) {
            for (const level of efforts as Object[]) {
              const er = level as Record<string, Object>;
              const id: string = String(er['id'] ?? '');
              if (id.length === 0 || ids.indexOf(id) >= 0) {
                continue;
              }
              ids.push(id);
              names.push(String(er['name'] ?? this.effortName(id)));
            }
          }
          break;
        }
        if (ids.length > 0) {
          break;
        }
      }
      // 会话当前档位（如 max）即使不在模型目录档位里也要显示——DSH 客户端同款行为
      let sessionEffort: string = '';
      const rawCurrentEffort = rec['current'];
      if (rawCurrentEffort !== undefined && !Array.isArray(rawCurrentEffort)) {
        sessionEffort = String((rawCurrentEffort as Record<string, Object>)['reasoningEffort'] ?? '');
      }
      if (sessionEffort.length > 0 && ids.indexOf(sessionEffort) < 0) {
        ids.push(sessionEffort);
        names.push(this.effortName(sessionEffort));
      }
      this.modelEfforts = ids;
      this.modelEffortNames = names;
    }).catch((ignored: Error) => {
      this.modelEfforts = [];
      this.modelEffortNames = [];
    });
  }

  /** 选中权限：下发 permission 帧并本地更新（对齐小程序 pickPermissionOption）。 */
  private selectPermission(value: string): void {
    this.composerSheet = '';
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || value.length === 0) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    this.defaultPermission = value;
    client.requestGateway(GatewayRequestFactory.setPermission(sessionId, value)).catch(() => {
      this.hint = '权限设置失败';
    });
  }

  /** 选中模型：下发 select-model 帧。 */
  private selectModel(provider: string, model: string): void {
    this.composerSheet = '';
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || model.length === 0) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    // 会话级选择：本地乐观更新 chip（对齐小程序 sessionState.selection），不覆盖主机默认模型
    this.selectedModel = model;
    this.selectedProvider = provider;
    this.refreshModelEfforts();
    client.requestGateway(GatewayRequestFactory.selectModel(sessionId, provider, model, this.currentEffort())).catch((error: Error) => {
      this.hint = '模型切换失败：' + error.message;
    });
  }

  private selectEffort(effort: string): void {
    this.defaultEffort = effort;
    this.effortRows = this.buildEffortRows();
  }
  // ==================== 会话状态（对齐小程序 morePane='stats'：三张卡片） ====================
  private openStatsSheet(): void {
    this.statsGroups = this.buildStatsGroups();
    this.statsSheetHeight = this.statsSheetTargetHeight();
    this.statsSheetOpen = true;
  }

  /**
   * 会话状态弹窗的目标高度：按三组统计的行数估算，默认一屏展示全部内容。
   * 上限取页面高度的 88%（超出才内部滚动），下限 320vp。
   */
  private statsSheetTargetHeight(): number {
    const dragBar: number = 16;
    const titleRow: number = 44;
    const bottomPadding: number = 24;
    let content: number = 0;
    for (const group of this.statsGroups) {
      // 组标题(≈28) + 行(每行 14 padding + 约 19 文本) + 组内边距/边框/组间距(≈19)
      let groupHeight: number = 28 + 19;
      groupHeight += group.rows.length * 33;
      content += groupHeight;
    }
    const target: number = dragBar + titleRow + content + bottomPadding + 20;
    const cap: number = this.pageH > 0 ? this.pageH * 0.88 : 760;
    const minHeight: number = 320;
    if (target > cap) {
      return cap;
    }
    return target < minHeight ? minHeight : target;
  }

  /** 对齐小程序 buildStatsGroups：执行 / Token 用量 / 上下文 */
  private buildStatsGroups(): StatsGroup[] {
    const groups: StatsGroup[] = [];
    const turns: number = this.statsNum('turns');
    const steps: number = this.statsNum('steps');
    const execRows: string[][] = [
      // 小程序是 (st.turns || 0)：拿不到时显示 0 而不是占位符
      ['轮次', (turns < 0 ? 0 : turns).toString() + ' 轮'],
      ['步骤', (steps < 0 ? 0 : steps).toString() + ' 步'],
      ['LLM', this.statDuration(this.statsNum('llmMs'))],
      ['工具调用', this.statDuration(this.statsNum('toolMs'))],
      ['首 token 平均', this.statDuration(this.statsNum('firstTokenMs'))]
    ];
    groups.push({ title: '执行', rows: execRows });

    let input: number = this.tokenValue('inputTokens', false);
    if (input < 0) {
      input = this.tokenValue('uncachedInputTokens', false);
    }
    const tokenRows: string[][] = [
      ['输入', this.tokenLabel(input)],
      ['输出', this.tokenLabel(this.tokenValue('outputTokens', false))],
      ['缓存读取', this.tokenLabel(this.tokenValue('cacheReadTokens', false))],
      ['缓存写入', this.tokenLabel(this.tokenValue('cacheWriteTokens', false))]
    ];
    groups.push({ title: 'Token 用量', rows: tokenRows });

    const contextRows: string[][] = [
      ['当前压力', this.tokenLabel(this.contextUsedTokens())],
      ['上下文窗口', this.tokenLabel(this.contextWindowTokens())]
    ];
    groups.push({ title: '上下文', rows: contextRows });
    return groups;
  }

  /** 对齐小程序 fmtDur：>=60s → Xm Ys；>=1s → Xs；否则 Xms */
  private statDuration(ms: number): string {
    if (ms < 0) {
      return '—';
    }
    if (ms >= 60000) {
      return Math.floor(ms / 60000).toString() + 'm ' + Math.round((ms % 60000) / 1000).toString() + 's';
    }
    if (ms >= 1000) {
      return Math.round(ms / 1000).toString() + 's';
    }
    return Math.round(ms).toString() + 'ms';
  }

  // ==================== 指标弹层（对齐小程序 statsPop / ctx-pop） ====================
  private openMetricPopover(kind: string): void {
    if (this.metricPopover === kind) {
      this.metricPopover = '';
      return;
    }
    this.metricTitle = this.metricTitleFor(kind);
    this.metricPairs = this.buildMetricPairs(kind);
    this.metricTotal = this.metricTotalFor(kind);
    this.metricPopover = kind;
  }

  private metricTitleFor(kind: string): string {
    if (kind === 'run') {
      return '会话统计';
    }
    if (kind === 'token') {
      return 'Token 用量';
    }
    return '上下文已用';
  }

  /** 标题行右侧总量（对齐小程序 statsPopTotal / ctx 头部）：Token=计费输入+输出；上下文=已用/窗口。 */
  private metricTotalFor(kind: string): string {
    if (kind === 'context') {
      const used: number = this.contextUsedTokens();
      const window: number = this.contextWindowTokens();
      if (used >= 0 && window >= 0) {
        return '~' + this.compactTok(used) + ' / ' + this.compactTok(window);
      }
      return '';
    }
    if (kind === 'run') {
      // 对齐小程序 showStats：会话统计弹层的 statsPopTotal 是空串，轮/步数只在底部指标条显示
      return '';
    }
    if (kind !== 'token') {
      return '';
    }
    const uncached: number = this.tokenValue('uncachedInputTokens', true);
    const cacheRead: number = this.tokenValue('cacheReadTokens', false);
    const cacheWrite: number = this.tokenValue('cacheWriteTokens', false);
    const input: number = this.tokenValue('inputTokens', false);
    const output: number = this.tokenValue('outputTokens', false);
    const hasDisjoint: boolean = uncached >= 0 && cacheRead >= 0 && cacheWrite >= 0;
    const billed: number = hasDisjoint ? uncached + cacheRead + cacheWrite : input;
    if (billed < 0 || output < 0) {
      return '';
    }
    return this.tokenLabel(billed + output);
  }

  /** 紧凑 token 计数（对齐小程序 compactTok：1234 → 1.2k，1234567 → 1.2M）。 */
  private compactTok(value: number): string {
    if (value < 0) {
      return '—';
    }
    const n: number = Math.round(value);
    if (n >= 1000000) {
      return (Math.round(n / 100000) / 10).toString().replace(/\.0$/, '') + 'M';
    }
    if (n >= 1000) {
      return (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k';
    }
    return n.toString();
  }

  /** 上下文占比分项（pressure.breakdown.*，缺省 -1）。 */
  private breakdownNum(key: string): number {
    if (this.contextUsage === null) {
      return -1;
    }
    const record = asRec(this.contextUsage);
    const pressure = record === undefined ? undefined : asRec(record['pressure']);
    const breakdown = pressure === undefined ? undefined : asRec(pressure['breakdown']);
    if (breakdown === undefined) {
      return -1;
    }
    return num(breakdown, key) ?? -1;
  }

  /** 生成弹层行（只在打开时算一次）。 */
  private buildMetricPairs(kind: string): MetricPair[] {
    const pairs: MetricPair[] = [];
    if (kind === 'run') {
      pairs.push({ key: 'llm', label: '模型用时', value: this.durationLabel(this.statsNum('llmMs')) });
      pairs.push({ key: 'tool', label: '工具调用', value: this.durationLabel(this.statsNum('toolMs')) });
      pairs.push({ key: 'ttft', label: '首 token 平均（TTFT）', value: this.durationLabel(this.ttftMs()) });
      pairs.push({ key: 'tps', label: '输出速度（TPS）', value: this.tpsLabel() });
    } else if (kind === 'token') {
      pairs.push({ key: 'hit', label: '缓存命中', value: this.cacheHitLabel() });
      pairs.push({ key: 'uncached', label: '未缓存输入', value: this.tokenLabel(this.tokenValue('uncachedInputTokens', true)) });
      pairs.push({ key: 'cacheRead', label: '缓存读取', value: this.tokenLabel(this.tokenValue('cacheReadTokens', false)) });
      pairs.push({ key: 'output', label: '输出', value: this.tokenLabel(this.tokenValue('outputTokens', false)) });
    } else {
      // 对齐小程序 ctx-pop：分项明细（系统提示词/工具定义/对话消息），缺 breakdown 时退回 token 用量三项
      const systemTokens: number = this.breakdownNum('systemTokens');
      const toolsTokens: number = this.breakdownNum('toolsTokens');
      const messageTokens: number = this.breakdownNum('messageTokens');
      if (systemTokens >= 0 || toolsTokens >= 0 || messageTokens >= 0) {
        if (systemTokens >= 0) {
          pairs.push({ key: 'system', label: '系统提示词', value: this.compactTok(systemTokens) + ' tok' });
        }
        if (toolsTokens >= 0) {
          pairs.push({ key: 'tools', label: '工具定义', value: this.compactTok(toolsTokens) + ' tok' });
        }
        if (messageTokens >= 0) {
          pairs.push({ key: 'messages', label: '对话消息', value: this.compactTok(messageTokens) + ' tok' });
        }
      } else {
        const uncached: number = this.tokenValue('uncachedInputTokens', true);
        const cacheRead: number = this.tokenValue('cacheReadTokens', false);
        const output: number = this.tokenValue('outputTokens', false);
        if (uncached >= 0) {
          pairs.push({ key: 'uncached', label: '未缓存输入', value: this.compactTok(uncached) + ' tok' });
        }
        if (cacheRead >= 0) {
          pairs.push({ key: 'cacheRead', label: '缓存读取', value: this.compactTok(cacheRead) + ' tok' });
        }
        if (output >= 0) {
          pairs.push({ key: 'output', label: '模型输出', value: this.compactTok(output) + ' tok' });
        }
      }
    }
    return pairs;
  }

  /** 统计字段（context-dashboard.stats）。 */
  private statsNum(key: string): number {
    if (this.dashboard === null) {
      return -1;
    }
    const record = asRec(this.dashboard);
    if (record === undefined) {
      return -1;
    }
    const stats = asRec(record['stats']);
    if (stats === undefined) {
      return -1;
    }
    return num(stats, key) ?? -1;
  }

  private durationLabel(ms: number): string {
    if (ms < 0) {
      return '—';
    }
    if (ms >= 60000) {
      return Math.floor(ms / 60000).toString() + '分' + Math.round((ms % 60000) / 1000).toString() + '秒';
    }
    if (ms >= 1000) {
      return (Math.round(ms / 100) / 10).toString() + '秒';
    }
    return Math.round(ms).toString() + '毫秒';
  }

  private ttftMs(): number {
    const steps: number = this.statsNum('ttftSteps');
    const total: number = this.statsNum('ttftMs');
    if (steps > 0 && total >= 0) {
      return total / steps;
    }
    return this.statsNum('firstTokenMs');
  }

  private tpsLabel(): string {
    const decodeMs: number = this.statsNum('decodeMs');
    const decodeTokens: number = this.statsNum('decodeTokens');
    let rate: number = -1;
    if (decodeMs > 0 && decodeTokens >= 0) {
      rate = decodeTokens / (decodeMs / 1000);
    } else {
      rate = this.statsNum('decodeTokensPerSec');
    }
    if (rate < 0) {
      return '—';
    }
    const rounded: number = Math.round(rate * 10) / 10;
    return rounded.toString() + ' tok/s';
  }

  /** 上下文压力记录：候选顺序对齐小程序（stats.pressure → 顶层 → value 包装 → 帧本身）。 */
  private pressureRecord(): Object | undefined {
    if (this.dashboard !== null) {
      const record = asRec(this.dashboard);
      if (record !== undefined) {
        const stats = asRec(record['stats']);
        if (stats !== undefined) {
          const inStats = asRec(stats['contextPressure']);
          if (inStats !== undefined && this.pressureValid(inStats)) {
            return inStats;
          }
        }
        const top = asRec(record['contextPressure']);
        if (top !== undefined && this.pressureValid(top)) {
          return top;
        }
        if (this.pressureValid(record)) {
          return record;
        }
      }
    }
    if (this.contextUsage !== null) {
      const frame = asRec(this.contextUsage);
      if (frame !== undefined) {
        const cp = asRec(frame['contextPressure']);
        if (cp !== undefined && this.pressureValid(cp)) {
          return cp;
        }
        const direct = asRec(frame['pressure']);
        if (direct !== undefined && this.pressureValid(direct)) {
          return direct;
        }
        const value = asRec(frame['value']);
        if (value !== undefined) {
          const nested = asRec(value['pressure']);
          if (nested !== undefined && this.pressureValid(nested)) {
            return nested;
          }
          const nestedCp = asRec(value['contextPressure']);
          if (nestedCp !== undefined && this.pressureValid(nestedCp)) {
            return nestedCp;
          }
          if (this.pressureValid(value)) {
            return value;
          }
        }
        if (this.pressureValid(frame)) {
          return frame;
        }
      }
    }
    return undefined;
  }

  private pressureValid(pressure: Object | undefined): boolean {
    if (pressure === undefined) {
      return false;
    }
    const window: number = num(pressure, 'contextWindow') ?? -1;
    const used: number = num(pressure, 'projectedTokens') ?? (num(pressure, 'pressureTokens') ?? -1);
    return window >= 0 && used >= 0;
  }

  private contextUsedTokens(): number {
    const pressure = this.pressureRecord();
    if (pressure === undefined) {
      return -1;
    }
    const projected: number = num(pressure, 'projectedTokens') ?? -1;
    return projected >= 0 ? projected : (num(pressure, 'pressureTokens') ?? -1);
  }

  private contextWindowTokens(): number {
    const pressure = this.pressureRecord();
    if (pressure === undefined) {
      return -1;
    }
    return num(pressure, 'contextWindow') ?? -1;
  }

  private tokenLabel(value: number): string {
    if (value < 0) {
      return '—';
    }
    const rounded: number = Math.round(value);
    let text: string = '';
    const digits: string = rounded.toString();
    let count: number = 0;
    for (let index = digits.length - 1; index >= 0; index--) {
      text = digits.charAt(index) + text;
      count++;
      if (count % 3 === 0 && index > 0) {
        text = ',' + text;
      }
    }
    return text + ' tok';
  }

  private cacheHitLabel(): string {
    const percent: number = this.sessionCacheHitPercent();
    return percent >= 0 ? percent.toString() + '%' : '—';
  }

  /** token 分项记录：context-usage 帧（同帧提供 Token 分项）优先，缺了回 context-dashboard。 */
  private tokenUsageRecord(): Object | undefined {
    if (this.contextUsage !== null) {
      const frame = asRec(this.contextUsage);
      if (frame !== undefined) {
        const direct = asRec(frame['tokenUsage']);
        if (direct !== undefined) {
          return direct;
        }
        const value = asRec(frame['value']);
        if (value !== undefined) {
          const nested = asRec(value['tokenUsage']);
          if (nested !== undefined) {
            return nested;
          }
        }
      }
    }
    if (this.dashboard !== null) {
      const record = asRec(this.dashboard);
      if (record !== undefined) {
        const top = asRec(record['tokenUsage']);
        if (top !== undefined) {
          return top;
        }
        const stats = asRec(record['stats']);
        if (stats !== undefined) {
          const inStats = asRec(stats['tokenUsage']);
          if (inStats !== undefined) {
            return inStats;
          }
        }
      }
    }
    return undefined;
  }

  /** token 分项读取：先直取，缺了再回会话 totals 桶（对齐小程序 tokenUsageValue）。 */
  private tokenBucket(tokens: Object | undefined, totals: Object | undefined, name: string): number {
    const direct: number = num(tokens, name) ?? -1;
    if (direct >= 0) {
      return direct;
    }
    if (totals !== undefined) {
      return num(totals, name) ?? -1;
    }
    return -1;
  }

  private tokenValue(key: string, fallbackToInput: boolean): number {
    const tokens = asRec(this.tokenUsageRecord());
    if (tokens === undefined) {
      return -1;
    }
    const totals = asRec(tokens['totals']);
    const value: number = this.tokenBucket(tokens, totals, key);
    if (value >= 0) {
      return value;
    }
    if (fallbackToInput) {
      return this.tokenBucket(tokens, totals, 'inputTokens');
    }
    return -1;
  }

  /** 团队协作开关说明气泡（点 ⓘ 弹出） */
  @Builder
  teamInfoTip() {
    Text('通过共享任务板协调多个智能体的分工与进度，复杂任务表现更佳，token 开销也相应更高。')
      .fontSize(13)
      .lineHeight(19.5)
      .fontColor('#FFFFFF')
      .constraintSize({ maxWidth: 270 })
      .padding({ left: 14, right: 14, top: 10, bottom: 10 })
      .backgroundColor('rgba(28,30,36,0.96)')
      .borderRadius(10)
  }

  /** 输入条 chip 弹层：底部卡片（权限列表 / 模型列表 + 推理等级）。 */
  @Builder
  composerSheetPanel() {
    // 不再用全屏遮罩：面板直接叠在输入框上方，输入框保持可见可点
    Column({ space: 2 }) {
        Row() {
          Text(this.composerSheet === 'permission' ? '权限' : '模型')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Blank()
          Text('关闭')
            .fontSize(12)
            .fontColor(this.subColor())
            .onClick(() => {
              this.composerSheet = '';
            })
        }
        .width('100%')
        .height(36)

        if (this.composerSheet === 'permission') {
          Scroll() {
            Column({ space: 1 }) {
              ForEach(this.permissionRows, (row: PermissionRow) => {
                Row({ space: 8 }) {
                  Text(row.icon).fontSize(12).fontColor(this.subColor()).width(16)
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .layoutWeight(1)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (row.current) {
                    Text('✓').fontSize(12).fontColor('#2E6BE6')
                  }
                }
                .width('100%')
                .height(38)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(row.current ? 'rgba(46,107,230,0.12)' : Color.Transparent)
                .onClick(() => {
                  this.composerSheet = '';
                  this.selectPermission(row.value);
                })
              }, (row: PermissionRow) => row.value)
            }
            .width('100%')
          }
          .constraintSize({ maxHeight: 320 })
          .scrollBar(BarState.Off)
        } else {
          Scroll() {
            Column({ space: 1 }) {
              ForEach(this.modelRows, (row: ModelRow) => {
                Row({ space: 8 }) {
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .layoutWeight(1)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (row.current) {
                    Text('✓').fontSize(12).fontColor('#2E6BE6')
                  }
                }
                .width('100%')
                .height(38)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(row.current ? 'rgba(46,107,230,0.12)' : Color.Transparent)
                .onClick(() => {
                  this.composerSheet = '';
                  this.selectModel(row.provider, row.model);
                })
              }, (row: ModelRow) => row.key)

              // 推理等级分区（对齐小程序 effortSheet）
              Row() {
                Text('推理等级').fontSize(11).fontColor(this.subColor())
              }
              .width('100%')
              .height(30)
              .padding({ left: 8 })
              ForEach(this.effortRows, (row: EffortRow) => {
                Row({ space: 8 }) {
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .layoutWeight(1)
                  if (row.current) {
                    Text('✓').fontSize(12).fontColor('#2E6BE6')
                  }
                }
                .width('100%')
                .height(36)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(row.current ? 'rgba(46,107,230,0.12)' : Color.Transparent)
                .onClick(() => {
                  this.composerSheet = '';
                  this.selectEffort(row.id);
                })
              }, (row: EffortRow) => row.id)

              // 智能体团队协作（对齐 dsh-mobile：推理等级下方）
              Divider()
                .color(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
                .margin({ top: 6, bottom: 6 })
              Row({ space: 6 }) {
                Text('启用智能体团队协作')
                  .fontSize(14)
                  .fontColor(this.hasTeamSession() ? this.textColor() : this.subColor())
                  .maxLines(1)
                Text('ⓘ')
                  .fontSize(11)
                  .fontColor(this.subColor())
                  .padding(4)
                  .onClick(() => {
                    this.teamInfoOpen = !this.teamInfoOpen;
                  })
                  .bindPopup(this.teamInfoOpen, {
                    builder: this.teamInfoTip(),
                    placement: Placement.Top,
                    popupColor: Color.Transparent,
                    enableArrow: false,
                    autoCancel: true,
                    radius: 10,
                    onStateChange: (event) => {
                      if (!event.isVisible) {
                        this.teamInfoOpen = false;
                      }
                    }
                  })
                Blank()
                // 命中区域严格限制在开关本体（40×24），点文字/空白不切换
                Stack() {
                  Toggle({ type: ToggleType.Switch, isOn: this.teamEnabled })
                    .selectedColor('#2E6BE6')
                    .switchPointColor('#FFFFFF')
                    .width(40)
                    .height(24)
                    .enabled(this.hasTeamSession())
                    .onChange((isOn: boolean) => {
                      this.toggleTeamEnabled(isOn);
                    })
                }
                .width(40)
                .height(24)
                .clip(true)
              }
              .width('100%')
              .height(40)
              .padding({ left: 8, right: 8 })
              .onClick(() => {
                // 行本身不响应：避免点标签/空白误触开关
              })
            }
            .width('100%')
          }
          .constraintSize({ maxHeight: 420 })
          .scrollBar(BarState.Off)
        }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(16)
    .borderRadius(18)
    .backgroundColor(this.surfaceColor())
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
    .shadow({ radius: 20, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)', offsetY: 6 })
    .margin({ left: 12, right: 12, bottom: 8 })
  }
  /** 指标弹层：输入框正上方的菜单式小卡片（样式对齐右上角三点 Menu：无遮罩、圆角卡片、细描边、行分隔线）。 */
  /** 行数据在打开时算好存进 @State，build 内不再调用会新建数组的方法（否则会反复重渲染）。 */
  @Builder
  metricPopoverPanel() {
    // 不再用全屏遮罩：面板直接叠在输入框上方，输入框保持可见可点
    Column({ space: 2 }) {
        // 标题行：图标 + 标题 + 占比（上下文已用）/ 总量（Token 用量），底部一条分隔线
        Row() {
          if (this.metricPopover === 'run') {
            Image($r('app.media.dsh_gauge'))
              .width(14)
              .height(14)
              .objectFit(ImageFit.Contain)
              .margin({ right: 6 })
          } else if (this.metricPopover === 'token') {
            Image($r('app.media.dsh_storage'))
              .width(14)
              .height(14)
              .objectFit(ImageFit.Contain)
              .margin({ right: 6 })
          } else {
            Circle()
              .width(14)
              .height(14)
              .fill(Color.Transparent)
              .stroke(this.subColor())
              .strokeWidth(1.5)
              .margin({ right: 6 })
          }
          Text(this.metricTitle)
            .fontSize(13.5)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Blank()
          if (this.metricPopover === 'context' && this.contextPercent() >= 0) {
            Text(this.contextMetric())
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor('#2E6BE6')
          }
          if (this.metricPopover === 'run' && this.metricTotal.length > 0) {
            Text(this.metricTotal)
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.textColor())
          }
          if (this.metricPopover === 'token' && this.metricTotal.length > 0) {
            Text(this.metricTotal)
              .fontSize(12)
              .fontColor(this.subColor())
          }
          Text('关闭')
            .fontSize(12)
            .fontColor(this.subColor())
            .margin({ left: 12 })
            .onClick(() => {
              this.metricPopover = '';
            })
        }
        .width('100%')
        // 小程序 .stats-pop-title：padding-bottom 14rpx + border-bottom 1rpx（divider）
        .padding({ bottom: 7 })
        .border({ width: { bottom: 0.5 }, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
        .margin({ bottom: 2 })

        // 上下文：已用/窗口 + 占比进度条（对齐小程序 ctx-pop 头部与 ctx-bar）
        if (this.metricPopover === 'context') {
          if (this.metricTotal.length > 0) {
            Text(this.metricTotal)
              .fontSize(11.5)
              .fontColor(this.subColor())
              .width('100%')
              .margin({ bottom: 5 })
          }
          Progress({
            value: this.contextPercent() < 0 ? 0 : Math.min(100, this.contextPercent()),
            total: 100,
            type: ProgressType.Linear
          })
            .width('100%')
            .height(3)
            .color('#2E6BE6')
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(12,14,19,0.08)')
            .margin({ bottom: 4 })
        }

        ForEach(this.metricPairs, (pair: MetricPair) => {
          Row() {
            Text(pair.label)
              .fontSize(12.5)
              .fontColor(this.subColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
            Text(pair.value)
              .fontSize(12.5)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.textColor())
              .flexShrink(0)
              .margin({ left: 14 })
          }
          .width('100%')
          // 小程序 .stats-pop-row：上下 9rpx≈4.5vp
          .padding({ top: 4.5, bottom: 4.5 })
          .alignItems(VerticalAlign.Center)
        }, (pair: MetricPair) => pair.key)
    }
    .alignItems(HorizontalAlign.Start)
    // 小程序 .stats-pop：width min(560rpx, 100vw-56rpx) ≈ 280vp；padding 24/28rpx = 12/14vp；
    // 圆角 28rpx = 14vp；run 靠左（我们本来就在左侧）
    .constraintSize({ maxWidth: 280 })
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .borderRadius(14)
    .backgroundColor(this.surfaceColor())
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
    .shadow({ radius: 16, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)', offsetY: 4 })
    .margin({ left: 0, right: 0, bottom: 8 })
  }

  // ==================== 智能体团队 ====================
  /** 团队根会话标题（顶栏弹层首行）。 */
  private teamLeadTitle(): string {
    const lead: string = this.teamLeadSessionId;
    if (lead.length === 0) {
      return 'Lead 会话';
    }
    for (const one of this.sessions) {
      if (one.id === lead && one.title.length > 0) {
        return one.title;
      }
    }
    return 'Lead 会话';
  }

  /** 当前打开的会话（成员行据此标记「当前会话」）。 */
  private teamSelectedId(): string {
    const current: string = SessionStore.get().currentSessionId();
    return current.length > 0 ? current : this.teamLeadSessionId;
  }

  /** 彩色智能体头像（iOS AgentAvatar，按成员稳定哈希取一张）。 */
  private teamAvatarResource(index: number): Resource {
    return TEAM_AVATARS[index % TEAM_AVATARS.length];
  }

  /** 成员显示名：合成出来的 Lead 用会话标题兜底。 */
  private teamMemberName(member: TeamMemberView): string {
    if (member.name.length === 0 || member.name === 'lead') {
      return member.id === this.teamLeadSessionId ? this.teamLeadTitle() : member.id.substring(0, 8);
    }
    return member.name;
  }

  /**
   * 成员实时状态：phase 只描述创建阶段，运行态以会话列表（事件驱动）为准，
   * 不镜像桌面端投影里的静态字段。
   */
  private teamMemberLiveStatus(member: TeamMemberView): string {
    // 子智能体（subagentCatalog 合并进来的）不猜运行态，避免显示「状态同步中」；
    // 模式说明走描述行。
    if (member.isChild) {
      return '';
    }
    if (member.phase === 'provisioning') {
      return '正在创建';
    }
    if (member.phase === 'failed') {
      return '创建失败';
    }
    for (const one of this.sessions) {
      if (one.id === member.id) {
        return one.running ? '运行中' : '未运行';
      }
    }
    if (member.id === SessionStore.get().currentSessionId()) {
      return this.running ? '运行中' : '未运行';
    }
    return '状态同步中';
  }

  private teamStatusDotColor(member: TeamMemberView): string {
    if (member.phase === 'failed') {
      return '#D65D64';
    }
    if (member.phase === 'provisioning') {
      return '#E0A03C';
    }
    return this.teamMemberLiveStatus(member) === '运行中' ? '#2EB85C' : this.subColor();
  }

  private teamMemberSubtitle(member: TeamMemberView): string {
    const parts: string[] = [];
    if (member.provider.length > 0) {
      parts.push(member.provider);
    }
    const status: string = this.teamMemberLiveStatus(member);
    if (status.length > 0) {
      parts.push(status);
    }
    return parts.join(' · ');
  }

  /** 半模态材质：与首页「切换主机」弹窗同款（ImmersiveMaterial，系统不支持时回退） */
  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

  private teamSheetMaterial(): uiMaterial.Material | undefined {
    if (!this.immersiveSupported()) {
      return undefined;
    }
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THICK,
      materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
      colorInvert: true,
      applyShadow: true
    });
  }

  /** 点击成员：切到该成员会话（对齐 iOS selectTeamMember）。 */
  private selectTeamMember(id: string): void {
    this.teamSheetOpen = false;
    if (id.length === 0) {
      return;
    }
    if (id === SessionStore.get().currentSessionId()) {
      return;
    }
    SessionStore.get().open(id);
  }

  private teamTaskOwnedBy(task: TeamTaskView, sessionId: string): boolean {
    if (task.ownerId.length > 0) {
      return task.ownerId === sessionId;
    }
    if (task.ownerName.length === 0) {
      return false;
    }
    for (const member of this.teamMembers) {
      if (member.id === sessionId) {
        return member.name === task.ownerName;
      }
    }
    return false;
  }

  private teamOwnerMember(task: TeamTaskView): TeamMemberView | undefined {
    if (task.ownerId.length > 0) {
      for (const member of this.teamMembers) {
        if (member.id === task.ownerId) {
          return member;
        }
      }
      return undefined;
    }
    if (task.ownerName.length === 0) {
      return undefined;
    }
    let found: TeamMemberView | undefined = undefined;
    let matches: number = 0;
    for (const member of this.teamMembers) {
      if (member.name === task.ownerName) {
        found = member;
        matches += 1;
      }
    }
    return matches === 1 ? found : undefined;
  }

  private teamOwnerLabel(task: TeamTaskView): string {
    const member: TeamMemberView | undefined = this.teamOwnerMember(task);
    if (member !== undefined) {
      return member.name;
    }
    if (task.ownerName.length > 0) {
      return task.ownerName;
    }
    if (task.ownerId.length > 0) {
      return task.ownerId;
    }
    return '未分配';
  }

  private teamStatusColor(status: string): string {
    if (status === 'completed') {
      return '#12A594';
    }
    if (status === 'in_progress') {
      return '#2E6BE6';
    }
    return '#8A8F98';
  }

  private teamStatusLabel(status: string): string {
    if (status === 'completed') {
      return '已完成';
    }
    if (status === 'in_progress') {
      return '进行中';
    }
    if (status === 'pending') {
      return '待处理';
    }
    return status;
  }

  /** 共享任务筛选（对齐 iOS：全部 / 当前成员 / 未分配）。 */
  private teamFilteredTasks(): TeamTaskView[] {
    const rows: TeamTaskView[] = [];
    const current: string = this.teamSelectedId();
    for (const task of this.teamTasks) {
      if (task.status === 'deleted') {
        continue;
      }
      if (this.teamTaskFilter === 'current' && !this.teamTaskOwnedBy(task, current)) {
        continue;
      }
      if (this.teamTaskFilter === 'unassigned' && (task.ownerId.length > 0 || task.ownerName.length > 0)) {
        continue;
      }
      rows.push(task);
    }
    return rows;
  }

  private toggleTeamTask(id: string): void {
    const index: number = this.teamExpandedTasks.indexOf(id);
    const next: string[] = this.teamExpandedTasks.slice();
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push(id);
    }
    this.teamExpandedTasks = next;
  }

  private teamTaskExpanded(id: string): boolean {
    return this.teamExpandedTasks.indexOf(id) >= 0;
  }

  private teamEmptyTaskHint(): string {
    if (this.teamTasks.length > 0) {
      return '当前筛选下暂无共享任务';
    }
    if (this.teamMembers.length > 1) {
      return '当前团队尚未创建共享任务';
    }
    return '此会话尚无团队共享任务';
  }

  /** 依赖任务显示名：优先用任务标题，找不到就用 id。 */
  private teamBlockedLabel(task: TeamTaskView): string {
    const parts: string[] = [];
    for (const id of task.blockedBy) {
      let label: string = id;
      for (const one of this.teamTasks) {
        if (one.id === id && one.subject.length > 0) {
          label = one.subject;
          break;
        }
      }
      parts.push(label);
    }
    return parts.join('、');
  }

  /** 顶栏：返回 + 标题/连接状态 + 团队/更多。 */
  /** 顶部安全区：safeTopVp 未就绪时用状态栏兜底高度，避免顶栏被状态栏遮挡 */
  private topSafe(): number {
    return this.topInset > 0 ? this.topInset : 38.9;
  }

  /** 平板/宽屏下正文与输入条居中限宽（对齐 iOS iPad 阅读栏）；手机为 0 */
  private wideInset(): number {
    return wideSideInset(this.pageW);
  }

  /**
   * 顶栏轻模糊：不用系统 BlurStyle 材质（它自带白/浅材质底色，会和页面背景分层），
   * 改成「纯 backdropBlur + 页面同色半透明底」——色调和背景完全一致，
   * 只有从下面滚过的内容被轻微虚化，看不到任何分界带。
   */
  @Builder
  topBlurBar() {
    Column()
      .width('100%')
      .height(56 + this.topSafe())
      .backdropBlur(12)
      .backgroundColor(this.topBlurTint())
      .hitTestBehavior(HitTestMode.None)
  }

  /** 原生标题栏内容：沿用原 headerBar（返回 + 标题/状态 + 团队/会话切换/更多） */
  @Builder
  nativeTitleBar() {
    // headerBar(true)：内嵌模式，不再重复叠加状态栏高度
    this.headerBar(true)
  }

  /** 顶栏模糊层的底色：与页面背景同色系的高透明色（浅色 #F2F2F4 / 深色纯黑） */
  private topBlurTint(): string {
    return this.isDark ? 'rgba(0,0,0,0.26)' : 'rgba(242,242,244,0.28)';
  }

  /**
   * 顶栏圆钮直径：四个圆（返回 + 团队 + 会话切换 + 更多）统一用它。
   * HdsGlassSurface 的 HdsTabs 背板会外扩约 6vp（48 → 实际渲染 54vp），
   * 所以返回键也用同一个 nominal（48），渲染出来和右侧三个圆一样大。
   */
  private headerBtnSize(embedded: boolean): number {
    return embedded ? 48 : 36;
  }

  @Builder
  headerBar(embedded: boolean = false) {
    // 标题/模式字号已调小；右侧三个圆钮之间收紧，标题与返回钮的间距靠标题自身 margin
    Row({ space: 2 }) {
      // 四个圆钮统一自绘：系统返回键固定 45vp，和右侧三个圆对不齐，
      // 所以隐藏系统返回键，返回键也用同一套 HdsGlassSurface（渲染尺寸与右侧一致）
      NavBackButton({ isDark: this.isDark, diameter: this.headerBtnSize(embedded) })
        .id('conversation-back')

      Column({ space: 2 }) {
        Text(this.activeSessionTitle())
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        // 绿点 = 连接状态，右侧显示运行模式（Agent 预设），对齐 dsh-mobile ConversationNavigationStatus
        Row({ space: 6 }) {
          Circle().width(7).height(7).fill(this.connectionDotColor())
          Text(this.sessionModeLabel())
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      // 与左侧返回按钮拉开距离（按钮之间不放 space，避免右上角三个钮过散）
      .margin({ left: 12 })
      .onClick(() => {
        this.openSessionSwitcher();
      })

      // 团队协作入口：圆形玻璃钮 + 双人线框图标，点开成员弹层（对齐 dsh-mobile TeamNavigationEntry）
      if (this.teamVisible) {
        Stack({ alignContent: Alignment.Center }) {
          // 原生沉浸光感背板（与返回键同一套 HdsGlassSurface，跟随玻璃材质档位）
          HdsGlassSurface() {
            Row().width(this.headerBtnSize(embedded)).height(this.headerBtnSize(embedded)).backgroundColor(Color.Transparent)
          }
        Button({ type: ButtonType.Circle }) {
          // 图标沿用小程序 assets/icons/dsh-team(-dark).svg
          // 与返回键完全同源：SymbolGlyph + 同字号/同字重/同色
          SymbolGlyph($r('sys.symbol.person_2'))
            .fontSize(this.headerBtnSize(embedded) * 0.45)
            .fontColor([this.navIconColor()])
            .fontWeight(FontWeight.Medium)
        }
        .id('conversation-team')
        // 圆钮缩小：hover/按下的高亮圈随之变小
        .width(this.headerBtnSize(embedded))
        .height(this.headerBtnSize(embedded))
        // 去掉展开/按下时的默认高亮底色，只留玻璃背板
        .backgroundColor(Color.Transparent)
        .stateEffect(false)
        .accessibilityText('智能体团队')
        .onClick(() => {
          // 侧栏弹窗开着时先关掉它，再打开团队弹层
          if (this.sessionPickerOpen) {
            this.closeSessionSwitcher();
          }
          this.teamPopoverOpen = !this.teamPopoverOpen;
        })
        // 弹窗直接用右上角「⋯」同款系统菜单容器（原生材质/圆角/点空白收起），内容不变
        .bindMenu(this.teamPopoverOpen, this.teamPopoverPanel(), {
          placement: Placement.BottomRight,
          offset: { x: 0, y: 4 },
          outlineColor: this.dividerColor(),
          outlineWidth: 1,
          onWillDisappear: () => {
            this.teamPopoverOpen = false;
          },
          onDisappear: () => {
            this.teamPopoverOpen = false;
          },
          onDidDisappear: () => {
            this.teamPopoverOpen = false;
          }
        })
        }
        .width(this.headerBtnSize(embedded))
        .height(this.headerBtnSize(embedded))
      }

      // 会话快捷切换：三横线圆钮（对齐小程序 nav-actions 的 session-switch-trigger）
        Stack({ alignContent: Alignment.Center }) {
          // 原生沉浸光感背板（与返回键同一套 HdsGlassSurface，跟随玻璃材质档位）
          HdsGlassSurface() {
            Row().width(this.headerBtnSize(embedded)).height(this.headerBtnSize(embedded)).backgroundColor(Color.Transparent)
          }
      Button({ type: ButtonType.Circle }) {
        // 侧栏图形：圆角框 + 左侧竖线（对齐小程序 nav-sidebar-glyph；配色与左侧「协作」图标一致）
        // 线宽对齐「协作」图标：dsh_team.svg 为 16 viewBox / stroke 1，显示 20vp → 实际 1.25vp
        // 与返回键完全同源：SymbolGlyph + 同字号/同字重/同色
        SymbolGlyph(this.sessionPickerOpen ? $r('sys.symbol.close_sidebar') : $r('sys.symbol.open_sidebar'))
          .fontSize(this.headerBtnSize(embedded) * 0.45)
          .fontColor([this.navIconColor()])
          .fontWeight(FontWeight.Medium)
      }
      .id('conversation-session-switch')
      .width(this.headerBtnSize(embedded))
      .height(this.headerBtnSize(embedded))
      // 打开侧栏时保持高亮，和「协作」按钮展开态一致
      // 去掉展开/按下时的默认高亮底色，只留玻璃背板
      .backgroundColor(Color.Transparent)
      .stateEffect(false)
      .accessibilityText('会话快捷切换')
      .onClick(() => {
        if (this.sessionPickerOpen) {
          this.sessionPickerOpen = false;
        } else {
          this.openSessionSwitcher();
        }
      })
        }
        .width(this.headerBtnSize(embedded))
        .height(this.headerBtnSize(embedded))
        .margin({ left: 8 })

        Stack({ alignContent: Alignment.Center }) {
          // 原生沉浸光感背板（与返回键同一套 HdsGlassSurface，跟随玻璃材质档位）
          HdsGlassSurface() {
            Row().width(this.headerBtnSize(embedded)).height(this.headerBtnSize(embedded)).backgroundColor(Color.Transparent)
          }
      Button({ type: ButtonType.Circle }) {
        // 颜色与左侧侧栏图标（navIconColor）一致
        // 系统 more 符号（九宫格）；字号/字重/颜色与返回键完全一致
        SymbolGlyph($r('sys.symbol.more'))
          .fontSize(this.headerBtnSize(embedded) * 0.45)
          .fontColor([this.navIconColor()])
          .fontWeight(FontWeight.Medium)
      }
      .id('conversation-overflow')
      .width(this.headerBtnSize(embedded))
      .height(this.headerBtnSize(embedded))
      // 菜单展开时保持高亮（与「协作」按钮同款）
      // 去掉展开/按下时的默认高亮底色，只留玻璃背板
      .backgroundColor(Color.Transparent)
      .stateEffect(false)
      .accessibilityText('更多')
      .onClick(() => {
        // 侧栏弹窗开着时先关掉它，再展开「⋯」菜单
        if (this.sessionPickerOpen) {
          this.closeSessionSwitcher();
        }
        this.moreMenuOpen = !this.moreMenuOpen;
      })
      .bindMenu(this.moreMenuOpen, this.moreMenu(), {
        placement: Placement.BottomRight,
        offset: { x: 0, y: 4 },
        outlineColor: this.dividerColor(),
        outlineWidth: 1,
        onWillDisappear: () => {
          this.moreMenuOpen = false;
        },
        onDisappear: () => {
          this.moreMenuOpen = false;
        },
        onDidDisappear: () => {
          this.moreMenuOpen = false;
        }
      })
        }
        .width(this.headerBtnSize(embedded))
        .height(this.headerBtnSize(embedded))
        .margin({ left: 8 })
    }
    .width('100%')
    // 内嵌进原生标题栏时：高度 56、不再叠加安全区（否则标题会被压到偏下）
    .height(embedded ? 56 : 56 + this.topSafe())
    // 左缘与输入条一致（输入条容器 padding 14）：返回按钮和输入框左边缘对齐
    .padding({
      // 内嵌时系统返回键占左侧约 48vp，标题从这里开始，避免压住返回键
      left: embedded ? 56 : 14,
      right: 14,
      top: embedded ? 0 : (this.topSafe() > 2 ? this.topSafe() - 2 : 0)
    })
    // 顶栏永远压在页面内浮层之上：侧栏弹窗打开时其透明遮罩不能再吃顶栏按钮的点击
    .zIndex(70)
    // 浮动顶栏完全不铺底：内容上滑时直接从标题下面穿过去（纯 iOS 透明导航栏）
  }

  // ==================== 团队协作弹层（对齐 dsh-mobile TeamMemberPopover） ====================
  /** 成员弹层：小字团队标题 + 成员 N + 成员行 + 查看完整团队内容。 */
  @Builder
  teamPopoverPanel() {
    Column({ space: 8 }) {
      Text(this.teamLeadTitle())
        .fontSize(11)
        .fontColor(this.subColor())
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .padding({ left: 12, right: 12 })
      Text('成员 ' + this.teamMembers.length)
        .fontSize(15)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .width('100%')
        .padding({ left: 12, right: 12 })
      Scroll() {
        Column({ space: 2 }) {
          ForEach(this.teamMembers, (member: TeamMemberView) => {
            this.teamMemberRow(member)
          }, (member: TeamMemberView) => 'pop-' + member.id)
        }
        .width('100%')
      }
      .constraintSize({ maxHeight: 300 })
      .scrollBar(BarState.Off)
      .width('100%')
      Row() {
        Row()
          .width('100%')
          .height(0.5)
          .backgroundColor(this.dividerColor())
      }
      .width('100%')
      .padding({ left: 4, right: 4 })
      Row() {
        Text('查看完整团队内容')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Blank()
        Text('›')
          .fontSize(14)
          .fontColor(this.subColor())
      }
      .width('100%')
      .height(44)
      .padding({ left: 12, right: 12 })
      .borderRadius(10)
      .onClick(() => {
        this.teamPopoverOpen = false;
        setTimeout(() => {
          this.teamSheetOpen = true;
        }, 80);
      })
    }
    // 背景材质、圆角、描边、阴影都交给系统菜单容器（与「⋯」完全同一套），这里只负责内容排版
    .width(280)
    .padding({ top: 2, bottom: 2 })
  }

  /** 打开只读预览：拉该成员/子智能体的会话记录，不切换当前对话（对齐小程序 openCollaborationItem） */
  private openTeamPreview(member: TeamMemberView): void {
    this.teamPreviewToken += 1;
    const token: number = this.teamPreviewToken;
    this.teamPreviewActive = true;
    this.teamPreviewTitle = this.teamMemberName(member);
    this.teamPreviewLoading = true;
    this.teamPreviewError = '';
    this.teamPreviewRows = [];
    // 子智能体会话要带持久父地址，否则网关以 agent-busy 拒绝且错误帧没有 sessionId
    const parentId: string = member.isChild ? this.teamLeadSessionId : '';
    const mode: string = member.isChild ? TeamStore.get().childModeOf(member.id) : '';
    Logger.info('teamPreview open id=' + member.id + ' child=' + (member.isChild ? 1 : 0)
      + ' parent=' + parentId + ' mode=' + mode);
    GatewayClient.get().inspectSession(member.id, parentId, mode).then((frame: GatewayFrame) => {
      if (token !== this.teamPreviewToken) {
        return;
      }
      const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
      Logger.info('teamPreview frame kind=' + frame.kind + ' sessionId=' + (frame.sessionId ?? '')
        + ' events=' + events.length + ' hasMore=' + (frame.hasMore === true ? 1 : 0));
      this.teamPreviewRows = this.teamPreviewRowsFrom(frame, member.id);
      Logger.info('teamPreview rows=' + this.teamPreviewRows.length);
      this.teamPreviewLoading = false;
      if (this.teamPreviewRows.length === 0) {
        this.teamPreviewError = '暂无可显示的消息';
      }
    }).catch((error: Error) => {
      Logger.info('teamPreview failed: ' + error.message);
      if (token !== this.teamPreviewToken) {
        return;
      }
      this.teamPreviewLoading = false;
      this.teamPreviewError = error.message.startsWith('timeout:')
        ? '记录请求超时，请重新连接后重试' : '加载记录失败，请重试';
    });
  }

  /** 返回列表：作废在途预览请求（对齐小程序 backCollaborationList） */
  private backTeamPreview(): void {
    this.teamPreviewToken += 1;
    this.teamPreviewActive = false;
    this.teamPreviewTitle = '';
    this.teamPreviewLoading = false;
    this.teamPreviewError = '';
    this.teamPreviewRows = [];
  }

  /**
   * 从 history 帧提取用户/助手消息（对齐小程序：只取这两类且有文本的行）。
   *
   * 关键：文本不在 data.text 上 ——
   *   · user/message      → data.content 内容块（codec 用 joinTextBlocks 拼）
   *   · assistant/message → data.message.content 里 type=text 的块
   * 所以必须复用 normalizeRawSessionEvent（codec 已把块拼成 event.text），
   * 自己读 data['text'] 永远拿不到东西，表现为「暂无可显示的消息」。
   */
  private teamPreviewRowsFrom(frame: GatewayFrame, sessionId: string): TeamPreviewRow[] {
    const rows: TeamPreviewRow[] = [];
    const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
    let index: number = 0;
    for (const raw of events) {
      if (raw.type !== 'user/message' && raw.type !== 'assistant/message') {
        continue;
      }
      const normalized: SessionEvent = normalizeRawSessionEvent(raw, sessionId);
      const event: GatewayEvent = normalized.event;
      // user/message 里 source 非 user 的是上下文注入，不算用户消息
      if (event.type === 'user/message' && event.source !== undefined && event.source !== 'user') {
        continue;
      }
      const text: string = event.text !== undefined ? event.text : '';
      if (text.trim().length === 0) {
        continue;
      }
      index += 1;
      rows.push({ key: 'p-' + index, role: event.type === 'user/message' ? '用户' : '助手', text: text });
    }
    return rows;
  }

  /** 只读预览：返回列表 + 标题 + 消息（对齐小程序 collab-preview） */
  @Builder
  teamPreviewPanel() {
    Column({ space: 0 }) {
      // 箭头与「返回列表」同一水平线（垂直居中），两者留 5vp 间距
      Row({ space: 5 }) {
        // 箭头单独放大：‹ 字符在小字号下视觉偏小；字形基线偏低，上移 1vp 与文字看齐
        Text('‹')
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor('#2E6BE6')
          .translate({ y: -1 })
        Text('返回列表')
          .fontSize(15)
          .fontColor('#2E6BE6')
        Blank()
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)
      .padding({ left: 5, top: 2, bottom: 8 })
      .onClick(() => {
        this.backTeamPreview();
      })
      Text(this.teamPreviewTitle)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .padding({ left: 5, bottom: 4 })
      Text('只读记录，不会切换当前对话或发送任务')
        .fontSize(11.5)
        .fontColor(this.subColor())
        .width('100%')
        .padding({ left: 5, bottom: 10 })
      if (this.teamPreviewLoading) {
        Text('正在加载记录…')
          .fontSize(13)
          .fontColor(this.subColor())
          .width('100%')
          .padding({ left: 5, top: 12 })
      } else if (this.teamPreviewError.length > 0) {
        Text(this.teamPreviewError)
          .fontSize(13)
          .fontColor(this.subColor())
          .width('100%')
          .padding({ left: 5, top: 12 })
      } else {
        Column() {
          ForEach(this.teamPreviewRows, (row: TeamPreviewRow, index: number) => {
            Column({ space: 4 }) {
              Text(row.role)
                .fontSize(11)
                .fontColor(this.subColor())
                .width('100%')
              Text(row.text)
                .fontSize(14)
                .fontColor(this.textColor())
                .width('100%')
                .copyOption(CopyOptions.LocalDevice)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ left: 16, right: 16, top: 10, bottom: 10 })
            if (index < this.teamPreviewRows.length - 1) {
              Row() {
                Row()
                  .width('100%')
                  .height(0.5)
                  .backgroundColor(this.dividerColor())
              }
              .width('100%')
              .padding({ left: 16 })
            }
          }, (row: TeamPreviewRow) => row.key)
        }
        .width('100%')
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.50)')
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.80)' })
        .borderRadius(16)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  /** 成员行：彩色头像 + 名字 + 实时状态 + 描述（行样式对齐首页「切换主机」名单）。 */
  @Builder
  teamMemberRow(member: TeamMemberView) {
    Row({ space: 12 }) {
      Image(this.teamAvatarResource(member.avatarIndex))
        .width(36)
        .height(36)
        .borderRadius(18)
        .objectFit(ImageFit.Contain)
      Column({ space: 2 }) {
        Row({ space: 6 }) {
          Text(this.teamMemberName(member))
            .fontSize(16)
            .fontColor(this.textColor())
            // 名字占满剩余宽度并省略，否则「当前」徽标会被挤出到右侧状态圆点上
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (member.id === this.teamSelectedId()) {
            Text('当前')
              .fontSize(10.5)
              .fontWeight(FontWeight.Medium)
              .flexShrink(0)
              .fontColor('#2E6BE6')
              .backgroundColor('rgba(46,107,230,0.12)')
              .borderRadius(999)
              .height(16)
              .padding({ left: 6, right: 6 })
              .textAlign(TextAlign.Center)
          }
        }
        .width('100%')
        Text(this.teamMemberSubtitle(member))
          .fontSize(12.5)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        if (member.error.length > 0 || member.description.length > 0) {
          Text(member.error.length > 0 ? member.error : member.description)
            .fontSize(12)
            .fontColor(member.error.length > 0 ? '#D65D64' : this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Circle({ width: 8, height: 8 }).fill(this.teamStatusDotColor(member))
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 10, bottom: 10 })
    .opacity(member.canOpen ? 1 : 0.55)
    .onClick(() => {
      if (member.canOpen) {
        // 只读预览，不切走当前对话（对齐小程序）
        this.openTeamPreview(member);
      }
    })
  }

  /** 任务筛选分段（对齐 iOS Picker segmented：全部 / 当前成员 / 未分配）。 */
  @Builder
  teamFilterChip(id: string, label: string) {
    Text(label)
      .fontSize(12)
      .fontWeight(this.teamTaskFilter === id ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(this.teamTaskFilter === id ? this.textColor() : this.subColor())
      .layoutWeight(1)
      .height(30)
      .textAlign(TextAlign.Center)
      .borderRadius(7)
      .backgroundColor(this.teamTaskFilter === id
        ? (this.isDark ? 'rgba(255,255,255,0.14)' : Color.White)
        : Color.Transparent)
      .onClick(() => {
        this.teamTaskFilter = id;
      })
  }

  /** 共享任务卡片：点卡片展开/收起，点负责人切到负责人会话。 */
  @Builder
  teamTaskCard(task: TeamTaskView) {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Text(task.subject.length > 0 ? task.subject : task.id)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 5 }) {
          Circle().width(7).height(7).fill(this.teamStatusColor(task.status))
          Text(this.teamStatusLabel(task.status))
            .fontSize(11)
            .fontColor(this.subColor())
        }
      }
      .width('100%')
      if (task.description.length > 0) {
        Text(task.description)
          .fontSize(12)
          .fontColor(this.subColor())
          .maxLines(this.teamTaskExpanded(task.id) ? 30 : 2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      Row() {
        Text(task.id)
          .fontSize(10)
          .fontFamily('monospace')
          .fontColor(this.subColor())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.teamTaskExpanded(task.id) ? '收起' : '展开')
          .fontSize(11)
          .fontColor(this.subColor())
      }
      .width('100%')
      Row({ space: 8 }) {
        Text('负责人：' + this.teamOwnerLabel(task))
          .fontSize(11)
          .fontColor(this.teamOwnerMember(task) !== undefined ? '#2E6BE6' : this.subColor())
      }
      .width('100%')
      .onClick(() => {
        const owner: TeamMemberView | undefined = this.teamOwnerMember(task);
        if (owner !== undefined && owner.canOpen) {
          this.selectTeamMember(owner.id);
        }
      })
      if (this.teamTaskExpanded(task.id) && task.blockedBy.length > 0) {
        Text('依赖：' + this.teamBlockedLabel(task))
          .fontSize(11)
          .fontColor(this.subColor())
          .width('100%')
      }
    }
    .width('100%')
    .padding(14)
    .borderRadius(16)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.50)')
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.80)' })
    .onClick(() => {
      this.toggleTeamTask(task.id);
    })
  }

  /** 团队内容面板：成员 + 共享任务（样式对齐首页「切换主机」弹窗：拖动条 + 分组卡片）。 */
  @Builder
  teamSheetContent() {
    Column({ space: 0 }) {
      // 顶部拖动条
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)

      // 标题行：只保留居中标题（右上角不再放「完成」）
      Row() {
        Text(this.teamMembers.length > 1 ? '智能体团队' : '子智能体')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .width('100%')
      .height(48)
      .justifyContent(FlexAlign.Center)

      Scroll() {
        Column() {
          if (this.teamPreviewActive) {
            this.teamPreviewPanel()
          } else {
          Text(this.teamLeadTitle())
            .fontSize(14)
            .fontColor(this.subColor())
            .maxLines(2)
            .width('100%')
            .padding({ left: 19, top: 4, bottom: 4 })
          if (this.teamMembers.length <= 1) {
            Text('当前会话使用普通子智能体')
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 19, bottom: 4 })
          }
          if (this.teamFailure.length > 0) {
            Text(this.teamFailure)
              .fontSize(12)
              .fontColor('#E08A00')
              .width('100%')
              .padding({ left: 19, top: 2, bottom: 4 })
          }

          Text('成员 ' + this.teamMembers.length)
            .fontSize(14)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 19, top: 16, bottom: 6 })
          Column() {
            ForEach(this.teamMembers, (member: TeamMemberView, index: number) => {
              this.teamMemberRow(member)
              if (index < this.teamMembers.length - 1) {
                Row() {
                  Row()
                    .width('100%')
                    .height(0.5)
                    .backgroundColor(this.dividerColor())
                }
                .width('100%')
                .padding({ left: 16 })
              }
            }, (member: TeamMemberView) => 'sheet-' + member.id)
          }
          .width('100%')
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.50)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.80)' })
          .borderRadius(16)

          Text('共享任务 ' + this.teamTasks.length)
            .fontSize(14)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 19, top: 16, bottom: 6 })
          Row() {
            this.teamFilterChip('all', '全部')
            this.teamFilterChip('current', '当前成员')
            this.teamFilterChip('unassigned', '未分配')
          }
          .width('100%')
          .padding(2)
          .borderRadius(9)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)')
          .margin({ bottom: 8 })

          if (this.teamFilteredTasks().length === 0) {
            Text(this.teamEmptyTaskHint())
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ top: 4, bottom: 8 })
          }
          ForEach(this.teamFilteredTasks(), (task: TeamTaskView) => {
            Column() {
              this.teamTaskCard(task)
            }
            .width('100%')
            .margin({ bottom: 8 })
          }, (task: TeamTaskView) => 'sheet-task-' + task.id)
          }
        }
        .width('100%')
        .padding({ left: 14, right: 14, bottom: 16 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding({ bottom: 8 })
  }

  /**
   * 触顶自动加载更早记录（替代原来的「加载更早记录」按钮）：
   * 只有用户真的往上滑到顶部才触发，避免列表重建导致的 onReachStart 误触发；
   * olderLoading 挡住连续触发，加载完若仍贴着顶部，下一次滑动会继续往前翻。
   */
  private maybeLoadOlder(): void {
    if (!this.hasMoreHistory || this.entries.length === 0 || this.olderLoading) {
      return;
    }
    const now: number = Date.now();
    const userDriven: boolean = this.listTouching || (now - this.lastUserScrollAt) < 1500;
    if (!userDriven) {
      return;
    }
    this.olderLoading = true;
    setTimeout(() => {
      // 自动加载不弹「没有更早记录了」的提示：滚到顶本来就可能已经没有更早的内容
      const sent: boolean = SessionStore.get().loadOlder();
      Logger.info('auto load older sent=' + sent + ' hasMore=' + this.hasMoreHistory);
      this.olderLoading = false;
    }, 80);
  }

  /** 按扩展名判断图片附件：图片走缩略图，其它走回形针文件胶囊 */
  /** 图片扩展名 → mediaType（网关 images[] 必填） */
  private imageMediaTypeOf(name: string): string {
    const lower: string = name.toLowerCase();
    const dot: number = lower.lastIndexOf('.');
    const ext: string = dot >= 0 ? lower.substring(dot + 1) : '';
    if (ext === 'png') {
      return 'image/png';
    }
    if (ext === 'gif') {
      return 'image/gif';
    }
    if (ext === 'webp') {
      return 'image/webp';
    }
    if (ext === 'bmp') {
      return 'image/bmp';
    }
    if (ext === 'heic' || ext === 'heif') {
      return 'image/heic';
    }
    return 'image/jpeg';
  }

  /**
   * 图片附件 → { mediaType, data(base64), name }。
   * 走网关 images[] 而不是上传回执：host 只把 type=image 块计入会话引用，
   * file 块按 attachmentId 回读会被拒（Image is not referenced by this session）。
   */
  private imagePayloadOf(att: PickedAttachment): Object | undefined {
    try {
      const raw: string = att.uri.startsWith('file://') ? att.uri.substring(7) : att.uri;
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
        const payload: ImagePayload = { mediaType: this.imageMediaTypeOf(att.name), data: encoded, name: att.name };
        return payload as Object;
      } finally {
        fileIo.closeSync(source);
      }
    } catch (err) {
      Logger.warn('[SEND] image payload failed ' + att.name + ' '
        + (err instanceof Error ? err.message : String(err)));
      return undefined;
    }
  }

  private isImageAttachment(name: string): boolean {
    const lower: string = name.toLowerCase();
    return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') ||
      lower.endsWith('.webp') || lower.endsWith('.heic') || lower.endsWith('.heif') ||
      lower.endsWith('.gif') || lower.endsWith('.bmp');
  }

  /**
   * 已选附件预览（对齐小程序 composer-images / pending-file，也与 iOS 附件托盘一致）：
   *   · 图片 → 52×52 缩略图卡（10 圆角）
   *   · 文件 → 回形针图标 + 文件名胶囊
   *   · 两者右上角都有圆形删除钮（不再点整块误删）
   */
  @Builder
  attachmentStrip() {
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
                // 点缩略图看大图（对齐小程序 composer 缩略图预览）
                .onClick(() => {
                  this.previewImagePath = attachment.uri;
                  this.previewImageOpen = true;
                })
            } else {
              Row({ space: 5 }) {
                SymbolGlyph($r('sys.symbol.paperclip'))
                  .fontSize(13)
                  .fontColor([this.subColor()])
                Text(attachment.name)
                  .fontSize(12)
                  .fontColor(this.textColor())
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
            // 右上角圆形删除钮（半透明黑底 + 白 ×）
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
            .margin({ top: -3, right: -3 })
            .onClick(() => {
              this.pickedAttachments = this.pickedAttachments.filter((item: PickedAttachment) => item.uri !== attachment.uri);
            })
          }
        }, (attachment: PickedAttachment) => attachment.uri)
        if (this.attachmentHint.length > 0) {
          Text(this.attachmentHint).fontSize(11).fontColor(this.subColor())
        }
      }
      .padding({ left: 16, right: 16, top: 4, bottom: 4 })
    }
    .width('100%')
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .align(Alignment.Start)
  }

  /** 时间线：LazyForEach + 吸底跟随 + 回到底部。 */
  @Builder
  timeline() {
    // Stack 不支持 layoutWeight，因此高度由外层 Column 的 layoutWeight 承担，
    // 这里给 Stack 显式 height('100%') 才能让内部 List 撑满。
    Stack({ alignContent: Alignment.Bottom }) {
      if (this.entries.length === 0 && this.historyLoading) {
        // 有历史记录的会话：首屏历史还没到，显示加载骨架（对齐小程序 conv-skeleton），
        // 不能把「新建会话」的居中空态闪出来。
        Column({ space: 10 }) {
          Row()
            .width(180)
            .height(12)
            .borderRadius(6)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)')
          Row()
            .width('86%')
            .height(12)
            .borderRadius(6)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.045)')
          Row()
            .width('64%')
            .height(12)
            .borderRadius(6)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.045)')
          LoadingProgress()
            .width(20)
            .height(20)
            .color(this.subColor())
            .margin({ top: 8 })
          Text('正在加载会话记录…')
            .fontSize(12)
            .fontColor(this.subColor())
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .padding({ left: 40, right: 40 })
        .zIndex(1)
      } else if (this.entries.length === 0) {
        // 空会话：整块在时间线区域内垂直居中（对齐 spec §1.6 的空会话态）
        Column({ space: 8 }) {
          // 空会话态：品牌硬币（可拖动翻转），放在标题上方
          FluKeCoin({ diameter: 64 })
            .margin({ bottom: 18 })
          Text('操作远端 DSH Agent')
            .fontSize(18)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Text('发送任务后，工具调用、推理进度和最终回复会通过 Mobile Gateway 实时返回。')
            .fontSize(13)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
        // 空会话时 List 仍然铺满整块区域，会盖在这层上面把拖动吃掉（硬币拖不动）。
        // 提到 List 之上，硬币才能收到手势。
        .zIndex(1)
      }
      // 时间线滚动视口：Refresh/List 对 padding 不生效，用外层 Column 的 padding 把可视区裁到输入框底边
      Column() {
        Refresh({ refreshing: $$this.refreshing, builder: this.emptyRefreshIndicator() }) {
      List({ space: 0, scroller: this.scroller }) {
        // 下拉刷新时在列表顶部插一条紧凑指示器：紧贴正文，不依赖系统指示器位置
        if (this.refreshing) {
          ListItem() {
            this.refreshIndicator()
          }
          .width('100%')
        }
        // 顶部占位：给浮动顶栏让出高度；往上滚时这段空白先滑走，内容直接从标题下面穿过
        ListItem() {
          Column()
            .width('100%')
            .height(64 + this.topSafe())
        }
        // 用普通 ForEach（非虚拟列表）渲染时间线：
        // LazyForEach 在本机不会因「行内数组被替换」而重建该行 —— 组头能刷新、组体新步骤不出现。
        // 时间线窗口只有最近几十行，普通 ForEach 每次重建代价可控，但能保证 100% 实时。
        ForEach(this.entries, (entry: ConversationFeedEntryModel) => {
          ListItem() {
            ConversationRowView({
              entry: entry,
              procIconStyle: this.procIconStyle,
              stepOpenIds: this.stepOpenIds,
              stepClosedIds: this.stepClosedIds,
              reasonFullIds: this.reasonFullIds,
              workStepMode: this.workStepMode,
              liveFoldOpen: this.liveFoldOpenIds.has(entry.id),
              onToggleLiveFold: () => {
                if (this.liveFoldOpenIds.has(entry.id)) {
                  this.liveFoldOpenIds.delete(entry.id);
                } else {
                  this.liveFoldOpenIds.add(entry.id);
                }
                // Set 的增删不会通知 UI，行内的 @Prop liveFoldOpen 也不会自己更新：
                // 必须换一个数组引用让 ForEach 重跑（key 里带折叠位），这一行才会重建、
                // 拿到新的 liveFoldOpen 并把被折叠的前缀步骤铺出来。
                // 之前只 scheduleTimelineUpdate：entries 引用没变、行数也没变，
                // rebuild 提前 return —— 于是「点计数折叠行完全没反应」。
                this.entries = this.entries.slice();
                this.scheduleTimelineUpdate();
              },
              onToggleReasonFull: (id: string) => {
                this.onToggleReasonFull(id);
              },
              onToggleReasonCard: (id: string) => {
                this.onToggleReasonCard(id);
              },
              onToggle: (id: string) => {
                this.onToggleEntry(id);
              },
              onToggleStep: (id: string) => {
                this.onToggleStep(id);
              },
              onCopy: (text: string) => {
                this.onCopyEntry(text);
              },
              onShowDetail: (title: string, body: string) => {
                this.onShowDetail(title, body);
              },
              // 本地图由行内 entry.localImages 提供；这里只传下载好的附件图，避免同一张图重复一条
              imagePaths: this.imagePathsFor(entry.id),
              onRetryImages: () => {
                this.retryImages(entry.id);
              },
              onImageTap: (path: string) => {
                this.previewImagePath = path;
                this.previewImageList = [];
                this.previewImageIndex = 0;
                this.previewImageOpen = true;
              },
              onImageListTap: (paths: string[], index: number) => {
                this.openImagePreviewList(paths, index);
              },
              onQuoteReply: (text: string) => {
                this.quoteReply(text);
              },
              onReplyLongPress: (text: string) => {
                this.replySheetText = text;
                this.replySheetOpen = true;
              },
              onImagePathTap: (path: string) => {
                this.openHostImage(path);
              },
              onMarkdownLink: (text: string, href: string) => {
                this.openMarkdownLink(text, href);
              },
              turnUsageDetail: entry.turnUsageDetail,
              turnUsageTotal: entry.turnUsageTotal,
              turnUsageRows: entry.turnUsageRows,
              onTurnUsage: (turnKey: string) => {
                // 兜底：行内没有明细时（老数据）用轻提示给出结论
                this.hint = SessionStore.get().turnUsageDetail(turnKey).split('\n').join(' · ');
              },
              attachmentChips: this.attachmentChipsOf(entry).concat(this.inlineAssistantAttachments.get(entry.id) ?? []),
              onAttachmentTap: (name: string, path: string, mediaType: string) => {
                this.openMessageAttachment(name, path, mediaType);
              },
              fileCards: this.inlineAssistantFiles.get(entry.id) ?? this.fileCardsOf(entry),
              filesInline: this.inlineAssistantFiles.has(entry.id),
              reasonFollowPaused: this.reasonFollowPausedIds.has(entry.id),
              onToggleReasonFollow: () => {
                if (this.reasonFollowPausedIds.has(entry.id)) {
                  this.reasonFollowPausedIds.delete(entry.id);
                } else {
                  this.reasonFollowPausedIds.add(entry.id);
                }
                this.scheduleTimelineUpdate();
              },
              onFileTap: (name: string, path: string, index: number, hasCounts: boolean) => {
                // 内联在助手回复里的「已编辑文件」卡片：按该轮的变更 seq 拉差异弹窗
                const inlineSeq: number | undefined = this.inlineChangeSeqByAssistant.get(entry.id);
                if (inlineSeq !== undefined && inlineSeq > 0) {
                  this.openChangedFileDiffSeq(inlineSeq, index);
                } else if (entry.kind === 'CHANGES' && hasCounts) {
                  this.openChangedFileDiff(entry, index);
                } else {
                  this.openFileContent(name, path, '');
                }
              }
            })
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }, (entry: ConversationFeedEntryModel) =>
          entry.id + '#' + entry.itemsRevision.toString() + '#' + entry.text.length.toString()
          + '#' + (this.inlineAssistantFiles.get(entry.id) ?? []).length.toString()
          + '#' + (this.inlineAssistantFiles.get(entry.id)?.length ? this.inlineAssistantFiles.get(entry.id)![0].length.toString() : '0')
          // 折叠条展开状态参与 key：否则页面状态变了但 ForEach 复用旧行，@Prop 不更新 → 点了没反应
          + '#' + (this.liveFoldOpenIds.has(entry.id) ? '1' : '0'))
        // 运行状态条（鲸尾图标行）：与执行图标行同属内容流，跟随时间线滚动（不固定）。
        if (this.progressLabel.length > 0 && this.entries.length > 0) {
          ListItem() {
            ConversationProgress({
              appearance: this.statusAppearance,
              label: this.progressLabel,
              expandable: this.runningProcessId().length > 0,
              onTap: () => {
                this.toggleRunningProcess();
              }
            })
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }



      }
      .id('conversation-list')
      .width('100%')
      .height('100%')
      .cachedCount(8)
      .scrollBar(BarState.Off)
      // 列表底边已裁到输入框底边，末尾只留出「最后一条停在输入框上沿」的余量：
      // 滚到底时最后一条消息完整可见，不用再滑到列表最末尾。
      .contentEndOffset(this.timelineEndOffset())
      // 运行条放在 List 之外（Stack 底部、列表下方）：以前它是 List 的最后一个 ListItem，
      // 列表任何一次结构变化都会把它卸掉再装回去 —— 表现就是「运行态不显示 / 只有页面在闪」。
      // 现在它独立于列表存在，运行状态一置位就稳定显示，列表怎么重建都不影响。
      .onTouch((event: TouchEvent) => {
        // 只记录触摸，不在这里改 autoStick：轻点某行不应该打断跟随
        if (event.type === TouchType.Down) {
          this.listTouching = true;
          this.listTouchStartedAt = Date.now();
          // 手指落在对话内容上 = 点输入框以外 → 收起输入条。
          // 用 onTouch 而不是 onClick：列表里很多子节点（消息卡片、按钮）会把点击吃掉，
          // 外层 Column 的 onClick 收不到，这就是「点了外面不折叠」的原因。
          this.collapseComposer();
        } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
          this.listTouching = false;
          this.lastTouchAt = Date.now();
          // 拖动期间攒下的结构变化，抬手后再重建
          if (this.pendingStructure) {
            this.pendingStructure = false;
            this.scheduleTimelineUpdate();
          }
        }
      })
      .onScrollStart(() => {
        // 只有「手指真的按在列表上」才算用户拖动。
        // 程序化吸底、惯性滑动、重建重排都会触发 onScrollStart，
        // 以前据此关掉跟随，第一次自动滚到底就把跟随永久关了（这就是「不跟随」的根因）。
        if (!this.listTouching) {
          return;
        }
        this.autoStick = false;
        this.lastUserScrollAt = Date.now();
      })
      .onReachStart(() => {
        // 滑到顶部自动往前翻一页历史（原来这里是一颗「加载更早记录」按钮）
        this.maybeLoadOlder();
      })
      .onScrollIndex((start: number, end: number) => {
        // 记录最后一条可见行：只凭它判断「用户真的滑到底了」
        this.lastVisibleEnd = end;
        // 用真实滚动位置判断是否在底部（行数少时行下标不可靠）
        let atEnd: boolean = false;
        try {
          atEnd = this.scroller.isAtEnd();
        } catch (err) {
          atEnd = false;
        }
        if (this.entries.length > 0 && atEnd) {
          this.autoStick = true;
        } else if (this.listTouching) {
          this.autoStick = false;
        }
        this.maybeResumeAutoStick();
      })
      .onReachEnd(() => {
        // 只有「用户自己滑到底」才恢复吸底。流式期间内容不断增长、列表重建也会触发 reachEnd，
        // 若据此恢复吸底，用户往上看的历史会被立刻拽回底部（表现就是「运行时滑不动」）。
        this.maybeResumeAutoStick();
      })
      }
      .refreshOffset(0)
      .pullDownRatio(0.4)
      .onRefreshing(() => {
        // 下拉刷新：连续加载更早历史，直到列表最上面是一条「用户消息」为止
        // （否则分页会停在助手回复中间，看着像内容缺失）
        this.refreshing = true;
        this.pullLoadAttempts = 0;
        this.pullLoadToTurnBoundary();
      })
      .width('100%')
      .height('100%')
      }
      .width('100%')
      .height('100%')
      // 可视区底边 = 输入框底边：再往下的文字不显示
      .padding({ bottom: this.timelineClipBottom() })
      .alignItems(HorizontalAlign.Start)

      // 输入框左右下角防漏：把圆角缺口/边槽里露出的时间线文字挡住（只占底部 28vp，不影响列表滑动）
      Row() {
        Column()
          .width(this.cornerMaskWidth())
          .height(this.composerCornerRadius())
          .backgroundColor(this.pageBg())
        Blank()
        Column()
          .width(this.cornerMaskWidth())
          .height(this.composerCornerRadius())
          .backgroundColor(this.pageBg())
      }
      .width('100%')
      .height(this.composerCornerRadius())
      .margin({ bottom: this.cornerMaskBottomMargin() })
      .hitTestBehavior(HitTestMode.None)

      if (!this.autoStick && this.entries.length > 0) {
        // 回到底部：圆形按钮，玻璃背板走 HdsTabs 悬浮 Bar（与输入条同一套 systemMaterialEffect），
        // 本体只做透明可点层 + 箭头。
        Row() {
          Stack({ alignContent: Alignment.Center }) {
            this.hdsGlassBackplate(40, 40)
            Button({ type: ButtonType.Circle }) {
              // 向下箭头：右 + 下 1.8vp 描边旋转 45°
              Row()
                .width(8)
                .height(8)
                .border({
                  width: { right: 1.8, bottom: 1.8 },
                  color: this.isDark ? 'rgba(255,255,255,0.86)' : 'rgba(16,19,24,0.72)'
                })
                .rotate({ angle: 45 })
                .translate({ y: -1.5 })
            }
            .width(40)
            .height(40)
            .buttonStyle(ButtonStyleMode.NORMAL)
            .backgroundColor('#00000000')
            .onClick(() => {
              this.autoStick = true;
              this.scroller.scrollEdge(Edge.Bottom);
            })
          }
          .width(40)
          .height(40)
          .borderRadius(20)
          .shadow({ radius: 14, color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)', offsetX: 0, offsetY: 6 })
        }
        .width('100%')
        // 回到底部按钮同样避让底部 dock，显示在输入框上方
        .padding({ bottom: this.dockHeight + 10, right: 14 })
        .justifyContent(FlexAlign.End)
      }
    }
    .width('100%')
    .height('100%')
  }

  // ==================== 会话节点（移植自小程序 turnNav，弹窗样式对齐原生菜单） ====================

  /** 收集用户消息节点：一条用户消息即一个节点 */
  private buildTurnNodes(): TurnNode[] {
    const nodes: TurnNode[] = [];
    for (let index = 0; index < this.entries.length; index++) {
      const entry: ConversationFeedEntryModel = this.entries[index];
      if (entry.kind !== 'USER') {
        continue;
      }
      const raw: string = (entry.text.length > 0 ? entry.text : entry.title).replace(/\s+/g, ' ').trim();
      nodes.push({ entryIndex: index, ordinal: nodes.length + 1, label: raw.length > 0 ? raw : '（空消息）' });
    }
    return nodes;
  }

  private openTurnNav(): void {
    this.turnBarOffset = 0;
    this.refreshTurnNodes(true);
    this.turnNavOpen = true;
    this.scrollTurnListTo(this.turnNodeIndex);
    // 节点要显示全部轮次：弹层打开期间补拉更早历史；期间不刷新时间线，页面不会跳动
    this.warmHistoryForTurnNav();
  }

  /**
   * 展开胶囊期间持续自愈：只要还有更早历史且当前没在拉，就再拉一轮。
   * 覆盖两种情况：① 展开时首屏历史还没落地（oldestSeq/hasMore 未知，warmup 直接退出）；
   * ② 某一页偶发失败导致本轮中断。
   */
  private scheduleWarmupRetry(): void {
    if (this.warmupRetryTimer >= 0) {
      return;
    }
    this.warmupRetryTimer = setTimeout(() => {
      this.warmupRetryTimer = -1;
      if (!this.turnNavOpen && !this.turnNavMenuOpen && !this.capsuleExpanded) {
        return;
      }
      const store: SessionStore = SessionStore.get();
      Logger.info('[TurnNavWarmup] tick hasOlder=' + (store.hasOlderHistory() ? '1' : '0') +
        ' pending=' + (store.isOlderRequestPending() ? '1' : '0') +
        ' running=' + (this.turnNavWarmupRunning ? '1' : '0') +
        ' nodes=' + this.turnNodes.length.toString());
      if (!this.turnNavWarmupRunning && store.hasOlderHistory()) {
        this.warmHistoryForTurnNav();
      }
      if (store.hasOlderHistory() || store.isOlderRequestPending()) {
        this.scheduleWarmupRetry();
      }
    }, 1200);
  }

  /**
   * 把更早历史拉完，节点数覆盖所有轮次（时间线暂不重排）。
   * 触发时机：① 折叠把手展开成胶囊时就预热；② 弹层打开期间继续补拉。
   * 这样点开弹层时数据已经就绪，不用当场等。
   */
  private async warmHistoryForTurnNav(): Promise<void> {
    if (this.turnNavWarmupRunning) {
      return;
    }
    this.turnNavWarmupRunning = true;
    const store: SessionStore = SessionStore.get();
    Logger.info('[TurnNavWarmup] start hasOlder=' + (store.hasOlderHistory() ? '1' : '0') +
      ' pending=' + (store.isOlderRequestPending() ? '1' : '0') + ' nodes=' + this.turnNodes.length.toString());
    // 批量模式：每页只合并事件，结束时统一重投影一次（长会话否则每页都要全量重投影，很慢）
    store.beginBulkOlder();
    let guard: number = 0;
    // 一页一页连着拉：等上一页真正落地就立刻发下一页，不再固定 sleep 180ms。
    // 之前固定 180ms 会在「响应比 180ms 慢」时被 loadOlder 的 pending 判断打断，
    // 一次展开只能拉一页，看起来就是要点好几次才能加载完。
    let stuck: number = 0;
    try {
    while (guard < 60 && (this.turnNavOpen || this.turnNavMenuOpen || this.capsuleExpanded) && store.hasOlderHistory()) {
      if (store.isOlderRequestPending()) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 16);
        });
        continue;
      }
      if (!store.loadOlder(true)) {
        // 拉不到（暂无更多/游标异常）：留一次重试机会，避免偶发失败就停
        stuck += 1;
        if (stuck >= 3) {
          break;
        }
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 400);
        });
        continue;
      }
      stuck = 0;
      guard += 1;
      // 等这一页落地（最多 8s；store 侧 15s 超时兜底会放掉 pending）
      let waited: number = 0;
      while (store.isOlderRequestPending() && waited < 8000) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 16);
        });
        waited += 16;
      }
      Logger.info('[TurnNavWarmup] page done guard=' + guard + ' pending=' + (store.isOlderRequestPending() ? '1' : '0') +
        ' hasOlder=' + (store.hasOlderHistory() ? '1' : '0') + ' nodes=' + this.turnNodes.length.toString());
      // 每加载一页就刷新节点数：胶囊上的 N/总数、弹层列表都跟着更新
      this.refreshTurnNodes(this.turnNavOpen);
    }
    } catch (err) {
      Logger.warn('[TurnNavWarmup] loop failed: ' + String(err));
    }
    this.turnNavWarmupRunning = false;
    store.endBulkOlder();
    Logger.info('[TurnNavWarmup] end guard=' + guard + ' hasOlder=' + (store.hasOlderHistory() ? '1' : '0') +
      ' pending=' + (store.isOlderRequestPending() ? '1' : '0') + ' nodes=' + this.turnNodes.length.toString());
    if (this.turnNavOpen) {
      this.refreshTurnNodes(true);
      this.scrollTurnListTo(this.turnNodeIndex);
    }
    // 还有没拉完的（首屏晚到/失败自愈）：展开期间继续安排下一轮
    if (store.hasOlderHistory() && (this.turnNavOpen || this.turnNavMenuOpen || this.capsuleExpanded)) {
      this.scheduleWarmupRetry();
    }
  }

  /** 预热/弹层期间的改动先记账，等胶囊收起或弹层关闭后再一次性重排 */
  private flushTimelineAfterWarmup(): void {
    if (this.turnNavOpen || this.turnNavMenuOpen || this.capsuleExpanded) {
      return;
    }
    this.rebuildEntries();
    this.refreshTurnNodes(false);
    this.refreshProgress();
    this.scheduleTimelineUpdate();
  }

  /** 关闭弹层：把补拉期间累积的变化一次性重排回去 */
  private closeTurnNav(): void {
    if (!this.turnNavOpen) {
      return;
    }
    this.turnNavOpen = false;
    this.turnBarOffset = 0;
    this.rebuildEntries();
    this.refreshProgress();
    this.scheduleTimelineUpdate();
  }

  /**
   * 预热/弹层期间的轻量节点预览：直接扫原始 items 里的用户轮次，
   * 不碰时间线（不重建列表就绝不会闪屏），只让胶囊上的数字变化。
   * entryIndex 先记 -1，真正跳转时再按 ordinal 映射到时间线行。
   */
  private applyTurnNodesPreview(): void {
    const nodes: TurnNode[] = [];
    for (const item of this.items) {
      if (item.kind !== ConversationItemKind.USER) {
        continue;
      }
      const raw: string = (item.text.length > 0 ? item.text : item.title).replace(/\s+/g, ' ').trim();
      nodes.push({ entryIndex: -1, ordinal: nodes.length + 1, label: raw.length > 0 ? raw : '（空消息）' });
    }
    this.turnNodes = nodes;
    if (this.turnNodeIndex >= nodes.length) {
      this.turnNodeIndex = nodes.length > 0 ? nodes.length - 1 : 0;
    }
  }

  /** 重建节点列表；keepSelection=true 时把选中项落到最后一条 */
  private refreshTurnNodes(keepSelection: boolean): void {
    const nodes: TurnNode[] = this.buildTurnNodes();
    this.turnNodes = nodes;
    if (keepSelection || this.turnNodeIndex >= nodes.length) {
      this.turnNodeIndex = nodes.length > 0 ? nodes.length - 1 : 0;
    }
  }

  private scrollTurnListTo(index: number): void {
    setTimeout(() => {
      try {
        this.turnListScroller.scrollToIndex(index, true, ScrollAlign.CENTER);
      } catch (ignored) {
      }
    }, 16);
  }

  /** 预览某个节点：左侧列表滚到该节点（不跳转时间线） */
  private previewTurnNode(index: number): void {
    const count: number = this.turnNodes.length;
    if (count === 0) {
      return;
    }
    const clamped: number = Math.max(0, Math.min(count - 1, index));
    if (clamped === this.turnNodeIndex) {
      return;
    }
    this.turnNodeIndex = clamped;
    // 每切换一个节点给一次触感（强度跟随「设置 → 震动反馈」）
    Haptics.play();
    this.scrollTurnListTo(clamped);
  }

  /** 点击节点：关闭弹层并跳到时间线对应消息 */
  private jumpToTurnNode(index: number): void {
    if (index < 0 || index >= this.turnNodes.length) {
      return;
    }
    const target: TurnNode = this.turnNodes[index];
    this.closeTurnNav();
    // 列表头部只有一条给浮动顶栏让位的占位行（加载更早记录按钮已去掉）
    const offset: number = 1;
    this.autoStick = false;
    // 预热期间节点来自原始 items（entryIndex = -1）：先把时间线补出来，再按序数映射到行
    if (target.entryIndex < 0) {
      this.rebuildEntries();
      const resolved: TurnNode[] = this.buildTurnNodes();
      if (target.ordinal > 0 && target.ordinal <= resolved.length) {
        target.entryIndex = resolved[target.ordinal - 1].entryIndex;
      }
    }
    const targetIndex: number = offset + (target.entryIndex >= 0 ? target.entryIndex : 0);
    setTimeout(() => {
      try {
        this.scroller.scrollToIndex(targetIndex, true, ScrollAlign.START);
      } catch (ignored) {
      }
    }, 30);
  }

  private backToTimelineBottom(): void {
    this.closeTurnNav();
    this.autoStick = true;
    this.scroller.scrollEdge(Edge.Bottom);
  }

  /** 拨动右侧卡带：位移换算成节点下标并预览 */
  private scrubTurnNode(offsetY: number): void {
    const count: number = this.turnNodes.length;
    if (count <= 1 || this.turnTrackHeight <= 0) {
      return;
    }
    const step: number = (TURN_TRACK_HEIGHT - TURN_THUMB_HEIGHT) / (count - 1);
    const delta: number = Math.round(offsetY / step);
    this.previewTurnNode(this.turnScrubStartIndex + delta);
  }

  /** 卡带上滑块的位置 */
  private turnThumbTop(): number {
    const count: number = this.turnNodes.length;
    if (count <= 1 || this.turnTrackHeight <= 0) {
      return 0;
    }
    const usable: number = Math.max(0, TURN_TRACK_HEIGHT - TURN_THUMB_HEIGHT);
    return usable * (this.turnNodeIndex / (count - 1));
  }

  /** 握姿变化：稳定 500ms 后再切换，且带补间动画，避免生硬跳变 */
  private onHoldingHand(): void {
    if (this.holdTimer >= 0) {
      clearTimeout(this.holdTimer);
      this.holdTimer = -1;
    }
    this.holdTimer = setTimeout(() => {
      this.holdTimer = -1;
      const side: string = this.holdingHand === HoldingHand.LEFT ? 'left' : 'right';
      if (side === this.capsuleSide) {
        return;
      }
      animateTo({ duration: 280, curve: Curve.EaseInOut }, () => {
        this.capsuleSide = side;
        this.capsuleDragX = 0;
      });
    }, 500);
  }

  /** 胶囊宽度（展开 36 / 折叠 12） */
  private capsuleWidth(): number {
    return this.capsuleExpanded ? TURN_TRACK_WIDTH : 12;
  }

  /** 胶囊左上角坐标：展开时离边 10，折叠后贴边（0）露出细把手，不挡视线 */
  private capsuleX(): number {
    const edge: number = this.capsuleExpanded ? 10 : 0;
    return this.capsuleSide === 'left'
      ? edge + this.capsuleDragX
      : this.pageW - edge - this.capsuleWidth() + this.capsuleDragX;
  }

  private capsuleY(): number {
    const height: number = this.capsuleExpanded ? TURN_TRACK_HEIGHT : 56;
    const centerY: number = this.pageH > 0 ? this.pageH * 0.42 : 240;
    const top: number = this.topSafe() + 12;
    const bottom: number = (this.pageH > 0 ? this.pageH : 800) - height - this.bottomInset - 12;
    const wanted: number = centerY - height / 2 + this.capsuleYOffset;
    return Math.max(top, Math.min(bottom, wanted));
  }

  /** 拖动结束：越过阈值就吸附到对应边并折叠，否则回弹 */
  private settleCapsule(offsetX: number): void {
    const threshold: number = 30;
    if (Math.abs(offsetX) < threshold) {
      animateTo({ duration: 220, curve: Curve.EaseOut }, () => {
        this.capsuleDragX = 0;
      });
      return;
    }
    const side: string = offsetX < 0 ? 'left' : 'right';
    animateTo({ duration: 260, curve: Curve.EaseInOut }, () => {
      this.capsuleSide = side;
      this.capsuleExpanded = false;
      this.capsuleDragX = 0;
    });
    // 收起胶囊：把预热期间累积的历史一次性重排回时间线（此时页面才允许动）
    this.flushTimelineAfterWarmup();
  }

  /** 点胶囊以外区域：收起成贴边把手，并把预热期间累积的历史补进时间线 */
  private collapseCapsuleByOutsideTap(): void {
    if (!this.capsuleExpanded) {
      return;
    }
    animateTo({ duration: 220, curve: Curve.EaseOut }, () => {
      this.capsuleExpanded = false;
      this.capsuleDragX = 0;
      this.turnBarOffset = 0;
    });
    this.flushTimelineAfterWarmup();
  }

  /** 点击胶囊：折叠态先展开（同时开始预热节点）；展开态打开会话节点弹层 */
  private tapCapsule(): void {
    if (!this.capsuleExpanded) {
      animateTo({ duration: 240, curve: Curve.EaseOut }, () => {
        this.capsuleExpanded = true;
      });
      // 展开成卡带的瞬间就预热：先把当前节点刷新出来，再补拉更早历史；
      // 同时挂上自愈重试，首屏还没落地 / 某页失败时也能自己续上
      this.refreshTurnNodes(this.turnNavOpen);
      this.warmHistoryForTurnNav();
      this.scheduleWarmupRetry();
      return;
    }
    // 弹层开着再点胶囊 = 收起
    if (this.turnNavMenuOpen) {
      this.turnNavMenuOpen = false;
      return;
    }
    if (this.turnNavOpen) {
      this.closeTurnNav();
      return;
    }
    // 普通点击：原生系统菜单（样式与「⋯」菜单一致）
    this.refreshTurnNodes(true);
    this.turnNavMenuOpen = true;
  }

  /** 常显胶囊：展开=刻度卡带；折叠=细把手；横向拖动吸附折叠，点击展开/打开弹层 */
  @Builder
  floatingCapsule() {
    Column() {
      if (this.capsuleExpanded) {
        this.turnScrubber()
      } else {
        Column({ space: 5 }) {
          Circle().width(4).height(4).fill(this.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(16,19,24,0.30)')
          Circle().width(4).height(4).fill(this.isDark ? 'rgba(255,255,255,0.45)' : 'rgba(16,19,24,0.30)')
        }
        .width(12)
        .height(56)
        .borderRadius(6)
        .justifyContent(FlexAlign.Center)
        .alignItems(HorizontalAlign.Center)
        .backgroundColor(this.turnNavGlass())
        .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
          colorMode: this.isDark ? ThemeColorMode.DARK : ThemeColorMode.LIGHT
        })
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.60)' })
        .shadow({ radius: 10, color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)', offsetY: 2 })
      }
    }
    .width(this.capsuleWidth())
    .position({ x: this.capsuleX(), y: this.capsuleY() })
    .zIndex(60)
    // 点胶囊 = 原生系统菜单（材质 / 圆角 / 描边 / 动画 / 点空白收起全部由系统提供）
    .bindMenu(this.turnNavMenuOpen, this.turnNavPanel(), {
      placement: this.capsuleSide === 'left' ? Placement.Right : Placement.Left,
      offset: { x: 4, y: 0 },
      outlineColor: this.dividerColor(),
      outlineWidth: 1,
      onWillDisappear: () => {
        this.turnNavMenuOpen = false;
      },
      onDisappear: () => {
        this.turnNavMenuOpen = false;
      }
    })
    // 弹窗改成页面内自绘 overlay（见 turnNavOverlay）：用系统菜单容器时，
    // 「按住黑色滑块」会被判成「点空白」，弹窗立刻收起，没法边拖边看内容。
    .onClick(() => {
      this.tapCapsule();
    })
    .gesture(
      PanGesture()
        .onActionStart(() => {
          this.capsuleAxis = '';
          this.turnScrubStartIndex = this.turnNodeIndex;
          this.capsuleDragStartY = this.capsuleYOffset;
        })
        .onActionUpdate((event: GestureEvent) => {
          if (this.capsuleAxis.length === 0) {
            this.capsuleAxis = Math.abs(event.offsetX) >= Math.abs(event.offsetY) ? 'h' : 'v';
          }
          if (this.capsuleAxis === 'h') {
            // 横向：跟手拖动，松手按方向吸附折叠
            this.capsuleDragX = event.offsetX;
            return;
          }
          // 纵向：整体上下移动胶囊停靠位置（切节点在滑块上拖）
          this.capsuleYOffset = this.capsuleDragStartY + event.offsetY;
        })
        .onActionEnd((event: GestureEvent) => {
          if (this.capsuleAxis === 'h') {
            this.settleCapsule(event.offsetX);
          }
          this.capsuleAxis = '';
        })
        .onActionCancel(() => {
          this.settleCapsule(0);
          this.turnBarOffset = 0;
          this.capsuleAxis = '';
        })
    )
  }

  /** 卡带上第 index 条节点横线的纵坐标 */
  private turnTickTop(index: number): number {
    const count: number = this.turnNodes.length;
    const pad: number = 10;
    const usable: number = TURN_TRACK_HEIGHT - pad * 2;
    if (count <= 1) {
      return pad;
    }
    return pad + usable * (index / (count - 1));
  }

  /** 卡带：细竖胶囊 + 每节点一条横线 + 细深色滑块，上下拨动同步切换左侧节点 */
  @Builder
  turnScrubber() {
    Stack({ alignContent: Alignment.Top }) {
      // 细竖胶囊轨道
      Column()
        .width(TURN_TRACK_WIDTH)
        .height(TURN_TRACK_HEIGHT)
        .borderRadius(TURN_TRACK_WIDTH / 2)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.72)')
        .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.06)' })
        .shadow({ radius: 10, color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.10)', offsetY: 2 })
      // 胶囊上下各一条短横杠
      Row()
        .width(9)
        .height(2.5)
        .borderRadius(1.25)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(16,19,24,0.16)')
        .position({ x: 13.5, y: 10 })
      Row()
        .width(9)
        .height(2.5)
        .borderRadius(1.25)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.28)' : 'rgba(16,19,24,0.16)')
        .position({ x: 13.5, y: TURN_TRACK_HEIGHT - 8.5 })
      // 中间三条略长横杠（固定不动）
      Row()
        .width(20)
        .height(2.5)
        .borderRadius(1.25)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(16,19,24,0.14)')
        .position({ x: 8, y: TURN_TRACK_HEIGHT / 2 - 16 })
      Row()
        .width(20)
        .height(2.5)
        .borderRadius(1.25)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(16,19,24,0.14)')
        .position({ x: 8, y: TURN_TRACK_HEIGHT / 2 - 4 })
      Row()
        .width(20)
        .height(2.5)
        .borderRadius(1.25)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.24)' : 'rgba(16,19,24,0.14)')
        .position({ x: 8, y: TURN_TRACK_HEIGHT / 2 + 8 })
      // 滑块：深色圆角条（内显 N/总数），上下拖动切换节点
      Column({ space: 0 }) {
        Text((this.turnNodeIndex + 1).toString())
          .fontSize(15)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
        Text('/ ' + (this.turnNodes.length > 0 ? this.turnNodes.length.toString() : '0'))
          .fontSize(11)
          .fontColor('rgba(255,255,255,0.72)')
      }
      .width(TURN_TRACK_WIDTH)
      .height(TURN_THUMB_HEIGHT)
      .borderRadius(TURN_THUMB_HEIGHT / 2)
      .backgroundColor(this.isDark ? '#4A4A4E' : '#3A3A3C')
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .position({ x: 0, y: (TURN_TRACK_HEIGHT - TURN_THUMB_HEIGHT) / 2 + this.turnBarOffset })
      // 长按滑块：弹出节点弹层并随拖动实时预览（弹层是自绘浮层，不会被手势收起）
      // 普通拖动：不弹层，只切节点；松手滑块回中
      .gesture(
        GestureGroup(
          GestureMode.Parallel,
          LongPressGesture({ repeat: false, duration: 260 })
            .onAction(() => {
              // 与点击胶囊同一个原生系统菜单（材质/圆角/动画完全一致）
              if (!this.turnNavMenuOpen) {
                this.refreshTurnNodes(true);
                this.turnNavMenuOpen = true;
              }
            }),
          PanGesture()
            .onActionStart(() => {
              this.turnScrubStartIndex = this.turnNodeIndex;
            })
            .onActionUpdate((event: GestureEvent) => {
              const limit: number = TURN_TRACK_HEIGHT / 2 - 16;
              this.turnBarOffset = Math.max(-limit, Math.min(limit, event.offsetY));
              const delta: number = Math.round(event.offsetY / 16);
              this.previewTurnNode(this.turnScrubStartIndex + delta);
            })
            .onActionEnd(() => {
              animateTo({ duration: 180, curve: Curve.EaseOut }, () => {
                this.turnBarOffset = 0;
              });
            })
            .onActionCancel(() => {
              animateTo({ duration: 180, curve: Curve.EaseOut }, () => {
                this.turnBarOffset = 0;
              });
            })
        )
      )
    }
    .width(TURN_TRACK_WIDTH)
    .height(TURN_TRACK_HEIGHT)
  }

  /** 弹层面板左上角：贴在胶囊内侧（右侧停靠→面板在左，左侧停靠→面板在右） */
  private turnNavPanelX(): number {
    const width: number = 300;
    if (this.capsuleSide === 'left') {
      return Math.min(this.pageW - width - 6, this.capsuleX() + this.capsuleWidth() + 6);
    }
    return Math.max(6, this.capsuleX() - width - 6);
  }

  private turnNavPanelY(): number {
    const height: number = 430;
    const top: number = this.topSafe() + 12;
    const lowest: number = Math.max(top, (this.pageH > 0 ? this.pageH : 800) - height - this.bottomInset - 12);
    const wanted: number = this.capsuleY() + this.capsuleWidth() / 2 - height / 2;
    return Math.max(top, Math.min(lowest, wanted));
  }

  /**
   * 会话节点弹层：自绘遮罩 + 面板。
   * 关键点：胶囊（含黑色滑块）zIndex 比这一层高，所以按住滑块不会被遮罩吃掉；
   * 拖动滑块 → previewTurnNode → 弹层列表跟着滚到对应节点，弹层保持打开。
   */
  @Builder
  turnNavOverlay() {
    Stack({ alignContent: Alignment.TopStart }) {
      // 空白遮罩：点空白关闭弹层
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(Color.Transparent)
        .onClick(() => {
          this.closeTurnNav();
        })
      Column() {
        this.turnNavPanel()
      }
      .width(300)
      .height(430)
      // 外观对齐右上角「⋯」原生菜单：同一档材质色 + 同款圆角/细边/投影
      .borderRadius(16)
      .backgroundColor(this.menuMaterial())
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
        colorMode: this.isDark ? ThemeColorMode.DARK : ThemeColorMode.LIGHT
      })
      .border({ width: 0.5, color: this.dividerColor() })
      .shadow({ radius: 20, color: this.isDark ? 'rgba(0,0,0,0.35)' : 'rgba(16,19,24,0.12)', offsetY: 6 })
      .clip(true)
      .position({ x: this.turnNavPanelX(), y: this.turnNavPanelY() })
    }
    .width('100%')
    .height('100%')
    .zIndex(55)
  }

  /** 会话节点弹层内容（自绘面板内的标题 + 节点列表 + 底部操作） */
  @Builder
  turnNavPanel() {
      Column() {
        Row() {
          Text('会话节点')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Blank()
          Text('共 ' + this.turnNodes.length.toString())
            .fontSize(12)
            .fontColor(this.subColor())
        }
        .width('100%')
        .height(42)
        .padding({ left: 16, right: 16 })

        Divider().strokeWidth(0.5).color(this.dividerColor())

        Row() {
          List({ space: 2, scroller: this.turnListScroller }) {
            ForEach(this.turnNodes, (node: TurnNode, index: number) => {
              ListItem() {
                Row({ space: 8 }) {
                  Text(node.ordinal.toString())
                    .fontSize(12)
                    .fontColor(index === this.turnNodeIndex ? '#2E6BE6' : this.subColor())
                    .width(20)
                    .textAlign(TextAlign.Center)
                  Text(node.label)
                    .fontSize(13)
                    .fontWeight(index === this.turnNodeIndex ? FontWeight.Medium : FontWeight.Regular)
                    .fontColor(this.textColor())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                }
                .width('100%')
                .height(40)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(index === this.turnNodeIndex
                  ? (this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.10)')
                  : Color.Transparent)
                .onClick(() => {
                  this.jumpToTurnNode(index);
                })
              }
            }, (node: TurnNode) => node.entryIndex.toString() + '|' + node.label)
          }
          .width('100%')
          .height('100%')
          .scrollBar(BarState.Off)
          // 弹窗内直接上下滑动切换节点：交给手势处理，列表自身不滚动
          .enableScrollInteraction(false)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 12, right: 12, top: 4, bottom: 4 })
        .gesture(
          PanGesture()
            .onActionStart(() => {
              this.turnSwipeBase = this.turnNodeIndex;
              this.turnSwipeOffset = 0;
            })
            .onActionUpdate((event: GestureEvent) => {
              this.turnSwipeOffset = event.offsetY;
              // 每滑过 36vp 切换一个节点（上滑看更晚，下滑看更早）
              // 弹窗内跟随手指：下滑内容下滑（看更早），上滑内容上滑（看更晚）
              const steps: number = Math.round(this.turnSwipeOffset / 36);
              this.previewTurnNode(this.turnSwipeBase - steps);
            })
        )

        Divider().strokeWidth(0.5).color(this.dividerColor())

        Row() {
          Text('拨动预览，点击跳转').fontSize(11).fontColor(this.subColor())
          Blank()
          Text('回到底部 ↓')
            .fontSize(12)
            .fontColor('#2E6BE6')
            .onClick(() => {
              this.backToTimelineBottom();
            })
        }
        .width('100%')
        .height(38)
        .padding({ left: 16, right: 16 })
      }
      // 背景材质、圆角、描边、阴影、弹出动画全部由系统菜单容器提供（与「协作」「⋯」同一套）
      .width(300)
      .height(430)
      .clip(true)
  }

  /** 是否有当前会话（无会话时文件/重命名/归档禁用，对齐 iOS） */
  private hasSession(): boolean {
    return SessionStore.get().currentSessionId().length > 0;
  }

  /**
   * 更多菜单行：逐项对齐小程序 session-menu-row
   * 36rpx 图标(19vp) / 29rpx 文案(15.4fp) / 100rpx 行高(52vp) / 22rpx 间距(12vp)；
   * 图标与文案同色（浅色黑、深色白），可跳转的行右侧带 24rpx 灰 chevron
   * （取消回合、归档会话两行没有，与小程序一致）。
   */
  @Builder
  moreMenuRow(icon: Resource, label: string, enabled: boolean, showChevron: boolean = true) {
    Row({ space: 12 }) {
      Image(icon)
        .width(19)
        .height(19)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTintMatrix(enabled ? this.textColor() : this.subColor()))
      Text(label)
        .fontSize(15.4)
        .fontColor(enabled ? this.textColor() : this.subColor())
        .maxLines(1)
        .layoutWeight(1)
      if (showChevron) {
        Image($r('app.media.chev_right_gray'))
          .width(13)
          .height(13)
          .objectFit(ImageFit.Contain)
          .opacity(0.55)
      }
    }
    .width(212)
    .height(52)
    // 左右留白：内容不贴菜单卡片边缘
    .padding({ left: 16, right: 16 })
    // 按下/悬停高亮（系统菜单同款 press 反馈，和「协作」一致）
    .hoverEffect(HoverEffect.Highlight)
    .opacity(enabled ? 1 : 0.4)
  }

  /** 菜单分组分隔线（对齐小程序 session-menu-group 的模块间隔） */
  @Builder
  moreMenuDivider() {
    Column() {
      Row()
        .width('100%')
        .height(0.5)
        .backgroundColor(this.dividerColor())
    }
    .width(208)
    .padding({ top: 5, bottom: 5, left: 16, right: 16 })
  }

  /** 更多菜单：iOS 的「工作区文件」+ 小程序的会话/插件动作 + 原有「会话设置」 */
  @Builder
  moreMenu() {
    Menu() {
      // ① iOS：工作区文件（无会话禁用）
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_folder'), '工作区文件', this.hasSession()))
        .id('menu-workspace-files')
        .enabled(this.hasSession())
        .onClick(() => {
          this.openWorkspaceFiles();
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ② 小程序：重命名 / 查看统计
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_rename'),
        '重命名会话', this.hasSession()))
        .id('menu-rename-session')
        .enabled(this.hasSession())
        .onClick(() => {
          this.beginRenameSession();
        })
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_gauge'), '查看统计', true))
        .id('menu-session-stats')
        .onClick(() => {
          this.openStatsSheet();
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ③ 小程序：插件
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_pinwheel'),
        '浏览更多插件', true))
        .id('menu-browse-plugins')
        .onClick(() => {
          this.pageStack.pushPathByName('plugins', null);
        })
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_plus'), '创建你的插件', true))
        .id('menu-create-plugin')
        .onClick(() => {
          this.pageStack.pushPathByName('plugins', null);
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ④ 小程序：回合 / 会话
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_stop'), '取消当前回合', this.running, false))
        .id('menu-cancel-turn')
        .enabled(this.running)
        .onClick(() => {
          if (this.running) {
            this.onStop();
          }
        })
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_archive'), '归档会话', this.hasSession(), false))
        .id('menu-archive-session')
        .enabled(this.hasSession())
        .onClick(() => {
          this.confirmArchiveSession();
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ⑤ 原有入口
      MenuItem(this.moreMenuRow($r('app.media.menu_ic_sliders'),
        '会话设置', true))
        .id('menu-session-settings')
        .onClick(() => {
          this.pageStack.pushPathByName('session-settings', null);
        })
    }
  }

  /** 团队协作开关是否可用：需要已连接的会话 */
  private hasTeamSession(): boolean {
    return SessionStore.get().currentSessionId().length > 0 && GatewayClient.get().isConnected();
  }

  /** 切换智能体团队协作：乐观更新 → 网关回执失败则回滚（保证和 DSH 端一致） */
  private toggleTeamEnabled(next: boolean): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      this.showToast('请先创建会话');
      return;
    }
    if (!GatewayClient.get().isConnected()) {
      this.showToast('请先连接网关');
      return;
    }
    this.applyTeamEnabled(next);
    GatewayClient.get().setAgentTeamEnabled(sessionId, next).then((frame: GatewayFrame) => {
      if (frame.kind === 'error') {
        this.applyTeamEnabled(!next);
        const reason: string = frame.message !== undefined && frame.message.length > 0 ? frame.message : 'DSH 端未接受';
        this.showToast('切换团队协作失败：' + reason);
        return;
      }
      this.showToast(next ? '已开启智能体团队协作' : '已关闭智能体团队协作');
    }).catch((error: Error) => {
      this.applyTeamEnabled(!next);
      this.showToast('切换团队协作失败：' + error.message);
    });
  }

  private applyTeamEnabled(value: boolean): void {
    this.teamEnabled = value;
    AppStorage.setOrCreate<boolean>('teamEnabled', value);
  }

  /** 打开工作区文件 sheet（对齐小程序 openFilesSheet：根目录起步） */
  private openWorkspaceFiles(): void {
    this.fileSheetOpen = true;
    this.loadWorkspaceFiles('');
  }

  /** 读取目录（对齐小程序 loadSessionFiles：entries + path） */
  private loadWorkspaceFiles(path: string): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || !GatewayClient.get().isConnected()) {
      this.fileHint = '请先连接网关并打开会话';
      this.fileEntries = [];
      return;
    }
    this.fileLoading = true;
    this.fileHint = '';
    GatewayClient.get().requestFileList(sessionId, path).then((frame: GatewayFrame) => {
      const raw = asRec(frame as Object);
      const value: Object | undefined = raw !== undefined ? raw['entries'] : undefined;
      const list: Object[] = Array.isArray(value) ? value as Object[] : [];
      const entries: WorkspaceFileEntry[] = [];
      for (const item of list) {
        const itemPath: string = str(item, 'path') ?? '';
        if (itemPath.length === 0) {
          continue;
        }
        const kind: string = str(item, 'kind') ?? '';
        entries.push({
          name: str(item, 'name') ?? itemPath,
          path: itemPath,
          isDirectory: kind === 'dir' || kind === 'directory' || bool(item, 'isDirectory') === true,
          bytes: num(item, 'bytes') ?? num(item, 'size') ?? 0
        });
      }
      this.fileEntries = entries;
      this.filePath = str(frame as Object, 'path') ?? path;
      this.fileLoading = false;
    }).catch((error: Error) => {
      this.fileLoading = false;
      this.fileHint = error.message.length > 0 ? error.message : '读取目录失败，请重试';
    });
  }

  /** 上一级（对齐小程序 sessionFilesGoUp） */
  private goUpWorkspaceFiles(): void {
    const value: string = this.filePath.endsWith('/')
      ? this.filePath.substring(0, this.filePath.length - 1) : this.filePath;
    const index: number = value.lastIndexOf('/');
    this.loadWorkspaceFiles(index > 0 ? value.substring(0, index) : '');
  }

  /** 点条目：目录进入，文件下载到本地（对齐小程序 openSessionFile） */
  private openWorkspaceEntry(entry: WorkspaceFileEntry): void {
    if (entry.isDirectory) {
      this.loadWorkspaceFiles(entry.path);
      return;
    }
    if (this.fileBusy) {
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return;
    }
    this.fileBusy = true;
    this.fileHint = '正在下载…';
    const context = getContext(this) as common.UIAbilityContext;
    downloadAttachment(context, GatewayClient.get(), sessionId, entry.path, (percent: number) => {
      this.fileHint = '正在下载 ' + percent + '%';
    }).then((result: DownloadResult) => {
      this.fileBusy = false;
      this.fileHint = '已保存：' + result.localPath;
    }).catch((error: Error) => {
      this.fileBusy = false;
      this.fileHint = error.message.length > 0 ? error.message : '下载失败，请重试';
    });
  }

  /** 是否已在工作区根目录（服务端根目录可能是 '' / '.' / '/'） */
  private workspaceIsRoot(): boolean {
    let value: string = this.filePath.trim();
    while (value.length > 0 && value.endsWith('/')) {
      value = value.substring(0, value.length - 1);
    }
    return value.length === 0 || value === '.' || value === '/';
  }

  /** 文件大小文案 */
  private fileSizeText(bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /** 文件类型（对齐小程序 file-deliverables.classify）：按扩展名归到 image/pdf/document/table/slides/code/file */
  private workspaceFileKind(name: string): string {
    const slash: number = name.lastIndexOf('/');
    const base: string = slash >= 0 ? name.substring(slash + 1) : name;
    const dot: number = base.lastIndexOf('.');
    const ext: string = dot > 0 ? base.substring(dot + 1).toLowerCase() : '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].indexOf(ext) >= 0) {
      return 'image';
    }
    if (ext === 'pdf') {
      return 'pdf';
    }
    if (['doc', 'docx', 'md', 'markdown', 'txt'].indexOf(ext) >= 0) {
      return 'document';
    }
    if (['xls', 'xlsx', 'csv'].indexOf(ext) >= 0) {
      return 'table';
    }
    if (['ppt', 'pptx'].indexOf(ext) >= 0) {
      return 'slides';
    }
    if (['html', 'htm', 'css', 'wxss', 'wxml', 'wxs', 'vue', 'svelte', 'scss', 'less', 'js', 'jsx', 'mjs', 'cjs',
      'ts', 'tsx', 'json', 'jsonl', 'log', 'yaml', 'yml', 'xml', 'svg', 'py', 'sh', 'sql', 'swift', 'kt', 'java',
      'c', 'h', 'cpp', 'rs', 'go', 'toml', 'ini'].indexOf(ext) >= 0) {
      return 'code';
    }
    return 'file';
  }

  /** 工作区文件图标（对齐小程序 iconFileFor）：文件夹=蓝色工作区文件夹，文件=按格式分类的彩色文件图标 */
  private workspaceFileIcon(entry: WorkspaceFileEntry): Resource {
    if (entry.isDirectory) {
      return $r('app.media.workspace_folder_blue');
    }
    const kind: string = this.workspaceFileKind(entry.name);
    if (kind === 'image') {
      return $r('app.media.deliverable_image');
    }
    if (kind === 'pdf') {
      return $r('app.media.deliverable_pdf');
    }
    if (kind === 'document') {
      return $r('app.media.deliverable_document');
    }
    if (kind === 'table') {
      return $r('app.media.deliverable_table');
    }
    if (kind === 'slides') {
      return $r('app.media.deliverable_slides');
    }
    if (kind === 'code') {
      return $r('app.media.deliverable_code');
    }
    return $r('app.media.deliverable_file');
  }

  /** 会话状态 sheet：标题 + 三张卡片（样式与工作区文件同一个系统半模态） */
  @Builder
  statsSheetContent() {
    Column({ space: 0 }) {
      // 顶部拖动条（与工作区文件 sheet 同款）
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)

      Row() {
        Text('会话状态')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .width('100%')
      .height(44)
      .justifyContent(FlexAlign.Center)

      Scroll() {
        Column({ space: 0 }) {
          ForEach(this.statsGroups, (group: StatsGroup) => {
            Column() {
              Text(group.title)
                .fontSize(12)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ top: 8, bottom: 3 })
              ForEach(group.rows, (row: string[], index: number) => {
                Row() {
                  Text(row.length > 0 ? row[0] : '')
                    .fontSize(13)
                    .fontColor(this.subColor())
                    .flexShrink(0)
                  Blank()
                  Text(row.length > 1 ? row[1] : '')
                    .fontSize(13)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                    .fontFamily('monospace')
                    .textAlign(TextAlign.End)
                    .layoutWeight(1)
                    .margin({ left: 12 })
                }
                .width('100%')
                .padding({ top: 7, bottom: 7 })
                .alignItems(VerticalAlign.Center)
                .border({
                  width: { top: index > 0 ? 0.5 : 0 },
                  color: this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)'
                })
              }, (row: string[], index: number) => group.title + '-' + index.toString())
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            // 小程序 .session-stat-group：边框 1rpx、圆角 22rpx、padding 6/24/14rpx、下间距 16rpx
            .padding({ left: 12, right: 12, top: 3, bottom: 7 })
            .borderRadius(11)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)')
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
            .margin({ bottom: 8 })
          }, (group: StatsGroup) => group.title)
        }
        .width('100%')
        .padding({ left: 18, right: 18, bottom: 24 })
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
  }

  /** 工作区文件 sheet 内容（对齐小程序 more-files-sheet：标题 + 上一级 + 列表 + 路径） */
  @Builder
  workspaceFilesSheet() {
    Column({ space: 0 }) {
      // 顶部拖动条（与首页「切换主机」半模态同款）
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)

      // 标题行：居中标题（不放右侧「完成」，下拉或点空白即可关闭）
      Row() {
        Text('工作区文件')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
      }
      .width('100%')
      .height(48)
      .justifyContent(FlexAlign.Center)

      // 根目录时不占位，「工作区根目录」紧跟标题
      if (!this.workspaceIsRoot()) {
        Row({ space: 8 }) {
          Row({ space: 3 }) {
            // 箭头用图标：比文字里的「‹」更大，且和「上一级」文字垂直居中对齐
            Image($r('app.media.chev_right_gray'))
              .width(16)
              .height(16)
              .objectFit(ImageFit.Contain)
              .rotate({ angle: 180 })
              .colorFilter(this.iconTintMatrix('#2E6BE6'))
            Text('上一级')
              .fontSize(14)
              .fontColor('#2E6BE6')
          }
          .alignItems(VerticalAlign.Center)
          .height(22)
          .onClick(() => {
            this.goUpWorkspaceFiles();
          })
          Blank()
        }
        .width('100%')
        .height(22)
        .padding({ left: 18, right: 18 })
      }

      // 当前路径（在卡片上方，与标题贴紧）
      Row() {
        Text(this.workspaceIsRoot() ? '工作区根目录' : this.filePath)
          .fontSize(11)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .height(18)
      .padding({ left: 18, right: 18, bottom: 4 })

      List({ space: 0 }) {
        if (this.fileLoading) {
          ListItem() {
            Text('正在读取工作区文件…')
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ top: 20, bottom: 20 })
              .textAlign(TextAlign.Center)
          }
        } else if (this.fileHint.length > 0 && this.fileEntries.length === 0) {
          ListItem() {
            Text(this.fileHint)
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ top: 20, bottom: 20 })
              .textAlign(TextAlign.Center)
          }
        } else if (this.fileEntries.length === 0) {
          ListItem() {
            Text('此目录为空')
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ top: 20, bottom: 20 })
              .textAlign(TextAlign.Center)
          }
        } else {
          ForEach(this.fileEntries, (entry: WorkspaceFileEntry) => {
            ListItem() {
              Column() {
                Row({ space: 10 }) {
                  // 图标对齐小程序：文件夹=蓝色工作区文件夹，文件=按扩展名分类的彩色文件图标
                  Image(this.workspaceFileIcon(entry))
                    .width(20)
                    .height(20)
                    .objectFit(ImageFit.Contain)
                  Text(entry.name)
                    .fontSize(15)
                    .fontColor(this.textColor())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  if (entry.isDirectory) {
                    Text('›')
                      .fontSize(15)
                      .fontColor(this.subColor())
                  } else {
                    Text(this.fileSizeText(entry.bytes))
                      .fontSize(11)
                      .fontColor(this.subColor())
                  }
                }
                .width('100%')
                .height(46)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.openWorkspaceEntry(entry);
                })
                if (this.fileEntries.indexOf(entry) < this.fileEntries.length - 1) {
                  Row() {
                    Row()
                      .width('100%')
                      .height(0.5)
                      .backgroundColor(this.dividerColor())
                  }
                  .width('100%')
                  .padding({ left: 16 })
                }
              }
              .width('100%')
            }
          }, (entry: WorkspaceFileEntry) => entry.path)
        }
      }
      .width('calc(100% - 28vp)')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      // 分组卡片：与「切换主机」弹窗的 inset grouped 卡片同款底色/描边/圆角
      .margin({ left: 14, right: 14 })
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.50)')
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.80)' })
      .borderRadius(16)
      .clip(true)

      // 空目录时列表里已经显示过一次提示，这里只在有内容时才补充说明
      if (this.fileHint.length > 0 && this.fileEntries.length > 0) {
        Text(this.fileHint)
          .fontSize(11)
          .fontColor(this.subColor())
          .width('100%')
          .padding({ left: 18, right: 18, top: 6, bottom: 6 })
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
    .height('100%')
    // 卡片离弹窗底部留出更大间距
    .padding({ top: 0, bottom: 28 })
  }

  /** 打开重命名弹窗，初值为当前会话标题 */
  private beginRenameSession(): void {
    this.renameValue = this.activeSessionTitle();
    this.renameSessionOpen = true;
  }

  /** 提交重命名（对齐 HomePage 的 renameSession 流程） */
  private submitRenameSession(): void {
    const title: string = this.renameValue.trim();
    const sessionId: string = SessionStore.get().currentSessionId();
    this.renameSessionOpen = false;
    if (title.length === 0 || sessionId.length === 0) {
      return;
    }
    GatewayClient.get().renameSession(sessionId, title);
  }

  /** 归档当前会话：二次确认后下发归档并退回上一页 */
  private confirmArchiveSession(): void {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return;
    }
    AlertDialog.show({
      title: '归档会话',
      message: '归档后会话将从列表移除，可在归档中找回。',
      autoCancel: true,
      primaryButton: {
        value: '取消',
        action: () => {
        }
      },
      secondaryButton: {
        value: '归档',
        fontColor: '#D9413A',
        action: () => {
          GatewayClient.get().archiveSession(sessionId);
          this.pageStack.pop();
        }
      }
    });
  }

  /** 重命名会话弹窗（对齐 HomePage.renameSessionAlert 的形态） */
  @Builder
  renameSessionAlert() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.35)')
        .onClick(() => {
          this.renameSessionOpen = false;
        })
      Column() {
        Column() {
          Text('重命名会话')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
            .textAlign(TextAlign.Center)
            .width('100%')
          TextInput({ text: this.renameValue, placeholder: '输入新的会话名称' })
            .caretStyle({ width: 1 })
            .fontSize(15)
            .fontColor(this.textColor())
            .placeholderColor(this.subColor())
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
            .height(40)
            .borderRadius(10)
            .padding({ left: 12, right: 12 })
            .margin({ top: 14 })
            .maxLength(80)
            .defaultFocus(true)
            .onChange((value: string) => {
              this.renameValue = value;
            })
            .onSubmit(() => {
              this.submitRenameSession();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 20, bottom: 18 })

        Row()
          .width('100%')
          .height(0.5)
          .backgroundColor(this.dividerColor())

        Row() {
          Row() {
            Text('取消')
              .fontSize(16)
              .fontColor('#2E6BE6')
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.renameSessionOpen = false;
          })
          Column()
            .width(0.5)
            .height(44)
            .backgroundColor(this.dividerColor())
          Row() {
            Text('保存')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor('#2E6BE6')
          }
          .layoutWeight(1)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.submitRenameSession();
          })
        }
        .width('100%')
      }
      .width('86%')
      .borderRadius(14)
      .backgroundColor(this.surfaceColor())
      .clip(true)
    }
    .width('100%')
    .height('100%')
    .zIndex(70)
  }

  // ==================== 会话快捷切换（对齐小程序 .session-switch-overlay） ====================
  /** 打开会话快捷切换：对齐小程序 openSessionSwitcher */
  private openSessionSwitcher(): void {
    // 打开左侧栏也给一次触感，与首页抽屉一致；强度取「设置 → 震动反馈」
    if (!this.sessionPickerOpen) {
      Haptics.play();
    }
    let groups: ConvSidebarGroup[] = this.buildConvSidebarGroups();
    // 每次打开自动展开当前会话所在分组（打开后仍可手动收起）
    for (const group of groups) {
      if (group.containsCurrent && !group.expanded) {
        this.convSidebarExpanded = this.convSidebarExpanded.concat([group.id]);
        groups = this.buildConvSidebarGroups();
        break;
      }
    }
    this.convSidebarGroups = groups;
    // 先以收起态挂载，再在下一帧动画到展开态（与系统菜单的弹出节奏一致）
    this.sessionPickerAnim = 0;
    this.sessionPickerOpen = true;
    animateTo({ curve: curves.springMotion(0.35, 1) }, () => {
      this.sessionPickerAnim = 1;
    });
  }

  /** 关闭会话快捷切换（先播收起动画，再卸载面板） */
  private closeSessionSwitcher(): void {
    if (!this.sessionPickerOpen) {
      return;
    }
    animateTo({
      curve: curves.springMotion(0.35, 1),
      onFinish: () => {
        this.sessionPickerOpen = false;
        this.sessionPickerAnim = 0;
      }
    }, () => {
      this.sessionPickerAnim = 0;
    });
  }

  /** 路径归一：反斜杠转正斜杠并去掉尾部分隔符（对齐小程序 sessionSwitcherRows 的 norm） */
  private normalizePath(value: string): string {
    let text: string = value.replace(/\\/g, '/');
    while (text.length > 1 && text.charAt(text.length - 1) === '/') {
      text = text.substring(0, text.length - 1);
    }
    return text;
  }

  /** 工作区显示名：标题优先，其次路径末段 */
  /** 会话所属工作区：按会话 cwd 与工作区 path 前缀匹配 */
  private workspaceOfSession(session: SessionSummary): WorkspaceRow | undefined {
    const cwd: string = session.cwd;
    if (cwd.length === 0) {
      return undefined;
    }
    for (const ws of this.workspaces) {
      const path: string = ws.path;
      if (path.length === 0) {
        continue;
      }
      if (cwd === path || cwd.startsWith(path)) {
        return ws;
      }
    }
    return undefined;
  }

  private workspaceLabel(ws: WorkspaceRow): string {
    if (ws.title.length > 0) {
      return ws.title;
    }
    const parts: string[] = this.normalizePath(ws.path).split('/');
    for (let index = parts.length - 1; index >= 0; index--) {
      if (parts[index].length > 0) {
        return parts[index];
      }
    }
    return ws.workspaceId;
  }

  /** 会话行时间标签（口径同 HomePage.timeLabel） */
  private sessionSwitchTimeLabel(updatedAt: number): string {
    if (updatedAt <= 0) {
      return '';
    }
    const delta: number = Date.now() - updatedAt;
    const minutes: number = Math.floor(delta / 60000);
    if (minutes < 1) {
      return '刚刚';
    }
    if (minutes < 60) {
      return minutes + ' 分钟前';
    }
    const hours: number = Math.floor(minutes / 60);
    if (hours < 24) {
      return hours + ' 小时前';
    }
    return Math.floor(hours / 24) + ' 天前';
  }

  /** 单色图标着色矩阵（与输入条同款）：只换 RGB，保留透明度 */
  private iconTintMatrix(color: string): number[] {
    const text: string = color.trim();
    let red: number = 255;
    let green: number = 255;
    let blue: number = 255;
    let alpha: number = 1;
    if (text.startsWith('#')) {
      const hex: string = text.substring(1);
      const value: number = parseInt(hex, 16);
      if (hex.length === 8) {
        alpha = ((value >>> 24) & 255) / 255;
        red = (value >> 16) & 255;
        green = (value >> 8) & 255;
        blue = value & 255;
      } else {
        red = (value >> 16) & 255;
        green = (value >> 8) & 255;
        blue = value & 255;
      }
    } else if (text.startsWith('rgb')) {
      // 支持 rgb(r,g,b) / rgba(r,g,b,a)：subColor() 返回的是 rgba，之前会落到默认白色
      const body: string = text.substring(text.indexOf('(') + 1, text.lastIndexOf(')'));
      const parts: string[] = body.split(',');
      if (parts.length >= 3) {
        red = Math.round(parseFloat(parts[0].trim()));
        green = Math.round(parseFloat(parts[1].trim()));
        blue = Math.round(parseFloat(parts[2].trim()));
      }
      if (parts.length >= 4) {
        alpha = parseFloat(parts[3].trim());
      }
    }
    return [
      0, 0, 0, 0, red / 255,
      0, 0, 0, 0, green / 255,
      0, 0, 0, 0, blue / 255,
      0, 0, 0, alpha, 0
    ];
  }

  /** 工作区分组展开/收起（对齐小程序 toggleConvSidebarGroup） */
  private toggleConvSidebarGroup(id: string): void {
    const next: string[] = [];
    let found: boolean = false;
    for (const one of this.convSidebarExpanded) {
      if (one === id) {
        found = true;
      } else {
        next.push(one);
      }
    }
    if (!found) {
      next.push(id);
    }
    this.convSidebarExpanded = next;
    this.convSidebarGroups = this.buildConvSidebarGroups();
  }

  /** 某个工作区里的会话行（当前会话置顶不动，其余按更新时间倒序） */
  private convSidebarSessions(ids: string[], currentId: string): ConvSidebarSession[] {
    const rows: ConvSidebarSession[] = [];
    for (const session of this.sessions) {
      if (ids.indexOf(session.id) < 0) {
        continue;
      }
      rows.push({
        id: session.id,
        title: session.title.length > 0 ? session.title : '未命名会话',
        running: session.running,
        selected: session.id === currentId,
        timeText: this.sessionSwitchTimeLabel(session.updatedAt),
        updatedAt: session.updatedAt
      });
    }
    rows.sort((left: ConvSidebarSession, right: ConvSidebarSession): number => right.updatedAt - left.updatedAt);
    return rows;
  }

  /** 分组数据：按工作区 sessionIds 归属，其余归「未分组」（对齐小程序 conversation-sidebar.buildGroups） */
  private buildConvSidebarGroups(): ConvSidebarGroup[] {
    const currentId: string = SessionStore.get().currentSessionId();
    const owned: string[] = [];
    for (const ws of this.workspaces) {
      for (const id of ws.sessionIds) {
        owned.push(id);
      }
    }
    const groups: ConvSidebarGroup[] = [];
    for (const ws of this.workspaces) {
      groups.push({
        id: ws.workspaceId,
        title: ws.title.length > 0 ? ws.title : this.workspaceLabel(ws),
        ungrouped: false,
        containsCurrent: ws.sessionIds.indexOf(currentId) >= 0,
        expanded: this.convSidebarExpanded.indexOf(ws.workspaceId) >= 0,
        sessions: this.convSidebarSessions(ws.sessionIds, currentId)
      });
    }
    const rest: string[] = [];
    for (const session of this.sessions) {
      if (owned.indexOf(session.id) < 0) {
        rest.push(session.id);
      }
    }
    groups.push({
      id: '__ungrouped__',
      title: '未分组',
      ungrouped: true,
      containsCurrent: rest.indexOf(currentId) >= 0,
      expanded: this.convSidebarExpanded.indexOf('__ungrouped__') >= 0,
      sessions: this.convSidebarSessions(rest, currentId)
    });
    return groups;
  }

  /** 在工作区新建会话并切过去（对齐小程序 createConvSidebarSession） */
  private createSessionInWorkspace(workspaceId: string): void {
    if (workspaceId.length === 0) {
      return;
    }
    GatewayClient.get().createSession(workspaceId).then((id: string) => {
      this.closeSessionSwitcher();
      this.openSession(id);
    }).catch((ignored: Error) => {
      this.hint = '新建会话失败';
    });
  }

  /** 侧栏宽度：对齐小程序 Math.min(windowWidth - 24, 300)，手机上左右各留 12 */
  private convSidebarWidth(): number {
    let screen: number = 375;
    try {
      screen = this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
    } catch (err) {
      screen = 375;
    }
    const width: number = screen - 24;
    return width < 300 ? width : 300;
  }

  /** 侧栏高度：屏高 − 顶部避让 − 底部输入条避让（对齐小程序按导航栏到输入框计算） */
  private convSidebarHeight(): number {
    let screen: number = 800;
    try {
      screen = this.getUIContext().px2vp(display.getDefaultDisplaySync().height);
    } catch (err) {
      screen = 800;
    }
    const height: number = screen - (this.topSafe() + 8) - (this.bottomInset + 92);
    return height > 240 ? height : 240;
  }

  /**
   * 侧栏面板高度：对齐小程序 convSidebarHeight（导航栏按钮顶部 → 输入条底部）。
   * 120 = 顶栏下沿偏移；底部再由安全区把输入条让出来。
   */
  private convSidebarPanelHeight(): number {
    let screen: number = 800;
    try {
      screen = this.getUIContext().px2vp(display.getDefaultDisplaySync().height);
    } catch (err) {
      screen = 800;
    }
    // 底边停在输入框上方：底部安全区 + 输入条容器 padding(18) + 输入卡片高度(46) + 光圈余量(6)
    // + 18 的悬空间距，避免面板压到输入框上沿的光圈/阴影
    const top: number = this.topSafe() + 58;
    const available: number = screen - top - (this.bottomInset + 110);
    return available > 240 ? available : 240;
  }

  /** 会话侧栏内容：交给 bindMenu 的系统菜单容器渲染（材质/圆角/描边/动画/点空白收起全部原生） */
  @Builder
  sidebarMenuPanel() {
        Column() {
        // 品牌行：首页左上角同款 3D 品牌币 + 字标 + HARNESS 徽章
        Row() {
          FluKeCoin({ diameter: 26 })
          Image(this.isDark ? $r('app.media.wordmark_white') : $r('app.media.wordmark_ink'))
            .width(52)
            .height(16)
            .objectFit(ImageFit.Contain)
            .margin({ left: 6 })
          Text('HARNESS')
            .fontSize(9)
            .fontColor(this.textColor())
            .height(15)
            .padding({ left: 5, right: 5 })
            .border({ width: 0.5, color: this.subColor() })
            .borderRadius(4)
            .margin({ left: 9 })
          Blank()
        }
        .width('100%')
        .height(44)
        // 品牌币左缘 13：币宽 26 → 中心 26，与下方插件/定时任务图标中心同一竖线
        .padding({ left: 13, right: 16 })
        .alignItems(VerticalAlign.Center)

        // 插件 / 定时任务（对齐小程序 conv-sidebar-item）
        Row({ space: 10 }) {
          Image(this.isDark ? $r('app.media.pinwheel_white') : $r('app.media.pinwheel_ink'))
            .width(20)
            .height(20)
            .objectFit(ImageFit.Contain)
          Text('插件')
            .fontSize(15)
            .fontColor(this.textColor())
          Blank()
        }
        .width('100%')
        .height(44)
        .padding({ left: 16, right: 16 })
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
          // 侧栏按钮的触感统一走 Haptics：强度取「设置 → 震动反馈」
          Haptics.play();
          this.closeSessionSwitcher();
          this.pageStack.pushPathByName('plugins', null);
        })

        Row({ space: 10 }) {
          Image(this.isDark ? $r('app.media.automation_white') : $r('app.media.automation_ink'))
            .width(20)
            .height(20)
            .objectFit(ImageFit.Contain)
          Text('定时任务')
            .fontSize(15)
            .fontColor(this.textColor())
          Blank()
        }
        .width('100%')
        .height(44)
        .padding({ left: 16, right: 16 })
        .alignItems(VerticalAlign.Center)
        .onClick(() => {
          Haptics.play();
          this.closeSessionSwitcher();
          this.pageStack.pushPathByName('schedule', null);
        })

        // 工作区
        Text('工作区')
          .fontSize(12)
          .fontColor(this.subColor())
          .width('100%')
          .padding({ left: 16, top: 11, bottom: 4 })

        Scroll() {
          Column() {
            Column() {
            ForEach(this.convSidebarGroups, (group: ConvSidebarGroup) => {
              // 分组行：文件夹 + 名称 + 新建会话 + 展开箭头
              Row({ space: 8 }) {
                // 工作区文件夹：与首页「工作区卡片」菜单同款图标与着色方式（colorFilter，保留图形层次）
                Image(group.ungrouped ? $r('app.media.tray_white') : $r('app.media.workspace_folder_white'))
                  .width(18)
                  .height(18)
                  .objectFit(ImageFit.Contain)
                  .colorFilter(this.iconTintMatrix(group.containsCurrent ? '#2E6BE6' : this.textColor()))
                Text(group.title)
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
                if (!group.ungrouped) {
                  // 新建会话：小程序 conv-sidebar-new-ic 同款「圆形描边 + 内部加号」（16 viewBox / 0.8 描边 / 36rpx）
                  Row() {
                    Image($r('app.media.conv_sidebar_new'))
                      .width(18)
                      .height(18)
                      .objectFit(ImageFit.Contain)
                      .opacity(0.55)
                  }
                  .id('conv-new-' + group.id)
                  .width(28)
                  .height(28)
                  .justifyContent(FlexAlign.Center)
                  .onClick(() => {
                    Haptics.play();
                    this.createSessionInWorkspace(group.id);
                  })
                }
                Image($r('app.media.ic_dir_chevron_mist'))
                  .width(14)
                  .height(14)
                  .objectFit(ImageFit.Contain)
                  .colorFilter(this.iconTintMatrix(this.textColor()))
                  .rotate({ angle: group.expanded ? 270 : 90 })
                  .margin({ left: -4 })
                  .opacity(0.7)
              }
              .id('conv-group-' + group.id)
              .width('100%')
              .height(38)
              // 容器左 8 + 行内 9 + 图标 18/2 = 26，与上方插件/定时任务图标中心同列
              .padding({ left: 9, right: 8 })
              .borderRadius(9)
              .onClick(() => {
                Haptics.play();
                Logger.info('[SidebarTap] group=' + group.id + ' expanded=' + (group.expanded ? '1' : '0'));
                this.toggleConvSidebarGroup(group.id);
                Logger.info('[SidebarTap] groups=' + this.convSidebarGroups.length + ' open=' + this.convSidebarGroups.filter((g: ConvSidebarGroup) => g.expanded).length.toString());
              })

              if (group.expanded) {
                if (group.sessions.length === 0) {
                  Text('暂无会话')
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .width('100%')
                    .padding({ left: 15, top: 4, bottom: 6 })
                }
                ForEach(group.sessions, (session: ConvSidebarSession) => {
                  // 左侧留白与分组行内文件夹图标中心对齐（8 外边距 + 8 内边距 + 19/2 图标中心）
                  // 圆点保持原位（与工作区分组图标同列），文字左缘对齐上方工作区标题文字
                  Row({ space: 14 }) {
                    Column()
                      .width(6)
                      .height(6)
                      .borderRadius(3)
                      .backgroundColor(session.running ? '#31B77A' : Color.Transparent)
                    Text(session.title)
                      .fontSize(14)
                      .fontColor(this.textColor())
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .layoutWeight(1)
                    Text(session.timeText)
                      .fontSize(11)
                      .fontColor(this.subColor())
                  }
                  .id('conv-session-' + session.id)
                  .width('100%')
                  .height(34)
                  // 容器左 8 + 行内 15 + 圆点 3 = 26，与工作区文件夹图标中心同列
                  .padding({ left: 15, right: 8 })
                  .borderRadius(9)
                  .backgroundColor(session.selected
                    ? (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)')
                    : Color.Transparent)
                  .onClick(() => {
                    Haptics.play();
                    Logger.info('[SidebarTap] session=' + session.id + ' current=' + SessionStore.get().currentSessionId());
                    this.closeSessionSwitcher();
                    this.openSession(session.id);
                    Logger.info('[SidebarTap] after open current=' + SessionStore.get().currentSessionId());
                  })
                }, (session: ConvSidebarSession) => session.id)
              }
              // key 必须带展开状态：ArkUI 的 ForEach 在 key 不变时复用节点、不重跑 itemBuilder，
              // 只改 data 里的 expanded 不会刷新出/收起会话行
            }, (group: ConvSidebarGroup) => group.id + (group.expanded ? ':open' : ':closed'))
            }
            .width('100%')
            .padding({ left: 8, right: 8 })
          }
          .width('100%')
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.None)
        .align(Alignment.Top)

        // 底部设置（对齐小程序 conv-sidebar-footer）
        Column() {
          Row()
            .width('100%')
            .height(0.5)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)')
          Row({ space: 10 }) {
            Image(this.isDark ? $r('app.media.settings_white') : $r('app.media.settings_ink'))
              .width(20)
              .height(20)
              .objectFit(ImageFit.Contain)
            Text('设置')
              .fontSize(15)
              .fontColor(this.textColor())
            Blank()
          }
          .width('100%')
          .height(44)
          .padding({ left: 16, right: 16 })
          .alignItems(VerticalAlign.Center)
          .onClick(() => {
            Haptics.play();
            this.closeSessionSwitcher();
            this.pageStack.pushPathByName('app-settings', null);
          })
        }
        .width('100%')
        .padding({ bottom: 4 })
        }
        .id('conv-sidebar')
        .width(this.convSidebarWidth())
        .height(this.convSidebarPanelHeight())
        .alignItems(HorizontalAlign.Start)
        .padding({ top: 2, bottom: 2 })
        // APP 玻璃标准（见 common/AppGlass.ets）：侧栏就是这个标准的基准实现
        // 不透明度提高：深 0.46 → 0.74 / 浅 0.24 → 0.62（文字更易读，仍保留玻璃透感）
        .backgroundColor(this.isDark ? 'rgba(44,44,48,0.74)' : 'rgba(255,255,255,0.62)')
        .backdropBlur(14)
        .borderRadius(APP_GLASS_RADIUS)
        .clip(true)
        .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)' })
        .shadow(appGlassShadow(this.isDark))
        // 弹出动画对齐系统菜单（右上角「⋯」）：从锚点（右上角按钮）缩放 0.9 → 1 + 淡入
        .opacity(this.sessionPickerAnim)
        .scale({
          x: 0.9 + 0.1 * this.sessionPickerAnim,
          y: 0.9 + 0.1 * this.sessionPickerAnim,
          centerX: '100%',
          centerY: 0
        })
  }
}
