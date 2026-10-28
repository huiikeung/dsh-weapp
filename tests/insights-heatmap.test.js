const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = require('../miniprogram/pages/insights/utils/context-insights-view');
const t = (s) => s;

function heatmapFor(daysAgo) {
  const now = Date.now();
  const days = [];
  for (let i = 55; i >= 0; i -= 1) {
    const d = new Date(now - i * 86400000);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    days.push({ day: key, tokens: i % 3 === 0 ? 1000 : 0, sessions: i % 3 === 0 ? 1 : 0 });
  }
  return view.deriveInsights({ days }, 7, t, now, { metric: 'tokens', locale: 'zh' }).heatmap;
}

test('month labels remain aligned without widening any heatmap column gap', () => {
  const hm = heatmapFor(55);
  assert.equal(hm.weeks.length, 8);
  const opening = hm.weeks.map((w, i) => [i, w.monthLabel]).filter(([, label]) => label !== '');
  assert.ok(opening.length >= 2, 'the 8-week window spans at least two months');
  // Week 0 carries the first month label too; labels must not alter the equal-width week grid.
  assert.equal(opening[0][0], 0, 'week 0 carries a month label as the first column');
  for (const [index] of opening.slice(1)) {
    assert.ok(index > 0, 'subsequent month labels stay attached to their week column');
  }
});

test('the heatmap uses one shared gap between all week columns', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  assert.match(wxml, /class="ins-heat-week"/, 'month labels do not add a special class to week columns');
  assert.doesNotMatch(wxss, /\.ins-heat-week\.opens-month/, 'no month-opening column gets an extra margin');
  const base = wxss.match(/\.ins-heatmap\s*\{[^}]*gap:\s*(\d+)rpx/);
  assert.ok(base, 'the heatmap keeps a base column gap');
  assert.equal(Number(base[1]), 5, 'every week column uses the same 5rpx gap');
});

test('month text cannot widen a heatmap week column', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  assert.match(wxss, /\.ins-heat-week\s*\{[^}]*width:\s*28rpx[^}]*grid-template-columns:\s*28rpx/,
    'mobile week columns have a fixed grid track matching their width');
  assert.match(wxss, /\.ins-heat-week\s*\{[^}]*width:\s*38rpx[^}]*grid-template-columns:\s*38rpx/,
    'wide week columns keep the same fixed grid track');
});

test('heatmap metric switch keeps its outlined segmented frame on a transparent background', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  assert.match(wxss, /\.ins-heat-card \.ins-seg\s*\{[^}]*border:\s*1rpx solid var\(--border\)[^}]*border-radius:\s*12rpx[^}]*background:\s*transparent/);
  assert.match(wxss, /\.ins-heat-card \.ins-seg \.ins-mini-chip\.on\s*\{[^}]*background:\s*var\(--text\)/);
});
