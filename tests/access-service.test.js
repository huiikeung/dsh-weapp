'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../dsh-console/services/public-access/server.cjs');
const NODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DAY = 86400000;

async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-access-test-'));
  const stateFile = path.join(dir, 'state.json');
  let clock = Date.now();
  const grants = [];
  const identities = { admin: 'fixture-platform-admin', user: 'fixture-user', second: 'fixture-second-user' };
  const server = createService({ stateFile, adminOpenIds: ['fixture-platform-admin'], managedNodeIds: [NODE],
    now: () => clock,
    exchangeCode: async code => identities[code],
    grantAccess: async input => { grants.push(input); return { ...input, applied: true, expiresAt: clock + input.durationMs }; },
    ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function request(route, token, data) {
    const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, ...await response.json() };
  }
  const login = (code, extra) => request('/session', null, { code, ...extra });
  return { request, login, grants, stateFile, tick: ms => { clock += ms; } };
}

test('roles come only from verified WeChat OpenID, never client flags or node ownership', async t => {
  const f = await fixture(t);
  const admin = await f.login('admin');
  assert.equal(admin.account.isAdmin, true);
  const user = await f.login('user', { openid: 'fixture-platform-admin', isAdmin: true, role: 'admin', relayRole: 'owner' });
  assert.equal(user.account.isAdmin, false);
  assert.equal((await f.request('/me', user.token)).account.isAdmin, false);
  for (const [route, data] of [['/admin/codes', undefined], ['/admin/codes', { nodeId: NODE, days: 30, uses: 1 }], ['/admin/codes/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/revoke', {}]]) {
    assert.equal((await f.request(route, user.token, data)).status, 403);
  }
  assert.equal((await f.request('/admin/codes', admin.token)).status, 200);
  assert.equal((await f.login('not-a-wechat-code', { isAdmin: true })).status, 401);
  f.tick(2 * 60 * 60000 + 1);
  assert.equal((await f.request('/admin/codes', admin.token)).status, 401);
});

test('unconfigured grant adapter cannot issue apparently working codes', async t => {
  const f = await fixture(t, { grantAccess: null });
  const admin = await f.login('admin');
  assert.equal(admin.account.isAdmin, true);
  assert.equal(admin.account.grantReady, false);
  assert.equal((await f.request('/admin/codes', admin.token, { nodeId: NODE, days: 30, uses: 1 })).status, 503);
  assert.equal((await f.request('/redemptions', admin.token, { nodeId: NODE, code: 'A'.repeat(24) })).status, 400);
  const state = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.deepEqual(state.codes, {});
  assert.deepEqual(state.access, {});
  assert.equal(Object.keys(state.engagement.identities).length, 1);
});

test('codes are validated, hashed, node-bound and redeem only once per account', async t => {
  const f = await fixture(t), admin = await f.login('admin'), user = await f.login('user');
  assert.equal((await f.request('/admin/codes', admin.token, { nodeId: NODE, days: 999, uses: 1 })).status, 400);
  assert.equal((await f.request('/admin/codes', admin.token, { nodeId: 'unknown', days: 30, uses: 1 })).status, 400);
  const generated = await f.request('/admin/codes', admin.token, { nodeId: NODE, days: 30, uses: 1 });
  assert.equal(generated.status, 201);
  assert.match(generated.code, /^[A-F0-9]{6}(?:-[A-F0-9]{6}){3}$/);
  assert.equal(fs.readFileSync(f.stateFile, 'utf8').includes(generated.code.replace(/-/g, '')), false);
  const listing = await f.request('/admin/codes', admin.token);
  assert.equal(listing.items[0].code, undefined);
  const redeemed = await f.request('/redemptions', user.token, { nodeId: NODE, code: generated.code });
  assert.equal(redeemed.status, 200);
  const repeated = await f.request('/redemptions', user.token, { nodeId: NODE, code: generated.code });
  assert.equal(repeated.alreadyRedeemed, true);
  assert.equal(repeated.expiresAt, redeemed.expiresAt);
  assert.equal(f.grants.length, 1);
  assert.equal((await f.request('/redemptions', admin.token, { nodeId: NODE, code: generated.code })).code, 'CODE_UNAVAILABLE');
});

test('revoked and expired codes cannot grant access; concurrent claims respect use limit', async t => {
  const f = await fixture(t), admin = await f.login('admin'), user = await f.login('user');
  const create = () => f.request('/admin/codes', admin.token, { nodeId: NODE, days: 7, uses: 1 });
  const first = await create();
  assert.equal((await f.request('/admin/codes/' + first.id + '/revoke', admin.token, {})).status, 200);
  assert.equal((await f.request('/redemptions', user.token, { nodeId: NODE, code: first.code })).code, 'CODE_UNAVAILABLE');
  const concurrent = await create();
  const results = await Promise.all([admin, user].map(u => f.request('/redemptions', u.token, { nodeId: NODE, code: concurrent.code })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const expired = await create();
  f.tick(31 * DAY);
  const nextUser = await f.login('user');
  assert.equal((await f.request('/redemptions', nextUser.token, { nodeId: NODE, code: expired.code })).code, 'CODE_UNAVAILABLE');
});

test('failed grant retries the same durable redemption without charging another use', async t => {
  const inputs = [];
  const f = await fixture(t, { grantAccess: async input => {
    inputs.push(input);
    if (inputs.length === 1) throw new Error('temporary failure');
    return { ...input, applied: true, expiresAt: Date.now() + DAY };
  } });
  const admin = await f.login('admin'), user = await f.login('user');
  const code = await f.request('/admin/codes', admin.token, { nodeId: NODE, days: 7, uses: 1 });
  assert.equal((await f.request('/redemptions', user.token, { nodeId: NODE, code: code.code })).status, 503);
  assert.equal((await f.request('/redemptions', user.token, { nodeId: NODE, code: code.code })).status, 200);
  assert.equal(inputs[0].redemptionId, inputs[1].redemptionId);
  assert.equal((await f.request('/admin/codes', admin.token)).items[0].used, 1);
});

test('restart preserves code state and corrupt state fails closed', async t => {
  const f = await fixture(t), admin = await f.login('admin');
  await f.request('/admin/codes', admin.token, { nodeId: NODE, days: 30, uses: 1 });
  const options = { stateFile: f.stateFile, adminOpenIds: ['fixture-platform-admin'], managedNodeIds: [NODE], exchangeCode: async () => 'fixture-platform-admin' };
  const restarted = createService(options);
  await new Promise(resolve => restarted.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + restarted.address().port;
    const login = await (await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'fixture' }) })).json();
    const list = await (await fetch(base + '/admin/codes', { headers: { Authorization: 'Bearer ' + login.token } })).json();
    assert.equal(list.items.length, 1);
    assert.equal((await fetch(base + '/me', { headers: { Authorization: 'Bearer ' + admin.token } })).status, 401);
  } finally {
    restarted.closeAllConnections();
    await new Promise(resolve => restarted.close(resolve));
  }
  fs.writeFileSync(f.stateFile, '{broken fixture');
  assert.throws(() => createService(options), /refusing to reset/);
});

test('public codes work without managed nodes/adapters and renew account expiry atomically', async t => {
  const f = await fixture(t, { managedNodeIds: [], grantAccess: null });
  const admin = await f.login('admin'), user = await f.login('user');
  assert.equal(user.account.publicAccess, false);
  assert.equal(admin.account.publicAccessReady, true);
  for (const days of [3, 7, 30, 180, 365]) {
    const code = await f.request('/admin/codes', admin.token, { days, uses: 1 });
    assert.equal(code.status, 201); assert.equal(code.nodeId, null);
    const before = (await f.request('/me', user.token)).account.publicAccessExpiresAt;
    const redemption = await f.request('/redemptions', user.token, { code: code.code, nodeId: 'ignored-client-scope' });
    assert.equal(redemption.status, 200);
    const current = (await f.request('/me', user.token)).account;
    assert.equal(current.publicAccess, true);
    assert.equal(current.publicAccessExpiresAt, redemption.expiresAt);
    if (before) assert.equal(current.publicAccessExpiresAt - before, days * DAY);
    const repeat = await f.request('/redemptions', user.token, { code: code.code });
    assert.equal(repeat.alreadyRedeemed, true); assert.equal(repeat.expiresAt, redemption.expiresAt);
    assert.equal((await f.request('/redemptions', admin.token, { code: code.code })).code, 'CODE_UNAVAILABLE');
  }
  assert.equal(f.grants.length, 0, 'No external authorization or user DSH required');
  const records = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  assert.equal(records.version, 2); assert.equal(Object.keys(records.access).length, 1);
  assert.ok(Object.values(records.redemptions).every(r => r.status === 'complete' && r.nodeId === null));
  f.tick(700 * DAY);
  assert.equal((await f.login('user')).account.publicAccess, false);
});

test('public code concurrency, revoked codes and invalid options cannot overgrant', async t => {
  const f = await fixture(t, { managedNodeIds: [], grantAccess: null });
  const admin = await f.login('admin'), user = await f.login('user'), second = await f.login('second');
  // 90 天现在是合法档位（季度），用真正不在白名单里的天数验证拒绝逻辑。
  assert.equal((await f.request('/admin/codes', admin.token, { days: 14, uses: 1 })).status, 400);
  assert.equal((await f.request('/admin/codes', admin.token, { days: 14, uses: 1 })).code, 'INVALID_CODE_OPTIONS');
  const code = await f.request('/admin/codes', admin.token, { days: 7, uses: 1 });
  const claims = await Promise.all([user, second].map(u => f.request('/redemptions', u.token, { code: code.code })));
  assert.equal(claims.filter(r => r.status === 200).length, 1);
  const revoked = await f.request('/admin/codes', admin.token, { days: 7, uses: 5 });
  await f.request('/admin/codes/' + revoked.id + '/revoke', admin.token, {});
  assert.equal((await f.request('/redemptions', user.token, { code: revoked.code })).code, 'CODE_UNAVAILABLE');
});

test('relay leases require paid account and bind node/device, enforce expiry server-side', async t => {
  const secret = 'fixture-internal-relay-secret-0000000000';
  const f = await fixture(t, { managedNodeIds: [], grantAccess: null, relayAuthSecret: secret });
  const admin = await f.login('admin'), user = await f.login('user');
  const input = { nodeId: 'users-own-node-123', deviceId: 'fixture-phone-123' };
  assert.equal((await f.request('/public-access/lease', user.token, input)).code, 'PUBLIC_ACCESS_REQUIRED');
  const code = await f.request('/admin/codes', admin.token, { days: 3, uses: 1 });
  await f.request('/redemptions', user.token, { code: code.code });
  const lease = await f.request('/public-access/lease', user.token, input);
  assert.equal(lease.status, 201);
  const check = { ...input, token: lease.token };
  assert.equal((await f.request('/internal/relay/authorize', user.token, check)).status, 403);
  assert.equal((await f.request('/internal/relay/authorize', secret, check)).allowed, true);
  for (const field of ['nodeId', 'deviceId', 'token']) {
    assert.equal((await f.request('/internal/relay/authorize', secret, { ...check, [field]: 'forged' })).status, 401);
  }
  f.tick(DAY + 1);
  assert.equal((await f.request('/internal/relay/authorize', secret, check)).status, 401);
  const refreshed = await f.login('user');
  assert.equal((await f.request('/public-access/lease', refreshed.token, input)).status, 201);
  f.tick(2 * DAY);
  const expired = await f.login('user');
  assert.equal((await f.request('/public-access/lease', expired.token, input)).status, 403);
  // State migration preserves legacy codes and console settings; restarting does not reset grants.
  const saved = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'));
  saved.version = 1; delete saved.access;
  fs.writeFileSync(f.stateFile, JSON.stringify(saved));
  const migrated = createService({ stateFile: f.stateFile, adminOpenIds: ['admin'], exchangeCode: async () => 'admin' });
  assert.ok(migrated); migrated.close();
  saved.version = 2; saved.access = { malformed: { expiresAt: 'infinite' } };
  fs.writeFileSync(f.stateFile, JSON.stringify(saved));
  assert.throws(() => createService({ stateFile: f.stateFile, adminOpenIds: ['admin'], exchangeCode: async () => 'admin' }), /refusing to reset/);
});
