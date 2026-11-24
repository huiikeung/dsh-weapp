/**
 * Bot 角色管理（对齐 dsh-mobile BotManagementView 的 Bot 编辑面板）：
 * 资料（名称/标签/指令/工作目录/模型/思考强度/权限/私有）→ 记忆 → 定时任务 → 复制/设为主/删除。
 */
import {
  BotChat, BotMemory, BotRoleOption, BotSchedule, BotSnapshot, BotStore, emptyBotSnapshot
} from 'nativecore';

@Component
export struct BotRolePage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('safeTopVp') safeTop: number = 0;
  @StorageLink('safeBottomVp') safeBottom: number = 0;
  @StorageLink('botState') @Watch('onState') state: BotSnapshot = emptyBotSnapshot();

  @State name: string = '';
  @State role: string = '';
  @State instructions: string = '';
  @State workDir: string = '';
  @State model: string = '';
  @State effort: string = '';
  @State permission: string = '';
  @State privateRole: boolean = false;
  @State loaded: boolean = false;

  @State openModels: boolean = false;
  @State openEfforts: boolean = false;
  @State openPermissions: boolean = false;
  @State memoryDraft: string = '';
  @State editingMemory: string = '';
  @State editingText: string = '';
  @State scheduleTitle: string = '';
  @State schedulePrompt: string = '';
  @State scheduleTime: string = '09:00';
  @State showScheduleForm: boolean = false;

  aboutToAppear(): void {
    const chat: BotChat | null = this.bot();
    if (chat !== null) {
      BotStore.get().openRole(chat.id);
      this.syncFrom(chat);
    }
  }

  onState(): void {
    if (!this.loaded) {
      const chat: BotChat | null = this.bot();
      if (chat !== null && chat.profile !== undefined) {
        this.syncFrom(chat);
      }
    }
  }

  private syncFrom(chat: BotChat): void {
    const profile = chat.profile;
    if (profile === undefined) {
      return;
    }
    this.name = chat.name;
    this.role = chat.role;
    this.instructions = profile.instructions;
    this.workDir = profile.workDir ?? '';
    this.model = profile.model ?? '';
    this.effort = profile.effort ?? '';
    this.permission = profile.permission ?? '';
    this.privateRole = profile.privateRole;
    this.loaded = true;
  }

  private botId(): string {
    return this.state.roleDetails !== undefined ? this.state.roleDetails.botId : '';
  }

  private bot(): BotChat | null {
    const id: string = this.botId();
    if (id.length === 0) {
      return null;
    }
    for (const chat of this.state.chats) {
      if (chat.id === id) {
        return chat;
      }
    }
    return null;
  }

  private save(): void {
    const id: string = this.botId();
    if (id.length === 0) {
      return;
    }
    const changes: Record<string, Object> = {};
    const chat: BotChat | null = this.bot();
    if (chat !== null && this.name.trim().length > 0 && this.name.trim() !== chat.name) {
      changes.name = this.name.trim();
    }
    if (chat !== null && this.role !== chat.role) {
      changes.role = this.role;
    }
    if (chat !== null && chat.profile !== undefined && this.instructions !== chat.profile.instructions) {
      changes.instructions = this.instructions;
    }
    if (this.workDir.trim().length > 0) {
      changes.workDir = this.workDir.trim();
    }
    if (this.model.length > 0) {
      changes.model = this.model;
    }
    if (this.effort.length > 0) {
      changes.effort = this.effort;
    }
    if (this.permission.length > 0) {
      changes.permission = this.permission;
    }
    if (this.privateRole) {
      changes.private = true;
    }
    if (Object.keys(changes).length > 0) {
      BotStore.get().updateRole(id, changes);
    }
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
      Text(this.name.length > 0 ? this.name : '角色资料')
        .fontSize(18).fontWeight(FontWeight.Medium)
        .fontColor(this.isDark ? '#FFFFFF' : '#101318')
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      if (this.state.roleSaving) {
        Text('保存中…').fontSize(12).fontColor('#2F7DF6')
      } else {
        Button('保存')
          .fontSize(13).fontColor('#FFFFFF').backgroundColor('#2F7DF6')
          .borderRadius(14).height(30).padding({ left: 14, right: 14 })
          .onClick(() => {
            this.save();
          })
      }
    }
    .width('100%')
    .padding({ left: 10, right: 14, top: (this.safeTop > 0 ? this.safeTop : 38.9) + 4, bottom: 6 })
  }

  @Builder
  section(title: string) {
    Text(title)
      .fontSize(12.5)
      .fontColor(this.isDark ? 'rgba(232,234,237,0.5)' : 'rgba(22,24,29,0.45)')
      .width('100%')
      .padding({ left: 18, top: 16, bottom: 6 })
  }

  @Builder
  fieldLabel(title: string) {
    Text(title).fontSize(13).fontColor(this.isDark ? 'rgba(232,234,237,0.62)' : 'rgba(22,24,29,0.55)')
  }

  @Builder
  card() {
    Column({ space: 10 }) {
      this.fieldLabel('名称')
      TextInput({ text: this.name, placeholder: 'Bot 名称' })
        .fontSize(14).height(38)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .borderRadius(10)
        .onChange((value: string) => {
          this.name = value;
        })
      this.fieldLabel('标签')
      TextInput({ text: this.role, placeholder: '一句话说明（不授予权限）' })
        .fontSize(14).height(38)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .borderRadius(10)
        .onChange((value: string) => {
          this.role = value;
        })
      this.fieldLabel('指令')
      TextArea({ text: this.instructions, placeholder: 'Bot 的工作说明' })
        .fontSize(13.5)
        .height(110)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .borderRadius(10)
        .onChange((value: string) => {
          this.instructions = value;
        })
      this.fieldLabel('工作目录')
      TextInput({ text: this.workDir, placeholder: '留空使用团队工作区（绝对路径）' })
        .fontSize(13.5).height(38)
        .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
        .borderRadius(10)
        .onChange((value: string) => {
          this.workDir = value;
        })
      this.fieldLabel('模型')
      Row({ space: 8 }) {
        Text(this.model.length > 0 ? this.model : '跟随团队默认')
          .fontSize(13.5)
          .layoutWeight(1)
          .fontColor(this.isDark ? '#E8EAED' : '#16181D')
        Button('切换')
          .fontSize(12).height(28).borderRadius(14)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
          .fontColor(this.isDark ? '#D7DBE7' : '#404652')
          .onClick(() => {
            this.openModels = !this.openModels;
            this.openEfforts = false;
            this.openPermissions = false;
          })
      }
      .width('100%')
      if (this.openModels) {
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.state.models, (option: BotRoleOption) => {
            Text(option.title)
              .fontSize(12.5)
              .fontColor(this.model === option.id ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
              .backgroundColor(this.model === option.id ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
              .borderRadius(12)
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .margin({ right: 6, bottom: 6 })
              .onClick(() => {
                this.model = option.id;
                this.openModels = false;
                BotStore.get().loadEfforts(option.id);
              })
          })
        }
        .width('100%')
      }
      if (this.state.efforts.length > 0) {
        this.fieldLabel('思考强度')
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.state.efforts, (option: BotRoleOption) => {
            Text(option.title)
              .fontSize(12.5)
              .fontColor(this.effort === option.id ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
              .backgroundColor(this.effort === option.id ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
              .borderRadius(12)
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .margin({ right: 6, bottom: 6 })
              .onClick(() => {
                this.effort = option.id;
              })
          })
        }
        .width('100%')
      }
      if (this.state.permissions.length > 0) {
        this.fieldLabel('权限')
        Flex({ wrap: FlexWrap.Wrap }) {
          ForEach(this.state.permissions, (option: BotRoleOption) => {
            Text(option.title)
              .fontSize(12.5)
              .fontColor(this.permission === option.id ? '#FFFFFF' : (this.isDark ? '#DCE3F5' : '#2C3550'))
              .backgroundColor(this.permission === option.id ? '#2F7DF6' : (this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(46,107,230,0.08)'))
              .borderRadius(12)
              .padding({ left: 10, right: 10, top: 5, bottom: 5 })
              .margin({ right: 6, bottom: 6 })
              .onClick(() => {
                this.permission = option.id;
              })
          })
        }
        .width('100%')
      }
      Row() {
        Column({ space: 2 }) {
          Text('私有 Bot').fontSize(13.5).fontColor(this.isDark ? '#E8EAED' : '#16181D')
          Text('其他 Bot 无法读取它的目录、记忆与历史')
            .fontSize(11.5).fontColor(this.isDark ? 'rgba(232,234,237,0.45)' : 'rgba(22,24,29,0.4)')
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)
        Toggle({ type: ToggleType.Switch, isOn: this.privateRole })
          .onChange((on: boolean) => {
            this.privateRole = on;
          })
      }
      .width('100%')
    }
    .padding(14)
    .backgroundColor(this.isDark ? 'rgba(38,40,48,0.78)' : 'rgba(255,255,255,0.9)')
    .borderRadius(16)
    .margin({ left: 14, right: 14 })
  }

  @Builder
  memories() {
    Column({ space: 8 }) {
      if (this.state.roleDetails === undefined || this.state.roleDetails.memories.length === 0) {
        Text(this.state.memoryAvailable ? '暂无记忆' : '主机未启用记忆')
          .fontSize(12.5)
          .fontColor(this.isDark ? 'rgba(232,234,237,0.45)' : 'rgba(22,24,29,0.4)')
      } else {
        ForEach(this.state.roleDetails.memories, (memory: BotMemory) => {
          Column({ space: 4 }) {
            if (this.editingMemory === memory.id) {
              TextArea({ text: this.editingText })
                .fontSize(12.5)
                .height(60)
                .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
                .borderRadius(8)
                .onChange((value: string) => {
                  this.editingText = value;
                })
              Row({ space: 8 }) {
                Button('保存')
                  .fontSize(12).height(28).borderRadius(14).backgroundColor('#2F7DF6').fontColor('#FFFFFF')
                  .onClick(() => {
                    BotStore.get().saveMemory(this.botId(), memory.id, this.editingText);
                    this.editingMemory = '';
                  })
                Button('取消')
                  .fontSize(12).height(28).borderRadius(14)
                  .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
                  .fontColor(this.isDark ? '#D7DBE7' : '#404652')
                  .onClick(() => {
                    this.editingMemory = '';
                  })
              }
            } else {
              Text(memory.text)
                .fontSize(12.5)
                .fontColor(this.isDark ? '#DCE3F5' : '#2C3550')
                .width('100%')
              Row({ space: 10 }) {
                Text('编辑').fontSize(11.5).fontColor('#2F7DF6')
                  .onClick(() => {
                    this.editingMemory = memory.id;
                    this.editingText = memory.text;
                  })
                Text('忘记').fontSize(11.5).fontColor('#D9534F')
                  .onClick(() => {
                    BotStore.get().forgetMemory(this.botId(), memory.id);
                  })
              }
              .width('100%')
            }
          }
          .alignItems(HorizontalAlign.Start)
          .width('100%')
          .padding(10)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)')
          .borderRadius(10)
        })
      }
      Row({ space: 8 }) {
        TextInput({ text: this.memoryDraft, placeholder: '新增记忆' })
          .fontSize(13).height(36).layoutWeight(1)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
          .borderRadius(10)
          .onChange((value: string) => {
            this.memoryDraft = value;
          })
        Button('添加')
          .fontSize(12.5).height(32).borderRadius(14).backgroundColor('#2F7DF6').fontColor('#FFFFFF')
          .enabled(this.memoryDraft.trim().length > 0)
          .onClick(() => {
            const ok: boolean = BotStore.get().saveMemory(this.botId(), undefined, this.memoryDraft);
            if (ok) {
              this.memoryDraft = '';
            }
          })
      }
      .width('100%')
    }
    .padding(14)
    .backgroundColor(this.isDark ? 'rgba(38,40,48,0.78)' : 'rgba(255,255,255,0.9)')
    .borderRadius(16)
    .margin({ left: 14, right: 14 })
  }

  @Builder
  schedules() {
    Column({ space: 8 }) {
      if (this.state.schedules.length === 0) {
        Text(this.state.schedulesAvailable ? '暂无定时任务' : '主机未启用定时任务')
          .fontSize(12.5)
          .fontColor(this.isDark ? 'rgba(232,234,237,0.45)' : 'rgba(22,24,29,0.4)')
      } else {
        ForEach(this.state.schedules, (task: BotSchedule) => {
          Row({ space: 8 }) {
            Column({ space: 2 }) {
              Text(task.title).fontSize(13).fontColor(this.isDark ? '#E8EAED' : '#16181D')
              Text(task.status + ' · ' + task.next)
                .fontSize(11).fontColor(this.isDark ? 'rgba(232,234,237,0.45)' : 'rgba(22,24,29,0.4)')
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)
            if (task.botId === this.botId()) {
              Text('删除').fontSize(11.5).fontColor('#D9534F')
                .onClick(() => {
                  BotStore.get().deleteSchedule(this.botId(), task.id);
                })
            }
          }
          .width('100%')
          .padding({ top: 6, bottom: 6 })
        })
      }
      if (this.showScheduleForm) {
        TextInput({ text: this.scheduleTitle, placeholder: '任务标题' })
          .fontSize(13).height(36)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
          .borderRadius(10)
          .onChange((value: string) => {
            this.scheduleTitle = value;
          })
        TextInput({ text: this.schedulePrompt, placeholder: '发给 Bot 的指令' })
          .fontSize(13).height(36)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
          .borderRadius(10)
          .onChange((value: string) => {
            this.schedulePrompt = value;
          })
        TextInput({ text: this.scheduleTime, placeholder: 'HH:mm' })
          .fontSize(13).height(36)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
          .borderRadius(10)
          .onChange((value: string) => {
            this.scheduleTime = value;
          })
        Row({ space: 8 }) {
          Button('创建')
            .fontSize(12.5).height(32).borderRadius(14).backgroundColor('#2F7DF6').fontColor('#FFFFFF')
            .onClick(() => {
              const ok: boolean = BotStore.get().scheduleDaily(this.botId(), this.scheduleTitle,
                this.schedulePrompt, this.scheduleTime, 'Asia/Shanghai');
              if (ok) {
                this.showScheduleForm = false;
                this.scheduleTitle = '';
                this.schedulePrompt = '';
              }
            })
          Button('取消')
            .fontSize(12.5).height(32).borderRadius(14)
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
            .fontColor(this.isDark ? '#D7DBE7' : '#404652')
            .onClick(() => {
              this.showScheduleForm = false;
            })
        }
      } else {
        Text('+ 新建每日任务')
          .fontSize(12.5).fontColor('#2F7DF6')
          .onClick(() => {
            this.showScheduleForm = true;
          })
      }
    }
    .padding(14)
    .backgroundColor(this.isDark ? 'rgba(38,40,48,0.78)' : 'rgba(255,255,255,0.9)')
    .borderRadius(16)
    .margin({ left: 14, right: 14 })
  }

  @Builder
  actions() {
    Column({ space: 10 }) {
      Row({ space: 10 }) {
        Button('复制 Bot')
          .fontSize(13).height(36).borderRadius(16).layoutWeight(1)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
          .fontColor(this.isDark ? '#D7DBE7' : '#404652')
          .onClick(() => {
            BotStore.get().duplicateRole(this.botId());
          })
        Button('设为主 Bot')
          .fontSize(13).height(36).borderRadius(16).layoutWeight(1)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
          .fontColor(this.isDark ? '#D7DBE7' : '#404652')
          .enabled(!BotStore.get().isMainBot(this.botId()))
          .onClick(() => {
            BotStore.get().replacePrimary(BotStore.get().snapshot().mainBotId ?? '', this.botId());
          })
      }
      .width('100%')
      Button('删除 Bot')
        .fontSize(13).height(36).borderRadius(16).width('100%')
        .backgroundColor('rgba(217,83,79,0.12)')
        .fontColor('#D9534F')
        .enabled(BotStore.get().snapshot().botDeletionSupported && !BotStore.get().isMainBot(this.botId()))
        .onClick(() => {
          BotStore.get().deleteRole(this.botId());
        })
      if (this.state.roleError !== undefined) {
        Text('操作失败：' + this.state.roleError)
          .fontSize(11.5).fontColor('#D9534F')
      }
    }
    .padding(14)
    .margin({ left: 14, right: 14 })
  }

  build() {
    NavDestination() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 2 }) {
          this.section('资料')
          this.card()
          this.section('记忆')
          this.memories()
          this.section('定时任务')
          this.schedules()
          this.section('操作')
          this.actions()
          Row().width('100%').height(30 + this.safeBottom)
        }
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
