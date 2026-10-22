const { t: uiText } = require('./ui-preferences');
const pairing = require('./pairing');
const accessApi = require('./access-api');

const FIRST_USE_KEY = 'public-access.first-relay-scan-prompted.v1';

function managedRelayPayload(raw) {
  const parsed = pairing.parse(raw, Date.now());
  if (!parsed.ok || parsed.payload.mode !== 'relay' || !accessApi.isManagedRelay(parsed.payload.publicUrl)) return null;
  return parsed.payload;
}

/** 打开设置页并直接展开「公网访问」面板；已在设置页时原地切换。 */
function focusPublicAccess() {
  let pages = [];
  try {
    pages = typeof getCurrentPages === 'function'
      ? getCurrentPages()
      : (typeof wx.getCurrentPages === 'function' ? wx.getCurrentPages() : []);
  } catch (e) { pages = []; }
  const top = pages && pages[pages.length - 1];
  if (top && top.route === 'pages/settings/settings' && typeof top.openPublicAccess === 'function') {
    top.openPublicAccess();
    return;
  }
  if (typeof wx.navigateTo === 'function') {
    wx.navigateTo({
      url: '/pages/settings/settings?panel=public',
      fail() { if (typeof wx.redirectTo === 'function') wx.redirectTo({ url: '/pages/settings/settings?panel=public' }); }
    });
    return;
  }
  if (typeof wx.switchTab === 'function') wx.switchTab({ url: '/pages/settings/settings' });
}

function pagesAvailable() {
  try { return typeof getCurrentPages === 'function' || typeof wx.getCurrentPages === 'function'; } catch (e) { return false; }
}

function activePage() {
  try {
    const pages = typeof getCurrentPages === 'function'
      ? getCurrentPages()
      : typeof wx.getCurrentPages === 'function' ? wx.getCurrentPages() : [];
    const page = pages && pages[pages.length - 1];
    return page && page.data && Object.prototype.hasOwnProperty.call(page.data, 'publicAccessDialog') && typeof page.setData === 'function'
      ? page : null;
  } catch (_) {
    return null;
  }
}

function present(dialog, onConfirm) {
  const page = activePage();
  if (!page) return false;
  if (page.data && page.data.publicAccessDialogOpen === true) return true;
  page._publicAccessDialogResolve = onConfirm || null;
  page.setData({ publicAccessDialog: dialog, publicAccessDialogOpen: true });
  return true;
}

const pendingDialogs = [];
let pendingTimer = null;

/** 冷启动时页面可能还没创建：先排队，等任意宿主页面就绪后再弹自定义弹窗。 */
function flushPendingDialogs() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  while (pendingDialogs.length) {
    const item = pendingDialogs[0];
    if (!present(item.dialog, item.onConfirm)) return;
    pendingDialogs.shift();
  }
}

function queuePresent(dialog, onConfirm) {
  pendingDialogs.push({ dialog, onConfirm });
  if (pendingTimer) clearTimeout(pendingTimer);
  let attempts = 0;
  const tick = () => {
    if (!pendingDialogs.length) return;
    if (present(pendingDialogs[0].dialog, pendingDialogs[0].onConfirm)) {
      pendingDialogs.shift();
      if (pendingDialogs.length) { attempts = 0; pendingTimer = setTimeout(tick, 150); }
      return;
    }
    attempts += 1;
    if (attempts <= 20) { pendingTimer = setTimeout(tick, 150); return; }
    const item = pendingDialogs.shift();
    fallbackModal(item.dialog, item.onConfirm);
    if (pendingDialogs.length) { attempts = 0; pendingTimer = setTimeout(tick, 150); }
  };
  tick();
}

function fallbackModal(dialog, onConfirm) {
  wx.showModal({
    title: dialog.title,
    content: dialog.content,
    showCancel: false,
    confirmText: dialog.actionLabel,
    success(result) { if (!result || result.confirm) onConfirm && onConfirm(); },
    fail() { onConfirm && onConfirm(); }
  });
}

/** 本地是否已有仍在有效期内的公网授权（管理员/已兑换用户冷启动时据此跳过提示）。 */
function validGrant() {
  try { return typeof accessApi.lastGrant === 'function' ? accessApi.lastGrant() : null; } catch (e) { return null; }
}

function promptFirstAuthorizedUse(proceed) {
  let prompted = false;
  try { prompted = wx.getStorageSync(FIRST_USE_KEY) === true; } catch (e) {}
  if (prompted || validGrant()) {
    if (!prompted) { try { wx.setStorageSync(FIRST_USE_KEY, true); } catch (e) {} }
    proceed();
    return;
  }

  const dialog = {
    kind: 'welcome',
    eyebrow: uiText('首次连接'),
    title: uiText('首次使用公网连接'),
    content: uiText('已验证当前微信账号的公网访问权限。首次连接公网节点会通过互联网中继；局域网连接不受影响。'),
    hint: uiText('局域网连接不受影响'),
    actionLabel: uiText('继续')
  };
  const continueConnection = () => {
    try { wx.setStorageSync(FIRST_USE_KEY, true); } catch (e) {}
    proceed();
  };
  if (!present(dialog, continueConnection)) {
    if (pagesAvailable()) queuePresent(dialog, continueConnection);
    else fallbackModal(dialog, continueConnection);
  }
}

function showPublicAccessFailure(message, errorCode) {
  if (errorCode !== 'PUBLIC_ACCESS_REQUIRED' && errorCode !== 'PUBLIC_ACCESS_EXPIRED') return false;
  const expired = errorCode === 'PUBLIC_ACCESS_EXPIRED';
  // 本机已有有效授权：冷启动/网络抖动的「未开通」不弹窗，只有服务端明确判定到期才提示。
  if (!expired && validGrant()) return false;
  const page = activePage();
  if (page && page.data && page.data.publicAccessDialogOpen === true) return true;
  const focusPublic = () => focusPublicAccess();
  const dialog = {
    kind: expired ? 'expired' : 'required',
    eyebrow: uiText(expired ? '需要续期' : '需要开通'),
    title: uiText(expired ? '公网访问已到期' : '尚未开通公网访问'),
    content: String(message || uiText(expired
      ? '公网访问有效期已到期，请在设置→公网访问兑换续期；局域网连接不受影响。'
      : '当前微信账号尚未开通公网访问，请在设置→公网访问兑换开通；局域网连接不受影响。')),
    hint: uiText('局域网连接不受影响'),
    actionLabel: uiText('继续')
  };
  if (!present(dialog, focusPublic)) {
    if (pagesAvailable()) queuePresent(dialog, focusPublic);
    else fallbackModal(dialog, focusPublic);
  }
  return true;
}

function resolvePublicAccessDialog(page) {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  pendingDialogs.length = 0;
  if (!page) return;
  const resolve = page._publicAccessDialogResolve;
  page._publicAccessDialogResolve = null;
  page.setData({ publicAccessDialog: null, publicAccessDialogOpen: false });
  if (typeof resolve === 'function') resolve();
}

module.exports = { focusPublicAccess, managedRelayPayload, promptFirstAuthorizedUse, showPublicAccessFailure, resolvePublicAccessDialog };
