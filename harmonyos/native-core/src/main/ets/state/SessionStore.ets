import { GatewayFrame, RawSessionEvent, SessionEvent } from '../protocol/GatewayDtos';
import { asRec, bool, field, normalizeRawSessionEvent, num, str } from '../protocol/GatewayFrameCodec';
import { GatewayClient } from '../network/GatewayClient';
import { EventProjector } from './EventProjector';
import { Logger } from '../common/Logger';

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
  private sessionId: string = '';
  private attached: boolean = false;
  private client: GatewayClient | null = null;
  private oldestSeq: number = 0;
  private hasMore: boolean = false;

  static get(): SessionStore {
    return SessionStore.instance;
  }

  attach(client: GatewayClient): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.client = client;
    client.onFrame((frame: GatewayFrame) => this.consume(frame));
    Logger.info('session store attached');
  }

  currentSessionId(): string {
    return this.sessionId;
  }

  consume(frame: GatewayFrame): void {
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
      const rawPresets: Object | undefined = field(frame, 'presets');
      const presets: Object[] = rawPresets !== undefined && Array.isArray(rawPresets) ? rawPresets as Object[]
        : (frame.items !== undefined ? frame.items : []);
      for (const one of presets) {
        const id: string = str(one, 'id') ?? '';
        if (id.length > 0) {
          names.push(str(one, 'name') ?? id);
        }
      }
      AppStorage.setOrCreate<string[]>('agentPresetList', names);
      return;
    }
    if (frame.kind === 'models') {
      const names: string[] = [];
      for (const one of (frame.items !== undefined ? frame.items : [])) {
        const id: string = str(one, 'id') ?? str(one, 'model') ?? '';
        if (id.length > 0) {
          names.push(id);
        }
      }
      AppStorage.setOrCreate<string[]>('modelList', names);
      return;
    }
    if (frame.kind === 'permission-options') {
      const names: string[] = [];
      const rawOpts: Object | undefined = field(frame, 'options');
      const opts: Object[] = rawOpts !== undefined && Array.isArray(rawOpts) ? rawOpts as Object[]
        : (frame.items !== undefined ? frame.items : []);
      for (const one of opts) {
        const value: string = str(one, 'value') ?? str(one, 'id') ?? '';
        if (value.length > 0) {
          names.push(str(one, 'name') ?? value);
        }
      }
      AppStorage.setOrCreate<string[]>('permissionList', names);
      return;
    }
    if (frame.kind === 'directories') {
      this.consumeDirectories(frame);
      return;
    }
    if (frame.kind === 'history') {
      this.sessionId = frame.sessionId !== undefined ? frame.sessionId : this.sessionId;
      const events: RawSessionEvent[] = frame.events !== undefined ? frame.events : [];
      if (frame.hasMore !== undefined) {
        this.hasMore = frame.hasMore;
      }
      for (const raw of events) {
        if (raw.seq < this.oldestSeq || this.oldestSeq === 0) {
          this.oldestSeq = raw.seq;
        }
      }
      AppStorage.setOrCreate<boolean>('historyHasMore', this.hasMore);
      AppStorage.setOrCreate<number>('historyOldestSeq', this.oldestSeq);
      this.rows = [];
      EventProjector.get().reset();
      for (const raw of events) {
        this.appendRaw(raw);
      }
      this.publish();
      return;
    }
    if (frame.kind === 'event') {
      const raw: RawSessionEvent | undefined = this.rawFromFrame(frame);
      if (raw !== undefined) {
        this.appendRaw(raw);
        this.publish();
      }
    }
  }

  /** 目录列表：directories 帧 → 添加工作区弹层。 */
  private consumeDirectories(frame: GatewayFrame): void {
    const items: Object[] = frame.items !== undefined ? frame.items : [];
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
        isDirectory: bool(item, 'isDirectory') === true
      });
    }
    const current: string = str(frame, 'path') ?? '';
    AppStorage.setOrCreate<DirEntry[]>('dirEntries', entries);
    AppStorage.setOrCreate<string>('dirCurrent', current);
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
    Logger.info('workspaces=' + rows.length);
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
    if (this.sessionId.length === 0 && list.length > 0 && this.client !== null) {
      this.sessionId = list[0].id;
      this.client.openSession(this.sessionId);
      Logger.info('auto open session ' + this.sessionId);
    }
  }

  /** 加载更早一页历史。 */
  loadOlder(): boolean {
    if (this.client === null || this.sessionId.length === 0 || this.oldestSeq <= 0) {
      return false;
    }
    return this.client.requestOlderHistory(this.sessionId, this.oldestSeq);
  }

  /** 手动打开某个会话（首页点列表时调用）。 */
  open(sessionId: string): void {
    this.sessionId = sessionId;
    this.rows = [];
    this.publish();
    AppStorage.setOrCreate<QueueItem[]>('queueItems', []);
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
    EventProjector.get().consume(event);
    const type: string = event.event.type;
    const text: string = event.event.text !== undefined ? event.event.text : '';
    if (type === 'user/message') {
      this.push('user', text, event.seq);
      return;
    }
    if (type === 'assistant/chunk' || type === 'assistant/message') {
      const last = this.rows.length > 0 ? this.rows[this.rows.length - 1] : undefined;
      if (last !== undefined && last.role === 'assistant' && type === 'assistant/chunk') {
        this.rows[this.rows.length - 1] = {
          id: last.id,
          role: 'assistant',
          text: last.text + text,
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