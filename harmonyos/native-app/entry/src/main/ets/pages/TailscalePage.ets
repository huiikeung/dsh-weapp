import { PreferencesStore, Logger, GatewayClient } from 'nativecore';
import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import type Want from '@ohos.app.ability.Want';
import { deviceInfo } from '@kit.BasicServicesKit';
import { TsnetBridge } from '../services/TsnetBridge';
import { TailscaleMarkView } from '../components/TailscaleMarkView';
import { TailscaleTunnelStore } from '../services/TailscaleTunnelStore';

const KEY_ENABLED: string = 'tailscaleEnabled';
const KEY_NODE_NAME: string = 'tailscaleNodeName';
const KEY_AUTH_KEY: string = 'tailscaleAuthKey';
const KEY_CONTROL_URL: string = 'tailscaleControlURL';
const DEFAULT_CONTROL_URL: string = 'https://controlplane.tailscale.com';
const KEY_GATEWAY_VIA_TAILNET: string = 'tailnetGatewayViaProxy';
const GATEWAY_PROXY_PORT: number = 18080;
const KEY_TAILNET_TARGET: string = 'tailnetGatewayTarget';

/** 隧道状态（对齐 iOS TunnelUiStage） */
const STAGE_DISABLED = 'disabled';
const STAGE_STARTING = 'starting';
const STAGE_NEEDS_LOGIN = 'needsLogin';
const STAGE_WAITING_ROUTES = 'waitingRoutes';
const STAGE_READY = 'ready';
const STAGE_FAILED = 'failed';

/**
 * Tailscale 内嵌隧道设置（二级页）：对齐 iOS TailscaleTunnelSettingsView。
 * 布局：节点状态卡片（总览）/ 启用开关 / 账号与网络 / 账号与节点（登录方式+节点身份）。
 *
 * 说明：Go/tsnet 引擎由 OpenHarmony Go 工具链构建的 libtailscale_go.so 提供，
 * NAPI 直链（libtailscale_ohos.so），已在本机跑通 hello/status；登录链接来自引擎 authURL。
 */
@Component
export struct TailscalePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('pendingTailscaleLogin') pendingTailscaleLogin: boolean = false;
  @StorageLink('tailscaleAuthInvalid') authInvalid: boolean = false;

  @State tunnelEnabled: boolean = false;
  @State nodeName: string = '';
  @State authKey: string = '';
  @State controlURL: string = '';
  @State stage: string = STAGE_DISABLED;
  @StorageLink('tailscaleStage') @Watch('onStoreStage') storeStage: string = 'disabled';
  @State failureKind: string = '';
  @State nodeAddress: string = '';
  @State peerCount: number = 0;
  @State dialogOpen: boolean = false;
  @State authModeDialog: boolean = false;
  @State loginResult: string = '';
  @State loginUrl: string = '';
  @State backendLog: string = '';
  @State loginBusy: boolean = false;
  @State proxyHost: string = '';
  @State proxyPort: string = '80';
  @State proxyLocalPort: string = '18080';
  @State proxyStatus: string = '';
  @State gatewayViaTailnet: boolean = false;
  @State gatewayProxyHint: string = '';
  @State tailnetTarget: string = '';
  @State fastAuthKey: string = '';
  @State fastHint: string = '';
  @State keepAlive: boolean = true;
  @State accountName: string = '';
  @State accountLogin: string = '';
  @State accountTailnet: string = '';
  @State accountAddresses: string = '';
  @StorageLink('tailscaleAuthUrl') storedAuthUrl: string = '';
  @StorageLink('tailscaleAccount') storedAccount: string = '';
  @StorageLink('tsnetAuthMode') authModeState: string = '';
  @StorageLink('tailnetGatewayTarget') storedTailnetTarget: string = '';
  private gatewayProxyApplied: boolean = false;
  private recoveryAttempted: boolean = false;
  private startTimer: number = -1;

  /** 以 TailscaleTunnelStore 发布的阶段为准（引擎在 App 进程内启动/轮询） */
  onStoreStage(): void {
    if (this.storeStage === 'ready') {
      if (this.stage !== STAGE_READY) {
        this.stage = STAGE_READY;
        this.failureKind = '';
        this.loadAccountSummary();
        this.refreshPeers();
      }
      return;
    }
    if (this.storeStage === 'needsLogin') {
      this.stage = STAGE_NEEDS_LOGIN;
      return;
    }
    if (this.storeStage === 'failed') {
      this.stage = STAGE_FAILED;
      if (this.failureKind.length === 0) {
        this.failureKind = 'backendStart';
      }
      return;
    }
    if (this.storeStage === 'waitingRoutes') {
      this.stage = STAGE_WAITING_ROUTES;
      return;
    }
    if (this.storeStage === 'starting') {
      this.stage = STAGE_STARTING;
      return;
    }
    if (this.storeStage === 'disabled') {
      this.stage = STAGE_DISABLED;
    }
  }

  aboutToAppear(): void {
    const prefs: PreferencesStore = PreferencesStore.get();
    this.tunnelEnabled = prefs.getBoolean(KEY_ENABLED, false);
    this.nodeName = prefs.getString(KEY_NODE_NAME, '');
    if (this.nodeName.length === 0) {
      this.nodeName = this.defaultNodeName();
      prefs.putString(KEY_NODE_NAME, this.nodeName);
    }
    this.authKey = prefs.getString(KEY_AUTH_KEY, '');
    this.controlURL = prefs.getString(KEY_CONTROL_URL, '');
    this.gatewayViaTailnet = prefs.getBoolean(KEY_GATEWAY_VIA_TAILNET, false);
    this.tailnetTarget = prefs.getString(KEY_TAILNET_TARGET, '');
    this.fastAuthKey = '';
    this.keepAlive = prefs.getBoolean('tunnelKeepAlive', true);
    if (this.tailnetTarget.length === 0 && this.storedTailnetTarget.length > 0) {
      this.tailnetTarget = this.storedTailnetTarget;
    }
    this.onStoreStage();
    if (this.tunnelEnabled) {
      this.refreshPeers();
    }
    if (this.pendingTailscaleLogin) {
      this.pendingTailscaleLogin = false;
      setTimeout(() => this.startLogin(), 900);
    }
  }

  onPageShow(): void {
    this.onStoreStage();
    if (this.stage === STAGE_READY) {
      this.loadAccountSummary();
      this.refreshPeers();
    }
  }

  /** 页面打开/回前台：引擎已在运行就直接同步状态，避免重复 start 导致状态回退 */
  private resumeFromStatus(): void {
    if (this.stage === STAGE_READY) {
      this.pollStatus(0);
      return;
    }
    const status: string = TsnetBridge.status();
    if (status.indexOf('state=Running') >= 0) {
      this.stage = STAGE_READY;
      this.failureKind = '';
      this.loadAccountSummary();
      this.refreshPeers();
      this.pollStatus(0);
      return;
    }
    if (status.indexOf('state=Starting') >= 0 || status.indexOf('starting') >= 0) {
      this.stage = STAGE_WAITING_ROUTES;
      this.backendLog = status;
      this.pollStatus(0);
      return;
    }
    if (status.indexOf('state=NeedsLogin') >= 0 || TsnetBridge.authURL().startsWith('http')) {
      this.stage = STAGE_NEEDS_LOGIN;
      this.loginUrl = TsnetBridge.authURL();
      this.pollStatus(0);
      return;
    }
    this.beginStart();
  }

  /** 读取账号摘要（backendAccount JSON）并渲染 */
  private loadAccountSummary(): void {
    const json: string = TsnetBridge.account();
    if (json.length === 0 || json.indexOf('{') < 0) {
      return;
    }
    this.accountName = this.jsonField(json, 'displayName');
    this.accountLogin = this.jsonField(json, 'loginName');
    this.accountTailnet = this.jsonField(json, 'tailnetName');
    this.accountAddresses = this.jsonField(json, 'addresses');
  }

  private jsonField(json: string, key: string): string {
    const marker: string = '"' + key + '":';
    const index: number = json.indexOf(marker);
    if (index < 0) {
      return '';
    }
    let rest: string = json.substring(index + marker.length).trim();
    if (rest.startsWith('[')) {
      const end: number = rest.indexOf(']');
      if (end < 0) {
        return '';
      }
      return rest.substring(1, end).replaceAll('"', '').replaceAll(' ', '');
    }
    if (!rest.startsWith('"')) {
      return '';
    }
    rest = rest.substring(1);
    const quote: number = rest.indexOf('"');
    return quote < 0 ? '' : rest.substring(0, quote);
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#FFFFFF' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  /** 状态文案（与 iOS tunnelStageLabel 同词） */
  private stageLabel(): string {
    if (this.stage === STAGE_STARTING) {
      return '启动中';
    }
    if (this.stage === STAGE_NEEDS_LOGIN) {
      return '需要登录';
    }
    if (this.stage === STAGE_WAITING_ROUTES) {
      return '正在建立连接';
    }
    if (this.stage === STAGE_READY) {
      return '已连接';
    }
    if (this.stage === STAGE_FAILED) {
      // 运行库不可用是平台能力缺失，不是连接故障，文案要区分
      if (this.failureKind === 'nativeLoad') {
        return '当前平台不支持';
      }
      return '连接失败';
    }
    return '未启用';
  }

  private stageColor(): string {
    if (this.stage === STAGE_READY) {
      return '#34C759';
    }
    if (this.stage === STAGE_FAILED && this.failureKind === 'nativeLoad') {
      // 平台不支持用中性灰，避免看起来像网络故障
      return '#8E8E93';
    }
    if (this.stage === STAGE_FAILED || this.stage === STAGE_DISABLED) {
      return '#FF3B30';
    }
    return '#2E6BE6';
  }

  private stageTransient(): boolean {
    return this.stage === STAGE_STARTING || this.stage === STAGE_NEEDS_LOGIN || this.stage === STAGE_WAITING_ROUTES;
  }

  /** 失败原因（与 iOS tunnelFailureText 同词） */
  private failureText(): string {
    if (this.failureKind === 'nativeLoad') {
      return '运行库加载失败';
    }
    if (this.failureKind === 'backendStart') {
      return '节点启动失败';
    }
    if (this.failureKind === 'loginWait') {
      return '登录等待超时';
    }
    if (this.failureKind === 'status') {
      return '状态查询失败';
    }
    if (this.failureKind === 'interfaceSource') {
      return '网络接口读取失败';
    }
    return '未知错误';
  }

  private setEnabled(next: boolean): void {
    this.tunnelEnabled = next;
    PreferencesStore.get().putBoolean(KEY_ENABLED, next);
    if (next) {
      this.stage = STAGE_STARTING;
      TsnetBridge.start(this.stateDir(), this.deviceModel(), this.osVersion(), this.effectiveControlURL());
    } else {
      this.stop();
    }
  }

  /** 仅接受真实 http(s) 登录链接（引擎未就绪时会返回 FAILED 文本） */
  private validAuthUrl(raw: string): string {
    if (raw.startsWith('https://') || raw.startsWith('http://')) {
      return raw;
    }
    return '';
  }

  private stateDir(): string {
    try {
      return getContext(this).filesDir + '/tailscale';
    } catch (err) {
      return '';
    }
  }

  /** 默认节点名：对齐 iOS（设备名清洗 + 平台后缀） */
  private defaultNodeName(): string {
    let raw: string = '';
    try {
      raw = deviceInfo.marketName.length > 0 ? deviceInfo.marketName : deviceInfo.productModel;
    } catch (err) {
      raw = 'harmony';
    }
    let name: string = '';
    for (let i = 0; i < raw.length; i++) {
      const ch: string = raw.charAt(i).toLowerCase();
      const code: number = ch.charCodeAt(0);
      const isAlnum: boolean = (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
      name += isAlnum ? ch : '-';
    }
    name = name.replaceAll('--', '-');
    while (name.startsWith('-')) {
      name = name.substring(1);
    }
    while (name.endsWith('-')) {
      name = name.substring(0, name.length - 1);
    }
    if (name.length === 0) {
      name = 'harmony';
    }
    return name + '-harmony';
  }

  private deviceModel(): string {
    try {
      return deviceInfo.productModel;
    } catch (err) {
      return 'HarmonyOS';
    }
  }

  private osVersion(): string {
    try {
      return deviceInfo.osFullName;
    } catch (err) {
      return '';
    }
  }

  private stopTimer(): void {
    if (this.startTimer >= 0) {
      clearTimeout(this.startTimer);
      this.startTimer = -1;
    }
  }

  private beginStart(): void {
    this.stopTimer();
    this.stage = STAGE_STARTING;
    this.failureKind = '';
    this.nodeAddress = '';
    this.peerCount = 0;
    const liveStatus: string = TsnetBridge.status();
    if (liveStatus.indexOf('state=Running') >= 0 || liveStatus.indexOf('state=Starting') >= 0 ||
        liveStatus.indexOf('starting') >= 0) {
      const running: boolean = liveStatus.indexOf('state=Running') >= 0;
      Logger.info('TSDBG beginStart reuse live engine running=' + running);
      this.backendLog = liveStatus;
      this.stage = running ? STAGE_READY : STAGE_WAITING_ROUTES;
      if (running) {
        this.loadAccountSummary();
        this.refreshPeers();
      }
      this.pollStatus(0);
      return;
    }
    const hello: string = TsnetBridge.hello();
    Logger.info('TSDBG hello=' + hello);
    this.backendLog = hello;
    if (hello.indexOf('OK') < 0) {
      this.stage = STAGE_FAILED;
      this.failureKind = 'nativeLoad';
      return;
    }
    const started: string = TsnetBridge.start(this.stateDir(), this.deviceModel(), this.osVersion(), this.effectiveControlURL());
    Logger.info('TSDBG start=' + started.substring(0, 200));
    this.backendLog = started;
    if (started.indexOf('FAILED') >= 0 && started.indexOf('running') < 0) {
      this.stage = STAGE_FAILED;
      this.failureKind = 'backendStart';
      return;
    }
    this.pollStatus(0);
  }

  /** 轮询 Go 引擎状态：state=Running / NeedsLogin / Starting */
  private pollStatus(tick: number): void {
    if (this.stage === STAGE_DISABLED || tick > 150) {
      return;
    }
    if (tick === 30 && this.stage === STAGE_WAITING_ROUTES && !this.recoveryAttempted) {
      this.recoveryAttempted = true;
      Logger.warn('TSDBG recovery restart engine after stuck starting');
      TsnetBridge.stop();
      setTimeout(() => {
        this.beginStart();
      }, 800);
      return;
    }
    const status: string = TsnetBridge.status();
    this.backendLog = status;
    if (tick % 5 === 0) {
      Logger.info('TSDBG status=' + status.substring(0, 200));
    }
    if (status.indexOf('FAILED') >= 0) {
      this.stage = STAGE_FAILED;
      this.failureKind = 'status';
      return;
    }
    const auth: string = this.validAuthUrl(TsnetBridge.authURL());
    if (auth.length > 0) {
      this.loginUrl = auth;
      if (this.stage !== STAGE_NEEDS_LOGIN) {
        this.stage = STAGE_NEEDS_LOGIN;
      }
    } else if (status.indexOf('state=Running') >= 0) {
      this.stage = STAGE_READY;
      this.failureKind = '';
      this.loadAccountSummary();
      this.refreshPeers();
      if (this.gatewayViaTailnet && !this.gatewayProxyApplied) {
        this.applyGatewayProxy();
      }
    } else if (status.indexOf('state=Stopped') >= 0) {
      this.stage = STAGE_FAILED;
      this.failureKind = 'backendStart';
      return;
    } else {
      this.stage = STAGE_WAITING_ROUTES;
    }
    this.startTimer = setTimeout(() => {
      this.pollStatus(tick + 1);
    }, 1500);
  }

  private refreshPeers(): void {
    const peersJson: string = TsnetBridge.peers();
    let count: number = 0;
    const marker: string = '"stableID"';
    let index: number = peersJson.indexOf(marker);
    while (index >= 0) {
      count += 1;
      index = peersJson.indexOf(marker, index + marker.length);
    }
    if (count === 0) {
      const keyMarker: string = '"key"';
      let keyIndex: number = peersJson.indexOf(keyMarker);
      while (keyIndex >= 0) {
        count += 1;
        keyIndex = peersJson.indexOf(keyMarker, keyIndex + keyMarker.length);
      }
    }
    this.peerCount = count;
    if (this.accountAddresses.length > 0) {
      this.nodeAddress = this.accountAddresses.split(',')[0];
    }
  }

  private stop(): void {
    this.stopTimer();
    TsnetBridge.stop();
    this.stage = STAGE_DISABLED;
    this.failureKind = '';
    this.nodeAddress = '';
    this.peerCount = 0;
    this.loginUrl = '';
    this.backendLog = '';
  }

  private copyLoginUrl(): void {
    const url: string = this.validAuthUrl(this.loginUrl);
    if (url.length === 0) {
      return;
    }
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, url);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        this.loginResult = '登录链接已复制，可粘贴到浏览器打开：\n' + url;
      }).catch(() => {
      });
    } catch (err) {
      Logger.warn('copy login url failed');
    }
  }

  /** 用系统浏览器打开登录链接：优先 openLink（允许回退浏览器），失败再指定浏览器，最后复制链接 */
  private openLoginUrl(): void {
    const url: string = this.validAuthUrl(this.loginUrl);
    if (url.length === 0) {
      this.copyLoginUrl();
      return;
    }
    this.loginUrl = url;
    let context: common.UIAbilityContext;
    try {
      context = getContext(this) as common.UIAbilityContext;
    } catch (err) {
      this.copyLoginUrl();
      return;
    }
    Logger.info('TSDBG openLink begin url=' + url.substring(0, 80));
    context.openLink(url, { appLinkingOnly: false }).then(() => {
      Logger.info('TSDBG openLink ok');
    }).catch((linkErr: Error) => {
      Logger.warn('TSDBG openLink failed: ' + linkErr.message);
      const want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url,
        bundleName: 'com.huawei.hmos.browser'
      };
      context.startAbility(want).then(() => {
        Logger.info('login url opened via browser ability');
      }).catch((browserErr: Error) => {
        Logger.warn('browser ability failed: ' + browserErr.message);
        this.copyLoginUrl();
      });
    });
  }

  private startLogin(): void {
    if (this.authKey.trim().length > 0) {
      PreferencesStore.get().putString('tsnetAuthKey', this.authKey.trim());
      this.loginResult = '正在使用登录密钥启动轻量隧道…';
      this.dialogOpen = true;
      TailscaleTunnelStore.get().reloadFast();
      return;
    }
    let rawAuth: string = this.loginUrl.length > 0 ? this.loginUrl : TsnetBridge.authURL();
    if (this.validAuthUrl(rawAuth).length === 0 && this.validAuthUrl(this.storedAuthUrl).length > 0) {
      rawAuth = this.storedAuthUrl;
    }
    const auth: string = this.validAuthUrl(rawAuth);
    Logger.info('TSDBG startLogin authLen=' + auth.length);
    if (auth.length > 0) {
      this.loginUrl = auth;
      this.loginResult = '正在浏览器打开 Tailscale 登录页：\n' + auth;
      this.openLoginUrl();
    } else {
      this.loginResult = '尚未获取登录地址，请先启用内嵌隧道并等待状态变为「需要登录」。';
    }
    this.dialogOpen = true;
  }

  /** 解析当前网关地址：[host, port, tls] */
  private parseEndpoint(url: string): string[] {
    if (url.length === 0) {
      return [];
    }
    let tls: string = '0';
    let rest: string = url;
    if (rest.indexOf('wss://') === 0 || rest.indexOf('https://') === 0) {
      tls = '1';
    }
    const schemeIndex: number = rest.indexOf('://');
    if (schemeIndex >= 0) {
      rest = rest.substring(schemeIndex + 3);
    }
    const slash: number = rest.indexOf('/');
    if (slash >= 0) {
      rest = rest.substring(0, slash);
    }
    let port: string = tls === '1' ? '443' : '80';
    const colon: number = rest.lastIndexOf(':');
    if (colon > 0) {
      port = rest.substring(colon + 1);
      rest = rest.substring(0, colon);
    }
    return [rest, port, tls];
  }

  /** 网关经内嵌 tailnet（仅本应用流量，不占系统 VPN） */
  private setGatewayViaTailnet(next: boolean): void {
    this.gatewayViaTailnet = next;
    PreferencesStore.get().putBoolean(KEY_GATEWAY_VIA_TAILNET, next);
    if (next) {
      this.applyGatewayProxy();
    } else {
      this.clearGatewayProxy();
    }
  }

  private applyGatewayProxy(): void {
    let endpoint: string[] = [];
    const target: string = this.tailnetTarget.trim();
    if (target.length === 0) {
      this.gatewayProxyHint = '请先填写 tailnet 目标（网关主机名:端口），再开启此项';
      this.gatewayViaTailnet = false;
      PreferencesStore.get().putBoolean(KEY_GATEWAY_VIA_TAILNET, false);
      return;
    }
    if (target.length > 0) {
      const colon: number = target.lastIndexOf(':');
      if (colon > 0) {
        endpoint = [target.substring(0, colon), target.substring(colon + 1), '0'];
      } else {
        endpoint = [target, '3081', '0'];
      }
    } else {
      endpoint = this.parseEndpoint(GatewayClient.get().currentWsUrl());
    }
    if (endpoint.length < 2) {
      this.gatewayProxyHint = '没有已保存的网关地址，请先配对主机';
      this.gatewayViaTailnet = false;
      return;
    }
    const port: number = Number.parseInt(endpoint[1], 10);
    const useTLS: number = endpoint[2] === '1' ? 1 : 0;
    const result: string = TsnetBridge.proxyStart(endpoint[0], port, GATEWAY_PROXY_PORT, useTLS);
    this.gatewayProxyHint = result;
    if (result.indexOf('OK') === 0) {
      this.gatewayProxyApplied = true;
      GatewayClient.get().setTailnetProxy(true, GATEWAY_PROXY_PORT);
      GatewayClient.get().reconnectCurrent();
    } else {
      this.gatewayViaTailnet = false;
    }
  }

  private clearGatewayProxy(): void {
    TsnetBridge.proxyStop();
    this.gatewayProxyApplied = false;
    this.gatewayProxyHint = '已切回直连';
    GatewayClient.get().setTailnetProxy(false, 0);
    GatewayClient.get().reconnectCurrent();
  }

  /** 应用内 tailnet 代理：不创建 TUN、不占系统 VPN 槽位 */
  private startProxy(): void {
    const host: string = this.proxyHost.trim();
    const targetPort: number = Number.parseInt(this.proxyPort, 10);
    const localPort: number = Number.parseInt(this.proxyLocalPort, 10);
    if (host.length === 0) {
      this.proxyStatus = '请填写 tailnet 目标主机（网关的 tailscale 主机名/IP）';
      return;
    }
    if (Number.isNaN(targetPort) || Number.isNaN(localPort)) {
      this.proxyStatus = '端口必须是数字';
      return;
    }
    this.proxyStatus = TsnetBridge.proxyStart(host, targetPort, localPort, 0);
  }

  private stopProxy(): void {
    this.proxyStatus = TsnetBridge.proxyStop();
  }

  private saveNodeName(value: string): void {
    this.nodeName = value;
    PreferencesStore.get().putString(KEY_NODE_NAME, value);
  }

  private saveAuthKey(value: string): void {
    this.authKey = value;
    PreferencesStore.get().putString(KEY_AUTH_KEY, value);
    PreferencesStore.get().putString('tsnetAuthKey', value.trim());
  }

  /** Auth Key 失效时改用浏览器登录：清空密钥并让轻量引擎重新给出登录链接 */
  private browserReauth(): void {
    this.authKey = '';
    PreferencesStore.get().putString(KEY_AUTH_KEY, '');
    PreferencesStore.get().putString('tsnetAuthKey', '');
    TailscaleTunnelStore.get().reauthorizeWithBrowser();
    this.loginResult = '已清空失效的登录密钥，正在改用浏览器登录…';
    this.dialogOpen = true;
  }

  /** 是否显示失败详情（用方法包一层，避免 TS 把 this.stage 收窄成字面量） */
  private showProblemSection(): boolean {
    return this.stage === STAGE_FAILED;
  }

  private pillBg(): string {
    return this.isDark ? '#23324D' : '#EAF1FF';
  }

  /** 状态卡片上的账号摘要 */
  private identitySummary(): string {
    if (this.accountTailnet.length > 0) {
      return '账号 ' + this.accountTailnet;
    }
    if (this.accountName.length > 0) {
      return '账号 ' + this.accountName;
    }
    return '账号 未登录';
  }

  private saveControlURL(value: string): void {
    this.controlURL = value;
    PreferencesStore.get().putString(KEY_CONTROL_URL, value.trim());
  }

  /** 控制平面地址：留空即官方 controlplane；自建 Headscale 等填自己的域名 */
  private effectiveControlURL(): string {
    const value: string = this.controlURL.trim();
    return value.length > 0 ? value : DEFAULT_CONTROL_URL;
  }

  @Builder
  sectionHeader(title: string) {
    Text(title)
      .fontSize(13)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 16, right: 16, top: 18, bottom: 7 })
  }

  @Builder
  sectionFooter(text: string) {
    Text(text)
      .fontSize(12)
      .lineHeight(18)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 16, right: 16, top: 7 })
  }

  @Builder
  cardBox() {
    Column() {
      // 由调用方填充
    }
    .width('100%')
  }

  @Builder
  dialogSheet() {
    Column({ space: 14 }) {
      Text('添加 Tailscale 账号')
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .width('100%')
      Text(this.loginResult.length > 0 ? this.loginResult : '点击下方按钮后，应用会在本机创建 Tailscale 节点并返回登录链接。')
        .fontSize(14)
        .lineHeight(21)
        .fontColor(this.subColor())
        .width('100%')
      Text('登录完成后，节点状态和本机代理会由应用维护；用户不需要安装 WireGuard 或 Tailscale。')
        .fontSize(14)
        .lineHeight(21)
        .fontColor(this.subColor())
        .width('100%')
      Row({ space: 10 }) {
        if (this.loginResult.length > 0 && this.loginUrl.length > 0) {
          Text('复制链接')
            .fontSize(15)
            .fontColor(this.subColor())
            .layoutWeight(1)
            .height(44)
            .textAlign(TextAlign.Center)
            .borderRadius(9)
            .border({ width: 0.5, color: this.dividerColor() })
            .onClick(() => {
              this.copyLoginUrl();
            })
          Text('重新打开')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor('#2E6BE6')
            .layoutWeight(1)
            .height(44)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.openLoginUrl();
            })
        } else {
          Text('在浏览器登录')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor('#2E6BE6')
            .layoutWeight(1)
            .height(44)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.startLogin();
            })
        }
        Text('关闭')
          .fontSize(15)
          .fontColor(this.subColor())
          .layoutWeight(1)
          .height(44)
          .textAlign(TextAlign.Center)
          .borderRadius(9)
          .border({ width: 0.5, color: this.dividerColor() })
          .onClick(() => {
            this.dialogOpen = false;
          })
      }
      .width('100%')
      .padding({ top: 4 })
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 20, bottom: 8 })
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
      Column() {
      // 导航栏
      Row() {
        Row() {
          Text('‹')
            .fontSize(24)
            .fontColor(this.textColor())
        }
        .width(44)
        .height(44)
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          this.pageStack.pop();
        })

        Text('Tailscale 内嵌隧道')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(44).height(44)
      }
      .width('100%')
      .height(56)
      .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })

      Scroll() {
        Column() {

          // ── 节点状态卡片（顶部总览，对齐设备卡片样式）──
          this.sectionHeader('节点状态')
          Column({ space: 10 }) {
            Row() {
              TailscaleMarkView({
                connected: this.stage === STAGE_READY,
                tint: this.isDark ? '#8AB4FF' : '#2E6BE6',
                markSize: 34
              })
                .translate({ y: -1 })
              Column({ space: 2 }) {
                Text(this.nodeName.length > 0 ? this.nodeName : this.defaultNodeName())
                  .fontSize(17)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.textColor())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
                Text('HarmonyOS · ' + this.deviceModel())
                  .fontSize(11)
                  .fontColor(this.subColor())
                  .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              .margin({ left: 10 })
              Row({ space: 5 }) {
                Circle({ width: 7, height: 7 }).fill(this.stageColor())
                Text(this.stageLabel()).fontSize(12).fontColor(this.stageColor())
              }
              .padding({ left: 9, right: 9, top: 4, bottom: 4 })
              .backgroundColor(this.pillBg())
              .borderRadius(20)
            }
            .width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              Text(this.identitySummary()).fontSize(11).fontColor('#2E6BE6')
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .backgroundColor(this.pillBg()).borderRadius(8).margin({ right: 6, bottom: 4 })
              Text(this.authModeState === 'authKey' ? 'Auth Key' : '浏览器登录').fontSize(11).fontColor('#2E6BE6')
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .backgroundColor(this.pillBg()).borderRadius(8).margin({ right: 6, bottom: 4 })
              Text(this.controlURL.trim().length > 0 ? '自建控制面' : '官方控制面').fontSize(11).fontColor('#2E6BE6')
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .backgroundColor(this.pillBg()).borderRadius(8).margin({ right: 6, bottom: 4 })
              Text('轻量 tsnet').fontSize(11).fontColor('#2E6BE6')
                .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                .backgroundColor(this.pillBg()).borderRadius(8).margin({ right: 6, bottom: 4 })
            }
            .width('100%')
            Divider().color(this.dividerColor()).strokeWidth(1)
            Row() {
              Text('当前地址').fontSize(14).fontColor(this.subColor())
              Blank()
              Text(this.nodeAddress.length > 0 ? this.nodeAddress :
                (this.stage === STAGE_READY ? '已连接' : '未连接'))
                .fontSize(13)
                .fontColor(this.nodeAddress.length > 0 ? this.textColor() : this.subColor())
            }
            .width('100%')
            Row({ space: 8 }) {
              if (this.stage === STAGE_NEEDS_LOGIN) {
                Text(this.loginUrl.length > 0 ? '去授权' : '获取登录链接')
                  .fontSize(14).fontColor('#FFFFFF').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor('#2E6BE6').borderRadius(10)
                  .onClick(() => {
                    this.loginResult = '';
                    this.dialogOpen = true;
                    this.startLogin();
                  })
              } else if (this.stage === STAGE_READY) {
                Text('重新连接')
                  .fontSize(14).fontColor(this.textColor()).layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor(this.pillBg()).borderRadius(10)
                  .onClick(() => {
                    this.beginStart();
                  })
              } else {
                Text('启动隧道')
                  .fontSize(14).fontColor('#FFFFFF').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor('#2E6BE6').borderRadius(10)
                  .onClick(() => {
                    this.setEnabled(true);
                    this.beginStart();
                  })
              }
              if (this.stage !== STAGE_DISABLED) {
                Text('停止')
                  .fontSize(14).fontColor('#FF3B30').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor(this.pillBg()).borderRadius(10)
                  .onClick(() => {
                    this.setEnabled(false);
                  })
              }
            }
            .width('100%')
            if (this.authInvalid) {
              Text('已保存的 Auth Key 无法加入 tailnet（可能过期或被撤销）。可以改用浏览器登录完成授权，或在下方重新填写密钥。')
                .fontSize(12).lineHeight(18).fontColor('#C2410C').width('100%')
              Text('改用浏览器登录')
                .fontSize(14).fontColor('#2E6BE6').height(34)
                .onClick(() => {
                  this.browserReauth();
                })
            }
          }
          .width('100%')
          .padding(16)
          .alignItems(HorizontalAlign.Start)
          .backgroundColor(this.cardBg())
          .border({ width: 1, color: this.dividerColor() })
          .borderRadius(14)
          .clip(true)

          // ── 区块 1：启用内嵌隧道 ──
          this.sectionHeader('Tailscale 内嵌隧道')
          Row() {
            Text('启用内嵌隧道')
              .fontSize(16)
              .fontColor(this.textColor())
              .layoutWeight(1)
            Toggle({ type: ToggleType.Switch, isOn: this.tunnelEnabled })
              .selectedColor('#2E6BE6')
              .onChange((value: boolean) => {
                this.setEnabled(value);
              })
          }
          .width('100%')
          .height(52)
          .padding({ left: 16, right: 16 })
          .backgroundColor(this.cardBg())

          .border({ width: 1, color: this.dividerColor() })

          .borderRadius(14)

          .clip(true)
          this.sectionFooter('在应用内建立一个 Tailscale 节点：不需要安装 Tailscale，也不会占用系统 VPN。节点只在你自己的 tailnet 内可达。')



          // ── 区块 2：账号与网络 ──
          this.sectionHeader('账号与网络')
          Column() {
            if (this.accountName.length > 0) {
              Row() {
                Column({ space: 3 }) {
                  Text(this.accountName).fontSize(16).fontColor(this.textColor())
                  if (this.accountLogin.length > 0 && this.accountLogin !== this.accountName) {
                    Text(this.accountLogin).fontSize(12).fontColor(this.subColor())
                  }
                  if (this.accountTailnet.length > 0 && this.accountTailnet !== this.accountName &&
                      this.accountTailnet !== this.accountLogin) {
                    Text(this.accountTailnet).fontSize(12).fontColor(this.subColor())
                  }
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                SymbolGlyph($r('sys.symbol.checkmark'))
                  .fontSize(20)
                  .fontColor(['#2E6BE6'])
              }
              .width('100%')
              .height(64)
              .padding({ left: 16, right: 16 })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
            }
            Row({ space: 8 }) {
              SymbolGlyph($r('sys.symbol.plus'))
                .fontSize(18)
                .fontColor(['#2E6BE6'])
              Text('添加 Tailscale 账号')
                .fontSize(16)
                .fontColor('#2E6BE6')
            }
            .width('100%')
            .height(60)
            .padding({ left: 16, right: 16 })
            .onClick(() => {
              this.loginResult = '';
              this.dialogOpen = true;
            })
          }
          .width('100%')
          .backgroundColor(this.cardBg())

          .border({ width: 1, color: this.dividerColor() })

          .borderRadius(14)

          .clip(true)
          this.sectionFooter('仅显示已登录账号。点击账号可切换网络，登录状态会分别保留。')


          // ── 连接问题（仅失败时展示；状态总览已在顶部卡片，避免重复）──
          if (this.tunnelEnabled && this.showProblemSection()) {
            this.sectionHeader('连接问题')
            Column() {
              Row({ space: 8 }) {
                Circle({ width: 8, height: 8 }).fill(this.stageColor())
                Text(this.stageLabel())
                  .fontSize(16)
                  .fontColor(this.textColor())
                Blank()
                if (this.stageTransient()) {
                  LoadingProgress().width(18).height(18).color(this.subColor())
                } else if (this.peerCount > 0) {
                  Text('对端数量 ' + this.peerCount)
                    .fontSize(13)
                    .fontColor(this.subColor())
                }
              }
              .width('100%')
              .height(52)
              .padding({ left: 16, right: 16 })

              if (this.stage === STAGE_FAILED) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('失败原因')
                    .fontSize(16)
                    .fontColor(this.textColor())
                  Blank()
                  Text(this.failureText())
                    .fontSize(15)
                    .fontColor(this.subColor())
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
                Text('这是手机本地 Tailscale 节点运行库的问题，与网关连接无关。网关连接仍可通过局域网或公网地址正常工作。')
                  .fontSize(12)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, bottom: 12 })
              }

              if (this.nodeAddress.length > 0) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('本机地址').fontSize(16).fontColor(this.textColor())
                  Blank()
                  Text(this.nodeAddress).fontSize(15).fontColor(this.subColor())
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
              }

              if (this.validAuthUrl(this.loginUrl).length > 0) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('打开登录链接').fontSize(16).fontColor('#2E6BE6')
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.openLoginUrl();
                })
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('复制链接').fontSize(16).fontColor('#2E6BE6')
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.copyLoginUrl();
                })
              }

              if (this.stage === STAGE_DISABLED || this.stage === STAGE_FAILED) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('继续连接')
                    .fontSize(16)
                    .fontColor('#2E6BE6')
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.recoveryAttempted = false;
                  this.beginStart();
                })
              }

              if (this.stage !== STAGE_DISABLED) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text(this.stage === STAGE_STARTING || this.stage === STAGE_NEEDS_LOGIN ? '停止启动' : '停止隧道')
                    .fontSize(16)
                    .fontColor('#FF3B30')
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.setEnabled(false);
                })
              }

              if (this.stage === STAGE_NEEDS_LOGIN) {
                Text('等待你在浏览器里完成登录。')
                  .fontSize(12)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 2, bottom: 12 })
              }
            }
            .width('100%')
            .backgroundColor(this.cardBg())

            .border({ width: 1, color: this.dividerColor() })

            .borderRadius(14)

            .clip(true)
          }

          // ── 账号与节点：登录方式 / 节点名 / 控制平面 / 登录密钥（已整合原「节点身份」）──
          if (this.tunnelEnabled) {
            this.sectionHeader('账号与节点')
            Column() {
              Row() {
                Text('登录方式').fontSize(16).fontColor(this.textColor())
                Blank()
                Text(this.authModeState === 'authKey' ? '登录密钥（Auth Key）' :
                  this.authModeState === 'account' ? '账号登录' : '未启用轻量引擎')
                  .fontSize(15)
                  .fontColor(this.authModeState.length > 0 ? '#2E6BE6' : this.subColor())
                Text(' ›').fontSize(16).fontColor(this.subColor())
              }
              .width('100%')
              .height(52)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.authModeDialog = true;
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              TextInput({ text: this.nodeName, placeholder: '节点名称' })
                .fontSize(16)
                .fontColor(this.textColor())
                .placeholderColor(this.subColor())
                .backgroundColor(Color.Transparent)
                .height(48)
                .padding({ left: 16, right: 16 })
                .onChange((value: string) => {
                  this.saveNodeName(value);
                })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              TextInput({ text: this.authKey, placeholder: 'tskey-auth-…（可选：你自己的 Tailscale 账号生成）' })
                .fontSize(16)
                .fontColor(this.textColor())
                .placeholderColor(this.subColor())
                .backgroundColor(Color.Transparent)
                .height(48)
                .padding({ left: 16, right: 16 })
                .onChange((value: string) => {
                  this.saveAuthKey(value);
                })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              TextInput({ text: this.controlURL, placeholder: 'https://controlplane.tailscale.com' })
                .fontSize(16)
                .fontColor(this.textColor())
                .placeholderColor(this.subColor())
                .backgroundColor(Color.Transparent)
                .height(48)
                .padding({ left: 16, right: 16 })
                .onChange((value: string) => {
                  this.saveControlURL(value);
                })
              Text('控制平面地址：留空即官方 controlplane；自建 Headscale 填自己的域名。留空登录密钥时，开启后点「登录链接」用浏览器授权你自己的 Tailscale 账号。')
                .fontSize(12)
                .lineHeight(18)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 16, right: 16, bottom: 12 })
              if (this.authKey.length > 0) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('使用登录密钥连接')
                    .fontSize(16)
                    .fontColor('#2E6BE6')
                }
                .width('100%')
                .height(48)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  PreferencesStore.get().putString('tsnetAuthKey', this.authKey.trim());
                  this.fastHint = this.authKey.trim().length > 0
                    ? '正在用登录密钥启动轻量隧道…（无需浏览器登录）'
                    : '请先在上方填写 auth key';
                  TailscaleTunnelStore.get().reloadFast();
                })
              }
            }
            .width('100%')
            .backgroundColor(this.cardBg())

            .border({ width: 1, color: this.dividerColor() })

            .borderRadius(14)

            .clip(true)
            this.sectionFooter('节点名称只允许小写字母、数字和连字符。登录时默认在浏览器里完成；也可以粘贴 Tailscale 控制台生成的 Auth Key。')
          }

          Blank().height(28)
        }
        .width('100%')
        .padding({ left: 16, right: 16 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())

      if (this.authModeDialog) {
        Column() {
          Column({ space: 0 }) {
            Text('切换登录方式').fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.textColor())
              .width('100%').textAlign(TextAlign.Center).padding({ top: 18, bottom: 12 })
            Divider().color(this.dividerColor()).strokeWidth(1)
            Row() {
              Column({ space: 3 }) {
                Text('账号登录').fontSize(16).fontColor(this.textColor())
                Text('浏览器授权一次，之后用已保存的登录态').fontSize(11).fontColor(this.subColor())
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text(this.authModeState === 'account' ? '✓' : '').fontSize(16).fontColor('#2E6BE6')
            }
            .width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              PreferencesStore.get().putString('tsnetAuthKey', '');
              this.authKey = '';
              this.authModeDialog = false;
              TailscaleTunnelStore.get().reloadFast();
              this.fastHint = '已切换为账号登录';
            })
            Divider().color(this.dividerColor()).strokeWidth(1)
            Row() {
              Column({ space: 3 }) {
                Text('登录密钥（Auth Key）').fontSize(16).fontColor(this.textColor())
                Text('每次启动自动授权，无需浏览器登录').fontSize(11).fontColor(this.subColor())
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Text(this.authModeState === 'authKey' ? '✓' : '').fontSize(16).fontColor('#2E6BE6')
            }
            .width('100%').padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              this.authModeDialog = false;
              this.fastHint = '请在「节点身份」填写 Auth Key，然后点「使用登录密钥连接」';
            })
            Divider().color(this.dividerColor()).strokeWidth(1)
            Text('取消').fontSize(16).fontColor(this.subColor())
              .width('100%').height(48).textAlign(TextAlign.Center)
              .onClick(() => { this.authModeDialog = false; })
          }
          .width('86%')
          .backgroundColor(this.cardBg())
          .borderRadius(16)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('rgba(0,0,0,0.35)')
        .onClick(() => {
          this.authModeDialog = false;
        })
      }

      if (this.dialogOpen) {
        Column() {
          Column() {
            this.dialogSheet()
          }
          .width('86%')
          .backgroundColor(this.cardBg())
          .borderRadius(16)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('rgba(0,0,0,0.35)')
        .onClick(() => {
          this.dialogOpen = false;
        })
      }
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
