const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHostInfo, hostDisplay } = require('../miniprogram/utils/host-info');

test('host frame maps Remote Gateway metadata without treating its transport name as a version', () => {
  const host = normalizeHostInfo({ version: 'remote-gateway', dshVersion: '0.1.7-rc.2', defaultProvider: 'deepseek', defaultModel: 'deepseek-flash', cwd: '/workspace', attachedSessions: 0, canOpenPath: false });
  assert.deepEqual(host, { version: '0.1.7-rc.2', provider: 'deepseek', model: 'deepseek-flash', cwd: '/workspace', attachedSessions: 0, canOpenPath: false });
  assert.deepEqual(normalizeHostInfo(host), host);
  assert.equal(normalizeHostInfo({ version: 'remote-gateway' }).version, '');
  assert.equal(normalizeHostInfo({ dshVersion: 'unknown', version: 'v1.2.3+build.4' }).version, 'v1.2.3+build.4');
});

test('host display supports legacy frames and same-provider catalog labels', () => {
  const app = { host: { version: '1.2.3', provider: 'legacy', model: 'm1' }, modelCatalog: { groups: [{ id: 'legacy', name: '本地服务商', models: [{ id: 'm1', name: '模型一' }] }] } };
  assert.deepEqual(hostDisplay(app), { version: '1.2.3', provider: '本地服务商', model: '模型一' });
  app.defaultModel = { provider: 'another', model: 'm1' };
  assert.deepEqual(hostDisplay(app), { version: '1.2.3', provider: 'another', model: 'm1' });
  app.defaultModel = { model: 'new-model' };
  assert.equal(hostDisplay(app).provider, '未提供');
  assert.equal(hostDisplay(app).model, 'new-model');
});

test('missing host data stays explicit and session selection is not mistaken for host defaults', () => {
  assert.deepEqual(hostDisplay({}), { version: '未提供', provider: '未提供', model: '未提供' });
  assert.equal(hostDisplay({ modelCatalog: { current: { provider: 'session-only', model: 'session-model' } } }).model, '未提供');
  assert.equal(normalizeHostInfo({defaultModel:'new',provider:'old-provider',model:'old'}).provider, '');
});
