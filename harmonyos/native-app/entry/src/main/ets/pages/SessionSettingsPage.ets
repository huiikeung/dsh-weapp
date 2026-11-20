import { KeyboardAvoidMode } from '@kit.ArkUI';
import { GatewayClient, PreferencesStore, SessionStore, SessionSummary, WorkspaceRow } from 'nativecore';
import type { PresetOption, ModelOption, PermissionOption, DiagnosticRow } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';
import { openSessionRoute } from '../common/SessionRoute';

/** Agent 预设二级页的选项装载结构（写入 AppStorage，PreferencePickerPage 解析） */
interface PresetPickOption {
  id: string;
  label: string;
  detail: string;
  disabled: boolean;
}

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
  @StorageLink('tailscaleTunnelEnabled') tailscaleEnabledState: boolean = false;
  @StorageLink('tailscaleStage') tailscaleStageState: string = 'disabled';
  @StorageLink('agentPresetList') agentPresetList: string[] = [];
  @StorageLink('agentPresetDetails') agentPresetDetails: PresetOption[] = [];
  @StorageLink('modelDetails') modelDetails: ModelOption[] = [];
  @StorageLink('modelList') modelList: string[] = [];
  @StorageLink('permissionList') permissionList: string[] = [];
  @StorageLink('networkBearer') networkBearerState: string = '';
  @StorageLink('activeEndpoint') activeEndpointState: string = '';
  @StorageLink('endpointKind') endpointKindState: string = '';
  @State pickPreset: string = '';
  // 当前预设的 id（用于选中态比较；pickPreset 只存显示名）
  @State pickPresetId: string = '';
  @State pickModel: string = '';
  @State pickPermission: string = '';
  @State pickerOpen: boolean = false;
  @State pickerTitle: string = '';
  @State pickerKind: string = '';
  @State pickerItems: string[] = [];
  @State pickerIntro: string = '';
  @State presetCreatorAvailable: boolean = false;
  @State creatingPreset: boolean = false;
  @State hint: string = '';
  @State utilityOpen: boolean = false;
  @State utilityTitle: string = '';
  @State utilityRows: string[] = [];
  @State utilityKind: string = '';
  @State cacheClearing: boolean = false;
  @State cacheError: string = '';
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

  /** 玻璃底（小程序默认 alpha 10%） */
  private glassFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.72)';
  }

  /** 玻璃亮边（小程序 edge alpha 38%） */
  private glassEdge(): string {
    return this.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.38)';
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
    if (this.pickPresetId.length > 0) {
      return this.presetDisplayName(this.pickPreset, this.pickPresetId);
    }
    if (this.pickPreset.length > 0) {
      return this.pickPreset;
    }
    if (this.defaultPreset.length > 0) {
      // 网关下发的是 id：显示为本地化名称（standard → 标准模式）
      return this.presetDisplayName(this.defaultPreset, this.defaultPreset);
    }
    return this.presetModeName('standard');
  }

  private modelLabel(): string {
    // 未连接网关时不显示（没有可用的模型信息）
    if (this.connection !== 'connected') {
      return '';
    }
    const id: string = this.pickModel.length > 0 ? this.pickModel : this.defaultModelValue;
    if (id.length === 0) {
      return '';
    }
    // 优先显示网关下发的模型显示名，找不到则回退 id
    for (const one of this.modelDetails) {
      if (one.model === id) {
        return one.label;
      }
    }
    return id;
  }

  private permissionLabel(): string {
    const id: string = this.pickPermission.length > 0
      ? this.pickPermission
      : this.defaultPermissionValue;
    if (id.length > 0) {
      return this.permissionDisplayName(id);
    }
    return '工作区写入';
  }

  private permissionLabelOld(): string {
    if (this.pickPermission.length > 0) {
      return this.pickPermission;
    }
    return this.defaultPermissionValue.length > 0 ? this.defaultPermissionValue : '默认权限';
  }

  /** 分组标题：字号/字重/缩进与「Tailscale 内嵌隧道」页的 sectionHeader 完全一致 */
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

  /** 功能行：直接 onClick（避免 @Builder 传函数参数不触发的问题） */
  @Builder
  functionRow(label: string, value: string, onTap: () => void) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.textColor())
      Blank()
      Row({ space: 6 }) {
        if (value.length > 0) {
          Text(value)
            .fontSize(15)
            .fontColor(this.subColor())
            .maxLines(1)
            .constraintSize({ maxWidth: 200 })
        }
        Text('›')
          .fontSize(18)
          .fontColor(this.subColor())
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 44 })
    .padding({ left: 16, right: 16, top: 15, bottom: 15 })
    .onClick(onTap)
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
  tailscaleRow(label: string, onTap: () => void) {
    Row() {
      Text(label)
        .fontSize(15)
        .fontColor(this.textColor())
      Blank()
      Row({ space: 6 }) {
        Text(this.tailscaleSummary())
          .fontSize(15)
          .fontColor(this.subColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text('›')
          .fontSize(18)
          .fontColor(this.subColor())
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
      // Agent 预设：独立行 + 直接 onClick（@Builder 传函数参数在部分 ArkUI 版本下不触发）
      Row() {
        Text('Agent 预设')
          .fontSize(15)
          .fontColor(this.textColor())
        Blank()
        Row({ space: 6 }) {
          Text(this.presetLabel())
            .fontSize(15)
            .fontColor(this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 200 })
          Text('›')
            .fontSize(18)
            .fontColor(this.subColor())
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 44 })
      .padding({ left: 16, right: 16, top: 15, bottom: 15 })
      .onClick(() => {
        this.openPresetPicker();
      })
      Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
      // 默认模型：独立行 + 直接 onClick
      Row() {
        Text('默认模型')
          .fontSize(15)
          .fontColor(this.textColor())
        Blank()
        Row({ space: 6 }) {
          if (this.modelLabel().length > 0) {
            Text(this.modelLabel())
              .fontSize(15)
              .fontColor(this.subColor())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .constraintSize({ maxWidth: 200 })
          }
          Text('›')
            .fontSize(18)
            .fontColor(this.subColor())
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 44 })
      .padding({ left: 16, right: 16, top: 15, bottom: 15 })
      .onClick(() => {
        this.pageStack.pushPathByName('session-model', null);
      })
      Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
      // 权限：独立行 + 直接 onClick（同 Agent 预设）
      Row() {
        Text('权限')
          .fontSize(15)
          .fontColor(this.textColor())
        Blank()
        Row({ space: 6 }) {
          Text(this.permissionLabel())
            .fontSize(15)
            .fontColor(this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .constraintSize({ maxWidth: 200 })
          Text('›')
            .fontSize(18)
            .fontColor(this.subColor())
        }
      }
      .width('100%')
      .constraintSize({ minHeight: 44 })
      .padding({ left: 16, right: 16, top: 15, bottom: 15 })
      .onClick(() => {
        this.openPermissionPicker();
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
      // 根容器必须是 Stack：底部弹窗需覆盖在本页之上。
      // 若根为 Column，弹窗会被 Scroll(layoutWeight(1)) 挤成 0 高度而不可见。
      Stack({ alignContent: Alignment.TopStart }) {
        Column() {
        // 导航（标题字号/字重/缩进与「Tailscale 内嵌隧道」页完全一致）
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })

          Text('会话设置')
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)

          Row().width(44).height(44)
        }
        .width('100%')
        .height(56)
        // 左右与内容一致（内容区 padding 16）
        .padding({ left: 16, right: 16 })
        .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })

        Scroll() {
          Column() {

            // 新会话默认配置
            this.groupTitle('新会话默认配置')
            this.cardBox()
            this.groupHint('与 WebUI 使用同一份部署级设置。修改只影响之后新建的会话，运行中的会话保持启动时的配置。')

            // 功能
            this.groupTitle('功能')
            Column() {
              this.functionRow('模型', this.modelList.length > 0 ? (this.modelList.length + ' 个可用') : '', () => {
                this.pageStack.pushPathByName('models', null);
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

            // Tailscale 内嵌隧道（对齐 iOS SettingsView 的独立 Section）
            this.groupTitle('Tailscale 内嵌隧道')
            Column() {
              this.tailscaleRow('内嵌隧道', () => {
                this.pageStack.pushPathByName('tailscale', null);
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('在应用内建立一个 Tailscale 节点：不需要安装 Tailscale，也不会占用系统 VPN。节点只在你自己的 tailnet 内可达。')

            // 网络与连接：当前网络类型与正在使用的端点（局域网优先 / 蜂窝自动切公网）
            this.groupTitle('网络与连接')
            Column() {
              this.cardRow('当前网络', this.networkBearerLabel(), false, () => {
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('连接方式', this.endpointKindLabel(), false, () => {
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('端点地址', this.activeEndpointLabel(), false, () => {
              })
              Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              this.cardRow('如何在外网使用', '', true, () => {
                this.openNetworkInfo();
              })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
            this.groupHint('在家走 Wi-Fi 时优先局域网直连；切到蜂窝数据后自动改用公网地址。')

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
        // 小程序（webview）没有橡皮筋回弹；这里关掉，避免滚动到顶/底时页面「抖」
        .edgeEffect(EdgeEffect.None)
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
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
    .onShown(() => {
      // 从预设二级页返回：消费选择（应用预设 / 打开创造模式）
      this.consumePresetChoice();
    })
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

  /** 底部弹窗（对齐小程序 pair-sheet）：抓取条 + 标题 + 关闭钮 + 可滚动内容 */
  @Builder
  pickerSheet() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.42)')
        .onClick(() => {
          this.pickerOpen = false;
        })

      Column({ space: 0 }) {
        // 抓取条
        Row() {
          Column()
            .width(36)
            .height(5)
            .borderRadius(3)
            .backgroundColor(this.isDark ? 'rgba(226,232,240,0.55)' : 'rgba(150,150,155,0.55)')
        }
        .width('100%')
        .height(24)
        .justifyContent(FlexAlign.Center)
        .padding({ top: 4, bottom: 4 })

        // 标题 + 关闭
        Row() {
          Text(this.pickerTitle)
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
            .layoutWeight(1)
          Text('关闭')
            .fontSize(14)
            .fontColor(this.subColor())
            .onClick(() => {
              this.pickerOpen = false;
            })
        }
        .width('100%')
        .height(44)
        .padding({ left: 18, right: 18 })

        Scroll() {
          Column({ space: 0 }) {
            if (this.pickerIntro.length > 0) {
              Text(this.pickerIntro)
                .fontSize(12.5)
                .lineHeight(19)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 18, right: 18, bottom: 10 })
            }

            if (this.pickerKind === 'preset') {
              ForEach(this.presetOptions(), (item: PresetOption) => {
                Column({ space: 0 }) {
                  Row() {
                    Text(item.label.length > 0 ? item.label : item.id)
                      .fontSize(15.5)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.textColor())
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Blank()
                    Text(item.id)
                      .fontSize(11.5)
                      .fontColor(this.subColor())
                    if (this.isCurrentPreset(item.id)) {
                      Text('当前使用')
                        .fontSize(10.5)
                        .fontColor('#2E6BE6')
                        .backgroundColor(this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
                        .borderRadius(4)
                        .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                        .margin({ left: 6 })
                    }
                  }
                  .width('100%')

                  if (item.description.length > 0) {
                    Text(item.description)
                      .fontSize(12.5)
                      .lineHeight(18)
                      .fontColor(this.subColor())
                      .maxLines(3)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .width('100%')
                      .margin({ top: 4 })
                      .textAlign(TextAlign.Start)
                  }
                  if (item.broken) {
                    Text('⚠ ' + (item.brokenReason.length > 0 ? item.brokenReason : '该预设存在配置错误，暂时不能设为默认值'))
                      .fontSize(11.5)
                      .fontColor('#FF9500')
                      .width('100%')
                      .margin({ top: 4 })
                  }
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
                .padding({ left: 16, right: 16, top: 13, bottom: 13 })
                .borderRadius(14)
                // 卡片玻璃底：选中项带蓝色玻璃高亮，其余为浅层白玻璃（对齐小程序 preset-option-card）
                .backgroundColor(this.isCurrentPreset(item.id)
                  ? (this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.12)')
                  : (this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)'))
                .border({
                  width: 1,
                  color: this.isCurrentPreset(item.id)
                    ? 'rgba(46,107,230,0.55)'
                    : this.glassEdge()
                })
                .backdropBlur(8)
                .margin({ bottom: 8 })
                .onClick(() => {
                  if (item.broken) {
                    return;
                  }
                  this.applyPreset(item.id, item.label);
                })
              }, (item: PresetOption) => item.id)

              // 添加自定义 Agent 预设（仅当网关提供 cordis 创造模式时，对齐小程序 presetCreatorAvailable）
              // 添加自定义 Agent 预设（对齐小程序 .preset-create-entry：虚线边框 + 蓝色圆形加号）
              if (this.presetCreatorAvailable) {
                Row({ space: 12 }) {
                  Text('+')
                    .fontSize(22)
                    .fontColor('#2E6BE6')
                    .textAlign(TextAlign.Center)
                    .width(29)
                    .height(29)
                    .borderRadius(15)
                    .backgroundColor('rgba(46,107,230,0.10)')
                  Column({ space: 2 }) {
                    Text(this.creatingPreset ? '正在打开…' : '添加自定义 Agent 预设')
                      .fontSize(15.5)
                      .fontWeight(FontWeight.Bold)
                      .fontColor(this.textColor())
                      .width('100%')
                    Text('新建创造模式会话，让 Agent 创建或维护预设')
                      .fontSize(12.5)
                      .fontColor(this.subColor())
                      .width('100%')
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Text('›')
                    .fontSize(15)
                    .fontColor(this.subColor())
                    .opacity(0.55)
                }
                .width('100%')
                .padding({ left: 15, right: 15, top: 13, bottom: 13 })
                .borderRadius(14)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(16,19,24,0.03)')
                .border({ width: 1, color: this.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(16,19,24,0.12)', style: BorderStyle.Dashed })
                .margin({ left: 2, right: 2, top: 6, bottom: 8 })
                .opacity(this.creatingPreset ? 0.65 : 1)
                .onClick(() => {
                  this.createCustomPreset();
                })
              }
            } else if (this.pickerKind === 'permission') {
              // 权限卡片：图标 + 名称 + EXP 徽章 + 描述（对齐小程序 permission-option-card）
              ForEach(this.permissionOptions(), (item: PermissionOption) => {
                Column({ space: 0 }) {
                  Row() {
                    Text(item.label)
                      .fontSize(15.5)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.textColor())
                    Blank()
                    if (item.badge.length > 0) {
                      Text(item.badge)
                        .fontSize(10)
                        .fontColor('#FF9500')
                        .backgroundColor(this.isDark ? 'rgba(255,149,0,0.18)' : 'rgba(255,149,0,0.12)')
                        .borderRadius(4)
                        .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                    }
                    if (this.isCurrentPermission(item.id)) {
                      Text('当前使用')
                        .fontSize(10.5)
                        .fontColor('#2E6BE6')
                        .backgroundColor(this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
                        .borderRadius(4)
                        .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                        .margin({ left: 6 })
                    }
                  }
                  .width('100%')

                  Text(item.description)
                    .fontSize(12.5)
                    .lineHeight(18)
                    .fontColor(this.subColor())
                    .width('100%')
                    .margin({ top: 4 })
                    .textAlign(TextAlign.Start)
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
                .padding({ left: 16, right: 16, top: 13, bottom: 13 })
                .borderRadius(14)
                .backgroundColor(this.isCurrentPermission(item.id)
                  ? (this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.12)')
                  : (this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.55)'))
                .border({
                  width: 1,
                  color: this.isCurrentPermission(item.id) ? 'rgba(46,107,230,0.55)' : this.glassEdge()
                })
                .margin({ bottom: 8 })
                .onClick(() => {
                  this.applyPermission(item.id, item.label);
                })
              }, (item: PermissionOption) => item.id)
            } else if (this.pickerKind === 'diagnostics') {
              // 诊断信息：键值两行式列表（对齐小程序 picker-pop-diag-row）
              ForEach(this.diagnosticRows(), (row: DiagnosticRow) => {
                Column({ space: 2 }) {
                  Text(row.label)
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .width('100%')
                  Text(row.value)
                    .fontSize(13.5)
                    .fontColor(this.textColor())
                    .width('100%')
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
                .padding({ top: 10, bottom: 10, left: 4, right: 4 })
              }, (row: DiagnosticRow) => row.label)
            } else if (this.pickerKind === 'networkInfo') {
              // 外网访问说明：当前路径 + 三种公网入口方式
              Column({ space: 0 }) {
                ForEach(this.networkInfoRows(), (row: DiagnosticRow) => {
                  Column({ space: 2 }) {
                    Text(row.label)
                      .fontSize(12)
                      .fontColor(this.subColor())
                      .width('100%')
                    Text(row.value)
                      .fontSize(13.5)
                      .fontColor(this.textColor())
                      .width('100%')
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)
                  .padding({ top: 10, bottom: 10, left: 4, right: 4 })
                }, (row: DiagnosticRow) => row.label)

                Text('手机端已自动处理：Wi-Fi 下优先局域网直连；外出切到蜂窝数据后，自动改用网关下发的公网地址。')
                  .fontSize(13)
                  .lineHeight(20)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ top: 8, left: 4, right: 4 })
                Text('如果网关只在局域网内可达，外出时会连不上。在网关那台机器上任选一种方式暴露公网入口：')
                  .fontSize(13)
                  .lineHeight(20)
                  .fontColor(this.textColor())
                  .width('100%')
                  .margin({ top: 12, left: 4, right: 4 })
                Text('① Tailscale Funnel（有 tailnet 时最省事，手机无需装 Tailscale）：\ntailscale funnel <网关端口> on')
                  .fontSize(12.5)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ top: 8, left: 4, right: 4 })
                Text('② Cloudflare Tunnel：\ncloudflared tunnel --url http://localhost:<网关端口>')
                  .fontSize(12.5)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ top: 8, left: 4, right: 4 })
                Text('③ 路由器端口映射 + 公网 IP / DDNS')
                  .fontSize(12.5)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ top: 8, left: 4, right: 4 })
                Text('拿到公网地址后，在网关的 WebUI 设置里把它填为对外地址并重新配对。配对时网关会把局域网与公网地址一并下发，手机端据此自动切换。')
                  .fontSize(13)
                  .lineHeight(20)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ top: 12, left: 4, right: 4, bottom: 4 })
              }
              .width('100%')
            } else if (this.pickerKind === 'cache') {
              // 清理缓存：说明 + 双按钮确认（对齐小程序 picker-pop-cache-desc / actions）
              Column({ space: 0 }) {
                Text('仅清理本机的会话列表与正文缓存，下次打开时重新加载。')
                  .fontSize(13.5)
                  .lineHeight(20)
                  .fontColor(this.textColor())
                  .width('100%')
                Text('不会删除聊天记录、配对信息或公网有效期。')
                  .fontSize(12.5)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
                  .margin({ top: 6 })
                if (this.cacheError.length > 0) {
                  Text(this.cacheError)
                    .fontSize(12.5)
                    .fontColor('#FF3B30')
                    .width('100%')
                    .margin({ top: 8 })
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ left: 4, right: 4, top: 4 })

              Row({ space: 16 }) {
                Text('取消')
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .textAlign(TextAlign.Center)
                  .layoutWeight(1)
                  .height(40)
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.06)')
                  .borderRadius(10)
                  .onClick(() => {
                    if (!this.cacheClearing) {
                      this.pickerOpen = false;
                    }
                  })
                Text(this.cacheClearing ? '清理中…' : '确认清理')
                  .fontSize(15)
                  .fontColor('#FFFFFF')
                  .textAlign(TextAlign.Center)
                  .layoutWeight(1)
                  .height(40)
                  .backgroundColor('#BF3D31')
                  .borderRadius(10)
                  .opacity(this.cacheClearing ? 0.5 : 1)
                  .onClick(() => {
                    this.confirmClearCache();
                  })
              }
              .width('100%')
              .margin({ top: 14 })
            } else if (this.pickerKind === 'model') {
              // 模型：按 provider 分组（对齐小程序 showModelSheet）
              ForEach(this.modelGroups(), (group: string) => {
                Column({ space: 0 }) {
                  Text(group)
                    .fontSize(12)
                    .fontColor(this.subColor())
                    .width('100%')
                    .padding({ left: 4, top: 8, bottom: 6 })

                  ForEach(this.modelsOfProvider(group), (item: ModelOption) => {
                    Row() {
                      Text(item.label)
                        .fontSize(15)
                        .fontColor(this.textColor())
                        .layoutWeight(1)
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      if (this.isCurrentModel(item.provider, item.model)) {
                        Text('当前使用')
                          .fontSize(10.5)
                          .fontColor('#2E6BE6')
                          .backgroundColor(this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
                          .borderRadius(4)
                          .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                      }
                    }
                    .width('100%')
                    .height(46)
                    .padding({ left: 14, right: 14 })
                    .borderRadius(12)
                    .backgroundColor(this.isCurrentModel(item.provider, item.model)
                      ? (this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.12)')
                      : (this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.45)'))
                    .margin({ bottom: 6 })
                    .onClick(() => {
                      this.applyModel(item.provider, item.model, item.label);
                    })
                  }, (item: ModelOption) => item.provider + '|' + item.model)
                }
                .width('100%')
              }, (group: string) => group)
            } else {
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
                .padding({ left: 18, right: 18 })
                .onClick(() => {
                  this.applyPick(item);
                })
              }, (item: string) => item)
            }
          }
          .width('100%')
          // 左右留白：Scroll 内子元素的外边距不生效，改用容器内边距
          .padding({ left: 14, right: 14, bottom: 8 })
        }
        .width('100%')
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
        .edgeEffect(EdgeEffect.None)
      }
      .width('100%')
      .padding({ bottom: 20 })
      // 弹窗默认高度 90%（对齐小程序 sheetMaxH ≈ 胶囊下方到底部）
      .constraintSize({ maxHeight: '90%' })
      // 玻璃材质：圆角 + 半透明底 + 亮边 + 背景模糊（对齐小程序 picker-glass-sheet）
      .borderRadius({ topLeft: 16, topRight: 16 })
      .backgroundColor(this.glassFill())
      .border({ width: 1, color: this.glassEdge() })
      .backdropBlur(16)
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

  /** 内置预设名称（对齐小程序 labels.presetModeName） */
  private presetModeName(id: string): string {
    const key: string = id.length > 0 ? id : 'standard';
    if (key === 'standard') {
      return '标准模式';
    }
    if (key === 'code' || key === 'ptc') {
      return 'PTC 模式';
    }
    if (key === 'minimal') {
      return '极简模式';
    }
    if (key === 'cordis') {
      return '创造模式';
    }
    return key + ' 模式';
  }

  /** 预设展示名：网关自定义名优先；名字等于 id 时回退本地化标签 */
  private presetDisplayName(name: string, id: string): string {
    const custom: string = (name ?? '').trim();
    if (custom.length > 0 && custom.toLowerCase() !== (id ?? '').trim().toLowerCase()) {
      return custom;
    }
    return this.presetModeName(id);
  }

  /** 预设描述：网关描述优先，缺失时回退内置说明（对齐 labels.presetModeBlurb） */
  private presetBlurb(id: string, description: string): string {
    const given: string = (description ?? '').trim();
    if (given.length > 0) {
      return given;
    }
    if (id === 'standard') {
      return '功能完整的编码 Agent，支持文件编辑、Shell、检索、Skills、计划与工作流。';
    }
    if (id === 'code' || id === 'ptc') {
      return '通过 Code Mode SDK 组合多步工具操作。';
    }
    if (id === 'minimal') {
      return '精简工具集合，适合轻量、直接的编码任务。';
    }
    if (id === 'cordis') {
      return '用于创建和维护自定义 Agent 预设。';
    }
    return '由鲸尾 Harness 提供的 Agent 预设。';
  }

  /** 诊断信息四行（对齐小程序 diagnosticRows） */
  private diagnosticRows(): DiagnosticRow[] {
    return [
      { label: '连接状态', value: this.connection === 'connected' ? '已连接' : (this.connection === 'connecting' ? '连接中' : '未连接'), mono: false },
      { label: '地址', value: this.gatewayName.length > 0 ? this.gatewayName : '未配置', mono: true },
      { label: '网关', value: this.gatewayName.length > 0 ? this.gatewayName : '—', mono: false },
      { label: '帧统计', value: '（暂无）', mono: true }
    ];
  }

  private openDiagnostics(): void {
    this.pickerKind = 'diagnostics';
    this.pickerTitle = '诊断信息';
    this.pickerIntro = '';
    this.pickerItems = [];
    this.cacheError = '';
    this.pickerOpen = true;
  }

  /** Tailscale 隧道概况（对齐 iOS 设置页入口行）：已连接 / 连接中 / 需要登录 / 未启用 */
  private tailscaleSummary(): string {
    if (!this.tailscaleEnabledState) {
      return '未启用';
    }
    const stage: string = this.tailscaleStageState;
    if (stage === 'ready') {
      return '已连接';
    }
    if (stage === 'needsLogin') {
      return '需要登录';
    }
    if (stage === 'failed') {
      return '连接失败';
    }
    if (stage === 'starting' || stage === 'waitingRoutes') {
      return '连接中';
    }
    return '已启用';
  }

  private networkBearerLabel(): string {
    const bearer: string = this.networkBearerState;
    if (bearer === 'wifi') {
      return 'Wi-Fi';
    }
    if (bearer === 'cellular') {
      return '蜂窝数据';
    }
    if (bearer === 'other') {
      return '其他网络';
    }
    return '—';
  }

  /** 当前连接路径：局域网 / 公网 */
  private endpointKindLabel(): string {
    if (this.connection !== 'connected') {
      return '未连接';
    }
    const kind: string = this.endpointKindState;
    if (kind === 'local') {
      return '局域网直连';
    }
    if (kind === 'public') {
      return '公网直连';
    }
    return '—';
  }

  private activeEndpointLabel(): string {
    return this.activeEndpointState.length > 0 ? this.activeEndpointState : '—';
  }

  /** 外网访问说明行 */
  private networkInfoRows(): DiagnosticRow[] {
    return [
      { label: '当前网络', value: this.networkBearerLabel(), mono: false },
      { label: '连接方式', value: this.endpointKindLabel(), mono: false },
      { label: '端点地址', value: this.activeEndpointLabel(), mono: true }
    ];
  }

  private openNetworkInfo(): void {
    this.pickerKind = 'networkInfo';
    this.pickerTitle = '如何在外网使用';
    this.pickerIntro = '';
    this.pickerItems = [];
    this.cacheError = '';
    this.pickerOpen = true;
  }

  private openClearCache(): void {
    this.pickerKind = 'cache';
    this.pickerTitle = '清理缓存';
    this.pickerIntro = '';
    this.pickerItems = [];
    this.cacheError = '';
    this.cacheClearing = false;
    this.pickerOpen = true;
  }

  /** 确认清理：仅清本地缓存，不删聊天记录、配对信息或公网有效期 */
  private confirmClearCache(): void {
    if (this.cacheClearing) {
      return;
    }
    this.cacheClearing = true;
    this.cacheError = '';
    this.cacheClearing = false;
    this.pickerOpen = false;
    this.hint = '已清理本机缓存';
  }

  /** 模型目录弹窗（功能区的「模型」） */
  private openModelCatalog(): void {
    this.pickerKind = 'catalog';
    this.pickerTitle = '模型';
    this.pickerIntro = '';
    this.pickerItems = this.modelList.length > 0 ? this.modelList : ['网关未提供模型目录'];
    this.pickerOpen = true;
  }

  /** 权限四项（对齐小程序 pickDefaultPermission） */
  private permissionOptions(): PermissionOption[] {
    return [
      { id: 'read-only', label: '仅可查看', description: '以只读方式使用工作区，适合查看和分析任务。', badge: '' },
      { id: 'workspace-write', label: '工作区内修改', description: '允许在工作区中修改文件，适合日常开发。', badge: '' },
      { id: 'danger-full-access', label: '完全权限', description: '启用完整访问能力，风险较高，请谨慎选择。', badge: '' },
      { id: 'auto', label: '自动审查', description: '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。', badge: 'EXP' }
    ];
  }

  private isCurrentPermission(id: string): boolean {
    const current: string = this.pickPermission.length > 0
      ? this.pickPermission
      : this.defaultPermissionValue;
    const base: string = current.length > 0 ? current : 'workspace-write';
    return base === id;
  }

  private applyPermission(id: string, label: string): void {
    this.pickPermission = id;
    PreferencesStore.get().putString('defaultPermission', id);
    this.pickerOpen = false;
    this.hint = '已切换权限为「' + label + '」，仅对新建会话生效';
  }

  /** 模型分组顺序（去重，保持网关顺序） */
  private modelGroups(): string[] {
    const out: string[] = [];
    for (const one of this.modelOptions()) {
      const key: string = one.providerName.length > 0 ? one.providerName : one.provider;
      if (out.indexOf(key) < 0) {
        out.push(key);
      }
    }
    return out;
  }

  private modelsOfProvider(group: string): ModelOption[] {
    const out: ModelOption[] = [];
    for (const one of this.modelOptions()) {
      const key: string = one.providerName.length > 0 ? one.providerName : one.provider;
      if (key === group) {
        out.push(one);
      }
    }
    return out;
  }

  private modelOptions(): ModelOption[] {
    return this.modelDetails;
  }

  private isCurrentModel(provider: string, model: string): boolean {
    const currentModel: string = this.pickModel.length > 0 ? this.pickModel : this.defaultModelValue;
    return currentModel.length > 0 && currentModel === model;
  }

  private applyModel(provider: string, model: string, label: string): void {
    this.pickModel = model;
    PreferencesStore.get().putString('defaultModel', model);
    this.pickerOpen = false;
    this.hint = '已切换默认模型为「' + label + '」，仅对新建会话生效';
  }

  /** 权限显示名（对齐小程序 labels.permissionName） */
  private permissionDisplayName(id: string): string {
    const v: string = id.toLowerCase().replace(/_/g, '-');
    if (v.indexOf('danger') >= 0 || v.indexOf('full-access') >= 0) {
      return '完全访问';
    }
    if (v.indexOf('workspace') >= 0) {
      return '工作区写入';
    }
    if (v.indexOf('read') >= 0) {
      return '只读';
    }
    if (v === 'auto' || v === 'default' || v.indexOf('auto') >= 0) {
      return '自动审查';
    }
    return id;
  }

  /** 打开权限弹窗 */
  private openPermissionPicker(): void {
    this.pickerKind = 'permission';
    this.pickerTitle = '权限';
    this.pickerIntro = '权限预设用于控制新会话可以执行的操作。';
    this.pickerItems = [];
    this.pickerOpen = true;
  }

  /** 预设选项：应用名称/描述映射（对齐小程序 pickAgentPreset） */
  private presetOptions(): PresetOption[] {
    const source: PresetOption[] = this.agentPresetDetails.length > 0
      ? this.agentPresetDetails
      : this.fallbackPresetOptions();
    const mapped: PresetOption[] = [];
    const limit: number = source.length > 8 ? 8 : source.length;
    for (let i = 0; i < limit; i++) {
      const one: PresetOption = source[i];
      mapped.push({
        id: one.id,
        label: this.presetDisplayName(one.label, one.id),
        description: this.presetBlurb(one.id, one.description),
        broken: one.broken,
        brokenReason: one.brokenReason
      });
    }
    return mapped;
  }

  /** 网关未下发详细列表时的内置预设兜底（同小程序） */
  private fallbackPresetOptions(): PresetOption[] {
    const ids: string[] = ['standard', 'code', 'minimal', 'cordis'];
    const out: PresetOption[] = [];
    for (const id of ids) {
      out.push({ id: id, label: '', description: '', broken: false, brokenReason: '' });
    }
    return out;
  }

  private isCurrentPreset(id: string): boolean {
    // 优先用户本次选择（存 id），其次部署级默认（网关下发的是 id）
    const current: string = this.pickPresetId.length > 0
      ? this.pickPresetId
      : this.defaultPreset;
    if (current.length === 0) {
      return id === 'standard';
    }
    return current === id;
  }

  private applyPreset(id: string, label: string): void {
    this.pickPresetId = id;
    this.pickPreset = label;
    PreferencesStore.get().putString('defaultAgentPreset', id);
    this.pickerOpen = false;
    this.hint = '已切换为「' + label + '」，仅对新建会话生效';
  }

  /** Agent 预设：改为二级页面（复用 pref-picker，动态选项写 AppStorage） */
  private openPresetPicker(): void {
    const defs: PresetOption[] = this.presetOptions();
    let hasCordis: boolean = false;
    const pickItems: PresetPickOption[] = [];
    for (const one of defs) {
      if (one.id === 'cordis') {
        hasCordis = true;
      }
      pickItems.push({
        id: one.id,
        label: one.label,
        // 损坏预设置灰不可选，描述里带原因（对齐卡片弹窗的 ⚠ 提示）
        detail: one.broken
          ? ('⚠ ' + (one.brokenReason.length > 0 ? one.brokenReason : '该预设存在配置错误，暂时不能设为默认值'))
          : one.description,
        disabled: one.broken
      });
    }
    AppStorage.setOrCreate<string>('sessionPresetPickerJson', JSON.stringify(pickItems));
    AppStorage.setOrCreate<boolean>('sessionPresetCreatorAvailable', hasCordis);
    AppStorage.setOrCreate<string>('prefPickerKind', 'session-agent-preset');
    AppStorage.setOrCreate<string>('prefPickerValue',
      this.pickPresetId.length > 0 ? this.pickPresetId : this.defaultPreset);
    this.pageStack.pushPathByName('pref-picker', null);
  }

  /** 从 pref-picker 返回后消费选择：__create__ 走创造模式，其余应用为默认预设 */
  private consumePresetChoice(): void {
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
    if (kind !== 'session-agent-preset') {
      return;
    }
    const id: string = raw.substring(sep + 1);
    if (id === '__create__') {
      // 延迟一拍：onShown 期间再推会话路由，等导航栈稳定
      setTimeout(() => this.createCustomPreset(), 60);
      return;
    }
    let label: string = id;
    for (const one of this.presetOptions()) {
      if (one.id === id) {
        label = one.label;
        break;
      }
    }
    this.applyPreset(id, label);
  }

  /** 添加自定义 Agent 预设：新建创造模式会话并打开（对齐小程序 createCustomAgentPreset） */
  private createCustomPreset(): void {
    if (this.creatingPreset) {
      return;
    }
    if (this.connection !== 'connected') {
      // 弹窗打开时页面的 hint 会被遮住，必须用可见提示
      this.pickerOpen = false;
      this.hint = '请先连接网关';
      try {
        this.getUIContext().getPromptAction().showToast({ message: '请先连接网关', duration: 2000 });
      } catch (ignored) {
      }
      return;
    }
    this.creatingPreset = true;
    this.hint = '正在创建创造模式会话…';
    try {
      this.getUIContext().getPromptAction().showToast({ message: '正在创建创造模式会话…', duration: 1500 });
    } catch (ignored) {
    }
    const workspaceId: string = this.currentWorkspaceId();
    GatewayClient.get().createSession(workspaceId, 'cordis').then((sessionId: string) => {
      this.creatingPreset = false;
      this.pickerOpen = false;
      this.hint = '';
      SessionStore.get().open(sessionId);
      openSessionRoute(this.pageStack);
    }).catch((err: Error) => {
      this.creatingPreset = false;
      this.pickerOpen = false;
      const raw: string = err.message.length > 0 ? err.message : '无法打开创造模式';
      const msg: string = raw.length > 0 ? raw : '当前 DSH 配置未提供创造模式';
      this.hint = msg;
      try {
        this.getUIContext().getPromptAction().showToast({ message: msg, duration: 2500 });
      } catch (ignored) {
      }
    });
  }

  /** 当前工作区 id（无则空串，由网关用默认工作区） */
  private currentWorkspaceId(): string {
    // 取首个带 cwd 的会话所属工作区；没有则交由网关默认
    if (this.sessions.length > 0) {
      const cwd: string = this.sessions[0].cwd;
      if (cwd.length > 0) {
        for (const ws of this.workspaces) {
          if (ws.path === cwd) {
            return ws.workspaceId;
          }
        }
      }
    }
    return '';
  }
}
