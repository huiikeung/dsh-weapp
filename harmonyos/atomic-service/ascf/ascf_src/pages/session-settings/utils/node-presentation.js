const { t: uiText } = require('../../../utils/ui-preferences');
// Display-only projection: public endpoints and credentials never enter the sheet.
const { isLocalHost } = require('../../../utils/hosts');
const STATUS = { disconnected: uiText('未连接'), connecting: uiText('连接中'), connected: uiText('已连接'), failed: uiText('连接失败') };

function nodePresentation(profile, app) {
  if (!profile) return null;
  const active = profile.id === app.activeID;
  const endpoint = (active && app.endpoint) || profile.preferredEndpoint || (profile.endpoints || [])[0] || '';
  const address = /^(?:wss?|https?):\/\/(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?/i.exec(endpoint);
  const isPublic = !!profile.relay || !!(address && !isLocalHost(address[1]));
  const rawName = profile.alias || profile.gatewayName || uiText('未命名节点');
  const name = isPublic && (/\b(?:wss?|https?):\/\//i.test(rawName) || address && rawName.includes(address[1])) ? uiText('公网节点') : rawName;
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
    connectionLabel: active ? STATUS[connection] || uiText('未连接') : uiText('未连接此节点'),
    canDisconnect: active && (connection === 'connected' || connection === 'connecting'),
    canPing: active && connection === 'connected'
  };
}

module.exports = { nodePresentation };
