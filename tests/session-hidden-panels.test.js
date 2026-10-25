const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');

// WeChat pitfall: a CSS `display` declaration beats the `hidden` attribute, so an
// element that is `hidden` in WXML but carries `display: flex` in CSS stays on
// screen. The dock is `position: fixed; z-index: 60`, so when it leaked it covered
// the bottom of the context and fleet panels.
test('every hidden element with a CSS display opts out explicitly', () => {
  // 逐个看带 hidden 的元素本身，而不是把 class 名汇总——否则分不清是谁被保护的。
  const hiddenViews = [...wxml.matchAll(/<view[^>]*\shidden="[^"]*"[^>]*class="([^"]+)"[^>]*>/g)];
  assert.ok(hiddenViews.length > 0, 'the fixture must contain hidden views');
  let checked = 0;
  for (const m of hiddenViews) {
    const classAttr = m[1];
    for (const cls of classAttr.replace(/\{\{|\}\}/g, ' ').split(/\s+/)) {
      if (!cls || cls.includes('?')) continue;
      if (!new RegExp('\\.' + cls + '(?![\\w-])[^{]*\\{[^}]*display:\\s*[a-z]').test(wxss)) continue;
      checked += 1;
      // 两条合法的逃生通道：WXML 里按条件挂 session-panel-hidden，或 CSS 里写 [hidden]。
      const guardedByClass = /session-panel-hidden/.test(classAttr);
      const guardedByCss = new RegExp('\\.' + cls + '\\[hidden\\]\\s*\\{[^}]*display:\\s*none\\s*!important').test(wxss);
      assert.ok(guardedByClass || guardedByCss,
        `${cls} is hidden in WXML but its CSS display would keep it visible`);
    }
  }
  assert.ok(checked > 0, 'the fixture must actually contain hidden+display elements');
});

test('the dock is hidden on the context and fleet tabs', () => {
  assert.match(wxml, /<view hidden="\{\{tab !== 'conversation'\}\}" class="dock-stack/,
    'the dock is hidden off the conversation tab');
  assert.match(wxss, /\.dock-stack\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'and its CSS display must not win over hidden');
});

test('context toolbar actions appear after the context panel finishes loading', () => {
  const toolbar = wxml.match(/<view class="context-toolbar">([\s\S]*?)<\/view>\s*<scroll-view class="context-scroll"/);
  assert.ok(toolbar, 'the context toolbar fixture must exist');
  const actions = [...toolbar[1].matchAll(/<view\b[^>]*bindtap="(?:openContextModal|openContextInsights)"[^>]*>/g)];
  assert.equal(actions.length, 2, 'both context actions must be present');
  for (const [action] of actions) {
    assert.match(action, /wx:if="\{\{contextPanel && contextPanel\.status !== 'loading'\}\}"/,
      'context actions stay hidden while the panel is loading');
  }
});
