import { DSHColor, DSHTheme } from '../theme/Theme';
import { HarnessAnimatedBackground } from '../theme/HarnessAnimatedBackground';

/**
 * TrajectoryPage
 * 对照 iOS 端 Views/TrajectoryView.swift（执行轨迹）。
 * 阶段 5 接入 TrajectoryProjection + HistoryReducer（分页合并、live tail 去重），
 * 当前为骨架占位。
 */
@Component
export struct TrajectoryPage {
  build() {
    Stack() {
      HarnessAnimatedBackground()
      Column() {
        Text('轨迹')
          .fontSize(DSHTheme.fontTitle)
          .fontColor(DSHTheme.textPrimary)
          .margin({ top: 16 })
        Text('执行轨迹将在阶段 5 接入')
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
