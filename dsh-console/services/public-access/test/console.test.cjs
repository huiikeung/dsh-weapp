'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createService } = require('../server.cjs');
const { tick, validateConfig } = require('../connector.cjs');
const ORIGIN = 'http://127.0.0.1:8790';
const SETUP = 'fixture-setup-token-never-use-in-production';
const PASSWORD = 'fixture-password-never-use-in-production';
const NODE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64');
const status = { gatewayEnabled: true, pairingMode: 'relay', connectedClients: 2,
  relay: { nodeId: NODE, relay: 'wss://relay.example.test', agentPubKey: PUBLIC_KEY } };
const pairPayload = () => Buffer.from(JSON.stringify({ version: 3, mode: 'relay', ...status.relay,
  pairingCode: 'fixture-pairing-credential-123456', expiresAt: Date.now() + 120000, gatewayUrl: 'ws://127.0.0.1:9999' })).toString('base64url');

async function fixture(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-console-test-'));
  const stateFile = path.join(dir, 'state.json');
  let clock = Date.now(), cookie = '', csrf = '';
  const options = { stateFile, exchangeCode: async code => code === 'wechat-user' ? 'fixture-current-wechat-user' : '', now: () => clock,
    consoleOptions: { origin: ORIGIN, setupToken: SETUP, masterKey: 'ab'.repeat(32), jobTimeoutMs: 500 }, ...extra };
  const server = createService(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  async function call(route, data, headers = {}, anonymous = false) {
    const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(!anonymous ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (!anonymous && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json(); if (!anonymous && result.csrf) csrf = result.csrf;
    return { ...result, status: response.status, headers: response.headers };
  }
  const setup = () => call('/console/api/setup', { setupToken: SETUP, password: PASSWORD });
  const postConnector = (token, route, data) => call(route, data, { Authorization: 'Bearer ' + token }, true);
  return { call, setup, base, postConnector, stateFile, options, tick: ms => { clock += ms; } };
}

test('console serves a real page, rejects unauthenticated writes and protects bootstrap', async t => {
  const f = await fixture(t);
  const page = await fetch(f.base + '/');
  assert.match(await page.text(), /鲸尾 · 管理台/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await f.call('/console/api/overview')).status, 401);
  assert.equal((await f.call('/console/api/setup', { setupToken: 'wrong', password: PASSWORD })).status, 403);
  const setup = await f.setup(); assert.equal(setup.status, 200);
  assert.match(setup.headers.get('set-cookie'), /HttpOnly/);
  assert.match(setup.headers.get('set-cookie'), /SameSite=Strict/);
  assert.equal((await f.setup()).status, 409);
  assert.equal((await f.call('/console/api/nodes', { name: 'x' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.call('/console/api/nodes', { name: 'x' }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  assert.equal((await f.call('/admin/codes', undefined, {}, true)).status, 401);
  assert.equal((await fetch(f.base + '/.env')).status, 401);
});

test('WeChat credentials are encrypted and never echoed; AppID is locked', async t => {
  const f = await fixture(t); await f.setup();
  const secret = 'f'.repeat(32);
  assert.equal((await f.call('/console/api/settings', { appId: 'wx0123456789abcdef', appSecret: secret })).status, 200);
  const overview = await f.call('/console/api/overview');
  assert.equal(overview.settings.secretConfigured, true);
  assert.equal(JSON.stringify(overview).includes(secret), false);
  assert.equal(fs.readFileSync(f.stateFile, 'utf8').includes(secret), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.stateFile).mode & 0o777, 0o600);
  assert.equal((await f.call('/console/api/settings', { appId: 'wx1123456789abcdef', appSecret: secret })).status, 409);
  assert.throws(() => createService({ ...f.options, consoleOptions: { ...f.options.consoleOptions, masterKey: 'cd'.repeat(32) } }));
});

test('parallel initialization can create only one owner and legacy AppID cannot be replaced', async t => {
  const f = await fixture(t, { consoleOptions: { origin: ORIGIN, setupToken: SETUP, masterKey: 'ab'.repeat(32), legacyAppId: 'wx0123456789abcdef' } });
  const attempts = await Promise.all([f.setup(), f.setup()]);
  assert.deepEqual(attempts.map(a => a.status).sort(), [200, 409]);
  assert.equal((await f.call('/console/api/settings', { appId: 'wx1123456789abcdef', appSecret: 'f'.repeat(32) })).status, 409);
  assert.equal((await f.call('/console/api/settings', { appId: 'wx0123456789abcdef', appSecret: 'f'.repeat(32) })).status, 200);
});

test('admin binding needs genuine session, single use, and web approval before elevation', async t => {
  const f = await fixture(t); await f.setup();
  const binding = await f.call('/console/api/bindings', { label: '运营' });
  assert.equal(binding.status, 201);
  assert.equal((await f.call('/admin-binding/claim', { code: binding.code, openid: 'forged-admin' }, {}, true)).status, 401);
  const login = await f.call('/session', { code: 'wechat-user', isAdmin: true }, {}, true);
  assert.equal(login.account.isAdmin, false);
  const headers = { Authorization: 'Bearer ' + login.token };
  assert.equal((await f.call('/admin-binding/claim', { code: binding.code }, headers, true)).status, 200);
  assert.equal((await f.call('/me', undefined, headers, true)).account.isAdmin, false);
  assert.equal((await f.call('/admin-binding/claim', { code: binding.code }, headers, true)).status, 400);
  assert.equal((await f.call('/console/api/bindings/approve', { id: binding.id })).status, 200);
  assert.equal((await f.call('/me', undefined, headers, true)).account.isAdmin, true);
  assert.equal((await f.call('/admin/codes', undefined, headers, true)).status, 200);
  await f.call('/console/api/admins/remove', { openid: 'fixture-current-wechat-user' });
  assert.equal((await f.call('/admin/codes', undefined, headers, true)).status, 403);
  const expired = await f.call('/console/api/bindings', { label: '过期' }); f.tick(600001);
  assert.equal((await f.call('/admin-binding/claim', { code: expired.code }, headers, true)).status, 400);
});

test('node pairing round-trip uses actual connector response and does not persist secrets', async t => {
  const f = await fixture(t); await f.setup();
  const node = await f.call('/console/api/nodes', { name: '工作室 Mac' });
  assert.equal(node.status, 201);
  assert.equal((await f.call('/console/api/nodes/' + node.id + '/pair', {})).status, 409);
  await f.postConnector(node.token, '/connector/poll', { status });
  const pairRequest = f.call('/console/api/nodes/' + node.id + '/pair', {});
  let task;
  for (let i = 0; i < 10 && !task; i++) task = (await f.postConnector(node.token, '/connector/poll', { status })).task;
  assert.ok(task, 'Pair request must be delivered to this node');
  assert.equal((await f.postConnector(node.token, '/connector/result', { id: task.id, ok: true, qrPayload: pairPayload() })).status, 200);
  const result = await pairRequest;
  assert.equal(result.status, 201); assert.match(result.qrImage, /^data:image\/png;base64,/);
  const parsed = JSON.parse(Buffer.from(result.qrPayload, 'base64url'));
  assert.equal(parsed.nodeId, NODE); assert.equal(parsed.pairingCode, 'fixture-pairing-credential-123456');
  assert.equal(parsed.gatewayUrl, undefined);
  const disk = fs.readFileSync(f.stateFile, 'utf8');
  assert.equal(disk.includes(node.token), false); assert.equal(disk.includes(parsed.pairingCode), false);
  const overview = await f.call('/console/api/overview');
  assert.equal(overview.nodes[0].ready, true); assert.equal(overview.nodes[0].connectedDevices, 2);
  assert.equal(JSON.stringify(overview).includes(node.token), false);
  await f.call('/console/api/nodes/' + node.id + '/disable', {});
  assert.equal((await f.postConnector(node.token, '/connector/poll', { status })).status, 401);
});

test('mismatched gateway identity is rejected and pending pairing times out', async t => {
  const f = await fixture(t); await f.setup();
  const node = await f.call('/console/api/nodes', { name: '节点' });
  await f.postConnector(node.token, '/connector/poll', { status });
  const changed = { ...status, relay: { ...status.relay, agentPubKey: Buffer.alloc(32, 8).toString('base64') } };
  assert.equal((await f.postConnector(node.token, '/connector/poll', { status: changed })).status, 409);
  assert.equal((await f.call('/console/api/nodes/' + node.id + '/pair', {})).status, 504);
  const rotated = await f.call('/console/api/nodes/' + node.id + '/rotate', {});
  assert.notEqual(rotated.token, node.token);
  assert.equal((await f.postConnector(node.token, '/connector/poll', { status })).status, 401);
});

test('another connector cannot complete a pairing job and mismatched payloads fail closed', async t => {
  const f = await fixture(t); await f.setup();
  const first = await f.call('/console/api/nodes', { name: '目标电脑' });
  const other = await f.call('/console/api/nodes', { name: '另一台电脑' });
  await f.postConnector(first.token, '/connector/poll', { status });
  const pending = f.call('/console/api/nodes/' + first.id + '/pair', {});
  let task;
  for (let i = 0; i < 10 && !task; i++) task = (await f.postConnector(first.token, '/connector/poll', { status })).task;
  assert.ok(task);
  assert.equal((await f.postConnector(other.token, '/connector/result', { id: task.id, ok: true, qrPayload: pairPayload() })).status, 404);
  const forged = JSON.parse(Buffer.from(pairPayload(), 'base64url'));
  forged.nodeId = '11111111-2222-4333-8444-555555555555';
  await f.postConnector(first.token, '/connector/result', { id: task.id, ok: true, qrPayload: Buffer.from(JSON.stringify(forged)).toString('base64url') });
  const result = await pending;
  assert.equal(result.status, 502); assert.equal(result.code, 'INVALID_PAIR');
  assert.equal((await f.postConnector(first.token, '/connector/result', { id: task.id, ok: true, qrPayload: pairPayload() })).status, 404);
});

test('console reuses real redemption guards and invalidates sessions on password change', async t => {
  const f = await fixture(t); await f.setup();
  assert.equal((await f.call('/console/api/codes', { nodeId: NODE, days: 30, uses: 1 })).status, 400);
  const code = await f.call('/console/api/codes', { days: 30, uses: 1 });
  assert.equal(code.status, 201, 'Public service codes need neither a managed node nor an external adapter');
  assert.equal(code.nodeId, null);
  assert.equal((await f.call('/console/api/codes')).items[0].id, code.id);
  assert.equal((await f.call('/console/api/password', { currentPassword: 'wrong', password: 'new-fixture-password' })).status, 403);
  assert.equal((await f.call('/console/api/password', { currentPassword: PASSWORD, password: 'new-fixture-password' })).status, 200);
  assert.equal((await f.call('/console/api/overview')).status, 401);
  assert.equal((await f.call('/console/api/login', { password: 'new-fixture-password' })).status, 200);
});

test('connector validates destinations and only sends sanitized status and fixed pairing requests', async () => {
  assert.throws(() => validateConfig({ server: 'http://public.example', gateway: 'http://127.0.0.1:50154', token: 'a'.repeat(43) }));
  assert.throws(() => validateConfig({ server: 'https://console.example', gateway: 'http://192.168.1.1:80', token: 'a'.repeat(43) }));
  const config = validateConfig({ server: 'https://console.example', gateway: 'http://127.0.0.1:50154', token: 'a'.repeat(43) });
  const calls = [];
  await tick(config, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/mgw/status')) return { ...status, pendingPairings: [{ code: 'must-not-leak' }], extra: 'private' };
    if (url.endsWith('/connector/poll')) return { task: { type: 'create-pairing', id: NODE } };
    if (url.endsWith('/mgw/pair')) return { qrPayload: pairPayload() };
    return { ok: true };
  });
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/mgw/status', '/connector/poll', '/mgw/pair', '/connector/result']);
  assert.equal(calls[1].options.body.includes('must-not-leak'), false);
  assert.equal(calls[2].options.headers.Authorization, undefined);
  assert.equal(calls[2].options.headers.Origin, config.gateway);
  assert.equal(JSON.parse(calls[3].options.body).ok, true);
});

test('HTTP connector completes a queued web pairing request through the gateway API', async t => {
  const f = await fixture(t, { consoleOptions: { origin: ORIGIN, setupToken: SETUP, masterKey: 'ab'.repeat(32), jobTimeoutMs: 3000 } });
  await f.setup();
  const node = await f.call('/console/api/nodes', { name: 'HTTP integration fixture' });
  const calls = [];
  const gateway = http.createServer((req, res) => {
    calls.push({ path: req.url, method: req.method, authorization: req.headers.authorization, origin: req.headers.origin });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/mgw/status' ? status : { qrPayload: pairPayload() }));
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); });
  const config = validateConfig({ server: f.base, gateway: 'http://127.0.0.1:' + gateway.address().port, token: node.token });
  await tick(config);
  const result = await Promise.all([f.call('/console/api/nodes/' + node.id + '/pair', {}), tick(config)]);
  assert.equal(result[0].status, 201);
  assert.match(result[0].qrImage, /^data:image\/png;base64,/);
  assert.deepEqual(calls.map(c => c.path), ['/mgw/status', '/mgw/status', '/mgw/pair']);
  assert.equal(calls.every(c => c.authorization === undefined), true);
  assert.equal(calls[2].origin, config.gateway);
});

test('web and verified miniapp admins share duration options and persistent pairing records', async t => {
  const f = await fixture(t); await f.setup();
  const login = await f.call('/session', { code: 'wechat-user' }, {}, true);
  const headers = { Authorization: 'Bearer ' + login.token };
  assert.equal((await f.call('/admin/pairings', undefined, headers, true)).status, 403);
  assert.equal((await f.call('/admin/pairings', { nodeId: NODE, days: 3, isAdmin: true }, headers, true)).status, 403);
  await f.call('/console/api/admins', { openid: 'fixture-current-wechat-user', label: '管理测试' });
  const node = await f.call('/console/api/nodes', { name: '同步节点' });
  await f.postConnector(node.token, '/connector/poll', { status });
  assert.equal((await f.call('/admin/pairings', { nodeId: node.id, days: 3 }, headers, true)).code, 'MANAGED_PAIRING_REQUIRED');
  const capable = { ...status, managedPairingVersion: 1 };
  await f.postConnector(node.token, '/connector/poll', { status: capable });
  assert.equal((await f.call('/admin/pairings', { nodeId: node.id, days: 90 }, headers, true)).status, 400);
  const expected = [3, 7, 30, 180, 365];
  assert.deepEqual((await f.call('/admin/pairings', undefined, headers, true)).durations.map(d => d.days), expected);
  let latest;
  for (const days of expected) {
    const pending = days === 365 ? f.call('/console/api/pairings', { nodeId: node.id, days }) : f.call('/admin/pairings', { nodeId: node.id, days }, headers, true);
    let task; for (let i = 0; i < 10 && !task; i++) task = (await f.postConnector(node.token, '/connector/poll', { status: capable })).task;
    assert.ok(task); assert.equal(task.managedAccess.days, days);
    const p = JSON.parse(Buffer.from(pairPayload(), 'base64url')); Object.assign(p, { managedPairingId: task.id, accessDays: days, accessExpiresAt: Date.now() + days * 86400000 });
    await f.postConnector(node.token, '/connector/result', { id: task.id, ok: true, qrPayload: Buffer.from(JSON.stringify(p)).toString('base64url') });
    latest = await pending; assert.equal(latest.status, 201); assert.equal(latest.days, days);
    assert.equal(latest.source, days === 365 ? 'web' : 'weapp');
  }
  const web = await f.call('/console/api/pairings'), mini = await f.call('/admin/pairings', undefined, headers, true);
  assert.deepEqual(web.items, mini.items); assert.equal(web.items.length, 5);
  assert.equal(web.items.some(r => r.qrPayload), false);
  assert.equal(fs.readFileSync(f.stateFile, 'utf8').includes('fixture-pairing-credential'), false);
  const report = { id: latest.id, days: latest.days, expiresAt: latest.expiresAt, accessExpiresAt: latest.accessExpiresAt, status: 'active', deviceId: NODE };
  await f.postConnector(node.token, '/connector/poll', { status: capable, pairings: [report] });
  assert.equal((await f.call('/admin/pairings', undefined, headers, true)).items.find(r => r.id === latest.id).status, 'active');
  await f.postConnector(node.token, '/connector/poll', { status: capable, pairings: [{ ...report, status: 'pending', deviceId: null }] });
  assert.equal((await f.call('/console/api/pairings')).items.find(r => r.id === latest.id).status, 'active', 'Stale reports must not roll back active authorization');
  assert.equal((await f.call('/admin/pairings/' + latest.id + '/revoke', {}, headers, true)).status, 200);
  const poll = await f.postConnector(node.token, '/connector/poll', { status: capable, pairings: [report] });
  assert.deepEqual(poll.revocations, [latest.id]);
  assert.equal((await f.call('/console/api/pairings')).items.find(r => r.id === latest.id).status, 'revoking');
  await f.postConnector(node.token, '/connector/poll', { status: capable, pairings: [{ ...report, status: 'revoked' }] });
  assert.equal((await f.call('/console/api/pairings')).items.find(r => r.id === latest.id).status, 'revoked');
  await f.call('/console/api/admins/remove', { openid: 'fixture-current-wechat-user' });
  assert.equal((await f.call('/admin/pairings', undefined, headers, true)).status, 403);
});

test('managed issuance rejects a gateway that silently ignores the access policy', async t => {
  const f = await fixture(t); await f.setup();
  const node = await f.call('/console/api/nodes', { name: '旧插件' });
  const capable = { ...status, managedPairingVersion: 1 };
  await f.postConnector(node.token, '/connector/poll', { status: capable });
  const pending = f.call('/console/api/pairings', { nodeId: node.id, days: 3 });
  let task; for (let i = 0; i < 10 && !task; i++) task = (await f.postConnector(node.token, '/connector/poll', { status: capable })).task;
  await f.postConnector(node.token, '/connector/result', { id: task.id, ok: true, qrPayload: pairPayload() });
  assert.equal((await pending).code, 'ACCESS_POLICY_MISMATCH');
  assert.equal((await f.call('/console/api/pairings')).items[0].status, 'failed');
});

test('HTTP connector transports managed policy and confirms revocation in shared server history', async t => {
  const f = await fixture(t, { consoleOptions: { origin: ORIGIN, setupToken: SETUP, masterKey: 'ab'.repeat(32), jobTimeoutMs: 3000 } });
  await f.setup(); const node = await f.call('/console/api/nodes', { name: '限时 HTTP 联调' });
  const records = [];
  const gateway = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; let result;
    if (req.url === '/mgw/status') result = { ...status, managedPairingVersion: 1 };
    else if (req.url === '/mgw/managed-pairings') result = { items: records };
    else if (req.url === '/mgw/pair') {
      assert.equal(body.managedAccess.days, 365);
      const p = JSON.parse(Buffer.from(pairPayload(), 'base64url'));
      Object.assign(p, { managedPairingId: body.managedAccess.id, accessDays: 365, accessExpiresAt: Date.now() + 365 * 86400000 });
      records.push({ id: body.managedAccess.id, days: 365, expiresAt: p.expiresAt, accessExpiresAt: p.accessExpiresAt, status: 'pending', deviceId: null });
      result = { qrPayload: Buffer.from(JSON.stringify(p)).toString('base64url') };
    } else {
      assert.equal(req.url, '/mgw/managed-pairings/' + records[0].id + '/revoke'); records[0].status = 'revoked'; result = { revoked: true };
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => { gateway.closeAllConnections(); await new Promise(resolve => gateway.close(resolve)); });
  const config = validateConfig({ server: f.base, gateway: 'http://127.0.0.1:' + gateway.address().port, token: node.token });
  await tick(config);
  const [result] = await Promise.all([f.call('/console/api/pairings', { nodeId: node.id, days: 365 }), tick(config)]);
  assert.equal(result.status, 201); assert.equal(result.days, 365);
  await f.call('/console/api/pairings/' + result.id + '/revoke', {}); await tick(config);
  assert.equal((await f.call('/console/api/pairings')).items[0].status, 'revoking');
  await tick(config); assert.equal((await f.call('/console/api/pairings')).items[0].status, 'revoked');
});

test('removing an administrator during issuance withholds and revokes the resulting credential', async t => {
  const f = await fixture(t); await f.setup();
  const login = await f.call('/session', { code: 'wechat-user' }, {}, true);
  const headers = { Authorization: 'Bearer ' + login.token };
  await f.call('/console/api/admins', { openid: 'fixture-current-wechat-user', label: '临时管理员' });
  const node = await f.call('/console/api/nodes', { name: '身份变更测试' }), capable = { ...status, managedPairingVersion: 1 };
  await f.postConnector(node.token, '/connector/poll', { status: capable });
  const pending = f.call('/admin/pairings', { nodeId: node.id, days: 7 }, headers, true);
  let task; for (let i = 0; i < 10 && !task; i++) task = (await f.postConnector(node.token, '/connector/poll', { status: capable })).task;
  assert.ok(task); await f.call('/console/api/admins/remove', { openid: 'fixture-current-wechat-user' });
  const p = JSON.parse(Buffer.from(pairPayload(), 'base64url')); Object.assign(p, { managedPairingId: task.id, accessDays: 7, accessExpiresAt: Date.now() + 7 * 86400000 });
  await f.postConnector(node.token, '/connector/result', { id: task.id, ok: true, qrPayload: Buffer.from(JSON.stringify(p)).toString('base64url') });
  const response = await pending; assert.equal(response.status, 403); assert.equal(response.qrPayload, undefined);
  assert.equal((await f.call('/console/api/pairings')).items[0].status, 'revoking');
});
