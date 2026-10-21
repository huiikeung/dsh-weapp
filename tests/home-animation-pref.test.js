const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const preference = require('../miniprogram/utils/home-animation-pref');

test('homepage animation preference defaults on and persists both switch states', () => {
  const storage = {};
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };
  try {
    assert.equal(preference.enabled(), true, 'existing installs retain the animated default');
    assert.equal(preference.setEnabled(false), false);
    assert.equal(storage[preference.KEY], false);
    assert.equal(preference.enabled(), false);
    assert.equal(preference.setEnabled(true), true);
    assert.equal(preference.enabled(), true);
  } finally { delete global.wx; }
});

test('settings switch controls the home ocean reduced-motion mode and is localized', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');
  const template = read('pages/settings/settings.wxml');
  const settings = read('pages/settings/settings.js');
  const home = read('pages/home/home.js');
  const homeTemplate = read('pages/home/home.wxml');
  const dictionary = require('../miniprogram/i18n/interface');
  assert.match(template, /checked="\{\{homeAnimationEnabled\}\}"[^>]*bindchange="toggleHomeAnimation"/);
  assert.match(settings, /homeAnimationPreference\.setEnabled\(!!e\.detail\.value\)/);
  assert.match(home, /oceanReducedMotion:\s*!homeAnimationEnabled\s*\|\|\s*settings\.enableReduceMotion === true/);
  assert.match(homeTemplate, /reduced-motion="\{\{oceanReducedMotion\}\}"/);
  assert.equal(dictionary['首页动画'], 'Homepage animation');
});
