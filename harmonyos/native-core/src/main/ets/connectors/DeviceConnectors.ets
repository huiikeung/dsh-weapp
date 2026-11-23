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
  { id: 'location', title: '位置与地图', subtitle: '当前位置、地址解析、地点标记', tools: ['location.current', 'location.precise'] },
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
  platform: string;
  modules: ModulePayload[];
  permissionChanges?: Record<string, boolean>;
}

interface StatusFrame {
  type: string;
  version: number;
  requestId: string;
}

interface ResultFrame {
  kind: string;
  version: number;
  invocationId: string;
  connectionLeaseId: string;
  result?: Object;
  code?: string;
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
      platform: 'harmonyos',
      modules: modules
    };
    if (this.queuedChanges.size > 0) {
      const changes: Record<string, boolean> = {};
      this.queuedChanges.forEach((value: boolean, key: string) => {
        changes[key] = value;
      });
      frame.permissionChanges = changes;
      this.queuedChanges.clear();
    }
    this.sendFrame(frame);
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
    if (kind === 'error' && (str(frame, 'requestType') ?? '') === 'device-tools-register') {
      const code: string = str(frame, 'code') ?? '';
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
    this.pendingInvocation = invocationId;
    const argRec: Record<string, Object> = (args !== undefined && args !== null) ? args as Record<string, Object> : {};
    adapter.invoke(tool, argRec).then((result: Object) => {
      if (this.pendingInvocation === invocationId) {
        this.pendingInvocation = '';
      }
      const out: ResultFrame = {
        kind: 'device-tool-result', version: 1, invocationId: invocationId,
        connectionLeaseId: this.lease, result: result
      };
      this.sendFrame(out);
    }).catch((err: Error) => {
      if (this.pendingInvocation === invocationId) {
        this.pendingInvocation = '';
      }
      this.sendError(invocationId, 'outcome_unknown');
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
      kind: 'device-tool-error', version: 1, invocationId: invocationId,
      connectionLeaseId: this.lease, code: code
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

  private storageKey(): string {
    const host: string = this.hostKey.length > 0 ? this.hostKey : (AppStorage.get<string>('activeEndpoint') ?? 'default');
    return 'connectors.enabled.' + host;
  }

  private loadEnabled(): void {
    this.enabled.clear();
    try {
      const raw: string = PreferencesStore.get().getString(this.storageKey(), '{}');
      const parsed: Record<string, Object> = JSON.parse(raw) as Record<string, Object>;
      Object.keys(parsed).forEach((key: string) => {
        const value: Object = parsed[key];
        if (typeof value === 'boolean') {
          this.enabled.set(key, value as boolean);
        }
      });
    } catch (err) {
      Logger.warn('connectors enabled parse failed');
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
