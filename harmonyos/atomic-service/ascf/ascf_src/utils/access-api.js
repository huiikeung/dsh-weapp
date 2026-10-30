const { t: uiText, locale } = require('./ui-preferences');
const config = require('./access-config');
const KEY = 'public-access.huawei-session.v1';
const GRANT_KEY = 'public-access.huawei-grant.v1';
const LEGACY_KEYS = ['public-access.session.v1', 'public-access.grant.v1', 'public-access.expiresAt'];
const LOGIN_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 15000;
let session = null;
let account = null;
let loginPromise = null;
let authGeneration = 0;

function configured() { return /^https:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(config.baseUrl); }
function error(message, code) { const e = new Error(message); e.code = code; return e; }
function identityUnavailable() {
  const message = locale() === 'en'
    ? 'Huawei account authentication is not available yet. Public access and account management are unavailable.'
    : '华为账号身份服务尚未接入，公网授权和账号管理暂不可用。';
  return error(message, 'HUAWEI_IDENTITY_UNAVAILABLE');
}
function notConfigured() {
  return error(locale() === 'en' ? 'Huawei account service is not configured on this server.' : '华为账号身份服务尚未配置，请联系管理员。', 'HUAWEI_NOT_CONFIGURED');
}
function serverMessage(data, fallback) {
  const code = data && data.code;
  if (locale() === 'en') {
    const messages = {
      HUAWEI_NOT_CONFIGURED: 'Huawei account service is not configured on this server.',
      HUAWEI_LOGIN_FAILED: 'Huawei account verification failed. Please authorize again.',
      HUAWEI_UNAVAILABLE: 'Huawei account service is temporarily unavailable. Please try again later.',
      INVALID_LOGIN_CODE: 'The Huawei authorization code is invalid or expired. Please sign in again.',
      HUAWEI_NOTIFICATION_UNAVAILABLE: 'Huawei accounts cannot use WeChat subscription notifications.',
      HUAWEI_SHARE_UNAVAILABLE: 'Sharing is not available for Huawei accounts.',
      HUAWEI_BINDING_UNAVAILABLE: 'WeChat administrator binding is not available for Huawei accounts.'
    };
    if (messages[code]) return messages[code];
  }
  return typeof (data && data.message) === 'string' && data.message ? uiText(data.message) : uiText(fallback);
}
function clearStorage() {
  try { has.removeStorageSync(KEY); } catch (e) {}
  try { has.removeStorageSync(GRANT_KEY); } catch (e) {}
  LEGACY_KEYS.forEach(key => { try { has.removeStorageSync(key); } catch (e) {} });
}
function clear() {
  authGeneration++;
  session = null;
  account = null;
  loginPromise = null;
  clearStorage();
}
function validToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }
function load() {
  if (session && session.provider === 'huawei' && session.baseUrl === config.baseUrl &&
    validToken(session.token) && Number.isSafeInteger(session.expiresAt) && session.expiresAt > Date.now()) return session;
  session = null;
  for (const key of LEGACY_KEYS) { try { has.removeStorageSync(key); } catch (e) {} }
  try {
    const saved = has.getStorageSync(KEY);
    const value = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if (value && value.provider === 'huawei' && value.baseUrl === config.baseUrl &&
      validToken(value.token) && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now()) session = value;
    else if (value != null) { try { has.removeStorageSync(KEY); } catch (e) {} }
  } catch (e) {
    try { has.removeStorageSync(KEY); } catch (ignored) {}
  }
  if (!session) account = null;
  return session;
}
function normalizeAccount(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    typeof value.isAdmin !== 'boolean' || typeof value.grantReady !== 'boolean' ||
    typeof value.publicAccessReady !== 'boolean' || typeof value.publicAccess !== 'boolean' ||
    !/^HW-[A-F0-9]{24}$/.test(value.deviceId || '') ||
    !(value.publicAccessExpiresAt === null || Number.isSafeInteger(value.publicAccessExpiresAt) && value.publicAccessExpiresAt >= 0)) {
    throw error(uiText('登录服务响应无效'), 'INVALID_RESPONSE');
  }
  return Object.freeze({ isAdmin: value.isAdmin, grantReady: value.grantReady,
    publicAccessReady: value.publicAccessReady, publicAccess: value.publicAccess,
    publicAccessExpiresAt: value.publicAccessExpiresAt, deviceId: value.deviceId });
}
function request(route, body, anonymous, timeout) {
  const isLogin = route === '/session/huawei' && body && typeof body.code === 'string' && Object.keys(body).length === 1;
  const isContent = route === '/app-content' && body === undefined;
  if (!anonymous || !(isLogin || isContent)) {
    const auth = load();
    if (!auth) return Promise.reject(error(uiText('华为账号身份服务尚未接入，公网授权和账号管理暂不可用。'), 'LOGIN_REQUIRED'));
  }
  if (!configured()) return Promise.reject(isContent
    ? error(uiText('公网服务尚未配置，暂时无法读取公告。'), 'NOT_CONFIGURED')
    : notConfigured());
  if (anonymous && !(isLogin || isContent)) return Promise.reject(identityUnavailable());
  const auth = anonymous ? null : load();
  return new Promise((resolve, reject) => has.request({
    url: config.baseUrl.replace(/\/$/, '') + route,
    method: body === undefined ? 'GET' : 'POST', data: body,
    timeout: timeout || REQUEST_TIMEOUT_MS,
    header: Object.assign({ 'Content-Type': 'application/json' }, auth ? { Authorization: 'Bearer ' + auth.token } : {}),
    success(res) {
      if (isLogin && res.statusCode !== 201) {
        const data = res.data && typeof res.data === 'object' ? res.data : {};
        const code = typeof data.code === 'string' ? data.code : 'INVALID_RESPONSE';
        reject(error(serverMessage(data, '华为账号登录服务响应无效'), code));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        if (res.statusCode === 401 && auth) clear();
        const data = res.data && typeof res.data === 'object' ? res.data : {};
        reject(error(serverMessage(data, '公网服务暂时不可用'),
          typeof data.code === 'string' ? data.code : 'SERVICE_ERROR'));
        return;
      }
      resolve(res.data);
    },
    fail() { reject(error(uiText('无法连接公网服务，请检查网络后重试'), 'NETWORK_ERROR')); }
  }));
}
function loginCode() {
  return new Promise((resolve, reject) => {
    if (typeof has === 'undefined' || !has || typeof has.login !== 'function') {
      reject(error(uiText('当前设备不支持华为账号登录'), 'HUAWEI_LOGIN_FAILED'));
      return;
    }
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handler(value);
    };
    const timer = setTimeout(() => finish(reject, error(uiText('华为账号登录超时，请重试'), 'HUAWEI_LOGIN_FAILED')), LOGIN_TIMEOUT_MS);
    try {
      has.login({
        success(result) {
          const code = result && result.code;
          if (typeof code === 'string' && code.length > 0 && code.length <= 4096 && !/[\x00-\x1f\x7f]/.test(code)) finish(resolve, code);
          else finish(reject, error(uiText('华为账号登录凭证无效，请重试'), 'HUAWEI_LOGIN_FAILED'));
        },
        fail() { finish(reject, error(uiText('华为账号验证失败，请重试'), 'HUAWEI_LOGIN_FAILED')); }
      });
    } catch (e) {
      finish(reject, error(uiText('华为账号验证失败，请重试'), 'HUAWEI_LOGIN_FAILED'));
    }
  });
}
function login() {
  if (loginPromise) return loginPromise;
  if (!configured()) { clear(); return Promise.reject(notConfigured()); }
  clear();
  const generation = authGeneration;
  let attempt;
  attempt = loginCode().then(code => request('/session/huawei', { code }, true, REQUEST_TIMEOUT_MS)).then(result => {
    if (generation !== authGeneration) throw error(uiText('登录状态已取消，请重试'), 'LOGIN_CANCELLED');
    if (!result || !validToken(result.token) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) {
      throw error(uiText('华为账号登录服务响应无效'), 'INVALID_RESPONSE');
    }
    const verifiedAccount = normalizeAccount(result.account);
    session = { provider: 'huawei', token: result.token, expiresAt: result.expiresAt, baseUrl: config.baseUrl };
    account = verifiedAccount;
    try { has.setStorageSync(KEY, JSON.stringify(session)); } catch (e) { /* server-verified memory session remains usable */ }
    return account;
  }).catch(e => {
    if (generation === authGeneration) clear();
    throw e;
  }).finally(() => { if (loginPromise === attempt) loginPromise = null; });
  loginPromise = attempt;
  return attempt;
}
function me() {
  return request('/me').then(result => {
    const verifiedAccount = normalizeAccount(result && result.account);
    account = verifiedAccount;
    return account;
  });
}
function ensureAccount(options) {
  if (options && options.freshLogin) return login();
  return me().catch(e => {
    if (e.code === 'LOGIN_REQUIRED' || e.code === 'UNAUTHORIZED') return login();
    throw e;
  });
}
function codes() { return request('/admin/codes').then(result => result.items || []); }
function createCode(nodeId, days, uses) {
  const body = { days, uses };
  if (nodeId) body.nodeId = nodeId;
  return request('/admin/codes', body);
}
function revokeCode(id) { return request('/admin/codes/' + encodeURIComponent(id) + '/revoke', {}); }
function copyCode(id) { return request('/admin/codes/' + encodeURIComponent(id) + '/copy', {}); }
function deleteCode(id) { return request('/admin/codes/' + encodeURIComponent(id) + '/delete', {}); }
function shareRequest(route, body) {
  return request(route, body).catch(e => { if (e.code === 'NOT_FOUND') throw error(uiText('分享服务尚未升级，请管理员更新后台后重试'), 'SHARE_UPGRADE_REQUIRED'); throw e; });
}
function shareStatus() { return shareRequest('/share'); }
function shareInvite() { return shareRequest('/share/invite', {}); }
function recordShareOpen(token) { return shareRequest('/share/open', { token }); }
function momentsStart(proof) { return shareRequest('/share/moments/start', { proof }); }
function momentsSubmit(id, proof) { return shareRequest('/share/moments/submit', { id, proof }); }
function contentRequest(route, body, anonymous) {
  return request(route, body, anonymous).catch(e => { if (e.code === 'NOT_FOUND' || anonymous && e.code === 'UNAUTHORIZED') throw error(uiText('公告与分享设置服务尚未升级，请管理员更新后台'), 'CONTENT_UPGRADE_REQUIRED'); throw e; });
}
function appContent() { return contentRequest('/app-content', undefined, true); }
function announcements() { return contentRequest('/admin/announcements'); }
function saveAnnouncement(input) { return contentRequest('/admin/announcements', input); }
function deleteAnnouncement(id, revision) { return contentRequest('/admin/announcements/' + encodeURIComponent(id) + '/delete', { revision }); }
function setSharingEnabled(enabled) { return contentRequest('/admin/share/enabled', { enabled }); }
function redeem(code, nodeId) { return request('/redemptions', { code, nodeId }); }
function redeemPublicAccess(code) {
  return request('/redemptions', { code }).then(result => me().then(() => result));
}
function hasPublicAccess() {
  return !!(account && account.publicAccess === true && (account.isAdmin === true || Number(account.publicAccessExpiresAt) > Date.now()));
}
function isManagedRelay(endpoint) {
  if (!configured()) return false;
  const prefix = config.baseUrl.replace(/^https:/, 'wss:').replace(/\/$/, '') + '/relay/c/';
  return typeof endpoint === 'string' && endpoint.indexOf(prefix) === 0 && /^[A-Za-z0-9_-]{8,128}$/.test(endpoint.slice(prefix.length));
}
function saveGrant(nodeId, lease) {
  const auth = load();
  if (!auth) throw error(uiText('请先验证华为账号身份'), 'LOGIN_REQUIRED');
  if (!lease || !validToken(lease.token) || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= Date.now()) {
    throw error(uiText('公网授权响应无效'), 'INVALID_RESPONSE');
  }
  try {
    has.setStorageSync(GRANT_KEY, JSON.stringify({ provider: 'huawei', baseUrl: config.baseUrl,
      sessionToken: auth.token, nodeId: String(nodeId || ''), expiresAt: lease.expiresAt, token: lease.token, at: Date.now() }));
  } catch (e) {}
}
function lastGrant() {
  const auth = load();
  if (!auth) return null;
  try {
    const saved = has.getStorageSync(GRANT_KEY);
    const value = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if (value && value.provider === 'huawei' && value.baseUrl === config.baseUrl && value.sessionToken === auth.token &&
      validToken(value.token) && Number.isSafeInteger(value.expiresAt) && value.expiresAt > Date.now()) return value;
    if (value != null) has.removeStorageSync(GRANT_KEY);
  } catch (e) { try { has.removeStorageSync(GRANT_KEY); } catch (ignored) {} }
  return null;
}
function cachedLease(nodeId) {
  const grant = lastGrant();
  if (!grant || grant.nodeId !== String(nodeId || '')) return null;
  return { token: grant.token, expiresAt: grant.expiresAt };
}
function forgetGrant() {
  try { has.removeStorageSync(GRANT_KEY); } catch (e) {}
  try { has.removeStorageSync('public-access.grant.v1'); } catch (e) {}
}
function publicLease(nodeId, deviceId) {
  return ensureAccount().then(current => {
    if (!hasPublicAccess()) {
      const expiresAt = Number(current && current.publicAccessExpiresAt) || 0;
      const expired = expiresAt > 0 && expiresAt <= Date.now();
      throw error(expired
        ? uiText('公网访问有效期已到期，请在设置→公网访问兑换续期；局域网连接不受影响。')
        : uiText('当前华为账号尚未开通公网访问，请在设置→公网访问兑换开通；局域网连接不受影响。'),
      expired ? 'PUBLIC_ACCESS_EXPIRED' : 'PUBLIC_ACCESS_REQUIRED');
    }
    return request('/public-access/lease', { nodeId, deviceId });
  }).then(result => {
    if (!result || !validToken(result.token) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) {
      throw error(uiText('公网授权响应无效'), 'INVALID_RESPONSE');
    }
    saveGrant(nodeId, result);
    return result;
  });
}
function issueCompletionNotificationTicket(templateId) {
  const body = typeof templateId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(templateId) ? { templateId } : {};
  return ensureAccount().then(() => request('/notifications/tickets', body)).then(result => {
    if (!result || !/^[A-Za-z0-9_-]{43}$/.test(result.ticket || '') || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) {
      throw error(uiText('通知服务响应无效'), 'INVALID_RESPONSE');
    }
    return result;
  });
}
function claimAdminBinding(code) { return request('/admin-binding/claim', { code }); }
function pairings() { return request('/admin/pairings'); }
function createPairing(nodeId, days) { return request('/admin/pairings', { nodeId, days }, false, 30000); }
function revokePairing(id) { return request('/admin/pairings/' + encodeURIComponent(id) + '/revoke', {}); }
module.exports = { configured, lastGrant, cachedLease, saveGrant, forgetGrant, login, me, ensureAccount, codes, createCode, revokeCode, copyCode, deleteCode, shareStatus, shareInvite, recordShareOpen, momentsStart, momentsSubmit, appContent, announcements, saveAnnouncement, deleteAnnouncement, setSharingEnabled, redeem, redeemPublicAccess, hasPublicAccess, isManagedRelay, publicLease, issueCompletionNotificationTicket, claimAdminBinding, pairings, createPairing, revokePairing, clear };
