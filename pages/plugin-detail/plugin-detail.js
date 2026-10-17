// 插件详情页（对齐 dsh-mobile PluginDetailView / OfficialPluginDetailView /
// PluginComponentSheet）：bundle 概要 + 组件列表开关 + 组件半屏详情。

const store = require('../../utils/store');
const theme = require('../../utils/theme');
const plugins = require('../../utils/plugins');

const GATEWAY_PLUGIN = 'dsh-plugin-mobile-gateway';

function entryToView(row) {
  const running = row.enabled && row.phase === 'active';
  const failed = row.enabled && row.phase === 'failed';
  return {
    id: row.id,
    entryID: row.entryID,
    moduleName: row.moduleName,
    name: row.name,
    description: row.description,
    icon: row.icon,
    initial: (row.name || row.id || '?').charAt(0),
    enabled: row.enabled,
    readOnlyReason: row.readOnlyReason,
    statusText: row.statusText,
    dotClass: running ? 'ok' : failed ? 'bad' : '',
    toggleDisabled: store.state.connection !== 'connected' ||
      !!row.readOnlyReason || !!store.state.pluginPendingName
  };
}

Page({
  data: {
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    statusBarH: 44,
    mode: 'bundle', // bundle | official
    bundle: null,
    official: null,
    connected: false,
    notice: '',
    pendingName: null,
    sheetEntry: null
  },

  onLoad(options) {
    theme.applyTo(this);
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarH: info.statusBarHeight || 44 });
    } catch (e) { /* 默认 44 */ }
    this.bundleName = options.bundle ? decodeURIComponent(options.bundle) : null;
    this.officialId = options.official ? decodeURIComponent(options.official) : null;
    this.setData({ mode: this.officialId ? 'official' : 'bundle' });
    this.unsubscribe = store.subscribe(() => this.syncFromStore());
    this.syncFromStore();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore() {
    const app = store.state;
    const catalog = app.pluginCatalog;
    if (this.data.mode === 'official') {
      const item = catalog && catalog.officialItems.find((o) => o.id === this.officialId);
      this.setData({
        official: item ? {
          id: item.id,
          title: item.title,
          description: item.description,
          namespaces: item.namespaces,
          initial: (item.title || item.id).charAt(0)
        } : null,
        connected: app.connection === 'connected',
        notice: app.pluginNotice || '',
        pendingName: app.pluginPendingName || null
      });
      return;
    }
    const bundle = catalog && catalog.bundles.find((b) => b.name === this.bundleName);
    if (!bundle) {
      this.setData({ bundle: null, connected: app.connection === 'connected', notice: app.pluginNotice || '' });
      return;
    }
    const entries = bundle.rows.map((row) => {
      const entryID = row.entryId;
      const live = catalog.plugins.find((p) => p.id === entryID);
      return entryToView(plugins.buildRow(row, live));
    });
    this.setData({
      bundle: {
        name: bundle.name,
        title: bundle.title,
        description: bundle.description,
        icon: bundle.icon,
        initial: (bundle.title || bundle.name).charAt(0),
        version: bundle.version,
        enabled: bundle.enabled,
        readOnlyReason: bundle.readOnlyReason,
        error: bundle.error,
        entries: entries,
        activeCount: entries.filter((e) => e.enabled && e.phase === 'active').length,
        toggleDisabled: app.connection !== 'connected' || !!bundle.readOnlyReason ||
          !!app.pluginPendingName || catalog.managementAvailable !== true
      },
      connected: app.connection === 'connected',
      notice: app.pluginNotice || '',
      pendingName: app.pluginPendingName || null
    });
    // 弹层中的组件状态跟随刷新
    if (this.data.sheetEntry) {
      const fresh = entries.find((e) => e.id === this.data.sheetEntry.id);
      if (fresh) this.setData({ sheetEntry: fresh });
      else this.setData({ sheetEntry: null });
    }
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/plugins/plugins' });
      }
    });
  },

  noop() {},

  openEntry(e) {
    const index = e.currentTarget.dataset.index;
    const entry = this.data.bundle && this.data.bundle.entries[index];
    if (entry) this.setData({ sheetEntry: entry });
  },

  closeEntry() {
    this.setData({ sheetEntry: null });
  },

  /** bundle 开关；停用移动网关前确认（对齐 iOS confirmGatewayDisable alert）。 */
  onBundleToggle(e) {
    const bundle = this.data.bundle;
    if (!bundle) return;
    const requested = e.detail.value;
    if (bundle.name === GATEWAY_PLUGIN && !requested) {
      wx.showModal({
        title: '停用移动网关？',
        content: '停用后手机会断开连接。只能从 DSH Web 或 CLI 重新开启此插件。',
        confirmText: '停用',
        confirmColor: '#FF3B30',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) store.setPluginEnabled(bundle.name, false);
          else this.syncFromStore();
        }
      });
      return;
    }
    store.setPluginEnabled(bundle.name, requested);
  },

  /** 组件条目开关（entryId 粒度）。 */
  onEntryToggle(e) {
    const bundle = this.data.bundle;
    if (!bundle) return;
    const entryId = e.currentTarget.dataset.entry;
    store.setPluginEnabled(bundle.name, e.detail.value, entryId);
  }
});
