/**
 * Context dashboard bridge for the mobile gateway.
 *
 * Registers one pure session projection (`mobileContext`) that folds a session's
 * durable event log into the composition / request-trend / event data the mini
 * program's 「上下文」 tab renders, and serves it over a single mobile query:
 *
 *   { type: 'context-dashboard', sessionId } ->
 *   { kind: 'context-dashboard', sessionId, asOfSeq, value: { ...mobileContext, breakdown, usage, stats } }
 *
 * Token pricing and the surface-replacement rules mirror DSH's own token meter
 * (`@deepseek-ai/dsh-token-meter`, fixed-density heuristic + planner), so the
 * folded `systemTokens` / `toolsTokens` / message total match the harness's
 * `contextBreakdown` projection exactly. Category classification and the
 * request/event tallies follow `dsh-context` (Apache-2.0, bowenliang123).
 *
 * The fold state is plain JSON and bounded so the harness projection cache can
 * checkpoint it: at most MAX_SURFACE nodes, MAX_REQUESTS request records and
 * MAX_EVENTS context events. `init`/`apply`/`view` are copied on every change
 * (never mutated in place) because the registry shares the previous state with
 * the persisted cache.
 */

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

const SURFACE_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
const MESSAGE_CATS = ['user', 'inject', 'skill', 'assistant', 'tool']

const MAX_SURFACE = 4000
const MAX_REQUESTS = 300
const MAX_EVENTS = 120
const MAX_TOOL_NAMES = 20
const MAX_CALL_NAMES = 2000

// A plain object with the only method the projection registry calls. Keeping the
// bridge free of a zod dependency lets the same module load in the host plugin
// and in plain-Node unit tests.
const passthroughSchema = Object.freeze({
  parse: value => value,
  safeParse: value => ({ success: true, data: value }),
  // Older registries may validate through the Standard Schema face instead of
  // calling parse(); accept every plain-JSON fold state there too.
  '~standard': Object.freeze({
    version: 1,
    vendor: 'mobile-gateway',
    validate: value => ({ value }),
  }),
})

export const CONTEXT_REQUEST_TYPES = new Set(['context-dashboard', 'context-fleet'])

// ---------------------------------------------------------------------------
// Token pricing (DSH token-meter fixed-density heuristic)
// ---------------------------------------------------------------------------

function estimateStructuralBlock(block) {
  if (block !== null && typeof block === 'object' && block.type === 'image') {
    const reference = { ...block }
    delete reference.offloaded
    return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(reference).length / CHARS_PER_TOKEN)
  }
  return BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)
}

function estimateSystemMessage(message) {
  const blocks = Array.isArray(message && message.content) ? message.content : []
  if (blocks.length === 0) return 0
  let characters = 0
  for (const block of blocks) {
    if (block !== null && typeof block === 'object' && block.type === 'text') {
      characters += typeof block.text === 'string' ? block.text.length : 0
    } else {
      characters += JSON.stringify(block).length
    }
  }
  return Math.ceil(characters / CHARS_PER_TOKEN) + ROLE_OVERHEAD
}

function estimateContent(blocks) {
  let tokens = 0
  if (!Array.isArray(blocks)) return tokens
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') {
      tokens += estimateStructuralBlock(block)
      continue
    }
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += Math.ceil((typeof block.text === 'string' ? block.text : '').length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += Math.ceil((typeof block.name === 'string' ? block.name : '').length / CHARS_PER_TOKEN)
          + Math.ceil((typeof block.arguments === 'string' ? block.arguments : '').length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD
        break
      default:
        tokens += estimateStructuralBlock(block)
    }
  }
  return tokens
}

function estimateMessage(message) {
  if (message === null || message === undefined) return 0
  if (message.role === 'system') return estimateSystemMessage(message)
  return estimateContent(message.content) + ROLE_OVERHEAD
}

function canonicalHeader(header) {
  if (header === null || typeof header !== 'object') return {}
  const adapterDefaults = header.adapterDefaults
  return {
    config: header.config,
    ...(adapterDefaults && (adapterDefaults.reasoningEffort === true || adapterDefaults.maxTokens === true)
      ? { adapterDefaults }
      : {}),
    ...(Array.isArray(header.tools) && header.tools.length > 0 ? { tools: header.tools } : {}),
  }
}

function estimateToolsTokens(header) {
  const canonical = canonicalHeader(header)
  if (!Array.isArray(canonical.tools) || canonical.tools.length === 0) return 0
  return Math.ceil(JSON.stringify(canonical.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

// ---------------------------------------------------------------------------
// Fold state
// ---------------------------------------------------------------------------

/** A bounded, plain-JSON fold state (see the module header). */
export function createState() {
  return {
    surface: [],
    sums: { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 },
    systemTokens: 0,
    toolsTokens: 0,
    counts: { humanInputs: 0, answers: 0, skillLoads: 0, injects: 0, compactions: 0, prunes: 0, toolCalls: 0 },
    toolNames: {},
    wallMs: 0,
    callNames: {},
    requests: [],
    events: [],
    truncated: { requests: false, events: false, surface: false },
  }
}

function cloneState(state) {
  return {
    surface: [...state.surface],
    sums: { ...state.sums },
    systemTokens: state.systemTokens,
    toolsTokens: state.toolsTokens,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    ...(state.contextWindow !== undefined ? { contextWindow: state.contextWindow } : {}),
    counts: { ...state.counts },
    toolNames: { ...state.toolNames },
    wallMs: state.wallMs,
    callNames: { ...state.callNames },
    requests: [...state.requests],
    events: [...state.events],
    truncated: { ...state.truncated },
    ...(state.stepStart !== undefined ? { stepStart: { time: state.stepStart.time, waits: [...state.stepStart.waits] } } : {}),
    ...(state.approvals !== undefined ? { approvals: { ...state.approvals } } : {}),
  }
}

function deriveEventMessage(event) {
  const data = event && event.data
  if (data === null || typeof data !== 'object') return null
  switch (event.type) {
    case 'user/message':
      return data
    case 'system/message':
    case 'developer/message':
    case 'assistant/message': {
      const message = data.message
      if (message === null || typeof message !== 'object') return null
      if (!Array.isArray(message.content) || message.content.length === 0) return null
      return message
    }
    case 'tool/result':
      return data.message !== null && typeof data.message === 'object' ? data.message : null
    default:
      return null
  }
}

function isSurfaceEvent(event) {
  return SURFACE_TYPES.has(event.type) && event.surfaceOp !== undefined
}

/** {start,end} for a replacement event, or null for an append / legacy spelling. */
function replaceRangeOf(surfaceOp) {
  if (surfaceOp === null || typeof surfaceOp !== 'object') return null
  if (surfaceOp.op !== 'replace') return null
  const start = surfaceOp.startSeq
  const end = surfaceOp.endSeq
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return { start, end }
}

function addNodeSums(state, node) {
  if (node.cat === 'system') return
  if (MESSAGE_CATS.includes(node.cat)) state.sums[node.cat] += node.tokens
}

function removeNodeSums(state, node) {
  if (node.cat === 'system') return
  if (MESSAGE_CATS.includes(node.cat)) state.sums[node.cat] = Math.max(0, state.sums[node.cat] - node.tokens)
}

function recomputeSystemTokens(state) {
  for (let i = state.surface.length - 1; i >= 0; i -= 1) {
    const node = state.surface[i]
    if (node.cat === 'system' && node.tokens > 0) {
      state.systemTokens = node.tokens
      return
    }
  }
  state.systemTokens = 0
}

function applySurface(state, event, cat, message) {
  const node = { seq: event.seq, cat, tokens: estimateMessage(message) }
  const range = replaceRangeOf(event.surfaceOp)
  if (range !== null) {
    let startIndex = -1
    let endIndex = -1
    for (let i = 0; i < state.surface.length; i += 1) {
      if (startIndex < 0 && state.surface[i].seq === range.start) startIndex = i
      if (state.surface[i].seq === range.end) {
        endIndex = i
        break
      }
    }
    if (startIndex >= 0 && endIndex >= startIndex) {
      const removed = state.surface.splice(startIndex, endIndex - startIndex + 1, node)
      for (const old of removed) removeNodeSums(state, old)
      addNodeSums(state, node)
      if (cat === 'system') recomputeSystemTokens(state)
      return node
    }
  }
  state.surface.push(node)
  addNodeSums(state, node)
  if (cat === 'system') recomputeSystemTokens(state)
  return node
}

function trimState(state) {
  if (state.surface.length > MAX_SURFACE) {
    const drop = state.surface.length - MAX_SURFACE
    const removed = state.surface.splice(0, drop)
    for (const old of removed) removeNodeSums(state, old)
    state.truncated.surface = true
    recomputeSystemTokens(state)
  }
  if (state.requests.length > MAX_REQUESTS) {
    state.requests.splice(0, state.requests.length - MAX_REQUESTS)
    state.truncated.requests = true
  }
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS)
    state.truncated.events = true
  }
  if (Object.keys(state.callNames).length > MAX_CALL_NAMES) {
    const keys = Object.keys(state.callNames)
    for (const key of keys.slice(0, keys.length - MAX_CALL_NAMES)) delete state.callNames[key]
  }
}

function firstText(blocks) {
  if (!Array.isArray(blocks)) return ''
  for (const block of blocks) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      return block.text
    }
  }
  return ''
}

function skillNameOf(message) {
  if (message === null || typeof message !== 'object') return ''
  const text = firstText(Array.isArray(message.content) ? message.content : [])
  const match = text.match(/<skill_content\s+name="([^"]+)"/)
  return match === null ? '' : match[1]
}

function isInjectionSource(source) {
  if (source === null || source === undefined || typeof source !== 'object') return false
  return (typeof source.kind === 'string' && source.kind !== '' && source.kind !== 'user') || typeof source.form === 'string'
}

function injectionSourceName(source) {
  if (source === null || source === undefined || typeof source !== 'object') return ''
  if (source.kind === 'agent-instructions' && Array.isArray(source.changes)) {
    const paths = []
    for (const change of source.changes) {
      const path = change && typeof change.path === 'string' ? change.path : ''
      if (path !== '' && !paths.includes(path)) paths.push(path)
    }
    if (paths.length > 0) return paths.join(', ')
  }
  if (typeof source.plugin === 'string' && source.plugin !== '') return source.plugin
  if (typeof source.kind === 'string' && source.kind !== '') return source.kind
  return ''
}

function clampWaitMs(stepStart, endTime) {
  const waits = Array.isArray(stepStart.waits) ? stepStart.waits : []
  if (waits.length === 0) return 0
  const spans = waits
    .map(wait => ({ start: Math.max(stepStart.time, wait.start), end: Math.min(endTime, wait.end) }))
    .filter(span => span.end > span.start)
    .sort((a, b) => (a.start - b.start) || (a.end - b.end))
  let total = 0
  let cursor = -Infinity
  for (const span of spans) {
    const start = Math.max(span.start, cursor)
    if (span.end > start) {
      total += span.end - start
      cursor = span.end
    }
  }
  return total
}

/**
 * Fold one committed session event. Returns the same state reference when the
 * event cannot change the served value (the registry's change feed relies on
 * `Object.is`), otherwise a fresh bounded state.
 *
 * @param {object} state previous `createState()`-shaped state
 * @param {{type:string,seq:number,time?:number,data?:object,surfaceOp?:unknown}} event
 * @returns {object} next state
 */
export function applyContextEvent(state, event) {
  if (state === null || typeof state !== 'object') state = createState()
  if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return state
  const data = event.data !== null && typeof event.data === 'object' ? event.data : undefined
  try {
    switch (event.type) {
      case 'request/header': {
        const header = data && data.header !== null && typeof data.header === 'object' ? data.header : undefined
        const next = cloneState(state)
        next.toolsTokens = estimateToolsTokens(header)
        const config = header && header.config !== null && typeof header.config === 'object' ? header.config : undefined
        if (config && typeof config.model === 'string') next.model = config.model
        if (config && typeof config.provider === 'string') next.provider = config.provider
        return next
      }
      case 'request/context': {
        if (data === undefined) return state
        let next
        if (typeof data.contextWindow === 'number') {
          next = next || cloneState(state)
          next.contextWindow = data.contextWindow
        }
        if (typeof data.model === 'string') {
          next = next || cloneState(state)
          next.model = data.model
        }
        if (typeof data.provider === 'string') {
          next = next || cloneState(state)
          next.provider = data.provider
        }
        return next || state
      }
      case 'system/message': {
        if (!isSurfaceEvent(event)) return state
        const next = cloneState(state)
        applySurface(next, event, 'system', deriveEventMessage(event))
        trimState(next)
        return next
      }
      case 'user/message':
      case 'developer/message': {
        if (!isSurfaceEvent(event)) return state
        const message = deriveEventMessage(event)
        const source = message && message.source
        // Skill machinery is its own bucket: skill invocations and the
        // available-skills catalog are durable user/message injections that the
        // plain injected-context check would absorb.
        const isSkillSource = source !== undefined && source !== null
          && (source.kind === 'skill-invocation' || source.kind === 'skill-catalog')
        const cat = event.type === 'developer/message' || isInjectionSource(source)
          ? (isSkillSource ? 'skill' : 'inject')
          : 'user'
        const next = cloneState(state)
        applySurface(next, event, cat, message)
        if (event.type === 'developer/message' || isInjectionSource(source)) {
          const source = message && message.source
          const record = { seq: event.seq, time: timeOf(event), kind: 'inject' }
          const form = source && typeof source.form === 'string' && source.form !== '' ? source.form : 'context'
          record.form = form
          if (source && source.kind === 'skill-invocation') {
            record.sub = 'skill'
            record.name = typeof source.name === 'string' ? source.name : '?'
            next.counts.skillLoads += 1
          } else if (message !== null) {
            const label = injectionSourceName(source)
            if (label !== '') record.name = label
          }
          next.events.push(record)
          next.counts.injects += 1
        } else {
          next.counts.humanInputs += 1
        }
        trimState(next)
        return next
      }
      case 'assistant/message': {
        const message = deriveEventMessage(event)
        const next = cloneState(state)
        // The request record is the prompt this response was assembled for:
        // capture it BEFORE the response joins the surface.
        const record = {
          seq: event.seq,
          time: timeOf(event),
          ...(data && Number.isFinite(data.turn) ? { turn: data.turn } : {}),
          ...(data && Number.isFinite(data.step) ? { step: data.step } : {}),
          system: next.systemTokens,
          tools: next.toolsTokens,
          total: next.systemTokens + next.toolsTokens
            + next.sums.user + next.sums.inject + next.sums.skill + next.sums.assistant + next.sums.tool,
        }
        for (const cat of MESSAGE_CATS) {
          if (next.sums[cat] > 0) record[cat] = next.sums[cat]
        }
        next.requests.push(record)
        if (isSurfaceEvent(event)) {
          const node = applySurface(next, event, 'assistant', message)
          if (node.tokens > 0 && firstText(message && message.content) !== '') next.counts.answers += 1
        }
        trimState(next)
        return next
      }
      case 'tool/call': {
        const callId = data && typeof data.callId === 'string' ? data.callId : ''
        const name = data && typeof data.name === 'string' ? data.name : ''
        if (callId === '' || name === '') return state
        const next = cloneState(state)
        next.callNames[callId] = { name, start: timeOf(event) }
        trimState(next)
        return next
      }
      case 'tool/result': {
        if (!isSurfaceEvent(event)) return state
        const message = deriveEventMessage(event)
        const source = message && message.source !== null && typeof message.source === 'object' ? message.source : undefined
        const callId = source && typeof source.callId === 'string' ? source.callId : ''
        const pending = callId !== '' ? state.callNames[callId] : undefined
        const next = cloneState(state)
        const node = applySurface(next, event, 'tool', message)
        if (pending !== undefined) {
          next.counts.toolCalls += 1
          next.toolNames[pending.name] = (next.toolNames[pending.name] || 0) + 1
          if (pending.name === 'ask_user_question' && next.stepStart !== undefined) {
            next.stepStart.waits.push({ start: pending.start, end: timeOf(event) })
          }
          if (callId !== '') delete next.callNames[callId]
          // A skill tool's result is harness-injected skill content: give it the
          // skill bucket instead of burying it among ordinary tool results.
          if (pending.name === 'skill') {
            const skillName = skillNameOf(message)
            if (skillName !== '') {
              next.sums.tool = Math.max(0, next.sums.tool - node.tokens)
              node.cat = 'skill'
              next.sums.skill += node.tokens
              next.counts.skillLoads += 1
              next.events.push({ seq: event.seq, time: timeOf(event), kind: 'inject', form: 'instructions', sub: 'skill', name: skillName })
              next.counts.injects += 1
            }
          }
        } else if (node.tool !== undefined) {
          // No paired call (a trimmed window): still count the tool run.
          next.counts.toolCalls += 1
          next.toolNames[node.tool] = (next.toolNames[node.tool] || 0) + 1
        }
        trimState(next)
        return next
      }
      case 'step/start': {
        const next = cloneState(state)
        next.stepStart = { time: timeOf(event), waits: [] }
        return next
      }
      case 'step/end': {
        if (state.stepStart === undefined) return state
        const next = cloneState(state)
        const start = state.stepStart
        const endTime = timeOf(event)
        const duration = Math.max(0, endTime - start.time)
        next.wallMs = state.wallMs + Math.max(0, duration - clampWaitMs(start, endTime))
        delete next.stepStart
        if (next.approvals !== undefined && Object.keys(next.approvals).length === 0) delete next.approvals
        return next
      }
      case 'approval/asked': {
        if (state.stepStart === undefined) return state
        const id = data && typeof data.id === 'string' ? data.id : ''
        if (id === '') return state
        const next = cloneState(state)
        next.approvals = { ...(next.approvals || {}), [id]: timeOf(event) }
        return next
      }
      case 'approval/decided': {
        const id = data && typeof data.id === 'string' ? data.id : ''
        const askedAt = id !== '' && state.approvals !== undefined ? state.approvals[id] : undefined
        if (askedAt === undefined || state.stepStart === undefined) return state
        const next = cloneState(state)
        next.stepStart.waits.push({ start: askedAt, end: timeOf(event) })
        delete next.approvals[id]
        return next
      }
      case 'compaction/summary':
      case 'compaction/prune': {
        const next = cloneState(state)
        const compaction = event.type === 'compaction/summary'
        next.events.push({
          seq: event.seq,
          time: timeOf(event),
          kind: compaction ? 'compaction' : 'prune',
          ...(data && Number.isFinite(data.shadowedTokenCount) ? { tokens: data.shadowedTokenCount } : {}),
          ...(compaction && data && Array.isArray(data.shadowedSeqs) ? { count: data.shadowedSeqs.length } : {}),
        })
        if (compaction) next.counts.compactions += 1
        else next.counts.prunes += 1
        trimState(next)
        return next
      }
      default:
        return state
    }
  } catch (_) {
    // Durable logs are untrusted input and the registry drives this fold with
    // no error boundary: drop a malformed event whole instead of stalling.
    return state
  }
}

function timeOf(event) {
  return typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : 0
}

function sortedToolNames(state) {
  return Object.entries(state.toolNames)
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOOL_NAMES)
    .map(([name, count]) => ({ name, count }))
}

/** The projection's wire value: a detached, bounded, lossless JSON snapshot. */
export function contextView(state) {
  const current = {
    system: state.systemTokens,
    tools: state.toolsTokens,
    user: state.sums.user,
    inject: state.sums.inject,
    skill: state.sums.skill,
    assistant: state.sums.assistant,
    tool: state.sums.tool,
  }
  current.total = current.system + current.tools + current.user + current.inject + current.skill + current.assistant + current.tool
  return {
    v: 1,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    ...(state.contextWindow !== undefined ? { contextWindow: state.contextWindow } : {}),
    current,
    counts: {
      humanInputs: state.counts.humanInputs,
      answers: state.counts.answers,
      toolCalls: state.counts.toolCalls,
      skillLoads: state.counts.skillLoads,
      injects: state.counts.injects,
      compactions: state.counts.compactions,
      prunes: state.counts.prunes,
    },
    tools: { total: state.counts.toolCalls, names: sortedToolNames(state) },
    timing: { wallMs: Math.round(state.wallMs) },
    requests: state.requests.map(record => ({ ...record })),
    events: state.events.map(record => ({ ...record })),
    truncated: { ...state.truncated },
  }
}

/** The `mobileContext` projection definition registered on `ctx.sessionProjections`. */
export const contextProjectionDefinition = {
  key: 'mobileContext',
  stateVersion: 1,
  stateSchema: passthroughSchema,
  init: () => createState(),
  apply: (state, event) => applyContextEvent(state, event),
  wire: { viewSchema: passthroughSchema, view: state => contextView(state) },
}


// ---------------------------------------------------------------------------
// Fleet (agent family) data
// ---------------------------------------------------------------------------

/** Harness services captured from the plugin context (absent on older hosts). */
let hostSessions = null
let hostProjections = null
let hostAgents = null

/**
 * Capture the host services the fleet query needs. Registration is optional and
 * lifecycle-bound: when a service is absent the query answers context-unavailable.
 *
 * @param {object} ctx gateway plugin context
 * @returns {boolean} whether an injection was attempted
 */
export function registerContextServices(ctx) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.inject !== 'function') return false
  try {
    ctx.inject(['sessions', 'sessionProjections'], (sub) => {
      if (!sub || !sub.sessions || !sub.sessionProjections) return
      hostSessions = sub.sessions
      hostProjections = sub.sessionProjections
      sub.effect(() => () => {
        hostSessions = null
        hostProjections = null
      })
    })
  } catch (_) { /* optional service */ }
  try {
    ctx.inject(['agents'], (sub) => {
      if (!sub || !sub.agents) return
      hostAgents = sub.agents
      sub.effect(() => () => { hostAgents = null })
    })
  } catch (_) { /* optional service */ }
  return true
}

const MAX_FLEET_AGENTS = 40

function fleetNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Pure fleet payload builder: `records` are session headers
 * `{id, parentSessionId, origin, createdAt, title?}`; `snapshotOf(id)` returns
 * one session's projection values (or null); `runningOf(id)` returns whether
 * that agent is live.
 *
 * @param {string} currentSessionId
 * @param {Array<object>} records
 * @param {(id: string) => (object|null)} snapshotOf
 * @param {(id: string) => boolean} [runningOf]
 * @returns {object} context-fleet value
 */
export function buildFleetValue(currentSessionId, records, snapshotOf, runningOf) {
  const byId = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    if (record === null || typeof record !== 'object' || typeof record.id !== 'string' || record.id === '') continue
    if (!byId.has(record.id)) byId.set(record.id, record)
  }
  const current = typeof currentSessionId === 'string' ? currentSessionId : ''
  const resolve = typeof snapshotOf === 'function' ? snapshotOf : () => null
  const isRunning = typeof runningOf === 'function' ? runningOf : () => false

  // Ancestor chain (current -> root); guards against a cyclic or damaged header chain.
  const chain = []
  const chainSeen = new Set()
  const ancestorLimit = MAX_FLEET_AGENTS * 5
  let cursor = current
  while (cursor !== '' && byId.has(cursor) && !chainSeen.has(cursor) && chain.length < ancestorLimit) {
    chainSeen.add(cursor)
    const record = byId.get(cursor)
    chain.push(record)
    cursor = typeof record.parentSessionId === 'string' ? record.parentSessionId : ''
  }
  const ancestors = chain.slice().reverse()
  const rootId = ancestors.length > 0 ? ancestors[0].id : (byId.has(current) ? current : '')

  // Subagent edges only: a fork shares the lineage field but is an independent conversation.
  const childrenOf = new Map()
  for (const record of byId.values()) {
    const parent = record.parentSessionId
    if (typeof parent !== 'string' || parent === '' || !byId.has(parent)) continue
    if (record.origin !== 'subagent') continue
    if (!childrenOf.has(parent)) childrenOf.set(parent, [])
    childrenOf.get(parent).push(record)
  }
  for (const children of childrenOf.values()) {
    children.sort((left, right) => (fleetNumber(left.createdAt) - fleetNumber(right.createdAt))
      || String(left.id).localeCompare(String(right.id)))
  }

  const order = []
  const visited = new Set()
  const walk = (id, depth) => {
    if (order.length >= MAX_FLEET_AGENTS || visited.has(id)) return
    const record = byId.get(id)
    if (record === undefined) return
    visited.add(id)
    order.push({ record, depth })
    for (const child of childrenOf.get(id) || []) walk(child.id, depth + 1)
  }
  if (rootId !== '') walk(rootId, 0)
  // The current session may be a fork (not a subagent edge): keep the ancestor
  // chain visible after the subagent tree so the current card always renders.
  for (let i = 0; i < ancestors.length && order.length < MAX_FLEET_AGENTS; i += 1) {
    if (!visited.has(ancestors[i].id)) {
      visited.add(ancestors[i].id)
      order.push({ record: ancestors[i], depth: i })
    }
  }
  // A family deeper than the bound must still show where the user is right now:
  // trade the last tree row for the current agent.
  if (!visited.has(current) && byId.has(current)) {
    if (order.length >= MAX_FLEET_AGENTS) order.pop()
    order.push({ record: byId.get(current), depth: Math.max(0, ancestors.length - 1) })
  }

  const agents = []
  let running = 0
  let subagents = 0
  for (const item of order) {
    const record = item.record
    let values = null
    try {
      values = resolve(record.id)
    } catch (_) {
      values = null
    }
    const v = values !== null && typeof values === 'object' ? values : {}
    const subagent = v.subagent !== null && typeof v.subagent === 'object' ? v.subagent : null
    const pressure = v.contextPressure !== null && typeof v.contextPressure === 'object' ? v.contextPressure : null
    const usage = v.tokenUsage !== null && typeof v.tokenUsage === 'object' ? v.tokenUsage : null
    const stats = v.sessionStats !== null && typeof v.sessionStats === 'object' ? v.sessionStats : null
    const context = v.mobileContext !== null && typeof v.mobileContext === 'object' ? v.mobileContext : null
    const compositionSource = context !== null && context.current !== null && typeof context.current === 'object' ? context.current : null
    const composition = {
      system: fleetNumber(compositionSource && compositionSource.system),
      tools: fleetNumber(compositionSource && compositionSource.tools),
      user: fleetNumber(compositionSource && compositionSource.user),
      inject: fleetNumber(compositionSource && compositionSource.inject),
      skill: fleetNumber(compositionSource && compositionSource.skill),
      assistant: fleetNumber(compositionSource && compositionSource.assistant),
      tool: fleetNumber(compositionSource && compositionSource.tool),
    }
    composition.total = composition.system + composition.tools + composition.user + composition.inject
      + composition.skill + composition.assistant + composition.tool
    const isAgentRunning = isRunning(record.id) === true
    if (isAgentRunning) running += 1
    if (record.origin === 'subagent') subagents += 1
    const title = typeof v.title === 'string' && v.title.trim() !== ''
      ? v.title.trim()
      : (typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : record.id)
    const entry = {
      sessionId: record.id,
      title,
      depth: item.depth,
      isCurrent: record.id === current,
      isRoot: record.id === rootId,
      running: isAgentRunning,
      createdAt: fleetNumber(record.createdAt),
      composition,
    }
    if (typeof record.parentSessionId === 'string' && record.parentSessionId !== '') entry.parentSessionId = record.parentSessionId
    if (subagent !== null && (subagent.mode === 'one-shot' || subagent.mode === 'continuable')) entry.mode = subagent.mode
    if (subagent !== null && typeof subagent.label === 'string' && subagent.label !== '') entry.label = subagent.label
    if (context !== null && typeof context.model === 'string') entry.model = context.model
    if (context !== null && typeof context.provider === 'string') entry.provider = context.provider
    if (pressure !== null && typeof pressure.contextWindow === 'number' && pressure.contextWindow > 0) entry.contextWindow = pressure.contextWindow
    if (pressure !== null && typeof pressure.pressureTokens === 'number' && pressure.pressureTokens >= 0) entry.pressureTokens = pressure.pressureTokens
    if (usage !== null) {
      const total = fleetNumber(usage.uncachedInputTokens) + fleetNumber(usage.cacheReadTokens)
        + fleetNumber(usage.cacheWriteTokens) + fleetNumber(usage.outputTokens)
      if (total > 0) entry.tokensTotal = total
    }
    if (stats !== null && Number.isFinite(stats.turns)) entry.turns = stats.turns
    if (stats !== null && Number.isFinite(stats.steps)) entry.steps = stats.steps
    const timing = v.subagentTiming !== null && typeof v.subagentTiming === 'object' ? v.subagentTiming : null
    if (timing !== null) {
      const active = timing.active !== null && typeof timing.active === 'object' ? timing.active : null
      const activeMs = fleetNumber(timing.settledMs)
        + (active !== null ? Math.max(0, fleetNumber(active.through) - fleetNumber(active.since)) : 0)
      if (activeMs > 0) entry.activeMs = activeMs
    } else if (context !== null && context.timing !== null && typeof context.timing === 'object') {
      const wallMs = fleetNumber(context.timing.wallMs)
      if (wallMs > 0) entry.activeMs = wallMs
    }
    agents.push(entry)
  }

  return {
    rootSessionId: rootId,
    currentSessionId: current,
    agents,
    counts: { agents: agents.length, running, subagents },
  }
}

/**
 * Serve one `context-fleet` request: list the host's sessions, walk the current
 * agent's family, and summarize each member from its projection snapshot.
 *
 * @param {{type:string,sessionId?:string}} msg mobile request frame
 * @returns {Promise<object>} wire frame
 */
export async function handleContextFleet(msg) {
  const requestType = msg && msg.type
  const sessionId = msg && typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
  if (sessionId === null) {
    return { kind: 'error', code: 'bad-request', requestType, message: 'context-fleet requires a sessionId' }
  }
  if (hostSessions === null || hostProjections === null || typeof hostSessions.list !== 'function'
    || typeof hostProjections.snapshot !== 'function') {
    return unavailable(requestType, sessionId, 'Session services are unavailable on this host')
  }
  try {
    const sessions = hostSessions.list()
    const list = Array.isArray(sessions) ? sessions : []
    const byId = new Map()
    const records = []
    for (const session of list) {
      if (session === null || typeof session !== 'object') continue
      const header = session.header !== null && typeof session.header === 'object' ? session.header : {}
      const id = typeof session.id === 'string' && session.id !== '' ? session.id : (typeof header.id === 'string' ? header.id : '')
      if (id === '' || byId.has(id)) continue
      byId.set(id, session)
      records.push({
        id,
        parentSessionId: typeof header.parentSession === 'string' ? header.parentSession : '',
        origin: header.origin === 'subagent' ? 'subagent' : '',
        createdAt: fleetNumber(header.createdAt),
      })
    }
    const value = buildFleetValue(sessionId, records, (id) => {
      const session = byId.get(id)
      if (session === undefined) return null
      const snapshot = hostProjections.snapshot(session)
      return snapshot !== null && typeof snapshot === 'object' && snapshot.values !== null && typeof snapshot.values === 'object'
        ? snapshot.values
        : null
    }, (id) => {
      try {
        return !!(hostAgents && typeof hostAgents.get === 'function' && hostAgents.get(id) && hostAgents.get(id).status === 'running')
      } catch (_) {
        return false
      }
    })
    return { kind: 'context-fleet', sessionId, value }
  } catch (_) {
    return unavailable(requestType, sessionId, 'Unable to read the agent family')
  }
}

/**
 * Register the projection on the host's session-projection registry. Optional:
 * hosts without the registry (older DSH) keep the gateway working, and the
 * `context-dashboard` query then answers `context-unavailable`.
 *
 * @param {object} ctx gateway plugin context
 * @returns {boolean} whether an injection was attempted
 */
export function registerContextProjection(ctx) {
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.inject !== 'function') return false
  try {
    ctx.inject(['sessionProjections'], (sub) => {
      if (!sub || !sub.sessionProjections || typeof sub.sessionProjections.register !== 'function') return
      sub.sessionProjections.register(contextProjectionDefinition)
    })
    return true
  } catch (_) {
    return false
  }
}

function unavailable(requestType, sessionId, message) {
  return { kind: 'error', code: 'context-unavailable', requestType, sessionId, message }
}

/**
 * Serve one `context-dashboard` request: read the session's projection snapshot
 * (which carries every registered wire unit) and augment `mobileContext` with
 * the harness's official breakdown / usage / stats projections.
 *
 * @param {object} api DSH host adapter (needs `sessions.history`)
 * @param {{type:string,sessionId?:string}} msg mobile request frame
 * @returns {Promise<object>} wire frame
 */
export async function handleContextQuery(api, msg) {
  const requestType = msg && msg.type
  const sessionId = msg && typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
  if (sessionId === null) {
    return { kind: 'error', code: 'bad-request', requestType, message: 'context-dashboard requires a sessionId' }
  }
  if (!api || !api.sessions || typeof api.sessions.history !== 'function') {
    return unavailable(requestType, sessionId, 'Session history is unavailable on this host')
  }
  try {
    const history = await api.sessions.history({ sessionId, maxMessages: 1 })
    if (!history || history.kind !== 'history') {
      return history && history.kind === 'error'
        ? { ...history, requestType, sessionId }
        : unavailable(requestType, sessionId, 'Unable to read the session projection')
    }
    const projections = history.projections !== null && typeof history.projections === 'object' ? history.projections : undefined
    const values = projections && projections.values !== null && typeof projections.values === 'object' ? projections.values : {}
    const context = values.mobileContext
    if (context === null || typeof context !== 'object') {
      return unavailable(requestType, sessionId, 'The context projection is not registered on this host')
    }
    const usage = values.tokenUsage !== null && typeof values.tokenUsage === 'object' ? values.tokenUsage : null
    const stats = values.sessionStats !== null && typeof values.sessionStats === 'object' ? values.sessionStats : null
    const breakdown = values.contextBreakdown !== null && typeof values.contextBreakdown === 'object' ? values.contextBreakdown : null
    return {
      kind: 'context-dashboard',
      sessionId,
      asOfSeq: projections ? projections.asOfSeq : undefined,
      value: {
        ...context,
        breakdown,
        usage,
        stats,
      },
    }
  } catch (_) {
    return unavailable(requestType, sessionId, 'Unable to read the context projection')
  }
}
