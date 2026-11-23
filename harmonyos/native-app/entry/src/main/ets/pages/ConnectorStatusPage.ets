import { NavBackButton } from '../components/NavBackButton';
import { CONNECTOR_MODULES, ConnectorModuleDefinition, DeviceConnectors } from 'nativecore';

interface ModuleRow {
  id: string;
  title: string;
  tools: number;
}

@Component
export struct ConnectorStatusPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectorsState') state: string = 'disconnected';
  @StorageLink('connectorsToolCount') toolCount: number = 0;
  @StorageLink('connectorsDetail') detail: string = '';
  @StorageLink('connectorsConfirmedAt') confirmedAt: number = 0;
  @StorageProp('safeTopVp') safeTop: number = 0;
  @StorageProp('safeBottomVp') safeBottom: number = 0;
  @State private expanded: boolean = false;

  aboutToAppear(): void {
    DeviceConnectors.bind();
    DeviceConnectors.refreshStatus();
  }

  private stateTitle(): string {
    if (this.state === 'registered') {
      return '网关已注册';
    }
    if (this.state === 'registering') {
      return '正在注册连接器';
    }
    if (this.state === 'unverified') {
      return '注册状态未确认';
    }
    if (this.state === 'unsupported') {
      return '网关不支持连接器';
    }
    if (this.state === 'failed') {
      return '连接器注册失败';
    }
    return '已连接，连接器未注册';
  }

  private stateDetail(): string {
    if (this.state === 'registered') {
      return '';
    }
    if (this.state === 'registering') {
      return '正在向网关登记本机能力，请稍候。';
    }
    if (this.state === 'unverified') {
      return '未收到网关确认，请检查连接并重新注册。';
    }
    if (this.state === 'unsupported') {
      return '当前网关版本过旧，升级网关插件后重新连接。';
    }
    if (this.state === 'failed') {
      return '网关未接受本次注册，请检查网关版本并重新注册。';
    }
    return '聊天连接正常，但网关没有当前连接的能力登记。请重新注册。';
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

  private modules(): ModuleRow[] {
    const rows: ModuleRow[] = [];
    if (this.detail.length === 0) {
      return rows;
    }
    this.detail.split(',').forEach((part: string) => {
      const seg: string[] = part.split(':');
      if (seg.length < 2) {
        return;
      }
      const id: string = seg[0];
      const count: number = Number.parseInt(seg[1], 10);
      let title: string = id;
      CONNECTOR_MODULES.forEach((m: ConnectorModuleDefinition) => {
        if (m.id === id) {
          title = m.title;
        }
      });
      rows.push({ id: id, title: title, tools: Number.isNaN(count) ? 0 : count });
    });
    return rows;
  }

  private confirmedLabel(): string {
    if (this.confirmedAt <= 0) {
      return '';
    }
    const date: Date = new Date(this.confirmedAt);
    const hh: string = date.getHours().toString().padStart(2, '0');
    const mm: string = date.getMinutes().toString().padStart(2, '0');
    const ss: string = date.getSeconds().toString().padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
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
      Column() {
        Row() {
          NavBackButton({ isDark: this.isDark })
          Text('连接器状态')
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
            Text('网关注册')
              .fontSize(13)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 16, top: 8, bottom: 6 })

            Column() {
              Row({ space: 9 }) {
                Circle({ width: 8, height: 8 }).fill(this.stateColor())
                Text(this.stateTitle())
                  .fontSize(16)
                  .fontColor(this.textColor())
                Blank()
                if (this.state === 'registering') {
                  LoadingProgress().width(16).height(16).color(this.subColor())
                }
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              if (this.state === 'registered') {
                Row() {
                  Text('网关已确认')
                    .fontSize(14)
                    .fontColor(this.subColor())
                  Blank()
                  Text(this.toolCount.toString() + ' 项能力')
                    .fontSize(14)
                    .fontColor(this.textColor())
                }
                .width('100%')
                .height(40)
                .padding({ left: 16, right: 16 })
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
              } else {
                Text(this.stateDetail())
                  .fontSize(13)
                  .lineHeight(19)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, bottom: 12 })
              }
              if (this.state === 'registered' && this.confirmedLabel().length > 0) {
                Text('最近确认 ' + this.confirmedLabel())
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 8, bottom: 12 })
              }
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(12)

            if (this.state === 'registered') {
              Column() {
                Row({ space: 12 }) {
                  Image($r('app.media.connector_status_caps'))
                    .width(26)
                    .height(26)
                    .objectFit(ImageFit.Contain)
                  Column({ space: 2 }) {
                    Text('网关已登记的能力')
                      .fontSize(16)
                      .fontColor(this.textColor())
                    Text(this.modules().length.toString() + ' 个模块 · ' + this.toolCount.toString() + ' 个工具')
                      .fontSize(12)
                      .fontColor(this.subColor())
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                  Image($r('app.media.ic_dir_chevron_mist'))
                    .width(12)
                    .height(12)
                    .fillColor(this.subColor())
                    .rotate({ angle: this.expanded ? 90 : 0 })
                }
                .width('100%')
                .height(56)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.expanded = !this.expanded;
                })
                if (this.expanded) {
                  ForEach(this.modules(), (row: ModuleRow) => {
                    Row() {
                      Text(row.title)
                        .fontSize(14)
                        .fontColor(this.textColor())
                      Blank()
                      Text(row.tools.toString() + ' 个工具')
                        .fontSize(13)
                        .fontColor(this.subColor())
                    }
                    .width('100%')
                    .height(40)
                    .padding({ left: 16, right: 16 })
                  }, (row: ModuleRow) => row.id)
                }
              }
              .width('100%')
              .backgroundColor(this.cardBg())
              .borderRadius(12)
              .clip(true)
            }

            Column() {
              Row() {
                Text('刷新状态')
                  .fontSize(15)
                  .fontColor('#2E6BE6')
                  .onClick(() => {
                    DeviceConnectors.refreshStatus();
                  })
                Blank()
                Text('重新注册')
                  .fontSize(15)
                  .fontColor('#2E6BE6')
                  .onClick(() => {
                    DeviceConnectors.retryRegister();
                  })
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(12)
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4, bottom: 24 + this.safeBottom })
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
  }
}
