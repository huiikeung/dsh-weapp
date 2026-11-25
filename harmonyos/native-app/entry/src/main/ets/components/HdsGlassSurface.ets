import { hdsMaterial, HdsTabs, SystemMaterialParams } from '@kit.UIDesignKit';
import { GLASS_LEVEL_DEFAULT, GLASS_LEVEL_KEY } from '../common/GlassMaterial';

/**
 * HDS 沉浸光感玻璃底板（与输入条胶囊、置底按钮同一套材质）。
 *
 * 普通组件在内容区挂 systemMaterial 不生效（日志 "Material inactive: out of scope"），
 * 只能借 HdsTabs 底部悬浮 Bar 出材质。背板尺寸跟随内容实测值，形状按高度裁成胶囊
 * （radiusRatio = 0.5 → 半径取高度一半，矮条就是正圆）。
 *
 * 注意两个必须项，缺一个圆/胶囊背后就会露出直角色块：
 *   1) barBackgroundColor 置透明 —— TabBar 默认自带一层不透明底色；
 *   2) borderRadius + clip(true) —— 把方形裁到最大圆角。
 */
@Component
export struct HdsGlassSurface {
  @BuilderParam content: () => void;
  /** 圆角系数：0.5 = 半径取高度一半（胶囊/正圆） */
  @Prop radiusRatio: number = 0.5;
  /** 固定圆角（vp）：面板类（圆角矩形）用它，≥0 时优先于 radiusRatio */
  @Prop radiusVp: number = -1;
  /**
   * 压暗遮罩：HDS 材质会按背后内容自适应亮度（亮点阵/浅底上自己就发白），
   * 垫一层半透明暗色可以把它压回和会话页胶囊一致的深色观感。'#00000000' = 不压。
   */
  @Prop scrim: string = '#00000000';
  /**
   * 材质层整体不透明度：HDS 沉浸材质在亮背景下会发白，
   * 调低它可以让玻璃重新「透」出来（1 = 系统原样，0.5 左右明显更透）。
   */
  @Prop materialOpacity: number = 1;
  /** 材质档位（设置页可切，AppStorage 驱动，所有用本组件的地方一起变） */
  @StorageLink(GLASS_LEVEL_KEY) glassLevel: number = GLASS_LEVEL_DEFAULT;
  /** 内容实测尺寸（0 表示还没测到，先不画背板） */
  @State private boxW: number = 0;
  @State private boxH: number = 0;

  /**
   * 材质参数：EXQUISITE（精美）是最高档，玻璃最厚重、折射与高光最强；
   * ADAPTIVE 会按设备算力自选，可能落到 GENTLE/SMOOTH，观感明显变平。
   * 低算力设备上若发现卡顿，可降级为 GENTLE（官方建议：不支持 IMMERSIVE 时才用 SMOOTH）。
   */
  private material(): SystemMaterialParams {
    return {
      materialType: hdsMaterial.MaterialType.IMMERSIVE,
      materialLevel: this.glassLevel as hdsMaterial.MaterialLevel
    };
  }

  @Builder
  emptyTab() {
    Column().width(1).height(1).opacity(0).hitTestBehavior(HitTestMode.None)
  }

  build() {
    Stack() {
      if (this.boxW >= 1 && this.boxH >= 1) {
        HdsTabs({ barPosition: BarPosition.End, index: 0 }) {
          TabContent() {
            Column().width(1).height(1).opacity(0).hitTestBehavior(HitTestMode.None)
          }
          .tabBar(this.emptyTab())
        }
        .barMode(BarMode.Fixed)
        .scrollable(false)
        // 小艺同款三条件：横向 + 底部 + 浮在内容之上（缺一材质不生效）
        .vertical(false)
        .barOverlap(true)
        .barFloatingStyle({
          adaptToHandedness: false,
          barSideMargin: 0,
          barBottomMargin: 0,
          barWidth: { smallWidth: this.boxW, mediumWidth: this.boxW, largeWidth: this.boxW },
          systemMaterialEffect: this.material()
        })
        .barHeight(this.boxH)
        .width(this.boxW)
        .height(this.boxH)
        // TabBar 自带不透明底色：清掉，否则圆/胶囊背后会露出带直角的深色方块
        .barBackgroundColor('#00000000')
        // 圆角：胶囊/圆形取高度一半；面板类用传入的固定圆角（裁到最大圆角也不会露直角）
        .borderRadius(this.radiusVp >= 0 ? this.radiusVp : this.boxH * this.radiusRatio)
        .clip(true)
        // 只当背板：不抢触摸、不抢焦点
        .hitTestBehavior(HitTestMode.None)
        .focusable(false)
        .enabled(false)
        // 材质层整体透明度：亮背景下 HDS 会发白，调低它恢复通透
        .opacity(this.materialOpacity)
      }
      // 压暗遮罩：盖在材质上、内容下
      if (this.scrim !== '#00000000' && this.boxW >= 1 && this.boxH >= 1) {
        Column()
          .width(this.boxW)
          .height(this.boxH)
          .borderRadius(this.radiusVp >= 0 ? this.radiusVp : this.boxH * this.radiusRatio)
          .backgroundColor(this.scrim)
          .hitTestBehavior(HitTestMode.None)
      }
      Column() {
        this.content()
      }
      .onAreaChange((_old: Area, next: Area) => {
        const nw: number = Number(next.width);
        const nh: number = Number(next.height);
        if (Math.abs(nw - this.boxW) >= 1) {
          this.boxW = nw;
        }
        if (Math.abs(nh - this.boxH) >= 1) {
          this.boxH = nh;
        }
      })
    }
    .alignContent(Alignment.Center)
  }
}

