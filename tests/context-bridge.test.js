// Oracle verification for the host-side `mobileContext` session projection
// (docs/context-dashboard.md §2/§3).
//
// The bridge in scripts/lib/context-bridge.mjs is verified against an
// *independent* oracle:
//   1. DSH's own `contextBreakdown` / `contextPressure` / `tokenUsage` /
//      `sessionStats` projection definitions folded over the same event stream;
//   2. a hand-written re-implementation of the documented pricing/classification
//      rules (independent of the bridge's code);
//   3. manual event tallies and a real, committed session-log fixture.
//
// The implementation is never imported for its own expectations: oracle state is
// always produced by folding the fixture / real log through the DSH definitions
// (or the documented formula) and only then compared.
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'context-session.json')
const BRIDGE_PATH = path.join(ROOT, 'scripts', 'lib', 'context-bridge.mjs')
const INSTALLER_PATH = path.join(ROOT, 'scripts', 'install-context-bridge.cjs')
const ORACLE_ROOT = path.join(ROOT, '.dsh-reference', 'dsh', 'node_modules', '@deepseek-ai')

// The real session this feature was specified against (docs example values).
const SESSIONS_ROOT = path.join(
  os.homedir(),
  '.dsh',
  'sessions',
  `--${ROOT.replace(/^[/\\]/, '').replace(/[/\\]/g, '-')}--`,
)
const REAL_SESSION_ID = 'session-1f4b49a8-4c3b-4ab3-8c29-997230702880'
const REAL_LOG_PATH = process.env.DSH_CONTEXT_SESSION_LOG
  || path.join(SESSIONS_ROOT, REAL_SESSION_ID, 'session.v4.jsonl.zstd')
const REAL_PROJ_CACHE_PATH = path.join(
  os.homedir(),
  '.dsh',
  'storages',
  'session_projcache',
  'sessions',
  `${REAL_SESSION_ID}.json`,
)
// The projection-cache snapshot the documented expected values were taken at.
const REAL_SNAPSHOT_SEQ = 32619

const LOCAL_PLUGINS = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'local-plugins')
const siblingWeappGateway = process.env.DSH_TEST_GATEWAY || path.resolve(ROOT, '..', 'dsh-plugin-weapp-gateway')
const weappGateway = fs.existsSync(path.join(siblingWeappGateway, 'package.json'))
  ? siblingWeappGateway
  : path.join(LOCAL_PLUGINS, 'dsh-plugin-weapp-gateway')
const GATEWAY_DIRS = [
  path.join(LOCAL_PLUGINS, 'dsh-plugin-mobile-gateway'),
  weappGateway,
]

const SURFACE_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
const MESSAGE_CATS = ['user', 'inject', 'skill', 'assistant', 'tool']
// v5 adds per-request `activeMs` (~17 bytes × 200 records ≈ 3.3KB) for the
// duration curve, so the synthetic worst case moved from ~200KB to ~204KB.
const WIRE_LIMIT_BYTES = 208 * 1024
// 真实会话样例（tests/fixtures/context-session.json，1.7MB）折叠后线路帧更大
const REAL_SESSION_WIRE_LIMIT_BYTES = 640 * 1024

// Values folded from the committed fixture (regenerate + recheck when the
// fixture changes; both DSH oracle and the hand-written fold must agree).
const FIXTURE_EXPECTED = {
  breakdown: { systemTokens: 1951, toolsTokens: 7492, messageTokens: 44873 },
  counts: { humanInputs: 17, answers: 126, toolCalls: 415, skillLoads: 0, injects: 23, compactions: 2, prunes: 13 },
  // v2 drops the request record cap to 200 to keep the bigger per-record wire
  // (items/prompt/output) inside the frame budget (docs §8.1).
  requests: 200,
  // 39 = 38 inject/compaction/prune + 1 model switch (dsh-context fold.ts records
  // change/resume headers whose model differs from the routed one).
  events: 39,
  contextEvents: { inject: 23, compaction: 2, prune: 13, model: 1, mode: 0 },
}

// The documented session snapshot (docs/context-dashboard.md §3 / task spec),
// folded from the real log prefix up to REAL_SNAPSHOT_SEQ.
const REAL_EXPECTED = {
  breakdown: { systemTokens: 2154, toolsTokens: 10439, messageTokens: 475830 },
  dormant: 4307,
  pressure: { contextWindow: 1048576, pressureTokens: 635457, projectedTokens: 635483 },
  pressureState: { surfaceTokens: 488376, sampledSurfaceTokens: 488350 },
  usage: {
    uncachedInputTokens: 18428410,
    outputTokens: 2005193,
    cacheReadTokens: 1418019922,
    cacheWriteTokens: 757534,
  },
  stats: {
    turns: 476,
    steps: 4586,
    llmMs: 42456270,
    toolMs: 12253849,
    ttftMs: 19504165,
    ttftSteps: 4566,
    decodeMs: 22898931,
    decodeTokens: 2005193,
  },
  current: { system: 2154, tools: 10439, user: 2893, inject: 7506, skill: 927, assistant: 321936, tool: 138261 },
  counts: { humanInputs: 502, answers: 1233, toolCalls: 4262, skillLoads: 5, injects: 278, compactions: 12, prunes: 42 },
  requests: 200,
  events: 120,
  surfaceNodes: 2289,
  model: 'deepseek-flash',
  provider: 'deepseek-account',
  contextWindow: 1048576,
}

// ---------------------------------------------------------------------------
// Independent reference folds (documented rules, not the bridge's code)
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

function independentStructuralBlock(block) {
  if (block !== null && typeof block === 'object' && block.type === 'image') {
    const reference = { ...block }
    delete reference.offloaded
    return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(reference).length / CHARS_PER_TOKEN)
  }
  return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
}

function independentContentTokens(blocks) {
  if (!Array.isArray(blocks)) return 0
  let tokens = 0
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') { tokens += independentStructuralBlock(block); continue }
    if (block.type === 'text' || block.type === 'reasoning') {
      tokens += Math.ceil((typeof block.text === 'string' ? block.text : '').length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
    } else if (block.type === 'tool-call') {
      tokens += Math.ceil((block.name || '').length / CHARS_PER_TOKEN)
        + Math.ceil((block.arguments || '').length / CHARS_PER_TOKEN)
        + BLOCK_OVERHEAD
    } else {
      tokens += independentStructuralBlock(block)
    }
  }
  return tokens
}

/** Price one model-visible message (docs §2 fixed-density heuristic). */
function independentMessageTokens(message) {
  if (message === null || message === undefined || typeof message !== 'object') return 0
  if (message.role === 'system') {
    const blocks = Array.isArray(message.content) ? message.content : []
    if (blocks.length === 0) return 0
    let characters = 0
    for (const block of blocks) {
      characters += block !== null && typeof block === 'object' && block.type === 'text'
        ? block.text.length
        : JSON.stringify(block).length
    }
    return Math.ceil(characters / CHARS_PER_TOKEN) + ROLE_OVERHEAD
  }
  return independentContentTokens(message.content) + ROLE_OVERHEAD
}

/** The derived model-visible message of a surface event (or null). */
function independentMessageOf(event) {
  const data = event.data
  if (data === null || typeof data !== 'object') return null
  if (event.type === 'user/message') return data
  if (event.type === 'system/message' || event.type === 'developer/message' || event.type === 'assistant/message') {
    const message = data.message
    if (message === null || typeof message !== 'object') return null
    if (!Array.isArray(message.content) || message.content.length === 0) return null
    return message
  }
  if (event.type === 'tool/result') return data.message !== null && typeof data.message === 'object' ? data.message : null
  return null
}

function canonicalHeaderToolsTokens(header) {
  if (header === null || typeof header !== 'object') return 0
  const adapterDefaults = header.adapterDefaults
  const canonical = {
    config: header.config,
    ...(adapterDefaults && (adapterDefaults.reasoningEffort === true || adapterDefaults.maxTokens === true)
      ? { adapterDefaults }
      : {}),
    ...(Array.isArray(header.tools) && header.tools.length > 0 ? { tools: header.tools } : {}),
  }
  if (!Array.isArray(canonical.tools) || canonical.tools.length === 0) return 0
  return Math.ceil(JSON.stringify(canonical.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

function independentSkillName(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  for (const block of message.content) {
    if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') continue
    const match = block.text.match(/<skill_content\s+name="([^"]+)"/)
    if (match !== null) return match[1]
  }
  return ''
}

/**
 * Fold the documented `current` composition independently of the bridge:
 * surface nodes, replacement splices, classification, and the "last non-empty
 * system node is the system prompt, older surviving system nodes are dormant"
 * rule.
 */
function independentSurface(events) {
  const nodes = []
  const cats = { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 }
  const callNames = new Map()
  let toolsTokens = 0
  for (const event of events) {
    if (event.type === 'request/header') {
      toolsTokens = canonicalHeaderToolsTokens(event.data && event.data.header)
      continue
    }
    if (event.type === 'tool/call') {
      const name = event.data && event.data.name
      if (event.data && typeof event.data.callId === 'string' && typeof name === 'string') callNames.set(event.data.callId, name)
      continue
    }
    if (!SURFACE_TYPES.has(event.type) || event.surfaceOp === undefined) continue
    const message = independentMessageOf(event)
    const tokens = independentMessageTokens(message)
    let cat
    if (event.type === 'system/message') cat = 'system'
    else if (event.type === 'assistant/message') cat = 'assistant'
    else if (event.type === 'tool/result') {
      const source = message && message.source
      const callName = source && typeof source.callId === 'string' ? callNames.get(source.callId) : undefined
      cat = callName === 'skill' && independentSkillName(message) !== '' ? 'skill' : 'tool'
      if (callName !== undefined) callNames.delete(source.callId)
    } else if (event.type === 'developer/message') cat = 'inject'
    else {
      const source = message && message.source
      const kind = source && typeof source.kind === 'string' ? source.kind : undefined
      if (kind === undefined || kind === 'user') cat = 'user'
      else if (kind === 'skill-invocation' || kind === 'skill-catalog') cat = 'skill'
      else cat = 'inject'
    }
    const node = { seq: event.seq, cat, tokens }
    const op = event.surfaceOp
    let replaced = false
    if (op !== null && typeof op === 'object' && op.op === 'replace') {
      const start = nodes.findIndex(candidate => candidate.seq === op.startSeq)
      const end = nodes.findIndex(candidate => candidate.seq === op.endSeq)
      if (start >= 0 && end >= start) {
        for (const old of nodes.splice(start, end - start + 1, node)) {
          if (old.cat !== 'system') cats[old.cat] = Math.max(0, cats[old.cat] - old.tokens)
        }
        replaced = true
      }
    }
    if (!replaced) nodes.push(node)
    if (cat !== 'system') cats[cat] += tokens
  }
  let systemTokens = 0
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index].cat === 'system' && nodes[index].tokens > 0) { systemTokens = nodes[index].tokens; break }
  }
  const systemNodeTokens = nodes.filter(node => node.cat === 'system').reduce((sum, node) => sum + node.tokens, 0)
  return {
    systemTokens,
    toolsTokens,
    cats,
    dormant: systemNodeTokens - systemTokens,
    surfaceLength: nodes.length,
    survivingSeqs: new Set(nodes.map(node => node.seq)),
  }
}

/** Manual event tallies following the documented counter definitions. */
function independentCounts(events) {
  const counts = { humanInputs: 0, answers: 0, toolCalls: 0, skillLoads: 0, injects: 0, compactions: 0, prunes: 0 }
  const callNames = new Map()
  const toolNames = {}
  const eventSeqs = []
  const assistantSeqs = []
  // dsh-context fold.ts also records model switches (change/resume header with a
  // different model) and plan-mode toggles in the context-event log.
  let routedModel = ''
  for (const event of events) {
    if (event.type === 'request/header') {
      const data = event.data || {}
      const header = data.header || {}
      const config = header.config || {}
      const nextModel = typeof config.model === 'string' ? config.model : ''
      const reason = typeof data.reason === 'string' ? data.reason : ''
      if ((reason === 'change' || reason === 'resume') && routedModel !== '' && nextModel !== '' && nextModel !== routedModel) {
        eventSeqs.push(event.seq)
      }
      if (nextModel !== '') routedModel = nextModel
    } else if (event.type === 'plan/mode') {
      if (event.data && typeof event.data.active === 'boolean') eventSeqs.push(event.seq)
    } else if (event.type === 'assistant/message') {
      assistantSeqs.push(event.seq)
      const message = event.data && event.data.message
      const hasText = message && Array.isArray(message.content)
        && message.content.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
      if (hasText) counts.answers += 1
    } else if (event.type === 'user/message') {
      const source = event.data && event.data.source
      const kind = source && typeof source.kind === 'string' ? source.kind : undefined
      if (kind === undefined || kind === 'user') counts.humanInputs += 1
      else {
        counts.injects += 1
        if (kind === 'skill-invocation') counts.skillLoads += 1
        eventSeqs.push(event.seq)
      }
    } else if (event.type === 'developer/message') {
      counts.injects += 1
      eventSeqs.push(event.seq)
    } else if (event.type === 'tool/call') {
      if (event.data && typeof event.data.callId === 'string') callNames.set(event.data.callId, event.data.name)
    } else if (event.type === 'tool/result') {
      const source = event.data && event.data.message && event.data.message.source
      const callId = (source && source.callId) || (event.data && event.data.toolCallId)
      if (callId !== undefined && callNames.has(callId)) {
        const name = callNames.get(callId)
        callNames.delete(callId)
        counts.toolCalls += 1
        toolNames[name] = (toolNames[name] || 0) + 1
        if (name === 'skill' && independentSkillName(event.data.message) !== '') {
          counts.skillLoads += 1
          counts.injects += 1
        }
      }
    } else if (event.type === 'compaction/summary') {
      counts.compactions += 1
      eventSeqs.push(event.seq)
    } else if (event.type === 'compaction/prune') {
      counts.prunes += 1
      eventSeqs.push(event.seq)
    }
  }
  return { counts, callNames, toolNames, eventSeqs, assistantSeqs }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let bridgePromise
function loadBridge() {
  if (bridgePromise === undefined) bridgePromise = import(pathToFileURL(BRIDGE_PATH).href)
  return bridgePromise
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

function foldBridge(bridge, events) {
  let state = bridge.createState()
  const startedAt = performance.now()
  for (const event of events) state = bridge.applyContextEvent(state, event)
  return { state, view: bridge.contextView(state), ms: performance.now() - startedAt }
}

function readFixture() {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8')
  return { raw, fixture: JSON.parse(raw) }
}

function wireBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function assertNoUndefined(value, where) {
  if (value === undefined) return assert.fail(`undefined at ${where}`)
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoUndefined(item, `${where}[${index}]`))
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) assertNoUndefined(value[key], `${where}.${key}`)
  }
}

function assertPlainJson(value, where = '$') {
  assertNoUndefined(value, where)
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${where} must survive JSON round-trip`)
}

function expectFailure(fn) {
  try { fn() } catch (error) { return error }
  return undefined
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

function parseSessionLog(text) {
  const lines = text.split('\n')
  const header = JSON.parse(lines[0])
  const events = []
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]) events.push(JSON.parse(lines[index]))
  }
  return { header, events }
}

// ===========================================================================
// Fixture shape
// ===========================================================================

test('context fixture is a self-consistent, foldable session slice', () => {
  const { raw, fixture } = readFixture()
  assert.ok(Buffer.byteLength(raw) <= 2 * 1024 * 1024, 'fixture must stay under 2MB')
  assert.ok(Array.isArray(fixture.events) && fixture.events.length > 100, 'fixture.events must be a non-trivial array')
  assert.equal(fixture.meta.sessionId, REAL_SESSION_ID)
  const events = fixture.events

  let previousSeq = -1
  for (const event of events) {
    assert.equal(typeof event.seq, 'number')
    assert.ok(event.seq > previousSeq, `event seqs must strictly increase (got ${event.seq} after ${previousSeq})`)
    previousSeq = event.seq
    assert.equal(typeof event.type, 'string')
  }

  const byType = new Map()
  for (const event of events) byType.set(event.type, (byType.get(event.type) || 0) + 1)
  for (const required of ['request/header', 'system/message', 'user/message', 'assistant/message', 'tool/result', 'compaction/summary', 'compaction/prune']) {
    assert.ok(byType.get(required) > 0, `fixture must contain ${required}`)
  }
  assert.ok(byType.get('compaction/summary') >= 2, 'fixture must contain at least two compaction/summary events')
  assert.ok(byType.get('compaction/prune') >= 1, 'fixture must contain prune events')

  // The fixture must be foldable from an empty surface: every replacement range
  // has to name two positions that are still present at that point.
  const surface = []
  let replacements = 0
  for (const event of events) {
    if (!SURFACE_TYPES.has(event.type)) continue
    assert.notEqual(event.surfaceOp, undefined, `surface event ${event.type}@${event.seq} must carry surfaceOp`)
    if (event.surfaceOp === 'append') { surface.push(event.seq); continue }
    assert.equal(event.surfaceOp.op, 'replace')
    const start = surface.indexOf(event.surfaceOp.startSeq)
    const end = surface.indexOf(event.surfaceOp.endSeq)
    assert.ok(start >= 0 && end >= start,
      `replace @${event.seq} cannot resolve ${event.surfaceOp.startSeq}-${event.surfaceOp.endSeq}`)
    surface.splice(start, end - start + 1, event.seq)
    replacements += 1
  }
  assert.equal(surface.length, 595)
  assert.ok(replacements >= 2, 'fixture must exercise multi-node replacement splices')

  const header = events.find(event => event.type === 'request/header').data.header
  assert.ok(header && header.config && Array.isArray(header.tools) && header.tools.length > 0)
  for (const type of ['compaction/summary', 'compaction/prune']) {
    const compaction = events.find(event => event.type === type)
    assert.equal(typeof compaction.data.shadowedTokenCount, 'number')
    assert.ok(Array.isArray(compaction.data.shadowedSeqs))
  }
})

// ===========================================================================
// Fixture: DSH oracle parity + classification
// ===========================================================================

test('fixture fold matches the DSH token-meter oracle and the documented category split', async (t) => {
  const oracle = await loadOracle()
  if (oracle === null) return t.skip('DSH oracle packages (.dsh-reference) are not installed')
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const events = fixture.events

  // Oracle fold, snapshotting the official state before each assistant message
  // (the request record is the prompt the response was assembled for).
  let oracleState = oracle.contextBreakdown.init()
  const oracleSnapshots = []
  for (const event of events) {
    if (event.type === 'assistant/message') {
      oracleSnapshots.push({
        seq: event.seq,
        system: oracleState.breakdown.systemTokens,
        tools: oracleState.breakdown.toolsTokens,
      })
    }
    oracleState = oracle.contextBreakdown.apply(oracleState, event)
  }
  const breakdown = oracle.contextBreakdown.wire.view(oracleState)
  assert.deepEqual(breakdown, FIXTURE_EXPECTED.breakdown)

  const { state, view } = foldBridge(bridge, events)
  assert.equal(view.v, 1)
  assert.deepEqual({ system: view.current.system, tools: view.current.tools },
    { system: breakdown.systemTokens, tools: breakdown.toolsTokens })

  // Independent documented fold must agree on every category, not just totals.
  const independent = independentSurface(events)
  const expectedCurrent = {
    system: independent.systemTokens,
    tools: independent.toolsTokens,
    ...independent.cats,
  }
  expectedCurrent.total = expectedCurrent.system + expectedCurrent.tools
    + expectedCurrent.user + expectedCurrent.inject + expectedCurrent.skill
    + expectedCurrent.assistant + expectedCurrent.tool
  assert.deepEqual(view.current, expectedCurrent)
  assert.deepEqual({ system: independent.systemTokens, tools: independent.toolsTokens },
    { system: breakdown.systemTokens, tools: breakdown.toolsTokens })

  // Dormant system nodes: excluded from the five message categories, included in
  // the official message total (docs §2, dsh-context behavior).
  const catsSum = MESSAGE_CATS.reduce((sum, cat) => sum + view.current[cat], 0)
  assert.equal(catsSum, breakdown.messageTokens - independent.dormant)
  assert.equal(independent.dormant, 0, 'this fixture window keeps exactly one surviving system node')
  assert.equal(independent.surfaceLength, state.surface.length)
  assert.equal(state.surface.length, 595)
  assert.equal(view.truncated.surface, false)

  // Skill-catalog injections are their own bucket (docs §2), not inject.
  const survivingSkillCatalogs = events.filter(event => event.type === 'user/message'
    && event.data && event.data.source && event.data.source.kind === 'skill-catalog'
    && independent.survivingSeqs.has(event.seq))
  assert.equal(survivingSkillCatalogs.length, 1)
  assert.equal(view.current.skill, independentMessageTokens(survivingSkillCatalogs[0].data))
  assert.ok(view.current.skill > 0)

  // The documented pricing formula is reproduced exactly, not approximately.
  const systemEvents = events.filter(event => event.type === 'system/message')
  const lastSystem = systemEvents[systemEvents.length - 1]
  const systemCharacters = lastSystem.data.message.content.reduce(
    (sum, block) => sum + (block.type === 'text' ? block.text.length : JSON.stringify(block).length), 0)
  assert.equal(view.current.system, Math.ceil(systemCharacters / CHARS_PER_TOKEN) + ROLE_OVERHEAD)
  const headers = events.filter(event => event.type === 'request/header')
  const lastHeader = headers[headers.length - 1].data.header
  assert.equal(view.current.tools,
    Math.ceil(JSON.stringify(lastHeader.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD)

  // Request records must carry the official system/tools values of the prompt
  // they were assembled for.
  const retainedRequests = view.requests
  const retainedSnapshots = oracleSnapshots.slice(-retainedRequests.length)
  assert.deepEqual(
    retainedRequests.map(record => ({ seq: record.seq, system: record.system, tools: record.tools })),
    retainedSnapshots,
  )
})

// ===========================================================================
// Fixture: manual counters and context events
// ===========================================================================

test('fixture counts match manual tallies of the raw events', async (t) => {
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const events = fixture.events
  const manual = independentCounts(events)
  assert.deepEqual(manual.counts, FIXTURE_EXPECTED.counts)
  const { view, state } = foldBridge(bridge, events)
  assert.deepEqual(view.counts, FIXTURE_EXPECTED.counts)
  assert.equal(view.tools.total, manual.counts.toolCalls)
  assert.ok(view.tools.names.length <= 20)
  const sorted = [...view.tools.names]
  assert.deepEqual(sorted, [...sorted].sort((left, right) => (right.count - left.count) || left.name.localeCompare(right.name)))
  assert.ok(view.tools.names.every(entry => entry.count > 0))
  assert.equal(view.tools.names.reduce((sum, entry) => sum + entry.count, 0),
    Object.values(manual.toolNames).reduce((sum, count) => sum + count, 0))
  assert.ok(view.timing.wallMs >= 0)
  assert.deepEqual(view.truncated, { requests: true, events: false, surface: false })
  // request/header and request/context populate the wire config fields.
  assert.equal(typeof state.model, 'string')
  assert.equal(typeof state.provider, 'string')
  assert.equal(view.model, state.model)
  assert.equal(view.provider, state.provider)
  assert.equal(view.contextWindow, 262144)
})

test('fixture request records are capped, ordered, sparse and self-consistent', async () => {
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const events = fixture.events
  const manual = independentCounts(events)
  const { view } = foldBridge(bridge, events)

  assert.equal(manual.assistantSeqs.length, 418)
  assert.equal(view.requests.length, FIXTURE_EXPECTED.requests)
  assert.equal(view.truncated.requests, true)
  assert.deepEqual(view.requests.map(record => record.seq), manual.assistantSeqs.slice(-FIXTURE_EXPECTED.requests))
  for (let index = 1; index < view.requests.length; index += 1) {
    assert.ok(view.requests[index].seq > view.requests[index - 1].seq)
  }
  for (const record of view.requests) {
    for (const required of ['seq', 'time', 'turn', 'step', 'system', 'tools', 'total']) {
      assert.equal(typeof record[required], 'number', `request ${record.seq} is missing ${required}`)
    }
    for (const cat of MESSAGE_CATS) {
      if (cat in record) assert.ok(record[cat] > 0, `request ${record.seq} must omit zero category ${cat}`)
    }
    const categories = MESSAGE_CATS.reduce((sum, cat) => sum + (record[cat] || 0), 0)
    assert.equal(record.total, record.system + record.tools + categories)
    assert.ok(record.total > 0)
    // v5 duration curve: every closed step prices its active time onto its
    // record; the fixture log closes every step it opens.
    assert.equal(typeof record.activeMs, 'number', `request ${record.seq} is missing activeMs`)
    assert.ok(record.activeMs >= 0, `request ${record.seq} has a negative activeMs`)
  }
  // The curve's scale comes from the real steps, not from a constant.
  assert.ok(view.requests.some(record => record.activeMs > 0))
})

test('routing headers record model switches and output caps, plan mode becomes an event', async () => {
  const bridge = await loadBridge()
  const seed = [
    { type: 'request/header', seq: 1, time: 1000, data: { reason: 'new', header: { config: { model: 'model-a', provider: 'p' } } } },
    { type: 'request/header', seq: 2, time: 2000, data: { reason: 'change', header: { config: { model: 'model-b', provider: 'p', maxTokens: 32000 } } } },
    { type: 'plan/mode', seq: 3, time: 3000, data: { active: true } },
    { type: 'plan/mode', seq: 4, time: 4000, data: { active: false } },
  ]
  const { view } = foldBridge(bridge, seed)
  assert.equal(view.maxOutputTokens, 32000, 'the routed output cap rides the wire for the reserve hatch')
  assert.deepEqual(view.events.filter(event => event.kind === 'model').map(event => [event.from, event.to]), [['model-a', 'model-b']])
  assert.deepEqual(view.events.filter(event => event.kind === 'mode').map(event => event.name), ['plan.on', 'plan.off'])
  assert.equal(view.lastModel, undefined, 'internal fold state stays out of the wire view')
  // A cap-less or unchanged header never invents events or keeps a stale cap.
  const cleared = foldBridge(bridge, [
    { type: 'request/header', seq: 1, time: 1000, data: { reason: 'new', header: { config: { model: 'm', maxTokens: 64000 } } } },
    { type: 'request/header', seq: 2, time: 2000, data: { reason: 'resume', header: { config: { model: 'm' } } } },
  ]).view
  assert.equal(cleared.events.length, 0)
  assert.equal(cleared.maxOutputTokens, undefined)
})

test('newest header epoch carries compact tool metadata for the browser', async () => {
  const bridge = await loadBridge()
  const headerOf = (tools) => ({ config: { model: 'm', provider: 'p' }, tools })
  const seed = [
    { type: 'request/header', seq: 1, time: 1000, data: { reason: 'new', header: headerOf([
      { name: 'bash', description: 'Run a shell command', inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'Shell command' } }, required: ['command'] } }
    ]) } },
    { type: 'request/header', seq: 2, time: 2000, data: { reason: 'change', header: headerOf([
      { name: 'read', description: 'Read a file', inputSchema: { type: 'object', properties: { file_path: { type: 'string' }, limit: { type: 'integer' } }, required: ['file_path'] } },
      { name: 'web_search', description: 'Search', inputSchema: { type: 'object', properties: { query: { anyOf: [{ type: 'string' }, { type: 'number' }] } } } },
      { name: 'mcp__github__search', description: 'MCP search' },
    ]) } },
  ]
  const { view } = foldBridge(bridge, seed)
  assert.equal(view.headerEpochs.length, 2)
  // 旧纪元只留名字，避免 wire 膨胀。
  assert.equal(view.headerEpochs[0].meta, undefined)
  const meta = view.headerEpochs[1].meta
  const byName = Object.fromEntries(meta.map(tool => [tool.name, tool]))
  assert.equal(byName.read.source, '@deepseek-ai/dsh-tool-fs');
  assert.equal(byName.read.description, 'Read a file');
  assert.deepEqual(byName.read.params.map(param => [param.name, param.type, param.required]), [['file_path', 'string', true], ['limit', 'integer', false]]);
  assert.equal(byName.web_search.params[0].type, 'string | number', 'anyOf unions render as a pipe');
  assert.equal(byName['mcp__github__search'].source, 'mcp:github');
  assert.ok(byName.read.tokens > 0);
  // 没有 schema 时仍保留名字与 token 估算，浏览器按「仅估算」降级。
  assert.equal(byName['mcp__github__search'].params, undefined);
})

test('shell tool calls settle into the bounded command ledger', async () => {
  const bridge = await loadBridge()
  const seed = [
    { type: 'tool/call', seq: 10, time: 1000, data: { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'make test', description: 'Run the suite', run_in_background: true }) } },
    { type: 'tool/result', seq: 11, time: 6000, data: { message: { role: 'toolResult', source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok\n[exit code: 0]' }] } } },
    { type: 'tool/call', seq: 12, time: 7000, data: { callId: 'c2', name: 'read', arguments: JSON.stringify({ file_path: 'a.txt' }) } },
    { type: 'tool/result', seq: 13, time: 7100, data: { message: { role: 'toolResult', source: { callId: 'c2' }, content: [{ type: 'text', text: 'file body' }] } } },
    { type: 'tool/call', seq: 14, time: 8000, data: { callId: 'c3', name: 'bash', arguments: JSON.stringify({ command: 'sleep 10' }) } },
    { type: 'tool/result', seq: 15, time: 9500, data: { message: { role: 'toolResult', isError: true, source: { callId: 'c3' }, content: [{ type: 'text', text: 'boom\n[exit code: 2]\nstderr: nope' }] } } },
  ]
  const { view } = foldBridge(bridge, seed)
  assert.equal(view.commands.length, 2, 'file tools stay out of the command ledger')
  assert.deepEqual(view.commands.map(command => command.command), ['make test', 'sleep 10'])
  assert.equal(view.commands[0].seq, 11)
  assert.equal(view.commands[0].durationMs, 5000)
  assert.equal(view.commands[0].status, 'ok')
  assert.equal(view.commands[0].background, true)
  assert.equal(view.commands[0].description, 'Run the suite')
  assert.equal(view.commands[1].status, 'failed')
  assert.equal(view.commands[1].exit, 2)
  assert.equal(view.commands[1].stderr, true)
  assert.deepEqual(view.commandStats, { runs: 2, failed: 1, ms: 6500, bg: 1 })
  assert.doesNotThrow(() => JSON.stringify(view))
})

test('comms scan lifts relay/mailbox/settled messages from session logs', async () => {
  const bridge = await loadBridge()
  const user = (seq, source, text) => ({ seq, time: 1000 + seq, type: 'user/message', data: { source, content: [{ type: 'text', text }] } })
  const sessions = [
    { id: 'a', title: 'Agent A', events: [
      user(1, { kind: 'agent-message', senderSessionId: 'b', senderName: 'B' }, 'Agent b sent a message: 请检查'),
      user(2, { kind: 'user' }, '普通提问'),
    ] },
    { id: 'b', title: 'Agent B', events: [
      user(3, { kind: 'team-message', senderId: 'a', senderName: 'A' }, 'Team message t1 from A: 收到'),
      user(4, { kind: 'subagent-settled', senderSessionId: 'c', summary: '完成了任务，等待新指令' }, ''),
    ] },
  ]
  const value = bridge.buildCommsValue(sessions)
  assert.deepEqual(value.messages.map(message => message.kind), ['settled', 'mailbox', 'relay'], 'newest first')
  assert.equal(value.messages[0].text, '完成了任务，等待新指令')
  assert.equal(value.messages[1].text, '收到', 'the mailbox transport preamble is stripped')
  assert.equal(value.messages[2].text, '请检查', 'the relay sender framing is stripped')
  assert.equal(value.messages[2].from, 'b')
  assert.equal(value.messages[2].toName, 'Agent A', 'peer titles ride along for the route line')
  assert.equal(value.messages[1].from, 'a')
  assert.equal(value.scanned, 2)
  assert.equal(value.total, 3)
  assert.equal(value.truncated, false)
  // 普通提问与注入不会进入通讯面板。
  assert.equal(value.messages.some(message => message.text === '普通提问'), false)
})

test('comms scan reads DSH send_message tool calls and the completed child turn', async () => {
  const bridge = await loadBridge()
  const childEvents = [
    { seq: 10, time: 10000, type: 'tool/call', data: {
      callId: 'send-ok', name: 'send_message',
      arguments: JSON.stringify({ agent_id: 'root', message: '布局规格已提取' })
    } },
    { seq: 11, time: 10001, type: 'tool/result', data: {
      message: { role: 'toolResult', source: { callId: 'send-ok' }, content: [{ type: 'text', text: 'accepted' }] }
    } },
    { seq: 12, time: 11000, type: 'tool/call', data: {
      callId: 'send-failed', name: 'send_message',
      arguments: JSON.stringify({ agent_id: 'root', message: '未送达' })
    } },
    { seq: 13, time: 11001, type: 'tool/result', data: {
      message: { role: 'toolResult', isError: true, source: { callId: 'send-failed' }, content: [] }
    } },
    { seq: 14, time: 12000, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const value = bridge.buildCommsValue([
    { id: 'root', title: '小修改', events: [] },
    {
      id: 'child', title: '提取布局规格', parentSessionId: 'root', mode: 'continuable',
      projections: { values: { subagentTiming: { lastTurnCompleted: true } } },
      events: childEvents
    },
    {
      id: 'outside', title: '其他会话', events: [{ seq: 1, time: 13000, type: 'tool/call', data: {
        callId: 'outside-call', name: 'send_message',
        arguments: JSON.stringify({ agent_id: 'unscanned', message: '不应纳入当前家族' })
      } }, { seq: 2, time: 13001, type: 'tool/result', data: {
        message: { source: { callId: 'outside-call' }, content: [] }
      } }]
    }
  ])

  assert.deepEqual(value.messages.map(message => [message.kind, message.from, message.to, message.text]), [
    ['settled', 'child', 'root', 'Background subagent child finished and will do no further work unless you send it more.'],
    ['relay', 'child', 'root', '布局规格已提取'],
  ])
  assert.equal(value.total, 2)
  assert.equal(value.scanned, 3)
})

test('context-comms reads each subagent log with its direct parent address', async () => {
  const bridge = await loadBridge()
  const requests = []
  const frame = await bridge.handleContextComms({ sessions: { history: async request => {
    requests.push(request)
    const sender = request.sessionId === 'child' ? 'root' : 'child'
    return {
      title: request.sessionId,
      events: [{ event: {
        seq: 4, time: 4000, type: 'user/message',
        data: {
          source: { kind: 'agent-message', senderSessionId: sender },
          content: [{ type: 'text', text: `Agent ${sender} sent a message: useful update` }]
        }
      } }]
    }
  } } }, {
    type: 'context-comms',
    sessionIds: ['root', 'child', 'grandchild'],
    sessions: [
      { id: 'root' },
      { id: 'child', parentSessionId: 'root', mode: 'continuable' },
      { id: 'grandchild', parentSessionId: 'child', mode: 'one-shot' }
    ]
  })

  assert.deepEqual(requests, [
    { sessionId: 'root', maxMessages: 400 },
    { sessionId: 'child', maxMessages: 400, parentSessionId: 'root', mode: 'continuable' },
    { sessionId: 'grandchild', maxMessages: 400, parentSessionId: 'child', mode: 'one-shot' }
  ])
  assert.equal(frame.kind, 'context-comms')
  assert.equal(frame.value.scanned, 3)
  assert.equal(frame.value.messages.length, 3)
  assert.ok(frame.value.messages.every(message => message.text === 'useful update'))
})

test('insights aggregate sessions, daily buckets, cache hit and composition (no cost)', async () => {
  const bridge = await loadBridge()
  const day = (offset) => {
    const date = new Date(2026, 9, 23 - offset, 10, 0, 0)
    return date.getTime()
  }
  const records = [
    {
      id: 's1', title: '会话一', model: 'm1', provider: 'p', createdAt: day(10),
      usage: { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 },
      stats: { turns: 3, steps: 7, llmMs: 5000, toolMs: 1000 },
      counts: { toolCalls: 4 },
      pressure: { contextWindow: 1000, pressureTokens: 400 },
      current: { system: 100, tools: 200, user: 50, total: 350 },
      requests: [{ time: day(1), total: 300 }, { time: day(0), total: 200 }],
    },
    {
      id: 's2', title: '会话二', model: 'm2', provider: 'p', createdAt: day(40),
      usage: { uncachedInputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 0, outputTokens: 0 },
      stats: { turns: 0, steps: 0, llmMs: 0, toolMs: 0 }, counts: {}, pressure: {}, current: {},
      requests: [{ time: day(45), total: 100 }],
    },
  ]
  const now = day(0)
  const value = bridge.buildInsightsValue(records, now)
  assert.equal(value.sessions.length, 2)
  assert.deepEqual(value.sessions.map(session => session.id), ['s1', 's2'], 'newest activity first')
  assert.equal(value.totals.billedTokens, 1550);
  assert.equal(value.totals.sessions, 2)
  assert.equal(value.totals.turns, 3)
  assert.equal(value.totals.toolCalls, 4)
  assert.equal(value.cacheHit, 1400 / 1500)
  assert.equal(value.days.length, 56)
  assert.equal(value.days[value.days.length - 1].day, '2026-10-23')
  assert.equal(value.days[value.days.length - 1].tokens, 200)
  assert.equal(value.composition.system, 100)
  assert.equal(value.composition.tools, 200)
  assert.equal(value.sessions[0].lastActive > 0, true)
  assert.equal('cost' in value.totals, false, 'the mini program has no price book; cost stays out of the wire')
  assert.doesNotThrow(() => JSON.stringify(value))
})

test('fixture context events track injections, compactions and prunes', async () => {
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const events = fixture.events
  const manual = independentCounts(events)
  const { view } = foldBridge(bridge, events)

  assert.equal(view.events.length, FIXTURE_EXPECTED.events)
  assert.equal(view.truncated.events, false)
  assert.deepEqual(view.events.map(event => event.seq), manual.eventSeqs.slice(-120))
  const kinds = { inject: 0, compaction: 0, prune: 0, model: 0, mode: 0 }
  for (const event of view.events) {
    assert.ok(event.kind in kinds, `unexpected event kind ${event.kind}`)
    kinds[event.kind] += 1
    assert.equal(typeof event.seq, 'number')
    assert.equal(typeof event.time, 'number')
  }
  assert.deepEqual(kinds, FIXTURE_EXPECTED.contextEvents)

  const compactions = view.events.filter(event => event.kind === 'compaction')
  const prunes = view.events.filter(event => event.kind === 'prune')
  assert.equal(compactions.length, 2)
  assert.equal(prunes.length, 13)
  const summaryEvents = events.filter(event => event.type === 'compaction/summary')
  for (const compaction of compactions) {
    const source = summaryEvents.find(event => event.seq === compaction.seq)
    assert.equal(compaction.tokens, source.data.shadowedTokenCount)
    assert.equal(compaction.count, source.data.shadowedSeqs.length)
  }
  const pruneEvents = events.filter(event => event.type === 'compaction/prune')
  for (const prune of prunes) {
    const source = pruneEvents.find(event => event.seq === prune.seq)
    assert.equal(prune.tokens, source.data.shadowedTokenCount)
  }
})

test('fixture wire view is plain, lossless JSON under the frame budget', async () => {
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const { view } = foldBridge(bridge, fixture.events)
  const responseValue = { ...view, breakdown: FIXTURE_EXPECTED.breakdown, usage: null, stats: null }
  assertPlainJson(view)
  assertPlainJson(responseValue)
  assert.ok(wireBytes(responseValue) < WIRE_LIMIT_BYTES)
  assert.equal(view.v, 1)
  assert.equal(typeof view.current.total, 'number')
  assert.equal(view.current.total, view.current.system + view.current.tools
    + view.current.user + view.current.inject + view.current.skill
    + view.current.assistant + view.current.tool)
})

// ===========================================================================
// Synthetic edge cases
// ===========================================================================

const appendSystem = (seq, text) => ({
  type: 'system/message', seq, time: 1000 + seq,
  data: { message: { role: 'system', content: [{ type: 'text', text }] } }, surfaceOp: 'append',
})
const appendUser = (seq, text, source = { kind: 'user' }) => ({
  type: 'user/message', seq, time: 1000 + seq,
  data: { role: 'user', content: [{ type: 'text', text }], source }, surfaceOp: 'append',
})

test('dormant system nodes stay out of the five categories but inside the official message total', async (t) => {
  const oracle = await loadOracle()
  if (oracle === null) return t.skip('DSH oracle packages (.dsh-reference) are not installed')
  const bridge = await loadBridge()
  const events = [appendSystem(1, 'A'.repeat(400)), appendSystem(2, 'B'.repeat(400))]
  const breakdown = oracle.contextBreakdown.wire.view(foldDefinition(oracle.contextBreakdown, events))
  assert.deepEqual(breakdown, { systemTokens: 104, toolsTokens: 0, messageTokens: 104 })
  const { view } = foldBridge(bridge, events)
  assert.equal(view.current.system, 104)
  const catsSum = MESSAGE_CATS.reduce((sum, cat) => sum + view.current[cat], 0)
  const independent = independentSurface(events)
  assert.equal(independent.dormant, 104)
  assert.equal(catsSum, breakdown.messageTokens - independent.dormant)
  // The old system node is not silently dropped from the official total: the
  // client anchors its total on `breakdown` and splits it by `current` ratios,
  // so `current.total` intentionally excludes the dormant 104 tokens.
  assert.equal(view.current.total, breakdown.systemTokens + catsSum)
  assert.equal(catsSum + independent.dormant, breakdown.messageTokens)
})

test('replacement splices surface nodes exactly like the official breakdown fold', async (t) => {
  const oracle = await loadOracle()
  if (oracle === null) return t.skip('DSH oracle packages (.dsh-reference) are not installed')
  const bridge = await loadBridge()
  const first = appendUser(1, 'x'.repeat(40))
  const second = appendUser(2, 'y'.repeat(80))
  const replacement = {
    type: 'user/message', seq: 3, time: 1003,
    data: { role: 'user', content: [{ type: 'text', text: 'z'.repeat(120) }], source: { kind: 'user' } },
    surfaceOp: { op: 'replace', startSeq: 1, endSeq: 2 },
  }
  const events = [first, second, replacement]
  const breakdown = oracle.contextBreakdown.wire.view(foldDefinition(oracle.contextBreakdown, events))
  const independent = independentSurface(events)
  const { state, view } = foldBridge(bridge, events)
  assert.equal(state.surface.length, 1)
  assert.equal(independent.surfaceLength, 1)
  assert.equal(view.current.user, independentMessageTokens(replacement.data))
  assert.equal(view.current.user, breakdown.messageTokens)

  // Unknown replacement endpoints: the official fold fails loud (corruption),
  // while docs §2 requires the bridge to degrade to append instead of dropping
  // the event.
  const fallback = {
    type: 'user/message', seq: 4, time: 1004,
    data: { role: 'user', content: [{ type: 'text', text: 'w'.repeat(20) }], source: { kind: 'user' } },
    surfaceOp: { op: 'replace', startSeq: 99, endSeq: 99 },
  }
  assert.throws(() => foldDefinition(oracle.contextBreakdown, [...events, fallback]), /invalid current range/)
  const degraded = foldBridge(bridge, [...events, fallback])
  assert.equal(degraded.state.surface.length, 2)
  assert.equal(degraded.view.current.user,
    independentMessageTokens(replacement.data) + independentMessageTokens(fallback.data))
})

test('a paired skill tool result moves from tool to skill and counts as a skill load', async () => {
  const bridge = await loadBridge()
  const skillText = '<skill_content name="pdf-tools">\n' + 'instructions '.repeat(30) + '</skill_content>'
  const events = [
    { type: 'tool/call', seq: 1, time: 1001, data: { turn: 1, step: 1, callId: 'call-skill', name: 'skill', arguments: '{"name":"pdf-tools"}' } },
    {
      type: 'tool/result', seq: 2, time: 1002,
      data: {
        turn: 1, step: 1,
        message: { role: 'tool', source: { kind: 'tool', callId: 'call-skill' }, toolCallId: 'call-skill', content: [{ type: 'text', text: skillText }] },
      },
      surfaceOp: 'append',
    },
    { type: 'tool/call', seq: 3, time: 1003, data: { turn: 1, step: 2, callId: 'call-bash', name: 'bash', arguments: '{"command":"ls"}' } },
    {
      type: 'tool/result', seq: 4, time: 1004,
      data: {
        turn: 1, step: 2,
        message: { role: 'tool', source: { kind: 'tool', callId: 'call-bash' }, toolCallId: 'call-bash', content: [{ type: 'text', text: 'ok' }] },
      },
      surfaceOp: 'append',
    },
  ]
  const { view } = foldBridge(bridge, events)
  const independent = independentSurface(events)
  assert.deepEqual(view.current, {
    system: 0, tools: 0, ...independent.cats,
    total: independent.cats.user + independent.cats.inject + independent.cats.skill
      + independent.cats.assistant + independent.cats.tool,
  })
  assert.equal(view.current.skill, independentMessageTokens(events[1].data.message))
  assert.equal(view.current.tool, independentMessageTokens(events[3].data.message))
  assert.equal(view.counts.skillLoads, 1)
  assert.equal(view.counts.toolCalls, 2)
  assert.equal(view.tools.names.find(entry => entry.name === 'skill').count, 1)
  assert.equal(view.counts.injects, 1)
  assert.equal(view.events.length, 1)
  assert.equal(view.events[0].sub, 'skill')
  assert.equal(view.events[0].name, 'pdf-tools')
})

test('each request record carries its step activeMs, with user waits subtracted', async () => {
  const bridge = await loadBridge()
  const assistant = (seq, time, text = 'done') => ({
    type: 'assistant/message', seq, time,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
    surfaceOp: 'append',
  })
  // Step 1: 1000 → 5000 with a 2000ms approval wait in the middle → 2000ms active.
  // Step 2: no wait at all → its full 3000ms window.
  // Step 3: a tool-only step (no request record) must not stamp anything, and
  // step 4's ask_user_question wait is subtracted from its own window.
  const events = [
    { type: 'step/start', seq: 1, time: 1000 },
    { type: 'request/header', seq: 2, time: 1001, data: { reason: 'new', header: { config: { model: 'm', maxTokens: 1024 } } } },
    assistant(3, 1500, 'a'.repeat(40)),
    { type: 'approval/asked', seq: 4, time: 2000, data: { id: 'ap-1' } },
    { type: 'approval/decided', seq: 5, time: 4000, data: { id: 'ap-1' } },
    { type: 'step/end', seq: 6, time: 5000 },
    { type: 'step/start', seq: 7, time: 6000 },
    assistant(8, 6500, 'b'.repeat(40)),
    { type: 'step/end', seq: 9, time: 9000 },
    { type: 'step/start', seq: 10, time: 10000 },
    {
      type: 'tool/result', seq: 11, time: 10500,
      data: {
        turn: 1, step: 3,
        message: { role: 'tool', source: { kind: 'tool', callId: 'c1' }, toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: 12, time: 11000 },
    { type: 'step/start', seq: 13, time: 12000 },
    { type: 'tool/call', seq: 14, time: 12100, data: { turn: 1, step: 4, callId: 'c2', name: 'ask_user_question', arguments: '{}' } },
    assistant(15, 12200, 'c'.repeat(40)),
    {
      type: 'tool/result', seq: 16, time: 14000,
      data: {
        turn: 1, step: 4,
        message: { role: 'tool', source: { kind: 'tool', callId: 'c2' }, toolCallId: 'c2', content: [{ type: 'text', text: 'answer' }] },
      },
      surfaceOp: 'append',
    },
    { type: 'step/end', seq: 17, time: 15000 },
  ]
  const { view } = foldBridge(bridge, events)
  const bySeq = new Map(view.requests.map(record => [record.seq, record]))
  assert.deepEqual([...bySeq.keys()], [3, 8, 15])
  assert.equal(bySeq.get(3).activeMs, 2000, 'the approval wait leaves the step active time')
  assert.equal(bySeq.get(8).activeMs, 3000)
  assert.equal(bySeq.get(15).activeMs, 1100, 'the ask_user_question window is a wait too')
  // wallMs keeps the session-level accounting: 2000 + 3000 + 1000 + 1100
  // (the tool-only step still books its own window).
  assert.equal(view.timing.wallMs, 7100)
  assert.ok(view.requests.every(record => Number.isFinite(record.activeMs) && record.activeMs >= 0))
})

test('an unpaired step end or a trimmed request row never mis-stamps activeMs', async () => {
  const bridge = await loadBridge()
  const assistant = (seq, time) => ({
    type: 'assistant/message', seq, time,
    data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(40) }] } },
    surfaceOp: 'append',
  })
  // step/end without an open step is a no-op; an assistant message outside any
  // step keeps no anchor, so a later step/end cannot reach back and stamp it.
  const orphan = foldBridge(bridge, [
    { type: 'step/end', seq: 1, time: 1000 },
    assistant(2, 1100),
    { type: 'step/start', seq: 3, time: 2000 },
    { type: 'step/end', seq: 4, time: 3000 },
  ])
  assert.equal(orphan.view.requests.length, 1)
  assert.equal(orphan.view.requests[0].activeMs, undefined)
  assert.equal(orphan.view.timing.wallMs, 1000)
})

test('projection definition and fold helpers expose one coherent projection', async () => {
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const definition = bridge.contextProjectionDefinition
  assert.equal(definition.key, 'mobileContext')
  // v4 adds bounded browser and file-activity state; v5 stamps per-request
  // activeMs for the duration curve. Older rows must refold.
  assert.equal(definition.stateVersion, 5)
  assert.equal(typeof definition.init, 'function')
  assert.equal(typeof definition.apply, 'function')
  assert.equal(typeof definition.wire.view, 'function')
  assert.ok(bridge.CONTEXT_REQUEST_TYPES.has('context-dashboard'))

  const state = foldDefinition(definition, fixture.events)
  assert.deepEqual(definition.wire.view(state), bridge.contextView(state))
  assertPlainJson(state)

  // Unrelated events must not churn the persisted projection (change-feed
  // contract: the registry compares state by Object.is).
  for (const type of ['turn/start', 'step/end', 'tool/call', 'session-log-deepseek/delivery-accepted']) {
    assert.equal(bridge.applyContextEvent(state, { type, seq: 999999, time: 1, data: {} }), state)
  }

  assert.equal(bridge.registerContextProjection(undefined), false)
  assert.equal(bridge.registerContextProjection({}), false)
  assert.equal(bridge.registerContextProjection({ inject: () => { throw new Error('nope') } }), false)
  let registered
  const injected = []
  assert.equal(bridge.registerContextProjection({
    inject(services, callback) { injected.push(services); callback({ sessionProjections: { register: value => { registered = value } } }) },
  }), true)
  assert.deepEqual(injected, [['sessionProjections']])
  assert.equal(registered.key, 'mobileContext')
})

test('handleContextQuery reads the history projection and degrades to context-unavailable', async () => {
  const bridge = await loadBridge()
  const { fixture } = readFixture()
  const { view } = foldBridge(bridge, fixture.events)
  const breakdown = FIXTURE_EXPECTED.breakdown
  const usage = { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }
  const stats = { turns: 1, steps: 2, llmMs: 3, toolMs: 4, ttftMs: 5, ttftSteps: 6, decodeMs: 7, decodeTokens: 8 }

  assert.deepEqual(await bridge.handleContextQuery({ sessions: { history: async () => ({ kind: 'history' }) } }, { type: 'context-dashboard' }),
    { kind: 'error', code: 'bad-request', requestType: 'context-dashboard', message: 'context-dashboard requires a sessionId' })

  assert.deepEqual(await bridge.handleContextQuery({}, { type: 'context-dashboard', sessionId: 's1' }),
    { kind: 'error', code: 'context-unavailable', requestType: 'context-dashboard', sessionId: 's1', message: 'Session history is unavailable on this host' })

  const ok = await bridge.handleContextQuery({
    sessions: {
      history: async (options) => {
        assert.deepEqual(options, { sessionId: 's1', maxMessages: 1 })
        return {
          kind: 'history',
          projections: { asOfSeq: 32619, values: { mobileContext: view, tokenUsage: usage, sessionStats: stats, contextBreakdown: breakdown } },
        }
      },
    },
  }, { type: 'context-dashboard', sessionId: ' s1 ' })
  assert.equal(ok.kind, 'context-dashboard')
  assert.equal(ok.sessionId, 's1')
  assert.equal(ok.asOfSeq, 32619)
  assert.deepEqual(ok.value.breakdown, breakdown)
  assert.deepEqual(ok.value.usage, usage)
  assert.deepEqual(ok.value.stats, stats)
  assert.deepEqual(ok.value.current, view.current)
  assertPlainJson(ok)

  const missing = await bridge.handleContextQuery({
    sessions: { history: async () => ({ kind: 'history', projections: { asOfSeq: 1, values: {} } }) },
  }, { type: 'context-dashboard', sessionId: 's1' })
  assert.equal(missing.kind, 'error')
  assert.equal(missing.code, 'context-unavailable')

  const failed = await bridge.handleContextQuery({
    sessions: { history: async () => ({ kind: 'error', code: 'unknown-command', message: 'nope' }) },
  }, { type: 'context-dashboard', sessionId: 's1' })
  assert.deepEqual(failed, { kind: 'error', code: 'unknown-command', message: 'nope', requestType: 'context-dashboard', sessionId: 's1' })

  const threw = await bridge.handleContextQuery({
    sessions: { history: async () => { throw new Error('boom') } },
  }, { type: 'context-dashboard', sessionId: 's1' })
  assert.equal(threw.code, 'context-unavailable')
  assertPlainJson(threw)
})

// ===========================================================================
// Full real-log reconciliation (skipped when the local log is absent)
// ===========================================================================

test('real session log reconciles with the official projections and manual tallies', async (t) => {
  const oracle = await loadOracle()
  if (oracle === null) return t.skip('DSH oracle packages (.dsh-reference) are not installed')
  if (!fs.existsSync(REAL_LOG_PATH)) return t.skip(`real session log not found at ${REAL_LOG_PATH}`)
  const text = readZstdLog(REAL_LOG_PATH)
  if (text === null) return t.skip('zstd binary not available to decompress the session log')
  const bridge = await loadBridge()
  const { events: allEvents } = parseSessionLog(text)
  assert.ok(allEvents.length > REAL_SNAPSHOT_SEQ, 'log must cover the documented snapshot')
  // Fold the documented prefix only: the session may keep growing, but the
  // expected values describe the projection cache snapshot at seq 32619.
  const events = allEvents.filter(event => event.seq <= REAL_SNAPSHOT_SEQ)
  assert.equal(events[events.length - 1].seq, REAL_SNAPSHOT_SEQ)

  // --- official oracle over the same prefix ---
  const oracleBreakdown = oracle.contextBreakdown.wire.view(foldDefinition(oracle.contextBreakdown, events))
  const oraclePressure = oracle.contextPressure.wire.view(foldDefinition(oracle.contextPressure, events))
  const oracleUsage = oracle.tokenUsage.wire.view(foldDefinition(oracle.tokenUsage, events))
  const oracleStats = oracle.sessionStats.wire.view(foldDefinition(oracle.sessionStats, events))
  assert.deepEqual(oracleBreakdown, REAL_EXPECTED.breakdown)
  assert.deepEqual(oraclePressure, REAL_EXPECTED.pressure)
  assert.deepEqual(oracleUsage, REAL_EXPECTED.usage)
  assert.deepEqual(oracleStats, REAL_EXPECTED.stats)

  // The expected values are the documented projection-cache snapshot: verify
  // the provenance file when it still exists on this machine.
  if (fs.existsSync(REAL_PROJ_CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(REAL_PROJ_CACHE_PATH, 'utf8'))
    const rows = (cache && cache.record && cache.record.rows) || {}
    const cacheSeq = rows.contextBreakdown && rows.contextBreakdown.seq
    if (cacheSeq === REAL_SNAPSHOT_SEQ) {
      assert.deepEqual(rows.contextBreakdown.val.breakdown, REAL_EXPECTED.breakdown)
      assert.deepEqual(rows.tokenUsage.val.totals, REAL_EXPECTED.usage)
      const statsState = rows.sessionStats && rows.sessionStats.val
      for (const [key, value] of Object.entries(REAL_EXPECTED.stats)) {
        assert.equal(statsState && statsState[key], value, `projection-cache sessionStats.${key}`)
      }
      const pressureState = rows.contextPressure && rows.contextPressure.val
      for (const [key, value] of Object.entries(REAL_EXPECTED.pressureState)) {
        assert.equal(pressureState && pressureState[key], value, `projection-cache contextPressure.${key}`)
      }
    } else {
      // The live session kept writing after the documented snapshot; the
      // provenance check only applies while the cache still holds that seq.
      t.diagnostic(`projection cache moved past the documented snapshot (cache seq ${cacheSeq}, expected ${REAL_SNAPSHOT_SEQ})`)
    }
  }

  // --- bridge fold over the same prefix ---
  const { state, view, ms } = foldBridge(bridge, events)
  assert.ok(ms < 5000, `bridge fold took ${ms.toFixed(0)}ms (expected < 5s)`)
  assert.deepEqual({ system: view.current.system, tools: view.current.tools },
    { system: REAL_EXPECTED.current.system, tools: REAL_EXPECTED.current.tools })
  const expectedCurrent = { ...REAL_EXPECTED.current }
  expectedCurrent.total = expectedCurrent.system + expectedCurrent.tools
    + MESSAGE_CATS.reduce((sum, cat) => sum + expectedCurrent[cat], 0)
  assert.deepEqual(view.current, expectedCurrent)

  const independent = independentSurface(events)
  const catsSum = MESSAGE_CATS.reduce((sum, cat) => sum + view.current[cat], 0)
  assert.equal(independent.dormant, REAL_EXPECTED.dormant)
  assert.equal(catsSum, oracleBreakdown.messageTokens - independent.dormant)
  assert.equal(catsSum + independent.dormant, oracleBreakdown.messageTokens)
  assert.equal(independent.systemTokens, oracleBreakdown.systemTokens)
  assert.equal(independent.toolsTokens, oracleBreakdown.toolsTokens)
  assert.deepEqual(independent.cats, {
    user: REAL_EXPECTED.current.user,
    inject: REAL_EXPECTED.current.inject,
    skill: REAL_EXPECTED.current.skill,
    assistant: REAL_EXPECTED.current.assistant,
    tool: REAL_EXPECTED.current.tool,
  })
  assert.equal(state.surface.length, REAL_EXPECTED.surfaceNodes)
  assert.equal(independent.surfaceLength, REAL_EXPECTED.surfaceNodes)
  assert.equal(view.truncated.surface, false)
  assert.equal(view.model, REAL_EXPECTED.model)
  assert.equal(view.provider, REAL_EXPECTED.provider)
  assert.equal(view.contextWindow, REAL_EXPECTED.contextWindow)
  assert.equal(view.timing.wallMs, 54545763)

  // --- counts / requests / events against manual tallies ---
  const manual = independentCounts(events)
  assert.deepEqual(manual.counts, REAL_EXPECTED.counts)
  assert.deepEqual(view.counts, REAL_EXPECTED.counts)
  assert.equal(view.tools.total, REAL_EXPECTED.counts.toolCalls)
  assert.equal(view.requests.length, REAL_EXPECTED.requests)
  assert.equal(view.truncated.requests, true)
  assert.deepEqual(view.requests.map(record => record.seq), manual.assistantSeqs.slice(-REAL_EXPECTED.requests))
  for (const record of view.requests) {
    for (const cat of MESSAGE_CATS) if (cat in record) assert.ok(record[cat] > 0)
    assert.equal(record.total, record.system + record.tools + MESSAGE_CATS.reduce((sum, cat) => sum + (record[cat] || 0), 0))
  }
  assert.equal(view.events.length, REAL_EXPECTED.events)
  assert.equal(view.truncated.events, true)
  assert.deepEqual(view.events.map(event => event.seq), manual.eventSeqs.slice(-REAL_EXPECTED.events))
  const kinds = { inject: 0, compaction: 0, prune: 0, model: 0, mode: 0 }
  for (const event of view.events) { assert.ok(event.kind in kinds); kinds[event.kind] += 1 }
  // Only the most recent 120 context events survive the cap; full tallies are
  // asserted through `counts` above.
  assert.ok(kinds.compaction > 0 && kinds.prune > 0 && kinds.inject > 0)
  assert.ok(kinds.compaction <= REAL_EXPECTED.counts.compactions)
  assert.ok(kinds.prune <= REAL_EXPECTED.counts.prunes)
  // The 120-event window now also carries model/mode rows (dsh-context fold.ts).
  assert.equal(kinds.inject + kinds.compaction + kinds.prune + kinds.model + kinds.mode, REAL_EXPECTED.events)
  assert.ok(kinds.model > 0, 'model switches are context events too')

  // --- response frame budget ---
  const frame = {
    kind: 'context-dashboard',
    sessionId: REAL_SESSION_ID,
    asOfSeq: REAL_SNAPSHOT_SEQ,
    value: { ...view, breakdown: oracleBreakdown, usage: oracleUsage, stats: oracleStats },
  }
  assertPlainJson(frame)
  assert.ok(wireBytes(frame) < REAL_SESSION_WIRE_LIMIT_BYTES, `wire frame is ${wireBytes(frame)} bytes`)
})

// ===========================================================================
// Installer smoke: compatible, and --check must never write
// ===========================================================================

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function directorySnapshot(directory) {
  if (!fs.existsSync(directory)) return null
  const listing = fs.readdirSync(directory).sort()
  const snapshot = {}
  for (const entry of listing) {
    const target = path.join(directory, entry)
    if (fs.statSync(target).isFile()) snapshot[entry] = fileDigest(target)
  }
  return snapshot
}

for (const gateway of GATEWAY_DIRS) {
  test(`installer --check is compatible and read-only for ${path.basename(gateway)}`, (t) => {
    if (!fs.existsSync(path.join(gateway, 'package.json'))) return t.skip(`${path.basename(gateway)} is not installed`)
    const lib = path.join(gateway, 'lib')
    assert.ok(fs.existsSync(path.join(lib, 'index.mjs')))
    const before = directorySnapshot(lib)
    const output = execFileSync(process.execPath, [INSTALLER_PATH, gateway, '--check'], { encoding: 'utf8' }).trim()
    const result = JSON.parse(output)
    assert.equal(result.compatible, true)
    assert.ok(Number.isInteger(result.changes) && result.changes >= 0 && result.changes <= 2, `unexpected changes value ${result.changes}`)
    assert.equal(result.updated, undefined)
    const after = directorySnapshot(lib)
    assert.deepEqual(after, before, '--check must not modify the gateway package')
    assert.equal(Object.keys(after).filter(entry => entry.includes('.before-context-')).length,
      Object.keys(before).filter(entry => entry.includes('.before-context-')).length,
      '--check must not create backup files')
  })
}

test('installer rejects a relative or unsupported gateway path without writing', () => {
  const error = expectFailure(() => execFileSync(process.execPath, [INSTALLER_PATH, './relative-gateway', '--check'], {
    encoding: 'utf8',
    stdio: 'pipe',
  }))
  assert.ok(error, 'relative gateway path must fail')
  assert.equal(error.status, 1)
  assert.match(String(error.stderr), /absolute gateway package directory is required/i)
})

// ---------------------------------------------------------------------------
// Installer transform idempotency (Lead addition): re-running the installer on
// an already-patched gateway must be a no-op, and the paired-device check must
// keep its whole group parenthesised so a context request is never rejected
// for a paired device by operator precedence.
// ---------------------------------------------------------------------------
test('installer transform is idempotent and keeps the paired-device check parenthesised', (t) => {
  const { transform } = require('../scripts/install-context-bridge.cjs')
  const indexFile = (gateway) => path.join(gateway, 'lib', 'index.mjs')
  const gateways = [
    path.join(os.homedir(), '.dsh/profiles/desktop/local-plugins/dsh-plugin-mobile-gateway'),
    weappGateway,
  ].filter(gateway => fs.existsSync(indexFile(gateway)))
  if (gateways.length === 0) return t.skip('no installed gateway package on this machine')
  for (const gateway of gateways) {
    const original = fs.readFileSync(indexFile(gateway), 'utf8')
    const patched = transform(original)
    const replayed = transform(patched)
    assert.equal(replayed, patched, `${path.basename(gateway)}: second transform must be a no-op`)
    assert.ok(!/if \(CONTEXT_REQUEST_TYPES\.has\(msg\.type\) \|\| PLUGIN_REQUEST_TYPES\.has\(msg\.type\) && !ws\.deviceId\)/.test(patched),
      `${path.basename(gateway)}: context auth check must stay parenthesised`)
    if (patched !== original) {
      assert.ok(patched.includes("from './context-bridge.mjs'"))
      assert.ok(patched.includes('CONTEXT_REQUEST_TYPES.has(msg.type)) return handleContextQuery(api, msg)'))
      assert.ok(patched.includes('registerContextProjection(ctx)'))
    }
  }
})

// ---------------------------------------------------------------------------
// The host adapter returns the raw session/follow snapshot (no `kind`); the
// dashboard handler must accept that shape instead of demanding the gateway's
// proxyQuery `kind: 'history'` wrapper (live 0.8.16 regression).
// ---------------------------------------------------------------------------
test('handleContextQuery accepts the adapter snapshot shape without a kind', async () => {
  const { handleContextQuery } = require('../scripts/lib/context-bridge.mjs')
  const snapshot = {
    cursor: 32619,
    historyFormatVersion: 4,
    events: [],
    hasMore: false,
    projections: {
      asOfSeq: 32619,
      values: {
        mobileContext: { v: 1, current: { system: 1, tools: 2, total: 3 }, requests: [], events: [] },
        contextBreakdown: { systemTokens: 1, toolsTokens: 2, messageTokens: 0 },
        tokenUsage: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 },
        sessionStats: { turns: 1, steps: 2 },
      },
    },
  }
  const frame = await handleContextQuery({ sessions: { history: async () => snapshot } }, { type: 'context-dashboard', sessionId: 'session-x' })
  assert.equal(frame.kind, 'context-dashboard')
  assert.equal(frame.sessionId, 'session-x')
  assert.equal(frame.asOfSeq, 32619)
  assert.equal(frame.value.v, 1)
  assert.deepEqual(frame.value.breakdown, { systemTokens: 1, toolsTokens: 2, messageTokens: 0 })
  assert.deepEqual(frame.value.usage, { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 })
  assert.deepEqual(frame.value.stats, { turns: 1, steps: 2 })

  const legacy = await handleContextQuery({
    sessions: { history: async () => ({ ...snapshot, kind: 'history' }) },
  }, { type: 'context-dashboard', sessionId: 'session-x' })
  assert.equal(legacy.kind, 'context-dashboard')

  const missing = await handleContextQuery({ sessions: { history: async () => ({ cursor: 1, events: [] }) } },
    { type: 'context-dashboard', sessionId: 'session-x' })
  assert.equal(missing.kind, 'error')
  assert.equal(missing.code, 'context-unavailable')
})

// ---------------------------------------------------------------------------
// Insights/comms capability + dispatch (live 0.8.25 regression): the page gates
// on `context-insights-v1`, so the installer must advertise it and insert the
// dispatch case; the bridge set must accept both request types.
// ---------------------------------------------------------------------------
test('installer advertises insights/comms capabilities and routes both request types', (t) => {
  const bridge = require('../scripts/lib/context-bridge.mjs')
  assert.ok(bridge.CONTEXT_REQUEST_TYPES.has('context-insights'), 'bridge accepts context-insights')
  assert.ok(bridge.CONTEXT_REQUEST_TYPES.has('context-comms'), 'bridge accepts context-comms')
  const { transform } = require('../scripts/install-context-bridge.cjs')
  const indexFile = (gateway) => path.join(gateway, 'lib', 'index.mjs')
  const gateways = [
    path.join(os.homedir(), '.dsh/profiles/desktop/local-plugins/dsh-plugin-mobile-gateway'),
    weappGateway,
  ].filter(gateway => fs.existsSync(indexFile(gateway)))
  if (gateways.length === 0) return t.skip('no installed gateway package on this machine')
  for (const gateway of gateways) {
    const patched = transform(fs.readFileSync(indexFile(gateway), 'utf8'))
    for (const capability of ["'context-dashboard-v1'", "'context-fleet-v1'", "'context-content-v1'", "'context-insights-v1'", "'context-comms-v1'"]) {
      assert.ok(patched.includes(capability), `${path.basename(gateway)}: advertises ${capability}`)
    }
    assert.ok(patched.includes("msg.type === 'context-insights'"), `${path.basename(gateway)}: dispatch insights`)
    assert.ok(patched.includes("msg.type === 'context-comms'"), `${path.basename(gateway)}: dispatch comms`)
  }
})
