// Host-side context-insights family aggregation: a listed session's token
// usage and activity ledger fold its whole subagent subtree, matching
// dsh-context overview.ts `rowsOfSnapshot` (subagent rows never list; their
// usage/activity/cost join the parent row; the row's own cards stay its own).
const test = require('node:test')
const assert = require('node:assert/strict')

const bridge = require('../scripts/lib/context-bridge.mjs')

const DAY = 86400000
const now = new Date(2026, 9, 23, 12, 0, 0).getTime()
const PRICE_BOOK = {
  deepseek: { models: { 'deepseek-v4': { cost: { input: 0.2, output: 1, cache_read: 0.1, cache_write: 0.2 } } } },
}

function dayKey(offset) {
  const date = new Date(now - offset * DAY)
  const pad = value => (value < 10 ? '0' + value : String(value))
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

function session(id, options = {}) {
  const header = { id, createdAt: options.createdAt === undefined ? now - 10 * DAY : options.createdAt }
  if (options.parentSession) header.parentSession = options.parentSession
  if (options.origin) header.origin = options.origin
  return {
    id,
    ...(options.title === undefined ? {} : { title: options.title }),
    updatedAt: options.updatedAt === undefined ? now - DAY : options.updatedAt,
    header,
  }
}

function projection(overrides = {}) {
  return {
    tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    sessionStats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0 },
    contextTimeline: {
      current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 0 },
      counts: { turns: 0, steps: 0 },
      timing: { wallMs: 0, ttftMs: 0, genMs: 0, toolsMs: 0 },
      requests: [],
    },
    contextActivity: { days: {} },
    sessionTitle: { title: '会话' },
    ...overrides,
  }
}

/** Register the fake host services; returns the ids whose projection snapshot was read. */
function install(sessions, projections) {
  const snapshots = []
  bridge.registerContextServices({
    inject(names, callback) {
      if (names[0] === 'sessions') {
        callback({
          sessions: {
            list: () => sessions,
            get: id => sessions.find(item => item && item.id === id),
          },
          sessionProjections: {
            snapshot(item) {
              const id = item && item.id
              snapshots.push(id)
              return { values: projections[id] === undefined ? null : projections[id] }
            },
          },
          effect: () => () => {},
        })
      } else if (names[0] === 'sessionQuery') {
        callback({
          sessionQuery: {
            async observeSession(id) {
              return { projections: { values: projections[id] || {} }, [Symbol.dispose]() {} }
            },
          },
          effect: () => () => {},
        })
      } else if (names[0] === 'agents') {
        callback({ agents: { get: () => undefined }, effect: () => () => {} })
      } else if (names[0] === 'skills') {
        callback({ skills: { list: async () => [] }, effect: () => () => {} })
      } else {
        callback({ effect: () => () => {} })
      }
    },
  })
  return snapshots
}

/** The frame must survive a JSON round trip unchanged (no undefined, NaN or Infinity anywhere). */
function assertPlainJson(value) {
  const wire = JSON.stringify(value)
  assert.equal(wire.includes('undefined'), false, 'the wire frame carries no undefined')
  assert.equal(wire.includes('NaN'), false, 'the wire frame carries no NaN')
  assert.equal(wire.includes('Infinity'), false, 'the wire frame carries no Infinity')
  assert.equal(JSON.stringify(JSON.parse(wire)), wire, 'the wire frame is lossless JSON')
}

async function insightsFrame(sessions, projections) {
  const snapshots = install(sessions, projections)
  const originalFetch = global.fetch
  global.fetch = async () => ({ ok: true, json: async () => PRICE_BOOK })
  try {
    const frame = await bridge.handleContextInsights({ type: 'context-insights', sessionId: sessions[0].id })
    return { frame, snapshots }
  } finally {
    global.fetch = originalFetch
  }
}

function familyFixture() {
  const root = session('root', { title: '根会话', updatedAt: now - 3 * DAY })
  const child = session('child', {
    title: '子任务', parentSession: 'root', origin: 'subagent', updatedAt: now,
  })
  const grandchild = session('grandchild', {
    title: '孙任务', parentSession: 'child', origin: 'subagent', updatedAt: now,
  })
  const other = session('other', { title: '独立会话', updatedAt: now - 2 * DAY })
  const projections = {
    root: projection({
      tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 },
      sessionStats: { turns: 2, steps: 4, llmMs: 100, toolMs: 10 },
      contextTimeline: {
        current: { system: 10, tools: 20, user: 5, inject: 0, skill: 0, assistant: 0, tool: 0, total: 35 },
        counts: { turns: 2, steps: 4 },
        toolCalls: 2,
        timing: { wallMs: 150, ttftMs: 10, genMs: 100, toolsMs: 10 },
        requests: [{ time: now - 3 * DAY, total: 100, prompt: 80, output: 20, cacheRead: 0 }],
      },
      contextActivity: { days: {
        [dayKey(3)]: {
          tokens: 100, requests: 1, turns: 1, toolCalls: 2, toolsMs: 10, wallMs: 100,
          skills: { review: { n: 1, last: now - 3 * DAY } },
        },
      } },
      sessionTitle: { title: '根会话' },
    }),
    child: projection({
      tokenUsage: { uncachedInputTokens: 200, cacheReadTokens: 1000, cacheWriteTokens: 0, outputTokens: 50 },
      sessionStats: { turns: 3, steps: 6, llmMs: 500, toolMs: 50 },
      contextTimeline: {
        current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 200 },
        counts: { turns: 3, steps: 6 },
        toolCalls: 5,
        timing: { wallMs: 500, ttftMs: 50, genMs: 300, toolsMs: 50 },
        requests: [{ time: now - 2 * DAY, total: 200, prompt: 150, output: 50, cacheRead: 1000 }],
      },
      contextActivity: { days: {
        [dayKey(0)]: {
          tokens: 200, requests: 1, turns: 1, toolCalls: 1, toolsMs: 5, wallMs: 50,
          skills: { review: { n: 2, last: now - 2 * DAY }, build: { n: 1, last: now - 2 * DAY } },
        },
        [dayKey(1)]: { tokens: 70, requests: 1, turns: 1, toolCalls: 1, toolsMs: 2, wallMs: 20 },
      } },
      sessionTitle: { title: '子任务' },
    }),
    grandchild: projection({
      tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 0, outputTokens: 30 },
      sessionStats: { turns: 1, steps: 2, llmMs: 100, toolMs: 10 },
      contextTimeline: {
        current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 300 },
        counts: { turns: 1, steps: 2 },
        toolCalls: 4,
        timing: { wallMs: 100, ttftMs: 10, genMs: 50, toolsMs: 10 },
        requests: [{ time: now - DAY, total: 30, prompt: 20, output: 10, cacheRead: 500 }],
      },
      contextActivity: { days: {
        [dayKey(0)]: {
          tokens: 30, requests: 1, turns: 1, toolCalls: 1, toolsMs: 1, wallMs: 10,
          skills: { deploy: { n: 1, last: now - DAY } },
        },
      } },
      sessionTitle: { title: '孙任务' },
    }),
    other: projection({
      tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 },
      sessionStats: { turns: 1, steps: 1, llmMs: 10, toolMs: 0 },
      contextTimeline: {
        current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 50 },
        counts: { turns: 1, steps: 1 },
        timing: { wallMs: 10, ttftMs: 1, genMs: 9, toolsMs: 0 },
        requests: [{ time: now - 2 * DAY, total: 10, prompt: 10, output: 0, cacheRead: 0 }],
      },
      contextActivity: { days: { [dayKey(0)]: { tokens: 10, requests: 1 } } },
      sessionTitle: { title: '独立会话' },
    }),
  }
  return { sessions: [root, child, grandchild, other], projections }
}

test('insights lists only top-level sessions and folds the subagent subtree into the parent row', async () => {
  const { sessions, projections } = familyFixture()
  const { frame } = await insightsFrame(sessions, projections)
  assert.equal(frame.kind, 'context-insights')
  assert.deepEqual(frame.value.sessions.map(item => item.id), ['other', 'root'], 'subagent rows never list')
  assert.equal(frame.value.totals.sessions, 2, 'session count stays top-level only')

  const root = frame.value.sessions.find(item => item.id === 'root')
  assert.equal(root.billedTokens, 1900, 'uncached + cacheRead + output of self + child + grandchild')
  assert.equal(root.inputTokens, 1800, 'prompt-side total folds the subtree')
  assert.equal(root.outputTokens, 100)
  assert.equal(root.cacheReadTokens, 1500, 'cache-hit KPI numerator folds the subtree')
  assert.equal(frame.value.totals.inputTokens, 1810, 'KPI tokens exclude subagent rows from the list')
  assert.equal(frame.value.totals.cacheReadTokens, 1500)
  assert.equal(frame.value.cacheHit, 1500 / 1810)

  const today = root.days[dayKey(0)]
  assert.equal(today.tokens, 230, 'the day bucket merges child + grandchild activity')
  assert.equal(today.requests, 2)
  assert.equal(today.turns, 2)
  assert.equal(today.toolCalls, 2)
  assert.equal(today.toolsMs, 6)
  assert.equal(today.wallMs, 60)
  assert.equal(today.skills.review.loads, 2, 'skill tallies merge name by name')
  assert.equal(today.skills.review.last, now - 2 * DAY, 'the newest load wins')
  assert.equal(today.skills.build.loads, 1)
  assert.equal(today.skills.deploy.loads, 1)
  assert.equal(root.days[dayKey(1)].tokens, 70, 'a child-only day reaches the heatmap and 7-day chart')
  assert.equal(root.days[dayKey(3)].tokens, 100, 'the parent own day stays')
  const todayBucket = frame.value.days.find(item => item.day === dayKey(0))
  assert.equal(todayBucket.tokens, 240, 'daily chart folds the subtree')

  assert.equal(root.lastActive, now - 3 * DAY, 'lastActive stays the parent own')
  assert.equal(root.turns, 2, 'turns stay the parent own')
  assert.equal(root.toolCalls, 2, 'tool calls stay the parent own')
  assert.equal(root.contextTokens, 35, 'the context donut stays the parent own')
  assert.equal(root.activeMs, 110)
  assert.deepEqual(root.composition, {
    system: 10, tools: 20, user: 5, inject: 0, skill: 0, assistant: 0, tool: 0, output: 100,
  })
})

test('insights folds the native lifetime cost ledger of self and descendants without fabricating zero', async () => {
  const root = session('root', { title: '根会话' })
  const child = session('child', { title: '子任务', parentSession: 'root', origin: 'subagent' })
  const grandchild = session('grandchild', { title: '孙任务', parentSession: 'child', origin: 'subagent' })
  const other = session('other', { title: '独立会话', updatedAt: now - 2 * DAY })
  const projections = {
    root: projection({
      contextTimeline: {
        current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 10 },
        counts: { turns: 1, steps: 1 },
        timing: { wallMs: 10, ttftMs: 1, genMs: 9, toolsMs: 0 },
        cost: { deepseek: { 'deepseek-v4': { peak: { uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 } } } },
      },
      tokenUsage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      sessionTitle: { title: '根会话' },
    }),
    child: projection({
      contextTimeline: {
        current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 10 },
        counts: { turns: 1, steps: 1 },
        timing: { wallMs: 10, ttftMs: 1, genMs: 9, toolsMs: 0 },
        cost: { deepseek: { 'deepseek-v4': { peak: { uncached: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 } } } },
      },
      tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 0 },
      sessionTitle: { title: '子任务' },
    }),
    grandchild: projection({ sessionTitle: { title: '孙任务' } }),
    other: projection({ sessionTitle: { title: '独立会话' } }),
  }
  const { frame } = await insightsFrame([root, child, grandchild, other], projections)
  const rootRow = frame.value.sessions.find(item => item.id === 'root')
  const otherRow = frame.value.sessions.find(item => item.id === 'other')
  assert.ok(Math.abs(rootRow.costUsd - 0.6) < 1e-9, `self + child cost (got ${rootRow.costUsd})`)
  assert.equal(otherRow.costUsd, null, 'no cost projection never fabricates zero')
  assert.equal('cost' in rootRow, false, 'the wire exposes the estimated costUsd only')
})

test('insights merges daily cost ledgers so the day cost is team scope', async () => {
  const root = session('root', { title: '根会话' })
  const child = session('child', { title: '子任务', parentSession: 'root', origin: 'subagent' })
  const projections = {
    root: projection({
      contextTimeline: {
        current: { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, total: 10 },
        counts: { turns: 1, steps: 1 },
        timing: { wallMs: 10, ttftMs: 1, genMs: 9, toolsMs: 0 },
      },
      tokenUsage: { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      contextActivity: { days: {
        [dayKey(0)]: {
          tokens: 1_000_000, requests: 1,
          cost: { deepseek: { 'deepseek-v4': { peak: { uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0 } } } },
        },
      } },
      sessionTitle: { title: '根会话' },
    }),
    child: projection({
      tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, outputTokens: 0 },
      contextActivity: { days: {
        [dayKey(0)]: {
          tokens: 1_000_000, requests: 1,
          cost: { deepseek: { 'deepseek-v4': { peak: { uncached: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 } } } },
        },
      } },
      sessionTitle: { title: '子任务' },
    }),
  }
  const { frame } = await insightsFrame([root, child], projections)
  const rootRow = frame.value.sessions[0]
  assert.ok(Math.abs(rootRow.days[dayKey(0)].costUsd - 0.6) < 1e-9, 'the day cost merges both ledgers')
  assert.ok(Math.abs(rootRow.costUsd - 0.6) < 1e-9, 'the lifetime fallback folds the merged day ledger')
})

test('detached and unreadable subagents never break the frame', async () => {
  const root = session('root', { title: '根会话' })
  const orphan = session('orphan', { title: '孤儿', parentSession: 'missing', origin: 'subagent' })
  const cold = session('cold', { title: '冷子任务', parentSession: 'root', origin: 'subagent' })
  const child = session('child', { title: '子任务', parentSession: 'root', origin: 'subagent' })
  const projections = {
    root: projection({
      tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 },
      sessionTitle: { title: '根会话' },
    }),
    // `cold` has no projection snapshot at all; `orphan`'s parent never lists.
    child: projection({
      tokenUsage: { uncachedInputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
      sessionTitle: { title: '子任务' },
    }),
  }
  const { frame, snapshots } = await insightsFrame([root, orphan, cold, child], projections)
  assert.deepEqual(frame.value.sessions.map(item => item.id), ['root'])
  assert.equal(frame.value.sessions[0].billedTokens, 1020, 'only the reachable child folds')
  assert.equal(snapshots.includes('orphan'), false, 'a detached subagent is never resolved')
  assertPlainJson(frame)
  assert.equal(frame.value.totals.sessions, 1)
})
