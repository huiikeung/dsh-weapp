const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(options = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/home/home.js');
  const requests = [];
  const store = {
    state: { profiles: [], sessions: [], workspaces: [], connection: 'disconnected', activeID: 'host-a', gatewayCapabilities: ['cost-meter-v1'] },
    sessionState: {},
    client: {
      requestCostMeter(action) {
        return new Promise((resolve, reject) => requests.push({ action, resolve, reject }));
      }
    },
    subscribe(fn) { this.subscriber = fn; return () => {}; },
    stopHostProbes() {}
  };
  const storage = new Map();
  // 默认给这个主机预置“已开启额度卡片”，让既有用例覆盖开启后的行为；
  // 需要验证默认关闭时用 fixture({ seedEnabled: false })。
  if (options.seedEnabled !== false) {
    ['host-a||', 'host-b||'].forEach(owner => {
      storage.set('dsh.cost-meter.dashboard.' + encodeURIComponent(owner), { sidebarVisible: true });
    });
  }
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    setNavigationBarColor() {},
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value)
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    wx,
    getApp: () => ({}),
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/theme') ? { resolveTheme: () => 'light' }
        : require(path.resolve(path.dirname(file), name))
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); },
    hapticLight() {}
  };
  page.onLoad();
  return { page, store, requests, wx, storage, emit() { store.subscriber({ app: store.state, session: store.sessionState }); } };
}

function summary(amount) {
  return {
    available: true,
    currency: 'CNY',
    today: { amount, tokens: 1250 },
    month: { amount: amount * 2, tokens: 2500 },
    balance: null
  };
}

test('sidebar usage loads when the gateway connects without reopening the home page', async () => {
  const f = fixture();
  assert.equal(f.requests.length, 0);
  f.store.state.connection = 'connected';
  f.emit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].action, 'summary');
  f.requests[0].resolve({ summary: summary(1.25) });
  await Promise.resolve();
  await Promise.resolve();
  assert.match(f.page.data.costCard.todayText, /¥1\.25/);
  f.store.state.connection = 'disconnected';
  f.emit();
  assert.equal(f.page.data.costCard, null);
  f.store.state.connection = 'connected';
  f.emit();
  assert.match(f.page.data.costCard.todayText, /¥1\.25/, 'recent cached summary is restored after reconnect');
  assert.equal(f.requests.length, 1, 'connected store updates should use the short-lived summary cache');
});

test('a stale request from a disconnected or switched host cannot replace current sidebar usage', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.store.state.connection = 'disconnected';
  f.emit();
  assert.equal(f.page.data.costCard, null);
  f.store.state.activeID = 'host-b';
  f.store.state.connection = 'connected';
  f.emit();
  assert.equal(f.requests.length, 2);
  f.requests[0].resolve({ summary: summary(1) });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.page.data.costCard, null, 'response from the previous connection is ignored');
  f.requests[1].resolve({ summary: summary(2) });
  await Promise.resolve();
  await Promise.resolve();
  assert.match(f.page.data.costCard.todayText, /¥2\.00/);
});

test('opening the sidebar triggers a summary request when already connected', () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.page.openDrawer();
  assert.equal(f.requests.length, 1);
  assert.equal(f.page.data.drawerOpen, true);
});

test('unsupported gateways show an upgrade hint instead of waiting for a request timeout', () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.store.state.gatewayCapabilities = [];
  f.page.openDrawer();
  assert.equal(f.requests.length, 0);
  assert.match(f.page.data.costCardError, /网关/);
});

test('sidebar renders the reference-style quota card from native cost-meter state', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.requests[0].resolve({
    summary: summary(1.25),
    dashboard: {
      currency: 'CNY', exchangeRate: 7.2, decimals: 3,
      balance: { enabled: true, status: 'ok', currency: 'CNY', totalBalance: 7.289 },
      customBalances: [{ index: 0, enabled: true, display: 'sidebar', label: '赛博', status: 'ok', remaining: -0.0114, unit: 'USD' }],
      goQuota: { enabled: true, status: 'ok', main: 'rolling', barDirection: 'used', rolling: { percent: 3, resetsAt: '' } },
      peak: { enabled: false, windows: [] },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.page.data.costDashboard.balance.amountText, '¥7.289');
  assert.equal(f.page.data.costDashboard.customBalances[0].amountText, '$-0.0114');
  assert.equal(f.page.data.costDashboard.go.percentText, '3%');
  assert.equal(f.page.data.costCardError, '');
});

test('sidebar handles temporarily empty native data without prompting for a plugin', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.requests[0].resolve({ summary: summary(1), dashboard: null });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.page.data.costDashboard, null);
  assert.equal(f.page.data.costCardError, '');
});


test('the sidebar quota card is off by default and requests no data until enabled', () => {
  const f = fixture({ seedEnabled: false });
  f.store.state.connection = 'connected';
  f.emit();
  assert.equal(f.requests.length, 0, 'hidden card must not request quota data');
  assert.equal(f.page.data.costDashboard, null);
  assert.equal(f.page.data.costCardError, '');
  f.page.openDrawer();
  assert.equal(f.requests.length, 0, 'opening the drawer keeps the hidden card off');
  assert.equal(f.page.data.drawerOpen, true);
});

test('showing the quota card again loads it on the next drawer open', async () => {
  const f = fixture();
  const key = 'dsh.cost-meter.dashboard.' + encodeURIComponent('host-a||');
  f.storage.set(key, { sidebarVisible: false });
  f.store.state.connection = 'connected';
  f.emit();
  assert.equal(f.requests.length, 0);

  // 模拟在「设置 → 侧栏」里打开开关后返回首页并打开左侧栏。
  f.storage.set(key, { sidebarVisible: true });
  f.page.openDrawer();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({
    summary: summary(1),
    dashboard: {
      currency: 'CNY', decimals: 2,
      balance: { enabled: true, status: 'ok', currency: 'CNY', totalBalance: 3 },
      customBalances: [], goQuota: { enabled: false }, peak: { enabled: false, windows: [] },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(f.page.data.costDashboard);
});
