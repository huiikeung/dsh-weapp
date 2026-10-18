// 连接状态与商业授权能力是不同的概念，不能仅凭 invite token 判断公网是否可用。
function getPublicAccessState(profile, connection) {
  const relay = !!(profile && profile.relay);
  const gatewayMode = relay && profile.relayAuthMode === 'gateway';
  const connected = connection === 'connected';
  const owner = relay && !gatewayMode && profile.relayRole === 'owner';
  const expiresAt = Number(profile && profile.relayExpiresAt) || 0;
  const authorized = gatewayMode ? connected : !!(relay && profile.relayAccessToken);
  const expired = relay && expiresAt > 0 && expiresAt <= Date.now();
  const publicOn = authorized && !expired;
  const shareEnabled = publicOn && connected && owner;
  const shareReason = !relay ? '请先在节点管理中添加公网节点。'
    : gatewayMode ? '当前使用网关设备授权。已绑定的微信管理员可在设置「生成配对码」签发限时访问，普通用户不能自行分享。'
    : !connected ? '请先连接当前节点，再生成限时分享。'
    : !authorized || expired ? '当前邀请授权无效或已过期，请重新配对。'
    : !owner ? '只有当前节点的所有者可以生成邀请；微信管理员身份与节点所有权是独立的。' : '';
  return {
    publicOn, shareEnabled, shareReason, gatewayMode, expiresAt, authorized,
    isRelayOwner: owner,
    publicStatusLabel: expired ? '已到期' : gatewayMode ? (connected ? '已连接' : '未连接') : publicOn ? '已开通' : '未开通',
    publicTitle: expired ? '公网访问已到期' : gatewayMode ? (connected ? '公网连接正常' : '公网节点未连接') : publicOn ? '公网身份已建立' : '尚未开通公网访问',
    publicHint: gatewayMode ? shareReason : shareEnabled ? '可生成限时邀请供其他用户连接。兑换码由微信管理员在独立模块中管理。' : shareReason
  };
}
module.exports = { getPublicAccessState };
