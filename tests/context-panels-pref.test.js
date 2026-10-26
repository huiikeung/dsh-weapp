'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const preference = require('../miniprogram/pages/session/utils/context-panels-pref');

test('context and fleet visibility are independently persisted and default on', () => {
  const storage = {};
  global.wx = {
    getStorageSync: key => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; }
  };
  try {
    assert.deepEqual(preference.read(), { context: true, fleet: true });
    assert.deepEqual(preference.set('context', false), { context: false, fleet: true });
    assert.deepEqual(preference.set('fleet', false), { context: false, fleet: false });
    assert.deepEqual(preference.read(), { context: false, fleet: false });
    assert.deepEqual(preference.set('context', true), { context: true, fleet: false });
    assert.throws(() => preference.set('trajectory', false), /Invalid session panel/);
  } finally {
    delete global.wx;
  }
});
