import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const load = p => {
  let source = readFileSync(new URL(p, import.meta.url), 'utf8');
  source = source.replace("export enum ConversationItemKind { USER='USER', CONTEXT='CONTEXT', ASSISTANT='ASSISTANT', REASONING='REASONING', TOOL='TOOL', JSON_TOOL='JSON_TOOL', TOOL_RESULT='TOOL_RESULT', GENERATED_IMAGES='GENERATED_IMAGES', STATUS='STATUS', SYSTEM='SYSTEM' }", "const ConversationItemKind={USER:'USER',CONTEXT:'CONTEXT',ASSISTANT:'ASSISTANT',REASONING:'REASONING',TOOL:'TOOL',JSON_TOOL:'JSON_TOOL',TOOL_RESULT:'TOOL_RESULT',GENERATED_IMAGES:'GENERATED_IMAGES',STATUS:'STATUS',SYSTEM:'SYSTEM'};");
  return source.replace(/import[\s\S]*?from[^;]*;/g, '').replace(/export\s+(type\s*)?\{[^}]*\};?/g, '').replace(/export /g, '').replace(/@Observed\r?\n/g, '');
};
const context = { Map, Set, Object, JSON, Number, Math, String, Array, Error, Date, console };
runInNewContext([
  load('../src/main/ets/projection/ConversationProjection.ets'),
  load('../src/main/ets/projection/ConversationFeed.ets'),
  ';globalThis.api={ConversationFeed,ConversationItemKind,ToolActivity}'
].map(x => stripTypeScriptTypes(x, { mode: 'transform' })).join(';'), context);
const { ConversationFeed: F, ConversationItemKind: K } = context.api;
const item = (id, kind, text, extra = {}) => ({ id, kind, title: extra.title ?? '', text, epochSeconds: extra.epoch ?? 1000, isError: extra.isError, images: extra.images, turn: extra.turn });

test('process groups are named by their activity, not by duration', () => {
  const entries = F.build([
    item('a', K.USER, 'go', { epoch: 1000 }),
    item('b', K.REASONING, 'thinking', { epoch: 1001 }),
    item('c', K.TOOL, '{"path":"/a.ts"}', { title: 'read', epoch: 1002 }),
    item('d', K.TOOL, '{"query":"x"}', { title: 'grep', epoch: 1003 }),
    item('e', K.ASSISTANT, 'done', { epoch: 1004, turn: 1 })
  ], false);
  const turn = entries.find(e => e.kind === 'TURN');
  assert.ok(turn, 'expected a settled turn row');
  // 回合收工后组标题被收拢进子组；子组按活动命名，不带时长
  const childTitles = turn.children.map(child => child.title).join('|');
  assert.ok(childTitles.includes('已读取文件'), 'activity title should mention 已读取文件: ' + childTitles);
  assert.ok(!childTitles.includes('耗时'), 'no duration-based title: ' + childTitles);
  assert.equal(turn.title, '已完成');
});

test('settled turn collapses consecutive process groups into one 已完成 row', () => {
  const entries = F.build([
    item('a', K.USER, 'go'),
    item('b', K.REASONING, 'r1', { epoch: 1001 }),
    item('c', K.TOOL, '{}', { title: 'read', epoch: 1002 }),
    item('d', K.TOOL_RESULT, 'ok', { epoch: 1003 }),
    item('e', K.REASONING, 'r2', { epoch: 1004 }),
    item('f', K.TOOL, '{}', { title: 'grep', epoch: 1005 })
  ], false);
  const turns = entries.filter(e => e.kind === 'TURN');
  assert.equal(turns.length, 1, 'one turn row: ' + entries.map(e => e.kind).join(','));
  assert.equal(turns[0].title, '已完成');
  assert.ok(turns[0].toolCount >= 2, 'tool count summed: ' + turns[0].toolCount);
  assert.equal(turns[0].childIds.length, 1, 'merged child groups: ' + turns[0].childIds.length);
});

test('tool face derives command/detail like the mini program', () => {
  const face = F.toolFace('bash', '{"command":"npm test","description":"跑测试"}');
  assert.equal(face.label, '运行命令');
  assert.equal(face.detail, '跑测试');
  assert.equal(face.isCommand, true);
  assert.equal(face.commandText, 'npm test');
  const read = F.toolFace('read', '{"path":"src/a.ts"}');
  assert.equal(read.label, '读取文件');
  assert.equal(read.detail, 'src/a.ts');
});

test('copy rule only marks the final assistant reply', () => {
  const entries = F.build([
    item('u', K.USER, 'q'),
    item('a1', K.ASSISTANT, 'draft'),
    item('a2', K.ASSISTANT, 'final')
  ], false);
  assert.equal(entries[0].copyable, true);
  assert.equal(entries[1].copyable, false);
  assert.equal(entries[2].copyable, true);
});

test('running label rotates phrases and header carries counts', () => {
  const items = [
    item('u', K.USER, 'go', { epoch: 600 }),
    item('c', K.CONTEXT, 'ctx', { epoch: 601 }),
    item('t', K.TOOL, '{}', { title: 'grep', epoch: 602 })
  ];
  assert.equal(F.runningActivity(items), 'exploring');
  const label = F.runningLabel('exploring', 600, 660);
  assert.ok(label.includes('用时 60 秒'), label);
  assert.ok(label.endsWith('…'));
  const header = F.runningHeader(items, 600, 660);
  assert.ok(header.startsWith('耗时 1 分钟 0 秒'), header);
  assert.ok(header.includes('1 项上下文'), header);
  assert.ok(header.includes('1 次工具调用'), header);
});

test('activity titles combine with 并 and 等', () => {
  assert.equal(F.activityTitle(['read']), '已读取文件');
  assert.equal(F.activityTitle(['read', 'search']), '已读取文件并搜索代码');
  const three = F.activityTitle(['commands', 'edit', 'search']);
  assert.ok(three.includes('，'), three);
  assert.equal(F.activityTitle([]), '已完成分析');
});
