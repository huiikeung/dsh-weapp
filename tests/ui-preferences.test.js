const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferences = require('../miniprogram/utils/ui-preferences');
const contextPanelsPreference = require('../miniprogram/pages/session/utils/context-panels-pref');
const trajectory = require('../miniprogram/utils/trajectory-presentation');
const protocol = require('../miniprogram/utils/protocol');
function setup() {
  const storage = {};
  global.wx = { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; }, getAppBaseInfo: () => ({ language: 'zh_CN' }) };
  return storage;
}
test('desktop font ranges/defaults, migration and independent persistence', () => {
  const storage = setup();
  try {
    assert.deepEqual(preferences.snapshot().fontSizes, { text: 14, code: 11, terminal: 13 });
    storage.appFontScale = 'large'; assert.equal(preferences.fontSize(), 16);
    for (const [role, spec] of Object.entries(preferences.FONTS)) {
      preferences.setFontSize(spec.max, role); assert.equal(preferences.fontSize(role), spec.max);
      assert.throws(() => preferences.setFontSize(spec.max + 1, role));
      assert.throws(() => preferences.setFontSize(spec.min - 1, role));
      assert.throws(() => preferences.setFontSize(12.5, role));
    }
    assert.deepEqual(preferences.snapshot().fontSizes, { text: 22, code: 16, terminal: 20 });
    preferences.setFontSize(14); assert.equal(preferences.fontSize('code'), 16);
    assert.match(preferences.snapshot().contentFontStyle, /--dsh-terminal-font-size:20px/);
    wx.setStorageSync = () => { throw Error('storage full'); };
    assert.throws(() => preferences.setFontSize(15)); assert.equal(preferences.fontSize(), 14);
  } finally { delete global.wx; }
});
test('font families normalize comma lists, reset on blank, and cannot inject CSS', () => {
  setup();
  try {
    preferences.setFontFamily('text', ' "PingFang SC", Arial , 微软雅黑 ');
    preferences.setFontFamily('code', 'Consolas, monospace');
    preferences.setFontFamily('terminal', 'Cascadia Code');
    assert.equal(preferences.fontFamily('text'), 'PingFang SC, Arial, 微软雅黑');
    assert.match(preferences.snapshot().contentFontStyle, /--dsh-font-family-code:"Consolas",monospace/);
    for (const bad of ['Arial; color:red', 'url(https://example.com)', 'Arial\nbody', '<style>', 'Arial}']) assert.throws(() => preferences.setFontFamily('text', bad));
    preferences.setFontFamily('text', ' , '); assert.equal(preferences.fontFamily('text'), '');
    assert.equal(preferences.fontFamily('terminal'), 'Cascadia Code');
    assert.throws(() => preferences.setFontFamily('unknown', 'Arial'));
  } finally { delete global.wx; }
});
test('language applies immediately and follows system without altering raw payload', () => {
  setup();
  try {
    assert.equal(preferences.t('助手'), '助手');
    preferences.setLanguage('en'); assert.equal(preferences.t('助手'), 'Assistant'); assert.equal(preferences.snapshot().ui['通用设置'], 'General');
    preferences.setLanguage('system'); wx.getAppBaseInfo = () => ({ language: 'en_US' }); assert.equal(preferences.locale(), 'en');
    preferences.setLanguage('zh');
    const rows = protocol.buildTrajectory([{ seq: 1, time: 1800000000, type: 'assistant/message', data: { turn: 1, step: 1, usage: { outputTokens: 5 }, message: { content: 'Hello **world**; Status = Running' } } }], 's').map(trajectory.localize);
    const row = rows.find(r => r.badge === 'ASSISTANT');
    assert.equal(row.displayBadge, '助手'); assert.equal(row.label, '助手'); assert.equal(rows[0].label, '第 1 轮');
    const tabs = trajectory.sections(row); assert.deepEqual(tabs.map(t => t.label), ['概述', '预览', '原始内容']);
    assert.equal(tabs[0].fields.find(f => f.label === '状态').value, '已完成');
    assert.ok(tabs[2].text.includes('Hello **world**; Status = Running'));
    const request = trajectory.sections(row.request);
    assert.ok(request[0].text.includes('提供方')); assert.ok(request[2].text.includes('本次请求')); assert.ok(request[3].text.includes('开始时间'));
    preferences.setLanguage('en');
    const english = trajectory.localize(row); assert.equal(english.displayBadge, 'Assistant');
    assert.equal(english.outputText, row.outputText); assert.equal(trajectory.sections(english)[0].label, 'Summary');
  } finally { delete global.wx; }
});
test('live pages refresh and unloaded pages stop receiving preferences', () => {
  setup(); let definition; global.Page = options => { definition = options; };
  try {
    preferences.install(); Page({ data: {}, onUiPreferencesChange() { this.refreshed = true; } });
    const page = { ...definition, data: {}, setData(patch) { Object.assign(this.data, patch); } };
    page.onLoad(); preferences.setFontSize(18); assert.equal(page.data.contentFontSize, 18); assert.equal(page.refreshed, true);
    preferences.setLanguage('en'); assert.equal(page.data.ui['语言'], 'Language');
    page.onUnload(); preferences.setFontSize(19); assert.equal(page.data.contentFontSize, 18);
  } finally { delete global.Page; delete global.wx; }
});
test('expanded settings expose all desktop font controls and actual render roles', () => {
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  for (const label of ['正文字体', '代码字体', '代码字号', '终端字体', '终端字号']) assert.ok(template.includes("ui['" + label + "']"), label);
  for (const role of ['text', 'code', 'terminal']) {
    assert.ok(template.includes('value="{{fontFamilies.' + role + '}}"'));
    assert.ok(template.includes('value="{{fontSizes.' + role + '}}"'));
  }
  assert.match(template, /wx:if="{{fontSettingsExpanded}}"/);
  assert.match(template, /bindblur="commitFontFamily"/);
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.match(css, /\.session \.tool-detail-code[\s\S]*var\(--dsh-code-font-size, 11px\)/);
  assert.match(css, /var\(--dsh-content-font-size, 14px\)/);
  assert.doesNotMatch(css, /\.font-large/);
});
test('settings numeric inputs clamp each role and disclosure survives writes', () => {
  setup(); let definition; const file = path.join(__dirname, '../miniprogram/pages/settings/settings.js');
  try {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: d => { definition = d; }, wx: global.wx, console, require: name => require(path.resolve(path.dirname(file), name)) });
    const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
    page.toggleFontSettings(); assert.equal(page.data.fontSettingsExpanded, true);
    page.commitFontSize({ currentTarget: { dataset: { role: 'code' } }, detail: { value: '99' } });
    assert.equal(preferences.fontSize('code'), 16); assert.equal(page.data.fontSettingsExpanded, true);
    page.commitFontSize({ currentTarget: { dataset: { role: 'terminal' } }, detail: { value: '9' } });
    assert.equal(preferences.fontSize('terminal'), 10);
    page.commitFontFamily({ currentTarget: { dataset: { role: 'code' } }, detail: { value: 'Consolas' } });
    assert.equal(page.data.fontFamilies.code, 'Consolas');
    page.resetFontSize({ currentTarget: { dataset: { role: 'code' } } }); assert.equal(preferences.fontSize('code'), 11);
  } finally { delete global.wx; }
});

test('settings switches persist context and fleet visibility independently', () => {
  setup(); let definition;
  const file = path.join(__dirname, '../miniprogram/pages/settings/settings.js');
  try {
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      Page: value => { definition = value; }, wx: global.wx, console,
      require: name => require(path.resolve(path.dirname(file), name))
    });
    const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
    page.toggleContextPanel({ detail: { value: false } });
    assert.equal(page.data.showContextPanel, false);
    assert.deepEqual(contextPanelsPreference.read(), { context: false, fleet: true });
    page.toggleFleetPanel({ detail: { value: false } });
    assert.equal(page.data.showFleetPanel, false);
    assert.deepEqual(contextPanelsPreference.read(), { context: false, fleet: false });
    page.toggleContextPanel({ detail: { value: true } });
    assert.deepEqual(contextPanelsPreference.read(), { context: true, fleet: false });
  } finally { delete global.wx; }
});

test('preference arrows use font-independent centered chevrons for both controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxml'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/settings/settings.wxss'), 'utf8');
  assert.doesNotMatch(html, /[⌃⌄]/);
  assert.equal((html.match(/class="preference-chevron-line"/g) || []).length, 1, 'only the language row keeps a chevron');
  assert.match(html, /preference-chevron \{\{choiceMenu === 'language'/);
  // 字号行不再带折叠箭头：整行可点展开，输入框不触发切换
  assert.doesNotMatch(html, /font-expand|preference-chevron \{\{fontSettingsExpanded/);
  assert.match(html, /class="card-row preference-font-row" bindtap="toggleFontSettings"/);
  assert.match(html, /class="font-number-control" catchtap="noop"/);
  assert.match(css, /\.preference-chevron\.expanded\s*\{\s*transform: rotate\(180deg\)/);
  assert.doesNotMatch(css, /\.font-expand/);
});
