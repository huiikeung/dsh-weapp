const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const compiler = require('./helpers/wechat-wcc.cjs');
const root = path.resolve(__dirname, '../miniprogram');

test('turn ticks share the row selection and reserve fixed right-aligned space', () => {
  for (const base of [root, path.resolve(__dirname, '../resources/runtime-markup')]) {
    const xml = fs.readFileSync(path.join(base, 'pages/session/session.wxml'), 'utf8');
    const css = fs.readFileSync(path.join(base, 'pages/session/session.wxss'), 'utf8');
    const row = xml.slice(xml.indexOf('wx:for="{{turnNavVisibleItems}}"'), xml.indexOf('height: {{turnNavBottomPadPx}}'));
    assert.match(row, /turnNavActiveIndex === item.index \? 'active'/);
    assert.equal((row.match(/class="turn-scrub-tick"/g) || []).length, 1);
    assert.match(row, /class="turn-scrub-tick-slot" aria-hidden="true"/);
    assert.match(css, /\.turn-scrub-tick-slot\s*\{[^}]*flex: none;[^}]*width: 40rpx;[^}]*justify-content: flex-end;/);
    assert.match(css, /\.turn-scrub-tick\s*\{[^}]*transform: scaleX\(0\.5\);[^}]*transform-origin: right center;/);
    assert.match(css, /\.turn-scrub-row\.active \.turn-scrub-tick\s*\{[^}]*transform: scaleX\(1\);[^}]*background: #FFFFFF;/);
  }
});

test('native WXML renders one tick per visible turn and follows selection in both themes', { skip: !compiler }, t => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-turn-ticks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'session.js');
  execFileSync(compiler, ['-o', output, 'pages/session/session.wxml'], { cwd: root });
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(fs.readFileSync(output, 'utf8'), context);
  const render = context.$gwx('pages/session/session.wxml');
  const items = [100, 101, 102].map(index => ({ key: 'u' + index, index, label: 'Turn ' + index }));
  function nodes(tree, name, found = []) {
    if (!tree || typeof tree !== 'object') return found;
    if (tree.attr && String(tree.attr.class || '').split(/\s+/).includes(name)) found.push(tree);
    for (const child of tree.children || []) nodes(child, name, found);
    return found;
  }
  for (const theme of ['light', 'dark']) for (const selected of [100, 102]) {
    const tree = render({ ...require('../miniprogram/utils/ui-preferences').snapshot(), theme, themeClass: 'theme-' + theme,
      turnNavOpen: true, turnNavVisibleItems: items, turnNavActiveIndex: selected, turnNavRowStyles: [], rows: [],
      turnNavItems: items, turnNavTopPadPx: 3800, turnNavBottomPadPx: 3800 }, {}, {});
    const rows = nodes(tree, 'turn-scrub-row');
    assert.equal(rows.length, 3);
    assert.equal(nodes(tree, 'turn-scrub-tick').length, 3);
    assert.equal(rows.filter(row => String(row.attr.class).split(/\s+/).includes('active')).length, 1);
    assert.ok(String(rows[selected - 100].attr.class).includes('active'));
    for (const row of rows) assert.equal(nodes(row, 'turn-scrub-tick').length, 1);
  }
  const empty = render({ turnNavOpen: true, turnNavVisibleItems: [], turnNavItems: [], rows: [], ui: {} }, {}, {});
  assert.equal(nodes(empty, 'turn-scrub-tick').length, 0);
});
