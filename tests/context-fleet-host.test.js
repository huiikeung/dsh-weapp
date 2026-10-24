const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildFleetValue,
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

test('context request types include dashboard, fleet, content, insights and comms', () => {
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-dashboard'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-fleet'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-content'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-insights'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.has('context-comms'), true);
  assert.equal(CONTEXT_REQUEST_TYPES.size, 5);
});
