const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');

const modulePath = path.join(__dirname, '..', 'miniprogram', 'utils', 'connection-status.js');

function load() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

test('connection states map to distinct dot colors', () => {
  const { connectionView } = load();
  assert.equal(connectionView({ connection: 'connected', everConnected: true }).key, 'connected');
  assert.equal(connectionView({ connection: 'connected', everConnected: true }).connected, true);
  // 从未连上：故障=橙，连接中=琥珀，空闲=灰
  assert.equal(connectionView({ connection: 'failed', everConnected: false }).key, 'failed');
  assert.equal(connectionView({ connection: 'connecting', everConnected: false }).key, 'connecting');
  assert.equal(connectionView({ connection: 'disconnected', everConnected: false }).key, 'disconnected');
  // 曾连上又掉线：一律红色「连接中断」，重连中也是
  assert.equal(connectionView({ connection: 'failed', everConnected: true }).key, 'dropped');
  assert.equal(connectionView({ connection: 'connecting', everConnected: true }).key, 'dropped');
  assert.equal(connectionView({ connection: 'disconnected', everConnected: true }).key, 'disconnected');
  assert.equal(connectionView({}).key, 'disconnected', 'missing state degrades to gray');
  assert.equal(connectionView({ connection: 'connected' }).label, '已连接');
  assert.equal(connectionView({ connection: 'failed', everConnected: true }).label, '连接中断');
});

test('gateway marks deliberate disconnects so a dropped link stays red', () => {
  const file = path.resolve(__dirname, '..', 'miniprogram', 'utils', 'gateway.js');
  let definition;
  const seen = [];
  const wx = {};
  const context = {
    wx, console, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (name) => (name.endsWith('/ui-preferences')
      ? { t: (k) => k, locale: () => 'zh' }
      : { uuid: () => 'test-uuid' }),
    GatewayClient: null
  };
  // The module assigns to module.exports; capture it through a wrapper.
  const source = fs.readFileSync(file, 'utf8').replace(
    /module\.exports\s*=\s*GatewayClient;/,
    'module.exports = GatewayClient;'
  );
  vm.runInNewContext(source, Object.assign(context, { module: { exports: {} }, exports: {} }));
  definition = context.module.exports.GatewayClient || context.module.exports;
  assert.equal(typeof definition, 'function', 'gateway module loaded');
  const client = new definition({
    onState: (status, message, code, deliberate) => seen.push({ status, deliberate }),
    onFrame: () => {}
  });
  client.disconnect();
  assert.deepEqual(seen.at(-1), { status: 'disconnected', deliberate: true });
  client.setState('failed', 'boom', null, false);
  assert.deepEqual(seen.at(-1), { status: 'failed', deliberate: false });
});

test('home colours the three connection spots by state and keeps its original layout', () => {
  const file = path.resolve(__dirname, '../miniprogram/pages/home/home.js');
  const store = {
    state: { profiles: [], sessions: [{ sessionId: 's1', title: '会话一', updatedAt: 1 }], workspaces: [], connection: 'connected', everConnected: true, activeID: 'host-a' },
    sessionState: {},
    subscribe() { return () => {}; },
    stopHostProbes() {},
    refreshHosts() {}
  };
  let definition;
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    setNavigationBarColor() {}, getStorageSync() {}, setStorageSync() {}, navigateTo() {}
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => { definition = value; }, wx, console, setTimeout, clearTimeout, setInterval, clearInterval,
    require: (name) => (name.endsWith('/store') ? store : require(path.resolve(path.dirname(file), name)))
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  });
  page.syncFromStore({ app: store.state, session: store.sessionState });
  assert.equal(page.data.connectionClass, 'connected');
  assert.equal(page.data.hostDotClass, 'on');
  assert.equal(page.data.displaySessions.length, 1, 'home keeps its original list behaviour');

  // 从没连上过的失败 → 橙
  store.state.connection = 'failed';
  store.state.everConnected = false;
  store.state.connectionMessage = '公网访问尚未开通';
  page.syncFromStore({ app: store.state, session: store.sessionState });
  assert.equal(page.data.connectionClass, 'failed');
  assert.equal(page.data.hostDotClass, 'failed');
  assert.equal(page.data.homeDataHint, '公网访问尚未开通', 'home exposes the actionable connection failure');
  assert.equal(page.data.connectionHintIsError, true);

  // 曾连上又掉线 → 红
  store.state.everConnected = true;
  page.syncFromStore({ app: store.state, session: store.sessionState });
  assert.equal(page.data.connectionClass, 'dropped');
  assert.equal(page.data.hostDotClass, 'dropped');

  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');
  assert.match(wxml, /class="host-dot \{\{hostDotClass\}\}"/, 'host selector dot follows the connection state');
  assert.match(wxml, /class="status-dot \{\{connectionClass\}\}"/, 'workspace card dot follows the connection state');
  assert.match(wxml, /class="conn-label \{\{connectionClass\}\}"/, 'connection label follows the connection state');
  assert.match(wxml, /connectionHintIsError \? 'home-connection-error'/, 'home highlights actionable connection failures');
  assert.doesNotMatch(wxml, /home-offline/, 'no extra offline card: the home keeps its original styling');
  assert.doesNotMatch(wxml, /wx:if="\{\{connected\}\}"/, 'workspace and session sections are not gated away');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.wxss'), 'utf8');
  assert.match(wxss, /\.status-dot\.failed \{ background: var\(--orange\); \}/);
  assert.match(wxss, /\.status-dot\.dropped \{ background: #E5484D; \}/);
  const homeCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8');
  assert.match(homeCss, /\.host-dot\.failed \{ background: var\(--orange\); \}/);
  assert.match(homeCss, /\.host-dot\.dropped \{ background: #FF5A5F; \}/);
});
