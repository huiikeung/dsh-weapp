const { t: uiText } = require('../../utils/ui-preferences');
// Desktop plugin hierarchy with mobile More navigation and Host-owned installation tasks.

const store = require('../../utils/store');
const theme = require('../../utils/theme');
const plugins = require('../../utils/plugins');
const { ACTIVE } = require('../../utils/plugin-install');
const { installSummary } = require('./plugin-presentation');
const installActions = require('./install-actions');
const marketActions = require('./market-actions');
// 卡片点击直接弹窗：复用详情页的设置表单逻辑（配置读写、语音、校验）。
const settingsActions = require('./settings-actions');
const { kindFor } = require('./plugin-settings');


const { artworkFor, imageSource } = require('./plugin-artwork');



// 图标由 DSH 同步下发（meta.icon，SVG data URL）。微信 <image> 不渲染 SVG data URL，
// 用离屏 canvas 转成 PNG data URL 后即可正常显示；转换失败则回退本地 artwork。
const iconPngCache = Object.create(null);
const iconPngBusy = Object.create(null);
let iconPngReady = () => {};

function iconPngFrom(name, dataUrl) {
  // A plugin can change artwork (or hosts) without changing its package name.
  const key = dataUrl;
  if (Object.prototype.hasOwnProperty.call(iconPngCache, key)) return iconPngCache[key];
// 暂不支持api has.createOffscreenCanvas TODO
  if (iconPngBusy[key] || typeof has === 'undefined' || typeof has.createOffscreenCanvas !== 'function') return null;
  iconPngBusy[key] = true;
  try {
// 暂不支持api has.createOffscreenCanvas TODO
    const canvas = has.createOffscreenCanvas({ type: '2d', width: 108, height: 108 });
    const img = canvas.createImage();
    img.onload = () => {
      try {
        const ctx = canvas.getContext('2d');
        const SIZE = 108;
        const imageWidth = Number(img.width || img.naturalWidth) || SIZE;
        const imageHeight = Number(img.height || img.naturalHeight) || SIZE;
        const fitScale = Math.min(SIZE / imageWidth, SIZE / imageHeight);
        const renderWidth = imageWidth * fitScale;
        const renderHeight = imageHeight * fitScale;
        const renderX = (SIZE - renderWidth) / 2;
        const renderY = (SIZE - renderHeight) / 2;
        ctx.clearRect(0, 0, SIZE, SIZE);
        // Preserve the icon's viewBox whitespace. Cropping transparent edges
        // made metadata icons appear larger than the built-in artwork beside them.
        ctx.drawImage(img, renderX, renderY, renderWidth, renderHeight);
        iconPngCache[key] = canvas.toDataURL('image/png');
      } catch (_) { iconPngCache[key] = null; }
      delete iconPngBusy[key];
      iconPngReady();
    };
    img.onerror = () => { iconPngCache[key] = null; delete iconPngBusy[key]; iconPngReady(); };
    img.src = dataUrl;
  } catch (_) { iconPngCache[key] = null; delete iconPngBusy[key]; }
  return null;
}

/** 同步图标优先：SVG data URL 转 PNG 后交给 <image>，其余（http(s)/本地）原样使用。 */
function syncedIcon(name, value) {
  const src = imageSource(value);
  if (!src) return null;
  return /^data:image\/svg\+xml;/i.test(src) ? iconPngFrom(name, src) : src;
}

function bundleToView(b, app) {
  const canManage = !!(app.pluginCatalog && app.pluginCatalog.managementAvailable);
  return {
    name: b.name,
    title: b.title,
    description: b.description,
    // Match DSH PackageArtwork: manifest icon first, original default otherwise.
    // Older gateways send a reconstructed, oversized default; do not use it.
    icon: syncedIcon(b.name, b.icon),
    artwork: artworkFor(b.icon ? b.name : ''),
    initial: (b.title || b.name || '?').charAt(0),
    enabled: b.enabled,
    experimental: b.experimental,
    needsInstall: b.availability === 'missing',
    error: b.error || '',
    updateAvailable: !!b.updateAvailable,
    latestVersion: b.latestVersion || '',
    // iOS：断连 / 只读 / 有变更在途 / 目录不支持管理时禁用开关
    toggleDisabled: app.connection !== 'connected' || !!b.readOnlyReason ||
      !!app.pluginPendingName || !!(app.pluginInstall && ACTIVE.includes(app.pluginInstall.phase)) || !canManage
  };
}

Page(Object.assign({}, settingsActions, installActions, marketActions, {
  data: {
    // ASCF 页面需显式注入 i18n 词典，模板 {{ui['…']}} 才有值。
    ui: require('../../utils/ui-preferences').snapshot().ui,
    detailOpen: false,
    detailTitle: '',
    detailDescription: '',
    detailCaption: '',
    detailName: '',
    detailIcon: '',
    detailArtwork: '',
    detailVersion: '',
    detailUpdateAvailable: false,
    detailCanUninstall: false,
    detailEntries: [],
    detailActiveCount: 0,
    detailEntriesToggleDisabled: true,
    detailSourceLabel: '',
    detailPackageName: '',
    detailEnabled: false,
    detailToggleDisabled: false,
    detailHasConfig: false,
    config: null, configStatus: 'idle', configError: '', configSaving: false, configModelsStatus: 'idle',
    voice: null, voiceBusy: false, voiceError: '',
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    statusBarH: 44, navPadTop: 44, navHeight: 32,
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
  /** ASCF 自定义导航：返回按钮与系统胶囊按同一水平线对齐。 */
  applyNavigationInsets() {
    let top = 44, height = 32;
    try {
      const info = typeof has.getWindowInfo === 'function' ? has.getWindowInfo() : has.getSystemInfoSync();
      const statusBar = Number(info && info.statusBarHeight) || 0;
      const safeTop = Number(info && info.safeArea && info.safeArea.top) || 0;
      top = Math.max(statusBar, safeTop) + 6;
    } catch (e) { /* 保持默认 */ }
    try {
      const rect = typeof has.getMenuButtonBoundingClientRect === 'function' ? has.getMenuButtonBoundingClientRect() : null;
      if (rect && Number(rect.top) > 0 && Number(rect.height) > 0) { top = Number(rect.top); height = Number(rect.height); }
    } catch (e) { /* 旧基础库回退到状态栏高度 */ }
    if (!(top > 40)) top = 44;
    this.setData({ navPadTop: top, navHeight: height });
  },

  onLoad(options) {
    this.applyNavigationInsets();
    this.pendingOfficialInstall = options && options.install || '';
    this.pendingPluginAction = options && options.action === 'create' ? 'create' : '';
    this.alive = true;
    this.owner = this.currentOwner();
    this.registryRead = 0;
    this.marketRead = 0; this.marketListingRead = 0; this.sourceWrite = 0;
    this.brokenIcons = new Set();
    this.setData({ spec: store.state.pluginInstall && store.state.pluginInstall.spec || '' });
    if (options && options.tab === 'discover') this.setData({ pluginTab: 'discover' });
    theme.applyTo(this);
    try {
      const info = typeof has.getWindowInfo === 'function' ? has.getWindowInfo() : has.getSystemInfoSync();
      this.setData({ statusBarH: info.statusBarHeight || 44 });
    } catch (e) { /* 默认 44 */ }
    this.unsubscribe = store.subscribe(() => this.syncFromStore());
    // 同步图标转 PNG 是异步的，完成后重绘换上真图标
    iconPngReady = () => { if (this.alive) this.syncFromStore(); };
    this.syncFromStore();
  },

  onShow() {
    // 对齐 iOS .task { store.refreshPlugins() }
    store.refreshPlugins();
    if (this.pendingPluginAction === 'create') {
      this.pendingPluginAction = '';
      this.createPluginSession();
    }
    // 详情页「更新」把目标放到 store，这里消费后直接打开官方安装面板
    if (!this.pendingOfficialInstall && store.state.pendingOfficialInstall) {
      this.pendingOfficialInstall = store.state.pendingOfficialInstall;
      store.state.pendingOfficialInstall = '';
    }
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
    const mapBundle = (b) => {
      const view = Object.assign(bundleToView(b, app), { iconBroken: this.brokenIcons && this.brokenIcons.has(b.name) });
      // 开关点击后先本地回显，等目录帧回来再看服务端口径（ASCF 回执较慢，不能一直显示旧状态）。
      const pending = this._pendingBundleToggle;
      if (pending && pending.name === b.name) {
        if (view.enabled === pending.enabled) this._pendingBundleToggle = null;
        else view.enabled = pending.enabled;
      }
      return view;
    };
    const install = app.pluginInstall;
    const active = !!(install && ACTIVE.includes(install.phase));
    const busy = active || !!(install && install.phase === 'checking');
    this.setData({
      catalog: catalog ? {
        canManage: catalog.managementAvailable === true,
        featuredBundles: (catalog.featuredBundles || catalog.officialBundles).map(mapBundle),
        moreBundles: (catalog.moreBundles || catalog.officialBundles).map(mapBundle),
        officialItems: catalog.officialItems.map((o) => {
          return {
            id: o.id,
            title: o.title,
            description: o.description,
            // 网关按 DSH 客户端注册表下发图标；旧版网关没有时才回退本地 artwork
            icon: syncedIcon(o.id, o.icon) || artworkFor(o.id),
            artwork: artworkFor(o.id),
            initial: (o.title || o.id).charAt(0)
          };
        }),
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
    this.refreshDetailSheet(catalog);
    this.consumePendingOfficialInstall();
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
    has.navigateBack({
      fail() {
        has.reLaunch({ url: '/pages/home/home' });
      }
    });
  },

  /** 目录就绪后消费详情页挂起的「更新」目标（onShow 时目录可能还没到）。 */
  consumePendingOfficialInstall() {
    if (!this.pendingOfficialInstall || !store.state.pluginCatalog) return;
    const name = this.pendingOfficialInstall;
    this.pendingOfficialInstall = '';
    const bundle = (store.state.pluginCatalog.bundles || []).find(b => b.name === name);
    // 已安装且有新版本：走覆盖安装（等同桌面端更新）；否则按缺失插件安装。
    if (bundle && bundle.updateAvailable) {
      this.updateBundle({ currentTarget: { dataset: { name } } });
      return;
    }
    this.openOfficialInstall(name);
  },

  /** 卡片点击：直接在当前页弹出玻璃弹窗（详情 + 设置），不再跳转页面。 */
  openBundle(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    const bundle = (store.state.pluginCatalog && store.state.pluginCatalog.bundles || []).find(b => b.name === name);
    if (!bundle) return;
    const view = bundleToView(bundle, store.state);
    const entries = this.buildDetailEntries(bundle);
    this.bundleName = name;
    this.officialId = null;
    this.configForm = null; this.configInputs = {}; this.configSecret = '';
    // 先只渲染弹窗骨架，下一帧再补条目和设置，避免开弹窗瞬间卡一下。
    this.setData({
      detailOpen: true,
      detailName: name,
      detailTitle: view.title || name,
      detailDescription: view.description || '',
      detailCaption: bundle.availability === 'missing' ? uiText('需先安装') : '',
      detailIcon: view.icon || '',
      detailArtwork: view.artwork || '',
      detailVersion: bundle.version || '',
      detailUpdateAvailable: !!bundle.updateAvailable,
      detailCanUninstall: bundle.installed === true && !bundle.readOnlyReason,
      detailEntries: entries,
      detailActiveCount: entries.filter(e => e.enabled && e.phase === 'active').length,
      detailEntriesToggleDisabled: store.state.connection !== 'connected' || !!bundle.readOnlyReason || !!store.state.pluginPendingName || (store.state.pluginCatalog && store.state.pluginCatalog.managementAvailable !== true),
      detailEnabled: view.enabled === true,
      detailToggleDisabled: view.toggleDisabled === true,
      detailSourceLabel: bundle.sourceSpec || (bundle.availability === 'missing'
        ? uiText(bundle.installed ? '文件缺失' : '未安装')
        : ((bundle.isOfficial || bundle.availability === 'provided' || bundle.availability === 'installation') ? uiText('内置') : uiText('未提供'))),
      detailPackageName: name,
      detailHasConfig: !!kindFor(null, name),
      config: null, configStatus: 'idle', configError: '', configSaving: false, voice: null, voiceError: ''
    });
    this.scheduleSettingsLoad();
  },

  /** 打开弹窗即开始加载设置；命中预取缓存时同步渲染，避免等一次网络往返。 */
  scheduleSettingsLoad() {
    if (this._detailRenderTimer) { clearTimeout(this._detailRenderTimer); this._detailRenderTimer = null; }
    this.setData({ configStatus: 'idle' });
    this.syncSettings();
  },

  onDetailIconError() {
    if (this.data.detailIcon) this.setData({ detailIcon: '' });
  },

  closeDetail() {
    if (this.data.configSaving) return;
    if (this._detailRenderTimer) { clearTimeout(this._detailRenderTimer); this._detailRenderTimer = null; }
    this.bundleName = null; this.officialId = null;
    this.configForm = null; this.configInputs = {}; this.configSecret = '';
    this.setData({ detailOpen: false, config: null, configStatus: 'idle', configError: '', voice: null, detailName: '' });
  },

  /** 弹窗内更新：复用列表的覆盖安装流程。 */
  updateDetailBundle() {
    const name = this.data.detailName;
    if (!name) return;
    this.setData({ detailOpen: false });
    this.updateBundle({ currentTarget: { dataset: { name } } });
  },

  /** 弹窗内卸载：二次确认后调用网关卸载并刷新目录。 */
  uninstallDetailBundle() {
    const name = this.data.detailName;
    if (!name) return;
    has.showModal({
      title: uiText('卸载插件'),
      content: uiText('卸载后将从主机移除该插件及其组件，确定继续吗？'),
      confirmText: uiText('卸载'),
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        Promise.resolve(store.client.requestPluginUninstall(name)).then(() => {
          store.refreshPlugins();
          this.setData({ detailOpen: false });
          has.showToast({ title: uiText('已卸载'), icon: 'success' });
        }).catch((error) => {
          has.showToast({ title: (error && error.message) || uiText('卸载失败'), icon: 'none' });
        });
      }
    });
  },

  /** 检查到新版本：按主机提供的安装目标直接覆盖安装，等同在 DSH 客户端更新。 */
  updateBundle(e) {
    const name = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.name : '';
    if (!name || !this.data.canAdd || this.data.installBusy) return;
    if (!store.pluginInstaller.reset()) return;
    try {
      store.pluginInstaller.prepareUpdate(name);
    } catch (error) {
      has.showToast({ title: (error && error.message) || uiText('无法更新该插件'), icon: 'none' });
      return;
    }
    this.setData({ officialInstallName: '', spec: '', addOpen: true, actionError: '' });
    this.openAdd();
  },

  /** 内置插件配置卡片：同样直接弹窗。 */
  openOfficial(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // 用已处理过的目录视图：图标已转成本地可渲染的 PNG / artwork，原始数据里的 SVG data URL 在 <image> 里不显示。
    const item = ((this.data.catalog && this.data.catalog.officialItems) || []).find(x => x.id === id);
    if (!item) return;
    this.officialId = id;
    this.bundleName = null;
    this.configForm = null; this.configInputs = {}; this.configSecret = '';
    this.setData({
      detailOpen: true,
      detailName: '',
      detailTitle: item.title || id,
      detailDescription: item.description || '',
      detailCaption: uiText('内置插件配置'),
      detailIcon: item.icon || '',
      detailArtwork: item.artwork || '',
      detailVersion: '',
      detailUpdateAvailable: false,
      detailCanUninstall: false,
      detailEntries: [],
      detailActiveCount: 0,
      detailSourceLabel: uiText('内置'),
      detailPackageName: item.id,
      detailHasConfig: !!kindFor(item.id, null),
      config: null, configStatus: 'idle', configError: '', configSaving: false, voice: null, voiceError: ''
    });
    this.scheduleSettingsLoad();
  },

  /** 目录/状态变化时，让已打开的弹窗跟着刷新（开关、条目、更新角标）。 */
  refreshDetailSheet(catalog) {
    if (!this.data.detailOpen) return;
    const name = this.data.detailName;
    if (!name) { this.syncSettings(); return; }
    const bundle = (catalog && catalog.bundles || []).find(b => b.name === name);
    if (!bundle) return;
    const entries = this.buildDetailEntries(bundle).map((entry) => {
      const key = name + ':' + entry.entryID;
      const pending = this._pendingEntryToggles && this._pendingEntryToggles[key];
      if (pending === undefined) return entry;
      if (entry.enabled === pending) { delete this._pendingEntryToggles[key]; return entry; }
      return Object.assign({}, entry, { enabled: pending });
    });
    const bundlePending = this._pendingBundleToggle;
    const enabledOverride = bundlePending && bundlePending.name === name ? bundlePending.enabled : null;
    this.setData({
      detailEntries: entries,
      detailActiveCount: entries.filter(e => e.enabled && e.phase === 'active').length,
      detailEntriesToggleDisabled: store.state.connection !== 'connected' || !!bundle.readOnlyReason || !!store.state.pluginPendingName || (store.state.pluginCatalog && store.state.pluginCatalog.managementAvailable !== true),
      detailUpdateAvailable: !!bundle.updateAvailable,
      detailCanUninstall: bundle.installed === true && !bundle.readOnlyReason,
      detailVersion: bundle.version || '',
      detailEnabled: enabledOverride === null ? bundle.enabled === true : enabledOverride,
      detailToggleDisabled: store.state.connection !== 'connected' || !!bundle.readOnlyReason || !!store.state.pluginPendingName
    });
    this.syncSettings();
  },

  /** 组件条目视图（与详情页同口径）。 */
  buildDetailEntries(bundle) {
    const catalog = store.state.pluginCatalog;
    if (!catalog || !Array.isArray(bundle.rows)) return [];
    return bundle.rows.map((row) => {
      const live = (catalog.plugins || []).find((p) => p.id === row.entryId);
      const built = plugins.buildRow(row, live);
      return {
        id: built.id,
        entryID: built.entryID || row.entryId,
        name: built.name,
        description: built.description,
        enabled: built.enabled,
        phase: built.phase,
        statusText: built.statusText,
        readOnlyReason: built.readOnlyReason
      };
    });
  },

  onDetailEntryToggle(e) {
    const name = this.data.detailName;
    const entryId = e.currentTarget.dataset.entry;
    if (!name || !entryId || this.data.detailEntriesToggleDisabled) { this.syncFromStore(); return; }
    this._pendingEntryToggles = this._pendingEntryToggles || {};
    this._pendingEntryToggles[name + ':' + entryId] = e.detail.value;
    if (!store.setPluginEnabled(name, e.detail.value, entryId)) delete this._pendingEntryToggles[name + ':' + entryId];
    this.syncFromStore();
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
      has.showModal({
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
    this._pendingBundleToggle = { name: name, enabled: requested };
    if (!store.setPluginEnabled(name, requested)) { this._pendingBundleToggle = null; this.syncFromStore(); }
  }
}));
