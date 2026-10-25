// 上下文 / 编队页底部那条「黑色遮罩」的回归测试。
//
// 成因：微信里 scroll-view 的 padding-bottom 不计入可滚动内容，是视口外的一条死区。
// 之前把 calc(40rpx + env(safe-area-inset-bottom)) 写在 .context-scroll / .fleet-scroll 上，
// 结果面板底部留出一条页面底色的空条（深色主题下就是约 98rpx 的纯黑边），
// 内容还会提前被裁掉。底部留白必须交给滚动内容里的 .ctx-bottom-space。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../miniprogram');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');

const rule = (selector) => {
  const found = wxss.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(found, selector + ' must exist');
  return found[1].replace(/\s+/g, ' ');
};

test('the context and fleet scrollers keep no dead bottom padding', () => {
  for (const selector of ['.context-scroll', '.fleet-scroll']) {
    const body = rule(selector);
    assert.match(body, /padding:\s*\d+rpx \d+rpx 0;/, selector + ' ends with no bottom padding');
    assert.ok(!/inset-bottom/.test(body), selector + ' must not reserve the safe area in its padding');
  }
});

test('the bottom breathing room rides inside the scroll content', () => {
  const spacer = rule('.ctx-bottom-space');
  assert.match(spacer, /height:\s*calc\(24rpx \+ env\(safe-area-inset-bottom\)\)/,
    'the in-flow spacer carries the safe-area inset');
  // 两个面板的滚动内容末尾都要有这个占位块，否则最后一张卡片会贴住 Home 指示条。
  assert.equal((wxml.match(/class="ctx-bottom-space"/g) || []).length, 2,
    'both panels end with the in-flow spacer');
  const ctxScroll = wxml.indexOf('class="context-scroll"');
  const ctxSpacer = wxml.indexOf('class="ctx-bottom-space"');
  assert.ok(ctxScroll > 0 && ctxSpacer > ctxScroll, 'the context spacer sits inside its scroll-view');
});

test('the final @ mention candidate can scroll clear of the fixed composer', () => {
  const scrollStart = wxml.indexOf('class="file-mention-scroll"');
  const scrollEnd = wxml.indexOf('</scroll-view>', scrollStart);
  const spacer = wxml.indexOf('class="file-mention-bottom-space"');
  assert.ok(scrollStart > 0 && spacer > scrollStart && spacer < scrollEnd,
    'the mention spacer must be inside the candidate scroll-view after all entries');
  const spacerStyle = rule('.file-mention-bottom-space');
  assert.match(spacerStyle, /height:\s*180rpx/, 'the in-flow spacer lets the final row clear the composer');
  assert.match(rule('.file-mention-scroll'), /padding:\s*6rpx 10rpx 0;/,
    'bottom clearance must be scrollable content, not scroll-view padding');
});
