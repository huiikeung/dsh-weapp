function identityBadge(account, translate) {
  const t = typeof translate === 'function' ? translate : value => value;
  if (!account || typeof account.isAdmin !== 'boolean') return t('待识别');
  if (account.isAdmin) return t('管理员');
  return t(account.publicAccess === true ? '已授权' : '未授权');
}

module.exports = { identityBadge };
