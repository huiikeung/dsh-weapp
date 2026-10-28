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
 * Wire v2 (docs/context-dashboard.md §8.1/§8.2) adds the desktop dashboard's
 * missing data as additive-optional fields: per-category activity counters
 * (`activity`), the six-way duration split plus its timeline (`timing`/`spans`),
 * per-request surface item counts and provider-reported usage
 * (`requests[].items/prompt/output`), the newest answer preview (`lastAnswer`),
 * and, for `context-fleet`, the host `agentTeam` roster/task board (`team`) plus
 * each agent's `lastAnswer`/`phase`. The embedded assistant `data.stream`
 * decoders under "Assistant stream decoding" are ported from
 * `dsh-context/src/host/logShapes.ts` (Apache-2.0) so the split matches the
 * desktop plugin's semantics.
 *
 * The fold state is plain JSON and bounded so the harness projection cache can
 * checkpoint it: at most MAX_SURFACE nodes, MAX_REQUESTS request records,
 * MAX_EVENTS context events and MAX_SPANS timeline segments. `init`/`apply`/
 * `view` are copied on every change (never mutated in place) because the
 * registry shares the previous state with the persisted cache.
 */

const CHARS_PER_TOKEN = 4
const BLOCK_OVERHEAD = 4
const ROLE_OVERHEAD = 4

const SURFACE_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])
const MESSAGE_CATS = ['user', 'inject', 'skill', 'assistant', 'tool']

const MAX_SURFACE = 4000
const MAX_ARCHIVE_NODES = 400
const MAX_HEADER_EPOCHS = 100
// Browser tool rows: compact schema metadata rides only the newest header epoch.
const MAX_TOOL_META = 20
const TOOL_DESC_MAX = 120
const TOOL_PARAM_MAX = 8
const TOOL_PARAM_DESC_MAX = 60
const MAX_FILE_OPS = 400
const MAX_REQUESTS = 200
const MAX_EVENTS = 120
const MAX_TOOL_NAMES = 20
const MAX_CALL_NAMES = 2000
const MAX_SPANS = 600
const MAX_STEP_SPANS = 2000
const MAX_LAST_ANSWER = 240
const MAX_PREVIEW_TEXT = 160
// Command ledger (Context tab's Command Panel): native shell runs, bounded.
const MAX_COMMANDS = 30
const SHELL_TOOLS = new Set(['bash', 'pwsh', 'shell', 'exec', 'execcommand', 'terminal', 'writestdin'])
const INDEX_DETAIL_NODES = 40
const MAX_TEAM_ROWS = 20

// Timeline span kinds on the wire (docs §8.1): the client colors the strip by
// these indices, so the vocabulary is frozen here.
const SPAN_WAIT = 0
const SPAN_REASONING = 1
const SPAN_TEXT = 2
const SPAN_TOOLARG = 3
const SPAN_TOOLS = 4
const SPAN_OTHER = 5
const DECODE_SPAN_KINDS = { reasoning: SPAN_REASONING, text: SPAN_TEXT, toolarg: SPAN_TOOLARG }
const TEAM_PHASES = new Set(['provisioning', 'active', 'failed'])

// Activity classification of a PAIRED tool call by its durable tool name
// (docs §8.1). Prefixes stay permissive for read*/write*/search* variants while
// the explicit names cover the harness's editor/search tools.
const WRITE_TOOL_NAMES = new Set(['edit', 'apply_patch', 'str_replace_editor'])
const SEARCH_TOOL_NAMES = new Set(['grep', 'glob', 'list', 'search', 'web_search', 'ripgrep', 'search_files'])

function toolActivityOf(name) {
  if (typeof name !== 'string' || name === '') return ''
  if (name.startsWith('read')) return 'reads'
  if (name.startsWith('write') || WRITE_TOOL_NAMES.has(name)) return 'writes'
  if (SEARCH_TOOL_NAMES.has(name) || name.startsWith('search')) return 'searches'
  return ''
}

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

export const CONTEXT_REQUEST_TYPES = new Set(['context-dashboard', 'context-fleet', 'context-content', 'context-insights', 'context-comms'])

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

const FIRST_PARTY_SOURCES = Object.freeze({
  read: '@deepseek-ai/dsh-tool-fs', write: '@deepseek-ai/dsh-tool-fs', edit: '@deepseek-ai/dsh-tool-fs',
  read_image: '@deepseek-ai/dsh-tool-fs', glob: '@deepseek-ai/dsh-tool-fs-search', grep: '@deepseek-ai/dsh-tool-fs-search',
  str_replace_editor: '@deepseek-ai/dsh-tool-str-replace-editor', bash: '@deepseek-ai/dsh-tool-bash',
  pwsh: '@deepseek-ai/dsh-tool-pwsh', web_search: '@deepseek-ai/dsh-tool-web', web_fetch: '@deepseek-ai/dsh-tool-web',
  job_output: '@deepseek-ai/dsh-tool-jobs', job_list: '@deepseek-ai/dsh-tool-jobs', job_kill: '@deepseek-ai/dsh-tool-jobs',
  ask_user_question: '@deepseek-ai/dsh-tool-ask-user', plan: '@deepseek-ai/dsh-plan-mode', exit_plan_mode: '@deepseek-ai/dsh-plan-mode',
  skill: '@deepseek-ai/dsh-tool-skill', todo_write: '@deepseek-ai/dsh-tool-todo', subagent: '@deepseek-ai/dsh-tool-subagent',
  subagent_fork: '@deepseek-ai/dsh-tool-subagent', send_message: '@deepseek-ai/dsh-tool-subagent-control',
  interrupt_agent: '@deepseek-ai/dsh-tool-subagent-control', list_agents: '@deepseek-ai/dsh-tool-subagent-control',
  ralph: '@deepseek-ai/dsh-tool-ralph', workflow: '@deepseek-ai/dsh-tool-workflow', run_code: '@deepseek-ai/dsh-tools',
  schedule_create: '@deepseek-ai/dsh-schedule', schedule_list: '@deepseek-ai/dsh-schedule', schedule_delete: '@deepseek-ai/dsh-schedule',
  create_goal: '@deepseek-ai/dsh-tool-goal', get_goal: '@deepseek-ai/dsh-tool-goal', update_goal: '@deepseek-ai/dsh-tool-goal',
  lsp: '@deepseek-ai/dsh-tool-lsp',
})

/** Tool → registering plugin, mirroring dsh-context host/toolSources.ts (producer field, mcp grammar, pinned map). */
function toolSourceOf(name, producer) {
  if (typeof producer === 'string' && producer !== '') return producer.slice(0, 120)
  if (name.startsWith('mcp__')) {
    const cut = name.lastIndexOf('__')
    if (cut > 5) return 'mcp:' + name.slice(5, cut)
  }
  return FIRST_PARTY_SOURCES[name]
}

/** Compact JSON-schema type text (dsh-context browserSchema.ts). */
function schemaTypeText(schema) {
  if (schema === null || typeof schema !== 'object') return 'unknown'
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map(schemaTypeText).filter((text, index, list) => text !== 'unknown' && list.indexOf(text) === index).join(' | ') || 'unknown'
  }
  const type = typeof schema.type === 'string' ? schema.type : ''
  if (Array.isArray(schema.enum)) return (type !== '' ? type : '') + ' (enum)'
  if (type === 'array') return 'array<' + schemaTypeText(schema.items) + '>'
  if (type === 'object' || (type === '' && schema.properties && typeof schema.properties === 'object')) {
    return 'object{' + (schema.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties).length : 0) + '}'
  }
  return type !== '' ? type : 'unknown'
}

/** One tool's browser metadata: description, parameter table rows, source chip and a token estimate. */
function compactToolMeta(tool) {
  const item = tool !== null && typeof tool === 'object' ? tool : {}
  const name = typeof item.name === 'string' ? item.name.slice(0, 120) : '?'
  const schema = item.inputSchema !== null && typeof item.inputSchema === 'object' ? item.inputSchema
    : item.parameters !== null && typeof item.parameters === 'object' ? item.parameters : null
  const params = []
  if (schema && schema.properties !== null && typeof schema.properties === 'object') {
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of Object.keys(schema.properties).slice(0, TOOL_PARAM_MAX)) {
      const prop = schema.properties[key] !== null && typeof schema.properties[key] === 'object' ? schema.properties[key] : {}
      params.push({
        name: key.slice(0, 80),
        type: schemaTypeText(prop).slice(0, 60),
        required: required.includes(key),
        ...(typeof prop.description === 'string' && prop.description !== '' ? { description: prop.description.replace(/\s+/g, ' ').trim().slice(0, TOOL_PARAM_DESC_MAX) } : {}),
      })
    }
  }
  const meta = { name }
  if (typeof item.description === 'string' && item.description !== '') meta.description = item.description.replace(/\s+/g, ' ').trim().slice(0, TOOL_DESC_MAX)
  if (params.length > 0) meta.params = params
  const source = toolSourceOf(name, item.plugin)
  if (source !== undefined) meta.source = source
  meta.tokens = Math.ceil(JSON.stringify(item).length / 4) + 4
  return meta
}

function estimateToolsTokens(header) {
  const canonical = canonicalHeader(header)
  if (!Array.isArray(canonical.tools) || canonical.tools.length === 0) return 0
  return Math.ceil(JSON.stringify(canonical.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
}

// ---------------------------------------------------------------------------
// Assistant stream decoding (ported from dsh-context/src/host/logShapes.ts,
// Apache-2.0, bowenliang123) — total over untrusted input; unknown chunks,
// missing times and non-array streams are skipped rather than thrown.
// ---------------------------------------------------------------------------

/** Whether a raw stream chunk carries a token delta (mirrors dsh-llm's `isTokenDelta`). */
function isTokenChunk(chunk) {
  if (chunk === null || typeof chunk !== 'object') return false
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return typeof chunk.text === 'string' && chunk.text !== ''
    case 'tool-call-delta':
      return (typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta !== '') || chunk.name !== undefined
    default:
      return false
  }
}

/** The decode bucket a `block-start.blockType` names, or undefined for a marker we cannot price. */
function decodeKindOfBlock(blockType) {
  if (blockType === 'reasoning') return 'reasoning'
  if (blockType === 'text') return 'text'
  if (blockType === 'tool-call') return 'toolarg'
  return undefined
}

/**
 * Decode spans and `block-start` counts inside one embedded assistant stream.
 * Each marker owns the interval up to the next one; the last one owns up to
 * `endTime`. Unknown markers leave their interval unpriced.
 *
 * @param {unknown} stream
 * @param {number} endTime
 * @returns {{spans: {reasoning:number,text:number,toolarg:number}, blocks: {reasoning:number,text:number,toolarg:number}}}
 */
function decodeTallyOfStream(stream, endTime) {
  const tally = {
    spans: { reasoning: 0, text: 0, toolarg: 0 },
    blocks: { reasoning: 0, text: 0, toolarg: 0 },
  }
  if (!Array.isArray(stream) || !Number.isFinite(endTime)) return tally
  let kind
  let since = 0
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type !== 'chunk' || record.chunk === null || typeof record.chunk !== 'object') continue
    const chunk = record.chunk
    if (chunk.type !== 'block-start') continue
    const time = record.time
    if (typeof time !== 'number' || !Number.isFinite(time)) continue
    if (kind !== undefined) tally.spans[kind] += Math.max(0, time - since)
    kind = decodeKindOfBlock(chunk.blockType)
    if (kind !== undefined) tally.blocks[kind] += 1
    since = time
  }
  if (kind !== undefined) tally.spans[kind] += Math.max(0, endTime - since)
  return tally
}

/** The ORDERED decode spans of one embedded assistant stream (same ownership rule as the tally). */
function decodeSpansOfStream(stream, endTime) {
  const spans = []
  if (!Array.isArray(stream) || !Number.isFinite(endTime)) return spans
  let kind
  let since = 0
  const close = to => {
    if (kind !== undefined && to > since) spans.push({ kind, start: since, end: to })
  }
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type !== 'chunk' || record.chunk === null || typeof record.chunk !== 'object') continue
    const chunk = record.chunk
    if (chunk.type !== 'block-start') continue
    const time = record.time
    if (typeof time !== 'number' || !Number.isFinite(time)) continue
    close(time)
    kind = decodeKindOfBlock(chunk.blockType)
    since = time
  }
  close(endTime)
  return spans
}

/** The first token's instant inside one packed delta run, or undefined. */
function runFirstTokenTime(record) {
  const time0 = record.time0
  if (typeof time0 !== 'number' || !Number.isFinite(time0)) return undefined
  if (record.type === 'tool-call-chunks' && record.name !== undefined) return time0
  const fragments = record.type === 'tool-call-chunks' ? record.args : record.texts
  if (!Array.isArray(fragments)) return undefined
  const dt = Array.isArray(record.dt) ? record.dt : []
  let time = time0
  for (let index = 0; index < fragments.length; index += 1) {
    if (index > 0) {
      const step = dt[index - 1]
      if (typeof step !== 'number' || !Number.isFinite(step)) return undefined
      time += step
    }
    if (typeof fragments[index] === 'string' && fragments[index] !== '') return time
  }
  return undefined
}

/** The first token's instant inside an embedded assistant stream, or undefined when it carries no token. */
function firstTokenTimeOfStream(stream) {
  if (!Array.isArray(stream)) return undefined
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    if (record.type === 'chunk') {
      const time = record.time
      if (typeof time === 'number' && Number.isFinite(time) && isTokenChunk(record.chunk)) return time
      continue
    }
    const time = runFirstTokenTime(record)
    if (time !== undefined) return time
  }
  return undefined
}

/** One provider-reported usage bucket as a non-negative integer, or null when unreadable. */
function tokenCountOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
  }
  return null
}

/** A non-negative duration between two instants; 0 for non-finite input. */
function durOf(from, to) {
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, to - from)
}

/** Image blocks inside one user message (the activity ledger's `images`, unclipped). */
function countImageBlocks(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return 0
  let count = 0
  for (const block of message.content) {
    if (block !== null && typeof block === 'object' && block.type === 'image') count += 1
  }
  return count
}

function parseCallArgs(raw) {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch (_) { return null }
}

function fileCallMeta(name, raw) {
  const args = parseCallArgs(raw)
  if (args === null) return null
  let kind = ''
  if (name === 'read' || name === 'read_image') kind = 'read'
  else if (name === 'write' || name === 'edit') kind = 'write'
  else if (name === 'grep' || name === 'glob') kind = 'search'
  else if (name === 'str_replace_editor') kind = args.command === 'view' ? 'read' : 'write'
  if (kind === '') return null
  let path = ''
  if ((name === 'grep' || name === 'glob') && typeof args.path !== 'string') {
    path = typeof args.pattern === 'string' ? args.pattern : ''
  } else {
    for (const key of ['file_path', 'filePath', 'path']) {
      if (typeof args[key] === 'string' && args[key] !== '') { path = args[key]; break }
    }
  }
  if (!path) return null
  const added = name === 'write' ? lineCount(args.content)
    : name === 'edit' ? lineCount(args.new_string)
      : name === 'str_replace_editor' && ['str_replace', 'insert', 'create'].includes(args.command)
        ? lineCount(args.command === 'create' ? args.file_text : args.new_str) : 0
  const removed = name === 'edit' ? lineCount(args.old_string)
    : name === 'str_replace_editor' && args.command === 'str_replace' ? lineCount(args.old_str) : 0
  return {
    kind, path: path.slice(0, 2000), added, removed,
    ...(kind === 'search' && !(typeof args.path === 'string' && args.path !== '') ? { pattern: true } : {}),
    ...(kind === 'read' && Number.isFinite(args.limit) && args.limit > 0 ? { readCount: Math.floor(args.limit) } : {}),
  }
}

function lineCount(value) {
  if (typeof value !== 'string' || value === '') return 0
  const breaks = (value.match(/\n/g) || []).length
  return value.endsWith('\n') ? breaks : breaks + 1
}

function fileOpsOf(event, message, pending) {
  const meta = pending && pending.file
  if (!meta) return []
  const common = {
    seq: event.seq, time: timeOf(event), path: meta.path, kind: meta.kind,
    tool: pending.name, err: !!(message && message.isError === true),
    added: meta.added, removed: meta.removed,
    ...(meta.pattern === true ? { pattern: true } : {}),
    ...(meta.readCount !== undefined ? { readCount: meta.readCount } : {}),
  }
  const eventMeta = event && event.data && event.data.meta
  const resultMeta = message && message.meta !== null && typeof message.meta === 'object'
    ? message.meta : eventMeta !== null && typeof eventMeta === 'object' ? eventMeta : null
  if (meta.kind === 'search' && resultMeta && resultMeta.truncated === false) {
    const found = []
    if (resultMeta.shape === 'matches' && Array.isArray(resultMeta.files)) {
      for (const row of resultMeta.files.slice(0, 100)) {
        if (row && typeof row.path === 'string' && Array.isArray(row.matches)) found.push({ path: row.path.slice(0, 2000), hits: row.matches.length })
      }
    } else if (resultMeta.shape === 'paths' && Array.isArray(resultMeta.paths)) {
      for (const path of resultMeta.paths.slice(0, 100)) if (typeof path === 'string') found.push({ path: path.slice(0, 2000), hits: 0 })
    }
    if (found.length > 0) return found.map(file => ({ ...common, ...file, pattern: false }))
  }
  if (meta.kind === 'read' && resultMeta && typeof resultMeta.offset === 'number'
    && Array.isArray(resultMeta.lines) && resultMeta.lines.length > 0) {
    common.readStart = Math.max(1, Math.floor(resultMeta.offset))
    common.readCount = resultMeta.lines.length
  }
  return [common]
}

// ---------------------------------------------------------------------------
// Fold state
// ---------------------------------------------------------------------------

function emptyTiming() {
  return {
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
  }
}

function emptyActivity() {
  return { reads: 0, writes: 0, searches: 0, images: 0 }
}

function emptySurfaceCounts() {
  return { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 }
}

/** A bounded, plain-JSON fold state (see the module header). */
export function createState() {
  return {
    surface: [],
    archive: [],
    headerEpochs: [],
    fileOps: [],
    sums: { user: 0, inject: 0, skill: 0, assistant: 0, tool: 0 },
    systemTokens: 0,
    toolsTokens: 0,
    toolDefs: 0,
    counts: { humanInputs: 0, answers: 0, skillLoads: 0, injects: 0, compactions: 0, prunes: 0, toolCalls: 0 },
    activity: emptyActivity(),
    timing: emptyTiming(),
    surfaceCounts: emptySurfaceCounts(),
    toolNames: {},
    commands: [],
    commandStats: { runs: 0, failed: 0, ms: 0, bg: 0 },
    wallMs: 0,
    callNames: {},
    requests: [],
    events: [],
    spans: [],
    truncated: { requests: false, events: false, surface: false },
  }
}

function cloneState(state) {
  return {
    surface: [...state.surface],
    archive: Array.isArray(state.archive) ? [...state.archive] : [],
    ...(Number.isFinite(state.archiveFloor) ? { archiveFloor: state.archiveFloor } : {}),
    headerEpochs: Array.isArray(state.headerEpochs) ? [...state.headerEpochs] : [],
    fileOps: Array.isArray(state.fileOps) ? [...state.fileOps] : [],
    ...(Number.isFinite(state.fileOpsFloor) ? { fileOpsFloor: state.fileOpsFloor } : {}),
    sums: { ...state.sums },
    systemTokens: state.systemTokens,
    toolsTokens: state.toolsTokens,
    toolDefs: safeInt(state.toolDefs),
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.lastModel !== undefined ? { lastModel: state.lastModel } : {}),
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    ...(Number.isFinite(state.maxOutputTokens) ? { maxOutputTokens: state.maxOutputTokens } : {}),
    ...(state.contextWindow !== undefined ? { contextWindow: state.contextWindow } : {}),
    counts: { ...state.counts },
    activity: { ...emptyActivity(), ...(state.activity !== null && typeof state.activity === 'object' ? state.activity : {}) },
    timing: { ...emptyTiming(), ...(state.timing !== null && typeof state.timing === 'object' ? state.timing : {}) },
    surfaceCounts: { ...emptySurfaceCounts(), ...(state.surfaceCounts !== null && typeof state.surfaceCounts === 'object' ? state.surfaceCounts : {}) },
    toolNames: { ...state.toolNames },
    ...(Number.isFinite(state.pendingCommandSeq) ? { pendingCommandSeq: state.pendingCommandSeq } : {}),
    commands: Array.isArray(state.commands) ? [...state.commands] : [],
    commandStats: state.commandStats !== null && typeof state.commandStats === 'object'
      ? { runs: safeInt(state.commandStats.runs), failed: safeInt(state.commandStats.failed), ms: safeInt(state.commandStats.ms), bg: safeInt(state.commandStats.bg) }
      : { runs: 0, failed: 0, ms: 0, bg: 0 },
    wallMs: state.wallMs,
    callNames: { ...state.callNames },
    requests: [...state.requests],
    events: [...state.events],
    // Shared copy-on-write: only `step/end` appends, and it re-slices before
    // touching the array, so a shared reference can never be mutated.
    spans: Array.isArray(state.spans) ? state.spans : [],
    truncated: { ...state.truncated },
    ...(typeof state.lastAnswer === 'string' && state.lastAnswer !== '' ? { lastAnswer: state.lastAnswer } : {}),
    ...(state.stepStart !== undefined
      ? {
        stepStart: {
          time: state.stepStart.time,
          waits: Array.isArray(state.stepStart.waits) ? [...state.stepStart.waits] : [],
          ...(typeof state.stepStart.firstToken === 'number' && Number.isFinite(state.stepStart.firstToken)
            ? { firstToken: state.stepStart.firstToken }
            : {}),
        },
      }
      : {}),
    ...(Array.isArray(state.stepSpans) ? { stepSpans: state.stepSpans.map(span => [span[0], span[1], span[2]]) } : {}),
    // The open step's request anchor: `assistant/message` sets it, `step/end`
    // consumes and clears it. Absent unless a step is mid-flight.
    ...(Number.isFinite(state.stepRequestSeq) ? { stepRequestSeq: state.stepRequestSeq } : {}),
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
  if (MESSAGE_CATS.includes(node.cat)) {
    state.sums[node.cat] += node.tokens
    state.surfaceCounts[node.cat] = (state.surfaceCounts[node.cat] || 0) + 1
  }
}

function removeNodeSums(state, node) {
  if (node.cat === 'system') return
  if (MESSAGE_CATS.includes(node.cat)) {
    state.sums[node.cat] = Math.max(0, state.sums[node.cat] - node.tokens)
    state.surfaceCounts[node.cat] = Math.max(0, (state.surfaceCounts[node.cat] || 0) - 1)
  }
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

/** Parse a shell tool call's arguments into the Command Panel's display fields. */
function shellCommandOf(name, rawArguments) {
  if (!SHELL_TOOLS.has(String(name).toLowerCase())) return null
  let args = rawArguments
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch (_) { args = { command: rawArguments } }
  }
  if (args === null || typeof args !== 'object') return null
  const command = typeof args.command === 'string' ? args.command
    : typeof args.script === 'string' ? args.script
      : typeof args.cmd === 'string' ? args.cmd
        : typeof args.input === 'string' ? args.input : ''
  if (command.trim() === '') return null
  const entry = { command: command.slice(0, 180), ...(command.length > 180 ? { truncated: true } : {}) }
  const description = typeof args.description === 'string' ? args.description
    : typeof args.intent === 'string' ? args.intent : ''
  if (description !== '') entry.description = description.slice(0, 80)
  if (args.run_in_background === true) entry.background = true
  return entry
}

/** Text blocks of a tool result, joined for marker sniffing. */
function resultTextOf(message) {
  const content = message !== null && typeof message === 'object' && Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of content) if (block !== null && typeof block === 'object' && typeof block.text === 'string') parts.push(block.text)
  return parts.join('\n')
}

/** Settle one shell run into the bounded command ledger (Command Panel card). */
function recordCommand(state, pending, message, endTime, seq) {
  if (pending === null || typeof pending !== 'object' || pending.shell === null || typeof pending.shell !== 'object') return
  const shell = pending.shell
  const text = resultTextOf(message)
  const exitMatch = /\[exit code: (-?\d+)\]/i.exec(text)
  const signalMatch = /\[killed by signal: ([^\]]+)\]/i.exec(text)
  const timedOut = /\[timed out/i.test(text) || /\btimed? ?out\b/i.test(text.slice(-120))
  const isError = message !== null && typeof message === 'object' && message.isError === true
  const exit = exitMatch !== null ? Number(exitMatch[1]) : null
  const failed = isError || (exit !== null && exit !== 0) || signalMatch !== null || timedOut
  const durationMs = Math.max(0, Number(endTime) - Number(pending.start || endTime))
  const record = {
    seq: Number.isFinite(seq) ? seq : (Number.isFinite(state.pendingCommandSeq) ? state.pendingCommandSeq : 0),
    time: endTime,
    name: typeof pending.name === 'string' ? pending.name : 'shell',
    command: shell.command,
    durationMs,
    status: signalMatch !== null ? 'killed' : timedOut ? 'failed' : failed ? 'failed' : 'ok',
    ...(shell.description !== undefined ? { description: shell.description } : {}),
    ...(exit !== null ? { exit } : {}),
    ...(signalMatch !== null ? { signal: signalMatch[1].slice(0, 40) } : {}),
    ...(timedOut ? { timedOut: true } : {}),
    ...(text.length > 0 ? { outChars: text.length } : {}),
    ...(/stderr/i.test(text) ? { stderr: true } : {}),
    ...(/\[truncated/i.test(text) ? { truncated: true } : {}),
    background: shell.background === true,
  }
  state.commands.push(record)
  if (state.commands.length > MAX_COMMANDS) state.commands.splice(0, state.commands.length - MAX_COMMANDS)
  const stats = state.commandStats
  stats.runs += 1
  if (record.status !== 'ok') stats.failed += 1
  stats.ms += durationMs
  if (record.background) stats.bg += 1
}

function applySurface(state, event, cat, message) {
  const node = { seq: event.seq, cat, tokens: estimateMessage(message) }
  const eventTime = timeOf(event)
  if (eventTime > 0) node.time = eventTime
  const source = message !== null && typeof message === 'object' ? message.source : null
  if (source !== null && typeof source === 'object') {
    if (typeof source.form === 'string' && source.form !== '') node.form = source.form
    if (typeof source.name === 'string' && source.name !== '') node.name = source.name.slice(0, 160)
  }
  // Row previews + assistant block kinds keep the browser card readable without a
  // second round-trip; both are bounded so the 4k-node surface stays inside the wire budget.
  const blocks = Array.isArray(message && message.content) ? message.content : []
  const kinds = { think: 0, tools: 0, answer: 0 }
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (block.type === 'reasoning') kinds.think += 1
    else if (block.type === 'tool-call') kinds.tools += 1
    else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') kinds.answer += 1
  }
  if (cat === 'assistant' && kinds.think + kinds.tools + kinds.answer > 0) node.kinds = kinds
  const answer = firstText(blocks)
  if (cat === 'assistant') {
    if (answer !== '') node.text = answer.replace(/\s+/g, ' ').trim().slice(0, MAX_LAST_ANSWER)
    else {
      const calls = blocks.filter(block => block && typeof block === 'object' && block.type === 'tool-call')
        .map(block => typeof block.name === 'string' ? block.name.slice(0, 100) : '')
        .filter(Boolean).slice(0, 3)
      if (calls.length > 0) node.calls = calls
    }
  } else if (answer !== '' && (cat === 'user' || cat === 'inject' || cat === 'skill' || cat === 'tool')) {
    node.text = answer.replace(/\s+/g, ' ').trim().slice(0, MAX_PREVIEW_TEXT)
  }
  if (cat === 'tool') {
    const callId = source && typeof source.callId === 'string' ? source.callId : ''
    const call = callId !== '' ? state.callNames[callId] : null
    if (call && typeof call.name === 'string') node.tool = call.name.slice(0, 100)
    if (message && message.isError === true) node.err = true
  }
  const images = countImageBlocks(message)
  if (images > 0) node.imgs = images
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
      for (const old of removed) {
        removeNodeSums(state, old)
        state.archive.push({ ...old, gone: event.seq })
        for (let index = 0; index < state.fileOps.length; index += 1) {
          const op = state.fileOps[index]
          if (op.seq === old.seq && op.gone === undefined) state.fileOps[index] = { ...op, gone: event.seq }
        }
      }
      addNodeSums(state, node)
      if (cat === 'system') recomputeSystemTokens(state)
      trimState(state)
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
  if (Array.isArray(state.spans) && state.spans.length > MAX_SPANS) {
    state.spans = state.spans.slice(state.spans.length - MAX_SPANS)
  }
  if (Array.isArray(state.archive) && state.archive.length > MAX_ARCHIVE_NODES) {
    const removed = state.archive.splice(0, state.archive.length - MAX_ARCHIVE_NODES)
    for (const node of removed) state.archiveFloor = Math.max(state.archiveFloor || 0, safeInt(node.gone))
  }
  if (Array.isArray(state.headerEpochs) && state.headerEpochs.length > MAX_HEADER_EPOCHS) {
    state.headerEpochs.splice(0, state.headerEpochs.length - MAX_HEADER_EPOCHS)
  }
  if (Array.isArray(state.fileOps) && state.fileOps.length > MAX_FILE_OPS) {
    const removed = state.fileOps.splice(0, state.fileOps.length - MAX_FILE_OPS)
    for (const op of removed) state.fileOpsFloor = Math.max(state.fileOpsFloor || 0, safeInt(op.seq))
  }
  if (Object.keys(state.callNames).length > MAX_CALL_NAMES) {
    const keys = Object.keys(state.callNames)
    for (const key of keys.slice(0, keys.length - MAX_CALL_NAMES)) delete state.callNames[key]
  }
}

/**
 * Buffer one span of the open step (`[kind, start, end]`, absolute ms). The
 * buffer is bounded: a hostile stream or replay cannot grow the persisted state,
 * and a dropped span simply becomes part of the step/end residue.
 */
function pushStepSpan(state, span) {
  if (!Array.isArray(span)) return
  const start = span[1]
  const end = span[2]
  if (typeof start !== 'number' || !Number.isFinite(start)) return
  if (typeof end !== 'number' || !Number.isFinite(end) || end <= start) return
  if (!Array.isArray(state.stepSpans)) state.stepSpans = []
  if (state.stepSpans.length >= MAX_STEP_SPANS) return
  state.stepSpans.push([span[0], start, end])
}

/** A non-negative integer for the wire; non-finite/hostile input degrades to 0. */
function safeInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
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
        next.toolDefs = header !== undefined && Array.isArray(header.tools) ? header.tools.length : 0
        if (header !== undefined) {
          const schemas = Array.isArray(header.tools) ? header.tools.slice(0, 100) : []
          const tools = schemas.map(tool => {
            const item = tool !== null && typeof tool === 'object' ? tool : {}
            return { name: typeof item.name === 'string' ? item.name.slice(0, 120) : '?' }
          })
          // The newest epoch carries the compact tool metadata the browser expands;
          // older epochs keep names only so the wire stays bounded.
          const meta = schemas.slice(0, MAX_TOOL_META).map(compactToolMeta)
          next.headerEpochs = next.headerEpochs.map(epoch => (epoch !== null && typeof epoch === 'object' ? { seq: epoch.seq, time: epoch.time, tools: epoch.tools } : epoch))
          next.headerEpochs.push({ seq: event.seq, time: timeOf(event), tools, meta })
        }
        const config = header && header.config !== null && typeof header.config === 'object' ? header.config : undefined
        const previousModel = typeof state.model === 'string' ? state.model : ''
        if (config && typeof config.model === 'string') next.model = config.model
        if (config && typeof config.provider === 'string') next.provider = config.provider
        // The routed output cap auto-compaction reserves out of the window (last wins; a cap-less header clears it).
        const maxOutputTokens = config ? config.maxTokens : undefined
        if (typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
          next.maxOutputTokens = Math.floor(maxOutputTokens)
        } else {
          delete next.maxOutputTokens
        }
        // No dedicated model-switch event: a change/resume header whose model differs from the previous one.
        const reason = data && typeof data.reason === 'string' ? data.reason : ''
        const routedModel = typeof next.model === 'string' ? next.model : ''
        if ((reason === 'change' || reason === 'resume') && previousModel !== '' && routedModel !== '' && previousModel !== routedModel) {
          next.events.push({ seq: event.seq, time: timeOf(event), kind: 'model', from: previousModel, to: routedModel })
          trimState(next)
        }
        if (routedModel !== '') next.lastModel = routedModel
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
        const message = deriveEventMessage(event)
        // The image tally is independent of the CURRENT surface: the desktop
        // activity card counts every user upload in the log, including ones a
        // later compaction replaced (docs §8.1).
        const images = event.type === 'user/message' ? countImageBlocks(message) : 0
        if (!isSurfaceEvent(event)) {
          if (images === 0) return state
          const next = cloneState(state)
          next.activity.images += images
          return next
        }
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
        if (images > 0) next.activity.images += images
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
        const eventTime = timeOf(event)
        const usage = data && data.usage !== null && typeof data.usage === 'object' ? data.usage : null
        // `null` means "no readable output bucket", not a fabricated 0 (see the
        // output-speed rule: it only counts when provider usage is readable).
        const output = usage !== null ? tokenCountOf(usage.outputTokens) : null
        const answerText = firstText(message && message.content)
        const next = cloneState(state)
        // The request record is the prompt this response was assembled for:
        // capture it BEFORE the response joins the surface.
        const record = {
          seq: event.seq,
          time: eventTime,
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
        // v2 request detail (docs §8.1): the surface node counts the request was
        // assembled from (`system` is always the one live system prompt, `tools`
        // the current header's tool definition count) and the provider-reported
        // billed prompt / output buckets.
        const items = { system: 1, tools: next.toolDefs }
        for (const cat of MESSAGE_CATS) {
          if (next.surfaceCounts[cat] > 0) items[cat] = next.surfaceCounts[cat]
        }
        record.items = items
        if (usage !== null) {
          const input = tokenCountOf(usage.inputTokens)
          const cacheRead = tokenCountOf(usage.cacheReadTokens)
          const cacheWrite = tokenCountOf(usage.cacheWriteTokens)
          if (input !== null || cacheRead !== null || cacheWrite !== null || output !== null) {
            record.prompt = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
            if (output !== null) record.output = output
            // Pin detail prints the cache-hit share next to the actuals.
            if (cacheRead !== null) record.cacheRead = cacheRead
            if (input !== null) record.uncachedInput = input
          }
        }
        next.requests.push(record)
        // The open step's duration-curve anchor (docs §8.1): `step/end` stamps
        // the step's active time onto the record this step committed. Set on
        // every assistant message, so a multi-request step prices its last one.
        if (state.stepStart !== undefined) next.stepRequestSeq = event.seq
        // v2 last answer: the newest assistant text, whitespace-collapsed and
        // bounded; tool-only steps leave the previous preview in place.
        if (answerText !== '') {
          const compressed = answerText.replace(/\s+/g, ' ').trim()
          if (compressed !== '') {
            next.lastAnswer = compressed.length > MAX_LAST_ANSWER ? compressed.slice(0, MAX_LAST_ANSWER) : compressed
          }
        }
        // v2 timing split (docs §8.1): only an open step with an observable
        // first token is priced; an unattributed stream lands in the card's
        // `other` residue instead of charging the wait.
        const stepStart = state.stepStart
        if (stepStart !== undefined && Number.isFinite(stepStart.time)) {
          const stream = data && data.stream
          const firstToken = typeof stepStart.firstToken === 'number'
            ? stepStart.firstToken
            : firstTokenTimeOfStream(stream)
          if (firstToken !== undefined) {
            const decodeSpans = decodeSpansOfStream(stream, eventTime)
            let decodeStart = firstToken
            for (const span of decodeSpans) decodeStart = Math.min(decodeStart, span.start)
            next.timing.ttftMs += durOf(stepStart.time, decodeStart)
            next.timing.waitCount += 1
            pushStepSpan(next, [SPAN_WAIT, stepStart.time, decodeStart])
            // The decode blocks tile [decodeStart, eventTime] in stream order; the
            // first block reaches back to the wait boundary, later ones keep their
            // own start so the rows and the strip read the same window.
            let pushedAny = false
            for (const span of decodeSpans) {
              const to = Math.min(eventTime, span.end)
              if (to <= span.start) continue
              const start = pushedAny ? span.start : decodeStart
              if (to > start) {
                pushStepSpan(next, [DECODE_SPAN_KINDS[span.kind], start, to])
                pushedAny = true
              }
            }
            const tally = decodeTallyOfStream(stream, eventTime)
            next.timing.reasoningMs += tally.spans.reasoning
            next.timing.reasoningCount += tally.blocks.reasoning
            next.timing.textMs += tally.spans.text
            next.timing.textCount += tally.blocks.text
            next.timing.toolArgMs += tally.spans.toolarg
            next.timing.toolArgCount += tally.blocks.toolarg
            // Output speed pairs the first-token anchor with the provider's own
            // output count; it only counts when both are known.
            if (output !== null) {
              next.timing.speedMs += durOf(firstToken, eventTime)
              next.timing.speedTokens += output
            }
          }
        }
        if (isSurfaceEvent(event)) {
          const node = applySurface(next, event, 'assistant', message)
          if (node.tokens > 0 && answerText !== '') next.counts.answers += 1
        }
        trimState(next)
        return next
      }
      case 'assistant/attempt': {
        // An attempt that committed no surface message can still carry the
        // step's first token (a retried / aborted call): stamp it on the open
        // step so TTFT stays real instead of falling into the residue.
        const start = state.stepStart
        if (start === undefined || typeof start.firstToken === 'number') return state
        const first = firstTokenTimeOfStream(data && data.stream)
        if (first === undefined) return state
        const next = cloneState(state)
        next.stepStart.firstToken = first
        return next
      }
      case 'tool/call': {
        const callId = data && typeof data.callId === 'string' ? data.callId : ''
        const name = data && typeof data.name === 'string' ? data.name : ''
        if (callId === '' || name === '') return state
        const next = cloneState(state)
        const file = fileCallMeta(name, data && data.arguments)
        const shell = shellCommandOf(name, data && data.arguments)
        next.callNames[callId] = { name, start: timeOf(event), ...(file !== null ? { file } : {}), ...(shell !== null ? { shell } : {}) }
        trimState(next)
        return next
      }
      case 'tool/result': {
        const message = deriveEventMessage(event)
        const source = message && message.source !== null && typeof message.source === 'object' ? message.source : undefined
        const callId = source && typeof source.callId === 'string' ? source.callId : ''
        const pending = callId !== '' ? state.callNames[callId] : undefined
        const eventTime = timeOf(event)
        if (!isSurfaceEvent(event)) {
          if (pending === undefined) return state
          const ops = fileOpsOf(event, message, pending)
          const shellPending = pending.shell !== null && typeof pending.shell === 'object'
          if (ops.length === 0 && !shellPending) return state
          const next = cloneState(state)
          next.pendingCommandSeq = (Number.isFinite(next.pendingCommandSeq) ? next.pendingCommandSeq : 0) + 1
          if (shellPending) recordCommand(next, pending, message, eventTime, event.seq)
          if (ops.length > 0) next.fileOps.push(...ops)
          if (callId !== '') delete next.callNames[callId]
          trimState(next)
          return next
        }
        const next = cloneState(state)
        const node = applySurface(next, event, 'tool', message)
        if (pending !== undefined) {
          next.pendingCommandSeq = (Number.isFinite(next.pendingCommandSeq) ? next.pendingCommandSeq : 0) + 1
          recordCommand(next, pending, message, eventTime, event.seq)
          next.fileOps.push(...fileOpsOf(event, message, pending))
          next.counts.toolCalls += 1
          next.toolNames[pending.name] = (next.toolNames[pending.name] || 0) + 1
          // v2 activity: classify the paired run by its durable tool name.
          const activityKey = toolActivityOf(pending.name)
          if (activityKey !== '') next.activity[activityKey] += 1
          // v2 tool timing: the paired run's wall slice, priced on the same
          // call/result pairing the tool tallies use.
          next.timing.toolsMs += durOf(pending.start, eventTime)
          next.timing.toolCount += 1
          pushStepSpan(next, [SPAN_TOOLS, pending.start, eventTime])
          if (pending.name === 'ask_user_question' && next.stepStart !== undefined) {
            next.stepStart.waits.push({ start: pending.start, end: eventTime })
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
              next.surfaceCounts.tool = Math.max(0, next.surfaceCounts.tool - 1)
              next.surfaceCounts.skill += 1
              next.counts.skillLoads += 1
              next.events.push({ seq: event.seq, time: eventTime, kind: 'inject', form: 'instructions', sub: 'skill', name: skillName })
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
        // A superseded step's span buffer belongs to the old window.
        delete next.stepSpans
        delete next.stepRequestSeq
        return next
      }
      case 'step/end': {
        if (state.stepStart === undefined) return state
        const next = cloneState(state)
        const start = state.stepStart
        const endTime = timeOf(event)
        const duration = Math.max(0, endTime - start.time)
        const activeMs = Math.max(0, duration - clampWaitMs(start, endTime))
        next.wallMs = state.wallMs + activeMs
        // Duration overlay source (docs §8.1): the step window minus the clamped
        // union of the step's user waits (approvals + ask_user_question), priced
        // onto the request record this step committed. A trimmed/refolded row is
        // skipped by the seq check instead of mis-stamping a newer record.
        if (Number.isFinite(state.stepRequestSeq)) {
          const lastIndex = next.requests.length - 1
          const last = lastIndex >= 0 ? next.requests[lastIndex] : null
          if (last !== null && last.seq === state.stepRequestSeq) {
            next.requests[lastIndex] = { ...last, activeMs }
          }
        }
        delete next.stepRequestSeq
        // Tile the step's span buffer across [step start, step end]: first-wins
        // de-overlap so parallel tool runs paint their union once, and every hole
        // is filled with the `other` residue so the strip stays gapless.
        const painted = []
        for (const span of Array.isArray(state.stepSpans) ? state.stepSpans : []) {
          const from = Math.max(start.time, span[1])
          const to = Math.min(endTime, span[2])
          if (to > from) painted.push([span[0], from, to])
        }
        painted.sort((left, right) => (left[1] - right[1]) || (left[2] - right[2]))
        next.spans = state.spans.slice()
        let cursor = start.time
        for (const span of painted) {
          const from = Math.max(cursor, span[1])
          if (span[2] <= from) continue
          if (from > cursor) next.spans.push([SPAN_OTHER, cursor, from])
          next.spans.push([span[0], from, span[2]])
          cursor = span[2]
        }
        if (endTime > cursor) next.spans.push([SPAN_OTHER, cursor, endTime])
        if (next.spans.length > MAX_SPANS) next.spans = next.spans.slice(next.spans.length - MAX_SPANS)
        delete next.stepStart
        delete next.stepSpans
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
      case 'plan/mode': {
        // Plan mode adds a guidance section to every request, so it earns an event.
        if (data === undefined || typeof data.active !== 'boolean') return state
        const next = cloneState(state)
        next.events.push({ seq: event.seq, time: timeOf(event), kind: 'mode', name: data.active ? 'plan.on' : 'plan.off' })
        trimState(next)
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

/** Browser index node: previews/kinds only for the newest slice; older rows fetch content on demand. */
function slimIndexNode(node, keepDetail) {
  if (node === null || typeof node !== 'object') return node
  if (keepDetail) return { ...node }
  const copy = { ...node }
  delete copy.text
  delete copy.kinds
  return copy
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
  const activity = state.activity !== null && typeof state.activity === 'object' ? state.activity : {}
  const timingRaw = state.timing !== null && typeof state.timing === 'object' ? state.timing : {}
  // The six-way split: the five measured buckets plus the residue, so the card's
  // percentages always add up and `otherMs` is never negative (docs §8.1).
  const wallMs = safeInt(state.wallMs)
  const ttftMs = safeInt(timingRaw.ttftMs)
  const reasoningMs = safeInt(timingRaw.reasoningMs)
  const textMs = safeInt(timingRaw.textMs)
  const toolArgMs = safeInt(timingRaw.toolArgMs)
  const toolsMs = safeInt(timingRaw.toolsMs)
  const measuredMs = ttftMs + reasoningMs + textMs + toolArgMs + toolsMs
  return {
    v: 1,
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    ...(state.contextWindow !== undefined ? { contextWindow: state.contextWindow } : {}),
    ...(Number.isFinite(state.maxOutputTokens) ? { maxOutputTokens: state.maxOutputTokens } : {}),
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
    // v2 activity ledger (docs §8.1): `userInputs` mirrors the v1 `humanInputs`.
    activity: {
      userInputs: state.counts.humanInputs,
      reads: safeInt(activity.reads),
      writes: safeInt(activity.writes),
      searches: safeInt(activity.searches),
      images: safeInt(activity.images),
    },
    tools: { total: state.counts.toolCalls, count: safeInt(state.toolDefs), names: sortedToolNames(state) },
    timing: {
      wallMs,
      ttftMs,
      reasoningMs,
      textMs,
      toolArgMs,
      toolsMs,
      otherMs: Math.max(0, wallMs - measuredMs),
      waitCount: safeInt(timingRaw.waitCount),
      reasoningCount: safeInt(timingRaw.reasoningCount),
      textCount: safeInt(timingRaw.textCount),
      toolArgCount: safeInt(timingRaw.toolArgCount),
      toolCount: safeInt(timingRaw.toolCount),
      speedTokens: safeInt(timingRaw.speedTokens),
      speedMs: safeInt(timingRaw.speedMs),
    },
    // v2 timeline: newest MAX_SPANS segments, each [kind, start, end].
    spans: (Array.isArray(state.spans) ? state.spans : []).map(span => [span[0], span[1], span[2]]),
    // Slim browser index; full message/header bodies are fetched only when a row is opened.
    // Row previews / block kinds ride only the newest slice, so the wire stays inside budget.
    surface: (Array.isArray(state.surface) ? state.surface : []).map((node, index, nodes) => slimIndexNode(node, index >= nodes.length - INDEX_DETAIL_NODES)),
    archive: (Array.isArray(state.archive) ? state.archive : []).map((node, index, nodes) => slimIndexNode(node, index >= nodes.length - INDEX_DETAIL_NODES)),
    headerEpochs: (Array.isArray(state.headerEpochs) ? state.headerEpochs : []).map(epoch => ({
      ...epoch,
      tools: Array.isArray(epoch.tools) ? epoch.tools.map(tool => ({ ...tool })) : [],
    })),
    fileOps: (Array.isArray(state.fileOps) ? state.fileOps : []).map(op => ({ ...op })),
    commands: (Array.isArray(state.commands) ? state.commands : []).map(command => ({ ...command })),
    commandStats: { ...(state.commandStats || { runs: 0, failed: 0, ms: 0, bg: 0 }) },
    ...(Number.isFinite(state.archiveFloor) ? { archiveFloor: state.archiveFloor } : {}),
    ...(Number.isFinite(state.fileOpsFloor) ? { fileOpsFloor: state.fileOpsFloor } : {}),
    ...(typeof state.lastAnswer === 'string' && state.lastAnswer !== '' ? { lastAnswer: state.lastAnswer } : {}),
    requests: state.requests.map(record => ({
      ...record,
      ...(record.items !== undefined && record.items !== null ? { items: { ...record.items } } : {}),
    })),
    events: state.events.map(record => ({ ...record })),
    truncated: { ...state.truncated },
  }
}

/** The `mobileContext` projection definition registered on `ctx.sessionProjections`. */
export const contextProjectionDefinition = {
  key: 'mobileContext',
  // v4 adds bounded file-operation records; older cache rows refold to populate File Activity.
  // v5 stamps each request record with its step's activeMs (the trend chart's
  // duration curve); older cache rows refold to populate it.
  stateVersion: 5,
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
let hostSessionQuery = null
let hostSkills = null
let hostAgentPresets = null

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
    // DSH's own Fleet client backfills cold Agent heads through sessionQuery.
    // Use the same source when a subagent is no longer attached to sessions.list().
    ctx.inject(['sessionQuery'], (sub) => {
      if (!sub || !sub.sessionQuery) return
      hostSessionQuery = sub.sessionQuery
      sub.effect(() => () => { hostSessionQuery = null })
    })
  } catch (_) { /* optional service */ }
  try {
    ctx.inject(['agents'], (sub) => {
      if (!sub || !sub.agents) return
      hostAgents = sub.agents
      sub.effect(() => () => { hostAgents = null })
    })
  } catch (_) { /* optional service */ }
  try {
    ctx.inject(['skills'], (sub) => {
      if (!sub || !sub.skills) return
      hostSkills = sub.skills
      sub.effect(() => () => { hostSkills = null })
    })
  } catch (_) { /* optional service */ }
  try {
    ctx.inject(['agentPresets'], (sub) => {
      if (!sub || !sub.agentPresets) return
      hostAgentPresets = sub.agentPresets
      sub.effect(() => () => { hostAgentPresets = null })
    })
  } catch (_) { /* optional service */ }
  return true
}

const MAX_FLEET_AGENTS = 40
const TEAM_TASK_DESCRIPTION_MAX = 400 // 任务卡正文预览上限

function fleetNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * Bound one host `agentTeam` projection value to the wire shape docs §8.2
 * names: at most MAX_TEAM_ROWS members and MAX_TEAM_ROWS tasks, minimal fields,
 * always a plain-JSON object. Returns null when the value carries no roster.
 */
function teamOf(agentTeam) {
  if (agentTeam === null || typeof agentTeam !== 'object' || Array.isArray(agentTeam)) return null
  if (!Array.isArray(agentTeam.members) && !Array.isArray(agentTeam.tasks)) return null
  const members = []
  for (const member of Array.isArray(agentTeam.members) ? agentTeam.members : []) {
    if (members.length >= MAX_TEAM_ROWS) break
    if (member === null || typeof member !== 'object') continue
    if (typeof member.id !== 'string' || member.id === '') continue
    const entry = {
      id: member.id,
      name: typeof member.name === 'string' ? member.name : '',
      role: member.role === 'lead' ? 'lead' : 'teammate',
      phase: TEAM_PHASES.has(member.phase) ? member.phase : 'active',
    }
    if (typeof member.error === 'string' && member.error !== '') entry.error = member.error
    members.push(entry)
  }
  const tasks = []
  for (const task of Array.isArray(agentTeam.tasks) ? agentTeam.tasks : []) {
    if (tasks.length >= MAX_TEAM_ROWS) break
    if (task === null || typeof task !== 'object') continue
    if (typeof task.id !== 'string' || task.id === '') continue
    const entry = {
      id: task.id,
      subject: typeof task.subject === 'string' ? task.subject : '',
      status: typeof task.status === 'string' ? task.status : 'pending',
    }
    // The host projection carries `description` (the task instructions); the
    // mini program renders it under the subject. Bounded because this rides the
    // fleet frame alongside members and links.
    if (typeof task.description === 'string' && task.description !== '') {
      entry.description = task.description.slice(0, TEAM_TASK_DESCRIPTION_MAX)
    }
    if (typeof task.ownerName === 'string' && task.ownerName !== '') entry.ownerName = task.ownerName
    if (typeof task.ownerId === 'string' && task.ownerId !== '') entry.ownerId = task.ownerId
    tasks.push(entry)
  }
  return {
    members,
    tasks,
    failure: typeof agentTeam.failure === 'string' ? agentTeam.failure : '',
  }
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

  // Resolve every family snapshot once: the team roster comes from the ROOT
  // session's `agentTeam` projection (each session's team projection is scoped
  // to itself), and the per-agent cards read from the same snapshot.
  const resolved = order.map(item => {
    try {
      return resolve(item.record.id)
    } catch (_) {
      return null
    }
  })
  const valuesOf = index => resolved[index] !== null && typeof resolved[index] === 'object' ? resolved[index] : {}
  let team = null
  let teamPhaseById = null
  const teamCandidateOrder = []
  const rootIndex = order.findIndex(item => item.record.id === rootId)
  if (rootIndex >= 0) teamCandidateOrder.push(rootIndex)
  for (let index = 0; index < order.length; index += 1) if (index !== rootIndex) teamCandidateOrder.push(index)
  for (const index of teamCandidateOrder) {
    const candidate = teamOf(valuesOf(index).agentTeam)
    if (candidate !== null) {
      team = candidate
      break
    }
  }
  if (team !== null) {
    teamPhaseById = new Map()
    for (const member of team.members) teamPhaseById.set(member.id, member.phase)
  }

  const agents = []
  let running = 0
  let subagents = 0
  for (let index = 0; index < order.length; index += 1) {
    const item = order[index]
    const record = item.record
    const v = valuesOf(index)
    const subagent = v.subagent !== null && typeof v.subagent === 'object' ? v.subagent : null
    const pressure = v.contextPressure !== null && typeof v.contextPressure === 'object' ? v.contextPressure : null
    const usage = v.tokenUsage !== null && typeof v.tokenUsage === 'object' ? v.tokenUsage : null
    const stats = v.sessionStats !== null && typeof v.sessionStats === 'object' ? v.sessionStats : null
    const context = v.mobileContext !== null && typeof v.mobileContext === 'object' ? v.mobileContext : null
    const timeline = v.contextTimeline !== null && typeof v.contextTimeline === 'object' ? v.contextTimeline : null
    const contextCurrent = context !== null && context.current !== null && typeof context.current === 'object'
      ? context.current : null
    const timelineCurrent = timeline !== null && timeline.current !== null && typeof timeline.current === 'object'
      ? timeline.current : null
    // DSH's client reads the native contextTimeline/contextPressure projections per Agent.
    // mobileContext remains a fallback for older gateway-compatible hosts.
    const compositionSource = timelineCurrent || contextCurrent
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
    if (record.origin === 'subagent') entry.origin = 'subagent'
    if (subagent !== null && (subagent.mode === 'one-shot' || subagent.mode === 'continuable')) entry.mode = subagent.mode
    if (subagent !== null && typeof subagent.label === 'string' && subagent.label !== '') entry.label = subagent.label
    if (context !== null && typeof context.model === 'string') entry.model = context.model
    if (context !== null && typeof context.provider === 'string') entry.provider = context.provider
    const contextWindow = pressure !== null && typeof pressure.contextWindow === 'number' && pressure.contextWindow > 0
      ? pressure.contextWindow
      : timeline !== null && typeof timeline.contextWindow === 'number' && timeline.contextWindow > 0
        ? timeline.contextWindow
        : context !== null && typeof context.contextWindow === 'number' && context.contextWindow > 0 ? context.contextWindow : 0
    if (contextWindow > 0) entry.contextWindow = contextWindow
    let pressureTokens = pressure !== null && typeof pressure.projectedTokens === 'number' && pressure.projectedTokens >= 0
      ? pressure.projectedTokens
      : pressure !== null && typeof pressure.pressureTokens === 'number' && pressure.pressureTokens >= 0
        ? pressure.pressureTokens
        : null
    if (pressureTokens === null && timeline !== null && timelineCurrent !== null) {
      // Match dsh-context headlineOf: sampled/projected pressure, then the latest prompt
      // adjusted by the fold's current delta, finally the current context estimate.
      const last = timeline.last !== null && typeof timeline.last === 'object' ? timeline.last : null
      const requests = Array.isArray(timeline.requests) ? timeline.requests : []
      const latest = requests.length > 0 && requests[requests.length - 1] !== null
        && typeof requests[requests.length - 1] === 'object' ? requests[requests.length - 1] : null
      const anchor = last || latest
      const prompt = anchor !== null && typeof anchor.prompt === 'number' && Number.isFinite(anchor.prompt)
        ? anchor.prompt : null
      const anchorTotal = anchor !== null && typeof anchor.total === 'number' && Number.isFinite(anchor.total)
        ? anchor.total : null
      const currentTotal = typeof timelineCurrent.total === 'number' && Number.isFinite(timelineCurrent.total)
        ? timelineCurrent.total : 0
      pressureTokens = prompt !== null && anchorTotal !== null
        ? Math.max(0, prompt + currentTotal - anchorTotal) : currentTotal
    }
    if (pressureTokens === null && contextCurrent !== null && typeof contextCurrent.total === 'number' && contextCurrent.total >= 0) {
      pressureTokens = contextCurrent.total
    }
    if (pressureTokens !== null) entry.pressureTokens = pressureTokens
    if (timelineCurrent !== null && typeof timelineCurrent.total === 'number' && timelineCurrent.total >= 0) {
      entry.contextTokens = timelineCurrent.total
    } else if (contextCurrent !== null && typeof contextCurrent.total === 'number' && contextCurrent.total >= 0) {
      entry.contextTokens = contextCurrent.total
    }
    let billedTokens = 0
    let hasBilledTokens = false
    if (usage !== null) {
      const total = fleetNumber(usage.uncachedInputTokens) + fleetNumber(usage.cacheReadTokens)
        + fleetNumber(usage.cacheWriteTokens) + fleetNumber(usage.outputTokens)
      billedTokens = total
      hasBilledTokens = true
    } else if (timeline !== null && timeline.cost !== null && typeof timeline.cost === 'object') {
      // dsh-context falls back from tokenUsage to its own cumulative cost ledger.
      for (const provider of Object.keys(timeline.cost)) {
        const models = timeline.cost[provider]
        if (models === null || typeof models !== 'object') continue
        for (const model of Object.keys(models)) {
          const periods = models[model]
          if (periods === null || typeof periods !== 'object') continue
          for (const period of ['peak', 'off']) {
            const bucket = periods[period]
            if (bucket === null || typeof bucket !== 'object') continue
            billedTokens += fleetNumber(bucket.uncached) + fleetNumber(bucket.cacheRead)
              + fleetNumber(bucket.cacheWrite) + fleetNumber(bucket.output)
            hasBilledTokens = true
          }
        }
      }
    }
    if (hasBilledTokens && billedTokens > 0) entry.tokensTotal = billedTokens
    if (stats !== null && Number.isFinite(stats.turns)) entry.turns = stats.turns
    if (timeline !== null) {
      const counts = timeline.counts !== null && typeof timeline.counts === 'object' ? timeline.counts : null
      if (counts !== null && Number.isFinite(counts.steps)) entry.steps = counts.steps
      else if (Array.isArray(timeline.requests)) entry.steps = timeline.requests.length
    }
    if (entry.steps === undefined && stats !== null && Number.isFinite(stats.steps)) entry.steps = stats.steps
    const timing = v.subagentTiming !== null && typeof v.subagentTiming === 'object' ? v.subagentTiming : null
    if (timing !== null) {
      const active = timing.active !== null && typeof timing.active === 'object' ? timing.active : null
      const activeMs = fleetNumber(timing.settledMs)
        + (active !== null ? Math.max(0, fleetNumber(active.through) - fleetNumber(active.since)) : 0)
      if (activeMs > 0) entry.activeMs = activeMs
    }
    if (!(entry.activeMs > 0) && timeline !== null && timeline.timing !== null && typeof timeline.timing === 'object') {
      const wallMs = fleetNumber(timeline.timing.wallMs)
      if (wallMs > 0) entry.activeMs = wallMs
    }
    if (!(entry.activeMs > 0) && context !== null && context.timing !== null && typeof context.timing === 'object') {
      const wallMs = fleetNumber(context.timing.wallMs)
      if (wallMs > 0) entry.activeMs = wallMs
    }
    const isSubagent = record.origin === 'subagent' || subagent !== null
    const completedTurn = timing !== null && timing.lastTurnCompleted === true
    // Mirror dsh-context agentTurnCompletedOf / AgentForest.completed; never
    // infer completion merely because a session is currently not running.
    if (!isAgentRunning && (completedTurn || (!isSubagent && fleetNumber(entry.steps) > 0))) {
      entry.completed = true
    }
    // v2 fleet card fields (docs §8.2): the newest answer preview and the team
    // member phase; the current session defaults to `active` when the roster
    // exists but does not list it.
    if (context !== null && typeof context.lastAnswer === 'string' && context.lastAnswer !== '') {
      entry.lastAnswer = context.lastAnswer
    }
    if (teamPhaseById !== null) {
      const phase = teamPhaseById.get(record.id)
      if (typeof phase === 'string' && TEAM_PHASES.has(phase)) entry.phase = phase
      else if (record.id === current) entry.phase = 'active'
    }
    agents.push(entry)
  }

  return {
    rootSessionId: rootId,
    currentSessionId: current,
    agents,
    ...(team !== null ? { team } : {}),
    counts: { agents: agents.length, running, subagents },
  }
}

// ---------------------------------------------------------------------------
// Cross-agent comms: on-demand scan of the family's session logs for relay /
// mailbox / settled messages (dsh-context host/fleet.ts + commsPanel.tsx).
// ---------------------------------------------------------------------------

export const COMMS_SCAN_MAX_SESSIONS = 12
export const COMMS_MAX_MESSAGES = 200
const COMMS_TEXT_MAX = 240
const MAILBOX_PREFIX = /^Team message \S+ from [^:]{1,64}:\s*/
const RELAY_PREFIX = /^(?:Agent \S+ sent a message: |Team message from [^:\n]{1,64}:\s*)/

function commsToolArguments(event) {
  if (event === null || typeof event !== 'object' || event.type !== 'tool/call') return null
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  if (data.name !== 'send_message' || typeof data.arguments !== 'string') return null
  try {
    const args = JSON.parse(data.arguments)
    return args !== null && typeof args === 'object' && !Array.isArray(args) ? args : null
  } catch (_) {
    return null
  }
}

function commsTextOfContent(content) {
  const blocks = Array.isArray(content) ? content : []
  const parts = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if (typeof block.text === 'string' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n')
}

/** One comms row from a `user/message` event (returns null for ordinary prompts/injections). */
export function commsMessageOf(event, sessionId, familySessionIds, successfulToolCalls, options) {
  if (event === null || typeof event !== 'object') return null
  if (event.type === 'tool/call') {
    const args = commsToolArguments(event)
    if (args === null || typeof args.message !== 'string' || args.message.trim() === '') return null
    // DSH rc.3 names the recipient `target` (an agent name); older shapes used
    // `agent_id` (a session id). Accept both and resolve a name through the
    // roster the client forwards with the scan request.
    const explicitId = typeof args.agent_id === 'string' && args.agent_id !== '' ? args.agent_id
      : typeof args.agentId === 'string' && args.agentId !== '' ? args.agentId : ''
    const targetName = typeof args.target === 'string' && args.target.trim() !== '' ? args.target.trim() : ''
    const targetRaw = explicitId !== '' ? explicitId : targetName
    if (targetRaw === '') return null
    const resolveTarget = options && typeof options.resolveTarget === 'function' ? options.resolveTarget : null
    const targetId = explicitId !== '' ? explicitId
      : (resolveTarget !== null ? (resolveTarget(targetName) || targetName) : targetName)
    // Without a resolvable roster the target stays a display name; a family
    // membership check would then hide every relay row (the rc.3 regression).
    if (explicitId !== '' && familySessionIds instanceof Set && familySessionIds.size > 0
      && !familySessionIds.has(explicitId)) return null
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
    const callId = typeof data.callId === 'string' ? data.callId : ''
    if (callId === '' || !(successfulToolCalls instanceof Set) || !successfulToolCalls.has(`${sessionId}:${callId}`)) return null
    const text = args.message.trim()
    return {
      seq: Number.isFinite(event.seq) ? event.seq : 0,
      time: Number.isFinite(event.time) ? event.time : 0,
      kind: 'relay',
      text: text.length > COMMS_TEXT_MAX ? text.slice(0, COMMS_TEXT_MAX) + '…' : text,
      from: sessionId,
      to: targetId,
      ...(explicitId === '' && targetName !== '' ? { toName: targetName } : {}),
    }
  }
  if (event.type !== 'user/message') return null
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  const source = data.source !== null && typeof data.source === 'object' ? data.source : null
  if (source === null) return null
  const kind = source.kind
  let row = null
  if (kind === 'agent-message' || kind === 'team-message') {
    let text = commsTextOfContent(data.content)
    text = text.replace(kind === 'team-message' ? MAILBOX_PREFIX : RELAY_PREFIX, '')
    if (text.trim() === '') return null
    row = {
      seq: Number.isFinite(event.seq) ? event.seq : 0,
      time: Number.isFinite(event.time) ? event.time : 0,
      kind: kind === 'agent-message' ? 'relay' : 'mailbox',
      text: text.length > COMMS_TEXT_MAX ? text.slice(0, COMMS_TEXT_MAX) + '…' : text,
      to: sessionId,
    }
    if (typeof source.senderSessionId === 'string' && source.senderSessionId !== '') row.from = source.senderSessionId
    else if (typeof source.senderId === 'string' && source.senderId !== '') row.from = source.senderId
    if (typeof source.senderName === 'string' && source.senderName !== '') row.fromName = source.senderName
    return row
  }
  if (kind === 'subagent-settled') {
    const summary = typeof source.summary === 'string' && source.summary.trim() !== ''
      ? source.summary : commsTextOfContent(data.content)
    if (summary.trim() === '') return null
    row = {
      seq: Number.isFinite(event.seq) ? event.seq : 0,
      time: Number.isFinite(event.time) ? event.time : 0,
      kind: 'settled',
      text: summary.length > COMMS_TEXT_MAX ? summary.slice(0, COMMS_TEXT_MAX) + '…' : summary,
      to: sessionId,
    }
    if (typeof source.senderSessionId === 'string' && source.senderSessionId !== '') row.from = source.senderSessionId
    if (typeof source.senderName === 'string' && source.senderName !== '') row.fromName = source.senderName
    return row
  }
  return null
}

/**
 * Pure comms aggregate. Sessions include raw events plus DSH mode/projection metadata.
 * Returns newest-first rows, merged across sessions, capped at COMMS_MAX_MESSAGES.
 */
export function buildCommsValue(sessions, options) {
  const titles = Object.create(null)
  const familySessionIds = new Set()
  const successfulToolCalls = new Set()
  const messages = []
  let scanned = 0
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session === null || typeof session !== 'object') continue
    const id = typeof session.id === 'string' ? session.id : ''
    if (id === '') continue
    familySessionIds.add(id)
  }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session === null || typeof session !== 'object' || typeof session.id !== 'string' || session.id === '') continue
    for (const event of Array.isArray(session.events) ? session.events : []) {
      if (event === null || typeof event !== 'object' || event.type !== 'tool/result') continue
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      const result = data.message !== null && typeof data.message === 'object' ? data.message : {}
      const source = result.source !== null && typeof result.source === 'object' ? result.source : {}
      const callId = typeof source.callId === 'string' ? source.callId
        : typeof data.callId === 'string' ? data.callId : ''
      if (callId !== '' && data.error === undefined && result.isError !== true) {
        successfulToolCalls.add(`${session.id}:${callId}`)
      }
    }
  }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session === null || typeof session !== 'object') continue
    const id = typeof session.id === 'string' ? session.id : ''
    if (id === '') continue
    scanned += 1
    if (typeof session.title === 'string' && session.title !== '') titles[id] = session.title.slice(0, 120)
    for (const event of Array.isArray(session.events) ? session.events : []) {
      const row = commsMessageOf(event, id, familySessionIds, successfulToolCalls, options)
      if (row !== null) messages.push(row)
    }
  }

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session === null || typeof session !== 'object' || typeof session.id !== 'string' || session.id === '') continue
    const id = session.id
    // In current DSH Session logs, send_message is durable as a tool/call on
    // the sender; a completed continuable child reports its settled state via
    // the subagentTiming projection rather than a user/message event.
    const parentSessionId = typeof session.parentSessionId === 'string' ? session.parentSessionId : ''
    const projections = session.projections !== null && typeof session.projections === 'object' ? session.projections : {}
    const values = projections.values !== null && typeof projections.values === 'object' ? projections.values : {}
    const timing = values.subagentTiming !== null && typeof values.subagentTiming === 'object' ? values.subagentTiming : null
    const active = timing !== null && timing.active !== null && typeof timing.active === 'object' ? timing.active : null
    if (parentSessionId !== '' && familySessionIds.has(parentSessionId)
      && timing !== null && timing.lastTurnCompleted === true && active === null) {
      const completed = (Array.isArray(session.events) ? session.events : []).filter((event) =>
        event !== null && typeof event === 'object' && event.type === 'turn/end'
        && event.data !== null && typeof event.data === 'object'
        && event.data.reason !== null && typeof event.data.reason === 'object'
        && event.data.reason.kind === 'completed').at(-1)
      if (completed !== undefined) {
        const mode = session.mode === 'one-shot' || session.mode === 'continuable' ? session.mode : 'continuable'
        const completionText = mode === 'one-shot'
          ? `Background subagent ${id} finished. It cannot receive follow-up messages.`
          : `Background subagent ${id} finished and will do no further work unless you send it more.`
        const hasRecordedSettled = messages.some((message) => message.kind === 'settled'
          && message.from === id && message.to === parentSessionId)
        if (!hasRecordedSettled) {
          messages.push({
            seq: Number.isFinite(completed.seq) ? completed.seq : 0,
            time: Number.isFinite(completed.time) ? completed.time : 0,
            kind: 'settled',
            text: completionText,
            from: id,
            to: parentSessionId,
          })
        }
      }
    }
  }
  // The same relay appears twice: as the sender's durable `send_message`
  // tool/call and as the recipient's agent-message injection. Collapse exact
  // route+text duplicates observed within five minutes.
  const unique = []
  const seenRelay = new Map()
  const resolveTarget = options && typeof options.resolveTarget === 'function' ? options.resolveTarget : null
  const routeOf = (message) => {
    // The sender's tool/call stores the teammate name; the recipient's
    // injection stores the session id. Resolve both to one route before dedupe.
    if (resolveTarget !== null && typeof message.toName === 'string' && message.toName !== '') {
      return resolveTarget(message.toName) || String(message.to || '')
    }
    return String(message.to || '')
  }
  for (const message of messages.sort((left, right) => (left.time - right.time) || (left.seq - right.seq))) {
    const key = `${message.kind}|${message.from || ''}|${routeOf(message)}|${String(message.text || '').replace(/\s+/g, ' ').trim()}`
    const previous = seenRelay.get(key)
    if (previous !== undefined && Math.abs(message.time - previous) < 60_000) continue
    seenRelay.set(key, message.time)
    unique.push(message)
  }
  messages.length = 0
  messages.push(...unique)
  messages.sort((left, right) => (right.time - left.time) || (right.seq - left.seq))
  const total = messages.length
  const capped = messages.slice(0, COMMS_MAX_MESSAGES).map((row) => {
    const result = { ...row }
    if (result.fromName === undefined && result.from !== undefined && titles[result.from] !== undefined) result.fromName = titles[result.from]
    if (result.toName === undefined && titles[result.to] !== undefined) result.toName = titles[result.to]
    return result
  })
  return {
    v: 1,
    messages: capped,
    scanned,
    total,
    truncated: total > capped.length,
  }
}

/** Serve one `context-comms` request: scan the requested family sessions' recent logs. */
export async function handleContextComms(api, msg) {
  const requestType = msg && msg.type
  const requested = msg && Array.isArray(msg.sessionIds) ? msg.sessionIds.filter((id) => typeof id === 'string' && id !== '') : []
  const sessionIds = Array.from(new Set(requested)).slice(0, COMMS_SCAN_MAX_SESSIONS)
  if (sessionIds.length === 0) {
    return { kind: 'error', code: 'bad-request', requestType, message: 'context-comms requires sessionIds' }
  }
  if (!api || !api.sessions || typeof api.sessions.history !== 'function') {
    return unavailable(requestType, sessionIds[0], 'Session history is unavailable on this host')
  }
  const addressById = new Map()
  for (const ref of Array.isArray(msg.sessions) ? msg.sessions : []) {
    if (ref === null || typeof ref !== 'object' || typeof ref.id !== 'string' || ref.id === '') continue
    if (typeof ref.parentSessionId !== 'string' || ref.parentSessionId === '') continue
    const mode = ref.mode === 'one-shot' || ref.mode === 'continuable' || ref.mode === 'unknown'
      ? ref.mode : 'unknown'
    addressById.set(ref.id, { parentSessionId: ref.parentSessionId, mode })
  }
  // rc.3 sends `send_message` with the teammate name; the roster (id/name) lets
  // the scan resolve it to a session id so the route shows the real Agent.
  const memberIdByName = new Map()
  for (const member of Array.isArray(msg.members) ? msg.members : []) {
    if (member === null || typeof member !== 'object') continue
    const id = typeof member.id === 'string' ? member.id : ''
    const name = typeof member.name === 'string' ? member.name.trim() : ''
    if (id === '' || name === '' || memberIdByName.has(name)) continue
    memberIdByName.set(name, id)
  }
  const resolveTarget = memberIdByName.size > 0
    ? (name) => memberIdByName.get(String(name).trim()) || ''
    : null
  const sessions = []
  for (const sessionId of sessionIds) {
    try {
      const address = addressById.get(sessionId)
      const history = await api.sessions.history({
        sessionId,
        maxMessages: 400,
        ...(address ? { parentSessionId: address.parentSessionId, mode: address.mode } : {}),
      })
      if (history === null || typeof history !== 'object' || history.kind === 'error') continue
      const entries = Array.isArray(history.events) ? history.events : []
      const events = entries.map((entry) => (entry !== null && typeof entry === 'object' && entry.event !== null && typeof entry.event === 'object' ? entry.event : entry))
      sessions.push({
        id: sessionId,
        title: typeof history.title === 'string' ? history.title : '',
        events,
        ...(address ? { parentSessionId: address.parentSessionId, mode: address.mode } : {}),
        ...(history.projections && typeof history.projections === 'object' ? { projections: history.projections } : {}),
      })
    } catch (_) {
      // One unreadable log must not abort the scan of the others.
    }
  }
  try {
    return {
      kind: 'context-comms',
      sessionId: sessionIds[0],
      value: buildCommsValue(sessions, resolveTarget === null ? undefined : { resolveTarget }),
    }
  } catch (_) {
    return unavailable(requestType, sessionIds[0], 'Unable to scan cross-agent messages')
  }
}

// ---------------------------------------------------------------------------
// Context Insights: bounded cross-session activity and session summaries.
// ---------------------------------------------------------------------------

export const INSIGHTS_MAX_SESSIONS = 120
export const INSIGHTS_DAYS = 56
const INSIGHTS_PRICE_URL = 'https://models.dev/api.json'
const INSIGHTS_PRICE_TTL_MS = 6 * 60 * 60 * 1000
let insightsPriceCache = { expiresAt: 0, value: null }

function insightsNumber(value) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function insightsDayKey(time) {
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function insightsCostUsageAdd(target, source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return
  for (const provider of Object.keys(source)) {
    const models = source[provider]
    if (models === null || typeof models !== 'object' || Array.isArray(models)) continue
    const targetModels = target[provider] || (target[provider] = Object.create(null))
    for (const model of Object.keys(models)) {
      const periods = models[model]
      if (periods === null || typeof periods !== 'object' || Array.isArray(periods)) continue
      const targetPeriods = targetModels[model] || (targetModels[model] = Object.create(null))
      for (const period of ['peak', 'off']) {
        const bucket = periods[period]
        if (bucket === null || typeof bucket !== 'object') continue
        const sum = targetPeriods[period] || (targetPeriods[period] = { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
        sum.uncached += insightsNumber(bucket.uncached)
        sum.cacheRead += insightsNumber(bucket.cacheRead)
        sum.cacheWrite += insightsNumber(bucket.cacheWrite)
        sum.output += insightsNumber(bucket.output)
      }
    }
  }
}

async function insightsPricesOf() {
  const now = Date.now()
  if (insightsPriceCache.expiresAt > now) return insightsPriceCache.value
  try {
    if (typeof fetch !== 'function') return null
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null
    let response
    let body
    try {
      response = await fetch(INSIGHTS_PRICE_URL, controller ? { signal: controller.signal } : undefined)
      if (!response || !response.ok) throw new Error('price book unavailable')
      body = await response.json()
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid price book')
    insightsPriceCache = { expiresAt: now + INSIGHTS_PRICE_TTL_MS, value: body }
    return body
  } catch (_) {
    // Retry sooner after an outage, while keeping the page useful without prices.
    insightsPriceCache = { expiresAt: now + 60_000, value: null }
    return null
  }
}

function insightsRateOf(book, provider, model) {
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  const leaf = String(model || '').slice(String(model || '').lastIndexOf('/') + 1).toLowerCase()
  const providerKey = String(provider || '').toLowerCase()
  if (book === null || typeof book !== 'object' || !leaf) return null
  const providerIds = Object.keys(book)
  const preferred = providerIds.find(id => id.toLowerCase() === providerKey)
    || (providerKey.includes('deepseek') ? providerIds.find(id => id.toLowerCase() === 'deepseek') : null)
  const candidates = []
  for (const id of providerIds) {
    const models = book[id] && book[id].models
    if (models === null || typeof models !== 'object') continue
    for (const key of Object.keys(models)) {
      const candidate = models[key]
      const cost = candidate && candidate.cost
      const candidateId = key.toLowerCase()
      if (candidateId !== leaf && !candidateId.endsWith('-' + leaf)) continue
      if (cost === null || typeof cost !== 'object') continue
      const input = number(cost.input)
      const output = number(cost.output)
      if (input === null || output === null) continue
      const rate = { input, output, cacheRead: number(cost.cache_read) ?? input, cacheWrite: number(cost.cache_write) ?? input }
      candidates.push({ id, key, rate, preferred: id === preferred })
    }
  }
  const exact = candidates.filter(item => item.key.toLowerCase() === leaf)
  const pool = exact.length ? exact : candidates
  const named = pool.filter(item => item.preferred)
  const selected = named.length ? named : pool.length === 1 ? pool : []
  if (selected.length !== 1) return null
  return selected[0].rate
}

function insightsEstimateCost(usage, book) {
  if (book === null || usage === null || typeof usage !== 'object') return null
  let total = 0
  let priced = false
  for (const provider of Object.keys(usage)) {
    const models = usage[provider]
    if (models === null || typeof models !== 'object') continue
    const deepseek = provider.toLowerCase().includes('deepseek')
    for (const model of Object.keys(models)) {
      const rate = insightsRateOf(book, provider, model)
      if (rate === null) continue
      const periods = models[model]
      if (periods === null || typeof periods !== 'object') continue
      for (const period of ['peak', 'off']) {
        const bucket = periods[period]
        if (bucket === null || typeof bucket !== 'object') continue
        const cost = (insightsNumber(bucket.uncached) * rate.input
          + insightsNumber(bucket.cacheRead) * rate.cacheRead
          + insightsNumber(bucket.cacheWrite) * rate.cacheWrite
          + insightsNumber(bucket.output) * rate.output) / 1_000_000
        total += deepseek && period === 'peak' ? cost * 2 : cost
        priced = true
      }
    }
  }
  return priced ? total : null
}

/** Estimated USD cost of one provider usage bucket at the models.dev rate. */
function insightsUsageCost(book, provider, model, usage) {
  if (!insightsRecord(usage)) return null
  const rate = insightsRateOf(book, provider, model)
  if (rate === null) return null
  const uncached = insightsNumber(usage.uncachedInputTokens)
  const cacheRead = insightsNumber(usage.cacheReadTokens)
  const cacheWrite = insightsNumber(usage.cacheWriteTokens)
  const output = insightsNumber(usage.outputTokens)
  if (uncached + cacheRead + cacheWrite + output <= 0) return null
  return (uncached * rate.input + cacheRead * rate.cacheRead + cacheWrite * rate.cacheWrite + output * rate.output) / 1_000_000
}

/**
 * Estimated USD cost of one request ledger row: prompt carries the billed input
 * (uncached + cache read + cache write), so the cache-write remainder is derived.
 */
function insightsRequestCost(book, provider, model, request) {
  if (!insightsRecord(request)) return null
  const rate = insightsRateOf(book, provider, model)
  if (rate === null) return null
  const prompt = insightsNumber(request.prompt)
  const cacheRead = insightsNumber(request.cacheRead)
  const uncached = insightsNumber(request.uncachedInput)
  const output = insightsNumber(request.output)
  const cacheWrite = Math.max(0, prompt - cacheRead - uncached)
  if (prompt + output <= 0) return null
  return (uncached * rate.input + cacheRead * rate.cacheRead + cacheWrite * rate.cacheWrite + output * rate.output) / 1_000_000
}

function insightsRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function insightsTitleOf(session, header, values) {
  const titleProjection = values && values.title
  const nestedTitle = titleProjection && typeof titleProjection === 'object' ? titleProjection.title : ''
  const sessionTitle = values && values.sessionTitle && typeof values.sessionTitle === 'object'
    ? values.sessionTitle.title : ''
  const subagent = values && values.subagent && typeof values.subagent === 'object' ? values.subagent : {}
  const candidates = [
    session && session.displayTitle,
    sessionTitle,
    typeof titleProjection === 'string' ? titleProjection : nestedTitle,
    session && session.title,
    header && header.title,
    subagent.label,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim().slice(0, 120)
  }
  return ''
}

function insightsNeedsObservation(values, session, header) {
  const timeline = values.contextTimeline
  const nativeHead = insightsRecord(timeline) && insightsRecord(timeline.current)
    && Object.keys(timeline.current).length > 0 && insightsRecord(timeline.timing)
  const mobile = insightsRecord(values.mobileContext) ? values.mobileContext : null
  const legacyHead = mobile !== null && insightsRecord(mobile.current)
    && Object.keys(mobile.current).length > 0 && insightsRecord(mobile.timing)
    && Object.keys(mobile.timing).length > 0
  const hasUsage = insightsRecord(values.tokenUsage) && Object.keys(values.tokenUsage).length > 0
  const hasTitle = insightsTitleOf(session, header, values) !== ''
  // A mobileContext-only host (older DSH) already carries the head; observing
  // every session again would refold up to 120 logs on each page refresh. The
  // native head still needs the activity projection and a real title backfilled.
  if (legacyHead && hasUsage && hasTitle) return false
  if (nativeHead && insightsRecord(values.contextActivity) && hasUsage && hasTitle) return false
  return true
}

/** The activity ledger a session's projections carry (native head first, the mobile fold as fallback). */
function insightsActivityOf(values) {
  if (!insightsRecord(values)) return null
  if (insightsRecord(values.contextActivity)) return values.contextActivity
  return insightsRecord(values.mobileContext) && insightsRecord(values.mobileContext.activity)
    ? values.mobileContext.activity : null
}

/** Sum one session's provider token buckets into an accumulating family usage. */
function insightsUsageAdd(target, usage) {
  if (!insightsRecord(usage)) return
  target.uncachedInputTokens += insightsNumber(usage.uncachedInputTokens)
  target.cacheReadTokens += insightsNumber(usage.cacheReadTokens)
  target.cacheWriteTokens += insightsNumber(usage.cacheWriteTokens)
  target.outputTokens += insightsNumber(usage.outputTokens)
}

/** Name-by-name skill tally merge: loads sum, the newest load wins (dsh-context mergeSkillTallies). */
function insightsMergeSkillTallies(target, skills) {
  if (!insightsRecord(skills)) return
  for (const name of Object.keys(skills)) {
    if (name === '' || !insightsRecord(skills[name])) continue
    const tally = skills[name]
    const prev = target[name]
    const n = insightsNumber(tally.n)
    const last = insightsNumber(tally.last)
    target[name] = prev === undefined ? { n, last } : { n: prev.n + n, last: Math.max(prev.last, last) }
  }
}

/**
 * Fold one activity object's day entries into an accumulating day map
 * (dsh-context mergeActivity): counters and timing totals sum, absent stays
 * absent on both sides, cost ledgers merge provider/model/period-wise, and skill
 * tallies merge by name.
 */
function insightsMergeActivityDays(target, activity) {
  if (!insightsRecord(activity) || !insightsRecord(activity.days)) return
  const days = activity.days
  for (const day of Object.keys(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    const entry = insightsRecord(days[day]) ? days[day] : null
    if (entry === null) continue
    const merged = target[day] === undefined ? { tokens: 0, requests: 0 } : target[day]
    merged.tokens += insightsNumber(entry.tokens)
    merged.requests += insightsNumber(entry.requests)
    for (const field of ['turns', 'toolCalls', 'toolsMs', 'wallMs']) {
      if (merged[field] === undefined && entry[field] === undefined) continue
      merged[field] = insightsNumber(merged[field]) + insightsNumber(entry[field])
    }
    if (insightsRecord(entry.cost)) {
      if (!insightsRecord(merged.cost)) merged.cost = Object.create(null)
      insightsCostUsageAdd(merged.cost, entry.cost)
    }
    if (insightsRecord(entry.skills)) {
      if (!insightsRecord(merged.skills)) merged.skills = Object.create(null)
      insightsMergeSkillTallies(merged.skills, entry.skills)
    }
    target[day] = merged
  }
}

/**
 * Fold a mobileContext event list's skill loads into the day ledger. The fold
 * records a skill tool's harness injection as `{kind:'inject', sub:'skill',
 * name}`; that event survives the 120-event window, so a host without the
 * native contextActivity projection can still populate the skills card.
 */
function insightsMergeSkillEvents(target, context) {
  if (!insightsRecord(context) || !Array.isArray(context.events)) return
  for (const event of context.events) {
    if (!insightsRecord(event) || event.kind !== 'inject' || event.sub !== 'skill') continue
    const name = typeof event.name === 'string' ? event.name.trim() : ''
    if (name === '') continue
    const day = insightsDayKey(insightsNumber(event.time))
    if (day === '') continue
    const entry = target[day] || (target[day] = { tokens: 0, requests: 0 })
    const skills = insightsRecord(entry.skills) ? entry.skills : (entry.skills = Object.create(null))
    const tally = insightsRecord(skills[name]) ? skills[name] : (skills[name] = { n: 0, last: 0 })
    tally.n += 1
    tally.last = Math.max(insightsNumber(tally.last), insightsNumber(event.time))
  }
}

function insightsHasSkillTallies(activity) {
  if (!insightsRecord(activity) || !insightsRecord(activity.days)) return false
  return Object.values(activity.days).some(day => insightsRecord(day)
    && insightsRecord(day.skills) && Object.keys(day.skills).length > 0)
}

function insightsStringOf() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = arguments[index]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

/**
 * Host session rows changed shape across DSH generations: some carry the edge
 * in `header`, current DSH puts it on the row, and a third variant nests it in
 * `metadata`. Resolve all three so the family tree and the list agree.
 */
function insightsIdentityOf(session, header) {
  const meta = insightsRecord(session.metadata) ? session.metadata : {}
  const id = insightsStringOf(session.id, session.sessionId, header.id, header.sessionId,
    meta.id, meta.sessionId)
  const parentSessionId = insightsStringOf(
    session.parentSessionId, session.parentSession, session.parent,
    header.parentSessionId, header.parentSession, header.parent,
    meta.parentSessionId, meta.parentSession, meta.parent,
  )
  const originValue = session.origin !== undefined ? session.origin
    : (header.origin !== undefined ? header.origin : meta.origin)
  const originText = typeof originValue === 'string'
    ? originValue
    : (insightsRecord(originValue) ? insightsStringOf(originValue.kind, originValue.type) : '')
  const isSubagent = originText === 'subagent' || originText === 'sub-agent'
    || session.isSubagent === true || header.isSubagent === true
    || (parentSessionId !== '' && originText === '')
  return { id, parentSessionId, isSubagent, createdAt: insightsNumber(header.createdAt) || insightsNumber(session.createdAt) || insightsNumber(session.updatedAt) }
}

async function insightsSkillCatalogOf(sessionId, sessions, projections) {
  if (!hostSkills || typeof hostSkills.list !== 'function') return []
  const session = sessions.find((item) => {
    if (item === null || typeof item !== 'object') return false
    const header = item.header !== null && typeof item.header === 'object' ? item.header : {}
    return insightsIdentityOf(item, header).id === sessionId
  })
  const header = session && session.header && typeof session.header === 'object' ? session.header : {}
  let cwd = typeof header.cwd === 'string' ? header.cwd : undefined
  let preset
  try {
    const snapshot = session ? projections.snapshot(session) : null
    const values = snapshot && snapshot.values && typeof snapshot.values === 'object' ? snapshot.values : {}
    const context = values.mobileContext && typeof values.mobileContext === 'object' ? values.mobileContext : {}
    const presetValue = values.agentPreset
    if (typeof presetValue === 'string' && presetValue) preset = presetValue
    if (typeof context.cwd === 'string' && context.cwd) cwd = context.cwd
  } catch (_) { /* no catalog scope */ }
  let lease
  let scope
  try {
    let registry = hostSkills
    let liveAgent
    try {
      liveAgent = hostAgents && typeof hostAgents.get === 'function' ? hostAgents.get(sessionId) : null
    } catch (_) { liveAgent = null }
    if (liveAgent && hostAgentPresets && typeof hostAgentPresets.serviceFor === 'function') {
      const scoped = hostAgentPresets.serviceFor(liveAgent, 'skills')
      if (scoped && typeof scoped.list === 'function') {
        registry = scoped
        scope = liveAgent
      }
    }
    if (scope === undefined && hostAgentPresets && typeof hostAgentPresets.acquireScope === 'function') {
      lease = await hostAgentPresets.acquireScope(preset)
      scope = lease && lease.key
    }
    const listed = await registry.list({ ...(cwd ? { cwd } : {}), ...(scope !== undefined ? { scope } : {}) })
    return (Array.isArray(listed) ? listed : []).slice(0, 200).flatMap(item => {
      if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name) return []
      return [{
        name: item.name.slice(0, 120),
        description: typeof item.description === 'string' ? item.description.slice(0, 500) : '',
        ...(typeof item.path === 'string' && item.path ? { path: item.path.slice(0, 500) } : {}),
        ...(typeof item.source === 'string' && item.source ? { source: item.source.slice(0, 80) } : {}),
      }]
    })
  } catch (_) {
    return []
  } finally {
    try {
      const dispose = lease && (lease[Symbol.asyncDispose] || lease[Symbol.dispose])
      if (typeof dispose === 'function') await dispose.call(lease)
    } catch (_) { /* best-effort lease cleanup */ }
  }
}

/**
 * Pure aggregate for the Insights page. `records` are per-session projections
 * ({ id, title, model, provider, usage, stats, counts, pressure, current, timing, requests }).
 */
export function buildInsightsValue(records, now, options) {
  const opts = options || {}
  const maxDays = Number.isFinite(Number(opts.days)) ? Math.max(1, Math.floor(Number(opts.days))) : INSIGHTS_DAYS
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now()
  const list = Array.isArray(records) ? records.slice(0, INSIGHTS_MAX_SESSIONS) : []
  const sessions = []
  const skillDays = Object.create(null)
  const priceBook = opts.priceBook && typeof opts.priceBook === 'object' ? opts.priceBook : null
  const totals = { sessions: 0, billedTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, turns: 0, steps: 0, toolCalls: 0, activeMs: 0 }
  for (const record of list) {
    if (record === null || typeof record !== 'object') continue
    const id = typeof record.id === 'string' ? record.id : ''
    if (id === '') continue
    const usage = record.usage !== null && typeof record.usage === 'object' ? record.usage : {}
    const stats = record.stats !== null && typeof record.stats === 'object' ? record.stats : {}
    const counts = record.counts !== null && typeof record.counts === 'object' ? record.counts : {}
    const pressure = record.pressure !== null && typeof record.pressure === 'object' ? record.pressure : {}
    const current = record.current !== null && typeof record.current === 'object' ? record.current : {}
    const timing = record.timing !== null && typeof record.timing === 'object' ? record.timing : {}
    const activity = record.activity !== null && typeof record.activity === 'object' ? record.activity : {}
    const activityByDay = activity.days !== null && typeof activity.days === 'object' ? activity.days : {}
    const input = insightsNumber(usage.uncachedInputTokens) + insightsNumber(usage.cacheReadTokens) + insightsNumber(usage.cacheWriteTokens)
    const output = insightsNumber(usage.outputTokens)
    const billed = input + output
    const activeMs = insightsNumber(stats.llmMs) + insightsNumber(stats.toolMs)
    const requests = Array.isArray(record.requests) ? record.requests : []
    let lastActive = insightsNumber(record.lastActive) || insightsNumber(record.createdAt)
    const sessionDays = Object.create(null)
    const sessionSkillLoads = Object.create(null)
    const sessionCostUsage = Object.create(null)
    for (const request of requests) {
      if (request === null || typeof request !== 'object') continue
      const time = insightsNumber(request.time)
      if (time > lastActive) lastActive = time
      const day = insightsDayKey(time)
      if (day === '') continue
      const tokens = insightsNumber(request.total)
      const daily = sessionDays[day] || (sessionDays[day] = { tokens: 0, requests: 0 })
      daily.tokens += tokens
      daily.requests += 1
      daily.inputTokens = (daily.inputTokens || 0) + insightsNumber(request.prompt)
      daily.outputTokens = (daily.outputTokens || 0) + insightsNumber(request.output)
      daily.cacheReadTokens = (daily.cacheReadTokens || 0) + insightsNumber(request.cacheRead)
      // Hosts without the billing ledger still expose request rows: price them
      // from the models.dev book so the 7-day cost bars are not empty.
      const requestCost = insightsRequestCost(priceBook, record.provider, record.model, request)
      if (requestCost !== null) daily.costUsd = (daily.costUsd || 0) + requestCost
    }
    const activityKeys = Object.keys(activityByDay).sort()
    for (const day of activityKeys) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const entry = activityByDay[day] !== null && typeof activityByDay[day] === 'object' ? activityByDay[day] : {}
      const costUsage = entry.cost !== null && typeof entry.cost === 'object' ? entry.cost : null
      insightsCostUsageAdd(sessionCostUsage, costUsage)
      const isRecentDay = activityKeys.indexOf(day) >= Math.max(0, activityKeys.length - maxDays)
      let daily
      if (isRecentDay) {
        daily = sessionDays[day] || (sessionDays[day] = {})
        // A day may carry only skill events (tokens/requests/counters absent);
        // never let that wipe the request ledger's figures for the same day.
        if (insightsNumber(entry.tokens) > 0 || daily.tokens === undefined) daily.tokens = insightsNumber(entry.tokens)
        if (insightsNumber(entry.requests) > 0 || daily.requests === undefined) daily.requests = insightsNumber(entry.requests)
        for (const field of ['turns', 'toolCalls', 'toolsMs', 'wallMs']) {
          if (entry[field] !== undefined) daily[field] = insightsNumber(entry[field])
        }
        if (costUsage !== null) {
          const ledgerCost = insightsEstimateCost(costUsage, priceBook)
          if (ledgerCost !== null) daily.costUsd = ledgerCost
          let inputTokens = 0
          let cacheReadTokens = 0
          let cacheWriteTokens = 0
          let outputTokens = 0
          for (const provider of Object.keys(costUsage)) {
            const models = costUsage[provider]
            if (models === null || typeof models !== 'object') continue
            for (const model of Object.keys(models)) {
              const periods = models[model]
              if (periods === null || typeof periods !== 'object') continue
              for (const period of ['peak', 'off']) {
                const bucket = periods[period]
                if (bucket === null || typeof bucket !== 'object') continue
                inputTokens += insightsNumber(bucket.uncached)
                cacheReadTokens += insightsNumber(bucket.cacheRead)
                cacheWriteTokens += insightsNumber(bucket.cacheWrite)
                outputTokens += insightsNumber(bucket.output)
              }
            }
          }
          daily.inputTokens = inputTokens + cacheReadTokens + cacheWriteTokens
          daily.cacheReadTokens = cacheReadTokens
          daily.cacheWriteTokens = cacheWriteTokens
          daily.outputTokens = outputTokens
        }
      }
      const skills = entry.skills !== null && typeof entry.skills === 'object' ? entry.skills : {}
      const names = Object.keys(skills).filter((name) => name !== '').sort((a, b) => insightsNumber(skills[b] && skills[b].n) - insightsNumber(skills[a] && skills[a].n)).slice(0, 20)
      for (const name of names) {
        const skill = skills[name] !== null && typeof skills[name] === 'object' ? skills[name] : {}
        sessionSkillLoads[name] = (sessionSkillLoads[name] || 0) + insightsNumber(skill.n)
        if (daily) {
          const dailySkills = daily.skills || (daily.skills = Object.create(null))
          dailySkills[name] = { loads: insightsNumber(skill.n), last: insightsNumber(skill.last) }
        }
        const byName = skillDays[day] || (skillDays[day] = Object.create(null))
        const total = byName[name] || (byName[name] = { loads: 0, sessions: 0, last: 0 })
        total.loads += insightsNumber(skill.n)
        total.sessions += 1
        total.last = Math.max(total.last, insightsNumber(skill.last))
      }
    }
    const composition = {
      system: insightsNumber(current.system),
      tools: insightsNumber(current.tools),
      user: insightsNumber(current.user),
      inject: insightsNumber(current.inject),
      skill: insightsNumber(current.skill),
      assistant: insightsNumber(current.assistant),
      tool: insightsNumber(current.tool),
      output: output,
    }
    const lifetimeCost = record.cost !== null && typeof record.cost === 'object' && !Array.isArray(record.cost)
      && Object.keys(record.cost).length > 0 ? record.cost : sessionCostUsage
    // Card cost: the billing ledger first, then the provider usage at the book's
    // rate (a host without cost projections still gets an estimate, or a dash).
    let costUsd = insightsEstimateCost(lifetimeCost, priceBook)
    if (costUsd === null) costUsd = insightsUsageCost(priceBook, record.provider, record.model, usage)
    sessions.push({
      id,
      title: typeof record.title === 'string' && record.title !== '' ? record.title.slice(0, 120) : id,
      model: typeof record.model === 'string' ? record.model.slice(0, 80) : '',
      provider: typeof record.provider === 'string' ? record.provider.slice(0, 80) : '',
      lastActive,
      createdAt: insightsNumber(record.createdAt),
      billedTokens: billed,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: insightsNumber(usage.cacheReadTokens),
      cacheWriteTokens: insightsNumber(usage.cacheWriteTokens),
      turns: insightsNumber(stats.turns),
      steps: insightsNumber(stats.steps),
      toolCalls: insightsNumber(counts.toolCalls),
      activeMs,
      toolMs: insightsNumber(stats.toolMs),
      llmMs: insightsNumber(stats.llmMs),
      timing: {
        wallMs: insightsNumber(timing.wallMs),
        ttftMs: insightsNumber(timing.ttftMs),
        reasoningMs: insightsNumber(timing.reasoningMs),
        textMs: insightsNumber(timing.textMs),
        toolArgMs: insightsNumber(timing.toolArgMs),
        toolsMs: insightsNumber(timing.toolsMs),
        otherMs: insightsNumber(timing.otherMs),
        waitCount: insightsNumber(timing.waitCount),
        reasoningCount: insightsNumber(timing.reasoningCount),
        textCount: insightsNumber(timing.textCount),
        toolArgCount: insightsNumber(timing.toolArgCount),
        toolCount: insightsNumber(timing.toolCount),
        speedTokens: insightsNumber(timing.speedTokens),
        speedMs: insightsNumber(timing.speedMs),
      },
      contextWindow: insightsNumber(pressure.contextWindow),
      pressureTokens: insightsNumber(pressure.pressureTokens),
      ...(typeof record.contextTokens === 'number' && Number.isFinite(record.contextTokens) && record.contextTokens >= 0
        ? { contextTokens: record.contextTokens } : {}),
      cwd: typeof record.cwd === 'string' ? record.cwd.slice(0, 500) : '',
      lastUser: typeof record.lastUser === 'string' ? record.lastUser.slice(0, 200) : '',
      costUsd,
      skillNames: Object.keys(sessionSkillLoads).sort((a, b) => sessionSkillLoads[b] - sessionSkillLoads[a]).slice(0, 20),
      days: sessionDays,
      composition,
    })
    totals.sessions += 1
    totals.billedTokens += billed
    totals.inputTokens += input
    totals.outputTokens += output
    totals.cacheReadTokens += insightsNumber(usage.cacheReadTokens)
    totals.turns += insightsNumber(stats.turns)
    totals.steps += insightsNumber(stats.steps)
    totals.toolCalls += insightsNumber(counts.toolCalls)
    totals.activeMs += activeMs
  }
  sessions.sort((left, right) => (right.lastActive - left.lastActive) || String(right.id).localeCompare(String(left.id)))
  const dailyTokens = Object.create(null)
  for (const session of sessions) {
    for (const [day, entry] of Object.entries(session.days)) dailyTokens[day] = (dailyTokens[day] || 0) + insightsNumber(entry.tokens)
  }
  // Daily buckets for the last N local days (7-day chart + 8-week heatmap share them).
  const days = []
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)
  for (let offset = maxDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(start)
    date.setDate(date.getDate() - offset)
    const key = insightsDayKey(date.getTime())
    days.push({ day: key, tokens: dailyTokens[key] || 0 })
  }
  const composition = { system: 0, tools: 0, user: 0, inject: 0, skill: 0, assistant: 0, tool: 0, output: 0 }
  for (const session of sessions) {
    for (const key of Object.keys(composition)) composition[key] += session.composition[key]
  }
  return {
    v: 1,
    asOf: nowMs,
    sessions,
    days,
    skillDays: Object.keys(skillDays).sort().slice(-maxDays).map((day) => ({
      day,
      skills: Object.keys(skillDays[day]).sort((a, b) => skillDays[day][b].loads - skillDays[day][a].loads).slice(0, 24).map((name) => ({ name, lastDay: day, ...skillDays[day][name] }))
    })),
    sessionsTruncated: opts.sessionsTruncated === true,
    totals,
    composition,
    cacheHit: totals.inputTokens > 0 ? totals.cacheReadTokens / totals.inputTokens : null,
  }
}

/**
 * Serve one `context-insights` request: aggregate the host's recent sessions into
 * the Insights page wire value. Bounded to INSIGHTS_MAX_SESSIONS snapshots.
 */
export async function handleContextInsights(msg) {
  const requestType = msg && msg.type
  const sessionId = msg && typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
  if (sessionId === null) {
    return { kind: 'error', code: 'bad-request', requestType, message: 'context-insights requires a sessionId' }
  }
  if (hostSessions === null || hostProjections === null || typeof hostSessions.list !== 'function'
    || typeof hostProjections.snapshot !== 'function') {
    return unavailable(requestType, sessionId, 'Session services are unavailable on this host')
  }
  try {
    const listedSessions = hostSessions.list()
    const sessions = Array.isArray(listedSessions) ? listedSessions : []
    // Family edges are subagent-origin rows only: a fork seed carries a parent
    // but its origin is `fork`, so it roots its own family (rowsOfSnapshot
    // familyParentOf). Session-row shapes differ across DSH generations; the
    // identity helper reads header / top-level / metadata alike.
    const catalog = new Map()
    for (const session of sessions) {
      if (session === null || typeof session !== 'object') continue
      const header = session.header !== null && typeof session.header === 'object' ? session.header : {}
      const identity = insightsIdentityOf(session, header)
      if (identity.id === '' || catalog.has(identity.id)) continue
      catalog.set(identity.id, {
        id: identity.id,
        session,
        header,
        createdAt: identity.createdAt,
        origin: identity.isSubagent ? 'subagent' : '',
        parentSessionId: identity.parentSessionId,
      })
    }
    const childrenOf = new Map()
    for (const entry of catalog.values()) {
      if (entry.origin !== 'subagent' || entry.parentSessionId === '') continue
      const children = childrenOf.get(entry.parentSessionId)
      if (children === undefined) childrenOf.set(entry.parentSessionId, [entry.id])
      else children.push(entry.id)
    }
    const listed = []
    const listedIds = new Set()
    for (const entry of catalog.values()) {
      if (entry.origin !== 'subagent') {
        listed.push(entry)
        listedIds.add(entry.id)
      }
    }
    const valuesById = new Map()
    const valuesOf = async (id) => {
      if (valuesById.has(id)) return valuesById.get(id)
      const entry = catalog.get(id)
      if (entry === undefined) return null
      let values = null
      try {
        const snapshot = hostProjections.snapshot(entry.session)
        values = snapshot !== null && typeof snapshot === 'object' && snapshot.values !== null && typeof snapshot.values === 'object'
          ? snapshot.values : null
      } catch (_) {
        values = null
      }
      // A listed session can lack a warm projection snapshot. Keep its row and
      // ask the same cold-observation surface the DSH client uses for its heads.
      if (values === null) values = {}
      // Some gateway session-list snapshots predate the native DSH heads or omit cold projections. Read the same
      // projection surface the DSH client observes before degrading token, timing, activity, or skill cards.
      // Only listed rows pay for a cold observation; a subagent's head and
      // ledger are read from its warm snapshot when the host has it.
      if (listedIds.has(id) && insightsNeedsObservation(values, entry.session, entry.header)
        && hostSessionQuery && typeof hostSessionQuery.observeSession === 'function') {
        let observation = null
        try {
          observation = await hostSessionQuery.observeSession(id)
          const observed = observation && observation.projections && typeof observation.projections === 'object'
            ? observation.projections.values : null
          if (insightsRecord(observed)) values = { ...values, ...observed }
        } catch (_) { /* keep the warm snapshot when no cold projection head is available */ }
        finally {
          const dispose = observation && observation[Symbol.dispose]
          if (typeof dispose === 'function') {
            try { dispose.call(observation) } catch (_) { /* observation cleanup is best effort */ }
          }
        }
      }
      valuesById.set(id, values)
      return values
    }
    const records = []
    let sessionsTruncated = false
    for (let index = 0; index < listed.length; index += 1) {
      if (records.length >= INSIGHTS_MAX_SESSIONS) {
        sessionsTruncated = true
        break
      }
      const entry = listed[index]
      const id = entry.id
      const session = entry.session
      const header = entry.header
      const values = await valuesOf(id)
      if (values === null) continue
      const usage = values.tokenUsage !== null && typeof values.tokenUsage === 'object' ? values.tokenUsage : {}
      const stats = values.sessionStats !== null && typeof values.sessionStats === 'object' ? values.sessionStats : {}
      const pressure = values.contextPressure !== null && typeof values.contextPressure === 'object' ? values.contextPressure : {}
      const context = values.mobileContext !== null && typeof values.mobileContext === 'object' ? values.mobileContext : {}
      const timeline = values.contextTimeline !== null && typeof values.contextTimeline === 'object' ? values.contextTimeline : {}
      const activity = values.contextActivity !== null && typeof values.contextActivity === 'object' ? values.contextActivity : context.activity || {}
      const timelineCounts = timeline.counts !== null && typeof timeline.counts === 'object' ? timeline.counts : {}
      const timelineTiming = timeline.timing !== null && typeof timeline.timing === 'object' ? timeline.timing : null
      const contextTiming = context.timing !== null && typeof context.timing === 'object' ? context.timing : {}
      const timing = timelineTiming ? {
        wallMs: insightsNumber(timelineTiming.wallMs),
        ttftMs: insightsNumber(timelineTiming.ttftMs),
        reasoningMs: insightsNumber(timelineTiming.reasoningMs),
        textMs: insightsNumber(timelineTiming.textMs !== undefined
          ? timelineTiming.textMs
          : (timelineTiming.reasoningMs === undefined && timelineTiming.toolArgMs === undefined ? timelineTiming.genMs : 0)),
        toolArgMs: insightsNumber(timelineTiming.toolArgMs),
        toolsMs: insightsNumber(timelineTiming.toolsMs),
        generationMs: insightsNumber(timelineTiming.genMs),
        otherMs: Math.max(0, insightsNumber(timelineTiming.wallMs) - insightsNumber(timelineTiming.ttftMs)
          - insightsNumber(timelineTiming.genMs) - insightsNumber(timelineTiming.toolsMs)),
        waitCount: insightsNumber(timelineTiming.calls),
        reasoningCount: insightsNumber(timelineTiming.reasoningBlocks),
        textCount: insightsNumber(timelineTiming.textBlocks),
        toolArgCount: insightsNumber(timelineTiming.toolArgBlocks),
        toolCount: insightsNumber(timelineTiming.toolCalls),
        speedTokens: insightsNumber(timelineTiming.speedTokens),
        speedMs: insightsNumber(timelineTiming.speedMs),
      } : contextTiming
      const nativeCurrent = timeline.current !== null && typeof timeline.current === 'object' ? timeline.current : null
      const mobileCurrent = context.current !== null && typeof context.current === 'object' ? context.current : {}
      const current = nativeCurrent || mobileCurrent
      const nativeCost = timeline.cost !== null && typeof timeline.cost === 'object' ? timeline.cost : undefined
      const stepCount = Number.isFinite(timelineCounts.steps) ? timelineCounts.steps : insightsNumber(stats.steps)
      const turnCount = Number.isFinite(timelineCounts.turns) ? timelineCounts.turns : insightsNumber(stats.turns)
      const toolCount = Number.isFinite(timeline.toolCalls) ? timeline.toolCalls
        : Number.isFinite(context.counts && context.counts.toolCalls) ? context.counts.toolCalls : 0
      const wallMs = insightsNumber(timing.wallMs) || insightsNumber(stats.llmMs) + insightsNumber(stats.toolMs)
      const toolsMs = insightsNumber(timing.toolsMs) || insightsNumber(stats.toolMs)
      const sessionStats = {
        ...stats,
        turns: turnCount,
        steps: stepCount,
        llmMs: insightsNumber(stats.llmMs) || Math.max(0, wallMs - toolsMs),
        toolMs: insightsNumber(stats.toolMs) || toolsMs,
      }
      const title = insightsTitleOf(session, header, values)
      // The listed row carries its whole subagent subtree's usage and activity
      // ledger (rowsOfSnapshot family merge); the row's own stats, timing,
      // current context, pressure and lastActive stay the session's own.
      const familyUsage = {
        uncachedInputTokens: insightsNumber(usage.uncachedInputTokens),
        cacheReadTokens: insightsNumber(usage.cacheReadTokens),
        cacheWriteTokens: insightsNumber(usage.cacheWriteTokens),
        outputTokens: insightsNumber(usage.outputTokens),
      }
      const familyDays = Object.create(null)
      insightsMergeActivityDays(familyDays, activity)
      // mobileContext-only hosts have no contextActivity projection: recover the
      // skill card's inputs from the fold's inject events, and price the day from
      // the request ledger below when no billing ledger exists.
      // When both projections exist they record the same invocation, so use the
      // native ledger for that session rather than counting its bounded events twice.
      if (!insightsHasSkillTallies(activity)) insightsMergeSkillEvents(familyDays, context)
      const familyCost = Object.create(null)
      if (insightsRecord(nativeCost)) insightsCostUsageAdd(familyCost, nativeCost)
      const familyQueue = [id]
      const familySeen = new Set(familyQueue)
      for (let cursor = 0; cursor < familyQueue.length; cursor += 1) {
        for (const childId of childrenOf.get(familyQueue[cursor]) || []) {
          if (familySeen.has(childId)) continue
          familySeen.add(childId)
          familyQueue.push(childId)
          const childValues = await valuesOf(childId)
          if (childValues === null) continue
          insightsUsageAdd(familyUsage, childValues.tokenUsage)
          const childActivity = insightsActivityOf(childValues)
          insightsMergeActivityDays(familyDays, childActivity)
          if (!insightsHasSkillTallies(childActivity)) insightsMergeSkillEvents(familyDays, childValues.mobileContext)
          const childTimeline = insightsRecord(childValues.contextTimeline) ? childValues.contextTimeline : null
          if (childTimeline !== null && insightsRecord(childTimeline.cost)) {
            insightsCostUsageAdd(familyCost, childTimeline.cost)
          }
        }
      }
      let running = false
      try {
        const agent = hostAgents && typeof hostAgents.get === 'function' ? hostAgents.get(id) : null
        running = !!agent && agent.status === 'running'
      } catch (_) { /* status is optional */ }
      records.push({
        id,
        title,
        cwd: typeof header.cwd === 'string' ? header.cwd : '',
        running,
        model: typeof context.model === 'string' ? context.model : (typeof header.model === 'string' ? header.model : ''),
        provider: typeof context.provider === 'string' ? context.provider : '',
        createdAt: entry.createdAt || insightsNumber(header.createdAt) || insightsNumber(session.createdAt) || insightsNumber(session.updatedAt),
        usage: familyUsage,
        stats,
        counts: { ...(context.counts !== null && typeof context.counts === 'object' ? context.counts : {}), toolCalls: toolCount },
        pressure: {
          ...pressure,
          contextWindow: insightsNumber(pressure.contextWindow) || insightsNumber(timeline.contextWindow) || insightsNumber(context.contextWindow),
        },
        current,
        contextTokens: Number.isFinite(current.total) ? current.total : undefined,
        ...(Object.keys(familyCost).length > 0 ? { cost: familyCost } : {}),
        stats: sessionStats,
        timing,
        requests: Array.isArray(timeline.requests) && timeline.requests.length
          ? timeline.requests : Array.isArray(context.requests) ? context.requests : [],
        activity: { days: familyDays },
        lastActive: insightsNumber(session.updatedAt) || insightsNumber(header.updatedAt) || insightsNumber(context.lastActive),
        lastUser: typeof timeline.lastUser === 'string' ? timeline.lastUser : '',
      })
    }
    const [priceBook, skillCatalog] = await Promise.all([
      insightsPricesOf(),
      insightsSkillCatalogOf(sessionId, sessions, hostProjections),
    ])
    const value = buildInsightsValue(records, Date.now(), { sessionsTruncated, priceBook })
    value.skillCatalog = skillCatalog
    return { kind: 'context-insights', sessionId, value }
  } catch (_) {
    return unavailable(requestType, sessionId, 'Unable to aggregate session insights')
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
    const valuesById = new Map()
    for (const session of list) {
      if (session === null || typeof session !== 'object') continue
      const header = session.header !== null && typeof session.header === 'object' ? session.header : {}
      const identity = insightsIdentityOf(session, header)
      if (identity.id === '' || byId.has(identity.id)) continue
      byId.set(identity.id, session)
      const title = typeof session.title === 'string' && session.title !== ''
        ? session.title : (typeof header.title === 'string' ? header.title : '')
      records.push({
        id: identity.id,
        parentSessionId: identity.parentSessionId,
        origin: identity.isSubagent ? 'subagent' : '',
        createdAt: identity.createdAt,
        ...(title !== '' ? { title } : {}),
      })
    }

    const valuesOf = (id) => {
      if (valuesById.has(id)) return valuesById.get(id)
      const session = byId.get(id) || (hostSessions && typeof hostSessions.get === 'function' ? hostSessions.get(id) : null)
      let values = null
      if (session !== null && session !== undefined) {
        try {
          const snapshot = hostProjections.snapshot(session)
          if (snapshot !== null && typeof snapshot === 'object' && snapshot.values !== null && typeof snapshot.values === 'object') {
            values = snapshot.values
          }
        } catch (_) { /* cold query below */ }
      }
      if (values === null) values = {}
      byId.set(id, session || byId.get(id))
      valuesById.set(id, values)
      return values
    }

    const recordById = new Map(records.map((record) => [record.id, record]))
    const ensureRecord = async (id, parentId, catalogEntry) => {
      if (recordById.has(id)) return recordById.get(id)
      let session = null
      try {
        if (hostSessions && typeof hostSessions.get === 'function') session = hostSessions.get(id) || null
      } catch (_) { /* use catalog identity and cold observation */ }
      let header = session && session.header && typeof session.header === 'object' ? session.header : null
      if (header === null && hostSessionQuery && typeof hostSessionQuery.observeSession === 'function') {
        let observation = null
        try {
          observation = await hostSessionQuery.observeSession(id)
          header = observation && observation.header && typeof observation.header === 'object' ? observation.header : null
          const projections = observation && observation.projections && typeof observation.projections === 'object'
            ? observation.projections : null
          if (projections && projections.values && typeof projections.values === 'object') {
            valuesById.set(id, projections.values)
          }
        } catch (_) { /* keep the durable catalog identity */ }
        finally {
          const dispose = observation && observation[Symbol.dispose]
          if (typeof dispose === 'function') {
            try { dispose.call(observation) } catch (_) { /* observation cleanup is best effort */ }
          }
        }
      }
      const record = {
        id,
        parentSessionId: header && typeof header.parentSession === 'string' ? header.parentSession : parentId,
        origin: header ? (header.origin === 'subagent' ? 'subagent' : '') : (catalogEntry ? 'subagent' : ''),
        createdAt: fleetNumber(header && header.createdAt) || fleetNumber(catalogEntry && catalogEntry.createdAt),
        ...(typeof (catalogEntry && catalogEntry.label) === 'string' && catalogEntry.label !== ''
          ? { title: catalogEntry.label } : {}),
      }
      recordById.set(id, record)
      records.push(record)
      if (session) byId.set(id, session)
      return record
    }

    // The native DSH client refreshes subagent catalogs before rendering its
    // forest. Mirror that discovery so persisted/cold descendants are present
    // even when they are absent from the currently attached session list.
    let currentRecord = recordById.get(sessionId)
    if (!currentRecord) currentRecord = await ensureRecord(sessionId, '', null)
    let ancestor = currentRecord
    const ancestorsSeen = new Set()
    while (ancestor && ancestor.parentSessionId && ancestor.origin === 'subagent'
      && !ancestorsSeen.has(ancestor.parentSessionId) && records.length < MAX_FLEET_AGENTS * 4) {
      ancestorsSeen.add(ancestor.parentSessionId)
      ancestor = recordById.get(ancestor.parentSessionId)
      if (!ancestor) ancestor = await ensureRecord([...ancestorsSeen].at(-1), '', null)
    }
    const rootId = ancestor ? ancestor.id : sessionId
    const queue = [rootId]
    const catalogSeen = new Set()
    while (queue.length && catalogSeen.size < MAX_FLEET_AGENTS) {
      const parentId = queue.shift()
      if (!parentId || catalogSeen.has(parentId)) continue
      catalogSeen.add(parentId)
      let values = valuesOf(parentId)
      const hasDshHead = values.contextTimeline || values.contextPressure || values.tokenUsage || values.mobileContext
      if ((!Array.isArray(values.subagentCatalog) || !hasDshHead) && hostSessionQuery
        && typeof hostSessionQuery.observeSession === 'function') {
        let observation = null
        try {
          observation = await hostSessionQuery.observeSession(parentId)
          const projections = observation && observation.projections && typeof observation.projections === 'object'
            ? observation.projections : null
          if (projections && projections.values && typeof projections.values === 'object') {
            values = projections.values
            valuesById.set(parentId, values)
            const observedHeader = observation.header
            const existing = recordById.get(parentId)
            if (existing && observedHeader && typeof observedHeader === 'object') {
              existing.parentSessionId = typeof observedHeader.parentSession === 'string' ? observedHeader.parentSession : existing.parentSessionId
              existing.origin = observedHeader.origin === 'subagent' ? 'subagent' : existing.origin
              existing.createdAt = fleetNumber(observedHeader.createdAt) || existing.createdAt
            }
          }
        } catch (_) { /* catalogs are optional on older hosts */ }
        finally {
          const dispose = observation && observation[Symbol.dispose]
          if (typeof dispose === 'function') {
            try { dispose.call(observation) } catch (_) { /* observation cleanup is best effort */ }
          }
        }
      }
      const catalog = Array.isArray(values.subagentCatalog) ? values.subagentCatalog : []
      for (const child of catalog) {
        if (!child || typeof child !== 'object' || typeof child.id !== 'string' || child.id === '') continue
        await ensureRecord(child.id, parentId, child)
        queue.push(child.id)
      }
    }

    const value = buildFleetValue(sessionId, records, (id) => valuesOf(id), (id) => {
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

function boundedContextText(value, max, meta) {
  if (typeof value !== 'string') return ''
  if (value.length > max && meta) meta.truncated = true
  return value.slice(0, max)
}

function eventContentText(event, meta) {
  const data = event && event.data && typeof event.data === 'object' ? event.data : {}
  if (event.type === 'request/header') {
    const header = data.header && typeof data.header === 'object' ? data.header : {}
    const tools = Array.isArray(header.tools) ? header.tools.slice(0, 100) : []
    const lines = []
    const config = header.config && typeof header.config === 'object' ? header.config : {}
    if (typeof config.provider === 'string' || typeof config.model === 'string') {
      lines.push(`Provider: ${config.provider || '—'} · Model: ${config.model || '—'}`)
    }
    for (const tool of tools) {
      if (tool === null || typeof tool !== 'object') continue
      const name = typeof tool.name === 'string' ? tool.name : 'Tool'
      lines.push(`\n${name}${typeof tool.description === 'string' && tool.description !== '' ? `\n${tool.description}` : ''}`)
      if (tool.parameters !== undefined || tool.inputSchema !== undefined || tool.schema !== undefined) {
        let schema
        try { schema = JSON.stringify(tool.parameters ?? tool.inputSchema ?? tool.schema) } catch (_) { schema = '' }
        if (schema) lines.push(`\nSchema: ${boundedContextText(schema, 5000, meta)}`)
      }
    }
    return lines.join('\n')
  }
  if (event.type === 'request/context') {
    return [
      `Model: ${typeof data.model === 'string' ? data.model : '—'}`,
      `Provider: ${typeof data.provider === 'string' ? data.provider : '—'}`,
      `Context window: ${Number.isFinite(data.contextWindow) ? data.contextWindow : '—'}`,
    ].join('\n')
  }
  const message = event.type === 'user/message' ? data
    : data.message !== null && typeof data.message === 'object' ? data.message : null
  const blocks = message && Array.isArray(message.content) ? message.content : []
  const lines = []
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if ((block.type === 'text' || block.type === 'reasoning') && typeof block.text === 'string') {
      lines.push(block.text)
    } else if (block.type === 'tool-call') {
      const name = typeof block.name === 'string' ? block.name : 'tool'
      lines.push(`[${name}]${typeof block.arguments === 'string' && block.arguments !== '' ? `\n${boundedContextText(block.arguments, 8000, meta)}` : ''}`)
    } else if (block.type === 'image') {
      lines.push('[image attachment]')
    } else {
      let summary
      try { summary = JSON.stringify(block) } catch (_) { summary = '' }
      if (summary) lines.push(boundedContextText(summary, 1000, meta))
    }
  }
  return lines.join('\n\n')
}

/** Fetch one durable event body only when the user opens that row in the browser. */
export async function handleContextContent(api, msg) {
  const requestType = msg && msg.type
  const sessionId = msg && typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
  const seq = msg && Number.isSafeInteger(msg.seq) && msg.seq >= 0 ? msg.seq : null
  if (sessionId === null || seq === null) {
    return { kind: 'error', code: 'bad-request', requestType, ...(sessionId !== null ? { sessionId } : {}), message: 'context-content requires a sessionId and seq' }
  }
  if (!api || !api.sessions || typeof api.sessions.history !== 'function') {
    return unavailable(requestType, sessionId, 'Session history is unavailable on this host')
  }
  try {
    const history = await api.sessions.history({ sessionId, throughSeq: seq, beforeSeq: seq + 1, maxMessages: 1 })
    if (history && history.kind === 'error') return { ...history, requestType, sessionId }
    const entries = history && Array.isArray(history.events) ? history.events : []
    let found = null
    for (const entry of entries) {
      const candidate = entry && typeof entry === 'object' && entry.event && typeof entry.event === 'object'
        ? entry.event : entry
      if (candidate && candidate.seq === seq && typeof candidate.type === 'string') { found = candidate; break }
    }
    if (found === null) return unavailable(requestType, sessionId, 'The selected context item is no longer available')
    const allowed = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result', 'request/header', 'request/context'])
    if (!allowed.has(found.type)) return { kind: 'error', code: 'bad-request', requestType, sessionId, message: 'The selected event is not a context item' }
    const textMeta = { truncated: false }
    const text = boundedContextText(eventContentText(found, textMeta), 24000, textMeta)
    return {
      kind: 'context-content', sessionId, seq,
      value: { seq, time: timeOf(found), type: found.type, text, ...(textMeta.truncated ? { truncated: true } : {}) },
    }
  } catch (_) {
    return unavailable(requestType, sessionId, 'Unable to read the selected context item')
  }
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
    // The host adapter returns the raw `session/follow` snapshot (no `kind`):
    // only the gateway's proxyQuery helper stamps a kind. Accept both shapes so
    // the handler works with the adapter directly and with legacy mocks.
    const history = await api.sessions.history({ sessionId, maxMessages: 1 })
    if (history && history.kind === 'error') {
      return { ...history, requestType, sessionId }
    }
    const projections = history !== null && typeof history === 'object'
      && history.projections !== null && typeof history.projections === 'object'
      ? history.projections
      : undefined
    if (projections === undefined) {
      return unavailable(requestType, sessionId, 'The session projection snapshot is unavailable')
    }
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
