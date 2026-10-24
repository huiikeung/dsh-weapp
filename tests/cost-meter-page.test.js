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

test('adding a custom balance starts from a blank form; saibo is an explicit preset', async () => {
  const f = await ready(fixture());
  f.page.addCustom();
  const update = f.requests.find(item => item.action === 'update');
  const entry = update.payload.patch.customBalances[0];
  // 默认新增是空表单：不预填任何厂商配置
  assert.equal(entry.label, '');
  assert.equal(entry.labelEn, '');
  assert.equal(entry.enabled, false);
  assert.equal(entry.request.url, '');
  update.resolve(frame());
  await tick();

  // 赛博只通过专属按钮添加，并带齐全部配置
  f.page.addCustomPreset({ currentTarget: { dataset: { kind: 'saibo' } } });
  const presetUpdate = f.requests.filter(item => item.action === 'update').pop();
  const preset = presetUpdate.payload.patch.customBalances.at(-1);
  assert.equal(preset.label, '赛博');
  assert.equal(preset.labelEn, 'saibo');
  assert.equal(preset.unit, 'USD');
  assert.equal(preset.enabled, true);
  assert.equal(preset.request.url, 'https://saibo.xytnb.xyz/v1/usage');
  assert.equal(preset.request.headers.Authorization, 'Bearer {{SAIBO_API_KEY}}');
  assert.equal(preset.extract.remaining, 'balance');
  assert.equal(preset.extract.maxBudget, 'info.max_budget');
  assert.equal(preset.extract.spend, 'info.spend');
  assert.deepEqual(Array.from(preset.allowedHosts), ['saibo.xytnb.xyz']);
});

test('custom field typing never rewrites the displayed value so paste keeps working', async () => {
  const f = await ready(fixture());
  f.page.addCustom();
  const update = f.requests.find(item => item.action === 'update');
  const entry = update.payload.patch.customBalances[0];
  const added = frame();
  added.config.customBalances = [entry];
  update.resolve(added);
  await tick();
  const index = f.page.data.customCells.length - 1;
  assert.equal(f.page.data.customCells.length, 1);
  f.page.openCustomSheet({ currentTarget: { dataset: { index } } });
  const shown = f.page.data.sheetCustom.label;
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index, field: 'label' } }, detail: { value: '赛博余额' } });
  assert.equal(f.page.data.customCells[index].label, '赛博余额', 'cells 立即保存输入值');
  assert.equal(f.page.data.sheetCustom.label, shown, '输入中不回写显示值（否则真机粘贴/光标失效）');
  f.page.onCustomFieldBlur({ currentTarget: { dataset: { index } } });
  assert.equal(f.page.data.sheetCustom.label, '赛博余额', '失焦后同步显示值');
  // 请求头 textarea：同样只在失焦后回写
  const headersBefore = f.page.data.sheetCustom.headersText;
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index, field: 'headersText' } }, detail: { value: 'Authorization: Bearer x' } });
  assert.equal(f.page.data.sheetCustom.headersText, headersBefore);
  f.page.onCustomFieldBlur({ currentTarget: { dataset: { index } } });
  assert.equal(f.page.data.sheetCustom.headersText, 'Authorization: Bearer x');
  // 密钥输入不回写显示值
  f.page.onCustomKeyInput({ currentTarget: { dataset: { index } }, detail: { value: 'sk-live' } });
  assert.equal(f.page.data.customKeyDrafts[index], 'sk-live');
  f.page.onCustomKeyBlur({ currentTarget: { dataset: { index } } });
  assert.equal(f.page.data.sheetCustom.keyDraft, 'sk-live');
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


test('the quota card page owns the sidebar visibility switch and hides everything below it', async () => {
  const hidden = frame();
  hidden.config.display.sidebarVisible = false;
  const f = fixture();
  f.page.onLoad();
  f.requests[0].resolve(hidden);
  await tick();
  assert.equal(f.page.data.displayForm.sidebarVisible, false, 'sidebar card stays hidden until the user opts in');
  f.page.toggleSidebarVisible({ detail: { value: true } });
  const update = f.requests.find(item => item.action === 'update');
  assert.ok(update, 'the switch persists through the gateway');
  assert.equal(JSON.stringify(update.payload.patch), JSON.stringify({ display: { sidebarVisible: true } }));
  assert.equal(f.page.data.displayForm.sidebarVisible, true);
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.wxml'), 'utf8');
  assert.ok(wxml.includes('bindchange="toggleSidebarVisible"'), '开关在额度卡片页内');
  assert.ok(/<block wx:if="\{\{displayForm\.sidebarVisible\}\}">/.test(wxml), '关闭时隐藏下方所有分区');
  assert.ok(wxml.includes("ui['显示']"), '官方余额/Go/预算/峰谷归到「显示」');
  assert.ok(wxml.includes("ui['额度']"), 'Coding Plan/网关/自定义归到「额度」');
});

test('opening the page with ?component= focuses that module in the display sheet', async () => {
  const f = fixture();
  f.page.onLoad({ component: 'plan:minimax' });
  f.requests[0].resolve(frame());
  await tick();
  assert.equal(f.page.data.sheet, 'display');
  assert.equal(f.page.data.previewComponent, 'plan:minimax');
  assert.equal(f.page.data.componentPickerOpen, false);
  assert.equal(f.page.data.previewComponentLabel, 'minimax');
});
