import { KeyboardAvoidMode } from '@kit.ArkUI';
import { GatewayClient, PreferencesStore, SessionSummary, WorkspaceRow } from 'nativecore';

/** 会话设置（右上角滑杆按钮）：对齐小程序 pages/session-settings */
@Component
export struct SessionSettingsPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('gatewayName') gatewayName: string = '';
  @StorageLink('gatewayVersion') gatewayVersion: string = '';
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('workspaces') workspaces: WorkspaceRow[] = [];
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('defaultAgentPreset') defaultPreset: string = '';
  @StorageLink('defaultModel') defaultModelValue: string = '';
  @StorageLink('defaultPermission') defaultPermissionValue: string = '';
  @StorageLink('agentPresetList') agentPresetList: string[] = [];
  @StorageLink('modelList') modelList: string[] = [];
  @StorageLink('permissionList') permissionList: string[] = [];
  @State pickPreset: string = '';
  @State pickModel: string = '';
  @State pickPermission: string = '';
  @State pickerOpen: boolean = false;
  @State pickerTitle: string = '';
  @State pickerKind: string = '';
  @State pickerItems: string[] = [];
  @State hint: string = '';
  @State balanceExpanded: boolean = false;
  @State utilityOpen: boolean = false;
  @State utilityTitle: string = '';
  @State utilityRows: string[] = [];
  @State utilityKind: string = '';
  @StorageLink('modelList') modelCatalog: string[] = [];

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

  private workspacePath(): string {
    for (const item of this.sessions) {
      if (item.cwd.length > 0) {
        return item.cwd;
      }
    }
    return '—';
  }

  aboutToAppear(): void {

    try {
      this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.NONE);
    } catch (ignored) {
    }
  }

  private presetLabel(): string {
    if (this.pickPreset.length > 0) {
      return this.pickPreset;
    }
    return this.defaultPreset.length > 0 ? this.defaultPreset : '默认';
  }

  private modelLabel(): string {
    if (this.pickModel.length > 0) {
      return this.pickModel;
    }
    return this.defaultModelValue.length > 0 ? this.defaultModelValue : '跟随 WebUI';
  }

  private permissionLabel(): string {
    if (this.pickPermission.length > 0) {
      return this.pickPermission;
    }
    return this.defaultPermissionValue.length > 0 ? this.defaultPermissionValue : '默认权限';
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
  cardRow(label: string, value: string, chevron: boolean, onTap: () => void) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.textColor())
      Blank()
      Row({ space: 6 }) {
        Text(value)
          .fontSize(15)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .constraintSize({ maxWidth: 200 })
        if (chevron) {
          Text('›')
            .fontSize(18)
            .fontColor(this.subColor())
        }
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 15, bottom: 15 })
    .onClick(onTap)
  }

  @Builder
  cardBox() {
    Column() {
      this.cardRow('Agent 预设', this.presetLabel(), true, () => {
        this.openPicker('preset', 'Agent 预设', this.agentPresetList.length > 0 ? this.agentPresetList : ['默认']);
      })
      Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
      this.cardRow('默认模型', this.modelLabel(), true, () => {
        this.openPicker('model', '默认模型', this.modelList.length > 0 ? this.modelList : ['跟随 WebUI']);
      })
      Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
      this.cardRow('权限', this.permissionLabel(), true, () => {
        this.openPicker('permission', '权限', this.permissionList.length > 0 ? this.permissionList : ['默认权限']);
      })
    }
    .width('100%')
    .backgroundColor(this.cardBg())
    .border({ width: 1, color: this.dividerColor() })
    .borderRadius(14)
    .clip(true)
  }

  build() {
    NavDestination() {
      Column() {
        // 导航
        Row() {
          Text('‹')
            .fontSize(26)
            .fontColor(this.textColor())
            .width(40)
            .height(40)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.pageStack.pop();
            })
          Blank()
          Text('会话设置')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
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
            Column() {
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
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Text(this.connection === 'connected' ? '已连接 · ' + this.gatewayVersion : '打开设置页登录')
                    .fontSize(12)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Text('›').fontSize(18).fontColor(this.subColor())
              }
              .width('100%')
              .padding(16)
              .backgroundColor(this.cardBg())
              .border({ width: 1, color: this.dividerColor() })
              .borderRadius(14)
              .onClick(() => {
                this.balanceExpanded = !this.balanceExpanded;
              })

              if (this.balanceExpanded) {
                Column() {
                  Row() {
                    Text('充值余额').fontSize(14).fontColor(this.textColor())
                    Blank()
                    Text('登录后查看').fontSize(13).fontColor(this.subColor())
                  }
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 12, bottom: 12 })
                  Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                  Row() {
                    Text('赠金余额').fontSize(14).fontColor(this.textColor())
                    Blank()
                    Text('登录后查看').fontSize(13).fontColor(this.subColor())
                  }
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 12, bottom: 12 })
                }
                .width('100%')
                .backgroundColor(this.cardBg())
                .border({ width: 1, color: this.dividerColor() })
                .borderRadius(14)
                .margin({ top: 8 })
              }
            }
            .width('100%')

            // 新会话默认配置
            this.groupTitle('新会话默认配置')
            this.cardBox()
            this.groupHint('与 WebUI 使用同一份部署级设置。修改只影响之后新建的会话，运行中的会话保持启动时的配置。')

            // 功能
            this.groupTitle('功能')
            Column() {
              this.cardRow('模型', this.modelCatalog.length > 0 ? (this.modelCatalog.length + ' 个可用') : '', true, () => {
                this.openPicker('catalog', '模型', this.modelCatalog.length > 0 ? this.modelCatalog : ['网关未提供模型目录']);
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('诊断信息', '', true, () => {
                this.utilityKind = 'diagnostics';
                this.utilityTitle = '诊断信息';
                this.utilityRows = [
                  '版本：' + (this.gatewayVersion.length > 0 ? this.gatewayVersion : '—'),
                  '会话数：' + this.sessions.length,
                  '工作目录：' + this.workspacePath(),
                  '网关：' + (this.gatewayName.length > 0 ? this.gatewayName : '—')
                ];
                this.utilityOpen = true;
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('清理缓存', '', true, () => {
                this.utilityKind = 'clearCache';
                this.utilityTitle = '清理缓存';
                this.utilityRows = ['仅清理本机的会话列表与正文缓存。', '不会删除聊天记录、配对信息或公网有效期。'];
                this.utilityOpen = true;
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)

            // 主机信息
            this.groupTitle('主机信息')
            Column() {
              this.cardRow('模型服务商', '—', false, () => {
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('模型', '—', false, () => {
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('已连接会话', this.sessions.length + ' 个', false, () => {
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('工作目录', this.workspacePath(), false, () => {
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)

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

      if (this.pickerOpen) {
        this.pickerSheet()
      }
      if (this.utilityOpen) {
        this.utilitySheet()
      }
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }

  @Builder
  utilitySheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.utilityOpen = false;
        })
      Column({ space: 0 }) {
        Row() {
          Text(this.utilityTitle).fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.textColor())
          Blank()
          Text('关闭').fontSize(14).fontColor(this.subColor())
            .onClick(() => {
              this.utilityOpen = false;
            })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })
        ForEach(this.utilityRows, (row: string) => {
          Text(row)
            .fontSize(14)
            .fontColor(this.textColor())
            .width('100%')
            .padding({ left: 16, right: 16, top: 8, bottom: 8 })
        }, (row: string) => row)
        if (this.utilityKind === 'clearCache') {
          Button('确认清理')
            .width('calc(100% - 32vp)')
            .height(44)
            .fontSize(15)
            .fontColor('#FFFFFF')
            .backgroundColor('#FF3B30')
            .margin({ top: 12, bottom: 8 })
            .onClick(() => {
              this.utilityOpen = false;
              this.hint = '已清理本机缓存';
            })
        } else {
          Button('关闭')
            .width('calc(100% - 32vp)')
            .height(44)
            .fontSize(15)
            .fontColor(this.textColor())
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.05)')
            .margin({ top: 12, bottom: 8 })
            .onClick(() => {
              this.utilityOpen = false;
            })
        }
      }
      .width('100%')
      .padding({ top: 8, bottom: 20 })
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(this.pageBg())
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  pickerSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.pickerOpen = false;
        })
      Column({ space: 0 }) {
        Row() {
          Text(this.pickerTitle)
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
          Blank()
          Text('关闭')
            .fontSize(14)
            .fontColor(this.subColor())
            .onClick(() => {
              this.pickerOpen = false;
            })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })

        ForEach(this.pickerItems, (item: string) => {
          Row() {
            Text(item)
              .fontSize(16)
              .fontColor(this.textColor())
              .layoutWeight(1)
            if (this.currentValue() === item) {
              Text('✓')
                .fontSize(16)
                .fontColor('#2E6BE6')
            }
          }
          .width('100%')
          .height(48)
          .padding({ left: 16, right: 16 })
          .onClick(() => {
            this.applyPick(item);
          })
        }, (item: string) => item)
      }
      .width('100%')
      .padding({ top: 8, bottom: 24 })
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(this.pageBg())
      .margin({ bottom: 0 })
    }
    .width('100%')
    .height('100%')
  }

  private currentValue(): string {
    if (this.pickerKind === 'preset') {
      return this.presetLabel();
    }
    if (this.pickerKind === 'model') {
      return this.modelLabel();
    }
    return this.permissionLabel();
  }

  private openPicker(kind: string, title: string, items: string[]): void {
    this.pickerKind = kind;
    this.pickerTitle = title;
    this.pickerItems = items;
    this.pickerOpen = true;
  }

  private applyPick(value: string): void {
    if (this.pickerKind === 'preset') {
      this.pickPreset = value;
      PreferencesStore.get().putString('defaultAgentPreset', value);
    } else if (this.pickerKind === 'model') {
      this.pickModel = value;
      PreferencesStore.get().putString('defaultModel', value);
    } else {
      this.pickPermission = value;
      PreferencesStore.get().putString('defaultPermission', value);
    }
    this.pickerOpen = false;
  }
}
