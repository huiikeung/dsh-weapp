import { DSHColor, DSHTheme } from '../theme/Theme';
import { HarnessAnimatedBackground } from '../theme/HarnessAnimatedBackground';

/**
 * WorkspacePage
 * 对照 iOS 端 Views/WorkspaceView.swift（目录浏览、代码预览）。
 * 阶段 5 接入 SharedWorkspaceFileStore / WorkspaceCodePreviewSupport，
 * 当前为骨架占位。
 */
@Component
export struct WorkspacePage {
  build() {
    Stack() {
      HarnessAnimatedBackground()
      Column() {
        Text('工作区')
          .fontSize(DSHTheme.fontTitle)
          .fontColor(DSHTheme.textPrimary)
          .margin({ top: 16 })
        Text('目录浏览将在阶段 5 接入')
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
