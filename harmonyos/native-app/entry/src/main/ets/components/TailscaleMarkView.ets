/**
 * Tailscale 九点标记（对齐 iOS TailscaleMarkIcon）：
 * - 连接中：16 帧、100ms 一帧闪；
 * - 已连接：静态点亮 4 个点（索引 3/4/5/7）；
 * - 未点亮点的透明度 77/255。
 * 视口 48，中心间距 13.1，点半径 4.4（按 18vp 缩放渲染）。
 */
const MARK_VIEWPORT: number = 48;
const MARK_RADIUS: number = 4.4;
const MARK_DIM_ALPHA: number = 77 / 255;
const MARK_FRAME_MILLIS: number = 100;

const CONNECTING_FRAMES: number[][] = [
  [1, 2, 3, 5, 8], [1, 2, 5, 7], [1, 2, 8], [2, 4], [1], [5], [], [2],
  [6], [6], [6, 7], [3, 6, 7], [3, 4, 7], [3, 4, 7, 8], [3, 4, 5, 8], [1, 4, 5, 6, 8]
];
const CONNECTED_FRAME: number[] = [3, 4, 5, 7];

@Component
export struct TailscaleMarkView {
  @Prop @Watch('onConnectedChanged') connected: boolean = false;
  @Prop tint: string = 'rgba(255,255,255,0.85)';
  @Prop markSize: number = 18;
  @State frame: number = 0;
  private timer: number = -1;

  aboutToAppear(): void {
    this.syncTimer();
  }

  aboutToDisappear(): void {
    this.clearTimer();
  }

  onConnectedChanged(): void {
    this.syncTimer();
  }

  private clearTimer(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private syncTimer(): void {
    this.clearTimer();
    if (this.connected) {
      return;
    }
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % CONNECTING_FRAMES.length;
    }, MARK_FRAME_MILLIS);
  }

  private lit(): number[] {
    return this.connected ? CONNECTED_FRAME : CONNECTING_FRAMES[this.frame];
  }

  private dotSize(): number {
    return MARK_RADIUS * 2 * (this.markSize / MARK_VIEWPORT);
  }

  private dotPosition(index: number): number[] {
    const col: number = index % 3;
    const row: number = Math.floor(index / 3);
    const scale: number = this.markSize / MARK_VIEWPORT;
    const centerX: number = 10.8 + col * 13.1;
    const centerY: number = 10.8 + row * 13.1;
    const radius: number = MARK_RADIUS;
    return [(centerX - radius) * scale, (centerY - radius) * scale];
  }

  @Builder
  dot(index: number) {
    Circle()
      .width(this.dotSize())
      .height(this.dotSize())
      .fill(this.tint)
      .opacity(this.lit().indexOf(index) >= 0 ? 1 : MARK_DIM_ALPHA)
      .position({ x: this.dotPosition(index)[0], y: this.dotPosition(index)[1] })
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      ForEach([0, 1, 2, 3, 4, 5, 6, 7, 8], (index: number) => {
        this.dot(index)
      }, (index: number) => index.toString())
    }
    .width(this.markSize)
    .height(this.markSize)
  }
}
