const store = require('../../utils/store');
const markdown = require('../../utils/markdown');
const labels = require('../../utils/labels');
const util = require('../../utils/util');
const notifyPref = require('../../utils/notify-pref');
const theme = require('../../utils/theme');
const conversationWorkflow = require('../../utils/conversation-workflow');

// 订阅消息模板 ID：与设置页保持一致；留空则发送时不申请授权。
const NOTIFY_TEMPLATE_ID = 'QvgkQ88HKFdTNPJVOp0EdOHNDodOQACzB9oDEFDZXKU';

/** 工具活动摘要（对齐 ToolActivitySummary.kt：动作标签 + 单行明细） */
function toolActivity(name, argsText) {
const n = String(name || '').toLowerCase();
const args = String(argsText || '').replace(/\s+/g, ' ').trim();
const cut = (t) => (t.length > 240 ? t.slice(0, 240) + '…' : t);
let label = '工具';
let detail = '';
if (n.indexOf('write') === 0 || n === 'writefile') {
  label = '写入'; detail = args;
} else if (n === 'edit' || n === 'editfile' || n === 'applypatch' || n === 'apply_patch') {
  label = '修改'; detail = args;
} else if (n === 'read' || n === 'readfile') {
  label = '读取'; detail = args;
} else if (n === 'bash' || n === 'pwsh' || n === 'shell' || n === 'exec' || n === 'run_code' || n === 'terminal') {
  label = '执行'; detail = args;
} else if (n === 'grep' || n === 'search' || n === 'glob' || n === 'find') {
  label = '搜索'; detail = args;
} else if (n === 'list' || n === 'ls') {
  label = '列出'; detail = args;
} else if (n === 'webfetch' || n === 'fetch') {
  label = '获取'; detail = args;
} else if (n) {
  label = name; detail = args;
}
return { label: label, detail: cut(detail) };
}

Page({
  data: {
    tab: 'conversation', // conversation | trajectory
    navTitle: '会话',
    navPadTop: 48,      // 自定义导航：状态栏下沿前的顶部偏移
    navHeight: 32,      // 与右上角原生胶囊同高
    navMoreRight: 100,  // 右侧胶囊避让宽度
    navbarStyle: 'padding-top:48px;height:80px;padding-right:100px;',
    conversationStyle: 'padding-bottom:520rpx;',
    conversationInnerStyle: 'min-height:calc(100% - 80rpx);',
    trajectoryStyle: '',
    dockStyle: '',
    presetLabel: '',
    running: false,
    rows: [],
    trajectory: [],
    folds: {},
    scrollTarget: 'conv-bottom',
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
    permissionLabel: '工作区写入',
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
    composerPlaceholder: '输入内容或按住说话',
    convBottomInset: 520,   // 首帧安全默认值：真实高度由 dock 测量校准
    statsSheet: [],
    statsSheetOpen: false,
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

    traceDetail: null,    recording: false
  },

  onLoad(options) {
    theme.applyTo(this);
    this.sessionId = options.id || store.sessionState.sessionId;
    this._pendingQueue = [];
    if (options.id && store.sessionState.sessionId !== options.id) {
      store.openSession(options.id, '', null);
    }
    this.folds = {};
    // 字体大小偏好（设置页写入，范围 ±24%）
    let fontScale = 1;
    try {
      const id = wx.getStorageSync('appFontScale') || 'system';
      const scaleMap = { system: 1, standard: 1, large: 1.12, xlarge: 1.24 };
      fontScale = scaleMap[id] || 1;
    } catch (e) { fontScale = 1; }
    this.setData({
      fontClass: fontScale > 1.05 ? 'font-large' : '',
      fontScale: fontScale
    });
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
      this.syncFromStore(snapshot);
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
    this.stopScrollPolling();
  },

  onShow() {
    // 返回前台/切回页面：dock 高度可能变化（键盘、队列、审批卡）
    this.updateDockInset();
  },

  onUnload() {
    this.stopScrollPolling();
    if (this._runTimer) { clearInterval(this._runTimer); this._runTimer = null; }
    this._dockMeasurePending = false;
    if (this.unsubscribe) this.unsubscribe();
  },

  // ---------- 状态同步 ----------

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
    const s = snapshot.session;
    const app = snapshot.app;
    if (!s || (!s.sessionId && s.historyState !== 'creating' && s.historyState !== 'error:create')) return;

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
    (s.rows || []).forEach((row) => {
      if (row.kind === 'assistant') {
        const tools = (row.tools || []).map((tool) => {
          const activity = toolActivity(tool.name, tool.argumentsText);
          return Object.assign({}, tool, {
            actLabel: activity.label,
            actDetail: activity.detail,
            statusText: tool.isError ? '失败' : (tool.status === 'done' ? '' : '等待结果')
          });
        });
        semanticRows.push(Object.assign({}, row, {
          blocks: safeParse(row.text || ''),
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
        copy.title = row.title || '上下文';
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

    const trajectory = (s.trajectory || []).map((item) => {
      const copy = Object.assign({}, item);
      copy.badgeClass = String(item.badge || '').toLowerCase();
      copy.displayBadge = item.badge === 'USER' ? '用户'
        : (item.badge === 'ASSISTANT' ? '助手'
        : (item.badge === 'TOOL' ? '工具' : '上下文'));
      copy.seqLabel = typeof item.seq === 'number' ? numberWithCommas(item.seq) : '';
      return copy;
    });
    const traceEvents = trajectory.filter((item) => item.kind === 'event' && item.time);
    const traceStart = traceEvents.length ? traceEvents[0].time : Date.now();
    const traceEnd = traceEvents.length
      ? Math.max(traceEvents[traceEvents.length - 1].time, processRunning ? Date.now() : traceStart + 1)
      : traceStart + 1;
    const traceSpan = Math.max(1, traceEnd - traceStart);
    const laneSegments = (badge, baseWidth) => {
      const lane = traceEvents.filter((item) => item.badge === badge);
      return lane.map((item, index) => {
        const next = lane[index + 1];
        const left = Math.max(0, Math.min(97, ((item.time - traceStart) / traceSpan) * 100));
        const natural = next ? ((next.time - item.time) / traceSpan) * 100 : baseWidth;
        const width = Math.max(baseWidth, Math.min(14, natural));
        return {
          key: item.key,
          style: 'left:' + left.toFixed(2) + '%;width:' + Math.min(width, 100 - left).toFixed(2) + '%;'
        };
      });
    };

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
      ? (turns || 0) + ' 轮 ' + (steps || 0) + ' 步'
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
      ? '缓存命中 ' + (cacheHitPct == null ? '—' : cacheHitPct + '%')
      : '';
    const composerContextMetric = contextPct >= 0 ? contextPct + '%' : '';

    const selection = s.selection || app.modelCatalog && app.modelCatalog.current || app.defaultModel;
    const modelLabel = selection
      ? (selection.model || selection.provider || '模型')
      : '模型';
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
      taskCounts.completed ? taskCounts.completed + ' 已完成' : '',
      taskCounts.active ? taskCounts.active + ' 进行中' : '',
      taskCounts.pending ? taskCounts.pending + ' 待处理' : ''
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
        { label: '系统提示词', value: pressure.breakdown.systemTokens, cls: 'gray' },
        { label: '工具定义', value: pressure.breakdown.toolsTokens, cls: 'purple' },
        { label: '对话消息', value: pressure.breakdown.messageTokens, cls: 'ocean' }
      ].filter((r) => r.value != null);
    } else if (s.stats && s.stats.tokenUsage) {
      const u = s.stats.tokenUsage;
      contextRows = [
        { label: '未缓存输入', value: u.uncachedInputTokens, cls: 'ocean' },
        { label: '缓存读取', value: u.cacheReadTokens, cls: 'purple' },
        { label: '模型输出', value: u.outputTokens, cls: 'orange' }
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

    const processFolds = Object.assign({}, this.data.folds || {});
    // DSH：过程组默认折叠；本轮结束时自动收起（用户展开的可手动再开）
    if (justFinished) {
      rows.forEach((r) => { if (r.kind === 'processGroup') processFolds[r.key] = false; });
    }
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
    const fallbackTitle = (listed && (listed.title || listed.snippet)) || (s.historyState === 'creating' ? '新会话' : '会话');

    this.setData(Object.assign({
      navTitle: s.title || fallbackTitle,
      _titleDirty: true,
      presetLabel: labels.presetModeName(s.agentPreset || 'standard'),
      sessionPresetVisible: presetVisible,
      sessionPresetName: presetName || '选择模式',
      running: s.running === true,
      lastRowKind: rows.length ? rows[rows.length - 1].kind : '',
      rows: rows,
      folds: processFolds,
       trajectory: trajectory,
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
      permissionLabel: labels.permissionName(s.permission || 'workspace-write') || (s.permission || '工作区写入'),
      permissionIcon: labels.permissionIconFile(s.permission || 'workspace-write'),
      modelLabel: modelLabel,
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
        toolsStyle: 'width:' + Math.min(100, Math.round((toolMs / totalMs) * 95 + 5)) + '%;',
        inputSegments: laneSegments('USER', 3.5),
        modelSegments: laneSegments('ASSISTANT', 4.5),
        toolSegments: laneSegments('TOOL', 4)
      },
      statsLabel: turns || steps ? (turns + ' 轮 · ' + steps + ' 步') : ''
      ,composerMetricsVisible: !!(composerRunMetric || composerTokenMetric || composerCacheMetric || composerContextMetric)
      ,composerRunMetric: composerRunMetric
      ,composerTokenMetric: composerTokenMetric
      ,composerCacheMetric: composerCacheMetric
      ,composerContextMetric: composerContextMetric
    }, qReset || {}));
    this.syncCommandMenu(this.data.draft, s);
    this.updateDockInset();
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
      ? '正在从 Mobile Gateway 同步会话内容…'
      : (loadedMatch ? '正在加载历史记录 · ' + loadedMatch[1] + ' 个事件' : '正在从 Mobile Gateway 同步会话内容…');
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
        if (block.type === 'file') return '[文件]';
        if (block.type === 'image') return '[图片]';
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
          name: attachment && (attachment.name || attachment.fileName || '附件') || '附件'
        };
      }).filter((attachment) => attachment.type !== 'image' || attachment.url);
      return {
        id: it.id,
        rawText: rawText,
        preview: rawText.replace(/\s+/g, ' ').trim(),
        attachmentCount: it.attachmentCount || attachments.length,
        attachmentLabel: (it.attachmentCount || attachments.length) + ' 个附件',
        attachments: attachments,
        statusText: it.statusText || (it.status === 'sending' ? '发送中…' : ''),
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
    }

    if (this.data._titleDirty) {
      this.setData({ _titleDirty: false });

    }

    // 新内容到达时贴底；但用户正在触摸列表时不要抢滚动
    const touchingRecently = Date.now() - (this._lastTouchAt || 0) < 1000;
    if (this.data.tab === 'conversation' && this._convPinned !== false && !touchingRecently) {
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
    let head = '耗时 ' + elapsed;
    if (ctx) head += ' · ' + ctx + ' 项上下文';
    if (tools) head += ' · ' + tools + ' 次工具调用';
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
        runElapsedText: '0 秒',
        runHeader: this.buildRunHeader(rows, '0 秒')
      });
      const self = this;
      this._runTimer = setInterval(() => {
        const sec = Math.max(0, Math.floor((Date.now() - self._runStart) / 1000));
        // iOS 文案为「用时 {N} 秒…」，N 恒为整秒
        const elapsed = sec + ' 秒';
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
      thinking: ['梳理脉络中', '推敲细节中', '酝酿下一步中', '沿着思路前行中'],
      gathering: ['翻阅已有线索中', '收拢相关信息中', '寻找切入点中', '铺开问题脉络中'],
      exploring: ['向外寻找线索中', '打捞新线索中', '沿途探查中', '搜集更多拼图中'],
      reviewing: ['对照新发现中', '拼合新线索中', '检视所得中', '把发现串起来中'],
      revisiting: ['回看已有线索中', '重新校准方向中', '再推敲一遍中', '换个角度审视中'],
      composing: ['组织回应中', '整理表达中', '将思路落成文字中', '勾勒答案中'],
      working: ['继续推进中', '稳步探索中', '梳理当前进展中', '逐步展开中']
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
        title: '编辑目标',
        editable: true,
        placeholderText: goal.objective,
        success: (res) => {
          const objective = (res.content || '').trim();
          if (!res.confirm || !objective || objective === goal.objective) return;
          store.mutateGoal('goal-edit', objective).catch((err) => {
            wx.showToast({ title: err.message || '编辑失败', icon: 'none' });
          });
        }
      });
      return;
    }
    if (action === 'clear') {
      wx.showModal({
        title: '清除目标',
        content: '清除后将停止当前目标的后续自动轮次。',
        confirmText: '清除',
        confirmColor: '#E5484D',
        success: (res) => {
          if (res.confirm) store.mutateGoal('goal-clear').catch((err) => {
            wx.showToast({ title: err.message || '清除失败', icon: 'none' });
          });
        }
      });
      return;
    }
    const kind = goal.active ? 'goal-pause' : 'goal-resume';
    store.mutateGoal(kind).catch((err) => {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
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
      name: image.name || '附件'
    })).filter((item) => item.type !== 'image' || item.url);
    this._pendingQueue = (this._pendingQueue || []).concat([{
      id: 'pending-' + util.uuid(),
      rawText: text,
      preview: text.replace(/\s+/g, ' ').trim(),
      attachmentCount: attachments.length,
      attachments: attachments,
      statusText: '发送中…',
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
    this.setData({ tab: tab });
    if (tab === 'conversation') {
      this.startScrollPolling();
      this._userScrolledUp = false;
      this._lastScrollTop = undefined;
      this._lastTouchAt = 0;
      this._convPinned = true;
      if (this.data.showJump) this.setData({ showJump: false });
      wx.nextTick(() => this.refreshBottomAnchor());
    } else {
      this.stopScrollPolling();
    }
  },

  /** 长按输入框语音（对齐 iOS VoiceInputAdapter）：小程序端无转写服务，走 iOS 同款不可用弹窗 */
  /** 键盘高度：手动把输入条抬到键盘上方（adjust-position 关闭，避免整页顶起） */
  onKeyboardHeight(e) {
    const h = (e.detail && e.detail.height) || 0;
    if (h !== this.data.kbHeight) this.setData({ kbHeight: h }, () => this.syncLayoutStyles());
  },

  onComposerFocus() {
    // 占位双态（iOS：聚焦后切换为「描述你想要构建的内容」）
    if (!this.data.composerFocused) this.setData({ composerFocused: true });
  },

  onKeyboardHide() {
    this.setData({ kbHeight: 0, composerFocused: false });
    if (this.data.kbHeight) this.setData({ kbHeight: 0 });
    this.syncLayoutStyles();
  },

  onVoicePress() {
    if (this._voiceAlerting) return;
    this._voiceAlerting = true;
    wx.showModal({
      title: '语音输入暂不可用',
      content: '当前环境暂不支持语音转写，请使用键盘输入。',
      confirmText: '知道了',
      showCancel: false,
      complete: () => { this._voiceAlerting = false; }
    });
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
      wx.showToast({ title: err.message || '切换失败', icon: 'none' });
    });
  },

  moreActions() {
    const s = store.sessionState;
    const self = this;
    wx.showActionSheet({
      itemList: ['重命名会话', '查看统计', '工作区文件', '取消当前回合', '归档会话'],
      success(res) {
        switch (res.tapIndex) {
          case 0:
            wx.showModal({
              title: '重命名会话',
              editable: true,
              placeholderText: self.data.navTitle,
              success(r) {
                if (r.confirm && r.content && r.content.trim()) {
                  store.client.renameSession(s.sessionId, r.content.trim());
                  self.setData({ navTitle: r.content.trim() });
                }
              }
            });
            break;
          case 1:
            self.showStats();
            break;
          case 2:
            wx.navigateTo({ url: '/pages/files/files' });
            break;
          case 3:
            store.client.cancelSession(s.sessionId);
            break;
          case 4:
            wx.showModal({
              title: '归档会话',
              content: '归档后会话将从列表隐藏。',
              success(r) {
                if (r.confirm) {
                  store.client.archiveSession(s.sessionId);
                  wx.navigateBack();
                }
              }
            });
            break;
          default:
        }
      }
    });
  },

  /** 运行指标 → DSH「会话统计」popover */
  showStats() {
    const bundle = store.sessionState.stats || {};
    const st = bundle.stats || {};
    const compactDur = (ms) => {
      const v = Number(ms || 0);
      if (v >= 60000) return Math.floor(v / 60000) + '分' + Math.round((v % 60000) / 1000) + '秒';
      if (v >= 1000) return String(Math.round(v / 100) / 10).replace(/\.0$/, '') + '秒';
      return Math.round(v) + '毫秒';
    };
    const ttft = st.ttftSteps > 0 && st.ttftMs != null
      ? Number(st.ttftMs) / Number(st.ttftSteps)
      : (st.firstTokenMs != null ? Number(st.firstTokenMs) : null);
    const rate = st.decodeMs > 0 && st.decodeTokens != null
      ? Number(st.decodeTokens) / (Number(st.decodeMs) / 1000)
      : (st.decodeTokensPerSec != null ? Number(st.decodeTokensPerSec) : null);
    const rows = [
      { label: '模型用时', value: compactDur(st.llmMs) },
      { label: '工具调用', value: compactDur(st.toolMs) },
      { label: '首 token 平均（TTFT）', value: ttft == null ? '—' : compactDur(ttft) },
      { label: '输出速度（TPS）', value: rate == null ? '—' : String(Math.round(rate * 10) / 10).replace(/\.0$/, '') + ' tok/s' }
    ];
    this.setData({
      statsPopKind: 'run',
      statsPopTitle: '会话统计',
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
      statsPopTitle: 'Token 用量',
      statsPopTotal: fullToken(displayTotal),
      statsPopRows: [
        { label: '缓存命中', value: cacheHit },
        { label: '未缓存输入', value: fullToken(uncachedInput != null ? uncachedInput : input) },
        { label: '缓存读取', value: fullToken(cacheRead) },
        { label: '输出', value: fullToken(output) }
      ],
      statsPopOpen: true,
      showContextSheet: false
    });
  },

  closeStatsPop() {
    this.setData({ statsPopOpen: false });
  },

  /** 紧凑浮窗 → 完整会话状态 sheet */
  openFullStats() {
    // 会话状态 sheet（对齐 iOS 统计 popover/sheet：执行 / Token 用量 / 上下文）
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
    const fmtTok = (n) => (n == null ? '—' : n + ' tok');
    const groups = [
      {
        title: '执行',
        rows: [
          ['轮次', (st.turns || 0) + ' 轮'],
          ['步骤', (st.steps || 0) + ' 步'],
          ['LLM', fmtDur(st.llmMs)],
          ['工具调用', fmtDur(st.toolMs)],
          ['首 token 平均', fmtDur(st.firstTokenMs)]
        ]
      },
      {
        title: 'Token 用量',
        rows: [
          ['输入', fmtTok(totals.inputTokens)],
          ['输出', fmtTok(totals.outputTokens)],
          ['缓存读取', fmtTok(totals.cacheReadTokens)],
          ['缓存写入', fmtTok(totals.cacheWriteTokens)],
          ['推理', fmtTok(totals.reasoningTokens)]
        ]
      },
      {
        title: '上下文',
        rows: [
          ['当前压力', fmtTok(pressure.pressureTokens)],
          ['上下文窗口', fmtTok(pressure.contextWindow)]
        ]
      }
    ];
    this.setData({ statsPopOpen: false, statsSheet: groups, statsSheetOpen: true });
  },

  closeStatsSheet() {
    this.setData({ statsSheetOpen: false });
  },

  // ---------- 对话交互 ----------

  loadOlder() {
    // 加载更早历史会让 scrollTop 骤降，抑制这次位移的手势判定
    this._suppressScrollUntil = Date.now() + 600;
    store.loadOlderHistory();
  },

  onConvTouch() {
    // 只有最近有触摸，才把 scrollTop 变化当用户滚动（历史 prepend 会让
    // scrollTop 骤降，不能用它判断"用户离开底部"）
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

  /**
   * 统一的滚动位置判定：bindscroll 和兜底轮询共用。
   * - 贴底（距真实底部 ≤56px）：自动吸底
   * - 箭头：离开视觉底部（扣除输入区留白）即显示，回到视觉底部自动收起
   */
  applyScrollPosition(pos) {
    const scrollTop = Math.max(0, Number(pos.scrollTop) || 0);
    const scrollHeight = Math.max(0, Number(pos.scrollHeight) || 0);
    const clientHeight = Math.max(0, Number(pos.clientHeight) || 0);
    const HIDE_WITHIN = 56;

    const insetRpx = Number(this.data.convBottomInset) || 0;
    const winW = (typeof wx.getWindowInfo === 'function' ? (wx.getWindowInfo().windowWidth) : 375) || 375;
    const dockPx = Math.round(insetRpx * winW / 750);
    const maxScroll = Math.max(0, scrollHeight - clientHeight);

    // 距底距离；scrollHeight 不可信时退回 scrollTop 近似
    const distance = (scrollHeight > clientHeight && clientHeight > 0)
      ? scrollHeight - scrollTop - clientHeight
      : (scrollTop <= 8 ? 0 : scrollTop);

    // 视觉底部：最多吃掉一半可滚动距离，避免留白把阈值顶穿
    const ARROW_HIDE_WITHIN = Math.min(Math.max(HIDE_WITHIN, dockPx), Math.max(HIDE_WITHIN, maxScroll * 0.5));
    const ARROW_SHOW_AFTER = ARROW_HIDE_WITHIN + Math.min(24, Math.max(12, maxScroll * 0.05));

    const pinned = distance <= HIDE_WITHIN;
    const atVisualBottom = distance <= ARROW_HIDE_WITHIN;

    // 程序化滚动窗口内（加载更早历史/自动吸底）只更新贴底状态，不动箭头
    if (Date.now() < (this._suppressScrollUntil || 0)) {
      this._lastScrollTop = scrollTop;
      this._convPinned = pinned;
      return;
    }

    this._lastScrollTop = scrollTop;
    const showJump = atVisualBottom
      ? false
      : distance > (this.data.showJump ? ARROW_HIDE_WITHIN : ARROW_SHOW_AFTER);
    if (showJump !== this.data.showJump) this.setData({ showJump: showJump });
    this._convPinned = pinned;
  },

  /** 兜底轮询：部分设备 bindscroll 不可靠，定时读一次真实滚动偏移 */
  pollScrollPosition() {
    if (this.data.tab !== 'conversation') return;
    if (this._scrollPollPending) return;
    this._scrollPollPending = true;
    const query = wx.createSelectorQuery().in(this);
    query.select('.conversation').boundingClientRect();
    query.select('.conversation').scrollOffset();
    query.select('.conversation-inner').boundingClientRect();
    query.exec((res) => {
      this._scrollPollPending = false;
      const view = res && res[0];
      const offset = res && res[1];
      const inner = res && res[2];
      if (!view || !offset || !inner) return;
      const winW = 375;
      const rpx = (typeof wx.getWindowInfo === 'function' ? (wx.getWindowInfo().windowWidth) : winW) || winW;
      const padPx = Math.ceil((Number(this.data.convBottomInset) || 0) * rpx / 750);
      // scrollHeight ≈ 内层内容高度 + 顶部 8px + 底部留白
      const scrollHeight = Math.max(0, Number(inner.height) || 0) + padPx + 8;
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

  jumpToBottom() {
    this._convPinned = true;
    this._userScrolledUp = false;
    this._lastScrollTop = undefined;
    if (this.data.showJump) this.setData({ showJump: false });
    this.refreshBottomAnchor();
  },

  refreshBottomAnchor() {
    this._lastScrollTop = undefined;
    this._suppressScrollUntil = Date.now() + 400;
    this.setData({ scrollTarget: '' });
    wx.nextTick(() => this.setData({ scrollTarget: 'conv-bottom' }));
  },

  toggleFold(e) {
    const key = e.currentTarget.dataset.key;
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
      wx.showToast({ title: '已请求附件', icon: 'none' });
    }).catch((err) => {
      wx.showToast({ title: err.message || '附件加载失败', icon: 'none' });
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
      wx.showToast({ title: '请选择一个选项或填写自定义答案。', icon: 'none' });
      return;
    }
    this.setData({ questionBusy: true });
    store.client.answerQuestion(pending.rpcId, pending.sessionId, answers)
      .then(() => {
        self.questionDraft = {};
        self.customDraft = {};
        wx.showToast({ title: '已提交', icon: 'success' });
      })
      .catch((err) => {
        self.setData({ questionBusy: false });
        wx.showToast({ title: err.message || '提交失败', icon: 'none' });
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
      title: '放弃这组问题？',
      content: '当前填写的答案不会提交。',
      confirmText: '放弃',
      cancelText: '继续回答',
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
        wx.showToast({ title: err.message || '操作失败', icon: 'none' });
      });
  },

  // ---------- 输入面板 ----------

  onDraftInput(e) {
    const value = e.detail.value;
    this.setData({ draft: value, canSend: !!value.trim() || this.data.images.length > 0 });
    this.syncCommandMenu(value, store.sessionState);
    this.updateDockInset();
  },

  syncCommandMenu(value, session) {
    const text = String(value || '');
    const groups = Array.isArray(session.commandGroups) ? session.commandGroups : [];
    const commands = [];
    groups.forEach((group) => {
      (group.items || []).forEach((command) => commands.push(Object.assign({
        groupId: group.id, groupTitle: group.title
      }, command)));
    });
    const active = commands.find((command) => commandMatchesInput(command, text)) || null;
    const lookup = text.charAt(0) === '/' && text.slice(1).indexOf(' ') < 0;
    const query = lookup ? text.slice(1).toLowerCase() : '';
    let menu = null;
    if (session.commandOptionsFor) {
      menu = {
        type: 'options',
        title: '/' + session.commandOptionsFor,
        command: session.commandOptionsFor,
        groups: [],
        options: (session.commandOptions || []).map((option) => ({
          id: option.id,
          label: option.label || option.id,
          detail: option.description || option.detail || '',
          selected: option.selected === true
        }))
      };
    } else if (lookup) {
      const filtered = groups.map((group) => ({
        id: group.id,
        title: group.title,
        items: (group.items || []).filter((command) => {
          const haystack = [command.name, command.description, command.whenToUse].join(' ').toLowerCase();
          return !query || haystack.indexOf(query) >= 0;
        }).map((command) => ({
          id: command.id || ((command.source || 'item') + ':' + command.name),
          name: command.name,
          description: command.description || '',
          hasOptions: command.ui && command.ui.kind === 'select'
        }))
      })).filter((group) => group.items.length);
      menu = { type: 'catalog', title: '', groups: filtered, options: [] };
    }
    const ui = active && active.ui || {};
    const hint = ui.displayHint || ui.hint || (active && active.input && active.input.hint) || '';
    this._activeCommand = active;
    this.setData({
      commandMenu: menu,
      canAttach: !active || ui.images === true || (active.input && active.input.images === true),
      composerPlaceholder: hint || (this.data.composerFocused ? '描述你想要构建的内容' : '输入内容或按住说话')
    });
  },

  selectCommand(e) {
    const name = e.currentTarget.dataset.name;
    const groups = store.sessionState.commandGroups || [];
    let command = null;
    groups.some((group) => {
      command = (group.items || []).find((item) => item.name === name) || null;
      return !!command;
    });
    if (!command || !command.ui) return;
    const ui = command.ui;
    const insertText = ui.insertText || ('/' + command.name + (ui.kind === 'input' ? ' ' : ''));
    if (ui.kind === 'select') {
      this.setData({ draft: insertText, canSend: false });
      store.sessionState.commandLoading = true;
      store.sessionState.commandOptionsFor = command.name;
      store.client.requestCommandOptions(store.sessionState.sessionId, command.name).catch((err) => {
        wx.showToast({ title: err.message || '选项加载失败', icon: 'none' });
      });
      this.syncCommandMenu(insertText, store.sessionState);
      return;
    }
    if (ui.kind === 'input') {
      this.setData({ draft: insertText, canSend: false });
      this.syncCommandMenu(insertText, store.sessionState);
      return;
    }
    const line = ui.submitText || ('/' + command.name);
    this.submitCommand(command, line, []);
  },

  selectCommandOption(e) {
    const optionId = e.currentTarget.dataset.id;
    const command = store.sessionState.commandOptionsFor;
    if (!command || !optionId || store.sessionState.commandLoading) return;
    store.sessionState.commandLoading = true;
    this.setData({ draft: '', canSend: false, commandLoading: true });
    store.client.selectCommandOption(store.sessionState.sessionId, command, optionId).catch((err) => {
      wx.showToast({ title: err.message || '选择失败', icon: 'none' });
    });
  },

  submitCommand(command, line, encodedImages) {
    const request = command.ui && command.ui.submitRequest;
    if (request === 'message') {
      const sent = store.client.sendMessage(line, store.sessionState.sessionId, store.state.currentWorkspaceId, encodedImages, 'queue');
      if (sent !== false) {
        store.appendLocalUserRow(line, []);
        this.rememberQueuedSubmission(line, encodedImages);
      }
      this.setData({ draft: '', images: [], canSend: false, commandMenu: null });
      return Promise.resolve(sent);
    }
    if (request === 'command-execute') {
      this.setData({ commandLoading: true });
      return store.client.executeCommand(store.sessionState.sessionId, line, encodedImages).then(() => {
        this.setData({ draft: '', images: [], canSend: false, commandMenu: null, commandLoading: false });
      }).catch((err) => {
        this.setData({ commandLoading: false });
        wx.showToast({ title: err.message || '命令执行失败', icon: 'none' });
      });
    }
    return Promise.resolve(false);
  },

  /** + 附件菜单（对齐 DSH 桌面端：图片 / 文件） */
  attachMenu() {
    this.setData({ attachSheetOpen: !this.data.attachSheetOpen });
  },

  closeAttachMenu() {
    this.setData({ attachSheetOpen: false });
  },

  chooseFile() {
    this.setData({ attachSheetOpen: false });
    const self = this;
    wx.chooseMessageFile({
      count: 4,
      type: 'file',
      success(res) {
        const kept = [];
        let skipped = 0;
        res.tempFiles.forEach((file) => {
          if ((file.size || 0) > 8 * 1024 * 1024) { skipped += 1; return; }
          kept.push({
            id: util.uuid(),
            tempPath: file.path,
            mediaType: mimeByName(file.name),
            name: file.name,
            isFile: true
          });
        });
        if (skipped) wx.showToast({ title: skipped + ' 个文件超过 8MB', icon: 'none' });
        if (!kept.length) return;
        self.setData({
          images: self.data.images.concat(kept),
          canSend: !!self.data.draft.trim() || self.data.images.length + kept.length > 0
        });
      }
    });
  },

  chooseImage() {
    this.setData({ attachSheetOpen: false });
    const self = this;
    wx.chooseMedia({
      count: 4,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success(res) {
        const files = res.tempFiles.map((file) => ({
          id: util.uuid(),
          tempPath: file.tempFilePath,
          mediaType: 'image/jpeg',
          name: 'image.jpg'
        }));
        self.setData({
          images: self.data.images.concat(files),
          canSend: !!self.data.draft.trim() || self.data.images.length + files.length > 0
        });
      }
    });
  },

  removeImage(e) {
    const images = this.data.images.slice();
    images.splice(e.currentTarget.dataset.index, 1);
    this.setData({
      images: images,
      canSend: !!this.data.draft.trim() || images.length > 0
    });
  },

  send() {
    const text = this.data.draft.trim();
    const images = this.data.images;
    if (!text && !images.length) return;
    // 实验性：发送任务前申请订阅消息授权（一次性授权，每次发送都需申请）。
    if (notifyPref.enabled() && NOTIFY_TEMPLATE_ID) {
      wx.requestSubscribeMessage({ tmplIds: [NOTIFY_TEMPLATE_ID], fail: function () {} });
    }
    const s = store.sessionState;
    const self = this;
    const sendWithImages = images.length
      ? Promise.all(images.map(readImageBase64))
      : Promise.resolve([]);

    sendWithImages.then((encoded) => {
      const activeCommand = this._activeCommand;
      if (activeCommand && activeCommand.ui && activeCommand.ui.kind === 'input') {
        return this.submitCommand(activeCommand, text, encoded);
      }
      const sent = store.client.sendMessage(
        text,
        s.sessionId,
        store.state.currentWorkspaceId,
        encoded,
        'queue'
      );
      if (sent !== false) {
        // 乐观回显：消息立即可见（对齐桌面端），网关回显到达时自动合并
        store.appendLocalUserRow(text, []);
        self.rememberQueuedSubmission(text, encoded);
      }
      self.setData({ draft: '', images: [], canSend: false });
      this._convPinned = true;
      this.refreshBottomAnchor();
    }).catch((err) => {
      wx.showToast({ title: err.message || '附件处理失败', icon: 'none' });
    });
  },

  updateDockInset(attempt) {
    const tries = typeof attempt === 'number' ? attempt : 0;
    // 首帧调用允许排队；重试调用直接测量，避免被 pending 标志吞掉
    if (tries === 0) {
      if (this._dockMeasurePending) return;
      this._dockMeasurePending = true;
    }
    wx.nextTick(() => {
      const query = wx.createSelectorQuery().in(this);
      query.select('.dock-stack').boundingClientRect((rect) => {
        this._dockMeasurePending = false;
        if (!rect || !rect.height) {
          // dock 还没完成布局（首帧/历史渲染中）：短间隔重试，
          // 否则会一直沿用默认留白，底部内容被输入区遮挡很久。
          if (tries < 10) setTimeout(() => this.updateDockInset(tries + 1), 80);
          return;
        }
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        // 列表只需避让固定 dock 的真实高度，再留 12rpx 呼吸空间。
        // 旧实现额外加 54rpx，消息结尾与统计胶囊之间会出现明显大空白。
        const inset = Math.ceil(rect.height * 750 / Math.max(info.windowWidth || 375, 1) + 12);
        if (Math.abs(inset - this.data.convBottomInset) > 8) this.setData({ convBottomInset: inset });
        this.syncLayoutStyles();
        // 布局稳定后再校准一次：历史/队列渲染会改变 dock 高度
        if (tries < 2) setTimeout(() => this.updateDockInset(tries + 1), 240);
      }).exec();
    });
  },

  syncLayoutStyles() {
    const navPadTop = Number(this.data.navPadTop) || 0;
    const navHeight = Number(this.data.navHeight) || 0;
    const navMoreRight = Number(this.data.navMoreRight) || 0;
    const kbHeight = Number(this.data.kbHeight) || 0;
    this.setData({
      navbarStyle: 'padding-top:' + navPadTop + 'px;height:' + (navPadTop + navHeight)
        + 'px;padding-right:' + navMoreRight + 'px;',
      conversationStyle: 'padding-bottom:' + (Number(this.data.convBottomInset) || 520) + 'rpx;'
        + (kbHeight ? 'transform:translateY(-' + kbHeight + 'px);' : ''),
      // scroll-view 的 padding-bottom 已完整避让 dock；内层只扣 80rpx，
      // 让短会话最后一条停在统计胶囊上方，而不是重复扣除整个输入栈。
      conversationInnerStyle: 'min-height:calc(100% - 80rpx);',
      trajectoryStyle: kbHeight ? 'margin-bottom:' + kbHeight + 'px;' : '',
      dockStyle: kbHeight ? 'bottom:' + (kbHeight + 12) + 'px;' : ''
    });
  },

  stopAgent() {
    const s = store.sessionState;
    wx.showModal({
      title: '停止当前回合',
      content: '将取消 Agent 正在执行的回合。',
      success(res) {
        if (res.confirm) store.client.cancelSession(s.sessionId);
      }
    });
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
      permissionSheet: options.map((o) => ({
        value: o.value,
        // 弹窗统一显示中文：优先本地文案，主机返回英文值时不再直接展示
        name: labels.permissionName(o.value) || o.name || o.value,
        icon: iconOf(o.value),
        current: o.value === current
      }))
    });
  },

  pickPermissionOption(e) {
    const value = e.currentTarget.dataset.value;
    const s = store.sessionState;
    this.setData({ permissionSheet: [] });
    if (!s.sessionId || !value) return;
    store.client.setPermission(s.sessionId, value).catch((err) => {
      wx.showToast({ title: err.message || '设置失败', icon: 'none' });
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
          effort: model.reasoning && model.reasoning.defaultEffort,
          current: isCurrent(group.id, model.id)
        }));
        if (models.length) {
          groups.push({
            id: group.id,
            name: group.name || group.id,
            models: models
          });
        }
      });
    }
    if (!groups.length) {
      store.client.requestModels(s.sessionId).catch(() => {});
      wx.showToast({ title: '正在加载模型列表', icon: 'none' });
      this.setData({ modelSheetOpen: false, modelGroups: [] });
      return;
    }
    this.setData({ modelGroups: groups, modelSheetOpen: true });
  },

  pickModelOption(e) {
    const ds = e.currentTarget.dataset;
    const provider = ds.provider;
    const model = ds.model;
    if (!provider || !model) return;
    this.setData({ modelSheetOpen: false });
    store.selectModel(store.sessionState.sessionId, provider, model, ds.effort || undefined)
      .catch((err) => {
        wx.showToast({ title: err.message || '切换失败', icon: 'none' });
      });
    this.setData({
      modelLabel: model,
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
      effortSheetOpen: true
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
        wx.showToast({ title: err.message || '设置失败', icon: 'none' });
      });
    this.setData({ effortLabel: labels.reasoningEffortName(level) });
  },

  closeEffortSheet() {
    this.setData({ effortSheetOpen: false });
  },

  // ---------- 轨迹详情 ----------

  openTraceDetail(e) {
    const item = this.data.trajectory[e.currentTarget.dataset.index];
    if (!item || item.kind !== 'event') return;
    this.setData({ traceDetail: item });
  },

  closeTraceDetail() {
    this.setData({ traceDetail: null });
  },

  copyTraceDetail() {
    if (!this.data.traceDetail) return;
    wx.setClipboardData({ data: this.data.traceDetail.detail || '' });
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
    case 'active': return '进行中的目标';
    case 'paused': return '已暂停的目标';
    case 'blocked': return '受阻的目标';
    default: return '当前目标';
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

function mimeByName(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  const map = {
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
    markdown: 'text/markdown', json: 'application/json', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip', html: 'text/html', xml: 'application/xml',
    js: 'text/javascript', ts: 'text/typescript', py: 'text/x-python',
    sh: 'text/x-sh', yaml: 'text/yaml', yml: 'text/yaml'
  };
  return map[ext] || 'application/octet-stream';
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
        reject(new Error(err.errMsg || '读取图片失败'));
      }
    });
  });
}
