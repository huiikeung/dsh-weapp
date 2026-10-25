const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = require('../miniprogram/pages/insights/utils/context-insights-view');
const t = (s) => s;

function panel(coverage) {
  return view.deriveInsights({ days: [], sessions: [], skills: [], files: [] }, 7, t, Date.now(), { coverage });
}

test('the coverage dropdown carries its index and label', () => {
  for (const [coverage, index, label] of [['all', 0, '全部会话'], ['active', 1, '活跃会话'], ['archived', 2, '全部会话（显示已归档）']]) {
    const p = panel(coverage);
    assert.equal(p.coverageIndex, index, coverage + ' index');
    assert.equal(p.coverageLabel, label, coverage + ' label');
  }
});

test('the dropdown is an inline menu, not a bottom-sheet picker', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  // 不能用 <picker>：它在微信里是底部滚轮
  const tools = wxml.slice(wxml.indexOf('ins-list-tools'), wxml.indexOf('ins-group-row'));
  assert.ok(!/<picker/.test(tools), 'the coverage selector must not be a picker');
  assert.match(tools, /catchtap="toggleCoverage"/, 'the trigger toggles the menu');
  assert.match(tools, /wx:if="\{\{coverageOpen\}\}" class="ins-coverage-menu"/, 'the menu is inline and conditional');
  assert.match(tools, /catchtap="pickCoverage"/, 'each option picks a coverage');
  // 菜单必须绝对定位在触发器下方
  assert.match(wxss, /\.ins-coverage-menu\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(100% \+ 8rpx\)/,
    'the menu hangs below the trigger');
  // 触发器与搜索框同高、透明底、带边框
  const trigger = wxss.match(/\.ins-coverage-trigger\s*\{([^}]*)\}/)[1];
  assert.match(trigger, /height:\s*64rpx/, 'the dropdown matches the search box height');
  assert.match(trigger, /background:\s*transparent/, 'the dropdown has no fill');
  assert.match(trigger, /border:\s*1rpx solid/, 'the dropdown keeps a border');
  // 排序胶囊在下拉框之后
  const dropdownAt = tools.indexOf('ins-coverage-trigger');
  const sortAt = tools.indexOf('ins-sort-row');
  assert.ok(dropdownAt > 0 && sortAt > dropdownAt, 'the sort pills sit below the dropdown');
});

test('the card ring shrank and the stats text grew', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  const donut = wxss.match(/\.ins-session-donut\s*\{[^}]*width:\s*(\d+)rpx/g);
  assert.ok(donut.length >= 1, 'the donut keeps a size rule');
  const sizes = donut.map((rule) => Number(rule.match(/width:\s*(\d+)rpx/)[1]));
  // 会话卡片的环形图从 180rpx 一路缩到 108rpx，跟右侧三行统计等高。
  assert.ok(Math.max(...sizes) <= 108, 'the ring shrank from 180rpx to at most 108rpx');
  const stat = wxss.match(/\.ins-session-stat\s*\{[^}]*font-size:\s*(\d+)rpx/);
  assert.ok(Number(stat[1]) >= 24, 'the stats text is at least 24rpx');
});

test('the ring height matches the three stat rows beside it', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxml'), 'utf8');
  const number = (pattern, what) => {
    const found = wxss.match(pattern);
    assert.ok(found, what + ' must exist');
    return Number(found[1]);
  };
  const width = number(/\.ins-session-donut\s*\{[^}]*width:\s*(\d+)rpx/, 'the ring width');
  const height = number(/\.ins-session-donut\s*\{[^}]*height:\s*(\d+)rpx/, 'the ring height');
  const rowHeight = number(/\.ins-session-stat\s*\{[^}]*line-height:\s*(\d+)rpx/, 'the stat row line-height');
  const gap = number(/\.ins-session-stats\s*\{[^}]*gap:\s*(\d+)rpx/, 'the stats column gap');
  const rows = (wxml.match(/class="ins-session-stat"/g) || []).length;
  assert.equal(width, height, 'the ring stays a circle');
  assert.equal(rows, 3, 'three stat rows sit beside the ring');
  // 两列都是 align-items:center，直径等于三行总高时圆的上下边和文字上下边才齐平。
  assert.equal(width, rows * rowHeight + (rows - 1) * gap,
    'the ring diameter equals the three-row block height');
});

test('the two list chip rows follow the desktop reference', () => {
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/insights/insights.wxss'), 'utf8');
  const rule = (selector) => {
    const found = wxss.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
    assert.ok(found, selector + ' must exist');
    return found[1];
  };

  // 排序行：一个分段控件，外层描边浅底，选中段才是实心
  const sortRow = rule('.ins-list-tools .ins-sort-row');
  assert.match(sortRow, /border:\s*1rpx solid var\(--border\)/, 'the sort row is one bordered container');
  assert.match(sortRow, /background:\s*var\(--fill\)/, 'the sort row has a subtle container fill');
  assert.match(sortRow, /border-radius:\s*12rpx/, 'the sort row is one rounded container');
  const sortChip = rule('.ins-list-tools .ins-sort-row .ins-mini-chip');
  assert.match(sortChip, /background:\s*transparent/, 'inactive segments are transparent');
  assert.match(sortChip, /color:\s*var\(--text-3\)/, 'inactive segments are muted');
  const sortOn = rule('.ins-list-tools .ins-sort-row .ins-mini-chip.on');
  assert.match(sortOn, /background:\s*var\(--surface\)/, 'the active segment is a solid surface fill');
  assert.match(sortOn, /color:\s*var\(--text\)/, 'the active segment uses ink text');
  assert.ok(!/--ins-blue/.test(sortOn), 'the active segment is no longer blue');

  // 分组行：描边胶囊，只有选中项填充
  const groupChip = rule('.ins-group-row .ins-mini-chip');
  assert.match(groupChip, /border:\s*1rpx solid var\(--border\)/, 'group pills are outlined');
  assert.match(groupChip, /background:\s*transparent/, 'group pills have no fill');
  assert.match(groupChip, /border-radius:\s*999rpx/, 'group pills stay fully rounded');
  const groupOn = rule('.ins-group-row .ins-mini-chip.on');
  assert.match(groupOn, /background:\s*var\(--text\)/, 'the active group pill is solid');
  assert.match(groupOn, /color:\s*var\(--surface\)/, 'the active group pill inverts its text');
});
