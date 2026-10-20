const { t: uiText } = require('../../utils/ui-preferences');
const haptics = require('../../utils/haptics');
const preferences = require('../../utils/ui-preferences');
const trajectoryView = require('../../utils/trajectory-presentation');
const workSteps = require('../../utils/work-step-presentation');
const statusAppearance = require('../../utils/status-appearance');
const procIconStyle = require('../../utils/proc-icon-style');
const store = require('../../utils/store');
const markdown = require('../../utils/markdown');
const labels = require('../../utils/labels');
const util = require('../../utils/util');
const notifyPref = require('../../utils/notify-pref');
const voicePreference = require('../../utils/voice-preference');
const voiceActions = require('./voice-actions');
const fileActions = require('./file-actions');
const changesActions = require('./changes-actions');
const collaboration = require('../../utils/collaboration');
const protocol = require('../../utils/protocol');
const fileDeliverables = require('../../utils/file-deliverables');
const theme = require('../../utils/theme');
const conversationWorkflow = require('../../utils/conversation-workflow');
const composerMenu = require('../../utils/composer-menu');
const sessionSwitcher = require('../../utils/session-switcher');
const { dataPatch, createMarkdownCache } = require('../../utils/session-render');

// 订阅消息模板 ID：与设置页保持一致；留空则发送时不申请授权。
const NOTIFY_TEMPLATE_ID = 'QvgkQ88HKFdTNPJVOp0EdOHNDodOQACzB9oDEFDZXKU';

const { toolPresentation } = require('../../utils/tool-presentation');

Page({
  ...voiceActions,
  ...fileActions,
  ...changesActions,
  data: {
    collaborationOpen: false, collaborationExpanded: false, collaborationTab: 'members', collaborationRows: [], collaborationTabs: [],
    collaborationCount: 0, collaborationActive: 0, collaborationNote: '', collaborationPreview: null, collaborationBusy: false,
    fileExpanded: {}, fileSheet: null, filePreview: null, changesDiff: null, fileBusyKey: '', fileSharingKey: '', fileProgress: 0,
    tab: 'conversation', // conversation | trajectory
    trajectoryMounted: false,
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
    turnNavWidths: [],
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
        navPadTop: rect && rect.top ? Math.max(rect.top + 3, sbH + 3) : sbH + 7,
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
    if (this.data.commandMenu) this.closeAttachMenu();
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({ collaborationOpen:false, collaborationPreview:null, collaborationBusy:false });
    this.cancelFileDownload();
    this._voiceHidden = true; this.cancelVoice();
    if (this._storeSyncTimer) clearTimeout(this._storeSyncTimer);
    this._storeSyncTimer = null; this._pendingStoreSnapshot = null;
    this.stopScrollPolling();
  },

  onShow() {
    this._voiceHidden = false; this.syncVoicePreference();
    this.startScrollPolling();
    if (store.sessionState && store.sessionState.sessionId) this.syncFromStore({ app: store.state, session: store.sessionState });
    this.setData(statusAppearance.view(statusAppearance.read()));
    this.setData(procIconStyle.view(procIconStyle.read()));
    // 返回前台/切回页面：dock 高度可能变化（键盘、队列、审批卡）
    this.updateDockInset();
  },

  onUnload() {
    this._commandRequest = null; this._commandOptionRequest = null; this._attachmentRequest = null; this._filesRequest = null;
    this._collaborationRequest = null;
    this._collaborationRefresh = null;
    this.disposePresentedFiles();
    this.cancelVoice();
    if (this._voice) this._voice.dispose();
    this._unloaded = true;
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

  scheduleStoreSync(snapshot) {
    if (this._unloaded || this._voiceHidden) return;
    this._pendingStoreSnapshot = snapshot;
    if (this._storeSyncTimer) return;
    const delay = Math.max(32, (this._interactionUntil || 0) - Date.now());
    this._storeSyncTimer = setTimeout(() => {
      this._storeSyncTimer = null;
      const latest = this._pendingStoreSnapshot;
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
          images: row.images || []
        }));
        this.setData({ rows: fallbackRows, running: s.running === true });
      } catch (e2) { /* 放弃 */ }
    }
  },

  syncFromStoreInner(snapshot) {
    this.checkVoiceContext();
    if (this._composerContextKey && this._composerContextKey !== this.composerContextKey()) {
      this._commandRequest = null; this._commandOptionRequest = null; this._attachmentRequest = null;
      this._commandOptionName = ''; this._commandOptions = [];
      this.setData({ attachSheetOpen: false, commandMenu: null, commandMenuQuery: '', commandPaletteLoading: false, commandPaletteError: '', attachmentPicking: false });
      if (this.data.fileReferenceMode) this.closeFilesSheet();
    }
    this._composerContextKey = this.composerContextKey();
    const s = snapshot.session;
    const app = snapshot.app;
    if (!s || (!s.sessionId && s.historyState !== 'creating' && s.historyState !== 'error:create')) return;
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
    (s.rows || []).forEach((row) => {
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
          blocks: this._markdownCache.parse(row.key, row.text || ''),
          images: row.images || [],
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
        copy.images = row.images || [];
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
    // Hidden trajectory stays out of the view bridge while the conversation streams.
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
    const processFolds = workSteps.apply(rows, workPrefs, this.data.folds, this.data.rows, this._workPolicyKey !== policyKey);
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
      row.copyText = nextConv === 'assistant' ? '' : (row.text || '');
    });

    // 顶部标题：实时标题优先；其次回查会话列表（直连打开/列表迟到时）；
    // 都没有则显示「会话」（新会话等 Host 生成标题后经 title 帧实时更新）
    const listed = (app.sessions || []).find((x) => x.sessionId === s.sessionId) || null;
    const fallbackTitle = (listed && (listed.title || listed.snippet)) || (s.historyState === 'creating' ? uiText('新会话') : uiText('会话'));

    const viewPatch = dataPatch(this.data, Object.assign({
      ...this.collaborationPatch(s, app),
      navTitle: s.title || fallbackTitle,
      presetLabel: labels.presetModeName(s.agentPreset || 'standard'),
      sessionPresetVisible: presetVisible,
      sessionPresetName: presetName || uiText('选择模式'),
      running: s.running === true,
      lastRowKind: rows.length ? rows[rows.length - 1].kind : '',
      rows: rows,
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
    if (Object.keys(viewPatch).length) this.setData(viewPatch);
    this.loadChangesSummaries();
    this.syncCommandMenu(this.data.draft, s);
    if (dockChanged) this.updateDockInset();
    this.syncRunningStrip(rows, this.data.running);
    const he = store.sessionState.historyError || '';
    if (he !== this.data.histError) this.setData({ histError: he });
    const hs = String(s.historyState || 'idle');
    if (hs !== this.data.historyState) this.setData({ historyState: hs });
    const historyLoading = hs === 'requested' && !rows.length && !this.data.running;
    const historyLoaded = hs.indexOf('loaded') === 0 || hs === 'idle' || hs.indexOf('error') === 0;
    // 对齐 iOS historyProgressText
    const loadedMatch = /loaded:(\d+)ev/.exec(hs);
    const historyProgressText = hs === 'requested'
      ? uiText('正在从 Mobile Gateway 同步会话内容…')
      : (loadedMatch ? uiText('正在加载历史记录 · ') + loadedMatch[1] + uiText(' 个事件') : uiText('正在从 Mobile Gateway 同步会话内容…'));
    if (historyLoading !== this.data.historyLoading || historyLoaded !== this.data.historyLoaded
      || historyProgressText !== this.data.historyProgressText) {
      this.setData({
        historyLoading: historyLoading,
        historyLoaded: historyLoaded,
        historyProgressText: historyProgressText
      });
    }
    const cs = app.connection || 'disconnected';
    if (cs !== this.data.connState) this.setData({ connState: cs });
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
    let q = (s.queue || []).map((it, index) => {
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
    const pending = this._pendingQueue || [];
    const unmatched = pending.slice();
    q.forEach((item) => {
      if (!item.rawText) return;
      const match = unmatched.findIndex((candidate) => candidate.rawText === item.rawText);
      if (match >= 0) unmatched.splice(match, 1);
    });
    q = q.concat(unmatched);
    if (JSON.stringify(q) !== JSON.stringify(this._lastQueue || [])) {
      this._lastQueue = q;
      this.setData({ queue: q, queueSending: q.some((item) => !!item.statusText) });
      this.updateDockInset();
    }

    if (this.data._titleDirty) {
      this.setData({ _titleDirty: false });

    }

    // 新内容到达时贴底；但用户正在触摸列表时不要抢滚动
    const touchingRecently = Date.now() - (this._lastTouchAt || 0) < 1000;
    if ((rowsChanged || justFinished) && this.data.tab === 'conversation' && this._convPinned !== false && !touchingRecently) {
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

  rememberQueuedSubmission(text, images) {
    if (!store.sessionState.running || !text) return;
    const attachments = (images || []).map((image, index) => ({
      key: 'pending:' + index + ':' + (image.name || 'attachment'),
      type: String(image.mediaType || '').indexOf('image/') === 0 ? 'image' : 'file',
      url: image.previewUrl || image.tempPath || '',
      name: image.name || uiText('附件')
    })).filter((item) => item.type !== 'image' || item.url);
    this._pendingQueue = (this._pendingQueue || []).concat([{
      id: 'pending-' + util.uuid(),
      rawText: text,
      preview: text.replace(/\s+/g, ' ').trim(),
      attachmentCount: attachments.length,
      attachments: attachments,
      statusText: uiText('发送中…'),
      editable: false
    }]);
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
    if (!['conversation', 'trajectory'].includes(tab) || tab === this.data.tab) return;
    this.cancelVoice();
    this.closeAttachMenu(false);
    this.prioritizeInteraction();
    const hadKeyboard = this.data.kbHeight > 0 || this.data.composerFocused;
    this._collaborationRequest = null; this._collaborationRefresh = null;
    this.setData({ tab, collaborationOpen:false, collaborationPreview:null, collaborationBusy:false, kbHeight: 0, composerFocused: false, showJump: false,
      ...(tab === 'trajectory' ? { trajectoryMounted: true, ...dataPatch(this.data, this.trajectoryPatch()) } : {}),
      statsPopOpen: false, showContextSheet: false, commandMenu: null,
      attachSheetOpen: false, modelSheetOpen: false, effortSheetOpen: false,
      permissionSheet: [], modeSheet: [], ...this.layoutPatch({ kbHeight: 0 }) });
    if (hadKeyboard && typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    if (tab === 'conversation') {
      this.updateDockInset();
      this.startScrollPolling();
      // Mounted scroll views retain their position; do not force a jump on every switch.
      if (this._convPinned !== false) wx.nextTick(() => this.refreshBottomAnchor());
    } else {
      this.stopScrollPolling();
    }
  },

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
      this.setData({ filesLoading: false, filesError: uiText('请先连接驭鲸 Harness'), filesEntries: [] });
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
      const reference = composerMenu.fileReference(item.path);
      if (!reference) { wx.showToast({ title: uiText('无法引用此文件路径'), icon: 'none' }); return; }
      const draft = this.data.draft, cursor = Number.isInteger(this._composerCursor) ? Math.max(0, Math.min(draft.length, this._composerCursor)) : draft.length;
      const before = draft.slice(0, cursor), after = draft.slice(cursor);
      const value = before + (before && !/\s$/.test(before) ? ' ' : '') + reference + ' ' + after;
      this._draftRevision = (this._draftRevision || 0) + 1;
      this.closeFilesSheet();
      this.setData({ draft: value, canSend: true, composerFocus: true });
      this.syncCommandMenu(value, store.sessionState);
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
    if (this._unloaded || this.data.tab !== 'conversation' || this.data.moreSheetOpen || this.data.collaborationOpen) return;
    if (this._scrollPollPending) return;
    this._scrollPollPending = true;
    const query = wx.createSelectorQuery().in(this);
    query.select('.conversation').boundingClientRect();
    query.select('.conversation').scrollOffset();
    query.select('.conversation-inner').boundingClientRect();
    query.exec((res) => {
      this._scrollPollPending = false;
      if (this._unloaded || this.data.tab !== 'conversation' || this.data.moreSheetOpen || this.data.collaborationOpen) return;
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
  openTurnNavigator() {
    // 对齐 DSH 客户端右侧对话大纲：标题＝用户发送内容，正文＝该轮助手的回答
    const rows = (this.data.rows || []);
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
        full: replyPreview || turn.sent
      };
    }).reverse();
    this._turnScrollTop = 0;
    this.setData({
      turnNavOpen: true,
      turnNavItems: items,
      turnNavActiveIndex: -1,
      turnNavWidths: items.map(() => 30),
      turnNavPreview: null
    });
    setTimeout(() => this.measureTurnRail(), 60);
  },

  measureTurnRail() {
    const query = wx.createSelectorQuery();
    let windowWidth = 375;
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      windowWidth = Number(info && info.windowWidth) || windowWidth;
    } catch (e) { /* 忽略 */ }
    query.select('#turn-scrub-list').boundingClientRect((rect) => {
      if (!rect || rect.height <= 0) return;
      // 行高：未选中单行 72rpx，选中展开 112rpx
      this._turnListRect = {
        top: rect.top,
        height: rect.height,
        rowHeight: 76 * windowWidth / 750,
        activeRowHeight: 128 * windowWidth / 750
      };
    }).exec();
    // 找当前对话正在看的位置：视口内第一条用户消息，默认高亮它
    query.select('.conversation').boundingClientRect((conv) => {
      query.selectAll('.row-user').boundingClientRect((rows) => {
        if (!conv || !rows || !rows.length) return;
        const total = (this.data.turnNavItems || []).length;
        if (!total) return;
        let firstVisible = rows.length - 1;
        for (let i = 0; i < rows.length; i += 1) {
          if (rows[i].bottom > conv.top + 12) { firstVisible = i; break; }
        }
        // items 是倒序（最新在上），用户行是正序
        const index = Math.max(0, Math.min(total - 1, total - 1 - firstVisible));
        if (this.data.turnNavActiveIndex < 0) this.applyTurnIndex(index);
      }).exec();
    }).exec();
  },

  turnIndexAt(clientY) {
    const rect = this._turnListRect;
    const items = this.data.turnNavItems || [];
    if (!rect || !items.length || !rect.rowHeight) return -1;
    const localY = clientY - rect.top + (this._turnScrollTop || 0);
    const active = this.data.turnNavActiveIndex;
    let cursor = 0;
    for (let i = 0; i < items.length; i += 1) {
      const height = i === active ? (rect.activeRowHeight || rect.rowHeight) : rect.rowHeight;
      if (localY < cursor + height) return i;
      cursor += height;
    }
    return items.length - 1;
  },

  onTurnListScroll(e) {
    this._turnScrollTop = Number(e.detail && e.detail.scrollTop) || 0;
  },

  applyTurnIndex(index) {
    const items = this.data.turnNavItems || [];
    const item = items[index];
    if (!item) return;
    if (index === this.data.turnNavActiveIndex) return;
    // 选中行横线最长，上下按距离逐步缩短到恒定长度
    const widths = items.map((entry, i) => {
      const distance = Math.abs(i - index);
      if (distance === 0) return 112;
      return Math.max(30, 112 - distance * 16);
    });
    const patch = {
      turnNavActiveIndex: index,
      turnNavWidths: widths
    };
    haptics.vibrate();
    this.setData(patch);
  },

  onTurnScrubStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (!this._turnRailRect) this.measureTurnRail();
    const index = this.turnIndexAt(touch.clientY);
    if (index >= 0) this.applyTurnIndex(index);
  },

  onTurnScrubMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const index = this.turnIndexAt(touch.clientY);
    if (index >= 0) this.applyTurnIndex(index);
  },

  onTurnScrubEnd() {
    const index = this.data.turnNavActiveIndex;
    const items = this.data.turnNavItems || [];
    const item = items[index];
    if (!item || !item.key) return;
    this.setData({ turnNavOpen: false, turnNavActiveIndex: -1, turnNavPreview: null, scrollTarget: '', scrollAnim: true }, () => {
      wx.nextTick(() => {
        this.setData({ scrollTarget: item.key });
        this._turnJumpTimer = setTimeout(() => {
          this._convPinned = false;
          this.setData({ scrollAnim: false });
        }, 400);
      });
    });
  },

  closeTurnNavigator() {
    this.setData({ turnNavOpen: false, turnNavPreview: null });
  },

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

  jumpToBottom() {
    this._convPinned = true;
    this._lastTouchAt = 0;
    this._userScrolledUp = false;
    this._lastScrollTop = undefined;
    if (this.data.showJump) this.setData({ showJump: false });
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
    this.setData(patch);
  },

  copyCode(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.text || '' });
  },

  previewAttachment(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rows.find((r) => (r.images || []).some((img) => img.attachmentId === id));
    const img = row && row.images.find((i) => i.attachmentId === id);
    if (img && img.localUrl) {
      wx.previewImage({ urls: [img.localUrl] });
      return;
    }
    // 按需从网关拉取图片附件
    store.client.requestAttachment(store.sessionState.sessionId, id).then(() => {
      wx.showToast({ title: uiText('已请求附件'), icon: 'none' });
    }).catch((err) => {
      wx.showToast({ title: err.message || uiText('附件加载失败'), icon: 'none' });
    });
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

  submitCommand(command, line, encodedImages, preserveDraft = false) {
    const request = command.ui && command.ui.submitRequest;
    const context = this.composerContextKey(), revision = this._draftRevision || 0;
    if ((encodedImages || []).length && !composerMenu.acceptsAttachments(command)) return Promise.resolve(false);
    if (request === 'message') {
      const mode = store.sessionState.running ? 'queue' : undefined;
      const sent = store.client.sendMessage(line, store.sessionState.sessionId, store.state.currentWorkspaceId, encodedImages, mode);
      if (sent !== false) {
        store.appendLocalUserRow(line, []);
        if (mode === 'queue') this.rememberQueuedSubmission(line, encodedImages);
        this.jumpToBottom();
      }
      if (sent !== false && !preserveDraft) this.setData({ draft: '', images: [], canSend: false, commandMenu: null });
      return Promise.resolve(sent);
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
    const request = this._attachmentRequest = {}, context = this.composerContextKey();
    this._composerContextKey = context;
    const current = () => !this._unloaded && this._attachmentRequest === request && this.composerContextKey() === context;
    this.closeAttachMenu();
    this.setData({ attachmentPicking: true });
    const finish = () => { if (current()) { this._attachmentRequest = null; this.setData({ attachmentPicking: false }); } };
    const fail = err => {
      if (current() && !/cancel/i.test(err && err.errMsg || '')) wx.showToast({ title: uiText('选择文件失败，请重试'), icon: 'none' });
      finish();
    };
    const options = { count: Math.min(9, remaining), type: 'file', success: res => {
      if (!current()) return;
      const kept = [];
      for (const file of res.tempFiles || []) {
        const tempPath = file.path || file.tempFilePath;
        if (!tempPath) continue;
        kept.push({ id: util.uuid(), isFile: true, tempPath, name: file.name || 'file', size: Number(file.size) || 0 });
      }
      if (!kept.length) { finish(); return; }
      const images = this.data.images.concat(kept);
      this._attachmentRequest = null;
      this.setData({ images, canSend: !!this.data.draft.trim() || images.length > 0, attachmentPicking: false });
      this.updateDockInset();
    }, fail };
    try { wx.chooseMessageFile(options); } catch (error) { fail(error); }
  },

  pickComposerImages(fromChat) {
    if (!this.data.canAttach || this.data.attachmentPicking || this.data.sendingAttachments) return;
    const remaining = 20 - this.data.images.length;
    if (remaining <= 0) { wx.showToast({ title: uiText('最多添加 20 张图片'), icon: 'none' }); return; }
    const request = this._attachmentRequest = {}, context = this.composerContextKey();
    this._composerContextKey = context;
    const current = () => !this._unloaded && this._attachmentRequest === request && this.composerContextKey() === context;
    this.closeAttachMenu();
    this.setData({ attachmentPicking: true });
    const finish = () => { if (current()) { this._attachmentRequest = null; this.setData({ attachmentPicking: false }); } };
    const fail = err => {
      if (current() && !/cancel/i.test(err && err.errMsg || '')) wx.showToast({ title: uiText('选择图片失败，请重试'), icon: 'none' });
      finish();
    };
    const options = { count: Math.min(9, remaining), success: async res => {
      let skipped = false;
      const kept = [];
      for (const file of res.tempFiles || []) {
        if (!current()) return;
        if (Number(file.size) > 8 * 1024 * 1024) { skipped = true; continue; }
        const tempPath = file.tempFilePath || file.path;
        if (!tempPath) { skipped = true; continue; }
        try {
          const info = await new Promise((resolve, reject) => wx.getImageInfo({ src: tempPath, success: resolve, fail: reject }));
          const mediaType = composerMenu.imageType('image.' + info.type);
          if (!mediaType) { skipped = true; continue; }
          kept.push({ id: util.uuid(), tempPath, mediaType, name: file.name || 'image.' + info.type, size: Number(file.size) || 0 });
        } catch (_) { skipped = true; }
      }
      if (!current()) return;
      if (!this.data.canAttach) { finish(); return; }
      const images = this.data.images.concat(kept).slice(0, 20);
      this.setData({ images, canSend: !!this.data.draft.trim() || images.length > 0 });
      if (skipped) wx.showToast({ title: uiText('仅支持 8MB 内的 PNG、JPEG、GIF、WebP 图片'), icon: 'none' });
      finish(); this.updateDockInset();
    }, fail };
    try {
      if (fromChat) wx.chooseMessageFile(Object.assign(options, { type: 'image' }));
      else wx.chooseMedia(Object.assign(options, { mediaType: ['image'], sizeType: ['compressed'] }));
    } catch (error) { fail(error); }
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
    if (images.some(image => image.isFile || !/^image\/(png|jpeg|gif|webp)$/.test(image.mediaType))) {
      wx.showToast({ title: uiText('当前网关不支持普通文件上传，请改用工作区文件引用'), icon: 'none' }); return;
    }
    if (images.length && !composerMenu.acceptsAttachments(this._activeCommand)) {
      wx.showToast({ title: uiText('此指令不接受附件，请先移除附件'), icon: 'none' }); return;
    }
    this._draftRevision = (this._draftRevision || 0) + 1;
    const revision = this._draftRevision, context = this.composerContextKey(), client = store.client, workspaceId = store.state.currentWorkspaceId;
    this.setData({ sendingAttachments: true });
    // 实验性：发送任务前申请订阅消息授权（一次性授权，每次发送都需申请）。
    if (notifyPref.enabled() && NOTIFY_TEMPLATE_ID) {
      wx.requestSubscribeMessage({ tmplIds: [NOTIFY_TEMPLATE_ID], fail: function () {} });
    }
    const s = store.sessionState;
    const self = this;
    const sendWithImages = images.length
      ? Promise.all(images.map(readImageBase64))
      : Promise.resolve([]);

    return sendWithImages.then((encoded) => {
      if (this._unloaded || this.composerContextKey() !== context || store.client !== client) return;
      if (this._draftRevision !== revision) return;
      const activeCommand = this._activeCommand;
      if (activeCommand && activeCommand.ui && activeCommand.ui.kind === 'input') {
        return this.submitCommand(activeCommand, text, encoded);
      }
      const mode = s.running ? 'queue' : undefined;
      const sent = client.sendMessage(
        text,
        s.sessionId,
        workspaceId,
        encoded,
        mode
      );
      if (sent !== false) {
        // 乐观回显：消息立即可见（对齐桌面端），网关回显到达时自动合并
        store.appendLocalUserRow(text, []);
        if (mode === 'queue') self.rememberQueuedSubmission(text, encoded);
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

  // ---------- 协作（只读，不切换父会话、不发送任务） ----------
  collaborationPatch(session = store.sessionState, app = store.state) {
    const result = collaboration.view(session.collaboration, app && app.sessions, session, app && app.connection === 'connected');
    const patch = { collaborationCount:result.total, collaborationActive:result.active };
    if (!this.data.collaborationOpen) return patch;
    const calls = (session.trajectory || []).filter(row => row.badge === 'TOOL' || row.badge === 'SUBTOOL');
    const tabs = [{id:'members',icon:'dsh-team',label:uiText('成员'),count:result.members.length},
      {id:'children',icon:'dsh-agent',label:uiText('子智能体'),count:result.children.length},
      {id:'tasks',icon:'dsh-checklist',label:uiText('团队任务'),count:result.tasks.length},
      {id:'calls',icon:'dsh-process-tool',label:uiText('工具调用'),count:calls.length}];
    const rows = this.data.collaborationTab === 'calls' ? calls.slice(-200).reverse().map(row => ({
      id:row.key,title:row.label,subtitle:row.preview,status:row.isError ? 'failed' : row.completed ? 'done' : row.stopped ? 'unknown' : 'running',
      statusText:uiText(row.isError ? '失败' : row.completed ? '已完成' : row.stopped ? '未完成' : '运行中'),canOpen:true
    })) : result[this.data.collaborationTab] || [];
    return { ...patch,collaborationTabs:tabs,collaborationRows:rows,collaborationNote:
      this.data.collaborationTab === 'calls' ? calls.length > 200 ? uiText('仅显示最近 200 次调用') : uiText('已加载的调用') : result.note };
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
    if (!['members','children','tasks','calls'].includes(tab)) return;
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
    try {
      if (!store.state || store.state.connection !== 'connected') throw Error('offline');
      const frame=await client.inspectSession(id); if(!current())return;
      if(frame.sessionId!==id || !Array.isArray(frame.events))throw Error('invalid history');
      const state=collaboration.create(id);collaboration.baseline(state,frame.projections);collaboration.ingest(state,frame.events);
      const childView=collaboration.view(state,store.state.sessions,{sessionId:id},true);
      const agg=protocol.newAggregator();
      frame.events.slice().sort((a,b)=>a.seq-b.seq).forEach(event=>protocol.applyEvent(agg,protocol.normalizeRawEvent(event,id)));
      const rows=agg.rows.filter(item=>['user','assistant'].includes(item.kind) && item.text).slice(-20).map(item=>({key:item.key,role:uiText(item.kind==='user'?'用户':'助手'),text:item.text.slice(0,20000)}));
      this.setData({collaborationPreview:{id,title:row.title,loading:false,rows,children:childView.children.filter(item=>item.id!==id && item.id!==sessionId),hasMore:frame.hasMore===true}});
    } catch (error) { if(current())this.setData({collaborationPreview:{id,title:row.title,error:true,errorText:error && error.code==='INSPECTOR_TIMEOUT' ? uiText('记录请求超时，请重新连接后重试') : uiText('加载记录失败，请重试'),rows:[],children:[]}}); }
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
