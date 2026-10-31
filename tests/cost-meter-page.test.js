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
  assert.ok(!wxml.includes('bindchange="toggleSidebarVisible"'), '显示额度卡片开关已移除');
  assert.match(wxml, /{{ui\['侧栏玻璃卡片'\]}}[\s\S]{0,400}?bindchange="toggleSidebarGlass"/);
  assert.ok(/<block wx:if="\{\{displayForm\.sidebarVisible\}\}">/.test(wxml), '关闭时隐藏下方所有分区');
  assert.ok(wxml.includes("ui['显示']"), '官方余额/Go/预算/峰谷归到「显示」');
  assert.ok(wxml.includes("ui['额度']"), 'Coding Plan/网关/自定义归到「额度」');
});


test('额度卡片页跟随玻璃 UI 开关：卡片与弹窗都用首页设置页的玻璃材质', () => {
  const pageDir = path.resolve(__dirname, '../miniprogram/pages/cost-meter');
  const wxml = fs.readFileSync(path.join(pageDir, 'cost-meter.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(pageDir, 'cost-meter.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(pageDir, 'cost-meter.js'), 'utf8');
  assert.match(wxml, /class="cost-page \{\{themeClass\}\} \{\{settingsGlassEnabled \? 'cost-glass' : ''\}\}"/);
  assert.equal((wxml.match(/settingsGlassEnabled \? 'settings-glass-card' : ''/g) || []).length, 8, 'every cost card follows the switch');
  assert.equal((wxml.match(/settingsGlassEnabled \? 'settings-glass-sheet' : ''/g) || []).length, 8, 'every cost sheet follows the switch');
  // 材质来自与设置页共用的 styles/glass-ui.wxss，不在这里另写一份。
  assert.match(css, /@import "\.\.\/\.\.\/styles\/glass-ui\.wxss"/);
  // 玻璃弹窗底部让出 24px：固定 90vh 高度同步扣除。
  assert.match(css, /\.cost-sheet\.settings-glass-sheet \{ height: calc\(90vh - var\(--glass-sheet-drop, 0px\)\); max-height: calc\(90vh - var\(--glass-sheet-drop, 0px\)\); \}/);
  // 统计小块、弹窗分隔线在玻璃上换成半透明浅层 / 发丝线。
  assert.match(css, /\.cost-glass \.cost-stat \{ background: rgba\(255, 255, 255, 0\.05\); border-color: rgba\(255, 255, 255, 0\.14\)/);
  assert.match(css, /\.cost-glass \.cost-sheet-head,[\s\S]{0,80}?border-color: rgba\(255, 255, 255, 0\.12\)/);
  assert.match(css, /\.theme-light \.cost-glass \.cost-stat/);
  // 偏好每次进页面重新读取，和设置页开关联动。
  assert.match(js, /const settingsGlassPreference = require\('\.\.\/\.\.\/utils\/settings-glass-pref'\)/);
  assert.match(js, /settingsGlassEnabled: settingsGlassPreference\.read\(\)/);
  assert.match(js, /onShow\(\) \{\s*this\.setData\(Object\.assign\(\{ settingsGlassEnabled: settingsGlassPreference\.read\(\), choiceSheet: settingsGlassSheetPreference\.read\(\), quotaSidebarGlass: quotaSidebarGlassPreference\.read\(\) \}, settingsGlassStylePreference\.view\(\{ light: String\(this\.data\.themeClass \|\| ''\)\.indexOf\('light'\) >= 0 \}\)\)\)/);
});

test('货币单位：玻璃 UI 用工作区同款锚点弹窗，关闭后回退原生 ActionSheet', () => {
  const f = fixture();
  const { page, wx } = f;
  const pageDir = path.resolve(__dirname, '../miniprogram/pages/cost-meter');

  // 玻璃 UI：工作区选择同款的锚点玻璃弹窗
  page.setData({ displayForm: Object.assign({}, page.data.displayForm, { currency: 'CNY', symbol: '¥' }) });
  page.pickCurrency();
  assert.equal(page.data.choiceMenu, 'currency');
  assert.equal(page.data.choiceTitle, '货币单位');
  assert.equal(page.data.choiceOptions.length, 3);
  assert.equal(page.data.choiceCurrent, 'CNY');
  for (const key of ['choiceLeft', 'choiceTop', 'choiceWidth', 'choiceHeight', 'choiceOriginY']) {
    assert.ok(Number.isFinite(page.data[key]), key + ' is finite');
  }
  let patched = null;
  page.commitPatch = patch => { patched = patch; };
  page.chooseChoice({ currentTarget: { dataset: { kind: 'currency', id: 'USD' } } });
  assert.equal(page.data.choiceMenu, '', 'choosing closes the menu');
  assert.equal(page.data.displayForm.currency, 'USD');
  assert.equal(page.data.displayForm.symbol, '$');
  assert.deepEqual(JSON.parse(JSON.stringify(patched)), { currency: 'USD', symbol: '$' });

  // 关闭玻璃 UI：仍是这个锚点菜单，只是换成原生实色皮肤（不再退化成系统 ActionSheet）。
  let sheet = null;
  wx.showActionSheet = options => { sheet = options; };
  page.setData({ settingsGlassEnabled: false });
  page.pickCurrency({ currentTarget: { id: 'pick-currency' } });
  assert.equal(sheet, null, 'no system action sheet under the native menu');
  assert.equal(page.data.choiceMenu, 'currency', 'the same anchored menu opens natively');
  assert.equal(page.data.choiceOptions.length, 3);
  page.chooseChoice({ currentTarget: { dataset: { kind: 'currency', id: 'EUR' } } });
  assert.equal(page.data.displayForm.currency, 'EUR');
  assert.equal(page.data.displayForm.symbol, '€');

  // 样式：玻璃弹窗来自共用样式表（含浅色主题），货币行是锚点。
  const wxml = fs.readFileSync(path.join(pageDir, 'cost-meter.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(pageDir, 'cost-meter.wxss'), 'utf8');
  const glassCss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/styles/glass-ui.wxss'), 'utf8');
  assert.match(wxml, /class="cost-row currency-row" id="pick-currency" bindtap="pickCurrency"/);
  // 每个子卡片弹窗里的选择项都改走同一个锚点弹窗：行上有锚点 id，JS 不再调用系统 ActionSheet。
  const pickRows = ['today-metric', 'peak-time-display', 'balance-bar-direction', 'budget-bar-direction', 'peak-style',
    'balance-display', 'balance-refresh', 'go-display', 'go-refresh', 'go-main', 'go-direction',
    'budget-period', 'budget-display', 'peak-display', 'peak-alert-target', 'peak-alert-position',
    'plan-display', 'plan-refresh', 'gateway-display', 'gateway-refresh',
    'custom-adapter', 'custom-display', 'custom-refresh', 'custom-method', 'preview-display'];
  for (const id of pickRows) assert.ok(wxml.includes('id="pick-' + id + '"'), 'missing anchor ' + id);
  const js = fs.readFileSync(path.join(pageDir, 'cost-meter.js'), 'utf8');
  assert.doesNotMatch(js, /showActionSheet/, 'no system action sheet for the pickers any more');
  assert.match(js, /pickChoice\(e, kind, title, options, current, onPick\)/);
  // 两种形态：底部弹窗（开关开）/ 贴行锚点菜单（开关关），皮肤都跟随玻璃 UI 开关。
  assert.match(wxml, /wx:if="\{\{choiceMenu && choiceSheet\}\}" class="choice-sheet-mask" catchtap="closeChoiceMenu"/);
  assert.match(wxml, /class="choice-sheet \{\{settingsGlassEnabled \? 'choice-sheet-glass' : ''\}\}"/);
  // 底部弹窗的选项居中，标题行保持左对齐 + 关闭按钮不变
  assert.match(glassCss, /\.choice-sheet-body \{[^}]*padding: calc\(22rpx \+ env\(safe-area-inset-bottom\)\) 0 14rpx/);
  assert.match(glassCss, /\.choice-sheet \.settings-choice-content \{[^}]*padding: 0;[^}]*text-align: left/);
  // 选项块整体居中，块内逐行左对齐（图标与文案从同一条左边缘开始）
  assert.match(glassCss, /\.choice-sheet-body \{[^}]*text-align: center/);
  assert.match(glassCss, /\.choice-sheet \.settings-choice-content \{[^}]*display: inline-flex[^}]*flex-direction: column/);
  assert.match(glassCss, /\.choice-sheet \.settings-choice-row \{[^}]*justify-content: flex-start/);
  assert.match(glassCss, /\.choice-sheet \.settings-choice-label \{ flex: none; text-align: left/);
  assert.doesNotMatch(wxml, /choice-sheet-head|choice-sheet-title|choice-sheet-close/);
  assert.doesNotMatch(glassCss, /\.choice-sheet-head|choice-sheet-title|choice-sheet-close/);
  assert.doesNotMatch(wxml, /choice-sheet-grabber/, 'bottom sheet has no drag handle');
  assert.match(wxml, /wx:if="\{\{choiceMenu && !choiceSheet\}\}" class="settings-choice-mask" catchtap="closeChoiceMenu"/);
  assert.match(wxml, /class="settings-choice \{\{settingsGlassEnabled \? 'settings-choice-glass' : ''\}\}"[\s\S]{0,200}?height: \{\{choiceHeight\}\}px/);
  assert.match(css, /@import "\.\.\/\.\.\/styles\/glass-ui\.wxss"/);
  // 原生形态：实色面板 + 同样的几何，跟随深浅色变量
  assert.match(glassCss, /\.settings-choice \{[\s\S]*?border-radius: var\(--glass-radius-choice, 64rpx\);[\s\S]*?background: var\(--surface\);[\s\S]*?border: 1rpx solid var\(--border\)/);
  assert.match(glassCss, /\.settings-choice \{[\s\S]*?color: var\(--text\)/);
  // 玻璃形态：叠加 .settings-choice-glass，深浅色各一套
  assert.match(glassCss, /\.settings-choice\.settings-choice-glass \{[\s\S]*?linear-gradient\(165deg, rgba\(255, 255, 255, var\(--glass-alpha-top, 0\.10\)\), rgba\(255, 255, 255, var\(--glass-alpha-bottom, 0\.04\)\)\)[\s\S]*?backdrop-filter: blur\(var\(--glass-blur-sheet, 8rpx\)\)/);
  assert.match(glassCss, /\.theme-light \.settings-choice\.settings-choice-glass \{/);
  assert.match(glassCss, /\.theme-light \.settings-choice\.settings-choice-glass \.settings-choice-label \{ color: #10131A/);
  // 菜单从「显示设置」底部弹窗（z-index: 200）里触发，必须浮在弹窗之上。
  const menuZ = Number((glassCss.match(/\.settings-choice \{[\s\S]{0,80}?z-index:\s*(\d+)/) || [])[1]);
  const sheetZ = Number((css.match(/\.cost-sheet-mask \{[^}]*z-index:\s*(\d+)/) || [])[1]);
  assert.ok(menuZ > sheetZ, 'the anchored menu stacks above the cost sheet (' + menuZ + ' > ' + sheetZ + ')');
});

test('显示设置里的其余选择项也走同一个锚点弹窗（玻璃 / 原生皮肤由开关决定）', () => {
  const f = fixture();
  const { page } = f;
  page.commitPatch = () => {};
  const cases = [
    ['pickTodayMetric', 'today-metric', 'tokens', () => page.data.displayForm.sidebarTodayMetric],
    ['pickPeakTimeDisplay', 'peak-time-display', 'countdown', () => page.data.displayForm.peakTimeDisplay],
    ['pickPeakStyle', 'peak-style', 'classic', () => page.data.displayForm.peakStyle],
    ['pickBalanceBarDirection', 'balance-bar-direction', 'used', () => page.data.balanceForm.barDirection],
  ];
  for (const [handler, kind, pick, read] of cases) {
    page[handler]({ currentTarget: { id: 'pick-' + kind, dataset: {} } });
    assert.equal(page.data.choiceMenu, kind, handler + ' opens the anchored menu');
    assert.ok(page.data.choiceOptions.length >= 2, handler + ' feeds options');
    for (const key of ['choiceLeft', 'choiceTop', 'choiceWidth', 'choiceHeight']) {
      assert.ok(Number.isFinite(page.data[key]), handler + ' ' + key + ' is finite');
    }
    page.chooseChoice({ currentTarget: { dataset: { kind, id: pick } } });
    assert.equal(page.data.choiceMenu, '', handler + ' closes after choosing');
    assert.equal(read(), pick, handler + ' applies the choice');
  }
});

test('组件检查器的「组件」和「显示位置」都能打开锚点弹窗并生效', () => {
  const f = fixture();
  const { page } = f;
  // 提交后重新计算检查器的派生值（真实页面里 commitPatch 会触发 applyFrame/refresh）。
  page.commitPatch = () => { page.refreshPreviewInspector(); return Promise.resolve(true); };
  // wxml 里出现的每个事件 handler 都必须真实存在，否则点了没反应（本次就是缺 pickPreviewComponent）。
  const pageDir = path.resolve(__dirname, '../miniprogram/pages/cost-meter');
  const wxml = fs.readFileSync(path.join(pageDir, 'cost-meter.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(pageDir, 'cost-meter.js'), 'utf8');
  const handlers = [...wxml.matchAll(/(?:bind|catch)(?:tap|input|blur|change|confirm|touchstart|touchmove|touchend)="([^"]+)"/g)].map(m => m[1]);
  for (const handler of new Set(handlers)) {
    assert.ok(new RegExp('(^|[,{\\s])' + handler + '\\s*\\(', 'm').test(js), 'missing handler ' + handler);
  }

  // 组件：打开菜单 → 选「预算」
  page.pickPreviewComponent({ currentTarget: { id: 'pick-preview-component', dataset: {} } });
  assert.equal(page.data.choiceMenu, 'preview-component');
  assert.ok(page.data.choiceOptions.length >= 2, 'component options feed the menu');
  const target = page.data.choiceOptions[page.data.choiceOptions.length - 1];
  page.chooseChoice({ currentTarget: { dataset: { kind: 'preview-component', id: target.id } } });
  assert.equal(page.data.choiceMenu, '');
  assert.equal(page.data.previewComponent, target.id, 'the inspector follows the picked component');
  assert.equal(page.data.previewComponentLabel, target.label);
  // 选一个带「显示位置」的组件，验证选择后写回配置并刷新标签
  page.setData({ previewComponent: 'budget' });
  page.refreshPreviewInspector();

  // 显示位置：打开菜单并按当前组件的 display 写回
  page.pickPreviewDisplay({ currentTarget: { id: 'pick-preview-display', dataset: {} } });
  assert.equal(page.data.choiceMenu, 'preview-display');
  assert.ok(page.data.choiceOptions.length >= 2);
  const option = page.data.choiceOptions.find(item => item.id !== page.data.choiceCurrent) || page.data.choiceOptions[0];
  page.chooseChoice({ currentTarget: { dataset: { kind: 'preview-display', id: option.id } } });
  assert.equal(page.data.choiceMenu, '');
  // 显示位置写回组件对应的配置表单（真实页面随后随 commitPatch 回写 config 并刷新标签）。
  assert.equal(page.data.budgetForm.display, option.id);
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

test('左侧栏额度卡片默认原生，弹窗里的独立开关切换成玻璃态', () => {
  const dir = path.resolve(__dirname, '../miniprogram');
  const sidebarCss = fs.readFileSync(path.join(dir, 'styles/quota-sidebar.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.join(dir, 'pages/cost-meter/cost-meter.wxml'), 'utf8');
  const homeWxml = fs.readFileSync(path.join(dir, 'pages/home/home.wxml'), 'utf8');
  // 默认原生：原样式保留（透明底 + 主题边框），不受玻璃参数影响
  const native = sidebarCss.slice(sidebarCss.indexOf('.qs-standard .qs-sec.qs-card{'), sidebarCss.indexOf('.qs-standard .qs-sec.qs-card{') + 200);
  assert.ok(native.includes('background:transparent'), 'native card stays transparent');
  assert.ok(native.includes('var(--border)'), 'native card keeps the theme border');
  // 玻璃态只在 .qs-glass 下叠加，样式参数跟着设置走
  const glassAt = sidebarCss.indexOf('.qs-glass .qs-standard .qs-sec.qs-card,');
  assert.ok(glassAt > 0, 'glass modifier exists');
  const glass = sidebarCss.slice(glassAt, glassAt + 700);
  assert.ok(glass.includes('var(--glass-alpha-top, 0.06)'), 'glass gradient');
  assert.ok(glass.includes('var(--glass-edge-alpha, 0.38)'), 'glass hairline');
  assert.ok(glass.includes('blur(var(--glass-blur-card, 3rpx))'), 'glass blur');
  // 首页侧栏容器按开关（且玻璃UI开启）挂 .qs-glass
  assert.match(homeWxml, /class="qs-wrap \{\{quotaSidebarGlass && settingsGlassEnabled \? 'qs-glass' : ''\}\}"/);
  // 额度卡片页弹窗里的独立开关
  assert.match(wxml, /<dsh-switch checked="\{\{quotaSidebarGlass\}\}" bindchange="toggleSidebarGlass"\/>/);
  const sheetStart = wxml.indexOf("{{sheet === 'display'}}");
  const switchAt = wxml.indexOf('bindchange="toggleSidebarGlass"');
  assert.ok(sheetStart > 0 && switchAt > sheetStart, 'glass switch lives inside the display sheet');
  // 显示额度卡片开关已移除
  assert.ok(!wxml.includes('bindchange="toggleSidebarVisible"'), 'visibility switch removed');
});
