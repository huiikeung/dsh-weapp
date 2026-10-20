const { t: uiText } = require('../../utils/ui-preferences');
// 插件详情页（对齐 dsh-mobile PluginDetailView / OfficialPluginDetailView /
// PluginComponentSheet）：bundle 概要 + 组件列表开关 + 组件半屏详情。

const store = require('../../utils/store');
const theme = require('../../utils/theme');
const plugins = require('../../utils/plugins');
const { artworkFor, imageSource } = require('./plugin-artwork');
const { ACTIVE } = require('../../utils/plugin-install');
// WeChat's dependency scanner skips require() inside object spread.
const settingsActions = require('./settings-actions');

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
    icon: imageSource(row.icon),
    artwork: artworkFor('', true),
    phase: row.phase,
    initial: (row.name || row.id || '?').charAt(0),
    enabled: row.enabled,
    readOnlyReason: row.readOnlyReason,
    statusText: row.statusText,
    dotClass: running ? 'ok' : failed ? 'bad' : '',
    toggleDisabled: store.state.connection !== 'connected' ||
      !!row.readOnlyReason || !!store.state.pluginPendingName ||
      !(store.state.pluginCatalog && store.state.pluginCatalog.managementAvailable) ||
      !!(store.state.pluginInstall && ACTIVE.includes(store.state.pluginInstall.phase))
  };
}

Page(Object.assign({}, settingsActions, {
  data: {
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    statusBarH: 44,
    detailScrollHeight: 600,
    mode: 'bundle', // bundle | official
    bundle: null,
    official: null,
    connected: false,
    notice: '',
    pendingName: null,
    sheetEntry: null,
    config: null, configStatus: 'idle', configError: '', configSaving: false, configModelsStatus: 'idle'
  },

  onUiLocaleChange() { this.syncFromStore(); this.renderVoiceSettings(); },
  onLoad(options) {
    this.configDisposed = false;
    this.brokenIcons = new Set();
    theme.applyTo(this);
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.updateDetailViewport(info);
    } catch (e) { /* 默认 44 */ }
    this.bundleName = options.bundle ? decodeURIComponent(options.bundle) : null;
    this.officialId = options.official ? decodeURIComponent(options.official) : null;
    this.setData({ mode: this.officialId ? 'official' : 'bundle' });
    this.unsubscribe = store.subscribe(() => this.syncFromStore());
    this.syncFromStore();
  },

  updateDetailViewport(info) {
    const top = Number(info.statusBarHeight) || this.data.statusBarH;
    const width = Number(info.windowWidth) || 375;
    this.setData({ statusBarH: top, detailScrollHeight: Math.max(160, (Number(info.windowHeight) || 800) - top - 92 * width / 750) });
  },
  onResize(e) { this.updateDetailViewport(e.size || {}); },
  onShow() {
    this.voiceHidden = false;
    // Direct entry from settings must not depend on visiting the plugin list first.
    if (!store.state.pluginCatalog && !store.state.pluginsLoading) store.refreshPlugins();
    if (this.configForm && this.configForm.kind === 'voice') this.loadVoiceSettings();
  },
  onHide() {this.voiceHidden=true;clearTimeout(this.voiceTimer);},
  onUnload() {
    this.configDisposed = true; this.configGeneration = (this.configGeneration || 0) + 1; this.configSecret = '';
    clearTimeout(this.voiceTimer);
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore() {
    const app = store.state;
    const cached = app.pluginCatalog;
    const catalog = cached && cached.source ? plugins.buildCatalog(cached.source) : cached;
    if (this.data.mode === 'official') {
      const item = catalog && catalog.officialItems.find((o) => o.id === this.officialId) || plugins.buildCatalog({ officialItems: [{ id: this.officialId }] }).officialItems[0];
      this.setData({
        official: item ? {
          id: item.id,
          title: item.title,
          description: item.description,
          namespaces: item.namespaces,
          artwork: artworkFor(item.id),
          initial: (item.title || item.id).charAt(0)
        } : null,
        connected: app.connection === 'connected',
        notice: app.pluginNotice || '',
        pendingName: app.pluginPendingName || null
      });
      this.syncSettings();
      return;
    }
    this.syncSettings();
    const bundle = catalog && catalog.bundles.find((b) => b.name === this.bundleName);
    if (!bundle) {
      this.setData({ bundle: null, sheetEntry: null, connected: app.connection === 'connected', notice: app.pluginNotice || '' });
      return;
    }
    const entries = bundle.rows.map((row) => {
      const entryID = row.entryId;
      const live = catalog.plugins.find((p) => p.id === entryID);
      const view = entryToView(plugins.buildRow(row, live));
      return { ...view, iconBroken: this.brokenIcons && this.brokenIcons.has(view.icon) };
    });
    this.setData({
      bundle: {
        name: bundle.name,
        title: bundle.title,
        description: bundle.description,
        icon: imageSource(bundle.icon),
        iconBroken: this.brokenIcons && this.brokenIcons.has(imageSource(bundle.icon)),
        artwork: artworkFor(bundle.name),
        experimental: bundle.experimental,
        sourceSpec: bundle.sourceSpec,
        sourceLabel: bundle.sourceSpec || (bundle.availability === 'missing' ? uiText(bundle.installed ? '文件缺失' : '未安装') : (bundle.isOfficial || bundle.availability === 'provided' || bundle.availability === 'installation') ? uiText('内置') : uiText('未提供')),
        initial: (bundle.title || bundle.name).charAt(0),
        version: bundle.version,
        enabled: bundle.enabled,
        needsInstall: bundle.availability === 'missing',
        readOnlyReason: bundle.readOnlyReason,
        error: bundle.error,
        entries: entries,
        activeCount: entries.filter((e) => e.enabled && e.phase === 'active').length,
        toggleDisabled: app.connection !== 'connected' || !!bundle.readOnlyReason ||
          !!app.pluginPendingName || catalog.managementAvailable !== true ||
          !!(app.pluginInstall && ACTIVE.includes(app.pluginInstall.phase))
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
  onIconError(e) {
    const src = e.currentTarget.dataset.src;
    if (!src) return;
    if (!this.brokenIcons) this.brokenIcons = new Set();
    this.brokenIcons.add(src); this.syncFromStore();
  },

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
    if (bundle.toggleDisabled) { this.syncFromStore(); return; }
    if (requested && bundle.needsInstall) {
      this.syncFromStore();
      wx.navigateTo({ url: '/pages/plugins/plugins?install=' + encodeURIComponent(bundle.name) });
      return;
    }
    if (bundle.name === GATEWAY_PLUGIN && !requested) {
      wx.showModal({
        title: uiText('停用移动网关？'),
        content: uiText('停用后手机会断开连接。只能从 DSH Web 或 CLI 重新开启此插件。'),
        confirmText: uiText('停用'),
        confirmColor: '#FF3B30',
        cancelText: uiText('取消'),
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
    const entry = bundle.entries.find(item => item.entryID === entryId);
    if (!entry || entry.toggleDisabled) { this.syncFromStore(); return; }
    store.setPluginEnabled(bundle.name, e.detail.value, entryId);
  }
}));
