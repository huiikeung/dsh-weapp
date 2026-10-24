// 上下文趋势卡 ⇄ dsh-context v0.74.0 契约（spec-trend.md §9/§10/§12）。
//
// 重点：✂ 事件钉柱、pin 详情条（实际 prompt / 输出 / 缓存、末步/增量 tag）、
// Step brief 三行（本轮/输入/回复，各带可定位 chip，输入最多 3 枚 + +N）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const view = require(path.join(root, 'utils/context-view'));

const t = (key, values) => (values
  ? Object.keys(values).reduce((text, name) => text.split('{' + name + '}').join(String(values[name])), key)
  : key);

function fixture() {
  const requests = [
    { seq: 10, time: 1000, turn: 1, step: 1, system: 100, tools: 50, total: 150, prompt: 140, output: 10, cacheRead: 120 },
    { seq: 20, time: 2000, turn: 1, step: 2, system: 100, tools: 50, user: 40, total: 190, prompt: 180, output: 12, cacheRead: 150 },
    { seq: 30, time: 3000, turn: 2, step: 1, system: 100, tools: 50, user: 20, total: 170, prompt: 160, output: 8, cacheRead: 100 }
  ];
  return {
    requests,
    surface: [
      { seq: 5, cat: 'user', text: '请检查测试', tokens: 5 },
      { seq: 10, cat: 'assistant', text: '开始检查', tokens: 6 },
      { seq: 15, cat: 'tool', tool: 'bash', tokens: 7 },
      { seq: 16, cat: 'tool', tool: 'read', tokens: 3, err: true },
      { seq: 17, cat: 'tool', tool: 'grep', tokens: 2 },
      { seq: 18, cat: 'tool', tool: 'edit', tokens: 2 },
      { seq: 20, cat: 'assistant', text: '已修复', tokens: 5 },
      { seq: 25, cat: 'user', text: '继续', tokens: 4 },
      { seq: 30, cat: 'assistant', text: '完成', tokens: 5 }
    ],
    events: [
      { seq: 12, time: 1500, kind: 'compaction', tokens: 4096, count: 12 },
      { seq: 14, time: 1600, kind: 'prune', tokens: 512 }
    ]
  };
}

test('trend bars pin compaction/prune markers with the event time', () => {
  const trend = view.deriveTrend(fixture(), t, {});
  const marked = trend.bars.filter(bar => bar.marker);
  assert.ok(marked.length > 0);
  assert.ok(marked.every(bar => bar.markerLabel && bar.markerTimeText.length === 8));
  assert.match(wxss, /\.ctx-trend-bar-marker\s*\{[^}]*top:\s*-16px[^}]*color:\s*var\(--amber\)/);
  assert.match(wxml, /class="ctx-trend-bar-marker">✂/);
});

test('pin detail shows tags, actuals, cache share and delta', () => {
  const detail = view.deriveTrendSelection(fixture(), 20, t, { delta: false });
  assert.deepEqual(detail.tags.map(tag => tag.key), ['last'], 'step 2 closes turn 1');
  assert.equal(detail.actualPromptText, '180');
  assert.equal(detail.outputText, '12');
  assert.equal(detail.cacheText, '83%');
  assert.equal(detail.deltaText, '+40');
  const withDelta = view.deriveTrendSelection(fixture(), 20, t, { delta: true });
  assert.deepEqual(withDelta.tags.map(tag => tag.key), ['last', 'delta']);
  assert.match(wxss, /\.ctx-trend-marker-chip\s*\{[^}]*rgba\(245,\s*158,\s*11,\s*\.12\)/);
  assert.match(wxml, /ctx-trend-metrics/);
});

test('step brief renders user/in/reply rows with locatable chips and +N overflow', () => {
  const detail = view.deriveTrendSelection(fixture(), 20, t, {});
  assert.deepEqual(detail.brief.map(row => row.tag), ['本轮', '输入', '回复']);
  const [, input, reply] = detail.brief;
  assert.deepEqual(input.chips.map(chip => chip.seq), [15, 16, 17], 'new nodes since the previous request, oldest first');
  assert.equal(input.more, 1, 'the fourth new node folds into +1');
  assert.equal(input.chips[1].error, true);
  assert.equal(reply.chips[0].label, '已修复');
  assert.equal(detail.brief[0].chips[0].label, '请检查测试');
  // 轮首柱没有新增 → 「（无新增）」占位（插件 brief.input 空态）。
  const first = view.deriveTrendSelection(fixture(), 10, t, {});
  assert.equal(first.brief[1].empty, true);
  assert.equal(first.brief[1].emptyText, '（无新增）');
  // 视觉：tag 盒 min-width 112rpx、chip 圆角 10、brief min-height。
  assert.match(wxss, /\.ctx-brief-tag\s*\{[^}]*min-width:\s*112rpx/);
  assert.match(wxss, /\.ctx-brief\s*\{[^}]*min-height:\s*150rpx/);
  assert.match(wxml, /catchtap="contextBriefLocate"/);
  const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  assert.match(session, /contextBriefLocate\(e\)[\s\S]*?this\.setContextBrowser\(seq, expanded, false\)/);
});
