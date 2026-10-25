const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFleetValue,
  handleContextFleet,
  registerContextServices,
  CONTEXT_REQUEST_TYPES,
} = require('../scripts/lib/context-bridge.mjs');

function record(id, parentSessionId, origin, createdAt, title) {
  return {
    id,
    parentSessionId: parentSessionId || '',
    origin: origin || '',
    createdAt: createdAt || 0,
    ...(title ? { title } : {}),
  };
}

function snapshotOf(map) {
  return id => (map[id] === undefined ? null : map[id]);
}

test('fleet value walks the family in root-first DFS order with depths and counts', () => {
  const records = [
    record('root', '', '', 1, '主会话'),
    record('a', 'root', 'subagent', 2),
    record('c', 'a', 'subagent', 3),
    record('b', 'root', 'subagent', 4),
  ];
  const snapshots = {
    root: {
      title: '主会话',
      contextPressure: { contextWindow: 1000, pressureTokens: 250 },
      tokenUsage: { uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4 },
      sessionStats: { turns: 2, steps: 5 },
      mobileContext: { current: { system: 10, tools: 20, user: 5, inject: 0, skill: 0, assistant: 40, tool: 15, total: 90 } },
    },
    a: { subagent: { mode: 'continuable', label: '研究员' }, title: '子任务 A' },
    c: { subagent: { mode: 'one-shot' } },
    b: {},
  };
  const value = buildFleetValue('c', records, snapshotOf(snapshots), id => id === 'a');
  assert.equal(value.rootSessionId, 'root');
  assert.equal(value.currentSessionId, 'c');
  assert.deepEqual(value.agents.map(agent => agent.sessionId), ['root', 'a', 'c', 'b']);
  assert.deepEqual(value.agents.map(agent => agent.depth), [0, 1, 2, 1]);
  assert.equal(value.agents[0].isRoot, true);
  assert.equal(value.agents[2].isCurrent, true);
  assert.equal(value.agents[1].isCurrent, false);
  assert.equal(value.agents[0].title, '主会话');
  assert.equal(value.agents[1].label, '研究员');
  assert.equal(value.agents[1].origin, 'subagent');
  assert.equal(value.agents[1].parentSessionId, 'root');
  assert.equal(value.agents[1].mode, 'continuable');
  assert.equal(value.agents[2].mode, 'one-shot');
  assert.equal(value.agents[0].running, false);
  assert.equal(value.agents[1].running, true);
  assert.deepEqual(value.counts, { agents: 4, running: 1, subagents: 3 });
  // Composition is always a complete numeric bucket set.
  assert.deepEqual(value.agents[0].composition, {
    system: 10, tools: 20, user: 5, inject: 0, skill: 0, assistant: 40, tool: 15, total: 90,
  });
  assert.equal(value.agents[0].tokensTotal, 10);
  assert.equal(value.agents[0].turns, 2);
  assert.equal(value.agents[0].steps, 5);
  assert.equal(value.agents[0].pressureTokens, 250);
  assert.equal(value.agents[0].contextWindow, 1000);
  // Lossless JSON: no undefined-valued properties anywhere.
  const wire = JSON.stringify(value);
  assert.equal(wire.includes('undefined'), false);
  assert.deepEqual(JSON.parse(wire), value);
});

test('fleet value keeps a fork current agent visible even without a subagent edge', () => {
  const records = [
    record('root', '', '', 1),
    record('fork', 'root', '', 2),
    record('child', 'root', 'subagent', 3),
  ];
  const value = buildFleetValue('fork', records, () => null);
  assert.deepEqual(value.agents.map(agent => agent.sessionId), ['root', 'child', 'fork']);
  assert.equal(value.agents[2].isCurrent, true);
  assert.equal(value.agents[2].depth, 1);
  assert.equal(value.counts.subagents, 1);
  for (const agent of value.agents) {
    assert.equal(typeof agent.composition.total, 'number');
    assert.equal(typeof agent.running, 'boolean');
  }
});

test('fleet value degrades per-agent when a snapshot is missing or throws', () => {
  const records = [record('root', '', '', 1), record('a', 'root', 'subagent', 2)];
  const value = buildFleetValue('a', records, id => {
    if (id === 'root') throw new Error('cold read failed');
    return null;
  });
  assert.equal(value.agents.length, 2);
  for (const agent of value.agents) {
    assert.equal(agent.title, agent.sessionId); // no title anywhere -> id fallback
    assert.equal(agent.composition.total, 0);
    assert.equal(agent.tokensTotal, undefined);
  }
});

test('fleet value bounds the family and guards cyclic parent chains', () => {
  const records = [record('root', '', '', 1)];
  for (let i = 0; i < 60; i += 1) records.push(record('c' + i, i === 0 ? 'root' : 'c' + (i - 1), 'subagent', i + 2));
  const value = buildFleetValue('c59', records, () => null, () => false);
  assert.equal(value.agents.length, 40);
  assert.equal(value.agents[0].sessionId, 'root');
  assert.ok(value.agents.some(agent => agent.isCurrent && agent.sessionId === 'c59'),
    'the current agent must stay visible even past the family bound');
  // A cycle must not loop forever or throw.
  const cyclic = [record('x', 'y', '', 1), record('y', 'x', '', 2)];
  const cycleValue = buildFleetValue('x', cyclic, () => null);
  assert.ok(cycleValue.agents.length <= 40);
  assert.equal(cycleValue.currentSessionId, 'x');
});

test('fleet value reads subagent timing as active time when present', () => {
  const records = [record('root', '', '', 1), record('a', 'root', 'subagent', 2)];
  const value = buildFleetValue('a', records, id => id === 'a'
    ? { subagent: { mode: 'continuable', label: 'x' }, subagentTiming: { settledMs: 5000, active: { since: 1000, through: 4000 } } }
    : { mobileContext: { timing: { wallMs: 12345 } } });
  assert.equal(value.agents[1].activeMs, 8000);
  assert.equal(value.agents[0].activeMs, 12345);
});

test('fleet value fills graph usage, steps and duration from the per-session context projections', () => {
  const records = [record('root', '', '', 1), record('child', 'root', 'subagent', 2)];
  const value = buildFleetValue('child', records, id => id === 'child' ? {
    mobileContext: {
      contextWindow: 1000,
      current: { system: 100, tools: 20, user: 10, inject: 0, skill: 0, assistant: 60, tool: 10, total: 200 },
      timing: { wallMs: 45000 },
    },
    contextTimeline: { counts: { steps: 7 }, requests: [] },
  } : null);
  const child = value.agents[1];
  assert.equal(child.contextWindow, 1000);
  assert.equal(child.pressureTokens, 200);
  assert.equal(child.contextTokens, 200);
  assert.equal(child.tokensTotal, undefined, 'context occupancy is not mislabeled as billed tokens');
  assert.equal(child.steps, 7);
  assert.equal(child.activeMs, 45000);
});

test('native DSH projections populate each Agent card and keep context tokens separate from billed tokens', () => {
  const records = [record('root', '', '', 1), record('child', 'root', 'subagent', 2)];
  const value = buildFleetValue('child', records, id => id === 'child' ? {
    subagent: { mode: 'one-shot', label: 'Review child' },
    contextTimeline: {
      contextWindow: 10000,
      current: { system: 100, tools: 200, user: 50, inject: 0, skill: 0, assistant: 100, tool: 50, total: 500 },
      last: { prompt: 700, total: 450 },
      counts: { steps: 4 },
      timing: { wallMs: 18000 },
      cost: { deepseek: { 'deepseek-v3': { peak: { uncached: 1000, cacheRead: 2000, cacheWrite: 300, output: 500 } } } },
    },
  } : null);
  const child = value.agents[1];
  assert.equal(child.contextWindow, 10000);
  assert.equal(child.pressureTokens, 750, 'uses DSH headline anchor + current delta');
  assert.equal(child.contextTokens, 500);
  assert.equal(child.tokensTotal, 3800, 'billed total follows DSH cost ledger');
  assert.equal(child.steps, 4);
  assert.equal(child.activeMs, 18000);
  assert.deepEqual(child.composition, { system: 100, tools: 200, user: 50, inject: 0, skill: 0, assistant: 100, tool: 50, total: 500 });
  assert.equal(child.completed, undefined, 'a stopped subagent without DSH completion evidence is not marked complete');
});

test('context-fleet discovers catalogued cold subagents and observes their DSH projections', async () => {
  const projectionsById = {
    root: {
      contextTimeline: { contextWindow: 100000, current: { total: 1200 }, counts: { steps: 2 }, timing: { wallMs: 9000 } },
      subagentCatalog: [{ id: 'cold-child', createdAt: 2, mode: 'one-shot', label: 'Cold child' }],
    },
    'cold-child': {
      subagent: { mode: 'one-shot', label: 'Cold child' },
      contextTimeline: { contextWindow: 8000, current: { system: 100, tools: 200, user: 100, inject: 0, skill: 0, assistant: 50, tool: 50, total: 500 }, counts: { steps: 6 }, timing: { wallMs: 60000 } },
      tokenUsage: { uncachedInputTokens: 1000, cacheReadTokens: 2000, cacheWriteTokens: 300, outputTokens: 500 },
    },
  };
  const sessionsService = {
    list: () => [{ id: 'root', header: { id: 'root', createdAt: 1 } }],
    get: () => undefined,
  };
  const projectionsService = { snapshot: () => ({ values: {} }) };
  const queryService = {
    async observeSession(id) {
      return {
        header: id === 'root'
          ? { id: 'root', createdAt: 1 }
          : { id, parentSession: 'root', origin: 'subagent', createdAt: 2 },
        projections: { values: projectionsById[id] || {} },
        [Symbol.dispose]() {},
      };
    },
  };
  registerContextServices({
    inject(names, callback) {
      const services = names[0] === 'sessions' ? { sessions: sessionsService, sessionProjections: projectionsService }
        : names[0] === 'sessionQuery' ? { sessionQuery: queryService }
          : names[0] === 'agents' ? { agents: { get: () => undefined } } : {};
      callback(Object.assign(services, { effect() {} }));
    },
  });

  const frame = await handleContextFleet({ type: 'context-fleet', sessionId: 'root' });
  assert.equal(frame.kind, 'context-fleet');
  assert.deepEqual(frame.value.agents.map(agent => agent.sessionId), ['root', 'cold-child']);
  const child = frame.value.agents[1];
  assert.equal(child.title, 'Cold child');
  assert.equal(child.pressureTokens, 500);
  assert.equal(child.contextWindow, 8000);
  assert.equal(child.tokensTotal, 3800);
  assert.equal(child.steps, 6);
  assert.equal(child.activeMs, 60000);
});

test('context request types include dashboard, fleet, content, insights and comms', () => {
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-dashboard'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-fleet'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-content'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-insights'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-comms'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.size, 5);
});
