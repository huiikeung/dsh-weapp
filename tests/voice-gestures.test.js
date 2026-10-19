const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/voice-actions.js');
  const timers = new Map(), calls = []; let timerId = 0;
  const context = { module: { exports: {} }, wx: {},
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    require: name => name.endsWith('/store') ? {} : require(path.resolve(path.dirname(file), name)) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  const voice = { start() { calls.push('start'); }, release() { calls.push('release'); }, move(cancel) { calls.push(['move', cancel]); }, cancel() { calls.push('cancel'); } };
  const page = { ...context.module.exports, data: { voiceEnabled: true, tab: 'conversation', draft: '保留草稿', voicePhase: 'idle' },
    setData(patch) { Object.assign(this.data, patch); }, prioritizeInteraction() { calls.push('priority'); },
    voiceController() { this._voice = voice; return voice; } };
  const hold = () => { const task = [...timers.values()][0]; assert.equal(task.delay, 350); timers.clear(); task.fn(); };
  return { page, calls, timers, hold };
}
const touch = (id = 1, x = 100, y = 500) => ({ identifier: id, clientX: x, clientY: y });
const start = (page, point = touch()) => page.onVoiceTouchStart({ touches: [point] });
const end = (page, point = touch()) => page.onVoiceTouchEnd({ changedTouches: [point] });
test('short touch opens keyboard immediately without requesting microphone or losing draft', () => {
  const { page, calls, timers } = fixture(); start(page);
  const lateTimer = [...timers.values()][0]; assert.equal(lateTimer.delay, 350);
  end(page);
  assert.equal(page.data.composerFocus, true); assert.equal(page.data.voiceTyping, true);
  assert.equal(page.data.draft, '保留草稿'); assert.equal(timers.size, 0);
  lateTimer.fn(); assert.ok(!calls.includes('start'));
});
test('only sustained hold starts recording, release cannot open keyboard', () => {
  const { page, calls, hold } = fixture(); start(page); hold(); end(page);
  assert.equal(calls.filter(x => x === 'start').length, 1); assert.ok(calls.includes('release'));
  assert.ok(!page.data.composerFocus); assert.equal(page.data.draft, '保留草稿');
});
test('drag, touchcancel and hidden page cannot trigger a delayed recording', () => {
  for (const reason of ['drag', 'cancel', 'hide']) {
    const { page, calls, timers } = fixture(); start(page); const late = [...timers.values()][0].fn;
    if (reason === 'drag') page.onVoiceTouchMove({ touches: [touch(1, 125)] });
    if (reason === 'cancel') page.cancelVoice();
    if (reason === 'hide') { page._voiceHidden = true; page.cancelVoice(); }
    late(); end(page); assert.ok(!calls.includes('start')); assert.ok(!page.data.composerFocus);
  }
});
test('second finger cannot replace or release first finger; release position cancels upward hold', () => {
  const { page, calls, hold } = fixture(); start(page); start(page, touch(2)); end(page, touch(2));
  assert.equal(page._voiceTouch.id, 1); hold(); end(page, touch(1, 100, 400));
  assert.deepEqual(calls.at(-2), ['move', true]); assert.equal(calls.at(-1), 'release');
});
test('focused keyboard, disabled voice and trajectory cannot arm hold', () => {
  for (const update of [{ composerFocused: true }, { voiceEnabled: false }, { tab: 'trajectory' }, { voicePendingText: 'pending' }]) {
    const { page, timers } = fixture(); Object.assign(page.data, update); start(page); assert.equal(timers.size, 0);
  }
});
