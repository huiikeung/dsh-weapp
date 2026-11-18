import { AbilityConstant, Configuration, UIAbility, Want } from '@kit.AbilityKit';
import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { TailscaleTunnelStore } from '../services/TailscaleTunnelStore';
import { TsnetBridge } from '../services/TsnetBridge';
import { BackgroundKeepAlive } from '../services/BackgroundKeepAlive';
import {
  AppState, GatewayClient, Logger, PreferencesStore, SessionStore, ThemeManager,
  parsePairingPayload, sodiumSelfTest
} from 'nativecore';
export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    AppState.init();
    SessionStore.restoreCatalogCache();
    Logger.info('UIBOOT onCreate');
    AppStorage.setOrCreate<string>('appLifecycle', 'foreground');
    AppStorage.setOrCreate<Context>('uiAbilityContext', this.context);
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
      Logger.info('pairing payload from launch param, length=' + paramPayload.length);
      try {
        const parsed = parsePairingPayload(paramPayload);
        if (parsed.ok) {
          setTimeout(() => {
            GatewayClient.get().connectPairing(parsed);
          }, 500);
        } else {
          Logger.error('payload invalid: ' + parsed.error);
        }
      } catch (e) {
        Logger.error('payload parse failed: ' + JSON.stringify(e));
      }
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
    PreferencesStore.get().init(this.context).then(() => {
      // 会话内容字号（小/标准/大/特大）→ AppStorage，供对话页与设置预览统一读取
      AppStorage.setOrCreate<string>('contentFontSize', PreferencesStore.get().getString('contentFontSize', '标准'));
      // 工作步骤展示偏好 → AppStorage（对话页 StorageProp 响应式读取）
      AppStorage.setOrCreate<string>('workStepMode', PreferencesStore.get().getString('workStepMode', 'detailed'));
      AppStorage.setOrCreate<string>('workStepTiming', PreferencesStore.get().getString('workStepTiming', 'completion'));
      // 外观偏好：必须在 init 完成后再读，否则读到的是兜底值（重启后回默认色就是这个问题）
      // 语音输入开关：设置页关掉之后要能跨重启生效（会话页靠 @StorageLink 首帧读取）
      AppStorage.setOrCreate<boolean>('voiceInputEnabled', PreferencesStore.get().getBoolean('voiceInputEnabled', true));
      AppStorage.setOrCreate<string>('statusAppearance', PreferencesStore.get().getString('statusAppearance', 'classic'));
      AppStorage.setOrCreate<string>('procIconStyle', PreferencesStore.get().getString('procIconStyle', 'spin-ring'));
      ThemeManager.get().init(this.context.config.colorMode);
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
    }).catch((err: BusinessError) => {
      Logger.error('init preferences failed: ' + JSON.stringify(err));
      ThemeManager.get().init(this.context.config.colorMode);
    });
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
    void BackgroundKeepAlive.stop();
    GatewayClient.get().revalidateOnForeground();
    AppStorage.setOrCreate<string>('appLifecycle', 'foreground');
    // 后台期间桌面端可能开跑或跑完：回前台立刻校准一次会话列表，
    // 不要再等下一拍轮询（用户看到的第一眼就是旧状态）。
    SessionStore.get().refreshSessionsNow();
    const state: string = AppStorage.get<string>('connectionState') ?? 'disconnected';
    if (PreferencesStore.get().isReady() && state !== 'connected' && state !== 'connecting') {
      GatewayClient.get().autoConnect();
    }
    Logger.info('EntryAbility foreground: reconnect checked');
  }

  onBackground(): void {
    AppStorage.setOrCreate<string>('appLifecycle', 'background');
    Logger.info('EntryAbility background: websocket lifecycle retained');
    const agentWork: boolean = AppStorage.get<boolean>('agentWorkActive') ?? false;
    if (agentWork) {
      BackgroundKeepAlive.start(this.context).catch(() => {});
    } else {
      Logger.info('BGKEEP skipped (no agent work)');
    }
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    ThemeManager.get().applySystemColorMode(newConfig.colorMode);
  }
}