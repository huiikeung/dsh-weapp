const { t: uiText } = require('../../utils/ui-preferences');
// Desktop plugin hierarchy with mobile More navigation and Host-owned installation tasks.

const store = require('../../utils/store');
const theme = require('../../utils/theme');
const plugins = require('../../utils/plugins');
const { ACTIVE } = require('../../utils/plugin-install');
const { installSummary } = require('../../utils/plugin-presentation');
const installActions = require('./install-actions');
const marketActions = require('./market-actions');


const { artworkFor, imageSource } = require('../../utils/plugin-artwork');

function bundleToView(b, app) {
  const canManage = !!(app.pluginCatalog && app.pluginCatalog.managementAvailable);
  return {
    name: b.name,
    title: b.title,
    description: b.description,
    icon: imageSource(b.icon),
    artwork: artworkFor(b.name),
    initial: (b.title || b.name || '?').charAt(0),
    enabled: b.enabled,
    experimental: b.experimental,
    needsInstall: b.availability === 'missing',
    // iOS：断连 / 只读 / 有变更在途 / 目录不支持管理时禁用开关
    toggleDisabled: app.connection !== 'connected' || !!b.readOnlyReason ||
      !!app.pluginPendingName || !!(app.pluginInstall && ACTIVE.includes(app.pluginInstall.phase)) || !canManage
  };
}

Page(Object.assign({}, installActions, marketActions, {
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
    refreshing: false,
    showingMore: false, addMenuOpen: false, addOpen: false, registryOpen: false, creatingPlugin: false,
    officialInstallName: '', pluginTab: 'installed',
    marketStatus: 'idle', marketSources: [], marketError: '', marketSelected: '',
    marketEntries: [], marketQuery: '', marketCategories: [], marketCategoriesExpanded: false, marketCategory: '', marketListingError: '', marketListingBusy: false,
    marketNext: null, marketFetchedAt: null, marketTitle: '', marketSelectedLabel: '', marketMenuOpen: false,
    sourcesOpen: false, sourceDraft: '', sourceError: '', sourceSaving: false,
    spec: '', customRegistry: '', registryIndex: 0,
    registryOptions: [{ label: uiText('主机默认安装源'), value: 'host' }, { label: uiText('pnpm 配置'), value: null }, { label: uiText('自定义地址'), value: 'custom' }],
    registryLoading: false, registryError: '', enableAfterInstall: false,
    guideOpen: false, logsOpen: false, install: null, installBusy: false,
    installEditable: true, installActive: false, canAdd: false, actionError: ''
  },

  onUiLocaleChange() { this.syncFromStore(); if (this.data.pluginTab === 'discover' && this.data.connected) this.loadMarketSources(); },
  onLoad(options) {
    this.pendingOfficialInstall = options && options.install || '';
    this.alive = true;
    this.owner = this.currentOwner();
    this.registryRead = 0;
    this.marketRead = 0; this.marketListingRead = 0; this.sourceWrite = 0;
    this.brokenIcons = new Set();
    this.setData({ spec: store.state.pluginInstall && store.state.pluginInstall.spec || '' });
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
    if (this.pendingOfficialInstall && store.state.pluginCatalog) {
      const name = this.pendingOfficialInstall;
      this.pendingOfficialInstall = '';
      this.openOfficialInstall(name);
    }
  },

  onUnload() {
    this.alive = false;
    this.clearMarketSearchTimer();
    this.marketRead += 1; this.marketListingRead += 1; this.sourceWrite += 1;
    this.registryRead += 1;
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore() {
    const app = store.state;
    const reconnected = app.connection === 'connected' && !this.data.connected;
    if (app.connection !== 'connected' && this.data.connected) {
      this.marketRead++; this.marketListingRead++; this.sourceWrite++;
      this.setData({ marketStatus: 'error', marketError: uiText('连接已断开，请重新连接后读取索引源'), sourceSaving: false, marketListingBusy: false });
    }
    const cached = app.pluginCatalog;
    const catalog = cached && cached.source ? plugins.buildCatalog(cached.source) : cached;
    const owner = this.currentOwner();
    const hostChanged = this.owner !== owner;
    if (hostChanged) {
      this.owner = owner;
      this.registryRead += 1;
      this.brokenIcons = new Set();
      this.resetMarket();
      this.setData({ addOpen: false, addMenuOpen: false, registryOpen: false, officialInstallName: '', spec: '', customRegistry: '', registryIndex: 0, actionError: '', showingMore: false, creatingPlugin: false });
    }
    const mapBundle = (b) => Object.assign(bundleToView(b, app), { iconBroken: this.brokenIcons && this.brokenIcons.has(b.name) });
    const install = app.pluginInstall;
    const active = !!(install && ACTIVE.includes(install.phase));
    const busy = active || !!(install && install.phase === 'checking');
    this.setData({
      catalog: catalog ? {
        canManage: catalog.managementAvailable === true,
        featuredBundles: (catalog.featuredBundles || catalog.officialBundles).map(mapBundle),
        moreBundles: (catalog.moreBundles || catalog.officialBundles).map(mapBundle),
        officialItems: catalog.officialItems.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          artwork: artworkFor(o.id),
          initial: (o.title || o.id).charAt(0)
        })),
        installedBundles: catalog.installedBundles.map(mapBundle)
      } : null,
      loading: app.pluginsLoading === true,
      error: app.pluginsError || '',
      notice: app.pluginNotice || '',
      connected: app.connection === 'connected',
      pendingName: app.pluginPendingName || null,
      install: install ? { phase: install.phase, summary: installSummary(install), message: install.message, spec: install.spec,
        name: install.subject && install.subject.name || install.spec, version: install.subject && install.subject.version || '',
        logs: install.logs || '', pendingBuilds: install.pendingBuilds || [], recovering: install.recovering === true, cancelling: install.cancelling === true } : null,
      installBusy: busy, installActive: active,
      installEditable: !install || ['failed', 'cancelled', 'unknown'].includes(install.phase),
      canAdd: app.connection === 'connected' && !!catalog && catalog.managementAvailable === true && !app.pluginPendingName
    });
    if (this.data.refreshing && app.pluginsLoading !== true) {
      this.setData({ refreshing: false });
    }
    if ((reconnected || hostChanged) && this.data.pluginTab === 'discover') this.loadMarketSources();
  },

  // Keep failed remote icons on local artwork across catalog refreshes.
  onIconError(e) {
    const name = (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.name) || '';
    if (!name || !this.data.catalog) return;
    this.brokenIcons.add(name);
    this.syncFromStore();
  },

  onRefresh() {
    if (this.data.pluginTab === 'discover' && !this.data.showingMore) { this.loadMarketSources(); return; }
    if (this.data.loading) return;
    this.setData({ refreshing: true });
    store.refreshPlugins();
  },

  goBack() {
    if (this.data.marketMenuOpen) { this.closeMarketMenu(); return; }
    if (this.data.sourcesOpen) { this.closeSources(); return; }
    if (this.data.registryOpen) { this.closeRegistry(); return; }
    if (this.data.addOpen) { this.closeAdd(); return; }
    if (this.data.showingMore) { this.setData({ showingMore: false }); return; }
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
    const bundle = store.state.pluginCatalog && store.state.pluginCatalog.bundles.find(b => b.name === name);
    if (!bundle || bundleToView(bundle, store.state).toggleDisabled) { this.syncFromStore(); return; }
    const current = e.currentTarget.dataset.enabled === true;
    const requested = e.detail.value;
    if (!name || requested === current) {
      // 状态被禁用拦截时同步回原值
      this.syncFromStore();
      return;
    }
    if (requested && bundle.availability === 'missing') {
      this.syncFromStore();
      this.openOfficialInstall(name);
      return;
    }
    if (['dsh-plugin-mobile-gateway', 'dsh-plugin-weapp-gateway'].includes(name) && !requested) {
      wx.showModal({
        title: uiText('停用移动网关？'),
        content: uiText('停用后手机会断开连接。只能从 DSH Web 或 CLI 重新开启此插件。'),
        confirmText: uiText('停用'),
        confirmColor: '#FF3B30',
        cancelText: uiText('取消'),
        success: (res) => {
          if (res.confirm) store.setPluginEnabled(name, false);
          else this.syncFromStore();
        }
      });
      return;
    }
    if (!store.setPluginEnabled(name, requested)) this.syncFromStore();
  }
}));
