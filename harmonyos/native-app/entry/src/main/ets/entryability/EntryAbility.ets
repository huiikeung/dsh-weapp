import { AbilityConstant, Configuration, UIAbility, Want } from '@kit.AbilityKit';
import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import {
  AppState, GatewayClient, Logger, PreferencesStore, SessionStore, ThemeManager,
  parsePairingPayload, sodiumSelfTest
} from 'nativecore';

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    AppState.init();
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
    // 启动自检一次：X25519 + XSalsa20-Poly1305 与 tweetnacl 向量比对（失败会打日志）。
    try {
      sodiumSelfTest();
    } catch (err) {
      Logger.error('sodium self-test threw: ' + JSON.stringify(err));
    }
    Logger.info('EntryAbility onCreate');
    PreferencesStore.get().init(this.context).then(() => {
      ThemeManager.get().init(this.context.config.colorMode);
      // 有已保存的配对凭据时自动重连，无需重新扫码。
      if (!GatewayClient.get().autoConnect()) {
        Logger.info('no saved gateway, waiting for scan');
      }
    }).catch((err: BusinessError) => {
      Logger.error('init preferences failed: ' + JSON.stringify(err));
      ThemeManager.get().init(this.context.config.colorMode);
    });
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err: BusinessError) => {
      if (err.code) {
        Logger.error('loadContent failed: ' + JSON.stringify(err));
        return;
      }
      Logger.info('loadContent done');
      windowStage.getMainWindow((werr: BusinessError, win: window.Window) => {
        if (!win) {
          Logger.error('getMainWindow failed: ' + JSON.stringify(werr));
          return;
        }
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
              const density: number = display.getDefaultDisplaySync().densityPixels;
              AppStorage.setOrCreate<number>('keyboardHeightVp', height > 0 ? height / density : 0);
            });
          } catch (ignored) {
          }
          AppStorage.setOrCreate<number>('safeTopVp', sysArea.topRect.height / density);
          AppStorage.setOrCreate<number>('safeBottomVp', navArea.bottomRect.height / density);
          Logger.info('immersive ok: top=' + (sysArea.topRect.height / density) + ' bottom=' + (navArea.bottomRect.height / density));
        } catch (e) {
          Logger.error('immersive failed: ' + JSON.stringify(e));
        }
      });
    });
  }

  onConfigurationUpdate(newConfig: Configuration): void {
    ThemeManager.get().applySystemColorMode(newConfig.colorMode);
  }
}