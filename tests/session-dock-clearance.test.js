const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram/pages/session');
test('presented and edited file cards retain a 20rpx gap in either order', () => {
  const css = fs.readFileSync(path.join(root, 'session.wxss'), 'utf8');
  assert.match(css, /\.delivered-files\s*\{[^}]*gap:20rpx/);
  assert.match(css, /\.delivered-files \+ \.changed-files,[\s\S]*?\.changed-files \+ \.changed-files\s*\{\s*margin-top:20rpx;/);
});
function pageFixture(rects) {
  let definition, scrolled = 0; const ticks = [];
  const query = { select() { return this; }, boundingClientRect() { return this; }, exec(fn) { fn(rects); } };
  const store = { state: {}, sessionState: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'session.js'), 'utf8'), {
    Page: value => definition = value, setTimeout() {}, wx: { nextTick: fn => ticks.push(fn),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }), createSelectorQuery: () => ({ in: () => query }) },
    require(name) { if (name.endsWith('/store')) return store; return require(path.resolve(root, name)); }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), _convPinned: true,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }, refreshBottomAnchor() { scrolled++; } };
  return { page, flush() { while(ticks.length) ticks.shift()(); }, scrolled: () => scrolled };
}
test('real content spacer precedes bottom anchor, no native scroll-view padding dependency', () => {
  const xml = fs.readFileSync(path.join(root, 'session.wxml'), 'utf8');
  assert.ok(xml.indexOf('conversation-dock-spacer') < xml.indexOf('id="conv-bottom"'));
  assert.match(xml, /height:{{convBottomInset}}rpx/);
  const { page } = pageFixture([]);
  assert.equal(page.layoutPatch().conversationStyle, 'padding-bottom:0;');
  assert.equal(page.layoutPatch({ kbHeight: 300 }).conversationStyle, 'padding-bottom:0;margin-bottom:300px;');
});
test('clearance includes safe-area bottom gap, keyboard and live whale without double counting', () => {
  for (const [dock, view, expected] of [
    [{ height: 180, top: 598, bottom: 778 }, { bottom: 812 }, 448],
    [{ height: 260, top: 518, bottom: 778 }, { bottom: 812 }, 608],
    [{ height: 180, top: 320, bottom: 500 }, { bottom: 512 }, 404]
  ]) {
    const f = pageFixture([dock, view]); f.page.updateDockInset(); f.flush();
    assert.equal(f.page.data.convBottomInset, expected); assert.equal(f.scrolled(), 1);
    f.page._convPinned = false; f.page.data.convBottomInset = 520; f.page.updateDockInset(); f.flush();
    assert.equal(f.scrolled(), 1, 'reading old messages must not be dragged to bottom');
  }
});
