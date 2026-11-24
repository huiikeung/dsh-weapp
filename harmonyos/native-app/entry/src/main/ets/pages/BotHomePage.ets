/**
 * Bot 模式首页（对齐 iOS BotModeView 的 compactHome）：
 * 与首页同一套深海鲸鱼背景 + 品牌顶栏，内容为「个人助理」英雄区、Chief 玻璃卡、
 * 「与 X 聊聊」大按钮、我的 Bot / 定时任务快捷卡、聊天列表与搜索。
 */
import {
  BotActivity, BotChat, BotLiveWork, BotRoleOption, BotSchedule, BotSnapshot, BotStore, Logger,
  OceanBackground, PreferencesStore, emptyBotSnapshot
} from 'nativecore';
import { FluKeCoin } from '../components/FluKeCoin';

function liveText(live: BotLiveWork | undefined): string {
  if (live === undefined) {
    return '';
  }
  const kind: string = live.kind;
  if (kind === 'web-search') return '正在搜索网页';
  if (kind === 'web-read') return '正在读取网页';
  if (kind === 'image') return '正在处理图片';
  if (kind === 'switching-folder') return '正在切换工作目录';
  if (kind === 'working') return '正在执行';
  return '正在思考';
}

@Component
export struct BotHomePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('connectionState') @Watch('onConnection') connection: string = 'disconnected';
  @StorageLink('botState') state: BotSnapshot = emptyBotSnapshot();

  @State search: string = '';
  @State scheduleOpen: boolean = false;

  aboutToAppear(): void {
    BotStore.get().refreshAll();
    BotStore.get().setForeground(true);
    AppStorage.setOrCreate<string>('botMode', '1');
    try {
      PreferencesStore.get().putString('botMode', '1');
    } catch (ignored) {
    }
    Logger.info('BOT_HOME appear chats=' + this.state.chats.length.toString()
      + ' supported=' + (this.state.supported ? '1' : '0'));
  }

  onConnection(): void {
    if (this.connection === 'connected') {
      BotStore.get().refreshAll();
    }
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  private leaveBotMode(): void {
    AppStorage.setOrCreate<string>('botMode', '0');
    try {
      PreferencesStore.get().putString('botMode', '0');
    } catch (ignored) {
    }
    this.pageStack.pop();
  }

  // ==================== 派生数据 ====================

  private chief(): BotChat | null {
    const main: string = this.state.mainBotId ?? '';
    for (const chat of this.state.chats) {
      if (!chat.room && (main.length > 0 ? chat.id === main : true)) {
        return chat;
      }
    }
    return null;
  }

  private visibleChats(): BotChat[] {
    const query: string = this.search.trim().toLowerCase();
    const out: BotChat[] = [];
    for (const chat of this.state.chats) {
      if (chat.hidden) {
        continue;
      }
      if (query.length > 0 && chat.name.toLowerCase().indexOf(query) < 0
        && chat.preview.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(chat);
    }
    return out;
  }

  private runningCount(): number {
    let count: number = 0;
    for (const chat of this.state.chats) {
      if (this.state.liveWork[chat.id] !== undefined) {
        count += 1;
      }
    }
    return count;
  }

  private rosterCount(): number {
    let count: number = 0;
    for (const chat of this.state.chats) {
      if (!chat.room) {
        count += 1;
      }
    }
    return count;
  }

  private openChat(chat: BotChat): void {
    BotStore.get().selectChat(chat.id);
    this.pageStack.pushPathByName('bot-chat', chat.id);
  }

  private avatarColor(id: string): string {
    const palette: string[] = ['#C026D3', '#7A5BFA', '#2F7DF6', '#2FA98C', '#D97706'];
    let hash: number = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 997;
    }
    return palette[hash % palette.length];
  }

  private timeLabel(chat: BotChat): string {
    if (chat.lastAt <= 0) {
      return '';
    }
    const ms: number = chat.lastAt > 100000000000 ? chat.lastAt : chat.lastAt * 1000;
    const diff: number = Math.max(0, Date.now() - ms);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000).toString() + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000).toString() + ' 小时前';
    return Math.floor(diff / 86400000).toString() + ' 天前';
  }

  // ==================== 组件 ====================

  @Builder
  avatarView(chat: BotChat, size: number) {
    Stack({ alignContent: Alignment.Center }) {
      if (chat.image !== undefined && chat.image.length > 0) {
        Image(chat.image)
          .width(size)
          .height(size)
          .borderRadius(size / 2)
          .objectFit(ImageFit.Cover)
      } else {
        Circle({ width: size, height: size }).fill(this.avatarColor(chat.id))
        Text(chat.name.length > 0 ? chat.name.substring(0, 1) : 'B')
          .fontSize(size * 0.42)
          .fontColor('#FFFFFF')
          .fontWeight(FontWeight.Medium)
      }
    }
    .width(size)
    .height(size)
    .flexShrink(0)
  }

  @Builder
  brandHeader() {
    Row() {
      FluKeCoin({
        diameter: 36,
        onTap: () => {
          this.leaveBotMode();
        }
      })
        .margin({ right: 6 })
        .translate({ y: -1 })
      Image($r('app.media.wordmark_white'))
        .width(52)
        .height(15)
        .objectFit(ImageFit.Contain)
        .margin({ right: 9 })
      Text('HARNESS')
        .fontSize(9.5)
        .fontWeight(FontWeight.Bold)
        .fontColor('#10151F')
        .backgroundColor('#FFFFFF')
        .borderRadius(4)
        .height(15)
        .padding({ left: 6, right: 6 })
        .textAlign(TextAlign.Center)
        .letterSpacing(0.5)
      Blank()
      Row({ space: 6 }) {
        Circle({ width: 7, height: 7 })
          .fill(this.connection === 'connected' ? (this.state.supported ? '#31B77A' : '#E0A03C') : 'rgba(255,255,255,0.4)')
        Text(this.connection === 'connected' ? (this.state.supported ? 'DS Bot 已连接' : '主机未启用 DS-Bot') : '未连接')
          .fontSize(11.5)
          .fontColor('rgba(255,255,255,0.7)')
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .margin({ bottom: 18 })
    .onClick(() => {
      this.leaveBotMode();
    })
  }

  @Builder
  hero() {
    Column({ space: 3 }) {
      Text('个人助理')
        .fontSize(32)
        .fontWeight(FontWeight.Bold)
        .fontColor('#FFFFFF')
      Text('今天也交给我吧。')
        .fontSize(15)
        .fontColor('rgba(255,255,255,0.68)')
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .margin({ bottom: 4 })
  }

  @Builder
  chiefCard() {
    if (this.chief() !== null) {
      Row({ space: 12 }) {
        this.avatarView(this.chief() as BotChat, 44)
        Column({ space: 2 }) {
          Text((this.chief() as BotChat).name)
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor('#FFFFFF')
          Row({ space: 4 }) {
            Circle({ width: 5, height: 5 })
              .fill((this.chief() as BotChat).running ? '#31B77A' : '#C9A9FF')
            Text((this.chief() as BotChat).running
              ? '正在为你推进 ' + this.runningCount().toString() + ' 件事'
              : '随时可以找我聊聊')
              .fontSize(12)
              .fontColor('#D9C8FF')
          }
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 11, bottom: 11 })
      .constraintSize({ minHeight: 66 })
      .backgroundColor('rgba(255,255,255,0.10)')
      .borderRadius(22)
      .border({ width: 1, color: 'rgba(255,255,255,0.16)' })
      .onClick(() => {
        const chief: BotChat | null = this.chief();
        if (chief !== null) {
          BotStore.get().openRole(chief.id);
          this.pageStack.pushPathByName('bot-role', chief.id);
        }
      })
    }
  }

  @Builder
  startChatButton() {
    if (this.chief() !== null) {
      Row({ space: 10 }) {
        Image($r('app.media.bot_mode'))
          .width(25)
          .height(25)
          .objectFit(ImageFit.Contain)
          .fillColor('#FFFFFF')
        Text('与 ' + (this.chief() as BotChat).name + ' 聊聊')
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
      }
      .justifyContent(FlexAlign.Center)
      .width('100%')
      .constraintSize({ minHeight: 52 })
      .backgroundColor('rgba(167,139,250,0.32)')
      .borderRadius(26)
      .border({ width: 1, color: 'rgba(255,255,255,0.18)' })
      .onClick(() => {
        this.openChat(this.chief() as BotChat);
      })
    }
  }

  @Builder
  shortcut(title: string, subtitle: string, onTap: () => void) {
    Column({ space: 4 }) {
      Text(title)
        .fontSize(13.5)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
      Text(subtitle)
        .fontSize(11.5)
        .fontColor('rgba(255,255,255,0.6)')
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .alignItems(HorizontalAlign.Start)
    .layoutWeight(1)
    .padding(14)
    .constraintSize({ minHeight: 78 })
    .backgroundColor('rgba(255,255,255,0.10)')
    .borderRadius(18)
    .border({ width: 1, color: 'rgba(255,255,255,0.14)' })
    .onClick(onTap)
  }

  @Builder
  chatRow(chat: BotChat) {
    Row({ space: 12 }) {
      this.avatarView(chat, 40)
      Column({ space: 3 }) {
        Row({ space: 6 }) {
          Text(chat.name)
            .fontSize(15.5)
            .fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFF')
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (this.state.liveWork[chat.id] !== undefined) {
            Text('运行中')
              .fontSize(10.5)
              .fontColor('#9BD9B8')
              .backgroundColor('rgba(49,183,122,0.18)')
              .borderRadius(8)
              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          } else if ((this.state.unreadCounts[chat.id] ?? 0) > 0) {
            Text((this.state.unreadCounts[chat.id] ?? 0) > 99 ? '99+' : (this.state.unreadCounts[chat.id] ?? 0).toString())
              .fontSize(10.5)
              .fontColor('#FFFFFF')
              .backgroundColor('#FF4D4F')
              .borderRadius(8)
              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          } else {
            Text(this.timeLabel(chat))
              .fontSize(11)
              .fontColor('rgba(255,255,255,0.42)')
          }
        }
        .width('100%')
        Text(this.state.liveWork[chat.id] !== undefined ? liveText(this.state.liveWork[chat.id])
          : (chat.preview.length > 0 ? chat.preview : (chat.room ? '群聊' : '私聊')))
          .fontSize(12.5)
          .fontColor('rgba(255,255,255,0.55)')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 10, bottom: 10 })
    .backgroundColor('rgba(255,255,255,0.06)')
    .borderRadius(16)
    .onClick(() => {
      this.openChat(chat);
    })
  }

  @Builder
  scheduleSheet() {
    Column({ space: 10 }) {
      Text('定时任务')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#FFFFFF' : '#101318')
        .margin({ top: 6, bottom: 4 })
      if (this.state.schedules.length === 0) {
        Text(this.state.schedulesAvailable ? '暂无定时任务' : '主机未启用定时任务')
          .fontSize(13)
          .fontColor(this.isDark ? 'rgba(232,234,237,0.5)' : 'rgba(22,24,29,0.45)')
          .margin({ top: 20, bottom: 30 })
      } else {
        List() {
          ForEach(this.state.schedules, (task: BotSchedule) => {
            ListItem() {
              Column({ space: 3 }) {
                Text(task.title)
                  .fontSize(14)
                  .fontColor(this.isDark ? '#F1F4FA' : '#101318')
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(task.status + ' · ' + task.next)
                  .fontSize(11.5)
                  .fontColor(this.isDark ? 'rgba(232,234,237,0.45)' : 'rgba(22,24,29,0.4)')
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
              .padding({ top: 8, bottom: 8 })
            }
          }, (task: BotSchedule) => task.id)
        }
        .layoutWeight(1)
      }
      Button('关闭')
        .fontSize(14)
        .fontColor(this.isDark ? '#D7DBE7' : '#404652')
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
        .borderRadius(16)
        .height(36)
        .width('100%')
        .onClick(() => {
          this.scheduleOpen = false;
        })
    }
    .width('100%')
    .padding({ left: 18, right: 18, bottom: 18 + this.safeBottom })
    .backgroundColor(this.isDark ? '#1C1E24' : '#FFFFFF')
    .borderRadius({ topLeft: 20, topRight: 20 })
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.Bottom }) {
        // 与首页同一套深海鲸鱼背景
        Stack() {
          OceanBackground()
        }
        .width('100%')
        .height('100%')

        Scroll() {
          Column({ space: 16 }) {
            Column({ space: 18 }) {
              this.brandHeader()
              this.hero()
            }
            .width('100%')

            this.chiefCard()
            this.startChatButton()

            if (!this.state.supported && this.connection === 'connected') {
              Column({ space: 6 }) {
                Text('主机未启用 DS-Bot')
                  .fontSize(14)
                  .fontColor('#FFFFFF')
                Text('在电脑上安装并启用官方 DS-Bot 插件后，这里会显示你的 Bot 团队。')
                  .fontSize(12)
                  .fontColor('rgba(255,255,255,0.6)')
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
              .padding(14)
              .backgroundColor('rgba(255,255,255,0.08)')
              .borderRadius(16)
            }

            Row({ space: 12 }) {
              this.shortcut('我的 Bot', this.rosterCount().toString() + ' 个 · 查看与创建', () => {
                this.pageStack.pushPathByName('bot-create', null);
              })
              this.shortcut('定时任务', this.state.schedules.length > 0
                ? '下次 ' + this.state.schedules[0].next : '查看安排', () => {
                this.scheduleOpen = true;
              })
            }
            .width('100%')

            Row({ space: 8 }) {
              Text('聊天')
                .fontSize(17)
                .fontWeight(FontWeight.Bold)
                .fontColor('#FFFFFF')
              Blank()
              Button({ type: ButtonType.Circle }) {
                Text('+')
                  .fontSize(19)
                  .fontColor('#FFFFFF')
                  .offset({ y: -1 })
              }
              .width(30)
              .height(30)
              .backgroundColor('rgba(255,255,255,0.14)')
              .bindMenu([
                { value: '新建 Bot', action: () => { this.pageStack.pushPathByName('bot-create', null); } },
                { value: '新建群聊', action: () => { this.pageStack.pushPathByName('bot-new-chat', null); } }
              ])
            }
            .width('100%')
            .margin({ top: 4 })

            Row({ space: 8 }) {
              Text('🔍')
                .fontSize(13)
                .opacity(0.5)
              TextInput({ text: this.search, placeholder: '搜索聊天' })
                .fontSize(14)
                .fontColor('#FFFFFF')
                .placeholderColor('rgba(255,255,255,0.42)')
                .backgroundColor(Color.Transparent)
                .layoutWeight(1)
                .height(38)
                .onChange((value: string) => {
                  this.search = value;
                })
            }
            .width('100%')
            .padding({ left: 10, right: 6 })
            .backgroundColor('rgba(255,255,255,0.08)')
            .borderRadius(12)

            if (this.visibleChats().length === 0) {
              Text('还没有聊天')
                .fontSize(13)
                .fontColor('rgba(255,255,255,0.5)')
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 16, bottom: 30 })
            } else {
              ForEach(this.visibleChats(), (chat: BotChat) => {
                this.chatRow(chat)
              }, (chat: BotChat) => chat.id + ':' + chat.preview + ':' + chat.lastAt.toString())
            }

            if (this.state.error !== undefined && this.state.error.length > 0) {
              Text('连接异常：' + this.state.error)
                .fontSize(11.5)
                .fontColor('#E0A03C')
                .width('100%')
            }
          }
          .width('100%')
          .padding({ left: 22, right: 22, top: this.topInset() + 18, bottom: 24 + this.safeBottom })
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .height('100%')
        .scrollBar(BarState.Off)
        .align(Alignment.Top)

        if (this.scheduleOpen) {
          Column() {
            Column()
              .width('100%')
              .height('100%')
              .backgroundColor('rgba(0,0,0,0.4)')
              .onClick(() => {
                this.scheduleOpen = false;
              })
            this.scheduleSheet()
          }
          .width('100%')
          .height('100%')
        }
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
  }
}
