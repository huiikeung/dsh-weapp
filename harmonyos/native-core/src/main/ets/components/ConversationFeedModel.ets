import { ConversationItem } from '../projection/ConversationProjection';
import type { ConversationFeedEntry } from '../projection/ConversationFeed';
import type { GatewayFileAttachment, GatewayImageAttachment } from '../protocol/GatewayDtos';
import type { PresentedFile } from '../projection/ConversationProjection';

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
  /** 图片附件（用户发送 / 助手回复的 image 块） */
  images: GatewayImageAttachment[] = [];
  /** 文件附件（type='file' 的 content 块） */
  attachments: GatewayFileAttachment[] = [];
  /** 已编辑 / 交付文件卡片 */
  files: PresentedFile[] = [];
  /** CHANGES 行的事件 seq */
  changeSeq: number = 0;
  streaming: boolean = false;
  copyable: boolean = false;
  epochSeconds: number = 0;
  /** 过程组 / 回合行是否展开 */
  expanded: boolean = false;
  items: ConversationItem[] = [];
  imageCount: number = 0;
  /** 本地乐观回显图片 URI */
  localImages: string[] = [];
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
  /** 回合展开时的摘要（N 次工具调用），对齐小程序 turnProcess.expandedSummary */
  expandedSummary: string = '';
  /** 组内活动命名（回合内子组标题） */
  activityTitle: string = '';
  /** 可折叠（失败/中断回合恒展开） */
  foldable: boolean = true;
  /** 上一次写进 items 的内容签名（原地更新的工具行靠它判断要不要重渲染） */
  private itemsSignatureValue: string = '';
  /** 组体内容变更代次：每次 items 被替换就 +1，页面据此让 LazyForEach 重建这一行 */
  itemsRevision: number = 0;

  /**
   * 原地覆盖字段（保持实例 identity）。
   * LazyForEach 按 key 复用组件，@ObjectLink 绑定的是旧实例；
   * 新建实例会让改动丢失，所以同 id 行必须复用同一对象再赋值。
   */
  /** 数组是否「同一个东西」：引用相同，或长度与元素引用都相同（不改就不触发重渲染） */
  /** 文件卡片是否等价（按 path/名称/增删数比较） */
  private static sameFiles(left: PresentedFile[], right: PresentedFile[]): boolean {
    if (left === right) {
      return true;
    }
    if (left === undefined || right === undefined || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      const a: PresentedFile = left[index];
      const b: PresentedFile = right[index];
      if (a.path !== b.path || a.name !== b.name || a.added !== b.added || a.deleted !== b.deleted || a.status !== b.status) {
        return false;
      }
    }
    return true;
  }

  /** 文件附件是否等价（按 attachmentId/name 序列比较） */
  private static sameAttachments(left: GatewayFileAttachment[], right: GatewayFileAttachment[]): boolean {
    if (left === right) {
      return true;
    }
    if (left === undefined || right === undefined || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if (left[index].name !== right[index].name || left[index].attachmentId !== right[index].attachmentId) {
        return false;
      }
    }
    return true;
  }

  /** 图片列表是否等价（按 attachmentId 序列比较，避免每帧重建行） */
  private static sameImages(left: GatewayImageAttachment[], right: GatewayImageAttachment[]): boolean {
    if (left === right) {
      return true;
    }
    if (left === undefined || right === undefined || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index++) {
      if (left[index].attachmentId !== right[index].attachmentId) {
        return false;
      }
    }
    return true;
  }

  private static sameRefs(a: Object[], b: Object[]): boolean {
    if (a === b) {
      return true;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 工具行的内容签名：projector 是原地改 ConversationItem 的（引用不变），
   * 单看引用判断会漏掉流式结果，所以再看一眼 id/状态/正文长度。
   */
  private static itemsSignature(items: ConversationItem[]): string {
    let signature: string = '';
    for (const item of items) {
      signature += item.id + '|' + (item.status === undefined ? '' : item.status) + '|'
        + item.text.length.toString() + '|' + (item.resultText === undefined ? 0 : item.resultText.length).toString()
        + '|' + (item.isError === true ? '1' : '0') + ';';
    }
    return signature;
  }

  assign(entry: ConversationFeedEntry, expanded: boolean): void {
    // 只写真正变了的字段：@Observed 每一次赋值都会让绑定它的行重渲染，
    // 流式期间把上百行全量赋值 = 每秒重建上百个行组件，页面就卡死、点不动了。
    if (this.expanded !== expanded) {
      this.expanded = expanded;
    }
    if (this.kind !== entry.kind) {
      this.kind = entry.kind;
    }
    if (this.title !== entry.title) {
      this.title = entry.title;
    }
    if (this.text !== entry.text) {
      this.text = entry.text;
    }
    if (this.isError !== entry.isError) {
      this.isError = entry.isError;
    }
    if (this.streaming !== entry.streaming) {
      this.streaming = entry.streaming;
    }
    if (this.copyable !== entry.copyable) {
      this.copyable = entry.copyable;
    }
    if (this.epochSeconds !== entry.epochSeconds) {
      this.epochSeconds = entry.epochSeconds;
    }
    if (!ConversationFeedEntryModel.sameRefs(this.items, entry.items)) {
      const itemsSignature: string = ConversationFeedEntryModel.itemsSignature(entry.items);
      if (itemsSignature !== this.itemsSignatureValue) {
        this.items = entry.items;
        this.itemsSignatureValue = itemsSignature;
        // @ObjectLink 对「数组被整体替换」的通知在本机不稳定：
        // 运行中组头标题能刷新、但组体里的新步骤不出来。
        // 记一个代次，页面用 onDataChange 让这一行真正重建。
        this.itemsRevision = this.itemsRevision + 1;
      }
    }
    if (this.imageCount !== entry.imageCount) {
      this.imageCount = entry.imageCount;
    }
    if (!ConversationFeedEntryModel.sameRefs(this.localImages, entry.localImages)) {
      this.localImages = entry.localImages;
    }
    if (!ConversationFeedEntryModel.sameImages(this.images, entry.images)) {
      this.images = entry.images;
    }
    if (!ConversationFeedEntryModel.sameAttachments(this.attachments, entry.attachments)) {
      this.attachments = entry.attachments;
    }
    if (!ConversationFeedEntryModel.sameFiles(this.files, entry.files)) {
      this.files = entry.files;
    }
    if (this.changeSeq !== entry.changeSeq) {
      this.changeSeq = entry.changeSeq;
    }
    if (this.running !== entry.running) {
      this.running = entry.running;
    }
    if (this.expandable !== entry.expandable) {
      this.expandable = entry.expandable;
    }
    if (this.summary !== entry.summary) {
      this.summary = entry.summary;
    }
    if (this.toolCount !== entry.toolCount) {
      this.toolCount = entry.toolCount;
    }
    if (this.contextCount !== entry.contextCount) {
      this.contextCount = entry.contextCount;
    }
    if (!ConversationFeedEntryModel.sameRefs(this.childIds, entry.childIds)) {
      this.childIds = entry.childIds;
    }
    if (this.activityKind !== entry.activityKind) {
      this.activityKind = entry.activityKind;
    }
    if (this.liveDetail !== entry.liveDetail) {
      this.liveDetail = entry.liveDetail;
    }
    if (this.narration !== entry.narration) {
      this.narration = entry.narration;
    }
    if (this.footerVisible !== entry.footerVisible) {
      this.footerVisible = entry.footerVisible;
    }
    if (this.turnMetaText !== entry.turnMetaText) {
      this.turnMetaText = entry.turnMetaText;
    }
    if (this.turnTimeText !== entry.turnTimeText) {
      this.turnTimeText = entry.turnTimeText;
    }
    if (this.failureTitle !== entry.failureTitle) {
      this.failureTitle = entry.failureTitle;
    }
    if (this.processGrouped !== entry.processGrouped) {
      this.processGrouped = entry.processGrouped;
    }
    if (this.processAutoOpen !== entry.processAutoOpen) {
      this.processAutoOpen = entry.processAutoOpen;
    }
    if (this.processBodyVisible !== entry.processBodyVisible) {
      this.processBodyVisible = entry.processBodyVisible;
    }
    if (this.processBodyCapped !== entry.processBodyCapped) {
      this.processBodyCapped = entry.processBodyCapped;
    }
    if (this.headingHidden !== entry.headingHidden) {
      this.headingHidden = entry.headingHidden;
    }
    if (this.titleWrap !== entry.titleWrap) {
      this.titleWrap = entry.titleWrap;
    }
    if (this.turnClosed !== entry.turnClosed) {
      this.turnClosed = entry.turnClosed;
    }
    if (this.expandedSummary !== entry.expandedSummary) {
      this.expandedSummary = entry.expandedSummary;
    }
    if (this.activityTitle !== entry.activityTitle) {
      this.activityTitle = entry.activityTitle;
    }
    if (this.foldable !== entry.foldable) {
      this.foldable = entry.foldable;
    }
    if (this.id === entry.id) {
      this.assignChildren(entry);
    } else {
      this.id = entry.id;
      this.assignChildren(entry);
    }
  }

  /** 子行（回合内的过程组）能复用就复用，只把变化写进去，避免整棵子树重建 */
  private assignChildren(entry: ConversationFeedEntry): void {
    let same: boolean = this.children.length === entry.children.length;
    if (same) {
      for (let i = 0; i < this.children.length; i++) {
        if (this.children[i].id !== entry.children[i].id) {
          same = false;
          break;
        }
      }
    }
    if (!same) {
      const kids: ConversationFeedEntryModel[] = [];
      for (const child of entry.children) {
        kids.push(ConversationFeedEntryModel.from(child));
      }
      this.children = kids;
      return;
    }
    for (let i = 0; i < this.children.length; i++) {
      this.children[i].assign(entry.children[i], entry.children[i].expanded);
    }
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
    next.expandedSummary = entry.expandedSummary;
    next.activityTitle = entry.activityTitle;
    next.foldable = entry.foldable;
    for (const child of entry.children) {
      next.children.push(ConversationFeedEntryModel.from(child));
    }
    return next;
  }
}
