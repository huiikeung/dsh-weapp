/**
 * 我的 Bot（对齐 dsh-mobile BotManagementView「我的 Bot」列表）：
 * 团队成员列表（含隐藏 Bot）→ 主 Bot 徽标 → 点行进入角色页；右上「新建 Bot」。
 * 只做查看/进入/新建，删除与编辑在角色页，和 iOS 保持一致。
 */
import { BOT_BG_DEFAULT, BotChat, BotPalette, botPalette, BotSnapshot, BotStore, emptyBotSnapshot } from 'nativecore';
import { NavBackButton } from '../components/NavBackButton';
import { BotRoleSheet } from '../components/BotRoleSheet';
import { immersiveSheetSupported, sheetFallbackColor, sheetSystemMaterial } from '../common/SheetMaterial';

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

/** 首字徽标色（iOS BotBlue） */
function botBlue(dark: boolean): string {
  return dark ? '#A1BFF6' : '#2E6BE6';
}

/** 主 Bot 首字底/字色：与首页 Chief 卡、聊天区同一组 token */
function mainAvatarBg(dark: boolean): string {
  return dark ? '#C8B5E8' : '#6C50A7';
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
  /** 角色弹窗：就地弹出（与首页 Chief 卡同一个组件） */
  @State roleSheetOpen: boolean = false;
  @State roleBotId: string = '';
  /** Bot 背景配色：整页 canvas / 卡片 / 按钮都跟着它走（设置 → Bot 背景配色） */
  @StorageLink('botBgTheme') botBgTheme: string = BOT_BG_DEFAULT;

  private palette(): BotPalette {
    return botPalette(this.botBgTheme);
  }

  /** 主题底色（浅色=调色板基色，深色=调色板深色基色） */
  private canvasColor(): string {
    const palette: BotPalette = this.palette();
    return this.isDark ? palette.baseDark : palette.base;
  }

  /** 主按钮填充：取调色板的 action 色 */
  private actionColor(): string {
    const palette: BotPalette = this.palette();
    return this.isDark ? palette.actionDark : palette.action;
  }

  /** 主题淡色底：徽标、胶囊、头像底这类"浅一层"的填充 */
  private softChipColor(): string {
    const palette: BotPalette = this.palette();
    const rgb: number[] = this.isDark ? palette.fluidToDark : palette.fluidFrom;
    const alpha: number = this.isDark ? 0.28 : 0.22;
    return 'rgba(' + Math.round(rgb[0] * 255) + ',' + Math.round(rgb[1] * 255) + ','
      + Math.round(rgb[2] * 255) + ',' + alpha.toString() + ')';
  }

  private topInset(): number {
    return this.safeTop > 0 ? this.safeTop : 38.9;
  }

  /** 团队成员：主 Bot（Chief）永远排第一，其余保持主机下发顺序 */
  private bots(): BotChat[] {
    const main: BotChat[] = [];
    const others: BotChat[] = [];
    const mainId: string = this.state.mainBotId ?? '';
    for (const chat of this.state.chats) {
      if (chat.room) {
        continue;
      }
      if (chat.id === mainId) {
        main.push(chat);
      } else {
        others.push(chat);
      }
    }
    return main.concat(others);
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

  /**
   * 点行不再进二级页：写入待打开的角色 id 后返回 Bot 首页，
   * 由 BotHomePage 用与 Chief 卡完全相同的底部弹窗呈现（内容一致）。
   */
  /** 点行就地弹出角色弹窗（与 Chief 卡同一个组件，不离开本页） */
  private openBot(chat: BotChat): void {
    BotStore.get().openRole(chat.id);
    this.roleBotId = chat.id;
    AppStorage.setOrCreate<string>('botSheetTargetId', chat.id);
    this.roleSheetOpen = true;
  }

  /** 有主机（DSH 端）下发的头像图 */
  private hasImage(chat: BotChat): boolean {
    const image: string | undefined = chat.image;
    return image !== undefined && image.length > 0;
  }

  private isMain(chat: BotChat): boolean {
    return chat.id === (this.state.mainBotId ?? '');
  }

  private firstChar(chat: BotChat): string {
    return chat.name.length > 0 ? chat.name.substring(0, 1) : 'B';
  }

  private imageOf(chat: BotChat): string {
    const image: string | undefined = chat.image;
    return image === undefined ? '' : image;
  }

  @Builder
  header() {
    Row({ space: 10 }) {
      // 统一用原生玻璃返回钮（与对话页/设置页同一组件，样式一致）
      NavBackButton({ isDark: this.isDark, diameter: 36 })

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
          .fontColor(this.canCreate() ? this.actionColor() : secondary(this.isDark))
        Text('新建 Bot')
          .fontSize(13)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.canCreate() ? this.actionColor() : secondary(this.isDark))
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

  /**
   * 我的 Bot 头像：与首页/聊天区（BotHomePage.botAvatar / letterAvatar / orcaAvatar）同一套规则，
   * 有主机下发图 → 渲染该图；主 Bot 无图 → DSH 虎鲸标记（深色用白色变体）；其余 → 首字。
   * 圆角 = size/3 = 14.67，与列表行同一规格。
   */
  @Builder
  avatar(chat: BotChat) {
    if (this.hasImage(chat)) {
      Stack({ alignContent: Alignment.Center }) {
        Image(this.imageOf(chat))
          .width(44)
          .height(44)
          .objectFit(ImageFit.Cover)
          .draggable(false)
      }
      .width(44)
      .height(44)
      .borderRadius(44 / 3)
      .clip(true)
      .flexShrink(0)
    } else {
      Stack({ alignContent: Alignment.Center }) {
        if (this.isMain(chat)) {
          // 与首页一致：不铺方形底板，鲸鱼图标放大
          Image($r('app.media.dsh_whale'))
            .width(44 * 0.82)
            .height(44 * 0.82)
            .objectFit(ImageFit.Contain)
        } else {
          Text(this.firstChar(chat))
            .fontSize(44 * 0.56)
            .fontWeight(FontWeight.Bold)
            .fontColor(botBlue(this.isDark))
        }
      }
      .width(44)
      .height(44)
      .flexShrink(0)
    }
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
                .fontColor(this.actionColor())
                .padding({ left: 7, right: 7, top: 3, bottom: 3 })
                .borderRadius(6)
                .backgroundColor(this.softChipColor())
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
            .fontColor(this.actionColor())
            .padding({ left: 10, right: 10, top: 6, bottom: 6 })
            .borderRadius(14)
            .backgroundColor(this.softChipColor())
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
          .backgroundColor(this.actionColor())
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
                  // key 带上头像标识：头像异步到位后行要重建
                }, (chat: BotChat) => chat.id + ':' + chat.name + ':' + (chat.hidden ? '1' : '0')
                  + ':' + (chat.imageRef !== undefined ? chat.imageRef : '')
                  + ':' + (chat.image !== undefined ? '1' : '0'))
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
      .backgroundColor(this.canvasColor())
    }
    .hideTitleBar(true)
    .bindSheet($$this.roleSheetOpen, this.roleSheetContent(), {
      height: '92%',
      dragBar: false,
      showClose: false,
      preferType: SheetType.BOTTOM,
      backgroundColor: immersiveSheetSupported() ? Color.Transparent : sheetFallbackColor(this.isDark),
      systemMaterial: sheetSystemMaterial(this.isDark)
    })
  }

  @Builder
  roleSheetContent() {
    BotRoleSheet({
      botId: this.roleBotId,
      onClose: () => {
        this.roleSheetOpen = false;
      }
    })
  }
}
