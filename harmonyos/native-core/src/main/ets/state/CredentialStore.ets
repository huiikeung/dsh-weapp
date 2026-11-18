import { PreferencesStore } from '../common/PreferencesStore';
import { SecureCredentialStore } from '../common/SecureCredentialStore';
import { Logger } from '../common/Logger';

/** 已配对网关的本地凭据（持久化，用于免扫码重连）。 */
export interface SavedGateway {
  id: string;
  name: string;
  wsUrl: string;
  /**
   * 配对时网关下发的全部候选地址（局域网 + 公网）。
   * 用于按当前网络类型排序：Wi-Fi 优先局域网、蜂窝优先公网。
   * 旧数据没有该字段时回退到 wsUrl。
   */
  endpoints?: string[];
  /** 一次性配对码：仅首次连接使用，成功后服务端会下发 token。 */
  pairCode: string;
  /** 直连 Bearer token。 */
  token: string;
  relayNodeId: string;
  relayAgentPubKey: string;
  inviteToken: string;
  accessToken: string;
  pairedAt: number;
  lastConnectedAt: number;
}

const KEY: string = 'savedGateways';
const ACTIVE_KEY: string = 'activeSavedGateway';

export class CredentialStore {
  private static instance: CredentialStore = new CredentialStore();
  private cached: SavedGateway[] = [];
  private activeId: string = '';
  private loaded: boolean = false;

  static get(): CredentialStore {
    return CredentialStore.instance;
  }

  private ensureLoaded(): void {
    if (this.loaded || !PreferencesStore.get().isReady()) return;
    this.loaded = true;
    this.activeId = PreferencesStore.get().getString(ACTIVE_KEY, '');
    const legacyRaw: string = PreferencesStore.get().getString(KEY, '');
    const secureRaw: string = SecureCredentialStore.read() ?? '';
    Logger.info('credentials probe: pref=' + legacyRaw.length + ' secure=' + secureRaw.length);
    let raw: string = legacyRaw.length > 0 ? legacyRaw : secureRaw;
    if (raw.length === 0) {
      const legacy: string = PreferencesStore.get().getString('savedGateway', '');
      if (legacy.length === 0) return;
      try {
        const parsed = JSON.parse(legacy) as SavedGateway;
        if (parsed === null || typeof parsed.id !== 'string' || parsed.id.length === 0 ||
          typeof parsed.wsUrl !== 'string' || parsed.wsUrl.length === 0) return;
        this.cached = [parsed];
      } catch (err) {
        Logger.warn('saved gateway parse failed: ' + (err instanceof Error ? err.message : String(err)));
        return;
      }
    } else {
      try {
        const parsed = JSON.parse(raw) as Object;
        if (Array.isArray(parsed)) {
          for (const item of parsed as SavedGateway[]) {
            if (item === null || typeof item.id !== 'string' || item.id.length === 0 ||
              typeof item.wsUrl !== 'string' || item.wsUrl.length === 0) {
              this.cached = [];
              return;
            }
            this.cached.push(item);
          }
        } else {
          const legacy = parsed as SavedGateway;
          if (legacy === null || typeof legacy.id !== 'string' || legacy.id.length === 0 ||
            typeof legacy.wsUrl !== 'string' || legacy.wsUrl.length === 0) return;
          this.cached = [legacy];
        }
      } catch (err) {
        Logger.warn('saved gateways parse failed: ' + (err instanceof Error ? err.message : String(err)));
        return;
      }
    }
    if (this.cached.length > 0 && !this.cached.some((item: SavedGateway) => item.id === this.activeId)) {
      this.activeId = this.cached[0].id;
    }
    // 双向自愈：
    // - 明文兜底（Preferences）优先；它以旧数据赢下时，用同一份内容覆盖陈旧的加密副本，
    //   否则「忘记主机」写入的 tombstone 只在兜底里生效，旧 asset 过期后会让老凭据复活。
    // - 反过来，加密副本是唯一来源时回填明文兜底，保证下次覆盖安装/签名变化仍有一份可读记录。
    const serialized: string = JSON.stringify(this.cached);
    if (secureRaw !== serialized) {
      SecureCredentialStore.write(serialized);
    }
    if (legacyRaw.length === 0 && secureRaw.length > 0) {
      PreferencesStore.get().putString(KEY, secureRaw);
    }
    Logger.info('credentials loaded: count=' + this.cached.length);
  }

  private persist(): void {
    const serialized: string = JSON.stringify(this.cached);
    // 双写：AssetStore 提供加密存储，Preferences 同步保留一份。
    // 只写 AssetStore 时，重装/签名变化后密钥库会读不到，导致已配对主机丢失；
    // Preferences 位于应用沙箱内（其它应用无法读取），作为跨安装的可靠兜底。
    SecureCredentialStore.write(serialized);
    PreferencesStore.get().putString(KEY, serialized);
    PreferencesStore.get().putString(ACTIVE_KEY, this.activeId);
  }

  list(): SavedGateway[] {
    this.ensureLoaded();
    return this.cached.slice();
  }

  activeGatewayId(): string {
    this.ensureLoaded();
    return this.activeId;
  }

  setActive(id: string): SavedGateway | null {
    this.ensureLoaded();
    const gateway: SavedGateway | undefined = this.cached.find((item: SavedGateway) => item.id === id);
    if (gateway === undefined) return null;
    this.activeId = id;
    this.persist();
    return gateway;
  }

  load(): SavedGateway | null {
    this.ensureLoaded();
    const selected: SavedGateway | undefined = this.cached.find((item: SavedGateway) => item.id === this.activeId);
    return selected !== undefined ? selected : (this.cached.length > 0 ? this.cached[0] : null);
  }

  save(gateway: SavedGateway): void {
    this.ensureLoaded();
    const index: number = this.cached.findIndex((item: SavedGateway) => item.id === gateway.id);
    if (index >= 0) this.cached[index] = gateway;
    else this.cached.push(gateway);
    this.activeId = gateway.id;
    this.persist();
    Logger.info('saved gateway ' + gateway.id + ' (' + gateway.wsUrl + ')');
  }

  remove(id: string): boolean {
    this.ensureLoaded();
    const index: number = this.cached.findIndex((item: SavedGateway) => item.id === id);
    if (index < 0) return false;
    this.cached.splice(index, 1);
    if (this.activeId === id) this.activeId = this.cached.length > 0 ? this.cached[0].id : '';
    this.persist();
    return true;
  }

  /** 只更新 token 等可变字段，不改其他配对信息。 */
  updateTokens(token: string, accessToken: string): SavedGateway | null {
    const gateway: SavedGateway | null = this.load();
    if (gateway === null) {
      return null;
    }
    if (token.length > 0) {
      gateway.token = token;
    }
    if (accessToken.length > 0) {
      gateway.accessToken = accessToken;
    }
    gateway.lastConnectedAt = Date.now();
    this.save(gateway);
    return gateway;
  }

  touch(): SavedGateway | null {
    const gateway: SavedGateway | null = this.load();
    if (gateway === null) {
      return null;
    }
    gateway.lastConnectedAt = Date.now();
    this.save(gateway);
    return gateway;
  }

  clear(): void {
    this.cached = [];
    this.activeId = '';
    this.loaded = true;
    // Persist an empty collection even if AssetStore is unavailable, so stale
    // secure credentials cannot reappear on the next launch.
    this.persist();
    PreferencesStore.get().putString('savedGateway', '');
    Logger.info('saved gateways cleared');
  }

  has(): boolean {
    return this.load() !== null;
  }
}
