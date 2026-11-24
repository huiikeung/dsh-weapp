/**
 * 新建群聊（对齐 dsh-mobile BotManagementView 的群聊创建页）：
 * 选择成员（第一位为管理员，可移除）→ 搜索名称/角色 → 首条消息（选填）→ 底部主按钮创建。
 * 提交结果不确定时不自动重试，提供「已核对列表，确认未创建」。创建成功后进入聊天页。
 */
import { BotChat, BotSnapshot, BotStore, emptyBotSnapshot } from 'nativecore';

function ink(dark: boolean): string {
  return dark ? '#F2EEF6' : '#252332';
}

function secondary(dark: boolean): string {
  return dark ? '#D8D2E1' : '#5C536C';
}

function canvas(dark: boolean): string {
  return dark ? '#17161F' : '#F4F1FA';
}

function card(dark: boolean): string {
  return dark ? '#292733' : '#FFFFFF';
}

function grouped(dark: boolean): string {
  return dark ? '#211F2A' : '#F2F2F7';
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

@Component
export struct BotNewChatPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onState') state: BotSnapshot = emptyBotSnapshot();
  @State greet: boolean = true;
  @State handled: boolean = false;
  @State search: string = '';

  aboutToAppear(): void {
    BotStore.get().beginConversation();
  }

  onState(): void {
    const conversation = this.state.conversation;
    const opened: string = conversation.openedId ?? '';
    if (opened.length > 0 && !this.handled) {
      this.handled = true;
      BotStore.get().selectChat(opened);
      this.pageStack.pop();
      this.pageStack.pushPathByName('bot-chat', opened);
    }
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  private candidates(): BotChat[] {
    const query: string = this.search.trim().toLowerCase();
    const out: BotChat[] = [];
    for (const chat of this.state.chats) {
      if (chat.room) {
        continue;
      }
      if (query.length > 0 && chat.name.toLowerCase().indexOf(query) < 0
        && chat.role.toLowerCase().indexOf(query) < 0) {
        continue;
      }
      out.push(chat);
    }
    return out;
  }

  private selectedChats(): BotChat[] {
    const ids: string[] = this.state.conversation.memberIds;
    const out: BotChat[] = [];
    for (const id of ids) {
      for (const chat of this.state.chats) {
        if (chat.id === id) {
          out.push(chat);
        }
      }
    }
    return out;
  }

  private selectedIndex(id: string): number {
    return this.state.conversation.memberIds.indexOf(id);
  }

  private canCreate(): boolean {
    const conversation = this.state.conversation;
    return conversation.supported && !conversation.saving && !conversation.uncertain
      && conversation.memberIds.length >= 2 && this.state.writable;
  }

  private avatarColor(id: string): string {
    const palette: string[] = ['#7A5BFA', '#2FA98C', '#D97706', '#DB2777', '#0EA5E9'];
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
      Text('新建群聊')
        .fontSize(17)
        .fontWeight(FontWeight.Medium)
        .fontColor(ink(this.isDark))
        .layoutWeight(1)
      if (this.state.conversation.saving) {
        LoadingProgress()
          .width(22)
          .height(22)
          .color(purple(this.isDark))
      }
    }
    .width('100%')
    .padding({ left: 14, right: 16, top: this.topInset() + 6, bottom: 8 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  memberRow(chat: BotChat) {
    Row({ space: 10 }) {
      Stack({ alignContent: Alignment.Center }) {
        Circle({ width: 36, height: 36 })
          .fill(this.avatarColor(chat.id))
        Text(chat.name.length > 0 ? chat.name.substring(0, 1) : 'B')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
      }
      .width(36)
      .height(36)

      Column({ space: 2 }) {
        Row({ space: 6 }) {
          Text(chat.name)
            .fontSize(16)
            .fontColor(ink(this.isDark))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          if (this.selectedIndex(chat.id) === 0) {
            Text('管理员')
              .fontSize(10)
              .fontColor(purple(this.isDark))
              .padding({ left: 6, right: 6, top: 2, bottom: 2 })
              .borderRadius(6)
              .backgroundColor(lavenderSoft(this.isDark))
          }
          if (chat.hidden) {
            Text('已隐藏')
              .fontSize(10)
              .fontColor(secondary(this.isDark))
          }
        }
        .width('100%')
        Text(chat.role.length > 0 ? chat.role : 'Bot')
          .fontSize(12.5)
          .fontColor(secondary(this.isDark))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (this.selectedIndex(chat.id) >= 0) {
        Text((this.selectedIndex(chat.id) + 1).toString())
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor('#FFFFFF')
          .width(20)
          .height(20)
          .textAlign(TextAlign.Center)
          .borderRadius(10)
          .backgroundColor(ACTION)
      }
    }
    .width('100%')
    .constraintSize({ minHeight: 60 })
    .padding({ left: 14, right: 14, top: 10, bottom: 10 })
    .onClick(() => {
      BotStore.get().toggleConversationMember(chat.id);
    })
  }

  @Builder
  footerBar() {
    Column({ space: 8 }) {
      Text(this.greet ? '不填写首条消息时，管理员会先询问群聊用途。' : '创建后由你在群里发第一条消息。')
        .fontSize(12)
        .fontColor(secondary(this.isDark))
        .width('100%')
        .textAlign(TextAlign.Center)
      Button(this.canCreate()
        ? '创建群聊 · ' + this.state.conversation.memberIds.length.toString() + ' 位 Bot'
        : (this.state.conversation.saving ? '创建中…' : '选择至少两位成员'))
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor('#FFFFFF')
        .width('100%')
        .height(50)
        .borderRadius(25)
        .backgroundColor(this.canCreate() ? ACTION : 'rgba(108,80,167,0.45)')
        .enabled(this.canCreate())
        .onClick(() => {
          BotStore.get().createConversationRoom(this.greet);
        })
    }
    .width('100%')
    .padding({ left: 20, right: 20, top: 12, bottom: 12 + this.safeBottom })
    .backgroundColor(this.isDark ? 'rgba(23,22,31,0.92)' : 'rgba(244,241,250,0.94)')
    .border({ width: { top: 0.7 }, color: line(this.isDark) })
  }

  build() {
    NavDestination() {
      Column() {
        this.header()

        Scroll() {
          Column({ space: 14 }) {
            Text('选择群聊成员')
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(ink(this.isDark))
              .width('100%')
            Text('第一位选中的成员为管理员。')
              .fontSize(13)
              .fontColor(secondary(this.isDark))
              .width('100%')

            if (this.selectedChats().length > 0) {
              Flex({ wrap: FlexWrap.Wrap }) {
                ForEach(this.selectedChats(), (chat: BotChat) => {
                  Row({ space: 6 }) {
                    Text((this.selectedIndex(chat.id) === 0 ? '1 ' + chat.name + ' · 管理员'
                      : (this.selectedIndex(chat.id) + 1).toString() + ' ' + chat.name))
                      .fontSize(12.5)
                      .fontColor(purple(this.isDark))
                    Text('×')
                      .fontSize(13)
                      .fontColor(secondary(this.isDark))
                  }
                  .padding({ left: 10, right: 8, top: 6, bottom: 6 })
                  .borderRadius(14)
                  .backgroundColor(lavenderSoft(this.isDark))
                  .margin({ right: 8, bottom: 8 })
                  .onClick(() => {
                    BotStore.get().toggleConversationMember(chat.id);
                  })
                }, (chat: BotChat) => chat.id)
              }
              .width('100%')
            }

            Row({ space: 6 }) {
              Text('🔍').fontSize(13).opacity(0.5)
              TextInput({ text: this.search, placeholder: '搜索名称或角色' })
                .fontSize(15)
                .fontColor(ink(this.isDark))
                .placeholderColor(secondary(this.isDark))
                .backgroundColor(Color.Transparent)
                .layoutWeight(1)
                .height(40)
                .onChange((value: string) => {
                  this.search = value;
                })
            }
            .width('100%')
            .padding({ left: 12, right: 8 })
            .backgroundColor(card(this.isDark))
            .borderRadius(13)
            .border({ width: 0.8, color: line(this.isDark) })

            Column() {
              if (this.candidates().length === 0) {
                Text(this.search.trim().length > 0 ? '没有找到相关 Bot' : '还没有可加入群聊的 Bot')
                  .fontSize(13)
                  .fontColor(secondary(this.isDark))
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(24)
              } else {
                ForEach(this.candidates(), (chat: BotChat, index: number) => {
                  Column() {
                    this.memberRow(chat)
                    if (index !== this.candidates().length - 1) {
                      Column()
                        .width('100%')
                        .height(0.6)
                        .backgroundColor(line(this.isDark))
                        .opacity(0.45)
                        .margin({ left: 60 })
                    }
                  }
                  .width('100%')
                }, (chat: BotChat) => chat.id + ':' + this.selectedIndex(chat.id).toString())
              }
            }
            .width('100%')
            .borderRadius(20)
            .backgroundColor(card(this.isDark))
            .border({ width: 0.8, color: this.isDark ? '#777184' : Color.Transparent })
            .clip(true)

            Text('首条消息（选填）')
              .fontSize(13)
              .fontColor(secondary(this.isDark))
              .width('100%')
            TextArea({ text: this.state.conversation.message, placeholder: '不填则管理员先询问群聊用途' })
              .fontSize(15)
              .height(96)
              .fontColor(ink(this.isDark))
              .placeholderColor(secondary(this.isDark))
              .backgroundColor(card(this.isDark))
              .borderRadius(16)
              .border({ width: 0.8, color: line(this.isDark) })
              .onChange((value: string) => {
                BotStore.get().updateConversationMessage(value);
              })

            if (this.state.conversation.uncertain) {
              Column({ space: 8 }) {
                Text('提交结果未确认：可能已经创建，请先核对列表，不要直接重试。')
                  .fontSize(13)
                  .fontColor('#E0A03C')
                  .width('100%')
                Button('已核对列表，确认未创建')
                  .fontSize(13)
                  .height(36)
                  .borderRadius(18)
                  .backgroundColor(lavenderSoft(this.isDark))
                  .fontColor(purple(this.isDark))
                  .onClick(() => {
                    BotStore.get().confirmConversationNotCreated();
                  })
              }
              .width('100%')
              .padding(14)
              .borderRadius(16)
              .backgroundColor(card(this.isDark))
              .alignItems(HorizontalAlign.Start)
            } else if (this.state.conversation.error !== undefined && this.state.conversation.error.length > 0) {
              Text(this.state.conversation.error === 'need-members' ? '至少选择两位成员'
                : '创建失败：' + this.state.conversation.error)
                .fontSize(13)
                .fontColor('#D6263C')
                .width('100%')
            }

            Row().width('100%').height(16)
          }
          .width('100%')
          .padding({ left: 20, right: 20, top: 8 })
          .alignItems(HorizontalAlign.Start)
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        .align(Alignment.Top)

        this.footerBar()
      }
      .width('100%')
      .height('100%')
      .backgroundColor(canvas(this.isDark))
    }
    .hideTitleBar(true)
  }
}
