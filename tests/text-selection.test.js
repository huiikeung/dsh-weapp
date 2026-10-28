const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');

test('conversation long-press opens the selectable text sheet', () => {
  const wxml = read('pages/session/session.wxml');
  // User bubble and assistant markdown body both expose the long-press entry.
  assert.match(wxml, /class="row-user-text" bindlongpress="openTextSelection"/);
  assert.match(wxml, /class="row-assistant[^>]*bindlongpress="openTextSelection"/);
  // The sheet reuses the delivered-preview container with the copy-only action.
  assert.match(wxml, /filePreview\.selection/);
  assert.match(wxml, /delivered-preview-text/);
  assert.match(wxml, /bindtap="copyTextSelection"/);
});

test('the selection sheet never swallows the touchmove that native selection needs', () => {
  const wxml = read('pages/session/session.wxml');
  const css = read('pages/session/session.wxss');
  // 遮罩是弹层的祖先：catchtouchmove 会截断长按后拖拽选区手柄的 touchmove，
  // 原生「全选 / 拖动选区」就失效。只允许 catchtap（点遮罩关闭）。
  const mask = wxml.slice(wxml.indexOf('class="sheet-mask" catchtap="closeFilePreview"'));
  const maskTag = mask.slice(0, mask.indexOf('>'));
  assert.ok(!/catchtouchmove/.test(maskTag), 'the preview mask must not catch touchmove');
  assert.match(maskTag, /catchtap="closeFilePreview"/, 'tapping the mask still closes the sheet');
  // overflow:hidden 会裁掉 iOS 的原生选区高亮。
  const preview = css.match(/\.delivered-preview \{([^}]*)\}/)[1];
  assert.ok(!/overflow:\s*hidden/.test(preview), 'the preview sheet must not clip the native selection overlay');
  // 正文显式声明可选，和 <text selectable> 双保险。
  assert.match(css, /\.delivered-preview-text \{[^}]*user-select:\s*text/, 'the body text opts into selection');
});

test('selection handlers convert markdown to plain text and copy it', () => {
  const source = read('pages/session/session.js');
  assert.match(source, /openTextSelection\(e\)/);
  assert.match(source, /mdToPlain\(row\.text\)/);
  assert.match(source, /filePreview: \{ name: uiText\('选择文字'\), text, selection: true \}/);
  assert.match(source, /copyTextSelection\(\)/);
  assert.match(source, /wx\.setClipboardData\(\{ data: text/);
});
