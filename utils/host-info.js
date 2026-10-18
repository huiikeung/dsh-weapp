// 新 Remote Gateway 与旧移动网关的主机信息使用不同字段名。
function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function version(value) {
  const candidate = text(value);
  return /^v?\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(candidate) ? candidate : '';
}

function normalizeHostInfo(frame) {
  frame = frame || {};
  const hasDefaultModel = !!text(frame.defaultModel);
  return {
    version: version(frame.dshVersion) || version(frame.version),
    cwd: text(frame.cwd),
    provider: hasDefaultModel ? text(frame.defaultProvider) : text(frame.provider),
    model: hasDefaultModel ? text(frame.defaultModel) : text(frame.model),
    attachedSessions: frame.attachedSessions,
    canOpenPath: frame.canOpenPath
  };
}

function hostDisplay(app) {
  const host = normalizeHostInfo(app.host);
  const saved = app.defaultModel || {};
  // 默认模型更新独立于 host 帧；provider/model 必须来自同一份选择，不能跨服务商拼接。
  const selected = text(saved.model) ? { provider: text(saved.provider), model: text(saved.model) } : host;
  const groups = (app.modelCatalog && app.modelCatalog.groups) || [];
  const group = groups.find(item => item.id === selected.provider);
  const model = group && (group.models || []).find(item => item.id === selected.model);
  return {
    version: host.version || '未提供',
    provider: (group && text(group.name)) || selected.provider || '未提供',
    model: (model && text(model.name)) || selected.model || '未提供'
  };
}

module.exports = { normalizeHostInfo, hostDisplay };
