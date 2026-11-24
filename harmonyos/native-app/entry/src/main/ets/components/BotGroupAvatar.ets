/**
 * Bot 群聊拼贴头像 + 成员气泡色板（对齐 docs/bot-mode-ios-spec.md §8.6 / §8.7）。
 *
 * §8.6 BotAvatar / BotFace / BotGroupAvatar：
 * - 群聊头像 = memberIds 对应的成员拼贴；1 人回落单头像；2–4 人按席位布局；
 *   >4 人固定 4 席、第 4 席显示「+{N}」（字号 side×0.36 semibold）；
 * - 每席 BotLavenderSoft 底、圆形裁切、1px 描边（浅色白 / 深色 BotLine）；
 * - 整体圆角 = size/3（BotFace 统一规则）；无成员时回落群聊首字。
 * 席位归一化几何与 iOS/Android 共享层 BotAvatarLayout 完全一致（非简化的左右各半）。
 *
 * §8.7 BotBubblePalette：
 * - 候选成员 = 所有非群聊且非主 Bot 的 chat.id，去重后按 id 排序，索引 mod 5 取色；
 * - 主 Bot 固定色；未知 botId 用兜底色；
 * - 颜色只依赖 id 排序与主 Bot id，不依赖名册顺序，故同一成员在私聊/群聊颜色一致。
 */
import { BotChat } from 'nativecore';

/** 席位布局（归一化：x/y/side 均为头像边长的比例，与共享层 BotAvatarLayout 对齐） */
export interface BotAvatarSeat {
  x: number;
  y: number;
  side: number;
}

/**
 * 群头像席位：0/1 人无拼贴；2 人对角 2/3 席位；3 人上 1（居中）下 2，各 5/9；
 * 4 人及以上 2×2，各 1/2。与 Kotlin BotAvatarLayout.seats 逐值一致。
 */
export function botAvatarSeats(count: number): BotAvatarSeat[] {
  if (count <= 1) {
    return [];
  }
  if (count === 2) {
    const two: BotAvatarSeat[] = [
      { x: 0, y: 0, side: 2 / 3 },
      { x: 1 / 3, y: 1 / 3, side: 2 / 3 }
    ];
    return two;
  }
  if (count === 3) {
    const three: BotAvatarSeat[] = [
      { x: 2 / 9, y: 0, side: 5 / 9 },
      { x: 0, y: 4 / 9, side: 5 / 9 },
      { x: 4 / 9, y: 4 / 9, side: 5 / 9 }
    ];
    return three;
  }
  const four: BotAvatarSeat[] = [
    { x: 0, y: 0, side: 0.5 },
    { x: 0.5, y: 0, side: 0.5 },
    { x: 0, y: 0.5, side: 0.5 },
    { x: 0.5, y: 0.5, side: 0.5 }
  ];
  return four;
}

// ==================== §8.1 Bot 主题 token（与本页既有色值一致，不新建主题体系） ====================

const BOT_LAVENDER_SOFT_LIGHT: string = '#ECE7F7';
const BOT_LAVENDER_SOFT_DARK: string = '#333044';
const BOT_LINE_DARK: string = '#484354';
const BOT_RING_LIGHT: string = '#FFFFFF';
const BOT_BLUE_LIGHT: string = '#2E6BE6';
const BOT_BLUE_DARK: string = '#A1BFF6';
const BOT_INK_LIGHT: string = '#252332';
const BOT_INK_DARK: string = '#F2EEF6';

/** §8.7 成员色板：浅色 5 色（BotBubblePalette.MEMBER_COLORS） */
const MEMBER_COLORS_LIGHT: string[] = ['#E7EFE7', '#F3E7EA', '#F3ECDF', '#E4ECEF', '#F2E7E1'];
/** §8.7 成员色板：深色 5 色（BotBubblePalette.NIGHT_MEMBER_COLORS） */
const MEMBER_COLORS_DARK: string[] = ['#2C3D34', '#402F3A', '#40382E', '#2A3A43', '#42322F'];
/** 主 Bot 固定色 */
const MAIN_COLOR_LIGHT: string = '#F3EFF6';
const MAIN_COLOR_DARK: string = '#352D3D';
/** 未知 botId 兜底色 */
const FALLBACK_COLOR_LIGHT: string = '#F0EFED';
const FALLBACK_COLOR_DARK: string = '#302E35';

/**
 * §8.7 气泡色板。构造时按「非群聊且非主 Bot 的 chat.id → 去重 → 按 id 排序 → mod 5」
 * 建立稳定索引；颜色与名册顺序、首次出现顺序无关。
 */
export class BotBubblePalette {
  private indices: Map<string, number> = new Map<string, number>();
  private mainBotId: string = '';

  constructor(chats: BotChat[], mainBotId: string) {
    this.mainBotId = mainBotId;
    const ids: string[] = [];
    for (const chat of chats) {
      if (chat.room || chat.id === mainBotId) {
        continue;
      }
      if (ids.indexOf(chat.id) >= 0) {
        continue;
      }
      ids.push(chat.id);
    }
    ids.sort();
    for (let index = 0; index < ids.length; index++) {
      this.indices.set(ids[index], index % MEMBER_COLORS_LIGHT.length);
    }
  }

  /** 成员底色；主 Bot / 未知 id / 空 id 分别取固定色与兜底色。 */
  rgb(botId: string | undefined, isDark: boolean): string {
    if (botId !== undefined && botId.length > 0 && botId === this.mainBotId) {
      return isDark ? MAIN_COLOR_DARK : MAIN_COLOR_LIGHT;
    }
    if (botId === undefined || botId.length === 0) {
      return isDark ? FALLBACK_COLOR_DARK : FALLBACK_COLOR_LIGHT;
    }
    const index: number | undefined = this.indices.get(botId);
    if (index === undefined) {
      return isDark ? FALLBACK_COLOR_DARK : FALLBACK_COLOR_LIGHT;
    }
    const colors: string[] = isDark ? MEMBER_COLORS_DARK : MEMBER_COLORS_LIGHT;
    return colors[index];
  }
}

/** 拼贴里的一格：只带基础类型，避免 @Builder 传复杂对象。 */
interface BotAvatarCell {
  key: string;
  x: number;
  y: number;
  side: number;
  image: string;
  letter: string;
  more: boolean;
  moreText: string;
}

/**
 * 群聊拼贴头像。
 *
 * 用法（首页/聊天页）：
 *   BotGroupAvatar({ chatId: chat.id, chats: this.state.chats,
 *                    mainBotId: this.state.mainBotId ?? '', faceSize: 44, isDark: this.isDark })
 *
 * 成员 = chat.memberIds 在 chats 中解析出的非群聊成员，并排除主 Bot 自己（与 §8.7 候选口径一致）。
 */
@Component
export struct BotGroupAvatar {
  /** 群聊 chat.id */
  @Prop chatId: string = '';
  /** 全量名册（含私聊与群聊） */
  @Prop chats: BotChat[] = [];
  /** 主 Bot id（拼贴时排除主 Bot 自己） */
  @Prop mainBotId: string = '';
  @Prop faceSize: number = 44;
  @Prop isDark: boolean = false;

  @State failedKeys: string[] = [];
  @State failedFallbackKey: string = '';

  private groupChat(): BotChat | null {
    for (const chat of this.chats) {
      if (chat.id === this.chatId) {
        return chat;
      }
    }
    return null;
  }

  private containsMember(list: BotChat[], id: string): boolean {
    for (const member of list) {
      if (member.id === id) {
        return true;
      }
    }
    return false;
  }

  /** 成员 = memberIds 对应名册项（排除群聊项与主 Bot），按 memberIds 顺序去重。 */
  private members(): BotChat[] {
    const chat: BotChat | null = this.groupChat();
    if (chat === null) {
      return [];
    }
    const out: BotChat[] = [];
    for (const id of chat.memberIds) {
      if (id.length === 0 || id === this.mainBotId) {
        continue;
      }
      for (const candidate of this.chats) {
        if (candidate.id === id && !candidate.room && !this.containsMember(out, candidate.id)) {
          out.push(candidate);
          break;
        }
      }
    }
    return out;
  }

  private letterOf(chat: BotChat): string {
    return chat.name.length > 0 ? chat.name.substring(0, 1) : 'B';
  }

  private ringColor(): string {
    return this.isDark ? BOT_LINE_DARK : BOT_RING_LIGHT;
  }

  private softColor(): string {
    return this.isDark ? BOT_LAVENDER_SOFT_DARK : BOT_LAVENDER_SOFT_LIGHT;
  }

  private letterColor(): string {
    return this.isDark ? BOT_BLUE_DARK : BOT_BLUE_LIGHT;
  }

  private moreColor(): string {
    return this.isDark ? BOT_INK_DARK : BOT_INK_LIGHT;
  }

  private markFailed(key: string): void {
    if (this.failedKeys.indexOf(key) >= 0) {
      return;
    }
    const next: string[] = this.failedKeys.slice();
    next.push(key);
    this.failedKeys = next;
  }

  private cells(): BotAvatarCell[] {
    const list: BotChat[] = this.members();
    const seats: BotAvatarSeat[] = botAvatarSeats(list.length);
    const out: BotAvatarCell[] = [];
    const more: boolean = list.length > 4;
    for (let index = 0; index < seats.length; index++) {
      const seat: BotAvatarSeat = seats[index];
      const x: number = this.faceSize * seat.x;
      const y: number = this.faceSize * seat.y;
      const side: number = this.faceSize * seat.side;
      if (index === 3 && more) {
        out.push({
          key: this.chatId + ':more',
          x: x, y: y, side: side,
          image: '', letter: '', more: true,
          moreText: '+' + (list.length - 3).toString()
        });
        continue;
      }
      if (index >= list.length) {
        continue;
      }
      const member: BotChat = list[index];
      out.push({
        key: this.chatId + ':' + index.toString() + ':' + member.id,
        x: x, y: y, side: side,
        image: member.image !== undefined ? member.image : '',
        letter: this.letterOf(member),
        more: false,
        moreText: ''
      });
    }
    return out;
  }

  /** 1 人 / 无成员时的单席位（§8.6：1 人 → 单头像；无成员 → 群聊首字占位）。 */
  private singleChat(): BotChat | null {
    const list: BotChat[] = this.members();
    if (list.length === 1) {
      return list[0];
    }
    return this.groupChat();
  }

  private fallbackImage(): string {
    const chat: BotChat | null = this.singleChat();
    if (chat === null) {
      return '';
    }
    return chat.image !== undefined ? chat.image : '';
  }

  private fallbackLetter(): string {
    const chat: BotChat | null = this.singleChat();
    if (chat === null) {
      return 'B';
    }
    return this.letterOf(chat);
  }

  private fallbackKey(): string {
    return this.chatId + ':single:' + this.fallbackImage();
  }

  @Builder
  fallbackFace() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.fallbackImage().length > 0 && this.failedFallbackKey !== this.fallbackKey()) {
        Image(this.fallbackImage())
          .width(this.faceSize)
          .height(this.faceSize)
          .objectFit(ImageFit.Cover)
          .onError(() => {
            this.failedFallbackKey = this.fallbackKey();
          })
      } else {
        Text(this.fallbackLetter())
          .fontSize(this.faceSize * 0.42)
          .fontWeight(600)
          .fontColor(this.letterColor())
      }
    }
    .width(this.faceSize)
    .height(this.faceSize)
    .borderRadius(this.faceSize / 3)
    .backgroundColor(this.softColor())
    .clip(true)
    .flexShrink(0)
  }

  build() {
    Stack({ alignContent: Alignment.TopStart }) {
      if (this.cells().length === 0) {
        this.fallbackFace()
      } else {
        ForEach(this.cells(), (cell: BotAvatarCell) => {
          Stack({ alignContent: Alignment.Center }) {
            if (cell.more) {
              Text(cell.moreText)
                .fontSize(cell.side * 0.36)
                .fontWeight(600)
                .fontColor(this.moreColor())
            } else if (cell.image.length > 0 && this.failedKeys.indexOf(cell.key) < 0) {
              Image(cell.image)
                .width(cell.side)
                .height(cell.side)
                .objectFit(ImageFit.Cover)
                .onError(() => {
                  this.markFailed(cell.key);
                })
            } else {
              Text(cell.letter)
                .fontSize(cell.side * 0.42)
                .fontWeight(600)
                .fontColor(this.letterColor())
            }
          }
          .width(cell.side)
          .height(cell.side)
          .borderRadius(cell.side / 2)
          .backgroundColor(this.softColor())
          .border({ width: 1, color: this.ringColor() })
          .clip(true)
          .offset({ x: cell.x, y: cell.y })
        }, (cell: BotAvatarCell) => cell.key)
      }
    }
    .width(this.faceSize)
    .height(this.faceSize)
    // §8.6：BotFace 统一 faceSize/3；拼贴内部各席为圆形，外层只作为裁剪基座
    .borderRadius(this.faceSize / 3)
    .flexShrink(0)
  }
}
