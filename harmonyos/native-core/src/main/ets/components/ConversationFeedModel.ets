import { ConversationItem } from '../projection/ConversationProjection';
import type { ConversationFeedEntry } from '../projection/ConversationFeed';

/**
 * 会话时间线的一行（UI 模型）。
 * 由 native-core 的 ConversationFeed 构建；页面持有并通过 LazyForEach 渲染。
 * 使用 @Observed，让流式文本的原地更新能驱动对应行刷新而不重建列表。
 */
/**
 * 模型菜单的一行（供 ArkUI 系统 Menu 的 ForEach 使用）。
 * isHeader=true 时是提供商分组标题（不可点）；否则是可点的模型/等级条目。
 */
export interface ModelMenuItem {
  key: string;
  label: string;
  isHeader: boolean;
  current: boolean;
  provider: string;
  model: string;
  /** 非空表示这是推理等级条目 */
  effortValue: string;
}

@Observed
export class ConversationFeedEntryModel {
  id: string = '';
  /** USER | ASSISTANT | PROCESS | TURN | STATUS | SYSTEM */
  kind: string = '';
  title: string = '';
  text: string = '';
  isError: boolean = false;
  streaming: boolean = false;
  copyable: boolean = false;
  epochSeconds: number = 0;
  /** 过程组 / 回合行是否展开 */
  expanded: boolean = false;
  items: ConversationItem[] = [];
  imageCount: number = 0;
  /** 过程组：运行中 */
  running: boolean = false;
  /** 可展开（有子内容） */
  expandable: boolean = false;
  /** 摘要：用时 X · N 次工具调用 · N 项上下文 */
  summary: string = '';
  toolCount: number = 0;
  contextCount: number = 0;
  /** 回合行收拢的过程组 id */
  childIds: string[] = [];
  /** 回合行收拢的过程组（展开时逐组显示） */
  children: ConversationFeedEntryModel[] = [];
  /** 活动分类：决定过程组图标 */
  activityKind: string = 'tools';
  /** 运行中细节（路径/命令） */
  liveDetail: string = '';
  /** 过程内叙述文字 */
  narration: boolean = false;
  /** 回合页脚 */
  footerVisible: boolean = false;
  turnMetaText: string = '';
  turnTimeText: string = '';
  failureTitle: string = '';
  // ===== 工作步骤展示策略（由 ConversationFeed.applyWorkStepPolicy 算出）=====
  processGrouped: boolean = false;
  processAutoOpen: boolean = false;
  processBodyVisible: boolean = false;
  processBodyCapped: boolean = false;
  headingHidden: boolean = false;
  titleWrap: boolean = false;
  turnClosed: boolean = false;

  /**
   * 原地覆盖字段（保持实例 identity）。
   * LazyForEach 按 key 复用组件，@ObjectLink 绑定的是旧实例；
   * 新建实例会让改动丢失，所以同 id 行必须复用同一对象再赋值。
   */
  assign(entry: ConversationFeedEntry, expanded: boolean): void {
    this.id = entry.id;
    this.kind = entry.kind;
    this.title = entry.title;
    this.text = entry.text;
    this.isError = entry.isError;
    this.streaming = entry.streaming;
    this.copyable = entry.copyable;
    this.epochSeconds = entry.epochSeconds;
    this.expanded = expanded;
    this.items = entry.items;
    this.imageCount = entry.imageCount;
    this.running = entry.running;
    this.expandable = entry.expandable;
    this.summary = entry.summary;
    this.toolCount = entry.toolCount;
    this.contextCount = entry.contextCount;
    this.childIds = entry.childIds;
    this.activityKind = entry.activityKind;
    this.liveDetail = entry.liveDetail;
    this.narration = entry.narration;
    this.footerVisible = entry.footerVisible;
    this.turnMetaText = entry.turnMetaText;
    this.turnTimeText = entry.turnTimeText;
    this.failureTitle = entry.failureTitle;
    this.processGrouped = entry.processGrouped;
    this.processAutoOpen = entry.processAutoOpen;
    this.processBodyVisible = entry.processBodyVisible;
    this.processBodyCapped = entry.processBodyCapped;
    this.headingHidden = entry.headingHidden;
    this.titleWrap = entry.titleWrap;
    this.turnClosed = entry.turnClosed;
    const kids: ConversationFeedEntryModel[] = [];
    for (const child of entry.children) {
      kids.push(ConversationFeedEntryModel.from(child));
    }
    this.children = kids;
  }

  static from(entry: ConversationFeedEntry): ConversationFeedEntryModel {
    const next: ConversationFeedEntryModel = new ConversationFeedEntryModel();
    next.id = entry.id;
    next.kind = entry.kind;
    next.title = entry.title;
    next.text = entry.text;
    next.isError = entry.isError;
    next.streaming = entry.streaming;
    next.copyable = entry.copyable;
    next.epochSeconds = entry.epochSeconds;
    next.expanded = entry.expanded;
    next.items = entry.items;
    next.imageCount = entry.imageCount;
    next.running = entry.running;
    next.expandable = entry.expandable;
    next.summary = entry.summary;
    next.toolCount = entry.toolCount;
    next.contextCount = entry.contextCount;
    next.childIds = entry.childIds;
    next.activityKind = entry.activityKind;
    next.liveDetail = entry.liveDetail;
    next.narration = entry.narration;
    next.footerVisible = entry.footerVisible;
    next.turnMetaText = entry.turnMetaText;
    next.turnTimeText = entry.turnTimeText;
    next.failureTitle = entry.failureTitle;
    next.processGrouped = entry.processGrouped;
    next.processAutoOpen = entry.processAutoOpen;
    next.processBodyVisible = entry.processBodyVisible;
    next.processBodyCapped = entry.processBodyCapped;
    next.headingHidden = entry.headingHidden;
    next.titleWrap = entry.titleWrap;
    next.turnClosed = entry.turnClosed;
    for (const child of entry.children) {
      next.children.push(ConversationFeedEntryModel.from(child));
    }
    return next;
  }
}
