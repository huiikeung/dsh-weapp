'use strict';
// 虚拟支付服务端测试：签名向量、开关/档位、下单、推送发货幂等、金额校验、
// 推送验签、URL 验证、查单兜底、退款扣回、月限额、v2→v3 迁移、AES/XML 推送。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService } = require('../server.cjs');

const DAY = 86400000;
const START = Date.parse('2026-11-03T02:00:00Z'); // 北京时间 2026-11，summary 月份固定
const OFFER_ID = '1450000000';
const APP_KEY = 'fixture-xpay-app-key';
const MSG_TOKEN = 'fixture-msg-token';
const AES_KEY = Buffer.alloc(32, 9).toString('base64').slice(0, 43);
const ADMIN_OPENID = 'fixture-pay-admin';
const PAY_OPENID = 'fixture-pay-user-openid';
const OTHER_OPENID = 'fixture-pay-other-openid';
const SESSION_KEY = 'fixture-session-key==';
const APP_ID = 'wx0123456789abcdef';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sha1 = value => crypto.createHash('sha1').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
function wechatOrder(outTradeNo, overrides = {}) {
  return {
    order_id: outTradeNo, status: 4, order_fee: 990, paid_fee: 990, left_fee: 990, order_type: 0,
    wx_order_id: 'WX-' + outTradeNo, channel_order_id: 'MCH-' + outTradeNo,
    wxpay_order_id: 'TX-' + outTradeNo, paid_time: Math.floor(START / 1000), ...overrides
  };
}
function seededState(overrides = {}) {
  return {
    version: 3, codes: {}, redemptions: {}, access: {}, huaweiDevices: {}, huaweiAdmins: {}, notificationTickets: {},
    payment: { enabled: true, tiers: [{ id: 'pub_30d', days: 30, price: 990 }], updatedAt: START },
    orders: {}, payGmv: {}, ...overrides
  };
}
const deliverPayload = (outTradeNo, overrides = {}) => ({
  ToUserName: 'gh_fixture', FromUserName: 'wx-official', CreateTime: 1790000001, MsgType: 'event',
  Event: 'xpay_goods_deliver_notify', OpenId: PAY_OPENID, OutTradeNo: outTradeNo, Env: 0,
  ...(overrides.event || {}),
  GoodsInfo: { ProductId: 'pub_30d', Quantity: 1, OrigPrice: 990, ActualPrice: 990, Attach: hash(PAY_OPENID), ...(overrides.goods || {}) },
  WeChatPayInfo: { MchOrderNo: 'MCH-' + outTradeNo, TransactionId: 'TX-' + outTradeNo, PaidTime: Math.floor(START / 1000), ...(overrides.wechatPay || {}) }
});
const refundPayload = (outTradeNo, overrides = {}) => ({
  ToUserName: 'gh_fixture', FromUserName: 'wx-official', CreateTime: 1790000002, MsgType: 'event',
  Event: 'xpay_refund_notify', OpenId: PAY_OPENID, MchOrderId: outTradeNo, WxRefundId: 'RW-1', MchRefundId: 'RM-1',
  WxOrderId: 'WX-' + outTradeNo, RefundFee: 990, RetCode: 0, ...overrides
});
function encryptMessage(message) {
  const key = Buffer.from(AES_KEY + '=', 'base64');
  const iv = key.subarray(0, 16);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(Buffer.byteLength(message));
  const raw = Buffer.concat([crypto.randomBytes(16), length, Buffer.from(message), Buffer.from(APP_ID)]);
  // 微信 PKCS#7 使用 32 字节块；pad 可能是 17..32，服务端不能按 16 上限拒绝。
  const pad = 32 - (raw.length % 32);
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pay-test-'));
  const stateFile = path.join(dir, 'state.json');
  if (options.seedState) fs.writeFileSync(stateFile, JSON.stringify(options.seedState));
  let clock = options.clock || START;
  const calls = [];
  const xpayFetch = async (url, init = {}) => {
    const href = String(url), requestBody = typeof init.body === 'string' ? init.body : '';
    calls.push({ url: href, body: requestBody, method: init.method || 'GET', headers: init.headers || {} });
    if (href.includes('/cgi-bin/stable_token')) {
      return jsonResponse(options.tokenResponse || { access_token: 'fixture-access-token', expires_in: 7200 });
    }
    if (href.includes('/xpay/query_order')) {
      const payload = JSON.parse(requestBody);
      if (options.xpayHandler) return options.xpayHandler(href, payload, calls);
      return jsonResponse({ errcode: 0, errmsg: 'ok', order: wechatOrder(payload.order_id) });
    }
    if (href.includes('/xpay/refund_order')) {
      const payload = JSON.parse(requestBody);
      return jsonResponse({ errcode: 0, errmsg: 'ok', refund_order_id: payload.refund_order_id });
    }
    return jsonResponse({ errcode: 0, errmsg: 'ok' });
  };
  const server = createService({
    stateFile, adminOpenIds: [ADMIN_OPENID], now: () => clock,
    exchangeCode: async code => ({ admin: ADMIN_OPENID, user: PAY_OPENID, other: OTHER_OPENID })[code],
    exchangeSession: options.exchangeSession || (async code => {
      if (code === 'pay-code') return { openid: PAY_OPENID, sessionKey: SESSION_KEY };
      if (code === 'other-code') return { openid: OTHER_OPENID, sessionKey: SESSION_KEY };
      throw Object.assign(new Error('微信登录已过期'), { status: 401, code: 'PAY_LOGIN_FAILED' });
    }),
    wechatAppId: options.wechatAppId === undefined ? APP_ID : options.wechatAppId,
    wechatAppSecret: options.wechatAppSecret === undefined ? 'f'.repeat(32) : options.wechatAppSecret,
    xpay: {
      offerId: OFFER_ID, appKey: APP_KEY, env: 0, msgToken: MSG_TOKEN, msgAesKey: AES_KEY,
      msgEncrypt: 'plaintext', ...(options.xpay || {})
    },
    xpayFetch
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function call(route, data, token) {
    const response = await fetch(base + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    const textBody = await response.text();
    let value = {};
    try { value = JSON.parse(textBody); } catch (error) { value = { raw: textBody }; }
    return { ...value, status: response.status, headers: response.headers };
  }
  async function raw(route, init = {}) {
    const response = await fetch(base + route, { method: init.method || 'GET', ...(init.body === undefined ? {} : { body: init.body }), headers: init.headers || {} });
    return { status: response.status, text: await response.text(), headers: response.headers };
  }
  async function login(code) { return call('/session', { code }); }
  function tick(ms) { clock += ms; }
  return { base, call, raw, login, tick, calls, stateFile, server };
}
async function readyFixture(t, options = {}) {
  const f = await fixture(t, options);
  const admin = await f.login('admin');
  const saved = await f.call('/admin/pay/config', { enabled: true, tiers: [{ days: 30, price: 990 }] }, admin.token);
  assert.equal(saved.status, 200, 'fixture payment config must save');
  const user = await f.login('user');
  return { ...f, admin, user, adminToken: admin.token, userToken: user.token };
}
async function createOrder(f) {
  const order = await f.call('/pay/order', { code: 'pay-code', tierId: 'pub_30d' }, f.userToken);
  assert.equal(order.status, 200, 'required order to proceed');
  return order;
}
function signedNotifyQuery(timestamp = '1700000000', nonce = 'fixture-nonce') {
  return 'signature=' + sha1([MSG_TOKEN, timestamp, nonce].sort().join('')) + '&timestamp=' + timestamp + '&nonce=' + nonce;
}
function notifyPlain(f, payload, headers = { 'Content-Type': 'application/json' }) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return f.raw('/pay/notify?' + signedNotifyQuery(), { method: 'POST', body, headers });
}
function notifyEncrypted(f, payload) {
  const message = JSON.stringify(payload);
  const encrypt = encryptMessage(message);
  const timestamp = '1700000000', nonce = 'fixture-nonce';
  const signature = sha1([MSG_TOKEN, timestamp, nonce, encrypt].sort().join(''));
  const query = 'msg_signature=' + signature + '&timestamp=' + timestamp + '&nonce=' + nonce + '&encrypt_type=aes';
  return f.raw('/pay/notify?' + query, { method: 'POST', body: JSON.stringify({ Encrypt: encrypt, ToUserName: 'gh_fixture' }), headers: { 'Content-Type': 'application/json' } });
}
const jsonBody = result => JSON.parse(result.text);
const readState = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('signData/paySig/signature follow the official virtual-payment algorithm', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  assert.equal(order.mode, 'short_series_goods');
  assert.equal(order.env, 0);
  assert.match(order.outTradeNo, /^P[0-9A-Z][0-9A-Za-z]{7,31}$/);
  assert.equal(order.attach, undefined);
  const expected = JSON.stringify({
    offerId: OFFER_ID, buyQuantity: 1, env: 0, currencyType: 'CNY',
    productId: 'pub_30d', goodsPrice: 990, outTradeNo: order.outTradeNo, attach: hash(PAY_OPENID)
  });
  assert.equal(order.signData, expected, 'signData key order must be fixed');
  assert.equal(order.paySig, hmac(APP_KEY, 'requestVirtualPayment&' + order.signData));
  assert.equal(order.signature, hmac(SESSION_KEY, order.signData));
  const persisted = readState(f.stateFile).orders[order.outTradeNo];
  assert.equal(persisted.status, 'created');
  assert.equal(persisted.accountId, hash(PAY_OPENID));
  assert.equal(persisted.amount, 990);
  assert.equal(persisted.env, 0);
  assert.equal(JSON.stringify(order).includes(APP_KEY), false);
  assert.equal(JSON.stringify(order).includes(SESSION_KEY), false);
});

test('payment switch off rejects orders, keeps tiers and hides the public card', async t => {
  const f = await readyFixture(t);
  const off = await f.call('/admin/pay/config', { enabled: false }, f.adminToken);
  assert.equal(off.status, 200);
  assert.equal(off.payment.enabled, false);
  assert.equal(off.payment.tiers.length, 1, 'closing the switch keeps tiers');
  const content = await f.call('/app-content');
  assert.equal(content.payment.enabled, false);
  assert.equal(content.payment.ready, true);
  assert.equal(content.payment.tiers.length, 1);
  const config = await f.call('/pay/config');
  assert.equal(config.status, 200);
  assert.equal(config.payment.enabled, false);
  const blocked = await f.call('/pay/order', { code: 'pay-code', tierId: 'pub_30d' }, f.userToken);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.code, 'PAY_DISABLED');
});

test('payment config validates days/price/duplicates and ignores client ids', async t => {
  const f = await readyFixture(t);
  const bad = [
    [{ days: 14, price: 990 }, 'INVALID_PAY_CONFIG'],
    [{ days: 30, price: 0 }, 'INVALID_PAY_CONFIG'],
    [{ days: 30, price: 1000001 }, 'INVALID_PAY_CONFIG'],
    [{ days: 30, price: 9.9 }, 'INVALID_PAY_CONFIG']
  ];
  for (const [tier, code] of bad) {
    const rejected = await f.call('/admin/pay/config', { enabled: true, tiers: [tier] }, f.adminToken);
    assert.equal(rejected.status, 400);
    assert.equal(rejected.code, code);
  }
  const duplicate = await f.call('/admin/pay/config', { enabled: true, tiers: [{ days: 30, price: 990 }, { days: 30, price: 1290 }] }, f.adminToken);
  assert.equal(duplicate.status, 400);
  const tooMany = Array.from({ length: 11 }, (_, i) => ({ days: [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650][i], price: 100 + i }));
  assert.equal((await f.call('/admin/pay/config', { enabled: true, tiers: tooMany }, f.adminToken)).status, 400);
  const saved = await f.call('/admin/pay/config', { enabled: true, tiers: [{ id: 'evil_id', days: 7, price: 190 }] }, f.adminToken);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.payment.tiers, [{ id: 'pub_7d', days: 7, price: 190 }]);
  const forbidden = await f.call('/admin/pay/config', { enabled: true, tiers: [] }, f.userToken);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.code, 'FORBIDDEN');
});

test('unconfigured payment reports ready=false and rejects orders with PAY_NOT_CONFIGURED', async t => {
  const f = await fixture(t, { wechatAppId: '', wechatAppSecret: '' });
  const admin = await f.login('admin');
  const saved = await f.call('/admin/pay/config', { enabled: true, tiers: [{ days: 30, price: 990 }] }, admin.token);
  assert.equal(saved.status, 200);
  assert.equal(saved.payment.ready, false);
  const user = await f.login('user');
  const rejected = await f.call('/pay/order', { code: 'pay-code', tierId: 'pub_30d' }, user.token);
  assert.equal(rejected.status, 503);
  assert.equal(rejected.code, 'PAY_NOT_CONFIGURED');
});

test('delivery push marks the order delivered and grants exactly once', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  const pushed = await notifyPlain(f, deliverPayload(order.outTradeNo));
  assert.equal(pushed.status, 200);
  assert.deepEqual(jsonBody(pushed), { ErrCode: 0, ErrMsg: 'success' });
  const queried = await f.call('/pay/query', { outTradeNo: order.outTradeNo }, f.userToken);
  assert.equal(queried.status, 200);
  assert.equal(queried.order.status, 'delivered');
  assert.equal(queried.order.days, 30);
  assert.equal(queried.order.amount, 990);
  assert.equal(queried.order.expiresAt, START + 30 * DAY);
  const me = await f.call('/me', undefined, f.userToken);
  assert.equal(me.account.publicAccessExpiresAt, START + 30 * DAY);
  const persisted = readState(f.stateFile);
  assert.equal(persisted.orders[order.outTradeNo].status, 'delivered');
  assert.equal(persisted.orders[order.outTradeNo].transactionId, 'TX-' + order.outTradeNo);
  assert.equal(persisted.orders[order.outTradeNo].mchOrderNo, 'MCH-' + order.outTradeNo);
  assert.deepEqual(persisted.payGmv['2026-11'], { cents: 990, count: 1 });
});

test('repeated delivery push is idempotent by outTradeNo/TransactionId', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  await notifyPlain(f, deliverPayload(order.outTradeNo));
  const before = readState(f.stateFile);
  const again = await notifyPlain(f, deliverPayload(order.outTradeNo));
  assert.deepEqual(jsonBody(again), { ErrCode: 0, ErrMsg: 'success' });
  const after = readState(f.stateFile);
  assert.deepEqual(after.access, before.access);
  assert.deepEqual(after.payGmv, before.payGmv);
  assert.equal(after.orders[order.outTradeNo].deliveredAt, before.orders[order.outTradeNo].deliveredAt);
  // Same TransactionId pushed against another local order must not grant twice.
  const second = await createOrder(f);
  const forged = deliverPayload(second.outTradeNo, { wechatPay: { TransactionId: 'TX-' + order.outTradeNo } });
  assert.deepEqual(jsonBody(await notifyPlain(f, forged)), { ErrCode: 0, ErrMsg: 'success' });
  const final = readState(f.stateFile);
  assert.equal(final.orders[second.outTradeNo].status, 'created');
  assert.deepEqual(final.payGmv['2026-11'], { cents: 990, count: 1 });
});

test('delivery push rejects mismatched amount/product/env or unknown order without writing', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  for (const payload of [
    deliverPayload(order.outTradeNo, { goods: { ActualPrice: 1 } }),
    deliverPayload(order.outTradeNo, { goods: { ProductId: 'pub_7d' } }),
    deliverPayload(order.outTradeNo, { event: { Env: 1 } }),
    deliverPayload('P0000000000000000')
  ]) {
    const result = jsonBody(await notifyPlain(f, payload));
    assert.notEqual(result.ErrCode, 0);
  }
  let state = readState(f.stateFile);
  assert.equal(state.orders[order.outTradeNo].status, 'created');
  assert.deepEqual(state.access, {});
  assert.deepEqual(state.payGmv, {});
  // A later correct push still delivers (rejected pushes must not poison the order).
  assert.equal(jsonBody(await notifyPlain(f, deliverPayload(order.outTradeNo))).ErrCode, 0);
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].status, 'delivered');
});

test('notify rejects bad signatures with 403 and never answers a delivery', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  const body = JSON.stringify(deliverPayload(order.outTradeNo));
  const badTimestamp = '1700000000', nonce = 'fixture-nonce';
  const wrong = '0'.repeat(40);
  const rejected = await f.raw('/pay/notify?signature=' + wrong + '&timestamp=' + badTimestamp + '&nonce=' + nonce,
    { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
  assert.equal(rejected.status, 403);
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].status, 'created');
  assert.equal(readState(f.stateFile).access[hash(PAY_OPENID)], undefined);
});

test('GET /pay/notify URL verification echoes echostr only with a valid signature', async t => {
  const f = await readyFixture(t);
  const timestamp = '1700000000', nonce = 'fixture-nonce';
  const signature = sha1([MSG_TOKEN, timestamp, nonce].sort().join(''));
  const ok = await f.raw('/pay/notify?signature=' + signature + '&timestamp=' + timestamp + '&nonce=' + nonce + '&echostr=echo-fixture');
  assert.equal(ok.status, 200);
  assert.equal(ok.text, 'echo-fixture');
  assert.match(ok.headers.get('content-type'), /text\/plain/);
  const bad = await f.raw('/pay/notify?signature=' + 'f'.repeat(40) + '&timestamp=' + timestamp + '&nonce=' + nonce + '&echostr=echo-fixture');
  assert.equal(bad.status, 403);
});

test('query fallback uses signed /xpay/query_order and delivers without a push', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  f.tick(16000);
  const queried = await f.call('/pay/query', { outTradeNo: order.outTradeNo }, f.userToken);
  assert.equal(queried.status, 200);
  assert.equal(queried.order.status, 'delivered');
  assert.equal(queried.order.expiresAt, START + 16000 + 30 * DAY);
  const tokenCall = f.calls.find(call => call.url.includes('/cgi-bin/stable_token'));
  assert.ok(tokenCall, 'access_token must be fetched through the injected fetch');
  assert.match(tokenCall.body, /"grant_type":"client_credential"/);
  const queryCall = f.calls.find(call => call.url.includes('/xpay/query_order'));
  assert.ok(queryCall, 'query_order must be called when the push is missing');
  assert.deepEqual(JSON.parse(queryCall.body), { openid: PAY_OPENID, env: 0, order_id: order.outTradeNo });
  const url = new URL(queryCall.url);
  assert.equal(url.searchParams.get('pay_sig'), hmac(APP_KEY, '/xpay/query_order&' + queryCall.body));
  assert.equal(url.searchParams.get('access_token'), 'fixture-access-token');
  const callsBefore = f.calls.filter(call => call.url.includes('/xpay/query_order')).length;
  const repeat = await f.call('/pay/query', { outTradeNo: order.outTradeNo }, f.userToken);
  assert.equal(repeat.order.status, 'delivered');
  assert.equal(f.calls.filter(call => call.url.includes('/xpay/query_order')).length, callsBefore, 'delivered orders should not be queried again');
});

test('pay query only returns the caller own order and falls back to local state on API errors', async t => {
  const f = await readyFixture(t, { xpayHandler: async () => jsonResponse({ errcode: -1, errmsg: 'system error' }) });
  const order = await createOrder(f);
  const other = await f.login('other');
  const forbidden = await f.call('/pay/query', { outTradeNo: order.outTradeNo }, other.token);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.code, 'FORBIDDEN');
  const missing = await f.call('/pay/query', { outTradeNo: 'P0000000000000000' }, f.userToken);
  assert.equal(missing.status, 404);
  assert.equal(missing.code, 'ORDER_NOT_FOUND');
  f.tick(16000);
  const fallback = await f.call('/pay/query', { outTradeNo: order.outTradeNo }, f.userToken);
  assert.equal(fallback.status, 200, 'query_order errors must not fail the local query');
  assert.equal(fallback.order.status, 'created');
});

test('refund push claws back exactly the purchased days and is idempotent', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  await notifyPlain(f, deliverPayload(order.outTradeNo));
  const deliveredExpiry = (await f.call('/me', undefined, f.userToken)).account.publicAccessExpiresAt;
  assert.equal(deliveredExpiry, START + 30 * DAY);
  const failed = jsonBody(await notifyPlain(f, refundPayload(order.outTradeNo, { RetCode: 1 })));
  assert.equal(failed.ErrCode, 0);
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].status, 'delivered');
  const refunded = await notifyPlain(f, refundPayload(order.outTradeNo));
  assert.deepEqual(jsonBody(refunded), { ErrCode: 0, ErrMsg: 'success' });
  let state = readState(f.stateFile);
  assert.equal(state.orders[order.outTradeNo].status, 'refunded');
  assert.equal(state.orders[order.outTradeNo].refund.refundOrderId, 'RM-1');
  assert.equal(state.orders[order.outTradeNo].refund.amount, 990);
  assert.equal((await f.call('/me', undefined, f.userToken)).account.publicAccessExpiresAt, START);
  const before = readState(f.stateFile);
  const repeats = await notifyPlain(f, refundPayload(order.outTradeNo));
  assert.deepEqual(jsonBody(repeats), { ErrCode: 0, ErrMsg: 'success' });
  state = readState(f.stateFile);
  assert.deepEqual(state.access, before.access);
  assert.deepEqual(state.payGmv, before.payGmv, 'refunds do not decrement the gross monthly GMV counter');
});

test('admin refund calls signed /xpay/refund_order for Android and refuses iOS orders', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  await notifyPlain(f, deliverPayload(order.outTradeNo));
  const listed = await f.call('/admin/pay/orders', { limit: 20 }, f.adminToken);
  assert.equal(listed.status, 200);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].outTradeNo, order.outTradeNo);
  assert.equal(listed.items[0].openid, undefined);
  assert.equal(listed.items[0].accountId, undefined);
  const refunded = await f.call('/admin/pay/refund', { outTradeNo: order.outTradeNo, reason: 3 }, f.adminToken);
  assert.equal(refunded.status, 200);
  assert.match(refunded.refundOrderId, /^R[0-9A-Z][0-9A-Za-z]{7,31}$/);
  const refundCall = f.calls.find(call => call.url.includes('/xpay/refund_order'));
  assert.ok(refundCall, 'refund_order must be called');
  const payload = JSON.parse(refundCall.body);
  assert.equal(payload.order_id, order.outTradeNo);
  assert.equal(payload.refund_order_id, refunded.refundOrderId);
  assert.equal(payload.left_fee, 990);
  assert.equal(payload.refund_fee, 990);
  assert.equal(payload.refund_reason, 3);
  assert.equal(payload.req_from, 1);
  assert.equal(payload.env, 0);
  assert.equal(new URL(refundCall.url).searchParams.get('pay_sig'), hmac(APP_KEY, '/xpay/refund_order&' + refundCall.body));
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].refund.refundOrderId, refunded.refundOrderId);

  const ios = await readyFixture(t, {
    xpayHandler: async (href, payload) => jsonResponse({ errcode: 0, errmsg: 'ok', order: wechatOrder(payload.order_id, { order_type: 7 }) })
  });
  const iosOrder = await createOrder(ios);
  await notifyPlain(ios, deliverPayload(iosOrder.outTradeNo));
  const rejected = await ios.call('/admin/pay/refund', { outTradeNo: iosOrder.outTradeNo }, ios.adminToken);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.code, 'IOS_REFUND_UNSUPPORTED');
});

test('pay order rejects a switched WeChat account and stays bound to the logged-in openid', async t => {
  const f = await readyFixture(t);
  const mismatch = await f.call('/pay/order', { code: 'other-code', tierId: 'pub_30d' }, f.userToken);
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.code, 'PAY_ACCOUNT_MISMATCH');
  assert.deepEqual(readState(f.stateFile).orders, {});
  const ok = await f.call('/pay/order', { code: 'pay-code', tierId: 'pub_30d' }, f.userToken);
  assert.equal(ok.status, 200);
  assert.equal(readState(f.stateFile).orders[ok.outTradeNo].accountId, hash(PAY_OPENID));
});

test('refund push finds the order by MchRefundId or WxTransactionId when MchOrderId is not usable', async t => {
  // Android：先走管理员退款拿到 refund_order_id，推送里只有 MchRefundId 能对上。
  const android = await readyFixture(t);
  const androidOrder = await createOrder(android);
  await notifyPlain(android, deliverPayload(androidOrder.outTradeNo));
  const started = await android.call('/admin/pay/refund', { outTradeNo: androidOrder.outTradeNo }, android.adminToken);
  assert.equal(started.status, 200);
  const pushed = await notifyPlain(android, refundPayload(androidOrder.outTradeNo, {
    MchOrderId: 'P0000000000000000', WxOrderId: '', MchRefundId: started.refundOrderId, WxTransactionId: ''
  }));
  assert.equal(jsonBody(pushed).ErrCode, 0);
  assert.equal(readState(android.stateFile).orders[androidOrder.outTradeNo].status, 'refunded');

  // iOS/其它渠道：推送可能只带原支付的 WxTransactionId。
  const ios = await readyFixture(t);
  const iosOrder = await createOrder(ios);
  await notifyPlain(ios, deliverPayload(iosOrder.outTradeNo));
  const byTransaction = await notifyPlain(ios, refundPayload(iosOrder.outTradeNo, {
    MchOrderId: 'P0000000000000000', WxOrderId: 'unknown', MchRefundId: 'RM-unknown', WxTransactionId: 'TX-' + iosOrder.outTradeNo
  }));
  assert.equal(jsonBody(byTransaction).ErrCode, 0);
  assert.equal(readState(ios.stateFile).orders[iosOrder.outTradeNo].status, 'refunded');
});

test('monthly GMV at the 10,000,000 cent limit rejects new orders and summary reports it', async t => {
  const f = await fixture(t, { seedState: seededState({ payGmv: { '2026-11': { cents: 10000000, count: 1000 } } }) });
  const admin = await f.login('admin');
  const user = await f.login('user');
  const rejected = await f.call('/pay/order', { code: 'pay-code', tierId: 'pub_30d' }, user.token);
  assert.equal(rejected.status, 429);
  assert.equal(rejected.code, 'MONTHLY_LIMIT_REACHED');
  assert.deepEqual(readState(f.stateFile).orders, {});
  const summary = await f.call('/admin/pay/summary', {}, admin.token);
  assert.equal(summary.status, 200);
  assert.equal(summary.month, '2026-11');
  assert.equal(summary.cents, 10000000);
  assert.equal(summary.count, 1000);
  assert.equal(summary.limit, 10000000);
  assert.equal(summary.warnAt, 9500000);
});

test('saved payment config survives a service restart (re-entering the admin page)', async t => {
  const f = await readyFixture(t);
  const saved = await f.call('/admin/pay/config', { enabled: true, tiers: [{ days: 7, price: 190 }, { days: 30, price: 990 }] }, f.adminToken);
  assert.equal(saved.status, 200);

  // 模拟「返回再进」最狠的情况：进程重启后配置仍在，且 app-content 能读到。
  const restarted = createService({
    stateFile: f.stateFile, adminOpenIds: [ADMIN_OPENID], now: () => START,
    exchangeCode: async () => PAY_OPENID,
    xpay: { offerId: OFFER_ID, appKey: APP_KEY, msgToken: MSG_TOKEN, msgAesKey: AES_KEY },
    xpayFetch: async () => jsonResponse({})
  });
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  t.after(async () => { restarted.closeAllConnections(); await new Promise(resolve => restarted.close(resolve)); });
  const base = 'http://127.0.0.1:' + restarted.address().port;
  const content = await (await fetch(base + '/app-content')).json();
  assert.equal(content.payment.enabled, true);
  assert.deepEqual(content.payment.tiers, [{ id: 'pub_7d', days: 7, price: 190 }, { id: 'pub_30d', days: 30, price: 990 }]);
});

test('state file migrates v2 → v3 while preserving legacy accounts', async t => {
  const legacy = { version: 2, codes: {}, redemptions: {}, access: { [hash(PAY_OPENID)]: { expiresAt: START + DAY } }, huaweiDevices: {}, huaweiAdmins: {}, notificationTickets: {} };
  const f = await fixture(t, { seedState: legacy });
  const content = await f.call('/app-content');
  assert.deepEqual(content.payment, { enabled: false, ready: true, tiers: [] });
  const user = await f.login('user');
  assert.equal((await f.call('/me', undefined, user.token)).account.publicAccessExpiresAt, START + DAY);
  const state = readState(f.stateFile);
  assert.equal(state.version, 3);
  assert.deepEqual(state.payment, { enabled: false, tiers: [], updatedAt: 0 });
  assert.deepEqual(state.orders, {});
  assert.deepEqual(state.payGmv, {});
  assert.equal(state.access[hash(PAY_OPENID)].expiresAt, START + DAY);
});

test('dirty payment/order state refuses to start instead of resetting', async t => {
  for (const seed of [
    seededState({ payment: { enabled: 'yes', tiers: [], updatedAt: 0 } }),
    seededState({ payment: { enabled: true, tiers: [{ id: 'pub_30d', days: 30, price: 0 }], updatedAt: 0 } }),
    seededState({ orders: { P1234567890abcdef: { outTradeNo: 'P1234567890abcdef', accountId: hash(PAY_OPENID), productId: 'pub_30d', days: 30, amount: 990, env: 2, status: 'created', createdAt: 0, paidAt: 0, deliveredAt: 0, wxOrderId: '', mchOrderNo: '', transactionId: '', attach: '', refund: null } } }),
    seededState({ payGmv: { '2026-13': { cents: 0, count: 0 } } })
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pay-bad-'));
    const stateFile = path.join(dir, 'state.json');
    fs.writeFileSync(stateFile, JSON.stringify(seed));
    try {
      assert.throws(() => createService({ stateFile, adminOpenIds: [ADMIN_OPENID], exchangeCode: async () => ADMIN_OPENID, xpay: { offerId: OFFER_ID, appKey: APP_KEY }, xpayFetch: async () => jsonResponse({}) }), /refusing to reset/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('AES-256-CBC encrypted push decrypts WXBizMsgCrypt payload and delivers once', async t => {
  const f = await readyFixture(t, { xpay: { msgEncrypt: 'aes' } });
  const order = await createOrder(f);
  const result = await notifyEncrypted(f, deliverPayload(order.outTradeNo));
  assert.equal(result.status, 200);
  assert.deepEqual(jsonBody(result), { ErrCode: 0, ErrMsg: 'success' });
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].status, 'delivered');
  const tampered = await f.raw('/pay/notify?msg_signature=' + 'a'.repeat(40) + '&timestamp=1700000000&nonce=fixture-nonce&encrypt_type=aes',
    { method: 'POST', body: JSON.stringify({ Encrypt: encryptMessage(JSON.stringify(deliverPayload(order.outTradeNo))) }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(tampered.status, 403);
});

test('AES push with PKCS#7 pad above 16 still decrypts (WeChat pads to 32-byte blocks)', async t => {
  const f = await readyFixture(t, { xpay: { msgEncrypt: 'aes' } });
  const order = await createOrder(f);
  let message = JSON.stringify(deliverPayload(order.outTradeNo));
  // 让明文总长（16 随机 + 4 长度 + msg + appid）≡ 1 (mod 32)，此时 PKCS#7 pad = 31 > 16。
  while ((16 + 4 + Buffer.byteLength(message) + APP_ID.length) % 32 !== 1) message += ' ';
  assert.equal(32 - ((16 + 4 + Buffer.byteLength(message) + APP_ID.length) % 32), 31);
  const encrypt = encryptMessage(message);
  const timestamp = '1700000000', nonce = 'fixture-nonce';
  const signature = sha1([MSG_TOKEN, timestamp, nonce, encrypt].sort().join(''));
  const result = await f.raw('/pay/notify?msg_signature=' + signature + '&timestamp=' + timestamp + '&nonce=' + nonce + '&encrypt_type=aes',
    { method: 'POST', body: JSON.stringify({ Encrypt: encrypt, ToUserName: 'gh_fixture' }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(result.status, 200);
  assert.deepEqual(jsonBody(result), { ErrCode: 0, ErrMsg: 'success' });
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].status, 'delivered');
});

test('XML push is parsed and answered with the mirrored XML ErrCode body', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  const payload = deliverPayload(order.outTradeNo, { wechatPay: { MchOrderNo: 'MCH-XML', TransactionId: 'TX-XML' } });
  const xml = '<xml>' +
    '<ToUserName><![CDATA[gh_fixture]]></ToUserName>' +
    '<Event><![CDATA[xpay_goods_deliver_notify]]></Event>' +
    '<OutTradeNo><![CDATA[' + order.outTradeNo + ']]></OutTradeNo>' +
    '<Env>0</Env>' +
    '<OpenId><![CDATA[' + PAY_OPENID + ']]></OpenId>' +
    '<GoodsInfo><ProductId><![CDATA[pub_30d]]></ProductId><Quantity>1</Quantity><OrigPrice>990</OrigPrice><ActualPrice>990</ActualPrice><Attach><![CDATA[' + hash(PAY_OPENID) + ']]></Attach></GoodsInfo>' +
    '<WeChatPayInfo><MchOrderNo><![CDATA[MCH-XML]]></MchOrderNo><TransactionId><![CDATA[TX-XML]]></TransactionId><PaidTime>1790000001</PaidTime></WeChatPayInfo>' +
    '</xml>';
  const result = await notifyPlain(f, xml, { 'Content-Type': 'application/xml' });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('content-type'), /application\/xml/);
  assert.equal(result.text, '<xml><ErrCode>0</ErrCode><ErrMsg>success</ErrMsg></xml>');
  const state = readState(f.stateFile);
  assert.equal(state.orders[order.outTradeNo].status, 'delivered');
  assert.equal(state.orders[order.outTradeNo].transactionId, 'TX-XML');
  assert.ok(payload);
});

test('orders are per-account and repeated pending orders are bounded', async t => {
  const f = await readyFixture(t);
  const other = await f.login('other');
  const mine = await createOrder(f);
  const otherOrder = await f.call('/pay/order', { code: 'other-code', tierId: 'pub_30d' }, other.token);
  assert.equal(otherOrder.status, 200);
  assert.notEqual(otherOrder.outTradeNo, mine.outTradeNo);
  const forbidden = await f.call('/pay/query', { outTradeNo: mine.outTradeNo }, other.token);
  assert.equal(forbidden.status, 403);
  const state = readState(f.stateFile);
  assert.equal(Object.keys(state.orders).length, 2);
  assert.equal(state.orders[mine.outTradeNo].accountId, hash(PAY_OPENID));
  assert.equal(state.orders[otherOrder.outTradeNo].accountId, hash(OTHER_OPENID));
  for (let index = 0; index < 9; index++) {
    const extra = await f.call('/pay/order', { code: 'pay-code', tierId: 'pub_30d' }, f.userToken);
    assert.equal(extra.status, 200);
  }
  const pending = Object.values(readState(f.stateFile).orders).filter(order => order.accountId === hash(PAY_OPENID) && order.status === 'created');
  assert.equal(pending.length, 10, 'each account keeps at most 10 unpaid orders');
});


test('A: query fallback marks the WeChat order provided via notify_provide_goods', async t => {
  // 真实兜底场景：微信侧订单 status=3（发货中，provide_time=0）。
  const f = await readyFixture(t, { xpayHandler: async (href, payload) => jsonResponse({ errcode: 0, errmsg: 'ok', order: wechatOrder(payload.order_id, { status: 3 }) }) });
  const order = await createOrder(f);
  f.tick(16000);
  await f.call('/pay/query', { outTradeNo: order.outTradeNo }, f.userToken);
  const provideCall = f.calls.find(c => c.url.includes('/xpay/notify_provide_goods'));
  assert.ok(provideCall, 'notify_provide_goods must be called when push is missing');
  assert.deepEqual(JSON.parse(provideCall.body), { order_id: order.outTradeNo, env: 0 });
});

test('B: periodic reconciliation detects refunds via left_fee and claws back days', async t => {
  // 构造一个「已发货 + 微信侧已退款」的 fixture，手动触发一次对账。
  const g = await readyFixture(t, { xpayHandler: async (href, payload) => jsonResponse({ errcode: 0, errmsg: 'ok', order: wechatOrder(payload.order_id, { left_fee: 0, status: 8, refund_fee: 990 }) }) });
  const gOrder = await createOrder(g);
  await notifyPlain(g, deliverPayload(gOrder.outTradeNo));
  const before = (await g.call('/me', undefined, g.userToken)).account.publicAccessExpiresAt;
  assert.ok(before > START, 'delivery must have granted days');
  g.tick(31 * 60000);
  await g.server.payTick();
  const state = readState(g.stateFile);
  assert.equal(state.orders[gOrder.outTradeNo].status, 'refunded');
  const after = (await g.call('/me', undefined, g.userToken)).account.publicAccessExpiresAt;
  assert.ok(after < before, 'granted days must be clawed back after refund');
});

test('C: admin inspect returns WeChat-side state and syncs a refund', async t => {
  const f = await readyFixture(t);
  const order = await createOrder(f);
  await notifyPlain(f, deliverPayload(order.outTradeNo));
  const inspected = await f.call('/admin/pay/inspect', { outTradeNo: order.outTradeNo }, f.adminToken);
  assert.equal(inspected.status, 200);
  assert.equal(inspected.wechat.paidFee, 990);
  assert.equal(inspected.wechat.orderType, 0);
  assert.equal(inspected.wechat.wxOrderId, 'WX-' + order.outTradeNo);
  // 无权用户不能调用
  const forbidden = await f.call('/admin/pay/inspect', { outTradeNo: order.outTradeNo }, f.userToken);
  assert.equal(forbidden.status, 403);
});



test('tick self-heals a delivered order whose WeChat side is still shipping', async t => {
  // 场景：订单在修复部署前已发货，微信侧仍 status=3 / 无 provide_time。
  const f = await readyFixture(t, {
    xpayHandler: async (href, payload) => jsonResponse({
      errcode: 0, errmsg: 'ok',
      order: wechatOrder(payload.order_id, { status: 3, provide_time: undefined })
    })
  });
  const order = await createOrder(f);
  await notifyPlain(f, deliverPayload(order.outTradeNo));
  f.tick(31 * 60000);
  await f.server.payTick();
  const provideCall = f.calls.find(c => c.url.includes('/xpay/notify_provide_goods'));
  assert.ok(provideCall, 'tick must re-mark a delivered order that WeChat still sees as shipping');
  assert.deepEqual(JSON.parse(provideCall.body), { order_id: order.outTradeNo, env: 0 });
  // 本地订单保持 delivered（自愈只补微信侧标记，不重复发货）
  assert.equal(readState(f.stateFile).orders[order.outTradeNo].status, 'delivered');
});



test('admin inspect self-heals a delivered order still shipping on the WeChat side', async t => {
  const f = await readyFixture(t, {
    xpayHandler: async (href, payload) => jsonResponse({
      errcode: 0, errmsg: 'ok',
      order: wechatOrder(payload.order_id, { status: 3, provide_time: undefined })
    })
  });
  const order = await createOrder(f);
  await notifyPlain(f, deliverPayload(order.outTradeNo));
  const inspected = await f.call('/admin/pay/inspect', { outTradeNo: order.outTradeNo }, f.adminToken);
  assert.equal(inspected.status, 200);
  assert.equal(inspected.wechat.markedProvided, true);
  assert.equal(inspected.wechat.status, 4);
  const provideCall = f.calls.find(c => c.url.includes('/xpay/notify_provide_goods'));
  assert.ok(provideCall, 'inspect must re-mark the WeChat order when it is still shipping');
  assert.deepEqual(JSON.parse(provideCall.body), { order_id: order.outTradeNo, env: 0 });
});


test('order list paginates with a stable cursor and never repeats or drops orders', async t => {
  const orders = {};
  for (let i = 0; i < 45; i += 1) {
    // 每 3 单共用同一毫秒：游标必须用 outTradeNo 兜底才能不重不漏
    const createdAt = START - Math.floor(i / 3) * 60000;
    const id = 'P2026pay' + String(1000 + i);
    orders[id] = {
      outTradeNo: id, accountId: hash('pay-user-' + i), productId: 'pub_30d', days: 30,
      amount: 990, env: 0, status: 'delivered', createdAt, paidAt: createdAt, deliveredAt: createdAt,
      wxOrderId: 'WX-' + i, mchOrderNo: 'MCH-' + i, transactionId: 'TX-' + i, attach: hash('attach-' + i), refund: null
    };
  }
  const f = await readyFixture(t, { seedState: seededState({ orders }) });
  const first = await f.call('/admin/pay/orders', { limit: 20 }, f.adminToken);
  assert.equal(first.status, 200);
  assert.equal(first.items.length, 20, 'first page is capped by limit');
  assert.ok(first.nextCursor && first.nextCursor.outTradeNo, 'a cursor points at the next page');
  const seen = new Set(first.items.map(order => order.outTradeNo));
  let cursor = first.nextCursor, pages = 1;
  while (cursor) {
    const page = await f.call('/admin/pay/orders', { limit: 20, before: cursor }, f.adminToken);
    assert.equal(page.status, 200);
    for (const order of page.items) {
      assert.ok(!seen.has(order.outTradeNo), 'cursor must not repeat ' + order.outTradeNo);
      seen.add(order.outTradeNo);
    }
    pages += 1;
    cursor = page.nextCursor;
  }
  assert.equal(pages, 3, '45 orders need three pages of 20');
  assert.equal(seen.size, 45, 'every order is returned exactly once');
  const stale = await f.call('/admin/pay/orders', { limit: 20, before: { createdAt: 1, outTradeNo: 'P0000' } }, f.adminToken);
  assert.equal(stale.status, 200);
  assert.deepEqual(stale.items, [], 'a cursor older than every order returns an empty page');
});

test('order list filters by since before paginating', async t => {
  const orders = {};
  for (let i = 0; i < 10; i += 1) {
    const createdAt = START - i * DAY;
    const id = 'P2026since' + String(1000 + i);
    orders[id] = {
      outTradeNo: id, accountId: hash('since-user-' + i), productId: 'pub_30d', days: 30,
      amount: 990, env: 0, status: 'delivered', createdAt, paidAt: createdAt, deliveredAt: createdAt,
      wxOrderId: 'WX-S' + i, mchOrderNo: 'MCH-S' + i, transactionId: 'TX-S' + i, attach: hash('since-attach-' + i), refund: null
    };
  }
  const f = await readyFixture(t, { seedState: seededState({ orders }) });
  const all = await f.call('/admin/pay/orders', { limit: 20 }, f.adminToken);
  assert.equal(all.items.length, 10, 'without since every order is listed');
  const recent = await f.call('/admin/pay/orders', { limit: 20, since: START - 3 * DAY + 1 }, f.adminToken);
  assert.equal(recent.items.length, 3, 'since keeps only orders at or after the timestamp');
  assert.equal(recent.items[0].outTradeNo, 'P2026since1000', 'newest first');
  assert.equal(recent.nextCursor, null, 'a filtered page that fits is also the last page');
  const paged = await f.call('/admin/pay/orders', { limit: 2, since: START - 3 * DAY + 1 }, f.adminToken);
  assert.equal(paged.items.length, 2);
  assert.ok(paged.nextCursor, 'filtering still paginates');
  const second = await f.call('/admin/pay/orders', { limit: 2, before: paged.nextCursor, since: START - 3 * DAY + 1 }, f.adminToken);
  assert.equal(second.items.length, 1, 'cursor and since combine');
  assert.equal(second.items[0].outTradeNo, 'P2026since1002');
});
