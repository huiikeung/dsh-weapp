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
];

function defaultCustomEntry() {
  return {
    enabled: false,
    adapter: 'custom',
    label: '',
    unit: 'USD',
    display: 'both',
    refreshMinutes: 15,
    convertToDisplayCurrency: false,
    allowInsecureHttp: false,
    allowedHosts: [],
    secretHeader: 'Authorization',
    request: { url: '', method: 'GET', headers: {} },
    extract: { remaining: 'data.remaining', maxBudget: '', spend: '', unit: 'USD' },
  };
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

  onLoad() {
    this.alive = true;
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
    const config = this.config || {};
    const view = costView.normalizeQuotaDashboard(this.dashboardFrame, this.summaryFrame);
    const display = config.display || {};
    const peak = config.peak || {};
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
        extractRemaining: this.ruleToText(entry.extract && entry.extract.remaining),
        extractMax: this.ruleToText(entry.extract && entry.extract.maxBudget),
        extractSpend: this.ruleToText(entry.extract && entry.extract.spend),
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
    this.setData({
      config,
      dashboard: this.dashboardFrame || null,
      summary: this.summaryFrame || null,
      sources: this.sourcesFrame || null,
      view,
      displayForm: {
        currency: config.currency || 'CNY',
        symbol: config.symbol || (config.currency === 'USD' ? '$' : '¥'),
        decimals: config.decimals === undefined ? 3 : config.decimals,
        exchangeRate: config.exchangeRate === undefined ? 7.2 : config.exchangeRate,
        sidebarStyle: display.sidebarStyle || 'standard',
        sidebarVisible: display.sidebarVisible === true,
        peakStyle: display.peakStyle || 'progress',
      },
      balanceForm: Object.assign({ enabled: true, display: 'both', refreshMinutes: 5 }, config.balance || {}),
      goForm: Object.assign({ enabled: false, display: 'both', refreshMinutes: 15, main: 'rolling', barDirection: 'used', detail: true }, config.goQuota || {}),
      budgetForm: {
        enabled: budget.enabled === true,
        amount: budget.amount === undefined || budget.amount === null ? '' : String(budget.amount),
        period: budget.period || 'month',
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
        windowsLabel: this.formatPeakWindows(peak.windows),
      },
      planCells: plans,
      customCells,
      gatewayCells,
    });
    theme.applyTo(this);
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
  headersToText(headers) {
    if (!headers || typeof headers !== 'object') return '';
    return Object.keys(headers).map(name => name + ': ' + headers[name]).join('\n');
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
    this.setData({ saving: options.key || 'settings' });
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
    wx.showActionSheet({ itemList: ['人民币 CNY', '美元 USD'], success: res => {
      const currency = res.tapIndex === 0 ? 'CNY' : 'USD';
      const symbol = currency === 'CNY' ? '¥' : '$';
      this.setData({ displayForm: Object.assign({}, this.data.displayForm, { currency, symbol }) });
      this.commitPatch({ currency, symbol });
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
    this.commitPatch({
      symbol: this.data.displayForm.symbol,
      decimals: Number(this.data.displayForm.decimals),
      exchangeRate: Number(this.data.displayForm.exchangeRate),
    });
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
  commitBudget() {
    const amount = Number(this.data.budgetForm.amount);
    if (!Number.isFinite(amount) || amount < 0) { wx.showToast({ title: uiText('请输入有效的预算金额'), icon: 'none' }); return; }
    this.commitPatch({ budget: { amount, enabled: this.data.budgetForm.enabled, period: this.data.budgetForm.period } });
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
  onPlanKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
    this.setData({ planKeyDrafts: Object.assign({}, this.data.planKeyDrafts, { [cell.id]: e.detail.value }) });
  },
  savePlanKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
    if (!cell) return;
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
  clearPlanKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.planCells[index];
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
    const entries = (this.data.config.customBalances || []).concat([defaultCustomEntry()]);
    const ok = await this.commitPatch({ customBalances: entries });
    if (ok) this.setData({ expandedCustom: entries.length - 1 });
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
      unit: String(cell.unit || 'USD').slice(0, 16),
      display: cell.display || 'both',
      refreshMinutes: cell.refreshMinutes || 15,
      convertToDisplayCurrency: cell.convertToDisplayCurrency === true,
      allowInsecureHttp: cell.allowInsecureHttp === true,
      allowedHosts: this.allowedHosts(cell.allowedHostsText),
      secretHeader: String(cell.secretHeader || '').slice(0, 80),
      request: {
        url: String(cell.request && cell.request.url || '').slice(0, 2048),
        method: cell.request && cell.request.method === 'POST' ? 'POST' : 'GET',
        headers: this.textToHeaders(cell.headersText),
      },
      extract: {
        remaining: this.textToRule(cell.extractRemaining),
        maxBudget: this.textToRule(cell.extractMax),
        spend: this.textToRule(cell.extractSpend),
        unit: String(cell.unit || 'USD'),
      },
    });
    this.commitPatch({ customBalances: entries });
  },
  async removeCustom(e) {
    const index = Number(e.currentTarget.dataset.index);
    const entries = (this.data.config.customBalances || []).filter((_, i) => i !== index);
    const ok = await this.commitPatch({ customBalances: entries });
    if (ok) this.setData({ expandedCustom: -1 });
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
    this.setData({ expandedCustom: this.data.expandedCustom === index ? -1 : index });
    this.applyFrame();
  },
  onCustomFieldInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this.setData({ [`customCells[${index}].${field}`]: e.detail.value });
  },
  onCustomRequestInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this.setData({ [`customCells[${index}].request.${field}`]: e.detail.value });
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
    wx.showActionSheet({ itemList: ['GET', 'POST'], success: res => this.setData({ [`customCells[${index}].request.method`]: res.tapIndex === 1 ? 'POST' : 'GET' }) });
  },
  onCustomKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ customKeyDrafts: Object.assign({}, this.data.customKeyDrafts, { [index]: e.detail.value }) });
  },
  saveCustomKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const draft = (this.data.customKeyDrafts || {})[index] || '';
    if (!draft) { wx.showToast({ title: uiText('请输入凭据'), icon: 'none' }); return; }
    this.commitSourceKey('custom:' + index, draft);
  },
  clearCustomKey(e) {
    const index = Number(e.currentTarget.dataset.index);
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
    const ok = await this.commitPatch({ gatewayQuotas: { sources } });
    if (ok) this.setData({ expandedGateway: sources.length - 1 });
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
    const ok = await this.commitPatch({ gatewayQuotas: { sources } });
    if (ok) this.setData({ expandedGateway: -1 });
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
  onGatewayFieldInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const field = e.currentTarget.dataset.field;
    this.setData({ [`gatewayCells[${index}].${field}`]: e.detail.value });
  },
  onGatewayKeyInput(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (!cell) return;
    this.setData({ gatewayKeyDrafts: Object.assign({}, this.data.gatewayKeyDrafts, { [cell.id]: e.detail.value }) });
  },
  saveGatewayKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (!cell) return;
    const draft = (this.data.gatewayKeyDrafts || {})[cell.id] || '';
    if (!draft) { wx.showToast({ title: uiText('请输入 Management Key'), icon: 'none' }); return; }
    this.commitSourceKey('gateway:' + cell.id, draft);
  },
  clearGatewayKey(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (cell) this.clearSourceKey('gateway:' + cell.id);
  },
  refreshGateway(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cell = this.data.gatewayCells[index];
    if (cell) this.refreshSource('gateway:' + cell.id);
  },

  saveBalanceKeyDraft(e) { this.setData({ balanceKeyDraft: e.detail.value }); },
  saveGoKeyDraft(e) { this.setData({ goKeyDraft: e.detail.value }); },
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
