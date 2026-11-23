import { BackgroundKeepAlive } from '../services/BackgroundKeepAlive';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { Logger } from 'nativecore';
import { SessionStore } from 'nativecore';
import { HomePage } from './HomePage';
import { AddNodePage } from './AddNodePage';
import { ConversationPage } from './ConversationPage';
import { NodeManagePage } from './NodeManagePage';
import { PluginsPage } from './PluginsPage';
import { SchedulePage } from './SchedulePage';
import { SessionDefaultModelPage } from './SessionDefaultModelPage';
import { AddProviderPage } from './AddProviderPage';
import { SessionSettingsPage } from './SessionSettingsPage';
import { AppSettingsPage } from './AppSettingsPage';
import { SettingsPage } from './SettingsPage';
import { ModelsPage } from './ModelsPage';
import { TailscalePage } from './TailscalePage';
import { StatusStylesPage } from './StatusStylesPage';
import { PreferencePickerPage } from './PreferencePickerPage';
import { FontSizePage } from './FontSizePage';
import { ClawbotPage } from './ClawbotPage';
import { StorageSpacePage } from './StorageSpacePage';
import { NetworkPage } from './NetworkPage';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { UserAgreementPage } from './UserAgreementPage';
import { openSessionRoute } from '../common/SessionRoute';
import { StatusBarStyle } from '../services/StatusBarStyle';
import { PrivacyConsent } from '../services/PrivacyConsent';
import { uiMaterial } from '@kit.ArkUI';
import { PrivacyConsentDialog } from '../components/PrivacyConsentDialog';

@Entry
@Component
struct Index {
  @Provide('pageStack') pageStack: NavPathStack = new NavPathStack();
  @StorageLink('isDark') isDark: boolean = false;
  /** 首次启动隐私同意：unknown / required / granted，未同意前不自动联网（见 EntryAbility.startNetworking） */
  @StorageLink('privacyConsentState') @Watch('onConsentStateChanged') consentState: string = 'unknown';
  /** 正在查看《用户协议》/《隐私政策》：此时不弹同意弹窗，返回首页后再弹 */
  @State consentDocOpen: boolean = false;
  /** 系统同意弹窗的控制器（第一次需要弹时才创建） */
  private consentDialog: CustomDialogController | undefined = undefined;
  @StorageLink('themeMode') @Watch('applyAppColorMode') themeMode: string = 'system';
  @StorageLink('pendingSessionId') @Watch('openPendingSession') pendingSessionId: string = '';
  @StorageLink('pendingPageRoute') @Watch('openPendingPageRoute') pendingPageRoute: string = '';

  /** 把 App 主题同步到窗口 colorMode：仅显式浅/深色时强制，跟随系统时设 NOT_SET */
  private applyAppColorMode(): void {
    try {
      const ctx = getContext(this) as common.ApplicationContext;
      let target: ConfigurationConstant.ColorMode = ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;
      if (this.themeMode === 'dark') {
        target = ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      } else if (this.themeMode === 'light') {
        target = ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT;
      }
      ctx.setColorMode(target);
      // setColorMode 会让系统按新 colorMode 重刷状态栏内容色（浅色 → 黑字），
      // 且这次重刷是异步的；页面已经显示时不会再触发 onShown，必须在这里补写回页面登记的颜色。
      setTimeout(() => StatusBarStyle.refresh(), 60);
      setTimeout(() => StatusBarStyle.refresh(), 600);
      setTimeout(() => StatusBarStyle.refresh(), 1200);
    } catch (err) {
      // 旧系统忽略
    }
  }

  @StorageLink('agentWorkActive') @Watch('onAgentWorkActive') agentWorkActive: boolean = false;

  onAgentWorkActive(): void {
    const lifecycle: string = AppStorage.get<string>('appLifecycle') ?? 'foreground';
    if (this.agentWorkActive && lifecycle === 'background') {
      const context = getContext(this) as common.UIAbilityContext;
      BackgroundKeepAlive.start(context).catch(() => {});
    }
  }

  aboutToAppear(): void {
    Logger.info('UIBOOT Index aboutToAppear');
    // 路由切换时同步状态栏归属页面：首页 NavBar 记为 ''，其它记 NavDestination 名字
    this.pageStack.setInterception({ didShow: this.syncStatusBarRoute });
    // 大缓存放到首帧后读，避免堵住启动
    setTimeout(() => {
      SessionStore.restoreCatalogCache();
    }, 80);
    this.applyAppColorMode();
    if (this.pendingSessionId.length > 0) this.openPendingSession();
    this.syncConsentDialog();
    if (this.pendingPageRoute.length > 0) {
      setTimeout(() => this.openPendingPageRoute(), 700);
    }
  }

  private openPendingPageRoute(): void {
    const route: string = this.pendingPageRoute;
    if (route.length === 0) return;
    this.pendingPageRoute = '';
    this.pageStack.pushPathByName(route, null);
  }

  private openPendingSession(): void {
    const sessionId: string = this.pendingSessionId;
    if (sessionId.length === 0) return;
    this.pendingSessionId = '';
    SessionStore.get().open(sessionId);
    openSessionRoute(this.pageStack);
  }

  @Builder
  PageMap(name: string) {
    if (name === 'session') {
      ConversationPage();
    } else if (name === 'plugins') {
      PluginsPage();
    } else if (name === 'schedule') {
      SchedulePage();
    } else if (name === 'node-manage') {
      NodeManagePage();
    } else if (name === 'add-node') {
      AddNodePage();
    } else if (name === 'session-settings') {
      SessionSettingsPage();
    } else if (name === 'session-model') {
      SessionDefaultModelPage();
    } else if (name === 'app-settings') {
      AppSettingsPage();
    } else if (name === 'settings') {
      SettingsPage();
    } else if (name === 'add-provider') {
      AddProviderPage();
    } else if (name === 'models') {
      ModelsPage();
    } else if (name === 'tailscale') {
      TailscalePage();
    } else if (name === 'status-styles') {
      StatusStylesPage();
    } else if (name === 'pref-picker') {
      PreferencePickerPage();
    } else if (name === 'font-size') {
      FontSizePage();
    } else if (name === 'clawbot') {
      ClawbotPage();
    } else if (name === 'storage-space') {
      StorageSpacePage();
    } else if (name === 'network') {
      NetworkPage();
    } else if (name === 'privacy-policy') {
      PrivacyPolicyPage();
    } else if (name === 'user-agreement') {
      UserAgreementPage();
    }
  }

  /** 路由切换回调：把「当前显示的是哪个页面」同步给状态栏样式（首页 NavBar 记为 ''） */
  private syncStatusBarRoute(from: NavDestinationContext | NavBar,
    to: NavDestinationContext | NavBar, operation: NavigationOperation, isAnimated: boolean): void {
    const ctx: NavDestinationContext | undefined = to as NavDestinationContext;
    const routeName: string = ctx !== undefined && ctx.pathInfo !== undefined &&
      ctx.pathInfo !== null ? ctx.pathInfo.name : '';
    StatusBarStyle.setRoute(routeName);
    // 首页是否可见：进入二级页后暂停首页背景动效，降低后台绘制发热
    AppStorage.setOrCreate<boolean>('homePageVisible', routeName === '');
    // 从协议页返回首页：还没同意的话把同意弹窗重新弹出来
    if (routeName.length === 0) {
      this.consentDocOpen = false;
      this.syncConsentDialog();
    }
  }


  /** 偏好里的同意状态同步到 AppStorage 后触发 */
  onConsentStateChanged(): void {
    this.syncConsentDialog();
  }

  /**
   * 同意状态：unknown（偏好还没读出来）/ required（需要用户同意）/ granted（已同意）。
   * 由 EntryAbility 在偏好初始化后写入，用户点同意后由 PrivacyConsent.agree() 改成 granted。
   */
  private syncConsentDialog(): void {
    if (this.consentState === 'granted') {
      const granted: CustomDialogController | undefined = this.consentDialog;
      if (granted !== undefined) {
        granted.close();
      }
      return;
    }
    if (this.consentState === 'required' && !this.consentDocOpen) {
      // 等页面首帧之后再弹，避免在页面还没挂载时 open()
      setTimeout(() => {
        this.showConsentDialog();
      }, 60);
    }
  }

  /** 同意弹窗的材质：与「切换主机」半模态同一套沉浸光感（旧系统降级为普通弹窗） */
  private consentMaterial(): uiMaterial.Material | undefined {
    try {
      if (!uiMaterial.isImmersiveMaterialSupported()) {
        return undefined;
      }
      return new uiMaterial.ImmersiveMaterial({
        style: uiMaterial.ImmersiveStyle.THICK,
        materialColor: this.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.34)',
        colorInvert: true,
        applyShadow: true
      });
    } catch (err) {
      return undefined;
    }
  }

  /** 首次启动隐私同意弹窗：系统 CustomDialog + 沉浸光感材质，模态且不会被返回键/遮罩关掉 */
  private showConsentDialog(): void {
    if (this.consentState !== 'required' || this.consentDocOpen) {
      return;
    }
    try {
      let dialog: CustomDialogController | undefined = this.consentDialog;
      if (dialog === undefined) {
        // 第一次需要弹的时候再建：材质要按当时的深浅色取
        dialog = new CustomDialogController({
          builder: PrivacyConsentDialog({
            onAgree: () => {
              PrivacyConsent.agree();
            },
            onDisagree: () => {
              // 不同意则退出应用；下次启动仍会看到同意弹窗
              const ctx = getContext(this) as common.UIAbilityContext;
              ctx.terminateSelf().catch(() => {
              });
            },
            onOpenDoc: (route: string) => {
              this.openConsentDoc(route);
            }
          }),
          alignment: Alignment.Center,
          autoCancel: false,
          isModal: true,
          systemMaterial: this.consentMaterial(),
          onWillDismiss: (action: DismissDialogAction) => {
            // 注册了这个回调后，返回键/点遮罩不会直接关闭；未同意前什么都不做，弹窗保持打开
          }
        });
        this.consentDialog = dialog;
      }
      dialog.open();
    } catch (err) {
      Logger.error('consent dialog failed: ' + JSON.stringify(err));
    }
  }

  /** 打开协议页查看全文：先收起弹窗，返回首页时 syncConsentDialog 会重新弹出来 */
  private openConsentDoc(route: string): void {
    this.consentDocOpen = true;
    const dialog: CustomDialogController | undefined = this.consentDialog;
    if (dialog !== undefined) {
      dialog.close();
    }
    this.pageStack.pushPathByName(route, null);
  }
  build() {
    Stack() {
      Navigation(this.pageStack) {
        HomePage();
      }
      .navDestination(this.PageMap)
      .hideTitleBar(true)
      .mode(NavigationMode.Stack)
      .width('100%')
      .height('100%')
      .backgroundColor(this.isDark ? '#000000' : '#F2F2F7')

      // 未同意期间的兜底：弹窗本身是模态的，这里只挡弹窗出现/消失动画期间的触摸空档
      if (this.consentState === 'required' && !this.consentDocOpen) {
        Column()
          .width('100%')
          .height('100%')
          .hitTestBehavior(HitTestMode.Block)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.isDark ? '#000000' : '#F2F2F7')
  }
}
