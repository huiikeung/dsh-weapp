// Display-only projection: public endpoints and credentials never enter the sheet.
const { isLocalHost } = require('./hosts');
const STATUS = { disconnected: '未连接', connecting: '连接中', connected: '已连接', failed: '连接失败' };

function nodePresentation(profile, app) {
  if (!profile) return null;
  const active = profile.id === app.activeID;
  const endpoint = (active && app.endpoint) || profile.preferredEndpoint || (profile.endpoints || [])[0] || '';
  const address = /^(?:wss?|https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/i.exec(endpoint);
  const isPublic = !!profile.relay || !!(address && !isLocalHost(address[1]));
  const rawName = profile.alias || profile.gatewayName || '未命名节点';
  const name = isPublic && (/\b(?:wss?|https?):\/\//i.test(rawName) || address && rawName.includes(address[1])) ? '公网节点' : rawName;
  const connection = active ? app.connection || 'disconnected' : 'disconnected';
  return {
    id: profile.id,
    identifier: profile.gatewayId || profile.id,
    name,
    active,
    isPublic,
    endpoint: isPublic ? '' : endpoint,
    port: isPublic ? '' : (address && address[2]) || (active && app.port) || '',
    connection,
    connectionLabel: active ? STATUS[connection] || '未连接' : '未连接此节点',
    canDisconnect: active && (connection === 'connected' || connection === 'connecting'),
    canPing: active && connection === 'connected'
  };
}

module.exports = { nodePresentation };
