import { DSHColor, DSHTheme } from '../theme/Theme';
import { HarnessAnimatedBackground } from '../theme/HarnessAnimatedBackground';
import { ConversationPage } from './ConversationPage';
import { WorkspacePage } from './WorkspacePage';
import { TrajectoryPage } from './TrajectoryPage';
import { SettingsPage } from './SettingsPage';

/**
 * RootView 鸿蒙对应版
 * 对照 iOS 端 Views/RootView.swift：顶层导航容器。
 * iOS 用 environmentObject 注入 AppStore；鸿蒙阶段 3 接入 ArkTS MVI Store，
 * 当前先用 Tabs 骨架承载四个主页面。
 */
@Entry
@Component
struct Index {
  @State currentIndex: number = 0;

  @Builder
  tabBarItem(title: string, index: number) {
    Column() {
      Text(title)
        .fontSize(11)
        .fontColor(this.currentIndex === index ? DSHColor.ocean : DSHColor.mist)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }

  build() {
    Stack() {
      // 全局深海动画背景
      HarnessAnimatedBackground()

      Column() {
        Tabs({ barPosition: BarPosition.End, index: this.currentIndex }) {
          TabContent() {
            ConversationPage()
          }
          .tabBar(this.tabBarItem($r('app.string.tab_conversation'), 0))

          TabContent() {
            WorkspacePage()
          }
          .tabBar(this.tabBarItem($r('app.string.tab_workspace'), 1))

          TabContent() {
            TrajectoryPage()
          }
          .tabBar(this.tabBarItem($r('app.string.tab_trajectory'), 2))

          TabContent() {
            SettingsPage()
          }
          .tabBar(this.tabBarItem($r('app.string.tab_settings'), 3))
        }
        .barBackgroundColor(DSHColor.navyRaised)
        .barHeight(52)
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
    }
  }
}
