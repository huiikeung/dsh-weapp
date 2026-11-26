import { PreferencesStore } from '../common/PreferencesStore';
import { GatewayEvent, GatewayFrame, RawSessionEvent, SessionEvent, GatewayPendingQuestionRequest, GatewayPendingApprovalRequest, GatewayDirectoryItem, GatewayTask } from '../protocol/GatewayDtos';
import { arr, asRec, bool, field, normalizeRawSessionEvent, num, str } from '../protocol/GatewayFrameCodec';
import { GatewayClient } from '../network/GatewayClient';
import { EventProjector } from './EventProjector';
import { TeamStore } from './TeamStore';
import { Logger } from '../common/Logger';
import { NotificationService } from '../common/NotificationService';
import { AttachmentImageCache } from '../common/AttachmentImageCache';
import { isOlderHistoryPage } from './HistoryPageMatcher';
import { CONVERSATION_LIVE_SEQ_BASE, ConversationItem, ConversationItemKind, ConversationProjectionLabels, ConversationProjector } from '../projection/ConversationProjection';
import { ConversationFeed } from '../projection/ConversationFeed';

/** 诊断信息行（对齐小程序 diagnosticRows） */
export interface DiagnosticRow {
  label: string;
  value: string;
  mono: boolean;
}

/** 权限选项：固定四项（对齐小程序 pickDefaultPermission） */
export interface PermissionOption {
  id: string;
  label: string;
  description: string;
  badge: string;
}

/** 模型选项（按 provider 分组）：会话设置弹窗使用 */
export interface ModelOption {
  provider: string;
  providerName: string;
  model: string;
  label: string;
  defaultEffort: string;
  /** 发布徽章（如 1017） */
  badge: string;
}

/** Agent 预设选项：会话设置卡片式弹窗使用 */
export interface PresetOption {
  id: string;
  label: string;
  description: string;
  broken: boolean;
  brokenReason: string;
}

/** 会话 ID 短标签：session-b39e87ab-… → b39e87ab */
function sessionIdLabel(id: string): string {
  const raw: string = id.startsWith('session-') ? id.substring('session-'.length) : id;
  const dash: number = raw.indexOf('-');
  const head: string = dash > 0 ? raw.substring(0, dash) : raw;
  return head.length > 8 ? head.substring(0, 8) : head;
}

/** 队列消息里的图片引用（主机 UserMessage content 里的 image 块） */
export interface QueueImageRef {
  attachmentId: string;
  mediaType: string;
  name: string;
  bytes?: number;
}

export interface QueueItem {
  id: string;
  preview: string;
  /** 这条排队消息带有的图片（按 attachmentId 可拉取缩略图） */
  images?: QueueImageRef[];
  /** 附件数量（图片/文件）：对齐小程序 queue-attachment-label */
  attachmentCount: number;
  /** queued（下一轮）/ steering（本轮插话）/ context（插件上下文） */
  placement: string;
}

/** 会话目标（对齐小程序 goal 卡片）：空 id 表示当前会话没有目标。 */
export interface SessionGoalView {
  id: string;
  revision: number;
  objective: string;
  phase: string;
  phaseLabel: string;
  active: boolean;
}

/** 目标阶段文案（对齐小程序 goalPhaseLabel）。 */
export function goalPhaseLabel(phase: string): string {
  if (phase === 'active') {
    return '进行中的目标';
  }
  if (phase === 'paused') {
    return '已暂停的目标';
  }
  if (phase === 'blocked') {
    return '受阻的目标';
  }
  return '当前目标';
}

/** 空目标：没有目标时也发布一个稳定对象，页面按 id.length 判断是否显示。 */
export function emptySessionGoal(): SessionGoalView {
  return { id: '', revision: 0, objective: '', phase: '', phaseLabel: '', active: false };
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  /** 隐藏目录（. 开头等），默认不在列表里显示 */
  hidden: boolean;
}

/** 目录面包屑（网关返回的祖先链） */
export interface DirCrumb {
  name: string;
  path: string;
}

export interface WorkspaceRow {
  workspaceId: string;
  title: string;
  path: string;
  sessionIds: string[];
}

export interface SessionSummary {
  id: string;
  title: string;
  running: boolean;
  updatedAt: number;
  cwd: string;
  /** 会话的 Agent 预设（运行模式）id：standard / code / minimal / cordis 或自定义 */
  agentPreset: string;
  /**
   * Host 标记的空会话：新建之后还没发过任何消息（sessions 帧的 blank）。
   * dsh 端（桌面/iOS）不把这种会话算进会话列表，这里同样不显示；
   * 本机刚发过消息但主机还没翻标记的那一小段，用 localSent 先按「有对话」处理。
   */
  blank: boolean;
}

export interface SessionRow {
  id: string;
  role: string;   // user | assistant | tool
  text: string;
  seq: number;
}

/**
 * 会话数据层（第一阶段：历史 + 流式文本聚合）。
 * 队列 / 轨迹 / 上下文 / 编队等投影后续在此扩展。
 */
export class SessionStore {
  /** 会话 id → 该会话当前的权限预设（由 permission-options 帧填充，切换会话时页面各取各的） */
  static permissionBySession: Map<string, string> = new Map<string, string>();
  /** 权限表版本号：每次表变化递增，页面通过 @StorageLink('permissionRevision') 感知后重读 */
  static bumpPermissionRevision(): void {
    const prev: number | undefined = AppStorage.get<number>('permissionRevision');
    AppStorage.setOrCreate<number>('permissionRevision', (prev === undefined ? 0 : prev) + 1);
  }
  private static instance: SessionStore = new SessionStore();
  private rows: SessionRow[] = [];
  /** 运行中每 200ms 重投影一次，保证流式过程实时上屏 */
  private liveTimer: number = -1;
  private liveEventCount: number = 0;
  /** 历史回放中：此时不据此设置 running，避免整段历史把状态来回翻 */
  private replayingHistory: boolean = false;
  /** 会话列表轮询：网关只推迟到快照，首页状态需要主动拉取 */
  private sessionsTimer: number = -1;
  /** 进行中的 sessions 请求去重：轮询/事件触发/前台刷新可能同时要列表 */
  private sessionsInFlight: boolean = false;
  /** 在途请求的发出时刻：超时后允许重新发起，避免一次卡住的请求长期挡住轮询 */
  private sessionsInFlightAt: number = 0;
  /** 事件触发的会话列表校准节流（毫秒）：避免每个 token 帧都请求主机快照 */
  private lastSessionsSyncAt: number = 0;
  /** 最近一次收到实时事件的时间：用来决定列表轮询是快速还是降频 */
  private lastEventAt: number = 0;
  /** 最近一次请求会话列表的时间（低频兜底用） */
  private lastSessionsPollAt: number = 0;
  /**
   * 本地刚改过「运行中」的会话与改动时刻。
   * 列表快照可能是这次改动之前生成的，直接覆盖会把刚亮起的状态又抹掉，
   * 所以本地结论在 2.5s 内优先，之后无条件让位给主机。
   */
  private localRunningAt: Map<string, boolean> = new Map<string, boolean>();
  /** 上一次写进 AppStorage 的列表指纹：内容没变就不再重绘/落盘 */
  private sessionsSignature: string = '';
  /** 上一次写入的 agentWorkActive：相同就不重复派发 */
  private agentWorkActive: boolean = false;
  private localRunningMarkAt: Map<string, number> = new Map<string, number>();
  private sessionId: string = '';
  private gatewayKey: string = '';
  private attached: boolean = false;
  private client: GatewayClient | null = null;
  private oldestSeq: number = 0;
  private hasMore: boolean = false;
  private rawEvents: RawSessionEvent[] = [];
  private olderRequestPending: boolean = false;
  private olderRequestCursor: number = 0;
  /** 回放窗口大小：初始 300 条；每加载一页更早历史就扩大，保证新加载的旧消息能被投影出来 */
  private replayWindow: number = 300;
  private historyFormatVersion: number = 0;
  private sessionGeneration: number = 0;
  /** 任务/目标快照的 asOfSeq（旧帧丢弃，对齐小程序 tasksAsOfSeq / goalAsOfSeq） */
  private tasksSeq: number = -1;
  private goalSeq: number = -1;
  /**
   * 本机刚发过消息的会话 id：主机把 sessions 帧里的 blank 翻成 false 之前（通常 1 秒内），
   * 列表先按「有对话」处理，避免刚发完消息回首页时看不到这条会话。
   */
  private localSent: Set<string> = new Set<string>();
  /** 乐观回显的本地用户消息（对齐小程序 appendLocalUserRow.pending，回显到达时就地合并） */
  private optimisticUsers: ConversationItem[] = [];
  /** 每条乐观气泡发送时刻已存在的投影条目数：决定它插在时间线的哪个位置 */
  private optimisticSince: number[] = [];
  /** 发送时的本地图片 URI 队列：真实 user/message 回显时按序挂到那一行（对齐小程序 localUrl） */
  private pendingLocalImages: string[][] = [];
  /** 运行态防抖锁：本机刚判定的「运行中」在这之前不接受列表的「已结束」覆盖 */
  private runningLockUntil: number = 0;
  /** 上次发布的内容签名：内容没变就不写 AppStorage，避免 50ms 一次的无意义重排 */
  private publishedSignature: string = '';
  /** 结算宽限定时器（对齐小程序 scheduleSettleClear） */
  private settleTimer: number = 0;
  /** 上次补拉历史的时刻（限流，避免把网关打爆） */
  private lastCatchUpAt: number = 0;
  /** 上次（重新）订阅的时刻 */
  private lastSubscribeAt: number = 0;
  /** 最近一次收到 turn/end 的时刻：这段时间内不采纳「列表说还在跑」的滞后状态 */
  private turnEndedAt: number = 0;
  /** 投影里已经吃到的最大的事件 seq：用于补拉时只增量追加新事件 */
  private projectedMaxSeq: number = 0;
  /** 模型目录内容签名：相同就不重复写 AppStorage（避免触发页面 @Watch 死循环） */
  private modelDetailsSignature: string = '';
  /** 最近一次队列快照（队列操作成功后可本地先删一条，再等权威帧覆盖） */
  private queueItems: QueueItem[] = [];
  /** 会话历史首屏加载中：页面用骨架代替「新建会话」空状态，避免有记录的会话闪出空态 */
  private historyLoadingTimer: number = -1;
  private questions: Map<string, GatewayPendingQuestionRequest> = new Map();
  private approvals: Map<string, GatewayPendingApprovalRequest> = new Map();
  /** 对话投影（生成时间线用的过程条目）；与轨迹投影 EventProjector 并行存在。 */
  private conversation: ConversationProjector | null = null;
  /** 当前会话是否正在生成：turn/start 起，turn/end 止。 */
  private running: boolean = false;
  /** 正在吃 assistant-stream 增量（仅用于状态记录） */
  private assistantStreamActive: boolean = false;
  /**
   * 每轮 token 用量（对话页脚「用量」按钮）：turnKey → 累计值。
   * 同一回合可能有多次 attempt/重试，按小程序 turn-usage 的口径累加（都是真实计费）。
   */
  private turnTokenTotals: Map<string, number[]> = new Map<string, number[]>();
  /** 每轮的提供方/模型（用量弹窗首行「提供方 / 模型」） */
  private turnRoutes: Map<string, string> = new Map<string, string>();
  /**
   * 最近一段流式正文（对齐小程序 sessionState.lastAssistantText）：
   * 网关收尾时可能先推「不含当前答复」的快照/事件，这里留着文本用于回填，
   * 否则回合一结束正文会整段消失，只能等历史重拉。
   */
  private lastAssistantText: string = '';
  /** 回填用答复正文 + 时间：投影里没有最终答复时，发布投影时补到时间线末尾 */
  private fallbackAssistantText: string = '';
  private fallbackAssistantAt: number = 0;

  static get(): SessionStore {
    return SessionStore.instance;
  }

  attach(client: GatewayClient): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.client = client;
    this.startSessionsPoll();
    client.onFrame((frame: GatewayFrame) => this.consume(frame));
    Logger.info('session store attached');
  }

  prepareGateway(key: string): void {
    if (this.gatewayKey.length > 0 && this.gatewayKey !== key) {
      this.sessionId = '';
      this.rows = [];
      this.rawEvents = [];
      this.oldestSeq = 0;
      this.hasMore = false;
      this.historyFormatVersion = 0;
      this.olderRequestPending = false;
      this.olderRequestCursor = 0;
      this.running = false;
      this.localRunningAt.clear();
      this.localRunningMarkAt.clear();
      this.clearPendingPrompts();
      EventProjector.get().reset();
      this.resetConversation();
      AppStorage.setOrCreate<SessionSummary[]>('sessions', []);
      AppStorage.setOrCreate<QueueItem[]>('queueItems', []);
      AppStorage.setOrCreate<number>('queueCount', 0);
      AppStorage.setOrCreate<GatewayTask[]>('sessionTasks', []);
      AppStorage.setOrCreate<SessionGoalView>('sessionGoal', emptySessionGoal());
      AppStorage.setOrCreate<boolean>('goalBusy', false);
      this.tasksSeq = -1;
      this.goalSeq = -1;
      AppStorage.setOrCreate<boolean>('historyHasMore', false);
      AppStorage.setOrCreate<number>('historyOldestSeq', 0);
      this.publish();
    }
    this.gatewayKey = key;
  }

  resumeAfterConnect(): void {
    this.olderRequestPending = false;
    this.olderRequestCursor = 0;
    if (this.client !== null && this.sessionId.length > 0) this.client.openSession(this.sessionId);
  }

  /** 每会话运行模式（Agent 预设）缓存：sessionId → preset id，映射写进 AppStorage 供页面订阅。 */
  static rememberSessionPreset(sessionId: string, preset: string): void {
    if (sessionId.length === 0 || preset.length === 0) {
      return;
    }
    const current: Record<string, Object> = (AppStorage.get<Record<string, Object>>('sessionAgentPresets') ?? {}) as Record<string, Object>;
    if (String(current[sessionId] ?? '') === preset) {
      return;
    }
    current[sessionId] = preset;
    AppStorage.setOrCreate<Record<string, Object>>('sessionAgentPresets', current);
  }

  /** 读某会话的运行模式；没有时返回空串（由页面回退到默认或列表值）。 */
  static sessionPreset(sessionId: string): string {
    if (sessionId.length === 0) {
      return '';
    }
    const current: Record<string, Object> = (AppStorage.get<Record<string, Object>>('sessionAgentPresets') ?? {}) as Record<string, Object>;
    return String(current[sessionId] ?? '');
  }

  currentSessionId(): string {
    return this.sessionId;
  }

  pendingQuestion(sessionId: string): GatewayPendingQuestionRequest | null {
    let pending: GatewayPendingQuestionRequest | null = null;
    this.questions.forEach((request: GatewayPendingQuestionRequest) => {
      if (pending === null && request.sessionId === sessionId) pending = request;
    });
    return pending;
  }

  pendingApproval(sessionId: string): GatewayPendingApprovalRequest | null {
    let pending: GatewayPendingApprovalRequest | null = null;
    this.approvals.forEach((request: GatewayPendingApprovalRequest) => {
      if (pending === null && request.sessionId === sessionId) pending = request;
    });
    return pending;
  }

  clearPendingPrompts(): void {
    this.questions.clear();
    this.approvals.clear();
    this.publishPendingQuestion();
    this.publishPendingApproval();
  }

  /** 把当前会话等待中的问题发布到 AppStorage（会话页「确认选择」弹窗订阅它）。 */
  publishPendingQuestion(): void {
    const pending: GatewayPendingQuestionRequest | null = this.pendingQuestion(this.sessionId);
    const json: string = pending === null ? '' : JSON.stringify(pending);
    Logger.info('[Q] store publish len=' + json.length.toString() + ' session=' + this.sessionId.slice(-8));
    AppStorage.setOrCreate<string>('pendingQuestionJson', json);
  }

  /** 把当前会话等待中的工具审批发布到 AppStorage（会话页「等待审批」卡片订阅它）。 */
  publishPendingApproval(): void {
    const pending: GatewayPendingApprovalRequest | null = this.pendingApproval(this.sessionId);
    const json: string = pending === null ? '' : JSON.stringify(pending);
    Logger.info('[A] store publish len=' + json.length.toString() + ' session=' + this.sessionId.slice(-8));
    AppStorage.setOrCreate<string>('pendingApprovalJson', json);
  }

  /** 会话页出现/切换会话时主动刷新一次待回答问题（避免错过早期帧）。 */
  refreshPendingQuestion(): void {
    this.publishPendingQuestion();
  }

  /** 会话页出现/切换会话时主动刷新一次待审批（避免错过早期帧）。 */
  refreshPendingApproval(): void {
    this.publishPendingApproval();
  }

  consume(frame: GatewayFrame): void {
    // 流式正文：网关运行中会高频推送 assistant-stream（start/chunk/end），
    // 以前只吃粗粒度的 event 帧，正文要等很久才刷新；这里直接折叠进投影（对齐小程序 handleAssistantStream）。
    if (frame.kind === 'assistant-stream' || frame.kind === 'assistant-stream-v1') {
      this.consumeAssistantStream(frame);
      return;
    }
    if (frame.kind === 'question-requested' && frame.sessionId && frame.rpcId) {
      this.questions.set(JSON.stringify([frame.sessionId, frame.rpcId]), { rpcId: frame.rpcId, sessionId: frame.sessionId,
        questions: frame.questions ?? [], replay: frame.replay === true });
      this.publishPendingQuestion();
      return;
    }
    if (frame.kind === 'approval-requested' && frame.sessionId && frame.rpcId) {
      this.approvals.set(JSON.stringify([frame.sessionId, frame.rpcId]), { rpcId: frame.rpcId, sessionId: frame.sessionId,
        approvalId: frame.approvalId ?? '', toolName: frame.toolName ?? '工具操作',
        callId: frame.callId, reason: frame.reason, replay: frame.replay === true });
      this.publishPendingApproval();
      return;
    }
    if (frame.kind === 'question-resolved' && frame.rpcId) {
      const keys: string[] = [];
      this.questions.forEach((request: GatewayPendingQuestionRequest, key: string) => {
        if (request.rpcId === frame.rpcId && (!frame.sessionId || frame.sessionId === request.sessionId)) keys.push(key);
      });
      if (keys.length === 1) this.questions.delete(keys[0]);
      this.publishPendingQuestion();
      return;
    }
    if (frame.kind === 'approval-resolved' && frame.rpcId) {
      const keys: string[] = [];
      this.approvals.forEach((request: GatewayPendingApprovalRequest, key: string) => {
        if (request.rpcId === frame.rpcId && (!frame.sessionId || frame.sessionId === request.sessionId)) keys.push(key);
      });
      if (keys.length === 1) this.approvals.delete(keys[0]);
      this.publishPendingApproval();
      return;
    }
    if (frame.kind === 'context-dashboard') {
      if (frame.value !== undefined) {
        AppStorage.setOrCreate<Object>('contextDashboard', frame.value);
      }
      return;
    }
    if (frame.kind === 'context-fleet') {
      if (frame.value !== undefined) {
        AppStorage.setOrCreate<Object>('contextFleet', frame.value);
      }
      return;
    }
    if (frame.kind === 'context-usage') {
      AppStorage.setOrCreate<Object>('contextUsage', frame as Object);
      return;
    }
    if (frame.kind === 'select-model') {
      // 主机回执可能只带模型名：与本地选中态合并（对齐小程序 store.js）
      const selected = asRec(field(frame, 'selected'));
      if (selected !== undefined) {
        const model: string = str(selected, 'model') ?? '';
        const provider: string = str(selected, 'provider') ?? '';
        const effort: string = str(selected, 'reasoningEffort') ?? '';
        if (model.length > 0) {
          AppStorage.setOrCreate<string>('selectedModel', model);
        }
        if (provider.length > 0) {
          AppStorage.setOrCreate<string>('selectedProvider', provider);
        }
        if (effort.length > 0) {
          AppStorage.setOrCreate<string>('selectedEffort', effort);
        }
      }
      return;
    }
    if (frame.kind === 'session-queue') {
      this.consumeQueue(frame.sessionId !== undefined ? frame.sessionId : this.sessionId, frame.items);
      return;
    }
    if (frame.kind === 'session-queues') {
      const queues = asRec(frame.queues);
      if (queues !== undefined && this.sessionId.length > 0) {
        const items = queues[this.sessionId];
        if (Array.isArray(items)) {
          this.consumeQueue(this.sessionId, items as Object[]);
        }
      }
      return;
    }
    if (frame.kind === 'queue-item-updated' || frame.kind === 'queue-updated') {
      if (this.client !== null && this.sessionId.length > 0) {
        this.client.requestQueue(this.sessionId).catch(() => {});
      }
      return;
    }
    if (frame.kind === 'tasks' || frame.kind === 'tasks-updated') {
      const seq: number = frame.asOfSeq !== undefined ? frame.asOfSeq : -1;
      if (this.tasksSeq < 0 || seq < 0 || seq >= this.tasksSeq) {
        this.consumeTasks(frame.todos);
        this.tasksSeq = seq;
      }
      return;
    }
    if (frame.kind === 'goal' || frame.kind === 'goal-updated') {
      const seq: number = frame.asOfSeq !== undefined ? frame.asOfSeq : -1;
      if (this.goalSeq < 0 || seq < 0 || seq >= this.goalSeq) {
        this.consumeGoal(frame.goal);
        this.goalSeq = seq;
      }
      AppStorage.setOrCreate<boolean>('goalBusy', false);
      return;
    }
    if (frame.kind === 'goal-edited' || frame.kind === 'goal-paused' || frame.kind === 'goal-resumed'
      || frame.kind === 'goal-cleared') {
      // 变更回执：立刻拉一次权威快照（对齐小程序 goal-edited/paused/resumed/cleared 处理）
      AppStorage.setOrCreate<boolean>('goalBusy', false);
      if (this.client !== null && this.sessionId.length > 0) {
        this.client.requestGoal(this.sessionId).catch(() => {});
      }
      return;
    }
    if (frame.kind === 'session-pins') {
      this.consumePinnedSessions(frame);
      return;
    }
    if (frame.kind === 'sessions') {
      this.consumeSessions(frame);
      return;
    }
    if (frame.kind === 'workspaces') {
      this.consumeWorkspaces(frame);
      return;
    }
    if (frame.kind === 'workspace-create') {
      if (this.client !== null) {
        this.client.requestWorkspaces();
      }
      return;
    }
    if (frame.kind === 'default-model' || frame.kind === 'save-default-model') {
      // 主机默认模型：selection 或 saved（对齐小程序 state.defaultModel）
      const selection = asRec(field(frame, 'selection'));
      const saved = asRec(field(frame, 'saved'));
      const source = selection !== undefined ? selection : saved;
      if (source !== undefined) {
        const model: string = str(source, 'model') ?? '';
        const provider: string = str(source, 'provider') ?? '';
        const effort: string = str(source, 'reasoningEffort') ?? '';
        if (model.length > 0) {
          AppStorage.setOrCreate<string>('defaultModel', model);
        }
        if (provider.length > 0) {
          AppStorage.setOrCreate<string>('defaultProvider', provider);
        }
        if (effort.length > 0) {
          AppStorage.setOrCreate<string>('defaultEffort', effort);
        }
      }
      return;
    }
    if (frame.kind === 'host') {
      // 主机信息（对齐小程序 normalizeHostInfo）：新版用 defaultModel/defaultProvider，
      // 旧版用 model/provider；存 AppStorage 供会话设置「主机信息」兜底显示。
      const hostDefaultModel: string = str(frame, 'defaultModel') ?? '';
      const hostProvider: string = hostDefaultModel.length > 0
        ? (str(frame, 'defaultProvider') ?? '') : (str(frame, 'provider') ?? '');
      const hostModel: string = hostDefaultModel.length > 0 ? hostDefaultModel : (str(frame, 'model') ?? '');
      const hostCwd: string = str(frame, 'cwd') ?? '';
      if (hostProvider.length > 0) {
        AppStorage.setOrCreate<string>('hostProvider', hostProvider);
      }
      if (hostModel.length > 0) {
        AppStorage.setOrCreate<string>('hostModel', hostModel);
      }
      if (hostCwd.length > 0) {
        AppStorage.setOrCreate<string>('hostCwd', hostCwd);
      }
      // host 帧也可能带网关版本：以最新上报为准（对齐小程序 store.js 的 host 分支）
      const hostGatewayVersion: string = str(frame, 'gatewayVersion') ?? '';
      if (hostGatewayVersion.length > 0) {
        AppStorage.setOrCreate<string>('gatewayVersion', hostGatewayVersion);
        AppStorage.setOrCreate<string>('gatewayPluginVersion', hostGatewayVersion);
        const hostGatewayPackage: string = str(frame, 'gatewayPackage') ?? '';
        if (hostGatewayPackage.length > 0) {
          AppStorage.setOrCreate<string>('gatewayPackage', hostGatewayPackage);
        }
      }
      return;
    }
    if (frame.kind === 'agent-team' || frame.kind === 'agent-team-mode-set') {
      // 团队协作开关回执：把 agentTeam 投影交给 TeamStore（成员/任务/enabled 一起刷新）
      const teamRecord: Record<string, Object> | undefined = asRec(field(frame, 'agentTeam'));
      const teamSession: string = frame.sessionId !== undefined && frame.sessionId.length > 0
        ? frame.sessionId : this.currentSessionId();
      if (teamRecord !== undefined && teamSession.length > 0) {
        const values: Record<string, Object> = {};
        values['agentTeam'] = teamRecord;
        const projection: Record<string, Object> = {};
        projection['values'] = values;
        TeamStore.get().ingestProjection(teamSession, projection);
      } else if (frame.kind === 'agent-team-mode-set') {
        // 回执只带 enabled 布尔值时也要同步开关
        const enabledFlag: boolean = bool(frame, 'enabled') ?? false;
        TeamStore.get().setEnabled(enabledFlag);
      }
      return;
    }
    if (frame.kind === 'defaults') {
      Logger.info('defaults frame: preset=' + (str(frame, 'agentPresetDefault') ?? '')
        + ' perm=' + (str(frame, 'permissionDefault') ?? '')
        + ' model=' + (str(frame, 'model') ?? '')
        + ' provider=' + (str(frame, 'provider') ?? '')
        + ' effort=' + (str(frame, 'reasoningEffort') ?? ''));
      // 网关的 defaults 帧常不带 model/provider（为空）：不能把空值写回，否则会清掉用户刚选的默认模型
      const defPreset: string = str(frame, 'agentPresetDefault') ?? '';
      const defModel: string = str(frame, 'model') ?? '';
      const defProvider: string = str(frame, 'provider') ?? '';
      const defPermission: string = str(frame, 'permissionDefault') ?? '';
      const defEffort: string = str(frame, 'reasoningEffort') ?? '';
      // 网关下发的是部署默认值：用户在本机选过预设后不再覆盖，否则每次刷新都会跳回旧模式
      const localPreset: string = PreferencesStore.get().getString('defaultAgentPreset', '');
      if (defPreset.length > 0 && localPreset.length === 0) {
        AppStorage.setOrCreate<string>('defaultAgentPreset', defPreset);
      }
      if (defModel.length > 0) {
        AppStorage.setOrCreate<string>('defaultModel', defModel);
      }
      if (defProvider.length > 0) {
        AppStorage.setOrCreate<string>('defaultProvider', defProvider);
      }
      if (defEffort.length > 0) {
        AppStorage.setOrCreate<string>('defaultEffort', defEffort);
      }
      const localPermission: string = PreferencesStore.get().getString('defaultPermission', '');
      if (defPermission.length > 0 && localPermission.length === 0) {
        AppStorage.setOrCreate<string>('defaultPermission', defPermission);
      }
      return;
    }
    if (frame.kind === 'session-agent-preset' || frame.kind === 'session-agent-preset-updated' || frame.kind === 'select-agent-preset') {
      const target: string = frame.sessionId !== undefined && frame.sessionId.length > 0 ? frame.sessionId : this.sessionId;
      const preset: string = str(frame, 'agentPreset') ?? '';
      if (target.length > 0 && preset.length > 0) {
        SessionStore.rememberSessionPreset(target, preset);
      }
      return;
    }
    if (frame.kind === 'agent-presets') {
      const names: string[] = [];
      // 详细预设：供会话设置的卡片式弹窗（名称 / ID / 描述 / 失效原因）
      const details: PresetOption[] = [];
      const rawPresets: Object | undefined = field(frame, 'presets');
      const presets: Object[] = rawPresets !== undefined && Array.isArray(rawPresets) ? rawPresets as Object[]
        : (frame.items !== undefined ? frame.items : []);
      for (const one of presets) {
        const id: string = str(one, 'id') ?? '';
        if (id.length > 0) {
          const name: string = str(one, 'name') ?? id;
          names.push(name);
          const brokenReason: string = str(one, 'brokenReason') ?? '';
          details.push({
            id: id,
            label: name,
            description: str(one, 'description') ?? '',
            broken: (bool(one, 'broken') ?? false) || brokenReason.length > 0,
            brokenReason: brokenReason
          });
        }
      }
      AppStorage.setOrCreate<string[]>('agentPresetList', names);
      AppStorage.setOrCreate<PresetOption[]>('agentPresetDetails', details);
      return;
    }
    if (frame.kind === 'models') {
      const names: string[] = [];
      // 详细模型：按 provider 分组（对齐小程序 showModelSheet）
      const details: ModelOption[] = [];
      const rawGroups: Object | undefined = field(frame, 'groups');
      const groups: Object[] = rawGroups !== undefined && Array.isArray(rawGroups) ? rawGroups as Object[] : [];
      for (const group of groups) {
        // 网关的 models 帧里分组是 { id, name, models }（对齐小程序 group.id / group.name）
        const provider: string = str(group, 'id') ?? (str(group, 'provider') ?? '');
        const providerName: string = str(group, 'name') ?? (str(group, 'providerName') ?? provider);
        const rawModels: Object | undefined = field(group, 'models');
        const models: Object[] = rawModels !== undefined && Array.isArray(rawModels) ? rawModels as Object[] : [];
        for (const one of models) {
          const modelId: string = str(one, 'id') ?? str(one, 'model') ?? '';
          if (modelId.length === 0) {
            continue;
          }
          let label: string = str(one, 'name') ?? modelId;
          // 网关部分 provider 的 name 与 provider 同名（如 deepseek）：回退显示模型 id，避免所有模型都叫 deepseek
          if (label.length === 0 || label === provider || label === providerName) {
            label = modelId;
          }
          names.push(label);
          details.push({
            provider: provider,
            providerName: providerName,
            model: modelId,
            label: label,
            defaultEffort: str(one, 'defaultEffort') ?? '',
            // 发布徽章（对齐小程序 deepseek-model-label-1017 插件口径）
            badge: (provider === 'deepseek-account' || provider === 'deepseek-official')
              && modelId === 'deepseek-flash' && label === 'DeepSeek-V4.1-Flash' ? '1017' : ''
          });
        }
      }
      // 同组内所有模型 name 相同（网关常把 provider 名当模型名）时，改用模型 id
      for (const one of details) {
        let same: number = 0;
        let total: number = 0;
        for (const other of details) {
          if (other.provider === one.provider) {
            total++;
            if (other.label === one.label) {
              same++;
            }
          }
        }
        if (total > 1 && same === total) {
          one.label = one.model;
        }
      }

      // 内容没变就不写：这两项挂着页面 @Watch，重复写会触发无意义的重新请求/重排
      let modelSignature: string = '';
      for (const one of details) {
        modelSignature += one.provider + '/' + one.model + ';';
      }
      if (modelSignature !== this.modelDetailsSignature) {
        this.modelDetailsSignature = modelSignature;
        AppStorage.setOrCreate<string[]>('modelList', names);
        AppStorage.setOrCreate<ModelOption[]>('modelDetails', details);
        let dbg: string = '';
        for (const one of details.slice(0, 5)) {
          dbg += one.provider + '/' + one.model + '=' + one.label + '; ';
        }
        Logger.info('modelDetails: ' + dbg);
      }
      // 目录里的 current 才是「当前模型」的真实来源（defaults 只给新建会话的默认值）
      const current: Object | undefined = field(frame, 'current');
      if (current !== undefined) {
        const currentModel: string = str(current, 'model') ?? '';
        const currentProvider: string = str(current, 'provider') ?? '';
        const currentEffort: string = str(current, 'reasoningEffort') ?? '';
        if (currentModel.length > 0) {
          AppStorage.setOrCreate<string>('selectedModel', currentModel);
          AppStorage.setOrCreate<string>('selectedProvider', currentProvider);
        }
        if (currentEffort.length > 0) {
          AppStorage.setOrCreate<string>('selectedEffort', currentEffort);
        }
      }
      return;
    }
    if (frame.kind === 'permission') {
      // 网关确认某个会话的权限已生效（对齐小程序 store.js: sessionState.permission = frame.set）
      const setPermission: string | undefined = str(frame, 'set');
      const frameSid: string | undefined = str(frame, 'sessionId');
      const sid: string = frameSid !== undefined && frameSid.length > 0 ? frameSid : this.currentSessionId();
      if (setPermission !== undefined && setPermission.length > 0 && sid.length > 0) {
        SessionStore.permissionBySession.set(sid, setPermission);
        SessionStore.bumpPermissionRevision();
      }
      return;
    }
    if (frame.kind === 'permission-options') {
      // 会话级权限当前值（对齐小程序 store.js：sessionPermissions.currentValue）。
      // 注意：这是「某个会话」的值，不能写进全局 defaultPermission —— 那是所有会话页共享的单值，
      // 写进去就会出现「每个对话都显示同一个权限（如工作区写入）」。按会话 id 记忆，页面各读各的。
      const sessionPermissions = asRec(field(frame, 'sessionPermissions'));
      Logger.info('permission-options: session=' + (str(frame, 'sessionId') ?? '(global)')
        + ' current=' + (sessionPermissions !== undefined ? (str(sessionPermissions, 'currentValue') ?? '(empty)') : '-'));
      if (sessionPermissions !== undefined) {
        const currentValue: string = str(sessionPermissions, 'currentValue') ?? str(sessionPermissions, 'preset') ?? '';
        if (currentValue.length > 0) {
          const frameSid: string | undefined = str(field(frame, 'sessionId') as Record<string, Object>, '');
          const sid: string = frameSid !== undefined && frameSid.length > 0 ? frameSid : SessionStore.get().currentSessionId();
          if (sid.length > 0) {
            SessionStore.permissionBySession.set(sid, currentValue);
            SessionStore.bumpPermissionRevision();
          }
        }
      }
      const names: string[] = [];
      const values: string[] = [];
      const rawOpts: Object | undefined = field(frame, 'options');
      const opts: Object[] = rawOpts !== undefined && Array.isArray(rawOpts) ? rawOpts as Object[]
        : (frame.items !== undefined ? frame.items : []);
      for (const one of opts) {
        const value: string = str(one, 'value') ?? str(one, 'id') ?? '';
        if (value.length > 0) {
          names.push(str(one, 'name') ?? value);
          values.push(value);
        }
      }
      AppStorage.setOrCreate<string[]>('permissionList', names);
      AppStorage.setOrCreate<string[]>('permissionValues', values);
      return;
    }
    if (frame.kind === 'directories') {
      this.consumeDirectories(frame);
      return;
    }
    if (frame.kind === 'directory-created') {
      // 新建目录后重新拉取当前目录，让列表里立刻出现新文件夹（对齐小程序创建后刷新）
      const opened: string = AppStorage.get<string>('dirCurrent') ?? '';
      GatewayClient.get().requestDirectories(opened);
      return;
    }
    if (frame.kind === 'history') {
      const responseSession: string = frame.sessionId !== undefined ? frame.sessionId : this.sessionId;
      if (this.sessionId.length > 0 && responseSession !== this.sessionId) return;
      // 标题补全的响应：只抽用户轮次标题，不并入时间线状态（避免长会话重投影卡死）
      if (this.titleFetchExpecting && responseSession === this.titleFetchSession
        && frame.beforeSeq !== undefined && frame.beforeSeq === this.titleFetchCursor) {
        this.consumeTitlePage(frame);
        return;
      }
      // 历史本身就是一次权威对齐：刷新活跃时刻，避免紧接着又触发补拉
      this.lastLiveEventAt = Date.now();
      const historyProjections: Record<string, Object> | undefined = asRec(field(frame, 'projections'));
      if (historyProjections !== undefined) {
        TeamStore.get().ingestProjection(responseSession, historyProjections);
      }
      const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
      const wasOlderPage: boolean = this.olderRequestPending && isOlderHistoryPage(frame, this.olderRequestCursor);
      const competingTail: boolean = this.olderRequestPending && !wasOlderPage && frame.resetRequired !== true;
      if (wasOlderPage || frame.resetRequired === true) {
        this.olderRequestPending = false;
        this.olderRequestCursor = 0;
        this.clearOlderRequestTimeout();
      }
      if (!wasOlderPage && frame.historyFormatVersion !== undefined) {
        this.historyFormatVersion = frame.historyFormatVersion;
      }
      // Keep live frames received while the snapshot was in flight and merge by event sequence.
      if (frame.resetRequired === true || (frame.replace === true && !wasOlderPage)) {
        this.replaceSnapshot(events, frame.cursor, frame.resetRequired === true);
      } else {
        this.rawEvents = this.mergeHistoryEvents(events, this.rawEvents);
      }
      // 批量补拉期间只合并事件，重投影留到 endBulkOlder() 统一做。
      // 关键：非 reset 补拉只把「比投影更新的那几条」追加进去，
      // 绝不整表重放 —— 全量重放几千条事件会阻塞主线程数秒，
      // 系统直接按 THREAD_BLOCK_6S 杀掉进程（App 莫名消失、页面冻结的真正原因）。
      if (wasOlderPage) {
        // 补拉的更早一页：扩大回放窗口后重投影，否则旧事件虽然合进了 rawEvents，
        // 但投影窗口仍然只覆盖最近 300 条 → 页面上永远看不到更早的消息。
        this.replayWindow = Math.min(4000, this.replayWindow + events.length + 60);
        Logger.info('[PULL] older page events=' + events.length.toString()
          + ' raw=' + this.rawEvents.length.toString() + ' window=' + this.replayWindow.toString()
          + ' oldestSeq=' + this.oldestSeq.toString());
      }
      if (this.bulkOlderDepth === 0) {
        // 只要已经有投影，就走增量追加：网关的快照帧经常带 replace/resetRequired，
        // 以前会被当成「必须整表重放」，于是每次补拉都阻塞主线程数秒（THREAD_BLOCK 被系统杀掉）。
        // 增量只追加 seq 比投影新的那几条，replace 掉的历史本来也不影响已渲染的尾部。
        if (wasOlderPage) {
          this.rebuildProjection();
        } else if (this.projectedMaxSeq > 0 && this.conversation !== null) {
          this.appendNewerEvents();
        } else {
          this.rebuildProjection();
        }
      }
      if (!competingTail && frame.hasMore !== undefined) this.hasMore = frame.hasMore;
      let minSeq: number = 0;
      for (const raw of this.rawEvents) {
        if (raw.seq > 0 && (minSeq === 0 || raw.seq < minSeq)) minSeq = raw.seq;
      }
      if (!competingTail) {
        if (wasOlderPage && frame.nextBeforeSeq !== undefined && frame.nextBeforeSeq > 0) {
          this.oldestSeq = frame.nextBeforeSeq;
        } else {
          this.oldestSeq = minSeq;
        }
      }
      AppStorage.setOrCreate<boolean>('historyHasMore', this.hasMore);
      AppStorage.setOrCreate<number>('historyOldestSeq', this.oldestSeq);
      if (!wasOlderPage) {
        this.setHistoryLoading(false);
      }
      if (this.bulkOlderDepth === 0) {
        this.publish();
      }
      return;
    }
    if (frame.kind === 'session-snapshot') {
      const responseSession: string = frame.sessionId !== undefined ? frame.sessionId : this.sessionId;
      if (this.sessionId.length > 0 && responseSession !== this.sessionId) return;
      // 快照同样是一次权威对齐
      this.lastLiveEventAt = Date.now();
      // 快照投影里带每会话运行模式（对齐 dsh-mobile：projections.values.agentPreset）
      const snapProjections: Record<string, Object> | undefined = asRec(field(frame, 'projections'));
      const snapValues: Record<string, Object> | undefined = snapProjections !== undefined ? asRec(field(snapProjections, 'values')) : undefined;
      if (snapValues !== undefined && responseSession.length > 0) {
        const snapPreset: string = str(snapValues, 'agentPreset') ?? '';
        if (snapPreset.length > 0) {
          SessionStore.rememberSessionPreset(responseSession, snapPreset);
        }
      }
      // 团队协作快照：agentTeam 投影随会话快照下发，交给 TeamStore 合并成右上角协作入口的数据
      if (snapProjections !== undefined) {
        TeamStore.get().ingestProjection(responseSession, snapProjections);
      }
      const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
      if (frame.resetRequired === true || frame.replace === true) {
        this.replaceSnapshot(events, frame.cursor, frame.resetRequired === true);
      } else {
        this.rawEvents = this.mergeHistoryEvents(events, this.rawEvents);
      }
      this.rebuildProjection();
      // 快照可能带「进行中的流式尝试」：把已产出的增量补进投影，
      // 这样运行中打开会话能立刻看到已生成的部分（对齐小程序 installAssistantBaseline）。
      this.applyAssistantBaseline(frame);
      if (frame.hasMore !== undefined) this.hasMore = frame.hasMore;
      let minSeq: number = 0;
      for (const raw of this.rawEvents) {
        if (raw.seq > 0 && (minSeq === 0 || raw.seq < minSeq)) minSeq = raw.seq;
      }
      this.oldestSeq = minSeq;
      AppStorage.setOrCreate<boolean>('historyHasMore', this.hasMore);
      AppStorage.setOrCreate<number>('historyOldestSeq', this.oldestSeq);
      this.setHistoryLoading(false);
      this.publish();
      return;
    }
    if (frame.kind === 'event') {
      const frameSession: string = frame.sessionId !== undefined ? frame.sessionId : this.sessionId;
      this.lastEventAt = Date.now();
      // 团队增量事件（team/member、team/task）与当前打开哪个会话无关，都要并入团队快照
      const teamEvent: RawSessionEvent | undefined = this.rawFromFrame(frame);
      if (teamEvent !== undefined) {
        TeamStore.get().ingestEvent(teamEvent.type, teamEvent.seq, teamEvent.data);
      }
      // 别的会话的事件：不并入当前对话，但「运行中」标记要照单收下，
      // 否则手机端打开的会话一直空闲时，桌面端新开的会话永远不会亮起。
      if (this.sessionId.length > 0 && frameSession !== this.sessionId) {
        const otherRaw: RawSessionEvent | undefined = this.rawFromFrame(frame);
        if (otherRaw !== undefined && frameSession.length > 0) {
          if (SessionStore.isTurnEnd(otherRaw.type)) {
            this.markSessionRunning(frameSession, false);
          } else if (SessionStore.isRunningSignal(otherRaw.type)) {
            this.markSessionRunning(frameSession, true);
          }
        }
        return;
      }
      // 当前会话的实时帧：记下时刻（订阅还在正常送数据就不用补拉）
      this.lastLiveEventAt = Date.now();
      const raw: RawSessionEvent | undefined = this.rawFromFrame(frame);
      if (raw !== undefined && !this.hasRawEvent(raw)) {
        if (raw.seq > this.projectedMaxSeq) {
          this.projectedMaxSeq = raw.seq;
        }
        this.rawEvents.push(raw);
        if (this.rawEvents.length > 5000) this.rawEvents.splice(0, this.rawEvents.length - 5000);
        this.appendRaw(raw);
        this.publish();
        this.publishConversation();
        // 首页会话状态即时更新：只按「起止信号」改，不是每帧都置 true。
        // 之前任何一帧（包括 turn/end 之后的迟到帧、会话外的杂项事件）都会把列表翻成运行中，
        // 于是桌面端早就结束、手机端还一直显示「运行中」。
        if (SessionStore.isTurnEnd(raw.type)) {
          this.markSessionRunning(frameSession, false);
        } else if (SessionStore.isRunningSignal(raw.type)) {
          this.markSessionRunning(frameSession, true);
          // 开跑时立刻校准一次列表：别的会话此刻可能正在结束（手机端此前收不到）
          this.syncSessionsSoon();
        }
        this.liveEventCount += 1;
        if (this.liveEventCount % 10 === 1) {
          const proj: ConversationProjector = this.conversation as ConversationProjector;
          Logger.info('live event type=' + raw.type + ' items=' + proj.items.length.toString());
        }
      }
    }
  }

  /**
   * 结算判定（对齐小程序 noteAssistantSettlement + scheduleSettleClear）：
   * 最终答复（assistant/message，无工具调用）到达后给 1.6s 宽限，期间没有新事件就收口运行态。
   * 之前只等 turn/end：一旦那帧丢了或迟到，鲸尾条会一直亮着/或反过来状态不一致。
   */
  private scheduleSettleClear(): void {
    if (this.settleTimer !== 0) {
      clearTimeout(this.settleTimer);
      this.settleTimer = 0;
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = 0;
      if (!this.running) {
        return;
      }
      // 宽限要够长：模型两步之间常有 2~5 秒静默（下一轮工具调用还没发出），
      // 判太早会把还在跑的回合提前收口，界面就出现「运行中突然蹦出已完成」。
      if (Date.now() - this.lastLiveEventAt < 5000) {
        return;
      }
      const projector: ConversationProjector = this.conversation as ConversationProjector;
      for (const item of projector.items) {
        const kind: string = item.kind as string;
        if ((kind === ConversationItemKind.TOOL as string || kind === ConversationItemKind.JSON_TOOL as string)
          && item.status === 'running') {
          return;
        }
      }
      Logger.info('session running=false by=settle-clear');
      this.running = false;
      this.runningLockUntil = 0;
      this.stopLiveTicker();
      this.publishConversation();
    }, 6000);
  }

  /** turn 结束类事件：只有这些能把列表状态改回「已结束」 */
  private static isTurnEnd(type: string): boolean {
    return type === 'turn/end' || type === 'generation/cancelled' || type === 'generation/failed'
      || type === 'turn/cancelled';
  }

  /**
   * 运行中信号：与 foldConversation 的判定保持一致。
   * 只看「真的开始干活」的事件，助手消息结算（assistant/message）之类不算——
   * 那些帧常常在一轮结束后才到，误判会让列表卡在运行中。
   */
  private static isRunningSignal(type: string): boolean {
    return type === 'turn/start' || type === 'step/start' || type === 'assistant/chunk'
      || type === 'tool/call' || type === 'tool/result' || type === 'reasoning/chunk'
      || type === 'reasoning/message';
  }

  private rawEventKey(raw: RawSessionEvent): string {
    if (raw.seq > 0) return 'seq:' + raw.seq;
    let data: string = '';
    try { data = JSON.stringify(raw.data); } catch (err) { data = ''; }
    return 'legacy:' + raw.type + ':' + raw.time + ':' + data;
  }

  private hasRawEvent(raw: RawSessionEvent): boolean {
    const key: string = this.rawEventKey(raw);
    for (const existing of this.rawEvents) {
      if (this.rawEventKey(existing) === key) return true;
    }
    return false;
  }

  private mergeHistoryEvents(snapshot: RawSessionEvent[], live: RawSessionEvent[]): RawSessionEvent[] {
    const eventsByKey: Map<string, RawSessionEvent> = new Map<string, RawSessionEvent>();
    const contentKeys: Set<string> = new Set<string>();
    for (const event of snapshot) {
      eventsByKey.set(this.rawEventKey(event), event);
      contentKeys.add(this.contentSignature(event));
    }
    // Live wins when the same sequence appeared after the snapshot request started.
    // 但实时帧常常不带 seq（我们用合成 seq），同一事件在快照里还会以真实 seq 再来一次；
    // 只按 seq 去重会把「上下文注入 / 助手消息」重复投影两遍。这里再按内容指纹去重。
    for (const event of live) {
      if (event.seq <= 0 && contentKeys.has(this.contentSignature(event))) {
        continue;
      }
      eventsByKey.set(this.rawEventKey(event), event);
    }
    const merged: RawSessionEvent[] = [];
    eventsByKey.forEach((event: RawSessionEvent) => merged.push(event));
    merged.sort((a: RawSessionEvent, b: RawSessionEvent) => a.seq - b.seq);
    if (merged.length > 5000) merged.splice(0, merged.length - 5000);
    return merged;
  }

  /** 事件内容指纹：用于「实时帧（无 seq）与历史快照（有 seq）」之间去重 */
  private contentSignature(event: RawSessionEvent): string {
    let payload: string = '';
    try {
      payload = JSON.stringify(event.data);
    } catch (err) {
      payload = '';
    }
    const clipped: string = payload.length > 400 ? payload.substring(0, 400) : payload;
    return event.type + '|' + clipped;
  }

  private replaceSnapshot(snapshot: RawSessionEvent[], cursorValue: number | undefined, resetRequired: boolean): void {
    let cursor: number = cursorValue !== undefined ? cursorValue : 0;
    if (cursor <= 0) {
      for (const event of snapshot) if (event.seq > cursor) cursor = event.seq;
    }
    let firstSnapshotSeq: number = 0;
    for (const event of snapshot) {
      if (event.seq > 0 && (firstSnapshotSeq === 0 || event.seq < firstSnapshotSeq)) firstSnapshotSeq = event.seq;
    }
    const preserved: RawSessionEvent[] = [];
    for (const event of this.rawEvents) {
      if (event.seq > cursor || (!resetRequired && firstSnapshotSeq > 0 && event.seq < firstSnapshotSeq)) {
        preserved.push(event);
      }
    }
    this.rawEvents = this.mergeHistoryEvents(snapshot, preserved);
  }

  /** 只把比投影更新的事件追加进投影（补拉历史时用，避免全表重放阻塞主线程） */
  private appendNewerEvents(): void {
    const fresh: RawSessionEvent[] = [];
    for (const raw of this.rawEvents) {
      if (raw.seq > this.projectedMaxSeq) {
        fresh.push(raw);
      }
    }
    if (fresh.length === 0) {
      this.publishConversation();
      return;
    }
    fresh.sort((left: RawSessionEvent, right: RawSessionEvent) => left.seq - right.seq);
    for (const raw of fresh) {
      this.appendRaw(raw);
      if (raw.seq > this.projectedMaxSeq) {
        this.projectedMaxSeq = raw.seq;
      }
    }
    Logger.info('history incremental +' + fresh.length.toString() + ' maxSeq=' + this.projectedMaxSeq.toString());
    this.publishConversation();
  }

  private rebuildProjection(): void {
    // 回放历史只重建「内容」，不能动实时运行态：
    // 历史里没有「这一轮还在跑」的权威结论，以前一律 running=false，
    // 于是每次补拉历史（开回合补拉、断线重订阅、看门狗）运行条都会消失一次，
    // 用户看到的就是「运行态不显示，只有页面在闪」。
    const wasRunning: boolean = this.running;
    const lockUntil: number = this.runningLockUntil;
    const signature: string = this.publishedSignature;
    this.stopLiveTicker();
    this.replayingHistory = true;
    this.rows = [];
    EventProjector.get().reset();
    this.resetConversation();
    // 只回放最近 300 条：界面只渲染最近 150 条，回放全部（几百上千条）
    // 会在打开会话时把主线程占住 3~6 秒，系统按 THREAD_BLOCK 直接杀掉进程。
    const windowSize: number = Math.min(this.rawEvents.length, Math.max(300, this.replayWindow));
    const replayStart: number = this.rawEvents.length - windowSize;
    // 窗口外的「用户自己发的消息」不能丢：一轮跑很久时（30+ 步），用户消息早被挤出 300 条窗口，
    // 于是点进会话看不到自己发过的话，只剩过程。这里把窗口外的真人用户消息单独补投一次。
    const olderUserEvents: RawSessionEvent[] = [];
    for (let index = 0; index < replayStart; index++) {
      const raw: RawSessionEvent = this.rawEvents[index];
      if (raw.type !== 'user/message' && raw.type !== 'assistant/message') {
        continue;
      }
      if (raw.type === 'assistant/message') {
        // 窗口外的助手回复也要补投，否则历史只剩用户气泡、回复全丢
        olderUserEvents.push(raw);
        continue;
      }
      const payload: Record<string, Object> | undefined = raw.data as Record<string, Object> | undefined;
      const source: Record<string, Object> | undefined = payload === undefined
        ? undefined : payload['source'] as Record<string, Object> | undefined;
      const kind: string = source === undefined ? '' : String(source['kind'] ?? '');
      if (kind === 'user') {
        olderUserEvents.push(raw);
      }
    }
    for (const raw of olderUserEvents.slice(-20)) {
      this.appendRaw(raw);
    }
    for (let index = replayStart; index < this.rawEvents.length; index++) {
      const raw: RawSessionEvent = this.rawEvents[index];
      this.appendRaw(raw);
      if (raw.seq > this.projectedMaxSeq) {
        this.projectedMaxSeq = raw.seq;
      }
    }
    this.replayingHistory = false;
    this.running = wasRunning;
    this.runningLockUntil = lockUntil;
    // 内容签名也保留：回放后内容若完全一致，就不要写 AppStorage，
    // 否则页面会白白重排一次（这正是「有数据刷新时页面闪」的来源）。
    this.publishedSignature = signature;
    if (this.running) {
      this.startLiveTicker();
    } else {
      this.stopLiveTicker();
    }
    // 历史回放不经过 foldConversation 的实时累计分支，这里按 rawEvents 重建每轮用量
    this.rebuildTurnUsageFromRaw();
    this.publishConversation();
  }

  /**
   * 按 rawEvents 重建「每轮 token 用量」（打开会话 / 补拉历史后调用）。
   * 实时路径由 foldConversation 累计；历史回放路径（replayingHistory=true）不累计，
   * 所以重建时统一重算一遍，页脚「用量」按钮在重进会话后也能显示。
   */
  private rebuildTurnUsageFromRaw(): void {
    this.turnTokenTotals.clear();
    for (const raw of this.rawEvents) {
      if (raw.type !== 'assistant/message') {
        continue;
      }
      let event: SessionEvent;
      try {
        event = normalizeRawSessionEvent(raw, this.sessionId);
      } catch (err) {
        continue;
      }
      if (event.event.usage === undefined) {
        continue;
      }
      const turnNo: number | undefined = event.event.turn !== undefined ? event.event.turn
        : (num(raw.data as Object, 'turn'));
      this.accumulateTurnUsage(turnNo, event.event.usage, this.usageRouteOf(event.event));
    }
    this.turnRoutes.clear();
    for (const raw of this.rawEvents) {
      // 路由(提供方/模型)单独再扫一遍：只有 assistant/message 的 message.source 里才有
      if (raw.type !== 'assistant/message') {
        continue;
      }
      let routeEvent: SessionEvent;
      try {
        routeEvent = normalizeRawSessionEvent(raw, this.sessionId);
      } catch (err) {
        continue;
      }
      const route: string = this.usageRouteOf(routeEvent.event);
      if (route.length === 0) {
        continue;
      }
      const turnNo: number = routeEvent.event.turn !== undefined ? routeEvent.event.turn
        : (num(raw.data as Object, 'turn') ?? -1);
      if (turnNo >= 0) {
        this.turnRoutes.set(turnNo.toString(), route);
      }
    }
  }

  /**
   * 对话投影标签：与 iOS 端 L10n 的字面量逐字对齐。
   * 流式标题是状态判定依据（ConversationFeed.isStreamingTitle），不可被本地化文案替换。
   */
  private conversationLabels(): ConversationProjectionLabels {
    const labels: ConversationProjectionLabels = {
      userMessage: '你',
      context: '上下文注入 · ',
      streamingAssistant: 'DeepSeek · 正在生成',
      streamingReasoning: 'Think · 正在推理',
      finalAssistant: 'DeepSeek',
      finalReasoning: 'Think',
      assemblingTool: '工具调用 · 正在组装',
      toolResultDone: '工具完成',
      toolResultFailed: '工具失败',
      commandRunning: '正在执行…',
      commandCompacting: '正在压缩…',
      commandCompleted: '已完成',
      commandFailed: '执行失败',
      compactedHistory: '已压缩 {items} 条历史记录（约 {tokens} tokens）',
      interrupted: '生成已中断',
      modelAttemptFailed: '模型请求失败',
      modelRetrying: '正在重试模型请求',
      modelRetried: '模型请求已重试',
      generationFailed: '生成失败',
      generationCancelled: '生成已取消',
      outputTruncated: '输出已截断'
    };
    return labels;
  }

  /** 重置对话投影（切会话 / 重建历史时调用）。 */
  private resetConversation(): void {
    this.conversation = new ConversationProjector(this.conversationLabels());
    // 合成流式 seq 与投影一起归位：新投影里没有旧记录，保留区从头再排
    this.liveSeq = CONVERSATION_LIVE_SEQ_BASE;
    this.liveTurn = -1;
    this.liveStep = -1;
    this.optimisticUsers = [];
    this.optimisticSince = [];
    this.lastAssistantText = '';
    this.fallbackAssistantText = '';
    this.fallbackAssistantAt = 0;
  }

  /**
   * 会话列表轮询：500ms 一拍，但只在「桌面端状态可能变了」时才真的问主机：
   * 最近 5 秒内有实时事件、刚回到前台、或本机正处于执行中。
   * 空闲时退化成 1.2s 一拍的低频探测，既不会漏掉桌面端开跑，也不会空转太凶。
   */
  /**
   * 手机上漏帧的自救：重新向主机要一次历史并重新订阅当前会话。
   * 补拉后会走 history 帧的 replace/merge + rebuild，时间线直接对齐主机。
   */
  /**
   * 页面用：回合刚结束时主动向主机补齐一次历史（等价于用户退出重进）。
   * 实时流可能丢尾帧：最后一段正文/代码块后半段只在主机历史里，
   * 补齐后 history 帧会 merge + rebuild，长回复尾部就不会缺。
   */
  refreshFromHost(): void {
    this.catchUpCurrentSession();
  }

  private catchUpCurrentSession(): void {
    if (this.client === null || this.sessionId.length === 0) {
      return;
    }
    this.lastLiveEventAt = Date.now();
    this.lastCatchUpAt = Date.now();
    // 先补一次历史把内容追上；再按 30s 节流重发订阅 ——
    // 订阅静默失效时，只有重新 subscribe 才能恢复实时事件流（等价于用户退出重进）。
    // 只补历史，绝不周期性重发 subscribe：
    // 网关对每次 subscribe 都会 stop + start 一个 session follower（快照+重新挂流），
    // 我们每 15~20 秒重订阅一次，等于每隔 20 秒把实时推流重置一次 ——
    // 这就是「手机几乎收不到实时事件、只能靠补拉」的直接原因。
    this.client.requestHistoryRefresh(this.sessionId);
  }

  private startSessionsPoll(): void {
    if (this.sessionsTimer >= 0) {
      return;
    }
    this.sessionsTimer = setInterval(() => {
      if (this.client === null) {
        return;
      }
      if (this.sessionsInFlight && Date.now() - this.sessionsInFlightAt < 12000) {
        return;
      }
      const lifecycle: string = AppStorage.get<string>('appLifecycle') ?? 'foreground';
      if (lifecycle === 'background') {
        return;
      }
      const now: number = Date.now();
      const busy: boolean = this.running || now - this.lastEventAt < 5000;
      // 空闲 ~1.5s、活跃 ~1s 发现桌面端的变化；sessions 是裁剪过的轻量投影，
      // 不会像 history 那样把主机拖去重读会话日志，但也没必要每 500ms 打一次。
      const interval: number = busy ? 1000 : 1500;
      if (now - this.lastSessionsPollAt < interval) {
        return;
      }
      this.requestSessionsNow();
    }, 500);
  }

  /** 立刻向主机要一次权威会话列表（去重 + 记录时间戳）。 */
  private requestSessionsNow(): void {
    if (this.client === null) {
      return;
    }
    // 在途超过 12s 视为卡死（断线重连后旧请求不会再有回调），允许重新发起。
    if (this.sessionsInFlight && Date.now() - this.sessionsInFlightAt < 12000) {
      return;
    }
    this.sessionsInFlight = true;
    this.sessionsInFlightAt = Date.now();
    this.lastSessionsPollAt = Date.now();
    this.client.requestSessions().then((frame: GatewayFrame) => {
      this.sessionsInFlight = false;
      this.consumeSessions(frame);
    }).catch(() => {
      this.sessionsInFlight = false;
    });
  }

  /**
   * 事件驱动的列表校准：延时 400ms 触发，2s 内不重复。
   * 手机端只有「已打开的那个会话」的事件流，别的会话在桌面端开始/结束它完全看不到，
   * 所以只要是这个会话动了，就顺手问一次全量列表，让首页立刻跟上。
   */
  private syncSessionsSoon(): void {
    const now: number = Date.now();
    if (now - this.lastSessionsSyncAt < 2000) {
      return;
    }
    this.lastSessionsSyncAt = now;
    setTimeout(() => this.requestSessionsNow(), 400);
  }

  /** 发消息后立刻把该会话标成运行中（乐观更新，等事件流与列表快照校正）。 */
  notifySessionStarted(sessionId: string): void {
    Logger.info('SESSION_OPTIMISTIC start id=' + sessionId);
    this.markSessionRunning(sessionId, true);
    // 发出去就算运行中：鲸尾条立刻出现（对齐小程序发送后立即进入 run 态），
    // 不用等 turns 回第一帧；同时上防抖锁，避免列表帧滞后导致的「闪过又消失」。
    if (sessionId.length > 0 && sessionId === this.sessionId) {
      this.runningLockUntil = Date.now() + 5000;
      this.lastLiveEventAt = Date.now();
      if (!this.running) {
        this.running = true;
        this.startLiveTicker();
        AppStorage.setOrCreate<boolean>('conversationRunning', true);
      }
      this.publishConversation();
    }
  }

  /** 回到前台：桌面端可能在后台跑完了，立刻校准一次（对齐小程序的运行态兜底）。 */
  refreshSessionsNow(): void {
    this.lastSessionsPollAt = 0;
    this.requestSessionsNow();
  }

  private stopSessionsPoll(): void {
    if (this.sessionsTimer >= 0) {
      clearInterval(this.sessionsTimer);
      this.sessionsTimer = -1;
    }
  }

  /**
   * 就地更新某个会话的「运行中」标记并立刻写回 AppStorage。
   * 首页列表原本只等网关的 sessions 快照，所以要等很久；收到实时事件后立即改。
   */
  private markSessionRunning(targetSessionId: string, running: boolean): void {
    if (targetSessionId.length === 0) {
      return;
    }
    const current: SessionSummary[] = AppStorage.get<SessionSummary[]>('sessions') ?? [];
    let changed: boolean = false;
    let found: boolean = false;
    const next: SessionSummary[] = [];
    for (const one of current) {
      if (one.id === targetSessionId) {
        found = true;
      }
      if (one.id === targetSessionId && one.running !== running) {
        next.push({
          id: one.id,
          title: one.title,
          running: running,
          updatedAt: one.updatedAt,
          cwd: one.cwd,
          agentPreset: one.agentPreset,
          blank: one.blank
        });
        changed = true;
      } else {
        next.push(one);
      }
    }
    // 列表里还没有这个会话（刚新建 / 桌面端刚建的）：先本地插入一行「运行中」，
    // 等 sessions 快照回来再校正。以前这里只发一次请求，首页要等到快照才出现状态。
    if (!found) {
      if (running) {
        const knownTitle: string = AppStorage.get<string>('sessionTitle') ?? '';
        const provisionalTitle: string = this.sessionId === targetSessionId && knownTitle.length > 0
          ? knownTitle : '新会话';
        next.push({
          id: targetSessionId,
          title: provisionalTitle,
          running: true,
          updatedAt: Date.now(),
          cwd: '',
          agentPreset: '',
          // 已经开始跑 = 有对话，别当成空会话藏起来
          blank: false
        });
        this.localRunningAt.set(targetSessionId, true);
        this.localRunningMarkAt.set(targetSessionId, Date.now());
        AppStorage.setOrCreate<SessionSummary[]>('sessions', next);
        Logger.info('SESSION_OPTIMISTIC append id=' + targetSessionId + ' total=' + next.length);
      }
      this.syncSessionsSoon();
      return;
    }
    if (changed) {
      this.localRunningAt.set(targetSessionId, running);
      this.localRunningMarkAt.set(targetSessionId, Date.now());
      // 本地已经改过，下一次快照就不必再当成变化重写一遍
      this.sessionsSignature = '';
      AppStorage.setOrCreate<SessionSummary[]>('sessions', next);
      // 有会话开始/结束时尽快拿一次权威列表：
      // 开始 → 桌面端能立刻看到「运行中」；结束 → 别的会话的变化也能一并刷新。
      this.syncSessionsSoon();
    }
  }

  private foldConversation(raw: RawSessionEvent): void {
    if (this.conversation === null) {
      this.resetConversation();
    }
    let event: SessionEvent;
    try {
      event = normalizeRawSessionEvent(raw, this.sessionId);
    } catch (err) {
      return;
    }
    // 记录真实事件的回合 / 步骤：流式 start 帧缺 turn/step 时用它兜底。
    // 合成流式事件（seq 在保留区）不参与，避免自己给自己兜底。
    if (raw.seq > 0 && raw.seq < CONVERSATION_LIVE_SEQ_BASE
      && event.event.turn !== undefined && event.event.turn >= 0) {
      this.lastEventTurn = event.event.turn;
      this.lastEventStep = event.event.step !== undefined ? event.event.step : -1;
    }
    const projector: ConversationProjector = this.conversation as ConversationProjector;
    projector.fold(event);
    // 真实答复 / 回合收工之后，还没结算的流式行都是上一轮遗留（半截正文或推理），
    // 留着会被下一轮继续往里追加，正文交给真实事件与末尾回填接管。
    if (!this.replayingHistory && (event.event.type === 'assistant/message' || event.event.type === 'turn/end')) {
      // 定稿而不是删除：推理/正文已经流式显示出来的内容，收尾时不能整行消失
      projector.settleLiveRows();
    }
    // 累计每轮用量：assistant/message 的 usage（同一轮回退重试也累加，对齐小程序 turn-usage）
    if (!this.replayingHistory && event.event.usage !== undefined) {
      this.accumulateTurnUsage(event.event.turn, event.event.usage, this.usageRouteOf(event.event));
    }
    // 网关可能只发 step/start（不发 turn/start），这些事件都代表本轮仍在进行
    const liveType: string = event.event.type;
    if (!this.replayingHistory) {
      this.trackAssistantText(event.event as GatewayEvent);
    }
    const isRunningSignal: boolean = liveType === 'turn/start' || liveType === 'step/start'
      || liveType === 'assistant/chunk' || liveType === 'tool/call' || liveType === 'tool/result'
      || liveType === 'reasoning/chunk' || liveType === 'reasoning/message';
    if (this.replayingHistory) {
      return;
    }
    if (isRunningSignal) {
      this.runningLockUntil = Date.now() + 5000;
      if (!this.running) {
        this.running = true;
        Logger.info('session running=true by=' + liveType);
      }
      this.startLiveTicker();
    } else if (liveType === 'assistant/message') {
      const toolCalls: Object[] | undefined = event.event.toolCalls;
      if (toolCalls === undefined || toolCalls.length === 0) {
        this.scheduleSettleClear();
      }
    } else if (liveType === 'turn/end') {
      if (this.running) {
        Logger.info('session running=false by=turn/end');
      }
      this.running = false;
      this.runningLockUntil = 0;
      this.turnEndedAt = Date.now();
      this.stopLiveTicker();
      this.publishConversation();
      // 任务完成：通知开关开启且 App 在后台时，发鸿蒙系统通知（前台正看着该会话就不打扰）
      this.publishTurnCompletedNotification();
    }
  }

  /** 回合完成的系统通知（对齐设置页「订阅通知」开关）。 */
  private publishTurnCompletedNotification(): void {
    try {
      const notifyEnabled: boolean = PreferencesStore.get().getBoolean('notifyEnabled', false);
      Logger.info('notify turn completed check enabled=' + notifyEnabled + ' session=' + this.sessionId);
      if (!notifyEnabled) {
        return;
      }
      // 开关开启后不再区分前后台：任务完成就发系统通知（前台看该会话时系统也只会弹横幅）
      const sessionId: string = this.sessionId;
      if (sessionId.length === 0) {
        return;
      }
      let title: string = '鲸尾 Harness';
      const list: SessionSummary[] | undefined = AppStorage.get<SessionSummary[]>('sessions');
      if (list !== undefined) {
        for (const one of list) {
          if (one.id === sessionId && one.title.length > 0) {
            title = one.title;
            break;
          }
        }
      }
      const raw: string = this.lastAssistantText.replace(/\s+/g, ' ').trim();
      let detail: string = '任务已完成，点击查看结果';
      if (raw.length > 0) {
        detail = raw.length > 56 ? raw.substring(0, 56) + '…' : raw;
      }
      Logger.info('notify turn completed session=' + sessionId);
      NotificationService.notifyTaskDone(sessionId, title, detail).catch(() => {
      });
    } catch (err) {
      Logger.warn('notify turn completed failed: ' + String(err));
    }
  }

  /**
   * 记录最近流式正文 / 结算正文（对齐小程序 lastAssistantText 口径）：
   * turn/start 清空；assistant/chunk 累积 delta；assistant/message 用最终文本覆盖。
   */
  private accumulateTurnUsage(turn: number | undefined, usage: Object, route: string = ''): void {
    const turnNo: number = turn === undefined ? this.lastEventTurn : turn;
    if (turnNo < 0) {
      return;
    }
    const key: string = turnNo.toString();
    if (route.length > 0) {
      this.turnRoutes.set(key, route);
    }
    const current: number[] = this.turnTokenTotals.get(key) ?? [0, 0, 0, 0, 0, 0];
    // 0 总 1 输入 2 输出 3 缓存读 4 缓存写 5 推理
    current[1] += num(usage, 'inputTokens') ?? 0;
    current[2] += num(usage, 'outputTokens') ?? 0;
    current[3] += num(usage, 'cacheReadTokens') ?? 0;
    current[4] += num(usage, 'cacheWriteTokens') ?? 0;
    current[5] += num(usage, 'reasoningTokens') ?? 0;
    const total: number | undefined = num(usage, 'totalTokens');
    current[0] += total !== undefined ? total
      : (num(usage, 'inputTokens') ?? 0) + (num(usage, 'outputTokens') ?? 0);
    this.turnTokenTotals.set(key, current);
  }

  /** 从 assistant/message 的 raw 里取「提供方/模型」（对齐小程序 messageRoute）。 */
  private usageRouteOf(event: GatewayEvent): string {
    const raw: Record<string, Object> | undefined = event.raw as Record<string, Object> | undefined;
    if (raw === undefined) {
      return '';
    }
    const message: Record<string, Object> | undefined = raw['message'] as Record<string, Object> | undefined;
    const sourceRaw: Object | undefined = message !== undefined && message['source'] !== undefined
      ? message['source'] : raw['source'];
    const source: Record<string, Object> | undefined = sourceRaw as Record<string, Object> | undefined;
    if (source === undefined) {
      return '';
    }
    const provider: string = source['provider'] !== undefined ? String(source['provider']) : '';
    const model: string = source['model'] !== undefined ? String(source['model']) : '';
    if (provider.length === 0 || model.length === 0) {
      return '';
    }
    return provider + '/' + model;
  }

  /** 千分位数字（用量弹窗里的精确总量，如 8,853,566）。 */
  private static grouped(value: number): string {
    const text: string = Math.round(value).toString();
    let out: string = '';
    for (let index = 0; index < text.length; index++) {
      const remain: number = text.length - index;
      if (index > 0 && remain % 3 === 0) {
        out += ',';
      }
      out += text.charAt(index);
    }
    return out;
  }

  /** 用量弹窗标题行右侧的精确总量（含分组），无数据返回空串。 */
  turnUsageTotalExact(turnKey: string): string {
    const value: number[] | undefined = this.turnTokenTotals.get(turnKey);
    if (value === undefined || value[0] <= 0) {
      return '';
    }
    return SessionStore.grouped(value[0]) + ' tok';
  }

  /**
   * 用量弹窗的分项行（编码 label\u0001value），对齐小程序用量弹层的行：
   * 提供方/模型 · 缓存命中 · 未缓存输入 · 缓存读取 · 缓存写入 · 输出。
   */
  turnUsageRows(turnKey: string): string[] {
    const value: number[] | undefined = this.turnTokenTotals.get(turnKey);
    if (value === undefined || value[0] <= 0) {
      return [];
    }
    const uncached: number = value[1];
    const output: number = value[2];
    const cacheRead: number = value[3];
    const cacheWrite: number = value[4];
    const billedInput: number = uncached + cacheRead + cacheWrite;
    const rows: string[] = [];
    const route: string | undefined = this.turnRoutes.get(turnKey);
    if (route !== undefined && route.length > 0) {
      rows.push('提供方 / 模型\u0001' + route);
    }
    if (billedInput > 0) {
      const hit: string = (Math.round((cacheRead * 1000) / billedInput) / 10).toString();
      rows.push('缓存命中\u0001' + hit + '%');
    }
    rows.push('未缓存输入\u0001' + SessionStore.grouped(uncached) + ' tok');
    rows.push('缓存读取\u0001' + SessionStore.grouped(cacheRead) + ' tok');
    rows.push('缓存写入\u0001' + SessionStore.grouped(cacheWrite) + ' tok');
    rows.push('输出\u0001' + SessionStore.grouped(output) + ' tok');
    return rows;
  }

  /** 每轮用量短文本（页脚「用量」按钮），如 '12.3k tok'；无数据返回空串。 */
  turnUsageText(turnKey: string): string {
    if (turnKey.length === 0) {
      return '';
    }
    const value: number[] | undefined = this.turnTokenTotals.get(turnKey);
    if (value === undefined || value[0] <= 0) {
      return '';
    }
    return '用量 ' + SessionStore.formatTokens(value[0]) + ' tok';
  }

  /** 每轮用量明细（点击「用量」按钮弹出）。 */
  turnUsageDetail(turnKey: string): string {
    const value: number[] | undefined = this.turnTokenTotals.get(turnKey);
    if (value === undefined || value[0] <= 0) {
      return '本轮暂无用量数据';
    }
    const billedInput: number = value[3] + value[4] > 0 ? value[3] + value[4] : value[1];
    const lines: string[] = [
      '总用量 ' + SessionStore.formatTokens(value[0]) + ' tok',
      '输入 ' + SessionStore.formatTokens(billedInput) + ' tok（未命中 ' + SessionStore.formatTokens(value[1]) + '）',
      '输出 ' + SessionStore.formatTokens(value[2]) + ' tok'
    ];
    if (value[5] > 0) {
      lines.push('推理 ' + SessionStore.formatTokens(value[5]) + ' tok');
    }
    if (value[3] > 0 || value[4] > 0) {
      const hit: number = billedInput > 0 ? Math.round((value[3] * 100) / billedInput) : 0;
      lines.push('缓存读 ' + SessionStore.formatTokens(value[3]) + ' · 写 ' + SessionStore.formatTokens(value[4])
        + ' · 命中 ' + hit.toString() + '%');
    }
    return lines.join('\n');
  }

  /** 1234 → '1.2k'，1234567 → '1.2m'（对齐小程序 turn-usage.exact 的量级写法）。 */
  private static formatTokens(value: number): string {
    if (value < 1000) {
      return value.toString();
    }
    if (value < 1000000) {
      return (Math.round(value / 100) / 10).toString() + 'k';
    }
    return (Math.round(value / 100000) / 10).toString() + 'm';
  }

  private trackAssistantText(event: GatewayEvent): void {
    if (event.type === 'turn/start') {
      this.lastAssistantText = '';
      this.fallbackAssistantText = '';
      return;
    }
    if (event.type === 'assistant/chunk') {
      const chunkType: string = event.chunkType === undefined ? 'text' : event.chunkType;
      if (chunkType !== 'text' && chunkType !== 'text-delta' && chunkType !== 'text-chunks') {
        return;
      }
      if (event.text !== undefined && event.text.length > 0) {
        this.lastAssistantText = this.lastAssistantText + event.text;
      }
      return;
    }
    if (event.type === 'assistant/message') {
      const text: string = event.text === undefined ? '' : event.text;
      if (text.length > 0) {
        this.lastAssistantText = text;
        this.fallbackAssistantText = '';
      }
    }
  }

  /**
   * 快照/事件不带最终答复时，用最近流式正文补一条助手行
   * （对齐小程序：「快照未携带当前回复时回填最近流式文本」）。真实答复到达后自动撤掉。
   *
   * 「最终答复已存在」的判定必须是：最后一条带正文的助手行位于**所有过程行之后**。
   * 助手行夹在工具/思考行中间 = 回合中段叙述，回合收工时会被「已完成」折叠行吞掉——
   * 这种不能算已有答复，必须回填，否则回合结束后只剩「已完成」、正文一行都看不见。
   */
  private refreshFallbackAssistant(): void {
    if (this.lastAssistantText.length === 0 || this.conversation === null) {
      this.fallbackAssistantText = '';
      return;
    }
    const projector: ConversationProjector = this.conversation as ConversationProjector;
    const items: ConversationItem[] = projector.items;
    let lastAssistantIdx: number = -1;
    let lastProcessIdx: number = -1;
    for (let index = items.length - 1; index >= 0; index--) {
      const item: ConversationItem = items[index];
      const kind: string = item.kind as string;
      if (lastAssistantIdx < 0 && kind === (ConversationItemKind.ASSISTANT as string) && item.text.length > 0) {
        lastAssistantIdx = index;
      }
      if (lastProcessIdx < 0 && ConversationFeed.isProcessKind(kind)) {
        lastProcessIdx = index;
      }
      if (lastAssistantIdx >= 0 && lastProcessIdx >= 0) {
        break;
      }
    }
    if (lastAssistantIdx >= 0 && (lastProcessIdx < 0 || lastAssistantIdx > lastProcessIdx)) {
      // 最终答复已经在全部过程行之后：正常显示，不需要回填
      this.fallbackAssistantText = '';
      return;
    }
    this.fallbackAssistantText = this.lastAssistantText;
    this.fallbackAssistantAt = Math.floor(Date.now() / 1000);
  }

  /** 运行期间定时重投影：即使事件流有丢帧，界面也能持续刷新。 */
  private startLiveTicker(): void {
    if (this.liveTimer >= 0) {
      return;
    }
    this.liveTimer = setInterval(() => {
      // 列表说在跑就别停刷新器（只看 this.running 会因为漏帧提前停掉，内容就不刷新了）
      if (!this.running && !this.listSaysRunning()) {
        this.stopLiveTicker();
        return;
      }
      // 50ms：贴近一帧，运行中内容随网关推流即时上屏
      this.publishConversation();
      // 运行中保活：连续 3 秒没有实时事件 = 订阅已悄悄失效（网络切换/网关重连最常见）。
      // 主动补一次历史 + 重新订阅，等价于用户手动「退出重进」，但自动完成。
      const now: number = Date.now();
      // 先验会不会是「我们自己轮询太勤」把网关的实时推流挤掉：
      // 暂时只在静默 20 秒后才补一次快照，且不再周期性重订阅。
      if (this.sessionId.length > 0 && this.client !== null
        && now - this.lastLiveEventAt > 20000 && now - this.lastCatchUpAt > 20000) {
        this.catchUpCurrentSession();
      }
    }, 50);
  }

  private stopLiveTicker(): void {
    if (this.liveTimer >= 0) {
      clearInterval(this.liveTimer);
      this.liveTimer = -1;
    }
  }

  /** 把对话投影与运行状态写入 AppStorage，供会话页渲染。 */
  private publishConversation(): void {
    if (this.conversation === null) {
      this.resetConversation();
    }
    const projector: ConversationProjector = this.conversation as ConversationProjector;
    // 新建数组再拼：绝不能往 projector.items 里 push —— 它会被下一次发布再拼一遍，
    // 同一条乐观气泡重复插入，时间线上就会出现多份、看起来像「上一轮和这一轮都在」。
    // 只把最近 150 条交给页面：ArkUI 的 LazyForEach 虽然只渲染可见行，
    // 但 build() 每帧都会遍历整份 items 做分组/策略计算；一个跑了 900 多步的会话
    // 每帧遍历上千条会把主线程顶到 3~6 秒，系统直接按 THREAD_BLOCK 杀进程。
    const source: ConversationItem[] = projector.items;
    // 页面只拿最近 N 条：加载更早历史后要同步放宽，否则旧消息投影出来了又被截断，
    // 下拉刷新看起来「加载成功但内容不出现」。
    const cap: number = Math.min(800, 150 + Math.max(0, this.replayWindow - 300));
    const items: ConversationItem[] = source.length > cap
      ? source.slice(source.length - cap) : source.slice();
    const nowSeconds: number = Math.floor(Date.now() / 1000);
    const kept: ConversationItem[] = [];
    const keptSince: number[] = [];
    for (let index = 0; index < this.optimisticUsers.length; index++) {
      const item: ConversationItem = this.optimisticUsers[index];
      if (nowSeconds - item.epochSeconds <= 60) {
        kept.push(item);
        keptSince.push(index < this.optimisticSince.length ? this.optimisticSince[index] : -1);
      }
    }
    this.optimisticUsers = kept;
    this.optimisticSince = keptSince;
    // 乐观气泡必须插在「发送那一刻已存在的条目之后、发送之后才到的条目之前」。
    // 直接追加到末尾时，新回合先到的工具行会排在气泡前面、被并进上一轮的过程组。
    for (let index = 0; index < kept.length; index++) {
      const since: number = keptSince[index];
      const at: number = since >= 0 ? Math.min(since + index, items.length) : items.length;
      items.splice(at, 0, kept[index]);
    }
    // 回合刚收工、投影里还没有最终答复时先补上最近流式正文，
    // 保证「已完成」下面立刻有内容（对齐小程序回填逻辑）；真实答复到达后这里会自动让位。
    if (!this.running) {
      this.refreshFallbackAssistant();
      if (this.fallbackAssistantText.length > 0) {
        items.push({
          id: 'fallback-assistant',
          kind: ConversationItemKind.ASSISTANT,
          title: '',
          text: this.fallbackAssistantText,
          epochSeconds: this.fallbackAssistantAt
        });
      }
    }
    // 内容没变化就别写：页面 @StorageLink 每次写入都会重排时间线，
    // 运行中 50ms 一写等于每秒重排 20 次，是「画面闪、步骤不跟手」的主要来源。
    // 签名必须覆盖每一条的内容长度与状态：运行中大量更新是「原地变」的
    // （工具从"运行中"变"完成"、结果文本增长），条数和尾行 id 都不变。
    // 之前只看尾行，这类更新会被误判成「没变化」而跳过发布 —— 表现为过程不刷新、页面不跟随滚动。
    let signature: string = items.length.toString() + '|' + this.running.toString();
    for (const item of items) {
      signature += '|' + item.id + ':' + (item.kind as string) + ':' + item.text.length.toString()
        + ':' + (item.resultText === undefined ? '' : item.resultText.length.toString())
        + ':' + (item.status === undefined ? '' : item.status)
        + (item.isError === true ? '!' : '');
    }
    if (signature === this.publishedSignature) {
      return;
    }
    this.publishedSignature = signature;
    AppStorage.setOrCreate<ConversationItem[]>('conversationItems', items);
    AppStorage.setOrCreate<boolean>('conversationRunning', this.running || this.listSaysRunning());
  }

  /** 输入条「停止」：取消当前会话生成。 */
  stopGenerating(): boolean {
    if (this.client === null || this.sessionId.length === 0) {
      return false;
    }
    return this.client.cancelSession(this.sessionId);
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * 发送前的「会话是否真的忙」综合判定：本地 running ∪ 主机列表状态 ∪ 刚收到过事件。
   * 带图片的消息一旦在运行中发出，会进主机队列（队列不保留图片内容）→ 无回复、重进即消失，
   * 所以发图前要用这个更保守的判定等到真正空闲。
   */
  isSessionBusy(): boolean {
    if (this.running) {
      return true;
    }
    if (this.listSaysRunning()) {
      return true;
    }
    return this.lastEventAt > 0 && Date.now() - this.lastEventAt < 3000;
  }

  /**
   * 会话列表里当前会话是否在运行中（主机权威状态）。
   * 实测：运行途中 this.running 会因漏帧/turn 判定等原因变 false，
   * 而列表仍是「运行中」。这会让 50ms 刷新器停掉 —— 之后鲸尾用时照跳（页面自己算的），
   * 但内容只在偶发的事件帧里才更新一次，观感就是「过程不刷新 / 不跟随」。
   */
  private listSaysRunning(): boolean {
    if (this.sessionId.length === 0) {
      return false;
    }
    // turn/end 刚到的 10 秒内，会话列表往往还是「运行中」（主机侧状态滞后），
    // 直接采纳会让鲸尾条收不掉、过程组也不折叠。
    if (this.turnEndedAt > 0 && Date.now() - this.turnEndedAt < 10000) {
      return false;
    }
    const list: SessionSummary[] | undefined = AppStorage.get<SessionSummary[]>('sessions');
    if (list === undefined) {
      return false;
    }
    for (const one of list) {
      if (one.id === this.sessionId) {
        return one.running === true;
      }
    }
    return false;
  }

  /** 目录列表：directories 帧 → 添加工作区弹层。 */
  private consumeDirectories(frame: GatewayFrame): void {
    // 网关用 entries 字段返回目录项（兼容 items 形态）
    const items: Object[] = frame.entries !== undefined ? frame.entries : (frame.items !== undefined ? frame.items : []);
    const entries: DirEntry[] = [];
    for (const item of items) {
      const path: string = str(item, 'path') ?? '';
      const name: string = str(item, 'name') ?? '';
      if (path.length === 0) {
        continue;
      }
      // 网关用 kind: 'dir' / 'directory' 标记目录（兼容 isDirectory 布尔字段）
      const kind: string = str(item, 'kind') ?? '';
      entries.push({
        name: name.length > 0 ? name : path,
        path: path,
        isDirectory: bool(item, 'isDirectory') === true || kind === 'dir' || kind === 'directory',
        hidden: bool(item, 'hidden') === true
      });
    }
    // 面包屑 + 家目录：对齐小程序 frame.crumbs / frame.home
    const crumbsRaw: GatewayDirectoryItem[] = frame.crumbs !== undefined ? frame.crumbs : [];
    const crumbs: DirCrumb[] = [];
    for (const item of crumbsRaw) {
      const crumbPath: string = item.path !== undefined ? item.path : '';
      if (crumbPath.length === 0) {
        continue;
      }
      crumbs.push({ name: item.name !== undefined && item.name.length > 0 ? item.name : crumbPath, path: crumbPath });
    }
    const current: string = str(frame, 'path') ?? '';
    const home: string = str(frame, 'home') ?? '';
    AppStorage.setOrCreate<DirEntry[]>('dirEntries', entries);
    AppStorage.setOrCreate<string>('dirCurrent', current);
    AppStorage.setOrCreate<DirCrumb[]>('dirCrumbs', crumbs);
    if (home.length > 0) {
      AppStorage.setOrCreate<string>('dirHome', home);
    }
    Logger.info('directories=' + entries.length + ' path=' + current);
  }

  /** 工作区列表：workspaceId/title/path/sessionIds。 */
  private consumeWorkspaces(frame: GatewayFrame): void {
    const items: Object[] = frame.items !== undefined ? frame.items : [];
    const rows: WorkspaceRow[] = [];
    for (const item of items) {
      const id: string = str(item, 'workspaceId') ?? '';
      if (id.length === 0) {
        continue;
      }
      const ids: string[] = [];
      const rawIds: Object | undefined = field(item, 'sessionIds');
      if (rawIds !== undefined && Array.isArray(rawIds)) {
        for (const one of rawIds as Object[]) {
          if (typeof one === 'string') {
            ids.push(one as string);
          }
        }
      }
      rows.push({
        workspaceId: id,
        title: str(item, 'title') ?? id.substring(0, 8),
        path: str(item, 'path') ?? '',
        sessionIds: ids
      });
    }
    AppStorage.setOrCreate<WorkspaceRow[]>('workspaces', rows);
    this.saveCatalogCache('cacheWorkspacesV1', JSON.stringify(rows));
    Logger.info('workspaces=' + rows.length);
  }

  /** 目录缓存：冷启动先用上次结果渲染首页，再等网关刷新。 */
  private saveCatalogCache(key: string, json: string): void {
    try {
      if (json.length > 512 * 1024) {
        return;
      }
      PreferencesStore.get().putString(key, json);
      Logger.info('catalog cache saved ' + key + ' bytes=' + json.length);
    } catch (err) {
      Logger.warn('catalog cache save failed');
    }
  }

  /** 偏好键：最近一次「新建但还没发消息」的空会话 id */
  private static readonly LAST_BLANK_KEY: string = 'lastBlankSessionId';

  /**
   * 记住这个刚建好的空会话：下次「新建会话」直接复用它。
   * dsh 端空会话不进列表，也不该每点一次新建就凭空造一个（主机上会堆一串看不见的空会话）。
   */
  static rememberBlankSession(sessionId: string): void {
    if (sessionId.length === 0) {
      return;
    }
    try {
      PreferencesStore.get().putString(SessionStore.LAST_BLANK_KEY, sessionId);
    } catch (err) {
      Logger.warn('remember blank session failed');
    }
  }

  /** 作废「可复用的空会话」记忆（已经发过消息 / 会话没了） */
  static forgetBlankSession(): void {
    try {
      PreferencesStore.get().deleteKey(SessionStore.LAST_BLANK_KEY);
    } catch (err) {
    }
  }

  /** 记着的空会话 id（没有则空串） */
  static lastBlankSessionId(): string {
    try {
      return PreferencesStore.get().getString(SessionStore.LAST_BLANK_KEY, '');
    } catch (err) {
      return '';
    }
  }

  /** 可复用的空会话 id：上次新建过、列表里还在、而且仍是空会话（空串 = 没有） */
  static reusableBlankSessionId(sessions: SessionSummary[]): string {
    const remembered: string = SessionStore.lastBlankSessionId();
    if (remembered.length === 0) {
      return '';
    }
    for (const one of sessions) {
      if (one.id === remembered && one.blank) {
        return one.id;
      }
    }
    return '';
  }

  /** 冷启动恢复会话/工作区缓存（不自动打开会话）。 */
  static restoreCatalogCache(): void {
    try {
      const prefs: PreferencesStore = PreferencesStore.get();
      const sessionsJson: string = prefs.getString('cacheSessionsV1', '');
      if (sessionsJson.length > 0) {
        const items: Object[] = JSON.parse(sessionsJson) as Object[];
        const list: SessionSummary[] = [];
        for (const item of items) {
          const id: string = str(item, 'id') ?? '';
          if (id.length === 0) {
            continue;
          }
          list.push({
            id: id,
            title: str(item, 'title') ?? sessionIdLabel(id),
            running: bool(item, 'running') === true,
            updatedAt: num(item, 'updatedAt') ?? 0,
            cwd: str(item, 'cwd') ?? '',
            agentPreset: str(item, 'agentPreset') ?? '',
            // 旧缓存没有 blank：按「有对话」处理，宁可多显示也别把正常会话藏起来
            blank: bool(item, 'blank') === true
          });
        }
        if (list.length > 0) {
          let anyRunning: boolean = false;
    for (const one of list) {
      if (one.running) {
        anyRunning = true;
        break;
      }
    }
    AppStorage.setOrCreate<boolean>('agentWorkActive', anyRunning);
    AppStorage.setOrCreate<SessionSummary[]>('sessions', list);
          Logger.info('catalog cache restored sessions=' + list.length);
        }
      }
      const workspacesJson: string = prefs.getString('cacheWorkspacesV1', '');
      if (workspacesJson.length > 0) {
        const items: Object[] = JSON.parse(workspacesJson) as Object[];
        const rows: WorkspaceRow[] = [];
        for (const item of items) {
          const id: string = str(item, 'workspaceId') ?? str(item, 'id') ?? '';
          if (id.length === 0) {
            continue;
          }
          const idsRaw: Object[] = (field(item, 'sessionIds') as Object[] | undefined) ?? [];
          const ids: string[] = [];
          for (const one of idsRaw) {
            if (typeof one === 'string') {
              ids.push(one as string);
            }
          }
          rows.push({
            workspaceId: id,
            title: str(item, 'title') ?? id.substring(0, 8),
            path: str(item, 'path') ?? '',
            sessionIds: ids
          });
        }
        if (rows.length > 0) {
          AppStorage.setOrCreate<WorkspaceRow[]>('workspaces', rows);
          Logger.info('catalog cache restored workspaces=' + rows.length);
        }
      }
      const pinsJson: string = prefs.getString('cachePinsV1', '');
      if (pinsJson.length > 0) {
        const items: Object[] = JSON.parse(pinsJson) as Object[];
        const pins: string[] = [];
        for (const one of items) {
          if (typeof one === 'string' && one.length > 0) {
            pins.push(one as string);
          }
        }
        if (pins.length > 0) {
          AppStorage.setOrCreate<string[]>('pinnedSessionIds', pins);
          Logger.info('catalog cache restored pins=' + pins.length.toString());
        }
      }
    } catch (err) {
      Logger.warn('catalog cache restore failed');
    }
  }

  /**
   * 会话置顶集合（对齐网关 session-pins / iOS pinnedWorkspaceSessionIDs）：
   * 收到的是完整集合，最近置顶的排在前面，整体替换本地顺序；顺带落盘供冷启动先画出来。
   */
  private consumePinnedSessions(frame: GatewayFrame): void {
    const raw: Object[] | undefined = frame.pinnedSessionIds;
    if (raw === undefined) {
      return;
    }
    const list: string[] = [];
    for (const one of raw) {
      if (typeof one === 'string' && one.length > 0 && list.indexOf(one) < 0) {
        list.push(one);
      }
    }
    AppStorage.setOrCreate<string[]>('pinnedSessionIds', list);
    this.saveCatalogCache('cachePinsV1', JSON.stringify(list));
    Logger.info('session pins updated n=' + list.length.toString());
  }

  /** 会话列表：解析后写入 AppStorage；首次拿到列表时自动打开最近一个会话。 */
  private consumeSessions(frame: GatewayFrame): void {
    const items: Object[] = frame.items !== undefined ? frame.items : [];
    // 网关会话列表包含已归档会话，并另附 archivedSessionIds；与小程序一致，视图只保留未归档的。
    const archivedIds: Set<string> = new Set<string>();
    if (frame.archivedSessionIds !== undefined) {
      for (const one of frame.archivedSessionIds) {
        archivedIds.add(one);
      }
    }
    const list: SessionSummary[] = [];
    for (const item of items) {
      // 网关字段是 sessionId（兼容旧版 id）。
      const rawId: string | undefined = str(item, 'sessionId') ?? str(item, 'id');
      const id: string = rawId !== undefined ? rawId : '';
      if (id.length === 0) {
        continue;
      }
      if (archivedIds.has(id)) {
        continue;
      }
      // 标题在 projections.values.title（网关 sequenced 投影），兼容旧版顶层字段。
      const projections: Record<string, Object> | undefined = asRec(field(item, 'projections'));
      const projValues: Record<string, Object> | undefined =
        projections !== undefined ? asRec(field(projections, 'values')) : undefined;
      const projTitle: string | undefined = projValues !== undefined ? str(projValues, 'title') : undefined;
      const rawTitle: string | undefined = projTitle ?? str(item, 'title') ?? str(item, 'summary');
      // 与小程序一致：没有标题时用会话 ID 短标签（去掉 session- 前缀取前 8 位）。
      const title: string = rawTitle !== undefined && rawTitle.length > 0 ? rawTitle : sessionIdLabel(id);
      const hostRunning: boolean = bool(item, 'running') === true;
      const updatedAt: number = num(item, 'updatedAt') ?? 0;
      const cwd: string = str(item, 'cwd') ?? '';
    const agentPreset: string = str(item, 'agentPreset') ?? '';
      // 空会话：新建后还没发过消息（host 的 blank）。本机刚发过消息的会话先放行。
      const blank: boolean = bool(item, 'blank') === true && !this.localSent.has(id);
      // 会话自带的权限预设（小程序 session.js 用的 s.permission）：每个会话各自的值，
      // 必须按会话 id 记下来，否则进会话时只能显示全局默认。
      const itemPermission: string | undefined = str(item, 'permission');
      if (itemPermission !== undefined && itemPermission.length > 0) {
        if (SessionStore.permissionBySession.get(id) !== itemPermission) {
          SessionStore.permissionBySession.set(id, itemPermission);
          SessionStore.bumpPermissionRevision();
        }
      }
      // 主机是权威来源，但刚按实时事件改过的状态要压过这份可能更旧的快照。
      let running: boolean = hostRunning;
      const markedAt: number = this.localRunningMarkAt.get(id) ?? 0;
      if (markedAt > 0) {
        if (Date.now() - markedAt < 6000) {
          running = this.localRunningAt.get(id) ?? hostRunning;
        } else {
          this.localRunningMarkAt.delete(id);
          this.localRunningAt.delete(id);
        }
      }
      list.push({ id: id, title: title, running: running, updatedAt: updatedAt, cwd: cwd, agentPreset: agentPreset, blank: blank });
    }
    // 列表没变就什么都不写：轮询每秒一次，重复赋值会让首页整表重绘、还平白写磁盘。
    let signature: string = '';
    let anyRunning: boolean = false;
    for (const one of list) {
      signature += one.id + (one.running ? '1' : '0') + (one.blank ? 'b' : '-') + one.updatedAt.toString() + one.title + ';';
      if (one.running) {
        anyRunning = true;
      }
    }
    // 记着的空会话已经发过消息（主机回 blank=false）：记忆作废，下次新建另起一个
    const rememberedBlank: string = SessionStore.lastBlankSessionId();
    if (rememberedBlank.length > 0) {
      for (const one of list) {
        if (one.id === rememberedBlank && !one.blank) {
          SessionStore.forgetBlankSession();
          break;
        }
      }
    }
    if (signature !== this.sessionsSignature) {
      this.sessionsSignature = signature;
      // 桌面端列表是权威来源，直接整表替换（个别刚改过的会话已按本地结论修正）。
      AppStorage.setOrCreate<SessionSummary[]>('sessions', list);
      this.saveCatalogCache('cacheSessionsV1', JSON.stringify(list));
      Logger.info('sessions updated n=' + list.length.toString() + ' running=' + (anyRunning ? '1' : '0'));
    }
    // 当前会话的运行态跟着列表走（会话在后台跑的时候，打开它也应立即显示运行中）
    for (const one of list) {
      if (one.id !== this.sessionId) {
        continue;
      }
      // 自救：主机那边的会话又动了（updatedAt 变化 / 开始运行），但本机事件流已经安静下来，
      // 说明订阅悄悄丢了帧 —— 主动补一次历史 + 重新订阅。
      // 之前只有「打开会话 / 重连」才拉历史，订阅一断就永远停在上一个回合：
      // 桌面端早已进入下一轮，手机还在上一轮的「运行中」里。
      const now: number = Date.now();
      const updatedChanged: boolean = this.knownUpdatedAt > 0 && one.updatedAt !== this.knownUpdatedAt;
      const startedElsewhere: boolean = one.running && !this.running;
      const quiet: boolean = now - this.lastLiveEventAt > 2500;
      if ((updatedChanged || startedElsewhere) && quiet && now - this.catchUpAt > 5000) {
        this.catchUpAt = now;
        Logger.info('session catch-up: updatedChanged=' + (updatedChanged ? '1' : '0')
          + ' running=' + (one.running ? '1' : '0')
          + ' quietMs=' + (now - this.lastLiveEventAt).toString());
        this.catchUpCurrentSession();
      }
      this.knownUpdatedAt = one.updatedAt;
      const nowMs: number = Date.now();
      const recentlyLive: boolean = nowMs - this.lastLiveEventAt < 2500 || this.assistantStreamActive;
      // 列表帧可能滞后：刚发消息/刚收到实时事件时它会短暂报 running=false，
      // 直接照抄会让鲸尾行反复消失再出现（用户看到的闪烁）。
      const staleFalse: boolean = !one.running && this.running
        && (recentlyLive || nowMs < this.runningLockUntil);
      if (staleFalse) {
        this.knownUpdatedAt = one.updatedAt;
        continue;
      }
      if (one.running !== this.running) {
        this.running = one.running;
        if (this.running) {
          this.startLiveTicker();
          this.runningLockUntil = Date.now() + 5000;
          // 会话刚开始跑：立刻补一次历史 + 重新订阅（等价于重进会话）。
          // 只靠自己收实时事件的话，订阅若已悄悄失效，运行中就一直看不到步骤，
          // 必须退出重进才一次性刷出来——这正是「执行过程当前页不加载」的根因。
          Logger.info('session start catch-up sessionId=' + this.sessionId);
          this.catchUpCurrentSession();
        } else {
          this.stopLiveTicker();
        }
        this.publishConversation();
      }
    }
    // 让后台保活/前台角标跟列表一起动：之前只在冷启动缓存恢复时算过一次。
    if (anyRunning !== this.agentWorkActive) {
      this.agentWorkActive = anyRunning;
      AppStorage.setOrCreate<boolean>('agentWorkActive', anyRunning);
    }
    if (this.sessionId.length === 0 && list.length > 0 && this.client !== null) {
      this.open(list[0].id);
      Logger.info('auto open session ' + this.sessionId);
    }
  }

  /**
   * 预热/会话节点弹层用：直接扫原始事件里的用户轮次标题（不重投影，O(事件数)）。
   * 批量补拉期间 store 不发布投影，页面拿不到新条目；这里给胶囊/弹层一个即时、可增长的节点来源。
   */
  previewUserTurnLabels(max: number = 600): string[] {
    const labels: string[] = this.userTurnLabelsOf(this.rawEvents);
    return labels.length > max ? labels.slice(0, max) : labels;
  }

  /** 是否还有更早历史可拉（页面预热循环用：拉完一页再看还有没有） */
  hasOlderHistory(): boolean {
    return this.hasMore && this.oldestSeq > 0 && this.sessionId.length > 0 && this.client !== null;
  }

  /** 上一页补拉请求是否还在等主机响应（页面预热要等它落地再发下一页） */
  isOlderRequestPending(): boolean {
    return this.olderRequestPending;
  }

  /** 补拉请求的超时兜底定时器：响应丢了也要把 pending 放掉，否则预热会一直卡住 */
  private olderRequestTimer: number = -1;

  // ==================== 会话节点标题补全（独立游标，不动时间线） ====================
  private titleFetchActive: boolean = false;
  private titleFetchExpecting: boolean = false;
  private titleFetchSession: string = '';
  private titleFetchLabels: string[] = [];
  private titleFetchHasMore: boolean = false;
  private titleFetchCursor: number = 0;
  private titleFetchResolve: ((ok: boolean) => void) | null = null;
  private titleFetchTimer: number = -1;
  /** 标题去重（同一轮被网关重复投递/页间重叠时只留一条） */
  private titleFetchSeen: Record<string, boolean> = {};
  /** 每会话轮次标题缓存：首次补全后，重开弹层/切页返回都直接命中 */
  private turnTitleCache: Map<string, string[]> = new Map<string, string[]>();
  /** 持久化 key 前缀（重启 App 后仍秒开；「清理缓存」会按前缀清掉） */
  private static readonly TITLE_CACHE_PREFIX: string = 'turnTitles.';

  /**
   * 只拉「用户轮次标题」：逐页请求历史，只提取 user/message 文案。
   * 不合并 rawEvents、不重投影、不发布 —— 因此不会卡主线程/触发系统重启；
   * 时间线状态完全不动，用户之后正常上滑时网关侧有页缓存，体验不变。
   */
  async fetchAllTurnTitles(onPage: (labels: string[]) => void): Promise<string[]> {
    const client: GatewayClient | null = this.client;
    if (this.titleFetchActive || client === null || this.sessionId.length === 0) {
      return this.titleFetchLabels.slice();
    }
    this.titleFetchActive = true;
    this.titleFetchSession = this.sessionId;
    this.titleFetchSeen = {};
    this.titleFetchLabels = [];
    const seedLabels: string[] = this.userTurnLabelsOf(this.rawEvents);
    for (const label of seedLabels) {
      this.pushTitleLabel(label);
    }
    this.titleFetchHasMore = this.hasMore;
    this.titleFetchCursor = this.oldestSeq;
    onPage(this.titleFetchLabels.slice());
    let guard: number = 0;
    try {
      while (guard < 40 && this.titleFetchHasMore && this.titleFetchCursor > 0
        && this.titleFetchSession === this.sessionId && this.titleFetchActive) {
        const ok: boolean = await this.requestTitlePage(client);
        if (!ok) {
          break;
        }
        guard += 1;
        onPage(this.titleFetchLabels.slice());
      }
    } finally {
      this.titleFetchActive = false;
      this.titleFetchExpecting = false;
      this.titleFetchSession = '';
      this.titleFetchResolve = null;
      if (this.titleFetchTimer >= 0) {
        clearTimeout(this.titleFetchTimer);
        this.titleFetchTimer = -1;
      }
    }
    Logger.info('[TitleFetch] done pages=' + guard.toString() + ' titles=' + this.titleFetchLabels.length.toString());
    return this.titleFetchLabels.slice();
  }

  /** 读取某会话已补全的标题缓存（内存优先，其次本地持久化；没有则空数组） */
  cachedTurnTitles(sessionId: string): string[] {
    const cached: string[] | undefined = this.turnTitleCache.get(sessionId);
    if (cached !== undefined && cached.length > 0) {
      return cached.slice();
    }
    if (sessionId.length === 0) {
      return [];
    }
    try {
      const raw: string = PreferencesStore.get().getString(SessionStore.TITLE_CACHE_PREFIX + sessionId, '');
      if (raw.length === 0) {
        return [];
      }
      const parsed: Object = JSON.parse(raw) as Object;
      if (!Array.isArray(parsed)) {
        return [];
      }
      const labels: string[] = [];
      for (const item of parsed as Object[]) {
        if (typeof item === 'string') {
          labels.push(item as string);
        }
      }
      if (labels.length > 0) {
        this.turnTitleCache.set(sessionId, labels);
      }
      return labels;
    } catch (err) {
      return [];
    }
  }

  /** 记住某会话补全后的标题（内存最多 6 个会话，本地持久化留 120 条） */
  rememberTurnTitles(sessionId: string, labels: string[]): void {
    if (sessionId.length === 0 || labels.length === 0) {
      return;
    }
    const capped: string[] = labels.length > 120 ? labels.slice(0, 120) : labels.slice();
    this.turnTitleCache.set(sessionId, capped);
    try {
      PreferencesStore.get().putString(SessionStore.TITLE_CACHE_PREFIX + sessionId, JSON.stringify(capped));
    } catch (err) {
    }
    if (this.turnTitleCache.size > 6) {
      const keys: string[] = [];
      this.turnTitleCache.forEach((_value: string[], key: string) => {
        keys.push(key);
      });
      for (let index = 0; index < keys.length - 6; index++) {
        this.turnTitleCache.delete(keys[index]);
      }
    }
  }

  /** 取消标题补全（关弹层/换会话） */
  cancelTurnTitleFetch(): void {
    const resolve: ((ok: boolean) => void) | null = this.titleFetchResolve;
    this.titleFetchActive = false;
    this.titleFetchSession = '';
    this.titleFetchExpecting = false;
    this.titleFetchResolve = null;
    if (this.titleFetchTimer >= 0) {
      clearTimeout(this.titleFetchTimer);
      this.titleFetchTimer = -1;
    }
    if (resolve !== null) {
      resolve(false);
    }
  }

  private requestTitlePage(client: GatewayClient): Promise<boolean> {
    return new Promise<boolean>((resolve: (ok: boolean) => void) => {
      this.titleFetchExpecting = true;
      this.titleFetchResolve = resolve;
      this.titleFetchTimer = setTimeout(() => {
        this.titleFetchTimer = -1;
        const pending: ((ok: boolean) => void) | null = this.titleFetchResolve;
        this.titleFetchResolve = null;
        this.titleFetchExpecting = false;
        if (pending !== null) {
          pending(false);
        }
      }, 10000);
      const sent: boolean = client.requestOlderHistory(this.sessionId, this.titleFetchCursor,
        this.historyFormatVersion, 300, 4194304);
      if (!sent) {
        const pending: ((ok: boolean) => void) | null = this.titleFetchResolve;
        this.titleFetchResolve = null;
        this.titleFetchExpecting = false;
        if (this.titleFetchTimer >= 0) {
          clearTimeout(this.titleFetchTimer);
          this.titleFetchTimer = -1;
        }
        if (pending !== null) {
          pending(false);
        }
      }
    });
  }

  /** history 帧是标题补全响应：抽标题、推进独立游标，绝不改时间线状态 */
  private consumeTitlePage(frame: GatewayFrame): void {
    const resolve: ((ok: boolean) => void) | null = this.titleFetchResolve;
    this.titleFetchResolve = null;
    this.titleFetchExpecting = false;
    if (this.titleFetchTimer >= 0) {
      clearTimeout(this.titleFetchTimer);
      this.titleFetchTimer = -1;
    }
    const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
    const extra: string[] = this.userTurnLabelsOf(events);
    // 补拉页是从新到旧：把这一页插到最前面，最终顺序才是 旧→新
    if (extra.length > 0) {
      const merged: string[] = [];
      for (const label of extra) {
        if (this.titleFetchSeen[label] === true) {
          continue;
        }
        const prev: string = merged.length > 0
          ? merged[merged.length - 1]
          : (this.titleFetchLabels.length > 0 ? this.titleFetchLabels[0] : '');
        if (label === prev) {
          continue;
        }
        this.titleFetchSeen[label] = true;
        merged.push(label);
      }
      this.titleFetchLabels = merged.concat(this.titleFetchLabels);
      if (this.titleFetchLabels.length > 600) {
        this.titleFetchLabels = this.titleFetchLabels.slice(0, 600);
      }
    }
    this.titleFetchHasMore = frame.hasMore === true;
    let minSeq: number = 0;
    for (const raw of events) {
      if (raw.seq > 0 && (minSeq === 0 || raw.seq < minSeq)) {
        minSeq = raw.seq;
      }
    }
    const next: number | undefined = frame.nextBeforeSeq;
    this.titleFetchCursor = next !== undefined && next > 0 ? next : minSeq;
    Logger.info('[TitleFetch] page events=' + events.length.toString() + ' extra=' + extra.length.toString()
      + ' total=' + this.titleFetchLabels.length.toString() + ' cursor=' + this.titleFetchCursor.toString()
      + ' hasMore=' + (this.titleFetchHasMore ? '1' : '0'));
    if (resolve !== null) {
      resolve(true);
    }
  }

  /** 追加一条标题（去全局重复 + 最近 5 条近似重复） */
  private pushTitleLabel(label: string): void {
    if (this.titleFetchSeen[label] === true) {
      return;
    }
    for (let index = Math.max(0, this.titleFetchLabels.length - 5); index < this.titleFetchLabels.length; index++) {
      if (this.titleFetchLabels[index] === label) {
        return;
      }
    }
    this.titleFetchSeen[label] = true;
    this.titleFetchLabels.push(label);
  }

  /** 从原始事件提取用户轮次标题（兼容 content 块 / text / message 三种正文形态） */
  private userTurnLabelsOf(events: RawSessionEvent[]): string[] {
    const labels: string[] = [];
    for (const raw of events) {
      if (raw.type !== 'user/message') {
        continue;
      }
      const data: Record<string, Object> = (raw.data !== undefined && raw.data !== null)
        ? raw.data as Record<string, Object> : {} as Record<string, Object>;
      let sourceKind: string = '';
      const sourceRaw: Object | undefined = data['source'];
      if (typeof sourceRaw === 'string') {
        sourceKind = sourceRaw as string;
      } else if (sourceRaw !== undefined && sourceRaw !== null) {
        sourceKind = str(asRec(sourceRaw), 'kind') ?? '';
      }
      let text: string = '';
      let hasImage: boolean = false;
      const content: Object | undefined = data['content'];
      if (Array.isArray(content)) {
        const blocks: Object[] = content as Object[];
        for (const block of blocks) {
          const rec: Record<string, Object> | undefined = asRec(block);
          if (rec === undefined) {
            continue;
          }
          const blockType: string = str(rec, 'type') ?? '';
          if (blockType === 'text') {
            text += str(rec, 'text') ?? '';
          } else if (blockType === 'image') {
            hasImage = true;
          }
        }
      }
      if (text.length === 0) {
        text = str(data, 'text') ?? '';
      }
      if (text.length === 0) {
        const message: Object | undefined = data['message'];
        if (typeof message === 'string') {
          text = message as string;
        } else if (Array.isArray(message)) {
          const blocks: Object[] = message as Object[];
          for (const block of blocks) {
            const rec: Record<string, Object> | undefined = asRec(block);
            if (rec === undefined) {
              continue;
            }
            text += str(rec, 'text') ?? '';
          }
        }
      }
      const imagesTop: Object | undefined = data['images'];
      if (Array.isArray(imagesTop) && (imagesTop as Object[]).length > 0) {
        hasImage = true;
      }
      const isUser: boolean = sourceKind.length === 0 || sourceKind === 'user' || sourceKind === 'ptc-mode' || hasImage;
      if (!isUser) {
        continue;
      }
      const hasMarkupImage: boolean = text.indexOf('<type>image</type>') >= 0 || text.indexOf('<path>') >= 0;
      if (hasMarkupImage) {
        hasImage = true;
      }
      // 去掉图片/文件块等 XML 标记，只留正文
      let clean: string = text.replace(/<path>[\s\S]*?<\/path>/g, ' ')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.startsWith('[') || clean.indexOf('Plugin context') >= 0 || clean.indexOf('Time sampled') >= 0) {
        continue;
      }
      if (clean.length === 0 && !hasImage) {
        continue;
      }
      // 图片/文件消息解析后常只剩「image image/jpeg …」这类元信息：统一显示为（图片）
      if (clean.indexOf('image/jpeg') >= 0 || clean.indexOf('image/png') >= 0
        || clean.startsWith('image image') || clean.indexOf(' application/') >= 0) {
        hasImage = true;
        clean = '';
      }
      if (clean.length > 80) {
        clean = clean.substring(0, 80);
      }
      // 图片消息：有文字 → 「图片」+ 标题文字；只有图片 → 「图片」
      if (hasImage) {
        labels.push(clean.length > 0 ? '图片 · ' + clean : '图片');
      } else if (clean.length > 0) {
        labels.push(clean);
      }
    }
    return labels;
  }

  /** 批量补拉深度：>0 时每页只合并原始事件，不重投影/不发布，结束后统一做一次 */
  private bulkOlderDepth: number = 0;

  /** 进入批量补拉：预热循环开始时调用，避免每页都全量重投影（长会话会很慢） */
  beginBulkOlder(): void {
    this.bulkOlderDepth += 1;
  }

  /** 退出批量补拉：最后一页落地后统一重投影 + 发布一次，前端数字一次性到位 */
  endBulkOlder(): void {
    if (this.bulkOlderDepth > 0) {
      this.bulkOlderDepth -= 1;
    }
    if (this.bulkOlderDepth === 0) {
      this.rebuildProjection();
      this.publish();
    }
  }

  private clearOlderRequestTimeout(): void {
    if (this.olderRequestTimer >= 0) {
      clearTimeout(this.olderRequestTimer);
      this.olderRequestTimer = -1;
    }
  }

  private armOlderRequestTimeout(): void {
    this.clearOlderRequestTimeout();
    this.olderRequestTimer = setTimeout(() => {
      this.olderRequestTimer = -1;
      if (this.olderRequestPending) {
        Logger.warn('older history request timeout, reset pending sessionId=' + this.sessionId);
        this.olderRequestPending = false;
        this.olderRequestCursor = 0;
      }
    }, 15000);
  }

  /**
   * 加载更早一页历史。
   * aggressive=true 时用大页（240 条 / 2MB）：节点预热要一次拉完历史，
   * 用默认的 30 条一页会在长会话里来回几十次，很慢。
   */
  loadOlder(aggressive: boolean = false): boolean {
    if (this.client === null || this.sessionId.length === 0 || this.oldestSeq <= 0 || this.olderRequestPending) {
      return false;
    }
    this.olderRequestPending = true;
    this.olderRequestCursor = this.oldestSeq;
    this.armOlderRequestTimeout();
    const sent: boolean = aggressive
      ? this.client.requestOlderHistory(this.sessionId, this.oldestSeq, this.historyFormatVersion, 240, 2097152)
      : this.client.requestOlderHistory(this.sessionId, this.oldestSeq, this.historyFormatVersion);
    if (!sent) { this.olderRequestPending = false; this.olderRequestCursor = 0; }
    return sent;
  }

  /** 手动打开某个会话（首页点列表时调用）。 */
  open(sessionId: string): void {
    if (sessionId.length === 0) return;
    // 团队：打开成员会话时保留团队快照，打开无关会话时清空
    TeamStore.get().activate(sessionId);
    if (this.sessionId === sessionId && this.client !== null && this.client.isConnected()) {
      // 同会话再次打开（页面重进、前台恢复）：状态不动，但必须重新拉一次历史并重新订阅，
      // 否则订阅悄悄失效后只能靠退出重进「碰运气」恢复。
      this.client.openSession(sessionId);
      this.lastLiveEventAt = Date.now();
      return;
    }
    this.sessionGeneration += 1;
    this.sessionId = sessionId;
    // 换会话：补拉用的「主机侧 updatedAt」与事件活跃时刻一起归零，避免刚打开就误触发补拉
    this.knownUpdatedAt = 0;
    this.catchUpAt = 0;
    this.lastLiveEventAt = Date.now();
    this.rows = [];
    this.rawEvents = [];
    this.olderRequestPending = false;
    this.olderRequestCursor = 0;
    this.replayWindow = 300;
    this.historyFormatVersion = 0;
    this.oldestSeq = 0;
    this.hasMore = false;
    this.running = false;
    this.resetConversation();
    // 有历史记录的会话：首屏历史到达前显示加载骨架，不显示「新建会话」空态
    // （未连接时不发请求，直接按空态处理，避免白转 10s）
    if (this.client !== null && this.client.isConnected()) {
      this.setHistoryLoading(true);
    }
    // 从会话列表恢复运行态：列表里 running=true 的会话打开即算运行中，
    // 否则「排队消息的立即发送」、运行条都要等第一条实时事件才亮。
    const seeded: SessionSummary[] | undefined = AppStorage.get<SessionSummary[]>('sessions');
    if (seeded !== undefined) {
      for (const one of seeded) {
        if (one.id === sessionId && one.running) {
          this.running = true;
          this.startLiveTicker();
        }
      }
    }
    AppStorage.setOrCreate<boolean>('historyHasMore', false);
    AppStorage.setOrCreate<number>('historyOldestSeq', 0);
    AppStorage.setOrCreate<ConversationItem[]>('conversationItems', []);
    AppStorage.setOrCreate<boolean>('conversationRunning', false);
    // 清掉上一个会话的模型/权限选中态，等本会话回执覆盖
    AppStorage.setOrCreate<string>('selectedModel', '');
    AppStorage.setOrCreate<string>('selectedProvider', '');
    AppStorage.setOrCreate<string>('selectedEffort', '');
    this.publish();
    AppStorage.setOrCreate<QueueItem[]>('queueItems', []);
    this.queueItems = [];
    AppStorage.setOrCreate<GatewayTask[]>('sessionTasks', []);
    AppStorage.setOrCreate<SessionGoalView>('sessionGoal', emptySessionGoal());
    AppStorage.setOrCreate<boolean>('goalBusy', false);
    this.tasksSeq = -1;
    this.goalSeq = -1;
    // 会话级模型目录（带 sessionId 才回 current）与权限选项
    if (this.client !== null) {
      this.client.requestModelsCatalog(sessionId);
      // 必须带 sessionId：网关只有收到它才会回 sessionPermissions（该会话的当前权限），
      // 不带只回全局目录，输入框就只能显示全局默认值。
      this.client.requestPermissionOptions(sessionId);
      // 队列 / 任务 / 目标：进入会话就拉一次（对齐小程序 sessionState 初始化）
      this.client.requestQueue(sessionId).catch(() => {});
      this.client.requestTasks(sessionId).catch(() => {});
      this.client.requestGoal(sessionId).catch(() => {});
    }
    if (this.client !== null) {
      this.lastSubscribeAt = Date.now();
      this.client.openSession(sessionId);
    }
  }

  /**
   * 实时事件缺 seq 时的兜底序号：网关的实时 event 帧不一定带顶层 seq，
   * 以前一律兜成 0，投影的 sequenceMap 永远只有一个槽位——每帧都覆盖同一 seq 并整表重放，
   * 结果就是「运行中过程不增长，回合结束/重进页面才一次性出现」。
   * 这里用保留区（>= CONVERSATION_LIVE_SEQ_BASE）里严格递增的序号，让每帧都能增量投影。
   */
  private syntheticEventSeq: number = CONVERSATION_LIVE_SEQ_BASE;

  private nextSyntheticEventSeq(): number {
    this.syntheticEventSeq += 1;
    return this.syntheticEventSeq;
  }

  private rawFromFrame(frame: GatewayFrame): RawSessionEvent | undefined {
    const nested: SessionEvent | undefined = undefined;
    if (frame.event !== undefined) {
      const evt = frame.event;
      let seq: number = frame.seq !== undefined ? frame.seq : 0;
      if (seq <= 0) {
        // 兼容把 seq 放在事件体里的网关
        const inner: number | undefined = num(evt as Object, 'seq');
        seq = inner !== undefined && inner > 0 ? inner : this.nextSyntheticEventSeq();
      }
      const raw: RawSessionEvent = {
        type: evt.type,
        seq: seq,
        time: frame.time !== undefined ? frame.time : Date.now(),
        data: evt as Object
      };
      return raw;
    }
    const rawFrame = frame.frame;
    if (rawFrame !== undefined) {
      const candidate = rawFrame as RawSessionEvent;
      if (candidate.type !== undefined && candidate.type.length > 0) {
        return candidate;
      }
    }
    return undefined;
  }

  /**
   * 流式合成 chunk 的 seq：在保留区（>= CONVERSATION_LIVE_SEQ_BASE）里严格递增。
   * 绝不能复用真实事件的 seq —— 撞号会把那条真实事件从投影的 sequenceMap 里顶掉，
   * 于是本轮的 user/message、上一轮已完成的答复直接从时间线上消失，只剩一条运行状态条。
   */
  private liveSeq: number = CONVERSATION_LIVE_SEQ_BASE;
  /** 流式诊断：本尝试第几个 chunk（用于抽样打「网关发出 → 本机收到」时延） */
  private streamChunkCount: number = 0;
  /** 当前流式尝试的回合 / 步骤：网关只在 start 帧给一次，后续 chunk 帧不带 */
  private liveTurn: number = -1;
  private liveStep: number = -1;
  /** 最近一条真实事件的回合 / 步骤：start 帧缺 turn/step 时兜底 */
  private lastEventTurn: number = -1;
  private lastEventStep: number = -1;
  /** 最近一次收到「当前会话」实时事件/历史的时刻：用来判断事件流是不是安静到漏帧了 */
  private lastLiveEventAt: number = 0;
  /** 会话列表里当前会话的 updatedAt：它变了而事件流又安静 = 手机漏了事件，需要补拉 */
  private knownUpdatedAt: number = 0;
  /** 补拉节流时间戳：列表每秒都在变，别把历史请求打成风暴 */
  private catchUpAt: number = 0;

  /**
   * assistant-stream 帧（对齐小程序 store.handleAssistantStream）：
   * start → 立即进入运行态；chunk → 把增量文本折叠进当前助手行；end → 结束流式标记。
   * 文本走 normalizeRawSessionEvent('assistant/chunk')，与真实事件共用同一投影管线。
   */
  private consumeAssistantStream(frame: GatewayFrame): void {
    if (frame.sessionId !== undefined && frame.sessionId.length > 0 && frame.sessionId !== this.sessionId) {
      return;
    }
    // 流还在送 = 订阅正常，不需要补拉
    this.lastLiveEventAt = Date.now();
    const payload: Record<string, Object> | undefined =
      asRec(field(frame, 'frame')) ?? asRec(field(frame, 'data')) ?? asRec(field(frame, 'payload'));
    if (payload === undefined) {
      return;
    }
    const type: string = str(payload, 'type') ?? 'chunk';
    if (type === 'start') {
      this.assistantStreamActive = true;
      if (this.replayingHistory) {
        return;
      }
      // start 帧带本尝试的 turn/step，chunk 帧不带：先记下来，否则流式行会一直落在 -1 回合上
      this.rememberLiveAttempt(payload);
      this.streamChunkCount = 0;
      if (!this.running) {
        this.running = true;
      }
      this.startLiveTicker();
      AppStorage.setOrCreate<boolean>('conversationRunning', true);
      return;
    }
    if (type === 'end') {
      this.assistantStreamActive = false;
      return;
    }
    const chunk: Record<string, Object> | undefined = asRec(field(payload, 'chunk')) ?? asRec(field(payload, 'delta'));
    let text: string = '';
    if (chunk !== undefined) {
      const fromChunk: string | undefined = str(chunk, 'text') ?? str(chunk, 'delta') ?? str(chunk, 'content');
      if (fromChunk !== undefined) {
        text = fromChunk;
      }
    }
    if (text.length === 0) {
      const fromPayload: string | undefined = str(payload, 'text');
      if (fromPayload !== undefined) {
        text = fromPayload;
      }
    }
    if (text.length === 0 || this.replayingHistory) {
      return;
    }
    this.assistantStreamActive = true;
    // 抽样记录「网关时间 → 本机收到」的时延，用于判断卡顿在网关推送还是本机渲染
    this.streamChunkCount += 1;
    const sentAt: number | undefined = num(payload, 'time');
    if (sentAt !== undefined && sentAt > 0 && this.streamChunkCount % 50 === 1) {
      const sentMs: number = sentAt > 10000000000 ? sentAt : sentAt * 1000;
      Logger.info('stream lag=' + (Date.now() - sentMs).toString() + 'ms chunk=' + this.streamChunkCount.toString());
    }
    const declaredType: string = chunk === undefined ? 'text' : (str(chunk, 'type') ?? 'text');
    this.emitLiveAssistantChunk(this.liveChunkType(declaredType), text,
      num(payload, 'turn'), num(payload, 'step'));
    if (this.liveTimer < 0) {
      this.startLiveTicker();
    }
  }

  /** start 帧记下本尝试的回合 / 步骤；缺省回落到最近一条真实事件（本轮用户消息所在回合）。 */
  private rememberLiveAttempt(payload: Record<string, Object>): void {
    const turn: number | undefined = num(payload, 'turn');
    const step: number | undefined = num(payload, 'step');
    this.liveTurn = turn !== undefined && turn >= 0 ? turn : this.lastEventTurn;
    this.liveStep = step !== undefined && step >= 0 ? step : this.lastEventStep;
  }

  /** 网关 chunk 类型 → 投影认识的类型（text / reasoning 简写兼容）。 */
  private liveChunkType(declared: string): string {
    if (declared === 'text' || declared === 'text-delta') {
      return 'text-delta';
    }
    if (declared === 'reasoning' || declared === 'reasoning-delta') {
      return 'reasoning-delta';
    }
    return declared;
  }

  /**
   * 把一段流式增量折进当前助手行（与真实事件同一条投影管线）。
   * seq 用保留区里严格递增的合成号：既不覆盖真实事件，也不会每来一段就整表重放；
   * 回合 / 步骤取 start 帧记下的值，最终 assistant/message 才能按同一个 key 结算这一行。
   */
  private emitLiveAssistantChunk(chunkType: string, text: string, turn: number | undefined, step: number | undefined): void {
    if (text.length === 0) {
      return;
    }
    const targetTurn: number = turn !== undefined && turn >= 0 ? turn
      : (this.liveTurn >= 0 ? this.liveTurn : this.lastEventTurn);
    const targetStep: number = step !== undefined && step >= 0 ? step
      : (this.liveStep >= 0 ? this.liveStep : this.lastEventStep);
    this.liveSeq += 1;
    const chunkData: Record<string, Object> = { 'type': chunkType, 'text': text };
    const data: Record<string, Object> = { 'chunk': chunkData };
    if (targetTurn >= 0) {
      data.turn = targetTurn;
    }
    if (targetStep >= 0) {
      data.step = targetStep;
    }
    const raw: RawSessionEvent = {
      type: 'assistant/chunk',
      seq: this.liveSeq,
      time: Math.floor(Date.now() / 1000),
      data: data
    };
    this.foldConversation(raw);
  }

  /**
   * 快照里的进行中尝试（assistantStream.activeAttempt.stream）→ 补进投影。
   * 对齐小程序 installAssistantBaseline：文本/推理文本/工具参数增量都还原。
   */
  private applyAssistantBaseline(frame: GatewayFrame): void {
    const stream: Record<string, Object> | undefined = asRec(field(frame, 'assistantStream'));
    if (stream === undefined) {
      return;
    }
    const active: Record<string, Object> | undefined = asRec(field(stream, 'activeAttempt'));
    if (active === undefined) {
      return;
    }
    const turn: number | undefined = num(active, 'turn');
    const step: number | undefined = num(active, 'step');
    // 快照里的进行中尝试同样带回合 / 步骤：记下来，后续 chunk 帧才知道该追加到哪一行
    if (turn !== undefined && turn >= 0) {
      this.liveTurn = turn;
      this.liveStep = step !== undefined && step >= 0 ? step : -1;
    }
    const records: Object[] = arr(active, 'stream') ?? [];
    for (const record of records) {
      const type: string = str(record, 'type') ?? '';
      let chunkType: string = 'text-delta';
      let text: string = '';
      if (type === 'chunk') {
        const chunk: Record<string, Object> | undefined = asRec(field(record, 'chunk'));
        if (chunk !== undefined) {
          chunkType = this.liveChunkType(str(chunk, 'type') ?? 'text');
          const value: string | undefined = str(chunk, 'text') ?? str(chunk, 'delta') ?? str(chunk, 'content');
          if (value !== undefined) {
            text = value;
          }
        }
      } else if (type === 'text-chunks') {
        const texts: Object[] = arr(record, 'texts') ?? [];
        for (const piece of texts) {
          if (typeof piece === 'string') {
            text += piece as string;
          }
        }
      } else if (type === 'reasoning-chunks') {
        chunkType = 'reasoning-delta';
        const texts: Object[] = arr(record, 'texts') ?? [];
        for (const piece of texts) {
          if (typeof piece === 'string') {
            text += piece as string;
          }
        }
      }
      this.emitLiveAssistantChunk(chunkType, text, turn, step);
    }
  }

  private appendRaw(raw: RawSessionEvent): void {
    let event: SessionEvent;
    try {
      event = normalizeRawSessionEvent(raw, this.sessionId);
    } catch (err) {
      Logger.warn('session event rejected: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    this.foldConversation(raw);
    EventProjector.get().consume(event);
    const type: string = event.event.type;
    if (type === 'user/message') {
      const source: string = event.event.source !== undefined ? event.event.source : 'user';
      if (source === 'user') {
        this.adoptOptimisticUser(event.event.text !== undefined ? event.event.text : '');
        // 回显的图片只有 attachmentId，要再向网关拉一次才出图；
        // 先把发送时的本地 URI 挂到刚到达的那条用户消息上（对齐小程序 row.images[].localUrl），
        // 这样自己刚发的图立刻显示缩略图，拉取失败也不会变成「图片加载失败」。
        if (this.pendingLocalImages.length > 0) {
          const localPaths: string[] = this.pendingLocalImages.shift() ?? [];
          const proj: ConversationProjector = this.conversation as ConversationProjector;
          if (proj !== null && proj !== undefined) {
            proj.attachLocalImagesToLastUser(localPaths);
          }
          // 同步认领进附件缓存：网关对「手机上传的 file 块」不提供按 id 回读
          // （host 只认 type=image 的引用），重进会话会拉取失败 → 本机缓存兜底出图。
          const ids: string[] = SessionStore.attachmentIdsOf(event.event.raw);
          for (let index = 0; index < localPaths.length && index < ids.length; index++) {
            AttachmentImageCache.adoptLocal(ids[index], '', 'image.png', localPaths[index]);
          }
        }
      }
    }
    const text: string = event.event.text !== undefined ? event.event.text : '';
    if (type === 'user/message') {
      this.push('user', text, event.seq);
      return;
    }
    if (type === 'assistant/chunk' || type === 'assistant/message') {
      const last = this.rows.length > 0 ? this.rows[this.rows.length - 1] : undefined;
      if (last !== undefined && last.role === 'assistant') {
        this.rows[this.rows.length - 1] = {
          id: last.id,
          role: 'assistant',
          text: type === 'assistant/chunk' ? last.text + text : text,
          seq: last.seq
        };
      } else {
        this.push('assistant', text, event.seq);
      }
      return;
    }
    if (type === 'tool/call' || type === 'tool/result') {
      const name: string = event.event.name !== undefined ? event.event.name : 'tool';
      this.push('tool', name, event.seq);
    }
  }

  private push(role: string, text: string, seq: number): void {
    this.rows.push({
      id: role + '-' + seq,
      role: role,
      text: text,
      seq: seq
    });
    if (this.rows.length > 3000) {
      this.rows.splice(0, this.rows.length - 3000);
    }
  }

  /** 任务列表（todo_write 投影）：只读展示，空列表也发布以便页面收起卡片。 */
  private consumeTasks(todos: GatewayTask[] | undefined): void {
    const list: GatewayTask[] = [];
    for (const raw of (todos !== undefined ? todos : [])) {
      const rec: Record<string, Object> = raw as Object as Record<string, Object>;
      const content: string = str(rec, 'content') ?? '';
      const status: string = str(rec, 'status') ?? 'pending';
      if (content.length > 0) {
        list.push({ content: content, status: status });
      }
    }
    AppStorage.setOrCreate<GatewayTask[]>('sessionTasks', list);
  }

  /** 目标快照：发布成页面直接可渲染的扁平结构。 */
  private consumeGoal(snapshot: Object | undefined): void {
    const view: SessionGoalView = emptySessionGoal();
    const snapshotRec: Record<string, Object> | undefined = asRec(snapshot);
    if (snapshotRec !== undefined) {
      const def: Record<string, Object> | undefined = asRec(snapshotRec['goal']);
      if (def !== undefined) {
        const phase: string = str(def, 'phase') ?? '';
        view.id = str(def, 'id') ?? '';
        view.revision = num(def, 'revision') ?? 0;
        view.objective = str(def, 'objective') ?? '';
        view.phase = phase;
        view.phaseLabel = goalPhaseLabel(phase);
        view.active = phase === 'active';
      }
    }
    AppStorage.setOrCreate<SessionGoalView>('sessionGoal', view);
  }

  /** 队列项正文块：DSH 的队列项是 UserMessage，正文在 content[]（可能挂在 message/source/payload 下）。 */
  private queueContent(raw: Object): Object[] {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      return [];
    }
    const direct = arr(rec, 'content');
    if (direct !== undefined) {
      return direct;
    }
    const nestedKeys: string[] = ['message', 'source', 'payload'];
    for (const key of nestedKeys) {
      const nested: Record<string, Object> | undefined = asRec(rec[key]);
      if (nested === undefined) {
        continue;
      }
      const blocks = arr(nested, 'content');
      if (blocks !== undefined) {
        return blocks;
      }
    }
    return [];
  }

  /** 队列项文字：顶层字符串字段 → 嵌套 message/source/payload.text → content 块（对齐小程序 qTextOf）。 */
  private queueText(raw: Object): string {
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      return '';
    }
    const keys: string[] = ['text', 'preview', 'message', 'content', 'prompt', 'value'];
    for (const key of keys) {
      const value: Object = rec[key];
      if (typeof value === 'string' && (value as string).length > 0) {
        return value as string;
      }
    }
    const nestedKeys: string[] = ['message', 'source', 'payload'];
    for (const key of nestedKeys) {
      const nested: Record<string, Object> | undefined = asRec(rec[key]);
      if (nested === undefined) {
        continue;
      }
      const text: string = str(nested, 'text') ?? '';
      if (text.length > 0) {
        return text;
      }
    }
    const parts: string[] = [];
    for (const block of this.queueContent(raw)) {
      if (typeof block === 'string') {
        if ((block as string).length > 0) {
          parts.push(block as string);
        }
        continue;
      }
      // 图片/文件不占正文位置：改用「N 个附件」展示（对齐小程序 textPreview 口径）
      const text: string = str(block, 'text') ?? '';
      if (text.length > 0) {
        parts.push(text);
      }
    }
    return parts.join(' ');
  }

  /** 队列项附件数：content 里的 image/file 块 → attachmentCount → attachments/images 数组。 */
  private queueAttachmentCount(raw: Object): number {
    let count: number = 0;
    for (const block of this.queueContent(raw)) {
      if (typeof block === 'string') {
        continue;
      }
      const type: string = str(block, 'type') ?? '';
      if (type === 'image' || type === 'file') {
        count += 1;
      }
    }
    if (count > 0) {
      return count;
    }
    const rec: Record<string, Object> | undefined = asRec(raw);
    if (rec === undefined) {
      return 0;
    }
    const declared: number | undefined = num(rec, 'attachmentCount');
    if (declared !== undefined && declared > 0) {
      return declared;
    }
    const attachments = arr(rec, 'attachments');
    if (attachments !== undefined) {
      return attachments.length;
    }
    const images = arr(rec, 'images');
    if (images !== undefined) {
      return images.length;
    }
    return 0;
  }

  private consumeQueue(sessionId: string, rawItems: Object[] | undefined): void {
    if (sessionId !== this.sessionId) {
      return;
    }
    const items: QueueItem[] = [];
    for (const raw of (rawItems !== undefined ? rawItems : [])) {
      const id: string = str(raw, 'id') ?? '';
      if (id.length === 0) {
        continue;
      }
      // 只显示真正的「排队 / 插话」消息。
      // DSH 的 session inbox 里还会塞 placement='context' 的条目（例如执行 /permission 这类
      // 斜杠命令后留下的上下文记录），它们不是待发消息；不过滤就会在输入框上方凭空冒出
      // 一张「排队消息」卡片（切权限后尤其明显）。
      const rawPlacement: string = str(raw, 'placement') ?? 'queued';
      if (rawPlacement === 'context') {
        continue;
      }
      // 正文与附件：对齐小程序 qTextOf / qContentOf（DSH 队列项是 UserMessage，正文在 content[] 里）
      let preview: string = this.queueText(raw);
      if (preview.length === 0) {
        preview = str(raw, 'rawText') ?? '';
      }
      // 从队列项里抽出图片附件：真正的消息体在 raw.message 里
      // （raw = {id, placement, rpcId, message:{content:[image..., text...]}}）
      const imageRefs: QueueImageRef[] = [];
      const messageObj: Record<string, Object> | undefined = asRec(field(raw, 'message'));
      const contentSource: Object = messageObj !== undefined ? messageObj : raw;
      const contentBlocks: Object[] = arr(contentSource, 'content') ?? [];
      const seenImageIds: Set<string> = new Set<string>();
      const pushImage = (rec: Record<string, Object> | undefined): void => {
        if (rec === undefined) {
          return;
        }
        const attachment = asRec(field(rec, 'attachment')) ?? rec;
        const attachmentId: string = str(attachment, 'attachmentId') ?? '';
        if (attachmentId.length === 0) {
          return;
        }
        if (seenImageIds.has(attachmentId)) {
          return;
        }
        seenImageIds.add(attachmentId);
        imageRefs.push({
          attachmentId: attachmentId,
          mediaType: str(attachment, 'mediaType') ?? 'image/jpeg',
          name: str(attachment, 'name') ?? '',
          bytes: num(attachment, 'bytes')
        });
      };
      for (const block of contentBlocks) {
        if (str(block, 'type') === 'image') {
          pushImage(asRec(field(block, 'attachment')) ?? asRec(block));
        }
      }
      const topImages: Object[] = arr(contentSource, 'images') ?? [];
      for (const one of topImages) {
        pushImage(asRec(one));
      }
      items.push({
        id: id,
        preview: preview,
        attachmentCount: this.queueAttachmentCount(raw),
        placement: str(raw, 'placement') ?? 'queued',
        images: imageRefs
      });
    }
    this.queueItems = items;
    AppStorage.setOrCreate<QueueItem[]>('queueItems', items);
    AppStorage.setOrCreate<number>('queueCount', items.length);
  }

  /** 队列操作成功后立即本地移除（不等网关下一帧）；失败时调用方 requestQueue 会恢复。 */
  removeQueueItem(itemId: string): void {
    const next: QueueItem[] = [];
    for (const item of this.queueItems) {
      if (item.id !== itemId) {
        next.push(item);
      }
    }
    this.queueItems = next;
    AppStorage.setOrCreate<QueueItem[]>('queueItems', next);
    AppStorage.setOrCreate<number>('queueCount', next.length);
  }

  /** 首屏历史加载态：置 true 时页面显示加载骨架；history 帧到达或 10s 兜底后置 false。 */
  private setHistoryLoading(loading: boolean): void {
    if (this.historyLoadingTimer >= 0) {
      clearTimeout(this.historyLoadingTimer);
      this.historyLoadingTimer = -1;
    }
    AppStorage.setOrCreate<boolean>('historyLoading', loading);
    if (loading) {
      this.historyLoadingTimer = setTimeout(() => {
        this.historyLoadingTimer = -1;
        AppStorage.setOrCreate<boolean>('historyLoading', false);
      }, 10000);
    }
  }

  /**
   * 本机对某会话发出过消息：列表立即按「有对话」处理，
   * 并作废「空会话可复用」记忆（下次新建另起一个）。
   */
  noteConversationSent(sessionId: string): void {
    if (sessionId.length === 0) {
      return;
    }
    this.localSent.add(sessionId);
    if (SessionStore.lastBlankSessionId() === sessionId) {
      SessionStore.forgetBlankSession();
    }
  }

  clear(): void {
    // 轮次标题缓存也属于「本机缓存」：清理缓存时一起清掉（含本地持久化）
    this.turnTitleCache.clear();
    this.titleFetchLabels = [];
    this.titleFetchSeen = {};
    try {
      PreferencesStore.get().removeLocalCacheByPrefixes([SessionStore.TITLE_CACHE_PREFIX]);
    } catch (err) {
    }
    this.rows = [];
    this.optimisticUsers = [];
    this.optimisticSince = [];
    this.setHistoryLoading(false);
    this.publish();
  }

  /**
   * 乐观回显：发送成功后立即本地插入一条用户消息（对齐小程序 store.appendLocalUserRow）。
   * 真实 user/message 事件到达时按文本就地采纳，避免出现两条气泡。
   */
  appendOptimisticUser(text: string, imageCount: number = 0, localImagePaths: string[] = []): void {
    // 发过消息就不再是空会话：列表立刻放出来，也不再复用
    this.noteConversationSent(this.sessionId);
    // 幂等：发送链路里 GatewayClient.sendUserMessage 与页面都会尝试插乐观气泡，
    // 同一条消息重复插入会让时间线出现两条一样的用户气泡，这里按文本合并。
    for (let index = 0; index < this.optimisticUsers.length; index++) {
      const existing: ConversationItem = this.optimisticUsers[index];
      if (existing.text === text) {
        if ((existing.imageCount ?? 0) === 0 && imageCount > 0) {
          existing.imageCount = imageCount;
        }
        if (localImagePaths.length > 0 && (existing.localImagePaths?.length ?? 0) === 0) {
          existing.localImagePaths = localImagePaths.slice();
          this.pendingLocalImages.push(localImagePaths.slice());
        }
        this.publishConversation();
        return;
      }
    }
    const item: ConversationItem = {
      id: 'local-user-' + Date.now().toString(),
      kind: ConversationItemKind.USER,
      title: '你',
      text: text,
      epochSeconds: Math.floor(Date.now() / 1000)
    };
    if (imageCount > 0) {
      item.imageCount = imageCount;
    }
    // 本地图片：发送后立刻用本地 URI 显示缩略图（网关回显的附件随后接管）
    if (localImagePaths.length > 0) {
      item.localImagePaths = localImagePaths.slice();
    }
    this.optimisticUsers.push(item);
    if (localImagePaths.length > 0) {
      this.pendingLocalImages.push(localImagePaths.slice());
    }
    const projector: ConversationProjector = this.conversation as ConversationProjector;
    this.optimisticSince.push(projector !== null && projector !== undefined ? projector.items.length : 0);
    this.publishConversation();
  }

  /**
   * 回显到达：本地乐观行就此交棒给真实 user/message 行（对齐小程序 pending adoption）。
   * 发送是串行的，收到任意用户消息就把队首乐观行消掉，避免文本被网关规范化后出现双气泡。
   */
  /** 从 user/message 原始 content 里按顺序取出附件 id（file / image 块）。 */
  private static attachmentIdsOf(raw: Object | undefined): string[] {
    const ids: string[] = [];
    const data: Record<string, Object> | undefined = raw as Record<string, Object> | undefined;
    if (data === undefined) {
      return ids;
    }
    const content: Object[] = arr(data, 'content') ?? [];
    for (const block of content) {
      const type: string = str(block, 'type') ?? '';
      if (type !== 'file' && type !== 'image') {
        continue;
      }
      const attachment: Record<string, Object> | undefined = asRec(field(block, 'attachment'));
      if (attachment === undefined) {
        continue;
      }
      const id: string = str(attachment, 'attachmentId') ?? str(attachment, 'id') ?? '';
      if (id.length > 0) {
        ids.push(id);
      }
    }
    return ids;
  }

  private adoptOptimisticUser(echoed: string): void {
    if (this.optimisticUsers.length === 0) {
      return;
    }
    // 先按文本找对应的乐观行（回显顺序可能和发送顺序不完全一致）；
    // 找不到再退回队首，保证任意用户消息都能推进采纳。
    let index: number = -1;
    for (let i = 0; i < this.optimisticUsers.length; i++) {
      if (this.optimisticUsers[i].text === echoed) {
        index = i;
        break;
      }
    }
    if (index < 0) {
      index = 0;
    }
    this.optimisticUsers.splice(index, 1);
    if (index < this.optimisticSince.length) {
      this.optimisticSince.splice(index, 1);
    } else if (this.optimisticSince.length > 0) {
      this.optimisticSince.shift();
    }
    this.publishConversation();
  }

  private publish(): void {
    AppStorage.setOrCreate<SessionRow[]>('sessionRows', this.rows.slice());
    AppStorage.setOrCreate<number>('sessionRowCount', this.rows.length);
  }
}