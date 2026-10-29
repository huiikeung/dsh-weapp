const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const pagePath = path.join(__dirname, '../miniprogram/pages/settings/settings.js');
const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8').replace(/\{\{ui\['([^']+)'\]\}\}/g, '$1');
const sessionSettingsWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session-settings/session-settings.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
const adminSheetWxml = wxml.slice(wxml.indexOf('<!-- 管理员弹窗 -->'), wxml.indexOf('<!-- 上下文面板设置弹窗 -->'));

assert.match(wxml, /<view wx:if="\{\{showAccountCard && dshAccountVisible\}\}" class="dsh-account-section"/,
  'Show the account area only while a gateway is connected and the account card switch is on');
assert.match(wxml, /wx:if="\{\{dshAccount\.balanceText\}\}" class="dsh-balance-amount"/,
  'Render the formatted recharge amount directly instead of iterating a nested array');
assert.match(sessionSettingsWxml, /wx:if="\{\{dshAccountVisible && showAccountCard\}\}" class="dsh-account-section"/,
  'Hide the session-settings account area while the gateway is disconnected or the account card switch is off');
assert.match(wxml, /dsh-account-link-button dsh-account-primary[^>]*catchtap="explainDshAccountSignIn"/,
  'Signed-out settings expose a sign-in explanation entry that does not bubble into the balance toggle');
// 连接分组：公网访问 / 节点管理 / 公网权限 只保留标题，不再挂副标题；
// 公网访问右侧改为有效期时间（无有效期时才回落状态文案）。
const connectionCard = wxml.slice(wxml.indexOf('公网访问'), wxml.indexOf('</view>\n  <view class="group-title">对话') > 0 ? wxml.indexOf('</view>\n  <view class="group-title">对话') : wxml.indexOf('对话'));
assert.ok(!/management-entry-desc/.test(connectionCard),
  'Connect rows carry no secondary description any more');
assert.match(connectionCard, /ui\[publicValueLabel\] !== undefined \? ui\[publicValueLabel\] : publicValueLabel/,
  'The public-access row shows the expiry time on the right');
assert.match(adminSheetWxml, /role="dialog" aria-label="公网权限"[\s\S]*?<text class="pair-sheet-title">公网权限<\/text>/,
  'The administrator sheet is titled Public permissions');
assert.doesNotMatch(adminSheetWxml, /微信身份/, 'The administrator sheet does not repeat the WeChat identity module');
assert.match(sessionSettingsWxml, /wx:if="\{\{dshAccount\.balanceText\}\}" class="dsh-balance-amount"/,
  'Keep the session settings balance display in sync');

function createPage(apiOptions) {
  let definition;
  const calls = [], timers = new Map(); let timerId = 0;
  const api = Object.assign({ configured: () => false, ensureAccount: async () => ({ isAdmin: false }) }, apiOptions);
  const costRequests = [];
  const store = {
    state: { profiles: [], activeID: null, connection: 'disconnected', gatewayCapabilities: ['cost-meter-v1'] },
    sessionState: {},
    subscribe() { return () => {}; },
    client: Object.assign({ requestHost() {},
      requestCostMeter(action, payload) {
        return new Promise((resolve, reject) => costRequests.push({ action, payload, resolve, reject }));
      } }, typeof api.requestAccount === 'function'
      ? { requestAccount: api.requestAccount } : {}, typeof api.requestClawbot === 'function'
      ? { requestClawbot: api.requestClawbot } : {}),
    refreshHostPresence() { calls.push('refresh'); },
    pairWithPayload(raw) { calls.push(['pair', raw]); return { ok: true }; },
    selectHost(id) { calls.push(['select', id]); },
    createRelayShare() { return Promise.resolve({ raw: 'test-share', expiresAt: Date.now() + 60000 }); }
  };
  const storage = new Map();
  const wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
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
      if (name === './utils/work-step-presentation') return require('../miniprogram/pages/settings/utils/work-step-presentation');
      if (name === './utils/status-appearance') return require('../miniprogram/pages/settings/utils/status-appearance');
      if (name === './utils/proc-icon-style') return require('../miniprogram/pages/settings/utils/proc-icon-style');
      if (name === '../../utils/access-api') return api;
      if (name === './public-access-state') return require('../miniprogram/pages/settings/public-access-state');
      if (name === './utils/node-presentation') return require('../miniprogram/pages/settings/utils/node-presentation');
      if (name === './utils/version-info') return require('../miniprogram/pages/settings/utils/version-info');
      if (name === './utils/account-view') return require('../miniprogram/pages/settings/utils/account-view');
      if (name === './utils/identity-badge') return require('../miniprogram/pages/settings/utils/identity-badge');
      if (name === './utils/storage-usage') return require('../miniprogram/pages/settings/utils/storage-usage');
      if (name === '../../utils/host-info') return require('../miniprogram/utils/host-info');
      if (name === '../../utils/labels') return { presetModeName: (v) => v, presetDisplayName: (name, id) => name || id, permissionName: (v) => v };
      if (name === './utils/notify-pref') return { enabled: () => false };
      if (name === './utils/voice-preference') return require('../miniprogram/pages/settings/utils/voice-preference');
      if (name === '../../utils/home-animation-pref') return { enabled: () => true, setEnabled: value => value === true };
      if (name === './utils/context-prefs') return require('../miniprogram/pages/settings/utils/context-prefs');
      if (name === './utils/context-panels-pref') return {
        read: () => ({ context: true, fleet: true }),
        set: (panel, value) => ({ context: true, fleet: true, [panel]: value === true })
      };
      if (name === './utils/account-card-pref') return {
        KEY: 'dsh_account_card_visible', DEFAULT: false,
        read: () => false, set: value => value === true
      };
      if (name === '../../utils/settings-glass-pref') return { KEY: 'settingsGlassStyleEnabled', DEFAULT: true, read: () => true, set: value => value === true };
      if (name === '../../utils/haptics') return require('../miniprogram/utils/haptics');
      if (name === '../../utils/public-access-prompt') return require('../miniprogram/utils/public-access-prompt');
      if (name === '../../utils/cost-view') return require('../miniprogram/utils/cost-view');
      if (name === '../../utils/theme') return { applyTo() {}, getMode: () => 'auto' };
      if (name === '../../utils/build') return { BUILD_TIME: 'test-build', BUILD_VERSION: '0.9.27' };
      if (name === '../../utils/connection-status') return require('../miniprogram/utils/connection-status');
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
  return { page, store, wx, calls, api, paint, timers, storage, costRequests };
}

test('signed-out account area explains the desktop sign-in flow', () => {
  const { page, wx } = createPage();
  page.explainDshAccountSignIn();
  assert.equal(wx.modal.title, '登录 DeepSeek');
  assert.match(wx.modal.content, /电脑端 DSH 的「设置 → 账号与余额」完成登录/);
  assert.equal(wx.modal.confirmText, '刷新');
  assert.equal(wx.modal.cancelText, '知道了');
});

test('work-step selections persist and their open row stays above the dismiss mask', () => {
  const { page, wx, storage } = createPage();
  const previousWx = global.wx;
  global.wx = wx;
  try {
    page.chooseWorkStep({ currentTarget: { dataset: { field: 'mode', id: 'compact' } } });
    assert.deepEqual(storage.get('workStepPresentation'), { mode: 'compact', timing: 'completion' });
    assert.equal(page.data.workStepMode, 'compact');

    page.chooseWorkStep({ currentTarget: { dataset: { field: 'timing', id: 'next-input' } } });
    assert.deepEqual(storage.get('workStepPresentation'), { mode: 'compact', timing: 'next-input' });
    assert.equal(page.data.workStepTiming, 'next-input');
    assert.equal(page.data.workStepMenu, '');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  assert.match(wxml, /workStepMenu === 'mode' \? 'work-step-row-open'/);
  assert.match(wxml, /workStepMenu === 'timing' \? 'work-step-row-open'/);
  assert.match(wxss, /\.work-step-menu-mask\s*\{[^}]*z-index:\s*80/);
  assert.match(wxss, /\.work-step-row-open\s*\{[^}]*z-index:\s*82/);
});

test('settings account area shows login and balance while connected and hides when disconnected', async () => {
  const { page, store } = createPage({
    requestAccount: async () => ({ state: { status: 'signed-out' } })
  });
  store.state = { connection: 'disconnected', activeID: 'host-1', profiles: [] };
  page.syncFromStore({ app: store.state });
  assert.equal(page.data.dshAccountVisible, false, 'disconnected gateways must not show the account area');

  store.state = { connection: 'connected', activeID: 'host-1', profiles: [], host: { version: '0.2.1-rc.2' } };
  page.syncFromStore({ app: store.state });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(page.data.dshAccountVisible, true, 'connected gateways show the account area even when signed out');
  assert.equal(page.data.dshAccount.signedIn, false);
  assert.equal(page.data.dshAccount.balanceState, 'signed-out');
  assert.equal(page.data.dshAccount.name, '尚未登录');

  store.state = { connection: 'disconnected', activeID: 'host-1', profiles: [] };
  page.syncFromStore({ app: store.state });
  assert.equal(page.data.dshAccountVisible, false, 'disconnecting hides the account area again');
  assert.equal(page.data.dshAccount.signedIn, false);
});

test('settings account lookup uses the connected DSH Host version', async () => {
  const requestClients = [];
  const { page: accountPage, store: accountStore } = createPage({
    requestAccount(client) {
      requestClients.push(client);
      return Promise.resolve({ state: { status: 'credential-stored' }, balance: { status: 'ready', value: [{ currency: 'CNY', balance: '12.34' }] } });
    }
  });
  accountStore.state = { connection: 'connected', activeID: 'host-1', host: { version: '0.2.1-rc.2' } };
  accountPage.refreshDshAccount();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requestClients.length, 1);
  assert.equal(requestClients[0].version, '0.2.1-rc.2');
  assert.notEqual(requestClients[0].version, '0.9.27', 'Do not send the unrelated mini-program version');
  assert.equal(accountPage.data.dshAccount.balanceText, '¥12.34');
});

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
assert.equal(page.data.buildLabel, require('../miniprogram/pages/settings/utils/version-info').clientVersion(wx).buildLabel);
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
assert.equal(page.data.publicValueLabel, '未设置到期时间',
  'The right-hand value follows the expiry label whenever the service is active');
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
assert.equal(page.data.publicValueLabel, page.data.publicExpiryLabel,
  'An active guest plan shows the expiry timestamp on the right');
store.state.profiles[0].relayExpiresAt = Date.now() - 1000;
sync();
assert.equal(page.data.publicOn, false);
assert.equal(page.data.publicStatusLabel, '已到期');
assert.equal(page.data.publicValueLabel, '已到期', 'An expired plan falls back to the status text');
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
  assert.equal(page.data.accountLabel, '未授权');
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
  assert.equal(calls.at(-1)[1], require('../miniprogram/pages/session/utils/voice-preference').SETTINGS_URL);
  assert.ok(decodeURIComponent(calls.at(-1)[1]).includes('dsh-experimental-voice-input-bundle'));
}

async function testClawbotExperimentalControls() {
  let status = { supported: true, revision: 2, enabled: false, paired: false, bindingState: 'unpaired',
    target: null, state: 'disabled', message: '', pending: 0, uncertain: 0 };
  const requests = [];
  const { page, store, wx, calls } = createPage({ requestClawbot: async request => {
    requests.push(request);
    if (request.action === 'status') return { kind: 'clawbot-control', value: status };
    if (request.action === 'login.start') {
      status = { ...status, revision: 3, pairing: { id: 'login-1', status: 'wait', qrDataUrl: '' } };
      return { value: status };
    }
    if (request.action === 'sessions') return { value: { sessions: [{ id: 's1', title: 'Target session' }] } };
    if (request.action === 'route') {
      status = { ...status, revision: 4, paired: true, bindingState: 'paired', target: { id: request.sessionId, title: 'Target session' } };
      return { value: status };
    }
    if (request.action === 'enabled') {
      status = { ...status, revision: 5, enabled: request.enabled, state: request.enabled ? 'ready' : 'disabled' };
      return { value: status };
    }
    throw new Error('unexpected action: ' + request.action);
  } });
  store.state.connection = 'connected';
  store.state.gatewayCapabilities = ['wechat-clawbot-control-v2'];
  page.openClawbotPanel();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests[0].action, 'status');
  assert.equal(page.data.clawbotBusy, false, 'Unbound service switch remains clickable so it can explain setup requirements');
  const beforeEnable = requests.length;
  await page.toggleClawbot({ detail: { value: true } });
  assert.equal(requests.length, beforeEnable, 'Unbound service is not enabled remotely');
  assert.equal(page.data.clawbotStatus.enabled, false, 'Rejected enable attempts restore the off state');
  assert.equal(calls.at(-1)[0], 'toast');
  assert.match(calls.at(-1)[1], /绑定微信/);
  await page.startClawbotLogin();
  assert.equal(requests.at(-1).action, 'login.start');
  assert.equal(requests.at(-1).expectedRevision, 2);
  await page.openClawbotSessions();
  assert.equal(page.data.clawbotSessions[0].id, 's1');
  await page.chooseClawbotSession({ currentTarget: { dataset: { id: 's1' } } });
  assert.equal(requests.at(-1).expectedRevision, 3);
  await page.toggleClawbot({ detail: { value: true } });
  assert.equal(requests.at(-1).action, 'enabled');
  assert.equal(requests.at(-1).enabled, true);
  assert.equal(page.data.clawbotStateLabel, '私聊接线已启用');
  assert.match(wxml, /bindtap="openClawbotPanel"/);
  assert.match(wxml, /bindchange="toggleClawbot"/);
  assert.match(wxml, /bindtap="startClawbotLogin"/);
  assert.match(wxml, /bindtap="chooseClawbotSession"/);
  assert.match(wxml, /clawbotStatus\.pairing\.status === 'need_verifycode'/);
  page.onHide();
  assert.equal(page.data.clawbotPanelOpen, false);

  const firstTapStatus = { supported: true, revision: 1, enabled: false, paired: false, target: null, access: { allowed: true } };
  const firstTapRequests = [];
  const firstTap = createPage({ requestClawbot: async request => {
    firstTapRequests.push(request);
    return { value: firstTapStatus };
  } });
  firstTap.store.state.connection = 'connected';
  firstTap.store.state.gatewayCapabilities = ['wechat-clawbot-control-v2'];
  await firstTap.page.toggleClawbot({ detail: { value: true } });
  await new Promise(resolve => setImmediate(resolve));
  await firstTap.page.toggleClawbot({ detail: { value: true } });
  assert.equal(firstTap.page.data.clawbotPanelOpen, true, 'Tapping the switch opens setup when status has not loaded');
  assert.equal(firstTapRequests[0].action, 'status');
  assert.equal(firstTap.calls.at(-1)[0], 'toast');

  const unsupported = createPage({ requestClawbot: async () => { throw new Error('Must not request without the capability'); } });
  unsupported.store.state.connection = 'connected';
  unsupported.store.state.gatewayCapabilities = [];
  unsupported.store.state.gatewayMetadata = { version: '0.8.10' };
  unsupported.page.openClawbotPanel();
  assert.match(unsupported.page.data.clawbotError, /0\.8\.10/);
  assert.match(unsupported.page.data.clawbotError, /重启/);

  const legacyReply = createPage({ requestClawbot: async () => {
    throw new Error('ClawBot is unavailable. Update dsh-wechat-remote and check its component status.');
  } });
  legacyReply.store.state.connection = 'connected';
  legacyReply.store.state.gatewayCapabilities = ['wechat-clawbot-control-v2'];
  legacyReply.page.openClawbotPanel();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(legacyReply.page.data.clawbotError, /重启升级后的 DSH/);
  assert.doesNotMatch(legacyReply.page.data.clawbotError, /dsh-wechat-remote/i);
}

Promise.all([testShareRace(), testAutomaticIdentity(), testNodeDetails(), testDeferredRefresh(), testClawbotExperimentalControls()]).then(() => console.log('settings independent panels, node details, ClawBot controls and automatic identity: PASS')).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


const flushCostRequests = async (costRequests, frame = { config: { display: { sidebarVisible: false } } }) => {
  for (const item of costRequests.splice(0)) item.resolve(frame);
  await new Promise(resolve => setImmediate(resolve));
};

test('the settings page no longer duplicates the quota card switch', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  assert.ok(!wxml.includes("ui['显示额度卡片']"), '设置页不再放重复的开关（已移入额度卡片页）');
  assert.ok(wxml.includes('openCostMeter'), '设置页仍保留额度卡片入口');
});

test('settings account lookup rejects the gateway marker and prefers dshVersion', async () => {
  const requestClients = [];
  const { page, store } = createPage({
    requestAccount(client) {
      requestClients.push(client);
      return Promise.resolve({ state: { status: 'credential-stored' }, balance: { status: 'ready', value: [] } });
    }
  });
  // 真实网关 host 帧：version 是占位标记，真版本在 dshVersion。
  store.state = { connection: 'connected', activeID: 'host-1', host: { version: 'remote-gateway', dshVersion: '0.1.7-rc.2' } };
  page.refreshDshAccount();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requestClients.length, 1, 'marker alone must not be sent as the host version');
  assert.equal(requestClients[0].version, '0.1.7-rc.2');

  // 老网关只发 version（真版本）时同样可用。
  store.state = { connection: 'connected', activeID: 'host-1', host: { version: '0.10.0' } };
  page.refreshDshAccount();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requestClients.at(-1).version, '0.10.0');
});

test('兑换码弹窗可以一键清空已用完的码，停用/过期的保留', async () => {
  const now = Date.now();
  let items = [
    { id: 'used', days: 7, uses: 1, used: 1, expiresAt: now + 86400000 },
    { id: 'open', days: 7, uses: 5, used: 2, expiresAt: now + 86400000 },
    { id: 'expired', days: 3, uses: 1, used: 1, expiresAt: now - 1000 },
    { id: 'revoked', days: 3, uses: 1, used: 1, expiresAt: now + 86400000, revokedAt: now - 500 }
  ];
  const deleted = [];
  const { page, wx } = createPage({
    ensureAccount: async () => ({ isAdmin: true }),
    codes: async () => items.map(item => ({ ...item })),
    deleteCode: async (id) => { deleted.push(id); items = items.filter(item => item.id !== id); }
  });
  const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)); };
  page.openCodeManagement();
  await settle();
  assert.equal(page.data.codeIsAdmin, true);
  assert.equal(page.data.codeUsedCount, 1, '只有状态是「已用完」的码被计数');
  const byId = Object.fromEntries(page.data.codeItems.map(item => [item.id, item]));
  assert.equal(byId.used.usedUp, true);
  assert.equal(byId.open.usedUp, false);
  assert.equal(byId.expired.usedUp, false, '过期但没用完的码保留审计线索');
  assert.equal(byId.revoked.usedUp, false, '停用的码不参与清空');

  page.codeClearUsed();
  assert.deepEqual(deleted, [], '确认之前不删除');
  await wx.modal.success({ confirm: false });
  assert.deepEqual(deleted, [], '取消后什么都不删');
  page.codeClearUsed();
  await wx.modal.success({ confirm: true });
  await settle();
  assert.deepEqual(deleted, ['used'], '只删已用完的那一个');
  assert.equal(page.data.codeUsedCount, 0);
  assert.equal(page.data.codeItems.length, 3);
});

test('「最近生成」右上的清空按钮排在刷新左边，且只在有已用完的码时出现', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const head = wxml.slice(wxml.indexOf('code-list-head'), wxml.indexOf('class="code-item"'));
  const clearAt = head.indexOf('bindtap="codeClearUsed"');
  const refreshAt = head.indexOf('bindtap="loadCodes"');
  assert.ok(clearAt > 0 && refreshAt > clearAt, '清空在刷新左边');
  assert.match(head, /wx:if="\{\{codeUsedCount\}\}"/, '没有可清空的码时不显示按钮');
  assert.match(head, /class="code-clear"/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8'),
    /\.code-clear\s*\{[^}]*color:\s*#E5484D/, '危险色');
});

test('一键清空在服务端限流处停下并说明，已删的不会回滚', async () => {
  const now = Date.now();
  let items = Array.from({ length: 35 }, (_, index) => ({ id: 'c' + index, days: 7, uses: 1, used: 1, expiresAt: now + 86400000 }));
  const deleted = [];
  let codesCalls = 0;
  const { page, wx, calls } = createPage({
    ensureAccount: async () => ({ isAdmin: true }),
    codes: async () => { codesCalls += 1; return items.map(item => ({ ...item })); },
    deleteCode: async (id) => {
      // 服务端 /admin/codes/:id/delete 每个管理员每分钟只允许 30 次。
      if (deleted.length >= 30) { const err = new Error('操作过于频繁，请稍后重试'); err.code = 'RATE_LIMITED'; throw err; }
      deleted.push(id); items = items.filter(item => item.id !== id);
    }
  });
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  page.openCodeManagement();
  await settle();
  assert.equal(page.data.codeUsedCount, 35);
  page.codeClearUsed();
  await wx.modal.success({ confirm: true });
  await settle();
  assert.equal(deleted.length, 30, '被限流后立即停下，不再空转');
  const toast = calls.filter(call => Array.isArray(call) && call[0] === 'toast').at(-1);
  assert.equal(toast[1], '已清空 30 个，其余受频率限制稍后再试');
  assert.ok(codesCalls >= 2, '仍然重新拉取服务端列表');
  assert.equal(page.data.codeUsedCount, 5, '没删掉的 5 个仍在服务端列表里');
  assert.equal(page.data.codeBusy, false);
});

test('节点卡片的状态点相对整张卡片垂直居中', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const row = wxml.slice(wxml.indexOf('class="node-row'), wxml.indexOf('class="node-pair-actions"'));
  const dotAt = row.indexOf('status-dot node-dot');
  const mainAt = row.indexOf('class="node-main"');
  const nameLineAt = row.indexOf('class="node-name-line"');
  assert.ok(dotAt > 0, 'node rows keep a status dot');
  assert.ok(mainAt > dotAt, '状态点在 node-main 之前，作为 .node-row 的直接子节点');
  assert.ok(nameLineAt > mainAt, '名称行仍在 node-main 内部');
  // 卡片是两行（名称 + ID），行本身 align-items:center 才能让点相对整张卡片居中。
  assert.match(wxss, /\.node-row\s*\{[^}]*align-items:\s*center/);
  assert.match(wxss, /\.node-row > \.node-dot\s*\{[^}]*margin-right:\s*0/, '横向间距交给行的 gap，不叠加文字行的 margin');
  assert.ok(!/\.node-name-line \.status-dot/.test(wxss), '不再依赖名称行内的定位');
});

test('公网访问弹窗沿用首页工作区弹窗的玻璃背景，但保持底部弹窗', () => {
  const wxmlRaw = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const homeCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8');
  // 只有公网访问面板套玻璃背景；节点/网关面板仍是原来的纯色底部弹窗。
  assert.match(wxmlRaw, /managementPanel === 'public' && settingsGlassEnabled \? 'management-sheet-glass' : ''/);
  assert.match(wxmlRaw, /class="pair-sheet management-sheet resizable /);
  // 背景参数与首页工作区选择弹窗一致。
  for (const sheet of [css, homeCss]) {
    assert.ok(sheet.includes('linear-gradient(165deg, rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.04))'), 'workspace popover gradient');
    assert.ok(sheet.includes('1rpx solid rgba(255, 255, 255, 0.38)'), 'workspace popover hairline');
    assert.ok(sheet.includes('blur(8rpx)'), 'workspace popover blur');
  }
  assert.match(css, /\.pair-sheet\.management-sheet-glass\s*\{[\s\S]*?inset 0 1rpx 0 rgba\(255, 255, 255, 0\.16\)[\s\S]*?0 24rpx 72rpx rgba\(3, 14, 30, 0\.26\)/);
  assert.match(css, /\.theme-light \.pair-sheet\.management-sheet-glass\s*\{/);
  assert.match(css, /\.pair-sheet\.management-sheet-glass \.public-card\s*\{[^}]*background: linear-gradient/,
    'the middle public-access card also uses translucent glass');
  assert.match(css, /\.theme-light \.pair-sheet\.management-sheet-glass \.public-card/);
  // 仍是底部弹窗：遮罩底部对齐、顶部圆角、抓手保留。
  assert.match(css, /\.pair-sheet-mask\s*\{[^}]*align-items: flex-end/);
  assert.match(css, /\.pair-sheet\s*\{[^}]*border-radius: 32rpx 32rpx 0 0/);
  assert.match(wxmlRaw, /class="sheet-grabber-zone" data-sheet="management"/);
});

test('glass settings preference defaults on and controls both settings surfaces', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-pref.js'), 'utf8');
  let stored;
  const context = {
    module: { exports: {} },
    wx: { getStorageSync: () => stored, setStorageSync: (_key, value) => { stored = value; } }
  };
  vm.runInNewContext(source, context);
  const preference = context.module.exports;
  assert.equal(preference.DEFAULT, true);
  assert.equal(preference.read(), true, 'a new install starts with glass style enabled');
  assert.equal(preference.set(false), false);
  assert.equal(preference.read(), false);
  assert.equal(preference.set(true), true);

  const settingsWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const settingsJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  const sessionWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session-settings/session-settings.wxml'), 'utf8');
  const sessionJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session-settings/session-settings.js'), 'utf8');
  assert.match(settingsWxml, /dsh-switch checked="\{\{settingsGlassEnabled\}\}"[^>]*bindchange="toggleSettingsGlass"/);
  assert.match(settingsJs, /toggleSettingsGlass\(e\)[\s\S]*?settingsGlassPreference\.set/);
  assert.match(sessionWxml, /settingsGlassEnabled \? 'settings-glass-card' : ''/);
  assert.match(sessionWxml, /picker && settingsGlassEnabled/);
  assert.match(sessionWxml, /picker && !settingsGlassEnabled/);
  assert.match(sessionJs, /if \(!this\.data\.settingsGlassEnabled \|\| kind === 'preset'\) \{[\s\S]*?this\.setData\(state\)/, 'the preset sheet never waits for anchor metrics');
});

