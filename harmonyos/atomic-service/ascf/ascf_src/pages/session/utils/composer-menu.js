// DSH desktop command menu order; only expose commands advertised by the Host.
const util = require('../../../utils/util');
const ADD = ['goal', 'plan'];
const COMMANDS = ['compact', 'permission', 'model'];
const HIDDEN_COMMANDS = ['feedback', 'export'];
// 输入框引用 chip：草稿（draft）保存原始引用文本，textarea 的显示值里引用位置
// 只放一个零宽占位符，chip 行负责渲染「图标 + 标题」。零宽字符不占宽度，
// 光标与原生输入行为都不受影响；删除占位符即移除对应引用。
const REF_PLACEHOLDER = '\u200B';
const REF_ICONS = {
  session: 'menu-chat-session-blue.svg',
  folder: 'menu-folder-blue.svg',
  file: 'menu-chat-file-blue.svg'
};
const FACES = {
  goal: ['目标', '设置或查看长期任务目标', 'dsh-goal'],
  plan: ['计划', '进入或退出计划模式', 'dsh-plan'],
  feedback: ['反馈', '发送关于当前会话的反馈', 'dsh-question'],
  compact: ['压缩', '压缩以上对话内容', 'command-compact-progress'],
  permission: ['权限', '切换权限预设（沙箱模式与审批策略）', 'command-permission'],
  model: ['模型', '选择当前会话的模型', 'command-model'],
  export: ['下载日志', '将当前会话内容导出为 ZIP', 'command-export']
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
  const { t, dark, query = '', leading = true, canAttach = true, includeSkills = true } = options;
  const all = commands(groups).filter(item => (leading || item.ui.kind !== 'input') && !HIDDEN_COMMANDS.includes(item.name));
  const row = item => {
    const face = item.source === 'skill' ? null : FACES[item.name];
    return { id: item.id, name: item.name, label: face ? t(face[0]) : '/' + item.name, description: face ? t(face[1]) : item.description || '',
      searchText: [item.name, item.description, item.whenToUse, face && face[0], face && t(face[0])].filter(Boolean).join(' ').toLowerCase(),
      icon: (face ? face[2] : item.source === 'skill' ? 'dsh-plugin' : 'dsh-code') + (dark ? '-dark' : '') + '.svg', hasOptions: item.ui.kind === 'select', action: '' };
  };
  const pick = names => names.flatMap(name => all.filter(item => item.source !== 'skill' && item.name === name).map(row));
  // Every attachment source opens directly from the + first level; there is no attachment sub-page.
  const attachRows = canAttach ? [
    { id: 'local:image', name: 'image', label: t('添加图片'), description: t('从相册或相机选择'), searchText: 'image photo album camera 图片 相册 拍照 添加图片', icon: 'menu-image.svg', action: 'image', hasOptions: false },
    { id: 'local:chat-image', name: 'chatImage', label: t('聊天中的图片'), description: t('从聊天记录选择图片'), searchText: 'chat image 聊天 图片 相册 记录', icon: 'menu-chat-image.svg', action: 'chatImage', hasOptions: false },
    { id: 'local:workspace', name: 'workspace', label: t('工作区文件'), description: t('引用远端工作区文件'), searchText: 'workspace file 工作区 文件 引用 目录', icon: 'menu-folder.svg', action: 'workspace', hasOptions: false },
    { id: 'local:chat-file', name: 'chatFile', label: t('聊天中的文件'), description: t('从聊天记录选择文件'), searchText: 'chat file 聊天 文件 记录 附件', icon: 'menu-chat-file.svg', action: 'chatFile', hasOptions: false },
    { id: 'local:external-file', name: 'externalFile', label: t('外部文件'), description: t('导入手机文件并上传到会话'), searchText: 'external upload file 外部 手机 文件 上传 导入', icon: 'menu-external-file.svg', action: 'externalFile', hasOptions: false }
  ] : [];
  const sections = [
    { id: 'add', title: t('添加'), items: attachRows.concat(pick(ADD)) },
    { id: 'commands', title: t('指令'), items: pick(COMMANDS).concat(all.filter(item => item.source !== 'skill' && !ADD.concat(COMMANDS).includes(item.name)).map(row)) },
    { id: 'skills', title: t('技能'), items: includeSkills ? all.filter(item => item.source === 'skill').map(row) : [] }
  ];
  const filter = query.trim().toLowerCase();
  return sections.map(group => Object.assign({}, group, { items: group.items.filter(item => !filter || (item.searchText + ' ' + item.description).toLowerCase().includes(filter)) })).filter(group => group.items.length);
}
function inputDraft(command, draft) {
  const text = String(draft || '');
  const body = text.startsWith('/') ? text.replace(/^\/\S*\s*/, '') : text;
  return (command.ui.insertText || '/' + command.name + ' ').trimEnd() + ' ' + body;
}
/** Slash-command presentation for the composer: blue token + gray argument hint
 *  (mirrors dsh-mobile slashCommandComposerPresentation). Only input-kind
 *  commands carry a token with a hint; plain commands execute immediately. */
function presentation(draft, commands) {
  const text = String(draft || '');
  if (text.charAt(0) !== '/') return null;
  for (const command of commands || []) {
    if (!command || !command.ui || command.ui.kind !== 'input') continue;
    const token = String(command.ui.insertText || ('/' + command.name)).replace(/\s+$/, '');
    if (text === token || text.indexOf(token + ' ') === 0) {
      return { command, token, argument: text === token ? '' : text.slice(token.length + 1) };
    }
  }
  return null;
}
function commandLabel(command, t) {
  const face = command && command.source !== 'skill' ? FACES[command.name] : null;
  return face ? '/' + t(face[0]) : '/' + (command && command.name || '');
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
function referenceAtCursor(text, cursor) {
  const value = String(text || '');
  const point = Math.max(0, Math.min(value.length, Number.isInteger(cursor) ? cursor : value.length));
  if (point === 0) return null;
  const at = value.lastIndexOf('@', Math.max(0, point - 1));
  // 引用 chip 的零宽占位符与空白一样切断 @ 查询：chip 后面新打的 @ 才是新引用。
  if (at < 0 || (at > 0 && !/\s/.test(value.charAt(at - 1)) && value.charAt(at - 1) !== REF_PLACEHOLDER)) return null;
  const beforeCursor = value.slice(at + 1, point);
  if (beforeCursor.startsWith('"')) {
    const close = value.indexOf('"', at + 2);
    if (close >= 0 && point > close) return null;
    const end = close >= 0 ? close + 1 : value.indexOf('\n', point) >= 0 ? value.indexOf('\n', point) : value.length;
    return { start: at, end, query: beforeCursor.slice(1), quoted: true };
  }
  if (/\s|"/.test(beforeCursor) || beforeCursor.indexOf(REF_PLACEHOLDER) >= 0) return null;
  let end = point;
  while (end < value.length && !/\s/.test(value.charAt(end)) && value.charAt(end) !== REF_PLACEHOLDER) end += 1;
  return { start: at, end, query: beforeCursor, quoted: false };
}
function fileReferencePrefix(path, preserveQuote) {
  const value = String(path || '').replace(/\\/g, '/');
  if (!value || /[\u0000-\u001f\u007f-\u009f"]/.test(value)) return '';
  const quoted = preserveQuote || /\s/.test(value);
  return quoted ? '@"' + value : '@' + value;
}
function sessionReference(sessionId, label) {
  const id = String(sessionId || '');
  if (!id) return '';
  const safeLabel = String(label || id).replace(/[\\\]]/g, '\\$&');
  return '@[' + safeLabel + '](dsh-session:' + util.encodeBase64URL(JSON.stringify(id)) + ')';
}
// 匹配 value 在 at 处的完整引用 token（会话 / 带引号路径 / 裸路径），与
// sessionReference / fileReference 的输出严格互为逆运算；不完整形态不匹配，
// 由 @ 菜单继续编辑（钻取目录时的半开 token 就是靠这一点保持字面文本）。
function matchReferenceAt(value, at) {
  const rest = value.slice(at);
  const session = /^@\[((?:[^\\\]]|\\.)*)\]\(dsh-session:([A-Za-z0-9\-_]+)\)/.exec(rest);
  if (session) {
    return { length: session[0].length, ref: { kind: 'session', label: session[1].replace(/\\([\\\]])/g, '$1'), raw: session[0] } };
  }
  const quoted = /^@"([^"\u0000-\u001f\u007f]*)"/.exec(rest);
  if (quoted) {
    const path = quoted[1];
    return { length: quoted[0].length, ref: { kind: path.slice(-1) === '/' ? 'folder' : 'file', label: path, raw: quoted[0] } };
  }
  // 裸路径不带空白 / 引号 / @，也不含方括号——后者是会话引用 @[label](dsh-session:…) 的
  // 形态，半截的会话引用必须保持字面文本，不能退化成文件 chip。
  const bare = /^@([^\s"@[\]]+)/.exec(rest);
  if (bare) {
    const path = bare[1];
    return { length: bare[0].length, ref: { kind: path.slice(-1) === '/' ? 'folder' : 'file', label: path, raw: bare[0] } };
  }
  return null;
}
// 切分原始草稿：segments 与 refs 交替（segments.length === refs.length + 1）。
// '@' 位于开头、空白之后，或紧接上一个引用 token——连续选两个引用时中间没有
// 空格（@a@b），第二个 '@' 也必须能开新引用，否则整段会粘成一个 token、
// 第二个引用退化成原始文本。与 referenceAtCursor 的锚点判定一致。
function parseReferences(text) {
  const value = String(text == null ? '' : text);
  const segments = [''];
  const refs = [];
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('@', i);
    if (at < 0) {
      segments[segments.length - 1] += value.slice(i);
      break;
    }
    if (at > 0 && at !== i && !/\s/.test(value.charAt(at - 1))) {
      segments[segments.length - 1] += value.slice(i, at + 1);
      i = at + 1;
      continue;
    }
    const match = matchReferenceAt(value, at);
    if (!match) {
      segments[segments.length - 1] += value.slice(i, at + 1);
      i = at + 1;
      continue;
    }
    segments[segments.length - 1] += value.slice(i, at);
    refs.push(match.ref);
    segments.push('');
    i = at + match.length;
  }
  return { segments, refs };
}
// 原始草稿 → textarea 显示值（引用位置换成零宽占位符）+ 引用 chips 原料。
function referencesToDisplay(text) {
  const { segments, refs } = parseReferences(text);
  return { display: segments.join(REF_PLACEHOLDER), refs };
}
// textarea 显示值 + refs → 原始草稿。占位符比 refs 少（用户删了 chip 对应
// 占位符）时，多出来的 refs 自然丢弃；占位符比 refs 多时忽略多出的部分。
function displayToDraft(display, refs) {
  const parts = String(display == null ? '' : display).split(REF_PLACEHOLDER);
  const list = Array.isArray(refs) ? refs : [];
  let out = parts[0] || '';
  for (let i = 1; i < parts.length; i += 1) {
    const ref = list[i - 1];
    if (ref && ref.raw) out += ref.raw;
    out += parts[i];
  }
  return out;
}
// 用户编辑显示值后对齐 refs：公共前缀/后缀定位改动区间，区间里的占位符
// 对应引用被删除（整段选中替换同理）；误入编辑区间的零宽字符直接清掉。
function applyDisplayEdit(prevDisplay, nextDisplay, refs) {
  const prev = String(prevDisplay == null ? '' : prevDisplay);
  const next = String(nextDisplay == null ? '' : nextDisplay);
  const list = Array.isArray(refs) ? refs : [];
  if (prev === next) return { display: next, refs: list };
  let prefix = 0;
  const max = Math.min(prev.length, next.length);
  while (prefix < max && prev.charAt(prefix) === next.charAt(prefix)) prefix += 1;
  let suffix = 0;
  while (suffix < max - prefix && prev.charAt(prev.length - 1 - suffix) === next.charAt(next.length - 1 - suffix)) suffix += 1;
  const prevMid = prev.slice(prefix, prev.length - suffix);
  const nextMid = next.slice(prefix, next.length - suffix);
  if (!prevMid && !nextMid) return { display: next, refs: list };
  let index = 0;
  for (let i = 0; i < prefix; i += 1) if (prev.charAt(i) === REF_PLACEHOLDER) index += 1;
  const removed = [];
  for (const ch of prevMid) {
    if (ch === REF_PLACEHOLDER) {
      removed.push(index);
      index += 1;
    }
  }
  const survivors = removed.length ? list.filter((_, i) => removed.indexOf(i) < 0) : list;
  const display = prev.slice(0, prefix) + nextMid.split(REF_PLACEHOLDER).join('') + prev.slice(prev.length - suffix);
  return { display, refs: survivors };
}
// refs → chip 行渲染数据（图标按引用类型；key 供 wx:for 差分）。
function referenceChips(refs) {
  return (Array.isArray(refs) ? refs : []).map((ref, index) => Object.assign({}, ref, {
    icon: REF_ICONS[ref.kind] || REF_ICONS.file,
    key: ref.kind + ':' + index + ':' + (ref.label || '')
  }));
}
function imageType(name) {
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' })[String(name || '').split(/[?#]/)[0].split('.').pop().toLowerCase()] || '';
}
module.exports = { commands, acceptsAttachments, catalog, inputDraft, presentation, commandLabel, optionTitle, optionRows, modelFace, fileReference, referenceAtCursor, fileReferencePrefix, sessionReference, imageType,
  REF_PLACEHOLDER, REF_ICONS, matchReferenceAt, parseReferences, referencesToDisplay, displayToDraft, applyDisplayEdit, referenceChips };
