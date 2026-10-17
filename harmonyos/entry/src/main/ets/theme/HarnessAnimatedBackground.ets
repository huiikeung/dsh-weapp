import { DSHColor } from './Theme';

/**
 * 深海动画背景
 * 对照 iOS 端 Components/HarnessAnimatedBackground.swift（Metal 实现）。
 * HarmonyOS 无逐字对应 Metal API，这里用 Canvas + requestAnimationFrame
 * 绘制多层缓慢漂移的径向光斑 + 纵向渐变，达到同方向的深海氛围效果。
 */
@Component
export struct HarnessAnimatedBackground {
  private settings: RenderingContextSettings = new RenderingContextSettings(true);
  private ctx: CanvasRenderingContext2D = new CanvasRenderingContext2D(this.settings);
  private startTime: number = 0;
  private animId: number = -1;

  /** 三层光斑参数：中心比例位置 + 半径比例 + 色相（ocean/purple/mist 微光） */
  private readonly blobs: Blob[] = [
    { cx: 0.25, cy: 0.2, r: 0.55, color: 'rgba(46,107,230,0.28)', speed: 0.00013, phase: 0 },
    { cx: 0.78, cy: 0.55, r: 0.45, color: 'rgba(122,84,199,0.22)', speed: 0.0001, phase: 2.1 },
    { cx: 0.5, cy: 0.88, r: 0.6, color: 'rgba(191,214,255,0.10)', speed: 0.00007, phase: 4.4 }
  ];

  private draw(now: number): void {
    if (this.startTime === 0) {
      this.startTime = now;
    }
    const t = now - this.startTime;
    const w = this.ctx.width;
    const h = this.ctx.height;

    // 纵向深海渐变底
    const grad = this.ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#05121F');
    grad.addColorStop(1, DSHColor.navy);
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, w, h);

    // 漂移光斑（正弦轨道）
    for (const b of this.blobs) {
      const ox = Math.sin(t * b.speed + b.phase) * w * 0.06;
      const oy = Math.cos(t * b.speed * 0.8 + b.phase) * h * 0.05;
      const cx = b.cx * w + ox;
      const cy = b.cy * h + oy;
      const r = b.r * Math.min(w, h);
      const rg = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, b.color);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      this.ctx.fillStyle = rg;
      this.ctx.fillRect(0, 0, w, h);
    }

    this.animId = requestAnimationFrame(() => this.draw(0));
    // requestAnimationFrame 回调不带时间戳时由下一帧 draw(0) 重置计时，
    // 但 startTime 已固定，t 以首帧为基准持续增长。
  }

  build() {
    Canvas(this.ctx)
      .width('100%')
      .height('100%')
      .onReady(() => {
        this.startTime = 0;
        this.draw(0);
      })
      .onDisappear(() => {
        if (this.animId >= 0) {
          cancelAnimationFrame(this.animId);
          this.animId = -1;
        }
      })
  }
}

interface Blob {
  cx: number;
  cy: number;
  r: number;
  color: string;
  speed: number;
  phase: number;
}
