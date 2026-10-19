const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
const { createField, drawField, paletteInk } = require('../miniprogram/components/voice-overlay/voice-field');
function fixture() {
  let definition, id = 0; const timers = new Map(), frames = new Map(), queries = [], arcs = [];
  const ctx = { scale() {}, clearRect() { arcs.length = 0; }, beginPath() {}, fill() {}, arc(...args) { arcs.push(args); } };
  const canvas = { getContext: () => ctx, requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); } };
  const file = path.join(root, 'components/voice-overlay/voice-overlay.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Component: value => { definition = value; }, Date, wx: { getWindowInfo: () => ({ pixelRatio: 3 }) },
    require: name => require(path.resolve(path.dirname(file), name)),
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; }, clearTimeout(key) { timers.delete(key); } });
  const component = { ...definition.methods, data: { ...definition.data, visible: false, theme: 'light', cancelArmed: false, status: '' },
    setData(patch) { Object.assign(this.data, patch); },
    createSelectorQuery() { return { select() { return this; }, fields() { return this; }, exec(fn) { queries.push(() => fn([{ node: canvas, width: 390, height: 337.6 }])); } }; } };
  definition.lifetimes.ready.call(component);
  const update = patch => { Object.assign(component.data, patch); for (const key of Object.keys(patch)) if (definition.observers[key]) definition.observers[key].call(component, patch[key]); };
  return { component, definition, update, frames, timers, queries, arcs, canvas };
}
test('iOS geometry uses 45 bars, 13 particles, 68% baseline and exact palettes', () => {
  for (const width of [320, 390, 430, 768]) {
    const field = createField(width, 340), positions = [];
    assert.equal(field.length, 585);
    const ctx = { beginPath() {}, fill() {}, arc: (...args) => positions.push(args) };
    drawField(ctx, field, Array(45).fill(0), 1, 0, 340);
    assert.equal(positions.length, 585);
    assert.ok(positions.every(([x,y,r]) => x >= 24 && x <= width-24 && Math.abs(y-340*.68) <= 2.51 && r > 0));
    assert.equal(ctx.globalAlpha, 1);
  }
  assert.deepEqual(paletteInk('light',false),[23,60,101]); assert.deepEqual(paletteInk('dark',true),[250,229,235]);
});
test('particles drift while silent and gather only after real voice, never fake levels', () => {
  const f = fixture(); f.update({ visible: true, status: '松手转文字 · 上滑取消' }); f.queries.shift()();
  assert.equal(f.canvas.width, 1170); assert.equal(f.arcs.length, 585); assert.equal(f.frames.size, 1);
  f.component.pushLevel(0); assert.equal(f.component.gatheredAt, null);
  f.component.pushLevel(.5); assert.notEqual(f.component.gatheredAt, null); assert.equal(f.component.level, .275);
  const gathered = f.component.gatheredAt; f.component.pushLevel(0); assert.equal(f.component.gatheredAt, gathered);
  assert.equal(f.component.levels.length,45); assert.ok(f.component.level < .275);
  f.definition.lifetimes.detached.call(f.component); assert.equal(f.frames.size,0);
});
test('cancel immediately clears/unmounts native canvas; only the pink halo fades', () => {
  const f = fixture(); f.update({ visible: true, status: '松手转文字 · 上滑取消' }); f.queries.shift()();
  f.update({ cancelArmed: true, status: '松手取消' });
  f.update({ visible: false, cancelArmed: false, status: '' });
  assert.equal(f.frames.size,0); assert.equal(f.arcs.length,0);
  assert.equal(f.canvas.width,1); assert.equal(f.canvas.height,1);
  assert.equal(f.component.canvas,null); assert.equal(f.component.levels,null);
  assert.equal(f.component.data.leaving,true); assert.equal(f.component.data.displayStatus,'松手取消'); assert.equal(f.component.data.displayCancelArmed,true);
  assert.equal([...f.timers.values()][0].delay,280);
  [...f.timers.values()][0].fn(); assert.equal(f.frames.size,0); assert.equal(f.component.data.leaving,false);
});
test('rapid release/repress invalidates pending canvas callbacks and keeps one animation loop', () => {
  const f=fixture(); f.update({visible:true}); f.update({visible:false}); f.update({visible:true});
  assert.equal(f.timers.size,0); f.queries.shift()(); assert.equal(f.frames.size,0); f.queries.shift()(); assert.equal(f.frames.size,1);
  f.update({visible:false}); f.definition.lifetimes.detached.call(f.component); assert.equal(f.frames.size,0); assert.equal(f.timers.size,0);
});
test('overlay covers safe area, masks particles and hides the entire composer dock without unmounting', () => {
  const css=fs.readFileSync(path.join(root,'components/voice-overlay/voice-overlay.wxss'),'utf8');
  const xml=fs.readFileSync(path.join(root,'components/voice-overlay/voice-overlay.wxml'),'utf8');
  const page=fs.readFileSync(path.join(root,'pages/session/session.wxml'),'utf8');
  assert.ok(css.includes('height:40vh')); assert.ok(css.includes('transparent 71.9%,#000 72%'));
  assert.ok(css.includes('.voice-overlay.leaving { opacity:0; visibility:visible; transform:translateY(0); transition:opacity 280ms'));
  assert.ok(xml.includes('<canvas wx:if="{{visible}}"'));
  assert.ok(xml.indexOf('voice-masked') < xml.indexOf('<canvas'));
  assert.ok(page.includes('dock-stack {{voiceOverlayVisible'));
  assert.ok(!page.includes('!draft && !composerFocused'));
});
test('late audio and already queued animation cannot paint over the restored composer', () => {
  const f=fixture(); f.update({visible:true}); f.queries.shift()();
  const queued=[...f.frames.values()][0];
  f.update({visible:false}); f.component.pushLevel(1); queued();
  assert.equal(f.frames.size,0); assert.equal(f.arcs.length,0); assert.equal(f.component.levels,null);
  f.update({visible:true}); f.queries.shift()();
  assert.equal(f.frames.size,1); const current=f.component._raf; queued();
  assert.equal(f.component._raf,current); assert.equal(f.frames.size,1);
  f.definition.lifetimes.detached.call(f.component);
});
