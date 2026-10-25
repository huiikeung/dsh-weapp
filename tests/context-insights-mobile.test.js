// Insights ⇄ DSH rc.3 hosts: session rows can carry the family edge on the row
// itself, and the only rich head may be the gateway's own mobileContext fold.
// These tests pin the fallbacks that keep the page populated there: mobileContext
// timing/current, skill loads from the fold's inject events, request-priced days,
// and titles from the native `title` projection.
const test = require('node:test');
const assert = require('node:assert/strict');

const DAY = 86400000;

function dayKey(time) {
  const date = new Date(time);
  const pad = (value) => (value < 10 ? '0' + value : String(value));
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function priceBook() {
  return {
    deepseek: {
      models: {
        'deepseek-v4': { cost: { input: 0.2, output: 1, cache_read: 0.1, cache_write: 0.2 } }
      }
    }
  };
}

function usage(tokens) {
  return {
    uncachedInputTokens: tokens.uncached || 0,
    cacheReadTokens: tokens.cacheRead || 0,
    cacheWriteTokens: tokens.cacheWrite || 0,
    outputTokens: tokens.output || 0
  };
}

function completeValues(overrides) {
  return {
    title: '任务标题',
    tokenUsage: usage({ uncached: 100, cacheRead: 900, output: 50 }),
    sessionStats: { turns: 3, steps: 7, llmMs: 5000, toolMs: 1000 },
    contextPressure: { contextWindow: 1000, pressureTokens: 400 },
    mobileContext: {
      model: 'deepseek-v4',
      provider: 'deepseek',
      current: { system: 100, tools: 200, user: 50, total: 350 },
      timing: {
        wallMs: 6000, ttftMs: 500, reasoningMs: 1500, textMs: 2500,
        toolArgMs: 500, toolsMs: 1000, waitCount: 2, reasoningCount: 1,
        textCount: 2, toolArgCount: 2, toolCount: 2
      },
      requests: [{ time: Date.now() - 1000, total: 300, prompt: 1200, output: 40, cacheRead: 900, uncachedInput: 300 }],
      events: [{ kind: 'inject', sub: 'skill', name: 'bug-hunt', time: Date.now() - 2000 }],
      counts: { toolCalls: 4 },
      activity: { userInputs: 2, reads: 3, writes: 1, searches: 0, images: 0 }
    },
    ...overrides
  };
}

function fakeHost(rows, snapshots) {
  const calls = { observed: 0 };
  const ctx = {
    inject(services, callback) {
      if (services.includes('sessions')) {
        callback({
          sessions: { list: () => rows },
          sessionProjections: {
            snapshot: (session) => snapshots.get(session.sessionId || session.id || (session.header && session.header.id)) || null
          },
          effect: () => () => {}
        });
      } else if (services.includes('sessionQuery')) {
        callback({
          sessionQuery: {
            observeSession: async () => {
              calls.observed += 1;
              return { projections: { values: {} }, [Symbol.dispose]() {} };
            }
          },
          effect: () => () => {}
        });
      } else if (services.includes('agents')) {
        callback({ agents: { get: () => null }, effect: () => () => {} });
      } else if (services.includes('skills')) {
        callback({ skills: { list: async () => [] }, effect: () => () => {} });
      } else if (services.includes('agentPresets')) {
        callback({ agentPresets: {}, effect: () => () => {} });
      }
    }
  };
  return { ctx, calls };
}

async function loadBridge() {
  return import('../scripts/lib/context-bridge.mjs');
}

test('insights reads top-level session rows and mobileContext heads on DSH rc.3', async () => {
  const bridge = await loadBridge();
  const now = Date.now();
  const rootOnly = usage({ uncached: 10000, cacheRead: 90000, output: 500 });
  const snapshots = new Map();
  snapshots.set('root', { values: completeValues({ tokenUsage: rootOnly }) });
  snapshots.set('child', {
    values: {
      tokenUsage: usage({ uncached: 100, output: 10 }),
      sessionStats: { turns: 1, steps: 1 },
      mobileContext: {
        requests: [{ time: now - 500, total: 50, prompt: 100, output: 10, cacheRead: 0, uncachedInput: 100 }],
        events: [{ kind: 'inject', sub: 'skill', name: 'review', time: now - 400 }]
      }
    }
  });
  const rows = [
    { sessionId: 'root', updatedAt: now, title: '根会话' },
    { sessionId: 'child', parentSessionId: 'root', origin: 'subagent', updatedAt: now }
  ];
  const { ctx, calls } = fakeHost(rows, snapshots);
  bridge.registerContextServices(ctx);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false });
  let frame;
  try {
    frame = await bridge.handleContextInsights({ type: 'context-insights', sessionId: 'root' });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(frame.kind, 'context-insights');
  assert.equal(frame.value.sessions.length, 1, 'subagent row is folded into the family, not listed');
  const session = frame.value.sessions[0];
  assert.equal(session.id, 'root');
  assert.equal(session.title, '任务标题');
  assert.equal(session.billedTokens, 100610, 'family usage sums the child buckets');
  assert.equal(session.timing.wallMs, 6000, 'mobileContext timing feeds the timing card');
  assert.equal(session.timing.reasoningMs, 1500);
  const day = dayKey(now);
  assert.equal(session.days[day].skills['bug-hunt'].loads, 1);
  assert.equal(session.days[day].skills.review.loads, 1, 'child skill loads merge into the family ledger');
  assert.deepEqual(session.skillNames.sort(), ['bug-hunt', 'review']);
  assert.ok(frame.value.skillDays.some((item) => item.day === day));
  assert.equal(calls.observed, 0, 'a complete mobileContext head never triggers a cold observation');
  assert.doesNotThrow(() => JSON.stringify(frame.value));
});

test('insights handler never fabricates cost without a price book', async () => {
  const bridge = await loadBridge();
  const now = Date.now();
  const { ctx } = fakeHost(
    [{ sessionId: 'root', updatedAt: now }],
    new Map([['root', { values: completeValues({ title: '' }) }]])
  );
  bridge.registerContextServices(ctx);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false });
  let frame;
  try {
    frame = await bridge.handleContextInsights({ type: 'context-insights', sessionId: 'root' });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(frame.value.sessions[0].costUsd, null);
  assert.equal(frame.value.sessions[0].days[dayKey(now)].costUsd === undefined
    || frame.value.sessions[0].days[dayKey(now)].costUsd === null, true);
});

test('request rows are priced from the models.dev book for day and card cost', async () => {
  const bridge = await loadBridge();
  const now = Date.now();
  const value = bridge.buildInsightsValue([{
    id: 'priced',
    title: 'priced',
    model: 'deepseek-v4',
    provider: 'deepseek',
    usage: usage({ uncached: 1000000, output: 500000 }),
    requests: [{
      time: now, total: 1500, prompt: 1000000, output: 500000,
      cacheRead: 0, uncachedInput: 1000000
    }]
  }], now, { priceBook: priceBook() });
  const session = value.sessions[0];
  // 1M uncached × $0.2/M + 0.5M output × $1/M = $0.7
  assert.ok(Math.abs(session.costUsd - 0.7) < 1e-9, `card cost ${session.costUsd}`);
  const day = session.days[dayKey(now)];
  assert.ok(Math.abs(day.costUsd - 0.7) < 1e-9, `day cost ${day.costUsd}`);
  assert.equal(day.inputTokens, 1000000);
  assert.equal(day.outputTokens, 500000);
});

test('a mobileContext-only session keeps its old shape when no title exists', async () => {
  const bridge = await loadBridge();
  const now = Date.now();
  const { ctx } = fakeHost(
    [{ sessionId: 'root', updatedAt: now }],
    new Map([['root', { values: completeValues({ title: '' }) }]])
  );
  bridge.registerContextServices(ctx);
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false });
  let frame;
  try {
    frame = await bridge.handleContextInsights({ type: 'context-insights', sessionId: 'root' });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(frame.value.sessions[0].title, 'root', 'falls back to the session id, never an empty title');
});
