/**
 * Account bridge: proxy the Host's DeepSeek account projection to the mobile
 * client. Injected only when the Host provides `accountController`; older hosts
 * keep answering `account-unavailable`, which the client degrades gracefully.
 *
 * Wire shape (mobile -> host): { type: 'account', requestId, client }
 * Wire shape (host -> mobile): { kind: 'account', requestId, state, profile, balance }
 */
export const ACCOUNT_REQUEST_TYPES = new Set(['account'])

const MAX_REQUEST_ID = 128

function normalizeClient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const version = typeof value.version === 'string' ? value.version.trim().slice(0, 64) : ''
  if (!version) return undefined
  const rawLocale = typeof value.locale === 'string' ? value.locale.trim().slice(0, 32) : ''
  const offset = Number(value.timezoneOffsetSeconds)
  return {
    version,
    locale: rawLocale || 'en',
    timezoneOffsetSeconds: Number.isFinite(offset) ? Math.trunc(offset) : 0,
  }
}

function settle(promise) {
  try { return Promise.resolve(promise).catch(() => null) } catch (_) { return Promise.resolve(null) }
}

export async function handleAccount(api, msg) {
  const requestId = typeof msg?.requestId === 'string' ? msg.requestId.slice(0, MAX_REQUEST_ID) : ''
  const fail = (code, message) => ({
    kind: 'error', requestType: 'account', ...(requestId ? { requestId } : {}), code, message,
  })
  if (!requestId) return fail('bad-request', 'account requires a requestId')
  const account = api?.account
  if (!account || typeof account.getState !== 'function') {
    return fail('account-unavailable', 'Account service is unavailable on this host')
  }
  const client = normalizeClient(msg.client)
  try {
    const state = (await settle(account.getState())) ?? null
    let profile = null
    let balance = null
    if (client) {
      const [profileOutcome, balanceOutcome] = await Promise.all([
        typeof account.getProfile === 'function' ? settle(account.getProfile(client)) : null,
        typeof account.getBalance === 'function' ? settle(account.getBalance(client)) : null,
      ])
      profile = profileOutcome ?? null
      balance = balanceOutcome ?? null
    }
    return { kind: 'account', requestId, state, profile, balance }
  } catch (_) {
    return fail('account-unavailable', 'Account information is unavailable')
  }
}
