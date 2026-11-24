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
import { display, LengthMetrics, uiMaterial } from '@kit.ArkUI';
import { KeyCode } from '@kit.InputKit';
import type { ModelMenuItem, PickedAttachment } from 'nativecore';

/** 指标菜单行（鸿蒙原生 Menu 的 MenuItem：content 在左，labelInfo 数值在右） */
export interface MetricMenuPair {
  label: string;
  value: string;
}

/** 「/」指令菜单条目（与「+」菜单同一套内容） */
export interface CommandMenuItem {
  name: string;
  label: string;
  english: string;
  desc: string;
}

/** 输入框里的引用 chip（会话 / 文件夹 / 文件） */
export interface RefChipItem {
  key: string;
  label: string;
  kind: string;
  /** 发送时拼进正文的引用 token（如 @标题 / @路径） */
  token: string;
}

/** 「/」菜单里的技能条目（网关下发的 skill 指令） */
export interface SkillItem {
  name: string;
  label: string;
  description: string;
}

/** 「@」菜单里的工作区目录 / 文件条目 */
export interface RefDirItem {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** 「@」引用菜单里的会话条目 */
export interface RefSessionItem {
  id: string;
  title: string;
  detail: string;
}

@Component
export struct ConversationComposer {
  @Prop isDark: boolean = false;
  /** 草稿：外部（页面）改写时同步解析斜杠指令前缀，输入框里把 /goal、/plan 显示成蓝色 */
  @Prop @Watch('onDraftPropChanged') draft: string = '';
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
  /** 已选附件（图片走缩略图预览、文件走回形针胶囊） */
  @Prop attachments: PickedAttachment[] = [];
  /** 点击附件右上角删除钮 */
  onRemoveAttachment: (uri: string) => void = () => {};
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
  /** 智能体团队协作开关（模型面板根页） */
  @Prop teamEnabled: boolean = false;
  onToggleTeam: (next: boolean) => void = () => {};
  @State private teamTipOpen: boolean = false;
  /** 推理等级菜单（小程序 effortSheet：Off/Low/Medium/High） */
  @Prop effortValues: string[] = [];
  @Prop effortLabels: string[] = [];
  @Prop effortCurrent: string = '';

  onDraft: (value: string) => void = () => {};
  onSend: () => void = () => {};
  onStop: () => void = () => {};
  onAddAttachment: () => void = () => {};
  /** 「+」弹层：相册图片 / 文件 */
  onPickImages: () => void = () => {};
  onPickFiles: () => void = () => {};
  /** 「+」弹层：选中一条斜杠指令（页面把它写进草稿） */
  onPickCommand: (name: string) => void = () => {};
  /** 「@」引用菜单：可引用的会话（由页面传入，排除当前会话与空会话） */
  @Prop refSessions: RefSessionItem[] = [];
  onPickSessionRef: (id: string, title: string) => void = () => {};
  /** 「/」菜单技能列表（网关 skill 指令） */
  @Prop skills: SkillItem[] = [];
  /** 「@」菜单工作区条目与当前目录 */
  @Prop refDirs: RefDirItem[] = [];
  @Prop refDirPath: string = '';
  onRefDirOpen: (path: string) => void = () => {};
  /** 已选引用 chip（会话/文件），显示在输入框上方：蓝字 + 图标 + × */
  @Prop refChips: RefChipItem[] = [];
  onRemoveRefChip: (key: string) => void = () => {};
  /** 「@」菜单打开时若还没有目录数据，让页面去拉一次工作区目录 */
  onRequestRefDirs: () => void = () => {};
  /** 选中 @ 菜单里的文件/文件夹（isDirectory 区分文件夹 → 引用 chip 用文件夹图标 + 末尾斜杠） */
  onPickRefPath: (path: string, isDirectory: boolean) => void = () => {};
  /** 「+」弹层展开态（bindMenu 控制变量） */
  @State attachMenuOpen: boolean = false;
  /** 斜杠指令前缀：草稿以 /goal、/plan 开头时，输入框把前缀显示成蓝色（对齐小程序 composer-slash-token） */
  @State draftToken: string = '';
  @State draftTokenLabel: string = '';
  /** 文字域光标位置（判断退格是否已退到蓝色 token 之后，用于一键删除指令） */
  @State draftCaret: number = 0;
  /** 输入 / 或 @ 触发的菜单：'' 关闭 / 'command' 指令 / 'ref' 引用 */
  @State triggerMode: string = '';
  @State triggerQuery: string = '';
  @State triggerMenuOpen: boolean = false;
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
  /** Token 弹层标题行最右：只显示总量（不带命中率） */
  @Prop tokenTotal: string = '';
  @Prop contextMetric: string = '—%';
  /** 上下文用量总量（如 ~523K / 1M），显示在弹层标题行最右 */
  @Prop contextTotal: string = '';
  /** 上下文分段占比（系统提示词 / 工具定义 / 对话消息），用于标题下彩色分段条 */
  @Prop ctxSystemPct: number = 0;
  @Prop ctxToolsPct: number = 0;
  @Prop ctxMsgPct: number = 0;
  @Prop contextPercent: number = 0;

  // ==================== 状态 ====================
  /** 展开态：聚焦、有草稿或有附件（对齐小程序 composer-expanded 判定） */
  aboutToAppear(): void {
    this.resolveDraftToken(this.draft);
  }

  /** 页面改写草稿（如从「+」菜单选目标/计划、发送后清空）时重新解析指令前缀 */
  onDraftPropChanged(): void {
    this.resolveDraftToken(this.draft);
  }

  /** 指令名 → 蓝色 token 文案（对齐小程序 commandLabel：内置指令用中文，技能用 /name） */
  private slashCommandLabel(name: string): string {
    if (name === 'compact') {
      return '/压缩';
    }
    if (name === 'permission') {
      return '/权限';
    }
    if (name === 'model') {
      return '/模型';
    }
    if (name === 'goal') {
      return '/目标';
    }
    if (name === 'plan') {
      return '/计划';
    }
    return '/' + name;
  }

  /** 是否为已识别的斜杠指令：内置指令或网关下发的技能（技能名即指令名） */
  private isKnownSlashCommand(name: string): boolean {
    for (const command of this.commandList()) {
      if (command.name === name) {
        return true;
      }
    }
    for (const skill of this.skills) {
      if (skill.name === name) {
        return true;
      }
    }
    return false;
  }

  /**
   * 草稿 → 需要蓝色显示的指令前缀。
   * 覆盖所有从「+ / 「/」菜单选中的指令与技能（/目标、/压缩、/code-review …）：
   * 输入框显示蓝色 token，文字域只承载参数。
   */
  private resolveDraftToken(text: string): void {
    this.draftToken = '';
    this.draftTokenLabel = '';
    if (text.length < 2 || text.charAt(0) !== '/') {
      return;
    }
    const spaceIndex: number = text.indexOf(' ');
    const name: string = spaceIndex < 0 ? text.substring(1) : text.substring(1, spaceIndex);
    if (name.length === 0 || (spaceIndex >= 0 && spaceIndex !== name.length + 1)) {
      return;
    }
    if (!this.isKnownSlashCommand(name)) {
      return;
    }
    this.draftToken = '/' + name;
    this.draftTokenLabel = this.slashCommandLabel(name);
  }

  /** 文字域显示值：有指令前缀时只显示参数部分（前缀由蓝色 Text 单独渲染） */
  private draftArgument(): string {
    if (this.draftToken.length === 0) {
      return this.draft;
    }
    if (this.draft.length <= this.draftToken.length) {
      return '';
    }
    const rest: string = this.draft.substring(this.draftToken.length);
    return rest.startsWith(' ') ? rest.substring(1) : rest;
  }

  /**
   * 文字域展示值：指令前缀不进文字域，用一个零宽占位符（U+200B）代表它。
   * 这样输入法退格删光参数后再退一格会删掉占位符 → onChange 收到空串 → 一键移除整条指令。
   */
  private draftFieldText(): string {
    const argument: string = this.draftArgument();
    return this.draftToken.length > 0 ? '\u200B' + argument : argument;
  }

  /** 输入框只改参数：拼回「/token 参数」写回草稿 */
  private applyDraftArgument(value: string): void {
    const next: string = this.draftToken.length > 0 ? this.draftToken + ' ' + value : value;
    this.resolveDraftToken(next);
    this.onDraft(next);
    this.updateTrigger(next);
  }

  /**
   * 输入法退格：光标已经在文字域最前面（或参数为空）时，一次退格就删掉整条蓝色指令。
   * 之前蓝色 token 是文字域之外的独立节点，退格只能删参数，退到底也删不掉 token。
   */
  private onDraftKeyEvent(event: KeyEvent): void {
    if (this.draftToken.length === 0) {
      return;
    }
    if (event.type !== KeyType.Down || event.keyCode !== KeyCode.KEYCODE_DEL) {
      return;
    }
    const argument: string = this.draftArgument();
    if (argument.length === 0 || this.draftCaret <= 0) {
      this.clearDraftToken();
    }
  }

  /** 点蓝色指令前缀 = 取消这条指令（文字域为空时也能退出该指令） */
  private clearDraftToken(): void {
    this.draftToken = '';
    this.draftTokenLabel = '';
    this.onDraft('');
    this.updateTrigger('');
  }

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
  /** 本轮触摸已经当成长按处理：吞掉随后触发的 onClick，避免又展开输入框 */
  private voiceHoldConsumed: boolean = false;

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
        this.voiceHoldConsumed = true;
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

  /** 折叠态占位文案色（对齐小程序 .composer-collapsed-placeholder：浅 0.32 / 深 0.40） */
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

  /** 着色矩阵缓存：同一颜色复用同一数组实例，避免菜单重建时反复分配导致图标重绘闪烁 */
  private tintCache: Map<string, number[]> = new Map<string, number[]>();

  /** 单色图标着色（颜色矩阵）：只换 RGB，保留透明度 */
  private iconTint(color: string): number[] {
    const cached: number[] | undefined = this.tintCache.get(color);
    if (cached !== undefined) {
      return cached;
    }
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
    const matrix: number[] = [
      0, 0, 0, 0, red / 255,
      0, 0, 0, 0, green / 255,
      0, 0, 0, 0, blue / 255,
      0, 0, 0, alpha, 0
    ];
    this.tintCache.set(color, matrix);
    return matrix;
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
    // 输入卡玻璃底：降低不透明度，让时间线文字滚到输入框下面时也能透出来（模糊仍保留）
    return this.isDark ? 'rgba(8,8,10,0.30)' : 'rgba(255,255,255,0.34)';
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
  /**
   * 输入框的沉浸光感材质（对照《组件适配沉浸光感》）：
   * 薄玻璃 THIN + 交互形变 + 光感交互反馈；设备不支持时返回 undefined，
   * 卡片退化为半透明纯色底（不再自己画 backdropBlur）。
   */
  private glassMaterial(): uiMaterial.Material | undefined {
    try {
      if (!uiMaterial.isImmersiveMaterialSupported()) {
        return undefined;
      }
      return new uiMaterial.ImmersiveMaterial({
        style: uiMaterial.ImmersiveStyle.THIN,
        interactive: true,
        lightEffect: {},
        applyShadow: true
      });
    } catch (err) {
      return undefined;
    }
  }

  /** 顶沿高光：中间亮、两端收敛的 1vp 细线，给玻璃一个「受光边」 */
  @Builder
  topGlint() {
    Column()
      .width('100%')
      .height(1)
      .linearGradient({
        angle: 90,
        colors: [
          [this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)', 0],
          [this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.98)', 0.5],
          [this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)', 1]
        ]
      })
      .hitTestBehavior(HitTestMode.None)
  }

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
  /** 按扩展名判断图片附件：图片走缩略图，其它走回形针文件胶囊 */
  private isImageAttachment(name: string): boolean {
    const lower: string = name.toLowerCase();
    return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') ||
      lower.endsWith('.webp') || lower.endsWith('.heic') || lower.endsWith('.heif') ||
      lower.endsWith('.gif') || lower.endsWith('.bmp');
  }

  /**
   * 已选附件预览（对齐小程序 composer-images / pending-file，也与 iOS 附件托盘一致）：
   *   · 图片 → 52×52 缩略图卡（10 圆角）
   *   · 文件 → 回形针图标 + 文件名胶囊
   *   · 右上角圆形删除钮
   */
  /** 引用 chip 的图标：会话=气泡，目录=文件夹，文件=文档 */
  private refChipIcon(kind: string): Resource {
    if (kind === 'quote') {
      // 引用回复：气泡图标（与「引用：xxx」语义一致）
      return $r('app.media.cmd_session');
    }
    if (kind === 'session') {
      return $r('app.media.cmd_session');
    }
    if (kind === 'folder') {
      return $r('app.media.ref_folder');
    }
    return $r('app.media.attach_file');
  }

  /**
   * 引用 chip 的主色：与小程序一致——浅色 #2E6BE6、深色 #8FB4F2
   * （小程序 .composer-ref-x / .theme-dark .composer-ref-label 就是这套双色）。
   */
  private refChipInk(): string {
    return this.isDark ? '#8FB4F2' : '#2E6BE6';
  }

  /** 引用 chip 底色：跟随主色，深色用低透明度避免发灰 */
  private refChipFill(): string {
    return this.isDark ? 'rgba(143,180,242,0.16)' : 'rgba(46,107,230,0.10)';
  }

  /** 是否有「引用回复」chip（kind='quote'）：引用用独立卡片样式，不混进普通 chip 行 */
  private hasQuote(): boolean {
    for (const chip of this.refChips) {
      if (chip.kind === 'quote') {
        return true;
      }
    }
    return false;
  }

  private hasPlainRef(): boolean {
    for (const chip of this.refChips) {
      if (chip.kind !== 'quote') {
        return true;
      }
    }
    return false;
  }

  private quoteChip(): RefChipItem | null {
    for (const chip of this.refChips) {
      if (chip.kind === 'quote') {
        return chip;
      }
    }
    return null;
  }

  /** 引用卡片：灰色圆角块 + 引文 + 右上角 ×（对齐 iOS 新版引用样式） */
  @Builder
  quoteCard() {
    Row() {
      Text(this.quoteChip() === null ? '' : (this.quoteChip() as RefChipItem).label)
        .fontSize(15)
        .lineHeight(21)
        .fontColor(this.isDark ? 'rgba(241,244,250,0.92)' : 'rgba(16,19,24,0.9)')
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Stack() {
        Text('×')
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.isDark ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.95)')
      }
      .width(20)
      .height(20)
      .borderRadius(10)
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.92)' : 'rgba(16,19,24,0.72)')
      .alignContent(Alignment.Center)
      .margin({ left: 8 })
      .onClick(() => {
        const chip: RefChipItem | null = this.quoteChip();
        if (chip !== null) {
          this.onRemoveRefChip(chip.key);
        }
      })
    }
    .width('100%')
    .padding({ left: 14, right: 10, top: 10, bottom: 10 })
    .borderRadius(14)
    .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.05)')
    .alignItems(VerticalAlign.Top)
    .margin({ bottom: 8 })
  }

  /** 已选引用：蓝字 + 图标 + ×（对齐 DSH / 小程序的引用 chip，文件/文件夹/会话同一套样式） */
  @Builder
  refChipsRow() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.Start, alignItems: ItemAlign.Center }) {
      ForEach(this.refChips, (chip: RefChipItem) => {
        // 对齐小程序 composer-ref-chip / 鸿蒙端截图：透明底，蓝色图标 + 蓝色标题 + 浅色 ×
        Row({ space: 5 }) {
          Image(this.refChipIcon(chip.kind))
            .width(15)
            .height(15)
            .objectFit(ImageFit.Contain)
            .colorFilter(this.iconTintRgba(this.refChipInk()))
          Text(chip.label)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.refChipInk())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 190 })
          Text('×')
            .fontSize(13)
            .fontColor(this.isDark ? 'rgba(143,180,242,0.75)' : 'rgba(46,107,230,0.75)')
            .onClick(() => {
              this.onRemoveRefChip(chip.key);
            })
        }
        .padding({ left: 2, right: 2, top: 2, bottom: 2 })
        .margin({ right: 12, bottom: 2 })
        .backgroundColor(Color.Transparent)
        .visibility(chip.kind === 'quote' ? Visibility.None : Visibility.Visible)
      }, (chip: RefChipItem) => chip.key)
    }
    .width('100%')
    .padding({ left: 2, right: 2, bottom: 4 })
  }

  @Builder
  attachmentRow() {
    Scroll() {
      Row({ space: 8 }) {
        ForEach(this.attachments, (attachment: PickedAttachment) => {
          Stack({ alignContent: Alignment.TopEnd }) {
            if (this.isImageAttachment(attachment.name)) {
              Image(attachment.uri)
                .width(52)
                .height(52)
                .borderRadius(10)
                .objectFit(ImageFit.Cover)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)')
            } else {
              Row({ space: 5 }) {
                SymbolGlyph($r('sys.symbol.paperclip'))
                  .fontSize(13)
                  .fontColor([this.chipText()])
                Text(attachment.name)
                  .fontSize(12)
                  .fontColor(this.chipText())
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .constraintSize({ maxWidth: 110 })
              }
              .height(30)
              .padding({ left: 9, right: 9 })
              .borderRadius(9)
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
              .alignItems(VerticalAlign.Center)
            }
            // 右上角圆形删除钮（半透明黑底 + 白 ×）
            Stack() {
              Text('×')
                .fontSize(11)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
            }
            .width(18)
            .height(18)
            .borderRadius(9)
            .backgroundColor('rgba(0,0,0,0.62)')
            .alignContent(Alignment.Center)
            // 向内收：负 margin 越界会被父级 Scroll 裁掉上半截
            .margin({ top: 2, right: 2 })
            .onClick(() => {
              this.onRemoveAttachment(attachment.uri);
            })
          }
        }, (attachment: PickedAttachment) => attachment.uri)
      }
      .padding({ left: 2, right: 2, top: 4, bottom: 6 })
    }
    .width('100%')
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .align(Alignment.Start)
  }

  @Builder
  draftField() {
    Row({ space: 0 }) {
      // 斜杠指令前缀：蓝色显示（对齐小程序 composer-slash-token），点一下取消该指令
      if (this.draftTokenLabel.length > 0) {
        Text(this.draftTokenLabel + ' ')
          .fontSize(14)
          .fontWeight(350)
          .lineHeight(20)
          .fontColor('#2E6BE6')
          .padding({ top: 4 })
          .maxLines(1)
          .onClick(() => {
            this.clearDraftToken();
          })
      }
      Stack({ alignContent: Alignment.TopStart }) {
        // 有蓝色指令前缀且还没输入参数时，用灰色提示代替被零宽占位符占掉的 placeholder
        if (this.draftToken.length > 0 && this.draftArgument().length === 0) {
          Text(this.placeholder)
            .fontSize(14)
            .fontWeight(350)
            .lineHeight(20)
            .fontColor(this.placeholderColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .padding({ top: 4 })
            .hitTestBehavior(HitTestMode.None)
        }
      TextArea({ text: this.draftFieldText(), placeholder: this.placeholder })
      .id('composer-draft-area')
      .width('100%')
      // 文字度量对齐小程序 .composer-input：28rpx≈14vp / 字重 350 / 行高 1.4(≈20vp)
      .fontSize(14)
      .fontWeight(350)
      .lineHeight(20)
      .fontColor(this.inputText())
      .placeholderColor(this.placeholderColor())
      .placeholderFont({ size: 14, weight: 350 })
      .caretStyle({ width: 1.5, color: '#2E6BE6' })
      .backgroundColor('#00000000')
      .borderWidth(0)
      // 圆角归零：TextArea 默认带圆角，内容会按圆角形状裁剪，左内边距只有 2vp 时
      // 最后一行的第一个字左下角会被圆角切掉。卡片本身仍是 24 圆角，这里只让文字框变矩形。
      .borderRadius(0)
      // 左缘 2vp：与下方 chip 行的「+」按钮基本对齐（卡片 14vp 内边距已隔开光圈）。
      // 顶部 6vp：首行不能贴着内容框上沿——贴边时字形左上角会被裁掉一块，
      // 而且行数超过 maxHeight 触发内部滚动后，首行上半截会被直接切掉。
      // 上下各留 4vp：minHeight 30 减去后仍剩 22vp，大于 14vp 字号的行高，
      // 首行/末行都不会贴边；下缘的 4vp 也让 g/y/p 这类下伸字形不会触到内容框底边。
      // 左右 0：文字左缘与下方 chip 行的「+」按钮同一条线（小程序 .composer-input
      // 没有额外内边距，就是卡片 28rpx 内边距）；上下各 4vp 留给字形不贴边。
      .padding({ left: 0, right: 0, top: 4, bottom: 4 })
      // 小程序：min-height 76rpx≈38vp / max-height 320rpx≈160vp
      .constraintSize({ minHeight: 38, maxHeight: 160 })
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
        if (this.draftToken.length === 0) {
          this.applyDraftArgument(value);
          return;
        }
        // 文字域开头的零宽占位符代表蓝色指令：它被退格删掉（value 为空）时一键移除整条指令；
        // 其余情况把占位符剥掉后按参数写回草稿。
        if (value.length === 0) {
          this.clearDraftToken();
          return;
        }
        this.applyDraftArgument(value.split('\u200B').join(''));
      })
      // 光标位置：退格删到 token 后面时据此判断「一次退格删整条指令」
      .onTextSelectionChange((selectionStart: number, selectionEnd: number) => {
        this.draftCaret = selectionStart;
      })
      // 输入法退格：蓝色指令前缀不在文字域里，退到最前面时一键删除整条指令
      .onKeyEvent((event: KeyEvent) => {
        this.onDraftKeyEvent(event);
      })
      .bindMenu(this.triggerMenuOpen, this.triggerMenuPanel(), {
        placement: Placement.BottomLeft,
        offset: { x: 0, y: 6 },
        outlineColor: this.cardEdge(),
        outlineWidth: 1,
        onDisappear: () => {
          this.triggerMenuOpen = false;
          this.triggerMode = '';
        }
      })
      }
      .layoutWeight(1)
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
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
        this.attachMenuOpen = !this.attachMenuOpen;
      }
    })
    .bindMenu(this.attachMenuOpen, this.attachMenuPanel(), {
      placement: Placement.TopLeft,
      offset: { x: 0, y: 4 },
      outlineColor: this.cardEdge(),
      outlineWidth: 1,
      onDisappear: () => {
        this.attachMenuOpen = false;
      }
    })
  }

  /** 「+」弹层分组标题（对齐小程序 composer 菜单的分组小标题） */
  @Builder
  attachMenuSection(title: string) {
    Text(title)
      .fontSize(12)
      .fontColor(this.mutedText())
      .width('100%')
      .padding({ left: 16, right: 20, top: 12, bottom: 4 })
  }

  /**
   * @ 菜单里的文件/文件夹行（对齐小程序 file-mention-row）：
   * 点整行 = 把该条目作为引用 chip；文件夹右侧的 › 才是「进入目录」。
   */
  @Builder
  refMenuRow(dir: RefDirItem) {
    Row({ space: 10 }) {
      Image(dir.isDirectory ? $r('app.media.ref_folder') : $r('app.media.attach_file'))
        .width(18)
        .height(18)
        .objectFit(ImageFit.Contain)
        .colorFilter(this.iconTintRgba(this.refChipInk()))
      Text(dir.name + (dir.isDirectory ? '/' : ''))
        .fontSize(14)
        .fontColor(this.menuLabelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      if (dir.isDirectory) {
        Row() {
          Image($r('app.media.chev_right_gray'))
            .width(14)
            .height(14)
            .objectFit(ImageFit.Contain)
            .opacity(0.7)
        }
        .width(30)
        .height(30)
        .borderRadius(15)
        .justifyContent(FlexAlign.Center)
        .onClick(() => {
          // 进目录不关菜单：列表就地切换到该文件夹内容
          this.onRefDirOpen(dir.path);
        })
      } else {
        Text('文件')
          .fontSize(12)
          .fontColor(this.mutedText())
      }
    }
    .width('100%')
    .height(46)
    .padding({ left: 16, right: 20 })
    .borderRadius(10)
    .stateStyles({
      pressed: {
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
      },
      normal: {
        .backgroundColor(Color.Transparent)
      }
    })
    .onClick(() => {
      this.triggerMenuOpen = false;
      this.triggerMode = '';
      this.onPickRefPath(dir.path, dir.isDirectory);
    })
  }

  /** 屏幕宽度（vp）：菜单宽度跟随输入框 */
  private screenWidthVp(): number {
    try {
      return this.getUIContext().px2vp(display.getDefaultDisplaySync().width);
    } catch (err) {
      return 360;
    }
  }

  /**
   * 弹层宽度：对齐输入框宽度（输入条左右各 14vp 内边距），再各留 10vp 余量，
   * 避免系统菜单容器的内边距把最右侧文字裁掉。
   */
  private menuPanelWidth(): number {
    const width: number = this.screenWidthVp() - 48;
    return width > 260 ? width : 260;
  }

  /** 「+」弹层的一行：左图标 + 标题，右侧灰色说明（对齐截图样式） */
  @Builder
  attachMenuRow(icon: Resource, iconDark: Resource, tintDark: boolean, label: string, english: string,
    desc: string, onTap: () => void) {
    Row({ space: 8 }) {
      if (this.isDark) {
        Image(iconDark)
          .width(20)
          .height(20)
          .objectFit(ImageFit.Contain)
          .colorFilter(tintDark ? this.iconTintRgba('rgba(241,244,250,0.62)') : this.noTint())
      } else {
        Image(icon)
          .width(20)
          .height(20)
          .objectFit(ImageFit.Contain)
      }
      // 标题按内容宽度（不占满整行），英文别名紧跟在标题后面
      Text(label)
        .fontSize(14)
        .fontColor(this.menuLabelColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .constraintSize({ maxWidth: this.menuPanelWidth() * 0.42 })
      if (english.length > 0) {
        Text(english)
          .fontSize(11)
          .fontColor(this.mutedText())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: this.menuPanelWidth() * 0.18 })
      }
      Text(desc)
        .fontSize(11.5)
        .fontColor(this.mutedText())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.End)
        // 右侧说明优先展示（左侧标题可收缩），比例 2 给说明更多空间
        .layoutWeight(2)
    }
    .width('100%')
    .height(46)
    .padding({ left: 16, right: 20 })
    .borderRadius(10)
    .stateStyles({
      pressed: {
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
      },
      normal: {
        .backgroundColor(Color.Transparent)
      }
    })
    .onClick(() => {
      this.attachMenuOpen = false;
      onTap();
    })
  }

  /** 「/」指令清单（与「+」菜单一致） */
  private commandList(): CommandMenuItem[] {
    const out: CommandMenuItem[] = [];
    out.push({ name: 'compact', label: '压缩', english: 'compact', desc: '压缩以上对话内容' });
    out.push({ name: 'permission', label: '权限', english: 'permission', desc: '切换权限预设' });
    out.push({ name: 'model', label: '模型', english: 'model', desc: '选择当前会话的模型' });
    out.push({ name: 'goal', label: '目标', english: 'goal', desc: '设置或查看长期任务目标' });
    out.push({ name: 'plan', label: '计划', english: 'plan', desc: '进入或退出计划模式' });
    return out;
  }

  private commandIcon(name: string): Resource {
    if (name === 'compact') {
      return $r('app.media.cmd_compact');
    }
    if (name === 'permission') {
      return $r('app.media.cmd_permission');
    }
    if (name === 'model') {
      return $r('app.media.cmd_model');
    }
    if (name === 'goal') {
      return $r('app.media.cmd_goal');
    }
    return $r('app.media.cmd_plan');
  }

  private commandIconDark(name: string): Resource {
    if (name === 'compact') {
      return $r('app.media.cmd_compact_dark');
    }
    if (name === 'permission') {
      return $r('app.media.cmd_permission_dark');
    }
    if (name === 'model') {
      return $r('app.media.cmd_model_dark');
    }
    if (name === 'goal') {
      return $r('app.media.cmd_goal_dark');
    }
    return $r('app.media.cmd_plan_dark');
  }

  private filteredCommands(): CommandMenuItem[] {
    const query: string = this.triggerQuery.trim().toLowerCase();
    const out: CommandMenuItem[] = [];
    for (const item of this.commandList()) {
      // 目标 / 计划归在「添加」分组（与「+」菜单一致），「指令」分组不再重复列出
      if (item.name === 'goal' || item.name === 'plan') {
        continue;
      }
      if (query.length > 0
        && item.name.toLowerCase().indexOf(query) < 0
        && item.label.indexOf(query) < 0
        && item.english.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(item);
    }
    return out;
  }

  private filteredSkills(): SkillItem[] {
    const query: string = this.triggerQuery.trim().toLowerCase();
    const out: SkillItem[] = [];
    for (const item of this.skills) {
      if (query.length > 0
        && item.name.toLowerCase().indexOf(query) < 0
        && item.label.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(item);
    }
    return out;
  }

  /** 「@」菜单条目过滤：目录/文件按名称，会话按标题 */
  private filteredRefDirs(): RefDirItem[] {
    const query: string = this.triggerQuery.trim().toLowerCase();
    const out: RefDirItem[] = [];
    for (const item of this.refDirs) {
      if (query.length > 0 && item.name.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(item);
    }
    return out;
  }

  private filteredRefSessions(): RefSessionItem[] {
    const query: string = this.triggerQuery.trim().toLowerCase();
    const out: RefSessionItem[] = [];
    for (const item of this.refSessions) {
      if (query.length > 0 && item.title.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(item);
    }
    return out;
  }

  /** 输入框内容变化后判定是否要弹「/ 指令」或「@ 引用」菜单 */
  private updateTrigger(text: string): void {
    let mode: string = '';
    let query: string = '';
    const slash: RegExpExecArray | null = /(^|\s)\/([^\s/]*)$/.exec(text);
    if (slash !== null) {
      mode = 'command';
      query = slash[2];
    } else {
      const at: RegExpExecArray | null = /(^|\s)@([^\s]*)$/.exec(text);
      if (at !== null) {
        mode = 'ref';
        query = at[2];
      }
    }
    this.triggerQuery = query;
    if (mode.length === 0) {
      this.triggerMode = '';
      this.triggerMenuOpen = false;
      return;
    }
    this.triggerMode = mode;
    this.triggerMenuOpen = true;
    if (mode === 'ref' && this.refDirs.length === 0) {
      this.onRequestRefDirs();
    }
  }

  /** 「/」与「@」共用的弹层（UI 与「+」菜单一致） */
  @Builder
  triggerMenuPanel() {
    Column({ space: 0 }) {
      // 内容超高时用内部 Scroll（隐藏滚动条）：交给系统菜单容器滚会在右侧露出滚动条
      Scroll() {
        Column({ space: 0 }) {
      if (this.triggerMode === 'command') {
        // 「/」= 「+」的全部内容（添加 + 指令）+ 技能
        this.attachMenuSection('添加')
        this.attachMenuRow($r('app.media.menu_image'), $r('app.media.menu_image'), true, '相册图片', '', '从相册选择', () => {
          this.triggerMenuOpen = false;
          this.triggerMode = '';
          this.onPickImages();
        })
        this.attachMenuRow($r('app.media.menu_external_file'), $r('app.media.menu_external_file'), true, '文件', '', '选择本地文件', () => {
          this.triggerMenuOpen = false;
          this.triggerMode = '';
          this.onPickFiles();
        })
        this.attachMenuRow($r('app.media.cmd_goal'), $r('app.media.cmd_goal_dark'), false, '目标', 'goal', '设置或查看长期任务目标', () => {
          this.triggerMenuOpen = false;
          this.triggerMode = '';
          this.onPickCommand('goal');
        })
        this.attachMenuRow($r('app.media.cmd_plan'), $r('app.media.cmd_plan_dark'), false, '计划', 'plan', '进入或退出计划模式', () => {
          this.triggerMenuOpen = false;
          this.triggerMode = '';
          this.onPickCommand('plan');
        })
        this.attachMenuSection('指令')
        ForEach(this.filteredCommands(), (item: CommandMenuItem) => {
          this.attachMenuRow(this.commandIcon(item.name), this.commandIconDark(item.name), false,
            item.label, item.english, item.desc, () => {
              this.triggerMenuOpen = false;
              this.triggerMode = '';
              this.onPickCommand(item.name);
            })
        }, (item: CommandMenuItem) => item.name)
        if (this.filteredSkills().length > 0) {
          this.attachMenuSection('技能')
          ForEach(this.filteredSkills(), (item: SkillItem) => {
            this.attachMenuRow($r('app.media.skill_icon'), $r('app.media.skill_icon_dark'), false,
              item.label.length > 0 ? item.label : item.name, '', item.description, () => {
                this.triggerMenuOpen = false;
                this.triggerMode = '';
                this.onPickCommand(item.name);
              })
          }, (item: SkillItem) => item.name)
        }
      } else if (this.triggerMode === 'ref') {
        // 「@」= 工作区文件与文件夹 + 对话列表全部会话
        this.attachMenuSection(this.refDirPath.length > 0 ? this.refDirPath : '工作区')
        ForEach(this.filteredRefDirs(), (dir: RefDirItem) => {
          this.refMenuRow(dir)
        }, (dir: RefDirItem) => dir.path)
        this.attachMenuSection('会话')
        ForEach(this.filteredRefSessions(), (item: RefSessionItem) => {
          this.attachMenuRow($r('app.media.cmd_session'), $r('app.media.cmd_session'), true,
            item.title, '', item.detail, () => {
              this.triggerMenuOpen = false;
              this.triggerMode = '';
              this.onPickSessionRef(item.id, item.title);
            })
        }, (item: RefSessionItem) => item.id)
      }
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
      }
      .constraintSize({ maxHeight: 420 })
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .width('100%')
    }
    .width(this.menuPanelWidth())
    .padding({ top: 6, bottom: 8 })
    .alignItems(HorizontalAlign.Start)
  }

  /** 「+」弹层：添加（图片/文件）+ 指令（压缩/权限/模型），对齐小程序 composer 菜单 */
  @Builder
  attachMenuPanel() {
    Column({ space: 0 }) {
      // 与「/」弹窗同一套：输入框宽度、内部滚动隐藏滚动条
      Scroll() {
        Column({ space: 0 }) {
          this.attachMenuSection('添加')
          this.attachMenuRow($r('app.media.menu_image'), $r('app.media.menu_image'), true, '相册图片', '', '从相册选择', () => {
            this.onPickImages();
          })
          this.attachMenuRow($r('app.media.menu_external_file'), $r('app.media.menu_external_file'), true, '文件', '', '选择本地文件', () => {
            this.onPickFiles();
          })
          this.attachMenuRow($r('app.media.cmd_goal'), $r('app.media.cmd_goal_dark'), false, '目标', 'goal', '设置或查看长期任务目标', () => {
            this.onPickCommand('goal');
          })
          this.attachMenuRow($r('app.media.cmd_plan'), $r('app.media.cmd_plan_dark'), false, '计划', 'plan', '进入或退出计划模式', () => {
            this.onPickCommand('plan');
          })
          this.attachMenuSection('指令')
          this.attachMenuRow($r('app.media.cmd_compact'), $r('app.media.cmd_compact_dark'), false, '压缩', 'compact', '压缩以上对话内容', () => {
            this.onPickCommand('compact');
          })
          this.attachMenuRow($r('app.media.cmd_permission'), $r('app.media.cmd_permission_dark'), false, '权限', 'permission', '切换权限预设', () => {
            this.onPickCommand('permission');
          })
          this.attachMenuRow($r('app.media.cmd_model'), $r('app.media.cmd_model_dark'), false, '模型', 'model', '选择当前会话的模型', () => {
            this.onPickCommand('model');
          })
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
      }
      .constraintSize({ maxHeight: 420 })
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
      .width('100%')
    }
    .width(this.menuPanelWidth())
    .alignItems(HorizontalAlign.Start)
    .padding({ top: 6, bottom: 8 })
  }

  /** 不改变颜色的颜色矩阵（图标自带配色，只在需要跟随主题时才着色） */
  private noTint(): number[] {
    return [
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 1, 0
    ];
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
        // 同步解码：避免菜单/状态重建时位图先空白再绘制的闪动
        .syncLoad(true)
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
        // 同步解码：避免菜单重建时位图先空白再绘制的闪动
        .syncLoad(true)
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
    // 最大圆角：胶囊形（高度的一半）
    .borderRadius(17)
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
      MenuItem(this.teamToggleRow())
        .id('team-entry')
    }
  }

  /** 第一层菜单里的团队协作开关行 */
  @Builder
  teamToggleRow() {
    Row({ space: 6 }) {
      Text('启用智能体团队协作')
        .fontSize(14)
        .fontColor(this.menuLabelColor())
        .maxLines(1)
      Text('ⓘ')
        .fontSize(11)
        .fontColor(this.mutedText())
        .padding(4)
        .onClick(() => {
          this.teamTipOpen = !this.teamTipOpen;
        })
        .bindPopup(this.teamTipOpen, {
          builder: this.teamTipBuilder(),
          placement: Placement.Top,
          popupColor: Color.Transparent,
          enableArrow: false,
          autoCancel: true,
          radius: 10,
          onStateChange: (event) => {
            if (!event.isVisible) {
              this.teamTipOpen = false;
            }
          }
        })
      Blank()
      Toggle({ type: ToggleType.Switch, isOn: this.teamEnabled })
        .selectedColor('#2E6BE6')
        .switchPointColor('#FFFFFF')
        .width(40)
        .height(24)
        .onChange((isOn: boolean) => {
          this.onToggleTeam(isOn);
        })
    }
    // 左边文字保持与原生行对齐；开关右移边界与上面箭头右边对齐（右内边距加大 8vp）
    .width(246)
    .height(44)
    .padding({ left: 12, right: 12 })
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
                // 最大圆角：胶囊形（高度的一半）
                .borderRadius(20)
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
    // 最大圆角：胶囊形（高度的一半）
    .borderRadius(17)
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
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, { colorMode: this.isDark ? ThemeColorMode.DARK : ThemeColorMode.LIGHT })
      .backgroundColor(this.isDark ? 'rgba(26,28,32,0.92)' : 'rgba(252,252,254,0.92)')
      .shadow({ radius: 24, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.18)', offsetY: 8 })
      .alignItems(HorizontalAlign.Start)
      .clip(true)
      Blank()
    }
    .width('100%')
    .padding({ left: 14, right: 14, bottom: 6 })
  }

  @Builder
  teamTipBuilder() {
    Text('通过共享任务板协调多个智能体的分工与进度，复杂任务表现更佳，token 开销也相应更高。')
      .fontSize(13)
      .lineHeight(19.5)
      .fontColor('#FFFFFF')
      .constraintSize({ maxWidth: 270 })
      .padding({ left: 14, right: 14, top: 10, bottom: 10 })
      .backgroundColor('rgba(28,30,36,0.96)')
      .borderRadius(10)
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
          Row()
            .width('100%')
            .height(1)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.20)')
            .margin({ left: 16, right: 16 })
          Row({ space: 6 }) {
            Text('启用智能体团队协作')
              .fontSize(16)
              .fontColor(this.menuLabelColor())
              .maxLines(1)
            Text('ⓘ')
              .fontSize(12)
              .fontColor(this.mutedText())
              .padding(4)
              .onClick(() => {
                this.teamTipOpen = !this.teamTipOpen;
              })
              .bindPopup(this.teamTipOpen, {
                builder: this.teamTipBuilder(),
                placement: Placement.Top,
                popupColor: Color.Transparent,
                enableArrow: false,
                autoCancel: true,
                radius: 10,
                onStateChange: (event) => {
                  if (!event.isVisible) {
                    this.teamTipOpen = false;
                  }
                }
              })
            Blank()
            Toggle({ type: ToggleType.Switch, isOn: this.teamEnabled })
              .selectedColor('#2E6BE6')
              .switchPointColor('#FFFFFF')
              .width(40)
              .height(24)
              .onChange((isOn: boolean) => {
                this.onToggleTeam(isOn);
              })
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
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
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK, { colorMode: this.isDark ? ThemeColorMode.DARK : ThemeColorMode.LIGHT })
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
        // 无草稿且开了语音：文字态 voice-wave.svg、语音态 voice-keyboard.svg
        // （小程序 .send-ic 36rpx≈18vp，与折叠态用同一套图标）
        Image(this.voiceMode ? $r('app.media.voice_keyboard') : $r('app.media.voice_wave'))
          .width(18)
          .height(18)
          .objectFit(ImageFit.Contain)
          .draggable(false)
          .syncLoad(true)
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

  /**
   * 指标弹层标题行（对齐小程序 stats-pop-title）：
   *   左侧指标图标（run=dsh-gauge / token=dsh-storage / context=圆环）
   *   + 标题 + 右侧总量（会话统计=x 轮 x 步、Token=tok · 命中率、上下文=占比）
   */
  @Builder
  metricHeaderRow(kind: string, title: string) {
    Row({ space: 6 }) {
      // 图标：run=gauge、token=storage；上下文按截图不带图标
      if (kind === 'run') {
        Image($r('app.media.dsh_gauge'))
          .width(14)
          .height(14)
          .objectFit(ImageFit.Contain)
          .colorFilter(this.iconTint(this.menuLabelColor()))
      } else if (kind === 'token') {
        Image($r('app.media.dsh_storage'))
          .width(14)
          .height(14)
          .objectFit(ImageFit.Contain)
          .colorFilter(this.iconTint(this.menuLabelColor()))
      }
      Text(title)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.menuLabelColor())
      // 上下文：百分比紧贴在标题后面（不再靠右）
      if (kind === 'context') {
        Text(this.contextMetric)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.mutedText())
          .maxLines(1)
      }
      Blank()
      if (kind === 'run') {
        Text(this.runMetric)
          .fontSize(12)
          .fontColor(this.mutedText())
          .maxLines(1)
      } else if (kind === 'token') {
        if (this.tokenTotal.length > 0) {
          Text(this.tokenTotal)
            .fontSize(12)
            .fontColor(this.mutedText())
            .maxLines(1)
        }
      } else if (this.contextTotal.length > 0) {
        Text(this.contextTotal)
          .fontSize(12)
          .fontColor(this.mutedText())
          .maxLines(1)
      }
    }
    .width(232)
    .height(36)
    .padding({ left: 24, right: 24 })
  }

  /** 上下文分段色：系统提示词=灰、工具定义=紫、对话消息=蓝（对齐小程序 ctx-bar 分段） */
  private segmentColor(label: string): string {
    // 标准（有 breakdown）：系统提示词灰 / 工具定义紫 / 对话消息蓝
    if (label.indexOf('系统') >= 0 || label.indexOf('提示') >= 0) {
      return '#8E8E93';
    }
    if (label.indexOf('工具') >= 0) {
      return '#AF7AE1';
    }
    if (label.indexOf('消息') >= 0 || label.indexOf('对话') >= 0) {
      return '#3B82F6';
    }
    // 兜底（网关无 breakdown，用 token 三项）：未缓存输入灰 / 缓存读取紫 / 模型输出蓝
    if (label.indexOf('未缓存') >= 0 || label.indexOf('输入') >= 0) {
      return '#8E8E93';
    }
    if (label.indexOf('读取') >= 0) {
      return '#AF7AE1';
    }
    if (label.indexOf('输出') >= 0) {
      return '#3B82F6';
    }
    return '';
  }

  /** 彩条可用宽度（232 - 左右 padding 24*2） */
  private static readonly CTX_BAR_WIDTH: number = 184;
  /** 每个非零分段的最小可见宽度：占比再小也要留一块，避免「工具定义」这类极小分段整段消失 */
  private static readonly CTX_BAR_MIN_BLOCK: number = 3;

  private ctxSegFraction(which: string): number {
    if (which === 'system') {
      return Math.max(0, this.ctxSystemPct);
    }
    if (which === 'tools') {
      return Math.max(0, this.ctxToolsPct);
    }
    return Math.max(0, this.ctxMsgPct);
  }

  /**
   * 三段颜色块的显示宽度。
   * 已用比例 = 三段之和（相对上下文窗口），已用部分再按占比分配，并给每个非零分段保底最小块，
   * 返回 [系统, 工具, 对话, 底轨]；全是 0 时只返回底轨满宽。
   */
  private ctxBarWidths(): number[] {
    const avail: number = ConversationComposer.CTX_BAR_WIDTH;
    const system: number = this.ctxSegFraction('system');
    const tools: number = this.ctxSegFraction('tools');
    const messages: number = this.ctxSegFraction('messages');
    const used: number = Math.min(1, system + tools + messages);
    if (used <= 0) {
      return [0, 0, 0, avail];
    }
    const filled: number = avail * used;
    const parts: number[] = [system, tools, messages];
    let visible: number = 0;
    for (const part of parts) {
      if (part > 0) {
        visible++;
      }
    }
    const minTotal: number = ConversationComposer.CTX_BAR_MIN_BLOCK * visible;
    const tail: number = filled > minTotal ? filled - minTotal : 0;
    const widths: number[] = [0, 0, 0, Math.max(0, avail - filled)];
    for (let index = 0; index < parts.length; index++) {
      if (parts[index] <= 0) {
        continue;
      }
      const share: number = (parts[index] / (system + tools + messages)) * tail;
      widths[index] = ConversationComposer.CTX_BAR_MIN_BLOCK + share;
    }
    return widths;
  }

  /** 上下文标题下的彩色用量条：按 系统/工具/消息 三段铺满已用部分，剩余为底轨 */
  @Builder
  contextBarRow() {
    Row() {
      Row() {
        if (this.ctxBarWidths()[0] > 0) {
          Row()
            .height(4)
            .width(this.ctxBarWidths()[0])
            .backgroundColor('#8E8E93')
        }
        if (this.ctxBarWidths()[1] > 0) {
          Row()
            .height(4)
            .width(this.ctxBarWidths()[1])
            .backgroundColor('#AF7AE1')
        }
        if (this.ctxBarWidths()[2] > 0) {
          Row()
            .height(4)
            .width(this.ctxBarWidths()[2])
            .backgroundColor('#3B82F6')
        }
        Row()
          .height(4)
          .layoutWeight(1)
          .backgroundColor(Color.Transparent)
      }
      .width('100%')
      .height(4)
      .borderRadius(2)
      .clip(true)
      .backgroundColor(this.menuSeparator())
    }
    .width(232)
    .height(18)
    .padding({ left: 24, right: 24 })
    .alignItems(VerticalAlign.Center)
  }

  /** 指标弹层数据行：名称在左（系统菜单字色），数值在右（次级色） */
  @Builder
  metricRow(label: string, value: string, dotColor: string) {
    Row({ space: 7 }) {
      // 上下文分项前的颜色小方块（其余弹层传空串不渲染）
      if (dotColor.length > 0) {
        Row()
          .width(8)
          .height(8)
          .borderRadius(2)
          .backgroundColor(dotColor)
      }
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
        MenuItem(this.metricHeaderRow('run', '会话统计')).enabled(false)
        ForEach(this.metricPairsFor('run'), (pair: MetricMenuPair) => {
          MenuItem(this.metricRow(pair.label, pair.value, ''))
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
        MenuItem(this.metricHeaderRow('token', 'Token 用量')).enabled(false)
        ForEach(this.metricPairsFor('token'), (pair: MetricMenuPair) => {
          MenuItem(this.metricRow(pair.label, pair.value, ''))
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
        MenuItem(this.metricHeaderRow('context', '上下文已用')).enabled(false)
        MenuItem(this.contextBarRow()).enabled(false)
        ForEach(this.metricPairsFor('context'), (pair: MetricMenuPair) => {
          MenuItem(this.metricRow(pair.label, pair.value, this.segmentColor(pair.label)))
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
        if (this.hasQuote()) {
          this.quoteCard()
        }
        if (this.hasPlainRef()) {
          this.refChipsRow()
        }
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
                this.attachMenuOpen = !this.attachMenuOpen;
              }
            })
            .bindMenu(this.attachMenuOpen, this.attachMenuPanel(), {
              placement: Placement.TopLeft,
              offset: { x: 0, y: 4 },
              outlineColor: this.cardEdge(),
              outlineWidth: 1,
              onDisappear: () => {
                this.attachMenuOpen = false;
              }
            })
            // 文字区 + 语音触摸层（对齐小程序 .voice-touch-surface：
            // 单独一层覆盖在文字区上接收长按滑动，而不是依赖文字节点自身的触摸）
            Stack({ alignContent: Alignment.Start }) {
            // 折叠态占位：小程序 28rpx≈14vp、行高 1.4、垂直居中
            Text(this.voiceRecording ? this.voiceHint
              : (this.voiceEnabled && this.voiceMode ? '按住说话' : this.placeholder))
              .fontSize(this.voiceRecording ? 13 : 14)
              .lineHeight(this.voiceRecording ? 18 : 20)
              .fontColor(this.voiceCancelArmed ? '#D9413A' : this.collapsedPlaceholderColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
            // 折叠态默认就挂语音触摸层（对齐小程序 voice-touch-surface 的可见条件）：
            // 不必先点麦克风，直接在占位区按住就能说话；轻点仍然展开去打字。
            if (this.voiceEnabled) {
              Column()
                .width('100%')
                .height('100%')
                .backgroundColor('#00000000')
                .onTouch((event: TouchEvent) => this.onVoiceTouch(event))
            }
            }
            .layoutWeight(1)
            .height(36)
            .alignContent(Alignment.Start)
              .onClick(() => {
                // 长按已经被当成录音：吞掉这次点击，不要再展开输入框
                if (this.voiceHoldConsumed) {
                  this.voiceHoldConsumed = false;
                  return;
                }
                // 录音中（或刚松手等待识别）也不展开
                if (this.voiceRecording) {
                  return;
                }
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
                // 和小程序同一套图标：文字态 voice-wave.svg（五根波形条，点了切到语音），
                // 语音态 voice-keyboard.svg（点了切回文字）。inline 尺寸 36rpx≈18vp。
                Image(this.voiceMode ? $r('app.media.voice_keyboard') : $r('app.media.voice_wave'))
                  .width(18)
                  .height(18)
                  .objectFit(ImageFit.Contain)
                  .draggable(false)
                  .syncLoad(true)
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
          // 录音特效已经移到全屏 VoiceRipplePanel：折叠条保持 36，不再为波纹加高
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
      // 对齐小程序 .composer：展开 28/28/24rpx = 14/14/12vp；折叠 12/20rpx = 6/10vp
      .padding(this.expanded()
        ? { left: 14, right: 14, top: 12, bottom: 12 }
        : { left: 10, right: 10, top: 6, bottom: 6 })
      // 首页「切换主机」半模态的观感：背景模糊 + 玻璃上叠淡白的半透明底 + 白色细描边；圆角 24
      // （ImmersiveMaterial 只能在 bindSheet 的 systemMaterial 上生效，普通容器用模糊 + 半透明底等价逼近）
      .borderRadius(24)
      // 沉浸光感：不再自己画模糊，交给系统 ImmersiveMaterial（API 26，应用级开关已在 module.json5 打开）
      .backgroundColor(this.glassMaterial() === undefined
        ? (this.isDark ? 'rgba(30,30,34,0.72)' : 'rgba(255,255,255,0.72)')
        : Color.Transparent)
      .systemMaterial(this.glassMaterial())
      // 材质自带高光/阴影，这里只留一条极细的边界，避免叠出「白框」
      .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.75)' })
      // 裁到圆角：顶沿高光只亮在卡片内部
      .clip(true)
      // 光感：顶沿一道很淡的受光边（系统材质之外的点缀，不抢材质本身的观感）
      .overlay(() => { this.topGlint() }, { align: Alignment.Top })

      }
      .width('100%')
      // 光圈层：统一 1.3vp 白环（深/浅色同一厚度，细而可见）
      .padding(1.3)
      .borderRadius(25.3)
      // 光圈层不要再用白色底：白底会透在卡片下面，把输入框「垫」得比返回按钮更实
      .backgroundColor(Color.Transparent)
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
