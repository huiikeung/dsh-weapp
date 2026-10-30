// Context Insights：跨会话上下文总览（对齐 dsh-context overviewPanel / overviewUsage /
// heatmap / overviewTokens / overviewCard）。数据来自网关 context-insights。
const insightsView = require('./utils/context-insights-view');
const accountBalance = require('./utils/balance');
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const hostInfo = require('../../utils/host-info');
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
    coverageOpen: false,
    group: '',
    skillSort: 'loads',
    skillQuery: '',
    expandedSkill: '',
    customFrom: '',
    customTo: '',
    ringFocus: '',
    timingFocus: '',
    balanceVisible: false,
    balanceText: '',
    balanceRows: [],
    balanceUsageUrl: '',
    panel: insightsView.deriveInsights(null, 7, uiText),
    theme: 'light',
    themeClass: 'theme-light'
  },

  onLoad(options) {
    const sessionId = options && typeof options.sessionId === 'string' ? options.sessionId : '';
    this._alive = true;
    theme.applyTo(this);
    this.setData({ sessionId: sessionId });
    this._unsubscribeUi = preferences.subscribe(() => {
      this.setData({ ui: preferences.snapshot().ui });
      this.renderPanel();
    });
    this._unsubscribeStore = typeof store.subscribe === 'function' ? store.subscribe(() => this.renderPanel()) : null;
    this.refresh();
    this.refreshBalance();
  },

  onUnload() {
    this._alive = false;
    if (this._unsubscribeUi) this._unsubscribeUi();
    if (this._unsubscribeStore) this._unsubscribeStore();
    if (this._balanceHostWait) {
      clearTimeout(this._balanceHostWait);
      this._balanceHostWait = null;
    }
  },

  onPullDownRefresh() { this.refresh().finally(() => has.stopPullDownRefresh()); },

  onShow() {
    if (this._loaded) this.refresh();
    this.refreshBalance();
  },

  /** Cached session-list titles: legacy context-insights wires omit them. */
  sessionTitles() {
    const map = Object.create(null);
    const sessions = (store.state && store.state.sessions) || [];
    sessions.forEach((session) => {
      if (!session || typeof session !== 'object') return;
      const id = typeof session.sessionId === 'string' ? session.sessionId
        : typeof session.id === 'string' ? session.id : '';
      if (id === '' || typeof session.title !== 'string' || session.title === '') return;
      map[id] = session.title;
    });
    return map;
  },

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
      sessionTitles: this.sessionTitles(),
      currency: preferences.snapshot().uiLocale === 'zh' ? 'cny' : 'usd',
      locale: preferences.snapshot().uiLocale === 'zh' ? 'zh' : 'en',
      customRange: this.data.customFrom && this.data.customTo
        ? { from: this.data.customFrom, to: this.data.customTo } : null
    });
    panel.ring = insightsView.withRingFocus(panel.ring, this.data.ringFocus, 'category');
    panel.timingRing = insightsView.withRingFocus(panel.timingRing, this.data.timingFocus, 'timing');
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

  /** 覆盖范围下拉框（对齐桌面端右上角）：点触发器展开，点选项收起。 */
  toggleCoverage() {
    this.setData({ coverageOpen: !this.data.coverageOpen });
  },

  pickCoverage(event) {
    const key = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.coverage : '';
    if (!['all', 'active', 'archived'].includes(key)) return;
    this.setData({ coverageOpen: false });
    if (key === this.data.coverage) return;
    this.setData({ coverage: key, page: 0 });
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

  /** Token 环图例：点行聚焦该类，再点取消（dsh-context 的 hover 联动在触屏上的替代）。 */
  toggleRingFocus(event) {
    const key = event && event.currentTarget && event.currentTarget.dataset ? String(event.currentTarget.dataset.key || '') : '';
    this.setData({ ringFocus: this.data.ringFocus === key ? '' : key });
    this.renderPanel();
  },

  toggleTimingFocus(event) {
    const key = event && event.currentTarget && event.currentTarget.dataset ? String(event.currentTarget.dataset.key || '') : '';
    this.setData({ timingFocus: this.data.timingFocus === key ? '' : key });
    this.renderPanel();
  },

  /** 页头「插件设置」：跳到设置页并直接展开「上下文面板」分组。 */
  openContextSettings() {
    haptics.tick ? haptics.tick() : haptics.vibrate();
    has.navigateTo({ url: '/pages/settings/settings?panel=context' });
  },

  /**
   * 页头余额胶囊：数据来自网关 `account` 帧（与设置页「账号与余额」同源），
   * 未登录/旧网关/无余额时静默隐藏；host 帧迟到时最多补试 2 次。
   */
  refreshBalance() {
    const state = store.state || {};
    if (state.connection !== 'connected' || !store.client || typeof store.client.requestAccount !== 'function') {
      if (this.data.balanceVisible) this.setData({ balanceVisible: false, balanceText: '', balanceRows: [], balanceUsageUrl: '' });
      return null;
    }
    const version = hostInfo.normalizeHostInfo(state.host).version;
    if (!version) {
      if (this._balanceHostTries >= 2 || this._balanceHostWait) return null;
      this._balanceHostTries = (this._balanceHostTries || 0) + 1;
      this._balanceHostWait = setTimeout(() => {
        this._balanceHostWait = null;
        this.refreshBalance();
      }, 1200);
      return null;
    }
    this._balanceHostTries = 0;
    if (this._balancePending) return null;
    if (this._balanceAt && Date.now() - this._balanceAt < 5 * 60 * 1000 && this._balanceOwner === state.activeID) return null;
    const owner = state.activeID;
    if (this._balanceOwner !== undefined && this._balanceOwner !== owner) this.setData({ balanceVisible: false });
    this._balanceOwner = owner;
    const generation = this._balanceGeneration = (this._balanceGeneration || 0) + 1;
    let locale = 'zh';
    try { locale = preferences.locale(); } catch (_) { /* default zh */ }
    const payload = { version, locale, timezoneOffsetSeconds: -(new Date()).getTimezoneOffset() * 60 };
    this._balancePending = true;
    return store.client.requestAccount(payload).then((frame) => {
      if (generation !== this._balanceGeneration || this._alive === false) return;
      const view = accountBalance.normalize(frame);
      this._balanceAt = Date.now();
      this.setData({
        balanceVisible: view.visible,
        balanceText: view.text,
        balanceRows: view.rows,
        balanceUsageUrl: view.usageUrl
      });
    }).catch(() => {
      if (generation !== this._balanceGeneration || this._alive === false) return;
      this.setData({ balanceVisible: false });
    }).finally(() => {
      if (generation === this._balanceGeneration) this._balancePending = false;
    });
  },

  openBalance() {
    const rows = Array.isArray(this.data.balanceRows) ? this.data.balanceRows : [];
    if (!rows.length) return;
    haptics.tick ? haptics.tick() : haptics.vibrate();
    const lines = rows.map((row) => (row.kind === 'bonus' ? uiText('赠金余额') : uiText('充值余额')) + '：' + row.text);
    const usageUrl = this.data.balanceUsageUrl;
    if (usageUrl) lines.push('', uiText('查看余额用量'));
    has.showModal({
      title: uiText('DeepSeek 余额'),
      content: lines.join('\n'),
      showCancel: false,
      confirmText: usageUrl ? uiText('复制') : uiText('知道了'),
      success: (result) => {
        if (!result || !result.confirm || !usageUrl || !has.setClipboardData) return;
        has.setClipboardData({ data: usageUrl, success: () => { if (has.showToast) has.showToast({ title: uiText('已复制'), icon: 'none' }); } });
      }
    });
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
    if (!path || !has.setClipboardData) return;
    has.setClipboardData({ data: path });
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
    const selected = this.data.skill === skill ? '' : skill;
    // dsh-context pins a skill: the row filters the session list AND opens its detail
    // card in place; tapping the pinned row again releases both.
    this.setData({ skill: selected, page: 0, expandedSkill: selected ? skill : '' });
    this.renderPanel();
  },

  clearSkill() {
    this.setData({ skill: '', expandedSkill: '', page: 0 });
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
    if (dataset.archived === true || dataset.archived === 'true') {
      if (has.showToast) has.showToast({ title: uiText('已归档会话暂无法打开，取消归档后可查看。'), icon: 'none' });
      return;
    }
    if (!id || !store.openSession) return;
    haptics.vibrate();
    store.openSession(id, '', null);
    has.navigateBack({ fail() {} });
  }
});
