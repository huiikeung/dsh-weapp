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
test('every platform animates; only the preference turns the ocean static', () => {
  // 安卓/鸿蒙/开发工具不再按平台静态化（实测华为性能足够，用户要求与 iPhone 一致）。
  for (const platform of ['android', 'ohos', 'devtools', 'windows']) {
    let canvasCreations = 0, definition;
    vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
      Component: value => { definition = value; }, wx: {
        getDeviceInfo: () => ({ platform }),
        createOffscreenCanvas: () => { canvasCreations++; return { toDataURL: () => 'data:image/jpeg;base64,x', requestAnimationFrame: () => 1, cancelAnimationFrame() {} }; }
      }, require: () => ({ createOceanRenderer: () => ({ draw() {}, dispose() {}, resize() {} }) })
    }, );
    const component = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false },
      setData(patch) { Object.assign(this.data, patch); },
      createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
    definition.lifetimes.ready.call(component);
    assert.equal(canvasCreations, 1, platform + ': the renderer is created like on iOS');
    assert.equal(component.data.staticMode, false, platform + ': not forced static');
  }
  // 关掉「首页动画」（reducedMotion）时才走静态兜底，且不建 WebGL。
  let definition, canvasCreations = 0;
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; },
    wx: { getDeviceInfo: () => ({ platform: 'android' }),
      createOffscreenCanvas: () => { canvasCreations++; return {}; } },
    require: () => ({ createOceanRenderer: () => ({ draw() {}, dispose() {}, resize() {} }) })
  });
  const off = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: true }, setData(patch) { Object.assign(this.data, patch); } };
  definition.lifetimes.ready.call(off);
  assert.equal(off.data.staticMode, true, 'animation disabled -> static fallback');
  assert.equal(canvasCreations, 0);
});


test('detached components ignore late frames and stop animation', () => {
  const f = bufferedFixture('windows');
  f.definition.lifetimes.detached.call(f.component);
  f.load('a', f.component.data.frameAId);
  assert.equal(f.component.data.frontSlot, '');
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
    _context: {drawImage(){}}, _gpuCanvas: {}, setData(v, callback) { Object.assign(this.data,v); if (callback) callback(); } };
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

test('the first ocean frame is scheduled after the home page has painted', () => {
  let definition; const timers = new Map(); let timerId = 0; let renders = 0; const frames = new Map(), serial = { n: 0 };
  const canvas = { toDataURL: () => 'data:image/jpeg;base64,pending-' + renders,
    requestAnimationFrame(fn) { frames.set(++serial.n, fn); return serial.n; }, cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; }, Date,
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    wx: { getWindowInfo: () => ({ pixelRatio: 3 }), getDeviceInfo: () => ({ platform: 'windows' }), createOffscreenCanvas: () => canvas },
    require: () => ({ createOceanRenderer: () => ({ draw() { renders++; }, dispose() {}, resize() {} }) })
  });
  const component = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false },
    setData(patch) { Object.assign(this.data, patch); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
  definition.lifetimes.ready.call(component);
  assert.equal(renders, 0, 'no WebGL context or frame on the entry frame');
  assert.equal(component.data.frameImage, '', 'the static fallback is shown first');
  assert.equal(component.data.ready, false);

  // 150ms 后再初始化，再等 120ms 出首帧。
  const init = timers.get(1); timers.delete(1);
  assert.equal(init.delay, 150);
  init.fn();
  assert.equal(renders, 0, 'still nothing drawn synchronously during init');
  const firstFrame = [...timers.entries()].find(([, timer]) => timer.delay === 120);
  assert.ok(firstFrame, 'the first frame is deferred by another 120ms');
  timers.delete(firstFrame[0]);
  firstFrame[1].fn();
  assert.equal(renders, 1);
  assert.ok(component.data.frameImage, 'the frame lands after the page has painted');

  // 卸载要清掉还没触发的初始化定时器，避免已销毁组件继续建 canvas。
  const pending = { ...definition.methods, data: { ...definition.data, active: true }, setData() {},
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec() {} }; } };
  definition.lifetimes.ready.call(pending);
  assert.equal(timers.size > 0, true);
  definition.lifetimes.detached.call(pending);
  assert.equal([...timers.values()].some(timer => timer.delay === 150), false, 'the init timer is cleared on detach');
});

test('re-enabling the animation leaves static mode and creates the renderer', () => {
  let definition, canvasCreations = 0;
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; },
    wx: { getDeviceInfo: () => ({ platform: 'android' }),
      createOffscreenCanvas: () => { canvasCreations++; return { toDataURL: () => 'data:image/jpeg;base64,x', requestAnimationFrame: () => 1, cancelAnimationFrame() {} }; } },
    require: () => ({ createOceanRenderer: () => ({ draw() {}, dispose() {}, resize() {} }) })
  });
  const component = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: true },
    setData(patch) { Object.assign(this.data, patch); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
  definition.lifetimes.ready.call(component);
  assert.equal(component.data.staticMode, true);
  assert.equal(canvasCreations, 0);
  component.data.reducedMotion = false;
  component.syncPlayback();
  assert.equal(component.data.staticMode, false, 'static mode is dropped');
  assert.equal(canvasCreations, 1, 'the renderer is created on demand');
});

test('non-iOS waits for the previous image transfer before drawing and encoding again', () => {
  for (const platform of ['android', 'ohos', 'devtools']) {
    const f = bufferedFixture(platform);
    assert.equal(f.renders(), 1);
    f.component.draw(1); f.component.draw(2);
    assert.equal(f.renders(), 1, platform + ': no overlapping frame transfer');
    f.commits.shift()();
    f.component.draw(3);
    assert.equal(f.renders(), 2, platform + ': resumes after bridge completion');
    f.definition.lifetimes.detached.call(f.component);
    f.commits.shift()();
    f.component.draw(4);
    assert.equal(f.renders(), 2, 'late callbacks cannot restart a detached renderer');
  }
});

function deferredFixture() {
  let definition, serial = 0, loads = 0, renders = 0;
  const timers = new Map(), frames = new Map();
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; }, Date,
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    wx: { getDeviceInfo: () => ({ platform: 'ohos' }), getWindowInfo: () => ({ pixelRatio: 2 }),
      createOffscreenCanvas: () => ({ toDataURL: () => 'data:image/jpeg;base64,x',
        requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
        cancelAnimationFrame(id) { frames.delete(id); } }) },
    require() { loads++; return { createOceanRenderer: () => ({ draw() { renders++; }, dispose() {} }) }; }
  });
  const c = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false },
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; },
      exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
  return { c, definition, timers, frames, loads: () => loads, renders: () => renders,
    run(delay) { const [id, timer] = [...timers].find(([, value]) => value.delay === delay); timers.delete(id); timer.fn(); return timer.fn; } };
}

test('hide cancels initialization and show resumes deferred renderer loading', () => {
  const f = deferredFixture();
  f.definition.lifetimes.ready.call(f.c);
  assert.equal(f.loads(), 0, 'particle data and shaders are not required on the entry frame');
  f.definition.pageLifetimes.hide.call(f.c);
  assert.equal(f.timers.size, 0);
  f.definition.pageLifetimes.show.call(f.c);
  f.run(150);
  assert.equal(f.loads(), 1);
  const staleStart = [...f.timers.values()][0].fn;
  f.definition.pageLifetimes.hide.call(f.c);
  assert.equal(f.timers.size, 0);
  staleStart();
  assert.equal(f.renders(), 0, 'a hidden page cannot encode the delayed first frame');
  f.definition.pageLifetimes.show.call(f.c);
  const tick = f.frames.values().next().value; f.frames.clear(); tick();
  assert.equal(f.renders(), 1, 'returning to the page resumes animation');
  assert.equal(f.c.data.ready, true, 'the resumed first frame replaces the fallback');
});

test('deferred first-frame failures fall back instead of escaping the timer', () => {
  const f = deferredFixture();
  f.definition.lifetimes.ready.call(f.c); f.run(150);
  f.c._canvas.toDataURL = () => { throw new Error('encoding failed'); };
  assert.doesNotThrow(() => f.run(120));
  assert.equal(f.c.data.failed, true);
  assert.equal(f.c._renderer, null);
  assert.equal(f.frames.size, 0);
});
