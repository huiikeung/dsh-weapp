const { t: uiText } = require('../../../utils/ui-preferences');
const { connectionView } = require('../../../utils/connection-status');
const { isLocalHost } = require('../../../utils/hosts');

/** 版本号规整：'0.21.0' / 'v0.21.0' → 'v0.21.0'。 */
function versionLabel(value) {
  const text = String(value || '').trim();
  const match = /^v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(text);
  return match ? 'v' + match[1] : '';
}

/** 传输方式：中继节点 → 公网中继；非本机地址 → 公网直连；其余 → 局域网直连。 */
function transportLabel(profile, endpoint) {
  if (!profile) return '';
  if (profile.relay) return uiText('公网中继');
  const address = /^(?:wss?|https?):\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(String(endpoint || ''));
  const host = address ? address[1] : '';
  if (host && !isLocalHost(host)) return uiText('公网直连');
  return uiText('局域网直连');
}

/** 状态标签与色阶：已连接=绿、连接中=琥珀、断链/失败=红或橙、未连接=灰。 */
function statusOf(view) {
  const key = view && view.key ? view.key : 'disconnected';
  if (key === 'connected') return { label: uiText('运行正常'), tone: 'ok' };
  if (key === 'connecting') return { label: uiText('正在连接'), tone: 'warn' };
  if (key === 'dropped') return { label: uiText('连接中断'), tone: 'bad' };
  if (key === 'failed') return { label: uiText('连接失败'), tone: 'bad' };
  return { label: uiText('未连接'), tone: 'off' };
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '0';
}

/**
 * 设置页「连接」卡片投影：主机名、传输方式、状态胶囊、网关版本、统计行。
 * 纯函数，便于单测；不包含任何公网地址或凭据。
 */
function connectionCardView(app, options) {
  const source = app || {};
  const opts = options || {};
  const profiles = Array.isArray(source.profiles) ? source.profiles : [];
  const active = profiles.find(profile => profile && profile.id === source.activeID) || null;
  const view = connectionView(source);
  const status = statusOf(view);
  const endpoint = source.endpoint || (active && active.preferredEndpoint) || (active && (active.endpoints || [])[0]) || '';
  const transport = active ? transportLabel(active, endpoint) : '';
  // 网关版本：优先用网关自报，其次插件目录里同名插件包的版本（旧网关不回报版本）。
  let version = versionLabel(source.gatewayMetadata && source.gatewayMetadata.version);
  if (!version) {
    const bundles = (source.pluginCatalog && source.pluginCatalog.bundles) || [];
    const name = source.gatewayMetadata && source.gatewayMetadata.name;
    const candidate = bundles.find(item => item && (name ? item.name === name : /gateway/.test(item.name || '')) && versionLabel(item.version));
    if (candidate) version = versionLabel(candidate.version);
  }
  const name = (active && (active.alias || active.gatewayName)) || uiText('未命名节点');
  // 插件数量：插件目录里未禁用的条目数。
  const bundles = (source.pluginCatalog && source.pluginCatalog.bundles) || [];
  const plugins = bundles.filter(item => item && item.enabled !== false).length;
  return {
    name,
    subtitle: [transport, view.label].filter(Boolean).join(' · '),
    statusLabel: status.label,
    statusTone: status.tone,
    versionLabel: version || uiText('版本未上报'),
    versionKnown: !!version,
    stats: [
      { key: 'sessions', label: uiText('会话'), value: count((source.sessions || []).length) },
      { key: 'workspaces', label: uiText('工作区'), value: count((source.workspaces || []).length) },
      { key: 'tasks', label: uiText('定时任务'), value: count((source.scheduledTasks || []).length) },
      // 统计行只放数字：公网访问状态已在下方的入口行里展示，这里用插件数量。
      { key: 'plugins', label: uiText('插件'), value: count(plugins) },
      { key: 'nodes', label: uiText('节点'), value: count(profiles.length) }
    ]
  };
}

module.exports = { connectionCardView, transportLabel, versionLabel, statusOf };
