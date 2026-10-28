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
test('iOS waits for decoding and never rewrites the visible frame', () => {
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
  assert.equal(initial.component.data.ready, false, 'the first frame stays unready after an image failure');
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
  // 关掉「首页动画」（reducedMotion）时不建 WebGL。
  let definition, canvasCreations = 0;
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; },
    wx: { getDeviceInfo: () => ({ platform: 'android' }),
      createOffscreenCanvas: () => { canvasCreations++; return {}; } },
    require: () => ({ createOceanRenderer: () => ({ draw() {}, dispose() {}, resize() {} }) })
  });
  const off = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: true }, setData(patch) { Object.assign(this.data, patch); } };
  definition.lifetimes.ready.call(off);
  assert.equal(off.data.staticMode, true, 'animation disabled -> static mode');
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
  const template = read('components/ocean-background/ocean-background.wxml');
  assert.doesNotMatch(template, /<canvas|ocean-fallback/);
  assert.match(template, /src="{{frameImage}}"/);
  assert.match(read('components/ocean-background/ocean-background.wxss'), /\.ocean-background \{[^}]*background: linear-gradient\(180deg, #1D3A6B 0%, #17315B 38%, #0D2044 68%, #07182b 100%\)/);
  assert.match(read('pages/home/home.wxss'), /\.home-deep-bg \{[^}]*background: linear-gradient\(180deg, #1D3A6B 0%, #17315B 38%, #0D2044 68%, #07182b 100%\)/);
  assert.match(read('components/ocean-background/ocean-background.js'), /createOffscreenCanvas/);
  assert.match(read('components/ocean-background/ocean-background.wxss'), /prefers-reduced-motion/);
  assert.match(read('components/ocean-background/ocean-background.wxss'), /ocean-settle 24s/);
  assert.match(read('pages/home/home.wxml'), /id="home-ocean"/);
  assert.doesNotMatch(read('pages/home/home.js'), /stopWhaleAnimation|startWhaleAnimation/);
});

test('home controls get a render turn before ocean WebGL initialization', () => {
  let definition, startRendering; let renders = 0; const frames = new Map(), serial = { n: 0 };
  const canvas = { toDataURL: () => 'data:image/jpeg;base64,pending-' + renders,
    requestAnimationFrame(fn) { frames.set(++serial.n, fn); return serial.n; }, cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; }, Date,
    wx: { nextTick(fn) { startRendering = fn; }, getWindowInfo: () => ({ pixelRatio: 3 }), getDeviceInfo: () => ({ platform: 'windows' }), createOffscreenCanvas: () => canvas },
    require: () => ({ createOceanRenderer: () => ({ draw() { renders++; }, dispose() {}, resize() {} }) })
  });
  const component = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false },
    setData(patch) { Object.assign(this.data, patch); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
  definition.lifetimes.ready.call(component);
  assert.equal(renders, 0, 'shader compilation does not block the initial home render');
  assert.equal(component.data.frameImage, '');
  startRendering();
  assert.equal(renders, 1);
  assert.ok(component.data.frameImage, 'the first frame is drawn on the next view tick');
  assert.equal(component.data.ready, true);

  // A pending layout query is invalidated when the component detaches.
  const pending = { ...definition.methods, data: { ...definition.data, active: true }, setData() {},
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec() {} }; } };
  definition.lifetimes.ready.call(pending);
  assert.equal(pending._initRequest, undefined, 'pending initialization has not started before nextTick');
  startRendering();
  assert.ok(pending._initRequest);
  definition.lifetimes.detached.call(pending);
  assert.equal(pending._initRequest, null);
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
  const canvas = { toDataURL: () => 'data:image/jpeg;base64,x',
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); } };
  vm.runInNewContext(read('components/ocean-background/ocean-background.js'), {
    Component: value => { definition = value; }, Date,
    setTimeout(fn, delay) { timers.set(++serial, { fn, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); },
    wx: { getDeviceInfo: () => ({ platform: 'ohos' }), getWindowInfo: () => ({ pixelRatio: 2 }),
      createOffscreenCanvas: () => canvas },
    require() { loads++; return { createOceanRenderer: () => ({ draw() { renders++; }, dispose() {} }) }; }
  });
  const c = { ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false },
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; },
      exec(fn) { fn([{ width: 390, height: 844 }]); } }; } };
  return { c, definition, timers, frames, canvas, loads: () => loads, renders: () => renders,
    run(delay) { const [id, timer] = [...timers].find(([, value]) => value.delay === delay); timers.delete(id); timer.fn(); return timer.fn; } };
}

test('hiding stops playback and showing resumes the renderer', () => {
  const f = deferredFixture();
  f.definition.lifetimes.ready.call(f.c);
  assert.equal(f.loads(), 1, 'renderer initialization starts immediately');
  assert.equal(f.renders(), 1, 'the first frame is drawn before ready returns');
  f.definition.pageLifetimes.hide.call(f.c);
  assert.equal(f.frames.size, 0);
  f.definition.pageLifetimes.show.call(f.c);
  f.definition.pageLifetimes.hide.call(f.c);
  assert.equal(f.frames.size, 0, 'a hidden page stops its animation loop');
  f.definition.pageLifetimes.show.call(f.c);
  const tick = f.frames.values().next().value; f.frames.clear(); tick();
  assert.equal(f.renders(), 2, 'returning to the page resumes animation');
  assert.equal(f.c.data.ready, true, 'the resumed first frame becomes visible');
});

test('deferred first-frame failures are caught and stop animation', () => {
  const f = deferredFixture();
  f.canvas.toDataURL = () => { throw new Error('encoding failed'); };
  assert.doesNotThrow(() => f.definition.lifetimes.ready.call(f.c));
  assert.equal(f.c.data.failed, true);
  assert.equal(f.c._renderer, null);
  assert.equal(f.frames.size, 0);
});
