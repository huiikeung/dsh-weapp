'use strict';
const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');

module.exports = {
  currentOwner() { return store.state.activeID || store.state.gatewayId || store.state.endpoint || ''; },
  noop() {},
  openMore() { this.setData({ showingMore: true, addMenuOpen: false }); },
  toggleAddMenu() { if (this.data.canAdd) this.setData({ addMenuOpen: !this.data.addMenuOpen }); },
  closeAddMenu() { this.setData({ addMenuOpen: false }); },
  async createPluginSession() {
    if (this.data.creatingPlugin) return;
    if (!this.data.connected) {
      wx.showToast({ title: uiText('连接主机后才能创建插件'), icon: 'none' });
      return;
    }
    this.closeAddMenu();
    const owner = this.currentOwner();
    this.setData({ creatingPlugin: true });
    try {
      const roster = await store.client.requestAgentPresets();
      if (!this.alive || owner !== this.currentOwner()) return;
      if (!(roster.presets || []).some(p => p.id === 'cordis')) throw new Error(uiText('当前 DSH 配置未提供创造模式'));
      store.state.pendingPluginCreator = { owner, workspaceId: store.state.currentWorkspaceId };
      const pages = getCurrentPages();
      const index = pages.findIndex(p => p.route === 'pages/home/home');
      const failed = () => { store.state.pendingPluginCreator = null; wx.showToast({ title: uiText('无法打开新会话，请重试'), icon: 'none' }); };
      if (index >= 0) wx.navigateBack({ delta: pages.length - 1 - index, fail: failed });
      else wx.reLaunch({ url: '/pages/home/home', fail: failed });
    } catch (error) { if (this.alive) wx.showToast({ title: error.message || uiText('无法打开创造模式'), icon: 'none' }); }
    finally { if (this.alive) this.setData({ creatingPlugin: false }); }
  },
  selectPluginTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.closeMarketMenu(); this.clearMarketSearchTimer();
    if (tab === 'installed' || tab === 'discover') this.setData({ pluginTab: tab, showingMore: false, addMenuOpen: false });
    if (tab === 'discover') this.loadMarketSources();
  },
  async openOfficialInstall(name) {
    if (!this.data.canAdd || this.data.installBusy) return;
    if (!store.pluginInstaller.reset()) return;
    const bundle = store.state.pluginCatalog && store.state.pluginCatalog.bundles.find(b => b.name === name);
    if (!bundle || !bundle.installTarget) { wx.showToast({ title: uiText('主机未提供安装目标，请刷新或升级 DSH'), icon: 'none' }); return; }
    this.setData({ officialInstallName: name, spec: bundle.installTarget.spec, enableAfterInstall: true, addOpen: true, actionError: '' });
    await this.openAdd();
  },
  async openAdd() {
    if (!this.data.canAdd && !this.data.install) return;
    this.setData({ addOpen: true, addMenuOpen: false, registryOpen: false, actionError: '' });
    if (this.data.install && this.data.install.spec && !this.data.spec) this.setData({ spec: this.data.install.spec });
    if (this.data.installBusy || this.data.install && this.data.install.phase === 'ready') return;
    const read = ++this.registryRead, owner = this.currentOwner();
    this.setData({ registryLoading: true, registryError: '' });
    try {
      const response = await store.pluginInstaller.registries();
      if (!this.alive || read !== this.registryRead || owner !== this.currentOwner()) return;
      const options = [{ label: uiText('主机默认安装源'), value: 'host' }];
      const seen = new Set();
      [response.registry].concat(response.fallbackRegistries || [], [null]).forEach(value => {
        if (value !== null && (typeof value !== 'string' || !/^https?:\/\//i.test(value))) return;
        const key = value === null ? 'pnpm' : value.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const label = value === null ? uiText('pnpm 配置') : /\/\/registry\.npmmirror\.com(?:\/|$)/i.test(value) ? uiText('中国大陆镜像源')
          : /\/\/registry\.npmjs\.org(?:\/|$)/i.test(value) ? uiText('npm 官方源') : value;
        options.push({ label, value });
      });
      options.push({ label: uiText('自定义地址'), value: 'custom' });
      this.setData({ registryOptions: options, registryIndex: 0 });
    } catch (error) {
      if (this.alive && read === this.registryRead && owner === this.currentOwner()) this.setData({ registryError: error.message || uiText('无法读取安装源，将使用主机默认配置') });
    } finally {
      if (this.alive && read === this.registryRead && owner === this.currentOwner()) this.setData({ registryLoading: false });
    }
  },
  closeAdd() {
    this.registryRead += 1;
    if (this.data.install && this.data.install.phase === 'checking') store.pluginInstaller.reset();
    this.setData({ addOpen: false, registryOpen: false, registryLoading: false });
    if (!this.data.installActive) this.setData({ officialInstallName: '' });
  },
  onSpecInput(e) { if (this.data.installEditable && !this.data.officialInstallName) this.setData({ spec: e.detail.value, actionError: '' }); },
  openRegistry() { if (this.data.installEditable && !this.data.registryLoading) this.setData({ registryOpen: true }); },
  closeRegistry() { this.setData({ registryOpen: false }); },
  selectRegistry(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!this.data.installEditable || !this.data.registryOptions[index]) return;
    this.setData({ registryIndex: index, registryOpen: false, actionError: '' });
  },
  onRegistryChange(e) { if (this.data.installEditable) this.setData({ registryIndex: Number(e.detail.value), actionError: '' }); },
  onCustomRegistryInput(e) { if (this.data.installEditable) this.setData({ customRegistry: e.detail.value, actionError: '' }); },
  onEnableChange(e) { this.setData({ enableAfterInstall: e.detail.value === true }); },
  toggleGuide() { this.setData({ guideOpen: !this.data.guideOpen }); },
  toggleLogs() { this.setData({ logsOpen: !this.data.logsOpen }); },
  async checkPlugin() {
    if (!this.data.canAdd || this.data.installBusy || this.data.registryLoading) return;
    const choice = this.data.registryOptions[this.data.registryIndex];
    const registry = choice.value === 'host' ? undefined : choice.value === 'custom' ? this.data.customRegistry.trim() : choice.value;
    const owner = this.currentOwner();
    this.setData({ actionError: '' });
    try {
      if (this.data.officialInstallName) store.pluginInstaller.prepareOfficial(this.data.officialInstallName, registry);
      else await store.pluginInstaller.inspect(this.data.spec, registry);
      if (!this.alive || !this.data.addOpen || owner !== this.currentOwner()) return;
      if (store.state.pluginInstall && store.state.pluginInstall.phase === 'ready') {
        await store.pluginInstaller.start(this.data.officialInstallName ? true : this.data.enableAfterInstall);
      }
    }
    catch (error) { if (this.alive) this.setData({ actionError: error.message }); }
  },
  async confirmInstall() {
    if (!this.data.canAdd || !this.data.install || this.data.install.phase !== 'ready') return;
    try { await store.pluginInstaller.start(this.data.enableAfterInstall); }
    catch (error) { if (this.alive) this.setData({ actionError: error.message }); }
  },
  editInstall() {
    if (store.pluginInstaller.reset()) this.setData({ actionError: '', logsOpen: false, officialInstallName: '' });
  },
  reconcileInstall() { return store.pluginInstaller.reconcile(); },
  cancelInstall() { return store.pluginInstaller.cancel(); },
  approveBuilds() {
    const task = store.state.pluginInstall;
    if (!task || task.phase !== 'failed' || !task.pendingBuilds.length || !this.data.canAdd) return;
    const names = task.pendingBuilds.slice(), owner = this.currentOwner(), installId = task.installId;
    wx.showModal({ title: uiText('允许运行安装脚本？'), content: names.join('\n') + uiText('\n这些脚本会以你的权限在 DSH 主机执行，授权保存在当前 profile。仅在信任这些包时允许。'),
      confirmText: uiText('允许并重试'), confirmColor: '#C05B16', success: async (res) => {
        if (!res.confirm || !this.alive || owner !== this.currentOwner() || !store.state.pluginInstall || store.state.pluginInstall.installId !== installId) return;
        try { await store.pluginInstaller.approveBuilds(names); }
        catch (error) { if (this.alive) this.setData({ actionError: error.message }); }
      } });
  }
};
