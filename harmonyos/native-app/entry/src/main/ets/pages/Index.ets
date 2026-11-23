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
import { openSessionRoute } from '../common/SessionRoute';
import { StatusBarStyle } from '../services/StatusBarStyle';

@Entry
@Component
struct Index {
  @Provide('pageStack') pageStack: NavPathStack = new NavPathStack();
  @StorageLink('isDark') isDark: boolean = false;
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
    // 启动页只保留一帧过渡，尽快消失（对齐 iOS/Android 秒开）
    setTimeout(() => {
      this.splashVisible = false;
    }, 60);
    // 大缓存放到首帧后读，避免堵住启动
    setTimeout(() => {
      SessionStore.restoreCatalogCache();
    }, 80);
    this.applyAppColorMode();
    if (this.pendingSessionId.length > 0) this.openPendingSession();
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
  }

  @State private splashVisible: boolean = true;

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
    Navigation(this.pageStack) {
      HomePage();
    }
    .navDestination(this.PageMap)
    .hideTitleBar(true)
    .mode(NavigationMode.Stack)
    .width('100%')
    .height('100%')
    .backgroundColor(this.isDark ? '#000000' : '#F2F2F7')

    if (this.splashVisible) {
      Column() {
        Image(this.isDark ? $r('app.media.wordmark_white') : $r('app.media.wordmark_ink'))
          .height(26)
          .objectFit(ImageFit.Contain)
      }
      .width('100%')
      .height('100%')
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 24, top: (AppStorage.get<number>('safeTopVp') ?? 0) + 18 })
      .backgroundColor(this.isDark ? '#000000' : '#FFFFFF')
    }
    }
  }
}
