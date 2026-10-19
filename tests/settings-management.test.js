const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const pagePath = path.join(__dirname, '../miniprogram/pages/settings/settings.js');
const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8').replace(/\{\{ui\['([^']+)'\]\}\}/g, '$1');
const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');

function createPage(apiOptions) {
  let definition;
  const calls = [], timers = new Map(); let timerId = 0;
  const api = Object.assign({ configured: () => false, ensureAccount: async () => ({ isAdmin: false }) }, apiOptions);
  const store = {
    state: { profiles: [], activeID: null, connection: 'disconnected' },
    sessionState: {},
    subscribe() { return () => {}; },
    client: { requestHost() {} },
    refreshHostPresence() { calls.push('refresh'); },
    pairWithPayload(raw) { calls.push(['pair', raw]); return { ok: true }; },
    selectHost(id) { calls.push(['select', id]); },
    createRelayShare() { return Promise.resolve({ raw: 'test-share', expiresAt: Date.now() + 60000 }); }
  };
  const wx = {
    showToast(options) { calls.push(['toast', options.title]); },
    showModal(options) { calls.push(['modal', options.title]); wx.modal = options; },
    navigateTo(options) { calls.push(['navigate', options.url]); },
    showActionSheet(options) { wx.actionSheet = options; },
    showLoading() {},
    hideLoading() {},
    scanCode(options) { wx.scan = options; },
    setClipboardData(options) { calls.push(['copy', options.data]); }
  };
  vm.runInNewContext(fs.readFileSync(pagePath, 'utf8'), {
    Page(value) { definition = value; },
    require(name) {
      if (name === '../../utils/store') return store;
      if (name === '../../utils/ui-preferences') return require('../miniprogram/utils/ui-preferences');
      if (name === '../../utils/work-step-presentation') return require('../miniprogram/utils/work-step-presentation');
      if (name === '../../utils/status-appearance') return require('../miniprogram/utils/status-appearance');
      if (name === '../../utils/access-api') return api;
      if (name === '../../utils/public-access-state') return require('../miniprogram/utils/public-access-state');
      if (name === '../../utils/node-presentation') return require('../miniprogram/utils/node-presentation');
      if (name === '../../utils/version-info') return require('../miniprogram/utils/version-info');
      if (name === '../../utils/labels') return { presetModeName: (v) => v, permissionName: (v) => v };
      if (name === '../../utils/notify-pref') return { enabled: () => false };
      if (name === '../../utils/voice-preference') return require('../miniprogram/utils/voice-preference');
      if (name === '../../utils/theme') return { applyTo() {}, getMode: () => 'auto' };
      if (name === '../../utils/build') return { BUILD_TIME: 'test-build' };
      throw new Error('Unexpected dependency: ' + name);
    },
    wx, Date,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  }, { filename: pagePath });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update); }
  });
  const paint = () => { page.onReady(); const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  return { page, store, wx, calls, api, paint, timers };
}

const { page, store, wx, calls } = createPage();
// 顶部留白只加一次，返回按钮和标题的中心跟随原生胶囊。
{
  const { page: navPage, wx: navWx } = createPage();
  navWx.getWindowInfo = () => ({ statusBarHeight: 54 });
  navWx.getMenuButtonBoundingClientRect = () => ({ top: 60, height: 32 });
  navPage.onLoad({});
  assert.equal(navPage.data.navPadTop + navPage.data.navHeight / 2, 76);
  navWx.getMenuButtonBoundingClientRect = () => ({ top: 28, height: 36 });
  navPage.onResize();
  assert.equal(navPage.data.navPadTop + navPage.data.navHeight / 2, 46);
  navWx.getWindowInfo = () => { throw new Error('Unavailable window info'); };
  navPage.updateNavigationLayout();
  assert.equal(navPage.data.navPadTop, 28, 'Capsule position must not depend on the window API succeeding');
  navWx.getWindowInfo = () => ({ statusBarHeight: 24 });
  navWx.getMenuButtonBoundingClientRect = () => ({ top: 0, height: 0 });
  navPage.updateNavigationLayout();
  assert.equal(navPage.data.navPadTop, 30);
  assert.equal(navPage.data.navHeight, 32);
  navWx.getMenuButtonBoundingClientRect = () => { throw new Error('Unavailable capsule'); };
  navPage.updateNavigationLayout();
  assert.equal(navPage.data.navPadTop, 30);
  delete navWx.getWindowInfo;
  navWx.getSystemInfoSync = () => ({ statusBarHeight: 20 });
  navPage.updateNavigationLayout();
  assert.equal(navPage.data.navPadTop, 26);
  delete navWx.getSystemInfoSync;
  navPage.updateNavigationLayout();
  assert.equal(navPage.data.navPadTop, 50);
  assert.match(wxml, /padding-top:{{navPadTop}}px;height:{{navHeight}}px/);
  assert.match(wxss, /\.settings\s*\{[^}]*padding:\s*0 40rpx 80rpx/);
  assert.match(wxss, /\.settings \.nav\s*\{[^}]*align-items:\s*center;[^}]*box-sizing:\s*content-box/);
}
const sync = () => page.syncFromStore({ app: store.state });
page.onLoad({});
assert.equal(page.data.buildLabel, require('../miniprogram/utils/version-info').clientVersion(wx).buildLabel);
page.openPrivacyPolicy();
assert.equal(page.data.privacyOpen, true);
page.closePrivacyPolicy();
assert.equal(page.data.privacyOpen, false);
assert.deepEqual(calls, [], 'First paint must not wait for host probes');
calls.length = 0;
page.openPublicAccess();
assert.equal(page.data.managementPanel, 'public');
assert.equal(page.data.publicStatusLabel, '未开通');
page.openNodeManagement();
assert.equal(page.data.managementPanel, 'nodes');
assert.deepEqual(calls, ['refresh']);
page.openPairSheet();
assert.equal(page.data.managementPanel, 'nodes');
assert.equal(page.data.pairSheetOpen, true);
page.closePairSheet();
assert.equal(page.data.managementPanel, 'nodes');
assert.equal(page.data.pairSheetOpen, false);
page.closeManagementPanel();
assert.equal(page.data.managementPanel, '');

store.state = { profiles: [{ id: 'local', gatewayId: 'local-id' }], activeID: 'local', connection: 'connected' };
sync();
assert.equal(page.data.nodeCount, 1);
assert.equal(page.data.onlineNodeCount, 1);
assert.equal(page.data.publicOn, false, 'Local IDs must not imply public access');
assert.equal(page.data.publicId, '');
assert.equal(page.data.shareEnabled, false);

const owner = { id: 'owner', gatewayId: 'public-id', relay: true, relayRole: 'owner', relayAccessToken: 'fixture-token' };
store.state = { profiles: [owner], activeID: 'owner', connection: 'connected' };
sync();
assert.equal(page.data.publicOn, true);
assert.equal(page.data.shareEnabled, true);
assert.equal(page.data.publicId, 'public-id');
assert.equal(page.data.publicExpiryLabel, '未设置到期时间');
assert.equal(page.data.isWechatAdmin, false, 'Relay owner is not a WeChat administrator');
page.data.sharePayload = 'old-share';
store.state.profiles = [];
store.state.activeID = null;
sync();
assert.equal(page.data.sharePayload, '', 'Removed active node must clear its invitation');

store.state = { profiles: [Object.assign({}, owner, { relayRole: 'guest', relayExpiresAt: Date.now() + 60000 })], activeID: 'owner', connection: 'connected' };
sync();
assert.equal(page.data.publicOn, true);
assert.equal(page.data.shareEnabled, false);
assert.match(page.data.publicExpiryLabel, /^\d{4}\/\d{2}\/\d{2} /);
store.state.profiles[0].relayExpiresAt = Date.now() - 1000;
sync();
assert.equal(page.data.publicOn, false);
assert.equal(page.data.publicStatusLabel, '已到期');
store.state.profiles[0].relayAccessToken = null;
sync();
assert.equal(page.data.publicStatusLabel, '已到期');

store.state = { profiles: [{ id: 'gateway', gatewayId: 'public-id', relay: true, relayAuthMode: 'gateway' }], activeID: 'gateway', connection: 'connected' };
sync();
assert.equal(page.data.publicOn, true, 'A gateway relay connection does not need an invite access token');
assert.equal(page.data.publicStatusLabel, '已连接');
assert.equal(page.data.shareEnabled, false);
page.createNodeShare();
assert.ok(wx.modal.content, 'Unsupported share button explains its reason');
page.redeemRenewal();
assert.equal(wx.modal.title, '兑换服务待配置');

page.openNodeManagement();
page.scanPublicNode();
assert.equal(wx.scan.onlyFromCamera, true);
wx.scan.success({ result: 'scan-payload' });
assert.equal(calls.some((c) => Array.isArray(c) && c[0] === 'pair' && c[1] === 'scan-payload'), true);
page.openPairSheet();
page.onPairingInput({ detail: { value: '  typed-payload  ' } });
page.connectPublicNode();
assert.equal(page.data.pairingConnecting, true);
page.closePairSheet();
assert.equal(page.data.pairSheetOpen, true, 'Do not dismiss an active pairing attempt');
store.state.connection = 'connected';
sync();
assert.equal(page.data.pairSheetOpen, false);
assert.equal(page.data.managementPanel, 'nodes');
assert.equal(page.data.pairingText, '');
assert.equal(calls.some((c) => Array.isArray(c) && c[0] === 'pair' && c[1] === 'typed-payload'), true);

for (const match of wxml.matchAll(/(?:bind|catch)(?:tap|input|change|touchmove)="([^"]+)"/g)) {
  assert.equal(typeof page[match[1]], 'function', 'Missing WXML handler: ' + match[1]);
}
const landing = wxml.split('<view wx:if="{{managementPanel && !pairSheetOpen}}"')[0];
assert.match(landing, /bindtap="openPublicAccess"/);
assert.match(landing, /bindtap="openNodeManagement"/);
assert.doesNotMatch(landing, /bindtap="createNodeShare"|wx:for="{{nodes}}"/, 'Details belong in independent panels, not the settings landing');
assert.match(wxml, /managementPanel === 'public'/);
assert.match(wxml, /managementPanel === 'nodes'/);
assert.match(wxml, /auto-height="{{false}}"/, 'Textarea needs a boolean false, not a truthy string');
assert.doesNotMatch(landing, />Mobile Gateway<|bindtap="disconnect"|bindtap="pingGateway"|bindtap="forgetDevice"/);
assert.match(wxml, /managementPanel === 'gateway' && nodeDetail/);
assert.match(wxml, /managementPanel === 'gateway' \? ui\['网关连接'\]/);
assert.doesNotMatch(wxml, /Mobile Gateway/);
assert.match(wxml, /wx:if="{{nodeDetail.isPublic}}"/);

async function testNodeDetails() {
  const { page, store, calls, wx } = createPage();
  const lan = { id: 'lan', gatewayId: 'lan-gateway', gatewayName: 'Mac', endpoints: ['ws://192.168.1.8:9000/ws/mobile'] };
  const relay = { id: 'relay', gatewayId: 'relay-gateway', relay: true, gatewayName: 'Remote', endpoints: ['wss://private.example.test/relay/c/node'] };
  store.state = { profiles: [lan, relay], activeID: 'lan', endpoint: lan.endpoints[0], port: 9000, connection: 'connected' };
  store.removeHosts = ids => { calls.push(['remove', ...ids]); store.state.profiles = store.state.profiles.filter(p => !ids.includes(p.id)); };
  store.client.disconnect = () => calls.push(['disconnect', store.state.activeID]);
  let resolvePing;
  store.client.ping = () => { calls.push(['ping', store.state.activeID]); return new Promise(resolve => { resolvePing = resolve; }); };
  page.syncFromStore({ app: store.state });
  page.selectNode({ currentTarget: { dataset: { id: 'relay' } } });
  assert.equal(page.data.managementPanel, 'gateway');
  assert.equal(page.data.nodeDetail.identifier, 'relay-gateway');
  assert.equal(page.data.nodeDetail.endpoint, '');
  assert.equal(page.data.nodeDetail.port, '');
  assert.equal(calls.length, 0, 'Opening details must not switch the current connection');
  page.pingGateway(); page.disconnect();
  assert.equal(calls.length, 0, 'Inactive details cannot ping or disconnect a different node');
  page.connectNode();
  assert.deepEqual(calls.pop(), ['select', 'relay']);
  page.forgetDevice();
  store.state.activeID = 'relay';
  wx.modal.success({ confirm: true });
  assert.deepEqual(calls.pop(), ['remove', 'relay']);
  assert.equal(page.data.managementPanel, 'nodes');
  assert.equal(page.data.nodeDetail, null);

  store.state.activeID = 'lan';
  page.selectNode({ currentTarget: { dataset: { id: 'lan' } } });
  assert.equal(page.data.nodeDetail.endpoint, lan.endpoints[0]);
  assert.equal(String(page.data.nodeDetail.port), '9000');
  page.disconnect();
  store.state.activeID = 'another-node';
  wx.modal.success({ confirm: true });
  assert.equal(calls.some(c => c[0] === 'disconnect'), false, 'A stale confirmation must not disconnect the newly active node');
  store.state.activeID = 'lan';
  page.pingGateway();
  assert.equal(page.data.nodePingBusy, true);
  page.closeManagementPanel();
  assert.equal(page.data.managementPanel, 'nodes');
  resolvePing();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.data.nodePingBusy, false);
  assert.equal(calls.some(c => c[0] === 'toast'), false, 'Late ping must not show in another panel');
  page.toggleNodeEditMode();
  page.selectNode({ currentTarget: { dataset: { id: 'lan' } } });
  assert.equal(page.data.nodeSelection[0], 'lan');
  assert.equal(page.data.managementPanel, 'nodes');
  page.toggleNodeEditMode();
  page.selectNode({ currentTarget: { dataset: { id: 'lan' } } });
  store.state.connection = 'disconnected';
  page.syncFromStore({ app: store.state });
  assert.equal(page.data.nodeDetail.canPing, false);
  assert.equal(page.data.nodeDetail.connectionLabel, '未连接');
  page.connectNode();
  assert.deepEqual(calls.pop(), ['select', 'lan'], 'Same inactive connection can reconnect');
}

async function testShareRace() {
  const { page, store, wx } = createPage();
  store.state = { profiles: [owner], activeID: 'owner', connection: 'connected' };
  page.syncFromStore({ app: store.state });
  let resolveShare;
  store.createRelayShare = () => new Promise((resolve) => { resolveShare = resolve; });
  page.createNodeShare();
  wx.actionSheet.success({ tapIndex: 0 });
  store.state = { profiles: [], activeID: null, connection: 'disconnected' };
  page.syncFromStore({ app: store.state });
  resolveShare({ raw: 'stale-share', expiresAt: Date.now() + 60000 });
  await Promise.resolve();
  assert.equal(page.data.sharePayload, '', 'An old request cannot restore a removed node invitation');
}

async function testAutomaticIdentity() {
  const { page, calls, api, paint } = createPage({ configured: () => true,
    ensureAccount: async options => { assert.equal(options.freshLogin, true); return { isAdmin: true }; } });
  const show = () => { const pending = page.onShow(); paint(); return pending; };
  await show();
  assert.equal(page.data.isWechatAdmin, true);
  assert.equal(page.data.accountLabel, '管理员');
  assert.deepEqual(calls, ['refresh'], 'Automatic verification only refreshes silently');
  calls.length = 0;
  assert.equal(page.data.adminAdvancedOpen, false);
  page.toggleAdminAdvanced();
  assert.equal(page.data.adminAdvancedOpen, true, 'Verified admin can expand optional management');
  page.openCodeManagement();
  // 兑换码管理改为弹窗：不再跳转页面
  assert.equal(page.data.codeSheet, true);
  page.onHide();
  assert.equal(page.data.isWechatAdmin, false);
  assert.equal(page.data.adminAdvancedOpen, false, 'Leaving settings collapses advanced tools');
  api.ensureAccount = async () => ({ isAdmin: false });
  await show();
  assert.equal(page.data.accountLabel, '普通用户');
  calls.length = 0;
  page.openCodeManagement();
  page.toggleAdminAdvanced();
  assert.equal(page.data.adminAdvancedOpen, false, 'Ordinary users cannot expand advanced tools');
  assert.equal(calls.length, 0, 'Ordinary users cannot enter management');
  api.ensureAccount = async () => { throw new Error('offline'); };
  await show();
  assert.equal(page.data.isWechatAdmin, false);
  assert.equal(page.data.accountLabel, '待识别');
  let resolveOld;
  api.ensureAccount = () => new Promise(resolve => { resolveOld = resolve; });
  const old = show();
  page.onHide();
  api.ensureAccount = async () => ({ isAdmin: false });
  await show();
  resolveOld({ isAdmin: true });
  await old;
  assert.equal(page.data.isWechatAdmin, false, 'Late admin response cannot restore old identity');
  assert.equal(page.data.accountBusy, false);
  const unconfigured = createPage();
  const pending = unconfigured.page.onShow(); unconfigured.paint(); await pending;
  assert.equal(unconfigured.page.data.accountLabel, '待识别');
  assert.equal(unconfigured.page.data.isWechatAdmin, false);
  assert.doesNotMatch(wxml, /verifyWechatAccount|验证微信身份/);
  assert.match(wxml, /wx:if="{{isWechatAdmin}}"/);
}

async function testDeferredRefresh() {
  const { page, calls, paint } = createPage();
  page.onLoad({});
  const pending = page.onShow();
  assert.deepEqual(calls, []);
  page.onHide(); paint(); await pending;
  assert.deepEqual(calls, [], 'Leaving before first paint cancels network work');
  page.openVoiceSettings();
  assert.equal(calls.at(-1)[1], require('../miniprogram/utils/voice-preference').SETTINGS_URL);
  assert.ok(decodeURIComponent(calls.at(-1)[1]).includes('dsh-experimental-voice-input-bundle'));
}

Promise.all([testShareRace(), testAutomaticIdentity(), testNodeDetails(), testDeferredRefresh()]).then(() => console.log('settings independent panels, node details and automatic identity: PASS')).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
