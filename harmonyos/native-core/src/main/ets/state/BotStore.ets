/**
 * DS-Bot 状态层（对齐 dsh-mobile shared/facade/SharedBotStore.kt 的移动端契约）。
 *
 * 只走网关 Bot 桥：bot-call（requestId 关联）+ bot-subscribe（每条连接一个订阅）。
 * 不写 SessionStore 的会话投影；快照整体发布到 AppStorage('botState') 供页面订阅。
 */
import { GatewayFrame } from '../protocol/GatewayDtos';
import { asRec, arr, bool, field, num, str } from '../protocol/GatewayFrameCodec';
import { GatewayClient } from '../network/GatewayClient';
import { Logger } from '../common/Logger';
import {
  BotActivity, BotAnswerChoice, BotAvatarPhoto, BotChat, BotChatImage, BotChatMessage, BotChatIndicator,
  BotConversationState, BotCreationAgent, BotCreationAppearance, BotCreationColor, BotCreationShape,
  BotInteraction, BotLiveWork, BotMemory, BotPresentedFile, BotQuestionAnswer,
  BotReferenceCandidate, BotReferenceSearch,
  BotRoleDetails, BotRoleOption, BotRoleProfile, BotSchedule, BotSnapshot, emptyBotSnapshot
} from '../protocol/BotDtos';
import { BotCache, BotCachePayload, RestoredBotCache } from './BotCache';
import { BotNotify } from './BotNotify';

interface BotPending {
  endpoint: string;
  chatId: string;
  older: boolean;
  part: number;
}

const EMPTY: string = '';

function rec(value: Object | undefined): Record<string, Object> | undefined {
  return asRec(value);
}

function text(obj: Record<string, Object> | undefined, key: string): string {
  return str(obj, key) ?? EMPTY;
}

function array(obj: Record<string, Object> | undefined, key: string): Object[] {
  return arr(obj, key) ?? [];
}

/** 时间戳（秒或毫秒）→ 毫秒；非法值返回 0。 */
function epochMs(value: Object | undefined): number {
  const n: number = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return n > 100000000000 ? n : n * 1000;
}

export class BotStore {
  private static instance: BotStore = new BotStore();
  private client: GatewayClient | null = null;
  private attached: boolean = false;
  private state: BotSnapshot = emptyBotSnapshot();
  private pending: Map<string, BotPending> = new Map<string, BotPending>();
  private histories: Map<string, BotChatMessage[]> = new Map<string, BotChatMessage[]>();
  private cursors: Map<string, Record<string, Object>> = new Map<string, Record<string, Object>>();
  private streams: Map<string, BotChatMessage> = new Map<string, BotChatMessage>();
  private optimistic: Map<string, BotChatMessage[]> = new Map<string, BotChatMessage[]>();
  private dirty: Set<string> = new Set<string>();
  private sessionChats: Map<string, string> = new Map<string, string>();
  private revision: number = -1;
  private ordinal: number = 0;
  private subscription: string = EMPTY;
  private wantAvatars: Map<string, string> = new Map<string, string>();
  private attemptedAvatars: Map<string, string> = new Map<string, string>();
  private boot: string = EMPTY;
  private feedBoot: string = EMPTY;
  private noticeSeq: number = 0;
  private noticeTip: number = 0;
  private queuedNotices: Map<number, Record<string, Object>> = new Map<number, Record<string, Object>>();
  private readThrough: Map<string, number> = new Map<string, number>();
  private foreground: boolean = true;
  private stateDirty: boolean = false;
  private prefetched: boolean = false;
  /** 分块读取（Bot 图片）用的一次性回执等待者 */
  private waiters: Map<string, (value: Record<string, Object> | undefined) => void> = new Map();
  /** BotCache 恢复完成前不落盘（否则空状态会覆盖上次缓存）。 */
  private cacheRestored: boolean = false;
  /** 是否已收到过主机数据：收到后缓存只补空位，不覆盖在线状态。 */
  private hostDataSeen: boolean = false;

  static get(): BotStore {
    return BotStore.instance;
  }

  attach(client: GatewayClient): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    this.client = client;
    // 冷启动先读本地缓存（按主机分文件），只填可展示状态，不触发网络
    this.restoreCache();
    client.onFrame((frame: GatewayFrame) => {
      try {
        this.consume(frame);
      } catch (error) {
        Logger.warn('bot frame failed: ' + (error instanceof Error ? error.message : String(error)));
      }
    });
    Logger.info('bot store attached');
  }

  snapshot(): BotSnapshot {
    return this.state;
  }

  isSupported(): boolean {
    return this.state.supported;
  }

  // ==================== 生命周期 ====================

  /** 连接建立 / 回到前台时调用：必要的话重新订阅并拉全量。 */
  refreshAll(): void {
    // 重连 / 回前台重新拉取：清空已发通知集合（同一 boot:seq 不会重复提醒）
    BotNotify.reset();
    // 设置页切换主机后回到前台：重新绑定缓存分文件键（旧主机缓存不串台）
    BotCache.get().bind(this.cacheHostKey());
    if (this.client === null || !this.client.isConnected()) {
      this.state.connected = false;
      this.publish();
      return;
    }
    this.state.connected = true;
    this.state.error = undefined;
    if (this.subscription.length === 0) {
      this.subscribe();
    }
    this.readState();
    this.readNotices();
    this.readSchedules();
    const selected: string = this.state.selectedChatId ?? EMPTY;
    if (selected.length > 0) {
      this.readChat(selected, false);
    }
    this.publish();
  }

  setForeground(active: boolean): void {
    this.foreground = active;
    if (active) {
      this.refreshAll();
      this.markChatRead(this.state.selectedChatId);
    }
  }

  private subscribe(): void {
    const id: string = this.nextId();
    this.subscription = id;
    this.pending.set(id, { endpoint: 'subscribe', chatId: EMPTY, older: false, part: 0 });
    const frame: Record<string, Object> = { 'type': 'bot-subscribe', 'requestId': id };
    this.post(frame);
  }

  private unsubscribe(): void {
    if (this.subscription.length === 0) {
      return;
    }
    const id: string = this.nextId();
    const frame: Record<string, Object> = { 'type': 'bot-unsubscribe', 'requestId': id };
    this.post(frame);
    this.subscription = EMPTY;
  }

  private nextId(): string {
    this.ordinal += 1;
    return 'bot-' + this.ordinal.toString();
  }

  private post(payload: Record<string, Object>): boolean {
    if (this.client === null) {
      return false;
    }
    return this.client.send(JSON.stringify(payload));
  }

  private call(endpoint: string, payload: Record<string, Object>, chatId: string = EMPTY,
    older: boolean = false, part: number = 0): string | null {
    if (this.pending.size >= 32) {
      return null;
    }
    if (endpoint !== 'send' && endpoint !== 'send-attachments') {
      let duplicate: boolean = false;
      this.pending.forEach((p: BotPending) => {
        if (p.endpoint === endpoint && p.chatId === chatId) {
          duplicate = true;
        }
      });
      if (duplicate) {
        return null;
      }
    }
    const id: string = this.nextId();
    this.pending.set(id, { endpoint: endpoint, chatId: chatId, older: older, part: part });
    const frame: Record<string, Object> = { 'type': 'bot-call', 'requestId': id, 'endpoint': endpoint, 'payload': payload };
    this.post(frame);
    // 32s 兜底超时（对齐 iOS Bot 请求超时）：主机不回包时清掉 pending 并落到失败态，
    // 否则写操作会一直 Spinner、pending 槽位也会被占满。
    const requestId: string = id;
    setTimeout(() => {
      if (this.pending.has(requestId)) {
        this.fail(requestId, 'request-timeout');
      }
    }, 32000);
    return id;
  }

  /** 角色类写操作（失败要落到 roleError，并解除 roleSaving） */
  private isRoleWrite(endpoint: string): boolean {
    return endpoint === 'update-bot' || endpoint === 'memory-add' || endpoint === 'memory-edit'
      || endpoint === 'memory-forget' || endpoint === 'schedule-create' || endpoint === 'schedule-delete'
      || endpoint === 'duplicate-bot' || endpoint === 'delete-bot' || endpoint === 'set-main';
  }

  /**
   * 发一条 bot-call 并等待 value（图片分块等一次性读取用）。
   * 30s 超时或连接失败时返回 undefined；调用方自行降级。
   */
  requestValue(endpoint: string, payload: Record<string, Object>,
    chatId: string = EMPTY): Promise<Record<string, Object> | undefined> {
    return new Promise<Record<string, Object> | undefined>((resolve) => {
      const id: string = this.nextId();
      this.pending.set(id, { endpoint: endpoint, chatId: chatId, older: false, part: 0 });
      const timer: number = setTimeout(() => {
        if (this.waiters.has(id)) {
          this.waiters.delete(id);
          this.pending.delete(id);
          resolve(undefined);
        }
      }, 30000);
      const done = (value: Record<string, Object> | undefined): void => {
        clearTimeout(timer);
        resolve(value);
      };
      this.waiters.set(id, done);
      const frame: Record<string, Object> = {
        'type': 'bot-call', 'requestId': id, 'endpoint': endpoint, 'payload': payload
      };
      if (!this.post(frame)) {
        clearTimeout(timer);
        this.waiters.delete(id);
        this.pending.delete(id);
        resolve(undefined);
      }
    });
  }

  private fail(id: string, code: string): void {
    const pending: BotPending | undefined = this.pending.get(id);
    this.pending.delete(id);
    // @ 引用候选失败：只清 loading 并标记不可用，不冒泡全局 error（对齐 iOS SharedBotStore.fail）。
    if (pending !== undefined && pending.endpoint === 'reference-candidates') {
      this.applyReferenceFailure(pending);
      return;
    }
    this.state.error = code;
    if (pending !== undefined) {
      // 发送超时/失败：乐观气泡转「状态待确认」，不自动重发（对齐 iOS 的 delivery=unknown）
      if (pending.endpoint === 'send' || pending.endpoint === 'send-attachments') {
        const list: BotChatMessage[] = this.optimistic.get(pending.chatId) ?? [];
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].delivery === 'sending') {
            list[i].delivery = 'unknown';
            break;
          }
        }
        this.optimistic.set(pending.chatId, list);
      }
      // 角色写失败：解除保存中并写 roleError，让角色页能显示具体原因
      if (this.isRoleWrite(pending.endpoint)) {
        this.state.roleSaving = false;
        this.state.roleError = code;
        this.publish();
        return;
      }
    }
    if (pending !== undefined && this.applyCreationFailure(pending, code)) {
      return;
    }
    this.publish();
  }

  /** 新建 Bot 相关请求失败：清掉 loading 并落到 failed 态，避免页面一直转圈。 */
  private applyCreationFailure(pending: BotPending, code: string): boolean {
    const endpoint: string = pending.endpoint;
    if (endpoint === 'creation-appearance') {
      this.state.creation.loadingAppearance = false;
      this.state.creation.appearanceFailed = true;
      this.publish();
      return true;
    }
    if (endpoint === 'local-agents') {
      this.state.creation.loadingAgents = false;
      this.state.creation.agentsFailed = true;
      this.publish();
      return true;
    }
    if (endpoint === 'local-agent-models') {
      if (this.state.creation.agentRoute === pending.chatId) {
        this.state.creation.loadingAgentModels = false;
      }
      this.publish();
      return true;
    }
    if (endpoint === 'avatar-library' || endpoint === 'avatar-import') {
      this.state.creation.loadingPhotos = false;
      this.state.creation.photosFailed = true;
      this.publish();
      return true;
    }
    if (endpoint === 'create-bot') {
      const timedOut: boolean = code === 'bot-timeout' || code === 'request-timeout'
        || code === 'timeout' || code === 'disconnected' || code === 'connection-lost';
      this.state.creation.saving = false;
      this.state.creation.createdId = undefined;
      this.state.creation.error = timedOut ? 'uncertain' : code;
      this.revision = -1;
      this.readState();
      this.publish();
      return true;
    }
    return false;
  }

  /** 新建 Bot 的一次性 bot-call：补 15s 超时，主机不回包时也能落到失败态。 */
  private creationCall(endpoint: string, payload: Record<string, Object>,
    chatId: string = EMPTY): string | null {
    const id: string | null = this.call(endpoint, payload, chatId);
    if (id !== null) {
      const requestId: string = id;
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.fail(requestId, 'request-timeout');
        }
      }, 15000);
    }
    return id;
  }

  // ==================== 帧分发 ====================

  consume(frame: GatewayFrame): void {
    const kind: string = frame.kind;
    if (kind === 'hello') {
      // 每次连接（含重连）都会重新握手：旧订阅在网关侧已失效，必须重新订阅并全量对齐。
      this.subscription = EMPTY;
      this.feedBoot = EMPTY;
      this.refreshAll();
      return;
    }
    if (kind === 'bot-subscribed') {
      const requestId: string = str(frame as Object, 'requestId') ?? EMPTY;
      const subscriptionId = field(frame as Object, 'subscriptionId');
      if (requestId.length === 0 || requestId !== this.subscription) {
        return;
      }
      this.pending.delete(requestId);
      this.hostDataSeen = true;
      if (subscriptionId === null || subscriptionId === undefined) {
        this.subscription = EMPTY;
        this.state.feedActive = false;
        this.publish();
        return;
      }
      const hello = rec(field(frame as Object, 'hello'));
      const caps: string[] = [];
      for (const one of array(hello, 'capabilities')) {
        if (typeof one === 'string') {
          caps.push(one as string);
        }
      }
      this.state.capabilities = caps;
      this.state.feedActive = true;
      this.state.supported = true;
      this.state.error = undefined;
      this.applyCapabilities(caps);
      // 订阅确认后立刻对齐一次
      this.readState();
      this.readNotices();
      this.readSchedules();
      const selected: string = this.state.selectedChatId ?? EMPTY;
      if (selected.length > 0) {
        this.readChat(selected, false);
      }
      this.publish();
      return;
    }
    if (kind === 'bot-stream-reset') {
      const sub: string = str(frame as Object, 'subscriptionId') ?? EMPTY;
      if (sub !== this.subscription) {
        return;
      }
      this.subscription = EMPTY;
      this.feedBoot = EMPTY;
      this.state.feedActive = false;
      this.state.error = 'bot-feed-interrupted';
      this.publish();
      return;
    }
    if (kind === 'bot-event') {
      const sub: string = str(frame as Object, 'subscriptionId') ?? EMPTY;
      if (sub !== this.subscription) {
        return;
      }
      const event: string = str(frame as Object, 'botEvent') ?? EMPTY;
      const data = rec(field(frame as Object, 'botData'));
      this.onBotEvent(event, data);
      return;
    }
    if (kind === 'bot-result') {
      const requestId: string = str(frame as Object, 'requestId') ?? EMPTY;
      const waiter: ((value: Record<string, Object> | undefined) => void) | undefined = this.waiters.get(requestId);
      if (waiter !== undefined && requestId.length > 0) {
        this.waiters.delete(requestId);
        this.pending.delete(requestId);
        waiter(rec(field(frame as Object, 'value')));
        return;
      }
      const pending: BotPending | undefined = this.pending.get(requestId);
      if (pending === undefined) {
        return;
      }
      const endpoint: string = str(frame as Object, 'endpoint') ?? EMPTY;
      if (endpoint !== pending.endpoint) {
        return;
      }
      this.pending.delete(requestId);
      this.onReply(endpoint, pending, rec(field(frame as Object, 'value')));
      return;
    }
    if (kind === 'error') {
      const requestId: string = str(frame as Object, 'requestId') ?? EMPTY;
      const waiter: ((value: Record<string, Object> | undefined) => void) | undefined = this.waiters.get(requestId);
      if (waiter !== undefined) {
        this.waiters.delete(requestId);
        this.pending.delete(requestId);
        waiter(undefined);
        return;
      }
      if (requestId.length > 0 && this.pending.has(requestId)) {
        this.fail(requestId, str(frame as Object, 'code') ?? 'bot-request-failed');
      }
    }
  }

  private applyCapabilities(caps: string[]): void {
    const has = (cap: string): boolean => caps.indexOf(cap) >= 0;
    this.state.roleSettingsSupported = has('role-settings');
    this.state.attachmentsSupported = has('bot-attachments');
    this.state.referencesSupported = has('reference-candidates');
    this.state.botDeletionSupported = has('bot-deletion');
    this.state.creation.supported = has('bot-creation');
    this.state.conversation.supported = has('bot-conversations');
  }

  // ==================== 读取 ====================

  private readState(): void {
    let inFlight: boolean = false;
    this.pending.forEach((p: BotPending) => {
      if (p.endpoint === 'state') {
        inFlight = true;
      }
    });
    if (inFlight) {
      this.stateDirty = true;
      return;
    }
    const payload: Record<string, Object> = { 'avatars': 'ref', 'since': this.revision };
    const sent: string | null = this.call('state', payload);
    if (sent !== null) {
      this.state.loading = true;
    }
  }

  private readNotices(): void {
    const payload: Record<string, Object> = { 'since': this.noticeSeq };
    if (this.boot.length > 0) {
      payload.boot = this.boot;
    }
    this.call('notices', payload);
  }

  private readSchedules(): void {
    const payload: Record<string, Object> = {};
    this.call('schedules', payload);
  }

  private readChat(chatId: string, older: boolean): void {
    if (chatId.length === 0) {
      return;
    }
    let chat: BotChat | null = null;
    for (const one of this.state.chats) {
      if (one.id === chatId) {
        chat = one;
      }
    }
    if (chat === null) {
      return;
    }
    let busy: boolean = false;
    this.pending.forEach((p: BotPending) => {
      if (p.chatId === chatId && (p.endpoint === 'chat' || p.endpoint === 'room-chat')) {
        busy = true;
      }
    });
    if (busy) {
      if (!older) {
        this.dirty.add(chatId);
      }
      return;
    }
    const cursor: Record<string, Object> | undefined = older ? this.cursors.get(chatId) : undefined;
    const payload: Record<string, Object> = {};
    payload[chat.room ? 'roomId' : 'botId'] = chatId;
    if (!chat.room) {
      payload.historyDetails = true;
    }
    if (cursor !== undefined) {
      payload.cursor = cursor;
    }
    this.call(chat.room ? 'room-chat' : 'chat', payload, chatId, older, chat.part);
    if (chatId === this.state.selectedChatId) {
      this.state.historyLoading = true;
      this.publish();
    }
  }

  // ==================== 回执解析 ====================

  private onReply(endpoint: string, pending: BotPending, value: Record<string, Object> | undefined): void {
    this.hostDataSeen = true;
    const obj: Record<string, Object> = value !== undefined ? value : {};
    if (endpoint === 'reference-candidates') {
      this.applyReferenceCandidates(pending, value);
      return;
    }
    if (endpoint === 'state') {
      this.applyState(obj);
      return;
    }
    if (endpoint === 'chat' || endpoint === 'room-chat') {
      this.applyChatPage(obj, pending);
      return;
    }
    if (endpoint === 'notices') {
      this.applyNotices(obj);
      return;
    }
    if (endpoint === 'creation-appearance') {
      this.applyCreationAppearance(obj);
      return;
    }
    if (endpoint === 'local-agents') {
      this.applyLocalAgents(obj);
      return;
    }
    if (endpoint === 'local-agent-models') {
      this.applyLocalAgentModels(obj, pending);
      return;
    }
    if (endpoint === 'avatar-library') {
      this.applyAvatarLibrary(obj, pending);
      return;
    }
    if (endpoint === 'avatar-import') {
      this.applyAvatarImport(obj);
      return;
    }
    if (endpoint === 'create-bot') {
      this.applyCreateBot(obj);
      return;
    }
    if (endpoint === 'create-room') {
      this.applyCreateRoom(obj);
      return;
    }
    if (endpoint === 'set-flags') {
      this.applySetFlags(obj, pending);
      return;
    }
    if (endpoint === 'schedules' || endpoint === 'schedule-create' || endpoint === 'schedule-delete') {
      this.applySchedules(obj, endpoint);
      return;
    }
    if (endpoint === 'avatar') {
      this.applyAvatar(obj, pending);
      return;
    }
    if (endpoint === 'efforts') {
      this.applyEfforts(obj, pending);
      return;
    }
    if (endpoint === 'send' || endpoint === 'send-attachments') {
      this.applySendAck(pending);
      return;
    }
    if (endpoint === 'answer-question' || endpoint === 'approval-answer') {
      this.readState();
      const selected: string = this.state.selectedChatId ?? EMPTY;
      if (selected.length > 0) {
        this.readChat(selected, false);
      }
      return;
    }
    if (endpoint === 'memory-view' || endpoint === 'memory-add' || endpoint === 'memory-edit'
      || endpoint === 'memory-forget' || endpoint === 'usage-summary') {
      this.applyRoleDetails(endpoint, obj, pending);
      return;
    }
    if (endpoint === 'role-settings' || endpoint === 'update-bot' || endpoint === 'duplicate-bot'
      || endpoint === 'delete-bot' || endpoint === 'set-main') {
      this.state.roleSaving = false;
      this.readState();
      return;
    }
    if (endpoint === 'create-room' || endpoint === 'set-flags') {
      this.readState();
      return;
    }
    if (endpoint === 'creation-appearance') {
      return;
    }
    // 其余写操作：统一刷新状态
    this.readState();
  }

  private applyState(obj: Record<string, Object>): void {
    this.state.loading = false;
    const version: number = num(obj, 'revision') ?? -1;
    if (version < this.revision && version >= 0) {
      this.publish();
      return;
    }
    this.revision = version >= 0 ? version : this.revision;
    const unchanged: boolean = bool(obj, 'unchanged') === true;
    const work = rec(field(obj, 'work'));
    const bots: Object[] = array(obj, 'bots');
    const rooms: Object[] = array(obj, 'rooms');

    if (!unchanged) {
      this.sessionChats.clear();
      for (const entry of bots.concat(rooms)) {
        const peer = rec(entry);
        const peerId: string = peer !== undefined ? text(peer, 'id') : EMPTY;
        if (peerId.length === 0) {
          continue;
        }
        const sessionId: string = peer !== undefined ? text(peer, 'sessionId') : EMPTY;
        this.sessionChats.set(sessionId.length > 0 ? sessionId : peerId, peerId);
      }
      const peers: BotChat[] = [];
      for (const entry of bots) {
        const chat: BotChat | null = this.toPeer(entry, false);
        if (chat !== null) {
          peers.push(chat);
        }
      }
      for (const entry of rooms) {
        const chat: BotChat | null = this.toPeer(entry, true);
        if (chat !== null) {
          peers.push(chat);
        }
      }
      peers.sort((a: BotChat, b: BotChat) => b.lastAt - a.lastAt);
      const models: BotRoleOption[] = [];
      for (const item of array(obj, 'models')) {
        const row = rec(item);
        const ref: string = row !== undefined ? text(row, 'ref') : EMPTY;
        if (ref.length === 0) {
          continue;
        }
        models.push({ id: ref, title: row !== undefined && text(row, 'name').length > 0 ? text(row, 'name') : ref });
      }
      const permissions: BotRoleOption[] = [];
      const permObj = rec(field(obj, 'permissions'));
      for (const item of array(permObj, 'options')) {
        const option = rec(item);
        const id: string = option !== undefined ? text(option, 'value') : EMPTY;
        if (id.length === 0) {
          continue;
        }
        permissions.push({ id: id, title: option !== undefined && text(option, 'label').length > 0 ? text(option, 'label') : id });
      }
      this.state.chats = peers;
      this.state.models = models;
      this.state.permissions = permissions;
      this.state.mainBotId = text(obj, 'mainBotId').length > 0 ? text(obj, 'mainBotId') : undefined;
      this.state.mainBotIds = [];
      for (const one of array(obj, 'mainBotIds')) {
        if (typeof one === 'string') {
          this.state.mainBotIds.push(one as string);
        }
      }
      this.state.rosterIds = [];
      for (const chat of peers) {
        if (!chat.room) {
          this.state.rosterIds.push(chat.id);
        }
      }
      const defaultModel: string = text(obj, 'defaultModel');
      this.state.defaultModel = defaultModel.length > 0 ? defaultModel : undefined;
      this.state.memoryAvailable = obj.memory !== false;
      const computer = rec(field(obj, 'computer'));
      this.state.computerEnabled = computer !== undefined && bool(computer, 'enabled') === true;
      this.state.writable = obj.readOnly === undefined || obj.readOnly === null || obj.readOnly === false;
      // 头像引用登记
      this.wantAvatars.clear();
      for (const entry of bots) {
        const bot = rec(entry);
        if (bot === undefined) {
          continue;
        }
        const id: string = text(bot, 'id');
        const avatar = rec(field(bot, 'avatar'));
        const ref: string = avatar !== undefined ? text(avatar, 'imageRef') : EMPTY;
        if (id.length > 0 && ref.length > 0) {
          this.wantAvatars.set(id, ref);
        }
      }
      this.loadAvatars();
      // 选中会话仍然存在则保持，否则落在第一台 Bot / 群聊
      const selected: string = this.state.selectedChatId ?? EMPTY;
      let stillThere: boolean = false;
      for (const chat of peers) {
        if (chat.id === selected) {
          stillThere = true;
        }
      }
      if (!stillThere && selected.length > 0) {
        this.state.selectedChatId = undefined;
        this.state.messages = [];
      }
      if ((this.state.selectedChatId ?? EMPTY).length === 0 && peers.length > 0) {
        this.state.selectedChatId = peers[0].id;
      }
      // 交互（提问 / 审批）
      const interactions: BotInteraction[] = [];
      const questions = rec(field(obj, 'questions'));
      if (questions !== undefined) {
        for (const key of Object.keys(questions)) {
          const question = rec(field(questions, key));
          if (question === undefined) {
            continue;
          }
          const qid: string = text(question, 'id');
          if (qid.length === 0) {
            continue;
          }
          const options: string[] = [];
          for (const option of array(question, 'options')) {
            const row = rec(option);
            if (row !== undefined) {
              options.push(text(row, 'label'));
            } else if (typeof option === 'string') {
              options.push(option as string);
            }
          }
          interactions.push({
            id: qid, kind: 'question',
            chatId: this.sessionChats.get(key) ?? key,
            sessionId: key, title: text(question, 'question'),
            detail: text(question, 'detail'), options: options,
            multiSelect: bool(question, 'multiSelect') === true
          });
        }
      }
      const workRec = rec(field(obj, 'work'));
      const approvals: Object[] = array(workRec, 'approvals');
      Logger.info('[BotApprovals] work=' + (workRec !== undefined ? Object.keys(workRec).join(',') : 'none')
        + ' raw=' + approvals.length.toString() + ' selected=' + (this.state.selectedChatId ?? ''));
      for (const value of approvals) {
        const approval = rec(value);
        if (approval === undefined) {
          continue;
        }
        Logger.info('[BotApprovals] item id=' + text(approval, 'id') + ' answerable=' + (bool(approval, 'answerable') === false ? '0' : '1')
          + ' botId=' + text(approval, 'botId') + ' roomId=' + text(approval, 'roomId')
          + ' sessionId=' + text(approval, 'sessionId') + ' tool=' + text(approval, 'tool'));
        if (bool(approval, 'answerable') === false) {
          continue;
        }
        const id: string = text(approval, 'id');
        if (id.length === 0) {
          continue;
        }
        const chatIdRaw: string = text(approval, 'roomId').length > 0 ? text(approval, 'roomId') : text(approval, 'botId');
        const detailObj = rec(field(approval, 'detail'));
        interactions.push({
          id: id, kind: 'approval', chatId: chatIdRaw,
          sessionId: text(approval, 'sessionId'),
          title: text(approval, 'reason').length > 0 ? text(approval, 'reason') : text(approval, 'tool'),
          detail: detailObj !== undefined ? text(detailObj, 'text') : EMPTY,
          options: [], multiSelect: false
        });
      }
      this.state.interactions = interactions;
      Logger.info('[BotApprovals] total interactions=' + interactions.length.toString());
    } else if (work !== undefined) {
      for (const chat of this.state.chats) {
        const group = rec(field(work, chat.room ? 'rooms' : 'bots'));
        const entry: Object | undefined = group !== undefined ? group[chat.id] : undefined;
        chat.running = entry !== undefined && entry !== null
          && (!Array.isArray(entry) || (entry as Object[]).length > 0);
      }
    }
    this.state.liveWork = this.computeLiveWork(obj);

    if (this.stateDirty) {
      this.stateDirty = false;
      this.readState();
    }
    const selectedId: string = this.state.selectedChatId ?? EMPTY;
    if (selectedId.length > 0) {
      this.readChat(selectedId, false);
    }
    this.publish();
  }

  /** work → 每会话的实时状态（对齐 liveStatus）。 */
  private computeLiveWork(obj: Record<string, Object>): Record<string, BotLiveWork> {
    const out: Record<string, BotLiveWork> = {};
    const work = rec(field(obj, 'work'));
    if (work === undefined) {
      return out;
    }
    const bots = rec(field(work, 'bots'));
    const rooms = rec(field(work, 'rooms'));
    const turns = rec(field(work, 'turns'));
    const steered = rec(field(work, 'steered'));
    for (const chat of this.state.chats) {
      let kind: string = EMPTY;
      let author: string | undefined = undefined;
      let started: number | undefined = undefined;
      if (chat.room) {
        const list: Object[] = array(rooms, chat.id);
        let best: Record<string, Object> | null = null;
        let bestAt: number = 0;
        for (const entry of list) {
          const row = rec(entry);
          if (row === undefined) {
            continue;
          }
          const at: number = epochMs(field(row, 'since'));
          if (best === null || at >= bestAt) {
            best = row;
            bestAt = at;
          }
        }
        const turnAt: number = epochMs(turns !== undefined ? field(turns, chat.sessionId ?? chat.id) : undefined);
        if (best === null && turnAt === 0) {
          continue;
        }
        started = best !== null && bestAt > 0 ? bestAt : turnAt;
        const entryBot: string = best !== null ? text(best, 'botId') : EMPTY;
        if (entryBot.length > 0 && chat.memberIds.indexOf(entryBot) >= 0) {
          author = entryBot;
        }
        kind = best !== null ? this.liveKind(best) : 'thinking';
      } else {
        const session: string = chat.sessionId ?? chat.id;
        const entry = rec(field(bots, chat.id));
        const turnAt: number = epochMs(turns !== undefined ? field(turns, session) : undefined);
        const steeredAt: number = epochMs(steered !== undefined ? field(steered, session) : undefined);
        if (entry === undefined && turnAt === 0) {
          continue;
        }
        started = Math.max(entry !== undefined ? epochMs(field(entry, 'since')) : 0, turnAt, steeredAt);
        author = chat.id;
        kind = entry !== undefined ? this.liveKind(entry) : 'thinking';
      }
      const item: BotLiveWork = { kind: kind, botId: author, startedAtMs: started };
      out[chat.id] = item;
    }
    return out;
  }

  private liveKind(entry: Record<string, Object>): string {
    const tool: string = text(entry, 'tool').trim().toLowerCase().split('-').join('_');
    if (bool(entry, 'switching') === true && bool(entry, 'folder') === true) {
      return 'switching-folder';
    }
    if (tool.length === 0) {
      return 'thinking';
    }
    if (tool.indexOf('web_search') >= 0 || tool.indexOf('search_web') >= 0 || tool.indexOf('websearch') >= 0) {
      return 'web-search';
    }
    if (tool.indexOf('web') >= 0 || tool.indexOf('browse') >= 0 || tool.indexOf('fetch') >= 0) {
      return 'web-read';
    }
    if (tool.indexOf('image') >= 0 || tool.indexOf('photo') >= 0) {
      return 'image';
    }
    return 'working';
  }

  private toPeer(value: Object, room: boolean): BotChat | null {
    const obj = rec(value);
    if (obj === undefined) {
      return null;
    }
    const id: string = text(obj, 'id');
    if (id.length === 0) {
      return null;
    }
    let previous: BotChat | null = null;
    for (const one of this.state.chats) {
      if (one.id === id) {
        previous = one;
      }
    }
    const avatar = rec(field(obj, 'avatar'));
    const ref: string = avatar !== undefined ? text(avatar, 'imageRef') : EMPTY;
    const inlineRaw: string = avatar !== undefined ? text(avatar, 'image') : EMPTY;
    const inline: boolean = inlineRaw.startsWith('data:image/') && inlineRaw.length < 256000;
    const profile: BotRoleProfile | undefined = room ? undefined : {
      instructions: text(obj, 'instructions'),
      model: text(obj, 'model').length > 0 ? text(obj, 'model') : undefined,
      effort: text(obj, 'effort').length > 0 ? text(obj, 'effort') : undefined,
      workDir: text(obj, 'workDir').length > 0 ? text(obj, 'workDir') : undefined,
      permission: text(obj, 'permission').length > 0 ? text(obj, 'permission') : undefined,
      privateRole: bool(obj, 'private') === true,
      appliedModel: text(obj, 'appliedModel').length > 0 ? text(obj, 'appliedModel') : undefined,
      appliedEffort: text(obj, 'appliedEffort').length > 0 ? text(obj, 'appliedEffort') : undefined
    };
    const members: string[] = [];
    for (const one of array(obj, 'members')) {
      if (typeof one === 'string') {
        members.push(one as string);
      }
    }
    const chat: BotChat = {
      id: id,
      name: text(obj, 'name'),
      room: room,
      role: text(obj, 'role'),
      preview: text(obj, 'preview'),
      lastAt: num(obj, 'lastAt') ?? 0,
      running: false,
      part: array(obj, room ? 'ownParts' : 'parts').length,
      memberIds: members,
      hidden: bool(obj, 'hidden') === true
    };
    const sessionId: string = text(obj, 'sessionId');
    if (sessionId.length > 0) {
      chat.sessionId = sessionId;
    }
    if (profile !== undefined) {
      chat.profile = profile;
    }
    if (inline) {
      chat.image = inlineRaw;
      chat.imageRef = ref;
    } else if (previous !== null && ref.length > 0) {
      chat.image = previous.image;
      chat.imageRef = previous.imageRef;
    }
    return chat;
  }

  // ==================== 聊天分页 ====================

  private applyChatPage(obj: Record<string, Object>, pending: BotPending): void {
    const chatId: string = pending.chatId;
    const items: Object[] = array(obj, 'items');
    const page: BotChatMessage[] = [];
    for (let index = 0; index < items.length; index++) {
      const message: BotChatMessage | null = this.toMessage(items[index], chatId, pending.part, obj);
      if (message !== null) {
        page.push(message);
      }
    }
    const previous: BotChatMessage[] = this.histories.get(chatId) ?? [];
    let merged: BotChatMessage[] = [];
    if (pending.older) {
      merged = page.concat(previous);
    } else {
      let overlap: number = -1;
      for (let i = 0; i < previous.length; i++) {
        let found: boolean = false;
        for (const one of page) {
          if (one.id === previous[i].id) {
            found = true;
          }
        }
        if (found) {
          overlap = i;
          break;
        }
      }
      merged = (overlap >= 0 ? previous.slice(0, overlap) : []).concat(page);
    }
    const seen: Set<string> = new Set<string>();
    const deduped: BotChatMessage[] = [];
    for (const one of merged) {
      if (!seen.has(one.id)) {
        seen.add(one.id);
        deduped.push(one);
      }
    }
    const bounded: BotChatMessage[] = deduped.length > 2000 ? deduped.slice(deduped.length - 2000) : deduped;
    this.histories.set(chatId, bounded);
    const cursor = rec(field(obj, 'cursor'));
    if (cursor !== undefined && (pending.older || !this.cursors.has(chatId))) {
      this.cursors.set(chatId, cursor);
    }
    if (!pending.older) {
      const optimistic: BotChatMessage[] = this.optimistic.get(chatId) ?? [];
      const kept: BotChatMessage[] = [];
      for (const one of optimistic) {
        if (one.delivery !== 'sent') {
          kept.push(one);
        }
      }
      this.optimistic.set(chatId, kept);
    }
    if (chatId === this.state.selectedChatId) {
      this.state.historyLoading = false;
    }
    if (this.dirty.has(chatId)) {
      this.dirty.delete(chatId);
      this.readChat(chatId, false);
    }
    // 历史缓存按 12 个会话保留
    if (this.histories.size > 12) {
      const keys: string[] = [];
      this.histories.forEach((v: BotChatMessage[], k: string) => {
        keys.push(k);
      });
      for (const key of keys) {
        if (this.histories.size <= 12) {
          break;
        }
        if (key !== this.state.selectedChatId) {
          this.histories.delete(key);
          this.cursors.delete(key);
        }
      }
    }
    this.publish();
  }

  private toMessage(value: Object, chatId: string, part: number, page: Record<string, Object>): BotChatMessage | null {
    const item = rec(value);
    if (item === undefined) {
      return null;
    }
    const kind: string = text(item, 'kind');
    if (kind.length === 0) {
      return null;
    }
    // 任何消息类型都可能带交付文件（view/answer 里也会带），统一解析，
    // 否则 Bot 模式只对 bot/post/file 显示文件卡，工作模式却有卡片 —— 两边不一致。
    const files: BotPresentedFile[] = this.presentedFiles(item);
    if (kind === 'file' && files.length === 0) {
      return null;
    }
    const sequence: string = num(item, 'seq') !== undefined ? (num(item, 'seq') as number).toString()
      : (text(item, 'id').length > 0 ? text(item, 'id') : 'row');
    const base: string = chatId + ':' + part.toString() + ':' + sequence + ':' + kind;
    const sessionId: string = text(item, 'sessionId').length > 0 ? text(item, 'sessionId')
      : (text(page, 'sessionId').length > 0 ? text(page, 'sessionId') : chatId);
    const activityRaw: string = text(item, 'event');
    const activity: string | undefined = kind === 'event'
      && (activityRaw === 'bot-created' || activityRaw === 'bot-messaged')
      && text(item, 'name').length > 0 ? activityRaw : undefined;
    const images: BotChatImage[] = [];
    for (const ref of array(item, 'imageRefs')) {
      const row = rec(ref);
      if (row === undefined) {
        continue;
      }
      const attachmentId: string = text(row, 'attachmentId');
      if (attachmentId.length === 0 || attachmentId.length > 512) {
        continue;
      }
      const mime: string = text(row, 'mime').length > 0 ? text(row, 'mime') : text(row, 'mediaType');
      const mediaType: string = mime.length > 0 ? mime : 'image/png';
      if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp'
        && mediaType !== 'image/gif' && mediaType !== 'image/bmp') {
        continue;
      }
      images.push({
        attachmentId: attachmentId,
        sessionId: text(row, 'sessionId').length > 0 ? text(row, 'sessionId') : sessionId,
        mediaType: mediaType,
        name: text(row, 'name').substring(0, 255),
        width: Math.max(0, Math.min(16384, num(row, 'width') ?? 0)),
        height: Math.max(0, Math.min(16384, num(row, 'height') ?? 0))
      });
    }
    const timeRaw: number | undefined = num(item, 'time');
    const timeMs: number | undefined = timeRaw !== undefined && timeRaw > 0 && timeRaw < 253402300799999
      ? (timeRaw > 100000000000 ? timeRaw : timeRaw * 1000) : undefined;
    const turnRaw: number | undefined = num(item, 'turn');
    const message: BotChatMessage = {
      id: base + ':0',
      kind: kind,
      text: activity === undefined ? this.messageText(item) : EMPTY,
      name: text(item, 'name'),
      streaming: false,
      sessionId: sessionId,
      images: images,
      questionAnswers: kind === 'answer' ? this.questionAnswers(item) : [],
      files: files
    };
    if (timeMs !== undefined) {
      message.timeMs = timeMs;
    }
    if (activity !== undefined) {
      message.activity = activity;
    }
    const botId: string = text(item, 'botId');
    if (botId.length > 0) {
      message.botId = botId;
    }
    if (turnRaw !== undefined && turnRaw >= 0) {
      message.turn = turnRaw;
    }
    return message;
  }

  private messageText(item: Record<string, Object>): string {
    const direct: string = text(item, 'text');
    if (direct.length > 0) {
      return direct;
    }
    const kind: string = text(item, 'kind');
    if (kind === 'event') {
      return text(item, 'event');
    }
    if (kind === 'answer') {
      return text(item, 'answer');
    }
    if (kind === 'view') {
      return text(item, 'title');
    }
    return EMPTY;
  }

  private questionAnswers(item: Record<string, Object>): BotQuestionAnswer[] {
    const out: BotQuestionAnswer[] = [];
    const answers: Object[] = array(item, 'answers');
    const questions: Object[] = array(item, 'questions');
    for (const value of questions) {
      if (out.length >= 20) {
        break;
      }
      const question = rec(value);
      if (question === undefined) {
        continue;
      }
      const prompt: string = text(question, 'question').length > 0 ? text(question, 'question') : text(question, 'header');
      const id: string = text(question, 'id');
      if (prompt.length === 0 || id.length === 0) {
        continue;
      }
      let answer: Record<string, Object> | undefined = undefined;
      for (const candidate of answers) {
        const row = rec(candidate);
        if (row !== undefined && text(row, 'id') === id) {
          answer = row;
        }
      }
      if (answer === undefined) {
        continue;
      }
      const options: string[] = [];
      for (const option of array(question, 'options')) {
        const row = rec(option);
        if (row !== undefined) {
          options.push(text(row, 'label'));
        } else if (typeof option === 'string') {
          options.push(option as string);
        }
      }
      const selected: string[] = [];
      for (const value of array(answer, 'selected')) {
        if (typeof value === 'string' && (value as string).length > 0 && selected.indexOf(value as string) < 0) {
          selected.push(value as string);
        }
      }
      const choices: BotAnswerChoice[] = [];
      for (const label of selected) {
        const index: number = options.indexOf(label);
        choices.push({ label: label, letter: index >= 0 && index < 26 ? String.fromCharCode(65 + index) : undefined });
      }
      const custom: string = text(answer, 'custom').trim();
      if (custom.length > 0) {
        choices.push({ label: custom, letter: options.length < 26 ? String.fromCharCode(65 + options.length) : undefined });
      }
      if (choices.length > 0) {
        out.push({ question: prompt, choices: choices });
      }
    }
    return out;
  }

  private presentedFiles(item: Record<string, Object>): BotPresentedFile[] {
    const out: BotPresentedFile[] = [];
    for (const value of array(item, 'files')) {
      if (out.length >= 20) {
        break;
      }
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const path: string = text(row, 'path').trim();
      if (path.length === 0) {
        continue;
      }
      const file: BotPresentedFile = {
        name: text(row, 'name').length > 0 ? text(row, 'name') : (path.split('/').pop() ?? path),
        path: path
      };
      if (num(row, 'added') !== undefined) {
        file.added = num(row, 'added');
      }
      if (num(row, 'deleted') !== undefined) {
        file.deleted = num(row, 'deleted');
      }
      if (text(row, 'status').length > 0) {
        file.status = text(row, 'status');
      }
      if (text(row, 'description').length > 0) {
        file.description = text(row, 'description');
      }
      out.push(file);
    }
    return out;
  }

  // ==================== 通知 / 交互 ====================

  private applyNotices(obj: Record<string, Object>): void {
    if (bool(obj, 'reset') === true) {
      this.readState();
      const selected: string = this.state.selectedChatId ?? EMPTY;
      if (selected.length > 0) {
        this.readChat(selected, false);
      }
    }
    const responseBoot: string = text(obj, 'boot');
    if (responseBoot.length === 0) {
      return;
    }
    if (this.feedBoot.length > 0 && this.feedBoot !== responseBoot) {
      this.readNotices();
      return;
    }
    const tip: number = num(obj, 'seq') ?? -1;
    if (tip < 0) {
      return;
    }
    this.updateNoticeBoot(responseBoot, tip);
    this.noticeTip = Math.max(this.noticeTip, tip);
    if (this.foreground && (this.state.selectedChatId ?? EMPTY).length > 0) {
      this.markChatRead(this.state.selectedChatId);
    }
    const restoreRecent: boolean = this.state.recent.length === 0;
    const rows: Object[] = array(obj, 'notices');
    for (const value of rows) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const seq: number = num(row, 'seq') ?? -1;
      if (seq < 0 || seq > tip) {
        continue;
      }
      if (seq <= this.noticeSeq && !restoreRecent) {
        continue;
      }
      this.recordNotice(seq, row, seq > this.noticeSeq);
    }
    this.queuedNotices.forEach((value: Record<string, Object>, key: number) => {
      if (key > this.noticeSeq && key <= tip) {
        this.recordNotice(key, value, key > this.noticeSeq);
        // 乱序补洞的 notice 仍属于主机实时下发：done 可触发完成提醒（notices 历史回放行不触发）
        this.maybeNotifyDone(key, value);
      }
    });
    this.noticeSeq = Math.max(this.noticeSeq, tip);
    const drop: number[] = [];
    this.queuedNotices.forEach((value: Record<string, Object>, key: number) => {
      if (key <= this.noticeSeq) {
        drop.push(key);
      }
    });
    for (const key of drop) {
      this.queuedNotices.delete(key);
    }
    this.publish();
  }

  private updateNoticeBoot(nextBoot: string, tip: number): void {
    if (this.boot === nextBoot) {
      return;
    }
    this.noticeSeq = this.boot.length === 0 ? tip : 0;
    this.noticeTip = this.noticeSeq;
    this.boot = nextBoot;
    this.queuedNotices.clear();
    this.readThrough.clear();
    // 主机 boot 变化：已发通知集合作废（切换 boot 后同一 seq 是不同事件）
    BotNotify.reset();
  }

  private recordNotice(seq: number, value: Record<string, Object>, countUnread: boolean): void {
    const kind: string = text(value, 'kind');
    if (kind.length === 0) {
      return;
    }
    const chatId: string = text(value, 'roomId').length > 0 ? text(value, 'roomId') : text(value, 'botId');
    if (kind === 'done' || kind === 'question' || kind === 'approval' || kind === 'group' || kind === 'message') {
      const activity: BotActivity = {
        id: this.boot + ':' + seq.toString(),
        text: text(value, 'text'),
        chatId: chatId.length > 0 ? chatId : undefined,
        kind: kind,
        name: text(value, 'name')
      };
      const next: BotActivity[] = [activity];
      for (const one of this.state.recent) {
        if (one.id !== activity.id && next.length < 30) {
          next.push(one);
        }
      }
      this.state.recent = next;
    }
    if (countUnread && chatId.length > 0 && (kind === 'group' || kind === 'message')
      && !(this.foreground && this.state.selectedChatId === chatId)
      && seq > (this.readThrough.get(chatId) ?? 0)) {
      const count: number = this.state.unreadCounts[chatId] ?? 0;
      this.state.unreadCounts[chatId] = count + 1;
    }
  }

  /**
   * 「完成提醒」通知钩子（docs/bot-mode-ios-spec.md §9.6）：只在主机实时下发 notice kind=done 时触发，
   * 不根据普通回复猜测完成；done 不计未读；前台且正打开该聊天时不打扰。
   * 去重 / 开关 / 系统通知与失败兜底都在 BotNotify，本方法任何异常都不影响 Bot 主流程。
   */
  private maybeNotifyDone(seq: number, value: Record<string, Object>): void {
    try {
      if (text(value, 'kind') !== 'done') {
        return;
      }
      const chatId: string = text(value, 'roomId').length > 0 ? text(value, 'roomId') : text(value, 'botId');
      if (this.foreground && chatId.length > 0 && this.state.selectedChatId === chatId) {
        return;
      }
      const chat: BotChat | null = this.chatOf(chatId);
      BotNotify.onDoneNotice(this.boot + ':' + seq.toString(), chatId,
        chat !== null ? chat.name : EMPTY, text(value, 'text'));
    } catch (error) {
      Logger.warn('bot notify hook failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  /**
   * 离开聊天页（含系统手势返回）：只清掉「当前正在看哪个聊天」，不碰消息缓存。
   * 与 iOS BotModeView 的 navigationDestination(set: openedChat = nil; model.select(nil)) 同一套语义：
   * 选择不清掉时，首页会把这条聊天的每条新消息都当成「正在看」→ 不计未读 → 「与 X 聊聊」卡片永远不亮红角标。
   */
  clearChatSelection(): void {
    if ((this.state.selectedChatId ?? EMPTY).length === 0) {
      return;
    }
    this.state.selectedChatId = undefined;
    this.publish();
  }

  private markChatRead(chatId: string | undefined): void {
    if (chatId === undefined || chatId.length === 0) {
      return;
    }
    if ((this.state.unreadCounts[chatId] ?? 0) > 0) {
      this.state.unreadCounts[chatId] = 0;
    }
    this.readThrough.set(chatId, this.noticeTip);
  }

  private applySchedules(obj: Record<string, Object>, endpoint: string): void {
    if (endpoint !== 'schedules') {
      this.state.roleSaving = false;
    }
    this.state.schedulesAvailable = obj.available === true;
    const list: BotSchedule[] = [];
    for (const value of array(obj, 'tasks')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      if (id.length === 0) {
        continue;
      }
      list.push({
        id: id, title: text(row, 'title'), status: text(row, 'status'),
        next: text(row, 'scheduledAt'),
        botId: text(row, 'botId').length > 0 ? text(row, 'botId') : undefined,
        sessionId: text(row, 'sessionId').length > 0 ? text(row, 'sessionId') : undefined
      });
    }
    this.state.schedules = list;
    this.publish();
  }

  private applyAvatar(obj: Record<string, Object>, pending: BotPending): void {
    const botId: string = pending.chatId;
    const ref: string = text(obj, 'ref');
    const image: string = text(obj, 'image');
    if (botId.length === 0 || !image.startsWith('data:image/') || image.length >= 1500000) {
      return;
    }
    // 只有「我们登记过 ref 且回包 ref 不一致」才丢弃；
    // 没登记 ref（首次安装主动问 / ref 为空）时直接收下，避免一直回落首字
    const wanted: string | undefined = this.wantAvatars.get(botId);
    if (text(obj, 'botId') !== botId || (wanted !== undefined && ref.length > 0 && wanted !== ref)) {
      return;
    }
    for (const chat of this.state.chats) {
      if (chat.id === botId) {
        chat.image = image;
        chat.imageRef = ref;
      }
    }
    this.publish();
  }

  private applyEfforts(obj: Record<string, Object>, pending: BotPending): void {
    if (pending.chatId !== (this.state.effortModel ?? EMPTY)) {
      return;
    }
    const list: BotRoleOption[] = [];
    for (const value of array(obj, 'efforts')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      if (id.length === 0) {
        continue;
      }
      list.push({ id: id, title: text(row, 'name').length > 0 ? text(row, 'name') : id });
    }
    this.state.efforts = list;
    this.publish();
  }

  private applyRoleDetails(endpoint: string, obj: Record<string, Object>, pending: BotPending): void {
    if (endpoint !== 'memory-view' && endpoint !== 'usage-summary') {
      this.state.roleSaving = false;
      this.state.roleError = undefined;
    }
    const details: BotRoleDetails | undefined = this.state.roleDetails;
    if (details === undefined || details.botId !== pending.chatId) {
      return;
    }
    if (endpoint !== 'usage-summary') {
      const memories: BotMemory[] = [];
      for (const value of array(obj, 'entries')) {
        const row = rec(value);
        if (row === undefined) {
          continue;
        }
        const id: string = text(row, 'id');
        const scope: string = text(row, 'scope');
        if (id.length === 0 || scope.length === 0) {
          continue;
        }
        memories.push({
          id: id, scope: scope,
          topic: text(row, 'topic').length > 0 ? text(row, 'topic') : undefined,
          text: text(row, 'text')
        });
      }
      details.memories = memories;
    } else {
      const month = rec(field(obj, 'month'));
      details.inputTokens = month !== undefined ? num(month, 'input') : undefined;
      details.outputTokens = month !== undefined ? num(month, 'output') : undefined;
    }
    this.publish();
  }

  /**
   * 强制刷新所有 Bot 头像：清掉「已尝试」记录，逐个重新请求一次。
   * 用在首页/聊天页展示时（主机重连后头像没跟上、首装时机不对导致的长期兜底头像）。
   */
  forceAvatars(): void {
    this.attemptedAvatars.clear();
    if (!this.state.connected || !this.state.supported) {
      return;
    }
    let sent: number = 0;
    for (const chat of this.state.chats) {
      if (sent >= 6) {
        break;
      }
      if (chat.room) {
        continue;
      }
      const payload: Record<string, Object> = { 'botId': chat.id };
      if (this.call('avatar', payload, chat.id) !== null) {
        sent += 1;
      }
    }
  }
  private loadAvatars(): void {
    if (!this.state.connected || !this.state.supported) {
      return;
    }
    let active: number = 0;
    this.pending.forEach((p: BotPending) => {
      if (p.endpoint === 'avatar') {
        active += 1;
      }
    });
    if (active >= 4) {
      return;
    }
    for (const chat of this.state.chats) {
      if (active >= 4) {
        break;
      }
      const ref: string | undefined = this.wantAvatars.get(chat.id);
      if (ref === undefined || (chat.image !== undefined && chat.imageRef === ref)
        || this.attemptedAvatars.get(chat.id) === ref) {
        continue;
      }
      const payload: Record<string, Object> = { 'botId': chat.id };
      const sent: string | null = this.call('avatar', payload, chat.id);
      if (sent !== null) {
        this.attemptedAvatars.set(chat.id, ref);
        active += 1;
      }
    }
    // 兜底：主机这次没给 imageRef，但 Bot 可能有图（首次安装 / 缓存被清后）。
    // 每台 Bot 只问一次，拿到图就写进聊天，避免长期显示首字。
    for (const chat of this.state.chats) {
      if (active >= 4) {
        break;
      }
      if (chat.room || chat.image !== undefined || this.wantAvatars.has(chat.id)
        || this.attemptedAvatars.has(chat.id)) {
        continue;
      }
      const payload: Record<string, Object> = { 'botId': chat.id };
      const sent: string | null = this.call('avatar', payload, chat.id);
      if (sent !== null) {
        this.attemptedAvatars.set(chat.id, '');
        active += 1;
      }
    }
  }

  // ==================== 事件 ====================

  private onBotEvent(kind: string, data: Record<string, Object> | undefined): void {
    this.hostDataSeen = true;
    if (kind === 'hello') {
      const nextBoot: string = data !== undefined ? text(data, 'boot') : EMPTY;
      if (nextBoot.length > 0) {
        this.feedBoot = nextBoot;
        if (this.boot.length > 0 && this.boot !== nextBoot) {
          this.revision = -1;
          this.histories.clear();
          this.cursors.clear();
          this.streams.clear();
        }
        this.updateNoticeBoot(nextBoot, num(data, 'seq') ?? 0);
        this.noticeTip = Math.max(this.noticeTip, num(data, 'seq') ?? 0);
      }
      this.readNotices();
      this.readState();
      const selected: string = this.state.selectedChatId ?? EMPTY;
      if (selected.length > 0) {
        this.readChat(selected, false);
      }
      return;
    }
    if (kind === 'revision' || kind === 'live') {
      this.readState();
      return;
    }
    if (kind === 'message' || kind === 'room') {
      this.readState();
      const chatId: string = data !== undefined
        ? (kind === 'message' ? text(data, 'botId') : text(data, 'roomId')) : EMPTY;
      if (chatId.length > 0 && chatId === this.state.selectedChatId) {
        this.readChat(chatId, false);
      }
      return;
    }
    if (kind === 'notice') {
      const seq: number = data !== undefined ? (num(data, 'seq') ?? -1) : -1;
      if (seq > this.noticeSeq) {
        this.noticeTip = Math.max(this.noticeTip, seq);
        if (this.queuedNotices.size < 200 && data !== undefined) {
          this.queuedNotices.set(seq, data);
        }
        // 连续段可以立即消费
        while (this.queuedNotices.has(this.noticeSeq + 1)) {
          const next: number = this.noticeSeq + 1;
          const row = this.queuedNotices.get(next);
          if (row !== undefined) {
            this.recordNotice(next, row, true);
            this.maybeNotifyDone(next, row);
          }
          this.queuedNotices.delete(next);
          this.noticeSeq = next;
        }
        if (this.noticeSeq < this.noticeTip) {
          this.readNotices();
        }
      }
      this.readState();
      return;
    }
    if (kind === 'stream') {
      if (data === undefined || text(data, 'botId') !== (this.state.selectedChatId ?? EMPTY)) {
        return;
      }
      const attemptId: string = text(data, 'attemptId');
      if (attemptId.length === 0) {
        return;
      }
      const phase: string = text(data, 'phase');
      if (phase === 'start') {
        this.streams.set(attemptId, {
          id: 'stream:' + attemptId, kind: 'bot', text: '', name: '',
          streaming: true, sessionId: this.state.selectedChatId ?? EMPTY,
          images: [], questionAnswers: [], files: []
        });
      } else if (phase === 'end') {
        const existing: BotChatMessage | undefined = this.streams.get(attemptId);
        if (existing !== undefined) {
          existing.streaming = false;
        }
        const selected: string = this.state.selectedChatId ?? EMPTY;
        if (selected.length > 0) {
          this.readChat(selected, false);
        }
      } else {
        const existing: BotChatMessage | undefined = this.streams.get(attemptId);
        if (existing !== undefined) {
          const next: string = existing.text + text(data, 'text');
          existing.text = next.length > 200000 ? next.substring(0, 200000) : next;
        }
      }
      this.publish();
    }
  }

  // ==================== 发送 / 交互 ====================

  sendMessage(textValue: string, images: Object[], receipts: string[]): boolean {
    const chatId: string = this.state.selectedChatId ?? EMPTY;
    if (chatId.length === 0) {
      return false;
    }
    const message: string = textValue.trim();
    if (message.length === 0 && images.length === 0 && receipts.length === 0) {
      return false;
    }
    const endpoint: string = images.length > 0 || receipts.length > 0 ? 'send-attachments' : 'send';
    const id: string = this.call(endpoint, this.sendPayload(chatId, message, images, receipts), chatId) ?? EMPTY;
    if (id.length === 0) {
      return false;
    }
    const optimistic: BotChatMessage = {
      id: id, kind: 'user', text: message, name: '', streaming: false,
      delivery: 'sending', sessionId: chatId, images: [],
      questionAnswers: [], files: []
    };
    const list: BotChatMessage[] = this.optimistic.get(chatId) ?? [];
    list.push(optimistic);
    this.optimistic.set(chatId, list);
    this.state.error = undefined;
    this.publish();
    return true;
  }

  /**
   * 发送载荷（对齐 dsh-mobile 共享层 SharedBotStore.send 与 iOS BotModeView.send）：
   *   普通发送 → { sessionId: chatId, text }
   *   带附件 → { sessionId: 官方会话 sessionId, chatId, text, images[], receipts[] }
   * 之前这里错发成 botId/roomId，主机会认不出会话、回错误或干脆不回包，
   * 界面就表现为「发不出去 / 发送状态待确认，请同步聊天后核对」。
   */
  private sendPayload(chatId: string, message: string, images: Object[], receipts: string[]): Record<string, Object> {
    const chat: BotChat | null = this.chatOf(chatId);
    const payload: Record<string, Object> = {};
    const withAttachments: boolean = images.length > 0 || receipts.length > 0;
    if (withAttachments) {
      const official: string = chat !== null && chat.sessionId !== undefined && chat.sessionId.length > 0
        ? chat.sessionId : chatId;
      payload.sessionId = official;
      payload.chatId = chatId;
      payload.images = images;
      payload.receipts = receipts;
    } else {
      payload.sessionId = chatId;
    }
    payload.text = message;
    return payload;
  }

  private applySendAck(pending: BotPending): void {
    const chatId: string = pending.chatId;
    const list: BotChatMessage[] = this.optimistic.get(chatId) ?? [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].delivery === 'sending') {
        list[i].delivery = 'sent';
      }
    }
    this.optimistic.set(chatId, list);
    this.readChat(chatId, false);
    this.readState();
  }

  answerQuestion(id: string, selected: string[], custom: string): boolean {
    let interaction: BotInteraction | null = null;
    for (const one of this.state.interactions) {
      if (one.id === id && one.kind === 'question') {
        interaction = one;
      }
    }
    if (interaction === null) {
      return false;
    }
    const answer: Record<string, Object> = { 'selected': selected };
    if (custom.trim().length > 0) {
      answer.custom = custom.trim();
    }
    const payload: Record<string, Object> = {
      'sessionId': interaction.sessionId, 'questionId': id, 'answer': answer
    };
    return this.call('answer-question', payload) !== null;
  }

  answerApproval(id: string, allow: boolean): boolean {
    const payload: Record<string, Object> = { 'id': id, 'choice': allow ? 'allow' : 'reject' };
    return this.call('approval-answer', payload) !== null;
  }

  // ==================== @ 引用候选 ====================

  /**
   * @ 引用候选搜索（对齐 iOS BotMentionDraft / SharedBotStore.searchReferences）：
   * 仅在 referencesSupported 且已连接时向主机发 reference-candidates，结果写入 state.referenceSearch。
   */
  searchReferences(query: string, quoted: boolean): void {
    const chatId: string = this.state.selectedChatId ?? EMPTY;
    if (chatId.length === 0 || !this.state.referencesSupported || !this.state.connected) {
      return;
    }
    if (query.length > 256 || this.hasReferenceControl(query)) {
      return;
    }
    const current: BotReferenceSearch | undefined = this.state.referenceSearch;
    const same: boolean = current !== undefined && current.chatId === chatId
      && current.query === query && current.quoted === quoted;
    if (same && current !== undefined && !current.unavailable) {
      return;                                   // 已有结果 / 已在请求中，不重复发
    }
    this.state.referenceSearch = {
      chatId: chatId, query: query, quoted: quoted,
      loading: true, unavailable: false, items: []
    };
    // 丢弃旧查询：call() 对同 endpoint + chatId 有去重，旧请求在途会让新查询永远发不出去。
    this.cancelReferenceRequest();
    const payload: Record<string, Object> = {
      'chatId': chatId, 'query': query, 'quoted': quoted
    };
    const id: string | null = this.call('reference-candidates', payload, chatId);
    if (id === null) {
      this.state.referenceSearch = {
        chatId: chatId, query: query, quoted: quoted,
        loading: false, unavailable: true, items: []
      };
    }
    this.publish();
  }

  /** 关闭 @ 引用弹层：丢弃在途请求与候选结果。 */
  clearReferenceSearch(): void {
    this.cancelReferenceRequest();
    if (this.state.referenceSearch === undefined) {
      return;
    }
    this.state.referenceSearch = undefined;
    this.publish();
  }

  /** 取消在途的 reference-candidates（避免 call() 的 endpoint 去重吞掉新查询）。 */
  private cancelReferenceRequest(): void {
    const stale: string[] = [];
    this.pending.forEach((p: BotPending, id: string) => {
      if (p.endpoint === 'reference-candidates') {
        stale.push(id);
      }
    });
    for (const id of stale) {
      this.pending.delete(id);
    }
  }

  /** 回执：items[] → BotReferenceSearch（≤48；非法行跳过；失败时只清 loading）。 */
  private applyReferenceCandidates(pending: BotPending, value: Record<string, Object> | undefined): void {
    const search: BotReferenceSearch | undefined = this.state.referenceSearch;
    if (search === undefined || search.chatId !== pending.chatId) {
      return;
    }
    const items: BotReferenceCandidate[] = [];
    const rows: Object[] = value === undefined ? [] : array(value, 'items');
    for (const row of rows) {
      if (items.length >= 48) {
        break;
      }
      const one: Record<string, Object> | undefined = rec(row);
      if (one === undefined) {
        continue;
      }
      const label: string = text(one, 'label');
      const wire: string = text(one, 'wire');
      if (label.length === 0 || wire.length === 0) {
        continue;
      }
      const id: string = text(one, 'id');
      const item: BotReferenceCandidate = {
        id: id.length > 0 ? id : label,
        kind: text(one, 'kind'),
        label: label,
        detail: text(one, 'detail'),
        wire: wire,
        path: text(one, 'path')
      };
      items.push(item);
    }
    this.state.referenceSearch = {
      chatId: search.chatId, query: search.query, quoted: search.quoted,
      loading: false, unavailable: value === undefined, items: items
    };
    this.publish();
  }

  /** 引用查询失败/超时：清 loading 并标记不可用（不冒泡全局 error）。 */
  private applyReferenceFailure(pending: BotPending): void {
    const search: BotReferenceSearch | undefined = this.state.referenceSearch;
    if (search === undefined || search.chatId !== pending.chatId) {
      return;
    }
    this.state.referenceSearch = {
      chatId: search.chatId, query: search.query, quoted: search.quoted,
      loading: false, unavailable: true, items: []
    };
    this.publish();
  }

  /** 引用查询里不允许出现 ISO 控制字符（对齐 iOS 的候选查询校验）。 */
  private hasReferenceControl(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
      const code: number = value.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) {
        return true;
      }
    }
    return false;
  }

  // ==================== 选择 / 历史 / 角色 ====================

  selectChat(id: string): void {
    if (this.state.selectedChatId === id) {
      this.markChatRead(id);
      this.publish();
      return;
    }
    this.state.selectedChatId = id;
    this.state.messages = [];
    this.state.historyLoading = true;
    this.state.error = undefined;
    this.markChatRead(id);
    this.readChat(id, false);
    this.publish();
  }

  closeChat(): void {
    this.state.selectedChatId = undefined;
    this.state.messages = [];
    this.publish();
  }

  loadEarlier(): void {
    const chatId: string = this.state.selectedChatId ?? EMPTY;
    if (chatId.length === 0 || this.state.historyLoading) {
      return;
    }
    this.readChat(chatId, true);
  }

  hasEarlier(): boolean {
    const chatId: string = this.state.selectedChatId ?? EMPTY;
    return chatId.length > 0 && this.cursors.has(chatId);
  }

  openRole(id: string): void {
    let found: boolean = false;
    for (const chat of this.state.chats) {
      if (chat.id === id && !chat.room) {
        found = true;
      }
    }
    if (!found) {
      return;
    }
    if (this.state.roleDetails === undefined || this.state.roleDetails.botId !== id) {
      this.state.roleDetails = { botId: id, memories: [] };
      this.state.roleError = undefined;
    }
    const memoryPayload: Record<string, Object> = { 'botId': id };
    const usagePayload: Record<string, Object> = { 'botId': id };
    const empty: Record<string, Object> = {};
    this.call('memory-view', memoryPayload, id);
    this.call('usage-summary', usagePayload, id);
    this.call('schedules', empty);
    this.publish();
  }

  loadEfforts(ref: string): void {
    if (ref.length === 0 || ref === this.state.effortModel) {
      return;
    }
    this.state.effortModel = ref;
    this.state.efforts = [];
    const payload: Record<string, Object> = { 'ref': ref };
    this.call('efforts', payload, ref);
    this.publish();
  }

  updateRole(id: string, changes: Record<string, Object>): boolean {
    const payload: Record<string, Object> = {};
    const keys: string[] = Object.keys(changes);
    for (const key of keys) {
      payload[key] = changes[key];
    }
    payload.id = id;
    return this.roleWrite('update-bot', id, payload);
  }

  saveMemory(id: string, entryId: string | undefined, value: string): boolean {
    if (!this.state.memoryAvailable || value.trim().length === 0) {
      return false;
    }
    const details: BotRoleDetails | undefined = this.state.roleDetails;
    let entry: BotMemory | undefined = undefined;
    if (entryId !== undefined && details !== undefined) {
      for (const one of details.memories) {
        if (one.id === entryId) {
          entry = one;
        }
      }
      if (entry === undefined) {
        return false;
      }
    }
    const payload: Record<string, Object> = { 'botId': id };
    if (entry === undefined) {
      payload.text = value.trim();
      return this.roleWrite('memory-add', id, payload);
    }
    payload.scope = entry.scope;
    if (entry.topic !== undefined) {
      payload.topic = entry.topic;
    }
    payload.text = entry.text;
    payload.next = value.trim();
    return this.roleWrite('memory-edit', id, payload);
  }

  forgetMemory(id: string, entryId: string): boolean {
    const details: BotRoleDetails | undefined = this.state.roleDetails;
    if (details === undefined) {
      return false;
    }
    let entry: BotMemory | undefined = undefined;
    for (const one of details.memories) {
      if (one.id === entryId) {
        entry = one;
      }
    }
    if (entry === undefined) {
      return false;
    }
    const payload: Record<string, Object> = { 'botId': id, 'scope': entry.scope, 'text': entry.text };
    if (entry.topic !== undefined) {
      payload.topic = entry.topic;
    }
    return this.roleWrite('memory-forget', id, payload);
  }

  scheduleDaily(id: string, title: string, prompt: string, time: string, zone: string): boolean {
    if (!this.state.schedulesAvailable || title.trim().length === 0 || prompt.trim().length === 0) {
      return false;
    }
    const when: Record<string, Object> = { 'kind': 'daily', 'time': time, 'timeZone': zone };
    const payload: Record<string, Object> = {
      'target': id, 'title': title.trim(), 'prompt': prompt.trim(), 'when': when
    };
    return this.roleWrite('schedule-create', id, payload);
  }

  deleteSchedule(id: string, taskId: string): boolean {
    let session: string | undefined = undefined;
    for (const one of this.state.schedules) {
      if (one.id === taskId && one.botId === id) {
        session = one.sessionId;
      }
    }
    if (session === undefined) {
      return false;
    }
    const payload: Record<string, Object> = { 'sessionId': session, 'id': taskId };
    return this.roleWrite('schedule-delete', id, payload);
  }

  duplicateRole(id: string): boolean {
    const payload: Record<string, Object> = { 'id': id };
    return this.roleWrite('duplicate-bot', id, payload);
  }

  deleteRole(id: string): boolean {
    if (!this.state.botDeletionSupported || this.isMainBot(id)) {
      return false;
    }
    const payload: Record<string, Object> = { 'id': id };
    return this.roleWrite('delete-bot', id, payload);
  }

  replacePrimary(current: string, replacement: string): boolean {
    if (this.state.mainBotId !== current || current === replacement) {
      return false;
    }
    let candidate: BotChat | null = null;
    for (const chat of this.state.chats) {
      if (chat.id === replacement && !chat.room) {
        candidate = chat;
      }
    }
    if (candidate === null || (candidate.profile !== undefined && candidate.profile.privateRole)) {
      return false;
    }
    const payload: Record<string, Object> = {
      'id': replacement, 'main': true, 'primary': true, 'replace': current
    };
    return this.roleWrite('set-main', current, payload);
  }

  private roleWrite(endpoint: string, id: string, payload: Record<string, Object>): boolean {
    if (!this.canEditRole(id)) {
      return false;
    }
    const sent: string | null = this.call(endpoint, payload, id);
    if (sent === null) {
      return false;
    }
    this.state.roleSaving = true;
    this.state.roleError = undefined;
    this.publish();
    return true;
  }

  private canEditRole(id: string): boolean {
    if (!this.state.connected || !this.state.roleSettingsSupported
      || this.state.roleSaving || !this.state.writable) {
      return false;
    }
    for (const chat of this.state.chats) {
      if (chat.id === id && !chat.room) {
        return true;
      }
    }
    return false;
  }

  isMainBot(id: string): boolean {
    return id === this.state.mainBotId || this.state.mainBotIds.indexOf(id) >= 0;
  }

  chatOf(id: string): BotChat | null {
    for (const chat of this.state.chats) {
      if (chat.id === id) {
        return chat;
      }
    }
    return null;
  }

  indicatorOf(chatId: string): BotChatIndicator | null {
    const running: boolean = this.state.liveWork[chatId] !== undefined;
    const unread: number = this.state.unreadCounts[chatId] ?? 0;
    if (!running && unread === 0) {
      return null;
    }
    return {
      running: running, unreadCount: unread,
      unreadText: unread > 99 ? '99+' : unread.toString()
    };
  }

  // ==================== 新建相关回执 ====================

  private applyCreationAppearance(obj: Record<string, Object>): void {
    const shapes: BotCreationShape[] = [];
    for (const value of array(obj, 'shapes')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      if (id.length === 0) {
        continue;
      }
      const images: Record<string, string> = {};
      const map = rec(field(row, 'images'));
      if (map !== undefined) {
        for (const key of Object.keys(map)) {
          const url: Object = map[key];
          if (typeof url === 'string') {
            images[key] = url as string;
          }
        }
      }
      shapes.push({ 'id': id, 'images': images });
    }
    const colors: BotCreationColor[] = [];
    for (const value of array(obj, 'colors')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      if (id.length === 0) {
        continue;
      }
      const stops: string[] = [];
      for (const stop of array(row, 'stops')) {
        if (typeof stop === 'string') {
          stops.push(stop as string);
        }
      }
      colors.push({ 'id': id, 'stops': stops });
    }
    const ok: boolean = shapes.length > 0 && colors.length > 0;
    const appearance: BotCreationAppearance = { 'shapes': shapes, 'colors': colors };
    this.state.creation.appearance = ok ? appearance : undefined;
    this.state.creation.loadingAppearance = false;
    this.state.creation.appearanceFailed = !ok;
    this.publish();
  }

  private applyLocalAgents(obj: Record<string, Object>): void {
    const agents: BotCreationAgent[] = [];
    for (const value of array(obj, 'items')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      if (id.length === 0) {
        continue;
      }
      const agent: BotCreationAgent = {
        'id': id,
        'title': text(row, 'title').length > 0 ? text(row, 'title') : id,
        'available': bool(row, 'available') === true
      };
      if (text(row, 'image').length > 0) {
        agent.image = text(row, 'image');
      }
      if (bool(row, 'signedIn') === true) {
        agent.signedIn = true;
      }
      agents.push(agent);
    }
    this.state.creation.agents = agents;
    this.state.creation.loadingAgents = false;
    this.state.creation.agentsFailed = false;
    this.publish();
  }

  private applyLocalAgentModels(obj: Record<string, Object>, pending: BotPending): void {
    if (this.state.creation.agentRoute !== pending.chatId) {
      return;
    }
    const models: BotRoleOption[] = [];
    for (const value of array(obj, 'items')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      if (id.length === 0) {
        continue;
      }
      const title: string = text(row, 'title').length > 0 ? text(row, 'title') : text(row, 'name');
      models.push({ 'id': id, 'title': title.length > 0 ? title : id });
    }
    this.state.creation.agentModels = models;
    this.state.creation.loadingAgentModels = false;
    this.publish();
  }

  private applyAvatarLibrary(obj: Record<string, Object>, pending: BotPending): void {
    const offset: number = Number(pending.chatId);
    const start: number = Number.isFinite(offset) ? offset : 0;
    const photos: BotAvatarPhoto[] = start === 0 ? [] : this.state.creation.photos.slice();
    for (const value of array(obj, 'items')) {
      const row = rec(value);
      if (row === undefined) {
        continue;
      }
      const id: string = text(row, 'id');
      const image: string = text(row, 'image');
      if (id.length === 0 || !this.isPhotoData(image)) {
        continue;
      }
      let duplicate: boolean = false;
      for (const one of photos) {
        if (one.id === id) {
          duplicate = true;
        }
      }
      if (!duplicate) {
        photos.push({ 'id': id, 'name': text(row, 'name'), 'image': image });
      }
    }
    const next: number = num(obj, 'next') ?? start;
    const total: number = num(obj, 'total') ?? next;
    this.state.creation.photos = photos;
    this.state.creation.photoOffset = next;
    this.state.creation.loadingPhotos = false;
    this.state.creation.hasMorePhotos = next > start && next < total;
    this.publish();
  }

  private applyAvatarImport(obj: Record<string, Object>): void {
    const failed: boolean = array(obj, 'failed').length > 0;
    this.state.creation.loadingPhotos = false;
    this.state.creation.photosFailed = failed;
    if (!failed) {
      this.loadCreationPhotos(true);
    }
    this.publish();
  }

  private applyCreateBot(obj: Record<string, Object>): void {
    const created: string = text(obj, 'id');
    this.state.creation.saving = false;
    this.state.creation.createdId = created.length > 0 ? created : undefined;
    this.state.creation.error = created.length > 0 ? undefined : 'uncertain';
    this.revision = -1;
    this.readState();
    this.publish();
  }

  private applyCreateRoom(obj: Record<string, Object>): void {
    const room: BotChat | null = this.toPeer(obj, true);
    if (room === null || room.id.length === 0) {
      this.state.conversation.saving = false;
      this.state.conversation.uncertain = true;
      this.state.conversation.error = 'uncertain';
      this.publish();
      return;
    }
    const kept: BotChat[] = [];
    for (const chat of this.state.chats) {
      if (chat.id !== room.id) {
        kept.push(chat);
      }
    }
    kept.push(room);
    this.state.chats = kept;
    this.state.conversation.createdId = room.id;
    this.state.conversation.saving = false;
    // 创建成功后一律记下要进入的会话：带首条消息时也要跳到聊天页（之前只有消息留空才跳）
    this.state.conversation.openedId = room.id;
    const message: string = this.state.conversation.message.trim();
    if (message.length > 0) {
      const payload: Record<string, Object> = { 'sessionId': room.id, 'text': message };
      this.call('send', payload, room.id);
    }
    this.state.conversation.message = '';
    this.readState();
    this.publish();
  }

  private applySetFlags(obj: Record<string, Object>, pending: BotPending): void {
    const botId: string = pending.chatId;
    for (const chat of this.state.chats) {
      if (chat.id === botId) {
        chat.hidden = false;
      }
    }
    this.state.conversation.saving = false;
    this.state.conversation.error = undefined;
    this.state.conversation.openedId = botId;
    this.readState();
    this.publish();
  }

  // ==================== 新建 Bot / 新建会话 ====================

  canCreate(): boolean {
    return this.state.connected && this.state.supported && this.state.writable
      && this.state.creation.supported && !this.state.creation.saving
      && this.state.creation.error !== 'uncertain';
  }

  openCreation(): void {
    if (!this.canCreate()) {
      return;
    }
    this.state.creation.createdId = undefined;
    this.state.creation.error = undefined;
    if (this.state.creation.appearance === undefined) {
      const sent: string | null = this.creationCall('creation-appearance', {});
      if (sent !== null) {
        this.state.creation.loadingAppearance = true;
        this.state.creation.appearanceFailed = false;
      }
    }
    this.publish();
  }

  loadCreationAgents(): void {
    if (!this.canCreate() || this.state.creation.loadingAgents) {
      return;
    }
    const sent: string | null = this.creationCall('local-agents', {});
    if (sent !== null) {
      this.state.creation.loadingAgents = true;
      this.state.creation.agentsFailed = false;
      this.publish();
    }
  }

  loadCreationAgentModels(route: string): void {
    if (!this.canCreate() || route.length === 0) {
      return;
    }
    let available: boolean = false;
    for (const agent of this.state.creation.agents) {
      if (agent.id === route && agent.available) {
        available = true;
      }
    }
    if (!available) {
      return;
    }
    const payload: Record<string, Object> = { 'route': route };
    const sent: string | null = this.creationCall('local-agent-models', payload, route);
    if (sent !== null) {
      this.state.creation.agentRoute = route;
      this.state.creation.agentModels = [];
      this.state.creation.loadingAgentModels = true;
      this.publish();
    }
  }

  loadCreationPhotos(reset: boolean): void {
    if (!this.canCreate() || this.state.creation.loadingPhotos) {
      return;
    }
    if (!reset && !this.state.creation.hasMorePhotos) {
      return;
    }
    const offset: number = reset ? 0 : this.state.creation.photoOffset;
    const payload: Record<string, Object> = { 'offset': offset };
    const sent: string | null = this.creationCall('avatar-library', payload, offset.toString());
    if (sent !== null) {
      this.state.creation.loadingPhotos = true;
      this.state.creation.photosFailed = false;
      this.publish();
    }
  }

  importCreationPhoto(image: string, name: string): void {
    if (!this.canCreate() || this.state.creation.loadingPhotos) {
      return;
    }
    if (!this.isPhotoData(image)) {
      return;
    }
    const item: Record<string, Object> = { 'image': image, 'name': name.substring(0, 120) };
    const items: Object[] = [item];
    const payload: Record<string, Object> = { 'items': items };
    const sent: string | null = this.creationCall('avatar-import', payload);
    if (sent !== null) {
      this.state.creation.loadingPhotos = true;
      this.state.creation.photosFailed = false;
      this.publish();
    }
  }

  /** create-bot 提交：名称、外形/配色、可选头像图片、模型与推理档位、本地 Agent 外观标记。 */
  createBot(name: string, shape: string, color: string, image: string | undefined,
    model: string | undefined, effort: string | undefined, agentAppearance: boolean): void {
    if (!this.canCreate() || this.state.creation.saving) {
      return;
    }
    const trimmed: string = name.trim();
    if (trimmed.length === 0 || trimmed.length > 40 || this.hasForbiddenNameChars(trimmed)
      || this.isReservedName(trimmed)) {
      this.state.creation.error = 'invalid-name';
      this.publish();
      return;
    }
    for (const chat of this.state.chats) {
      if (!chat.room && chat.name.toLowerCase() === trimmed.toLowerCase()) {
        this.state.creation.error = 'duplicate-name';
        this.publish();
        return;
      }
    }
    const appearance: Object | undefined = this.creationImage(shape, color);
    if (appearance === undefined) {
      this.state.creation.error = 'invalid-appearance';
      this.publish();
      return;
    }
    if (image !== undefined && !this.isPhotoData(image)) {
      this.state.creation.error = 'invalid-photo';
      this.publish();
      return;
    }
    // 本地 Agent 的模型引用形如 local-<route>/<model>，必须落在可用 Agent 上。
    let localRoute: string = '';
    if (model !== undefined && model.length > 0 && this.isLocalModelRef(model)) {
      localRoute = model.substring(0, model.indexOf('/'));
      let routeAvailable: boolean = false;
      for (const agent of this.state.creation.agents) {
        if (agent.id === localRoute && agent.available) {
          routeAvailable = true;
        }
      }
      let modelListed: boolean = model === localRoute + '/default';
      if (!modelListed && this.state.creation.agentRoute === localRoute) {
        for (const option of this.state.creation.agentModels) {
          if (option.id === model) {
            modelListed = true;
          }
        }
      }
      if (!routeAvailable || !modelListed) {
        this.state.creation.error = 'invalid-model';
        this.publish();
        return;
      }
    }
    const avatar: Record<string, Object> = { 'shape': shape };
    if (image !== undefined) {
      avatar.image = image;
    }
    const payload: Record<string, Object> = { 'name': trimmed, 'color': color, 'avatar': avatar };
    if (model !== undefined && model.length > 0) {
      payload.model = model;
    }
    // 只有本地 Agent 且没有自定义头像时，才让主机沿用 Agent 的形象。
    if (agentAppearance && localRoute.length > 0 && image === undefined) {
      payload.agentAppearance = true;
    }
    // 思考强度只对云端模型有意义，且必须是当前模型已加载的档位。
    if (effort !== undefined && effort.length > 0 && localRoute.length === 0
      && model !== undefined && this.state.effortModel === model) {
      for (const option of this.state.efforts) {
        if (option.id === effort) {
          payload.effort = effort;
        }
      }
    }
    const sent: string | null = this.creationCall('create-bot', payload);
    if (sent !== null) {
      this.state.creation.saving = true;
      this.state.creation.createdId = undefined;
      this.state.creation.error = undefined;
      this.publish();
    }
  }

  /** 外形 + 配色对应的一张预览图（data URI）；没有返回 undefined。 */
  creationImage(shape: string, color: string): Object | undefined {
    const appearance: BotCreationAppearance | undefined = this.state.creation.appearance;
    if (appearance === undefined) {
      return undefined;
    }
    for (const one of appearance.shapes) {
      if (one.id === shape) {
        return one.images[color];
      }
    }
    return undefined;
  }

  private isPhotoData(value: string): boolean {
    return value.length <= 160000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  /** 本地 Agent 模型引用：local-<route>/<model>（对齐 BotCreationRules.localRef）。 */
  private isLocalModelRef(ref: string): boolean {
    if (!ref.startsWith('local-')) {
      return false;
    }
    const slash: number = ref.indexOf('/');
    return slash > 'local-'.length && slash < ref.length - 1;
  }

  /** 名字里不能包含 @、反引号或控制字符。 */
  private hasForbiddenNameChars(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
      const code: number = value.charCodeAt(i);
      if (code === 64 || code === 96 || code < 32 || code === 127) {
        return true;
      }
    }
    return false;
  }

  /** 群聊里有保留用途的名字（对齐 BotCreationRules.reservedNames）。 */
  private isReservedName(value: string): boolean {
    const lower: string = value.toLowerCase();
    return lower === 'all' || lower === 'everyone' || lower === '所有人'
      || lower === '全体' || lower === 'user' || lower === 'you';
  }

  // ---- 新建会话 / 群聊 ----

  beginConversation(): void {
    if (!this.state.conversation.supported || !this.state.writable) {
      return;
    }
    this.state.conversation.memberIds = [];
    this.state.conversation.message = '';
    this.state.conversation.error = undefined;
    this.state.conversation.errorDetail = undefined;
    this.state.conversation.uncertain = false;
    this.state.conversation.createdId = undefined;
    this.state.conversation.openedId = undefined;
    this.publish();
  }

  toggleConversationMember(id: string): void {
    if (!this.state.conversation.supported) {
      return;
    }
    const members: string[] = this.state.conversation.memberIds.slice();
    const at: number = members.indexOf(id);
    if (at >= 0) {
      members.splice(at, 1);
    } else {
      members.push(id);
    }
    this.state.conversation.memberIds = members;
    this.state.conversation.error = undefined;
    this.publish();
  }

  updateConversationMessage(text: string): void {
    this.state.conversation.message = text;
    this.state.conversation.error = undefined;
    this.publish();
  }

  createConversationRoom(greet: boolean): void {
    const conversation: BotConversationState = this.state.conversation;
    if (!conversation.supported || !this.state.writable || conversation.saving) {
      return;
    }
    if (conversation.memberIds.length < 2 || conversation.uncertain) {
      conversation.error = 'need-members';
      this.publish();
      return;
    }
    const members: Object[] = [];
    for (const id of conversation.memberIds) {
      members.push(id);
    }
    const payload: Record<string, Object> = {
      'members': members, 'admin': conversation.memberIds[0], 'greet': greet
    };
    const sent: string | null = this.call('create-room', payload);
    if (sent !== null) {
      conversation.saving = true;
      conversation.error = undefined;
      this.publish();
    }
  }

  confirmConversationNotCreated(): void {
    this.state.conversation.saving = false;
    this.state.conversation.uncertain = false;
    this.state.conversation.error = undefined;
    this.publish();
  }

  enterCreatedConversation(): void {
    const id: string = this.state.conversation.createdId ?? '';
    if (id.length > 0) {
      this.state.conversation.openedId = id;
    }
    this.publish();
  }

  /** 从侧边栏隐藏里恢复一台 Bot（set-flags hidden=false）。 */
  restoreHiddenBot(id: string): void {
    if (!this.state.conversation.supported || !this.state.writable) {
      return;
    }
    const payload: Record<string, Object> = { 'id': id, 'hidden': false };
    this.call('set-flags', payload, id);
  }

  // ==================== 本地缓存（按主机隔离，对齐 iOS §9.5） ====================

  /**
   * 冷启动恢复：读本机 Bot 缓存填充可展示字段 + 历史/乐观消息 + 通知游标。
   * 只读本地文件，不触发任何网络请求；主机数据到达后以主机为准。
   */
  private restoreCache(): void {
    const cache: BotCache = BotCache.get();
    cache.bind(this.cacheHostKey());
    void cache.load().then((restored: RestoredBotCache | undefined) => {
      if (restored !== undefined) {
        this.applyRestoredCache(restored);
      }
      // 恢复（或确认没有缓存）之后才允许写盘，避免空状态覆盖上次缓存
      this.cacheRestored = true;
    }).catch((error: Error) => {
      this.cacheRestored = true;
      Logger.warn('bot cache restore failed: ' + error.message);
    });
  }

  /** 把缓存快照合并进内存态：可展示字段 + 历史/乐观消息 + 通知游标；恢复后不假装在线。 */
  private applyRestoredCache(restored: RestoredBotCache): void {
    // 切换主机后旧缓存迟到：身份不一致直接丢弃，避免串台
    const expected: string = this.cacheHostKey();
    if (expected.length > 0 && restored.hostKey.length > 0 && expected !== restored.hostKey) {
      Logger.info('bot cache ignored: host changed');
      return;
    }
    // 历史 / 乐观消息 / 已读游标只补空位：已从主机拉到的聊天以主机为准
    restored.histories.forEach((messages: BotChatMessage[], chatId: string) => {
      if (!this.histories.has(chatId)) {
        this.histories.set(chatId, messages);
      }
    });
    restored.optimistic.forEach((messages: BotChatMessage[], chatId: string) => {
      if (!this.optimistic.has(chatId)) {
        this.optimistic.set(chatId, messages);
      }
    });
    restored.readThrough.forEach((seq: number, chatId: string) => {
      if (!this.readThrough.has(chatId)) {
        this.readThrough.set(chatId, seq);
      }
    });
    if (this.boot.length === 0 && restored.noticeBoot.length > 0) {
      this.boot = restored.noticeBoot;
    }
    if (restored.noticeSeq > this.noticeSeq) {
      this.noticeSeq = restored.noticeSeq;
    }
    if (restored.noticeSeq > this.noticeTip) {
      this.noticeTip = restored.noticeSeq;
    }
    if (this.hostDataSeen) {
      // 主机数据已到：在线态以主机为准，只保留上面补齐的历史/游标后发布
      this.publish();
      return;
    }
    const cached: BotSnapshot = restored.snapshot;
    this.state.connected = false;                 // 恢复态不假装已连接
    this.state.supported = false;                 // 能力位等订阅/hello 确认
    this.state.loading = false;
    this.state.error = undefined;
    this.state.feedActive = false;
    this.state.capabilities = cached.capabilities;
    this.state.mainBotId = cached.mainBotId;
    this.state.mainBotIds = cached.mainBotIds;
    this.state.rosterIds = cached.rosterIds;
    this.state.chats = cached.chats;
    this.state.selectedChatId = undefined;        // 选中会话清空：回首页重新选
    this.state.messages = [];
    this.state.historyLoading = false;
    this.state.hasEarlier = false;
    this.state.schedules = cached.schedules;
    this.state.schedulesAvailable = cached.schedulesAvailable;
    this.state.recent = cached.recent;
    this.state.interactions = [];
    this.state.models = cached.models;
    this.state.permissions = cached.permissions;
    this.state.defaultModel = cached.defaultModel;
    this.state.effortModel = undefined;
    this.state.efforts = [];
    this.state.memoryAvailable = cached.memoryAvailable;
    this.state.computerEnabled = cached.computerEnabled;
    this.state.writable = cached.writable;
    this.state.roleDetails = undefined;
    this.state.roleSaving = false;
    this.state.roleError = undefined;
    this.state.roleSettingsSupported = false;
    this.state.attachmentsSupported = false;
    this.state.referencesSupported = false;
    this.state.botDeletionSupported = false;
    this.state.attachmentSending = false;
    this.state.creation = cached.creation;
    this.state.conversation = cached.conversation;
    this.state.referenceSearch = undefined;
    this.state.liveWork = cached.liveWork;        // 运行中状态不缓存
    this.state.unreadCounts = cached.unreadCounts;
    Logger.info('bot cache restored chats=' + cached.chats.length.toString());
    this.publish();
  }

  /** 缓存分文件用的主机身份：已保存主机 id 优先，其次当前连接端点；都没有返回空串（BotCache 回落 'default'）。 */
  private cacheHostKey(): string {
    if (this.client !== null) {
      const saved: string = this.client.activeGatewayId();
      if (saved.length > 0) {
        return 'gateway:' + saved;
      }
    }
    const stored: string = AppStorage.get<string>('activeGatewayId') ?? EMPTY;
    if (stored.length > 0) {
      return 'gateway:' + stored;
    }
    const endpoint: string = AppStorage.get<string>('activeEndpoint') ?? EMPTY;
    if (endpoint.length > 0) {
      return 'endpoint:' + endpoint;
    }
    return EMPTY;
  }

  /**
   * 状态变化后交给 BotCache 防抖落盘：这里只传引用、不做序列化，
   * 避免每帧同步 JSON.stringify 卡 UI（600ms 防抖与串行写由 BotCache 负责）。
   */
  private persistSoon(): void {
    if (!this.cacheRestored) {
      return;
    }
    BotCache.get().scheduleSave(this.cachePayload());
  }

  private cachePayload(): BotCachePayload {
    const payload: BotCachePayload = {
      snapshot: this.state,
      histories: this.histories,
      optimistic: this.optimistic,
      noticeBoot: this.boot,
      noticeSeq: this.noticeSeq,
      readThrough: this.readThrough
    };
    return payload;
  }

  /** 测试 / 退后台入口：跳过 600ms 防抖立即落盘（不改变任何业务语义）。 */
  saveCacheNow(): Promise<boolean> {
    return BotCache.get().saveNow(this.cachePayload());
  }

  // ==================== 发布 ====================

  private publish(): void {
    const selected: string = this.state.selectedChatId ?? EMPTY;
    const messages: BotChatMessage[] = [];
    if (selected.length > 0) {
      for (const one of (this.histories.get(selected) ?? [])) {
        messages.push(one);
      }
      for (const one of (this.optimistic.get(selected) ?? [])) {
        messages.push(one);
      }
      // 流式回复落库后：历史里已经有同一段文本，这里必须跳过并清掉 streams 里的副本，
      // 否则「历史一条 + 流式一条」会渲染成两个一模一样的气泡。
      const history: BotChatMessage[] = this.histories.get(selected) ?? [];
      const streamKeys: string[] = [];
      this.streams.forEach((one: BotChatMessage, key: string) => {
        streamKeys.push(key);
      });
      for (const key of streamKeys) {
        const one: BotChatMessage | undefined = this.streams.get(key);
        if (one === undefined || one.text.length === 0 || one.sessionId !== selected) {
          continue;
        }
        let duplicated: boolean = false;
        for (const settled of history) {
          if (settled.kind === one.kind && settled.text === one.text) {
            duplicated = true;
            break;
          }
        }
        if (duplicated) {
          this.streams.delete(key);
          continue;
        }
        messages.push(one);
      }
    }
    this.state.messages = messages;
    this.state.hasEarlier = selected.length > 0 && this.cursors.has(selected);
    let attachmentSending: boolean = false;
    this.pending.forEach((p: BotPending) => {
      if (p.endpoint === 'send-attachments' && p.chatId === selected) {
        attachmentSending = true;
      }
    });
    this.state.attachmentSending = attachmentSending;
    AppStorage.setOrCreate<BotSnapshot>('botState', this.cloneSnapshot());
    // 状态变化后交给 BotCache 防抖落盘（这里不序列化，避免每帧开销）
    this.persistSoon();
  }

  /** 发布用浅拷贝：ArkUI 只有对象引用变化才刷新页面。 */
  private cloneSnapshot(): BotSnapshot {
    const s: BotSnapshot = this.state;
    return {
      connected: s.connected, supported: s.supported, loading: s.loading, error: s.error,
      feedActive: s.feedActive, boot: s.boot, capabilities: s.capabilities,
      mainBotId: s.mainBotId, mainBotIds: s.mainBotIds, rosterIds: s.rosterIds,
      chats: s.chats, selectedChatId: s.selectedChatId, messages: s.messages,
      historyLoading: s.historyLoading, hasEarlier: s.hasEarlier,
      schedules: s.schedules, schedulesAvailable: s.schedulesAvailable,
      recent: s.recent, interactions: s.interactions, models: s.models,
      permissions: s.permissions, defaultModel: s.defaultModel,
      effortModel: s.effortModel, efforts: s.efforts,
      memoryAvailable: s.memoryAvailable, computerEnabled: s.computerEnabled,
      writable: s.writable, roleDetails: s.roleDetails, roleSaving: s.roleSaving,
      roleError: s.roleError, roleSettingsSupported: s.roleSettingsSupported,
      attachmentsSupported: s.attachmentsSupported, referencesSupported: s.referencesSupported,
      botDeletionSupported: s.botDeletionSupported, attachmentSending: s.attachmentSending,
      creation: s.creation, conversation: s.conversation, referenceSearch: s.referenceSearch,
      liveWork: s.liveWork, unreadCounts: s.unreadCounts
    };
  }
}
