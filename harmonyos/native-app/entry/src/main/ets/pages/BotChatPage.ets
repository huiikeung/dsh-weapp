/**
 * Bot 独立聊天页（对齐 dsh-mobile BotPrivateChatView）：
 * 顶栏（返回 / 头像 + 名称 / 更多） → 消息时间线（左右气泡、群聊显示发言者、Markdown）
 * → 待处理交互（提问 / 审批） → 输入条。
 */
import {
  BotAnswerChoice, BotChat, BotChatImage, BotChatMessage, BotInteraction,
  BotPresentedFile, BotQuestionAnswer, BotSnapshot, BotStore, emptyBotSnapshot
} from 'nativecore';
import { MarkdownBodyView } from '../components/MarkdownBodyView';
import { BotMessageImage } from '../components/BotMessageImage';

@Component
export struct BotChatPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('keyboardHeightVp') keyboardVp: number = 0;
  @StorageLink('botState') @Watch('onStateChanged') state: BotSnapshot = emptyBotSnapshot();

  @State draft: string = '';
  @State sending: boolean = false;
  @State picked: string[] = [];
  @State pickedFor: string = '';
  @State customAnswer: string = '';
  @State moreOpen: boolean = false;
  /** 进入动画：从右侧轻推入（与 Bot 首页区分层级） */
  @State enterOpacity: number = 1;
  @State enterShift: number = 0;

  private scroller: Scroller = new Scroller();
  private lastTailKey: string = '';

  aboutToAppear(): void {
    BotStore.get().setForeground(true);
    this.scheduleScroll();
    this.enterOpacity = 0;
    this.enterShift = 22;
    setTimeout(() => {
      try {
        this.getUIContext().animateTo({ duration: 280, curve: Curve.FastOutSlowIn }, () => {
          this.enterOpacity = 1;
          this.enterShift = 0;
        });
      } catch (error) {
        this.enterOpacity = 1;
        this.enterShift = 0;
      }
    }, 40);
    setTimeout(() => {
      if (this.enterOpacity < 1) {
        this.enterOpacity = 1;
        this.enterShift = 0;
      }
    }, 600);
  }

  onStateChanged(): void {
    const chatId: string = this.state.selectedChatId ?? '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId && interaction.kind === 'question' && interaction.id !== this.pickedFor) {
        this.pickedFor = interaction.id;
        this.picked = [];
        this.customAnswer = '';
      }
    }
    this.scheduleScroll();
  }

  private scheduleScroll(): void {
    const messages: BotChatMessage[] = this.state.messages;
    const tail: string = messages.length === 0 ? '' : messages[messages.length - 1].id
      + ':' + messages[messages.length - 1].text.length.toString();
    if (tail === this.lastTailKey) {
      return;
    }
    this.lastTailKey = tail;
    setTimeout(() => {
      try {
        this.scroller.scrollEdge(Edge.Bottom);
      } catch (error) {
      }
    }, 30);
  }

  private chat(): BotChat | null {
    const id: string = this.state.selectedChatId ?? '';
    for (const chat of this.state.chats) {
      if (chat.id === id) {
        return chat;
      }
    }
    return null;
  }

  private pendingQuestion(): BotInteraction | null {
    const chatId: string = this.state.selectedChatId ?? '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId && interaction.kind === 'question') {
        return interaction;
      }
    }
    return null;
  }

  private pendingApproval(): BotInteraction | null {
    const chatId: string = this.state.selectedChatId ?? '';
    for (const interaction of this.state.interactions) {
      if (interaction.chatId === chatId && interaction.kind === 'approval') {
        return interaction;
      }
    }
    return null;
  }

  private avatarColor(id: string): string {
    const palette: string[] = ['#5B7CFA', '#7A5BFA', '#2FA98C', '#D97706', '#DB2777', '#0EA5E9'];
    let hash: number = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 997;
    }
    return palette[hash % palette.length];
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  private isMine(message: BotChatMessage): boolean {
    return message.kind === 'user';
  }

  private showSpeaker(message: BotChatMessage): boolean {
    const chat: BotChat | null = this.chat();
    return chat !== null && chat.room && !this.isMine(message) && message.name.length > 0;
  }

  private onSend(): void {
    const text: string = this.draft.trim();
    if (text.length === 0 || this.sending) {
      return;
    }
    this.sending = true;
    const ok: boolean = BotStore.get().sendMessage(text, [], []);
    this.sending = false;
    if (ok) {
      this.draft = '';
    }
  }

  private togglePick(label: string, multi: boolean): void {
    if (!multi) {
      this.picked = [label];
      return;
    }
    const index: number = this.picked.indexOf(label);
    const next: string[] = this.picked.slice();
    if (index >= 0) {
      next.splice(index, 1);
    } else {
      next.push(label);
    }
    this.picked = next;
  }

  // ==================== 组件 ====================

  @Builder
  header() {
    Row({ space: 10 }) {
      Button({ type: ButtonType.Circle }) {
        Text('‹')
          .fontSize(24)
          .fontColor(this.isDark ? '#E8EAED' : '#16181D')
          .offset({ y: -1 })
      }
      .width(36)
      .height(36)
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
      .onClick(() => {
        BotStore.get().closeChat();
        this.pageStack.pop();
      })

      if (this.chat() !== null) {
        Stack({ alignContent: Alignment.Center }) {
          Circle({ width: 30, height: 30 })
            .fill(this.avatarColor((this.chat() as BotChat).id))
          Text((this.chat() as BotChat).name.length > 0
            ? (this.chat() as BotChat).name.substring(0, 1) : 'B')
            .fontSize(13)
            .fontColor('#FFFFFF')
        }
        .width(30)
        .height(30)
      }
      Column({ space: 1 }) {
        Text(this.chat() !== null ? (this.chat() as BotChat).name : '聊天')
          .fontSize(16.5)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.isDark ? '#FFFFFF' : '#101318')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.state.liveWork[this.state.selectedChatId ?? ''] !== undefined) {
          Text('运行中')
            .fontSize(10.5)
            .fontColor('#2F7DF6')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)

      Button({ type: ButtonType.Circle }) {
        Text('⋯')
          .fontSize(17)
          .fontColor(this.isDark ? '#E8EAED' : '#16181D')
      }
      .width(34)
      .height(34)
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
      .onClick(() => {
        this.moreOpen = true;
      })
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: this.topInset() + 4, bottom: 6 })
  }

  @Builder
  messageRow(message: BotChatMessage) {
    Column({ space: 4 }) {
      if (this.showSpeaker(message)) {
        Text(message.name)
          .fontSize(11)
          .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.45)')
          .margin({ left: 44 })
      }
      Row() {
        if (!this.isMine(message) && this.chat() !== null) {
          Stack({ alignContent: Alignment.Center }) {
            Circle({ width: 30, height: 30 })
              .fill(this.avatarColor((this.chat() as BotChat).id))
            Text((this.chat() as BotChat).name.length > 0
              ? (this.chat() as BotChat).name.substring(0, 1) : 'B')
              .fontSize(13)
              .fontColor('#FFFFFF')
          }
          .width(30)
          .height(30)
          .margin({ right: 8, top: 2 })
        }
        if (this.isMine(message)) {
          Blank()
        }
        Column({ space: 6 }) {
          if (message.activity !== undefined && message.activity.length > 0) {
            Text(message.activity === 'bot-created' ? '创建了 ' + message.name : '向 ' + message.name + ' 发了消息')
              .fontSize(12)
              .fontColor(this.isDark ? 'rgba(232,234,237,0.5)' : 'rgba(22,24,29,0.45)')
          } else if (message.kind === 'answer' && message.questionAnswers.length > 0) {
            ForEach(message.questionAnswers, (answer: BotQuestionAnswer) => {
              Column({ space: 4 }) {
                Text(answer.question)
                  .fontSize(12.5)
                  .fontColor(this.isDark ? 'rgba(232,234,237,0.6)' : 'rgba(22,24,29,0.55)')
                Row({ space: 6 }) {
                  ForEach(answer.choices, (choice: BotAnswerChoice) => {
                    Text((choice.letter !== undefined ? choice.letter + '. ' : '') + choice.label)
                      .fontSize(12.5)
                      .fontColor(this.isDark ? '#DCE3F5' : '#2C3550')
                      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)')
                      .borderRadius(8)
                      .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                  })
                }
                .width('100%')
              }
              .alignItems(HorizontalAlign.Start)
              .width('100%')
            })
          } else if (message.text.length > 0) {
            if (this.isMine(message)) {
              Text(message.text)
                .fontSize(15)
                .fontColor('#FFFFFF')
                .lineHeight(22)
                .padding({ left: 12, right: 12, top: 9, bottom: 9 })
                .backgroundColor('#2F7DF6')
                .borderRadius(16)
                .constraintSize({ maxWidth: '78%' })
            } else {
              Column() {
                MarkdownBodyView({ text: message.text, fontSize: 15.5 })
              }
              .width('100%')
              .constraintSize({ maxWidth: '86%' })
              .padding({ left: 12, right: 12, top: 9, bottom: 9 })
              .backgroundColor(this.isDark ? 'rgba(255,255,255,0.07)' : '#FFFFFF')
              .borderRadius(16)
            }
          }
          if (message.images.length > 0) {
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(message.images, (image: BotChatImage) => {
                BotMessageImage({
                  chatId: this.state.selectedChatId ?? '',
                  attachmentId: image.attachmentId,
                  sessionId: image.sessionId,
                  mediaType: image.mediaType
                })
                  .margin({ right: 6, bottom: 6 })
              }, (image: BotChatImage) => image.sessionId + ':' + image.attachmentId)
            }
            .width('100%')
          }
          if (message.files.length > 0) {
            Column({ space: 4 }) {
              ForEach(message.files, (file: BotPresentedFile) => {
                Row({ space: 6 }) {
                  Text('📄')
                    .fontSize(12)
                  Text(file.name)
                    .fontSize(12)
                    .fontColor(this.isDark ? '#C9D4EC' : '#2C3550')
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .layoutWeight(1)
                }
                .width('100%')
              })
            }
            .width('100%')
            .padding(8)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(46,107,230,0.05)')
            .borderRadius(10)
          }
        }
        .alignItems(this.isMine(message) ? HorizontalAlign.End : HorizontalAlign.Start)
        .layoutWeight(1)
        if (!this.isMine(message)) {
          Blank()
        }
      }
      .width('100%')
      .padding({ left: 14, right: 14, top: 4, bottom: 4 })
    }
    .width('100%')
    .alignItems(this.isMine(message) ? HorizontalAlign.End : HorizontalAlign.Start)
  }

  @Builder
  streamingRow(message: BotChatMessage) {
    Row({ space: 8 }) {
      if (this.chat() !== null) {
        Stack({ alignContent: Alignment.Center }) {
          Circle({ width: 30, height: 30 })
            .fill(this.avatarColor((this.chat() as BotChat).id))
          Text((this.chat() as BotChat).name.length > 0
            ? (this.chat() as BotChat).name.substring(0, 1) : 'B')
            .fontSize(13)
            .fontColor('#FFFFFF')
        }
        .width(30)
        .height(30)
      }
      Column() {
        MarkdownBodyView({ text: message.text, fontSize: 15.5 })
      }
      .constraintSize({ maxWidth: '78%' })
      .padding({ left: 12, right: 12, top: 9, bottom: 9 })
      .backgroundColor(this.isDark ? 'rgba(255,255,255,0.07)' : '#FFFFFF')
      .borderRadius(16)
      if (message.streaming) {
        Text('●')
          .fontSize(8)
          .fontColor('#2F7DF6')
      }
      Blank()
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 4, bottom: 4 })
  }

  @Builder
  questionCard(interaction: BotInteraction) {
    Column({ space: 10 }) {
      Text(interaction.title)
        .fontSize(14.5)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#F1F4FA' : '#101318')
        .width('100%')
      if (interaction.detail.length > 0) {
        Text(interaction.detail)
          .fontSize(12)
          .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
          .width('100%')
      }
      Flex({ wrap: FlexWrap.Wrap }) {
        ForEach(interaction.options, (option: string) => {
          Text(option)
            .fontSize(13)
            .fontColor(this.picked.indexOf(option) >= 0 ? '#FFFFFF'
              : (this.isDark ? '#DCE3F5' : '#2C3550'))
            .backgroundColor(this.picked.indexOf(option) >= 0 ? '#2F7DF6'
              : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
            .borderRadius(14)
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .margin({ right: 6, bottom: 6 })
            .onClick(() => {
              this.togglePick(option, interaction.multiSelect);
            })
        })
      }
      .width('100%')
      TextInput({ text: this.customAnswer, placeholder: '补充回答（可留空）' })
        .fontSize(13)
        .height(38)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .borderRadius(10)
        .onChange((value: string) => {
          this.customAnswer = value;
        })
      Button('提交回答')
        .fontSize(14)
        .fontColor('#FFFFFF')
        .backgroundColor(this.picked.length === 0 && this.customAnswer.trim().length === 0
          ? 'rgba(47,125,246,0.4)' : '#2F7DF6')
        .borderRadius(16)
        .height(36)
        .width('100%')
        .enabled(this.picked.length > 0 || this.customAnswer.trim().length > 0)
        .onClick(() => {
          const ok: boolean = BotStore.get().answerQuestion(interaction.id, this.picked, this.customAnswer);
          if (ok) {
            this.picked = [];
            this.customAnswer = '';
          }
        })
    }
    .width('100%')
    .padding(14)
    .backgroundColor(this.isDark ? 'rgba(38,40,48,0.9)' : 'rgba(255,255,255,0.95)')
    .borderRadius(16)
    .margin({ left: 12, right: 12, top: 6 })
  }

  @Builder
  approvalCard(interaction: BotInteraction) {
    Column({ space: 8 }) {
      Text('需要批准')
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor('#E0A03C')
        .width('100%')
      Text(interaction.title)
        .fontSize(13.5)
        .fontColor(this.isDark ? '#F1F4FA' : '#101318')
        .width('100%')
      if (interaction.detail.length > 0) {
        Text(interaction.detail)
          .fontSize(12)
          .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
          .maxLines(4)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }
      Row({ space: 10 }) {
        Button('拒绝')
          .fontSize(14)
          .fontColor(this.isDark ? '#D7DBE7' : '#404652')
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
          .borderRadius(16)
          .height(36)
          .layoutWeight(1)
          .onClick(() => {
            BotStore.get().answerApproval(interaction.id, false);
          })
        Button('允许一次')
          .fontSize(14)
          .fontColor('#FFFFFF')
          .backgroundColor('#2F7DF6')
          .borderRadius(16)
          .height(36)
          .layoutWeight(1)
          .onClick(() => {
            BotStore.get().answerApproval(interaction.id, true);
          })
      }
      .width('100%')
    }
    .width('100%')
    .padding(14)
    .backgroundColor(this.isDark ? 'rgba(38,40,48,0.9)' : 'rgba(255,255,255,0.95)')
    .borderRadius(16)
    .margin({ left: 12, right: 12, top: 6 })
  }

  @Builder
  composer() {
    Row({ space: 8 }) {
      TextInput({ text: this.draft, placeholder: '发消息给 ' + (this.chat() !== null ? (this.chat() as BotChat).name : 'Bot') })
        .fontSize(15)
        .fontColor(this.isDark ? '#E8EAED' : '#16181D')
        .placeholderColor(this.isDark ? 'rgba(232,234,237,0.35)' : 'rgba(22,24,29,0.3)')
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .borderRadius(20)
        .height(40)
        .layoutWeight(1)
        .onChange((value: string) => {
          this.draft = value;
        })
        .onSubmit(() => {
          this.onSend();
        })
      Button({ type: ButtonType.Circle }) {
        Text('↑')
          .fontSize(18)
          .fontColor('#FFFFFF')
      }
      .width(40)
      .height(40)
      .backgroundColor(this.draft.trim().length === 0 ? 'rgba(47,125,246,0.4)' : '#2F7DF6')
      .enabled(this.draft.trim().length > 0)
      .onClick(() => {
        this.onSend();
      })
    }
    .width('100%')
    .padding({ left: 12, right: 12, top: 8, bottom: 8 + this.safeBottom })
    .backgroundColor(this.isDark ? 'rgba(20,22,27,0.96)' : 'rgba(244,246,250,0.96)')
  }

  @Builder
  moreMenu() {
    Menu() {
      MenuItem({ content: '查看角色资料' })
        .onClick(() => {
          const chat: BotChat | null = this.chat();
          if (chat !== null && !chat.room) {
            BotStore.get().openRole(chat.id);
            this.pageStack.pushPathByName('bot-role', chat.id);
          }
        })
      MenuItem({ content: '加载更早消息' })
        .onClick(() => {
          BotStore.get().loadEarlier();
        })
    }
  }

  build() {
    NavDestination() {
    Column() {
      this.header()

      if (!this.state.supported) {
        Column({ space: 8 }) {
          Text('主机未启用 DS-Bot')
            .fontSize(15)
            .fontColor(this.isDark ? '#E8EAED' : '#16181D')
          Text('在电脑上安装并启用官方 DS-Bot 插件后，这里会显示 Bot 团队。')
            .fontSize(12.5)
            .fontColor(this.isDark ? 'rgba(232,234,237,0.5)' : 'rgba(22,24,29,0.45)')
            .textAlign(TextAlign.Center)
        }
        .layoutWeight(1)
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .padding(30)
      } else {
        List({ scroller: this.scroller }) {
          ForEach(this.state.messages, (message: BotChatMessage) => {
            ListItem() {
              if (message.streaming === true || message.kind === 'stream') {
                this.streamingRow(message)
              } else {
                this.messageRow(message)
              }
            }
          }, (message: BotChatMessage) => message.id + ':' + message.text.length.toString())
          if (this.state.messages.length === 0 && this.state.historyLoading) {
            ListItem() {
              Text('加载中…')
                .fontSize(13)
                .fontColor(this.isDark ? 'rgba(232,234,237,0.45)' : 'rgba(22,24,29,0.4)')
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            }
          }
        }
        .layoutWeight(1)
        .width('100%')
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
        .onReachStart(() => {
          if (this.state.hasEarlier && !this.state.historyLoading) {
            BotStore.get().loadEarlier();
          }
        })

        if (this.pendingApproval() !== null) {
          this.approvalCard(this.pendingApproval() as BotInteraction)
        }
        if (this.pendingQuestion() !== null) {
          this.questionCard(this.pendingQuestion() as BotInteraction)
        }

        this.composer()
      }

      if (this.moreOpen) {
        this.moreMenu()
      }
    }
    .width('100%')
    .height('100%')
    .opacity(this.enterOpacity)
    .translate({ x: this.enterShift })
    .backgroundColor(this.isDark ? '#141220' : '#F4F2FB')
    }
    .hideTitleBar(true)
  }
}
