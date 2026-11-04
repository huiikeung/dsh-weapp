/**
 * 小程序虚拟支付（短剧类道具直购）客户端。
 *
 * 技术判断全部收在这里：版本门槛、iOS 微信版本、下单、拉起收银台、轮询到账。
 * 页面只负责展示与提示；wx.requestVirtualPayment 只允许在这里调用。
 * success 回调只代表收银台流程结束，**不能**作为发货依据：发货以服务端查单
 * （status === 'delivered'）为准。
 */
const { t: uiText } = require('./ui-preferences');
const accessApi = require('./access-api');

// 微信虚拟支付要求基础库 >= 2.19.2；iOS 端另需微信 >= 8.0.68（官方：iOS 15+、中国大陆 App Store）。
const MIN_SDK_VERSION = '2.19.2';
const MIN_IOS_WECHAT_VERSION = '8.0.68';
const MODE = 'short_series_goods';
// 付款成功后按 1s / 2s / 3s 查单：发货推送可能比 success 回调晚到。
const POLL_DELAYS = [1000, 2000, 3000];
// 收银台 success 回调可能丢失（官方已知问题）：15s 后并行查单，只有服务端已发货才算成功；
// 查单不改变"是否付款"的判断，回调仍然到达时照常走轮询。5 分钟后仍未完成则提示超时。
const WATCH_DELAY = 15000;
const WATCH_INTERVAL = 3000;
const WATCH_MAX_ATTEMPTS = 40;
const OVERALL_TIMEOUT = 300000;

function error(message, code) { const e = new Error(message); e.code = code; return e; }

/** 逐段比较版本号（1.2.3 vs 1.2）：-1 / 0 / 1。 */
function compareVersion(left, right) {
  const a = String(left || '').split('.');
  const b = String(right || '').split('.');
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = parseInt(a[index] || '0', 10) || 0;
    const y = parseInt(b[index] || '0', 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function systemInfo() {
  try { return (typeof wx.getSystemInfoSync === 'function' && wx.getSystemInfoSync()) || {}; } catch (e) { return {}; }
}

function sdkVersion() {
  try {
    const info = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : null;
    if (info && info.SDKVersion) return String(info.SDKVersion);
  } catch (e) { /* 退回 getSystemInfoSync */ }
  return String(systemInfo().SDKVersion || '');
}

function canRequestVirtualPayment() {
  try { return typeof wx.canIUse === 'function' && wx.canIUse('requestVirtualPayment') === true; } catch (e) { return false; }
}

/** 基础库是否支持虚拟支付（≥2.19.2，或 canIUse 明确告知支持）。 */
function supported() { return canRequestVirtualPayment() || compareVersion(sdkVersion(), MIN_SDK_VERSION) >= 0; }

/** iOS 微信版本门槛：不满足时返回原因（其它平台或读不到版本时放行，交给服务端裁决）。 */
function checkIosVersion() {
  const info = systemInfo();
  const platform = String(info.platform || '').toLowerCase();
  if (platform !== 'ios') return { ok: true, reason: '', version: '' };
  const version = String(info.version || '');
  if (!version) return { ok: true, reason: '', version: '' };
  if (compareVersion(version, MIN_IOS_WECHAT_VERSION) >= 0) return { ok: true, reason: '', version };
  return { ok: false, reason: uiText('iOS 需微信 8.0.68 及以上版本才能购买，请先升级微信。'), version };
}

/** 当前设备能否购买：{ ok, code, reason }，页面据此禁用按钮并展示原因。 */
function capability() {
  if (!supported()) return { ok: false, code: 'UNSUPPORTED', reason: uiText('当前微信版本不支持小程序虚拟支付，请升级微信后再试。') };
  const ios = checkIosVersion();
  if (!ios.ok) return { ok: false, code: 'IOS_VERSION', reason: ios.reason };
  return { ok: true, code: '', reason: '' };
}

/** 是否为 iOS（Apple 支付）设备。 */
function isIos() {
  return String(systemInfo().platform || '').toLowerCase() === 'ios';
}

// iOS Apple 支付官方硬性要求最低 1 元；低于 100 分的档位只能在 Android/鸿蒙购买。
const IOS_MIN_PRICE_CENTS = 100;
/** 检查某价格（分）在当前设备是否可购买：{ ok, reason }。 */
function priceIssue(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: uiText('档位价格无效，请联系管理员') };
  if (isIos() && value < IOS_MIN_PRICE_CENTS) {
    return { ok: false, reason: uiText('iOS 购买最低 1 元，该档位请在 Android 设备购买或改选更高档位。') };
  }
  return { ok: true, reason: '' };
}

/** 分 → 元字符串：990→9.9、300→3、100→1、1234→12.34。 */
function formatPrice(cents) {
  const value = Number(cents);
  if (!Number.isFinite(value) || value < 0) return '';
  return (Math.round(value) / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

/** 元 → 分：最多两位小数，非法输入返回 NaN（管理员价格输入用）。 */
function toCents(yuan) {
  const text = String(yuan === null || yuan === undefined ? '' : yuan).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return NaN;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) ? cents : NaN;
}

/** 分 → 两位小数的元（价格输入框回显用）。 */
function toYuan(cents) {
  const value = Number(cents);
  return Number.isFinite(value) && value >= 0 ? (Math.round(value) / 100).toFixed(2) : '0.00';
}

/** 道具 ID 由天数唯一确定：30 天 → pub_30d（需与 MP 后台道具一致）。 */
function productId(days) { return 'pub_' + days + 'd'; }

function loginCode() {
  return new Promise((resolve, reject) => {
    if (typeof wx.login !== 'function') { reject(error(uiText('当前微信版本不支持登录，请升级微信后再试。'), 'LOGIN_FAILED')); return; }
    wx.login({
      timeout: 10000,
      success(result) { result && result.code ? resolve(result.code) : reject(error(uiText('微信身份验证失败，请重试'), 'LOGIN_FAILED')); },
      fail() { reject(error(uiText('微信身份验证失败，请重试'), 'LOGIN_FAILED')); }
    });
  });
}

// 微信虚拟支付失败码 → 中文提示（严格对齐官方语义）。-2 用户取消静默，-4 风控。
// 注意：客户端实际返回负数（-15001），paymentFailure 里取绝对值匹配。
// 英文翻译走 PAY_ERRORS_EN 内联表，不占用 i18n 字典预算（字典已接近 180 KiB 上限）。
const PAY_ERRORS = {
  '-1': '支付服务暂时不可用，请稍后重试',
  '-2': '支付已取消',
  '-3': '支付失败，请稍后重试',
  '-4': '支付被风控拦截，请稍后重试或更换微信账号',
  '-5': '支付结果暂未确认，请在「公网访问」中查看权益是否到账',
  '15001': '支付参数有误，具体原因见下方说明',
  '15002': '订单号重复使用，请重新下单',
  '15003': '支付系统错误，请稍后重试',
  '15004': '币种参数错误，请联系管理员',
  '15005': '登录态签名校验失败，请重试',
  '15006': '支付签名校验失败，请联系管理员',
  '15007': '微信登录态已失效，请重试',
  '15008': '商户进件未完成，暂不能支付',
  '15009': '代币未发布，请联系管理员',
  '15010': '道具未发布，请到 MP 后台「虚拟支付 → 道具管理」发布',
  '15011': '现网环境参数错误，请联系管理员',
  '15012': '支付渠道异常，请重新下单',
  '15013': '道具价格与后台不一致，请联系管理员核对',
  '15014': '道具/代币发布未生效，发布后约 10 分钟才能购买，请稍后重试',
  '15016': '下单参数格式错误，请重新下单',
  '15017': '商家收款功能被限制，请联系客服',
  '15018': '道具审核不通过，请联系管理员',
  '15019': '商户受限，暂不能支付，请联系客服',
  '15020': '操作过快，请稍后再试',
  '15021': '交易过于频繁，请稍后再试'
};
const PAY_ERRORS_EN = {
  '-1': 'Payment service unavailable, retry later.',
  '-2': 'Payment cancelled',
  '-3': 'Payment failed, retry.',
  '-4': 'Blocked by risk control, retry or use another account.',
  '-5': 'Payment not confirmed; check access validity.',
  '15001': 'Invalid payment parameters; see details.',
  '15002': 'Duplicate order number, place a new order.',
  '15003': 'Payment system error, retry.',
  '15004': 'Invalid currency parameter.',
  '15005': 'Session signature failed, retry.',
  '15006': 'Payment signature failed.',
  '15007': 'WeChat session expired, retry.',
  '15008': 'Merchant onboarding incomplete.',
  '15009': 'Token not published.',
  '15010': 'Item not published in MP backend.',
  '15011': 'Production env parameter error.',
  '15012': 'Payment channel error, place a new order.',
  '15013': 'Item price mismatch with backend.',
  '15014': 'Publication not effective yet (~10 min after publishing), retry later.',
  '15016': 'Invalid order parameters, place a new order.',
  '15017': 'Merchant payment restricted, contact support.',
  '15018': 'Item rejected in review.',
  '15019': 'Merchant restricted, contact support.',
  '15020': 'Too many actions, retry later.',
  '15021': 'Too many transactions, retry later.'
};
function payErrorMessage(code) {
  const key = String(code);
  // 当前界面语言为英文时用内联英文表，避免把 20 条诊断文案塞进 i18n 字典。
  const zh = PAY_ERRORS[key];
  if (!zh) return '';
  try {
    const locale = require('./ui-preferences').snapshot().uiLocale;
    if (locale === 'en' && PAY_ERRORS_EN[key]) return PAY_ERRORS_EN[key];
  } catch (e) { /* 偏好模块不可用时退回中文 */ }
  return zh;
}

function paymentFailure(result) {
  const rawCode = Number(result && result.errCode);
  // 微信客户端返回的码是负数（-15001），官方文档表格写正数（15001），统一取绝对值匹配。
  const errCode = Number.isFinite(rawCode) ? Math.abs(rawCode) : rawCode;
  const known = Number.isFinite(errCode) && Object.prototype.hasOwnProperty.call(PAY_ERRORS, String(errCode));
  const message = known
    ? payErrorMessage(errCode)
    : Number.isFinite(errCode) && errCode !== 0
      ? uiText('支付未完成（错误码 {code}），请稍后重试', { code: rawCode })
      : uiText('支付未完成，请稍后重试');
  const failure = error(message, rawCode === -2 ? 'PAY_CANCELLED' : 'PAY_FAILED');
  failure.errCode = rawCode;
  // -15001 等「参数错误」的具体原因藏在 errMsg 里，必须带给页面，否则无法定位道具/价格/签名问题。
  const detail = String(result && (result.errMsg || result.err_msg || '') || '').trim();
  failure.detail = detail && detail !== message ? detail : '';
  // 用户主动取消不弹错：页面按 silent 静默处理。
  failure.silent = rawCode === -2;
  return failure;
}

function validateOrder(response) {
  if (!response || typeof response !== 'object') throw error(uiText('下单响应无效，请重试'), 'INVALID_PAY_ORDER');
  if (typeof response.signData !== 'string' || !response.signData) throw error(uiText('下单响应无效，请重试'), 'INVALID_PAY_ORDER');
  let signed = null;
  try { signed = JSON.parse(response.signData); } catch (e) { signed = null; }
  if (!signed || typeof signed !== 'object' || typeof signed.productId !== 'string' || !signed.productId) throw error(uiText('下单响应无效，请重试'), 'INVALID_PAY_ORDER');
  if (typeof response.paySig !== 'string' || !response.paySig) throw error(uiText('下单响应无效，请重试'), 'INVALID_PAY_ORDER');
  if (typeof response.signature !== 'string' || !response.signature) throw error(uiText('下单响应无效，请重试'), 'INVALID_PAY_ORDER');
  if (typeof response.outTradeNo !== 'string' || !/^[A-Za-z0-9]{8,32}$/.test(response.outTradeNo)) throw error(uiText('下单响应无效，请重试'), 'INVALID_PAY_ORDER');
  return response;
}

/**
 * 拉起微信收银台：signData 原样传（服务端已固定键序并签名）。
 * resolve({ outTradeNo, order? })：order 只会在回调丢失期间查单确认已发货时出现；
 * 否则调用方继续轮询查单。success 回调不代表发货，绝不据此结束流程。
 */
function waitForPayment(request, onStatus) {
  const outTradeNo = request.outTradeNo;
  return new Promise((resolve, reject) => {
    let settled = false, watchTimer = null, overallTimer = null, watchAttempts = 0;
    const stopTimers = () => {
      if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
      if (overallTimer) { clearTimeout(overallTimer); overallTimer = null; }
    };
    const finish = value => { if (settled) return; settled = true; stopTimers(); resolve(value); };
    const abort = failure => { if (settled) return; settled = true; stopTimers(); reject(failure); };
    const watch = () => {
      watchTimer = null;
      if (settled || watchAttempts >= WATCH_MAX_ATTEMPTS) return;
      watchAttempts += 1;
      queryOrder(outTradeNo).then(order => {
        if (settled) return;
        if (order.status === 'delivered' || order.status === 'refunded') { finish({ outTradeNo, order }); return; }
        watchTimer = setTimeout(watch, WATCH_INTERVAL);
      }).catch(() => { if (!settled) watchTimer = setTimeout(watch, WATCH_INTERVAL); });
    };
    if (typeof wx.requestVirtualPayment !== 'function') { abort(error(uiText('当前微信版本不支持小程序虚拟支付，请升级微信后再试。'), 'UNSUPPORTED')); return; }
    overallTimer = setTimeout(() => abort(error(uiText('支付超时，请在「公网访问」中查看权益是否到账'), 'PAY_TIMEOUT')), OVERALL_TIMEOUT);
    watchTimer = setTimeout(watch, WATCH_DELAY);
    wx.requestVirtualPayment({
      signData: request.signData,
      paySig: request.paySig,
      signature: request.signature,
      mode: request.mode === MODE ? request.mode : MODE,
      success() { finish({ outTradeNo }); },
      fail(result) { abort(paymentFailure(result)); }
    });
  });
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function queryOrder(outTradeNo) {
  return accessApi.queryPayOrder(outTradeNo).then(result => {
    const order = result && result.order ? result.order : result;
    if (!order || typeof order !== 'object' || order.outTradeNo !== outTradeNo) throw error(uiText('查单响应无效'), 'INVALID_RESPONSE');
    return order;
  });
}

/** 轮询到账：delivered/refunded 立即返回；否则 1s/2s/3s 再查，最后返回最新状态交给页面提示。 */
function pollOrder(outTradeNo, onStatus) {
  let attempt = 0;
  const tick = () => {
    onStatus({ phase: 'polling', attempt });
    return queryOrder(outTradeNo).then(order => {
      if (order.status === 'delivered' || order.status === 'refunded') return order;
      if (attempt >= POLL_DELAYS.length) return order;
      const delay = POLL_DELAYS[attempt];
      attempt += 1;
      return wait(delay).then(tick);
    });
  };
  return tick().catch(() => {
    // 查单失败不代表没付款：返回未知状态，页面提示稍后刷新，绝不重复下单。
    return { outTradeNo, status: 'unknown', days: 0, amount: 0, deliveredAt: 0, expiresAt: 0 };
  });
}

function requestOrder(tierId, onStatus) {
  return accessApi.ensureAccount()
    .then(() => { onStatus({ phase: 'login' }); return loginCode(); })
    .then(code => accessApi.createPayOrder(code, tierId));
}

function placeOrder(tierId, onStatus, retried) {
  onStatus({ phase: 'ordering' });
  // 同一设备切换微信账号时，缓存 token 与 wx.login 的 openid 可能不一致；
  // 服务端会拒绝下单，这里强制重新登录后整单重试一次。
  const request = requestOrder(tierId, onStatus).catch(failure => {
    if (failure && failure.code === 'PAY_ACCOUNT_MISMATCH' && !retried) {
      onStatus({ phase: 'relogin' });
      return accessApi.login().then(() => requestOrder(tierId, onStatus));
    }
    throw failure;
  });
  return request.then(response => {
    validateOrder(response);
    onStatus({ phase: 'paying', outTradeNo: response.outTradeNo });
    return waitForPayment(response, onStatus).catch(failure => {
      // 15007 = 微信登录态失效：重新登录后整单重试一次。
      if (Number(failure && failure.errCode) === 15007 && !retried) {
        onStatus({ phase: 'relogin' });
        return placeOrder(tierId, onStatus, true);
      }
      throw failure;
    });
  });
}

/**
 * 购买一个档位。
 * purchase(tierId, { onStatus }) → Promise<order>
 *   order.delivered 为 true 表示服务端已发货；false/unknown 时页面应提示稍后刷新。
 * 失败：err.silent（用户取消）时页面静默；其余 err.message 已是中文人话。
 */
function purchase(tierId, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
  const id = String(tierId || '');
  if (!id) return Promise.reject(error(uiText('请选择要购买的档位'), 'INVALID_TIER'));
  const state = capability();
  if (!state.ok) return Promise.reject(error(state.reason, state.code));
  return placeOrder(id, onStatus, false)
    .then(result => {
      // 回调丢失但服务端已发货：直接采用查单结果，不再假装"成功回调"。
      if (result.order && (result.order.status === 'delivered' || result.order.status === 'refunded')) return result.order;
      return pollOrder(result.outTradeNo, onStatus);
    })
    .then(order => Object.assign({}, order, { delivered: order.status === 'delivered' }));
}

module.exports = {
  MIN_SDK_VERSION,
  MIN_IOS_WECHAT_VERSION,
  MODE,
  supported,
  checkIosVersion,
  capability,
  isIos,
  priceIssue,
  formatPrice,
  toCents,
  toYuan,
  productId,
  purchase
};
