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

function preciseAmount(value, unit, decimals) {
  if (!Number.isFinite(value)) return '—';
  const symbols = { CNY: '¥', USD: '$', EUR: '€', CREDITS: '' };
  const precision = Math.max(0, Math.min(6, Number.isInteger(decimals) ? decimals : 2));
  const abs = Math.abs(value).toFixed(precision).split('.');
  const integer = abs[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = precision ? '.' + abs[1] : '';
  const amount = (value < 0 ? '-' : '') + integer + fraction;
  return (symbols[unit] === undefined ? '' : symbols[unit]) + amount + (unit === 'CREDITS' ? ' Credits' : '');
}

function peakAt(at, windows, holidays, effectiveAt) {
  if (Number.isFinite(effectiveAt) && at < effectiveAt) return false;
  const beijing = new Date(at + 8 * 60 * 60 * 1000);
  const dateKey = beijing.toISOString().slice(0, 10);
  if (holidays.includes(dateKey) || beijing.getUTCDay() === 0 || beijing.getUTCDay() === 6) return false;
  const hour = new Date(at).getUTCHours();
  return windows.some(window => {
    const start = Number(window.start), end = Number(window.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  });
}

function peakProgress(peak, now) {
  if (!peak || peak.enabled !== true || !Array.isArray(peak.windows) || peak.windows.length === 0) return null;
  const effectiveAt = Date.parse(peak.effectiveAt || '');
  const holidays = Array.isArray(peak.holidays) ? peak.holidays : [];
  const hourMs = 60 * 60 * 1000;
  const start = Math.floor(now / hourMs) * hourMs - 9 * 24 * hourMs;
  let previous = null, next = null;
  let priorPhase = peakAt(start, peak.windows, holidays, effectiveAt);
  for (let at = start + hourMs; at <= start + 18 * 24 * hourMs; at += hourMs) {
    const phase = peakAt(at, peak.windows, holidays, effectiveAt);
    if (phase !== priorPhase) {
      if (at <= now) previous = { at, phase };
      else { next = { at, phase }; break; }
    }
    priorPhase = phase;
  }
  if (!next) return null;
  const current = peakAt(now, peak.windows, holidays, effectiveAt);
  const previousAt = previous ? previous.at : now;
  const percent = previous && next.at > previous.at
    ? Math.max(0, Math.min(100, (now - previousAt) / (next.at - previousAt) * 100)) : 0;
  const remainingMinutes = Math.max(0, Math.floor((next.at - now) / 60000));
  const remainingHours = Math.floor(remainingMinutes / 60);
  const remainingText = remainingHours >= 24
    ? `${Math.floor(remainingHours / 24)}天 ${remainingHours % 24}小时 ${remainingMinutes % 60}分`
    : `${remainingHours}小时 ${remainingMinutes % 60}分`;
  const date = new Date(next.at + 8 * 60 * 60 * 1000);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const timeText = `${weekdays[date.getUTCDay()]} ${String(date.getUTCHours()).padStart(2, '0')}:00`;
  return {
    label: current ? '峰时' : (holidays.includes(new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)) ? '节假日平价' : '平价'),
    inPeak: current,
    nextIntoPeak: next.phase,
    remainingText,
    switchText: `${timeText} 转${next.phase ? '峰时' : '平价'}`,
    progress: percent,
  };
}

function normalizeDashboard(dashboard, now = Date.now()) {
  if (!dashboard || typeof dashboard !== 'object') return null;
  const configCurrency = dashboard.currency === 'USD' ? 'USD' : 'CNY';
  const decimals = Number.isInteger(dashboard.decimals) ? dashboard.decimals : 2;
  const balance = dashboard.balance && typeof dashboard.balance === 'object' ? dashboard.balance : {};
  const balanceUnit = ['USD', 'CNY', 'EUR'].includes(balance.currency) ? balance.currency : configCurrency;
  const balanceView = balance.enabled ? {
    status: balance.status,
    label: '余额',
    amountText: balance.status === 'ok' ? preciseAmount(balance.totalBalance, balanceUnit, decimals) : '—',
    fetchedAt: balance.fetchedAt,
  } : null;
  const customBalances = (Array.isArray(dashboard.customBalances) ? dashboard.customBalances : [])
    .filter(row => row && row.enabled === true && row.display !== 'off')
    .map(row => {
      let amount = row.remaining;
      let unit = row.unit;
      if (row.convertToDisplayCurrency === true && unit === 'USD' && configCurrency === 'CNY') {
        amount *= Number(dashboard.exchangeRate) || 1;
        unit = 'CNY';
      }
      return {
        index: row.index,
        label: row.label || row.labelEn || '自定义余额',
        status: row.status,
        amountText: row.status === 'ok' ? preciseAmount(amount, unit, unit === 'CREDITS' ? 0 : 4) : '—',
      };
    });
  const go = dashboard.goQuota && typeof dashboard.goQuota === 'object' ? dashboard.goQuota : {};
  const key = ['weekly', 'monthly'].includes(go.main) ? go.main : 'rolling';
  const window = go[key];
  const rawPercent = window && Number.isFinite(window.percent) ? Math.max(0, Math.min(100, window.percent)) : null;
  const goPercent = rawPercent === null ? null : Math.round(rawPercent);
  const remaining = go.barDirection === 'remaining';
  const goView = go.enabled ? {
    status: go.status,
    configured: go.configured === true,
    label: `Go ${key === 'rolling' ? '5h' : key === 'weekly' ? '7d' : '30d'}`,
    percentText: goPercent === null ? '—' : `${remaining ? 100 - goPercent : goPercent}%`,
    barWidth: `${goPercent === null ? 0 : remaining ? 100 - goPercent : goPercent}%`,
    resetText: window && window.resetsAt ? `重置 ${formatRelativeTime(Date.parse(window.resetsAt))}` : '',
  } : null;
  const peak = peakProgress(dashboard.peak, now);
  const normalized = {
    balance: balanceView,
    customBalances,
    go: goView,
    peak: peak ? { ...peak, progressText: `${Math.round(peak.progress)}%` } : null,
  };
  normalized.hasContent = !!(balanceView || customBalances.length || goView || normalized.peak);
  return normalized;
}

const DEFAULT_DASHBOARD_PREFERENCES = Object.freeze({
  showBalance: true,
  showGo: true,
  showPeak: true,
  sidebarVisible: false,
  customBalances: {},
  style: 'compact',
});

function normalizeDashboardPreferences(value) {
  const input = value && typeof value === 'object' ? value : {};
  const customBalances = {};
  if (input.customBalances && typeof input.customBalances === 'object' && !Array.isArray(input.customBalances)) {
    Object.keys(input.customBalances).forEach(key => {
      if (/^\d+$/.test(key) && typeof input.customBalances[key] === 'boolean') customBalances[key] = input.customBalances[key];
    });
  }
  return {
    showBalance: input.showBalance !== false,
    showGo: input.showGo !== false,
    showPeak: input.showPeak !== false,
    // 左侧栏额度卡片的显示开关：默认关闭，开启后才请求并渲染卡片（按设备/主机保存在本地）。
    sidebarVisible: input.sidebarVisible === true,
    customBalances,
    style: input.style === 'standard' ? 'standard' : 'compact',
  };
}

/** 同一台主机（节点/端点）共用一个额度卡片显示偏好。 */
function dashboardOwner(state) {
  const value = state || {};
  return [value.activeID || '', value.gatewayId || '', value.endpoint || ''].join('|');
}

function dashboardPreferenceKey(owner) {
  return 'dsh.cost-meter.dashboard.' + encodeURIComponent(owner || '');
}

function readDashboardPreferences(owner, api) {
  const target = api || (typeof wx !== 'undefined' ? wx : null);
  let saved = null;
  if (target) {
    try { saved = target.getStorageSync(dashboardPreferenceKey(owner)); } catch (_) { /* 存储不可用时用默认值 */ }
  }
  return normalizeDashboardPreferences(saved);
}

function writeDashboardPreferences(owner, preferences, api) {
  const target = api || (typeof wx !== 'undefined' ? wx : null);
  const normalized = normalizeDashboardPreferences(preferences);
  if (target) target.setStorageSync(dashboardPreferenceKey(owner), normalized);
  return normalized;
}

function applyDashboardPreferences(dashboard, preferences) {
  if (!dashboard || typeof dashboard !== 'object') return null;
  const prefs = normalizeDashboardPreferences(preferences);
  const customBalances = (Array.isArray(dashboard.customBalances) ? dashboard.customBalances : [])
    .filter(row => prefs.customBalances[String(row.index)] !== false);
  const result = {
    ...dashboard,
    balance: prefs.showBalance ? dashboard.balance : null,
    go: prefs.showGo ? dashboard.go : null,
    peak: prefs.showPeak ? dashboard.peak : null,
    customBalances,
    style: prefs.style,
  };
  result.hasContent = !!(result.balance || result.go || result.peak || customBalances.length);
  return result;
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
  if (patch.currency !== undefined && !['CNY', 'USD'].includes(patch.currency)) errors.push('currency 必须是 CNY 或 USD');
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
  normalize, normalizeConfig, normalizeDashboard, normalizeDashboardPreferences,
  applyDashboardPreferences, DEFAULT_DASHBOARD_PREFERENCES, preciseAmount, validatePatch,
  dashboardOwner, dashboardPreferenceKey, readDashboardPreferences, writeDashboardPreferences
};
