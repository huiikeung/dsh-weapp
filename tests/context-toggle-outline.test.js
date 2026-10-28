const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxss = fs.readFileSync(path.resolve(__dirname, '../resources/runtime-markup/pages/session/session.wxss'), 'utf8');

test('context panel switches use transparent outlined controls', () => {
  assert.match(wxss, /\.ctx-trend-control-group\s*\{[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ctx-trend-control\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ctx-trend-control\.active\s*\{[^}]*background:\s*transparent/);

  assert.match(wxss, /\.ctx-br-head-actions\s+\.ctx-gran,\s*\.ctx-file-chips,\s*\.ctx-file-sorts\s*\{[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ctx-br-head-actions\s+\.ctx-gran-btn,\s*\.ctx-file-chips\s+\.ctx-gran-btn,\s*\.ctx-file-sorts\s+\.ctx-gran-btn\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ctx-browser-step\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);

  assert.match(wxss, /\.ctx-event-chip\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ctx-event-chip\.active\.ctx-kind-inject\s*\{[^}]*border-color:\s*rgba\(34, 197, 94, \.55\)/);
});

test('context outlines do not change the shared segmented control used by fleet filters', () => {
  assert.match(wxss, /\.ctx-gran\s*\{[^}]*background:\s*var\(--fill\)/);
  assert.match(wxss, /\.fleet-member-toolbar\s+\.ctx-gran\s*\{[^}]*background:\s*transparent/);
});
