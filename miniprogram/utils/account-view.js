const { t: uiText } = require('./ui-preferences');

function addCommas(value) {
  const parts = String(value).split('.');
  return Number(parts[0]).toLocaleString() + '.' + (parts[1] || '00');
}

function formatBalance(amount, symbol) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return uiText('暂不可用');
  if (value === 0) return symbol + '0.00';
  if (value < 0) return '-' + symbol + (value > -0.01 ? '0.01' : addCommas(Math.abs(value).toFixed(2)));
  if (value < 0.01) return '<' + symbol + '0.01';
  return symbol + addCommas((Math.floor(value * 100) / 100).toFixed(2));
}

function walletText(wallets) {
  return (Array.isArray(wallets) ? wallets : []).map(wallet => {
    const symbol = wallet && wallet.currency === 'CNY' ? '¥' : '$';
    return formatBalance(wallet && wallet.balance, symbol);
  });
}

function normalize(snapshot) {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const state = value.state && typeof value.state === 'object' ? value.state : {};
  const profileOutcome = value.profile;
  const profile = profileOutcome && profileOutcome.status === 'ready' ? profileOutcome.value : null;
  const balance = value.balance && value.balance.status === 'ready' ? value.balance : null;
  const signedIn = state.status === 'credential-stored';
  const wallets = balance ? walletText(balance.value) : [];
  const bonusWallets = balance ? walletText((balance.bonusWallets || []).filter(wallet => Number(wallet.balance) > 0)) : [];
  // 与 DSH 客户端 AccountSection 一致：名字行回落「已登录 DeepSeek」，状态行回落「账号资料暂不可用」/「加载中…」
  const profileUnavailable = uiText('账号资料暂不可用');
  const profileStatus = profile ? (profile.contact || profileUnavailable)
    : profileOutcome === undefined ? uiText('加载中…') : profileUnavailable;
  return {
    signedIn,
    name: signedIn ? ((profile && profile.name) || uiText('已登录 DeepSeek')) : uiText('尚未登录'),
    contact: signedIn ? ((profile && profile.contact) || '') : '',
    avatarUrl: signedIn && profile ? profile.avatarUrl || '' : '',
    status: signedIn ? profileStatus : uiText('登录 DeepSeek 账号以开始使用'),
    usageUrl: state.links && state.links.usageUrl || '',
    topUpUrl: state.links && state.links.topUpUrl || '',
    balance: signedIn && wallets.length ? wallets : [],
    bonusBalance: signedIn && bonusWallets.length ? bonusWallets : [],
    balanceState: !signedIn ? 'signed-out' : value.balance === undefined ? 'loading' : balance ? 'ready' : 'unavailable',
    showBonusRow: signedIn && (value.balance === undefined || bonusWallets.length > 0),
    attempt: state.attempt || null,
    error: value.error || ''
  };
}

module.exports = { formatBalance, walletText, normalize };
