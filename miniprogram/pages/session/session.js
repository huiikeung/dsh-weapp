const { t: uiText } = require('../../utils/ui-preferences');
const { connectionView } = require('../../utils/connection-status');
const scheduleUtil = require('../../utils/schedule');
const haptics = require('../../utils/haptics');
const preferences = require('../../utils/ui-preferences');
const trajectoryView = require('../../utils/trajectory-presentation');
const contextView = require('./utils/context-view');
const turnUsageUtil = require('../../utils/turn-usage');
const { applyTurnFooters } = require('./utils/turn-footer');
const workSteps = require('./utils/work-step-presentation');
const statusAppearance = require('./utils/status-appearance');
const procIconStyle = require('./utils/proc-icon-style');
const store = require('../../utils/store');
const markdown = require('../../utils/markdown');
const labels = require('../../utils/labels');
const util = require('../../utils/util');
const notifySubscription = require('./utils/notify-subscription');
const voicePreference = require('./utils/voice-preference');
const contextPanelsPreference = require('./utils/context-panels-pref');
const contextPreferences = require('./utils/context-prefs');
const settingsGlassStylePreference = require('../../utils/settings-glass-style-pref');
const sessionGlassPreference = require('../../utils/session-glass-pref');
const voiceActions = require('./voice-actions');
const publicAccessPrompt = require('../../utils/public-access-prompt');
const fileActions = require('./file-actions');
const fileMentionActions = require('./file-mention-actions');
const imageBlocks = require('./image-blocks');
const changesActions = require('./changes-actions');
const viewportActions = require('./viewport-actions');
const collaboration = require('../../utils/collaboration');
const protocol = require('../../utils/protocol');
const fileDeliverables = require('./utils/file-deliverables');
const theme = require('../../utils/theme');
const conversationWorkflow = require('./utils/conversation-workflow');
const composerMenu = require('./utils/composer-menu');
const sessionSwitcher = require('./utils/session-switcher');
const attachmentCache = require('../../utils/attachment-cache');
const { dataPatch, createMarkdownCache } = require('./utils/session-render');
const sessionViewCache = require('../../utils/session-view-cache');

const { toolPresentation } = require('./utils/tool-presentation');
const CONTEXT_TREND_OVERVIEW_AUTO_STEPS = 200;
const TRACE_WINDOW_ROWS = 80;
const TRACE_WINDOW_OVERSCAN = 18;
const TURN_NAV_WINDOW_BUFFER = 12;
const TURN_NAV_SCROLL_IDLE_MS = 120;
// Keep virtual-list geometry in lockstep with trajectory.wxss.
const TRACE_TURN_HEIGHT_RPX = 0;
const TRACE_EVENT_ROW_HEIGHT_RPX = 80;
const MUTABLE_ROW_KINDS = new Set(['user', 'assistant', 'changes', 'files', 'status']);
// 实时指标卡的半宽估算（px）：卡片 max-width 480rpx，375pt 机上约 240px。钳制时
// 用它把卡片中心留在可视区内，首/末根柱子也不会被图表裁掉。
const CONTEXT_TREND_TIP_HALF_PX = 110;

/** 把指标卡中心钳制在 [half, width - half]，窄屏时退化为贴边居中。 */
function clampTrendTip(center, width) {
  if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 0) return -1;
  const half = Math.min(CONTEXT_TREND_TIP_HALF_PX, width / 2);
  return Math.round(Math.max(half, Math.min(width - half, center)));
}

// Store protocol rows are reused across emits; only a few row kinds are mutated
function captureRowValue(value, depth = 0) {
  if (Array.isArray(value)) {
    return { type: 'array', values: value.map(item => captureRowValue(item, depth + 1)) };
  }
  if (value && typeof value === 'object') {
    if (depth > 2) return { type: 'ref', value };
    const keys = Object.keys(value);
    return { type: 'object', keys, values: keys.map(key => captureRowValue(value[key], depth + 1)) };
  }
  return { type: 'value', value };
}

function sameRowValueSnapshot(left, right) {
  if (!left || !right || left.type !== right.type) return false;
  if (left.type === 'value' || left.type === 'ref') return left.value === right.value;
  if (left.type === 'array') {
    return left.values.length === right.values.length
      && left.values.every((value, index) => sameRowValueSnapshot(value, right.values[index]));
  }
  return left.keys.length === right.keys.length
    && left.keys.every((key, index) => key === right.keys[index]
      && sameRowValueSnapshot(left.values[index], right.values[index]));
}

function captureMutableRow(row) {
  const keys = Object.keys(row);
  return { keys, values: keys.map(key => captureRowValue(row[key])) };
}

function sameMutableRow(left, right) {
  return !!left && left.keys.length === right.keys.length
    && left.keys.every((key, index) => key === right.keys[index]
      && sameRowValueSnapshot(left.values[index], right.values[index]));
}

function formatSessionCacheHitPercent(cacheReadTokens, billedInputTokens) {
  if (!(billedInputTokens > 0) || cacheReadTokens == null) return null;
  if (cacheReadTokens >= billedInputTokens) return '100';
  const ratio = Math.max(0, cacheReadTokens) / billedInputTokens;
  for (let precision = 0; precision <= 6; precision += 1) {
    const scale = Math.pow(10, precision);
    const units = Math.floor(ratio * 100 * scale + 0.5);
    if (units < 100 * scale) {
      const text = (units / scale).toFixed(precision);
      return text.indexOf('.') < 0 ? text : text.replace(/0+$/, '').replace(/\.$/, '');
    }
  }
  return '99.999999';
}

Page({
  ...viewportActions,
  ...voiceActions,
  ...fileActions,
  ...fileMentionActions({ store, composerMenu, uiText }),
  ...imageBlocks,
  ...changesActions,
  data: {
    sessionGlassEnabled: sessionGlassPreference.read(),
    ...settingsGlassStylePreference.view(),
    statusFlowDelay: 0,
    publicAccessDialog: null,
    publicAccessDialogOpen: false,
    turnUsageSheet: null, turnUsageOpen: false, turnUsagePos: null,
    // ctx-flow 连接线：用原生 view 线段拼成曲线，避免小程序内联 SVG 不渲染。
    contextFlowLinks: [], contextFlowW: 0, contextFlowH: 0,
    collaborationOpen: false, collaborationExpanded: false, collaborationTab: 'members', collaborationRows: [], collaborationTabs: [],
    collaborationCount: 0, collaborationActive: 0, collaborationNote: '', collaborationPreview: null, collaborationBusy: false,
    fileExpanded: {}, filePreview: null, changesDiff: null, fileBusyKey: '', fileSharingKey: '', fileProgress: 0,
    fileMentionOpen: false, fileMentionEntries: [], fileMentionSessionGroups: [], fileMentionLoading: false, fileMentionError: '', fileMentionPathLabel: '', fileMentionQuery: '',
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
    contextBrowserPickerOpen: false,
    contextBrowserPickerTarget: '',
    contextBrowserBase: contextPreferences.read().base,
    contextCurrentHighlight: '',
    contextCommandFilter: 'all',
    contextCommandExpanded: '',
    contextModalOpen: false,
    ctxModalDragStyle: '',
    contextBrowserQuery: '',
    contextBrowserKind: '',
    contextBrowserTool: '',
    contextScrollTarget: '',
    contextEventFilter: null,
    contextFileFilter: 'all',
    contextFileSort: contextPreferences.read().fileSort,
    contextFileQuery: '',
    contextFileExpandedPath: '',
    contextNodeDetail: null,
    contextNodeLoadingSeq: null,
    // 与 dsh-context 一样默认按步骤；长历史达到阈值时自动进入总览带。
    contextTrendSeq: null,
    contextTrendHoverSeq: null,
    contextTrendGroupBy: contextPreferences.read().trendGroupBy,
    contextTrendDisplayMode: contextPreferences.read().trendDisplayMode,
    contextTrendAdaptive: false,
    contextTrendShowDuration: contextPreferences.read().trendShowDuration,
    contextTrendVisibleRange: null,
    // DNA 模式与总览是互斥的两个面向；默认都关（标准堆叠柱）。
    contextTrendDna: false,
    contextTrendOverview: false,
    // 轮次条聚焦（dsh-context 的 activeTurn）：点亮一轮并淡出其余柱。
    contextTrendActiveTurn: null,
    contextTrendTurnLeft: 0,
    // 首帧之前先用「未连接」空态占位，避免 WXML 读取 null 面板。
    contextPanel: contextView.buildPanel(null, { t: uiText, connected: false, hasSession: false }),
    fleetSelectedId: '',
    fleetStageWidth: 0,
    fleetAllOpen: false,
    fleetMemberQuery: '',
    fleetMemberStatus: 'all',
    fleetMemberSort: 'derived',
    fleetMemberSortOpen: false,
    fleetCommsState: 'idle',
    fleetLinksSrc: '',
    fleetTaskQuery: '',
    fleetTaskStatus: '',
    fleetCommsFilter: '',
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
    trajectory: [], traceSpacerTopRpx: 0, traceSpacerBottomRpx: 0, traceTotalCount: 0,
    traceOverview: trajectoryView.overview([]), traceFocusMode: 'duration', traceFocusTurn: null, traceFocusKey: '', traceFocusTouched: false,
    traceCursorVisible: false, traceCursorPercent: 0,
    traceScrollTarget: '', traceHighlightedKey: '', traceMetricTargetKey: '', traceThinkingExpanded: false,
    traceDetailTab: 'summary', traceDetailTabs: [], traceDetailSection: null,
    folds: {},
    scrollTarget: '',
    processFollowTarget: '',
    scrollAnim: false,
    turnNavOpen: false,
    turnNavItems: [],
    turnNavPreview: null,
    turnNavActiveIndex: -1,
    turnNavScrollTop: 0,
    turnNavRowStyles: [],
    turnNavVisibleItems: [],
    turnNavTopPadPx: 0,
    turnNavBottomPadPx: 0,
    turnNavWindowStart: 0,
    turnNavCardTop: 0,
    turnNavWarming: false,
    turnNavWarmText: '',
    turnNavHistoryComplete: false,
    turnNavHistoryPending: false,
    turnNavHistoryText: '',
    hasMoreHistory: false,
    // 旧历史分页在途标志。must be mirrored into page data: maybePrefetchOlderHistory
    historyPaging: false,

    question: null,
    questionBusy: false,
    approval: null,
    approvalBusy: false,

    draft: '',
    // 输入框引用 chip：composerValue 是 textarea 显示值（引用位置为零宽占位符），
    // composerRefs 是按序排列的引用 chips（会话 / 文件夹 / 文件），draft 存原始文本。
    composerRefs: [],
    images: [],
    canSend: false,
    composerFocused: false,
    commandToken: '', commandTokenLabel: '', draftArg: '',
    // 输入框 Markdown 预览：composerPreview 开时用 composerPreviewBlocks 渲染，
    composerPreview: false,
    composerPreviewHint: false,
    // 首帧把 textarea 高度直接定成一行（原生组件默认 150px，auto-height 在真机上
    composerInputHeightPx: 38,
    composerCursor: -1,
    composerPreviewBlocks: [],
    canAttach: true,
    attachSheetOpen: false,
    commandMenuQuery: '', commandPaletteLoading: false, commandPaletteError: '',
    attachmentPicking: false, sendingAttachments: false, fileReferenceMode: false,
    permissionLabel: uiText('工作区写入'),
    permissionIcon: 'shield-write-gray.png',
    permissionChipIconOnly: false,
    modelLabel: 'DeepSeek',
    effortLabel: 'High',
    contextPct: -1,
    runPhrase: '',
    copiedKey: '',
    showJump: false,
    histError: '',
    historyLoading: true,
    historyLoaded: false,
    historyProgressText: uiText('正在从 Mobile Gateway 同步会话内容…'),
    historyState: 'idle',
    connState: 'disconnected',
    connected: false,
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
    contextSheet: { pct: '—', barStyle: 'width:0%;', usedLabel: '— tok', windowLabel: '— tok', rows: [] },
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
    composerMetricsVisible: true,
    composerRunMetric: '— 轮 — 步',
    composerTokenMetric: '— tok',
    composerCacheMetric: '— tok',
    composerContextMetric: '—%',

    traceDetail: null
  },

  onLoad(options) {
    theme.applyTo(this);
    this._initialConversationAnchorPending = true;
    this._initialConversationAnchorApplied = false;
    this._initialConversationAnchorRecoveryPending = false;
    this._initialConversationAnchorRecoveryScheduled = false;
    this._initialConversationAnchorRecoveryEpoch = 0;
    this._conversationReady = false;
    this._initialPageShowPending = true;
    this.setData(statusAppearance.view(statusAppearance.read()));
    this.setData(procIconStyle.view(procIconStyle.read()));
    this._sessionDrafts = {};
    this.sessionId = options.id || store.sessionState.sessionId;
    this._pendingInitialSessionOpen = !!(options.id && (options.reopen === '1' || store.sessionState.sessionId !== options.id));
    this._reuseRunningSessionOnEntry = this._pendingInitialSessionOpen
      && String(store.sessionState.sessionId || '') === String(options.id || '')
      && store.sessionState.running === true;
    this._fastLiveSessionEntry = this._reuseRunningSessionOnEntry;
    if (this._pendingInitialSessionOpen) {
      // Paint the page shell before cache restore / row projection can occupy the logic thread.
      this.setData({ rows: [], historyState: 'requested', historyLoading: true,
        historyLoaded: false, historyProgressText: uiText('正在从 Mobile Gateway 同步会话内容…') });
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
      // 76rpx 的一行高度换算成 px：首帧直接用它，避免原生 textarea 的 150px 默认值露出来。
      const oneLinePx = Math.max(24, Math.round(76 * winW / 750));
      this.setData({
        composerInputHeightPx: oneLinePx,
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
    if (this._pendingInitialSessionOpen) {
      const sessionId = options.id;
      // Start cache/history hydration as soon as the loading shell has reached
      // the view layer. A fixed timer can leave an avoidable blank beat during
      // the page transition, especially when the first frame is delayed.
      wx.nextTick(() => {
        if (this._unloaded || this.sessionId !== sessionId) return;
        this._pendingInitialSessionOpen = false;
        this._preferImmediateStoreSync = true;
        if (this._reuseRunningSessionOnEntry) {
          // Reuse the live snapshot: reopening the active run would reload its
          // cache and delay mounting the already-available in-progress tail.
          this.syncFromStore({ app: store.state, session: store.sessionState });
        } else {
          store.openSession(sessionId, options.title || '', options.preset || null);
        }
      });
    } else {
      this.syncFromStore({ app: store.state, session: store.sessionState });
    }
  },

  onReady() {
    this._conversationReady = true;
    // 首帧渲染完成后立即测量 dock，避免默认留白遮挡底部内容
    this.updateDockInset();
    this.measureConversationViewport();
    this.schedulePermissionChipFit();
    this.scheduleInitialConversationAnchorRecovery();
    if (!this._initialConversationAnchorPending && !this._initialConversationAnchorApplied) {
      this.refreshBottomAnchor();
    }
    this.startScrollPolling();
    // 编队舞台只在切到编队/上下文时才看得见：首帧不做这次 selector 查询，挪到空闲时再量。
    if (this._fleetMeasureTimer) clearTimeout(this._fleetMeasureTimer);
    this._fleetMeasureTimer = setTimeout(() => {
      this._fleetMeasureTimer = null;
      if (this._unloaded) return;
      this.measureFleetStage();
    }, 400);
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
    if (this._turnWarmTimer) clearTimeout(this._turnWarmTimer);
    this._turnWarmTimer = null;
    this.stopScrollPolling();
    // 记录本次隐藏的原因：原生选择器/预览浮层会把小程序切到后台，
    this._hiddenByNativeOverlay = !!(store.nativeOverlayActive && store.nativeOverlayActive());
  },

  onShow() {
    this.setData(Object.assign({ sessionGlassEnabled: sessionGlassPreference.read() }, settingsGlassStylePreference.view({ light: String(this.data.themeClass || '').indexOf('light') >= 0 })));
    const firstPageShow = this._initialPageShowPending === true;
    this._initialPageShowPending = false;
    const foregroundEpoch = this.currentAppForegroundEpoch();
    const resumedFromBackground = this._lastForegroundEpoch != null
      && foregroundEpoch !== this._lastForegroundEpoch;
    this._lastForegroundEpoch = foregroundEpoch;
    this.syncContextPanelPreferences();
    this._voiceHidden = false; this.syncVoicePreference();
    // 从原生浮层（chooseMedia / chooseMessageFile / previewImage）返回：
    if (this._hiddenByNativeOverlay) {
      this._hiddenByNativeOverlay = false;
      this.startScrollPolling();
      this.setData(statusAppearance.view(statusAppearance.read()));
      this.setData(procIconStyle.view(procIconStyle.read()));
      this.updateDockInset();
      this.measureConversationViewport();
      if (this._turnWarmup) this.pumpTurnNavigatorWarmup();
      return;
    }
    if (this._pendingInitialSessionOpen) {
      this.setData(Object.assign(statusAppearance.view(statusAppearance.read()), procIconStyle.view(procIconStyle.read())));
      return;
    }
    if (resumedFromBackground) this.refreshSessionPreset(true);
    // App onShow also runs when WeChat returns from the background. Keep the
    // existing viewport in that case; only a page-level return resets to latest.
    // Re-entry can happen while the virtual list is still mounted on an older
    // window. Recompute that window before anchoring; otherwise conv-bottom may
    // point past a large spacer while the latest message is not in the DOM.
    if (!resumedFromBackground && !firstPageShow) this.jumpToBottom();
    this.startScrollPolling();
    // 首次进入时 onLoad 刚同步过同一份快照：再同步一次等于把整份 rows 重新投影 + 跨桥一次，
    if (store.sessionState && store.sessionState.sessionId && Date.now() - (this._lastSyncAt || 0) > 400) {
      this.syncFromStore({ app: store.state, session: store.sessionState });
    }
    if (this._turnWarmup) this.pumpTurnNavigatorWarmup();
    if (!firstPageShow) this.refreshBottomAnchor();
    this.setData(Object.assign(statusAppearance.view(statusAppearance.read()), procIconStyle.view(procIconStyle.read())));
    // 返回前台/切回页面：dock 高度可能变化（键盘、队列、审批卡）
    this.updateDockInset();
    this.measureConversationViewport();
  },

  onResize() {
    if (this.data.tab === 'conversation') {
      this.updateDockInset();
      this.measureConversationViewport();
      this.schedulePermissionChipFit();
    } else if (this.data.tab === 'trajectory') {
      this._traceTrackRect = null;
    }
  },

  // 首次 scroll-into-view 可能早于 scroll-view/虚拟列表布局完成。页面 ready 后
  // 再补一次同目标；只有未发生手动触摸时才恢复跟随，避免抢走用户的阅读位置。
  scheduleInitialConversationAnchorRecovery() {
    if (!this._conversationReady || !this._initialConversationAnchorRecoveryPending
      || this._initialConversationAnchorRecoveryScheduled || !this.data.rows.length
      || this.data.tab !== 'conversation') return;
    this._initialConversationAnchorRecoveryScheduled = true;
    const epoch = this._initialConversationAnchorRecoveryEpoch;
    const sessionId = this._renderSessionId;
    const touchAt = Number(this._lastTouchAt) || 0;
    const tick = typeof wx !== 'undefined' && typeof wx.nextTick === 'function'
      ? wx.nextTick : (fn) => fn();
    tick(() => {
      if (epoch !== this._initialConversationAnchorRecoveryEpoch) return;
      this._initialConversationAnchorRecoveryScheduled = false;
      if (!this._initialConversationAnchorRecoveryPending) return;
      if (this._unloaded || sessionId !== this._renderSessionId || !this.data.rows.length) {
        this._initialConversationAnchorRecoveryPending = false;
        return;
      }
      if (this.data.tab !== 'conversation') return;
      this._initialConversationAnchorRecoveryPending = false;
      if (touchAt !== 0
        || (Number(this._lastTouchAt) || 0) !== touchAt
        || this._panelGesture && this._panelGesture.tab === 'conversation') return;
      this._convPinned = true;
      this._followPausedByUser = false;
      this._userScrollDirection = '';
      this._scrollAnchorAt = Date.now();
      this.refreshBottomAnchor();
      // 首屏锚点常常赶在原生布局完成前生效：自检一次，没落底就补锚。
      this.verifyConversationBottom();
    });
  },

  currentAppForegroundEpoch() {
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      return Number(app && app.globalData && app.globalData.foregroundEpoch) || 0;
    } catch (_) { return 0; }
  },

  onPublicAccessDialogConfirm() { publicAccessPrompt.resolvePublicAccessDialog(this); },

  onUnload() {
    this.retainSessionView();
    this.stopContextFlow();
    this.clearContextModalDrag();
    if (store.setTrajectoryActive) store.setTrajectoryActive(false);
    if (store.setContextActive) store.setContextActive(false);
    if (store.setFleetActive) store.setFleetActive(false);
    this._commandRequest = null; this._commandOptionRequest = null; this._attachmentRequest = null; this._filesRequest = null;
    this._collaborationRequest = null;
    this._collaborationRefresh = null;
    this.disposePresentedFiles();
    this.disposeMarkdownImages();
    this.cancelVoice();
    if (this._voice) this._voice.dispose();
    this._unloaded = true;
    if (this._historyFormatTimer) clearTimeout(this._historyFormatTimer);
    this._historyFormatTimer = null; this._pendingHistoryFormat = null;
    if (this._fleetMeasureTimer) clearTimeout(this._fleetMeasureTimer);
    this._fleetMeasureTimer = null;
    if (this._windowMeasureTimer) clearTimeout(this._windowMeasureTimer);
    this._windowMeasureTimer = null;
    if (this._windowShiftTimer) clearTimeout(this._windowShiftTimer);
    this._windowShiftTimer = null;
    this._pendingWindowScrollTop = null;
    if (this._turnScrollIdleTimer) clearTimeout(this._turnScrollIdleTimer);
    this._turnScrollIdleTimer = null;
    if (this._thumbTimer) clearTimeout(this._thumbTimer);
    this._thumbTimer = null; this._thumbQueue = null; this._thumbQueued = null; this._thumbFailed = null;
    if (this._storeSyncTimer) clearTimeout(this._storeSyncTimer);
    this._storeSyncTimer = null;
    this.stopTurnNavigatorWarmup(false);
    this._pendingStoreSnapshot = null;
    if (this._traceHighlightTimer) clearTimeout(this._traceHighlightTimer);
    if (this._traceCursorTimer) clearTimeout(this._traceCursorTimer);
    if (this._bottomAnchorTimer) clearTimeout(this._bottomAnchorTimer);
    this._bottomAnchorTimer = null;
    this._traceTimelineGesture = null;
    this._traceTrackCallbacks = [];
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

  retainSessionView() {
    if (!this._viewCacheKey || !this._markdownCache) return;
    const projected = new Map();
    (this._projectedRows || new Map()).forEach((value, key) => {
      const row = value.row;
      // Local image paths/download state can expire while another page is open.
      if (row.kind === 'files' || row.kind === 'changes' || (row.images || []).length
        || (row.attachments || []).length || (row.blocks || []).some(block => block.type === 'image')) return;
      projected.set(key, value);
    });
    sessionViewCache.put(this._viewCacheKey, { markdown: this._markdownCache.textSnapshot(), projected,
      entries: projected.size === (this._projectedRows || new Map()).size ? this._entriesCache : null
    }, this._viewCacheGeneration);
  },

  scheduleHistoryFormatting() {
    if (this._historyFormatTimer || this._voiceHidden || this._unloaded || !this._pendingHistoryFormat || !this._pendingHistoryFormat.size) return;
    const sessionId = this._renderSessionId;
    this._historyFormatTimer = setTimeout(() => {
      this._historyFormatTimer = null;
      if (this._voiceHidden || this._unloaded || sessionId !== this._renderSessionId) return;
      if (this._turnScrubbing || Date.now() < (this._interactionUntil || 0)) { this.scheduleHistoryFormatting(); return; }
      const indices = new Map((this.data.rows || []).map((row, index) => [row.key, index]));
      const processChildren = new Map();
      (this.data.rows || []).forEach((row, rowIndex) => {
        if (row.kind !== 'processGroup') return;
        (row.children || []).forEach((child, childIndex) => {
          const formatKey = child.formatKey || child.sourceKey;
          if (formatKey && child.kind === 'narration') processChildren.set(formatKey, { rowIndex, childIndex, child });
        });
      });
      const patch = {}, started = Date.now();
      let count = 0;
      for (const [key, text] of this._pendingHistoryFormat) {
        if (!indices.has(key) && !processChildren.has(key)) continue;
        this._pendingHistoryFormat.delete(key);
        const index = indices.get(key), row = index === undefined ? null : this.data.rows[index];
        // 助手与用户消息都走 Markdown：进入窗口后补解析并写回 blocks。
        if (row && (row.kind === 'assistant' || row.kind === 'user') && row.text === text) {
          const blocks = this.prepareImageBlocks(this._markdownCache.parse(key, text));
          patch['rows[' + index + '].blocks'] = blocks;
          const source = (this._conversationRows || []).find(item => item.key === key);
          if (source) source.blocks = blocks;
          // 投影缓存里的同一行也要写回：复用缓存的投影时如果不带 blocks，
          const cachedProjection = this._projectedRows && this._projectedRows.get(key);
          if (cachedProjection && cachedProjection.row
            && (cachedProjection.row.kind === 'assistant' || cachedProjection.row.kind === 'user')) {
            cachedProjection.row = Object.assign({}, cachedProjection.row, { blocks });
          }
        } else {
          const nested = processChildren.get(key);
          if (nested && nested.child.text === text) {
            const blocks = this.prepareImageBlocks(this._markdownCache.parse(key, text));
            patch['rows[' + nested.rowIndex + '].children[' + nested.childIndex + '].blocks'] = blocks;
            nested.child.blocks = blocks;
          const cachedProjection = this._projectedRows && this._projectedRows.get(nested.child.sourceKey);
          if (cachedProjection && cachedProjection.row && cachedProjection.row.kind === 'assistant'
            && nested.child.text === cachedProjection.row.text) cachedProjection.row = Object.assign({}, cachedProjection.row, { blocks });
          }
        }
        if (++count >= 4 || Date.now() - started >= 8) break;
      }
      if (Object.keys(patch).length) this.setData(patch, () => {
        this.measureConversationWindow();
        const initialAnchorActive = this._initialConversationAnchorPending
          || this._initialConversationAnchorApplied;
        if (!initialAnchorActive && !this._unloaded && !this._voiceHidden
          && sessionId === this._renderSessionId && this._convPinned !== false) this.refreshBottomAnchor();
      });
      if ([...this._pendingHistoryFormat.keys()].some(key => indices.has(key) || processChildren.has(key))) this.scheduleHistoryFormatting();
    }, 32);
  },

  scheduleStoreSync(snapshot) {
    if (this._unloaded || this._voiceHidden) return;
    if (this._pendingInitialSessionOpen) return;
    this._pendingStoreSnapshot = snapshot;
    if (this._storeSyncTimer) return;
    // 大会话（上千行）每次投影 + 分组 + 差分的成本远高于 32ms：帧率换平滑没有意义，
    const busyFloor = (this.data.rows && this.data.rows.length > 120) ? 96 : 32;
    const delay = this._preferImmediateStoreSync
      ? 0 : Math.max(busyFloor, (this._interactionUntil || 0) - Date.now());
    this._preferImmediateStoreSync = false;
    const flush = () => {
      this._storeSyncTimer = null;
      if (this._unloaded || this._voiceHidden) { this._pendingStoreSnapshot = null; return; }
      const latest = this._pendingStoreSnapshot;
      if (this._turnScrubbing && latest && !this._unloaded && !this._voiceHidden) {
        this._interactionUntil = Date.now() + 100;
        this.scheduleStoreSync(latest);
        return;
      }
      const scrolling = this.data.tab === 'conversation' && this._convPinned === false;
      const scrollQuietFor = Date.now() - (this._lastConvScrollAt || 0);
      if (latest && scrolling && scrollQuietFor < 160) {
        this._storeSyncTimer = setTimeout(flush, Math.max(16, 160 - scrollQuietFor));
        return;
      }
      this._pendingStoreSnapshot = null;
      if (!this._unloaded && !this._voiceHidden && latest) this.syncFromStore(latest);
    };
    this._storeSyncTimer = setTimeout(flush, delay);
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
    // onShow 用它判断"刚同步过同一份快照"，避免冷启动时把整份 rows 投影两遍。
    this._lastSyncAt = Date.now();
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

  /**
   * 大会话（几千行）每一帧都对全部行重新做请求分组太贵：真正在变的只有最后一个请求。
   * 这里按"最后一个用户请求起点"把行切成前缀 + 尾巴：前缀的行签名没变就复用上次的分组结果，
   * 只对尾巴重新分组。前缀条目对象复用后，差分层也会跳过它们，跨桥数据量随之下降。
   */
  buildEntriesCached(semanticRows, opts) {
    const cache = this._entriesCache;
    if (cache && cache.totalRows && semanticRows.length < cache.totalRows) this._entriesCache = null;
    let boundary = -1;
    for (let i = semanticRows.length - 1; i > 0; i -= 1) {
      const row = semanticRows[i];
      if (row.kind === 'user') {
        boundary = i;
        break;
      }
    }
    if (boundary <= 0) {
      const entries = conversationWorkflow.buildEntries(semanticRows, opts);
      this._entriesCache = { totalRows: semanticRows.length, key: '', entries: [] };
      return entries;
    }
    const prefixRows = semanticRows.slice(0, boundary);
    const tailRows = semanticRows.slice(boundary);
    const lastPrefixRow = prefixRows[prefixRows.length - 1];
    const prefixKey = prefixRows.length + '|' + lastPrefixRow.key + '|'
      + String(opts.completedEntryKey || '') + '|' + String(opts.lastDurationMs || 0);
    let prefixEntries = null;
    const samePrefix = cache && Array.isArray(cache.rows) && cache.rows.length === prefixRows.length
      && cache.rows.every((row, index) => row === prefixRows[index]);
    if (samePrefix && cache.key === prefixKey && Array.isArray(cache.entries)) prefixEntries = cache.entries;
    if (!prefixEntries) {
      // 前缀里最后一个请求早已结束：running 传 false，和后缀独立分组的结果一致。
      prefixEntries = conversationWorkflow.buildEntries(prefixRows, Object.assign({}, opts, { running: false }));
    }
    const tailEntries = conversationWorkflow.buildEntries(tailRows, opts);
    this._entriesCache = { totalRows: semanticRows.length, key: prefixKey, rows: prefixRows, entries: prefixEntries };
    return prefixEntries.concat(tailEntries);
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
    const viewCacheKey = JSON.stringify([app.activeID || app.endpoint || '', s.sessionId, s.cwd || '',
      this.viewportRpx || 750, this.data.theme || '', this.data.uiLocale || '',
      this.data.contentFontStyle || '', s.historyFormatVersion || '']);
    const viewChanged = this._viewCacheKey !== viewCacheKey || this._viewCacheGeneration !== sessionViewCache.generation();
    if (viewChanged) this.retainSessionView();
    const sessionChanged = this._renderSessionId !== s.sessionId
      || this._renderHost !== String(app.activeID || app.endpoint || '');
    const prioritizeInitialPaint = sessionChanged || this._initialConversationAnchorPending === true;
    if (sessionChanged) {
      if (this._bottomAnchorTimer) clearTimeout(this._bottomAnchorTimer);
      this._bottomAnchorTimer = null;
      this._initialConversationAnchorPending = true;
      this._initialConversationAnchorApplied = false;
      this._initialConversationAnchorRecoveryPending = false;
      this._initialConversationAnchorRecoveryScheduled = false;
      this._initialConversationAnchorRecoveryEpoch = (this._initialConversationAnchorRecoveryEpoch || 0) + 1;
      this.closeFileMention();
      this.resetConversationScroll();
      this._processFollowPaused = Object.create(null);
      this._processFollowKey = '';
      this._processFollowVersion = (this._processFollowVersion || 0) + 1;
      this._processFollowRequest = (this._processFollowRequest || 0) + 1;
      this._processBodyFollowTops = Object.create(null);
      this._processBodyHeights = Object.create(null);
      this._processBodyMeasurePending = Object.create(null);
      this._processBodyScrollMetrics = Object.create(null);
      this._processBodyGesture = null;
      this._processBodyManualKey = '';
      this._fleetCommsGeneration = (this._fleetCommsGeneration || 0) + 1;
      this._fleetComms = null;
      this._fleetCommsAsOfSeq = null;
      this._fleetAutoScanInFlight = false;
      this._fleetAutoScanFor = '';
      // 切会话：浏览器游标/折叠状态属于上一个会话，清空并从「当前」重新开始。
      this._contextPanelCache = null;
      this._fleetPanelCache = null;
      this._contextContentCache = Object.create(null);
      this._contextContentPending = Object.create(null);
      this._ctxTrendTouch = null;
      this.setData({
        contextBrowserSeq: null,
        contextBrowserIsCurrent: false,
        contextBrowserExpanded: [],
        contextBrowserPickerOpen: false,
        contextBrowserPickerTarget: '',
        contextBrowserBase: contextPreferences.read().base,
        contextCurrentHighlight: '',
        contextCommandFilter: 'all',
        contextCommandExpanded: '',
        contextModalOpen: false,
        contextBrowserQuery: '',
        contextBrowserKind: '',
        contextBrowserTool: '',
        contextEventFilter: null,
        contextFileFilter: 'all',
        fleetCommsState: 'idle',
        fleetCommsFilter: '',
        contextFileSort: contextPreferences.read().fileSort,
        contextFileQuery: '',
        contextFileExpandedPath: '',
        contextNodeDetail: null,
        contextNodeLoadingSeq: null,
        contextTrendSeq: null,
        contextTrendHoverSeq: null,
        contextTrendGroupBy: contextPreferences.read().trendGroupBy,
        contextTrendDisplayMode: contextPreferences.read().trendDisplayMode,
        contextTrendAdaptive: false,
        contextTrendVisibleRange: null
      });
    }
    const trendAutoOverviewPatch = this.contextTrendAutoOverviewPatch(s);
    if (!this._markdownCache || viewChanged) {
      if (this._renderSessionId && this._renderSessionId !== s.sessionId) {
        this._sessionDrafts = this._sessionDrafts || {};
        this._sessionDrafts[this._renderSessionId] = {
          draft: this.data.draft || '',
          images: Array.isArray(this.data.images) ? this.data.images.slice() : []
        };
        const savedDraft = this._sessionDrafts[s.sessionId] || { draft: '', images: [] };
        // 恢复草稿时把原始引用文本还原成 chip 行 + 零宽占位符显示值。
        this.setComposerValue(savedDraft.draft || '', {
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
        this.setData({ filePreview: null, fileExpanded: {} });
      }
      const retained = sessionViewCache.take(viewCacheKey);
      this._markdownCache = createMarkdownCache(safeParse, retained && retained.markdown);
      this._projectedRows = retained ? retained.projected : null;
      this._entriesCache = retained ? retained.entries : null;
      this._viewCacheKey = viewCacheKey;
      this._viewCacheGeneration = sessionViewCache.generation();
      this._renderHost = String(app.activeID || app.endpoint || '');
      this._conversationWindow = null;
      if (this._historyFormatTimer) clearTimeout(this._historyFormatTimer);
      this._historyFormatTimer = null;
      this._pendingHistoryFormat = new Map();
      this._renderSessionId = s.sessionId;
      if (sessionChanged) {
        this._processRunningDone = '';
        this._lastRunSeconds = 0;
        this._processRunning = false;
      }
    }
    // 用户消息现在也走 Markdown 缓存，必须一起 retain，否则每次 emit 都被清空重解析。
    this._markdownCache.retain((s.rows || []).filter(row => row.kind === 'assistant' || row.kind === 'user').flatMap(row => {
      const keys = [row.key];
      if (row.kind === 'assistant' && row.key) (row.events || []).forEach((event, index) => {
        if (event && event.kind === 'text') keys.push(row.key + '/process/' + index);
      });
      return keys;
    }));

    // dsh-mobile 同款两段投影：protocol 只产生语义行，conversation-workflow
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
    // 图片预取不参与渲染：历史行到达时先排队下载，滚到可见位置通常已就绪。
    this.prefetchImageMarkdown(s.rows || []);
    // 行投影缓存：静态协议行按对象身份复用；少数会被协议原地修改的行用浅快照验证，
    const projected = this._projectedRows || (this._projectedRows = new Map());
    if (projected.size > 4000) projected.clear();
    const projectionScope = String(s.cwd || '') + '@' + String(this.viewportRpx || 750);
    const nextProjected = new Map();
    const listedSession = (app.sessions || []).find(item => item.id === s.sessionId || item.sessionId === s.sessionId);
    (s.rows || []).forEach((row, rowIndex) => {
      const cachedRow = projected.get(row.key);
      const mutable = MUTABLE_ROW_KINDS.has(row.kind);
      const canCheckByIdentity = cachedRow && cachedRow.sourceRow === row && !mutable;
      const rowSnapshot = canCheckByIdentity ? null : captureMutableRow(row);
      const unchanged = cachedRow && cachedRow.scope === projectionScope
        && (canCheckByIdentity || sameMutableRow(cachedRow.sourceSnapshot, rowSnapshot));
      if (unchanged) {
        let reused = cachedRow.row;
        // 兜底：历史懒格式化可能晚于投影产生，缓存的 blocks 还是空的；
        if ((row.kind === 'assistant' || row.kind === 'user') && !((reused.blocks || []).length)) {
          const formatted = this._markdownCache.peek(row.key, row.text || '');
          if (formatted && formatted.length) reused = Object.assign({}, reused, { blocks: this.prepareImageBlocks(formatted) });
          else this._pendingHistoryFormat.set(row.key, row.text || '');
        }
        semanticRows.push(reused);
        if (reused === cachedRow.row && cachedRow.sourceRow === row) nextProjected.set(row.key, cachedRow);
        else nextProjected.set(row.key, Object.assign({}, cachedRow, {
          sourceRow: row,
          sourceSnapshot: rowSnapshot,
          row: reused
        }));
        return;
      }
      // 同一个协议对象若未变化，下一帧直接复用投影，不重算装饰和 Markdown。
      const emit = (out) => {
        semanticRows.push(out);
        nextProjected.set(row.key, {
          scope: projectionScope,
          sourceRow: row,
          sourceSnapshot: rowSnapshot || cachedRow && cachedRow.sourceSnapshot,
          row: out
        });
      };
      if (row.kind === 'changes') {
        const changes = this.decorateChanges(row);
        if (changes) emit(changes);
        return;
      }
      if (row.kind === 'files') {
        emit(Object.assign({}, row, { files: row.files.map(fileDeliverables.describe) }));
        return;
      }
      if (row.kind === 'assistant') {
        const text = row.text || '';
        // Rebuilding rich-text nodes for every streamed token causes visible flashes.
        // Keep the live answer as plain text, then parse Markdown once it settles.
        const streaming = row.streaming === true;
        let blocks = streaming ? null : this._markdownCache.peek(row.key, text);
        if (!blocks && !streaming && !prioritizeInitialPaint && rowIndex >= s.rows.length - 12) {
          blocks = this._markdownCache.parse(row.key, text);
        }
        if (blocks) blocks = this.prepareImageBlocks(blocks);
        if (streaming) this._pendingHistoryFormat.delete(row.key);
        else if (!blocks) this._pendingHistoryFormat.set(row.key, text);
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
            resultImages: this.decorateRowImages(tool.resultImages),
            statusText: tool.isError ? uiText('失败') : (tool.status === 'done' ? '' : tool.phase === 'preparing' ? uiText('正在准备…') : uiText('运行中'))
          });
        });
        emit(Object.assign({}, row, {
          blocks: blocks || [],
          images: this.decorateRowImages(row.images),
          copyText: row.text || '',
          tools: tools
        }));
        return;
      }
      // 空内容行不渲染（映射未覆盖的事件形态不产生"圆点"空气泡）
      if (row.kind === 'user' && !(row.text || '').trim() && !(row.images || []).length && !(row.attachments || []).length) return;
      if (row.kind === 'context' && !(row.text || '').trim()) return;
      const copy = Object.assign({}, row);
      if (row.kind === 'context') {
        copy.preview = previewOf(row.text);
        copy.title = row.title || uiText('上下文');
      }
      if (row.kind === 'user') {
        copy.images = this.decorateRowImages(row.images);
        // 用户消息也按 Markdown 渲染，但沿用助手消息的懒解析策略：只有接近尾部
        const text = row.text || '';
        let blocks = this._markdownCache.peek(row.key, text);
        if (!blocks && !prioritizeInitialPaint && rowIndex >= s.rows.length - 12) {
          blocks = this._markdownCache.parse(row.key, text);
        }
        if (blocks) blocks = this.prepareImageBlocks(blocks);
        if (blocks) this._pendingHistoryFormat.delete(row.key);
        else this._pendingHistoryFormat.set(row.key, text);
        copy.blocks = blocks || [];
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
      emit(copy);
    });
    this._projectedRows = nextProjected;
    const rows = this.buildEntriesCached(semanticRows, {
      running: processRunning,
      completedEntryKey: this._processRunningDone || '',
      lastDurationMs: (this._lastRunSeconds || 0) * 1000
    }).map(entry => Object.assign({}, entry));
    const processBodyFollowTops = this._processBodyFollowTops || (this._processBodyFollowTops = Object.create(null));
    rows.forEach(entry => {
      if (entry.kind !== 'processGroup') return;
      if (Number.isFinite(processBodyFollowTops[entry.key])) {
        entry.processBodyScrollTop = processBodyFollowTops[entry.key];
      }
      (entry.children || []).forEach(child => {
        if (child.kind === 'narration') {
          child.images = this.decorateRowImages(child.images);
          const formatKey = child.formatKey || child.sourceKey;
          const blocks = child.blocks && child.blocks.length
            ? child.blocks : formatKey && this._markdownCache.peek(formatKey, child.text || '');
          if (blocks && blocks.length) child.blocks = this.prepareImageBlocks(blocks);
          else if (formatKey && child.text) this._pendingHistoryFormat.set(formatKey, child.text);
        } else if (child.kind === 'toolBundle') {
          (child.tools || []).forEach(tool => { tool.resultImages = this.decorateRowImages(tool.resultImages); });
        }
      });
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
    const turns = stats.turns == null || !Number.isFinite(Number(stats.turns)) || Number(stats.turns) < 0
      ? null : Number(stats.turns);
    const steps = stats.steps == null || !Number.isFinite(Number(stats.steps)) || Number(stats.steps) < 0
      ? null : Number(stats.steps);
    const durationSeconds = totalMs / 1000;
    const statsPayload = (s.stats && s.stats.stats) || {};
    const tokenUsage = Object.assign({}, statsPayload.tokenUsage || {}, (s.stats && s.stats.tokenUsage) || {});
    const tokenTotals = tokenUsage.totals || {};
    const pressure = [
      s.stats && s.stats.pressure,
      statsPayload.pressure,
      statsPayload
    ].find((item) => item && item.contextWindow != null &&
      (item.projectedTokens != null || item.pressureTokens != null)) || null;
    const finiteToken = (value) => {
      const number = Number(value);
      return value != null && Number.isFinite(number) && number >= 0 ? number : null;
    };
    const contextUsedTokens = pressure
      ? finiteToken(pressure.projectedTokens) != null
        ? finiteToken(pressure.projectedTokens) : finiteToken(pressure.pressureTokens)
      : null;
    const contextWindow = pressure ? finiteToken(pressure.contextWindow) : null;
    const contextPct = contextUsedTokens != null && contextWindow > 0
      ? Math.min(100, Math.max(0, Math.round((contextUsedTokens / contextWindow) * 100)))
      : -1;
    let decodeRate = stats.decodeMs > 0 && stats.decodeTokens != null
      ? Number(stats.decodeTokens) / (Number(stats.decodeMs) / 1000)
      : null;
    if (decodeRate == null && stats.decodeTokensPerSec != null) decodeRate = Number(stats.decodeTokensPerSec);
    if (decodeRate == null && tokenTotals.outputTokens && stats.llmMs) {
      decodeRate = Number(tokenTotals.outputTokens) / (Number(stats.llmMs) / 1000);
    }
    const tokenUsageValue = (name) => finiteToken(
      tokenUsage[name] != null ? tokenUsage[name] : tokenTotals[name]
    );
    const uncachedInputTokens = tokenUsageValue('uncachedInputTokens');
    const cacheReadTokens = tokenUsageValue('cacheReadTokens');
    const cacheWriteTokens = tokenUsageValue('cacheWriteTokens');
    const inputTokens = tokenUsageValue('inputTokens');
    const outputTokens = tokenUsageValue('outputTokens');
    const hasDisjointInput = uncachedInputTokens != null && cacheReadTokens != null && cacheWriteTokens != null;
    const billedInputTokens = hasDisjointInput
      ? uncachedInputTokens + cacheReadTokens + cacheWriteTokens
      : inputTokens;
    const tokenTotal = billedInputTokens != null && outputTokens != null
      ? billedInputTokens + outputTokens : null;
    const cacheHitPct = formatSessionCacheHitPercent(cacheReadTokens, billedInputTokens);
    const compactMetricToken = (value) => {
      const n = Number(value || 0);
      if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(Math.round(n));
    };
    const composerRunMetric = (turns != null ? turns : '—') + uiText(' 轮 ') +
      (steps != null ? steps : '—') + uiText(' 步');
    // Match DSH's session tokenUsage projection: billed input buckets plus output;
    // never sum the current page's per-turn cache as if it were the whole session.
    const composerTokenMetric = tokenTotal != null
      ? compactMetricToken(tokenTotal) + ' tok' + (cacheHitPct != null ? ' · ' + cacheHitPct + '%' : '')
      : '— tok';
    const composerCacheMetric = composerTokenMetric;
    const composerContextMetric = contextPct >= 0 ? contextPct + '%' : '—%';

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
        : (task.status === 'in_progress'
          ? (this.data.theme === 'dark' ? 'pinwheel-white.png' : 'pinwheel-ink.png')
          : 'dotted-gray.png')
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
    this.refreshSessionPreset(false);

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
    const contextSheet = pressure && contextWindow > 0 && contextUsedTokens != null ? {
      pct: contextPct,
      barStyle: 'width:' + contextPct + '%;',
      usedLabel: '~' + compactTok(contextUsedTokens),
      windowLabel: compactTok(contextWindow),
      rows: contextRows
    } : {
      pct: '—',
      barStyle: 'width:0%;',
      usedLabel: '— tok',
      windowLabel: '— tok',
      rows: []
    };

    const workPrefs = workSteps.read();
    const policyKey = s.sessionId + '/' + workPrefs.mode + '/' + workPrefs.timing;
    const processFolds = workSteps.apply(rows, workPrefs, this.data.folds, this._conversationRows || this.data.rows, this._workPolicyKey !== policyKey);
    this._workPolicyKey = policyKey;
    this._workStepMode = workPrefs.mode;
    this._processRunning = processRunning;

    applyTurnFooters(rows, s.rows || [], s.turnUsage || {}, processRunning);

    // 回合级「已完成」disclosure 收起时，它管辖的过程组与中间叙述要从行列表里滤掉：
    // 对话窗口按行索引推算偏移，只靠 wx:if 隐藏会让占位高度算错、滚动位置跳。
    // 全量行另存一份，toggleFold 翻 folds 时靠它重算可见行（否则点了要等下一次
    // 同步才补上，空闲时就干脆点不开）。
    this._allConversationRows = rows;
    // 简洁模式运行中：只留活动组那一行「正在xxxx」——独立成行的过程文字也一起收起来，
    // 回合收工后随「已完成」disclosure 回来（默认折叠，点开才见）。
    const compactLive = workPrefs.mode === 'compact' && processRunning;
    this._compactLiveNarration = compactLive;
    const visibleRows = rows.filter(row => {
      if (row.turnProcessKey && !processFolds[row.turnProcessKey]) return false;
      if (compactLive && row.processNarration === true) return false;
      return true;
    });

    // 只有最新的活动组拥有实时跟随权。即便旧数据意外留下多个 running 组，
    // 最新组被手动暂停或当前不可见时也不能退回去追逐更早的过程。
    const followGroup = this.processFollowCandidate(rows, visibleRows);
    const processFollowKey = followGroup ? followGroup.key : '';
    const previousProcessFollowKey = this._processFollowKey || '';
    const previousProcessFollowSignature = this._processFollowSignature || '';
    this._processFollowKey = processFollowKey;
    const processFollowSignature = followGroup ? this.processFollowSignature(followGroup) : '';
    this._processFollowSignature = processFollowSignature;
    const processFollowChanged = previousProcessFollowKey !== processFollowKey;
    const processFollowContentChanged = previousProcessFollowSignature !== processFollowSignature;
    let processFollowTarget = '';
    if (followGroup && !processFollowChanged && !(this._processFollowPaused || {})[processFollowKey]) {
      processFollowTarget = this.data.processFollowTarget || '';
    }

    // 顶部标题：实时标题优先；其次回查会话列表（直连打开/列表迟到时）；
    const listed = (app.sessions || []).find((x) => x.sessionId === s.sessionId) || null;
    const fallbackTitle = (listed && (listed.title || listed.snippet)) || (s.historyState === 'creating' ? uiText('新会话') : uiText('会话'));

    const historyMerged = !!(s && s.historyMergeId && s.historyMergeId !== (this._historyMergeId || 0));
    // 上下文/编队面板只在对应 Tab（或弹窗）可见时才派生视图模型。
    const activeTab = this.data.tab;
    const contextVisible = activeTab === 'context' || this.data.contextModalOpen === true;
    const previousTailKey = this.data.rows && this.data.rows.length
      ? this.data.rows[this.data.rows.length - 1].key : '';
    const nextTailKey = visibleRows.length ? visibleRows[visibleRows.length - 1].key : '';
    const conversationTailChanged = previousTailKey !== nextTailKey;
    const conversationPatch = this.conversationWindowPatch(visibleRows,
      historyMerged && activeTab === 'conversation' && this._convPinned === false ? { anchor: true } : null);
    // 流式输出时最后一行 key 不变、只有内容变高：也要继续贴底，否则进入会话后
    // 内容一长视图就停在半途（表现为「定位不到最底部」）。注意必须在窗口更新之后取高度。
    const previousContentHeight = this._convContentHeight || 0;
    const nextContentHeight = (this._conversationWindow && this._conversationWindow.offsets[visibleRows.length]) || 0;
    const conversationHeightChanged = previousContentHeight > 0 && Math.abs(nextContentHeight - previousContentHeight) > 2;
    this._convContentHeight = nextContentHeight;
    const initialConversationAnchor = this._initialConversationAnchorPending
      && activeTab === 'conversation' && visibleRows.length > 0 && this._convPinned !== false;
    if (initialConversationAnchor) {
      // Mount the tail and its anchor in one render; onReady retries only to
      // cover runtimes that apply scroll-into-view before the list is laid out.
      conversationPatch.scrollTarget = 'conv-bottom';
      conversationPatch.scrollAnim = false;
      this._initialConversationAnchorPending = false;
      this._initialConversationAnchorApplied = true;
      this._initialConversationAnchorRecoveryPending = true;
    }
    const viewPatch = dataPatch(this.data, Object.assign({
      ...this.collaborationPatch(s, app),
      ...(contextVisible ? this.contextPanelPatch(s, app, trendAutoOverviewPatch) : {}),
      ...(contextVisible ? (trendAutoOverviewPatch || {}) : {}),
      ...(activeTab === 'fleet' ? this.fleetPanelPatch(s, app) : {}),
      // 编队数据变化后重画连线（setData 完成再画，拿得到刚渲染的节点）。
      navTitle: s.title || fallbackTitle,
      presetLabel: labels.presetHeaderName(presetsCatalog, presetId),
      sessionPresetVisible: presetVisible,
      sessionPresetName: presetName || uiText('选择模式'),
      running: s.running === true,
      processFollowTarget,
      lastRowKind: rows.length ? rows[rows.length - 1].kind : '',
      ...conversationPatch,
      ...this.turnNavigatorPatch(s.rows || rows),
      folds: processFolds,
      ...tracePatch,
      turnNavHistoryComplete: this.turnNavigatorHistoryComplete(s),
      turnNavHistoryPending: this.turnNavigatorHistoryPending(s),
      turnNavHistoryText: this.turnNavigatorHistoryText(s),
      hasMoreHistory: s.hasMoreHistory,
      historyPaging: s.historyPaging === true,
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
      statsLabel: turns != null || steps != null
        ? ((turns != null ? turns : '—') + uiText(' 轮 · ') + (steps != null ? steps : '—') + uiText(' 步'))
        : ''
      ,composerMetricsVisible: true
      ,composerRunMetric: composerRunMetric
      ,composerTokenMetric: composerTokenMetric
      ,composerCacheMetric: composerCacheMetric
      ,composerContextMetric: composerContextMetric
    }, qReset || {}));
    if (s && s.historyMergeId) this._historyMergeId = s.historyMergeId;
    const rowsChanged = Object.keys(viewPatch).some(key => key === 'rows' || key.indexOf('rows[') === 0);
    if (processFollowChanged || processFollowContentChanged) {
      this._processFollowVersion = (this._processFollowVersion || 0) + 1;
    }
    const dockChanged = ['running', 'question', 'approval', 'tasks', 'goal', 'composerMetricsVisible', 'sessionPresetVisible']
      .some(field => Object.keys(viewPatch).some(key => key === field || key.indexOf(field + '.') === 0 || key.indexOf(field + '[') === 0));
    const composerLabelsChanged = ['permissionLabel', 'permissionIcon', 'modelLabel', 'modelBadge', 'effortLabel']
      .some(field => Object.keys(viewPatch).some(key => key === field || key.indexOf(field + '.') === 0));
    const wasRunning = this.data.running;
    if (Object.keys(viewPatch).length) this.setData(viewPatch, () => {
      if (composerLabelsChanged) this.schedulePermissionChipFit();
      this.scheduleHistoryFormatting();
      this.measureConversationWindow();
      this.scheduleInitialConversationAnchorRecovery();
      if (this.data.tab === 'context') {
        this.scheduleContextFlow();
        this.scheduleContextTrendPane();
      }
      if (this.data.tab === 'fleet' && viewPatch.fleetPanel) {
        this.scheduleFleetLinksDraw();
        this.maybeAutoScanFleetComms();
      }
      // 运行刚开始：重置文字渐变相位；鲸尾图标为纯 CSS 动画，随节点挂载自动同相起跑。
      if (!wasRunning && this.data.running) this.setData({ statusFlowDelay: 0 });
      // 过程组用实测 scrollTop 跟随尾部，避免每个流式片段切换锚点造成闪跳。
      if (processFollowKey && (processFollowChanged || processFollowContentChanged)) {
        this.refreshProcessFollow(processFollowKey);
      }
    });
    else {
      this.scheduleHistoryFormatting();
      if (processFollowKey && (processFollowChanged || processFollowContentChanged)) {
        this.refreshProcessFollow(processFollowKey);
      }
    }
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
    // 没有任何可显示的行时必须给占位（加载中 / 空态）。原来这里用
    const hasRows = rows.length > 0;
    const historyLoading = s.historyPaging === true || (hs === 'requested' && !hasRows);
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
    if (!this._voiceHidden && !this._unloaded) {
      if (this._turnWarmup && this._turnWarmup.sessionId !== s.sessionId) this.stopTurnNavigatorWarmup(false);
      if (this._turnWarmup) this.pumpTurnNavigatorWarmup();
      else if (!this._turnWarmupStarted && s.hasMoreHistory && !s.cacheDisplay) this.startTurnNavigatorWarmup();
    }
    if (this._pendingTurnJump && (this._conversationRows || []).some(row => row.key === this._pendingTurnJump)) {
      const key = this._pendingTurnJump;
      this._pendingTurnJump = null;
      this.jumpToTurn({ currentTarget: { dataset: { key } } });
    }
    const cs = app.connection || 'disconnected';
    // 连接展示状态与首页/设置共用：断链红、故障橙、已连接绿，未连接灰。
    const connection = connectionView(app);
    if (cs !== this.data.connState || connection.connected !== this.data.connected) {
      this.setData({ connState: cs, connected: connection.connected });
      // 断线期间的图片加载会失败；重连后清掉失败标记再试一次。
      if (cs === 'connected') { this._thumbFailed = null; this.scheduleAttachmentThumbs(); }
    }
    this.syncQueueDock();

    if (this.data._titleDirty) {
      this.setData({ _titleDirty: false });

    }

    // 更早历史页到达后，若用户仍在顶部附近，继续预取下一页，保证继续上滑时已就绪。
    if (historyMerged && this.data.tab === 'conversation' && !this.data.historyPaging && this._convPinned === false) {
      const top = Number(this._lastScrollTop) || 0;
      if (top > 0 && top < 4000) this.maybePrefetchOlderHistory(top);
    }

    // 新内容到达时贴底；但用户正在触摸列表时不要抢滚动
    const touchingRecently = Date.now() - (this._lastTouchAt || 0) < 1000;
    const initialTailFollowActive = this._initialConversationAnchorPending
      || this._initialConversationAnchorApplied;
    if (!initialTailFollowActive && (sessionChanged || conversationTailChanged || conversationHeightChanged || justFinished)
      && this.data.tab === 'conversation' && this._convPinned !== false && !touchingRecently) {
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
    if (action === 'edit') {
      const item = this.data.queue.find((q) => q.id === id);
      if (!item) return;
      if (item.editable === false) return;
      // 编辑：取回草稿（对齐 iOS：draft 空则直用，否则换行拼接）并从队列移除
      const text = item.rawText || item.preview;
      const nextDraft = this.data.draft ? this.data.draft + '\n\n' + text : text;
      this.setComposerValue(nextDraft, { draft: nextDraft });
      this.syncCommandMenu(this.data.draft, store.sessionState);
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

  /** 队列 dock 只展示网关确认的队列项，避免重复维护本地待发副本。 */
  syncQueueDock() {
    // DSH 的队列项是 UserMessage：正文在 content[] block 中，而不是顶层字符串。
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
    if (JSON.stringify(q) !== JSON.stringify(this._lastQueue || [])) {
      this._lastQueue = q;
      this.setData({ queue: q, queueSending: q.some((item) => !!item.statusText) });
      this.updateDockInset();
    }
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
    this.closeFileMention();
    if (store.setTrajectoryActive) store.setTrajectoryActive(tab === 'trajectory');
    if (store.setContextActive) store.setContextActive(tab === 'context');
    if (store.setFleetActive) store.setFleetActive(tab === 'fleet');
    let tracePatch = {};
    if (tab === 'trajectory') { this._traceRows = store.sessionState.trajectory || []; tracePatch = dataPatch(this.data, this.trajectoryPatch()); }
    // 上下文与编队合并成一个滚动（对齐客户端侧栏 Context 面板）：两个 Tab 共享
    let contextPatch = {};
    if (tab === 'context') contextPatch = this.contextPanelPatch();
    let fleetPatch = {};
    if (tab === 'fleet') fleetPatch = this.fleetPanelPatch();
    // 离开对应 Tab 时清掉大对象，减少 page data 体积与内存占用（切回时按需重建）。
    const clearPatch = {};
    if (tab !== 'context') {
      clearPatch.contextPanel = null;
      clearPatch.contextModalOpen = false;
      clearPatch.contextBrowserPickerOpen = false;
      clearPatch.contextBrowserPickerTarget = '';
      clearPatch.contextFlowLinks = [];
    }
    if (tab !== 'fleet') clearPatch.fleetPanel = null;
    this.prioritizeInteraction();
    const hadKeyboard = this.data.kbHeight > 0 || this.data.composerFocused;
    this._collaborationRequest = null; this._collaborationRefresh = null;
    // 只挂载当前 Tab 的面板：离开后销毁对应节点树，避免隐藏面板保留大量
    if (tab === 'fleet') {
      this.measureFleetStage();
      // 首次切入时节点还没渲染，上面的实测会退回兜底值：渲染完成后再量一次。
      setTimeout(() => {
        if (this.data.tab !== 'fleet') return;
        this.measureFleetStage();
        this.scheduleFleetLinksDraw();
      }, 60);
    }
    this.setData({ tab, trajectoryMounted: tab === 'trajectory', contextMounted: tab === 'context', fleetMounted: tab === 'fleet', ...clearPatch, ...tracePatch, ...contextPatch, ...fleetPatch, collaborationOpen:false, collaborationPreview:null, collaborationBusy:false, kbHeight: 0, composerFocused: false, showJump: false,
      statsPopOpen: false, showContextSheet: false, commandMenu: null,
      attachSheetOpen: false, modelSheetOpen: false, effortSheetOpen: false,
      permissionSheet: [], modeSheet: [], ...this.layoutPatch({ kbHeight: 0 }) }, () => {
      if (tab === 'fleet') this.maybeAutoScanFleetComms();
      if (tab === 'conversation') {
        this.measureConversationViewport();
        this.scheduleInitialConversationAnchorRecovery();
      }
    });
    if (hadKeyboard && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    // 上下文面板独有的「流连线」只在上下文 Tab 运行；编队是独立面板。
    if (tab === 'context') {
      this.scheduleContextFlow();
      this.scheduleContextTrendPane();
    } else this.stopContextFlow();
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

  /** Match dsh-context: once a session reaches 200 retained requests, open its overview ribbon once. */
  contextTrendAutoOverviewPatch(session) {
    const sessionId = session && session.sessionId;
    const dashboard = session && session.contextDashboard;
    const requests = dashboard && dashboard.value && dashboard.value.requests;
    if (!sessionId || !Array.isArray(requests) || requests.length < CONTEXT_TREND_OVERVIEW_AUTO_STEPS
      || dashboard.loading === true || dashboard.unsupported === true || dashboard.error) return null;
    this._contextTrendOverviewAutoFired = this._contextTrendOverviewAutoFired || Object.create(null);
    if (this._contextTrendOverviewAutoFired[sessionId]) return null;
    this._contextTrendOverviewAutoFired[sessionId] = true;
    return {
      contextTrendOverview: true,
      contextTrendDna: false,
      contextTrendAdaptive: false,
      contextTrendVisibleRange: null
    };
  },

  /** 上下文面板派生：store 快照 → 纯函数视图模型（缓存原始 value 身份，避免每次 emit 重算趋势）。 */
  contextPanelPatch(session, app, trendOverrides) {
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
    const overrides = trendOverrides || {};
    const browserSeqValue = overrides.contextBrowserSeq !== undefined
      ? overrides.contextBrowserSeq : this.data.contextBrowserSeq;
    const browserSeq = browserSeqValue == null ? null : Number(browserSeqValue);
    const browserIsCurrent = overrides.contextBrowserIsCurrent !== undefined
      ? overrides.contextBrowserIsCurrent === true : this.data.contextBrowserIsCurrent === true;
    const expanded = Array.isArray(this.data.contextBrowserExpanded) ? this.data.contextBrowserExpanded : [];
    const expandedKey = expanded.join(',');
    const currentHighlight = this.data.contextCurrentHighlight || '';
    const commandFilter = this.data.contextCommandFilter || 'all';
    const commandExpandedId = this.data.contextCommandExpanded || '';
    const browserBase = this.data.contextBrowserBase === 'turn' ? 'turn' : 'step';
    const browserQuery = this.data.contextBrowserQuery || '';
    const browserKind = ['think', 'tools', 'answer'].includes(this.data.contextBrowserKind) ? this.data.contextBrowserKind : '';
    const browserTool = this.data.contextBrowserTool || '';
    const eventFilter = Array.isArray(this.data.contextEventFilter) ? this.data.contextEventFilter : null;
    const trendSeqValue = overrides.contextTrendSeq !== undefined
      ? overrides.contextTrendSeq : this.data.contextTrendSeq;
    const trendSeq = trendSeqValue == null ? null : Number(trendSeqValue);
    const trendGroupBy = overrides.contextTrendGroupBy || this.data.contextTrendGroupBy || 'step';
    const trendDisplayMode = (overrides.contextTrendDisplayMode || this.data.contextTrendDisplayMode) === 'delta' ? 'delta' : 'total';
    const trendActiveTurnValue = overrides.contextTrendActiveTurn !== undefined
      ? overrides.contextTrendActiveTurn : this.data.contextTrendActiveTurn;
    const trendActiveTurn = trendActiveTurnValue == null ? null : Number(trendActiveTurnValue);
    const trendDna = overrides.contextTrendDna !== undefined ? overrides.contextTrendDna === true : this.data.contextTrendDna === true;
    const trendOverview = overrides.contextTrendOverview !== undefined ? overrides.contextTrendOverview === true : this.data.contextTrendOverview === true;
    const trendAdaptive = overrides.contextTrendAdaptive !== undefined ? overrides.contextTrendAdaptive === true : this.data.contextTrendAdaptive === true;
    const trendShowDuration = overrides.contextTrendShowDuration !== undefined
      ? overrides.contextTrendShowDuration !== false : this.data.contextTrendShowDuration !== false;
    const trendVisibleRange = overrides.contextTrendVisibleRange !== undefined
      ? overrides.contextTrendVisibleRange : (this.data.contextTrendVisibleRange || null);
    const trendVisibleRangeKey = trendVisibleRange ? trendVisibleRange.from + ':' + trendVisibleRange.to : '';
    // 实时探针（拖动中的竖线/指标卡）：运行中每 2.5s 重建面板，探针坐标必须原样
    // 带回，否则手指还按在屏幕上，竖线先被刷新闪掉了。
    const trendHoverSeq = this.data.contextTrendHoverSeq == null ? null : Number(this.data.contextTrendHoverSeq);
    const currentTrend = this.data.contextPanel && this.data.contextPanel.trend;
    const trendHoverX = currentTrend && Number.isFinite(currentTrend.hoverX) ? currentTrend.hoverX : -1;
    const trendHoverLeft = currentTrend && Number.isFinite(currentTrend.hoverLeft) ? currentTrend.hoverLeft : -1;
    const trendTipLeft = currentTrend && Number.isFinite(currentTrend.tipLeft) ? currentTrend.tipLeft : -1;
    // 总览折线的可视宽：量到过就用实测值，否则模型自行退回 375pt 解析值。
    const trendPaneWidth = Number.isFinite(this._ctxTrendPaneWidthRpx) && this._ctxTrendPaneWidthRpx > 0
      ? this._ctxTrendPaneWidthRpx : null;
    const fileFilter = this.data.contextFileFilter || 'all';
    const fileSort = this.data.contextFileSort || 'count';
    const fileQuery = this.data.contextFileQuery || '';
    const fileExpandedPath = this.data.contextFileExpandedPath || '';
    const cache = this._contextPanelCache;
    if (cache && cache.dashboard === dashboard && cache.locale === locale
      && cache.connected === connected && cache.sessionId === sessionId
      && cache.fleetValue === fleetValue && cache.running === running
      && cache.contextPressure === contextPressure
      && cache.browserSeq === browserSeq && cache.browserIsCurrent === browserIsCurrent && cache.expandedKey === expandedKey
      && cache.currentHighlight === currentHighlight
      && cache.commandFilter === commandFilter && cache.commandExpandedId === commandExpandedId
      && cache.browserBase === browserBase && cache.browserQuery === browserQuery && cache.browserKind === browserKind
      && cache.browserTool === browserTool
      && cache.eventFilter === eventFilter
      && cache.fileFilter === fileFilter && cache.fileSort === fileSort
      && cache.fileQuery === fileQuery && cache.fileExpandedPath === fileExpandedPath
      && cache.trendSeq === trendSeq && cache.trendGroupBy === trendGroupBy
      && cache.trendDisplayMode === trendDisplayMode
      && cache.trendActiveTurn === trendActiveTurn
      && cache.trendDna === trendDna && cache.trendOverview === trendOverview
      && cache.trendAdaptive === trendAdaptive && cache.trendShowDuration === trendShowDuration
      && cache.trendVisibleRangeKey === trendVisibleRangeKey
      && cache.trendHoverSeq === trendHoverSeq && cache.trendHoverX === trendHoverX
      && cache.trendHoverLeft === trendHoverLeft && cache.trendTipLeft === trendTipLeft
      && cache.trendPaneWidth === trendPaneWidth) {
      return { contextPanel: this.modalPanel(cache.panel) };
    }
    const panel = contextView.buildPanel(dashboard, {
      t: uiText, connected: connected, hasSession: !!sessionId,
      running: running, fleet: fleetValue, contextPressure: contextPressure,
      browserSeq: browserSeq, browserCurrent: browserIsCurrent, expanded: expanded,
      browserBase: browserBase, browserQuery: browserQuery, browserKind: browserKind, browserTool: browserTool,
      currentHighlight: currentHighlight,
      commandFilter: commandFilter, commandExpandedId: commandExpandedId,
      trendSeq: trendSeq, trendGroupBy: trendGroupBy, trendDisplayMode: trendDisplayMode,
      trendActiveTurn: trendActiveTurn, trendDna: trendDna, trendOverview: trendOverview,
      trendAdaptive: trendAdaptive, trendShowDuration: trendShowDuration,
      trendVisibleRange: trendVisibleRange,
      trendPaneWidth: trendPaneWidth,
      trendHoverSeq: trendHoverSeq, trendHoverX: trendHoverX,
      trendHoverLeft: trendHoverLeft, trendTipLeft: trendTipLeft,
      eventFilter: eventFilter,
      fileFilter: fileFilter, fileSort: fileSort, fileQuery: fileQuery, fileExpandedPath: fileExpandedPath
    });
    this._contextPanelCache = {
      panel,
      dashboard, locale, connected, sessionId,
      fleetValue, running, contextPressure, currentHighlight, commandFilter, commandExpandedId, browserSeq, browserIsCurrent, expandedKey,
      browserBase, browserQuery, browserKind, browserTool,
      eventFilter, fileFilter, fileSort, fileQuery, fileExpandedPath,
      trendSeq, trendGroupBy, trendDisplayMode, trendActiveTurn, trendDna, trendOverview,
      trendAdaptive, trendShowDuration, trendVisibleRangeKey, trendPaneWidth,
      trendHoverSeq, trendHoverX, trendHoverLeft, trendTipLeft, panel
    };
    return { contextPanel: this.modalPanel(panel) };
  },

  /**
   * 弹窗只渲染「当前上下文」+「上下文浏览器」两张卡。当弹窗是唯一使用者
   * （上下文分段没挂载）时，trend 动辄几百 KB 也会被整份塞进 setData——
   * 每次点按钮都卡一下，触摸事件被丢，弹窗就像点不动、滚不动。
   * 缓存里始终留完整面板，切到上下文分段时立刻可用。
   */
  modalPanel(panel) {
    if (!panel || this.data.contextMounted === true || this.data.contextModalOpen !== true) return panel;
    // 只摘掉趋势图那两段（长会话占几百 KB，弹窗根本不渲染），
    // status/current/browser 等其余字段原样保留。
    const trimmed = Object.assign({}, panel);
    delete trimmed.trend;
    delete trimmed.trendDetail;
    return trimmed;
  },

  /**
   * 浏览器游标/折叠变化：立刻重建面板，不等 store emit。
   *
   * 游标变化同时回写到趋势图的选中项，两个模块始终指向同一请求
   * （dsh-context 的 live linkage 是双向的：hover 柱预览、离开回到自选）。
   */
  /** 基线切换：比前步 / 比前轮（dsh-context browser.tsx 的 base gran）。 */
  /** 命令执行卡：筛选 chips（全部/失败/慢/后台）。 */
  setContextCommandFilter(e) {
    const filter = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.filter : '';
    if (['all', 'failed', 'slow', 'background'].indexOf(filter) < 0 || filter === this.data.contextCommandFilter) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextCommandFilter: filter });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 命令行展开/收起（同一时刻只展开一条）。 */
  toggleContextCommand(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!key) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextCommandExpanded: this.data.contextCommandExpanded === key ? '' : key });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 复制命令原文。 */
  copyContextCommand(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    const commands = this.data.contextPanel && this.data.contextPanel.commands;
    const row = commands && Array.isArray(commands.rows) ? commands.rows.find(item => item.key === key) : null;
    if (!row) return;
    wx.setClipboardData({ data: row.commandText, success: () => wx.showToast({ title: uiText('已复制'), icon: 'success' }) });
  },

  /** 在上下文浏览器里定位该命令对应的 tool result。 */
  locateContextCommand(e) {
    const seq = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.seq : NaN);
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setContextBrowser(seq, ['tool'], false);
    this.jumpContextTo('ctxBrowserCard');
  },

  /** 当前上下文图例/组成条：点一个类别高亮（其余淡出），再点取消。 */
  contextCurrentTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!key) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextCurrentHighlight: this.data.contextCurrentHighlight === key ? '' : key });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  setContextBrowserBase(e) {
    const base = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.base : '';
    if (!['step', 'turn'].includes(base) || base === this.data.contextBrowserBase) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextBrowserBase: base });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 类别内过滤：输入即过滤当前展开类别的行（按标签/预览/工具/参数）。 */
  setContextBrowserQuery(e) {
    const value = e && e.detail && typeof e.detail.value === 'string' ? e.detail.value : '';
    if (value === this.data.contextBrowserQuery) return;
    this.setData({ contextBrowserQuery: value });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 助手类别按「思考 / 工具 / 回答」过滤；再点同一枚取消。 */
  setContextBrowserKind(e) {
    const kind = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.kind : '';
    if (!['think', 'tools', 'answer'].includes(kind)) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextBrowserKind: this.data.contextBrowserKind === kind ? '' : kind });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  setContextBrowser(seq, expanded, isCurrent) {
    const next = seq == null ? null : Number(seq);
    const patch = {
      contextBrowserSeq: next,
      contextBrowserIsCurrent: isCurrent === true,
      contextBrowserPickerOpen: false,
      contextBrowserPickerTarget: ''
    };
    // 只有真的变了才动趋势图，避免自己触发的那次回写形成往返。
    if ((this.data.contextTrendSeq == null ? null : Number(this.data.contextTrendSeq)) !== next) {
      patch.contextTrendSeq = next;
      this._contextPanelCache = null;
    }
    if (Array.isArray(expanded)) patch.contextBrowserExpanded = expanded;
    // 切步骤：关闭已展开类别并清空类别内过滤（dsh-context browser.tsx B:285-289）。
    if (next !== (this.data.contextBrowserSeq == null ? null : Number(this.data.contextBrowserSeq))) {
      patch.contextBrowserExpanded = [];
      patch.contextBrowserQuery = '';
      patch.contextBrowserTool = '';
    }
    patch.contextNodeDetail = null;
    this.setData(patch);
    this.setData(this.contextPanelPatch());
  },

  /** Commit the control and both linked views together so no stale mode can flash between setData calls. */
  rebuildContextTrendSelection(statePatch) {
    const patch = statePatch || {};
    const overrides = Object.assign({}, patch);
    this._contextPanelCache = null;
    this.contextPanelPatch(undefined, undefined, overrides);
    // 趋势↔浏览器联动要读 trend.selectedSeq，而弹窗裁剪后 setData 里没有 trend；
    // 完整面板始终留在缓存里，从这里取。
    const full = this._contextPanelCache && this._contextPanelCache.panel;
    const nextPanel = full || this.contextPanelPatch().contextPanel;
    const selected = nextPanel && nextPanel.trend ? nextPanel.trend.selectedSeq : null;
    const seq = selected !== null && selected !== undefined && Number.isFinite(Number(selected))
      ? Number(selected) : null;
    const linkedPatch = Object.assign({}, patch, {
      contextTrendSeq: seq,
      contextBrowserSeq: seq,
      contextBrowserIsCurrent: false
    });
    Object.assign(overrides, {
      contextTrendSeq: seq,
      contextBrowserSeq: seq,
      contextBrowserIsCurrent: false
    });
    this._contextPanelCache = null;
    const panelPatch = this.contextPanelPatch(undefined, undefined, overrides);
    this.setData(Object.assign({}, linkedPatch, panelPatch));
  },

  /** 去抖触发一次总览可视宽测量（面板重建/切 Tab/运行中刷新都走这里）。 */
  scheduleContextTrendPane() {
    if (this._ctxTrendPaneTimer) return;
    this._ctxTrendPaneTimer = setTimeout(() => {
      this._ctxTrendPaneTimer = null;
      this.measureContextTrendPane();
    }, 60);
  },

  /**
   * 总览带的真实可视宽（rpx）：折线的原生线段要在拉伸后的列心上定位，角度与
   * 段长都得按真实宽度算。测量不到时模型退回 375pt 解析值；量到后若与上次不同
   * 就重建面板（换机型/旋转屏幕时曲线才重新对齐）。
   */
  measureContextTrendPane() {
    if (this._unloaded || this.data.tab !== 'context' || !this.data.showContextPanel) return;
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    if (!trend || trend.overview !== true) return;
    if (!wx || typeof wx.createSelectorQuery !== 'function') return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.ctx-trend-chart-fit').boundingClientRect();
    query.exec((res) => {
      if (this._unloaded) return;
      const rect = res && res[0];
      if (!rect || !(rect.width > 0)) return;
      let windowWidth = 375;
      try {
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        if (info && Number(info.windowWidth) > 0) windowWidth = Number(info.windowWidth);
      } catch (_) {}
      const rpx = Math.round(rect.width * 750 / windowWidth);
      if (!(rpx > 0) || rpx === this._ctxTrendPaneWidthRpx) return;
      this._ctxTrendPaneWidthRpx = rpx;
      this._contextPanelCache = null;
      this.setData(this.contextPanelPatch());
    });
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
  /** 复制当前展开的上下文明细正文（web 详情段头右侧的复制按钮）。 */
  copyContextNodeText() {
    const detail = this.data.contextNodeDetail;
    if (!detail || typeof detail.text !== 'string' || !detail.text) return;
    wx.setClipboardData({ data: detail.text, success: () => {
      this.setData({ 'contextNodeDetail.copied': true });
      clearTimeout(this._contextCopyTimer);
      this._contextCopyTimer = setTimeout(() => {
        if (this.data && this.data.contextNodeDetail) this.setData({ 'contextNodeDetail.copied': false });
      }, 1200);
    } });
  },

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
      const lines = String(value.text).split('\n').length;
      const detail = { seq: seq, type: value.type || '', text: value.text,
        truncated: value.truncated === true, lineText: uiText('{n} 行', { n: lines }), copied: false };
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

  contextBrowserPickerToggle() {
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    if (!browser || !Array.isArray(browser.options) || !browser.options.length) return;
    const open = !this.data.contextBrowserPickerOpen;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({
      contextBrowserPickerOpen: open,
      contextBrowserPickerTarget: open
        ? (this.data.contextModalOpen ? 'ctxModalBrowserOption' : 'ctxBrowserOption') + browser.selectedIndex
        : ''
    });
  },

  closeContextBrowserPicker() {
    if (this.data.contextBrowserPickerOpen) {
      this.setData({ contextBrowserPickerOpen: false, contextBrowserPickerTarget: '' });
    }
  },

  /** Select a request from the custom browser dropdown. */
  contextBrowserPick(e) {
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
    const index = Number(dataset.index !== undefined ? dataset.index : (e && e.detail ? e.detail.value : NaN));
    if (!browser || !browser.options || !Number.isFinite(index) || index < 0 || index >= browser.options.length) return;
    const option = browser.options[index];
    if (!option || option.seq === undefined) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setContextBrowser(option.seq, undefined, option.isCurrent === true);
  },

  /** 展开/折叠某类（v2 折叠行）。 */
  /** 行点击分发：工具定义行就地展开参数表，其它行按需拉取正文。 */
  contextBrowserNodeTap(e) {
    const cat = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.cat : '';
    if (cat === 'tools') { this.toggleContextToolRow(e); return; }
    this.openContextNode(e);
  },

  /** 工具定义行：就地展开描述/参数表，不请求历史内容（header epoch 已在 wire 里）。 */
  toggleContextToolRow(e) {
    const name = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.name : '';
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    const row = browser && Array.isArray(browser.rows) ? browser.rows.find(item => item.key === 'tools') : null;
    const node = row && Array.isArray(row.nodes) ? row.nodes.find(item => item.name === name) : null;
    if (!node) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextBrowserTool: this.data.contextBrowserTool === name ? '' : name });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  toggleContextBrowserRow(e) {
    const browser = (this.data.contextPanel && this.data.contextPanel.browser) || null;
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!browser || !key) return;
    // 空类别不可展开（插件里计数为 0 的行整行置灰且点击无效）。
    const row = Array.isArray(browser.rows) ? browser.rows.find(item => item.key === key) : null;
    if (!row || row.disabled) return;
    const expanded = (Array.isArray(this.data.contextBrowserExpanded) ? this.data.contextBrowserExpanded.slice() : []);
    const index = expanded.indexOf(key);
    if (index >= 0) expanded.splice(index, 1); else expanded.push(key);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setContextBrowser(this.data.contextBrowserSeq, expanded, browser.isCurrent === true);
  },

  toggleContextDnaNode(e) {
    const seq = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.seq : NaN);
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    if (this.data.contextNodeDetail && this.data.contextNodeDetail.seq === seq) {
      this.setData({ contextNodeDetail: null, contextNodeLoadingSeq: null });
      return;
    }
    this.openContextNode(e);
  },

  /**
   * 选择趋势图中的请求。
   *
   * 同时驱动下方详情面板与「上下文浏览器」——后者切到同一请求，展开该请求
   * 实际拼接出来的内容（dsh-context 的 live linkage： hovering a bar previews
   * that step's assembled context in the Context browser）。再次点同一根柱子
   * 取消选中，浏览器回到「当前（下一次请求）」。
   */
  /** Step brief 行/chip → 浏览器定位该节点（dsh-context brief.ts onLocate）。 */
  contextBriefLocate(e) {
    const raw = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.seq : null;
    const seq = Number(raw);
    const cat = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.cat : '';
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    const expanded = ['user', 'inject', 'skill', 'assistant', 'tool', 'system', 'tools'].includes(cat) ? [cat] : [];
    this.setContextBrowser(seq, expanded, false);
    this.jumpContextTo('ctxBrowserCard');
  },

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
    this._ctxTrendScrollLeftPx = Math.max(0, Number(left) || 0);
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
    this.rebuildContextTrendSelection({
      contextTrendGroupBy: groupBy,
      contextTrendActiveTurn: null,
      contextTrendVisibleRange: null
    });
    if (this.data.contextTrendAdaptive) this.measureContextTrendViewport(this._contextTrendMeasureLeft || 0);
  },

  /** Adaptive rescales bars/curve against the visible window; overview is its mutually exclusive counterpart. */
  contextTrendAdaptive() {
    const current = this.data.contextPanel && this.data.contextPanel.trend
      ? this.data.contextPanel.trend.adaptive : this.data.contextTrendAdaptive === true;
    const next = !current;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.rebuildContextTrendSelection({
      contextTrendAdaptive: next,
      contextTrendOverview: false,
      contextTrendDna: false,
      contextTrendVisibleRange: next ? this.data.contextTrendVisibleRange : null
    });
    if (next) this.measureContextTrendViewport(this._contextTrendMeasureLeft || 0);
  },

  /** Show or hide the independent request-duration curve and its right axis. */
  contextTrendDuration() {
    const current = this.data.contextPanel && this.data.contextPanel.trend
      ? this.data.contextPanel.trend.showDuration : this.data.contextTrendShowDuration !== false;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.rebuildContextTrendSelection({ contextTrendShowDuration: !current });
  },

  /** 趋势显示完整上下文规模，或相邻请求之间的增长/回收量。 */
  contextTrendMode(e) {
    const mode = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.mode : '';
    if (mode !== 'total' && mode !== 'delta') return;
    if (mode === this.data.contextTrendDisplayMode) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    // DNA 画的是构成指纹，没有"逐类增减"可讲，切到增量时自动让位。
    this.rebuildContextTrendSelection({
      contextTrendDisplayMode: mode,
      contextTrendDna: mode === 'delta' ? false : this.data.contextTrendDna
    });
  },

  /** DNA 模式：每根柱子改成一条条带，按模型阅读顺序平铺（与总览互斥）。 */
  contextTrendDna() {
    const current = this.data.contextPanel && this.data.contextPanel.trend
      ? this.data.contextPanel.trend.dna : this.data.contextTrendDna === true;
    const next = !current;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.rebuildContextTrendSelection({
      contextTrendDna: next,
      contextTrendDisplayMode: next ? 'total' : this.data.contextTrendDisplayMode,
      contextTrendOverview: false, contextTrendAdaptive: false,
      contextTrendVisibleRange: null
    });
  },

  /** 总览：整段会话压进可视宽度的连续堆叠带（与 DNA 互斥）。 */
  contextTrendOverview() {
    const current = this.data.contextPanel && this.data.contextPanel.trend
      ? this.data.contextPanel.trend.overview : this.data.contextTrendOverview === true;
    const next = !current;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.rebuildContextTrendSelection({
      contextTrendOverview: next,
      contextTrendDna: false,
      contextTrendAdaptive: false,
      contextTrendVisibleRange: null
    });
  },

  /** Read screen coordinates from both standard TouchEvent fields and Mini Program's legacy x field. */
  contextTrendTouchX(e) {
    const touch = e && ((e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]));
    if (!touch) return null;
    const x = touch.clientX !== undefined ? touch.clientX
      : touch.pageX !== undefined ? touch.pageX : touch.x;
    return x !== null && x !== undefined && Number.isFinite(Number(x)) ? Number(x) : null;
  },

  /** Capture geometry once per gesture; touchmove then stays off selector-query/layout work. */
  contextTrendTouchStart(e) {
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    const x = this.contextTrendTouchX(e);
    if (!trend || !Array.isArray(trend.bars) || !trend.bars.length || x === null
      || typeof wx.createSelectorQuery !== 'function') return;
    const gesture = { mode: trend.overview ? 'overview' : 'bars', x, rect: null, seq: null };
    this._ctxTrendTouch = gesture;
    const selector = gesture.mode === 'overview' ? '.ctx-trend-chart-fit' : '.ctx-trend-scroll';
    const query = wx.createSelectorQuery().in(this);
    query.select(selector).boundingClientRect();
    query.exec((res) => {
      if (this._ctxTrendTouch !== gesture) return;
      const rect = res && res[0];
      if (!rect || !(rect.width > 0)) return;
      gesture.rect = rect;
      this.contextTrendTouchPreview(gesture);
    });
  },

  /** Scrub the nearest bar/ribbon record without turning the transient hover into a pin. */
  contextTrendTouchMove(e) {
    const gesture = this._ctxTrendTouch;
    const x = this.contextTrendTouchX(e);
    if (!gesture || x === null) return;
    gesture.x = x;
    if (gesture.rect) this.contextTrendTouchPreview(gesture);
  },

  contextTrendTouchPreview(gesture) {
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    if (!trend || !Array.isArray(trend.bars) || !trend.bars.length || !gesture.rect) return;
    let index;
    // 竖线位置：总览用百分比（带子拉伸到整宽），柱模式用 rpx（随内容一起滚动）。
    let hoverLeft = -1;
    let hoverX = -1;
    // 浮动指标卡锚点：px，相对 .ctx-trend-main 左缘，按可视宽钳制，第一根/最后一根
    // 柱子的卡片也不会伸出图表（对齐 dsh-context trendChart 的 syncTip 钳制）。
    let tipLeft = -1;
    if (gesture.mode === 'overview') {
      const ratio = Math.max(0, Math.min(1, (gesture.x - gesture.rect.left) / gesture.rect.width));
      index = Math.min(trend.bars.length - 1, Math.floor(ratio * trend.bars.length));
      hoverLeft = ((index + 0.5) / trend.bars.length) * 100;
      tipLeft = clampTrendTip(ratio * gesture.rect.width, gesture.rect.width);
    } else {
      let windowWidth = 375;
      try {
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        if (info && Number(info.windowWidth) > 0) windowWidth = Number(info.windowWidth);
      } catch (_) {}
      const pxToRpx = 750 / windowWidth;
      const scrollLeftPx = this._ctxTrendScrollLeftPx || 0;
      const xRpx = (gesture.x - gesture.rect.left + scrollLeftPx) * pxToRpx;
      const centerOffset = contextView.TREND_BAR_GAP + contextView.TREND_BAR_W / 2;
      index = Math.round((xRpx - centerOffset) / contextView.TREND_BAR_PITCH);
      index = Math.max(0, Math.min(trend.bars.length - 1, index));
      hoverX = index * contextView.TREND_BAR_PITCH + centerOffset;
      tipLeft = clampTrendTip(hoverX / pxToRpx - scrollLeftPx, gesture.rect.width);
    }
    const seq = trend.bars[index] && trend.bars[index].seq;
    if (!Number.isFinite(Number(seq))) return;
    if (gesture.seq === Number(seq)) return;
    gesture.seq = Number(seq);
    this.previewContextTrendRecord(Number(seq), hoverLeft, hoverX, tipLeft);
  },

  /** Update only the changing detail/browser branches, not the full trend's large WXML payload. */
  previewContextTrendRecord(seq, hoverLeft, hoverX, tipLeft) {
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    const dashboard = store.sessionState && store.sessionState.contextDashboard;
    const value = dashboard && dashboard.value;
    if (!trend || !value || this.data.contextTrendHoverSeq === seq) return;
    const detail = contextView.deriveTrendSelection(value, seq, uiText, { delta: trend.displayMode === 'delta' });
    const browser = contextView.deriveBrowser(value, uiText, {
      seq, current: false,
      expanded: this.data.contextBrowserExpanded,
      dna: trend.dna,
      base: this.data.contextBrowserBase,
      query: this.data.contextBrowserQuery,
      kind: this.data.contextBrowserKind,
      toolName: this.data.contextBrowserTool
    });
    this.setData({
      contextTrendHoverSeq: seq,
      'contextPanel.trend.hoverSeq': seq,
      'contextPanel.trend.hoverLeft': hoverLeft,
      'contextPanel.trend.hoverX': hoverX,
      'contextPanel.trend.tipLeft': tipLeft,
      'contextPanel.trendDetail': detail,
      'contextPanel.browser': browser
    });
  },

  /** Restore persistent pin/picker state after the finger leaves the chart. */
  contextTrendTouchEnd() {
    this._ctxTrendTouch = null;
    if (this.data.contextTrendHoverSeq == null) return;
    const trend = this.data.contextPanel && this.data.contextPanel.trend;
    const dashboard = store.sessionState && store.sessionState.contextDashboard;
    const value = dashboard && dashboard.value;
    if (!trend || !value) {
      this.setData({
        contextTrendHoverSeq: null,
        'contextPanel.trend.hoverLeft': -1,
        'contextPanel.trend.hoverX': -1,
        'contextPanel.trend.tipLeft': -1
      });
      return;
    }
    const pinnedSeq = trend.selectedSeq;
    const detail = contextView.deriveTrendSelection(value, pinnedSeq, uiText, { delta: trend.displayMode === 'delta' });
    const browserSeq = this.data.contextBrowserIsCurrent === true ? null
      : (this.data.contextBrowserSeq == null ? trend.selectedSeq : Number(this.data.contextBrowserSeq));
    const browser = contextView.deriveBrowser(value, uiText, {
      seq: browserSeq, current: this.data.contextBrowserIsCurrent === true,
      expanded: this.data.contextBrowserExpanded,
      dna: trend.dna,
      base: this.data.contextBrowserBase,
      query: this.data.contextBrowserQuery,
      kind: this.data.contextBrowserKind,
      toolName: this.data.contextBrowserTool
    });
    this.setData({
      contextTrendHoverSeq: null,
      'contextPanel.trend.hoverSeq': null,
      'contextPanel.trend.hoverLeft': -1,
      'contextPanel.trend.hoverX': -1,
      'contextPanel.trend.tipLeft': -1,
      'contextPanel.trendDetail': detail,
      'contextPanel.browser': browser
    });
  },

  /** 打开跨会话 Context Insights 页（插件里是侧栏一级面板）。 */
  openContextInsights() {
    const sessionId = store.sessionState && store.sessionState.sessionId;
    if (!sessionId) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    wx.navigateTo({ url: '/pages/insights/insights?sessionId=' + encodeURIComponent(String(sessionId)) });
  },

  /** 打开 /context 等价的居中弹窗（插件里来自斜杠命令；小程序放工具栏入口）。 */
  openContextModal() {
    if (!this.data.contextPanel || this.data.contextPanel.status === 'loading') return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextModalOpen: true, contextBrowserPickerOpen: false, contextBrowserPickerTarget: '', showJump: false, ctxModalDragStyle: '' });
  },

  /**
   * 对话回合页脚入口（对齐 dsh-context 的 reply-row jump / contextJump.tsx，
   * 并内嵌 Agent 网络，对齐客户端侧栏 Context 面板的整合形态）：
   * 打开「上下文 + 编队」整合视图，把这条助手消息的请求 pin 在浏览器里。
   * 拿不到 seq 或上下文 Tab 被偏好关闭时退化为打开弹窗。
   * 真实数据里助手消息 seq 与请求 seq 一一对应（保留窗口内 200/200 精确命中）。
   */
  contextJumpFromChat(e) {
    const raw = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.seq : null;
    const seq = Number(raw);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    if (this.data.showContextPanel === false || !Number.isSafeInteger(seq) || seq < 0) {
      this.openContextModalFromChat();
      return;
    }
    if (this.data.tab !== 'context' && this.data.tab !== 'fleet') {
      this.switchTab({ currentTarget: { dataset: { tab: 'context' } } });
    }
    // 合并面板里的编队一节需要数据：从没拉过就补拉一次。
    if (store.refreshContextFleet && !(store.sessionState.contextFleet && store.sessionState.contextFleet.value)) {
      store.refreshContextFleet(true);
    }
    this.setContextBrowser(seq, this.data.contextBrowserExpanded);
    // 对话 Tab 上面板可能是旧的：强制拉一次，数据到位后选择自愈到目标请求。
    if (store.refreshContextDashboard) store.refreshContextDashboard(true);
    this.jumpContextTo('ctxBrowserCard');
  },

  /**
   * 打开同一个上下文弹窗。对话 Tab 不派生上下文面板、切走时还会清空，
   * 所以这里先补一个可安全渲染的面板再强制拉取，避免空/错误面板闪帧。
   */
  openContextModalFromChat() {
    haptics.tick ? haptics.tick() : haptics.vibrate();
    const dashboard = store.sessionState && store.sessionState.contextDashboard;
    const reusable = this.data.contextPanel && this.data.contextPanel.status === 'ready'
      && dashboard && dashboard.value;
    if (reusable) {
      this.setData({ contextModalOpen: true, contextBrowserPickerOpen: false, contextBrowserPickerTarget: '', showJump: false });
    } else {
      this._contextPanelCache = null;
      const fallback = contextView.buildPanel(null, {
        t: uiText,
        connected: !!(store.state && store.state.connection === 'connected'),
        hasSession: !!(store.sessionState && store.sessionState.sessionId)
      });
      this.setData({ contextModalOpen: true, contextBrowserPickerOpen: false, contextBrowserPickerTarget: '', showJump: false, contextPanel: fallback });
    }
    if (store.refreshContextDashboard) store.refreshContextDashboard(true);
  },

  closeContextModal() {
    this.clearContextModalDrag();
    if (!this.data.contextModalOpen) return;
    this.setData({ contextModalOpen: false, contextBrowserPickerOpen: false, contextBrowserPickerTarget: '', ctxModalDragStyle: '' });
  },

  clearContextModalDrag() {
    if (this._ctxModalCloseTimer) clearTimeout(this._ctxModalCloseTimer);
    this._ctxModalCloseTimer = null;
    this._ctxModalDrag = null;
    this._ctxModalDragOffset = 0;
  },

  // 抽屉顶端的拖动条：只接管 44rpx 抓取区的手势（正文仍归 scroll-view）；
  // 向下跟手，松手超过 96px 滑出关闭，否则回弹。
  onContextModalGrabStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (this._ctxModalCloseTimer) { clearTimeout(this._ctxModalCloseTimer); this._ctxModalCloseTimer = null; }
    this._ctxModalDrag = { startY: touch.clientY, offset: 0 };
  },

  onContextModalGrabMove(e) {
    const drag = this._ctxModalDrag, touch = e.touches && e.touches[0];
    if (!drag || !touch) return;
    // 只吃向下：弹窗已是 90vh，往上没有可展开的空间。
    const offset = Math.max(0, Math.round(touch.clientY - drag.startY));
    drag.offset = offset;
    // 每帧 setData 太贵：4px 以内的抖动丢掉（回弹到 0 时必须放行）。
    if (offset !== 0 && Math.abs(offset - (this._ctxModalDragOffset || 0)) < 4) return;
    this._ctxModalDragOffset = offset;
    this.setData({ ctxModalDragStyle: offset > 0 ? 'transform:translateY(' + offset + 'px);transition:none;' : '' });
  },

  onContextModalGrabEnd() {
    const drag = this._ctxModalDrag;
    this._ctxModalDrag = null;
    if (!drag) return;
    const offset = drag.offset || 0;
    this._ctxModalDragOffset = 0;
    if (offset >= 96) {
      // 先顺着手势滑出去再卸载节点，避免整块“啪”地消失。
      this.setData({ ctxModalDragStyle: 'transform:translateY(110%);transition:transform .18s ease;' });
      if (this._ctxModalCloseTimer) clearTimeout(this._ctxModalCloseTimer);
      this._ctxModalCloseTimer = setTimeout(() => {
        this._ctxModalCloseTimer = null;
        this.setData({ ctxModalDragStyle: '' });
        this.closeContextModal();
      }, 180);
      return;
    }
    this.setData({ ctxModalDragStyle: '' });
  },

  /** 弹窗里的类别行：关闭弹窗、回到页面浏览器卡片并展开该类别（避免两处重复渲染大列表）。 */
  contextModalCategoryTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!key) return;
    const browser = this.data.contextPanel && this.data.contextPanel.browser;
    const row = browser && Array.isArray(browser.rows) ? browser.rows.find(item => item.key === key) : null;
    if (!row || row.disabled) return;
    this.setData({ contextModalOpen: false });
    this.setContextBrowser(this.data.contextBrowserSeq, [key], this.data.contextBrowserIsCurrent);
    this.jumpContextTo('ctxBrowserCard');
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
    const next = this.data.contextFileExpandedPath === path ? '' : path;
    this.setData({ contextFileExpandedPath: next });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 事件筛选 chips：默认全选；点一枚只留它；再点其它追加；只剩一枚时点它恢复全选（dsh-context events.tsx）。 */
  setContextEventFilter(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.filter : '';
    const kinds = ['inject', 'compaction', 'prune', 'model', 'mode'];
    if (!kinds.includes(key)) return;
    const current = Array.isArray(this.data.contextEventFilter) ? this.data.contextEventFilter.slice() : kinds.slice();
    let next;
    if (current.length >= kinds.length) next = [key];
    else if (current.includes(key)) {
      next = current.filter(item => item !== key);
      if (!next.length) next = kinds.slice();
    } else next = kinds.filter(item => current.includes(item) || item === key);
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextEventFilter: next });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  setContextFileFilter(e) {
    const filter = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.filter : '';
    if (['all', 'read', 'write', 'search', 'image'].indexOf(filter) < 0 || filter === this.data.contextFileFilter) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextFileFilter: filter, contextFileExpandedPath: '' });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  /** 文件操作行 → 上下文浏览器里定位该步骤并展开工具结果（插件 locateStepOf 行为）。 */
  contextFileOpTap(e) {
    const seq = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.seq : NaN);
    if (!Number.isSafeInteger(seq) || seq < 0) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setContextBrowser(seq, ['tool'], false);
    this.jumpContextTo('ctxBrowserCard');
  },

  setContextFileSort(e) {
    const sort = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.sort : '';
    if (['count', 'lines', 'latest', 'path', 'name'].indexOf(sort) < 0 || sort === this.data.contextFileSort) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ contextFileSort: sort });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  setContextFileQuery(e) {
    const query = e && e.detail ? String(e.detail.value || '') : '';
    if (query === this.data.contextFileQuery) return;
    this.setData({ contextFileQuery: query, contextFileExpandedPath: '' });
    this._contextPanelCache = null;
    this.setData(this.contextPanelPatch());
  },

  jumpContextTo(target) {
    if (!target) return;
    this.setData({ contextScrollTarget: '' }, () => {
      this.setData({ contextScrollTarget: target });
    });
  },

  /** 统计卡的 `?`（web 用 hover 气泡；触屏改为模态说明）。 */
  contextStatTip(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.tip : '';
    const tips = {
      humanInputs: uiText('当前会话中的用户消息与问题回答次数。'),
      subCost: uiText('全部层级的子 Agent 会话各自累计费用（同口径估算）的合计，不含当前 Agent 自身。'),
      cacheHit: uiText('整个会话累计的缓存读取占计费输入的比例。'),
      tps: uiText('输出速度（TPS）：累计解码输出 tokens ÷ 累计解码时长，与 DeepSeek Harness 会话统计同口径。')
    };
    if (!tips[key]) return;
    wx.showModal({ title: uiText('上下文统计'), content: tips[key], showCancel: false, confirmText: uiText('知道了') });
  },

  contextStatsJump(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    // 会话节点第二行：技能加载 → 浏览器技能注入；模型回复 → 浏览器回答。
    if (key === 'skills' || key === 'answers') {
      const category = key === 'skills' ? 'skill' : 'assistant';
      this.setContextBrowser(this.data.contextBrowserSeq, [category], this.data.contextBrowserIsCurrent);
      this.jumpContextTo('ctxBrowserCard');
      return;
    }
    if (key === 'userInputs') {
      const trend = this.data.contextPanel && this.data.contextPanel.trend;
      const bars = trend && Array.isArray(trend.bars) ? trend.bars : [];
      const latest = bars.length ? bars[bars.length - 1].seq : null;
      this.setContextBrowser(latest, undefined, latest == null);
      this.jumpContextTo('ctxBrowserCard');
      return;
    }
    const fileFilter = { reads: 'read', writes: 'write', searches: 'search', images: 'image' }[key];
    if (fileFilter) {
      this.setContextFileFilter({ currentTarget: { dataset: { filter: fileFilter } } });
      this.jumpContextTo('ctxFileCard');
      return;
    }
  },

  openContextFleet() {
    if (!this.data.showFleetPanel) return;
    this.switchTab({ currentTarget: { dataset: { tab: 'fleet' } } });
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
    const stageWidth = this.data.fleetStageWidth || 343;
    const selectedId = this.data.fleetSelectedId || '';
    const memberQuery = this.data.fleetMemberQuery || '';
    const memberStatus = this.data.fleetMemberStatus || 'all';
    const memberSort = this.data.fleetMemberSort || 'derived';
    const commsFilter = this.data.fleetCommsFilter || '';
    const commsValue = this._fleetComms || null;
    const commsStale = !!(commsValue && this._fleetCommsAsOfSeq !== (fleet && fleet.asOfSeq));
    const cache = this._fleetPanelCache;
    if (cache && cache.fleet === fleet && cache.locale === locale
      && cache.connected === connected && cache.sessionId === sessionId
      && cache.running === running && cache.stageWidth === stageWidth && cache.selectedId === selectedId
      && cache.memberQuery === memberQuery && cache.memberStatus === memberStatus && cache.memberSort === memberSort
      && cache.taskQuery === this.data.fleetTaskQuery && cache.taskStatus === this.data.fleetTaskStatus
      && cache.commsFilter === commsFilter && cache.commsValue === commsValue && cache.commsStale === commsStale) {
      return { fleetPanel: cache.panel };
    }
    const panel = contextView.buildFleetPanel(fleet, {
      t: uiText, connected: connected, hasSession: !!sessionId, running: running,
      stageWidth: stageWidth, selectedId: selectedId,
      memberQuery: memberQuery, memberStatus: memberStatus, memberSort: memberSort,
      commsValue: commsValue, commsFilter: commsFilter, commsStale: commsStale,
      taskQuery: this.data.fleetTaskQuery, taskStatus: this.data.fleetTaskStatus,
      // 网关投影缺血缘时，用会话列表在客户端补齐家族成员。
      familySessions: (a && a.sessions) || [], sessionId: sessionId
    });
    this._fleetPanelCache = { fleet, locale, connected, sessionId, running, stageWidth, selectedId, memberQuery, memberStatus, memberSort, commsFilter, commsValue, commsStale, taskQuery: this.data.fleetTaskQuery, taskStatus: this.data.fleetTaskStatus, panel };
    return { fleetPanel: panel };
  },

  /* 连线：优先离屏画布导出图片（<image> 会随内容滚动）；导出不可用时
     直接画在页面内的 canvas 元素上，保证一定有连线。 */
  fleetLinksPaint(ctx, ratio, width, height) {
    const graph = this.data.fleetPanel && this.data.fleetPanel.graph;
    const links = (graph && graph.links) || [];
    // Draw directly in backing-store pixels. Scaling the same page canvas on
    // every refresh compounds its transform and eventually pushes links offscreen.
    ctx.clearRect(0, 0, width * ratio, height * ratio);
    ctx.lineCap = 'round';
    links.forEach((link) => {
      const p = link && link.p;
      if (!p || p.length < 8) return;
      ctx.beginPath();
      ctx.moveTo(p[0] * ratio, p[1] * ratio);
      ctx.bezierCurveTo(p[2] * ratio, p[3] * ratio, p[4] * ratio, p[5] * ratio, p[6] * ratio, p[7] * ratio);
      ctx.strokeStyle = link.color || '#8a93a3';
      ctx.lineWidth = (link.live ? 2 : 1.5) * ratio;
      ctx.globalAlpha = link.live ? 0.85 : 0.45;
      ctx.setLineDash(link.live ? [2 * ratio, 7 * ratio] : []);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  },

  drawFleetLinks() {
    const panel = this.data.fleetPanel;
    const graph = panel && panel.graph;
    const token = this._fleetLinksToken = (this._fleetLinksToken || 0) + 1;
    if (!graph || !graph.links || !graph.links.length) {
      if (this.data.fleetLinksSrc) this.setData({ fleetLinksSrc: '' });
      return;
    }
    let ratio = 2;
    try {
      const info = wx.getWindowInfo();
      if (info && info.pixelRatio > 0) ratio = info.pixelRatio;
    } catch (_) { /* 默认 2x */ }
    const width = Math.max(1, Math.round(graph.width));
    const height = Math.max(1, Math.round(graph.height));
    const previous = this.data.fleetLinksSrc;
    const render = () => {
      if (!this.data || this._fleetLinksToken !== token) return;
      const offscreen = typeof wx.createOffscreenCanvas === 'function' && typeof wx.canvasToTempFilePath === 'function';
      if (offscreen) {
        let canvas = null;
        try { canvas = wx.createOffscreenCanvas({ type: '2d', width: width * ratio, height: height * ratio }); }
        catch (_) { canvas = null; }
        const ctx = canvas && canvas.getContext('2d');
        if (ctx) {
          this.fleetLinksPaint(ctx, ratio, width, height);
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0, y: 0, width: width * ratio, height: height * ratio,
            destWidth: width * ratio, destHeight: height * ratio,
            success: (res) => {
              if (!this.data || this._fleetLinksToken !== token || !res.tempFilePath) return;
              this.setData({ fleetLinksSrc: res.tempFilePath });
              if (previous && previous !== res.tempFilePath) {
                try { wx.getFileSystemManager().unlink({ filePath: previous, fail: () => {} }); } catch (_) { /* 忽略 */ }
              }
            },
            fail: () => { if (this.data && this._fleetLinksToken === token) this.drawFleetLinksOnCanvas(ratio, width, height, token); }
          });
          return;
        }
      }
      this.drawFleetLinksOnCanvas(ratio, width, height, token);
    };
    // The image branch hides the fallback canvas. Unmount it before drawing so
    // export failures always have a real canvas element to fall back to.
    if (previous) this.setData({ fleetLinksSrc: '' }, () => {
      try { wx.getFileSystemManager().unlink({ filePath: previous, fail: () => {} }); } catch (_) { /* 忽略 */ }
      render();
    });
    else render();
  },

  /* 导出图片不可用：直接画到页面里的 canvas 元素。 */
  drawFleetLinksOnCanvas(ratio, width, height, token) {
    if (typeof this.createSelectorQuery !== 'function') return;
    const query = this.createSelectorQuery();
    query.select('#fleetLinks').fields({ node: true, size: true }).exec((res) => {
      if (token !== undefined && (!this.data || this._fleetLinksToken !== token)) return;
      const canvas = res && res[0] && res[0].node;
      if (!canvas) return;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      this.fleetLinksPaint(ctx, ratio, width, height);
    });
  },

  /* 面板变化后重画连线（下一 tick 取节点）。 */
  scheduleFleetLinksDraw() {
    if (this._fleetLinksTimer) clearTimeout(this._fleetLinksTimer);
    this._fleetLinksTimer = setTimeout(() => {
      this._fleetLinksTimer = null;
      if (this.data.tab !== 'fleet') return;
      this.drawFleetLinks();
    }, 40);
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

  /** 网络图节点：点卡 = 选中/取消（插件 hover 血统高亮的触屏替代）。 */
  fleetSelectAgent(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetSelectedId: this.data.fleetSelectedId === id ? '' : id });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  /** 网络图节点右上角「→」：打开该 Agent 的会话并切到上下文分段。 */
  fleetOpenAgent(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) return;
    this.openFleetAgent({ currentTarget: { dataset: { id: id } } });
  },

  /** 展开全部 / 收起（舞台固定 1120rpx，超出时滚动）。 */
  fleetToggleAll() {
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetAllOpen: !this.data.fleetAllOpen });
  },

  /** 通讯面板：按需扫描当前家族的会话日志（宿主 context-comms）。 */
  scanFleetComms() {
    if (this.data.fleetCommsState === 'scanning') return;
    const panel = this.data.fleetPanel;
    const cards = panel && Array.isArray(panel.agents) ? panel.agents : [];
    const parentAtDepth = [];
    const refs = cards.filter(card => card && card.sessionId).slice(0, 12).map(card => {
      const depth = Math.max(0, Number(card.depth) || 0);
      const inferredParent = depth > 0 ? parentAtDepth[depth - 1] || '' : '';
      parentAtDepth[depth] = card.sessionId;
      parentAtDepth.length = depth + 1;
      const isSubagent = card.origin === 'subagent';
      const parentSessionId = isSubagent ? (card.parentSessionId || inferredParent) : '';
      return {
        id: card.sessionId,
        ...(parentSessionId ? {
          parentSessionId,
          mode: card.mode === 'one-shot' || card.mode === 'continuable' ? card.mode : 'unknown',
        } : {}),
      };
    });
    const sessionIds = refs.map(ref => ref.id);
    if (!sessionIds.length) return;
    const commsMembers = panel && Array.isArray(panel.commsMembers) ? panel.commsMembers : [];
    const requestSessionId = (store.sessionState && store.sessionState.sessionId) || this._renderSessionId || '';
    const requestAsOfSeq = panel && panel.asOfSeq;
    const requestGeneration = (this._fleetCommsGeneration || 0) + 1;
    this._fleetCommsGeneration = requestGeneration;
    const client = store.client;
    if (!client || typeof client.requestContextComms !== 'function') {
      this._fleetAutoScanInFlight = false;
      wx.showToast({ title: uiText('需升级网关以显示通讯记录'), icon: 'none' });
      return;
    }
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetCommsState: 'scanning' });
    client.requestContextComms(sessionIds, refs, commsMembers).then((frame) => {
      if (!this.data || this.data.fleetCommsState !== 'scanning'
        || this._fleetCommsGeneration !== requestGeneration
        || !store.sessionState || store.sessionState.sessionId !== requestSessionId) return;
      const value = frame && frame.value && typeof frame.value === 'object' ? frame.value : null;
      if (!value) throw new Error('bad frame');
      this._fleetComms = value;
      this._fleetCommsAsOfSeq = requestAsOfSeq;
      this._fleetPanelCache = null;
      this._fleetAutoScanInFlight = false;
      this.setData({ fleetCommsState: 'ready', fleetCommsFilter: '' });
      this.setData(this.fleetPanelPatch());
    }).catch(() => {
      if (!this.data || this._fleetCommsGeneration !== requestGeneration
        || !store.sessionState || store.sessionState.sessionId !== requestSessionId) return;
      this._fleetAutoScanInFlight = false;
      this.setData({ fleetCommsState: 'error' });
      wx.showToast({ title: uiText('扫描失败，请重试'), icon: 'none' });
    });
  },

  /* 多 Agent 时自动扫描通讯记录。 */
  maybeAutoScanFleetComms() {
    const state = this.data.fleetCommsState;
    // 失败后允许冷却重试：一次失败（如网关刚重启）不该让卡片永久空着。
    if (state === 'error') {
      if (Date.now() - (this._fleetCommsRetryAt || 0) < 10000) return;
      this._fleetCommsRetryAt = Date.now();
      this.setData({ fleetCommsState: 'idle' });
    } else if (state !== 'idle') return;
    const panel = this.data.fleetPanel;
    const agents = panel && Array.isArray(panel.agents) ? panel.agents : [];
    if (agents.length < 2 || panel.comms && panel.comms.solo) return;
    const scanKey = ((store.sessionState && store.sessionState.sessionId) || '') + ':' + String(panel.asOfSeq);
    if (this._fleetAutoScanFor === scanKey && this._fleetAutoScanInFlight) return;
    this._fleetAutoScanFor = scanKey;
    this._fleetAutoScanInFlight = true;
    this.scanFleetComms();
  },

  setFleetCommsFilter(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : '';
    if (id === this.data.fleetCommsFilter) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetCommsFilter: id || '' });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  setFleetMemberQuery(e) {
    const value = e && e.detail && typeof e.detail.value === 'string' ? e.detail.value : '';
    if (value === this.data.fleetMemberQuery) return;
    this.setData({ fleetMemberQuery: value });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  setFleetMemberStatus(e) {
    const status = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.status : '';
    if (['all', 'running', 'done', 'idle'].indexOf(status) < 0 || status === this.data.fleetMemberStatus) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetMemberStatus: status });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  setFleetTaskQuery(e) {
    const value = (e && e.detail && e.detail.value) || '';
    if (value === this.data.fleetTaskQuery) return;
    this.setData({ fleetTaskQuery: value });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  setFleetTaskStatus(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.status : '';
    if (id === this.data.fleetTaskStatus) return;
    this.setData({ fleetTaskStatus: id });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  setFleetMemberSort(e) {
    const datasetSort = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.sort : '';
    const sort = datasetSort;
    if (['derived', 'context', 'duration', 'steps'].indexOf(sort) < 0) return;
    if (sort === this.data.fleetMemberSort) {
      this.setData({ fleetMemberSortOpen: false });
      return;
    }
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetMemberSort: sort, fleetMemberSortOpen: false });
    this._fleetPanelCache = null;
    this.setData(this.fleetPanelPatch());
  },

  openFleetMemberSort() {
    if (this.data.fleetMemberSortOpen) {
      this.setData({ fleetMemberSortOpen: false });
      return;
    }
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ fleetMemberSortOpen: true });
  },

  closeFleetMemberSort() {
    if (this.data.fleetMemberSortOpen) this.setData({ fleetMemberSortOpen: false });
  },

  fleetOpenMember(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : '';
    if (!id) return;
    this.openFleetAgent({ currentTarget: { dataset: { id: id } } });
  },

  /** 舞台宽度（px）：卡片左右 padding 各 8px；用于网络图 tidy-tree 布局。 */
  /**
   * 量取编队舞台的真实可用宽度。
   * 之前按 windowWidth - 32 估算，漏算了面板内边距（28rpx×2）+ 卡片内边距（16rpx×2）
   * + 舞台边框，宽度多出约 17px，最右侧节点的箭头/角标就被裁掉了。
   */
  measureFleetStage() {
    let fallback = 343;
    let pxPerRpx = 0.5;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      if (info && Number.isFinite(info.windowWidth)) {
        pxPerRpx = info.windowWidth / 750;
        // 兜底：面板 28rpx×2 + 卡片 16rpx×2 + 边框，左右共约 90rpx
        fallback = Math.max(240, Math.round(info.windowWidth - 90 * pxPerRpx));
      }
    } catch (_) { /* 保持兜底宽度 */ }
    const apply = (width) => {
      const next = Math.max(240, Math.round(width));
      if (Math.abs(next - (this.data.fleetStageWidth || 0)) < 2) return;
      this.setData({ fleetStageWidth: next });
      this._fleetPanelCache = null;
    };
    if (typeof wx.createSelectorQuery !== 'function') { apply(fallback); return; }
    const query = wx.createSelectorQuery().in(this);
    query.select('#fleetGraphCard').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !(rect.width > 0)) { apply(fallback); return; }
      // 卡片左右内边距 16rpx、舞台边框 1rpx×2 都要扣掉
      apply(rect.width - (16 * 2 + 2) * pxPerRpx);
    });
  },

  onPanelTouchStart(e) {
    if (this.data.tab === 'conversation') this.onConvTouch();
    const touch = e.touches && e.touches.length === 1 && e.touches[0];
    this._userScrollDirection = '';
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
    if (gesture.tab === 'conversation' && gesture.axis === 'vertical') {
      // Keep following paused for the whole vertical gesture, whichever way it travels.
      this._lastConversationGestureAt = this._lastTouchAt = Date.now();
      this._initialConversationAnchorPending = false;
      this._followPausedByUser = true;
      this._convPinned = false;
      this._initialConversationAnchorApplied = false;
      this._userScrollDirection = dy < 0 ? 'towardBottom' : 'towardTop';
      // scroll-into-view stays selected after it fires; clear it when the reader
      // takes over so a live update cannot keep snapping the viewport to the tail.
      if (this.data.scrollTarget) this.setData({ scrollTarget: '' });
    }
  },

  onPanelTouchEnd(e) {
    const gesture = this._panelGesture;
    this._panelGesture = null;
    if (gesture && gesture.tab === 'conversation' && gesture.axis === 'vertical') {
      this._lastConversationGestureAt = Date.now();
    }
    const touch = e.changedTouches && e.changedTouches[0];
    if (gesture && gesture.tab === 'conversation' && this._bottomAnchorDeferred) {
      this._bottomAnchorDeferred = false;
      if (this._convPinned !== false && !this._followPausedByUser) this.refreshBottomAnchor();
    }
    if (gesture && gesture.tab === 'conversation' && !gesture.axis
      && this._convPinned !== false && !this._followPausedByUser) this.refreshBottomAnchor();
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

  onPanelTouchCancel() { this._panelGesture = null; this._bottomAnchorDeferred = false; },

  /** 键盘高度：手动把输入条抬到键盘上方（adjust-position 关闭，避免整页顶起） */
  onKeyboardHeight(e) {
    const h = this.data.tab === 'conversation' ? ((e.detail && e.detail.height) || 0) : 0;
    // 高度与布局一次 setData 写完：键盘弹起/收起会连发多次事件，分开写等于把整页布局
    if (h !== this.data.kbHeight) this.setData(Object.assign({ kbHeight: h }, this.layoutPatch({ kbHeight: h })), () => this.measureConversationViewport());
  },

  onComposerFocus() {
    this.prioritizeInteraction();
    // 占位双态（iOS：聚焦后切换为「描述你想要构建的内容」）
    if (!this.data.composerFocused) this.setData({ composerFocused: true, voiceTyping: true });
  },

  onKeyboardHide() {
    // 三个 setData 合成一个，避免 blur 时连续三次布局/渲染。
    this.setData(Object.assign({ kbHeight: 0, composerFocused: false, composerFocus: false, voiceTyping: false }, this.layoutPatch({ kbHeight: 0 })), () => this.measureConversationViewport());
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

  /** 长按消息正文：打开可选中/复制的纯文本弹层。 */
  openTextSelection(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    const rows = (this._conversationRows && this._conversationRows.length ? this._conversationRows : this.data.rows) || [];
    const row = rows.find((item) => item.key === key);
    const text = row && row.text ? mdToPlain(row.text) : '';
    if (!text) return;
    haptics.vibrate();
    this.setData({ filePreview: { name: uiText('选择文字'), text, selection: true } });
  },

  copyTextSelection() {
    const sheet = this.data.filePreview;
    const text = sheet && (sheet.selection || sheet.previewKind === 'text') ? sheet.text : '';
    if (!text) return;
    wx.setClipboardData({ data: text, success: () => {
      wx.showToast({ title: uiText('已复制'), icon: 'success' });
      if (sheet.selection) this.setData({ filePreview: null });
    } });
  },

  findPresetName(catalog, presetId) {
    const presets = (catalog && catalog.presets) || [];
    const found = presets.find((p) => p.id === presetId);
    return labels.presetDisplayName(found && found.name, presetId);
  },

  refreshSessionPreset(force) {
    const sessionId = store.sessionState && store.sessionState.sessionId;
    const client = store.client;
    if (!sessionId || !store.state || store.state.connection !== 'connected'
      || !client || typeof client.requestSessionAgentPreset !== 'function') return;
    const requestKey = sessionId + '/' + (client.connectGeneration || 0);
    if (!force && this._presetRequestedFor === requestKey) return;
    this._presetRequestedFor = requestKey;
    try {
      const request = client.requestSessionAgentPreset(sessionId);
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch (_) { /* the roster/projection still provides a display fallback */ }
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
        name: labels.presetDisplayName(p.name, p.id),
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
    if (action === 'browsePlugins' || action === 'createPlugin') {
      this.closeMoreActions();
      wx.navigateTo({
        url: action === 'browsePlugins'
          ? '/pages/plugins/plugins?tab=discover'
          : '/pages/plugins/plugins?action=create'
      });
      return;
    }
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
    const hasDisjointInput = uncachedInput != null && cacheRead != null && cacheWrite != null;
    const billedInput = hasDisjointInput
      ? uncachedInput + cacheRead + cacheWrite : input;
    const displayTotal = billedInput != null && output != null ? billedInput + output : null;
    const cacheHitPct = formatSessionCacheHitPercent(cacheRead, billedInput);
    const cacheHit = cacheHitPct == null ? '—' : cacheHitPct + '%';
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

  onHistoryBannerTap() {
    if (this.data.historyLoading) return;
    this.loadOlder();
  },

  loadOlder() {
    // 加载更早历史会让 scrollTop 骤降，抑制这次位移的手势判定
    this._suppressScrollUntil = Date.now() + 600;
    return store.loadOlderHistory();
  },

  onConvTouch() {
    if (this._bottomAnchorTimer) clearTimeout(this._bottomAnchorTimer);
    this._bottomAnchorTimer = null;
    this._bottomAnchorTouchAt = null;
    this._suppressScrollUntil = 0;
    this._scrollAnchorAt = 0;
    this._programmaticScrollAt = 0;
    this._programmaticScrollTop = undefined;
    this._lastConversationGestureAt = 0;
    this._lastTouchAt = Date.now();
  },

  pauseConversationFollowForReader() {
    if (this._bottomAnchorTimer) clearTimeout(this._bottomAnchorTimer);
    this._bottomAnchorTimer = null;
    this._bottomAnchorTouchAt = null;
    this._bottomAnchorDeferred = false;
    this._lastTouchAt = Date.now();
    this._followPausedByUser = true;
    this._convPinned = false;
  },

  onConvScroll(e) {
    const d = (e && e.detail) || {};
    const now = Date.now();
    this._lastConvScrollAt = now;
    const scrollTop = Number(d.scrollTop) || 0;
    const previousTop = this._lastNativeScrollTop !== undefined
      ? this._lastNativeScrollTop : this._lastScrollTop;
    this._lastNativeScrollTop = scrollTop;
    const recentTouch = now - (this._lastTouchAt || 0) < 1500;
    // Initial scroll-into-view can emit intermediate offsets while the virtual
    // tail window is still mounting. Treating that transient top as reader
    // intent unpins the conversation and can shift the window away from its tail.
    // 贴底锚点（进入会话 / 流式增长后重新贴底）同样会带来一次向上钳制，一并豁免；
    // 真有手指在滑时 recentTouch 为真，不受影响。
    const anchorSettling = (this._initialConversationAnchorPending === true
      || this._initialConversationAnchorApplied === true
      || (this._scrollAnchorAt && now - this._scrollAnchorAt < 800)) && !recentTouch;
    if (anchorSettling) return;
    const movingTowardOlder = previousTop !== undefined && scrollTop < previousTop - 2;
    const movingTowardNewer = previousTop !== undefined && scrollTop > previousTop + 2;
    const settlingAnchor = this._scrollAnchorAt && now - this._scrollAnchorAt < 800;
    const correctionPending = this._programmaticScrollTop !== undefined
      && this._programmaticScrollAt && now - this._programmaticScrollAt < 200;
    const settlingCorrection = correctionPending && Math.abs(scrollTop - this._programmaticScrollTop) <= 2;
    if (correctionPending && settlingCorrection) {
      this._programmaticScrollTop = undefined;
    }
    const programmaticScroll = this._suppressPins === true
      || now < (this._suppressScrollUntil || 0) || settlingAnchor || settlingCorrection;
    // 首次布局/贴底期间 scroll-view 可能上报一次向上钳制：忽略这类无触摸的
    // 初始锚点事件，但普通 suppress window 不能吞掉真实上滑（触摸事件也可能丢失）。
    const upwardReaderIntent = movingTowardOlder && this._suppressPins !== true
      && !correctionPending && !anchorSettling
      && !(settlingAnchor && this._convPinned === false);
    // Native scroll events are the reliable signal when scroll-view does not
    // deliver touchmove (or a nested view consumes it). Treat upward movement
    // itself as reader intent: requiring a touch event lets the near-bottom
    // tolerance re-arm the live tail and snap the list back down.
    if (upwardReaderIntent) {
      this._followPausedByUser = true;
      this._userScrollDirection = 'towardTop';
      this._convPinned = false;
      this._fastLiveSessionEntry = false;
      this._initialConversationAnchorPending = false;
      this._initialConversationAnchorApplied = false;
      this._suppressScrollUntil = 0;
      if (this.data.scrollTarget) this.setData({ scrollTarget: '' });
    }
    if (!programmaticScroll && movingTowardNewer && this._followPausedByUser) {
      this._userScrollDirection = 'towardBottom';
    }
    if (!programmaticScroll && (movingTowardOlder || movingTowardNewer)) {
      this._lastConversationGestureAt = now;
      this._initialConversationAnchorPending = false;
    }
    this.applyScrollPosition({
      scrollTop: scrollTop,
      scrollHeight: Number(d.scrollHeight) || 0,
      clientHeight: Number(d.clientHeight) || 0,
      deltaY: Number(d.deltaY) || 0,
      userScroll: !programmaticScroll && (recentTouch || movingTowardOlder || movingTowardNewer)
    });
    this.updateConversationWindow(scrollTop);
    this.maybePrefetchOlderHistory(scrollTop, !programmaticScroll && movingTowardOlder);
  },

  // Scroll events can omit clientHeight; measure it even while idle so the
  // jump-button state does not depend on a running-turn polling timer.
  measureConversationViewport() {
    if (this._unloaded || this.data.tab !== 'conversation'
      || typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    if (this._convViewportMeasurePending) {
      this._convViewportMeasureAgain = true;
      return;
    }
    this._convViewportMeasurePending = true;
    const query = wx.createSelectorQuery().in(this);
    query.select('.conversation').boundingClientRect();
    const offsetQuery = query.select('.conversation');
    const hasOffset = !!(offsetQuery && typeof offsetQuery.scrollOffset === 'function');
    if (hasOffset) offsetQuery.scrollOffset();
    query.select('.conversation-inner').boundingClientRect();
    query.exec((res) => {
      this._convViewportMeasurePending = false;
      const measureAgain = this._convViewportMeasureAgain;
      this._convViewportMeasureAgain = false;
      if (this._unloaded || this.data.tab !== 'conversation') return;
      const view = res && res[0];
      const offset = hasOffset && res ? res[1] : null;
      const inner = res && res[hasOffset ? 2 : 1];
      if (view && Number(view.height) > 0 && inner) {
        this.applyScrollPosition({
          scrollTop: Number(offset && offset.scrollTop) || Number(this._lastScrollTop) || 0,
          scrollHeight: Math.max(Number(offset && offset.scrollHeight) || 0, Number(inner.height) || 0),
          clientHeight: Number(view.height) || 0
        });
      }
      if (measureAgain) wx.nextTick(() => this.measureConversationViewport());
    });
  },

  /** 接近顶部时提前拉下一页历史，避免用户滑到顶后才开始慢加载。 */
  maybePrefetchOlderHistory(scrollTop, movingTowardOlder) {
    if (this.data.tab !== 'conversation' || this.data.turnNavOpen) return;
    if (this.data.historyPaging || !this.data.hasMoreHistory || this.data.histError) return;
    if (!movingTowardOlder) return;
    if (this._suppressPins === true || Date.now() < (this._suppressScrollUntil || 0)) return;
    if (scrollTop <= 0 || scrollTop > 4000) return;
    const now = Date.now();
    if (now - (this._olderPrefetchAt || 0) < 350) return;
    this._olderPrefetchAt = now;
    store.loadOlderHistory();
  },

  // Content growth and intermediate programmatic positions must not cancel following.
  applyScrollPosition(pos) {
    const scrollTop = Math.max(0, Number(pos.scrollTop) || 0);
    const scrollHeight = Math.max(0, Number(pos.scrollHeight) || 0);
    const clientHeight = Math.max(0, Number(pos.clientHeight) || this._convClientHeight || 0);
    if (!clientHeight) return;
    this._convClientHeight = clientHeight;
    // Selector measurements may observe the pre-anchor position during first
    // layout. Keep the entry follow state until the measured window is stable.
    if ((this._initialConversationAnchorPending === true || this._initialConversationAnchorApplied === true)
      && pos.userScroll !== true
      && Date.now() - (this._lastTouchAt || 0) >= 1500) {
      this._lastScrollTop = scrollTop;
      return;
    }
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

    const previousTop = this._lastScrollTop;
    const movedUp = previousTop !== undefined && scrollTop < previousTop - 2;

    if (Date.now() < (this._suppressScrollUntil || 0)) {
      this._lastScrollTop = scrollTop;
      if (this._followPausedByUser) this._convPinned = false;
      else if (pinned && this._suppressPins !== true) this._convPinned = true;
      return;
    }

    // Stay paused even while the reader is within the near-bottom tolerance; resume only
    // after an intentional scroll toward the newest content reaches the bottom again.
    if (this._followPausedByUser && pos.userScroll === true && pinned
      && this._userScrollDirection === 'towardBottom') this._followPausedByUser = false;
    if (this._convPinned === true && !pinned && !movedUp) {
      this._lastScrollTop = scrollTop;
      // 手指驱动的滚动不要被贴底抢回去；只修正程序化/内容变化造成的偏移。
      if (pos.userScroll !== true && Date.now() - (this._lastTouchAt || 0) >= 1000) this.refreshBottomAnchor();
      return;
    }
    this._lastScrollTop = scrollTop;
    const showJump = atVisualBottom
      ? false
      : this._followPausedByUser || distance > (this.data.showJump ? ARROW_HIDE_WITHIN : ARROW_SHOW_AFTER);
    if (showJump !== this.data.showJump) this.setData({ showJump: showJump });
    this._convPinned = this._followPausedByUser ? false : pinned;
  },

  // Recheck the measured viewport when native scroll events omit its height.
  pollScrollPosition() {
    if (this._unloaded || this._voiceHidden || this.data.turnNavOpen || this.data.tab !== 'conversation' || this.data.moreSheetOpen || this.data.collaborationOpen) return;
    // 没有回合在跑时内容高度不会变，滚动位置交给 bindscroll 驱动即可：
    if (!this.data.running) return;
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
    // 不用 filter:blur：几十行同时做模糊会让真机 GPU 发烫、滚动掉帧。
    const opacity = Math.max(0.16, 1 - distance * 0.14);
    const scale = Math.max(0.92, 1 - distance * 0.014);
    return `opacity:${opacity.toFixed(2)};transform:scale(${scale.toFixed(3)});`;
  },

  turnNavigatorRowHeight() {
    if (this._turnListRect && this._turnListRect.rowHeight) return this._turnListRect.rowHeight;
    let windowWidth = 375;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = Number(info && info.windowWidth) || windowWidth;
    } catch (_) { /* Keep a safe row-height estimate. */ }
    return 76 * windowWidth / 750;
  },

  turnNavigatorWindowPatch(items, scrollTop) {
    let windowHeight = 800;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowHeight = Number(info && info.windowHeight) || windowHeight;
    } catch (_) { /* Keep a safe viewport estimate. */ }
    const rect = this._turnListRect || {};
    const rowHeight = rect.rowHeight || this.turnNavigatorRowHeight();
    const clientHeight = rect.height || windowHeight * 0.76;
    const centerSpacer = rect.spacer == null ? Math.max(0, (clientHeight - rowHeight) / 2) : rect.spacer;
    const buffer = TURN_NAV_WINDOW_BUFFER;
    const visibleCount = Math.max(48, Math.ceil(clientHeight / rowHeight) + buffer * 2);
    const firstVisible = Math.floor((Number(scrollTop) || 0) / rowHeight);
    const firstBuffered = Math.max(0, firstVisible - buffer);
    // Move the virtual slice in batches, not once per row crossed during a fling.
    const start = Math.max(0, Math.min(items.length,
      Math.floor(firstBuffered / buffer) * buffer));
    const end = Math.min(items.length, start + visibleCount);
    return {
      turnNavVisibleItems: items.slice(start, end).map((item, offset) => Object.assign({}, item, { index: start + offset })),
      turnNavWindowStart: start,
      turnNavTopPadPx: start * rowHeight + centerSpacer,
      turnNavBottomPadPx: Math.max(0, items.length - end) * rowHeight + centerSpacer
    };
  },

  syncTurnNavigatorWindow(scrollTop, force) {
    const items = this.data.turnNavItems || [];
    const patch = this.turnNavigatorWindowPatch(items, scrollTop);
    if (!force && patch.turnNavWindowStart === this._turnWindowStart) return;
    this._turnWindowStart = patch.turnNavWindowStart;
    this.setData(patch);
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
          seq: row.seq,
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
    const candidates = turns.map((turn) => {
      userIndex += 1;
      const title = snippet(turn.sent, 120);
      const replyPreview = turn.reply || turn.processTitle || '';
      return {
        key: turn.key,
        kind: 'user',
        seq: turn.seq,
        index: userIndex,
        // 列表只显示发送内容作为标题
        label: title || uiText('轮次') + ' ' + userIndex,
        detail: uiText('轮次') + ' ' + userIndex,
        // 选中行第二行显示助手回答正文（浅色、两行）
        preview: snippet(replyPreview, 120),
        full: snippet(replyPreview || turn.sent, 800)
      };
    });
    // Keep the outline for this session independently of the conversation's
    // rendered window. Older history prepends; new turns append chronologically.
    const sessionId = String((store.sessionState && store.sessionState.sessionId) || this._renderSessionId || '');
    const scope = String(store.state && (store.state.activeID || store.state.endpoint) || '');
    const cacheKey = JSON.stringify([scope, sessionId]);
    if (this._turnNavCacheSessionId !== cacheKey) {
      this.stopTurnNavigatorWarmup(false);
      this._pendingTurnJump = null;
      this._turnNavCacheSessionId = cacheKey;
      this._turnNavItemsCache = store.getTurnOutline ? store.getTurnOutline(sessionId) : [];
      const cachedItems = this._turnNavItemsCache || [];
      const originalKeys = cachedItems.map(item => item.key);
      const allSequenced = cachedItems.length > 0 && cachedItems.every((item) => item.seq !== undefined
        && item.seq !== null && item.seq !== '' && Number.isFinite(Number(item.seq)));
      const allIndexed = cachedItems.length > 0 && cachedItems.every(item => Number.isFinite(Number(item.index)));
      if (allSequenced) cachedItems.sort((a, b) => Number(a.seq) - Number(b.seq));
      else if (allIndexed) cachedItems.sort((a, b) => Number(a.index) - Number(b.index));
      this._turnNavCacheNeedsSave = originalKeys.some((key, index) => cachedItems[index] && cachedItems[index].key !== key);
    }
    const items = this._turnNavItemsCache || (this._turnNavItemsCache = []);
    let changed = this._turnNavCacheNeedsSave === true;
    this._turnNavCacheNeedsSave = false;
    const cachedByKey = new Map(items.map((item) => [item.key, item]));
    if (!items.length) {
      items.push(...candidates);
      changed = candidates.length > 0;
    } else {
      let pending = [];
      const insertBefore = (anchor) => {
        if (!pending.length) return;
        items.splice(items.indexOf(anchor), 0, ...pending);
        changed = true;
        pending.forEach((item) => cachedByKey.set(item.key, item));
        pending = [];
      };
      candidates.forEach((candidate) => {
        const existing = cachedByKey.get(candidate.key);
        if (existing) {
          if (['label', 'preview', 'full', 'seq'].some(key => existing[key] !== candidate[key])) changed = true;
          Object.assign(existing, candidate);
          insertBefore(existing);
        } else {
          pending.push(candidate);
        }
      });
      if (pending.length) {
        // When a bounded source window has no shared keys, sequence numbers still
        // preserve chronology; otherwise append these unseen current turns in source order.
        const allSequenced = items.concat(pending).every((item) => item.seq !== undefined
          && item.seq !== null && item.seq !== '' && Number.isFinite(Number(item.seq)));
        items.push(...pending);
        changed = true;
        if (allSequenced) items.sort((a, b) => Number(a.seq) - Number(b.seq));
        pending.forEach((item) => cachedByKey.set(item.key, item));
      }
    }
    items.forEach((item, index) => { item.index = index; item.detail = uiText('轮次') + ' ' + (index + 1); });
    if (changed && store.saveTurnOutline) store.saveTurnOutline(sessionId, items);
    const selected = (this.data.turnNavItems || [])[this.data.turnNavActiveIndex];
    const selectedIndex = selected ? items.findIndex(item => item.key === selected.key) : -1;
    const previousActive = Number.isInteger(this.data.turnNavActiveIndex) ? this.data.turnNavActiveIndex : -1;
    const active = selectedIndex >= 0 ? selectedIndex : (this.data.turnNavOpen && items.length ? items.length - 1 : -1);
    const scrollPatch = {};
    let scrollTop = Number(this._turnScrollTop) || 0;
    if (this.data.turnNavOpen && items.length && selectedIndex >= 0 && selectedIndex !== previousActive) {
      scrollTop = Math.max(0, scrollTop + (selectedIndex - previousActive) * this.turnNavigatorRowHeight());
      this._turnScrollTop = scrollTop;
      scrollPatch.turnNavScrollTop = scrollTop;
    } else if (this.data.turnNavOpen && items.length && !(this.data.turnNavItems || []).length) {
      scrollTop = (items.length - 1) * this.turnNavigatorRowHeight();
      this._turnScrollTop = scrollTop;
      scrollPatch.turnNavScrollTop = scrollTop;
    }
    this._turnNavEffectsIndex = active;
    const windowPatch = this.turnNavigatorWindowPatch(items, scrollTop);
    this._turnWindowStart = windowPatch.turnNavWindowStart;
    return { turnNavItems: items.map(item => Object.assign({}, item)), turnNavActiveIndex: active, ...scrollPatch, ...windowPatch,
      turnNavRowStyles: items.map((_, index) => this.turnNavRowStyle(index, active)) };
  },

  openTurnNavigator() {
    if (this.data.turnNavOpen) return;
    this.prioritizeInteraction();
    const session = store.sessionState || {};
    this._turnScrollTop = 0;
    this._turnListRect = null;
    this._turnScrubbing = false;
    this._turnOlderRequestKey = '';
    this._turnNavigatorTouched = false;
    this._turnAutoFillDone = false;
    this._turnWindowStart = null;
    const navPatch = this.turnNavigatorPatch((store.sessionState && store.sessionState.rows) || this._conversationRows || []);
    const items = navPatch.turnNavItems || [];
    const active = items.length ? items.length - 1 : -1;
    const initialScrollTop = Math.max(0, active) * this.turnNavigatorRowHeight();
    this._turnScrollTop = initialScrollTop;
    Object.assign(navPatch, this.turnNavigatorWindowPatch(items, initialScrollTop));
    this._turnWindowStart = navPatch.turnNavWindowStart;
    this.setData({
      ...navPatch,
      turnNavOpen: true,
      turnNavScrollTop: initialScrollTop,
      turnNavActiveIndex: active,
      turnNavRowStyles: items.map((_, index) => this.turnNavRowStyle(index, active)),
      turnNavPreview: null,
      turnNavWarming: false,
      turnNavWarmText: '',
      turnNavHistoryComplete: this.turnNavigatorHistoryComplete(session),
      turnNavHistoryPending: this.turnNavigatorHistoryPending(session),
      turnNavHistoryText: this.turnNavigatorHistoryText(session)
    }, () => wx.nextTick(() => {
      if (!this.data.turnNavOpen || this._unloaded) return;
      this.measureTurnRail();
      this.startTurnNavigatorWarmup();
    }));
  },

  turnNavigatorHistoryComplete(session) {
    const value = session || {};
    return value.hasMoreHistory === false
      && value.hasMoreHistoryKnown === true
      && value.historyPaging !== true
      && !value.historyError
      && /^loaded(?::|$)/.test(String(value.historyState || ''));
  },

  turnNavigatorHistoryPending(session) {
    const value = session || {};
    if (!(Array.isArray(value.rows) && value.rows.length)
      || this.turnNavigatorHistoryComplete(value)) return false;
    const state = String(value.historyState || '');
    return value.cacheDisplay === true || value.historyPaging === true
      || !!value.historyError
      || value.hasMoreHistoryKnown !== true
      || (value.hasMoreHistory !== true && value.hasMoreHistory !== false)
      || !/^loaded(?::|$)/.test(state);
  },

  turnNavigatorHistoryText(session) {
    if (this.turnNavigatorHistoryComplete(session)) return uiText('已确认顶部为最早一轮');
    if (this.turnNavigatorHistoryPending(session)) {
      return session && session.historyError
        ? uiText('历史范围尚未确认') : uiText('正在确认历史范围…');
    }
    return '';
  },

  startTurnNavigatorWarmup() {
    const session = store.sessionState || {};
    if (this._turnWarmup && this._turnWarmup.sessionId === session.sessionId) return;
    if (this._unloaded || this._voiceHidden || !session.sessionId || !session.hasMoreHistory || session.cacheDisplay) {
      // Wait for authoritative pagination metadata; cached tails are not complete.
      this._turnWarmupStarted = false;
      this.setData({
        turnNavWarming: false,
        turnNavHistoryComplete: this.turnNavigatorHistoryComplete(session),
        turnNavHistoryPending: this.turnNavigatorHistoryPending(session),
        turnNavHistoryText: this.turnNavigatorHistoryText(session)
      });
      return;
    }
    this.stopTurnNavigatorWarmup(false);
    this._turnWarmupStarted = true;
    this._turnWarmup = {
      sessionId: session.sessionId,
      waiting: false,
      requestCursor: null,
      requestedAt: 0
    };
    this.setData({ turnNavWarming: true, turnNavWarmText: uiText('正在准备较早记录…'),
      turnNavHistoryComplete: false, turnNavHistoryPending: false, turnNavHistoryText: '' });
    this.pumpTurnNavigatorWarmup();
  },

  scheduleTurnNavigatorWarmup(delay) {
    if (this._turnWarmTimer) clearTimeout(this._turnWarmTimer);
    this._turnWarmTimer = setTimeout(() => {
      this._turnWarmTimer = null;
      this.pumpTurnNavigatorWarmup();
    }, delay == null ? 180 : delay);
  },

  pumpTurnNavigatorWarmup() {
    const warmup = this._turnWarmup;
    if (!warmup || this._unloaded || this._voiceHidden) return;
    const session = store.sessionState || {};
    if (session.sessionId !== warmup.sessionId) {
      this.stopTurnNavigatorWarmup(false);
      return;
    }

    if (warmup.waiting) {
      if (session.historyPaging) { this.scheduleTurnNavigatorWarmup(400); return; }
      const cursorAdvanced = session.nextBeforeSeq !== warmup.requestCursor;
      if (cursorAdvanced || session.hasMoreHistory === false) {
        warmup.waiting = false;
        if (session.hasMoreHistory === false) {
          const complete = this.turnNavigatorHistoryComplete(session);
          this.finishTurnNavigatorWarmup(complete ? uiText('已确认顶部为最早一轮') : '');
          return;
        }
        this.scheduleTurnNavigatorWarmup(session.running === true ? 900 : 180);
        return;
      }
      if (session.historyError || Date.now() - warmup.requestedAt > 9000) {
        this.finishTurnNavigatorWarmup('');
        return;
      }
      this.scheduleTurnNavigatorWarmup(400);
      return;
    }

    if (session.hasMoreHistory !== true) {
      const complete = this.turnNavigatorHistoryComplete(session);
      this.finishTurnNavigatorWarmup(complete ? uiText('已确认顶部为最早一轮') : '');
      return;
    }
    warmup.waiting = true;
    warmup.requestCursor = session.nextBeforeSeq;
    warmup.requestedAt = Date.now();
    if (this.loadOlder() === false) {
      this.finishTurnNavigatorWarmup('');
      return;
    }
    // Continue paging during a live turn, but keep history reads low priority
    // so the real-time event stream remains responsive.
    this.scheduleTurnNavigatorWarmup(session.running === true ? 900 : 400);
  },

  finishTurnNavigatorWarmup(text) {
    if (this._turnWarmTimer) clearTimeout(this._turnWarmTimer);
    this._turnWarmTimer = null;
    this._turnWarmup = null;
    const session = store.sessionState || {};
    this.setData({ turnNavWarming: false, turnNavWarmText: text || '',
      turnNavHistoryComplete: this.turnNavigatorHistoryComplete(session),
      turnNavHistoryPending: this.turnNavigatorHistoryPending(session),
      turnNavHistoryText: this.turnNavigatorHistoryText(session) });
  },

  stopTurnNavigatorWarmup(updateView) {
    if (this._turnWarmTimer) clearTimeout(this._turnWarmTimer);
    this._turnWarmTimer = null;
    this._turnWarmup = null;
    this._turnWarmupStarted = false;
    if (updateView !== false && this.data) this.setData({ turnNavWarming: false, turnNavWarmText: '' });
  },

  measureTurnRail() {
    const query = wx.createSelectorQuery();
    query.select('#turn-scrub-list').boundingClientRect((rect) => {
      if (!this.data.turnNavOpen || this._unloaded || !rect || rect.height <= 0) return;
      const rowHeight = this.turnNavigatorRowHeight();
      const spacer = Math.max(0, (rect.height - rowHeight) / 2);
      this._turnListRect = {
        top: rect.top,
        height: rect.height,
        rowHeight,
        spacer
      };
      this.syncTurnNavigatorWindow(this._turnScrollTop || 0, true);
    }).exec();
    if (this._convPinned !== false || this.data.tab !== 'conversation') return;
    // 找当前对话正在看的位置：视口内第一条用户消息，默认高亮它
    query.select('.conversation').boundingClientRect((conv) => {
      query.selectAll('.row-user').boundingClientRect((rows) => {
        if (!this.data.turnNavOpen || this._unloaded || this._turnNavigatorTouched || this._convPinned !== false || !conv || !conv.height || !rows || !rows.length) return;
        if (!(this.data.turnNavItems || []).length) return;
        const userRows = (this.data.rows || []).filter(row => row && row.kind === 'user');
        let index = -1;
        for (let i = 0; i < Math.min(rows.length, userRows.length); i += 1) {
          if (rows[i].bottom <= conv.top + 12 || rows[i].top >= conv.bottom) continue;
          index = (this.data.turnNavItems || []).findIndex(item => item.key === userRows[i].key);
          if (index >= 0) break;
        }
        if (index < 0) return;
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
    const previousTop = this._turnScrollTop;
    this._turnScrollTop = top;
    this.syncTurnNavigatorWindow(top, false);
    const rect = this._turnListRect;
    if (rect && rect.rowHeight > 0) {
      const activeIndex = Math.round(top / rect.rowHeight);
      const clearEffects = !this._turnScrollBusy;
      this._turnScrollBusy = true;
      this.applyTurnIndex(activeIndex, false, false, clearEffects);
      if (this._turnScrollIdleTimer != null) clearTimeout(this._turnScrollIdleTimer);
      this._turnScrollIdleTimer = setTimeout(() => {
        this._turnScrollIdleTimer = null;
        this._turnScrollBusy = false;
        this.applyTurnIndex(Math.round((this._turnScrollTop || 0) / rect.rowHeight), false, true);
      }, TURN_NAV_SCROLL_IDLE_MS);
    }
    // Chronological order puts older turns at the top of the rail.
    if (previousTop !== undefined && top < previousTop - 2) this.scheduleTurnNavigatorHistory(detail);
  },

  /** 滚动中先不追加历史（加载 + 滚动叠加会卡），停手后再补一页。 */
  scheduleTurnNavigatorHistory(detail) {
    this._turnHistoryDetail = detail || {};
    if (typeof setTimeout !== 'function') { this.autoLoadTurnNavigatorHistory(this._turnHistoryDetail, false); return; }
    if (this._turnHistoryTimer != null) clearTimeout(this._turnHistoryTimer);
    this._turnHistoryTimer = setTimeout(() => {
      this._turnHistoryTimer = null;
      if (this._unloaded || !this.data.turnNavOpen) return;
      this.autoLoadTurnNavigatorHistory(this._turnHistoryDetail, false);
    }, 180);
  },

  applyTurnIndex(index, feedback = true, refreshEffects, clearEffects) {
    const items = this.data.turnNavItems || [];
    const item = items[index];
    if (!item) return;
    const previousIndex = this.data.turnNavActiveIndex;
    const activeChanged = index !== previousIndex;
    const updateEffects = refreshEffects === true
      || (refreshEffects !== false && !this._turnScrollBusy);
    if (!activeChanged && !updateEffects && !clearEffects) return;
    const patch = activeChanged ? { turnNavActiveIndex: index } : {};
    if (clearEffects) {
      const effectIndex = Number.isInteger(this._turnNavEffectsIndex)
        ? this._turnNavEffectsIndex : previousIndex;
      for (let i = Math.max(0, effectIndex - 6); i <= Math.min(items.length - 1, effectIndex + 6); i++) {
        if (this.data.turnNavRowStyles[i]) patch['turnNavRowStyles[' + i + ']'] = '';
      }
      this._turnNavEffectsIndex = null;
    }
    if (updateEffects) {
      const previousEffectIndex = Number.isInteger(this._turnNavEffectsIndex)
        && this._turnNavEffectsIndex >= 0 ? this._turnNavEffectsIndex : previousIndex;
      const styled = new Set();
      for (const center of [previousEffectIndex, index]) {
        if (center < 0) continue;
        for (let i = Math.max(0, center - 6); i <= Math.min(items.length - 1, center + 6); i++) styled.add(i);
      }
      styled.forEach(i => {
        const style = this.turnNavRowStyle(i, index);
        if (this.data.turnNavRowStyles[i] !== style) patch['turnNavRowStyles[' + i + ']'] = style;
      });
      this._turnNavEffectsIndex = index;
    }
    if (feedback && activeChanged) haptics.tick();
    if (Object.keys(patch).length) this.setData(patch);
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
    if (this._turnWarmup && !(store.sessionState && store.sessionState.running === true)) return;
    if (!this.data.turnNavOpen || !this.data.hasMoreHistory || this.data.historyLoading) return;
    if (this.data.histError && !force) return;

    const rowHeight = this.turnNavigatorRowHeight();
    const scrollTop = Number(detail && detail.scrollTop) || 0;
    const nearOlderEdge = scrollTop <= Math.max(rowHeight * 2, 80);
    if (detail) {
      if (!nearOlderEdge) return;
    } else {
      // Programmatic fills are a one-page fallback. Full automatic pagination
      // is coordinated by the paced warm-up above.
      if (!fillViewport || this._turnAutoFillDone) return;
      this._turnAutoFillDone = true;
    }

    const session = store.sessionState || {};
    const requestKey = String(session.sessionId || '') + ':' + String(session.nextBeforeSeq == null ? '' : session.nextBeforeSeq);
    if (!requestKey || (this._turnOlderRequestKey === requestKey && !force)) return;
    this._turnOlderRequestKey = requestKey;
    this.loadOlder();
  },

  retryTurnNavigatorHistory() {
    this._turnOlderRequestKey = '';
    this._turnWarmupStarted = false;
    this.setData({ histError: '' });
    this.startTurnNavigatorWarmup();
  },

  closeTurnNavigator() {
    this._turnListScrolling = false;
    this._turnScrubbing = false;
    this._turnScrollTop = 0;
    this._pendingTurnJump = null;
    if (this._turnHistoryTimer != null && typeof clearTimeout === 'function') { clearTimeout(this._turnHistoryTimer); this._turnHistoryTimer = null; }
    if (this._turnScrollIdleTimer != null) clearTimeout(this._turnScrollIdleTimer);
    this._turnScrollIdleTimer = null;
    this._turnScrollBusy = false;
    this.setData({ turnNavOpen: false, turnNavPreview: null, turnNavScrollTop: 0 });
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
    // A persisted outline can arrive before its message page. Keep the target
    // selected and jump only once the background history fill makes it real.
    if (this._conversationRows && !this._conversationRows.some(row => row.key === key)) {
      this._pendingTurnJump = key;
      this._turnWarmupStarted = false;
      this.startTurnNavigatorWarmup();
      return;
    }
    haptics.vibrate();
    if (this.data.tab !== 'conversation') this.switchTab({ currentTarget: { dataset: { tab: 'conversation' } } });
    this._convPinned = false;
    // 程序化跳转期间禁止 scroll 事件重新贴底，否则 key 会被 conv-bottom 覆盖。
    this._suppressPins = true;
    this._suppressScrollUntil = Date.now() + 900;
    this.revealConversationRow(key);
    this._turnScrollTop = 0;
    this.setData({ turnNavOpen: false, turnNavScrollTop: 0, scrollTarget: '', scrollAnim: true }, () => {
      wx.nextTick(() => {
        this.setData({ scrollTarget: key });
        this._turnJumpTimer = setTimeout(() => {
          this._convPinned = false;
          this._suppressPins = false;
          this._suppressScrollUntil = 0;
          this.setData({ scrollAnim: false });
        }, 400);
      });
    });
  },

  // 每次进入/切换会话都重新跟随最新消息，不继承上次阅读历史的位置。
  resetConversationScroll() {
    if (this._bottomAnchorTimer) clearTimeout(this._bottomAnchorTimer);
    this._bottomAnchorTimer = null;
    this._bottomAnchorTouchAt = null;
    this._bottomAnchorPending = false;
    this._bottomAnchorDeferred = false;
    this._bottomAnchorAt = 0;
    if (this._turnJumpTimer) clearTimeout(this._turnJumpTimer);
    this._turnJumpTimer = null;
    this._suppressPins = false;
    this._suppressScrollUntil = 0;
    this._followPausedByUser = false;
    this._userScrollDirection = '';
    this._initialConversationAnchorApplied = false;
    this._convPinned = true;
    this._lastTouchAt = 0;
    this._scrollAnchorAt = 0;
    this._programmaticScrollAt = 0;
    this._programmaticScrollTop = undefined;
    this._lastConversationGestureAt = 0;
    this._userScrolledUp = false;
    this._convContentHeight = 0;
    this._lastScrollTop = undefined;
    this._lastNativeScrollTop = undefined;
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

  deferBottomAnchorUntilTouchSettles() {
    if (this._unloaded || this.data.tab !== 'conversation' || this._convPinned === false || this._followPausedByUser) return;
    const touchAt = this._lastTouchAt || 0;
    if (this._bottomAnchorTimer && this._bottomAnchorTouchAt === touchAt) return;
    if (this._bottomAnchorTimer) clearTimeout(this._bottomAnchorTimer);
    this._bottomAnchorTouchAt = touchAt;
    const wait = Math.max(16, 820 - (Date.now() - touchAt));
    this._bottomAnchorTimer = setTimeout(() => {
      this._bottomAnchorTimer = null;
      this._bottomAnchorTouchAt = null;
      if (touchAt !== (this._lastTouchAt || 0)) return;
      this.refreshBottomAnchor();
    }, wait);
  },

  refreshBottomAnchor() {
    if (this._suppressPins === true || this._unloaded || this.data.tab !== 'conversation') return;
    if (this._convPinned === false || this._followPausedByUser) return;
    // 用户正在点/摸列表时不要贴底：内容刚变化（回合收工、过程组展开）时这一下滚动会把
    // 行从手指底下抽走，WebView 直接吞掉这次 tap——表现就是「第一下完全没反应」，
    // 要连着点好几下才展开。等手指离开 800ms 后再贴底。
    if (Date.now() - (this._lastTouchAt || 0) < 800) {
      this.deferBottomAnchorUntilTouchSettles();
      return;
    }
    if (this._panelGesture && this._panelGesture.tab === 'conversation') {
      this._bottomAnchorDeferred = true;
      return;
    }
    // 空对话的空态（鲸鱼 + 说明）本身要垂直居中，贴底滚动会把整块内容顶高；
    if (!this.data.rows.length && this.data.historyLoaded && !this.data.running) return;
    if (this._bottomAnchorPending) return;
    this._bottomAnchorPending = true;
    // 贴底是一次「程序化滚动窗口」：这期间的向上微调（内容重排导致的钳制）不能
    // 被当成读者意图而停止跟随。
    this._scrollAnchorAt = Date.now();
    const touch = this._lastTouchAt;
    const sessionId = this._renderSessionId;
    const initialAnchorActive = this._initialConversationAnchorApplied === true;
    const fastEntryAnchorActive = this._fastLiveSessionEntry === true && initialAnchorActive;
    const canFollow = () => !this._unloaded && !this._voiceHidden
      && this.data.tab === 'conversation' && sessionId === this._renderSessionId
      && touch === this._lastTouchAt && this._convPinned !== false && !this._followPausedByUser;
    const finish = () => {
      this._bottomAnchorPending = false;
    };
    const tick = typeof wx !== 'undefined' && typeof wx.nextTick === 'function'
      ? wx.nextTick : fn => fn();
    const settleInitialAnchor = () => {
      if (initialAnchorActive && !this._unloaded && sessionId === this._renderSessionId) {
        this.measureConversationWindow();
      }
    };
    const retargetFallback = () => {
      this._suppressScrollUntil = Date.now() + 300;
      this.setData({ scrollTarget: '' }, () => tick(() => {
        finish();
        if (canFollow()) {
          if (initialAnchorActive) this.setData({ scrollTarget: 'conv-bottom' }, settleInitialAnchor);
          else this.setData({ scrollTarget: 'conv-bottom' });
        }
      }));
    };
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') {
      retargetFallback();
      return;
    }
    tick(() => {
      if (!canFollow()) { finish(); return; }
      try {
        const query = wx.createSelectorQuery().in(this);
        query.select('.conversation').boundingClientRect();
        query.select('.conversation').scrollOffset();
        query.exec(res => {
          if (!canFollow()) { finish(); return; }
          const viewport = res && res[0];
          const offset = res && res[1];
          const height = Number(viewport && viewport.height);
          const scrollHeight = Number(offset && offset.scrollHeight);
          if (height > 0 && Number.isFinite(scrollHeight)) {
            const bottom = Math.max(0, scrollHeight - height);
            const nativeTop = Number(offset && offset.scrollTop);
            const nativePositionMissed = !Number.isFinite(nativeTop) || Math.abs(nativeTop - bottom) > 1;
            // During the live-session entry anchor, retry with the native row
            // target instead of writing a compensating scrollTop.
            const scrollTopNeedsUpdate = !fastEntryAnchorActive
              && Math.abs((Number(this.data.conversationScrollTop) || 0) - bottom) > 1;
            const retryTarget = !scrollTopNeedsUpdate && nativePositionMissed;
            const patch = { scrollAnim: false };
            if (scrollTopNeedsUpdate) patch.conversationScrollTop = bottom;
            if (retryTarget) patch.scrollTarget = this.data.scrollTarget === 'conv-bottom' ? '' : 'conv-bottom';
            else if (this.data.scrollTarget) patch.scrollTarget = '';
            this._suppressScrollUntil = Date.now() + 300;
            this._programmaticScrollAt = Date.now();
            this._programmaticScrollTop = bottom;
            this._lastScrollTop = bottom;
            if (!initialAnchorActive) this._initialConversationAnchorApplied = false;
            this._initialConversationAnchorRecoveryPending = false;
            const patchChanged = Object.keys(patch).some(key => this.data[key] !== patch[key]);
            if (retryTarget && this.data.scrollTarget === 'conv-bottom') {
              this.setData(patch, () => tick(() => {
                if (canFollow()) this.setData({ scrollTarget: 'conv-bottom' }, () => {
                  finish();
                  settleInitialAnchor();
                });
                else finish();
              }));
            } else {
              if (patchChanged) this.setData(patch, () => {
                finish();
                settleInitialAnchor();
              });
              else {
                finish();
                settleInitialAnchor();
              }
            }
            return;
          }
          // Older runtimes may omit scrollHeight; use the original target as a fallback.
          retargetFallback();
        });
      } catch (_) { retargetFallback(); }
    });
  },

  /** 落底自检：贴底后确认原生滚动真的到了底部，没到就再补一次锚点（最多 6 次）。 */
  verifyConversationBottom(attempt = 0) {
    if (this._unloaded || this._voiceHidden || this.data.tab !== 'conversation') return;
    if (this._convPinned === false || this._followPausedByUser) return;
    if (typeof wx === 'undefined' || typeof wx.createSelectorQuery !== 'function') return;
    if (this._bottomVerifyTimer) { clearTimeout(this._bottomVerifyTimer); this._bottomVerifyTimer = null; }
    const query = wx.createSelectorQuery().in(this);
    query.select('.conversation').boundingClientRect();
    query.select('.conversation').scrollOffset();
    query.exec(res => {
      if (this._unloaded || this._convPinned === false || this._followPausedByUser) return;
      const viewport = res && res[0];
      const offset = res && res[1];
      const height = Number(viewport && viewport.height) || 0;
      const scrollHeight = Number(offset && offset.scrollHeight) || 0;
      const top = Number(offset && offset.scrollTop) || 0;
      if (height <= 0 || scrollHeight <= 0) return;
      if (top + height >= scrollHeight - 2) return;
      if (attempt >= 5) return;
      this._bottomVerifyTimer = setTimeout(() => {
        this._bottomVerifyTimer = null;
        if (this._unloaded || this._convPinned === false || this._followPausedByUser) return;
        this.refreshBottomAnchor();
        this.verifyConversationBottom(attempt + 1);
      }, 80);
    });
  },

  /** Only the newest visible running process group is allowed to follow its live tail. */
  processFollowCandidate(rows, visibleRows) {
    const latest = this.latestRunningProcessGroup(rows);
    if (!latest || !Array.isArray(visibleRows) || !visibleRows.includes(latest)
      || !latest.processBodyVisible || !latest.processBodyCapped) return null;
    return latest;
  },

  latestRunningProcessGroup(rows) {
    const list = Array.isArray(rows) ? rows : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] && list[i].kind === 'processGroup' && list[i].running) return list[i];
    }
    return null;
  },

  processFollowSignature(group) {
    const children = Array.isArray(group && group.children) ? group.children : [];
    return children.map(child => {
      const text = String(child && (child.text || child.preview) || '');
      const tools = child && child.kind === 'toolBundle' ? (child.tools || []).map(tool => [
        tool.key || tool.callId || '', tool.status || '', String(tool.argumentsText || '').length,
        String(tool.resultText || '').length,
        String(tool.argumentsText || '').slice(-48), String(tool.resultText || '').slice(-48)
      ].join(':')).join('|') : '';
      return [child && child.key || '', child && child.kind || '', text.length, text.slice(-64), tools].join(':');
    }).join(';');
  },

  /** Two sentinels are retained only for runtimes that cannot measure scroll-view offsets. */
  nextProcessFollowTarget(key) {
    const current = this.data.processFollowTarget || '';
    return key + (current === key + '/tail' ? '/tail-alt' : '/tail');
  },

  refreshProcessFollow(key) {
    if (!key || key !== this._processFollowKey || this._unloaded || this._voiceHidden) return;
    if ((this._processFollowPaused || {})[key]) return;
    // 测试/异常环境下没有 wx.nextTick：退化为同步执行，行为不变只是少了布局等待
    const tick = typeof wx !== 'undefined' && typeof wx.nextTick === 'function' ? wx.nextTick : (fn) => fn();
    const version = this._processFollowVersion;
    const request = this._processFollowRequest = (this._processFollowRequest || 0) + 1;
    tick(() => {
      if (this._unloaded || this._voiceHidden || !this.data.running
        || version !== this._processFollowVersion || request !== this._processFollowRequest
        || key !== this._processFollowKey) return;
      if ((this._processFollowPaused || {})[key]) return;
      const latest = this.latestRunningProcessGroup(this.data.rows);
      if (!latest || latest.key !== key || !latest.processBodyVisible || !latest.processBodyCapped) return;
      if (typeof wx !== 'undefined' && typeof wx.createSelectorQuery === 'function') {
        try {
          const query = wx.createSelectorQuery().in(this);
          const body = query.select('#process-body-' + key);
          body.boundingClientRect();
          body.scrollOffset();
          query.exec(res => {
            if (this._unloaded || this._voiceHidden || !this.data.running
              || version !== this._processFollowVersion || request !== this._processFollowRequest
              || key !== this._processFollowKey || (this._processFollowPaused || {})[key]) return;
            const rect = res && res[0];
            const offset = res && res[1];
            const height = Number(rect && rect.height);
            const scrollHeight = Number(offset && offset.scrollHeight);
            const current = this.latestRunningProcessGroup(this.data.rows);
            if (!current || current.key !== key || !current.processBodyVisible
              || !current.processBodyCapped || !(height > 0) || !Number.isFinite(scrollHeight)) return;
            const top = Math.max(0, scrollHeight - height);
            const tops = this._processBodyFollowTops || (this._processBodyFollowTops = Object.create(null));
            tops[key] = top;
            const index = this.data.rows.findIndex(row => row && row.key === key);
            const patch = {};
            if (index >= 0 && Number(this.data.rows[index].processBodyScrollTop) !== top) {
              patch['rows[' + index + '].processBodyScrollTop'] = top;
            }
            if (this.data.processFollowTarget) patch.processFollowTarget = '';
            if (Object.keys(patch).length) this.setData(patch);
          });
          return;
        } catch (_) { /* older runtimes use the sentinel fallback */ }
      }
      this.setData({ processFollowTarget: this.nextProcessFollowTarget(key) });
    });
  },

  measureProcessBodyHeight(key) {
    const heights = this._processBodyHeights || (this._processBodyHeights = {});
    if (heights[key] > 0) return;
    const pending = this._processBodyMeasurePending || (this._processBodyMeasurePending = {});
    if (pending[key]) return;
    pending[key] = true;
    const finish = height => {
      pending[key] = false;
      if (this._unloaded || !(Number(height) > 0)) return;
      heights[key] = Number(height);
      const metrics = this._processBodyScrollMetrics && this._processBodyScrollMetrics[key];
      if (metrics) this.updateProcessBodyFollow(key, metrics);
    };
    if (typeof this.createSelectorQuery === 'function') {
      try {
        const query = this.createSelectorQuery();
        query.select('#process-body-' + key).boundingClientRect(rect => finish(rect && rect.height));
        query.exec();
        return;
      } catch (_) { pending[key] = false; }
    }
    // Older runtimes may not expose page-scoped selector queries. Match the
    // capped body's CSS bound (min(400px, 50vh)) rather than guessing zero.
    let windowHeight = 0;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowHeight = Number(info && info.windowHeight) || 0;
    } catch (_) {}
    finish(windowHeight > 0 ? Math.min(400, windowHeight / 2) : 400);
  },

  updateProcessBodyFollow(key, metrics) {
    const top = Number(metrics && metrics.scrollTop);
    const scrollHeight = Number(metrics && metrics.scrollHeight);
    const height = Number(metrics && metrics.height) || Number((this._processBodyHeights || {})[key]);
    if (!Number.isFinite(top) || !Number.isFinite(scrollHeight) || !(height > 0)) return;
    const atBottom = scrollHeight - top - height <= 12;
    const paused = this._processFollowPaused || (this._processFollowPaused = {});
    if (atBottom === !paused[key]) return;
    if (atBottom) {
      delete paused[key];
      this.refreshProcessFollow(key);
    } else {
      paused[key] = true;
      this._processFollowRequest = (this._processFollowRequest || 0) + 1;
      this.setData({ processFollowTarget: '' });
    }
  },

  onProcessBodyTouchStart(e) {
    const touch = e.touches && e.touches[0];
    const key = e.currentTarget.dataset.key;
    if (!key || !touch) return;
    this._processBodyGesture = { key, startY: touch.clientY, moved: false };
  },
  onProcessBodyTouchMove(e) {
    const gesture = this._processBodyGesture;
    const touch = e.touches && e.touches[0];
    if (!gesture || !touch || gesture.key !== e.currentTarget.dataset.key) return;
    if (Math.abs(touch.clientY - gesture.startY) > 4) gesture.moved = true;
  },
  onProcessBodyTouchEnd() {
    const gesture = this._processBodyGesture;
    this._processBodyGesture = null;
    if (!gesture || !gesture.moved) return;
    this._processBodyManualKey = gesture.key;
    this._processBodyManualUntil = Date.now() + 800;
  },
  onProcessBodyTouchCancel() {
    this.onProcessBodyTouchEnd();
  },

  toggleFold(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const row = (this.data.rows || []).find(item => item.key === key);
    if (row && row.kind === 'turnProcess' && !row.foldable) return;
    this.prioritizeInteraction();
    const patch = {};
    const next = !this.data.folds[key];
    // Tapping a completed-turn disclosure is an explicit reading action. Stop
    // any delayed tail anchor before rebuilding the virtual window, otherwise
    // the tap can expand successfully and then scroll the row out of view.
    if (row && row.kind === 'turnProcess') {
      this.pauseConversationFollowForReader();
      patch.scrollTarget = '';
    }
    patch['folds.' + key] = next;
    if (row && row.kind === 'processGroup') {
      const rowPath = 'rows[' + this.data.rows.indexOf(row) + ']';
      const source = (this._allConversationRows || []).find(item => item.kind === 'processGroup' && item.key === key) || row;
      patch[rowPath + '.processBodyCapped'] = next
        ? source.processBodyCapWhenExpanded : source.processBodyCapWhenCollapsed;
      // 组体跟着折叠状态整块挂载/卸载：点组头当场展开，不等下一次同步。
      // 详细模式对话过程中组体是自动展开的（processAutoOpen），点组头不改变挂载；
      // 完全展开默认展开，点组头可收起。
      patch[rowPath + '.processBodyVisible'] = next || source.processAutoOpen === true;
      source.processBodyCapped = patch[rowPath + '.processBodyCapped'];
      source.processBodyVisible = patch[rowPath + '.processBodyVisible'];
      // 展开运行中的组：直接跳到最新一步（桌面端 initialize(closed ? top : bottom)）；
      // 收起或展开已收工的组留在顶部。
    }
    // 回合级 disclosure 的折叠会增删它管辖的过程组与叙述行：当时就重算可见行，
    // 不能等下一次同步——流式停顿时就点不开了。
    // _allConversationRows 可能还没建立（首帧直接来自缓存行，或某次同步被异常兜底），
    // 这时回落到最近一次投影/渲染行，保证点「已完成」当场生效而不是没反应。
    const allRows = ((this._allConversationRows || []).some(item => item.key === key) && this._allConversationRows)
      || this._conversationRows || this.data.rows || [];
    if (allRows.some(item => item.kind === 'turnProcess' && item.key === key)) {
      const folds = Object.assign({}, this.data.folds);
      folds[key] = next;
      const visible = allRows.filter(item => {
        if (item.turnProcessKey && !folds[item.turnProcessKey]) return false;
        if (this._compactLiveNarration && item.processNarration === true) return false;
        return true;
      });
      // 详细模式：展开回合时里面各组默认跟着展开（对齐桌面端 history 分组：收工后点开
      // 「已完成」直接看过程）。标准/简洁仍旧只展开到组标题，各组自己点开。
      if (next && this._workStepMode === 'detailed') {
        visible.forEach(row => {
          if (row.kind !== 'processGroup' || folds[row.key]) return;
          folds[row.key] = true;
          row.processBodyVisible = true;
          row.processBodyCapped = row.processBodyCapWhenExpanded === true;
          patch['folds.' + row.key] = true;
        });
      }
      // 只有被点的行不在视口里才需要滚动定位。视口内原地展开即可：
      // scroll-into-view 按估算高度会先落到错误位置，再被实测校正推走，看起来就是
      // 「点了没反应/延迟一大截 + 页面跳一下」。
      let needsFocus = false;
      if (row && row.kind === 'turnProcess') {
        const w = this._conversationWindow;
        const idx = visible.findIndex(item => item.key === key);
        const top = Number(this._lastNativeScrollTop) || 0;
        const height = Number(this._convClientHeight) || 0;
        const offset = w && idx >= 0 ? (w.offsets[idx] || 0) : 0;
        needsFocus = !(height > 0) || offset < top - 40 || offset > top + height + 40;
      }
      Object.assign(patch, this.conversationWindowPatch(visible, needsFocus ? { focusKey: key } : null));
    }
    this.setData(patch, () => {
      if (row && row.kind === 'turnProcess' && next && this._workStepMode === 'detailed') {
        this.scheduleHistoryFormatting();
      }
      this.measureConversationWindow();
      if (next && row && row.kind === 'processGroup' && row.running) this.refreshProcessFollow(row.key);
    });
  },

  /** 过程组滚动容器：用户翻离底部就暂停自动跟随，滚回底部自动恢复。 */
  onProcessBodyScroll(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const gesture = this._processBodyGesture;
    const manualScroll = gesture && gesture.key === key && gesture.moved
      || this._processBodyManualKey === key && (this._processBodyManualUntil || 0) >= Date.now();
    if (!manualScroll) return;
    const detail = e.detail || {};
    const metrics = {
      scrollTop: detail.scrollTop,
      scrollHeight: detail.scrollHeight,
      height: detail.height
    };
    if (manualScroll && Number.isFinite(Number(metrics.scrollTop))) {
      const tops = this._processBodyFollowTops || (this._processBodyFollowTops = Object.create(null));
      tops[key] = Math.max(0, Number(metrics.scrollTop));
    }
    const latestMetrics = this._processBodyScrollMetrics || (this._processBodyScrollMetrics = {});
    latestMetrics[key] = metrics;
    if (!(Number(metrics.height) > 0) && !(Number((this._processBodyHeights || {})[key]) > 0)) {
      this.measureProcessBodyHeight(key);
      return;
    }
    this.updateProcessBodyFollow(key, metrics);
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
      this._thumbPrefetchBudget = 80;
    }
    const queue = this._thumbQueue || (this._thumbQueue = []);
    const queued = this._thumbQueued || (this._thumbQueued = new Set());
    const failed = this._thumbFailed || (this._thumbFailed = new Map());
    const now = Date.now();
    const enqueueRow = (row, budgeted) => {
      if (!row || row.pending) return;
      const images = (row.images || []).concat((row.tools || []).flatMap(tool => tool && tool.resultImages || []));
      images.forEach((image) => {
        if (!image || !image.attachmentId) return;
        const id = String(image.attachmentId);
        if (queued.has(id) || attachmentCache.localPath(image, { api: wx })) return;
        if (budgeted && (this._thumbPrefetchBudget || 0) <= 0) return;
        const failure = failed.get(id);
        if (failure && now < failure.at) return;
        // 本机刚发送的图片已有临时文件：复制进缓存即可，不必再向网关要一遍字节。
        if (!image.tempPath && image.localUrl) return;
        queued.add(id);
        if (budgeted) this._thumbPrefetchBudget = (this._thumbPrefetchBudget || 0) - 1;
        queue.push({ attachmentId: id, mediaType: image.mediaType, name: image.name, tempPath: image.tempPath || '' });
      });
    };
    (this.data.rows || []).forEach((row) => enqueueRow(row, false));
    // 预先缓存已加载历史里的图片（可见行之外），让上滑旧消息时图片直接出现。
    (store.sessionState.rows || []).forEach((row) => enqueueRow(row, true));
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
    const patchImages = images => {
      if (!Array.isArray(images) || !images.length) return images;
      let changed = false;
      const next = images.map((image) => {
        const path = image && paths[image.attachmentId];
        if (!path || image.localUrl === path) return image;
        changed = true;
        return Object.assign({}, image, { localUrl: path });
      });
      return changed ? next : images;
    };
    const patchRow = (row) => {
      if (!row) return row;
      let changed = false;
      const next = Object.assign({}, row);
      const images = patchImages(row.images);
      if (images !== row.images) { next.images = images; changed = true; }
      if (Array.isArray(row.stackImages)) {
        const stackImages = patchImages(row.stackImages);
        if (stackImages !== row.stackImages) { next.stackImages = stackImages; changed = true; }
      }
      if (Array.isArray(row.children)) {
        const children = row.children.map(child => {
          let childChanged = false;
          const childNext = Object.assign({}, child);
          const childImages = patchImages(child.images);
          if (childImages !== child.images) { childNext.images = childImages; childChanged = true; }
          if (Array.isArray(child.tools)) {
            childNext.tools = child.tools.map(tool => {
              const resultImages = patchImages(tool.resultImages);
              if (resultImages === tool.resultImages) return tool;
              return Object.assign({}, tool, { resultImages });
            });
            if (childNext.tools.some((tool, index) => tool !== child.tools[index])) childChanged = true;
          }
          return childChanged ? childNext : child;
        });
        if (children.some((child, index) => child !== row.children[index])) { next.children = children; changed = true; }
      }
      return changed ? next : row;
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
    let image = null;
    const find = images => (images || []).find(item => item && item.attachmentId === id);
    for (const row of this.data.rows || []) {
      image = find(row.images);
      if (!image) for (const child of row.children || []) {
        image = find(child.images);
        if (!image) for (const tool of child.tools || []) image = find(tool.resultImages);
        if (image) break;
      }
      if (image) break;
    }
    image = image || { attachmentId: id };
    const cached = image.localUrl || attachmentCache.localPath(image, { api: wx });
    // 先开弹窗占位（有缓存就直接显示图片），再在弹窗里补下载，进度可见。
    const sheet = this.openFileSheet(Object.assign({}, image, {
      key: id, attachmentId: id, sessionId: store.sessionState.sessionId,
      name: image.name || '图片', mediaType: image.mediaType, size: image.bytes, localPath: cached
    }), { origin: 'message' });
    if (cached || !sheet) {
      if (cached) this.applyAttachmentPaths({ [id]: cached });
      return;
    }
    attachmentCache.fetchImage(store.client, sheet.sessionId, image, { api: wx }).then((path) => {
      if (this._unloaded) return;
      this.applyAttachmentPaths({ [id]: path });
      this.patchFileSheet(sheet.key, { localPath: path, primary: uiText('查看原图'), canShare: this.canShareFiles() });
    }).catch((err) => {
      this.patchFileSheet(sheet.key, { error: (err && err.message) || uiText('附件加载失败') });
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
    return this.openMessageAttachmentItem(att, row.key || rowIndex, attachmentIndex);
  },

  openProcessAttachment(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset || {};
    const sourceKey = dataset.sourceKey;
    const attachmentIndex = Number(dataset.attachmentIndex);
    const sourceRows = store.sessionState && store.sessionState.rows || [];
    let row = sourceRows.find(item => item && item.key === sourceKey);
    let attachments = row && row.attachments;
    if (!attachments) {
      row = sourceRows.find(item => (item.tools || []).some(tool => tool && tool.key === sourceKey));
      const tool = row && (row.tools || []).find(item => item && item.key === sourceKey);
      attachments = tool && tool.resultAttachments;
    }
    const att = Array.isArray(attachments) && Number.isInteger(attachmentIndex) ? attachments[attachmentIndex] : null;
    if (att) return this.openMessageAttachmentItem(att, sourceKey, attachmentIndex);
  },

  openMessageAttachmentItem(att, rowKey, attachmentIndex) {
    if (att.kind === 'directory') {
      wx.showToast({ title: att.path || '工作区目录', icon: 'none' });
      return;
    }
    if (att.attachmentId) {
      this.previewAttachment({ currentTarget: { dataset: { id: att.attachmentId } } });
      return;
    }
    if (att.path && typeof this.openFileSheet === 'function') {
      return this.openFileSheet({
        sessionId: store.sessionState.sessionId,
        path: att.path,
        name: att.name || att.path,
        mediaType: att.mediaType,
        size: att.bytes,
        key: `message-attachment:${rowKey || 'process'}:${attachmentIndex}`
      }, { origin: 'message' });
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
    const raw = String(e.detail.value == null ? '' : e.detail.value);
    const cursor = Number.isInteger(e.detail.cursor) ? e.detail.cursor : raw.length;
    // 指令 token 由蓝色 chip 承载，textarea 只编辑参数；这里再拼回完整草稿。
    const token = this.data.commandToken;
    const current = this.data.draft || '';
    // 重新输入“/”视为换指令：清掉旧 token，让新的斜杠命令接管输入框。
    const keepsToken = !!token && raw.charAt(0) !== '/' && (current === token || current.indexOf(token + ' ') === 0);
    // 引用 chip：textarea 里引用位置是零宽占位符。按编辑前后差分对齐 chips，
    // 再把占位符还原成原始引用文本拼回草稿。
    const prevRefs = this.data.composerRefs || [];
    const edited = composerMenu.applyDisplayEdit(this.composerDisplay(), raw, prevRefs);
    this._composerDisplay = edited.display;
    const body = composerMenu.displayToDraft(edited.display, edited.refs);
    const value = keepsToken ? token + ' ' + body : body;
    this._composerCursor = keepsToken ? token.length + 1 + cursor : cursor;
    this._dismissedCommandDraft = null;
    if (this.data.attachSheetOpen) this.closeAttachMenu();
    // 草稿里有 Markdown 语法时点亮「预览」按钮，提示可以切换渲染视图。
    const hasMarkdown = /(^|\n)\s*(#{1,6} |[-*+] |\d+\. )|\*\*[^*]+\*\*|```|^\s*> /m.test(value);
    // 边输入边渲染：语法一完成就切渲染（键盘不收、焦点不丢，继续打字继续刷新）。
    const patch = { draft: value, composerCursor: this._composerCursor, canSend: !!value.trim() || this.data.images.length > 0, composerPreviewHint: hasMarkdown };
    // 显示值与原生 textarea 不一致时才回写（清掉误入编辑区间的零宽字符）；
    // chips 只在增删引用时才换数组，避免每次按键都重渲染 chip 行。
    if (edited.display !== raw) patch.composerValue = edited.display;
    if (edited.refs !== prevRefs) patch.composerRefs = edited.refs;
    if (!hasMarkdown) {
      this._composerLivePin = null;
      if (this.data.composerPreview) patch.composerPreview = false;
    } else if (this._composerLivePin !== false && !this.data.composerPreview) {
      this._composerPreviewAuto = true;
      // 关键：textarea 的 class 会随 composerPreview 切换，微信在属性变化时
      patch.composerPreview = true;
    }
    this.setData(patch);
    // 预览态下也要跟着输入刷新渲染块（同步渲染层高度，表面不跳动）。
    if (this.data.composerPreview) this.refreshComposerPreview();
    this.syncCommandMenu(value, store.sessionState);
    this.trackFileMention(edited.display, this._composerCursor);
  },

  /** 移除输入框里的指令 token，把参数留在草稿里（chip 上的 ×）。 */
  clearCommandToken() {
    const arg = this.data.draftArg || '';
    this._commandInputId = null;
    this._draftRevision = (this._draftRevision || 0) + 1;
    this.setComposerValue(arg, { draft: arg, canSend: !!arg.trim() || this.data.images.length > 0, composerFocus: true });
    this.syncCommandMenu(arg, store.sessionState);
  },

  /** 移除一个引用 chip：删掉显示值里对应的零宽占位符，草稿里的原始引用一并消失。 */
  removeComposerRef(e) {
    const index = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    const refs = (this.data.composerRefs || []).slice();
    const display = this.composerDisplay();
    const parts = display.split(composerMenu.REF_PLACEHOLDER);
    if (!Number.isInteger(index) || index < 0 || index >= refs.length || parts.length <= index + 1) return;
    refs.splice(index, 1);
    const merged = parts[index] + parts[index + 1];
    const nextDisplay = parts.slice(0, index).concat([merged], parts.slice(index + 2)).join(composerMenu.REF_PLACEHOLDER);
    // 光标落到被删除的 chip 原位（前缀长度 + 前面占位符的个数）。
    const cursor = parts[index].length + index;
    this._draftRevision = (this._draftRevision || 0) + 1;
    this._composerCursor = cursor;
    this.setComposerDisplay(nextDisplay, refs, { composerCursor: cursor, canSend: !!composerMenu.displayToDraft(nextDisplay, refs).trim() || this.data.images.length > 0 }, this.composerSlash());
  },

  /**
   * 程序化改写输入框内容（发送清空 / 切会话恢复 / 插入指令与文本）。
   * 用户打字删除不经过这里：textarea 原生维护自己的内容，避免数据桥回写卡顿。
   * 传入的是原始草稿文本：指令 token 由 chip 承载（textarea 只留参数），
   * 引用 token 还原成 chip 行 + 零宽占位符显示值——否则选一个命令会同时
   * 出现 chip 和原文两份。
   */
  setComposerValue(text, extra) {
    const raw = String(text == null ? '' : text);
    const { display, refs } = composerMenu.referencesToDisplay(raw);
    const slash = this.composerSlash(raw);
    const view = slash ? (display === slash.token ? '' : display.slice(slash.token.length + 1)) : display;
    this.setComposerDisplay(view, composerMenu.referenceChips(refs), extra, slash);
  },

  /** 当前（或指定）草稿对应的指令 token：仅 input 类指令，且草稿确实以它开头。 */
  composerSlash(raw) {
    const text = String(raw == null ? this.data.draft || '' : raw);
    const groups = store.sessionState && store.sessionState.commandGroups;
    return composerMenu.presentation(text, composerMenu.commands(Array.isArray(groups) ? groups : []));
  },

  /**
   * 直接写显示值与引用 chips（钻取目录时的半开引用 token 必须保持字面文本）。
   * 显示值不含指令 token：重建草稿时由 slash 拼回去，语音插入 / 钻取目录
   * 都不会把 token 弄丢。
   */
  setComposerDisplay(display, refs, extra, slash) {
    const view = String(display == null ? '' : display);
    const chips = Array.isArray(refs) ? refs : [];
    const body = composerMenu.displayToDraft(view, chips);
    this._composerDisplay = view;
    const patch = Object.assign({ composerValue: view, composerRefs: chips, draft: slash ? slash.token + ' ' + body : body }, extra || {});
    this.setData(patch);
  },

  /**
   * textarea 的当前显示值。用户打字不往 data.composerValue 回写（避免和原生
   * 输入打架），所以用这个镜像读取；程序化改写时两者由 setComposerDisplay 同步。
   */
  composerDisplay() {
    return this._composerDisplay == null ? String(this.data.composerValue || '') : this._composerDisplay;
  },

  /** 点渲染结果回到编辑：上锁保持原文（光标可见），直到语法消失再出现才重新渲染。 */
  exitComposerPreviewEdit() {
    this._composerPreviewAuto = false;
    this._composerLivePin = false;
    this._composerAutoRev = this._draftRevision;
    if (this._composerAutoPreviewTimer) { clearTimeout(this._composerAutoPreviewTimer); this._composerAutoPreviewTimer = null; }
    this.setData({ composerPreview: false, composerFocus: true });
  },

  /** 输入框 Markdown 预览：把当前草稿按发送后的同一条管线解析成块。 */
  refreshComposerPreview() {
    const text = String(this.data.draft || '');
    this.setData({ composerPreviewBlocks: text.trim() ? safeParse(text) : [] });
  },


  /** 输入框 Markdown 预览：把当前草稿按发送后的同一条管线解析成块。 */

  /** 编辑 ⇄ 预览。进入预览时收起键盘，避免原生输入法盖住渲染结果。 */
  toggleComposerPreview() {
    const next = !this.data.composerPreview;
    if (next && !String(this.data.draft || '').trim()) return;
    if (next) this.refreshComposerPreview();
    this._composerPreviewAuto = false;
    // 手动切回编辑：加锁保持原文，直到语法消失重现。
    if (!next) this._composerLivePin = false;
    this.setData({ composerPreview: next, composerFocused: false, kbHeight: 0, composerPreviewHint: false });
    if (next && this.data.commandMenu) this.setData({ commandMenu: null });
    this.updateDockInset();
  },

  onComposerLineChange(e) {
    // Native textarea reports actual height changes; typing every character must not
    // start another three-pass selector query/retry chain across the data bridge.
    const height = e.detail && e.detail.height;
    if (!Number.isFinite(height) || height === this._composerHeight) return;
    this._composerHeight = height;
    // 连删/快打时 linechange 密集触发：防抖 120ms，避免底部留白来回重算造成抖动。
    if (this._composerLineTimer) clearTimeout(this._composerLineTimer);
    this._composerLineTimer = setTimeout(() => {
      this._composerLineTimer = null;
      this.updateDockInset();
    }, 120);
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
      // _composerCursor 是显示值坐标（引用位置为零宽占位符），判断“光标前有没有
      // 正文”要按显示值算：引用 chip 不算用户输入的正文。
      const display = this.composerDisplay();
      const cursor = Number.isInteger(this._composerCursor) ? Math.max(0, Math.min(display.length, this._composerCursor)) : display.length;
      const filtered = composerMenu.catalog(groups, { t: uiText, dark: this.data.theme === 'dark', query: this.data.commandMenuQuery || (this.data.attachSheetOpen ? '' : query),
        leading: lookup || !display.slice(0, cursor).trim(), canAttach: composerMenu.acceptsAttachments(active), includeSkills: !this.data.attachSheetOpen });
      menu = { type: 'catalog', title: '', groups: filtered, options: [] };
    }
    const ui = active && active.ui || {};
    const hint = ui.displayHint || ui.hint || (active && active.input && active.input.hint) || '';
    const slash = composerMenu.presentation(text, commands);
    this._activeCommand = active;
    const patch = dataPatch(this.data, {
      commandMenu: menu,
      canAttach: composerMenu.acceptsAttachments(active),
      composerPlaceholder: hint || uiText('输入内容, / 调用指令, @ 文件或对话, 或按住说话'),
      commandToken: slash ? slash.token : '',
      commandTokenLabel: slash ? composerMenu.commandLabel(slash.command, uiText) : '',
      draftArg: slash ? slash.argument : text
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
    if (action === 'externalFile') { this.chooseExternalFile(); return; }
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
      this.setComposerValue(insertText, { draft: insertText, canSend: !!insertText.trim(), composerFocus: true });
      this.syncCommandMenu(insertText, store.sessionState);
      return;
    }
    const typed = this.data.draft.startsWith('/') && !this.data.attachSheetOpen;
    const draft = this.data.draft;
    this.closeAttachMenu();
    const line = ui.submitText || ('/' + command.name);
    return this.submitCommand(command, line, [], true).then(result => {
      if (result !== false && typed && this.data.draft === draft && !this._unloaded) this.setComposerValue('', { draft: '', canSend: this.data.images.length > 0, composerPreviewHint: false, composerPreview: false });
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
        if (typed && this.data.draft === typed) this.setComposerValue('', { draft: '', canSend: this.data.images.length > 0, composerPreviewHint: false, composerPreview: false });
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
          // 交给网关队列，在当前回合结束后自动发送。
          const sent = store.client.sendMessage(line, store.sessionState.sessionId,
            store.state.currentWorkspaceId, encodedImages, 'queue', ticket);
          if (sent === false) return false;
          self.jumpToBottom();
          if (!preserveDraft) self.setComposerValue('', { draft: '', images: [], canSend: false, commandMenu: null });
          return true;
        }
        const sent = store.client.sendMessage(line, store.sessionState.sessionId, store.state.currentWorkspaceId, encodedImages, undefined, ticket);
        if (sent !== false) {
          store.appendLocalUserRow(line, []);
          self.jumpToBottom();
        }
        if (sent !== false && !preserveDraft) self.setComposerValue('', { draft: '', images: [], canSend: false, commandMenu: null });
        return sent;
      });
    }
    if (request === 'command-execute') {
      if (this._commandSubmitting) return Promise.resolve(false);
      this._commandSubmitting = true;
      this.setData({ commandLoading: true });
      return store.client.executeCommand(store.sessionState.sessionId, line, encodedImages).then(() => {
        if (this._unloaded || this.composerContextKey() !== context) return false;
        if (!preserveDraft && (this._draftRevision || 0) === revision) this.setComposerValue('', { images: [], canSend: false, commandMenu: null });
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

  chooseExternalFile() {
    if (!this.data.canAttach || this.data.attachmentPicking || this.data.sendingAttachments) return;
    const context = this.composerContextKey();
    this.closeAttachMenu();
    wx.showModal({ title: uiText('外部文件'),
      content: uiText('请先将手机或其他应用中的文件发送到微信聊天或文件传输助手，再从这里选择上传。无需放入远端工作区。'),
      confirmText: uiText('选择文件'),
      success: result => { if (result.confirm && !this._unloaded && this.composerContextKey() === context) this.pickComposerFiles(); } });
  },

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
      let skipped = false;
      for (const file of res.tempFiles || []) {
        if (Number(file.size) > 50 * 1024 * 1024) { skipped = true; continue; }
        const tempPath = file.path || file.tempFilePath;
        if (!tempPath) continue;
        kept.push({ id: util.uuid(), isFile: true, tempPath, name: file.name || 'file', size: Number(file.size) || 0 });
      }
      if (!kept.length) { finish(); wx.showToast({ title: uiText(skipped ? '外部文件不能超过 50 MB' : '未能读取所选文件'), icon: 'none' }); return; }
      if (!current()) { finish(); return; }
      const images = this.data.images.concat(kept).slice(0, 20);
      this.setData({ images, canSend: !!this.data.draft.trim() || images.length > 0, attachmentPicking: false });
      finish();
      if (skipped) wx.showToast({ title: uiText('外部文件不能超过 50 MB'), icon: 'none' });
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
        let tempPath = file.tempFilePath || file.path;
        if (!tempPath) { skipped = true; continue; }
        // 先尝试压缩大图，再检查压缩后的实际文件大小；避免原图超过 8MB 时过早拒绝。
        let originalSize = Number(file.size) || 0;
        const getSize = async path => {
          if (typeof wx.getFileInfo !== 'function') return 0;
          try {
            const info = await new Promise((resolve, reject) => wx.getFileInfo({ filePath: path, success: resolve, fail: reject }));
            return Number(info.size) || 0;
          } catch (_) { return 0; }
        };
        if (!originalSize) originalSize = await getSize(tempPath);
        if (originalSize > 400 * 1024 && typeof wx.compressImage === 'function') {
          const attempts = originalSize > 8 * 1024 * 1024
            ? [{ quality: 65, width: 1600 }, { quality: 50, width: 1280 }, { quality: 35, width: 1024 }]
            : [{ quality: 72, width: 1440 }, { quality: 55, width: 1280 }];
          for (const attempt of attempts) {
            if (!current()) { finish(); return; }
            const compressed = await new Promise(resolve => wx.compressImage({
              src: tempPath, quality: attempt.quality, compressedWidth: attempt.width,
              success: value => resolve(value && value.tempFilePath || ''), fail: () => resolve('')
            }));
            if (compressed) tempPath = compressed;
            const compressedSize = await getSize(tempPath);
            if (compressedSize > 0 && compressedSize <= 8 * 1024 * 1024) break;
          }
        }
        const finalSize = await getSize(tempPath) || originalSize;
        if (finalSize > 8 * 1024 * 1024) { skipped = true; continue; }
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
        kept.push({ id: util.uuid(), tempPath, mediaType, name: file.name || 'image', size: finalSize });
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
    if (image && !image.isFile) this.openFileSheet(image, { origin: 'composer' });
  },

  previewPendingFile(e) {
    const file = this.data.images[Number(e.currentTarget.dataset.index)];
    if (file && file.isFile) this.openFileSheet(file, { origin: 'composer' });
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
      return this.sendExternalFiles(text, images);
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
      const sent = client.sendMessage(
        text,
        s.sessionId,
        workspaceId,
        encoded,
        s.running ? 'queue' : undefined,
        ticket,
        workspaceRefs
      );
      if (sent !== false) {
        if (!s.running) {
          // 普通发送乐观回显；排队消息等网关队列帧，避免提前显示成已发送。
          store.appendLocalUserRow(text, uploadImages.map((image) => ({
            attachmentId: image.id,
            name: image.name,
            mediaType: image.mediaType,
            localUrl: image.tempPath,
            tempPath: image.tempPath
          })), workspaceRefs);
        }
      } else {
        wx.showToast({ title: uiText('发送失败，草稿已保留'), icon: 'none' }); return;
      }
      self.setComposerValue('', { draft: '', images: [], canSend: false });
      this.closeAttachMenu();
      this.jumpToBottom();
    }).catch((err) => {
      if (this._unloaded || this.composerContextKey() !== context) return;
      wx.showToast({ title: err.message || uiText('附件处理失败'), icon: 'none' });
    }).finally(() => { if (!this._unloaded) this.setData({ sendingAttachments: false }); });
  },

  async sendExternalFiles(text, staged) {
    if (this.data.sendingAttachments) return;
    const client = store.client, s = store.sessionState;
    const fail = message => wx.showToast({ title: uiText(message), icon: 'none' });
    if (store.state.connection !== 'connected' || !s.sessionId) return fail('请先连接网关并打开会话');
    if (!(store.state.gatewayCapabilities || []).includes('file-upload-v1')) return fail('当前网关不支持外部文件，请升级并重启网关');
    if (this._activeCommand) return fail('斜杠命令不支持文件，请使用普通消息发送');
    const context = this.composerContextKey(), sessionId = s.sessionId, generation = client.connectGeneration;
    const revision = this._draftRevision || 0;
    const current = () => !this._unloaded && store.client === client && this.composerContextKey() === context
      && client.connectGeneration === generation && (this._draftRevision || 0) === revision;
    const refs = staged.filter(file => file.isWorkspaceRef).map(file => ({ kind: file.workspaceKind, path: file.path, name: file.name }));
    this.setData({ sendingAttachments: true });
    try {
      const ticket = await notifySubscription.requestCompletionTicket();
      if (!current()) return;
      const { uploadFile } = require('./utils/file-upload');
      const receipts = [];
      for (const file of staged.filter(file => file.isFile && !file.isWorkspaceRef)) {
        if (!current()) return;
        const uploaded = await uploadFile(client, file, { api: wx, sessionId, isCurrent: current });
        receipts.push({ receiptId: uploaded.receiptId });
      }
      const images = await Promise.all(staged.filter(file => !file.isFile).map(readImageBase64));
      if (!current()) return;
      // A socket write is not acceptance; preserve the draft until the host ACK.
      await client.requestUpload('message', { sessionId, text, images, files: receipts, attachments: refs,
        clientTimeZone: client.timeZone(), ...(s.running ? { mode: 'queue' } : {}),
        ...(ticket ? { notificationTicket: ticket } : {}) });
      if (!current()) return;
      this.setComposerValue('', { draft: '', images: [], canSend: false });
      this.closeAttachMenu(); this.jumpToBottom();
    } catch (error) {
      if (current()) fail(error.message || error.errMsg || '文件上传失败，草稿已保留');
    } finally {
      if (!this._unloaded) this.setData({ sendingAttachments: false });
    }
  },

  /** 权限行加了箭头后：中文放不下时隐藏，只留图标 + 箭头。用隐形量尺测真实宽度。 */
  schedulePermissionChipFit() {
    if (this._permissionFitTimer || this._unloaded) return;
    if (typeof setTimeout !== 'function' || typeof wx === 'undefined' || !wx.createSelectorQuery) return;
    this._permissionFitTimer = setTimeout(() => {
      this._permissionFitTimer = null;
      this.fitPermissionChip();
    }, 80);
  },

  fitPermissionChip() {
    if (this._unloaded || typeof wx === 'undefined' || !wx.createSelectorQuery) return;
    const query = wx.createSelectorQuery().in(this);
    query.select('.composer-bar').boundingClientRect();
    query.select('.permission-chip').boundingClientRect();
    query.select('.permission-chip .chip-label-probe').boundingClientRect();
    query.select('.permission-chip .chip-label').boundingClientRect();
    query.select('.composer-spacer').boundingClientRect();
    query.exec((results) => {
      if (this._unloaded) return;
      const bar = results && results[0];
      const probe = results && results[2];
      const label = results && results[3];
      const spacer = results && results[4];
      if (!bar || !probe || !probe.width) return;
      const iconOnly = this.data.permissionChipIconOnly === true;
      let next = iconOnly;
      if (iconOnly) {
        if (spacer && spacer.width >= probe.width + 6) next = false;
      } else if (!label || label.width + 0.5 < probe.width) {
        next = true;
      }
      if (next !== iconOnly) this.setData({ permissionChipIconOnly: next });
    });
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
        const inset = Math.round(overlap * 750 / Math.max(info.windowWidth || 375, 1) + 12);
        if (Math.abs(inset - this.data.convBottomInset) > 6) {
          this.setData({ convBottomInset: inset, ...this.layoutPatch({ convBottomInset: inset }) }, () => {
            if (this._convPinned && !this._initialConversationAnchorPending) {
              // Dock changes shorten the scroll viewport; recalculate its exact bottom after layout.
              this.refreshBottomAnchor();
            }
            this.measureConversationViewport();
            this.measureConversationWindow();
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

  onUiLocaleChange() {
    // 投影里含 uiText 生成的文案（如「失败」「运行中」），换语言后旧缓存必须整份丢掉。
    this._projectedRows = null;
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },
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
        { from: '#ctxNodeInputs', to: '#ctxNodeSession', fromSide: 'bottom', fromAt: 0.5, toSide: 'top', toAt: 1 / 3, color: '#00C950' },
        { from: '#ctxNodeEvents', to: '#ctxNodeSession', fromSide: 'bottom', fromAt: 0.5, toSide: 'top', toAt: 2 / 3, color: '#AD46FF' },
        { from: '#ctxNodeTools', to: '#ctxNodeSession', fromSide: 'top', fromAt: 0.5, toSide: 'bottom', toAt: 1 / 3, color: '#00BBA7' },
        { from: '#ctxNodeNet', to: '#ctxNodeSession', fromSide: 'top', fromAt: 0.5, toSide: 'bottom', toAt: 2 / 3, color: '#F6339A' }
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
        const pathKey = link.from + '>' + link.to;
        // Dense short pieces approximate one continuous Bezier ribbon; 16 long capsules read as a spring.
        const steps = 40;
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
            pathKey: pathKey,
            step: i,
            style: `left:${left}px;top:${top - 7}px;width:${length + 0.5}px;${common}`
          });
          if (i % 4 === 1) {
            const dashStart = pointAt((i + 0.25) / steps);
            // dash：1.5px 细线 + 2/9 的流动虚线（对齐 dsh-context .lc-flow-dash）。
            segments.push({
              key: link.from + '>' + link.to + ':d:' + i,
              kind: 'dash',
              pathKey: pathKey,
              step: i,
              style: `left:${dashStart.x}px;top:${dashStart.y - 1}px;width:${Math.max(2, length * 0.9)}px;transform:rotate(${angle}deg);transform-origin:0 50%;`
                + `background-image:repeating-linear-gradient(90deg,${link.color} 0 2px,transparent 2px 9px);animation-delay:${i * 28}ms;`
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
    // 行的来源集合必须在清空 preview 前捕获：预览内「下级子智能体」的行
    // 归属于被预览会话，顶层列表的行归属于当前会话。
    const previousPreview = this.data.collaborationPreview || {};
    const fromPreviewChildren = (previousPreview.children || []).some(item=>item.id===id);
    const previewSessionId = previousPreview.id || '';
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
      // 子智能体会话必须带持久父地址：父会话是它在 subagentCatalog 里的归属会话
      const childMode = ['one-shot','continuable','unknown'].includes(row.mode) ? row.mode : '';
      const parent = childMode
        ? { parentSessionId: fromPreviewChildren ? previewSessionId : sessionId, mode: childMode }
        : null;
      const frame=await Promise.race([client.inspectSession(id, parent), timeout]); if(!current())return;
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
    let navigationReset = {};
    if (this._traceNavigationSessionId !== this._renderSessionId) {
      this._traceNavigationSessionId = this._renderSessionId;
      navigationReset = { traceFocusMode: 'duration', traceFocusTurn: null, traceFocusKey: '', traceFocusTouched: false,
        traceCursorVisible: false, traceCursorPercent: 0, traceScrollTarget: '', traceHighlightedKey: '', traceMetricTargetKey: '' };
    }
    if (this._traceSource !== source || this._traceLocale !== locale || this._traceRenderSessionId !== this._renderSessionId) {
      this._traceSource = source;
      this._traceLocale = locale;
      this._traceRenderSessionId = this._renderSessionId;
      this._traceByKey = new Map();
      source.forEach(row => { this._traceByKey.set(row.key, row); if (row.request) this._traceByKey.set(row.request.key, row.request); });
      this._traceList = source.map(trajectoryView.listRow);
      this._traceOffsets = new Array(this._traceList.length + 1);
      this._traceIndexByKey = new Map();
      this._traceOffsets[0] = 0;
      this._traceList.forEach((row, index) => {
        this._traceOffsets[index + 1] = this._traceOffsets[index] + (row.kind === 'turn' ? TRACE_TURN_HEIGHT_RPX : TRACE_EVENT_ROW_HEIGHT_RPX);
        if (row.kind === 'event') this._traceIndexByKey.set(row.key, index);
      });
      this._traceTotalRpx = this._traceOffsets[this._traceList.length] || 0;
      this._traceWindowStart = 0;
    }
    const focus = {
      mode: navigationReset.traceFocusMode || this.data.traceFocusMode || 'duration',
      turn: Object.prototype.hasOwnProperty.call(navigationReset, 'traceFocusTurn') ? navigationReset.traceFocusTurn : this.data.traceFocusTurn,
      key: Object.prototype.hasOwnProperty.call(navigationReset, 'traceFocusKey') ? navigationReset.traceFocusKey : this.data.traceFocusKey,
      touched: navigationReset.traceFocusKey === '' ? false : this.data.traceFocusTouched
    };
    const focusSignature = [focus.mode, focus.turn, focus.key, focus.touched === true].join('|');
    if (this._traceOverviewSource !== this._traceList || this._traceOverviewFocus !== focusSignature) {
      this._traceOverviewSource = this._traceList;
      this._traceOverviewFocus = focusSignature;
      this._traceOverview = trajectoryView.overview(this._traceList, focus);
    }
    const windowPatch = this.traceWindowPatch(this._traceWindowStart || 0);
    return { ...windowPatch, traceOverview: this._traceOverview, ...navigationReset, ...this.traceSelectionPatch(source) };
  },

  traceWindowPatch(start) {
    const rows = this._traceList || this.data.trajectory || [];
    const maxStart = Math.max(0, rows.length - TRACE_WINDOW_ROWS);
    const windowStart = Math.max(0, Math.min(maxStart, Math.floor(start || 0)));
    const windowEnd = Math.min(rows.length, windowStart + TRACE_WINDOW_ROWS);
    this._traceWindowStart = windowStart;
    return {
      trajectory: rows.slice(windowStart, windowEnd),
      traceSpacerTopRpx: this._traceOffsets ? this._traceOffsets[windowStart] : 0,
      traceSpacerBottomRpx: this._traceOffsets ? Math.max(0, this._traceTotalRpx - this._traceOffsets[windowEnd]) : 0,
      traceTotalCount: rows.length
    };
  },

  onTraceListScroll(e) {
    if (!this._traceOffsets || !this._traceList || this._traceList.length <= TRACE_WINDOW_ROWS) return;
    let width = 375;
    try { width = wx.getSystemInfoSync().windowWidth || width; } catch (_) { /* use a typical mobile viewport */ }
    const scrollTopRpx = Math.max(0, Number(e.detail && e.detail.scrollTop) || 0) * 750 / width;
    let low = 0, high = this._traceList.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this._traceOffsets[mid] <= scrollTopRpx) low = mid + 1;
      else high = mid;
    }
    const rowIndex = Math.max(0, low - 1);
    const nextStart = Math.max(0, Math.min(this._traceList.length - TRACE_WINDOW_ROWS, rowIndex - TRACE_WINDOW_OVERSCAN));
    if (Math.abs(nextStart - (this._traceWindowStart || 0)) < 12) return;
    this.setData(this.traceWindowPatch(nextStart));
  },

  traceItem(key) {
    if (this._traceByKey) return this._traceByKey.get(key);
    for (const row of this._traceList || this.data.trajectory || []) {
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
    return { traceDetail: { key: row.key, label: row.label, badge: row.badge, badgeClass: String(row.badge || '').toLowerCase(), displayBadge: row.displayBadge, seqLabel: String(row.seqLabel || row.seq || '') },
      traceDetailTabs: tabs, traceDetailTab: active.id, traceDetailSection: cache.sections[active.id] };
  },

  traceSelectionPatch(rows) {
    if (!this.data.traceDetail) return {};
    const item = this._traceByKey ? this._traceByKey.get(this.data.traceDetail.key)
      : rows.reduce((found, row) => found || (row.key === this.data.traceDetail.key ? row : row.request && row.request.key === this.data.traceDetail.key ? row.request : null), null);
    if (!item || (this._traceSessionId && this._traceSessionId !== this._renderSessionId)) return { traceDetail: null, traceDetailTabs: [], traceDetailSection: null };
    return this.traceDetailPatch(item, this.data.traceDetailTab);
  },
  selectTraceMetric(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!['duration', 'turns', 'calls'].includes(mode)) return;
    const rows = this._traceList || this.data.trajectory || [];
    const focused = rows.find(row => row.kind === 'event' && row.key === this.data.traceFocusKey);
    let turn = null;
    let key = '';
    if (mode === 'turns') {
      const turns = Array.from(new Set(rows.filter(row => row.kind === 'event' && row.turn != null).map(row => row.turn)));
      const currentIndex = turns.indexOf(this.data.traceFocusTurn);
      if (this.data.traceFocusMode === 'turns' && currentIndex >= 0) turn = turns[(currentIndex + 1) % turns.length];
      else if (focused && focused.turn != null) turn = focused.turn;
      else turn = turns.length ? turns[turns.length - 1] : null;
    } else if (mode === 'calls') {
      const calls = rows.filter(row => row.kind === 'event' && ['TOOL', 'SUBTOOL'].includes(row.badge));
      const currentIndex = calls.findIndex(row => row.key === this.data.traceFocusKey);
      if (this.data.traceFocusMode === 'calls' && currentIndex >= 0) key = calls[(currentIndex + 1) % calls.length].key;
      else if (focused && ['TOOL', 'SUBTOOL'].includes(focused.badge)) key = focused.key;
      else if (calls.length) key = calls[calls.length - 1].key;
    }
    const focus = { mode, turn, key, touched: false };
    const overview = trajectoryView.overview(rows, focus);
    this._traceOverviewSource = this._traceList;
    this._traceOverviewFocus = [mode, turn, key, false].join('|');
    this._traceOverview = overview;
    const selected = overview.lanes.reduce((found, lane) => found || lane.segments.find(segment => segment.key === key), null);
    this.setData({ traceFocusMode: mode, traceFocusTurn: turn, traceFocusKey: key, traceFocusTouched: false,
      traceCursorVisible: !!selected, traceCursorPercent: selected ? selected.centerPct : this.data.traceCursorPercent,
      traceOverview: overview });
  },
  openTraceDetail(e) {
    const item = this.traceItem(e.currentTarget.dataset.key);
    if (!item || item.kind !== 'event') return;
    this._traceSessionId = this._renderSessionId;
    this.setData({ ...this.traceDetailPatch(item, 'summary'), traceThinkingExpanded: false, traceMetricTargetKey: '' });
  },
  openTraceRequest(e) {
    const row = this.traceItem(e.currentTarget.dataset.key);
    if (!row || !row.request) return;
    this._traceSessionId = this._renderSessionId;
    this.setData({ ...this.traceDetailPatch(row.request, 'summary'), traceThinkingExpanded: false, traceMetricTargetKey: '' });
  },
  applyTraceFocus(focus, cursorPercent) {
    const overview = trajectoryView.overview(this._traceList || this.data.trajectory || [], { ...focus, touched: true });
    const selected = overview.lanes.reduce((found, lane) => found || lane.segments.find(segment => segment.key === focus.key), null);
    const cursor = Number.isFinite(cursorPercent) ? Math.max(0, Math.min(100, cursorPercent)) : selected && selected.centerPct;
    this._traceOverviewSource = this._traceList;
    this._traceOverviewFocus = [focus.mode, focus.turn, focus.key, true].join('|');
    this._traceOverview = overview;
    this.setData({ traceFocusMode: focus.mode, traceFocusTurn: focus.turn, traceFocusKey: focus.key,
      traceFocusTouched: true, traceCursorVisible: !!selected,
      traceCursorPercent: selected ? cursor : this.data.traceCursorPercent,
      traceOverview: overview });
  },
  jumpToTrace(e) {
    const key = e.currentTarget.dataset.key;
    const row = (this._traceList || this.data.trajectory || []).find(item => item.key === key && item.kind === 'event');
    if (!row) return;
    const mode = this.data.traceFocusMode || 'duration';
    this.applyTraceFocus({ mode, turn: mode === 'turns' ? row.turn : this.data.traceFocusTurn, key });
    this.jumpToTraceKey(key, true);
  },
  jumpToTraceKey(key, keepTarget) {
    const rows = this._traceList || this.data.trajectory || [];
    const indexed = this._traceIndexByKey && this._traceIndexByKey.get(key);
    const index = indexed == null ? rows.findIndex(row => row.key === key) : indexed;
    if (index == null || index < 0) return;
    const windowStart = this._traceWindowStart || 0;
    const nextStart = index < windowStart || index >= windowStart + TRACE_WINDOW_ROWS
      ? Math.max(0, Math.min(rows.length - TRACE_WINDOW_ROWS, index - 20)) : windowStart;
    this.setData({ ...this.traceWindowPatch(nextStart), traceScrollTarget: '', traceHighlightedKey: key, traceMetricTargetKey: keepTarget ? key : '' });
    if (this._traceHighlightTimer) clearTimeout(this._traceHighlightTimer);
    wx.nextTick(() => { if (!this._unloaded) this.setData({ traceScrollTarget: 'trace-' + key }); });
    this._traceHighlightTimer = setTimeout(() => {
      if (!this._unloaded && this.data.traceHighlightedKey === key) this.setData({ traceHighlightedKey: '' });
    }, 1200);
  },

  traceTimelineX(e) {
    const point = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    if (point && Number.isFinite(point.clientX)) return { x: point.clientX, local: false };
    if (e.detail && Number.isFinite(e.detail.clientX)) return { x: e.detail.clientX, local: false };
    if (e.detail && Number.isFinite(e.detail.x)) return { x: e.detail.x, local: true };
    return null;
  },
  measureTraceTrack(callback) {
    if (this._traceTrackRect) { callback(this._traceTrackRect); return; }
    if (typeof wx.createSelectorQuery !== 'function') return;
    this._traceTrackCallbacks = this._traceTrackCallbacks || [];
    this._traceTrackCallbacks.push(callback);
    if (this._traceTrackQueryPending) return;
    this._traceTrackQueryPending = true;
    let query = wx.createSelectorQuery();
    if (query.in) query = query.in(this);
    query.select('.trace-overview-track').boundingClientRect(rect => {
      this._traceTrackQueryPending = false;
      if (this._unloaded) { this._traceTrackCallbacks = []; return; }
      if (rect && rect.width) {
        this._traceTrackRect = rect;
        (this._traceTrackCallbacks || []).splice(0).forEach(done => done(rect));
      } else this._traceTrackCallbacks = [];
    }).exec();
  },
  traceTimelinePercent(e, callback) {
    const point = this.traceTimelineX(e);
    if (!point) return;
    this.measureTraceTrack(rect => {
      const x = point.local ? rect.left + point.x : point.x;
      callback(Math.max(0, Math.min(100, (x - rect.left) / rect.width * 100)));
    });
  },
  traceTimelineCursor(percent) {
    this._traceCursorPending = percent;
    if (this._traceCursorTimer) return;
    this._traceCursorTimer = setTimeout(() => {
      this._traceCursorTimer = null;
      if (this._unloaded || this._traceCursorPending == null) return;
      this.setData({ traceCursorVisible: true, traceCursorPercent: this._traceCursorPending });
      this._traceCursorPending = null;
    }, 32);
  },
  onTraceTimelineTouchStart(e) {
    const point = this.traceTimelineX(e);
    this._traceTimelineGesture = { startX: point && point.x, moved: false, percent: null, lane: e.currentTarget.dataset.lane };
    this.traceTimelinePercent(e, percent => {
      if (!this._traceTimelineGesture) return;
      this._traceTimelineGesture.percent = percent;
      this.setData({ traceCursorVisible: true, traceCursorPercent: percent });
    });
  },
  onTraceTimelineTouchMove(e) {
    const gesture = this._traceTimelineGesture;
    if (!gesture) return;
    const point = this.traceTimelineX(e);
    if (point && gesture.startX != null && Math.abs(point.x - gesture.startX) > 5) gesture.moved = true;
    this.traceTimelinePercent(e, percent => {
      if (this._traceTimelineGesture !== gesture) return;
      gesture.percent = percent;
      this.traceTimelineCursor(percent);
    });
  },
  onTraceTimelineTouchEnd(e) {
    const gesture = this._traceTimelineGesture;
    this._traceTimelineGesture = null;
    if (!gesture) return;
    this._traceTimelineSuppressTap = true;
    setTimeout(() => { this._traceTimelineSuppressTap = false; }, 100);
    const finish = percent => {
      if (this._traceCursorTimer) clearTimeout(this._traceCursorTimer);
      this._traceCursorTimer = null;
      this._traceCursorPending = null;
      this.selectTraceAtPercent(percent, gesture.lane);
    };
    this.traceTimelinePercent(e, finish);
    if (!this.traceTimelineX(e) && Number.isFinite(gesture.percent)) finish(gesture.percent);
  },
  onTraceTimelineTouchCancel() {
    this._traceTimelineGesture = null;
    if (this._traceCursorTimer) clearTimeout(this._traceCursorTimer);
    this._traceCursorTimer = null;
    this._traceCursorPending = null;
  },
  onTraceTimelineTap(e) {
    if (this._traceTimelineSuppressTap) { this._traceTimelineSuppressTap = false; return; }
    this.traceTimelinePercent(e, percent => this.selectTraceAtPercent(percent, e.currentTarget.dataset.lane));
  },
  selectTraceAtPercent(percent, laneId) {
    const row = trajectoryView.nearestOverviewEvent(this._traceList || this.data.trajectory || [],
      { mode: this.data.traceFocusMode || 'duration', turn: this.data.traceFocusTurn, key: this.data.traceFocusKey }, laneId, percent);
    if (!row) return;
    const focus = { mode: this.data.traceFocusMode || 'duration', turn: this.data.traceFocusTurn, key: row.key };
    this.applyTraceFocus(focus, percent);
    this.jumpToTraceKey(row.key, true);
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
