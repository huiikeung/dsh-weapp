// 插件管理页（对齐 dsh-mobile PluginsView：官方/已安装分组、启用开关、
// 实验性徽标、官方配置项详情入口）。

const store = require('../../utils/store');
const theme = require('../../utils/theme');

function bundleToView(b, app) {
  const canManage = !!(app.pluginCatalog && app.pluginCatalog.managementAvailable);
  return {
    name: b.name,
    title: b.title,
    description: b.description,
    icon: b.icon,
    initial: (b.title || b.name || '?').charAt(0),
    enabled: b.enabled,
    experimental: b.experimental,
    // iOS：断连 / 只读 / 有变更在途 / 目录不支持管理时禁用开关
    toggleDisabled: app.connection !== 'connected' || !!b.readOnlyReason ||
      !!app.pluginPendingName || !canManage
  };
}

Page({
  data: {
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    statusBarH: 44,
    catalog: null,
    loading: false,
    error: '',
    notice: '',
    connected: false,
    pendingName: null,
    refreshing: false
  },

  onLoad() {
    theme.applyTo(this);
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarH: info.statusBarHeight || 44 });
    } catch (e) { /* 默认 44 */ }
    this.unsubscribe = store.subscribe(() => this.syncFromStore());
    this.syncFromStore();
  },

  onShow() {
    // 对齐 iOS .task { store.refreshPlugins() }
    store.refreshPlugins();
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore() {
    const app = store.state;
    const catalog = app.pluginCatalog;
    this.setData({
      catalog: catalog ? {
        canManage: catalog.managementAvailable === true,
        officialBundles: catalog.officialBundles.map((b) => bundleToView(b, app)),
        officialItems: catalog.officialItems.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          initial: (o.title || o.id).charAt(0)
        })),
        officialTotal: catalog.officialBundles.length + catalog.officialItems.length,
        installedBundles: catalog.installedBundles.map((b) => bundleToView(b, app))
      } : null,
      loading: app.pluginsLoading === true,
      error: app.pluginsError || '',
      notice: app.pluginNotice || '',
      connected: app.connection === 'connected',
      pendingName: app.pluginPendingName || null
    });
    if (this.data.refreshing && app.pluginsLoading !== true) {
      this.setData({ refreshing: false });
    }
  },

  onRefresh() {
    if (this.data.loading) return;
    this.setData({ refreshing: true });
    store.refreshPlugins();
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.reLaunch({ url: '/pages/home/home' });
      }
    });
  },

  openBundle(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    wx.navigateTo({ url: '/pages/plugin-detail/plugin-detail?bundle=' + encodeURIComponent(name) });
  },

  openOfficial(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/plugin-detail/plugin-detail?official=' + encodeURIComponent(id) });
  },

  /** bundle 开关；停用移动网关前需确认（对齐 iOS gatewayToggle alert）。 */
  onBundleToggle(e) {
    const name = e.currentTarget.dataset.name;
    const current = e.currentTarget.dataset.enabled === true;
    const requested = e.detail.value;
    if (!name || requested === current) {
      // 状态被禁用拦截时同步回原值
      this.syncFromStore();
      return;
    }
    if (name === 'dsh-plugin-mobile-gateway' && !requested) {
      wx.showModal({
        title: '停用移动网关？',
        content: '停用后手机会断开连接。只能从 DSH Web 或 CLI 重新开启此插件。',
        confirmText: '停用',
        confirmColor: '#FF3B30',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) store.setPluginEnabled(name, false);
          else this.syncFromStore();
        }
      });
      return;
    }
    store.setPluginEnabled(name, requested);
  }
});
