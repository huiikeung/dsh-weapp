const { t: uiText } = require('../../utils/ui-preferences');
const haptics = require('../../utils/haptics');
const preferences = require('../../utils/ui-preferences');
const workSteps = require('../../utils/work-step-presentation');
const statusAppearance = require('../../utils/status-appearance');
const procIconStyle = require('../../utils/proc-icon-style');
const store = require('../../utils/store');
const notifyPref = require('../../utils/notify-pref');
const voicePreference = require('../../utils/voice-preference');
const homeAnimationPreference = require('../../utils/home-animation-pref');
const contextPanelsPreference = require('../../utils/context-panels-pref');
const accountCardPreference = require('../../utils/account-card-pref');
const contextPreferences = require('../../utils/context-prefs');
const theme = require('../../utils/theme');
const accessApi = require('../../utils/access-api');
const { getPublicAccessState } = require('./public-access-state');
const { nodePresentation } = require('./utils/node-presentation');
const { connectionView } = require('../../utils/connection-status');
const { normalizeHostInfo } = require('../../utils/host-info');
const storageUsage = require('./utils/storage-usage');
const { clientVersion, gatewayVersionInfo } = require('./utils/version-info');
const accountView = require('./utils/account-view');
const { identityBadge } = require('./utils/identity-badge');
const publicAccessPrompt = require('../../utils/public-access-prompt');

// 兑换码档位：天数与文案一一对应，顺序必须与服务端 CODE_DAYS/CODE_USES 一致
// （dsh-console/services/public-access/server.cjs）。文案只是展示用的字典键。
const CODE_DURATION_DAYS = [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650];
const CODE_DURATION_KEYS = ['1 天', '3 天', '7 天', '30 天', '60 天', '90 天', '半年', '1 年', '2 年', '3 年', '长期'];
const CODE_USES = [1, 5, 20, 50, 100];
const CODE_USE_KEYS = ['1 次', '5 次', '20 次', '50 次', '100 次'];
const codeDurationLabels = () => CODE_DURATION_KEYS.map(uiText);
const codeUseLabels = () => CODE_USE_KEYS.map(uiText);

Page({
  manualShareMenu: true,
  data: {
    navPadTop: 50,
    workStepMenu: '',
    workStepModes: workSteps.MODES,
    workStepTimings: workSteps.TIMINGS,
    ...workSteps.view(),
    statusStyleSheetOpen: false,
    statusStyleChoices: statusAppearance.choices(),
    procIconSheetOpen: false,
    procIconChoices: procIconStyle.choices(),
    ...procIconStyle.view(procIconStyle.read()),
    navHeight: 32,
    referralEnabled: false, contentLoaded: false, contentError: '', shareSaving: false,
    accountDeviceId: '', accountIdHint: '', referralSheetOpen: false, referralBusy: false, referralError: '', referralToken: '', referralDays: 0, referralHint: '',
    adminAdvancedOpen: false,
    adminSheet: false,
    contextSheet: false,
    fontSheet: false,
    storageSheet: false, storageLoading: false, storageBusy: false,
    storageUsage: null, storageDetailInfo: null,
    privacyOpen: false,
    buildLabel: '',
    appVersion: '',
    minGatewayVersion: '≥ 0.8.6',
    connectedGatewayVersion: uiText('未连接'),
    languageLabel: uiText('跟随系统'), preferenceMenu: '', fontSettingsExpanded: false, contentFontSize: 14,
    fontSizeLabel: '14 px',          // 构建时间标记：用于确认手机上运行的是最新预览包
    appearanceLabel: uiText('跟随微信'),
    endpoint: '',
    connectionLabel: uiText('未连接'),
    connectionClass: 'disconnected',
    port: null,
    host: {},
    nodes: [],
    nodeDetailId: '',
    nodeDetail: null,
    nodePingBusy: false,
    nodeEditMode: false,
    nodeSelection: [],
    nodeCount: 0,
    activeNodeName: '',
    onlineNodeCount: 0,
    managementPanel: '',
    pairSheetOpen: false,
    pairingText: '',
    pairingError: '',
    pairingConnecting: false,
    publicOn: false,
    publicStatusLabel: uiText('未开通'),
    // 连接卡片右侧显示的值：已开通时是有效期时间，其余状态沿用状态文案。
    publicValueLabel: uiText('未开通'),
    publicId: '',
    publicExpiryLabel: '',
    publicTitle: uiText('尚未建立公网身份'),
    publicSub: uiText('添加 Agent 节点后自动建立'),
    publicHint: uiText('公网身份由节点 ID 标识；分享后对方凭一次性邀请连接，到期自动失效。'),
    isRelayOwner: false,
    redeemBusy: false,
    redeemResultLabel: '',
    redeemFormOpen: false,
    redeemCode: '',
    shareEnabled: false,
    sharePayload: '',
    shareExpiresLabel: '',
    notifyEnabled: false,
    clawbotPanelOpen: false,
    clawbotStatus: null,
    clawbotStateLabel: '',
    clawbotError: '',
    clawbotLoading: false,
    clawbotBusy: false,
    clawbotQrPath: '',
    clawbotSessions: [],
    clawbotSessionsOpen: false,
    clawbotVerifyCode: '',
    homeAnimationEnabled: true,
    showContextPanel: true,
    showFleetPanel: true,
    contextTrendGroupBy: contextPreferences.read().trendGroupBy,
    contextTrendDisplayMode: contextPreferences.read().trendDisplayMode,
    contextTrendShowDuration: contextPreferences.read().trendShowDuration,
    contextBrowserBase: contextPreferences.read().base,
    contextFileSort: contextPreferences.read().fileSort,
    voiceEnabled: true,
    accountBusy: false,
    accountIdentityReady: false,
    isWechatAdmin: false,
    accountLabel: uiText('识别中…'),
    identityBadgeLabel: uiText('待识别'),
    accountHint: uiText('自动识别当前微信身份，无需手动切换'),
    dshAccount: accountView.normalize({}),
    dshAccountBusy: false,
    dshAccountVisible: false,
    // 账号卡片默认收起（隐私）：开关在「通用设置」里，控制设置页与会话设置页的显示。
    showAccountCard: accountCardPreference.read(),
    // 余额卡默认收起：点上面的身份卡才展开，且仅已登录时有效。
    dshBalanceExpanded: false,
    publicAccessDialog: null,
    publicAccessDialogOpen: false,
    shareReason: '',
    redeemAvailable: false,
    sheetExpanded: {},
    appearanceSheet: false,
    hapticsSheet: false,
    hapticsLevel: 'medium',
    hapticsOptions: [
      { level: 'off', label: uiText('关闭') },
      { level: 'light', label: uiText('轻') },
      { level: 'medium', label: uiText('中') },
      { level: 'heavy', label: uiText('重') }
    ],
    appearanceMode: 'auto',
    appearanceModes: [
      { mode: 'auto', label: uiText('跟随微信') },
      { mode: 'light', label: uiText('浅色') },
      { mode: 'dark', label: uiText('深色') }
    ],
    codeSheet: false,
    codeSheetExpanded: false,
    codeSheetMaxH: 745,
    codeSheetExpandedMaxH: 836,
    codeSheetDefaultH: 717,
    annSheet: false,
    devAnnSheet: false,
    devAnnLoading: false,
    devAnnError: '',
    devAnnItems: [],
    annLoading: false,
    annIsAdmin: false,
    annError: '',
    annItems: [],
    annBusy: false,
    annEditingId: '',
    annRevision: null,
    annTitle: '',
    annContent: '',
    codeLoading: false,
    codeError: '',
    codeIsAdmin: false,
    codeBusy: false,
    codeItems: [],
    // 「最近生成」右上角的一键清空：只统计卡片状态正是「已用完」的兑换码。
    codeUsedCount: 0,
    codeDurations: codeDurationLabels(), codeDurationPickerOpen: false, codeCountPickerOpen: false,
    codeDurationIndex: 3,
    codeCounts: codeUseLabels(),
    codeCountIndex: 0,
    codeGenerated: '',
    codeGeneratedMeta: '',
    codeGeneratedId: ''
  },

  onLoad(options) {
    theme.applyTo(this);
    this.updateNavigationLayout();
    const contextPanelPrefs = contextPanelsPreference.read();
    this.setData({
      appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())),
      notifyEnabled: notifyPref.enabled(),
      homeAnimationEnabled: homeAnimationPreference.enabled(),
      showContextPanel: contextPanelPrefs.context,
      showFleetPanel: contextPanelPrefs.fleet,
      ...this.contextPreferenceData(),
      ...clientVersion(wx),
      storageUsage: storageUsage.collect()
    });
    this.unsubscribe = store.subscribe((snapshot) => {
      if (this._settingsVisible === false) return;
      // 合并短时间内的多次 store 通知，避免弹窗打开时背景页频繁重绘闪烁
      this._pendingSnapshot = snapshot;
      if (this._syncThrottleTimer) return;
      this._syncThrottleTimer = setTimeout(() => {
        this._syncThrottleTimer = null;
        const next = this._pendingSnapshot;
        this._pendingSnapshot = null;
        if (next && this._settingsVisible !== false) this.syncFromStore(next);
      }, 160);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
    this.refreshDshAccount();
    // 从公网授权弹窗「继续」跳入时，直接展开公网访问面板。
    if (options && options.panel === 'public') this.openPublicAccess();
    // 洞察页「插件设置」直达上下文面板。
    if (options && options.panel === 'context') this.openContextSheet();
    if (options && options.pair) {
      const result = store.pairWithPayload(options.pair);
      if (result.ok) {
        this._pairingAttemptActive = true;
        wx.showToast({ title: uiText('正在连接分享节点…'), icon: 'none' });
      } else {
        wx.showModal({ title: uiText('分享链接无效'), content: result.error || uiText('请让所有者重新生成邀请。'), showCancel: false });
      }
    }
  },

  onPublicAccessDialogConfirm() { publicAccessPrompt.resolvePublicAccessDialog(this); },

  updateNavigationLayout() {
    let info = {};
    let rect = null;
    try {
      info = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
    } catch (e) { /* 胶囊 API 可独立提供正确位置。 */ }
    try {
      rect = wx.getMenuButtonBoundingClientRect();
    } catch (e) { /* 旧基础库或异常设备按状态栏高度回退。 */ }
    const validRect = rect && Number.isFinite(rect.top) && rect.top > 0 &&
      Number.isFinite(rect.height) && rect.height > 0;
    const statusBarHeight = Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0
      ? info.statusBarHeight : 44;
    // nav 为 content-box：顶部留白只计算一次，内容中心与胶囊中心相同。
    const navPadTop = validRect ? rect.top : statusBarHeight + 6;
    const navHeight = validRect ? rect.height : 32;
    const windowHeight = Number.isFinite(info.windowHeight) && info.windowHeight > 0 ? info.windowHeight : 667;
    // 默认高度：顶边在胶囊下沿；展开高度：继续往上到顶部标题下方
    const codeSheetMaxH = Math.max(260, Math.round(windowHeight - (navPadTop + navHeight) - 16));
    const codeSheetExpandedMaxH = Math.max(codeSheetMaxH, Math.round(windowHeight - statusBarHeight - 8));
    // 打开位置：略高于半屏
    const codeSheetDefaultH = Math.max(codeSheetMaxH < 300 ? codeSheetMaxH : Math.round(windowHeight * 0.85), 420);
    this.setData({
      navPadTop: navPadTop,
      navHeight: navHeight,
      codeSheetMaxH: codeSheetMaxH,
      codeSheetExpandedMaxH: codeSheetExpandedMaxH,
      codeSheetDefaultH: codeSheetDefaultH
    });
  },

  onResize() {
    this.updateNavigationLayout();
  },

  // ---------- 外观模式 ----------

  toggleWorkStepMenu(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ workStepMenu: this.data.workStepMenu === field ? '' : field });
  },
  closeWorkStepMenu() { this.setData({ workStepMenu: '' }); },
  chooseWorkStep(e) {
    const { field, id } = e.currentTarget.dataset;
    if (!['mode','timing'].includes(field)) return;
    try {
      const value = workSteps.save({ ...workSteps.read(), [field]: id });
      this.setData({ ...workSteps.view(value), workStepMenu: '' });
    } catch (_) { wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' }); }
  },


  // ---------- 对话状态条预览：六种主题各自用画布绘制同色鲸尾 ----------
  startStatusPreviews() {
    this.stopStatusPreviews();
    if (!this.data.statusStyleSheetOpen) return;
    const dark = this.data.theme === 'dark';
    const byId = {};
    statusAppearance.OPTIONS.forEach((option) => { byId[option.id] = option; });
    const states = (this.data.statusStyleChoices || []).map((choice) => {
      const option = byId[choice.id] || {};
      return {
        id: choice.id,
        colors: (dark ? option.dark : option.light) || [],
        speed: Math.max(0.8, Number(option.speed) || 4),
        reverse: choice.id === 'terminal' || choice.id === 'glitch',
        canvas: null, ctx: null, image: null, width: 0, height: 0, ready: false, querying: false
      };
    });
    this._statusPreviews = states;
    this._statusPreviewAnchor = Date.now();
    this.queryStatusPreviews();
    // 统一节拍：不依赖画布自带的 rAF（在滚动弹层里不可靠）
    this._statusPreviewTimer = setInterval(() => {
      if (!this._statusPreviews) return;
      this._statusPreviewTick = (this._statusPreviewTick || 0) + 1;
      // 每 ~10s 重新核对一次节点，滚动导致节点回收后能自动恢复
      if (this._statusPreviewTick % 125 === 0) {
        this._statusPreviews.forEach((state) => {
          state.ready = false; state.querying = false; state.canvas = null; state.ctx = null; state.image = null;
        });
        this.queryStatusPreviews();
      }
      this._statusPreviews.forEach((state) => this.paintStatusPreview(state));
    }, 80);
  },

  queryStatusPreviews() {
    if (!this._statusPreviews || typeof wx.createSelectorQuery !== 'function') return;
    this._statusPreviews.forEach((state) => {
      if (state.ready || state.querying) return;
      state.querying = true;
      const query = wx.createSelectorQuery().in(this);
      query.select('#statusPreviewCanvas-' + state.id).fields({ node: true, size: true }).exec((res) => {
        state.querying = false;
        if (!this._statusPreviews || this._statusPreviews.indexOf(state) < 0) return;
        const item = res && res[0];
        const width = (item && item.width) || 0;
        const height = (item && item.height) || 0;
        // 弹层是 setData 后立刻查询的，画布往往还没渲染出来（node 为空或尺寸为 0）。
        // 必须短退避重试：否则要等 10s 后的重置拍才补上，鲸尾图标看着就是"不显示"。
        if (!item || !item.node || !(width >= 4) || !(height >= 4)) {
          this.scheduleStatusPreviewRetry();
          return;
        }
        let pixelRatio = 2;
        try {
          const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
          pixelRatio = info.pixelRatio || 2;
        } catch (e) { /* 默认 2 */ }
        const canvas = item.node;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        state.canvas = canvas;
        state.ctx = canvas.getContext('2d');
        state.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        state.width = width;
        state.height = height;
        state.ready = true;
        if (!state.image) {
          const image = canvas.createImage();
          image.onload = () => { state.image = image; };
          image.src = '/assets/icons/dsh-running-whale.png';
        }
      });
    });
  },

  paintStatusPreview(state) {
    if (!state.ready || !state.image || !state.ctx) return;
    const raw = ((Date.now() - this._statusPreviewAnchor) / 1000 / state.speed) % 1;
    const phase = state.reverse ? 1 - raw : raw;
    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(state.image, 0, 0, state.width, state.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = statusAppearance.sampleColor(state.colors, phase);
    ctx.fillRect(0, 0, state.width, state.height);
    ctx.globalCompositeOperation = 'source-over';
  },

  /** 画布尚未量到（弹层刚打开）：120ms 后补一次查询，直到全部就绪。 */
  scheduleStatusPreviewRetry() {
    if (this._statusPreviewRetry) return;
    this._statusPreviewRetry = setTimeout(() => {
      this._statusPreviewRetry = null;
      if (this._statusPreviews) this.queryStatusPreviews();
    }, 120);
  },

  stopStatusPreviews() {
    if (this._statusPreviewTimer) { clearInterval(this._statusPreviewTimer); this._statusPreviewTimer = null; }
    if (this._statusPreviewRetry) { clearTimeout(this._statusPreviewRetry); this._statusPreviewRetry = null; }
    this._statusPreviews = null;
  },

  openStatusStyles() {
    this.setData({ statusStyleSheetOpen: true, 'sheetExpanded.statusStyle': false, ...statusAppearance.view(statusAppearance.read()) });
    this.startStatusPreviews();
  },
  closeStatusStyles() { this.stopStatusPreviews(); this.setData({ statusStyleSheetOpen: false }); },
  chooseStatusStyle(event) {
    try {
      const id = statusAppearance.save(event.currentTarget.dataset.id);
      this.setData(statusAppearance.view(id));
    } catch (_) { wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' }); }
  },
  openProcIcons() { this.setData({ procIconSheetOpen: true, 'sheetExpanded.procIcon': false, ...procIconStyle.view(procIconStyle.read()) }); },
  closeProcIcons() { this.setData({ procIconSheetOpen: false }); },
  chooseProcIcon(event) {
    try {
      const id = procIconStyle.save(event.currentTarget.dataset.id);
      this.setData(procIconStyle.view(id));
    } catch (_) { wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' }); }
  },

  pickAppearance() {
    this.setData({ appearanceSheet: true, appearanceMode: theme.getMode() });
  },

  closeAppearanceSheet() {
    this.setData({ appearanceSheet: false });
  },

  openHapticsPicker() {
    const level = haptics.getLevel();
    this.setData({ hapticsSheet: true, hapticsLevel: level, hapticsStatusText: '' });
    haptics.vibrate();
  },

  closeHapticsSheet() {
    this.setData({ hapticsSheet: false });
  },

  openAdminSheet() {
    this.setData({ adminSheet: true });
  },

  closeAdminSheet() {
    this.setData({ adminSheet: false });
  },

  openContextSheet() {
    this.setData({ contextSheet: true });
  },

  closeContextSheet() {
    this.setData({ contextSheet: false });
  },

  openFontSheet() {
    this.setData({ fontSheet: true, fontSettingsExpanded: true });
  },

  closeFontSheet() {
    this.setData({ fontSheet: false });
  },

  openStorageSheet() {
    this.setData({ storageSheet: true, storageDetailInfo: null });
    this.refreshStorageUsage();
  },

  closeStorageSheet() {
    if (!this.data.storageBusy) this.setData({ storageSheet: false, storageDetailInfo: null });
  },

  refreshStorageUsage() {
    if (this.data.storageBusy) return;
    this.setData({ storageUsage: storageUsage.collect(), storageLoading: false });
  },

  openStorageDetail(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    const found = ((this.data.storageUsage || {}).categories || []).find((cat) => cat.key === key);
    if (found) this.setData({ storageDetailInfo: found });
  },

  backToStorageList() {
    this.setData({ storageDetailInfo: null });
  },

  clearStorageCategory() {
    const info = this.data.storageDetailInfo;
    if (!info || this.data.storageBusy) return;
    wx.showModal({
      title: uiText('清理本机缓存'),
      content: uiText('删除后可重新加载。'),
      success: (res) => { if (res.confirm) this.performStorageClear(info.key); }
    });
  },

  performStorageClear(key) {
    this.setData({ storageBusy: true });
    const freed = storageUsage.clearCategory(key) || 0;
    if (freed && store.refreshHosts) store.refreshHosts();
    wx.showToast({ title: freed ? uiText('已清理 ') + storageUsage.formatBytes(freed) : uiText('没有可清理的缓存'), icon: 'none' });
    const usage = storageUsage.collect();
    this.setData({ storageBusy: false, storageUsage: usage, storageDetailInfo: usage.categories.find((cat) => cat.key === key) || null });
  },

  chooseHaptics(e) {
    const level = e.currentTarget.dataset.level;
    const value = haptics.setLevel(level);
    this.setData({ hapticsLevel: value });
    if (value !== 'off') {
      haptics.vibrate();
      this.setData({ hapticsStatusText: uiText('已选择震动强度，请感受手机反馈。') });
    } else {
      this.setData({ hapticsStatusText: uiText('已关闭震动') });
    }
  },

  testHaptics() {
    if (haptics.getLevel() === 'off') {
      this.setData({ hapticsStatusText: uiText('已关闭震动') });
      wx.showModal({ title: uiText('震动测试'), content: uiText('已关闭震动'), showCancel: false, confirmText: uiText('知道了') });
      return;
    }
    haptics.test((result) => {
      const simulator = result.env === 'devtools';
      const title = uiText('震动测试');
      const content = simulator
        ? uiText('开发者工具无法体验震动，请在手机微信中测试。')
        : result.ok
          ? uiText('已发送震动测试，请感受手机反馈。若没有感觉到震动，请检查手机的震动与触感设置。')
          : uiText('暂时无法触发震动，请检查手机的震动与触感设置，或稍后重试。');
      this.setData({ hapticsStatusText: content });
      wx.showModal({ title, content, showCancel: false, confirmText: uiText('知道了') });
    });
  },

  chooseAppearance(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode) return;
    if (mode !== theme.getMode()) theme.setMode(mode);
    this.setData({
      appearanceMode: theme.getMode(),
      appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())),
      appearanceSheet: false
    });
  },

  appearanceLabelOf(mode) {
    return mode === 'light' ? uiText('浅色') : mode === 'dark' ? uiText('深色') : uiText('跟随微信');
  },

  onShow() {
    this._settingsVisible = true;
    const contextPanelPrefs = contextPanelsPreference.read();
    this.setData({ voiceEnabled: voicePreference.enabled(),
      homeAnimationEnabled: homeAnimationPreference.enabled(),
      showContextPanel: contextPanelPrefs.context,
      showFleetPanel: contextPanelPrefs.fleet,
      showAccountCard: accountCardPreference.read(),
      ...this.contextPreferenceData(),
      ...workSteps.view(workSteps.read()), ...statusAppearance.view(statusAppearance.read()), ...procIconStyle.view(procIconStyle.read()),
      appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())),
      hapticsLevel: haptics.getLevel() });
    this.syncFromStore({ app: store.state, session: store.sessionState });
    this.refreshDshAccount();
    // 「已连接网关版本」显示真实数据：网关未在 hello 里自报版本时，拉一次插件目录取网关插件版本。
    const gatewayMetadata = store.state.gatewayMetadata || {};
    if (store.state.connection === 'connected' && !store.state.pluginCatalog && !gatewayMetadata.version) store.refreshPlugins();
    this.cancelSettingsRefresh();
    // Local settings render first; identity is freshly verified after the first paint.
    return new Promise(resolve => {
      this._settingsRefresh = { resolve };
      this.scheduleSettingsRefresh();
    });
  },

  onReady() {
    this._settingsReady = true;
    this.scheduleSettingsRefresh();
  },

  scheduleSettingsRefresh() {
    if (!this._settingsReady || !this._settingsVisible || !this._settingsRefresh || this._settingsRefreshTimer) return;
    const request = this._settingsRefresh;
    this._settingsRefreshTimer = setTimeout(() => {
      this._settingsRefreshTimer = null;
      if (!this._settingsVisible || this._settingsRefresh !== request) return;
      this._settingsRefresh = null;
      store.refreshHostPresence();
      if (store.state.connection === 'connected') store.client.requestHost();
      Promise.all([this.refreshWechatAccount(), this.refreshAppContent()]).then(request.resolve, request.resolve);
    }, 80);
  },

  cancelSettingsRefresh() {
    clearTimeout(this._settingsRefreshTimer); this._settingsRefreshTimer = null;
    if (this._settingsRefresh) this._settingsRefresh.resolve();
    this._settingsRefresh = null;
  },

  onHide() {
    this.stopStatusPreviews();
    if (this._dshAccountHostWait) { clearTimeout(this._dshAccountHostWait); this._dshAccountHostWait = null; }
    this._dshAccountHostTries = 0;
    this._settingsVisible = false;
    clearTimeout(this._syncThrottleTimer);
    this._syncThrottleTimer = null;
    this._pendingSnapshot = null;
    this.cancelSettingsRefresh();
    this.setData({ preferenceMenu: '' });
    this.setData({ workStepMenu: '' });
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this.setData({ nodePingBusy: false });
    this._contentGeneration = (this._contentGeneration || 0) + 1;
    this.setData({ referralEnabled: false, contentLoaded: false, shareSaving: false, referralToken: '' });
    this._accountGeneration = (this._accountGeneration || 0) + 1;
    this.stopClawbotPolling();
    this._clawbotGeneration = (this._clawbotGeneration || 0) + 1;
    this.removeClawbotQr();
    const clawbotStatus = this.data.clawbotStatus;
    const safeClawbotStatus = clawbotStatus && clawbotStatus.pairing
      ? { ...clawbotStatus, pairing: { ...clawbotStatus.pairing, qrDataUrl: '' } } : clawbotStatus;
    this.setData({ clawbotPanelOpen: false, clawbotSessionsOpen: false, clawbotQrPath: '', clawbotStatus: safeClawbotStatus });
    this._publicAccount = null;
    this.setData({ accountBusy: false, accountIdentityReady: false, redeemBusy: false, isWechatAdmin: false, adminAdvancedOpen: false, accountLabel: uiText('识别中…'), identityBadgeLabel: uiText('待识别'), referralSheetOpen: false, referralBusy: false, accountDeviceId: '', adminSheet: false, contextSheet: false, fontSheet: false });
    this._dshAccountGeneration = (this._dshAccountGeneration || 0) + 1;
    this.setData({ dshAccountBusy: false });
  },

  onUnload() {
    this.stopStatusPreviews();
    if (this._dshAccountHostWait) { clearTimeout(this._dshAccountHostWait); this._dshAccountHostWait = null; }
    this._settingsVisible = false;
    this._dshAccountGeneration = (this._dshAccountGeneration || 0) + 1;
    clearTimeout(this._syncThrottleTimer);
    this._syncThrottleTimer = null;
    this._pendingSnapshot = null;
    this.cancelSettingsRefresh();
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this._contentGeneration = (this._contentGeneration || 0) + 1;
    this._accountGeneration = (this._accountGeneration || 0) + 1;
    this.stopClawbotPolling();
    this._clawbotGeneration = (this._clawbotGeneration || 0) + 1;
    this.removeClawbotQr();
    if (this.unsubscribe) this.unsubscribe();
  },

  refreshDshAccount() {
    if (store.state.connection !== 'connected' || !store.client || typeof store.client.requestAccount !== 'function') return;
    // 账号 API 校验 DSH 主机版本；host.version 可能是网关占位标记，取规范化后的真版本。
    const version = normalizeHostInfo(store.state.host).version;
    // host 帧在公网中继下可能明显变慢：先等它，不要 silently 放弃，
    // 否则设置页顶部的账号与余额永远不出现。
    if (!version) {
      // 最多等 3 次：host 帧迟到时账号区仍会出现，但页面不会永远空转。
      if (this._dshAccountHostWait || (this._dshAccountHostTries || 0) >= 3) return;
      this._dshAccountHostTries = (this._dshAccountHostTries || 0) + 1;
      this._dshAccountHostWait = setTimeout(() => {
        this._dshAccountHostWait = null;
        if (this._settingsVisible !== false) this.refreshDshAccount();
      }, 1200);
      return;
    }
    this._dshAccountHostTries = 0;
    const owner = store.state.activeID;
    if (this.data.dshAccountBusy && this._dshAccountRequestedVersion === version && this._dshAccountRequestOwner === owner) return;
    if (this.data.dshAccountBusy) this.setData({ dshAccountBusy: false });
    const generation = this._dshAccountGeneration = (this._dshAccountGeneration || 0) + 1;
    this._dshAccountRequestedVersion = version;
    this._dshAccountRequestOwner = owner;
    let locale = 'zh';
    try { locale = preferences.locale(); } catch (_) {}
    const client = { version, locale, timezoneOffsetSeconds: -(new Date()).getTimezoneOffset() * 60 };
    this.setData({ dshAccountBusy: true, dshAccountVisible: true });
    store.client.requestAccount(client).then(snapshot => {
      if (generation !== this._dshAccountGeneration || this._settingsVisible === false || owner !== store.state.activeID) return;
      this.setData({ dshAccount: accountView.normalize(snapshot), dshAccountVisible: true });
    }).catch(error => {
      if (generation !== this._dshAccountGeneration || this._settingsVisible === false || owner !== store.state.activeID) return;
      const code = String((error && error.code) || '');
      const unsupported = code === 'account-unavailable' || code === 'unknown-command'
        || /unknown message type/i.test(String((error && error.message) || ''));
      if (unsupported) {
        this.setData({ dshAccountVisible: false, dshAccount: accountView.normalize({}), dshBalanceExpanded: false });
        return;
      }
      this.setData({ dshAccount: accountView.normalize({ error: (error && error.message) || uiText('账号信息读取失败') }), dshAccountVisible: true });
    }).finally(() => {
      if (generation === this._dshAccountGeneration) this.setData({ dshAccountBusy: false });
    });
  },

  /** 展开/收起余额卡。未登录时点击不显示任何余额。 */
  toggleDshBalance() {
    if (!this.data.dshAccount || this.data.dshAccount.signedIn !== true) return;
    this.setData({ dshBalanceExpanded: !this.data.dshBalanceExpanded });
  },

  /** 手机端无法完成 DeepSeek 授权回调，引导到电脑端登录后自动同步。 */
  explainDshAccountSignIn() {
    wx.showModal({
      title: uiText('登录 DeepSeek'),
      content: uiText('手机端暂不支持直接登录 DeepSeek 账号。请在电脑端 DSH 的「设置 → 账号与余额」完成登录，登录后回到本页会自动同步。'),
      confirmText: uiText('刷新'),
      cancelText: uiText('知道了'),
      success: (result) => { if (result && result.confirm) this.refreshDshAccount(); }
    });
  },

  openDshAccountLink(e) {
    const url = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    if (typeof wx.openUrl === 'function') wx.openUrl({ url });
    else wx.setClipboardData({ data: url });
  },

  // ---------- 实验性功能 ----------
  openClawbotPanel() {
    if (this.data.clawbotPanelOpen) {
      this.closeClawbotPanel();
      return;
    }
    this._clawbotGeneration = (this._clawbotGeneration || 0) + 1;
    this.setData({ clawbotPanelOpen: true, clawbotError: '', clawbotSessionsOpen: false });
    this.refreshClawbotStatus(false);
    this.scheduleClawbotPolling();
  },

  closeClawbotPanel() {
    this.stopClawbotPolling();
    this._clawbotGeneration = (this._clawbotGeneration || 0) + 1;
    this.removeClawbotQr();
    const status = this.data.clawbotStatus;
    const safeStatus = status && status.pairing
      ? { ...status, pairing: { ...status.pairing, qrDataUrl: '' } } : status;
    this.setData({ clawbotPanelOpen: false, clawbotSessionsOpen: false, clawbotQrPath: '', clawbotStatus: safeStatus, 'sheetExpanded.clawbot': false });
  },

  scheduleClawbotPolling() {
    this.stopClawbotPolling();
    if (!this.data.clawbotPanelOpen || this._settingsVisible === false) return;
    this._clawbotPollTimer = setTimeout(() => {
      this._clawbotPollTimer = null;
      if (!this.data.clawbotPanelOpen || this._settingsVisible === false) return;
      if (!this.data.clawbotBusy) this.refreshClawbotStatus(true);
      this.scheduleClawbotPolling();
    }, 5000);
  },

  stopClawbotPolling() {
    if (this._clawbotPollTimer) clearTimeout(this._clawbotPollTimer);
    this._clawbotPollTimer = null;
  },

  clawbotStateText(status) {
    if (status.enabled) return status.state === 'error' ? uiText('接线异常') : uiText('私聊接线已启用');
    if (status.paired) return status.bindingState === 'expired' ? uiText('微信连接已失效') : uiText('微信已绑定，尚未启用');
    return uiText('尚未绑定微信');
  },

  applyClawbotStatus(status, generation) {
    if (!status || status.supported !== true || generation !== this._clawbotGeneration) return;
    const safeStatus = status.pairing
      ? { ...status, pairing: { ...status.pairing, qrDataUrl: '' } } : status;
    this.setData({
      clawbotStatus: safeStatus,
      clawbotStateLabel: this.clawbotStateText(status),
      clawbotError: '',
    });
    const pairing = status.pairing;
    if (pairing && pairing.id && pairing.qrDataUrl) this.writeClawbotQr(pairing, generation);
    else {
      this.removeClawbotQr();
      if (this.data.clawbotQrPath) this.setData({ clawbotQrPath: '' });
    }
  },

  writeClawbotQr(pairing, generation) {
    if (this._clawbotQrId === pairing.id && this.data.clawbotQrPath) return;
    const dataUrl = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(pairing.qrDataUrl);
    const fileManager = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    const basePath = wx.env && wx.env.USER_DATA_PATH;
    if (!dataUrl || !fileManager || !basePath) {
      this.setData({ clawbotQrPath: '' });
      this._clawbotQrId = '';
      return;
    }
    this.removeClawbotQr();
    const path = basePath + '/clawbot-login-' + String(pairing.id).replace(/[^a-zA-Z0-9_-]/g, '') + '.png';
    fileManager.writeFile({
      filePath: path,
      data: dataUrl[1],
      encoding: 'base64',
      success: () => {
        if (generation !== this._clawbotGeneration || !this.data.clawbotPanelOpen) {
          try { fileManager.unlink({ filePath: path }); } catch (_) { /* Best-effort cleanup. */ }
          return;
        }
        this._clawbotQrId = pairing.id;
        this._clawbotQrPath = path;
        this.setData({ clawbotQrPath: path });
      },
      fail: () => {
        this._clawbotQrId = '';
        this.setData({ clawbotQrPath: '' });
      }
    });
  },

  removeClawbotQr() {
    const path = this._clawbotQrPath;
    const fileManager = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    if (path && fileManager) {
      try { fileManager.unlink({ filePath: path }); } catch (_) { /* Best-effort cleanup. */ }
    }
    this._clawbotQrPath = '';
    this._clawbotQrId = '';
  },

  gatewaySupportsClawbot() {
    const capabilities = store.state.gatewayCapabilities;
    return Array.isArray(capabilities) && capabilities.includes('wechat-clawbot-control-v2');
  },

  clawbotErrorText(error, fallback) {
    const message = error && typeof error.message === 'string' ? error.message : '';
    // Replace the former plugin-proxy response with gateway migration guidance.
    if (/dsh-wechat-remote|clawbot is unavailable.*component status/i.test(message)) {
      return uiText('电脑端仍返回旧版 ClawBot 接线响应。请重启升级后的 DSH，并在小程序中重新连接；无需单独安装插件。');
    }
    return message || uiText(fallback);
  },

  async refreshClawbotStatus(silent) {
    if (this._clawbotRefreshing || this.data.clawbotBusy) return;
    const generation = this._clawbotGeneration;
    if (store.state.connection !== 'connected' || typeof store.client.requestClawbot !== 'function') {
      if (generation === this._clawbotGeneration) {
        this.setData({ clawbotLoading: false, clawbotError: uiText('请先连接支持 ClawBot 的电脑端网关') });
      }
      return;
    }
    if (!this.gatewaySupportsClawbot()) {
      const version = store.state.gatewayMetadata && store.state.gatewayMetadata.version;
      const message = version
        ? uiText('当前连接的网关版本为 {version}，未提供 ClawBot 控制能力。请重启升级后的 DSH 并在小程序中重新连接。', { version })
        : uiText('当前连接的网关未报告 ClawBot 控制能力，请重启升级后的 DSH 并在小程序中重新连接。');
      if (generation === this._clawbotGeneration) this.setData({ clawbotLoading: false, clawbotError: message });
      return;
    }
    this._clawbotRefreshing = true;
    if (!silent && !this.data.clawbotStatus) this.setData({ clawbotLoading: true, clawbotError: '' });
    try {
      const frame = await store.client.requestClawbot({ action: 'status' });
      const status = frame && (frame.value || frame.status);
      if (!status || status.supported !== true) throw new Error(uiText('当前网关未提供 ClawBot 接线服务'));
      this.applyClawbotStatus(status, generation);
    } catch (error) {
      if (generation === this._clawbotGeneration) this.setData({
        clawbotError: this.clawbotErrorText(error, '读取 ClawBot 状态失败，请更新网关后重试'),
      });
    } finally {
      this._clawbotRefreshing = false;
      if (generation === this._clawbotGeneration) this.setData({ clawbotLoading: false });
    }
  },

  async callClawbot(action, fields) {
    if (typeof store.client.requestClawbot !== 'function') throw new Error(uiText('请更新网关以使用 ClawBot 接线'));
    if (store.state.connection !== 'connected') throw new Error(uiText('请先连接电脑端网关'));
    if (!this.gatewaySupportsClawbot()) {
      const version = store.state.gatewayMetadata && store.state.gatewayMetadata.version;
      throw new Error(version
        ? uiText('当前连接的网关版本为 {version}，未提供 ClawBot 控制能力。请重启升级后的 DSH 并在小程序中重新连接。', { version })
        : uiText('当前连接的网关未报告 ClawBot 控制能力，请重启升级后的 DSH 并在小程序中重新连接。'));
    }
    const frame = await store.client.requestClawbot(Object.assign({ action: action }, fields || {}));
    return frame && (frame.value || frame);
  },

  async runClawbotAction(action, fields) {
    if (this.data.clawbotBusy) return null;
    const generation = this._clawbotGeneration;
    this.setData({ clawbotBusy: true, clawbotError: '' });
    try {
      const value = await this.callClawbot(action, fields);
      if (generation !== this._clawbotGeneration) return value;
      if (value && value.supported === true) this.applyClawbotStatus(value, generation);
      if (value && Array.isArray(value.sessions)) this.setData({ clawbotSessions: value.sessions });
      return value;
    } catch (error) {
      if (generation === this._clawbotGeneration) this.setData({
        clawbotError: this.clawbotErrorText(error, 'ClawBot 操作失败，请刷新状态后重试'),
      });
      return null;
    } finally {
      if (generation === this._clawbotGeneration) this.setData({ clawbotBusy: false });
    }
  },

  async startClawbotLogin() {
    const status = this.data.clawbotStatus || {};
    if (status.enabled) {
      wx.showToast({ title: uiText('请先暂停私聊接线，再重新绑定微信'), icon: 'none' });
      return;
    }
    await this.runClawbotAction('login.start', { expectedRevision: status.revision });
  },

  async openClawbotSessions() {
    // 先弹出居中弹窗（带加载态），避免点完等一拍没反应。
    this.setData({ clawbotSessionsOpen: true, clawbotSessions: this.data.clawbotSessions || [] });
    const value = await this.runClawbotAction('sessions');
    if (value && Array.isArray(value.sessions)) this.setData({ clawbotSessions: value.sessions });
  },

  closeClawbotSessions() { this.setData({ clawbotSessionsOpen: false }); },

  async chooseClawbotSession(event) {
    const status = this.data.clawbotStatus || {};
    const sessionId = event.currentTarget.dataset.id;
    if (typeof sessionId !== 'string' || !sessionId) return;
    const value = await this.runClawbotAction('route', { expectedRevision: status.revision, sessionId });
    if (value && value.supported === true) this.setData({ clawbotSessionsOpen: false });
  },

  async toggleClawbot(event) {
    const status = this.data.clawbotStatus;
    const enabled = !!event.detail.value;
    if (!status) {
      if (!this.data.clawbotPanelOpen) this.openClawbotPanel();
      else this.refreshClawbotStatus(false);
      return;
    }
    if (enabled && (!status.paired || !status.target)) {
      this.setData({ clawbotStatus: { ...status } });
      if (!this.data.clawbotPanelOpen) this.openClawbotPanel();
      wx.showToast({ title: uiText('请先绑定微信并选择接入会话'), icon: 'none' });
      return;
    }
    await this.runClawbotAction('enabled', { enabled, expectedRevision: status.revision });
  },

  cancelClawbotLogin() {
    const pairing = this.data.clawbotStatus && this.data.clawbotStatus.pairing;
    if (pairing) this.runClawbotAction('login.cancel', { loginId: pairing.id });
  },

  onClawbotVerifyCode(event) { this.setData({ clawbotVerifyCode: event.detail.value || '' }); },

  async submitClawbotVerifyCode() {
    const pairing = this.data.clawbotStatus && this.data.clawbotStatus.pairing;
    const verifyCode = String(this.data.clawbotVerifyCode || '').trim();
    if (!pairing || !verifyCode) return;
    await this.runClawbotAction('login.poll', { loginId: pairing.id, verifyCode });
    this.setData({ clawbotVerifyCode: '' });
  },

  disconnectClawbot() {
    const status = this.data.clawbotStatus;
    if (!status) return;
    if (status.enabled) {
      wx.showToast({ title: uiText('请先暂停私聊接线，再移除绑定'), icon: 'none' });
      return;
    }
    wx.showModal({
      title: uiText('移除微信绑定'),
      content: uiText('这会移除此电脑端的本地绑定并停止未完成的微信渠道消息；已开始的 DSH 任务不会取消，也不会撤销微信账号侧的授权。是否继续？'),
      confirmText: uiText('移除绑定'),
      success: async result => {
        if (!result.confirm) return;
        const value = await this.runClawbotAction('disconnect', { expectedRevision: status.revision, abandonPending: true });
        if (value && value.supported === true) this.setData({ clawbotSessions: [], clawbotSessionsOpen: false });
      }
    });
  },

  toggleVoice(e) {
    try { this.setData({ voiceEnabled: voicePreference.save(!!e.detail.value) }); }
    catch (_) { this.setData({ voiceEnabled: voicePreference.enabled() }); wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' }); }
  },

  toggleHomeAnimation(e) {
    try { this.setData({ homeAnimationEnabled: homeAnimationPreference.setEnabled(!!e.detail.value) }); }
    catch (_) {
      this.setData({ homeAnimationEnabled: homeAnimationPreference.enabled() });
      wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' });
    }
  },

  toggleContextPanel(e) {
    try { this.setData({ showContextPanel: contextPanelsPreference.set('context', !!e.detail.value).context }); }
    catch (_) {
      this.setData({ showContextPanel: contextPanelsPreference.read().context });
      wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' });
    }
  },

  toggleFleetPanel(e) {
    try { this.setData({ showFleetPanel: contextPanelsPreference.set('fleet', !!e.detail.value).fleet }); }
    catch (_) {
      this.setData({ showFleetPanel: contextPanelsPreference.read().fleet });
      wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' });
    }
  },

  /** 账号卡片显示开关：同时决定设置页和会话设置页顶部的账号区是否渲染。 */
  toggleAccountCard(e) {
    const next = accountCardPreference.set(!!(e && e.detail && e.detail.value));
    // 关掉时顺手收起余额卡，下次打开不会自己弹开。
    this.setData({ showAccountCard: next, dshBalanceExpanded: next && this.data.dshBalanceExpanded });
  },

  /** 上下文偏好面板的数据快照（趋势粒度/模式/耗时曲线、基线、文件排序）。 */
  contextPreferenceData() {
    const prefs = contextPreferences.read();
    return {
      contextTrendGroupBy: prefs.trendGroupBy,
      contextTrendDisplayMode: prefs.trendDisplayMode,
      contextTrendShowDuration: prefs.trendShowDuration,
      contextBrowserBase: prefs.base,
      contextFileSort: prefs.fileSort
    };
  },

  saveContextPreference(patch) {
    try {
      contextPreferences.set(patch);
      this.setData(this.contextPreferenceData());
    } catch (_) {
      this.setData(this.contextPreferenceData());
      wx.showToast({ title: uiText('保存失败，请重试'), icon: 'none' });
    }
  },

  setContextTrendGroup(e) {
    const group = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.group : '';
    if (['step', 'turn'].indexOf(group) < 0 || group === this.data.contextTrendGroupBy) return;
    this.saveContextPreference({ trendGroupBy: group });
  },

  setContextTrendMode(e) {
    const mode = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.mode : '';
    if (['total', 'delta'].indexOf(mode) < 0 || mode === this.data.contextTrendDisplayMode) return;
    this.saveContextPreference({ trendDisplayMode: mode });
  },

  toggleContextTrendDuration(e) {
    this.saveContextPreference({ trendShowDuration: !!(e && e.detail && e.detail.value) });
  },

  setContextBrowserBase(e) {
    const base = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.base : '';
    if (['step', 'turn'].indexOf(base) < 0 || base === this.data.contextBrowserBase) return;
    this.saveContextPreference({ base: base });
  },

  setContextFileSort(e) {
    const sort = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.sort : '';
    if (['count', 'lines', 'latest', 'path', 'name'].indexOf(sort) < 0 || sort === this.data.contextFileSort) return;
    this.saveContextPreference({ fileSort: sort });
  },

  /** 侧栏额度卡片：入口搬到设置页，开关只控制左侧栏是否显示卡片。 */
  openCostMeter() {
    wx.navigateTo({ url: '/pages/cost-meter/cost-meter' });
  },

  openVoiceSettings() { wx.navigateTo({ url: voicePreference.SETTINGS_URL }); },

  toggleNotify(e) {
    const enabled = !!e.detail.value;
    // WeChat 一次性订阅必须由具体任务发送动作触发；开关只控制是否询问。
    notifyPref.setEnabled(enabled);
    this.setData({ notifyEnabled: enabled });
  },

  /** 仅在值真正变化时 setData：网关/账号状态每 100~200ms 推送一次，重复写入会让模块闪烁。 */
  applySettingsPatch(patch) {
    const last = this._appliedSettingsPatch || (this._appliedSettingsPatch = {});
    const changed = {};
    let count = 0;
    Object.keys(patch).forEach((key) => {
      let signature;
      try { signature = JSON.stringify(patch[key]); } catch (e) { signature = String(patch[key]); }
      if (last[key] !== signature) {
        changed[key] = patch[key];
        last[key] = signature;
        count += 1;
      }
    });
    if (count) this.setData(changed);
  },

  syncFromStore(snapshot) {
    const app = snapshot.app;
    const onlineIDs = app.onlineIDs || [];
    const nodes = (app.profiles || []).map((profile) => {
      const online = onlineIDs.indexOf(profile.id) >= 0 ||
        (profile.id === app.activeID && app.connection === 'connected');
      return {
        id: profile.id,
        gatewayId: profile.gatewayId || '',
        name: nodePresentation(profile, app).name,
        online: online,
        statusLabel: online
          ? (profile.relay && profile.relayClientCount ? profile.relayClientCount + uiText(' 台设备') : uiText('在线'))
          : uiText('离线'),
        active: profile.id === app.activeID,
        selected: (this.data.nodeSelection || []).indexOf(profile.id) >= 0
      };
    });
    const activeProfile = (app.profiles || []).find((profile) => profile.id === app.activeID);
    const detailProfile = (app.profiles || []).find((profile) => profile.id === this.data.nodeDetailId);
    const nodeDetail = nodePresentation(detailProfile, app);
    this.setData({ nodeDetail });
    if (this.data.nodeDetailId && !nodeDetail) {
      this.setData({ nodeDetailId: '', nodePingBusy: false, managementPanel: this.data.managementPanel === 'gateway' ? 'nodes' : this.data.managementPanel });
    }
    const publicState = getPublicAccessState(activeProfile, app.connection);
    const relayOwner = publicState.isRelayOwner;
    const nodeId = activeProfile ? (activeProfile.gatewayId || activeProfile.id || '') : '';
    const { expiresAt, authorized, publicOn, publicStatusLabel, publicTitle } = publicState;
    const publicSub = activeProfile
      ? (activeProfile.alias || activeProfile.gatewayName || uiText('当前节点'))
      : uiText('请先在节点管理中配对设备');
    const publicHint = publicState.publicHint;
    const shareEnabled = publicState.shareEnabled;
    const profileId = activeProfile ? activeProfile.id : null;
    if (this._shareProfileId !== profileId || !shareEnabled) {
      this.setData({ sharePayload: '', shareExpiresLabel: '' });
    }
    this._shareProfileId = profileId;

    if (this._pairingAttemptActive && app.connection === 'connected') {
      this._pairingAttemptActive = false;
      this._scanRelayPending = false;
      this.setData({ pairSheetOpen: false, pairingConnecting: false, pairingText: '', pairingError: '' });
      wx.showToast({ title: uiText('节点已连接'), icon: 'success' });
    } else if (this._pairingAttemptActive && app.connection === 'failed') {
      this._pairingAttemptActive = false;
      const connectionMessage = app.connectionMessage || uiText('连接失败，请检查配对信息');
      if (this._scanRelayPending) {
        this._scanRelayPending = false;
        publicAccessPrompt.showPublicAccessFailure(connectionMessage, app.connectionErrorCode);
      }
      this.setData({
        pairingConnecting: false,
        pairingError: connectionMessage
      });
    }

    // 公网状态只算一次再 setData：避免同一帧先写网关值、再写账号值造成模块闪烁。
    const publicPatch = {
      shareEnabled: shareEnabled,
      shareReason: publicState.shareReason,
      redeemAvailable: accessApi.configured(),
      isRelayOwner: relayOwner,
      publicOn: publicOn,
      publicStatusLabel: publicStatusLabel,
      publicId: activeProfile && activeProfile.relay ? nodeId : '',
      publicExpiryLabel: expiresAt ? formatExpiry(expiresAt) : authorized ? (publicState.gatewayMode ? uiText('以网关设备授权为准') : uiText('未设置到期时间')) : '',
      publicTitle: publicTitle,
      publicSub: publicSub,
      publicHint: publicHint
    };
    if (accessApi.configured()) {
      const account = this._publicAccount;
      const expiry = Number(account && account.publicAccessExpiresAt) || 0;
      const active = !!(account && account.publicAccess === true && (account.isAdmin === true || expiry > Date.now()));
      publicPatch.publicOn = active;
      publicPatch.publicStatusLabel = !account ? uiText('待验证') : active ? uiText('已开通') : expiry ? uiText('已到期') : uiText('未开通');
      publicPatch.publicTitle = active ? uiText('公网服务可用') : expiry ? uiText('公网服务已到期') : uiText('兑换开通公网服务');
      publicPatch.publicExpiryLabel = account && account.isAdmin && active ? uiText('管理员权限') : expiry ? formatExpiry(expiry) : '';
      publicPatch.publicSub = uiText('仅控制鲸尾公网中继，局域网直连不受影响');
      publicPatch.publicHint = uiText('兑换码开通当前微信账号的公网有效期；设备仍需扫描自己 DSH 插件的二维码配对。无需把电脑添加到后台或填写连接器 JSON。');
      publicPatch.shareEnabled = active && shareEnabled;
      publicPatch.shareReason = active ? publicState.shareReason : uiText('请先兑换开通公网服务。分享设备邀请不会赠送公网有效期。');
    }
    // 连接卡片右侧：已开通（有效）时直接显示有效期时间，管理员显示「管理员权限」；
    // 未开通/已到期/待验证没有任何有效期可展示，仍显示状态文案。
    publicPatch.publicValueLabel = publicPatch.publicOn && publicPatch.publicExpiryLabel
      ? publicPatch.publicExpiryLabel
      : publicPatch.publicStatusLabel;
    this.applySettingsPatch({
      endpoint: app.endpoint || '',
      connectionLabel: connectionView(app).label,
      connectionClass: connectionView(app).key,
      port: app.port,
      host: app.host || {},
      nodes: nodes,
      nodeCount: nodes.length,
      activeNodeName: ((nodes.find((node) => node.active) || {}).name) ||
        (app.connection === 'connected' && app.gatewayName ? app.gatewayName : ''),
      onlineNodeCount: nodes.filter((node) => node.online).length,
      ...gatewayVersionInfo(app),
      ...publicPatch
    });
    // 账号区只在已连接网关时显示；断开后立即隐藏并清掉上次快照。
    const accountConnected = app.connection === 'connected';
    const accountHostVersion = normalizeHostInfo(app.host).version;
    if (accountConnected && accountHostVersion && accountHostVersion !== this._dshAccountHostVersion) {
      this._dshAccountHostVersion = accountHostVersion;
      this.refreshDshAccount();
    }
    if (accountConnected !== this._dshAccountConnected) {
      this._dshAccountConnected = accountConnected;
      if (!accountConnected) {
        this._dshAccountGeneration = (this._dshAccountGeneration || 0) + 1;
        this.setData({ dshAccountVisible: false, dshAccountBusy: false, dshAccount: accountView.normalize({}) });
      } else {
        this.setData({ dshAccountVisible: true });
        this.refreshDshAccount();
      }
    }
    const hostVersion = normalizeHostInfo(app.host).version;
    if (hostVersion && hostVersion !== this._dshAccountHostVersion) {
      this._dshAccountHostVersion = hostVersion;
      this.refreshDshAccount();
    }
  },

  // ---------- 网关连接 ----------

  disconnect() {
    const id = this.data.nodeDetailId;
    const detail = this.currentNodeDetail();
    if (!detail || !detail.canDisconnect) return;
    wx.showModal({
      title: uiText('断开连接'),
      content: uiText('将断开「') + detail.name + uiText('」的网关连接。'),
      success(res) {
        if (res.confirm && store.state.activeID === id && (store.state.profiles || []).some(p => p.id === id)) store.client.disconnect();
      }
    });
  },

  pingGateway() {
    const detail = this.currentNodeDetail();
    if (!detail || !detail.canPing || this.data.nodePingBusy) return;
    const generation = this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    const id = detail.id;
    const isCurrent = () => generation === this._nodePingGeneration && this.data.nodeDetailId === id && store.state.activeID === id;
    const started = Date.now();
    this.setData({ nodePingBusy: true });
    store.client.ping()
      .then(() => {
        if (!isCurrent()) return;
        wx.showToast({ title: uiText('往返 ') + (Date.now() - started) + 'ms', icon: 'none' });
      })
      .catch((err) => {
        if (!isCurrent()) return;
        wx.showToast({ title: detail.isPublic ? uiText('Ping 失败，请检查节点连接') : err.message || uiText('Ping 失败'), icon: 'none' });
      })
      .finally(() => { if (generation === this._nodePingGeneration) this.setData({ nodePingBusy: false }); });
  },

  forgetDevice() {
    const detail = this.currentNodeDetail();
    if (!detail) return;
    const id = detail.id;
    wx.showModal({
      title: uiText('忘记此设备'),
      content: uiText('将删除「') + detail.name + uiText('」在本机保存的配对凭据，需要重新扫码配对。'),
      confirmColor: '#E5484D',
      success: (res) => {
        if (res.confirm) {
          store.removeHosts([id]);
          this.syncFromStore({ app: store.state });
        }
      }
    });
  },

  gatewayVersionText(app) {
    return gatewayVersionInfo(app).connectedGatewayVersion;
  },

  goBack() {
    wx.navigateBack({
      fail() { wx.reLaunch({ url: '/pages/home/home' }); }
    });
  },

  readAppVersion() {
    return clientVersion(wx).appVersion;
  },

  readLanguageLabel() { return preferences.snapshot().languageLabel; },
  readFontLabel() { return preferences.snapshot().fontSizeLabel; },
  onUiLocaleChange() {
    // 兑换码档位文案是本地拼的（不走 ui[] 映射），切语言时要跟着重建。
    this.setData({ codeDurations: codeDurationLabels(), codeCounts: codeUseLabels() });
    this.syncFromStore({ app: store.state });
  },
  onUiPreferencesChange(next) {
    // The global Page wrapper already sent changed preferences. Never resend its dictionary.
    const { ui, ...localPreferences } = next || preferences.snapshot();
    this.setData({ ...localPreferences, ...workSteps.view(workSteps.read()), ...statusAppearance.view(statusAppearance.read()), ...procIconStyle.view(procIconStyle.read()),
      workStepModes: workSteps.MODES.map(item => ({ ...item, label: uiText(item.label) })), workStepTimings: workSteps.TIMINGS.map(item => ({ ...item, label: uiText(item.label) })), statusStyleChoices: statusAppearance.choices(), procIconChoices: procIconStyle.choices(), appearanceLabel: preferences.t(this.appearanceLabelOf(theme.getMode())),
      languageOptions: [{ id: 'system', label: preferences.t('跟随系统') }, { id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }] });
  },
  pickLanguage() { this.setData({ preferenceMenu: this.data.preferenceMenu === 'language' ? '' : 'language' }); },
  chooseLanguage(e) {
    try { preferences.setLanguage(e.currentTarget.dataset.id); this.onUiPreferencesChange(); this.setData({ preferenceMenu: '' }); }
    catch (_) { wx.showToast({ title: preferences.t('保存失败，请重试'), icon: 'none' }); }
  },
  changeFontSize(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    const role = e.currentTarget.dataset.role || 'text', spec = preferences.FONTS[role];
    if (!spec || ![1, -1].includes(delta)) return;
    this.saveFontSize(Math.max(spec.min, Math.min(spec.max, preferences.fontSize(role) + delta)), role);
  },
  toggleFontSettings() { this.setData({ fontSettingsExpanded: !this.data.fontSettingsExpanded }); },
  commitFontSize(e) {
    const role = e.currentTarget.dataset.role || 'text', spec = preferences.FONTS[role];
    if (!spec) return;
    const input = String(e.detail.value).trim(), value = Number(input);
    if (!input || !Number.isFinite(value)) { this.onUiPreferencesChange(); return; }
    this.saveFontSize(Math.max(spec.min, Math.min(spec.max, Math.round(value))), role);
  },
  commitFontFamily(e) {
    try { preferences.setFontFamily(e.currentTarget.dataset.role, e.detail.value); this.onUiPreferencesChange(); }
    catch (_) { this.onUiPreferencesChange(); wx.showToast({ title: preferences.t('字体名称格式无效'), icon: 'none' }); }
  },
  resetFontSize(e) { const role = e && e.currentTarget && e.currentTarget.dataset.role || 'text'; if (preferences.FONTS[role]) this.saveFontSize(preferences.FONTS[role].default, role); },
  saveFontSize(value, role = 'text') {
    try { preferences.setFontSize(value, role); this.onUiPreferencesChange(); }
    catch (_) { wx.showToast({ title: preferences.t('保存失败，请重试'), icon: 'none' }); }
  },

  // ---------- 公网访问 / 节点管理（独立入口） ----------

  refreshWechatAccount() {
    if (this.data.accountBusy) return;
    const generation = this._accountGeneration = (this._accountGeneration || 0) + 1;
    if (!accessApi.configured()) {
      this.setData({ accountBusy: false, accountIdentityReady: true, isWechatAdmin: false, accountLabel: uiText('待识别'), identityBadgeLabel: uiText('待识别'),
        accountHint: uiText('身份服务待配置，管理员入口暂未启用') });
      return Promise.resolve();
    }
    this.setData({ accountBusy: true, accountIdentityReady: false, isWechatAdmin: false, accountDeviceId: '', accountLabel: uiText('识别中…'), identityBadgeLabel: uiText('待识别'),
      accountHint: uiText('自动匹配服务端绑定的管理员微信身份') });
    this._publicAccount = null;
    this.syncFromStore({ app: store.state });
    return accessApi.ensureAccount({ freshLogin: true }).then(account => {
      if (generation !== this._accountGeneration) return;
      if (!account || typeof account.isAdmin !== 'boolean') throw new Error(uiText('身份服务响应无效'));
      const admin = account && account.isAdmin === true;
      const badge = identityBadge(account, uiText);
      this._publicAccount = account;
      this.syncFromStore({ app: store.state });
      this.setData({ accountIdentityReady: true, isWechatAdmin: admin, accountDeviceId: account.deviceId || '', accountLabel: badge, identityBadgeLabel: badge,
        accountHint: admin ? uiText('已匹配服务端绑定的管理员微信身份') : uiText('已自动识别当前微信账号'),
        accountIdHint: account.deviceId ? '' : uiText('后台尚未支持设备 ID，请升级后台') });
    }).catch((error) => {
      if (generation !== this._accountGeneration) return;
      this._publicAccount = null;
      this.syncFromStore({ app: store.state });
      this.setData({ accountIdentityReady: true, isWechatAdmin: false, accountLabel: uiText('待识别'), identityBadgeLabel: uiText('待识别'),
        accountHint: error.message || uiText('暂时无法确认身份，重新进入页面将自动重试') });
    }).finally(() => { if (generation === this._accountGeneration) this.setData({ accountBusy: false }); });
  },

  // ---------- 兑换码管理（弹窗，对齐设置页其它弹窗样式） ----------

  openCodeManagement() {
    if (this.data.accountBusy) return;   /* 弹窗内部会再次校验管理员 */
    this.setData({
      codeSheet: true,
      codeSheetExpanded: false,
      codeLoading: true,
      codeError: '',
      codeIsAdmin: false,
      codeItems: [],
      codeUsedCount: 0,
      codeGenerated: '',
      codeGeneratedMeta: '',
      codeGeneratedId: '',
      codeBusy: false
    });
    this.loadCodes();
  },


  closeCodeManagement() {
    this._codeGen = (this._codeGen || 0) + 1;
    this.setData({ codeSheet: false, codeLoading: false, codeBusy: false, codeError: '' });
  },

  loadCodes() {
    const generation = this._codeGen = (this._codeGen || 0) + 1;
    this.setData({ codeLoading: true, codeError: '' });
    accessApi.ensureAccount({ freshLogin: true })
      .then((account) => {
        if (generation !== this._codeGen) return null;
        if (!account || account.isAdmin !== true) {
          this.setData({ codeLoading: false, codeIsAdmin: false, codeError: uiText('当前微信不是管理员，不能生成或管理兑换码。') });
          return null;
        }
        return accessApi.codes().then((items) => {
          if (generation !== this._codeGen) return;
          this.setData(Object.assign({ codeLoading: false, codeIsAdmin: true }, this.codeItemsPatch(items)));
        });
      })
      .catch((err) => {
        if (generation === this._codeGen) this.setData({ codeLoading: false, codeIsAdmin: false, codeError: err.message || uiText('加载失败，请重试') });
      });
  },

  formatCodes(items) {
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return (items || []).map((item) => {
      const d = new Date(item.expiresAt);
      const expiry = d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
      const statusLabel = item.revokedAt ? uiText('已停用')
        : item.expiresAt <= Date.now() ? uiText('已过期')
        : item.used >= item.uses ? uiText('已用完') : uiText('可兑换');
      return Object.assign({}, item, {
        title: item.days + uiText(' 天 · ') + item.uses + uiText(' 次'),
        usageLabel: uiText('已用 ') + item.used + ' / ' + item.uses + uiText(' 次'),
        expiryLabel: expiry,
        statusLabel: statusLabel,
        canRevoke: !item.revokedAt && item.expiresAt > Date.now() && item.used < item.uses,
        // 状态正好是「已用完」：没停用、没过期、次数兑换完。一键清空只删这一类。
        usedUp: !item.revokedAt && item.expiresAt > Date.now() && item.used >= item.uses
      });
    });
  },

  /** 列表与「已用完」计数一起写，避免按钮与列表脱节。 */
  codeItemsPatch(items) {
    const codeItems = this.formatCodes(items);
    return { codeItems: codeItems, codeUsedCount: codeItems.filter(item => item.usedUp).length };
  },

  codePickDuration(e) {
    if (!this.data.codeBusy) this.setData({ codeDurationIndex: Number(e.detail.value) });
  },

  openCodeDurationPicker() { if (!this.data.codeBusy) this.setData({ codeDurationPickerOpen: true }); },
  closeCodeDurationPicker() { this.setData({ codeDurationPickerOpen: false }); },
  codeChooseDuration(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.setData({ codeDurationIndex: index, codeDurationPickerOpen: false });
  },

  codePickCount(e) {
    if (!this.data.codeBusy) this.setData({ codeCountIndex: Number(e.detail.value) });
  },
  openCodeCountPicker() { if (!this.data.codeBusy) this.setData({ codeCountPickerOpen: true }); },
  closeCodeCountPicker() { this.setData({ codeCountPickerOpen: false }); },
  codeChooseCount(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.setData({ codeCountIndex: index, codeCountPickerOpen: false });
  },

  codeGenerate() {
    if (this.data.codeBusy || !this.data.codeIsAdmin) return;
    const days = CODE_DURATION_DAYS[this.data.codeDurationIndex];
    const uses = CODE_USES[this.data.codeCountIndex];
    if (!days || !uses) return;
    const generation = this._codeGen;
    this.setData({ codeBusy: true, codeError: '', codeGenerated: '', codeGeneratedMeta: '', codeGeneratedId: '' });
    accessApi.createCode(null, days, uses)
      .then((result) => {
        if (generation !== this._codeGen) return;
        this.setData({
          codeBusy: false,
          codeGenerated: result.code || '',
          codeGeneratedId: result.id || '',
          codeGeneratedMeta: days + uiText(' 天 · ') + uses + uiText(' 次')
        });
        this.loadCodes();
      })
      .catch((err) => {
        if (generation === this._codeGen) this.setData({ codeBusy: false, codeError: err.message || uiText('生成失败，请重试') });
      });
  },

  codeCopyGenerated() {
    const code = this.data.codeGenerated;
    if (!code) return;
    wx.setClipboardData({ data: code, success: () => wx.showToast({ title: uiText('已复制'), icon: 'success' }) });
  },

  codeCopyItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.codeBusy) return;
    this.setData({ codeBusy: true });
    accessApi.copyCode(id)
      .then((result) => {
        this.setData({ codeBusy: false });
        wx.setClipboardData({ data: result.code || '', success: () => wx.showToast({ title: uiText('已复制'), icon: 'success' }) });
      })
      .catch((err) => this.setData({ codeBusy: false, codeError: err.message || uiText('复制失败') }));
  },

  codeRevokeItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.codeBusy) return;
    this.setData({ codeBusy: true });
    accessApi.revokeCode(id)
      .then(() => { this.setData({ codeBusy: false }); this.loadCodes(); })
      .catch((err) => this.setData({ codeBusy: false, codeError: err.message || uiText('停用失败') }));
  },

  codeDeleteItem(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.codeBusy) return;
    this.setData({ codeBusy: true });
    accessApi.deleteCode(id)
      .then(() => { this.setData({ codeBusy: false, codeGenerated: '', codeGeneratedId: '' }); this.loadCodes(); })
      .catch((err) => this.setData({ codeBusy: false, codeError: err.message || uiText('删除失败') }));
  },

  /**
   * 一键清空「已用完」的兑换码：次数兑换完的码再无用处。
   * 已停用/已过期的不动（保留对账与审计），已兑换的公网时长也不受影响。
   * 删除接口只支持单个且服务端限流 30 次/分钟，所以串行删并在被限流时停下，
   * 已删成功的不会回滚；权限失效则立即中止。
   */
  codeClearUsed() {
    if (this.data.codeBusy || !this.data.codeIsAdmin) return;
    const used = this.data.codeItems.filter(item => item.usedUp);
    if (!used.length) return;
    const generation = this._codeGen;
    wx.showModal({
      title: uiText('清空已用完的兑换码'),
      content: uiText('将删除 {n} 个已用完的兑换码，已兑换的公网时长不受影响。', { n: used.length }),
      confirmText: uiText('清空'),
      success: (res) => {
        if (!res.confirm || generation !== this._codeGen) return;
        this.setData({ codeBusy: true, codeError: '' });
        const deletedIds = [];
        let failed = 0;
        let limited = false;
        let fatal = null;
        const step = (index) => {
          if (index >= used.length || limited || fatal) return Promise.resolve();
          return accessApi.deleteCode(used[index].id).then(() => {
            deletedIds.push(used[index].id);
            return step(index + 1);
          }, (err) => {
            if (err && (err.code === 'FORBIDDEN' || err.code === 'UNAUTHORIZED')) { fatal = err; return undefined; }
            if (err && err.code === 'RATE_LIMITED') { limited = true; return undefined; }
            failed += 1;
            return step(index + 1);
          });
        };
        step(0).then(() => {
          if (generation !== this._codeGen) return;
          const generatedCleared = deletedIds.indexOf(this.data.codeGeneratedId) >= 0;
          this.setData({
            codeBusy: false,
            codeGenerated: generatedCleared ? '' : this.data.codeGenerated,
            codeGeneratedId: generatedCleared ? '' : this.data.codeGeneratedId,
            codeError: fatal ? (fatal.message || uiText('清空失败')) : (failed ? uiText('{n} 个兑换码删除失败，请重试', { n: failed }) : '')
          });
          if (fatal) this.setData({ codeIsAdmin: false, codeUsedCount: 0 });
          if (deletedIds.length) {
            wx.showToast({
              title: limited
                ? uiText('已清空 {n} 个，其余受频率限制稍后再试', { n: deletedIds.length })
                : uiText('已清空 {n} 个兑换码', { n: deletedIds.length }),
              icon: 'none'
            });
          }
          // 无论成功多少都重新拉一次服务端列表，界面不会停在旧状态。
          this.loadCodes();
        });
      }
    });
  },

  openAnnouncements() {
    this.setData({ devAnnSheet: true, devAnnLoading: true, devAnnError: '', devAnnItems: [] });
    this.loadDevAnnouncements();
  },

  closeDevAnnouncements() {
    this._devAnnGen = (this._devAnnGen || 0) + 1;
    this.setData({ devAnnSheet: false, devAnnLoading: false, devAnnError: '' });
  },

  loadDevAnnouncements() {
    const generation = this._devAnnGen = (this._devAnnGen || 0) + 1;
    this.setData({ devAnnLoading: true, devAnnError: '' });
    accessApi.appContent()
      .then((value) => {
        if (generation !== this._devAnnGen) return;
        const opened = {};
        (this.data.devAnnItems || []).forEach((item) => { if (item.expanded) opened[item.id] = true; });
        this.setData({
          devAnnLoading: false,
          devAnnItems: ((value && value.items) || []).map((item) => Object.assign({}, item, { expanded: !!opened[item.id] }))
        });
      })
      .catch((err) => {
        if (generation === this._devAnnGen) this.setData({ devAnnLoading: false, devAnnError: err.message || uiText('公告暂时加载失败，请重试') });
      });
  },

  toggleDevAnnouncement(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({
      devAnnItems: (this.data.devAnnItems || []).map((item) => (
        item.id === id ? Object.assign({}, item, { expanded: !item.expanded }) : item
      ))
    });
  },
  // ---------- 发布公告（弹窗） ----------

  openAnnouncementManagement() {
    if (!this.data.isWechatAdmin || this.data.accountBusy) return;
    this.setData({
      annSheet: true,
      annLoading: true,
      annIsAdmin: false,
      annError: '',
      annItems: [],
      annBusy: false,
      annEditingId: '',
      annRevision: null,
      annTitle: '',
      annContent: ''
    });
    this.loadAnnouncements();
  },

  closeAnnouncementSheet() {
    this._annGen = (this._annGen || 0) + 1;
    this.setData({ annSheet: false, annBusy: false, annError: '' });
  },

  loadAnnouncements() {
    const generation = this._annGen = (this._annGen || 0) + 1;
    this.setData({ annLoading: true, annError: '' });
    accessApi.ensureAccount({ freshLogin: true })
      .then((account) => {
        if (generation !== this._annGen) return null;
        if (!account || account.isAdmin !== true) {
          this.setData({ annLoading: false, annIsAdmin: false, annError: uiText('当前微信没有管理员权限') });
          return null;
        }
        return accessApi.announcements().then((result) => {
          if (generation !== this._annGen) return;
          this.setData({ annLoading: false, annIsAdmin: true, annItems: (result && result.items) || [] });
        });
      })
      .catch((err) => {
        if (generation === this._annGen) this.setData({ annLoading: false, annIsAdmin: false, annError: err.message || uiText('加载失败') });
      });
  },

  annInputTitle(e) { this.setData({ annTitle: e.detail.value }); },
  annInputContent(e) { this.setData({ annContent: e.detail.value }); },

  annEdit(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.annItems || []).find((entry) => entry.id === id);
    if (!item || this.data.annBusy) return;
    this.setData({ annEditingId: item.id, annRevision: item.revision, annTitle: item.title, annContent: item.content, annError: '' });
  },

  annClearEditor() {
    this.setData({ annEditingId: '', annRevision: null, annTitle: '', annContent: '' });
  },

  annSave() {
    if (this.data.annBusy || this.data.annLoading || !this.data.annIsAdmin) return;
    const title = String(this.data.annTitle || '').trim();
    const content = String(this.data.annContent || '').trim();
    if (!title || !content) {
      this.setData({ annError: uiText('请填写标题和正文') });
      return;
    }
    const input = { title, content };
    if (this.data.annEditingId) {
      input.id = this.data.annEditingId;
      input.revision = this.data.annRevision;
    }
    this.annMutate(() => accessApi.saveAnnouncement(input), uiText('公告已发布'), true);
  },

  annRemove(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.annItems || []).find((entry) => entry.id === id);
    if (!item || this.data.annBusy) return;
    wx.showModal({
      title: uiText('删除公告？'),
      content: '「' + item.title + uiText('」将从所有用户的公告列表移除。'),
      success: (res) => {
        if (!res.confirm) return;
        this.annMutate(() => accessApi.deleteAnnouncement(item.id, item.revision), uiText('公告已删除'), this.data.annEditingId === item.id);
      }
    });
  },

  annMutate(action, message, clearEditor) {
    if (this.data.annBusy || !this.data.annIsAdmin) return;
    const generation = this._annGen;
    this.setData({ annBusy: true, annError: '' });
    let saved = false;
    action()
      .then(() => {
        saved = true;
        if (generation !== this._annGen) return;
        if (clearEditor) this.annClearEditor();
        wx.showToast({ title: message, icon: 'success' });
      })
      .catch((err) => {
        if (generation !== this._annGen) return;
        this.setData({ annError: err.message || uiText('操作失败，请稍后重试') });
      })
      .finally(() => {
        if (generation !== this._annGen) return;
        this.setData({ annBusy: false });
        if (saved) this.loadAnnouncements();
      });
  },
  onContactError() {
    wx.showModal({ title: uiText('客服暂未接通'), content: uiText('请稍后重试。管理员需在微信公众平台启用小程序客服并添加客服人员。请勿发送密码、配对令牌或模型密钥。'), showCancel: false });
  },
  applySharing(enabled) {
    this.setData({ referralEnabled: enabled === true, ...(enabled ? {} : { referralSheetOpen: false, referralToken: '', referralBusy: false }) });
    // 活动开启时才开放平台转发菜单（设置页自己的分享按钮仍可用）；
    // 关闭时连朋友圈一起隐藏，避免分享入口指向已关闭的活动。
    try {
      if (enabled) wx.showShareMenu({ menus: ['shareAppMessage'] });
      else wx.hideShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
    } catch (e) { /* 忽略 */ }
  },
  async refreshAppContent() {
    const generation = this._contentGeneration = (this._contentGeneration || 0) + 1;
    this.setData({ contentLoaded: false, contentError: '' });
    this.applySharing(false);
    try {
      const content = await accessApi.appContent();
      if (generation !== this._contentGeneration) return;
      this.applySharing(content.shareEnabled === true);
      this.setData({ contentLoaded: true });
    } catch (error) {
      if (generation === this._contentGeneration) this.setData({ contentError: error.message || uiText('分享设置同步失败，请重试') });
    }
  },
  async toggleReferralSharing(event) {
    if (!this.data.isWechatAdmin || this.data.accountBusy || !this.data.contentLoaded || this.data.shareSaving) return;
    const generation = this._contentGeneration, accountGeneration = this._accountGeneration;
    const enabled = event.detail.value === true;
    this.setData({ shareSaving: true });
    try {
      const current = await accessApi.ensureAccount();
      if (generation !== this._contentGeneration || accountGeneration !== this._accountGeneration) return;
      if (!current.isAdmin) throw Object.assign(new Error(uiText('管理员权限已移除')), { code: 'FORBIDDEN' });
      const value = await accessApi.setSharingEnabled(enabled);
      if (generation !== this._contentGeneration || accountGeneration !== this._accountGeneration) return;
      this.applySharing(value.shareEnabled);
      wx.showToast({ title: value.shareEnabled ? uiText('分享已开启') : uiText('分享已关闭'), icon: 'success' });
    } catch (error) {
      if (generation !== this._contentGeneration || accountGeneration !== this._accountGeneration) return;
      this.applySharing(this.data.referralEnabled);
      if (['FORBIDDEN', 'UNAUTHORIZED', 'LOGIN_REQUIRED'].includes(error.code)) this.setData({ isWechatAdmin: false, identityBadgeLabel: uiText('待识别'), accountLabel: uiText('待识别') });
      wx.showModal({ title: uiText('设置未保存'), content: error.message || uiText('请稍后重试'), showCancel: false });
    } finally { if (generation === this._contentGeneration && accountGeneration === this._accountGeneration) this.setData({ shareSaving: false }); }
  },

  toggleAdminAdvanced() {
    if (!this.data.isWechatAdmin || this.data.accountBusy) return;
    this.setData({ adminAdvancedOpen: !this.data.adminAdvancedOpen });
  },

  openPairingManagement() {
    if (!this.data.isWechatAdmin || this.data.accountBusy) return;
    wx.navigateTo({ url: '/pages/pairing-admin/pairing-admin' });
  },

  bindWechatAdmin() {
    if (this.data.accountBusy) return;
    if (!accessApi.configured()) {
      wx.showModal({ title: uiText('请先部署管理后台'), content: uiText('在服务器启动鲸尾管理台、配置微信凭据，并将管理台 HTTPS 地址填入小程序配置后，即可绑定管理员。'), showCancel: false });
      return;
    }
    wx.showModal({ title: uiText('绑定管理员微信'), editable: true, placeholderText: uiText('输入网页后台生成的 WB- 绑定码'),
      success: async res => {
        if (!res.confirm) return;
        const code = String(res.content || '').trim().toUpperCase();
        if (!/^WB-(?:[A-F0-9]{6}-){3}[A-F0-9]{6}$/.test(code)) {
          wx.showToast({ title: uiText('请输入完整身份绑定码，不是设备配对码'), icon: 'none' }); return;
        }
        const generation = this._accountGeneration;
        this.setData({ accountBusy: true });
        try {
          await accessApi.ensureAccount({ freshLogin: true });
          if (generation !== this._accountGeneration) return;
          await accessApi.claimAdminBinding(code);
          if (generation !== this._accountGeneration) return;
          wx.showModal({ title: uiText('身份已提交'), content: uiText('请回到网页管理台核对并批准。批准后重新进入此页面，将自动识别管理员身份。'), showCancel: false });
        } catch (error) {
          if (generation === this._accountGeneration) wx.showToast({ title: error.message || uiText('绑定失败，请重试'), icon: 'none' });
        } finally { if (generation === this._accountGeneration) this.setData({ accountBusy: false }); }
      }
    });
  },

  openPublicAccess() {
    this.syncFromStore({ app: store.state, session: store.sessionState });
    this.setData({ managementPanel: 'public', pairSheetOpen: false });
    this.refreshAppContent();
  },

  async openReferralShare() {
    if (!this.data.referralEnabled || this.data.referralBusy) return;
    const generation = this._accountGeneration;
    this.setData({ referralSheetOpen: true, referralBusy: true, referralError: '', referralToken: '' });
    try {
      await accessApi.ensureAccount({ freshLogin: true });
      if (generation !== this._accountGeneration) return;
      const status = await accessApi.shareStatus();
      if (generation !== this._accountGeneration) return;
      if (!status.rules.enabled) { this.applySharing(false); return; }
      const result = status.rules.enabled ? await accessApi.shareInvite() : status;
      if (generation !== this._accountGeneration) return;
      const tiers = result.rules.tiers;
      this.setData({ referralDays: result.earnedDays,
        referralError: result.rules.enabled ? '' : uiText('分享活动暂未开放'),
        referralToken: result.rules.enabled ? result.inviteToken : '',
        referralHint: uiText('每位朋友首次有效打开，按人数阶梯赠送 ') + tiers.map(t => t.days).join(' / ') + uiText(' 天公网访问。') });
    } catch (e) { if (generation === this._accountGeneration) this.setData({ referralError: e.message || uiText('加载失败，请重试') }); }
    finally { if (generation === this._accountGeneration) this.setData({ referralBusy: false }); }
  },
  closeReferralShare() { this.setData({ referralSheetOpen: false }); },
  openShareRules() { this.setData({ referralSheetOpen: false }); wx.navigateTo({ url: '/pages/share-activity/share-activity?rules=1' }); },
  openMomentsActivity() { this.setData({ referralSheetOpen: false }); wx.navigateTo({ url: '/pages/share-activity/share-activity?moments=1' }); },

  openNodeManagement() {
    this.setData({ managementPanel: 'nodes', pairSheetOpen: false, nodeDetailId: '', nodeDetail: null });
    this.refreshNodes();
  },


  // ---------- 通用：弹窗拖动条（点击/拖动调整高度） ----------

  sheetGrabStart(e) {
    const key = e.currentTarget.dataset.sheet;
    if (!key) return;
    this._sheetGrab = { key: key, y: e.touches[0].clientY, moved: false, applied: null };
  },

  sheetGrabMove(e) {
    const g = this._sheetGrab;
    if (!g || !g.key) return;
    const dy = e.touches[0].clientY - g.y;
    if (Math.abs(dy) < 20) return;
    const expand = dy < 0;
    if (g.applied === expand) return;
    g.applied = expand;
    g.moved = true;
    const patch = {};
    patch['sheetExpanded.' + g.key] = expand;
    this.setData(patch);
  },

  sheetGrabEnd() {
    const g = this._sheetGrab;
    this._sheetGrab = null;
    if (!g || !g.key || g.moved) return;
    const expanded = !!(this.data.sheetExpanded && this.data.sheetExpanded[g.key]);
    const patch = {};
    patch['sheetExpanded.' + g.key] = !expanded;
    this.setData(patch);
  },

  closeManagementPanel() {
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this.setData({ managementPanel: this.data.managementPanel === 'gateway' ? 'nodes' : '', nodeDetailId: '', nodeDetail: null, nodePingBusy: false });
  },

  refreshNodes() {
    store.refreshHostPresence();
  },

  toggleNodeEditMode() {
    const next = !this.data.nodeEditMode;
    this.setData({ nodeEditMode: next, nodeSelection: [] });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  toggleNodeSelect(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const current = this.data.nodeSelection || [];
    const next = current.indexOf(id) >= 0
      ? current.filter((item) => item !== id)
      : current.concat([id]);
    this.setData({ nodeSelection: next });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  deleteSelectedNodes() {
    const ids = this.data.nodeSelection || [];
    if (!ids.length) return;
    const names = (this.data.nodes || []).filter((n) => ids.indexOf(n.id) >= 0).map((n) => n.name);
    wx.showModal({
      title: ids.length > 1 ? uiText('删除 ') + ids.length + uiText(' 个节点？') : uiText('删除节点？'),
      content: uiText('将移除：') + names.join('、') + uiText('。删除后需重新配对才能连接。'),
      confirmText: uiText('删除'),
      confirmColor: '#E5533C',
      success: (res) => {
        if (!res.confirm) return;
        store.removeHosts(ids);
        this.setData({ nodeSelection: [], nodeEditMode: false });
        this.syncFromStore({ app: store.state, session: store.sessionState });
        wx.showToast({ title: uiText('已删除'), icon: 'success' });
      }
    });
  },

  selectNode(e) {
    const id = e.currentTarget.dataset.id;
    if (!(store.state.profiles || []).some(p => p.id === id)) return;
    if (this.data.nodeEditMode) { this.toggleNodeSelect(e); return; }
    this._nodePingGeneration = (this._nodePingGeneration || 0) + 1;
    this.setData({ nodeDetailId: id, managementPanel: 'gateway', nodePingBusy: false });
    this.syncFromStore({ app: store.state });
  },

  currentNodeDetail() {
    return nodePresentation((store.state.profiles || []).find(p => p.id === this.data.nodeDetailId), store.state);
  },

  connectNode() {
    const detail = this.currentNodeDetail();
    if (!detail || detail.canDisconnect) return;
    store.selectHost(detail.id);
    this.syncFromStore({ app: store.state });
  },

  copyNodeId(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.setClipboardData({ data: id });
  },

  /** 账号续期不依赖已配对节点，断线/到期后也能兑换。 */
  redeemRenewal() {
    if (this.data.redeemBusy) return;
    if (!accessApi.configured()) {
      wx.showModal({ title: uiText('兑换服务待配置'), content: uiText('请先配置公网服务后台。局域网直连不受影响。'), showCancel: false });
      return;
    }
    // 在公网访问弹窗内展开兑换表单，并把弹窗增高到 90%
    this._redeemDraft = '';
    const expanded = Object.assign({}, this.data.sheetExpanded, { management: true });
    this.setData({ redeemFormOpen: true, redeemCode: '', sheetExpanded: expanded });
  },

  onRedeemInput(e) {
    // 非受控：避免逐字 setData 造成光标/内容抖动
    this._redeemDraft = e.detail && e.detail.value != null ? e.detail.value : '';
  },

  closeRedeemForm() {
    this._redeemDraft = '';
    this.setData({ redeemFormOpen: false, redeemCode: '', redeemError: '' });
  },

  submitRedeem() {
    if (this.data.redeemBusy) return;
    const generation = this._accountGeneration;
        const code = String(this._redeemDraft != null ? this._redeemDraft : this.data.redeemCode || '').trim().toUpperCase();
        if (!code) {
          wx.showToast({ title: uiText('请输入兑换码'), icon: 'none' });
          return;
        }
        if (generation !== this._accountGeneration) return;
        this.setData({ redeemBusy: true, redeemResultLabel: '' });
        accessApi.ensureAccount({ freshLogin: true }).then(() => accessApi.redeemPublicAccess(code)).then(async (result) => {
          if (generation !== this._accountGeneration) return;
          this._redeemDraft = '';
          this.setData({
            redeemBusy: false,
            redeemFormOpen: false,
            redeemCode: '',
            redeemResultLabel: result.expiresAt
              ? uiText('兑换成功，有效期至 ') + formatExpiry(result.expiresAt)
              : uiText('兑换成功')
          });
          this.syncFromStore({ app: store.state, session: store.sessionState });
          await this.refreshWechatAccount();
          store.appDidBecomeActive();
          wx.showToast({ title: uiText('兑换成功'), icon: 'success' });
        }).catch((err) => {
          if (generation !== this._accountGeneration) return;
          this.setData({ redeemBusy: false });
          wx.showToast({ title: err.message || uiText('兑换失败'), icon: 'none' });
        });
  },

  createNodeShare() {
    if (!this.data.shareEnabled) {
      wx.showModal({ title: uiText('暂不能分享公网访问'), content: this.data.shareReason || uiText('当前节点暂不支持分享。'), showCancel: false });
      return;
    }
    const profileId = store.state.activeID;
    wx.showActionSheet({
      itemList: [uiText('1 小时'), uiText('1 天'), uiText('7 天')],
      success: (res) => {
        const choices = [3600000, 86400000, 604800000];
        const ttl = choices[res.tapIndex];
        if (!ttl || profileId !== store.state.activeID || !this.data.shareEnabled) return;
        wx.showLoading({ title: uiText('正在生成'), mask: true });
        store.createRelayShare(ttl).then((share) => {
          wx.hideLoading();
          if (profileId !== store.state.activeID || !this.data.shareEnabled) return;
          this.setData({
            sharePayload: share.raw,
            shareExpiresLabel: uiText('邀请有效至 ') + formatExpiry(share.expiresAt)
          });
        }).catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message || uiText('生成分享失败'), icon: 'none' });
        });
      }
    });
  },

  copyNodeShare() {
    if (!this.data.sharePayload) return;
    wx.setClipboardData({
      data: this.data.sharePayload,
      success: () => wx.showToast({ title: uiText('配对信息已复制'), icon: 'success' })
    });
  },

  onShareAppMessage(event) {
    const dataset = event && event.target && event.target.dataset;
    // 右上角菜单转发（无 event/target）与活动里的「好友或群聊」按钮都分享邀请页；
    // 公网节点的「转发」按钮（无 data-referral）继续分享配对信息。
    if (this.data.referralEnabled && this.data.referralToken && (!dataset || dataset.referral === true)) {
      return { title: uiText('鲸尾 · 随时连接自己的 DSH'), path: '/pages/share-activity/share-activity?ref=' + this.data.referralToken, imageUrl: '/assets/brand/app-icon-share-500x400.jpg' };
    }
    if (this.data.sharePayload) {
      return {
        title: uiText('邀请你连接「') + (store.state.gatewayName || uiText('公网节点')) + '」',
        path: '/pages/settings/settings?pair=' + this.data.sharePayload
      };
    }
    return { title: uiText('whaletail Harness · 公网节点'), path: '/pages/settings/settings' };
  },

  addPublicNode() {
    wx.showActionSheet({
      itemList: [uiText('扫描配对二维码'), uiText('输入配对信息')],
      success: (res) => {
        if (res.tapIndex === 0) this.scanPublicNode();
        if (res.tapIndex === 1) this.openPairSheet();
      }
    });
  },

  /** 添加节点：进入三步引导页 */
  addNode() {
    wx.navigateTo({ url: '/pages/add-node/add-node' });
  },

  scanPublicNode() {
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        this._scanRelayPending = !!publicAccessPrompt.managedRelayPayload(res.result);
        const result = store.pairWithPayload(res.result);
        if (result.ok) {
          this._pairingAttemptActive = true;
          wx.showToast({ title: uiText('连接中…'), icon: 'none' });
        } else {
          this._scanRelayPending = false;
          wx.showToast({ title: result.error || uiText('配对失败'), icon: 'none' });
        }
      },
      fail: (err) => {
        const message = err && err.errMsg ? err.errMsg : '';
        if (message.indexOf('permission') >= 0 || message.indexOf('auth') >= 0) {
          wx.showToast({ title: uiText('需要摄像头权限，请在设置中开启'), icon: 'none' });
        } else if (message.indexOf('cancel') < 0) {
          wx.showToast({ title: uiText('扫码失败：') + message, icon: 'none' });
        }
      }
    });
  },

  openPairSheet() {
    this.setData({ managementPanel: 'nodes', pairSheetOpen: true, pairingText: '', pairingError: '', pairingConnecting: false });
  },

  closePairSheet() {
    if (this.data.pairingConnecting) return;
    this.setData({ pairSheetOpen: false, pairingText: '', pairingError: '' });
  },

  noop() {},

  onPairingInput(e) {
    this.setData({ pairingText: e.detail.value, pairingError: '' });
  },

  connectPublicNode() {
    const raw = String(this.data.pairingText || '').trim();
    if (!raw || this.data.pairingConnecting) return;
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this.setData({ pairingError: result.error || uiText('配对信息无效') });
      return;
    }
    this._pairingAttemptActive = true;
    this.setData({ pairingConnecting: true, pairingError: uiText('正在连接…') });
  },

  /** 全屏底部弹窗，关闭后保留设置列表位置。 */
  openPrivacyPolicy() {
    this.setData({ privacyOpen: true });
  },
  closePrivacyPolicy() {
    this.setData({ privacyOpen: false });
  }
});


function formatExpiry(value) {
  const date = new Date(value);
  const pad = (n) => n < 10 ? '0' + n : String(n);
  return date.getFullYear() + '/' + pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' + pad(date.getMinutes());
}
