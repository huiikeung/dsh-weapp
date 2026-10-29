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
  const query = { select() { return this; }, boundingClientRect() { return this; }, scrollOffset() { return this; }, exec(fn) { fn(rects); } };
  const store = { state: {}, sessionState: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'session.js'), 'utf8'), {
    Page: value => definition = value, setTimeout() {}, wx: { nextTick: fn => ticks.push(fn),
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }), createSelectorQuery: () => ({ in: () => query }) },
    require(name) { if (name.endsWith('/store')) return store; return require(path.resolve(root, name)); }
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), _convPinned: true,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); }, refreshBottomAnchor() { scrolled++; } };
  return { page, flush() { while(ticks.length) ticks.shift()(); }, scrolled: () => scrolled,
    refreshBottomAnchor: definition.refreshBottomAnchor };
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
  page._lastScrollTop = 1000;
  page.applyScrollPosition({scrollTop:900,scrollHeight:1400,clientHeight:400});
  assert.equal(page.data.showJump,true);assert.equal(page._convPinned,false);
  page.applyScrollPosition({scrollTop:1000,scrollHeight:1400,clientHeight:400});
  assert.equal(page.data.showJump,false);assert.equal(page._convPinned,true);
  const css = fs.readFileSync(path.join(root, 'session.wxss'),'utf8');
  assert.match(css,/\.jump-wrap\s*\{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 16rpx\)/);
});
test('one-tap bottom control appears as soon as the reader manually leaves latest messages', () => {
  const { page } = pageFixture([]);
  page.data.rows = [{ key: 'message-1' }];
  page.onPanelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
  page.onPanelTouchMove({ touches: [{ clientX: 100, clientY: 120 }] });
  page.applyScrollPosition({ scrollTop: 900, scrollHeight: 1400, clientHeight: 400 });
  assert.equal(page.data.showJump, true);

  const xml = fs.readFileSync(path.join(root, 'session.wxml'), 'utf8');
  assert.match(xml, /wx:if="\{\{showJump && rows\.length\}\}" class="jump-wrap"/);
  assert.match(xml, /class="jump-bottom" bindtap="jumpToBottom"/);
  page.jumpToBottom();
  assert.equal(page.data.showJump, false, 'the same control clears when the conversation returns to bottom');
});
test('vertical gestures pause live follow in either direction until the reader reaches the bottom', () => {
  const { page } = pageFixture([]);
  page.data.scrollTarget = 'conv-bottom';
  page._lastScrollTop = 1000;
  page.onPanelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
  page.onPanelTouchMove({ touches: [{ clientX: 100, clientY: 60 }] });
  assert.equal(page._followPausedByUser, true);
  assert.equal(page._convPinned, false);
  assert.equal(page.data.scrollTarget, '', 'manual vertical movement cancels a persistent bottom anchor');

  page.onPanelTouchEnd({ changedTouches: [{ clientX: 100, clientY: 60 }] });
  page.applyScrollPosition({ scrollTop: 1000, scrollHeight: 1400, clientHeight: 400 });
  assert.equal(page._followPausedByUser, true, 'a live update at the old bottom does not resume follow');
  assert.equal(page._convPinned, false);

  page._lastScrollTop = 800;
  page.applyScrollPosition({ scrollTop: 1000, scrollHeight: 1400, clientHeight: 400 });
  assert.equal(page._followPausedByUser, true, 'polling a growing viewport cannot impersonate a reader scroll');
  page.updateConversationWindow = () => {};
  page.maybePrefetchOlderHistory = () => {};
  page._lastScrollTop = 800;
  page.onConvScroll({ detail: { scrollTop: 1000, scrollHeight: 1400, clientHeight: 400 } });
  assert.equal(page._followPausedByUser, false, 'following resumes only when the reader moves back to the bottom');
  assert.equal(page._convPinned, true);
});
test('vertical conversation gestures keep viewport ownership through momentum settling', () => {
  const { page } = pageFixture([]);
  page.data.tab = 'conversation';
  page.onPanelTouchStart({ touches: [{ clientX: 100, clientY: 200 }] });
  page.onPanelTouchMove({ touches: [{ clientX: 100, clientY: 160 }] });
  const movedAt = page._lastConversationGestureAt;
  assert.ok(movedAt > 0, 'vertical movement starts the settle window');

  page.onPanelTouchEnd({ changedTouches: [{ clientX: 100, clientY: 160 }] });
  assert.ok(page._lastConversationGestureAt >= movedAt, 'touch release keeps the guard active for momentum');

  page.onConvTouch();
  assert.equal(page._lastConversationGestureAt, 0,
    'a new tap clears the old gesture guard so disclosure measurements stay immediate');
});
test('native upward movement pauses live follow even when touch events are swallowed', () => {
  const f = pageFixture([]), page = f.page;
  page._convPinned = true;
  page._followPausedByUser = false;
  page._lastNativeScrollTop = 1000;
  page._lastScrollTop = 1000;
  page._suppressScrollUntil = Date.now() + 500;
  page.data.scrollTarget = 'conv-bottom';
  page.updateConversationWindow = () => {};
  page.maybePrefetchOlderHistory = () => {};

  // Some WeChat scroll-view implementations emit native scroll without
  // bubbling touchstart/touchmove from the scroll surface.
  page.onConvScroll({ detail: { scrollTop: 970, scrollHeight: 1400, clientHeight: 400 } });

  assert.equal(page._followPausedByUser, true);
  assert.equal(page._convPinned, false, 'a small upward move beats the near-bottom threshold');
  assert.equal(page.data.scrollTarget, '', 'native reader movement cancels a pending tail anchor');
  page.refreshBottomAnchor = f.refreshBottomAnchor;
  page.refreshBottomAnchor();
  f.flush();
  assert.equal(page.data.scrollTarget, '', 'stream updates cannot reclaim the viewport after a touch event was lost');
});
test('native momentum updates the manual gesture settling timestamp', () => {
  const { page } = pageFixture([]);
  page._convPinned = false;
  page._lastNativeScrollTop = 1000;
  page._lastScrollTop = 1000;
  page.updateConversationWindow = () => {};
  page.maybePrefetchOlderHistory = () => {};

  page.onConvScroll({ detail: { scrollTop: 970, scrollHeight: 1400, clientHeight: 400 } });
  assert.ok(page._lastConversationGestureAt > 0,
    'a native reader movement starts protection even without touch events');
  const firstMoveAt = page._lastConversationGestureAt;
  page.onConvScroll({ detail: { scrollTop: 940, scrollHeight: 1400, clientHeight: 400 } });
  assert.ok(page._lastConversationGestureAt >= firstMoveAt,
    'continued inertia keeps the protection window fresh');
});
test('entry anchoring survives the native clamp that follows scroll-into-view', () => {
  // 回归：进入会话时 scroll-into-view 先落到估算底部，随后真实布局把 scrollTop 向上
  // 钳制一点。这次向上移动曾被判定成「读者意图」，跟随当场停掉，页面停在半途——
  // 正是「进入页面定位不到最底部」。
  const { page } = pageFixture([]);
  page._convPinned = true;
  page._followPausedByUser = false;
  page._initialConversationAnchorApplied = true;
  page._scrollAnchorAt = Date.now();
  page._lastNativeScrollTop = 1200;
  page._lastScrollTop = 1200;
  page.data.scrollTarget = 'conv-bottom';
  page.updateConversationWindow = () => {};
  page.maybePrefetchOlderHistory = () => {};

  page.onConvScroll({ detail: { scrollTop: 1120, scrollHeight: 1400, clientHeight: 400 } });

  assert.equal(page._followPausedByUser, false, 'the entry clamp is not reader intent');
  assert.equal(page._convPinned, true, 'the conversation stays pinned to the tail while anchoring');
  assert.equal(page.data.scrollTarget, 'conv-bottom', 'the pending tail anchor survives the clamp');

  // 真有手指在滑时不受豁免保护。
  page.onConvTouch();
  page.onConvScroll({ detail: { scrollTop: 1040, scrollHeight: 1400, clientHeight: 400 } });
  assert.equal(page._followPausedByUser, true, 'a real finger scroll still pauses the follow');
  assert.equal(page._convPinned, false);
});
test('programmatic scroll corrections do not masquerade as reader intent', () => {
  const { page } = pageFixture([]);
  page._convPinned = true;
  page._lastNativeScrollTop = 1000;
  page._lastScrollTop = 1000;
  page._programmaticScrollAt = Date.now();
  page._programmaticScrollTop = 900;
  page.updateConversationWindow = () => {};
  page.maybePrefetchOlderHistory = () => {};

  page.onConvScroll({ detail: { scrollTop: 900, scrollHeight: 1400, clientHeight: 400 } });

  assert.equal(page._followPausedByUser, undefined);
  assert.equal(page._convPinned, false, 'the programmatic offset is measured 100px above the bottom');
  page.onConvScroll({ detail: { scrollTop: 880, scrollHeight: 1400, clientHeight: 400 } });
  assert.equal(page._followPausedByUser, true, 'a following user gesture is still detected immediately');
});
test('empty and status states fill the viewport instead of scrolling', () => {
  const css = fs.readFileSync(path.join(root, 'session.wxss'), 'utf8');
  const xml = fs.readFileSync(path.join(root, 'session.wxml'), 'utf8');
  // 空态/加载/失败态用 flex 铺满可视对话区（跟随 .conversation-inner 的 min-height:100%），
  // 不再用 100vh 魔数撑出滚动；没有内容就不显示"回到底部"箭头。
  assert.match(css, /\.conv-empty,\s*\.conv-state\s*\{[^}]*flex:\s*1 1 auto/);
  assert.doesNotMatch(css, /min-height:\s*calc\(100vh - 420rpx\)/);
  assert.match(xml, /<view wx:if="\{\{showJump && rows\.length\}\}" class="jump-wrap">/);
});
test('growing content and intermediate scroll positions retain following until the user scrolls up', () => {
  const f = pageFixture([]), page = f.page;
  page._lastScrollTop = 1000;
  page._suppressScrollUntil = Date.now() + 500;
  page.applyScrollPosition({scrollTop:1000,scrollHeight:1700,clientHeight:400});
  assert.equal(page._convPinned, true);
  page._suppressScrollUntil = 0;
  page.applyScrollPosition({scrollTop:1000,scrollHeight:1700,clientHeight:400});
  assert.equal(page._convPinned, true); assert.equal(f.scrolled(), 1);
  page.onConvTouch();
  page.applyScrollPosition({scrollTop:850,scrollHeight:1700,clientHeight:400});
  assert.equal(page._convPinned, false); assert.equal(page.data.showJump, true);
  page.jumpToBottom();
  assert.equal(page._convPinned, true); assert.equal(page._lastTouchAt, 0); assert.equal(page.data.showJump, false);
});
test('scroll events without viewport height use the last measured viewport', () => {
  const {page} = pageFixture([]);
  page.onConvScroll({detail:{scrollTop:1000,scrollHeight:1400}});
  assert.equal(page._convPinned, true);
  page.applyScrollPosition({scrollTop:1000,scrollHeight:1400,clientHeight:400});
  page.onConvTouch(); page.onConvScroll({detail:{scrollTop:800,scrollHeight:1400}});
  assert.equal(page._convPinned, false);
  const xml = fs.readFileSync(path.join(root, 'session.wxml'), 'utf8');
  assert.match(xml, /scroll-into-view="\{\{scrollTarget\}\}"\s+scroll-with-animation="\{\{scrollAnim\}\}"/);
});
test('idle conversation measures viewport height so scroll events without clientHeight can show the arrow', () => {
  const f = pageFixture([
    { height: 400 },
    { scrollTop: 1000, scrollHeight: 1400 },
    { height: 1400 }
  ]);
  const page = f.page;
  page.data.rows = [{ key: 'message-1' }];
  page.measureConversationViewport();
  assert.equal(page._convClientHeight, 400);

  page.onPanelTouchStart({ touches: [{ clientX: 100, clientY: 100 }] });
  page.onPanelTouchMove({ touches: [{ clientX: 100, clientY: 120 }] });
  page.onConvScroll({ detail: { scrollTop: 900, scrollHeight: 1400 } });
  assert.equal(page.data.showJump, true);
});
