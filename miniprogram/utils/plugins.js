const { t: uiText } = require('./ui-preferences');
// 插件目录模型（对齐 dsh-mobile GatewayModels.swift 的
// MobilePluginBundle / MobilePluginEntry / MobilePluginRow /
// MobileOfficialPlugin / MobilePluginCatalog）。

// iOS hiddenPluginProfileBundles：运行档案类 bundle 不在移动端展示
const HIDDEN_PROFILE_BUNDLES = [
  '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-acp-app', '@deepseek-ai/dsh-sdk-minimal'
];

// Keep the desktop's primary experiments first; enabled More entries also appear here.
const PRIMARY_BUNDLES = [
  '@deepseek-ai/dsh-experimental-agent-team-profile',
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
  '@deepseek-ai/dsh-experimental-auto-review',
  '@deepseek-ai/dsh-experimental-inspector-profile'
];
const MORE_BUNDLES = [
  '@deepseek-ai/dsh-experimental-tool-worktree',
  '@deepseek-ai/dsh-experimental-cot-translation-bundle',
  '@deepseek-ai/dsh-experimental-terminal-bundle',
  '@deepseek-ai/dsh-experimental-session-search',
  '@deepseek-ai/dsh-experimental-session-titles-bundle',
  '@deepseek-ai/dsh-experimental-badge-skill-bundle',
  '@deepseek-ai/dsh-experimental-ralph-bundle',
  '@deepseek-ai/dsh-experimental-plugin-market-bundle',
  '@deepseek-ai/dsh-subagent-codex',
  '@deepseek-ai/dsh-subagent-claude-code'
];
const BUILTIN_ORDER = ['subagent', 'web-search', 'agent-loop', 'shell'];

function optionalRank(name) {
  const primary = PRIMARY_BUNDLES.indexOf(name);
  if (primary >= 0) return primary;
  const more = MORE_BUNDLES.indexOf(name);
  return more < 0 ? PRIMARY_BUNDLES.length : PRIMARY_BUNDLES.length + 1 + more;
}

/** meta.title / meta.description 的多语言取值：字符串直取，对象按 zh → en → 首个。 */
function localizedText(value) { return require('./ui-preferences').localized(value) || null; }

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
    availability: typeof raw.availability === 'string' ? raw.availability : null,
    installTarget: raw.installTarget && typeof raw.installTarget.spec === 'string' ? {
      spec: raw.installTarget.spec,
      version: typeof raw.installTarget.version === 'string' ? raw.installTarget.version : ''
    } : null,
    optional: optional,
    experimental: raw.experimental === true || name.startsWith('@deepseek-ai/dsh-experimental-'),
    sourceSpec: typeof raw.source === 'string' ? raw.source : null,
    readOnlyReason: typeof raw.readOnlyReason === 'string' ? raw.readOnlyReason : null,
    error: pluginError(raw),
    title: localizedText(raw.meta && raw.meta.title) || name,
    description: localizedText(raw.meta && raw.meta.description) || (typeof raw.description === 'string' ? raw.description : ''),
    icon: raw.meta && typeof raw.meta.icon === 'string' ? raw.meta.icon : null,
    rows: Array.isArray(raw.rows) ? raw.rows : [],
    visible: HIDDEN_PROFILE_BUNDLES.indexOf(name) < 0 && (installed || optional || raw.official === true || !!pluginError(raw)),
    isOfficial: typeof raw.official === 'boolean' ? raw.official : optional && !installed
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
    name: localizedText(rowRaw.meta && rowRaw.meta.title) || moduleName || (entry ? entry.name : id),
    description: localizedText(rowRaw.meta && rowRaw.meta.description) || (entry ? entry.description : ''),
    icon: (rowRaw.meta && rowRaw.meta.icon) || (entry ? entry.icon : null) || null,
    enabled: enabled,
    phase: phase,
    readOnlyReason: entry ? entry.readOnlyReason : null,
    idAndModule: moduleName ? id + ' · ' + moduleName : id,
    statusText: !enabled ? uiText('已停用') : ({
      active: uiText('运行中'),
      failed: uiText('运行失败'),
      loading: uiText('加载中'),
      unloading: uiText('卸载中'),
      pending: uiText('待启动')
    }[phase] || uiText('空闲'))
  };
}

function parseOfficialItem(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const titles = { shell: uiText('终端'), 'agent-loop': uiText('Agent 循环'), subagent: uiText('子智能体'), 'web-search': uiText('网页搜索') };
  const descriptions = {
    shell: uiText('限制每条命令最多能跑多久、最多输出多少内容。'),
    'agent-loop': uiText('控制 Agent 派发工具调用的方式。'),
    subagent: uiText('设置子智能体的递归层级、数量和模型。'),
    'web-search': uiText('设置 DeepSeek 的搜索提供方。')
  };
  return {
    raw: raw,
    id: raw.id,
    // 图标由网关按 DSH 客户端注册表下发
    icon: typeof raw.icon === 'string' ? raw.icon : null,
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
  const official = bundles.filter(function (b) { return b.visible && b.isOfficial; })
    .sort(function (a, b) { return optionalRank(a.name) - optionalRank(b.name); });
  return {
    source: frame,
    managementAvailable: frame.managementAvailable === true,
    settingsWritable: frame.settingsWritable === true,
    // 网关下发的默认插件图标（DSH 客户端同款），插件自身无图标时使用
    defaultPluginIcon: typeof frame.defaultPluginIcon === 'string' ? frame.defaultPluginIcon : null,
    bundles: bundles,
    plugins: (frame.plugins || []).map(parseEntry).filter(Boolean),
    officialItems: (frame.officialItems || []).map(parseOfficialItem).filter(Boolean)
      .sort(function (a, b) {
        const ai = BUILTIN_ORDER.indexOf(a.id), bi = BUILTIN_ORDER.indexOf(b.id);
        return (ai < 0 ? BUILTIN_ORDER.length : ai) - (bi < 0 ? BUILTIN_ORDER.length : bi);
      }),
    officialBundles: official,
    featuredBundles: official.filter(function (b) { return MORE_BUNDLES.indexOf(b.name) < 0 || b.enabled; }),
    moreBundles: official,
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
