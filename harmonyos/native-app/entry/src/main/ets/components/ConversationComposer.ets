/**
 * ConversationComposer —— 会话输入条（严格对齐微信小程序 session 页 composer）
 *
 * 小程序的两态（关键）：
 *   折叠态（未聚焦 && 无草稿 && 无附件）：单栏胶囊，padding 6/10、圆角 21；
 *     左侧 + 圆钮、中间占位文案、右侧内联发送/停止；底部 chip 行整行隐藏。
 *   展开态（聚焦 || 有草稿 || 有附件）：padding 14、圆角 24；文本域在上，
 *     底部 chip 行（+ / 权限 / 模型 / 发送）出现。
 *
 * 视觉来源：miniprogram/pages/session/session.wxss 5569-5602（两态）、893-1050、2694-2800。
 * 约束：ArkTS 严格模式；颜色全部字符串字面量。
 */
import type { ModelMenuItem } from 'nativecore';

@Component
export struct ConversationComposer {
  @Prop isDark: boolean = false;
  @Prop draft: string = '';
  @Prop placeholder: string = '描述你想要构建的内容';
  @Prop connected: boolean = false;
  @Prop running: boolean = false;
  @Prop sending: boolean = false;
  @Prop focused: boolean = false;
  @Prop permissionTitle: string = '';
  @Prop permissionIcon: string = '⛨';
  @Prop modelTitle: string = '';
  @Prop modelBadge: string = '';
  @Prop effortLabel: string = '';
  @Prop attachmentCount: number = 0;
  /** 第一层菜单（模型 / 推理等级）展开态 */
  @State modelRootShown: boolean = false;
  /** 第二层菜单展开态 */
  @State modelListShown: boolean = false;
  /** 第二层内容：model | effort */
  @State modelListPane: string = 'model';
  /** 模型列表菜单展开态 */
  @State modelsShown: boolean = false;
  /** 推理等级 / 提供商列表菜单展开态 */
  @State auxShown: boolean = false;
  /** aux 菜单内容：effort | providers */
  @State auxKind: string = 'effort';
  /** 模型列表当前展示的提供商 */
  @State activeProvider: string = '';

  /** chip 展开态（控制 ▾ 旋转与底色） */
  @Prop permissionOpen: boolean = false;
  /** chip 行可用宽度：放不下权限名时只留图标 + 箭头（对齐小程序 permissionChipIconOnly） */
  @State chipsBarWidth: number = 0;
  @Prop modelOpen: boolean = false;
  /** 推理等级文案（低/中/高） */
  @Prop effort: string = '';
  /** 权限菜单项（与小程序 permissionSheet 同源）：labels 与 values 等长 */
  @Prop permissionLabels: string[] = [];
  @Prop permissionValues: string[] = [];
  @Prop permissionCurrent: string = '';
  /** 模型菜单项（小程序 modelGroups 扁平化）：labels/providers/models 三者等长 */
  @Prop modelMenuLabels: string[] = [];
  /** 模型菜单条目（已按提供商分组、含表头行），由页面构建 */
  @Prop modelMenuItems: ModelMenuItem[] = [];
  /** 提供商列表（第二层） */
  @Prop modelProviders: ModelMenuItem[] = [];
  /** 当前模型所属提供商（第二层默认打开它） */
  @Prop currentProvider: string = '';
  @Prop modelMenuCurrent: string = '';
  /** 推理等级菜单（小程序 effortSheet：Off/Low/Medium/High） */
  @Prop effortValues: string[] = [];
  @Prop effortLabels: string[] = [];
  @Prop effortCurrent: string = '';

  onDraft: (value: string) => void = () => {};
  onSend: () => void = () => {};
  onStop: () => void = () => {};
  onAddAttachment: () => void = () => {};
  onPickPermission: () => void = () => {};
  onPickModel: () => void = () => {};
  /** 选中权限值（对齐小程序 pickPermissionOption） */
  onPickPermissionOption: (value: string) => void = () => {};
  /** 权限菜单展开/收起（用于 ▾ 旋转） */
  onPermissionMenuVisible: (visible: boolean) => void = () => {};
  /** 选中模型（对齐小程序 pickModelOption） */
  onPickModelOption: (provider: string, model: string) => void = () => {};
  /** 选中推理等级（对齐小程序 pickEffortOption） */
  onPickEffortOption: (value: string) => void = () => {};
  /** 模型菜单展开/收起（用于 ▾ 旋转） */
  onModelMenuVisible: (visible: boolean) => void = () => {};
  onFocusChange: (focused: boolean) => void = () => {};
  onStats: () => void = () => {};
  onTokenStats: () => void = () => {};
  onContext: () => void = () => {};

  // ===== 底部三个指标按钮的文案（小程序 composer-metrics） =====
  @Prop runMetric: string = '— 轮 — 步';
  @Prop tokenMetric: string = '— tok';
  @Prop contextMetric: string = '—%';
  @Prop contextPercent: number = 0;

  // ==================== 状态 ====================
  /** 展开态：聚焦、有草稿或有附件（对齐小程序 composer-expanded 判定） */
  private expanded(): boolean {
    return this.focused || this.draft.length > 0 || this.attachmentCount > 0;
  }

  private hasDraft(): boolean {
    return this.draft.trim().length > 0;
  }

  /** 折叠态右侧按钮：运行中且无草稿 → 停止；否则可发送 → 发送 */
  private showStopState(): boolean {
    return this.running && !this.hasDraft();
  }

  private canSendNow(): boolean {
    return this.hasDraft() || this.attachmentCount > 0;
  }

  // ==================== 色板 ====================
  /** 卡片底色：对齐系统菜单（权限弹窗）的材质色 —— 半透明 + 模糊 */
  private cardBackground(): string {
    // 与系统菜单（模型/权限弹窗）实测色彩对齐：模糊材质会把基色压暗到约 0.6 倍
    return this.isDark ? 'rgba(61,61,61,0.90)' : 'rgba(244,244,245,0.92)';
  }

  /** 描边：对齐系统菜单（右上角「⋯」弹窗）的细亮边 */
  private cardEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  /** 阴影：菜单浮层的柔和投影 */
  private cardShadowColor(): string {
    return this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)';
  }

  private inputText(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private placeholderColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.36)' : 'rgba(16,19,24,0.28)';
  }

  /** 折叠态占位文案色（小程序 .composer-collapsed-placeholder） */
  private collapsedPlaceholderColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.40)' : 'rgba(16,19,24,0.32)';
  }

  private chipText(): string {
    return this.isDark ? 'rgba(241,244,250,0.72)' : 'rgba(16,19,24,0.62)';
  }

  /** 折叠态 + 圆钮描边（小程序 .composer-plus-inline border 2rpx） */
  private plusBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.14)';
  }

  /** chip 展开时的底色（小程序 --fill-2） */
  private chipActiveFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)';
  }


  private ringTrack(): string {
    return this.isDark ? 'rgba(241,244,250,0.18)' : 'rgba(16,19,24,0.12)';
  }

  // ==================== 派生文案 ====================

  /** 单色图标着色（颜色矩阵）：只换 RGB，保留透明度 */
  private iconTint(color: string): number[] {
    const text: string = color.trim();
    let alpha: number = 1;
    let red: number = 255;
    let green: number = 255;
    let blue: number = 255;
    if (text.startsWith('#')) {
      const hex: string = text.substring(1);
      const value: number = parseInt(hex, 16);
      if (hex.length === 8) {
        alpha = ((value >>> 24) & 255) / 255;
        red = (value >> 16) & 255;
        green = (value >> 8) & 255;
        blue = value & 255;
      } else {
        red = (value >> 16) & 255;
        green = (value >> 8) & 255;
        blue = value & 255;
      }
    }
    return [
      0, 0, 0, 0, red / 255,
      0, 0, 0, 0, green / 255,
      0, 0, 0, 0, blue / 255,
      0, 0, 0, alpha, 0
    ];
  }

  /** 权限行图标：直接使用小程序 assets/icons 里的盾牌图形（utils/labels.js 同款映射） */
  private permissionIconRes(value: string): Resource {
    if (value === 'auto') {
      return $r('app.media.perm_auto');
    }
    if (value.indexOf('danger') >= 0) {
      return $r('app.media.perm_danger');
    }
    if (value.indexOf('workspace') >= 0 || value.indexOf('write') >= 0) {
      return $r('app.media.perm_workspace');
    }
    if (value.indexOf('read') >= 0) {
      return $r('app.media.perm_readonly');
    }
    return $r('app.media.perm_default');
  }

  /** 菜单文字色：与系统菜单（模型弹窗）一致 —— HarmonyOS font_primary */
  private menuLabelColor(): string {
    return this.isDark ? '#E5E5E5' : '#182431';
  }

  /** 权限行图标实色：跟随菜单文字色 */
  private permissionIconColor(): string {
    return this.menuLabelColor();
  }

  /** 权限行图标透明度：略低于文字，避免细描边比文字更亮 */
  private permissionIconOpacity(): number {
    return 0.86;
  }

  /** chip 上单色图标的实色（与 chipText 同色，透明度分开给） */
  private chipIconColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  /** chip 图标透明度（对应 chipText 的 alpha） */
  private chipIconOpacity(): number {
    return this.isDark ? 0.72 : 0.62;
  }

  /** 搜索框式亮边：深色下是微亮的「光感边框」，浅色下几乎不可见 */
  private searchEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)';
  }

  /** 权限名放不下时只显示图标 + 箭头（小程序 permissionChipIconOnly） */
  private permissionIconOnly(): boolean {
    if (this.chipsBarWidth <= 0) {
      return false;
    }
    let labelWidth: number = 0;
    try {
      // measureText 返回 px，转 vp 后才能和 onAreaChange 的宽度比较
      labelWidth = px2vp(this.getUIContext().getMeasureUtils().measureText({
        textContent: this.permissionLabel(),
        fontSize: 12
      }));
    } catch (e) {
      return false;
    }
    // 小程序 .permission-chip max-width 38%；扣掉图标 14 + 间距 3 + 箭头 5 + 箭头边距 5 + chip 内边距 10
    const chrome: number = 37;
    const available: number = this.chipsBarWidth * 0.38 - chrome;
    return labelWidth > available;
  }

  /** 小程序 --text-4：chip 右侧箭头等最弱的文字/描边色 */
  private text4(): string {
    return this.isDark ? 'rgba(241,244,250,0.45)' : 'rgba(16,19,24,0.45)';
  }

  /** 菜单次要文字/图标色（小程序 --text-3） */
  private mutedText(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.50)';
  }

  /** 选中勾选色 */
  private accentColor(): string {
    return this.isDark ? '#8AB4FF' : '#0A59F7';
  }

  private permissionLabel(): string {
    return this.permissionTitle.length > 0 ? this.permissionTitle : '默认权限';
  }

  private permissionGlyph(): string {
    const title: string = this.permissionTitle;
    if (title.indexOf('只读') >= 0) {
      return '◐';
    }
    if (title.indexOf('写入') >= 0) {
      return '✎';
    }
    if (title.indexOf('完全访问') >= 0) {
      return '⚠';
    }
    return this.permissionIcon.length > 0 ? this.permissionIcon : '⛨';
  }

  private modelLabel(): string {
    return this.modelTitle.length > 0 ? this.modelTitle : '默认模型';
  }


  // ==================== 展开态 ====================
  @Builder
  attachmentRow() {
    Row() {
      Text('已选择 ' + this.attachmentCount.toString() + ' 个附件')
        .fontSize(12)
        .fontColor(this.chipText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .padding({ left: 2, right: 2, bottom: 4 })
  }

  @Builder
  draftField() {
    TextArea({ text: this.draft, placeholder: this.placeholder })
      .width('100%')
      .fontSize(14)
      .fontColor(this.inputText())
      .placeholderColor(this.placeholderColor())
      .placeholderFont({ size: 14 })
      .caretStyle({ width: 1.5, color: '#2E6BE6' })
      .backgroundColor('#00000000')
      .borderWidth(0)
      .padding({ left: 2, right: 2, top: 0, bottom: 0 })
      .constraintSize({ minHeight: 28, maxHeight: 154 })
      // 不在这里用 defaultFocus：条件挂载 + defaultFocus 在本机会崩；改为点击文本域即获焦，
      // onBlur 时若草稿与附件均为空才塌回单栏。
      .onFocus(() => {
        this.onFocusChange(true);
      })
      .onBlur(() => {
        this.onFocusChange(false);
      })
      .onChange((value: string) => {
        this.onDraft(value);
      })
  }

  @Builder
  plusButton() {
    // 小程序 .chip.icon：64rpx = 32vp 圆形，无描边（描边只出现在折叠态 composer-plus-inline）
    Stack() {
      Text('+').fontSize(16).fontColor(this.chipText())
    }
    .width(32)
    .height(32)
    .borderRadius(16)
    .border({ width: 0.9, color: this.plusBorder() })
    .opacity(this.connected ? 1 : 0.4)
    .enabled(this.connected)
    .onClick(() => {
      if (this.connected) {
        this.onAddAttachment();
      }
    })
  }

  /** 权限 chip（小程序 .chip.permission-chip：文本 12vp、padding 5/4、图标 16vp、末尾 ▾） */
  @Builder
  permissionChip() {
    Row({ space: 3 }) {
      // chip 上的图标与模型/权限文字同色（对齐小程序 .chip 的 currentColor）
      Image(this.permissionIconRes(this.permissionCurrent))
        .width(14)
        .height(14)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTint(this.chipIconColor()))
        .opacity(this.chipIconOpacity())
      if (!this.permissionIconOnly()) {
        Text(this.permissionLabel())
          .fontSize(12)
          .fontColor(this.chipText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      // 小程序 .permission-chip-chevron：5×5 的 border 箭头（1px 右下边框转 45°），展开转 225°
      Row()
        .width(5)
        .height(5)
        .border({ width: { right: 1, bottom: 1 }, color: this.text4() })
        .rotate({ angle: this.permissionOpen ? 225 : 45 })
        .translate({ y: this.permissionOpen ? 1 : -1 })
        .margin({ left: 3, right: 3 })
    }
    .height(30)
    .padding({ left: 5, right: 5 })
    .borderRadius(15)
    .backgroundColor(this.permissionOpen ? this.chipActiveFill() : Color.Transparent)
    .alignItems(VerticalAlign.Center)
    // 权限菜单：与顶栏「⋯」同款系统菜单（bindMenu 自带点击弹出，不要再挂 onClick，否则会重复触发）
    .bindMenu(this.permissionMenu(), {
      onDisappear: () => {
        this.onPermissionMenuVisible(false);
      },
      onAppear: () => {
        this.onPermissionMenuVisible(true);
      }
    })
  }

  /** 权限菜单行（对齐小程序 .opt-row.permission-pop：左图标 + 名称 + EXP + 右侧勾选） */
  @Builder
  permissionRow(value: string, label: string) {
    Row() {
      Image(this.permissionIconRes(value))
        .width(16)
        .height(16)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTint(this.permissionIconColor()))
        .opacity(this.permissionIconOpacity())
      Text(label)
        .fontSize(14)
        .fontColor(this.menuLabelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
        .margin({ left: 6 })
      if (value === 'auto') {
        Text('EXP')
          .fontSize(8)
          .fontColor(this.mutedText())
          .margin({ left: 4 })
      }
      // 右侧勾选：小程序 permission-check（8×4 的细勾）
      if (this.permissionCurrent === value) {
        Row()
          .width(8)
          .height(4)
          .border({
            width: { left: 1.5, bottom: 1.5 },
            color: this.menuLabelColor()
          })
          .rotate({ angle: -45 })
          .margin({ left: 8, right: 2 })
          .translate({ y: -1 })
      }
    }
    .width(168)
    .height(34)
    .padding({ left: 7, right: 7 })
    .borderRadius(6)
    .backgroundColor(this.permissionCurrent === value ? this.chipActiveFill() : Color.Transparent)
  }

  /** 权限菜单内容（系统 Menu 容器 + 自定义行，对齐小程序 permission-pop） */
  @Builder
  permissionMenu() {
    Menu() {
      ForEach(this.permissionValues, (value: string, index: number) => {
        MenuItem(this.permissionRow(value, this.permissionLabels[index]))
          .id('permission-' + value)
          .onClick(() => {
            this.onPickPermissionOption(value);
          })
      }, (value: string, index: number) => value)
    }
  }

  /** 模型 chip（小程序 .chip.model-chip：模型名 + 版本徽章 + 推理等级 + ▾） */
  @Builder
  modelChip() {
    Row({ space: 3 }) {
      Text(this.modelLabel())
        .fontSize(12)
        .fontColor(this.chipText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: 140 })
      if (this.modelBadge.length > 0) {
        Text(this.modelBadge)
          .fontSize(8)
          .fontColor(this.chipText())
          .opacity(0.60)
          .padding({ left: 3, right: 3, top: 1, bottom: 1 })
          .borderRadius(4)
          .backgroundColor(this.chipActiveFill())
      }
      if (this.effort.length > 0) {
        Text(this.effort).fontSize(10).fontColor(this.chipText()).opacity(0.75)
      }
      // 小程序 .model-trigger-chevron：与权限 chip 同款 border 箭头
      Row()
        .width(5)
        .height(5)
        .border({ width: { right: 1, bottom: 1 }, color: this.text4() })
        .rotate({ angle: this.modelOpen ? 225 : 45 })
        .translate({ y: this.modelOpen ? 1 : -1 })
        .margin({ left: 3, right: 3 })
    }
    .height(30)
    .padding({ left: 5, right: 5 })
    .borderRadius(15)
    .backgroundColor(this.modelOpen ? this.chipActiveFill() : Color.Transparent)
    .alignItems(VerticalAlign.Center)
    // 与权限按钮同一控件：原生系统菜单（bindMenu）。两层各一枚菜单 + 各自隐形锚点，
    // 保持系统菜单的字号/圆角/模糊/动效；不会因「点一项必收起」导致第二层闪没。
    .onClick(() => {
      this.modelRootShown = true;
    })
    .bindMenu(this.modelRootShown, this.modelRootMenu(), {
      onAppear: () => {
        this.onModelMenuVisible(true);
      },
      onDisappear: () => {
        this.modelRootShown = false;
        this.onModelMenuVisible(false);
      }
    })
  }

  /** 第二层菜单的隐形锚点（模型列表 / 推理等级） */
  @Builder
  modelListAnchor() {
    Stack() {}
      .width(1)
      .height(1)
      .opacity(0.01)
      .bindMenu(this.modelListShown, this.modelListMenu(), {
        onDisappear: () => {
          this.modelListShown = false;
        }
      })
  }

  /** 打开第二层：等第一层收起动画结束再弹（两枚不同菜单，不会互相打断） */
  private openModelList(pane: string): void {
    this.modelRootShown = false;
    this.modelListPane = pane;
    setTimeout(() => {
      this.modelListShown = true;
    }, 180);
  }

  /** 第一层：模型 / 推理等级（右侧当前值 + 箭头） */
  @Builder
  modelRootMenu() {
    Menu() {
      MenuItem({ content: '模型', labelInfo: this.modelLabel() + '  ›' })
        .id('model-entry')
        .contentFont({ size: 14, weight: FontWeight.Normal })
        .labelFont({ size: 13, weight: FontWeight.Normal })
        .onClick(() => {
          this.openModelList('model');
        })
      MenuItem({ content: '推理等级', labelInfo: (this.effort.length > 0 ? this.effort : 'High') + '  ›' })
        .id('effort-entry')
        .contentFont({ size: 14, weight: FontWeight.Normal })
        .labelFont({ size: 13, weight: FontWeight.Normal })
        .onClick(() => {
          this.openModelList('effort');
        })
    }
  }

  /** 第二层：全部模型按提供商分组（内容与之前一致）/ 推理等级，✓ 放最右 */
  @Builder
  modelListMenu() {
    Menu() {
      if (this.modelListPane === 'effort') {
        MenuItem({ content: '‹ 推理等级' })
          .id('effort-back')
          .onClick(() => {
            this.openModelList('root');
          })
        ForEach(this.effortValues, (value: string, index: number) => {
          MenuItem({ content: this.effortLabels[index], labelInfo: this.effortCurrent === value ? '✓' : '' })
            .id('effort-' + value)
            .onClick(() => {
              this.modelListShown = false;
              this.onPickEffortOption(value);
            })
        }, (value: string, index: number) => 'effort-' + value)
      } else {
        ForEach(this.modelMenuItems, (row: ModelMenuItem) => {
          if (row.isHeader) {
            MenuItem({ content: row.label }).id('group-' + row.label).enabled(false)
          } else {
            MenuItem({ content: row.label, labelInfo: row.current ? '✓' : '' })
              .id('model-' + row.key)
              .onClick(() => {
                this.modelListShown = false;
                this.onPickModelOption(row.provider, row.model);
              })
          }
        }, (row: ModelMenuItem) => row.key)
      }
    }
  }


  /** 指标行文字色（小程序 .stat / .meta 的次要色） */
  private metricText(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.56)';
  }

  /** 主按钮：可发送 → ↑；运行中 → 停止方块 */
  @Builder
  primaryButton() {
    Stack() {
      if (this.showStopState()) {
        Rect({ width: 14, height: 14, radius: 3 }).fill('#FFFFFF')
      } else {
        Text('↑').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
      }
    }
    .width(36)
    .height(36)
    .borderRadius(18)
    .backgroundColor('#2E6BE6')
    .opacity(this.sending ? 0.66 : (this.showStopState() || this.canSendNow() ? 1 : 0.48))
    .enabled(!this.sending && (this.showStopState() || this.canSendNow()))
    .onClick(() => {
      if (this.sending) {
        return;
      }
      if (this.showStopState()) {
        this.onStop();
        return;
      }
      if (this.canSendNow()) {
        this.onSend();
      }
    })
  }

  @Builder
  runMetricItem() {
    Row({ space: 3 }) {
      Text('◷').fontSize(11).fontColor(this.metricText())
      Text(this.runMetric)
        .fontSize(11)
        .fontColor(this.metricText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .opacity(0.78)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.onStats();
    })
  }

  /** ② token 指标：▤ + N tok · N% → Token 用量弹层 */
  @Builder
  tokenMetricItem() {
    Row({ space: 3 }) {
      Text('▤').fontSize(11).fontColor(this.metricText())
      Text(this.tokenMetric)
        .fontSize(11)
        .fontColor(this.metricText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .opacity(0.78)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.onTokenStats();
    })
  }

  /** ③ 上下文指标：13×13 环形 + N% → 上下文弹层 */
  @Builder
  contextMetricItem() {
    Row({ space: 3 }) {
      Progress({ value: this.contextPercent < 0 ? 0 : this.contextPercent, total: 100, type: ProgressType.Ring })
        .width(13)
        .height(13)
        .color('#2E6BE6')
        .backgroundColor(this.ringTrack())
      Text(this.contextMetric)
        .fontSize(11)
        .fontColor(this.metricText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .opacity(0.78)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.onContext();
    })
  }

  // ==================== 骨架（与小程序的同构做法：DOM 不变，只切样式与可见性） ====================
  //
  // 关键：TextArea 必须**常驻同一个节点**。小程序也是同一个 <textarea>，只靠 CSS 改变高度、
  // 并用 wx:if 控制 chip 行；如果这里按条件挂载两套子树，TextArea 会被重建 → 丢焦点 → 立刻 onBlur
  // 又塌回折叠态（点击后展不开）。所以下面只做三件事：
  //   ① 卡片 padding/圆角随 expanded 变化；② chip 行与折叠占位分别显示；③ 右侧按钮按需显示。
  build() {
    Column() {
      Column() {
        if (this.attachmentCount > 0) {
          this.attachmentRow()
        }

        // 文本域常驻同一节点（保焦点）；折叠态用 visibility 收起，展开态显示
        Column() {
          this.draftField()
        }
        .width('100%')
        .visibility(this.expanded() ? Visibility.Visible : Visibility.None)


        // 折叠态的一整条：+ / 占位文案 / （可选）停止键
        if (!this.expanded()) {
          Row({ space: 6 }) {
            Stack() {
              Text('+').fontSize(15).fontColor(this.chipText())
            }
            .width(27)
            .height(27)
            .borderRadius(14)
            .border({ width: 0.9, color: this.plusBorder() })
            .opacity(this.connected ? 1 : 0.4)
            .enabled(this.connected)
            .onClick(() => {
              if (this.connected) {
                this.onAddAttachment();
              }
            })
            Text(this.placeholder)
              .fontSize(14)
              .fontColor(this.collapsedPlaceholderColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
              .onClick(() => {
                this.onFocusChange(true);
              })
            if (this.showStopState()) {
              Stack() {
                Rect({ width: 13, height: 13, radius: 3 }).fill('#FFFFFF')
              }
              .width(33)
              .height(33)
              .borderRadius(17)
              .backgroundColor('#2E6BE6')
              .onClick(() => {
                this.onStop();
              })
            }
          }
          .width('100%')
          .height(33)
          .alignItems(VerticalAlign.Center)
        }

        // 展开态才出现的底部 chip 行
        if (this.expanded()) {
          Row({ space: 0 }) {
            this.plusButton()
            this.permissionChip()
            Blank()
            this.modelChip()
            // 第二层菜单的隐形锚点（贴在 model chip 右侧）
            this.modelListAnchor()
            this.primaryButton()
          }
          .width('100%')
          .height(34)
          .alignItems(VerticalAlign.Center)
          .margin({ top: 8 })
          .onAreaChange((oldValue: Area, newValue: Area) => {
            this.chipsBarWidth = Number(newValue.width);
          })
        }
      }
      .width('100%')
      .padding(this.expanded()
        ? { left: 14, right: 14, top: 14, bottom: 12 }
        : { left: 10, right: 10, top: 6, bottom: 6 })
      // 圆角对齐系统菜单弹窗
      .borderRadius(16)
      // 参考系统「搜索框」的玻璃样式：系统灰底 + 厚模糊 + 亮边（光感边框）
      .backgroundColor($r('sys.color.comp_background_gray'))
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .border({ width: this.isDark ? 0.8 : 0.5, color: this.searchEdge() })
      .shadow({ radius: 20, color: this.cardShadowColor(), offsetY: 6 })

      // 卡片下方三个指标按钮：折叠/展开都常驻（对齐小程序 composer-metrics）
      Row({ space: 10 }) {
        this.runMetricItem()
        this.tokenMetricItem()
        this.contextMetricItem()
      }
      .width('100%')
      .justifyContent(FlexAlign.Center)
      .alignItems(VerticalAlign.Center)
      .padding({ top: 8 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }
}
