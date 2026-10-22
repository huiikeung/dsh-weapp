const { t: uiText } = require('./ui-preferences');
const config = require('./access-config');
const KEY = 'public-access.session.v1';
const GRANT_KEY = 'public-access.grant.v1';
let session = null;
let account = null;
let loginPromise = null;
function configured() { return /^https:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(config.baseUrl); }
function error(message, code) { const e = new Error(message); e.code = code; return e; }
function clear() { session = null; account = null; try { wx.removeStorageSync(KEY); wx.removeStorageSync('public-access.expiresAt'); } catch (e) {} }
function load() {
  if (session && session.baseUrl === config.baseUrl && session.expiresAt > Date.now()) return session;
  session = null;
  try {
    const saved = wx.getStorageSync(KEY);
    const value = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if (value && value.baseUrl === config.baseUrl && value.expiresAt > Date.now()) session = value;
  } catch (e) {}
  return session;
}
function request(route, body, anonymous, timeout) {
  if (!configured()) return Promise.reject(error(uiText('公网授权服务尚未配置；局域网直连不受影响。'), 'NOT_CONFIGURED'));
  const auth = load();
  if (!anonymous && !auth) return Promise.reject(error(uiText('请先验证微信身份'), 'LOGIN_REQUIRED'));
  return new Promise((resolve, reject) => wx.request({
    url: config.baseUrl.replace(/\/$/, '') + route,
    method: body === undefined ? 'GET' : 'POST', data: body,
    timeout: timeout || 15000,
    header: Object.assign({ 'Content-Type': 'application/json' }, !anonymous && auth ? { Authorization: 'Bearer ' + auth.token } : {}),
    success(res) {
      if (res.statusCode === 401 && !anonymous) clear();
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(error(res.data && res.data.message || uiText('兑换服务暂时不可用'), res.data && res.data.code || 'SERVICE_ERROR')); return;
      }
      resolve(res.data);
    },
    fail() { reject(error(uiText('无法连接兑换服务，请检查网络后重试'), 'NETWORK_ERROR')); }
  }));
}
function login() {
  if (!configured()) return request('/session');
  if (loginPromise) return loginPromise;
  clear();
  loginPromise = new Promise((resolve, reject) => wx.login({
    timeout: 10000,
    success(res) { res.code ? resolve(res.code) : reject(error(uiText('微信身份验证失败，请重试'), 'LOGIN_FAILED')); },
    fail() { reject(error(uiText('微信身份验证失败，请重试'), 'LOGIN_FAILED')); }
  })).then(code => request('/session', { code }, true)).then(result => {
    if (!result || typeof result.token !== 'string' || !result.token || !(result.expiresAt > Date.now()) ||
      !result.account || typeof result.account.isAdmin !== 'boolean') throw error(uiText('登录服务响应无效'), 'INVALID_RESPONSE');
    session = { token: result.token, expiresAt: result.expiresAt, baseUrl: config.baseUrl };
    // 身份只接受本次服务端响应，绝不从本地缓存恢复 isAdmin。
    account = result.account;
    try { wx.setStorageSync(KEY, JSON.stringify(session)); } catch (e) { /* 缓存失败不改变服务端已验证身份。 */ }
    return account;
  }).finally(() => { loginPromise = null; });
  return loginPromise;
}
function me() {
  return request('/me').then(result => { account = result.account; return account; });
}
function ensureAccount(options) {
  // 页面进入前台时重新向微信取 code，不能用另一微信账号遗留的缓存授予管理员身份。
  if (options && options.freshLogin) return login();
  return me().catch(e => { if (e.code === 'LOGIN_REQUIRED' || e.code === 'UNAUTHORIZED') return login(); throw e; });
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
function hasPublicAccess(value) {
  const current = value || account;
  return !!(current && current.publicAccess === true && (current.isAdmin === true || Number(current.publicAccessExpiresAt) > Date.now()));
}
function isManagedRelay(endpoint) {
  if (!configured()) return false;
  const prefix = config.baseUrl.replace(/^https:/, 'wss:').replace(/\/$/, '') + '/relay/c/';
  return typeof endpoint === 'string' && endpoint.indexOf(prefix) === 0 && /^[A-Za-z0-9_-]{8,128}$/.test(endpoint.slice(prefix.length));
}
/** 最近一次公网授权成功的凭据（本地判断有效期，冷启动时避免重复弹窗）。 */
function saveGrant(nodeId, lease) {
  try { wx.setStorageSync(GRANT_KEY, JSON.stringify({ nodeId, expiresAt: Number(lease.expiresAt) || 0, at: Date.now() })); } catch (e) {}
}
function lastGrant() {
  try {
    const saved = wx.getStorageSync(GRANT_KEY);
    const value = typeof saved === 'string' ? JSON.parse(saved) : saved;
    if (value && Number(value.expiresAt) > Date.now()) return value;
  } catch (e) {}
  return null;
}

function publicLease(nodeId, deviceId) {
  return ensureAccount({ freshLogin: true }).then(current => {
    if (!hasPublicAccess(current)) {
      const expiresAt = Number(current && current.publicAccessExpiresAt) || 0;
      const expired = expiresAt > 0 && expiresAt <= Date.now();
      throw error(expired
        ? uiText('公网访问有效期已到期，请在设置→公网访问兑换续期；局域网连接不受影响。')
        : uiText('当前微信账号尚未开通公网访问，请在设置→公网访问兑换开通；局域网连接不受影响。'),
      expired ? 'PUBLIC_ACCESS_EXPIRED' : 'PUBLIC_ACCESS_REQUIRED');
    }
    return request('/public-access/lease', { nodeId, deviceId });
  }).then(result => {
    if (!result || !/^[A-Za-z0-9_-]{43}$/.test(result.token || '') || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw error(uiText('公网授权响应无效'), 'INVALID_RESPONSE');
    saveGrant(nodeId, result);
    return result;
  });
}
function issueCompletionNotificationTicket(templateId) {
  // 模板 ID 的唯一来源是小程序；服务端按票据携带的模板 ID 发送，避免两端配置不一致。
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
module.exports = { configured, lastGrant, saveGrant, login, me, ensureAccount, codes, createCode, revokeCode, copyCode, deleteCode, shareStatus, shareInvite, recordShareOpen, momentsStart, momentsSubmit, appContent, announcements, saveAnnouncement, deleteAnnouncement, setSharingEnabled, redeem, redeemPublicAccess, hasPublicAccess, isManagedRelay, publicLease, issueCompletionNotificationTicket, claimAdminBinding, pairings, createPairing, revokePairing, clear };
