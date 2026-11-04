'use strict';
// 虚拟支付（个人主体 · 道具直购）服务端实现。只依赖 node:crypto；
// 微信 HTTP 接口通过注入的 fetch 调用，测试可完全打桩。
const crypto = require('node:crypto');
const DAY = 86400000;
// 支付档位与兑换码共用同一套天数白名单（小程序端档位顺序必须一致）。
const CODE_DAYS = Object.freeze([1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650]);
const MAX_TIERS = 10;
const MIN_PRICE = 1, MAX_PRICE = 1000000;
const MONTH_LIMIT_CENTS = 10000000, WARN_AT_CENTS = 9500000;
const ORDER_TTL_MS = 2 * 3600000;
const PENDING_ORDER_LIMIT = 10;
const QUERY_FALLBACK_MS = 15000;
const TICK_AGE_MS = 30 * 60000;
const TICK_BATCH = 50;
const ACCESS_TOKEN_MARGIN_MS = 5 * 60000;
const ORDER_STATUSES = ['created', 'paid', 'delivered', 'closed', 'refunded'];
const ORDER_RE = /^[0-9A-Za-z][0-9A-Za-z_-]{7,31}$/;
const PRODUCT_RE = /^pub_([0-9]{1,4})d$/;
const ACCOUNT_RE = /^[a-f0-9]{64}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');
const text = value => typeof value === 'string' ? value : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || '')), b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
// 月统计按北京时间自然月，和微信/财务口径一致。
const monthKey = time => new Date(time + 8 * 3600000).toISOString().slice(0, 7);
const emptyPayment = () => ({ enabled: false, tiers: [], updatedAt: 0 });
const invalidConfig = message => fail(400, 'INVALID_PAY_CONFIG', message || '支付档位配置无效');

function normalizeTiers(list) {
  if (!Array.isArray(list) || list.length > MAX_TIERS) throw invalidConfig('支付档位最多 10 个');
  const seen = new Set();
  return list.map(item => {
    const days = item && item.days, price = item && item.price;
    if (!Number.isSafeInteger(days) || !CODE_DAYS.includes(days)) throw invalidConfig('支付天数无效');
    if (!Number.isSafeInteger(price) || price < MIN_PRICE || price > MAX_PRICE) throw invalidConfig('支付价格无效（单位：分）');
    const id = 'pub_' + days + 'd';
    if (seen.has(id)) throw invalidConfig('支付天数重复');
    seen.add(id);
    return { id, days, price };
  });
}

// 状态文件读取时校验；任何脏数据都让进程拒绝启动，绝不重置用户权益与订单。
function validatePaymentState({ payment, orders, payGmv }) {
  const bad = message => { throw new Error(message || 'Invalid payment state'); };
  if (!object(payment)) bad('Invalid payment state');
  if (typeof payment.enabled !== 'boolean') bad('Invalid payment state');
  if (!Number.isSafeInteger(payment.updatedAt) || payment.updatedAt < 0) bad('Invalid payment state');
  if (!Array.isArray(payment.tiers) || payment.tiers.length > MAX_TIERS) bad('Invalid payment tiers');
  const tierIds = new Set();
  for (const tier of payment.tiers) {
    if (!object(tier)) bad('Invalid payment tier');
    const match = PRODUCT_RE.exec(tier.id || '');
    if (!match || !CODE_DAYS.includes(tier.days) || Number(match[1]) !== tier.days || tier.id !== 'pub_' + tier.days + 'd' ||
      !Number.isSafeInteger(tier.price) || tier.price < MIN_PRICE || tier.price > MAX_PRICE || tierIds.has(tier.id)) bad('Invalid payment tier');
    tierIds.add(tier.id);
  }
  if (!object(orders)) bad('Invalid payment orders');
  for (const [key, order] of Object.entries(orders)) {
    if (!ORDER_RE.test(key) || !object(order) || order.outTradeNo !== key) bad('Invalid payment order');
    if (typeof order.accountId !== 'string' || !ACCOUNT_RE.test(order.accountId)) bad('Invalid payment order');
    const match = PRODUCT_RE.exec(order.productId || '');
    if (!match || !CODE_DAYS.includes(order.days) || Number(match[1]) !== order.days || order.productId !== 'pub_' + order.days + 'd') bad('Invalid payment order');
    if (!Number.isSafeInteger(order.amount) || order.amount < MIN_PRICE || order.amount > MAX_PRICE) bad('Invalid payment order');
    if (order.env !== 0 && order.env !== 1) bad('Invalid payment order');
    if (!ORDER_STATUSES.includes(order.status)) bad('Invalid payment order');
    for (const field of ['createdAt', 'paidAt', 'deliveredAt']) if (!Number.isSafeInteger(order[field]) || order[field] < 0) bad('Invalid payment order');
    for (const field of ['wxOrderId', 'mchOrderNo', 'transactionId', 'attach']) {
      if (typeof order[field] !== 'string' || order[field].length > 256) bad('Invalid payment order');
    }
    if (order.refund !== null) {
      if (!object(order.refund) || typeof order.refund.refundOrderId !== 'string' || order.refund.refundOrderId.length > 64 ||
        !Number.isSafeInteger(order.refund.refundedAt) || order.refund.refundedAt < 0 ||
        !Number.isSafeInteger(order.refund.amount) || order.refund.amount < 0 || order.refund.amount > MAX_PRICE) bad('Invalid payment refund');
    }
    if (order.status === 'delivered' && order.deliveredAt <= 0) bad('Invalid payment order');
    if (order.status === 'refunded' && order.refund === null) bad('Invalid payment refund');
  }
  if (!object(payGmv)) bad('Invalid payment GMV');
  for (const [month, record] of Object.entries(payGmv)) {
    if (!MONTH_RE.test(month) || !object(record) || !Number.isSafeInteger(record.cents) || record.cents < 0 ||
      !Number.isSafeInteger(record.count) || record.count < 0) bad('Invalid payment GMV');
  }
}

function createPayment({ getState, commit, now, limit, config, fetch } = {}) {
  if (typeof getState !== 'function' || typeof commit !== 'function' || typeof now !== 'function') throw new Error('Missing payment configuration');
  const fetchImpl = typeof fetch === 'function' ? fetch : globalThis.fetch;
  let accessTokenCache = null;
  const state = () => getState();

  function settings() {
    const raw = typeof config === 'function' ? config() : config;
    const saved = object(raw) ? raw : {};
    const encrypt = ['plaintext', 'aes', 'compatible'].includes(saved.msgEncrypt) ? saved.msgEncrypt : 'plaintext';
    return {
      offerId: text(saved.offerId), appKey: text(saved.appKey), env: saved.env === 1 ? 1 : 0,
      msgToken: text(saved.msgToken), msgAesKey: text(saved.msgAesKey), msgEncrypt: encrypt,
      appId: text(saved.appId), appSecret: text(saved.appSecret),
      resolveOpenid: typeof saved.resolveOpenid === 'function' ? saved.resolveOpenid : () => ''
    };
  }
  // ready = OfferID + AppKey + 小程序 AppID/AppSecret，缺一不可（与契约一致）。
  function ready() {
    const current = settings();
    return !!(current.offerId && current.appKey && current.appId && current.appSecret);
  }
  const payment = () => object(state().payment) ? state().payment : emptyPayment();
  function catalog() {
    const current = payment();
    return {
      enabled: current.enabled === true,
      ready: ready(),
      tiers: (current.tiers || []).map(({ id, days, price }) => ({ id, days, price }))
    };
  }
  function saveConfig(input) {
    if (!object(input)) throw invalidConfig('支付配置无效');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw invalidConfig('支付开关无效');
    const current = payment();
    // 关闭开关时保留已有档位；客户端未提交档位时同样保留。
    const tiers = input.tiers === undefined
      ? (current.tiers || []).map(({ id, days, price }) => ({ id, days, price }))
      : normalizeTiers(input.tiers);
    const enabled = input.enabled === undefined ? current.enabled === true : input.enabled;
    commit(next => { next.payment = { enabled, tiers, updatedAt: now() }; });
    return catalog();
  }

  async function accessToken(current) {
    const time = now();
    if (accessTokenCache && accessTokenCache.appId === current.appId && accessTokenCache.expiresAt > time) return accessTokenCache.accessToken;
    const body = JSON.stringify({ grant_type: 'client_credential', appid: current.appId, secret: current.appSecret, force_refresh: false });
    let response;
    try {
      response = await fetchImpl('https://api.weixin.qq.com/cgi-bin/stable_token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'Content-Type': 'application/json' }, body
      });
    } catch (error) { throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信支付服务暂时不可用，请稍后重试'); }
    let data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    if (!response || response.ok === false || !object(data) || (Number(data.errcode) || 0) !== 0 ||
      typeof data.access_token !== 'string' || !data.access_token) throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信支付服务暂时不可用，请稍后重试');
    const expiresIn = Number(data.expires_in) > 0 ? Number(data.expires_in) : 7200;
    accessTokenCache = { appId: current.appId, accessToken: data.access_token, expiresAt: time + Math.max(60, expiresIn - ACCESS_TOKEN_MARGIN_MS / 1000) * 1000 };
    return data.access_token;
  }
  // 服务端 API 签名：pay_sig = HMAC-SHA256(appKey, uri + '&' + 实际发送的 body 字符串)。
  async function xpayPost(uri, body, current) {
    const paySig = hmac(current.appKey, uri + '&' + body);
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken(current);
      const url = 'https://api.weixin.qq.com' + uri + '?access_token=' + encodeURIComponent(token) + '&pay_sig=' + paySig;
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
          headers: { 'Content-Type': 'application/json' }, body
        });
      } catch (error) { throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信支付服务暂时不可用，请稍后重试'); }
      let data = null;
      try { data = await response.json(); } catch (error) { data = null; }
      if (!response || response.ok === false || !object(data)) throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信支付服务暂时不可用，请稍后重试');
      const errcode = Number(data.errcode) || 0;
      // access_token 失效时刷新一次；不改变 pay_sig 与 body。
      if ((errcode === 40001 || errcode === 42001) && attempt === 0) { accessTokenCache = null; continue; }
      return data;
    }
  }

  function orderView(order) {
    return {
      outTradeNo: order.outTradeNo, status: order.status, days: order.days, amount: order.amount,
      deliveredAt: order.deliveredAt, expiresAt: Number(state().access?.[order.accountId]?.expiresAt) || 0
    };
  }
  // 发货：订单 delivered + access 累加 + 当月 GMV 累加，必须在同一个 commit 内完成。
  function deliver(next, order, meta) {
    const time = now();
    if (order.status === 'delivered') return 'delivered';
    if (order.status === 'refunded') return 'refunded';
    const transactionId = text(meta.transactionId);
    if (transactionId && Object.values(next.orders).some(other =>
      other.outTradeNo !== order.outTradeNo && other.transactionId === transactionId && other.status === 'delivered')) return 'duplicate';
    const paidAt = Number(meta.paidAt) > 0 ? Number(meta.paidAt) : (order.paidAt || time);
    const previous = Number(next.access?.[order.accountId]?.expiresAt) || 0;
    const expiresAt = Math.max(time, previous) + order.days * DAY;
    if (!Number.isSafeInteger(expiresAt)) throw fail(400, 'INVALID_EXPIRY', '累计有效期过长');
    next.access ||= {};
    next.access[order.accountId] = { expiresAt, updatedAt: time };
    order.status = 'delivered';
    order.paidAt = paidAt;
    order.deliveredAt = time;
    if (meta.wxOrderId) order.wxOrderId = text(meta.wxOrderId).slice(0, 256);
    if (meta.mchOrderNo) order.mchOrderNo = text(meta.mchOrderNo).slice(0, 256);
    if (transactionId) order.transactionId = transactionId.slice(0, 256);
    const month = monthKey(paidAt);
    next.payGmv ||= {};
    const gmv = next.payGmv[month] || { cents: 0, count: 0 };
    gmv.cents = (Number(gmv.cents) || 0) + order.amount;
    gmv.count = (Number(gmv.count) || 0) + 1;
    next.payGmv[month] = gmv;
    return 'delivered';
  }
  function applyRefund(outTradeNo, meta = {}) {
    return commit(next => {
      const order = next.orders[outTradeNo];
      if (!order || order.status === 'refunded') return false;
      const time = now();
      if (order.status === 'delivered') {
        next.access ||= {};
        const previous = Number(next.access[order.accountId]?.expiresAt) || 0;
        next.access[order.accountId] = { expiresAt: Math.max(time, previous - order.days * DAY), updatedAt: time };
      }
      order.status = 'refunded';
      order.refund = {
        refundOrderId: text(meta.refundOrderId) || text(order.refund?.refundOrderId),
        refundedAt: time,
        amount: Number(meta.amount) > 0 ? Number(meta.amount) : (Number(order.refund?.amount) || order.amount)
      };
      return true;
    });
  }
  function closeOrder(outTradeNo) {
    commit(next => { const order = next.orders[outTradeNo]; if (order && order.status === 'created') order.status = 'closed'; });
  }

  function createOrder({ accountId, tierId, sessionKey } = {}) {
    const current = settings();
    if (payment().enabled !== true) throw fail(403, 'PAY_DISABLED', '虚拟支付暂未开放');
    if (!ready()) throw fail(503, 'PAY_NOT_CONFIGURED', '虚拟支付尚未配置，请联系管理员');
    if (typeof accountId !== 'string' || !ACCOUNT_RE.test(accountId)) throw fail(401, 'PAY_LOGIN_FAILED', '微信身份验证失败，请重新登录');
    if (typeof sessionKey !== 'string' || !sessionKey || sessionKey.length > 512) throw fail(401, 'PAY_LOGIN_FAILED', '微信登录已过期，请重新进入小程序');
    const tier = (payment().tiers || []).find(item => item.id === tierId);
    if (!tier) throw fail(400, 'INVALID_TIER', '该支付档位不存在或已下架');
    const time = now();
    if ((Number(state().payGmv?.[monthKey(time)]?.cents) || 0) >= MONTH_LIMIT_CENTS) throw fail(429, 'MONTHLY_LIMIT_REACHED', '本月支付额度已满，请下月再试');
    let outTradeNo;
    do { outTradeNo = 'P' + time.toString(36).toUpperCase() + crypto.randomBytes(5).toString('hex'); } while (state().orders[outTradeNo]);
    commit(next => {
      let pending = Object.values(next.orders).filter(order => order.accountId === accountId && order.status === 'created')
        .sort((a, b) => a.createdAt - b.createdAt);
      // 超过 2 小时仍 created 的订单先关闭，未支付订单最多保留 10 单。
      for (const order of pending) if (time - order.createdAt > ORDER_TTL_MS) order.status = 'closed';
      pending = pending.filter(order => order.status === 'created');
      while (pending.length >= PENDING_ORDER_LIMIT) pending.shift().status = 'closed';
      next.orders[outTradeNo] = {
        outTradeNo, accountId, productId: tier.id, days: tier.days, amount: tier.price, env: current.env,
        status: 'created', createdAt: time, paidAt: 0, deliveredAt: 0,
        wxOrderId: '', mchOrderNo: '', transactionId: '', attach: accountId, refund: null
      };
    });
    // 键顺序固定：客户端必须原样传递 signData，不能重排或再次 JSON.stringify。
    const signData = JSON.stringify({
      offerId: current.offerId, buyQuantity: 1, env: current.env, currencyType: 'CNY',
      productId: tier.id, goodsPrice: tier.price, outTradeNo, attach: accountId
    });
    return {
      outTradeNo, signData,
      paySig: hmac(current.appKey, 'requestVirtualPayment&' + signData),
      signature: hmac(sessionKey, signData),
      mode: 'short_series_goods', env: current.env
    };
  }

  // A: 查单兜底发货后，把微信侧订单也标记成「已发货」，避免后台账单停留在 status=3（发货中）。
  // notify_provide_goods 同样需要 pay_sig（实测缺失会报 268490002），复用 xpayPost 的签名逻辑。
  async function markWxProvided(outTradeNo, current) {
    const body = JSON.stringify({ order_id: outTradeNo, env: 0 });
    try {
      const result = await xpayPost('/xpay/notify_provide_goods', body, current);
      if ((Number(result.errcode) || 0) === 0) { console.log('[pay] wx marked provided', outTradeNo); return true; }
      console.warn('[pay] notify_provide_goods rejected for', outTradeNo, 'code', Number(result.errcode) || 0);
    } catch (error) {
      console.warn('[pay] notify_provide_goods failed for', outTradeNo, error && error.message || 'UNKNOWN');
    }
    return false;
  }

  // 本地订单 created/paid 超过 15 秒时用微信 query_order 兜底补发；失败只记日志。
  async function reconcileOrder(outTradeNo, openid) {
    if (!openid || !ready()) return null;
    const order = state().orders[outTradeNo];
    if (!order || !['created', 'paid'].includes(order.status)) return null;
    const current = settings();
    const body = JSON.stringify({ openid, env: order.env, order_id: outTradeNo });
    const result = await xpayPost('/xpay/query_order', body, current);
    if ((Number(result.errcode) || 0) !== 0) { console.warn('[pay] query_order rejected for', outTradeNo, 'code', Number(result.errcode) || 0); return null; }
    const wxOrder = object(result.order) ? result.order : null;
    if (!wxOrder) return null;
    const status = Number(wxOrder.status);
    if (!Number.isFinite(status)) return null;
    if (status === 5 || status === 8) { applyRefund(outTradeNo, { refundOrderId: text(wxOrder.wx_order_id), amount: Number(wxOrder.refund_fee) }); return state().orders[outTradeNo]; }
    if (status === 6) { closeOrder(outTradeNo); return state().orders[outTradeNo]; }
    if (![2, 3, 4].includes(status) || Number(wxOrder.order_fee) !== order.amount) return null;
    let delivered = false;
    commit(next => {
      const currentOrder = next.orders[outTradeNo];
      if (!currentOrder || currentOrder.status === 'delivered' || currentOrder.status === 'refunded') return;
      deliver(next, currentOrder, {
        paidAt: Number(wxOrder.paid_time) > 0 ? Number(wxOrder.paid_time) * 1000 : 0,
        wxOrderId: text(wxOrder.wx_order_id), mchOrderNo: text(wxOrder.channel_order_id), transactionId: text(wxOrder.wxpay_order_id)
      });
      delivered = currentOrder.status === 'delivered';
    });
    console.log('[pay] reconciled order', outTradeNo, 'status', status);
    // 微信侧发货推送没配成时，主动把订单标记为已发货（status≠4 都标），账单才能正确归类。
    if (delivered && status !== 4) await markWxProvided(outTradeNo, current);
    return state().orders[outTradeNo];
  }

  // C/B: 管理员强制查单：以微信 query_order 为准，识别退款并同步本地状态。
  async function inspectOrder(outTradeNo) {
    const current = settings();
    if (!ready()) throw fail(503, 'PAY_NOT_CONFIGURED', '虚拟支付尚未配置，请联系管理员');
    const order = state().orders[outTradeNo];
    if (!order) throw fail(404, 'ORDER_NOT_FOUND', '订单不存在');
    const openid = text(current.resolveOpenid(order.accountId));
    if (!openid) throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '订单用户身份已失效，无法核对');
    const body = JSON.stringify({ openid, env: order.env, order_id: outTradeNo });
    const result = await xpayPost('/xpay/query_order', body, current);
    if ((Number(result.errcode) || 0) !== 0) throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信订单查询失败，请稍后重试');
    const wx = object(result.order) ? result.order : null;
    if (!wx) throw fail(404, 'ORDER_NOT_FOUND', '微信侧未查到该订单');
    const status = Number(wx.status);
    const leftFee = Number(wx.left_fee);
    // 部分退款：left_fee 归零即视为全额退款，扣回天数并标记。
    if (order.status === 'delivered' && Number.isFinite(leftFee) && leftFee <= 0) {
      applyRefund(outTradeNo, { refundOrderId: text(wx.wx_order_id), amount: Number(wx.refund_fee) || order.amount });
    } else if (status === 5 || status === 8) {
      applyRefund(outTradeNo, { refundOrderId: text(wx.wx_order_id), amount: Number(wx.refund_fee) });
    }
    // 本地已发货但微信侧仍是「发货中」→ 与定时对账同一套自愈逻辑，补标记。
    let markedProvided = false;
    if (state().orders[outTradeNo].status === 'delivered' && (status !== 4 || !Number(wx.provide_time))) {
      markedProvided = await markWxProvided(outTradeNo, current);
    }
    const local = state().orders[outTradeNo];
    return {
      order: orderView(local),
      wechat: {
        status: markedProvided ? 4 : status,
        orderType: Number(wx.order_type), paidFee: Number(wx.paid_fee),
        leftFee, wxOrderId: text(wx.wx_order_id), transactionId: text(wx.wxpay_order_id),
        paidTime: Number(wx.paid_time), settled: Number(wx.sett_state) === 2,
        markedProvided
      }
    };
  }
  async function queryOrder({ accountId, outTradeNo, openid } = {}) {
    if (typeof outTradeNo !== 'string' || !ORDER_RE.test(outTradeNo)) throw fail(404, 'ORDER_NOT_FOUND', '订单不存在');
    let order = state().orders[outTradeNo];
    if (!order) throw fail(404, 'ORDER_NOT_FOUND', '订单不存在');
    if (order.accountId !== accountId) throw fail(403, 'FORBIDDEN', '无权查看该订单');
    const since = order.status === 'paid' ? (order.paidAt || order.createdAt) : order.createdAt;
    if (['created', 'paid'].includes(order.status) && now() - since > QUERY_FALLBACK_MS) {
      try { await reconcileOrder(outTradeNo, openid || settings().resolveOpenid(order.accountId)); }
      catch (error) { console.error('[pay] query_order fallback failed for', outTradeNo, error && error.message || 'UNKNOWN'); }
      order = state().orders[outTradeNo] || order;
    }
    return { order: orderView(order) };
  }

  function buildReply(format, errCode = 0, errMsg = 'success') {
    return { format, httpStatus: 200, errCode: Number(errCode) || 0, errMsg: errMsg || (Number(errCode) ? 'error' : 'success') };
  }
  function verifyQuerySignature(current, query) {
    const timestamp = text(query.timestamp), nonce = text(query.nonce);
    const provided = text(query.signature) || text(query.msg_signature);
    if (!current.msgToken || !provided) {
      console.warn('[pay] notify rejected: missing token or signature');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    const expected = sha1([current.msgToken, timestamp, nonce].sort().join(''));
    if (!safeEqual(expected, provided.toLowerCase())) {
      console.warn('[pay] notify rejected: signature mismatch');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
  }
  function verifyMessageSignature(current, query, encrypted) {
    const timestamp = text(query.timestamp), nonce = text(query.nonce);
    const provided = text(query.msg_signature) || text(query.signature);
    if (!current.msgToken || !provided) {
      console.warn('[pay] notify rejected: missing token or msg_signature');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    const expected = sha1([current.msgToken, timestamp, nonce, encrypted].sort().join(''));
    if (!safeEqual(expected, provided.toLowerCase())) {
      console.warn('[pay] notify rejected: msg_signature mismatch');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
  }
  // WXBizMsgCrypt 兼容：key = base64(EncodingAESKey + '=')，iv = key[0..16]，
  // 明文 = 16 字节随机 + 4 字节长度 + msg + appid。
  function decryptMessage(current, encrypted) {
    let key;
    try { key = Buffer.from(current.msgAesKey + '=', 'base64'); } catch (error) { key = null; }
    if (!key || key.length !== 32 || !current.msgAesKey) {
      console.warn('[pay] notify rejected: invalid AES key');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    let decrypted;
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
      decipher.setAutoPadding(false);
      decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
    } catch (error) {
      console.warn('[pay] notify rejected: decrypt failed');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    // 微信 WXBizMsgCrypt 的 PKCS#7 使用 32 字节块（不是 AES 的 16 字节），pad 取值 1..32。
    const pad = decrypted[decrypted.length - 1];
    if (!(pad >= 1 && pad <= 32) || pad > decrypted.length - 20) throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    for (let index = decrypted.length - pad; index < decrypted.length; index++) {
      if (decrypted[index] !== pad) throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    const content = decrypted.subarray(0, decrypted.length - pad);
    // 明文布局：16 字节随机 + 4 字节长度（网络序）+ msg + appid。
    if (content.length < 20) throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    const length = content.readUInt32BE(16);
    if (length < 1 || 20 + length > content.length) throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    const message = content.subarray(20, 20 + length).toString('utf8');
    const appId = content.subarray(20 + length).toString('utf8');
    if (current.appId && appId !== current.appId) {
      console.warn('[pay] notify rejected: appid mismatch');
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    return message;
  }
  function decodeXml(value) {
    return String(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function parseXmlChildren(source) {
    const result = {};
    const pattern = /<([A-Za-z][A-Za-z0-9_]*)>([\s\S]*?)<\/\1>/g;
    let match;
    while ((match = pattern.exec(source))) {
      let value = match[2].trim();
      const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
      if (cdata) value = cdata[1];
      result[match[1]] = /^<[A-Za-z]/.test(value) ? parseXmlChildren(value) : decodeXml(value);
    }
    return result;
  }
  function parseXml(xml) {
    const root = /<xml>([\s\S]*)<\/xml>/i.exec(xml);
    return parseXmlChildren(root ? root[1] : xml);
  }
  function handleDeliver(format, event) {
    const outTradeNo = text(event.OutTradeNo);
    const order = state().orders[outTradeNo];
    if (!order) { console.warn('[pay] deliver notify for unknown order', outTradeNo.slice(0, 32)); return buildReply(format, 40001, 'order not found'); }
    if (Number(event.Env) !== order.env) { console.warn('[pay] deliver notify env mismatch for', outTradeNo); return buildReply(format, 40002, 'env mismatch'); }
    const goods = object(event.GoodsInfo) ? event.GoodsInfo : {};
    const wxpay = object(event.WeChatPayInfo) ? event.WeChatPayInfo : {};
    if (text(goods.ProductId) !== order.productId) { console.warn('[pay] deliver notify product mismatch for', outTradeNo); return buildReply(format, 40003, 'product mismatch'); }
    if (Number(goods.ActualPrice) !== order.amount) { console.warn('[pay] deliver notify amount mismatch for', outTradeNo); return buildReply(format, 40004, 'amount mismatch'); }
    if (order.status === 'delivered') { console.log('[pay] duplicate deliver notify for', outTradeNo); return buildReply(format); }
    if (order.status === 'refunded') { console.warn('[pay] deliver notify for refunded order', outTradeNo); return buildReply(format); }
    try {
      commit(next => {
        const current = next.orders[outTradeNo];
        if (!current || current.status === 'delivered' || current.status === 'refunded') return;
        deliver(next, current, {
          paidAt: Number(wxpay.PaidTime) > 0 ? Number(wxpay.PaidTime) * 1000 : 0,
          wxOrderId: text(wxpay.WxOrderId) || text(event.WxOrderId),
          mchOrderNo: text(wxpay.MchOrderNo), transactionId: text(wxpay.TransactionId)
        });
      });
    } catch (error) {
      console.error('[pay] deliver notify failed for', outTradeNo, error && error.message || 'UNKNOWN');
      return buildReply(format, 50001, 'deliver failed');
    }
    console.log('[pay] delivered', outTradeNo, order.days + 'd');
    return buildReply(format);
  }
  function handleRefund(format, event) {
    const outTradeNo = text(event.MchOrderId) || text(event.OutTradeNo);
    let order = state().orders[outTradeNo];
    const wxOrderId = text(event.WxOrderId);
    const mchRefundId = text(event.MchRefundId);
    const wxTransactionId = text(event.WxTransactionId);
    if (!order && wxOrderId) order = Object.values(state().orders).find(item => item.wxOrderId === wxOrderId || item.transactionId === wxOrderId);
    // Android 主动退款：推送里的 MchRefundId 就是我们 refund_order_id；iOS 退款问询后附带的 WxTransactionId
    // 是原支付的微信交易单号。两条都不依赖 MchOrderId 的格式，避免退款推送找不到订单而不扣回天数。
    if (!order && mchRefundId) order = Object.values(state().orders).find(item => item.refund && item.refund.refundOrderId === mchRefundId);
    if (!order && wxTransactionId) order = Object.values(state().orders).find(item => item.transactionId === wxTransactionId);
    if (!order) { console.warn('[pay] refund notify for unknown order', outTradeNo.slice(0, 32)); return buildReply(format); }
    if (Number(event.RetCode) !== 0) { console.warn('[pay] refund notify failed for', order.outTradeNo); return buildReply(format); }
    if (order.status === 'refunded') { console.log('[pay] duplicate refund notify for', order.outTradeNo); return buildReply(format); }
    try {
      applyRefund(order.outTradeNo, { refundOrderId: text(event.MchRefundId) || text(event.WxRefundId), amount: Number(event.RefundFee) });
    } catch (error) {
      console.error('[pay] refund notify failed for', order.outTradeNo, error && error.message || 'UNKNOWN');
      return buildReply(format, 50002, 'refund failed');
    }
    console.log('[pay] refunded', order.outTradeNo);
    return buildReply(format);
  }

  async function notify({ query = {}, rawBody = '' } = {}) {
    const current = settings();
    const raw = typeof rawBody === 'string' ? rawBody : '';
    let outer = null;
    try { outer = JSON.parse(raw); } catch (error) { outer = null; }
    const encrypted = object(outer) && typeof outer.Encrypt === 'string' ? outer.Encrypt : '';
    let message;
    if (current.msgEncrypt === 'aes' || (current.msgEncrypt === 'compatible' && encrypted)) {
      if (!encrypted) {
        console.warn('[pay] notify rejected: missing Encrypt');
        throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
      }
      verifyMessageSignature(current, query, encrypted);
      message = decryptMessage(current, encrypted);
    } else {
      if (encrypted) {
        console.warn('[pay] notify rejected: encrypted body while XPAY_MSG_ENCRYPT is plaintext');
        throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
      }
      verifyQuerySignature(current, query);
      message = raw;
    }
    const trimmed = String(message || '').trim();
    let format, event;
    if (trimmed.startsWith('<')) {
      format = 'xml';
      event = parseXml(trimmed);
    } else {
      format = 'json';
      try { event = JSON.parse(trimmed); } catch (error) {
        console.warn('[pay] notify rejected: invalid JSON body');
        return buildReply('json', 40000, 'invalid body');
      }
    }
    if (!object(event)) { console.warn('[pay] notify rejected: invalid body'); return buildReply(format, 40000, 'invalid body'); }
    const type = text(event.Event);
    try {
      if (type === 'xpay_goods_deliver_notify') return handleDeliver(format, event);
      if (type === 'xpay_refund_notify') return handleRefund(format, event);
      // 投诉、风控、iOS 退款问询等：只记事件名并确认收到。
      if (type) console.log('[pay] notify ignored event', type.slice(0, 64));
      return buildReply(format);
    } catch (error) {
      console.error('[pay] notify handler failed for', type.slice(0, 64), error && error.message || 'UNKNOWN');
      return buildReply(format, 50000, 'temporary failure');
    }
  }

  function verifyUrl(query = {}) {
    const current = settings();
    const echostr = text(query.echostr);
    const provided = text(query.signature) || text(query.msg_signature);
    const timestamp = text(query.timestamp), nonce = text(query.nonce);
    const expected = current.msgToken ? sha1([current.msgToken, timestamp, nonce].sort().join('')) : '';
    if (!current.msgToken || !echostr || !provided || !safeEqual(expected, provided.toLowerCase())) {
      // 只打印参数形态与摘要前缀，不打印 Token/完整签名，便于定位微信请求差异。
      console.warn('[pay] notify URL verification rejected', JSON.stringify({
        keys: Object.keys(query).sort().join(','),
        tokenLen: current.msgToken.length,
        hasEcho: !!echostr, echoLen: echostr.length,
        hasSignature: !!text(query.signature), hasMsgSignature: !!text(query.msg_signature),
        sigLen: provided.length, sigPrefix: provided.slice(0, 10),
        expectedPrefix: expected.slice(0, 10),
        timestamp, nonceLen: nonce.length
      }));
      throw fail(403, 'INVALID_NOTIFY_SIGNATURE', '消息推送验签失败');
    }
    console.log('[pay] notify URL verified', JSON.stringify({ echoLen: echostr.length }));
    return echostr;
  }

  async function refund({ outTradeNo, reason = 3 } = {}) {
    const current = settings();
    if (!ready()) throw fail(503, 'PAY_NOT_CONFIGURED', '虚拟支付尚未配置，请联系管理员');
    if (typeof outTradeNo !== 'string' || !ORDER_RE.test(outTradeNo)) throw fail(404, 'ORDER_NOT_FOUND', '订单不存在');
    if (!Number.isSafeInteger(reason) || reason < 0 || reason > 5) throw fail(400, 'INVALID_REFUND', '退款原因无效');
    const order = state().orders[outTradeNo];
    if (!order) throw fail(404, 'ORDER_NOT_FOUND', '订单不存在');
    if (order.refund?.refundOrderId) return { refundOrderId: order.refund.refundOrderId };
    if (order.status === 'refunded') throw fail(409, 'ALREADY_REFUNDED', '订单已退款');
    if (order.status !== 'delivered' && order.status !== 'paid') throw fail(400, 'ORDER_NOT_PAID', '订单尚未支付，无法退款');
    const openid = text(current.resolveOpenid(order.accountId));
    if (!openid) throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '订单用户身份已失效，请稍后重试');
    const queried = await xpayPost('/xpay/query_order', JSON.stringify({ openid, env: order.env, order_id: outTradeNo }), current);
    if ((Number(queried.errcode) || 0) !== 0 || !object(queried.order)) throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信订单查询失败，请稍后重试');
    const wxOrder = queried.order;
    const orderType = Number(wxOrder.order_type);
    if (orderType === 7 || orderType === 8) throw fail(400, 'IOS_REFUND_UNSUPPORTED', 'iOS 订单不支持主动退款，请引导用户通过 App Store 申请');
    const leftFee = Number(wxOrder.left_fee);
    if (!Number.isFinite(leftFee) || leftFee <= 0) throw fail(400, 'INVALID_REFUND', '订单没有可退款金额');
    const refundFee = Math.min(order.amount, leftFee);
    const refundOrderId = 'R' + now().toString(36).toUpperCase() + crypto.randomBytes(5).toString('hex');
    const body = JSON.stringify({
      openid, order_id: outTradeNo, refund_order_id: refundOrderId, left_fee: leftFee, refund_fee: refundFee,
      biz_meta: order.accountId, refund_reason: reason, req_from: 1, env: order.env
    });
    const result = await xpayPost('/xpay/refund_order', body, current);
    const errcode = Number(result.errcode) || 0;
    if (errcode !== 0) {
      console.error('[pay] refund_order rejected for', outTradeNo, 'code', errcode);
      throw fail(503, 'WECHAT_PAY_UNAVAILABLE', '微信退款服务暂时不可用，请稍后重试');
    }
    const returned = text(result.refund_order_id) || refundOrderId;
    commit(next => {
      const saved = next.orders[outTradeNo];
      if (saved && !saved.refund) saved.refund = { refundOrderId: returned, refundedAt: 0, amount: 0 };
    });
    console.log('[pay] refund requested for', outTradeNo);
    return { refundOrderId: returned };
  }

  function publicOrder(order) {
    return {
      outTradeNo: order.outTradeNo, productId: order.productId, days: order.days, amount: order.amount,
      status: order.status, createdAt: order.createdAt, deliveredAt: order.deliveredAt,
      refund: order.refund ? { refundOrderId: order.refund.refundOrderId, refundedAt: order.refund.refundedAt, amount: order.refund.amount } : null
    };
  }
  /**
   * 分页列出订单（新→旧）。since 只保留该时间点之后的订单（日期筛选）。
   * before 是上一页最后一条的游标 { createdAt, outTradeNo }：
   * 同一毫秒可能有多单，用 outTradeNo 兜底保证严格递减、不会重复/漏单。
   * 返回 { items, nextCursor }：nextCursor 为 null 表示没有更早的订单了。
   */
  function listOrders(limitValue = 50, before = null, sinceValue = 0) {
    const count = Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 50;
    const since = Number.isSafeInteger(sinceValue) && sinceValue > 0 ? sinceValue : 0;
    const sorted = Object.values(state().orders)
      .filter(order => !since || order.createdAt >= since)
      .sort((a, b) => (b.createdAt - a.createdAt) || (a.outTradeNo < b.outTradeNo ? 1 : a.outTradeNo > b.outTradeNo ? -1 : 0));
    let start = 0;
    if (before && Number.isFinite(Number(before.createdAt)) && before.outTradeNo) {
      const time = Number(before.createdAt);
      const id = String(before.outTradeNo);
      start = sorted.findIndex(order => order.createdAt < time || (order.createdAt === time && order.outTradeNo < id));
      if (start < 0) return { items: [], nextCursor: null };
    }
    const page = sorted.slice(start, start + count);
    const last = page[page.length - 1];
    const nextCursor = last && sorted.length > start + count ? { createdAt: last.createdAt, outTradeNo: last.outTradeNo } : null;
    return { items: page.map(publicOrder), nextCursor };
  }
  function summary() {
    const month = monthKey(now());
    const record = state().payGmv?.[month];
    return { month, cents: Number(record?.cents) || 0, count: Number(record?.count) || 0, limit: MONTH_LIMIT_CENTS, warnAt: WARN_AT_CENTS };
  }
  // 定时对账：关闭超时未支付单，并对 30 分钟仍未发货的订单查单补发（单批 50 单）。
  async function tick() {
    if (!ready()) return;
    const time = now();
    const stale = Object.values(state().orders).filter(order => order.status === 'created' && time - order.createdAt > ORDER_TTL_MS);
    if (stale.length) commit(next => {
      for (const order of stale) {
        const current = next.orders[order.outTradeNo];
        if (current && current.status === 'created') current.status = 'closed';
      }
    });
    // B: 除了未发货单，还要定期复查「已发货」单，通过 left_fee 发现退款并自动扣回天数。
    // 推送收不到时，这是退款闭环的唯一路径。
    const pending = Object.values(state().orders)
      .filter(order => ['created', 'paid', 'delivered'].includes(order.status) && time - (order.paidAt || order.createdAt) >= TICK_AGE_MS)
      .sort((a, b) => (a.paidAt || a.createdAt) - (b.paidAt || b.createdAt))
      .slice(0, TICK_BATCH);
    if (!pending.length) return;
    const openidFor = settings().resolveOpenid;
    const current = settings();
    for (const order of pending) {
      const openid = text(openidFor(order.accountId));
      if (!openid) continue;
      try {
        if (order.status === 'delivered') {
          const body = JSON.stringify({ openid, env: order.env, order_id: order.outTradeNo });
          const result = await xpayPost('/xpay/query_order', body, current);
          if ((Number(result.errcode) || 0) !== 0 || !object(result.order)) continue;
          const wx = result.order;
          const leftFee = Number(wx.left_fee);
          const status = Number(wx.status);
          // left_fee 归零 / 退款状态码 → 扣回已发放的天数（applyRefund 自身幂等）。
          if ((Number.isFinite(leftFee) && leftFee <= 0) || status === 5 || status === 8) {
            applyRefund(order.outTradeNo, { refundOrderId: text(wx.wx_order_id), amount: Number(wx.refund_fee) || order.amount });
            console.log('[pay] tick detected refund for', order.outTradeNo);
          } else if (status !== 4 || !Number(wx.provide_time)) {
            // 自愈：早于修复部署、或标记调用失败的订单，微信侧仍停在「发货中」→ 补标记。
            // 否则后台账单不显示该笔交易。
            await markWxProvided(order.outTradeNo, current);
          }
        } else {
          await reconcileOrder(order.outTradeNo, openid);
        }
      } catch (error) { console.error('[pay] tick query failed for', order.outTradeNo, error && error.message || 'UNKNOWN'); }
    }
  }

  return { ready, catalog, saveConfig, createOrder, queryOrder, notify, verifyUrl, refund, listOrders, summary, tick, inspectOrder };
}

module.exports = { createPayment, CODE_DAYS, validatePaymentState, normalizeTiers, MONTH_LIMIT_CENTS, WARN_AT_CENTS };
