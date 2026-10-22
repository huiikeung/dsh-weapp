'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function client() {
  let clock = Date.now(), currentAdmin = true, currentPublicAccount = null, loginCount = 0;
  const saved = new Map(), requests = [];
  const config = { baseUrl: 'https://identity.example.test' };
  const wx = {
    getStorageSync: key => saved.get(key), setStorageSync: (key, value) => saved.set(key, value), removeStorageSync: key => saved.delete(key),
    login: options => { loginCount++; options.success({ code: 'fixture-wechat-code-' + loginCount }); },
    request: options => {
      requests.push(options);
      options.success({ statusCode: 200, data: options.url.endsWith('/session')
        ? { token: 'fixture-session-' + loginCount, expiresAt: clock + 60000, account: currentPublicAccount || { isAdmin: currentAdmin } }
        : options.url.endsWith('/public-access/lease')
          ? { token: 'L'.repeat(43), expiresAt: clock + 60000 }
        : { account: currentPublicAccount || { isAdmin: currentAdmin } } });
    }
  };
  const context = { module: { exports: {} }, require: n => n.endsWith('ui-preferences') ? require('../miniprogram/utils/ui-preferences') : config, wx, Date: { now: () => clock } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/utils/access-api.js'), 'utf8'), context);
  return { api: context.module.exports, config, wx, saved, requests, tick: ms => { clock += ms; }, setAdmin: value => { currentAdmin = value; }, setPublicAccount: value => { currentPublicAccount = value; }, logins: () => loginCount };
}
test('legacy backend share route gives an actionable upgrade message', async () => {
  const f=client();await f.api.ensureAccount({freshLogin:true});
  f.wx.request=options=>options.success({statusCode:404,data:{code:'NOT_FOUND',message:'接口不存在'}});
  await assert.rejects(f.api.shareStatus(), error=>error.code==='SHARE_UPGRADE_REQUIRED' && error.message.includes('更新后台'));
});
test('anonymous content on an old backend explains upgrade without clearing verified identity', async () => {
  const f = client(); await f.api.login();
  const request = f.wx.request;
  f.wx.request = options => {
    assert.equal(options.header.Authorization, undefined);
    options.success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
  };
  await assert.rejects(f.api.appContent(), { code: 'CONTENT_UPGRADE_REQUIRED' });
  f.wx.request = request;
  assert.equal((await f.api.me()).isAdmin, true);
  assert.equal(f.logins(), 1);
});
test('automatic fresh login replaces old account without persisting an administrator flag', async () => {
  const f = client();
  assert.equal((await f.api.ensureAccount({ freshLogin: true })).isAdmin, true);
  f.setAdmin(false);
  assert.equal((await f.api.ensureAccount({ freshLogin: true })).isAdmin, false);
  assert.equal(f.logins(), 2);
  assert.equal([...f.saved.values()].some(value => value.includes('isAdmin')), false);
  assert.equal(f.requests.every(r => !r.url.endsWith('/session') || !r.header.Authorization), true);
});
test('expired in-memory sessions and sessions from another service are not reused', async () => {
  const f = client();
  await f.api.login();
  f.tick(60001);
  await f.api.ensureAccount();
  assert.equal(f.logins(), 2);
  f.config.baseUrl = 'https://other.example.test';
  await f.api.ensureAccount();
  assert.equal(f.logins(), 3);
});
test('fresh login clears stale permissions on failure and rejects malformed roles', async () => {
  const f = client();
  await f.api.login();
  f.wx.login = options => options.fail();
  await assert.rejects(f.api.ensureAccount({ freshLogin: true }), { code: 'LOGIN_FAILED' });
  await assert.rejects(f.api.me(), { code: 'LOGIN_REQUIRED' });
  const malformed = client();
  malformed.setAdmin('true');
  await assert.rejects(malformed.api.login(), { code: 'INVALID_RESPONSE' });
});
test('overlapping automatic checks share one login and unconfigured service fails closed', async () => {
  const f = client();
  await Promise.all([f.api.ensureAccount({ freshLogin: true }), f.api.ensureAccount({ freshLogin: true })]);
  assert.equal(f.logins(), 1);
  f.config.baseUrl = '';
  await assert.rejects(f.api.ensureAccount({ freshLogin: true }), { code: 'NOT_CONFIGURED' });
});
test('admin binding submits only the code with the verified session and never changes the local role', async () => {
  const f = client(); f.setAdmin(false);
  const code = 'WB-A1B2C3-D4E5F6-A1B2C3-D4E5F6';
  await assert.rejects(f.api.claimAdminBinding(code), { code: 'LOGIN_REQUIRED' });
  assert.equal((await f.api.ensureAccount({ freshLogin: true })).isAdmin, false);
  await f.api.claimAdminBinding(code);
  const request = f.requests.at(-1);
  assert.equal(request.url.endsWith('/admin-binding/claim'), true);
  assert.equal(request.data.code, code);
  assert.deepEqual(Object.keys(request.data), ['code']);
  assert.equal(request.header.Authorization, 'Bearer fixture-session-1');
  assert.equal((await f.api.me()).isAdmin, false);
});
test('only the configured operator relay is metered; cached expiry never grants access', () => {
  const f = client();
  assert.equal(f.api.isManagedRelay('wss://identity.example.test/relay/c/fixture-node'), true);
  for (const url of ['ws://192.168.1.2:8000', 'wss://identity.example.test.evil/relay/c/fixture-node',
    'wss://another.example.test/relay/c/fixture-node', 'wss://identity.example.test/relay/c/../other',
    'wss://identity.example.test/gateway', 'wss://identity.example.test/relay/c/fixture-node?token=x']) {
    assert.equal(f.api.isManagedRelay(url), false, url);
  }
  f.saved.set('public-access.expiresAt', Date.now() + 365 * 86400000);
  assert.equal(f.api.hasPublicAccess(), false);
  assert.equal(f.api.hasPublicAccess({ isAdmin: false, publicAccess: true, publicAccessExpiresAt: 1 }), false);
});
test('public relay authorization distinguishes first-time access from an expired entitlement', async () => {
  const fresh = client();
  fresh.setPublicAccount({ isAdmin: false, publicAccess: false, publicAccessExpiresAt: null });
  await assert.rejects(fresh.api.publicLease('fixture-node', 'fixture-device'), error =>
    error.code === 'PUBLIC_ACCESS_REQUIRED' && error.message.includes('尚未开通') && error.message.includes('局域网连接不受影响'));
  assert.equal(fresh.requests.some(request => request.url.endsWith('/public-access/lease')), false);

  const expired = client();
  expired.setPublicAccount({ isAdmin: false, publicAccess: false, publicAccessExpiresAt: Date.now() - 1000 });
  await assert.rejects(expired.api.publicLease('fixture-node', 'fixture-device'), error =>
    error.code === 'PUBLIC_ACCESS_EXPIRED' && error.message.includes('有效期已到期') && error.message.includes('兑换续期'));
  assert.equal(expired.requests.some(request => request.url.endsWith('/public-access/lease')), false);
});
test('an active public-access grant still receives a relay lease', async () => {
  const f = client();
  f.setPublicAccount({ isAdmin: false, publicAccess: true, publicAccessExpiresAt: Date.now() + 86400000 });
  const lease = await f.api.publicLease('fixture-node', 'fixture-device');
  assert.equal(lease.token, 'L'.repeat(43));
  assert.equal(f.requests.some(request => request.url.endsWith('/public-access/lease')), true);
});
