import { HdsNavDestination, ScrollEffectType, hdsMaterial } from '@kit.UIDesignKit';
import { currentGlassLevel, currentGlassMaterialLevel } from '../common/GlassMaterial';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';
import {
  applyGlassLevel, GLASS_LEVEL_DEFAULT, GLASS_LEVEL_KEY, GLASS_LEVEL_OPTIONS, GlassLevelOption
} from '../common/GlassMaterial';

/**
 * 玻璃材质（二级页）：四档沉浸光感强度。
 * 选中即全局生效 —— 所有用 HdsGlassSurface 的地方（首页两枚圆钮、置底按钮、模式按钮、
 * 消息队列 / 任务 / 目标面板、返回按钮）实时跟着换。
 */
@Component
export struct GlassMaterialPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink(GLASS_LEVEL_KEY) glassLevel: number = GLASS_LEVEL_DEFAULT;

  private scroller: Scroller = new Scroller();

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1F' : '#FFFFFF';
  }

  private cardBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)';
  }

  private selectedBg(): string {
    return this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.08)';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.62)';
  }

  private select(value: number): void {
    this.glassLevel = value;
    applyGlassLevel(value);
  }

  @Builder
  optionCard(option: GlassLevelOption) {
    Row() {
      Column({ space: 4 }) {
        Text(option.label)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Text(option.detail)
          .fontSize(12)
          .fontColor(this.subColor())
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      if (this.glassLevel === option.value) {
        Text('已选择')
          .fontSize(11)
          .fontColor('#5676C8')
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 14, bottom: 14 })
    .borderRadius(12)
    .backgroundColor(this.glassLevel === option.value ? this.selectedBg() : this.cardBg())
    .border({
      width: 1,
      color: this.glassLevel === option.value ? '#6B87D7' : this.cardBorder()
    })
    .onClick(() => {
      this.select(option.value);
    })
  }

  build() {
    HdsNavDestination() {
      Column() {
        Scroll(this.scroller) {
          Column({ space: 10 }) {
            // 首屏让出原生标题栏
            Column().width('100%').height((this.safeTopStorage > 0 ? this.safeTopStorage : 38.9) + 56)
            Text('沉浸光感强度：精美最厚重，流畅最省电。切换后全 App 的玻璃组件立即生效。')
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 2, bottom: 2 })

            ForEach(GLASS_LEVEL_OPTIONS, (option: GlassLevelOption) => {
              this.optionCard(option)
            }, (option: GlassLevelOption) => option.label)
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4, bottom: 30 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })
        .align(Alignment.Top)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .titleBar({
      avoidLayoutSafeArea: true,
      content: { title: { mainTitle: '玻璃材质' } },
      style: {
        scrollEffectOpts: {
          enableScrollEffect: true,
          scrollEffectType: ScrollEffectType.GRADIENT_BLUR
        },
        systemMaterialEffect: {
          materialType: hdsMaterial.MaterialType.IMMERSIVE,
          materialLevel: currentGlassMaterialLevel()
        },
        originalStyle: { contentStyle: { titleStyle: { mainTitleColor: $r('sys.color.font_primary') }, menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') } } },
        scrollEffectStyle: { contentStyle: { titleStyle: { mainTitleColor: $r('sys.color.font_primary') }, menuStyle: { iconColor: $r('sys.color.icon_primary'), backgroundColor: $r('sys.color.comp_background_tertiary') } } }
      }
    })
    .bindToScrollable([this.scroller])
    .backgroundColor(this.pageBg())
  }
}
