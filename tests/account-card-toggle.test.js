// 账号卡片开关：设置页顶部左侧的 switch，控制设置页与会话设置页顶部的账号区。
// 默认关闭（账号信息属隐私内容），且开关本身不能被自己的开关藏起来。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../miniprogram');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const settingsWxml = read('pages/settings/settings.wxml');
const settingsJs = read('pages/settings/settings.js');
const sessionSettingsWxml = read('pages/session-settings/session-settings.wxml');
const sessionSettingsJs = read('pages/session-settings/session-settings.js');

const pref = require('../miniprogram/utils/account-card-pref');

function withStorage(initial) {
  const storage = { ...initial };
  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };
  return storage;
}

test('the preference defaults to hidden and round-trips', () => {
  const storage = withStorage({});
  try {
    assert.equal(pref.DEFAULT, false);
    assert.equal(pref.read(), false, 'defaults to hidden');
    assert.equal(pref.set(true), true);
    assert.equal(storage[pref.KEY], true);
    assert.equal(pref.read(), true, 'the switch state persists');
    assert.equal(pref.set(false), false);
    assert.equal(pref.read(), false);
  } finally { delete global.wx; }
});

test('a corrupt or missing storage entry still reads as hidden', () => {
  const storage = withStorage({ [pref.KEY]: 'yes' });
  try {
    assert.equal(pref.read(), false, 'non-boolean values fall back to hidden');
    storage[pref.KEY] = undefined;
    assert.equal(pref.read(), false);
  } finally { delete global.wx; }
});

test('the settings page hides the account area by default and keeps the switch in General settings', () => {
  // 账号区整块由开关控制：关掉时连空壳都不渲染。
  assert.match(settingsWxml, /<view wx:if="\{\{showAccountCard && dshAccountVisible\}\}" class="dsh-account-section"/,
    'the account area is gated by the switch');
  // 开关搬进「通用设置」分组：文案在左（.exp-copy 撑满），switch 在右（最后一个子节点）。
  const generalAt = settingsWxml.indexOf("ui['通用设置']");
  const nextGroupAt = settingsWxml.indexOf("ui['会话面板']");
  assert.ok(generalAt > 0 && nextGroupAt > generalAt, 'the General settings group exists');
  const general = settingsWxml.slice(generalAt, nextGroupAt);
  assert.match(general, /<view class="exp-copy"><text class="card-row-label">\{\{ui\['显示账号卡片'\]\}\}<\/text><text class="exp-desc">/,
    'the label leads the row');
  assert.match(general, /<dsh-switch checked="\{\{showAccountCard\}\}"[^>]*bindchange="toggleAccountCard"/,
    'the custom switch remains bound to the account preference');
  assert.ok(general.indexOf('card-row-label') < general.indexOf('<dsh-switch checked="{{showAccountCard}}"'),
    'text on the left, switch on the right');
  // 顶部账号区不再有开关，否则关掉后页面顶部会留一个孤立控件。
  const top = settingsWxml.slice(settingsWxml.indexOf('dsh-account-section'), settingsWxml.indexOf("ui['连接']"));
  assert.ok(!/bindchange="toggleAccountCard"/.test(top), 'the top account section carries no switch');
});

test('the page reads and writes the preference', () => {
  assert.match(settingsJs, /showAccountCard: accountCardPreference\.read\(\)/,
    'the settings page seeds the switch state from the preference');
  assert.match(settingsJs, /onShow\(\)[\s\S]*?showAccountCard: accountCardPreference\.read\(\)/,
    're-entering the page re-reads the preference');
  assert.match(settingsJs, /toggleAccountCard\(e\)\s*\{[\s\S]*?accountCardPreference\.set\(!!\(e && e\.detail && e\.detail\.value\)\)/,
    'the switch writes through to storage');
  assert.match(settingsJs, /toggleAccountCard[\s\S]*?dshBalanceExpanded: next && this\.data\.dshBalanceExpanded/,
    'hiding the card also collapses the balance sheet');
});

test('session settings honours the same switch without owning it', () => {
  assert.match(sessionSettingsWxml, /wx:if="\{\{dshAccountVisible && showAccountCard\}\}" class="dsh-account-section"/,
    'the session settings account card follows the switch');
  assert.ok(!/bindchange="toggleAccountCard"/.test(sessionSettingsWxml), 'session settings has no second switch');
  assert.match(sessionSettingsJs, /showAccountCard: accountCardPreference\.read\(\)/,
    'the page re-reads the preference on load');
});
