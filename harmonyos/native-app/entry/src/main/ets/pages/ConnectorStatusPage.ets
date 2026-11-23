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
  @State private checking: boolean = false;
  @State private refreshedAt: number = 0;

  private timer: number = -1;

  aboutToAppear(): void {
    DeviceConnectors.bind();
    this.refresh();
    this.timer = setInterval(() => {
      this.refresh();
    }, 10000);
  }

  aboutToDisappear(): void {
    if (this.timer >= 0) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private refresh(): void {
    this.checking = true;
    DeviceConnectors.refreshStatus();
    setTimeout(() => {
      this.checking = false;
      this.refreshedAt = Date.now();
    }, 900);
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
    if (this.state === 'registering') {
      return '正在把本机能力登记到网关，通常一两秒内完成。';
    }
    if (this.state === 'unverified') {
      return '没有收到网关确认。请检查网络连接后点「重新注册」。';
    }
    if (this.state === 'unsupported') {
      return '当前网关版本较旧，没有连接器能力。请升级网关插件并重启服务，然后重新连接。';
    }
    if (this.state === 'failed') {
      return '网关拒绝了本次注册。请确认网关插件已更新，再重新注册。';
    }
    if (this.state === 'registered') {
      return '';
    }
    return '聊天连接正常，但网关还没有这次连接的能力登记。点「重新注册」即可。';
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

  private stateIcon(): Resource {
    if (this.state === 'registered') {
      return $r('app.media.connector_status_caps');
    }
    return $r('app.media.connector_status_caps');
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

  private clockLabel(millis: number): string {
    if (millis <= 0) {
      return '';
    }
    const date: Date = new Date(millis);
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

  private statusTint(): string {
    const color: string = this.stateColor();
    return color + '1F';
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
          Column({ space: 10 }) {
            // ── 状态总览 ──
            Column() {
              Row({ space: 14 }) {
                Stack({ alignContent: Alignment.Center }) {
                  if (this.state === 'registering' || this.checking) {
                    LoadingProgress().width(30).height(30).color(this.stateColor())
                  } else {
                    Circle({ width: 16, height: 16 }).fill(this.stateColor())
                  }
                }
                .width(36)
                .height(36)

                Column({ space: 4 }) {
                  Text(this.stateTitle())
                    .fontSize(17)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Text(this.state === 'registered'
                    ? '网关已确认 ' + this.toolCount.toString() + ' 项能力'
                    : '轻点下方按钮重试')
                    .fontSize(13)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 18, bottom: 16 })

              if (this.state !== 'registered') {
                Text(this.stateDetail())
                  .fontSize(13)
                  .lineHeight(20)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, bottom: 16 })
              }

              if (this.state === 'registered' && this.clockLabel(this.confirmedAt).length > 0) {
                Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                Row() {
                  Text('最近确认')
                    .fontSize(13)
                    .fontColor(this.subColor())
                  Blank()
                  Text(this.clockLabel(this.confirmedAt))
                    .fontSize(13)
                    .fontColor(this.textColor())
                }
                .width('100%')
                .height(44)
                .padding({ left: 16, right: 16 })
              }
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)

            // ── 已登记能力 ──
            if (this.state === 'registered') {
              Column() {
                Row({ space: 12 }) {
                  Image($r('app.media.connector_status_caps'))
                    .width(30)
                    .height(30)
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
                .height(62)
                .padding({ left: 16, right: 16 })
                .onClick(() => {
                  this.expanded = !this.expanded;
                })

                if (this.expanded) {
                  Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                  ForEach(this.modules(), (row: ModuleRow, index: number) => {
                    Row() {
                      Text(row.title)
                        .fontSize(15)
                        .fontColor(this.textColor())
                      Blank()
                      Text(row.tools.toString() + ' 个工具')
                        .fontSize(13)
                        .fontColor(this.subColor())
                    }
                    .width('100%')
                    .height(44)
                    .padding({ left: 16, right: 16 })
                    if (index < this.modules().length - 1) {
                      Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                    }
                  }, (row: ModuleRow) => row.id)
                }
              }
              .width('100%')
              .backgroundColor(this.cardBg())
              .borderRadius(14)
              .clip(true)
            }

            // ── 操作 ──
            Column() {
              Row() {
                Row({ space: 8 }) {
                  if (this.checking) {
                    LoadingProgress().width(16).height(16).color('#2E6BE6')
                  }
                  Text(this.checking ? '刷新中…' : '刷新状态')
                    .fontSize(15)
                    .fontColor('#2E6BE6')
                }
                .onClick(() => {
                  this.refresh();
                })
                Blank()
                Text('重新注册')
                  .fontSize(15)
                  .fontColor('#2E6BE6')
                  .onClick(() => {
                    DeviceConnectors.retryRegister();
                    this.refresh();
                  })
              }
              .width('100%')
              .height(50)
              .padding({ left: 16, right: 16 })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)

            if (this.clockLabel(this.refreshedAt).length > 0) {
              Text('每 10 秒自动刷新 · 上次 ' + this.clockLabel(this.refreshedAt))
                .fontSize(11.5)
                .fontColor(this.subColor())
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 4 })
            }
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
  }
}
