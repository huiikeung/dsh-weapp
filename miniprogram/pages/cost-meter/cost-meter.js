const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const costView = require('../../utils/cost-view');

const PLAN_FIELD_LABELS = {
  workspaceId: 'Workspace ID',
  orgId: 'Organization ID',
  factoryPool: 'Factory 套餐',
  baseUrl: 'MiniMax 查询域名',
  planCredits: '月度 Credits 额度',
  planStart: '计费周期起始日',
};
const REFRESH_OPTIONS = [1, 5, 15, 30, 60, 120];
const BUDGET_PERIODS = [
  { id: 'day', label: '今日' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '累计' },
  { id: 'custom', label: '自定义区间' },
];

function defaultCustomEntry() {
  return {
    enabled: false,
    adapter: 'custom',
    label: '',
    labelEn: '',
    unit: 'USD',
    display: 'both',
    refreshMinutes: 15,
    convertToDisplayCurrency: false,
    allowInsecureHttp: false,
    allowedHosts: [],
    secretHeader: 'Authorization',
    request: { url: '', method: 'GET', headers: {}, body: '' },
    extract: { remaining: 'data.remaining', maxBudget: '', spend: '', unit: 'USD' },
  };
}

/** 参考实现的四个预设：空 custom / 阿里云千问 / Token Rhythm / WorkBuddy2API 积分。 */
function customPreset(kind) {
  const base = defaultCustomEntry();
  if (kind === 'aliyun') {
    return Object.assign({}, base, {
      adapter: 'aliyun', label: '千问 / 阿里云余额', unit: 'CNY',
      request: { url: 'https://business.aliyuncs.com/', method: 'POST', headers: {}, body: '' },
    });
  }
  if (kind === 'tokenrhythm') {
    return Object.assign({}, base, {
      adapter: 'tokenrhythm', label: 'Token Rhythm 余额', unit: 'CNY',
      request: { url: 'https://tokenrhythm.studio/api/wallet/summary', method: 'GET', headers: {}, body: '' },
    });
  }
  // 赛博（saibo.xytnb.xyz）：用户主力余额源，作为默认预设。
  if (kind === 'saibo') {
    return Object.assign({}, base, {
      enabled: true,
      label: '赛博', labelEn: 'saibo', unit: 'USD',
      display: 'both',
      refreshMinutes: 15,
      allowInsecureHttp: false,
      allowedHosts: ['saibo.xytnb.xyz'],
      secretHeader: 'Authorization',
      request: {
        url: 'https://saibo.xytnb.xyz/v1/usage',
        method: 'GET',
        headers: { Authorization: 'Bearer {{SAIBO_API_KEY}}' },
        body: '',
      },
      extract: { remaining: 'balance', maxBudget: 'info.max_budget', spend: 'info.spend', unit: 'USD' },
    });
  }
  if (kind === 'workbuddy') {
    return Object.assign({}, base, {
      label: 'WorkBuddy2API 积分', unit: 'CREDITS',
      request: {
        url: 'http://127.0.0.1:8790/api/credits/expiry?package_limit=1',
        method: 'GET',
        headers: { 'X-Admin-Token': '{{WORKBUDDY2API_ADMIN_TOKEN}}' },
        body: '',
      },
      extract: { remaining: 'summary.available_remaining', maxBudget: '', spend: '', unit: 'CREDITS' },
      allowedHosts: ['127.0.0.1:8790'],
    });
  }
  return base;
}

function defaultGatewaySource() {
  return {
    id: 'gateway-' + Date.now().toString(36),
    type: 'cliproxyapi',
    label: 'CLIProxyAPI',
    baseURL: '',
    enabled: false,
    display: 'both',
    refreshMinutes: 15,
    allowedHosts: [],
    allowInsecureHttp: false,
    includeProviders: ['antigravity', 'claude', 'codex', 'gemini', 'kimi', 'qwen', 'xai', 'workbuddy'],
    antigravityOnlyGemini: false,
  };
}

Page({
  data: {
    navPadTop: 50,
    navHeight: 32,
    themeClass: '',
    connected: false,
    supported: false,
    loading: false,
    refreshing: false,
    saving: '',
    error: '',
    dashboard: null,
    summary: null,
    config: null,
    view: null,
    sources: null,
    styleOptions: costView.SIDEBAR_STYLES,
    displayOptions: costView.DISPLAY_OPTIONS,
    budgetPeriods: BUDGET_PERIODS,
    displayForm: { currency: 'CNY', symbol: '¥', decimals: 3, exchangeRate: 7.2, sidebarStyle: 'standard', sidebarVisible: false, peakStyle: 'progress', refreshLabel: '15 分钟' },
    sidebarOrderCells: [],
    previewComponent: 'budget',
    previewComponentOptions: [],
    previewComponentLabel: '',
    previewComponentDisplayLabel: '',
    previewComponentEnabled: false,
    componentPickerOpen: false,
    previewSidebar: null,
    previewSections: [],
    /* 弹窗：'' 关闭；'display' | 'balance' | 'go' | 'budget' | 'peak' | 'plan' | 'gateway' | 'custom' */
    sheet: '',
    sheetDragY: 0,
    sheetDragging: false,
    sheetPlan: {},
    sheetGateway: {},
    sheetCustom: {},
    keyEditing: false,
    balanceForm: { enabled: true, display: 'both', refreshMinutes: 5 },
    goForm: { enabled: false, display: 'both', refreshMinutes: 15, main: 'rolling', barDirection: 'used', detail: true },
    budgetForm: { enabled: false, amount: '', period: 'month', display: 'both' },
    peakForm: { enabled: true, display: 'both', windowsLabel: '01:00-04:00,06:00-10:00', style: 'progress' },
    planCells: [],
    customCells: [],
    gatewayCells: [],
    balanceKeyDraft: '',
    goKeyDraft: '',
    planKeyDrafts: {},
    customKeyDrafts: {},
    gatewayKeyDrafts: {},
    expandedPlan: '',
    expandedCustom: -1,
    expandedGateway: -1,
  },

  onLoad(options) {
    this.alive = true;
    this._pendingComponent = options && typeof options.component === 'string' ? decodeURIComponent(options.component) : '';
    this.owner = costView.dashboardOwner(store.state);
    theme.applyTo(this);
    this.updateNavigationLayout();
    this.unsubscribe = store.subscribe(snapshot => this.syncFromStore(snapshot));
    this.syncFromStore({ app: store.state });
  },

  onShow() {
    this.syncFromStore({ app: store.state });
    if (store.state.connection === 'connected') this.loadAll(false);
    else this.setData({ loading: false, error: uiText('请先连接电脑端网关') });
  },

  onResize() { this.updateNavigationLayout(); },

  onUnload() {
    this.alive = false;
    this.requestGeneration = (this.requestGeneration || 0) + 1;
    if (this.unsubscribe) this.unsubscribe();
  },

  onUiLocaleChange() {
    this.syncFromStore({ app: store.state });
    this.applyFrame();
  },

  updateNavigationLayout() {
    let info = {}, rect = null;
    try { info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}; } catch (_) {}
    try { rect = wx.getMenuButtonBoundingClientRect(); } catch (_) {}
    const valid = rect && Number.isFinite(rect.top) && rect.top > 0 && Number.isFinite(rect.height) && rect.height > 0;
    this.setData({
      navPadTop: valid ? rect.top : (info.statusBarHeight || 44) + 6,
      navHeight: valid ? rect.height : 32,
    });
  },

  goBack() {
    wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/home/home' }); } });
  },

  // ---------- 弹窗 ----------

  noop() {},

  closeSheet() {
    this._sheetGrabY = 0;
    this._sheetDragY = 0;
    this.setData({ sheet: '', sheetDragY: 0, sheetDragging: false, componentPickerOpen: false });
  },

  /** 弹窗顶部拖动条：下拉关闭，松手未超阈值则回弹。 */
  onSheetGrabStart(e) {
    const touch = e.touches && e.touches[0];
    this._sheetGrabY = touch ? Number(touch.clientY) : 0;
    this._sheetDragY = 0;
    this.setData({ sheetDragging: true, sheetDragY: 0 });
  },

  onSheetGrabMove(e) {
    if (!this._sheetGrabY) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const dy = Math.max(0, Number(touch.clientY) - this._sheetGrabY);
    this._sheetDragY = dy;
    this.setData({ sheetDragY: dy });
  },

  onSheetGrabEnd() {
    const dy = this._sheetDragY || 0;
    this._sheetGrabY = 0;
    this._sheetDragY = 0;
    this.setData({ sheetDragging: false });
    if (dy > 120) this.closeSheet();
    else this.setData({ sheetDragY: 0 });
  },

  openDisplaySheet() { this.setData({ sheet: 'display', componentPickerOpen: false }); },
  openBalanceSheet() { this.setData({ sheet: 'balance' }); },
  openGoSheet() { this.setData({ sheet: 'go' }); },
  openBudgetSheet() { this.setData({ sheet: 'budget' }); },
  openPeakSheet() { this.setData({ sheet: 'peak' }); },

  openPlanSheet(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.planCells || [])[index];
    if (!cell) return;
    this.setData({ sheet: 'plan', sheetPlan: Object.assign({}, cell, { index }) });
  },
  openGatewaySheet(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.gatewayCells || [])[index];
    if (!cell) return;
    this.setData({ sheet: 'gateway', sheetGateway: Object.assign({}, cell, { index }) });
  },
  openCustomSheet(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.customCells || [])[index];
    if (!cell) return;
    this.setData({ sheet: 'custom', sheetCustom: Object.assign({}, cell, { index }), keyEditing: false });
  },

  /**
   * 弹窗里的字段编辑：同时写 cells（保存按钮按 index 取）与 sheet<Kind>（弹窗显示用）。
   * 输入过程中只写 cells、不回写显示值：setData 重写 input/textarea 的 value 会让
   * 真机上的光标跳回开头、长按粘贴菜单失效（用户反馈"输入法没法直接粘贴"）。
   * 失焦时再由 onXxxFieldBlur 补一次显示值同步。
   */
  syncSheetField(kind, index, field, value) {
    const cellsKey = kind + 'Cells';
    const sheetKey = 'sheet' + kind.charAt(0).toUpperCase() + kind.slice(1);
    const cells = (this.data[cellsKey] || []).map((cell, i) => (i === index ? Object.assign({}, cell, { [field]: value }) : cell));
    const patch = { [cellsKey]: cells };
    if (this._sheetEditing !== sheetKey + ':' + field) {
      patch[sheetKey] = Object.assign({}, this.data[sheetKey] || {}, { [field]: value, index });
    }
    this.setData(patch);
  },
  /** 失焦后把 cells 的最新值同步回弹窗显示（此时已离开输入态，回写 value 是安全的）。 */
  syncSheetDisplay(kind, index) {
    const sheetKey = 'sheet' + kind.charAt(0).toUpperCase() + kind.slice(1);
    const cell = (this.data[kind + 'Cells'] || [])[index];
    if (!cell) return;
    this._sheetEditing = '';
    this.setData({ [sheetKey]: Object.assign({}, cell, { index }) });
  },
  onCustomFieldInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this._sheetEditing = 'sheetCustom:' + field;
    const cells = (this.data.customCells || []).map((cell, i) => {
      if (i !== index) return cell;
      const next = Object.assign({}, cell, { [field]: e.detail.value });
      // 改请求头时同步占位符名：密钥注入到哪个请求头由它决定
      if (field === 'headersText') {
        try {
          const headers = this.jsonToHeaders(e.detail.value);
          next.keyVarName = this.headerPlaceholderVar(headers);
          next.keyVarLabel = this.keyVarLabelOf(headers);
        } catch (err) { next.keyVarName = ''; next.keyVarLabel = uiText('保存在电脑端凭据库'); }
      }
      return next;
    });
    this.setData({ customCells: cells });
  },
  onCustomFieldBlur(e) {
    this.syncSheetDisplay('custom', Number(e.currentTarget.dataset.index));
  },
  onGatewayFieldInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this._sheetEditing = 'sheetGateway:' + field;
    const cells = (this.data.gatewayCells || []).map((cell, i) => (i === index ? Object.assign({}, cell, { [field]: e.detail.value }) : cell));
    this.setData({ gatewayCells: cells });
  },
  onGatewayFieldBlur(e) {
    this.syncSheetDisplay('gateway', Number(e.currentTarget.dataset.index));
  },
  /** 密钥输入：draft 按 save 函数用的键存（plan/gateway 用 id，custom 用 index），并同步弹窗显示。 */
  onGatewayKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.gatewayCells || [])[index];
    if (!cell) return;
    const drafts = Object.assign({}, this.data.gatewayKeyDrafts, { [cell.id]: e.detail.value });
    this.setData({ gatewayKeyDrafts: drafts });
  },
  onGatewayKeyBlur(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
    const index = Number(dataset.index != null ? dataset.index : (this.data.sheetGateway || {}).index);
    const cell = (this.data.gatewayCells || [])[index];
    this._sheetEditing = '';
    const id = cell && cell.id;
    this.setData({ 'sheetGateway.keyDraft': (this.data.gatewayKeyDrafts || {})[id] || '' });
  },
  onCustomKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const drafts = Object.assign({}, this.data.customKeyDrafts, { [index]: e.detail.value });
    this.setData({ customKeyDrafts: drafts });
  },
  onCustomKeyBlur(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
    const index = Number(dataset.index != null ? dataset.index : (this.data.sheetCustom || {}).index);
    this._sheetEditing = '';
    this.setData({ 'sheetCustom.keyDraft': (this.data.customKeyDrafts || {})[index] || '' });
  },
  onPlanKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.planCells || [])[index];
    if (!cell) return;
    const drafts = Object.assign({}, this.data.planKeyDrafts, { [cell.id]: e.detail.value });
    this.setData({ planKeyDrafts: drafts });
  },
  onPlanKeyBlur(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
    const index = Number(dataset.index != null ? dataset.index : (this.data.sheetPlan || {}).index);
    const cell = (this.data.planCells || [])[index];
    this._sheetEditing = '';
    const id = cell && cell.id;
    this.setData({ 'sheetPlan.keyDraft': (this.data.planKeyDrafts || {})[id] || '' });
  },
  onPlanFieldInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = Number(e.currentTarget.dataset.field);
    this._sheetEditing = 'sheetPlan.fields';
    const cells = (this.data.planCells || []).map((cell, i) => {
      if (i !== index) return cell;
      const fields = (cell.fields || []).map((f, fi) => (fi === field ? Object.assign({}, f, { value: e.detail.value }) : f));
      return Object.assign({}, cell, { fields });
    });
    this.setData({ planCells: cells });
  },
  onPlanFieldBlur(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.planCells || [])[index];
    this._sheetEditing = '';
    if (cell) this.setData({ sheetPlan: cell });
  },

  syncFromStore(snapshot) {
    const app = (snapshot && snapshot.app) || store.state || {};
    const connected = app.connection === 'connected';
    const supported = Array.isArray(app.gatewayCapabilities) && app.gatewayCapabilities.includes('cost-meter-v1');
    const owner = costView.dashboardOwner(app);
    if (owner !== this.owner) {
      this.owner = owner;
      this.requestGeneration = (this.requestGeneration || 0) + 1;
      this.requestInFlight = false;
      this.loadedFor = '';
    }
    this.setData({ connected, supported });
    if (!connected) {
      this.setData({ loading: false, error: uiText('请先连接电脑端网关') });
      return;
    }
    if (!supported) {
      this.setData({ loading: false, error: uiText('额度卡片需要重启或更新网关') });
      return;
    }
    if (!this.loadedFor || (!this.data.view && !this.requestInFlight)) this.loadAll(false);
  },

  isCurrent(generation, owner) {
    return this.alive && this.requestGeneration === generation && owner === costView.dashboardOwner(store.state)
      && store.state.connection === 'connected';
  },

  async loadAll(force) {
    if (!this.alive || store.state.connection !== 'connected' || this.requestInFlight) return;
    const generation = this.requestGeneration = (this.requestGeneration || 0) + 1;
    const owner = this.owner;
    this.requestInFlight = true;
    this.setData({ loading: true, error: '' });
    try {
      const configFrame = await store.client.requestCostMeter('config');
      if (!this.isCurrent(generation, owner)) return;
      const firstLoad = !this.loadedFor;
      this.applyFrame(configFrame);
      this.loadedFor = owner;
      this.setData({ loading: false });
      if (firstLoad || force !== false) this.refreshAll();
    } catch (error) {
      if (!this.isCurrent(generation, owner)) return;
      this.setData({ loading: false, error: (error && error.message) || uiText('额度数据读取失败') });
      // 刚启动/刚重连时客户端可能还没进入 connected 状态：稍后自动重试，避免页面停在“读取失败”。
      if ((this._costRetry || 0) < 3) {
        this._costRetry = (this._costRetry || 0) + 1;
        setTimeout(() => { this._costRetry = 0; if (this.alive && store.state.connection === 'connected') this.loadAll(force); }, 1200 * this._costRetry);
      }
    } finally {
      if (this.requestGeneration === generation) this.requestInFlight = false;
    }
  },

  async refreshAll() {
    if (!this.alive || store.state.connection !== 'connected' || this.data.refreshing) return;
    const generation = this.requestGeneration;
    const owner = this.owner;
    this.setData({ refreshing: true, error: '' });
    try {
      const frame = await store.client.requestCostMeter('refresh');
      if (!this.isCurrent(generation, owner)) return;
      this.applyFrame(frame);
    } catch (error) {
      if (!this.isCurrent(generation, owner)) return;
      this.setData({ error: (error && error.message) || uiText('额度数据读取失败') });
    } finally {
      if (this.alive) this.setData({ refreshing: false });
    }
  },

  async refreshSource(source) {
    if (!this.alive || store.state.connection !== 'connected') return;
    const generation = this.requestGeneration;
    const owner = this.owner;
    this.setData({ saving: source });
    try {
      const frame = await store.client.requestCostMeter('refresh-source', { source });
      if (!this.isCurrent(generation, owner)) return;
      if (frame && frame.dashboard) {
        this.setData({ dashboard: frame.dashboard });
        this.applyFrame({ config: this.data.config, dashboard: frame.dashboard });
      }
    } catch (error) {
      if (!this.isCurrent(generation, owner)) return;
      wx.showToast({ title: (error && error.message) || uiText('刷新失败'), icon: 'none' });
    } finally {
      if (this.alive) this.setData({ saving: '' });
    }
  },

  applyFrame(frame = {}) {
    if (frame.config) this.config = frame.config;
    if (frame.dashboard) this.dashboardFrame = frame.dashboard;
    if (frame.sources) this.sourcesFrame = frame.sources;
    if (frame.summary) this.summaryFrame = frame.summary;
    if (!this.config && this.data.config) this.config = this.data.config;
    if (!this.dashboardFrame && this.data.dashboard) this.dashboardFrame = this.data.dashboard;
    if (!this.sourcesFrame && this.data.sources) this.sourcesFrame = this.data.sources;

    // 同一份 frame 被反复 apply（store 广播 / refresh 回调）时，帧内容不变就不重建，
    // 否则 15 家 plan + 预览区全量 map + JSON.stringify 深比较会让页面滑动明显卡顿。
    // 用三个帧对象的引用做指纹：同一帧对象重复 apply 直接跳过。
    if (this._applyStamp
      && this._applyStamp[0] === this.config
      && this._applyStamp[1] === this.dashboardFrame
      && this._applyStamp[2] === this.sourcesFrame
      && this._applyStamp[3] === this.summaryFrame
      && this.data.view) return;
    this._applyStamp = [this.config, this.dashboardFrame, this.sourcesFrame, this.summaryFrame];

    const config = this.config || {};
    const view = costView.normalizeQuotaDashboard(this.dashboardFrame, this.summaryFrame);
    const display = config.display || {};
    const peak = config.peak || {};
    const sidebarOrder = Array.isArray(config.sidebarOrder) ? config.sidebarOrder : [];
    const sidebarOrderCells = this.buildSidebarOrderCells(config, view, sidebarOrder);
    const plans = (this.sourcesFrame && Array.isArray(this.sourcesFrame.plans) ? this.sourcesFrame.plans : []).map(meta => {
      const settings = (config.codingPlans && config.codingPlans[meta.id]) || meta.settings || {};
      const result = view && view.plans ? (view.plans.find(item => item.id === meta.id) || {}) : {};
      return {
        id: meta.id,
        label: meta.label,
        enabled: settings.enabled === true,
        display: settings.display || 'settings',
        displayLabel: this.displayLabel(settings.display || 'settings'),
        refreshMinutes: settings.refreshMinutes || 15,
        status: result.status || 'pending',
        message: result.message || '',
        configured: meta.needsSecret ? meta.configured === true : meta.configured !== false,
        needsSecret: meta.needsSecret === true,
        noKey: meta.noKey === true,
        fields: (meta.fields || []).map(key => ({
          key,
          label: PLAN_FIELD_LABELS[key] || key,
          type: key === 'planCredits' ? 'number' : 'text',
          value: settings[key] === undefined || settings[key] === null ? '' : String(settings[key]),
        })),
        rows: result.rows || [],
        expanded: this.data.expandedPlan === meta.id,
        keyDraft: (this.data.planKeyDrafts || {})[meta.id] || '',
      };
    });
    const customSource = this.sourcesFrame && Array.isArray(this.sourcesFrame.customBalances) ? this.sourcesFrame.customBalances : [];
    const customCells = (Array.isArray(config.customBalances) ? config.customBalances : []).map((entry, index) => {
      const result = view && view.custom ? (view.custom.find(item => item.index === index) || {}) : {};
      return Object.assign({}, entry, {
        index,
        status: result.status || 'pending',
        message: result.message || '',
        amountText: result.amountText || '—',
        maxText: result.maxText || '',
        percentText: result.percentText || '—',
        barWidth: result.barWidth || '0%',
        displayLabel: this.displayLabel(entry.display),
        refreshLabel: this.refreshLabel(entry.refreshMinutes),
        keyConfigured: !!(customSource[index] && customSource[index].configured),
        keyDraft: (this.data.customKeyDrafts || {})[index] || '',
        expanded: this.data.expandedCustom === index,
        headersText: this.headersToText(entry.request && entry.request.headers),
        bodyText: this.bodyToText(entry.request && entry.request.body),
        extractText: this.extractToText(entry.extract),
        keyVarName: this.headerPlaceholderVar(entry.request && entry.request.headers),
        keyVarLabel: this.keyVarLabelOf(entry.request && entry.request.headers),
        allowedHostsText: (entry.allowedHosts || []).join(','),
      });
    });
    const gatewaySource = this.sourcesFrame && Array.isArray(this.sourcesFrame.gatewayQuotas) ? this.sourcesFrame.gatewayQuotas : [];
    const gatewayCells = ((config.gatewayQuotas && config.gatewayQuotas.sources) || []).map((source, index) => {
      const result = view && view.gateway ? (view.gateway.find(item => item.id === source.id) || {}) : {};
      return Object.assign({}, source, {
        index,
        status: result.status || 'pending',
        message: result.message || '',
        accounts: result.accounts || [],
        displayLabel: this.displayLabel(source.display),
        refreshLabel: this.refreshLabel(source.refreshMinutes),
        keyConfigured: !!(gatewaySource[index] && gatewaySource[index].keyConfigured) || result.keyConfigured === true,
        allowedHostsText: (source.allowedHosts || []).join(','),
        keyDraft: (this.data.gatewayKeyDrafts || {})[source.id] || '',
        expanded: this.data.expandedGateway === index,
      });
    });
    const budget = (this.summaryFrame && this.summaryFrame.budget) || {};
    this._costRetry = 0;
    // 预览模型要在 setData 之前算好：它读 this.data.displayForm，而 displayForm 正是这次
    // setData 要写入的新值，放到 setData 里调用只会读到上一次的旧表单。
    const nextDisplayForm = {
      currency: config.currency || 'CNY',
      symbol: config.symbol || (config.currency === 'USD' ? '$' : (config.currency === 'EUR' ? '€' : '¥')),
      decimals: config.decimals === undefined ? 3 : config.decimals,
      exchangeRate: config.exchangeRate === undefined ? 7.2 : config.exchangeRate,
      exchangeRateAuto: config.exchangeRateAuto === true,
      sidebarStyle: display.sidebarStyle || 'standard',
      sidebarVisible: display.sidebarVisible === true,
      sidebarTodayMetric: display.sidebarTodayMetric || 'both',
      sidebarTodayBalanceInline: display.sidebarTodayBalanceInline === true,
      peakStyle: display.peakStyle || 'progress',
      peakTimeDisplay: display.peakTimeDisplay || 'both',
    };
    const previewSidebar = this.previewSidebarFrom(nextDisplayForm);
    const previewSections = previewSidebar && !previewSidebar.empty
      ? costView.quotaSidebarSections(previewSidebar, sidebarOrder)
      : [];
    this.setData({
      config,
      dashboard: this.dashboardFrame || null,
      summary: this.summaryFrame || null,
      sources: this.sourcesFrame || null,
      view,
      displayForm: nextDisplayForm,
      balanceForm: Object.assign({ enabled: true, display: 'both', refreshMinutes: 5, showProgressBar: false, barDirection: 'remaining' }, config.balance || {}),
      goForm: Object.assign({ enabled: false, display: 'both', refreshMinutes: 15, main: 'rolling', barDirection: 'used', detail: true }, config.goQuota || {}),
      // 设置项取 config.budget（用户可改的开关），运行时段值取 summaryFrame.budget
      budgetForm: {
        enabled: (config.budget && config.budget.enabled) === true,
        amount: config.budget && config.budget.amount !== undefined && config.budget.amount !== null ? String(config.budget.amount) : '',
        period: (config.budget && config.budget.period) || 'month',
        customStart: (config.budget && config.budget.customStart) || '',
        customEnd: (config.budget && config.budget.customEnd) || '',
        detail: !config.budget || config.budget.detail !== false,
        barDirection: config.budget && config.budget.barDirection === 'remaining' ? 'remaining' : 'used',
        display: (config.budget && config.budget.display) || 'both',
        percentText: budget.enabled ? costView.quotaPercentText(budget.percent) : '',
        barWidth: budget.enabled ? costView.quotaBarWidth(budget.percent) : '0%',
        usedText: budget.enabled ? costView.quotaAmountText(budget.used, config.currency, config.decimals, config.symbol) : '',
        amountText: budget.enabled ? costView.quotaAmountText(budget.amount, config.currency, config.decimals, config.symbol) : '',
      },
      peakForm: {
        enabled: peak.enabled !== false,
        display: peak.display || 'both',
        style: display.peakStyle || 'progress',
        peakTimeDisplay: display.peakTimeDisplay || 'both',
        peakAlertEnabled: peak.peakAlertEnabled === true,
        peakAlertAhead: peak.peakAlertAhead === undefined ? 2 : peak.peakAlertAhead,
        peakAlertTarget: peak.peakAlertTarget || 'both',
        peakAlertPosition: peak.peakAlertPosition || 'corner',
        holidaysText: (peak.holidays || []).join(', '),
        windowsLabel: this.formatPeakWindows(peak.windows),
      },
      planCells: plans,
      customCells,
      gatewayCells,
      sidebarOrderCells,
      previewSidebar,
      previewSections,
    });
    theme.applyTo(this);
    this.refreshPreviewInspector();
    this.applyPendingComponent();
  },

  /** 从左侧栏点某个模块进来：数据就绪后打开显示设置并选中该组件。 */
  applyPendingComponent() {
    const pending = this._pendingComponent;
    if (!pending) return;
    const list = this.previewComponents();
    if (!list.some(item => item.id === pending) || !this.data.previewSidebar) return;
    this._pendingComponent = '';
    this.setData({ previewComponent: pending, sheet: 'display', componentPickerOpen: false });
    this.refreshPreviewInspector();
  },

  /** 预览用侧栏模型：与 home 页同一套 quotaSidebarModel，使用参考插件同款示例数据。 */
  buildPreviewSidebar(displayForm) {
    const form = displayForm || this.data.displayForm || {};
    if (form.sidebarVisible !== true) return null;
    const view = costView.normalizeQuotaDashboard(this.previewDashboard(form), this.previewSummary(form));
    if (!view) return null;
    return costView.quotaSidebarModel(view, form.sidebarStyle);
  },

  /** 预览示例数据（与 dsh-cost-meter 插件 displayPreviewData 对齐，不写入账本）。 */
  previewDashboard(form) {
    const currency = form.currency || 'CNY';
    return {
      currency,
      symbol: form.symbol || (currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '¥'),
      decimals: form.decimals === undefined ? 3 : form.decimals,
      exchangeRate: form.exchangeRate || 7.2,
      display: {
        sidebarStyle: form.sidebarStyle || 'standard',
        sidebarVisible: true,
        sidebarTodayMetric: form.sidebarTodayMetric || 'both',
        peakStyle: form.peakStyle || 'progress',
        peakTimeDisplay: form.peakTimeDisplay || 'both',
        sidebarTodayBalanceInline: form.sidebarTodayBalanceInline === true,
      },
      balance: {
        enabled: true, display: 'both', status: 'ok', totalBalance: 68, currency,
        granted: 8, toppedUp: 60,
        showProgressBar: (this.config && this.config.balance && this.config.balance.showProgressBar) === true,
        barDirection: (this.config && this.config.balance && this.config.balance.barDirection) || 'remaining',
      },
      goQuota: {
        enabled: true, display: 'both', status: 'ok', main: 'rolling',
        detail: !(this.config && this.config.goQuota && this.config.goQuota.detail === false),
        barDirection: (this.config && this.config.goQuota && this.config.goQuota.barDirection) || 'used',
        rolling: { percent: 24, resetsAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString() },
        weekly: { percent: 18, resetsAt: new Date(Date.now() + 2 * 86400000).toISOString() },
        monthly: { percent: 12, resetsAt: new Date(Date.now() + 9 * 86400000).toISOString() },
      },
      plans: [{
        id: 'minimax', label: 'MiniMax Plan', enabled: true, display: 'both', status: 'ok',
        windows: { '5h': { percent: 35 }, '7d': { percent: 62 } },
      }],
      gatewayQuotas: [],
      customBalances: [],
      peak: {
        enabled: true, display: 'both', effectiveAt: '',
        windows: [{ start: 1, end: 4 }, { start: 6, end: 10 }], holidays: [],
      },
      settings: {},
    };
  },

  previewSummary(form) {
    const amount = Math.max(0, Number(form && this.data.budgetForm && this.data.budgetForm.amount) || 100);
    return {
      today: { amount: 4.608, tokens: 246000, calls: 14 },
      budget: { enabled: true, amount, used: Math.round(amount * 57) / 100, percent: 57, period: 'month' },
    };
  },
  buildPreviewSections() {
    const sidebar = this.buildPreviewSidebar();
    if (!sidebar || sidebar.empty) return [];
    const order = (this.config && this.config.sidebarOrder) || [];
    return costView.quotaSidebarSections(sidebar, order);
  },

  /** applyFrame 内部用：基于即将写入的 displayForm 算预览，避免读到上一次的旧表单。 */
  previewSidebarFrom(displayForm) {
    return this.buildPreviewSidebar(displayForm);
  },

  /** 预览检查器：可调整的组件清单（与侧栏分区一一对应）。 */
  previewComponents() {
    const cells = [
      { id: 'today', label: uiText('今日'), path: 'display' },
      { id: 'balance', label: uiText('余额'), path: 'balance' },
      { id: 'budget', label: uiText('预算'), path: 'budget' },
      { id: 'go', label: 'OpenCode Go', path: 'goQuota' },
      { id: 'peak', label: uiText('峰谷'), path: 'peak' },
    ];
    const plans = ((this.sourcesFrame && this.sourcesFrame.plans) || []).map(meta => ({
      id: 'plan:' + meta.id, label: meta.label || meta.id, path: 'codingPlans.' + meta.id,
    }));
    const gateway = ((this.config && this.config.gatewayQuotas && this.config.gatewayQuotas.sources) || []).map(source => ({
      id: 'gateway:' + source.id, label: source.label || source.id, path: 'gatewayQuotas.sources.' + source.id,
    }));
    const custom = (this.data.customCells || []).map((cell, index) => ({
      id: 'custom:' + index, label: cell.label || cell.labelEn || (uiText('自定义余额') + ' ' + (index + 1)),
      path: 'customBalances.' + index,
    }));
    return cells.concat(plans, gateway, custom);
  },

  previewComponentMeta() {
    const list = this.previewComponents();
    return list.find(item => item.id === this.data.previewComponent) || list[0] || null;
  },

  previewComponentLabel() {
    const meta = this.previewComponentMeta();
    return meta ? meta.label : uiText('预算');
  },

  /** 当前组件在配置里的 display 值（用于「显示位置」行）。 */
  previewComponentDisplay() {
    const meta = this.previewComponentMeta();
    if (!meta) return 'both';
    const parts = meta.path.split('.');
    let node = this.config || {};
    for (const part of parts) {
      if (node == null) return 'both';
      node = node[part];
    }
    if (Array.isArray(node)) node = node[Number(parts[parts.length - 1])] || {};
    return (node && node.display) || 'both';
  },

  previewComponentDisplayLabel() {
    const meta = this.previewComponentMeta();
    if (meta && meta.id === 'today') {
      const metric = (this.config && this.config.display && this.config.display.sidebarTodayMetric) || 'both';
      return metric === 'amount' ? uiText('仅金额') : metric === 'tokens' ? uiText('仅 Token') : uiText('金额 + Token');
    }
    return this.displayLabel(this.previewComponentDisplay());
  },

  /** 当前组件是否启用（balance/go/peak 用 enabled，plan/gateway/custom 用 enabled）。 */
  previewComponentEnabled() {
    const meta = this.previewComponentMeta();
    if (!meta) return false;
    if (meta.id === 'today') return ((this.config && this.config.display && this.config.display.sidebarTodayMetric) || 'both') !== 'off';
    if (meta.id === 'budget') return this.data.budgetForm.enabled === true;
    const parts = meta.path.split('.');
    let node = this.config || {};
    for (const part of parts) {
      if (node == null) return false;
      node = node[part];
    }
    if (Array.isArray(node)) node = node[Number(parts[parts.length - 1])] || {};
    return node && node.enabled === true;
  },

  toggleComponentPicker() {
    const options = this.previewComponents();
    if (!options.length) { wx.showToast({ title: uiText('暂无可调整组件'), icon: 'none' }); return; }
    this.setData({ componentPickerOpen: !this.data.componentPickerOpen, previewComponentOptions: options });
  },

  choosePreviewComponent(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ previewComponent: id, componentPickerOpen: false });
    this.refreshPreviewInspector();
  },

  /** 通用小列表选择（弹窗内的单选项，最多 3 项）。 */
  pickPanelOption(items, onPick) {
    wx.showActionSheet({
      itemList: items.map(item => item.label),
      success: res => { const item = items[res.tapIndex]; if (item) onPick(item); },
    });
  },

  pickTodayMetric() {
    this.pickPanelOption([
      { id: 'both', label: uiText('金额 + Token') },
      { id: 'amount', label: uiText('仅金额') },
      { id: 'tokens', label: uiText('仅 Token') },
    ], item => {
      this.setData({ 'displayForm.sidebarTodayMetric': item.id });
      this.commitPatch({ display: { sidebarTodayMetric: item.id } });
      this.refreshPreviewInspector();
    });
  },

  pickPeakStyle() {
    this.pickPanelOption([{ id: 'progress', label: uiText('进度条') }, { id: 'classic', label: uiText('经典') }], item => {
      this.setData({ 'peakForm.style': item.id });
      this.commitPatch({ display: { peakStyle: item.id } });
    });
  },

  pickPeakTimeDisplay() {
    this.pickPanelOption([
      { id: 'both', label: uiText('倒计时 + 切换时间') },
      { id: 'countdown', label: uiText('只看倒计时') },
      { id: 'switch', label: uiText('只看切换时间') },
    ], item => {
      this.setData({ 'displayForm.peakTimeDisplay': item.id, 'peakForm.peakTimeDisplay': item.id });
      this.commitPatch({ display: { peakTimeDisplay: item.id } });
    });
  },

  pickBalanceBarDirection() {
    this.pickPanelOption([{ id: 'remaining', label: uiText('剩余') }, { id: 'used', label: uiText('已用') }], item => {
      this.setData({ 'balanceForm.barDirection': item.id });
      this.commitPatch({ balance: { barDirection: item.id } });
    });
  },

  pickBudgetBarDirection() {
    this.pickPanelOption([{ id: 'used', label: uiText('已用') }, { id: 'remaining', label: uiText('剩余') }], item => {
      this.setData({ 'budgetForm.barDirection': item.id });
      this.commitPatch({ budget: { barDirection: item.id } });
    });
  },

  pickGoBarDirection() {
    this.pickPanelOption([{ id: 'used', label: uiText('已用') }, { id: 'remaining', label: uiText('剩余') }], item => {
      this.setData({ 'goForm.barDirection': item.id });
      this.commitPatch({ goQuota: { barDirection: item.id } });
    });
  },

  pickGoMain() {
    this.pickPanelOption([
      { id: 'rolling', label: uiText('滚动 5 小时') },
      { id: 'weekly', label: uiText('本周') },
      { id: 'monthly', label: uiText('本月') },
    ], item => {
      this.setData({ 'goForm.main': item.id });
      this.commitPatch({ goQuota: { main: item.id } });
    });
  },

  /** 点击预览里的任意分区，检查器跟随选中该组件（与参考插件一致）。 */
  onSidebarPartTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    if (key === this.data.previewComponent) return;
    this.setData({ previewComponent: key, componentPickerOpen: false });
    this.refreshPreviewInspector();
  },

  /** 把检查器依赖的派生值写回 data（WXML 不能直接调用方法）。 */
  refreshPreviewInspector() {
    const options = this.previewComponents();
    const meta = options.find(item => item.id === this.data.previewComponent) || options[0] || null;
    this.setData({
      previewComponentOptions: options,
      previewComponentLabel: meta ? meta.label : '',
      previewComponentDisplayLabel: this.displayLabel(this.previewComponentDisplay()),
      previewComponentEnabled: this.previewComponentEnabled(),
    });
  },

  pickPreviewDisplay() {
    const meta = this.previewComponentMeta();
    if (!meta) return;
    this.pickDisplay(value => {
      this.commitComponentDisplay(meta, value);
    });
  },

  /** 把 display 写到组件对应的配置路径。 */
  commitComponentDisplay(meta, value) {
    const id = meta.id;
    if (id === 'balance') { this.setData({ 'balanceForm.display': value }); this.commitPatch({ balance: { display: value } }); return; }
    if (id === 'budget') { this.setData({ 'budgetForm.display': value }); this.commitPatch({ budget: { display: value } }); return; }
    if (id === 'go') { this.setData({ 'goForm.display': value }); this.commitPatch({ goQuota: { display: value } }); return; }
    if (id === 'peak') { this.setData({ 'peakForm.display': value }); this.commitPatch({ peak: { display: value } }); return; }
    if (id.indexOf('plan:') === 0) {
      const planId = id.slice(5);
      const cells = (this.data.planCells || []).map(cell => cell.id === planId ? Object.assign({}, cell, { display: value, displayLabel: this.displayLabel(value) }) : cell);
      this.setData({ planCells: cells });
      this.commitPatch({ codingPlans: { [planId]: { display: value } } });
      return;
    }
    if (id.indexOf('gateway:') === 0) {
      const sourceId = id.slice(8);
      const cells = (this.data.gatewayCells || []).map(cell => cell.id === sourceId ? Object.assign({}, cell, { display: value, displayLabel: this.displayLabel(value) }) : cell);
      this.setData({ gatewayCells: cells });
      const sources = ((this.config && this.config.gatewayQuotas && this.config.gatewayQuotas.sources) || []).map(source => source.id === sourceId ? Object.assign({}, source, { display: value }) : source);
      this.commitPatch({ gatewayQuotas: { sources } });
      return;
    }
    if (id.indexOf('custom:') === 0) {
      const index = Number(id.slice(7));
      const cells = (this.data.customCells || []).map((cell, i) => i === index ? Object.assign({}, cell, { display: value, displayLabel: this.displayLabel(value) }) : cell);
      this.setData({ customCells: cells });
      const entries = (this.data.config.customBalances || []).map((entry, i) => i === index ? Object.assign({}, entry, { display: value }) : entry);
      this.commitPatch({ customBalances: entries });
    }
  },

  togglePreviewComponent(e) {
    const on = !!(e && e.detail && e.detail.value);
    const meta = this.previewComponentMeta();
    if (!meta) return;
    const id = meta.id;
    if (id === 'today') { this.setData({ 'displayForm.sidebarTodayMetric': on ? 'both' : 'amount' }); this.commitPatch({ display: { sidebarTodayMetric: on ? 'both' : 'amount' } }); return; }
    if (id === 'balance') { this.setData({ 'balanceForm.enabled': on }); this.commitPatch({ balance: { enabled: on } }); return; }
    if (id === 'budget') { this.setData({ 'budgetForm.enabled': on }); this.commitPatch({ budget: { enabled: on } }); return; }
    if (id === 'go') { this.setData({ 'goForm.enabled': on }); this.commitPatch({ goQuota: { enabled: on } }); return; }
    if (id === 'peak') { this.setData({ 'peakForm.enabled': on }); this.commitPatch({ peak: { enabled: on } }); return; }
    if (id.indexOf('plan:') === 0) {
      const planId = id.slice(5);
      const cells = (this.data.planCells || []).map(cell => cell.id === planId ? Object.assign({}, cell, { enabled: on }) : cell);
      this.setData({ planCells: cells });
      this.commitPatch({ codingPlans: { [planId]: { enabled: on } } });
      return;
    }
    if (id.indexOf('gateway:') === 0) {
      const sourceId = id.slice(8);
      const cells = (this.data.gatewayCells || []).map(cell => cell.id === sourceId ? Object.assign({}, cell, { enabled: on }) : cell);
      this.setData({ gatewayCells: cells });
      const sources = ((this.config && this.config.gatewayQuotas && this.config.gatewayQuotas.sources) || []).map(source => source.id === sourceId ? Object.assign({}, source, { enabled: on }) : source);
      this.commitPatch({ gatewayQuotas: { sources } });
      return;
    }
    if (id.indexOf('custom:') === 0) {
      const index = Number(id.slice(7));
      const cells = (this.data.customCells || []).map((cell, i) => i === index ? Object.assign({}, cell, { enabled: on }) : cell);
      this.setData({ customCells: cells });
      const entries = (this.data.config.customBalances || []).map((entry, i) => i === index ? Object.assign({}, entry, { enabled: on }) : entry);
      this.commitPatch({ customBalances: entries });
    }
  },

  /**
   * 构造侧栏排序行：把所有可见分区列出来（含 plan:<id>/gateway:<id>/custom:<index>），
   * 已启用且 display 允许进侧栏的才参与；未配置 sidebarOrder 时用默认顺序。
   */
  buildSidebarOrderCells(config, view, order) {
    const plans = ((this.sourcesFrame && this.sourcesFrame.plans) || []).map(meta => {
      const settings = (config.codingPlans && config.codingPlans[meta.id]) || {};
      return { key: 'plan:' + meta.id, label: meta.label || meta.id, enabled: settings.enabled === true, display: settings.display || 'settings' };
    });
    const gateway = ((config.gatewayQuotas && config.gatewayQuotas.sources) || []).map(source => ({
      key: 'gateway:' + source.id, label: source.label || source.id, enabled: source.enabled !== false, display: source.display || 'both',
    }));
    const custom = (config.customBalances || []).map((entry, index) => ({
      key: 'custom:' + index, label: entry.label || entry.labelEn || ('自定义余额 ' + (index + 1)),
      enabled: entry.enabled === true, display: entry.display || 'both',
    }));
    const fixed = [
      { key: 'balance', label: uiText('余额'), enabled: (config.balance || {}).enabled !== false, display: (config.balance || {}).display || 'both' },
      { key: 'budget', label: uiText('预算'), enabled: (config.budget || {}).enabled === true, display: (config.budget || {}).display || 'both' },
      { key: 'go', label: 'OpenCode Go', enabled: (config.goQuota || {}).enabled === true, display: (config.goQuota || {}).display || 'both' },
      { key: 'peak', label: uiText('峰谷'), enabled: (config.peak || {}).enabled !== false, display: (config.peak || {}).display || 'both' },
    ];

    const all = fixed.concat(plans, gateway, custom);
    const inSidebar = item => item.enabled && (item.display === 'sidebar' || item.display === 'both');
    const visible = all.filter(inSidebar);

    const cells = [];
    const used = new Set();
    const push = item => { if (item && !used.has(item.key)) { used.add(item.key); cells.push(item); } };
    if (Array.isArray(order)) {
      for (const key of order) {
        if (typeof key !== 'string') continue;
        const hit = visible.find(item => item.key === key.trim());
        if (hit) push(hit);
      }
    }
    // 未在排序配置里的可见分区按默认顺序补齐，保证用户总能调到每一项
    for (const item of visible) push(item);
    // 只列可见分区：不可见的 15 家 plan 全列会让这页渲染量暴涨、滑动卡顿。
    // 用户先在各家卡片的「显示位置」里设为侧栏/两者，这里才会出现可排序行。
    return cells;
  },

  moveSidebarOrder(e) {
    const index = Number(e.currentTarget.dataset.index);
    const dir = Number(e.currentTarget.dataset.dir);
    const cells = (this.data.sidebarOrderCells || []).slice();
    const target = index + dir;
    if (index < 0 || target < 0 || target >= cells.length) return;
    const picked = cells.splice(index, 1)[0];
    cells.splice(target, 0, picked);
    this.setData({ sidebarOrderCells: cells });
    this.commitPatch({ sidebarOrder: cells.map(item => item.key) });
  },
  resetSidebarOrder() {
    this.setData({ sidebarOrderCells: this.buildSidebarOrderCells(this.config || {}, this.dashboardFrame, []) });
    this.commitPatch({ sidebarOrder: [] });
  },

  displayLabel(display) {
    const found = costView.DISPLAY_OPTIONS.find(item => item.id === display);
    return found ? found.label : display;
  },
  refreshLabel(minutes) {
    const n = Number(minutes) || 15;
    return n + ' 分钟';
  },
  formatPeakWindows(windows) {
    return (Array.isArray(windows) ? windows : []).map(row => `${String(row.start).padStart(2, '0')}:00-${String(row.end).padStart(2, '0')}:00`).join(',');
  },
  /** 请求头/解析规则/请求体统一用 JSON 文本编辑（与桌面插件一致），非法 JSON 给出提示。 */
  headersToText(headers) {
    if (!headers || typeof headers !== 'object' || !Object.keys(headers).length) return '';
    try { return JSON.stringify(headers, null, 2); } catch (e) { return ''; }
  },
  /** 密钥值标签：显示占位符名（与桌面插件「凭据输入」一致），没有占位符时给保存位置说明。 */
  keyVarLabelOf(headers) {
    const name = this.headerPlaceholderVar(headers);
    return name ? '{{' + name + '}}' : uiText('保存在电脑端凭据库');
  },
  /** 请求头 JSON 里第一个 {{VAR}} 占位符名：与桌面插件一致，密钥就注入到这个请求头。 */
  headerPlaceholderVar(headers) {
    for (const value of Object.values(headers || {})) {
      if (typeof value !== 'string') continue;
      const match = value.match(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/);
      if (match) return match[1];
    }
    return '';
  },
  jsonToHeaders(text) {
    const value = String(text || '').trim();
    if (!value) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(uiText('请求头必须是 JSON 对象'));
    const headers = {};
    for (const [name, item] of Object.entries(parsed)) {
      if (typeof item !== 'string') throw new Error(uiText('请求头的值必须是字符串'));
      headers[String(name)] = item;
    }
    return headers;
  },
  extractToText(extract) {
    if (!extract || typeof extract !== 'object') return '';
    const keys = Object.keys(extract);
    if (!keys.length) return '';
    try { return JSON.stringify(extract, null, 2); } catch (e) { return ''; }
  },
  jsonToExtract(text) {
    const value = String(text || '').trim();
    if (!value) return {};
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(uiText('解析规则必须是 JSON 对象'));
    const extract = {};
    for (const key of ['remaining', 'maxBudget', 'spend', 'unit']) {
      const rule = parsed[key];
      if (rule === undefined || rule === null || rule === '') continue;
      extract[key] = typeof rule === 'string' ? rule : this.textToRule(String(rule));
    }
    return extract;
  },
  /** request.body 可能是字符串或 JSON 对象，统一转成可编辑文本。 */
  bodyToText(body) {
    if (body === undefined || body === null || body === '') return '';
    if (typeof body === 'string') return body;
    try { return JSON.stringify(body, null, 2); } catch (e) { return ''; }
  },
  textToBody(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    try { return JSON.parse(value); } catch (e) { return value; }
  },
  textToHeaders(text) {
    const headers = {};
    String(text || '').split('\n').forEach(line => {
      const index = line.indexOf(':');
      if (index <= 0) return;
      const name = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (name && value) headers[name] = value;
    });
    return headers;
  },
  ruleToText(rule) {
    if (!rule) return '';
    if (typeof rule === 'string') return rule;
    if (rule && Array.isArray(rule.paths)) return rule.op + ':' + rule.paths.join('|');
    return '';
  },
  textToRule(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    if (value.indexOf(':') > 0) {
      const parts = value.split(':');
      const op = parts[0] === 'add' ? 'add' : 'subtract';
      const paths = parts.slice(1).join(':').split('|').map(item => item.trim()).filter(Boolean);
      return paths.length > 1 ? { op, paths } : (paths[0] || '');
    }
    return value;
  },
  allowedHosts(text) {
    return String(text || '').split(',').map(item => item.trim()).filter(Boolean);
  },

  async commitPatch(patch, options = {}) {
    if (!this.alive || store.state.connection !== 'connected') return false;
    const generation = this.requestGeneration;
    const owner = this.owner;
    // 本地表单已改，先让 applyFrame 的帧缓存失效，否则预览不会反映这次编辑
    this._applyStamp = null;    this.setData({ saving: options.key || 'settings' });
    try {
      const frame = await store.client.requestCostMeter('update', { patch });
      if (!this.isCurrent(generation, owner)) return false;
      this.applyFrame(frame);
      if (!options.silent) wx.showToast({ title: uiText('已保存'), icon: 'success' });
      return true;
    } catch (error) {
      if (!this.isCurrent(generation, owner)) return false;
      wx.showToast({ title: (error && error.message) || uiText('保存失败'), icon: 'none' });
      return false;
    } finally {
      if (this.alive) this.setData({ saving: '' });
    }
  },

  async commitSourceKey(source, value, secret) {
    if (!this.alive || store.state.connection !== 'connected' || !value) return;
    try {
      const frame = await store.client.requestCostMeter('set-source-key', { source, value, ...(secret ? { secret } : {}) });
      if (frame && frame.kind === 'error') throw new Error(frame.message || uiText('保存失败'));
      wx.showToast({ title: uiText('已保存'), icon: 'success' });
      if (source.indexOf('plan:') === 0) {
        const id = source.slice(5);
        this.setData({ planKeyDrafts: Object.assign({}, this.data.planKeyDrafts, { [id]: '' }) });
      } else if (source.indexOf('custom:') === 0) {
        const index = Number(source.slice(7));
        this.setData({ customKeyDrafts: Object.assign({}, this.data.customKeyDrafts, { [index]: '' }) });
      } else if (source.indexOf('gateway:') === 0) {
        const id = source.slice(8);
        this.setData({ gatewayKeyDrafts: Object.assign({}, this.data.gatewayKeyDrafts, { [id]: '' }) });
      }
      this.refreshAll();
    } catch (error) {
      wx.showToast({ title: (error && error.message) || uiText('保存失败'), icon: 'none' });
    }
  },

  async clearSourceKey(source) {
    if (!this.alive || store.state.connection !== 'connected') return;
    try {
      const frame = await store.client.requestCostMeter('clear-source-key', { source });
      if (frame && frame.kind === 'error') throw new Error(frame.message || uiText('清除失败'));
      wx.showToast({ title: uiText('已清除'), icon: 'success' });
      this.refreshAll();
    } catch (error) {
      wx.showToast({ title: (error && error.message) || uiText('清除失败'), icon: 'none' });
    }
  },

  // ---------- display / format ----------

  pickCurrency() {
    wx.showActionSheet({ itemList: ['人民币 CNY', '美元 USD', '欧元 EUR'], success: res => {
      const currency = res.tapIndex === 0 ? 'CNY' : res.tapIndex === 1 ? 'USD' : 'EUR';
      const previous = this.data.displayForm || {};
      // 符号仅在仍是「旧币种默认值」时跟随切换；用户自定义过符号就保留，
      // 这样货币与符号可以分别编辑，不会互相覆盖。
      const previousDefault = previous.currency === 'USD' ? '$' : previous.currency === 'EUR' ? '€' : '¥';
      const customized = !!previous.symbol && previous.symbol !== previousDefault;
      const fallback = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : '€';
      const symbol = customized ? previous.symbol : fallback;
      this.setData({ displayForm: Object.assign({}, previous, { currency, symbol }) });
      this.commitPatch(customized ? { currency } : { currency, symbol });
    } });
  },

  onSymbolInput(e) {
    this.setData({ 'displayForm.symbol': e.detail.value });
  },
  onDecimalsInput(e) {
    this.setData({ 'displayForm.decimals': e.detail.value });
  },
  onExchangeRateInput(e) {
    this.setData({ 'displayForm.exchangeRate': e.detail.value });
  },
  commitDisplay() {
    // 空值/非法值不提交，避免 Number('')===0 触发插件校验报错把用户卡在错误态。
    const form = this.data.displayForm || {};
    const patch = {};
    if (String(form.symbol || '').trim()) patch.symbol = String(form.symbol).trim();
    const decimals = Number(form.decimals);
    if (Number.isInteger(decimals) && decimals >= 2 && decimals <= 6) patch.decimals = decimals;
    const rate = Number(form.exchangeRate);
    if (Number.isFinite(rate) && rate > 0 && rate <= 1000) patch.exchangeRate = rate;
    if (!Object.keys(patch).length) return;
    this.commitPatch(patch);
  },
  pickSidebarStyle(e) {
    const picked = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (picked) {
      this.setData({ 'displayForm.sidebarStyle': picked });
      this.commitPatch({ display: { sidebarStyle: picked } });
      return;
    }
    wx.showActionSheet({
      itemList: costView.SIDEBAR_STYLES.map(item => item.label),
      success: res => {
        const style = costView.SIDEBAR_STYLES[res.tapIndex];
        if (!style) return;
        this.setData({ 'displayForm.sidebarStyle': style.id });
        this.commitPatch({ display: { sidebarStyle: style.id } });
      },
    });
  },
  toggleSidebarVisible(e) {
    const visible = !!(e && e.detail && e.detail.value);
    this.setData({ 'displayForm.sidebarVisible': visible });
    this.commitPatch({ display: { sidebarVisible: visible } });
  },
  toggleTodayInline(e) {
    const inline = !!(e && e.detail && e.detail.value);
    this.setData({ 'displayForm.sidebarTodayBalanceInline': inline });
    this.commitPatch({ display: { sidebarTodayBalanceInline: inline } });
  },
  pickTodayMetric() {
    wx.showActionSheet({ itemList: ['仅金额', '仅 Token', '金额 + Token'], success: res => {
      const metric = res.tapIndex === 0 ? 'amount' : res.tapIndex === 1 ? 'tokens' : 'both';
      this.setData({ 'displayForm.sidebarTodayMetric': metric });
      this.commitPatch({ display: { sidebarTodayMetric: metric } });
    } });
  },
  pickPeakTimeDisplay() {
    wx.showActionSheet({ itemList: ['倒计时 + 切换时间', '只看倒计时', '只看切换时间'], success: res => {
      const value = res.tapIndex === 0 ? 'both' : res.tapIndex === 1 ? 'countdown' : 'switch';
      this.setData({ 'displayForm.peakTimeDisplay': value, 'peakForm.peakTimeDisplay': value });
      this.commitPatch({ display: { peakTimeDisplay: value } });
    } });
  },
  pickBarDirection(scope) {
    wx.showActionSheet({ itemList: ['已用', '剩余'], success: res => {
      const value = res.tapIndex === 0 ? 'used' : 'remaining';
      if (scope === 'balance') {
        this.setData({ 'balanceForm.barDirection': value });
        this.commitPatch({ balance: { barDirection: value } });
      } else {
        this.setData({ 'budgetForm.barDirection': value });
        this.commitPatch({ budget: { barDirection: value } });
      }
    } });
  },
  pickBalanceBarDirection() { this.pickBarDirection('balance'); },
  pickBudgetBarDirection() { this.pickBarDirection('budget'); },
  pickPeakStyle() {
    wx.showActionSheet({ itemList: ['进度条', '经典'], success: res => {
      const style = res.tapIndex === 0 ? 'progress' : 'classic';
      this.setData({ 'displayForm.peakStyle': style });
      this.commitPatch({ display: { peakStyle: style } });
    } });
  },

  // ---------- balance / go / budget / peak ----------

  toggleBalance(e) {
    const enabled = !!(e && e.detail && e.detail.value);
    this.setData({ 'balanceForm.enabled': enabled });
    this.commitPatch({ balance: { enabled } });
  },
  pickBalanceDisplay() { this.pickDisplay(value => { this.setData({ 'balanceForm.display': value }); this.commitPatch({ balance: { display: value } }); }); },
  pickBalanceRefresh() { this.pickRefresh(value => { this.setData({ 'balanceForm.refreshMinutes': value }); this.commitPatch({ balance: { refreshMinutes: value } }); }); },
  toggleBalanceProgress(e) {
    const show = !!(e && e.detail && e.detail.value);
    this.setData({ 'balanceForm.showProgressBar': show });
    this.commitPatch({ balance: { showProgressBar: show } });
  },
  onBalanceKeyInput(e) { this.setData({ balanceKeyDraft: e.detail.value }); },
  async saveBalanceKey() {
    const value = String(this.data.balanceKeyDraft || '').trim();
    if (!value) return;
    try {
      await store.client.requestCostMeter('set-balance-key', { value });
      this.setData({ balanceKeyDraft: '' });
      wx.showToast({ title: uiText('已保存'), icon: 'success' });
      this.refreshAll();
    } catch (error) { wx.showToast({ title: (error && error.message) || uiText('保存失败'), icon: 'none' }); }
  },
  async clearBalanceKey() {
    try {
      await store.client.requestCostMeter('clear-balance-key');
      wx.showToast({ title: uiText('已清除'), icon: 'success' });
      this.refreshAll();
    } catch (error) { wx.showToast({ title: (error && error.message) || uiText('清除失败'), icon: 'none' }); }
  },

  toggleGo(e) {
    const enabled = !!(e && e.detail && e.detail.value);
    this.setData({ 'goForm.enabled': enabled });
    this.commitPatch({ goQuota: { enabled } });
  },
  pickGoDisplay() { this.pickDisplay(value => { this.setData({ 'goForm.display': value }); this.commitPatch({ goQuota: { display: value } }); }); },
  pickGoRefresh() { this.pickRefresh(value => { this.setData({ 'goForm.refreshMinutes': value }); this.commitPatch({ goQuota: { refreshMinutes: value } }); }); },
  pickGoMain() {
    wx.showActionSheet({ itemList: ['滚动 5 小时', '本周', '本月'], success: res => {
      const main = ['rolling', 'weekly', 'monthly'][res.tapIndex];
      this.setData({ 'goForm.main': main });
      this.commitPatch({ goQuota: { main } });
    } });
  },
  pickGoDirection() {
    wx.showActionSheet({ itemList: ['显示已用百分比', '显示剩余百分比'], success: res => {
      const barDirection = res.tapIndex === 0 ? 'used' : 'remaining';
      this.setData({ 'goForm.barDirection': barDirection });
      this.commitPatch({ goQuota: { barDirection } });
    } });
  },
  toggleGoDetail(e) {
    const detail = !!(e && e.detail && e.detail.value);
    this.setData({ 'goForm.detail': detail });
    this.commitPatch({ goQuota: { detail } });
  },
  onGoKeyInput(e) { this.setData({ goKeyDraft: e.detail.value }); },
  async saveGoKey() {
    const value = String(this.data.goKeyDraft || '').trim();
    if (!value) return;
    try {
      await store.client.requestCostMeter('set-go-key', { value });
      this.setData({ goKeyDraft: '' });
      wx.showToast({ title: uiText('已保存'), icon: 'success' });
      this.refreshAll();
    } catch (error) { wx.showToast({ title: (error && error.message) || uiText('保存失败'), icon: 'none' }); }
  },
  async clearGoKey() {
    try {
      await store.client.requestCostMeter('clear-go-key');
      wx.showToast({ title: uiText('已清除'), icon: 'success' });
      this.refreshAll();
    } catch (error) { wx.showToast({ title: (error && error.message) || uiText('清除失败'), icon: 'none' }); }
  },

  toggleBudget(e) {
    const enabled = !!(e && e.detail && e.detail.value);
    this.setData({ 'budgetForm.enabled': enabled });
    this.commitPatch({ budget: { enabled } });
  },
  onBudgetAmountInput(e) { this.setData({ 'budgetForm.amount': e.detail.value }); },
  onBudgetCustomStart(e) { this.setData({ 'budgetForm.customStart': e.detail.value }); },
  onBudgetCustomEnd(e) { this.setData({ 'budgetForm.customEnd': e.detail.value }); },
  commitBudget() {
    const form = this.data.budgetForm;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount < 0) { wx.showToast({ title: uiText('请输入有效的预算金额'), icon: 'none' }); return; }
    const patch = { amount, enabled: form.enabled === true, period: form.period || 'month', detail: form.detail !== false };
    if (form.period === 'custom') {
      patch.customStart = String(form.customStart || '').trim();
      patch.customEnd = String(form.customEnd || '').trim();
    }
    this.commitPatch({ budget: patch });
  },
  toggleBudgetDetail(e) {
    const detail = !!(e && e.detail && e.detail.value);
    this.setData({ 'budgetForm.detail': detail });
    this.commitPatch({ budget: { detail } });
  },
  pickBudgetPeriod() {
    wx.showActionSheet({ itemList: BUDGET_PERIODS.map(item => item.label), success: res => {
      const period = BUDGET_PERIODS[res.tapIndex];
      if (!period) return;
      this.setData({ 'budgetForm.period': period.id });
      this.commitBudget();
    } });
  },
  pickBudgetDisplay() {
    this.pickDisplay(value => { this.setData({ 'budgetForm.display': value }); this.commitPatch({ budget: { display: value } }); });
  },

  togglePeak(e) {
    const enabled = !!(e && e.detail && e.detail.value);
    this.setData({ 'peakForm.enabled': enabled });
    this.commitPatch({ peak: { enabled } });
  },
  pickPeakDisplay() { this.pickDisplay(value => { this.setData({ 'peakForm.display': value }); this.commitPatch({ peak: { display: value } }); }); },
  editPeakWindows() {
    const current = this.data.peakForm.windowsLabel;
    wx.showModal({
      title: uiText('设置峰时段'),
      editable: true,
      placeholderText: '01:00-04:00,06:00-10:00',
      content: current,
      success: res => {
        if (!res.confirm) return;
        const ranges = String(res.content || '').split(',').map(item => item.trim()).filter(Boolean);
        const windows = [];
        for (const range of ranges) {
          const match = /^(\d{1,2}):00-(\d{1,2}):00$/.exec(range);
          if (!match) { wx.showToast({ title: uiText('格式示例：01:00-04:00'), icon: 'none' }); return; }
          const start = Number(match[1]), end = Number(match[2]);
          if (start > 23 || end > 24 || start === end) { wx.showToast({ title: uiText('峰时段小时范围无效'), icon: 'none' }); return; }
          windows.push({ start, end });
        }
        if (!windows.length) { wx.showToast({ title: uiText('至少填写一个峰时段'), icon: 'none' }); return; }
        this.setData({ 'peakForm.windowsLabel': this.formatPeakWindows(windows) });
        this.commitPatch({ peak: { windows } });
      },
    });
  },
  onPeakHolidaysInput(e) { this.setData({ 'peakForm.holidaysText': e.detail.value }); },
  commitPeakHolidays() {
    const days = String(this.data.peakForm.holidaysText || '')
      .split(/[,，\s]+/).map(item => item.trim()).filter(Boolean);
    const invalid = days.find(day => !/^\d{4}-\d{2}-\d{2}$/.test(day));
    if (invalid) { wx.showToast({ title: uiText('节假日应使用 YYYY-MM-DD 格式'), icon: 'none' }); return; }
    this.commitPatch({ peak: { holidays: days.slice(0, 100) } });
  },
  togglePeakAlert(e) {
    const on = !!(e && e.detail && e.detail.value);
    this.setData({ 'peakForm.peakAlertEnabled': on });
    this.commitPatch({ peak: { peakAlertEnabled: on } });
  },
  onPeakAlertAheadInput(e) { this.setData({ 'peakForm.peakAlertAhead': e.detail.value }); },
  commitPeakAlert() {
    const ahead = Number(this.data.peakForm.peakAlertAhead);
    if (!Number.isInteger(ahead) || ahead < 1 || ahead > 30) {
      wx.showToast({ title: uiText('提前提醒应为 1–30 分钟'), icon: 'none' });
      return;
    }
    this.commitPatch({ peak: { peakAlertAhead: ahead } });
  },
  pickPeakAlertTarget() {
    wx.showActionSheet({ itemList: ['峰和谷', '进入峰时', '进入谷时'], success: res => {
      const value = res.tapIndex === 0 ? 'both' : res.tapIndex === 1 ? 'peak' : 'offpeak';
      this.setData({ 'peakForm.peakAlertTarget': value });
      this.commitPatch({ peak: { peakAlertTarget: value } });
    } });
  },
  pickPeakAlertPosition() {
    wx.showActionSheet({ itemList: ['右下角', '屏幕中心'], success: res => {
      const value = res.tapIndex === 0 ? 'corner' : 'center';
      this.setData({ 'peakForm.peakAlertPosition': value });
      this.commitPatch({ peak: { peakAlertPosition: value } });
    } });
  },

  // ---------- generic pickers ----------

  pickDisplay(callback) {
    const items = costView.DISPLAY_OPTIONS.slice(0, 4);
    wx.showActionSheet({ itemList: items.map(item => item.label), success: res => {
      const option = items[res.tapIndex];
      if (option) callback(option.id);
    } });
  },
  pickRefresh(callback) {
    wx.showActionSheet({ itemList: REFRESH_OPTIONS.map(n => n + ' 分钟'), success: res => {
      const value = REFRESH_OPTIONS[res.tapIndex];
      if (value) callback(value);
    } });
  },

  // ---------- Coding Plans ----------

  togglePlan(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
    const enabled = !!(e && e.detail && e.detail.value);
    this.setData({ [`planCells[${index}].enabled`]: enabled });
    this.commitPatch({ codingPlans: { [cell.id]: { enabled } } });
  },
  pickPlanDisplay(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
    this.pickDisplay(value => {
      this.setData({ [`planCells[${index}].display`]: value });
      this.commitPatch({ codingPlans: { [cell.id]: { display: value } } });
    });
  },
  pickPlanRefresh(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
    this.pickRefresh(value => {
      this.setData({ [`planCells[${index}].refreshMinutes`]: value, [`planCells[${index}].refreshLabel`]: this.refreshLabel(value) });
      this.commitPatch({ codingPlans: { [cell.id]: { refreshMinutes: value } } });
    });
  },
  togglePlanExpand(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedPlan: this.data.expandedPlan === id ? '' : id });
    this.applyFrame();
  },
  onPlanFieldInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = Number(e.currentTarget.dataset.field);
    this.setData({ [`planCells[${index}].fields[${field}].value`]: e.detail.value });
  },
  savePlanFields(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
    const patch = {};
    (cell.fields || []).forEach(field => {
      patch[field.key] = field.type === 'number' ? Number(field.value) : field.value;
    });
    this.commitPatch({ codingPlans: { [cell.id]: patch } });
  },
  savePlanKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
    this.setData({ keyEditing: false });
    const draft = (this.data.planKeyDrafts || {})[cell.id] || '';
    let value = draft;
    let secret = '';
    if (cell.needsSecret) {
      const parts = String(draft).split(/\s*\|\|\s*/);
      value = parts[0] || '';
      secret = parts[1] || '';
      if (!value || !secret) { wx.showToast({ title: uiText('格式：AccessKeyID || SecretAccessKey'), icon: 'none' }); return; }
    }
    if (!value) { wx.showToast({ title: uiText('请输入凭据'), icon: 'none' }); return; }
    this.commitSourceKey('plan:' + cell.id, value, secret);
  },
  editPlanKey() { this.setData({ keyEditing: true }); },
  clearPlanKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    this.setData({ keyEditing: false });
    if (cell) this.clearSourceKey('plan:' + cell.id);
  },
  refreshPlan(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (cell) this.refreshSource('plan:' + cell.id);
  },

  // ---------- custom balances ----------

  async addCustom() {
    if (this.data.customCells.length >= 8) { wx.showToast({ title: uiText('最多配置 8 条自定义余额'), icon: 'none' }); return; }
    // 默认新增是空表单：用户自己填 URL/请求头/解析规则；
    // 「赛博」等预设只通过下方专属按钮添加，避免默认条目被误认为是自动填充的。
    const entries = (this.data.config.customBalances || []).concat([defaultCustomEntry()]);
    // 先标记展开再提交：commitPatch 内部的 applyFrame 会用当前 expandedCustom
    // 重建 customCells，若放在 await 之后，新条目会以收起态渲染，用户点"展开"
    // 反而变成收起，需要点两次才能编辑。
    this.setData({ expandedCustom: entries.length - 1 });
    await this.commitPatch({ customBalances: entries });
  },
  /** 按参考实现的预设新增：阿里云千问 / Token Rhythm / WorkBuddy2API 积分。 */
  async addCustomPreset(e) {
    const kind = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.kind;
    if (this.data.customCells.length >= 8) { wx.showToast({ title: uiText('最多配置 8 条自定义余额'), icon: 'none' }); return; }
    const entries = (this.data.config.customBalances || []).concat([customPreset(kind)]);
    this.setData({ expandedCustom: entries.length - 1 });
    await this.commitPatch({ customBalances: entries });
  },
  async saveCustom(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.customCells[index];
    if (!cell) return;
    const entries = (this.data.config.customBalances || []).slice();
    const previous = entries[index] || defaultCustomEntry();
    entries[index] = Object.assign({}, previous, {
      enabled: cell.enabled === true,
      adapter: cell.adapter || 'custom',
      label: String(cell.label || '').slice(0, 40),
      labelEn: String(cell.labelEn || '').slice(0, 40),
      unit: String(cell.unit || 'USD').slice(0, 16),
      display: cell.display || 'both',
      refreshMinutes: cell.refreshMinutes || 15,
      convertToDisplayCurrency: cell.convertToDisplayCurrency === true,
      allowInsecureHttp: cell.allowInsecureHttp === true,
      allowedHosts: this.allowedHosts(cell.allowedHostsText),
      request: {
        url: String(cell.request && cell.request.url || '').slice(0, 2048),
        method: cell.request && cell.request.method === 'POST' ? 'POST' : 'GET',
        headers: this.jsonToHeaders(cell.headersText),
        body: this.textToBody(cell.bodyText),
      },
      extract: Object.assign({ unit: String(cell.unit || 'USD') }, this.jsonToExtract(cell.extractText)),
    });
    this.commitPatch({ customBalances: entries });
  },
  async removeCustom(e) {
    const index = Number(e.currentTarget.dataset.index);
    const total = (this.data.config.customBalances || []).length;
    if (!total) return;
    // 删除不可撤销：先确认，避免误触
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: uiText('删除自定义余额'),
        content: uiText('删除后该条配置与密钥都会移除，且无法恢复。'),
        confirmText: uiText('删除'),
        cancelText: uiText('取消'),
        confirmColor: '#c34f4f',
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;
    const entries = (this.data.config.customBalances || []).filter((_, i) => i !== index);
    const ok = await this.commitPatch({ customBalances: entries });
    if (!ok) return;
    // 保留弹窗：还有条目就切到同下标（现在是下一条），没有才关闭
    const next = entries.length ? Math.min(index, entries.length - 1) : -1;
    if (next < 0) { this.closeSheet(); return; }
    this.setData({ expandedCustom: -1, sheetCustom: Object.assign({}, (this.data.customCells || [])[next] || {}, { index: next }), keyEditing: false });
  },
  toggleCustom(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.customCells[index];
    if (!cell) return;
    const entries = (this.data.config.customBalances || []).slice();
    entries[index] = Object.assign({}, entries[index], { enabled: !!(e && e.detail && e.detail.value) });
    this.commitPatch({ customBalances: entries });
  },
  toggleCustomExpand(e) {
    const index = Number(e.currentTarget.dataset.index);
    const next = this.data.expandedCustom === index ? -1 : index;
    this.setData({
      expandedCustom: next,
      // 只翻转展开态，不走 applyFrame：帧内容没变，重建整个 cells 列表既慢又会被帧缓存跳过
      customCells: (this.data.customCells || []).map((cell, i) => (i === index ? Object.assign({}, cell, { expanded: next === index }) : cell)),
    });
  },
  onCustomRequestInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this._sheetEditing = 'sheetCustom.request';
    this.setData({ [`customCells[${index}].request.${field}`]: e.detail.value });
  },
  onCustomRequestBlur(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = (this.data.customCells || [])[index];
    this._sheetEditing = '';
    if (cell) {
      this.setData({ sheetCustom: Object.assign({}, this.data.sheetCustom, { request: Object.assign({}, cell.request) }) });
    }
  },
  pickCustomAdapter(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.showActionSheet({ itemList: ['自定义 HTTP', '阿里云余额', 'Token Rhythm'], success: res => {
      const adapter = ['custom', 'aliyun', 'tokenrhythm'][res.tapIndex];
      this.setData({ [`customCells[${index}].adapter`]: adapter });
    } });
  },
  pickCustomDisplay(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.pickDisplay(value => this.setData({ [`customCells[${index}].display`]: value }));
  },
  pickCustomRefresh(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.pickRefresh(value => this.setData({ [`customCells[${index}].refreshMinutes`]: value }));
  },
  pickCustomMethod(e) {
    const index = Number(e.currentTarget.dataset.index);
    wx.showActionSheet({ itemList: ['GET', 'POST'], success: res => {
      const method = res.tapIndex === 1 ? 'POST' : 'GET';
      const cells = (this.data.customCells || []).map((cell, i) => (i === index ? Object.assign({}, cell, { request: Object.assign({}, cell.request, { method }) }) : cell));
      this.setData({ customCells: cells, sheetCustom: Object.assign({}, this.data.sheetCustom, { request: Object.assign({}, this.data.sheetCustom.request, { method }) }) });
    } });
  },
  /** 已配置的密钥不回显：点「编辑凭据」才展开输入框（与桌面插件一致）。 */
  editCustomKey() { this.setData({ keyEditing: true }); },
  saveCustomKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const draft = (this.data.customKeyDrafts || {})[index] || '';
    if (!draft) { wx.showToast({ title: uiText('请输入凭据'), icon: 'none' }); return; }
    this.setData({ keyEditing: false });
    this.commitSourceKey('custom:' + index, draft);
  },
  clearCustomKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ keyEditing: false });
    this.clearSourceKey('custom:' + index);
  },
  refreshCustom(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.refreshSource('custom:' + index);
  },

  // ---------- gateway quota sources ----------

  async addGateway() {
    if (this.data.gatewayCells.length >= 4) { wx.showToast({ title: uiText('最多配置 4 个网关额度来源'), icon: 'none' }); return; }
    const sources = ((this.data.config.gatewayQuotas && this.data.config.gatewayQuotas.sources) || []).concat([defaultGatewaySource()]);
    // 同 addCustom：先标记展开，否则 applyFrame 重建后新来源呈收起态。
    this.setData({ expandedGateway: sources.length - 1 });
    await this.commitPatch({ gatewayQuotas: { sources } });
  },
  async saveGateway(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (!cell) return;
    const sources = ((this.data.config.gatewayQuotas && this.data.config.gatewayQuotas.sources) || []).slice();
    sources[index] = Object.assign({}, sources[index], {
      id: cell.id,
      type: 'cliproxyapi',
      label: String(cell.label || '').slice(0, 80),
      baseURL: String(cell.baseURL || '').trim(),
      enabled: cell.enabled === true,
      display: cell.display || 'both',
      refreshMinutes: cell.refreshMinutes || 15,
      allowedHosts: this.allowedHosts(cell.allowedHostsText),
      allowInsecureHttp: cell.allowInsecureHttp === true,
    });
    this.commitPatch({ gatewayQuotas: { sources } });
  },
  async removeGateway(e) {
    const index = Number(e.currentTarget.dataset.index);
    const sources = ((this.data.config.gatewayQuotas && this.data.config.gatewayQuotas.sources) || []).filter((_, i) => i !== index);
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: uiText('删除网关额度来源'),
        content: uiText('删除后该来源及其密钥都会移除，且无法恢复。'),
        confirmText: uiText('删除'),
        cancelText: uiText('取消'),
        confirmColor: '#c34f4f',
        success: (res) => resolve(res.confirm === true),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;
    const ok = await this.commitPatch({ gatewayQuotas: { sources } });
    if (!ok) return;
    const next = sources.length ? Math.min(index, sources.length - 1) : -1;
    if (next < 0) { this.closeSheet(); return; }
    this.setData({ expandedGateway: -1, sheetGateway: Object.assign({}, (this.data.gatewayCells || [])[next] || {}, { index: next }) });
  },
  toggleGateway(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (!cell) return;
    const sources = ((this.data.config.gatewayQuotas && this.data.config.gatewayQuotas.sources) || []).slice();
    sources[index] = Object.assign({}, sources[index], { enabled: !!(e && e.detail && e.detail.value) });
    this.commitPatch({ gatewayQuotas: { sources } });
  },
  toggleGatewayExpand(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ expandedGateway: this.data.expandedGateway === index ? -1 : index });
    this.applyFrame();
  },
  pickGatewayDisplay(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.pickDisplay(value => this.setData({ [`gatewayCells[${index}].display`]: value }));
  },
  pickGatewayRefresh(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.pickRefresh(value => this.setData({ [`gatewayCells[${index}].refreshMinutes`]: value }));
  },
  saveGatewayKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (!cell) return;
    const draft = (this.data.gatewayKeyDrafts || {})[cell.id] || '';
    if (!draft) { wx.showToast({ title: uiText('请输入 Management Key'), icon: 'none' }); return; }
    this.setData({ keyEditing: false });
    this.commitSourceKey('gateway:' + cell.id, draft);
  },
  editGatewayKey() { this.setData({ keyEditing: true }); },
  clearGatewayKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    this.setData({ keyEditing: false });
    if (cell) this.clearSourceKey('gateway:' + cell.id);
  },
  refreshGateway(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (cell) this.refreshSource('gateway:' + cell.id);
  },

  saveBalanceKeyDraft(e) { this._balanceKeyEditing = true; this.setData({ balanceKeyDraft: e.detail.value }); },
  onBalanceKeyBlur() { this._balanceKeyEditing = false; },
  saveGoKeyDraft(e) { this._goKeyEditing = true; this.setData({ goKeyDraft: e.detail.value }); },
  onGoKeyBlur() { this._goKeyEditing = false; },
  onGatewayInsecure(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`gatewayCells[${index}].allowInsecureHttp`]: !!(e && e.detail && e.detail.value) });
  },
  onCustomConvert(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`customCells[${index}].convertToDisplayCurrency`]: !!(e && e.detail && e.detail.value) });
  },
  onCustomInsecure(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ [`customCells[${index}].allowInsecureHttp`]: !!(e && e.detail && e.detail.value) });
  },

  onRefresh() { this.loadAll(true); },
  noop() {},
});
