'use strict';

const DEFAULT_TEMPLATE_ID = 'QvgkQ88HKFdTNPJVOp0EdHDbWk9lt9WDKfbb95z-AAU';

function failure(message, code, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}

function timestampFields(now) {
  const date = new Date(now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 16);
  return { time: date, date: date.slice(0, 10) };
}

// 指标格式化：把网关提交的原始数值转成适合订阅消息字段的字符串。
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Number(ms) || 0) / 1000;
  if (totalSeconds < 60) return totalSeconds.toFixed(1) + 's';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return minutes + 'm' + seconds + 's';
}

function formatTokens(tokens) {
  const n = Number(tokens) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function formatCacheHitRate(rate) {
  return Math.round(Math.min(1, Math.max(0, Number(rate) || 0)) * 100) + '%';
}

function truncateField(str, maxLen) {
  const s = String(str == null ? '' : str);
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// 微信订阅消息对字段类型有严格校验：number 只能是纯数字，amount 必须是金额，
// phrase 最多 5 个字符，thing ≤20，name ≤10，character_string ≤32。
// 把格式化后的字符串按字段类型收敛，避免整条消息因单个字段不合法被微信拒绝。
function metricValue(type, formatted, numeric) {
  if (type === 'number') return String(Math.max(0, Math.round(Number(numeric) || 0)));
  if (type === 'amount') return Math.max(0, Number(numeric) || 0).toFixed(2);
  if (type === 'phrase') return String(formatted).slice(0, 5);
  if (type === 'thing' || type === 'short_thing') return String(formatted).slice(0, 20);
  if (type === 'name') return String(formatted).slice(0, 10);
  if (type === 'character_string') return String(formatted).slice(0, 32);
  return String(formatted);
}

// 从模板内容中提取每个字段占位符前的上下文文本，用于关键词匹配。
function fieldContexts(content, keys) {
  const contexts = {};
  let lastEnd = 0;
  for (const key of keys) {
    const placeholder = '{{' + key + '.DATA}}';
    const idx = content.indexOf(placeholder, lastEnd);
    if (idx < 0) { contexts[key] = ''; continue; }
    contexts[key] = content.slice(lastEnd, idx);
    lastEnd = idx + placeholder.length;
  }
  return contexts;
}

// 组合指标字符串：把多个指标格式化为一个字符串，指标名自带在值里面。
// 用于「任务结果」「备注」等 thing 类型字段，弥补微信关键词标签不可自定义的限制。
function formatCombinedMetrics(metrics, exclude = []) {
  const parts = [];
  if (!exclude.includes('duration') && metrics.durationMs != null) parts.push('时长' + formatDuration(metrics.durationMs));
  if (!exclude.includes('tokens') && metrics.tokens != null) parts.push('Token' + formatTokens(metrics.tokens));
  if (!exclude.includes('cacheHitRate') && metrics.cacheHitRate != null) parts.push('缓存命中' + formatCacheHitRate(metrics.cacheHitRate));
  return parts.join(' · ');
}

// 根据字段前的上下文文本匹配指标。
// 优先匹配微信公众号订阅消息的实际关键词标签，再回退到通用关键词。
// allowCombined=false 时只填专用字段（完成率/Token/时长/任务名称），供第一轮使用；
// allowCombined=true 时第二轮回退到「任务结果」/「备注」组合字段。
function matchMetric(context, type, metrics, used, allowCombined = true) {
  const text = String(context || '');

  // 任务名称 → 微信关键词「任务名称」
  if (!used.has('taskName') && metrics.taskName &&
      /任务名称|任务名/.test(text) &&
      ['thing', 'name', 'short_thing', 'character_string', 'phrase'].includes(type)) {
    used.add('taskName');
    const maxLen = type === 'thing' || type === 'short_thing' ? 20 : type === 'name' || type === 'phrase' ? 10 : 32;
    return truncateField(metrics.taskName, maxLen);
  }

  // Token 消耗 → 微信关键词「Token」
  if (!used.has('tokens') && metrics.tokens != null &&
      /token/i.test(text) &&
      ['number', 'amount', 'character_string'].includes(type)) {
    used.add('tokens');
    return metricValue(type, formatTokens(metrics.tokens), metrics.tokens);
  }

  // 任务结果 / 备注 → 组合指标字符串（仅第二轮回退；已填过的指标不再重复）
  if (allowCombined && !used.has('combined') &&
      /任务结果|备注/.test(text) &&
      ['thing', 'short_thing', 'character_string', 'phrase'].includes(type)) {
    const combined = formatCombinedMetrics(metrics, Array.from(used));
    if (combined) {
      used.add('combined');
      if (metrics.durationMs != null) used.add('duration');
      if (metrics.cacheHitRate != null) used.add('cacheHitRate');
      const maxLen = type === 'thing' || type === 'short_thing' ? 20 : type === 'phrase' ? 5 : 32;
      return truncateField(combined, maxLen);
    }
  }

  // 完成率 → 单独的缓存命中率数字（如果用户同时选了完成率和任务结果/备注）
  if (!used.has('cacheHitRate') && metrics.cacheHitRate != null &&
      /完成率/.test(text) &&
      ['number', 'amount', 'character_string'].includes(type)) {
    used.add('cacheHitRate');
    return metricValue(type, formatCacheHitRate(metrics.cacheHitRate), metrics.cacheHitRate * 100);
  }

  // ---- 通用关键词回退（适配其他模板关键词组合） ----

  // 缓存命中率 — 通用关键词
  if (!used.has('cacheHitRate') && metrics.cacheHitRate != null &&
      /缓存|命中|hit/i.test(text) &&
      ['character_string', 'number', 'amount', 'phrase'].includes(type)) {
    used.add('cacheHitRate');
    return metricValue(type, formatCacheHitRate(metrics.cacheHitRate), metrics.cacheHitRate * 100);
  }

  // Token 消耗 — 通用关键词
  if (!used.has('tokens') && metrics.tokens != null &&
      /消耗|用量/i.test(text) &&
      ['number', 'amount', 'character_string'].includes(type)) {
    used.add('tokens');
    return metricValue(type, formatTokens(metrics.tokens), metrics.tokens);
  }

  // 任务时长 — 通用关键词
  if (!used.has('duration') && metrics.durationMs != null &&
      /耗时|时长|duration/i.test(text) &&
      ['character_string', 'number', 'amount', 'phrase', 'short_thing'].includes(type)) {
    used.add('duration');
    return metricValue(type, formatDuration(metrics.durationMs), Math.round(Number(metrics.durationMs) / 1000));
  }

  // 任务名称 — 通用关键词（排除「任务结果」「备注」「完成率」等组合字段的上下文）
  if (!used.has('taskName') && metrics.taskName &&
      /任务|名称|标题/.test(text) && !/任务结果|备注|完成率/.test(text) &&
      ['thing', 'name', 'short_thing', 'character_string', 'phrase'].includes(type)) {
    used.add('taskName');
    const maxLen = type === 'thing' ? 20 : type === 'short_thing' || type === 'phrase' ? 10 : 32;
    return truncateField(metrics.taskName, maxLen);
  }

  return null;
}

function defaultValueForType(type) {
  switch (type) {
    case 'thing': return '任务已完成';
    case 'name': return '任务';
    case 'character_string': return 'TASK_DONE';
    case 'short_thing': return '任务完成';
    case 'phrase': return '已完成';
    case 'number': return '0';
    case 'amount': return '0.00';
    // 其余微信订阅消息字段类型的合法占位值，避免一个未识别类型导致整条通知失败。
    case 'letter': return 'A';
    case 'symbol': return '·';
    case 'phone_number': return '13800000000';
    case 'car_number': return '京A00000';
    default: throw failure('订阅模板字段类型暂不支持', 'UNSUPPORTED_TEMPLATE_FIELD');
  }
}

function templateData(content, now = Date.now, metrics = null) {
  const keys = [...new Set([...String(content || '').matchAll(/\{\{([a-z][a-z0-9_]*)\.DATA\}\}/gi)].map(match => match[1]))];
  if (!keys.length) throw failure('订阅模板没有可用字段', 'INVALID_TEMPLATE');
  const time = timestampFields(now);
  const contexts = fieldContexts(content, keys);
  const used = new Set();
  const data = {};
  const pending = [];
  // 第一轮：只填专用字段（任务名称/Token/完成率/时长），保证专用字段优先拿到指标。
  for (const key of keys) {
    const type = key.replace(/\d+$/, '').toLowerCase();
    if (type === 'time' || type === 'date') { data[key] = { value: time[type] }; continue; }
    if (metrics) {
      const matched = matchMetric(contexts[key] || '', type, metrics, used, false);
      if (matched != null) { data[key] = { value: matched }; continue; }
    }
    pending.push(key);
  }
  // 第二轮：未匹配的字段回退到「任务结果」「备注」组合字段，再回退默认值。
  for (const key of pending) {
    const type = key.replace(/\d+$/, '').toLowerCase();
    if (metrics) {
      const matched = matchMetric(contexts[key] || '', type, metrics, used, true);
      if (matched != null) { data[key] = { value: matched }; continue; }
    }
    data[key] = { value: defaultValueForType(type) };
  }
  return data;
}

function createWechatNotificationSender({ getWechatConfig, templateId = DEFAULT_TEMPLATE_ID, fetchImpl = globalThis.fetch, now = Date.now }) {
  if (typeof getWechatConfig !== 'function' || typeof fetchImpl !== 'function') throw new Error('Invalid WeChat notification sender configuration');
  const tokens = new Map();
  const templates = new Map();

  async function requestJson(url, options) {
    let response, result;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
      result = await response.json();
    } catch (_) { throw failure('微信服务暂时不可用', 'WECHAT_NETWORK', true); }
    if (!response.ok) throw failure('微信服务暂时不可用', 'WECHAT_HTTP', response.status >= 500);
    if (result && Number(result.errcode) !== 0 && result.errcode !== undefined) {
      const code = Number(result.errcode);
      throw failure('微信服务未接受订阅消息', 'WECHAT_API_' + code, [45009, 50002, -1].includes(code));
    }
    return result || {};
  }

  async function accessToken(config, force = false) {
    const cached = tokens.get(config.appId);
    if (!force && cached && cached.appSecret === config.appSecret && cached.expiresAt > now() + 300000) return cached.value;
    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.search = new URLSearchParams({ grant_type: 'client_credential', appid: config.appId, secret: config.appSecret });
    const result = await requestJson(url, { method: 'GET' });
    if (typeof result.access_token !== 'string' || !Number.isFinite(Number(result.expires_in))) throw failure('微信凭据响应无效', 'WECHAT_TOKEN_INVALID');
    tokens.set(config.appId, { appSecret: config.appSecret, value: result.access_token, expiresAt: now() + Number(result.expires_in) * 1000 });
    return result.access_token;
  }

  async function template(accessTokenValue, selectedTemplateId) {
    const cached = templates.get(selectedTemplateId);
    if (cached && cached.expiresAt > now()) return cached.value;
    const url = new URL('https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate');
    url.search = new URLSearchParams({ access_token: accessTokenValue });
    const result = await requestJson(url, { method: 'GET' });
    const item = (Array.isArray(result.data) ? result.data : []).find(value => value && value.priTmplId === selectedTemplateId);
    if (!item || typeof item.content !== 'string') throw failure('微信后台未找到任务完成提醒模板', 'TEMPLATE_NOT_FOUND');
    const value = { content: item.content };
    templates.set(selectedTemplateId, { value, expiresAt: now() + 60 * 60 * 1000 });
    return value;
  }

  return async function sendCompletionNotification(openid, { sessionId, templateId: ticketTemplateId, taskName, durationMs, tokens, cacheHitRate } = {}) {
    // 模板 ID 优先用小程序随票据提交的那个；未提交时回退到内置默认值（兼容旧版小程序）。
    const selectedTemplateId = typeof ticketTemplateId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(ticketTemplateId) ? ticketTemplateId : templateId;
    const metrics = taskName != null || durationMs != null || tokens != null || cacheHitRate != null
      ? { taskName, durationMs, tokens, cacheHitRate }
      : null;
    const config = await getWechatConfig();
    if (!config || !config.appId || !config.appSecret) throw failure('微信订阅通知尚未配置', 'WECHAT_NOT_CONFIGURED');
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken(config, attempt > 0);
      try {
        const selected = await template(token, selectedTemplateId);
        const url = new URL('https://api.weixin.qq.com/cgi-bin/message/subscribe/send');
        url.search = new URLSearchParams({ access_token: token });
        await requestJson(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ touser: openid, template_id: selectedTemplateId,
            page: typeof sessionId === 'string' && sessionId ? 'pages/session/session?id=' + encodeURIComponent(sessionId) : 'pages/home/home',
            data: templateData(selected.content, now, metrics), miniprogram_state: 'formal', lang: 'zh_CN' })
        });
        return { sent: true };
      } catch (error) {
        if (attempt === 0 && /^WECHAT_API_(40001|42001)$/.test(error.code || '')) {
          tokens.delete(config.appId);
          templates.delete(selectedTemplateId);
          continue;
        }
        throw error;
      }
    }
    throw failure('微信订阅通知发送失败', 'WECHAT_SEND_FAILED', true);
  };
}

module.exports = { DEFAULT_TEMPLATE_ID, templateData, createWechatNotificationSender, formatDuration, formatTokens, formatCacheHitRate, formatCombinedMetrics };
