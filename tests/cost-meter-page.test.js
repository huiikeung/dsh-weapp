const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.js');
  const requests = [];
  const store = {
    state: { connection: 'connected', activeID: 'host-a', gatewayId: 'gw', endpoint: 'ws://gw', gatewayCapabilities: ['cost-meter-v1'] },
    client: {
      requestCostMeter(action, payload) {
        return new Promise((resolve, reject) => requests.push({ action, payload, resolve, reject }));
      },
    },
    subscribe(fn) { this.subscriber = fn; return () => {}; },
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
    showToast() {},
    showActionSheet() {},
    showModal() {},
    navigateBack() {},
    reLaunch() {},
    setStorageSync() {},
    getStorageSync() {},
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    wx,
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/theme') ? { applyTo(page) { page.setData({ theme: 'light', themeClass: 'theme-light' }); } }
        : require(path.resolve(path.dirname(file), name)),
    Number,
    Object,
    String,
    Math,
    Promise,
  });
  const page = { ...definition, data: { ...JSON.parse(JSON.stringify(definition.data)) }, setData(patch) { applyPatch(this.data, patch); } };
  return { page, store, requests, wx };
}

function applyPatch(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let parent = data;
    parts.slice(0, -1).forEach((part, i) => {
      if (parent[part] == null) parent[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      parent = parent[part];
    });
    parent[parts[parts.length - 1]] = value;
  });
}

const PLAN_IDS = ['opendesign', 'factory', 'anthropic', 'zai', 'minimax', 'kimi', 'openrouter', 'siliconflow', 'commandcode', 'clinepass', 'scnet', 'volcengine', 'qwen', 'mimo', 'workbuddy'];

function config() {
  return {
    currency: 'CNY', symbol: '¥', decimals: 3, exchangeRate: 7.2,
    display: { sidebarStyle: 'standard', sidebarVisible: true, sidebarTodayMetric: 'both', peakStyle: 'progress' },
    balance: { enabled: true, display: 'both', refreshMinutes: 5 },
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used' },
    peak: { enabled: true, display: 'both', effectiveAt: '', windows: [{ start: 1, end: 4 }], holidays: [] },
    budget: { display: 'both' },
    codingPlans: { siliconflow: { enabled: true, display: 'sidebar', refreshMinutes: 30 } },
    customBalances: [],
    gatewayQuotas: { sources: [] },
  };
}

function sources() {
  return {
    plans: PLAN_IDS.map(id => ({
      id, label: id, fields: [], needsSecret: id === 'volcengine', noKey: ['scnet', 'qwen', 'workbuddy'].includes(id),
      configured: id === 'siliconflow', settings: {},
    })),
    customBalances: [], gatewayQuotas: [],
  };
}

function dashboard() {
  return {
    currency: 'CNY', symbol: '¥', decimals: 3,
    display: { sidebarStyle: 'standard', sidebarVisible: true, peakStyle: 'progress' },
    balance: { enabled: true, display: 'both', refreshMinutes: 5, status: 'ok', message: '', currency: 'CNY', totalBalance: 7.289, granted: 1, toppedUp: 6.289, keyConfigured: true },
    customBalances: [],
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used', configured: true, status: 'ok', message: '', rolling: { percent: 21, resetsAt: '' }, weekly: { percent: 5, resetsAt: '' }, monthly: { percent: 3, resetsAt: '' } },
    plans: [{ id: 'siliconflow', label: 'siliconflow', enabled: true, display: 'sidebar', refreshMinutes: 30, status: 'ok', message: '', windows: { balance: { text: '余额 ¥12.50', resetsAt: '' } }, fetchedAt: 1 }],
    gatewayQuotas: [],
    peak: { enabled: true, display: 'both', label: '平价', remainingText: '2 小时', progressText: '20%', switchText: '明天 01:00 转峰时' },
    settings: { display: { sidebarStyle: 'standard' }, goQuota: {}, peak: {} },
  };
}

const frame = () => ({ kind: 'cost-meter', config: config(), dashboard: dashboard(), sources: sources(), summary: { budget: { enabled: true, amount: 100, used: 42, percent: 42, period: 'month' } } });
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Resolve the initial config load and the automatic refresh it triggers. */
async function ready(f) {
  f.page.onLoad();
  f.requests.shift().resolve(frame());
  await tick();
  const refresh = f.requests.find(item => item.action === 'refresh');
  if (refresh) {
    f.requests.splice(f.requests.indexOf(refresh), 1);
    refresh.resolve(frame());
    await tick();
  }
  return f;
}

test('quota page loads settings, sources and the live dashboard view', async () => {
  const f = await ready(fixture());
  assert.equal(f.page.data.planCells.length, 15);
  const sf = f.page.data.planCells.find(cell => cell.id === 'siliconflow');
  assert.equal(sf.enabled, true);
  assert.equal(sf.status, 'ok');
  assert.equal(f.page.data.displayForm.sidebarStyle, 'standard');
  assert.equal(f.page.data.view.balance.amountText, '¥7.289');
  assert.equal(f.page.data.view.go.rows.length, 3);
  assert.equal(f.page.data.budgetForm.percentText, '42%');
});

test('toggles save a gateway settings patch and keep the local form in sync', async () => {
  const f = await ready(fixture());
  f.page.toggleGo({ detail: { value: false } });
  assert.equal(f.page.data.goForm.enabled, false);
  const update = f.requests.find(item => item.action === 'update');
  assert.ok(update);
  assert.equal(JSON.stringify(update.payload.patch), JSON.stringify({ goQuota: { enabled: false } }));
  const updated = frame();
  updated.config.goQuota = { ...updated.config.goQuota, enabled: false };
  update.resolve(updated);
  await tick();
  assert.equal(f.page.data.goForm.enabled, false);
});

test('sidebar style and display options patch the display settings', async () => {
  const f = await ready(fixture());
  f.page.toggleSidebarVisible({ detail: { value: false } });
  const update = f.requests.find(item => item.action === 'update');
  assert.ok(update);
  assert.equal(JSON.stringify(update.payload.patch), JSON.stringify({ display: { sidebarVisible: false } }));
  update.resolve(frame());
  await tick();
});

test('plan credentials are written through the source-key action and never surfaced', async () => {
  const f = await ready(fixture());
  f.page.onPlanKeyInput({ currentTarget: { dataset: { index: 7 } }, detail: { value: 'sk-siliconflow' } });
  f.page.savePlanKey({ currentTarget: { dataset: { index: 7 } } });
  const request = f.requests.find(item => item.action === 'set-source-key');
  assert.ok(request, 'credential action sent');
  assert.equal(request.payload.source, 'plan:siliconflow');
  assert.equal(request.payload.value, 'sk-siliconflow');
  request.resolve({ kind: 'cost-meter' });
  await tick();
  assert.equal(f.page.data.planKeyDrafts.siliconflow, '');
});

test('custom balances are added and edited as a full validated list', async () => {
  const f = await ready(fixture());
  f.page.addCustom();
  const update = f.requests.find(item => item.action === 'update');
  assert.ok(update);
  assert.equal(update.payload.patch.customBalances.length, 1);
  assert.equal(update.payload.patch.customBalances[0].adapter, 'custom');
  update.resolve(frame());
  await tick();
});

test('peak windows and budget edits patch the gateway settings', async () => {
  const f = await ready(fixture());
  f.page.onBudgetAmountInput({ detail: { value: '200' } });
  f.page.commitBudget();
  const budget = f.requests.find(item => item.action === 'update' && item.payload.patch && item.payload.patch.budget);
  assert.equal(budget.payload.patch.budget.amount, 200);
  budget.resolve(frame());
  await tick();
});
