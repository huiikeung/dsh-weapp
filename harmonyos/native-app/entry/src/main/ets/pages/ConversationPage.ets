import { abilityAccessCtrl, common, Want } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { display, KeyboardAvoidMode, uiMaterial } from '@kit.ArkUI';
import {
  asRec, bool, ConversationFeed, ConversationFeedEntry, ConversationFeedEntryModel, ConversationItem, downloadAttachment, emptySessionGoal, GatewayClient, GatewayRequestFactory, Logger, num,
  DraftStore, PI_NS, PickedAttachment, PreferencesStore, SessionStore, SessionSummary, SpeechFailure, SpeechInput, TeamStore, WorkStepPresentation,
  normalizeRawSessionEvent, parseNamespace, pickDocuments, pickImages, str, uploadAttachment
} from 'nativecore';
import type { DirEntry, GatewayEvent, GatewayFrame, GatewayTask, GatewayGoalReference, ModelMenuItem, ModelOption, PresetOption, QueueItem, RawSessionEvent, SessionEvent, SessionGoalView, WorkspaceRow } from 'nativecore';
import type { TeamMemberView, TeamTaskView } from 'nativecore';
import type { SpeechLimits } from 'nativecore';
import type { DownloadResult, UploadResult } from 'nativecore';
import { ConversationRowView } from '../components/ConversationRowView';
import { ConversationComposer, MetricMenuPair, RefChipItem, RefDirItem, RefSessionItem, SkillItem } from '../components/ConversationComposer';
import { VoiceRipplePanel } from '../components/VoiceRipplePanel';
import { NavBackButton } from '../components/NavBackButton';
import { ConversationProgress } from '../components/ConversationProgress';
import { FluKeCoin } from '../components/FluKeCoin';
import { StatusBarStyle } from '../services/StatusBarStyle';
import { Haptics } from '../services/Haptics';
import { HoldingHand } from '../services/HoldingHand';

/** 协作面板「只读预览」里的一行消息（对齐小程序 collaborationPreview.rows） */
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
const TIMELINE_MIN_INTERVAL_MS: number = 90;

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
  update(rows: ConversationFeedEntryModel[]): void {
    this.rows = rows;
    for (const listener of this.listeners) {
      listener.onDataReloaded();
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
  @StorageLink('sessions') @Watch('onSessionsChangedForRef') sessions: SessionSummary[] = [];
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
  @State progressLabel: string = '';
  /** 工作步骤展示档位与收起时机（对齐 DSH 客户端 presentation policy） */
  /** 工作步骤展示档位/收起时机：响应式绑定，设置页改完立刻重排 */
  @StorageProp('workStepMode') @Watch('onWorkStepPrefsChanged') workStepMode: string = 'detailed';
  @StorageProp('workStepTiming') @Watch('onWorkStepPrefsChanged') workStepTiming: string = 'completion';
  @StorageLink('statusAppearance') statusAppearance: string = 'classic';

  /** 输入条是否聚焦（决定折叠/展开两态） */
  @State composerFocused: boolean = false;
  /** 输入法高度（vp，EntryAbility 写入 AppStorage）：归零即键盘收起 → 输入条塌回单栏 */
  @StorageLink('keyboardHeightVp') @Watch('onKeyboardChanged') keyboardHeightVp: number = 0;
  /** 指标弹层：'' | run | token | context */
  @State metricPopover: string = '';
  /** 输入条 chip 弹层：'' | model（权限改用系统菜单） */
  @State composerSheet: string = '';
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
  @State metricTitle: string = '';
  @State metricPairs: MetricPair[] = [];

  // ===== 智能体团队（右上角协作入口 + 成员弹层 + 团队内容面板，对齐 dsh-mobile） =====
  @StorageLink('teamVisible') teamVisible: boolean = false;
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
  @State teamSheetOpen: boolean = false;
  @State teamTaskFilter: string = 'all';
  @State teamExpandedTasks: string[] = [];
@State metricTotal: string = '';
  /** 系统状态栏高度（vp）：EntryAbility 建窗时写入 AppStorage，页面据此避让。 */
  @StorageLink('safeTopVp') topInset: number = 0;
  /** 执行图标样式（设置页「执行图标」） */
  @StorageLink('procIconStyle') procIconStyle: string = 'spin-ring';
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
  /** 正在重建列表：这期间的 onReachEnd 是重建造成的，不能当成「用户滑到底」而恢复吸底 */
  private suppressReachEnd: boolean = false;
  private lastTouchAt: number = 0;
  private lastUserScrollAt: number = 0;
  /** 时间线重排节流（流式期间用） */
  /** 主题在本页隐藏时被改过：回到本页需要整表重载一次配色 */
  private themeDirty: boolean = false;
  private timelineTimer: number = -1;
  private lastTimelineUpdateAt: number = 0;

  // ==================== 生命周期 ====================
  aboutToAppear(): void {
    // 其他页面（首页/设置）把全局键盘避让设成了 NONE，进对话页必须恢复：
    // RESIZE = 键盘弹出时根布局收缩，输入条整体上浮到输入法上方（标题栏不动）
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    // 状态栏内容色跟随页面背景：深色纯黑 → 白，浅色灰底 → 黑
    this.applyStatusBarColor();
    this.syncWorkStepPrefs();
    // 团队半模态是全局 StorageLink：上个会话/上个页面残留 true 时，新会话页一打开就被
    // 半模态的遮罩盖住，表现成「整页点不动、滑不动」。进门先收掉。
    this.teamSheetOpen = false;
    this.ready = true;
    this.onSessionsChangedForRef();
    this.loadSkills();
    this.loadRefDirectory();
    this.rebuildRefDirs();
    // 胶囊默认态：设置里控制「默认显示 / 默认收起」
    try {
      this.capsuleExpanded = PreferencesStore.get().getBoolean('capsuleDefaultExpanded', true);
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
    this.progressTimer = setInterval(() => {
      if (!this.pageVisible) {
        return;
      }
      this.refreshProgress();
      // 工作步骤档位兜底轮询：无论设置页走哪条返回路径，1s 内都会按最新偏好重排
      this.syncWorkStepLive();
    }, 1000);
    // 进页恢复该会话上次没发出去的草稿
    this.restoreDraft();
  }

  /** 运行中标题最短展示：id → 已展示标题与时间戳（对齐客户端防抖） */
  private titleHold: Map<string, string> = new Map<string, string>();
  private titleHoldAt: Map<string, number> = new Map<string, number>();

  /** 读取工作步骤展示偏好（对齐 DSH 客户端 presentation policy） */
  private syncWorkStepPrefs(): void {
    const mode: string = WorkStepPresentation.normalizeMode(
      PreferencesStore.get().getString(WorkStepPresentation.MODE_KEY, 'detailed'));
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
      PreferencesStore.get().getString(WorkStepPresentation.MODE_KEY, 'detailed'));
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

  aboutToDisappear(): void {
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
    const system: number = Math.max(0, this.breakdownNum('systemTokens'));
    const tools: number = Math.max(0, this.breakdownNum('toolsTokens'));
    const messages: number = Math.max(0, this.breakdownNum('messageTokens'));
    const total: number = system + tools + messages;
    if (total <= 0) {
      return 0;
    }
    const value: number = key === 'systemTokens' ? system : (key === 'toolsTokens' ? tools : messages);
    return value / total;
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
  private rebuildEntries(): void {
    const source: ConversationItem[] = this.items === undefined ? [] : this.items;
    const built: ConversationFeedEntryModel[] = [];
    let rows: ConversationFeedEntry[] = ConversationFeed.build(source, this.running && this.connection === 'connected');
    // 任何时候都要算策略：运行中也要决定组体是否可见 / 限高 / 标题隐藏
    // （对齐小程序：workSteps.apply 每帧无条件执行，运行态由 policy 内部判断）
    ConversationFeed.applyWorkStepPolicy(rows, this.workStepMode, this.workStepTiming, this.folds);
    // 回合展开时，把组行摊平到它下面当同级行（对齐小程序：turnProcess 行 + 各 processGroup 行，
    // 收起时按 turnProcessKey 过滤）。不嵌套组件——嵌套 @ObjectLink 行在本机会崩。
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
    // 同 id 行复用原实例（@ObjectLink 绑定的就是这个对象），否则展开状态更新不到列表项
    const previous: Map<string, ConversationFeedEntryModel> = new Map<string, ConversationFeedEntryModel>();
    for (const old of this.entries) {
      previous.set(old.id, old);
    }
    for (const entry of rows) {
      const existing: ConversationFeedEntryModel | undefined = previous.get(entry.id);
      if (existing !== undefined) {
        existing.assign(entry, entry.expanded);
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
    if (!structureChanged) {
      return;
    }
    // 手指压在列表上时先不重建：onDataReloaded 会把可见行整体拆掉重建，
    // 正在拖的手势被中断 —— 表现出来就是「运行中滑不动」。抬手后补一次。
    if (this.listTouching) {
      this.pendingStructure = true;
      return;
    }
    // 用户已经往上翻（不再吸底）时，重建后把滚动位置放回去，避免列表自己跳到顶部
    const keepOffset: boolean = !this.autoStick;
    const yOffset: number = keepOffset ? this.scroller.currentOffset().yOffset : 0;
    this.suppressReachEnd = true;
    this.entries = built;
    this.source.update(built);
    setTimeout(() => {
      if (keepOffset) {
        // 用户已经往上翻：无条件把位置放回去（重建会让列表自己跳到别处）
        this.scroller.scrollTo({ xOffset: 0, yOffset: yOffset, animation: false });
      }
      this.suppressReachEnd = false;
    }, 0);
  }

  private onRunningChanged(): void {
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
    if (!this.ready) {
      return;
    }
    if (!this.pageVisible) {
      // 被别的页面盖住时只记账，回到本页再统一重排
      this.pendingItemsWhileHidden = true;
      return;
    }
    // 节点弹层开着：只刷新节点列表（补齐历史/新消息），暂不重排时间线，避免页面跳动
    if (this.turnNavOpen) {
      this.refreshTurnNodes(false);
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
    const wait: number = TIMELINE_MIN_INTERVAL_MS - (Date.now() - this.lastTimelineUpdateAt);
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
    this.lastTimelineUpdateAt = Date.now();
    this.rebuildEntries();
    this.refreshProgress();
    const tail: ConversationFeedEntryModel | null = this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
    const key: string = tail === null ? '' : tail.id + ':' + tail.text.length.toString();
    if (key !== this.lastTailKey) {
      this.lastTailKey = key;
      if (this.autoStick && !this.userInteracting()) {
        setTimeout(() => {
          if (!this.userInteracting()) {
            this.scroller.scrollEdge(Edge.Bottom);
          }
        }, 30);
      }
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

  private refreshProgress(): void {
    if (!this.running) {
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
    const id: string = SessionStore.get().currentSessionId();
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

  /** 选中工作区文件/目录：把行尾 @query 换成 @路径，并加引用 chip */
  private insertPathRef(path: string): void {
    // 同样只清掉 @query：引用以 chip 呈现，发送时再拼进正文
    this.draft = this.stripRefTokens(this.draft);
    console.info('[RefChip] file draft="' + this.draft + '"');
    const slash: number = path.lastIndexOf('/');
    const name: string = slash >= 0 ? path.substring(slash + 1) : path;
    const chip: RefChipItem = {
      key: 'file:' + path + ':' + Date.now().toString(),
      label: name,
      kind: 'file',
      token: '@' + path
    };
    this.refChips = this.refChips.concat([chip]);
    console.info('[RefChip] file added total=' + this.refChips.length + ' path=' + path);
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

  /** 顶栏次要图标色：与「协作」图标（dsh_team / dsh_team_dark 的描边）取同一灰度 */
  private navIconColor(): string {
    return this.isDark ? '#ABB2BE' : '#737985';
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
    this.rebuildEntries();
  }

  /** 步骤行展开/收起（图标槽换成箭头那一层） */
  private onToggleStep(id: string): void {
    const at: number = this.stepOpenIds.indexOf(id);
    const next: string[] = this.stepOpenIds.slice();
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

  private async onSend(): Promise<void> {
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
    const generation: number = client.generation();
    const selected: PickedAttachment[] = this.pickedAttachments.slice();
    try {
      const uploaded: UploadResult[] = [];
      for (const attachment of selected) {
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
      if (uploaded.length > 0) {
        const receipts: UploadReceipt[] = uploaded.map((item: UploadResult): UploadReceipt => ({ receiptId: item.receiptId }));
        const ack = await client.sendUserMessageWithAttachments(text, sessionId, receipts);
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
      if (!this.running) {
        SessionStore.get().appendOptimisticUser(text, selected.length);
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
      // 进入语音态：收起键盘，露出折叠条的长按区
      this.composerFocused = false;
      try {
        this.getUIContext().getFocusController().clearFocus();
      } catch (err) {
      }
    }
  }

  private async pickImageAttachments(): Promise<void> {
    try {
      const picked: PickedAttachment[] = await pickImages(4);
      this.pickedAttachments = picked;
      this.attachmentHint = picked.length > 0 ? '已选择 ' + picked.length + ' 张图片' : '';
    } catch (err) {
      this.attachmentHint = '未选择图片';
    }
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

  private async queueAction(item: QueueItem, action: string): Promise<void> {
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || this.queueBusyId.length > 0) {
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

  private saveGoalEdit(): void {
    const text: string = this.goalDraft.trim();
    this.goalEditing = false;
    if (text.length === 0 || text === this.goal.objective) {
      return;
    }
    this.mutateGoal('goal-edit', text);
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

  @Builder
  dockStack() {
    Column() {
      if (this.queue.length > 0) {
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

  @Builder
  queueDock() {
    Column() {
      if (this.queue.length > 1) {
        Row({ space: this.rpx(20) }) {
          this.queueBubbleIcon(this.rpx(38))
          Text('排队消息 · ' + this.queue.length.toString())
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
      if (this.queueExpanded || this.queue.length === 1) {
        Scroll() {
          Column() {
            ForEach(this.queue, (item: QueueItem, index: number) => {
              Column() {
                Row({ space: this.rpx(8) }) {
                  this.queueBubbleIcon(this.rpx(38))
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
                    if (item.attachmentCount > 0) {
                      Text(item.attachmentCount.toString() + ' 个附件')
                        .fontSize(11)
                        .fontColor(this.subColor())
                        .width('100%')
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
                    // 立即发送只在回合进行中才有意义（网关：current turn no longer accepts steering）；
                    // 回合结束后排队项等下一轮自动发送，不再露出这个按钮。
                    if (this.running && this.steerFailedIds.indexOf(item.id) < 0) {
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
                  }
                  .alignItems(VerticalAlign.Center)
                }
                .width('100%')
                .constraintSize({ minHeight: this.rpx(80) })
                .padding({ left: this.rpx(24), right: this.rpx(8) })
                .alignItems(VerticalAlign.Center)
                .opacity(this.queueBusyId.indexOf(item.id + ':') === 0 ? 0.5 : 1)
                if (index < this.queue.length - 1) {
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
    .borderRadius(this.rpx(36))
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.12)' })
    .backgroundColor(this.surfaceColor())
    .margin({ bottom: this.rpx(12) })
    .clip(true)
  }

  @Builder
  tasksPanel() {
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
    .borderRadius(this.rpx(36))
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.12)' })
    .backgroundColor(this.surfaceColor())
    .margin({ bottom: this.rpx(12) })
    .clip(true)
  }

  @Builder
  goalPanel() {
    if (this.goalEditing) {
      Row({ space: this.rpx(8) }) {
        TextArea({ text: this.goalDraft, placeholder: '目标' })
          .layoutWeight(1)
          .height(this.rpx(76))
          .fontSize(15)
          .fontColor(this.textColor())
          .placeholderColor(this.subColor())
          .backgroundColor('rgba(46,107,230,0.07)')
          .border({ width: 1, color: 'rgba(46,107,230,0.55)', radius: this.rpx(14) })
          .onChange((value: string) => {
            this.goalDraft = value;
          })
        Text('✓')
          .fontSize(20)
          .fontColor(this.subColor())
          .width(this.rpx(56))
          .height(this.rpx(64))
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.saveGoalEdit();
          })
        Text('×')
          .fontSize(22)
          .fontColor(this.subColor())
          .width(this.rpx(56))
          .height(this.rpx(64))
          .textAlign(TextAlign.Center)
          .onClick(() => {
            this.goalEditing = false;
            this.goalDraft = '';
          })
      }
      .width('100%')
      .constraintSize({ minHeight: this.rpx(96) })
      .padding({ left: this.rpx(20), right: this.rpx(16), top: this.rpx(12), bottom: this.rpx(12) })
      .alignItems(VerticalAlign.Center)
      .borderRadius(this.rpx(36))
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.12)' })
      .backgroundColor(this.surfaceColor())
      .margin({ bottom: this.rpx(12) })
    } else {
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
        Text(this.goal.objective)
          .fontSize(15)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.goalBusy) {
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
              this.goalEditing = true;
              this.goalDraft = this.goal.objective;
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
      .borderRadius(this.rpx(36))
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(16,19,24,0.12)' })
      .backgroundColor(this.surfaceColor())
      .margin({ bottom: this.rpx(12) })
    }
  }

  // ==================== 视图 ====================
  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        // 顶栏不再占位：时间线从屏幕顶部铺满，往上滚时内容直接在标题下面穿过去（对齐 iOS 导航栏）
        // 「加载更早记录」与运行条都在滚动内容内部（对齐小程序：横幅在 scroll-view 里，
        // 运行条在列表末尾），随内容一起滚动，而不是固定在容器外的两条横条。
        Column() {
          this.timeline()
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ bottom: this.bottomInset })
        if (this.hint.length > 0) {
          Text(this.hint)
            .fontSize(12)
            .fontColor('#D65D64')
            .width('100%')
            .padding({ left: 20, right: 20, top: 2, bottom: 2 })
        }
        // 输入条容器：小程序 dock-stack 左右 14vp 内边距 + 底部安全区
        Column() {
        // 底部 dock：排队消息 / 任务 / 目标（对齐小程序 dock-stack）
        this.dockStack()
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
            this.composerFocused = focused;
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
          onPickRefPath: (path: string) => {
            this.insertPathRef(path);
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
        .padding({ left: 14, right: 14, bottom: 18 + this.bottomInset })
        // 录音时整条输入区让位给全屏语音特效（对齐小程序 .dock-stack.voice-holding { opacity: 0 }）
        .opacity(this.voiceOverlayVisible ? 0 : 1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
      // 上下都顶到屏幕边缘：内容可以一直滑到状态栏下面（对齐 iOS）
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])

      // 顶部轻毛玻璃：鸿蒙原生最薄的组件材质，透明度高，只做轻微虚化
      this.topBlurBar()

      // 浮动顶栏：透明底叠在时间线之上，内容从它下面滚过（对齐 iOS 导航栏，无遮盖条）
      this.headerBar()

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
      .padding({ left: 16, right: 16, top: this.topInset + 58 })
      .alignItems(HorizontalAlign.Center)
      .zIndex(30)
      .hitTestBehavior(HitTestMode.None)

      // 会话节点胶囊：常显浮层（左右拖动吸附折叠，点击展开/打开弹层）
      if (this.pageW > 0) {
        this.floatingCapsule()
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
        .bindSheet($$this.fileSheetOpen, this.workspaceFilesSheet(), {
          height: '72%',
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.isDark ? '#1C1C1E' : '#FFFFFF'
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
    .hideTitleBar(true)
    .onShown(() => {
      this.pageVisible = true;
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
    })
    .onHidden(() => {
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
  /** 重命名会话弹窗 */
  @State renameSessionOpen: boolean = false;
  @State renameValue: string = '';
  /** 工作区文件 sheet（对齐小程序 files sheet） */
  @State fileSheetOpen: boolean = false;
  @State fileEntries: WorkspaceFileEntry[] = [];
  @State filePath: string = '';
  @State fileLoading: boolean = false;
  @State fileHint: string = '';
  @State fileBusy: boolean = false;

  // ==================== 会话节点弹层（右上角三横线） ====================
  @State turnNavOpen: boolean = false;
  @State turnNodes: TurnNode[] = [];
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
    Logger.info('[EffortDebug] menuValues=' + JSON.stringify(values) + ' modelEfforts=' + JSON.stringify(this.modelEfforts));
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
    const request = sessionId.length > 0
      ? GatewayRequestFactory.make('models', 'models', { 'sessionId': sessionId }, sessionId)
      : GatewayRequestFactory.simple('models');
    client.requestGateway(request, 15000).then((frame: GatewayFrame) => {
      Logger.info('[EffortDebug] modelsFrame=' + JSON.stringify(frame).substring(0, 700));
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
          Logger.info('[EffortDebug] catalogRecord=' + JSON.stringify(m).substring(0, 420));
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
      Logger.info('[EffortDebug] ids=' + JSON.stringify(ids) + ' names=' + JSON.stringify(names));
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
      // 对齐小程序：会话统计弹层右上角显示「x 轮 x 步」
      return this.runMetric();
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
        // 标题行：标题 + 占比（上下文已用）/ 总量（Token 用量）
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
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
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
        .height(36)

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
              .fontSize(14)
              .fontColor(this.subColor())
            Blank()
            Text(pair.value)
              .fontSize(14)
              .fontColor(this.textColor())
          }
          .width('100%')
          .height(38)
          .padding({ left: 8, right: 8 })
          .borderRadius(8)
          .backgroundColor(Color.Transparent)
        }, (pair: MetricPair) => pair.key)
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

  /** 顶栏模糊层的底色：与页面背景同色系的高透明色（浅色 #F2F2F4 / 深色纯黑） */
  private topBlurTint(): string {
    return this.isDark ? 'rgba(0,0,0,0.26)' : 'rgba(242,242,244,0.28)';
  }

  @Builder
  headerBar() {
    // 标题/模式字号已调小；右侧三个圆钮之间收紧，标题与返回钮的间距靠标题自身 margin
    Row({ space: 2 }) {
      // 与右上角 36vp 小圆钮同尺寸：按下/hover 高亮圈一致
      NavBackButton({ isDark: this.isDark, diameter: 36 })
        .id('conversation-back')
        .onClick(() => {
          this.pageStack.pop();
        })

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
        Button({ type: ButtonType.Circle }) {
          // 图标沿用小程序 assets/icons/dsh-team(-dark).svg
          Image(this.isDark ? $r('app.media.dsh_team_dark') : $r('app.media.dsh_team'))
            .width(20)
            .height(20)
            .objectFit(ImageFit.Contain)
        }
        .id('conversation-team')
        // 圆钮缩小：hover/按下的高亮圈随之变小
        .width(36)
        .height(36)
        .backgroundColor(this.teamPopoverOpen
          ? (this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
          : Color.Transparent)
        .accessibilityText('智能体团队')
        .onClick(() => {
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

      // 会话快捷切换：三横线圆钮（对齐小程序 nav-actions 的 session-switch-trigger）
      Button({ type: ButtonType.Circle }) {
        // 侧栏图形：圆角框 + 左侧竖线（对齐小程序 nav-sidebar-glyph；配色与左侧「协作」图标一致）
        // 线宽对齐「协作」图标：dsh_team.svg 为 16 viewBox / stroke 1，显示 20vp → 实际 1.25vp
        Stack({ alignContent: Alignment.TopStart }) {
          Column()
            .width(18)
            .height(16)
            .border({ width: 1.25, color: this.navIconColor() })
            .borderRadius(4)
          Column()
            .width(1.25)
            .height(13.5)
            .backgroundColor(this.navIconColor())
            .margin({ left: 4.9, top: 1.25 })
        }
        .width(18)
        .height(16)
      }
      .id('conversation-session-switch')
      .width(44)
      .height(44)
      .backgroundColor(Color.Transparent)
      .width(36)
      .height(36)
      .accessibilityText('会话快捷切换')
      .onClick(() => {
        if (this.sessionPickerOpen) {
          this.sessionPickerOpen = false;
        } else {
          this.openSessionSwitcher();
        }
      })
      // 与「协作」「⋯」同一个系统菜单容器：原生材质/圆角/描边/弹出动画/点空白收起
      .bindMenu(this.sessionPickerOpen, this.sidebarMenuPanel(), {
        placement: Placement.BottomRight,
        offset: { x: 0, y: 4 },
        outlineColor: this.dividerColor(),
        outlineWidth: 1,
        onWillDisappear: () => {
          this.sessionPickerOpen = false;
        },
        onDisappear: () => {
          this.sessionPickerOpen = false;
        }
      })

      Button({ type: ButtonType.Circle }) {
        Text('⋯').fontSize(18).fontColor(this.textColor())
      }
      .id('conversation-overflow')
      .width(44)
      .height(44)
      .backgroundColor(Color.Transparent)
      .width(36)
      .height(36)
      .accessibilityText('更多')
      .bindMenu(this.moreMenu())
    }
    .width('100%')
    .height(64 + this.topSafe())
    // 左缘与输入条一致（输入条容器 padding 14）：返回按钮和输入框左边缘对齐
    .padding({ left: 14, right: 14, top: 6 + this.topSafe() })
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
      List({ space: 0, scroller: this.scroller }) {
        // 顶部占位：给浮动顶栏让出高度；往上滚时这段空白先滑走，内容直接从标题下面穿过
        ListItem() {
          Column()
            .width('100%')
            .height(64 + this.topSafe())
        }
        LazyForEach(this.source, (entry: ConversationFeedEntryModel) => {
          ListItem() {
            ConversationRowView({
              entry: entry,
              procIconStyle: this.procIconStyle,
              stepOpenIds: this.stepOpenIds,
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
              }
            })
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }, (entry: ConversationFeedEntryModel) => entry.id)
        // 列表尾：运行中的鲸尾状态条在滚动内容末尾（对齐小程序 .progress-strip 在 scroll-view 内）
        if (this.progressLabel.length > 0) {
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
      .contentEndOffset(12)
      .onTouch((event: TouchEvent) => {
        // 只记录触摸，不在这里改 autoStick：轻点某行不应该打断跟随
        if (event.type === TouchType.Down) {
          this.listTouching = true;
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
        // 用户自己拖动过：停掉自动跟随，给一个不被打断的浏览窗口
        this.autoStick = false;
        this.lastUserScrollAt = Date.now();
      })
      .onReachStart(() => {
        // 滑到顶部自动往前翻一页历史（原来这里是一颗「加载更早记录」按钮）
        this.maybeLoadOlder();
      })
      .onReachEnd(() => {
        // 只有「用户自己滑到底」才恢复吸底。流式期间内容不断增长、列表重建也会触发 reachEnd，
        // 若据此恢复吸底，用户往上看的历史会被立刻拽回底部（表现就是「运行时滑不动」）。
        if (!this.suppressReachEnd) {
          this.autoStick = true;
        }
      })

      if (!this.autoStick && this.entries.length > 0) {
        // 回到底部：与「返回」按钮同款的 iOS Liquid Glass 玻璃盘（无实色外圈）
        Row() {
          Stack({ alignContent: Alignment.Center }) {
            // 与「返回」按钮完全同款：iOS Liquid Glass 单一玻璃盘（无实色外圈）
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
            // 中性玻璃：不偏蓝的深灰/白底 + 纯背景模糊（系统材质会带主题色调，这里自己控色）
            .backgroundColor(this.isDark ? 'rgba(44,44,48,0.46)' : 'rgba(255,255,255,0.24)')
            .clip(true)
            .backdropBlur(14)
            // 边缘：白色细边（深 16% / 浅 90%，浅色下靠白边提亮）
            .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.90)' })
            .onClick(() => {
              this.autoStick = true;
              this.scroller.scrollEdge(Edge.Bottom);
            })
          }
          .width(40)
          .height(40)
          .borderRadius(20)
          // 投影与系统菜单同款（画在不裁剪的容器上，Button 会裁剪自身 shadow）
          .shadow({ radius: 14, color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)', offsetX: 0, offsetY: 6 })
        }
        .width('100%')
        .padding({ bottom: 10 })
        .justifyContent(FlexAlign.Center)
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

  /** 弹层打开时把更早历史拉完，节点数覆盖所有轮次（时间线暂不重排） */
  private async warmHistoryForTurnNav(): Promise<void> {
    let guard: number = 0;
    while (this.hasMoreHistory && this.turnNavOpen && guard < 60) {
      if (!SessionStore.get().loadOlder()) {
        break;
      }
      guard += 1;
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 180);
      });
    }
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
    const targetIndex: number = offset + target.entryIndex;
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
  }

  /** 点击胶囊：折叠态先展开；展开态打开会话节点弹层 */
  private tapCapsule(): void {
    if (!this.capsuleExpanded) {
      animateTo({ duration: 240, curve: Curve.EaseOut }, () => {
        this.capsuleExpanded = true;
      });
      return;
    }
    this.openTurnNav();
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
    // 会话节点弹窗：与「协作」「⋯」「侧栏」同一个系统菜单容器（原生材质/圆角/描边/动画/点空白收起）
    .bindMenu(this.turnNavOpen, this.turnNavPanel(), {
      placement: this.capsuleSide === 'left' ? Placement.Right : Placement.Left,
      offset: { x: 4, y: 0 },
      outlineColor: this.dividerColor(),
      outlineWidth: 1,
      onWillDisappear: () => {
        this.turnNavOpen = false;
      },
      onDisappear: () => {
        this.turnNavOpen = false;
      }
    })
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
      // 拖动滑块：上下切换节点（上滑数字减小、下滑增大），松手回中
      .gesture(
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
    }
    .width(TURN_TRACK_WIDTH)
    .height(TURN_TRACK_HEIGHT)
  }

  /** 会话节点弹层内容：交给 bindMenu 的系统菜单容器渲染（材质/圆角/描边/动画/点空白收起全部原生） */
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

  /** 更多菜单行：图标 + 文案（字号/间距对齐系统菜单行） */
  @Builder
  moreMenuRow(icon: Resource, label: string, enabled: boolean) {
    Row({ space: 10 }) {
      Image(icon)
        .width(18)
        .height(18)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTintMatrix(enabled ? this.textColor() : this.subColor()))
      Text(label)
        .fontSize(15)
        .fontColor(enabled ? this.textColor() : this.subColor())
        .maxLines(1)
    }
    .width(208)
    .height(40)
    // 左右留白：内容不贴菜单卡片边缘（原来只有系统内边距，看着挤）
    .padding({ left: 16, right: 16 })
    .opacity(enabled ? 1 : 0.5)
  }

  /** 取消回合行：停止方块图标（无对应素材，按菜单行尺寸绘制） */
  @Builder
  moreMenuStopRow(label: string, enabled: boolean) {
    Row({ space: 10 }) {
      Stack({ alignContent: Alignment.Center }) {
        Rect({ width: 9, height: 9, radius: 2 })
          .fill(enabled ? this.textColor() : this.subColor())
      }
      .width(18)
      .height(18)
      Text(label)
        .fontSize(15)
        .fontColor(enabled ? this.textColor() : this.subColor())
        .maxLines(1)
    }
    .width(208)
    .height(40)
    .padding({ left: 16, right: 16 })
    .opacity(enabled ? 1 : 0.5)
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
      MenuItem(this.moreMenuRow($r('app.media.workspace_folder_white'), '工作区文件', this.hasSession()))
        .id('menu-workspace-files')
        .enabled(this.hasSession())
        .onClick(() => {
          this.openWorkspaceFiles();
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ② 小程序：重命名 / 查看统计
      MenuItem(this.moreMenuRow(this.isDark ? $r('app.media.session_menu_rename_white') : $r('app.media.session_menu_rename_dark'),
        '重命名会话', this.hasSession()))
        .id('menu-rename-session')
        .enabled(this.hasSession())
        .onClick(() => {
          this.beginRenameSession();
        })
      MenuItem(this.moreMenuRow($r('app.media.dsh_gauge'), '查看统计', true))
        .id('menu-session-stats')
        .onClick(() => {
          this.openMetricPopover('run');
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ③ 小程序：插件
      MenuItem(this.moreMenuRow(this.isDark ? $r('app.media.pinwheel_white') : $r('app.media.pinwheel_ink'),
        '浏览更多插件', true))
        .id('menu-browse-plugins')
        .onClick(() => {
          this.pageStack.pushPathByName('plugins', null);
        })
      MenuItem(this.moreMenuRow($r('app.media.plus_white'), '创建你的插件', true))
        .id('menu-create-plugin')
        .onClick(() => {
          this.pageStack.pushPathByName('plugins', null);
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ④ 小程序：回合 / 会话
      MenuItem(this.moreMenuStopRow('取消当前回合', this.running))
        .id('menu-cancel-turn')
        .enabled(this.running)
        .onClick(() => {
          if (this.running) {
            this.onStop();
          }
        })
      MenuItem(this.moreMenuRow($r('app.media.session_menu_archive'), '归档会话', this.hasSession()))
        .id('menu-archive-session')
        .enabled(this.hasSession())
        .onClick(() => {
          this.confirmArchiveSession();
        })

      MenuItem(this.moreMenuDivider()).enabled(false)

      // ⑤ 原有入口
      MenuItem(this.moreMenuRow(this.isDark ? $r('app.media.sliders_white') : $r('app.media.sliders_ink'),
        '会话设置', true))
        .id('menu-session-settings')
        .onClick(() => {
          this.pageStack.pushPathByName('session-settings', null);
        })
    }
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
    this.sessionPickerOpen = true;
  }

  /** 关闭会话快捷切换 */
  private closeSessionSwitcher(): void {
    this.sessionPickerOpen = false;
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

  /** 侧栏面板高度：系统菜单容器会限高，超出部分由内部 Scroll 承担 */
  private convSidebarPanelHeight(): number {
    const full: number = this.convSidebarHeight();
    return full > 560 ? 560 : full;
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
                  Row({ space: 6 }) {
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
        .padding({ top: 5 })
        .alignItems(HorizontalAlign.Start)
        .width(this.convSidebarWidth())
        .padding({ top: 2, bottom: 2 })
  }
}
