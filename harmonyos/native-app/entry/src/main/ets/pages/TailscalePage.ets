import { PreferencesStore, Logger, GatewayClient } from 'nativecore';
import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import type Want from '@ohos.app.ability.Want';
import { deviceInfo } from '@kit.BasicServicesKit';
import { KeyboardAvoidMode, uiMaterial } from '@kit.ArkUI';
import { fileIo } from '@kit.CoreFileKit';
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
 * 布局：节点状态卡片（总览 + 当前连接类型 + 账号/AuthKey 登录按钮）/ 账号与网络 / 节点身份（Auth Key + 自建控制平面折叠）。
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
  @StorageLink('tailscaleStageError') stageError: string = '';
  @State hintMenuOpen: string = '';
  @State hintText: string = '';

  @State tunnelEnabled: boolean = false;
  @State nodeName: string = '';
  @State authKey: string = '';
  @State controlURL: string = '';
  @State selfHostedOpen: boolean = false;
  @State authKeySheetOpen: boolean = false;
  @State authKeyDraft: string = '';
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
    // 输入框（Auth Key / 控制平面）在页面底部：RESIZE 让窗口随键盘收缩，Scroll 自动把焦点输入框滚到键盘上方
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    const prefs: PreferencesStore = PreferencesStore.get();
    this.tunnelEnabled = prefs.getBoolean(KEY_ENABLED, false);
    this.nodeName = prefs.getString(KEY_NODE_NAME, '');
    if (this.nodeName.length === 0) {
      this.nodeName = this.defaultNodeName();
      prefs.putString(KEY_NODE_NAME, this.nodeName);
    }
    this.authKey = prefs.getString(KEY_AUTH_KEY, '');
    // 已添加的账号持久化：只要没点删除，重启后仍显示
    if (this.accountName.length === 0) {
      this.accountName = prefs.getString('tailscaleAccountName', '');
      this.accountLogin = prefs.getString('tailscaleAccountLogin', '');
      this.accountTailnet = prefs.getString('tailscaleAccountTailnet', '');
      this.accountAddresses = prefs.getString('tailscaleAccountAddresses', '');
    }
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
      // 轻量 tsnet 引擎不经过 tsd，账号摘要由 store 从快速状态里解析并持久化
      if (this.accountName.length === 0) {
        const prefs: PreferencesStore = PreferencesStore.get();
        this.accountName = prefs.getString('tailscaleAccountName', '');
        this.accountLogin = prefs.getString('tailscaleAccountLogin', '');
        this.accountTailnet = prefs.getString('tailscaleAccountTailnet', '');
        this.accountAddresses = prefs.getString('tailscaleAccountAddresses', '');
      }
      return;
    }
    this.accountName = this.jsonField(json, 'displayName');
    this.accountLogin = this.jsonField(json, 'loginName');
    this.accountTailnet = this.jsonField(json, 'tailnetName');
    this.accountAddresses = this.jsonField(json, 'addresses');
    if (this.accountName.length > 0) {
      const prefs: PreferencesStore = PreferencesStore.get();
      prefs.putString('tailscaleAccountName', this.accountName);
      prefs.putString('tailscaleAccountLogin', this.accountLogin);
      prefs.putString('tailscaleAccountTailnet', this.accountTailnet);
      prefs.putString('tailscaleAccountAddresses', this.accountAddresses);
    }
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
      // 只用轻量 tsnet 引擎（tsd 引擎与它共用状态目录会互相清空）
      TailscaleTunnelStore.get().reloadFast();
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
    // 统一走轻量 tsnet 引擎：状态由 TailscaleTunnelStore 轮询并发布到 tailscaleStage
    const key: string = this.authKey.trim();
    if (key.length > 0) {
      TailscaleTunnelStore.get().applyAuthKey(key);
    } else {
      TailscaleTunnelStore.get().reloadFast();
    }
  }

  /** 轮询 Go 引擎状态：state=Running / NeedsLogin / Starting */
  private pollStatus(tick: number): void {
    // 引擎状态已由 TailscaleTunnelStore 统一轮询发布，这里不再直接驱动 tsd 引擎
    return;
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
    // 先切 UI 状态，再在下一个事件循环里停引擎（tsnet 关闭要等内部 goroutine，直接调会卡住页面）
    this.stage = STAGE_DISABLED;
    setTimeout(() => {
      TailscaleTunnelStore.get().stopFastOnly();
    }, 0);
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

  /** 添加账号：始终走浏览器授权（即使已保存 AuthKey 也不用 key 登录） */
  private startAccountLogin(): void {
    this.loginResult = '正在创建 Tailscale 节点并获取登录链接…';
    this.dialogOpen = true;
    this.connectWithAccount();
    this.pollAccountLoginUrl(0);
  }

  private pollAccountLoginUrl(tick: number): void {
    if (tick > 25) {
      this.loginResult = '获取登录链接超时，请检查手机网络（DNS/代理）后重试';
      return;
    }
    const url: string = AppStorage.get<string>('tailscaleAuthUrl') ?? '';
    if (url.startsWith('http')) {
      this.loginUrl = url;
      this.loginResult = '正在浏览器打开 Tailscale 登录页：\n' + url;
      this.openLoginUrl();
      return;
    }
    setTimeout(() => {
      this.pollAccountLoginUrl(tick + 1);
    }, 1000);
  }

  private startLogin(): void {
    this.dialogOpen = true;
    if (this.authKey.trim().length > 0) {
      PreferencesStore.get().putString('tsnetAuthKey', this.authKey.trim());
      // 引擎已在启动/已连接时不要再 stop+start（会把 UI 线程卡死）
      const fastStat: string = TsnetBridge.statusFast();
      if (fastStat.indexOf('state=Starting') >= 0 || fastStat.indexOf('state=Running') >= 0) {
        this.loginResult = '已保存 Auth Key，正在连接中，请等状态变为「已连接」。';
        return;
      }
      if (this.loginBusy) {
        this.loginResult = '正在启动，请稍候…';
        return;
      }
      this.loginBusy = true;
      setTimeout(() => {
        this.loginBusy = false;
      }, 4000);
      this.loginResult = '正在使用登录密钥启动轻量隧道…';
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

  /** 打开 Tailscale 控制台的 Auth Keys 页面（失败则复制链接） */
  private openAuthKeyPage(): void {
    const url: string = 'https://login.tailscale.com/admin/settings/keys';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const want: Want = {
        action: 'ohos.want.action.viewData',
        entities: ['entity.system.browsable'],
        uri: url
      };
      context.startAbility(want).catch(() => {
        this.copyAuthKeyUrl(url);
      });
    } catch (err) {
      this.copyAuthKeyUrl(url);
    }
  }

  private copyAuthKeyUrl(url: string): void {
    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, url);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      this.fastHint = '已复制 Auth Key 管理页链接，粘贴到浏览器打开';
    }).catch(() => {
    });
  }

  @Builder
  authModeSheetContent() {
    Column({ space: 0 }) {
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)
      Stack({ alignContent: Alignment.Center }) {
        Text('切换登录方式')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Row() {
          Blank()
          Text('取消')
            .fontSize(16)
            .fontColor(this.textColor())
            .height(44)
            .onClick(() => {
              this.authModeDialog = false;
            })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })
      }
      .width('100%')
      .height(48)
      Scroll() {
        Column({ space: 10 }) {
          Row() {
            Column({ space: 3 }) {
              Text('账号登录').fontSize(16).fontColor(this.textColor())
              Text('浏览器授权一次，之后用已保存的登录态').fontSize(11).fontColor(this.subColor())
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            if (this.authModeState === 'account') {
              SymbolGlyph($r('sys.symbol.checkmark')).fontSize(18).fontColor(['#2E6BE6'])
            }
          }
          .width('100%')
          .padding(16)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.38)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)' })
          .borderRadius(16)
          .onClick(() => {
            this.authModeDialog = false;
            this.connectWithAccount();
          })
          Row() {
            Column({ space: 3 }) {
              Text('登录密钥（Auth Key）').fontSize(16).fontColor(this.textColor())
              Text('用已保存的密钥直接加入 tailnet').fontSize(11).fontColor(this.subColor())
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            if (this.authModeState === 'authKey') {
              SymbolGlyph($r('sys.symbol.checkmark')).fontSize(18).fontColor(['#2E6BE6'])
            }
          }
          .width('100%')
          .padding(16)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.38)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)' })
          .borderRadius(16)
          .onClick(() => {
            this.authModeDialog = false;
            if (this.authKey.trim().length === 0) {
              this.fastHint = '请先在「节点身份」填写 Auth Key';
              return;
            }
            this.connectWithAuthKey();
          })
        }
        .width('100%')
        .padding({ left: 14, right: 14, top: 4 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
  }

  /** 半模态材质：与首页「切换主机」一致 */
  private immersiveSupported(): boolean {
    try {
      return uiMaterial.isImmersiveMaterialSupported();
    } catch (err) {
      return false;
    }
  }

  private sheetMaterial(): uiMaterial.Material | undefined {
    if (!this.immersiveSupported()) {
      return undefined;
    }
    return new uiMaterial.ImmersiveMaterial({
      style: uiMaterial.ImmersiveStyle.THICK,
      materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
      colorInvert: true,
      applyShadow: true
    });
  }

  @Builder
  authKeySheetContent() {
    Column({ space: 0 }) {
      // 顶部拖动条（与首页「切换主机」同款）
      Column() {
        Column()
          .width(36)
          .height(4)
          .borderRadius(2)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.22)')
      }
      .width('100%')
      .height(16)
      .justifyContent(FlexAlign.Center)

      // 头部：标题居中 + 左右按钮（与切换主机编辑态一致）
      Stack({ alignContent: Alignment.Center }) {
        Text('填入 Auth Key')
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Row() {
          Text('取消')
            .fontSize(16)
            .fontColor(this.textColor())
            .height(44)
            .onClick(() => {
              this.authKeySheetOpen = false;
            })
          Blank()
          Text('保存')
            .fontSize(16)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
            .height(44)
            .onClick(() => {
              this.saveAuthKey(this.authKeyDraft.trim());
              this.authKeySheetOpen = false;
            })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })
      }
      .width('100%')
      .height(48)

      Scroll() {
        Column() {
          Text('Auth Key')
            .fontSize(14)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 19, top: 16, bottom: 6 })
          Column() {
            TextInput({ text: this.authKeyDraft, placeholder: 'tskey-auth-…' })
              .caretStyle({ width: 1 })
              .fontSize(16)
              .fontColor(this.textColor())
              .placeholderColor(this.subColor())
              .backgroundColor(Color.Transparent)
              .height(44)
              .padding({ left: 16, right: 16 })
              .onChange((value: string) => {
                this.authKeyDraft = value;
              })
          }
          .width('100%')
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.38)')
          .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.60)' })
          .borderRadius(16)
          .margin({ bottom: 16 })
        }
        .width('100%')
        .padding({ left: 14, right: 14 })
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
  }

  /** 只显示 Auth Key 尾部，避免整串密钥暴露在页面上 */
  private maskAuthKey(): string {
    const key: string = this.authKey.trim();
    if (key.length <= 10) {
      return '••••••';
    }
    return '••••' + key.substring(key.length - 6);
  }

  /** 重新连接：有 Auth Key 就用它重连，否则重启引擎走账号授权 */
  private retryConnection(): void {
    if (this.authKey.trim().length > 0) {
      this.connectWithAuthKey();
      return;
    }
    this.fastHint = '正在重新连接…';
    TailscaleTunnelStore.get().reloadFast();
  }

  /** 用账号登录：清空 Auth Key，让轻量引擎进入账号授权流程 */
  private connectWithAccount(): void {
    if (this.loginBusy) {
      return;
    }
    this.loginBusy = true;
    setTimeout(() => {
      this.loginBusy = false;
    }, 4000);
    // 账号模式与 AuthKey 相互独立：只切换模式，保留已保存的 key 供之后切回
    PreferencesStore.get().putString('tsnetLoginMode', 'account');
    AppStorage.setOrCreate<string>('tsnetAuthMode', 'account');
    this.authModeState = 'account';
    this.fastHint = '正在用账号登录…';
    TailscaleTunnelStore.get().reloadFast();
  }

  /** 用 Auth Key 登录：保存密钥并重启轻量引擎 */
  private connectWithAuthKey(): void {
    if (this.loginBusy) {
      return;
    }
    this.loginBusy = true;
    setTimeout(() => {
      this.loginBusy = false;
    }, 4000);
    PreferencesStore.get().putString('tsnetLoginMode', 'authKey');
    PreferencesStore.get().putString('tsnetAuthKey', this.authKey.trim());
    AppStorage.setOrCreate<string>('tsnetAuthMode', 'authKey');
    AppStorage.setOrCreate<string>('tailscaleStageError', '');
    this.authModeState = 'authKey';
    this.stage = STAGE_STARTING;
    this.fastHint = '正在用 Auth Key 连接…（约 10–20 秒）';
    TailscaleTunnelStore.get().applyAuthKey(this.authKey.trim());
  }

  /** 选择/激活当前账号（走账号登录） */
  private activateAccount(): void {
    this.connectWithAccount();
  }

  /** 删除当前登录账号：退出引擎登录态、清掉账号与密钥并停止隧道 */
  private deleteAccount(): void {
    try {
      TsnetBridge.logout();
    } catch (err) {
    }
    PreferencesStore.get().putString('tsnetAuthKey', '');
    PreferencesStore.get().putString('tsnetAppliedAuthKey', '');
    this.authKey = '';
    this.accountName = '';
    this.accountLogin = '';
    this.accountTailnet = '';
    this.accountAddresses = '';
    AppStorage.setOrCreate<string>('tailscaleAccount', '');
    AppStorage.setOrCreate<string>('tsnetAuthMode', '');
    this.authModeState = '';
    PreferencesStore.get().putString('tailscaleAccountName', '');
    PreferencesStore.get().putString('tailscaleAccountLogin', '');
    PreferencesStore.get().putString('tailscaleAccountTailnet', '');
    PreferencesStore.get().putString('tailscaleAccountAddresses', '');
    try {
      fileIo.rmdirSync(this.stateDir() + '/tsnet-node');
    } catch (clearErr) {
    }
    if (this.tunnelEnabled) {
      this.setEnabled(false);
    }
    this.fastHint = '已删除登录账号';
  }

  private saveAuthKey(value: string): void {
    // 只保存，不自动切换/重连：用哪种凭据由用户在「切换登录」里手动选择
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

  /** 状态卡片徽标：登录方式 + 登录状态（如「Auth Key 未登录」「浏览器登录 已连接」） */
  private authBadgeLabel(): string {
    const hasKey: boolean = this.authKey.trim().length > 0;
    const hasAccount: boolean = this.accountName.length > 0;
    const method: string = hasKey ? 'Auth Key' : (hasAccount ? '浏览器登录' : 'Auth Key');
    if (this.stage === STAGE_READY) {
      return method + ' 已连接';
    }
    if (this.stage === STAGE_STARTING || this.stage === STAGE_WAITING_ROUTES) {
      return method + ' 连接中';
    }
    return method + ' 未登录';
  }

  /** 状态卡片上显示的当前连接类型 */
  private connectionKindLabel(): string {
    if (this.authModeState === 'authKey') {
      return 'Auth Key 节点';
    }
    if (this.authModeState === 'account') {
      return '账号登录';
    }
    return '未连接';
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
  sectionHeaderWithHint(title: string, hint: string) {
    Row({ space: 4 }) {
      Text(title).fontSize(13).fontColor(this.subColor())
      Text('ⓘ')
        .fontSize(14)
        .fontColor(this.subColor())
        .padding({ left: 2, right: 8, top: 2, bottom: 2 })
        .bindMenu(this.hintMenuOpen === 'account', this.hintMenuBuilder(), {
          outlineColor: this.dividerColor(),
          outlineWidth: 1,
          onWillDisappear: () => {
            this.hintMenuOpen = '';
          },
          onDisappear: () => {
            this.hintMenuOpen = '';
          },
          onDidDisappear: () => {
            this.hintMenuOpen = '';
          }
        })
        .onClick(() => {
          this.hintText = hint;
          this.hintMenuOpen = this.hintMenuOpen === 'account' ? '' : 'account';
        })
    }
    .width('100%')
    .justifyContent(FlexAlign.Start)
    .padding({ left: 16, right: 16, top: 18, bottom: 7 })
  }

  /** 说明弹窗：系统菜单（与对话页右上角「⋯」同款动画），锚定在 ⓘ 图标上 */
  @Builder
  hintMenuBuilder() {
    Column({ space: 6 }) {
      Text('说明')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.textColor())
      Text(this.hintText)
        .fontSize(13)
        .lineHeight(20)
        .fontColor(this.textColor())
    }
    .width(280)
    .padding(14)
    .backgroundColor(this.cardBg())
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
              this.startAccountLogin();
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
                if (this.stage === STAGE_STARTING || this.stage === STAGE_WAITING_ROUTES) {
                  LoadingProgress().width(12).height(12).color('#2E6BE6')
                } else {
                  Circle({ width: 7, height: 7 }).fill(this.stageColor())
                }
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
              Text(this.authBadgeLabel()).fontSize(11).fontColor(this.stage === STAGE_READY ? '#0F9D58' : '#2E6BE6')
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
            Row() {
              Text('当前地址').fontSize(13).fontColor(this.subColor())
              Blank()
              Text(this.nodeAddress.length > 0 ? this.nodeAddress :
                (this.stage === STAGE_READY ? '已连接' : '未连接'))
                .fontSize(13)
                .fontColor(this.nodeAddress.length > 0 ? this.textColor() : this.subColor())
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .constraintSize({ maxWidth: '62%' })
            }
            .width('100%')
            Row() {
              Text('当前连接').fontSize(13).fontColor(this.subColor())
              Blank()
              Text(this.connectionKindLabel())
                .fontSize(13)
                .fontColor(this.stage === STAGE_READY ? '#0F9D58' : this.textColor())
            }
            .width('100%')
            Row({ space: 8 }) {
              if (!this.tunnelEnabled) {
                Text('启动隧道')
                  .fontSize(14).fontColor('#FFFFFF').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor('#2E6BE6').borderRadius(10)
                  .onClick(() => {
                    this.setEnabled(true);
                    TailscaleTunnelStore.get().reloadFast();
                  })
              } else if (this.stage === STAGE_READY) {
                if (this.accountName.length > 0 && this.authKey.trim().length > 0) {
                  Text('切换登录')
                    .fontSize(14).fontColor('#2E6BE6').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                    .backgroundColor(this.pillBg()).borderRadius(10)
                    .onClick(() => {
                      this.authModeDialog = true;
                    })
                } else {
                  Text('重新连接')
                    .fontSize(14).fontColor(this.subColor()).layoutWeight(1).height(38).textAlign(TextAlign.Center)
                    .backgroundColor(this.pillBg()).borderRadius(10)
                    .onClick(() => {
                    })
                }
              } else if (this.stage === STAGE_NEEDS_LOGIN && (this.accountName.length > 0 || this.authKey.trim().length > 0)) {
                // 需要授权时按已填写的凭据给出登录方式
                if (this.accountName.length > 0) {
                  Text('账号登录')
                    .fontSize(14).fontColor('#FFFFFF').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                    .backgroundColor('#2E6BE6').borderRadius(10)
                    .onClick(() => {
                      this.connectWithAccount();
                    })
                }
                if (this.authKey.trim().length > 0) {
                  Text('AuthKey 登录')
                    .fontSize(14).fontColor('#FFFFFF').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                    .backgroundColor('#2E6BE6').borderRadius(10)
                    .onClick(() => {
                      this.connectWithAuthKey();
                    })
                }
              } else {
                // 已连接时灰字不可点；断开/失败/启动中显示蓝色可点击重连
                Text('重新连接')
                  .fontSize(14)
                  .fontColor(this.stage === STAGE_READY ? this.subColor() : '#2E6BE6')
                  .layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor(this.pillBg()).borderRadius(10)
                  .onClick(() => {
                    if (this.stage === STAGE_READY) {
                      return;
                    }
                    this.retryConnection();
                  })
              }
              if (this.tunnelEnabled) {
                Text('停止')
                  .fontSize(14).fontColor('#FF3B30').layoutWeight(1).height(38).textAlign(TextAlign.Center)
                  .backgroundColor(this.pillBg()).borderRadius(10)
                  .onClick(() => {
                    this.setEnabled(false);
                  })
              }
              // Auth Key 失效：用 ⓘ 锚点菜单提示（与卡片说明同款）
              if (this.authInvalid) {
                Text('ⓘ')
                  .fontSize(15)
                  .fontColor('#C2410C')
                  .padding({ left: 8, right: 8, top: 4, bottom: 4 })
                  .bindMenu(this.hintMenuOpen === 'authInvalid', this.hintMenuBuilder(), {
                    outlineColor: this.dividerColor(),
                    outlineWidth: 1,
                    onWillDisappear: () => {
                      this.hintMenuOpen = '';
                    },
                    onDisappear: () => {
                      this.hintMenuOpen = '';
                    },
                    onDidDisappear: () => {
                      this.hintMenuOpen = '';
                    }
                  })
                  .onClick(() => {
                    this.hintText = '已保存的 Auth Key 无法加入 tailnet（可能过期或被撤销）。可以点「重新连接」，或改用「账号登录」在浏览器完成授权。';
                    this.hintMenuOpen = this.hintMenuOpen === 'authInvalid' ? '' : 'authInvalid';
                  })
              }
            }
            .width('100%')
            if (this.stageError.length > 0) {
              Text(this.stageError)
                .fontSize(12)
                .lineHeight(18)
                .fontColor('#C2410C')
                .width('100%')
            }
            if (this.fastHint.length > 0 && this.stage !== STAGE_READY) {
              Text(this.fastHint)
                .fontSize(12)
                .lineHeight(18)
                .fontColor(this.subColor())
                .width('100%')
            }
          }
          .width('100%')
          .padding(16)
          .alignItems(HorizontalAlign.Start)
          .backgroundColor(this.cardBg())
          .border({ width: 1, color: this.dividerColor() })
          .borderRadius(14)
          .clip(true)

          // ── 区块 2：账号与网络（隧道开启后显示；账号本身持久化，直到手动删除）──
          if (this.tunnelEnabled) {
          this.sectionHeaderWithHint('账号与网络', '点前面的圆点用该账号登录，右侧可删除；不删除会一直保留。')
          Column() {
            if (this.accountName.length > 0) {
              Row({ space: 10 }) {
                // 选择按钮挪到最前面：当前账号显示实心圆，点击即用该账号登录
                Stack({ alignContent: Alignment.Center }) {
                  Circle()
                    .width(20)
                    .height(20)
                    .fill(Color.Transparent)
                    .stroke('#2E6BE6')
                    .strokeWidth(1.5)
                  Circle()
                    .width(11)
                    .height(11)
                    .fill('#2E6BE6')
                }
                .width(20)
                .height(20)
                .onClick(() => {
                  this.activateAccount();
                })
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
                .onClick(() => {
                  this.activateAccount();
                })
                Text('删除')
                  .fontSize(14)
                  .fontColor('#FF3B30')
                  .padding({ left: 10, right: 10, top: 8, bottom: 8 })
                  .onClick(() => {
                    this.deleteAccount();
                  })
              }
              .width('100%')
              .padding({ left: 16, right: 8, top: 12, bottom: 12 })
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
          }

          // ── 节点身份（单独卡片）：Auth Key + 自建控制平面（折叠）──
          if (this.tunnelEnabled) {
            Row({ space: 4 }) {
              Text('节点身份').fontSize(13).fontColor(this.subColor())
              Text('ⓘ')
                .fontSize(14)
                .fontColor(this.subColor())
                .padding({ left: 2, right: 8, top: 2, bottom: 2 })
                .bindMenu(this.hintMenuOpen === 'authKey', this.hintMenuBuilder(), {
                  outlineColor: this.dividerColor(),
                  outlineWidth: 1,
                  onWillDisappear: () => {
                    this.hintMenuOpen = '';
                  },
                  onDisappear: () => {
                    this.hintMenuOpen = '';
                  },
                  onDidDisappear: () => {
                    this.hintMenuOpen = '';
                  }
                })
                .onClick(() => {
                  this.hintText = '创建 Auth Key：Reusable 打开、Ephemeral 关闭、Expiry 按需（建议 90 天）、Tags 留空。\n主机授权三步：① Tailscale 管理台 Machines 里批准新设备（开启了设备审批时）；② Access Controls 里允许该设备访问网关主机 3081/tcp；③ 回到本页点「AuthKey 登录」，等状态变「已连接」。换 key 会自动清空旧节点状态。';
                  this.hintMenuOpen = this.hintMenuOpen === 'authKey' ? '' : 'authKey';
                })
              Blank()
              Text('获取 Auth Key')
                .fontSize(13)
                .fontColor('#2E6BE6')
                .onClick(() => {
                  this.openAuthKeyPage();
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 18, bottom: 7 })
            Column() {
              Row() {
                Text('Auth Key')
                  .fontSize(16)
                  .fontColor(this.textColor())
                Blank()
                Text(this.authKey.trim().length > 0 ? this.maskAuthKey() : '未填写')
                  .fontSize(14)
                  .fontColor(this.authKey.trim().length > 0 ? this.textColor() : this.subColor())
                Text(' ›').fontSize(16).fontColor(this.subColor())
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.authKeyDraft = this.authKey;
                this.authKeySheetOpen = true;
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              Row() {
                Text('自建控制平面')
                  .fontSize(16)
                  .fontColor(this.textColor())
                Blank()
                Text(this.selfHostedOpen ? '收起' : (this.controlURL.trim().length > 0 ? '已设置' : '设置'))
                  .fontSize(14)
                  .fontColor('#2E6BE6')
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.selfHostedOpen = !this.selfHostedOpen;
              })
              if (this.selfHostedOpen) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                TextInput({ text: this.controlURL, placeholder: 'https://headscale.example.com' })
                  .fontSize(16)
                  .fontColor(this.textColor())
                  .placeholderColor(this.subColor())
                  .backgroundColor(Color.Transparent)
                  .height(48)
                  .padding({ left: 16, right: 16 })
                  .onChange((value: string) => {
                    this.saveControlURL(value);
                  })
                Text('留空使用官方 controlplane；自建 Headscale 填自己的域名，保存后重新连接生效。')
                  .fontSize(12)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, bottom: 12 })
              }
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)

          }


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

      // Auth Key 填写：与对话页一致的系统半模态（底部 sheet）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.authKeySheetOpen, this.authKeySheetContent(), {
          height: 420,
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : this.pageBg(),
          systemMaterial: this.sheetMaterial(),
          onDisappear: () => {
            this.authKeyDraft = '';
          }
        })

      // 切换登录方式：系统半模态（与首页「切换主机」同款材质）
      Column()
        .width(1)
        .height(1)
        .opacity(0.01)
        .bindSheet($$this.authModeDialog, this.authModeSheetContent(), {
          height: 340,
          dragBar: false,
          showClose: false,
          preferType: SheetType.BOTTOM,
          backgroundColor: this.immersiveSupported() ? Color.Transparent : this.pageBg(),
          systemMaterial: this.sheetMaterial()
        })

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
