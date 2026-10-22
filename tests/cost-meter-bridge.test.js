// Tests for the standalone cost-meter-bridge module (no host costMeter service).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { handleCostMeter, COST_METER_REQUEST_TYPES, foldSessionEvents } = require('../scripts/lib/cost-meter-bridge.mjs');
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

test('validatePatch rejects invalid patches', () => {
  const invalid = costView.validatePatch({ currency: 'JPY' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.message.includes('CNY'));

  const valid = costView.validatePatch({ currency: 'USD', budget: { enabled: true, amount: 100 } });
  assert.equal(valid.ok, true);
  assert.equal(valid.patch.currency, 'USD');
});