import { http } from '@kit.NetworkKit';
import { GatewayClient, SavedGateway } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';

class NetProbe {
  url: string = '';
  label: string = '';
  ok: boolean = false;
  ms: number = 0;
  note: string = '';
}

@Component
export struct NetworkPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('activeEndpoint') activeEndpoint: string = '';

  @State probing: boolean = false;
  @State probes: NetProbe[] = [];
  @State hint: string = '';

  private topInset(): number {
    return this.safeTopStorage > 0 ? this.safeTopStorage : 38.9;
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.62)';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.07)';
  }

  private stateLabel(): string {
    if (this.connection === 'connected') {
      return '已连接';
    }
    if (this.connection === 'connecting') {
      return '连接中';
    }
    return '未连接';
  }

  private stateColor(): string {
    if (this.connection === 'connected') {
      return '#34C759';
    }
    if (this.connection === 'connecting') {
      return '#FF9F0A';
    }
    return '#8E8E93';
  }

  private portLabel(): string {
    const url: string = this.activeEndpoint.length > 0 ? this.activeEndpoint : '';
    const match: RegExpMatchArray | null = url.match(/:([0-9]{2,5})(\/|$)/);
    return match !== null && match.length > 1 ? ('Port ' + match[1]) : 'Port —';
  }

  /** ws(s)://host:port/path → http(s)://host:port/ 用于连通性探测 */
  private httpOf(wsUrl: string): string {
    let url: string = wsUrl;
    if (url.startsWith('wss://')) {
      url = 'https://' + url.substring(6);
    } else if (url.startsWith('ws://')) {
      url = 'http://' + url.substring(5);
    }
    const slash: number = url.indexOf('/', url.indexOf('://') + 3);
    return slash > 0 ? url.substring(0, slash + 1) : url + '/';
  }

  private candidates(): string[] {
    const out: string[] = [];
    const saved: SavedGateway[] = GatewayClient.get().savedGateways();
    for (const one of saved) {
      if (this.activeEndpoint.length > 0 && one.wsUrl === this.activeEndpoint && out.indexOf(one.wsUrl) < 0) {
        out.push(one.wsUrl);
      }
      const list: string[] = one.endpoints !== undefined ? one.endpoints : [];
      for (const url of list) {
        if (url.length > 0 && out.indexOf(url) < 0) {
          out.push(url);
        }
      }
    }
    if (this.activeEndpoint.length > 0 && out.indexOf(this.activeEndpoint) < 0) {
      out.unshift(this.activeEndpoint);
    }
    return out.slice(0, 8);
  }

  private probeOne(url: string): Promise<NetProbe> {
    return new Promise<NetProbe>((resolve: (p: NetProbe) => void) => {
      const item: NetProbe = new NetProbe();
      item.url = url;
      item.label = this.httpOf(url);
      const req = http.createHttp();
      const started: number = Date.now();
      req.request(item.label, {
        method: http.RequestMethod.GET,
        connectTimeout: 2500,
        readTimeout: 2500
      }).then((resp: http.HttpResponse) => {
        item.ms = Date.now() - started;
        item.ok = resp.responseCode > 0 && resp.responseCode < 500;
        item.note = item.ok ? (item.ms + ' ms') : ('HTTP ' + resp.responseCode);
        req.destroy();
        resolve(item);
      }).catch((err: Error) => {
        item.ms = Date.now() - started;
        item.ok = false;
        item.note = this.shortError(err.message);
        try {
          req.destroy();
        } catch (ignored) {
        }
        resolve(item);
      });
    });
  }

  private shortError(msg: string): string {
    if (msg.length > 40) {
      return msg.substring(0, 40) + '…';
    }
    return msg.length > 0 ? msg : '不可达';
  }

  private async runProbes(): Promise<void> {
    if (this.probing) {
      return;
    }
    const urls: string[] = this.candidates();
    if (urls.length === 0) {
      this.hint = '还没有已保存的端点，先连接一次网关';
      return;
    }
    this.probing = true;
    this.hint = '';
    this.probes = [];
    const results: NetProbe[] = [];
    for (const url of urls) {
      const one: NetProbe = await this.probeOne(url);
      results.push(one);
      this.probes = results.slice();
    }
    this.probing = false;
    this.hint = '检测完成：' + results.filter((one: NetProbe) => one.ok).length + '/' + results.length + ' 个端点可达';
  }

  private pingGateway(): void {
    if (this.connection !== 'connected') {
      this.hint = '未连接网关，先点「连接」';
      return;
    }
    const started: number = Date.now();
    GatewayClient.get().requestHost().then(() => {
      this.hint = 'Ping 成功：' + (Date.now() - started) + ' ms';
    }).catch((err: Error) => {
      this.hint = 'Ping 失败：' + this.shortError(err.message);
    });
  }

  build() {
    NavDestination() {
      Column() {
        Stack({ alignContent: Alignment.TopStart }) {
          Column()
            .width('100%')
            .height(56 + this.topInset())
            .backdropBlur(12)
            .backgroundColor(Color.Transparent)
            .hitTestBehavior(HitTestMode.None)

          Row() {
            NavBackButton({ isDark: this.isDark })
              .onClick(() => {
                this.pageStack.pop();
              })
            Text('网络检测')
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
          .margin({ top: this.topInset() })
        }
        .width('100%')
        .zIndex(10)

        Scroll() {
          Column({ space: 14 }) {
            // 当前连接
            Column() {
              Row({ space: 8 }) {
                Circle().width(8).height(8).fill(this.stateColor())
                Text(this.stateLabel()).fontSize(15).fontColor(this.textColor())
                Blank()
                Text(this.portLabel()).fontSize(13).fontColor(this.subColor())
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 14, bottom: 6 })

              Text(this.activeEndpoint.length > 0 ? this.activeEndpoint : '尚未连接任何端点')
                .fontSize(12)
                .fontColor(this.subColor())
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .width('100%')
                .padding({ left: 16, right: 16, bottom: 10 })

              Row({ space: 10 }) {
                this.actionChip('连接', () => {
                  GatewayClient.get().autoConnect();
                })
                this.actionChip('Ping 网关', () => {
                  this.pingGateway();
                })
                if (this.connection === 'connected' || this.connection === 'connecting') {
                  this.actionChip('断开连接', () => {
                    GatewayClient.get().disconnect();
                  })
                }
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 2, bottom: 14 })
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)
            .border({ width: 1, color: this.dividerColor() })

            // 端点检测
            Column() {
              Row() {
                Text('端点可达性').fontSize(15).fontColor(this.textColor())
                Blank()
                Text(this.probing ? '检测中…' : '开始检测')
                  .fontSize(13.5)
                  .fontColor('#2E6BE6')
                  .onClick(() => {
                    this.runProbes();
                  })
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 14, bottom: 10 })

              if (this.probes.length === 0) {
                Text('检测当前保存的局域网 / 公网 / 隧道端点，显示往返耗时。')
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .width('100%')
                  .padding({ left: 16, right: 16, bottom: 14 })
              }
              ForEach(this.probes, (one: NetProbe) => {
                Column() {
                  Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                  Row() {
                    Circle().width(6).height(6).fill(one.ok ? '#34C759' : '#FF3B30')
                    Column({ space: 2 }) {
                      Text(one.label)
                        .fontSize(12)
                        .fontColor(this.textColor())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%')
                      Text(one.url)
                        .fontSize(10.5)
                        .fontColor(this.subColor())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%')
                    }
                    .alignItems(HorizontalAlign.Start)
                    .layoutWeight(1)
                    .margin({ left: 10 })
                    Text(one.note).fontSize(12).fontColor(one.ok ? '#34C759' : '#FF3B30')
                  }
                  .width('100%')
                  .padding({ left: 16, right: 16, top: 11, bottom: 11 })
                }
              }, (one: NetProbe) => one.url + one.note)
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)
            .border({ width: 1, color: this.dividerColor() })

            if (this.hint.length > 0) {
              Text(this.hint)
                .fontSize(12.5)
                .fontColor(this.subColor())
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 2, bottom: 20 })
            }
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4 + 56 + this.topInset(), bottom: 20 })
        }
        .layoutWeight(1)
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
        .margin({ top: -(56 + this.topInset()) })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
  }

  @Builder
  actionChip(label: string, onTap: () => void) {
    Text(label)
      .fontSize(13.5)
      .fontColor('#2E6BE6')
      .padding({ left: 12, right: 12, top: 7, bottom: 7 })
      .borderRadius(999)
      .backgroundColor(this.isDark ? 'rgba(46,107,230,0.20)' : 'rgba(46,107,230,0.10)')
      .onClick(onTap)
  }
}
