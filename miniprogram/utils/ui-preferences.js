const trajectory = require('../i18n/trajectory');
const common = require('../i18n/interface');
const voice = require('../i18n/voice');
const files = require('../i18n/files');
const dictionary = { ...trajectory, ...common, ...voice, ...files };
const reverse = {};
Object.keys(dictionary).forEach(zh => { if (/[a-z]/i.test(dictionary[zh])) reverse[dictionary[zh]] = zh; });
const listeners = new Set();
const FONT = { min: 10, max: 22, default: 14 };
// DSH desktop dsh-client-ui-theme FONT_SIZE_SPECS.
const FONTS = { text: FONT, code: { min: 10, max: 16, default: 11 }, terminal: { min: 10, max: 20, default: 13 } };
const SIZE_KEYS = { text: 'appFontSize', code: 'appCodeFontSize', terminal: 'appTerminalFontSize' };
const FAMILY_KEYS = { text: 'appTextFontFamily', code: 'appCodeFontFamily', terminal: 'appTerminalFontFamily' };
function read(key) { try { return wx.getStorageSync(key); } catch (_) { return undefined; } }
function language() { const v = read('appLanguage'); return ['zh', 'zh-Hans', 'en'].includes(v) ? v === 'zh-Hans' ? 'zh' : v : 'system'; }
function locale(selected = language()) {
  if (selected !== 'system') return selected;
  try { const info = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync(); return /^en/i.test(info.language || '') ? 'en' : 'zh'; } catch (_) { return 'zh'; }
}
// Only translate interface copy, never messages, tool output or user names.
function translate(text, values, activeLocale) {
  const zh = Object.prototype.hasOwnProperty.call(dictionary, text) ? text : reverse[text] || text;
  let result = activeLocale === 'en' ? Object.prototype.hasOwnProperty.call(dictionary, zh) ? dictionary[zh] : text : zh;
  if (values) Object.keys(values).forEach(key => { result = result.split('{' + key + '}').join(String(values[key])); });
  return result;
}
function t(text, values) { return translate(text, values, locale()); }
function fontSize(role = 'text') {
  const spec = FONTS[role]; if (!spec) throw Error('Invalid font role');
  const value = read(SIZE_KEYS[role]);
  if (Number.isInteger(value) && value >= spec.min && value <= spec.max) return value;
  return (role === 'text' && ({ large: 16, xlarge: 17 })[read('appFontScale')]) || spec.default;
}
function normalizeFontFamily(value) {
  if (typeof value !== 'string' || value.length > 500 || /[;{}<>\\\n\r]/.test(value)) throw Error('Invalid font family');
  return value.split(',').map(name => name.trim().replace(/^(['"])(.*)\1$/, '$2').trim()).filter(Boolean).map(name => {
    if (!/^[\p{L}\p{N} _-]+$/u.test(name)) throw Error('Invalid font family');
    return name;
  }).join(', ');
}
function fontFamily(role) {
  if (!FAMILY_KEYS[role]) throw Error('Invalid font role');
  try { return normalizeFontFamily(read(FAMILY_KEYS[role]) || ''); } catch (_) { return ''; }
}
function familyCss(role, family = fontFamily(role)) {
  const names = family.split(', ').filter(Boolean).map(name => ['serif', 'sans-serif', 'monospace', 'system-ui'].includes(name) ? name : '"' + name + '"');
  return names.concat(role === 'text' ? ['-apple-system', 'BlinkMacSystemFont', 'sans-serif'] : ['Menlo', 'Consolas', 'monospace']).join(',');
}
const uiByLocale = {};
function snapshot() {
  const selected = language(), activeLocale = locale(selected);
  if (!uiByLocale[activeLocale]) {
    const ui = {};
    Object.keys(dictionary).forEach(key => { ui[key] = activeLocale === 'en' ? dictionary[key] : key; });
    Object.keys(reverse).forEach(key => { if (!Object.prototype.hasOwnProperty.call(ui, key)) ui[key] = activeLocale === 'en' ? key : reverse[key]; });
    uiByLocale[activeLocale] = ui;
  }
  const ui = uiByLocale[activeLocale];
  const fontSizes = {}, fontFamilies = {};
  Object.keys(FONTS).forEach(role => { fontSizes[role] = fontSize(role); fontFamilies[role] = fontFamily(role); });
  const size = fontSizes.text;
  const style = '--dsh-content-font-size:' + size + 'px;' + Object.keys(FONTS).map(role => '--dsh-' + role + '-font-size:' + fontSizes[role] + 'px;--dsh-font-family-' + role + ':' + familyCss(role, fontFamilies[role]) + ';').join('');
  return { ui, uiLocale: activeLocale, language: selected, languageLabel: selected === 'system' ? translate('跟随系统', null, activeLocale) : selected === 'en' ? 'English' : '简体中文',
    fontSizes, fontFamilies, contentFontSize: size, fontSizeLabel: size + ' px', contentFontStyle: style };
}
function notify() { listeners.forEach(fn => { try { fn(); } catch (_) { /* A closed page must not block other listeners. */ } }); }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function localized(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const keys = locale() === 'en' ? ['en', 'en-US', 'en_US', 'zh', 'zh-CN', 'zhHans'] : ['zh', 'zh-CN', 'zh-Hans', 'zhHans', 'en'];
  for (const key of keys.concat(Object.keys(value))) if (typeof value[key] === 'string' && value[key]) return value[key];
  return '';
}
const navigationTitles = {
  'pages/announcements/announcements': '开发者公告', 'pages/announcement-admin/announcement-admin': '公告管理',
  'pages/pairing-admin/pairing-admin': '配对码管理', 'pages/redeem-admin/redeem-admin': '兑换码管理',
  'pages/share-activity/share-activity': '鲸尾 · 分享助手', 'pages/files/files': '工作区文件',
  'pages/workspace-picker/workspace-picker': '选择工作区目录', 'pages/session-settings/session-settings': '会话设置'
};
function nativeCopy() {
  if (typeof wx === 'undefined') return;
  ['showModal', 'showToast', 'showLoading', 'showActionSheet'].forEach(name => {
    const original = wx[name];
    if (typeof original !== 'function' || original._uiLocalized) return;
    const wrapped = function (options) {
      const next = { ...options };
      ['title', 'confirmText', 'cancelText', 'placeholderText'].forEach(key => { if (typeof next[key] === 'string') next[key] = t(next[key]); });
      // Modal content may contain user data; callers localize only authored literals.
      if (name === 'showModal') { if (!next.confirmText) next.confirmText = t('确认'); if (!next.cancelText) next.cancelText = t('取消'); }
      if (Array.isArray(next.itemList)) next.itemList = next.itemList.map(text => t(text));
      return original.call(wx, next);
    };
    wrapped._uiLocalized = true;
    wx[name] = wrapped;
  });
}
function setLanguage(v) { if (!['system', 'zh', 'en'].includes(v)) throw Error('Invalid language'); wx.setStorageSync('appLanguage', v); notify(); }
function setFontSize(v, role = 'text') { const spec = FONTS[role]; if (!spec || !Number.isInteger(v) || v < spec.min || v > spec.max) throw Error('Invalid font size'); wx.setStorageSync(SIZE_KEYS[role], v); notify(); }
function setFontFamily(role, value) { if (!FAMILY_KEYS[role]) throw Error('Invalid font role'); wx.setStorageSync(FAMILY_KEYS[role], normalizeFontFamily(value)); notify(); }
function initialCopy(value, activeLocale) {
  if (typeof value === 'string') return translate(value, null, activeLocale);
  if (Array.isArray(value)) return value.map(item => initialCopy(item, activeLocale));
  if (!value || typeof value !== 'object') return value;
  const result = {}; Object.keys(value).forEach(key => { result[key] = initialCopy(value[key], activeLocale); }); return result;
}
function install() {
  nativeCopy();
  const original = Page;
  Page = function (options) {
    const load = options.onLoad, show = options.onShow, unload = options.onUnload;
    const initialData = options.data || {};
    const registeredPreferences = snapshot();
    options.data = { ...registeredPreferences, ...options.data };
    options.onLoad = function () {
      this.setData(initialCopy(initialData, locale()));
      this._uiSnapshot = registeredPreferences;
      this._refreshUiPreferences = () => {
        const next = snapshot(), changed = this._uiLocale !== next.uiLocale;
        const patch = {};
        Object.keys(next).forEach(key => {
          const previous = this._uiSnapshot[key];
          if (key === 'ui' ? previous !== next[key] : JSON.stringify(previous) !== JSON.stringify(next[key])) patch[key] = next[key];
        });
        const first = this._uiLocale === undefined;
        this._uiLocale = next.uiLocale; this._uiSnapshot = next;
        if (Object.keys(patch).length) this.setData(patch);
        const title = navigationTitles[this.route || this.__route__];
        if (changed && title && typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: translate(title, null, next.uiLocale) });
        if ((first || Object.keys(patch).length) && typeof this.onUiPreferencesChange === 'function') this.onUiPreferencesChange(next);
        if (changed && this._uiLoaded && typeof this.onUiLocaleChange === 'function') this.onUiLocaleChange();
      };
      listeners.add(this._refreshUiPreferences); this._refreshUiPreferences();
      const result = load && load.apply(this, arguments); this._uiLoaded = true; return result;
    };
    options.onShow = function () { if (this._refreshUiPreferences) this._refreshUiPreferences(); if (show) return show.apply(this, arguments); };
    options.onUnload = function () { listeners.delete(this._refreshUiPreferences); if (unload) return unload.apply(this, arguments); };
    return original(options);
  };
}
module.exports = { FONT, FONTS, language, locale, t, localized, subscribe, fontSize, fontFamily, normalizeFontFamily, snapshot, setLanguage, setFontSize, setFontFamily, install };
