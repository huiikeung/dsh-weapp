'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createService } = require('../server.cjs');
const { DEFAULT_RULES } = require('../engagement.cjs');
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-announcement-test-'));
  const stateFile = path.join(dir, 'state.json'), origin = 'http://127.0.0.1:8790';
  let server, base, cookie = '', csrf = '', clock = Date.now();
  const password = 'test-announcement-password';
  const options = { stateFile, now: () => clock, exchangeCode: async code => 'verified-wechat-' + code,
    consoleOptions: { origin, masterKey: 'ac'.repeat(32), setupToken: 'announcement-test-setup-token-only' } };
  async function start() { server = createService(options); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; }
  async function stop() { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  await start();
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  async function call(route, input, token, headers = {}) {
    const response = await fetch(base + route, { method: input === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(route.startsWith('/console/api') ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const result = await response.json(); if (result.csrf) csrf = result.csrf;
    return { ...result, status: response.status };
  }
  await call('/console/api/setup', { password, setupToken: options.consoleOptions.setupToken });
  return { call, login: code => call('/session', { code }), tick: () => { clock += 1; },
    restart: async () => { await stop(); await start(); cookie = ''; csrf = ''; await call('/console/api/login', { password }); } };
}
test('public announcements, two admin channels, validation, conflict, persistence and deletion', async t => {
  const f = await fixture(t), admin = await f.login('alice'), user = await f.login('bob');
  assert.deepEqual((await f.call('/app-content')).items, []);
  assert.equal((await f.call('/app-content')).shareEnabled, false);
  await f.call('/console/api/admins/device', { deviceId: admin.account.deviceId, label: 'Alice' });
  const input = { title: '插件更新', content: '第一行\n第二行 <script>不可执行</script>' };
  assert.equal((await f.call('/admin/announcements', input)).status, 401);
  assert.equal((await f.call('/admin/announcements', input, user.token)).status, 403);
  assert.equal((await f.call('/console/api/announcements', input, null, { 'X-CSRF-Token': 'wrong' })).status, 403);
  const first = await f.call('/console/api/announcements', input);
  assert.equal(first.status, 201); assert.equal(first.item.revision, 1);
  assert.deepEqual((await f.call('/admin/announcements', undefined, admin.token)).items, [first.item]);
  assert.deepEqual((await f.call('/app-content')).items, [first.item]);
  for (const bad of [{ title: '', content: 'x' }, { title: 'x'.repeat(61), content: 'x' }, { title: 'x', content: 'x'.repeat(3001) }, { title: {}, content: 'x' }, { ...input, id: 'bad' }]) {
    assert.equal((await f.call('/admin/announcements', bad, admin.token)).status, 400);
  }
  const updated = await f.call('/admin/announcements', { ...input, id: first.item.id, revision: 1, content: '小程序修改' }, admin.token);
  assert.equal(updated.item.revision, 2);
  assert.equal((await f.call('/console/api/announcements', { ...input, id: first.item.id, revision: 1 })).status, 409);
  f.tick(); const second = await f.call('/admin/announcements', { title: '最新公告', content: '不需要公网订阅也能查看' }, admin.token);
  assert.equal((await f.call('/app-content')).items[0].id, second.item.id);
  await f.restart();
  assert.equal((await f.call('/app-content')).items[1].content, '小程序修改');
  const admin2 = await f.login('alice');
  assert.equal((await f.call('/admin/announcements/' + first.item.id + '/delete', { revision: 1 }, admin2.token)).status, 409);
  assert.equal((await f.call('/console/api/announcements/' + first.item.id + '/delete', { revision: 2 })).status, 200);
  assert.equal((await f.call('/admin/announcements', undefined, admin2.token)).items.length, 1);
  await f.call('/console/api/admins/remove', { openid: 'verified-wechat-alice' });
  assert.equal((await f.call('/admin/announcements', input, admin2.token)).status, 403);
});
test('share switch synchronizes both admin channels, preserves rewards and prevents old invite grants', async t => {
  const f = await fixture(t), admin = await f.login('alice'), user = await f.login('bob');
  await f.call('/console/api/admins/device', { deviceId: admin.account.deviceId });
  assert.equal((await f.call('/admin/share/enabled', { enabled: true }, user.token)).status, 403);
  assert.equal((await f.call('/admin/share/enabled', { enabled: 'true' }, admin.token)).status, 400);
  assert.equal((await f.call('/console/api/share/enabled', { enabled: true }, null, { 'X-CSRF-Token': 'bad' })).status, 403);
  assert.equal((await f.call('/admin/share/enabled', { enabled: true }, admin.token)).shareEnabled, true);
  const rule = (await f.call('/console/api/share')).rules;
  assert.deepEqual(rule.tiers, DEFAULT_RULES.tiers); assert.equal(rule.momentsDays, DEFAULT_RULES.momentsDays);
  const invite = await f.call('/share/invite', {}, user.token), friend = await f.login('friend');
  assert.equal((await f.call('/share/open', { token: invite.inviteToken }, friend.token)).counted, true);
  const expiry = (await f.call('/me', undefined, user.token)).account.publicAccessExpiresAt;
  assert.equal((await f.call('/console/api/share/enabled', { enabled: false })).shareEnabled, false);
  assert.equal((await f.call('/app-content')).shareEnabled, false);
  const next = await f.login('next');
  assert.equal((await f.call('/share/open', { token: invite.inviteToken }, next.token)).code, 'CAMPAIGN_PAUSED');
  assert.equal((await f.call('/share/invite', {}, user.token)).code, 'CAMPAIGN_PAUSED');
  assert.equal((await f.call('/me', undefined, user.token)).account.publicAccessExpiresAt, expiry);
  await f.restart(); assert.equal((await f.call('/app-content')).shareEnabled, false);
  assert.equal((await f.login('bob')).account.publicAccessExpiresAt, expiry);
});
test('legacy administrators retain access and resolve to the same WX device ID without exposing alternate binding controls', async t => {
  const f = await fixture(t);
  await f.call('/console/api/admins', { openid: 'verified-wechat-legacy', label: 'Legacy' });
  const before = (await f.call('/console/api/overview')).admins[0]; assert.equal(before.deviceId, '');
  const user = await f.login('legacy'); assert.equal(user.account.isAdmin, true);
  const after = (await f.call('/console/api/overview')).admins[0]; assert.equal(after.deviceId, user.account.deviceId); assert.match(after.deviceId, /^WX-[A-F0-9]{24}$/);
  await f.call('/console/api/admins/device', { deviceId: user.account.deviceId });
  assert.equal((await f.call('/console/api/overview')).admins.length, 1);
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.ok(html.includes('id="device-admin-id"')); assert.ok(!html.includes('id="binding-form"')); assert.ok(!html.includes('id="admin-form"'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8').includes('announcements.cjs'));
});
