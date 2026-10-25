const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compact, files } = require('../scripts/compact-runtime-markup.cjs');
test('runtime markup matches readable sources and removes packaging overhead', () => {
  const root = path.resolve(__dirname, '..');
  let saved = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'resources/runtime-markup', file), 'utf8');
    const output = fs.readFileSync(path.join(root, 'miniprogram', file), 'utf8');
    assert.equal(output, compact(source, file), file + ': regenerate runtime markup');
    saved += Buffer.byteLength(source) - Buffer.byteLength(output);
    assert.equal(compact(output, file), output, 'generation is idempotent');
  }
  assert.ok(saved > 55000, 'save at least 55KB without changing package budgets');
});
test('compaction preserves quoted CSS data and template text', () => {
  assert.equal(compact('/* note */\na { content: "/* literal */"; }', 'a.wxss'), 'a { content: "/* literal */"; }\n');
  assert.equal(compact('  <text> keep spaces </text>\n  literal text\n', 'a.wxml'), '<text> keep spaces </text>\n  literal text\n');
});
