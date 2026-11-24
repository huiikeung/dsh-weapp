/**
 * 新建 Bot（对齐 dsh-mobile BotCreateView）：
 * 名称 / 外形+配色 / 头像（素材库或上传图）/ 运行方式（团队模型或本地 Agent）/ 提交。
 */
import {
  BotAvatarPhoto, BotCreationAgent, BotCreationColor, BotCreationShape,
  BotRoleOption, BotSnapshot, BotStore, emptyBotSnapshot
} from 'nativecore';

@Component
export struct BotCreatePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onState') state: BotSnapshot = emptyBotSnapshot();

  @State name: string = '';
  @State shape: string = '';
  @State color: string = '';
  @State pickedPhoto: string = '';
  @State model: string = '';
  @State agentRoute: string = '';
  @State agentModel: string = '';
  @State createdHandled: boolean = false;

  aboutToAppear(): void {
    BotStore.get().openCreation();
    BotStore.get().loadCreationPhotos(true);
    BotStore.get().loadCreationAgents();
  }

  onState(): void {
    const appearance = this.state.creation.appearance;
    if (appearance !== undefined && this.shape.length === 0 && appearance.shapes.length > 0) {
      this.shape = appearance.shapes[0].id;
      this.color = appearance.colors.length > 0 ? appearance.colors[0].id : '';
    }
    const created: string = this.state.creation.createdId ?? '';
    if (created.length > 0 && !this.createdHandled) {
      this.createdHandled = true;
      BotStore.get().selectChat(created);
      this.pageStack.pop();
    }
  }

  private errorText(): string {
    const error: string = this.state.creation.error ?? '';
    if (error === 'invalid-name' || error === 'duplicate-name') {
      return '名称不可为空、不可重名（≤40 字，不能含 @ 或反引号）';
    }
    if (error === 'invalid-appearance') {
      return '请选择外形与配色';
    }
    if (error === 'uncertain') {
      return '提交结果未确认：请先核对列表，确认未创建后再试';
    }
    if (error === 'duplicate-name') {
      return '已有同名 Bot';
    }
    if (error === 'bd-request-failed' || error === 'bot-request-failed') {
      return '提交失败，请检查主机连接';
    }
    return error.length > 0 ? '创建失败：' + error : '';
  }

  private shapeImage(): string {
    const appearance = this.state.creation.appearance;
    if (appearance === undefined) {
      return '';
    }
    for (const one of appearance.shapes) {
      if (one.id === this.shape) {
        return one.images[this.color] ?? '';
      }
    }
    return '';
  }

  private colorStops(colorId: string): string[] {
    const appearance = this.state.creation.appearance;
    if (appearance === undefined) {
      return ['#888888', '#888888'];
    }
    for (const one of appearance.colors) {
      if (one.id === colorId) {
        return one.stops.length >= 2 ? one.stops : ['#888888', '#888888'];
      }
    }
    return ['#888888', '#888888'];
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
      Text('新建 Bot')
        .fontSize(18).fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#FFFFFF' : '#101318')
        .layoutWeight(1)
      if (this.state.creation.saving) {
        Text('创建中…').fontSize(12).fontColor('#2F7DF6')
      } else {
        Button('创建')
          .fontSize(13).fontColor('#FFFFFF').backgroundColor('#2F7DF6')
          .borderRadius(14).height(30).padding({ left: 14, right: 14 })
          .enabled(this.name.trim().length > 0 && this.shape.length > 0)
          .onClick(() => {
            const useLocal: boolean = this.agentRoute.length > 0;
            BotStore.get().createBot(this.name, this.shape, this.color,
              this.pickedPhoto.length > 0 ? this.pickedPhoto : undefined,
              useLocal ? this.agentRoute : (this.model.length > 0 ? this.model : undefined),
              undefined, false);
          })
      }
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: (this.safeTop > 0 ? this.safeTop : 38.9) + 4, bottom: 6 })
  }

  @Builder
  preview() {
    Column({ space: 8 }) {
      if (this.pickedPhoto.length > 0) {
        Image(this.pickedPhoto).width(96).height(96).borderRadius(48).objectFit(ImageFit.Cover)
      } else if (this.shapeImage().length > 0) {
        Image(this.shapeImage()).width(96).height(96).borderRadius(30).objectFit(ImageFit.Contain)
      } else {
        Circle({ width: 84, height: 84 }).fill('rgba(128,128,128,0.25)')
      }
      Text(this.name.length > 0 ? this.name : '未命名 Bot')
        .fontSize(15).fontColor(this.isDark ? '#E8EAED' : '#16181D')
    }
    .width('100%')
    .padding({ top: 10, bottom: 6 })
  }

  build() {
    NavDestination() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 12 }) {
          this.preview()

          TextInput({ text: this.name, placeholder: 'Bot 名称' })
            .fontSize(15).height(42)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
            .borderRadius(12)
            .onChange((value: string) => {
              this.name = value;
            })

          if (this.state.creation.loadingAppearance) {
            Text('正在加载形象目录…').fontSize(12.5)
              .fontColor(this.isDark ? 'rgba(232,234,237,0.5)' : 'rgba(22,24,29,0.45)')
          } else if (this.state.creation.appearanceFailed) {
            Text('主机未提供形象目录，稍后重试').fontSize(12.5).fontColor('#E0A03C')
          } else if (this.state.creation.appearance !== undefined) {
            Text('配色').fontSize(12.5)
              .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
              .width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.state.creation.appearance.colors, (item: BotCreationColor) => {
                Row()
                  .width(30).height(30).borderRadius(15)
                  .margin({ right: 8, bottom: 8 })
                  .linearGradient({ angle: 135, colors: [[this.colorStops(item.id)[0], 0], [this.colorStops(item.id)[1], 1]] })
                  .border({ width: this.color === item.id ? 2 : 0, color: '#2F7DF6' })
                  .onClick(() => {
                    this.color = item.id;
                    this.pickedPhoto = '';
                  })
              }, (item: BotCreationColor) => item.id)
            }
            .width('100%')
            Text('外形').fontSize(12.5)
              .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
              .width('100%')
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.state.creation.appearance.shapes, (item: BotCreationShape) => {
                Stack({ alignContent: Alignment.Center }) {
                  if (item.images[this.color] !== undefined) {
                    Image(item.images[this.color]).width(54).height(54).objectFit(ImageFit.Contain)
                  }
                }
                .width(64).height(64).borderRadius(16)
                .margin({ right: 8, bottom: 8 })
                .backgroundColor(this.shape === item.id
                  ? (this.isDark ? 'rgba(47,125,246,0.22)' : 'rgba(47,125,246,0.10)') : Color.Transparent)
                .border({ width: this.shape === item.id ? 2 : 0, color: '#2F7DF6' })
                .onClick(() => {
                  this.shape = item.id;
                  this.pickedPhoto = '';
                })
              }, (item: BotCreationShape) => item.id)
            }
            .width('100%')
          }

          Text('头像素材库').fontSize(12.5)
            .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
            .width('100%')
          if (this.state.creation.loadingPhotos && this.state.creation.photos.length === 0) {
            Text('加载中…').fontSize(12).fontColor('rgba(128,128,128,0.8)')
          } else if (this.state.creation.photos.length === 0) {
            Text('暂无素材（可直接用上方外形与配色）').fontSize(12)
              .fontColor(this.isDark ? 'rgba(232,234,237,0.4)' : 'rgba(22,24,29,0.35)')
          } else {
            Scroll() {
              Row({ space: 8 }) {
                ForEach(this.state.creation.photos, (photo: BotAvatarPhoto) => {
                  Image(photo.image)
                    .width(48).height(48).borderRadius(24).objectFit(ImageFit.Cover)
                    .border({ width: this.pickedPhoto === photo.image ? 2 : 0, color: '#2F7DF6' })
                    .onClick(() => {
                      this.pickedPhoto = photo.image;
                    })
                }, (photo: BotAvatarPhoto) => photo.id)
              }
            }
            .scrollable(ScrollDirection.Horizontal)
            .scrollBar(BarState.Off)
            .width('100%')
          }

          Text('运行方式').fontSize(12.5)
            .fontColor(this.isDark ? 'rgba(232,234,237,0.55)' : 'rgba(22,24,29,0.5)')
            .width('100%')
          Flex({ wrap: FlexWrap.Wrap }) {
            Text('DS Bot 模型')
              .fontSize(12.5)
              .fontColor(this.agentRoute.length === 0 ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
              .backgroundColor(this.agentRoute.length === 0 ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
              .borderRadius(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .margin({ right: 6, bottom: 6 })
              .onClick(() => {
                this.agentRoute = '';
                this.agentModel = '';
              })
            ForEach(this.state.creation.agents, (agent: BotCreationAgent) => {
              Text(agent.title)
                .fontSize(12.5)
                .fontColor(this.agentRoute === agent.id ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
                .backgroundColor(this.agentRoute === agent.id ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
                .borderRadius(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                .margin({ right: 6, bottom: 6 })
                .opacity(agent.available ? 1 : 0.45)
                .enabled(agent.available)
                .onClick(() => {
                  this.agentRoute = agent.id;
                  this.model = '';
                  BotStore.get().loadCreationAgentModels(agent.id);
                })
            }, (agent: BotCreationAgent) => agent.id)
          }
          .width('100%')

          if (this.agentRoute.length === 0) {
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.state.models, (option: BotRoleOption) => {
                Text(option.title)
                  .fontSize(12.5)
                  .fontColor(this.model === option.id ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
                  .backgroundColor(this.model === option.id ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
                  .borderRadius(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .margin({ right: 6, bottom: 6 })
                  .onClick(() => {
                    this.model = option.id;
                  })
              }, (option: BotRoleOption) => option.id)
            }
            .width('100%')
          } else if (this.state.creation.agentModels.length > 0) {
            Flex({ wrap: FlexWrap.Wrap }) {
              ForEach(this.state.creation.agentModels, (option: BotRoleOption) => {
                Text(option.title)
                  .fontSize(12.5)
                  .fontColor(this.agentModel === option.id ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
                  .backgroundColor(this.agentModel === option.id ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
                  .borderRadius(12).padding({ left: 10, right: 10, top: 5, bottom: 5 })
                  .margin({ right: 6, bottom: 6 })
                  .onClick(() => {
                    this.agentModel = option.id;
                  })
              }, (option: BotRoleOption) => option.id)
            }
            .width('100%')
          }

          if (this.errorText().length > 0) {
            Text(this.errorText()).fontSize(12.5).fontColor('#D9534F').width('100%')
          }
          Blank().height(24 + this.safeBottom)
        }
        .padding({ left: 16, right: 16 })
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
