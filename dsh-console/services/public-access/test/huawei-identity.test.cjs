'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService, exchangeWithHuawei } = require('../server.cjs');

const CLIENT_ID = '1234567890';
const CLIENT_SECRET = 'fixture-client-secret';
const TOKEN_URL = 'https://oauth-login.cloud.huawei.com/oauth2/v3/token';
const INFO_URL = 'https://oauth-api.cloud.huawei.com/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo';
const INTERNAL = 'fixture-relay-internal-secret-00000000000';
const ORIGIN = 'http://127.0.0.1:8790';
const NODE = 'fixture-node-0001', DEVICE = 'fixture-device-0001';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const token = () => json({ token_type: 'Bearer', access_token: 'fixture-access-token' });
const info = (changes = {}) => json({ type: 0, client_id: CLIENT_ID, expire_in: 3600, open_id: 'fixture-openid', ...changes });

function mockHuawei(identities = {}) {
  const calls = [];
  const seen = new Set();
  const fetch = async (url, options) => {
    const form = new URLSearchParams(options.body);
    calls.push({ url, options, form });
    if (url === TOKEN_URL) {
      const code = form.get('code');
      if (seen.has(code)) return json({ error: 1103 }, 400);
      seen.add(code);
      return json({ token_type: 'Bearer', access_token: 'token:' + code });
    }
    if (url === INFO_URL) {
      const code = String(form.get('access_token')).slice('token:'.length);
      return info({ open_id: identities[code] || code });
    }
    throw new Error('Unexpected external endpoint');
  };
  return { fetch, calls };
}

async function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dsh-huawei-test-'));
  const provider = mockHuawei(extra.identities || {});
  const options = {
    stateFile: path.join(dir, 'state.json'), relayAuthSecret: INTERNAL,
    adminOpenIds: ['wechat-admin'], exchangeCode: async code => code,
    huaweiClientId: CLIENT_ID, huaweiClientSecret: CLIENT_SECRET,
    huaweiAdminOpenIds: [], huaweiFetch: provider.fetch,
    ...extra
  };
  delete options.identities;
  let server, base, cookie = '', csrf = '';
  async function start() {
    server = createService(options);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function stop() {
    if (!server || !server.listening) return;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await start();
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function call(route, body, credential) {
    const web = route.startsWith('/console/api/');
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN,
        ...(web ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
        ...(credential ? { Authorization: 'Bearer ' + credential } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (web && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const value = await response.json();
    if (web && value.csrf) csrf = value.csrf;
    return { ...value, status: response.status };
  }
  return { call, options, provider, dir, restart: async () => { await stop(); await start(); } };
}

test('OAuth exchange uses official HTTPS POST endpoints and validates token info', async () => {
  const provider = mockHuawei({ 'code+/=': 'subject-from-huawei' });
  const subject = await exchangeWithHuawei(CLIENT_ID, CLIENT_SECRET, provider.fetch)('code+/=');
  assert.equal(subject, 'subject-from-huawei');
  assert.equal(provider.calls.length, 2);
  const [first, second] = provider.calls;
  assert.equal(first.url, TOKEN_URL);
  assert.equal(second.url, INFO_URL);
  for (const call of provider.calls) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  assert.equal(first.form.get('grant_type'), 'authorization_code');
  assert.equal(first.form.get('code'), 'code+/=');
  assert.equal(first.form.get('client_id'), CLIENT_ID);
  assert.equal(first.form.get('client_secret'), CLIENT_SECRET);
  assert.equal(second.form.get('access_token'), 'token:code+/=');
  assert.equal(second.form.get('open_id'), 'OPENID');
  assert.equal(second.form.has('client_secret'), false);
  assert.equal(second.form.has('code'), false);
});

test('OAuth failures, redirects, wrong token type, client, expiry and OpenID fail closed', async () => {
  const cases = [
    ['token HTTP error', () => json({ error: 1 }, 400), () => info()],
    ['token redirect', () => json({}, 302, { Location: 'https://evil.example' }), () => info()],
    ['token redirected response', () => ({ status: 200, ok: true, redirected: true, headers: new Headers(), json: async () => ({ token_type: 'Bearer', access_token: 'a' }) }), () => info()],
    ['missing token', () => json({ token_type: 'Bearer' }), () => info()],
    ['wrong token type', () => json({ token_type: 'other', access_token: 'a' }), () => info()],
    ['info HTTP error', token, () => json({}, 403)],
    ['info redirect', token, () => json({}, 302, { Location: 'https://evil.example' })],
    ['info NSP_STATUS error on HTTP 200', token, () => json({ type: 0, client_id: CLIENT_ID, expire_in: 30, open_id: 'x' }, 200, { NSP_STATUS: '102' })],
    ['info error body', token, () => json({ error: 'invalid session', type: 0, client_id: CLIENT_ID, expire_in: 30, open_id: 'x' })],
    ['application token', token, () => info({ type: 1 })],
    ['string token type', token, () => info({ type: '0' })],
    ['other client', token, () => info({ client_id: '999' })],
    ['expired token', token, () => info({ expire_in: 0 })],
    ['invalid expiry', token, () => info({ expire_in: '3600' })],
    ['missing OpenID', token, () => info({ open_id: '' })],
    ['oversized OpenID', token, () => info({ open_id: 'x'.repeat(257) })],
    ['control character OpenID', token, () => info({ open_id: 'bad\u0000id' })]
  ];
  for (const [name, tokenResponse, infoResponse] of cases) {
    let calls = 0;
    const fake = async () => (++calls === 1 ? tokenResponse() : infoResponse());
    await assert.rejects(exchangeWithHuawei(CLIENT_ID, CLIENT_SECRET, fake)('once'), error => {
      assert.equal(error.status, 401, name);
      assert.equal(error.code, 'HUAWEI_LOGIN_FAILED', name);
      assert.equal(error.message.includes(CLIENT_SECRET), false, name);
      return true;
    });
  }
});

test('network failures, malformed JSON and actual abort timeouts do not expose secrets', async () => {
  const invalidJson = async () => new Response('{', { status: 200 });
  await assert.rejects(exchangeWithHuawei(CLIENT_ID, CLIENT_SECRET, invalidJson)('code'), { status: 503, code: 'HUAWEI_UNAVAILABLE' });
  const networkError = async () => { throw new Error('secret=' + CLIENT_SECRET); };
  await assert.rejects(exchangeWithHuawei(CLIENT_ID, CLIENT_SECRET, networkError)('code'), error =>
    error.status === 503 && error.code === 'HUAWEI_UNAVAILABLE' && !error.message.includes(CLIENT_SECRET));
  const timeout = async (_url, options) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(() => reject(new Error('abort signal did not fire')), 1000);
    options.signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(options.signal.reason); }, { once: true });
  });
  await assert.rejects(exchangeWithHuawei(CLIENT_ID, CLIENT_SECRET, timeout, 10)('code'), { status: 503, code: 'HUAWEI_UNAVAILABLE' });
});

test('missing or malformed Huawei configuration is unavailable without a provider call', async t => {
  for (const extra of [{ huaweiClientId: '' }, { huaweiClientSecret: '' }, { huaweiClientId: 'invalid' }]) {
    const f = await fixture(t, extra);
    const result = await f.call('/session/huawei', { code: 'code', isAdmin: true });
    assert.equal(result.status, 503);
    assert.equal(result.code, 'HUAWEI_NOT_CONFIGURED');
    assert.equal(f.provider.calls.length, 0);
  }
});

test('server-derived identities isolate admin, device, redemption, lease and restart state', async t => {
  const sent = [];
  const f = await fixture(t, {
    adminOpenIds: ['wechat-admin', 'shared-admin'], huaweiAdminOpenIds: ['huawei-admin'],
    identities: { 'hw-shared': 'shared-user', 'hw-shared-again': 'shared-user', 'hw-admin-test': 'shared-admin', 'hw-admin': 'huawei-admin' },
    exchangeCode: async code => ({ 'wx-user': 'shared-user', 'wx-admin-test': 'shared-admin', 'wx-huawei-admin': 'huawei-admin' }[code] || code),
    sendNotification: async (openid, context) => sent.push({ openid, context })
  });
  const wxAdmin = await f.call('/session', { code: 'wechat-admin' });
  const wxUser = await f.call('/session', { code: 'wx-user' });
  const wxSameAdmin = await f.call('/session', { code: 'wx-admin-test' });
  const wxSameHuaweiAdmin = await f.call('/session', { code: 'wx-huawei-admin' });
  const hwUser = await f.call('/session/huawei', { code: 'hw-shared', openid: 'huawei-admin', isAdmin: true, provider: 'wechat' });
  const hwSameAdmin = await f.call('/session/huawei', { code: 'hw-admin-test', isAdmin: true });
  const hwAdmin = await f.call('/session/huawei', { code: 'hw-admin' });
  assert.equal(hwUser.status, 201);
  assert.match(hwUser.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hwUser.account.isAdmin, false);
  assert.equal(wxSameAdmin.account.isAdmin, true);
  assert.equal(hwSameAdmin.account.isAdmin, false);
  assert.equal(hwAdmin.account.isAdmin, true);
  assert.equal(wxSameHuaweiAdmin.account.isAdmin, false);
  assert.match(wxUser.account.deviceId, /^WX-[A-F0-9]{24}$/);
  assert.match(hwUser.account.deviceId, /^HW-[A-F0-9]{24}$/);
  assert.notEqual(wxUser.account.deviceId, hwUser.account.deviceId);
  assert.equal((await f.call('/admin/codes', undefined, hwSameAdmin.token)).status, 403);
  assert.equal((await f.call('/admin/codes', undefined, hwAdmin.token)).status, 200);
  const voucher = await f.call('/admin/codes', { days: 1, uses: 5 }, wxAdmin.token);
  assert.equal(voucher.status, 201);
  assert.equal((await f.call('/redemptions', { code: voucher.code }, wxUser.token)).alreadyRedeemed, false);
  assert.equal((await f.call('/me', undefined, hwUser.token)).account.publicAccess, false);
  assert.equal((await f.call('/redemptions', { code: voucher.code }, hwUser.token)).alreadyRedeemed, false);
  assert.equal((await f.call('/redemptions', { code: voucher.code }, hwUser.token)).alreadyRedeemed, true);
  const saved = JSON.parse(fs.readFileSync(f.options.stateFile, 'utf8'));
  const wxId = sha('shared-user'), hwId = 'huawei:' + wxId;
  assert.ok(saved.access[wxId]);
  assert.ok(saved.access[hwId]);
  assert.equal(saved.huaweiDevices[hwId], hwUser.account.deviceId);
  assert.equal(Object.values(saved.redemptions).filter(item => item.accountId === wxId || item.accountId === hwId).length, 2);
  const wxLease = await f.call('/public-access/lease', { nodeId: NODE, deviceId: DEVICE }, wxUser.token);
  const hwLease = await f.call('/public-access/lease', { nodeId: NODE, deviceId: DEVICE }, hwUser.token);
  assert.equal(wxLease.status, 201);
  assert.equal(hwLease.status, 201);
  const authorize = tokenValue => f.call('/internal/relay/authorize', { token: tokenValue, nodeId: NODE, deviceId: DEVICE }, INTERNAL);
  assert.equal((await authorize(wxLease.token)).accountId, wxId);
  assert.equal((await authorize(hwLease.token)).accountId, hwId);
  assert.equal((await f.call('/notifications/tickets', {}, hwUser.token)).code, 'HUAWEI_NOTIFICATION_UNAVAILABLE');
  assert.equal((await f.call('/share', undefined, hwUser.token)).code, 'HUAWEI_SHARE_UNAVAILABLE');
  const notice = await f.call('/notifications/tickets', {}, wxUser.token);
  assert.equal(notice.status, 201);
  assert.equal((await f.call('/notifications/complete', { ticket: notice.ticket, sessionId: 's1', status: 'completed' })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].openid, 'shared-user');
  assert.equal((await f.call('/session/huawei', { code: 'hw-shared' })).code, 'HUAWEI_LOGIN_FAILED');
  await f.restart();
  assert.equal((await authorize(wxLease.token)).accountId, wxId);
  assert.equal((await authorize(hwLease.token)).accountId, hwId);
  const after = await f.call('/session/huawei', { code: 'hw-shared-again' });
  assert.equal(after.status, 201);
  assert.equal(after.account.deviceId, hwUser.account.deviceId);
  assert.equal(after.account.publicAccess, true);
  assert.equal(JSON.stringify(after).includes(CLIENT_SECRET), false);
});

test('Huawei login never invokes the WeChat code exchanger', async t => {
  let wechatCalls = 0;
  const f = await fixture(t, { exchangeCode: async () => { wechatCalls++; return 'wechat-admin'; },
    identities: { 'huawei-code': 'huawei-subject' } });
  const result = await f.call('/session/huawei', { code: 'huawei-code', isAdmin: true, openid: 'wechat-admin' });
  assert.equal(result.status, 201);
  assert.equal(result.account.isAdmin, false);
  assert.equal(wechatCalls, 0);
  assert.equal(f.provider.calls.length, 2);
});

test('WeChat console binding cannot grant Huawei administrator rights', async t => {
  const subject = 'same-verified-subject';
  const f = await fixture(t, {
    adminOpenIds: [], exchangeCode: async () => subject,
    identities: { 'hw-one': subject, 'hw-two': subject },
    consoleOptions: { origin: ORIGIN, masterKey: 'ab'.repeat(32), setupToken: 'fixture-setup-token-with-32-characters' }
  });
  assert.equal((await f.call('/console/api/setup', { setupToken: f.options.consoleOptions.setupToken, password: 'fixture-password-123' })).status, 200);
  const binding = await f.call('/console/api/bindings', { label: 'operator' });
  const hw = await f.call('/session/huawei', { code: 'hw-one', isAdmin: true });
  assert.equal((await f.call('/admin-binding/claim', { code: binding.code }, hw.token)).code, 'HUAWEI_BINDING_UNAVAILABLE');
  assert.equal((await f.call('/console/api/bindings/approve', { id: binding.id })).status, 409);
  const wx = await f.call('/session', { code: 'wx-one' });
  assert.equal((await f.call('/admin-binding/claim', { code: binding.code }, wx.token)).status, 200);
  assert.equal((await f.call('/console/api/bindings/approve', { id: binding.id })).status, 200);
  assert.equal((await f.call('/me', undefined, wx.token)).account.isAdmin, true);
  assert.equal((await f.call('/me', undefined, hw.token)).account.isAdmin, false);
  const hwAgain = await f.call('/session/huawei', { code: 'hw-two' });
  assert.equal(hwAgain.account.isAdmin, false);
  assert.equal((await f.call('/admin/codes', undefined, hwAgain.token)).status, 403);
});
