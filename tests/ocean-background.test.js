const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');

const COMPONENT = read('components/ocean-background/ocean-background.js');

/** 组件沙箱：可选 setTimeout（没有时初始化保持同步），并记录渲染器创建参数。 */
function harness(options = {}) {
  const { platform = 'windows', timers = true, requireStub } = options;
  let definition;
  let renders = 0;
  let canvasCreations = 0;
  let serial = 0;
  let timerSerial = 0;
  const drawTimes = [];
  const ratios = [];
  const pendingTimers = new Map();
  const raf = new Map();
  const canvas = {
    toDataURL: () => 'data:image/jpeg;base64,frame-' + renders,
    requestAnimationFrame(fn) { raf.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { raf.delete(id); }
  };
  const sandbox = {
    Component: value => { definition = value; }, Date,
    wx: {
      getWindowInfo: () => ({ pixelRatio: 3, windowWidth: 390, windowHeight: 844 }),
      getDeviceInfo: () => ({ platform }),
      createOffscreenCanvas: () => { canvasCreations++; return canvas; }
    },
    require: requireStub || (() => ({
      createOceanRenderer: (c, w, h, ratio) => {
        ratios.push(ratio);
        return { draw(time) { renders++; drawTimes.push(time); }, dispose() {}, resize() {} };
      }
    }))
  };
  if (timers) {
    sandbox.setTimeout = (fn, delay) => { pendingTimers.set(++timerSerial, { fn, delay }); return timerSerial; };
    sandbox.clearTimeout = id => pendingTimers.delete(id);
  }
  vm.runInNewContext(COMPONENT, sandbox);
  const commits = [];
  const component = {
    ...definition.methods,
    data: { ...definition.data, active: true, reducedMotion: false },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) commits.push(callback); },
    createSelectorQuery() {
      return { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn([{ width: 390, height: 844 }]); } };
    }
  };
  const api = {
    definition, component, commits, raf, pendingTimers, drawTimes, ratios,
    renders: () => renders,
    canvasCreations: () => canvasCreations,
    boot() { definition.lifetimes.ready.call(component); return api; },
    runTimer(delay) {
      const entry = [...pendingTimers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, 'no timer with delay ' + delay);
      pendingTimers.delete(entry[0]);
      entry[1].fn();
    },
    timerDelays: () => [...pendingTimers.values()].map(timer => timer.delay),
    tickRaf() {
      const entry = raf.entries().next().value;
      assert.ok(entry, 'no pending animation frame');
      raf.delete(entry[0]);
      entry[1]();
    },
    load(slot, id) { component.onFrameLoad({ currentTarget: { dataset: { slot, frameId: id } } }); },
    error(slot, id) { component.onFrameError({ currentTarget: { dataset: { slot, frameId: id } } }); },
    flushCommit() { const fn = commits.shift(); if (fn) fn(); }
  };
  return api;
}

test('first paint is already the full static composition: plate, device-resolution grid, vector whale', () => {
  const template = read('components/ocean-background/ocean-background.wxml');
  const css = read('components/ocean-background/ocean-background.wxss');
  assert.doesNotMatch(template, /<canvas/, 'no native canvas that could cover the home content');
  assert.match(template, /class="ocean-base"/);
  assert.match(template, /class="ocean-grid"/);
  assert.match(template, /src="\/assets\/ocean\/whale-body\.svg"/);
  assert.match(template, /src="\/assets\/ocean\/whale-tail\.svg"/);
  assert.match(template, /class="ocean-fluid \{\{ready \? 'ocean-fluid-live' : ''\}\}"/, 'the fluid frame cross-fades in only once it is ready');
  assert.match(template, /src="\{\{frameImage\}\}"/);
  // 底版是着色器 t=0 的流体场（JPEG 内联），第一帧就有完整构图，不再先显示粗糙兜底。
  assert.match(css, /\.ocean-base \{[^}]*data:image\/jpeg;base64,/);
  // 网格是矢量：42px 方格 + 瓦片方块，线宽/颜色对齐 iOS Canvas 绘制。
  assert.match(css, /\.ocean-grid \{[^}]*repeating-linear-gradient\(0deg, rgba\(255, 255, 255, 0\.043\) 0 0\.55px, transparent 0\.55px 42px\)/);
  assert.match(css, /\.ocean-grid \{[^}]*data:image\/svg\+xml;base64,/);
  assert.match(css, /\.ocean-grid \{[^}]*-webkit-mask-image: linear-gradient\(180deg/);
  // 鲸鱼是 115vw 的矢量点阵：不随帧分辨率放大而变模糊。
  assert.match(css, /\.ocean-whale \{[^}]*width: 115vw; height: 115vw/);
  assert.match(css, /\.ocean-whale \{[^}]*mix-blend-mode: screen/);
  assert.match(css, /\.ocean-whale \{[^}]*opacity: 0\.56/);
  // 尾巴重新摆动 + 逐点闪烁的近似：两张图在同一 115vw 方框内拼接，尾巴绕接缝 skewY。
  assert.match(css, /\.ocean-whale-tail \{[^}]*transform-origin: 0 50%/);
  assert.match(css, /\.ocean-whale-tail \{[^}]*animation: ocean-whale-tail-wave 2\.86s/);
  assert.match(css, /\.ocean-whale-tail \{[^}]*animation-delay: 0s, -1\.05s/);
  assert.match(css, /@keyframes ocean-whale-tail-wave \{[\s\S]*?skewY\(1\.99deg\)[\s\S]*?skewY\(-1\.99deg\)/);
  assert.match(css, /@keyframes ocean-whale-drift \{[\s\S]*?translate3d\(-2\.8px, 0, 0\)[\s\S]*?translate3d\(2\.8px, 0, 0\)/);
  assert.match(css, /@keyframes ocean-whale-shimmer/);
  assert.match(css, /\.ocean-paused \.ocean-whale-tail[^{]*\{[^}]*animation-play-state: paused/);
  assert.match(css, /\.ocean-fluid \{[^}]*transition: opacity 520ms/, 'first fluid frame eases in instead of popping');
  assert.match(css, /prefers-reduced-motion/, 'system reduce-motion still stops the decorative animations');
  assert.match(css, /ocean-settle 24s/, 'the slow settle dimmer is preserved');
  assert.match(css, /\.ocean-grain \{[^}]*background-size: 8rpx 8rpx/, 'grain is 1:1 with device pixels instead of being upscaled');
  assert.match(read('pages/home/home.wxml'), /id="home-ocean"/);
  assert.doesNotMatch(read('pages/home/home.js'), /stopWhaleAnimation|startWhaleAnimation/);
});

test('the fluid frame carries only smooth gradients and is rendered below CSS resolution', () => {
  const renderer = read('utils/ocean-renderer.js');
  assert.doesNotMatch(renderer, /ocean-particles/, 'the frame no longer ships the whale particle buffer');
  assert.doesNotMatch(renderer, /gl_PointSize|WHALE_VERTEX|WHALE_FRAGMENT|gl\.POINTS/, 'grid and whale moved to CSS/SVG layers');
  assert.doesNotMatch(renderer, /Native 42pt grid|index\.y\*11\.0/, 'technical grid is no longer rasterised into the frame');
  assert.match(renderer, /uTime\*0\.075/, 'fluid speed matches dsh-mobile');
  assert.match(renderer, /aspect\*0\.58/, 'light ribbon geometry matches dsh-mobile');
  assert.match(renderer, /Math\.max\(0\.4, Math\.min\(dpr \|\| 1, 1\.5, 1200 \/ height\)\)/, 'low-resolution frames are allowed');
});

test('the entry frame creates no WebGL and only one short deferred init timer', () => {
  const h = harness({ platform: 'windows' }).boot();
  assert.equal(h.canvasCreations(), 0, 'no WebGL context on the entry frame');
  assert.equal(h.renders(), 0);
  assert.equal(h.component.data.ready, false);
  assert.deepEqual(h.timerDelays(), [60], 'the renderer starts one short hop after first paint');

  h.runTimer(60);
  assert.equal(h.canvasCreations(), 1);
  assert.equal(h.renders(), 1, 'the first frame is encoded as soon as the renderer exists');
  assert.equal(h.component.data.ready, true);
  assert.match(h.component.data.frameImage, /^data:image\/jpeg/);
  assert.equal(h.raf.size, 1, 'the animation loop starts');
  // 立体帧只占少量像素：390x844 下约 0.7x CSS 像素（<=0.72，且像素预算内）。
  const ratio = h.ratios[0];
  assert.ok(ratio > 0.6 && ratio <= 0.72, 'fluid buffer ratio ' + ratio);
});

test('iOS keeps the previous decoded frame visible and never rewrites it', () => {
  const h = harness({ platform: 'ios' }).boot();
  h.runTimer(60);
  assert.equal(h.component.data.buffered, true);
  assert.equal(h.component.data.ready, false, 'the wrapper stays hidden until the first decode commits');
  assert.ok(h.component.data.frameA);
  h.component.draw(1);
  assert.equal(h.renders(), 1, 'wait for decode before generating another frame');
  h.load('a', h.component.data.frameAId);
  assert.equal(h.component.data.frontSlot, 'a');
  assert.equal(h.component.data.ready, true);
  h.component.draw(2);
  assert.equal(h.renders(), 1, 'wait for the view-layer swap to commit');
  h.flushCommit();
  const first = h.component.data.frameA;
  h.component.draw(3);
  assert.equal(h.component.data.frameA, first, 'the visible image is never rewritten');
  assert.equal(h.component.data.frontSlot, 'a');
  assert.ok(h.component.data.frameB);
  h.load('a', h.component.data.frameAId);
  assert.equal(h.component.data.frontSlot, 'a', 'stale callbacks are ignored');
  h.load('b', h.component.data.frameBId);
  h.flushCommit();
  h.component.draw(4);
  assert.equal(h.component.data.frontSlot, 'b');
  assert.notEqual(h.component.data.frameB, first);
});

test('non-buffered platforms gate the next frame on the previous transfer', () => {
  const h = harness({ platform: 'android' }).boot();
  h.runTimer(60);
  assert.equal(h.renders(), 1);
  h.component.draw(1); h.component.draw(2);
  assert.equal(h.renders(), 1, 'no overlapping frame transfer');
  h.flushCommit();
  h.component.draw(3);
  assert.equal(h.renders(), 2, 'resumes after the bridge completion');
  h.definition.lifetimes.detached.call(h.component);
  h.flushCommit();
  h.component.draw(4);
  assert.equal(h.renders(), 2, 'late callbacks cannot restart a detached renderer');
});

test('"home animation off" keeps the static layers and never creates WebGL', () => {
  const h = harness({ platform: 'android' }).boot();
  h.definition.lifetimes.detached.call(h.component);
  // 关闭动画的页面：reducedMotion 在 ready 前就是 true。
  const off = harness({ platform: 'android' });
  off.definition.lifetimes.ready.call(Object.assign(off.component, { data: { ...off.definition.data, active: true, reducedMotion: true } }));
  assert.equal(off.component.data.staticMode, true);
  assert.equal(off.canvasCreations(), 0);
  const template = read('components/ocean-background/ocean-background.wxml');
  assert.match(template, /staticMode \? 'ocean-static' : ''/);
});

test('turning the animation back on leaves static mode and defers renderer creation', () => {
  const h = harness({ platform: 'android' });
  h.component.data.reducedMotion = true;
  h.boot();
  assert.equal(h.component.data.staticMode, true);
  assert.equal(h.canvasCreations(), 0);
  h.component.data.reducedMotion = false;
  h.component.syncPlayback();
  assert.equal(h.component.data.staticMode, false);
  assert.equal(h.canvasCreations(), 0, 'the renderer is still deferred');
  h.runTimer(60);
  assert.equal(h.canvasCreations(), 1);
});

test('playback pauses on hide, resumes without a time jump and releases on detach', () => {
  let now = 1000;
  let definition;
  const frames = new Map();
  const draws = [];
  let id = 0;
  vm.runInNewContext(COMPONENT, {
    Component: value => { definition = value; }, Date: { now: () => now },
    wx: { getDeviceInfo: () => ({ platform: 'windows' }) },
    require: () => ({ createOceanRenderer: () => ({ draw(t) { draws.push(t); }, dispose() { draws.push('disposed'); }, resize() {} }) })
  });
  const component = {
    ...definition.methods, data: { ...definition.data, active: true, reducedMotion: false }, _visible: true, _elapsed: 0,
    _canvas: { toDataURL() { return 'data:image/jpeg;base64,test'; }, requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(target) { frames.delete(target); } },
    _renderer: { draw(t) { draws.push(t); }, dispose() { draws.push('disposed'); }, resize() {} },
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }
  };
  const tick = ms => { now += ms; const fn = frames.values().next().value; frames.clear(); if (fn) fn(); };
  component.syncPlayback();
  assert.equal(frames.size, 1);
  tick(130);
  assert.equal(draws.length, 1);
  definition.pageLifetimes.hide.call(component);
  assert.equal(frames.size, 0);
  const elapsed = component._elapsed;
  now += 60000;
  definition.pageLifetimes.show.call(component);
  tick(130);
  assert.ok(component._elapsed - elapsed < 0.2, 'the animation resumes instead of jumping 60s ahead');
  component.data.reducedMotion = true;
  component.syncPlayback();
  assert.equal(frames.size, 0, 'reduced motion stops the loop');
  definition.lifetimes.detached.call(component);
  assert.equal(draws.at(-1), 'disposed');
  assert.equal(component._renderer, null);
});

test('a failed first frame falls back to the static layers instead of escaping', () => {
  let now = 0;
  const h = harness({ platform: 'android' }).boot();
  h.runTimer(60);
  h.flushCommit();
  h.component._canvas.toDataURL = () => { throw new Error('encoding failed'); };
  assert.doesNotThrow(() => h.component.tick(), 'the animation loop catches encode errors');
  assert.equal(h.component.data.failed, true);
  assert.equal(h.component._renderer, null);
  h.component.data.ready = false;
  assert.match(read('components/ocean-background/ocean-background.wxml'), /class="ocean-base"/, 'static layers remain underneath');
});

test('detaching clears the deferred init timer so a destroyed page cannot build a canvas', () => {
  const h = harness({ platform: 'windows' }).boot();
  assert.deepEqual(h.timerDelays(), [60]);
  h.definition.lifetimes.detached.call(h.component);
  assert.deepEqual(h.timerDelays(), []);
  assert.equal(h.canvasCreations(), 0);
});

test('the whale layers ship as compact vector assets rebuilt from the upstream mask', () => {
  const layers = ['whale-body.svg', 'whale-tail.svg'].map(name => fs.statSync(path.join(__dirname, '..', 'miniprogram', 'assets', 'ocean', name)));
  const total = layers.reduce((sum, file) => sum + file.size, 0);
  assert.ok(layers.every(file => file.size > 1000), 'each whale split keeps its dots');
  assert.ok(total > 1000 && total < 26000, 'whale layers total ' + total + ' bytes');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'miniprogram', 'assets', 'ocean', 'whale-dots.svg')), false, 'the unsplit layer is replaced');
  const generator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'generate-ocean-whale-asset.cjs'), 'utf8');
  assert.match(generator, /ocean-particles/, 'the asset derives from the dsh-mobile particle mask');
  const dots = require('../miniprogram/utils/ocean-particles');
  assert.ok(dots.length > 1000 && dots.length < 3600);
  assert.ok(dots.some(p => p[0] > 0.9), 'tail extends to the right edge');
  for (const p of dots) { assert.equal(p.length, 6); assert.ok(p.every(Number.isFinite)); assert.ok(p[0] > 0 && p[0] < 1 && p[1] > 0 && p[1] < 1); }
});

test('the static poster and grid tile can be regenerated from the shader source', () => {
  const generator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'generate-ocean-layers.cjs'), 'utf8');
  assert.match(generator, /ocean-renderer\.js/, 'the poster comes from the same shader');
  assert.match(generator, /grid-tile\.svg/);
  const poster = fs.statSync(path.join(__dirname, '..', 'resources', 'artwork', 'ocean', 'fluid-poster.jpg'));
  assert.ok(poster.size > 2000 && poster.size < 20000, 'poster is ' + poster.size + ' bytes');
});
