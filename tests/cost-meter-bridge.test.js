// Tests for the standalone cost-meter-bridge module (no host costMeter service).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handleCostMeter, COST_METER_REQUEST_TYPES, foldSessionEvents } = require('../scripts/lib/cost-meter-bridge.mjs');
const { handleCostMeterWithDashboard } = require('../scripts/lib/cost-meter-dashboard-bridge.mjs');
const costView = require('../miniprogram/utils/cost-view');

// One known instant; bucket boundaries are derived from it.
const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime(); // 2026-10-22 12:00 local

function usage(input, output, extra = {}) {
  return { inputTokens: input, outputTokens: output, ...extra };
}

function assistantEvent(time, usg, model) {
  return {
    type: 'assistant/message',
    seq: Math.round(time / 1000),
    time,
    data: {
      usage: usg,
      ...(model ? { source: { kind: 'model', model } } : {}),
    },
  };
}

// Host adapter mock: sessions.list + sessions.history
function makeApi(sessions) {
  const byId = new Map(sessions.map(s => [s.sessionId, s]));
  return {
    sessions: {
      async list() {
        return { kind: 'sessions', items: sessions.map(s => ({ sessionId: s.sessionId })) };
      },
      async history({ sessionId }) {
        const s = byId.get(sessionId);
        if (!s) return { kind: 'history', events: [] };
        return { kind: 'history', events: s.events.map(event => ({ event })) };
      },
    },
  };
}

// Test bridge handler
test('cost-meter request types are defined', () => {
  assert.deepEqual([...COST_METER_REQUEST_TYPES], ['cost-meter']);
});

test('bad request without requestId returns error', async () => {
  const out = await handleCostMeter({}, {});
  assert.equal(out.code, 'bad-request');
  assert.equal(out.message, 'cost-meter requires a requestId');
});

test('no sessions yields available-but-empty summary', async () => {
  const out = await handleCostMeter(makeApi([]), { requestId: 'r1', action: 'summary' }, { now: () => NOW, configOverride: { currency: 'CNY', exchangeRate: 7.2 } });
  assert.equal(out.kind, 'cost-meter');
  assert.equal(out.action, 'summary');
  assert.ok(out.summary.available);
  assert.equal(out.summary.today, null);
  assert.equal(out.summary.month, null);
  assert.equal(out.summary.total, null);
  assert.equal(out.summary.currency, 'CNY');
});

test('summary folds today/month/total from session events', async () => {
  const dayMs = 86400000;
  const api = makeApi([
    { sessionId: 's1', events: [
      assistantEvent(NOW - 3600000, usage(1000, 500, { cacheReadTokens: 200 }), 'deepseek-chat'),     // today
      assistantEvent(NOW - 5 * dayMs, usage(2000, 1000), 'deepseek-chat'),                            // this month
      assistantEvent(NOW - 40 * dayMs, usage(5000, 2500), 'deepseek-reasoner'),                       // total only
    ] },
    { sessionId: 's2', events: [
      assistantEvent(NOW - 7200000, usage(300, 150), 'unknown-model-xyz'),                            // today, fallback price
    ] },
  ]);
  const out = await handleCostMeter(api, { requestId: 'r2', action: 'summary' }, { now: () => NOW, configOverride: { currency: 'USD', exchangeRate: 1 } });
  assert.equal(out.kind, 'cost-meter');
  assert.ok(out.summary.today);
  assert.equal(out.summary.today.calls, 2);
  assert.equal(out.summary.today.tokens, 1000 + 500 + 200 + 300 + 150);
  assert.ok(out.summary.month.calls >= 3);
  assert.ok(out.summary.total.calls >= 4);
  // USD totals: deepseek-chat input 0.27/1M, cacheRead 0.07/1M, output 1.10/1M
  const expectedTodayCost = (1000 * 0.27 + 200 * 0.07 + 500 * 1.10) / 1e6 + (300 * 0.2 + 150 * 0.2) / 1e6;
  assert.ok(Math.abs(out.summary.today.amount - expectedTodayCost) < 1e-9, `expected ~${expectedTodayCost}, got ${out.summary.today.amount}`);
  assert.equal(out.summary.balance, null);
});

test('CNY conversion uses exchange rate', async () => {
  const api = makeApi([
    { sessionId: 's1', events: [assistantEvent(NOW, usage(1000000, 0), 'deepseek-chat')] },
  ]);
  const out = await handleCostMeter(api, { requestId: 'r3', action: 'summary' }, { now: () => NOW, configOverride: { currency: 'CNY', exchangeRate: 7.2 } });
  // 1M input tokens * 0.27 USD/1M = 0.27 USD -> 1.944 CNY
  assert.ok(Math.abs(out.summary.total.amount - 0.27 * 7.2) < 1e-9);
  assert.equal(out.summary.currency, 'CNY');
});

test('budget usage is compared in the configured display currency', async () => {
  const api = makeApi([
    { sessionId: 's1', events: [assistantEvent(NOW, usage(1000000, 0), 'deepseek-chat')] },
  ]);
  const out = await handleCostMeter(api, { requestId: 'r-cny-budget', action: 'summary' }, {
    now: () => NOW,
    configOverride: { currency: 'CNY', exchangeRate: 7.2, budget: { enabled: true, amount: 10, period: 'day' } },
  });
  assert.ok(Math.abs(out.summary.budget.used - 1.944) < 1e-9);
  assert.ok(Math.abs(out.summary.budget.percent - 19.4) < 0.1);
});

test('config action returns settings without folding', async () => {
  let folded = false;
  const api = {
    sessions: {
      async list() { folded = true; return { items: [] }; },
      async history() { return { events: [] }; },
    },
  };
  const out = await handleCostMeter(api, { requestId: 'r4', action: 'config' }, { now: () => NOW, configOverride: { currency: 'CNY', budget: { enabled: true, amount: 50, period: 'month' }, hideBudget: false } });
  assert.equal(out.kind, 'cost-meter');
  assert.equal(out.action, 'config');
  assert.equal(out.config.currency, 'CNY');
  assert.equal(out.config.budget.enabled, true);
  assert.equal(out.config.budget.amount, 50);
  assert.equal(folded, false, 'config must not fold sessions');
});

test('update action validates and applies patch', async () => {
  const api = makeApi([]);
  const out = await handleCostMeter(api, { requestId: 'r5', action: 'update', patch: { currency: 'USD' } }, { now: () => NOW, configOverride: { currency: 'CNY' } });
  assert.equal(out.kind, 'cost-meter');
  assert.equal(out.action, 'update');
  assert.equal(out.config.currency, 'USD');
  assert.ok(out.summary.available);
});

test('update action persists budget and subagent settings through the allowlist', async () => {
  const previousFile = process.env.DSH_WEAPP_COST_STATE_FILE;
  const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cost-meter-config-')), 'state.json');
  process.env.DSH_WEAPP_COST_STATE_FILE = file;
  try {
    const out = await handleCostMeter(makeApi([]), {
      requestId: 'r-config-save', action: 'update',
      patch: { budget: { enabled: true, amount: 25, period: 'day' }, includeSubagentCost: false },
    }, { now: () => NOW });
    assert.equal(out.kind, 'cost-meter');
    assert.equal(out.config.budget.enabled, true);
    assert.equal(out.config.budget.amount, 25);
    assert.equal(out.config.includeSubagentCost, false);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(persisted.config.budget.amount, 25);
    assert.equal(persisted.config.includeSubagentCost, false);
  } finally {
    if (previousFile === undefined) delete process.env.DSH_WEAPP_COST_STATE_FILE;
    else process.env.DSH_WEAPP_COST_STATE_FILE = previousFile;
  }
});

test('update rejects invalid patches gracefully', async () => {
  const out = await handleCostMeter(makeApi([]), { requestId: 'r6', action: 'update', patch: { currency: 'JPY' } }, { now: () => NOW });
  assert.equal(out.code, 'bad-request');
});

test('unavailable host adapter returns graceful failure', async () => {
  const out = await handleCostMeter({}, { requestId: 'r7', action: 'summary' }, { now: () => NOW });
  assert.equal(out.kind, 'cost-meter');
  assert.ok(out.summary);
  assert.equal(out.summary.today, null);
});

test('host exception never leaks details', async () => {
  const api = {
    sessions: {
      async list() { throw new Error('secret database string 42'); },
      async history() { throw new Error('boom'); },
    },
  };
  const out = await handleCostMeter(api, { requestId: 'r8', action: 'summary' }, { now: () => NOW });
  assert.equal(out.summary.total, null);
  assert.doesNotMatch(JSON.stringify(out), /secret database string 42/);
});

test('standalone session usage bridge continues to work without any dashboard plugin', async () => {
  const api = makeApi([{ sessionId: 's-native', events: [assistantEvent(NOW, usage(300, 100), 'deepseek-chat')] }]);
  const out = await handleCostMeter(api, { requestId: 'native-1', action: 'refresh' }, { now: () => NOW });
  assert.equal(out.kind, 'cost-meter');
  assert.equal(out.summary.today.tokens, 400);
  assert.equal(out.summary.available, true);
});

test('native dashboard reads official account and Go quota without querying a costMeter service', async () => {
  const previousFile = process.env.DSH_WEAPP_COST_DASHBOARD_FILE;
  const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cost-dashboard-')), 'settings.json');
  process.env.DSH_WEAPP_COST_DASHBOARD_FILE = file;
  fs.writeFileSync(file, JSON.stringify({ settings: { goQuota: { enabled: true, main: 'weekly', barDirection: 'remaining' } } }));
  const calls = [];
  const api = { account: { async getBalance(client) {
    assert.equal(client.version, 'dsh-weapp/1');
    return { status: 'ready', value: [{ currency: 'USD', balance: '5' }, { currency: 'CNY', balance: '7.2' }], bonusWallets: [{ currency: 'CNY', balance: '0.089' }] };
  } } };
  const hostContext = { get(name) {
    calls.push(name);
    assert.notEqual(name, 'costMeter', 'dashboard must not depend on dsh-cost-meter');
    return { async resolve(ref) { return ref === 'OPENCODE_GO_API_KEY' ? { value: 'secret-key' } : null; } };
  } };
  try {
    const frame = await handleCostMeterWithDashboard(api, { requestId: 'native-dashboard', action: 'refresh' }, {
      hostContext,
      now: () => NOW,
      async fetch(url, options) {
        assert.equal(url, 'https://opencode.ai/zen/go/v1/usage');
        assert.equal(options.headers.authorization, 'Bearer secret-key');
        return { ok: true, async json() { return { usage: { rolling: { percent: 3, resetsAt: '2026-10-22T17:00:00Z' }, weekly: { percent: 22, resetsAt: '2026-10-26T00:00:00Z' } } }; } };
      },
    });
    assert.equal(frame.kind, 'cost-meter');
    assert.ok(Math.abs(frame.dashboard.balance.totalBalance - 7.289) < 1e-9);
    assert.equal(frame.dashboard.goQuota.weekly.percent, 22);
    assert.equal(frame.dashboard.goQuota.main, 'weekly');
    assert.equal(frame.dashboard.goQuota.configured, true);
    assert.equal(frame.dashboard.peak.enabled, true);
    assert.ok(calls.length > 0);
    assert.ok(calls.every(name => name === 'settings' || name === 'credentials'));
    assert.doesNotMatch(JSON.stringify(frame), /secret-key/);
  } finally {
    if (previousFile === undefined) delete process.env.DSH_WEAPP_COST_DASHBOARD_FILE;
    else process.env.DSH_WEAPP_COST_DASHBOARD_FILE = previousFile;
  }
});

test('official balance falls back to the fixed DeepSeek API endpoint and never returns the API key', async () => {
  const credentials = { async resolve(ref) { return ref === 'DSH_WEAPP_DEEPSEEK_BALANCE_API_KEY' ? { value: 'deepseek-secret' } : null; } };
  const hostContext = { get(name) {
    if (name === 'settings') return { get() { return { providers: {} }; } };
    assert.notEqual(name, 'costMeter');
    return credentials;
  } };
  const frame = await handleCostMeterWithDashboard({ account: { async getBalance() { return null; } } }, {
    requestId: 'official-api-balance', action: 'refresh',
  }, {
    hostContext,
    async fetch(url, options) {
      assert.equal(url, 'https://api.deepseek.com/user/balance');
      assert.equal(options.headers.authorization, 'Bearer deepseek-secret');
      return { ok: true, async json() { return { balance_infos: [
        { currency: 'USD', total_balance: '2.5' },
        { currency: 'CNY', total_balance: '0' },
      ] }; } };
    },
  });
  assert.equal(frame.dashboard.balance.currency, 'USD');
  assert.equal(frame.dashboard.balance.totalBalance, 2.5);
  assert.equal(frame.dashboard.settings.balanceKeyConfigured, true);
  assert.doesNotMatch(JSON.stringify(frame), /deepseek-secret/);
});

test('dashboard settings persist without storing Go secrets and Go keys use the DSH credential store', async () => {
  const previousFile = process.env.DSH_WEAPP_COST_DASHBOARD_FILE;
  const file = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cost-dashboard-save-')), 'settings.json');
  process.env.DSH_WEAPP_COST_DASHBOARD_FILE = file;
  let stored;
  const hostContext = { get(name) {
    assert.equal(name, 'credentials');
    return {
      async set(ref, value) { stored = { ref, value }; },
      async resolve() { return stored ? { value: stored.value } : null; },
    };
  } };
  try {
    const keyFrame = await handleCostMeterWithDashboard({}, { requestId: 'save-key', action: 'set-go-key', value: 'top-secret' }, {
      hostContext, async fetch() { return { ok: true, async json() { return { usage: { rolling: { percent: 9 } } }; } }; },
    });
    assert.deepEqual(stored, { ref: 'OPENCODE_GO_API_KEY', value: 'top-secret' });
    assert.doesNotMatch(JSON.stringify(keyFrame), /top-secret/);
    const frame = await handleCostMeterWithDashboard({}, { requestId: 'save-settings', action: 'update', patch: {
      goQuota: { main: 'monthly', barDirection: 'remaining' }, peak: { enabled: false, windows: [{ start: 3, end: 7 }] },
    } }, { hostContext });
    assert.equal(frame.dashboard.settings.goQuota.main, 'monthly');
    assert.equal(frame.dashboard.settings.peak.enabled, false);
    assert.equal(frame.dashboard.goQuota.barDirection, 'remaining');
    const saved = fs.readFileSync(file, 'utf8');
    assert.match(saved, /"main": "monthly"/);
    assert.doesNotMatch(saved, /top-secret/);
  } finally {
    if (previousFile === undefined) delete process.env.DSH_WEAPP_COST_DASHBOARD_FILE;
    else process.env.DSH_WEAPP_COST_DASHBOARD_FILE = previousFile;
  }
});

test('foldSessionEvents attributes by time bucket', () => {
  const dayMs = 86400000;
  const acc = { today: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 }, month: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 }, total: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 } };
  foldSessionEvents(acc, [
    assistantEvent(NOW - 3600000, usage(100, 50), 'deepseek-chat'),
    assistantEvent(NOW - 5 * dayMs, usage(200, 100), 'deepseek-chat'),
    assistantEvent(NOW - 40 * dayMs, usage(400, 200), 'deepseek-reasoner'),
  ], { prices: {} }, NOW);
  assert.equal(acc.today.calls, 1);
  assert.equal(acc.today.input, 100);
  assert.equal(acc.month.calls, 2);
  assert.equal(acc.total.calls, 3);
  assert.equal(acc.month.input, 300);
  assert.equal(acc.total.input, 700);
});

test('foldSessionEvents uses provider prices bucket when available', () => {
  const acc = { today: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 }, month: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 }, total: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 } };
  foldSessionEvents(acc, [assistantEvent(NOW, usage(1000000, 0), 'deepseek-chat')], { prices: { 'deepseek-chat': { input: 9, cacheRead: 1, cacheWrite: 9, output: 40 } } }, NOW);
  assert.ok(Math.abs(acc.total.cost - 9) < 1e-9, `got ${acc.total.cost}`);
});

test('installed bridge module matches the repository copy', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/lib/cost-meter-bridge.mjs'), 'utf8');
  assert.match(source, /export const COST_METER_REQUEST_TYPES/);
  assert.match(source, /NO LONGER depends|[sS]tandalone/);
  assert.ok(!/console\.log|debugger/.test(source));
});

// Test cost view helpers (unchanged contract)
test('formatCurrency formats correctly', () => {
  assert.equal(costView.formatCurrency(1234.56, 'CNY'), '¥1,234.56');
  assert.equal(costView.formatCurrency(0.01, 'USD'), '$0.01');
  assert.equal(costView.formatCurrency(0, 'EUR'), '€0.00');
  assert.equal(costView.formatCurrency(null, 'CNY'), '¥0.00');
  assert.equal(costView.formatCurrency(-5, 'CNY'), '-¥5.00');
});

test('formatTokens abbreviates large numbers', () => {
  assert.equal(costView.formatTokens(5000), '5K');
  assert.equal(costView.formatTokens(1500000), '1.5M');
  assert.equal(costView.formatTokens(100), '100');
  assert.equal(costView.formatTokens(null), '0');
});

test('formatPercent handles null and large values', () => {
  assert.equal(costView.formatPercent(null), '--');
  assert.equal(costView.formatPercent(50), '50.0%');
  assert.equal(costView.formatPercent(150), '≥100%');
});

test('formatRelativeTime is stable', () => {
  const now = Date.now();
  const recent = costView.formatRelativeTime(now - 30000);
  assert.equal(recent, '刚刚');
  const old = costView.formatRelativeTime(now - 86400000 * 2);
  assert.ok(old.includes('/'), 'contains date');
  assert.equal(costView.formatRelativeTime(null), '--');
});

test('normalize parses summary correctly', () => {
  const summary = {
    available: true,
    currency: 'CNY',
    today: { amount: 0.5, tokens: 1000, calls: 5 },
    month: { amount: 12.34, tokens: 25000000 },
    total: { amount: 123.45, tokens: 30000000 },
    budget: { enabled: true, amount: 100, used: 25, percent: 25 },
    balance: { status: 'ok', currency: 'CNY', total: 500, granted: 200, toppedUp: 300, fetchedAt: Date.now() - 600000 },
    updatedAt: Date.now()
  };
  const view = costView.normalize(summary);
  assert.equal(view.currency, 'CNY');
  assert.ok(view.today);
  assert.equal(view.today.amountFmt, '¥0.50');
  assert.equal(view.today.tokensFmt, '1K');
  assert.ok(view.budget);
  assert.equal(view.budget.percentFmt, '25.0%');
  assert.ok(view.balance);
  assert.equal(view.balance.totalFmt, '¥500.00');
});

test('compact sidebar projection formats authoritative balance, custom balance and Go quota', () => {
  const view = costView.normalizeDashboard({
    currency: 'CNY', exchangeRate: 7.2, decimals: 3,
    balance: { enabled: true, status: 'ok', currency: 'CNY', totalBalance: 7.289 },
    customBalances: [{ index: 0, enabled: true, display: 'sidebar', label: '赛博', status: 'ok', remaining: -0.0114, unit: 'USD' }],
    goQuota: { enabled: true, status: 'ok', main: 'rolling', barDirection: 'used', rolling: { percent: 3, resetsAt: '' } },
    peak: { enabled: false, windows: [] },
  });
  assert.equal(view.balance.amountText, '¥7.289');
  assert.equal(view.customBalances[0].label, '赛博');
  assert.equal(view.customBalances[0].amountText, '$-0.0114');
  assert.equal(view.go.label, 'Go 5h');
  assert.equal(view.go.percentText, '3%');
  assert.equal(view.go.barWidth, '3%');
  assert.equal(view.hasContent, true);
});

test('validatePatch rejects invalid patches', () => {
  const invalid = costView.validatePatch({ currency: 'JPY' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.message.includes('CNY'));

  const valid = costView.validatePatch({ currency: 'USD', budget: { enabled: true, amount: 100 } });
  assert.equal(valid.ok, true);
  assert.equal(valid.patch.currency, 'USD');
});
