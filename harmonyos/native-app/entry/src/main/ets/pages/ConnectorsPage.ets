import { NavBackButton } from '../components/NavBackButton';
import { CONNECTOR_MODULES, ConnectorModuleDefinition, DeviceConnectors } from 'nativecore';

@Component
export struct ConnectorsPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectorsState') state: string = 'disconnected';
  @StorageLink('connectorsEnabled') enabledJson: string = '{}';
  @StorageLink('connectorsAvailable') availableFlags: string = '0000000';
  @StorageLink('connectorsToolCount') toolCount: number = 0;
  @StorageLink('connectorsNotice') notice: string = '';
  @StorageProp('safeTopVp') safeTop: number = 0;
  @StorageProp('safeBottomVp') safeBottom: number = 0;

  private timer: number = -1;
  @State private switchState: Record<string, boolean> = {};

  aboutToAppear(): void {
    DeviceConnectors.bind();
    this.syncEnabled();
    DeviceConnectors.refreshStatus();
    this.timer = setInterval(() => {
      DeviceConnectors.refreshStatus();
    }, 10000);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
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

  private stateLabel(): string {
    if (this.state === 'registered') {
      return '已登记';
    }
    if (this.state === 'registering') {
      return '注册中…';
    }
    if (this.state === 'unverified') {
      return '未确认';
    }
    if (this.state === 'unsupported') {
      return '网关不支持';
    }
    if (this.state === 'failed') {
      return '登记失败';
    }
    return '未登记';
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

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
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
            Column({ space: 14 }) {
              Column({ space: 10 }) {
                Row({ space: 8 }) {
                  Circle({ width: 8, height: 8 }).fill(this.stateColor())
                  Text(this.stateLabel())
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Blank()
                  Text('已登记工具 ' + this.toolCount.toString())
                    .fontSize(12)
                    .fontColor(this.subColor())
                }
                .width('100%')

                Text('把手机的系统能力（日历、提醒、位置、照片、音乐、健康、闹钟）接入 Agent。开关按当前主机保存，已开启的连接器不会逐次确认。')
                  .fontSize(12)
                  .lineHeight(18)
                  .fontColor(this.subColor())
                  .width('100%')

                if (this.notice.length > 0) {
                  Text(this.notice)
                    .fontSize(12)
                    .fontColor('#FF9500')
                    .width('100%')
                }

                Row({ space: 10 }) {
                  Text('刷新状态')
                    .fontSize(13)
                    .fontColor('#2E6BE6')
                    .layoutWeight(1)
                    .height(34)
                    .textAlign(TextAlign.Center)
                    .borderRadius(8)
                    .border({ width: 1, color: this.dividerColor() })
                    .onClick(() => {
                      DeviceConnectors.refreshStatus();
                    })
                  Text('重新注册')
                    .fontSize(13)
                    .fontColor('#2E6BE6')
                    .layoutWeight(1)
                    .height(34)
                    .textAlign(TextAlign.Center)
                    .borderRadius(8)
                    .border({ width: 1, color: this.dividerColor() })
                    .onClick(() => {
                      DeviceConnectors.retryRegister();
                    })
                }
                .width('100%')
              }
              .width('100%')
              .padding(16)
              .alignItems(HorizontalAlign.Start)
              .backgroundColor(this.cardBg())
              .border({ width: 1, color: this.dividerColor() })
              .borderRadius(14)

              Column() {
                ForEach(CONNECTOR_MODULES, (module: ConnectorModuleDefinition, index: number) => {
                  Row({ space: 12 }) {
                    Column({ space: 3 }) {
                      Text(module.title)
                        .fontSize(16)
                        .fontColor(this.isAvailable(index) ? this.textColor() : this.subColor())
                      Text(this.isAvailable(index) ? module.subtitle : '当前设备暂不支持')
                        .fontSize(12)
                        .fontColor(this.subColor())
                    }
                    .alignItems(HorizontalAlign.Start)
                    .layoutWeight(1)

                    Toggle({ type: ToggleType.Switch, isOn: this.switchState[module.id] === true })
                      .selectedColor('#2E6BE6')
                      .enabled(this.isAvailable(index))
                      .onChange((value: boolean) => {
                        DeviceConnectors.setEnabled(module.id, value).then((ok: boolean) => {
                          this.syncEnabled();
                        });
                      })
                  }
                  .width('100%')
                  .padding({ left: 16, right: 12, top: 12, bottom: 12 })
                  if (index < CONNECTOR_MODULES.length - 1) {
                    Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                  }
                }, (module: ConnectorModuleDefinition) => module.id)
              }
              .width('100%')
              .backgroundColor(this.cardBg())
              .border({ width: 1, color: this.dividerColor() })
              .borderRadius(14)
              .clip(true)

              Text('连接器能力由手机端直接执行，网关只负责调用与权限登记；关闭开关会撤销对应工具。')
                .fontSize(11)
                .lineHeight(17)
                .fontColor(this.subColor())
                .width('100%')
                .padding({ left: 4, right: 4 })
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 8, bottom: 24 + this.safeBottom })
          }
          .layoutWeight(1)
          .width('100%')
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .height('100%')
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
