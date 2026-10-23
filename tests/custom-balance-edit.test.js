'use strict';
// 实测自定义余额的完整编辑流程：新增 → 展开 → 改字段 → 保存，逐步验证
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
    showToast() {}, showActionSheet() {}, showModal() {}, navigateBack() {}, reLaunch() {},
    setStorageSync() {}, getStorageSync() {},
  };
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    wx,
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/theme') ? { applyTo(page) { page.setData({ theme: 'light', themeClass: 'theme-light' }); } }
        : require(path.resolve(path.dirname(file), name)),
    Number, Object, String, Math, Promise,
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
    goQuota: { enabled: false, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used' },
    peak: { enabled: true, display: 'both', effectiveAt: '', windows: [{ start: 1, end: 4 }], holidays: [] },
    budget: { display: 'both' },
    codingPlans: {}, customBalances: [], gatewayQuotas: { sources: [] },
  };
}

function sources() {
  return {
    plans: PLAN_IDS.map(id => ({ id, label: id, fields: [], needsSecret: id === 'volcengine', noKey: ['scnet', 'qwen', 'workbuddy'].includes(id), configured: false, settings: {} })),
    customBalances: [], gatewayQuotas: [],
  };
}

function dashboard() {
  return {
    currency: 'CNY', symbol: '¥', decimals: 3,
    display: { sidebarStyle: 'standard', sidebarVisible: true, peakStyle: 'progress' },
    balance: { enabled: true, display: 'both', refreshMinutes: 5, status: 'off', message: '', currency: '', totalBalance: 0, granted: 0, toppedUp: 0, keyConfigured: false },
    customBalances: [], goQuota: { enabled: false, display: 'both', status: 'off' }, plans: [], gatewayQuotas: [],
    peak: { enabled: true, display: 'both' }, settings: { display: { sidebarStyle: 'standard' }, goQuota: {}, peak: {} },
  };
}

const frame = () => ({ kind: 'cost-meter', config: config(), dashboard: dashboard(), sources: sources(), summary: { budget: null } });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function ready(f) {
  f.page.onLoad();
  f.requests.shift().resolve(frame());
  await tick();
  const refresh = f.requests.find(item => item.action === 'refresh');
  if (refresh) { f.requests.splice(f.requests.indexOf(refresh), 1); refresh.resolve(frame()); await tick(); }
  return f;
}

test('自定义余额：新增→展开→改字段→保存，编辑内容必须进入 patch', async () => {
  const f = await ready(fixture());
  assert.equal(f.page.data.customCells.length, 0, '初始无自定义余额');

  // 1) 新增（不 await：先让请求挂起，再回应）
  const adding = f.page.addCustom();
  await tick();
  const addReq = f.requests.find(r => r.action === 'update' && r.payload.patch && r.payload.patch.customBalances);
  assert.ok(addReq, 'addCustom 必须发出 update');
  assert.equal(addReq.payload.patch.customBalances.length, 1, '新增后应有 1 条');

  // 用新增后的 frame 回应，页面应渲染出 1 个 cell
  const afterAdd = frame();
  afterAdd.config.customBalances = addReq.payload.patch.customBalances;
  afterAdd.sources.customBalances = [{ index: 0, configured: false, keyRef: 'WEAPP_CUSTOM_BALANCE_0' }];
  addReq.resolve(afterAdd);
  await adding;
  await tick();
  assert.equal(f.page.data.customCells.length, 1, '新增回应后应渲染 1 个自定义余额');

  // 2) addCustom 会自动展开新条目（expandedCustom = entries.length - 1）
  assert.equal(f.page.data.expandedCustom, 0, '新增后应自动展开该条目');
  assert.equal(f.page.data.customCells[0].expanded, true, '新条目应处于展开态');
  // 再次点击"展开"按钮应收起
  f.page.toggleCustomExpand({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.expandedCustom, -1, '再次点击应收起');
  assert.equal(f.page.data.customCells[0].expanded, false, '应收起为 false');
  // 再点一次重新展开
  f.page.toggleCustomExpand({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.expandedCustom, 0, '第三次点击应重新展开');

  // 3) 改字段
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index: 0, field: 'label' } }, detail: { value: '我的余额' } });
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index: 0, field: 'unit' } }, detail: { value: 'CNY' } });
  f.page.onCustomRequestInput({ currentTarget: { dataset: { index: 0, field: 'url' } }, detail: { value: 'https://api.example.com/balance' } });
  assert.equal(f.page.data.customCells[0].label, '我的余额', 'label 编辑必须生效');
  assert.equal(f.page.data.customCells[0].request.url, 'https://api.example.com/balance', 'url 编辑必须生效');

  // 4) 保存
  f.page.saveCustom({ currentTarget: { dataset: { index: 0 } } });
  await tick();
  const saveReq = f.requests.find(r => r.action === 'update' && r.payload.patch && r.payload.patch.customBalances && r !== addReq);
  assert.ok(saveReq, 'saveCustom 必须发出 update');
  const saved = saveReq.payload.patch.customBalances[0];
  assert.equal(saved.label, '我的余额', '保存的 label 必须是编辑后的值');
  assert.equal(saved.unit, 'CNY', '保存的 unit 必须是编辑后的值');
  assert.equal(saved.request.url, 'https://api.example.com/balance', '保存的 url 必须是编辑后的值');
  assert.equal(saved.request.method, 'GET');
});

test('自定义余额：保存失败时给出错误提示且不丢页面状态', async () => {
  const f = await ready(fixture());
  const adding = f.page.addCustom();
  await tick();
  const addReq = f.requests.find(r => r.action === 'update');
  const afterAdd = frame();
  afterAdd.config.customBalances = addReq.payload.patch.customBalances;
  addReq.resolve(afterAdd);
  await adding;
  await tick();

  f.page.toggleCustomExpand({ currentTarget: { dataset: { index: 0 } } });
  f.page.toggleCustomExpand({ currentTarget: { dataset: { index: 0 } } });
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index: 0, field: 'label' } }, detail: { value: 'X' } });
  f.page.saveCustom({ currentTarget: { dataset: { index: 0 } } });
  await tick();
  const saveReq = f.requests[f.requests.length - 1];
  saveReq.reject(Object.assign(new Error('第 1 条自定义余额缺少接口地址'), { code: 'bad-request' }));
  await tick();
  assert.equal(f.page.data.customCells.length, 1, '失败后自定义余额不应消失');
});
