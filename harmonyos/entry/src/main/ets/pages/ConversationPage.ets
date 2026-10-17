import { DSHColor, DSHTheme } from '../theme/Theme';
import { HarnessAnimatedBackground } from '../theme/HarnessAnimatedBackground';

/**
 * ConversationPage
 * 对照 iOS 端 Views/ConversationView.swift（会话主界面）。
 * 阶段 4 接入 ConversationProjection + AssistantStreamState 与
 * ConversationViewport（虚拟化长列表、气泡、复制、slash 命令面板），
 * 当前为骨架占位。
 */
@Component
export struct ConversationPage {
  build() {
    Stack() {
      HarnessAnimatedBackground()
      Column() {
        Text('会话')
          .fontSize(DSHTheme.fontTitle)
          .fontColor(DSHTheme.textPrimary)
          .margin({ top: 16 })
        Text('等待 Gateway 连接（阶段 2）')
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
