const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(options = {}) {
  const file = path.resolve(__dirname, '../miniprogram/pages/home/home.js');
  const requests = [];
  const store = {
    state: {
      profiles: [], sessions: [], workspaces: [], connection: 'disconnected',
      activeID: 'host-a', gatewayId: 'gw', endpoint: 'ws://gw',
      gatewayCapabilities: options.capabilities || ['cost-meter-v1'],
    },
    sessionState: {},
    client: {
      requestCostMeter(action) {
        return new Promise((resolve, reject) => requests.push({ action, resolve, reject }));
      },
      requestWorkspaces() {},
      requestSessions() {},
    },
    subscribe(fn) { this.subscriber = fn; return () => {}; },
    stopHostProbes() {},
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getAppBaseInfo: () => ({ theme: 'light' }),
    setNavigationBarColor() {},
    getStorageSync() {},
    setStorageSync() {},
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    wx,
    getApp: () => ({}),
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/theme') ? { resolveTheme: () => 'light' }
        : require(path.resolve(path.dirname(file), name)),
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
    hapticLight() {},
  };
  page.onLoad();
  return { page, store, requests, emit() { store.subscriber({ app: store.state, session: store.sessionState }); } };
}

function frame(overrides = {}) {
  const config = {
    currency: 'CNY', symbol: '¥', decimals: 3, exchangeRate: 7.2,
    display: { sidebarStyle: 'summary', sidebarVisible: true, peakStyle: 'progress' },
    balance: { enabled: true, display: 'both', refreshMinutes: 5 },
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used' },
    peak: { enabled: true, display: 'both', windows: [{ start: 1, end: 4 }] },
  };
  const dashboard = {
    currency: 'CNY', symbol: '¥', decimals: 3,
    display: config.display,
    balance: { enabled: true, display: 'both', refreshMinutes: 5, status: 'ok', message: '', currency: 'CNY', totalBalance: 7.289, granted: 1, toppedUp: 6.289, keyConfigured: true },
    customBalances: [{ index: 0, label: '自定义', unit: 'CNY', display: 'both', enabled: true, status: 'ok', message: '', remaining: 42, maxBudget: 100, percent: 42 }],
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used', configured: true, status: 'ok', message: '', rolling: { percent: 21, resetsAt: '' }, weekly: { percent: 5, resetsAt: '' }, monthly: { percent: 3, resetsAt: '' } },
    plans: [{ id: 'siliconflow', label: 'SiliconFlow 硅基流动', enabled: true, display: 'sidebar', refreshMinutes: 30, status: 'ok', message: '', windows: { balance: { text: '余额 ¥12.50', resetsAt: '' } } }],
    gatewayQuotas: [],
    peak: { enabled: true, display: 'both', label: '平价', remainingText: '2 小时', progressText: '20%', switchText: '明天 01:00 转峰时' },
    settings: {},
  };
  const summary = { budget: { enabled: true, amount: 100, used: 42, percent: 42, period: 'month' } };
  if (overrides.dashboard) Object.assign(dashboard, overrides.dashboard);
  if (overrides.config) Object.assign(config, overrides.config);
  return { kind: 'cost-meter', config, dashboard, summary };
}

test('sidebar quota card renders the chosen layout from the gateway dashboard', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  assert.equal(f.requests[0].action, 'summary');
  f.requests[0].resolve(frame());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.page.data.costSidebar, 'sidebar model is built');
  assert.equal(f.page.data.costSidebar.style, 'summary');
  assert.equal(f.page.data.costSidebar.balance.amountText, '¥7.289');
  assert.equal(f.page.data.costSidebar.budget.percentText, '42%');
  assert.equal(f.page.data.costSidebar.go.rows.length, 3);
  assert.equal(f.page.data.costSidebar.plans.length, 1);
  assert.equal(f.page.data.costSidebar.custom.length, 1);
});

test('server-side sidebar visibility hides the card without rendering stale data', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  const hidden = frame();
  hidden.dashboard.display = { ...hidden.dashboard.display, sidebarVisible: false };
  f.requests[0].resolve(hidden);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.costSidebar, null);
});

test('the four layout styles are carried into the drawer model', async () => {
  for (const style of ['summary', 'simple', 'standard', 'compact']) {
    const f = fixture();
    f.store.state.connection = 'connected';
    f.emit();
    const next = frame();
    next.dashboard.display = { ...next.dashboard.display, sidebarStyle: style };
    f.requests[0].resolve(next);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.page.data.costSidebar.style, style);
  }
});

test('unsupported gateways show an upgrade hint instead of requesting quota data', () => {
  const f = fixture({ capabilities: [] });
  f.store.state.connection = 'connected';
  f.emit();
  assert.equal(f.requests.length, 0);
  assert.match(f.page.data.costCardError, /网关/);
});

test('a cached summary avoids repeated requests while the drawer is reused', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.requests[0].resolve(frame());
  await new Promise(resolve => setImmediate(resolve));
  f.emit();
  assert.equal(f.requests.length, 1, 'recent summary is reused for 30 seconds');
});

test('failed reads surface a non-blocking hint and clear the card', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.requests[0].reject(new Error('boom'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.costSidebar, null);
  assert.match(f.page.data.costCardError, /额度数据暂不可用/);
});

test('opening the drawer triggers a summary request when connected', () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.page.openDrawer();
  assert.equal(f.requests.length, 1);
  assert.equal(f.page.data.drawerOpen, true);
});


test('returning from settings invalidates the cached quota card so the switch is honoured', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.requests[0].resolve(frame());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.page.data.costSidebar);
  f.page.onShow();
  assert.equal(f.requests.length, 2, 'the home page re-reads the gateway after settings');
  const hiddenFrame = frame();
  hiddenFrame.dashboard.display = { ...hiddenFrame.dashboard.display, sidebarVisible: false };
  f.requests[1].resolve(hiddenFrame);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.costSidebar, null);
});

test('losing the connection immediately hides a stale sidebar card', async () => {
  const f = fixture();
  f.store.state.connection = 'connected';
  f.emit();
  f.requests[0].resolve(frame());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.page.data.costSidebar);
  f.store.state.connection = 'disconnected';
  f.emit();
  assert.equal(f.page.data.costSidebar, null);
  assert.equal(f.page.data.costDashboard, null);
});
