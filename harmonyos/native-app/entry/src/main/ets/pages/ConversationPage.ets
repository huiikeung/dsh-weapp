import { common } from '@kit.AbilityKit';
import { pasteboard } from '@kit.BasicServicesKit';
import { KeyboardAvoidMode, window } from '@kit.ArkUI';
import {
  asRec, ConversationFeed, ConversationFeedEntry, ConversationFeedEntryModel, ConversationItem, GatewayClient, GatewayRequestFactory, num,
  PickedAttachment, PreferencesStore, SessionStore, SessionSummary, WorkStepPresentation, pickDocuments, uploadAttachment
} from 'nativecore';
import type { ModelMenuItem, ModelOption } from 'nativecore';
import type { UploadResult } from 'nativecore';
import { ConversationRowView } from '../components/ConversationRowView';
import { ConversationComposer, MetricMenuPair } from '../components/ConversationComposer';
import { NavBackButton } from '../components/NavBackButton';
import { ConversationProgress } from '../components/ConversationProgress';

interface UploadReceipt {
  receiptId: string;
}

/** 指标弹层的一行（label / value），预生成后交给 ForEach。 */
interface MetricPair {
  key: string;
  label: string;
  value: string;
}

/** 权限选项行（对齐小程序 permissionSheet） */
interface PermissionRow {
  value: string;
  label: string;
  icon: string;
  current: boolean;
}

/** 模型选项行 */
interface ModelRow {
  key: string;
  provider: string;
  model: string;
  label: string;
  current: boolean;
}

/** 推理等级行 */
interface EffortRow {
  id: string;
  label: string;
  current: boolean;
}

/**
 * 时间线数据源：只负责行集合；同 ID 行的正文更新由 @Observed 行模型驱动。
 */
class FeedDataSource implements IDataSource {
  private rows: ConversationFeedEntryModel[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.rows.length;
  }

  getData(index: number): ConversationFeedEntryModel {
    return this.rows[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const index: number = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * 全量重载：行模型是 @Observed 实例，同 ID 行的正文更新由 LazyForEach 复用原有组件驱动；
   * 这里只负责通知结构变化。
   * 注意：不要改用手工 DataOperation 增量，ArkUI 的增量替换 + @ObjectLink 组合在本机会崩（SIGSEGV）。
   */
  update(rows: ConversationFeedEntryModel[]): void {
    this.rows = rows;
    for (const listener of this.listeners) {
      listener.onDataReloaded();
    }
  }
}

/**
 * 会话页（对话视图）：对齐 dsh-mobile iOS 端 ConversationView。
 *
 * 结构（自上而下）：
 *   顶栏（返回 / 标题 + 连接状态 / 更多）
 *   加载更早记录
 *   时间线（分组行 + 吸底跟随）
 *   运行中指示器（仅生成中）
 *   输入条（玻璃卡片）
 */
interface ModelSheetRow {
  key: string;
  label: string;
  badge: string;
  provider: string;
  model: string;
  current: boolean;
}

interface ModelSheetGroup {
  name: string;
  rows: ModelSheetRow[];
}

@Component
export struct ConversationPage {
  @Consume('pageStack') pageStack: NavPathStack;
  @StorageLink('isDark') isDark: boolean = false;
  @StorageLink('connectionState') connection: string = 'disconnected';
  @StorageLink('sessions') sessions: SessionSummary[] = [];
  @StorageLink('conversationItems') @Watch('onItemsChanged') items: ConversationItem[] = [];
  @StorageLink('conversationRunning') @Watch('onRunningChanged') running: boolean = false;
  @StorageLink('historyHasMore') hasMoreHistory: boolean = false;
  @StorageLink('defaultPermission') defaultPermission: string = '';
  @StorageLink('defaultModel') defaultModel: string = '';
  @StorageLink('defaultEffort') defaultEffort: string = '';
  @StorageLink('contextUsage') contextUsage: Object | null = null;
  @StorageLink('contextDashboard') dashboard: Object | null = null;

  @State entries: ConversationFeedEntryModel[] = [];
  @State draft: string = '';
  @State hint: string = '';
  @State autoStick: boolean = true;
  @State sending: boolean = false;
  @State pickedAttachments: PickedAttachment[] = [];
  @State attachmentHint: string = '';
  @State expandedIds: string[] = [];
  @State progressLabel: string = '';
  /** 工作步骤展示档位与收起时机（对齐 DSH 客户端 presentation policy） */
  /** 工作步骤展示档位/收起时机：响应式绑定，设置页改完立刻重排 */
  @StorageProp('workStepMode') @Watch('onWorkStepPrefsChanged') workStepMode: string = 'detailed';
  @StorageProp('workStepTiming') @Watch('onWorkStepPrefsChanged') workStepTiming: string = 'completion';
  @StorageLink('statusAppearance') statusAppearance: string = 'classic';

  /** 输入条是否聚焦（决定折叠/展开两态） */
  @State composerFocused: boolean = false;
  /** 输入法高度（vp，EntryAbility 写入 AppStorage）：归零即键盘收起 → 输入条塌回单栏 */
  @StorageLink('keyboardHeightVp') @Watch('onKeyboardChanged') keyboardHeightVp: number = 0;
  /** 指标弹层：'' | run | token | context */
  @State metricPopover: string = '';
  /** 输入条 chip 弹层：'' | model（权限改用系统菜单） */
  @State composerSheet: string = '';
  /** 权限菜单展开态（仅用于 ▾ 旋转与底色） */
  @State permissionMenuOpen: boolean = false;
  /** 模型弹窗展开态 */
  @State modelMenuOpen: boolean = false;
  /** 目录回传的当前模型 / provider / 推理等级 */
  @StorageLink('selectedModel') selectedModel: string = '';
  @StorageLink('selectedProvider') selectedProvider: string = '';
  @StorageLink('selectedEffort') selectedEffort: string = '';
  @State permissionRows: PermissionRow[] = [];
  @State modelRows: ModelRow[] = [];
  @State effortRows: EffortRow[] = [];
  @StorageLink('permissionValues') permissionValues: string[] = [];
  @StorageLink('modelDetails') modelOptions: ModelOption[] = [];
  @State metricTitle: string = '';
  @State metricPairs: MetricPair[] = [];
@State metricTotal: string = '';
  /** 系统状态栏高度（vp）：EntryAbility 建窗时写入 AppStorage，页面据此避让。 */
  @StorageLink('safeTopVp') topInset: number = 0;
  /** 执行图标样式（设置页「执行图标」） */
  @StorageLink('procIconStyle') procIconStyle: string = 'spin-ring';
  /** 系统手势条高度（vp）：输入条据此抬升。 */
  @StorageLink('safeBottomVp') bottomInset: number = 0;

  private scroller: Scroller = new Scroller();
  private source: FeedDataSource = new FeedDataSource();
  private progressTimer: number = -1;
  private lastTailKey: string = '';
  private ready: boolean = false;

  // ==================== 生命周期 ====================
  aboutToAppear(): void {
    // 其他页面（首页/设置）把全局键盘避让设成了 NONE，进对话页必须恢复：
    // RESIZE = 键盘弹出时根布局收缩，输入条整体上浮到输入法上方（标题栏不动）
    this.getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
    // 状态栏内容色跟随页面背景：深色纯黑 → 白，浅色灰底 → 黑
    this.applyStatusBarColor();
    this.syncWorkStepPrefs();
    this.ready = true;
    this.rebuildEntries();
    this.refreshProgress();
    this.progressTimer = setInterval(() => {
      this.refreshProgress();
    }, 1000);
  }

  /** 运行中标题最短展示：id → 已展示标题与时间戳（对齐客户端防抖） */
  private titleHold: Map<string, string> = new Map<string, string>();
  private titleHoldAt: Map<string, number> = new Map<string, number>();

  /** 读取工作步骤展示偏好（对齐 DSH 客户端 presentation policy） */
  private syncWorkStepPrefs(): void {
    const mode: string = WorkStepPresentation.normalizeMode(
      PreferencesStore.get().getString(WorkStepPresentation.MODE_KEY, 'detailed'));
    const timing: string = WorkStepPresentation.normalizeTiming(
      PreferencesStore.get().getString(WorkStepPresentation.TIMING_KEY, 'completion'));
    AppStorage.setOrCreate<string>('workStepMode', mode);
    AppStorage.setOrCreate<string>('workStepTiming', timing);
    this.workStepMode = mode;
    this.workStepTiming = timing;
  }

  /** 设置页切换档位/时机后立即重排（四档才能即时生效） */
  private onWorkStepPrefsChanged(): void {
    if (this.ready) {
      this.rebuildEntries();
    }
  }

  aboutToDisappear(): void {
    this.ready = false;
    if (this.progressTimer >= 0) {
      clearInterval(this.progressTimer);
      this.progressTimer = -1;
    }
  }

  /** 输入法收起（高度归零）时塌回：无草稿无附件回单栏，有草稿保持展开卡片（对齐小程序 onKeyboardHide） */
  private onKeyboardChanged(propName: string): void {
    if (propName !== 'keyboardHeightVp' || this.keyboardHeightVp > 0 || !this.composerFocused) {
      return;
    }
    // 输入条弹层（权限/模型选择）开着时不塌回：塌回会连带卸载 chip 行，弹窗跟着消失
    if (this.composerSheet.length > 0) {
      return;
    }
    this.composerFocused = false;
  }

  // ==================== 输入条指标（对齐小程序 composer-metrics） ====================
  /** 占位符：未聚焦且空草稿时显示「描述你想要构建的内容」，聚焦后显示输入提示。 */
  private composerPlaceholder(): string {
    return '描述你想要构建的内容';
  }

  /** 权限胶囊图标字符（对齐小程序 permissionIcon）。 */
  private permissionIconGlyph(): string {
    if (this.defaultPermission === 'read-only') {
      return '◐';
    }
    if (this.defaultPermission === 'workspace-write') {
      return '✎';
    }
    if (this.defaultPermission === 'danger-full-access') {
      return '⚠';
    }
    return '⛨';
  }

  /** 模型徽章（会话内模型选择器未接入时为空）。 */
  private modelBadge(): string {
    return '';
  }

  /** 推理等级文案（low/medium/high → 低/中/高）。 */
  private effortLabel(): string {
    const effort: string = this.defaultEffort;
    if (effort === 'low') {
      return '低';
    }
    if (effort === 'medium') {
      return '中';
    }
    if (effort === 'high') {
      return '高';
    }
    return '';
  }

  /** 运行指标：「N 轮 M 步」（对齐小程序 composerRunMetric）。 */
  private runMetric(): string {
    const turns: number = this.sessionTurnCount();
    const steps: number = this.sessionStepCount();
    const turnText: string = turns >= 0 ? turns.toString() : '—';
    const stepText: string = steps >= 0 ? steps.toString() : '—';
    return turnText + ' 轮 ' + stepText + ' 步';
  }

  /** token 指标：「12.3K tok · 45%」（对齐小程序 composerTokenMetric）。 */
  private tokenMetric(): string {
    const total: number = this.sessionTokenTotal();
    if (total < 0) {
      return '— tok';
    }
    let compact: string = total.toString();
    if (total >= 1000000) {
      compact = (total / 1000000).toFixed(total % 1000000 === 0 ? 0 : 1) + 'M';
    } else if (total >= 1000) {
      compact = (total / 1000).toFixed(1) + 'K';
    }
    const hit: number = this.sessionCacheHitPercent();
    return hit >= 0 ? compact + ' tok · ' + hit.toString() + '%' : compact + ' tok';
  }

  /** 上下文指标：「37%」。 */
  private contextMetric(): string {
    const percent: number = this.contextPercent();
    return percent >= 0 ? percent.toString() + '%' : '—%';
  }

  /** 上下文占用百分比（已用 / 窗口，来自 pressureRecord 的候选）。 */
  private contextPercent(): number {
    const used: number = this.contextUsedTokens();
    const window: number = this.contextWindowTokens();
    if (used < 0 || window <= 0) {
      return -1;
    }
    const percent: number = Math.round((used * 100) / window);
    return Math.max(0, Math.min(100, percent));
  }

  private sessionTurnCount(): number {
    if (this.dashboard === null) {
      return -1;
    }
    const record = asRec(this.dashboard);
    if (record === undefined) {
      return -1;
    }
    const stats = asRec(record['stats']);
    if (stats === undefined) {
      return -1;
    }
    const turns: number = num(stats, 'turns') ?? -1;
    return turns >= 0 ? turns : -1;
  }

  private sessionStepCount(): number {
    if (this.dashboard === null) {
      return -1;
    }
    const record = asRec(this.dashboard);
    if (record === undefined) {
      return -1;
    }
    const stats = asRec(record['stats']);
    if (stats === undefined) {
      return -1;
    }
    const steps: number = num(stats, 'steps') ?? -1;
    return steps >= 0 ? steps : -1;
  }

  /** 会话 token 总量：计费输入（未缓存 + 缓存读 + 缓存写）+ 输出。 */
  private sessionTokenTotal(): number {
    const tokens = asRec(this.tokenUsageRecord());
    if (tokens === undefined) {
      return -1;
    }
    const totals = asRec(tokens['totals']);
    const uncached: number = this.tokenBucket(tokens, totals, 'uncachedInputTokens');
    const cacheRead: number = this.tokenBucket(tokens, totals, 'cacheReadTokens');
    const cacheWrite: number = this.tokenBucket(tokens, totals, 'cacheWriteTokens');
    const input: number = this.tokenBucket(tokens, totals, 'inputTokens');
    const output: number = this.tokenBucket(tokens, totals, 'outputTokens');
    let billed: number = input;
    if (uncached >= 0 && cacheRead >= 0 && cacheWrite >= 0) {
      billed = uncached + cacheRead + cacheWrite;
    }
    if (billed < 0 || output < 0) {
      return -1;
    }
    return billed + output;
  }

  /** 缓存命中率（cacheRead / 计费输入）。 */
  private sessionCacheHitPercent(): number {
    const tokens = asRec(this.tokenUsageRecord());
    if (tokens === undefined) {
      return -1;
    }
    const totals = asRec(tokens['totals']);
    const cacheRead: number = this.tokenBucket(tokens, totals, 'cacheReadTokens');
    const uncached: number = this.tokenBucket(tokens, totals, 'uncachedInputTokens');
    const cacheWrite: number = this.tokenBucket(tokens, totals, 'cacheWriteTokens');
    const input: number = this.tokenBucket(tokens, totals, 'inputTokens');
    let billed: number = input;
    if (uncached >= 0 && cacheRead >= 0 && cacheWrite >= 0) {
      billed = uncached + cacheRead + cacheWrite;
    }
    if (cacheRead < 0 || billed <= 0) {
      return -1;
    }
    return Math.round((cacheRead * 100) / billed);
  }

  // ==================== 投影 ====================
  /** 把 native-core 的对话条目折叠成显示行，并保留展开状态。 */
  private rebuildEntries(): void {
    const source: ConversationItem[] = this.items === undefined ? [] : this.items;
    const built: ConversationFeedEntryModel[] = [];
    const rows: ConversationFeedEntry[] = ConversationFeed.build(source, this.running && this.connection === 'connected');
    // 任何时候都要算策略：运行中也要决定组体是否可见 / 限高 / 标题隐藏
    // （对齐小程序：workSteps.apply 每帧无条件执行，运行态由 policy 内部判断）
    ConversationFeed.applyWorkStepPolicy(rows, this.workStepMode, this.workStepTiming, this.expandedIds);
    // 运行中标题最短展示 150ms，避免快速切换闪烁（对齐客户端 PROCESS_TITLE_MINIMUM_MS）
    const nowMs: number = Date.now();
    for (const entry of rows) {
      if (entry.kind === 'PROCESS' && entry.running) {
        const held: string | undefined = this.titleHold.get(entry.id);
        const heldAt: number | undefined = this.titleHoldAt.get(entry.id);
        if (held !== undefined && heldAt !== undefined && held !== entry.title && nowMs - heldAt < 150) {
          entry.title = held;
        } else {
          this.titleHold.set(entry.id, entry.title);
          this.titleHoldAt.set(entry.id, nowMs);
        }
      }
    }
    // 同 id 行复用原实例（@ObjectLink 绑定的就是这个对象），否则展开状态更新不到列表项
    const previous: Map<string, ConversationFeedEntryModel> = new Map<string, ConversationFeedEntryModel>();
    for (const old of this.entries) {
      previous.set(old.id, old);
    }
    for (const entry of rows) {
      const existing: ConversationFeedEntryModel | undefined = previous.get(entry.id);
      const isExpanded: boolean = this.expandedIds.indexOf(entry.id) >= 0;
      if (existing !== undefined) {
        existing.assign(entry, isExpanded);
        built.push(existing);
      } else {
        const model: ConversationFeedEntryModel = ConversationFeedEntryModel.from(entry);
        model.expanded = isExpanded;
        built.push(model);
      }
    }
    this.entries = built;
    this.source.update(built);
  }

  private onRunningChanged(): void {
    // 运行状态翻转会改变折叠策略（运行中不收起过程组），必须重投影
    this.rebuildEntries();
    this.refreshProgress();
    if (this.running && this.autoStick) {
      setTimeout(() => {
        this.scroller.scrollEdge(Edge.Bottom);
      }, 40);
    }
  }

  /** 时间线变化：重排并吸底；运行指示器同步刷新。 */
  private onItemsChanged(): void {
    if (!this.ready) {
      return;
    }
    this.rebuildEntries();
    this.refreshProgress();
    const tail: ConversationFeedEntryModel | null = this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
    const key: string = tail === null ? '' : tail.id + ':' + tail.text.length.toString();
    if (key !== this.lastTailKey) {
      this.lastTailKey = key;
      if (this.autoStick) {
        setTimeout(() => {
          this.scroller.scrollEdge(Edge.Bottom);
        }, 30);
      }
    }
  }

  /** 运行中的过程组 id（点击运行条时展开它） */
  private runningProcessId(): string {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const entry: ConversationFeedEntryModel = this.entries[index];
      if (entry.kind === 'PROCESS') {
        return entry.id;
      }
    }
    return '';
  }

  /** 点击运行条：展开/收起当前运行中的过程组 */
  private toggleRunningProcess(): void {
    const id: string = this.runningProcessId();
    if (id.length === 0) {
      return;
    }
    const at: number = this.expandedIds.indexOf(id);
    if (at >= 0) {
      this.expandedIds.splice(at, 1);
    } else {
      this.expandedIds.push(id);
    }
    this.rebuildEntries();
  }

  private refreshProgress(): void {
    if (!this.running) {
      if (this.progressLabel.length > 0) {
        this.progressLabel = '';
      }
      return;
    }
    const source: ConversationItem[] = this.items === undefined ? [] : this.items;
    const activity: string = ConversationFeed.runningActivity(source);
    const start: number = ConversationFeed.lastUserEpochSeconds(source);
    const label: string = ConversationFeed.runningLabel(activity, start, Math.floor(Date.now() / 1000));
    if (label !== this.progressLabel) {
      this.progressLabel = label;
    }
  }

  // ==================== 主题 ====================
  private pageBg(): string {
    // 浅色模式按参考截图改为浅灰底（不再是纯白），让白色胶囊输入条和光圈浮出层次；深色仍为纯黑
    return this.isDark ? '#000000' : '#F2F2F4';
  }

  /** 状态栏内容色跟随页面背景：深色纯黑 → 白，浅色灰底 → 黑。setColorMode 会异步重置，延迟重试四次确保最终态正确 */
  private applyStatusBarColor(): void {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const apply = (): void => {
        window.getLastWindow(context).then((win: window.Window) => {
          win.setWindowSystemBarProperties({ statusBarContentColor: this.isDark ? '#FFFFFF' : '#000000' });
        }).catch(() => {
        });
      };
      apply();
      setTimeout(apply, 100);
      setTimeout(apply, 400);
      setTimeout(apply, 1000);
    } catch (err) {
    }
  }

  private textColor(): string {
    return this.isDark ? '#F1F4FA' : '#101318';
  }

  private subColor(): string {
    return this.isDark ? 'rgba(241,244,250,0.62)' : 'rgba(16,19,24,0.62)';
  }

  private surfaceColor(): string {
    return this.isDark ? '#1C1C1E' : '#FFFFFF';
  }

  /** 系统菜单（右上角「⋯」）的磨砂玻璃材质色：模糊会被压暗，故基色偏亮半透明 */
  private menuMaterial(): string {
    return this.isDark ? 'rgba(61,61,61,0.72)' : 'rgba(248,248,250,0.78)';
  }

  /** 卡片描边：浅色极淡黑边、深色极淡白边（弹层与输入框分层用） */
  private dividerColor(): string {
    return this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)';
  }

  private activeSessionTitle(): string {
    const id: string = SessionStore.get().currentSessionId();
    for (const session of this.sessions) {
      if (session.id === id) {
        return session.title.length > 0 ? session.title : id.substring(0, 8);
      }
    }
    return id.length > 0 ? id.substring(0, 8) : '会话';
  }

  private connectionDotColor(): string {
    if (this.connection === 'connected') {
      return '#2EB85C';
    }
    if (this.connection === 'connecting') {
      return '#FFAD1F';
    }
    if (this.connection === 'failed') {
      return '#D65D64';
    }
    return this.isDark ? 'rgba(241,244,250,0.40)' : 'rgba(16,19,24,0.35)';
  }

  private connectionLabel(): string {
    if (this.connection === 'connected') {
      return '已连接';
    }
    if (this.connection === 'connecting') {
      return '正在连接';
    }
    if (this.connection === 'failed') {
      return '连接失败';
    }
    return '未连接';
  }

  /** 权限胶囊文案（对齐 spec §4.3 的图标映射文案）。 */
  private permissionTitle(): string {
    if (this.defaultPermission === 'read-only') {
      return '只读';
    }
    if (this.defaultPermission === 'workspace-write') {
      return '工作区写入';
    }
    if (this.defaultPermission === 'danger-full-access') {
      return '完全访问';
    }
    return '默认权限';
  }

  /** 模型胶囊文案（deepseek-chat → DeepSeek Chat）。 */
  private modelTitle(): string {
    if (this.defaultModel === 'deepseek-chat') {
      return 'DeepSeek Chat';
    }
    if (this.defaultModel === 'deepseek-reasoner') {
      return 'DeepSeek Reasoner';
    }
    return this.defaultModel.length > 0 ? this.defaultModel : '默认模型';
  }

  // ==================== 交互回调 ====================
  private onToggleEntry(id: string): void {
    // 先原地翻转：@Observed 会立即刷新该行，不依赖后续列表重建
    for (const row of this.entries) {
      if (row.id === id) {
        row.expanded = !row.expanded;
      }
    }
    const index: number = this.expandedIds.indexOf(id);
    if (index >= 0) {
      this.expandedIds.splice(index, 1);
    } else {
      this.expandedIds.push(id);
    }
    this.rebuildEntries();
  }

  private onCopyEntry(text: string): void {
    if (text.length === 0) {
      return;
    }
    const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      this.getUIContext().getPromptAction().showToast({ message: '已复制' });
    }).catch(() => {
      this.hint = '复制失败';
    });
  }

  private onShowDetail(title: string, body: string): void {
    this.hint = body.length > 240 ? body.substring(0, 240) + '…' : body;
  }

  private async onSend(): Promise<void> {
    const text: string = this.draft.trim();
    if (this.sending || (text.length === 0 && this.pickedAttachments.length === 0)) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关：请先在设置页扫码配对';
      return;
    }
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      this.hint = '请先打开一个会话';
      return;
    }
    this.sending = true;
    const generation: number = client.generation();
    const selected: PickedAttachment[] = this.pickedAttachments.slice();
    try {
      const uploaded: UploadResult[] = [];
      for (const attachment of selected) {
        if (client.generation() !== generation || sessionId !== SessionStore.get().currentSessionId()) {
          throw new Error('连接或会话已变化，草稿已保留');
        }
        const result: UploadResult = await uploadAttachment(client, sessionId, attachment, (percent: number) => {
          this.attachmentHint = '正在上传 ' + attachment.name + ' · ' + percent + '%';
        });
        uploaded.push(result);
      }
      if (client.generation() !== generation || sessionId !== SessionStore.get().currentSessionId()) {
        throw new Error('连接或会话已变化，草稿已保留');
      }
      if (uploaded.length > 0) {
        const receipts: UploadReceipt[] = uploaded.map((item: UploadResult): UploadReceipt => ({ receiptId: item.receiptId }));
        const ack = await client.sendUserMessageWithAttachments(text, sessionId, receipts);
        if (ack.sessionId !== sessionId) {
          throw new Error('发送确认无效，草稿已保留');
        }
      } else if (!client.sendUserMessage(text, sessionId)) {
        throw new Error('发送失败，请检查连接');
      }
      if (sessionId !== SessionStore.get().currentSessionId() || this.draft.trim() !== text) {
        return;
      }
      this.hint = '';
      this.attachmentHint = '';
      this.pickedAttachments = [];
      this.draft = '';
      this.autoStick = true;
      setTimeout(() => {
        this.scroller.scrollEdge(Edge.Bottom);
      }, 30);
    } catch (error) {
      this.attachmentHint = error instanceof Error ? error.message : '附件发送失败，已保留选择内容';
    } finally {
      this.sending = false;
    }
  }

  private onStop(): void {
    if (!SessionStore.get().stopGenerating()) {
      this.hint = '停止失败：请检查连接';
    }
  }

  private async pickAttachments(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const picked: PickedAttachment[] = await pickDocuments(context, 4);
      this.pickedAttachments = picked;
      this.attachmentHint = picked.length > 0 ? '已选择 ' + picked.length + ' 个附件' : '';
    } catch (err) {
      this.attachmentHint = '未选择附件';
    }
  }

  private loadOlder(): void {
    if (!SessionStore.get().loadOlder()) {
      this.hint = '没有更早的记录了';
    }
  }

  private openSession(sessionId: string): void {
    if (sessionId !== SessionStore.get().currentSessionId()) {
      this.expandedIds = [];
      this.lastTailKey = '';
      SessionStore.get().open(sessionId);
    }
  }





  // ==================== 视图 ====================
  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.TopStart }) {
      Column() {
        this.headerBar()
        // 「加载更早记录」与运行条都在滚动内容内部（对齐小程序：横幅在 scroll-view 里，
        // 运行条在列表末尾），随内容一起滚动，而不是固定在容器外的两条横条。
        Column() {
          this.timeline()
        }
        .layoutWeight(1)
        .width('100%')
        .padding({ bottom: this.bottomInset })
        if (this.hint.length > 0) {
          Text(this.hint)
            .fontSize(12)
            .fontColor('#D65D64')
            .width('100%')
            .padding({ left: 20, right: 20, top: 2, bottom: 2 })
        }
        // 输入条容器：小程序 dock-stack 左右 14vp 内边距 + 底部安全区
        Column() {
        // 切换会话 / 权限 / 模型面板：同样紧贴输入框上方展开，输入框保持可见
        if (this.sessionPickerOpen) {
          this.sessionPicker()
        }
        if (this.composerSheet.length > 0) {
          this.composerSheetPanel()
        }
        ConversationComposer({
          isDark: this.isDark,
          draft: this.draft,
          placeholder: this.composerPlaceholder(),
          connected: this.connection === 'connected',
          running: this.running,
          sending: this.sending,
          permissionTitle: this.permissionTitle(),
          permissionIcon: this.permissionIconGlyph(),
          permissionOpen: this.permissionMenuOpen,
          permissionLabels: this.permissionMenuLabels(),
          permissionValues: this.permissionMenuValues(),
          permissionCurrent: this.defaultPermission,
          modelOpen: this.modelMenuOpen,
          modelMenuItems: this.modelMenuItems(),
          modelProviders: this.modelProviderItems(),
          currentProvider: this.currentModelProvider(),
          modelMenuCurrent: this.currentModelId(),
          effortValues: this.effortMenuValues(),
          effortLabels: this.effortMenuLabels(),
          effortCurrent: this.currentEffort(),
          effort: this.effortName(this.currentEffort()),
          modelTitle: this.currentModelLabel(),
          modelBadge: this.currentModelBadge(),
          effortLabel: this.effortLabel(),
          contextPercent: this.contextPercent(),
          runMetric: this.runMetric(),
          tokenMetric: this.tokenMetric(),
          contextMetric: this.contextMetric(),
          attachmentCount: this.pickedAttachments.length,
          metricPairsFor: (kind: string): MetricMenuPair[] => {
            const pairs: MetricMenuPair[] = [];
            const rows: MetricPair[] = this.buildMetricPairs(kind);
            for (const p of rows) {
              const pair: MetricMenuPair = { label: p.label, value: p.value };
              pairs.push(pair);
            }
            return pairs;
          },
          focused: this.composerFocused,
          onFocusChange: (focused: boolean) => {
            // 输入条弹层开着时不塌回：点弹窗会连带收起键盘并让输入框失焦，这时必须保住 chip 行
            if (!focused && this.composerSheet.length > 0) {
              return;
            }
            this.composerFocused = focused;
          },
          onDraft: (value: string) => {
            this.draft = value;
          },
          onSend: () => {
            this.onSend();
          },
          onStop: () => {
            this.onStop();
          },
          onAddAttachment: () => {
            this.pickAttachments();
          },
          onPickPermission: () => {
            this.openComposerSheet('permission');
          },
          onPickPermissionOption: (value: string) => {
            this.permissionMenuOpen = false;
            this.selectPermission(value);
          },
          onPermissionMenuVisible: (visible: boolean) => {
            this.permissionMenuOpen = visible;
          },
          onPickModel: () => {
            this.openComposerSheet('model');
          },
          onPickModelOption: (provider: string, model: string) => {
            this.selectModel(provider, model);
          },
          onPickEffortOption: (value: string) => {
            this.selectEffortAndModel(value);
          },
          onModelMenuVisible: (visible: boolean) => {
            this.modelMenuOpen = visible;
          },
          onContext: () => {
            this.openMetricPopover('context');
          },
          onStats: () => {
            this.openMetricPopover('run');
          },
          onTokenStats: () => {
            this.openMetricPopover('token');
          }
        })
        }
        .width('100%')
        .padding({ left: 14, right: 14, bottom: 18 + this.bottomInset })
      }
      .width('100%')
      .height('100%')
      .backgroundColor(this.pageBg())
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.BOTTOM])


      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
    .onShown(() => {
      this.applyStatusBarColor();
    })
    .backgroundColor(this.pageBg())
  }

  @State sessionPickerOpen: boolean = false;

  // ==================== 输入条 chip 弹层（对齐小程序 permission-pop / model-menu） ====================
  private openComposerSheet(kind: string): void {
    if (this.composerSheet === kind) {
      this.composerSheet = '';
      return;
    }
    if (kind === 'permission') {
      this.permissionRows = this.buildPermissionRows();
    } else {
      this.modelRows = this.buildModelRows();
      this.effortRows = this.buildEffortRows();
    }
    this.composerSheet = kind;
  }

  /** 权限名（对齐小程序 labels.permissionName） */
  private permissionName(value: string): string {
    if (value === 'read-only') {
      return '只读';
    }
    if (value === 'workspace-write') {
      return '工作区写入';
    }
    if (value === 'danger-full-access') {
      return '完全访问';
    }
    if (value === 'auto') {
      return '自动审查';
    }
    return value.length > 0 ? value : '默认权限';
  }

  private permissionGlyph(value: string): string {
    if (value === 'read-only') {
      return '◐';
    }
    if (value === 'workspace-write') {
      return '✎';
    }
    if (value === 'danger-full-access') {
      return '⚠';
    }
    if (value === 'auto') {
      return '◈';
    }
    return '⛨';
  }

  /** 权限选项：网关下发优先，缺失时用固定三项 + 自动审查兜底（对齐小程序 pickPermission）。 */
  /** 权限菜单文案（对齐小程序 pickPermission：预设名优先，缺失时兜底三项 + 自动审查）。 */
  private permissionMenuLabels(): string[] {
    const labels: string[] = [];
    for (const value of this.permissionMenuValues()) {
      labels.push(this.permissionName(value));
    }
    return labels;
  }

  /** 权限菜单取值列表。 */
  private permissionMenuValues(): string[] {
    const values: string[] = [];
    for (const value of this.permissionValues) {
      if (value.length > 0 && values.indexOf(value) < 0) {
        values.push(value);
      }
    }
    if (values.length === 0) {
      values.push('read-only');
      values.push('workspace-write');
      values.push('danger-full-access');
    }
    if (values.indexOf('auto') < 0) {
      values.push('auto');
    }
    return values;
  }

  private buildPermissionRows(): PermissionRow[] {
    const rows: PermissionRow[] = [];
    const current: string = this.defaultPermission;
    const seen: string[] = [];
    for (const value of this.permissionValues) {
      if (value.length === 0 || seen.indexOf(value) >= 0) {
        continue;
      }
      seen.push(value);
      rows.push({ value: value, label: this.permissionName(value), icon: this.permissionGlyph(value), current: value === current });
    }
    if (seen.length === 0) {
      const fallback: string[] = ['read-only', 'workspace-write', 'danger-full-access'];
      for (const value of fallback) {
        rows.push({ value: value, label: this.permissionName(value), icon: this.permissionGlyph(value), current: value === current });
      }
    }
    if (seen.indexOf('auto') < 0) {
      rows.push({ value: 'auto', label: '自动审查', icon: this.permissionGlyph('auto'), current: current === 'auto' });
    }
    return rows;
  }

  /** 当前模型 id：目录 current 优先，其次会话默认模型。 */
  private currentModelId(): string {
    if (this.selectedModel.length > 0) {
      return this.selectedModel;
    }
    // 会话回执可能只给显示名（如 DeepSeek-V4.1-Flash）：按 label 反查 id
    if (this.defaultModel.length > 0) {
      for (const option of this.modelOptions) {
        if (option.model === this.defaultModel || option.label === this.defaultModel) {
          return option.model;
        }
      }
      return this.defaultModel;
    }
    // 目录里的 current 兜底
    return '';
  }

  /** 当前模型显示名：按 id 在目录里找 label，找不到回退 id。 */
  private currentModelLabel(): string {
    const id: string = this.currentModelId();
    for (const option of this.modelOptions) {
      if (option.model === id) {
        return option.label;
      }
    }
    // 目录还没有（未连网关）或 id 不在目录里：直接显示模型 id，不要用占位词
    return id.length > 0 ? id : '模型';
  }

  /** 当前模型发布徽章。 */
  private currentModelBadge(): string {
    const id: string = this.currentModelId();
    for (const option of this.modelOptions) {
      if (option.model === id) {
        return option.badge;
      }
    }
    return '';
  }

  /** 当前推理等级（目录回传优先，其次会话默认）。 */
  private currentEffort(): string {
    const value: string = this.selectedEffort.length > 0 ? this.selectedEffort : this.defaultEffort;
    return value.length > 0 ? value : 'high';
  }

  /** 构建模型菜单条目：按 provider 分组（表头 + 条目）。 */
  private modelMenuItems(): ModelMenuItem[] {
    const items: ModelMenuItem[] = [];
    const currentModel: string = this.currentModelId();
    const currentProvider: string = this.currentModelProvider();
    let lastProvider: string = '';
    for (const option of this.modelOptions) {
      const providerName: string = option.providerName.length > 0 ? option.providerName : this.providerName(option.provider);
      if (providerName !== lastProvider) {
        lastProvider = providerName;
        items.push({
          key: 'header-' + providerName, label: providerName, isHeader: true, current: false,
          provider: '', model: '', effortValue: ''
        });
      }
      const badge: string = option.badge.length > 0 ? ' ' + option.badge : '';
      items.push({
        key: option.provider + '/' + option.model,
        label: option.label + badge,
        isHeader: false,
        // 仅「当前提供商 + 当前模型」打勾，避免同名模型在多提供商下出现多个 ✓
        current: option.model === currentModel && (currentProvider.length === 0 || option.provider === currentProvider),
        provider: option.provider,
        model: option.model,
        effortValue: ''
      });
    }
    // 推理等级不在模型列表里出现：第一层已经有独立的「推理等级」入口
    return items;
  }

  /** 提供商列表（模型菜单的上一级） */
  private modelProviderItems(): ModelMenuItem[] {
    const out: ModelMenuItem[] = [];
    const seen: string[] = [];
    const currentProvider: string = this.currentModelProvider();
    for (const option of this.modelOptions) {
      if (seen.indexOf(option.provider) >= 0) {
        continue;
      }
      seen.push(option.provider);
      const name: string = option.providerName.length > 0 ? option.providerName : this.providerName(option.provider);
      out.push({
        key: 'provider-' + option.provider,
        label: name,
        isHeader: false,
        current: option.provider === currentProvider,
        provider: option.provider,
        model: '',
        effortValue: ''
      });
    }
    return out;
  }

  /** 当前模型所属提供商 */
  private currentModelProvider(): string {
    const id: string = this.currentModelId();
    // 同名模型可能出现在多个提供商下：已显式选择过提供商时以它为准，否则用目录里的第一个匹配项
    if (this.selectedProvider.length > 0) {
      for (const option of this.modelOptions) {
        if (option.model === id && option.provider === this.selectedProvider) {
          return this.selectedProvider;
        }
      }
    }
    for (const option of this.modelOptions) {
      if (option.model === id) {
        return option.provider;
      }
    }
    return this.selectedProvider;
  }

  private modelMenuBadges(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      out.push(option.badge);
    }
    return out;
  }

  /** 模型菜单：provider 名（按小程序映射 DeepSeek 账号 / 官方 API）。 */
  private providerName(provider: string): string {
    if (provider === 'deepseek-account') {
      return 'DeepSeek 账号';
    }
    if (provider === 'deepseek-official') {
      return 'DeepSeek 官方 API';
    }
    return provider.length > 0 ? provider : '模型';
  }

  private modelMenuProviders(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      // 优先用网关给的 providerName，回退到内置映射
      out.push(option.providerName.length > 0 ? option.providerName : this.providerName(option.provider));
    }
    return out;
  }

  private modelMenuLabels(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      out.push(option.label);
    }
    return out;
  }

  private modelMenuModels(): string[] {
    const out: string[] = [];
    for (const option of this.modelOptions) {
      out.push(option.model);
    }
    return out;
  }

  /** 推理等级取值（小程序 pickEffort：Off/Low/Medium/High）。 */
  private effortMenuValues(): string[] {
    return ['off', 'low', 'medium', 'high'];
  }

  private effortMenuLabels(): string[] {
    return ['Off', 'Low', 'Medium', 'High'];
  }

  /** 只切推理等级：沿用当前模型下发 select-model（对齐小程序 pickEffortOption）。 */
  private selectEffortAndModel(effort: string): void {
    this.selectedEffort = effort;
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    // 沿用当前模型，只换推理等级（对齐小程序 pickEffortOption）
    const model: string = this.currentModelId();
    let provider: string = this.selectedProvider;
    if (provider.length === 0) {
      for (const option of this.modelOptions) {
        if (option.model === model) {
          provider = option.provider;
        }
      }
    }
    client.requestGateway(GatewayRequestFactory.selectModel(sessionId, provider, model, effort)).catch((error: Error) => {
      this.hint = '推理等级切换失败：' + error.message;
    });
  }

  private buildModelRows(): ModelRow[] {
    const rows: ModelRow[] = [];
    const current: string = this.defaultModel;
    for (const option of this.modelOptions) {
      rows.push({
        key: option.provider + '/' + option.model,
        provider: option.provider,
        model: option.model,
        label: option.label,
        current: option.model === current
      });
    }
    return rows;
  }

  private buildEffortRows(): EffortRow[] {
    const rows: EffortRow[] = [];
    rows.push({ id: 'low', label: '低', current: this.defaultEffort === 'low' });
    rows.push({ id: 'medium', label: '中', current: this.defaultEffort === 'medium' });
    rows.push({ id: 'high', label: '高', current: this.defaultEffort === 'high' });
    return rows;
  }

  /** 推理等级文案（逐条对齐小程序 labels.reasoningEffortName） */
  private effortName(effort: string): string {
    const key: string = effort.toLowerCase();
    if (key === 'off' || key === 'none' || key === 'disabled') {
      return 'Off';
    }
    if (key === 'minimal') {
      return 'Minimal';
    }
    if (key === 'low') {
      return 'Low';
    }
    if (key === 'medium') {
      return 'Medium';
    }
    if (key === 'high') {
      return 'High';
    }
    if (key === 'xhigh') {
      return 'XHigh';
    }
    if (key === 'max') {
      return 'Max';
    }
    if (key === 'ultra') {
      return 'Ultra';
    }
    return effort;
  }

  /** 选中权限：下发 permission 帧并本地更新（对齐小程序 pickPermissionOption）。 */
  private selectPermission(value: string): void {
    this.composerSheet = '';
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || value.length === 0) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    this.defaultPermission = value;
    client.requestGateway(GatewayRequestFactory.setPermission(sessionId, value)).catch(() => {
      this.hint = '权限设置失败';
    });
  }

  /** 选中模型：下发 select-model 帧。 */
  private selectModel(provider: string, model: string): void {
    this.composerSheet = '';
    const sessionId: string = SessionStore.get().currentSessionId();
    if (sessionId.length === 0 || model.length === 0) {
      return;
    }
    const client: GatewayClient = GatewayClient.get();
    if (!client.isConnected()) {
      this.hint = '未连接网关';
      return;
    }
    // 会话级选择：本地乐观更新 chip（对齐小程序 sessionState.selection），不覆盖主机默认模型
    this.selectedModel = model;
    this.selectedProvider = provider;
    client.requestGateway(GatewayRequestFactory.selectModel(sessionId, provider, model, this.currentEffort())).catch((error: Error) => {
      this.hint = '模型切换失败：' + error.message;
    });
  }

  private selectEffort(effort: string): void {
    this.defaultEffort = effort;
    this.effortRows = this.buildEffortRows();
  }
  // ==================== 指标弹层（对齐小程序 statsPop / ctx-pop） ====================
  private openMetricPopover(kind: string): void {
    if (this.metricPopover === kind) {
      this.metricPopover = '';
      return;
    }
    this.metricTitle = this.metricTitleFor(kind);
    this.metricPairs = this.buildMetricPairs(kind);
    this.metricTotal = this.metricTotalFor(kind);
    this.metricPopover = kind;
  }

  private metricTitleFor(kind: string): string {
    if (kind === 'run') {
      return '会话统计';
    }
    if (kind === 'token') {
      return 'Token 用量';
    }
    return '上下文已用';
  }

  /** 标题行右侧总量（对齐小程序 statsPopTotal / ctx 头部）：Token=计费输入+输出；上下文=已用/窗口。 */
  private metricTotalFor(kind: string): string {
    if (kind === 'context') {
      const used: number = this.contextUsedTokens();
      const window: number = this.contextWindowTokens();
      if (used >= 0 && window >= 0) {
        return '~' + this.compactTok(used) + ' / ' + this.compactTok(window);
      }
      return '';
    }
    if (kind !== 'token') {
      return '';
    }
    const uncached: number = this.tokenValue('uncachedInputTokens', true);
    const cacheRead: number = this.tokenValue('cacheReadTokens', false);
    const cacheWrite: number = this.tokenValue('cacheWriteTokens', false);
    const input: number = this.tokenValue('inputTokens', false);
    const output: number = this.tokenValue('outputTokens', false);
    const hasDisjoint: boolean = uncached >= 0 && cacheRead >= 0 && cacheWrite >= 0;
    const billed: number = hasDisjoint ? uncached + cacheRead + cacheWrite : input;
    if (billed < 0 || output < 0) {
      return '';
    }
    return this.tokenLabel(billed + output);
  }

  /** 紧凑 token 计数（对齐小程序 compactTok：1234 → 1.2k，1234567 → 1.2M）。 */
  private compactTok(value: number): string {
    if (value < 0) {
      return '—';
    }
    const n: number = Math.round(value);
    if (n >= 1000000) {
      return (Math.round(n / 100000) / 10).toString().replace(/\.0$/, '') + 'M';
    }
    if (n >= 1000) {
      return (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k';
    }
    return n.toString();
  }

  /** 上下文占比分项（pressure.breakdown.*，缺省 -1）。 */
  private breakdownNum(key: string): number {
    if (this.contextUsage === null) {
      return -1;
    }
    const record = asRec(this.contextUsage);
    const pressure = record === undefined ? undefined : asRec(record['pressure']);
    const breakdown = pressure === undefined ? undefined : asRec(pressure['breakdown']);
    if (breakdown === undefined) {
      return -1;
    }
    return num(breakdown, key) ?? -1;
  }

  /** 生成弹层行（只在打开时算一次）。 */
  private buildMetricPairs(kind: string): MetricPair[] {
    const pairs: MetricPair[] = [];
    if (kind === 'run') {
      pairs.push({ key: 'llm', label: '模型用时', value: this.durationLabel(this.statsNum('llmMs')) });
      pairs.push({ key: 'tool', label: '工具调用', value: this.durationLabel(this.statsNum('toolMs')) });
      pairs.push({ key: 'ttft', label: '首 token 平均（TTFT）', value: this.durationLabel(this.ttftMs()) });
      pairs.push({ key: 'tps', label: '输出速度（TPS）', value: this.tpsLabel() });
    } else if (kind === 'token') {
      pairs.push({ key: 'hit', label: '缓存命中', value: this.cacheHitLabel() });
      pairs.push({ key: 'uncached', label: '未缓存输入', value: this.tokenLabel(this.tokenValue('uncachedInputTokens', true)) });
      pairs.push({ key: 'cacheRead', label: '缓存读取', value: this.tokenLabel(this.tokenValue('cacheReadTokens', false)) });
      pairs.push({ key: 'output', label: '输出', value: this.tokenLabel(this.tokenValue('outputTokens', false)) });
    } else {
      // 对齐小程序 ctx-pop：分项明细（系统提示词/工具定义/对话消息），缺 breakdown 时退回 token 用量三项
      const systemTokens: number = this.breakdownNum('systemTokens');
      const toolsTokens: number = this.breakdownNum('toolsTokens');
      const messageTokens: number = this.breakdownNum('messageTokens');
      if (systemTokens >= 0 || toolsTokens >= 0 || messageTokens >= 0) {
        if (systemTokens >= 0) {
          pairs.push({ key: 'system', label: '系统提示词', value: this.compactTok(systemTokens) + ' tok' });
        }
        if (toolsTokens >= 0) {
          pairs.push({ key: 'tools', label: '工具定义', value: this.compactTok(toolsTokens) + ' tok' });
        }
        if (messageTokens >= 0) {
          pairs.push({ key: 'messages', label: '对话消息', value: this.compactTok(messageTokens) + ' tok' });
        }
      } else {
        const uncached: number = this.tokenValue('uncachedInputTokens', true);
        const cacheRead: number = this.tokenValue('cacheReadTokens', false);
        const output: number = this.tokenValue('outputTokens', false);
        if (uncached >= 0) {
          pairs.push({ key: 'uncached', label: '未缓存输入', value: this.compactTok(uncached) + ' tok' });
        }
        if (cacheRead >= 0) {
          pairs.push({ key: 'cacheRead', label: '缓存读取', value: this.compactTok(cacheRead) + ' tok' });
        }
        if (output >= 0) {
          pairs.push({ key: 'output', label: '模型输出', value: this.compactTok(output) + ' tok' });
        }
      }
    }
    return pairs;
  }

  /** 统计字段（context-dashboard.stats）。 */
  private statsNum(key: string): number {
    if (this.dashboard === null) {
      return -1;
    }
    const record = asRec(this.dashboard);
    if (record === undefined) {
      return -1;
    }
    const stats = asRec(record['stats']);
    if (stats === undefined) {
      return -1;
    }
    return num(stats, key) ?? -1;
  }

  private durationLabel(ms: number): string {
    if (ms < 0) {
      return '—';
    }
    if (ms >= 60000) {
      return Math.floor(ms / 60000).toString() + '分' + Math.round((ms % 60000) / 1000).toString() + '秒';
    }
    if (ms >= 1000) {
      return (Math.round(ms / 100) / 10).toString() + '秒';
    }
    return Math.round(ms).toString() + '毫秒';
  }

  private ttftMs(): number {
    const steps: number = this.statsNum('ttftSteps');
    const total: number = this.statsNum('ttftMs');
    if (steps > 0 && total >= 0) {
      return total / steps;
    }
    return this.statsNum('firstTokenMs');
  }

  private tpsLabel(): string {
    const decodeMs: number = this.statsNum('decodeMs');
    const decodeTokens: number = this.statsNum('decodeTokens');
    let rate: number = -1;
    if (decodeMs > 0 && decodeTokens >= 0) {
      rate = decodeTokens / (decodeMs / 1000);
    } else {
      rate = this.statsNum('decodeTokensPerSec');
    }
    if (rate < 0) {
      return '—';
    }
    const rounded: number = Math.round(rate * 10) / 10;
    return rounded.toString() + ' tok/s';
  }

  /** 上下文压力记录：候选顺序对齐小程序（stats.pressure → 顶层 → value 包装 → 帧本身）。 */
  private pressureRecord(): Object | undefined {
    if (this.dashboard !== null) {
      const record = asRec(this.dashboard);
      if (record !== undefined) {
        const stats = asRec(record['stats']);
        if (stats !== undefined) {
          const inStats = asRec(stats['contextPressure']);
          if (inStats !== undefined && this.pressureValid(inStats)) {
            return inStats;
          }
        }
        const top = asRec(record['contextPressure']);
        if (top !== undefined && this.pressureValid(top)) {
          return top;
        }
        if (this.pressureValid(record)) {
          return record;
        }
      }
    }
    if (this.contextUsage !== null) {
      const frame = asRec(this.contextUsage);
      if (frame !== undefined) {
        const cp = asRec(frame['contextPressure']);
        if (cp !== undefined && this.pressureValid(cp)) {
          return cp;
        }
        const direct = asRec(frame['pressure']);
        if (direct !== undefined && this.pressureValid(direct)) {
          return direct;
        }
        const value = asRec(frame['value']);
        if (value !== undefined) {
          const nested = asRec(value['pressure']);
          if (nested !== undefined && this.pressureValid(nested)) {
            return nested;
          }
          const nestedCp = asRec(value['contextPressure']);
          if (nestedCp !== undefined && this.pressureValid(nestedCp)) {
            return nestedCp;
          }
          if (this.pressureValid(value)) {
            return value;
          }
        }
        if (this.pressureValid(frame)) {
          return frame;
        }
      }
    }
    return undefined;
  }

  private pressureValid(pressure: Object | undefined): boolean {
    if (pressure === undefined) {
      return false;
    }
    const window: number = num(pressure, 'contextWindow') ?? -1;
    const used: number = num(pressure, 'projectedTokens') ?? (num(pressure, 'pressureTokens') ?? -1);
    return window >= 0 && used >= 0;
  }

  private contextUsedTokens(): number {
    const pressure = this.pressureRecord();
    if (pressure === undefined) {
      return -1;
    }
    const projected: number = num(pressure, 'projectedTokens') ?? -1;
    return projected >= 0 ? projected : (num(pressure, 'pressureTokens') ?? -1);
  }

  private contextWindowTokens(): number {
    const pressure = this.pressureRecord();
    if (pressure === undefined) {
      return -1;
    }
    return num(pressure, 'contextWindow') ?? -1;
  }

  private tokenLabel(value: number): string {
    if (value < 0) {
      return '—';
    }
    const rounded: number = Math.round(value);
    let text: string = '';
    const digits: string = rounded.toString();
    let count: number = 0;
    for (let index = digits.length - 1; index >= 0; index--) {
      text = digits.charAt(index) + text;
      count++;
      if (count % 3 === 0 && index > 0) {
        text = ',' + text;
      }
    }
    return text + ' tok';
  }

  private cacheHitLabel(): string {
    const percent: number = this.sessionCacheHitPercent();
    return percent >= 0 ? percent.toString() + '%' : '—';
  }

  /** token 分项记录：context-usage 帧（同帧提供 Token 分项）优先，缺了回 context-dashboard。 */
  private tokenUsageRecord(): Object | undefined {
    if (this.contextUsage !== null) {
      const frame = asRec(this.contextUsage);
      if (frame !== undefined) {
        const direct = asRec(frame['tokenUsage']);
        if (direct !== undefined) {
          return direct;
        }
        const value = asRec(frame['value']);
        if (value !== undefined) {
          const nested = asRec(value['tokenUsage']);
          if (nested !== undefined) {
            return nested;
          }
        }
      }
    }
    if (this.dashboard !== null) {
      const record = asRec(this.dashboard);
      if (record !== undefined) {
        const top = asRec(record['tokenUsage']);
        if (top !== undefined) {
          return top;
        }
        const stats = asRec(record['stats']);
        if (stats !== undefined) {
          const inStats = asRec(stats['tokenUsage']);
          if (inStats !== undefined) {
            return inStats;
          }
        }
      }
    }
    return undefined;
  }

  /** token 分项读取：先直取，缺了再回会话 totals 桶（对齐小程序 tokenUsageValue）。 */
  private tokenBucket(tokens: Object | undefined, totals: Object | undefined, name: string): number {
    const direct: number = num(tokens, name) ?? -1;
    if (direct >= 0) {
      return direct;
    }
    if (totals !== undefined) {
      return num(totals, name) ?? -1;
    }
    return -1;
  }

  private tokenValue(key: string, fallbackToInput: boolean): number {
    const tokens = asRec(this.tokenUsageRecord());
    if (tokens === undefined) {
      return -1;
    }
    const totals = asRec(tokens['totals']);
    const value: number = this.tokenBucket(tokens, totals, key);
    if (value >= 0) {
      return value;
    }
    if (fallbackToInput) {
      return this.tokenBucket(tokens, totals, 'inputTokens');
    }
    return -1;
  }

  /** 输入条 chip 弹层：底部卡片（权限列表 / 模型列表 + 推理等级）。 */
  @Builder
  composerSheetPanel() {
    // 不再用全屏遮罩：面板直接叠在输入框上方，输入框保持可见可点
    Column({ space: 2 }) {
        Row() {
          Text(this.composerSheet === 'permission' ? '权限' : '模型')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Blank()
          Text('关闭')
            .fontSize(12)
            .fontColor(this.subColor())
            .onClick(() => {
              this.composerSheet = '';
            })
        }
        .width('100%')
        .height(36)

        if (this.composerSheet === 'permission') {
          Scroll() {
            Column({ space: 1 }) {
              ForEach(this.permissionRows, (row: PermissionRow) => {
                Row({ space: 8 }) {
                  Text(row.icon).fontSize(12).fontColor(this.subColor()).width(16)
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .layoutWeight(1)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (row.current) {
                    Text('✓').fontSize(12).fontColor('#2E6BE6')
                  }
                }
                .width('100%')
                .height(38)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(row.current ? 'rgba(46,107,230,0.12)' : Color.Transparent)
                .onClick(() => {
                  this.composerSheet = '';
                  this.selectPermission(row.value);
                })
              }, (row: PermissionRow) => row.value)
            }
            .width('100%')
          }
          .constraintSize({ maxHeight: 320 })
          .scrollBar(BarState.Off)
        } else {
          Scroll() {
            Column({ space: 1 }) {
              ForEach(this.modelRows, (row: ModelRow) => {
                Row({ space: 8 }) {
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .layoutWeight(1)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  if (row.current) {
                    Text('✓').fontSize(12).fontColor('#2E6BE6')
                  }
                }
                .width('100%')
                .height(38)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(row.current ? 'rgba(46,107,230,0.12)' : Color.Transparent)
                .onClick(() => {
                  this.composerSheet = '';
                  this.selectModel(row.provider, row.model);
                })
              }, (row: ModelRow) => row.key)

              // 推理等级分区（对齐小程序 effortSheet）
              Row() {
                Text('推理等级').fontSize(11).fontColor(this.subColor())
              }
              .width('100%')
              .height(30)
              .padding({ left: 8 })
              ForEach(this.effortRows, (row: EffortRow) => {
                Row({ space: 8 }) {
                  Text(row.label)
                    .fontSize(14)
                    .fontColor(this.textColor())
                    .layoutWeight(1)
                  if (row.current) {
                    Text('✓').fontSize(12).fontColor('#2E6BE6')
                  }
                }
                .width('100%')
                .height(36)
                .padding({ left: 8, right: 8 })
                .borderRadius(8)
                .backgroundColor(row.current ? 'rgba(46,107,230,0.12)' : Color.Transparent)
                .onClick(() => {
                  this.composerSheet = '';
                  this.selectEffort(row.id);
                })
              }, (row: EffortRow) => row.id)
            }
            .width('100%')
          }
          .constraintSize({ maxHeight: 420 })
          .scrollBar(BarState.Off)
        }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(16)
    .borderRadius(18)
    .backgroundColor(this.surfaceColor())
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
    .shadow({ radius: 20, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)', offsetY: 6 })
    .margin({ left: 12, right: 12, bottom: 8 })
  }
  /** 指标弹层：输入框正上方的菜单式小卡片（样式对齐右上角三点 Menu：无遮罩、圆角卡片、细描边、行分隔线）。 */
  /** 行数据在打开时算好存进 @State，build 内不再调用会新建数组的方法（否则会反复重渲染）。 */
  @Builder
  metricPopoverPanel() {
    // 不再用全屏遮罩：面板直接叠在输入框上方，输入框保持可见可点
    Column({ space: 2 }) {
        // 标题行：标题 + 占比（上下文已用）/ 总量（Token 用量）
        Row() {
          Text(this.metricTitle)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Blank()
          if (this.metricPopover === 'context' && this.contextPercent() >= 0) {
            Text(this.contextMetric())
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor('#2E6BE6')
          }
          if (this.metricPopover === 'token' && this.metricTotal.length > 0) {
            Text(this.metricTotal)
              .fontSize(12)
              .fontColor(this.subColor())
          }
          Text('关闭')
            .fontSize(12)
            .fontColor(this.subColor())
            .margin({ left: 12 })
            .onClick(() => {
              this.metricPopover = '';
            })
        }
        .width('100%')
        .height(36)

        // 上下文：已用/窗口 + 占比进度条（对齐小程序 ctx-pop 头部与 ctx-bar）
        if (this.metricPopover === 'context') {
          if (this.metricTotal.length > 0) {
            Text(this.metricTotal)
              .fontSize(11.5)
              .fontColor(this.subColor())
              .width('100%')
              .margin({ bottom: 5 })
          }
          Progress({
            value: this.contextPercent() < 0 ? 0 : Math.min(100, this.contextPercent()),
            total: 100,
            type: ProgressType.Linear
          })
            .width('100%')
            .height(3)
            .color('#2E6BE6')
            .backgroundColor(this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(12,14,19,0.08)')
            .margin({ bottom: 4 })
        }

        ForEach(this.metricPairs, (pair: MetricPair) => {
          Row() {
            Text(pair.label)
              .fontSize(14)
              .fontColor(this.subColor())
            Blank()
            Text(pair.value)
              .fontSize(14)
              .fontColor(this.textColor())
          }
          .width('100%')
          .height(38)
          .padding({ left: 8, right: 8 })
          .borderRadius(8)
          .backgroundColor(Color.Transparent)
        }, (pair: MetricPair) => pair.key)
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding(16)
    .borderRadius(18)
    .backgroundColor(this.surfaceColor())
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
    .shadow({ radius: 20, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)', offsetY: 6 })
    .margin({ left: 12, right: 12, bottom: 8 })
  }

  /** 顶栏：返回 + 标题/连接状态 + 更多。 */
  /** 顶部安全区：safeTopVp 未就绪时用状态栏兜底高度，避免顶栏被状态栏遮挡 */
  private topSafe(): number {
    return this.topInset > 0 ? this.topInset : 38.9;
  }

  @Builder
  headerBar() {
    Row({ space: 4 }) {
      NavBackButton({ isDark: this.isDark })
        .id('conversation-back')
        .onClick(() => {
          this.pageStack.pop();
        })

      Column({ space: 3 }) {
        Text(this.activeSessionTitle())
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.textColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
        Row({ space: 6 }) {
          Circle().width(8).height(8).fill(this.connectionDotColor())
          Text(this.connectionLabel())
            .fontSize(13)
            .fontColor(this.subColor())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      .onClick(() => {
        this.sessionPickerOpen = true;
      })

      Button({ type: ButtonType.Circle }) {
        Text('⋯').fontSize(18).fontColor(this.textColor())
      }
      .id('conversation-overflow')
      .width(44)
      .height(44)
      .backgroundColor(Color.Transparent)
      .accessibilityText('更多')
      .bindMenu(this.moreMenu())
    }
    .width('100%')
    .height(64 + this.topSafe())
    // 左缘与输入条一致（输入条容器 padding 14）：返回按钮和输入框左边缘对齐
    .padding({ left: 14, right: 14, top: 6 + this.topSafe() })
  }

  /** 加载更早记录。 */
  @Builder
  loadOlderBar() {
    Row({ space: 8 }) {
      Button('加载更早记录')
        .fontSize(13)
        .fontColor('#2E6BE6')
        .backgroundColor(Color.Transparent)
        .height(40)
        .enabled(this.connection === 'connected')
        .onClick(() => {
          this.loadOlder();
        })
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
  }

  /** 已选附件条。 */
  @Builder
  attachmentStrip() {
    Row({ space: 6 }) {
      ForEach(this.pickedAttachments, (attachment: PickedAttachment) => {
        Text(attachment.name)
          .fontSize(11)
          .fontColor(this.textColor())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .padding({ left: 8, right: 8, top: 5, bottom: 5 })
          .borderRadius(8)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,19,24,0.06)')
          .onClick(() => {
            this.pickedAttachments = this.pickedAttachments.filter((item: PickedAttachment) => item.uri !== attachment.uri);
          })
      }, (attachment: PickedAttachment) => attachment.uri)
      if (this.attachmentHint.length > 0) {
        Text(this.attachmentHint).fontSize(11).fontColor(this.subColor())
      }
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 2, bottom: 4 })
  }

  /** 时间线：LazyForEach + 吸底跟随 + 回到底部。 */
  @Builder
  timeline() {
    // Stack 不支持 layoutWeight，因此高度由外层 Column 的 layoutWeight 承担，
    // 这里给 Stack 显式 height('100%') 才能让内部 List 撑满。
    Stack({ alignContent: Alignment.Bottom }) {
      if (this.entries.length === 0) {
        // 空会话：整块在时间线区域内垂直居中（对齐 spec §1.6 的空会话态）
        Column({ space: 8 }) {
          Text('操作远端 DSH Agent')
            .fontSize(18)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.textColor())
          Text('发送任务后，工具调用、推理进度和最终回复会通过 Mobile Gateway 实时返回。')
            .fontSize(13)
            .fontColor(this.subColor())
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
      }
      List({ space: 0, scroller: this.scroller }) {
        // 列表头：「加载更早记录」在滚动内容顶部（对齐小程序 .hist-banner）
        if (this.hasMoreHistory && this.entries.length > 0) {
          ListItem() {
            this.loadOlderBar()
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }
        LazyForEach(this.source, (entry: ConversationFeedEntryModel) => {
          ListItem() {
            ConversationRowView({
              entry: entry,
              isDark: this.isDark,
              procIconStyle: this.procIconStyle,
              onToggle: (id: string) => {
                this.onToggleEntry(id);
              },
              onCopy: (text: string) => {
                this.onCopyEntry(text);
              },
              onShowDetail: (title: string, body: string) => {
                this.onShowDetail(title, body);
              }
            })
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }, (entry: ConversationFeedEntryModel) => entry.id)
        // 列表尾：运行中的鲸尾状态条在滚动内容末尾（对齐小程序 .progress-strip 在 scroll-view 内）
        if (this.progressLabel.length > 0) {
          ListItem() {
            ConversationProgress({
              isDark: this.isDark,
              appearance: this.statusAppearance,
              label: this.progressLabel,
              expandable: this.runningProcessId().length > 0,
              onTap: () => {
                this.toggleRunningProcess();
              }
            })
          }
          .width('100%')
          .padding({ left: 20, right: 20 })
        }
      }
      .id('conversation-list')
      .width('100%')
      .height('100%')
      .cachedCount(8)
      .scrollBar(BarState.Off)
      .contentEndOffset(12)
      .onScrollStart(() => {
        this.autoStick = false;
      })
      .onReachEnd(() => {
        this.autoStick = true;
      })

      if (!this.autoStick && this.entries.length > 0) {
        // 回到底部：居中圆形按钮，结构与「返回」按钮（NavBackButton）完全一致——
        // 外层 1.3vp 白色光圈包住 37.4 玻璃圆盘（背景模糊 + 半透明底色 + 0.5 细边），再加轻微悬浮投影。
        Row() {
          Stack({ alignContent: Alignment.Center }) {
            // 运行中：玻璃盘外圈叠一段蓝色弧（对齐小程序 .jump-ring）
            if (this.running) {
              Circle()
                .width(30)
                .height(30)
                .fill(Color.Transparent)
                .stroke('#2E6BE6')
                .strokeWidth(1.5)
                .strokeDashArray([24, 60])
            }
            Button({ type: ButtonType.Circle }) {
              // 向下箭头：右 + 下 1.8vp 描边旋转 45°（与返回箭头同一套画法）
              Row()
                .width(8)
                .height(8)
                .border({
                  width: { right: 1.8, bottom: 1.8 },
                  color: this.isDark ? 'rgba(255,255,255,0.86)' : 'rgba(16,19,24,0.72)'
                })
                .rotate({ angle: 45 })
                .translate({ y: -1.5 })
            }
            .width(37.4)
            .height(37.4)
            // 与返回按钮同款玻璃：半透明底色 + 背景模糊 + 0.5 内缘细边
            .backgroundColor(this.isDark ? 'rgba(8,8,10,0.60)' : 'rgba(255,255,255,0.80)')
            .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
            .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)' })
            .onClick(() => {
              this.autoStick = true;
              this.scroller.scrollEdge(Edge.Bottom);
            })
          }
          .width(40)
          .height(40)
          .borderRadius(20)
          // 光圈：1.3vp 实色白环，与返回按钮、输入框卡片同厚度
          .padding(1.3)
          .backgroundColor(this.isDark ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.96)')
          .shadow({ radius: 6, color: this.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(16,19,24,0.12)', offsetX: 0, offsetY: 2 })
        }
        .width('100%')
        .padding({ bottom: 10 })
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
  }

  /** 更多菜单：会话设置 + 任务面板（排队/轨迹/上下文/编队/文件仍走 pages/SessionPage）。 */
  @Builder
  moreMenu() {
    Menu() {
      MenuItem({ content: '会话设置' }).id('menu-session-settings').onClick(() => {
        this.pageStack.pushPathByName('session-settings', null);
      })
      MenuItem({ content: '任务面板' }).id('menu-session-tools').onClick(() => {
        this.pageStack.pushPathByName('session-tools', null);
      })
    }
  }

  /** 切换会话底部面板。 */
  @Builder
  sessionPicker() {
    // 不再用全屏遮罩：面板直接叠在输入框上方，输入框保持可见可点
    Column() {
        Row() {
          Text('切换会话').fontSize(17).fontWeight(FontWeight.Medium).fontColor(this.textColor())
          Blank()
          Text('关闭').fontSize(14).fontColor(this.subColor())
            .onClick(() => {
              this.sessionPickerOpen = false;
            })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })

        List({ space: 2 }) {
          ForEach(this.sessions, (session: SessionSummary) => {
            ListItem() {
              Row({ space: 10 }) {
                Circle({ width: 7, height: 7 }).fill(session.running ? '#2EB85C' : this.subColor())
                Text(session.title.length > 0 ? session.title : session.id.substring(0, 8))
                  .fontSize(15)
                  .fontColor(this.textColor())
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                if (session.id === SessionStore.get().currentSessionId()) {
                  Text('当前').fontSize(12).fontColor('#2E6BE6')
                }
              }
              .width('100%')
              .height(48)
              .padding({ left: 16, right: 16 })
              .onClick(() => {
                this.openSession(session.id);
                this.sessionPickerOpen = false;
              })
            }
          }, (session: SessionSummary) => session.id + '|' + (session.running ? '1' : '0') + '|' + session.title)
        }
        .width('100%')
        .height(360)
        .scrollBar(BarState.Off)
    }
    .width('100%')
    .padding({ top: 8, bottom: 8 })
    .borderRadius(18)
    .backgroundColor(this.surfaceColor())
    .border({ width: 0.5, color: this.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(16,19,24,0.08)' })
    .shadow({ radius: 20, color: this.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.12)', offsetY: 6 })
    .margin({ left: 12, right: 12, bottom: 8 })
  }
}
