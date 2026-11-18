/**
 * FluKeCoin —— 品牌行的 3D 品牌硬币（App 图标：圆角六边形 + fluKe）。
 *
 * 结构：把图标拆成「正面 / 侧壁 / 背面」三种贴图，沿币厚方向叠 9 层：
 *   · 每层按深度做屏幕偏移，正面转到侧面时侧壁自然露出来，形成币边；
 *   · 所有层套同一组三轴角度做透视旋转，正面随角度压扁；
 *   · 转过 90° 后按朝向翻转叠放次序，背面贴图预镜像，翻过去仍是正字。
 *
 * 交互：手指按在硬币上任意方向拖动即可上下/左右翻转，松手带惯性滑行；
 * 不自动旋转。硬币命中时阻断外层 Scroll（hitTestBehavior），竖直方向也归硬币；
 * 轻点硬币等同点品牌行，打开侧栏。
 */

/** 币厚切层数 */
const COIN_SLICES: number = 14;
/** 拖动灵敏度：每 vp 位移转多少度 */
const COIN_DRAG_DEG: number = 1.55;
/** 惯性衰减与停止阈值 */
const COIN_INERTIA_DECAY: number = 0.93;
const COIN_INERTIA_STOP: number = 0.12;
const COIN_INERTIA_MS: number = 16;

@Component
export struct FluKeCoin {
  /** 硬币直径（vp） */
  @Prop diameter: number = 36;
  /** 币厚占直径的比例 */
  @Prop thicknessRatio: number = 0.12;
  /** 左右转角（绕竖轴） */
  @State private angleY: number = -18;
  /** 上下转角（绕横轴） */
  @State private angleX: number = 8;
  private velocityX: number = 0;
  private velocityY: number = 0;
  private lastX: number = 0;
  private lastY: number = 0;
  private inertia: number = -1;
  /** 本次触摸是否已经变成拖动：拖动过就不再当成点击打开侧栏 */
  private dragged: boolean = false;
  private layers: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  /** 轻点硬币（等同点品牌行）：打开侧栏 */
  onTap: () => void = () => {};

  aboutToDisappear(): void {
    this.stopInertia();
  }

  private stopInertia(): void {
    if (this.inertia >= 0) {
      clearInterval(this.inertia);
      this.inertia = -1;
    }
  }

  private startInertia(): void {
    this.stopInertia();
    if (Math.abs(this.velocityX) < COIN_INERTIA_STOP && Math.abs(this.velocityY) < COIN_INERTIA_STOP) {
      return;
    }
    this.inertia = setInterval(() => {
      this.angleY += this.velocityY;
      this.angleX += this.velocityX;
      this.velocityX *= COIN_INERTIA_DECAY;
      this.velocityY *= COIN_INERTIA_DECAY;
      if (Math.abs(this.velocityX) < COIN_INERTIA_STOP && Math.abs(this.velocityY) < COIN_INERTIA_STOP) {
        this.stopInertia();
      }
    }, COIN_INERTIA_MS);
  }

  private rad(deg: number): number {
    return deg * Math.PI / 180;
  }

  /** 第 index 层离正面的厚度（vp） */
  private depthOf(index: number): number {
    return index / (COIN_SLICES - 1) * this.diameter * this.thicknessRatio;
  }

  /** 币厚在屏幕 X 方向的投影：绕竖轴转得越多，侧壁露出越宽 */
  private shiftX(index: number): number {
    return -this.depthOf(index) * Math.sin(this.rad(this.angleY)) * Math.cos(this.rad(this.angleX));
  }

  /** 币厚在屏幕 Y 方向的投影：上下翻转时露出上/下侧壁 */
  private shiftY(index: number): number {
    return this.depthOf(index) * Math.sin(this.rad(this.angleX));
  }

  /** 叠放次序：正面朝观众时正面压在最上，转过 90° 后背面翻到最上 */
  private stackOrder(index: number): number {
    const facing: number = Math.cos(this.rad(this.angleY)) * Math.cos(this.rad(this.angleX));
    return facing >= 0 ? COIN_SLICES - 1 - index : index;
  }

  @Builder
  coinLayer(index: number) {
    Stack() {
      Stack() {
        if (index === 0) {
          Image($r('app.media.fluke_coin_face'))
            .width(this.diameter)
            .height(this.diameter)
            .objectFit(ImageFit.Contain)
            .interpolation(ImageInterpolation.High)
        } else if (index === COIN_SLICES - 1) {
          Image($r('app.media.fluke_coin_back'))
            .width(this.diameter)
            .height(this.diameter)
            .objectFit(ImageFit.Contain)
            .interpolation(ImageInterpolation.High)
        } else {
          Image($r('app.media.fluke_coin_rim'))
            .width(this.diameter)
            .height(this.diameter)
            .objectFit(ImageFit.Contain)
            .interpolation(ImageInterpolation.High)
        }
      }
      .width(this.diameter)
      .height(this.diameter)
      .rotate({
        angleX: this.angleX,
        angleY: this.angleY,
        perspective: this.diameter * 11
      })
    }
    .width(this.diameter)
    .height(this.diameter)
    .translate({ x: this.shiftX(index), y: this.shiftY(index) })
    .zIndex(this.stackOrder(index))
  }

  /** 侧视时露出的币厚宽度（屏幕投影） */
  private edgeWidth(): number {
    const projected: number = this.diameter * this.thicknessRatio
      * Math.abs(Math.sin(this.rad(this.angleY))) * Math.cos(this.rad(this.angleX));
    return Math.max(0.8, projected);
  }

  /** 侧视时的硬币投影高度 */
  private edgeHeight(): number {
    // 与贴图里六边形的高度对齐（约 0.965 直径），确保上下尖角被整料盖住
    return this.diameter * 0.955 * Math.cos(this.rad(this.angleX));
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // 侧壁「整料」：屏幕空间的一块金属，把前后两面之间被压成缝隙的部分填实。
      // 只有接近侧视时它才露出来，正面/斜侧视角都被上面的切片盖住。
      Column()
        .width(this.edgeWidth())
        .height(this.edgeHeight())
        .translate({ x: this.shiftX((COIN_SLICES - 1) / 2), y: this.shiftY((COIN_SLICES - 1) / 2) })
        .borderRadius(this.diameter * 0.04)
        .linearGradient({
          direction: GradientDirection.Right,
          colors: [['#F2F7FE', 0], ['#FFFFFF', 0.5], ['#E4ECF6', 1]]
        })
        .zIndex(-1)
      ForEach(this.layers, (index: number) => {
        this.coinLayer(index);
      }, (index: number) => index.toString())
    }
    .width(this.diameter)
    .height(this.diameter)
    .onTouch((event: TouchEvent) => {
      if (event.type === TouchType.Down) {
        this.dragged = false;
      }
    })
    .onClick(() => {
      if (!this.dragged) {
        this.onTap();
      }
    })
    .priorityGesture(
      PanGesture({ fingers: 1, direction: PanDirection.All, distance: 1 })
        .onActionStart(() => {
          this.stopInertia();
          this.dragged = true;
          this.lastX = 0;
          this.lastY = 0;
          this.velocityX = 0;
          this.velocityY = 0;
        })
        .onActionUpdate((event: GestureEvent) => {
          const dx: number = event.offsetX - this.lastX;
          const dy: number = event.offsetY - this.lastY;
          this.lastX = event.offsetX;
          this.lastY = event.offsetY;
          this.angleY += dx * COIN_DRAG_DEG;
          this.angleX -= dy * COIN_DRAG_DEG;
          this.velocityY = dx * COIN_DRAG_DEG;
          this.velocityX = -dy * COIN_DRAG_DEG;
        })
        .onActionEnd(() => {
          this.startInertia();
        })
    )
  }
}