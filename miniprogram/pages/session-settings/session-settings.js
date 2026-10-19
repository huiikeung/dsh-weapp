const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const labels = require('../../utils/labels');
const theme = require('../../utils/theme');
const { nodePresentation } = require('../../utils/node-presentation');
const { hostDisplay } = require('../../utils/host-info');
const { clientVersion } = require('../../utils/version-info');
const CONNECTION_LABELS = { disconnected: uiText('未连接'), connecting: uiText('连接中'), connected: uiText('已连接'), failed: uiText('连接失败') };

Page({
  manualShareMenu: true,
  data: { navPadTop: 50, navHeight: 32, presetLabel: uiText('标准模式'), modelLabel: '—', permissionLabel: uiText('工作区写入'), host: {}, hostInfo: { version: uiText('未提供'), provider: uiText('未提供'), model: uiText('未提供') }, buildLabel: '', utilitySheet: '', diagnostics: [], cacheClearing: false, cacheError: '' },
  onUiLocaleChange() { this.syncFromStore({ app: store.state, session: store.sessionState }); },
  onLoad() {
    theme.applyTo(this);
    this.updateNavigationLayout();
    this.setData(clientVersion(wx));
    this.unsubscribe = store.subscribe(snapshot => this.syncFromStore(snapshot));
    this.syncFromStore({ app: store.state });
    if (store.state.connection === 'connected') {
      ['requestHost', 'requestDefaultModel', 'requestModels'].forEach(method => {
        if (typeof store.client[method] !== 'function') return;
        Promise.resolve(store.client[method](null)).catch(() => {});
      });
    }
  },
  updateNavigationLayout() {
    let info = {}, rect = null;
    try {
      info = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
    } catch (e) { /* 胶囊位置可独立读取。 */ }
    try { rect = wx.getMenuButtonBoundingClientRect(); } catch (e) { /* 旧基础库按状态栏回退。 */ }
    const validRect = rect && Number.isFinite(rect.top) && rect.top > 0 && Number.isFinite(rect.height) && rect.height > 0;
    const statusBarHeight = Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0 ? info.statusBarHeight : 44;
    this.setData({ navPadTop: validRect ? rect.top : statusBarHeight + 6, navHeight: validRect ? rect.height : 32 });
  },
  onResize() { this.updateNavigationLayout(); },
  goBack() {
    wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/home/home' }); } });
  },
  onUnload() { if (this.unsubscribe) this.unsubscribe(); },
  onHide() { this.setData({ utilitySheet: '', cacheError: '' }); },
  syncFromStore(snapshot) {
    const app = snapshot.app;
    const defaults = app.defaults || {};
    const model = app.defaultModel || {};
    const presetId = defaults.agentPresetDefault || 'standard';
    this.setData({
      presetLabel: (app.agentPresets && findPresetName(app.agentPresets.presets, presetId)) || labels.presetModeName(presetId),
      modelLabel: model.model ? model.model + (model.reasoningEffort ? ' · ' + capitalize(model.reasoningEffort) : '') : '—',
      permissionLabel: labels.permissionName(defaults.permissionDefault || 'workspace-write') || defaults.permissionDefault || uiText('工作区写入'),
      host: app.host || {},
      hostInfo: hostDisplay(app)
    });
    if (this.data.utilitySheet === 'diagnostics') this.setData({ diagnostics: this.diagnosticRows(app) });
  },

  pickAgentPreset() {
    const catalog = store.state.agentPresets;
    const presets = (catalog && catalog.presets) || [];
    const list = presets.length
      ? presets
      : [
          { id: 'standard' },
          { id: 'code' },
          { id: 'minimal' },
          { id: 'cordis' }
        ];
    wx.showActionSheet({
      itemList: list.map((p) => p.name || labels.presetModeName(p.id)).slice(0, 6),
      success(res) {
        const picked = list[res.tapIndex];
        store.client.setDefault('agent-preset', picked.id).catch((err) => {
          wx.showToast({ title: err.message || uiText('设置失败'), icon: 'none' });
        });
      }
    });
  },

  pickDefaultModel() {
    const self = this;
    const catalog = store.state.modelCatalog;
    const flat = flattenModels(catalog);
    if (!flat.length) {
      store.client.requestModels(null).then(() => {
        const refreshed = flattenModels(store.state.modelCatalog);
        if (refreshed.length) {
          self.showModelSheet(refreshed);
        } else {
          wx.showToast({ title: uiText('网关未提供模型目录'), icon: 'none' });
        }
      }).catch(() => {
        wx.showToast({ title: uiText('模型目录加载失败'), icon: 'none' });
      });
      return;
    }
    this.showModelSheet(flat);
  },

  showModelSheet(flat) {
    const self = this;
    wx.showActionSheet({
      itemList: flat.map((m) => m.label).slice(0, 6),
      success(res) {
        const picked = flat[res.tapIndex];
        store.client.saveDefaultModel(picked.provider, picked.model, picked.defaultEffort)
          .then(() => {
            wx.showToast({ title: uiText('已保存'), icon: 'success' });
          })
          .catch((err) => {
            wx.showToast({ title: err.message || uiText('保存失败'), icon: 'none' });
          });
        self.setData({ modelLabel: picked.model });
      }
    });
  },

  pickDefaultPermission() {
    wx.showActionSheet({
      itemList: [uiText('只读'), uiText('工作区写入'), uiText('完全访问')],
      success(res) {
        const values = ['read-only', 'workspace-write', 'danger-full-access'];
        store.client.setDefault('permission', values[res.tapIndex]).catch((err) => {
          wx.showToast({ title: err.message || uiText('设置失败'), icon: 'none' });
        });
      }
    });
  },

  openPlugins() {
    wx.navigateTo({ url: '/pages/plugins/plugins' });
  },

  openFiles() {
    wx.navigateTo({ url: '/pages/files/files' });
  },

  openSchedule() {
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  },

  showDiagnostics() {
    this.setData({ utilitySheet: 'diagnostics', diagnostics: this.diagnosticRows(store.state || {}), cacheError: '' });
  },

  diagnosticRows(app) {
    const detail = nodePresentation((app.profiles || []).find(p => p.id === app.activeID), app);
    const frames = app.frameStats || {};
    const frameText = Object.keys(frames).length
      ? Object.keys(frames).map((k) => k + '×' + frames[k]).slice(0, 12).join('  ')
      : uiText('（暂无）');
    return [
      { label: uiText('连接状态'), value: CONNECTION_LABELS[app.connection] || uiText('未知') },
      { label: detail && detail.isPublic ? uiText('公网标识') : uiText('地址'), value: detail && detail.isPublic ? detail.identifier : app.endpoint || uiText('未配置'), mono: true },
      { label: uiText('网关'), value: detail ? detail.name : '—' },
      { label: uiText('帧统计'), value: frameText, mono: true }
    ];
  },

  clearLocalCache() {
    this.setData({ utilitySheet: 'cache', cacheError: '' });
  },

  closeUtilitySheet() {
    if (!this.data.cacheClearing) this.setData({ utilitySheet: '', cacheError: '' });
  },

  noop() {},

  confirmClearCache() {
    if (this.data.utilitySheet !== 'cache' || this.data.cacheClearing) return;
    this.setData({ cacheClearing: true, cacheError: '' });
    let removed = 0, failed = 0;
    try {
      const keys = wx.getStorageInfoSync().keys || [];
      keys.filter(key => key.indexOf('dsh_session_cache') === 0 || key.indexOf('dsh_home_cache') === 0).forEach(key => {
        try { wx.removeStorageSync(key); removed += 1; } catch (e) { failed += 1; }
      });
    } catch (e) {
      this.setData({ cacheClearing: false, cacheError: uiText('无法读取缓存，请稍后重试。') });
      return;
    }
    this.setData({ cacheClearing: false, ...(failed ? { cacheError: uiText('已清理 ') + removed + uiText(' 项，剩余 ') + failed + uiText(' 项未清理，请重试。') } : { utilitySheet: '' }) });
    if (!failed) wx.showToast({ title: removed ? uiText('已清理 ') + removed + uiText(' 项') : uiText('没有可清理的缓存'), icon: 'none' });
    if (removed && store.refreshHosts) store.refreshHosts();
  }
});

function findPresetName(presets, id) {
  const found = (presets || []).find((p) => p.id === id);
  return found ? (found.name || labels.presetModeName(id)) : null;
}

function flattenModels(catalog) {
  const flat = [];
  if (catalog && catalog.groups) {
    catalog.groups.forEach((group) => {
      (group.models || []).forEach((model) => {
        flat.push({
          provider: group.id,
          model: model.id,
          label: (group.name || group.id) + ' · ' + (model.name || model.id),
          defaultEffort: model.reasoning && model.reasoning.defaultEffort
        });
      });
    });
  }
  return flat;
}

function capitalize(text) {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
