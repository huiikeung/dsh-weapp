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
  /** 本机备注名：留空用网关上报的 name（旧数据没有该字段）。 */
  alias?: string;
  /** 主机类型：desktopcomputer / server.rack（旧数据没有该字段时按电脑显示）。 */
  deviceKind?: string;
  /** 上次成功连接的端点（对齐 iOS preferredEndpoint）：冷启动优先尝试它。 */
  preferredEndpoint?: string;
}

const KEY: string = 'savedGateways';
const ACTIVE_KEY: string = 'activeSavedGateway';

export class CredentialStore {
  private static instance: CredentialStore = new CredentialStore();
  private cached: SavedGateway[] = [];
  private persistTimer: number = 0;
  private persistPending: string = '';
  private lastPersistFp: string = '';
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
      // 活动 id 失效时回到「最近用过的那台」，而不是列表里最早的那条
      let newest: SavedGateway = this.cached[0];
      for (const item of this.cached) {
        if (item.lastConnectedAt > newest.lastConnectedAt) {
          newest = item;
        }
      }
      this.activeId = newest.id;
    }
    // 历史版本按「连接地址」当 id，同一台主机在不同网络下会各存一条：启动时合并一次
    this.mergeDuplicateHosts();
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

  /** 同一台物理主机的归组键：中继节点 id → 网关名 → 连接地址。 */
  private hostIdentityKey(item: SavedGateway): string {
    if (item.relayNodeId !== undefined && item.relayNodeId.length > 0) {
      return 'relay:' + item.relayNodeId;
    }
    const name: string = item.name.trim().toLowerCase();
    if (name.length > 0) {
      return 'name:' + name;
    }
    return 'url:' + item.wsUrl;
  }

  /**
   * 合并历史重复档案：同一台主机在局域网 / tailnet / 中继下各存过一条。
   * 只合并「中继 id 相同」「网关名相同」「地址完全相同」三类（名字为空的不猜），
   * 保留最近连接的那条（活动档案优先），端点取并集，备注名与类型沿用已有的。
   */
  private mergeDuplicateHosts(): void {
    if (this.cached.length < 2) {
      return;
    }
    const keys: string[] = [];
    const groups: SavedGateway[][] = [];
    for (const item of this.cached) {
      const key: string = this.hostIdentityKey(item);
      const at: number = keys.indexOf(key);
      if (at < 0) {
        keys.push(key);
        groups.push([item]);
      } else {
        groups[at].push(item);
      }
    }
    if (groups.length === this.cached.length) {
      return;
    }
    const merged: SavedGateway[] = [];
    for (const group of groups) {
      if (group.length === 1) {
        merged.push(group[0]);
        continue;
      }
      let kept: SavedGateway = group[0];
      for (const item of group) {
        if (item.id === this.activeId) {
          kept = item;
          break;
        }
      }
      if (kept.id !== this.activeId) {
        for (const item of group) {
          if (item.lastConnectedAt > kept.lastConnectedAt) {
            kept = item;
          }
        }
      }
      const endpoints: string[] = kept.endpoints !== undefined ? kept.endpoints.slice() : [kept.wsUrl];
      let newestAt: number = kept.lastConnectedAt;
      for (const item of group) {
        const urls: string[] = item.endpoints !== undefined ? item.endpoints : [item.wsUrl];
        for (const url of urls) {
          if (url.length > 0 && endpoints.indexOf(url) < 0) {
            endpoints.push(url);
          }
        }
        if (item.wsUrl.length > 0 && endpoints.indexOf(item.wsUrl) < 0) {
          endpoints.push(item.wsUrl);
        }
        if ((kept.alias === undefined || kept.alias.length === 0) && item.alias !== undefined && item.alias.length > 0) {
          kept.alias = item.alias;
        }
        if ((kept.deviceKind === undefined || kept.deviceKind.length === 0) && item.deviceKind !== undefined && item.deviceKind.length > 0) {
          kept.deviceKind = item.deviceKind;
        }
        if (item.lastConnectedAt > newestAt) {
          newestAt = item.lastConnectedAt;
        }
      }
      kept.endpoints = endpoints;
      kept.lastConnectedAt = newestAt;
      merged.push(kept);
    }
    this.cached = merged;
    if (!this.cached.some((item: SavedGateway) => item.id === this.activeId)) {
      let newest: SavedGateway | null = null;
      for (const item of this.cached) {
        if (newest === null || item.lastConnectedAt > newest.lastConnectedAt) {
          newest = item;
        }
      }
      this.activeId = newest !== null ? newest.id : '';
    }
    Logger.info('credentials deduped: hosts=' + this.cached.length.toString());
  }

  private persist(): void {
    const serialized: string = JSON.stringify(this.cached);
    const fingerprint: string = this.activeId + '\n' + serialized;
    if (fingerprint === this.lastPersistFp) {
      return;
    }
    this.lastPersistFp = fingerprint;
    this.persistPending = serialized;
    // AssetStore 的同步写会阻塞 UI 线程（连接成功瞬间写一次会让页面卡住），
    // 这里合并写并延后一帧执行：视觉上先完成连接，再落盘。
    if (this.persistTimer !== 0) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = 0;
      const payload: string = this.persistPending;
      SecureCredentialStore.write(payload);
      PreferencesStore.get().putString(KEY, payload);
      PreferencesStore.get().putString(ACTIVE_KEY, this.activeId);
    }, 60);
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
    if (selected !== undefined) {
      return selected;
    }
    return this.recent();
  }

  /**
   * 最近使用的主机：活动记录还在就用它，否则取 lastConnectedAt 最大的一条。
   * 首页胶囊、「暂无主机」兜底、自动连接都以此为准 —— 以前用的是 cached[0]（最早保存的那台）。
   */
  recent(): SavedGateway | null {
    this.ensureLoaded();
    if (this.cached.length === 0) {
      return null;
    }
    const active: SavedGateway | undefined = this.cached.find((item: SavedGateway) => item.id === this.activeId);
    if (active !== undefined) {
      return active;
    }
    let newest: SavedGateway = this.cached[0];
    for (const item of this.cached) {
      if (item.lastConnectedAt > newest.lastConnectedAt) {
        newest = item;
      }
    }
    return newest;
  }

  /**
   * 找同一台物理主机的既有档案：中继 id → 网关名 → 连接地址。
   * 同一台机器在不同网络下地址不同（局域网 IP / *.ts.net / 中继），
   * 以前直接拿地址当 id，每换一次网络就多出一条「新主机」：
   * 切换列表里同一台重复出现，「最近使用」也永远落在最后一条地址档案上。
   */
  findExisting(relayNodeId: string, name: string, wsUrl: string): SavedGateway | null {
    this.ensureLoaded();
    if (relayNodeId.length > 0) {
      const byRelay: SavedGateway | undefined =
        this.cached.find((item: SavedGateway) => item.relayNodeId === relayNodeId);
      if (byRelay !== undefined) {
        return byRelay;
      }
    }
    const trimmed: string = name.trim().toLowerCase();
    if (trimmed.length > 0) {
      const byName: SavedGateway | undefined =
        this.cached.find((item: SavedGateway) => item.name.trim().toLowerCase() === trimmed);
      if (byName !== undefined) {
        return byName;
      }
    }
    const byUrl: SavedGateway | undefined =
      this.cached.find((item: SavedGateway) => item.wsUrl === wsUrl);
    return byUrl !== undefined ? byUrl : null;
  }

  /**
   * 记录一次连接（不动端点）：把该档案标成「最近使用」并设为活动主机。
   * 中继连接以前完全跳过持久化，于是「最近使用」永远停在最后一次直连的那台。
   */
  markConnected(idOrRelay: string, wsUrl: string): SavedGateway | null {
    this.ensureLoaded();
    let gateway: SavedGateway | undefined =
      this.cached.find((item: SavedGateway) => item.id === idOrRelay);
    if (gateway === undefined) {
      gateway = this.cached.find((item: SavedGateway) => item.relayNodeId === idOrRelay);
    }
    if (gateway === undefined) {
      return null;
    }
    gateway.lastConnectedAt = Date.now();
    this.activeId = gateway.id;
    this.persist();
    return gateway;
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
    if (this.activeId === id) {
      // 删掉当前主机后，活动主机落到剩下的「最近用过」那台
      let newest: SavedGateway | null = null;
      for (const item of this.cached) {
        if (newest === null || item.lastConnectedAt > newest.lastConnectedAt) {
          newest = item;
        }
      }
      this.activeId = newest !== null ? newest.id : '';
    }
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

  /** 修改主机的本机备注名与类型（不触碰连接凭据，对齐小程序编辑主机）。 */
  rename(id: string, alias: string, deviceKind: string): SavedGateway | null {
    this.ensureLoaded();
    const gateway: SavedGateway | undefined = this.cached.find((item: SavedGateway) => item.id === id);
    if (gateway === undefined) return null;
    gateway.alias = alias;
    gateway.deviceKind = deviceKind;
    this.persist();
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
