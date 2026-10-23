const { t: uiText } = require('../../utils/ui-preferences');
const scheduleUtil = require('../../utils/schedule');
const haptics = require('../../utils/haptics');
const preferences = require('../../utils/ui-preferences');
const trajectoryView = require('../../utils/trajectory-presentation');
const contextView = require('../../utils/context-view');
const turnUsageUtil = require('../../utils/turn-usage');
const workSteps = require('../../utils/work-step-presentation');
const statusAppearance = require('../../utils/status-appearance');
const procIconStyle = require('../../utils/proc-icon-style');
const store = require('../../utils/store');
const markdown = require('../../utils/markdown');
const labels = require('../../utils/labels');
const util = require('../../utils/util');
const notifySubscription = require('../../utils/notify-subscription');
const voicePreference = require('../../utils/voice-preference');
const contextPanelsPreference = require('../../utils/context-panels-pref');
const voiceActions = require('./voice-actions');
const publicAccessPrompt = require('../../utils/public-access-prompt');
const fileActions = require('./file-actions');
const changesActions = require('./changes-actions');
const viewportActions = require('./viewport-actions');
const collaboration = require('../../utils/collaboration');
const protocol = require('../../utils/protocol');
const fileDeliverables = require('../../utils/file-deliverables');
const theme = require('../../utils/theme');
const conversationWorkflow = require('../../utils/conversation-workflow');
const composerMenu = require('../../utils/composer-menu');
const sessionSwitcher = require('../../utils/session-switcher');
const attachmentCache = require('../../utils/attachment-cache');
const { dataPatch, createMarkdownCache } = require('../../utils/session-render');

const { toolPresentation } = require('../../utils/tool-presentation');

Page({
  ...viewportActions,
  ...voiceActions,
  ...fileActions,
  ...changesActions,
  data: {
    publicAccessDialog: null,
    publicAccessDialogOpen: false,
    turnUsageSheet: null, turnUsageOpen: false, turnUsagePos: null,
    // ctx-flow 连接线：用原生 view 线段拼成曲线，避免小程序内联 SVG 不渲染。
    contextFlowLinks: [], contextFlowW: 0, contextFlowH: 0,
    collaborationOpen: false, collaborationExpanded: false, collaborationTab: 'members', collaborationRows: [], collaborationTabs: [],
    collaborationCount: 0, collaborationActive: 0, collaborationNote: '', collaborationPreview: null, collaborationBusy: false,
    fileExpanded: {}, fileSheet: null, filePreview: null, changesDiff: null, fileBusyKey: '', fileSharingKey: '', fileProgress: 0,
    tab: 'conversation', // conversation | trajectory | context | fleet
    showContextPanel: contextPanelsPreference.read().context,
    showFleetPanel: contextPanelsPreference.read().fleet,
    trajectoryMounted: false,
    contextMounted: false,
    fleetMounted: false,
    // 上下文浏览器（v2）：所选请求 seq（null = 当前/下一次请求）与展开的 7 类折叠行。
    contextBrowserSeq: null,
    contextBrowserIsCurrent: false,
    contextBrowserExpanded: [],
    contextFileFilter: 'all',
    contextFileSort: 'activity',
    contextNodeDetail: null,
    contextNodeLoadingSeq: null,
    // 趋势默认自动聚合；用户可切换粒度、总量/变化视图并选中单次请求。
    contextTrendSeq: null,
    contextTrendGroupBy: 'auto',
    contextTrendDisplayMode: 'total',
    contextTrendAdaptive: false,
    contextTrendShowDuration: true,
    contextTrendVisibleRange: null,
    // DNA 模式与总览是互斥的两个面向；默认都关（标准堆叠柱）。
    contextTrendDna: false,
    contextTrendOverview: false,
    // 轮次条聚焦（dsh-context 的 activeTurn）：点亮一轮并淡出其余柱。
    contextTrendActiveTurn: null,
    contextTrendTurnLeft: 0,
    // 首帧之前先用「未连接」空态占位，避免 WXML 读取 null 面板。
    contextPanel: contextView.buildPanel(null, { t: uiText, connected: false, hasSession: false }),
    fleetPanel: contextView.buildFleetPanel(null, { t: uiText, connected: false, hasSession: false }),
    conversationTopSpace: 0, conversationBottomSpace: 0, conversationScrollTop: 0,
    navTitle: uiText('会话'),
    sessionSwitcherOpen: false,
    sessionSwitcherExpanded: false,
    sessionSwitcherHeight: 60,
    sessionSwitcherQuery: '',
    sessionSwitcherSearchOpen: false,
    sessionSwitcherItems: [],
    navPadTop: 48,      // 自定义导航：状态栏下沿前的顶部偏移
    navHeight: 32,      // 与右上角原生胶囊同高
    navMoreRight: 100,  // 右侧胶囊避让宽度
    navbarStyle: 'padding-top:48px;height:80px;padding-right:100px;',
    conversationStyle: 'padding-bottom:0;margin-bottom:520rpx;',
    conversationInnerStyle: 'min-height:100%;',
    trajectoryStyle: '',
    dockStyle: '',
    presetLabel: '',
    running: false,
    rows: [],
    trajectory: [],
    traceOverview: trajectoryView.overview([]), traceScrollTarget: '', traceHighlightedKey: '', traceThinkingExpanded: false,
    traceDetailTab: 'summary', traceDetailTabs: [], traceDetailSection: null,
    folds: {},
    scrollTarget: '',
    scrollAnim: false,
    turnNavOpen: false,
    turnNavItems: [],
    turnNavPreview: null,
    turnNavActiveIndex: -1,
    turnNavScrollTop: 0,
    turnNavWidths: [],
    turnNavRowStyles: [],
    turnNavSpacerPx: 0,
    turnNavCardTop: 0,
    hasMoreHistory: false,

    question: null,
    questionBusy: false,
    approval: null,
    approvalBusy: false,

    draft: '',
    images: [],
    canSend: false,
    composerFocused: false,
    canAttach: true,
    attachSheetOpen: false,
    commandMenuQuery: '', commandPaletteLoading: false, commandPaletteError: '',
    attachmentPicking: false, sendingAttachments: false, fileReferenceMode: false,
    permissionLabel: uiText('工作区写入'),
    permissionIcon: 'shield-write-gray.png',
    modelLabel: 'DeepSeek',
    effortLabel: 'High',
    contextPct: -1,
    runPhrase: '',
    copiedKey: '',
    showJump: false,
    histError: '',
    historyLoading: false,
    historyLoaded: false,
    historyProgressText: '',
    historyState: 'idle',
    connState: 'disconnected',
    kbHeight: 0,
    permissionSheet: [],
    modeSheet: [],
    modelSheetOpen: false,
    modelMenuPane: 'root', modelBadge: '',
    modelGroups: [],
    effortSheetOpen: false,
    effortSheet: [],
    queue: [],
    queueSending: false,
    queueExpanded: false,
    queueBusyId: '',
    tasks: null,
    taskSummary: '',
    tasksExpanded: false,
    goal: null,
    goalBusy: false,
    commandMenu: null,
    commandLoading: false,
    commandError: '',
    ...voicePreference.view(),
    voicePhase: 'idle', voiceOverlayVisible: false, voiceCancelArmed: false, voiceStatus: '',
    voiceTyping: false, composerFocus: false, voicePendingText: '',
    convBottomInset: 520,   // 首帧安全默认值：真实高度由 dock 测量校准
    statsSheet: [],
    moreSheetOpen: false,
    morePane: 'menu',   // menu | rename | stats | files：都在同一个「更多」弹层内切换
    moreSheetExpanded: false,
    filesSheetOpen: false,
    filesEntries: [],
    filesLoading: false,
    filesError: '',
    filesPathLabel: '',
    filesIsRoot: true,
    filesSheetExpanded: false,
    renameValue: '',
    renameKeyboard: 0,
    confirmSheet: '',
    statsPopOpen: false,
    statsPopKind: 'run',
    statsPopTitle: '',
    statsPopTotal: '',
    statsPopRows: [],
    runSeconds: 0,
    runElapsedText: '',
    runHeader: '',
    contextSheet: null,
    showContextSheet: false,

    stats: {
      turns: 0,
      steps: 0,
      durationLabel: '0.00 s',
      inputPct: 0,
      modelPct: 0,
      toolsPct: 0
    },
    statsLabel: '',
    composerMetricsVisible: false,
    composerRunMetric: '',
    composerTokenMetric: '',
    composerCacheMetric: '',
    composerContextMetric: '',

    traceDetail: null
  },

  onLoad(options) {
    theme.applyTo(this);
    this.setData(statusAppearance.view(statusAppearance.read()));
    this.setData(procIconStyle.view(procIconStyle.read()));
    this._sessionDrafts = {};
    this.sessionId = options.id || store.sessionState.sessionId;
    this._pendingQueue = [];
    if (options.id && store.sessionState.sessionId !== options.id) {
      store.openSession(options.id, '', null);
    }
    this.folds = {};
    // 自定义导航：会话标题顶到状态栏下方；右侧避让胶囊按钮
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const sbH = info.statusBarHeight || 44;
      const winW = info.windowWidth || 375;
      let rect = null;
      try {
        rect = typeof wx.getMenuButtonBoundingClientRect === 'function'
          ? wx.getMenuButtonBoundingClientRect() : null;
      } catch (e2) { rect = null; }
      this.viewportRpx = winW * 2;
      this.setData({
        navPadTop: rect && rect.top ? rect.top : sbH + 7,
        navHeight: rect && rect.height ? rect.height : 32,
        navMoreRight: rect && rect.left ? Math.max(Math.round(winW - rect.left) + 8, 96) : 100
      });
    } catch (e) {
      this.setData({ navPadTop: 48, navHeight: 32, navMoreRight: 100 });
    }
    this.syncLayoutStyles();
    this.unsubscribe = store.subscribe((snapshot) => {
      this.scheduleStoreSync(snapshot);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  onReady() {
    // 首帧渲染完成后立即测量 dock，避免默认留白遮挡底部内容
    this.updateDockInset();
    this.refreshBottomAnchor();
    this.startScrollPolling();
  },

  onHide() {
    if (store.setTrajectoryActive) store.setTrajectoryActive(false);
    if (store.setContextActive) store.setContextActive(false);
    if (store.setFleetActive) store.setFleetActive(false);
    if (this.data.commandMenu) this.closeAttachMenu();
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({ collaborationOpen:false, collaborationPreview:null, collaborationBusy:false });
    this.cancelFileDownload();
    this._voiceHidden = true; this.cancelVoice();
    if (this._historyFormatTimer) clearTimeout(this._historyFormatTimer);
    this._historyFormatTimer = null;
    if (this._storeSyncTimer) clearTimeout(this._storeSyncTimer);
    this._storeSyncTimer = null; this._pendingStoreSnapshot = null;
    this.stopScrollPolling();
    // 记录本次隐藏的原因：原生选择器/预览浮层会把小程序切到后台，
    // 此时 onShow 不是「页面切换」，不能重置滚动、也不能强制整页重投影。
    this._hiddenByNativeOverlay = !!(store.nativeOverlayActive && store.nativeOverlayActive());
  },

  onShow() {
    this.syncContextPanelPreferences();
    this._voiceHidden = false; this.syncVoicePreference();
    // 从原生浮层（chooseMedia / chooseMessageFile / previewImage）返回：
    // 页面并未真正切换，强制 syncFromStore 与 resetConversationScroll 会让
    // 会话区闪一下并把滚动位置拽走。数据更新交给 subscribe 流推进即可。
    if (this._hiddenByNativeOverlay) {
      this._hiddenByNativeOverlay = false;
      this.startScrollPolling();
      this.setData(statusAppearance.view(statusAppearance.read()));
      this.setData(procIconStyle.view(procIconStyle.read()));
      this.updateDockInset();
      return;
    }
    this.resetConversationScroll();
    this.startScrollPolling();
    if (store.sessionState && store.sessionState.sessionId) this.syncFromStore({ app: store.state, session: store.sessionState });
    this.refreshBottomAnchor();
    this.setData(statusAppearance.view(statusAppearance.read()));
    this.setData(procIconStyle.view(procIconStyle.read()));
    // 返回前台/切回页面：dock 高度可能变化（键盘、队列、审批卡）
    this.updateDockInset();
  },

  onPublicAccessDialogConfirm() { publicAccessPrompt.resolvePublicAccessDialog(this); },

  onUnload() {
    this.stopContextFlow();
    if (store.setTrajectoryActive) store.setTrajectoryActive(false);
    if (store.setContextActive) store.setContextActive(false);
    if (store.setFleetActive) store.setFleetActive(false);
    this._commandRequest = null; this._commandOptionRequest = null; this._attachmentRequest = null; this._filesRequest = null;
    this._collaborationRequest = null;
    this._collaborationRefresh = null;
    this.disposePresentedFiles();
    this.cancelVoice();
    if (this._voice) this._voice.dispose();
    this._unloaded = true;
    if (this._historyFormatTimer) clearTimeout(this._historyFormatTimer);
    this._historyFormatTimer = null; this._pendingHistoryFormat = null;
    if (this._thumbTimer) clearTimeout(this._thumbTimer);
    this._thumbTimer = null; this._thumbQueue = null; this._thumbQueued = null; this._thumbFailed = null;
    if (this._storeSyncTimer) clearTimeout(this._storeSyncTimer);
    this._storeSyncTimer = null;
    this._pendingStoreSnapshot = null;
    if (this._traceHighlightTimer) clearTimeout(this._traceHighlightTimer);
    this._markdownCache = null;
    this._traceRows = null;
    this._traceByKey = null;
    this._traceSource = null;
    this._traceCache = null;
    this.stopScrollPolling();
    if (this._runTimer) { clearInterval(this._runTimer); this._runTimer = null; }
    this._dockMeasurePending = false;
    if (this.unsubscribe) this.unsubscribe();
  },

  // ---------- 状态同步 ----------

  scheduleHistoryFormatting() {
    if (this._historyFormatTimer || this._voiceHidden || this._unloaded || !this._pendingHistoryFormat || !this._pendingHistoryFormat.size) return;
    const sessionId = this._renderSessionId;
    this._historyFormatTimer = setTimeout(() => {
      this._historyFormatTimer = null;
      if (this._voiceHidden || this._unloaded || sessionId !== this._renderSessionId) return;
      if (this._turnScrubbing || Date.now() < (this._interactionUntil || 0)) { this.scheduleHistoryFormatting(); return; }
      const indices = new Map((this.data.rows || []).map((row, index) => [row.key, index]));
      const patch = {}, started = Date.now();
      let count = 0;
      for (const [key, text] of this._pendingHistoryFormat) {
        if (!indices.has(key)) continue;
        this._pendingHistoryFormat.delete(key);
        const index = indices.get(key), row = this.data.rows[index];
        if (row && row.kind === 'assistant' && row.text === text) {
          const blocks = this._markdownCache.parse(key, text);
          patch['rows[' + index + '].blocks'] = blocks;
          const source = (this._conversationRows || []).find(item => item.key === key);
          if (source) source.blocks = blocks;
        }
        if (++count >= 4 || Date.now() - started >= 8) break;
      }
      if (Object.keys(patch).length) this.setData(patch, () => {
        this.measureConversationWindow();
        if (!this._unloaded && !this._voiceHidden && sessionId === this._renderSessionId && this._convPinned !== false) this.refreshBottomAnchor();
      });
      if ([...this._pendingHistoryFormat.keys()].some(key => indices.has(key))) this.scheduleHistoryFormatting();
    }, 32);
  },

  scheduleStoreSync(snapshot) {
    if (this._unloaded || this._voiceHidden) return;
    this._pendingStoreSnapshot = snapshot;
    if (this._storeSyncTimer) return;
    const delay = Math.max(32, (this._interactionUntil || 0) - Date.now());
    this._storeSyncTimer = setTimeout(() => {
      this._storeSyncTimer = null;
      const latest = this._pendingStoreSnapshot;
      if (this._turnScrubbing && latest && !this._unloaded && !this._voiceHidden) {
        this._interactionUntil = Date.now() + 100;
        this.scheduleStoreSync(latest);
        return;
      }
      this._pendingStoreSnapshot = null;
      if (!this._unloaded && !this._voiceHidden && latest) this.syncFromStore(latest);
    }, delay);
  },

  prioritizeInteraction(duration = 160) {
    // Let the tap and 160ms sheet transition paint before the next stream projection.
    // Only snapshots are coalesced; the store still receives every protocol event.
    this._interactionUntil = Date.now() + duration;
    if (this._storeSyncTimer) clearTimeout(this._storeSyncTimer);
    this._storeSyncTimer = null;
    if (this._pendingStoreSnapshot) this.scheduleStoreSync(this._pendingStoreSnapshot);
  },

  syncFromStore(snapshot) {
    try {
      this.syncFromStoreInner(snapshot);
    } catch (e) {
      // 视图层任何意外错误都不允许冻结整页：至少保住运行状态与原始文本行
      try {
        const s = snapshot.session || {};
        const fallbackRows = (s.rows || []).map((row) => ({
          key: row.key,
          kind: row.kind === 'assistant' ? 'assistant' : (row.kind === 'user' ? 'user' : 'process'),
          title: row.title || '',
          text: row.text || '',
          blocks: [],
          images: this.decorateRowImages(row.images)
        }));
        this.setData({ rows: fallbackRows, running: s.running === true });
      } catch (e2) { /* 放弃 */ }
    }
  },

  syncFromStoreInner(snapshot) {
    this.checkVoiceContext();
    if (this._composerContextKey && this._composerContextKey !== this.composerContextKey()) {
      this._commandRequest = null; this._commandOptionRequest = null; this._attachmentRequest = null;
      this._filesRequest = null;
      this._collaborationRequest = null;
      this._collaborationRefresh = null;
      this._commandOptionName = ''; this._commandOptions = [];
      this.setData({ attachSheetOpen: false, commandMenu: null, commandMenuQuery: '', commandPaletteLoading: false, commandPaletteError: '', attachmentPicking: false });
      if (this.data.fileReferenceMode) this.closeFilesSheet();
    }
    this._composerContextKey = this.composerContextKey();
    const s = snapshot.session;
    const app = snapshot.app;
    if (!s || (!s.sessionId && s.historyState !== 'creating' && s.historyState !== 'error:create')) return;
    const sessionChanged = this._renderSessionId !== s.sessionId;
    if (sessionChanged) {
      this.resetConversationScroll();
      // 切会话：浏览器游标/折叠状态属于上一个会话，清空并从「当前」重新开始。
      this._contextPanelCache = null;
      this._fleetPanelCache = null;
      this._contextContentCache = Object.create(null);
      this._contextContentPending = Object.create(null);
      this.setData({
        contextBrowserSeq: null,
        contextBrowserIsCurrent: false,
        contextBrowserExpanded: [],
        contextFileFilter: 'all',
        contextFileSort: 'activity',
        contextNodeDetail: null,
        contextNodeLoadingSeq: null,
        contextTrendSeq: null,
        contextTrendGroupBy: 'auto',
        contextTrendDisplayMode: 'total',
        contextTrendAdaptive: false,
        contextTrendVisibleRange: null
      });
    }
    if (!this._markdownCache || this._renderSessionId !== s.sessionId) {
      if (this._renderSessionId && this._renderSessionId !== s.sessionId) {
        this._sessionDrafts = this._sessionDrafts || {};
        this._sessionDrafts[this._renderSessionId] = {
          draft: this.data.draft || '',
          images: Array.isArray(this.data.images) ? this.data.images.slice() : []
        };
        const savedDraft = this._sessionDrafts[s.sessionId] || { draft: '', images: [] };
        this.setData({
          draft: savedDraft.draft,
          images: savedDraft.images,
          canSend: !!String(savedDraft.draft || '').trim() || savedDraft.images.length > 0,
          composerFocused: false,
          composerFocus: false,
          kbHeight: 0
        });
        this._collaborationRequest = null; this._collaborationRefresh = null;
        this.setData({ collaborationOpen:false, collaborationPreview:null, collaborationRows:[], collaborationBusy:false });
        this.disposePresentedFiles();
        this.closeChangesDiff();
        this.setData({ fileSheet: null, filePreview: null, fileExpanded: {} });
      }
      this._markdownCache = createMarkdownCache(safeParse);
      if (this._historyFormatTimer) clearTimeout(this._historyFormatTimer);
      this._historyFormatTimer = null;
      this._pendingHistoryFormat = new Map();
      this._renderSessionId = s.sessionId;
      this._processRunningDone = '';
      this._lastRunSeconds = 0;
      this._processRunning = false;
    }
    this._markdownCache.retain((s.rows || []).filter(row => row.kind === 'assistant').map(row => row.key));

    // dsh-mobile 同款两段投影：protocol 只产生语义行，conversation-workflow
    // 再组合成 message / processGroup 展示节点。页面不再直接解释事件协议。
    const previewOf = (text) => {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      return t.length > 40 ? t.slice(0, 40) + '…' : t;
    };
    const processRunning = s.running === true;
    if (processRunning && this._processRunning !== true) {
      this._processRunningDone = '';
      this._lastRunSeconds = 0;
    }
    // 运行→结束的瞬间锁定本次用时（之后 runStartMs 会被下一轮重置，不能再用）
    const justFinished = this._processRunning === true && !processRunning;
    if (justFinished) {
      const clockSeconds = s.runStartMs ? Math.max(1, Math.round((Date.now() - s.runStartMs) / 1000)) : 0;
      this._lastRunSeconds = Math.max(1, this.data.runSeconds || 0, clockSeconds);
      const lastProcessRow = (s.rows || []).slice().reverse().find((row) =>
        row && (row.kind === 'context' || row.kind === 'reasoning' || row.kind === 'tool'
          || row.kind === 'toolResult' || row.kind === 'status'
          || (row.kind === 'assistant' && ((row.reasoning || '').trim() || (row.tools || []).length)))
      );
      this._processRunningDone = lastProcessRow ? lastProcessRow.key : '';
    }
    const semanticRows = [];
    const listedSession = (app.sessions || []).find(item => item.id === s.sessionId || item.sessionId === s.sessionId);
    (s.rows || []).forEach((row, rowIndex) => {
      if (row.kind === 'changes') {
        const changes = this.decorateChanges(row);
        if (changes) semanticRows.push(changes);
        return;
      }
      if (row.kind === 'files') {
        semanticRows.push(Object.assign({}, row, { files: row.files.map(fileDeliverables.describe) }));
        return;
      }
      if (row.kind === 'assistant') {
        const text = row.text || '';
        let blocks = this._markdownCache.peek(row.key, text);
        if (!blocks && rowIndex >= s.rows.length - 12) blocks = this._markdownCache.parse(row.key, text);
        if (!blocks) this._pendingHistoryFormat.set(row.key, text);
        else this._pendingHistoryFormat.delete(row.key);
        const tools = (row.tools || []).map((tool) => {
          const activity = toolPresentation(tool.name, tool.argumentsText, s.cwd || (listedSession && listedSession.cwd));
          return Object.assign({}, tool, {
            actLabel: activity.label,
            isCommand: activity.isCommand,
            commandText: activity.commandText,
            commandLines: activity.commandLines,
            cwdLabel: activity.cwdLabel,
            actDetail: activity.detail,
            statusText: tool.isError ? uiText('失败') : (tool.status === 'done' ? '' : tool.phase === 'preparing' ? uiText('正在准备…') : uiText('运行中'))
          });
        });
        semanticRows.push(Object.assign({}, row, {
          blocks: blocks || [],
          images: this.decorateRowImages(row.images),
          copyText: row.text || '',
          tools: tools
        }));
        return;
      }
      // 空内容行不渲染（映射未覆盖的事件形态不产生"圆点"空气泡）
      if (row.kind === 'user' && !(row.text || '').trim() && !(row.images || []).length) return;
      if (row.kind === 'context' && !(row.text || '').trim()) return;
      const copy = Object.assign({}, row);
      if (row.kind === 'context') {
        copy.preview = previewOf(row.text);
        copy.title = row.title || uiText('上下文');
      }
      if (row.kind === 'user') {
        copy.images = this.decorateRowImages(row.images);
        const availableWidth = Math.max(192, (this.viewportRpx || 750) - 148);
        const visibleCount = Math.min(copy.images.length, 3);
        const side = Math.min(328, Math.max(192, availableWidth - 24 * (visibleCount - 1)));
        copy.stackImages = copy.images.slice(0, visibleCount).map((img, i) => Object.assign({}, img, {
          side: side,
          left: 24 * i,
          top: 24 * (visibleCount - 1 - i),
          z: visibleCount - i,
          style: 'left:' + (24 * i) + 'rpx;top:' + (24 * (visibleCount - 1 - i))
            + 'rpx;width:' + side + 'rpx;height:' + side + 'rpx;z-index:' + (visibleCount - i) + ';'
        }));
        copy.stackWidth = side + 24 * (visibleCount - 1);
        copy.stackHeight = side + 24 * (visibleCount - 1);
        copy.stackBadgeRight = 102 + 24 * (visibleCount - 1);
        copy.stackStyle = 'width:' + copy.stackWidth + 'rpx;height:' + copy.stackHeight + 'rpx;';
        copy.stackBadgeStyle = 'right:' + copy.stackBadgeRight + 'rpx;';
        const firstImage = copy.images[0] || {};
        const sourceWidth = Number(firstImage.width || firstImage.pixelWidth || firstImage.sourceWidth || 0);
        const sourceHeight = Number(firstImage.height || firstImage.pixelHeight || firstImage.sourceHeight || 0);
        if (sourceWidth > 0 && sourceHeight > 0) {
          const scale = Math.min(1, 640 / sourceWidth, 640 / sourceHeight, availableWidth / sourceWidth);
          copy.singleWidth = Math.max(1, Math.floor(sourceWidth * scale));
          copy.singleHeight = Math.max(1, Math.floor(sourceHeight * scale));
        } else {
          copy.singleWidth = Math.min(640, availableWidth);
          copy.singleHeight = copy.singleWidth;
        }
        copy.singleStyle = 'width:' + copy.singleWidth + 'rpx;height:' + copy.singleHeight + 'rpx;';
      }
      semanticRows.push(copy);
    });
    const rows = conversationWorkflow.buildEntries(semanticRows, {
      running: processRunning,
      completedEntryKey: this._processRunningDone || '',
      lastDurationMs: (this._lastRunSeconds || 0) * 1000
    });
    rows.forEach((entry) => {
      if (entry.kind === 'assistant') entry.copyText = entry.showCopy ? entry.text || '' : '';
      if (entry.kind === 'user') entry.copyText = entry.showCopy ? entry.text || '' : '';
    });

    this._traceRows = s.trajectory || [];
    // 两页提前投影并保持挂载，点击/横滑时只切可见性，不现场解析历史。
    const tracePatch = this.data.tab === 'trajectory' ? this.trajectoryPatch() : {};

    const stats = s.stats && s.stats.stats ? s.stats.stats : {};
    const llmMs = stats.llmMs || 0;
    const toolMs = stats.toolMs || 0;
    const totalMs = Math.max(llmMs + toolMs, 1);
    const turns = stats.turns || 0;
    const steps = stats.steps || 0;
    const durationSeconds = totalMs / 1000;
    const tokenUsage = (s.stats && s.stats.tokenUsage) || {};
    const tokenTotals = tokenUsage.totals || {};
    const pressure = (s.stats && s.stats.pressure) || null;
    const contextPct = pressure && pressure.contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round(((pressure.pressureTokens || 0) / pressure.contextWindow) * 100)))
      : -1;
    let decodeRate = stats.decodeMs > 0 && stats.decodeTokens != null
      ? Number(stats.decodeTokens) / (Number(stats.decodeMs) / 1000)
      : null;
    if (decodeRate == null && stats.decodeTokensPerSec != null) decodeRate = Number(stats.decodeTokensPerSec);
    if (decodeRate == null && tokenTotals.outputTokens && stats.llmMs) {
      decodeRate = Number(tokenTotals.outputTokens) / (Number(stats.llmMs) / 1000);
    }
    const tokenValues = [
      tokenTotals.inputTokens, tokenTotals.outputTokens,
      tokenTotals.cacheReadTokens, tokenTotals.cacheWriteTokens
    ].filter((value) => value != null).map(Number);
    const tokenTotalForCache = tokenValues.reduce((sum, value) => sum + value, 0);
    const uncachedInputForCache = tokenUsage.uncachedInputTokens != null
      ? Number(tokenUsage.uncachedInputTokens)
      : (tokenTotals.inputTokens != null ? Number(tokenTotals.inputTokens) : null);
    const cacheReadForCache = tokenUsage.cacheReadTokens != null
      ? Number(tokenUsage.cacheReadTokens)
      : (tokenTotals.cacheReadTokens != null ? Number(tokenTotals.cacheReadTokens) : null);
    const cacheHitBase = uncachedInputForCache != null && cacheReadForCache != null
      ? uncachedInputForCache + cacheReadForCache
      : tokenTotalForCache;
    const cacheHitPct = cacheHitBase > 0 && cacheReadForCache != null
      ? Math.round(Math.min(1, Math.max(0, cacheReadForCache / cacheHitBase)) * 100)
      : null;
    const compactMetricToken = (value) => {
      const n = Number(value || 0);
      if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(Math.round(n));
    };
    const hasStatsSnapshot = !!(s.stats && (s.stats.stats || s.stats.tokenUsage || s.stats.pressure));
    const composerRunMetric = hasStatsSnapshot
      ? (turns || 0) + uiText(' 轮 ') + (steps || 0) + uiText(' 步')
      : '';
    // Gateway 既可能返回 totals.inputTokens，也可能只返回分项 Token。
    // 底部指标必须在两种快照格式下都能显示，优先使用输入总量以保持 DSH 的含义。
    const finiteToken = (value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= 0 ? number : null;
    };
    const totalInputTokens = finiteToken(tokenTotals.inputTokens);
    const uncachedInputTokens = finiteToken(tokenUsage.uncachedInputTokens);
    const cacheReadTokens = finiteToken(
      tokenUsage.cacheReadTokens != null ? tokenUsage.cacheReadTokens : tokenTotals.cacheReadTokens
    );
    const outputTokens = finiteToken(
      tokenUsage.outputTokens != null ? tokenUsage.outputTokens : tokenTotals.outputTokens
    );
    const fallbackInputTokens = [uncachedInputTokens, cacheReadTokens]
      .filter((value) => value != null)
      .reduce((sum, value) => sum + value, 0);
    const composerTokenValue = totalInputTokens != null
      ? totalInputTokens
      : (fallbackInputTokens > 0 ? fallbackInputTokens : outputTokens);
    const composerTokenMetric = composerTokenValue != null
      ? compactMetricToken(composerTokenValue) + ' tok' : '';
    const tokenStatsAvailable = composerTokenValue != null
      || uncachedInputForCache != null || cacheReadForCache != null;
    const composerCacheMetric = tokenStatsAvailable
      ? uiText('缓存命中 ') + (cacheHitPct == null ? '—' : cacheHitPct + '%')
      : '';
    const composerContextMetric = contextPct >= 0 ? contextPct + '%' : '';

    const selection = s.selection || app.modelCatalog && app.modelCatalog.current || app.defaultModel;
    const modelFace = composerMenu.modelFace(app.modelCatalog, selection);
    const modelLabel = modelFace.label || uiText('模型');
    const effort = selection && selection.reasoningEffort
      ? labels.reasoningEffortName(selection.reasoningEffort)
      : (app.defaultModel && app.defaultModel.reasoningEffort
        ? labels.reasoningEffortName(app.defaultModel.reasoningEffort)
        : 'High');

    const prevQ = this.data.question;
    const question = s.pendingQuestion ? decorateQuestion(s.pendingQuestion, this.questionDraft || {}) : null;
    let qReset = null;
    if (question && (!prevQ || prevQ.rpcId !== question.rpcId)) qReset = { qIndex: 0, qCollapsed: false };
    if (!question && (this.data.qIndex || this.data.qCollapsed)) qReset = { qIndex: 0, qCollapsed: false };
    const approval = s.pendingApproval;
    const tasks = Array.isArray(s.tasks) ? s.tasks.map((task, index) => ({
      id: String(index),
      content: task.content || '',
      status: task.status || 'pending',
      icon: task.status === 'completed' ? 'check-green.png'
        : (task.status === 'in_progress' ? 'pinwheel-ink.png' : 'dotted-gray.png')
    })) : null;
    const taskCounts = (tasks || []).reduce((acc, task) => {
      if (task.status === 'completed') acc.completed += 1;
      else if (task.status === 'in_progress') acc.active += 1;
      else acc.pending += 1;
      return acc;
    }, { completed: 0, active: 0, pending: 0 });
    const taskSummary = [
      taskCounts.completed ? taskCounts.completed + uiText(' 已完成') : '',
      taskCounts.active ? taskCounts.active + uiText(' 进行中') : '',
      taskCounts.pending ? taskCounts.pending + uiText(' 待处理') : ''
    ].filter(Boolean).join(' · ');
    const goalPayload = s.goal && s.goal.goal ? s.goal : null;
    const goal = goalPayload ? {
      id: goalPayload.goal.id,
      revision: goalPayload.goal.revision,
      objective: goalPayload.goal.objective || '',
      phase: goalPayload.goal.phase || '',
      phaseLabel: goalPhaseLabel(goalPayload.goal.phase),
      active: goalPayload.goal.phase === 'active'
    } : null;

    // 会话级 Agent 预设胶囊（对齐 dsh-mobile v1.6.0）：
    // 预设目录已加载且会话未在运行时展示；运行中发送会锁定预设
    const presetsCatalog = store.state.agentPresets;
    // 对齐 iOS：模式胶囊仅新建会话（无消息）时展示，对话开始后隐藏
    const creatingLocal = !s.sessionId && s.historyState === 'creating';
    const presetVisible = !!(presetsCatalog && presetsCatalog.presets && presetsCatalog.presets.length
      && (s.sessionId || creatingLocal) && !s.running && !rows.length);
    const presetId = s.agentPreset || 'standard';
    const presetName = this.findPresetName(presetsCatalog, presetId);
    if (s.sessionId && presetVisible && !this._presetRequestedFor) {
      this._presetRequestedFor = s.sessionId;
      store.client.requestSessionAgentPreset(s.sessionId).catch(() => {});
    }
    if (this._presetRequestedFor && this._presetRequestedFor !== s.sessionId) {
      this._presetRequestedFor = s.sessionId;
      if (s.sessionId) store.client.requestSessionAgentPreset(s.sessionId).catch(() => {});
    }

    // 上下文用量弹窗数据（对齐 iOS ContextUsagePopover：占比 + 分项明细）
    const compactTok = (v) => {
      const n = Number(v) || 0;
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(n);
    };
    let contextRows = [];
    if (pressure && pressure.breakdown) {
      contextRows = [
        { label: uiText('系统提示词'), value: pressure.breakdown.systemTokens, cls: 'gray' },
        { label: uiText('工具定义'), value: pressure.breakdown.toolsTokens, cls: 'purple' },
        { label: uiText('对话消息'), value: pressure.breakdown.messageTokens, cls: 'ocean' }
      ].filter((r) => r.value != null);
    } else if (s.stats && s.stats.tokenUsage) {
      const u = s.stats.tokenUsage;
      contextRows = [
        { label: uiText('未缓存输入'), value: u.uncachedInputTokens, cls: 'ocean' },
        { label: uiText('缓存读取'), value: u.cacheReadTokens, cls: 'purple' },
        { label: uiText('模型输出'), value: u.outputTokens, cls: 'orange' }
      ].filter((r) => r.value != null);
    }
    contextRows = contextRows.map((r) => ({ label: r.label, cls: r.cls, valueLabel: compactTok(r.value) + ' tok' }));
    const contextSheet = pressure && pressure.contextWindow > 0 ? {
      pct: contextPct,
      barStyle: 'width:' + contextPct + '%;',
      usedLabel: '~' + compactTok(pressure.pressureTokens || 0),
      windowLabel: compactTok(pressure.contextWindow),
      rows: contextRows
    } : null;

    const workPrefs = workSteps.read();
    const policyKey = s.sessionId + '/' + workPrefs.mode + '/' + workPrefs.timing;
    const processFolds = workSteps.apply(rows, workPrefs, this.data.folds, this._conversationRows || this.data.rows, this._workPolicyKey !== policyKey);
    this._workPolicyKey = policyKey;
    this._processRunning = processRunning;

    // 复制按钮规则（对齐 iOS ConversationView）：用户消息恒显；
    // 助手消息仅当其后不再紧跟 assistant 会话行时显示（本轮末条）
    const convIdx = [];
    rows.forEach((r, i) => { if (r.kind === 'user' || r.kind === 'assistant') convIdx.push(i); });
    convIdx.forEach((idx, k) => {
      const row = rows[idx];
      if (row.kind !== 'assistant') return;
      const nextConv = k + 1 < convIdx.length ? rows[convIdx[k + 1]].kind : null;
      let copyText = nextConv === 'assistant' ? '' : (row.text || '');
      // 若本轮末尾紧跟文件/变更卡片，把复制按钮下沉到最后一张卡片下面
      if (copyText) {
        const end = k + 1 < convIdx.length ? convIdx[k + 1] : rows.length;
        let lastFileIdx = -1;
        for (let i = idx + 1; i < end; i += 1) {
          if (rows[i] && (rows[i].kind === 'files' || rows[i].kind === 'changes')) lastFileIdx = i;
        }
        if (lastFileIdx >= 0) {
          rows[lastFileIdx].copyText = copyText;
          rows[lastFileIdx].copyKey = row.key;
          rows[lastFileIdx].usageTokens = row.usageTokens;
          rows[lastFileIdx].usageDetail = row.usageDetail;
          rows[lastFileIdx].durationMs = row.durationMs;
          rows[lastFileIdx].finishedAtMs = row.finishedAtMs;
          copyText = '';
        }
      }
      row.copyText = copyText;
    });

    // 每轮底部信息：本轮 token 用量 + 耗时（与复制按钮同一行，靠右）
    const compactTokens = (value) => {
      const n = Number(value) || 0;
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    };
    const compactDuration = (ms) => {
      const n = Number(ms) || 0;
      if (n >= 60000) return Math.floor(n / 60000) + 'm ' + Math.round((n % 60000) / 1000) + 's';
      if (n >= 1000) return Math.round(n / 1000) + 's';
      return n > 0 ? Math.round(n) + 'ms' : '';
    };
    // 每轮精确用量：直接使用 DSH deriveTurnTokenUsage 的折叠结果
    const turnUsageMap = (s && s.turnUsage) || {};
    rows.forEach((row) => {
      if (row.turn === undefined || row.turn === null) return;
      const usage = turnUsageMap[row.turn];
      if (usage) row.turnUsage = usage;
    });
    const clockLabel = (ms) => {
      const value = Number(ms) || 0;
      if (!value) return '';
      const date = new Date(value);
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    };
    rows.forEach((row) => {
      if (!row.copyText) return;
      const usage = row.turnUsage || (row.copyKey && (rows.find((item) => item.key === row.copyKey) || {}).turnUsage) || null;
      row.turnUsage = usage || null;
      row.turnMetaText = usage ? (uiText('用量') + ' ' + turnUsageUtil.compact(usage.totalTokens) + ' tok') : '';
      row.turnTimeText = clockLabel(row.finishedAtMs) || compactDuration(row.durationMs);
      row.turnMetaKey = row.copyKey || row.key;
    });

    // 顶部标题：实时标题优先；其次回查会话列表（直连打开/列表迟到时）；
    // 都没有则显示「会话」（新会话等 Host 生成标题后经 title 帧实时更新）
    const listed = (app.sessions || []).find((x) => x.sessionId === s.sessionId) || null;
    const fallbackTitle = (listed && (listed.title || listed.snippet)) || (s.historyState === 'creating' ? uiText('新会话') : uiText('会话'));

    const viewPatch = dataPatch(this.data, Object.assign({
      ...this.collaborationPatch(s, app),
      ...this.contextPanelPatch(s, app),
      ...this.fleetPanelPatch(s, app),
      navTitle: s.title || fallbackTitle,
      presetLabel: labels.presetModeName(s.agentPreset || 'standard'),
      sessionPresetVisible: presetVisible,
      sessionPresetName: presetName || uiText('选择模式'),
      running: s.running === true,
      lastRowKind: rows.length ? rows[rows.length - 1].kind : '',
      ...this.conversationWindowPatch(rows),
      ...this.turnNavigatorPatch(rows),
      folds: processFolds,
      ...tracePatch,
      hasMoreHistory: s.hasMoreHistory,
      question: question,
      questionBusy: s.questionStatus === 'submitting' || s.questionStatus === 'accepted',
      approval: approval,
      approvalBusy: s.approvalStatus === 'submitting' || s.approvalStatus === 'accepted',
      tasks: tasks,
      taskSummary: taskSummary,
      goal: goal,
      goalBusy: !!s.goalMutation,
      commandLoading: s.commandLoading === true,
      commandError: s.commandError || '',
      permissionLabel: labels.permissionName(s.permission || 'workspace-write') || (s.permission || uiText('工作区写入')),
      permissionIcon: labels.permissionIconFile(s.permission || 'workspace-write'),
      modelLabel: modelLabel,
      modelBadge: modelFace.badge,
      effortLabel: effort,
      contextPct: contextPct,
      contextRingStyle: contextPct >= 0
        ? 'background:conic-gradient(var(--text-2) ' + contextPct + '%,var(--ring-track) 0);' : '',
      contextSheet: contextSheet,
      stats: {
        turns: turns,
        steps: steps,
        durationLabel: durationSeconds.toFixed(2) + ' s',
        inputPct: Math.min(100, Math.round((toolMs / totalMs) * 60 + 15)),
        modelPct: Math.min(100, Math.round((llmMs / totalMs) * 85 + 10)),
        toolsPct: Math.min(100, Math.round((toolMs / totalMs) * 95 + 5)),
        inputStyle: 'width:' + Math.min(100, Math.round((toolMs / totalMs) * 60 + 15)) + '%;',
        modelStyle: 'width:' + Math.min(100, Math.round((llmMs / totalMs) * 85 + 10)) + '%;',
        toolsStyle: 'width:' + Math.min(100, Math.round((toolMs / totalMs) * 95 + 5)) + '%;'
      },
      statsLabel: turns || steps ? (turns + uiText(' 轮 · ') + steps + uiText(' 步')) : ''
      ,composerMetricsVisible: !!(composerRunMetric || composerTokenMetric || composerCacheMetric || composerContextMetric)
      ,composerRunMetric: composerRunMetric
      ,composerTokenMetric: composerTokenMetric
      ,composerCacheMetric: composerCacheMetric
      ,composerContextMetric: composerContextMetric
    }, qReset || {}));
    const rowsChanged = Object.keys(viewPatch).some(key => key === 'rows' || key.indexOf('rows[') === 0);
    const dockChanged = ['running', 'question', 'approval', 'tasks', 'goal', 'composerMetricsVisible', 'sessionPresetVisible']
      .some(field => Object.keys(viewPatch).some(key => key === field || key.indexOf(field + '.') === 0 || key.indexOf(field + '[') === 0));
    if (Object.keys(viewPatch).length) this.setData(viewPatch, () => {
      this.scheduleHistoryFormatting();
      this.measureConversationWindow();
      if (this.data.tab === 'context') this.scheduleContextFlow();
    });
    else this.scheduleHistoryFormatting();
    // 会话行只有 attachmentId，图片需要异步回填本地缓存路径才会显示。
    this.scheduleAttachmentThumbs();
    this.loadChangesSummaries();
    this.syncCommandMenu(this.data.draft, s);
    if (dockChanged) this.updateDockInset();
    this.syncRunningStrip(rows, this.data.running);
    const he = store.sessionState.historyError || '';
    if (he !== this.data.histError) this.setData({ histError: he });
    const hs = String(s.historyState || 'idle');
    if (hs !== this.data.historyState) this.setData({ historyState: hs });
    const historyLoading = s.historyPaging === true || (hs === 'requested' && !rows.length && !this.data.running);
    const historyLoaded = hs.indexOf('loaded') === 0 || hs === 'idle' || hs.indexOf('error') === 0;
    const historyProgressText = he || uiText('正在从 Mobile Gateway 同步会话内容…');
    if (historyLoading !== this.data.historyLoading || historyLoaded !== this.data.historyLoaded
      || historyProgressText !== this.data.historyProgressText) {
      this.setData({
        historyLoading: historyLoading,
        historyLoaded: historyLoaded,
        historyProgressText: historyProgressText
      });
    }
    if (this.data.turnNavOpen) this.autoLoadTurnNavigatorHistory(null, true);
    const cs = app.connection || 'disconnected';
    if (cs !== this.data.connState) {
      this.setData({ connState: cs });
      // 断线期间的图片加载会失败；重连后清掉失败标记再试一次。
      if (cs === 'connected') { this._thumbFailed = null; this.scheduleAttachmentThumbs(); }
    }
    this.syncQueueDock();

    if (this.data._titleDirty) {
      this.setData({ _titleDirty: false });

    }

    // 新内容到达时贴底；但用户正在触摸列表时不要抢滚动
    const touchingRecently = Date.now() - (this._lastTouchAt || 0) < 1000;
    if ((sessionChanged || rowsChanged || justFinished) && this.data.tab === 'conversation' && this._convPinned !== false && !touchingRecently) {
      this.refreshBottomAnchor();
    }
  },

  // ---------- 导航 ----------

  /** 运行条（对齐 iOS deep-search-progress）：活动短语 + 用时秒数 */
  /** 过程组活标题：耗时 X · N 项上下文 · N 次工具调用（对齐 iOS 组头，随秒跳动） */
  buildRunHeader(rows, elapsed) {
    let ctx = 0;
    let tools = 0;
    (rows || []).forEach((r) => {
      if (r.kind === 'context') ctx += 1;
      if (r.tools && r.tools.length) tools += r.tools.length;
    });
    let head = uiText('耗时 ') + elapsed;
    if (ctx) head += ' · ' + ctx + uiText(' 项上下文');
    if (tools) head += ' · ' + tools + uiText(' 次工具调用');
    return head;
  },

  syncRunningStrip(rows, running) {
    if (!running) {
      this._lastRunSeconds = this.data.runSeconds || this._lastRunSeconds || 0;
      if (this._runTimer) { clearInterval(this._runTimer); this._runTimer = null; }
      if (this.data.runPhrase || this.data.runSeconds) {
        this.setData({ runPhrase: '', runSeconds: 0, runElapsedText: '', runHeader: '' });
      }
      return;
    }
    if (!this._runTimer) {
      // 起始时间 = 最近一条用户消息时间（对齐 iOS DeepSearchProgressRow）
      const s = store.sessionState;
      const lastUser = (rows || []).filter((r) => r.kind === 'user' && r.at).pop();
      this._runStart = (s && s.runStartMs) || (lastUser && lastUser.at) || Date.now();
      const phrase = this.runActivityPhrase();
      this.setData({
        runPhrase: phrase,
        runSeconds: 0,
        runElapsedText: uiText('0 秒'),
        runHeader: this.buildRunHeader(rows, uiText('0 秒'))
      });
      const self = this;
      this._runTimer = setInterval(() => {
        const sec = Math.max(0, Math.floor((Date.now() - self._runStart) / 1000));
        // iOS 文案为「用时 {N} 秒…」，N 恒为整秒
        const elapsed = sec + uiText(' 秒');
        self.setData({
          runSeconds: sec,
          runElapsedText: elapsed,
          runHeader: self.buildRunHeader(self.data.rows, elapsed),
          runPhrase: self.runActivityPhrase()
        });
      }, 1000);
    }
  },

  /** 短语轮换（对齐 dsh-mobile §3.4：30s 一桶；取 (起始Unix秒 + 桶序) % 词数） */
  runActivityPhrase() {
    const PHRASES = {
      thinking: [uiText('梳理脉络中'), uiText('推敲细节中'), uiText('酝酿下一步中'), uiText('沿着思路前行中')],
      gathering: [uiText('翻阅已有线索中'), uiText('收拢相关信息中'), uiText('寻找切入点中'), uiText('铺开问题脉络中')],
      exploring: [uiText('向外寻找线索中'), uiText('打捞新线索中'), uiText('沿途探查中'), uiText('搜集更多拼图中')],
      reviewing: [uiText('对照新发现中'), uiText('拼合新线索中'), uiText('检视所得中'), uiText('把发现串起来中')],
      revisiting: [uiText('回看已有线索中'), uiText('重新校准方向中'), uiText('再推敲一遍中'), uiText('换个角度审视中')],
      composing: [uiText('组织回应中'), uiText('整理表达中'), uiText('将思路落成文字中'), uiText('勾勒答案中')],
      working: [uiText('继续推进中'), uiText('稳步探索中'), uiText('梳理当前进展中'), uiText('逐步展开中')]
    };
    const INTERVAL = 30;
    const start = this._runStart || Date.now();
    const bucket = Math.floor(Math.max(0, Date.now() - start) / (INTERVAL * 1000));
    const cutoff = start + bucket * INTERVAL * 1000;
    const cues = (store.sessionState && store.sessionState.runCues) || [];
    let activity = 'thinking';
    let hasReasoned = false;
    let hasResult = false;
    let hasError = false;
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      if ((cue.at || 0) > cutoff) break;   // 仅统计截止时间前的线索
      switch (cue.activity) {
        case 'gathering': activity = 'gathering'; break;
        case 'exploring': activity = 'exploring'; break;
        case 'reviewing': activity = 'reviewing'; hasResult = true; break;
        case 'revisiting':
          activity = 'revisiting';
          hasError = true;
          break;
        case 'reasoning':
          // reasoning 且已有推理或已有结果 → revisiting
          activity = (hasReasoned || hasResult) ? 'revisiting' : 'thinking';
          hasReasoned = true;
          break;
        case 'composing': activity = 'composing'; break;
        case 'working': activity = 'working'; break;
        default:
      }
    }
    if (hasError) activity = 'revisiting';
    const options = PHRASES[activity] || PHRASES.thinking;
    return options[(Math.floor(start / 1000) + bucket) % options.length];
  },

  retryHistory() {
    if (!store.sessionState.sessionId) return;
    this.setData({ histError: '', historyLoading: true, historyLoaded: false });
    store.retryHistory();
  },

  retryCreate() {
    this.setData({ histError: '' });
    store.retryCreateSession();
  },

  toggleQueue() {
    this.setData({ queueExpanded: !this.data.queueExpanded });
  },

  toggleTasks() {
    this.setData({ tasksExpanded: !this.data.tasksExpanded });
    this.updateDockInset();
  },

  goalAction(e) {
    const action = e.currentTarget.dataset.action;
    const goal = this.data.goal;
    if (!goal || this.data.goalBusy) return;
    if (action === 'edit') {
      wx.showModal({
        title: uiText('编辑目标'),
        editable: true,
        placeholderText: goal.objective,
        success: (res) => {
          const objective = (res.content || '').trim();
          if (!res.confirm || !objective || objective === goal.objective) return;
          store.mutateGoal('goal-edit', objective).catch((err) => {
            wx.showToast({ title: err.message || uiText('编辑失败'), icon: 'none' });
          });
        }
      });
      return;
    }
    if (action === 'clear') {
      wx.showModal({
        title: uiText('清除目标'),
        content: uiText('清除后将停止当前目标的后续自动轮次。'),
        confirmText: uiText('清除'),
        confirmColor: '#E5484D',
        success: (res) => {
          if (res.confirm) store.mutateGoal('goal-clear').catch((err) => {
            wx.showToast({ title: err.message || uiText('清除失败'), icon: 'none' });
          });
        }
      });
      return;
    }
    const kind = goal.active ? 'goal-pause' : 'goal-resume';
    store.mutateGoal(kind).catch((err) => {
      wx.showToast({ title: err.message || uiText('操作失败'), icon: 'none' });
    });
  },

  queueAction(e) {
    const { id, action } = e.currentTarget.dataset;
    const s = store.sessionState;
    if (!s.sessionId || this.data.queueBusyId) return;
    const pending = this.pendingSubmission(id);
    if (pending) {
      // 本地排队项：编辑取回草稿、删除直接丢弃；发送箭头才真正发出去。
      if (action === 'edit') {
        const text = pending.rawText || pending.preview;
        const restored = (pending.stagedImages || []).concat((pending.workspaceRefs || []).map((ref) => ({
          id: util.uuid(),
          isFile: true,
          isWorkspaceRef: true,
          workspaceKind: ref.kind === 'directory' ? 'directory' : 'file',
          path: ref.path,
          name: ref.name
        })));
        const images = this.data.images.concat(restored).slice(0, 20);
        this.setData({
          draft: this.data.draft ? this.data.draft + '\n\n' + text : text,
          images: images,
          canSend: true
        });
        this.dropPendingSubmission(id);
        return;
      }
      if (action === 'remove') { this.dropPendingSubmission(id); return; }
      return this.releasePendingSubmission(pending);
    }
    if (action === 'edit') {
      const item = this.data.queue.find((q) => q.id === id);
      if (!item) return;
      if (item.editable === false) return;
      // 编辑：取回草稿（对齐 iOS：draft 空则直用，否则换行拼接）并从队列移除
      const text = item.rawText || item.preview;
      this.setData({
        draft: this.data.draft ? this.data.draft + '\n\n' + text : text
      });
    }
    this.setData({ queueBusyId: id + ':' + action });
    store.client.queueUpdate(s.sessionId, id, action === 'steer' ? 'steer' : 'remove');
    // 20s 兜底解锁（对齐 iOS 队列操作超时）
    if (this._queueTimer) clearTimeout(this._queueTimer);
    this._queueTimer = setTimeout(() => {
      this.setData({ queueBusyId: '' });
      if (s.sessionId) store.client.requestQueue(s.sessionId);
    }, 20000);
  },

  /** 队列 dock 数据源 = 网关队列 + 本地待发队列（尚未真正发出的消息）。 */
  syncQueueDock() {
    // DSH 的队列项是 UserMessage：正文在 content[] block 中，而不是顶层字符串。
    // Gateway 不同版本还可能包在 message/source/payload 下，统一在这里解包。
    const qContentOf = (it) => {
      const candidates = [it && it.content, it && it.message && it.message.content,
        it && it.source && it.source.content, it && it.payload && it.payload.content];
      for (let i = 0; i < candidates.length; i += 1) {
        if (Array.isArray(candidates[i])) return candidates[i];
      }
      return [];
    };
    const qTextOf = (it) => {
      for (let i = 0; i < 6; i++) {
        const k = ['text', 'preview', 'message', 'content', 'prompt', 'value'][i];
        if (typeof it[k] === 'string' && it[k]) return it[k];
      }
      const nested = [it && it.message, it && it.source, it && it.payload];
      for (let i = 0; i < nested.length; i += 1) {
        const value = nested[i];
        if (value && typeof value.text === 'string' && value.text) return value.text;
      }
      return qContentOf(it).map((block) => {
        if (typeof block === 'string') return block;
        if (!block || typeof block !== 'object') return '';
        if (block.type === 'text' || typeof block.text === 'string') return block.text || '';
        if (block.type === 'file') return uiText('[文件]');
        if (block.type === 'image') return uiText('[图片]');
        return '';
      }).filter(Boolean).join(' ');
    };
    let q = (store.sessionState.queue || []).map((it, index) => {
      const rawText = qTextOf(it);
      const contentBlocks = qContentOf(it);
      const contentAttachments = contentBlocks.filter((block) => block && (block.type === 'image' || block.type === 'file'))
        .map((block) => Object.assign({}, block.attachment || block, { type: block.type }));
      const sourceAttachments = Array.isArray(it.attachments) && it.attachments.length
        ? it.attachments
        : (Array.isArray(it.images) && it.images.length ? it.images : contentAttachments);
      const attachments = sourceAttachments.map((attachment, attachmentIndex) => {
        const isImage = attachment && (attachment.type === 'image'
          || String(attachment.mediaType || '').indexOf('image/') === 0
          || !!attachment.tempPath || !!attachment.localUrl || !!attachment.thumbUrl);
        return {
          key: String(attachment && (attachment.id || attachment.attachmentId || attachment.name) || index) + ':' + attachmentIndex,
          type: isImage ? 'image' : 'file',
          url: attachment && (attachment.url || attachment.previewUrl || attachment.tempPath || attachment.localUrl || attachment.thumbUrl) || '',
          name: attachment && (attachment.name || attachment.fileName || uiText('附件')) || uiText('附件')
        };
      }).filter((attachment) => attachment.type !== 'image' || attachment.url);
      return {
        id: it.id,
        rawText: rawText,
        preview: rawText.replace(/\s+/g, ' ').trim(),
        attachmentCount: it.attachmentCount || attachments.length,
        attachmentLabel: (it.attachmentCount || attachments.length) + uiText(' 个附件'),
        attachments: attachments,
        statusText: it.statusText || (it.status === 'sending' ? uiText('发送中…') : ''),
        editable: it.editable !== false
      };
    });
    // DSH 会在 Host 回执前展示本地 pending submission，避免快速连续发送时数量短暂少算。
    // local: true 的项是本机暂存（尚未发给网关），始终展示在最后。
    // 本地待发项按会话隔离：切到别的会话后不显示、也不会被误发。
    const currentSessionId = store.sessionState.sessionId;
    const localItems = (this._pendingQueue || []).filter((item) => item.local && item.sessionId === currentSessionId).map((item) => ({
      id: item.id,
      local: true,
      rawText: item.rawText,
      preview: item.preview,
      attachmentCount: item.attachmentCount,
      attachmentLabel: item.attachmentLabel,
      attachments: item.attachments,
      statusText: item.statusText || '',
      editable: item.editable !== false
    }));
    const pending = (this._pendingQueue || []).filter((item) => !item.local);
    const unmatched = pending.slice();
    q.forEach((item) => {
      if (!item.rawText) return;
      const match = unmatched.findIndex((candidate) => candidate.rawText === item.rawText);
      if (match >= 0) unmatched.splice(match, 1);
    });
    q = q.concat(unmatched, localItems);
    if (JSON.stringify(q) !== JSON.stringify(this._lastQueue || [])) {
      this._lastQueue = q;
      this.setData({ queue: q, queueSending: q.some((item) => !!item.statusText) });
      this.updateDockInset();
    }
  },

  /**
   * 运行中发送：消息只进本地队列，向网关发送前先等用户点队列行的发送箭头。
   * 这样可以避免宿主把 queue 模式的消息在回合结束时自动发出。
   * @param {string} text 正文
   * @param {Array} encodedImages 已编码图片（点箭头发送时直接复用）
   * @param {Array} stagedImages 输入框里的图片（用于队列缩略图与「编辑」还原）
   * @param {Array} workspaceRefs 工作区文件/目录引用
   * @param {string} ticket 一次性订阅通知票据
   */
  enqueueSubmission(text, encodedImages, stagedImages, workspaceRefs, ticket) {
    if (!store.sessionState.running || (!text && !(stagedImages || []).length)) return false;
    const attachments = (stagedImages || []).map((image, index) => ({
      key: 'pending:' + index + ':' + (image.name || 'attachment'),
      type: image.isFile ? 'file' : 'image',
      url: image.previewUrl || image.tempPath || '',
      name: image.name || uiText('附件')
    })).filter((item) => item.type !== 'image' || item.url);
    (workspaceRefs || []).forEach((ref, index) => {
      attachments.push({
        key: 'ref:' + index + ':' + (ref.path || ref.name || ''),
        type: 'file',
        url: '',
        name: ref.name || ref.path || uiText('附件')
      });
    });
    this._pendingQueue = (this._pendingQueue || []).concat([{
      id: 'pending-' + util.uuid(),
      local: true,
      sessionId: store.sessionState.sessionId,
      rawText: text || '',
      preview: String(text || '').replace(/\s+/g, ' ').trim(),
      attachmentCount: attachments.length,
      attachmentLabel: attachments.length + uiText(' 个附件'),
      attachments: attachments,
      statusText: '',
      editable: true,
      // 点箭头发送时复用这些载荷：已编码图片、工作区引用、通知票据
      images: (encodedImages || []).map((image) => ({ mediaType: image.mediaType, data: image.data, name: image.name || null })),
      stagedImages: (stagedImages || []).map((image) => Object.assign({}, image)),
      workspaceRefs: (workspaceRefs || []).map((ref) => Object.assign({}, ref)),
      ticket: ticket || ''
    }]);
    this.syncQueueDock();
    return true;
  },

  pendingSubmission(id) {
    return (this._pendingQueue || []).find((item) => item.id === id) || null;
  },

  dropPendingSubmission(id) {
    this._pendingQueue = (this._pendingQueue || []).filter((item) => item.id !== id);
    this.syncQueueDock();
  },

  /** 点发送箭头：把本地排队项真正发给网关（运行中仍是插话，回合结束后是普通发送）。 */
  releasePendingSubmission(pending) {
    const s = store.sessionState;
    if (!pending || !s.sessionId) return;
    // 排队项属于入队时的会话；已经切走就不能再发到当前会话。
    if (pending.sessionId && pending.sessionId !== s.sessionId) {
      this.dropPendingSubmission(pending.id);
      wx.showToast({ title: uiText('会话已切换，消息已丢弃'), icon: 'none' });
      return;
    }
    if (store.state.connection !== 'connected') {
      wx.showToast({ title: uiText('未连接主机，消息仍在队列中'), icon: 'none' }); return;
    }
    const mode = s.running ? 'steer' : undefined;
    const sent = store.client.sendMessage(
      pending.rawText, s.sessionId, store.state.currentWorkspaceId,
      pending.images || [], mode, pending.ticket || '', pending.workspaceRefs || []
    );
    if (sent === false) {
      wx.showToast({ title: uiText('发送失败，消息仍在队列中'), icon: 'none' }); return;
    }
    this.dropPendingSubmission(pending.id);
    // 立即发送（非插话）时补一条乐观回显；插话消息由网关按运行中回显合并。
    if (mode !== 'steer') {
      store.appendLocalUserRow(pending.rawText, [], pending.workspaceRefs || []);
    }
    this.jumpToBottom();
  },

  openContextSheet() {
    if (this.data.contextSheet) {
      this.setData({ showContextSheet: true, statsPopOpen: false });
    }
  },

  closeContextSheet() {
    this.setData({ showContextSheet: false });
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/home/home' });
      }
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!['conversation', 'trajectory', 'context', 'fleet'].includes(tab) || tab === this.data.tab) return;
    if (tab === 'context' && !this.data.showContextPanel) return;
    if (tab === 'fleet' && !this.data.showFleetPanel) return;
    haptics.vibrate();
    this.cancelVoice();
    this.closeAttachMenu(false);
    if (store.setTrajectoryActive) store.setTrajectoryActive(tab === 'trajectory');
    if (store.setContextActive) store.setContextActive(tab === 'context');
    if (store.setFleetActive) store.setFleetActive(tab === 'fleet');
    let tracePatch = {};
    if (tab === 'trajectory') { this._traceRows = store.sessionState.trajectory || []; tracePatch = dataPatch(this.data, this.trajectoryPatch()); }
    let contextPatch = {};
    if (tab === 'context') contextPatch = this.contextPanelPatch();
    let fleetPatch = {};
    if (tab === 'fleet') fleetPatch = this.fleetPanelPatch();
    this.prioritizeInteraction();
    const hadKeyboard = this.data.kbHeight > 0 || this.data.composerFocused;
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({ tab, trajectoryMounted: this.data.trajectoryMounted || tab === 'trajectory', contextMounted: this.data.contextMounted || tab === 'context', fleetMounted: this.data.fleetMounted || tab === 'fleet', ...tracePatch, ...contextPatch, ...fleetPatch, collaborationOpen:false, collaborationPreview:null, collaborationBusy:false, kbHeight: 0, composerFocused: false, showJump: false,
      statsPopOpen: false, showContextSheet: false, commandMenu: null,
      attachSheetOpen: false, modelSheetOpen: false, effortSheetOpen: false,
      permissionSheet: [], modeSheet: [], ...this.layoutPatch({ kbHeight: 0 }) });
    if (hadKeyboard && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    if (tab === 'context') this.scheduleContextFlow();
    else this.stopContextFlow();
    if (tab === 'conversation') {
      this.updateDockInset();
      this.startScrollPolling();
      // Mounted scroll views retain their position; do not force a jump on every switch.
      if (this._convPinned !== false) wx.nextTick(() => this.refreshBottomAnchor());
    } else {
      this.stopScrollPolling();
    }
  },

  /** Refresh local tab visibility after returning from the settings page. */
  syncContextPanelPreferences() {
    const panelPrefs = contextPanelsPreference.read();
    const tab = (this.data.tab === 'context' && !panelPrefs.context)
      || (this.data.tab === 'fleet' && !panelPrefs.fleet) ? 'conversation' : this.data.tab;
    this.setData({ showContextPanel: panelPrefs.context, showFleetPanel: panelPrefs.fleet, tab });
    if (store.setTrajectoryActive) store.setTrajectoryActive(tab === 'trajectory');
    if (store.setContextActive) store.setContextActive(tab === 'context');
    if (store.setFleetActive) store.setFleetActive(tab === 'fleet');
    return tab;
  },

  /** 上下文面板派生：store 快照 → 纯函数视图模型（缓存原始 value 身份，避免每次 emit 重算趋势）。 */
  contextPanelPatch(session, app) {
    const s = session || store.sessionState;
    const a = app || store.state;
    const dashboard = (s && s.contextDashboard) || null;
    // v2：编队快照参与「Agent 网络」派生；运行态驱动面板脉冲。
    const fleet = (s && s.contextFleet) || null;
    const fleetValue = fleet && fleet.value ? fleet.value : null;
    const contextPressure = s && s.stats ? s.stats.pressure : null;
    const locale = this.data.uiLocale || '';
    const connected = !a || a.connection === 'connected';
    const sessionId = (s && s.sessionId) || '';
    const running = !!(s && s.running);
    const browserSeq = this.data.contextBrowserSeq == null ? null : Number(this.data.contextBrowserSeq);
    const browserIsCurrent = this.data.contextBrowserIsCurrent === true;
    const expanded = Array.isArray(this.data.contextBrowserExpanded) ? this.data.contextBrowserExpanded : [];
    const expandedKey = expanded.join(',');
    const trendSeq = this.data.contextTrendSeq == null ? null : Number(this.data.contextTrendSeq);
    const trendGroupBy = this.data.contextTrendGroupBy || 'auto';
    const trendDisplayMode = this.data.contextTrendDisplayMode === 'delta' ? 'delta' : 'total';
    const trendActiveTurn = this.data.contextTrendActiveTurn == null ? null : Number(this.data.contextTrendActiveTurn);
    const trendDna = this.data.contextTrendDna === true;
    const trendOverview = this.data.contextTrendOverview === true;
    const trendAdaptive = this.data.contextTrendAdaptive === true;
    const trendShowDuration = this.data.contextTrendShowDuration !== false;
    const trendVisibleRange = this.data.contextTrendVisibleRange || null;
    const trendVisibleRangeKey = trendVisibleRange ? trendVisibleRange.from + ':' + trendVisibleRange.to : '';
    const fileFilter = this.data.contextFileFilter || 'all';
    const fileSort = this.data.contextFileSort || 'activity';
    const cache = this._contextPanelCache;
    if (cache && cache.dashboard === dashboard && cache.locale === locale
      && cache.connected === connected && cache.sessionId === sessionId
      && cache.fleetValue === fleetValue && cache.running === running
      && cache.contextPressure === contextPressure
      && cache.browserSeq === browserSeq && cache.browserIsCurrent === browserIsCurrent && cache.expandedKey === expandedKey
      && cache.fileFilter === fileFilter && cache.fileSort === fileSort
      && cache.trendSeq === trendSeq && cache.trendGroupBy === trendGroupBy
      && cache.trendDisplayMode === trendDisplayMode
      && cache.trendActiveTurn === trendActiveTurn
      && cache.trendDna === trendDna && cache.trendOverview === trendOverview
      && cache.trendAdaptive === trendAdaptive && cache.trendShowDuration === trendShowDuration
      && cache.trendVisibleRangeKey === trendVisibleRangeKey) {
      return { contextPanel: cache.panel };
    }
    const panel = contextView.buildPanel(dashboard, {
      t: uiText, connected: connected, hasSession: !!sessionId,
      running: running, fleet: fleetValue, contextPressure: contextPressure,
      browserSeq: browserSeq, browserCurrent: browserIsCurrent, expanded: expanded,
      trendSeq: trendSeq, trendGroupBy: trendGroupBy, trendDisplayMode: trendDisplayMode,
      trendActiveTurn: trendActiveTurn, trendDna: trendDna, trendOverview: trendOverview,
      trendAdaptive: trendAdaptive, trendShowDuration: trendShowDuration,
      trendVisibleRange: trendVisibleRange,
      fileFilter: fileFilter, fileSort: fileSort
    });
    this._contextPanelCache = {
      dashboard, locale, connected, sessionId,
      fleetValue, running, contextPressure, browserSeq, browserIsCurrent, expandedKey,
      fileFilter, fileSort,
      trendSeq, trendGroupBy, trendDisplayMode, trendActiveTurn, trendDna, trendOverview,
      trendAdaptive, trendShowDuration, trendVisibleRangeKey, panel
    };
    return { contextPanel: panel };
  },

  /**
   * 浏览器游标/折叠变化：立刻重建面板，不等 store emit。
   *
   * 游标变化同时回写到趋势图的选中项，两个模块始终指向同一请求
   * （dsh-context 的 live linkage 是双向的：hover 柱预览、离开回到自选）。
   */
  setContextBrowser(seq, expanded, isCurrent) {
    const next = seq == null ? null : Number(seq);
    const patch = { contextBrowserSeq: next, contextBrowserIsCurrent: isCurrent === true };
    // 只有真的变了才动趋势图，避免自己触发的那次回写形成往返。
    if ((this.data.contextTrendSeq == null ? null : Number(this.data.contextTrendSeq)) !== next) {
      patch.contextTrendSeq = next;
      this._contextPanelCache = null;
    }
    if (Array.isArray(expanded)) patch.contextBrowserExpanded = expanded;
    patch.contextNodeDetail = null;
    this.setData(patch);
    this.setData(this.contextPanelPatch());
  },

  /** Rebuild after a control change, then pin the browser to the bar the new chart actually selected. */
  rebuildContextTrendSelection() {
    this._contextPanelCache = null;
    const nextPanel = this.contextPanelPatch().contextPanel;
    const selected = nextPanel && nextPanel.trend ? nextPanel.trend.selectedSeq : null;
    const seq = selected !== null && selected !== undefined && Number.isFinite(Number(selected))
      ? Number(selected) : null;
    this.setData({ contextTrendSeq: seq, contextBrowserSeq: seq, contextBrowserIsCurrent: false });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** Adaptive scales follow the visible horizontal window, like the desktop chart. */
  measureContextTrendViewport(scrollLeft) {
    if (!this.data.contextTrendAdaptive || this.data.contextTrendOverview || this.data.tab !== 'context') return;
    if (!wx || typeof wx.createSelectorQuery !== 'function') return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.ctx-trend-scroll').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !(rect.width > 0)) return;
      let windowWidth = 375;
      try {
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        if (info && Number(info.windowWidth) > 0) windowWidth = Number(info.windowWidth);
      } catch (_) {}
      const pxToRpx = 750 / windowWidth;
      const pitch = contextView.TREND_BAR_PITCH;
      const from = Math.max(0, Math.floor((Math.max(0, scrollLeft) * pxToRpx) / pitch) - 1);
      const visible = Math.max(1, Math.ceil((rect.width * pxToRpx) / pitch));
      const to = from + visible + 1;
      const previous = this.data.contextTrendVisibleRange;
      if (previous && previous.from === from && previous.to === to) return;
      this.setData({ contextTrendVisibleRange: { from, to } }, () => {
        this._contextPanelCache = null;
        this.setData(this.contextPanelPatch());
      });
    });
  },

  /** Read the selected surface/header event body lazily instead of shipping transcripts on every refresh. */
  openContextNode(e) {
    const rawSeq = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.seq : null;
    const seq = Number(rawSeq);
    const sessionId = store.sessionState && store.sessionState.sessionId;
    if (!Number.isSafeInteger(seq) || seq < 0 || !sessionId) return;
    const key = sessionId + ':' + seq;
    this._contextContentCache = this._contextContentCache || Object.create(null);
    this._contextContentPending = this._contextContentPending || Object.create(null);
    const cached = this._contextContentCache[key];
    if (cached) {
      this.setData({ contextNodeDetail: cached, contextNodeLoadingSeq: null });
      return;
    }
    if (this._contextContentPending[key]) return;
    if (!store.client || typeof store.client.requestContextContent !== 'function') return;
    this._contextContentPending[key] = true;
    this.setData({ contextNodeLoadingSeq: seq, contextNodeDetail: null });
    store.client.requestContextContent(sessionId, seq).then((frame) => {
      if (!this.data || this.data.contextNodeLoadingSeq !== seq
        || !store.sessionState || store.sessionState.sessionId !== sessionId) return;
      const value = frame && frame.value && typeof frame.value === 'object' ? frame.value : null;
      if (!value || typeof value.text !== 'string') throw new Error(uiText('上下文明细不可用'));
      const detail = { seq: seq, type: value.type || '', text: value.text,
        truncated: value.truncated === true };
      this._contextContentCache[key] = detail;
      const cacheKeys = Object.keys(this._contextContentCache);
      if (cacheKeys.length > 64) delete this._contextContentCache[cacheKeys[0]];
      this.setData({ contextNodeDetail: detail, contextNodeLoadingSeq: null });
    }).catch((error) => {
      if (!this.data || this.data.contextNodeLoadingSeq !== seq) return;
      this.setData({
        contextNodeLoadingSeq: null,
        contextNodeDetail: { seq: seq, type: '', text: error && error.message ? error.message : uiText('上下文明细读取失败') }
      });
    }).finally(() => { delete this._contextContentPending[key]; });
  },

  /** 上一步（step=-1）/下一步（step=1）请求。 */
  contextBrowserStep(e) {
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    const step = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.step : 0);
    if (!browser) return;
    const can = step < 0 ? browser.canPrev : browser.canNext;
    if (!can) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    const seq = step < 0 ? browser.prevSeq : browser.nextSeq;
    this.setContextBrowser(seq, undefined, seq == null);
  },

  /** 请求下拉选择。 */
  contextBrowserPick(e) {
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    const index = Number(e && e.detail ? e.detail.value : NaN);
    if (!browser || !browser.options || !Number.isFinite(index) || index < 0 || index >= browser.options.length) return;
    const option = browser.options[index];
    if (!option || option.seq === undefined) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setContextBrowser(option.seq, undefined, option.isCurrent === true);
  },

  /** 展开/折叠某类（v2 折叠行）。 */
  toggleContextBrowserRow(e) {
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!browser || !key) return;
    const expanded = (Array.isArray(this.data.contextBrowserExpanded) ? this.data.contextBrowserExpanded.slice() : []);
    const index = expanded.indexOf(key);
    if (index >= 0) expanded.splice(index, 1); else expanded.push(key);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setContextBrowser(this.data.contextBrowserSeq, expanded, browser.isCurrent === true);
  },

  /**
   * 选择趋势图中的请求。
   *
   * 同时驱动下方详情面板与「上下文浏览器」——后者切到同一请求，展开该请求
   * 实际拼接出来的内容（dsh-context 的 live linkage： hovering a bar previews
   * that step's assembled context in the Context browser）。再次点同一根柱子
   * 取消选中，浏览器回到「当前（下一次请求）」。
   */
  contextTrendSelect(e) {
    const raw = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.seq : null;
    const seq = Number(raw);
    if (!Number.isFinite(seq)) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    const next = this.data.contextTrendSeq === seq ? null : seq;
    this.setData({ contextTrendSeq: next });
    this.setContextBrowser(next, this.data.contextBrowserExpanded);
  },

  /**
   * 点击轮次条：点亮该轮并定位到它的第一根柱（dsh-context 的 onPickTurn）。
   * 再次点击同一轮取消聚焦。
   */
  contextTrendPickTurn(e) {
    const raw = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.turn : null;
    const turn = Number(raw);
    if (!Number.isFinite(turn)) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    const active = this.data.contextTrendActiveTurn === turn ? null : turn;
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    const matching = trend && Array.isArray(trend.bars) ? trend.bars.filter((bar) => bar.turn === turn) : [];
    const selected = matching.length ? matching[matching.length - 1].seq : null;
    this.setData({ contextTrendActiveTurn: active, contextTrendSeq: selected });
    this._contextPanelCache = null;
    if (active !== null) this._scrollTrendToTurn(active);
    this.setContextBrowser(selected);
  },

  /** 轮次条与柱区共享横向滚动：把柱区的偏移同步给轮次条。 */
  contextTrendScroll(e) {
    const left = e && e.detail ? e.detail.scrollLeft : 0;
    if (this.data.contextTrendTurnLeft !== left) this.setData({ contextTrendTurnLeft: left });
    if (!this.data.contextTrendAdaptive) return;
    this._contextTrendMeasureLeft = left;
    if (this._contextTrendMeasureTimer) clearTimeout(this._contextTrendMeasureTimer);
    this._contextTrendMeasureTimer = setTimeout(() => {
      this._contextTrendMeasureTimer = null;
      this.measureContextTrendViewport(this._contextTrendMeasureLeft || 0);
    }, 80);
  },

  /** 把指定轮次的第一根柱滚到可视区左侧（不居中，保持与 Web 面板一致的跟随感）。 */
  _scrollTrendToTurn(turn) {
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    if (!trend || !Array.isArray(trend.turnStrip)) return;
    const index = trend.turnStrip.findIndex(function (item) { return item.turn === turn; });
    if (index < 0) return;
    const left = trend.turnStrip[index].left || 0;
    this.setData({ contextTrendScrollLeft: left });
  },

  /** 趋势粒度：按单次模型请求（步骤）或每轮最后一次请求聚合。 */
  contextTrendGroup(e) {
    const groupBy = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.group : '';
    if (groupBy !== 'step' && groupBy !== 'turn') return;
    const currentGroup = this.data.contextPanel && this.data.contextPanel.trend
      ? this.data.contextPanel.trend.groupBy : this.data.contextTrendGroupBy;
    if (groupBy === currentGroup) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextTrendGroupBy: groupBy, contextTrendActiveTurn: null, contextTrendVisibleRange: null });
    this._contextPanelCache = null;
    this.rebuildContextTrendSelection();
    if (this.data.contextTrendAdaptive) this.measureContextTrendViewport(this._contextTrendMeasureLeft || 0);
  },

  /** Adaptive rescales bars/curve against the visible window; overview is its mutually exclusive counterpart. */
  contextTrendAdaptive() {
    const next = !(this.data.contextTrendAdaptive === true);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextTrendAdaptive: next, contextTrendOverview: false, contextTrendDna: false,
      contextTrendVisibleRange: next ? this.data.contextTrendVisibleRange : null });
    this._contextPanelCache = null;
    this.rebuildContextTrendSelection();
    if (next) this.measureContextTrendViewport(this._contextTrendMeasureLeft || 0);
  },

  /** Show or hide the independent request-duration curve and its right axis. */
  contextTrendDuration() {
    this.setData({ contextTrendShowDuration: this.data.contextTrendShowDuration === false });
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this._contextPanelCache = null;
    this.rebuildContextTrendSelection();
  },

  /** 趋势显示完整上下文规模，或相邻请求之间的增长/回收量。 */
  contextTrendMode(e) {
    const mode = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.mode : '';
    if (mode !== 'total' && mode !== 'delta') return;
    if (mode === this.data.contextTrendDisplayMode) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    // DNA 画的是构成指纹，没有"逐类增减"可讲，切到增量时自动让位。
    if (mode === 'delta') this.setData({ contextTrendDna: false });
    this.setData({ contextTrendDisplayMode: mode });
    this._contextPanelCache = null;
    this.rebuildContextTrendSelection();
  },

  /** DNA 模式：每根柱子改成一条条带，按模型阅读顺序平铺（与总览互斥）。 */
  contextTrendDna() {
    const next = !(this.data.contextTrendDna === true);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextTrendDna: next, contextTrendOverview: false, contextTrendAdaptive: false,
      contextTrendVisibleRange: null });
    this._contextPanelCache = null;
    this.rebuildContextTrendSelection();
  },

  /** 总览：整段会话压进可视宽度的连续堆叠带（与 DNA 互斥）。 */
  contextTrendOverview() {
    const next = !(this.data.contextTrendOverview === true);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextTrendOverview: next, contextTrendDna: false, contextTrendAdaptive: false,
      contextTrendVisibleRange: null });
    this._contextPanelCache = null;
    this.rebuildContextTrendSelection();
  },

  /**
   * 总览带上的触摸：记录横向比例，touchend 时换算成记录序号并选中，
   * 让整段压扁后仍能逐条定位（dsh-context 的 hover-to-scrub / click-to-pin）。
   */
  contextTrendFitTouch(e) {
    const x = e && e.touches && e.touches[0] ? e.touches[0].x : null;
    if (x === null) return;
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    if (!trend || !trend.ribbon || !trend.ribbon.count) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.ctx-trend-chart-fit').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !(rect.width > 0)) return;
      const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      const index = Math.min(trend.ribbon.count - 1, Math.floor(ratio * trend.ribbon.count));
      const seq = trend.bars[index] && trend.bars[index].seq;
      if (seq === undefined) return;
      if (this._ctxFitSeq === seq) return;
      this._ctxFitSeq = seq;
      this.setContextBrowser(seq);
    });
  },

  /** 总览带上抬手：清掉滑动去抖记录，下次触摸重新定位。 */
  contextTrendFitPick() {
    this._ctxFitSeq = null;
  },

  /** 手动刷新上下文面板（卡片区右上角）。 */
  refreshContextDashboard() {
    if (store.refreshContextDashboard) {
      haptics.tick ? haptics.tick() : haptics.vibrate();
      store.refreshContextDashboard();
    }
  },

  contextFileActivitySelect(e) {
    const path = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.path : '';
    if (!path) return;
    wx.showModal({ title: uiText('文件活动'), content: path, showCancel: false, confirmText: uiText('关闭') });
  },

  setContextFileFilter(e) {
    const filter = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.filter : '';
    if (['all', 'read', 'write', 'search'].indexOf(filter) < 0 || filter === this.data.contextFileFilter) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextFileFilter: filter });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  setContextFileSort(e) {
    const sort = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.sort : '';
    if (['activity', 'recent'].indexOf(sort) < 0 || sort === this.data.contextFileSort) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextFileSort: sort });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 编队面板派生：store 快照 → 纯函数视图模型（缓存原始 value 身份，避免每次 emit 重算卡片）。 */
  fleetPanelPatch(session, app) {
    const s = session || store.sessionState;
    const a = app || store.state;
    const fleet = (s && s.contextFleet) || null;
    const locale = this.data.uiLocale || '';
    const connected = !a || a.connection === 'connected';
    const sessionId = (s && s.sessionId) || '';
    const running = !!(s && s.running);
    const cache = this._fleetPanelCache;
    if (cache && cache.fleet === fleet && cache.locale === locale
      && cache.connected === connected && cache.sessionId === sessionId
      && cache.running === running) {
      return { fleetPanel: cache.panel };
    }
    const panel = contextView.buildFleetPanel(fleet, {
      t: uiText, connected: connected, hasSession: !!sessionId, running: running
    });
    this._fleetPanelCache = { fleet, locale, connected, sessionId, running, panel };
    return { fleetPanel: panel };
  },

  /** 手动刷新编队面板（卡片区右上角）。 */
  refreshContextFleet() {
    if (store.refreshContextFleet) {
      haptics.tick ? haptics.tick() : haptics.vibrate();
      store.refreshContextFleet();
    }
  },

  /** 点击编队中的 Agent：打开该会话并切到「上下文」分段查看其上下文明细。 */
  openFleetAgent(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const sessionId = dataset.id;
    if (!sessionId) return;
    haptics.vibrate();
    if (store.openSession) store.openSession(sessionId, dataset.title || '', null);
    this.switchTab({ currentTarget: { dataset: { tab: 'context' } } });
  },

  onPanelTouchStart(e) {
    if (this.data.tab === 'conversation') this.onConvTouch();
    const touch = e.touches && e.touches.length === 1 && e.touches[0];
    this._panelGesture = touch ? { x: touch.clientX, y: touch.clientY, axis: '', tab: this.data.tab } : null;
  },

  onPanelTouchMove(e) {
    const gesture = this._panelGesture;
    if (!gesture) return;
    if (!e.touches || e.touches.length !== 1) { this._panelGesture = null; return; }
    const dx = e.touches[0].clientX - gesture.x, dy = e.touches[0].clientY - gesture.y;
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 12) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'horizontal' : 'vertical';
    }
  },

  onPanelTouchEnd(e) {
    const gesture = this._panelGesture;
    this._panelGesture = null;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!gesture || !touch || gesture.axis === 'vertical' || gesture.tab !== this.data.tab) return;
    const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (this.data.moreSheetOpen || this.data.turnNavOpen || this.data.sessionSwitcherOpen || this.data.collaborationOpen) return;
    // 四段顺序：对话 ⇄ 轨迹 ⇄ 上下文 ⇄ 编队；左滑前进、右滑后退，两端不越界。
    const order = ['conversation', 'trajectory'];
    if (this.data.showContextPanel) order.push('context');
    if (this.data.showFleetPanel) order.push('fleet');
    const index = order.indexOf(gesture.tab);
    if (index < 0) return;
    const nextIndex = dx < 0 ? Math.min(order.length - 1, index + 1) : Math.max(0, index - 1);
    if (nextIndex === index) return;
    this.switchTab({ currentTarget: { dataset: { tab: order[nextIndex] } } });
  },

  onPanelTouchCancel() { this._panelGesture = null; },

  /** 键盘高度：手动把输入条抬到键盘上方（adjust-position 关闭，避免整页顶起） */
  onKeyboardHeight(e) {
    const h = this.data.tab === 'conversation' ? ((e.detail && e.detail.height) || 0) : 0;
    if (h !== this.data.kbHeight) this.setData({ kbHeight: h }, () => this.syncLayoutStyles());
  },

  onComposerFocus() {
    this.prioritizeInteraction();
    // 占位双态（iOS：聚焦后切换为「描述你想要构建的内容」）
    if (!this.data.composerFocused) this.setData({ composerFocused: true, voiceTyping: true });
  },

  onKeyboardHide() {
    this.setData({ kbHeight: 0, composerFocused: false, composerFocus: false, voiceTyping: false });
    if (this.data.kbHeight) this.setData({ kbHeight: 0 });
    this.syncLayoutStyles();
  },


  copyToolCommand(e) {
    const text = e.currentTarget.dataset.text;
    if (typeof text === 'string' && text) wx.setClipboardData({ data: text });
  },

  copyAssistantText(e) {
    // 复制渲染后的纯文本（剥离 markdown 标记），而不是原始 md 源码
    const text = mdToPlain(e.currentTarget.dataset.text);
    if (!text) return;
    wx.setClipboardData({ data: text });
    const key = e.currentTarget.dataset.key;
    if (key) {
      this.setData({ copiedKey: key });
      if (this._copyTimer) clearTimeout(this._copyTimer);
      this._copyTimer = setTimeout(() => this.setData({ copiedKey: '' }), 1400);
    }
  },

  findPresetName(catalog, presetId) {
    const presets = (catalog && catalog.presets) || [];
    const found = presets.find((p) => p.id === presetId);
    return (found && found.name) || labels.presetModeName(presetId);
  },

  // 对齐 dsh-mobile v1.6.0：会话模式胶囊，点击弹出预设列表
  pickSessionPreset() {
    const catalog = store.state.agentPresets;
    const presets = (catalog && catalog.presets) || [];
    const sessionId = store.sessionState.sessionId;
    if (!presets.length || !sessionId) return;
    const current = store.sessionState.agentPreset;
    this.setData({
      modeSheet: presets.slice(0, 8).map((p) => ({
        id: p.id,
        name: (p.name && p.name.trim()) || labels.presetModeName(p.id),
        desc: labels.presetModeDesc(p.id),
        current: p.id === current
      }))
    });
  },

  pickModeOption(e) {
    const id = e.currentTarget.dataset.id;
    const sessionId = store.sessionState.sessionId;
    const current = store.sessionState.agentPreset;
    this.setData({ modeSheet: [] });
    if (!sessionId || !id || id === current) return;
    store.client.selectSessionAgentPreset(sessionId, id).catch((err) => {
      wx.showToast({ title: err.message || uiText('切换失败'), icon: 'none' });
    });
  },

  sessionSwitcherRows(app = store.state, query = '') {
    const state = app || {};
    const session = store.sessionState || {};
    const workspaces = (state.workspaces || []).filter(Boolean);
    const currentSummary = (state.sessions || []).find((item) => item && item.sessionId === session.sessionId) || null;
    const items = sessionSwitcher.buildItems(state.sessions, {
      currentSessionId: session.sessionId,
      currentTitle: session.title,
      currentRunning: session.running,
      currentPreset: session.agentPreset,
      archivedSessionIds: state.archivedSessionIds
    });
    const filtered = sessionSwitcher.filterItems(items, query);
    const norm = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const fallbackWorkspace = workspaces.find((ws) => ws.workspaceId === (currentSummary && currentSummary.workspaceId))
      || workspaces.find((ws) => ws.workspaceId === state.currentWorkspaceId)
      || null;
    const workspaceOf = (item) => {
      if (item.workspaceId) {
        const byId = workspaces.find((ws) => ws.workspaceId === item.workspaceId);
        if (byId) return byId;
      }
      const cwd = norm(item.cwd);
      if (cwd) {
        const byPath = workspaces.find((ws) => {
          const root = norm(ws.path || ws.cwd || ws.directory || ws.folder);
          return root && (cwd === root || cwd.indexOf(root + '/') === 0);
        });
        if (byPath) return byPath;
      }
      // 缺少 cwd/workspaceId 的历史会话：归到当前工作区，避免被隐藏
      return fallbackWorkspace;
    };
    const decorate = (item) => ({
      ...item,
      header: false,
      displayTitle: item.current && session.title ? session.title
        : item.title || util.sessionIdLabel(item.sessionId),
      activityLabel: item.running ? uiText('运行中') : util.formatRelativeTime(item.updatedAt)
    });
    // 无法归属到工作区的会话不展示，避免整页都是「未分组」
    const grouped = [];
    filtered.forEach((item) => {
      const workspace = workspaceOf(item);
      if (!workspace) return;
      grouped.push({ workspace, item });
    });
    if (!grouped.length) return filtered.map(decorate);
    const currentWorkspace = workspaceOf(currentSummary || {}) || grouped[0].workspace;
    const latest = (list) => list.reduce((max, entry) => Math.max(max, entry.item.updatedAt || 0), 0);
    const buckets = new Map();
    grouped.forEach((entry) => {
      const key = entry.workspace.workspaceId || entry.workspace.path || 'ws';
      if (!buckets.has(key)) buckets.set(key, { workspace: entry.workspace, items: [] });
      buckets.get(key).items.push(entry.item);
    });
    const ordered = Array.from(buckets.values()).sort((a, b) => {
      if (a.workspace === currentWorkspace) return -1;
      if (b.workspace === currentWorkspace) return 1;
      return latest(b.items.map((item) => ({ item }))) - latest(a.items.map((item) => ({ item })));
    });
    const rows = [];
    ordered.forEach((bucket) => {
      const workspace = bucket.workspace;
      const name = workspace.name || workspace.title || (workspace.path || '').split('/').filter(Boolean).pop() || util.sessionIdLabel(workspace.workspaceId);
      rows.push({ header: true, key: 'group-' + (workspace.workspaceId || name), title: name, count: bucket.items.length });
      bucket.items.forEach((item) => rows.push(decorate(item)));
    });
    return rows;
  },

  openSessionSwitcher() {
    if (this.data.sessionSwitcherOpen) return;
    this.prioritizeInteraction();
    const hadKeyboard = this.data.kbHeight > 0 || this.data.composerFocused;
    this.setData({
      sessionSwitcherOpen: true,
      sessionSwitcherExpanded: false,
      sessionSwitcherHeight: 60,
      sessionSwitcherQuery: '',
      sessionSwitcherSearchOpen: false,
      sessionSwitcherItems: this.sessionSwitcherRows(store.state, ''),
      moreSheetOpen: false,
      collaborationOpen: false,
      collaborationPreview: null,
      collaborationBusy: false,
      statsPopOpen: false,
      morePane: 'menu',
      renameKeyboard: 0,
      modelSheetOpen: false,
      effortSheetOpen: false,
      permissionSheet: [],
      modeSheet: [],
      showContextSheet: false,
      traceDetail: null,
      attachSheetOpen: false,
      kbHeight: 0,
      composerFocused: false,
      composerFocus: false,
      ...this.layoutPatch({ kbHeight: 0 })
    });
    this.stopScrollPolling();
    if (hadKeyboard && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },

  onSessionSwitcherSearch(e) {
    const query = e && e.detail ? String(e.detail.value || '') : '';
    this.setData({
      sessionSwitcherQuery: query,
      sessionSwitcherItems: this.sessionSwitcherRows(store.state, query)
    });
  },

  expandSwitcherSearch() {
    if (this.data.sessionSwitcherSearchOpen) return;
    this.setData({ sessionSwitcherSearchOpen: true });
  },

  closeSessionSwitcher() {
    if (!this.data.sessionSwitcherOpen) return;
    this.setData({ sessionSwitcherOpen: false, sessionSwitcherExpanded: false, sessionSwitcherHeight: 60, sessionSwitcherQuery: '', sessionSwitcherSearchOpen: false });
    if (this.data.tab === 'conversation') this.startScrollPolling();
  },

  expandSessionSwitcher() {
    if ((this._sessionSwitcherSuppressTapUntil || 0) > Date.now()) return;
    this.setData({ sessionSwitcherExpanded: true, sessionSwitcherHeight: 90 });
  },

  sessionSwitcherGrabStart(e) {
    const touch = e && e.touches && e.touches[0];
    if (!touch) return;
    let windowHeight = 800;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowHeight = Number(info && info.windowHeight) || windowHeight;
    } catch (_) { /* Keep a safe viewport estimate for older WeChat builds. */ }
    this._sessionSwitcherGrab = {
      y: touch.clientY,
      delta: 0,
      startHeight: Number(this.data.sessionSwitcherHeight) || 60,
      windowHeight: windowHeight,
      moved: false
    };
  },

  sessionSwitcherGrabMove(e) {
    const grab = this._sessionSwitcherGrab;
    const touch = e && e.touches && e.touches[0];
    if (!grab || !touch) return;
    const delta = touch.clientY - grab.y;
    if (Math.abs(delta) < 18) return;
    grab.moved = true;
    grab.delta = delta;
    const height = Math.max(60, Math.min(90, Math.round(grab.startHeight - delta / grab.windowHeight * 100)));
    if (this.data.sessionSwitcherHeight !== height) {
      this.setData({ sessionSwitcherHeight: height, sessionSwitcherExpanded: height > 60 });
    }
  },

  sessionSwitcherGrabEnd() {
    const grab = this._sessionSwitcherGrab;
    this._sessionSwitcherGrab = null;
    if (grab && grab.moved) {
      const height = grab.delta < 0 ? 90 : 60;
      this.setData({ sessionSwitcherHeight: height, sessionSwitcherExpanded: height > 60 });
      this._sessionSwitcherSuppressTapUntil = Date.now() + 300;
    } else if (grab) {
      // Some WeChat builds suppress tap after a caught touch sequence; treat a still touch as a tap.
      this.setData({ sessionSwitcherHeight: 90, sessionSwitcherExpanded: true });
    }
  },

  switchSessionFromSwitcher(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.sessionId;
    const item = (this.data.sessionSwitcherItems || []).find(row => row.sessionId === id);
    if (!id || !item) return;
    this.setData({ sessionSwitcherOpen: false, sessionSwitcherExpanded: false, sessionSwitcherHeight: 60, sessionSwitcherQuery: '' });
    if (id === store.sessionState.sessionId) {
      if (this.data.tab === 'conversation') this.startScrollPolling();
      return;
    }
    store.openSession(id, item.displayTitle, item.agentPreset || null);
    this.sessionId = id;
    if (this.data.tab === 'conversation') this.startScrollPolling();
  },

  moreActions() {
    if (this.data.moreSheetOpen) return;
    this.prioritizeInteraction();
    const hadKeyboard = this.data.kbHeight > 0 || this.data.composerFocused;
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({ moreSheetOpen: true, morePane: 'menu', moreSheetExpanded: false, renameKeyboard: 0, fileReferenceMode: false, collaborationOpen:false, collaborationPreview:null, collaborationBusy:false, statsPopOpen: false,
      showContextSheet: false, commandMenu: null, traceDetail: null,
      modelSheetOpen: false, effortSheetOpen: false, permissionSheet: [], modeSheet: [],
      attachSheetOpen: false, kbHeight: 0, composerFocused: false, ...this.layoutPatch({ kbHeight: 0 }) });
    this.stopScrollPolling();
    if (hadKeyboard && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },

  closeMoreActions() {
    this.prioritizeInteraction();
    this._renameDraft = null;
    this._filesRequest = null;
    this.setData({ moreSheetOpen: false, morePane: 'menu', moreSheetExpanded: false, renameKeyboard: 0, fileReferenceMode: false });
    if (this.data.tab === 'conversation') this.startScrollPolling();
  },

  // 从重命名/统计/文件子页返回「更多」列表，不关闭整个弹层。
  backToMoreMenu() {
    this._renameDraft = null;
    this._filesRequest = null;
    this.setData({ morePane: 'menu', renameKeyboard: 0, fileReferenceMode: false });
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
  },

  /* 拖动条：点击或上拖把「更多」弹层抬高到 86vh，下滑/再点收回 */
  moreSheetGrabStart(e) {
    this._moreGrab = { y: e.touches[0].clientY, moved: false, base: this.data.moreSheetExpanded, applied: null };
  },

  moreSheetGrabMove(e) {
    const g = this._moreGrab;
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (Math.abs(dy) < 20) return;
    const expand = dy < 0;
    if (g.applied !== expand) {
      g.applied = expand;
      g.moved = true;
      this.setData({ moreSheetExpanded: expand });
    }
  },

  moreSheetGrabEnd() {
    const g = this._moreGrab;
    this._moreGrab = null;
    if (g && !g.moved) this.setData({ moreSheetExpanded: !this.data.moreSheetExpanded });
  },

  selectMoreAction(e) {
    if (!this.data.moreSheetOpen) return;
    const action = e.currentTarget.dataset.action;
    const s = store.sessionState;
    if (action === 'cancel' && !s.running) return;
    // 统计 / 重命名 / 工作区文件 / 会话快捷切换都在当前「更多」弹层内展开
    if (action === 'switchSessions') { this.closeMoreActions(); this.openSessionSwitcher(); return; }
    if (action === 'stats') { this.openStatsPane(); return; }
    if (action === 'files') { this.openFilesPane(); return; }
    if (action === 'rename') {
      if (!s.sessionId) return;
      this._renameDraft = this.data.navTitle || '';
      this.setData({ morePane: 'rename', renameValue: this.data.navTitle || '', renameKeyboard: 0 });
      return;
    }
    this.closeMoreActions();
    if (!s.sessionId) return;
    if (action === 'cancel') {
      this.setData({ confirmSheet: 'cancel' });
    } else if (action === 'archive') {
      this.setData({ confirmSheet: 'archive' });
    }
  },

  // 会话快捷切换：作为「更多」弹层内的一个页面打开
  openSessionSwitchPane() {
    this.setData({
      morePane: 'switch',
      sessionSwitcherQuery: '',
      sessionSwitcherItems: this.sessionSwitcherRows(store.state, '')
    });
  },

  switchSessionFromMore(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset.sessionId;
    const item = (this.data.sessionSwitcherItems || []).find(row => row.sessionId === id);
    if (!id || !item) return;
    this.closeMoreActions();
    if (id === store.sessionState.sessionId) return;
    store.openSession(id, item.displayTitle, item.agentPreset || null);
    this.sessionId = id;
    if (this.data.tab === 'conversation') this.startScrollPolling();
  },

  // ---------- 更多菜单 / 工作区文件 ----------

  // 工作区文件作为「更多」弹层内的一个页面打开（不再另起底部弹窗）。
  openFilesPane(referenceMode = false) {
    this._filesRel = null;
    this._filesRequest = null;
    this.setData({ morePane: 'files', fileReferenceMode: referenceMode === true, filesEntries: [], filesLoading: true, filesError: '', filesPathLabel: '' });
    this.loadSessionFiles(null);
  },

  openFilesSheet(referenceMode = false) {
    this._filesRel = null;
    this.setData({ fileReferenceMode: referenceMode === true, filesSheetOpen: true, filesSheetExpanded: false, filesEntries: [], filesLoading: true, filesError: '' });
    this.loadSessionFiles(null);
  },

  closeFilesSheet() {
    this._filesRequest = null;
    this.setData({ fileReferenceMode: false, filesSheetOpen: false, filesSheetExpanded: false, filesEntries: [], filesError: '', filesLoading: false });
  },

  filesGrabStart(e) {
    this._filesGrab = {
      y: e.touches[0].clientY,
      moved: false,
      applied: null
    };
  },

  filesGrabMove(e) {
    const g = this._filesGrab;
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (Math.abs(dy) < 20) return;
    const expand = dy < 0;
    if (g.applied !== expand) {
      g.applied = expand;
      g.moved = true;
      this.setData({ filesSheetExpanded: expand });
    }
  },

  filesGrabEnd() {
    const g = this._filesGrab;
    this._filesGrab = null;
    if (g && !g.moved) this.setData({ filesSheetExpanded: !this.data.filesSheetExpanded });
  },

  loadSessionFiles(relPath) {
    const sessionId = (store.sessionState && store.sessionState.sessionId) || '';
    if (!sessionId) {
      this.setData({ filesLoading: false, filesError: uiText('请先打开一个会话'), filesEntries: [] });
      return;
    }
    if (!store.state || store.state.connection !== 'connected') {
      this.setData({ filesLoading: false, filesError: uiText('请先连接鲸尾 Harness'), filesEntries: [] });
      return;
    }
    this._filesRel = relPath || null;
    const request = this._filesRequest = {}, context = this.composerContextKey();
    const current = () => !this._unloaded && this._filesRequest === request
      && (this.data.filesSheetOpen || (this.data.moreSheetOpen && this.data.morePane === 'files'))
      && this.composerContextKey() === context;
    this.setData({ filesLoading: true, filesError: '' });
    store.client.requestFileList(sessionId, relPath)
      .then((frame) => {
        if (!current() || !frame) return;
        const entries = (frame.entries || frame.items || []).map((item, index) => {
          const isDir = item.kind === 'dir' || item.kind === 'directory';
          return {
            name: item.name || item.title || '',
            path: item.path || '',
            kind: isDir ? 'dir' : 'file',
            iconFile: isDir ? 'folder-blue.png' : 'doc-ocean.png',
            key: (item.path || '') + '/' + index
          };
        });
        this._filesRel = frame.path || this._filesRel || null;
        const rel = this._filesRel;
        const isRoot = !rel || rel === '.' || rel === '/';
        this.setData({
          filesEntries: entries,
          filesIsRoot: isRoot,
          filesPathLabel: isRoot ? uiText('工作区根目录') : String(rel),
          filesLoading: false
        });
      })
      .catch((err) => {
        if (!current()) return;
        this.setData({ filesLoading: false, filesError: err.message || uiText('读取目录失败') });
      });
  },

  openSessionFile(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = (this.data.filesEntries || [])[index];
    if (!item) return;
    if (item.kind === 'dir') {
      this.loadSessionFiles(item.path);
      return;
    }
    if (this.data.fileReferenceMode) {
      const next = this.data.images.concat([{ id: util.uuid(), isFile: true, isWorkspaceRef: true, workspaceKind: item.kind === 'dir' ? 'directory' : 'file', path: item.path, name: item.name }]);
      this._draftRevision = (this._draftRevision || 0) + 1;
      this.closeFilesSheet();
      this.setData({ images: next, canSend: true, composerFocus: true });
      return;
    }
    wx.showModal({ title: item.name, content: item.path, showCancel: false, confirmText: uiText('知道了') });
  },

  sessionFilesGoUp() {
    const rel = this._filesRel;
    if (!rel || rel === '.' || rel === '/') {
      this.loadSessionFiles(null);
      return;
    }
    const idx = rel.lastIndexOf('/');
    this.loadSessionFiles(idx > 0 ? rel.substring(0, idx) : null);
  },

  onRenameInput(e) {
    // 只记录草稿，不 setData：受控 input 在长按删除时会出现光标/内容抖动
    this._renameDraft = e.detail && e.detail.value != null ? e.detail.value : '';
  },

  onRenameKeyboard(e) {
    const height = Number(e && e.detail && e.detail.height) || 0;
    if (height !== this.data.renameKeyboard) this.setData({ renameKeyboard: height });
  },

  onRenameFocus(e) {
    const height = e && e.detail && Number(e.detail.height);
    if (Number.isFinite(height) && height > 0) this.setData({ renameKeyboard: height });
  },

  onRenameBlur() {
    this.setData({ renameKeyboard: 0 });
  },

  confirmRename() {
    const s = store.sessionState;
    const draft = this._renameDraft != null ? this._renameDraft : this.data.renameValue;
    const title = String(draft || '').trim();
    if (!s.sessionId || !title) return;
    if (store.client.renameSession(s.sessionId, title) === false) {
      wx.showToast({ title: uiText('操作失败'), icon: 'none' });
      return;
    }
    // 先本地更新标题，避免等待 Host 回帧导致顶部标题不刷新
    if (typeof store.setSessionTitle === 'function') store.setSessionTitle(s.sessionId, title);
    if (store.sessionState.sessionId === s.sessionId) this.setData({ navTitle: title });
    this.closeMoreActions();
  },

  closeConfirmSheet() {
    this.setData({ confirmSheet: '' });
  },

  runConfirmSheet() {
    const kind = this.data.confirmSheet;
    const s = store.sessionState;
    this.setData({ confirmSheet: '' });
    if (kind === 'cancel') {
      if (s.sessionId) store.client.cancelSession(s.sessionId);
      return;
    }
    if (kind === 'archive') {
      if (!s.sessionId) return;
      if (store.client.archiveSession(s.sessionId) === false) {
        wx.showToast({ title: uiText('操作失败'), icon: 'none' });
        return;
      }
      if (store.sessionState.sessionId === s.sessionId) wx.navigateBack();
    }
  },

  /** 运行指标 → DSH「会话统计」popover */
  showStats() {
    const bundle = store.sessionState.stats || {};
    const st = bundle.stats || {};
    const compactDur = (ms) => {
      const v = Number(ms || 0);
      if (v >= 60000) return Math.floor(v / 60000) + uiText('分') + Math.round((v % 60000) / 1000) + uiText('秒');
      if (v >= 1000) return String(Math.round(v / 100) / 10).replace(/\.0$/, '') + uiText('秒');
      return Math.round(v) + uiText('毫秒');
    };
    const ttft = st.ttftSteps > 0 && st.ttftMs != null
      ? Number(st.ttftMs) / Number(st.ttftSteps)
      : (st.firstTokenMs != null ? Number(st.firstTokenMs) : null);
    const rate = st.decodeMs > 0 && st.decodeTokens != null
      ? Number(st.decodeTokens) / (Number(st.decodeMs) / 1000)
      : (st.decodeTokensPerSec != null ? Number(st.decodeTokensPerSec) : null);
    const rows = [
      { label: uiText('模型用时'), value: compactDur(st.llmMs) },
      { label: uiText('工具调用'), value: compactDur(st.toolMs) },
      { label: uiText('首 token 平均（TTFT）'), value: ttft == null ? '—' : compactDur(ttft) },
      { label: uiText('输出速度（TPS）'), value: rate == null ? '—' : String(Math.round(rate * 10) / 10).replace(/\.0$/, '') + ' tok/s' }
    ];
    this.setData({
      statsPopKind: 'run',
      statsPopTitle: uiText('会话统计'),
      statsPopTotal: '',
      statsPopRows: rows,
      statsPopOpen: true,
      showContextSheet: false
    });
  },

  /** Token 指标 → DSH「Token 用量」popover */
  showTokenStats() {
    const bundle = store.sessionState.stats || {};
    const usage = bundle.tokenUsage || {};
    const totals = usage.totals || {};
    const pick = (name) => {
      if (usage[name] != null) return Number(usage[name]);
      if (totals[name] != null) return Number(totals[name]);
      return null;
    };
    const uncachedInput = pick('uncachedInputTokens');
    const cacheRead = pick('cacheReadTokens');
    const output = pick('outputTokens');
    const cacheWrite = pick('cacheWriteTokens');
    const input = pick('inputTokens');
    const knownTotal = [uncachedInput, cacheRead, output].filter((value) => value != null)
      .reduce((sum, value) => sum + value, 0);
    const displayTotal = knownTotal > 0 ? knownTotal : (input == null ? 0 : input);
    const cacheBase = uncachedInput != null && cacheRead != null
      ? uncachedInput + cacheRead
      : [input, output, cacheRead, cacheWrite].filter((value) => value != null)
        .reduce((sum, value) => sum + value, 0);
    const cacheHit = cacheBase > 0 && cacheRead != null
      ? Math.round(Math.min(1, Math.max(0, cacheRead / cacheBase)) * 100) + '%'
      : '—';
    const fullToken = (value) => value == null ? '—' : numberWithCommas(Math.round(value)) + ' tok';
    this.setData({
      statsPopKind: 'token',
      statsPopTitle: uiText('Token 用量'),
      statsPopTotal: fullToken(displayTotal),
      statsPopRows: [
        { label: uiText('缓存命中'), value: cacheHit },
        { label: uiText('未缓存输入'), value: fullToken(uncachedInput != null ? uncachedInput : input) },
        { label: uiText('缓存读取'), value: fullToken(cacheRead) },
        { label: uiText('输出'), value: fullToken(output) }
      ],
      statsPopOpen: true,
      showContextSheet: false
    });
  },

  closeStatsPop() {
    this.setData({ statsPopOpen: false });
  },

  /** 在「更多」弹层内展开会话统计（执行 / Token 用量 / 上下文） */
  openStatsPane() {
    this.setData({ statsPopOpen: false, statsSheet: this.buildStatsGroups(), morePane: 'stats' });
  },

  buildStatsGroups() {
    const bundle = store.sessionState.stats || {};
    const st = bundle.stats || {};
    const tu = bundle.tokenUsage || {};
    const totals = tu.totals || {};
    const pressure = bundle.pressure || {};
    const fmtDur = (ms) => {
      const v = Number(ms || 0);
      if (v >= 60000) return Math.floor(v / 60000) + 'm ' + Math.round((v % 60000) / 1000) + 's';
      if (v >= 1000) return Math.round(v / 1000) + 's';
      return Math.round(v) + 'ms';
    };
    const fmtTok = (n) => (n == null ? '—' : numberWithCommas(Math.round(Number(n))) + ' tok');
    // 网关可能把 Token 放在 totals，也可能直接放在 tokenUsage 上，两者都要兼容
    const pickToken = (name) => {
      if (tu[name] != null) return Number(tu[name]);
      if (totals[name] != null) return Number(totals[name]);
      return null;
    };
    // 部分网关把上下文压力放在 stats.pressure，也可能挂在 stats 里
    const pressureTokens = pressure.pressureTokens != null
      ? pressure.pressureTokens
      : (bundle.stats && bundle.stats.pressureTokens != null ? bundle.stats.pressureTokens : null);
    const contextWindow = pressure.contextWindow != null
      ? pressure.contextWindow
      : (bundle.stats && bundle.stats.contextWindow != null ? bundle.stats.contextWindow : null);
    return [
      {
        title: uiText('执行'),
        rows: [
          [uiText('轮次'), (st.turns || 0) + uiText(' 轮')],
          [uiText('步骤'), (st.steps || 0) + uiText(' 步')],
          ['LLM', fmtDur(st.llmMs)],
          [uiText('工具调用'), fmtDur(st.toolMs)],
          [uiText('首 token 平均'), fmtDur(st.firstTokenMs)]
        ]
      },
      {
        title: uiText('Token 用量'),
        rows: [
          [uiText('输入'), fmtTok(pickToken('inputTokens') != null ? pickToken('inputTokens') : pickToken('uncachedInputTokens'))],
          [uiText('输出'), fmtTok(pickToken('outputTokens'))],
          [uiText('缓存读取'), fmtTok(pickToken('cacheReadTokens'))],
          [uiText('缓存写入'), fmtTok(pickToken('cacheWriteTokens'))]
        ]
      },
      {
        title: uiText('上下文'),
        rows: [
          [uiText('当前压力'), fmtTok(pressureTokens)],
          [uiText('上下文窗口'), fmtTok(contextWindow)]
        ]
      }
    ];
  },

  // ---------- 对话交互 ----------

  loadOlder() {
    // 加载更早历史会让 scrollTop 骤降，抑制这次位移的手势判定
    this._suppressScrollUntil = Date.now() + 600;
    store.loadOlderHistory();
  },

  onConvTouch() {
    this._suppressScrollUntil = 0;
    this._lastTouchAt = Date.now();
  },

  onConvScroll(e) {
    const d = (e && e.detail) || {};
    this.applyScrollPosition({
      scrollTop: Number(d.scrollTop) || 0,
      scrollHeight: Number(d.scrollHeight) || 0,
      clientHeight: Number(d.clientHeight) || 0,
      deltaY: Number(d.deltaY) || 0
    });
    this.updateConversationWindow(Number(d.scrollTop) || 0);
  },

  // Content growth and intermediate programmatic positions must not cancel following.
  applyScrollPosition(pos) {
    const scrollTop = Math.max(0, Number(pos.scrollTop) || 0);
    const scrollHeight = Math.max(0, Number(pos.scrollHeight) || 0);
    const clientHeight = Math.max(0, Number(pos.clientHeight) || this._convClientHeight || 0);
    if (!clientHeight) return;
    this._convClientHeight = clientHeight;
    const HIDE_WITHIN = 56;

    const maxScroll = Math.max(0, scrollHeight - clientHeight);

    // 距底距离；scrollHeight 不可信时退回 scrollTop 近似
    const distance = (scrollHeight > clientHeight && clientHeight > 0)
      ? scrollHeight - scrollTop - clientHeight
      : (scrollTop <= 8 ? 0 : scrollTop);

    // The viewport now ends above the composer; there is no hidden dock spacer.
    const ARROW_HIDE_WITHIN = HIDE_WITHIN;
    const ARROW_SHOW_AFTER = ARROW_HIDE_WITHIN + Math.min(24, Math.max(12, maxScroll * 0.05));

    const pinned = distance <= HIDE_WITHIN;
    const atVisualBottom = distance <= ARROW_HIDE_WITHIN;

    if (Date.now() < (this._suppressScrollUntil || 0)) {
      this._lastScrollTop = scrollTop;
      if (pinned) this._convPinned = true;
      return;
    }

    const movedUp = this._lastScrollTop !== undefined && scrollTop < this._lastScrollTop - 2;
    if (this._convPinned === true && !pinned && !movedUp) {
      this._lastScrollTop = scrollTop;
      if (Date.now() - (this._lastTouchAt || 0) >= 1000) this.refreshBottomAnchor();
      return;
    }
    this._lastScrollTop = scrollTop;
    const showJump = atVisualBottom
      ? false
      : distance > (this.data.showJump ? ARROW_HIDE_WITHIN : ARROW_SHOW_AFTER);
    if (showJump !== this.data.showJump) this.setData({ showJump: showJump });
    this._convPinned = pinned;
  },

  // Recheck the measured viewport when native scroll events omit its height.
  pollScrollPosition() {
    if (this._unloaded || this._voiceHidden || this.data.turnNavOpen || this.data.tab !== 'conversation' || this.data.moreSheetOpen || this.data.collaborationOpen) return;
    if (this._scrollPollPending) return;
    this._scrollPollPending = true;
    const query = wx.createSelectorQuery().in(this);
    query.select('.conversation').boundingClientRect();
    query.select('.conversation').scrollOffset();
    query.select('.conversation-inner').boundingClientRect();
    query.exec((res) => {
      this._scrollPollPending = false;
      if (this._unloaded || this._voiceHidden || this.data.turnNavOpen || this.data.tab !== 'conversation' || this.data.moreSheetOpen || this.data.collaborationOpen) return;
      const view = res && res[0];
      const offset = res && res[1];
      const inner = res && res[2];
      if (!view || !offset || !inner) return;
      // The viewport excludes the dock; only actual conversation content is measured.
      const scrollHeight = Math.max(0, Number(inner.height) || 0) + 8;
      this.applyScrollPosition({
        scrollTop: Number(offset.scrollTop) || 0,
        scrollHeight: scrollHeight,
        clientHeight: Number(view.height) || 0
      });
    });
  },

  startScrollPolling() {
    if (this._scrollPollTimer) return;
    this._scrollPollTimer = setInterval(() => this.pollScrollPosition(), 350);
  },

  stopScrollPolling() {
    if (this._scrollPollTimer) { clearInterval(this._scrollPollTimer); this._scrollPollTimer = null; }
  },

  /** 当前对话的节点定位：列出用户消息 / 过程 / 助手回复，可跳到任意节点。 */
  turnNavRowStyle(index, activeIndex) {
    const distance = activeIndex < 0 ? 0 : Math.abs(index - activeIndex);
    const blur = Math.min(4, distance * 0.7);
    const opacity = Math.max(0.14, 1 - distance * 0.16);
    const scale = Math.max(0.9, 1 - distance * 0.018);
    return `opacity:${opacity.toFixed(2)};filter:blur(${blur.toFixed(1)}px);transform:scale(${scale.toFixed(3)});`;
  },

  turnNavigatorPatch(rows) {
    // 对齐 DSH 客户端右侧对话大纲：标题＝用户发送内容，正文＝该轮助手的回答
    const snippet = (value, max) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      const limit = max || 60;
      return text.length > limit ? text.slice(0, limit) + '…' : text;
    };
    const turns = [];
    let current = null;
    rows.forEach((row) => {
      if (!row || !row.key) return;
      if (row.kind === 'user') {
        current = {
          key: row.key,
          sent: String(row.text || row.copyText || '').trim(),
          reply: '',
          processTitle: ''
        };
        turns.push(current);
        return;
      }
      if (!current) return;
      if (row.kind === 'assistant') {
        const text = String(row.text || row.outputText || '').trim();
        if (text) current.reply = text;
      } else if (row.kind === 'processGroup' && !current.processTitle) {
        current.processTitle = row.title || row.summary || '';
      }
    });
    let userIndex = 0;
    const items = turns.map((turn) => {
      userIndex += 1;
      const title = snippet(turn.sent, 120);
      const replyPreview = turn.reply || turn.processTitle || '';
      return {
        key: turn.key,
        kind: 'user',
        index: userIndex,
        // 列表只显示发送内容作为标题
        label: title || uiText('轮次') + ' ' + userIndex,
        detail: uiText('轮次') + ' ' + userIndex,
        // 选中行第二行显示助手回答正文（浅色、两行）
        preview: snippet(replyPreview, 120),
        full: snippet(replyPreview || turn.sent, 800)
      };
    }).reverse();
    const selected = (this.data.turnNavItems || [])[this.data.turnNavActiveIndex];
    const selectedIndex = selected ? items.findIndex(item => item.key === selected.key) : -1;
    const active = selectedIndex >= 0 ? selectedIndex : (this.data.turnNavOpen && items.length ? 0 : -1);
    return { turnNavItems: items, turnNavActiveIndex: active,
      turnNavWidths: items.map((_, index) => active < 0 ? 30 : Math.max(30, 112 - Math.abs(index - active) * 16)),
      turnNavRowStyles: items.map((_, index) => this.turnNavRowStyle(index, active)) };
  },

  openTurnNavigator() {
    this.prioritizeInteraction();
    this._turnScrollTop = 0;
    this._turnListRect = null;
    this._turnScrubbing = false;
    this._turnOlderRequestKey = '';
    this._turnNavigatorTouched = false;
    const active = this.data.turnNavItems.length ? 0 : -1;
    this.setData({
      turnNavOpen: true,
      turnNavScrollTop: 0,
      turnNavActiveIndex: active,
      turnNavWidths: this.data.turnNavItems.map((_, index) => Math.max(30, 112 - index * 16)),
      turnNavRowStyles: this.data.turnNavItems.map((_, index) => this.turnNavRowStyle(index, active)),
      turnNavPreview: null
    }, () => wx.nextTick(() => {
      if (!this.data.turnNavOpen || this._unloaded) return;
      this.measureTurnRail();
      this.autoLoadTurnNavigatorHistory(null, true);
    }));
  },

  measureTurnRail() {
    const query = wx.createSelectorQuery();
    let windowWidth = 375;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = Number(info && info.windowWidth) || windowWidth;
    } catch (e) { /* 忽略 */ }
    query.select('#turn-scrub-list').boundingClientRect((rect) => {
      if (!this.data.turnNavOpen || this._unloaded || !rect || rect.height <= 0) return;
      const rowHeight = 76 * windowWidth / 750;
      const spacer = Math.max(0, (rect.height - rowHeight) / 2);
      this._turnListRect = {
        top: rect.top,
        height: rect.height,
        rowHeight,
        spacer
      };
      if (Math.abs((Number(this.data.turnNavSpacerPx) || 0) - spacer) > 1) this.setData({ turnNavSpacerPx: spacer });
    }).exec();
    if (this._convPinned !== false || this.data.tab !== 'conversation') return;
    // 找当前对话正在看的位置：视口内第一条用户消息，默认高亮它
    query.select('.conversation').boundingClientRect((conv) => {
      query.selectAll('.row-user').boundingClientRect((rows) => {
        if (!this.data.turnNavOpen || this._unloaded || this._turnNavigatorTouched || this._convPinned !== false || !conv || !conv.height || !rows || !rows.length) return;
        const total = (this.data.turnNavItems || []).length;
        if (!total) return;
        let firstVisible = 0;
        for (let i = 0; i < rows.length; i += 1) {
          if (rows[i].top <= conv.top + 12) firstVisible = i;
          else break;
        }
        // items 是倒序（最新在上），用户行是正序
        const index = Math.max(0, Math.min(total - 1, total - 1 - firstVisible));
        this.applyTurnIndex(index, false);
        const rect = this._turnListRect;
        if (rect) {
          const top = Math.max(0, index * rect.rowHeight);
          this._turnScrollTop = top;
          this.setData({ turnNavScrollTop: top });
        }
      }).exec();
    }).exec();
  },

  onTurnListScroll(e) {
    const detail = (e && e.detail) || {};
    const top = Number(detail.scrollTop) || 0;
    this._turnScrollTop = top;
    const rect = this._turnListRect;
    if (rect && rect.rowHeight > 0) this.applyTurnIndex(Math.round(top / rect.rowHeight));
    this.autoLoadTurnNavigatorHistory(detail, false);
  },

  applyTurnIndex(index, feedback = true) {
    const items = this.data.turnNavItems || [];
    const item = items[index];
    if (!item) return;
    if (index === this.data.turnNavActiveIndex) return;
    const patch = { turnNavActiveIndex: index };
    const styled = new Set();
    const railed = new Set();
    for (const center of [this.data.turnNavActiveIndex, index]) {
      if (center < 0) continue;
      for (let i = Math.max(0, center - 8); i <= Math.min(items.length - 1, center + 8); i++) styled.add(i);
      for (let i = Math.max(0, center - 5); i <= Math.min(items.length - 1, center + 5); i++) railed.add(i);
    }
    styled.forEach(i => {
      const style = this.turnNavRowStyle(i, index);
      if (this.data.turnNavRowStyles[i] !== style) patch['turnNavRowStyles[' + i + ']'] = style;
    });
    railed.forEach(i => {
      const width = Math.max(30, 112 - Math.abs(i - index) * 16);
      if (this.data.turnNavWidths[i] !== width) patch['turnNavWidths[' + i + ']'] = width;
    });
    if (feedback) haptics.tick();
    this.setData(patch);
  },

  onTurnScrubStart(e) {
    if (!e || !e.touches || !e.touches[0]) return;
    this._turnNavigatorTouched = true;
    this._turnScrubbing = true;
  },

  onTurnScrubEnd() {
    this._turnScrubbing = false;
  },

  autoLoadTurnNavigatorHistory(detail, fillViewport, force) {
    const items = this.data.turnNavItems || [];
    if (!this.data.turnNavOpen || !this.data.hasMoreHistory || this.data.historyLoading) return;
    if (this.data.histError && !force) return;

    const rect = this._turnListRect || {};
    let windowWidth = 375;
    let windowHeight = 800;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = Number(info && info.windowWidth) || windowWidth;
      windowHeight = Number(info && info.windowHeight) || windowHeight;
    } catch (_) { /* Keep a safe viewport estimate. */ }
    const rowHeight = rect.rowHeight || 76 * windowWidth / 750;
    const clientHeight = Number(detail && detail.clientHeight) || rect.height || windowHeight * 0.76;
    const scrollTop = Number(detail && detail.scrollTop) || 0;
    const contentHeight = Number(detail && detail.scrollHeight)
      || items.length * rowHeight + 2 * (rect.spacer || Math.max(0, (clientHeight - rowHeight) / 2));
    const nearOlderEdge = scrollTop + clientHeight >= contentHeight - Math.max(rowHeight * 2, 80);
    if (!nearOlderEdge && !(fillViewport && items.length < 8)) return;

    const session = store.sessionState || {};
    const requestKey = String(session.sessionId || '') + ':' + String(session.nextBeforeSeq == null ? '' : session.nextBeforeSeq);
    if (!requestKey || (this._turnOlderRequestKey === requestKey && !force)) return;
    this._turnOlderRequestKey = requestKey;
    this.loadOlder();
  },

  retryTurnNavigatorHistory() {
    this._turnOlderRequestKey = '';
    this.setData({ histError: '' });
    this.autoLoadTurnNavigatorHistory(null, true, true);
  },

  closeTurnNavigator() {
    this._turnListScrolling = false;
    this._turnScrubbing = false;
    this.setData({ turnNavOpen: false, turnNavPreview: null });
  },

  onTurnScrubCancel() { this._turnScrubbing = false; },

  /** 手指划过/悬停某一条时，在列表上方浮出该轮消息卡片。 */
  showTurnPreview(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = (this.data.turnNavItems || [])[index];
    if (!item) return;
    this.setData({
      turnNavPreview: {
        key: item.key,
        label: item.label,
        detail: item.detail,
        body: item.full || item.label
      }
    });
  },

  hideTurnPreview() {
    this.setData({ turnNavPreview: null });
  },

  jumpToTurn(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    haptics.vibrate();
    if (this.data.tab !== 'conversation') this.switchTab({ currentTarget: { dataset: { tab: 'conversation' } } });
    this._convPinned = false;
    this.revealConversationRow(key);
    this.setData({ turnNavOpen: false, scrollTarget: '', scrollAnim: true }, () => {
      wx.nextTick(() => {
        this.setData({ scrollTarget: key });
        this._turnJumpTimer = setTimeout(() => {
          this._convPinned = false;
          this.setData({ scrollAnim: false });
        }, 400);
      });
    });
  },

  // 每次进入/切换会话都重新跟随最新消息，不继承上次阅读历史的位置。
  resetConversationScroll() {
    if (this._turnJumpTimer) clearTimeout(this._turnJumpTimer);
    this._turnJumpTimer = null;
    this._convPinned = true;
    this._lastTouchAt = 0;
    this._userScrolledUp = false;
    this._lastScrollTop = undefined;
    this.setData({ showJump: false, scrollAnim: false, scrollTarget: '' });
  },

  jumpToBottom() {
    this.resetConversationScroll();
    if (this._conversationRows) {
      this.setData(dataPatch(this.data, this.conversationWindowPatch(this._conversationRows)));
      this.scheduleAttachmentThumbs();
    }
    this.refreshBottomAnchor();
  },

  refreshBottomAnchor() {
    if (this._bottomAnchorPending || this._unloaded || this.data.tab !== 'conversation') return;
    // 空对话的空态（鲸鱼 + 说明）本身要垂直居中，贴底滚动会把整块内容顶高；
    // 有消息后再贴底，所以空态下直接跳过这次贴底。
    if (!this.data.rows.length && this.data.historyLoaded && !this.data.running) return;
    this._bottomAnchorPending = true;
    this._suppressScrollUntil = Date.now() + 400;
    const touch = this._lastTouchAt;
    this.setData({ scrollTarget: '' }, () => wx.nextTick(() => {
      this._bottomAnchorPending = false;
      if (!this._unloaded && !this._voiceHidden && this.data.tab === 'conversation' && touch === this._lastTouchAt && this._convPinned !== false) this.setData({ scrollTarget: 'conv-bottom' });
    }));
  },

  toggleFold(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.prioritizeInteraction();
    const patch = {};
    patch['folds.' + key] = !this.data.folds[key];
    this.setData(patch, () => this.measureConversationWindow());
  },

  copyCode(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.text || '' });
  },

  // ---------- 图片附件回显 ----------

  /** 把本地缓存路径补回 localUrl：历史行只有 attachmentId，直接渲染会得到空白图。 */
  decorateRowImages(images) {
    if (!Array.isArray(images) || !images.length) return images || [];
    let changed = false;
    const next = images.map((image) => {
      if (!image || image.localUrl || image.thumbUrl || !image.attachmentId) return image;
      const local = attachmentCache.localPath(image, { api: wx });
      if (!local) return image;
      changed = true;
      return Object.assign({}, image, { localUrl: local });
    });
    return changed ? next : images;
  },

  /** 合并短时间内的多次渲染，避免流式输出时反复扫描会话行。 */
  scheduleAttachmentThumbs() {
    if (this._unloaded || this._thumbTimer) return;
    const self = this;
    this._thumbTimer = setTimeout(() => {
      self._thumbTimer = null;
      if (!self._unloaded) self.collectAttachmentThumbs();
    }, 80);
  },

  /** 收集当前可见行里尚未缓存的图片，按顺序串行回填（网关同类型请求只能有一个在途）。 */
  collectAttachmentThumbs() {
    const client = store.client, sessionId = store.sessionState && store.sessionState.sessionId;
    if (!client || !sessionId || this._unloaded) return;
    if (this._thumbSession !== sessionId) {
      this._thumbSession = sessionId;
      this._thumbQueued = new Set();
      this._thumbFailed = null;
      this._thumbQueue = [];
    }
    const queue = this._thumbQueue || (this._thumbQueue = []);
    const queued = this._thumbQueued || (this._thumbQueued = new Set());
    const failed = this._thumbFailed || (this._thumbFailed = new Map());
    const now = Date.now();
    (this.data.rows || []).forEach((row) => {
      if (!row || row.pending || !row.images || !row.images.length) return;
      row.images.forEach((image) => {
        if (!image || !image.attachmentId) return;
        const id = String(image.attachmentId);
        if (queued.has(id) || attachmentCache.localPath(image, { api: wx })) return;
        const failure = failed.get(id);
        if (failure && now < failure.at) return;
        // 本机刚发送的图片已有临时文件：复制进缓存即可，不必再向网关要一遍字节。
        if (!image.tempPath && image.localUrl) return;
        queued.add(id);
        queue.push({ attachmentId: id, mediaType: image.mediaType, name: image.name, tempPath: image.tempPath || '' });
      });
    });
    this.pumpAttachmentThumbs();
  },

  pumpAttachmentThumbs() {
    if (this._thumbBusy || this._unloaded) return;
    const queue = this._thumbQueue;
    if (!queue || !queue.length) return;
    const sessionId = store.sessionState && store.sessionState.sessionId;
    const client = store.client;
    if (!client || !sessionId) return;
    const next = queue.shift();
    this._thumbBusy = true;
    const load = next.tempPath
      ? attachmentCache.adoptFromFile(next, next.tempPath, { api: wx })
        .catch(() => attachmentCache.fetchImage(client, sessionId, next, { api: wx }))
      : attachmentCache.fetchImage(client, sessionId, next, { api: wx });
    load.then((path) => {
      if (this._unloaded || !path) return;
      if (!store.sessionState || store.sessionState.sessionId !== sessionId) return;
      this.applyAttachmentPaths({ [next.attachmentId]: path });
    }).catch(() => {
      // 失败退避：30s 起、逐次翻倍、上限 5 分钟，避免坏附件反复打网关。
      const failure = this._thumbFailed && this._thumbFailed.get(next.attachmentId);
      const count = failure ? (failure.count || 1) + 1 : 1;
      const delay = Math.min(300000, 30000 * Math.pow(2, count - 1));
      if (this._thumbFailed) this._thumbFailed.set(next.attachmentId, { at: Date.now() + delay, count });
    }).finally(() => {
      this._thumbBusy = false;
      // 成功与否都放回可重试集合：成功由缓存命中兜底，失败由退避时间兜底。
      if (this._thumbQueued) this._thumbQueued.delete(next.attachmentId);
      if (!this._unloaded) this.pumpAttachmentThumbs();
    });
  },

  /** 图片本地路径就绪后只 patch 变化的 image 字段，并把窗口行对象一起更新。 */
  applyAttachmentPaths(paths) {
    const ids = Object.keys(paths || {});
    if (!ids.length) return;
    const patchRow = (row) => {
      if (!row || !Array.isArray(row.images) || !row.images.length) return row;
      let changed = false;
      const images = row.images.map((image) => {
        const path = image && paths[image.attachmentId];
        if (!path || image.localUrl === path) return image;
        changed = true;
        return Object.assign({}, image, { localUrl: path });
      });
      if (!changed) return row;
      const next = Object.assign({}, row, { images });
      if (Array.isArray(row.stackImages)) {
        next.stackImages = row.stackImages.map((image) => {
          const path = image && paths[image.attachmentId];
          return path && image.localUrl !== path ? Object.assign({}, image, { localUrl: path }) : image;
        });
      }
      return next;
    };
    // 窗口缓存复用同一批行对象，就地更新，下一次窗口切片才不会退回空白。
    if (Array.isArray(this._conversationRows)) {
      this._conversationRows = this._conversationRows.map((row) => {
        const next = patchRow(row);
        if (next !== row) Object.assign(row, next);
        return row;
      });
    }
    const rows = (this.data.rows || []).map(patchRow);
    const patch = dataPatch(this.data, { rows });
    if (Object.keys(patch).length) this.setData(patch);
  },

  previewAttachment(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rows.find((r) => (r.images || []).some((img) => img.attachmentId === id));
    const image = (row && row.images.find((img) => img.attachmentId === id)) || { attachmentId: id };
    const cached = image.localUrl || attachmentCache.localPath(image, { api: wx });
    if (cached) {
      this.applyAttachmentPaths({ [id]: cached });
      wx.previewImage({ urls: [cached] });
      return;
    }
    const sessionId = store.sessionState.sessionId;
    attachmentCache.fetchImage(store.client, sessionId, image, { api: wx }).then((path) => {
      if (this._unloaded) return;
      this.applyAttachmentPaths({ [id]: path });
      wx.previewImage({ urls: [path] });
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) || uiText('附件加载失败'), icon: 'none' });
    });
  },

  openMessageAttachment(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset;
    const rowIndex = Number(dataset && dataset.rowIndex);
    const attachmentIndex = Number(dataset && dataset.attachmentIndex);
    const row = Number.isInteger(rowIndex) && rowIndex >= 0 ? this.data.rows[rowIndex] : null;
    const att = row && Array.isArray(row.attachments) && Number.isInteger(attachmentIndex)
      ? row.attachments[attachmentIndex]
      : null;
    if (!att) return;
    if (att.kind === 'directory') {
      wx.showToast({ title: att.path || '工作区目录', icon: 'none' });
      return;
    }
    if (att.attachmentId) {
      this.previewAttachment({ currentTarget: { dataset: { id: att.attachmentId } } });
      return;
    }
    if (att.path && typeof this.presentFile === 'function') {
      return this.presentFile({
        sessionId: store.sessionState.sessionId,
        path: att.path,
        name: att.name || att.path,
        mediaType: att.mediaType,
        size: att.bytes,
        key: `message-attachment:${row.key || rowIndex}:${attachmentIndex}`
      }, 'preview');
    }
    wx.showToast({ title: att.name || att.path || '文件附件', icon: 'none' });
  },

  // ---------- 问题应答 ----------

  toggleQCollapse() {
    this.setData({ qCollapsed: !this.data.qCollapsed });
    this.updateDockInset();
  },

  qPrev() {
    if (this.data.questionBusy || this.data.qIndex <= 0) return;
    this.setData({ qIndex: this.data.qIndex - 1 });
    this.updateDockInset();
  },

  qNext() {
    const question = this.data.question;
    if (this.data.questionBusy || !question) return;
    if (this.data.qIndex >= question.questions.length - 1) return;
    this.setData({ qIndex: this.data.qIndex + 1 });
    this.updateDockInset();
  },

  toggleOption(e) {
    const { qid, label } = e.currentTarget.dataset;
    const question = this.data.question;
    if (!question) return;
    this.questionDraft = this.questionDraft || {};
    const q = question.questions.find((item) => item.id === qid);
    if (!q) return;
    const current = this.questionDraft[qid] || {};
    if (q.allowsMultipleSelections) {
      current[label] = !current[label];
    } else {
      const next = {};
      Object.keys(current).forEach((k) => { next[k] = false; });
      next[label] = !current[label];
      this.questionDraft[qid] = next;
      this.setData({ 'question.questions': decorateQuestion(store.sessionState.pendingQuestion, this.questionDraft).questions });
      return;
    }
    this.questionDraft[qid] = current;
    this.setData({ 'question.questions': decorateQuestion(store.sessionState.pendingQuestion, this.questionDraft).questions });
  },

  onCustomInput(e) {
    const qid = e.currentTarget.dataset.qid;
    this.questionDraft = this.questionDraft || {};
    this.customDraft = this.customDraft || {};
    this.customDraft[qid] = e.detail.value;
    // 输入自定义答案清空该题已选（对齐 iOS）
    if (e.detail.value && this.questionDraft[qid]) {
      this.questionDraft[qid] = {};
      this.setData({ 'question.questions': decorateQuestion(store.sessionState.pendingQuestion, this.questionDraft).questions });
    }
  },

  submitQuestion() {
    const pending = store.sessionState.pendingQuestion;
    if (!pending || this.data.questionBusy) return;
    const self = this;
    const draft = this.questionDraft || {};
    const custom = this.customDraft || {};
    const answers = pending.questions.map((q) => {
      const selected = Object.keys(draft[q.id] || {}).filter((k) => draft[q.id][k]);
      const answer = { id: q.id, selected: selected };
      if (custom[q.id] && custom[q.id].trim()) answer.custom = custom[q.id].trim();
      return answer;
    });
    // 校验：有选项的题目须选择或填写自定义（对齐 iOS 文案）
    const missing = pending.questions.some((q) => {
      if (!(q.options && q.options.length)) return false;
      const picked = Object.keys(draft[q.id] || {}).filter((k) => draft[q.id][k]).length > 0;
      const typed = !!(custom[q.id] && custom[q.id].trim());
      return !picked && !typed;
    });
    if (missing) {
      wx.showToast({ title: uiText('请选择一个选项或填写自定义答案。'), icon: 'none' });
      return;
    }
    this.setData({ questionBusy: true });
    store.client.answerQuestion(pending.rpcId, pending.sessionId, answers)
      .then(() => {
        self.questionDraft = {};
        self.customDraft = {};
        wx.showToast({ title: uiText('已提交'), icon: 'success' });
      })
      .catch((err) => {
        self.setData({ questionBusy: false });
        wx.showToast({ title: err.message || uiText('提交失败'), icon: 'none' });
      });
  },

  /** 展开"或输入自定义答案"输入框 */
  focusCustom(e) {
    const qid = e.currentTarget.dataset.qid;
    this.customDraft = this.customDraft || {};
    if (this.customDraft[qid] === undefined) {
      this.customDraft[qid] = '';
      if (store.sessionState.pendingQuestion) {
        this.setData({ 'question.custom': Object.assign({}, this.customDraft) });
      }
    }
  },

  cancelQuestion() {
    wx.showModal({
      title: uiText('放弃这组问题？'),
      content: uiText('当前填写的答案不会提交。'),
      confirmText: uiText('放弃'),
      cancelText: uiText('继续回答'),
      confirmColor: '#E5533C',
      success: (res) => {
        if (!res.confirm) return;
        const pending = store.sessionState.pendingQuestion;
        if (pending) store.client.cancelQuestion(pending.rpcId, pending.sessionId).catch(() => {});
      }
    });
  },

  // ---------- 审批 ----------

  allowApproval() {
    this.respondApproval('allowed-once');
  },

  rejectApproval() {
    this.respondApproval('rejected');
  },

  respondApproval(outcome) {
    const pending = store.sessionState.pendingApproval;
    if (!pending || this.data.approvalBusy) return;
    const self = this;
    this.setData({ approvalBusy: true });
    store.client.respondToApproval(pending.rpcId, pending.sessionId, pending.approvalId, outcome)
      .catch((err) => {
        self.setData({ approvalBusy: false });
        wx.showToast({ title: err.message || uiText('操作失败'), icon: 'none' });
      });
  },

  // ---------- 输入面板 ----------

  onDraftInput(e) {
    this.prioritizeInteraction();
    this._draftRevision = (this._draftRevision || 0) + 1;
    this._composerCursor = e.detail.cursor;
    const value = e.detail.value;
    this._dismissedCommandDraft = null;
    if (this.data.attachSheetOpen) this.closeAttachMenu();
    this.setData({ draft: value, canSend: !!value.trim() || this.data.images.length > 0 });
    this.syncCommandMenu(value, store.sessionState);
  },

  onComposerLineChange(e) {
    // Native textarea reports actual height changes; typing every character must not
    // start another three-pass selector query/retry chain across the data bridge.
    const height = e.detail && e.detail.height;
    if (!Number.isFinite(height) || height === this._composerHeight) return;
    this._composerHeight = height;
    this.updateDockInset();
  },

  syncCommandMenu(value, session) {
    const text = String(value || '');
    const groups = Array.isArray(session.commandGroups) ? session.commandGroups : [];
    const commands = composerMenu.commands(groups);
    const active = commands.find(command => command.id === this._commandInputId && commandMatchesInput(command, text))
      || commands.find((command) => commandMatchesInput(command, text)) || null;
    const lookup = text.charAt(0) === '/' && !/\s/.test(text.slice(1)) && this._dismissedCommandDraft !== text;
    const query = lookup ? text.slice(1).toLowerCase() : '';
    let menu = null;
    if (this._commandOptionName) {
      menu = {
        type: 'options',
        title: composerMenu.optionTitle(this._commandOptionName, uiText),
        command: this._commandOptionName,
        groups: [],
        options: composerMenu.optionRows(this._commandOptionName, this._commandOptions, { t: uiText, query: this.data.commandMenuQuery })
      };
    } else if (lookup || this.data.attachSheetOpen) {
      const cursor = Number.isInteger(this._composerCursor) ? Math.max(0, Math.min(text.length, this._composerCursor)) : text.length;
      const filtered = composerMenu.catalog(groups, { t: uiText, dark: this.data.theme === 'dark', query: this.data.commandMenuQuery || (this.data.attachSheetOpen ? '' : query),
        leading: lookup || !text.slice(0, cursor).trim(), canAttach: composerMenu.acceptsAttachments(active) });
      menu = { type: 'catalog', title: '', groups: filtered, options: [] };
    }
    const ui = active && active.ui || {};
    const hint = ui.displayHint || ui.hint || (active && active.input && active.input.hint) || '';
    this._activeCommand = active;
    const patch = dataPatch(this.data, {
      commandMenu: menu,
      canAttach: composerMenu.acceptsAttachments(active),
      composerPlaceholder: hint || uiText(this.data.voiceEnabled ? '输入内容或按住说话' : '输入内容')
    });
    if (this.data.tab !== 'conversation') patch.commandMenu = null;
    if (Object.keys(patch).length) {
      this.setData(patch);
      if (Object.keys(patch).some(key => key === 'commandMenu' || key.indexOf('commandMenu.') === 0 || key.indexOf('commandMenu[') === 0)) this.updateDockInset();
    }
  },

  selectCommand(e) {
    if (this._commandSubmitting || this.data.sendingAttachments) return;
    const action = e.currentTarget.dataset.action;
    if (action === 'image') { this.chooseImage(); return; }
    if (action === 'chatImage') { this.chooseFile(); return; }
    if (action === 'workspace') { this.chooseWorkspaceReference(); return; }
    if (action === 'chatFile') { this.chooseChatFile(); return; }
    const name = e.currentTarget.dataset.name;
    const id = e.currentTarget.dataset.id;
    const command = composerMenu.commands(store.sessionState.commandGroups).find(item => id ? item.id === id : item.name === name);
    if (!command || !command.ui) return;
    if (!store.state || store.state.connection !== 'connected' || !store.sessionState.sessionId) {
      this.setData({ commandPaletteError: uiText('连接主机后可读取指令') }); return;
    }
    if (this.data.images.length && !composerMenu.acceptsAttachments(command)) {
      wx.showToast({ title: uiText('此指令不接受附件，请先移除附件'), icon: 'none' }); return;
    }
    const ui = command.ui;
    if (ui.kind === 'select') {
      return this.openCommandOptions(command.name);
    }
    if (ui.kind === 'input') {
      const insertText = composerMenu.inputDraft(command, this.data.draft);
      this.closeAttachMenu();
      this._commandInputId = command.id;
      this._draftRevision = (this._draftRevision || 0) + 1;
      this.setData({ draft: insertText, canSend: !!insertText.trim(), composerFocus: true });
      this.syncCommandMenu(insertText, store.sessionState);
      return;
    }
    const typed = this.data.draft.startsWith('/') && !this.data.attachSheetOpen;
    const draft = this.data.draft;
    this.closeAttachMenu();
    const line = ui.submitText || ('/' + command.name);
    return this.submitCommand(command, line, [], true).then(result => {
      if (result !== false && typed && this.data.draft === draft && !this._unloaded) this.setData({ draft: '', canSend: this.data.images.length > 0 });
    });
  },

  selectCommandOption(e) {
    const optionId = e.currentTarget.dataset.id;
    const command = this._commandOptionName;
    if (!command || !optionId || this.data.commandPaletteLoading || this._commandSubmitting || !(this._commandOptions || []).some(item => item.id === optionId)) return;
    const context = this.composerContextKey(), request = this._commandOptionRequest = {};
    this._commandSubmitting = true;
    this.setData({ commandPaletteLoading: true, commandPaletteError: '' });
    return store.client.selectCommandOption(store.sessionState.sessionId, command, optionId).then(() => {
      if (!this._unloaded && this._commandOptionRequest === request && this.composerContextKey() === context) {
        const typed = this._commandOptionTypedDraft;
        if (typed && this.data.draft === typed) this.setData({ draft: '', canSend: this.data.images.length > 0 });
        this.closeAttachMenu();
      }
    }).catch(err => {
      if (!this._unloaded && this._commandOptionRequest === request && this.composerContextKey() === context) this.setData({ commandPaletteError: err.message || uiText('选择失败') });
    }).finally(() => {
      this._commandSubmitting = false;
      if (!this._unloaded && this.composerContextKey() === context) this.setData({ commandPaletteLoading: false });
    });
  },

  submitCommand(command, line, encodedImages, preserveDraft = false, notificationTicket) {
    const request = command.ui && command.ui.submitRequest;
    const context = this.composerContextKey(), revision = this._draftRevision || 0;
    if ((encodedImages || []).length && !composerMenu.acceptsAttachments(command)) return Promise.resolve(false);
    if (request === 'message') {
      const ticketPromise = notificationTicket === undefined
        ? notifySubscription.requestCompletionTicket()
        : Promise.resolve(notificationTicket || '');
      const self = this;
      return ticketPromise.then(ticket => {
        if (self._unloaded) return false;
        if (store.sessionState.running) {
          // 运行中发送：消息进本机队列等待用户点“发送”箭头，
          // 不再走网关 queue 模式（会被宿主在回合结束时自动发出）。
          self.enqueueSubmission(line, encodedImages || [], [], [], ticket);
          if (!preserveDraft) self.setData({ draft: '', images: [], canSend: false, commandMenu: null });
          self.jumpToBottom();
          return true;
        }
        const sent = store.client.sendMessage(line, store.sessionState.sessionId, store.state.currentWorkspaceId, encodedImages, undefined, ticket);
        if (sent !== false) {
          store.appendLocalUserRow(line, []);
          self.jumpToBottom();
        }
        if (sent !== false && !preserveDraft) self.setData({ draft: '', images: [], canSend: false, commandMenu: null });
        return sent;
      });
    }
    if (request === 'command-execute') {
      if (this._commandSubmitting) return Promise.resolve(false);
      this._commandSubmitting = true;
      this.setData({ commandLoading: true });
      return store.client.executeCommand(store.sessionState.sessionId, line, encodedImages).then(() => {
        if (this._unloaded || this.composerContextKey() !== context) return false;
        if (!preserveDraft && (this._draftRevision || 0) === revision) this.setData({ draft: '', images: [], canSend: false, commandMenu: null });
        this.setData({ commandLoading: false });
        this.jumpToBottom();
        return true;
      }).catch((err) => {
        if (this._unloaded || this.composerContextKey() !== context) return false;
        this.setData({ commandLoading: false });
        wx.showToast({ title: err.message || uiText('命令执行失败'), icon: 'none' });
        return false;
      }).finally(() => { this._commandSubmitting = false; });
    }
    return Promise.resolve(false);
  },

  composerContextKey() {
    return [store.state && store.state.activeID, store.client && store.client.connectGeneration, store.sessionState.sessionId].join(':');
  },

  /** The desktop + and slash trigger share one Host-backed command menu. */
  attachMenu() {
    if (this.data.attachSheetOpen || this._commandOptionName) { this.closeAttachMenu(); return; }
    if (this.data.sendingAttachments || this._commandSubmitting || this.data.voiceOverlayVisible) return;
    this.prioritizeInteraction();
    this._composerContextKey = this.composerContextKey();
    this._dismissedCommandDraft = null;
    this.setData({ attachSheetOpen: true, commandMenuQuery: '', commandPaletteError: '', modelSheetOpen: false, effortSheetOpen: false, permissionSheet: [], composerFocus: false });
    this.syncCommandMenu(this.data.draft, store.sessionState);
    return this.refreshComposerCommands();
  },

  closeAttachMenu(measure = true) {
    const hadMenu = !!this.data.commandMenu;
    this._commandRequest = null; this._commandOptionRequest = null;
    this._commandOptionName = ''; this._commandOptions = [];
    this._dismissedCommandDraft = this.data.draft;
    const patch = dataPatch(this.data, { attachSheetOpen: false, commandMenu: null, commandMenuQuery: '', commandPaletteLoading: false, commandPaletteError: '' });
    if (Object.keys(patch).length) this.setData(patch);
    if (measure !== false && hadMenu) this.updateDockInset();
  },

  onCommandMenuSearch(e) {
    this.setData({ commandMenuQuery: e.detail.value });
    this.syncCommandMenu(this.data.draft, store.sessionState);
  },

  refreshComposerCommands() {
    if (this._commandOptionName) return this.openCommandOptions(this._commandOptionName);
    if (!store.sessionState.sessionId || !store.state || store.state.connection !== 'connected') {
      this.setData({ commandPaletteError: uiText('连接主机后可读取指令') }); return Promise.resolve();
    }
    const request = this._commandRequest = {}, context = this.composerContextKey();
    const current = () => !this._unloaded && this._commandRequest === request && this.composerContextKey() === context;
    this.setData({ commandPaletteLoading: true, commandPaletteError: '' });
    return store.client.requestCommands(store.sessionState.sessionId).then(frame => {
      if (!current()) return;
      if (!frame || !Array.isArray(frame.groups)) throw Error(uiText('无效的主机响应'));
      store.sessionState.commandGroups = frame.groups;
      this.syncCommandMenu(this.data.draft, store.sessionState);
    }).catch(err => { if (current()) this.setData({ commandPaletteError: err.message || uiText('指令加载失败') }); })
      .finally(() => { if (current()) this.setData({ commandPaletteLoading: false }); });
  },

  openCommandOptions(name) {
    this._composerContextKey = this.composerContextKey();
    if (!this._commandOptionName) this._commandOptionTypedDraft = !this.data.attachSheetOpen && this.data.draft.startsWith('/') ? this.data.draft : '';
    const request = this._commandOptionRequest = {}, context = this.composerContextKey();
    const current = () => !this._unloaded && this._commandOptionRequest === request && this.composerContextKey() === context;
    this._commandRequest = null; this._commandOptionName = name; this._commandOptions = [];
    this.setData({ attachSheetOpen: true, commandMenuQuery: '', commandPaletteLoading: true, commandPaletteError: '' });
    this.syncCommandMenu(this.data.draft, store.sessionState);
    return store.client.requestCommandOptions(store.sessionState.sessionId, name).then(frame => {
      if (!current()) return;
      if (!frame || !Array.isArray(frame.options)) throw Error(uiText('无效的主机响应'));
      this._commandOptions = frame.options; this.syncCommandMenu(this.data.draft, store.sessionState);
    }).catch(err => { if (current()) this.setData({ commandPaletteError: err.message || uiText('选项加载失败') }); })
      .finally(() => { if (current()) this.setData({ commandPaletteLoading: false }); });
  },

  backToComposerCommands() {
    this.closeAttachMenu(); return this.attachMenu();
  },

  chooseWorkspaceReference() {
    if (!this.data.canAttach || this.data.sendingAttachments) return;
    this._composerContextKey = this.composerContextKey();
    this.closeAttachMenu(); this.openFilesSheet(true);
  },

  chooseFile() {
    return this.pickComposerImages(true);
  },

  chooseImage() {
    return this.pickComposerImages(false);
  },

  chooseChatFile() {
    return this.pickComposerFiles();
  },

  // Chat files are staged as file chips. The gateway still only accepts image
  // attachments, so sending them stays guarded in send() until the host supports files.
  pickComposerFiles() {
    if (!this.data.canAttach || this.data.attachmentPicking || this.data.sendingAttachments) return;
    const remaining = 20 - this.data.images.length;
    if (remaining <= 0) { wx.showToast({ title: uiText('最多添加 20 个附件'), icon: 'none' }); return; }
    store.beginNativeOverlay();
    const request = this._attachmentRequest = {};
    const hostId = store.state && store.state.activeID, sessionId = store.sessionState.sessionId;
    this._composerContextKey = this.composerContextKey();
    // 选图期间允许连接抖动（重连不丢选择），但换主机或换会话必须作废，避免把旧会话的附件带进新会话。
    const current = () => !this._unloaded && this._attachmentRequest === request
      && store.state && store.state.activeID === hostId && store.sessionState.sessionId === sessionId;
    const finish = () => {
      store.endNativeOverlay();
      if (!this._unloaded && this._attachmentRequest === request) {
        this._attachmentRequest = null;
        this.setData({ attachmentPicking: false });
      }
    };
    this.closeAttachMenu();
    this.setData({ attachmentPicking: true });
    const options = { count: Math.min(9, remaining), type: 'file', success: res => {
      if (!current()) { finish(); return; }
      const kept = [];
      for (const file of res.tempFiles || []) {
        const tempPath = file.path || file.tempFilePath;
        if (!tempPath) continue;
        kept.push({ id: util.uuid(), isFile: true, tempPath, name: file.name || 'file', size: Number(file.size) || 0 });
      }
      if (!kept.length) { finish(); wx.showToast({ title: uiText('未能读取所选文件'), icon: 'none' }); return; }
      if (!current()) { finish(); return; }
      const images = this.data.images.concat(kept).slice(0, 20);
      this._attachmentRequest = null;
      this.setData({ images, canSend: !!this.data.draft.trim() || images.length > 0, attachmentPicking: false });
    }, fail: err => {
      if (current() && !/cancel/i.test(err && err.errMsg || '')) wx.showToast({ title: uiText('选择文件失败，请重试'), icon: 'none' });
      finish();
    } };
    try { wx.chooseMessageFile(options); } catch (error) { options.fail(error); }
  },

  pickComposerImages(fromChat) {
    if (!this.data.canAttach || this.data.attachmentPicking || this.data.sendingAttachments) return;
    const remaining = 20 - this.data.images.length;
    if (remaining <= 0) { wx.showToast({ title: uiText('最多添加 20 张图片'), icon: 'none' }); return; }
    store.beginNativeOverlay();
    const request = this._attachmentRequest = {};
    const hostId = store.state && store.state.activeID, sessionId = store.sessionState.sessionId;
    this._composerContextKey = this.composerContextKey();
    // 选图期间允许连接抖动（重连不丢选择），但换主机或换会话必须作废。
    const current = () => !this._unloaded && this._attachmentRequest === request
      && store.state && store.state.activeID === hostId && store.sessionState.sessionId === sessionId;
    const finish = () => {
      store.endNativeOverlay();
      if (!this._unloaded && this._attachmentRequest === request) {
        this._attachmentRequest = null;
        this.setData({ attachmentPicking: false });
      }
    };
    this.closeAttachMenu();
    this.setData({ attachmentPicking: true });
    const options = { count: Math.min(9, remaining), success: async res => {
      if (!current()) { finish(); return; }
      let skipped = false;
      const kept = [];
      for (const file of res.tempFiles || []) {
        if (!current()) { finish(); return; }
        if (Number(file.size) > 8 * 1024 * 1024) { skipped = true; continue; }
        const tempPath = file.tempFilePath || file.path;
        if (!tempPath) { skipped = true; continue; }
        let info = null;
        try {
          info = await new Promise((resolve, reject) => wx.getImageInfo({ src: tempPath, success: resolve, fail: reject }));
        } catch (_) { /* ignore, fall back to filename */ }
        let mediaType = '';
        if (info && info.type) {
          mediaType = composerMenu.imageType('image.' + info.type);
        } else {
          // Derive from filename when getImageInfo fails (rare edge cases)
          const match = String(file.name || '').match(/\.([a-z0-9]+)(?:\?|$)/i);
          if (match) mediaType = composerMenu.imageType('image.' + match[1]);
        }
        if (!mediaType) { skipped = true; continue; }
        kept.push({ id: util.uuid(), tempPath, mediaType, name: file.name || 'image', size: Number(file.size) || 0 });
      }
      if (!current()) { finish(); return; }
      if (!this.data.canAttach) { finish(); return; }
      const images = this.data.images.concat(kept).slice(0, 20);
      this.setData({ images, canSend: !!this.data.draft.trim() || images.length > 0 });
      if (skipped) wx.showToast({ title: uiText('仅支持 8MB 内的 PNG、JPEG、GIF、WebP 图片'), icon: 'none' });
      finish();
    }, fail: err => {
      if (current() && !/cancel/i.test(err && err.errMsg || '')) wx.showToast({ title: uiText('选择图片失败，请重试'), icon: 'none' });
      finish();
    } };
    try {
      if (fromChat) wx.chooseMessageFile(Object.assign(options, { type: 'image' }));
      else wx.chooseMedia(Object.assign(options, { mediaType: ['image'], sizeType: ['compressed'] }));
    } catch (error) { options.fail(error); }
  },

  previewPendingImage(e) {
    const image = this.data.images[Number(e.currentTarget.dataset.index)];
    if (image && !image.isFile) wx.previewImage({ current: image.tempPath, urls: this.data.images.filter(item => !item.isFile).map(item => item.tempPath) });
  },

  removeImage(e) {
    if (this.data.sendingAttachments) return;
    const images = this.data.images.slice();
    images.splice(e.currentTarget.dataset.index, 1);
    this.setData({
      images: images,
      canSend: !!this.data.draft.trim() || images.length > 0
    });
    this.updateDockInset();
  },

  send() {
    if (this.data.voiceOverlayVisible || this.data.sendingAttachments || this.data.attachmentPicking || this._commandSubmitting) return;
    const text = this.data.draft.trim();
    const images = this.data.images;
    if (!text && !images.length) return;
    const workspaceRefs = images.filter(image => image.isWorkspaceRef && image.path).map(image => ({ kind: image.workspaceKind, path: image.path, name: image.name }));
    const uploadImages = images.filter(image => !image.isFile);
    if (images.some(image => image.isFile && !image.isWorkspaceRef)) {
      wx.showToast({ title: uiText('请选择工作区文件或目录发送'), icon: 'none' }); return;
    }
    if (images.length && !composerMenu.acceptsAttachments(this._activeCommand)) {
      wx.showToast({ title: uiText('此指令不接受附件，请先移除附件'), icon: 'none' }); return;
    }
    this._draftRevision = (this._draftRevision || 0) + 1;
    const revision = this._draftRevision, context = this.composerContextKey(), client = store.client, workspaceId = store.state.currentWorkspaceId;
    this.setData({ sendingAttachments: true });
    // The task-send tap is the only reliable gesture context for WeChat's one-time subscription prompt.
    const notificationTicket = notifySubscription.requestCompletionTicket();
    const s = store.sessionState;
    const self = this;
    const sendWithImages = uploadImages.length
      ? Promise.all(uploadImages.map(readImageBase64))
      : Promise.resolve([]);

    return Promise.all([sendWithImages, notificationTicket]).then(([encoded, ticket]) => {
      if (this._unloaded || this.composerContextKey() !== context || store.client !== client) return;
      if (this._draftRevision !== revision) return;
      const activeCommand = this._activeCommand;
      if (activeCommand && activeCommand.ui && activeCommand.ui.kind === 'input') {
        return this.submitCommand(activeCommand, text, encoded, false, ticket);
      }
      if (s.running) {
        // 运行中发送：只进本机队列，等用户点队列行的发送箭头再真正发出。
        // 之前走网关 queue 模式，宿主会在回合结束时把消息自动发出，绕过了队列的发送按钮。
        this.enqueueSubmission(text, encoded, uploadImages, workspaceRefs, ticket);
        self.setData({ draft: '', images: [], canSend: false });
        this.closeAttachMenu();
        this.jumpToBottom();
        return;
      }
      const sent = client.sendMessage(
        text,
        s.sessionId,
        workspaceId,
        encoded,
        undefined,
        ticket,
        workspaceRefs
      );
      if (sent !== false) {
        // 乐观回显：消息立即可见（对齐桌面端），网关回显到达时自动合并。
        // 图片带上临时路径，发送后先显示本地图片，不必等附件回填。
        store.appendLocalUserRow(text, uploadImages.map((image) => ({
          attachmentId: image.id,
          name: image.name,
          mediaType: image.mediaType,
          localUrl: image.tempPath,
          tempPath: image.tempPath
        })), workspaceRefs);
      } else {
        wx.showToast({ title: uiText('发送失败，草稿已保留'), icon: 'none' }); return;
      }
      self.setData({ draft: '', images: [], canSend: false });
      this.closeAttachMenu();
      this.jumpToBottom();
    }).catch((err) => {
      if (this._unloaded || this.composerContextKey() !== context) return;
      wx.showToast({ title: err.message || uiText('附件处理失败'), icon: 'none' });
    }).finally(() => { if (!this._unloaded) this.setData({ sendingAttachments: false }); });
  },

  updateDockInset(attempt) {
    if (this._unloaded || this.data.tab !== 'conversation') { this._dockMeasurePending = false; return; }
    const tries = typeof attempt === 'number' ? attempt : 0;
    // 首帧调用允许排队；重试调用直接测量，避免被 pending 标志吞掉
    if (tries === 0) {
      if (this._dockMeasurePending) return;
      this._dockMeasurePending = true;
    }
    wx.nextTick(() => {
      if (this._unloaded || this.data.tab !== 'conversation') { this._dockMeasurePending = false; return; }
      const query = wx.createSelectorQuery().in(this);
      query.select('.dock-stack').boundingClientRect();
      query.exec((rects) => {
        const rect = rects && rects[0];
        this._dockMeasurePending = false;
        if (this._unloaded || this.data.tab !== 'conversation') return;
        if (!rect || !rect.height) {
          // dock 还没完成布局（首帧/历史渲染中）：短间隔重试，
          // 否则会一直沿用默认留白，底部内容被输入区遮挡很久。
          if (tries < 10) setTimeout(() => this.updateDockInset(tries + 1), 80);
          return;
        }
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        // Measure against the window, NEVER the already shortened scroll viewport.
        // Keep keyboard height separate so its first frame can reposition immediately.
        const kbHeight = Number(this.data.kbHeight) || 0;
        const overlap = Math.max(0, (info.windowHeight || rect.bottom) - rect.top - kbHeight);
        const inset = Math.ceil(overlap * 750 / Math.max(info.windowWidth || 375, 1) + 12);
        if (Math.abs(inset - this.data.convBottomInset) > 2) {
          this.setData({ convBottomInset: inset, ...this.layoutPatch({ convBottomInset: inset }) }, () => {
            if (this._convPinned) this.refreshBottomAnchor();
          });
        }
        // 布局稳定后再校准一次：历史/队列渲染会改变 dock 高度
        if (tries < 2) setTimeout(() => this.updateDockInset(tries + 1), 240);
      });
    });
  },

  layoutPatch(overrides) {
    const navPadTop = Number(this.data.navPadTop) || 0;
    const navHeight = Number(this.data.navHeight) || 0;
    const navMoreRight = Number(this.data.navMoreRight) || 0;
    const kbHeight = Number(overrides && overrides.kbHeight !== undefined ? overrides.kbHeight : this.data.kbHeight) || 0;
    const dockInset = Number(overrides && overrides.convBottomInset !== undefined ? overrides.convBottomInset : this.data.convBottomInset) || 0;
    return dataPatch(this.data, {
      navbarStyle: 'padding-top:' + navPadTop + 'px;height:' + (navPadTop + navHeight)
        + 'px;padding-right:' + navMoreRight + 'px;',
      conversationStyle: 'padding-bottom:0;margin-bottom:' + (kbHeight ? 'calc(' + dockInset + 'rpx + ' + kbHeight + 'px)' : dockInset + 'rpx') + ';',
      conversationInnerStyle: 'min-height:100%;',
      trajectoryStyle: kbHeight ? 'margin-bottom:' + kbHeight + 'px;' : '',
      dockStyle: kbHeight ? 'bottom:' + (kbHeight + 12) + 'px;' : ''
    });
  },

  syncLayoutStyles() {
    const patch = this.layoutPatch();
    if (Object.keys(patch).length) this.setData(patch);
  },

  stopAgent() {
    const s = store.sessionState;
    if (!s.sessionId || !s.running) return;
    // 与「更多菜单 → 取消当前回合」共用底部确认弹窗，避免系统弹窗样式割裂
    this.setData({ confirmSheet: 'cancel', confirmSheetFromStop: true });
  },

  // ---------- 选择器 ----------

  pickPermission() {
    const s = store.sessionState;
    const current = s.permission || '';
    // 选项来源：网关权限预设；未到达时用本地完整预设兜底
    let options = (s.permissionOptions && s.permissionOptions.length)
      ? s.permissionOptions.slice()
      : [
          { value: 'read-only' },
          { value: 'workspace-write' },
          { value: 'danger-full-access' }
        ];
    // 对齐软件权限菜单：固定提供「自动」选项，网关未下发时补在末尾
    const hasAuto = options.some((o) => {
      const v = String((o && o.value) || '').toLowerCase();
      return v === 'auto' || v === 'default' || v.indexOf('auto') >= 0;
    });
    if (!hasAuto) options = options.concat([{ value: 'auto' }]);
    const iconOf = (v) => {
      const key = String(v || '').toLowerCase().replace(/_/g, '-');
      return labels.permissionIconFile(key);
    };
    this.setData({
      permissionSheet: composerMenu.optionRows('permission', options.map(o => ({ id: o.value, label: o.name || o.value, badge: o.badge, selected: o.value === current })), { t: uiText })
        .map(o => ({ value: o.id, name: o.label, icon: iconOf(o.id), badge: o.badge, current: o.selected }))
    });
  },

  pickPermissionOption(e) {
    const value = e.currentTarget.dataset.value;
    const s = store.sessionState;
    this.setData({ permissionSheet: [] });
    if (!s.sessionId || !value) return;
    store.client.setPermission(s.sessionId, value).catch((err) => {
      wx.showToast({ title: err.message || uiText('设置失败'), icon: 'none' });
    });
    this.setData({
      permissionLabel: labels.permissionName(value) || value,
      permissionIcon: labels.permissionIconFile(value)
    });
  },

  closePickSheets() {
    this.setData({ permissionSheet: [], modeSheet: [] });
  },

  pickModel() {
    if (this.data.modelSheetOpen || this.data.effortSheetOpen) { this.setData({ modelSheetOpen: false, effortSheetOpen: false }); return; }
    this.backToModelMenu();
  },

  backToModelMenu() {
    const selection = store.sessionState.selection || store.state.modelCatalog && store.state.modelCatalog.current || store.state.defaultModel;
    const face = composerMenu.modelFace(store.state.modelCatalog, selection);
    this.closeAttachMenu(false);
    this.setData({ modelSheetOpen: true, modelMenuPane: 'root', effortSheetOpen: false, permissionSheet: [],
      modelLabel: face.label || this.data.modelLabel, modelBadge: face.badge,
      effortLabel: selection && selection.reasoningEffort ? labels.reasoningEffortName(selection.reasoningEffort) : this.data.effortLabel });
  },

  openModelList() {
    const catalog = store.state.modelCatalog;
    const s = store.sessionState;
    const selection = s.selection || (catalog && catalog.current) || store.state.defaultModel || {};
    // 主机回执可能只带模型名：此时按模型名匹配，避免弹窗没有任何选中项
    const isCurrent = (provider, model) => {
      if (!selection || !selection.model || selection.model !== model) return false;
      return selection.provider ? selection.provider === provider : true;
    };
    const groups = [];
    if (catalog && catalog.groups && catalog.groups.length) {
      catalog.groups.forEach((group) => {
        const models = (group.models || []).map((model) => ({
          provider: group.id,
          model: model.id,
          name: model.name || model.id,
          badge: composerMenu.modelFace(catalog, { provider: group.id, model: model.id }).badge,
          effort: model.reasoning && model.reasoning.defaultEffort,
          current: isCurrent(group.id, model.id)
        }));
        if (models.length) {
          groups.push({
            id: group.id,
            name: uiText(({ 'deepseek-account': 'DeepSeek 账号', 'deepseek-official': 'DeepSeek 官方 API' })[group.id] || group.name || group.id),
            models: models
          });
        }
      });
    }
    if (!groups.length) {
      store.client.requestModels(s.sessionId).catch(() => {});
      wx.showToast({ title: uiText('正在加载模型列表'), icon: 'none' });
      this.setData({ modelSheetOpen: false, modelGroups: [] });
      return;
    }
    this.setData({ modelGroups: groups, modelSheetOpen: true, modelMenuPane: 'model', effortSheetOpen: false });
  },

  pickModelOption(e) {
    const ds = e.currentTarget.dataset;
    const provider = ds.provider;
    const model = ds.model;
    if (!provider || !model) return;
    this.setData({ modelSheetOpen: false });
    store.selectModel(store.sessionState.sessionId, provider, model, ds.effort || undefined)
      .catch((err) => {
        wx.showToast({ title: err.message || uiText('切换失败'), icon: 'none' });
      });
    this.setData({
      modelLabel: composerMenu.modelFace(store.state.modelCatalog, { provider, model }).label,
      modelBadge: composerMenu.modelFace(store.state.modelCatalog, { provider, model }).badge,
      effortLabel: ds.effort ? labels.reasoningEffortName(ds.effort) : this.data.effortLabel
    });
  },

  closeModelSheet() {
    this.setData({ modelSheetOpen: false });
  },

  pickEffort() {
    const s = store.sessionState;
    const selection = s.selection || store.state.defaultModel || {};
    const current = String(selection.reasoningEffort || 'high').toLowerCase();
    const levels = [
      { value: 'off', name: 'Off' },
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' }
    ];
    this.setData({
      effortSheet: levels.map((lv) => ({
        value: lv.value,
        name: lv.name,
        current: lv.value === current
      })),
      effortSheetOpen: true, modelSheetOpen: false
    });
  },

  pickEffortOption(e) {
    const level = e.currentTarget.dataset.value;
    const s = store.sessionState;
    const selection = s.selection || store.state.defaultModel;
    this.setData({ effortSheetOpen: false });
    if (!selection || !level) return;
    store.selectModel(s.sessionId, selection.provider, selection.model, level)
      .catch((err) => {
        wx.showToast({ title: err.message || uiText('设置失败'), icon: 'none' });
      });
    this.setData({ effortLabel: labels.reasoningEffortName(level) });
  },

  closeEffortSheet() {
    this.setData({ effortSheetOpen: false });
  },

  onUiLocaleChange() { this.syncFromStore({ app: store.state, session: store.sessionState }); },
  onUiPreferencesChange() {
    this._traceLocale = null;
    this._traceCache = null;
    if (this.data.tab === 'trajectory') this.setData(dataPatch(this.data, this.trajectoryPatch()));
    if (typeof this.updateDockInset === 'function' && this._renderSessionId) this.updateDockInset();
  },


  // ---------- 上下文统计：流动连接（移植 dsh-context Agent Flow） ----------
  // 原生 view 曲线兼容 WXML；分段位置只在节点几何变化时重算。
  stopContextFlow() {
    if (this._ctxFlowTimer) { clearTimeout(this._ctxFlowTimer); this._ctxFlowTimer = null; }
  },

  scheduleContextFlow(delay = 60) {
    if (this._ctxFlowTimer) clearTimeout(this._ctxFlowTimer);
    this._ctxFlowTimer = setTimeout(() => {
      this._ctxFlowTimer = null;
      this.drawContextFlow();
    }, delay);
  },

  /** 面板滚动时重新测量：节点随内容移动，连接线必须跟着重算。 */
  contextPanelScroll() {
    if (this.data.tab !== 'context' || !this.data.showContextPanel) return;
    this.scheduleContextFlow();
  },

  drawContextFlow() {
    if (this._unloaded || this.data.tab !== 'context' || !this.data.showContextPanel) { this.stopContextFlow(); return; }
    this.stopContextFlow();
    const selectors = ['#ctxNodeInputs', '#ctxNodeEvents', '#ctxNodeSession', '#ctxNodeTools', '#ctxNodeNet'];
    const query = wx.createSelectorQuery().in(this);
    query.select('#ctxFlow').boundingClientRect();
    selectors.forEach((selector) => query.select(selector).boundingClientRect());
    query.exec((res) => {
      if (!res || !res[0] || selectors.some((_, index) => !res[index + 1])) {
        this._ctxFlowRetries = (this._ctxFlowRetries || 0) + 1;
        if (this._ctxFlowRetries <= 4) this.scheduleContextFlow(120);
        return;
      }
      const flowRect = res[0];
      const nodes = {};
      selectors.forEach((selector, index) => { nodes[selector] = res[index + 1] || null; });
      const width = flowRect.width;
      const height = flowRect.height;
      if (!(width > 0) || !(height > 0)) {
        this._ctxFlowRetries = (this._ctxFlowRetries || 0) + 1;
        if (this._ctxFlowRetries <= 4) this.scheduleContextFlow(120);
        return;
      }
      this._ctxFlowRetries = 0;

      // 所有坐标钳制在模块内：节点测量异常时曲线也不会画到模块外。
      const clampX = (value) => Math.max(0, Math.min(width, value));
      const clampY = (value) => Math.max(0, Math.min(height, value));

      // 竖向布局：上排两节点 → 中间会话 → 下排两节点
      const paths = [
        { from: '#ctxNodeInputs', to: '#ctxNodeSession', fromSide: 'bottom', fromAt: 0.72, toSide: 'top', toAt: 0.25, color: '#22C55E' },
        { from: '#ctxNodeEvents', to: '#ctxNodeSession', fromSide: 'bottom', fromAt: 0.28, toSide: 'top', toAt: 0.75, color: '#A855F7' },
        { from: '#ctxNodeSession', to: '#ctxNodeTools', fromSide: 'bottom', fromAt: 0.25, toSide: 'top', toAt: 0.72, color: '#14B8A6' },
        { from: '#ctxNodeSession', to: '#ctxNodeNet', fromSide: 'bottom', fromAt: 0.75, toSide: 'top', toAt: 0.28, color: '#EC4899' }
      ].map((link) => {
        const a = nodes[link.from];
        const b = nodes[link.to];
        if (!a || !b) return null;
        const ax = clampX(a.left - flowRect.left + a.width * link.fromAt);
        const ay = clampY(link.fromSide === 'bottom' ? a.top - flowRect.top + a.height : a.top - flowRect.top);
        const bx = clampX(b.left - flowRect.left + b.width * link.toAt);
        const by = clampY(link.toSide === 'bottom' ? b.top - flowRect.top + b.height : b.top - flowRect.top);
        // 控制点同样钳制：k 兜底 20 在节点贴近时会把曲线推出模块。
        const k = Math.max(20, Math.abs(by - ay) / 2);
        const cx1 = clampX(ax);
        const cy1 = clampY(ay + k * (link.fromSide === 'bottom' ? 1 : -1));
        const cx2 = clampX(bx);
        const cy2 = clampY(by - k * (link.toSide === 'top' ? 1 : -1));
        const pointAt = (t) => {
          const u = 1 - t;
          return {
            x: u * u * u * ax + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * bx,
            y: u * u * u * ay + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * by
          };
        };
        const segments = [];
        const steps = 16;
        for (let i = 0; i < steps; i += 1) {
          const p0 = pointAt(i / steps);
          const p1 = pointAt((i + 1) / steps);
          const dx = p1.x - p0.x;
          const dy = p1.y - p0.y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          const left = Math.min(width, Math.max(0, p0.x));
          const top = Math.min(height, Math.max(0, p0.y));
          const common = `transform:rotate(${angle}deg);background:${link.color};transform-origin:0 50%;`;
          segments.push({
            key: link.from + '>' + link.to + ':g:' + i,
            kind: 'glow',
            style: `left:${left}px;top:${top - 7}px;width:${length + 1}px;${common}`
          });
          if (i % 3 === 1) {
            const dashStart = pointAt((i + 0.25) / steps);
            segments.push({
              key: link.from + '>' + link.to + ':d:' + i,
              kind: 'dash',
              style: `left:${dashStart.x}px;top:${dashStart.y - 1}px;width:${Math.max(2, length * 0.5)}px;animation-delay:-${(i * 70) % 900}ms;${common}`
            });
          }
        }
        return segments;
      }).flat().filter(Boolean);

      // 尺寸没变且连线没变就跳过 setData：滚动时不该反复触发渲染。
      const sameSize = Math.abs((Number(this.data.contextFlowW) || 0) - width) < 0.5
        && Math.abs((Number(this.data.contextFlowH) || 0) - height) < 0.5;
      const flowKey = paths.map((link) => link.key + ':' + link.style).join('|');
      const sameLinks = sameSize && this._ctxFlowKey === flowKey;
      if (sameLinks) return;
      this._ctxFlowKey = flowKey;
      this.setData({ contextFlowLinks: paths, contextFlowW: width, contextFlowH: height });
    });
  },

  // ---------- 协作（只读，不切换父会话、不发送任务） ----------
  collaborationPatch(session = store.sessionState, app = store.state) {
    const result = collaboration.view(session.collaboration, app && app.sessions, session, app && app.connection === 'connected');
    const patch = { collaborationCount:result.total, collaborationActive:result.active };
    if (!this.data.collaborationOpen) return patch;
    const calls = (session.trajectory || []).filter(row => row.badge === 'TOOL' || row.badge === 'SUBTOOL');
    const scheduled = (app && app.scheduledTasks) || [];
    // 后台任务：当前会话里仍在运行的子智能体与团队任务
    const runningTasks = (result.tasks || []).filter((task) => ['running', 'in_progress', 'pending'].indexOf(String(task.status || '').toLowerCase()) >= 0);
    const runningChildren = (result.children || []).filter((child) => String(child.status || '').toLowerCase() === 'running');
    const tabs = [{id:'members',icon:'dsh-team',label:uiText('智能体团队'),count:result.members.length},
      {id:'children',icon:'dsh-agent',label:uiText('子智能体'),count:result.children.length},
      {id:'tasks',icon:'dsh-checklist',label:uiText('团队任务'),count:result.tasks.length},
      {id:'calls',icon:'dsh-process-tool',label:uiText('工具调用'),count:calls.length},
      {id:'background',icon:'dsh-gauge',label:uiText('后台任务'),count:runningChildren.length + runningTasks.length},
      {id:'schedule',icon:'automation',label:uiText('自动化任务'),count:scheduled.length}];
    const scheduleRows = scheduled.slice().sort((a, b) => (Date.parse(a.scheduledAt) || 0) - (Date.parse(b.scheduledAt) || 0)).map((task) => ({
      id: task.id,
      title: task.title || task.prompt || task.id,
      subtitle: (task.status === 'active' ? scheduleUtil.fullRule(task) + ' · ' + scheduleUtil.formatDate(task.scheduledAt) : uiText('已结束')),
      status: task.status === 'active' ? 'running' : 'done',
      statusText: task.status === 'active' ? uiText('已开启') : uiText('已结束'),
      canOpen: false,
      scheduleTask: true
    }));
    let rows = result[this.data.collaborationTab] || [];
    if (this.data.collaborationTab === 'calls') {
      rows = calls.slice(-200).reverse().map(row => ({
        id:row.key,title:row.label,subtitle:row.preview,status:row.isError ? 'failed' : row.completed ? 'done' : row.stopped ? 'unknown' : 'running',
        statusText:uiText(row.isError ? '失败' : row.completed ? '已完成' : row.stopped ? '未完成' : '运行中'),canOpen:true
      }));
    } else if (this.data.collaborationTab === 'schedule') {
      rows = scheduleRows;
    } else if (this.data.collaborationTab === 'background') {
      rows = runningChildren.map((child) => ({
        id: child.id,
        title: child.title,
        subtitle: uiText('子智能体') + (child.subtitle ? ' · ' + child.subtitle : ''),
        status: 'running',
        statusText: child.statusText || uiText('运行中'),
        canOpen: !!child.canOpen
      })).concat(runningTasks.map((task) => ({
        id: task.id,
        title: task.title,
        subtitle: uiText('团队任务') + (task.subtitle ? ' · ' + task.subtitle : ''),
        status: 'running',
        statusText: task.statusText || uiText('运行中'),
        canOpen: false
      })));
    }
    const note = this.data.collaborationTab === 'calls'
      ? (calls.length > 200 ? uiText('仅显示最近 200 次调用') : uiText('已加载的调用'))
      : this.data.collaborationTab === 'schedule'
        ? (app && app.scheduledTasksError ? app.scheduledTasksError : uiText('自动化任务'))
        : result.note;
    return { ...patch,collaborationTabs:tabs,collaborationRows:rows,collaborationNote:note };
  },
  openTurnUsage(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    const rows = this.data.rows || [];
    const row = rows.find((item) => item && (item.key === key || item.turnMetaKey === key)) || null;
    if (!row) return;
    const usage = row.turnUsage || null;
    if (!usage) {
      wx.showToast({ title: uiText('本轮用量暂不可用'), icon: 'none' });
      return;
    }
    const routes = Array.isArray(usage.routes) ? usage.routes : [];
    const cache = turnUsageUtil.cacheHit(usage);
    // 贴着触发按钮弹出：按点按位置计算卡片边界，靠上时翻转到下方
    let windowWidth = 375;
    let windowHeight = 667;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = info.windowWidth || windowWidth;
      windowHeight = info.windowHeight || windowHeight;
    } catch (err) { /* 取不到就按默认尺寸 */ }
    const rpx = windowWidth / 750;
    const width = Math.min(Math.round(560 * rpx), Math.round(windowWidth * 0.9));
    const detail = (e && e.detail) || {};
    const anchorX = Number(detail.x || (e.touches && e.touches[0] && e.touches[0].clientX)) || windowWidth / 2;
    const anchorY = Number(detail.y || (e.touches && e.touches[0] && e.touches[0].clientY)) || windowHeight / 2;
    const left = Math.max(12, Math.min(anchorX - width / 2, windowWidth - width - 12));
    const cardHeight = Math.round(430 * rpx);
    const navBottom = (Number(this.data.navPadTop) || 44) + (Number(this.data.navHeight) || 32);
    const placeBelow = anchorY - cardHeight < navBottom + 12;
    const top = placeBelow
      ? Math.min(anchorY + 12, windowHeight - cardHeight - 12)
      : Math.max(navBottom + 12, anchorY - 10);
    this.setData({
      turnUsageOpen: true,
      turnUsagePos: { left, top, width, placeBelow },
      turnUsageSheet: {
        total: turnUsageUtil.exact(usage.totalTokens),
        routes: routes.map((route) => route.provider + '/' + route.model).join(', '),
        cacheHit: cache,
        uncached: turnUsageUtil.exact(usage.uncachedInputTokens),
        cacheRead: usage.cacheReadTokens === undefined ? '—' : turnUsageUtil.exact(usage.cacheReadTokens),
        cacheWrite: usage.cacheWriteTokens === undefined ? '—' : turnUsageUtil.exact(usage.cacheWriteTokens),
        output: turnUsageUtil.exact(usage.outputTokens),
        reasoning: usage.reasoningTokens === undefined ? '' : turnUsageUtil.exact(usage.reasoningTokens)
      }
    });
  },

  closeTurnUsage() {
    this.setData({ turnUsageOpen: false, turnUsageSheet: null });
  },

  openCollaboration() {
    this.cancelVoice(); this.prioritizeInteraction();
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({collaborationOpen:true,collaborationExpanded:false,collaborationPreview:null,collaborationBusy:false,moreSheetOpen:false,statsPopOpen:false,morePane:'menu',renameKeyboard:0,
      showContextSheet:false,traceDetail:null,attachSheetOpen:false,modelSheetOpen:false,effortSheetOpen:false,permissionSheet:[],modeSheet:[],
      kbHeight:0,composerFocused:false,composerFocus:false,...this.layoutPatch({kbHeight:0})});
    this.setData(this.collaborationPatch()); this.stopScrollPolling();
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    this.refreshCollaboration();
  },
  closeCollaboration() {
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({collaborationOpen:false,collaborationExpanded:false,collaborationPreview:null,collaborationBusy:false});
    if (this.data.tab === 'conversation') this.startScrollPolling();
  },
  toggleCollaborationExpanded() {
    if (!this.data.collaborationOpen) return;
    this.setData({collaborationExpanded:!this.data.collaborationExpanded});
  },
  collabGrabStart(e) {
    if (!this.data.collaborationOpen) return;
    this._collabGrab = { y: e.touches[0].clientY, moved: false, applied: null };
  },
  collabGrabMove(e) {
    const g = this._collabGrab;
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (Math.abs(dy) < 20) return;
    const expand = dy < 0;
    if (g.applied !== expand) {
      g.applied = expand;
      g.moved = true;
      this.setData({ collaborationExpanded: expand });
    }
  },
  collabGrabEnd() {
    const g = this._collabGrab;
    this._collabGrab = null;
    if (g && !g.moved) this.setData({ collaborationExpanded: !this.data.collaborationExpanded });
  },
  selectCollaborationTab(e) {
    const tab = e.currentTarget.dataset.id;
    if (tab === 'schedule' && typeof store.refreshScheduledTasks === 'function') {
      store.refreshScheduledTasks();
    }
    if (!['members','children','tasks','calls','background','schedule'].includes(tab)) return;
    this._collaborationRequest = null; this.setData({collaborationTab:tab,collaborationPreview:null}); this.setData(this.collaborationPatch());
  },
  refreshCollaboration() {
    if (!store.state || store.state.connection !== 'connected' || !store.client || this.data.collaborationBusy || typeof store.client.requestSessions !== 'function') return;
    const client=store.client, generation=client.connectGeneration, sessionId=store.sessionState.sessionId;
    const request={}; this._collaborationRefresh=request;
    this.setData({collaborationBusy:true});
    Promise.resolve(client.requestSessions()).catch(() => {}).finally(() => {
      if (this._collaborationRefresh===request && !this._unloaded && !this._voiceHidden && client===store.client && generation===client.connectGeneration && sessionId===store.sessionState.sessionId) {
        this._collaborationRefresh=null;
        this.setData({collaborationBusy:false}); if(this.data.collaborationOpen)this.setData(this.collaborationPatch());
      }
    });
  },
  backCollaborationList() { this._collaborationRequest=null; this.setData({collaborationPreview:null}); },
  async openCollaborationItem(e) {
    const id=e.currentTarget.dataset.id;
    if (this.data.collaborationPreview && this.data.collaborationPreview.loading && this.data.collaborationPreview.id===id) return;
    const row=(this.data.collaborationRows || []).find(item=>item.id===id) ||
      ((this.data.collaborationPreview || {}).children || []).find(item=>item.id===id);
    if (!row || !this.data.collaborationOpen) return;
    if (row.scheduleTask) {
      this.closeCollaboration();
      wx.navigateTo({ url: '/pages/schedule/schedule' });
      return;
    }
    if (this.data.collaborationTab === 'calls' && !this.data.collaborationPreview) {
      this.closeCollaboration(); this.trajectoryPatch(); this.openTraceDetail({currentTarget:{dataset:{key:id}}}); return;
    }
    if (this.data.collaborationTab === 'tasks' && !this.data.collaborationPreview) {
      this.setData({collaborationPreview:{title:row.title,task:true,text:row.description,statusText:row.statusText,owner:row.subtitle,blocked:row.blockedBy.join(', ')}});return;
    }
    if (!row.canOpen || id===store.sessionState.sessionId) return;
    const client=store.client, generation=client.connectGeneration, sessionId=store.sessionState.sessionId, request={};
    this._collaborationRequest=request;
    const current=()=>!this._unloaded && !this._voiceHidden && this.data.collaborationOpen && this._collaborationRequest===request &&
      client===store.client && generation===client.connectGeneration && sessionId===store.sessionState.sessionId;
    this.setData({collaborationPreview:{id,title:row.title,loading:true,rows:[],children:[]}});
    // 预览子会话时加本地超时：网关不返回时给出可读提示，而不是一直「正在加载记录」
    const timeout = new Promise((_, reject) => setTimeout(() => {
      const error = new Error(uiText('记录请求超时，请重新连接后重试'));
      error.code = 'INSPECTOR_TIMEOUT';
      reject(error);
    }, 8000));
    try {
      if (!store.state || store.state.connection !== 'connected') throw Error('offline');
      if (typeof client.cancelInspector === 'function') client.cancelInspector(id);
      const frame=await Promise.race([client.inspectSession(id), timeout]); if(!current())return;
      if(frame.sessionId!==id || !Array.isArray(frame.events))throw Error('invalid history');
      const state=collaboration.create(id);collaboration.baseline(state,frame.projections);collaboration.ingest(state,frame.events);
      const childView=collaboration.view(state,store.state.sessions,{sessionId:id},true);
      const agg=protocol.newAggregator();
      frame.events.slice().sort((a,b)=>a.seq-b.seq).forEach(event=>protocol.applyEvent(agg,protocol.normalizeRawEvent(event,id)));
      // 子智能体预览：展示网关返回记录里的全部用户/助手消息，不再只截取最近 20 条
      const rows=agg.rows.filter(item=>['user','assistant'].includes(item.kind) && item.text).map(item=>({
        key:item.key,
        role:uiText(item.kind==='user'?'用户':'助手'),
        text:String(item.text).slice(0,50000)
      }));
      this.setData({collaborationPreview:{id,title:row.title,loading:false,rows,children:childView.children.filter(item=>item.id!==id && item.id!==sessionId),hasMore:frame.hasMore===true}});
    } catch (error) {
      if (typeof client.cancelInspector === 'function') client.cancelInspector(id);
      if (!current()) return;
      const timedOut = error && error.code === 'INSPECTOR_TIMEOUT';
      this.setData({collaborationPreview:{
        id,
        title: row.title,
        error: true,
        errorText: timedOut ? uiText('记录请求超时，请重新连接后重试') : uiText('加载记录失败，请重试'),
        rows: row.subtitle ? [{ key: 'summary', role: row.statusText || '', text: row.subtitle }] : [],
        children: []
      }});
    }
  },

  // ---------- 轨迹详情 ----------

  trajectoryPatch() {
    const source = this._traceRows || store.sessionState.trajectory || [];
    const locale = preferences.locale();
    if (this._traceSource !== source || this._traceLocale !== locale || this._traceRenderSessionId !== this._renderSessionId) {
      this._traceSource = source;
      this._traceLocale = locale;
      this._traceRenderSessionId = this._renderSessionId;
      this._traceByKey = new Map();
      source.forEach(row => { this._traceByKey.set(row.key, row); if (row.request) this._traceByKey.set(row.request.key, row.request); });
      this._traceList = source.map(trajectoryView.listRow);
      this._traceOverview = trajectoryView.overview(this._traceList);
    }
    return { trajectory: this._traceList, traceOverview: this._traceOverview, ...this.traceSelectionPatch(source) };
  },

  traceItem(key) {
    if (this._traceByKey) return this._traceByKey.get(key);
    for (const row of this.data.trajectory || []) {
      if (row.key === key) return row;
      if (row.request && row.request.key === key) return row.request;
    }
    return null;
  },

  traceDetailPatch(item, selected) {
    const locale = preferences.locale();
    let cache = this._traceCache;
    if (!cache || cache.item !== item || cache.locale !== locale) {
      // Source records can contain thousands of chunks; they are not view data.
      const content = {};
      Object.keys(item).forEach(key => { if (!['sourceRecords', 'detail', 'request'].includes(key)) content[key] = item[key]; });
      const signature = JSON.stringify(content);
      if (!cache || cache.signature !== signature || cache.locale !== locale || cache.sessionId !== this._renderSessionId) {
        cache = { signature, locale, sessionId: this._renderSessionId, sections: {}, item };
      }
      cache.item = item;
      this._traceCache = cache;
    }
    const row = trajectoryView.localize(item);
    const tabs = trajectoryView.tabs(row);
    const active = tabs.find(tab => tab.id === selected) || tabs[0];
    if (!cache.sections[active.id]) cache.sections[active.id] = trajectoryView.sections(row, active.id)[0];
    return { traceDetail: { key: row.key, label: row.label, badge: row.badge, displayBadge: row.displayBadge, seqLabel: String(row.seqLabel || row.seq || '') },
      traceDetailTabs: tabs, traceDetailTab: active.id, traceDetailSection: cache.sections[active.id] };
  },

  traceSelectionPatch(rows) {
    if (!this.data.traceDetail) return {};
    const item = this._traceByKey ? this._traceByKey.get(this.data.traceDetail.key)
      : rows.reduce((found, row) => found || (row.key === this.data.traceDetail.key ? row : row.request && row.request.key === this.data.traceDetail.key ? row.request : null), null);
    if (!item || (this._traceSessionId && this._traceSessionId !== this._renderSessionId)) return { traceDetail: null, traceDetailTabs: [], traceDetailSection: null };
    return this.traceDetailPatch(item, this.data.traceDetailTab);
  },
  openTraceDetail(e) {
    const item = this.traceItem(e.currentTarget.dataset.key);
    if (!item || item.kind !== 'event') return;
    this._traceSessionId = this._renderSessionId;
    this.setData({ ...this.traceDetailPatch(item, 'summary'), traceThinkingExpanded: false });
  },
  openTraceRequest(e) {
    const row = this.traceItem(e.currentTarget.dataset.key);
    if (!row || !row.request) return;
    this._traceSessionId = this._renderSessionId;
    this.setData({ ...this.traceDetailPatch(row.request, 'summary'), traceThinkingExpanded: false });
  },
  jumpToTrace(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.trajectory.some(row => row.key === key)) return;
    this.setData({ traceScrollTarget: '', traceHighlightedKey: key });
    if (this._traceHighlightTimer) clearTimeout(this._traceHighlightTimer);
    wx.nextTick(() => { if (!this._unloaded) this.setData({ traceScrollTarget: 'trace-' + key }); });
    this._traceHighlightTimer = setTimeout(() => {
      if (!this._unloaded && this.data.traceHighlightedKey === key) this.setData({ traceHighlightedKey: '' });
    }, 1200);
  },
  toggleTraceThinking() { this.setData({ traceThinkingExpanded: !this.data.traceThinkingExpanded }); },
  selectTraceDetailTab(e) {
    if (!this.data.traceDetail) return;
    const item = this.traceItem(this.data.traceDetail.key);
    if (item) {
      const patch = dataPatch(this.data, this.traceDetailPatch(item, e.currentTarget.dataset.id));
      if (Object.keys(patch).length) this.setData(patch);
    }
  },
  closeTraceDetail() { this.setData({ traceDetail: null, traceDetailTabs: [], traceDetailSection: null }); },
  copyTraceDetail() {
    if (this.data.traceDetailSection) wx.setClipboardData({ data: this.data.traceDetailSection.text || '' });
  },

  noop() {}
});

// ---------- 辅助 ----------

function numberWithCommas(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function commandMatchesInput(command, text) {
  if (!command || !command.ui || command.ui.kind !== 'input') return false;
  const token = String(command.ui.insertText || ('/' + command.name)).replace(/\s+$/, '');
  return text === token || text.indexOf(token + ' ') === 0;
}

function goalPhaseLabel(phase) {
  switch (phase) {
    case 'active': return uiText('进行中的目标');
    case 'paused': return uiText('已暂停的目标');
    case 'blocked': return uiText('受阻的目标');
    default: return uiText('当前目标');
  }

}

function isRunning(rows) {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.kind === 'assistant') {
      // 流式中或有未完成工具 → 运行中
      if (row.streaming === true) return true;
      if (row.tools && row.tools.some((t) => t.status !== 'done')) return true;
      return false;
    }
    if (row.kind === 'process') {
      // 过程行有未完成工具 → 运行中；否则继续往前看
      if (row.tools && row.tools.some((t) => t.status !== 'done')) return true;
      continue;
    }
    if (row.kind === 'user') return false;
  }
  return false;
}

/** 为问题选项补上本地选中态（不写回 store）。 */
function decorateQuestion(pending, draft) {
  if (!pending) return null;
  return {
    rpcId: pending.rpcId,
    sessionId: pending.sessionId,
    replay: pending.replay === true,
    questions: (pending.questions || []).map((q) => ({
      id: q.id,
      header: q.header,
      question: q.question,
      detail: q.detail,
      options: (q.options || []).map((opt) => {
        // 推荐（recommended）后缀解析为徽章（对齐 iOS：识别后缀并剥离）
        let label = opt.label || '';
        let recommended = false;
        const m = label.match(/\s*\((?:recommended|推荐)\)\s*$/i);
        if (m) { recommended = true; label = label.slice(0, m.index).trim(); }
        return { label: label, raw: opt.label, description: opt.description || '', recommended: recommended };
      }),
      multiSelect: q.multiSelect === true,
      allowsMultipleSelections: q.multiSelect === true,
      checked: draft[q.id] || {},
      hasOptions: !!(q.options && q.options.length)
    })),
    custom: {}
  };
}

/** 把本地临时图片读成 base64（协议 3 images.data 为标准 Base64）。 */
/** 安全 markdown 解析：流式半截内容（未闭合代码栅栏等）可能抛错，降级为纯文本段落 */
function safeParse(text) {
  try {
    return markdown.parse(text || '');
  } catch (e) {
    const esc = String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return [{ type: 'para', html: '<p>' + esc + '</p>' }];
  }
}

/** markdown 源码 → 可读纯文本（复制用，对齐桌面端行为） */
function mdToPlain(md) {
  return String(md || '')
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/[*_~]{1,3}([^*_\n]+)[*_~]{1,3}/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readImageBase64(image) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: image.tempPath,
      encoding: 'base64',
      success(res) {
        resolve({ mediaType: image.mediaType, data: res.data, name: image.name });
      },
      fail(err) {
        reject(new Error(err.errMsg || uiText('读取图片失败')));
      }
    });
  });
}
