'use strict';
// 侧栏额度卡片四种布局：模板/样式共享、今日行、Go 主窗口与紧凑两列
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const costView = require('../miniprogram/utils/cost-view.js');
const root = path.resolve(__dirname, '../miniprogram');

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

function dashboard(overrides = {}) {
  return Object.assign({
    currency: 'CNY', symbol: '¥', decimals: 3,
    display: { sidebarStyle: 'standard', sidebarVisible: true, sidebarTodayMetric: 'both', peakStyle: 'progress' },
    balance: { enabled: true, display: 'both', status: 'ok', currency: 'CNY', totalBalance: 68, keyConfigured: true },
    customBalances: [], goQuota: { enabled: true, display: 'both', status: 'ok', main: 'rolling', rolling: { percent: 24 }, weekly: { percent: 18 }, monthly: { percent: 12 } },
    plans: [{ id: 'minimax', label: 'MiniMax Plan', enabled: true, display: 'sidebar', status: 'ok', windows: { five: { percent: 35 }, week: { percent: 62 } } }],
    gatewayQuotas: [],
    peak: { enabled: true, display: 'both', label: '平价', remainingText: '剩余 2天11时', progressText: '30%', switchText: '周一 09:00 转峰时' },
    settings: {},
  }, overrides);
}

function summary() { return { budget: { enabled: true, amount: 100, used: 57, percent: 57, period: 'month' }, today: { amount: 4.608, tokens: 246000, calls: 3 } }; }

test('home and the quota sheet preview share one quota-sidebar template and stylesheet', () => {
  const homeWxml = read('pages/home/home.wxml');
  const pageWxml = read('pages/cost-meter/cost-meter.wxml');
  const template = read('templates/quota-sidebar.wxml');
  const css = read('styles/quota-sidebar.wxss');
  assert.ok(homeWxml.includes('<import src="../../templates/quota-sidebar.wxml"/>'), '左侧栏必须引用共享模板');
  assert.ok(pageWxml.includes('<import src="../../templates/quota-sidebar.wxml"/>'), '弹窗预览必须引用同一模板');
  assert.match(homeWxml, /<template is="quota-sidebar" data="\{\{sections: costSections/);
  assert.match(pageWxml, /<template is="quota-sidebar" data="\{\{sections: previewSections/);
  for (const kind of ['today', 'balance', 'peak', 'budget', 'go', 'plan', 'gateway', 'custom']) {
    assert.ok(template.includes(`sec.kind === '${kind}'`), '模板缺少 ' + kind + ' 分区');
  }
  // 四种模式的结构差异
  for (const mode of ['summary', 'simple', 'standard', 'compact']) assert.match(css, new RegExp('\\.qs-' + mode + '\\b'), '缺少 ' + mode + ' 布局');
  assert.match(css, /\.qs-standard \.qs-sec\s*\{[^}]*background:\s*transparent/, '标准模式组件不带背景（参考插件左侧栏）');
  assert.match(css, /\.qs-compact \.qs-sec\s*\{[^}]*background:\s*transparent/, '紧凑模式组件同样不带背景');
  assert.ok(!/\.qs-summary \.qs-sec \+ \.qs-sec/.test(css), '合并卡片内部不画横线');
  assert.match(css, /\.qs-summary \.qs-sec\.qs-card\s*\{[^}]*border:\s*0/, '合并卡片内部不再有组件边框');
  assert.match(css, /\.qs-standard \.qs-sec\.qs-card\s*\{[^}]*border:\s*1rpx solid/, '标准模式只有部分组件有圆框');
  assert.match(css, /\.qs-simple \.qs-sec\.qs-card\s*\{[^}]*border-bottom:\s*1rpx solid/, '简洁模式部分内容用横线分隔');
  assert.match(css, /\.qs-simple \.qs-meta\s*\{[^}]*display:\s*none/, '简洁模式隐藏次要说明');
  assert.match(css, /\.qs-peak-inline/, '紧凑模式峰谷收成一行');
  assert.match(css, /\.qs-compact \.qs-wins\s*\{[^}]*grid-template-columns:\s*1fr 1fr/, '紧凑模式计划窗口两列');
});

test('today row is built from the summary and rendered first in the default layout', () => {
  const view = costView.normalizeQuotaDashboard(dashboard(), summary());
  const model = costView.quotaSidebarModel(view, 'summary');
  assert.ok(model.today, '有今日用量时应生成今日行');
  assert.equal(model.today.amountText, '¥4.608');
  assert.equal(model.today.tokensText, '246K tokens');
  const sections = costView.quotaSidebarSections(model, []);
  assert.equal(sections[0].key, 'today');
  assert.equal(sections[0].today.amountText, '¥4.608');
  const go = sections.find(section => section.kind === 'go');
  assert.equal(go.go.mainRow.key, 'rolling');
  assert.match(go.go.metaText, /周 18% · 月 12%/);
});

test('sidebarTodayMetric controls whether today shows cost, tokens or neither', () => {
  const base = dashboard();
  const costOnly = costView.quotaSidebarModel(costView.normalizeQuotaDashboard(Object.assign({}, base, { display: Object.assign({}, base.display, { sidebarTodayMetric: 'amount' }) }), summary()), 'standard');
  assert.equal(costOnly.today.showCost, true);
  assert.equal(costOnly.today.showTokens, false);
  const tokensOnly = costView.quotaSidebarModel(costView.normalizeQuotaDashboard(Object.assign({}, base, { display: Object.assign({}, base.display, { sidebarTodayMetric: 'tokens' }) }), summary()), 'standard');
  assert.equal(tokensOnly.today.showCost, false);
  assert.equal(tokensOnly.today.showTokens, true);
  const hidden = costView.quotaSidebarModel(costView.normalizeQuotaDashboard(Object.assign({}, base, { display: Object.assign({}, base.display, { sidebarTodayMetric: 'off' }) }), summary()), 'standard');
  assert.equal(hidden.today, null);
});

test('plan, gateway and custom sections carry their payload for template rendering', () => {
  const view = costView.normalizeQuotaDashboard(dashboard({
    gatewayQuotas: [{ id: 'gw1', label: '网关', enabled: true, display: 'both', status: 'ok', accounts: [{ id: 'a', label: 'A', windows: [] }] }],
    customBalances: [{ index: 0, label: '自定义', unit: 'USD', enabled: true, display: 'both', status: 'ok', remaining: 42, maxBudget: 100, percent: 42 }],
  }), summary());
  const sections = costView.quotaSidebarSections(costView.quotaSidebarModel(view, 'standard'), []);
  const plan = sections.find(section => section.kind === 'plan');
  assert.equal(plan.plan.label, 'MiniMax Plan');
  assert.equal(plan.plan.rows.length, 2);
  const gateway = sections.find(section => section.kind === 'gateway');
  assert.equal(gateway.source.accounts.length, 1);
  const custom = sections.find(section => section.kind === 'custom');
  assert.equal(custom.custom.amountText, '$42');
});

test('peak row is computed from windows in Beijing time (weekday and weekend)', () => {
  const base = dashboard();
  const now = Date.parse('2026-10-23T14:30:00Z'); // Friday 22:30 Beijing
  base.peak = { enabled: true, display: 'both', effectiveAt: '', windows: [{ start: 1, end: 4 }, { start: 6, end: 10 }], holidays: [] };
  const view = costView.normalizeQuotaDashboard(base, summary(), { now });
  const peak = view.peak;
  assert.equal(peak.label, '平价');
  assert.equal(peak.shortLabel, '平价');
  assert.equal(peak.remainingText, '剩余 2天10小时30分');
  assert.equal(peak.switchText, '周一 09:00 转峰时');
  assert.equal(peak.startText, '18:00 开始');
  assert.match(peak.progressText, /^\d+\.\d%$/);
  const weekend = costView.normalizeQuotaDashboard(base, summary(), { now: Date.parse('2026-10-24T04:00:00Z') });
  assert.equal(weekend.peak.label, '周末 · 全天谷价');
  assert.equal(weekend.peak.switchText, '周一 09:00 转峰时');
  // 峰谷时段数字按 UTC 解释：02:30Z = 北京时间 10:30，落在 01:00-04:00 UTC 峰时窗口内。
  const peakHour = costView.normalizeQuotaDashboard(base, summary(), { now: Date.parse('2026-10-23T02:30:00Z') });
  assert.equal(peakHour.peak.label, '峰时');
  assert.equal(peakHour.peak.switchText, '12:00 转平价');
  assert.equal(peakHour.peak.startText, '09:00 开始');
});

test('peakTimeDisplay switches the compact/secondary lines', () => {
  const base = dashboard();
  const now = Date.parse('2026-10-23T14:30:00Z');
  base.peak = { enabled: true, display: 'both', effectiveAt: '', windows: [{ start: 1, end: 4 }], holidays: [] };
  const mode = value => costView.normalizeQuotaDashboard(Object.assign({}, base, {
    display: Object.assign({}, base.display, { peakTimeDisplay: value }),
  }), summary(), { now }).peak;
  assert.match(mode('countdown').compactText, /^(\d+d)?(\d+h)?(\d+m)$/);
  assert.match(mode('switch').compactText, /→ (峰时|平价)$/);
  assert.match(mode('both').compactText, /·/);
});

test('balance segments follow granted/top-up amounts when the bar is enabled', () => {
  const base = dashboard();
  base.balance = Object.assign({}, base.balance, { showProgressBar: true, granted: 8, toppedUp: 60 });
  const view = costView.normalizeQuotaDashboard(base, summary());
  assert.equal(view.balance.showProgressBar, true);
  assert.equal(view.balance.segments.length, 2);
  assert.equal(view.balance.segments[0].key, 'granted');
  assert.match(view.balance.segments[0].width, /%/);
  const template = read('templates/quota-sidebar.wxml');
  assert.ok(template.includes('qs-bar-split'), '模板需要渲染分段余额条');
});

test('peak phase label matches the row-label font size', () => {
  const css = read('styles/quota-sidebar.wxss');
  const peak = /\.qs-peak-label\{([^}]*)\}/.exec(css);
  assert.ok(peak, '缺少峰谷相位标签样式');
  assert.match(peak[1], /font-size:24rpx/, '峰谷标签字号必须与余额/今日等标签一致（24rpx）');
  assert.ok(!/font-weight:\s*(6|7|8|9)00/.test(peak[1]), '峰谷标签不应比其他标签更粗');
  assert.ok(!/\.qs-compact \.qs-label/.test(css), '紧凑模式不应再缩小主标签字号');
});
