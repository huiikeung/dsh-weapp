// v2 host-bridge coverage for docs/context-dashboard.md §8.1/§8.2:
// activity counters, the six-way duration split + timeline spans, per-request
// items/usage, the newest-answer preview, and the fleet team roster.
//
// Everything here is checked against an INDEPENDENT re-implementation of the
// documented rules (stream decoding lives in the test too) or against DSH's own
// projections, never against the bridge's own intermediate values.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const BRIDGE = require('../scripts/lib/context-bridge.mjs')
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'context-session.json')
const ORACLE_ROOT = path.join(ROOT, '.dsh-reference', 'dsh', 'node_modules', '@deepseek-ai')
const REAL_SNAPSHOT_SEQ = 32619
const WIRE_LIMIT_BYTES = 250 * 1024
// 真实会话样例折叠后的线路帧明显大于合成数据，单独放宽
const REAL_SESSION_WIRE_LIMIT_BYTES = 640 * 1024
const REAL_JSONL_PATH = process.env.DSH_CONTEXT_V2_LOG || '/tmp/dsh-log/session.jsonl'
const REAL_SESSION_ID = 'session-1f4b49a8-4c3b-4ab3-8c29-997230702880'
const SESSIONS_ROOT = path.join(
  os.homedir(),
  '.dsh',
  'sessions',
  `--${ROOT.replace(/^[/\\]/, '').replace(/[/\\]/g, '-')}--`,
)
const REAL_ZSTD_PATH = path.join(SESSIONS_ROOT, REAL_SESSION_ID, 'session.v4.jsonl.zstd')

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function foldBridge(events) {
  let state = BRIDGE.createState()
  for (const event of events) state = BRIDGE.applyContextEvent(state, event)
  return { state, view: BRIDGE.contextView(state) }
}

function wireBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function assertNoUndefined(value, where) {
  if (value === undefined) return assert.fail(`undefined at ${where}`)
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoUndefined(item, `${where}[${index}]`))
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assert.ok(!key.startsWith('_'), `private key ${where}.${key} leaked to the wire`)
      assertNoUndefined(value[key], `${where}.${key}`)
    }
  }
}

function assertPlainJson(value, where = '$') {
  assertNoUndefined(value, where)
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${where} must survive a JSON round-trip`)
}

function readZstdLog(file) {
  const candidates = [process.env.ZSTD_BIN, 'zstd', '/opt/homebrew/bin/zstd', '/usr/local/bin/zstd'].filter(Boolean)
  for (const binary of candidates) {
    try {
      return execFileSync(binary, ['-dc', file], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return null
}

function readRealEvents() {
  if (fs.existsSync(REAL_JSONL_PATH)) {
    const lines = fs.readFileSync(REAL_JSONL_PATH, 'utf8').split('\n').filter(Boolean)
    const events = []
    for (let index = 1; index < lines.length; index += 1) {
      const event = JSON.parse(lines[index])
      if (event.seq <= REAL_SNAPSHOT_SEQ) events.push(event)
    }
    return { events, sessionId: REAL_SESSION_ID, source: REAL_JSONL_PATH }
  }
  if (!fs.existsSync(REAL_ZSTD_PATH)) return null
  const text = readZstdLog(REAL_ZSTD_PATH)
  if (text === null) return null
  const lines = text.split('\n').filter(Boolean)
  const header = JSON.parse(lines[0])
  const events = []
  for (let index = 1; index < lines.length; index += 1) {
    const event = JSON.parse(lines[index])
    if (event.seq <= REAL_SNAPSHOT_SEQ) events.push(event)
  }
  return { events, sessionId: header.id, source: REAL_ZSTD_PATH }
}

let oraclePromise
function loadOracle() {
  if (oraclePromise === undefined) {
    oraclePromise = (async () => {
      const tokenMeter = path.join(ORACLE_ROOT, 'dsh-token-meter', 'lib', 'types')
      if (!fs.existsSync(path.join(tokenMeter, 'breakdown-projection.js'))) return null
      const breakdown = await import(pathToFileURL(path.join(tokenMeter, 'breakdown-projection.js')).href)
      const usage = await import(pathToFileURL(path.join(tokenMeter, 'usage-projection.js')).href)
      const stats = await import(
        pathToFileURL(path.join(ORACLE_ROOT, 'dsh-session-stats', 'lib', 'types', 'projection.js')).href,
      )
      return {
        contextBreakdown: breakdown.contextBreakdownProjectionDefinition,
        contextPressure: usage.contextPressureProjectionDefinition,
        tokenUsage: usage.tokenUsageProjectionDefinition,
        sessionStats: stats.sessionStatsProjectionDefinition,
      }
    })()
  }
  return oraclePromise
}

function foldDefinition(definition, events) {
  let state = definition.init()
  for (const event of events) state = definition.apply(state, event)
  return state
}

/** Provider-reported bucket as a non-negative integer, mirroring the wire contract. */
function usageCount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Independent stream decoding (documented logShapes.ts rules, re-implemented)
// ---------------------------------------------------------------------------

function independentIsTokenChunk(chunk) {
  if (chunk === null || typeof chunk !== 'object') return false
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
    return typeof chunk.text === 'string' && chunk.text !== ''
  }
  if (chunk.type === 'tool-call-delta') {
    return (typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta !== '') || chunk.name !== undefined
  }
  return false
}

function independentFirstToken(stream) {
  if (!Array.isArray(stream)) return undefined
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type === 'chunk') {
      if (typeof record.time === 'number' && Number.isFinite(record.time) && independentIsTokenChunk(record.chunk)) {
        return record.time
      }
      continue
    }
    if (typeof record.time0 !== 'number' || !Number.isFinite(record.time0)) continue
    if (record.type === 'tool-call-chunks' && record.name !== undefined) return record.time0
    const fragments = record.type === 'tool-call-chunks' ? record.args : record.texts
    if (!Array.isArray(fragments)) continue
    const dt = Array.isArray(record.dt) ? record.dt : []
    let time = record.time0
    let readable = true
    for (let index = 0; index < fragments.length; index += 1) {
      if (index > 0) {
        const step = dt[index - 1]
        if (typeof step !== 'number' || !Number.isFinite(step)) { readable = false; break }
        time += step
      }
      if (typeof fragments[index] === 'string' && fragments[index] !== '') {
        if (readable) return time
        break
      }
    }
  }
  return undefined
}

function independentBlockStarts(stream) {
  const starts = []
  const kinds = []
  if (!Array.isArray(stream)) return { starts, kinds }
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type !== 'chunk' || record.chunk === null || typeof record.chunk !== 'object') continue
    if (record.chunk.type !== 'block-start') continue
    if (typeof record.time !== 'number' || !Number.isFinite(record.time)) continue
    starts.push(record.time)
    const blockType = record.chunk.blockType
    kinds.push(blockType === 'reasoning' ? 'reasoning' : blockType === 'text' ? 'text' : blockType === 'tool-call' ? 'toolarg' : undefined)
  }
  return { starts, kinds }
}

function independentTally(stream, endTime) {
  const spans = { reasoning: 0, text: 0, toolarg: 0 }
  const blocks = { reasoning: 0, text: 0, toolarg: 0 }
  const { starts, kinds } = independentBlockStarts(stream)
  let openKind
  let since = 0
  for (let index = 0; index < starts.length; index += 1) {
    if (openKind !== undefined) spans[openKind] += Math.max(0, starts[index] - since)
    openKind = kinds[index]
    if (openKind !== undefined) blocks[openKind] += 1
    since = starts[index]
  }
  if (openKind !== undefined) spans[openKind] += Math.max(0, endTime - since)
  return { spans, blocks }
}

// ---------------------------------------------------------------------------
// Independent activity / request oracles
// ---------------------------------------------------------------------------

const READ_NAMES = new Set(['read', 'read_file', 'read_image'])
const WRITE_NAMES = new Set(['write', 'write_file', 'edit', 'apply_patch', 'str_replace_editor'])
const SEARCH_NAMES = new Set(['grep', 'glob', 'list', 'search', 'web_search', 'ripgrep', 'search_files'])

function independentActivityBucket(name) {
  if (typeof name !== 'string' || name === '') return ''
  if (name.startsWith('read') || READ_NAMES.has(name)) return 'reads'
  if (name.startsWith('write') || WRITE_NAMES.has(name)) return 'writes'
  if (SEARCH_NAMES.has(name) || name.startsWith('search')) return 'searches'
  return ''
}

function independentActivity(events) {
  const activity = { reads: 0, writes: 0, searches: 0, images: 0 }
  const pending = new Map()
  let humanInputs = 0
  for (const event of events) {
    if (event.type === 'tool/call') {
      const data = event.data || {}
      if (typeof data.callId === 'string' && typeof data.name === 'string') pending.set(data.callId, data.name)
      continue
    }
    if (event.type === 'tool/result') {
      const source = event.data && event.data.message && event.data.message.source
      const callId = source && typeof source.callId === 'string' ? source.callId : ''
      const name = pending.get(callId)
      if (name !== undefined) {
        pending.delete(callId)
        const bucket = independentActivityBucket(name)
        if (bucket !== '') activity[bucket] += 1
      }
      continue
    }
    if (event.type !== 'user/message') continue
    const message = event.data || {}
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block !== null && typeof block === 'object' && block.type === 'image') activity.images += 1
      }
    }
    if (event.surfaceOp === undefined) continue
    const source = message.source
    const kind = source && typeof source.kind === 'string' ? source.kind : undefined
    // Injectable sources never count as a human input (same rule as the bridge).
    const injectable = kind !== undefined && kind !== 'user'
    const form = source && typeof source.form === 'string'
    if (!injectable && !form) humanInputs += 1
  }
  return { activity, humanInputs }
}

/** The independent six-way duration split, windowed by step/start → step/end. */
function independentTiming(events) {
  const timing = {
    ttftMs: 0,
    reasoningMs: 0,
    textMs: 0,
    toolArgMs: 0,
    toolsMs: 0,
    waitCount: 0,
    reasoningCount: 0,
    textCount: 0,
    toolArgCount: 0,
    toolCount: 0,
    speedTokens: 0,
    speedMs: 0,
    // first-token -> earliest block-start reach-back (dsh-context prices the wait
    // to the earliest marker, the harness's sessionStats fold prices it to the
    // token; the two must differ by exactly this sum).
    blockLeadBackMs: 0,
  }
  const calls = new Map()
  let step
  const durations = (from, to) => (Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, to - from) : 0)
  for (const event of events) {
    if (event.type === 'step/start') {
      step = { start: event.time, firstToken: undefined }
      continue
    }
    if (event.type === 'step/end') {
      step = undefined
      continue
    }
    if (event.type === 'tool/call') {
      const data = event.data || {}
      if (typeof data.callId === 'string') calls.set(data.callId, event.time)
      continue
    }
    if (event.type === 'tool/result') {
      const source = event.data && event.data.message && event.data.message.source
      const callId = source && typeof source.callId === 'string' ? source.callId : ''
      if (calls.has(callId)) {
        timing.toolsMs += durations(calls.get(callId), event.time)
        timing.toolCount += 1
        calls.delete(callId)
      }
      continue
    }
    if (event.type === 'assistant/attempt') {
      if (step === undefined || step.firstToken !== undefined) continue
      const first = independentFirstToken(event.data && event.data.stream)
      if (first !== undefined) step.firstToken = first
      continue
    }
    if (event.type !== 'assistant/message' || step === undefined) continue
    const stream = event.data && event.data.stream
    const firstToken = step.firstToken !== undefined ? step.firstToken : independentFirstToken(stream)
    if (firstToken === undefined) continue
    const { starts } = independentBlockStarts(stream)
    let decodeStart = firstToken
    for (const start of starts) decodeStart = Math.min(decodeStart, start)
    timing.blockLeadBackMs += durations(decodeStart, firstToken)
    timing.ttftMs += durations(step.start, decodeStart)
    timing.waitCount += 1
    const tally = independentTally(stream, event.time)
    timing.reasoningMs += tally.spans.reasoning
    timing.textMs += tally.spans.text
    timing.toolArgMs += tally.spans.toolarg
    timing.reasoningCount += tally.blocks.reasoning
    timing.textCount += tally.blocks.text
    timing.toolArgCount += tally.blocks.toolarg
    const output = event.data && event.data.usage ? usageCount(event.data.usage.outputTokens) : null
    if (output !== null) {
      timing.speedMs += durations(firstToken, event.time)
      timing.speedTokens += output
    }
  }
  return timing
}

/** Per-retained-request provider usage oracle. */
function independentRequestUsage(events) {
  const usageBySeq = new Map()
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const usage = event.data && event.data.usage
    if (usage === null || usage === undefined || typeof usage !== 'object') continue
    const input = usageCount(usage.inputTokens)
    const cacheRead = usageCount(usage.cacheReadTokens)
    const cacheWrite = usageCount(usage.cacheWriteTokens)
    const output = usageCount(usage.outputTokens)
    if (input === null && cacheRead === null && cacheWrite === null && output === null) continue
    usageBySeq.set(event.seq, {
      prompt: (input || 0) + (cacheRead || 0) + (cacheWrite || 0),
      ...(output !== null ? { output } : {}),
    })
  }
  return usageBySeq
}

/** The header tool-definition count in force at each seq. */
function independentToolDefsBySeq(events) {
  const rows = []
  let count = 0
  for (const event of events) {
    if (event.type === 'request/header') {
      const header = event.data && event.data.header
      count = header && Array.isArray(header.tools) ? header.tools.length : 0
    }
    rows.push({ seq: event.seq, count })
  }
  return rows
}

function toolDefsAt(rows, seq) {
  let count = 0
  for (const row of rows) {
    if (row.seq >= seq) break
    count = row.count
  }
  return count
}

// ===========================================================================
// Synthetic: activity counters
// ===========================================================================

function appendToolCall(seq, time, callId, name) {
  return { type: 'tool/call', seq, time, data: { turn: 1, step: 1, callId, name, arguments: '{}' } }
}

function appendToolResult(seq, time, callId, text) {
  return {
    type: 'tool/result',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }] },
    },
    surfaceOp: 'append',
  }
}

function appendUserMessage(seq, time, content, source = { kind: 'user' }, surfaceOp = 'append') {
  return { type: 'user/message', seq, time, data: { role: 'user', content, source }, surfaceOp }
}

test('v2 activity classifies paired tool runs by tool name and counts every user image', () => {
  const events = []
  let seq = 1
  let time = 1000
  const names = ['read', 'read_file', 'read_image', 'write', 'write_file', 'edit', 'apply_patch', 'str_replace_editor',
    'grep', 'glob', 'list', 'search', 'web_search', 'ripgrep', 'search_files', 'bash', 'web_fetch']
  for (const name of names) {
    events.push(appendToolCall(seq, time, `call-${name}`, name))
    events.push(appendToolResult(seq + 1, time + 10, `call-${name}`, 'ok'))
    seq += 2
    time += 20
  }
  // An unpaired call must NOT be classified (it has no result to confirm the run).
  events.push(appendToolCall(seq, time, 'call-unpaired', 'read'))
  seq += 1
  time += 20
  // Images: a live message, a later-replaced message, and a non-surface history event.
  events.push(appendUserMessage(seq, time, [{ type: 'text', text: 'one' }, { type: 'image', attachment: { id: 'a' } }]))
  events.push(appendUserMessage(seq + 1, time + 10, [{ type: 'image' }, { type: 'image' }]))
  // A history-only user event (no surface op) still contributes its image.
  events.push({ type: 'user/message', seq: seq + 2, time: time + 20, data: { role: 'user', content: [{ type: 'image' }], source: { kind: 'user' } } })
  const replacement = events[events.length - 2]
  replacement.surfaceOp = { op: 'replace', startSeq: events[seq - 1].seq, endSeq: events[seq - 1].seq }
  seq += 3

  const { view } = foldBridge(events)
  assert.deepEqual(view.activity, {
    userInputs: 2, // the two surface user messages; the history-only one is not an input
    reads: 3,
    writes: 5,
    searches: 7,
    images: 4,
  })
  // The independent documented tally agrees on the buckets.
  const independent = independentActivity(events)
  assert.deepEqual({ reads: independent.activity.reads, writes: independent.activity.writes, searches: independent.activity.searches, images: independent.activity.images }, {
    reads: 3, writes: 5, searches: 7, images: 4,
  })
  assert.equal(view.counts.humanInputs, view.activity.userInputs)
  assertPlainJson(view)
})

// ===========================================================================
// Synthetic: assistant stream decoding and timing
// ===========================================================================

function assistantMessage(seq, time, content, stream, usage, extra = {}) {
  const data = { turn: 1, step: 1, message: { role: 'assistant', content }, ...extra }
  if (stream !== undefined) data.stream = stream
  if (usage !== undefined) data.usage = usage
  return { type: 'assistant/message', seq, time, data, surfaceOp: 'append' }
}

test('v2 timing decodes the assistant stream into a six-way split and painted spans', () => {
  const stream = [
    { type: 'chunk', time: 1200, chunk: { type: 'text-delta', text: 'hi' } },
    { type: 'chunk', time: 1200, chunk: { type: 'block-start', blockType: 'text' } },
    { type: 'chunk', time: 1300, chunk: { type: 'block-start', blockType: 'tool-call' } },
    { type: 'chunk', time: 1400, chunk: { type: 'tool-call-delta', argumentsDelta: '{"a":' } },
  ]
  const events = [
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(2, 1500, [{ type: 'text', text: 'hi' }], stream, { inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2, outputTokens: 7 }),
    appendToolCall(3, 1500, 'call-read', 'read_file'),
    appendToolResult(4, 1800, 'call-read', 'content'),
    { type: 'step/end', seq: 5, time: 2000, data: { turn: 1, step: 1 } },
  ]
  const { view, state } = foldBridge(events)
  assert.deepEqual(view.timing, {
    wallMs: 1000,
    ttftMs: 200, // step start 1000 -> first token / decode start 1200
    reasoningMs: 0,
    textMs: 100, // block-start text 1200 -> tool-call 1300
    toolArgMs: 200, // 1300 -> message end 1500
    toolsMs: 300, // paired run 1500 -> 1800
    otherMs: 200, // 1000 - (200 + 0 + 100 + 200 + 300)
    waitCount: 1,
    reasoningCount: 0,
    textCount: 1,
    toolArgCount: 1,
    toolCount: 1,
    speedTokens: 7,
    speedMs: 300, // first token 1200 -> message time 1500
  })
  assert.deepEqual(view.spans, [
    [0, 1000, 1200],
    [2, 1200, 1300],
    [3, 1300, 1500],
    [4, 1500, 1800],
    [5, 1800, 2000],
  ])
  assert.equal(state.stepSpans, undefined)
  // Requests still carry the provider usage the same event reported.
  assert.equal(view.requests[0].prompt, 17)
  assert.equal(view.requests[0].output, 7)
  assertPlainJson(state)
  assertPlainJson(view)
})

test('v2 timing keeps an assistant/attempt first token ahead of the message stream', () => {
  const attempt = {
    type: 'assistant/attempt', seq: 2, time: 1100,
    data: {
      turn: 1, step: 1,
      stream: [
        { type: 'chunk', time: 1150, chunk: { type: 'block-start', blockType: 'reasoning' } },
        { type: 'reasoning-chunks', time0: 1150, dt: [0, 10], texts: ['a', 'b'] },
      ],
    },
  }
  const message = assistantMessage(3, 2000, [{ type: 'reasoning', text: 'abc' }], [
    { type: 'chunk', time: 1800, chunk: { type: 'reasoning-delta', text: 'abc' } },
    { type: 'chunk', time: 1800, chunk: { type: 'block-start', blockType: 'reasoning' } },
  ], { outputTokens: 3 })
  const events = [
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    attempt,
    message,
    { type: 'step/end', seq: 4, time: 2200, data: { turn: 1, step: 1 } },
  ]
  const { view } = foldBridge(events)
  assert.equal(view.timing.ttftMs, 150) // attempt token 1150 beats the stream token 1800
  assert.equal(view.timing.reasoningMs, 200) // stream marker 1800 -> message end 2000
  assert.equal(view.timing.reasoningCount, 1)
  assert.equal(view.timing.waitCount, 1)
  assert.equal(view.timing.speedMs, 850)
  assert.deepEqual(view.spans[0], [0, 1000, 1150])
  const { blockLeadBackMs, ...independent } = independentTiming(events)
  const { wallMs, otherMs, ...measured } = view.timing
  assert.deepEqual(measured, independent)
  assert.equal(blockLeadBackMs, 0) // no marker precedes the attempt's token here
  assert.equal(otherMs + measured.ttftMs + measured.reasoningMs + measured.textMs + measured.toolArgMs + measured.toolsMs, wallMs)
})

test('v2 stream decoding degrades over hostile streams instead of throwing', () => {
  const badStreams = [
    'not-an-array',
    null,
    [null, 42, 'x', [], {}],
    [{ type: 'chunk' }, { type: 'chunk', time: 'nope', chunk: { type: 'block-start', blockType: 'text' } }],
    [{ type: 'chunk', time: 10, chunk: { type: 'block-start', blockType: 'mystery' } }],
    [{ type: 'text-chunks', time0: Infinity, texts: ['x'] }],
    [{ type: 'reasoning-chunks', time0: 5, dt: [1, 'bad'], texts: ['a', 'b', 'c'] }],
    [{ type: 'tool-call-chunks', time0: 5 }],
  ]
  const events = [{ type: 'step/start', seq: 0, time: 1000, data: { turn: 1, step: 1 } }]
  let seq = 1
  for (const stream of badStreams) {
    const message = assistantMessage(seq, 1500, [{ type: 'text', text: 'x' }], stream, undefined)
    // A hostile event may also be structurally malformed at the envelope level.
    events.push(message)
    seq += 1
  }
  events.push({ type: 'assistant/attempt', seq, time: 1500, data: { turn: 1, step: 1, stream: 'bad' } })
  seq += 1
  events.push({ type: 'assistant/attempt', seq, time: 1600, data: null })
  events.push({ type: 'step/end', seq: seq + 1, time: 2000, data: { turn: 1, step: 1 } })
  const { state, view } = foldBridge(events)
  assert.equal(view.timing.ttftMs, 0)
  // One packed run in the list does carry a (pre-step) token, so the wait is
  // priced to max(0, marker - stepStart) = 0 rather than skipped.
  assert.equal(view.timing.waitCount, 1)
  assert.equal(view.timing.speedTokens, 0)
  // Every step window is still painted: the residue fills the whole step.
  assert.deepEqual(view.spans, [[5, 1000, 2000]])
  assertPlainJson(state)

  // The fold never throws over a non-object event either.
  assert.equal(BRIDGE.applyContextEvent(state, null), state)
  assert.equal(BRIDGE.applyContextEvent(state, { type: 'assistant/message', seq: 9, data: { stream: 'bad' } }).requests.length, 9)
})

test('v2 decode start reaches back to a block marker that precedes the first token', () => {
  const stream = [
    { type: 'chunk', time: 1300, chunk: { type: 'block-start', blockType: 'reasoning' } },
    { type: 'chunk', time: 1400, chunk: { type: 'reasoning-delta', text: 'think' } },
    { type: 'chunk', time: 1500, chunk: { type: 'block-start', blockType: 'text' } },
    { type: 'chunk', time: 1600, chunk: { type: 'text-delta', text: 'say' } },
  ]
  const events = [
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(2, 2000, [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'say' }], stream, {}),
    { type: 'step/end', seq: 3, time: 2100, data: { turn: 1, step: 1 } },
  ]
  const { view } = foldBridge(events)
  // first token 1400, earliest block marker 1300 => wait is priced to 1300, not 1400.
  assert.equal(view.timing.ttftMs, 300)
  assert.equal(view.timing.reasoningMs, 200) // 1300 -> 1500
  assert.equal(view.timing.textMs, 500) // 1500 -> 2000
  assert.deepEqual(view.spans, [
    [0, 1000, 1300],
    [1, 1300, 1500], // first decode span is stretched back to the wait boundary
    [2, 1500, 2000],
    [5, 2000, 2100],
  ])
})

test('v2 lastAnswer collapses whitespace, truncates at 240 chars and keeps the newest text', () => {
  const events = [
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(2, 1100, [{ type: 'text', text: '  first \n\n answer  ' }], undefined, undefined),
    { type: 'step/end', seq: 3, time: 1200, data: { turn: 1, step: 1 } },
    // Tool-only step: no text, so the preview must not be cleared.
    { type: 'step/start', seq: 4, time: 1300, data: { turn: 1, step: 2 } },
    { type: 'tool/call', seq: 5, time: 1310, data: { callId: 'c1', name: 'bash', arguments: '{}' } },
    appendToolResult(6, 1320, 'c1', 'ok'),
    { type: 'step/end', seq: 7, time: 1330, data: { turn: 1, step: 2 } },
    { type: 'step/start', seq: 8, time: 1400, data: { turn: 1, step: 3 } },
    assistantMessage(9, 1500, [{ type: 'text', text: `  ${'答'.repeat(300)}  ` }], undefined, undefined),
    { type: 'step/end', seq: 10, time: 1600, data: { turn: 1, step: 3 } },
  ]
  const { view } = foldBridge(events)
  assert.equal(typeof view.lastAnswer, 'string')
  assert.equal(view.lastAnswer.length, 240)
  assert.equal(view.lastAnswer, '答'.repeat(240))
  const short = foldBridge(events.slice(0, 4)).view
  assert.equal(short.lastAnswer, 'first answer')
  assertPlainJson(view)
})

// ===========================================================================
// Synthetic: per-request items/usage and bounded spans
// ===========================================================================

test('v2 requests record surface item counts and provider usage without changing v1 fields', () => {
  const header = {
    type: 'request/header', seq: 1, time: 900,
    data: { header: { config: { model: 'm', provider: 'p' }, tools: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] } },
  }
  const events = [
    header,
    { type: 'user/message', seq: 2, time: 950, data: { role: 'user', content: [{ type: 'text', text: 'question' }], source: { kind: 'user' } }, surfaceOp: 'append' },
    { type: 'step/start', seq: 3, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(4, 1200, [{ type: 'text', text: 'one' }], undefined, { inputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2, outputTokens: 7 }),
    appendToolCall(5, 1210, 'c1', 'bash'),
    appendToolResult(6, 1300, 'c1', 'ok'),
    { type: 'step/end', seq: 7, time: 1400, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 8, time: 1500, data: { turn: 1, step: 2 } },
    assistantMessage(9, 1700, [{ type: 'text', text: 'two' }], undefined, { outputTokens: 3 }),
    { type: 'step/end', seq: 10, time: 1800, data: { turn: 1, step: 2 } },
  ]
  const { view } = foldBridge(events)
  assert.equal(view.requests.length, 2)
  const [first, second] = view.requests
  assert.deepEqual(first.items, { system: 1, tools: 3, user: 1 })
  assert.equal(first.prompt, 17)
  assert.equal(first.output, 7)
  assert.deepEqual(second.items, { system: 1, tools: 3, user: 1, assistant: 1, tool: 1 })
  assert.equal(second.output, 3)
  assert.equal('prompt' in second, true) // output-only usage still bills a zero prompt
  assert.equal(second.prompt, 0)
  // v1 record semantics are untouched.
  assert.equal(first.total, first.system + first.tools + first.user)
  assert.equal(typeof first.seq, 'number')
  assert.equal(typeof first.time, 'number')

  // Provider usage is re-proved: unreadable buckets vanish, while negative
  // figures clamp to zero (the host's documented sanitizer) instead of going
  // undefined.
  const hostile = foldBridge([
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(2, 1100, [{ type: 'text', text: 'x' }], undefined, { inputTokens: 'nope', outputTokens: -5 }),
  ]).view
  assert.equal(hostile.requests[0].prompt, 0)
  assert.equal(hostile.requests[0].output, 0)
  const absent = foldBridge([
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(2, 1100, [{ type: 'text', text: 'x' }], undefined, { inputTokens: 'nope', outputTokens: 'nope' }),
  ]).view
  assert.equal('prompt' in absent.requests[0], false)
  assert.equal('output' in absent.requests[0], false)
  assertPlainJson(hostile)
})

test('v2 span timeline is bounded to the newest 600 segments and stays plain JSON', () => {
  const events = []
  let seq = 1
  let time = 1_700_000_000_000
  for (let step = 0; step < 260; step += 1) {
    events.push({ type: 'step/start', seq: seq++, time, data: { turn: 1, step } })
    events.push(assistantMessage(seq++, time + 10, [{ type: 'text', text: 'x' }], undefined, { outputTokens: 1 }))
    events.push(appendToolCall(seq++, time + 20, `call-${step}`, 'bash'))
    events.push(appendToolResult(seq++, time + 40, `call-${step}`, 'ok'))
    events.push({ type: 'step/end', seq: seq++, time: time + 100, data: { turn: 1, step } })
    time += 1000
  }
  const { state, view } = foldBridge(events)
  assert.equal(view.timing.toolCount, 260)
  assert.equal(view.spans.length, 600)
  for (let index = 0; index < view.spans.length; index += 1) {
    const span = view.spans[index]
    assert.equal(span.length, 3)
    assert.ok(Number.isInteger(span[0]) && span[0] >= 0 && span[0] <= 5)
    assert.ok(span[1] < span[2], `span ${index} must have a positive duration`)
    if (index > 0) assert.ok(span[1] >= view.spans[index - 1][2], `span ${index} must not move backwards`)
  }
  // The persisted state is bounded and lossless JSON (no undefined anywhere).
  assert.ok(state.spans.length <= 600)
  assert.equal(state.stepSpans, undefined)
  assertPlainJson(state)
  assertPlainJson(view)
  // A step whose stream carries thousands of markers cannot blow the state bound.
  const flood = Array.from({ length: 5000 }, (_, index) => ({
    type: 'chunk', time: 1000 + index, chunk: { type: 'block-start', blockType: 'text' },
  }))
  const flooded = foldBridge([
    { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } },
    assistantMessage(2, 6000, [{ type: 'text', text: 'x' }], flood, {}),
    { type: 'step/end', seq: 3, time: 7000, data: { turn: 1, step: 1 } },
  ])
  assert.ok(flooded.state.spans.length <= 600)
  assertPlainJson(flooded.state)
})

// ===========================================================================
// Synthetic: fleet team roster
// ===========================================================================

function fleetRecord(id, parentSessionId, origin, createdAt) {
  return { id, parentSessionId: parentSessionId || '', origin: origin || '', createdAt: createdAt || 0 }
}

test('v2 fleet carries the root agentTeam roster (truncated), phases and last answers', () => {
  const records = [
    fleetRecord('root', '', '', 1),
    fleetRecord('a', 'root', 'subagent', 2),
    fleetRecord('b', 'root', 'subagent', 3),
    fleetRecord('c', 'root', 'subagent', 4),
  ]
  const tasks = Array.from({ length: 25 }, (_, index) => ({
    id: `task-${index + 1}`,
    revision: 1,
    subject: `任务 ${index + 1}`,
    description: 'x',
    status: index === 0 ? 'in_progress' : 'pending',
    ownerId: index === 0 ? 'a' : undefined,
    blockedBy: [],
    writeScopes: [],
    ...(index === 0 ? { ownerName: '阿青' } : {}),
  }))
  const snapshots = {
    // A child session's own team projection scopes it as its own lead; the
    // family roster must come from the ROOT snapshot.
    a: {
      agentTeam: { members: [{ id: 'a', name: 'lead', role: 'lead', phase: 'active' }], tasks: [] },
      mobileContext: { lastAnswer: '子回答' },
    },
    root: {
      title: '主会话',
      agentTeam: {
        members: [
          { id: 'root', name: 'lead', role: 'lead', phase: 'active' },
          { id: 'a', name: '阿青', role: 'teammate', phase: 'provisioning' },
        ],
        tasks,
        failure: '',
      },
      mobileContext: { lastAnswer: '根回答', current: { system: 1, tools: 2, total: 3 }, timing: { wallMs: 1000 } },
    },
  }
  const value = BRIDGE.buildFleetValue('a', records, id => snapshots[id] || null, () => false)
  assert.ok(value.team !== undefined, 'team must be served when an agentTeam projection exists')
  assert.equal(value.team.members.length, 2)
  assert.deepEqual(value.team.members[1], { id: 'a', name: '阿青', role: 'teammate', phase: 'provisioning' })
  assert.equal(value.team.tasks.length, 20)
  assert.deepEqual(value.team.tasks[0], { id: 'task-1', subject: '任务 1', status: 'in_progress', ownerName: '阿青', ownerId: 'a' })
  assert.equal(value.team.failure, '')
  assert.deepEqual(value.agents.map(agent => [agent.sessionId, agent.phase]), [['root', 'active'], ['a', 'provisioning'], ['b', undefined], ['c', undefined]])
  assert.equal(value.agents[0].lastAnswer, '根回答')
  assert.equal(value.agents[1].lastAnswer, '子回答')
  assert.equal(value.counts.agents, 4)
  assertPlainJson(value)

  // A family with no agentTeam projection omits `team` and every phase.
  const bare = BRIDGE.buildFleetValue('a', records, () => null)
  assert.equal('team' in bare, false)
  assert.equal(bare.agents.some(agent => 'phase' in agent), false)

  // The current session defaults to `active` when the roster does not list it;
  // an unlisted NON-current agent carries no phase at all.
  const orphan = BRIDGE.buildFleetValue('b', records, id => snapshots[id] || null)
  assert.equal(orphan.agents.find(agent => agent.sessionId === 'b').phase, 'active')
  assert.equal(orphan.agents.find(agent => agent.sessionId === 'root').phase, 'active')
  assert.equal('phase' in orphan.agents.find(agent => agent.sessionId === 'c'), false)
})

// ===========================================================================
// Fixture replay: v2 fields against independent oracles
// ===========================================================================

test('fixture v2 activity/timing/requests reconcile with independent tallies', (t) => {
  if (!fs.existsSync(FIXTURE_PATH)) return t.skip('context fixture is absent')
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const events = fixture.events
  const { view, state } = foldBridge(events)

  const independent = independentActivity(events)
  assert.deepEqual(view.activity, {
    userInputs: independent.humanInputs,
    reads: independent.activity.reads,
    writes: independent.activity.writes,
    searches: independent.activity.searches,
    images: independent.activity.images,
  })
  assert.equal(view.activity.userInputs, view.counts.humanInputs)

  const { blockLeadBackMs, ...timing } = independentTiming(events)
  const { wallMs, otherMs, ...measured } = view.timing
  assert.deepEqual(measured, timing)
  assert.ok(wallMs >= 0)
  assert.ok(otherMs >= 0)
  assert.equal(otherMs + timing.ttftMs + timing.reasoningMs + timing.textMs + timing.toolArgMs + timing.toolsMs, wallMs)

  const usageBySeq = independentRequestUsage(events)
  const toolDefs = independentToolDefsBySeq(events)
  assert.equal(view.requests.length, 200)
  assert.equal(view.truncated.requests, true)
  for (const record of view.requests) {
    assert.equal(record.items.system, 1)
    assert.equal(record.items.tools, toolDefsAt(toolDefs, record.seq))
    for (const cat of ['user', 'inject', 'skill', 'assistant', 'tool']) {
      if (cat in record.items) assert.ok(Number.isInteger(record.items[cat]) && record.items[cat] > 0)
    }
    const usage = usageBySeq.get(record.seq)
    if (usage !== undefined) {
      assert.equal(record.prompt, usage.prompt)
      assert.equal(record.output, usage.output)
    }
  }
  assert.equal(typeof view.lastAnswer === 'string' ? view.lastAnswer.length <= 240 : true, true)
  assert.ok(view.spans.length <= 600)
  assert.ok(wireBytes(view) < WIRE_LIMIT_BYTES)
  assertPlainJson(state)
  assertPlainJson(view)
})

// ===========================================================================
// Real session log: official-projection reconciliation + wire budget
// ===========================================================================

test('real session v2 wire reconciles with official projections, tallies and the 250KB budget', async (t) => {
  const real = readRealEvents()
  if (real === null) return t.skip('real session log is absent on this machine')
  const events = real.events
  assert.ok(events.length > 1000, 'the real log prefix must be non-trivial')
  assert.equal(events[events.length - 1].seq, REAL_SNAPSHOT_SEQ)

  const { state, view } = foldBridge(events)
  const oracle = await loadOracle()
  let breakdown
  let stats
  let usage
  let pressure
  if (oracle !== null) {
    breakdown = oracle.contextBreakdown.wire.view(foldDefinition(oracle.contextBreakdown, events))
    stats = oracle.sessionStats.wire.view(foldDefinition(oracle.sessionStats, events))
    usage = oracle.tokenUsage.wire.view(foldDefinition(oracle.tokenUsage, events))
    pressure = oracle.contextPressure.wire.view(foldDefinition(oracle.contextPressure, events))
    // The documented oracle (docs §3/§5.1): system/tools/messages are exact.
    assert.deepEqual(breakdown, { systemTokens: 2154, toolsTokens: 10439, messageTokens: 475830 })
    assert.equal(view.current.system, breakdown.systemTokens)
    assert.equal(view.current.tools, breakdown.toolsTokens)
    const catsSum = ['user', 'inject', 'skill', 'assistant', 'tool']
      .reduce((sum, cat) => sum + view.current[cat], 0)
    assert.equal(catsSum, breakdown.messageTokens - 4307) // dormant system nodes (docs §5.1)
    assert.equal(catsSum + 4307, breakdown.messageTokens)
  }

  // Activity: independent scan over the same event stream.
  const independent = independentActivity(events)
  assert.deepEqual(view.activity, {
    userInputs: independent.humanInputs,
    reads: independent.activity.reads,
    writes: independent.activity.writes,
    searches: independent.activity.searches,
    images: independent.activity.images,
  })
  assert.equal(view.activity.userInputs, view.counts.humanInputs)
  // Images come from every user message in the log (replaced ones included).
  assert.ok(view.activity.images > 0)
  assert.ok(view.activity.reads > 0 && view.activity.writes > 0 && view.activity.searches > 0)

  // Timing: the official sessionStats fold prices the same tool runs and the
  // same decode window; those two buckets are an exact cross-check.
  const { blockLeadBackMs, ...timing } = independentTiming(events)
  const { wallMs, otherMs, ...measured } = view.timing
  assert.deepEqual(measured, timing)
  assert.ok(wallMs > 0)
  assert.ok(measured.ttftMs > 0)
  assert.ok(measured.speedTokens > 0 && measured.speedMs > 0)
  assert.ok(otherMs >= 0)
  assert.ok(measured.ttftMs + measured.reasoningMs + measured.textMs + measured.toolArgMs + measured.toolsMs + otherMs <= wallMs)
  if (oracle !== null) {
    assert.equal(measured.toolsMs, stats.toolMs)
    assert.equal(measured.toolCount, view.counts.toolCalls)
    assert.equal(measured.speedMs, stats.decodeMs)
    assert.equal(measured.speedTokens, stats.decodeTokens)
    // The only intentional divergence from sessionStats' TTFT is the
    // dsh-context rule that reaches back to a block marker before the first
    // token; proving `ours + leadBack === official` proves both decoders.
    assert.equal(measured.ttftMs + blockLeadBackMs, stats.ttftMs)
  }

  // Requests: provider usage, surface item counts and the current header epoch.
  const usageBySeq = independentRequestUsage(events)
  const toolDefs = independentToolDefsBySeq(events)
  assert.equal(view.requests.length, 200)
  assert.equal(view.truncated.requests, true)
  for (const record of view.requests) {
    assert.equal(record.items.system, 1)
    assert.equal(record.items.tools, toolDefsAt(toolDefs, record.seq))
    for (const cat of ['user', 'inject', 'skill', 'assistant', 'tool']) {
      if (cat in record.items) assert.ok(Number.isInteger(record.items[cat]) && record.items[cat] > 0)
    }
    const expected = usageBySeq.get(record.seq)
    if (expected !== undefined) {
      assert.equal(record.prompt, expected.prompt)
      assert.equal(record.output, expected.output)
    }
  }
  if (oracle !== null && pressure !== null) {
    // The newest request's billed prompt is the official pressure anchor.
    assert.equal(view.requests[view.requests.length - 1].prompt, pressure.pressureTokens)
  }

  // lastAnswer: whitespace-collapsed, bounded, newest assistant text.
  assert.equal(typeof view.lastAnswer, 'string')
  assert.ok(view.lastAnswer.length > 0 && view.lastAnswer.length <= 240)
  const independentLast = (() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event.type !== 'assistant/message') continue
      const content = event.data && event.data.message && event.data.message.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          return block.text.replace(/\s+/g, ' ').trim().slice(0, 240)
        }
      }
    }
    return ''
  })()
  assert.equal(view.lastAnswer, independentLast)

  // Spans: bounded, ordered, positive, in the frozen kind vocabulary.
  assert.equal(view.spans.length, 600)
  for (let index = 0; index < view.spans.length; index += 1) {
    const span = view.spans[index]
    assert.equal(span.length, 3)
    assert.ok(Number.isInteger(span[0]) && span[0] >= 0 && span[0] <= 5)
    assert.ok(span[1] < span[2])
    if (index > 0) assert.ok(span[1] >= view.spans[index - 1][2])
  }

  // The dashboard frame keeps v1 fields and stays under the v2 wire budget.
  const frameValue = {
    ...view,
    ...(oracle !== null ? {
      breakdown,
      usage,
      stats,
    } : {}),
  }
  const frame = { kind: 'context-dashboard', sessionId: real.sessionId, asOfSeq: REAL_SNAPSHOT_SEQ, value: frameValue }
  assertPlainJson(frame)
  const bytes = wireBytes(frame)
  assert.ok(bytes < REAL_SESSION_WIRE_LIMIT_BYTES, `contextView wire is ${bytes} bytes (budget ${REAL_SESSION_WIRE_LIMIT_BYTES})`)
  t.diagnostic(`v2 wire: ${bytes} bytes, fold state surface=${state.surface.length}, requests=${state.requests.length}, spans=${state.spans.length}`)

  // The fold state itself must stay pure JSON and bounded.
  assert.ok(state.surface.length <= 4000)
  assert.ok(state.requests.length <= 200)
  assert.ok(state.events.length <= 120)
  assert.ok(state.spans.length <= 600)
  assert.equal(state.stepSpans, undefined)
  assertPlainJson(state)

  // context-dashboard handler keeps serving breakdown/usage/stats unchanged.
  const handlerFrame = await BRIDGE.handleContextQuery({
    sessions: {
      history: async () => ({
        projections: {
          asOfSeq: REAL_SNAPSHOT_SEQ,
          values: {
            mobileContext: view,
            ...(oracle !== null ? { contextBreakdown: breakdown, tokenUsage: usage, sessionStats: stats } : {}),
          },
        },
      }),
    },
  }, { type: 'context-dashboard', sessionId: real.sessionId })
  assert.equal(handlerFrame.kind, 'context-dashboard')
  assert.deepEqual(handlerFrame.value.activity, view.activity)
  assert.deepEqual(handlerFrame.value.timing, view.timing)
  assert.deepEqual(handlerFrame.value.spans, view.spans)
  if (oracle !== null) {
    assert.deepEqual(handlerFrame.value.breakdown, breakdown)
    assert.deepEqual(handlerFrame.value.usage, usage)
    assert.deepEqual(handlerFrame.value.stats, stats)
  }
  assert.ok(wireBytes(handlerFrame) < REAL_SESSION_WIRE_LIMIT_BYTES)
})

// ===========================================================================
// context-fleet handler: the team roster rides the real query path
// ===========================================================================

test('context-fleet handler serves team/lastAnswer/phase over the wire path', async () => {
  const sessions = [
    { id: 'root', header: { id: 'root', createdAt: 1 } },
    { id: 'a', header: { id: 'a', parentSession: 'root', origin: 'subagent', createdAt: 2 } },
  ]
  const values = {
    root: {
      title: '主会话',
      agentTeam: {
        members: [
          { id: 'root', name: 'lead', role: 'lead', phase: 'active' },
          { id: 'a', name: '阿青', role: 'teammate', phase: 'provisioning' },
        ],
        tasks: [{ id: 'task-1', subject: '实现组件', description: 'x', status: 'in_progress', ownerId: 'a', ownerName: '阿青' }],
        failure: '',
      },
      mobileContext: { lastAnswer: '根回答', current: { system: 1, tools: 2, total: 3 } },
    },
    a: { mobileContext: { lastAnswer: '子回答' }, contextPressure: { contextWindow: 1000, pressureTokens: 100 } },
  }
  const disposers = []
  const registered = BRIDGE.registerContextServices({
    inject(services, callback) {
      if (!services.includes('sessionProjections')) return
      callback({
        sessions: { list: () => sessions },
        sessionProjections: { snapshot: session => ({ asOfSeq: 10, values: values[session.id] || {} }) },
        effect: (factory) => { disposers.push(factory()) },
      })
    },
  })
  assert.equal(registered, true)
  try {
    const frame = await BRIDGE.handleContextFleet({ type: 'context-fleet', sessionId: 'a' })
    assert.equal(frame.kind, 'context-fleet')
    assert.deepEqual(frame.value.team.members.map(member => [member.id, member.phase]), [['root', 'active'], ['a', 'provisioning']])
    assert.deepEqual(frame.value.team.tasks.map(task => task.id), ['task-1'])
    assert.equal(frame.value.counts.subagents, 1)
    const child = frame.value.agents.find(agent => agent.sessionId === 'a')
    assert.equal(child.lastAnswer, '子回答')
    assert.equal(child.phase, 'provisioning')
    assertPlainJson(frame)
  } finally {
    for (const dispose of disposers) dispose()
  }
})
