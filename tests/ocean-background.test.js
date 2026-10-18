const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
test('particle mask preserves separate tail wave and native phone composition', () => {
  const dots = require('../utils/ocean-particles');
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
