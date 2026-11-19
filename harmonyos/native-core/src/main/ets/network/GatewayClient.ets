import { webSocket, connection } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Logger } from '../common/Logger';
import { NotificationService } from '../common/NotificationService';
import { KEY_CONNECTION } from '../common/AppState';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { decodeFrame } from '../protocol/GatewayFrameCodec';
import { GatewayRequests } from '../protocol/GatewayRequests';
import { GatewayRequest, GatewayRequestFactory, GatewayRequestLanePolicy, GatewayRequestLanes, LaneSubmission, GatewayGoalReference } from '../protocol/GatewayRequest';
import { matchesResponse, RequestCorrelation } from '../protocol/RequestCorrelation';
import { PairingResult } from '../protocol/PairingPayload';
import { RelaySession } from '../crypto/RelaySession';
import { base64Decode } from '../crypto/DshCrypto';
import { randomBytes } from '../crypto/Sodium';
import { PreferencesStore } from '../common/PreferencesStore';
import { CredentialStore, SavedGateway } from '../state/CredentialStore';
import { PluginStore } from '../state/PluginStore';
import { ScheduleStore } from '../state/ScheduleStore';
import { SessionStore } from '../state/SessionStore';

interface RequestPayload {
  type?: string;
  requestId?: string;
  transferId?: string;
  offset?: number;
  rpcId?: string;
  sessionId?: string;
  itemId?: string;
  command?: string;
}

interface QueuedLaneRequest {
  request: GatewayRequest;
  timeoutMs: number;
  resolve: (frame: GatewayFrame) => void;
  reject: (error: Error) => void;
}

interface PendingRequest extends RequestCorrelation {
  correlationId?: string;
  itemId?: string;
  command?: string;
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
  private pendingSequence: number = 0;
  private requestSeq: number = 0;
  private requestLanes: GatewayRequestLanes | null = null;
  private queuedLaneRequests: Map<GatewayRequest, QueuedLaneRequest> = new Map();
  private connectionGeneration: number = 0;
  private pairCandidates: string[] = [];
  private pairIndex: number = 0;
  private pairCode: string = '';
  private pairingGatewayName: string = '';
  private relaySession: RelaySession | null = null;
  private relayNodeId: string = '';
  private pluginRequestSeq: number = 0;
  // 内嵌 tailnet 代理：启用后本机 ws 连接改走 127.0.0.1 代理端口
  private tailnetProxyEnabled: boolean = false;
  // 内嵌 tailnet：把 100.x / *.ts.net 网关地址改写成经本机代理的 ws 地址
  private tailnetDialer: (url: string) => string = (url: string): string => '';
  private tailnetAttemptFailed: boolean = false;
  private forceTailnet: boolean = false;
  private lastBearerSwitchAt: number = 0;
  private suppressConnecting: boolean = false;
  private connectRetryTimer: number = 0;
  private bearerPollTimer: number = 0;
  /** 切蜂窝后等隧道就绪再切终点的轮询（隧道没起来时先把现有连接保住） */
  private tailnetSwitchTimer: number = 0;
  private tailnetSwitchTries: number = 0;
  private tailnetEnablerCalled: boolean = false;
  private tailnetEnabler: () => void = () => {};
  private usingTailnetRoute: boolean = false;
  private tunnelWaitCount: number = 0;

  /** 内嵌隧道是否就绪（开关打开且 Running） */
  private tailnetReady(): boolean {
    if ((AppStorage.get<boolean>('tsnetFastReady') ?? false) === true) {
      return true;
    }
    // 轻量引擎还没起来时退回 tsd 引擎的就绪状态（兼容旧行为）
    return (AppStorage.get<string>('tailscaleStage') ?? '') === 'ready' &&
      (AppStorage.get<boolean>('tscaleFastOnly') ?? false) === false;
  }

  /** 用户在 Tailscale 页配置的网关 tailnet 地址（host:port），返回 ws 地址 */
  private configuredTailnetEndpoint(): string {
    const target: string = PreferencesStore.get().getString('tailnetGatewayTarget', '').trim();
    if (target.length === 0) {
      return '';
    }
    const withPort: string = target.indexOf(':') >= 0 ? target : target + ':3081';
    return 'ws://' + withPort;
  }
  private tailnetProxyPort: number = 18080;
  private relayAgentPubKey: string = '';
  private deviceIdCache: string = '';
  private currentProfile: GatewayProfile | null = null;
  private handshakeHello: boolean = false;
  private handshakePaired: boolean = false;
  private handshakeNeedsPair: boolean = false;
  private handshakeActivated: boolean = false;
  private reconnectTimer: number = 0;
  private reconnectAttempt: number = 0;
  private intentionalClose: boolean = false;
  private reconnectEnabled: boolean = false;
  // 心跳保活（对齐参考实现：20s 发 ping，60s 无帧判死）
  private heartbeatTimer: number = 0;
  private lastFrameAt: number = 0;
  // 网络类型感知（局域网优先 / 蜂窝自动切公网）
  private allEndpoints: string[] = [];
  private networkBearer: string = 'unknown';
  private netListening: boolean = false;
  private netConnection: connection.NetConnection | null = null;

  /** 判定端点是否属于局域网/本机（对齐 dsh-mobile 的 GatewayIdentity.isLocal） */
  private isLocalEndpoint(url: string): boolean {
    let host: string = url;
    const schemeAt: number = host.indexOf('://');
    if (schemeAt >= 0) {
      host = host.substring(schemeAt + 3);
    }
    const slash: number = host.indexOf('/');
    if (slash >= 0) {
      host = host.substring(0, slash);
    }
    const at: number = host.lastIndexOf('@');
    if (at >= 0) {
      host = host.substring(at + 1);
    }
    if (host.startsWith('[')) {
      const close: number = host.indexOf(']');
      host = close > 1 ? host.substring(1, close) : host;
    } else {
      const colon: number = host.indexOf(':');
      if (colon >= 0) {
        host = host.substring(0, colon);
      }
    }
    host = host.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) {
      return true;
    }
    if (host.indexOf(':') >= 0 && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) {
      return true;
    }
    const parts: string[] = host.split('.');
    if (parts.length !== 4) {
      return false;
    }
    const nums: number[] = [];
    for (const part of parts) {
      const value: number = Number(part);
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        return false;
      }
      nums.push(value);
    }
    // 10/8、127/8、100.64/10（含 Tailscale）、192.168/16、172.16/12、169.254/16
    return nums[0] === 10 || nums[0] === 127 ||
      (nums[0] === 100 && nums[1] >= 64 && nums[1] <= 127) ||
      (nums[0] === 192 && nums[1] === 168) ||
      (nums[0] === 172 && nums[1] >= 16 && nums[1] <= 31) ||
      (nums[0] === 169 && nums[1] === 254);
  }

  /** 读取当前默认网络类型：wifi / cellular / other */
  private detectNetworkBearer(): string {
    try {
      const net: connection.NetHandle = connection.getDefaultNetSync();
      if (net === undefined || net.netId === 0) {
        return 'other';
      }
      const caps: connection.NetCapabilities = connection.getNetCapabilitiesSync(net);
      const bearers: number[] = caps.bearerTypes === undefined ? [] : caps.bearerTypes;
      if (bearers.indexOf(connection.NetBearType.BEARER_WIFI) >= 0) {
        return 'wifi';
      }
      if (bearers.indexOf(connection.NetBearType.BEARER_CELLULAR) >= 0) {
        return 'cellular';
      }
      return 'other';
    } catch (err) {
      return 'unknown';
    }
  }

  /**
   * 按网络类型给候选端点排序：
   * - Wi-Fi / 其他：局域网优先（低延迟，不走公网）
   * - 蜂窝：公网优先（局域网地址此时不可达）
   */
  private orderEndpoints(list: string[]): string[] {
    const unique: string[] = [];
    for (const one of list) {
      if (unique.indexOf(one) < 0) {
        unique.push(one);
      }
    }
    const locals: string[] = unique.filter((one: string) => this.isLocalEndpoint(one));
    const publics: string[] = unique.filter((one: string) => !this.isLocalEndpoint(one));
    // 用户偏好：公网优先、局域网兜底；内嵌隧道就绪时 tailnet 地址最优先，
    // 未就绪时把 tailnet 地址放最后，避免启动时等待隧道拖慢首连。
    const tailnets: string[] = publics.filter((one: string) => this.isTailnetAddress(one));
    const restPublics: string[] = publics.filter((one: string) => !this.isTailnetAddress(one));
    if (this.networkBearer !== 'cellular') {
      // Wi‑Fi / 其他：局域网优先。公网候选里经常还留着早已失效的
      // *.trycloudflare.com 快速隧道地址，先试它只会让启动首连白等一轮超时。
      return locals.concat(restPublics).concat(tailnets);
    }
    // 蜂窝：局域网不可达，公网优先；内嵌隧道就绪时 tailnet 地址比公网更可靠
    return (this.tailnetReady() ? tailnets.concat(restPublics) : restPublics.concat(tailnets)).concat(locals);
  }

  /** 注册网络类型监听（只注册一次） */
  private ensureNetworkMonitor(): void {
    if (this.netListening) {
      return;
    }
    this.netListening = true;
    this.networkBearer = this.detectNetworkBearer();
    AppStorage.setOrCreate<string>('networkBearer', this.networkBearer);
    try {
      const netConn: connection.NetConnection = connection.createNetConnection();
      this.netConnection = netConn;
      netConn.on('netCapabilitiesChange', (data: connection.NetCapabilityInfo) => {
        this.handleNetworkChange(data);
      });
      netConn.register((err: BusinessError) => {
        if (err) {
          Logger.warn('network monitor register failed: ' + JSON.stringify(err));
        }
      });
      // 事件可能延迟/丢失：每 2 秒主动轮询一次网络类型，保证 WiFi↔蜂窝 及时切换
      if (this.bearerPollTimer === 0) {
        this.bearerPollTimer = setInterval(() => {
          const polled: string = this.detectNetworkBearer();
          if (polled !== this.networkBearer && (polled === 'wifi' || polled === 'cellular')) {
            Logger.info('network poll detected ' + this.networkBearer + ' -> ' + polled);
            this.applyBearer(polled);
          }
        }, 2000);
      }
    } catch (err) {
      Logger.warn('network monitor unavailable: ' + String(err));
    }
  }

  /** 应用新的网络类型：切换端点并重连（事件与轮询共用） */
  private applyBearer(next: string): void {
    const previous: string = this.networkBearer;
    if (next === previous) {
      return;
    }
    const now: number = Date.now();
    if (now - this.lastBearerSwitchAt < 3000) {
      return;
    }
    this.lastBearerSwitchAt = now;
    this.networkBearer = next;
    AppStorage.setOrCreate<string>('networkBearer', next);
    Logger.info('network bearer ' + previous + ' -> ' + next);
    const profile: GatewayProfile | null = this.currentProfile;
    if (this.allEndpoints.length === 0 || profile === null) {
      return;
    }
    this.forceTailnet = next === 'cellular';
    if (next === 'cellular') {
      AppStorage.setOrCreate<string>('pairingHint', '已切换到蜂窝网络，正在改用 Tailscale 隧道…');
      if (!this.tailnetEnablerCalled) {
        this.tailnetEnablerCalled = true;
        this.tailnetEnabler();
      }
    } else {
      AppStorage.setOrCreate<string>('pairingHint', '已回到 Wi-Fi，正在改用局域网直连…');
      const localSaved: SavedGateway | undefined = CredentialStore.get().list()
        .find((item: SavedGateway) => this.isLocalEndpoint(item.wsUrl));
      if (localSaved !== undefined &&
          (this.currentProfile === null || !this.isLocalEndpoint(this.currentProfile.wsUrl))) {
        Logger.info('wifi restored saved LAN gateway ' + localSaved.wsUrl);
        this.switchGateway(localSaved.id);
        return;
      }
    }
    const target: string = next === 'cellular' ? this.cellularEndpoint(profile.wsUrl) : profile.wsUrl;
    this.suppressConnecting = true;
    Logger.info('network change reconnect bearer=' + next + ' url=' + target);
    if (target !== profile.wsUrl) {
      this.switchEndpoint(target);
    } else {
      this.reconnectCurrent();
    }
    // 切蜂窝时隧道常常还没就绪（AppStorage 里的 dns 后缀要等 tsnet 上报）。
    // 挂一个轮询：等隧道 ready 且当前还停在局域网入口时，自动改走 tailnet。
    if (next === 'cellular') {
      this.scheduleTailnetSwitchWhenReady();
    } else {
      this.clearTailnetSwitchTimer();
    }
  }

  /**
   * 蜂窝下「等隧道就绪再切」：每秒检查，最多约 40s。
   * Wi-Fi 刚断开那几秒隧道还没 ready，先保住连接，等能走 tailnet 了再无缝切过去。
   */
  private scheduleTailnetSwitchWhenReady(): void {
    if (this.tailnetSwitchTimer !== 0) {
      return;
    }
    this.tailnetSwitchTries = 0;
    this.tailnetSwitchTimer = setInterval(() => {
      this.tailnetSwitchTries += 1;
      const profile: GatewayProfile | null = this.currentProfile;
      const onCellular: boolean = this.networkBearer === 'cellular';
      const localTarget: boolean = profile !== null && this.isLocalEndpoint(profile.wsUrl);
      if (onCellular && localTarget && profile !== null && this.tailnetReady()) {
        const target: string = this.cellularEndpoint(profile.wsUrl);
        if (target !== profile.wsUrl && this.isTailnetAddress(target)) {
          Logger.info('tailnet ready, switch endpoint ' + profile.wsUrl + ' -> ' + target);
          this.clearTailnetSwitchTimer();
          this.switchEndpoint(target);
          return;
        }
      }
      if (!onCellular || !localTarget || this.tailnetSwitchTries > 40) {
        this.clearTailnetSwitchTimer();
      }
    }, 1000);
  }

  private clearTailnetSwitchTimer(): void {
    if (this.tailnetSwitchTimer !== 0) {
      clearInterval(this.tailnetSwitchTimer);
      this.tailnetSwitchTimer = 0;
    }
  }

  /** 网络类型变化：重排端点，必要时自动切换（Wi-Fi→蜂窝 或 蜂窝→Wi-Fi） */
  private handleNetworkChange(data: connection.NetCapabilityInfo): void {
    const netCap: connection.NetCapabilities | undefined = data.netCap;
    if (netCap === undefined) {
      return;
    }
    const bearers: number[] = netCap.bearerTypes === undefined ? [] : netCap.bearerTypes;
    let next: string = '';
    if (bearers.indexOf(connection.NetBearType.BEARER_WIFI) >= 0) {
      next = 'wifi';
    } else if (bearers.indexOf(connection.NetBearType.BEARER_CELLULAR) >= 0) {
      next = 'cellular';
    }
    if (next.length === 0) {
      return;
    }
    this.applyBearer(next);
  }

  private scheduleConnectRetry(profile: GatewayProfile, keepReconnect: boolean, delay: number): void {
    if (this.connectRetryTimer !== 0) {
      return;
    }
    this.connectRetryTimer = setTimeout(() => {
      this.connectRetryTimer = 0;
      if (this.currentProfile !== null) {
        this.connect(profile, keepReconnect);
      }
    }, delay);
  }

  /** 蜂窝下把局域网入口换成 tailnet 入口（wss://<gateway>.ts.net/ws/mobile） */
  /** ws://100.x:3081 这类临时 tailnet IP 入口无效（网关只在 ts.net 443 上 serve） */
  private isTransientTailnetUrl(url: string): boolean {
    return this.isTailnetAddress(url) && url.indexOf('.ts.net') < 0;
  }

  private cellularEndpoint(url: string): string {
    if (!this.isLocalEndpoint(url)) {
      return url;
    }
    // 蜂窝下优先已保存的公网入口（新版配对会带 wss://<gateway>.ts.net/ws/mobile）
    const publics: string[] = this.allEndpoints.filter((one: string) => !this.isLocalEndpoint(one));
    if (publics.length > 0) {
      const tailnetFirst: string[] = publics.filter((one: string) => this.isTailnetAddress(one));
      return tailnetFirst.length > 0 ? tailnetFirst[0] : publics[0];
    }
    // 没有保存公网入口时：用 tailnet DNS 后缀合成 wss://<gateway>.ts.net/ws/mobile
    // 后缀此前只存在 AppStorage，冷启动后要等 tsnet 再次上报才恢复 —— 切蜂窝的瞬间往往就是空的，
    // 于是合成失败、只能继续连局域网地址。这里补一层持久化兜底。
    const memorySuffix: string = AppStorage.get<string>('tailnetDnsSuffix') ?? '';
    const suffix: string = memorySuffix.length > 0
      ? memorySuffix : PreferencesStore.get().getString('tailnetDnsSuffix', '');
    if (suffix.length > 0) {
      // 必须用网关在 tailnet 里的节点名（如 dsh-gateway），不能用用户给主机起的别名
      let name: string = AppStorage.get<string>('tailnetGatewayPeerName') ?? '';
      if (name.length === 0) {
        name = PreferencesStore.get().getString('tailnetGatewayPeerName', '');
      }
      if (name.length === 0) {
        name = 'dsh-gateway';
      }
      name = name.split('.')[0];
      return 'wss://' + name + '.' + suffix + '/ws/mobile';
    }
    // 不再退回 ws://100.x:3081（网关只监听 ts.net 443，直连该端口必然失败）
    return url;
  }

  /** 回前台校验网络：后台期间切了 WiFi/蜂窝也要立刻按新网络重连 */
  revalidateOnForeground(): void {
    const before: string = this.networkBearer;
    this.ensureNetworkMonitor();
    const next: string = this.detectNetworkBearer();
    this.networkBearer = next;
    AppStorage.setOrCreate<string>('networkBearer', next);
    const changed: boolean = before !== next;
    const state: string = AppStorage.get<string>('connectionState') ?? 'disconnected';
    if (changed) {
      this.forceTailnet = next === 'cellular';
      if (next === 'cellular' && !this.tailnetEnablerCalled) {
        this.tailnetEnablerCalled = true;
        this.tailnetEnabler();
      }
      Logger.info('foreground network changed ' + before + ' -> ' + next);
    }
    if (changed || (state !== 'connected' && state !== 'connecting')) {
      this.reconnectCurrent();
    }
  }

  /** 在原凭据基础上切换端点重连 */
  private switchEndpoint(url: string): void {
    const base: GatewayProfile | null = this.currentProfile;
    if (base === null || base.wsUrl === url) {
      return;
    }
    const next: GatewayProfile = {
      wsUrl: url,
      pairCode: base.pairCode,
      leaseToken: base.leaseToken,
      inviteToken: base.inviteToken,
      accessToken: base.accessToken,
      relayNodeId: base.relayNodeId,
      relayAgentPubKey: base.relayAgentPubKey,
      token: base.token
    };
    this.connect(next, true);
  }

  static get(): GatewayClient {
    return GatewayClient.instance;
  }

  currentState(): ConnectionState {
    return this.state;
  }

  /** 扫码配对：按二维码里的候选地址顺序尝试（直连 ws/wss 优先）。 */
  connectPairing(result: PairingResult): void {
    if (!result.ok || result.pairCode.length === 0 || result.expiresAt <= Date.now() || result.candidates.length === 0) {
      this.publish(ConnectionState.FAILED);
      AppStorage.setOrCreate<string>('connectionMessage', '该二维码只有中继地址，中继 E2EE 将在下一阶段支持');
      return;
    }
    this.ensureNetworkMonitor();
    // 全部候选留档，切换网络时据此重排
    this.allEndpoints = result.candidates.slice();
    // 局域网优先（蜂窝网络下自动改为公网优先）
    this.pairCandidates = this.orderEndpoints(this.allEndpoints);
    this.pairIndex = 0;
    this.pairCode = result.pairCode;
    this.pairingGatewayName = result.gatewayName;
    this.relayNodeId = result.relayNodeId;
    this.relayAgentPubKey = result.relayAgentPubKey;
    AppStorage.setOrCreate<string>('pairingHint',
      '共 ' + result.candidates.length + ' 个候选地址，正在尝试第 1 个');
    this.tryNextCandidate();
  }

  /**
   * 判断地址是否属于 Tailscale 内网：
   * - CGNAT 段 100.64.0.0/10
   * - MagicDNS 域名 *.ts.net
   * 鸿蒙端无法运行 tsnet 隧道（iOS 用 Go/tsnet 在进程内建节点），
   * 识别出来是为了给出可执行的提示，而不是笼统的「无法连接」。
   */
  private isTailnetAddress(url: string): boolean {
    let host: string = url;
    if (host.indexOf('://') >= 0) {
      host = host.substring(host.indexOf('://') + 3);
    }
    const slash: number = host.indexOf('/');
    if (slash >= 0) {
      host = host.substring(0, slash);
    }
    const colon: number = host.indexOf(':');
    if (colon >= 0) {
      host = host.substring(0, colon);
    }
    host = host.toLowerCase();
    if (host.endsWith('.ts.net')) {
      return true;
    }
    const parts: string[] = host.split('.');
    if (parts.length === 4) {
      const first: number = Number(parts[0]);
      const second: number = Number(parts[1]);
      if (first === 100 && second >= 64 && second <= 127) {
        return true;
      }
    }
    return false;
  }

  /** 失败提示：全部候选都在 Tailscale 内网时给出针对性说明 */
  private candidateFailureMessage(): string {
    if (this.pairCandidates.length === 0) {
      return '所有候选地址都无法连接';
    }
    let tailnet: number = 0;
    for (const candidate of this.pairCandidates) {
      if (this.isTailnetAddress(candidate)) {
        tailnet += 1;
      }
    }
    if (tailnet === this.pairCandidates.length) {
      return '候选地址全部位于 Tailscale 内网（100.x / *.ts.net）。已启用内嵌隧道时会自动经 tunnel 连接；若仍未连上，请检查 Tailscale 登录状态。';
    }
    return '所有候选地址都无法连接';
  }

  private tryNextCandidate(): void {
    if (this.pairIndex >= this.pairCandidates.length) {
      const message: string = this.candidateFailureMessage();
      this.pairCandidates = [];
      this.publish(ConnectionState.FAILED);
      AppStorage.setOrCreate<string>('connectionMessage', message);
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
    if (this.pairCandidates.length === 0) return;
    if (this.pairIndex >= this.pairCandidates.length) {
      const message: string = this.candidateFailureMessage();
      this.pairCandidates = [];
      this.publish(ConnectionState.FAILED);
      AppStorage.setOrCreate<string>('connectionMessage', message);
      return;
    }
    const generation: number = this.connectionGeneration;
    const nextIndex: number = this.pairIndex;
    setTimeout(() => {
      if (generation !== this.connectionGeneration || nextIndex !== this.pairIndex) return;
      this.tryNextCandidate();
    }, 300);
  }

  /** 启用/停用「网关经内嵌 tailnet」：连接地址改走本机代理端口 */
  setTailnetProxy(enabled: boolean, localPort: number): void {
    this.tailnetProxyEnabled = enabled;
    this.tailnetProxyPort = localPort;
  }

  /** 允许下一次连接重新尝试 tailnet 路由 */
  resetTailnetAttempt(): void {
    this.tailnetAttemptFailed = false;
  }

  /** 注册 tailnet 启动器（由应用层注入：打开并启动内嵌隧道） */
  setTailnetEnabler(enabler: () => void): void {
    this.tailnetEnabler = enabler;
  }

  /** 注册 tailnet 拨号器（由应用层注入：返回改写后的 ws 地址，空串表示直连） */
  setTailnetDialer(dialer: (url: string) => string): void {
    this.tailnetDialer = dialer;
  }

  /** 当前网关地址（供 UI 解析 tailnet 目标） */
  currentWsUrl(): string {
    return this.currentProfile !== null ? this.currentProfile.wsUrl : '';
  }

  /** 用当前 profile 重新连接（代理切换后调用） */
  reconnectCurrent(): void {
    if (this.currentProfile !== null) {
      this.connect(this.currentProfile, true);
    }
  }

  private hostOfUrl(url: string): string {
    let rest: string = url;
    const schemeIndex: number = rest.indexOf('://');
    if (schemeIndex >= 0) {
      rest = rest.substring(schemeIndex + 3);
    }
    const slash: number = rest.indexOf('/');
    if (slash >= 0) {
      rest = rest.substring(0, slash);
    }
    const at: number = rest.lastIndexOf('@');
    if (at >= 0) {
      rest = rest.substring(at + 1);
    }
    const colon: number = rest.indexOf(':');
    if (colon >= 0) {
      rest = rest.substring(0, colon);
    }
    return rest;
  }

  private effectiveWsUrl(url: string): string {
    if (!this.tailnetProxyEnabled || this.tailnetProxyPort <= 0) {
      return url;
    }
    const host: string = this.hostOfUrl(url);
    if (host === '127.0.0.1' || host === 'localhost') {
      return url;
    }
    return 'ws://127.0.0.1:' + this.tailnetProxyPort;
  }

  connect(profile: GatewayProfile, keepReconnect: boolean = false): void {
    if (this.networkBearer === 'cellular' && this.isLocalEndpoint(profile.wsUrl)) {
      const rewritten: string = this.cellularEndpoint(profile.wsUrl);
      if (rewritten !== profile.wsUrl) {
        Logger.info('cellular rewrite endpoint ' + profile.wsUrl + ' -> ' + rewritten);
        const next: GatewayProfile = {
          wsUrl: rewritten,
          pairCode: profile.pairCode,
          leaseToken: profile.leaseToken,
          inviteToken: profile.inviteToken,
          accessToken: profile.accessToken,
          relayNodeId: profile.relayNodeId,
          relayAgentPubKey: profile.relayAgentPubKey,
          token: profile.token
        };
        profile = next;
      }
    }
    // Tailscale 开启时或目标是 tailnet 地址：等隧道就绪后走隧道（最多 ~37s，之后回退直连避免卡死）
    // 只有目标是 tailnet 地址时才等隧道；普通局域网/公网入口立即连接（隧道在后台预热）
    const tunnelNeeded: boolean = this.isTailnetAddress(profile.wsUrl) ||
      (this.networkBearer === 'cellular' && this.isLocalEndpoint(profile.wsUrl) &&
        (AppStorage.get<boolean>('tailscaleTunnelEnabled') ?? false));
    if (tunnelNeeded && !this.tailnetReady()) {
      const stage: string = AppStorage.get<string>('tailscaleStage') ?? 'disabled';
      if (!this.tailnetEnablerCalled) {
        this.tailnetEnablerCalled = true;
        Logger.info('gateway auto-enable embedded tunnel for ' + profile.wsUrl);
        this.tailnetEnabler();
      }
      if (stage !== 'failed' && this.tunnelWaitCount < 25) {
        this.tunnelWaitCount++;
        Logger.info('gateway wait tunnel stage=' + stage + ' attempt=' + this.tunnelWaitCount);
        setTimeout(() => {
          this.connect(profile, keepReconnect);
        }, 1500);
        return;
      }
    }
    this.tailnetEnablerCalled = false;
    this.tunnelWaitCount = 0;
    this.disconnect();
    this.reconnectEnabled = keepReconnect;
    this.intentionalClose = false;
    this.currentProfile = profile;
    this.profile = profile;
    const stableGatewayKey: string = (profile.relayNodeId !== undefined && profile.relayNodeId.length > 0)
      ? profile.relayNodeId
      : (CredentialStore.get().activeGatewayId().length > 0 ? CredentialStore.get().activeGatewayId() : 'direct-gateway');
    SessionStore.get().prepareGateway(stableGatewayKey);
    this.handshakeHello = false;
    this.handshakePaired = false;
    this.handshakeNeedsPair = profile.pairCode.length > 0 && (profile.token === undefined || profile.token.length === 0);
    this.handshakeActivated = false;
    if (!this.suppressConnecting) {
      this.publish(ConnectionState.CONNECTING);
    }
    const ws: webSocket.WebSocket = webSocket.createWebSocket();
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.suppressConnecting = false;
      AppStorage.setOrCreate<boolean>('gatewayCredentialRejected', false);
      Logger.info('gateway open ' + profile.wsUrl);
      this.pairCandidates = [];
      this.pairIndex = 0;
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
      AppStorage.setOrCreate<string>('transportKind',
        profile.relayNodeId !== undefined && profile.relayNodeId.length > 0 ? 'relay' : 'direct');
      AppStorage.setOrCreate<string>('pairingHint', '通道已建立，等待网关认证…');
    });
    ws.on('message', (err: BusinessError, data: string | ArrayBuffer) => {
      if (this.ws !== ws) return;
      this.lastFrameAt = Date.now();
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
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      Logger.warn('gateway close ' + JSON.stringify(result));
      this.connectionGeneration++;
      this.rejectPending('连接已断开，请重试');
      SessionStore.get().clearPendingPrompts();
      const wasConnected: boolean = this.state === ConnectionState.CONNECTED;
      this.ws = null;
      this.relaySession = null;
      this.publish(ConnectionState.DISCONNECTED);
      if (this.reconnectEnabled && !this.intentionalClose && this.pairCandidates.length === 0) this.scheduleReconnect();
      else if (!wasConnected) this.scheduleNextCandidate();
    });
    ws.on('error', (err: BusinessError) => {
      if (this.ws !== ws) return;
      Logger.error('gateway error ' + JSON.stringify(err));
      // 握手 401：网关拒绝了保存的设备凭据（token 失效/被轮换，或一次性配对码已消费）。
      // 记录本身绝不删除：只标记凭据失效并提示重新配对，避免「连不上 = 记录被清除」的观感。
      if (JSON.stringify(err).indexOf('401') >= 0) {
        Logger.warn('gateway credential rejected (401): saved credential no longer valid');
        AppStorage.setOrCreate<boolean>('gatewayCredentialRejected', true);
        AppStorage.setOrCreate<string>('pairingHint', '设备凭据已失效，请重新扫码配对');
      }
      this.failSocket(ws);
    });

    const header: Record<string, string> = {
      'X-DSH-Channel': 'mobile',
      'X-DSH-Device-ID': this.deviceId()
    };
    // 配对码必须走子协议 dsh-pair.<code>（网关按 Sec-WebSocket-Protocol 解析）；token 走 Authorization。
    let protocol: string = 'dsh-mobile-v1';
    if (profile.token !== undefined && profile.token.length > 0) {
      header['Authorization'] = 'Bearer ' + profile.token;
    } else if (profile.pairCode.length > 0) {
      protocol = 'dsh-mobile-v1, dsh-pair.' + profile.pairCode;
    }
    let connectUrl: string = this.effectiveWsUrl(profile.wsUrl);
    this.usingTailnetRoute = false;
    // 对齐 iOS NodeForwarding：隧道就绪时把「逻辑端点」原样交给节点拨号（路径/查询参数保留），
    // 只把连接端点换成本机转发端口；失败后回落直连。
    const tailnetTarget: boolean = this.isTailnetAddress(profile.wsUrl);
    if (tailnetTarget) {
      this.tailnetAttemptFailed = false;
    }
    const lanDirect: boolean = this.isLocalEndpoint(profile.wsUrl) && this.networkBearer === 'wifi' && !this.forceTailnet;
    if (!lanDirect && this.tailnetReady() && (tailnetTarget || !this.tailnetAttemptFailed)) {
      const dialed: string = this.tailnetDialer(profile.wsUrl);
      if (dialed.length > 0) {
        connectUrl = dialed;
        this.usingTailnetRoute = true;
      } else if (tailnetTarget) {
        // 隧道入口必须走代理，dialer 没准备好就短暂重试，绝不直连
        Logger.warn('tunnel dialer not ready, retry shortly');
        this.scheduleConnectRetry(profile, keepReconnect, 600);
        return;
      }
    } else if (tailnetTarget && !this.tailnetReady()) {
      Logger.info('tunnel not ready yet for ' + profile.wsUrl);
      this.scheduleConnectRetry(profile, keepReconnect, 800);
      return;
    }
    AppStorage.setOrCreate<boolean>('transportTailnet', this.usingTailnetRoute);
    Logger.info('transport path ' + (this.usingTailnetRoute ? 'tailnet' : 'direct') + ' url=' + connectUrl);
    Logger.info('gateway connect url=' + connectUrl + ' tailnet=' + this.usingTailnetRoute + ' logical=' + profile.wsUrl);
    ws.connect(connectUrl, { header: header, protocol: protocol }, (err: BusinessError) => {
      if (this.ws !== ws) return;
      if (err) {
        Logger.error('gateway connect callback failed: ' + JSON.stringify(err));
        this.failSocket(ws);
      }
    });
  }

  private failSocket(ws: webSocket.WebSocket): void {
    this.suppressConnecting = false;
    if (this.ws !== ws) return;
    if (this.usingTailnetRoute) {
      this.usingTailnetRoute = false;
      const target: string = this.currentProfile?.wsUrl ?? '';
      if (this.isTailnetAddress(target)) {
        // 目标本来就是 tailnet 地址：只允许走隧道，直接连必然失败
        Logger.warn('gateway tailnet route failed, retrying via tunnel');
        this.tailnetAttemptFailed = false;
      } else {
        Logger.warn('gateway tailnet route failed, fallback to direct');
        this.tailnetAttemptFailed = true;
      }
    } else if (this.tailnetReady() && this.isLocalEndpoint(this.currentProfile?.wsUrl ?? '')) {
      Logger.warn('gateway LAN direct failed, retry via embedded tunnel');
      this.forceTailnet = true;
    }
    this.stopHeartbeat();
    const wasConnected: boolean = this.state === ConnectionState.CONNECTED;
    this.ws = null;
    this.relaySession = null;
    this.connectionGeneration++;
    this.rejectPending('连接异常，请重试');
    SessionStore.get().clearPendingPrompts();
    try { ws.close(); } catch (err) { }
    this.publish(ConnectionState.FAILED);
    if (this.reconnectEnabled && !this.intentionalClose && this.pairCandidates.length === 0) this.scheduleReconnect();
    else if (!wasConnected) this.scheduleNextCandidate();
  }

  /**
   * 心跳保活（对齐参考实现）：
   * - 每 20s 向网关发 {"type":"ping"}
   * - 超过 60s 未收到任何帧判定连接失效并触发重连
   * - 应用在后台时不发送
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const ws: webSocket.WebSocket | null = this.ws;
    if (ws === null) return;
    this.lastFrameAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws !== ws) {
        this.stopHeartbeat();
        return;
      }
      const lifecycle: string = AppStorage.get<string>('appLifecycle') ?? 'foreground';
      if (lifecycle === 'background') return;
      if (Date.now() - this.lastFrameAt > 60000) {
        Logger.warn('heartbeat timeout: no frame in 60s, reconnecting');
        this.failSocket(ws);
        return;
      }
      try {
        ws.send('{"type":"ping"}', (err: BusinessError) => {
          if (err) Logger.warn('heartbeat ping failed: ' + JSON.stringify(err));
        });
      } catch (err) {
        Logger.warn('heartbeat ping threw: ' + String(err));
      }
    }, 20000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== 0) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = 0;
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectEnabled || this.intentionalClose || this.currentProfile === null || this.reconnectTimer !== 0) return;
    const schedule: number[] = [1000, 2000, 3000, 5000, 8000, 13000, 20000, 30000];
    const delay: number = schedule[Math.min(this.reconnectAttempt, schedule.length - 1)];
    this.reconnectAttempt += 1;
    AppStorage.setOrCreate<string>('pairingHint', '连接中断，' + Math.ceil(delay / 1000) + ' 秒后重试');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = 0;
      if (!this.intentionalClose && this.currentProfile !== null) this.connect(this.currentProfile, true);
    }, delay);
  }

  savedGateways(): SavedGateway[] {
    return CredentialStore.get().list();
  }

  switchGateway(id: string): boolean {
    const saved: SavedGateway | null = CredentialStore.get().setActive(id);
    if (saved === null) return false;
    this.pairCandidates = [];
    this.pairIndex = 0;
    AppStorage.setOrCreate<string>('gatewayName', saved.name);
    const profile: GatewayProfile = {
      wsUrl: saved.wsUrl, pairCode: saved.pairCode, leaseToken: '',
      inviteToken: saved.accessToken.length > 0 ? '' : saved.inviteToken,
      accessToken: saved.accessToken, token: saved.token,
      relayNodeId: saved.relayNodeId, relayAgentPubKey: saved.relayAgentPubKey
    };
    this.connect(profile, true);
    return true;
  }

  removeGateway(id: string): boolean {
    const wasActive: boolean = CredentialStore.get().activeGatewayId() === id;
    const removed: boolean = CredentialStore.get().remove(id);
    if (removed && wasActive) {
      this.disconnect();
      const next: SavedGateway | null = CredentialStore.get().load();
      if (next !== null) this.switchGateway(next.id);
    }
    return removed;
  }

  generation(): number {
    return this.connectionGeneration;
  }

  private rejectPending(reason: string): void {
    this.queuedLaneRequests.forEach((entry: QueuedLaneRequest) => entry.reject(new Error(reason)));
    this.queuedLaneRequests.clear();
    if (this.requestLanes !== null) this.requestLanes = null;
    this.pending.forEach((request: PendingRequest) => {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    });
    this.pending.clear();
  }

  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  private maybeActivate(): void {
    if (this.handshakeActivated || !this.handshakeHello || (this.handshakeNeedsPair && !this.handshakePaired)) return;
    this.handshakeActivated = true;
    this.reconnectEnabled = true;
    this.reconnectAttempt = 0;
    this.pairCandidates = [];
    const profile: GatewayProfile | null = this.currentProfile;
    if (profile !== null && (profile.relayNodeId === undefined || profile.relayNodeId.length === 0)) {
      this.persistProfile(profile.token ?? '', '');
    }
    if (profile !== null) {
      // 记录当前实际使用的端点与类型，供设置页展示（局域网优先 / 蜂窝自动切公网）
      AppStorage.setOrCreate<string>('activeEndpoint', profile.wsUrl);
      AppStorage.setOrCreate<string>('endpointKind', this.isLocalEndpoint(profile.wsUrl) ? 'local' : 'public');
    }
    AppStorage.setOrCreate<string>('pairingHint', '已连接：' + (profile !== null ? profile.wsUrl : '网关'));
    this.publish(ConnectionState.CONNECTED);
    this.startHeartbeat();
    SessionStore.get().resumeAfterConnect();
    this.requestDefaults();
    this.requestModelsCatalog();
    this.requestAgentPresets();
    this.requestPermissionOptions();
    this.send(GatewayRequests.host());
    this.send(GatewayRequests.workspaces());
    this.send(GatewayRequests.sessions());
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
  request(body: string, matchType: string, timeoutMs: number = 10000, tolerateTimeout: boolean = false): Promise<GatewayFrame> {
    let payload: RequestPayload = {};
    try { payload = JSON.parse(body) as RequestPayload; } catch (err) { return Promise.reject(new Error('invalid request payload')); }
    const lanePolicy: GatewayRequestLanePolicy = payload.type === 'file-list' || matchType === 'sessions' ||
      matchType === 'workspaces' || matchType === 'commands' || matchType === 'history' || matchType === 'command-options'
      ? GatewayRequestLanePolicy.COALESCE_LATEST
      : (payload.type === 'plugin-bundle-set-enabled' || payload.type === 'plugin-entry-set-enabled'
        ? GatewayRequestLanePolicy.FIFO : GatewayRequestLanePolicy.REJECT_IF_BUSY);
    const correlationId: string | undefined = payload.requestId ?? payload.rpcId ?? payload.transferId ?? payload.itemId ?? payload.command;
    const request: GatewayRequest = GatewayRequestFactory.make(payload.type ?? '', matchType, payload as Record<string, Object>,
      payload.sessionId, correlationId, lanePolicy, timeoutMs);
    if (tolerateTimeout) {
      request.timeoutIsFatal = false;
    }
    return this.enqueueRequest(request, timeoutMs);
  }

  requestGateway(request: GatewayRequest, timeoutMs: number = 10000): Promise<GatewayFrame> {
    return this.enqueueRequest(request, timeoutMs);
  }

  private sendRequest(request: GatewayRequest, timeoutMs: number = 10000): boolean {
    if (!this.isConnected()) return false;
    this.requestGateway(request, timeoutMs).catch((error: Error) => Logger.warn('gateway request failed: ' + error.message));
    return true;
  }

  /** 隧道（DERP 中继）延迟远高于局域网：请求超时放宽，避免误判断线 */
  private tunnelTimeout(timeoutMs: number): number {
    return this.usingTailnetRoute ? Math.max(timeoutMs, 30000) : timeoutMs;
  }

  private enqueueRequest(request: GatewayRequest, timeoutMs: number): Promise<GatewayFrame> {
    timeoutMs = this.tunnelTimeout(timeoutMs);
    if (!this.isConnected()) return Promise.reject(new Error('not connected'));
    if (this.requestLanes === null) this.requestLanes = new GatewayRequestLanes();
    const lanes: GatewayRequestLanes = this.requestLanes;
    return new Promise<GatewayFrame>((resolve: (frame: GatewayFrame) => void, reject: (error: Error) => void) => {
      const entry: QueuedLaneRequest = { request: request, timeoutMs: timeoutMs, resolve: resolve, reject: reject };
      const result: LaneSubmission = lanes.submit(request);
      for (const cancelled of result.cancelled) {
        const previous: QueuedLaneRequest | undefined = this.queuedLaneRequests.get(cancelled);
        if (previous !== undefined) {
          this.queuedLaneRequests.delete(cancelled);
          previous.reject(new Error('request coalesced'));
        }
      }
      if (result.status === 'busy') { reject(new Error('request busy')); return; }
      this.queuedLaneRequests.set(request, entry);
      if (result.status === 'active') this.dispatchLaneRequest(lanes, entry);
    });
  }

  private dispatchLaneRequest(lanes: GatewayRequestLanes, entry: QueuedLaneRequest): void {
    const request: GatewayRequest = entry.request;
    const generation: number = this.connectionGeneration;
    this.sendCorrelated(request, entry.timeoutMs).then((frame: GatewayFrame) => {
      if (!this.queuedLaneRequests.has(request)) return;
      this.queuedLaneRequests.delete(request);
      entry.resolve(frame);
      const next: GatewayRequest | undefined = lanes.complete(request.responseKind);
      if (next !== undefined) {
        const queued: QueuedLaneRequest | undefined = this.queuedLaneRequests.get(next);
        if (queued !== undefined) this.dispatchLaneRequest(lanes, queued);
      }
    }).catch((error: Error) => {
      if (!this.queuedLaneRequests.has(request)) return;
      this.queuedLaneRequests.delete(request);
      entry.reject(error);
      // 只有「必须回执」的请求超时才判定连接坏了。
      // 会话控制类请求（goal/tasks/queue/context）在旧网关没有回执，
      // 以前一律 failSocket，等于点一下目标按钮就把整条 WebSocket 打断，页面随之全部失灵。
      if (error.message.startsWith('timeout:') && request.timeoutIsFatal !== false
        && this.connectionGeneration === generation && this.ws !== null) {
        this.failSocket(this.ws);
        return;
      }
      const next: GatewayRequest | undefined = lanes.complete(request.responseKind);
      if (next !== undefined) {
        const queued: QueuedLaneRequest | undefined = this.queuedLaneRequests.get(next);
        if (queued !== undefined) this.dispatchLaneRequest(lanes, queued);
      }
    });
  }

  private sendCorrelated(request: GatewayRequest, timeoutMs: number): Promise<GatewayFrame> {
    return new Promise<GatewayFrame>((resolve: (frame: GatewayFrame) => void, reject: (error: Error) => void) => {
      this.pendingSequence += 1;
      const pendingKey: string = 'pending-' + this.pendingSequence;
      let transferId: string = '';
      let offset: number = -1;
      let rpcId: string = '';
      let wireRequestId: string = '';
      let itemId: string = '';
      let command: string = '';
      try {
        const payload = JSON.parse(request.payload) as RequestPayload;
        transferId = payload.transferId ?? '';
        offset = payload.offset ?? -1;
        rpcId = payload.rpcId ?? '';
        wireRequestId = payload.requestId ?? '';
        itemId = payload.itemId ?? '';
        command = payload.command ?? '';
      } catch (err) { }
      const timer: number = setTimeout(() => {
        const pending: PendingRequest | undefined = this.pending.get(pendingKey);
        if (pending === undefined) return;
        this.pending.delete(pendingKey);
        reject(new Error('timeout: ' + request.responseKind));
      }, request.timeoutMilliseconds ?? timeoutMs);
      this.pending.set(pendingKey, { id: wireRequestId.length > 0 ? wireRequestId : pendingKey,
        matchType: request.responseKind, hasRequestId: wireRequestId.length > 0,
        requestType: request.requestType, transferId: transferId, offset: offset, rpcId: rpcId,
        sessionId: request.targetSessionId ?? '', correlationId: request.correlationId,
        itemId: itemId, command: command, resolve: resolve, reject: reject, timer: timer });
      if (!this.send(request.payload)) {
        clearTimeout(timer); this.pending.delete(pendingKey); reject(new Error('send failed'));
      }
    });
  }

  /**
   * 只读预览任意会话记录（对齐小程序 inspectSession）。
   *
   * 刻意不走 lane、也不在超时后 failSocket：
   * 预览是旁路操作，不能挤掉当前会话正在飞的历史/订阅请求，也不能因为目标会话
   * 不存在就把整条连接打断。
   */
  inspectSession(sessionId: string, parentSessionId?: string, mode?: string): Promise<GatewayFrame> {
    if (!this.isConnected()) {
      return Promise.reject(new Error('not connected'));
    }
    const request: GatewayRequest = GatewayRequestFactory.inspectHistory(sessionId, parentSessionId, mode);
    request.timeoutIsFatal = false;
    return this.sendCorrelated(request, 8000);
  }

  ping(timeoutMs: number = 8000): Promise<GatewayFrame> {
    return this.enqueueRequest(GatewayRequestFactory.ping(), timeoutMs);
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
    this.request(GatewayRequests.history(sessionId), 'history').catch((error: Error) => Logger.warn(error.message));
    this.requestGateway(GatewayRequestFactory.subscribe(sessionId)).catch((error: Error) => Logger.warn(error.message));
    const queue = GatewayRequestFactory.make('session-queue', 'session-queue', { 'sessionId': sessionId }, sessionId);
    this.requestGateway(queue).catch((error: Error) => Logger.warn(error.message));
    this.requestContextPanels(sessionId);
    // 每会话运行模式（Agent 预设）：与 dsh-mobile 一致，打开会话时问一次
    const preset = GatewayRequestFactory.make('session-agent-preset', 'session-agent-preset', { 'sessionId': sessionId }, sessionId);
    this.requestGateway(preset).catch((error: Error) => Logger.warn(error.message));
  }

  /** 新建会话：返回 sessionId。 */
  createSession(workspaceId: string, agentPreset: string = ''): Promise<string> {
    return new Promise<string>((resolve: (id: string) => void, reject: (error: Error) => void) => {
      if (!this.isConnected()) {
        reject(new Error('未连接网关'));
        return;
      }
      this.requestGateway(GatewayRequestFactory.createSession('session-create-' + (++this.requestSeq), workspaceId, agentPreset), 15000).then((result: GatewayFrame) => {
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
    return this.sendRequest(GatewayRequestFactory.renameSession(sessionId, title));
  }

  archiveSession(sessionId: string): boolean {
    return this.sendRequest(GatewayRequestFactory.archiveSession(sessionId));
  }

  /** 部署级默认配置（Agent 预设 / 模型 / 权限）。 */
  requestDefaults(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    return this.sendRequest(GatewayRequestFactory.simple('defaults'));
  }

  /**
   * 模型目录。
   * 带上 sessionId 才会拿到该会话的 current（当前模型）——网关无 sessionId 时只返回全局目录。
   */
  requestModelsCatalog(sessionId?: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    if (sessionId !== undefined && sessionId.length > 0) {
      return this.sendRequest(GatewayRequestFactory.make('models', 'models', { 'sessionId': sessionId }, sessionId));
    }
    return this.sendRequest(GatewayRequestFactory.simple('models'));
  }

  /** Agent 预设目录。 */
  requestAgentPresets(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    return this.sendRequest(GatewayRequestFactory.simple('agent-presets'));
  }

  /** 权限选项。 */
  requestPermissionOptions(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    return this.sendRequest(GatewayRequestFactory.simple('permission-options'));
  }

  /** 目录浏览（添加工作区用）。 */
  requestDirectories(path: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    const fields: Record<string, Object> = {};
    if (path.length > 0) fields['path'] = path;
    return this.sendRequest(GatewayRequestFactory.make('directories', 'directories', fields));
  }

  /** 新建目录。 */
  createDirectory(path: string, name: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    return this.sendRequest(GatewayRequestFactory.make('directory-create', 'directory-create', { 'path': path, 'name': name }, undefined, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY));
  }

  /** 把目录添加为工作区。 */
  createWorkspace(path: string): boolean {
    if (!this.isConnected()) {
      return false;
    }
    return this.sendRequest(GatewayRequestFactory.make('workspace-create', 'workspace-create', { 'path': path }, undefined, undefined, GatewayRequestLanePolicy.REJECT_IF_BUSY));
  }

  /** 拉自动化任务目录。 */
  requestScheduleCatalog(): boolean {
    return this.sendRequest(GatewayRequestFactory.scheduleCatalog());
  }

  /** 启用/停用自动化任务。 */
  setScheduleEnabled(id: string, enabled: boolean): boolean {
    if (!this.isConnected()) {
      return false;
    }
    this.pluginRequestSeq += 1;
    const request: GatewayRequest = GatewayRequestFactory.make('schedule-update', 'schedule-update', {
      'requestId': 'schedule-toggle-' + this.pluginRequestSeq, 'id': id, 'enabled': enabled
    }, undefined, 'schedule-toggle-' + this.pluginRequestSeq, GatewayRequestLanePolicy.REJECT_IF_BUSY);
    return this.sendRequest(request);
  }

  /** 请求可配置的模型提供商列表。 */
  requestProviders(): Promise<GatewayFrame> {
    return this.requestGateway(GatewayRequestFactory.providers(), 15000);
  }

  /** 读取 llm 插件命名空间（模型配置）。 */
  /**
   * 通用插件请求（对齐小程序 requestPlugin）：type 即帧类型，响应 kind 由网关决定。
   * 语音输入用到的三种：speech-catalog→speech-catalog、speech-transcribe→speech-transcript、
   * speech-cancel→speech-cancelled。
   */
  requestPlugin(type: string, payload: Record<string, Object>, timeoutMs: number = 15000): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    const requestId: string = 'plugin-' + this.pluginRequestSeq;
    const fields: Record<string, Object> = { 'requestId': requestId };
    const keys: string[] = Object.keys(payload);
    for (const key of keys) {
      if (key !== 'type' && key !== 'requestId') {
        fields[key] = payload[key];
      }
    }
    const expectedKind: string = type === 'speech-transcribe' ? 'speech-transcript'
      : (type === 'speech-cancel' ? 'speech-cancelled' : type);
    // 插件请求（尤其语音）在插件未安装/未连接时可能永远不回执，
    // 不能因为超时就把整条网关连接打断。
    const request: GatewayRequest = GatewayRequestFactory.make(type, expectedKind, fields, undefined, requestId,
      GatewayRequestLanePolicy.REJECT_IF_BUSY, timeoutMs);
    request.timeoutIsFatal = false;
    return this.requestGateway(request, timeoutMs);
  }

  requestPluginSettings(ns: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginSettings(ns, 'plugin-settings-' + this.pluginRequestSeq), 15000);
  }

  /** 自动获取可用模型（对齐小程序 discoverModels）。 */
  discoverModels(ns: string, provider: string, baseURL: string, api: string, apiKey: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(
      GatewayRequestFactory.modelDiscover(ns, provider, baseURL, api, apiKey, 'llm-discover-' + this.pluginRequestSeq), 30000);
  }

  /** 提交 ops 变更（模型增删改，对齐小程序 plugin-settings-mutate）。 */
  mutatePluginSettings(ns: string, expectedRevision: number, ops: Object[]): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(
      GatewayRequestFactory.pluginSettingsMutate(ns, expectedRevision, ops, 'plugin-settings-mutate-' + this.pluginRequestSeq), 20000);
  }

  /** 拉插件目录。 */
  requestPlugins(): boolean {
    if (!this.isConnected()) {
      return false;
    }
    let seq: number = 1;
    this.pluginRequestSeq += 1;
    seq = this.pluginRequestSeq;
    const sent: boolean = this.sendRequest(GatewayRequestFactory.pluginCatalog('plugin-' + seq));
    Logger.info('requestPlugins connected=' + this.isConnected() + ' sent=' + sent);
    return sent;
  }

  /** 启用/停用插件。 */
  setPluginEnabled(name: string, enabled: boolean): boolean {
    if (!this.isConnected()) {
      return false;
    }
    this.pluginRequestSeq += 1;
    return this.sendRequest(GatewayRequestFactory.pluginBundleSetEnabled('plugin-toggle-' + this.pluginRequestSeq, name, enabled));
  }

  /** 插件详情（plugin-detail） */
  requestPluginDetail(name: string, language: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginDetail('plugin-detail-' + this.pluginRequestSeq, name, language), 20000);
  }

  /** 插件可用版本（plugin-versions） */
  requestPluginVersions(name: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginVersions('plugin-versions-' + this.pluginRequestSeq, name), 20000);
  }

  /** 更新插件（plugin-update） */
  updatePlugin(name: string, version: string, registry?: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginUpdate('plugin-update-' + this.pluginRequestSeq, name, version, registry), 600000);
  }

  /** 安装前检查（plugin-inspect） */
  inspectPlugin(spec: string, registry?: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginInspect('plugin-inspect-' + this.pluginRequestSeq, spec, registry), 60000);
  }

  /** 安装插件（plugin-install） */
  installPlugin(spec: string, registry: string | null, enable: boolean): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginInstall('plugin-install-' + this.pluginRequestSeq, spec, registry, enable), 600000);
  }

  /** 卸载插件（plugin-remove，旧网关回退 plugin-uninstall） */
  removePlugin(name: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginRemove('plugin-remove-' + this.pluginRequestSeq, name), 120000)
      .catch((error: Error) => {
        Logger.warn('plugin-remove failed, fallback: ' + error.message);
        this.pluginRequestSeq += 1;
        return this.requestGateway(GatewayRequestFactory.pluginUninstall('plugin-uninstall-' + this.pluginRequestSeq, name), 120000);
      });
  }

  /** 查询安装状态（plugin-install-status） */
  requestPluginInstallStatus(installId: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginInstallStatus('plugin-install-status-' + this.pluginRequestSeq, installId), 600000);
  }

  /** 取消安装（plugin-install-cancel） */
  cancelPluginInstall(installId: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginInstallCancel('plugin-install-cancel-' + this.pluginRequestSeq, installId), 60000);
  }

  /** 读取凭据状态（plugin-credential-describe） */
  describePluginCredential(ref: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginCredentialDescribe('plugin-credential-describe-' + this.pluginRequestSeq, ref), 20000);
  }

  /** 写入凭据（plugin-credential-set） */
  setPluginCredential(ref: string, secret: string): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginCredentialSet('plugin-credential-set-' + this.pluginRequestSeq, ref, secret), 30000);
  }

  /** 组件级启用/停用（plugin-entry-set-enabled） */
  setPluginEntryEnabled(entryId: string, enabled: boolean): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginEntrySetEnabled('plugin-entry-' + this.pluginRequestSeq, entryId, enabled), 20000);
  }

  /** 插件市场索引源 */
  requestMarketIndexes(): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginMarketIndexes('plugin-market-indexes-' + this.pluginRequestSeq), 20000);
  }

  /** 插件市场搜索 */
  searchMarket(indexUrl: string, query: string, category: string, cursor: string, limit: number): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginMarketSearch('plugin-market-search-' + this.pluginRequestSeq,
      indexUrl, query, category, cursor, limit), 30000);
  }

  /** 写入插件市场索引源 */
  setMarketIndexes(indexes: Object[]): Promise<GatewayFrame> {
    this.pluginRequestSeq += 1;
    return this.requestGateway(GatewayRequestFactory.pluginMarketSetIndexes('plugin-market-set-' + this.pluginRequestSeq, indexes), 20000);
  }

  /** 分页加载更早历史（beforeSeq 之前）。 */
  requestOlderHistory(sessionId: string, beforeSeq: number, historyFormatVersion: number): boolean {
    const frame: Record<string, Object> = {
      'type': 'history',
      'sessionId': sessionId,
      'beforeSeq': beforeSeq,
      'maxMessages': 30,
      'maxBytes': 262144,
      'view': 'conversation'
    };
    if (historyFormatVersion > 0) frame['historyFormatVersion'] = historyFormatVersion;
    return this.send(JSON.stringify(frame));
  }

  /** Read the remote file list for the active session workspace. */
  requestFileList(sessionId: string, path?: string): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const request: GatewayRequest = GatewayRequestFactory.fileList(sessionId, path, 'file-list-' + this.requestSeq);
    return this.enqueueRequest(request, 30000);
  }

  /** Open a validated remote file download transfer. */
  openFileDownload(sessionId: string, path: string): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const request: GatewayRequest = GatewayRequestFactory.fileDownloadOpen(sessionId, path, 'file-download-open-' + this.requestSeq);
    return this.enqueueRequest(request, 30000);
  }

  /** Read the next bounded base64 chunk from a download transfer. */
  readFileDownload(transferId: string, offset: number): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'file-download-read', 'requestId': 'file-download-read-' + this.requestSeq,
      'transferId': transferId, 'offset': offset
    };
    return this.request(JSON.stringify(frame), 'file-download-chunk', 30000);
  }

  cancelFileDownload(transferId: string): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'file-download-cancel', 'requestId': 'file-download-cancel-' + this.requestSeq,
      'transferId': transferId
    };
    return this.request(JSON.stringify(frame), 'file-download-cancelled', 10000);
  }

  /** Start an upload; caller must validate name, size and digest before invoking. */
  openFileUpload(sessionId: string, name: string, size: number, sha256: string, mediaType: string = ''): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'file-upload-open', 'requestId': 'file-upload-open-' + this.requestSeq,
      'sessionId': sessionId, 'name': name, 'size': size, 'sha256': sha256
    };
    if (mediaType.length > 0) frame['mediaType'] = mediaType;
    return this.request(JSON.stringify(frame), 'file-upload-opened', 30000);
  }

  /** Send one sequential base64 upload chunk and require nextOffset from the caller. */
  uploadFileChunk(sessionId: string, uploadId: string, offset: number, data: string): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'file-upload-chunk', 'requestId': 'file-upload-chunk-' + this.requestSeq,
      'sessionId': sessionId, 'uploadId': uploadId, 'offset': offset, 'data': data
    };
    return this.request(JSON.stringify(frame), 'file-upload-chunk-accepted', 30000);
  }

  finishFileUpload(sessionId: string, uploadId: string): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'file-upload-finish', 'requestId': 'file-upload-finish-' + this.requestSeq,
      'sessionId': sessionId, 'uploadId': uploadId
    };
    return this.request(JSON.stringify(frame), 'file-upload-completed', 60000);
  }

  cancelFileUpload(sessionId: string, uploadId: string): Promise<GatewayFrame> {
    this.requestSeq += 1;
    const frame: Record<string, Object> = {
      'type': 'file-upload-cancel', 'requestId': 'file-upload-cancel-' + this.requestSeq,
      'sessionId': sessionId, 'uploadId': uploadId
    };
    return this.request(JSON.stringify(frame), 'file-upload-cancelled', 10000);
  }

  /** 拉上下文面板与编队快照。 */
  requestContextPanels(sessionId: string): void {
    this.sendRequest(GatewayRequestFactory.sessionControl('context-dashboard', sessionId));
    this.sendRequest(GatewayRequestFactory.sessionControl('context-fleet', sessionId));
    this.sendRequest(GatewayRequestFactory.sessionControl('context-usage', sessionId));
  }

  requestQueue(sessionId: string): Promise<GatewayFrame> {
    const frame: Record<string, Object> = { 'type': 'session-queue', 'sessionId': sessionId };
    return this.request(JSON.stringify(frame), 'session-queue', 10000, true);
  }

  /** action: steer（立刻发送）/ remove（删除）。 */
  queueUpdate(sessionId: string, itemId: string, action: string): boolean {
    return this.sendRequest(GatewayRequestFactory.queueUpdate(sessionId, itemId, action));
  }

  /** 队列操作并等待回执：页面据此立刻反馈成功/失败（失败要把本地乐观删掉的行恢复回来）。 */
  queueUpdateAndWait(sessionId: string, itemId: string, action: string): Promise<GatewayFrame> {
    return this.requestGateway(GatewayRequestFactory.queueUpdate(sessionId, itemId, action), 10000);
  }

  /** 会话任务列表（todo_write 投影）：对齐小程序 client.requestTasks。 */
  requestTasks(sessionId: string): Promise<GatewayFrame> {
    const frame: Record<string, Object> = { 'type': 'tasks', 'sessionId': sessionId };
    return this.request(JSON.stringify(frame), 'tasks', 10000, true);
  }

  /** 会话目标快照：对齐小程序 client.requestGoal。 */
  requestGoal(sessionId: string): Promise<GatewayFrame> {
    const frame: Record<string, Object> = { 'type': 'goal', 'sessionId': sessionId };
    return this.request(JSON.stringify(frame), 'goal', 10000, true);
  }

  /** 就地编辑目标（compare-and-set：带当前 revision）。 */
  goalEdit(sessionId: string, reference: GatewayGoalReference, objective: string): boolean {
    return this.sendRequest(GatewayRequestFactory.editGoal(sessionId, reference, objective));
  }

  /** 暂停 / 继续 / 清除目标。 */
  goalAction(type: string, sessionId: string, reference: GatewayGoalReference): boolean {
    return this.sendRequest(GatewayRequestFactory.goalAction(type, sessionId, reference));
  }

  sendUserMessage(text: string, sessionId: string): boolean {
    if (!this.isConnected()) return false;
    const request: GatewayRequest = GatewayRequestFactory.message(text, [], sessionId, undefined, 'Asia/Shanghai');
    // 乐观置为「运行中」：turns 可能要几百毫秒才回第一帧事件，
    // 这段时间里首页列表不该还显示「已完成」。
    SessionStore.get().notifySessionStarted(sessionId);
    // 立即本地回显（对齐小程序 appendLocalUserRow）：不等网关 echo
    SessionStore.get().appendOptimisticUser(text, 0);
    this.requestGateway(request, 60000).catch((error: Error) => Logger.warn('message request failed: ' + error.message));
    return true;
  }

  sendUserMessageWithAttachments(text: string, sessionId: string, files: Object[]): Promise<GatewayFrame> {
    SessionStore.get().notifySessionStarted(sessionId);
    SessionStore.get().appendOptimisticUser(text, files.length);
    this.requestSeq += 1;
    const requestId: string = 'message-' + this.requestSeq;
    const payload: Record<string, Object> = { 'type': 'message', 'requestId': requestId, 'sessionId': sessionId,
      'text': text, 'images': [], 'attachments': [], 'files': files, 'clientTimeZone': 'Asia/Shanghai' };
    return this.request(JSON.stringify(payload), 'sent', 60000);
  }

  cancelSession(sessionId: string): boolean {
    return this.sendRequest(GatewayRequestFactory.sessionCancel(sessionId));
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.connectionGeneration++;
    this.rejectPending('连接已断开，请重试');
    SessionStore.get().clearPendingPrompts();
    this.intentionalClose = true;
    this.reconnectEnabled = false;
    this.clearTailnetSwitchTimer();
    if (this.reconnectTimer !== 0) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
    const socket: webSocket.WebSocket | null = this.ws;
    this.ws = null;
    if (socket !== null) {
      try {
        socket.off('open');
        socket.off('message');
        socket.off('close');
        socket.off('error');
        socket.close();
      } catch (err) {
        Logger.warn('disconnect error: ' + JSON.stringify(err));
      }
    }
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
    if (frame.kind === 'paired' && (!this.handshakeNeedsPair || frame.token === undefined || frame.token.length === 0)) {
      Logger.warn('gateway paired frame rejected: missing valid pairing token');
      return;
    }
    this.publishHello(frame);
    if (frame.kind === 'paired') {
      this.handshakePaired = true;
    }
    if (frame.kind === 'hello') {
      this.handshakeHello = true;
      // auto plugin catalog: 握手成功后自动拉取插件目录（对齐小程序连接后 refreshPlugins）
      setTimeout(() => {
        this.requestPlugins();
      }, 600);
    }
    this.settlePending(frame);
    if (frame.kind === 'session-created' || frame.kind === 'session-renamed' || frame.kind === 'session-archived') {
      this.send(GatewayRequests.sessions());
    }
    PluginStore.get().consume(frame);
    ScheduleStore.get().consume(frame);

    // 配对成功：保存服务端下发的长期 token（直连）或 accessToken（中继）。
    if (frame.kind === 'paired') {
      const token: string = frame.token !== undefined ? frame.token : '';
      if (token.length > 0 && this.currentProfile !== null) {
        this.currentProfile.token = token;
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
    this.notifyBackground(frame);
    this.maybeActivate();
  }

  private notifyBackground(frame: GatewayFrame): void {
    const lifecycle: string = AppStorage.get<string>('appLifecycle') ?? 'foreground';
    if (lifecycle !== 'background') return;
    let title: string = '';
    let body: string = '';
    if (frame.kind === 'approval-requested') {
      title = '需要批准';
      body = frame.toolName ?? '网关请求了工具批准';
    } else if (frame.kind === 'question-requested') {
      title = '需要回答';
      body = '会话有一个问题等待你的选择';
    } else if (frame.kind === 'event' && frame.event !== undefined && frame.event.type === 'turn/end') {
      title = '会话已完成';
      body = '网关中的任务已经结束';
    }
    if (title.length > 0) {
      const sessionId: string = frame.sessionId ?? '';
      AppStorage.setOrCreate('notifySessionId', sessionId);
      AppStorage.setOrCreate('notifyTitle', title);
      AppStorage.setOrCreate('notifyBody', body);
      AppStorage.setOrCreate('notifyRequestId', 7001);
      const ctx: common.UIAbilityContext | undefined = AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
      if (ctx !== undefined) {
        NotificationService.publishSessionUpdate(ctx, title, body, sessionId, 7001).catch(() => { });
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
      Logger.warn('PERSIST_SKIP_NULL_PROFILE');
      return;
    }
    if (this.isTailnetAddress(profile.wsUrl) && profile.wsUrl.indexOf('.ts.net') < 0) {
      // 临时 tailnet IP 地址不写盘，避免污染已保存的入口
      return;
    }
    Logger.info('PERSIST_ENTER ws=' + profile.wsUrl + ' cached=' + CredentialStore.get().list().length);
    const relayNodeId: string = profile.relayNodeId !== undefined ? profile.relayNodeId : '';
    const gatewayId: string = relayNodeId.length > 0 ? relayNodeId : profile.wsUrl;
    const existing: SavedGateway | null = CredentialStore.get().list().find((item: SavedGateway) => item.id === gatewayId) ?? null;
    const gateway: SavedGateway = {
      id: gatewayId,
      name: AppStorage.get<string>('gatewayName') ?? this.pairingGatewayName,
      wsUrl: profile.wsUrl,
      // 保留全部候选地址，供网络类型变化时切换
      endpoints: this.allEndpoints.length > 0 ? this.allEndpoints.slice() : [profile.wsUrl],
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
    Logger.info('PERSIST_SAVED id=' + gateway.id + ' total=' + CredentialStore.get().list().length);
  }

  /** 使用已保存凭据自动重连（免扫码）。返回是否发起了连接。 */
  autoConnect(): boolean {
    const saved: SavedGateway | null = CredentialStore.get().load();
    if (saved === null) {
      return false;
    }
    this.ensureNetworkMonitor();
    // 清理历史遗留的无效入口（ws://100.x:3081），避免蜂窝切换后污染当前连接。
    // 只删除「所有候选都已失效」的记录：旧逻辑只要命中一个 100.x 候选就整条删除，
    // 会把还带着局域网 / *.ts.net / 公网地址的主机误删（表现为「连接记录自己消失」）。
    for (const one of CredentialStore.get().list()) {
      let valid: number = this.isTransientTailnetUrl(one.wsUrl) ? 0 : 1;
      const endpoints: string[] | undefined = one.endpoints;
      if (endpoints !== undefined) {
        for (const url of endpoints) {
          if (!this.isTransientTailnetUrl(url)) {
            valid += 1;
          }
        }
      }
      if (valid === 0) {
        Logger.warn('cleanup invalid saved gateway ' + one.wsUrl);
        CredentialStore.get().remove(one.id);
      }
    }
    const savedAfterClean: SavedGateway | null = CredentialStore.get().load();
    if (savedAfterClean === null) {
      return false;
    }
    // 免扫码重连能不能成功，取决于这条记录里还有没有可用的 token；
    // 打印长度便于下次直接从日志判断凭据是不是空的/被轮换过。
    Logger.info('auto connect credential: tokenLen=' + savedAfterClean.token.length
      + ' pairCodeLen=' + savedAfterClean.pairCode.length
      + ' accessTokenLen=' + savedAfterClean.accessToken.length);
    const candidates: string[] = (savedAfterClean.endpoints !== undefined && savedAfterClean.endpoints.length > 0
      ? savedAfterClean.endpoints.slice() : [savedAfterClean.wsUrl])
      .filter((url: string) => !this.isTransientTailnetUrl(url));
    this.allEndpoints = candidates;
    // 按当前网络类型决定先连局域网还是公网
    const ordered: string[] = this.orderEndpoints(candidates);
    const target: string = ordered.length > 0 ? ordered[0] : saved.wsUrl;
    Logger.info('auto connect endpoints=' + ordered.join(',') + ' bearer=' + this.networkBearer);
    // 保留候选地址用于失败切换（首个地址正在连接，pairIndex 从 1 开始）
    this.pairCandidates = ordered.slice();
    this.pairIndex = 1;
    const profile: GatewayProfile = {
      wsUrl: target,
      pairCode: saved.pairCode,
      leaseToken: '',
      inviteToken: saved.accessToken.length > 0 ? '' : saved.inviteToken,
      accessToken: saved.accessToken,
      token: saved.token,
      relayNodeId: saved.relayNodeId,
      relayAgentPubKey: saved.relayAgentPubKey
    };
    Logger.info('auto connect saved gateway ' + target);
    this.connect(profile, true);
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
    // 默认配置由 maybeActivate 在完成 paired/hello 握手后统一拉取。
    const version: string = frame.dshVersion !== undefined ? frame.dshVersion : '';
    const protocol: number = frame.protocol !== undefined ? frame.protocol : 0;
    AppStorage.setOrCreate<string>('gatewayVersion', version);
    AppStorage.setOrCreate<number>('gatewayProtocol', protocol);
  }

  private matchesPendingResponse(req: PendingRequest, frame: GatewayFrame): boolean {
    if (frame.kind === 'error') {
      if (frame.requestId !== undefined && frame.requestId.length > 0) return frame.requestId === req.id;
      if (frame.requestType !== req.requestType) return false;
      if (req.rpcId.length > 0) return frame.rpcId === req.rpcId;
      if (req.transferId.length > 0) return frame.transferId === req.transferId;
      if (req.correlationId !== undefined) return frame.itemId === req.correlationId;
      return frame.sessionId === undefined || req.sessionId === '' || frame.sessionId === req.sessionId;
    }
    if (frame.kind !== req.matchType) return false;
    if (frame.sessionId !== undefined && req.sessionId.length > 0 && frame.sessionId !== req.sessionId) return false;
    if (req.rpcId.length > 0) return frame.rpcId === req.rpcId;
    if (req.transferId.length > 0) {
      return frame.transferId === req.transferId && (req.offset < 0 || frame.offset === req.offset);
    }
    if (req.itemId !== undefined && req.itemId.length > 0) return frame.itemId === req.itemId;
    if (req.command !== undefined && req.command.length > 0) return typeof frame.command === 'string' && frame.command === req.command;
    if (req.hasRequestId) return frame.requestId === req.id;
    if (req.correlationId !== undefined && req.correlationId.length > 0) return frame.requestId === req.correlationId;
    return true;
  }

  private settlePending(frame: GatewayFrame): void {
    const matched: string[] = [];
    this.pending.forEach((req: PendingRequest, key: string) => {
      if (this.matchesPendingResponse(req, frame)) matched.push(key);
    });
    if (matched.length !== 1) return;
    const key: string = matched[0];
    const req: PendingRequest | undefined = this.pending.get(key);
    if (req === undefined) return;
    clearTimeout(req.timer);
    this.pending.delete(key);
    if (frame.kind === 'error') req.reject(new Error(frame.message ?? '网关请求失败'));
    else req.resolve(frame);
  }

  private publish(state: ConnectionState): void {
    this.state = state;
    AppStorage.setOrCreate<string>(KEY_CONNECTION, state as string);
  }
}