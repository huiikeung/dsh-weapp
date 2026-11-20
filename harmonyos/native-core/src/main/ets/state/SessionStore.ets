import { PreferencesStore } from '../common/PreferencesStore';
import { GatewayEvent, GatewayFrame, RawSessionEvent, SessionEvent, GatewayPendingQuestionRequest, GatewayPendingApprovalRequest, GatewayDirectoryItem, GatewayTask } from '../protocol/GatewayDtos';
import { arr, asRec, bool, field, normalizeRawSessionEvent, num, str } from '../protocol/GatewayFrameCodec';
import { GatewayClient } from '../network/GatewayClient';
import { EventProjector } from './EventProjector';
import { TeamStore } from './TeamStore';
import { Logger } from '../common/Logger';
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

export interface QueueItem {
  id: string;
  preview: string;
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
  private historyFormatVersion: number = 0;
  private sessionGeneration: number = 0;
  /** 任务/目标快照的 asOfSeq（旧帧丢弃，对齐小程序 tasksAsOfSeq / goalAsOfSeq） */
  private tasksSeq: number = -1;
  private goalSeq: number = -1;
  /** 乐观回显的本地用户消息（对齐小程序 appendLocalUserRow.pending，回显到达时就地合并） */
  private optimisticUsers: ConversationItem[] = [];
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
      return;
    }
    if (frame.kind === 'approval-requested' && frame.sessionId && frame.rpcId) {
      this.approvals.set(JSON.stringify([frame.sessionId, frame.rpcId]), { rpcId: frame.rpcId, sessionId: frame.sessionId,
        approvalId: frame.approvalId ?? '', toolName: frame.toolName ?? '工具操作',
        callId: frame.callId, reason: frame.reason, replay: frame.replay === true });
      return;
    }
    if (frame.kind === 'question-resolved' && frame.rpcId) {
      const keys: string[] = [];
      this.questions.forEach((request: GatewayPendingQuestionRequest, key: string) => {
        if (request.rpcId === frame.rpcId && (!frame.sessionId || frame.sessionId === request.sessionId)) keys.push(key);
      });
      if (keys.length === 1) this.questions.delete(keys[0]);
      return;
    }
    if (frame.kind === 'approval-resolved' && frame.rpcId) {
      const keys: string[] = [];
      this.approvals.forEach((request: GatewayPendingApprovalRequest, key: string) => {
        if (request.rpcId === frame.rpcId && (!frame.sessionId || frame.sessionId === request.sessionId)) keys.push(key);
      });
      if (keys.length === 1) this.approvals.delete(keys[0]);
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
    if (frame.kind === 'defaults') {
      Logger.info('defaults frame: preset=' + (str(frame, 'agentPresetDefault') ?? '')
        + ' perm=' + (str(frame, 'permissionDefault') ?? ''));
      AppStorage.setOrCreate<string>('defaultAgentPreset', str(frame, 'agentPresetDefault') ?? '');
      AppStorage.setOrCreate<string>('defaultModel', str(frame, 'model') ?? '');
      AppStorage.setOrCreate<string>('defaultProvider', str(frame, 'provider') ?? '');
      AppStorage.setOrCreate<string>('defaultPermission', str(frame, 'permissionDefault') ?? '');
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
          const label: string = str(one, 'name') ?? modelId;
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
      AppStorage.setOrCreate<string[]>('modelList', names);
      AppStorage.setOrCreate<ModelOption[]>('modelDetails', details);
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
    if (frame.kind === 'permission-options') {
      // 会话级权限当前值（对齐小程序 store.js：sessionPermissions.currentValue）
      const sessionPermissions = asRec(field(frame, 'sessionPermissions'));
      if (sessionPermissions !== undefined) {
        const currentValue: string = str(sessionPermissions, 'currentValue') ?? str(sessionPermissions, 'preset') ?? '';
        if (currentValue.length > 0) {
          AppStorage.setOrCreate<string>('defaultPermission', currentValue);
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
      this.rebuildProjection();
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
      this.publish();
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
    for (const event of snapshot) eventsByKey.set(this.rawEventKey(event), event);
    // Live wins when the same sequence appeared after the snapshot request started.
    for (const event of live) eventsByKey.set(this.rawEventKey(event), event);
    const merged: RawSessionEvent[] = [];
    eventsByKey.forEach((event: RawSessionEvent) => merged.push(event));
    merged.sort((a: RawSessionEvent, b: RawSessionEvent) => a.seq - b.seq);
    if (merged.length > 5000) merged.splice(0, merged.length - 5000);
    return merged;
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

  private rebuildProjection(): void {
    this.stopLiveTicker();
    this.replayingHistory = true;
    this.rows = [];
    this.running = false;
    EventProjector.get().reset();
    this.resetConversation();
    for (const raw of this.rawEvents) this.appendRaw(raw);
    this.replayingHistory = false;
    // 回放结束后 running 归零，只有真正的新事件才能点亮
    this.running = false;
    this.stopLiveTicker();
    this.publishConversation();
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
  private catchUpCurrentSession(): void {
    if (this.client === null || this.sessionId.length === 0) {
      return;
    }
    this.client.openSession(this.sessionId);
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
    this.markSessionRunning(sessionId, true);
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
          agentPreset: one.agentPreset
        });
        changed = true;
      } else {
        next.push(one);
      }
    }
    // 列表里还没有这个会话（桌面端刚建的）：直接拉一次列表让它出现。
    if (!found) {
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
      if (!this.running) {
        this.running = true;
        Logger.info('session running=true by=' + liveType);
      }
      this.startLiveTicker();
    } else if (liveType === 'turn/end') {
      if (this.running) {
        Logger.info('session running=false by=turn/end');
      }
      this.running = false;
      this.stopLiveTicker();
      this.publishConversation();
    }
  }

  /**
   * 记录最近流式正文 / 结算正文（对齐小程序 lastAssistantText 口径）：
   * turn/start 清空；assistant/chunk 累积 delta；assistant/message 用最终文本覆盖。
   */
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
      if (!this.running) {
        this.stopLiveTicker();
        return;
      }
      // 50ms：贴近一帧，运行中内容随网关推流即时上屏
      this.publishConversation();
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
    const items: ConversationItem[] = projector.items;
    // 本地乐观回显排在时间线末尾（对齐小程序 seq 9e9 的 pending 行）
    const nowSeconds: number = Math.floor(Date.now() / 1000);
    const kept: ConversationItem[] = [];
    for (const item of this.optimisticUsers) {
      if (nowSeconds - item.epochSeconds <= 60) {
        kept.push(item);
      }
    }
    this.optimisticUsers = kept;
    for (const item of this.optimisticUsers) {
      items.push(item);
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
    AppStorage.setOrCreate<ConversationItem[]>('conversationItems', items);
    AppStorage.setOrCreate<boolean>('conversationRunning', this.running);
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
            agentPreset: str(item, 'agentPreset') ?? ''
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
    } catch (err) {
      Logger.warn('catalog cache restore failed');
    }
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
      // 主机是权威来源，但刚按实时事件改过的状态要压过这份可能更旧的快照。
      let running: boolean = hostRunning;
      const markedAt: number = this.localRunningMarkAt.get(id) ?? 0;
      if (markedAt > 0) {
        if (Date.now() - markedAt < 2500) {
          running = this.localRunningAt.get(id) ?? hostRunning;
        } else {
          this.localRunningMarkAt.delete(id);
          this.localRunningAt.delete(id);
        }
      }
      list.push({ id: id, title: title, running: running, updatedAt: updatedAt, cwd: cwd, agentPreset: agentPreset });
    }
    // 列表没变就什么都不写：轮询每秒一次，重复赋值会让首页整表重绘、还平白写磁盘。
    let signature: string = '';
    let anyRunning: boolean = false;
    for (const one of list) {
      signature += one.id + (one.running ? '1' : '0') + one.updatedAt.toString() + one.title + ';';
      if (one.running) {
        anyRunning = true;
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
      if (one.running !== this.running) {
        this.running = one.running;
        if (this.running) {
          this.startLiveTicker();
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

  /** 是否还有更早历史可拉（页面预热循环用：拉完一页再看还有没有） */
  hasOlderHistory(): boolean {
    return this.hasMore && this.oldestSeq > 0 && this.sessionId.length > 0 && this.client !== null;
  }

  /** 上一页补拉请求是否还在等主机响应（页面预热要等它落地再发下一页） */
  isOlderRequestPending(): boolean {
    return this.olderRequestPending;
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
      this.client.requestPermissionOptions();
      // 队列 / 任务 / 目标：进入会话就拉一次（对齐小程序 sessionState 初始化）
      this.client.requestQueue(sessionId).catch(() => {});
      this.client.requestTasks(sessionId).catch(() => {});
      this.client.requestGoal(sessionId).catch(() => {});
    }
    if (this.client !== null) {
      this.client.openSession(sessionId);
    }
  }

  private rawFromFrame(frame: GatewayFrame): RawSessionEvent | undefined {
    const nested: SessionEvent | undefined = undefined;
    if (frame.event !== undefined) {
      const evt = frame.event;
      const seq: number = frame.seq !== undefined ? frame.seq : 0;
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
      // 正文与附件：对齐小程序 qTextOf / qContentOf（DSH 队列项是 UserMessage，正文在 content[] 里）
      let preview: string = this.queueText(raw);
      if (preview.length === 0) {
        preview = str(raw, 'rawText') ?? '';
      }
      items.push({
        id: id,
        preview: preview,
        attachmentCount: this.queueAttachmentCount(raw),
        placement: str(raw, 'placement') ?? 'queued'
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

  clear(): void {
    this.rows = [];
    this.optimisticUsers = [];
    this.setHistoryLoading(false);
    this.publish();
  }

  /**
   * 乐观回显：发送成功后立即本地插入一条用户消息（对齐小程序 store.appendLocalUserRow）。
   * 真实 user/message 事件到达时按文本就地采纳，避免出现两条气泡。
   */
  appendOptimisticUser(text: string, imageCount: number = 0): void {
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
    this.optimisticUsers.push(item);
    this.publishConversation();
  }

  /**
   * 回显到达：本地乐观行就此交棒给真实 user/message 行（对齐小程序 pending adoption）。
   * 发送是串行的，收到任意用户消息就把队首乐观行消掉，避免文本被网关规范化后出现双气泡。
   */
  private adoptOptimisticUser(echoed: string): void {
    if (this.optimisticUsers.length === 0) {
      return;
    }
    this.optimisticUsers.shift();
    this.publishConversation();
  }

  private publish(): void {
    AppStorage.setOrCreate<SessionRow[]>('sessionRows', this.rows.slice());
    AppStorage.setOrCreate<number>('sessionRowCount', this.rows.length);
  }
}