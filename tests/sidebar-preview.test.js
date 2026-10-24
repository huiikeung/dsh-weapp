'use strict';
// 侧栏预览：检查器组件清单、display/enabled 读写、applyFrame 帧缓存不破坏编辑
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
  page.onLoad();
  return { page, requests, store };
}

/** 微信 setData 的路径语法：'a.b[0].c' */
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

function frame(overrides = {}) {
  const config = Object.assign({
    currency: 'CNY', symbol: '¥', decimals: 3, exchangeRate: 7.2,
    display: { sidebarStyle: 'standard', sidebarVisible: true, sidebarTodayMetric: 'both', peakStyle: 'progress', peakTimeDisplay: 'both', sidebarTodayBalanceInline: false },
    balance: { enabled: true, display: 'both', refreshMinutes: 5, showProgressBar: false, barDirection: 'remaining' },
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used' },
    peak: { enabled: true, display: 'both', windows: [{ start: 1, end: 4 }], holidays: [] },
    budget: { enabled: true, amount: 100, period: 'month', display: 'both', detail: true, barDirection: 'used' },
    codingPlans: { siliconflow: { enabled: true, display: 'sidebar', refreshMinutes: 15 } },
    customBalances: [], gatewayQuotas: { sources: [] },
    sidebarOrder: [],
  }, overrides.config || {});
  const dashboard = Object.assign({
    currency: 'CNY', symbol: '¥', decimals: 3,
    display: config.display,
    balance: { enabled: true, display: 'both', refreshMinutes: 5, status: 'ok', message: '', currency: 'CNY', totalBalance: 7.289, granted: 1, toppedUp: 6.289, keyConfigured: true },
    customBalances: [], goQuota: { enabled: true, display: 'both', status: 'ok', rolling: { percent: 21 }, weekly: { percent: 5 }, monthly: { percent: 3 } },
    plans: [], gatewayQuotas: [], peak: { enabled: true, display: 'both' },
    settings: { display: config.display, sidebarOrder: config.sidebarOrder },
  }, overrides.dashboard || {});
  const sources = {
    plans: PLAN_IDS.map(id => ({ id, label: id, fields: [], needsSecret: false, noKey: false, configured: false, settings: {} })),
    customBalances: [], gatewayQuotas: [],
  };
  return { kind: 'cost-meter', config, dashboard, sources, summary: { budget: { enabled: true, amount: 100, used: 42, percent: 42, period: 'month' } } };
}

test('preview inspector lists every adjustable component with its config path', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  const list = f.page.previewComponents();
  const ids = list.map(item => item.id);
  for (const id of ['balance', 'budget', 'go', 'peak', 'plan:siliconflow', 'plan:kimi']) {
    assert.ok(ids.includes(id), '组件清单应包含 ' + id);
  }
  const sf = list.find(item => item.id === 'plan:siliconflow');
  assert.equal(sf.path, 'codingPlans.siliconflow');
});

test('preview model reflects the display form being edited', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  // applyFrame 会用 config.display 填充 displayForm，其中 sidebarVisible=true
  assert.equal(f.page.data.displayForm.sidebarVisible, true);
  assert.ok(f.page.data.previewSidebar, '开启侧栏后应有预览模型');
  assert.equal(f.page.data.previewSidebar.style, 'standard');
  assert.ok(f.page.data.previewSections.length > 0, '预览应有分区');

  // 切到简洁样式，预览应跟随
  f.page.setData({ 'displayForm.sidebarStyle': 'simple' });
  const sidebar = f.page.buildPreviewSidebar();
  assert.equal(sidebar.style, 'simple', '预览必须反映正在编辑的样式');
});

test('preview inspector writes display and enabled through the right config path', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  f.page.setData({ previewComponent: 'plan:siliconflow' });

  // pickDisplay 经 wx.showActionSheet 回调，这里直接走底层 commitComponentDisplay
  f.page.commitComponentDisplay({ id: 'plan:siliconflow', path: 'codingPlans.siliconflow' }, 'settings');
  const call = f.requests[f.requests.length - 1];
  assert.equal(call.action, 'update');
  assert.deepEqual(JSON.parse(JSON.stringify(call.payload.patch)), { codingPlans: { siliconflow: { display: 'settings' } } });

  f.page.togglePreviewComponent({ detail: { value: false } });
  const toggle = f.requests[f.requests.length - 1];
  assert.deepEqual(JSON.parse(JSON.stringify(toggle.payload.patch)), { codingPlans: { siliconflow: { enabled: false } } });
});

test('budget component toggles enabled and detail on the budget settings', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  f.page.setData({ previewComponent: 'budget' });
  assert.equal(f.page.previewComponentEnabled(), true);
  f.page.togglePreviewComponent({ detail: { value: false } });
  const call = f.requests[f.requests.length - 1];
  assert.deepEqual(JSON.parse(JSON.stringify(call.payload.patch)), { budget: { enabled: false } });
  assert.equal(f.page.data.budgetForm.enabled, false);
});

test('re-applying the same frame does not rebuild cells (scroll smoothness)', () => {
  const f = fixture();
  const first = frame();
  f.page.applyFrame(first);
  const cellsAfterFirst = f.page.data.planCells;
  const previewAfterFirst = f.page.data.previewSidebar;

  // 同一帧对象重复 apply（store 广播的典型场景）必须被缓存挡住
  f.page.applyFrame(first);
  assert.equal(f.page.data.planCells, cellsAfterFirst, '同一帧不得重建 planCells');
  assert.equal(f.page.data.previewSidebar, previewAfterFirst, '同一帧不得重建预览');

  // 新帧内容变化时必须重建
  const second = frame({ config: { sidebarOrder: ['peak', 'balance'] } });
  f.page.applyFrame(second);
  assert.notEqual(f.page.data.planCells, cellsAfterFirst, '帧变化后必须重建');
});

test('expanding a custom entry only flips its own expanded flag', () => {
  const f = fixture();
  const custom = frame();
  custom.config.customBalances = [{
    enabled: true, adapter: 'custom', label: 'A', labelEn: '', unit: 'USD', display: 'both', refreshMinutes: 15,
    convertToDisplayCurrency: false, allowInsecureHttp: false, allowedHosts: [], secretHeader: 'Authorization',
    request: { url: 'https://a.test/x', method: 'GET', headers: {}, body: '' },
    extract: { remaining: 'data.remaining', maxBudget: '', spend: '', unit: 'USD' },
  }];
  f.page.applyFrame(custom);
  assert.equal(f.page.data.customCells.length, 1);
  assert.equal(f.page.data.customCells[0].expanded, false, '直接 applyFrame 不自动展开（自动展开只发生在 addCustom）');

  f.page.toggleCustomExpand({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.customCells[0].expanded, true, '点一次应展开');
  assert.equal(f.page.data.expandedCustom, 0);

  f.page.toggleCustomExpand({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.customCells[0].expanded, false, '再点一次应收起');
  assert.equal(f.page.data.expandedCustom, -1);
});

test('inspector exposes pickable components and keeps label/display in sync', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  assert.ok(f.page.data.previewComponentOptions.length > 6, '检查器组件列表必须支持超过 6 项（原生 actionSheet 上限）');
  assert.ok(f.page.data.previewComponentLabel, '组件行必须显示当前组件名称');
  assert.equal(typeof f.page.data.previewComponentEnabled, 'boolean');
  f.page.choosePreviewComponent({ currentTarget: { dataset: { id: 'plan:siliconflow' } } });
  assert.equal(f.page.data.previewComponent, 'plan:siliconflow');
  assert.equal(f.page.data.componentPickerOpen, false);
  assert.equal(f.page.data.previewComponentLabel, 'siliconflow');
  f.page.onSidebarPartTap({ currentTarget: { dataset: { key: 'budget' } } });
  assert.equal(f.page.data.previewComponent, 'budget');
  assert.equal(f.page.data.previewComponentLabel, '预算');
});

test('the display-settings entry is a single row, not two duplicated rows', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.wxml'), 'utf8');
  assert.ok(wxml.includes('左侧栏样式'), '入口行显示当前侧栏样式');
  assert.ok(!wxml.includes("ui['侧栏预览']"), '不应再有重复的侧栏预览入口行');
  const entries = wxml.split('bindtap="openDisplaySheet"').length - 1;
  assert.equal(entries, 1, '显示设置入口只保留一个');
});
