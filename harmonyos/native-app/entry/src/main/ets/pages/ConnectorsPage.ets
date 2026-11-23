import { common, Want } from '@kit.AbilityKit';
import { NavBackButton } from '../components/NavBackButton';
import { CONNECTOR_MODULES, ConnectorModuleDefinition, DeviceConnectors } from 'nativecore';

@Component
export struct ConnectorsPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectorsState') state: string = 'disconnected';
  @StorageLink('connectorsEnabled') enabledJson: string = '{}';
  @StorageLink('connectorsAvailable') availableFlags: string = '0000000';
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
    return this.isDark ? '#000000' : '#F2F2F7';
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
          Text('连接器')
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.textColor())
            .layoutWeight(1)
            .textAlign(TextAlign.Center)
          Row().width(40)
        }
        .width('100%')
        .height(44)
        .padding({ left: 8, right: 8 })
        .margin({ top: this.safeTop > 0 ? this.safeTop : 38.9 })

        Scroll() {
          Column({ space: 8 }) {
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
            .backgroundColor(this.cardBg())
            .borderRadius(12)

            Text('本机能力')
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 16, top: 12, bottom: 6 })

            Column() {
              ForEach(CONNECTOR_MODULES, (module: ConnectorModuleDefinition, index: number) => {
                Row({ space: 12 }) {
                  Image(this.moduleIcon(module.id))
                    .width(36)
                    .height(36)
                    .objectFit(ImageFit.Contain)
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
                .padding({ left: 16, right: 14, top: 10, bottom: 10 })
                if (index < CONNECTOR_MODULES.length - 1) {
                  Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 62, right: 16 })
                }
              }, (module: ConnectorModuleDefinition) => module.id)
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(12)
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
            .backgroundColor(this.cardBg())
            .borderRadius(12)
            .margin({ top: 8 })
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 8, bottom: 24 + this.safeBottom })
        }
        .layoutWeight(1)
        .width('100%')
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Start)
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
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
    .borderRadius(16)
    .backgroundColor(this.cardBg())
    .shadow({ radius: 24, color: 'rgba(0,0,0,0.18)' })
  }
}
