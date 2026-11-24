/**
 * 我的 Bot（对齐 dsh-mobile BotManagementView「我的 Bot」列表）：
 * 团队成员列表（含隐藏 Bot）→ 主 Bot 徽标 → 点行进入角色页；右上「新建 Bot」。
 * 只做查看/进入/新建，删除与编辑在角色页，和 iOS 保持一致。
 */
import { BotChat, BotSnapshot, BotStore, emptyBotSnapshot } from 'nativecore';

/** Bot 主题色（对齐 iOS Bot 模式的 Assets：BotInk / BotCard / BotPurple / BotLavenderSoft…） */
function ink(dark: boolean): string {
  return dark ? '#F2EEF6' : '#252332';
}

function secondary(dark: boolean): string {
  return dark ? '#D8D2E1' : '#5C536C';
}

function canvas(dark: boolean): string {
  return dark ? '#1B1924' : '#F5F3F9';
}

function card(dark: boolean): string {
  return dark ? '#292733' : '#FFFFFF';
}

function line(dark: boolean): string {
  return dark ? '#484354' : '#DAD6E3';
}

function lavenderSoft(dark: boolean): string {
  return dark ? '#333044' : '#ECE7F7';
}

function purple(dark: boolean): string {
  return dark ? '#C8B5E8' : '#7760B4';
}

const ACTION: string = '#6C50A7';

@Entry
@Component
export struct BotManagePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') state: BotSnapshot = emptyBotSnapshot();

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  private bots(): BotChat[] {
    const out: BotChat[] = [];
    for (const chat of this.state.chats) {
      if (!chat.room) {
        out.push(chat);
      }
    }
    return out;
  }

  private canCreate(): boolean {
    return BotStore.get().canCreate();
  }

  private unavailableHint(): string {
    if (!this.state.connected) {
      return '连接主机后可以创建 Bot';
    }
    if (!this.state.writable) {
      return '当前主机为只读';
    }
    if (!this.state.supported || !this.state.creation.supported) {
      return '请更新主机上的移动网关和 DS Bot 后再创建 Bot';
    }
    return '';
  }

  private openBot(chat: BotChat): void {
    BotStore.get().openRole(chat.id);
    this.pageStack.pushPathByName('bot-role', chat.id);
  }

  private avatarColor(id: string): string {
    const palette: string[] = ['#C026D3', '#7A5BFA', '#2F7DF6', '#2FA98C', '#D97706'];
    let hash: number = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 997;
    }
    return palette[hash % palette.length];
  }

  @Builder
  header() {
    Row({ space: 10 }) {
      Button({ type: ButtonType.Circle }) {
        Text('‹')
          .fontSize(24)
          .fontColor(ink(this.isDark))
          .offset({ y: -1 })
      }
      .width(36)
      .height(36)
      .backgroundColor(card(this.isDark))
      .shadow({ radius: 8, color: this.isDark ? 'rgba(0,0,0,0.4)' : 'rgba(37,35,50,0.10)', offsetX: 0, offsetY: 3 })
      .onClick(() => {
        this.pageStack.pop();
      })

      Text('我的 Bot')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(ink(this.isDark))
        .layoutWeight(1)
        .textAlign(TextAlign.Center)
        .margin({ right: 4 })

      Row({ space: 4 }) {
        Text('+')
          .fontSize(15)
          .fontColor(this.canCreate() ? ACTION : secondary(this.isDark))
        Text('新建 Bot')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.canCreate() ? ACTION : secondary(this.isDark))
      }
      .padding({ left: 12, right: 12, top: 9, bottom: 9 })
      .borderRadius(20)
      .backgroundColor(card(this.isDark))
      .border({ width: 0.7, color: line(this.isDark) })
      .opacity(this.canCreate() ? 1 : 0.45)
      .enabled(this.canCreate())
      .onClick(() => {
        this.pageStack.pushPathByName('bot-create', null);
      })
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: this.topInset() + 6, bottom: 8 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  avatar(chat: BotChat) {
    Stack({ alignContent: Alignment.Center }) {
      Circle({ width: 44, height: 44 })
        .fill(chat.id === (this.state.mainBotId ?? '') ? purple(this.isDark) : this.avatarColor(chat.id))
      Text(chat.name.length > 0 ? chat.name.substring(0, 1) : 'B')
        .fontSize(18)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
    }
    .width(44)
    .height(44)
    .borderRadius(14)
    .clip(true)
  }

  @Builder
  botRow(chat: BotChat, last: boolean) {
    Column() {
      Row({ space: 12 }) {
        this.avatar(chat)
        Column({ space: 3 }) {
          Row({ space: 6 }) {
            Text(chat.name)
              .fontSize(17)
              .fontWeight(FontWeight.Medium)
              .fontColor(ink(this.isDark))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            if (chat.id === (this.state.mainBotId ?? '')) {
              Text('主 Bot')
                .fontSize(10)
                .fontWeight(FontWeight.Medium)
                .fontColor(purple(this.isDark))
                .padding({ left: 7, right: 7, top: 3, bottom: 3 })
                .borderRadius(6)
                .backgroundColor(lavenderSoft(this.isDark))
            }
            if (chat.hidden) {
              Text('已隐藏')
                .fontSize(10)
                .fontColor(secondary(this.isDark))
            }
            Blank()
          }
          .width('100%')
          Text(chat.role.length > 0 ? chat.role : 'Bot')
            .fontSize(12)
            .fontColor(secondary(this.isDark))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        if (chat.hidden) {
          Text('恢复')
            .fontSize(12.5)
            .fontColor(purple(this.isDark))
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .borderRadius(14)
            .backgroundColor(lavenderSoft(this.isDark))
            .onClick(() => {
              BotStore.get().restoreHiddenBot(chat.id);
            })
        }

        Text('›')
          .fontSize(20)
          .fontColor(secondary(this.isDark))
          .opacity(0.7)
      }
      .width('100%')
      .constraintSize({ minHeight: 72 })
      .padding({ left: 16, right: 14, top: 12, bottom: 12 })
      .alignItems(VerticalAlign.Center)
      .onClick(() => {
        this.openBot(chat);
      })

      if (!last) {
        Column()
          .width('100%')
          .height(0.6)
          .backgroundColor(line(this.isDark))
          .opacity(0.45)
          .margin({ left: 72 })
      }
    }
    .width('100%')
  }

  @Builder
  emptyState() {
    Column({ space: 8 }) {
      Text('还没有 Bot')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(ink(this.isDark))
      Text('创建一个 Bot，让它替你处理具体的工作。')
        .fontSize(12.5)
        .fontColor(secondary(this.isDark))
        .textAlign(TextAlign.Center)
      if (this.canCreate()) {
        Button('新建 Bot')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .height(36)
          .padding({ left: 18, right: 18 })
          .borderRadius(18)
          .backgroundColor(ACTION)
          .margin({ top: 6 })
          .onClick(() => {
            this.pageStack.pushPathByName('bot-create', null);
          })
      }
    }
    .width('100%')
    .padding({ top: 28, bottom: 28, left: 16, right: 16 })
    .borderRadius(20)
    .backgroundColor(card(this.isDark))
    .border({ width: 0.7, color: this.isDark ? '#777184' : Color.Transparent })
    .alignItems(HorizontalAlign.Center)
  }

  build() {
    NavDestination() {
      Column() {
        this.header()
        Scroll() {
          Column({ space: 16 }) {
            Row({ space: 6 }) {
              Text('团队成员')
                .fontSize(13)
                .fontColor(secondary(this.isDark))
              Blank()
              Text(this.bots().length.toString() + ' 个 Bot')
                .fontSize(13)
                .fontColor(secondary(this.isDark))
            }
            .width('100%')

            if (this.unavailableHint().length > 0) {
              Text(this.unavailableHint())
                .fontSize(13)
                .fontColor(secondary(this.isDark))
                .width('100%')
            }

            if (this.state.loading && this.bots().length === 0) {
              Column() {
                LoadingProgress()
                  .width(26)
                  .height(26)
                  .color(purple(this.isDark))
              }
              .width('100%')
              .padding(24)
              .borderRadius(20)
              .backgroundColor(card(this.isDark))
              .alignItems(HorizontalAlign.Center)
            } else if (this.bots().length === 0) {
              this.emptyState()
            } else {
              Column() {
                ForEach(this.bots(), (chat: BotChat, index: number) => {
                  this.botRow(chat, index === this.bots().length - 1)
                }, (chat: BotChat) => chat.id + ':' + chat.name + ':' + (chat.hidden ? '1' : '0'))
              }
              .width('100%')
              .borderRadius(20)
              .backgroundColor(card(this.isDark))
              .border({ width: 0.7, color: this.isDark ? '#777184' : Color.Transparent })
              .clip(true)
            }

            if (this.state.error !== undefined && this.state.error.length > 0) {
              Text('连接异常：' + this.state.error)
                .fontSize(12)
                .fontColor('#E0A03C')
                .width('100%')
            }

            Row().width('100%').height(16 + this.safeBottom)
          }
          .width('100%')
          .padding({ left: 24, right: 24, top: 8, bottom: 16 })
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        .align(Alignment.Top)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(canvas(this.isDark))
    }
    .hideTitleBar(true)
  }
}
