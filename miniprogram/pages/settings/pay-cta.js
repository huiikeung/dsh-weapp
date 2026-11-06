// 购买按钮文案判断（纯函数，便于测试）。
// 规则：账号从未开通过公网访问 → 立即开通；其余（管理员 / 有有效期 / 已过期 / 正在使用）→ 立即续期。

function everUsed(account, publicState, now) {
  const at = Number(now) || Date.now();
  const accountExpiry = Number(account && account.publicAccessExpiresAt) || 0;
  const relayExpiry = Number(publicState && publicState.expiresAt) || 0;
  if (account && account.isAdmin === true) return true;
  if (account && account.publicAccess === true) return true;
  if (accountExpiry > 0) return true;
  if (relayExpiry > 0) return true;
  if (publicState && publicState.gatewayMode && publicState.authorized) return true;
  if (publicState && publicState.publicOn === true) return true;
  // 过期也一样算「用过」：公网授权过期但 token 仍在时 authorized 为 true。
  if (publicState && publicState.authorized === true && relayExpiry > 0) return true;
  return false;
}

/** 返回字典 key：'立即开通' 或 '立即续期'。 */
function ctaKey(account, publicState, now) {
  return everUsed(account, publicState, now) ? '立即续期' : '立即开通';
}

module.exports = { ctaKey, everUsed };
