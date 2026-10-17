import { DSHColor, DSHTheme } from '../theme/Theme';
import { HarnessAnimatedBackground } from '../theme/HarnessAnimatedBackground';

/**
 * SettingsPage
 * 对照 iOS 端 Views/SettingsView.swift。
 * 阶段 2 接入主机管理（GatewayProfile 列表、配对），阶段 6 补齐通知/主题设置，
 * 当前为骨架占位。
 */
@Component
export struct SettingsPage {
  build() {
    Stack() {
      HarnessAnimatedBackground()
      Column() {
        Text('设置')
          .fontSize(DSHTheme.fontTitle)
          .fontColor(DSHTheme.textPrimary)
          .margin({ top: 16 })
        Text('主机管理与配对将在阶段 2 接入')
          .fontSize(DSHTheme.fontCaption)
          .fontColor(DSHTheme.textSecondary)
          .margin({ top: 8 })
      }
      .width('100%')
    }
    .width('100%')
    .height('100%')
  }
}
