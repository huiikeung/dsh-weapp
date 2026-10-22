const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.js');
  const requests = [];
  const store = {
    state: { connection: 'connected', activeID: 'host-a', gatewayCapabilities: ['cost-meter-v1'] },
    client: { requestCostMeter(action, payload) {
      return new Promise((resolve, reject) => requests.push({ action, payload, resolve, reject }));
    } },
    subscribe(fn) { this.subscriber = fn; return () => {}; },
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
    showToast() {},
    showActionSheet() {},
    navigateBack() {},
    reLaunch() {},
    getStorageSync(key) { return this.storage && this.storage[key]; },
    setStorageSync(key, value) { this.storage = this.storage || {}; this.storage[key] = value; },
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    wx,
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/theme') ? { applyTo(page) { page.setData({ theme: 'light', themeClass: 'theme-light' }); } }
        : name.endsWith('/ui-preferences') ? { t: value => value }
          : require(path.resolve(path.dirname(file), name)),
    Number,
    Object,
    String,
    Math,
    Promise,
  });
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  page.onLoad();
  return { page, store, requests, wx };
}

const dashboard = {
  currency: 'CNY', exchangeRate: 7.2, decimals: 3,
  balance: { enabled: true, status: 'ok', currency: 'CNY', totalBalance: 7.289 },
  customBalances: [{ index: 0, enabled: true, display: 'sidebar', label: '赛博', status: 'ok', remaining: -0.0114, unit: 'USD' }],
  goQuota: { enabled: true, status: 'ok', main: 'rolling', barDirection: 'used', rolling: { percent: 3, resetsAt: '' } },
  peak: { enabled: false, windows: [] },
};

test('dedicated quota settings page loads a live card preview', async () => {
  const f = fixture();
  assert.deepEqual(f.requests.map(item => item.action), ['config']);
  f.requests[0].resolve({ dashboard });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.page.data.dashboard.balance.amountText, '¥7.289');
  assert.equal(f.page.data.dashboard.customBalances[0].amountText, '$-0.0114');
  assert.equal(f.page.data.dashboard.go.percentText, '3%');
  assert.equal(f.page.data.customBalanceSettings[0].checked, true);
});

test('quota visibility and card style are stored locally without changing gateway data configuration', async () => {
  const f = fixture();
  f.requests[0].resolve({ dashboard });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  f.page.onGoToggle({ detail: { value: false } });
  f.page.saveCardPreferences({ style: 'standard' });
  assert.equal(f.page.data.dashboard.go, null);
  assert.equal(f.page.data.dashboard.style, 'standard');
  assert.deepEqual(f.requests.map(item => item.action), ['config', 'update'], 'Go enablement is managed by the native gateway');
  const saved = f.wx.getStorageSync('dsh.cost-meter.dashboard.' + encodeURIComponent('host-a||'));
  assert.equal(saved.showGo, false);
  assert.equal(saved.style, 'standard');
});

test('Go API keys are sent only to the host credential action and never saved in mini-program storage', async () => {
  const f = fixture();
  f.requests[0].resolve({ dashboard });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  f.page.onGoKeyInput({ detail: { value: 'private-go-key' } });
  const save = f.page.onSaveGoKey();
  assert.equal(f.requests[1].action, 'set-go-key');
  assert.equal(JSON.stringify(f.requests[1].payload), JSON.stringify({ value: 'private-go-key' }));
  f.requests[1].resolve({ kind: 'cost-meter' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests[2].action, 'refresh');
  assert.equal(f.page.data.keyDraft, '');
  assert.doesNotMatch(JSON.stringify(f.wx.storage || {}), /private-go-key/);
  f.requests[2].resolve({ dashboard });
  await save;
});

test('quota card settings live in the sidebar settings group, never in plugin details', () => {
  const home = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.wxml'), 'utf8');
  const homeController = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/home/home.js'), 'utf8');
  const settings = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const settingsController = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/settings/settings.js'), 'utf8');
  // 卡片仍由首页左侧栏渲染，但设置入口与显示开关搬到「设置 → 侧栏」。
  assert.match(home, /class="drawer-cost-card drawer-cost-card-\{\{costDashboard\.style\}\}"/);
  assert.doesNotMatch(home, /drawer-cost-settings/);
  assert.match(settings, /<view class="group-title">\{\{ui\['侧栏'\]\}\}<\/view>/);
  assert.match(settings, /bindtap="openCostMeter"/);
  assert.match(settings, /bindchange="toggleCostCard"/);
  assert.match(settingsController, /\/pages\/cost-meter\/cost-meter/);
  assert.doesNotMatch(homeController, /plugin-detail\/plugin-detail\?bundle=.*dsh-cost-meter/);
  assert.doesNotMatch(settingsController, /plugin-detail\/plugin-detail\?bundle=.*dsh-cost-meter/);
});
