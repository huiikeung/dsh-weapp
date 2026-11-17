import { PreferencesStore } from '../common/PreferencesStore';
import { GatewayFrame, RawSessionEvent, SessionEvent, GatewayPendingQuestionRequest, GatewayPendingApprovalRequest, GatewayDirectoryItem } from '../protocol/GatewayDtos';
import { asRec, bool, field, normalizeRawSessionEvent, num, str } from '../protocol/GatewayFrameCodec';
import { GatewayClient } from '../network/GatewayClient';
import { EventProjector } from './EventProjector';
import { Logger } from '../common/Logger';
import { isOlderHistoryPage } from './HistoryPageMatcher';
import { ConversationItem, ConversationProjectionLabels, ConversationProjector } from '../projection/ConversationProjection';

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
  private questions: Map<string, GatewayPendingQuestionRequest> = new Map();
  private approvals: Map<string, GatewayPendingApprovalRequest> = new Map();
  /** 对话投影（生成时间线用的过程条目）；与轨迹投影 EventProjector 并行存在。 */
  private conversation: ConversationProjector | null = null;
  /** 当前会话是否正在生成：turn/start 起，turn/end 止。 */
  private running: boolean = false;

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
      this.clearPendingPrompts();
      EventProjector.get().reset();
      this.resetConversation();
      AppStorage.setOrCreate<SessionSummary[]>('sessions', []);
      AppStorage.setOrCreate<QueueItem[]>('queueItems', []);
      AppStorage.setOrCreate<number>('queueCount', 0);
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
      this.publish();
      return;
    }
    if (frame.kind === 'session-snapshot') {
      const responseSession: string = frame.sessionId !== undefined ? frame.sessionId : this.sessionId;
      if (this.sessionId.length > 0 && responseSession !== this.sessionId) return;
      const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
      if (frame.resetRequired === true || frame.replace === true) {
        this.replaceSnapshot(events, frame.cursor, frame.resetRequired === true);
      } else {
        this.rawEvents = this.mergeHistoryEvents(events, this.rawEvents);
      }
      this.rebuildProjection();
      if (frame.hasMore !== undefined) this.hasMore = frame.hasMore;
      let minSeq: number = 0;
      for (const raw of this.rawEvents) {
        if (raw.seq > 0 && (minSeq === 0 || raw.seq < minSeq)) minSeq = raw.seq;
      }
      this.oldestSeq = minSeq;
      AppStorage.setOrCreate<boolean>('historyHasMore', this.hasMore);
      AppStorage.setOrCreate<number>('historyOldestSeq', this.oldestSeq);
      this.publish();
      return;
    }
    if (frame.kind === 'event') {
      const frameSession: string = frame.sessionId !== undefined ? frame.sessionId : this.sessionId;
      if (this.sessionId.length > 0 && frameSession !== this.sessionId) return;
      const raw: RawSessionEvent | undefined = this.rawFromFrame(frame);
      if (raw !== undefined && !this.hasRawEvent(raw)) {
        this.rawEvents.push(raw);
        if (this.rawEvents.length > 5000) this.rawEvents.splice(0, this.rawEvents.length - 5000);
        this.appendRaw(raw);
        this.publish();
        this.publishConversation();
        // 首页会话状态即时更新：事件流比 sessions 快照快得多
        if (raw.type === 'turn/end') {
          this.markSessionRunning(frameSession, false);
        } else {
          this.markSessionRunning(frameSession, true);
        }
        this.liveEventCount += 1;
        if (this.liveEventCount % 10 === 1) {
          const proj: ConversationProjector = this.conversation as ConversationProjector;
          Logger.info('live event type=' + raw.type + ' items=' + proj.items.length.toString());
        }
      }
    }
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
  }

  /** 把单条原始事件折叠进对话投影。 */
  /** 每 2.5s 拉一次会话列表，保证首页「运行中」状态及时（前台才拉）。 */
  private startSessionsPoll(): void {
    if (this.sessionsTimer >= 0) {
      return;
    }
    this.sessionsTimer = setInterval(() => {
      if (this.client === null) {
        return;
      }
      const lifecycle: string = AppStorage.get<string>('appLifecycle') ?? 'foreground';
      if (lifecycle === 'background') {
        return;
      }
      this.client.requestSessions().then((frame: GatewayFrame) => {
        this.consumeSessions(frame);
      }).catch(() => {
      });
    }, 2500);
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
    const next: SessionSummary[] = [];
    for (const one of current) {
      if (one.id === targetSessionId && one.running !== running) {
        next.push({
          id: one.id,
          title: one.title,
          running: running,
          updatedAt: one.updatedAt,
          cwd: one.cwd
        });
        changed = true;
      } else {
        next.push(one);
      }
    }
    if (changed) {
      AppStorage.setOrCreate<SessionSummary[]>('sessions', next);
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
    const projector: ConversationProjector = this.conversation as ConversationProjector;
    projector.fold(event);
    // 网关可能只发 step/start（不发 turn/start），这些事件都代表本轮仍在进行
    const liveType: string = event.event.type;
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
      // 120ms：比网关事件粒度更细一档，保证运行中内容即时映射到界面
      this.publishConversation();
    }, 120);
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
    AppStorage.setOrCreate<ConversationItem[]>('conversationItems', projector.items);
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
      entries.push({
        name: name.length > 0 ? name : path,
        path: path,
        isDirectory: bool(item, 'isDirectory') === true,
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
            cwd: str(item, 'cwd') ?? ''
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
    const list: SessionSummary[] = [];
    for (const item of items) {
      // 网关字段是 sessionId（兼容旧版 id）。
      const rawId: string | undefined = str(item, 'sessionId') ?? str(item, 'id');
      const id: string = rawId !== undefined ? rawId : '';
      if (id.length === 0) {
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
      const running: boolean = bool(item, 'running') === true;
      const updatedAt: number = num(item, 'updatedAt') ?? 0;
      const cwd: string = str(item, 'cwd') ?? '';
      list.push({ id: id, title: title, running: running, updatedAt: updatedAt, cwd: cwd });
    }
    AppStorage.setOrCreate<SessionSummary[]>('sessions', list);
    this.saveCatalogCache('cacheSessionsV1', JSON.stringify(list));
    if (this.sessionId.length === 0 && list.length > 0 && this.client !== null) {
      this.open(list[0].id);
      Logger.info('auto open session ' + this.sessionId);
    }
  }

  /** 加载更早一页历史。 */
  loadOlder(): boolean {
    if (this.client === null || this.sessionId.length === 0 || this.oldestSeq <= 0 || this.olderRequestPending) {
      return false;
    }
    this.olderRequestPending = true;
    this.olderRequestCursor = this.oldestSeq;
    const sent: boolean = this.client.requestOlderHistory(this.sessionId, this.oldestSeq, this.historyFormatVersion);
    if (!sent) { this.olderRequestPending = false; this.olderRequestCursor = 0; }
    return sent;
  }

  /** 手动打开某个会话（首页点列表时调用）。 */
  open(sessionId: string): void {
    if (sessionId.length === 0) return;
    if (this.sessionId === sessionId && this.client !== null && this.client.isConnected()) {
      return;
    }
    this.sessionGeneration += 1;
    this.sessionId = sessionId;
    this.rows = [];
    this.rawEvents = [];
    this.olderRequestPending = false;
    this.olderRequestCursor = 0;
    this.historyFormatVersion = 0;
    this.oldestSeq = 0;
    this.hasMore = false;
    this.running = false;
    this.resetConversation();
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
    // 会话级模型目录（带 sessionId 才回 current）与权限选项
    if (this.client !== null) {
      this.client.requestModelsCatalog(sessionId);
      this.client.requestPermissionOptions();
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
      const preview: string = str(raw, 'preview') ?? str(raw, 'text') ?? str(raw, 'rawText') ?? '';
      items.push({ id: id, preview: preview });
    }
    AppStorage.setOrCreate<QueueItem[]>('queueItems', items);
    AppStorage.setOrCreate<number>('queueCount', items.length);
  }

  clear(): void {
    this.rows = [];
    this.publish();
  }

  private publish(): void {
    AppStorage.setOrCreate<SessionRow[]>('sessionRows', this.rows.slice());
    AppStorage.setOrCreate<number>('sessionRowCount', this.rows.length);
  }
}