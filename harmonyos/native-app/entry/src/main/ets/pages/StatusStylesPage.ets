import { PreferencesStore, StatusAppearance } from 'nativecore';


/** 对话状态条样式（对齐小程序 pages/settings/utils/status-appearance.js 的 OPTIONS） */
interface StatusStyleOption {
  id: string;
  label: string;
  detail: string;
  colors: string[];
  darkColors: string[];
}

const STATUS_OPTIONS: StatusStyleOption[] = [
  {
    id: 'dsh', label: 'DSH 默认', detail: '一道亮光从左到右扫过（默认）',
    colors: ['#345dba'],
    darkColors: ['#8fb4f2']
  },
  {
    id: 'classic', label: '经典流光', detail: '日夜自适应 · 彩虹渐变',
    colors: ['#d92b4b', '#c2410c', '#a16207', '#15803d', '#0e7490', '#6d28d9', '#be185d'],
    darkColors: ['#ff5f6d', '#ffc371', '#ffdd55', '#7dff7d', '#5fd4ff', '#a78bfa', '#ff8adb']
  },
  {
    id: 'neon', label: '霓虹', detail: '青紫粉渐变 · 柔和呼吸',
    colors: ['#0e7490', '#7c3aed', '#be185d'],
    darkColors: ['#22d3ee', '#a78bfa', '#f472b6']
  },
  {
    id: 'terminal', label: '终端', detail: '绿色流光 · 等宽字体',
    colors: ['#15803d', '#166534'],
    darkColors: ['#4ade80', '#86efac']
  },
  {
    id: 'candy', label: '糖果', detail: '暖色渐变 · 柔和呼吸',
    colors: ['#be123c', '#b45309', '#be185d'],
    darkColors: ['#fb7185', '#fbbf24', '#f472b6']
  },
  {
    id: 'glitch', label: '故障', detail: '红青流光 · 轻量错色',
    colors: ['#d92b4b', '#0e7490'],
    darkColors: ['#ff5f6d', '#5fd4ff']
  },
  {
    id: 'original', label: '简约', detail: '客户端默认配色 · 安静清晰',
    colors: ['#345dba', '#233d80', '#345dba'],
    darkColors: ['#7d99de', '#8abbee', '#7d99de']
  }
];

/**
 * 对话状态条（二级页）：对齐小程序 settings 页的 status-style-sheet 内容。
 * 标题「对话状态条」+ 说明「只改变外观，保留原有文案和计时」，逐项：名称 / 已选择 / 预览 / 描述。
 */
@Component
export struct StatusStylesPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('statusAppearance') statusAppearance: string = 'original';
  /** 颜色循环用的时间基准（与运行中指示条同一套采样） */
  @State private elapsedMs: number = 0;
  /** 雪碧图当前帧（60 帧循环，对齐运行中指示条 50ms/帧） */
  @State private tailFrame: number = 0;
  private timer: number = -1;
  private frameTimer: number = -1;

  aboutToAppear(): void {
    // ① 颜色循环：160ms 采样一次色板（与对话页运行条一致）
    this.timer = setInterval(() => {
      this.elapsedMs = Date.now();
    }, 160);
    // ② 鲸尾抖动：60 帧雪碧图逐格平移，50ms/帧（与对话页运行条一致）
    this.frameTimer = setInterval(() => {
      this.tailFrame = (this.tailFrame + 1) % 60;
    }, 50);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
    if (this.frameTimer >= 0) {
      clearInterval(this.frameTimer);
      this.frameTimer = -1;
    }
  }

  /**
   * 鲸尾颜色 = 预览文字的第一个字颜色。
   *
   * 鲸尾和右侧文字是「同一条流光」：小程序里鲸尾是 .status-tail-ink 的 background-color，
   * 文字是 background-clip:text 的横向渐变，两者共用同一套 @keyframes 与同一时刻，
   * 所以图标显示的就是整条渐变最左端的那个颜色，不存在独立的第二套颜色。
   */
  private colorOf(option: StatusStyleOption): string {
    const glyphs: string[] = this.previewGlyphs(option);
    return glyphs.length > 0 ? glyphs[0] : StatusAppearance.sample(option.id, this.isDark, this.elapsedMs);
  }

  /** 预览文字逐字取色：与运行条同一曲线（左端=鲸尾色，横向展开半个色板）。 */
  private previewGlyphs(option: StatusStyleOption): string[] {
    const speedMs: number = StatusAppearance.durationMs(option.id);
    const total: number = speedMs > 0 ? speedMs : 4000;
    let base: number = ((this.elapsedMs % total) + total) % total / total;
    // terminal / glitch 的文字渐变与鲸尾一样是反向播放（小程序 animation-direction: reverse），
    // 不在这里反转会让第一个字和鲸尾落在相位两端，看起来就是两个颜色。
    if (option.id === 'terminal' || option.id === 'glitch') {
      base = 1 - base;
    }
    const label: string = '正在思考，用时 12 秒…';
    const chars: string[] = label.split('');
    const count: number = chars.length;
    const out: string[] = [];
    for (let index = 0; index < count; index++) {
      out.push(StatusAppearance.glyphColor(option.id, this.isDark, base, index, count));
    }
    return out;
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF';
  }

  private cardBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private selectedBg(): string {
    return this.isDark ? 'rgba(107,135,215,0.16)' : 'rgba(83,112,198,0.06)';
  }

  private select(id: string): void {
    this.statusAppearance = id;
    PreferencesStore.get().putString('statusAppearance', id);
    // 立即同步给设置页（AppStorage 订阅 + 偏好版本号），并自动返回上一级
    AppStorage.setOrCreate<string>('statusAppearance', id);
    AppStorage.setOrCreate<string>('prefPickerChoice', 'status\u0001' + id);
    const revision: number = AppStorage.get<number>('prefPickerRevision') ?? 0;
    AppStorage.setOrCreate<number>('prefPickerRevision', revision + 1);
    this.pageStack.pop();
  }

  /** 一张样式卡：名称 + 已选择 + 流光预览 + 说明（对齐小程序 .status-style-option） */
  @Builder
  optionCard(option: StatusStyleOption) {
    Column({ space: 10 }) {
      Row() {
        Text(option.label)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.textColor())
        Blank()
        if (this.statusAppearance === option.id) {
          Text('已选择').fontSize(11).fontColor('#5676C8')
        }
      }
      .width('100%')

      // 预览：鲸尾图标 + 流光文字（文字颜色持续变化）
      // 图标与文字间隙收窄 7→5vp（垂直位置保持原位）
      Row({ space: 5 }) {
        // 内联雪碧图 + fillColor，与对话页运行条同一套画法。
        // 颜色 = colorOf(option) = 预览文字第一个字的颜色（同一条流光的左端）。
        Stack() {
          Image($r('app.media.whale_tail_sprite'))
            .width(1080)
            .height(18)
            .objectFit(ImageFit.Fill)
            .fillColor(this.colorOf(option))
            .translate({ x: -this.tailFrame * 18 })
        }
        .width(18)
        .height(18)
        .clip(true)
        .alignContent(Alignment.TopStart)

        Row() {
          ForEach(this.previewGlyphs(option), (color: string, index: number) => {
            Text('正在思考，用时 12 秒…'.charAt(index))
              .fontSize(14)
              .fontColor(color)
              .fontFamily(option.id === 'terminal' ? 'monospace' : 'HarmonyOS Sans')
          // key 必须带颜色：否则 ForEach 复用子节点、不重跑 itemBuilder，文字冻在首帧，
          // 只剩鲸尾单独变色（与对话页运行条同一个坑）。
          }, (color: string, index: number) => index.toString() + color)
        }
        .layoutWeight(1)
        .clip(true)
        .alignItems(VerticalAlign.Center)
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      Text(option.detail)
        .fontSize(12)
        .fontColor(this.subColor())
        .width('100%')
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(14)
    .borderRadius(12)
    .backgroundColor(this.statusAppearance === option.id ? this.selectedBg() : this.cardBg())
    .border({
      width: 1,
      color: this.statusAppearance === option.id ? '#6B87D7' : this.cardBorder()
    })
    .onClick(() => {
      this.select(option.id);
    })
  }

  build() {
    NavDestination() {
      Column() {
        // 导航：与「设置」「会话设置」「Tailscale 内嵌隧道」一致
        Row() {
          Row() {
            Text('‹')
              .fontSize(24)
              .fontColor(this.textColor())
          }
          .width(44)
          .height(44)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            this.pageStack.pop();
          })

          Text('对话状态条')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)

          Row().width(44).height(44)
        }
        .width('100%')
        .height(56)
        .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })

        Scroll() {
          Column({ space: 10 }) {
            Text('只改变外观，保留原有文案和计时')
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 2, bottom: 2 })

            ForEach(STATUS_OPTIONS, (option: StatusStyleOption) => {
              this.optionCard(option)
            }, (option: StatusStyleOption) => option.id)

            Text('只改变文字流光 · 自动保存')
              .fontSize(12)
              .fontColor(this.subColor())
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding({ top: 10 })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4, bottom: 30 })
        }
        .layoutWeight(1)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
