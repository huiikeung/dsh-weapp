// 模型设置：把网关的 providers / llm-pi-ai 设置投影成模型页数据，
// 并生成可回写的 settings 变更。这里只做纯数据转换，方便单测。

const PI_NS = 'llm-pi-ai';
const PI_PREFIX = 'providers';

// DSH 模型页把协议显示为产品名，存储值仍是 schema 标识符。
// llm-pi-ai 允许作为 reasoningEfforts 键的思考档位（按升级顺序）。
const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const PROTOCOL_LABELS = {
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages'
};

/** 该 providers 条目是否来自 llm-pi-ai（第三方/自定义模型路由）。 */
function isPiProvider(entry) {
  if (!entry || entry.settingsNs !== PI_NS || !Array.isArray(entry.settingsPath)) return false;
  return entry.settingsPath[0] === PI_PREFIX && entry.settingsPath.length === 2;
}

function protocolLabel(api) {
  return PROTOCOL_LABELS[api] || api || '';
}

/** 1,048,576 -> "1M"；131072 -> "128K"；原值不是正数时返回空串。 */
function formatTokenCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  if (number >= 1000000) {
    const millions = number / 1000000;
    return (Number.isInteger(millions) ? String(millions) : millions.toFixed(1).replace(/\.0$/, '')) + 'M';
  }
  if (number >= 1000) return Math.round(number / 1000) + 'K';
  return String(Math.round(number));
}

/** 模型行副标题：上下文窗口 + 输入类型（labels 由页面按界面语言传入）。 */
function modelMeta(model, labels) {
  const copy = labels || {};
  const parts = [];
  if (Number.isFinite(Number(model && model.contextWindow)) && Number(model.contextWindow) > 0) {
    parts.push((copy.context || 'Context') + ' ' + formatTokenCount(model.contextWindow));
  }
  const inputs = Array.isArray(model && model.input) ? model.input : [];
  if (inputs.length) {
    parts.push(inputs.map((kind) => (kind === 'image' ? (copy.image || 'Image') : (copy.text || 'Text'))).join('/'));
  }
  if (model && model.reasoningEfforts === false) {
    parts.push(copy.noReasoning || 'No reasoning');
  } else if (model && model.reasoningEfforts && typeof model.reasoningEfforts === 'object') {
    const levelLabels = copy.levelLabels || {};
    const declared = REASONING_LEVELS.filter((level) => model.reasoningEfforts[level] !== undefined);
    if (declared.length) {
      parts.push((copy.reasoning || 'Reasoning') + ' ' + declared.map((level) => levelLabels[level] || level).join('/'));
    }
  }
  return parts.join(' · ');
}

/**
 * providers 帧 + llm-pi-ai namespace -> 模型页的提供商行。
 * 有 providers 帧时只保留其中 declared 的 llm-pi-ai 条目（顺序与 DSH 模型页一致）；
 * 旧网关没有 providers 帧时，退回 namespace 里已配置的 provider 键。
 */
function buildProviderRows(providersFrame, namespace, defaultSelection, labels) {
  const value = (namespace && namespace.value) || {};
  const configured = value.providers && typeof value.providers === 'object' ? value.providers : {};
  const frameRows = (providersFrame && Array.isArray(providersFrame.providers) ? providersFrame.providers : [])
    .filter(isPiProvider);
  const frameIndex = {};
  frameRows.forEach((entry) => { if (!frameIndex[entry.provider]) frameIndex[entry.provider] = entry; });
  // 已配置的 pi-ai provider 都展示（内置目录 provider 也可能是用户配置过的）；
  // 顺序跟 DSH 模型页一致：providers 帧顺序在前，其余按 settings 键顺序补在后面。
  const orderedIds = [];
  frameRows.forEach((entry) => {
    if (configured[entry.provider] && orderedIds.indexOf(entry.provider) < 0) orderedIds.push(entry.provider);
  });
  Object.keys(configured).forEach((id) => {
    if (orderedIds.indexOf(id) < 0) orderedIds.push(id);
  });
  const source = orderedIds.map((id) => {
    const entry = frameIndex[id];
    return {
      id: id,
      displayName: (entry && entry.displayName) || (configured[id] && configured[id].displayName),
      defaultBaseURL: entry && entry.defaultBaseURL,
      // 没有 providers 帧的旧网关无法区分内置目录与手写路由，统一按自定义展示。
      declared: entry ? entry.declared === true : true,
      config: configured[id]
    };
  });
  const rows = [];
  source.forEach((entry) => {
    const id = entry.id;
    const config = entry.config;
    if (!id || !config) return;
    const rawModels = Array.isArray(config.models) ? config.models : [];
    const models = rawModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      meta: modelMeta(model, labels),
      isDefault: !!(defaultSelection && defaultSelection.provider === id && defaultSelection.model === model.id)
    }));
    rows.push({
      id: id,
      name: entry.displayName || config.displayName || id,
      // 只有手工声明的 pi-ai 路由带「自定义」徽标；内置目录 provider 不显示。
      custom: entry.declared === true,
      apiLabel: protocolLabel(config.api),
      baseURL: config.baseURL || entry.defaultBaseURL || '',
      count: models.length,
      status: models.length ? 'ready' : 'empty',
      models: models
    });
  });
  return rows;
}

/** 新增模型表单校验；返回 { model } 或 { error: 界面文案键 }。 */
function validateNewModel(form, existingModels) {
  const input = form || {};
  const id = String(input.id == null ? '' : input.id).trim();
  if (!id) return { error: 'id-empty' };
  const existing = Array.isArray(existingModels) ? existingModels : [];
  if (existing.some((model) => model && model.id === id)) return { error: 'id-duplicate' };

  const contextWindow = String(input.contextWindow == null ? '' : input.contextWindow).trim();
  const maxTokens = String(input.maxTokens == null ? '' : input.maxTokens).trim();
  const model = { id: id };
  if (contextWindow) {
    const number = Number(contextWindow);
    if (!Number.isSafeInteger(number) || number <= 0) return { error: 'context-invalid' };
    model.contextWindow = number;
  }
  if (maxTokens) {
    const number = Number(maxTokens);
    if (!Number.isSafeInteger(number) || number <= 0) return { error: 'max-invalid' };
    model.maxTokens = number;
  }
  const name = String(input.name == null ? '' : input.name).trim();
  if (name) model.name = name;
  const inputs = [];
  if (input.text) inputs.push('text');
  if (input.image) inputs.push('image');
  if (!inputs.length) return { error: 'input-empty' };
  model.input = inputs;
  if (input.reasoning === true) {
    const efforts = Array.isArray(input.reasoningRows)
      ? buildReasoningEffortsFromRows(input.reasoningRows)
      : buildReasoningEfforts(input.levels, null);
    if (efforts.error) return efforts;
    model.reasoningEfforts = efforts.value;
  } else {
    model.reasoningEfforts = false;
  }
  return { model: model };
}

/** 把 reasoningEfforts 展开成可编辑的档位行（off 的 null 值显示为空）。 */
function reasoningRowsFromEfforts(efforts) {
  if (!efforts || efforts === false || typeof efforts !== 'object') return [];
  return ['off'].concat(REASONING_LEVELS).filter((level) => efforts[level] !== undefined).map((level) => ({
    level: level,
    value: efforts[level] === null ? '' : String(efforts[level])
  }));
}

/** 默认档位行：off + low/medium/high（与 DSH 打开推理开关时的初始行一致）。 */
function defaultReasoningRows() {
  return reasoningRowsFromEfforts({ off: null, low: 'low', medium: 'medium', high: 'high' });
}

/** 行 -> reasoningEfforts；非 off 档位留空时用档位名作为 API 参数值。 */
function buildReasoningEffortsFromRows(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const efforts = { off: null };
  let declared = 0;
  for (const row of source) {
    if (!row || typeof row.level !== 'string' || REASONING_LEVELS.indexOf(row.level) < 0) continue;
    if (Object.prototype.hasOwnProperty.call(efforts, row.level)) return { error: 'reasoning-levels-duplicate' };
    const value = String(row.value == null ? '' : row.value).trim();
    if (row.level === 'off') {
      efforts.off = value.length > 0 ? value : null;
      continue;
    }
    efforts[row.level] = value.length > 0 ? value : row.level;
    declared += 1;
  }
  if (!declared) return { error: 'reasoning-levels-empty' };
  return { value: efforts };
}

/** 由勾选的档位生成 reasoningEfforts；已有模型保留原 wire 值，新档位用档位名。 */
function buildReasoningEfforts(levels, original) {
  const source = original && typeof original === 'object' ? original : {};
  const selected = levels && typeof levels === 'object' ? levels : {};
  const efforts = { off: source.off === undefined ? null : source.off };
  let declared = 0;
  REASONING_LEVELS.forEach((level) => {
    if (selected[level] !== true) return;
    const wire = source[level];
    efforts[level] = typeof wire === 'string' && wire.length > 0 ? wire : level;
    declared += 1;
  });
  if (!declared) return { error: 'reasoning-levels-empty' };
  return { value: efforts };
}

function appendModel(models, model) {
  return (Array.isArray(models) ? models : []).concat([model]);
}

function removeModel(models, id) {
  return (Array.isArray(models) ? models : []).filter((item) => !item || item.id !== id);
}

/** 编辑已有模型：保留 id/name，更新上下文窗口、输出上限、图片输入与推理开关。 */
function applyModelEdit(model, form, originalReasoning) {
  const input = form || {};
  const next = Object.assign({}, model || {});
  const contextWindow = String(input.contextWindow == null ? '' : input.contextWindow).trim();
  const maxTokens = String(input.maxTokens == null ? '' : input.maxTokens).trim();
  if (contextWindow) {
    const number = Number(contextWindow);
    if (!Number.isSafeInteger(number) || number <= 0) return { error: 'context-invalid' };
    next.contextWindow = number;
  } else {
    delete next.contextWindow;
  }
  if (maxTokens) {
    const number = Number(maxTokens);
    if (!Number.isSafeInteger(number) || number <= 0) return { error: 'max-invalid' };
    next.maxTokens = number;
  } else {
    delete next.maxTokens;
  }
  const inputs = ['text'];
  if (input.image) inputs.push('image');
  next.input = inputs;
  // DSH schema 只允许 reasoningEfforts 为 false 或等级映射；开启表示「沿用目录/提供商能力」。
  if (input.reasoning === false) {
    next.reasoningEfforts = false;
  } else if (Array.isArray(input.reasoningRows)) {
    const efforts = buildReasoningEffortsFromRows(input.reasoningRows);
    if (efforts.error) return efforts;
    next.reasoningEfforts = efforts.value;
  } else if (input.levels !== undefined) {
    const efforts = buildReasoningEfforts(input.levels, originalReasoning);
    if (efforts.error) return efforts;
    next.reasoningEfforts = efforts.value;
  } else if (originalReasoning !== undefined && originalReasoning !== null && originalReasoning !== false) {
    next.reasoningEfforts = originalReasoning;
  } else {
    delete next.reasoningEfforts;
  }
  return { model: next };
}

function replaceModel(models, id, model) {
  return (Array.isArray(models) ? models : []).map((item) => (item && item.id === id ? model : item));
}

function isDefaultModel(selection, providerId, modelId) {
  return !!(selection && selection.provider === providerId && selection.model === modelId);
}

/** requestPlugin('plugin-settings-mutate') 的载荷（type/requestId 由 gateway 补）。 */
function modelsMutation(providerId, models, revision) {
  return {
    ns: PI_NS,
    expectedRevision: revision,
    ops: [{
      op: 'set',
      path: [PI_PREFIX, providerId, 'models'],
      value: (Array.isArray(models) ? models : []).slice()
    }]
  };
}

/**
 * 精确编辑单个模型：只写该模型的受管字段，避免整段 models 覆盖掉 DSH 客户端
 * 在同一提供商下新增/修改的其他模型。
 */
function appendModelsMutation(providerId, startIndex, models, revision) {
  const ops = [];
  (Array.isArray(models) ? models : []).forEach((model, offset) => {
    ops.push({ op: 'set', path: [PI_PREFIX, providerId, 'models', String(startIndex + offset)], value: model });
  });
  return { ns: PI_NS, expectedRevision: revision, ops: ops };
}

function removeModelMutation(providerId, index, revision) {
  return {
    ns: PI_NS,
    expectedRevision: revision,
    ops: [{ op: 'unset', path: [PI_PREFIX, providerId, 'models', String(index)] }]
  };
}

function editModelMutation(providerId, index, model, revision) {
  const base = [PI_PREFIX, providerId, 'models', String(index)];
  const ops = [];
  [['contextWindow', model && model.contextWindow],
    ['maxTokens', model && model.maxTokens],
    ['input', model && model.input],
    ['reasoningEfforts', model && model.reasoningEfforts]].forEach(([field, value]) => {
    if (value === undefined) ops.push({ op: 'unset', path: base.concat(field) });
    else ops.push({ op: 'set', path: base.concat(field), value: value });
  });
  return { ns: PI_NS, expectedRevision: revision, ops: ops };
}

// ---------- 添加模型提供商 / 自动获取模型 ----------

const PROTOCOLS = [
  { id: 'openai-completions', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' }
];

/** 与 DSH 客户端一致的派生凭据引用：<ROUTE>_API_KEY。 */
function credentialRefFor(providerId) {
  const stem = String(providerId == null ? '' : providerId).toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (stem || 'MODEL') + '_API_KEY';
}

/** 只接受带主机的 http(s) 绝对地址（不依赖 WeChat 的 URL 实现）。 */
function isValidBaseURL(value) {
  const text = String(value == null ? '' : value).trim();
  return /^https?:\/\/[^\s/?#]+(?:\/[^\s]*)?$/i.test(text);
}

function validateProviderId(id, existingIds) {
  const value = String(id == null ? '' : id).trim();
  if (!value) return { error: 'provider-id-empty' };
  // 与 DSH 自定义 provider 的 ROUTE_PATTERN 一致：小写字母开头，后接小写字母/数字/连字符；
  // 该 id 同时是 apiKeyEnv 的派生前缀，不能以数字开头，也不能含点/下划线。
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) return { error: 'provider-id-invalid' };
  if ((existingIds || []).indexOf(value) >= 0) return { error: 'provider-id-duplicate' };
  return { value: value };
}

/** 内置目录里尚未配置的 pi-ai provider（用于「第三方模型提供商」）。 */
function dormantCatalogProviders(providersFrame, namespace) {
  const configured = (namespace && namespace.value && namespace.value.providers) || {};
  return (providersFrame && Array.isArray(providersFrame.providers) ? providersFrame.providers : [])
    .filter(isPiProvider)
    .filter((entry) => entry.declared !== true && !configured[entry.provider])
    .map((entry) => ({
      id: entry.provider,
      name: entry.displayName || entry.provider,
      defaultBaseURL: entry.defaultBaseURL || '',
      nativeAuthEnv: (entry.nativeAuth && Array.isArray(entry.nativeAuth.env) ? entry.nativeAuth.env : []).slice(0, 3)
    }));
}

/** 校验「添加模型提供商」草稿，返回创建所需的 provider 描述。 */
function validateProviderDraft(mode, draft, options) {
  const input = draft || {};
  const opts = options || {};
  if (mode === 'catalog') {
    const id = String(input.providerId == null ? '' : input.providerId).trim();
    const catalog = (opts.catalogProviders || []).filter((entry) => entry.id === id)[0];
    if (!catalog) return { error: 'catalog-empty' };
    return {
      value: {
        providerId: id,
        displayName: input.displayName ? String(input.displayName).trim() : catalog.name,
        baseURL: String(input.baseURL || catalog.defaultBaseURL || '').trim(),
        api: input.api || '',
        apiKeyEnv: credentialRefFor(id)
      }
    };
  }
  const idCheck = validateProviderId(input.providerId, opts.existingIds);
  if (idCheck.error) return idCheck;
  const baseURL = String(input.baseURL == null ? '' : input.baseURL).trim();
  if (!isValidBaseURL(baseURL)) return { error: 'base-url-invalid' };
  if (!PROTOCOLS.some((entry) => entry.id === input.api)) return { error: 'api-invalid' };
  return {
    value: {
      providerId: idCheck.value,
      displayName: String(input.displayName == null ? '' : input.displayName).trim(),
      baseURL: baseURL,
      api: input.api,
      apiKeyEnv: credentialRefFor(idCheck.value)
    }
  };
}

function buildProviderConfig(input) {
  const source = input || {};
  const config = { models: Array.isArray(source.models) ? source.models.slice() : [] };
  // 与 DSH CustomProviderCard 一致：只有在创建时填写了 API Key 才写 apiKeyEnv；
  // 留空时交给 pi-ai 的原生认证/环境变量解析。
  if (source.apiKeyEnv) config.apiKeyEnv = source.apiKeyEnv;
  if (source.displayName) config.displayName = source.displayName;
  if (source.api) config.api = source.api;
  if (source.baseURL) config.baseURL = source.baseURL;
  return config;
}

function providerCreateMutation(providerId, config, revision) {
  return {
    ns: PI_NS,
    expectedRevision: revision,
    ops: [{ op: 'set', path: [PI_PREFIX, providerId], value: config }]
  };
}

/** 把 discovery 候选按 DSH 模型字段映射进现有 models（跳过重复 id）。 */
function addDiscoveredModels(models, candidates) {
  const existing = {};
  (Array.isArray(models) ? models : []).forEach((model) => { if (model && model.id) existing[model.id] = true; });
  const next = (Array.isArray(models) ? models : []).slice();
  const added = [];
  (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
    if (!candidate || typeof candidate.id !== 'string' || !candidate.id || existing[candidate.id]) return;
    existing[candidate.id] = true;
    const model = { id: candidate.id };
    if (typeof candidate.name === 'string' && candidate.name) model.name = candidate.name;
    if (Number.isSafeInteger(candidate.contextWindow) && candidate.contextWindow > 0) model.contextWindow = candidate.contextWindow;
    if (Number.isSafeInteger(candidate.maxTokens) && candidate.maxTokens > 0) model.maxTokens = candidate.maxTokens;
    if (Array.isArray(candidate.inputModalities)) {
      const inputs = candidate.inputModalities.filter((kind) => kind === 'text' || kind === 'image');
      if (inputs.length) model.input = inputs;
    }
    next.push(model);
    added.push(model);
  });
  return { models: next, added: added };
}

/** 发现结果转成列表行（页面只显示白名单字段）。existing 行表示该提供商下已配置，灰显且不可选。 */
function discoveryRows(candidates, labels, existingModels) {
  const existing = {};
  (Array.isArray(existingModels) ? existingModels : []).forEach((model) => {
    const id = typeof model === 'string' ? model : (model && model.id);
    if (typeof id === 'string' && id) existing[id] = true;
  });
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && typeof candidate.id === 'string' && candidate.id)
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name || candidate.id,
      meta: modelMeta({
        contextWindow: candidate.contextWindow,
        input: Array.isArray(candidate.inputModalities) ? candidate.inputModalities.filter((kind) => kind === 'text' || kind === 'image') : []
      }, labels),
      existing: existing[candidate.id] === true,
      selected: false
    }));
}

/** 把网关错误映射到界面文案键；没有匹配时返回空串，由页面显示原始信息。 */
function errorKey(message) {
  const text = String(message || '');
  if (!text) return '';
  if (/unknown message type|plugin-management-v1/i.test(text)) return '当前网关不支持模型管理，请升级网关后重试。';
  if (/namespace is unavailable|plugin-settings\/not-found|no configurable plugin entry/i.test(text)) return '当前网关未提供模型配置，请升级网关后重试。';
  if (/conflict|expectedRevision|revision/i.test(text)) return '设置已在其他位置更新，已刷新，请重试';
  return '';
}

module.exports = {
  PI_NS,
  PI_PREFIX,
  isPiProvider,
  protocolLabel,
  formatTokenCount,
  modelMeta,
  buildProviderRows,
  validateNewModel,
  REASONING_LEVELS,
  buildReasoningEfforts,
  reasoningRowsFromEfforts,
  defaultReasoningRows,
  buildReasoningEffortsFromRows,
  appendModel,
  removeModel,
  applyModelEdit,
  replaceModel,
  appendModelsMutation,
  removeModelMutation,
  editModelMutation,
  isDefaultModel,
  modelsMutation,
  PROTOCOLS,
  credentialRefFor,
  isValidBaseURL,
  validateProviderId,
  dormantCatalogProviders,
  validateProviderDraft,
  buildProviderConfig,
  providerCreateMutation,
  addDiscoveredModels,
  discoveryRows,
  errorKey
};
