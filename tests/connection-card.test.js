const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

global.wx = { getStorageSync: () => null, setStorageSync() {}, getAppBaseInfo: () => ({ language: 'zh_CN' }) };
const card = require(path.resolve(__dirname, '../miniprogram/pages/settings/utils/connection-card'));

test('transport label distinguishes relay, public and LAN nodes', () => {
  assert.equal(card.transportLabel({ relay: true }, ''), '公网中继');
  assert.equal(card.transportLabel({}, 'wss://edge.example.com/relay'), '公网直连');
  assert.equal(card.transportLabel({}, 'ws://127.0.0.1:9000'), '局域网直连');
  assert.equal(card.transportLabel({}, 'ws://192.168.1.8:9000'), '局域网直连');
  assert.equal(card.transportLabel(null, ''), '');
});

test('status tones follow the shared connection semantics', () => {
  assert.deepEqual(card.statusOf({ key: 'connected' }), { label: '运行正常', tone: 'ok' });
  assert.equal(card.statusOf({ key: 'connecting' }).tone, 'warn');
  assert.equal(card.statusOf({ key: 'dropped' }).tone, 'bad');
  assert.equal(card.statusOf({ key: 'failed' }).tone, 'bad');
  assert.equal(card.statusOf({ key: 'disconnected' }).tone, 'off');
  assert.equal(card.statusOf(undefined).tone, 'off');
});

test('version label normalises reported versions and falls back to the plugin catalog', () => {
  assert.equal(card.versionLabel('0.21.0'), 'v0.21.0');
  assert.equal(card.versionLabel('v1.2.3'), 'v1.2.3');
  assert.equal(card.versionLabel('not-a-version'), '');
  const withMetadata = card.connectionCardView({ profiles: [], gatewayMetadata: { version: '0.21.0' } });
  assert.equal(withMetadata.versionLabel, 'v0.21.0');
  assert.equal(withMetadata.versionKnown, true);
  const fromCatalog = card.connectionCardView({
    profiles: [], gatewayMetadata: {},
    pluginCatalog: { bundles: [{ name: 'dsh-plugin-weapp-gateway', version: '0.8.52' }] }
  });
  assert.equal(fromCatalog.versionLabel, 'v0.8.52', 'old gateways report their version through the plugin catalog');
  const unknown = card.connectionCardView({ profiles: [] });
  assert.equal(unknown.versionLabel, '版本未上报');
  assert.equal(unknown.versionKnown, false);
});

test('the card projects counts and never leaks the endpoint', () => {
  const view = card.connectionCardView({
    profiles: [{ id: 'n1', gatewayName: 'VM-4-12-ubuntu', endpoints: ['wss://secret.example.com/relay'] }],
    activeID: 'n1',
    connection: 'connected',
    endpoint: 'wss://secret.example.com/relay',
    sessions: [{}, {}],
    workspaces: [{}],
    scheduledTasks: [],
    gatewayMetadata: { version: '0.21.0' }
  }, { publicStatusLabel: '已开通' });
  assert.equal(view.name, 'VM-4-12-ubuntu');
  assert.equal(view.subtitle, '公网直连 · 已连接');
  assert.equal(view.statusLabel, '运行正常');
  assert.equal(view.statusTone, 'ok');
  assert.deepEqual(view.stats.map(item => item.key), ['sessions', 'workspaces', 'tasks', 'plugins', 'nodes']);
  assert.deepEqual(view.stats.map(item => item.value), ['2', '1', '0', '0', '1']);
  // 首页/设置共用的卡片只做展示，公网地址与凭据不得进入视图模型。
  assert.doesNotMatch(JSON.stringify(view), /wss?:\/\//);
});

test('the plugin column counts enabled bundles only', () => {
  const view = card.connectionCardView({
    profiles: [],
    pluginCatalog: { bundles: [{ name: 'a', enabled: true }, { name: 'b', enabled: false }, { name: 'c' }] }
  });
  const plugins = view.stats.find(item => item.key === 'plugins');
  assert.equal(plugins.value, '2', 'disabled bundles are not counted');
});

test('an unpaired app still renders a placeholder host name', () => {
  const view = card.connectionCardView({ profiles: [], connection: 'disconnected' });
  assert.equal(view.name, '未命名节点');
  assert.equal(view.statusLabel, '未连接');
  assert.equal(view.statusTone, 'off');
  assert.equal(view.subtitle, '未连接');
});
