import { PreferencesStore } from '../common/PreferencesStore';
import { Logger } from '../common/Logger';

/** 已配对网关的本地凭据（持久化，用于免扫码重连）。 */
export interface SavedGateway {
  id: string;
  name: string;
  wsUrl: string;
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

const KEY: string = 'savedGateway';

export class CredentialStore {
  private static instance: CredentialStore = new CredentialStore();
  private cached: SavedGateway | null = null;
  private loaded: boolean = false;

  static get(): CredentialStore {
    return CredentialStore.instance;
  }

  load(): SavedGateway | null {
    if (this.loaded) {
      return this.cached;
    }
    this.loaded = true;
    const raw: string = PreferencesStore.get().getString(KEY, '');
    if (raw.length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as SavedGateway;
      this.cached = parsed;
      return parsed;
    } catch (err) {
      Logger.warn('saved gateway parse failed: ' + (err instanceof Error ? err.message : String(err)));
      return null;
    }
  }

  save(gateway: SavedGateway): void {
    this.cached = gateway;
    this.loaded = true;
    PreferencesStore.get().putString(KEY, JSON.stringify(gateway));
    Logger.info('saved gateway ' + gateway.id + ' (' + gateway.wsUrl + ')');
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
    this.cached = null;
    this.loaded = true;
    PreferencesStore.get().putString(KEY, '');
    Logger.info('saved gateway cleared');
  }

  has(): boolean {
    return this.load() !== null;
  }
}
