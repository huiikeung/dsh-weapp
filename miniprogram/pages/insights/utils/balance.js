// Insights page head capsule: reduce the gateway `account` frame to the
// DeepSeek balance shown by dsh-context (balanceCapsule.ts / balance.ts).
// The frame is the same one used by 设置 → 账号与余额; when the host has no
// account service (old gateway) or nobody is signed in, the capsule hides.

const CURRENCY_SYMBOLS = { CNY: '¥', USD: '$' };

function symbolOf(currency) {
  return CURRENCY_SYMBOLS[String(currency || '').toUpperCase()] || '$';
}

function amountText(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';
  const symbol = symbolOf(currency);
  if (value < 0) return '-' + symbol + Math.abs(value).toFixed(2);
  if (value > 0 && value < 0.01) return '<' + symbol + '0.01';
  return symbol + value.toFixed(2);
}

function walletRows(wallets) {
  return (Array.isArray(wallets) ? wallets : []).map((wallet) => {
    if (!wallet || typeof wallet !== 'object') return null;
    const text = amountText(wallet.balance, wallet.currency);
    return text === '' ? null : { currency: String(wallet.currency || '').toUpperCase(), text };
  }).filter(Boolean);
}

function unwrapBalance(outcome) {
  if (!outcome || typeof outcome !== 'object') return null;
  const payload = outcome.value !== undefined && outcome.value !== null ? outcome.value
    : outcome.data !== undefined && outcome.data !== null ? outcome.data : null;
  if (Array.isArray(payload)) return { wallets: payload };
  if (payload && typeof payload === 'object') {
    return payload.currency || !outcome.currency ? payload : { ...payload, currency: outcome.currency };
  }
  if (payload !== null) return { wallets: [{ balance: payload, currency: outcome.currency }] };
  const amountKey = ['rechargeBalance', 'toppedUp', 'topUpBalance', 'total', 'totalBalance', 'amount', 'balance']
    .find((key) => outcome[key] !== undefined && outcome[key] !== null);
  return amountKey ? outcome : null;
}

function walletsOf(balance) {
  if (!balance) return [];
  if (Array.isArray(balance.wallets)) return balance.wallets;
  const amountKey = ['rechargeBalance', 'toppedUp', 'topUpBalance', 'total', 'totalBalance', 'amount', 'balance']
    .find((key) => balance[key] !== undefined && balance[key] !== null);
  if (!amountKey) return [];
  const amount = balance[amountKey];
  return [{
    currency: (amount && typeof amount === 'object' ? amount.currency : undefined) || balance.currency,
    balance: amount && typeof amount === 'object'
      ? (amount.amount !== undefined ? amount.amount : amount.total)
      : amount
  }];
}

/** rows: [{ kind: 'recharge' | 'bonus', text }] — labels are localized by the page. */
function normalize(snapshot) {
  const frame = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const state = frame.state && typeof frame.state === 'object' ? frame.state : {};
  const signedIn = state.signedIn === true || state.status === 'credential-stored';
  const balance = unwrapBalance(frame.balance);
  const bonusSource = (balance && balance.bonusWallets)
    || (frame.balance && typeof frame.balance === 'object' ? frame.balance.bonusWallets : null)
    || [];
  const recharge = walletRows(walletsOf(balance));
  const bonus = walletRows(bonusSource).filter((wallet) => Number(String(wallet.text).replace(/[^\d.]/g, '')) > 0);
  const rows = recharge.map((wallet) => ({ kind: 'recharge', text: wallet.text }))
    .concat(bonus.map((wallet) => ({ kind: 'bonus', text: wallet.text })));
  return {
    signedIn,
    visible: signedIn && rows.length > 0,
    text: rows.length ? rows.map((row) => row.text).join(' + ') : '',
    rows,
    usageUrl: typeof state.links === 'object' && state.links && typeof state.links.usageUrl === 'string'
      ? state.links.usageUrl : ''
  };
}

module.exports = { normalize, amountText };
