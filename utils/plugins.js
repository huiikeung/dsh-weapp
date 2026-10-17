// 插件目录模型（对齐 dsh-mobile GatewayModels.swift 的
// MobilePluginBundle / MobilePluginEntry / MobilePluginRow /
// MobileOfficialPlugin / MobilePluginCatalog）。

// iOS hiddenPluginProfileBundles：运行档案类 bundle 不在移动端展示
const HIDDEN_PROFILE_BUNDLES = [
  '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-acp-app', '@deepseek-ai/dsh-sdk-minimal'
];

/** meta.title / meta.description 的多语言取值：字符串直取，对象按 zh → en → 首个。 */
function localizedText(value) {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object') {
    return value.zh || value['zh-CN'] || value.zhHans || value.en || Object.keys(value).map(function (k) { return value[k]; }).filter(function (v) { return typeof v === 'string' && v; })[0] || null;
  }
  return null;
}

function pluginError(raw) {
  const err = raw.error;
  if (err && typeof err === 'object') return err.diagnostic || err.code || null;
  if (typeof err === 'string' && err) return err;
  return null;
}

function parseBundle(raw) {
  if (!raw || typeof raw !== 'object' || !raw.name) return null;
  const name = raw.name;
  const optional = raw.optional === true;
  const installed = raw.installed === true;
  return {
    raw: raw,
    name: name,
    version: typeof raw.version === 'string' ? raw.version : null,
    enabled: raw.enabled === true,
    installed: installed,
    optional: optional,
    experimental: raw.experimental === true,
    readOnlyReason: typeof raw.readOnlyReason === 'string' ? raw.readOnlyReason : null,
    error: pluginError(raw),
    title: localizedText(raw.meta && raw.meta.title) || name,
    description: localizedText(raw.meta && raw.meta.description) || (typeof raw.description === 'string' ? raw.description : ''),
    icon: raw.meta && typeof raw.meta.icon === 'string' ? raw.meta.icon : null,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    visible: HIDDEN_PROFILE_BUNDLES.indexOf(name) < 0 && (installed || optional || !!pluginError(raw)),
    isOfficial: optional && !installed
  };
}

function parseEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.entryId || raw.id || '';
  if (!id) return null;
  return {
    raw: raw,
    id: id,
    name: localizedText(raw.meta && raw.meta.title) || raw.name || id,
    description: localizedText(raw.meta && raw.meta.description) || (typeof raw.description === 'string' ? raw.description : ''),
    enabled: raw.enabled === true,
    readOnlyReason: typeof raw.readOnlyReason === 'string' ? raw.readOnlyReason : null,
    icon: raw.meta && typeof raw.meta.icon === 'string' ? raw.meta.icon : null,
    fiberPhase: typeof raw.fiberPhase === 'string' ? raw.fiberPhase : null
  };
}

/** 运行条目行（静态 rows × live plugins 合并）。 */
function buildRow(rowRaw, liveEntry) {
  const entry = liveEntry || parseEntry(Object.assign({}, rowRaw, { id: rowRaw.entryId || rowRaw.rowId }));
  const id = rowRaw.rowId || (entry && entry.id) || '';
  const moduleName = typeof rowRaw.moduleName === 'string' ? rowRaw.moduleName : '';
  const enabled = !!(entry && entry.enabled);
  const phase = entry ? entry.fiberPhase : null;
  return {
    raw: rowRaw,
    id: id,
    entryID: typeof rowRaw.entryId === 'string' ? rowRaw.entryId : null,
    moduleName: moduleName,
    name: localizedText(rowRaw.meta && rowRaw.meta.title) || (entry ? entry.name : id),
    description: localizedText(rowRaw.meta && rowRaw.meta.description) || (entry ? entry.description : ''),
    icon: (rowRaw.meta && rowRaw.meta.icon) || (entry ? entry.icon : null) || null,
    enabled: enabled,
    phase: phase,
    readOnlyReason: entry ? entry.readOnlyReason : null,
    idAndModule: moduleName ? id + ' · ' + moduleName : id,
    statusText: !enabled ? '已停用' : ({
      active: '运行中',
      failed: '运行失败',
      loading: '加载中',
      unloading: '卸载中',
      pending: '待启动'
    }[phase] || '空闲')
  };
}

function parseOfficialItem(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const titles = { shell: '终端', 'agent-loop': 'Agent 循环', subagent: '子智能体', 'web-search': '网页搜索' };
  const descriptions = {
    shell: '限制每条命令最多能跑多久、最多输出多少内容。',
    'agent-loop': '控制 Agent 派发工具调用的方式。',
    subagent: '设置子智能体的递归层级、数量和模型。',
    'web-search': '设置 DeepSeek 的搜索提供方。'
  };
  return {
    raw: raw,
    id: raw.id,
    namespaces: Array.isArray(raw.namespaces) ? raw.namespaces.filter(function (n) { return typeof n === 'string'; }) : [],
    title: titles[raw.id] || raw.id,
    description: descriptions[raw.id] || ''
  };
}

function shortName(name) {
  let unscoped = String(name || '');
  if (unscoped.indexOf('@') === 0) {
    const parts = unscoped.split('/');
    unscoped = parts[parts.length - 1];
  }
  const prefixes = ['dsh-host-', 'dsh-client-', 'dsh-'];
  for (let i = 0; i < prefixes.length; i += 1) {
    if (unscoped.indexOf(prefixes[i]) === 0) return unscoped.slice(prefixes[i].length);
  }
  return unscoped;
}

function sortBundles(bundles) {
  return bundles.slice().sort(function (a, b) {
    const sa = shortName(a.name);
    const sb = shortName(b.name);
    const order = sa.localeCompare(sb);
    return order !== 0 ? order : (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  });
}

/** plugin-catalog 帧 → 目录对象（官方/已安装分组在本地完成）。 */
function buildCatalog(frame) {
  const bundles = (frame.bundles || []).map(parseBundle).filter(Boolean);
  return {
    managementAvailable: frame.managementAvailable === true,
    settingsWritable: frame.settingsWritable === true,
    bundles: bundles,
    plugins: (frame.plugins || []).map(parseEntry).filter(Boolean),
    officialItems: (frame.officialItems || []).map(parseOfficialItem).filter(Boolean),
    officialBundles: sortBundles(bundles.filter(function (b) { return b.visible && b.isOfficial; })),
    installedBundles: sortBundles(bundles.filter(function (b) { return b.visible && !b.isOfficial; }))
  };
}

module.exports = {
  localizedText: localizedText,
  parseBundle: parseBundle,
  parseEntry: parseEntry,
  buildRow: buildRow,
  parseOfficialItem: parseOfficialItem,
  buildCatalog: buildCatalog,
  shortName: shortName
};
