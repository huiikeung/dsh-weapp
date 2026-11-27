import { GatewayFrame } from '../protocol/GatewayDtos';
import { bool, field, num, str } from '../protocol/GatewayFrameCodec';

/** 模型行（对齐小程序 model-settings.buildProviderRows） */
export interface ModelRow {
  id: string;
  name: string;
  meta: string;
  isDefault: boolean;
}

/** 提供商行 */
export interface ProviderRow {
  id: string;
  name: string;
  custom: boolean;
  status: string;
  apiLabel: string;
  baseURL: string;
  count: number;
  models: ModelRow[];
}

/** 推理等级选项 */
export interface ReasoningLevel {
  id: string;
  label: string;
}

/** llm 插件命名空间（与小程序 model-settings.PI_NS 一致） */
export const PI_NS: string = 'llm-pi-ai';
/** 提供商配置在命名空间里的根路径（对齐小程序 PI_PREFIX） */
export const PI_PREFIX: string = 'providers';

/** 新建提供商可选的 API 协议（对齐小程序 PROTOCOLS） */
export interface ProviderProtocol {
  id: string;
  label: string;
}

export const PROVIDER_PROTOCOLS: ProviderProtocol[] = [
  { id: 'openai-completions', label: 'OpenAI Chat Completions' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic Messages' }
];

/** 提供商 ID 规则（与 DSH 自定义 provider 的 ROUTE_PATTERN 一致）。 */
export function validateProviderId(id: string, existingIds: string[]): string {
  const value: string = id.trim();
  if (value.length === 0) {
    return '请输入 Provider ID';
  }
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)) {
    return 'Provider ID 需以小写字母开头，只能包含小写字母、数字和连字符';
  }
  if (existingIds.indexOf(value) >= 0) {
    return 'Provider ID 已存在';
  }
  return '';
}

/** 接口地址必须是带主机的 http(s) 绝对地址。 */
export function isValidProviderBaseURL(value: string): boolean {
  return /^https?:\/\/[^\s/?#]+(?:\/[^\s]*)?$/i.test(value.trim());
}

/** 与 DSH 一致的派生凭据引用：<ROUTE>_API_KEY。 */
export function credentialRefFor(providerId: string): string {
  const stem: string = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (stem.length > 0 ? stem : 'MODEL') + '_API_KEY';
}

/** 新建提供商草稿 → 写入 llm-pi-ai 的 provider 配置对象。 */
export interface ProviderConfigDraft {
  displayName: string;
  api: string;
  baseURL: string;
  apiKeyEnv: string;
  models: Object[];
}

export function buildProviderConfig(draft: ProviderConfigDraft): Record<string, Object> {
  const config: Record<string, Object> = { 'models': draft.models.slice() };
  if (draft.apiKeyEnv.length > 0) {
    config['apiKeyEnv'] = draft.apiKeyEnv;
  }
  if (draft.displayName.length > 0) {
    config['displayName'] = draft.displayName;
  }
  if (draft.api.length > 0) {
    config['api'] = draft.api;
  }
  if (draft.baseURL.length > 0) {
    config['baseURL'] = draft.baseURL;
  }
  return config;
}

/** 新建提供商对应的 plugin-settings-mutate ops（实现见下方 providerCreateMutation）。 */

/** 协议展示名（对齐 protocolLabel） */
export function protocolLabel(api: string): string {
  if (api === 'openai-completions') {
    return 'OpenAI Completions';
  }
  if (api === 'openai-responses') {
    return 'OpenAI Responses';
  }
  if (api === 'anthropic-messages') {
    return 'Anthropic Messages';
  }
  if (api === 'google-generative-ai') {
    return 'Google Generative AI';
  }
  return api;
}

/** Token 数格式化（对齐 formatTokenCount） */
export function formatTokenCount(value: number): string {
  if (value <= 0) {
    return '';
  }
  if (value >= 1000000) {
    const millions: number = Math.round(value / 100000) / 10;
    return millions + 'M';
  }
  if (value >= 1000) {
    const thousands: number = Math.round(value / 100) / 10;
    return thousands + 'K';
  }
  return value.toString();
}

/** 模型元信息行：上下文 / 输入类型 / 推理等级（对齐 modelMeta） */
export function modelMeta(model: Object, levelLabels: Record<string, string>): string {
  const parts: string[] = [];
  const context: number = num(model, 'contextWindow') ?? 0;
  if (context > 0) {
    parts.push('上下文 ' + formatTokenCount(context));
  }
  const maxOut: number = num(model, 'maxOutputTokens') ?? 0;
  if (maxOut > 0) {
    parts.push('输出 ' + formatTokenCount(maxOut));
  }
  const inputs: string[] = [];
  const inputTypes: Object | undefined = field(model, 'inputTypes');
  if (inputTypes !== undefined && Array.isArray(inputTypes)) {
    for (const one of inputTypes as Object[]) {
      const key: string = String(one);
      if (key === 'text') {
        inputs.push('文本');
      } else if (key === 'image') {
        inputs.push('图片');
      }
    }
  }
  if (inputs.length > 0) {
    parts.push(inputs.join('/'));
  }
  const efforts: Object | undefined = field(model, 'reasoningEfforts');
  if (efforts !== undefined && Array.isArray(efforts)) {
    const labels: string[] = [];
    for (const one of efforts as Object[]) {
      const id: string = str(one, 'id') ?? String(one);
      const label: string = levelLabels[id] !== undefined ? levelLabels[id] : id;
      labels.push(label);
    }
    if (labels.length > 0) {
      parts.push('推理 ' + labels.join('/'));
    }
  }
  return parts.join(' · ');
}

/** 自动发现到的模型（对齐小程序 discoveryRows） */
export interface DiscoveredModel {
  id: string;
  name: string;
  meta: string;
  existing: boolean;
}

/** 从 llm-discover-models 响应解析候选模型。 */
export function parseDiscoveredModels(frame: GatewayFrame | undefined, existingIds: string[],
  levelLabels: Record<string, string>): DiscoveredModel[] {
  const rows: DiscoveredModel[] = [];
  if (frame === undefined) {
    return rows;
  }
  let list: Object | undefined = field(frame, 'models');
  if (list === undefined) {
    list = field(field(frame, 'frame'), 'models');
  }
  if (list === undefined || !Array.isArray(list)) {
    return rows;
  }
  for (const item of list as Object[]) {
    const id: string = str(item, 'id') ?? '';
    if (id.length === 0) {
      continue;
    }
    const named: string = str(item, 'name') ?? '';
    // 发现结果用 inputModalities，modelMeta 读 inputTypes，这里做一次映射
    const shape: Record<string, Object> = {};
    const context: number = num(item, 'contextWindow') ?? 0;
    if (context > 0) shape['contextWindow'] = context;
    const modalities: Object | undefined = field(item, 'inputModalities');
    if (modalities !== undefined && Array.isArray(modalities)) {
      const kinds: Object[] = [];
      for (const one of modalities as Object[]) {
        const kind: string = String(one);
        if (kind === 'text' || kind === 'image') {
          kinds.push(kind);
        }
      }
      if (kinds.length > 0) shape['inputTypes'] = kinds;
    }
    rows.push({ id: id, name: named.length > 0 ? named : id, meta: modelMeta(shape, levelLabels),
      existing: existingIds.indexOf(id) >= 0 });
  }
  return rows;
}

/** 把候选模型转成写入设置的模型对象。 */
export function discoveredModelPayload(id: string, name: string): Object {
  const payload: Record<string, Object> = { 'id': id };
  if (name.length > 0 && name !== id) payload['name'] = name;
  return payload;
}

/** 命名的空间视图：value + revision */
export interface PluginNamespace {
  value: Object | undefined;
  revision: number;
  valid: boolean;
  /** 主机下发的设置 schema（Typert refs 树），用于动态生成字段 */
  schema?: Object;
  /** 主机下发的字段级文案（key → 中文标签），来自插件 schema 的 description */
  labels?: Record<string, string>;
}

/** 解析 plugin-settings 响应（namespace 视图在 frame.namespace） */
export function parseNamespace(frame: GatewayFrame | undefined): PluginNamespace {
  if (frame === undefined) {
    return { value: undefined, revision: -1, valid: false };
  }
  // 兼容三种帧形态：{namespace:{…}} / 平铺 {writable,namespace} / 解包后只剩 namespace
  let inner: Object | undefined = field(frame, 'namespace');
  if (inner === undefined) {
    const nested: Object | undefined = field(frame, 'result');
    if (nested !== undefined) {
      inner = field(nested, 'namespace');
    }
  }
  const namespace: Object = inner !== undefined ? inner : frame;
  const revision: number = num(namespace, 'revision') ?? -1;
  const value: Object | undefined = field(namespace, 'value');
  // 字段文案可能挂在 namespace 上（网关新增），也可能挂在平铺帧的顶层
  const labelsSource: Object | undefined = field(namespace, 'labels') ?? field(frame, 'labels');
  const labels: Record<string, string> = {};
  if (labelsSource !== undefined) {
    const entries: Record<string, Object> = labelsSource as Record<string, Object>;
    for (const key of Object.keys(entries)) {
      const text: string = str(entries, key) ?? '';
      if (text.length > 0) {
        labels[key] = text;
      }
    }
  }
  return {
    value: value, revision: revision, valid: Number.isSafeInteger(revision) && revision >= 0,
    schema: field(namespace, 'schema'), labels: labels
  };
}

/** 构造 set 操作 */
function setOp(path: string[], value: Object): Object {
  const op: Record<string, Object> = { 'op': 'set', 'path': path, 'value': value };
  return op;
}

/** 构造 unset 操作 */
function unsetOp(path: string[]): Object {
  const op: Record<string, Object> = { 'op': 'unset', 'path': path };
  return op;
}

/** 追加模型（对齐 appendModelsMutation） */
export function appendModelsMutation(providerId: string, startIndex: number, models: Object[], revision: number): Object[] {
  const ops: Object[] = [];
  let index: number = startIndex;
  for (const model of models) {
    ops.push(setOp(['providers', providerId, 'models', index.toString()], model));
    index += 1;
  }
  return ops;
}

/** 删除模型（对齐 removeModelMutation） */
export function removeModelMutation(providerId: string, index: number, revision: number): Object[] {
  return [unsetOp(['providers', providerId, 'models', index.toString()])];
}

/** 编辑模型（对齐 editModelMutation） */
export function editModelMutation(providerId: string, index: number, model: Object, revision: number): Object[] {
  const base: string[] = ['providers', providerId, 'models', index.toString()];
  const ops: Object[] = [];
  const contextWindow: Object | undefined = field(model, 'contextWindow');
  if (contextWindow === undefined) {
    ops.push(unsetOp(base.concat(['contextWindow'])));
  } else {
    ops.push(setOp(base.concat(['contextWindow']), contextWindow));
  }
  const maxTokens: Object | undefined = field(model, 'maxTokens');
  if (maxTokens === undefined) {
    ops.push(unsetOp(base.concat(['maxTokens'])));
  } else {
    ops.push(setOp(base.concat(['maxTokens']), maxTokens));
  }
  const input: Object | undefined = field(model, 'input');
  if (input === undefined) {
    ops.push(unsetOp(base.concat(['input'])));
  } else {
    ops.push(setOp(base.concat(['input']), input));
  }
  const efforts: Object | undefined = field(model, 'reasoningEfforts');
  if (efforts === undefined) {
    ops.push(unsetOp(base.concat(['reasoningEfforts'])));
  } else {
    ops.push(setOp(base.concat(['reasoningEfforts']), efforts));
  }
  return ops;
}

/** 新建提供商（对齐 providerCreateMutation） */
export function providerCreateMutation(providerId: string, config: Object, revision: number): Object[] {
  return [setOp(['providers', providerId], config)];
}

/** 删除提供商 */
export function providerRemoveMutation(providerId: string, revision: number): Object[] {
  return [unsetOp(['providers', providerId])];
}

/** 构建提供商行（对齐 buildProviderRows） */
export function buildProviderRows(
  providersFrame: GatewayFrame,
  namespace: Object | undefined,
  defaultProvider: string,
  defaultModel: string,
  levelLabels: Record<string, string>
): ProviderRow[] {
  const rows: ProviderRow[] = [];
  const configured: Object | undefined = namespace !== undefined ? field(namespace, 'value') : undefined;
  const configuredProviders: Object | undefined = configured !== undefined ? field(configured, 'providers') : undefined;

  // providers 帧顺序优先
  const frameProviders: Object[] = [];
  const frameList: Object | undefined = field(providersFrame, 'providers');
  if (frameList !== undefined && Array.isArray(frameList)) {
    for (const one of frameList as Object[]) {
      frameProviders.push(one);
    }
  }

  const frameIndex: Map<string, Object> = new Map<string, Object>();
  const orderedIds: string[] = [];
  for (const entry of frameProviders) {
    const id: string = str(entry, 'provider') ?? str(entry, 'id') ?? '';
    if (id.length === 0) {
      continue;
    }
    if (!frameIndex.has(id)) {
      frameIndex.set(id, entry);
    }
    if (configuredProviders !== undefined && field(configuredProviders, id) !== undefined && orderedIds.indexOf(id) < 0) {
      orderedIds.push(id);
    }
  }
  // settings 里其余已配置的 provider 追加在后
  if (configuredProviders !== undefined) {
    const keys: string[] = Object.keys(configuredProviders as Record<string, Object>);
    for (const key of keys) {
      if (orderedIds.indexOf(key) < 0) {
        orderedIds.push(key);
      }
    }
  }

  for (const id of orderedIds) {
    const config: Object | undefined = configuredProviders !== undefined ? field(configuredProviders, id) : undefined;
    if (config === undefined) {
      continue;
    }
    const entry: Object | undefined = frameIndex.get(id);
    const displayName: string = (entry !== undefined ? str(entry, 'displayName') : undefined) ?? str(config, 'displayName') ?? id;
    const declared: boolean = entry !== undefined ? (bool(entry, 'declared') ?? false) : true;
    const baseURL: string = str(config, 'baseURL') ?? (entry !== undefined ? (str(entry, 'defaultBaseURL') ?? '') : '');
    const api: string = str(config, 'api') ?? '';

    const models: ModelRow[] = [];
    const rawModels: Object | undefined = field(config, 'models');
    if (rawModels !== undefined && Array.isArray(rawModels)) {
      for (const one of rawModels as Object[]) {
        const modelId: string = str(one, 'id') ?? '';
        if (modelId.length === 0) {
          continue;
        }
        models.push({
          id: modelId,
          name: str(one, 'name') ?? modelId,
          meta: modelMeta(one, levelLabels),
          isDefault: defaultProvider === id && defaultModel === modelId
        });
      }
    }

    rows.push({
      id: id,
      name: displayName,
      custom: !declared,
      status: 'ok',
      apiLabel: protocolLabel(api),
      baseURL: baseURL,
      count: models.length,
      models: models
    });
  }
  return rows;
}
