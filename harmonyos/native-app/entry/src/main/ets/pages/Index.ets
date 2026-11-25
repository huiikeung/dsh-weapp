import { BackgroundKeepAlive } from '../services/BackgroundKeepAlive';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { Logger } from 'nativecore';
import { SessionStore } from 'nativecore';
import { HomePage } from './HomePage';
import { AddNodePage } from './AddNodePage';
import { ConversationPage } from './ConversationPage';
import { BotHomePage } from './BotHomePage';
import { BotChatPage } from './BotChatPage';
import { BotRolePage } from './BotRolePage';
import { BotCreatePage } from './BotCreatePage';
import { BotManagePage } from './BotManagePage';
import { BotNewChatPage } from './BotNewChatPage';
import { ModeWave } from '../components/ModeWave';

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
import { GlassMaterialPage } from './GlassMaterialPage';
import { PreferencePickerPage } from './PreferencePickerPage';
import { FontSizePage } from './FontSizePage';
import { ClawbotPage } from './ClawbotPage';
import { StorageSpacePage } from './StorageSpacePage';
import { ConnectorsPage } from './ConnectorsPage';
import { ConnectorStatusPage } from './ConnectorStatusPage';
import { NetworkPage } from './NetworkPage';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { UserAgreementPage } from './UserAgreementPage';
import { openSessionRoute } from '../common/SessionRoute';
import { StatusBarStyle } from '../services/StatusBarStyle';
import { PrivacyConsent } from '../services/PrivacyConsent';
import { promptAction } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { PrivacyConsentDialog, consentDialogMaterial } from '../components/PrivacyConsentDialog';

@Entry
@Component
struct Index {
  @Provide('pageStack') pageStack: NavPathStack = new NavPathStack();
  @StorageLink('isDark') isDark: boolean = false;
  /** 首次启动隐私同意：unknown / required / granted，未同意前不自动联网（见 EntryAbility.startNetworking） */
  @StorageLink('privacyConsentState') @Watch('onConsentStateChanged') consentState: string = 'unknown';
  /** 正在查看《用户协议》/《隐私政策》：此时不弹同意弹窗，返回首页后再弹 */
  @State consentDocOpen: boolean = false;
  /** 系统同意弹窗的 id（openCustomDialog 返回）；-1 表示没在显示 */
  private consentDialogId: number = -1;
  /** 正在打开或已经显示：启动时 aboutToAppear 和首页 didShow 都会触发，避免重复弹 */
  private consentDialogShown: boolean = false;
  /** 系统弹窗打不开时的兜底：改用自绘同意层，保证用户始终能看到并同意 */
  @State consentFallback: boolean = false;
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
    // 让 NavBackButton 能自己 pop：组件内部读这个共享栈，不依赖各页面挂 onClick
    AppStorage.setOrCreate<NavPathStack>('navPathStack', this.pageStack);
    // 路由切换时同步状态栏归属页面：首页 NavBar 记为 ''，其它记 NavDestination 名字
// 必须用箭头函数包一层：直接传方法引用会丢 this（回调里的 this 不是页面实例），
    // 之后在回调里读写页面状态会抛 TypeError，框架回调里的异常无法捕获，进程会被直接杀掉。
    this.pageStack.setInterception({
      didShow: (from: NavDestinationContext | NavBar, to: NavDestinationContext | NavBar, operation: NavigationOperation,
        isAnimated: boolean) => {
        this.syncStatusBarRoute(from, to, operation, isAnimated);
      }
    });
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
    // 上次停留在 Bot 模式：进入首页后自动切回 Bot 模式
    setTimeout(() => {
      const mode: string = AppStorage.get<string>('botMode') ?? '0';
      const names: string[] = this.pageStack.getAllPathName();
      if (mode === '1' && names.length === 0) {
        this.pageStack.pushPathByName('bot-home', null, false);
      }
    }, 900);
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
    if (name === 'bot-home') {
      BotHomePage();
    } else if (name === 'bot-chat') {
      BotChatPage();
    } else if (name === 'bot-role') {
      BotRolePage();
    } else if (name === 'bot-manage') {
      BotManagePage();
    } else if (name === 'bot-create') {
      BotCreatePage();
    } else if (name === 'bot-new-chat') {
      BotNewChatPage();
    } else if (name === 'session') {
      ConversationPage();
    } else if (name === 'connectors') {
      ConnectorsPage();
    } else if (name === 'connector-status') {
      ConnectorStatusPage();
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
    } else if (name === 'glass-material') {
      GlassMaterialPage();
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
    // 协议页在前台时先不弹同意弹窗（它是在弹窗收起后推入的）；其它任何页面显示时（首页、会话页、
    // 设置页……），还没同意就把同意弹窗重新弹出来。
    // 不能只认首页：深链可能先打开了别的页面，协议页是在它上面推入的，返回时回到的是那个页面而不是首页。
    this.consentDocOpen = routeName === 'privacy-policy' || routeName === 'user-agreement';
    this.syncConsentDialog();
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
      this.closeConsentDialog();
      return;
    }
    if (this.consentState === 'required' && !this.consentDocOpen) {
      // 等页面首帧之后再弹，避免在页面还没挂载时 open()
      setTimeout(() => {
        this.showConsentDialog();
      }, 60);
    }
  }

  /** 同意弹窗内容（openCustomDialog 的 builder 必须写成 () => { this.内部builder() } 的形式） */
  @Builder
  consentDialogContent() {
    PrivacyConsentDialog({
      onAgree: () => {
        PrivacyConsent.agree();
      },
      onDisagree: () => {
        Logger.info('CONSENT disagree (system dialog) -> terminateSelf');
        // 不同意则退出应用；下次启动仍会看到同意弹窗
        const ctx = getContext(this) as common.UIAbilityContext;
        ctx.terminateSelf().catch(() => {
        });
      },
      onOpenDoc: (route: string) => {
        this.openConsentDoc(route);
      }
    })
  }

  /**
   * 首次启动隐私同意弹窗：全局自定义弹窗（promptAction.openCustomDialog）+ 沉浸光感材质，
   * 模态且不会被返回键/遮罩关掉。
   *
   * 不用 CustomDialogController：这个 SDK 下它的 builder 写成组件调用时，编译器不会转成 builder 闭包，
   * 运行时会以「class constructor cannot called without new」崩溃。
   */
  private showConsentDialog(): void {
    if (this.consentState !== 'required' || this.consentDocOpen || this.consentFallback || this.consentDialogShown) {
      return;
    }
    this.consentDialogShown = true;
    Logger.info('CONSENT opening dialog');
    try {
      this.getUIContext().getPromptAction().openCustomDialog({
        builder: () => {
          this.consentDialogContent();
        },
        onWillAppear: () => {
          Logger.info('CONSENT dialog will appear');
        },
        alignment: DialogAlignment.Center,
        autoCancel: false,
        isModal: true,
        systemMaterial: consentDialogMaterial(),
        onWillDismiss: (action: DismissDialogAction) => {
          // 注册了这个回调后，返回键/点遮罩不会直接关闭；未同意前什么都不做，弹窗保持打开
        }
      }).then((dialogId: number) => {
        Logger.info('CONSENT dialog opened id=' + dialogId);
        this.consentDialogId = dialogId;
        // 打开动画期间用户已经同意、或点了协议链接：拿到 id 后立刻补关
        if (this.consentState === 'granted' || this.consentDocOpen) {
          this.closeConsentDialog();
        }
      }).catch((err: BusinessError) => {
        Logger.error('consent dialog failed: code=' + err.code + ' message=' + err.message);
        this.consentDialogShown = false;
        this.consentFallback = true;
      });
    } catch (err) {
      const fail = err as BusinessError;
      Logger.error('consent dialog failed: code=' + fail.code + ' message=' + fail.message);
      this.consentDialogShown = false;
      this.consentFallback = true;
    }
  }

  private closeConsentDialog(): void {
    this.consentDialogShown = false;
    if (this.consentDialogId >= 0) {
      Logger.info('CONSENT close dialog id=' + this.consentDialogId + ' state=' + this.consentState);
      try {
        this.getUIContext().getPromptAction().closeCustomDialog(this.consentDialogId);
      } catch (err) {
        Logger.error('consent dialog close failed: ' + JSON.stringify(err));
      }
      this.consentDialogId = -1;
    }
  }

  /** 打开协议页查看全文：先收起弹窗，返回首页时 syncConsentDialog 会重新弹出来 */
  private openConsentDoc(route: string): void {
    Logger.info('CONSENT open doc ' + route);
    this.consentDocOpen = true;
    this.closeConsentDialog();
    this.pageStack.pushPathByName(route, null);
  }
  /** 自绘同意层：和系统弹窗同一份内容，外面套一层半透明遮罩 + 奶白/深色玻璃卡片 */
  @Builder
  consentFallbackOverlay() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .hitTestBehavior(HitTestMode.Block)
      Column() {
        PrivacyConsentDialog({
          onAgree: () => {
            PrivacyConsent.agree();
          },
          onDisagree: () => {
            Logger.info('CONSENT disagree (fallback overlay) -> terminateSelf');
            const ctx = getContext(this) as common.UIAbilityContext;
            ctx.terminateSelf().catch(() => {
            });
          },
          onOpenDoc: (route: string) => {
            this.openConsentDoc(route);
          }
        })
      }
      // 留白由 PrivacyConsentDialog 自己带（和系统弹窗里保持一致）
      .width('calc(100% - 48vp)')
      .borderRadius(20)
      .backgroundColor(this.isDark ? 'rgba(44,46,52,0.70)' : 'rgba(255,255,255,0.72)')
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, {
        colorMode: this.isDark ? ThemeColorMode.DARK : ThemeColorMode.LIGHT
      })
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.65)' })
      .shadow({ radius: 28, color: 'rgba(0,0,0,0.28)', offsetY: 12 })
      .clip(true)
    }
    .width('100%')
    .height('100%')
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

      // 模式切换波纹（工作 ⇄ Bot，对齐 iOS WorkspaceModeWave）
      ModeWave()

      // 系统弹窗打不开时的兜底：自绘玻璃同意层（内容复用 PrivacyConsentDialog）
      if (this.consentFallback && this.consentState === 'required' && !this.consentDocOpen) {
        this.consentFallbackOverlay()
      }
      // 未同意期间的兜底：弹窗本身是模态的，这里只挡弹窗出现/消失动画期间的触摸空档
      if (this.consentState === 'required' && !this.consentDocOpen && !this.consentFallback) {
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
