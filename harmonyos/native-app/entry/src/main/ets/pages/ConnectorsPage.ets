import { common, Want } from '@kit.AbilityKit';
import { NavBackButton } from '../components/NavBackButton';
import { CONNECTOR_MODULES, ConnectorModuleDefinition, DeviceConnectors } from 'nativecore';
import { SETTINGS_MAX_WIDTH } from '../common/Responsive';

@Component
export struct ConnectorsPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectorsState') state: string = 'disconnected';
  @StorageLink('connectorsEnabled') @Watch('onEnabledChanged') enabledJson: string = '{}';
  @StorageLink('connectorsAvailable') availableFlags: string = '00000000';
  @StorageLink('connectorsToolCount') toolCount: number = 0;
  @StorageLink('connectorsNotice') notice: string = '';
  @StorageProp('safeTopVp') safeTop: number = 0;
  @StorageProp('safeBottomVp') safeBottom: number = 0;
  @State private switchState: Record<string, boolean> = {};
  @State private permDialogOpen: boolean = false;
  @State private permDialogTitle: string = '';
  @State private permDialogBody: string = '';

  aboutToAppear(): void {
    DeviceConnectors.bind();
    this.syncEnabled();
    DeviceConnectors.refreshStatus();
  }

  /** 别的页面（如能力详情弹窗）改了开关：同步本页状态，避免返回后仍显示为关闭 */
  private onEnabledChanged(): void {
    this.syncEnabled();
  }

  private syncEnabled(): void {
    try {
      this.switchState = JSON.parse(this.enabledJson) as Record<string, boolean>;
    } catch (err) {
      this.switchState = {};
    }
  }

  private isAvailable(index: number): boolean {
    return this.availableFlags.length > index && this.availableFlags.charAt(index) === '1';
  }

  private moduleIcon(id: string): Resource {
    if (id === 'calendar') {
      return $r('app.media.ic_connector_calendar');
    }
    if (id === 'reminders') {
      return $r('app.media.ic_connector_reminders');
    }
    if (id === 'location') {
      return $r('app.media.ic_connector_location');
    }
    if (id === 'photos') {
      return $r('app.media.ic_connector_photos');
    }
    if (id === 'music') {
      return $r('app.media.ic_connector_music');
    }
    if (id === 'health') {
      return $r('app.media.ic_connector_health');
    }
    if (id === 'maps') {
      return $r('app.media.ic_connector_location');
    }
    return $r('app.media.ic_connector_alarms');
  }

  private stateColor(): string {
    if (this.state === 'registered') {
      return '#34C759';
    }
    if (this.state === 'failed') {
      return '#FF3B30';
    }
    if (this.state === 'registering' || this.state === 'unverified' || this.state === 'unsupported') {
      return '#FF9500';
    }
    return '#8E8E93';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  /** 玻璃卡片底：深色用微亮半透明，浅色用高透白，叠在氛围渐变上 */
  private cardFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.74)';
  }

  private cardBorder(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.85)';
  }

  private cardShadow(): ShadowOptions {
    return {
      radius: 18,
      color: this.isDark ? 'rgba(0,0,0,0.38)' : 'rgba(23,43,77,0.09)',
      offsetX: 0,
      offsetY: 8
    };
  }

  private textColor(): string {
    return this.isDark ? '#FFFFFF' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private pageBg(): string {
    // 纯色背景：深色深海蓝黑、浅色冷白（不再用渐变/光晕）
    return this.isDark ? '#0C1017' : '#F5F7FA';
  }

  /** 跳到系统「应用信息 / 权限」页（本 App 的设置页） */
  private openPermissionSettings(): void {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const want: Want = {
        bundleName: 'com.huawei.hmos.settings',
        abilityName: 'com.huawei.hmos.settings.MainAbility',
        uri: 'application_info_entry',
        parameters: { pushParams: context.abilityInfo.bundleName }
      };
      context.startAbility(want).catch(() => {
        this.notice = '请在「设置 > 应用和元服务 > 鲸尾 > 权限」中开启';
      });
    } catch (err) {
      this.notice = '请在「设置 > 应用和元服务 > 鲸尾 > 权限」中开启';
    }
  }

  build() {
    NavDestination() {
      Column() {
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })
          Blank()
          Row().width(40)
        }
        .width('100%')
        .height(44)
        .padding({ left: 8, right: 8 })
        .margin({ top: this.safeTop > 0 ? this.safeTop : 38.9 })

        Scroll() {
          Column({ space: 12 }) {
            Column({ space: 6 }) {
              Text('连接器')
                .fontSize(30)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.textColor())
                .width('100%')
              Text('让 Agent 调用手机的系统能力')
                .fontSize(13)
                .fontColor(this.subColor())
                .width('100%')
            }
            .width('100%')
            .padding({ left: 4, top: 2, bottom: 10 })
            // 连接器状态入口
            Column() {
              Row({ space: 8 }) {
                Text('连接器状态')
                  .fontSize(16)
                  .fontColor(this.textColor())
                Blank()
                Circle({ width: 8, height: 8 }).fill(this.stateColor())
                Image($r('app.media.ic_dir_chevron_mist'))
                  .width(12)
                  .height(12)
                  .fillColor(this.subColor())
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.pageStack.pushPathByName('connector-status', null);
              })
            }
            .width('100%')
            .backgroundColor(this.cardFill())
            .backdropBlur(this.isDark ? 30 : 22)
            .border({ width: 1, color: this.cardBorder() })
            .borderRadius(16)
            .shadow(this.cardShadow())

            Text('本机能力')
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 16, top: 12, bottom: 6 })

            Column() {
              ForEach(CONNECTOR_MODULES, (module: ConnectorModuleDefinition, index: number) => {
                Row({ space: 12 }) {
                  Image(this.moduleIcon(module.id))
                    .width(40)
                    .height(40)
                    .borderRadius(10)
                    .objectFit(ImageFit.Contain)
                    .clip(true)
                  Column({ space: 2 }) {
                    Text(module.title)
                      .fontSize(16)
                      .fontColor(this.isAvailable(index) ? this.textColor() : this.subColor())
                    if (!this.isAvailable(index)) {
                      Text('当前设备暂不支持')
                        .fontSize(11)
                        .fontColor(this.subColor())
                    }
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Toggle({ type: ToggleType.Switch, isOn: this.switchState[module.id] === true })
                    .selectedColor('#2E6BE6')
                    .enabled(this.isAvailable(index))
                    .onChange((value: boolean) => {
                      DeviceConnectors.setEnabled(module.id, value).then((ok: boolean) => {
                        this.syncEnabled();
                        if (!ok) {
                          this.permDialogTitle = module.title + '权限未开启';
                          this.permDialogBody = '「' + module.title + '」需要系统权限才能接入 Agent。请到应用设置里允许后再回来打开开关。';
                          this.permDialogOpen = true;
                        }
                      });
                    })
                }
                .width('100%')
                .padding({ left: 16, right: 16, top: 12, bottom: 12 })
                if (index < CONNECTOR_MODULES.length - 1) {
                  Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 62, right: 16 })
                }
              }, (module: ConnectorModuleDefinition) => module.id)
            }
            .width('100%')
            .backgroundColor(this.cardFill())
            .backdropBlur(this.isDark ? 30 : 22)
            .border({ width: 1, color: this.cardBorder() })
            .borderRadius(16)
            .shadow(this.cardShadow())
            .clip(true)

            if (this.notice.length > 0) {
              Text(this.notice)
                .fontSize(12)
                .fontColor('#FF9500')
                .width('100%')
                .padding({ left: 16, right: 16, top: 4 })
            }

            Column() {
              Row() {
                Text('打开系统权限设置')
                  .fontSize(16)
                  .fontColor('#2E6BE6')
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.openPermissionSettings();
              })
            }
            .width('100%')
            .backgroundColor(this.cardFill())
            .backdropBlur(this.isDark ? 30 : 22)
            .border({ width: 1, color: this.cardBorder() })
            .borderRadius(16)
            .shadow(this.cardShadow())
            .margin({ top: 8 })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 8, bottom: 24 + this.safeBottom })
        }
        .layoutWeight(1)
        .width('100%')
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
        // 平板/宽屏：设置内容居中一栏（对齐 iOS iPad 设置页）
        .constraintSize({ maxWidth: SETTINGS_MAX_WIDTH })
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Start)
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
    .onShown(() => {
      // 从连接器状态/能力弹窗返回时兜底同步一次开关状态
      this.syncEnabled();
    })
    .bindContentCover(this.permDialogOpen, this.permissionDialog(), {
      modalTransition: ModalTransition.DEFAULT,
      backgroundColor: 'rgba(0,0,0,0.35)'
    })
  }

  @Builder
  permissionDialog() {
    Column({ space: 14 }) {
      Text(this.permDialogTitle)
        .fontSize(17)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.textColor())
        .width('100%')
        .textAlign(TextAlign.Center)
      Text(this.permDialogBody)
        .fontSize(13.5)
        .lineHeight(20)
        .fontColor(this.subColor())
        .width('100%')
      Row({ space: 10 }) {
        Text('稍后')
          .fontSize(15)
          .fontColor(this.textColor())
          .layoutWeight(1)
          .height(42)
          .textAlign(TextAlign.Center)
          .borderRadius(10)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)')
          .onClick(() => {
            this.permDialogOpen = false;
          })
        Text('去设置')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .layoutWeight(1)
          .height(42)
          .textAlign(TextAlign.Center)
          .borderRadius(10)
          .backgroundColor('#2E6BE6')
          .onClick(() => {
            this.permDialogOpen = false;
            this.openPermissionSettings();
          })
      }
      .width('100%')
      .margin({ top: 4 })
    }
    .width('84%')
    .padding(20)
    .borderRadius(20)
    .backgroundColor(this.cardFill())
    .backdropBlur(this.isDark ? 40 : 30)
    .border({ width: 1, color: this.cardBorder() })
    .shadow({ radius: 24, color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.16)' })
  }
}
