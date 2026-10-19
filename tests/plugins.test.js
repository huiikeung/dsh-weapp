'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { buildCatalog } = require('../miniprogram/utils/plugins');
const { createInstaller } = require('../miniprogram/utils/plugin-install');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const state = { activeID: 'host-a', connection: 'connected', pluginCatalog: { managementAvailable: true } };
  const calls = []; let refreshes = 0;
  const client = { requestPlugin(type, payload = {}, timeout) {
    return new Promise((resolve, reject) => calls.push({ type, payload, timeout, resolve, reject }));
  } };
  const api = createInstaller({ state, client, emit() {}, refresh() { refreshes++; } });
  return { api, state, calls, get refreshes() { return refreshes; } };
}
async function ready(f) {
  const p = f.api.inspect('example-plugin');
  f.calls.at(-1).resolve({ result: { status: 'accepted', name: 'example-plugin', version: '1.0.0', registry: 'https://registry.example.test/' } });
  await p;
}

test('desktop builtin order, pinned experiments, More and third-party groups', () => {
  const names = ['tool-worktree', 'inspector-profile', 'voice-input-bundle', 'auto-review', 'agent-team-profile'];
  const raw = names.map(n => ({ name: '@deepseek-ai/dsh-experimental-' + n, official: true, optional: true }));
  raw.push({ name: 'third-party', installed: true, enabled: true });
  raw.push({ name: '@deepseek-ai/dsh-base', installed: true, official: true });
  raw.push({ name: '@deepseek-ai/dsh-subagent-codex', official: true, optional: false });
  let c = buildCatalog({ managementAvailable: true, bundles: raw, officialItems: ['shell', 'agent-loop', 'web-search', 'subagent'].map(id => ({ id })) });
  assert.deepEqual(c.officialItems.map(x => x.id), ['subagent', 'web-search', 'agent-loop', 'shell']);
  assert.deepEqual(c.featuredBundles.map(x => x.name.split('experimental-')[1]), ['agent-team-profile', 'voice-input-bundle', 'auto-review', 'inspector-profile']);
  assert.equal(c.moreBundles.length, 6);
  assert.deepEqual(c.installedBundles.map(x => x.name), ['third-party']);
  raw[0].enabled = true; raw[0].installed = true;
  c = buildCatalog({ bundles: raw });
  assert.ok(c.featuredBundles.some(x => x.name === raw[0].name), 'enabled official installs stay in experiments');
  assert.ok(!c.installedBundles.some(x => x.name === raw[0].name));
});

test('install requires inspection and explicit confirmation, uses inspected registry', async () => {
  const f = fixture();
  await f.api.start(true); assert.equal(f.calls.length, 0);
  await ready(f); assert.equal(f.state.pluginInstall.phase, 'ready');
  assert.equal(f.calls.length, 1, 'inspection never starts installation');
  const p = f.api.start(false); const call = f.calls.at(-1);
  assert.equal(call.type, 'plugin-install');
  assert.equal(call.payload.enabled, false);
  assert.equal(call.payload.registry, 'https://registry.example.test/');
  assert.ok(call.payload.requestId);
  f.api.handle({ kind: 'plugin-install-state', requestId: call.payload.requestId, phase: 'applying' });
  assert.equal(f.state.pluginInstall.phase, 'applying');
  call.resolve({ result: { application: 'restart-required', bundle: 'example-plugin' } });
  await p; assert.equal(f.state.pluginInstall.phase, 'done'); assert.match(f.state.pluginInstall.message, /重启 DSH/);
  assert.equal(f.refreshes, 1);
});

test('refused, disconnected and readonly requests do not install', async () => {
  const f = fixture();
  f.state.connection = 'disconnected'; await assert.rejects(f.api.inspect('x'), /连接/);
  f.state.connection = 'connected'; f.state.pluginCatalog.managementAvailable = false;
  await assert.rejects(f.api.inspect('x'), /不支持/); assert.equal(f.calls.length, 0);
  f.state.pluginCatalog.managementAvailable = true;
  const p = f.api.inspect('x'); f.calls[0].resolve({ result: { status: 'refused', problem: 'already-installed' } }); await p;
  assert.equal(f.state.pluginInstall.phase, 'failed'); await f.api.start(true); assert.equal(f.calls.length, 1);
  await assert.rejects(f.api.inspect('x', 'javascript:alert(1)'), /HTTP/);
});

test('disconnect recovery uses original install ID and blocks duplicate installs', async () => {
  const f = fixture(); await ready(f);
  const pending = f.api.start(false), original = f.calls.at(-1);
  f.state.connection = 'disconnected'; f.api.connectionChanged('disconnected');
  original.reject(new Error('offline')); await pending;
  assert.equal(f.state.pluginInstall.phase, 'unconfirmed'); assert.equal(f.api.reset(), false);
  f.state.connection = 'connected'; f.api.connectionChanged('connected');
  const status = f.calls.at(-1); assert.equal(status.type, 'plugin-install-status');
  assert.equal(status.payload.installId, original.payload.requestId);
  await assert.rejects(f.api.inspect('another'), /已有安装任务/);
  status.resolve({ result: { application: 'applied' } }); await tick();
  assert.equal(f.state.pluginInstall.phase, 'done');
  assert.equal(f.calls.filter(c => c.type === 'plugin-install').length, 1);
});

test('late host responses never populate a different host and tasks survive navigation', async () => {
  const f = fixture(); await ready(f);
  const pending = f.api.start(false), call = f.calls.at(-1);
  f.state.activeID = 'host-b'; f.api.connectionChanged('connected');
  assert.equal(f.state.pluginInstall, null);
  call.resolve({ result: { application: 'applied' } }); await pending;
  assert.equal(f.state.pluginInstall, null); assert.equal(f.refreshes, 0);
  f.state.activeID = 'host-a'; f.api.connectionChanged('connected');
  assert.equal(f.state.pluginInstall.phase, 'done');
});

test('cancel acknowledgement is not treated as a final result', async () => {
  const f = fixture(); await ready(f);
  const installing = f.api.start(false), installCall = f.calls.at(-1);
  const cancelling = f.api.cancel(), cancelCall = f.calls.at(-1);
  cancelCall.resolve({ result: { status: 'too-late' } }); await cancelling;
  assert.equal(f.state.pluginInstall.phase, 'installing');
  assert.match(f.state.pluginInstall.message, /无法取消/);
  assert.equal(f.calls.at(-1).type, 'plugin-install-status');
  f.calls.at(-1).resolve({ result: { application: 'applied' } }); await tick();
  installCall.resolve({ result: { application: 'applied' } }); await installing;
  assert.equal(f.state.pluginInstall.phase, 'done'); assert.equal(f.refreshes, 1);
});

test('build scripts require explicit exact approval and logs are bounded', async () => {
  const f = fixture(); await ready(f);
  const running = f.api.start(false), call = f.calls.at(-1), id = call.payload.requestId;
  f.api.handle({ kind: 'plugin-install-log', requestId: 'different', text: 'ignore' });
  assert.equal(f.state.pluginInstall.logs, '');
  f.api.handle({ kind: 'plugin-install-log', requestId: id, text: 'x'.repeat(20000) });
  assert.equal(f.state.pluginInstall.logs.length, 16000);
  call.resolve({ result: { application: 'failed', pendingBuilds: ['native-dep'], error: { message: 'needs approval' } } }); await running;
  assert.throws(() => f.api.approveBuilds(['other']), /明确批准/);
  const retry = f.api.approveBuilds(['native-dep']);
  assert.deepEqual(f.calls.at(-1).payload.approvedBuilds, ['native-dep']);
  assert.notEqual(f.calls.at(-1).payload.requestId, id);
  f.calls.at(-1).resolve({ result: { application: 'applied' } }); await retry;
  assert.equal(f.state.pluginInstall.phase, 'done');
});

test('closed inspection ignores its late result and reconnect invalidates confirmation', async () => {
  const f = fixture(); const p = f.api.inspect('x'); f.api.reset();
  f.calls[0].resolve({ result: { status: 'accepted' } }); await p; assert.equal(f.state.pluginInstall, null);
  await ready(f); f.state.connection = 'disconnected'; f.api.connectionChanged('disconnected');
  assert.equal(f.state.pluginInstall.phase, 'failed');
});

test('uncertain tasks survive app restart without persisting logs or registry credentials', async () => {
  const memory = new Map();
  global.wx = { getStorageSync: k => memory.get(k), setStorageSync: (k, v) => memory.set(k, v) };
  try {
    const f = fixture(); await ready(f);
    const p = f.api.start(false), install = f.calls.at(-1);
    const saved = memory.get('dsh_plugin_install_tasks_v1')[0];
    assert.deepEqual(Object.keys(saved).sort(), ['installId', 'owner', 'spec']);
    const restored = fixture(); restored.api.connectionChanged('connected');
    assert.equal(restored.calls[0].type, 'plugin-install-status');
    assert.equal(restored.calls[0].payload.installId, install.payload.requestId);
    restored.calls[0].resolve({ result: { application: 'applied' } }); await tick();
    install.resolve({ result: { application: 'applied' } }); await p;
    assert.equal(memory.get('dsh_plugin_install_tasks_v1').length, 0);
  } finally { delete global.wx; }
});

test('gateway correlates renamed results by ID, never by progress kind', async () => {
  const client = Object.create(GatewayClient.prototype); client.pendingRequests = {};
  const sent = []; client.send = frame => { sent.push(frame); return true; };
  const a = client.requestPlugin('plugin-inspect', { spec: 'a' });
  const b = client.requestPlugin('plugin-inspect', { spec: 'b' });
  client.resolveCorrelated({ kind: 'plugin-inspection', requestId: sent[1].requestId, result: { name: 'b' } });
  client.resolveCorrelated({ kind: 'plugin-inspection', requestId: sent[0].requestId, result: { name: 'a' } });
  assert.equal((await a).result.name, 'a'); assert.equal((await b).result.name, 'b');
  const install = client.requestPlugin('plugin-install', { requestId: 'install-id', spec: 'x' });
  client.resolveCorrelated({ kind: 'plugin-install-state', requestId: 'install-id', phase: 'installing' });
  assert.ok(client.pendingRequests['plugin:install-id']);
  client.resolveCorrelated({ kind: 'plugin-install-result', requestId: 'install-id', result: { application: 'applied' } }); await install;
  const rejected = client.requestPlugin('plugin-inspect', { requestId: 'reject', spec: 'bad' });
  client.resolveCorrelated({ kind: 'error', requestId: 'reject', requestType: 'plugin-inspect', message: 'bad spec' });
  await assert.rejects(rejected, /bad spec/);
  client.send = () => false; await assert.rejects(client.requestPlugin('plugin-inspect', { spec: 'x' }), /连接/);
  assert.equal(Object.keys(client.pendingRequests).length, 0);
});

test('unknown and cancelled install outcomes remain distinct from success', async () => {
  const f = fixture(); await ready(f);
  const p = f.api.start(false); f.calls.at(-1).reject(new Error('timeout')); await p;
  const check = f.api.reconcile(); f.calls.at(-1).resolve({ result: null }); await check;
  assert.equal(f.state.pluginInstall.phase, 'unknown');
  await ready(f); const next = f.api.start(false);
  f.calls.at(-1).resolve({ result: { application: 'cancelled' } }); await next;
  assert.equal(f.state.pluginInstall.phase, 'cancelled');
  assert.equal(f.refreshes, 2);
});

test('store routes installation broadcasts without corrupting catalog errors', async () => {
  const root = path.join(__dirname, '..', 'miniprogram'), file = path.join(root, 'utils/store.js');
  let client; const sent = [];
  class Client {
    constructor(cb) { this.cb = cb; client = this; }
    requestPlugin(type, payload) { return Promise.resolve({ result: { status: 'accepted', name: payload.spec } }); }
    sendPluginCatalog(id) { sent.push(id); return true; }
  }
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, console, Date, Set,
    wx: { getStorageSync() {}, setStorageSync() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    require: name => name === './gateway' ? { GatewayClient: Client } : require(path.resolve(path.dirname(file), name)) });
  const store = mod.exports; store.state.activeID = 'store-host'; store.state.connection = 'connected';
  store.state.pluginCatalog = buildCatalog({ managementAvailable: true });
  await store.pluginInstaller.inspect('example-plugin');
  assert.equal(store.state.pluginInstall.phase, 'ready');
  client.cb.onFrame({ kind: 'plugin-install-log', requestId: 'unrelated', text: 'ignored' });
  assert.equal(store.state.pluginsError, null);
  client.cb.onFrame({ kind: 'error', requestType: 'plugin-inspect', requestId: 'unrelated', message: 'not found' });
  assert.equal(store.state.pluginsError, null);
  client.cb.onFrame({ kind: 'error', message: 'unknown message type: plugin-market-indexes' });
  client.cb.onFrame({ kind: 'error', requestType: 'plugin-market-set-indexes', message: 'invalid index' });
  assert.equal(store.state.pluginsError, null);
  assert.equal(store.state.pluginNotice, null);
  assert.equal(store.state.pluginInstall.phase, 'ready');
});

test('page binds every handler and displays desktop sections, More and install actions', () => {
  const root = path.join(__dirname, '..', 'miniprogram'); let definition;
  const fakeStore = { state: { activeID: 'a', connection: 'connected', pluginCatalog: buildCatalog({ managementAvailable: true, bundles: [], officialItems: [] }) }, subscribe: () => () => {}, refreshPlugins() {} };
  const load = file => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { module, Page: d => { definition = d; }, Set,
      require: name => name.endsWith('/store') ? fakeStore : name.endsWith('/theme') ? { applyTo() {} } : (name === './install-actions' || name === './market-actions') ? load('pages/plugins/' + name.slice(2) + '.js') : require(path.resolve(root, path.dirname(file), name)),
      wx: { getWindowInfo: () => ({ statusBarHeight: 44 }) } });
    return module.exports;
  };
  load('pages/plugins/plugins.js');
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { Object.assign(this.data, p); } };
  page.onLoad(); assert.equal(page.data.canAdd, true);
  page.openMore(); assert.equal(page.data.showingMore, true); page.goBack(); assert.equal(page.data.showingMore, false);
  fakeStore.state.connection = 'disconnected'; page.syncFromStore(); assert.equal(page.data.canAdd, false);
  const wxml = fs.readFileSync(path.join(root, 'pages/plugins/plugins.wxml'), 'utf8');
  for (const match of wxml.matchAll(/(?:bindtap|bindchange|bindinput|binderror|bindrefresherrefresh|catchtouchmove)="([^"]+)"/g)) assert.equal(typeof page[match[1]], 'function', match[1]);
  for (const text of ['内置插件配置', '实验性插件', '已安装插件', '确认安装', '核对安装状态', 'cancelInstall', 'catalog.moreBundles']) assert.ok(wxml.includes(text), text);
  page.onUnload();
});

test('Codex and Claude Code use Host version targets instead of plain enable', async () => {
  for (const suffix of ['codex', 'claude-code']) {
    const f = fixture(), name = '@deepseek-ai/dsh-subagent-' + suffix;
    f.state.pluginCatalog = buildCatalog({ managementAvailable: true, bundles: [{ name, official: true, availability: 'missing', installed: false, installTarget: { spec: name + '@0.2.0-rc.2', version: '0.2.0-rc.2' } }] });
    const bundle = f.state.pluginCatalog.moreBundles[0];
    assert.equal(bundle.availability, 'missing'); assert.equal(bundle.installTarget.version, '0.2.0-rc.2');
    f.api.prepareOfficial(name); assert.equal(f.calls.length, 0);
    const p = f.api.start(true), call = f.calls.at(-1);
    assert.equal(call.type, 'plugin-install'); assert.equal(call.payload.spec, name + '@0.2.0-rc.2'); assert.equal(call.payload.enabled, true);
    call.resolve({ result: { application: 'applied', bundle: name } }); await p;
    assert.equal(f.state.pluginInstall.phase, 'done');
  }
});

test('official install refuses absent or changed Host targets', async () => {
  const f = fixture(), name = '@deepseek-ai/dsh-subagent-codex';
  f.state.pluginCatalog = buildCatalog({ managementAvailable: true, bundles: [{ name, official: true, availability: 'missing' }] });
  assert.throws(() => f.api.prepareOfficial(name), /安装目标/);
  f.state.pluginCatalog.bundles[0].installTarget = { spec: name + '@1.0.0', version: '1.0.0' };
  f.api.prepareOfficial(name); f.state.pluginCatalog.bundles[0].installTarget.spec = name + '@2.0.0';
  await assert.rejects(f.api.start(true), /目标已变化/); assert.equal(f.calls.length, 0);
});

test('creator session request passes cordis at creation and sends no user message', async () => {
  const client = Object.create(GatewayClient.prototype); client.sessionCreations = {}; client.pendingRequests = {}; const sent = [];
  client.send = frame => { sent.push(frame); return true; };
  const result = client.createSession('workspace-id', 'cordis');
  assert.equal(sent[0].agentPreset, 'cordis'); assert.equal(sent[0].workspaceId, 'workspace-id');
  client.resolveCorrelated({ kind: 'session-created', requestId: sent[0].requestId, sessionId: 'creator-id' });
  assert.equal(await result, 'creator-id'); assert.equal(sent.length, 1);
});

test('source selector, tabs, compact toolbar and right-aligned More stay explicit', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/plugins.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/plugins/plugins.wxss'), 'utf8');
  assert.doesNotMatch(wxml, /检查插件<|explainCreate|<picker/);
  for (const x of ['selectPluginTab', 'data-tab="discover"', 'data-tab="installed"', 'createPluginSession', 'registry-overlay', 'selectRegistry']) assert.ok(wxml.includes(x), x);
  assert.match(css, /\.plugins \.plugin-more\s*\{[^}]*margin: 0 0 0 auto/);
  assert.match(css, /\.plugins \.plugin-add \{ flex: 0 0 auto; width: auto; min-width: 0/);
  assert.match(css, /\.plugins \.plugin-primary-button, \.plugins \.plugin-secondary-button \{ width: 100%; display: flex; align-items: center; justify-content: center; text-align: center/);
});
