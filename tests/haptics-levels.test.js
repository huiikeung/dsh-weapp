const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture(options = {}) {
  const calls = [], timers = new Map(), module = { exports: {} }; let now = 1000, serial = 0;
  const wx = { getStorageSync: () => 'medium', setStorageSync() {},
    vibrateLong(args) { calls.push('long'); args.success(); },
    getDeviceInfo: () => ({ platform: 'ios' }) };
  if (!options.legacy) wx.vibrateShort = args => {
    calls.push(args.type);
    if (options.throws) throw Error('unavailable');
    if (options.silent) return;
    if (options.fail) args.fail({ errMsg: 'unavailable' }); else args.success();
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/utils/haptics.js'), 'utf8'), {
    module, wx, Date: { now: () => now },
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); }
  });
  return { h: module.exports, calls, timers, advance(ms) { now += ms; } };
}
test('light starts at medium, medium maps to heavy, and heavy uses a longer enhanced pulse', () => {
  const f = fixture();
  for (const level of ['light', 'medium', 'heavy']) { f.h.setLevel(level); f.h.vibrate(); }
  assert.deepEqual(f.calls, ['medium', 'heavy', 'long']);
  f.h.setLevel('off'); f.h.vibrate(); f.h.tick(); assert.equal(f.calls.length, 3);
});
test('scroll feedback shares the selected strength and throttles rapid ticks', () => {
  const f = fixture(); f.h.setLevel('light'); f.h.tick(); f.h.tick();
  f.advance(61); f.h.setLevel('heavy'); f.h.tick();
  assert.deepEqual(f.calls, ['medium', 'long']);
});
test('test plays only the selected strength once and completes once', () => {
  for (const level of ['light', 'medium', 'heavy', 'off']) {
    const f = fixture(); f.h.setLevel(level); const results = []; f.h.test(value => results.push(value));
    const expected = { light: 'medium', medium: 'heavy', heavy: 'long' }[level];
    assert.deepEqual(f.calls, expected ? [expected] : []);
    assert.equal(results.length, 1); assert.equal(results[0].ok, level !== 'off');
    assert.equal(f.timers.size, 0);
  }
});
test('failure never replaces light feedback with a long pulse; legacy and timeout are handled', () => {
  for (const options of [{ fail: true }, { throws: true }, { silent: true }]) {
    const f = fixture(options), results = []; f.h.setLevel('light'); f.h.test(value => results.push(value));
    for (const fn of [...f.timers.values()]) fn();
    assert.deepEqual(f.calls, ['medium']); assert.equal(results.length, 1); assert.equal(results[0].ok, false);
  }
  const f = fixture({ legacy: true }); f.h.vibrate(); assert.deepEqual(f.calls, ['long']);
});
