'use strict';
// 侧栏卡片排序：quotaSidebarSections 的顺序语义 + 额度页排序 UI 的 patch 载荷
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const costView = require('../miniprogram/utils/cost-view.js');

function model() {
  return {
    style: 'standard',
    balance: { title: '余额', display: 'both', amountText: '¥7.29' },
    budget: { enabled: true, display: 'both', percentText: '42%', usedText: '¥42', amountText: '¥100' },
    go: null,
    plans: [
      { id: 'siliconflow', label: 'SiliconFlow', enabled: true, display: 'sidebar', main: { percentText: '10%', barWidth: '10%' } },
      { id: 'kimi', label: 'Kimi', enabled: true, display: 'both', main: { percentText: '20%', barWidth: '20%' } },
    ],
    gateway: [{ id: 'gw-1', label: 'CLIProxyAPI', enabled: true, display: 'both', accounts: [] }],
    custom: [{ index: 0, label: '自定义', enabled: true, display: 'both', amountText: '¥42', percent: 42, barWidth: '42%' }],
    peak: { enabled: true, display: 'both', label: '峰时', remainingText: '2 小时', progressText: '20%', switchText: '12:00 转平价' },
    empty: false,
  };
}

test('sidebar sections follow sidebarOrder and append the rest in default order', () => {
  const sections = costView.quotaSidebarSections(model(), ['peak', 'plan:kimi', 'balance']);
  const keys = sections.map(s => s.key);
  assert.deepEqual(keys, ['peak', 'plan:kimi', 'balance', 'budget', 'plan:siliconflow', 'gateway:gw-1', 'custom:0']);
});

test('empty or invalid order falls back to the default section order', () => {
  const fallback = costView.quotaSidebarSections(model(), []).map(s => s.key);
  assert.deepEqual(fallback, ['balance', 'budget', 'plan:siliconflow', 'plan:kimi', 'gateway:gw-1', 'custom:0', 'peak']);
  const bogus = costView.quotaSidebarSections(model(), ['nope', 42, null, 'plan:missing']).map(s => s.key);
  assert.deepEqual(bogus, fallback, '非法/不存在键必须被忽略而不是打乱顺序');
  assert.deepEqual(costView.quotaSidebarSections(null, ['balance']), []);
});

test('duplicate order keys are de-duplicated', () => {
  const keys = costView.quotaSidebarSections(model(), ['balance', 'balance', 'budget', 'budget']).map(s => s.key);
  assert.deepEqual(keys, ['balance', 'budget', 'plan:siliconflow', 'plan:kimi', 'gateway:gw-1', 'custom:0', 'peak']);
});

test('quota page sidebar order moves a card and commits the new key list', async () => {
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
  const page = { ...definition, data: { ...JSON.parse(JSON.stringify(definition.data)) }, setData(patch) { Object.assign(this.data, patch); } };

  // onLoad 会把 this.alive 置 true，commitPatch 的守卫依赖它
  page.onLoad();

  // 直接喂一个含 sidebarOrder 的 config，走 applyFrame 生成排序行
  const PLAN_IDS = ['opendesign', 'factory', 'anthropic', 'zai', 'minimax', 'kimi', 'openrouter', 'siliconflow', 'commandcode', 'clinepass', 'scnet', 'volcengine', 'qwen', 'mimo', 'workbuddy'];
  const config = {
    currency: 'CNY', symbol: '¥', decimals: 3, exchangeRate: 7.2,
    display: { sidebarStyle: 'standard', sidebarVisible: true, peakStyle: 'progress' },
    balance: { enabled: true, display: 'both', refreshMinutes: 5 },
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15 },
    peak: { enabled: true, display: 'both', windows: [{ start: 1, end: 4 }] },
    budget: { enabled: true, amount: 100, period: 'month', display: 'both' },
    codingPlans: { kimi: { enabled: true, display: 'sidebar', refreshMinutes: 15 }, siliconflow: { enabled: true, display: 'sidebar', refreshMinutes: 15 } },
    customBalances: [], gatewayQuotas: { sources: [] },
    sidebarOrder: ['peak', 'plan:kimi', 'balance'],
  };
  const dashboard = {
    currency: 'CNY', symbol: '¥', decimals: 3,
    display: config.display,
    balance: { enabled: true, display: 'both', status: 'ok', message: '', currency: 'CNY', totalBalance: 7.289, granted: 1, toppedUp: 6.289, keyConfigured: true },
    customBalances: [], goQuota: { enabled: true, display: 'both', status: 'ok' }, plans: [], gatewayQuotas: [],
    peak: { enabled: true, display: 'both' }, settings: {},
  };
  const sources = {
    plans: PLAN_IDS.map(id => ({ id, label: id, fields: [], needsSecret: false, noKey: false, configured: false, settings: {} })),
    customBalances: [], gatewayQuotas: [],
  };

  page.applyFrame({ config, dashboard, sources, summary: { budget: null } });
  const keys = page.data.sidebarOrderCells.map(c => c.key);
  assert.equal(keys[0], 'peak', '排序行第一项必须按 sidebarOrder');
  assert.equal(keys[1], 'plan:kimi');
  assert.equal(keys[2], 'balance');
  assert.ok(keys.includes('plan:siliconflow'), '未列出的可见分区要补上');
  assert.ok(keys.includes('budget'));

  // 上移第一项 -> 变成 [plan:kimi, peak, balance, ...]，patch 必须带上新顺序
  const first = page.data.sidebarOrderCells[0].key;
  const second = page.data.sidebarOrderCells[1].key;
  page.moveSidebarOrder({ currentTarget: { dataset: { index: 1, dir: -1 } } });
  assert.equal(page.data.sidebarOrderCells[0].key, second, '上移后第二项应到第一位');
  assert.equal(page.data.sidebarOrderCells[1].key, first);
  const update = requests.find(r => r.action === 'update' && r.payload.patch && r.payload.patch.sidebarOrder);
  assert.ok(update, '必须发出 update');
  assert.equal(update.payload.patch.sidebarOrder[0], second);
  assert.equal(update.payload.patch.sidebarOrder[1], first);

  // 恢复默认 -> sidebarOrder 置空（取最后一个带 sidebarOrder 的 update）
  page.resetSidebarOrder();
  const orderUpdates = requests.filter(r => r.action === 'update' && r.payload.patch && 'sidebarOrder' in r.payload.patch);
  const reset = orderUpdates[orderUpdates.length - 1];
  assert.ok(reset, '恢复默认必须发出 update');
  // 跨 vm 上下文比较用 JSON，避免原型域差异导致 deepStrictEqual 误报
  assert.equal(JSON.stringify(reset.payload.patch.sidebarOrder), '[]', '恢复默认应提交空顺序');
});

test('moveSidebarOrder refuses to move past the ends', () => {
  const file = path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.js');
  const requests = [];
  const store = {
    state: { connection: 'connected', activeID: 'h', gatewayId: 'g', endpoint: 'ws://g', gatewayCapabilities: ['cost-meter-v1'] },
    client: { requestCostMeter(a, p) { return new Promise((res, rej) => requests.push({ action: a, payload: p, resolve: res, reject: rej })); } },
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
    Page: value => { definition = value; }, wx,
    require: name => name.endsWith('/store') ? store
      : name.endsWith('/theme') ? { applyTo(page) { page.setData({ theme: 'light', themeClass: 'theme-light' }); } }
        : require(path.resolve(path.dirname(file), name)),
    Number, Object, String, Math, Promise,
  });
  const page = { ...definition, data: { ...JSON.parse(JSON.stringify(definition.data)) }, setData(p) { Object.assign(this.data, p); } };
  page.onLoad();
  const before = requests.length;
  page.setData({ sidebarOrderCells: [{ key: 'balance' }, { key: 'budget' }] });
  page.moveSidebarOrder({ currentTarget: { dataset: { index: 0, dir: -1 } } });
  page.moveSidebarOrder({ currentTarget: { dataset: { index: 1, dir: 1 } } });
  assert.equal(requests.length, before, '越界移动不得发出请求');
  assert.deepEqual(page.data.sidebarOrderCells.map(c => c.key), ['balance', 'budget'], '越界移动不得改变顺序');
});
