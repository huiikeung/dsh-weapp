import { HomePage } from './HomePage';
import { AddNodePage } from './AddNodePage';
import { SessionPage } from './SessionPage';
import { NodeManagePage } from './NodeManagePage';
import { PluginsPage } from './PluginsPage';
import { SchedulePage } from './SchedulePage';
import { SessionSettingsPage } from './SessionSettingsPage';
import { AppSettingsPage } from './AppSettingsPage';
import { SettingsPage } from './SettingsPage';

@Entry
@Component
struct Index {
  @Provide('pageStack') pageStack: NavPathStack = new NavPathStack();
  @StorageLink('isDark') isDark: boolean = false;

  @Builder
  PageMap(name: string) {
    if (name === 'session') {
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
