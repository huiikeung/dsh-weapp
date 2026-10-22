const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const costView = require('../../utils/cost-view');

Page({
  data: {
    navPadTop: 50,
    navHeight: 32,
    connected: false,
    supported: false,
    loading: false,
    error: '',
    dashboard: null,
    dashboardSettings: { goQuota: { enabled: false, main: 'rolling' }, peak: { enabled: true, windows: [{ start: 1, end: 4 }, { start: 6, end: 10 }] }, balanceKeyConfigured: false },
    peakWindowsText: '01:00-04:00,06:00-10:00',
    keyDraft: '',
    balanceKeyDraft: '',
    saving: false,
    cardPreferences: costView.normalizeDashboardPreferences(null),
    customBalanceSettings: [],
  },

  onLoad() {
    this.alive = true;
    this.owner = this.ownerKey();
    this.loadCardPreferences();
    theme.applyTo(this);
    this.updateNavigationLayout();
    this.unsubscribe = store.subscribe(snapshot => this.syncFromStore(snapshot));
    this.syncFromStore({ app: store.state });
  },

  onShow() {
    this.refreshCostMeter(false);
  },

  onResize() { this.updateNavigationLayout(); },

  onUnload() {
    this.alive = false;
    this.requestGeneration = (this.requestGeneration || 0) + 1;
    if (this.unsubscribe) this.unsubscribe();
  },

  onUiLocaleChange() {
    this.syncFromStore({ app: store.state });
    this.applyDashboard();
  },

  ownerKey() {
    const state = store.state || {};
    return [state.activeID || '', state.gatewayId || '', state.endpoint || ''].join('|');
  },

  updateNavigationLayout() {
    let info = {}, rect = null;
    try { info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}; } catch (_) {}
    try { rect = wx.getMenuButtonBoundingClientRect(); } catch (_) {}
    const validRect = rect && Number.isFinite(rect.top) && rect.top > 0 && Number.isFinite(rect.height) && rect.height > 0;
    this.setData({
      navPadTop: validRect ? rect.top : (info.statusBarHeight || 44) + 6,
      navHeight: validRect ? rect.height : 32,
    });
  },

  goBack() {
    wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/home/home' }); } });
  },

  syncFromStore(snapshot) {
    const app = snapshot.app || {};
    const connected = app.connection === 'connected';
    const supported = Array.isArray(app.gatewayCapabilities) && app.gatewayCapabilities.includes('cost-meter-v1');
    const owner = this.ownerKey();
    if (owner !== this.owner) {
      this.owner = owner;
      this.requestGeneration = (this.requestGeneration || 0) + 1;
      this.requestInFlight = false;
      this.rawConfig = null;
      this.rawDashboard = null;
      this.setData({ dashboard: null, customBalanceSettings: [], error: '' });
      this.loadCardPreferences();
    }
    this.setData({ connected, supported });
    if (!connected) {
      this.requestGeneration = (this.requestGeneration || 0) + 1;
      this.requestInFlight = false;
      this.setData({ loading: false, error: uiText('请先连接电脑端网关') });
      return;
    }
    if (!supported) {
      this.requestGeneration = (this.requestGeneration || 0) + 1;
      this.requestInFlight = false;
      this.setData({ loading: false, error: uiText('额度卡片需要重启或更新网关') });
      return;
    }
    if (!this.data.dashboard && !this.requestInFlight) this.refreshCostMeter(false);
  },

  async refreshCostMeter(force) {
    if (!this.alive) return;
    if (store.state.connection !== 'connected') {
      this.setData({ loading: false, error: uiText('请先连接电脑端网关') });
      return;
    }
    const capabilities = store.state.gatewayCapabilities || [];
    if (!capabilities.includes('cost-meter-v1')) {
      this.setData({ loading: false, error: uiText('额度卡片需要重启或更新网关') });
      return;
    }
    if (this.requestInFlight) {
      if (!force) return;
      this.requestGeneration = (this.requestGeneration || 0) + 1;
      this.requestInFlight = false;
    }
    const generation = this.requestGeneration = (this.requestGeneration || 0) + 1;
    const owner = this.ownerKey();
    this.requestInFlight = true;
    this.setData({ loading: true, error: '' });
    try {
      const action = force ? 'refresh' : 'config';
      const frame = await store.client.requestCostMeter(action);
      if (!this.isCurrentRequest(generation, owner)) return;
      this.rawDashboard = costView.normalizeDashboard(frame && frame.dashboard);
      const dashboardSettings = frame && frame.dashboard && frame.dashboard.settings
        ? frame.dashboard.settings : this.data.dashboardSettings;
      this.setData({ dashboardSettings, peakWindowsText: this.formatPeakWindows(dashboardSettings.peak && dashboardSettings.peak.windows) });
      this.applyDashboard();
    } catch (error) {
      if (!this.isCurrentRequest(generation, owner)) return;
      this.setData({ error: error && error.code === 'cost-meter-unavailable'
        ? uiText('额度服务暂不可用，请重启 DSH 后重试')
        : (error && error.message) || uiText('额度数据读取失败') });
    } finally {
      if (this.requestGeneration === generation) {
        this.requestInFlight = false;
        this.setData({ loading: false });
      }
    }
  },

  isCurrentRequest(generation, owner) {
    return this.alive && this.requestGeneration === generation && owner === this.ownerKey() && store.state.connection === 'connected';
  },

  preferenceKey(owner) { return 'dsh.cost-meter.dashboard.' + encodeURIComponent(owner || this.ownerKey()); },

  loadCardPreferences() {
    let saved = null;
    try { saved = wx.getStorageSync(this.preferenceKey(this.owner)); } catch (_) {}
    const cardPreferences = costView.normalizeDashboardPreferences(saved);
    this.setData({ cardPreferences });
    this.applyDashboard();
  },

  saveCardPreferences(patch) {
    const cardPreferences = costView.normalizeDashboardPreferences({ ...this.data.cardPreferences, ...patch });
    this.setData({ cardPreferences });
    try { wx.setStorageSync(this.preferenceKey(this.owner), cardPreferences); } catch (_) {}
    this.applyDashboard();
    wx.showToast({ title: uiText('已保存到此设备'), icon: 'success' });
  },

  applyDashboard() {
    const source = this.rawDashboard;
    const cardPreferences = costView.normalizeDashboardPreferences(this.data.cardPreferences);
    const dashboard = costView.applyDashboardPreferences(source, cardPreferences);
    const rows = source && Array.isArray(source.customBalances) ? source.customBalances : [];
    const customBalanceSettings = rows.map(row => ({
      index: row.index,
      label: row.label || uiText('自定义余额'),
      checked: cardPreferences.customBalances[String(row.index)] !== false,
    }));
    this.setData({ dashboard: dashboard && dashboard.hasContent ? dashboard : null, customBalanceSettings });
  },

  onBalanceToggle(e) { this.saveCardPreferences({ showBalance: !!(e.detail && e.detail.value) }); },
  onGoToggle(e) {
    const enabled = !!(e.detail && e.detail.value);
    this.saveCardPreferences({ showGo: enabled });
    this.saveRemoteSettings({ goQuota: { ...this.data.dashboardSettings.goQuota, enabled } });
  },
  onPeakToggle(e) {
    this.saveRemoteSettings({ peak: { ...this.data.dashboardSettings.peak, enabled: !!(e.detail && e.detail.value) } });
    this.saveCardPreferences({ showPeak: !!(e.detail && e.detail.value) });
  },
  onCustomBalanceToggle(e) {
    const index = String(e.currentTarget.dataset.index);
    this.saveCardPreferences({ customBalances: { ...this.data.cardPreferences.customBalances, [index]: !!(e.detail && e.detail.value) } });
  },
  onStyleTap() {
    wx.showActionSheet({
      itemList: [uiText('紧凑'), uiText('舒展')],
      success: result => this.saveCardPreferences({ style: result.tapIndex === 0 ? 'compact' : 'standard' }),
    });
  },

  onGoKeyInput(e) { this.setData({ keyDraft: e.detail.value || '' }); },
  onBalanceKeyInput(e) { this.setData({ balanceKeyDraft: e.detail.value || '' }); },

  async onSaveBalanceKey() {
    const value = String(this.data.balanceKeyDraft || '').trim();
    if (!value || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await store.client.requestCostMeter('set-balance-key', { value });
      this.setData({ balanceKeyDraft: '' });
      wx.showToast({ title: uiText('密钥已安全保存'), icon: 'success' });
      await this.refreshCostMeter(true);
    } catch (error) {
      wx.showToast({ title: error && error.message || uiText('密钥保存失败'), icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },

  async onClearBalanceKey() {
    if (!this.data.dashboardSettings.balanceKeyConfigured || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await store.client.requestCostMeter('clear-balance-key');
      this.setData({ balanceKeyDraft: '' });
      wx.showToast({ title: uiText('已清除本机 DeepSeek Key'), icon: 'success' });
      await this.refreshCostMeter(true);
    } catch (error) {
      wx.showToast({ title: error && error.message || uiText('密钥清除失败'), icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },

  async onSaveGoKey() {
    const value = String(this.data.keyDraft || '').trim();
    if (!value || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await store.client.requestCostMeter('set-go-key', { value });
      this.setData({ keyDraft: '' });
      wx.showToast({ title: uiText('密钥已安全保存'), icon: 'success' });
      await this.refreshCostMeter(true);
    } catch (error) {
      wx.showToast({ title: error && error.message || uiText('密钥保存失败'), icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },

  async onClearGoKey() {
    if (!this.data.dashboardSettings.goKeyConfigured || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await store.client.requestCostMeter('clear-go-key');
      const frame = await store.client.requestCostMeter('update', { patch: { goQuota: { ...this.data.dashboardSettings.goQuota, enabled: false } } });
      if (frame && frame.dashboard && frame.dashboard.settings) this.setData({ dashboardSettings: frame.dashboard.settings });
      this.setData({ keyDraft: '' });
      wx.showToast({ title: uiText('已清除本机 Go Key'), icon: 'success' });
      await this.refreshCostMeter(true);
    } catch (error) {
      wx.showToast({ title: error && error.message || uiText('密钥清除失败'), icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },

  onGoWindowTap() {
    wx.showActionSheet({
      itemList: [uiText('滚动 5 小时'), uiText('本周'), uiText('本月')],
      success: result => this.saveRemoteSettings({ goQuota: {
        ...this.data.dashboardSettings.goQuota,
        main: ['rolling', 'weekly', 'monthly'][result.tapIndex],
      } }),
    });
  },

  onPeakWindowsTap() {
    const windows = this.data.dashboardSettings.peak.windows || [];
    const value = this.formatPeakWindows(windows);
    wx.showModal({
      title: uiText('设置峰时段'),
      editable: true,
      placeholderText: '01:00-04:00,06:00-10:00',
      content: value,
      success: result => {
        if (!result.confirm) return;
        const ranges = String(result.content || '').split(',').map(part => part.trim()).filter(Boolean);
        const parsed = [];
        for (const range of ranges) {
          const match = /^(\d{1,2}):00-(\d{1,2}):00$/.exec(range);
          if (!match) { wx.showToast({ title: uiText('格式示例：01:00-04:00'), icon: 'none' }); return; }
          const start = Number(match[1]), end = Number(match[2]);
          if (start > 23 || end > 24 || start === end) { wx.showToast({ title: uiText('峰时段小时范围无效'), icon: 'none' }); return; }
          parsed.push({ start, end });
        }
        if (!parsed.length) { wx.showToast({ title: uiText('至少填写一个峰时段'), icon: 'none' }); return; }
        this.saveRemoteSettings({ peak: { ...this.data.dashboardSettings.peak, windows: parsed } });
      },
    });
  },

  formatPeakWindows(windows) {
    return (Array.isArray(windows) ? windows : []).map(row => `${String(row.start).padStart(2, '0')}:00-${String(row.end).padStart(2, '0')}:00`).join(',');
  },

  async saveRemoteSettings(patch, refresh = true) {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      const frame = await store.client.requestCostMeter('update', { patch });
      if (frame && frame.dashboard && frame.dashboard.settings) {
        this.setData({ dashboardSettings: frame.dashboard.settings, peakWindowsText: this.formatPeakWindows(frame.dashboard.settings.peak && frame.dashboard.settings.peak.windows) });
        this.rawDashboard = costView.normalizeDashboard(frame.dashboard);
        this.applyDashboard();
      }
      if (refresh) await this.refreshCostMeter(true);
      wx.showToast({ title: uiText('设置已保存到电脑'), icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error && error.message || uiText('设置保存失败'), icon: 'none' });
    } finally { this.setData({ saving: false }); }
  },

  onRefresh() { this.refreshCostMeter(true); },
  noop() {},
});
