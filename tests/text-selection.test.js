const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'miniprogram', file), 'utf8');

test('conversation long-press opens the selectable text sheet', () => {
  const wxml = read('pages/session/session.wxml');
  // User bubble and assistant markdown body both expose the long-press entry.
  assert.match(wxml, /class="row-user-text" bindlongpress="openTextSelection"/);
  assert.match(wxml, /class="row-assistant"[^>]*bindlongpress="openTextSelection"/);
  // The sheet reuses the delivered-preview container with the copy-only action.
  assert.match(wxml, /filePreview\.selection/);
  assert.match(wxml, /delivered-preview-text/);
  assert.match(wxml, /bindtap="copyTextSelection"/);
});

test('selection handlers convert markdown to plain text and copy it', () => {
  const source = read('pages/session/session.js');
  assert.match(source, /openTextSelection\(e\)/);
  assert.match(source, /mdToPlain\(row\.text\)/);
  assert.match(source, /filePreview: \{ name: uiText\('选择文字'\), text, selection: true \}/);
  assert.match(source, /copyTextSelection\(\)/);
  assert.match(source, /wx\.setClipboardData\(\{ data: text/);
});
