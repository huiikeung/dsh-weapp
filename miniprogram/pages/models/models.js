const store = require('../../utils/store');
const theme = require('../../utils/theme');
const haptics = require('../../utils/haptics');
const { t: uiText } = require('../../utils/ui-preferences');
const helper = require('../../utils/model-settings');

const EMPTY_FORM = () => ({ id: '', name: '', contextWindow: '', maxTokens: '', text: true, image: false });

const FORM_ERRORS = {
  'id-empty': '模型 ID 不能为空',
  'id-duplicate': '该模型已存在',
  'context-invalid': '上下文窗口必须是正整数',
  'max-invalid': '最大输出 Token 必须是正整数',
  'input-empty': '至少选择一种输入类型'
};

const PROVIDER_ERRORS = {
  'provider-id-empty': '请输入 Provider ID',
  'provider-id-invalid': 'Provider ID 只能包含字母、数字、点、下划线和连字符',
  'provider-id-duplicate': 'Provider ID 已存在',
  'base-url-invalid': '接口地址必须是 http(s) 绝对地址',
  'api-invalid': '请选择 API 协议',
  'catalog-empty': '请选择模型提供商',
  'models-empty': '请先获取并选择至少一个模型'
};

function filterDiscoveryRows(rows, query) {
  const keyword = String(query == null ? '' : query).trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!keyword) return list.slice();
  return list.filter((row) => String(row.name || '').toLowerCase().indexOf(keyword) >= 0
    || String(row.id || '').toLowerCase().indexOf(keyword) >= 0);
}

function countSelected(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.selected).length;
}

function markSelected(rows, id) {
  return (Array.isArray(rows) ? rows : []).map((row) => (row && row.id === id ? Object.assign({}, row, { selected: !row.selected }) : row));
}

function selectAllVisible(rows, visible) {
  const visibleIds = {};
  (Array.isArray(visible) ? visible : []).forEach((row) => { if (row && row.id) visibleIds[row.id] = true; });
  const anyUnselected = (Array.isArray(rows) ? rows : []).some((row) => row && visibleIds[row.id] && !row.selected);
  return (Array.isArray(rows) ? rows : []).map((row) => (row && visibleIds[row.id] ? Object.assign({}, row, { selected: anyUnselected }) : row));
}

function selectedCandidates(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.selected).map((row) => ({ id: row.id, name: row.name }));
}

Page({
  data: {
    theme: 'light',
    themeClass: 'theme-light',
    pageStyle: '',
    statusBarH: 44,
    connected: false,
    loading: true,
    refreshing: false,
    error: '',
    providers: [],
    expandedId: '',
    defaultSelection: null,
    addOpen: false,
    addProviderId: '',
    addProviderName: '',
    form: EMPTY_FORM(),
    formError: '',
    saving: false,
    deleteOpen: false,
    deleteTarget: null,
    deleting: false,
    // 自动获取模型 / 添加模型提供商（需要网关 llm-model-config-v1）
    supportsModelConfig: false,
    discovering: false,
    discoveryError: '',
    discoveryQuery: '',
    discoveryResults: [],
    discoveryVisible: [],
    discoverySelectedCount: 0,
    providerSheetOpen: false,
    providerMode: 'catalog',
    providerBusy: false,
    providerError: '',
    catalogProviders: [],
    catalogQuery: '',
    catalogVisible: [],
    providerProtocols: helper.PROTOCOLS,
    providerDraft: { providerId: '', displayName: '', baseURL: '', api: 'openai-completions', apiKey: '', nativeAuthHint: '' },
    providerDiscovering: false,
    providerDiscoveryError: '',
    providerDiscoveryQuery: '',
    providerDiscoveryResults: [],
    providerDiscoveryVisible: [],
    providerSelectedCount: 0
  },

  onLoad() {
    theme.applyTo(this);
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarH: info.statusBarHeight || 44 });
    } catch (e) { /* 默认 44 */ }
    this._piNamespace = null;
    this._providersFrame = null;
    this._providers = {};
    this._lastSettingsChange = null;
    this._refreshTimer = null;
    this._unsubscribe = store.subscribe(() => this.onStoreChange());
    this.syncConnection();
    this.syncModelCapability();
    this.refresh(true);
  },

  onUnload() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    if (this._unsubscribe) this._unsubscribe();
  },

  onShow() {
    this.syncConnection();
    // 离开页面期间桌面端可能改过模型；返回时补一次，避免显示旧列表。
    if (this._loadedAt && Date.now() - this._loadedAt > 2000) this.refresh(false);
  },

  onUiLocaleChange() {
    if (this.data.providers.length) this.setData({ providers: this.rebuildRows() });
  },

  goBack() { wx.navigateBack(); },

  /** 弹层内容区吞掉点击，避免冒泡到遮罩关闭弹层。 */
  noop() {},

  syncConnection() {
    const connected = store.state.connection === 'connected';
    if (connected !== this.data.connected) this.setData({ connected: connected });
    return connected;
  },

  /** 网关 capabilities 决定自动发现/添加提供商是否可用（旧网关需重启加载新版）。 */
  syncModelCapability() {
    const caps = store.state.gatewayCapabilities || [];
    const supported = caps.indexOf('llm-model-config-v1') >= 0;
    if (supported !== this.data.supportsModelConfig) this.setData({ supportsModelConfig: supported });
    return supported;
  },

  /** stores 的 plugin-settings-changed 只广播 ns/revision：收到 DSH 客户端写入后重读。 */
  onStoreChange() {
    const connected = store.state.connection === 'connected';
    if (connected !== this.data.connected) this.setData({ connected: connected });
    this.syncModelCapability();
    const change = store.state.pluginSettingsChanged;
    if (!change || change === this._lastSettingsChange) return;
    this._lastSettingsChange = change;
    // 桌面端换默认模型也会影响「默认」徽标与删除保护。
    if (change.ns !== helper.PI_NS && change.ns !== 'agent-default-model') return;
    if (this.data.saving || this.data.deleting) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      this.refresh(false);
    }, 350);
  },

  labels() {
    return { context: uiText('上下文'), text: uiText('文本'), image: uiText('图片') };
  },

  rebuildRows() {
    return helper.buildProviderRows(this._providersFrame, this._piNamespace, this.data.defaultSelection, this.labels());
  },

  refresh(showLoading) {
    this.syncModelCapability();
    if (!this.syncConnection()) {
      this._loadedAt = 0;
      this.setData({ loading: false, refreshing: false, error: uiText('请先连接鲸尾 Harness') });
      return Promise.resolve();
    }
    const caps = store.state.gatewayCapabilities || [];
    if (caps.length && caps.indexOf('plugin-management-v1') < 0) {
      this._loadedAt = 0;
      this.setData({ loading: false, refreshing: false, error: uiText('当前网关不支持模型管理，请升级网关后重试。') });
      return Promise.resolve();
    }
    if (showLoading && !this.data.providers.length) this.setData({ loading: true, error: '' });
    const client = store.client;
    return Promise.all([
      client.requestProviders().catch(() => null),
      client.requestPlugin('plugin-settings', { ns: helper.PI_NS })
    ]).then(([providersFrame, response]) => {
      // requestPlugin 解析整帧：ns 视图在 frame.namespace（全部 ns 时是 frame.namespaces）。
      const namespace = (response && response.namespace) ? response.namespace : response;
      this._providersFrame = providersFrame;
      this._piNamespace = namespace;
      this._providers = (namespace && namespace.value && namespace.value.providers) || {};
      const apply = (selection) => {
        const rows = helper.buildProviderRows(providersFrame, namespace, selection, this.labels());
        const expandedId = rows.some((row) => row.id === this.data.expandedId) ? this.data.expandedId : '';
        this.setData({
          providers: rows,
          defaultSelection: selection || null,
          expandedId: expandedId,
          loading: false,
          refreshing: false,
          error: ''
        });
        this._loadedAt = Date.now();
      };
      // 每次都重读默认模型：桌面端可能刚切换过，徽标与删除保护都要跟上。
      return client.requestDefaultModel()
        .then((frame) => { apply((frame && frame.selection) || store.state.defaultModel || null); })
        .catch(() => { apply(store.state.defaultModel || null); });
    }).catch((err) => {
      this._loadedAt = 0;
      const message = (err && err.message) || '';
      const key = helper.errorKey(message);
      this.setData({
        loading: false,
        refreshing: false,
        error: uiText(key || message || '无法读取模型配置')
      });
    });
  },

  onPullRefresh() {
    if (this.data.refreshing) return;
    haptics.tick();
    this.setData({ refreshing: true });
    this.refresh(false);
  },

  toggleProvider(e) {
    const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) return;
    haptics.tick();
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  // ---------- 添加模型 ----------

  openAddModel(e) {
    const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    const provider = this.data.providers.filter((row) => row.id === id)[0];
    if (!provider) return;
    haptics.tick();
    this.setData({
      addOpen: true,
      addProviderId: id,
      addProviderName: provider.name,
      form: EMPTY_FORM(),
      formError: '',
      saving: false,
      ...this.resetAddDiscovery()
    });
  },

  closeAddModel() {
    if (this.data.saving) return;
    this.setData({ addOpen: false, form: EMPTY_FORM(), formError: '', ...this.resetAddDiscovery() });
  },

  onFormInput(e) {
    const field = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.field : '';
    if (!field) return;
    const patch = { formError: '' };
    patch['form.' + field] = (e.detail && e.detail.value) || '';
    this.setData(patch);
  },

  toggleInputType(e) {
    const kind = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.input : '';
    if (kind !== 'text' && kind !== 'image') return;
    haptics.tick();
    const patch = { formError: '' };
    patch['form.' + kind] = !this.data.form[kind];
    this.setData(patch);
  },


  // ---------- 自动获取模型（添加到已有提供商） ----------

  resetAddDiscovery(patch) {
    return Object.assign({
      discovering: false,
      discoveryError: '',
      discoveryQuery: '',
      discoveryResults: [],
      discoveryVisible: [],
      discoverySelectedCount: 0
    }, patch || {});
  },

  discoveryFailedText(err) {
    const message = (err && err.message) || '';
    const key = helper.errorKey(message);
    if (key) return uiText(key);
    if (/NO_DISCOVERY|DISCOVERY_UNSUPPORTED|no model discovery|has no model listing/i.test(message)) {
      return uiText('该提供商没有可自动读取的模型目录，请手动填写模型 ID。');
    }
    return uiText(message || '自动获取模型失败');
  },

  runAddDiscovery() {
    if (this.data.discovering) return;
    if (!this.syncModelCapability()) {
      wx.showToast({ title: uiText('当前网关暂不支持自动获取模型：请重启 DSH 加载新版网关后重试。'), icon: 'none' });
      return;
    }
    const providerId = this.data.addProviderId;
    const config = this._providers[providerId];
    if (!config) return;
    haptics.tick();
    this.setData({ discovering: true, discoveryError: '', discoveryResults: [], discoveryVisible: [], discoverySelectedCount: 0 });
    const request = { provider: providerId };
    if (config.baseURL) request.baseURL = config.baseURL;
    if (config.api) request.api = config.api;
    store.client.discoverModels(helper.PI_NS, request)
      .then((frame) => {
        const rows = helper.discoveryRows(frame && frame.models, this.labels());
        if (!rows.length) {
          this.setData({ discovering: false, discoveryError: uiText('没有获取到可用模型') });
          return;
        }
        this.setData({ discovering: false, discoveryResults: rows, discoveryVisible: rows, discoverySelectedCount: 0 });
      })
      .catch((err) => { this.setData({ discovering: false, discoveryError: this.discoveryFailedText(err) }); });
  },

  onDiscoveryQuery(e) {
    const query = (e.detail && e.detail.value) || '';
    this.setData({ discoveryQuery: query, discoveryVisible: filterDiscoveryRows(this.data.discoveryResults, query) });
  },

  toggleDiscoveryResult(e) {
    const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) return;
    haptics.tick();
    const results = markSelected(this.data.discoveryResults, id);
    this.setData({
      discoveryResults: results,
      discoveryVisible: filterDiscoveryRows(results, this.data.discoveryQuery),
      discoverySelectedCount: countSelected(results)
    });
  },

  toggleAllDiscovery() {
    const results = selectAllVisible(this.data.discoveryResults, this.data.discoveryVisible);
    this.setData({
      discoveryResults: results,
      discoveryVisible: filterDiscoveryRows(results, this.data.discoveryQuery),
      discoverySelectedCount: countSelected(results)
    });
  },

  addDiscoveredSelected() {
    if (this.data.saving) return;
    const picked = selectedCandidates(this.data.discoveryResults);
    if (!picked.length) {
      wx.showToast({ title: uiText('请先选择要添加的模型'), icon: 'none' });
      return;
    }
    const providerId = this.data.addProviderId;
    const config = this._providers[providerId];
    if (!config) return;
    const existing = Array.isArray(config.models) ? config.models : [];
    const result = helper.addDiscoveredModels(existing, picked);
    if (!result.added.length) {
      wx.showToast({ title: uiText('所选模型都已存在'), icon: 'none' });
      return;
    }
    haptics.vibrate();
    this.saveModels(providerId, result.models, uiText('模型已添加'), () => {
      this.setData({ addOpen: false, form: EMPTY_FORM(), formError: '', ...this.resetAddDiscovery() });
    });
  },

  submitAddModel() {
    if (this.data.saving) return;
    const providerId = this.data.addProviderId;
    const config = this._providers[providerId];
    if (!config) return;
    const existing = Array.isArray(config.models) ? config.models : [];
    const result = helper.validateNewModel(this.data.form, existing);
    if (result.error) {
      this.setData({ formError: uiText(FORM_ERRORS[result.error] || result.error) });
      return;
    }
    haptics.vibrate();
    this.saveModels(providerId, helper.appendModel(existing, result.model), uiText('模型已添加'), () => {
      this.setData({ addOpen: false, form: EMPTY_FORM(), formError: '' });
    });
  },

  // ---------- 删除模型 ----------

  askDeleteModel(e) {
    const dataset = (e.currentTarget && e.currentTarget.dataset) || {};
    const providerId = dataset.provider;
    const modelId = dataset.model;
    const provider = this.data.providers.filter((row) => row.id === providerId)[0];
    const model = provider ? provider.models.filter((row) => row.id === modelId)[0] : null;
    if (!provider || !model) return;
    if (helper.isDefaultModel(this.data.defaultSelection, providerId, modelId)) {
      wx.showToast({ title: uiText('这是当前默认模型，请先在「会话设置 → 默认模型」切换后再删除。'), icon: 'none' });
      return;
    }
    haptics.tick();
    this.setData({
      deleteOpen: true,
      deleting: false,
      deleteTarget: {
        providerId: providerId,
        providerName: provider.name,
        modelId: modelId,
        name: model.name,
        message: uiText('将从 {provider} 删除模型「{model}」，修改会立即同步到 DSH 客户端且无法撤销。', { provider: provider.name, model: model.name })
      }
    });
  },

  cancelDelete() {
    if (this.data.deleting) return;
    this.setData({ deleteOpen: false, deleteTarget: null });
  },

  confirmDelete() {
    if (this.data.deleting || !this.data.deleteTarget) return;
    const target = this.data.deleteTarget;
    const config = this._providers[target.providerId];
    if (!config) return;
    const existing = Array.isArray(config.models) ? config.models : [];
    haptics.vibrate();
    this.saveModels(target.providerId, helper.removeModel(existing, target.modelId), uiText('模型已删除'), () => {
      this.setData({ deleteOpen: false, deleteTarget: null });
    });
  },

  // ---------- 添加模型提供商 ----------

  existingProviderIds() {
    return Object.keys(this._providers || {});
  },

  /** 自定义路由不能复用内置目录里的 provider id（那些应走「第三方模型提供商」）。 */
  reservedProviderIds() {
    const ids = this.existingProviderIds();
    const providers = (this._providersFrame && Array.isArray(this._providersFrame.providers)) ? this._providersFrame.providers : [];
    providers.forEach((entry) => {
      if (entry && typeof entry.provider === 'string' && ids.indexOf(entry.provider) < 0) ids.push(entry.provider);
    });
    return ids;
  },

  openProviderSheet() {
    haptics.tick();
    const catalogProviders = helper.dormantCatalogProviders(this._providersFrame, this._piNamespace);
    this.setData({
      providerSheetOpen: true,
      providerMode: 'catalog',
      providerBusy: false,
      providerError: '',
      catalogProviders: catalogProviders,
      catalogQuery: '',
      catalogVisible: catalogProviders,
      providerDraft: { providerId: '', displayName: '', baseURL: '', api: 'openai-completions', apiKey: '', nativeAuthHint: '' },
      providerDiscovering: false,
      providerDiscoveryError: '',
      providerDiscoveryQuery: '',
      providerDiscoveryResults: [],
      providerDiscoveryVisible: [],
      providerSelectedCount: 0
    });
  },

  closeProviderSheet() {
    if (this.data.providerBusy) return;
    this.setData({ providerSheetOpen: false, providerError: '' });
  },

  setProviderMode(e) {
    const mode = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.mode : '';
    if (mode !== 'catalog' && mode !== 'custom') return;
    if (this.data.providerBusy || mode === this.data.providerMode) return;
    haptics.tick();
    const patch = {
      providerMode: mode,
      providerError: '',
      providerDiscovering: false,
      providerDiscoveryError: '',
      providerDiscoveryQuery: '',
      providerDiscoveryResults: [],
      providerDiscoveryVisible: [],
      providerSelectedCount: 0
    };
    if (mode === 'custom' && !patch.providerDraft) {
      const draft = this.data.providerDraft || {};
      if (!draft.api) patch['providerDraft.api'] = 'openai-completions';
    }
    this.setData(patch);
  },

  onCatalogQuery(e) {
    const query = (e.detail && e.detail.value) || '';
    this.setData({ catalogQuery: query, catalogVisible: filterDiscoveryRows(this.data.catalogProviders, query) });
  },

  selectCatalogProvider(e) {
    if (this.data.providerBusy) return;
    const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    const entry = this.data.catalogProviders.filter((row) => row.id === id)[0];
    if (!entry) return;
    haptics.tick();
    this.setData({
      'providerDraft.providerId': entry.id,
      'providerDraft.displayName': entry.name,
      'providerDraft.baseURL': entry.defaultBaseURL || '',
      'providerDraft.apiKey': '',
      'providerDraft.api': '',
      'providerDraft.nativeAuthHint': (entry.nativeAuthEnv || []).join(', '),
      catalogQuery: entry.name,
      catalogVisible: this.data.catalogProviders.slice(),
      providerError: '',
      providerDiscovering: false,
      providerDiscoveryError: '',
      providerDiscoveryQuery: '',
      providerDiscoveryResults: [],
      providerDiscoveryVisible: [],
      providerSelectedCount: 0
    });
  },

  onProviderDraftInput(e) {
    const field = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.field : '';
    if (!field) return;
    const patch = { providerError: '' };
    patch['providerDraft.' + field] = (e.detail && e.detail.value) || '';
    this.setData(patch);
  },

  pickProviderProtocol(e) {
    const api = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.api : '';
    if (!helper.PROTOCOLS.some((entry) => entry.id === api)) return;
    haptics.tick();
    this.setData({ 'providerDraft.api': api, providerError: '' });
  },

  providerDiscoveryRequest() {
    const mode = this.data.providerMode;
    const draft = this.data.providerDraft;
    if (mode === 'catalog') {
      if (!draft.providerId) return { error: 'catalog-empty' };
      const request = { provider: draft.providerId };
      if (draft.baseURL) request.baseURL = draft.baseURL;
      return { request: request };
    }
    const validation = helper.validateProviderDraft('custom', draft, { existingIds: this.reservedProviderIds() });
    if (validation.error) return { error: validation.error };
    const request = { provider: validation.value.providerId, baseURL: validation.value.baseURL, api: validation.value.api };
    const apiKey = String(draft.apiKey || '').trim();
    if (apiKey) request.apiKey = apiKey;
    return { request: request };
  },

  runProviderDiscovery() {
    if (this.data.providerDiscovering) return;
    if (!this.syncModelCapability()) {
      this.setData({ providerError: uiText('当前网关暂不支持添加模型提供商：请重启 DSH 加载新版网关后重试。') });
      return;
    }
    const probe = this.providerDiscoveryRequest();
    if (probe.error) {
      this.setData({ providerError: uiText(PROVIDER_ERRORS[probe.error] || probe.error) });
      return;
    }
    haptics.tick();
    this.setData({
      providerDiscovering: true,
      providerError: '',
      providerDiscoveryError: '',
      providerDiscoveryResults: [],
      providerDiscoveryVisible: [],
      providerSelectedCount: 0
    });
    store.client.discoverModels(helper.PI_NS, probe.request)
      .then((frame) => {
        const rows = helper.discoveryRows(frame && frame.models, this.labels());
        if (!rows.length) {
          this.setData({ providerDiscovering: false, providerDiscoveryError: uiText('没有获取到可用模型') });
          return;
        }
        this.setData({ providerDiscovering: false, providerDiscoveryResults: rows, providerDiscoveryVisible: rows, providerSelectedCount: 0 });
      })
      .catch((err) => { this.setData({ providerDiscovering: false, providerDiscoveryError: this.discoveryFailedText(err) }); });
  },

  onProviderDiscoveryQuery(e) {
    const query = (e.detail && e.detail.value) || '';
    this.setData({ providerDiscoveryQuery: query, providerDiscoveryVisible: filterDiscoveryRows(this.data.providerDiscoveryResults, query) });
  },

  toggleProviderDiscovery(e) {
    const id = (e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.id : '';
    if (!id) return;
    haptics.tick();
    const results = markSelected(this.data.providerDiscoveryResults, id);
    this.setData({
      providerDiscoveryResults: results,
      providerDiscoveryVisible: filterDiscoveryRows(results, this.data.providerDiscoveryQuery),
      providerSelectedCount: countSelected(results)
    });
  },

  toggleProviderDiscoveryAll() {
    const results = selectAllVisible(this.data.providerDiscoveryResults, this.data.providerDiscoveryVisible);
    this.setData({
      providerDiscoveryResults: results,
      providerDiscoveryVisible: filterDiscoveryRows(results, this.data.providerDiscoveryQuery),
      providerSelectedCount: countSelected(results)
    });
  },

  createProvider() {
    if (this.data.providerBusy) return;
    if (!this.syncModelCapability()) {
      this.setData({ providerError: uiText('当前网关暂不支持添加模型提供商：请重启 DSH 加载新版网关后重试。') });
      return;
    }
    const mode = this.data.providerMode;
    const draft = this.data.providerDraft;
    const validation = helper.validateProviderDraft(mode, draft, {
      existingIds: this.reservedProviderIds(),
      catalogProviders: this.data.catalogProviders
    });
    if (validation.error) {
      this.setData({ providerError: uiText(PROVIDER_ERRORS[validation.error] || validation.error) });
      return;
    }
    const picked = selectedCandidates(this.data.providerDiscoveryResults);
    const added = helper.addDiscoveredModels([], picked);
    if (!added.models.length) {
      this.setData({ providerError: uiText(PROVIDER_ERRORS['models-empty']) });
      return;
    }
    const namespace = this._piNamespace;
    if (!namespace || !Number.isSafeInteger(namespace.revision)) {
      this.setData({ providerError: uiText('当前网关未提供模型配置，请升级网关后重试。') });
      return;
    }
    const config = helper.buildProviderConfig({
      displayName: validation.value.displayName,
      api: validation.value.api,
      baseURL: validation.value.baseURL,
      apiKeyEnv: validation.value.apiKeyEnv,
      models: added.models
    });
    const apiKey = String(draft.apiKey == null ? '' : draft.apiKey).trim();
    haptics.vibrate();
    this.setData({ providerBusy: true, providerError: '' });
    store.client.requestPlugin('plugin-settings-mutate', helper.providerCreateMutation(validation.value.providerId, config, namespace.revision))
      .then(() => {
        if (!apiKey) return null;
        return store.client.setModelCredential(validation.value.apiKeyEnv, apiKey)
          .then(() => null)
          .catch((err) => (err && err.message) || 'unknown');
      })
      .then((credentialError) => {
        this.setData({ providerBusy: false });
        if (credentialError) {
          this.setData({ providerError: uiText('提供商已添加，但 API Key 写入失败：') + uiText(credentialError) });
          this.refresh(false);
          return;
        }
        this.setData({ providerSheetOpen: false });
        wx.showToast({ title: uiText('模型提供商已添加'), icon: 'success' });
        store.client.requestModels(null).catch(() => {});
        this.refresh(false).then(() => {
          this.setData({ expandedId: validation.value.providerId });
        });
      })
      .catch((err) => {
        const message = (err && err.message) || '';
        const key = helper.errorKey(message);
        this.setData({ providerBusy: false, providerError: uiText(key || message || '保存失败，请重试') });
        this.refresh(false);
      });
  },

  // ---------- 写入 settings ----------

  saveModels(providerId, models, successText, onSuccess) {
    const namespace = this._piNamespace;
    if (!namespace || !Number.isSafeInteger(namespace.revision)) {
      wx.showToast({ title: uiText('当前网关未提供模型配置，请升级网关后重试。'), icon: 'none' });
      return;
    }
    const isDelete = this.data.deleteOpen === true;
    this.setData({ saving: true, deleting: isDelete });
    store.client.requestPlugin('plugin-settings-mutate', helper.modelsMutation(providerId, models, namespace.revision))
      .then(() => {
        wx.showToast({ title: successText, icon: 'success' });
        if (onSuccess) onSuccess();
        this.setData({ saving: false, deleting: false });
        // 刷新全局模型目录，让会话页 / 默认模型选择器立即看到新模型。
        store.client.requestModels(null).catch(() => {});
        return this.refresh(false);
      })
      .catch((err) => {
        const message = (err && err.message) || '';
        const key = helper.errorKey(message);
        const text = uiText(key || message || '保存失败，请重试');
        if (this.data.addOpen) this.setData({ formError: text });
        wx.showToast({ title: text, icon: 'none' });
        this.setData({ saving: false, deleting: false });
        return this.refresh(false);
      });
  }
});
