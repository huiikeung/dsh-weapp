import { GatewayClient, ScheduleTask } from 'nativecore';

@Component
export struct SchedulePage {
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('scheduleTasks') tasks: ScheduleTask[] = [];
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
            ? ('共 ' + this.tasks.length + ' 个任务')
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
          if (this.tasks.length === 0) {
            ListItem() {
              Column({ space: 6 }) {
                Text('暂无自动化任务')
                  .fontSize(15)
                  .fontColor(this.textColor())
                Text('在 DSH 会话里创建定时任务后会出现在这里。')
                  .fontSize(12)
                  .fontColor(this.subColor())
                  .textAlign(TextAlign.Center)
              }
              .width('100%')
              .padding(24)
            }
          }
          ForEach(this.tasks, (task: ScheduleTask) => {
            ListItem() {
              Row({ space: 10 }) {
                Column({ space: 4 }) {
                  Text(task.title)
                    .fontSize(15)
                    .fontColor(this.textColor())
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(this.ruleText(task))
                    .fontSize(11)
                    .fontColor(this.subColor())
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)

                Toggle({ type: ToggleType.Switch, isOn: task.status === 'active' })
                  .selectedColor('#2E6BE6')
                  .onChange((isOn: boolean) => {
                    this.toggle(task, isOn);
                  })
              }
              .width('100%')
              .padding(14)
              .borderRadius(14)
              .backgroundColor(this.cardBg())
            }
          }, (task: ScheduleTask) => task.id)
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
    .title('自动化任务')
    .backgroundColor(this.pageBg())
  }

  private ruleText(task: ScheduleTask): string {
    const kind: string = task.kind;
    if (kind === 'daily') {
      return '每天';
    }
    if (kind === 'weekly') {
      return '每周';
    }
    if (kind === 'every') {
      return '周期执行';
    }
    if (kind === 'cron') {
      return 'Cron';
    }
    return '一次';
  }

  private refresh(): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关，无法拉取任务';
      return;
    }
    this.hint = '';
    GatewayClient.get().requestScheduleCatalog();
  }

  private toggle(task: ScheduleTask, enabled: boolean): void {
    if (!GatewayClient.get().isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    if (!GatewayClient.get().setScheduleEnabled(task.id, enabled)) {
      this.hint = '操作失败，请重试';
    }
  }
}
