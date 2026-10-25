// /context 等价弹窗 ⇄ dsh-context v0.74.0 契约（spec-fleet.md §9）。
//
// 页面里没有斜杠命令，入口放上下文工具栏；弹窗 = 底部抽屉（90vh），
// 内容是 Current Composition + Context Browser 概览；
// 关闭 = 点遮罩 / 右上 ×；点类别行则关闭弹窗回到页面浏览器卡片并展开该类别。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');

test('modal is a 90vh bottom sheet with a scrollable body', () => {
  assert.match(wxss, /\.ctx-modal-mask\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*300;[^}]*rgba\(0,\s*0,\s*0,\s*\.45\)/);
  assert.match(wxss, /\.ctx-modal-mask\s*\{[^}]*align-items:\s*flex-end/);
  assert.match(wxss, /\.ctx-modal\s*\{[^}]*width:\s*100vw[^}]*height:\s*90vh[^}]*max-height:\s*90vh[^}]*border-radius:\s*24rpx 24rpx 0 0/);
  assert.match(wxss, /\.ctx-modal\s*\{[^}]*padding:\s*0 36rpx calc\(36rpx \+ env\(safe-area-inset-bottom\)\)/);
  // height:0 是滚动生效的关键：缺了它微信会把 scroll-view 撑成内容高度，
  // 超过 max-height 后被裁掉且滚不动（弹窗内容“显示不全”的根因）。
  assert.match(wxss, /\.ctx-modal-body\s*\{[^}]*flex:\s*1;\s*height:\s*0;\s*min-height:\s*0/);
  assert.match(wxml, /class="ctx-modal-mask" bindtap="closeContextModal"/);
  assert.match(wxml, /class="ctx-modal-close" bindtap="closeContextModal"/);
  // 对话回合页脚：复制钮之后接上下文跳转入口（对齐 dsh-context reply-row jump 的 JumpIcon）
  assert.equal((wxml.match(/bindtap="contextJumpFromChat"/g) || []).length, 3,
    'every assistant turn footer carries a context jump action');
  for (const icon of ['context-jump.svg', 'context-jump-dark.svg']) {
    const file = path.join(root, 'assets/icons', icon);
    assert.ok(fs.existsSync(file), 'jump icon asset exists: ' + icon);
    // 三条是实心矩形；用 stroke 描边时在 28rpx 下一圈描边就把中间填满，看着是空心框。
    const svg = fs.readFileSync(file, 'utf8');
    assert.ok(!/stroke/.test(svg), 'jump icon bars are solid fills, not strokes: ' + icon);
    assert.equal((svg.match(/<rect/g) || []).length, 3, 'jump icon is three bars: ' + icon);
  }
});

test('the sheet carries a drag handle that drags down to close', () => {
  // 抓手在标题上方：44rpx 抓取区 + 居中的 72×8 小横杠
  assert.match(wxml, /class="ctx-modal-grab" bindtouchstart="onContextModalGrabStart" catchtouchmove="onContextModalGrabMove" bindtouchend="onContextModalGrabEnd"/);
  assert.match(wxml, /<view class="ctx-modal-grab-bar"><\/view>/);
  assert.ok(wxml.indexOf('ctx-modal-grab') < wxml.indexOf('ctx-modal-head'), 'the handle sits above the title');
  // 拖动靠 transform 跟手，松手回弹或滑出
  assert.match(wxml, /class="ctx-modal" style="\{\{ctxModalDragStyle\}\}"/);
  assert.match(wxss, /\.ctx-modal\s*\{[^}]*transition:\s*transform \.18s ease/);
  assert.match(wxss, /\.ctx-modal-grab\s*\{[^}]*height:\s*44rpx[^}]*justify-content:\s*center/);
  assert.match(wxss, /\.ctx-modal-grab-bar\s*\{[^}]*width:\s*72rpx;\s*height:\s*8rpx;\s*border-radius:\s*999rpx/);
  assert.match(session, /onContextModalGrabStart\(e\)\s*\{[\s\S]*?touch\.clientY/);
  assert.match(session, /onContextModalGrabMove\(e\)\s*\{[\s\S]*?transform:translateY\(' \+ offset \+ 'px\)/);
  // 过阈值才关：先滑出再卸载，避免整块闪没
  assert.match(session, /onContextModalGrabEnd\(\)\s*\{[\s\S]*?offset >= 96[\s\S]*?translateY\(110%\)[\s\S]*?closeContextModal\(\)/);
  // 定时器与会话销毁都要清理，避免在已卸载页面上 setData
  assert.match(session, /clearContextModalDrag\(\)\s*\{[\s\S]*?clearTimeout\(this\._ctxModalCloseTimer\)/);
  assert.match(session, /onUnload\(\)\s*\{[\s\S]*?clearContextModalDrag\(\)/);
});

test('modal composes Current Composition and the browser overview', () => {
  const body = wxml.slice(wxml.indexOf('class="ctx-modal"'));
  assert.match(body, /ctx-overview-num/);
  assert.match(body, /ctx-compose-bar/);
  assert.match(body, /ctx-compose-trigger/);
  assert.match(body, /ctx-slice-grid/);
  assert.match(body, /ctx-browser-picker/);
  assert.match(body, /data-base="step"/);
  assert.match(body, /data-base="turn"/);
  assert.match(body, /ctx-modal-cats/);
  // 类别行沿用页面浏览器的双 delta / token / 占比结构。
  assert.match(body, /ctx-br-count/);
  assert.match(body, /ctx-br-delta ctx-delta-\{\{item\.countDeltaClass\}\}/);
  assert.match(body, /ctx-br-token/);
  assert.match(body, /ctx-br-pct/);
});

test('page handlers open/close the modal and hand category taps back to the browser card', () => {
  assert.match(session, /openContextModal\(\)\s*\{[\s\S]*?contextModalOpen:\s*true/);
  assert.match(session, /closeContextModal\(\)\s*\{[\s\S]*?contextModalOpen:\s*false/);
  assert.match(session, /contextModalCategoryTap\(e\)[\s\S]*?contextModalOpen:\s*false[\s\S]*?setContextBrowser\([\s\S]*?jumpContextTo\('ctxBrowserCard'\)/);
  assert.match(wxml, /class="context-modal-open" bindtap="openContextModal"/);
  // 打开时收起跳到底部的胶囊，避免两个浮层叠在一起。
  assert.match(session, /openContextModal\(\)[\s\S]*?showJump:\s*false/);
  // 会话切换时弹窗必须关闭。
  assert.match(session, /contextModalOpen:\s*false[\s\S]*?contextBrowserBase:\s*contextPreferences\.read\(\)\.base/);
});
