const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');
function bufferedFixture(platform = 'ios') {
  let definition, serial = 0, renders = 0;
  const commits = [], frames = new Map();
  const canvas = { toDataURL: () => 'data:image/jpeg;base64,frame-' + renders,
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; }, Date,
    wx: { getWindowInfo: () => ({ pixelRatio: 3 }), getDeviceInfo: () => ({ platform }), createOffscreenCanvas: () => canvas },
    require: () => ({ createOceanRenderer: () => ({ draw() { renders++; }, dispose() {}, resize() {} }) })
  });
  const component = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) commits.push(callback); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
  definition.lifetimes.ready.call(component);
  return { component, definition, frames, commits, renders: () => renders,
    load(slot, id) { component.onFrameLoad({ currentTarget: { dataset: { slot, frameId: id } } }); },
    error(slot, id) { component.onFrameError({ currentTarget: { dataset: { slot, frameId: id } } }); } };
}
test('iOS keeps fallback until decoding and never rewrites the visible frame', () => {
  const f = bufferedFixture(), c = f.component;
  assert.equal(c.data.buffered, true); assert.equal(c.data.ready, false);
  assert.equal(c.data.frontSlot, ''); assert.ok(c.data.frameA);
  c.draw(1); assert.equal(f.renders(), 1, 'wait for decode before generating another frame');
  f.load('a', c.data.frameAId); assert.equal(c.data.frontSlot, 'a'); assert.equal(c.data.ready, true);
  c.draw(2); assert.equal(f.renders(), 1, 'wait for the view-layer swap to commit');
  f.commits.shift()();
  const first = c.data.frameA; c.draw(3);
  assert.equal(c.data.frameA, first); assert.equal(c.data.frontSlot, 'a'); assert.ok(c.data.frameB);
  f.load('a', c.data.frameAId); assert.equal(c.data.frontSlot, 'a', 'ignore stale callbacks');
  f.load('b', c.data.frameBId); f.commits.shift()();
  const second = c.data.frameB; c.draw(4);
  assert.equal(c.data.frontSlot, 'b'); assert.equal(c.data.frameB, second);
  assert.notEqual(c.data.frameA, first);
});
test('decode failure retains the last complete image and stops animation', () => {
  const f = bufferedFixture(), c = f.component;
  f.load('a', c.data.frameAId); f.commits.shift()(); c.draw(1);
  const first = c.data.frameA; f.error('b', c.data.frameBId);
  assert.equal(c.data.frontSlot, 'a'); assert.equal(c.data.frameA, first); assert.equal(c.data.ready, true);
  assert.equal(c.data.failed, true); assert.equal(c._renderer, null); assert.equal(f.frames.size, 0);
  f.load('b', c.data.frameBId); assert.equal(c.data.frontSlot, 'a');
  const initial = bufferedFixture(); initial.error('a', initial.component.data.frameAId);
  assert.equal(initial.component.data.ready, false, 'fallback remains visible on first-image failure');
});
test('non-iOS retains the existing rendering path and detached buffers ignore callbacks', () => {
  for (const platform of ['android', 'ohos', 'devtools']) {
    const f = bufferedFixture(platform);
    assert.equal(f.component.data.buffered, false); assert.equal(f.component.data.ready, true);
    const first = f.component.data.frameImage; f.component.draw(1);
    assert.notEqual(f.component.data.frameImage, first); assert.equal(f.component.data.frameA, '');
  }
  const f = bufferedFixture(); f.definition.lifetimes.detached.call(f.component);
  f.load('a', f.component.data.frameAId); assert.equal(f.component.data.frontSlot, '');
  assert.equal(f.frames.size, 0);
});
test('particle mask preserves separate tail wave and native phone composition', () => {
  const dots = require('../miniprogram/utils/ocean-particles');
  assert.ok(dots.length > 1000 && dots.length < 3600);
  assert.ok(dots.some(p => p[0] > 0.9));
  for (const p of dots) { assert.equal(p.length, 6); assert.ok(p.every(Number.isFinite)); assert.ok(p[0] > 0 && p[0] < 1 && p[1] > 0 && p[1] < 1); }
  const renderer = read('utils/ocean-renderer.js');
  assert.match(renderer, /smoothstep\(0.54,0.94,x\)/);
  assert.match(renderer, /sin\(uTime\*1.10-x\*7.0\)\*7.0\*tail/);
  assert.match(renderer, /uSize\*vec2\(0.55,0.34\)/);
  assert.match(renderer, /uTime\*0.075/);
  assert.match(renderer, /gl.ONE_MINUS_SRC_COLOR/);
});
test('ocean playback cancels on hide, resumes without jump and releases on detach', () => {
  let definition, now = 1000, id = 0;
  const frames = new Map(), draws = [];
  const fakeDate = { now: () => now };
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: d => { definition = d; }, Date: fakeDate, wx: {}, require: () => ({createOceanRenderer(){}})
  });
  const component = { ...definition.methods, data: { active: true, reducedMotion: false }, _visible: true, _elapsed: 0,
    _canvas: { toDataURL(){return 'data:image/jpeg;base64,test';}, requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(id) { frames.delete(id); } },
    _renderer: { draw(t) { draws.push(t); }, dispose() { draws.push('disposed'); } },
    _context: {drawImage(){}}, _gpuCanvas: {}, setData(v) { Object.assign(this.data,v); } };
  const tick = ms => { now += ms; const fn = frames.values().next().value; frames.clear(); if(fn)fn(); };
  component.syncPlayback(); assert.equal(frames.size, 1); tick(34); assert.equal(draws.length, 1);
  definition.pageLifetimes.hide.call(component); assert.equal(frames.size, 0);
  const elapsed = component._elapsed; now += 60000;
  definition.pageLifetimes.show.call(component); tick(34); assert.ok(component._elapsed - elapsed < 0.1);
  component.data.reducedMotion = true; component.syncPlayback(); assert.equal(frames.size, 0); assert.equal(draws.at(-1), 0);
  definition.lifetimes.detached.call(component); assert.equal(draws.at(-1), 'disposed'); assert.equal(component._renderer, null);
});
test('home uses offscreen rendering and ordinary images without native canvas covering content', () => {
  assert.doesNotMatch(read('components/ocean-background/ocean-background.wxml'), /<canvas/);
  assert.match(read('components/ocean-background/ocean-background.wxml'), /src="{{frameImage}}"/);
  assert.match(read('components/ocean-background/ocean-background.js'), /createOffscreenCanvas/);
  assert.match(read('components/ocean-background/ocean-background.wxss'), /prefers-reduced-motion/);
  assert.match(read('components/ocean-background/ocean-background.wxss'), /ocean-settle 24s/);
  assert.match(read('pages/home/home.wxml'), /id="home-ocean"/);
  assert.doesNotMatch(read('pages/home/home.js'), /stopWhaleAnimation|startWhaleAnimation/);
});
