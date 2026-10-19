'use strict';
const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const INVALID = uiText('请使用 http 或 https 地址，且不要包含用户名、密码或 # 片段');
function indexUrl(value) {
  const text = String(value || '').trim();
  if (text.length > 2048 || !/^https?:\/\/[^\s/?#@\\]+(?:[/?][^\s#\\]*)?$/i.test(text)) throw new Error(INVALID);
  // The Host does final WHATWG URL normalization; the mini-program has no global URL API.
  const match = /^(https?):\/\/([^/?]+)(.*)$/i.exec(text);
  const authority = match[2].toLowerCase().replace(match[1].toLowerCase() === 'https' ? /:443$/ : /:80$/, '');
  if (!/^(?:\[[0-9a-f:]+\]|[^:\[\]]+)(?::\d{1,5})?$/i.test(authority)) throw new Error(INVALID);
  return match[1].toLowerCase() + '://' + authority + (match[3] === '' ? '/' : match[3][0] === '?' ? '/' + match[3] : match[3]);
}
function localized(value) { return require('../../utils/ui-preferences').localized(value); }
function failText(error) {
  const text = error && error.message || '';
  return /unknown message|not supported|超时|unavailable|not found|namespace|method/i.test(text)
    ? uiText('当前网关未提供插件市场接口，请更新网关的市场适配并启用 DSH 插件市场后重试。')
    : uiText('无法读取或保存索引源，请检查主机连接后重试。');
}
function responseValue(frame) { if (!frame || !Object.prototype.hasOwnProperty.call(frame, 'result')) throw new Error(uiText('无效的主机响应')); return frame.result; }
module.exports = {
  toggleMarketCategories() { this.setData({ marketCategoriesExpanded: !this.data.marketCategoriesExpanded }); },
  clearMarketSearchTimer() { if (this.marketSearchTimer) { clearTimeout(this.marketSearchTimer); this.marketSearchTimer = null; } },
  toggleMarketMenu() { this.setData({ marketMenuOpen: !this.data.marketMenuOpen }); },
  closeMarketMenu() { this.setData({ marketMenuOpen: false }); },
  onMarketIconError(e) { const name = e.currentTarget.dataset.name; this.setData({ marketEntries: this.data.marketEntries.map(item => item.name === name ? { ...item, iconBroken: true } : item) }); },
  resetMarket() {
    this.clearMarketSearchTimer();
    this.marketRead++; this.marketListingRead++; this.sourceWrite++;
    this.setData({ marketStatus: 'idle', marketSources: [], marketError: '', marketSelected: '', marketEntries: [], marketQuery: '', marketCategories: [], marketCategoriesExpanded: false, marketCategory: '', marketNext: null, marketFetchedAt: null, marketTitle: '', marketSelectedLabel: '', marketMenuOpen: false, marketListingBusy: false, marketListingError: '', sourcesOpen: false, sourceDraft: '', sourceError: '', sourceSaving: false });
  },
  marketOwns(owner) { return this.alive && this.data.connected && owner === this.currentOwner(); },
  async loadMarketSources() {
    if (this.data.sourceSaving) return;
    this.clearMarketSearchTimer();
    const read = ++this.marketRead, owner = this.currentOwner();
    this.marketListingRead++;
    if (!this.data.connected) { this.setData({ marketStatus: 'error', marketError: uiText('连接网关后可读取和管理索引源'), refreshing: false }); return; }
    this.setData({ marketStatus: 'loading', marketError: '', marketListingBusy: false });
    try {
      const indexes = responseValue(await store.client.requestPlugin('plugin-market-indexes', {}, 10000));
      if (!this.marketOwns(owner) || read !== this.marketRead) return;
      if (!Array.isArray(indexes) || indexes.some(x => !x || typeof x.url !== 'string')) throw new Error(uiText('无效的索引列表'));
      const sources = indexes.map(x => ({ ...x, label: localized(x.title) || x.url.replace(/^https?:\/\//, '').split('/')[0] }));
      const selected = sources.some(x => x.url === this.data.marketSelected) ? this.data.marketSelected : sources[0] && sources[0].url || '';
      if (selected !== this.data.marketSelected) this.setData({ marketCategory: '', marketCategories: [], marketCategoriesExpanded: false, marketQuery: '', marketTitle: '' });
      this.setData({ marketSources: sources, marketSelected: selected, marketSelectedLabel: (sources.find(x => x.url === selected) || {}).label || '', marketStatus: 'ready', refreshing: false });
      if (selected) await this.readMarket(false);
      else { this.marketListingRead++; this.setData({ marketEntries: [], marketNext: null, marketListingBusy: false, marketListingError: '', marketTitle: '', marketCategory: '', marketCategories: [], marketCategoriesExpanded: false }); }
    } catch (error) { if (this.marketOwns(owner) && read === this.marketRead) this.setData({ marketStatus: 'error', marketError: failText(error), refreshing: false }); }
  },
  openSources() {
    this.setData({ sourcesOpen: true, sourceError: '', addMenuOpen: false, marketMenuOpen: false });
    if (this.data.marketStatus === 'idle') this.loadMarketSources();
  },
  closeSources() { this.setData({ sourcesOpen: false }); },
  editSourceDraft(e) { if (!this.data.sourceSaving) this.setData({ sourceDraft: e.detail.value, sourceError: '' }); },
  async addSource() {
    if (this.data.sourceSaving || !this.data.sourceDraft.trim()) return;
    try {
      const url = indexUrl(this.data.sourceDraft);
      if (this.data.marketSources.some(x => { try { return indexUrl(x.url) === url; } catch (_) { return x.url === url; } })) throw new Error(uiText('已添加过这个索引源'));
      await this.saveSources(this.data.marketSources.map(x => x.url).concat(url), url);
    } catch (error) { if (this.alive) this.setData({ sourceError: error.message }); }
  },
  removeSource(e) {
    if (this.data.sourceSaving) return;
    const url = e.currentTarget.dataset.url;
    if (!this.data.marketSources.some(x => x.url === url)) return;
    return this.saveSources(this.data.marketSources.filter(x => x.url !== url).map(x => x.url));
  },
  async saveSources(urls, added) {
    if (!this.data.connected || this.data.marketStatus !== 'ready' || this.data.sourceSaving) return;
    const owner = this.currentOwner(), write = ++this.sourceWrite;
    ++this.marketRead;
    this.setData({ sourceSaving: true, sourceError: '' });
    try {
      responseValue(await store.client.requestPlugin('plugin-market-set-indexes', { urls }, 15000));
      if (!this.marketOwns(owner) || write !== this.sourceWrite) return;
      this.setData({ sourceSaving: false, ...(added ? { sourceDraft: '', marketSelected: added, marketCategory: '', marketCategories: [], marketCategoriesExpanded: false, marketQuery: '', marketTitle: '' } : {}) });
      await this.loadMarketSources();
    } catch (error) {
      if (this.marketOwns(owner) && write === this.sourceWrite) this.setData({ sourceSaving: false, sourceError: /duplicate|twice/i.test(error.message) ? uiText('已添加过这个索引源') : /invalid.*url|credentials|fragment/i.test(error.message) ? INVALID : uiText('保存结果尚未确认。请重新读取索引源后再操作。'), marketStatus: 'error', marketError: failText(error) });
    }
  },
  selectMarket(e) {
    const url = e.currentTarget.dataset.url, source = this.data.marketSources.find(x => x.url === url);
    if (!source) return;
    this.closeMarketMenu();
    if (this.data.marketSelected === url) return;
    this.clearMarketSearchTimer();
    this.setData({ marketSelected: url, marketSelectedLabel: source.label, marketTitle: '', marketQuery: '', marketCategory: '', marketCategories: [], marketCategoriesExpanded: false });
    return this.readMarket(false);
  },
  selectMarketCategory(e) {
    const id = e.currentTarget.dataset.category || '';
    if (id && !(this.data.marketCategories || []).some(item => item.id === id)) return;
    if (id === this.data.marketCategory) return;
    this.clearMarketSearchTimer();
    this.setData({ marketCategory: id, marketNext: null });
    return this.readMarket(false);
  },
  editMarketQuery(e) {
    this.clearMarketSearchTimer(); this.marketListingRead++;
    this.setData({ marketQuery: e.detail.value, marketNext: null, marketListingBusy: true, marketListingError: '' });
    const owner = this.currentOwner();
    this.marketSearchTimer = setTimeout(() => { this.marketSearchTimer = null; if (this.marketOwns(owner)) this.readMarket(false); }, 250);
  },
  searchMarket() { this.clearMarketSearchTimer(); return this.readMarket(false); },
  clearMarketQuery() { this.setData({ marketQuery: '' }); return this.searchMarket(); },
  loadMoreMarket() { if (!this.data.marketListingBusy && this.data.marketNext !== null) return this.readMarket(true); },
  async readMarket(more) {
    if (!this.data.connected || !this.data.marketSelected) return;
    const owner = this.currentOwner(), read = ++this.marketListingRead, url = this.data.marketSelected;
    const query = { text: this.data.marketQuery.trim(), sort: { kind: 'index' }, offset: more ? this.data.marketNext : 0, limit: 50 };
    if (this.data.marketCategory) query.category = this.data.marketCategory;
    if (more && this.data.marketFetchedAt) query.fetchedAt = this.data.marketFetchedAt;
    const previous = more ? this.data.marketEntries : [];
    this.setData({ marketListingBusy: true, marketListingError: '', ...(!more ? { marketEntries: [], marketNext: null } : {}) });
    try {
      const result = responseValue(await store.client.requestPlugin('plugin-market-search', { url, query }, 30000));
      if (!this.marketOwns(owner) || read !== this.marketListingRead) return;
      if (!result || !Array.isArray(result.entries)) throw new Error(uiText('无效的索引内容'));
      const declarations = result.metadata && result.metadata.categories || {};
      const categories = Object.entries(declarations).map(([id, value]) => ({ id, title: localized(value && value.title) || id }))
        .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || (a.id < b.id ? -1 : 1));
      // An index refresh may remove a previously selected category.
      if (this.data.marketCategory && !categories.some(item => item.id === this.data.marketCategory)) {
        this.setData({ marketCategory: '', marketCategories: categories });
        return this.readMarket(false);
      }
      const entries = result.entries.map(entry => {
        const version = (entry.versions || []).find(v => v.version === entry.defaultVersion);
        const presented = version || (entry.versions || [])[0];
        const date = presented && Number.isFinite(presented.publishTimestamp) ? new Date(presented.publishTimestamp * 1000) : null;
        const published = date && Number.isFinite(date.getTime()) ? date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() : '';
        const meta = [presented && presented.version, localized(entry.author), published].filter(Boolean).join(' · ');
        const installed = entry.installation && ['installed', 'provided'].includes(entry.installation.status);
        return { name: entry.name, title: localized(entry.title) || entry.name, description: localized(entry.description), icon: typeof entry.icon === 'string' && (entry.icon.startsWith('https://') || entry.icon.startsWith('data:image/')) ? entry.icon : '', meta, version: presented && presented.version || '', target: version && version.install, installable: !installed && !!(version && version.install && version.compatibility && version.compatibility.compatible), installLabel: installed ? uiText('已安装') : version ? uiText('安装') : uiText('不兼容') };
      });
      this.setData({ marketCategories: categories, marketEntries: previous.concat(entries), marketTitle: localized(result.title), marketSources: this.data.marketSources.map(source => source.url === url && localized(result.title) ? { ...source, label: localized(result.title) } : source), marketFetchedAt: result.fetchedAt, marketNext: result.nextOffset == null ? null : result.nextOffset, marketListingBusy: false });
    } catch (error) { if (this.marketOwns(owner) && read === this.marketListingRead) this.setData({ marketListingBusy: false, marketListingError: uiText('无法读取此索引，请检查索引地址、格式或主机网络后重试。') }); }
  },
  async installMarketEntry(e) {
    const entry = this.data.marketEntries.find(x => x.name === e.currentTarget.dataset.name);
    if (!entry || !entry.installable || !entry.target || !this.data.canAdd || this.data.installBusy) return;
    if (!store.pluginInstaller.reset()) return;
    const owner = this.currentOwner();
    this.setData({ officialInstallName: '', spec: entry.target.spec, enableAfterInstall: false });
    await this.openAdd();
    if (!this.marketOwns(owner) || !this.data.addOpen) return;
    if (entry.target.registry) this.setData({ registryIndex: this.data.registryOptions.findIndex(x => x.value === 'custom'), customRegistry: entry.target.registry });
  }
};
