const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const statusAppearance = require('../miniprogram/utils/status-appearance');

// 打开「对话状态条」弹层时，canvas 是 setData 之后立刻查询的，往往还没渲染出来。
// 拿不到节点必须短退避重试，否则鲸尾图标要等 10s 后的重置拍才补上，看着就是"不显示"。
function fixture() {
  const file = path.join(__dirname, '..', 'miniprogram', 'pages', 'settings', 'settings.js');
  const definition = {};
  const timers = [];
  const intervals = [];
  let serial = 0;
  let queries = 0;
  let drawn = 0;
  const ctx = { clearRect() {}, drawImage() { drawn += 1; }, fillRect() {}, setTransform() {}, globalCompositeOperation: '' };
  const canvas = {
    width: 0, height: 0, getContext: () => ctx,
    createImage() {
      const image = { src: '' };
      Object.defineProperty(image, 'src', {
        set(value) { this._src = value; if (this.onload) this.onload(); },
        get() { return this._src; }
      });
      return image;
    },
    requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}
  };
  const query = {
    select() { return query; },
    fields() { return query; },
    exec(done) {
      queries += 1;
      // 前两次查询模拟"弹层刚打开、画布尚未渲染"：返回空节点。
      done(queries > 2 ? [{ node: canvas, width: 14, height: 14 }] : [{}]);
    }
  };
  const wx = {
    getStorageSync: () => undefined, setStorageSync() {}, removeStorageSync() {},
    showToast() {}, showModal() {}, showActionSheet() {}, navigateTo() {}, navigateBack() {}, reLaunch() {},
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44, pixelRatio: 3 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
    nextTick(fn) { fn(); }, setNavigationBarTitle() {},
    createSelectorQuery() { return { in() { return query; } }; }
  };
  const context = { module: { exports: {} }, Page: value => { Object.assign(definition, value); }, wx,
    console, Date, Object, String, Number, Math, Promise, Array, JSON, RegExp, Error, Set, Map, parseInt, parseFloat, isNaN,
    setTimeout(fn, delay) { const id = ++serial; timers.push({ id, fn, delay }); return id; },
    clearTimeout(id) { const index = timers.findIndex(item => item.id === id); if (index >= 0) timers.splice(index, 1); },
    setInterval(fn, delay) { const id = ++serial; intervals.push({ id, fn, delay }); return id; },
    clearInterval(id) { const index = intervals.findIndex(item => item.id === id); if (index >= 0) intervals.splice(index, 1); },
    require: name => {
      if (name.endsWith('/status-appearance')) return statusAppearance;
      if (name.endsWith('/proc-icon-style')) return require('../miniprogram/utils/proc-icon-style');
      if (name.endsWith('/theme')) return require('../miniprogram/utils/theme');
      if (name.endsWith('/haptics')) return require('../miniprogram/utils/haptics');
      return require(path.join(path.dirname(file), name));
    } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return {
    page, canvas, ctx,
    get queries() { return queries; },
    get drawn() { return drawn; },
    get intervals() { return intervals; },
    runTimers() { let guard = 0; while (timers.length && guard < 80) timers.shift().fn(); },
    tick() { intervals[intervals.length - 1].fn(); }
  };
}

test('opening the status-style sheet retries until every whale canvas is measured', () => {
  const f = fixture();
  f.page.data.statusStyleChoices = statusAppearance.choices();
  f.page.data.statusStyleSheetOpen = true;
  f.page.startStatusPreviews();
  // 首轮 6 个画布全部量不到，只查询一次是补不上的
  assert.equal(f.queries, 6, 'the first pass queries all six canvases');
  assert.equal(f.page._statusPreviews.every(state => state.ready), false);
  f.runTimers();
  assert.ok(f.queries > 6, 'a short-backoff retry re-queries the missing canvases');
  assert.equal(f.page._statusPreviews.length, 6);
  assert.equal(f.page._statusPreviews.every(state => state.ready), true, 'every preview becomes ready');
  assert.equal(f.page._statusPreviews.every(state => !!state.image), true, 'the whale sprite loads for every style');
});

test('each status style paints its own tinted whale sprite', () => {
  const f = fixture();
  f.page.data.statusStyleChoices = statusAppearance.choices();
  f.page.data.statusStyleSheetOpen = true;
  f.page.startStatusPreviews();
  f.runTimers();
  const before = f.drawn;
  f.tick(); f.tick(); f.tick();
  assert.ok(f.drawn - before >= 6, 'all six styles draw on every tick, got ' + (f.drawn - before));
});

test('closing the sheet stops the ticker and drops pending retries', () => {
  const f = fixture();
  f.page.data.statusStyleChoices = statusAppearance.choices();
  f.page.data.statusStyleSheetOpen = true;
  f.page.startStatusPreviews();
  f.page.stopStatusPreviews();
  assert.equal(f.page._statusPreviews, null);
  assert.equal(f.page._statusPreviewRetry, null, 'a pending retry must not outlive the sheet');
  assert.equal(f.intervals.length, 0);
});
