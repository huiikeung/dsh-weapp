'use strict';
// 兑换码档位白名单：新增档位（1 天 / 季度 / 2 年 / 3 年 / 长期、50/100 次）必须由服务端放行，
// 且非法档位仍要 400，避免小程序选了却被拒。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../server.cjs');
const DAY = 86400000, ORIGIN = 'http://127.0.0.1:8790';
const PASSWORD = 'code-tiers-fixture-password';
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-code-tiers-'));
  let clock = Date.parse('2026-10-18T01:00:00Z');
  const options = { stateFile: path.join(dir, 'state.json'), now: () => clock,
    exchangeCode: async code => /^[a-z0-9-]+$/.test(code) ? 'wechat-verified-' + code : '',
    consoleOptions: { origin: ORIGIN, masterKey: 'ab'.repeat(32), setupToken: 'fixture-setup-token-only-for-tests-32chars' } };
  const server = createService(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
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
  await call('/console/api/setup', { password: PASSWORD, setupToken: options.consoleOptions.setupToken });
  const admin = await call('/session', { code: 'admin' });
  await call('/console/api/admins/device', { deviceId: admin.account.deviceId });
  return { call, admin, tick: ms => { clock += ms; } };
}
test('every offered duration and use count is accepted, illegal values still rejected', async (t) => {
  const { call, admin, tick } = await fixture(t);
  const days = [1, 3, 7, 30, 60, 90, 180, 365, 730, 1095, 3650];
  const uses = [1, 5, 20, 50, 100];
  let created = 0;
  // 服务端对签发限流 10 次/分钟，批量校验时推进时钟绕过窗口。
  const create = (body) => { if (created++ % 10 === 9) tick(61000); return call('/admin/codes', body, admin.token); };
  for (const day of days) {
    const result = await create({ days: day, uses: 1 });
    assert.equal(result.status, 201, 'days ' + day + ' must be accepted');
    assert.equal(result.days, day);
  }
  for (const use of uses) {
    const result = await create({ days: 30, uses: use });
    assert.equal(result.status, 201, 'uses ' + use + ' must be accepted');
    assert.equal(result.uses, use);
  }
  for (const bad of [0, 2, 14, 366, 4000, -7]) {
    const rejected = await create({ days: bad, uses: 1 });
    assert.equal(rejected.status, 400, 'days ' + bad + ' must stay rejected');
    assert.equal(rejected.code, 'INVALID_CODE_OPTIONS');
  }
  for (const bad of [0, 2, 200, -1]) {
    const rejected = await create({ days: 30, uses: bad });
    assert.equal(rejected.status, 400, 'uses ' + bad + ' must stay rejected');
  }
});
test('a long-term code grants the full duration on redemption', async (t) => {
  const { call, admin } = await fixture(t);
  const user = await call('/session', { code: 'long-term-user' });
  const created = await call('/admin/codes', { days: 3650, uses: 1 }, admin.token);
  assert.equal(created.status, 201);
  const redeemed = await call('/redemptions', { code: created.code }, user.token);
  assert.equal(redeemed.status, 200);
  const me = await call('/me', undefined, user.token);
  assert.ok(me.account.publicAccessExpiresAt > Date.parse('2030-01-01T00:00:00Z'), '3650 天应当远远超过 2030 年');
  assert.ok(me.account.publicAccessExpiresAt <= Date.parse('2026-10-18T01:00:00Z') + 3650 * DAY);
});
