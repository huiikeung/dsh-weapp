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
    refreshPlugins() {},
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
      if (name === '../../utils/choice-menu') return require('../miniprogram/utils/choice-menu');
      if (name === '../../utils/session-glass-pref') return { KEY: 'sessionGlassEnabled', DEFAULT: true, read: () => true, set: value => value === true };
      if (name === '../../utils/settings-glass-style-pref') return { KEY: 'settingsGlassStyle', DEFAULTS: { alpha: 10, blur: 8, edge: 38, radius: 32, brightness: 100 }, LIMITS: { alpha: [4, 40], blur: [2, 24], edge: [10, 70], radius: [20, 40], brightness: [40, 160] }, read: () => ({ alpha: 10, blur: 8, edge: 38, radius: 32 }), set: patch => patch, view: () => ({ glassSurfaceStyle: 'background: linear-gradient(165deg, rgba(255, 255, 255, 0.040), rgba(255, 255, 255, 0.016)); border: 1px solid rgba(255, 255, 255, 0.38); border-radius: 16.64px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 6.24px 24.96px rgba(3, 14, 30, 0.26); backdrop-filter: blur(4.16px); -webkit-backdrop-filter: blur(4.16px);', glassAlpha: 10, glassBlur: 8, glassEdge: 38, glassRadius: 32, glassAlphaTop: '0.040', glassAlphaBottom: '0.016', glassAlphaTopPct: 4, glassAlphaBottomPct: 1.6, glassBrightness: 100, glassEdgeAlpha: '0.38', glassBlurSheet: '4.16px', glassBlurCard: '1.56px', glassRadiusSheet: '16.64px', glassRadiusCard: '18.72px' }) };
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
      if (name === '../../utils/settings-glass-sheet-pref') return { KEY: 'settingsGlassSheetEnabled', DEFAULT: true, read: () => true, set: value => value === true };
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
    assert.equal(page.data.choiceMenu, '');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  // 两个选项菜单都改用「工作区选择」同款的锚点玻璃弹窗。
  assert.match(wxml, /choiceMenu === 'mode' \? 'work-step-row-open'/);
  assert.match(wxml, /choiceMenu === 'timing' \? 'work-step-row-open'/);
  assert.match(wxml, /wx:if="\{\{choiceMenu && choiceSheet\}\}" class="choice-sheet-mask" catchtap="closeChoiceMenu"/);
  assert.match(wxml, /class="choice-sheet \{\{settingsGlassEnabled \? 'choice-sheet-glass' : ''\}\}"/);
  assert.match(wxml, /wx:if="\{\{choiceMenu && !choiceSheet\}\}" class="settings-choice-mask" catchtap="closeChoiceMenu"/);
  assert.match(wxml, /class="settings-choice \{\{settingsGlassEnabled \? 'settings-choice-glass' : ''\}\}"\s+style="left: \{\{choiceLeft\}\}px; top: \{\{choiceTop\}\}px; width: \{\{choiceWidth\}\}px; height: \{\{choiceHeight\}\}px;/);
  // 锚点玻璃弹窗的样式在共用的 styles/glass-ui.wxss（设置页与额度卡片页同源）。
  const glassCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/styles/glass-ui.wxss'), 'utf8');
  assert.match(wxss, /@import "\.\.\/\.\.\/styles\/glass-ui\.wxss"/);
  assert.match(glassCss, /\.settings-choice-mask\s*\{[^}]*z-index:\s*300/);
  assert.match(glassCss, /\.settings-choice \{[\s\S]{0,80}?z-index:\s*301/);
  // 默认是原生实色形态（跟随深浅色变量），玻璃 UI 开启才叠加 .settings-choice-glass。
  assert.match(glassCss, /\.settings-choice \{[\s\S]*?border-radius: var\(--glass-radius-choice, 64rpx\);[\s\S]*?background: var\(--surface\);[\s\S]*?border: 1rpx solid var\(--border\)/);
  assert.match(glassCss, /\.settings-choice\.settings-choice-glass \{[\s\S]*?linear-gradient\(165deg, rgba\(255, 255, 255, var\(--glass-alpha-top, 0\.10\)\), rgba\(255, 255, 255, var\(--glass-alpha-bottom, 0\.04\)\)\)[\s\S]*?backdrop-filter: blur\(var\(--glass-blur-sheet, 8rpx\)\)/);
  assert.match(glassCss, /\.settings-choice\.settings-choice-glass \.settings-choice-label \{ color: #FFFFFF/);
  assert.match(glassCss, /\.settings-choice-row \{[^}]*min-height: 44px/);
  assert.match(wxml, /class="settings-choice \{\{settingsGlassEnabled \? 'settings-choice-glass' : ''\}\}"/);
  assert.match(wxss, /\.work-step-row-open\s*\{[^}]*z-index:\s*82/);
  // 语言行不再原地展开：同一个玻璃弹窗承载。
  assert.match(wxml, /preference-select" bindtap="pickLanguage"[^>]*>[\s\S]{0,200}?choiceMenu === 'language' \? 'expanded' : ''/);
  assert.doesNotMatch(wxml, /preference-menu/);
});


test('语言选择复用工作区同款的锚点玻璃弹窗', () => {
  const { page, wx, storage } = createPage();
  const previousWx = global.wx;
  global.wx = wx;
  try {
    page.setData({ languageOptions: [{ id: 'system', label: '跟随系统' }, { id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }] });
    page.pickLanguage();
    assert.equal(page.data.choiceMenu, 'language', 'the workspace-style menu opens for language');
    assert.equal(page.data.choiceTitle, '语言');
    assert.equal(page.data.choiceOptions.length, 3);
    assert.equal(page.data.choiceCurrent, 'system');
    assert.ok(Number.isFinite(page.data.choiceLeft) && Number.isFinite(page.data.choiceTop));
    page.pickLanguage();
    assert.equal(page.data.choiceMenu, '', 'tapping the row again closes the menu');
    page.pickLanguage();
    page.chooseChoice({ currentTarget: { dataset: { kind: 'language', id: 'en' } } });
    assert.equal(page.data.choiceMenu, '');
    assert.equal(storage.get('appLanguage'), 'en', 'the language choice persists');
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  // 三个入口共用一个浮层：语言行没有任何原地展开的旧菜单。
  assert.doesNotMatch(wxml, /preference-menu/);
  assert.match(wxml, /bindtap="pickLanguage"[\s\S]{0,200}?choiceMenu === 'language' \? 'expanded' : ''/);
  assert.match(wxml, /bindtap="toggleWorkStepMenu" data-field="mode"/);
  assert.match(wxml, /bindtap="toggleWorkStepMenu" data-field="timing"/);
});

test('额度卡片入口移到实验性功能，箭头改成开关并复用额度卡片页的显示开关', async () => {
  const { page, store, costRequests, calls } = createPage();
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  // 入口不再带箭头，也不再是外观卡片里的 management-entry
  assert.doesNotMatch(wxml, /card-row management-entry" bindtap="openCostMeter"/);
  // 落在「实验性功能」卡片里：标题可点进额度卡片页，右侧是开关
  const experimental = wxml.slice(wxml.indexOf("{{ui['实验性功能']}}"));
  const card = experimental.slice(0, experimental.indexOf('group-hint'));
  assert.match(card, /bindtap="openCostMeter"/);
  assert.match(card, /dsh-switch checked="\{\{quotaSidebarVisible\}\}"[^>]*bindchange="toggleQuotaSidebarVisibility"/);
  assert.doesNotMatch(card.slice(card.indexOf('bindtap="openCostMeter"') - 200, card.indexOf('bindtap="openCostMeter"') + 600), /chevron-img/);
  assert.match(js, /toggleQuotaSidebarVisibility\(e\)/);
  assert.match(js, /requestCostMeter\('update', \{ patch: \{ display: \{ sidebarVisible: enabled \} \} \}\)/);

  // 打开设置页时读取额度卡片配置，勾选状态与额度卡片页「显示额度卡片」同源
  store.state.connection = 'connected';
  page.onShow();
  await Promise.resolve();
  const configRequest = costRequests.find(item => item.action === 'config');
  assert.ok(configRequest, 'settings page asks for the quota config');
  configRequest.resolve({ display: { sidebarVisible: true } });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(page.data.quotaSidebarVisible, true);

  // 关闭开关 → 写回同一份配置，但留在设置页（不跳页）
  const before = calls.length;
  let pending = page.toggleQuotaSidebarVisibility({ detail: { value: false } });
  let update = costRequests.filter(item => item.action === 'update').at(-1);
  update.resolve({ config: { display: { sidebarVisible: false } } });
  await pending;
  assert.equal(page.data.quotaSidebarVisible, false);
  assert.equal(calls.filter(call => call[0] === 'navigate').length, 0, 'turning it off stays on settings');

  // 打开开关 → 保存成功后自动进入额度卡片页
  pending = page.toggleQuotaSidebarVisibility({ detail: { value: true } });
  update = costRequests.filter(item => item.action === 'update').at(-1);
  update.resolve({ config: { display: { sidebarVisible: true } } });
  await pending;
  assert.equal(page.data.quotaSidebarVisible, true);
  assert.ok(calls.some(call => call[0] === 'navigate' && call[1] === '/pages/cost-meter/cost-meter'),
    'turning it on opens the quota card page');
  assert.deepEqual(JSON.parse(JSON.stringify(update.payload)), { patch: { display: { sidebarVisible: true } } });
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

test('设置页底部弹窗的玻璃形态对齐首页设置页的选择弹窗', () => {
  const wxmlRaw = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const glassCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/styles/glass-ui.wxss'), 'utf8');
  const homeCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8');
  const pickerCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session-settings/session-settings.wxss'), 'utf8');
  assert.match(css, /@import "\.\.\/\.\.\/styles\/glass-ui\.wxss"/);
  const gated = wxmlRaw.match(/settingsGlassEnabled \? 'settings-glass-sheet' : ''/g) || [];
  assert.ok(gated.length >= 15, 'every sheet container gates the glass class, got ' + gated.length);
  assert.match(wxmlRaw, /class="pair-sheet management-sheet resizable \{\{settingsGlassEnabled \? 'settings-glass-sheet' : ''\}\}"/);
  assert.doesNotMatch(wxmlRaw, /management-sheet-glass/);
  for (const sheet of [glassCss, pickerCss]) {
    assert.ok(sheet.includes('linear-gradient(165deg, rgba(255, 255, 255, var(--glass-alpha-top, 0.10)), rgba(255, 255, 255, var(--glass-alpha-bottom, 0.04)))'), 'glass gradient');
    assert.ok(sheet.includes('1rpx solid rgba(255, 255, 255, var(--glass-edge-alpha, 0.38))'), 'glass hairline');
    assert.ok(sheet.includes('blur(var(--glass-blur-sheet, 8rpx))'), 'glass blur');
  }
  assert.match(glassCss, /\.pair-sheet\.settings-glass-sheet,[\s\S]*?\.status-style-sheet\.settings-glass-sheet,[\s\S]*?\.referral-sheet\.settings-glass-sheet,[\s\S]*?\.cost-sheet\.settings-glass-sheet \{[\s\S]*?width: calc\(100% - 24px\);[\s\S]*?margin: 0 12px 24px;[\s\S]*?border-radius: var\(--glass-radius-sheet, 32rpx\);/);
  assert.match(glassCss, /\.theme-light \.pair-sheet\.settings-glass-sheet/);
  assert.match(glassCss, /\.pair-sheet\.settings-glass-sheet,[\s\S]*?--glass-sheet-drop: 24px/);
  assert.equal((wxmlRaw.match(/calc\(90vh - var\(--glass-sheet-drop, 0px\)\)/g) || []).length, 6, 'fixed-height sheets subtract the inset');
  assert.equal((wxmlRaw.match(/var\(--glass-sheet-drop, 0px\)/g) || []).length, 9, 'every vh-sized sheet follows the inset');
  assert.match(glassCss, /\.pair-sheet\.settings-glass-sheet,[\s\S]*?--surface: rgba\(255, 255, 255, 0\.07\)/);
  assert.match(glassCss, /\.theme-light \.pair-sheet\.settings-glass-sheet,[\s\S]*?--surface: rgba\(255, 255, 255, 0\.82\)/);
  assert.match(css, /\.pair-sheet\.settings-glass-sheet \.public-card[\s\S]{0,200}?background: linear-gradient/);
  assert.match(css, /\.pair-sheet-mask\s*\{[^}]*align-items: flex-end/);
  assert.match(wxmlRaw, /class="sheet-grabber-zone" data-sheet="management"/);
  assert.ok(homeCss.includes('var(--glass-alpha-top, 0.10)'), 'workspace popover shares the same glass recipe');
});

test('设置页卡片沿用首页设置页的玻璃卡片材质', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const glassCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/styles/glass-ui.wxss'), 'utf8');
  const sessionCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session-settings/session-settings.wxss'), 'utf8');
  const homeCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxss'), 'utf8');
  const gated = wxml.match(/settingsGlassEnabled \? 'settings-glass-card' : ''/g) || [];
  assert.equal(gated.length, 9, 'every page-level card gates the glass class');
  for (const line of ['class="card {{settingsGlassEnabled ? \'settings-glass-card\' : \'\'}}"', 'class="card work-step-settings', 'class="card general-preferences']) {
    assert.ok(wxml.includes(line), line);
  }
  const recipe = [
    'border-radius: var(--glass-radius-card, 36rpx);',
    'background: linear-gradient(165deg, rgba(255, 255, 255, var(--glass-alpha-top, 0.06)), rgba(255, 255, 255, var(--glass-alpha-bottom, 0.015)));',
    'border: 1rpx solid rgba(255, 255, 255, var(--glass-edge-alpha, 0.38));',
    'backdrop-filter: blur(var(--glass-blur-card, 3rpx)) brightness(var(--glass-backdrop-brightness, 1));',
    'box-shadow: inset 0 1rpx 0 rgba(255, 255, 255, 0.16), 0 8rpx 32rpx rgba(3, 14, 30, 0.18);'
  ];
  assert.match(css, /@import "\.\.\/\.\.\/styles\/glass-ui\.wxss"/);
  const start = glassCss.indexOf('.settings-glass-card,');
  const end = glassCss.indexOf('}', start);
  const pageBlock = glassCss.slice(start, end);
  const sessionStart = sessionCss.indexOf('.settings-glass-card {');
  const sessionBlock = sessionCss.slice(sessionStart, sessionCss.indexOf('}', sessionStart));
  for (const declaration of recipe) {
    assert.ok(pageBlock.includes(declaration), 'settings page glass card: ' + declaration);
    assert.ok(sessionBlock.includes(declaration), 'session settings glass card: ' + declaration);
  }
  assert.ok(homeCss.includes('var(--glass-alpha-top, 0.06)'), 'home workspace cards share the same glass recipe');
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
  assert.equal(preference.read(), true);
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
  assert.match(sessionJs, /if \(!this\.data\.settingsGlassEnabled \|\| this\.data\.settingsGlassSheetEnabled\) \{[\s\S]*?this\.setData\(state\)/);
});

test('glass popup sheet preference defaults on and switches the picker presentation', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-sheet-pref.js'), 'utf8');
  let stored;
  const context = {
    module: { exports: {} },
    wx: { getStorageSync: () => stored, setStorageSync: (_key, value) => { stored = value; } }
  };
  vm.runInNewContext(source, context);
  const preference = context.module.exports;
  assert.equal(preference.KEY, 'settingsGlassSheetEnabled');
  assert.equal(preference.DEFAULT, true);
  assert.equal(preference.read(), true);
  assert.equal(preference.set(false), false);
  assert.equal(preference.read(), false);
  assert.equal(preference.set(true), true);
  const settingsWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const settingsJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  const sessionWxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session-settings/session-settings.wxml'), 'utf8');
  const sessionJs = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session-settings/session-settings.js'), 'utf8');
  assert.match(settingsWxml, /settingsGlassEnabled[\s\S]*?settingsGlassSheetEnabled[\s\S]*?bindchange="toggleSettingsGlassSheet"/);
  assert.match(settingsJs, /toggleSettingsGlassSheet\(e\)[\s\S]*?settingsGlassSheetPreference\.set/);
  assert.match(sessionJs, /settings-glass-sheet-pref/);
  assert.match(sessionJs, /settingsGlassSheetEnabled: settingsGlassSheetPreference\.read\(\)/);
  assert.match(sessionWxml, /picker && settingsGlassEnabled && settingsGlassSheetEnabled/);
  assert.match(sessionWxml, /picker && settingsGlassEnabled && !settingsGlassSheetEnabled/);
});

test('设置页里的玻璃样式滑杆可拖动，透明度 / 模糊 / 亮边 / 圆角即时生效', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  const glassCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/styles/glass-ui.wxss'), 'utf8');
  for (const field of ['alpha', 'blur', 'edge', 'radius', 'brightness']) {
    assert.ok(wxml.includes('data-field="' + field + '"'), 'slider for ' + field);
  }
  assert.equal((wxml.match(/bindchanging="onGlassStyleChanging"/g) || []).length, 5);
  assert.equal((wxml.match(/bindchange="onGlassStyleChange"/g) || []).length, 5);
  assert.match(wxml, /glass-alpha-value">\{\{glassAlpha\}\}%/);
  assert.match(wxml, /glass-alpha-value">\{\{glassBlur\}\}rpx/);
  assert.match(wxml, /glass-alpha-value">\{\{glassEdge\}\}%/);
  assert.match(wxml, /glass-alpha-value">\{\{glassRadius\}\}rpx/);
  assert.match(wxml, /glass-alpha-value">\{\{glassBrightness\}\}%/);
  assert.match(js, /onGlassStyleChanging\(e\)[\s\S]*?settingsGlassStylePreference\.view/);
  assert.match(js, /onGlassStyleChange\(e\)[\s\S]*?settingsGlassStylePreference\.set/);
  assert.match(glassCss, /var\(--glass-alpha-top, 0\.10\)/);
  assert.match(glassCss, /var\(--glass-edge-alpha, 0\.38\)/);
  assert.match(glassCss, /var\(--glass-blur-sheet, 8rpx\)/);
  assert.match(glassCss, /var\(--glass-radius-sheet, 32rpx\)/);
  for (const file of ['pages/settings/settings.wxml', 'pages/home/home.wxml', 'pages/cost-meter/cost-meter.wxml', 'pages/session-settings/session-settings.wxml']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram', file), 'utf8');
    assert.match(source, /--glass-alpha-top: \{\{glassAlphaTop\}\}; --glass-alpha-bottom: \{\{glassAlphaBottom\}\}; --glass-edge-alpha: \{\{glassEdgeAlpha\}\}/, file + ' binds the glass style vars');
  }
  assert.match(css, /\.glass-alpha-slider/);
});

test('玻璃样式设置是独立弹窗，只在玻璃 UI 开启时出现', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  // 入口：玻璃开关打开时才显示「玻璃样式设置」
  assert.match(wxml, /<view wx:if="\{\{settingsGlassEnabled\}\}" class="card-row" id="glass-style-entry" bindtap="openGlassStyleSheet"/);
  assert.match(wxml, /class="card-row" id="glass-style-entry"[^>]*aria-label="\{\{ui\['玻璃样式设置'\]\}\}"/);
  // 独立弹窗：玻璃皮肤，底部 / 非底部两种形态
  assert.match(wxml, /wx:if="\{\{glassStyleOpen\}\}"[\s\S]{0,160}?class="\{\{settingsGlassSheetEnabled \? 'glass-style-sheet' : 'glass-style-pop'\}\}"/);
  assert.match(wxml, /glass-style-done tap" catchtap="closeGlassStyleSheet"/);
  const combined = css.slice(css.indexOf('.glass-style-sheet,'));
  for (const declaration of [
    'linear-gradient(165deg, rgba(255, 255, 255, var(--glass-alpha-top, 0.10)), rgba(255, 255, 255, var(--glass-alpha-bottom, 0.04)))',
    '1rpx solid rgba(255, 255, 255, var(--glass-edge-alpha, 0.38))',
    'blur(var(--glass-blur-sheet, 8rpx))'
  ]) {
    assert.ok(combined.includes(declaration), 'glass material: ' + declaration);
  }
  // JS：打开只允许玻璃模式，关闭玻璃时两个弹窗都收起
  assert.match(js, /openGlassStyleSheet\(\) \{\s*if \(!this\.data\.settingsGlassEnabled\) return;/);
  assert.match(js, /openGlassStyleSheet\(\)[\s\S]{0,160}?openStylePopup\('#glass-style-entry', 'glassStyleOpen'\)/);
  assert.match(js, /toggleSettingsGlass\(e\)[\s\S]{0,220}?glassStyleOpen: false, nativeStyleOpen: false/);
  // 五根玻璃滑杆都在玻璃弹窗里
  const popupAt = wxml.indexOf('glass-style-title">{{ui[\'玻璃样式设置\']}}');
  const endAt = wxml.indexOf('原生样式设置弹窗');
  const glassSection = wxml.slice(popupAt, endAt);
  assert.equal((glassSection.match(/class="glass-alpha-slider"/g) || []).length, 5);
});


test('玻璃样式弹窗带拖动条，并可以一键恢复默认参数', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  const pref = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-style-pref.js'), 'utf8');
  // 底部形态带拖动条，非底部浮层不带
  assert.match(wxml, /<view wx:if="\{\{settingsGlassSheetEnabled\}\}" class="sheet-grabber"><\/view>\s*<view class="glass-style-head">/);
  // 重置按钮 + 完成按钮同排
  assert.match(wxml, /class="glass-style-actions"[\s\S]{0,400}?class="glass-style-reset tap" catchtap="resetGlassStyle"[\s\S]{0,200}?class="glass-style-done tap" catchtap="closeGlassStyleSheet"/);
  // 文案与 toast
  assert.match(wxml, /重置为默认/);
  assert.match(js, /resetGlassStyle\(\) \{[\s\S]*?settingsGlassStylePreference\.reset\(\)[\s\S]*?已恢复默认/);
  // 偏好模块提供 reset()，回到默认四项
  assert.match(pref, /function reset\(\) \{\s*return set\(DEFAULTS\);\s*\}/);
  assert.match(pref, /module\.exports = \{ KEY, DEFAULTS, LIMITS, read, set, view, reset, nativePalette \};/);
  const source = pref;
  let stored;
  const context = { module: { exports: {} }, wx: { getStorageSync: () => stored, setStorageSync: (_k, v) => { stored = v; } } };
  vm.runInNewContext(source, context);
  const module = context.module.exports;
  module.set({ alpha: 34, blur: 20, edge: 66, radius: 22, native: 20 });
  assert.equal(module.read().alpha, 34);
  module.reset();
  assert.equal(JSON.stringify(module.read()), JSON.stringify({ alpha: 10, blur: 8, edge: 38, radius: 32, brightness: 100, native: 50 }), 'reset restores every default (透明度 4% 即 10% -> 4% 渐变)');
});

test('玻璃样式设置入口排在玻璃UI样式开关正下方', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const glassSwitchAt = wxml.indexOf('bindchange="toggleSettingsGlass"');
  const entryAt = wxml.indexOf('id="glass-style-entry"');
  const sheetSwitchAt = wxml.indexOf('bindchange="toggleSettingsGlassSheet"');
  assert.ok(glassSwitchAt > 0 && entryAt > glassSwitchAt, 'entry sits under the glass UI switch');
  assert.ok(sheetSwitchAt > entryAt, 'the bottom-sheet switch keeps its place after the entry');
  assert.equal((wxml.match(/id="glass-style-entry"/g) || []).length, 1, 'only one entry row');
  assert.equal((wxml.match(/bindchange="toggleSettingsGlass"/g) || []).length, 1);
});

test('原生样式设置弹窗用原生皮肤：实色底 + 主题文字', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  // 弹窗带 native-skin，背景用当前原生调色（调节滑杆时弹窗自身即时变化）
  assert.match(wxml, /class="native-skin \{\{settingsGlassSheetEnabled \? 'glass-style-sheet' : 'glass-style-pop'\}\}"/);
  assert.match(wxml, /style="background-color: \{\{nativeSurfaceColor\}\};/);
  assert.match(css, /\.glass-style-sheet\.native-skin,[\s\S]{0,60}?\.glass-style-pop\.native-skin \{[\s\S]{0,200}?background: var\(--surface\);[\s\S]{0,200}?backdrop-filter: none;/);
  for (const selector of ['.glass-style-title', '.glass-style-label', '.glass-alpha-value']) {
    assert.ok(css.includes('.native-skin ' + selector), 'native skin text rule for ' + selector);
  }
  assert.ok(css.includes('color: var(--text);'), 'native skin text follows theme text colour');
  // 深浅色各自锁死文字色，避免继承错色
  assert.match(css, /\.theme-dark \.native-skin \.glass-style-title,[\s\S]{0,240}?#F1F4FA/);
  assert.match(css, /\.theme-light \.native-skin \.glass-style-title,[\s\S]{0,240}?#10131A/);
});

test('调节原生背景时，原生样式设置弹窗自身背景即时变化', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const pref = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-style-pref.js'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  // 弹窗背景绑定 nativeSurfaceColor；滑杆事件会重算调色并 setData
  assert.match(wxml, /style="background-color: \{\{nativeSurfaceColor\}\};/);
  assert.match(js, /onNativeBgChanging\(e\)[\s\S]{0,220}?applyNativeBg/);
  assert.match(js, /applyNativeBg\(value\)[\s\S]{0,220}?nativePaletteData\(v\)/);
  assert.match(js, /nativePaletteData\(value\)[\s\S]{0,260}?nativeSurfaceColor/);
  // 共享调色函数：默认 50 = 主题底色，亮度变化会给出不同颜色
  let stored;
  const context = { module: { exports: {} }, wx: { getStorageSync: () => stored, setStorageSync: (_k, v) => { stored = v; }, getWindowInfo: () => ({ windowWidth: 390 }) } };
  vm.runInNewContext(pref, context);
  const preference = context.module.exports;
  const dark = preference.nativePalette(50, false);
  const darker = preference.nativePalette(10, false);
  const brighter = preference.nativePalette(90, false);
  assert.equal(dark.surface, 'rgb(28, 28, 30)');
  assert.notEqual(darker.surface, dark.surface);
  assert.notEqual(brighter.surface, dark.surface);
  const light = preference.nativePalette(50, true);
  assert.equal(light.surface, 'rgb(255, 255, 255)');
  assert.match(preference.view({ native: 80 }).nativeSurfaceColor, /^rgb\(/);
});

test('非底部浮层形态下，玻璃样式设置弹窗比设置页内容宽度略窄', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  // 设置页左右内边距 40rpx：浮层左右各让出同样间距，宽度与内容区一致
  assert.match(js, /const pagePad = Math\.round\(40 \* \(windowWidth \/ 750\)\)/);
  assert.match(js, /const sideGap = pagePad \+ 16/);
  assert.match(js, /const popWidth = Math\.max\(240, windowWidth - sideGap \* 2\)/);
  assert.match(js, /glassStyleLeft: sideGap/);
  assert.match(js, /glassStyleWidth: popWidth/);
  // 设置页内容区宽度基准
  assert.match(css, /\.settings \{\s*padding: 0 40rpx 80rpx;/);
});

test('关闭玻璃 UI 时设置页卡片改用对话状态条卡片的填充背景', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const appCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.wxss'), 'utf8');
  // 根节点区分玻璃 / 原生：原生模式下卡片走 var(--fill)（对话状态条选项用的就是它）
  assert.match(wxml, /class="page settings \{\{themeClass\}\} \{\{settingsGlassEnabled \? 'settings-glass-ui' : 'settings-native-ui'\}\}"/);
  assert.match(css, /\.settings\.settings-native-ui\.theme-dark \.card \{[\s\S]{0,80}?background: var\(--fill\);/);
  // 浅色模式下卡片保持白色 surface，不套用深色的浅填充
  assert.doesNotMatch(css, /\.settings\.settings-native-ui \.card \{/);
  // 默认 .card 仍是实色 surface（玻璃开启时用玻璃材质）
  assert.match(appCss, /\.card \{[\s\S]{0,60}?background: var\(--surface\);/);
  // 对话状态条卡片（选项）也是 var(--fill)，两者背景一致
  assert.match(css, /\.status-style-option \{[^}]*background:\s*var\(--fill\)/);
});

test('原生背景：常用样式一键切换 + 亮度滑杆微调', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  // 预设色阶：五档，点击直接切换
  assert.match(js, /nativeBgPresets: \[[\s\S]{0,400}?\{ id: 'default', label: '默认', value: 50 \}/);
  assert.match(js, /\{ id: 'dim', label: '偏暗', value: 32 \}/);
  assert.match(js, /\{ id: 'dark', label: '更暗', value: 12 \}/);
  assert.match(js, /\{ id: 'bright', label: '偏亮', value: 72 \}/);
  assert.match(js, /\{ id: 'brightest', label: '最亮', value: 92 \}/);
  assert.match(wxml, /wx:for="\{\{nativeBgPresets\}\}"[\s\S]{0,300}?data-value="\{\{item.value\}\}"[\s\S]{0,200}?bindtap="pickNativeBgPreset"/);
  assert.match(wxml, /class="native-bg-chip \{\{nativeBgValue === item.value \? 'active' : ''\}\}"/);
  // 滑杆继续微调
  assert.match(wxml, /min="0"[\s\S]{0,200}?max="100"[\s\S]{0,200}?value="\{\{nativeBgValue\}\}"[\s\S]{0,200}?bindchanging="onNativeBgChanging"[\s\S]{0,120}?bindchange="onNativeBgChange"/);
  assert.match(js, /pickNativeBgPreset\(e\)[\s\S]{0,320}?settingsGlassStylePreference\.set\(\{ native: value \}\)[\s\S]{0,200}?this\.applyNativeBg\(value\)/);
  // 调色：默认 50 = 主题底色；更暗更黑、更亮更浅（逻辑在共享偏好里，各页面复用）
  const pref = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-style-pref.js'), 'utf8');
  assert.match(pref, /const base = light \? \[255, 255, 255\] : \[28, 28, 30\];/);
  assert.match(pref, /const darken = v < 50 \? \(50 - v\) \/ 50 \* \(light \? 0\.13 : 0\.55\) : 0;/);
  assert.match(pref, /const lighten = v > 50/);
  // 只在原生模式下覆盖 surface/bg/fill，玻璃模式不干预
  assert.match(wxml, /\{\{settingsGlassEnabled \? '' : '--surface: ' \+ nativeSurfaceColor \+ '; --fill: ' \+ nativeFillColor \+ ';'\}\}/);
  assert.doesNotMatch(wxml, /--bg: ' \+ nativeBgColor/, 'page/nav background stays fixed');
  // chips 样式
  assert.match(css, /\.native-bg-chip \{[\s\S]{0,200}?border-radius: 999rpx;/);
  assert.match(css, /\.native-bg-chip\.active \{/);
});

test('原生背景调暗时 fill 透明度同步降低（深色卡片不会再变亮）', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-style-pref.js'), 'utf8');
  // 深色：fill 是白色叠加，调暗减 alpha；浅色：黑色叠加，方向相反
  assert.match(js, /0\.06 \+ lighten \* 0\.16 - darken \* 0\.045/);
  assert.match(js, /0\.05 \+ darken \* 0\.50/);
  assert.match(js, /const fillAlpha = Math\.max\(0\.01, Math\.min\(0\.5, rawFill\)\);/);
});

test('原生样式设置是另一个独立弹窗，两个弹窗同时只显示一个', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  // 两个入口互斥：玻璃开 → 玻璃参数；玻璃关 → 原生样式设置
  assert.match(wxml, /<view wx:if="\{\{settingsGlassEnabled\}\}" class="card-row" id="glass-style-entry"/);
  assert.match(wxml, /<view wx:else class="card-row" id="native-style-entry" bindtap="openNativeStyleSheet"[^>]*aria-label="\{\{ui\['原生样式设置'\]\}\}"/);
  // 两个独立弹窗，分别由各自 open 状态控制
  assert.match(wxml, /wx:if="\{\{glassStyleOpen\}\}"/);
  assert.match(wxml, /wx:if="\{\{nativeStyleOpen\}\}"[\s\S]{0,160}?class="native-skin/);
  // 原生弹窗里只有原生背景相关控件（滑杆 + 预设），没有玻璃五参数
  const nativeStart = wxml.indexOf('<!-- 原生样式设置弹窗');
  assert.ok(nativeStart > 0, 'native popup block exists');
  const nativeSection = wxml.slice(nativeStart);
  assert.equal((nativeSection.match(/class="glass-alpha-slider"/g) || []).length, 1, 'native popup keeps one brightness slider');
  assert.ok(nativeSection.includes('{{ui[\'原生背景亮度\']}}'));
  assert.ok(nativeSection.includes('native-bg-chip'));
  assert.ok(!nativeSection.includes('{{ui[\'玻璃透明度\']}}'));
  // 原生弹窗背景色随调色即时变化
  assert.match(wxml, /class="native-skin \{\{settingsGlassSheetEnabled \? 'glass-style-sheet' : 'glass-style-pop'\}\}"[\s\S]{0,200}?style="background-color: \{\{nativeSurfaceColor\}\};/);
  // JS：各自打开/关闭，互斥由玻璃开关守卫
  assert.match(js, /openNativeStyleSheet\(\) \{\s*if \(this\.data\.settingsGlassEnabled\) return;/);
  assert.match(js, /openNativeStyleSheet\(\)[\s\S]{0,160}?openStylePopup\('#native-style-entry', 'nativeStyleOpen'\)/);
  assert.match(js, /closeNativeStyleSheet\(\) \{[\s\S]{0,100}?nativeStyleOpen: false/);
  assert.match(js, /nativeStyleOpen: false/);
});


test('原生背景亮度同时作用于首页、额度卡片页与会话设置页（含其弹窗）', () => {
  const pages = ['pages/home/home.wxml', 'pages/cost-meter/cost-meter.wxml', 'pages/session-settings/session-settings.wxml'];
  for (const file of pages) {
    const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram', file), 'utf8');
    assert.match(wxml, /\{\{settingsGlassEnabled \? '' : '--surface: ' \+ nativeSurfaceColor \+ '; --fill: ' \+ nativeFillColor \+ ';'\}\}/, file + ' injects native vars only in native mode');
    assert.doesNotMatch(wxml, /--bg: ' \+ nativeBgColor/, file + ' keeps the page background fixed');
    const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram', file.replace(/\.wxml$/, '.js')), 'utf8');
    assert.match(js, /settingsGlassStylePreference\.view\(\{ light: String\(this\.data\.themeClass \|\| ''\)\.indexOf\('light'\) >= 0 \}\)/, file + ' refreshes palette on show');
  }
  // 共享偏好导出的调色函数被这三页复用，避免数值漂移
  const pref = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-style-pref.js'), 'utf8');
  assert.match(pref, /function nativePalette\(value, light\)/);
  assert.match(pref, /nativeSurfaceColor: p\.surface, nativeBgColor: p\.bg, nativeFillColor: p\.fill/);
});

test('原生背景适配深色 / 浅色模式，切换外观后立即重算', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  const pref = fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/settings-glass-style-pref.js'), 'utf8');
  // 切换外观后重新应用主题并重算原生调色
  assert.match(js, /chooseAppearance\(e\)[\s\S]{0,320}?theme\.applyTo\(this\)[\s\S]{0,260}?this\.nativePaletteData\(this\.data\.nativeBgValue\)/);
  // 调色按主题取两套基色，默认 50 等于各自主题底色
  assert.match(pref, /const base = light \? \[255, 255, 255\] : \[28, 28, 30\];/);
  assert.match(pref, /const bgBase = light \? \[255, 255, 255\] : \[0, 0, 0\];/);
  // 深色 fill 是白叠加、浅色是黑叠加
  assert.match(pref, /const rawFill = light/);
  assert.match(pref, /rgba\(16, 19, 24, '/);
  assert.match(pref, /rgba\(255, 255, 255, '/);
  let stored;
  const context = { module: { exports: {} }, wx: { getStorageSync: () => stored, setStorageSync: (_k, v) => { stored = v; }, getWindowInfo: () => ({ windowWidth: 390 }) } };
  vm.runInNewContext(pref, context);
  const preference = context.module.exports;
  const dark = preference.view({ light: false });
  const light = preference.view({ light: true });
  assert.equal(dark.nativeBgValue, 50);
  assert.equal(dark.nativeSurfaceColor, 'rgb(28, 28, 30)');
  assert.equal(light.nativeSurfaceColor, 'rgb(255, 255, 255)');
  assert.notEqual(dark.nativeBgColor, light.nativeBgColor);
  assert.notEqual(dark.nativeFillColor, light.nativeFillColor);
  // 深浅模式下“更暗”都变暗
  const darkDim = preference.view({ light: false, native: 10 });
  const lightDim = preference.view({ light: true, native: 10 });
  assert.notEqual(darkDim.nativeSurfaceColor, dark.nativeSurfaceColor);
  assert.notEqual(lightDim.nativeSurfaceColor, light.nativeSurfaceColor);
});

test('样式设置弹窗包在主题容器里，深色下文字才继承正确的主题变量', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const themeAt = wxml.indexOf('<view class="{{themeClass}}">');
  const glassAt = wxml.indexOf('玻璃样式设置弹窗');
  const nativeAt = wxml.indexOf('原生样式设置弹窗');
  assert.ok(themeAt > 0, 'popups are wrapped in a theme container');
  assert.ok(glassAt > themeAt, 'glass popup inside the theme container');
  assert.ok(nativeAt > themeAt, 'native popup inside the theme container');
  // 容器在原生弹窗之后关闭
  assert.ok(wxml.lastIndexOf('</view>') > nativeAt, 'wrapper closes after the popups');
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  assert.match(css, /\.theme-dark \.native-skin \.glass-style-title,[\s\S]{0,240}?#F1F4FA/);
  assert.match(css, /\.theme-light \.native-skin \.glass-style-title,[\s\S]{0,240}?#10131A/);
});

test('对话页面玻璃：设置页独立开关控制，页面头部/输入区/协作弹窗变玻璃', () => {
  const root = path.resolve(__dirname, '..');
  const pref = fs.readFileSync(path.join(root, 'miniprogram/utils/session-glass-pref.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'miniprogram/pages/session/session.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'miniprogram/pages/session/session.wxss'), 'utf8');
  const settingsWxml = fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.wxml'), 'utf8');
  const settingsJs = fs.readFileSync(path.join(root, 'miniprogram/pages/settings/settings.js'), 'utf8');
  // 偏好：默认开启、可持久化
  let stored;
  const context = { module: { exports: {} }, wx: { getStorageSync: () => stored, setStorageSync: (_k, v) => { stored = v; } } };
  vm.runInNewContext(pref, context);
  const preference = context.module.exports;
  assert.equal(preference.DEFAULT, true);
  assert.equal(preference.read(), true);
  assert.equal(preference.set(false), false);
  assert.equal(preference.read(), false);
  // 对话页根节点按开关挂 session-glass，并注入玻璃变量
  assert.ok(wxml.includes("class=\"page session {{themeClass}} {{sessionGlassEnabled ? 'session-glass' : ''}}\""), 'session root toggles the glass class');
  assert.ok(wxml.includes('--glass-alpha-top: {{glassAlphaTop}}'), 'session root injects glass alpha');
  assert.ok(wxml.includes('style="{{contentFontStyle}}; --glass-alpha-top'), 'session root keeps content font style and adds glass vars');
  // 玻璃材质覆盖到头部、输入区、协作弹窗、文件提及菜单
  for (const selector of ['.session-glass .session-header', '.session-glass .composer', '.session-glass .sheet.collab-sheet', '.session-glass .file-mention-menu']) {
    const at = wxss.indexOf(selector);
    assert.ok(at >= 0, selector + ' glass rule');
    const slice = wxss.slice(at, at + 420);
    assert.ok(slice.includes('var(--glass-alpha-top'), selector + ' gradient');
    assert.ok(slice.includes('var(--glass-edge-alpha'), selector + ' hairline');
    assert.ok(slice.includes('blur(var(--glass-blur-'), selector + ' blur');
  }
  // 设置页独立开关：一行 switch + 处理器
  assert.ok(settingsWxml.includes('checked="{{sessionGlassEnabled}}"') && settingsWxml.includes('bindchange="toggleSessionGlass"'), 'settings switch exists');
  assert.ok(settingsWxml.includes("ui['对话页面玻璃']"), 'switch label present');
  assert.match(settingsJs, /toggleSessionGlass\(e\)[\s\S]{0,240}?sessionGlassPreference\.set/);
  assert.match(settingsJs, /onShow\(\)[\s\S]{0,1200}?sessionGlassEnabled: sessionGlassPreference\.read\(\)/);
});
