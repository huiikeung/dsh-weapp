/**
 * 鸿蒙原生粒子背景（深海漂浮尘埃）。
 *
 * 说明：ArkUI 的 Particle 组件及其 ParticleType / ParticleEmitterShape / ParticleUpdater /
 * DistributionType 类型属于全局 component 声明（component/particle.d.ts），并不是
 * @kit.ArkUI 的导出成员，因此不能通过 import 引入；且该组件的匿名对象配置在不同
 * SDK 版本间差异较大。这里改用基础图元（Circle）+ 定时器实现同样的「缓慢上浮尘埃」观感，
 * 只依赖 ArkUI 稳定能力，保证在 API 12+ 设备上可编译、可运行。
 *
 * 该组件自带底色，可直接作为设置页 / 弹层 / 子页面的背景层使用。
 */
@Component
export struct ParticleBackground {
  /** 是否深色模式 */
  @Prop isDark: boolean = false;
  /** 粒子颜色（rgba） */
  @Prop particleColor: string = 'rgba(150, 200, 255, 0.55)';
  /** 粒子总数量 */
  @Prop particleCount: number = 36;
  /** 是否启用粒子层（关闭时只渲染底色） */
  @Prop particlesEnabled: boolean = true;

  /** 累计动画时间（毫秒），驱动粒子缓慢上浮 */
  @State elapsedMs: number = 0;
  private timerId: number = -1;

  aboutToAppear(): void {
    if (this.timerId < 0) {
      this.timerId = setInterval(() => {
        this.elapsedMs = (this.elapsedMs + 100) % 3600000;
      }, 100);
    }
  }

  aboutToDisappear(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
  }

  private bgColor(): string {
    return this.isDark ? '#0A0C14' : '#F4F6FB';
  }

  private indexes(): number[] {
    const list: number[] = [];
    for (let i = 0; i < this.particleCount; i++) {
      list.push(i);
    }
    return list;
  }

  /** 确定性伪随机，避免每次重绘粒子位置跳动。 */
  private rand(index: number, salt: number): number {
    const value: number = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private particleX(index: number): string {
    return (this.rand(index, 1) * 100).toFixed(2) + '%';
  }

  private particleY(index: number): string {
    const span: number = 115;
    const speed: number = 1.2 + this.rand(index, 2) * 2.2;
    const base: number = this.rand(index, 3) * span;
    const current: number = base - (this.elapsedMs / 1000) * speed;
    const wrapped: number = ((current % span) + span) % span;
    return wrapped.toFixed(2) + '%';
  }

  private particleSize(index: number): number {
    return 1.6 + this.rand(index, 4) * 2.8;
  }

  private particleOpacity(index: number): number {
    return 0.12 + this.rand(index, 5) * 0.5;
  }

  build() {
    Stack() {
      if (this.particlesEnabled) {
        ForEach(this.indexes(), (index: number) => {
          Circle()
            .width(this.particleSize(index))
            .height(this.particleSize(index))
            .fill(this.particleColor)
            .opacity(this.particleOpacity(index))
            .position({ x: this.particleX(index), y: this.particleY(index) })
        }, (index: number) => index.toString())
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.bgColor())
    .hitTestBehavior(HitTestMode.None)
  }
}
