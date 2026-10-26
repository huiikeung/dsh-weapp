const { t: uiText } = require('./ui-preferences');
// 展示文案映射，与 iOS L10n.swift 保持一致（预设、权限、思考等级）。

function presetModeName(id) {
  switch (String(id || '')) {
    case 'standard': return uiText('标准模式');
    case 'code':
    case 'ptc': return uiText('PTC 模式');   // ptc 是 PTC 模式的另一个 id，不能回落成原始小写 id
    case 'minimal': return uiText('极简模式');
    case 'cordis': return uiText('创造模式');
    // 未知 id 也要带「模式」后缀：chip 位置窄，不能出现光秃秃的 id
    default: return id ? String(id) + ' ' + uiText('模式') : uiText('标准模式');
  }
}

/** 模式固定描述（对齐 iOS 模式选择 popover） */
function presetModeDesc(id) {
  switch (String(id || '')) {
    case 'standard': return uiText('完整工具，适合日常开发');
    case 'code':
    case 'ptc': return uiText('用代码组合多步工具操作');
    case 'minimal': return uiText('仅用 Shell，轻量直接');
    case 'cordis': return uiText('创建和调试自定义 Agent');
    default: return uiText('自定义 Agent 模式');
  }
}

/**
 * 预设展示名：网关自定义名优先；但名字原样等于 id（大小写不限，如 "ptc"）时
 * 退回本地化「xx模式」标签——保证模式后缀始终在、acronym 大写。
 */
function presetDisplayName(name, id) {
  const custom = String(name || '').trim();
  if (custom && custom.toLowerCase() !== String(id || '').trim().toLowerCase()) return custom;
  return presetModeName(id);
}

function presetModeBlurb(id) {
  switch (id) {
    case 'standard': return uiText('功能完整的编码 Agent，支持文件编辑、Shell、检索、Skills、计划与工作流。');
    case 'code': return uiText('通过 Code Mode SDK 组合多步工具操作。');
    case 'minimal': return uiText('精简工具集合，适合轻量、直接的编码任务。');
    case 'cordis': return uiText('用于创建和维护自定义 Agent 预设。');
    default: return uiText('由鲸尾 Harness 提供的 Agent 预设。');
  }
}

// 权限图标（对齐软件权限菜单）：
// read-only→盾牌✓ / workspace-write→盾牌+列表+铅笔斜笔（工作区内修改）/
// danger-full-access→盾牌! / auto→盾牌 A / 其他→盾牌
function permissionIconFile(value) {
  const v = String(value || '').toLowerCase().replace(/_/g, '-');
  if (v === 'auto') return 'shield-auto-gray.svg';
  if (v.indexOf('danger') >= 0) return 'shield-excla-gray.png';
  if (v.indexOf('workspace') >= 0) return 'shield-write-gray.png';
  if (v.indexOf('read') >= 0) return 'shield-check-gray.png';
  if (v === 'auto' || v === 'default' || v.indexOf('auto') >= 0) return 'shield-question-gray.png';
  return 'shield-gray.png';
}

function permissionName(id) {
  const v = String(id || '').toLowerCase().replace(/_/g, '-');
  if (v.indexOf('danger') >= 0 || v.indexOf('full-access') >= 0) return uiText('完全访问');
  if (v.indexOf('workspace') >= 0) return uiText('工作区写入');
  if (v.indexOf('read') >= 0) return uiText('只读');
  if (v === 'auto' || v === 'default' || v.indexOf('auto') >= 0) return uiText('自动审查');
  return '';
}

function reasoningEffortName(level) {
  const v = String(level || '').toLowerCase();
  if (v === 'off' || v === 'none' || v === 'disabled') return 'Off';
  if (v === 'minimal') return 'Minimal';
  if (v === 'low') return 'Low';
  if (v === 'medium') return 'Medium';
  if (v === 'high') return 'High';
    if (v === 'xhigh') return 'XHigh';
    if (v === 'max') return 'Max';
    if (v === 'ultra') return 'Ultra';
  return level;
}

function reasoningEffortDisplayName(level) {
  const v = String(level || '').toLowerCase();
  const localized = {
    off: '关闭推理', none: '关闭推理', disabled: '关闭推理',
    minimal: '极低', low: '低', medium: '中', high: '高',
    xhigh: '超高', max: '最大', ultra: '极致'
  }[v];
  return localized ? uiText(localized) : reasoningEffortName(level);
}

module.exports = { presetModeName, presetModeDesc, presetModeBlurb, presetDisplayName, permissionName, permissionIconFile, reasoningEffortName, reasoningEffortDisplayName };
