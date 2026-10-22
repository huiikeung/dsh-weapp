/**
 * Cost Meter bridge (standalone).
 *
 * EXM: does NOT depend on any host-side `costMeter` service. Instead it folds
 * the host session logs directly (same data source the host's own token meter
 * uses: `assistant/message` events with provider-reported `data.usage`), so the
 * compact cost card works on every host without installing `dsh-cost-meter`.
 *
 * Wire (mobile -> host): { type:'cost-meter', requestId, action, patch? }
 * Wire (host -> mobile): { kind:'cost-meter', requestId, action, summary, config? }
 *
 * Actions:
 *   summary - fold today/month/total token totals, budget usage (cached 30s)
 *   config  - the subset of settings the mini program can display/change
 *   update  - apply an allowlisted config patch, persist locally
 *   refresh - drop the cache and fold again
 *
 * Prices: a small built-in USD catalog keyed by model id substring. It is a
 * display aid; the host may override via config.prices when it knows better.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const COST_METER_REQUEST_TYPES = new Set(['cost-meter'])

const MAX_REQUEST_ID = 128
const FINITE = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
const CACHE_TTL_MS = 30_000
const MAX_SESSIONS = 200
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

// Built-in USD list prices per million tokens (display aid only). Keyed by
// model id substring; `*` is the fallback for unknown/local models.
const DEFAULT_PRICES = {
  'deepseek-chat': { input: 0.27, cacheRead: 0.07, cacheWrite: 0.27, output: 1.10 },
  'deepseek-reasoner': { input: 0.55, cacheRead: 0.14, cacheWrite: 0.55, output: 2.19 },
  'deepseek-v3': { input: 0.27, cacheRead: 0.07, cacheWrite: 0.27, output: 1.10 },
  'deepseek-r1': { input: 0.55, cacheRead: 0.14, cacheWrite: 0.55, output: 2.19 },
  'gpt-4o': { input: 2.5, cacheRead: 1.25, cacheWrite: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, cacheRead: 0.075, cacheWrite: 0.15, output: 0.6 },
  'claude-3-5-sonnet': { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-3-5-haiku': { input: 0.8, cacheRead: 0.08, cacheWrite: 1, output: 4 },
  'glm-4': { input: 0.5, cacheRead: 0.05, cacheWrite: 0.5, output: 2 },
  'glm-4-flash': { input: 0.1, cacheRead: 0.01, cacheWrite: 0.1, output: 0.1 },
  'glm-4.5': { input: 0.5, cacheRead: 0.05, cacheWrite: 0.5, output: 2 },
  'qwen-max': { input: 0.04, cacheRead: 0.004, cacheWrite: 0.04, output: 0.12 },
  'qwen-plus': { input: 0.008, cacheRead: 0.0008, cacheWrite: 0.008, output: 0.032 },
  'qwen-turbo': { input: 0.005, cacheRead: 0.0005, cacheWrite: 0.005, output: 0.02 },
  'grok-2': { input: 2, cacheRead: 0.2, cacheWrite: 2, output: 10 },
  'llama-3': { input: 0.2, cacheRead: 0.02, cacheWrite: 0.2, output: 0.2 },
  'mistral': { input: 0.15, cacheRead: 0.015, cacheWrite: 0.15, output: 0.6 },
  '*': { input: 0.2, cacheRead: 0.02, cacheWrite: 0.2, output: 0.2 },
}

// Default local config (persisted to DISH state dir when writable).
const DEFAULT_CONFIG = Object.freeze({
  currency: 'CNY',
  exchangeRate: 7.2,
  budget: { enabled: false, amount: 0, period: 'month' },
  balance: { display: 'both' },
  hideBudget: false,
  showTotalWithPlan: false,
  includeSubagentCost: true,
  locale: 'zh',
  prices: { currency: 'USD' },
})

function fail(requestId, code, message) {
  return { kind: 'error', requestType: 'cost-meter', ...(requestId ? { requestId } : {}), code, message }
}

function numeric(v, fallback = 0) { return FINITE(v) ?? fallback }

function tokenCountOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
  }
  return null
}

function priceOf(modelId, prices) {
  const overrides = prices && typeof prices === 'object' && !Array.isArray(prices) ? prices : {}
  const catalog = { ...DEFAULT_PRICES, ...overrides }
  if (typeof modelId === 'string' && modelId !== '') {
    const key = modelId.toLowerCase()
    if (typeof catalog[key] === 'object' && catalog[key] !== null) return catalog[key]
    for (const [name, price] of Object.entries(catalog)) {
      if (name === '*' || name === 'default' || name === 'currency') continue
      if (typeof name === 'string' && name !== '' && key.includes(name.toLowerCase())) return price
    }
  }
  return catalog['*'] || catalog.default || DEFAULT_PRICES['*']
}

function costOf(usage, modelId, prices) {
  const u = usage && typeof usage === 'object' ? usage : {}
  const price = priceOf(modelId, prices)
  const input = tokenCountOf(u.inputTokens) ?? 0
  const cacheRead = tokenCountOf(u.cacheReadTokens) ?? 0
  const cacheWrite = tokenCountOf(u.cacheWriteTokens) ?? 0
  const output = tokenCountOf(u.outputTokens) ?? 0
  const reasoning = tokenCountOf(u.reasoningTokens) ?? 0
  const cost = (
    input * numeric(price.input)
    + cacheRead * numeric(price.cacheRead)
    + cacheWrite * numeric(price.cacheWrite)
    + (output + reasoning) * numeric(price.output)
  ) / 1_000_000
  return { input, cacheRead, cacheWrite, output, reasoning, tokens: input + cacheRead + cacheWrite + output + reasoning, cost }
}

function dayKey(time) {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthKey(time) {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function emptyBucket() {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, tokens: 0, cost: 0, calls: 0 }
}

function addBucket(target, usage, modelId, prices, includeSubagent) {
  if (includeSubagent === false && /\/subagent\//i.test(modelId || '')) return
  const row = costOf(usage, modelId, prices)
  target.input += row.input
  target.cacheRead += row.cacheRead
  target.cacheWrite += row.cacheWrite
  target.output += row.output
  target.reasoning += row.reasoning
  target.tokens += row.tokens
  target.cost += row.cost
  target.calls += 1
}

// ---------------------------------------------------------------------------
// Host data access
// ---------------------------------------------------------------------------

function sessionIdOf(item) {
  if (!item || typeof item !== 'object') return ''
  if (typeof item.sessionId === 'string' && item.sessionId !== '') return item.sessionId
  if (typeof item.id === 'string' && item.id !== '') return item.id
  if (item.header && typeof item.header.id === 'string' && item.header.id !== '') return item.header.id
  return ''
}

async function listSessionIds(api) {
  if (!api || !api.sessions || typeof api.sessions.list !== 'function') return []
  let frame
  try {
    frame = await api.sessions.list({})
  } catch {
    return []
  }
  const items = frame && typeof frame === 'object'
    && (Array.isArray(frame.items) ? frame.items : Array.isArray(frame) ? frame : null)
  if (!items) return []
  const ids = []
  for (const item of items.slice(0, MAX_SESSIONS)) {
    const id = sessionIdOf(item)
    if (id !== '' && MODEL_ID_PATTERN.test(id)) ids.push(id)
  }
  return ids
}

function historyEvents(frame) {
  if (!frame || typeof frame !== 'object') return []
  if (Array.isArray(frame.events)) {
    return frame.events.map(entry => entry && typeof entry === 'object' && entry.event ? entry.event : entry)
  }
  if (frame.kind === 'history' && Array.isArray(frame.value && frame.value.events)) {
    return frame.value.events.map(entry => entry && typeof entry === 'object' && entry.event ? entry.event : entry)
  }
  return []
}

async function readSessionEvents(api, sessionId) {
  if (!api || !api.sessions || typeof api.sessions.history !== 'function') return []
  try {
    const frame = await api.sessions.history({ sessionId })
    return historyEvents(frame)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function modelOf(event) {
  const data = event && event.data !== null && typeof event.data === 'object' ? event.data : null
  if (!data) return ''
  if (data.model && typeof data.model === 'string') return data.model
  const source = data.source && typeof data.source === 'object' ? data.source : null
  if (source && typeof source.model === 'string') return source.model
  return ''
}

/** Fold one session event log into today/month/total buckets (in-place). */
export function foldSessionEvents(acc, events, config, now = Date.now()) {
  const prices = (config && config.prices) || {}
  const today = (now) => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const monthStart = (now) => {
    const d = new Date(now)
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const t0 = today(now)
  const m0 = monthStart(now)
  for (const event of events) {
    if (!event || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const raw = event.data && typeof event.data === 'object' && event.data.usage ? event.data.usage : null
    if (!raw) continue
    const usage = raw && typeof raw === 'object' ? raw : null
    if (!usage || (tokenCountOf(usage.inputTokens) === null && tokenCountOf(usage.outputTokens) === null)) continue
    const time = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now()
    const modelId = modelOf(event)
    const includeSubagent = config && config.includeSubagentCost !== false
    // Accept the model id only when it looks like one; tags/ids without a model
    // still fold into the total bucket so totals never silently undercount.
    if (typeof modelId === 'string' && modelId !== '') {
      addBucket(acc.total, usage, modelId, prices, includeSubagent)
    } else {
      addBucket(acc.total, usage, typeof modelId === 'string' ? modelId : '', prices, includeSubagent)
    }
    if (time >= t0) addBucket(acc.today, usage, modelId, prices, includeSubagent)
    if (time >= m0) addBucket(acc.month, usage, modelId, prices, includeSubagent)
  }
  return acc
}

function createAccumulator() {
  return { today: emptyBucket(), month: emptyBucket(), total: emptyBucket() }
}

async function foldAll(api, config, now = Date.now(), signal) {
  const acc = createAccumulator()
  const ids = await listSessionIds(api)
  for (const sessionId of ids) {
    if (signal && signal.aborted) break
    const events = await readSessionEvents(api, sessionId)
    foldSessionEvents(acc, events, config, now)
  }
  return acc
}

// ---------------------------------------------------------------------------
// Config persistence (best-effort; never throws)
// ---------------------------------------------------------------------------

function configFile() {
  return process.env.DSH_WEAPP_COST_STATE_FILE
    || path.join(os.homedir(), '.dsh', 'storages', 'weapp-cost-meter.json')
}

function readConfig() {
  const file = configFile()
  const merged = { ...DEFAULT_CONFIG, budget: { ...DEFAULT_CONFIG.budget }, balance: { ...DEFAULT_CONFIG.balance }, prices: { ...DEFAULT_CONFIG.prices } }
  try {
    const text = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && parsed.config && typeof parsed.config === 'object') {
      const cfg = parsed.config
      merged.currency = cfg.currency || merged.currency
      merged.exchangeRate = numeric(cfg.exchangeRate, merged.exchangeRate) || merged.exchangeRate
      merged.hideBudget = cfg.hideBudget === true
      merged.showTotalWithPlan = cfg.showTotalWithPlan === true
      merged.includeSubagentCost = cfg.includeSubagentCost !== false
      if (cfg.locale) merged.locale = cfg.locale
      if (cfg.budget && typeof cfg.budget === 'object') Object.assign(merged.budget, cfg.budget)
      if (cfg.balance && typeof cfg.balance === 'object') Object.assign(merged.balance, cfg.balance)
      if (cfg.prices && typeof cfg.prices === 'object') Object.assign(merged.prices, cfg.prices)
    }
  } catch {
    // missing or unreadable: fall back to defaults
  }
  return merged
}

function writeConfig(config) {
  const file = configFile()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = file + '.' + Date.now() + '.tmp'
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: Date.now(), config }, null, 2), { mode: 0o600 })
    fs.renameSync(temp, file)
    return true
  } catch {
    try { fs.unlinkSync(file + '.' + Date.now() + '.tmp') } catch { /* ignore */ }
    return false
  }
}

// ---------------------------------------------------------------------------
// Wire projection (matches the mini program's normalize/validatePatch contract)
// ---------------------------------------------------------------------------

function amountOf(bucket, config, apiOnly) {
  const base = bucket ? bucket.cost : 0
  const currency = config.currency || 'CNY'
  const rate = numeric(config.exchangeRate, 1)
  if (currency === 'CNY') return base * rate
  return base
}

function summaryOf(acc, config) {
  if (!acc) return null
  const currency = ['CNY', 'USD'].includes(config.currency) ? config.currency : 'CNY'
  const budget = config.budget || {}
  const budgetAmount = numeric(budget.amount)
  const budgetBucket = budget.period === 'day' ? acc.today : budget.period === 'all' ? acc.total : acc.month
  const budgetUsed = budgetAmount > 0
    ? amountOf(budgetBucket, config)
    : 0
  const budgetPercent = budgetAmount > 0 ? Math.min(999, Math.round(budgetUsed / budgetAmount * 1000) / 10) : null
  return {
    available: true,
    currency,
    today: acc.today.calls > 0 ? { amount: amountOf(acc.today, config), tokens: acc.today.tokens, calls: acc.today.calls } : null,
    month: acc.month.calls > 0 ? { amount: amountOf(acc.month, config), tokens: acc.month.tokens, calls: acc.month.calls } : null,
    total: acc.total.calls > 0 ? { amount: amountOf(acc.total, config), tokens: acc.total.tokens, calls: acc.total.calls } : null,
    budget: { enabled: budget.enabled === true, amount: budgetAmount, period: budget.period || 'month', used: budgetUsed, percent: budgetPercent },
    balance: null,
    updatedAt: Date.now(),
  }
}

function configOf(config) {
  if (!config) return null
  return {
    currency: ['CNY', 'USD'].includes(config.currency) ? config.currency : 'CNY',
    budget: { enabled: config.budget?.enabled === true, amount: numeric(config.budget?.amount), period: ['day', 'month', 'all', 'custom'].includes(config.budget?.period) ? config.budget.period : 'month', customStart: config.budget?.customStart, customEnd: config.budget?.customEnd },
    balance: { display: ['sidebar', 'settings', 'both', 'off'].includes(config.balance?.display) ? config.balance.display : 'both' },
    hideBudget: config.hideBudget === true,
    showTotalWithPlan: config.showTotalWithPlan === true,
    locale: ['zh', 'en', 'auto'].includes(config.locale) ? config.locale : 'auto',
    includeSubagentCost: config.includeSubagentCost !== false,
  }
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, message: 'patch 必须是对象' }
  const errors = []
  const cur = patch.currency
  if (cur !== undefined && !['CNY', 'USD'].includes(cur)) errors.push('currency 必须是 CNY 或 USD')
  if (patch.budget !== undefined) {
    const b = patch.budget
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      if (b.enabled !== undefined && typeof b.enabled !== 'boolean') errors.push('budget.enabled 必须是布尔值')
      if (b.amount !== undefined && (!FINITE(b.amount) || b.amount < 0)) errors.push('budget.amount 必须是非负数')
      if (b.period !== undefined && !['day', 'month', 'all', 'custom'].includes(b.period)) errors.push('budget.period 必须是 day、month、all 或 custom')
    }
  }
  if (patch.balance !== undefined && patch.balance !== null) {
    if (patch.balance.display !== undefined && !['sidebar', 'settings', 'both', 'off'].includes(patch.balance.display)) errors.push('balance.display 必须是 sidebar、settings、both 或 off')
  }
  if (patch.hideBudget !== undefined && typeof patch.hideBudget !== 'boolean') errors.push('hideBudget 必须是布尔值')
  if (patch.showTotalWithPlan !== undefined && typeof patch.showTotalWithPlan !== 'boolean') errors.push('showTotalWithPlan 必须是布尔值')
  if (patch.includeSubagentCost !== undefined && typeof patch.includeSubagentCost !== 'boolean') errors.push('includeSubagentCost 必须是布尔值')
  if (errors.length > 0) return { ok: false, message: errors.join('；') }
  return { ok: true, patch }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map()

function cachedSummary(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  return null
}

function dropCache() { cache.clear() }

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Serve one `cost-meter` request.
 *
 * @param {object} api DSH host adapter (`sessions.list`, `sessions.history`)
 * @param {{requestId?:string, action?:string, patch?:object}} msg mobile frame
 * @param {object} [options] `{ now?, signal?, configOverride?, hostContext? }` for tests
 * @returns {Promise<object>} wire frame
 */
export async function handleCostMeter(api, msg, options) {
  const requestId = typeof msg?.requestId === 'string' ? msg.requestId.slice(0, MAX_REQUEST_ID) : ''
  if (!requestId) return fail(requestId, 'bad-request', 'cost-meter requires a requestId')
  const action = typeof msg?.action === 'string' ? msg.action : 'summary'
  const now = options && typeof options.now === 'function' ? options.now() : Date.now()
  const signal = options && options.signal

  const config = options && options.configOverride ? { ...DEFAULT_CONFIG, ...options.configOverride } : readConfig()

  if (action === 'config') {
      return { kind: 'cost-meter', requestId, action: 'config', config: configOf(config) }
  }

  if (action === 'update') {
    const validated = validatePatch(msg.patch)
    if (!validated.ok) return fail(requestId, 'bad-request', validated.message)
    const next = {
      ...config,
      budget: { ...config.budget },
      balance: { ...config.balance },
      prices: { ...config.prices },
    }
    const patch = validated.patch
    if (patch.currency !== undefined) next.currency = patch.currency
    if (patch.budget !== undefined) Object.assign(next.budget, patch.budget)
    if (patch.balance !== undefined && patch.balance !== null) Object.assign(next.balance, patch.balance)
    if (patch.hideBudget !== undefined) next.hideBudget = patch.hideBudget
    if (patch.showTotalWithPlan !== undefined) next.showTotalWithPlan = patch.showTotalWithPlan
    if (patch.includeSubagentCost !== undefined) next.includeSubagentCost = patch.includeSubagentCost
    if (!(options && options.configOverride) && !writeConfig(next)) {
      return fail(requestId, 'cost-meter-unavailable', '费用设置保存失败')
    }
    dropCache()
    const acc = await foldAll(api, next, now, signal)
    return { kind: 'cost-meter', requestId, action: 'update', summary: summaryOf(acc, next), config: configOf(next) }
  }

  if (action === 'refresh') {
    dropCache()
  }

  if (action !== 'summary' && action !== 'refresh') {
    return fail(requestId, 'bad-request', `未知的 cost-meter action: ${action}`)
  }

  const cacheKey = `${action}:${JSON.stringify({ currency: config.currency, exchangeRate: config.exchangeRate, budget: config.budget, includeSubagentCost: config.includeSubagentCost })}`
  const cached = action === 'summary' && !(options && options.configOverride) ? cachedSummary(cacheKey) : null
  if (cached) {
    return { kind: 'cost-meter', requestId, action: 'summary', summary: cached }
  }

  try {
    const acc = await foldAll(api, config, now, signal)
    const summary = summaryOf(acc, config)
    if (action === 'summary' && !(options && options.configOverride)) cache.set(cacheKey, { at: Date.now(), value: summary })
    return { kind: 'cost-meter', requestId, action, summary }
  } catch (e) {
    // Never expose host exception details; return generic unavailable.
    return fail(requestId, 'cost-meter-unavailable', '费用数据读取失败')
  }
}
