'use strict';
// 弹窗化改造：列表入口开弹窗、弹窗内编辑落到 cells、关闭清空
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

function frame() {
  const config = {
    currency: 'CNY', symbol: '¥', decimals: 3, exchangeRate: 7.2,
    display: { sidebarStyle: 'standard', sidebarVisible: true, sidebarTodayMetric: 'both', peakStyle: 'progress', peakTimeDisplay: 'both', sidebarTodayBalanceInline: false },
    balance: { enabled: true, display: 'both', refreshMinutes: 5, showProgressBar: false, barDirection: 'remaining' },
    goQuota: { enabled: true, display: 'both', refreshMinutes: 15, detail: true, main: 'rolling', barDirection: 'used' },
    peak: { enabled: true, display: 'both', windows: [{ start: 1, end: 4 }], holidays: [] },
    budget: { enabled: true, amount: 100, period: 'month', display: 'both', detail: true, barDirection: 'used' },
    codingPlans: { siliconflow: { enabled: true, display: 'sidebar', refreshMinutes: 15 } },
    customBalances: [{
      enabled: true, adapter: 'custom', label: 'A', labelEn: '', unit: 'USD', display: 'both', refreshMinutes: 15,
      convertToDisplayCurrency: false, allowInsecureHttp: false, allowedHosts: [], secretHeader: 'Authorization',
      request: { url: 'https://a.test/x', method: 'GET', headers: {}, body: '' },
      extract: { remaining: 'data.remaining', maxBudget: '', spend: '', unit: 'USD' },
    }],
    gatewayQuotas: { sources: [{ id: 'gw-1', type: 'cliproxyapi', label: 'CLIProxyAPI', baseURL: 'http://127.0.0.1:8317', enabled: true, display: 'both', refreshMinutes: 15, allowedHosts: [], allowInsecureHttp: false, includeProviders: [], antigravityOnlyGemini: false }] },
    sidebarOrder: [],
  };
  const dashboard = {
    currency: 'CNY', symbol: '¥', decimals: 3, display: config.display,
    balance: { enabled: true, display: 'both', status: 'ok', message: '', currency: 'CNY', totalBalance: 7.289, granted: 1, toppedUp: 6.289, keyConfigured: true },
    customBalances: [{ index: 0, label: 'A', unit: 'USD', display: 'both', enabled: true, status: 'ok', message: '', remaining: 42, maxBudget: 100, percent: 42 }],
    goQuota: { enabled: true, display: 'both', status: 'ok', rolling: { percent: 21 }, weekly: { percent: 5 }, monthly: { percent: 3 } },
    plans: [{ id: 'siliconflow', label: 'SiliconFlow', enabled: true, display: 'sidebar', refreshMinutes: 15, status: 'ok', message: '', rows: [] }],
    gatewayQuotas: [{ id: 'gw-1', label: 'CLIProxyAPI', enabled: true, display: 'both', status: 'ok', message: '', accounts: [] }],
    peak: { enabled: true, display: 'both' }, settings: { display: config.display, sidebarOrder: [] },
  };
  return {
    kind: 'cost-meter', config, dashboard,
    sources: {
      plans: PLAN_IDS.map(id => ({ id, label: id, fields: [], needsSecret: false, noKey: false, configured: false, settings: {} })),
      customBalances: [{ index: 0, configured: false, keyRef: 'WEAPP_CUSTOM_BALANCE_0' }],
      gatewayQuotas: [{ id: 'gw-1', keyRef: 'CLIPROXYAPI_MANAGEMENT_KEY_GW_1' }],
    },
    summary: { budget: { enabled: true, amount: 100, used: 42, percent: 42, period: 'month' } },
  };
}

test('each list entry opens its own sheet and closing clears it', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  assert.equal(f.page.data.sheet, '', '初始无弹窗');

  f.page.openDisplaySheet();
  assert.equal(f.page.data.sheet, 'display');
  f.page.closeSheet();
  assert.equal(f.page.data.sheet, '');

  for (const [open, kind] of [['openBalanceSheet', 'balance'], ['openGoSheet', 'go'], ['openBudgetSheet', 'budget'], ['openPeakSheet', 'peak']]) {
    f.page[open]();
    assert.equal(f.page.data.sheet, kind, open + ' 应打开 ' + kind);
    f.page.closeSheet();
  }
});

test('opening a plan sheet carries that provider cell and its index', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  const index = f.page.data.planCells.findIndex(c => c.id === 'siliconflow');
  f.page.openPlanSheet({ currentTarget: { dataset: { index } } });
  assert.equal(f.page.data.sheet, 'plan');
  assert.equal(f.page.data.sheetPlan.id, 'siliconflow');
  assert.equal(f.page.data.sheetPlan.index, index);
  assert.equal(f.page.data.sheetPlan.label, f.page.data.planCells[index].label);
});

test('opening gateway and custom sheets carries the matching cell', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  f.page.openGatewaySheet({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.sheet, 'gateway');
  assert.equal(f.page.data.sheetGateway.id, 'gw-1');
  assert.equal(f.page.data.sheetGateway.baseURL, 'http://127.0.0.1:8317');

  f.page.closeSheet();
  f.page.openCustomSheet({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.sheet, 'custom');
  assert.equal(f.page.data.sheetCustom.label, 'A');
  assert.equal(f.page.data.sheetCustom.request.url, 'https://a.test/x');
});

test('editing inside the plan sheet writes through to planCells', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  const index = f.page.data.planCells.findIndex(c => c.id === 'siliconflow');
  f.page.openPlanSheet({ currentTarget: { dataset: { index } } });

  // 弹窗里的 API Key 输入：draft 按厂商 id 存（与 savePlanKey 一致）。
  // 输入中不回写显示值（真机粘贴/光标保护），失焦后才同步。
  f.page.onPlanKeyInput({ currentTarget: { dataset: { index } }, detail: { value: 'sk-test' } });
  assert.equal(f.page.data.planKeyDrafts.siliconflow, 'sk-test');
  f.page.onPlanKeyBlur();
  assert.equal(f.page.data.sheetPlan.keyDraft, 'sk-test');

  // 特有字段：siliconflow 无 extra fields，用第一个有 fields 的厂商验证路径
  const withFields = f.page.data.planCells.findIndex(c => (c.fields || []).length > 0);
  if (withFields >= 0) {
    f.page.onPlanFieldInput({ currentTarget: { dataset: { index: withFields, field: 0 } }, detail: { value: 'v' } });
    assert.equal(f.page.data.planCells[withFields].fields[0].value, 'v');
    f.page.onPlanFieldBlur({ currentTarget: { dataset: { index: withFields } } });
    assert.equal(f.page.data.sheetPlan.fields[0].value, 'v');
  }
});

test('editing inside the gateway sheet writes through to gatewayCells', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  f.page.openGatewaySheet({ currentTarget: { dataset: { index: 0 } } });
  f.page.onGatewayFieldInput({ currentTarget: { dataset: { index: 0, field: 'label' } }, detail: { value: '我的网关' } });
  assert.equal(f.page.data.gatewayCells[0].label, '我的网关');
  assert.notEqual(f.page.data.sheetGateway.label, '我的网关', '输入中不回写显示值');
  f.page.onGatewayFieldBlur({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.sheetGateway.label, '我的网关');

  // Management Key draft 按来源 id 存（与 saveGatewayKey 一致）
  f.page.onGatewayKeyInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: 'mk' } });
  assert.equal(f.page.data.gatewayKeyDrafts['gw-1'], 'mk');
  f.page.onGatewayKeyBlur();
  assert.equal(f.page.data.sheetGateway.keyDraft, 'mk');
});

test('editing inside the custom sheet writes through to customCells', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  f.page.openCustomSheet({ currentTarget: { dataset: { index: 0 } } });
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index: 0, field: 'label' } }, detail: { value: '新名字' } });
  assert.equal(f.page.data.customCells[0].label, '新名字');
  assert.notEqual(f.page.data.sheetCustom.label, '新名字', '输入中不回写显示值（粘贴保护）');
  f.page.onCustomFieldBlur({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.sheetCustom.label, '新名字');

  f.page.onCustomKeyInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: 'sec' } });
  assert.equal(f.page.data.customKeyDrafts[0], 'sec');
  assert.notEqual(f.page.data.sheetCustom.keyDraft, 'sec');
  f.page.onCustomKeyBlur({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(f.page.data.sheetCustom.keyDraft, 'sec');
});

test('saving from the custom sheet still commits the full entry', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  f.page.openCustomSheet({ currentTarget: { dataset: { index: 0 } } });
  f.page.onCustomFieldInput({ currentTarget: { dataset: { index: 0, field: 'label' } }, detail: { value: '改名后' } });
  f.page.saveCustom({ currentTarget: { dataset: { index: 0 } } });
  const call = f.requests[f.requests.length - 1];
  assert.equal(call.action, 'update');
  assert.equal(call.payload.patch.customBalances[0].label, '改名后');
  assert.equal(call.payload.patch.customBalances[0].request.url, 'https://a.test/x');
});

test('the compact list keeps only summaries; configuration lives in the sheet', () => {
  const f = fixture();
  f.page.applyFrame(frame());
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.wxml'), 'utf8');
  // 列表卡不再内嵌展开块
  assert.ok(wxml.includes('cost-entry-card'), '列表应使用入口卡');
  assert.ok(wxml.includes('openPlanSheet'), '供应商卡应能开弹窗');
  assert.ok(wxml.includes('sheet === \'plan\''), '应有 plan 弹窗');
  for (const kind of ['display', 'balance', 'go', 'budget', 'peak', 'gateway', 'custom']) {
    assert.ok(wxml.includes(`sheet === '${kind}'`), '缺少 ' + kind + ' 弹窗');
  }
  // 内联展开块已移除
  assert.ok(!wxml.includes('togglePlanExpand'), 'plan 不应再内联展开');
  assert.ok(!wxml.includes('toggleCustomExpand'), 'custom 不应再内联展开');
  assert.ok(!wxml.includes('toggleGatewayExpand'), 'gateway 不应再内联展开');
});

test('every quota sheet has a drag handle, 90% height and a scrollable body', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.wxss'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.js'), 'utf8');
  const sheetKinds = ['display', 'balance', 'go', 'budget', 'peak', 'plan', 'gateway', 'custom'];
  for (const kind of sheetKinds) assert.ok(wxml.includes(`sheet === '${kind}'`), '缺少 ' + kind + ' 弹窗');
  assert.equal((wxml.match(/class="cost-sheet-grabber"/g) || []).length, sheetKinds.length, '每个弹窗都要有拖动条');
  // 非 custom 弹窗的滚动区带 carded 类（卡片化边框），断言两种写法合计。
  assert.equal((wxml.match(/class="cost-sheet-body( carded)?"/g) || []).length, sheetKinds.length, '每个弹窗都要有可滚动内容区');
  assert.match(wxml, /catchtouchstart="onSheetGrabStart"/);
  assert.match(wxml, /catchtouchmove="onSheetGrabMove"/);
  assert.match(wxml, /catchtouchend="onSheetGrabEnd"/);
  assert.match(wxss, /\.cost-sheet \{[^}]*height: 90vh/);
  assert.match(wxss, /\.cost-sheet-body \{[^}]*height: 0/);
  assert.match(js, /onSheetGrabStart\(e\)/);
  assert.match(js, /onSheetGrabEnd\(\)/);
  assert.match(js, /sheetDragY/);
});

test('consecutive provider cards keep a visible gap', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/cost-meter/cost-meter.wxss'), 'utf8');
  assert.match(wxss, /\.cost-card \+ \.cost-card \{\s*margin-top:/, '相邻卡片之间必须有间距');
});
