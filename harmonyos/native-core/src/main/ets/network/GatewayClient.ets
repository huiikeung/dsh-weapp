import { webSocket } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Logger } from '../common/Logger';
import { KEY_CONNECTION } from '../common/AppState';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { decodeFrame } from '../protocol/GatewayFrameCodec';
import { GatewayRequests } from '../protocol/GatewayRequests';
import { PairingResult } from '../protocol/PairingPayload';
import { RelaySession } from '../crypto/RelaySession';
import { base64Decode } from '../crypto/DshCrypto';
import { randomBytes } from '../crypto/Sodium';
import { PreferencesStore } from '../common/PreferencesStore';
import { CredentialStore, SavedGateway } from '../state/CredentialStore';
import { PluginStore } from '../state/PluginStore';
import { ScheduleStore } from '../state/ScheduleStore';
import { SessionStore } from '../state/SessionStore';

interface PendingRequest {
  id: string;
  matchType: string;
  resolve: (frame: GatewayFrame) => void;
  reject: (error: Error) => void;
  timer: number;
}

export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  FAILED = 'failed'
}

/** 配对信息：后续由扫码/手动输入写入，先作为连接参数载体。 */
export interface GatewayProfile {
  wsUrl: string;
  pairCode: string;
  leaseToken: string;
  inviteToken: string;
  accessToken: string;
  /** 中继节点与 agent 身份公钥（Base64）；有值时走 E2EE。 */
  relayNodeId?: string;
  relayAgentPubKey?: string;
  /** 已配对后服务端下发的长期 Bearer token。 */
  token?: string;
}

/**
 * 网关 WebSocket 客户端（原生版骨架）。
 *
 * 与元服务版本同样的约定：凭据走 X-DSH-* 自定义头，主协议用 dsh-mobile-v1；
 * 帧编解码（JSON 控制帧 / 中继二进制帧）在 Protocol 层继续补。
 */
export class GatewayClient {
  private static instance: GatewayClient = new GatewayClient();
  private ws: webSocket.WebSocket | null = null;
  private profile: GatewayProfile | null = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private frameListeners: Array<(frame: GatewayFrame) => void> = [];
  private pending: Map<string, PendingRequest> = new Map();
  private requestSeq: number = 0;
  private pairCandidates: string[] = [];
  private pairIndex: number = 0;
  private pairCode: string = '';
  private relaySession: RelaySession | null = null;
  private relayNodeId: string = '';
  private pluginRequestSeq: number = 0;
  private relayAgentPubKey: string = '';
  private deviceIdCache: string = '';
  private currentProfile: GatewayProfile | null = null;

  static get(): GatewayClient {
    return GatewayClient.instance;
  }

  currentState(): ConnectionState {
    return this.state;
  }

  /** 扫码配对：按二维码里的候选地址顺序尝试（直连 ws/wss 优先）。 */
  connectPairing(result: PairingResult): void {
    if (result.candidates.length === 0) {
      this.publish(ConnectionState.FAILED);
      AppStorage.setOrCreate<string>('connectionMessage', '该二维码只有中继地址，中继 E2EE 将在下一阶段支持');
      return;
    }
    this.pairCandidates = result.candidates.slice();
    this.pairIndex = 0;
    this.pairCode = result.pairCode;
    this.relayNodeId = result.relayNodeId;
    this.relayAgentPubKey = result.relayAgentPubKey;
    AppStorage.setOrCreate<string>('pairingHint',
      '共 ' + result.candidates.length + ' 个候选地址，正在尝试第 1 个');
    this.tryNextCandidate();
  }

  private tryNextCandidate(): void {
    if (this.pairIndex >= this.pairCandidates.length) {
      this.pairCandidates = [];
      this.publish(ConnectionState.FAILED);
      AppStorage.setOrCreate<string>('connectionMessage', '所有候选地址都无法连接');
      return;
    }
    const url: string = this.pairCandidates[this.pairIndex];
    this.pairIndex += 1;
    AppStorage.setOrCreate<string>('pairingHint',
      '尝试第 ' + this.pairIndex + '/' + this.pairCandidates.length + ' 个地址：' + url);
    const profile: GatewayProfile = {
      wsUrl: url,
      pairCode: this.pairCode,
      leaseToken: '',
      inviteToken: '',
      accessToken: '',
      relayNodeId: this.relayNodeId,
      relayAgentPubKey: this.relayAgentPubKey
    };
    this.connect(profile);
  }

  private scheduleNextCandidate(): void {
    if (this.pairCandidates.length === 0 || this.pairIndex >= this.pairCandidates.length) {
      return;
    }
    setTimeout(() => {
      this.tryNextCandidate();
    }, 300);
  }

  connect(profile: GatewayProfile): void {
    this.disconnect();
    this.currentProfile = profile;
    this.profile = profile;
    this.publish(ConnectionState.CONNECTING);
    const ws: webSocket.WebSocket = webSocket.createWebSocket();
    this.ws = ws;

    ws.on('open', () => {
      Logger.info('gateway open ' + profile.wsUrl);
      this.pairCandidates = [];
      if (profile.relayNodeId !== undefined && profile.relayNodeId.length > 0 &&
          profile.relayAgentPubKey !== undefined && profile.relayAgentPubKey.length > 0) {
        try {
          this.relaySession = new RelaySession(profile.relayNodeId, base64Decode(profile.relayAgentPubKey));
          this.sendBinary(this.relaySession.hello);
          AppStorage.setOrCreate<string>('pairingHint', '中继 E2EE 握手已发起…');
          return;
        } catch (err) {
          Logger.error('relay session init failed: ' + (err instanceof Error ? err.message : String(err)));
          this.relaySession = null;
        }
      }
      this.pairIndex = 0;
      AppStorage.setOrCreate<string>('transportKind',
        profile.relayNodeId !== undefined && profile.relayNodeId.length > 0 ? 'relay' : 'direct');
      AppStorage.setOrCreate<string>('pairingHint', '已连接：' + profile.wsUrl);
      this.requestDefaults();
      this.requestModelsCatalog();
      this.requestAgentPresets();
      this.requestPermissionOptions();
      if (profile.relayNodeId === undefined || profile.relayNodeId.length === 0) {
        this.persistProfile(profile.accessToken, '');
      }
      this.publish(ConnectionState.CONNECTED);
      // 建链后自动拉基础状态；会话列表回来后由 SessionStore 自动打开最近会话。
      this.send(GatewayRequests.host());
      this.send(GatewayRequests.workspaces());
      this.send(GatewayRequests.sessions());
    });
    ws.on('message', (err: BusinessError, data: string | ArrayBuffer) => {
      if (err) {
        Logger.error('gateway message error: ' + JSON.stringify(err));
        return;
      }
      if (this.relaySession !== null) {
        if (typeof data === 'string') {
          Logger.warn('relay expected binary frame, got text');
          return;
        }
        this.handleRelayPacket(new Uint8Array(data));
        return;
      }
      if (typeof data === 'string') {
        this.handleTextFrame(data);
      } else {
        Logger.info('gateway frame(binary) ' + data.byteLength);
      }
    });
    ws.on('close', (err: BusinessError, result: webSocket.CloseResult) => {
      Logger.warn('gateway close ' + JSON.stringify(result));
      const wasConnected: boolean = this.state === ConnectionState.CONNECTED;
      this.publish(ConnectionState.DISCONNECTED);
      if (!wasConnected) {
        this.scheduleNextCandidate();
      }
    });
    ws.on('error', (err: BusinessError) => {
      Logger.error('gateway error ' + JSON.stringify(err));
      const wasConnected: boolean = this.state === ConnectionState.CONNECTED;
      this.publish(ConnectionState.FAILED);
      if (!wasConnected) {
        this.scheduleNextCandidate();
      }
    });

    const header: Record<string, string> = {
      'X-DSH-Channel': 'mobile',
      'X-DSH-Client-Type': 'harmony-native',
      'X-DSH-Device-ID': this.deviceId(),
      'X-DSH-Public-Lease': profile.leaseToken,
      'X-DSH-Invite': profile.inviteToken,
      'X-DSH-Access': profile.accessToken
    };
    // 配对码必须走子协议 dsh-pair.<code>（网关按 Sec-WebSocket-Protocol 解析）；token 走 Authorization。
    let protocol: string = 'dsh-mobile-v1';
    if (profile.token !== undefined && profile.token.length > 0) {
      header['Authorization'] = 'Bearer ' + profile.token;
    } else if (profile.pairCode.length > 0) {
      protocol = 'dsh-mobile-v1, dsh-pair.' + profile.pairCode;
    }
    ws.connect(profile.wsUrl, { header: header, protocol: protocol }, (err: BusinessError) => {
      if (err) {
        Logger.error('gateway connect callback failed: ' + JSON.stringify(err));
        this.publish(ConnectionState.FAILED);
      }
    });
  }

  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  send(text: string): boolean {
    if (this.ws === null || this.state !== ConnectionState.CONNECTED) {
      Logger.warn('send skipped: not connected');
      return false;
    }
    if (this.relaySession !== null) {
      if (!this.relaySession.isReady()) {
        Logger.warn('send skipped: relay session not ready');
        return false;
      }
      return this.sendBinary(this.relaySession.seal(text));
    }
    this.ws.send(text, (err: BusinessError) => {
      if (err) {
        Logger.error('send failed: ' + JSON.stringify(err));
      }
    });
    return true;
  }

  /** 请求/响应：按 requestId 或帧 kind 关联，超时失败。 */
  request(body: string, matchType: string, timeoutMs: number = 10000): Promise<GatewayFrame> {
    return new Promise<GatewayFrame>((resolve: (frame: GatewayFrame) => void, reject: (error: Error) => void) => {
      if (!this.isConnected()) {
        reject(new Error('not connected'));
        return;
      }
      this.requestSeq += 1;
      const id: string = 'req-' + this.requestSeq;
      const timer: number = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('timeout: ' + matchType));
      }, timeoutMs);
      this.pending.set(id, {
        id: id, matchType: matchType, resolve: resolve, reject: reject, timer: timer
      });
      if (!this.send(body)) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('send failed'));
      }
    });
  }

  ping(timeoutMs: number = 8000): Promise<GatewayFrame> {
    return this.request(GatewayRequests.ping(), 'ping', timeoutMs);
  }

  requestSessions(): Promise<GatewayFrame> {
    return this.request(GatewayRequests.sessions(), 'sessions');
  }

  requestWorkspaces(): Promise<GatewayFrame> {
    return this.request(GatewayRequests.workspaces(), 'workspaces');
  }

  requestHost(): Promise<GatewayFrame> {
    return this.request(GatewayRequests.host(), 'host');
  }

  /** 打开会话：先拉历史，再订阅后续事件。 */
  openSession(sessionId: string): void {
    this.send(GatewayRequests.history(sessionId));
    this.send(GatewayRequests.subscribe(sessionId));
    const queueFrame: Record<string, Object> = { 'type': 'session-queue', 'sessionId': sessionId };
    this.send(JSON.stringify(queueFrame));
    this.requestContextPanels(sessionId);
  }

  /** 新建会话：返回 sessionId。 */
  createSession(workspaceId: string): Promise<string> {
    return new Promise<string>((resolve: (id: string) => void, reject: (error: Error) => void) => {
      if (!this.isConnected()) {
        reject(new Error('未连接网关'));
        return;
      }
      const frame: Record<string, Object> = { 'type': 'session-create' };
      if (workspaceId.length > 0) {
        frame['workspaceId'] = workspaceId;
      }
      this.request(JSON.stringify(frame), 'session-created', 15000).then((result: GatewayFrame) => {
        const id: string = result.sessionId !== undefined ? result.sessionId : '';
        if (id.length === 0) {
          reject(new Error('创建会话失败'));
          return;
        }
        resolve(id);
      }).catch((error: Error) => {
        reject(error);
      });
    });
  }

  renameSession(sessionId: string, title: string): boolean {
    const frame: Record<string, Object> = { 'type': 'session-rename', 'sessionId': sessionId, 'title': title };
    return this.send(JSON.stringify(frame));
  }

  archiveSession(sessionId: string): boolean {
    const frame: Record<string, Object> = { 'type': 'session-archive', 'sessionId': sessionId };
    return this.send(JSON.stringify(frame));
  }

  /** 部署级默认配置（Agent 预设 / 模型 / 权限）。 */
  requestDefaults(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'defaults' };
    return this.send(JSON.stringify(frame));
  }

  /** 模型目录。 */
  requestModelsCatalog(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'models' };
    return this.send(JSON.stringify(frame));
  }

  /** Agent 预设目录。 */
  requestAgentPresets(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'agent-presets' };
    return this.send(JSON.stringify(frame));
  }

  /** 权限选项。 */
  requestPermissionOptions(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'permission-options' };
    return this.send(JSON.stringify(frame));
  }

  /** 目录浏览（添加工作区用）。 */
  requestDirectories(path: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'directories' };
    if (path.length > 0) {
      frame['path'] = path;
    }
    return this.send(JSON.stringify(frame));
  }

  /** 新建目录。 */
  createDirectory(path: string, name: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'directory-create', 'path': path, 'name': name };
    return this.send(JSON.stringify(frame));
  }

  /** 把目录添加为工作区。 */
  createWorkspace(path: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'workspace-create', 'path': path };
    return this.send(JSON.stringify(frame));
  }

  /** 拉自动化任务目录。 */
  requestScheduleCatalog(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const frame: Record<string, Object> = { 'type': 'schedule-catalog' };
    return this.send(JSON.stringify(frame));
  }

  /** 启用/停用自动化任务。 */
  setScheduleEnabled(id: string, enabled: boolean): boolean {
    if (!this.isConnected()) {
      return false;
    }
    this.pluginRequestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'schedule-update',
      'requestId': 'schedule-toggle-' + this.pluginRequestSeq,
      'id': id,
      'enabled': enabled
    };
    return this.send(JSON.stringify(frame));
  }

  /** 拉插件目录。 */
  requestPlugins(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    let seq: number = 1;
    this.pluginRequestSeq += 1;
    seq = this.pluginRequestSeq;
    const frame: Record<string, Object> = { 'type': 'plugin-catalog', 'requestId': 'plugin-' + seq };
    return this.send(JSON.stringify(frame));
  }

  /** 启用/停用插件。 */
  setPluginEnabled(name: string, enabled: boolean): boolean {
    if (!this.isConnected()) {
      return false;
    }
    this.pluginRequestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'plugin-bundle-set-enabled',
      'requestId': 'plugin-toggle-' + this.pluginRequestSeq,
      'name': name,
      'enabled': enabled
    };
    return this.send(JSON.stringify(frame));
  }

  /** 分页加载更早历史（beforeSeq 之前）。 */
  requestOlderHistory(sessionId: string, beforeSeq: number): boolean {
    const frame: Record<string, Object> = {
      'type': 'history',
      'sessionId': sessionId,
      'beforeSeq': beforeSeq,
      'maxMessages': 30,
      'maxBytes': 262144,
      'view': 'conversation'
    };
    return this.send(JSON.stringify(frame));
  }

  /** 拉上下文面板与编队快照。 */
  requestContextPanels(sessionId: string): void {
    const dashboard: Record<string, Object> = { 'type': 'context-dashboard', 'sessionId': sessionId };
    const fleet: Record<string, Object> = { 'type': 'context-fleet', 'sessionId': sessionId };
    const usage: Record<string, Object> = { 'type': 'context-usage', 'sessionId': sessionId };
    this.send(JSON.stringify(dashboard));
    this.send(JSON.stringify(fleet));
    this.send(JSON.stringify(usage));
  }

  requestQueue(sessionId: string): Promise<GatewayFrame> {
    const frame: Record<string, Object> = { 'type': 'session-queue', 'sessionId': sessionId };
    return this.request(JSON.stringify(frame), 'session-queue');
  }

  /** action: steer（立刻发送）/ remove（删除）。 */
  queueUpdate(sessionId: string, itemId: string, action: string): boolean {
    const frame: Record<string, Object> = {
      'type': 'queue-update', 'sessionId': sessionId, 'itemId': itemId, 'action': action
    };
    return this.send(JSON.stringify(frame));
  }

  sendUserMessage(text: string, sessionId: string): boolean {
    return this.send(GatewayRequests.message(text, sessionId, 'Asia/Shanghai'));
  }

  cancelSession(sessionId: string): boolean {
    return this.send(GatewayRequests.sessionCancel(sessionId));
  }

  disconnect(): void {
    if (this.ws === null) {
      return;
    }
    try {
      this.ws.off('open');
      this.ws.off('message');
      this.ws.off('close');
      this.ws.off('error');
      this.ws.close();
    } catch (err) {
      Logger.warn('disconnect error: ' + JSON.stringify(err));
    }
    this.ws = null;
    this.relaySession = null;
    AppStorage.setOrCreate<string>('publicAccessState', '未连接');
    AppStorage.setOrCreate<string>('transportKind', '');
    this.publish(ConnectionState.DISCONNECTED);
  }

  /** 订阅解码后的控制帧；返回取消订阅函数。 */
  onFrame(listener: (frame: GatewayFrame) => void): () => void {
    this.frameListeners.push(listener);
    return () => {
      const index: number = this.frameListeners.indexOf(listener);
      if (index >= 0) {
        this.frameListeners.splice(index, 1);
      }
    };
  }

  /** 文本帧统一入口：fail-closed 解码，非法帧只记日志、不进业务层。 */
  private handleTextFrame(text: string): void {
    let frame: GatewayFrame;
    try {
      frame = decodeFrame(text);
    } catch (err) {
      Logger.warn('gateway frame rejected: ' + (err instanceof Error ? err.message : String(err)));
      return;
    }
    this.publishHello(frame);
    this.settlePending(frame);
    if (frame.kind === 'session-created' || frame.kind === 'session-renamed' || frame.kind === 'session-archived') {
      this.send(GatewayRequests.sessions());
    }
    PluginStore.get().consume(frame);
    ScheduleStore.get().consume(frame);
    SessionStore.get().consume(frame);

    // 配对成功：保存服务端下发的长期 token（直连）或 accessToken（中继）。
    if (frame.kind === 'paired') {
      const token: string = frame.token !== undefined ? frame.token : '';
      if (token.length > 0 && this.currentProfile !== null) {
        this.currentProfile.accessToken = token;
        this.currentProfile.pairCode = '';
      }
      this.persistProfile(token, '');
      AppStorage.setOrCreate<string>('pairingHint', '配对成功，凭据已保存');
    }
    if (frame.kind === 'relay-authorized') {
      AppStorage.setOrCreate<string>('publicAccessState', '已授权');
      AppStorage.setOrCreate<string>('transportKind', 'relay');
      const accessToken: string = frame.accessToken !== undefined ? frame.accessToken : '';
      if (accessToken.length > 0 && this.currentProfile !== null) {
        this.currentProfile.accessToken = accessToken;
        this.currentProfile.inviteToken = '';
      }
      this.persistProfile('', accessToken);
      AppStorage.setOrCreate<string>('pairingHint', '中继授权成功，凭据已保存');
    }
    if (frame.gatewayName !== undefined && frame.gatewayName.length > 0) {
      AppStorage.setOrCreate<string>('gatewayName', frame.gatewayName);
    }
    AppStorage.setOrCreate<string>('lastFrameKind', frame.kind);
    for (const listener of this.frameListeners) {
      try {
        listener(frame);
      } catch (err) {
        Logger.error('frame listener failed: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  /** 中继 E2EE：AgentHello 验签 → relay-auth → 业务帧解密。 */
  private handleRelayPacket(packet: Uint8Array): void {
    const session = this.relaySession;
    if (session === null) {
      return;
    }
    if (!session.isReady()) {
      if (session.acceptAgentHello(packet)) {
        AppStorage.setOrCreate<string>('pairingHint', 'E2EE 已建立，正在认证设备…');
        this.sendRelayJson({ 'type': 'relay-auth', 'deviceId': this.deviceId(), 'deviceName': 'HarmonyOS 原生客户端' });
      } else {
        Logger.error('relay agent hello rejected');
        AppStorage.setOrCreate<string>('pairingHint', '中继身份校验失败（agentPubKey 不匹配）');
        this.disconnect();
      }
      return;
    }
    const text: string = session.open(packet);
    if (text.length === 0) {
      Logger.warn('relay packet rejected');
      return;
    }
    this.handleTextFrame(text);
  }

  private deviceId(): string {
    if (this.deviceIdCache.length > 0) {
      return this.deviceIdCache;
    }
    const stored: string = PreferencesStore.get().getString('deviceId', '');
    if (stored.length > 0) {
      this.deviceIdCache = stored;
      return stored;
    }
    const bytes: Uint8Array = randomBytes(16);
    let id: string = '';
    for (const b of bytes) {
      id += (b < 16 ? '0' : '') + b.toString(16);
    }
    PreferencesStore.get().putString('deviceId', id);
    this.deviceIdCache = id;
    return id;
  }

  private sendRelayJson(frame: Record<string, Object>): boolean {
    return this.send(JSON.stringify(frame));
  }

  private sendBinary(bytes: Uint8Array): boolean {
    if (this.ws === null || this.state !== ConnectionState.CONNECTED) {
      return false;
    }
    const buffer: ArrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    this.ws.send(buffer, (err: BusinessError) => {
      if (err) {
        Logger.error('send binary failed: ' + JSON.stringify(err));
      }
    });
    return true;
  }

  /** 把当前连接参数持久化，供下次免扫码重连。 */
  private persistProfile(token: string, accessToken: string): void {
    const profile = this.currentProfile;
    if (profile === null) {
      return;
    }
    const existing: SavedGateway | null = CredentialStore.get().load();
    const relayNodeId: string = profile.relayNodeId !== undefined ? profile.relayNodeId : '';
    const gateway: SavedGateway = {
      id: relayNodeId.length > 0 ? relayNodeId : profile.wsUrl,
      name: AppStorage.get<string>('gatewayName') ?? '',
      wsUrl: profile.wsUrl,
      pairCode: profile.pairCode,
      token: token.length > 0 ? token : (existing !== null ? existing.token : ''),
      relayNodeId: relayNodeId,
      relayAgentPubKey: profile.relayAgentPubKey !== undefined ? profile.relayAgentPubKey : '',
      inviteToken: profile.inviteToken,
      accessToken: accessToken.length > 0 ? accessToken
        : (existing !== null && existing.relayNodeId === relayNodeId ? existing.accessToken : profile.accessToken),
      pairedAt: existing !== null && existing.id === (relayNodeId.length > 0 ? relayNodeId : profile.wsUrl)
        ? existing.pairedAt : Date.now(),
      lastConnectedAt: Date.now()
    };
    CredentialStore.get().save(gateway);
  }

  /** 使用已保存凭据自动重连（免扫码）。返回是否发起了连接。 */
  autoConnect(): boolean {
    const saved: SavedGateway | null = CredentialStore.get().load();
    if (saved === null) {
      return false;
    }
    const profile: GatewayProfile = {
      wsUrl: saved.wsUrl,
      pairCode: saved.pairCode,
      leaseToken: '',
      inviteToken: saved.accessToken.length > 0 ? '' : saved.inviteToken,
      accessToken: saved.accessToken,
      token: saved.token,
      relayNodeId: saved.relayNodeId,
      relayAgentPubKey: saved.relayAgentPubKey
    };
    Logger.info('auto connect saved gateway ' + saved.wsUrl);
    this.connect(profile);
    return true;
  }

  /** 忘记网关：断开并清除本地凭据。 */
  forgetSaved(): void {
    CredentialStore.get().clear();
    AppStorage.setOrCreate<string>('gatewayName', '');
    this.disconnect();
  }

  savedGatewayName(): string {
    const saved: SavedGateway | null = CredentialStore.get().load();
    return saved !== null ? saved.name : '';
  }

  /** hello 帧：发布网关标识信息，供设置页展示。 */
  private publishHello(frame: GatewayFrame): void {
    if (frame.kind !== 'hello') {
      return;
    }
    // hello 到达说明连接已就绪，此时补拉部署级默认配置
    this.requestDefaults();
    this.requestModelsCatalog();
    this.requestAgentPresets();
    this.requestPermissionOptions();
    const version: string = frame.dshVersion !== undefined ? frame.dshVersion : '';
    const protocol: number = frame.protocol !== undefined ? frame.protocol : 0;
    AppStorage.setOrCreate<string>('gatewayVersion', version);
    AppStorage.setOrCreate<number>('gatewayProtocol', protocol);
  }

  private settlePending(frame: GatewayFrame): void {
    const matched: string[] = [];
    this.pending.forEach((req: PendingRequest, key: string) => {
      if ((frame.requestId !== undefined && frame.requestId === req.id) || frame.kind === req.matchType) {
        matched.push(key);
      }
    });
    for (const key of matched) {
      const req: PendingRequest | undefined = this.pending.get(key);
      if (req !== undefined) {
        clearTimeout(req.timer);
        this.pending.delete(key);
        req.resolve(frame);
      }
    }
  }

  private publish(state: ConnectionState): void {
    this.state = state;
    AppStorage.setOrCreate<string>(KEY_CONNECTION, state as string);
  }
}