/**
 * Cost Meter presentation helpers for the mini program.
 * Small, self-contained — zero external deps, works in both V8 and JSC.
 */

const UNITS = {
  CNY: { symbol: '¥', locale: 'zh-CN' },
  USD: { symbol: '$', locale: 'en-US' },
  EUR: { symbol: '€', locale: 'de-DE' }
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function formatCurrency(amount, currency) {
  const u = UNITS[currency] || UNITS.CNY;
  const val = Number.isFinite(amount) ? amount : 0;
  // 小程序不保证 Intl 完整，用简单格式化避免异常
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  let intPart = Math.floor(abs);
  let frac = Math.round((abs - intPart) * 100);
  if (frac === 100) { intPart += 1; frac = 0; }
  const intStr = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = String(frac).padStart(2, '0');
  return sign + u.symbol + intStr + '.' + fracStr;
}

function formatTokens(n) {
  const v = Number.isFinite(n) ? n : 0;
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(v));
}

function formatPercent(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '--';
  if (p >= 100) return '≥100%';
  return p.toFixed(1) + '%';
}

function formatRelativeTime(ts) {
  if (!Number.isFinite(ts)) return '--';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  const d = new Date(ts);
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/**
 * Normalize bridge summary into the view model used by home drawer / plugin detail.
 * Returns:
 *   {
 *     currency, today:{amount,amountFmt,tokens,tokensFmt,calls}, month:..., total:...,
 *     budget:{enabled,amount,amountFmt,period,used,usedFmt,percent,percentFmt},
 *     balance:{status,currency,total,totalFmt,granted,grantedFmt,toppedUp,toppedUpFmt,fetchedAt,fetchedAtFmt},
 *     updatedAt,updatedAtFmt
 *   }
 */
function normalize(summary) {
  if (!summary || !summary.available) return null;
  const cur = summary.currency || 'CNY';
  const today = summary.today ? { ...summary.today, amountFmt: formatCurrency(summary.today.amount, cur), tokensFmt: formatTokens(summary.today.tokens) } : null;
  const month = summary.month ? { ...summary.month, amountFmt: formatCurrency(summary.month.amount, cur), tokensFmt: formatTokens(summary.month.tokens) } : null;
  const total = summary.total ? { ...summary.total, amountFmt: formatCurrency(summary.total.amount, cur), tokensFmt: formatTokens(summary.total.tokens) } : null;
  const budget = summary.budget ? {
    ...summary.budget,
    amountFmt: formatCurrency(summary.budget.amount, cur),
    usedFmt: formatCurrency(summary.budget.used, cur),
    percentFmt: formatPercent(summary.budget.percent)
  } : null;
  const balance = summary.balance ? {
    ...summary.balance,
    totalFmt: formatCurrency(summary.balance.total, summary.balance.currency || cur),
    grantedFmt: formatCurrency(summary.balance.granted, summary.balance.currency || cur),
    toppedUpFmt: formatCurrency(summary.balance.toppedUp, summary.balance.currency || cur),
    fetchedAtFmt: formatRelativeTime(summary.balance.fetchedAt)
  } : null;
  return {
    currency: cur,
    today, month, total,
    budget, balance,
    updatedAt: summary.updatedAt,
    updatedAtFmt: formatRelativeTime(summary.updatedAt)
  };
}

/**
 * Normalize bridge config into settings view model.
 * Returns:
 *   { currency, budget:{enabled,amount,amountFmt,period,customStart,customEnd}, balance:{display}, hideBudget, showTotalWithPlan, locale, includeSubagentCost }
 */
function normalizeConfig(config, currencyForFmt) {
  if (!config) return null;
  const cur = config.currency || 'CNY';
  return {
    currency: cur,
    budget: config.budget ? {
      ...config.budget,
      amountFmt: formatCurrency(config.budget.amount, cur)
    } : { enabled: false, amount: 0, amountFmt: formatCurrency(0, cur), period: 'month' },
    balance: config.balance || { display: 'both' },
    hideBudget: !!config.hideBudget,
    showTotalWithPlan: !!config.showTotalWithPlan,
    locale: config.locale || 'auto',
    includeSubagentCost: !!config.includeSubagentCost
  };
}

/**
 * Validate a config patch coming from the UI before sending to bridge.
 * Returns { ok: true, patch } or { ok: false, message }.
 */
function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, message: 'patch 必须是对象' };
  const errors = [];
  if (patch.currency !== undefined && !['CNY', 'USD', 'EUR'].includes(patch.currency)) errors.push('currency 必须是 CNY、USD 或 EUR');
  if (patch.budget !== undefined) {
    const b = patch.budget;
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (b.enabled !== undefined && typeof b.enabled !== 'boolean') errors.push('budget.enabled 必须是布尔值');
      if (b.amount !== undefined && (!Number.isFinite(b.amount) || b.amount < 0)) errors.push('budget.amount 必须是非负数');
      if (b.period !== undefined && !['day', 'month', 'all', 'custom'].includes(b.period)) errors.push('budget.period 必须是 day、month、all 或 custom');
    }
  }
  if (patch.balance !== undefined && patch.balance !== null) {
    if (patch.balance.display !== undefined && !['sidebar', 'settings', 'both', 'off'].includes(patch.balance.display)) errors.push('balance.display 必须是 sidebar、settings、both 或 off');
  }
  if (patch.hideBudget !== undefined && typeof patch.hideBudget !== 'boolean') errors.push('hideBudget 必须是布尔值');
  if (patch.showTotalWithPlan !== undefined && typeof patch.showTotalWithPlan !== 'boolean') errors.push('showTotalWithPlan 必须是布尔值');
  return { ok: errors.length === 0, message: errors.join('；') || null, patch: errors.length === 0 ? patch : undefined };
}

module.exports = {
  UNITS, formatCurrency, formatTokens, formatPercent, formatRelativeTime,
  normalize, normalizeConfig, validatePatch
};