const { t: uiText } = require('../../../utils/ui-preferences');

function addCommas(value) {
  const parts = String(value).split('.');
  return Number(parts[0]).toLocaleString() + '.' + (parts[1] || '00');
}

function formatBalance(amount, symbol) {
  if (amount === null || amount === undefined || amount === '') return uiText('暂不可用');
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

function balanceText(balance) {
  if (Array.isArray(balance)) return walletText(balance);
  if (!balance || typeof balance !== 'object') return [];
  if (Array.isArray(balance.wallets)) return walletText(balance.wallets);
  const amountKey = ['rechargeBalance', 'toppedUp', 'topUpBalance', 'total', 'totalBalance', 'amount', 'balance']
    .find(key => balance[key] !== undefined && balance[key] !== null);
  if (amountKey) {
    const amount = balance[amountKey];
    const nestedAmount = amount && typeof amount === 'object'
      ? (amount.amount !== undefined ? amount.amount : amount.total)
      : amount;
    const currency = (amount && typeof amount === 'object' && amount.currency) || balance.currency;
    const symbol = currency === 'CNY' ? '¥' : '$';
    return [formatBalance(nestedAmount, symbol)];
  }
  return [];
}

function unwrapBalance(outcome) {
  if (!outcome || typeof outcome !== 'object') return null;
  const payload = outcome.value !== undefined && outcome.value !== null ? outcome.value
    : outcome.data !== undefined && outcome.data !== null ? outcome.data : null;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    return payload.currency || !outcome.currency ? payload : { ...payload, currency: outcome.currency };
  }
  if (payload !== null) return { total: payload, currency: outcome.currency };
  if (['rechargeBalance', 'toppedUp', 'topUpBalance', 'total', 'totalBalance', 'amount', 'balance']
    .some(key => outcome[key] !== undefined)) return outcome;
  return null;
}

function normalize(snapshot) {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const state = value.state && typeof value.state === 'object' ? value.state : {};
  const profileOutcome = value.profile;
  const profile = profileOutcome && profileOutcome.status === 'ready' ? profileOutcome.value
    : profileOutcome && !profileOutcome.status ? profileOutcome : null;
  const balanceOutcome = value.balance;
  const balance = unwrapBalance(balanceOutcome);
  const signedIn = state.signedIn === true || state.status === 'credential-stored';
  const wallets = balanceText(balance);
  const bonusSource = (balance && balance.bonusWallets) || (balanceOutcome && balanceOutcome.bonusWallets) || [];
  const bonusWallets = balance ? walletText((Array.isArray(bonusSource) ? bonusSource : []).filter(wallet => Number(wallet.balance) > 0)) : [];
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
    balanceText: signedIn && wallets.length ? wallets.join(' + ') : '',
    bonusBalance: signedIn && bonusWallets.length ? bonusWallets : [],
    balanceState: !signedIn ? 'signed-out' : value.balance === undefined ? 'loading' : balance ? 'ready' : 'unavailable',
    showBonusRow: signedIn && (value.balance === undefined || bonusWallets.length > 0),
    attempt: state.attempt || null,
    error: value.error || ''
  };
}

module.exports = { formatBalance, walletText, balanceText, normalize };
