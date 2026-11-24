import { GatewayClient } from '../network/GatewayClient';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { arr, bool, field, num, str } from '../protocol/GatewayFrameCodec';
import { PreferencesStore } from '../common/PreferencesStore';
import { Logger } from '../common/Logger';

export interface ConnectorModuleDefinition {
  id: string;
  title: string;
  subtitle: string;
  tools: string[];
}

export const CONNECTOR_MODULES: ConnectorModuleDefinition[] = [
  { id: 'calendar', title: '日历', subtitle: '查询忙闲、创建日程', tools: ['calendar.busy', 'calendar.create'] },
  { id: 'reminders', title: '提醒事项', subtitle: '创建、查询提醒', tools: ['reminders.list', 'reminders.create'] },
  { id: 'location', title: '位置', subtitle: '当前位置（近似/精确）与地图', tools: ['location.current', 'location.precise', 'maps.search', 'maps.geocode', 'maps.directions', 'maps.open'] },
  { id: 'photos', title: '照片', subtitle: '系统选择器选一张照片', tools: ['photos.select'] },
  { id: 'music', title: '音乐', subtitle: '本机音乐搜索与播放控制', tools: ['music.search', 'music.state', 'music.play', 'music.pause', 'music.seek'] },
  { id: 'health', title: '健康', subtitle: '步数、睡眠等健康摘要', tools: ['health.daily-summary'] },
  { id: 'alarms', title: '闹钟', subtitle: '设置系统闹钟', tools: ['alarms.create', 'alarms.list', 'alarms.cancel'] },
];

/** 有写入副作用的工具：被中断时不能断言「没执行」，要回 outcome_unknown。 */
const WRITE_TOOLS: string[] = [
  'calendar.create', 'reminders.create', 'alarms.open-create',
  'maps.markers.create', 'maps.markers.update', 'maps.markers.delete',
  'music.play', 'music.pause', 'music.seek', 'music.play-library'
];

/** 这些中断原因对写操作意味着「结果未知」。 */
const OUTCOME_UNKNOWN_CODES: string[] = [
  'cancelled', 'user_action_required', 'device_disconnected',
  'tool_disabled', 'stale_lease', 'invocation_timeout'
];

const REGISTER_WAIT_MS: number = 10_000;
const STATUS_WAIT_MS: number = 5_000;
const DEFAULT_INVOKE_TIMEOUT_MS: number = 120_000;
const MAX_INVOKE_TIMEOUT_MS: number = 120_000;
const MAX_INVOCATION_JSON: number = 16_384;
const MAX_ID_LENGTH: number = 128;
const MAX_COMPLETED: number = 1024;

export interface ConnectorAdapter {
  id: string;
  available(): boolean;
  authorize(): Promise<boolean>;
  invoke(tool: string, args: Record<string, Object>): Promise<Object>;
  cancel(invocationId: string): void;
}

/** 同一模块下合并多个适配器（位置 + 地图共用 location 模块，maps.* 归 location）。 */
export class MergedConnectorAdapter implements ConnectorAdapter {
  private readonly mergedId: string;
  private readonly parts: ConnectorAdapter[];

  constructor(id: string, parts: ConnectorAdapter[]) {
    this.mergedId = id;
    this.parts = parts;
  }

  get id(): string {
    return this.mergedId;
  }

  available(): boolean {
    for (const part of this.parts) {
      if (!part.available()) {
        return false;
      }
    }
    return true;
  }

  async authorize(): Promise<boolean> {
    for (const part of this.parts) {
      if (!(await part.authorize())) {
        return false;
      }
    }
    return true;
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    for (const part of this.parts) {
      try {
        return await part.invoke(tool, args);
      } catch (err) {
        const message: string = err instanceof Error ? err.message : String(err);
        if (message !== 'tool_unsupported') {
          throw new Error(message);
        }
      }
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
    for (const part of this.parts) {
      try {
        part.cancel(invocationId);
      } catch (err) {
      }
    }
  }
}

export interface RegisteredConnectorModule {
  id: string;
  enabled: boolean;
  available: boolean;
  tools: string[];
}

interface ModulePayload {
  id: string;
  enabled: boolean;
  available: boolean;
  tools: string[];
}

interface RegisterFrame {
  type: string;
  version: number;
  requestId: string;
  capabilityRevision: number;
  platform?: string;
  modules: ModulePayload[];
  permissionChanges?: Record<string, boolean>;
}

interface StatusFrame {
  type: string;
  version: number;
  requestId: string;
}

interface ResultFrame {
  /** 宿主按 type 识别上行消息（device-tool-result / device-tool-cancelled），不是 kind */
  type: string;
  version: number;
  invocationId: string;
  connectionLeaseId: string;
  status?: string;
  result?: Object;
  error?: Record<string, string>;
}

/** 一次在途调用：登记网关下发的原始请求 + 截止计时。 */
interface PendingInvocation {
  invocationId: string;
  connectionLeaseId: string;
  tool: string;
  module: string;
  timeoutMs: number;
}

class DeviceConnectorsStore {
  private bound: boolean = false;
  private supported: boolean = false;
  private connected: boolean = false;
  private revision: number = 0;
  private lease: string = '';
  private adapters: Map<string, ConnectorAdapter> = new Map();
  private enabled: Map<string, boolean> = new Map();
  private queuedChanges: Map<string, boolean> = new Map();
  private registrationChanges: Record<string, boolean> = {};
  private registered: RegisteredConnectorModule[] = [];
  private permissions: Map<string, boolean> = new Map();
  private hostKey: string = '';

  private registrationRequest: string = '';
  private registrationTimer: number = -1;
  private statusRequest: string = '';
  private statusTimer: number = -1;
  private checkingRegistration: boolean = false;
  private permissionSyncSupported: boolean = false;
  private statusQuerySupported: boolean = false;
  private syncing: boolean = false;

  private pendingInvocation: PendingInvocation | undefined = undefined;
  private pendingTimer: number = -1;
  private completed: string[] = [];
  private selectingPhoto: boolean = false;

  /** 旧网关不认 platform=harmonyos，失败后降级不带 platform 再注册一次 */
  private omitPlatform: boolean = false;
  private retriedWithoutPlatform: boolean = false;

  bind(): void {
    if (this.bound) {
      return;
    }
    this.bound = true;
    GatewayClient.get().onFrame((frame: GatewayFrame) => this.handleFrame(frame));
    this.publish('disconnected');
    Logger.info('connectors bind');
  }

  registerAdapter(adapter: ConnectorAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.publishEnabled();
  }

  onConnected(): void {
    this.bind();
    this.supported = true;
    this.connected = true;
    this.lease = '';
    this.registered = [];
    this.permissions.clear();
    this.registrationRequest = '';
    this.statusRequest = '';
    this.syncing = false;
    this.registrationChanges = {};
    this.hostKey = AppStorage.get<string>('activeEndpoint') ?? '';
    this.loadEnabled();
    this.register();
    // hello/连接建立时刻注册帧偶尔会丢：自动补两次重试，避免用户每次都要手动点「重新注册」
    this.scheduleRegisterRetry(800);
    this.scheduleRegisterRetry(2600);
    this.scheduleRegisterRetry(6000);
  }

  onDisconnected(): void {
    this.connected = false;
    // 断线即撤销在途调用（不能等超时）；写类工具会回 outcome_unknown
    this.clearPending('device_disconnected');
    this.cancelRegistrationTimeout();
    this.cancelStatusCheck();
    this.lease = '';
    this.registered = [];
    this.permissions.clear();
    this.registrationRequest = '';
    // 已发出的开启补丁不在断线后重放，避免覆盖网关刚撤销的权限
    this.queuedChanges.clear();
    this.registrationChanges = {};
    this.syncing = false;
    this.permissionSyncSupported = false;
    this.statusQuerySupported = false;
    this.publish('disconnected');
  }

  /** 前台/后台切换：后台立即中断在途调用（照片选择器除外）。 */
  setForeground(active: boolean): void {
    if (active) {
      if (this.supported && this.connected) {
        this.refreshStatus();
      }
      return;
    }
    if (this.selectingPhoto) {
      // 系统选择器正在前台显示，切后台不能判成用户离开
      return;
    }
    this.clearPending('user_action_required');
  }

  /** 回到前台：补一次状态刷新 + 未注册时自动重试注册。 */
  onAppForeground(): void {
    this.loadEnabled();
    if (!this.supported) {
      return;
    }
    this.refreshStatus();
    if ((AppStorage.get<string>('connectorsState') ?? '') !== 'registered') {
      this.register();
      this.scheduleRegisterRetry(1200);
      this.scheduleRegisterRetry(3500);
    }
  }

  state(): string {
    return AppStorage.get<string>('connectorsState') ?? 'disconnected';
  }

  registeredModules(): RegisteredConnectorModule[] {
    return this.registered;
  }

  registeredToolCount(): number {
    let count: number = 0;
    this.registered.forEach((m: RegisteredConnectorModule) => {
      count += m.tools.length;
    });
    return count;
  }

  isAvailable(id: string): boolean {
    const adapter: ConnectorAdapter | undefined = this.adapters.get(id);
    return adapter !== undefined && adapter.available();
  }

  enabledMap(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    CONNECTOR_MODULES.forEach((m: ConnectorModuleDefinition) => {
      out[m.id] = this.enabled.get(m.id) === true;
    });
    return out;
  }

  async setEnabled(id: string, value: boolean): Promise<boolean> {
    if (!this.isAvailable(id)) {
      return false;
    }
    if (value) {
      const adapter: ConnectorAdapter | undefined = this.adapters.get(id);
      if (adapter === undefined || !(await adapter.authorize())) {
        AppStorage.setOrCreate<string>('connectorsNotice', '系统权限未允许，请在设置中检查');
        return false;
      }
    } else {
      // 关闭模块：在途调用立即作废（写操作回 outcome_unknown）
      this.clearPending('tool_disabled');
    }
    this.enabled.set(id, value);
    this.queuedChanges.set(id, value);
    this.persistEnabled();
    this.publishEnabled();
    this.register();
    return true;
  }

  refreshStatus(): void {
    if (!this.supported || !this.connected) {
      return;
    }
    if (!this.statusQuerySupported || this.statusRequest.length > 0 || this.pendingInvocation !== undefined) {
      return;
    }
    if ((AppStorage.get<string>('appLifecycle') ?? 'foreground') !== 'foreground') {
      // 后台不发查询
      return;
    }
    const requestId: string = this.uuid();
    this.statusRequest = requestId;
    this.checkingRegistration = true;
    const frame: StatusFrame = { type: 'device-tools-status', version: 1, requestId: requestId };
    if (!this.sendFrame(frame)) {
      this.statusFailed();
      return;
    }
    this.statusTimer = setTimeout(() => {
      if (this.statusRequest === requestId) {
        this.statusFailed();
      }
    }, STATUS_WAIT_MS);
  }

  retryRegister(): void {
    if (!this.supported) {
      return;
    }
    this.register();
  }

  // ==================== 登记 ====================

  private register(): void {
    if (!this.supported || !this.connected) {
      return;
    }
    this.cancelRegistrationTimeout();
    this.cancelStatusCheck();
    this.clearSnapshot();
    this.revision += 1;
    const requestId: string = this.uuid();
    this.registrationRequest = requestId;
    this.publish('registering');
    const modules: ModulePayload[] = [];
    CONNECTOR_MODULES.forEach((m: ConnectorModuleDefinition) => {
      const available: boolean = this.isAvailable(m.id);
      const row: ModulePayload = {
        id: m.id,
        enabled: this.enabled.get(m.id) === true,
        available: available,
        tools: available ? m.tools : []
      };
      modules.push(row);
    });
    const changes: Record<string, boolean> = {};
    let changeCount: number = 0;
    this.queuedChanges.forEach((value: boolean, key: string) => {
      changes[key] = value;
      changeCount += 1;
    });
    const frame: RegisterFrame = {
      type: 'device-tools-register',
      version: 1,
      requestId: requestId,
      capabilityRevision: this.revision,
      modules: modules
    };
    if (!this.omitPlatform) {
      frame.platform = 'harmonyos';
    }
    if (changeCount > 0) {
      frame.permissionChanges = changes;
      this.queuedChanges.clear();
      this.registrationChanges = changes;
      this.syncing = true;
    }
    if (!this.sendFrame(frame)) {
      this.registrationFailed('failed');
      return;
    }
    Logger.info('connectors register revision=' + this.revision.toString() + ' changes=' + changeCount.toString());
    this.registrationTimer = setTimeout(() => {
      if (this.registrationRequest === requestId) {
        this.registrationFailed('failed');
      }
    }, REGISTER_WAIT_MS);
  }

  private registrationFailed(state: string): void {
    this.cancelRegistrationTimeout();
    this.registrationRequest = '';
    this.registrationChanges = {};
    this.syncing = false;
    this.clearSnapshot();
    this.publish(state);
  }

  private cancelRegistrationTimeout(): void {
    if (this.registrationTimer >= 0) {
      clearTimeout(this.registrationTimer);
      this.registrationTimer = -1;
    }
  }

  private statusFailed(): void {
    this.cancelStatusCheck();
    this.clearSnapshot();
    this.publish('unverified');
  }

  private cancelStatusCheck(): void {
    if (this.statusTimer >= 0) {
      clearTimeout(this.statusTimer);
      this.statusTimer = -1;
    }
    this.statusRequest = '';
    this.checkingRegistration = false;
  }

  private clearSnapshot(): void {
    this.registered = [];
  }

  // ==================== 帧处理 ====================

  private handleFrame(frame: GatewayFrame): void {
    const kind: string = frame.kind;
    if (kind === 'hello') {
      // 问候帧决定网关注册能力；有 device-tools-v1 才能逐模块登记
      const caps: Object[] | undefined = arr(frame, 'capabilities');
      let supported: boolean = false;
      if (caps !== undefined) {
        caps.forEach((cap: Object) => {
          if (cap === 'device-tools-v1') {
            supported = true;
          }
        });
      }
      this.supported = supported;
      Logger.info('connectors hello supported=' + supported.toString());
      if (supported) {
        this.onConnected();
      } else {
        this.connected = false;
        this.publish('unsupported');
      }
      return;
    }
    if (kind === 'device-tools-registered') {
      this.onRegistered(frame);
      return;
    }
    if (kind === 'device-tools-status') {
      this.onStatus(frame);
      return;
    }
    if (kind === 'device-tools-permissions') {
      const lease: string = str(frame, 'connectionLeaseId') ?? '';
      if (this.lease.length > 0 && lease === this.lease) {
        this.acceptPermissions(frame);
        this.publishEnabled();
      }
      return;
    }
    if (kind === 'device-tool-invoke') {
      this.onInvoke(frame);
      return;
    }
    if (kind === 'device-tool-cancel') {
      const lease: string = str(frame, 'connectionLeaseId') ?? '';
      const invocationId: string = str(frame, 'invocationId') ?? '';
      if (this.lease.length > 0 && lease === this.lease
        && this.pendingInvocation !== undefined
        && this.pendingInvocation.invocationId === invocationId) {
        this.clearPending('cancelled');
      }
      return;
    }
    if (kind === 'error') {
      const requestType: string = str(frame, 'requestType') ?? '';
      const code: string = str(frame, 'code') ?? '';
      const requestId: string = str(frame, 'requestId') ?? '';
      Logger.info('connectors error requestType=' + requestType + ' code=' + code);
      if (requestType === 'device-tools-status' && this.statusRequest.length > 0 && requestId === this.statusRequest) {
        this.statusFailed();
        return;
      }
      if (requestType === 'device-tools-register') {
        if (code === 'invalid_request' && !this.retriedWithoutPlatform) {
          // 老网关只接受 android/ios：去掉 platform 重试一次
          this.retriedWithoutPlatform = true;
          this.omitPlatform = true;
          Logger.info('connectors retry without platform');
          this.register();
          return;
        }
        if (code === 'unsupported-version' || code === 'invalid_request') {
          this.registrationFailed('unsupported');
        } else {
          this.registrationFailed('failed');
        }
      }
    }
  }

  private onRegistered(frame: GatewayFrame): void {
    if (this.registrationRequest.length === 0) {
      return;
    }
    if ((str(frame, 'requestId') ?? '') !== this.registrationRequest) {
      return;
    }
    if ((num(frame, 'capabilityRevision') ?? -1) !== this.revision) {
      return;
    }
    const lease: string = str(frame, 'connectionLeaseId') ?? '';
    if (lease.length === 0) {
      return;
    }
    const attemptedSync: boolean = Object.keys(this.registrationChanges).length > 0;
    this.cancelRegistrationTimeout();
    this.registrationRequest = '';
    this.registrationChanges = {};
    this.syncing = false;
    const previousLease: string = this.lease;
    this.lease = lease;
    this.permissionSyncSupported = bool(frame, 'permissionSync') === true;
    this.statusQuerySupported = bool(frame, 'statusQuery') === true;
    AppStorage.setOrCreate<boolean>('connectorsPermissionSync', this.permissionSyncSupported);
    AppStorage.setOrCreate<boolean>('connectorsStatusQuery', this.statusQuerySupported);
    AppStorage.setOrCreate<string>('connectorsSyncNotice',
      attemptedSync && !this.permissionSyncSupported ? 'gateway_update_required' : '');
    this.acceptPermissions(frame);
    if (!this.acceptModules(frame)) {
      // 回执里的模块清单非法：保持「未确认」，不用手机声明的能力推断成功
      this.clearSnapshot();
      this.publish('unverified');
      return;
    }
    if (previousLease.length > 0 && previousLease !== lease) {
      // 换了租约：上一代租约上的调用一律作废
      this.clearPending('stale_lease');
    }
    AppStorage.setOrCreate<number>('connectorsConfirmedAt', Date.now());
    this.publish('registered');
    Logger.info('connectors registered tools=' + this.registeredToolCount().toString());
  }

  private onStatus(frame: GatewayFrame): void {
    if (this.statusRequest.length === 0) {
      return;
    }
    if ((str(frame, 'requestId') ?? '') !== this.statusRequest) {
      return;
    }
    const status: string = str(frame, 'status') ?? '';
    if (status === 'not-registered') {
      this.cancelStatusCheck();
      this.clearPending('stale_lease');
      this.lease = '';
      this.clearSnapshot();
      this.publish('unverified');
      return;
    }
    if (status !== 'registered') {
      return;
    }
    const lease: string = str(frame, 'connectionLeaseId') ?? '';
    if (lease.length === 0 || lease !== this.lease) {
      return;
    }
    if ((num(frame, 'capabilityRevision') ?? -1) !== this.revision) {
      return;
    }
    this.cancelStatusCheck();
    this.acceptPermissions(frame);
    if (!this.acceptModules(frame)) {
      this.clearSnapshot();
      this.publish('unverified');
      return;
    }
    AppStorage.setOrCreate<number>('connectorsConfirmedAt', Date.now());
    this.publish('registered');
  }

  /** 回执里的模块清单：id 必须已知、不重复、布尔字段齐全、工具必须是本机声明过的子集。 */
  private acceptModules(frame: GatewayFrame): boolean {
    const rows: Object[] | undefined = arr(frame, 'modules');
    if (rows === undefined) {
      return false;
    }
    if (rows.length > CONNECTOR_MODULES.length) {
      return false;
    }
    const accepted: RegisteredConnectorModule[] = [];
    for (const raw of rows) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return false;
      }
      const rec: Record<string, Object> = raw as Record<string, Object>;
      const id: string = str(rec, 'id') ?? '';
      if (this.moduleDefinition(id) === undefined) {
        return false;
      }
      for (const one of accepted) {
        if (one.id === id) {
          return false;
        }
      }
      const enabledRaw: Object | undefined = rec['enabled'];
      const availableRaw: Object | undefined = rec['available'];
      if (typeof enabledRaw !== 'boolean' || typeof availableRaw !== 'boolean') {
        return false;
      }
      const toolsRaw: Object[] | undefined = arr(rec, 'tools');
      if (toolsRaw === undefined) {
        return false;
      }
      const declared: string[] = this.moduleTools(id);
      const names: string[] = [];
      for (const toolRaw of toolsRaw) {
        if (typeof toolRaw !== 'string') {
          return false;
        }
        const tool: string = toolRaw as string;
        if (declared.indexOf(tool) < 0 || names.indexOf(tool) >= 0) {
          return false;
        }
        names.push(tool);
      }
      accepted.push({
        id: id,
        enabled: enabledRaw as boolean,
        available: availableRaw as boolean,
        tools: names
      });
    }
    this.registered = accepted;
    return true;
  }

  private acceptPermissions(frame: GatewayFrame): void {
    const raw: Object | undefined = field(frame, 'permissions');
    if (raw === undefined || raw === null || Array.isArray(raw)) {
      return;
    }
    const rec: Record<string, Object> = raw as Record<string, Object>;
    this.permissions.clear();
    Object.keys(rec).forEach((key: string) => {
      const value: Object = rec[key];
      if (typeof value === 'boolean') {
        this.permissions.set(key, value as boolean);
      }
    });
  }

  // ==================== 调用闸门 ====================

  private onInvoke(frame: GatewayFrame): void {
    // ① 必须已协商、已连接，且租约匹配；否则静默丢弃（旧连接复活不能执行）
    if (!this.supported || !this.connected || this.lease.length === 0) {
      return;
    }
    if ((str(frame, 'connectionLeaseId') ?? '') !== this.lease) {
      Logger.info('connectors drop invoke: stale lease');
      return;
    }
    // ② 请求体合法性（版本/字段/长度/工具白名单/arguments 类型）
    const validation: string = this.validateInvocation(frame);
    if (validation.length > 0) {
      this.replyError(frame, validation);
      return;
    }
    const invocationId: string = str(frame, 'invocationId') ?? '';
    const tool: string = str(frame, 'tool') ?? '';
    const moduleId: string = this.toolModule(tool);
    // ③ 去重 + 单并发
    if (this.completed.indexOf(invocationId) >= 0) {
      return;
    }
    if (this.pendingInvocation !== undefined && this.pendingInvocation.invocationId === invocationId) {
      return;
    }
    if (this.pendingInvocation !== undefined) {
      this.replyError(frame, 'busy');
      return;
    }
    // ④ 三层权限：手机开关 + 网关设备权限
    if (this.enabled.get(moduleId) !== true || this.permissions.get(moduleId) !== true) {
      this.replyError(frame, 'tool_disabled');
      return;
    }
    // ⑤ 工具必须属于该模块且本机实现
    const adapter: ConnectorAdapter | undefined = this.adapters.get(moduleId);
    if (adapter === undefined || this.moduleTools(moduleId).indexOf(tool) < 0) {
      this.replyError(frame, 'tool_unsupported');
      return;
    }
    // ⑥ 系统权限
    if (!adapter.available()) {
      this.replyError(frame, 'permission_denied');
      return;
    }
    // ⑦ 必须前台（系统 API 只在前台可用）
    if ((AppStorage.get<string>('appLifecycle') ?? 'foreground') !== 'foreground') {
      this.replyError(frame, 'user_action_required');
      return;
    }
    const rawTimeout: number = num(frame, 'timeoutMs') ?? DEFAULT_INVOKE_TIMEOUT_MS;
    const timeoutMs: number = Math.min(Math.max(rawTimeout, 1), MAX_INVOKE_TIMEOUT_MS);
    const argsRaw: Object | undefined = field(frame, 'arguments');
    const args: Record<string, Object> = (argsRaw !== undefined && argsRaw !== null)
      ? argsRaw as Record<string, Object> : {};
    const pending: PendingInvocation = {
      invocationId: invocationId,
      connectionLeaseId: this.lease,
      tool: tool,
      module: moduleId,
      timeoutMs: timeoutMs
    };
    this.pendingInvocation = pending;
    this.selectingPhoto = tool === 'photos.select';
    this.pendingTimer = setTimeout(() => {
      if (this.pendingInvocation === pending) {
        this.clearPending('invocation_timeout');
      }
    }, timeoutMs);
    Logger.info('connectors invoke tool=' + tool + ' invocation=' + invocationId.slice(0, 8));
    adapter.invoke(tool, args).then((result: Object) => {
      this.finish(pending, result);
    }).catch((err: Error) => {
      if (this.pendingInvocation !== pending) {
        return;
      }
      const raw: string = (err !== undefined && err !== null && err.message !== undefined) ? err.message : 'device_error';
      // 只透传形如 permission_denied 的错误码，其它归为 device_error
      const code: string = /^[a-z_]{1,64}$/.test(raw) ? raw : 'device_error';
      Logger.warn('connectors invoke failed tool=' + tool + ' code=' + code);
      this.clearPending(code);
    });
  }

  private finish(pending: PendingInvocation, result: Object): void {
    if (this.pendingInvocation !== pending) {
      return;
    }
    if (pending.connectionLeaseId !== this.lease) {
      return;
    }
    if ((AppStorage.get<string>('appLifecycle') ?? 'foreground') !== 'foreground'
      && pending.tool !== 'photos.select') {
      // 结果产生时已经离开前台：按中断处理，避免把「用户不在」当成成功
      this.clearPending('user_action_required');
      return;
    }
    this.clearPendingState(pending.invocationId);
    this.remember(pending.invocationId);
    const out: ResultFrame = {
      type: 'device-tool-result',
      version: 1,
      invocationId: pending.invocationId,
      connectionLeaseId: pending.connectionLeaseId,
      status: 'success',
      result: result
    };
    this.sendFrame(out);
  }

  /** 中断在途调用：写操作回 outcome_unknown（不能断言未执行），其余原样回错误码。 */
  private clearPending(code: string): void {
    const pending: PendingInvocation | undefined = this.pendingInvocation;
    if (pending === undefined) {
      return;
    }
    const outcome: string = (WRITE_TOOLS.indexOf(pending.tool) >= 0
      && OUTCOME_UNKNOWN_CODES.indexOf(code) >= 0) ? 'outcome_unknown' : code;
    this.clearPendingState(pending.invocationId);
    this.remember(pending.invocationId);
    this.replyErrorById(pending.invocationId, pending.connectionLeaseId, outcome);
  }

  private clearPendingState(invocationId: string): void {
    this.pendingInvocation = undefined;
    this.selectingPhoto = false;
    if (this.pendingTimer >= 0) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = -1;
    }
    // 通知适配器释放该次调用的原生资源（选择器、录音、定位会话等）
    this.adapters.forEach((adapter: ConnectorAdapter) => {
      try {
        adapter.cancel(invocationId);
      } catch (err) {
      }
    });
  }

  private remember(invocationId: string): void {
    if (invocationId.length === 0 || this.completed.indexOf(invocationId) >= 0) {
      return;
    }
    this.completed.push(invocationId);
    while (this.completed.length > MAX_COMPLETED) {
      this.completed.shift();
    }
  }

  private replyError(frame: GatewayFrame, code: string): void {
    this.replyErrorById(str(frame, 'invocationId') ?? '', str(frame, 'connectionLeaseId') ?? '', code);
  }

  private replyErrorById(invocationId: string, lease: string, code: string): void {
    if (invocationId.length === 0) {
      return;
    }
    const error: Record<string, string> = { 'code': code };
    const frame: ResultFrame = {
      type: 'device-tool-result',
      version: 1,
      invocationId: invocationId,
      connectionLeaseId: lease.length > 0 ? lease : this.lease,
      status: 'error',
      error: error
    };
    this.sendFrame(frame);
  }

  /** 与网关共享的入参白名单校验：与 dsh-mobile 的 validateInvocationJson 等价。 */
  private validateInvocation(frame: GatewayFrame): string {
    let serialized: string = '';
    try {
      serialized = JSON.stringify(frame);
    } catch (err) {
      return 'invalid_request';
    }
    if (serialized.length > MAX_INVOCATION_JSON) {
      return 'invalid_request';
    }
    if ((num(frame, 'version') ?? -1) !== 1) {
      return 'invalid_request';
    }
    const invocationId: string = str(frame, 'invocationId') ?? '';
    const lease: string = str(frame, 'connectionLeaseId') ?? '';
    const tool: string = str(frame, 'tool') ?? '';
    const ids: string[] = [invocationId, lease, tool];
    for (const one of ids) {
      if (one.length === 0 || one.length > MAX_ID_LENGTH) {
        return 'invalid_request';
      }
    }
    if (this.toolModule(tool).length === 0) {
      return 'tool_unsupported';
    }
    const args: Object | undefined = field(frame, 'arguments');
    if (args === undefined || args === null || Array.isArray(args)) {
      return 'invalid_request';
    }
    return '';
  }

  // ==================== 模块/工具映射 ====================

  /** 工具名 → 模块 id（maps.* 归 location 模块）。未知工具返回空串。 */
  private toolModule(tool: string): string {
    if (tool.indexOf('maps.') === 0) {
      return 'location';
    }
    const dot: number = tool.indexOf('.');
    if (dot <= 0) {
      return '';
    }
    const moduleId: string = tool.substring(0, dot);
    return this.moduleDefinition(moduleId) !== undefined ? moduleId : '';
  }

  private moduleDefinition(id: string): ConnectorModuleDefinition | undefined {
    for (const m of CONNECTOR_MODULES) {
      if (m.id === id) {
        return m;
      }
    }
    return undefined;
  }

  private moduleTools(id: string): string[] {
    const definition: ConnectorModuleDefinition | undefined = this.moduleDefinition(id);
    return definition !== undefined ? definition.tools : [];
  }

  // ==================== 发送与广播 ====================

  private sendFrame(frame: Object): boolean {
    try {
      return GatewayClient.get().sendDeviceToolFrame(JSON.stringify(frame));
    } catch (err) {
      Logger.warn('connectors send failed');
      return false;
    }
  }

  private publish(state: string): void {
    AppStorage.setOrCreate<string>('connectorsState', state);
    let detail: string = '';
    this.registered.forEach((m: RegisteredConnectorModule, index: number) => {
      detail += (index > 0 ? ',' : '') + m.id + ':' + m.tools.length.toString();
    });
    AppStorage.setOrCreate<string>('connectorsDetail', detail);
    AppStorage.setOrCreate<number>('connectorsToolCount', this.registeredToolCount());
    this.publishEnabled();
  }

  private publishEnabled(): void {
    AppStorage.setOrCreate<string>('connectorsEnabled', JSON.stringify(this.enabledMap()));
    let available: string = '';
    CONNECTOR_MODULES.forEach((m: ConnectorModuleDefinition) => {
      available += (this.isAvailable(m.id) ? '1' : '0');
    });
    AppStorage.setOrCreate<string>('connectorsAvailable', available);
  }

  /** 注册回执迟迟不来时自动重试（不打扰用户）。 */
  private scheduleRegisterRetry(delayMs: number): void {
    setTimeout(() => {
      if (!this.supported || !this.connected) {
        return;
      }
      if ((AppStorage.get<string>('connectorsState') ?? '') === 'registered') {
        return;
      }
      this.register();
    }, delayMs);
  }

  /** 能力开关是「本机」的，不跟具体主机绑定：固定 key，避免重连后 host 变化导致开关被当成未设置。 */
  private storageKey(): string {
    return 'connectors.enabled';
  }

  /** 兼容旧版本按主机分键存的开关：扫描所有 connectors.enabled.* 旧键，合并 true 后迁移到固定键。 */
  private migrateLegacyEnabled(): boolean {
    try {
      const keys: string[] = PreferencesStore.get().allKeys();
      let migrated: boolean = false;
      const legacyKeys: string[] = [];
      for (const key of keys) {
        if (key === this.storageKey()) {
          continue;
        }
        if (key.indexOf('connectors.enabled') !== 0) {
          continue;
        }
        legacyKeys.push(key);
        const raw: string = PreferencesStore.get().getString(key, '');
        if (raw.length === 0 || raw === '{}') {
          continue;
        }
        let parsed: Record<string, Object>;
        try {
          parsed = JSON.parse(raw) as Record<string, Object>;
        } catch (err) {
          continue;
        }
        Object.keys(parsed).forEach((id: string) => {
          const value: Object = parsed[id];
          if (value === true) {
            this.enabled.set(id, true);
            migrated = true;
          }
        });
      }
      if (migrated) {
        this.persistEnabled();
      }
      for (const key of legacyKeys) {
        PreferencesStore.get().deleteKey(key);
      }
      return migrated;
    } catch (err) {
      return false;
    }
  }

  /** 偏好存储就绪后重新加载一次开关（冷启动时 onConnected 可能早于 Preferences 初始化）。 */
  reloadEnabled(): void {
    this.loadEnabled();
  }

  private loadEnabled(): void {
    this.enabled.clear();
    let loadedAny: boolean = false;
    try {
      const raw: string = PreferencesStore.get().getString(this.storageKey(), '{}');
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      Object.keys(parsed).forEach((key: string) => {
        const value: Object = parsed[key];
        if (typeof value === 'boolean') {
          this.enabled.set(key, value as boolean);
          loadedAny = true;
        }
      });
    } catch (err) {
      Logger.warn('connectors enabled parse failed');
    }
    if (!loadedAny) {
      this.migrateLegacyEnabled();
    }
    this.publishEnabled();
  }

  private persistEnabled(): void {
    const out: Record<string, boolean> = {};
    this.enabled.forEach((value: boolean, key: string) => {
      out[key] = value;
    });
    PreferencesStore.get().putString(this.storageKey(), JSON.stringify(out));
  }

  private uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string): string => {
      const r: number = Math.floor(Math.random() * 16);
      const v: number = c === 'x' ? r : (r % 4 + 8);
      return v.toString(16);
    });
  }
}

export const DeviceConnectors: DeviceConnectorsStore = new DeviceConnectorsStore();
