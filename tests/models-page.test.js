const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const helper = require('../miniprogram/utils/model-settings');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');

const LABELS = { context: '上下文', text: '文本', image: '图片' };

test('builds provider rows from providers frame and llm-pi-ai settings', () => {
  const providersFrame = {
    providers: [
      { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
      { provider: 'opencode-go', displayName: 'opencode-go', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'], declared: false, defaultBaseURL: 'https://opencode.example/v1' },
      { provider: 'mimo', displayName: '小米', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'mimo'], declared: true }
    ]
  };
  const namespace = {
    revision: 4,
    value: {
      providers: {
        mimo: { displayName: '小米', api: 'openai-completions', baseURL: 'https://x/v1', models: [{ id: 'm1', name: 'M1', contextWindow: 1000000, input: ['text', 'image'] }] },
        'opencode-go': { api: 'anthropic-messages', models: [{ id: 'o1' }] }
      }
    }
  };
  const rows = helper.buildProviderRows(providersFrame, namespace, { provider: 'mimo', model: 'm1' }, LABELS);
  assert.deepEqual(rows.map(row => row.id), ['opencode-go', 'mimo']);
  assert.equal(rows[0].custom, false);
  assert.equal(rows[0].apiLabel, 'Anthropic Messages');
  assert.equal(rows[0].baseURL, 'https://opencode.example/v1');
  assert.equal(rows[1].custom, true);
  assert.equal(rows[1].name, '小米');
  assert.equal(rows[1].count, 1);
  assert.equal(rows[1].models[0].meta, '上下文 1M · 文本/图片');
  assert.equal(rows[1].models[0].isDefault, true);
});

test('falls back to settings providers when the gateway has no providers frame', () => {
  const namespace = { revision: 1, value: { providers: { local: { displayName: 'Local', api: 'openai-completions', models: [] } } } };
  const rows = helper.buildProviderRows(null, namespace, null, LABELS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'local');
  assert.equal(rows[0].custom, true);
  assert.equal(rows[0].status, 'empty');
});

test('token formatting and protocol labels follow the DSH model page', () => {
  assert.equal(helper.formatTokenCount(1048576), '1M');
  assert.equal(helper.formatTokenCount(1050000), '1.1M');
  assert.equal(helper.formatTokenCount(131072), '131K');
  assert.equal(helper.formatTokenCount(0), '');
  assert.equal(helper.protocolLabel('openai-responses'), 'OpenAI Responses');
  assert.equal(helper.protocolLabel('custom-proto'), 'custom-proto');
});

test('new model validation matches the DSH editor rules', () => {
  assert.deepEqual(helper.validateNewModel({ id: 'm1', text: true }, []), { model: { id: 'm1', input: ['text'], reasoningEfforts: false } });
  assert.deepEqual(helper.validateNewModel({ id: 'm2', name: ' Mega ', contextWindow: '1000', maxTokens: '512', text: true, image: true }, [{ id: 'm1' }]),
    { model: { id: 'm2', contextWindow: 1000, maxTokens: 512, name: 'Mega', input: ['text', 'image'], reasoningEfforts: false } });
  assert.deepEqual(helper.validateNewModel({ id: 'r1', text: true, reasoning: true, levels: { low: true, high: true } }, []),
    { model: { id: 'r1', input: ['text'], reasoningEfforts: { off: null, low: 'low', high: 'high' } } });
  assert.equal(helper.validateNewModel({ id: 'r2', text: true, reasoning: true, levels: {} }, []).error, 'reasoning-levels-empty');
  assert.equal(helper.validateNewModel({ id: '', text: true }, []).error, 'id-empty');
  assert.equal(helper.validateNewModel({ id: 'm1', text: true }, [{ id: 'm1' }]).error, 'id-duplicate');
  assert.equal(helper.validateNewModel({ id: 'm2', contextWindow: '-1', text: true }, []).error, 'context-invalid');
  assert.equal(helper.validateNewModel({ id: 'm2', maxTokens: '1.5', text: true }, []).error, 'max-invalid');
  assert.equal(helper.validateNewModel({ id: 'm2' }, []).error, 'input-empty');
});

test('mutation keeps the full models array and the namespace revision', () => {
  const payload = helper.modelsMutation('mimo', [{ id: 'a' }, { id: 'b' }], 7);
  assert.equal(payload.ns, 'llm-pi-ai');
  assert.equal(payload.expectedRevision, 7);
  assert.deepEqual(payload.ops, [{ op: 'set', path: ['providers', 'mimo', 'models'], value: [{ id: 'a' }, { id: 'b' }] }]);
  assert.deepEqual(helper.removeModel([{ id: 'a' }, { id: 'b' }], 'a'), [{ id: 'b' }]);
});

test('provider helpers derive credential refs and validate drafts', () => {
  assert.equal(helper.credentialRefFor('opencode-go'), 'OPENCODE_GO_API_KEY');
  assert.equal(helper.credentialRefFor('my-relay'), 'MY_RELAY_API_KEY');
  assert.equal(helper.isValidBaseURL('https://relay.example/v1'), true);
  assert.equal(helper.isValidBaseURL('http://127.0.0.1:8080'), true);
  assert.equal(helper.isValidBaseURL('relay.example'), false);
  assert.equal(helper.isValidBaseURL('ftp://relay.example'), false);
  assert.deepEqual(helper.validateProviderDraft('custom', { providerId: 'my relay', baseURL: 'https://x/v1', api: 'openai-completions' }, { existingIds: [] }), { error: 'provider-id-invalid' });
  assert.deepEqual(helper.validateProviderDraft('custom', { providerId: 'mimo', baseURL: 'https://x/v1', api: 'openai-completions' }, { existingIds: ['mimo'] }), { error: 'provider-id-duplicate' });
  assert.equal(helper.validateProviderDraft('custom', { providerId: 'My-Relay', baseURL: 'https://x/v1', api: 'openai-completions' }, { existingIds: [] }).error, 'provider-id-invalid');
  assert.equal(helper.validateProviderDraft('custom', { providerId: '1relay', baseURL: 'https://x/v1', api: 'openai-completions' }, { existingIds: [] }).error, 'provider-id-invalid');
  assert.deepEqual(helper.buildProviderConfig({ displayName: 'Relay', baseURL: 'https://x/v1', api: 'openai-completions', models: [{ id: 'm' }] }), {
    displayName: 'Relay', baseURL: 'https://x/v1', api: 'openai-completions', models: [{ id: 'm' }]
  });
  assert.equal(helper.validateProviderDraft('custom', { providerId: 'relay', baseURL: 'nope', api: 'openai-completions' }, { existingIds: [] }).error, 'base-url-invalid');
  assert.equal(helper.validateProviderDraft('custom', { providerId: 'relay', baseURL: 'https://x', api: 'bogus' }, { existingIds: [] }).error, 'api-invalid');
});

test('discovered models keep DSH fields and skip duplicates', () => {
  const result = helper.addDiscoveredModels([{ id: 'a' }], [
    { id: 'a' },
    { id: 'b', name: 'B', contextWindow: 1000, maxTokens: 100, inputModalities: ['text', 'image', 'audio'] }
  ]);
  assert.equal(result.added.length, 1);
  assert.deepEqual(result.models[1], { id: 'b', name: 'B', contextWindow: 1000, maxTokens: 100, input: ['text', 'image'] });
  assert.equal(result.models[0].id, 'a');
  const rows = helper.discoveryRows([{ id: 'b', name: 'B', inputModalities: ['text'] }], LABELS);
  assert.equal(rows[0].meta, '文本');
  assert.equal(rows[0].existing, false);
  const configured = helper.discoveryRows([{ id: 'm1' }, { id: 'd1' }], LABELS, [{ id: 'm1' }]);
  assert.equal(configured[0].existing, true);
  assert.equal(configured[1].existing, false);
  assert.equal(helper.modelMeta({ contextWindow: 1000, input: ['text'], reasoningEfforts: { low: 'low', high: 'high' } },
    { context: '上下文', text: '文本', reasoning: '推理', levelLabels: { low: '低', high: '高' } }), '上下文 1K · 文本 · 推理 低/高');
});

test('dormant catalog providers exclude already configured routes', () => {
  const providersFrame = { providers: [
    { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], declared: false },
    { provider: 'mimo', displayName: '小米', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'mimo'], declared: true }
  ] };
  const rows = helper.dormantCatalogProviders(providersFrame, { value: { providers: { mimo: {} } } });
  assert.deepEqual(rows.map(row => row.id), ['anthropic']);
});

test('gateway errors map to readable picker states', () => {
  assert.equal(helper.errorKey('settings/conflict: revision mismatch'), '设置已在其他位置更新，已刷新，请重试');
  assert.equal(helper.errorKey('unknown message type: plugin-settings'), '当前网关不支持模型管理，请升级网关后重试。');
  assert.equal(helper.errorKey('settings namespace is unavailable: llm-pi-ai'), '当前网关未提供模型配置，请升级网关后重试。');
  assert.equal(helper.errorKey('boom'), '');
});

test('page markup and routing are wired into the mini program', () => {
  const wxml = read('pages/models/models.wxml');
  assert.ok(wxml.includes('class="provider-row"'));
  assert.ok(wxml.includes("{{ui['自定义']}}"));
  assert.ok(wxml.includes("bindtap=\"openAddModel\""));
  assert.ok(wxml.includes("catchtap=\"askDeleteModel\""));
  assert.ok(wxml.includes('class="models-sheet"'));
  assert.ok(wxml.includes("{{ui['模型 ID']}}"));
  const json = JSON.parse(read('app.json'));
  const pkg = json.subPackages.find(entry => entry.name === 'models');
  assert.ok(pkg, 'models subpackage');
  assert.deepEqual(pkg.pages, ['models']);
  const settings = read('pages/session-settings/session-settings.wxml');
  assert.ok(settings.includes('bindtap="openModels"'));
  assert.ok(wxml.includes('bindtap="openProviderSheet"'));
  assert.ok(wxml.includes("{{ui['添加模型提供商']}}"));
  assert.ok(wxml.includes("{{ui['自动获取模型']}}"));
  assert.ok(wxml.includes('bindtap="runAddDiscovery"'));
  assert.ok(wxml.includes('bindtap="runProviderDiscovery"'));
  assert.ok(wxml.includes('bindtap="createProvider"'));
  assert.ok(wxml.includes('models-restart-notice'));
  assert.ok(wxml.includes('catchtap="askDeleteProvider"'));
  assert.ok(wxml.includes("{{item.existing ? 'existing' : ''}}"));
  assert.ok(wxml.includes("{{ui['已添加']}}"));
  assert.ok(wxml.includes("{{ui['所有可用模型都已添加']}}"));
  assert.ok(wxml.includes('bindtap="openDiscoverySheet"'));
  assert.ok(wxml.includes("{{ui['获取模型']}}"));
  assert.ok(wxml.includes('bindtap="openEditModel"'));
  assert.ok(wxml.includes("{{ui['编辑模型']}}"));
  assert.ok(wxml.includes('bindtap="saveEditModel"'));
  assert.ok(wxml.includes("{{ui['支持推理']}}"));
  assert.ok(wxml.includes("{{ui['档位']}}"));
  assert.ok(wxml.includes('bindtap="openReasoningLevelPicker"'));
  assert.ok(wxml.includes('bindtap="selectReasoningLevel"'));
  assert.ok(wxml.includes('class="reasoning-row"'));
  assert.ok(wxml.includes('reasoning-picker-sheet'));
  const wxss = read('pages/models/models.wxss');
  assert.match(wxss, /\.discovery-row\.existing/);
  assert.match(wxss, /\.models-sheet-body \{[^}]*box-sizing: border-box/);
  const gateway = read('utils/gateway.js');
  assert.ok(gateway.includes("requestProviders() { return this.request({ type: 'providers' }); }"));
  assert.ok(gateway.includes("requestPlugin('llm-discover-models'"));
  assert.ok(gateway.includes("requestPlugin('model-credential-set'"));
  const store = read('utils/store.js');
  assert.ok(store.includes("frame.kind === 'plugin-settings-changed'"));
});

const DEFAULT_SELECTION = { provider: 'mimo', model: 'm1' };

function createPage(options = {}) {
  const capabilities = options.capabilities || ['plugin-management-v1'];
  const discoveryModels = options.discoveryModels || [{ id: 'd1', name: 'D1', contextWindow: 1000, inputModalities: ['text', 'image'] }];
  let definition;
  const listeners = [];
  const toasts = [];
  const mutations = [];
  const discoveries = [];
  const credentials = [];
  const namespace = {
    revision: 5,
    value: {
      providers: {
        mimo: {
          displayName: '小米',
          api: 'openai-completions',
          baseURL: 'https://token.example/v1',
          models: [{ id: 'm1', name: 'M1', contextWindow: 1000000, input: ['text'] }]
        },
        'opencode-go': { api: 'anthropic-messages', models: [] }
      }
    }
  };
  const providersFrame = {
    providers: [
      { provider: 'opencode-go', displayName: 'opencode-go', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-go'], declared: false },
      { provider: 'mimo', displayName: '小米', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'mimo'], declared: true },
      { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], declared: false, defaultBaseURL: 'https://api.anthropic.com', nativeAuth: { env: ['ANTHROPIC_API_KEY'], oauth: true } }
    ]
  };
  const applyOps = (ops) => {
    for (const op of ops) {
      let node = namespace.value;
      for (let index = 0; index < op.path.length - 1; index++) {
        const part = op.path[index];
        node = Array.isArray(node) ? node[Number(part)] : node[part];
      }
      const last = op.path[op.path.length - 1];
      if (op.op === 'unset') {
        if (Array.isArray(node)) node.splice(Number(last), 1);
        else delete node[last];
      } else if (Array.isArray(node)) {
        node[Number(last)] = op.value;
      } else {
        node[last] = op.value;
      }
    }
  };
  const store = {
    state: {
      connection: 'connected',
      gatewayCapabilities: capabilities,
      defaultModel: Object.assign({}, DEFAULT_SELECTION),
      pluginSettingsChanged: null
    },
    client: {
      requestProviders() { return Promise.resolve(providersFrame); },
      requestPlugin(type, payload) {
        if (type === 'plugin-settings') return Promise.resolve({ kind: 'plugin-settings', writable: true, namespace: namespace });
        if (type === 'plugin-settings-mutate') {
          mutations.push(JSON.parse(JSON.stringify(payload)));
          applyOps(payload.ops);
          namespace.revision += 1;
          return Promise.resolve({ kind: 'plugin-settings-mutate' });
        }
        return Promise.resolve({});
      },
      requestModels() { return Promise.resolve({ kind: 'models' }); },
      requestDefaultModel() { return Promise.resolve({ kind: 'default-model', selection: DEFAULT_SELECTION }); },
      discoverModels(ns, request) {
        discoveries.push({ ns: ns, request: JSON.parse(JSON.stringify(request || {})) });
        return Promise.resolve({ kind: 'llm-discover-models', models: discoveryModels });
      },
      setModelCredential(ref, value) {
        credentials.push({ ref: ref, value: value });
        return Promise.resolve({ kind: 'model-credential-set', saved: true });
      }
    },
    subscribe(listener) { listeners.push(listener); return () => {}; }
  };
  const wx = {
    getWindowInfo: () => ({ statusBarHeight: 47 }),
    getSystemInfoSync: () => ({ statusBarHeight: 47 }),
    navigateBack() {},
    showToast(options) { toasts.push(options); }
  };
  const requireStub = (name) => {
    if (name.endsWith('store')) return store;
    if (name.endsWith('theme')) return { applyTo() {}, resolveTheme: () => 'dark' };
    if (name.endsWith('haptics')) return { tick() {}, vibrate() {} };
    if (name.endsWith('ui-preferences')) return { t: text => text };
    if (name.endsWith('model-settings')) return helper;
    if (name.endsWith('settings-glass-pref')) return { read: () => true };
    if (name.endsWith('settings-glass-sheet-pref')) return { read: () => true };
    if (name.endsWith('settings-glass-style-pref')) return { view: () => ({ glassAlphaTop: '0.04', glassAlphaBottom: '0.016', glassEdgeAlpha: '0.38', glassBlurSheet: '4px', glassBlurCard: '2px', glassRadiusSheet: '16px', glassRadiusCard: '18px', glassRadiusChoice: '32px', glassBackdropBrightness: '1.00' }) };
    return {};
  };
  vm.runInNewContext(read('pages/models/models.js'), {
    Page: value => { definition = value; }, wx, console, require: requireStub,
    setTimeout, clearTimeout
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      Object.keys(patch).forEach((key) => {
        const parts = key.split('.');
        let node = this.data;
        for (let index = 0; index < parts.length - 1; index++) {
          const part = parts[index];
          if (node[part] === null || typeof node[part] !== 'object') node[part] = {};
          node = node[part];
        }
        node[parts[parts.length - 1]] = patch[key];
      });
    }
  };
  return { page, store, listeners, toasts, mutations, discoveries, credentials, namespace };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let index = 0; index < 12; index++) await tick(); };

test('page loads providers, adds a model and deletes it through settings mutations', async () => {
  const { page, mutations, namespace } = createPage();
  page.onLoad();
  await settle();
  assert.equal(page.data.connected, true);
  assert.deepEqual(page.data.providers.map(row => row.id), ['opencode-go', 'mimo']);
  assert.equal(page.data.providers[1].models[0].isDefault, true);

  page.setData({ 'form.id': 'm2', 'form.name': 'M2', 'form.contextWindow': '2048', 'form.text': true, 'form.image': false });
  page.setData({ addOpen: true, addProviderId: 'mimo', addProviderName: '小米' });
  page.submitAddModel();
  await settle();
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].ops[0].path, ['providers', 'mimo', 'models', '1']);
  assert.equal(mutations[0].ops[0].value.id, 'm2');
  assert.equal(namespace.value.providers.mimo.models.length, 2);
  assert.ok(namespace.value.providers.mimo.models.some(model => model.id === 'm2'));
  assert.equal(page.data.addOpen, false);
  assert.ok(page.data.providers.find(row => row.id === 'mimo').models.some(model => model.id === 'm2'));

  page.askDeleteModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm2' } } });
  assert.equal(page.data.deleteOpen, true);
  page.confirmDelete();
  await settle();
  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations[1].ops, [{ op: 'unset', path: ['providers', 'mimo', 'models', '1'] }]);
  assert.equal(namespace.value.providers.mimo.models.length, 1);
  assert.equal(page.data.deleteOpen, false);
});

test('default model is protected from deletion', async () => {
  const { page, mutations, toasts } = createPage();
  page.onLoad();
  await settle();
  page.askDeleteModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm1' } } });
  assert.equal(page.data.deleteOpen, false);
  assert.equal(mutations.length, 0);
  assert.ok(toasts.some(item => String(item.title).includes('默认模型')));
});

test('plugin-settings-changed from the desktop triggers a reload', async () => {
  const { page, store, listeners } = createPage();
  page.onLoad();
  await settle();
  const before = page.data.providers.length;
  store.state.pluginSettingsChanged = { ns: 'llm-pi-ai', revision: 9, at: Date.now() };
  listeners.forEach(listener => listener());
  await new Promise(resolve => setTimeout(resolve, 450));
  await settle();
  assert.equal(page.data.providers.length, before);
  assert.equal(page.data.error, '');
});

test('model discovery adds selected models in one mutation', async () => {
  const { page, mutations, discoveries } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  assert.equal(page.data.supportsModelConfig, true);
  page.setData({ discoveryOpen: true, discoveryProviderId: 'mimo', discoveryProviderName: '小米' });
  page.runAddDiscovery();
  await settle();
  assert.equal(discoveries.length, 1);
  assert.equal(discoveries[0].ns, 'llm-pi-ai');
  assert.equal(discoveries[0].request.provider, 'mimo');
  assert.equal(page.data.discoveryResults.length, 1);
  page.toggleDiscoveryResult({ currentTarget: { dataset: { id: 'd1' } } });
  assert.equal(page.data.discoverySelectedCount, 1);
  page.addDiscoveredSelected();
  await settle();
  assert.equal(mutations.length, 1);
  assert.ok(mutations[0].ops.some((op) => op.op === 'set' && op.value && op.value.id === 'd1'));
  assert.equal(page.data.discoveryOpen, false);
});

test('catalog provider mode writes provider config and API key', async () => {
  const { page, mutations, credentials } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openProviderSheet();
  assert.ok(page.data.catalogProviders.some((entry) => entry.id === 'anthropic'));
  page.selectCatalogProvider({ currentTarget: { dataset: { id: 'anthropic' } } });
  assert.equal(page.data.providerDraft.providerId, 'anthropic');
  page.setData({ 'providerDraft.apiKey': 'sk-test' });
  page.runProviderDiscovery();
  await settle();
  page.toggleProviderDiscovery({ currentTarget: { dataset: { id: 'd1' } } });
  page.createProvider();
  await settle();
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].ops[0].path, ['providers', 'anthropic']);
  const config = mutations[0].ops[0].value;
  assert.equal(config.apiKeyEnv, 'ANTHROPIC_API_KEY');
  assert.equal(config.api, undefined);
  assert.ok(config.models.some((model) => model.id === 'd1'));
  assert.deepEqual(credentials[0], { ref: 'ANTHROPIC_API_KEY', value: 'sk-test' });
  assert.equal(page.data.providerSheetOpen, false);
});

test('custom provider mode validates fields and writes protocol/endpoint', async () => {
  const { page, mutations, credentials } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openProviderSheet();
  page.setProviderMode({ currentTarget: { dataset: { mode: 'custom' } } });
  page.setData({ 'providerDraft.providerId': 'my relay' });
  page.runProviderDiscovery();
  assert.ok(String(page.data.providerError).includes('Provider ID'));
  page.setData({ 'providerDraft.providerId': 'my-relay', 'providerDraft.baseURL': 'not-a-url' });
  page.runProviderDiscovery();
  assert.ok(String(page.data.providerError).includes('http'));
  page.setData({
    'providerDraft.baseURL': 'https://relay.example/v1',
    'providerDraft.api': 'openai-responses',
    'providerDraft.apiKey': 'sk-relay'
  });
  page.runProviderDiscovery();
  await settle();
  page.toggleProviderDiscovery({ currentTarget: { dataset: { id: 'd1' } } });
  page.createProvider();
  await settle();
  assert.equal(mutations.length, 1);
  const config = mutations[0].ops[0].value;
  assert.equal(mutations[0].ops[0].path[1], 'my-relay');
  assert.equal(config.api, 'openai-responses');
  assert.equal(config.baseURL, 'https://relay.example/v1');
  assert.equal(config.apiKeyEnv, 'MY_RELAY_API_KEY');
  assert.deepEqual(credentials[0], { ref: 'MY_RELAY_API_KEY', value: 'sk-relay' });
});

test('discovery and provider creation are gated by gateway capability', async () => {
  const { page, discoveries, toasts, mutations } = createPage();
  page.onLoad();
  await settle();
  assert.equal(page.data.supportsModelConfig, false);
  page.setData({ addOpen: true, addProviderId: 'mimo', addProviderName: '小米' });
  page.runAddDiscovery();
  assert.equal(discoveries.length, 0);
  assert.ok(toasts.some((item) => String(item.title).includes('重启 DSH')));
  page.openProviderSheet();
  page.selectCatalogProvider({ currentTarget: { dataset: { id: 'anthropic' } } });
  page.createProvider();
  assert.equal(mutations.length, 0);
  assert.ok(String(page.data.providerError).includes('重启 DSH'));
});


test('opening the discovery sheet auto-fetches models when the gateway supports it', async () => {
  const { page, discoveries } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openDiscoverySheet({ currentTarget: { dataset: { id: 'mimo' } } });
  await new Promise((resolve) => setTimeout(resolve, 140));
  await settle();
  assert.ok(discoveries.length >= 1);
  assert.equal(discoveries[0].request.provider, 'mimo');
  assert.equal(page.data.discoveryResults.length, 1);
  assert.equal(page.data.discoveryOpen, true);
});


test('provider creation without an API key omits apiKeyEnv for native auth', async () => {
  const { page, mutations, credentials } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openProviderSheet();
  page.selectCatalogProvider({ currentTarget: { dataset: { id: 'anthropic' } } });
  page.runProviderDiscovery();
  await settle();
  page.toggleProviderDiscovery({ currentTarget: { dataset: { id: 'd1' } } });
  page.createProvider();
  await settle();
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].ops[0].value.apiKeyEnv, undefined);
  assert.equal(credentials.length, 0);
});


test('discovered models already configured are greyed out and unselectable', async () => {
  const { page, mutations } = createPage({
    capabilities: ['plugin-management-v1', 'llm-model-config-v1'],
    discoveryModels: [{ id: 'm1', name: 'Existing' }, { id: 'd1', name: 'New' }]
  });
  page.onLoad();
  await settle();
  page.setData({ discoveryOpen: true, discoveryProviderId: 'mimo', discoveryProviderName: '小米' });
  page.runAddDiscovery();
  await settle();
  assert.equal(page.data.discoveryResults[0].existing, true);
  assert.equal(page.data.discoveryResults[1].existing, false);
  assert.equal(page.data.discoveryAllExisting, false);
  page.toggleDiscoveryResult({ currentTarget: { dataset: { id: 'm1' } } });
  assert.equal(page.data.discoverySelectedCount, 0, 'configured model must not be selectable');
  page.toggleAllDiscovery();
  assert.equal(page.data.discoveryResults[0].selected, false);
  assert.equal(page.data.discoveryResults[1].selected, true);
  assert.equal(page.data.discoverySelectedCount, 1);
  page.addDiscoveredSelected();
  await settle();
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].ops.map((op) => op.path.join('.')), ['providers.mimo.models.1']);
  assert.equal(mutations[0].ops[0].value.id, 'd1');
});

test('model writes use fresh settings so concurrent DSH-client models are not clobbered', async () => {
  const { page, mutations, namespace } = createPage();
  page.onLoad();
  await settle();
  // Simulate the DSH client adding m2 after this page loaded.
  namespace.value.providers.mimo.models.push({ id: 'm2', name: 'M2', contextWindow: 8000, input: ['text'] });
  namespace.revision += 1;
  page.setData({ 'form.id': 'm3', 'form.name': 'M3', 'form.text': true, 'form.image': false });
  page.setData({ addOpen: true, addProviderId: 'mimo', addProviderName: '小米' });
  page.submitAddModel();
  await settle();
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].ops.map((op) => op.path.join('.')), ['providers.mimo.models.2']);
  assert.deepEqual(namespace.value.providers.mimo.models.map((model) => model.id), ['m1', 'm2', 'm3']);
});

test('discovery shows all-existing hint when nothing new is available', async () => {
  const { page } = createPage({
    capabilities: ['plugin-management-v1', 'llm-model-config-v1'],
    discoveryModels: [{ id: 'm1', name: 'Existing' }]
  });
  page.onLoad();
  await settle();
  page.setData({ discoveryOpen: true, discoveryProviderId: 'mimo', discoveryProviderName: '小米' });
  page.runAddDiscovery();
  await settle();
  assert.equal(page.data.discoveryAllExisting, true);
  page.toggleAllDiscovery();
  assert.equal(page.data.discoverySelectedCount, 0);
});

test('model edit helper preserves capacity, image input and reasoning mapping', () => {
  const original = { id: 'm1', name: 'M1', contextWindow: 1000, input: ['text'], reasoningEfforts: { low: 'low', high: 'high' } };
  const hidden = helper.applyModelEdit(original, { contextWindow: '2000', maxTokens: '4096', image: true, reasoning: false }, original.reasoningEfforts);
  assert.equal(hidden.model.contextWindow, 2000);
  assert.equal(hidden.model.maxTokens, 4096);
  assert.deepEqual(hidden.model.input, ['text', 'image']);
  assert.equal(hidden.model.reasoningEfforts, false);
  const restored = helper.applyModelEdit(hidden.model, { contextWindow: '2000', maxTokens: '4096', image: true, reasoning: true }, original.reasoningEfforts);
  assert.deepEqual(restored.model.reasoningEfforts, { low: 'low', high: 'high' });
  assert.equal(helper.applyModelEdit(original, { contextWindow: '0', maxTokens: '', image: false, reasoning: true }).error, 'context-invalid');
  assert.equal(helper.applyModelEdit(original, { contextWindow: '', maxTokens: '-1', image: false, reasoning: true }).error, 'max-invalid');
  assert.deepEqual(helper.replaceModel([{ id: 'a' }, { id: 'b' }], 'b', { id: 'b', name: 'B' }).map((model) => model.name), [undefined, 'B']);
});

test('clicking a model row opens the editor and saves context/image/reasoning', async () => {
  const { page, mutations } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openEditModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm1' } } });
  assert.equal(page.data.editModelOpen, true);
  assert.equal(page.data.editForm.contextWindow, '1000000');
  assert.equal(page.data.editForm.image, false);
  assert.equal(page.data.editForm.reasoning, true);
  page.setData({ 'editForm.contextWindow': '200000', 'editForm.maxTokens': '4096' });
  page.toggleEditImage();
  page.toggleEditReasoning();
  page.saveEditModel();
  await settle();
  assert.equal(mutations.length, 1);
  const fields = {};
  mutations[0].ops.forEach((op) => { fields[op.path[op.path.length - 1]] = op; });
  assert.equal(fields.contextWindow.op, 'set');
  assert.equal(fields.contextWindow.value, 200000);
  assert.equal(fields.maxTokens.value, 4096);
  assert.deepEqual(fields.input.value, ['text', 'image']);
  assert.equal(fields.reasoningEfforts.value, false);
  assert.equal(page.data.editModelOpen, false);
});

test('model editor rejects an invalid context window', async () => {
  const { page, mutations } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openEditModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm1' } } });
  page.setData({ 'editForm.contextWindow': '0' });
  page.saveEditModel();
  await settle();
  assert.equal(mutations.length, 0);
  assert.ok(String(page.data.editError).includes('上下文'));
});


test('discovery uses fresh settings so newly added DSH-client models are marked existing', async () => {
  const { page, namespace } = createPage({
    capabilities: ['plugin-management-v1', 'llm-model-config-v1'],
    discoveryModels: [{ id: 'm1', name: 'M1' }, { id: 'd1', name: 'D1' }, { id: 'm2', name: 'M2' }]
  });
  page.onLoad();
  await settle();
  // DSH client adds m2 after this page loaded; the page cache still only has m1.
  namespace.value.providers.mimo.models.push({ id: 'm2', name: 'M2', contextWindow: 8000, input: ['text'] });
  namespace.revision += 1;
  page.setData({ discoveryOpen: true, discoveryProviderId: 'mimo', discoveryProviderName: '小米' });
  page.runAddDiscovery();
  await settle();
  const byId = {};
  page.data.discoveryResults.forEach((row) => { byId[row.id] = row; });
  assert.equal(byId.m1.existing, true);
  assert.equal(byId.m2.existing, true, 'model added by DSH client must be greyed out');
  assert.equal(byId.d1.existing, false);
  assert.equal(page.data.discoveryAllExisting, false);
  assert.equal(page.data.providers.find((row) => row.id === 'mimo').count, 2);
});


test('manual add supports reasoning levels', async () => {
  const { page, mutations } = createPage();
  page.onLoad();
  await settle();
  page.setData({
    'form.id': 'r1', 'form.name': 'R1', 'form.text': true,
    'form.reasoning': true,
    'form.reasoningRows': [{ level: 'low', value: 'low' }, { level: 'high', value: 'high' }]
  });
  page.setData({ addOpen: true, addProviderId: 'mimo', addProviderName: '小米' });
  page.submitAddModel();
  await settle();
  assert.equal(mutations.length, 1);
  const added = mutations[0].ops[0].value;
  assert.deepEqual(added.reasoningEfforts, { off: null, low: 'low', high: 'high' });
});

test('model editor displays and edits explicit reasoning levels', async () => {
  const { page, mutations, namespace } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  namespace.value.providers.mimo.models[0].reasoningEfforts = { off: null, low: 'low', medium: 'medium' };
  page.openEditModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm1' } } });
  assert.equal(page.data.editLevelsInherited, false);
  assert.deepEqual(page.data.editForm.reasoningRows.map((row) => row.level), ['off', 'low', 'medium']);
  page.addEditReasoningRow();
  page.saveEditModel();
  await settle();
  assert.equal(mutations.length, 1, page.data.editError || 'no edit error');
  const ops = {};
  mutations[0].ops.forEach((op) => { ops[op.path[op.path.length - 1]] = op; });
  assert.deepEqual(ops.reasoningEfforts.value, { off: null, minimal: 'minimal', low: 'low', medium: 'medium' });
});

test('model editor keeps inherited reasoning when levels are untouched', async () => {
  const { page, mutations, namespace } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openEditModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm1' } } });
  assert.equal(page.data.editLevelsInherited, true);
  page.setData({ 'editForm.contextWindow': '200000' });
  page.saveEditModel();
  await settle();
  assert.equal(mutations.length, 1);
  const reasoningOp = mutations[0].ops.filter((op) => op.path[op.path.length - 1] === 'reasoningEfforts')[0];
  assert.ok(!reasoningOp || reasoningOp.op === 'unset');
  assert.equal(namespace.value.providers.mimo.models[0].reasoningEfforts, undefined);
});


test('reasoning level picker uses the glass sheet and updates the row', async () => {
  const { page, mutations } = createPage({ capabilities: ['plugin-management-v1', 'llm-model-config-v1'] });
  page.onLoad();
  await settle();
  page.openEditModel({ currentTarget: { dataset: { provider: 'mimo', model: 'm1' } } });
  page.setData({
    'editForm.reasoning': true,
    'editForm.reasoningRows': [
      { level: 'off', value: '', levelIndex: 0, levelLabel: '关闭', isOff: true },
      { level: 'low', value: 'low', levelIndex: 1, levelLabel: '低', isOff: false }
    ]
  });
  page.openReasoningLevelPicker({ currentTarget: { dataset: { target: 'edit', index: 1 } } });
  assert.equal(page.data.reasoningPickerOpen, true);
  assert.equal(page.data.reasoningPickerLevel, 'low');
  page.selectReasoningLevel({ currentTarget: { dataset: { level: 'high' } } });
  assert.equal(page.data.reasoningPickerOpen, false);
  assert.equal(page.data.editForm.reasoningRows[1].level, 'high');
  assert.equal(page.data.editForm.reasoningRows[1].value, 'high');
  page.saveEditModel();
  await settle();
  assert.equal(mutations.length, 1);
  const reasoning = mutations[0].ops.filter((op) => op.path[op.path.length - 1] === 'reasoningEfforts')[0];
  assert.deepEqual(reasoning.value, { off: null, high: 'high' });
});


test('provider delete removes the provider from llm-pi-ai settings', async () => {
  const { page, mutations, namespace } = createPage();
  page.onLoad();
  await settle();
  page.askDeleteProvider({ currentTarget: { dataset: { id: 'opencode-go' } } });
  assert.equal(page.data.providerDeleteOpen, true);
  assert.equal(page.data.providerDeleteTarget.id, 'opencode-go');
  page.confirmDeleteProvider();
  await settle();
  assert.equal(mutations.length, 1);
  assert.deepEqual(mutations[0].ops, [{ op: 'unset', path: ['providers', 'opencode-go'] }]);
  assert.equal(namespace.value.providers['opencode-go'], undefined);
  assert.equal(page.data.providerDeleteOpen, false);
});

test('provider hosting the current default model cannot be deleted', async () => {
  const { page, mutations, toasts } = createPage();
  page.onLoad();
  await settle();
  page.askDeleteProvider({ currentTarget: { dataset: { id: 'mimo' } } });
  assert.equal(page.data.providerDeleteOpen, false);
  assert.equal(mutations.length, 0);
  assert.ok(toasts.some((item) => String(item.title).includes('默认模型')));
});

