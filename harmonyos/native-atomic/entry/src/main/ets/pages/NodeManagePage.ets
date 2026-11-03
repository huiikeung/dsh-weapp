import { GatewayClient, SessionSummary, WorkspaceRow } from 'nativecore';

/** 节点管理：对齐小程序 pairing-admin（列出已连接节点 + 添加节点） */
@Component
export struct NodeManagePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('gatewayName') gatewayName: string = '';
  @StorageLink('transportKind') transportKind: string = '';
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('workspaces') workspaces: WorkspaceRow[] = [];
  @StorageLink('safeTopVp') safeTopStorage: number = 0;

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

  private linkLabel(): string {
    if (this.connection !== 'connected') {
      return '未连接';
    }
    return this.transportKind === 'relay' ? '公网' : '局域网';
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
          Text('节点管理').fontSize(17).fontWeight(FontWeight.Bold).fontColor(this.textColor())
          Blank()
          Text('添加')
            .fontSize(15)
            .fontColor('#2E6BE6')
            .width(40)
            .height(40)
            .textAlign(TextAlign.Center)
            .onClick(() => {
              this.pageStack.pushPathByName('add-node', null);
            })
        }
        .width('100%')
        .height(44)
        .padding({ left: 8, right: 8 })
        .margin({ top: this.safeTopStorage > 0 ? this.safeTopStorage : 38.9 })

        Scroll() {
          Column() {
            Text('已连接节点')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 8, top: 12, bottom: 9 })

            Column() {
              Row({ space: 10 }) {
                Image($r('app.media.host_desktop_white'))
                  .width(20)
                  .height(20)
                  .objectFit(ImageFit.Contain)
                  .fillColor(this.textColor())
                Column({ space: 3 }) {
                  Text(this.gatewayName.length > 0 ? this.gatewayName : '本机')
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.textColor())
                  Text(this.linkLabel() + ' · ' + this.sessions.length + ' 个会话')
                    .fontSize(12)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Circle({ width: 7, height: 7 })
                  .fill(this.connection === 'connected' ? '#34C759' : 'rgba(255,255,255,0.35)')
              }
              .width('100%')
              .padding(16)
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)

            Text('工作区')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.subColor())
              .width('100%')
              .padding({ left: 8, top: 20, bottom: 9 })

            Column() {
              ForEach(this.workspaces, (ws: WorkspaceRow, index: number) => {
                Column() {
                  Row({ space: 10 }) {
                    Image($r('app.media.workspace_folder_white'))
                      .width(18)
                      .height(18)
                      .objectFit(ImageFit.Contain)
                      .fillColor(this.textColor())
                    Column({ space: 3 }) {
                      Text(ws.title)
                        .fontSize(15)
                        .fontColor(this.textColor())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                      Text(ws.path)
                        .fontSize(12)
                        .fontColor(this.subColor())
                        .maxLines(1)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                    }
                    .alignItems(HorizontalAlign.Start)
                    .layoutWeight(1)
                    Text(ws.sessionIds.length + ' 个会话')
                      .fontSize(12)
                      .fontColor(this.subColor())
                  }
                  .width('100%')
                  .padding(16)
                  if (index < this.workspaces.length - 1) {
                    Divider().color(this.dividerColor()).strokeWidth(1).margin({ left: 16, right: 16 })
                  }
                }
                .width('100%')
              }, (ws: WorkspaceRow) => ws.workspaceId)
            }
            .width('100%')
            .backgroundColor(this.cardBg())
            .border({ width: 1, color: this.dividerColor() })
            .borderRadius(14)
            .clip(true)
          }
          .width('100%')
          .padding({ left: 16, right: 16, bottom: 30 })
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
