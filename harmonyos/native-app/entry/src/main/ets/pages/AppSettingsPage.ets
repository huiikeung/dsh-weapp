import { KeyboardAvoidMode } from '@kit.ArkUI';
import { bundleManager, common } from '@kit.AbilityKit';
import type { ThemeMode, WorkStepOption } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';
import { Haptics } from '../services/Haptics';
import { AttachmentCache, CredentialStore, GatewayClient, Logger, NotificationService, PreferencesStore, SessionStore, SessionSummary, ThemeManager, WorkStepPresentation, WorkspaceRow } from 'nativecore';

/**
 * 工作步骤档位文案：作为独立组件直接订阅 AppStorage，
 * 二级选择页写入后这个 Text 一定会自己重绘（不依赖父页面的 @Builder 参数是否重算）。
 */
@Component
struct WorkStepValueText {
  @Prop kind: string = 'mode';
  @Prop textColor: string = '';
  @StorageProp('workStepMode') workStepMode: string = 'reading';
  @StorageProp('workStepTiming') workStepTiming: string = 'completion';

  build() {
    Text(this.kind === 'mode'
      ? WorkStepPresentation.modeLabel(this.workStepMode)
      : WorkStepPresentation.timingLabel(this.workStepTiming))
      .fontSize(15)
      .fontColor(this.textColor)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .constraintSize({ maxWidth: 200 })
  }
}

/**
 * 设置行右侧值：独立组件直接订阅 AppStorage，二级页写入后自己重绘
 * （与 WorkStepValueText 同一思路，覆盖外观/状态条/执行图标/语言/震动/字号）。
 */
@Component
struct PrefValueText {
  @Prop kind: string = '';
  @Prop textColor: string = '';
  @StorageProp('appearanceMode') appearanceMode: string = 'auto';
  @StorageProp('statusAppearance') statusAppearance: string = 'original';
  @StorageProp('procIconStyle') procIconStyle: string = 'default';
  @StorageProp('appLanguage') appLanguage: string = 'system';
  @StorageProp('hapticsLevel') hapticsLevel: string = 'medium';
  @StorageProp('contentFontSize') contentFontSize: string = '标准';
  @StorageProp('clawbotStatusSummary') clawbotStatusSummary: string = '未读取';

  private pick(ids: string[], labels: string[], id: string): string {
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === id) {
        return labels[i];
      }
    }
    return labels.length > 0 ? labels[0] : '';
  }

  private label(): string {
    if (this.kind === 'appearance') {
      return this.pick(['auto', 'light', 'dark'], ['跟随系统', '浅色', '深色'], this.appearanceMode);
    }
    if (this.kind === 'status') {
      return this.pick(['dsh', 'classic', 'neon', 'terminal', 'candy', 'glitch', 'original'],
        ['DSH 默认', '经典流光', '霓虹', '终端', '糖果', '故障', '简约'], this.statusAppearance);
    }
    if (this.kind === 'procion') {
      return this.pick(['default', 'spin-ring', 'terra', 'morph', 'grid', 'orbit', 'ripple', 'wave', 'pulse-ring', 'breathe-bars', 'spin-square', 'typing-dots', 'scan-line'],
        ['默认', '旋转圆环', '思考球', '变形方', '点阵', '轨道', '波纹', '声波', '脉冲环', '呼吸条', '旋方', '打字点', '扫描线'], this.procIconStyle);
    }
    if (this.kind === 'language') {
      return this.pick(['system', 'zh', 'en'], ['跟随系统', '简体中文', 'English'], this.appLanguage);
    }
    if (this.kind === 'haptics') {
      return this.pick(['off', 'light', 'medium', 'heavy'], ['关闭', '轻', '中', '重'], this.hapticsLevel);
    }
    if (this.kind === 'fontsize') {
      return this.contentFontSize;
    }
    if (this.kind === 'clawbot') {
      return this.clawbotStatusSummary;
    }
    return '';
  }

  build() {
    Text(this.label())
      .fontSize(15)
      .fontColor(this.textColor)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .constraintSize({ maxWidth: 200 })
  }
}

/**
 * 设置（左侧栏「设置」）：逐行对齐小程序 pages/settings。
 * 分组顺序：连接 → 外观 → 通用设置 → 对话 → 实验性功能 → 关于（逐行对齐 settings.wxml）。
 * 无原生数据源的行在本页用 AppStorage（小写驼峰键）保存开关，并同步 PreferencesStore 持久化。
 */
@Component
export struct AppSettingsPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('themeMode') themeMode: string = 'dark';
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('gatewayName') gatewayName: string = '';
  @StorageLink('transportKind') transportKind: string = '';
  @StorageLink('publicAccessState') publicAccessState: string = '';
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('workspaces') workspaces: WorkspaceRow[] = [];
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('gatewayVersion') gatewayVersion: string = '';
  @StorageLink('pluginBundles') pluginBundles: Object[] = [];
  @StorageLink('scheduleTasks') scheduleTasks: Object[] = [];

  // ── 对齐小程序的本地偏好：AppStorage 键名小写驼峰，PreferencesStore 持久化 ──
  @StorageLink('settingsGlassEnabled') settingsGlassEnabled: boolean = true;
  @StorageLink('sessionGlassEnabled') sessionGlassEnabled: boolean = true;
  @StorageLink('bottomSheetGlassEnabled') bottomSheetGlassEnabled: boolean = true;
  @StorageLink('homeAnimationEnabled') homeAnimationEnabled: boolean = true;
  @StorageLink('voiceInputEnabled') voiceInputEnabled: boolean = true;
  @StorageLink('showAccountCard') showAccountCard: boolean = false;
  /** 会话节点胶囊：默认展开显示（关闭则默认收起成贴边把手） */
  @StorageLink('capsuleDefaultExpanded') capsuleDefaultExpanded: boolean = false;
  /** 胶囊常显：关闭后会话页不再显示侧边胶囊 */
  @StorageLink('capsuleAlwaysVisible') capsuleAlwaysVisible: boolean = true;
  @StorageLink('notifyEnabled') notifyEnabled: boolean = false;
  @StorageLink('clawbotBridgeEnabled') clawbotBridgeEnabled: boolean = false;
  @StorageLink('appLanguage') appLanguage: string = 'system';
  @StorageLink('appearanceMode') appearanceMode: string = 'auto';
  @StorageLink('statusAppearance') statusAppearance: string = 'original';
  @StorageLink('procIconStyle') procIconStyle: string = 'default';
  /** 二级页回传的选择（kind\u0001id），@Watch 复用 applyOptionChoice */
  @StorageLink('prefPickerChoice') @Watch('onPrefPickerChoice') prefPickerChoice: string = '';

  @State fontSize: string = '标准';
  @State haptics: string = 'medium';
  @State textFont: string = '';
  @State codeFont: string = '';
  @State terminalFont: string = '';
  @State codeSize: string = '';
  @State terminalSize: string = '';
  @State hint: string = '';
  @State notificationHint: string = '';
  @State appVersion: string = '1.0.2';
  // 直接绑 AppStorage：选择页（PreferencePickerPage）写 AppStorage 后，本页行文案立刻刷新，
  // 不依赖返回时的 @Watch/onShown 是否触发。
  @StorageProp('workStepMode') @Watch('onWorkStepStorage') workStepMode: string = 'reading';
  @StorageProp('workStepTiming') @Watch('onWorkStepStorage') workStepTiming: string = 'completion';
  /** 选择页写入后递增：用作「偏好已变化」的可靠信号，让本页行文案立即刷新 */
  @StorageProp('prefPickerRevision') @Watch('onPickerRevision') prefPickerRevision: number = 0;
  /** 行文案镜像（@State），避免 @Builder 参数不随 @StorageProp 重算 */
  @State workStepLabel: string = '详细';
  @State workStepTimingLabel: string = '回答结束后';
  @State glassStylePreset: string = 'glass-default';
  @State nativeStylePreset: string = 'default';
  @State cardStylePreset: string = 'float';

  // 页内轻量弹层（复用半模态写法）
  @State pickerOpen: boolean = false;
  @State pickerKind: string = '';
  @State pickerTitle: string = '';
  @State pickerSubtitle: string = '';
  @State fontSheetOpen: boolean = false;
  @State infoOpen: boolean = false;
  @State infoTitle: string = '';
  @State infoText: string = '';

  // 连接相关弹层（保留公网访问 / 公网权限）
  @State connectionSheetOpen: boolean = false;
  @State connectionSheetKind: string = '';
  @State connectionHint: string = '';

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private cardBg(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : '#FFFFFF';
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private chipBg(selected: boolean): string {
    if (selected) {
      return this.isDark ? 'rgba(76,108,224,0.24)' : 'rgba(76,108,224,0.12)';
    }
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.04)';
  }

  private chipBorder(selected: boolean): string {
    return selected ? 'rgba(76,108,224,0.55)' : this.dividerColor();
  }

  private innerFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)';
  }

  private faintColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.40)' : 'rgba(16,19,24,0.40)';
  }

  aboutToAppear(): void {
    const prefs: PreferencesStore = PreferencesStore.get();
    this.fontSize = prefs.getString('contentFontSize', '标准');
    this.haptics = this.normalizeHaptics(prefs.getString('hapticsLevel', 'medium'));
    const storedMode: string = WorkStepPresentation.ensureDefaultMode(prefs);
    const storedTiming: string = WorkStepPresentation.normalizeTiming(prefs.getString(WorkStepPresentation.TIMING_KEY, 'completion'));
    AppStorage.setOrCreate<string>('workStepMode', storedMode);
    AppStorage.setOrCreate<string>('workStepTiming', storedTiming);
    this.workStepMode = storedMode;
    this.workStepTiming = storedTiming;
    this.syncWorkStepLabels();
    this.textFont = prefs.getString('fontFamilyText', '');
    this.codeFont = prefs.getString('fontFamilyCode', '');
    this.terminalFont = prefs.getString('fontFamilyTerminal', '');
    this.codeSize = prefs.getString('codeFontSize', '');
    this.terminalSize = prefs.getString('terminalFontSize', '');

    this.settingsGlassEnabled = prefs.getBoolean('settingsGlassEnabled', true);
    this.sessionGlassEnabled = prefs.getBoolean('sessionGlassEnabled', true);
    this.bottomSheetGlassEnabled = prefs.getBoolean('bottomSheetGlassEnabled', true);
    this.homeAnimationEnabled = prefs.getBoolean('homeAnimationEnabled', true);
    this.voiceInputEnabled = prefs.getBoolean('voiceInputEnabled', true);
    this.showAccountCard = prefs.getBoolean('showAccountCard', false);
    this.capsuleDefaultExpanded = prefs.getBoolean('capsuleDefaultExpanded', false);
    this.capsuleAlwaysVisible = prefs.getBoolean('capsuleAlwaysVisible', true);
    this.notifyEnabled = prefs.getBoolean('notifyEnabled', false);
    this.clawbotBridgeEnabled = prefs.getBoolean('clawbotBridgeEnabled', false);
    if (AppStorage.get<string>('clawbotStatusSummary') === undefined) {
      AppStorage.setOrCreate<string>('clawbotStatusSummary', '未读取');
    }
    this.appLanguage = prefs.getString('appLanguage', 'system');
    const storedAppearance: string = prefs.getString('appearanceMode', '');
    if (storedAppearance.length > 0) {
      this.appearanceMode = storedAppearance;
    } else {
      this.appearanceMode = this.themeMode === 'light' ? 'light' : (this.themeMode === 'dark' ? 'dark' : 'auto');
    }
    this.statusAppearance = prefs.getString('statusAppearance', 'original');
    this.procIconStyle = prefs.getString('procIconStyle', 'default');
    this.glassStylePreset = prefs.getString('glassStylePreset', 'glass-default');
    this.nativeStylePreset = prefs.getString('nativeStylePreset', 'default');
    this.cardStylePreset = prefs.getString('cardStylePreset', 'float');
    this.appVersion = this.readAppVersion();
    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (ignored) {
    }
  }

  /**
   * 从二级页返回时刷新所有卡片右侧的值。
   * 二级页保存后父页不会自动重渲染，这里统一按偏好重读一遍（与「工作步骤展示」
   * 独立订阅 AppStorage 的做法等价，但覆盖全部行）。
   */
  private refreshPrefs(): void {
    const prefs: PreferencesStore = PreferencesStore.get();
    this.fontSize = prefs.getString('contentFontSize', this.fontSize);
    this.haptics = this.normalizeHaptics(prefs.getString('hapticsLevel', this.haptics));
    const storedMode: string = WorkStepPresentation.ensureDefaultMode(prefs);
    const storedTiming: string = WorkStepPresentation.normalizeTiming(prefs.getString(WorkStepPresentation.TIMING_KEY, this.workStepTiming));
    AppStorage.setOrCreate<string>('workStepMode', storedMode);
    AppStorage.setOrCreate<string>('workStepTiming', storedTiming);
    this.workStepMode = storedMode;
    this.workStepTiming = storedTiming;
    this.textFont = prefs.getString('fontFamilyText', this.textFont);
    this.codeFont = prefs.getString('fontFamilyCode', this.codeFont);
    this.terminalFont = prefs.getString('fontFamilyTerminal', this.terminalFont);
    this.codeSize = prefs.getString('codeFontSize', this.codeSize);
    this.terminalSize = prefs.getString('terminalFontSize', this.terminalSize);
    this.settingsGlassEnabled = prefs.getBoolean('settingsGlassEnabled', this.settingsGlassEnabled);
    this.sessionGlassEnabled = prefs.getBoolean('sessionGlassEnabled', this.sessionGlassEnabled);
    this.bottomSheetGlassEnabled = prefs.getBoolean('bottomSheetGlassEnabled', this.bottomSheetGlassEnabled);
    this.homeAnimationEnabled = prefs.getBoolean('homeAnimationEnabled', this.homeAnimationEnabled);
    this.voiceInputEnabled = prefs.getBoolean('voiceInputEnabled', this.voiceInputEnabled);
    this.capsuleDefaultExpanded = prefs.getBoolean('capsuleDefaultExpanded', this.capsuleDefaultExpanded);
    this.capsuleAlwaysVisible = prefs.getBoolean('capsuleAlwaysVisible', this.capsuleAlwaysVisible);
    this.notifyEnabled = prefs.getBoolean('notifyEnabled', this.notifyEnabled);
    this.clawbotBridgeEnabled = prefs.getBoolean('clawbotBridgeEnabled', this.clawbotBridgeEnabled);
    this.appLanguage = prefs.getString('appLanguage', this.appLanguage);
    const storedAppearance: string = prefs.getString('appearanceMode', '');
    if (storedAppearance.length > 0) {
      this.appearanceMode = storedAppearance;
    }
    this.statusAppearance = prefs.getString('statusAppearance', this.statusAppearance);
    this.procIconStyle = prefs.getString('procIconStyle', this.procIconStyle);
    this.glassStylePreset = prefs.getString('glassStylePreset', this.glassStylePreset);
    this.nativeStylePreset = prefs.getString('nativeStylePreset', this.nativeStylePreset);
    this.cardStylePreset = prefs.getString('cardStylePreset', this.cardStylePreset);
  }

  /** 兼容旧版按中文保存的震动档位，统一成小程序档位 id。 */
  private normalizeHaptics(value: string): string {
    if (value === '关闭' || value === 'off') {
      return 'off';
    }
    if (value === '轻' || value === 'light') {
      return 'light';
    }
    if (value === '强' || value === 'heavy') {
      return 'heavy';
    }
    return 'medium';
  }

  private readAppVersion(): string {
    try {
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      return info.versionName.length > 0 ? info.versionName : '1.0.2';
    } catch (err) {
      return '1.0.2';
    }
  }

  // ── 分组标题 / 行 / 分隔线：沿用页面既有风格 ──

  /** 分组标题：字号/字重/缩进与「会话设置」「Tailscale 内嵌隧道」页一致 */
  @Builder
  groupTitle(title: string) {
    Text(title)
      .fontSize(13)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 16, right: 16, top: 18, bottom: 7 })
  }

  @Builder
  groupHint(text: string) {
    Text(text)
      .fontSize(12.5)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 8, top: 8 })
  }

  /** 值 / 箭头行（对齐小程序 card-row） */
  @Builder
  row(label: string, value: string, chevron: boolean, onTap: () => void) {
    Row() {
      Text(label).fontSize(16).fontColor(this.textColor())
      Blank()
      Row({ space: 6 }) {
        Text(value)
          .fontSize(15)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 200 })
        if (chevron) {
          Text('›').fontSize(18).fontColor(this.subColor())
        }
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 15, bottom: 15 })
    .onClick(onTap)
  }

  /** 值行：右侧用 PrefValueText 独立订阅，选择后立即刷新 */
  @Builder
  rowPref(label: string, kind: string, onTap: () => void) {
    Row() {
      Text(label).fontSize(16).fontColor(this.textColor())
      Blank()
      Row({ space: 6 }) {
        PrefValueText({ kind: kind, textColor: this.subColor() })
        Text('›').fontSize(18).fontColor(this.subColor())
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 15, bottom: 15 })
    .onClick(onTap)
  }

  /** 标题 + 说明 + 独立订阅值 */
  @Builder
  rowDescPref(label: string, desc: string, kind: string, onTap: () => void) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(16).fontColor(this.textColor())
        if (desc.length > 0) {
          Text(desc).fontSize(12).fontColor(this.subColor())
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Row({ space: 6 }) {
        PrefValueText({ kind: kind, textColor: this.subColor() })
        Text('›').fontSize(18).fontColor(this.subColor())
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 13, bottom: 13 })
    .onClick(onTap)
  }

  /** 工作步骤档位行：值文案用独立组件渲染，保证选择后立即刷新 */
  @Builder
  rowWorkStep(label: string, desc: string, kind: string, onTap: () => void) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(16).fontColor(this.textColor())
        if (desc.length > 0) {
          Text(desc).fontSize(12).fontColor(this.subColor())
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Row({ space: 6 }) {
        WorkStepValueText({ kind: kind, textColor: this.subColor() })
        Text('›').fontSize(18).fontColor(this.subColor())
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 13, bottom: 13 })
    .onClick(onTap)
  }

  /** 标题 + 说明 + 值 / 箭头行 */
  @Builder
  rowDesc(label: string, desc: string, value: string, chevron: boolean, onTap: () => void) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(16).fontColor(this.textColor())
        if (desc.length > 0) {
          Text(desc).fontSize(12).fontColor(this.subColor())
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Row({ space: 6 }) {
        Text(value)
          .fontSize(15)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 200 })
        if (chevron) {
          Text('›').fontSize(18).fontColor(this.subColor())
        }
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 13, bottom: 13 })
    .onClick(onTap)
  }

  /** 开关行（系统 Toggle，开启色 #2E6BE6） */
  @Builder
  toggleRow(label: string, desc: string, isOn: boolean, onChanged: (value: boolean) => void) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(16).fontColor(this.textColor())
        if (desc.length > 0) {
          Text(desc).fontSize(12).fontColor(this.subColor())
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Toggle({ type: ToggleType.Switch, isOn: isOn })
        .selectedColor('#2E6BE6')
        .onChange((value: boolean) => {
          onChanged(value);
        })
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
  }

  /**
   * 子设置行：嵌在父开关下面。
   * 样式：左侧 2vp 引导线（缩进 24，从属感）+ 标题比父项小一号（15）+ 描述小一号（12）+ 开关略缩；
   * 与父行之间用同款 divider 分隔，不额外加背景，保持设置页整体干净。
   */
  @Builder
  subToggleRow(label: string, desc: string, isOn: boolean, onChanged: (value: boolean) => void) {
    Row() {
      Column()
        .width(2)
        .height(30)
        .borderRadius(1)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.14)' : 'rgba(16,19,24,0.10)')
        .margin({ left: 24, right: 12 })
      Column({ space: 2 }) {
        Text(label).fontSize(15).fontColor(this.textColor())
        if (desc.length > 0) {
          Text(desc).fontSize(12).fontColor(this.subColor())
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Toggle({ type: ToggleType.Switch, isOn: isOn })
        .selectedColor('#2E6BE6')
        .scale({ x: 0.9, y: 0.9 })
        .onChange((value: boolean) => {
          onChanged(value);
        })
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 0, right: 16, top: 10, bottom: 12 })
  }

  @Builder
  divider() {
    Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
  }

  @Builder
  chip(label: string, selected: boolean, onTap: () => void) {
    Text(label)
      .fontSize(14)
      .fontWeight(selected ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(selected ? '#2E6BE6' : this.textColor())
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })
      .borderRadius(999)
      .backgroundColor(this.chipBg(selected))
      .border({ width: 1, color: this.chipBorder(selected) })
      .onClick(onTap)
  }

  @Builder
  fontRow(label: string, hint: string, value: string, role: string) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(16).fontColor(this.textColor())
        Text(hint).fontSize(12).fontColor(this.subColor())
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      TextInput({ text: value, placeholder: '默认' })
        .caretStyle({ width: 1 })
        .width(120)
        .height(34)
        .fontSize(12)
        .fontColor(this.textColor())
        .placeholderColor(this.subColor())
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.05)')
        .borderRadius(8)
        .onChange((v: string) => {
          if (role === 'text') {
            this.textFont = v;
            PreferencesStore.get().putString('fontFamilyText', v);
          } else if (role === 'code') {
            this.codeFont = v;
            PreferencesStore.get().putString('fontFamilyCode', v);
          } else if (role === 'terminal') {
            this.terminalFont = v;
            PreferencesStore.get().putString('fontFamilyTerminal', v);
          } else if (role === 'codeSize') {
            this.codeSize = v;
            PreferencesStore.get().putString('codeFontSize', v);
          } else {
            this.terminalSize = v;
            PreferencesStore.get().putString('terminalFontSize', v);
          }
        })
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 12, bottom: 12 })
  }

  // ── 选项数据（与小程序同名选项）──

  private optionIdsOf(kind: string): string[] {
    if (kind === 'appearance') {
      return ['auto', 'light', 'dark'];
    }
    if (kind === 'status') {
      return ['dsh', 'classic', 'neon', 'terminal', 'candy', 'glitch', 'original'];
    }
    if (kind === 'procion') {
      return ['default', 'spin-ring', 'terra', 'morph', 'grid', 'orbit', 'ripple', 'wave', 'pulse-ring', 'breathe-bars', 'spin-square', 'typing-dots', 'scan-line'];
    }
    if (kind === 'language') {
      return ['system', 'zh', 'en'];
    }
    if (kind === 'mode') {
      const ids: string[] = [];
      for (const option of WorkStepPresentation.modes()) {
        ids.push(option.id);
      }
      return ids;
    }
    if (kind === 'timing') {
      const ids: string[] = [];
      for (const option of WorkStepPresentation.timings()) {
        ids.push(option.id);
      }
      return ids;
    }
    if (kind === 'haptics') {
      return ['off', 'light', 'medium', 'heavy'];
    }
    if (kind === 'glass') {
      return ['glass-default', 'glass-clear', 'glass-frosted', 'glass-dark'];
    }
    if (kind === 'native') {
      return ['default', 'dim', 'darker', 'bright', 'brightest'];
    }
    if (kind === 'card') {
      return ['float', 'plain', 'compact'];
    }
    return [];
  }

  private optionLabelsOf(kind: string): string[] {
    if (kind === 'appearance') {
      return ['跟随系统', '浅色', '深色'];
    }
    if (kind === 'status') {
      return ['DSH 默认', '经典流光', '霓虹', '终端', '糖果', '故障', '简约'];
    }
    if (kind === 'procion') {
      return ['默认', '旋转圆环', '思考球', '变形方', '点阵', '轨道', '波纹', '声波', '脉冲环', '呼吸条', '旋方', '打字点', '扫描线'];
    }
    if (kind === 'language') {
      return ['跟随系统', '简体中文', 'English'];
    }
    if (kind === 'mode') {
      const labels: string[] = [];
      for (const option of WorkStepPresentation.modes()) {
        labels.push(option.label);
      }
      return labels;
    }
    if (kind === 'timing') {
      const labels: string[] = [];
      for (const option of WorkStepPresentation.timings()) {
        labels.push(option.label);
      }
      return labels;
    }
    if (kind === 'haptics') {
      return ['关闭', '轻', '中', '重'];
    }
    if (kind === 'glass') {
      return ['默认玻璃', '通透玻璃', '磨砂玻璃', '深色玻璃'];
    }
    if (kind === 'native') {
      return ['默认', '偏暗', '更暗', '偏亮', '最亮'];
    }
    if (kind === 'card') {
      return ['悬浮卡片', '平面卡片', '紧凑卡片'];
    }
    return [];
  }

  private labelOf(kind: string, id: string): string {
    const ids: string[] = this.optionIdsOf(kind);
    const labels: string[] = this.optionLabelsOf(kind);
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === id) {
        return labels[i];
      }
    }
    return labels.length > 0 ? labels[0] : '';
  }

  private currentOptionId(): string {
    const kind: string = this.pickerKind;
    if (kind === 'appearance') {
      return this.appearanceMode;
    }
    if (kind === 'status') {
      return this.statusAppearance;
    }
    if (kind === 'procion') {
      return this.procIconStyle;
    }
    if (kind === 'language') {
      return this.appLanguage;
    }
    if (kind === 'mode') {
      return this.workStepMode;
    }
    if (kind === 'timing') {
      return this.workStepTiming;
    }
    if (kind === 'haptics') {
      return this.haptics;
    }
    if (kind === 'glass') {
      return this.glassStylePreset;
    }
    if (kind === 'native') {
      return this.nativeStylePreset;
    }
    if (kind === 'card') {
      return this.cardStylePreset;
    }
    return '';
  }

  private optionIds(): string[] {
    return this.optionIdsOf(this.pickerKind);
  }

  private optionLabels(): string[] {
    return this.optionLabelsOf(this.pickerKind);
  }

  private pickerTitleFor(kind: string): string {
    if (kind === 'appearance') {
      return '外观';
    }
    if (kind === 'status') {
      return '对话状态条';
    }
    if (kind === 'procion') {
      return '执行图标';
    }
    if (kind === 'language') {
      return '语言';
    }
    if (kind === 'mode') {
      return '工作步骤展示';
    }
    if (kind === 'timing') {
      return '工作步骤收起时机';
    }
    if (kind === 'haptics') {
      return '震动反馈';
    }
    if (kind === 'glass') {
      return '玻璃样式设置';
    }
    if (kind === 'native') {
      return '原生样式设置';
    }
    if (kind === 'card') {
      return '卡片样式设置';
    }
    return '';
  }

  private pickerSubtitleFor(kind: string): string {
    if (kind === 'appearance') {
      return '跟随系统';
    }
    if (kind === 'status') {
      return '对话页运行指示（鲸尾+流光）的配色循环';
    }
    if (kind === 'procion') {
      return '选择执行图标动效';
    }
    if (kind === 'language') {
      return '选择界面语言';
    }
    if (kind === 'mode') {
      return '选择希望看到多少工具调用细节';
    }
    if (kind === 'timing') {
      return '选择何时自动收起工作步骤';
    }
    if (kind === 'haptics') {
      return '点击与滑动时的震动强度，全局生效。';
    }
    if (kind === 'glass') {
      return '调整设置页玻璃的透明度与模糊';
    }
    if (kind === 'native') {
      return '不使用玻璃时设置页的底色强度';
    }
    if (kind === 'card') {
      return '调整会话卡片的悬浮高度与圆角';
    }
    return '';
  }

  /** 二级页选择回调：应用选择并清空回传值 */
  private onPrefPickerChoice(): void {
    const raw: string = this.prefPickerChoice;
    if (raw.length === 0) {
      return;
    }
    this.prefPickerChoice = '';
    const sep: number = raw.indexOf('\u0001');
    if (sep <= 0) {
      return;
    }
    const kind: string = raw.substring(0, sep);
    const id: string = raw.substring(sep + 1);
    this.pickerKind = kind;
    this.applyOptionChoice(id);
  }

  /** 兜底消费二级页选择（@StorageLink 的 @Watch 在部分生命周期下可能不触发） */
  private consumePickerChoice(): void {
    const raw: string = AppStorage.get<string>('prefPickerChoice') ?? '';
    if (raw.length === 0) {
      return;
    }
    AppStorage.setOrCreate<string>('prefPickerChoice', '');
    const sep: number = raw.indexOf('\u0001');
    if (sep <= 0) {
      return;
    }
    const kind: string = raw.substring(0, sep);
    const id: string = raw.substring(sep + 1);
    this.pickerKind = kind;
    this.applyOptionChoice(id);
  }

  /** 打开设置项二级页（不再用页内弹层） */
  private openPicker(kind: string): void {
    this.closeSheets();
    this.pickerKind = kind;
    AppStorage.setOrCreate<string>('prefPickerKind', kind);
    AppStorage.setOrCreate<string>('prefPickerValue', this.currentOptionId());
    this.pageStack.pushPathByName('pref-picker', null);
  }

  private applyOptionChoice(id: string): void {
    const kind: string = this.pickerKind;
    Logger.info('[SETTINGS] apply kind=' + kind + ' id=' + id);
    if (kind === 'appearance') {
      this.appearanceMode = id;
      PreferencesStore.get().putString('appearanceMode', id);
      this.applyTheme(id === 'light' ? 'light' : (id === 'dark' ? 'dark' : 'system'));
    } else if (kind === 'status') {
      this.statusAppearance = id;
      PreferencesStore.get().putString('statusAppearance', id);
    } else if (kind === 'procion') {
      this.procIconStyle = id;
      PreferencesStore.get().putString('procIconStyle', id);
    } else if (kind === 'language') {
      this.appLanguage = id;
      PreferencesStore.get().putString('appLanguage', id);
    } else if (kind === 'mode') {
      Logger.info('MODE APPLY ' + id);
      this.workStepMode = WorkStepPresentation.normalizeMode(id);
      PreferencesStore.get().putString(WorkStepPresentation.MODE_KEY, this.workStepMode);
      AppStorage.setOrCreate<string>('workStepMode', this.workStepMode);
      this.workStepLabel = WorkStepPresentation.modeLabel(this.workStepMode);
    } else if (kind === 'timing') {
      this.workStepTiming = WorkStepPresentation.normalizeTiming(id);
      PreferencesStore.get().putString(WorkStepPresentation.TIMING_KEY, this.workStepTiming);
      AppStorage.setOrCreate<string>('workStepTiming', this.workStepTiming);
      this.workStepTimingLabel = WorkStepPresentation.timingLabel(this.workStepTiming);
    } else if (kind === 'haptics') {
      this.haptics = id;
      PreferencesStore.get().putString('hapticsLevel', id);
    } else if (kind === 'glass') {
      this.glassStylePreset = id;
      PreferencesStore.get().putString('glassStylePreset', id);
    } else if (kind === 'native') {
      this.nativeStylePreset = id;
      PreferencesStore.get().putString('nativeStylePreset', id);
    } else if (kind === 'card') {
      this.cardStylePreset = id;
      PreferencesStore.get().putString('cardStylePreset', id);
    }
    this.pickerOpen = false;
  }

  /** AppStorage 档位变化：持久化 + 重绘行（选择页直接写 AppStorage 时走这里） */
  onPageShow(): void {
    // 每次都重读偏好：二级页面（字号/字体/玻璃/语言/工作步骤…）改完返回立即同步
    this.refreshPrefs();
    this.syncWorkStepLabels();
  }

  /**
   * 二级页写入后 prefPickerRevision 自增 → 这里立即消费选择并刷新行文案。
   * 不依赖 onShown / @Watch('onPrefPickerChoice')（NavDestination 嵌套时它们不一定触发），
   * 所以从二级页返回前，一级页卡片右侧文字就已经换成新值。
   */
  private onPickerRevision(): void {
    Logger.info('[SETTINGS] revision=' + this.prefPickerRevision.toString()
      + ' choice=' + (AppStorage.get<string>('prefPickerChoice') ?? ''));
    this.consumePickerChoice();
    this.refreshPrefs();
    this.syncWorkStepLabels();
  }

  private syncWorkStepLabels(): void {
    const modeLabel: string = WorkStepPresentation.modeLabel(this.workStepMode);
    const timingLabel: string = WorkStepPresentation.timingLabel(this.workStepTiming);
    Logger.info('[SETTINGS] sync labels mode=' + this.workStepMode + ' label=' + modeLabel + ' state=' + this.workStepLabel);
    if (this.workStepLabel !== modeLabel) {
      this.workStepLabel = modeLabel;
    }
    if (this.workStepTimingLabel !== timingLabel) {
      this.workStepTimingLabel = timingLabel;
    }
  }

  private onWorkStepStorage(): void {
    this.syncWorkStepLabels();
    PreferencesStore.get().putString(WorkStepPresentation.MODE_KEY, this.workStepMode);
    PreferencesStore.get().putString(WorkStepPresentation.TIMING_KEY, this.workStepTiming);
  }

  private closeSheets(): void {
    this.connectionSheetOpen = false;
    this.pickerOpen = false;
    this.fontSheetOpen = false;
    this.infoOpen = false;
  }

  private openInfo(title: string, text: string): void {
    this.closeSheets();
    this.infoTitle = title;
    this.infoText = text;
    this.infoOpen = true;
  }

  /** 打开「字号大小」二级页（原来这里是页内底部弹层） */
  private openFontSizePage(): void {
    this.closeSheets();
    this.pageStack.pushPathByName('font-size', null);
  }

  private openConnectionSheet(kind: string): void {
    this.closeSheets();
    this.connectionSheetKind = kind;
    this.connectionSheetOpen = true;
  }

  // ── 主题 / 字号 / 震动 ──

  private appearanceLabel(): string {
    return this.labelOf('appearance', this.appearanceMode);
  }

  private statusLabel(): string {
    return this.labelOf('status', this.statusAppearance);
  }

  private procIconLabel(): string {
    return this.labelOf('procion', this.procIconStyle);
  }

  private languageLabel(): string {
    return this.labelOf('language', this.appLanguage);
  }

  private hapticsLabel(): string {
    return this.labelOf('haptics', this.haptics);
  }

  /**
   * 切换深浅色：必须走 ThemeManager，它会在写 themeMode 的同时同步刷新
   * AppStorage 的 isDark。以前这里只写 themeMode，isDark 要等系统配色回调
   * 才会变，当前页面因此不会重绘——表现为「切换后颜色不变，退出重进才生效」。
   */
  private applyTheme(mode: string): void {
    this.themeMode = mode;
    ThemeManager.get().setMode(mode as ThemeMode);
  }

  private applyFontSize(value: string): void {
    this.fontSize = value;
    PreferencesStore.get().putString('contentFontSize', value);
    AppStorage.setOrCreate<string>('contentFontSize', value);
  }

  private testVibrate(): void {
    try {
      // 走全局触感：按当前「震动反馈」档位触发，关闭档位时不震
      Haptics.play();
      this.hint = '已触发震动';
    } catch (err) {
      this.hint = '当前设备不支持震动';
    }
  }

  // ── 存储空间 / 通知 ──

  private async sendTestNotification(): Promise<void> {
    Logger.info('notify test start');
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const enabled: boolean = await NotificationService.ensureAuthorized(context);
      Logger.info('notify test authorized=' + enabled);
      if (!enabled) {
        this.notificationHint = '通知未启用：请在系统设置中允许 flukit 通知';
        this.prompt('通知权限未开启，请在系统设置 → 通知中允许 flukit');
        return;
      }
      await NotificationService.ensureHighSlot();
      const sent: boolean = await NotificationService.notifyTaskDone('test-session', '通知测试',
        '如果你看到这条系统通知，说明通知通道已接通；任务完成后会自动发送。');
      Logger.info('notify test sent=' + sent);
      // 5 秒后再发一条：方便用户切到后台验证「横幅」是否只在后台出现
      setTimeout(() => {
        NotificationService.notifyTaskDone('test-session-bg', '后台横幅测试',
          '这条是 5 秒后发送的；如果你已经切到后台，应看到横幅通知。').catch(() => {
        });
      }, 5000);
      this.notificationHint = sent
        ? '测试通知已发送；5 秒后会再发一条后台横幅测试（可先按 Home 切后台）'
        : '测试通知发送失败，请检查系统通知权限';
      this.prompt(sent ? '已发送，5 秒后还有一条后台横幅测试' : '测试通知发送失败（权限或通道异常）');
    } catch (err) {
      Logger.warn('notify test failed: ' + String(err));
      this.notificationHint = '测试通知异常：' + String(err);
      this.prompt('测试通知异常：' + String(err));
    }
  }

  private prompt(message: string): void {
    try {
      this.getUIContext().getPromptAction().showToast({ message: message, duration: 2500 });
    } catch (ignored) {
    }
  }

  private async authorizeNotifications(): Promise<void> {
    const context = getContext(this) as common.UIAbilityContext;
    const enabled: boolean = await NotificationService.ensureAuthorized(context);
    this.notificationHint = enabled ? '通知已启用' : '通知未启用，请在系统设置中允许';
  }

  // ── 连接卡片数据 ──

  private publicValueLabel(): string {
    if (this.connection !== 'connected') {
      return '未连接';
    }
    return this.transportKind === 'relay' ? '公网（中继）' : '局域网直连';
  }

  private connStatusLabel(): string {
    if (this.connection === 'connected') {
      return '已连接';
    }
    if (this.connection === 'connecting') {
      return '连接中';
    }
    if (this.connection === 'failed') {
      return '连接失败';
    }
    return '未连接';
  }

  private connStatusColor(): string {
    if (this.connection === 'connected') {
      return '#2EB85C';
    }
    if (this.connection === 'connecting') {
      return '#FFAE1F';
    }
    if (this.connection === 'failed') {
      return '#E5484D';
    }
    return this.subColor();
  }

  private connStatusFill(): string {
    if (this.connection === 'connected') {
      return 'rgba(46,184,92,0.12)';
    }
    if (this.connection === 'connecting') {
      return 'rgba(255,174,31,0.12)';
    }
    if (this.connection === 'failed') {
      return 'rgba(229,72,77,0.12)';
    }
    return this.innerFill();
  }

  private connSubtitle(): string {
    const parts: string[] = [];
    if (this.transportKind.length > 0) {
      parts.push(this.transportKind);
    }
    parts.push(this.connStatusLabel());
    return parts.join(' · ');
  }

  private nodeCount(): number {
    return CredentialStore.get().list().length;
  }

  @Builder
  connStat(value: string, label: string) {
    Column({ space: 4 }) {
      Text(value)
        .fontSize(18.5)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text(label)
        .fontSize(10.5)
        .fontColor(this.subColor())
        .maxLines(1)
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Center)
  }

  // ── 弹层：选项选择（外观 / 状态条 / 执行图标 / 语言 / 工作步骤 / 震动 / 样式）──

  @Builder
  choiceSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.closeSheets();
        })
      Column({ space: 0 }) {
        Row() {
          Column({ space: 4 }) {
            Text(this.pickerTitle)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.textColor())
            if (this.pickerSubtitle.length > 0) {
              Text(this.pickerSubtitle)
                .fontSize(12)
                .fontColor(this.subColor())
            }
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('✕')
            .fontSize(16)
            .fontColor(this.subColor())
            .padding(8)
            .onClick(() => {
              this.closeSheets();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 14, bottom: 6 })

        Scroll() {
          Column({ space: 0 }) {
            ForEach(this.optionLabels(), (label: string, index: number) => {
              Row() {
                Text(label).fontSize(16).fontColor(this.textColor()).layoutWeight(1)
                if (this.optionIds()[index] === this.currentOptionId()) {
                  Text('✓').fontSize(16).fontColor('#2E6BE6')
                }
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.applyOptionChoice(this.optionIds()[index]);
              })
              if (index < this.optionLabels().length - 1) {
                this.divider()
              }
            }, (label: string) => label)

            if (this.pickerKind === 'haptics') {
              this.divider()
              this.row('测试震动', '', true, () => {
                this.testVibrate();
              })
              if (this.hint.length > 0) {
                Text(this.hint)
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, top: 8 })
              }
            }
          }
          .width('100%')
        }
        .width('100%')
        .constraintSize({ maxHeight: 380 })
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .padding({ top: 6, bottom: 24 })
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(this.pageBg())
    }
    .width('100%')
    .height('100%')
  }

  // ── 弹层：字号大小（保留原有字体与字号设置）──

  @Builder
  fontSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.closeSheets();
        })
      Column({ space: 0 }) {
        Row() {
          Column({ space: 4 }) {
            Text('字号大小').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.textColor())
            Text('仅影响会话内容的字号').fontSize(12).fontColor(this.subColor())
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('✕')
            .fontSize(16)
            .fontColor(this.subColor())
            .padding(8)
            .onClick(() => {
              this.closeSheets();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 14, bottom: 6 })

        Scroll() {
          Column({ space: 0 }) {
            Row({ space: 8 }) {
              ForEach(['小', '标准', '大', '特大'], (size: string) => {
                this.chip(size, this.fontSize === size, () => {
                  this.applyFontSize(size);
                })
              }, (size: string) => size)
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })

            this.divider()
            this.fontRow('正文字体', '用于界面与会话正文', this.textFont, 'text')
            this.divider()
            this.fontRow('代码字体', '用于代码块与工具输出', this.codeFont, 'code')
            this.divider()
            this.fontRow('代码字号', '代码块与工具输出字号', this.codeSize, 'codeSize')
            this.divider()
            this.fontRow('终端字体', '用于侧栏终端', this.terminalFont, 'terminal')
            this.divider()
            this.fontRow('终端字号', '侧栏终端字号', this.terminalSize, 'terminalSize')
            this.divider()

            Column({ space: 6 }) {
              Text('字体预览').fontSize(12).fontColor(this.subColor())
              Text('正文字体预览 Aa 你好')
                .fontSize(this.fontSize === '特大' ? 20 : (this.fontSize === '大' ? 18 : (this.fontSize === '小' ? 14 : 16)))
                .fontColor(this.textColor())
              Text('const answer = 42;  // 代码预览')
                .fontSize(this.codeSize.length > 0 ? Number(this.codeSize) : 13)
                .fontColor(this.subColor())
            }
            .alignItems(HorizontalAlign.Start)
            .width('100%')
            .padding(16)
          }
          .width('100%')
        }
        .width('100%')
        .constraintSize({ maxHeight: 420 })
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .padding({ top: 6, bottom: 24 })
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(this.pageBg())
    }
    .width('100%')
    .height('100%')
  }


  // ── 弹层：轻量说明 ──

  @Builder
  infoSheet() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.closeSheets();
        })
      Column({ space: 14 }) {
        Column({ space: 6 }) {
          Text(this.infoTitle)
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
            .width('100%')
          Text(this.infoText)
            .fontSize(13)
            .fontColor(this.subColor())
            .width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')

        Button('知道了')
          .width('100%')
          .height(42)
          .fontSize(15)
          .backgroundColor('#2E6BE6')
          .fontColor('#FFFFFF')
          .onClick(() => {
            this.closeSheets();
          })
      }
      .width('calc(100% - 64vp)')
      .padding(18)
      .borderRadius(16)
      .backgroundColor(this.isDark ? '#1C1C22' : '#FFFFFF')
      .border({ width: 1, color: this.dividerColor() })
    }
    .width('100%')
    .height('100%')
  }

  // ── 弹层：公网访问 / 公网权限 ──

  @Builder
  connectionSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.connectionSheetOpen = false;
        })
      Column({ space: 0 }) {
        Row() {
          Text(this.connectionSheetKind === 'public' ? '公网访问' : '公网权限')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Blank()
          Text('关闭')
            .fontSize(14)
            .fontColor(this.subColor())
            .onClick(() => {
              this.connectionSheetOpen = false;
            })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })

        if (this.connectionSheetKind === 'public') {
          Column() {
            this.row('访问状态', this.publicValueLabel(), false, () => {
            })
            this.divider()
            this.row('网关', this.gatewayName.length > 0 ? this.gatewayName : '—', false, () => {
            })
            this.divider()
            this.row('访问有效期', '—', false, () => {
            })
            Button('重新连接')
              .width('calc(100% - 32vp)')
              .height(44)
              .fontSize(15)
              .backgroundColor('#2E6BE6')
              .fontColor('#FFFFFF')
              .margin({ top: 12, bottom: 12 })
              .onClick(() => {
                GatewayClient.get().autoConnect();
                this.connectionHint = '正在重新连接…';
              })
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())
        } else {
          Column() {
            Text('公网权限用于控制当前设备是否可以访问公网节点。')
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding(16)
            this.row('当前权限', this.publicAccessState.length > 0 ? this.publicAccessState : '未授权', false, () => {
            })
            Button('刷新权限状态')
              .width('calc(100% - 32vp)')
              .height(44)
              .fontSize(15)
              .backgroundColor('rgba(255,255,255,0.10)')
              .fontColor(this.textColor())
              .margin({ top: 12, bottom: 12 })
              .onClick(() => {
                this.connectionHint = '已刷新权限状态';
              })
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())
        }
        if (this.connectionHint.length > 0) {
          Text(this.connectionHint)
            .fontSize(12)
            .fontColor(this.subColor())
            .width('100%')
            .padding({ left: 16, top: 8 })
        }
      }
      .width('100%')
      .padding({ top: 8, bottom: 24 })
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(this.pageBg())
    }
    .width('100%')
    .height('100%')
  }

  build() {
    NavDestination() {
      // 根必须是 Stack：NavDestination 只接受一个子节点，且弹层要盖在页面之上
      Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        // 导航（标题字号/字重/缩进与「会话设置」「Tailscale 内嵌隧道」页一致）
        Stack({ alignContent: Alignment.TopStart }) {
          // 与对话页顶栏一致的轻模糊：backdropBlur + 页面同色半透明底
          Column()
            .width('100%')
            .height(56 + (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9))
            .backdropBlur(12)
            .backgroundColor(Color.Transparent)
            .hitTestBehavior(HitTestMode.None)

          Row() {
            NavBackButton({ isDark: this.isDark })
              .onClick(() => {
                this.pageStack.pop();
              })

          Text('设置')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)

          Row().width(44).height(44)
        }
          .width('100%')
          .height(56)
          .padding({ left: 16, right: 16 })
          .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })
        }
        .width('100%')
        .zIndex(10)

        Scroll() {
          Column() {
            // ── 连接 ──
            this.groupTitle('连接')
            Column({ space: 0 }) {
              Row({ space: 12 }) {
                Row() {
                  Image(this.isDark ? $r('app.media.node_router_white') : $r('app.media.node_router'))
                    .width(23)
                    .height(23)
                    .objectFit(ImageFit.Contain)
                }
                .width(42)
                .height(42)
                .borderRadius(12)
                .justifyContent(FlexAlign.Center)
                .backgroundColor(this.innerFill())

                Column({ space: 3 }) {
                  Text(this.gatewayName.length > 0 ? this.gatewayName : '本机')
                    .fontSize(17)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.textColor())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                  Text(this.connSubtitle())
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Row({ space: 5 }) {
                  Image(this.isDark ? $r('app.media.sliders_white') : $r('app.media.sliders_ink'))
                    .width(13)
                    .height(13)
                    .objectFit(ImageFit.Contain)
                  Text('管理')
                    .fontSize(12.5)
                    .fontColor(this.textColor())
                }
                .padding({ left: 12, right: 12, top: 7, bottom: 7 })
                .backgroundColor(this.innerFill())
                .borderRadius(999)
                .onClick(() => {
                  this.pageStack.pushPathByName('node-manage', null);
                })
              }
              .width('100%')
              .padding({ left: 15, right: 15, top: 14 })

              Row({ space: 6 }) {
                Row({ space: 5 }) {
                  Circle({ width: 6, height: 6 })
                    .fill(this.connStatusColor())
                  Text(this.connStatusLabel())
                    .fontSize(11.5)
                    .fontColor(this.connStatusColor())
                }
                .padding({ left: 9, right: 9, top: 4, bottom: 4 })
                .borderRadius(999)
                .backgroundColor(this.connStatusFill())

                Text(this.gatewayVersion.length > 0 ? this.gatewayVersion : '版本未知')
                  .fontSize(11.5)
                  .fontColor(this.gatewayVersion.length > 0 ? this.subColor() : this.faintColor())
                  .padding({ left: 9, right: 9, top: 4, bottom: 4 })
                  .borderRadius(999)
                  .backgroundColor(this.innerFill())
              }
              .width('100%')
              .padding({ left: 15, right: 15, top: 11 })

              Row()
                .width('100%')
                .height(1)
                .backgroundColor(this.dividerColor())
                .margin({ top: 12 })

              Row() {
                this.connStat(this.sessions.length.toString(), '会话')
                this.connStat(this.workspaces.length.toString(), '工作区')
                this.connStat(this.scheduleTasks.length.toString(), '定时任务')
                this.connStat(this.pluginBundles.length.toString(), '插件')
                this.connStat(this.nodeCount().toString(), '节点')
              }
              .width('100%')
              .padding({ top: 13, bottom: 12 })

              Row()
                .width('100%')
                .height(1)
                .backgroundColor(this.dividerColor())

            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)

            // ── 外观 ──
            this.groupTitle('外观')
            Column({ space: 0 }) {
              this.rowPref('界面', 'appearance', () => {
                this.openPicker('appearance');
              })
              this.divider()
              this.rowPref('对话状态条', 'status', () => {
                this.pageStack.pushPathByName('status-styles', null);
              })
              this.divider()
              this.rowPref('执行图标', 'procion', () => {
                this.openPicker('procion');
              })
              this.divider()
              this.toggleRow('首页动画', '对齐 iOS 的动态海洋背景；关闭后保留静态画面并降低发热', this.homeAnimationEnabled, (value: boolean) => {
                this.homeAnimationEnabled = value;
                PreferencesStore.get().putBoolean('homeAnimationEnabled', value);
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)

            // ── 通用设置 ──
            this.groupTitle('通用设置')
            Column({ space: 0 }) {
              this.rowPref('语言', 'language', () => {
                this.openPicker('language');
              })
              this.divider()
              this.rowPref('震动反馈', 'haptics', () => {
                this.openPicker('haptics');
              })
              this.divider()
              this.rowDescPref('字号大小', '仅影响会话内容的字号', 'fontsize', () => {
                this.openFontSizePage();
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)

            // ── 对话 ──
            this.groupTitle('对话')
            Column({ space: 0 }) {
              this.toggleRow('会话节点胶囊', '关闭后会话页不显示侧边胶囊（会话节点入口一并隐藏）', this.capsuleAlwaysVisible, (value: boolean) => {
                this.capsuleAlwaysVisible = value;
                PreferencesStore.get().putBoolean('capsuleAlwaysVisible', value);
              })
              // 子设置：只有胶囊开启时才显示（关闭胶囊后「收起」没有意义）
              if (this.capsuleAlwaysVisible) {
                this.divider()
                // 开关含义统一成「收起」：开启 = 进入会话页时默认收起成贴边把手（存储取反）
                this.subToggleRow('胶囊收起', '开启后进入会话页默认收起为贴边把手，点击再展开', !this.capsuleDefaultExpanded, (value: boolean) => {
                  this.capsuleDefaultExpanded = !value;
                  PreferencesStore.get().putBoolean('capsuleDefaultExpanded', !value);
                })
              }
              this.divider()
              this.toggleRow('语音输入', '按住说话，由已连接的 DSH 语音插件转写', this.voiceInputEnabled, (value: boolean) => {
                this.voiceInputEnabled = value;
                PreferencesStore.get().putBoolean('voiceInputEnabled', value);
              })
              this.divider()
              if (this.voiceInputEnabled) {
                this.row('语音插件设置', '', true, () => {
                  this.openInfo('语音插件设置', '语音输入由已连接的 DSH 语音插件转写；请在网关侧安装并连接语音插件后使用。');
                })
                this.divider()
              }
              this.rowWorkStep('工作步骤展示', '选择希望看到多少工具调用细节', 'mode', () => {
                this.openPicker('mode');
              })
              this.divider()
              this.rowWorkStep('工作步骤收起时机', '选择何时自动收起工作步骤', 'timing', () => {
                this.openPicker('timing');
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('完全展开时不自动收起；设置保存在本机。')

            // ── 实验性功能 ──
            this.groupTitle('实验性功能')
            Column({ space: 0 }) {
              // 直接内联 Toggle（不经 @Builder 回调参数）：确保开关状态一定写入偏好并申请权限
              Row() {
                Column({ space: 3 }) {
                  Text('订阅通知')
                    .fontSize(16)
                    .fontColor(this.textColor())
                  Text('任务完成时通过鸿蒙系统通知提醒（需允许通知权限）')
                    .fontSize(12)
                    .lineHeight(17)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Toggle({ type: ToggleType.Switch, isOn: this.notifyEnabled })
                  .selectedColor('#2E6BE6')
                  .onChange((value: boolean) => {
                    this.notifyEnabled = value;
                    PreferencesStore.get().putBoolean('notifyEnabled', value);
                    if (value) {
                      this.authorizeNotifications();
                    }
                  })
              }
              .width('100%')
              .constraintSize({ minHeight: 44 })
              .padding({ left: 16, right: 16, top: 12, bottom: 12 })
              .onClick(() => {
                // 整行点击也能切换开关
                const next: boolean = !this.notifyEnabled;
                this.notifyEnabled = next;
                PreferencesStore.get().putBoolean('notifyEnabled', next);
                if (next) {
                  this.authorizeNotifications();
                }
              })
              // 仅在订阅通知开启时显示测试入口
              if (this.notifyEnabled) {
                this.divider()
                // 直接写 onClick（不经 @Builder 函数参数）：部分 ArkUI 版本下 builder 传函数不触发
                Row() {
                  Column({ space: 3 }) {
                    Text('发送测试通知')
                      .fontSize(16)
                      .fontColor(this.textColor())
                    Text(this.notificationHint.length > 0 ? this.notificationHint : '立即发一条系统通知，验证权限与通道是否正常')
                      .fontSize(12)
                      .lineHeight(17)
                      .fontColor(this.notificationHint.length > 0 ? '#2E6BE6' : this.subColor())
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Text('›')
                    .fontSize(18)
                    .fontColor(this.subColor())
                    .margin({ left: 8 })
                }
                .width('100%')
                .constraintSize({ minHeight: 44 })
                .padding({ left: 16, right: 16, top: 12, bottom: 12 })
                .onClick(() => {
                  this.sendTestNotification();
                })
              }
              this.divider()
              this.rowDescPref('微信 ClawBot 私聊接线', '将微信私聊接入指定 DSH 会话；微信凭据保存在电脑端', 'clawbot', () => {
                this.pageStack.pushPathByName('clawbot', null);
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('实验性功能默认关闭，可能随基础库版本变化不稳定，仅供试用。')

            // ── 关于 ──
            this.groupTitle('关于')
            Column({ space: 0 }) {
              this.row('存储空间', '', true, () => {
                this.closeSheets();
                this.pageStack.pushPathByName('storage-space', null);
              })
              this.divider()
              this.row('开发者公告', '', true, () => {
                this.openInfo('开发者公告', '暂无开发者公告。');
              })
              this.divider()
              this.row('联系客服', '', true, () => {
                this.openInfo('联系客服', '请在小程序「鲸尾助手」中联系客服，或通过开发者公告获取支持渠道。');
              })
              this.divider()
              this.row('客户端', '鲸尾助手鸿蒙版', false, () => {
              })
              this.divider()
              this.row('当前版本', this.appVersion, false, () => {
              })
              this.divider()
              this.row('要求网关版本', '≥ 0.8.6', false, () => {
              })
              this.divider()
              this.row('已连接网关版本', this.connection === 'connected' ? (this.gatewayVersion.length > 0 ? this.gatewayVersion : '未上报') : '未连接', false, () => {
              })
              this.divider()
              this.row('隐私政策', '', true, () => {
                this.openInfo('隐私政策', '账号与网关凭据仅保存在本机与已连接的 DSH 网关；语音、通知等能力需在系统中单独授权，可随时关闭。');
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('适配基线：0.8.6+；旧版移动网关 0.10.0+。')

            if (this.notificationHint.length > 0) {
              Text(this.notificationHint)
                .fontSize(12)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 8, top: 8 })
            }
            if (this.hint.length > 0) {
              Text(this.hint)
                .fontSize(12)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 8, top: 12 })
            }
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4 + 56 + (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9), bottom: 30 })
        }
        .layoutWeight(1)
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
        .margin({ top: -(56 + (this.safeTopStorage > 0 ? this.safeTopStorage : 38.9)) })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())

      if (this.connectionSheetOpen) {
        this.connectionSheet()
      }
      if (this.pickerOpen) {
        this.choiceSheet()
      }

      if (this.infoOpen) {
        this.infoSheet()
      }
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
    .onShown(() => {
      // 从二级选择页返回：@Watch 偶发不触发时这里兜底消费一次选择，保证行文案/偏好立即生效
      Logger.info('[SETTINGS] onShown');
      this.consumePickerChoice();
      this.refreshPrefs();
      // 直接从 AppStorage / 偏好里读回档位并强制刷新行文案（不依赖 @Watch 是否触发）
      const storedMode: string = WorkStepPresentation.normalizeMode(
        AppStorage.get<string>('workStepMode') ?? PreferencesStore.get().getString(WorkStepPresentation.MODE_KEY, this.workStepMode));
      const storedTiming: string = WorkStepPresentation.normalizeTiming(
        AppStorage.get<string>('workStepTiming') ?? PreferencesStore.get().getString(WorkStepPresentation.TIMING_KEY, this.workStepTiming));
      Logger.info('[SETTINGS] onShown restore mode=' + storedMode + ' label=' + WorkStepPresentation.modeLabel(storedMode));
      this.workStepMode = storedMode;
      this.workStepTiming = storedTiming;
      this.workStepLabel = WorkStepPresentation.modeLabel(storedMode);
      this.workStepTimingLabel = WorkStepPresentation.timingLabel(storedTiming);
    })
  }
}
