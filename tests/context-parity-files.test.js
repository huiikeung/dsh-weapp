// 文件活动卡 ⇄ dsh-context v0.74.0 契约（spec-browser.md §4）。
//
// 插件侧：fileCard.tsx + fileActivity.ts + fileCard.css。关键点是五枚计数 chips、
// 路径搜索 + 五种排序、语言/emoji 字形、读写搜徽标、+added/−removed、以及
// 行展开后的 op 日志（工具胶囊 / 读行数 / 行数增减 / 错误点 / 步骤戳）。
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
  return {
    requests: [
      { seq: 10, time: 1000, turn: 1, step: 1, total: 100 },
      { seq: 20, time: 2000, turn: 2, step: 1, total: 100 }
    ],
    fileOps: [
      { seq: 11, time: 1100, path: 'src/app.ts', kind: 'read', tool: 'read', readStart: 10, readCount: 20 },
      { seq: 12, time: 1200, path: 'src/app.ts', kind: 'write', tool: 'edit', added: 14, removed: 3 },
      { seq: 21, time: 2100, path: 'src/app.ts', kind: 'search', tool: 'grep', hits: 5 },
      { seq: 22, time: 2200, path: 'assets/logo.png', kind: 'read', tool: 'read_image', err: true }
    ]
  };
}

test('five count chips and the plugin sort set (count / lines / latest / path / name)', () => {
  const files = view.deriveFileActivity(fixture(), t, null, {});
  assert.deepEqual(files.chips.map(chip => chip.key), ['all', 'read', 'write', 'search', 'image']);
  assert.deepEqual(files.chips.map(chip => chip.countText), ['4', '2', '1', '1', '1']);
  assert.deepEqual(files.sorts.map(sort => sort.key), ['count', 'lines', 'latest', 'path', 'name']);
  assert.deepEqual(files.sorts.map(sort => sort.label), ['按次数', '按行数', '按最新', '按路径', '按文件名']);
  assert.equal(files.sorts.find(sort => sort.active).key, 'count');
  assert.equal(files.totalFilesText, '2 个文件');
  // 再点已选 chip 回「全部」由页面 handler 负责（见 session.js 断言）。
  const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  assert.match(session, /\[\'count\', \'lines\', \'latest\', \'path\', \'name\'\]\.indexOf\(sort\)/);
});

test('language and emoji glyphs follow the plugin bucket table', () => {
  const render = (pathName) => view.deriveFileActivity({ fileOps: [{ seq: 1, time: 1, path: pathName, kind: 'read', tool: 'read' }] }, t, null, {}).rows[0].glyph;
  assert.deepEqual(render('src/app.ts'), { label: 'TS', color: '#3178c6', emoji: false });
  assert.deepEqual(render('a/b/Cargo.rs').label, 'RS');
  assert.deepEqual(render('assets/logo.png'), { emoji: true, label: '🖼' });
  assert.deepEqual(render('README.md'), { emoji: true, label: '📝' });
  assert.deepEqual(render('config/app.json'), { emoji: true, label: '⚙️' });
  assert.match(wxss, /\.ctx-file-lang\s*\{[^}]*border-radius:\s*8rpx/);
  assert.match(wxml, /class="ctx-file-lang" style="background:\{\{item\.glyph\.color\}\}/);
});

test('rows show dir/file split, read-write-search badges and signed line deltas', () => {
  const files = view.deriveFileActivity(fixture(), t, null, {});
  const app = files.rows.find(row => row.path === 'src/app.ts');
  assert.equal(app.dirText, 'src/');
  assert.equal(app.nameText, 'app.ts');
  assert.deepEqual(app.badges.map(badge => [badge.key, badge.count]), [['read', 1], ['write', 1], ['search', 1]]);
  assert.equal(app.addedText, '+14');
  assert.equal(app.removedText, '−3');
  assert.equal(app.timeText.length, 8);
  const logo = files.rows.find(row => row.path === 'assets/logo.png');
  assert.equal(logo.badges.map(badge => badge.key).join(','), 'read');
  assert.match(wxss, /\.ctx-file-badge-read\s*\{[^}]*rgba\(46,\s*107,\s*230,\s*\.14\)/);
  assert.match(wxss, /\.ctx-file-badge-write\s*\{[^}]*rgba\(34,\s*197,\s*94,\s*\.14\)/);
  assert.match(wxss, /\.ctx-file-badge-search\s*\{[^}]*rgba\(245,\s*158,\s*11,\s*\.14\)/);
  assert.match(wxss, /\.ctx-file-add\s*\{[^}]*color:\s*#2E8B57/);
  assert.match(wxss, /\.ctx-file-del\s*\{[^}]*color:\s*#E5484D/);
});

test('op log rows expose tool pill, read range, line delta, failure dot and a browser jump', () => {
  const files = view.deriveFileActivity(fixture(), t, null, { expandedPath: 'src/app.ts' });
  const app = files.rows.find(row => row.path === 'src/app.ts');
  const write = app.ops.find(op => op.kindText === '写入');
  assert.equal(write.toolText, 'edit');
  assert.equal(write.deltaText, '+14 / −3');
  const read = app.ops.find(op => op.kindText === '读取');
  assert.equal(read.readText, '读取第 10–29 行');
  assert.equal(read.stamp, 'T1 S1');
  assert.equal(read.stepSeq, 10, 'the op jumps to the request that consumed it');
  const search = app.ops.find(op => op.kindText === '搜索');
  assert.equal(search.hitsText, '×5');
  const logo = files.rows.find(row => row.path === 'assets/logo.png');
  assert.equal(logo.ops[0].error, true);
  assert.match(wxss, /\.ctx-file-op-tool\s*\{[^}]*border-radius:\s*999rpx/);
  assert.match(wxss, /\.ctx-file-ops\s*\{[^}]*border-left:\s*2rpx/);
  assert.match(wxml, /catchtap="contextFileOpTap"/);
  const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  assert.match(session, /contextFileOpTap\(e\)[\s\S]*?this\.setContextBrowser\(seq, \['tool'\], false\)/);
});

test('images filter and path search stay in sync with the plugin card', () => {
  const images = view.deriveFileActivity(fixture(), t, null, { filter: 'image' });
  assert.deepEqual(images.rows.map(row => row.path), ['assets/logo.png']);
  const queried = view.deriveFileActivity(fixture(), t, null, { query: 'SRC/APP' });
  assert.deepEqual(queried.rows.map(row => row.path), ['src/app.ts']);
  assert.equal(queried.rows.length, 1);
  const noMatch = view.deriveFileActivity(fixture(), t, null, { query: 'missing' });
  assert.equal(noMatch.noMatches, true);
  assert.match(wxss, /\.ctx-file-lane\s*\{[^}]*max-height:\s*640rpx/);
  assert.match(wxml, /placeholder="\{\{ui\['按路径过滤…'\]\}\}"/);
});
