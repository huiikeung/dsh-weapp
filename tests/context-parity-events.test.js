// 上下文事件卡 ⇄ dsh-context v0.74.0 契约（spec-browser.md §3）。
//
// 插件侧：events.tsx + events.css + contextView 的 chips 口径。要点是五枚固定
// chips（注入/压缩/剪枝带全量计数，切换/模式不计数）、多选语义、token 增量配色、
// T/S 位置与 320px 固定列表通道。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const bridge = require(path.join(root, 'pages/session/utils/context-view'));
const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');

const t = (key, values) => (values
  ? Object.keys(values).reduce((text, name) => text.split('{' + name + '}').join(String(values[name])), key)
  : key);

function fixture() {
  return {
    counts: { injects: 23, compactions: 2, prunes: 13 },
    requests: [
      { seq: 10, turn: 1, step: 1, total: 100 },
      { seq: 20, turn: 2, step: 4, total: 200 }
    ],
    events: [
      { seq: 11, time: 1700000000000, kind: 'inject', form: 'catalog', name: 'skill-catalog' },
      { seq: 15, time: 1700000001000, kind: 'inject', form: 'instructions', name: 'AGENTS.md', tokens: 1200 },
      { seq: 21, time: 1700000002000, kind: 'compaction', tokens: 128609, count: 279 },
      { seq: 22, time: 1700000003000, kind: 'prune', tokens: 2048 },
      { seq: 23, time: 1700000004000, kind: 'model', from: 'glm-5.3-flashx', to: 'glm-5.3-flash' },
      { seq: 24, time: 1700000005000, kind: 'mode', name: 'plan.on' }
    ]
  };
}

test('five fixed chips in plugin order, only inject/compact/prune carry whole-session counts', () => {
  const events = bridge.deriveEvents(fixture(), t);
  assert.deepEqual(events.filters.map(filter => filter.key), ['inject', 'compaction', 'prune', 'model', 'mode']);
  assert.deepEqual(events.filters.map(filter => filter.countText), ['23', '2', '13', '', '']);
  assert.deepEqual(events.filters.map(filter => filter.label), ['注入', '压缩', '剪枝', '模型', '模式']);
  assert.ok(events.filters.every(filter => filter.active), 'all five are selected by default');
  assert.equal(events.allSelected, true);
  // chips UI: gran-style container + kind tint only when selected.
  assert.match(wxss, /\.ctx-event-chips\s*\{[^}]*background:\s*var\(--fill\)/);
  assert.match(wxss, /\.ctx-event-chip\.active\.ctx-kind-inject\s*\{[^}]*rgba\(34,\s*197,\s*94,\s*\.15\)/);
  assert.match(wxss, /\.ctx-event-chip\.active\.ctx-kind-prune\s*\{[^}]*rgba\(142,\s*81,\s*255,\s*\.15\)/);
  assert.match(wxml, /ctx-event-chip \{\{item\.active \? 'active ctx-kind-' \+ item\.key : ''\}\}/);
});

test('multi-select follows the plugin: one chip isolates, another adds, the last one restores all', () => {
  const view = (selection) => bridge.deriveEvents(fixture(), t, selection);
  assert.deepEqual(view(['prune']).rows.map(row => row.kindClass), ['prune']);
  assert.deepEqual(view(['inject', 'model']).selected, ['inject', 'model']);
  // The page handler owns the toggle semantics; the CSS/a11y hooks are asserted here.
  assert.match(session, /current\.length >= kinds\.length\) next = \[key\]/);
  assert.match(session, /if \(!next\.length\) next = kinds\.slice\(\)/);
});

test('rows carry producer labels, T/S positions, signed deltas and the plugin glyphs', () => {
  const events = bridge.deriveEvents(fixture(), t);
  const rows = events.rows;
  assert.deepEqual(rows.map(row => row.kindClass), ['mode', 'model', 'prune', 'compaction', 'inject', 'inject'], 'newest first');
  const byKind = Object.fromEntries(rows.map(row => [row.kindClass, row]));
  assert.equal(byKind.mode.name, '进入计划模式');
  assert.equal(byKind.model.name, '模型切换：glm-5.3-flashx → glm-5.3-flash');
  assert.equal(byKind.compaction.name, '压缩上下文（摘要替换 279 条消息）');
  assert.equal(byKind.prune.name, '剪枝工具输出');
  const injectRows = rows.filter(row => row.kindClass === 'inject');
  assert.deepEqual(injectRows.map(row => row.name), ['指令注入 · AGENTS.md', '目录更新 · skill-catalog']);
  // 注入琥珀色 +；压缩/剪枝绿色 −（events.css `.lc-up` 与默认）。
  assert.equal(injectRows[0].tokensText, '+1.2k');
  assert.equal(injectRows[0].tokensClass, 'up');
  assert.equal(byKind.compaction.tokensText, '−128.6k');
  assert.equal(byKind.compaction.tokensClass, 'down');
  assert.equal(byKind.compaction.positionText, 'T2 S4');
  assert.equal(injectRows[0].positionText, 'T1 S1');
  assert.equal(byKind.mode.icon, '⇄');
  assert.equal(byKind.compaction.icon, '✂');
  assert.match(wxss, /\.ctx-event-tokens-up\s*\{\s*color:\s*var\(--amber\)/);
  assert.match(wxss, /\.ctx-event-tokens-down\s*\{\s*color:\s*var\(--success\)/);
  assert.match(wxss, /\.ctx-event-lane\s*\{[^}]*max-height:\s*640rpx/);
  assert.match(wxml, /class="ctx-event-lane"/);
});
