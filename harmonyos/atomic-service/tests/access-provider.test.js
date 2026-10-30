'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../ascf/ascf_src/utils/access-api.js'), 'utf8');
const TOKEN = 'H'.repeat(43);
const DEVICE = 'HW-' + 'A'.repeat(24);
const account = (values = {}) => Object.assign({ isAdmin: false, grantReady: true,
  publicAccessReady: true, publicAccess: false, publicAccessExpiresAt: null, deviceId: DEVICE }, values);

function fixture(options = {}) {
  const config = { baseUrl: 'https://identity.example.test' };
  const saved = new Map(options.saved || []);
  const requests = [];
  const loginCalls = [];
  let loginHandler = options.loginHandler || (request => request.success({ code: 'huawei-one-time-code',
    openID: 'client-forged-openid', idToken: 'client-id-token', isAdmin: true, roles: ['admin'] }));
  let requestHandler = options.requestHandler || (request => {
    const route = new URL(request.url).pathname.replace('/base', '');
    if (route === '/session/huawei') return request.success({ statusCode: 201, data: {
      token: TOKEN, expiresAt: Date.now() + 120000,
      account: account({ isAdmin: true, publicAccess: true, publicAccessExpiresAt: null })
    } });
    if (route === '/me') {
      if (request.header.Authorization !== 'Bearer ' + TOKEN) return request.success({ statusCode: 401, data: { code: 'UNAUTHORIZED', message: '登录已过期' } });
      return request.success({ statusCode: 200, data: { account: account({ isAdmin: true, publicAccess: true, publicAccessExpiresAt: null }) } });
    }
    if (route === '/app-content') return request.success({ statusCode: 200, data: { items: [{ id: 'notice' }], shareEnabled: true } });
    if (!request.header.Authorization) return request.success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    return request.success({ statusCode: 200, data: { items: [] } });
  });
  const has = {
    getStorageSync(key) { return saved.get(key); },
    setStorageSync(key, value) { saved.set(key, value); },
    removeStorageSync(key) { saved.delete(key); },
    login(request) { loginCalls.push(request); loginHandler(request); },
    request(request) { requests.push(request); requestHandler(request); }
  };
  const context = {
    module: { exports: {} },
    setTimeout, clearTimeout, Date,
    require(name) {
      if (name === './ui-preferences') return { t: text => text, locale: () => options.locale || 'zh' };
      if (name === './access-config') return config;
      throw new Error('Unexpected import: ' + name);
    },
    has
  };
  vm.runInNewContext(source, context, { filename: 'access-api.js' });
  return { api: context.module.exports, config, has, saved, requests, loginCalls,
    setLoginHandler(value) { loginHandler = value; }, setRequestHandler(value) { requestHandler = value; } };
}

function removeSessionRequest(f) {
  return f.requests.filter(item => /\/session(?:\/|$)/.test(new URL(item.url).pathname));
}

test('exchanges only the Huawei code and installs the server-verified account', async () => {
  const f = fixture();
  const current = await f.api.login();
  assert.equal(f.loginCalls.length, 1);
  assert.equal(f.requests.length, 1);
  const exchange = f.requests[0];
  assert.equal(exchange.url, 'https://identity.example.test/session/huawei');
  assert.equal(exchange.method, 'POST');
  assert.equal(exchange.header.Authorization, undefined);
  assert.equal(JSON.stringify(exchange.data), JSON.stringify({ code: 'huawei-one-time-code' }));
  assert.equal(current.isAdmin, true);
  assert.equal(current.publicAccess, true);
  assert.equal(current.deviceId, DEVICE);
  assert.equal(Object.hasOwn(current, 'roles'), false);
  assert.equal(Object.hasOwn(current, 'openID'), false);
  const cached = JSON.parse(f.saved.get('public-access.huawei-session.v1'));
  assert.equal(cached.provider, 'huawei');
  assert.equal(cached.token, TOKEN);
  assert.equal(f.saved.has('public-access.session.v1'), false);
  assert.equal(f.api.hasPublicAccess(), true);

  await f.api.codes();
  assert.equal(f.requests[1].url, 'https://identity.example.test/admin/codes');
  assert.equal(f.requests[1].header.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(removeSessionRequest(f).map(item => item.url), ['https://identity.example.test/session/huawei']);
});

test('concurrent logins coalesce to one has.login and one Huawei exchange', async () => {
  let callback;
  const f = fixture({ loginHandler: request => { callback = request; } });
  const pending = Array.from({ length: 12 }, () => f.api.ensureAccount({ freshLogin: true }));
  assert.equal(f.loginCalls.length, 1);
  assert.equal(f.requests.length, 0);
  callback.success({ code: 'single-code', openID: 'ignored-openid', roles: ['admin'] });
  const accounts = await Promise.all(pending);
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.stringify(f.requests[0].data), JSON.stringify({ code: 'single-code' }));
  assert.ok(accounts.every(value => value.deviceId === DEVICE && value.isAdmin));
  assert.equal(f.saved.get('public-access.huawei-session.v1') != null, true);
});

test('old WeChat session and lease caches are never used or promoted', async () => {
  const expiry = Date.now() + 60000;
  const saved = [
    ['public-access.session.v1', JSON.stringify({ baseUrl: 'https://identity.example.test', token: TOKEN, expiresAt: expiry, account: account({ isAdmin: true }) })],
    ['public-access.grant.v1', JSON.stringify({ nodeId: 'old-node', token: TOKEN, expiresAt: expiry })],
    ['public-access.expiresAt', expiry]
  ];
  const f = fixture({ saved });
  const current = await f.api.ensureAccount();
  assert.equal(current.isAdmin, true);
  assert.equal(f.requests.length, 1, 'the legacy WeChat token is not sent to /me');
  assert.equal(f.requests[0].url, 'https://identity.example.test/session/huawei');
  assert.equal(f.requests[0].header.Authorization, undefined);
  assert.equal(f.loginCalls.length, 1);
  assert.deepEqual(removeSessionRequest(f).map(item => item.url), ['https://identity.example.test/session/huawei']);
  for (const key of ['public-access.session.v1', 'public-access.grant.v1', 'public-access.expiresAt']) assert.equal(f.saved.has(key), false);
  assert.equal(f.api.cachedLease('old-node'), null);
});

test('cached server identity is Huawei-only, immutable and requires the server HW device id', async () => {
  const f = fixture({ requestHandler: request => request.success({ statusCode: 201, data: {
    token: TOKEN, expiresAt: Date.now() + 120000,
    account: account({ isAdmin: false, publicAccess: false, roles: ['admin'], openID: 'forged' })
  } }) });
  const current = await f.api.login();
  assert.equal(current.isAdmin, false);
  assert.equal(current.publicAccess, false);
  assert.equal(Object.hasOwn(current, 'roles'), false);
  assert.equal(Object.hasOwn(current, 'openID'), false);
  assert.equal(f.api.hasPublicAccess(), false);
  assert.throws(() => { current.isAdmin = true; }, TypeError);
  assert.equal(f.api.hasPublicAccess(), false);

  const invalid = fixture({ requestHandler: request => request.success({ statusCode: 201, data: {
    token: TOKEN, expiresAt: Date.now() + 120000, account: account({ deviceId: 'WX-' + 'A'.repeat(24), isAdmin: true, publicAccess: true })
  } }) });
  await assert.rejects(invalid.api.login(), { code: 'INVALID_RESPONSE' });
  assert.equal(invalid.saved.has('public-access.huawei-session.v1'), false);
  assert.equal(invalid.api.hasPublicAccess(), false);
});

test('server configuration, Huawei verification and unavailable errors clear all session state', async () => {
  for (const [statusCode, code] of [[503, 'HUAWEI_NOT_CONFIGURED'], [401, 'HUAWEI_LOGIN_FAILED'], [503, 'HUAWEI_UNAVAILABLE'], [400, 'INVALID_LOGIN_CODE']]) {
    const saved = [['public-access.huawei-session.v1', JSON.stringify({ provider: 'huawei', baseUrl: 'https://identity.example.test', token: TOKEN, expiresAt: Date.now() + 60000 })],
      ['public-access.huawei-grant.v1', JSON.stringify({ provider: 'huawei', token: TOKEN, expiresAt: Date.now() + 60000 })]];
    const f = fixture({ saved, requestHandler: request => request.success({ statusCode, data: { code, message: 'server rejected identity' } }) });
    await assert.rejects(f.api.login(), error => error.code === code && error.message === 'server rejected identity');
    assert.equal(f.saved.has('public-access.huawei-session.v1'), false, code);
    assert.equal(f.saved.has('public-access.huawei-grant.v1'), false, code);
    assert.equal(f.api.hasPublicAccess(), false);
    assert.equal(f.loginCalls.length, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, 'https://identity.example.test/session/huawei');
    assert.equal(JSON.stringify(f.requests[0].data), JSON.stringify({ code: 'huawei-one-time-code' }));
    assert.equal(f.requests[0].header.Authorization, undefined);
  }
});

test('a consumed one-time code is not reused after server rejection', async () => {
  let issued = 0, exchanges = 0;
  const f = fixture({
    loginHandler: request => request.success({ code: 'one-time-' + (++issued), openID: 'ignored' }),
    requestHandler: request => {
      exchanges++;
      if (exchanges === 1) return request.success({ statusCode: 401, data: { code: 'HUAWEI_LOGIN_FAILED', message: 'expired code' } });
      return request.success({ statusCode: 201, data: { token: TOKEN, expiresAt: Date.now() + 60000, account: account() } });
    }
  });
  await assert.rejects(f.api.login(), { code: 'HUAWEI_LOGIN_FAILED' });
  assert.equal(f.saved.has('public-access.huawei-session.v1'), false);
  await f.api.login();
  assert.equal(issued, 2);
  assert.equal(exchanges, 2);
  assert.equal(JSON.stringify(f.requests.map(item => item.data.code)), JSON.stringify(['one-time-1', 'one-time-2']));
  assert.equal(f.api.hasPublicAccess(), false);
});

test('transport fail response clears a previously cached Huawei session and lease', async () => {
  const expiry = Date.now() + 60000;
  const saved = [
    ['public-access.huawei-session.v1', JSON.stringify({ provider: 'huawei', baseUrl: 'https://identity.example.test', token: TOKEN, expiresAt: expiry })],
    ['public-access.huawei-grant.v1', JSON.stringify({ provider: 'huawei', baseUrl: 'https://identity.example.test', sessionToken: TOKEN,
      nodeId: 'node-1', token: TOKEN, expiresAt: expiry })]
  ];
  const f = fixture({ saved, requestHandler: request => request.fail({ errMsg: 'network failure' }) });
  await assert.rejects(f.api.login(), { code: 'NETWORK_ERROR' });
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://identity.example.test/session/huawei');
  assert.equal(f.saved.has('public-access.huawei-session.v1'), false);
  assert.equal(f.saved.has('public-access.huawei-grant.v1'), false);
  assert.equal(f.api.hasPublicAccess(), false);
});

test('client login failures and malformed success responses fail closed', async () => {
  const rejected = fixture({ loginHandler: request => request.fail({ errMsg: 'cancelled' }) });
  await assert.rejects(rejected.api.login(), { code: 'HUAWEI_LOGIN_FAILED' });
  assert.equal(rejected.requests.length, 0);
  assert.equal(rejected.api.hasPublicAccess(), false);

  const noCode = fixture({ loginHandler: request => request.success({ openID: 'attacker', isAdmin: true }) });
  await assert.rejects(noCode.api.login(), { code: 'HUAWEI_LOGIN_FAILED' });
  assert.equal(noCode.requests.length, 0);

  for (const response of [
    { statusCode: 200, data: { token: TOKEN, expiresAt: Date.now() + 60000, account: account({ isAdmin: true }) } },
    { statusCode: 201, data: { token: TOKEN, expiresAt: Date.now() - 1, account: account({ isAdmin: true }) } },
    { statusCode: 201, data: { token: 'short', expiresAt: Date.now() + 60000, account: account() } },
    { statusCode: 201, data: { token: TOKEN, expiresAt: Date.now() + 60000, account: { isAdmin: true } } }
  ]) {
    const f = fixture({ requestHandler: request => request.success(response) });
    await assert.rejects(f.api.login(), { code: 'INVALID_RESPONSE' });
    assert.equal(f.saved.has('public-access.huawei-session.v1'), false);
    assert.equal(f.api.hasPublicAccess(), false);
    assert.equal(f.requests[0].url.endsWith('/session/huawei'), true);
  }
});

test('missing endpoint configuration is actionable and does not prompt Huawei login', async () => {
  const f = fixture({ locale: 'en' });
  f.config.baseUrl = '';
  await assert.rejects(f.api.login(), error => error.code === 'HUAWEI_NOT_CONFIGURED' && error.message.includes('not configured'));
  assert.equal(f.loginCalls.length, 0);
  assert.equal(f.requests.length, 0);
});

test('anonymous app content remains available without identity or legacy cache', async () => {
  const saved = [['public-access.session.v1', JSON.stringify({ token: TOKEN, expiresAt: Date.now() + 60000 })]];
  const f = fixture({ saved });
  const result = await f.api.appContent();
  assert.equal(result.items[0].id, 'notice');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, 'https://identity.example.test/app-content');
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].data, undefined);
  assert.equal(f.requests[0].header.Authorization, undefined);
  assert.equal(f.loginCalls.length, 0);
  assert.equal(f.api.hasPublicAccess(), false);
});

test('anonymous content keeps existing upgrade, network and configuration failures', async () => {
  const f = fixture();
  for (const [statusCode, code] of [[401, 'UNAUTHORIZED'], [404, 'NOT_FOUND']]) {
    f.setRequestHandler(request => request.success({ statusCode, data: { code } }));
    await assert.rejects(f.api.appContent(), { code: 'CONTENT_UPGRADE_REQUIRED' });
  }
  f.setRequestHandler(request => request.fail());
  await assert.rejects(f.api.appContent(), { code: 'NETWORK_ERROR' });
  const requestCount = f.requests.length;
  f.config.baseUrl = '';
  await assert.rejects(f.api.appContent(), { code: 'NOT_CONFIGURED' });
  assert.equal(f.requests.length, requestCount);
  assert.equal(f.loginCalls.length, 0);
});

test('managed relay classification stays independent from identity sessions', () => {
  const f = fixture();
  assert.equal(f.api.isManagedRelay('wss://identity.example.test/relay/c/fixture_node-123'), true);
  assert.equal(f.api.isManagedRelay('wss://identity.example.test.evil/relay/c/fixture_node-123'), false);
  assert.equal(f.api.isManagedRelay('wss://other.example.test/relay/c/fixture_node-123'), false);
});

test('authentication failures clear the Huawei session and cannot preserve privileges', async () => {
  let mode = 'login';
  const f = fixture({ requestHandler(request) {
    const route = new URL(request.url).pathname;
    if (route.endsWith('/session/huawei')) return request.success({ statusCode: 201, data: { token: TOKEN,
      expiresAt: Date.now() + 60000, account: account({ isAdmin: true, publicAccess: true }) } });
    if (mode === 'expired') return request.success({ statusCode: 401, data: { code: 'UNAUTHORIZED', message: 'expired' } });
    return request.success({ statusCode: 200, data: { items: [] } });
  } });
  await f.api.login();
  assert.equal(f.api.hasPublicAccess(), true);
  mode = 'expired';
  await assert.rejects(f.api.codes(), { code: 'UNAUTHORIZED' });
  assert.equal(f.saved.has('public-access.huawei-session.v1'), false);
  assert.equal(f.saved.has('public-access.huawei-grant.v1'), false);
  assert.equal(f.api.hasPublicAccess(), false);
  assert.equal(f.api.cachedLease('node'), null);
});

test('authenticated operations use the server token and never resend login identity', async () => {
  const f = fixture();
  await f.api.login();
  await f.api.codes();
  const request = f.requests.at(-1);
  assert.equal(request.url, 'https://identity.example.test/admin/codes');
  assert.equal(request.header.Authorization, 'Bearer ' + TOKEN);
  assert.equal(request.data, undefined);
  assert.deepEqual(removeSessionRequest(f).map(item => item.url), ['https://identity.example.test/session/huawei']);
  assert.equal(f.loginCalls.length, 1);
});

test('Huawei-specific server errors are clear in English and configured failures clear stale credentials', async () => {
  const unavailable = fixture({ locale: 'en', requestHandler: request => request.success({ statusCode: 503,
    data: { code: 'HUAWEI_NOT_CONFIGURED', message: '华为账号身份服务尚未配置' } }) });
  await assert.rejects(unavailable.api.login(), error => error.code === 'HUAWEI_NOT_CONFIGURED' &&
    error.message === 'Huawei account service is not configured on this server.');
  assert.equal(unavailable.api.hasPublicAccess(), false);

  const expiry = Date.now() + 60000;
  const stale = fixture({ saved: [
    ['public-access.huawei-session.v1', JSON.stringify({ provider: 'huawei', baseUrl: 'https://identity.example.test', token: TOKEN, expiresAt: expiry })],
    ['public-access.huawei-grant.v1', JSON.stringify({ provider: 'huawei', token: TOKEN, expiresAt: expiry })]
  ] });
  stale.config.baseUrl = '';
  await assert.rejects(stale.api.login(), { code: 'HUAWEI_NOT_CONFIGURED' });
  assert.equal(stale.saved.size, 0);
  assert.equal(stale.loginCalls.length, 0);
});

test('Huawei sessions cannot use WeChat-only notification, share, or binding endpoints', async () => {
  const f = fixture({ requestHandler(request) {
    const route = new URL(request.url).pathname;
    if (route === '/session/huawei') return request.success({ statusCode: 201, data: {
      token: TOKEN, expiresAt: Date.now() + 60000, account: account()
    } });
    if (route === '/me') return request.success({ statusCode: 200, data: { account: account() } });
    const code = route === '/notifications/tickets' ? 'HUAWEI_NOTIFICATION_UNAVAILABLE'
      : route === '/share/invite' ? 'HUAWEI_SHARE_UNAVAILABLE' : 'HUAWEI_BINDING_UNAVAILABLE';
    return request.success({ statusCode: 403, data: { code, message: '华为账号当前不支持此功能' } });
  } });
  await f.api.login();
  await assert.rejects(f.api.issueCompletionNotificationTicket('T'.repeat(43)), { code: 'HUAWEI_NOTIFICATION_UNAVAILABLE' });
  await assert.rejects(f.api.shareInvite(), { code: 'HUAWEI_SHARE_UNAVAILABLE' });
  await assert.rejects(f.api.claimAdminBinding('binding-code'), { code: 'HUAWEI_BINDING_UNAVAILABLE' });
  for (const request of f.requests.slice(1)) assert.equal(request.header.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(removeSessionRequest(f).map(item => item.url), ['https://identity.example.test/session/huawei']);
});
