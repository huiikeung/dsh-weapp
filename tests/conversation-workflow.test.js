const assert = require('node:assert/strict');
const { buildEntries } = require('../miniprogram/pages/session/utils/conversation-workflow');

const entries = buildEntries([
  { kind: 'user', key: 'u-1', text: '检查并修复问题' },
  {
    kind: 'assistant', key: 'a-1', reasoning: '先检查相关文件', text: '',
    tools: [{ callId: 'c-1', key: 't-1', name: 'read_file', status: 'done' }]
  },
  {
    kind: 'assistant', key: 'a-2', reasoning: '再应用最小修改', text: '',
    tools: [{ callId: 'c-2', key: 't-2', name: 'apply_patch', status: 'done' }]
  },
  { kind: 'assistant', key: 'a-3', reasoning: '', text: '问题已修复。', tools: [] }
]);

assert.deepEqual(entries.map((entry) => entry.kind), ['user', 'processGroup', 'assistant']);
assert.equal(entries[1].title, '已完成');
assert.match(entries[1].summary, /2 次工具调用/);
assert.deepEqual(entries[1].children.map(c => c.kind), ['reasoning','toolBundle','reasoning','toolBundle']);
assert.equal(entries[1].children.filter((child) => child.kind === 'toolBundle').flatMap(child => child.tools).length, 2);
assert.equal(entries[2].text, '问题已修复。');

const runningCommand = buildEntries([
  { kind: 'user', key: 'u-running', text: '运行检查' },
  { kind: 'status', key: 'cmd-running', title: 'bash', text: '正在执行…' }
], { running: true });
assert.equal(runningCommand[1].title, '正在执行命令');

const runningTool = buildEntries([
  { kind: 'user', key: 'u-tool', text: '读取文件' },
  { kind: 'assistant', key: 'a-tool', reasoning: '查看文件', text: '',
    tools: [{ callId: 'c-read', key: 't-read', name: 'read_file', status: 'running' }] }
], { running: true });
assert.equal(runningTool[1].title, '正在读取内容');

const runningContext = buildEntries([
  { kind: 'user', key: 'u-context', text: '分析' },
  { kind: 'context', key: 'ctx-1', title: '工作区', text: '项目文件' }
], { running: true });
assert.equal(runningContext[1].title, '正在整理上下文');

const splitByNextUser = buildEntries([
  { kind: 'assistant', key: 'a-4', reasoning: '第一轮思考', text: '',
    tools: [{ callId: 'c-3', key: 't-3', name: 'read_file', status: 'done' }] },
  { kind: 'user', key: 'u-2', text: '继续检查' },
  { kind: 'assistant', key: 'a-5', reasoning: '第二轮思考', text: '',
    tools: [{ callId: 'c-4', key: 't-4', name: 'search', status: 'done' }] }
]);

assert.deepEqual(splitByNextUser.map((entry) => entry.kind), ['processGroup', 'user', 'processGroup']);
assert.match(splitByNextUser[0].summary, /1 次工具调用/);
assert.match(splitByNextUser[2].summary, /1 次工具调用/);

console.log('conversation workflow multi-step grouping: PASS');
