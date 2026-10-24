// Context Insights：跨会话上下文总览（对齐 dsh-context overviewPanel / overviewUsage /
// heatmap / overviewTokens / overviewCard）。数据来自网关 context-insights。
const insightsView = require('./utils/context-insights-view');
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const preferences = require('../../utils/ui-preferences');
const haptics = require('../../utils/haptics');
const { t: uiText } = preferences;

Page({
  data: {
    status: 'loading',
    errorText: '',
    sessionId: '',
    range: 7,
    query: '',
    day: '',
    skill: '',
    sort: 'recent',
    page: 0,
    metric: 'tokens',
    coverage: 'all',
    group: '',
    skillSort: 'loads',
    skillQuery: '',
    expandedSkill: '',
    customFrom: '',
    customTo: '',
    panel: insightsView.deriveInsights(null, 7, uiText),
    themeClass: 'theme-light'
  },

  onLoad(options) {
    const sessionId = options && typeof options.sessionId === 'string' ? options.sessionId : '';
    theme.applyTo(this);
    this.setData({ sessionId: sessionId });
    this._unsubscribeUi = preferences.subscribe(() => {
      this.setData({ ui: preferences.snapshot().ui });
      this.renderPanel();
    });
    this._unsubscribeStore = typeof store.subscribe === 'function' ? store.subscribe(() => this.renderPanel()) : null;
    this.refresh();
  },

  onUnload() {
    if (this._unsubscribeUi) this._unsubscribeUi();
    if (this._unsubscribeStore) this._unsubscribeStore();
  },

  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },

  onShow() { if (this._loaded) this.refresh(); },

  renderPanel() {
    const value = this._value || null;
    const panel = insightsView.deriveInsights(value, this.data.range, uiText, Date.now(), {
      query: this.data.query,
      day: this.data.day,
      skill: this.data.skill,
      sort: this.data.sort,
      page: this.data.page,
      metric: this.data.metric,
      coverage: this.data.coverage,
      group: this.data.group,
      skillSort: this.data.skillSort,
      skillQuery: this.data.skillQuery,
      currentSessionId: this.data.sessionId,
      workspaces: (store.state && store.state.workspaces) || [],
      archivedSessionIds: (store.state && store.state.archivedSessionIds) || [],
      currency: preferences.snapshot().uiLocale === 'zh' ? 'cny' : 'usd',
      customRange: this.data.customFrom && this.data.customTo
        ? { from: this.data.customFrom, to: this.data.customTo } : null
    });
    this.setData({ panel: panel });
  },

  async refresh() {
    const client = store.client;
    if (!this.data.sessionId) {
      this.setData({ status: 'error', errorText: uiText('打开会话后可查看上下文洞察') });
      return;
    }
    if (!client || typeof client.requestContextInsights !== 'function') {
      this.setData({ status: 'unsupported', errorText: uiText('需升级网关以显示上下文洞察') });
      return;
    }
    const capabilities = (store.state && store.state.gatewayCapabilities) || [];
    if (!capabilities.includes('context-insights-v1')) {
      // 旧网关不会响应 context-insights，直接提示升级，避免页面一直转圈。
      this.setData({ status: 'unsupported', errorText: uiText('需升级网关以显示上下文洞察') });
      return;
    }
    this.setData({ status: 'loading', errorText: '' });
    try {
      const frame = await Promise.race([
        client.requestContextInsights(this.data.sessionId),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error(uiText('上下文汇总加载失败，请重试'))), 12000)),
      ]);
      if (frame && frame.kind === 'error') {
        // 网关已声明能力但仍在跑旧代码（unclaimed dispatch）时给出可操作的提示。
        const message = frame.code === 'context-unavailable' ? uiText('需升级网关以显示上下文洞察')
          : frame.code === 'unsupported-request' ? uiText('上下文洞察需要新版网关：请重启电脑端 DSH 后重试')
            : (frame.message || uiText('上下文汇总加载失败，请重试'));
        this.setData({ status: 'unsupported', errorText: message });
        return;
      }
      const value = frame && frame.value && typeof frame.value === 'object' ? frame.value : null;
      if (!value) throw new Error(uiText('上下文汇总数据格式异常'));
      this._value = value;
      this._loaded = true;
      this.setData({ status: 'ready', errorText: '' });
      this.renderPanel();
    } catch (error) {
      this.setData({ status: 'error', errorText: (error && error.message) || uiText('上下文汇总加载失败，请重试') });
    }
  },

  setRange(event) {
    const raw = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.range : '';
    const range = raw === 'today' ? 'today' : Number(raw);
    if (insightsView.RANGES.indexOf(range) < 0 || (range === this.data.range && !this.data.customFrom && !this.data.customTo)) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    this.setData({ range: range });
    this.setData({ customFrom: '', customTo: '' });
    this.setData({ page: 0 });
    this.renderPanel();
  },

  onSearchInput(event) {
    const value = event && event.detail ? String(event.detail.value || '') : '';
    this.setData({ query: value, page: 0 });
    this.renderPanel();
  },

  setSort(event) {
    const sort = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.sort : '';
    if (!['recent', 'tokens', 'context'].includes(sort)) return;
    this.setData({ sort: sort, page: 0 });
    this.renderPanel();
  },

  setMetric(event) {
    const metric = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.metric : '';
    if (!['tokens', 'sessions'].includes(metric)) return;
    this.setData({ metric: metric });
    this.renderPanel();
  },

  setCoverage(event) {
    const coverage = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.coverage : '';
    if (!['all', 'active', 'archived'].includes(coverage)) return;
    this.setData({ coverage: coverage, page: 0 });
    this.renderPanel();
  },

  setGroup(event) {
    const group = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.group : '';
    this.setData({ group: this.data.group === group ? '' : group, page: 0 });
    this.renderPanel();
  },

  setSkillSort(event) {
    const sort = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.sort : '';
    if (!['loads', 'recent'].includes(sort)) return;
    this.setData({ skillSort: sort });
    this.renderPanel();
  },

  onSkillSearch(event) {
    const query = event && event.detail ? String(event.detail.value || '') : '';
    this.setData({ skillQuery: query });
    this.renderPanel();
  },

  toggleSkillDetails(event) {
    const skill = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.skill : '';
    this.setData({ expandedSkill: this.data.expandedSkill === skill ? '' : skill });
  },

  copySkillPath(event) {
    const path = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.path : '';
    if (!path || !wx.setClipboardData) return;
    wx.setClipboardData({ data: path });
  },

  noop() {},

  setCustomFrom(event) {
    const from = event && event.detail ? String(event.detail.value || '') : '';
    const next = { customFrom: from, page: 0 };
    if (from && this.data.customTo && from > this.data.customTo) next.customTo = from;
    this.setData(next);
    this.renderPanel();
  },

  setCustomTo(event) {
    const to = event && event.detail ? String(event.detail.value || '') : '';
    const next = { customTo: to, page: 0 };
    if (to && this.data.customFrom && to < this.data.customFrom) next.customFrom = to;
    this.setData(next);
    this.renderPanel();
  },

  clearCustomRange() {
    this.setData({ customFrom: '', customTo: '', page: 0 });
    this.renderPanel();
  },

  selectDay(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const day = dataset.day || '';
    if (!day || !dataset.available) return;
    this.setData({ day: this.data.day === day ? '' : day, page: 0 });
    this.renderPanel();
  },

  clearDay() {
    this.setData({ day: '', page: 0 });
    this.renderPanel();
  },

  selectSkill(event) {
    const skill = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.skill : '';
    if (!skill) return;
    this.setData({ skill: this.data.skill === skill ? '' : skill, page: 0 });
    this.renderPanel();
  },

  clearSkill() {
    this.setData({ skill: '', page: 0 });
    this.renderPanel();
  },

  changePage(event) {
    const delta = Number(event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.delta : 0);
    if (!Number.isFinite(delta)) return;
    this.setData({ page: Math.max(0, this.data.page + delta) });
    this.renderPanel();
  },

  retry() { this.refresh(); },

  /** 会话卡片：打开该会话并返回会话页（插件里是点击卡片跳转会话）。 */
  openSession(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset : {};
    const id = dataset.id || '';
    if (dataset.archived === true || dataset.archived === 'true') return;
    if (!id || !store.openSession) return;
    haptics.vibrate();
    store.openSession(id, '', null);
    wx.navigateBack({ fail() {} });
  }
});
