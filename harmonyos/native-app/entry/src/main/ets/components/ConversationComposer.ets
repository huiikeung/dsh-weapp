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
import { LengthMetrics } from '@kit.ArkUI';
import type { ModelMenuItem } from 'nativecore';
import { VoiceRipplePanel } from './VoiceRipplePanel';

/** 指标菜单行（鸿蒙原生 Menu 的 MenuItem：content 在左，labelInfo 数值在右） */
export interface MetricMenuPair {
  label: string;
  value: string;
}

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
  /** 模型列表悬停高亮行（hover 与权限菜单一致） */
  @State hoveredModelKey: string = '';
  /** 应用内菜单卡片可见性（样式对齐原系统菜单；不抢焦点，键盘收起仍保持） */
  @State permSheetVisible: boolean = false;
  @State modelSheetVisible: boolean = false;
  /** 模型列表菜单展开态 */
  @State modelsShown: boolean = false;
  /** 推理等级 / 提供商列表菜单展开态 */
  @State auxShown: boolean = false;
  /** aux 菜单内容：effort | providers */
  @State auxKind: string = 'effort';
  /** 模型列表当前展示的提供商 */
  @State activeProvider: string = '';

  /** chip 展开态（控制 ▾ 旋转） */
  @Prop permissionOpen: boolean = false;
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
  /** 指标菜单行数据：点开菜单时由页面现算（会话统计 / Token 用量 / 上下文已用） */
  metricPairsFor: (kind: string) => MetricMenuPair[] = () => [];

  // ===== 长按语音输入（对齐小程序 voice-actions.js） =====
  /** 语音输入开关（设置页「语音输入」） */
  @Prop voiceEnabled: boolean = false;
  /** 语音模式：true=当前在语音输入（右下角显示键盘图标），false=文字输入（显示麦克风） */
  @Prop voiceMode: boolean = false;
  /** 正在录音：折叠条换成波纹 + 提示 */
  @Prop voiceRecording: boolean = false;
  /** 上滑已进入「松手取消」 */
  @Prop voiceCancelArmed: boolean = false;
  /** 实时音量 0..1，驱动波纹高度 */
  @Prop voiceLevel: number = 0.5;
  /** 录音提示文案 */
  @Prop voiceHint: string = '';
  /** 右下角按钮：在语音/键盘之间切换 */
  onToggleVoiceMode: () => void = () => {};
  /** 长按满 350ms：开始录音 */
  onVoiceHoldStart: () => void = () => {};
  /** 录音中滑动：cancel=true 表示已滑到取消区 */
  onVoiceHoldMove: (cancel: boolean) => void = () => {};
  /** 松手：cancel=true 表示取消，不转文字 */
  onVoiceHoldEnd: (cancel: boolean) => void = () => {};

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

  // ===== 折叠条长按语音手势 =====
  // 对齐小程序：按住 350ms 起录；按下后滑开超过 12 视为滚动不录音；录音中上滑 64 进入取消区
  private voiceHoldTimer: number = -1;
  private voiceStartX: number = 0;
  private voiceStartY: number = 0;
  private voiceHolding: boolean = false;
  private voiceArmedLocal: boolean = false;

  private clearVoiceTimer(): void {
    if (this.voiceHoldTimer >= 0) {
      clearTimeout(this.voiceHoldTimer);
      this.voiceHoldTimer = -1;
    }
  }

  private onVoiceTouch(event: TouchEvent): void {
    if (!this.voiceEnabled) {
      return;
    }
    let touch: TouchObject | undefined = undefined;
    if (event.touches.length > 0) {
      touch = event.touches[0];
    } else if (event.changedTouches.length > 0) {
      touch = event.changedTouches[0];
    }
    if (touch === undefined) {
      return;
    }
    if (event.type === TouchType.Down) {
      this.voiceStartX = touch.x;
      this.voiceStartY = touch.y;
      this.voiceHolding = false;
      this.voiceArmedLocal = false;
      this.clearVoiceTimer();
      this.voiceHoldTimer = setTimeout(() => {
        this.voiceHoldTimer = -1;
        this.voiceHolding = true;
        this.onVoiceHoldStart();
      }, 350);
      return;
    }
    if (event.type === TouchType.Move) {
      const dy: number = touch.y - this.voiceStartY;
      const dx: number = touch.x - this.voiceStartX;
      if (!this.voiceHolding) {
        if (Math.abs(dy) > 12 || Math.abs(dx) > 12) {
          this.clearVoiceTimer();
        }
        return;
      }
      const cancel: boolean = dy < -64;
      if (cancel !== this.voiceArmedLocal) {
        this.voiceArmedLocal = cancel;
        this.onVoiceHoldMove(cancel);
      }
      return;
    }
    if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
      this.clearVoiceTimer();
      if (this.voiceHolding) {
        this.voiceHolding = false;
        const cancel: boolean = this.voiceArmedLocal || (event.type === TouchType.Cancel) || (touch.y - this.voiceStartY < -64);
        this.onVoiceHoldEnd(cancel);
        return;
      }
      this.onFocusChange(true);
    }
  }

  // ==================== 色板 ====================
  /** 卡片底色：对齐系统菜单（权限弹窗）的材质色 —— 半透明 + 模糊 */
  private cardBackground(): string {
    // 与系统菜单（模型/权限弹窗）实测色彩对齐：模糊材质会把基色压暗到约 0.6 倍
    return this.isDark ? 'rgba(61,61,61,0.90)' : 'rgba(244,244,245,0.92)';
  }

  /** 描边：对齐系统菜单（右上角「⋯」弹窗）的细亮边 */
  private cardEdge(): string {
    // 与返回按钮玻璃盘的内缘细边同值
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
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

  /** 折叠态占位文案色（参考截图的中灰占位） */
  private collapsedPlaceholderColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.40)' : 'rgba(16,19,24,0.42)';
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

  /**
   * 卡片底色：浅色=接近纯白的半透明（比光边暗一档，0.50→0.80 让内部更亮但不抢过白环）；
   * 深色=贴近对话页纯黑背景的深色半透明（不发灰发亮）
   */
  /** 输入框上方浮层（权限 / 模型菜单卡片）底色：与页面卡片同色 */
  private surfaceColor(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private sheetCardFill(): string {
    // 与返回按钮的玻璃盘同一底色（深色贴黑、浅色接近纯白）
    return this.isDark ? 'rgba(8,8,10,0.60)' : 'rgba(255,255,255,0.80)';
  }

  /**
   * 最外圈光圈颜色：深色与系统菜单（权限弹窗）的光边完全一致。
   * 系统菜单的描边在 HomePage 里显式设为 separatorColor()（深色 rgba(255,255,255,0.16)、浅色 rgba(0,0,0,0.10)），
   * 这里取同一值，保证输入框光边和权限弹窗边缘是同一个亮度。
   */
  private ringColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.96)';
  }

  /** 光圈外的投影：与返回按钮同为中性色（深色黑色、浅色淡灰），不再用白色光晕 */
  private haloShadow(): string {
    // 与返回按钮同一档悬浮感（按钮调轻后同步）
    return this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)';
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
      .id('composer-draft-area')
      .width('100%')
      .fontSize(14)
      .fontColor(this.inputText())
      .placeholderColor(this.placeholderColor())
      .placeholderFont({ size: 14 })
      .caretStyle({ width: 1.5, color: '#2E6BE6' })
      .backgroundColor('#00000000')
      .borderWidth(0)
      // 左缘 2vp：与下方 chip 行的「+」按钮基本对齐（卡片 14vp 内边距已隔开光圈）。
      // 顶部 6vp：首行不能贴着内容框上沿——贴边时字形左上角会被裁掉一块，
      // 而且行数超过 maxHeight 触发内部滚动后，首行上半截会被直接切掉。
      // 上下留白 4/2：minHeight 28 减去后仍剩 22vp，大于 14vp 字号的行高，
      // 既不让首行贴着上沿被裁掉左上角，也不会把内容区压到行高之下。
      .padding({ left: 2, right: 2, top: 4, bottom: 2 })
      .constraintSize({ minHeight: 28, maxHeight: 154 })
      // 不在这里用 defaultFocus：条件挂载 + defaultFocus 在本机会崩；改为点击文本域即获焦，
      // onBlur 时若草稿与附件均为空才塌回单栏。
      .onFocus(() => {
        this.onFocusChange(true);
      })
      .onBlur(() => {
        // 菜单弹出瞬间可能短暂抢焦点：延迟确认，chip 菜单在开时不收起输入态
        setTimeout(() => {
          if (!this.permissionOpen && !this.modelOpen && !this.modelRootShown && !this.modelListShown) {
            this.onFocusChange(false);
          }
        }, 140);
      })
      .onChange((value: string) => {
        this.onDraft(value);
      })
  }

  @Builder
  plusButton() {
    // 与折叠态 composer-plus-inline 同尺寸：27vp 圆形（展开/折叠两个 + 一致）
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
      // 权限 chip 默认只显示图标 + 箭头（不放权限名）
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
    .margin({ left: 8 })
    .padding({ left: 5, right: 5 })
    .borderRadius(15)
    .backgroundColor(this.permissionOpen ? this.chipActiveFill() : Color.Transparent)
    .alignItems(VerticalAlign.Center)
    // 权限菜单：与顶栏「⋯」同款系统菜单（bindMenu 自带点击弹出，不要再挂 onClick，否则会重复触发）
    .bindMenu(this.permissionMenu(), {
      showInSubWindow: false,
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
    // 与权限按钮同一控件：原生系统菜单（bindMenu）。两层各一枚菜单 + 各自隐形锚点
    .onClick(() => {
      this.modelRootShown = true;
    })
    .bindMenu(this.modelRootShown, this.modelRootMenu(), {
      showInSubWindow: false,
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
        showInSubWindow: false,
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

  /** 第二层：全部模型按提供商分组（自带滚动、隐藏滑块）/ 推理等级保持原生菜单样式，✓ 放最右 */
  @Builder
  modelListMenu() {
    if (this.modelListPane === 'effort') {
      Menu() {
        ForEach(this.effortValues, (value: string, index: number) => {
          MenuItem(this.effortRow(value, this.effortLabels[index]))
            .id('effort-' + value)
            .onClick(() => {
              this.modelListShown = false;
              this.onPickEffortOption(value);
            })
        }, (value: string, index: number) => 'effort-' + value)
      }
    } else {
      Column() {
        Scroll() {
          Column() {
            ForEach(this.modelMenuItems, (row: ModelMenuItem) => {
              if (row.isHeader) {
                Row() {
                  Text(row.label)
                    .fontSize(13)
                    .fontColor(this.mutedText())
                }
                .width('100%')
                .height(32)
                .padding({ left: 16, right: 16 })
              } else {
                Row() {
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.menuLabelColor())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                  if (row.current) {
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
                .width('100%')
                .height(40)
                .padding({ left: 16, right: 16 })
                .borderRadius(6)
                .backgroundColor(row.current || this.hoveredModelKey === row.key ? this.chipActiveFill() : Color.Transparent)
                .onHover((isHover: boolean) => {
                  this.hoveredModelKey = isHover ? row.key : '';
                })
                .onClick(() => {
                  this.modelListShown = false;
                  this.onPickModelOption(row.provider, row.model);
                })
              }
            }, (row: ModelMenuItem) => row.key)
          }
          .width('100%')
          // 底部留出空隙：末行 hover 高亮不贴卡片边框
          .padding({ bottom: 8 })
        }
        .constraintSize({ maxHeight: 320 })
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
      }
      .width(180)
    }
  }

  /** 推理等级菜单行：选中样式与权限菜单行一致（底色高亮 + 细勾） */
  @Builder
  effortRow(value: string, label: string) {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor(this.menuLabelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      if (this.effortCurrent === value) {
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
    .backgroundColor(this.effortCurrent === value ? this.chipActiveFill() : Color.Transparent)
  }

  /** 权限菜单卡片：输入框上方应用内浮层（观感对齐右上角三点系统菜单；不抢焦点，键盘收起仍保持） */
  @Builder
  permissionSheet() {
    Row() {
      Column() {
        ForEach(this.permissionValues, (value: string, index: number) => {
          Row() {
            Image(this.permissionIconRes(value))
              .width(18)
              .height(18)
              .objectFit(ImageFit.Contain)
              .colorFilter(this.iconTint(this.permissionIconColor()))
              .opacity(this.permissionIconOpacity())
            Text(this.permissionLabels[index])
              .fontSize(16)
              .fontColor(this.menuLabelColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
              .margin({ left: 10 })
            if (value === 'auto') {
              Text('EXP')
                .fontSize(9)
                .fontColor(this.mutedText())
                .margin({ left: 4 })
            }
            if (this.permissionCurrent === value) {
              Text('✓')
                .fontSize(15)
                .fontColor(this.menuLabelColor())
                .margin({ left: 10 })
            }
          }
          .width('100%')
          .height(44)
          .padding({ left: 16, right: 16 })
          .onClick(() => {
            this.permSheetVisible = false;
            this.onPickPermissionOption(value);
          })
          if (index < this.permissionValues.length - 1) {
            Row()
              .width('100%')
              .height(1)
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)')
              .margin({ left: 16, right: 16 })
          }
        }, (value: string) => value)
      }
      .width(204)
      .padding({ top: 4, bottom: 4 })
      .borderRadius(16)
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .backgroundColor(this.isDark ? 'rgba(26,28,32,0.92)' : 'rgba(252,252,254,0.92)')
      .shadow({ radius: 24, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.18)', offsetY: 8 })
      .alignItems(HorizontalAlign.Start)
      .clip(true)
      Blank()
    }
    .width('100%')
    .padding({ left: 14, right: 14, bottom: 6 })
  }

  /** 模型菜单卡片：两级（根：模型 / 推理等级 → 分组模型列表 / 推理等级列表），观感对齐右上角三点系统菜单 */
  @Builder
  modelSheet() {
    Row() {
      Blank()
      Column() {
        if (this.modelListPane === 'root') {
          Row() {
            Text('模型')
              .fontSize(16)
              .fontColor(this.menuLabelColor())
            Blank()
            Text(this.modelLabel() + ' ›')
              .fontSize(14)
              .fontColor(this.mutedText())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: 160 })
          }
          .width('100%')
          .height(44)
          .padding({ left: 16, right: 16 })
          .onClick(() => {
            this.openModelList('model');
          })
          Row()
            .width('100%')
            .height(1)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)')
            .margin({ left: 16, right: 16 })
          Row() {
            Text('推理等级')
              .fontSize(16)
              .fontColor(this.menuLabelColor())
            Blank()
            Text((this.effort.length > 0 ? this.effort : 'High') + ' ›')
              .fontSize(14)
              .fontColor(this.mutedText())
          }
          .width('100%')
          .height(44)
          .padding({ left: 16, right: 16 })
          .onClick(() => {
            this.openModelList('effort');
          })
        } else {
          Scroll() {
            Column() {
              if (this.modelListPane === 'effort') {
                Row() {
                  Text('‹ 推理等级')
                    .fontSize(16)
                    .fontColor(this.menuLabelColor())
                }
                .width('100%')
                .height(44)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.openModelList('root');
                })
                ForEach(this.effortValues, (value: string, index: number) => {
                  Column() {
                    Row() {
                      Text(this.effortLabels[index])
                        .fontSize(16)
                        .fontColor(this.menuLabelColor())
                      Blank()
                      Text(this.effortCurrent === value ? '✓' : '')
                        .fontSize(15)
                        .fontColor(this.menuLabelColor())
                    }
                    .width('100%')
                    .height(44)
                    .padding({ left: 16, right: 16 })
                    .onClick(() => {
                      this.modelSheetVisible = false;
                      this.onPickEffortOption(value);
                    })
                    if (index < this.effortValues.length - 1) {
                      Row()
                        .width('100%')
                        .height(1)
                        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)')
                        .margin({ left: 16, right: 16 })
                    }
                  }
                }, (value: string) => 'effort-' + value)
              } else {
                ForEach(this.modelMenuItems, (row: ModelMenuItem) => {
                  Column() {
                    if (row.isHeader) {
                      Row() {
                        Text(row.label)
                          .fontSize(13)
                          .fontColor(this.mutedText())
                      }
                      .width('100%')
                      .height(32)
                      .padding({ left: 16, right: 16 })
                    } else {
                      Row() {
                        Text(row.label)
                          .fontSize(16)
                          .fontColor(this.menuLabelColor())
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                          .layoutWeight(1)
                        Text(row.current ? '✓' : '')
                          .fontSize(15)
                          .fontColor(this.menuLabelColor())
                      }
                      .width('100%')
                      .height(44)
                      .padding({ left: 16, right: 16 })
                      .onClick(() => {
                        this.modelSheetVisible = false;
                        this.onPickModelOption(row.provider, row.model);
                      })
                    }
                    Row()
                      .width('100%')
                      .height(1)
                      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)')
                      .margin({ left: 16, right: 16 })
                  }
                }, (row: ModelMenuItem) => row.key)
                Row() {
                  Text('‹ 模型')
                    .fontSize(16)
                    .fontColor(this.menuLabelColor())
                }
                .width('100%')
                .height(44)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.openModelList('root');
                })
              }
            }
            .width('100%')
          }
          .width('100%')
          .constraintSize({ maxHeight: 320 })
          .scrollBar(BarState.Off)
          .align(Alignment.Top)
        }
      }
      .width(248)
      .padding({ top: 4, bottom: 4 })
      .borderRadius(16)
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .backgroundColor(this.isDark ? 'rgba(26,28,32,0.92)' : 'rgba(252,252,254,0.92)')
      .shadow({ radius: 24, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.18)', offsetY: 8 })
      .alignItems(HorizontalAlign.Start)
      .clip(true)
      Blank()
    }
    .width('100%')
    .padding({ left: 14, right: 14, bottom: 6 })
  }
  /** 指标行文字色（小程序 .stat / .meta 的次要色） */
  private metricText(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.56)';
  }

  /** 图标着色（支持 rgba()：颜色矩阵连 alpha 一起换，和文字完全同色） */
  private iconTintRgba(color: string): number[] {
    const match: RegExpExecArray | null = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(color.trim());
    if (match !== null) {
      const r: number = Number(match[1]) / 255;
      const g: number = Number(match[2]) / 255;
      const b: number = Number(match[3]) / 255;
      const a: number = Number(match[4]);
      return [
        0, 0, 0, 0, r,
        0, 0, 0, 0, g,
        0, 0, 0, 0, b,
        0, 0, 0, a, 0
      ];
    }
    return this.iconTint(color);
  }

  /** 主按钮：可发送 → ↑；运行中 → 停止方块 */
  @Builder
  primaryButton() {
    Stack() {
      if (this.showStopState()) {
        Rect({ width: 14, height: 14, radius: 3 }).fill('#FFFFFF')
      } else if (this.canSendNow() || !this.voiceEnabled) {
        // 小程序 .composer-inline-send .send-ic：36rpx(18vp) 的 arrow-up-white.png 图标箭头
        Image($r('app.media.arrow_up_white'))
          .width(18)
          .height(18)
          .objectFit(ImageFit.Contain)
          .draggable(false)
      } else {
        // 无草稿且开了语音：文字态显示麦克风、语音态显示键盘（对齐小程序 voice-wave / voice-keyboard）
        SymbolGlyph(this.voiceMode ? $r('sys.symbol.keyboard') : $r('sys.symbol.mic'))
          .fontSize(18)
          .fontColor(['#FFFFFF'])
      }
    }
    .width(36)
    .height(36)
    .borderRadius(18)
    .backgroundColor('#2E6BE6')
    .opacity(this.sending ? 0.66 : (this.showStopState() || this.canSendNow() || this.voiceEnabled ? 1 : 0.48))
    .enabled(!this.sending && (this.showStopState() || this.canSendNow() || this.voiceEnabled))
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
        return;
      }
      // 无草稿：点按钮在「语音输入 / 键盘输入」之间切换
      if (this.voiceEnabled) {
        this.onToggleVoiceMode();
      }
    })
  }

  /** 三个指标弹层的展开态（对齐首页工作区卡片：控制变量式系统 Menu） */
  @State runMenuOpen: boolean = false;
  @State tokenMenuOpen: boolean = false;
  @State contextMenuOpen: boolean = false;

  /** 菜单分隔/描边色（与上下文进度条底色同源） */
  private menuSeparator(): string {
    return this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(12,14,19,0.08)';
  }

  /** 指标弹层标题行（恢复标题：会话统计 / Token 用量 / 上下文已用） */
  @Builder
  metricHeaderRow(title: string) {
    Row() {
      Text(title)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.menuLabelColor())
      Blank()
    }
    .width(232)
    .height(36)
    .padding({ left: 24, right: 24 })
  }

  /** 指标弹层数据行：名称在左（系统菜单字色），数值在右（次级色） */
  @Builder
  metricRow(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor(this.menuLabelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Blank()
      Text(value)
        .fontSize(13)
        .fontColor(this.mutedText())
    }
    .width(232)
    .height(40)
    .padding({ left: 24, right: 24 })
  }

  @Builder
  runMenuBuilder() {
    Menu()
      .menuItemDivider({
        strokeWidth: LengthMetrics.vp(0.6),
        color: this.menuSeparator(),
        startMargin: LengthMetrics.vp(12),
        endMargin: LengthMetrics.vp(12)
      }) {
      MenuItemGroup() {
        MenuItem(this.metricHeaderRow('会话统计')).enabled(false)
        ForEach(this.metricPairsFor('run'), (pair: MetricMenuPair) => {
          MenuItem(this.metricRow(pair.label, pair.value))
        }, (pair: MetricMenuPair) => pair.label)
      }
    }
  }

  @Builder
  tokenMenuBuilder() {
    Menu()
      .menuItemDivider({
        strokeWidth: LengthMetrics.vp(0.6),
        color: this.menuSeparator(),
        startMargin: LengthMetrics.vp(12),
        endMargin: LengthMetrics.vp(12)
      }) {
      MenuItemGroup() {
        MenuItem(this.metricHeaderRow('Token 用量')).enabled(false)
        ForEach(this.metricPairsFor('token'), (pair: MetricMenuPair) => {
          MenuItem(this.metricRow(pair.label, pair.value))
        }, (pair: MetricMenuPair) => pair.label)
      }
    }
  }

  @Builder
  contextMenuBuilder() {
    Menu()
      .menuItemDivider({
        strokeWidth: LengthMetrics.vp(0.6),
        color: this.menuSeparator(),
        startMargin: LengthMetrics.vp(12),
        endMargin: LengthMetrics.vp(12)
      }) {
      MenuItemGroup() {
        MenuItem(this.metricHeaderRow('上下文已用')).enabled(false)
        ForEach(this.metricPairsFor('context'), (pair: MetricMenuPair) => {
          MenuItem(this.metricRow(pair.label, pair.value))
        }, (pair: MetricMenuPair) => pair.label)
      }
    }
  }

  @Builder
  runMetricItem() {
    Row({ space: 3 }) {
      Image($r('app.media.dsh_gauge'))
        .width(14)
        .height(14)
        .colorFilter(this.iconTintRgba(this.metricText()))
      Text(this.runMetric)
        .fontSize(13)
        .fontColor(this.metricText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .opacity(0.78)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.runMenuOpen = !this.runMenuOpen;
    })
    .bindMenu(this.runMenuOpen, this.runMenuBuilder(), {
      outlineColor: this.menuSeparator(),
      outlineWidth: 1,
      onWillDisappear: () => {
        this.runMenuOpen = false;
      }
    })
  }

  /** ② token 指标：▤ + N tok · N% → Token 用量弹层 */
  @Builder
  tokenMetricItem() {
    Row({ space: 3 }) {
      Image($r('app.media.dsh_storage'))
        .width(14)
        .height(14)
        .colorFilter(this.iconTintRgba(this.metricText()))
      Text(this.tokenMetric)
        .fontSize(13)
        .fontColor(this.metricText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .opacity(0.78)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.tokenMenuOpen = !this.tokenMenuOpen;
    })
    .bindMenu(this.tokenMenuOpen, this.tokenMenuBuilder(), {
      outlineColor: this.menuSeparator(),
      outlineWidth: 1,
      onWillDisappear: () => {
        this.tokenMenuOpen = false;
      }
    })
  }

  /** ③ 上下文指标：14×14 细环（环厚 2.5vp，对齐小程序 metric-context-ring）+ N% → 上下文弹层 */
  @Builder
  contextMetricItem() {
    Row({ space: 3 }) {
      Progress({ value: this.contextPercent < 0 ? 0 : this.contextPercent, total: 100, type: ProgressType.Ring })
        .width(14)
        .height(14)
        .style({ strokeWidth: 2.5 })
        .color('#2E6BE6')
        .backgroundColor(this.ringTrack())
      Text(this.contextMetric)
        .fontSize(13)
        .fontColor(this.metricText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .opacity(0.78)
    .alignItems(VerticalAlign.Center)
    .onClick(() => {
      this.contextMenuOpen = !this.contextMenuOpen;
    })
    .bindMenu(this.contextMenuOpen, this.contextMenuBuilder(), {
      outlineColor: this.menuSeparator(),
      outlineWidth: 1,
      onWillDisappear: () => {
        this.contextMenuOpen = false;
      }
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
      // 最外圈白色光圈层：白色包边裹住卡片，外圈再叠一层柔和光晕（参考截图的光圈）
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
            if (this.voiceRecording) {
              VoiceRipplePanel({ level: this.voiceLevel, cancelling: this.voiceCancelArmed, visible: true })
            }
            Text(this.voiceRecording ? this.voiceHint
              : (this.voiceEnabled && this.voiceMode ? '按住说话' : this.placeholder))
              .fontSize(this.voiceRecording ? 13 : 15)
              .fontColor(this.voiceCancelArmed ? '#D9413A' : this.collapsedPlaceholderColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
              .onTouch((event: TouchEvent) => this.onVoiceTouch(event))
              .onClick(() => {
                // 语音态下轻点：切回文字输入（对齐小程序 voice surface 的 tap 行为）
                if (this.voiceMode) {
                  this.onToggleVoiceMode();
                }
                this.onFocusChange(true);
                // 点击折叠态占位：展开后延迟拉起键盘（节点刚从 Visibility.None 转可见，
                // 立即 focus 会落在布局完成前；两次重试保证真机一次点按即弹键盘）
                setTimeout(() => {
                  this.getUIContext().getFocusController().requestFocus('composer-draft-area');
                }, 80);
                setTimeout(() => {
                  this.getUIContext().getFocusController().requestFocus('composer-draft-area');
                }, 240);
              })
            // 折叠态右侧按钮（对齐小程序 composer-inline-send 三态）：
            //   运行中 → 停止方块；有草稿 → 发送箭头；否则开了语音 → 麦克风/键盘切换
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
            } else if (this.canSendNow()) {
              Stack() {
                Image($r('app.media.arrow_up_white'))
                  .width(18)
                  .height(18)
                  .objectFit(ImageFit.Contain)
                  .draggable(false)
              }
              .width(33)
              .height(33)
              .borderRadius(17)
              .backgroundColor('#2E6BE6')
              .onClick(() => {
                this.onSend();
              })
            } else if (this.voiceEnabled) {
              Stack() {
                // 文字态显示麦克风（点了切到语音），语音态显示键盘（点了切回文字）
                SymbolGlyph(this.voiceMode ? $r('sys.symbol.keyboard') : $r('sys.symbol.mic'))
                  .fontSize(18)
                  .fontColor(['#FFFFFF'])
              }
              .width(33)
              .height(33)
              .borderRadius(17)
              .backgroundColor('#2E6BE6')
              .accessibilityText(this.voiceMode ? '切换到文字输入' : '切换到语音输入')
              .onClick(() => {
                this.onToggleVoiceMode();
              })
            }
          }
          .width('100%')
          .height(36)
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
        }
      }
      .width('100%')
      .padding(this.expanded()
        ? { left: 14, right: 14, top: 12, bottom: 10 }
        : { left: 8, right: 8, top: 7, bottom: 7 })
      // 首页「切换主机」半模态的观感：背景模糊 + 玻璃上叠淡白的半透明底 + 白色细描边；圆角 24
      // （ImmersiveMaterial 只能在 bindSheet 的 systemMaterial 上生效，普通容器用模糊 + 半透明底等价逼近）
      .borderRadius(24)
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .backgroundColor(this.sheetCardFill())
      .border({ width: 0.5, color: this.cardEdge() })

      }
      .width('100%')
      // 光圈层：统一 1.3vp 白环（深/浅色同一厚度，细而可见）
      .padding(1.3)
      .borderRadius(25.3)
      .backgroundColor(this.ringColor())
      // 与返回按钮同一套悬浮投影：中性色、向下偏移 2vp
      .shadow({ radius: 6, color: this.haloShadow(), offsetX: 0, offsetY: 2 })

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
