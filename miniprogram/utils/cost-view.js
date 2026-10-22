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

/** 同一台主机（节点/端点）共用一个额度卡片显示偏好。 */
function dashboardOwner(state) {
  const value = state || {};
  return [value.activeID || '', value.gatewayId || '', value.endpoint || ''].join('|');
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



// ---------------------------------------------------------------------------
// Quota dashboard v2 (native gateway sources: Go / Coding Plans / gateway /
// custom balances). The gateway already normalized numbers; these helpers turn
// them into display strings shared by the settings page and the sidebar card.
// ---------------------------------------------------------------------------

const QUOTA_CURRENCY_SYMBOLS = { CNY: '¥', USD: '$', EUR: '€' };
const SIDEBAR_STYLES = [
  { id: 'summary', label: '合并卡片', hint: '今日、余额与峰谷合并成一张紧凑卡片' },
  { id: 'simple', label: '简洁', hint: '只保留金额与额度的单行摘要' },
  { id: 'standard', label: '标准', hint: '每项额度独立成卡，信息最完整' },
  { id: 'compact', label: '紧凑', hint: '两列排布，适合同时显示多个额度来源' },
];
const DISPLAY_OPTIONS = [
  { id: 'both', label: '侧栏 + 设置页' },
  { id: 'sidebar', label: '仅侧栏' },
  { id: 'settings', label: '仅设置页' },
  { id: 'off', label: '关闭' },
];
const PLAN_WINDOW_LABELS = {
  five: '5 小时', '5h': '5 小时', fiveHour: '5 小时', five_hour: '5 小时',
  weekly: '本周', '7d': '本周', week: '本周', sevenDay: '本周', seven_day: '本周',
  monthly: '本月', month: '本月', '30d': '本月',
  balance: '余额', credits: 'Credits', cycleReset: '周期重置',
};

function quotaSymbolOf(dashboard) {
  if (dashboard && typeof dashboard.symbol === 'string' && dashboard.symbol) return dashboard.symbol;
  return QUOTA_CURRENCY_SYMBOLS[(dashboard && dashboard.currency) || 'CNY'] || '';
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 金额文本：保留 dashboard 配置的小数位，CREDITS 不带货币符号。 */
function quotaAmountText(value, unit, decimals, symbol) {
  const n = cleanNumber(value);
  if (n === null) return '—';
  if (unit === 'CREDITS') return Math.round(n).toLocaleString('en-US') + ' Credits';
  const precision = Math.max(0, Math.min(6, Number.isInteger(decimals) ? decimals : 2));
  const prefix = QUOTA_CURRENCY_SYMBOLS[unit] || symbol || '';
  const fixed = Math.abs(n).toFixed(precision);
  const parts = fixed.split('.');
  const integer = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + prefix + integer + (parts[1] ? '.' + parts[1] : '');
}

function quotaPercentText(value) {
  const n = cleanNumber(value);
  if (n === null) return '—';
  return Math.round(n) + '%';
}

function quotaBarWidth(value) {
  const n = cleanNumber(value);
  return (n === null ? 0 : Math.max(0, Math.min(100, n))) + '%';
}

function quotaResetText(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const pad = n => (n < 10 ? '0' + n : String(n));
  return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** Normalize one provider window map into renderable progress rows. */
function quotaWindowRows(windows, options = {}) {
  if (!windows || typeof windows !== 'object') return [];
  const remaining = options.barDirection === 'remaining';
  const rows = [];
  const preferred = options.main ? [options.main] : [];
  const order = preferred.concat(Object.keys(windows).filter(key => preferred.indexOf(key) === -1));
  for (const key of order) {
    const raw = windows[key];
    if (!raw || typeof raw !== 'object') continue;
    const label = PLAN_WINDOW_LABELS[key] || key;
    if (raw.unlimited === true) {
      rows.push({ key, label, percentText: '∞', barWidth: '0%', resetsText: '', text: raw.text || '无限' });
      continue;
    }
    if (typeof raw.text === 'string' && raw.text) {
      rows.push({ key, label, percentText: raw.text, barWidth: '0%', resetsText: quotaResetText(raw.resetsAt), text: raw.text });
      continue;
    }
    const percent = cleanNumber(raw.percent);
    if (percent === null) continue;
    const used = Math.max(0, Math.min(100, percent));
    const shown = remaining ? 100 - used : used;
    rows.push({
      key,
      label,
      percentText: quotaPercentText(remaining ? 100 - used : used),
      barWidth: quotaBarWidth(shown),
      resetsText: quotaResetText(raw.resetsAt),
      percent: used,
    });
  }
  return rows;
}

/** Build the shared quota view model (settings page + sidebar card). */
function normalizeQuotaDashboard(dashboard, summary) {
  if (!dashboard || typeof dashboard !== 'object') return null;
  const decimals = Number.isInteger(dashboard.decimals) ? dashboard.decimals : 2;
  const symbol = quotaSymbolOf(dashboard);
  const currency = dashboard.currency || 'CNY';
  const display = dashboard.display && typeof dashboard.display === 'object' ? dashboard.display : {};
  const budgetRaw = summary && summary.budget ? summary.budget : null;
  const budget = budgetRaw && budgetRaw.enabled === true ? {
    enabled: true,
    amountText: quotaAmountText(budgetRaw.amount, currency, decimals, symbol),
    usedText: quotaAmountText(budgetRaw.used, currency, decimals, symbol),
    percentText: quotaPercentText(budgetRaw.percent),
    barWidth: quotaBarWidth(budgetRaw.percent),
    period: budgetRaw.period || 'month',
  } : null;
  const balanceRaw = dashboard.balance && typeof dashboard.balance === 'object' ? dashboard.balance : null;
  const balance = balanceRaw ? {
    enabled: balanceRaw.enabled !== false,
    display: balanceRaw.display || 'both',
    refreshMinutes: balanceRaw.refreshMinutes || 5,
    keyConfigured: balanceRaw.keyConfigured === true,
    status: balanceRaw.status || 'off',
    message: balanceRaw.message || '',
    amountText: balanceRaw.status === 'ok' ? quotaAmountText(balanceRaw.totalBalance, balanceRaw.currency || currency, decimals, symbol) : '—',
    grantedText: quotaAmountText(balanceRaw.granted || 0, balanceRaw.currency || currency, decimals, symbol),
    toppedUpText: quotaAmountText(balanceRaw.toppedUp || 0, balanceRaw.currency || currency, decimals, symbol),
    title: balanceRaw.currency && balanceRaw.currency !== currency ? balanceRaw.currency + ' ' + '余额' : '余额',
  } : null;

  const goRaw = dashboard.goQuota && typeof dashboard.goQuota === 'object' ? dashboard.goQuota : null;
  const go = goRaw ? {
    enabled: goRaw.enabled === true,
    display: goRaw.display || 'both',
    refreshMinutes: goRaw.refreshMinutes || 15,
    detail: goRaw.detail !== false,
    configured: goRaw.configured === true,
    main: goRaw.main || 'rolling',
    barDirection: goRaw.barDirection || 'used',
    status: goRaw.status || 'off',
    message: goRaw.message || '',
    rows: quotaWindowRows(goRaw, { barDirection: goRaw.barDirection, main: goRaw.main }),
  } : null;
  if (go && go.rows.length === 0) {
    const mainKey = go.main === 'weekly' ? 'weekly' : go.main === 'monthly' ? 'monthly' : 'rolling';
    go.rows = [{
      key: mainKey,
      label: PLAN_WINDOW_LABELS[mainKey] || mainKey,
      percentText: '—',
      barWidth: '0%',
      resetsText: '',
    }];
  }

  const plans = (Array.isArray(dashboard.plans) ? dashboard.plans : []).map(plan => {
    const rows = quotaWindowRows(plan.windows, { main: 'five' });
    return {
      id: plan.id,
      label: plan.label || plan.id,
      enabled: plan.enabled === true,
      display: plan.display || 'settings',
      refreshMinutes: plan.refreshMinutes || 15,
      status: plan.status || 'pending',
      message: plan.message || '',
      windows: plan.windows || null,
      rows,
      main: rows[0] || null,
    };
  });

  const gateway = (Array.isArray(dashboard.gatewayQuotas) ? dashboard.gatewayQuotas : []).map(source => ({
    id: source.id,
    label: source.label || source.id,
    display: source.display || 'both',
    enabled: source.enabled !== false,
    status: source.status || 'pending',
    message: source.message || '',
    accounts: (Array.isArray(source.accounts) ? source.accounts : []).map(account => {
      const windows = Array.isArray(account.windows) ? account.windows : [];
      const rows = windows.map(win => ({
        key: win.id || win.label,
        label: win.label || win.id || '额度',
        percentText: quotaPercentText(win.percent),
        barWidth: quotaBarWidth(win.percent),
        resetsText: quotaResetText(win.resetsAt),
      }));
      return {
        id: account.id || account.label,
        label: account.label || account.provider || '额度',
        provider: account.provider || '',
        status: account.status || '',
        message: account.message || '',
        rows,
      };
    }),
  }));

  const custom = (Array.isArray(dashboard.customBalances) ? dashboard.customBalances : []).map(entry => ({
    index: entry.index,
    label: entry.label || '自定义余额',
    unit: entry.unit || 'USD',
    display: entry.display || 'both',
    enabled: entry.enabled === true,
    status: entry.status || 'pending',
    message: entry.message || '',
    amountText: entry.status === 'ok' ? quotaAmountText(entry.remaining, entry.unit, entry.unit === 'CREDITS' ? 0 : decimals, symbol) : '—',
    maxText: entry.maxBudget !== null && entry.maxBudget !== undefined ? quotaAmountText(entry.maxBudget, entry.unit, decimals, symbol) : '',
    percentText: quotaPercentText(entry.percent),
    barWidth: quotaBarWidth(entry.percent),
    percent: entry.percent,
  }));

  const peakRaw = dashboard.peak && typeof dashboard.peak === 'object' ? dashboard.peak : null;
  const peak = peakRaw ? {
    enabled: peakRaw.enabled !== false,
    display: peakRaw.display || 'both',
    style: display.peakStyle || 'progress',
    label: peakRaw.label || '',
    remainingText: peakRaw.remainingText || '',
    progressText: peakRaw.progressText || '0%',
    switchText: peakRaw.switchText || '',
  } : null;

  return {
    currency,
    symbol,
    decimals,
    exchangeRate: dashboard.exchangeRate,
    display,
    balance,
    go,
    plans,
    gateway,
    custom,
    peak,
    budget,
  };
}

/** Visible sidebar sections for the current display settings + chosen style. */
function quotaSidebarModel(view, style) {
  if (!view) return null;
  const visible = value => value && value.display !== 'settings' && value.display !== 'off';
  const model = {
    style: SIDEBAR_STYLES.some(item => item.id === style) ? style : 'standard',
    balance: visible(view.balance) ? view.balance : null,
    go: visible(view.go) && view.go.enabled ? view.go : null,
    plans: (view.plans || []).filter(plan => plan.enabled && visible(plan)),
    gateway: (view.gateway || []).filter(source => source.enabled && visible(source)),
    custom: (view.custom || []).filter(entry => entry.enabled && visible(entry)),
    budget: view.budget || null,
    peak: visible(view.peak) && view.peak.enabled ? view.peak : null,
  };
  model.empty = !model.balance && !model.go && !model.plans.length && !model.gateway.length && !model.custom.length && !model.budget && !model.peak;
  return model;
}

module.exports = {
  UNITS, formatCurrency, formatTokens, formatPercent, formatRelativeTime,
  normalize, normalizeDashboard, validatePatch, dashboardOwner,
  SIDEBAR_STYLES, DISPLAY_OPTIONS, PLAN_WINDOW_LABELS,
  quotaAmountText, quotaPercentText, quotaBarWidth, quotaResetText, quotaWindowRows,
  normalizeQuotaDashboard, quotaSidebarModel
};
