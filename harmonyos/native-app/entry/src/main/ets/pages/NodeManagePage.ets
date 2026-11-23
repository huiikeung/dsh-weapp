import { NavBackButton } from '../components/NavBackButton';
import { pasteboard } from '@kit.BasicServicesKit';
import { CredentialStore, GatewayClient } from 'nativecore';
import type { SavedGateway } from 'nativecore';

/** 节点管理：对齐小程序 settings 页「管理 → 节点管理」面板。 */
interface NodeRowView {
  id: string;
  name: string;
  online: boolean;
  active: boolean;
}

@Component
export struct NodeManagePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('gatewayName') gatewayName: string = '';
  @StorageLink('safeTopVp') safeTopStorage: number = 0;
  @StorageLink('safeBottomVp') safeBottomStorage: number = 0;

  @State nodes: NodeRowView[] = [];
  @State copiedHint: string = '';

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.55)' : 'rgba(16,19,24,0.55)';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(16,19,24,0.08)';
  }

  private innerFill(): string {
    return this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(16,19,24,0.05)';
  }

  aboutToAppear(): void {
    this.refresh();
  }

  private refresh(): void {
    const activeId: string = CredentialStore.get().activeGatewayId();
    const rows: NodeRowView[] = [];
    for (const saved of CredentialStore.get().list()) {
      const nodeId: string = saved.relayNodeId.length > 0 ? saved.relayNodeId : saved.wsUrl;
      const active: boolean = nodeId === activeId || saved.id === activeId;
      rows.push({
        id: nodeId,
        name: saved.name.length > 0 ? saved.name : (this.gatewayName.length > 0 ? this.gatewayName : '未命名节点'),
        online: active && this.connection === 'connected',
        active: active
      });
    }
    this.nodes = rows;
  }

  private onlineCount(): number {
    let n: number = 0;
    for (const row of this.nodes) {
      if (row.online) {
        n += 1;
      }
    }
    return n;
  }

  private copyNodeId(id: string): void {
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, id);
      pasteboard.getSystemPasteboard().setData(data).then(() => {
        this.copiedHint = '已复制节点 ID';
        setTimeout(() => {
          this.copiedHint = '';
        }, 1600);
      }).catch((err: Error) => {
        this.copiedHint = '复制失败';
      });
    } catch (err) {
      this.copiedHint = '复制失败';
    }
  }

  build() {
    NavDestination() {
      Column() {
        // 头部：返回 + 标题
        Row() {
          NavBackButton({ isDark: this.isDark })
            .onClick(() => {
              this.pageStack.pop();
            })
          Blank()
          Text('节点管理')
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
          Column({ space: 0 }) {
            // 组头：在线数 + 刷新
            Row() {
              Text(this.onlineCount().toString() + ' 在线 · ' + this.nodes.length.toString() + ' 个节点')
                .fontSize(13.5)
                .fontColor(this.subColor())
              Blank()
              Text('刷新')
                .fontSize(13.5)
                .fontColor('#2E6BE6')
                .onClick(() => {
                  this.refresh();
                })
            }
            .width('100%')
            .padding({ left: 4, right: 4, bottom: 10 })

            // 节点卡片
            Column({ space: 0 }) {
              if (this.nodes.length === 0) {
                Column({ space: 4 }) {
                  Text('还没有已配对节点')
                    .fontSize(15)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(this.textColor())
                  Text('点击下方「添加节点」，按引导完成电脑端准备后扫码配对。')
                    .fontSize(12.5)
                    .lineHeight(18)
                    .fontColor(this.subColor())
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
                .padding({ left: 18, right: 18, top: 16, bottom: 16 })
              } else {
                ForEach(this.nodes, (row: NodeRowView, index: number) => {
                  Column({ space: 0 }) {
                    Row({ space: 8 }) {
                      Circle({ width: 7, height: 7 })
                        .fill(row.online ? '#2EB85C' : (this.isDark ? 'rgba(255,255,255,0.32)' : 'rgba(16,19,24,0.28)'))
                      Column({ space: 3 }) {
                        Row({ space: 6 }) {
                          Text(row.name)
                            .fontSize(15)
                            .fontWeight(FontWeight.Medium)
                            .fontColor(this.textColor())
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                          if (row.active) {
                            Text('当前')
                              .fontSize(10.5)
                              .fontColor('#2E6BE6')
                              .backgroundColor(this.isDark ? 'rgba(46,107,230,0.22)' : 'rgba(46,107,230,0.10)')
                              .borderRadius(999)
                              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                          }
                        }
                        .width('100%')
                        Text(row.id)
                          .fontSize(11.5)
                          .fontColor(this.subColor())
                          .maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis })
                          .width('100%')
                      }
                      .alignItems(HorizontalAlign.Start)
                      .layoutWeight(1)

                      Column({ space: 4 }) {
                        Text(row.online ? '在线' : '离线')
                          .fontSize(12)
                          .fontColor(row.online ? '#2EB85C' : this.subColor())
                        Text('复制 ID')
                          .fontSize(12)
                          .fontColor('#2E6BE6')
                          .onClick(() => {
                            this.copyNodeId(row.id);
                          })
                      }
                      .alignItems(HorizontalAlign.End)
                    }
                    .width('100%')
                    .padding({ left: 18, right: 18, top: 12, bottom: 12 })

                    if (index < this.nodes.length - 1) {
                      Row()
                        .width('100%')
                        .height(1)
                        .backgroundColor(this.dividerColor())
                        .margin({ left: 18 })
                    }
                  }
                  .width('100%')
                  // 当前连接节点：明显的蓝色底
                  .backgroundColor(row.active
                    ? (this.isDark ? 'rgba(46,107,230,0.24)' : 'rgba(46,107,230,0.10)')
                    : Color.Transparent)
                }, (row: NodeRowView) => row.id)
              }
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .borderRadius(14)
            .clip(true)

            // 添加节点
            Row({ space: 6 }) {
              Text('＋')
                .fontSize(17)
                .fontColor('#2E6BE6')
              Text('添加节点')
                .fontSize(15.5)
                .fontColor('#2E6BE6')
            }
            .width('100%')
            .height(50)
            .justifyContent(FlexAlign.Center)
            .border({ width: 1, color: 'rgba(46,107,230,0.35)', style: BorderStyle.Dashed })
            .borderRadius(12)
            .margin({ top: 14 })
            .onClick(() => {
              this.pageStack.pushPathByName('add-node', null);
            })

            if (this.copiedHint.length > 0) {
              Text(this.copiedHint)
                .fontSize(12)
                .fontColor(this.subColor())
                .width('100%')
                .textAlign(TextAlign.Center)
                .margin({ top: 10 })
            }
          }
          .width('100%')
          .padding({ left: 16, right: 16, top: 4, bottom: this.safeBottomStorage > 0 ? this.safeBottomStorage + 20 : 30 })
        }
        .layoutWeight(1)
        .align(Alignment.Top)
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .hideTitleBar(true)
    .backgroundColor(this.pageBg())
  }
}
