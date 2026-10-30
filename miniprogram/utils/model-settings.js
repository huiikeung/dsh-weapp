// 模型设置：把网关的 providers / llm-pi-ai 设置投影成模型页数据，
// 并生成可回写的 settings 变更。这里只做纯数据转换，方便单测。

const PI_NS = 'llm-pi-ai';
const PI_PREFIX = 'providers';

// DSH 模型页把协议显示为产品名，存储值仍是 schema 标识符。
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
    .filter(isPiProvider)
    .filter((entry) => entry.declared === true);
  const source = frameRows.length
    ? frameRows.map((entry) => ({ id: entry.provider, displayName: entry.displayName, config: configured[entry.provider] }))
    : Object.keys(configured).map((id) => ({ id: id, displayName: configured[id] && configured[id].displayName, config: configured[id] }));
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
      custom: true,
      apiLabel: protocolLabel(config.api),
      baseURL: config.baseURL || '',
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
  return { model: model };
}

function appendModel(models, model) {
  return (Array.isArray(models) ? models : []).concat([model]);
}

function removeModel(models, id) {
  return (Array.isArray(models) ? models : []).filter((item) => !item || item.id !== id);
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
  isPiProvider,
  protocolLabel,
  formatTokenCount,
  modelMeta,
  buildProviderRows,
  validateNewModel,
  appendModel,
  removeModel,
  isDefaultModel,
  modelsMutation,
  errorKey
};
