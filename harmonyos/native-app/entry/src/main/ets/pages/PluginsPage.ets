import { GatewayClient, PluginItem } from 'nativecore';

@Component
export struct PluginsPage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('pluginBundles') bundles: PluginItem[] = [];
  @State hint: string = '';

  private pageBg(): string {
    return this.isDark ? '#000000' : '#F2F2F7';
  }

  private cardBg(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241, 244, 250, 0.62)' : 'rgba(16, 19, 24, 0.62)';
  }

  aboutToAppear(): void {
    this.refresh();
  }

  build() {
    NavDestination() {
      Column() {
        Row() {
          Text(this.connection === 'connected'
            ? ('共 ' + this.bundles.length + ' 个插件')
            : '未连接网关')
            .fontSize(12)
            .fontColor(this.subColor())
            .layoutWeight(1)
          Button('刷新')
            .height(30)
            .fontSize(12)
            .backgroundColor(this.isDark ? '#2C2C2E' : '#FFFFFF')
            .fontColor('#2E6BE6')
            .onClick(() => {
              this.refresh();
            })
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 6, bottom: 6 })

        if (this.hint.length > 0) {
          Text(this.hint)
            .fontSize(12)
            .fontColor('#FF3B30')
            .padding({ left: 16, right: 16, bottom: 4 })
        }

        List({ space: 10 }) {
          if (this.bundles.length === 0) {
            ListItem() {
              Column({ space: 6 }) {
                Text('暂无插件数据')
                  .fontSize(15)
                  .fontColor(this.textColor())
                Text(this.connection === 'connected'
                  ? '点右上角「刷新」拉取插件目录。'
                  : '连接网关后自动加载插件目录。')
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .textAlign(TextAlign.Center)
              }
              .width('100%')
              .padding(24)
            }
          }
          ForEach(this.bundles, (item: PluginItem) => {
            ListItem() {
              Row({ space: 10 }) {
                Column({ space: 4 }) {
                  Row({ space: 6 }) {
                    Text(item.title)
                      .fontSize(15)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.textColor())
                    if (item.experimental) {
                      Text('实验性')
                        .fontSize(10)
                        .fontColor('#FF9500')
                        .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                        .borderRadius(6)
                        .backgroundColor(this.isDark ? 'rgba(255,149,0,0.16)' : 'rgba(255,149,0,0.12)')
                    }
                  }
                  if (item.description.length > 0) {
                    Text(item.description)
                      .fontSize(12)
                      .fontColor(this.subColor())
                      .maxLines(2)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                  }
                  Text(item.version.length > 0 ? ('v' + item.version) : item.name)
                    .fontSize(10)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Toggle({ type: ToggleType.Switch, isOn: item.enabled })
                  .selectedColor('#2E6BE6')
                  .onChange((isOn: boolean) => {
                    this.toggle(item, isOn);
                  })
              }
              .width('100%')
              .padding(14)
              .borderRadius(14)
              .backgroundColor(this.cardBg())
            }
          }, (item: PluginItem) => item.name)
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 16 })
        .scrollBar(BarState.Off)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
    }
    .title('插件')
    .backgroundColor(this.pageBg())
  }

  private refresh(): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关，无法拉取插件目录';
      return;
    }
    this.hint = '';
    GatewayClient.get().requestPlugins();
  }

  private toggle(item: PluginItem, enabled: boolean): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    if (!GatewayClient.get().setPluginEnabled(item.name, enabled)) {
      this.hint = '操作失败，请重试';
    }
  }
}
