const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionWarmup } = require('../miniprogram/utils/session-warmup');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('idle warming is bounded, sequential, cancellable and never repeats an unchanged list', async () => {
  const timers = new Map(), calls = []; let serial = 0, release;
  const warmup = createSessionWarmup({
    load: (id, current) => { calls.push([id, current]); return new Promise(resolve => { release = resolve; }); },
    schedule: (fn, delay) => { timers.set(++serial, { fn, delay }); return serial; },
    cancel: id => timers.delete(id)
  });
  const sessions = Array.from({ length: 7 }, (_, i) => ({ sessionId: String(i) }));
  function tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); }
  warmup.update('host', sessions, true);
  assert.equal([...timers.values()][0].delay, 750);
  warmup.update('host', sessions, true); assert.equal(timers.size, 1);
  for (let i = 0; i < 4; i++) {
    tick(); await settle(); assert.equal(calls.length, i + 1); assert.equal(timers.size, 0);
    release(); await settle();
  }
  assert.equal(timers.size, 0);
  warmup.update('host', sessions, true); assert.equal(timers.size, 0);
  warmup.update('other', sessions, true); tick(); await settle();
  const current = calls.at(-1)[1]; warmup.stop();
  assert.equal(current(), false); release(); await settle(); assert.equal(timers.size, 0);
  warmup.update('host', sessions, false); assert.equal(timers.size, 0);
});
