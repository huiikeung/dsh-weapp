/**
 * 新建会话 / 群聊（对齐 dsh-mobile 群聊创建流程）：
 * 选择成员（第一位为管理员）→ 首条消息（选填，留空则管理员先询问用途）→ 创建。
 * 提交结果不确定时不自动重试，提供「已核对列表，确认未创建」。
 */
import { BotChat, BotSnapshot, BotStore, emptyBotSnapshot } from 'nativecore';

@Component
export struct BotNewChatPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onState') state: BotSnapshot = emptyBotSnapshot();
  @State greet: boolean = true;
  @State handled: boolean = false;

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

  private candidates(): BotChat[] {
    const out: BotChat[] = [];
    for (const chat of this.state.chats) {
      if (!chat.room) {
        out.push(chat);
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

  @Builder
  header() {
    Row({ space: 10 }) {
      Button({ type: ButtonType.Circle }) {
        Text('‹').fontSize(24).fontColor(this.isDark ? '#E8EAED' : '#16181D').offset({ y: -1 })
      }
      .width(36).height(36)
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
      .onClick(() => {
        this.pageStack.pop();
      })
      Text('新建群聊')
        .fontSize(18).fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#FFFFFF' : '#101318')
        .layoutWeight(1)
      if (this.state.conversation.saving) {
        Text('创建中…').fontSize(12).fontColor('#2F7DF6')
      } else {
        Button('创建')
          .fontSize(13).fontColor('#FFFFFF')
          .backgroundColor(this.canCreate() ? '#2F7DF6' : 'rgba(47,125,246,0.4)')
          .borderRadius(14).height(30).padding({ left: 14, right: 14 })
          .enabled(this.canCreate())
          .onClick(() => {
            const text: string = this.state.conversation.message.trim();
            if (text.length > 0) {
              BotStore.get().updateConversationMessage(text);
            }
            BotStore.get().createConversationRoom(this.greet);
          })
      }
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: (this.safeTop > 0 ? this.safeTop : 38.9) + 4, bottom: 6 })
  }

  build() {
    NavDestination() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 10 }) {
          Text('选择成员（第一位为管理员）')
            .fontSize(12.5)
            .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
            .width('100%')
          ForEach(this.candidates(), (chat: BotChat) => {
            Row({ space: 10 }) {
              Circle({ width: 8, height: 8 })
                .fill(this.selectedIndex(chat.id) >= 0 ? '#2F7DF6' : 'rgba(128,128,128,0.4)')
              Column({ space: 2 }) {
                Text(chat.name)
                  .fontSize(14)
                  .fontColor(this.isDark ? '#E8EAED' : '#16181D')
                if (this.selectedIndex(chat.id) === 0) {
                  Text('管理员').fontSize(10.5).fontColor('#2F7DF6')
                }
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              if (this.selectedIndex(chat.id) >= 0) {
                Text((this.selectedIndex(chat.id) + 1).toString())
                  .fontSize(12).fontColor('#FFFFFF')
                  .backgroundColor('#2F7DF6').borderRadius(9)
                  .width(18).height(18).textAlign(TextAlign.Center)
              }
              if (chat.hidden) {
                Text('已隐藏').fontSize(10.5)
                  .fontColor(this.isDark ? 'rgba(232,234,237,0.4)' : 'rgba(22,24,29,0.35)')
              }
            }
            .width('100%')
            .padding({ top: 8, bottom: 8 })
            .onClick(() => {
              BotStore.get().toggleConversationMember(chat.id);
            })
          }, (chat: BotChat) => chat.id + ':' + this.selectedIndex(chat.id).toString())

          Text('首条消息（选填）')
            .fontSize(12.5)
            .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
            .width('100%')
          TextArea({ text: this.state.conversation.message, placeholder: '不填则管理员先询问群聊用途' })
            .fontSize(13.5).height(90)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
            .borderRadius(12)
            .onChange((value: string) => {
              BotStore.get().updateConversationMessage(value);
            })
          Row({ space: 8 }) {
            Text('管理员先发言').fontSize(13).fontColor(this.isDark ? '#E8EAED' : '#16181D')
            Blank()
            Toggle({ type: ToggleType.Switch, isOn: this.greet })
              .onChange((on: boolean) => {
                this.greet = on;
              })
          }
          .width('100%')

          if (this.state.conversation.uncertain) {
            Text('提交结果未确认：可能已经创建，请先核对列表，不要直接重试。')
              .fontSize(12).fontColor('#E0A03C').width('100%')
            Button('已核对列表，确认未创建')
              .fontSize(12.5).height(32).borderRadius(14)
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
              .fontColor(this.isDark ? '#D7DBE7' : '#404652')
              .onClick(() => {
                BotStore.get().confirmConversationNotCreated();
              })
          } else if (this.state.conversation.error !== undefined && this.state.conversation.error.length > 0) {
            Text(this.state.conversation.error === 'need-members' ? '至少选择两位成员'
              : '创建失败：' + this.state.conversation.error)
              .fontSize(12).fontColor('#D9534F').width('100%')
          }
          Row().width('100%').height(24 + this.safeBottom)
        }
        .padding({ left: 16, right: 16, top: 6 })
        .width('100%')
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.isDark ? '#0E1014' : '#F4F6FA')
    }
    .hideTitleBar(true)
  }
}
