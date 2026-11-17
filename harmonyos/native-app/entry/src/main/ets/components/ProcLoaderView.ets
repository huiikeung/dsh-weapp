/**
 * ProcLoaderView —— 执行图标动效（设置页「执行图标」13 种样式共用）。
 * 供会话页运行中过程组与设置二级页的预览同时使用，保证两处完全一致。
 */
@Component
export struct ProcLoaderView {
  @Prop style: string = 'spin-ring';
  @Prop isDark: boolean = false;
  @Prop boxSize: number = 18.77;
  @State private phase: number = 0;
  private timer: number = -1;

  aboutToAppear(): void {
    this.timer = setInterval(() => {
      this.phase = (this.phase + 1) % 4;
    }, 300);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private ink(): string {
    return this.isDark ? '#E2E2E2' : '#5A5A5A';
  }

  private dotOpacity(index: number): number {
    return this.phase === (index % 4) ? 1 : 0.22;
  }

  @Builder
  dot(index: number, dotSize: number) {
    Column()
      .width(dotSize)
      .height(dotSize)
      .borderRadius(dotSize / 2)
      .backgroundColor(this.ink())
      .opacity(this.dotOpacity(index))
  }

  @Builder
  cell(index: number) {
    Column()
      .width(this.boxSize * 0.313)
      .height(this.boxSize * 0.313)
      .borderRadius(this.boxSize * 0.062)
      .backgroundColor(this.ink())
      .opacity(this.dotOpacity(index))
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.style === 'spin-ring') {
        LoadingProgress().width(this.boxSize).height(this.boxSize).color(this.ink())
      } else if (this.style === 'grid') {
        Column({ space: this.boxSize * 0.085 }) {
          Row({ space: this.boxSize * 0.085 }) {
            this.dot(0, this.boxSize * 0.18)
            this.dot(1, this.boxSize * 0.18)
            this.dot(2, this.boxSize * 0.18)
          }
          Row({ space: this.boxSize * 0.085 }) {
            this.dot(3, this.boxSize * 0.18)
            this.dot(0, this.boxSize * 0.18)
            this.dot(1, this.boxSize * 0.18)
          }
          Row({ space: this.boxSize * 0.085 }) {
            this.dot(2, this.boxSize * 0.18)
            this.dot(3, this.boxSize * 0.18)
            this.dot(0, this.boxSize * 0.18)
          }
        }
      } else if (this.style === 'orbit') {
        Circle()
          .width(this.boxSize * 0.22)
          .height(this.boxSize * 0.22)
          .fill(this.ink())
          .offset({ x: this.boxSize * 0.32, y: 0 })
          .rotate({ angle: this.phase * 90, centerX: '50%', centerY: '50%' })
      } else if (this.style === 'ripple' || this.style === 'pulse-ring') {
        Circle()
          .width(this.boxSize * 0.32 + this.phase * this.boxSize * 0.18)
          .height(this.boxSize * 0.32 + this.phase * this.boxSize * 0.18)
          .fill(Color.Transparent)
          .stroke(this.ink())
          .strokeWidth(1.4)
          .opacity(1 - this.phase * 0.22)
      } else if (this.style === 'wave' || this.style === 'breathe-bars') {
        Row({ space: this.boxSize * 0.12 }) {
          Column().width(this.boxSize * 0.13).height(this.boxSize * 0.32 + this.phase * this.boxSize * 0.16)
            .borderRadius(this.boxSize * 0.065).backgroundColor(this.ink())
          Column().width(this.boxSize * 0.13).height(this.boxSize * 0.75 - this.phase * this.boxSize * 0.11)
            .borderRadius(this.boxSize * 0.065).backgroundColor(this.ink())
          Column().width(this.boxSize * 0.13).height(this.boxSize * 0.43 + this.phase * this.boxSize * 0.11)
            .borderRadius(this.boxSize * 0.065).backgroundColor(this.ink())
          Column().width(this.boxSize * 0.13).height(this.boxSize * 0.59 - this.phase * this.boxSize * 0.08)
            .borderRadius(this.boxSize * 0.065).backgroundColor(this.ink())
        }
      } else if (this.style === 'typing-dots' || this.style === 'terra') {
        Row({ space: this.boxSize * 0.16 }) {
          this.dot(this.phase, this.boxSize * 0.22)
          this.dot(this.phase + 1, this.boxSize * 0.22)
          this.dot(this.phase + 2, this.boxSize * 0.22)
        }
      } else if (this.style === 'spin-square' || this.style === 'morph') {
        Column()
          .width(this.boxSize * 0.53)
          .height(this.boxSize * 0.53)
          .border({ width: 1.6, color: this.ink() })
          .borderRadius(this.style === 'morph' ? this.boxSize * (0.1 + this.phase * 0.08) : this.boxSize * 0.1)
          .rotate({ angle: this.phase * 45 })
      } else if (this.style === 'scan-line') {
        Column()
          .width(this.boxSize * 0.75)
          .height(1.8)
          .backgroundColor(this.ink())
          .offset({ y: -this.boxSize * 0.32 + this.phase * this.boxSize * 0.21 })
      } else {
        // cells（默认）
        Column() {
          Row() {
            this.cell(0)
            this.cell(1)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          Row() {
            this.cell(2)
            this.cell(3)
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
        }
        .width(this.boxSize)
        .height(this.boxSize)
        .padding(this.boxSize * 0.125)
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(HorizontalAlign.Center)
        .borderRadius(this.boxSize * 0.25)
        .border({ width: 0.5, color: this.isDark ? 'rgba(226,226,226,0.45)' : 'rgba(90,90,90,0.28)' })
      }
    }
    .width(this.boxSize)
    .height(this.boxSize)
  }
}
