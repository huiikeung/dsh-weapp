const test = require('node:test');
const assert = require('node:assert/strict');
const { workspaceRefsOfText } = require('../miniprogram/utils/protocol');

// 网关 GatewayMessageHandler 用同一规则把工作区引用写进正文：
//   `[工作区文件: path]` / `[工作区目录: path]`，每行一个。
test('workspace markers become path-bearing attachments and leave the body clean', () => {
  const result = workspaceRefsOfText('帮我看下这个文件\n[工作区文件: docs/report.pdf]\n谢谢');
  assert.deepEqual(result.refs, [{ kind: 'file', path: 'docs/report.pdf', name: 'report.pdf' }]);
  assert.equal(result.text, '帮我看下这个文件\n谢谢');
});

test('directory markers keep their kind and nested path', () => {
  const result = workspaceRefsOfText('[工作区目录: src/miniprogram/pages]');
  assert.deepEqual(result.refs, [{ kind: 'directory', path: 'src/miniprogram/pages', name: 'pages' }]);
  assert.equal(result.text, '');
});

test('several markers are extracted in order and collapse the blank lines they leave', () => {
  const result = workspaceRefsOfText('对比这两个\n[工作区文件: a/b.md]\n[工作区目录: c]\n[工作区文件: d.txt]');
  assert.deepEqual(result.refs.map((item) => item.path), ['a/b.md', 'c', 'd.txt']);
  assert.equal(result.text, '对比这两个');
});

test('text without markers is returned untouched and no attachment is invented', () => {
  const source = '普通消息，方括号 [备注] 不算标记';
  const result = workspaceRefsOfText(source);
  assert.deepEqual(result.refs, []);
  assert.equal(result.text, source);
  assert.equal(workspaceRefsOfText('').text, '');
  assert.equal(workspaceRefsOfText(undefined).text, undefined);
});

test('a marker only counts on its own line, never mid-sentence', () => {
  const result = workspaceRefsOfText('请看 [工作区文件: inline.md] 这一行');
  assert.deepEqual(result.refs, []);
  assert.equal(result.text, '请看 [工作区文件: inline.md] 这一行');
});

test('normalizing a user message keeps the body identical to the sent draft', () => {
  const protocol = require('../miniprogram/utils/protocol');
  // 网关回显/历史里的 user/message：正文带标记行，attachments 也带 path。
  const normalized = protocol.normalizeRawEvent({
    type: 'user/message',
    seq: 12,
    data: {
      text: '总结一下\n[工作区文件: docs/spec.md]',
      attachments: [{ kind: 'file', path: 'docs/spec.md', name: 'spec.md' }]
    }
  }, 'session-1');
  assert.equal(normalized.event.text, '总结一下');
  assert.equal(normalized.event.attachments.length, 1, 'the marker must not duplicate the wire attachment');
  assert.equal(normalized.event.attachments[0].path, 'docs/spec.md');
});

test('a gateway that only leaves the marker in the body still yields a previewable attachment', () => {
  const protocol = require('../miniprogram/utils/protocol');
  const normalized = protocol.normalizeRawEvent({
    type: 'user/message',
    seq: 13,
    data: { text: '看这个\n[工作区文件: notes/todo.txt]' }
  }, 'session-1');
  assert.equal(normalized.event.text, '看这个');
  assert.deepEqual(normalized.event.attachments, [{ kind: 'file', path: 'notes/todo.txt', name: 'todo.txt' }]);
});
