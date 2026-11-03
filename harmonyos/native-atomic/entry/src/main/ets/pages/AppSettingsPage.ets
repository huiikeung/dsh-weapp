import { KeyboardAvoidMode } from '@kit.ArkUI';
import { vibrator } from '@kit.SensorServiceKit';
import { GatewayClient, PreferencesStore, SessionSummary, WorkspaceRow } from 'nativecore';

/** 设置（左侧栏「设置」）：对齐小程序 pages/settings */
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
  @State fontSize: string = '标准';
  @State haptics: string = '标准';
  @State textFont: string = '';
  @State codeFont: string = '';
  @State terminalFont: string = '';
  @State codeSize: string = '';
  @State terminalSize: string = '';
  @State hint: string = '';
  @State pickerOpen: boolean = false;
  @State pickerTitle: string = '';
  @State pickerKind: string = '';
  @State pickerItems: string[] = [];
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

  aboutToAppear(): void {
    this.fontSize = PreferencesStore.get().getString('contentFontSize', '标准');
    this.haptics = PreferencesStore.get().getString('hapticsLevel', '标准');
    this.textFont = PreferencesStore.get().getString('fontFamilyText', '');
    this.codeFont = PreferencesStore.get().getString('fontFamilyCode', '');
    this.terminalFont = PreferencesStore.get().getString('fontFamilyTerminal', '');
    this.codeSize = PreferencesStore.get().getString('codeFontSize', '');
    this.terminalSize = PreferencesStore.get().getString('terminalFontSize', '');
    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (ignored) {
    }
  }

  @Builder
  groupTitle(title: string) {
    Text(title)
      .fontSize(15)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 8, top: 20, bottom: 9 })
  }

  @Builder
  groupHint(text: string) {
    Text(text)
      .fontSize(12.5)
      .fontColor(this.subColor())
      .width('100%')
      .padding({ left: 8, top: 8 })
  }

  @Builder
  row(label: string, value: string, chevron: boolean, onTap: () => void) {
    Row() {
      Text(label).fontSize(15).fontColor(this.textColor())
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
        Text(label).fontSize(15).fontColor(this.textColor())
        Text(hint).fontSize(11.5).fontColor(this.subColor())
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      TextInput({ text: value, placeholder: '默认' })
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

  private publicValueLabel(): string {
    if (this.connection !== 'connected') {
      return '未连接';
    }
    return this.transportKind === 'relay' ? '公网（中继）' : '局域网直连';
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
      vibrator.startVibration({ type: 'time', duration: 200 }, { id: 0, usage: 'touch' }).catch(() => {
      });
      this.hint = '已触发震动';
    } catch (err) {
      this.hint = '当前设备不支持震动';
    }
  }

  @Builder
  connectionSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column().width('100%').height('100%').backgroundColor('rgba(0,0,0,0.45)').onClick(() => { this.connectionSheetOpen = false; })
      Column({ space: 0 }) {
        Row() {
          Text(this.connectionSheetKind === 'public' ? '公网访问' : '公网权限').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.textColor())
          Blank()
          Text('关闭').fontSize(14).fontColor(this.subColor()).onClick(() => { this.connectionSheetOpen = false; })
        }.width('100%').height(48).padding({ left: 16, right: 16 })
        if (this.connectionSheetKind === 'public') {
          Column() {
            this.row('访问状态', this.publicValueLabel(), false, () => {})
            this.divider()
            this.row('网关', this.gatewayName.length > 0 ? this.gatewayName : '—', false, () => {})
            this.divider()
            this.row('访问有效期', '—', false, () => {})
            Button('重新连接').width('calc(100% - 32vp)').height(44).fontSize(15).backgroundColor('#2E6BE6').fontColor('#FFFFFF').margin({ top: 12, bottom: 12 }).onClick(() => { GatewayClient.get().autoConnect(); this.connectionHint = '正在重新连接…'; })
          }.width('100%').borderRadius(14).backgroundColor(this.cardBg())
        } else {
          Column() {
            Text('公网权限用于控制当前设备是否可以访问公网节点。').fontSize(13).fontColor(this.subColor()).width('100%').padding(16)
            this.row('当前权限', this.publicAccessState.length > 0 ? this.publicAccessState : '未授权', false, () => {})
            Button('刷新权限状态').width('calc(100% - 32vp)').height(44).fontSize(15).backgroundColor('rgba(255,255,255,0.10)').fontColor(this.textColor()).margin({ top: 12, bottom: 12 }).onClick(() => { this.connectionHint = '已刷新权限状态'; })
          }.width('100%').borderRadius(14).backgroundColor(this.cardBg())
        }
        if (this.connectionHint.length > 0) { Text(this.connectionHint).fontSize(12).fontColor(this.subColor()).width('100%').padding({ left: 16, top: 8 }) }
      }.width('100%').padding({ top: 8, bottom: 24 }).borderRadius({ topLeft: 18, topRight: 18 }).backgroundColor(this.pageBg())
    }.width('100%').height('100%')
  }

  build() {
    NavDestination() {
      Column() {
        Row() {
          Text('‹').fontSize(26).fontColor(this.textColor()).width(40).height(40).textAlign(TextAlign.Center)
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
          Column() {
            // 账号与余额
            this.groupTitle('账号与余额')
            Row({ space: 12 }) {
              Row() {
                Text('👤').fontSize(18).fontColor(this.textColor())
              }
              .width(36)
              .height(36)
              .borderRadius(18)
              .justifyContent(FlexAlign.Center)
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
              Column({ space: 3 }) {
                Text(this.connection === 'connected' ? 'DSH 账号' : '未登录')
                  .fontSize(15).fontWeight(FontWeight.Medium).fontColor(this.textColor())
                Text(this.connection === 'connected' ? '已连接' : '登录后查看余额')
                  .fontSize(12).fontColor(this.subColor())
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
            }
            .width('100%')
            .padding(16)
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)

            // 连接
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

            // 震动反馈
            this.groupTitle('震动反馈')
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

            // 外观
            this.groupTitle('外观')
            Column() {
              Row({ space: 8 }) {
                this.chip('跟随系统', this.themeMode === 'system', () => {
                  this.applyTheme('system');
                })
                this.chip('浅色', this.themeMode === 'light', () => {
                  this.applyTheme('light');
                })
                this.chip('深色', this.themeMode === 'dark', () => {
                  this.applyTheme('dark');
                })
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 12, bottom: 10 })
              this.divider()
              Row({ space: 8 }) {
                Text('字号大小').fontSize(15).fontColor(this.textColor()).layoutWeight(1)
                ForEach(['小', '标准', '大', '特大'], (size: string) => {
                  this.chip(size, this.fontSize === size, () => {
                    this.applyFontSize(size);
                  })
                }, (size: string) => size)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 10, bottom: 12 })
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
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('字体留空使用默认字体；实际可用字体取决于设备。')

            // 字体预览
            this.groupTitle('字体预览')
            Column({ space: 6 }) {
              Text('正文字体预览 Aa 你好')
                .fontSize(this.fontSize === '特大' ? 20 : (this.fontSize === '大' ? 18 : (this.fontSize === '小' ? 14 : 16)))
                .fontColor(this.textColor())
              Text('const answer = 42;  // 代码预览')
                .fontSize(this.codeSize.length > 0 ? Number(this.codeSize) : 13)
                .fontColor(this.subColor())
            }
            .width('100%')
            .padding(16)
            .borderRadius(14)
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })

            // 存储空间
            this.groupTitle('存储空间')
            Column() {
              this.row('本机缓存', this.sessions.length + ' 个会话', false, () => {
              })
              this.divider()
              this.row('清理本机缓存', '', true, () => {
                this.hint = '已清理本机缓存（不含图片与文件）';
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('本机缓存不含图片与文件。')

            if (this.hint.length > 0) {
              Text(this.hint)
                .fontSize(12)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 8, top: 12 })
            }
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
      .backgroundColor(this.pageBg())
      if (this.connectionSheetOpen) {
        this.connectionSheet()
      }
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
