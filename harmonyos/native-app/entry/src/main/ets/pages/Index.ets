import { BackgroundKeepAlive } from '../services/BackgroundKeepAlive';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { Logger } from 'nativecore';
import { SessionStore } from 'nativecore';
import { HomePage } from './HomePage';
import { AddNodePage } from './AddNodePage';
import { ConversationPage } from './ConversationPage';
import { SessionPage } from './SessionPage';
import { NodeManagePage } from './NodeManagePage';
import { PluginsPage } from './PluginsPage';
import { SchedulePage } from './SchedulePage';
import { SessionSettingsPage } from './SessionSettingsPage';
import { AppSettingsPage } from './AppSettingsPage';
import { SettingsPage } from './SettingsPage';
import { ModelsPage } from './ModelsPage';
import { TailscalePage } from './TailscalePage';
import { StatusStylesPage } from './StatusStylesPage';
import { PreferencePickerPage } from './PreferencePickerPage';

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
    SessionStore.restoreCatalogCache();
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
    this.pageStack.pushPathByName('session', null);
  }

  @Builder
  PageMap(name: string) {
    if (name === 'session') {
      ConversationPage();
    } else if (name === 'session-tools') {
      SessionPage();
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
    } else if (name === 'app-settings') {
      AppSettingsPage();
    } else if (name === 'settings') {
      SettingsPage();
    } else if (name === 'models') {
      ModelsPage();
    } else if (name === 'tailscale') {
      TailscalePage();
    } else if (name === 'status-styles') {
      StatusStylesPage();
    } else if (name === 'pref-picker') {
      PreferencePickerPage();
    }
  }

  build() {
    Navigation(this.pageStack) {
      HomePage();
    }
    .navDestination(this.PageMap)
    .hideTitleBar(true)
    .mode(NavigationMode.Stack)
    .width('100%')
    .height('100%')
    .backgroundColor(this.isDark ? '#000000' : '#F2F2F7')
  }
}
