import { PreferencesStore, Logger, GatewayClient } from 'nativecore';
import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { TsnetBridge } from './TsnetBridge';

const KEY_ENABLED: string = 'tailscaleEnabled';
const KEY_CONTROL_URL: string = 'tailscaleControlURL';
const DEFAULT_CONTROL_URL: string = 'https://controlplane.tailscale.com';
export const TS_STAGE_DISABLED: string = 'disabled';
export const TS_STAGE_STARTING: string = 'starting';
export const TS_STAGE_NEEDS_LOGIN: string = 'needsLogin';
export const TS_STAGE_WAITING: string = 'waitingRoutes';
export const TS_STAGE_READY: string = 'ready';
export const TS_STAGE_FAILED: string = 'failed';

/**
 * 内嵌隧道状态（首页标记用）：开关打开时每 2s 轮询 Go 引擎状态并发布到 AppStorage。
 * 与 TailscalePage 的页面状态互不影响（页面有更细的登录/peers 逻辑）。
 */
export class TailscaleTunnelStore {
  private static instance: TailscaleTunnelStore = new TailscaleTunnelStore();
  private timer: number = -1;
  private started: boolean = false;
  private fastStarted: boolean = false;
  private fastWasReady: boolean = false;
  private fastDebugLogged: boolean = false;
  private fastTicks: number = 0;
  private warmInited: boolean = false;
  private fastNoStateTicks: number = 0;
  private fastRecovered: boolean = false;
  private lastWarmAt: number = 0;
  private stateDir: string = '';
  private autoOpenOnce: boolean = false;
  private uiContext: common.UIAbilityContext | undefined = undefined;

  static get(): TailscaleTunnelStore {
    return TailscaleTunnelStore.instance;
  }

  /** 启动状态轮询；enabled 时顺带拉起 Go 引擎（应用启动即生效，不依赖 Tailscale 页） */
  start(stateDir: string, uiContext?: common.UIAbilityContext): void {
    this.stateDir = stateDir;
    this.uiContext = uiContext;
    if (this.timer >= 0) {
      return;
    }
    this.publish();
    this.timer = setInterval(() => {
      this.publish();
    }, 2000);
  }

  stop(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  /** 控制平面地址：默认官方 controlplane，用户可填自建 Headscale 等自定义域名（账号归用户自己） */
  private controlURL(): string {
    const value: string = PreferencesStore.get().getString(KEY_CONTROL_URL, '').trim();
    return value.length > 0 ? value : DEFAULT_CONTROL_URL;
  }

  /** 轻量 tsnet 引擎：首次需要授权一次，就绪后连接切到它（冷启动 1–2s） */
  private ensureFastStarted(enabled: boolean): void {
    if (!enabled || this.fastStarted) {
      return;
    }
    this.fastStarted = true;
    let hostname: string = PreferencesStore.get().getString('tailscaleNodeName', '');
    if (hostname.length === 0) {
      try {
        hostname = deviceInfo.productModel;
      } catch (err) {
        hostname = 'harmony';
      }
    }
    let authKey: string = PreferencesStore.get().getString('tsnetAuthKey', '').trim();
    Logger.info('TSDBG fast authKeyLen=' + authKey.length);
    const result: string = TsnetBridge.startFast(hostname, this.stateDir, this.controlURL(), authKey);
    Logger.info('TSDBG fast start=' + result.substring(0, 200));
  }

  private ensureStarted(enabled: boolean): void {
    // 有 Auth Key 时只跑轻量 tsnet 引擎，避免 tsd 引擎的 needsLogin 状态干扰 UI
    if (PreferencesStore.get().getString('tsnetAuthKey', '').trim().length > 0) {
      return;
    }
    if (!enabled || this.started) {
      return;
    }
    this.started = true;
    const hello: string = TsnetBridge.hello();
    Logger.info('TSDBG store hello=' + hello);
    if (hello.indexOf('OK') < 0) {
      return;
    }
    const preferName: string = PreferencesStore.get().getString('tailscaleNodeName', '');
    let model: string = preferName.length > 0 ? preferName : 'HarmonyOS';
    let osVersion: string = '';
    try {
      model = deviceInfo.productModel;
      osVersion = deviceInfo.osFullName;
    } catch (err) {
    }
    const started: string = TsnetBridge.start(this.stateDir, model, osVersion,
      this.controlURL());
    Logger.info('TSDBG store start=' + started.substring(0, 200));
  }

  /** 需要时自动打开并启动内嵌隧道（扫码配对到 ts.net 地址时使用） */
  enableAndStart(): void {
    PreferencesStore.get().putBoolean(KEY_ENABLED, true)
    this.started = false
    AppStorage.setOrCreate<boolean>('tailscaleTunnelEnabled', true)
    this.ensureStarted(true)
    this.publish()
  }

  /** 用新的 authKey 重启轻量引擎 */
  reloadFast(): void {
    // 放到下一个事件循环执行，避免 NAPI 停止引擎时阻塞 UI 线程
    setTimeout(() => {
      TsnetBridge.stopFast();
      this.fastStarted = false;
      this.fastWasReady = false;
      this.fastDebugLogged = false;
      this.fastNoStateTicks = 0;
      this.fastRecovered = false;
      this.ensureFastStarted(true);
      this.publish();
    }, 0);
  }

  /** 回到前台立即刷新一次；引擎异常时允许重新启动 */
  refresh(): void {
    const enabled: boolean = PreferencesStore.get().getBoolean(KEY_ENABLED, false);
    if (!enabled) {
      this.publish();
      return;
    }
    const status: string = TsnetBridge.status();
    Logger.info('TSDBG refresh status=' + status.substring(0, 160));
    if (status.length === 0 || status.indexOf('FAILED') >= 0) {
      this.started = false;
    }
    this.publish();
  }

  /** 从 tailnet 对端里自动识别网关（按主机名匹配），填充「网关 tailnet 地址」 */
  private autoFillGatewayTarget(): void {
    const existing: string = PreferencesStore.get().getString('tailnetGatewayTarget', '').trim();
    if (existing.length > 0) {
      AppStorage.setOrCreate<string>('tailnetGatewayTarget', existing);
      return;
    }
    const peersJson: string = TsnetBridge.peers();
    if (peersJson.length < 3 || peersJson === '[]') {
      return;
    }
    const gatewayName: string = (AppStorage.get<string>('gatewayName') ?? '').split('.')[0].toLowerCase();
    try {
      const peers: Object[] = JSON.parse(peersJson) as Object[];
      let matchedName: string = '';
      let matchedAddress: string = '';
      let macName: string = '';
      let macAddress: string = '';
      for (const raw of peers) {
        const rec: Record<string, Object> = raw as Record<string, Object>;
        const name: string = typeof rec['name'] === 'string' ? rec['name'] as string : '';
        const addresses: Object[] = rec['addresses'] !== undefined ? rec['addresses'] as Object[] : [];
        let address: string = '';
        for (const item of addresses) {
          const text: string = String(item);
          if (text.indexOf('.') > 0 && text.indexOf(':') < 0) {
            address = text;
            break;
          }
        }
        if (name.length === 0 || address.length === 0) {
          continue;
        }
        const lower: string = name.toLowerCase();
        if (gatewayName.length > 0 && (lower === gatewayName || lower.indexOf(gatewayName) >= 0) && matchedName.length === 0) {
          matchedName = name;
          matchedAddress = address;
        }
        const os: string = typeof rec['os'] === 'string' ? (rec['os'] as string).toLowerCase() : '';
        if (os.indexOf('mac') >= 0 && macName.length === 0) {
          macName = name;
          macAddress = address;
        }
      }
      const targetName: string = matchedName.length > 0 ? matchedName : macName;
      const targetAddress: string = matchedAddress.length > 0 ? matchedAddress : macAddress;
      if (targetName.length === 0 && targetAddress.length === 0) {
        return;
      }
      const target: string = targetAddress.length > 0 ? targetAddress + ':3081' : targetName + ':3081';
      if (targetName.length > 0) {
        PreferencesStore.get().putString('tailnetGatewayPeerName', targetName);
        AppStorage.setOrCreate<string>('tailnetGatewayPeerName', targetName);
      }
      PreferencesStore.get().putString('tailnetGatewayTarget', target);
      AppStorage.setOrCreate<string>('tailnetGatewayTarget', target);
      Logger.info('TSDBG auto gateway target=' + target);
    } catch (err) {
      Logger.warn('TSDBG auto gateway target parse failed');
    }
  }

  private stageOf(status: string): string {
    if (status.indexOf('FAILED') >= 0) {
      return TS_STAGE_FAILED;
    }
    if (status.indexOf('state=Running') >= 0) {
      return TS_STAGE_READY;
    }
    if (status.indexOf('state=NeedsLogin') >= 0 || status.indexOf('loginURLReady=true') >= 0) {
      return TS_STAGE_NEEDS_LOGIN;
    }
    if (status.indexOf('state=Starting') >= 0 || status.indexOf('starting') >= 0) {
      return TS_STAGE_WAITING;
    }
    return TS_STAGE_STARTING;
  }

  private publish(): void {
    const previousStage: string = AppStorage.get<string>('tailscaleStage') ?? '';
    const enabled: boolean = PreferencesStore.get().getBoolean(KEY_ENABLED, false);
    AppStorage.setOrCreate<boolean>('tailscaleTunnelEnabled', enabled);
    if (!enabled) {
      AppStorage.setOrCreate<string>('tailscaleStage', TS_STAGE_DISABLED);
      return;
    }
    this.ensureStarted(enabled);
    this.ensureFastStarted(enabled);
    if (this.fastStarted) {
      this.fastTicks = this.fastTicks + 1;
      const fastStat: string = TsnetBridge.statusFast();
      const dnsIndex: number = fastStat.indexOf('dnsName=');
      if (dnsIndex >= 0) {
        const tail: string = fastStat.substring(dnsIndex + 'dnsName='.length);
        const stop: number = tail.search(/[ |]/);
        const dns: string = (stop > 0 ? tail.substring(0, stop) : tail).replace(/\.$/, '');
        const dot: number = dns.indexOf('.');
        if (dot > 0) {
          const dnsSuffix: string = dns.substring(dot + 1);
          AppStorage.setOrCreate<string>('tailnetDnsSuffix', dnsSuffix);
          // 持久化：冷启动后立刻切蜂窝时，GatewayClient 靠它合成 wss://<peer>.ts.net
          if (PreferencesStore.get().getString('tailnetDnsSuffix', '') !== dnsSuffix) {
            PreferencesStore.get().putString('tailnetDnsSuffix', dnsSuffix);
          }
        }
      }
      if (fastStat.indexOf('authMode=') >= 0) {
        const idx: number = fastStat.indexOf('authMode=');
        const tail: string = fastStat.substring(idx + 'authMode='.length);
        const end: number = tail.indexOf(' ');
        const mode: string = end > 0 ? tail.substring(0, end) : tail.trim();
        AppStorage.setOrCreate<string>('tsnetAuthMode', mode);
      }
      if (this.fastTicks % 5 === 1) {
        Logger.info('TSDBG fast=' + fastStat.substring(0, 200));
      }
      // 引擎卡在 NoState（未启动）超过 15 秒：自动重启一次，并输出 tsnet 调试日志
      if (fastStat.indexOf('state=NoState') >= 0) {
        this.fastNoStateTicks += 1;
        if (this.fastNoStateTicks === 8 && !this.fastRecovered) {
          this.fastRecovered = true;
          Logger.warn('TSDBG fast stuck NoState, restarting engine');
          Logger.info('TSDBG fastLog=' + TsnetBridge.debugFast().replaceAll('\n', ' ~ ').substring(0, 700));
          TsnetBridge.stopFast();
          // 状态文件可能由旧版本引擎写入导致无法启动：清掉后重新注册
          try {
            fileIo.rmdirSync(this.stateDir + '/tsnet-node');
            Logger.warn('TSDBG cleared tsnet state dir');
          } catch (clearErr) {
            Logger.warn('TSDBG clear state failed: ' + (clearErr as Error).message);
          }
          this.fastStarted = false;
          this.fastWasReady = false;
          this.ensureFastStarted(true);
        }
      } else {
        this.fastNoStateTicks = 0;
      }
      if (fastStat.indexOf('state=Running') >= 0) {
        if (!this.fastWasReady) {
          this.fastWasReady = true;
          AppStorage.setOrCreate<boolean>('tsnetFastReady', true);
          Logger.info('TSDBG fast ready (lightweight tsnet available)');
        }
      } else if (fastStat.indexOf('state=NeedsLogin') >= 0) {
        const fastAuth: string = TsnetBridge.authURLFast();
        if (fastAuth.startsWith('http')) {
          AppStorage.setOrCreate<string>('tsnetFastAuthUrl', fastAuth);
          AppStorage.setOrCreate<string>('tailscaleAuthUrl', fastAuth);
        }
      }
    }
    // WiFi 下预热隧道：提前把代理指向 ts.net 并拨通 DERP 路径，切蜂窝时才能秒切
    const bearer: string = AppStorage.get<string>('networkBearer') ?? 'wifi';
    if (this.fastWasReady && bearer === 'wifi') {
      const suffix: string = AppStorage.get<string>('tailnetDnsSuffix') ?? '';
      let peerName: string = AppStorage.get<string>('tailnetGatewayPeerName') ?? '';
      if (peerName.length === 0) {
        peerName = 'dsh-gateway';
      }
      peerName = peerName.split('.')[0];
      if (suffix.length > 0) {
        const warmUrl: string = 'wss://' + peerName + '.' + suffix + '/ws/mobile';
        if (!this.warmInited) {
          this.warmInited = true;
          TsnetBridge.startFastProxyForWsUrl(warmUrl, 18080);
          Logger.info('warm proxy ready ' + warmUrl);
        }
        const nowMs: number = Date.now();
        if (nowMs - this.lastWarmAt > 20000) {
          this.lastWarmAt = nowMs;
          TsnetBridge.warmFast(peerName + '.' + suffix, 443);
        }
      }
    }
    const rawStatus: string = TsnetBridge.status();
    // 轻量 tsnet 引擎就绪时以它为准（tsd 引擎在新包下可能仍是 needsLogin 的旧状态）
    const stageNow: string = this.fastWasReady ? TS_STAGE_READY : this.stageOf(rawStatus);
    if (stageNow !== previousStage) {
      const phaseIndex: number = rawStatus.indexOf('phase=');
      const phase: string = phaseIndex >= 0 ? rawStatus.substring(phaseIndex) : 'phase=none';
      Logger.info('TSDBG stage ' + previousStage + ' -> ' + stageNow + ' | ' + phase + ' | ' + rawStatus.substring(0, 120));
    }
    // 先发布阶段，reconnect 时 tailnetReady() 才能读到 ready
    AppStorage.setOrCreate<string>('tailscaleStage', stageNow);
    if (stageNow === TS_STAGE_READY) {
      this.autoFillGatewayTarget();
      if (previousStage !== TS_STAGE_READY) {
        GatewayClient.get().resetTailnetAttempt();
      }
      const account: string = TsnetBridge.account();
      if (account.length > 0) {
        AppStorage.setOrCreate<string>('tailscaleAccount', account);
      }
      AppStorage.setOrCreate<string>('tailscaleAuthUrl', '');
    }
    const stage: string = stageNow;
    if (stage === TS_STAGE_NEEDS_LOGIN) {
      const auth: string = TsnetBridge.authURL();
      if (auth.startsWith('http')) {
        Logger.info('TSDBG store authURL=' + auth.substring(0, 80));
        AppStorage.setOrCreate<string>('tailscaleAuthUrl', auth);
      }
    }
  }
}
