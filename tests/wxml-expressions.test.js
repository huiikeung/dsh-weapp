const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../miniprogram');

/** 跳过字符串字面量后统计 {{ }} 表达式里的括号与引号是否配平。 */
function scan(expression) {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < expression.length; i += 1) {
    const char = expression[i];
    if (quote) {
      if (char === '\\') { i += 1; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) return '多余的 ' + char;
    }
  }
  if (quote) return '未闭合的字符串 ' + quote;
  if (depth !== 0) return '括号不配平（剩余 ' + depth + '）';
  return '';
}

test('every wxml interpolation is a balanced expression', () => {
  const files = fs.readdirSync(root, { recursive: true })
    .map(file => String(file).replace(/\\/g, '/'))
    .filter(file => file.endsWith('.wxml'));
  assert.ok(files.length > 0, 'wxml files are present');
  const failures = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const open = source.split('{{').length - 1;
    const close = source.split('}}').length - 1;
    if (open !== close) failures.push(file + ': {{ 与 }} 数量不一致 (' + open + '/' + close + ')');
    const pattern = /\{\{([\s\S]*?)\}\}/g;
    let match;
    while ((match = pattern.exec(source))) {
      const problem = scan(match[1]);
      if (problem) failures.push(file + ' @' + match.index + ': ' + problem + ' :: ' + match[1].trim().slice(0, 90));
    }
  }
  assert.deepEqual(failures, [], 'unbalanced wxml expressions break the whole subpackage');
});
