import { GatewayClient } from '../network/GatewayClient';
import { GatewayFrame } from '../protocol/GatewayDtos';
import { arr, bool, field, str } from '../protocol/GatewayFrameCodec';
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
  { id: 'location', title: '位置', subtitle: '当前位置（近似/精确）', tools: ['location.current', 'location.precise'] },
  { id: 'photos', title: '照片', subtitle: '系统选择器选一张照片', tools: ['photos.select'] },
  { id: 'music', title: '音乐', subtitle: '本机音乐搜索与播放控制', tools: ['music.search', 'music.state', 'music.play', 'music.pause', 'music.seek'] },
  { id: 'health', title: '健康', subtitle: '步数、睡眠等健康摘要', tools: ['health.daily-summary'] },
  { id: 'alarms', title: '闹钟', subtitle: '设置系统闹钟', tools: ['alarms.create', 'alarms.list', 'alarms.cancel'] },
];

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

class DeviceConnectorsStore {
  private bound: boolean = false;
  private supported: boolean = false;
  private revision: number = 0;
  private lease: string = '';
  private adapters: Map<string, ConnectorAdapter> = new Map();
  private enabled: Map<string, boolean> = new Map();
  private queuedChanges: Map<string, boolean> = new Map();
  private registered: RegisteredConnectorModule[] = [];
  private permissions: Map<string, boolean> = new Map();
  private pendingInvocation: string = '';
  private hostKey: string = '';
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
    this.lease = '';
    this.registered = [];
    this.permissions.clear();
    this.hostKey = AppStorage.get<string>('activeEndpoint') ?? '';
    this.loadEnabled();
    this.register();
    // hello/连接建立时刻注册帧偶尔会丢：自动补两次重试，避免用户每次都要手动点「重新注册」
    this.scheduleRegisterRetry(800);
    this.scheduleRegisterRetry(2600);
    this.scheduleRegisterRetry(6000);
  }

  onDisconnected(): void {
    if (this.pendingInvocation.length > 0) {
      this.cancelPending('device_disconnected');
    }
    this.lease = '';
    this.registered = [];
    this.permissions.clear();
    this.publish('disconnected');
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
    }
    this.enabled.set(id, value);
    this.queuedChanges.set(id, value);
    this.persistEnabled();
    this.publishEnabled();
    this.register();
    return true;
  }

  refreshStatus(): void {
    if (!this.supported) {
      return;
    }
    const frame: StatusFrame = {
      type: 'device-tools-status', version: 1, requestId: this.uuid()
    };
    this.sendFrame(frame);
  }

  retryRegister(): void {
    if (!this.supported) {
      return;
    }
    this.register();
  }

  private register(): void {
    const request: string = this.uuid();
    this.revision += 1;
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
    const frame: RegisterFrame = {
      type: 'device-tools-register',
      version: 1,
      requestId: request,
      capabilityRevision: this.revision,
      modules: modules
    };
    if (!this.omitPlatform) {
      frame.platform = 'harmonyos';
    }
    if (this.queuedChanges.size > 0) {
      const changes: Record<string, boolean> = {};
      this.queuedChanges.forEach((value: boolean, key: string) => {
        changes[key] = value;
      });
      frame.permissionChanges = changes;
      this.queuedChanges.clear();
    }
    this.sendFrame(frame);
    Logger.info('connectors register send revision=' + this.revision.toString() + ' supported=' + this.supported.toString());
  }

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
      Logger.info('connectors hello caps=' + (caps !== undefined ? caps.length.toString() : '0') + ' supported=' + supported.toString());
      if (supported) {
        this.onConnected();
      } else {
        this.publish('unsupported');
      }
      return;
    }
    if (kind === 'device-tools-registered') {
      this.lease = str(frame, 'connectionLeaseId') ?? '';
      this.acceptModules(frame);
      this.acceptPermissions(frame);
      AppStorage.setOrCreate<number>('connectorsConfirmedAt', Date.now());
      this.publish('registered');
      Logger.info('connectors registered tools=' + this.registeredToolCount().toString());
      return;
    }
    if (kind === 'device-tools-status') {
      const status: string = str(frame, 'status') ?? '';
      if (status === 'registered') {
        this.lease = str(frame, 'connectionLeaseId') ?? this.lease;
        this.acceptModules(frame);
        this.acceptPermissions(frame);
        AppStorage.setOrCreate<number>('connectorsConfirmedAt', Date.now());
        this.publish('registered');
      } else {
        this.publish('unverified');
      }
      return;
    }
    if (kind === 'device-tools-permissions') {
      this.acceptPermissions(frame);
      this.publishEnabled();
      return;
    }
    if (kind === 'device-tool-invoke') {
      this.invokeTool(frame);
      return;
    }
    if (kind === 'device-tool-cancel') {
      this.cancelPending('cancelled');
      return;
    }
    if (kind === 'error') {
      Logger.info('connectors error frame requestType=' + (str(frame, 'requestType') ?? '-') + ' code=' + (str(frame, 'code') ?? '-'));
    }
    if (kind === 'error' && (str(frame, 'requestType') ?? '') === 'device-tools-register') {
      const code: string = str(frame, 'code') ?? '';
      if (code === 'invalid_request' && !this.retriedWithoutPlatform) {
        // 老网关只接受 android/ios：去掉 platform 重试一次
        this.retriedWithoutPlatform = true;
        this.omitPlatform = true;
        Logger.info('connectors retry without platform');
        this.register();
        return;
      }
      if (code === 'unsupported-version' || code === 'invalid_request') {
        this.supported = false;
        this.publish('unsupported');
      } else {
        this.publish('failed');
      }
    }
  }

  private acceptModules(frame: GatewayFrame): void {
    const rows: Object[] | undefined = arr(frame, 'modules');
    if (rows === undefined) {
      return;
    }
    const list: RegisteredConnectorModule[] = [];
    rows.forEach((row: Object) => {
      const id: string = str(row, 'id') ?? '';
      if (id.length === 0) {
        return;
      }
      const tools: string[] = [];
      const rawTools: Object[] | undefined = arr(row, 'tools');
      if (rawTools !== undefined) {
        rawTools.forEach((t: Object) => {
          if (typeof t === 'string') {
            tools.push(t as string);
          }
        });
      }
      list.push({
        id: id,
        enabled: bool(row, 'enabled') === true,
        available: bool(row, 'available') === true,
        tools: tools
      });
    });
    this.registered = list;
  }

  private acceptPermissions(frame: GatewayFrame): void {
    const raw: Object | undefined = field(frame, 'permissions');
    if (raw === undefined) {
      return;
    }
    const rec: Record<string, Object> = raw as Record<string, Object>;
    Object.keys(rec).forEach((key: string) => {
      const value: Object = rec[key];
      if (typeof value === 'boolean') {
        this.permissions.set(key, value);
      }
    });
    this.publishEnabled();
  }

  private invokeTool(frame: GatewayFrame): void {
    const invocationId: string = str(frame, 'invocationId') ?? '';
    const tool: string = str(frame, 'tool') ?? '';
    const moduleId: string = tool.indexOf('maps.') === 0 ? 'location' : tool.split('.')[0];
    const adapter: ConnectorAdapter | undefined = this.adapters.get(moduleId);
    const args: Object | undefined = field(frame, 'arguments');
    if (invocationId.length === 0 || adapter === undefined) {
      this.sendError(invocationId, 'tool_unsupported');
      return;
    }
    Logger.info('connectors invoke tool=' + tool + ' invocation=' + invocationId.slice(0, 8));
    this.pendingInvocation = invocationId;
    const argRec: Record<string, Object> = (args !== undefined && args !== null) ? args as Record<string, Object> : {};
    adapter.invoke(tool, argRec).then((result: Object) => {
      if (this.pendingInvocation === invocationId) {
        this.pendingInvocation = '';
      }
      const out: ResultFrame = {
        type: 'device-tool-result', version: 1, invocationId: invocationId,
        connectionLeaseId: this.lease, status: 'success', result: result
      };
      this.sendFrame(out);
    }).catch((err: Error) => {
      if (this.pendingInvocation === invocationId) {
        this.pendingInvocation = '';
      }
      const raw: string = err !== undefined && err !== null && err.message !== undefined ? err.message : 'error';
      Logger.warn('connectors invoke failed tool=' + tool + ' err=' + raw);
      // 把原生错误码传回宿主，便于定位（匹配 [a-z_]{1,64} 才向下传，否则 device_error）
      const code: string = /^[a-z_]{1,64}$/.test(raw) ? raw : 'device_error';
      this.sendError(invocationId, code);
    });
  }

  private cancelPending(code: string): void {
    const invocation: string = this.pendingInvocation;
    this.pendingInvocation = '';
    this.adapters.forEach((adapter: ConnectorAdapter) => {
      try {
        adapter.cancel(invocation);
      } catch (err) {
      }
    });
    if (invocation.length > 0) {
      this.sendError(invocation, code);
    }
  }

  private sendError(invocationId: string, code: string): void {
    if (invocationId.length === 0) {
      return;
    }
    const frame: ResultFrame = {
      type: 'device-tool-result', version: 1, invocationId: invocationId,
      connectionLeaseId: this.lease, status: 'error', error: { 'code': code }
    };
    this.sendFrame(frame);
  }

  private sendFrame(frame: Object): void {
    try {
      GatewayClient.get().send(JSON.stringify(frame));
    } catch (err) {
      Logger.warn('connectors send failed: ' + JSON.stringify(err));
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

  /** 回到前台：补一次状态刷新 + 未注册时自动重试注册，免得每次都要手动点「重新注册」。 */
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

  /** 注册回执迟迟不来时自动重试（不打扰用户）。 */
  private scheduleRegisterRetry(delayMs: number): void {
    setTimeout(() => {
      if (!this.supported) {
        return;
      }
      if ((AppStorage.get<string>('connectorsState') ?? '') === 'registered') {
        return;
      }
      this.register();
    }, delayMs);
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
