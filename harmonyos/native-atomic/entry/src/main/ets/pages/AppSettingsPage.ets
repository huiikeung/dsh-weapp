import { KeyboardAvoidMode } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { vibrator } from '@kit.SensorServiceKit';
import { GatewayClient, GatewayProfile, PairingResult, parsePairingPayload, PreferencesStore, SessionSummary, WorkspaceRow } from 'nativecore';
import { ThemeManager, ThemeMode } from 'nativecore';
import { ParticleBackground } from 'nativecore';

interface ThemeOption {
  key: ThemeMode;
  title: string;
  subtitle: string;
}

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

  // Pre-read preferences
  @State fontSize: string = '标准';
  @State haptics: string = '标准';
  @State textFont: string = '';
  @State codeFont: string = '';
  @State terminalFont: string = '';
  @State codeSize: string = '';
  @State terminalSize: string = '';
  @State hint: string = '';

  // UI states for sheet
  @State connectionSheetOpen: boolean = false;
  @State connectionSheetKind: string = '';
  @State connectionHint: string = '';
  @State payloadText: string = '';
  @State pairCode: string = '';
  @State wsUrl: string = 'ws://10.0.2.2:3081/ws/mobile';

  // Mini-program align flags
  @State settingsGlassEnabled: boolean = false;
  @State sessionGlassEnabled: boolean = false;
  @State settingsGlassSheetEnabled: boolean = false;
  @State glassAlpha: number = 6;
  @State glassBlur: number = 8;
  @State glassEdgeAlpha: number = 10;
  @State glassBlurSheet: number = 10;
  @State glassBlurCard: number = 6;
  @State glassRadiusSheet: number = 18;
  @State glassRadiusCard: number = 18;
  @State glassRadiusChoice: number = 18;
  @State glassBackdropBrightness: number = 11;
  @State showAccountCard: boolean = true;
  @State cardFloat: number = 12;
  @State cardRadius: number = 18;

  // 通用玻璃弹窗（对齐小程序 pair-sheet：鸿蒙原生粒子 + 玻璃组件）
  @State sheetOpen: boolean = false;
  @State sheetKind: string = '';
  @State sheetTitle: string = '';
  @State sheetSubtitle: string = '';
  @State sheetSelected: string = '';

  // Token API (consistent with mini-program)
  private publicValueLabel(): string {
    if (this.connection !== 'connected') {
      return '未连接';
    }
    return this.transportKind === 'relay' ? '公网(中继)' : '局域网直连';
  }

  private themeLabel(): string {
    if (this.themeMode === 'light') {
      return '浅色';
    }
    if (this.themeMode === 'dark') {
      return '深色';
    }
    return '跟随系统';
  }

  private applyTheme(mode: string): void {
    this.themeMode = mode;
    ThemeManager.get().setMode(mode as ThemeMode);
    PreferencesStore.get().putString('themeMode', mode);
    AppStorage.setOrCreate<string>('themeMode', mode);
  }

  private applyFontSize(value: string): void {
    this.fontSize = value;
    PreferencesStore.get().putString('contentFontSize', value);
  }

  private applyHaptics(value: string): void {
    this.haptics = value;
    PreferencesStore.get().putString('hapticsLevel', value);
  }

  private testVibrate(): void {
    try {
      vibrator.startVibration({ type: 'time', duration: 200 }, { id: 0, usage: 'touch' }).catch(() => {});
      this.hint = '已触发震动';
    } catch (err) {
      this.hint = '当前设备不支持震动';
    }
  }

  private applyNotification(value: boolean): void {
    PreferencesStore.get().putBoolean('notifyEnabled', value);
  }

  aboutToAppear(): void {
    this.fontSize = PreferencesStore.get().getString('contentFontSize', '标准');
    this.haptics = PreferencesStore.get().getString('hapticsLevel', '标准');
    this.textFont = PreferencesStore.get().getString('fontFamilyText', '');
    this.codeFont = PreferencesStore.get().getString('fontFamilyCode', '');
    this.terminalFont = PreferencesStore.get().getString('fontFamilyTerminal', '');
    this.codeSize = PreferencesStore.get().getString('codeFontSize', '');
    this.terminalSize = PreferencesStore.get().getString('terminalFontSize', '');

    // Load glass style preferences from storage (keyed like mini-program local-cache)
    this.glassAlpha = PreferencesStore.get().getNumber('glassAlpha', 6);
    this.glassBlur = PreferencesStore.get().getNumber('glassBlur', 8);
    this.glassBlurSheet = PreferencesStore.get().getNumber('glassBlurSheet', 10);
    this.glassBlurCard = PreferencesStore.get().getNumber('glassBlurCard', 6);
    this.glassRadiusSheet = PreferencesStore.get().getNumber('glassRadiusSheet', 18);
    this.glassRadiusCard = PreferencesStore.get().getNumber('glassRadiusCard', 18);
    this.glassRadiusChoice = PreferencesStore.get().getNumber('glassRadiusChoice', 18);
    this.glassEdgeAlpha = PreferencesStore.get().getNumber('glassEdgeAlpha', 10);
    this.glassBackdropBrightness = PreferencesStore.get().getNumber('glassBackdropBrightness', 11);
    this.settingsGlassEnabled = PreferencesStore.get().getBoolean('settingsGlassEnabled', false);
    this.settingsGlassSheetEnabled = PreferencesStore.get().getBoolean('settingsGlassSheetEnabled', false);
    this.showAccountCard = PreferencesStore.get().getBoolean('showAccountCard', true);

    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (ignored) {}
  }

  @Builder
  groupTitle(title: string) {
    Text(title)
      .fontSize(15)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 8, top: 20, bottom: 9 });
  }

  @Builder
  groupHint(text: string) {
    Text(text)
      .fontSize(12.5)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 8, top: 8 });
  }

  @Builder
  row(label: string, value: string, chevron: boolean, onTap: () => void) {
    Row() {
      Text(label).fontSize(15).fontColor(this.textColor());
      Blank()
      Row({ space: 6 }) {
        Text(value)
          .fontSize(15)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 200 });
        if (chevron) {
          Text('›').fontSize(18).fontColor(this.subColor());
        }
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 15, bottom: 15 })
    .onClick(onTap);
  }

  @Builder
  divider() {
    Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 });
  }

  @Builder
  chip(label: string, selected: boolean, onTap: () => void) {
    Text(label)
      .fontSize(14)
      .fontWeight(selected ? FontWeight.Medium : FontWeight.Normal)
      .fontColor(selected ? '#2E6BE6' : this.textColor())
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })
      .borderRadius(999)
      .backgroundColor(this.isDark
        ? selected ? 'rgba(76,108,224,0.24)' : 'rgba(255,255,255,0.06)'
        : selected ? 'rgba(76,108,224,0.12)' : 'rgba(16,19,24,0.04)')
      .border({ width: 1, color: selected ? 'rgba(76,108,224,0.55)' : this.dividerColor() })
      .onClick(onTap);
  }

  @Builder
  fontRow(label: string, hint: string, value: string, role: string) {
    Row() {
      Column({ space: 3 }) {
        Text(label).fontSize(15).fontColor(this.textColor())
        Text(hint).fontSize(11.5).fontColor(this.subColor())
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
    .padding({ left: 16, right: 16, top: 12, bottom: 12 });
  }

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

  @Builder
  connectionSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column().width('100%').height('100%').backgroundColor('rgba(0,0,0,0.45)').onClick(() => { this.connectionSheetOpen = false; })
      Column({ space: 0 }) {
        Row() {
          Text(this.connectionSheetKind === 'public' ? '公网访问' : '公网权限')
            .fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.textColor())
          Blank()
          Text('关闭')
            .fontSize(14).fontColor(this.subColor())
            .onClick(() => { this.connectionSheetOpen = false; })
        }.width('100%').height(48).padding({ left: 16, right: 16 })

        if (this.connectionSheetKind === 'public') {
          Column() {
            this.row('访问状态', this.publicValueLabel(), false, () => {});
            this.divider()
            this.row('网关', this.gatewayName.length > 0 ? this.gatewayName : '—', false, () => {});
            this.divider()
            this.row('访问有效期', '—', false, () => {});
            Button('重新连接')
              .width('calc(100% - 32vp)').height(44).fontSize(15).backgroundColor('#2E6BE6')
              .fontColor('#FFFFFF').margin({ top: 12, bottom: 12 })
              .onClick(() => { GatewayClient.get().autoConnect(); this.connectionHint = '正在重新连接…'; })
          }.width('100%').borderRadius(14).backgroundColor(this.cardBg())
        } else {
          Column() {
            Text('公网权限用于控制当前设备是否可以访问公网节点。')
              .fontSize(13).fontColor(this.subColor()).width('100%').padding(16)
            this.row('当前权限', this.publicAccessState.length > 0 ? this.publicAccessState : '未授权', false, () => {});
            Button('刷新权限状态')
              .width('calc(100% - 32vp)').height(44).fontSize(15)
              .backgroundColor('rgba(255,255,255,0.10)').fontColor(this.textColor())
              .margin({ top: 12, bottom: 12 })
              .onClick(() => { this.connectionHint = '已刷新权限状态'; })
          }.width('100%').borderRadius(14).backgroundColor(this.cardBg())
        }
        if (this.connectionHint.length > 0) {
          Text(this.connectionHint)
            .fontSize(12).fontColor(this.subColor()).width('100%').padding({ left: 16, top: 8 })
        }
      }.width('100%').padding({ top: 8, bottom: 24 })
        .borderRadius({ topLeft: 18, topRight: 18 })
        .backgroundColor(this.pageBg())
    }.width('100%').height('100%')
  }

  /** 通用玻璃弹窗：ArkUI backgroundEffect 玻璃层（对齐小程序 pair-sheet） */
  @Builder
  glassSheet() {
    Stack({ alignContent: Alignment.Center }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.sheetOpen = false;
        })
      Column() {
        Row() {
          Column({ space: 3 }) {
            Text(this.sheetTitle)
              .fontSize(17)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.textColor())
            if (this.sheetSubtitle.length > 0) {
              Text(this.sheetSubtitle)
                .fontSize(12)
                .fontColor(this.subColor())
            }
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)
          Text('✕')
            .fontSize(16)
            .fontColor(this.subColor())
            .onClick(() => {
              this.sheetOpen = false;
            })
        }
        .width('100%')
        .margin({ bottom: 12 })

        ForEach(this.sheetOptions(), (option: string) => {
          Row({ space: 10 }) {
            Text(option)
              .fontSize(15)
              .fontColor(this.textColor())
              .layoutWeight(1)
            if (this.sheetSelected === option) {
              Text('✓')
                .fontSize(16)
                .fontColor('#2E6BE6')
            }
          }
          .width('100%')
          .height(46)
          .padding({ left: 12, right: 12 })
          .borderRadius(12)
          .backgroundColor(this.sheetSelected === option ? 'rgba(46,107,230,0.12)' : Color.Transparent)
          .onClick(() => {
            this.sheetSelected = option;
            this.applySheetChoice(option);
          })
        }, (option: string) => option)
      }
      .width('calc(100% - 48vp)')
      .padding({ left: 16, right: 16, top: 16, bottom: 16 })
      .borderRadius(this.glassRadiusChoice)
      .backgroundColor(this.isDark ? 'rgba(18,22,32,0.72)' : 'rgba(255,255,255,0.78)')
      .backgroundEffect({
        radius: this.glassBlurSheet,
        saturation: 1.4,
        brightness: 1.0
      })
      .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(16,19,24,0.10)' })
      .margin({ top: 80 })
    }
    .width('100%')
    .height('100%')
  }

  private sheetOptions(): string[] {
    if (this.sheetKind === 'glass') {
      return ['默认玻璃', '通透玻璃', '磨砂玻璃', '深色玻璃'];
    }
    if (this.sheetKind === 'card') {
      return ['悬浮卡片', '平面卡片', '紧凑卡片'];
    }
    if (this.sheetKind === 'status') {
      return ['柔和光晕', '线性进度', '紧凑文字'];
    }
    if (this.sheetKind === 'proc') {
      return ['呼吸光点', '旋转环', '脉冲方块'];
    }
    if (this.sheetKind === 'context') {
      return ['按步骤', '按轮次', '按文件'];
    }
    if (this.sheetKind === 'storage') {
      return ['会话缓存', '图片缓存', '日志缓存'];
    }
    return ['在线客服', '邮箱支持', '问题反馈'];
  }

  private applySheetChoice(option: string): void {
    if (this.sheetKind === 'glass') {
      const index: number = this.sheetOptions().indexOf(option);
      this.glassAlpha = 6 + index * 4;
      this.glassBlur = 8 + index * 6;
      this.glassBlurSheet = 10 + index * 6;
      this.glassBlurCard = 6 + index * 4;
      this.glassRadiusSheet = 18 - index * 2;
      this.glassRadiusCard = 18 - index * 2;
      this.glassRadiusChoice = 18 - index * 2;
      this.glassEdgeAlpha = 10 + index * 6;
      this.glassBackdropBrightness = 11 - index * 2;
      PreferencesStore.get().putNumber('glassAlpha', this.glassAlpha);
      PreferencesStore.get().putNumber('glassBlur', this.glassBlur);
      PreferencesStore.get().putNumber('glassBlurSheet', this.glassBlurSheet);
      PreferencesStore.get().putNumber('glassBlurCard', this.glassBlurCard);
      PreferencesStore.get().putNumber('glassRadiusSheet', this.glassRadiusSheet);
      PreferencesStore.get().putNumber('glassRadiusCard', this.glassRadiusCard);
      PreferencesStore.get().putNumber('glassRadiusChoice', this.glassRadiusChoice);
      PreferencesStore.get().putNumber('glassEdgeAlpha', this.glassEdgeAlpha);
      PreferencesStore.get().putNumber('glassBackdropBrightness', this.glassBackdropBrightness);
    } else if (this.sheetKind === 'card') {
      const index: number = this.sheetOptions().indexOf(option);
      this.cardFloat = 12 - index * 4;
      this.cardRadius = 18 - index * 4;
      PreferencesStore.get().putNumber('cardFloat', this.cardFloat);
      PreferencesStore.get().putNumber('cardRadius', this.cardRadius);
    } else if (this.sheetKind === 'status') {
      PreferencesStore.get().putString('statusAppearance', option);
    } else if (this.sheetKind === 'proc') {
      PreferencesStore.get().putString('procIconStyle', option);
    } else if (this.sheetKind === 'context') {
      PreferencesStore.get().putString('contextTrendGroupBy', option);
    } else if (this.sheetKind === 'storage') {
      this.hint = '已清理：' + option;
    } else {
      this.hint = '已选择：' + option;
    }
    this.sheetOpen = false;
  }

  private openGlassStyleSheet(): void {
    this.sheetKind = 'glass';
    this.sheetTitle = '玻璃样式设置';
    this.sheetSubtitle = '调整玻璃透明度、模糊与圆角';
    this.sheetSelected = '默认玻璃';
    this.sheetOpen = true;
  }

  private openCardStyleSheet(): void {
    this.sheetKind = 'card';
    this.sheetTitle = '卡片样式设置';
    this.sheetSubtitle = '调整对话卡片悬浮高度与圆角';
    this.sheetSelected = '悬浮卡片';
    this.sheetOpen = true;
  }

  private openStatusStyles(): void {
    this.sheetKind = 'status';
    this.sheetTitle = '对话状态条';
    this.sheetSubtitle = '选择对话状态条样式';
    this.sheetSelected = PreferencesStore.get().getString('statusAppearance', '柔和光晕');
    this.sheetOpen = true;
  }

  private openProcIcons(): void {
    this.sheetKind = 'proc';
    this.sheetTitle = '执行图标';
    this.sheetSubtitle = '选择执行图标动效';
    this.sheetSelected = PreferencesStore.get().getString('procIconStyle', '呼吸光点');
    this.sheetOpen = true;
  }

  private openContextSheet(): void {
    this.sheetKind = 'context';
    this.sheetTitle = '上下文面板';
    this.sheetSubtitle = '选择上下文面板分组方式';
    this.sheetSelected = PreferencesStore.get().getString('contextTrendGroupBy', '按步骤');
    this.sheetOpen = true;
  }

  private openStorageSheet(): void {
    this.sheetKind = 'storage';
    this.sheetTitle = '存储空间';
    this.sheetSubtitle = '选择要清理的缓存分类';
    this.sheetSelected = '会话缓存';
    this.sheetOpen = true;
  }

  private openContactService(): void {
    this.sheetKind = 'contact';
    this.sheetTitle = '联系客服';
    this.sheetSubtitle = '选择联系方式';
    this.sheetSelected = '在线客服';
    this.sheetOpen = true;
  }

  private async scanPairing(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const options: scanBarcode.ScanOptions = {
        scanTypes: [scanCore.ScanType.ALL],
        enableMultiMode: false,
        enableAlbum: true
      };
      const result: scanBarcode.ScanResult = await scanBarcode.startScanForResult(context, options);
      const parsed: PairingResult = parsePairingPayload(result.originalValue);
      if (!parsed.ok) {
        this.connectionHint = parsed.error;
        return;
      }
      this.connectionHint = '读取到配对信息，正在连接…';
      GatewayClient.get().connectPairing(parsed);
    } catch (err) {
      this.connectionHint = '扫码已取消或失败';
    }
  }

  private connectByPayload(): void {
    const raw: string = this.payloadText.trim();
    if (raw.length === 0) {
      this.connectionHint = '请先粘贴配对载荷';
      return;
    }
    try {
      const parsed = parsePairingPayload(raw);
      if (!parsed.ok) {
        this.connectionHint = '载荷无效：' + parsed.error;
        return;
      }
      this.connectionHint = '解析成功，候选地址 ' + parsed.candidates.length + ' 个，正在连接…';
      GatewayClient.get().connectPairing(parsed);
    } catch (err) {
      this.connectionHint = '载荷解析失败';
    }
  }

  private connect(): void {
    if (this.wsUrl.trim().length === 0) {
      this.connectionHint = '请填写 wss 地址';
      return;
    }
    const profile: GatewayProfile = {
      wsUrl: this.wsUrl.trim(),
      pairCode: this.pairCode.trim(),
      leaseToken: '',
      inviteToken: '',
      accessToken: ''
    };
    GatewayClient.get().connect(profile);
    this.connectionHint = '正在连接…';
  }

  build() {
    NavDestination() {
      Stack() {
        ParticleBackground({ isDark: this.isDark })
        Column() {
          Row() {
            Text('‹')
              .fontSize(26).fontColor(this.textColor()).width(40).height(40).textAlign(TextAlign.Center)
              .onClick(() => {
                this.pageStack.pop();
              })
            Blank()
            Text('设置').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.textColor())
            Blank()
            Row().width(40)
          }
          .width('100%')
          .height(44)
          .padding({ left: 8, right: 8 })
          .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })

          Scroll() {
            Column({ space: 14 }) {
          // === 连接 ===
          this.groupTitle('连接')
          Column() {
            this.row('公网访问', this.publicValueLabel(), true, () => {
              this.connectionSheetKind = 'public';
              this.connectionSheetOpen = true;
            })
            this.divider()
            this.row('节点管理', this.workspaces.length + ' 个节点', true, () => {
              this.pageStack.pushPathByName('node-manage', null);
            })
            this.divider()
            this.row('公网权限', this.publicAccessState.length > 0 ? this.publicAccessState : '未授权', true, () => {
              this.connectionSheetKind = 'permission';
              this.connectionSheetOpen = true;
            })
          }
          .width('100%')
          .backgroundColor(this.cardBg())
          .border({ width: 1, color: this.dividerColor() })
          .borderRadius(14)
          .clip(true)

          // === 外观 ===
          this.groupTitle('外观')
          Column() {
            Column({ space: 6 }) {
              this.themeRow('system', 0)
              this.themeRow('light', 1)
              this.themeRow('dark', 2)
            }
            .width('100%')
            .borderRadius(18)
            .backgroundColor(this.cardBg())

            this.divider()
            Row({ space: 8 }) {
              Text('设置页玻璃UI')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.settingsGlassEnabled })
                .onChange((value: boolean) => {
                  this.settingsGlassEnabled = value;
                  PreferencesStore.get().putBoolean('settingsGlassEnabled', value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 玻璃样式设置
            Row() {
              Text('玻璃样式设置')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              this.openGlassStyleSheet()
            })
            this.divider()

            // 卡片样式设置
            Row() {
              Text('卡片样式设置')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              this.openCardStyleSheet()
            })
            this.divider()

            // 底部弹窗
            Row() {
              Text('底部弹窗')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.settingsGlassSheetEnabled })
                .onChange((value: boolean) => {
                  this.settingsGlassSheetEnabled = value;
                  PreferencesStore.get().putBoolean('settingsGlassSheetEnabled', value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})

            // 首页动画
            Row() {
              Text('首页动画')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: true }) // placeholder - read from prefs
                .onChange((value: boolean) => {
                  PreferencesStore.get().putBoolean('homeAnimationEnabled', value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})

            // 对话状态条
            Row() {
              Text('对话状态条')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              this.openStatusStyles()
            })
            this.divider()

            // 执行图标
            Row() {
              Text('执行图标')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              this.openProcIcons()
            })
            this.divider()

            // 语音输入
            Row() {
              Text('语音输入')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: true }) // placeholder
                .onChange((value: boolean) => {
                  PreferencesStore.get().putBoolean('voiceEnabled', value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 字号大小
            this.fontRow('字号大小', '仅影响会话内容的字号', this.fontSize, 'fontSize')
            this.divider()

            // 正文字体
            this.fontRow('正文字体', '用于界面与会话正文', this.textFont, 'text')
            this.divider()

            // 代码字体
            this.fontRow('代码字体', '用于代码块与工具输出', this.codeFont, 'code')
            this.divider()

            // 代码字号
            this.fontRow('代码字号', '代码块与工具输出字号', this.codeSize, 'codeSize')
            this.divider()

            // 终端字体
            this.fontRow('终端字体', '用于侧栏终端', this.terminalFont, 'terminal')
            this.divider()

            // 终端字号
            this.fontRow('终端字号', '侧栏终端字号', this.terminalSize, 'terminalSize')
            this.divider()

            // 显示账号卡片
            Row() {
              Text('显示账号卡片')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.showAccountCard })
                .onChange((value: boolean) => {
                  this.showAccountCard = value;
                  PreferencesStore.get().putBoolean('showAccountCard', value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())

          // === 通用设置 ===
          this.groupTitle('通用设置')
          Column() {
            // 震动反馈
            Column() {
              Row({ space: 8 }) {
                ForEach(['关闭', '轻', '标准', '强'], (level: string) => {
                  this.chip(level, this.haptics === level, () => {
                    this.applyHaptics(level);
                  })
                }, (level: string) => level)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 12, bottom: 6 })
              this.divider()
              this.row('测试震动', '', true, () => {
                this.testVibrate();
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('点击与滑动时的震动强度，全局生效。')

            // 订阅通知
            this.divider()
            Row() {
              Text('订阅通知')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: true }) // placeholder
                .onChange((value: boolean) => {
                  this.applyNotification(value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})

            // 微信 ClawBot 私聊接线
            this.divider()
            Row() {
              Text('微信 ClawBot 私聊接线')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: false }) // placeholder
                .onChange((value: boolean) => {
                  // PreferencesStore put
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 额度卡片
            Row() {
              Text('额度卡片')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: false }) // placeholder
                .onChange((value: boolean) => {
                  // PreferencesStore put
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())

          // === 对话 ===
          this.groupTitle('对话')
          Column() {
            // 工作步骤展示
            Row() {
              Text('工作步骤展示')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 工作步骤收起时机
            Row() {
              Text('工作步骤收起时机')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 上下文标签页
            Row() {
              Text('上下文标签页')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: false }) // placeholder
                .onChange((value: boolean) => {
                  // PreferencesStore put
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 编队标签页
            Row() {
              Text('编队标签页')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: false }) // placeholder
                .onChange((value: boolean) => {
                  // PreferencesStore put
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 上下文面板
            Row() {
              Text('上下文面板')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Text('›')
                .fontSize(18).fontColor(this.subColor())
            }
            .width('100%')
            .height(44)
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {
              this.openContextSheet()
            })
            this.divider()

            // 首页动画
            Row() {
              Text('首页动画')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: true }) // placeholder
                .onChange((value: boolean) => {
                  PreferencesStore.get().putBoolean('homeAnimationEnabled', value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())

          // === 实验性功能 ===
          this.groupTitle('实验性功能')
          Column() {
            // 订阅通知
            this.divider()
            Row() {
              Text('订阅通知')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: true }) // placeholder
                .onChange((value: boolean) => {
                  this.applyNotification(value);
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})

            // 微信 ClawBot 私聊接线
            this.divider()
            Row() {
              Text('微信 ClawBot 私聊接线')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: false }) // placeholder
                .onChange((value: boolean) => {
                  // PreferencesStore put
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
            this.divider()

            // 额度卡片
            this.divider()
            Row() {
              Text('额度卡片')
                .fontSize(15).fontColor(this.textColor()).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: false }) // placeholder
                .onChange((value: boolean) => {
                  // PreferencesStore put
                })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 12, bottom: 12 })
            .onClick(() => {})
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())

          // === 关于 ===
          this.groupTitle('关于')
          Column() {
            this.row('存储空间', this.sessions.length + ' 个会话', true, () => {
              this.openStorageSheet()
            })
            this.divider()
            this.row('开发者公告', '', true, () => {
              this.pageStack.pushPathByName('announcements', null);
            })
            this.divider()
            this.row('联系客服', '', false, () => {
              this.openContactService()
            })
            this.divider()
            this.row('客户端', '鲸尾助手小程序版', false, () => {})
            this.divider()
            this.row('当前版本', '1.0.0', false, () => {})
            this.divider()
            this.row('要求网关版本', '1.0.0', false, () => {})
            this.divider()
            this.row('已连接网关版本', '1.0.0', false, () => {})
            this.divider()
            this.row('隐私政策', '', true, () => {
              this.pageStack.pushPathByName('privacy-policy', null);
            })
          }
          .width('100%')
          .borderRadius(14)
          .backgroundColor(this.cardBg())
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 4, bottom: 30 })
          }
          .layoutWeight(1)
          .align(Alignment.Top)
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .height('100%')
        if (this.connectionSheetOpen) {
          this.connectionSheet()
        }
        if (this.sheetOpen) {
          this.glassSheet()
        }
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }

  @Builder
  themeRow(mode: string, index: number) {
    Column() {
      Row() {
        Column({ space: 4 }) {
          Text(this.themeMode === mode ? (mode === 'system' ? '跟随系统' : (mode === 'light' ? '浅色' : '深色')) : mode)
            .fontSize(16).fontColor(this.textColor())
          Text(this.themeMode === mode ? (mode === 'system' ? '随系统深浅色切换' : (mode === 'light' ? '始终使用浅色外观' : '始终使用深色外观')) : '')
            .fontSize(12).fontColor(this.subColor())
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        if (this.themeMode === mode) {
          Text('✓')
            .fontSize(18).fontColor('#2E6BE6')
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 14, bottom: 14 })
      .onClick(() => {
        this.applyTheme(mode);
      })

      if (index < 2) {
        Divider()
          .color(this.isDark ? 'rgba(241,244,250,0.10)' : 'rgba(16,19,24,0.08)')
          .margin({ left: 16, right: 16 })
      }
    }
    .width('100%')
  }
}
