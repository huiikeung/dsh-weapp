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
test('whale stays in conversation flow with the viewport above the composer', () => {
  const xml = fs.readFileSync(path.join(root, 'session.wxml'), 'utf8');
  assert.doesNotMatch(xml, /conversation-dock-spacer|dock-progress/);
  assert.ok(xml.indexOf('conversation-progress') < xml.indexOf('id="conv-bottom"'));
  assert.ok(xml.indexOf('id="conv-bottom"') < xml.indexOf('class="dock-stack'));
  const { page } = pageFixture([]);
  assert.equal(page.data.conversationStyle, 'padding-bottom:0;margin-bottom:520rpx;');
  assert.equal(page.layoutPatch({ kbHeight: 300 }).conversationStyle, 'padding-bottom:0;margin-bottom:calc(520rpx + 300px);');
});
test('viewport clearance includes safe area and keyboard without feedback or double counting', () => {
  for (const [dock, keyboard, expected] of [
    [{ height: 180, top: 598, bottom: 778 }, 0, 440],
    [{ height: 260, top: 518, bottom: 778 }, 0, 600],
    [{ height: 180, top: 320, bottom: 500 }, 300, 396]
  ]) {
    const f = pageFixture([dock]); f.page.data.kbHeight = keyboard; f.page.updateDockInset(); f.flush();
    assert.equal(f.page.data.convBottomInset, expected); assert.equal(f.scrolled(), 1);
    assert.ok(f.page.data.conversationStyle.includes(expected + 'rpx'));
    f.page.updateDockInset(); f.flush();
    assert.equal(f.scrolled(), 1, 'remeasuring a clipped viewport must not oscillate');
    f.page._convPinned = false; f.page.data.convBottomInset = 520; f.page.updateDockInset(); f.flush();
    assert.equal(f.scrolled(), 1, 'reading old messages must not be dragged to bottom');
  }
});
test('jump arrow follows real content end, not former transparent dock area', () => {
  const { page } = pageFixture([]);
  page.applyScrollPosition({scrollTop:900,scrollHeight:1400,clientHeight:400});
  assert.equal(page.data.showJump,true);assert.equal(page._convPinned,false);
  page.applyScrollPosition({scrollTop:1000,scrollHeight:1400,clientHeight:400});
  assert.equal(page.data.showJump,false);assert.equal(page._convPinned,true);
  const css = fs.readFileSync(path.join(root, 'session.wxss'),'utf8');
  assert.match(css,/\.jump-wrap\s*\{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 16rpx\)/);
});
