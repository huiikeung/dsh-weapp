import { AbilityConstant, Configuration, UIAbility, Want } from '@kit.AbilityKit';
import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { TailscaleTunnelStore } from '../services/TailscaleTunnelStore';
import { TsnetBridge } from '../services/TsnetBridge';
import { BackgroundKeepAlive } from '../services/BackgroundKeepAlive';
import { StatusBarStyle } from '../services/StatusBarStyle';
import { PrivacyConsent } from '../services/PrivacyConsent';
import {
  AppState, AttachmentImageCache, DeviceConnectors, locationConnector, calendarConnector, remindersConnector, photosConnector, alarmsConnector,
  GatewayClient, Logger, NotificationService, PreferencesStore, SessionStore, ThemeManager,
  parsePairingPayload, sodiumSelfTest
} from 'nativecore';
export default class EntryAbility extends UIAbility {
  /** 调试/深度链接传入的配对载荷：同意协议后才发起连接 */
  private pendingPairPayload: string = '';
  /** 网络/隧道初始化只执行一次 */
  private networkingStarted: boolean = false;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    AppState.init();
    // 会话目录缓存体积大，放到首帧之后再读，避免阻塞启动
    setTimeout(() => {
      SessionStore.restoreCatalogCache();
    }, 80);
    // 图片附件缓存目录：必须在这里注入 filesDir，否则 AttachmentImageCache.isReady() 永远是 false，
    // 所有缩略图都会以「图片附件信息不完整」失败 —— 表现就是「图片加载失败，点击重试」。
    // （小程序用 wx.env.USER_DATA_PATH 直接算路径，所以它一直正常。）
    AttachmentImageCache.configure(this.context.filesDir);
    Logger.info('UIBOOT onCreate imageCache=' + this.context.filesDir);
    AppStorage.setOrCreate<string>('appLifecycle', 'foreground');
    AppStorage.setOrCreate<Context>('uiAbilityContext', this.context);
    // 系统通知需要在后台无页面上下文时也能发：把 UIAbilityContext 交给通知服务
    NotificationService.attachContext(this.context);
    const deepSession: string = want.parameters !== undefined && want.parameters['sessionId'] !== undefined
      ? String(want.parameters['sessionId']) : '';
    if (deepSession.length > 0) {
      AppStorage.setOrCreate<string>('pendingSessionId', deepSession);
    }
    const pageRoute: string = want.parameters !== undefined && want.parameters['pageRoute'] !== undefined
      ? String(want.parameters['pageRoute']) : '';
    if (want.parameters !== undefined && String(want.parameters['loginNow'] ?? '') === '1') {
      AppStorage.setOrCreate<boolean>('pendingTailscaleLogin', true);
    }
    if (pageRoute.length > 0) {
      AppStorage.setOrCreate<string>('pendingPageRoute', pageRoute);
    }
    // 调试/深度链接：aa start --ps pairPayload <base64> 可直接传入配对载荷
    const paramPayload: string = want.parameters !== undefined && want.parameters['pairPayload'] !== undefined
      ? String(want.parameters['pairPayload']) : '';
    if (paramPayload.length > 0) {
      // 不在这里直接连接：必须等用户同意《用户协议》《隐私政策》后才允许联网（见 startNetworking）
      Logger.info('pairing payload from launch param, length=' + paramPayload.length);
      this.pendingPairPayload = paramPayload;
    }
    SessionStore.get().attach(GatewayClient.get());
    // 启动自检：X25519 + XSalsa20-Poly1305 与 tweetnacl 向量比对（失败会打日志）。
    // 注意：纯 JS 的 curve25519 自检很吃 CPU，放在 onCreate 里同步跑会把主线程堵住、
    // 启动窗口内点哪都没反应（甚至触发系统的 AppFreeze 判定）。这里挪到首帧之后再跑。
    // 默认不跑：纯 JS 的 curve25519 自检实测单次要 ~280ms，且偶发长时间不返回，
    // 会把主线程（UI 线程）堵住 —— 表现就是「打开 App/对话页后点哪都没反应」。
    // 需要验证算法时手动触发：hdc shell aa start -a EntryAbility -b com.flukit.app --ps selfTest 1
    const selfTestWanted: boolean = want.parameters !== undefined && String(want.parameters['selfTest'] ?? '') === '1';
    if (selfTestWanted) {
      setTimeout(() => {
        const selfTestAt: number = Date.now();
        try {
          sodiumSelfTest();
          Logger.info('sodium self-test ok in ' + (Date.now() - selfTestAt) + 'ms');
        } catch (err) {
          Logger.error('sodium self-test threw: ' + JSON.stringify(err));
        }
      }, 1200);
    }
    Logger.info('EntryAbility onCreate');
    DeviceConnectors.bind();
    DeviceConnectors.registerAdapter(locationConnector);
    DeviceConnectors.registerAdapter(calendarConnector);
    DeviceConnectors.registerAdapter(remindersConnector);
    DeviceConnectors.registerAdapter(photosConnector);
    DeviceConnectors.registerAdapter(alarmsConnector);
    PreferencesStore.get().init(this.context).then(() => {
      // 会话内容字号（小/标准/大/特大）→ AppStorage，供对话页与设置预览统一读取
      AppStorage.setOrCreate<string>('contentFontSize', PreferencesStore.get().getString('contentFontSize', '标准'));
      // 新会话权限：启动即同步到 AppStorage，对话页输入框直接显示
      AppStorage.setOrCreate<string>('defaultPermission',
        PreferencesStore.get().getString('defaultPermission', 'workspace-write'));
      // 默认模型/思考强度：冷启动从偏好恢复，设置页与对话页首帧就能显示
      const storedDefaultModel: string = PreferencesStore.get().getString('defaultModel', '');
      if (storedDefaultModel.length > 0) {
        AppStorage.setOrCreate<string>('defaultModel', storedDefaultModel);
      }
      const storedDefaultProvider: string = PreferencesStore.get().getString('defaultProvider', '');
      if (storedDefaultProvider.length > 0) {
        AppStorage.setOrCreate<string>('defaultProvider', storedDefaultProvider);
      }
      const storedDefaultEffort: string = PreferencesStore.get().getString('defaultEffort', '');
      if (storedDefaultEffort.length > 0) {
        AppStorage.setOrCreate<string>('defaultEffort', storedDefaultEffort);
      }
      // 工作步骤展示偏好 → AppStorage（对话页 StorageProp 响应式读取）
      AppStorage.setOrCreate<string>('workStepMode', PreferencesStore.get().getString('workStepMode', 'detailed'));
      AppStorage.setOrCreate<string>('workStepTiming', PreferencesStore.get().getString('workStepTiming', 'completion'));
      // 外观偏好：必须在 init 完成后再读，否则读到的是兜底值（重启后回默认色就是这个问题）
      // 语音输入开关：设置页关掉之后要能跨重启生效（会话页靠 @StorageLink 首帧读取）
      AppStorage.setOrCreate<boolean>('voiceInputEnabled', PreferencesStore.get().getBoolean('voiceInputEnabled', true));
      // 对话页「AI 生成内容，仅供参考」标识开关（设置 → 对话，默认开启）
      AppStorage.setOrCreate<boolean>('aiContentLabelEnabled', PreferencesStore.get().getBoolean('aiContentLabelEnabled', true));
      // 对话状态条默认改为「简约」（original）：
      // 一次性把上一版默认值 dsh（DSH 扫光）与历史遗留的空值/ios 迁到 original；
      // 用户自己选过的其它样式（经典流光/霓虹等）保持不动。
      const statusMigrated: boolean = PreferencesStore.get().getBoolean('statusAppearanceSimpleMigrated', false);
      if (!statusMigrated) {
        const storedStatus: string = PreferencesStore.get().getString('statusAppearance', '');
        if (storedStatus.length === 0 || storedStatus === 'dsh' || storedStatus === 'ios') {
          PreferencesStore.get().putString('statusAppearance', 'original');
        }
        PreferencesStore.get().putBoolean('statusAppearanceSimpleMigrated', true);
      }
      AppStorage.setOrCreate<string>('statusAppearance', PreferencesStore.get().getString('statusAppearance', 'original'));
      // 执行图标：新增「默认（系统加载图）」并作为默认选项。
      // 首次升级时把旧选择统一重置为 default（一次性迁移），之后保留用户自己的选择。
      let storedProcIcon: string = PreferencesStore.get().getString('procIconStyle', 'default');
      if (!PreferencesStore.get().getBoolean('procIconDefaultMigrated', false)) {
        storedProcIcon = 'default';
        PreferencesStore.get().putString('procIconStyle', 'default');
        PreferencesStore.get().putBoolean('procIconDefaultMigrated', true);
      }
      if (storedProcIcon === 'cells' || storedProcIcon.length === 0) {
        storedProcIcon = 'default';
      }
      AppStorage.setOrCreate<string>('procIconStyle', storedProcIcon);
      ThemeManager.get().init(this.context.config.colorMode);
      // 首次启动隐私同意：未同意前不初始化隧道、不自动连接网关，同意后由 PrivacyConsent 回调补做
      const agreed: boolean = PrivacyConsent.isAgreed();
      AppStorage.setOrCreate<string>('privacyConsentState', agreed ? 'granted' : 'required');
      if (agreed) {
        this.startNetworking();
      } else {
        PrivacyConsent.onAgreed(() => {
          this.startNetworking();
        });
      }
    })
    .catch((err: BusinessError) => {
      Logger.error('init preferences failed: ' + JSON.stringify(err));
      // 偏好读不出来时同样无法落盘同意状态：按「需要同意」处理
      AppStorage.setOrCreate<string>('privacyConsentState', 'required');
      ThemeManager.get().init(this.context.config.colorMode);
    });
  }

  /**
   * 网络/隧道初始化：只在用户同意协议后执行，且只执行一次。
   * 推迟到首帧之后：先让页面秒开，再在后台连网。
   */
  private startNetworking(): void {
    if (this.networkingStarted) {
      return;
    }
    this.networkingStarted = true;
    setTimeout(() => {
    TailscaleTunnelStore.get().start(this.context.filesDir + '/tailscale', this.context);
    GatewayClient.get().setTailnetEnabler(() => {
      TailscaleTunnelStore.get().enableAndStart();
    });
    GatewayClient.get().setTailnetDialer((url: string): string => {
      const stage: string = AppStorage.get<string>('tailscaleStage') ?? 'disabled';
      if (stage !== 'ready') {
        return '';
      }
      // 统一使用轻量 tsnet 引擎的本地代理（避免两个引擎争用 18080 端口导致连接被踢）
      const dialed: string = TsnetBridge.startFastProxyForWsUrl(url, 18080);
      Logger.info('tailnet dial result=' + (dialed.length > 0 ? dialed : 'EMPTY'));
      Logger.info('tailnet dial ' + url + ' -> ' + (dialed.length > 0 ? dialed : 'FAILED'));
      return dialed;
    });
      // 有已保存的配对凭据时自动重连，无需重新扫码。
      if (!GatewayClient.get().autoConnect()) {
        Logger.info('no saved gateway, waiting for scan');
      }
      this.runPendingPairing();
    }, 120);
  }

  /** 调试/深度链接传入的配对载荷：同意协议后发起连接 */
  private runPendingPairing(): void {
    const payload: string = this.pendingPairPayload;
    if (payload.length === 0) {
      return;
    }
    this.pendingPairPayload = '';
    try {
      const parsed = parsePairingPayload(payload);
      if (parsed.ok) {
        GatewayClient.get().connectPairing(parsed);
      } else {
        Logger.error('payload invalid: ' + parsed.error);
      }
    } catch (e) {
      Logger.error('payload parse failed: ' + JSON.stringify(e));
    }
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const sessionId: string = want.parameters !== undefined && want.parameters['sessionId'] !== undefined
      ? String(want.parameters['sessionId']) : '';
    if (sessionId.length > 0) AppStorage.setOrCreate<string>('pendingSessionId', sessionId);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    Logger.info('UIBOOT onWindowStageCreate');
    // 先把窗口做成沉浸式并写入安全区，再 loadContent：
    // 页面首帧就能拿到真实 safeTop/safeBottom，不会先按兜底值排一遍再被顶一下（打开页面时「抖」）。
    windowStage.getMainWindow((werr: BusinessError, win: window.Window) => {
      if (!win) {
        Logger.error('getMainWindow failed: ' + JSON.stringify(werr));
      } else {
        try {
          win.setWindowLayoutFullScreen(true);
          win.setWindowBackgroundColor('#07182B');
          win.setWindowSystemBarProperties({
            statusBarColor: '#00000000',
            statusBarContentColor: '#FFFFFF',
            navigationBarColor: '#00000000',
            navigationBarContentColor: '#FFFFFF'
          });
          const sysArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
          const navArea = win.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
          const density: number = display.getDefaultDisplaySync().densityPixels;
          // 监听输入法高度：弹层据此上浮，避免输入框被键盘盖住
          try {
            win.on('keyboardHeightChange', (height: number) => {
              Logger.info('IMEKB event raw=' + height);
              const density: number = display.getDefaultDisplaySync().densityPixels;
              AppStorage.setOrCreate<number>('keyboardHeightVp', height > 0 ? height / density : 0);
            });
          } catch (ignored) {
          }
          // 第二事件源：avoidAreaChange 的键盘区域（部分版本 keyboardHeightChange 不回调时兜底）
          try {
            win.on('avoidAreaChange', (data: window.AvoidAreaOptions) => {
              if (data.type !== window.AvoidAreaType.TYPE_KEYBOARD) {
                return;
              }
              const density: number = display.getDefaultDisplaySync().densityPixels;
              const raw: number = data.area.bottomRect.height;
              Logger.info('AVOIDKB bottom=' + raw + ' top=' + data.area.topRect.height);
              AppStorage.setOrCreate<number>('keyboardHeightVp', raw > 0 ? raw / density : 0);
            });
          } catch (ignored) {
          }
          AppStorage.setOrCreate<number>('safeTopVp', sysArea.topRect.height / density);
          AppStorage.setOrCreate<number>('safeBottomVp', navArea.bottomRect.height / density);
          Logger.info('immersive ok: top=' + (sysArea.topRect.height / density) + ' bottom=' + (navArea.bottomRect.height / density));
        } catch (e) {
          Logger.error('immersive failed: ' + JSON.stringify(e));
        }
      }
      windowStage.loadContent('pages/Index', (err: BusinessError) => {
        if (err.code) {
          Logger.error('loadContent failed: ' + JSON.stringify(err));
          return;
        }
        Logger.info('loadContent done');
      });
    });
  }

  onForeground(): void {
    const fgStart: number = Date.now();
    Logger.info('FG_TIMING start');
    void BackgroundKeepAlive.stop();
    Logger.info('FG_TIMING keepalive-stopped +' + (Date.now() - fgStart));
    // 回前台时系统会按当前 colorMode 重刷状态栏，按当前页面重新写回正确颜色
    StatusBarStyle.refresh();
    Logger.info('FG_TIMING statusbar +' + (Date.now() - fgStart));
    GatewayClient.get().revalidateOnForeground();
    Logger.info('FG_TIMING revalidate +' + (Date.now() - fgStart));
    AppStorage.setOrCreate<string>('appLifecycle', 'foreground');
    // 回到前台：清掉任务完成的桌面角标
    NotificationService.clearBadge().catch(() => {
    });
    // 后台期间桌面端可能开跑或跑完：回前台立刻校准一次会话列表，
    // 不要再等下一拍轮询（用户看到的第一眼就是旧状态）。
    SessionStore.get().refreshSessionsNow();
    Logger.info('FG_TIMING refresh-sessions +' + (Date.now() - fgStart));
    const state: string = AppStorage.get<string>('connectionState') ?? 'disconnected';
    if (state === 'connected') {
      DeviceConnectors.onConnected();
    } else {
      DeviceConnectors.onDisconnected();
    }
    // 未同意隐私协议前不自动重连
    if (PrivacyConsent.isAgreed() && PreferencesStore.get().isReady() && state !== 'connected' && state !== 'connecting') {
      GatewayClient.get().autoConnect();
    }
    Logger.info('FG_TIMING auto-connect +' + (Date.now() - fgStart));
    Logger.info('EntryAbility foreground: reconnect checked +' + (Date.now() - fgStart));
  }

  onBackground(): void {
    AppStorage.setOrCreate<string>('appLifecycle', 'background');
    Logger.info('EntryAbility background: websocket lifecycle retained');
    // 只要内嵌隧道开启就保持后台存活：回到 App 时无需等隧道冷启动（约 8–10 秒）。
    const tunnelOn: boolean = AppStorage.get<boolean>('tailscaleTunnelEnabled') ?? false;
    const agentWork: boolean = AppStorage.get<boolean>('agentWorkActive') ?? false;
    if (tunnelOn || agentWork) {
      BackgroundKeepAlive.start(this.context).catch(() => {});
    } else {
      Logger.info('BGKEEP skipped (tunnel off)');
    }
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    ThemeManager.get().applySystemColorMode(newConfig.colorMode);
    // 系统配色变化（含强制浅色/深色）会让状态栏回到默认色，重新计算并写回
    StatusBarStyle.refresh();
  }
}