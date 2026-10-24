const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preferences = require('../miniprogram/utils/ui-preferences');
const root = path.resolve(__dirname, '..', 'miniprogram');
const dictionary = { ...require('../miniprogram/i18n/trajectory'), ...require('../miniprogram/i18n/interface'), ...require('../miniprogram/i18n/voice'), ...require('../miniprogram/i18n/files'), ...require('../miniprogram/i18n/collaboration') };
const han = /[\u3400-\u9fff]/;
function setup(language = 'en') {
  const storage = { appLanguage: language };
  global.wx = { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; }, getAppBaseInfo: () => ({ language: 'zh_CN' }) };
  return storage;
}
function files(dir, extension) {
  return fs.readdirSync(path.join(root, dir), { recursive: true }).filter(name => name.endsWith(extension)).map(name => path.join(root, dir, name));
}
test('all pages and shared components translate authored template copy', () => {
  assert.equal(require('./helpers/routes.cjs')(JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))).length, 18);
  for (const file of files('pages', '.wxml').concat(files('components', '.wxml'), files('templates', '.wxml'))) {
    const text = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const match of text.matchAll(/ui\['([^']*)'\]/g)) {
      assert.ok(Object.prototype.hasOwnProperty.call(dictionary, match[1]), file + ': missing ' + match[1]);
      assert.equal(han.test(dictionary[match[1]]), false, file + ': untranslated ' + match[1]);
    }
    const visible = text.replace(/{{[\s\S]*?}}/g, '');
    for (const match of visible.matchAll(/>([^<]*)</g)) assert.equal(han.test(match[1]), false, file + ': hardcoded text ' + match[1]);
    for (const match of visible.matchAll(/(?:placeholder|aria-label|title)="([^"]*)"/g)) assert.equal(han.test(match[1]), false, file + ': hardcoded attribute ' + match[1]);
    assert.equal(/(?:value|wx:if|wx:for)="{{ui\[/.test(text), false, 'Do not translate state or user input: ' + file);
  }
});
test('English resolves every dictionary entry and preserves unknown content', () => {
  setup();
  try {
    for (const key of Object.keys(dictionary)) assert.equal(han.test(preferences.t(key)), false, key);
    for (const text of ['用户自己的中文消息', '文件路径/中文.txt', '工具返回：原始输出', '用户自定义标题']) assert.equal(preferences.t(text), text);
    assert.equal(preferences.t(14), 14); assert.equal(preferences.t(' 日'), '');
    assert.ok(Buffer.byteLength(JSON.stringify(preferences.snapshot())) < 1024 * 1024);
  } finally { delete global.wx; }
});
test('locale changes refresh native titles without rewriting user content', () => {
  setup('zh'); let definition; const titles = [];
  global.wx.setNavigationBarTitle = options => titles.push(options.title); global.Page = options => { definition = options; };
  try {
    preferences.install(); Page({ data: { label: preferences.t('未连接'), text: '' }, onUiLocaleChange() { this.localeChanges = (this.localeChanges || 0) + 1; } });
    preferences.setLanguage('en');
    const page = { ...definition, route: 'pages/announcements/announcements', data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
    page.onLoad(); assert.equal(page.data.label, 'Disconnected'); assert.equal(titles.at(-1), 'Announcements');
    page.setData({ text: '用户中文输入不应该被翻译', userName: '助手', toolOutput: '已完成' });
    preferences.setLanguage('zh'); preferences.setLanguage('en');
    assert.equal(page.data.text, '用户中文输入不应该被翻译'); assert.equal(page.data.userName, '助手'); assert.equal(page.data.toolOutput, '已完成');
    assert.equal(page.localeChanges, 2); page.onUnload();
  } finally { delete global.Page; delete global.wx; }
});
test('native modal buttons follow app language, not WeChat language', () => {
  setup(); let modal; global.Page = x => x; global.wx.showModal = options => { modal = options; };
  try {
    preferences.install(); wx.showModal({ title: '删除节点？', content: '用户内容：不要改动' });
    assert.equal(modal.title, 'Delete node?'); assert.equal(modal.confirmText, 'Confirm'); assert.equal(modal.cancelText, 'Cancel'); assert.equal(modal.content, '用户内容：不要改动');
    preferences.setLanguage('zh'); wx.showModal({ title: '删除节点？' }); assert.equal(modal.cancelText, '取消');
  } finally { delete global.Page; delete global.wx; }
});
test('page load resolves locale once per tree and unchanged show sends no dictionary', () => {
  const storage = setup('system'); let definition, reads = 0, systemReads = 0, callbacks = 0;
  const patches = [];
  wx.getStorageSync = key => { reads++; return storage[key]; };
  wx.getAppBaseInfo = () => { systemReads++; return { language: 'zh_CN' }; };
  global.Page = value => { definition = value; };
  try {
    preferences.install();
    Page({ data: { choices: Array.from({ length: 500 }, () => ({ label: '未连接' })) }, onUiPreferencesChange() { callbacks++; } });
    const page = { ...definition, data: { ...definition.data }, setData(patch) { patches.push(patch); Object.assign(this.data, patch); } };
    reads = 0; systemReads = 0; page.onLoad();
    assert.ok(reads < 20, 'Translation must not read storage for every label');
    assert.ok(systemReads <= 2, 'Resolve the system language once per pass');
    assert.equal(callbacks, 1); assert.ok(!patches.some(patch => 'ui' in patch));
    patches.length = 0; page.onShow(); page.onShow();
    assert.equal(patches.length, 0); assert.equal(callbacks, 1);
    preferences.setFontSize(15); assert.equal(page.data.contentFontSize, 15);
    assert.ok(!patches.some(patch => 'ui' in patch), 'Font changes must not resend the dictionary');
    patches.length = 0; preferences.setLanguage('en');
    assert.equal(patches.filter(patch => 'ui' in patch).length, 1);
    assert.equal(page.data.ui['未连接'], 'Disconnected');
    page.onUnload();
  } finally { delete global.Page; delete global.wx; }
});
test('plugin metadata, schedules and cached setting choices follow locale', () => {
  setup('zh'); const plugins = require('../miniprogram/utils/plugins'), work = require('../miniprogram/utils/work-step-presentation'), style = require('../miniprogram/utils/status-appearance'), schedule = require('../miniprogram/utils/schedule');
  try {
    preferences.setLanguage('en'); assert.equal(plugins.localizedText({ zh: '中文名称', en: 'English name' }), 'English name'); assert.equal(plugins.localizedText('第三方单语言名称'), '第三方单语言名称');
    assert.equal(work.view().workStepModeLabel, 'Detailed'); assert.equal(han.test(style.choices().map(x => x.label + x.detail).join('')), false);
    for (const kind of ['daily', 'weekly', 'every', 'after', 'at']) assert.equal(han.test(schedule.fullRule({ kind, raw: { weekdays: [1, 5], everySeconds: 3600, afterSeconds: 120 } })), false, kind);
    assert.equal(han.test(schedule.formatDate('2026-10-19T10:00:00Z')), false); preferences.setLanguage('zh'); assert.equal(work.view().workStepModeLabel, '详细');
  } finally { delete global.wx; }
});
test('privacy component changes language without mutating policy source', () => {
  setup(); let definition; const source = require('../miniprogram/utils/privacy-policy'), before = JSON.stringify(source);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'components/privacy-sheet/privacy-sheet.js'), 'utf8'), { Component: x => { definition = x; }, require: name => name.endsWith('ui-preferences') ? preferences : source, clearTimeout });
  const component = { ...definition.methods, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  try { definition.lifetimes.attached.call(component); assert.equal(han.test(JSON.stringify(component.data.policy)), false); preferences.setLanguage('zh'); assert.equal(component.data.policy.intro, source.intro); assert.equal(JSON.stringify(source), before); }
  finally { definition.lifetimes.detached.call(component); delete global.wx; }
});
