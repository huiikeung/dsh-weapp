// DSH desktop command menu order; only expose commands advertised by the Host.
const ADD = ['goal', 'plan', 'feedback'];
const COMMANDS = ['compact', 'permission', 'model', 'export'];
const FACES = {
  goal: ['目标', '设置或查看长期任务目标', 'dsh-goal'],
  plan: ['计划', '进入或退出计划模式', 'dsh-plan'],
  feedback: ['反馈', '发送关于当前会话的反馈', 'dsh-question'],
  compact: ['压缩', '压缩以上对话内容', 'dsh-context'],
  permission: ['权限', '切换权限预设（沙箱模式与审批策略）', 'dsh-agent'],
  model: ['模型', '选择当前会话的模型', 'dsh-code'],
  export: ['下载日志', '将当前会话内容导出为 ZIP', 'dsh-read']
};
function commands(groups) {
  const items = [];
  (groups || []).forEach(group => (group.items || []).forEach(item => {
    if (item && typeof item.name === 'string' && item.ui && ['input', 'select', 'immediate'].includes(item.ui.kind)) {
      items.push(Object.assign({}, item, { id: item.id || (item.source || group.id || 'command') + ':' + item.name, groupId: group.id, groupTitle: group.title }));
    }
  }));
  return items;
}
function acceptsAttachments(command) {
  return !command || !!((command.ui && command.ui.images === true) || (command.input && (command.input.images === true || command.input.attachments === true)));
}
function catalog(groups, options) {
  const { t, dark, query = '', leading = true, canAttach = true } = options;
  const all = commands(groups).filter(item => leading || item.ui.kind !== 'input');
  const row = item => {
    const face = item.source === 'skill' ? null : FACES[item.name];
    return { id: item.id, name: item.name, label: face ? t(face[0]) : '/' + item.name, description: face ? t(face[1]) : item.description || '',
      searchText: [item.name, item.description, item.whenToUse, face && face[0], face && t(face[0])].filter(Boolean).join(' ').toLowerCase(),
      icon: (face ? face[2] : item.source === 'skill' ? 'dsh-plugin' : 'dsh-code') + (dark ? '-dark' : '') + '.svg', hasOptions: item.ui.kind === 'select', action: '' };
  };
  const pick = names => names.flatMap(name => all.filter(item => item.source !== 'skill' && item.name === name).map(row));
  const sections = [
    { id: 'add', title: t('添加'), items: (canAttach ? [{ id: 'local:file', name: 'file', label: t('文件'), description: t('添加图片或引用工作区文件'), searchText: 'file image photo 文件 图片 附件', icon: 'paperclip-gray.png', action: 'file', hasOptions: true }] : []).concat(pick(ADD)) },
    { id: 'commands', title: t('指令'), items: pick(COMMANDS).concat(all.filter(item => item.source !== 'skill' && !ADD.concat(COMMANDS).includes(item.name)).map(row)) },
    { id: 'skills', title: t('技能'), items: all.filter(item => item.source === 'skill').map(row) }
  ];
  const filter = query.trim().toLowerCase();
  return sections.map(group => Object.assign({}, group, { items: group.items.filter(item => !filter || (item.searchText + ' ' + item.description).toLowerCase().includes(filter)) })).filter(group => group.items.length);
}
function inputDraft(command, draft) {
  const text = String(draft || '');
  const body = text.startsWith('/') ? text.replace(/^\/\S*\s*/, '') : text;
  return (command.ui.insertText || '/' + command.name + ' ').trimEnd() + ' ' + body;
}
function optionTitle(name, t) {
  return FACES[name] ? t(FACES[name][0]) : '/' + name;
}
function modelFace(catalog, selection = {}) {
  selection = selection || {};
  const group = ((catalog && catalog.groups) || []).find(g => (!selection.provider || g.id === selection.provider) && (g.models || []).some(m => m.id === selection.model));
  const model = group && group.models.find(m => m.id === selection.model);
  const label = model && (model.name || model.id) || selection.model || selection.provider || '';
  // Same release badge identity as DSH's deepseek-model-label-1017 plugin.
  const badge = group && ['deepseek-account', 'deepseek-official'].includes(group.id) && selection.model === 'deepseek-flash' && label === 'DeepSeek-V4.1-Flash' ? '1017' : '';
  return { label, badge };
}
function optionRows(name, options, { t, query = '' }) {
  const presets = { 'read-only': '仅可查看', 'workspace-write': '工作区内修改', 'danger-full-access': '完全权限', auto: '自动审查' };
  const filter = query.trim().toLowerCase();
  return (options || []).map(option => {
    const preset = name === 'permission' && Object.prototype.hasOwnProperty.call(presets, option.id) ? presets[option.id] : '';
    const auto = name === 'permission' && option.id === 'auto';
    return { id: option.id, label: preset ? t(preset) : option.label || option.id,
      detail: auto ? t('无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。') : t(option.description || option.detail || ''),
      badge: auto ? 'EXP' : option.badge || '', selected: option.selected === true || option.active === true,
      searchText: [option.id, option.label, option.description, option.detail].filter(Boolean).join(' ') };
  }).filter(option => !filter || (option.label + ' ' + option.detail + ' ' + option.searchText).toLowerCase().includes(filter));
}
function fileReference(path) {
  const value = String(path || '').replace(/\\/g, '/');
  if (!value || /[\u0000-\u001f\u007f-\u009f"]/.test(value)) return '';
  return /\s/.test(value) ? '@"' + value + '"' : '@' + value;
}
function imageType(name) {
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' })[String(name || '').split(/[?#]/)[0].split('.').pop().toLowerCase()] || '';
}
module.exports = { commands, acceptsAttachments, catalog, inputDraft, optionTitle, optionRows, modelFace, fileReference, imageType };
