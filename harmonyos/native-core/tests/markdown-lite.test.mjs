import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = p => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from[^;]*;/g, '')
  .replace(/export\s+(type\s*)?\{[^}]*\};?/g, '')
  .replace(/export /g, '');
const context = { Map, Set, Object, JSON, Number, Math, String, Array, Error, Date };
runInNewContext([
  load('../src/main/ets/components/MarkdownLite.ets'),
  ';globalThis.api={MarkdownLite}'
].map(x => stripTypeScriptTypes(x, { mode: 'transform' })).join(';'), context);
const { MarkdownLite: M } = context.api;
const FENCE = String.fromCharCode(96, 96, 96);

test('parses paragraphs, headings and code fences', () => {
  const source = ['# 标题', '', '第一段第一行', '第一段第二行', '', '## 二级', '', FENCE + 'ts', 'const a = 1;', 'const b = 2;', FENCE].join('\n');
  const blocks = M.parse(source);
  // vm 里创建的数组与原 realm 的 Array.prototype 不同，deepEqual 会判失败，比较拼接结果。
  assert.equal(blocks.map(b => b.kind).join(','), 'heading,paragraph,heading,code');
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[0].text, '标题');
  assert.equal(blocks[1].text, '第一段第一行\n第一段第二行');
  assert.equal(blocks[3].language, 'ts');
  assert.equal(blocks[3].text, 'const a = 1;\nconst b = 2;');
});

test('parses lists, quotes, dividers and tables', () => {
  const source = ['> 引用一行', '', '- 项目一', '- 项目二', '', '1. 第一', '2. 第二', '', '---', '', '| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
  const blocks = M.parse(source);
  assert.equal(blocks.map(b => b.kind).join(','), 'quote,list,list,list,list,divider,table');
  assert.equal(blocks[0].text, '引用一行');
  assert.equal(blocks[1].index, 0);
  assert.equal(blocks[3].index, 1);
  assert.equal(blocks[6].headers.join(','), 'A,B');
  assert.equal(blocks[6].rows.map(r => r.join('|')).join(';'), '1|2');
});

test('inline spans split bold, italic, code and links', () => {
  const tick = String.fromCharCode(96);
  const spans = M.inline('普通**粗体**和*斜体*与' + tick + '代码' + tick + '以及[链接](https://x.y)');
  assert.equal(spans.map(s => s.style).join(','), 'plain,bold,plain,italic,plain,code,plain,link');
  assert.equal(spans[5].text, '代码');
  assert.equal(spans[7].href, 'https://x.y');
  const tick2 = String.fromCharCode(96);
  assert.equal(M.plainText('**a**b' + tick2 + 'c' + tick2), 'abc');
});

test('unterminated markers degrade to plain text', () => {
  const spans = M.inline('**未闭合 与 [未闭合');
  assert.equal(spans.map(s => s.style).join(','), 'plain');
  assert.equal(spans[0].text, '**未闭合 与 [未闭合');
});

test('list markers and table dividers are classified', () => {
  assert.equal(M.listMarker('- a'), '-');
  assert.equal(M.listMarker('12. b'), '12.');
  assert.equal(M.listMarker('hello'), '');
  assert.equal(M.isTableDivider('| --- | :-: |'), true);
  assert.equal(M.isTableDivider('| abc |'), false);
});
