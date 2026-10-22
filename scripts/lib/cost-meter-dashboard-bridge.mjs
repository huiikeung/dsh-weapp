/** Native quota dashboard for the WeChat gateway; no dsh-cost-meter service required. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { handleCostMeter as handleBaseCostMeter } from './cost-meter-bridge.mjs'

const GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const GO_KEY_REF = 'OPENCODE_GO_API_KEY'
const BALANCE_API_URL = 'https://api.deepseek.com/user/balance'
const BALANCE_KEY_REF = 'DSH_WEAPP_DEEPSEEK_BALANCE_API_KEY'
const DEFAULT_SETTINGS = Object.freeze({
  currency: 'CNY',
  exchangeRate: 7.2,
  decimals: 3,
  goQuota: { enabled: false, main: 'rolling', barDirection: 'used' },
  peak: {
    enabled: true,
    effectiveAt: '',
    windows: [{ start: 1, end: 4 }, { start: 6, end: 10 }],
    holidays: [],
  },
})
const GO_CACHE_TTL_MS = 60_000
const BALANCE_CACHE_TTL_MS = 60_000
let goCache = { at: 0, value: null }
let balanceCache = { at: 0, value: null }

function settingsFile() {
  if (process.env.DSH_WEAPP_COST_DASHBOARD_FILE) return process.env.DSH_WEAPP_COST_DASHBOARD_FILE
  const configuredHome = String(process.env.DSH_HOME || '').trim()
  const dshHome = configuredHome === '~' ? os.homedir()
    : configuredHome.startsWith('~/') ? path.join(os.homedir(), configuredHome.slice(2))
      : configuredHome ? path.resolve(configuredHome) : path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'storages', 'weapp-cost-dashboard.json')
}

function finite(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const go = input.goQuota && typeof input.goQuota === 'object' ? input.goQuota : {}
  const peak = input.peak && typeof input.peak === 'object' ? input.peak : {}
  const windows = Array.isArray(peak.windows) ? peak.windows
    .filter(row => row && Number.isInteger(row.start) && row.start >= 0 && row.start <= 23
      && Number.isInteger(row.end) && row.end >= 0 && row.end <= 24 && row.start !== row.end)
    .slice(0, 8).map(row => ({ start: row.start, end: row.end })) : DEFAULT_SETTINGS.peak.windows
  return {
    currency: input.currency === 'USD' ? 'USD' : 'CNY',
    exchangeRate: Math.max(0.01, Math.min(1000, finite(input.exchangeRate, DEFAULT_SETTINGS.exchangeRate))),
    decimals: Math.max(2, Math.min(6, Math.floor(finite(input.decimals, DEFAULT_SETTINGS.decimals)))),
    goQuota: {
      enabled: go.enabled === true,
      main: ['weekly', 'monthly'].includes(go.main) ? go.main : 'rolling',
      barDirection: go.barDirection === 'remaining' ? 'remaining' : 'used',
    },
    peak: {
      enabled: peak.enabled !== false,
      effectiveAt: typeof peak.effectiveAt === 'string' ? peak.effectiveAt.slice(0, 32) : '',
      windows: windows.length ? windows : DEFAULT_SETTINGS.peak.windows,
      holidays: Array.isArray(peak.holidays) ? peak.holidays.filter(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)).slice(0, 100) : [],
    },
  }
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    return normalizeSettings(parsed && parsed.settings)
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

function writeSettings(settings) {
  const file = settingsFile()
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(temp, JSON.stringify({ version: 1, updatedAt: Date.now(), settings }, null, 2), { mode: 0o600 })
    fs.renameSync(temp, file)
    return true
  } catch {
    try { fs.unlinkSync(temp) } catch { /* ignore cleanup errors */ }
    return false
  }
}

function credentialService(hostContext) {
  try { return hostContext && typeof hostContext.get === 'function' ? hostContext.get('credentials') : null }
  catch { return null }
}

function normalizeGoKey(value) {
  if (typeof value !== 'string') return null
  const key = value.trim().replace(/^Bearer[ \t]+/i, '').trim()
  return key && /^[\x21-\x7e]+$/.test(key) ? key : null
}

async function resolveGoKey(hostContext) {
  const refs = new Set([GO_KEY_REF])
  try {
    const providers = hostContext?.get?.('settings')?.get?.('llm-pi-ai')?.providers
    for (const profile of Object.values(providers || {})) {
      if (typeof profile?.baseURL !== 'string' || typeof profile?.apiKeyEnv !== 'string') continue
      const url = new URL(profile.baseURL)
      if (url.origin === 'https://opencode.ai' && /^\/zen\/go\/v1\/?$/.test(url.pathname)
        && !url.username && !url.password && !url.search && !url.hash && /^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.apiKeyEnv)) {
        refs.add(profile.apiKeyEnv)
      }
    }
  } catch { /* Older hosts may not expose the model settings service. */ }
  refs.add('OPENCODE_API_KEY')
  const credentials = credentialService(hostContext)
  for (const ref of refs) {
    try {
      const hit = await credentials?.resolve?.(ref)
      const key = normalizeGoKey(hit?.value)
      if (key) return key
    } catch { /* Continue to other local credential sources. */ }
    const envKey = normalizeGoKey(process.env[ref])
    if (envKey) return envKey
  }
  if (process.env.OPENCODE_AUTH_CONTENT) {
    try {
      const auth = JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
      const key = normalizeGoKey(auth?.['opencode-go']?.key)
      if (key) return key
    } catch { /* Invalid OpenCode auth JSON falls back to local files. */ }
  }
  const authFiles = [
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'opencode', 'auth.json') : '',
    path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'),
    process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, 'opencode', 'auth.json') : '',
    path.join(os.homedir(), '.config', 'opencode', 'auth.json'),
  ].filter(Boolean)
  for (const file of authFiles) {
    try {
      const auth = JSON.parse(fs.readFileSync(file, 'utf8'))
      const entry = auth?.['opencode-go']
      const key = (entry?.type === undefined || entry.type === 'api') ? normalizeGoKey(entry?.key) : null
      if (key) return key
    } catch { /* Missing or invalid OpenCode login file. */ }
  }
  return null
}

async function resolveBalanceKey(hostContext) {
  const refs = new Set([BALANCE_KEY_REF, 'DEEPSEEK_API_KEY'])
  try {
    const providers = hostContext?.get?.('settings')?.get?.('llm-pi-ai')?.providers
    for (const profile of Object.values(providers || {})) {
      if (typeof profile?.baseURL !== 'string' || typeof profile?.apiKeyEnv !== 'string') continue
      const url = new URL(profile.baseURL)
      if (url.origin === 'https://api.deepseek.com' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.apiKeyEnv)) refs.add(profile.apiKeyEnv)
    }
  } catch { /* Older hosts may not expose the model settings service. */ }
  const credentials = credentialService(hostContext)
  for (const ref of refs) {
    try {
      const key = normalizeGoKey((await credentials?.resolve?.(ref))?.value)
      if (key) return key
    } catch { /* Continue to another local key source. */ }
    const envKey = normalizeGoKey(process.env[ref])
    if (envKey) return envKey
  }
  return null
}

function normalizeWindow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const percent = Number(raw.percent)
  if (!Number.isFinite(percent)) return null
  return { percent: Math.max(0, Math.min(100, percent)), resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : '' }
}

async function fetchGoQuota(hostContext, options = {}, force = false) {
  const now = (options.now || Date.now)()
  if (!force && goCache.value && now - goCache.at < GO_CACHE_TTL_MS) return goCache.value
  const key = await resolveGoKey(hostContext)
  if (!key) return { status: 'off', message: '请在额度设置中配置 OpenCode Go API Key', fetchedAt: 0, rolling: null, weekly: null, monthly: null }
  const fetchImpl = options.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { status: 'error', message: '当前网关运行环境不支持网络请求', fetchedAt: now, rolling: null, weekly: null, monthly: null }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetchImpl(GO_USAGE_URL, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    })
    if (!response.ok) {
      const message = response.status === 401 ? 'OpenCode Go API Key 未通过认证 (HTTP 401)'
        : response.status === 403 ? '当前 API Key 没有 OpenCode Go 订阅权限 (HTTP 403)'
          : `OpenCode Go 额度接口返回 HTTP ${response.status}`
      const value = { status: 'error', message, fetchedAt: now, rolling: null, weekly: null, monthly: null }
      if (response.status === 401 || response.status === 403) goCache = { at: now, value }
      return value
    }
    const data = await response.json()
    const usage = data && typeof data.usage === 'object' ? data.usage : {}
    const windows = { rolling: normalizeWindow(usage.rolling), weekly: normalizeWindow(usage.weekly), monthly: normalizeWindow(usage.monthly) }
    if (!Object.values(windows).some(Boolean)) throw new Error('额度接口没有返回有效用量窗口')
    const value = { status: 'ok', message: '', fetchedAt: now, ...windows }
    goCache = { at: now, value }
    return value
  } catch (error) {
    return { status: 'error', message: error?.name === 'AbortError' ? 'OpenCode Go 额度查询超时' : 'OpenCode Go 额度查询失败，请检查网络或 Key', fetchedAt: now, rolling: null, weekly: null, monthly: null }
  } finally {
    clearTimeout(timeout)
  }
}

function chooseWallet(wallets) {
  if (!Array.isArray(wallets)) return null
  const rows = wallets.map(row => ({ currency: String(row?.currency || '').toUpperCase(), amount: Number(row?.balance) }))
    .filter(row => ['CNY', 'USD'].includes(row.currency) && Number.isFinite(row.amount))
  const positive = rows.filter(row => row.amount > 0)
  return positive.find(row => row.currency === 'CNY') || positive[0] || rows.find(row => row.currency === 'CNY') || rows[0] || null
}

function balanceFromDetails(details) {
  if (!details || details.status !== 'ready') return { status: details?.status === 'failed' ? 'error' : 'off', message: '未登录官方账号或余额暂不可用', currency: '', totalBalance: 0, fetchedAt: Date.now() }
  const totals = new Map()
  for (const row of [...(details.value || []), ...(details.bonusWallets || [])]) {
    const currency = String(row?.currency || '').toUpperCase()
    const amount = Number(row?.balance)
    if (['CNY', 'USD'].includes(currency) && Number.isFinite(amount)) totals.set(currency, (totals.get(currency) || 0) + amount)
  }
  const picked = chooseWallet([...totals].map(([currency, amount]) => ({ currency, balance: amount })))
  if (!picked) return { status: 'error', message: '官方账号未返回余额信息', currency: '', totalBalance: 0, fetchedAt: Date.now() }
  return { status: 'ok', message: '', currency: picked.currency, totalBalance: picked.amount, fetchedAt: Date.now() }
}

function balanceFromApiPayload(data) {
  const rows = Array.isArray(data?.balance_infos) ? data.balance_infos.map(row => ({
    currency: String(row?.currency || '').toUpperCase(),
    balance: typeof row?.total_balance === 'number' && Number.isFinite(row.total_balance)
      ? row.total_balance
      : typeof row?.total_balance === 'string' && row.total_balance.trim() !== '' && Number.isFinite(Number(row.total_balance))
        ? Number(row.total_balance) : NaN,
  })) : []
  const picked = chooseWallet(rows)
  return picked ? { status: 'ok', message: '', currency: picked.currency, totalBalance: picked.amount, fetchedAt: Date.now() } : null
}

async function fetchOfficialApiBalance(hostContext, options, now) {
  const key = await resolveBalanceKey(hostContext)
  if (!key) return null
  const fetchImpl = options.fetch || globalThis.fetch
  if (typeof fetchImpl !== 'function') return { status: 'error', message: '当前网关运行环境不支持网络请求', currency: '', totalBalance: 0, fetchedAt: now }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetchImpl(BALANCE_API_URL, {
      method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
    })
    if (!response.ok) return { status: 'error', message: `DeepSeek 余额接口返回 HTTP ${response.status}`, currency: '', totalBalance: 0, fetchedAt: now }
    const value = balanceFromApiPayload(await response.json())
    return value || { status: 'error', message: '官方余额响应格式无效', currency: '', totalBalance: 0, fetchedAt: now }
  } catch (error) {
    return { status: 'error', message: error?.name === 'AbortError' ? '官方余额查询超时' : '官方余额查询失败，请检查网络或 API Key', currency: '', totalBalance: 0, fetchedAt: now }
  } finally { clearTimeout(timeout) }
}

async function fetchBalance(api, hostContext, options = {}, force = false) {
  const now = (options.now || Date.now)()
  if (!force && balanceCache.value && now - balanceCache.at < BALANCE_CACHE_TTL_MS) return balanceCache.value
  const locale = options.locale === 'en' ? 'en' : 'zh'
  let accountValue = null
  try {
    if (api?.account && typeof api.account.getBalance === 'function') {
      const details = await api.account.getBalance({ version: 'dsh-weapp/1', locale, timezoneOffsetSeconds: -new Date(now).getTimezoneOffset() * 60 })
      accountValue = balanceFromDetails(details)
      if (accountValue.status === 'ok') {
        balanceCache = { at: now, value: accountValue }
        return accountValue
      }
    }
  } catch {
    accountValue = null
  }
  const apiValue = await fetchOfficialApiBalance(hostContext, options, now)
  const value = apiValue || accountValue || { status: 'off', message: '请登录官方账号或配置 DeepSeek API Key', currency: '', totalBalance: 0, fetchedAt: 0 }
  balanceCache = { at: now, value }
  return value
}

function validatePatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('额度配置无效')
  const patch = {}
  if (raw.currency !== undefined) {
    if (!['CNY', 'USD'].includes(raw.currency)) throw new Error('显示币种仅支持 CNY 或 USD')
    patch.currency = raw.currency
  }
  if (raw.exchangeRate !== undefined) {
    const rate = Number(raw.exchangeRate)
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) throw new Error('汇率必须大于 0 且不超过 1000')
    patch.exchangeRate = rate
  }
  if (raw.goQuota !== undefined) {
    const go = raw.goQuota
    if (!go || typeof go !== 'object' || Array.isArray(go)) throw new Error('OpenCode Go 配置无效')
    const current = readSettings().goQuota
    patch.goQuota = { ...current }
    if (go.enabled !== undefined) {
      if (typeof go.enabled !== 'boolean') throw new Error('OpenCode Go 开关无效')
      patch.goQuota.enabled = go.enabled
    }
    if (go.main !== undefined) {
      if (!['rolling', 'weekly', 'monthly'].includes(go.main)) throw new Error('用量窗口无效')
      patch.goQuota.main = go.main
    }
    if (go.barDirection !== undefined) {
      if (!['used', 'remaining'].includes(go.barDirection)) throw new Error('进度条方向无效')
      patch.goQuota.barDirection = go.barDirection
    }
  }
  if (raw.peak !== undefined) {
    const peak = raw.peak
    if (!peak || typeof peak !== 'object' || Array.isArray(peak)) throw new Error('峰谷配置无效')
    const current = readSettings().peak
    patch.peak = { ...current }
    if (peak.enabled !== undefined) {
      if (typeof peak.enabled !== 'boolean') throw new Error('峰谷开关无效')
      patch.peak.enabled = peak.enabled
    }
    if (peak.windows !== undefined) {
      if (!Array.isArray(peak.windows) || peak.windows.some(row => !row || !Number.isInteger(row.start) || row.start < 0 || row.start > 23 || !Number.isInteger(row.end) || row.end < 0 || row.end > 24 || row.start === row.end)) throw new Error('峰时段应为 0–23 点间的有效整点区间')
      patch.peak.windows = peak.windows.slice(0, 8).map(row => ({ start: row.start, end: row.end }))
    }
    if (peak.holidays !== undefined) {
      if (!Array.isArray(peak.holidays) || peak.holidays.some(day => typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))) throw new Error('节假日应使用 YYYY-MM-DD 格式')
      patch.peak.holidays = peak.holidays.slice(0, 100)
    }
  }
  return patch
}

function mergeSettings(current, patch) {
  return normalizeSettings({ ...current, ...patch,
    goQuota: { ...current.goQuota, ...(patch.goQuota || {}) },
    peak: { ...current.peak, ...(patch.peak || {}) },
  })
}

async function keyConfigured(hostContext) {
  const credentials = credentialService(hostContext)
  for (const ref of [GO_KEY_REF, 'OPENCODE_API_KEY']) {
    try { if (normalizeGoKey((await credentials?.resolve?.(ref))?.value)) return true } catch { /* Ignore and try env. */ }
    if (normalizeGoKey(process.env[ref])) return true
  }
  return Boolean(await resolveGoKey(hostContext))
}

async function balanceKeyConfigured(hostContext) { return Boolean(await resolveBalanceKey(hostContext)) }

async function saveGoKey(hostContext, value) {
  const key = normalizeGoKey(value)
  if (!key || key.length > 4096) throw new Error('请输入有效的 OpenCode Go API Key')
  const credentials = credentialService(hostContext)
  if (!credentials || typeof credentials.set !== 'function') throw new Error('DSH 凭据库暂不可用，未保存 API Key')
  await credentials.set(GO_KEY_REF, key)
}

async function clearGoKey(hostContext) {
  const credentials = credentialService(hostContext)
  if (!credentials || typeof credentials.unset !== 'function') throw new Error('DSH 凭据库暂不可用，未清除 API Key')
  await credentials.unset(GO_KEY_REF)
}

async function saveBalanceKey(hostContext, value) {
  const key = normalizeGoKey(value)
  if (!key || key.length > 4096) throw new Error('请输入有效的 DeepSeek API Key')
  const credentials = credentialService(hostContext)
  if (!credentials || typeof credentials.set !== 'function') throw new Error('DSH 凭据库暂不可用，未保存 API Key')
  await credentials.set(BALANCE_KEY_REF, key)
}

async function clearBalanceKey(hostContext) {
  const credentials = credentialService(hostContext)
  if (!credentials || typeof credentials.unset !== 'function') throw new Error('DSH 凭据库暂不可用，未清除 API Key')
  await credentials.unset(BALANCE_KEY_REF)
}

async function dashboardOf(api, hostContext, settings, options, force) {
  const [balance, goQuota, hasKey, balanceKeyConfiguredValue] = await Promise.all([
    fetchBalance(api, hostContext, options, force),
    settings.goQuota.enabled
      ? fetchGoQuota(hostContext, options, force)
      : Promise.resolve({ status: 'off', message: '', fetchedAt: 0, rolling: null, weekly: null, monthly: null }),
    keyConfigured(hostContext),
    balanceKeyConfigured(hostContext),
  ])
  return {
    currency: settings.currency,
    exchangeRate: settings.exchangeRate,
    decimals: settings.decimals,
    balance: { enabled: true, ...balance },
    customBalances: [],
    goQuota: { enabled: settings.goQuota.enabled, configured: hasKey, main: settings.goQuota.main,
      barDirection: settings.goQuota.barDirection, ...goQuota },
    peak: { enabled: settings.peak.enabled, effectiveAt: settings.peak.effectiveAt,
      windows: settings.peak.windows, holidays: settings.peak.holidays },
    settings: { goQuota: settings.goQuota, peak: settings.peak, goKeyConfigured: hasKey, balanceKeyConfigured: balanceKeyConfiguredValue },
  }
}

/** Maintain the session summary while providing balances and quotas natively. */
export async function handleCostMeterWithDashboard(api, msg, options = {}) {
  const requestId = typeof msg?.requestId === 'string' ? msg.requestId : ''
  const action = typeof msg?.action === 'string' ? msg.action : 'summary'
  try {
    let settings = readSettings()
    if (action === 'update') {
      const patch = validatePatch(msg.patch || {})
      settings = mergeSettings(settings, patch)
      if (!writeSettings(settings)) throw new Error('额度设置无法写入 DSH 本机存储')
      goCache = { at: 0, value: null }
      balanceCache = { at: 0, value: null }
    } else if (action === 'set-go-key') {
      await saveGoKey(options.hostContext, msg.value)
      settings = mergeSettings(settings, { goQuota: { ...settings.goQuota, enabled: true } })
      if (!writeSettings(settings)) throw new Error('额度设置无法写入 DSH 本机存储')
      goCache = { at: 0, value: null }
    } else if (action === 'clear-go-key') {
      await clearGoKey(options.hostContext)
      goCache = { at: 0, value: null }
    } else if (action === 'set-balance-key') {
      await saveBalanceKey(options.hostContext, msg.value)
      balanceCache = { at: 0, value: null }
    } else if (action === 'clear-balance-key') {
      await clearBalanceKey(options.hostContext)
      balanceCache = { at: 0, value: null }
    } else if (!['summary', 'config', 'refresh'].includes(action)) {
      return handleBaseCostMeter(api, msg)
    }

    const baseAction = ['summary', 'refresh'].includes(action) ? action : 'config'
    const base = await handleBaseCostMeter(api, { ...msg, action: baseAction })
    const force = action === 'refresh' || action === 'set-go-key' || action === 'set-balance-key'
    const dashboard = await dashboardOf(api, options.hostContext, settings, options, force)
    return {
      ...(base && base.kind === 'cost-meter' ? base : { kind: 'cost-meter', requestId }),
      requestId,
      action,
      config: {
        currency: settings.currency,
        exchangeRate: settings.exchangeRate,
        decimals: settings.decimals,
        goQuota: { ...settings.goQuota, keyConfigured: dashboard.settings.goKeyConfigured },
        peak: settings.peak,
      },
      dashboard,
    }
  } catch (error) {
    if (action === 'set-go-key') return { kind: 'error', requestType: 'cost-meter', requestId, code: 'cost-meter-credential-write-failed', message: 'Go API Key 保存失败，请检查 DSH 凭据库' }
    if (action === 'clear-go-key') return { kind: 'error', requestType: 'cost-meter', requestId, code: 'cost-meter-credential-write-failed', message: 'Go API Key 清除失败，请检查 DSH 凭据库' }
    if (action === 'set-balance-key') return { kind: 'error', requestType: 'cost-meter', requestId, code: 'cost-meter-credential-write-failed', message: 'DeepSeek API Key 保存失败，请检查 DSH 凭据库' }
    if (action === 'clear-balance-key') return { kind: 'error', requestType: 'cost-meter', requestId, code: 'cost-meter-credential-write-failed', message: 'DeepSeek API Key 清除失败，请检查 DSH 凭据库' }
    return { kind: 'error', requestType: 'cost-meter', requestId, code: 'cost-meter-dashboard-error', message: error?.message || '额度数据读取失败' }
  }
}
