const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ''; },
  setStorageSync(key, value) { storage.set(key, value); }
};
const guard = require(path.resolve(__dirname, '../miniprogram/utils/jank-guard'));

test('a single slow tick is not enough, two consecutive ones degrade', () => {
  guard.recover();
  assert.equal(guard.degraded(), false);
  assert.equal(guard.evaluateDrift(300), false, 'normal scheduling noise is ignored');
  assert.equal(guard.evaluateDrift(guard.STRIKE_DRIFT_MS + 1), true);
  guard.degrade();
  assert.equal(guard.degraded(), true, 'degrade persists a timestamp');
  assert.equal(guard.degraded(Date.now() - guard.TTL_MS - 1), false, 'stale stamps expire');
  guard.recover();
  assert.equal(guard.degraded(), false);
});

test('guard keeps no timers until started and can be stopped', () => {
  let fired = 0;
  const original = global.setInterval;
  global.setInterval = (fn) => { fired += 1; return { unref() {} }; };
  const originalClear = global.clearInterval;
  global.clearInterval = () => {};
  try {
    guard.start();
    guard.start();
    assert.equal(fired, 1, 'starting twice keeps a single heartbeat');
    guard.stop();
  } finally {
    global.setInterval = original;
    global.clearInterval = originalClear;
  }
});
