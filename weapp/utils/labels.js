// 展示文案映射，与 iOS L10n.swift 保持一致（预设、权限、思考等级）。

function presetModeName(id) {
  switch (id) {
    case 'standard': return '标准模式';
    case 'code': return 'PTC 模式';
    case 'minimal': return '极简模式';
    case 'cordis': return '创造模式';
    default: return id;
  }
}

function presetModeBlurb(id) {
  switch (id) {
    case 'standard': return '功能完整的编码 Agent，支持文件编辑、Shell、检索、Skills、计划与工作流。';
    case 'code': return '通过 Code Mode SDK 组合多步工具操作。';
    case 'minimal': return '精简工具集合，适合轻量、直接的编码任务。';
    case 'cordis': return '用于创建和维护自定义 Agent 预设。';
    default: return '由 DeepSeek Harness 提供的 Agent 预设。';
  }
}

// 权限盾牌图标（iOS ConversationView.permissionIcon 对齐）：
// danger-full-access→exclamationmark.shield / workspace-write→pencil.and.outline /
// read-only→checkmark.shield / 其他→shield
function permissionIconFile(value) {
  const v = value || '';
  if (v.indexOf('danger') >= 0) return 'shield-excla-gray';
  if (v.indexOf('workspace') >= 0) return 'shield-pencil-gray';
  if (v === 'read-only') return 'shield-check-gray';
  return 'shield-gray';
}

function permissionName(id) {
  switch (id) {
    case 'read-only': return '只读';
    case 'workspace-write': return '工作区写入';
    case 'danger-full-access': return '完全访问';
    default: return id;
  }
}

function reasoningEffortName(level) {
  switch (level) {
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    default: return level;
  }
}

module.exports = { presetModeName, presetModeBlurb, permissionName, permissionIconFile, reasoningEffortName };
