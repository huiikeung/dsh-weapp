'use strict';
// 公网租赁必须跨服务端重启存活：否则每次升级服务端，所有把旧 token 缓存在本地的手机
// 都会一直连不上（旧 lease 只在内存 Map 里，重启即失效）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../server.cjs');
const DAY = 86400000, ORIGIN = 'http://127.0.0.1:8790';
const PASSWORD = 'lease-fixture-password';
const INTERNAL = 'lease-fixture-internal-relay-secret-0001';
const NODE = 'fixture-node-0001', DEVICE = 'fixture-device-0001';

async function boot(t, dir) {
  const stateFile = path.join(dir, 'state.json');
  const options = { stateFile, relayAuthSecret: INTERNAL, now: () => Date.parse('2026-10-18T01:00:00Z'),
    exchangeCode: async code => /^[a-z0-9-]+$/.test(code) ? 'wechat-verified-' + code : '',
    consoleOptions: { origin: ORIGIN, masterKey: 'ab'.repeat(32), setupToken: 'lease-fixture-setup-token-32chars' } };
  let server = createService(options);
  let base = '';
  const booted = async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port; };
  await booted();
  let cookie = '', csrf = '';
  async function call(route, data, token) {
    const isWeb = route.startsWith('/console/api');
    const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(isWeb ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const value = await response.json(); if (value.csrf) csrf = value.csrf;
    return { ...value, status: response.status };
  }
  return {
    stateFile, options, call, dir,
    setup: async () => {
      const created = await call('/console/api/setup', { password: PASSWORD, setupToken: options.consoleOptions.setupToken });
      // 复用同一个数据目录时后台已经初始化过，改为用密码登录拿 cookie/CSRF。
      if (created.status !== 200) await call('/console/api/login', { password: PASSWORD });
      return created;
    },
    restart: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); server = createService(options); await booted(); cookie = ''; csrf = ''; await call('/console/api/login', { password: PASSWORD }); },
    stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function issueLease(f) {
  const admin = await f.call('/session', { code: 'lease-admin' });
  await f.call('/console/api/admins/device', { deviceId: admin.account.deviceId });
  const code = await f.call('/admin/codes', { days: 30, uses: 1 }, admin.token);
  assert.equal(code.status, 201);
  const user = await f.call('/session', { code: 'lease-user' });
  assert.equal((await f.call('/redemptions', { code: code.code }, user.token)).status, 200);
  const lease = await f.call('/public-access/lease', { nodeId: NODE, deviceId: DEVICE }, user.token);
  assert.equal(lease.status, 201);
  assert.match(lease.token, /^[A-Za-z0-9_-]{43}$/);
  return lease;
}

const authorize = (f, token) => f.call('/internal/relay/authorize', { token, nodeId: NODE, deviceId: DEVICE }, INTERNAL);

test('a public lease keeps working across a service restart', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lease-persist-'));
  const f = await boot(t, dir);
  t.after(async () => { await f.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await f.setup();
  const lease = await issueLease(f);
  assert.equal((await authorize(f, lease.token)).status, 200, 'lease authorizes while the process is up');
  assert.ok(fs.existsSync(path.join(dir, 'leases.json')), 'the lease is persisted next to state.json');

  await f.restart();
  const after = await authorize(f, lease.token);
  assert.equal(after.status, 200, 'the same token still authorizes after restart');
  assert.equal(after.allowed, true);
  assert.equal((await authorize(f, 'x'.repeat(43))).status, 401, 'unknown tokens stay rejected');
});

test('expired leases and a corrupt lease file never block boot', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lease-expire-'));
  fs.writeFileSync(path.join(dir, 'leases.json'), JSON.stringify({
    ['a'.repeat(64)]: { openid: 'wechat-verified-x', nodeId: NODE, deviceId: DEVICE, expiresAt: Date.parse('2020-01-01T00:00:00Z') }
  }));
  const f = await boot(t, dir);
  t.after(async () => { await f.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await f.setup();
  assert.equal((await authorize(f, 'x'.repeat(43))).status, 401, 'expired leases are not restored');

  await f.stop();
  fs.writeFileSync(path.join(dir, 'leases.json'), 'not-json{{');
  const broken = await boot(t, dir);
  t.after(async () => { await broken.stop(); });
  await broken.setup();
  const lease = await issueLease(broken);
  assert.equal((await authorize(broken, lease.token)).status, 200, 'a corrupt lease file is ignored, not fatal');
});
