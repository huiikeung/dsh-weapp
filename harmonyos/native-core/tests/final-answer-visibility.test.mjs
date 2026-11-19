import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// 回归：回合收工后「已完成」下面必须有最终正文。
// 流式正文是最早出现在回合里的条目，工具调用排在它后面；投影结算时若只在原地替换，
// ConversationFeed 会把它当「回合中段叙述」收进过程组，折叠成「已完成」后正文就消失了。
const load = p => {
  let source = readFileSync(new URL('../src/main/ets/' + p, import.meta.url), 'utf8');
  const enumMatch = source.match(/export enum ConversationItemKind \{[^}]*\}/);
  if (enumMatch) {
    const body = enumMatch[0].replace('export enum ConversationItemKind {', '').replace(/\}$/, '');
    const entries = body.split(',').map(part => part.trim()).filter(Boolean).map(part => {
      const [key, value] = part.split('=');
      return key.trim() + ':' + value.trim();
    });
    source = source.replace(enumMatch[0], 'const ConversationItemKind={' + entries.join(',') + '};');
  }
  return source.replace(/^import[\s\S]*?;$/gm, '').replace(/export /g, '');
};
const ctx = {
  Map, Set, Object, Array, JSON, Number, Math, Date, Error, Promise, setTimeout, clearTimeout,
  asRec: v => (v && typeof v === 'object' ? v : undefined),
  str: (v, k) => (typeof v?.[k] === 'string' ? v[k] : undefined),
  num: (v, k) => (typeof v?.[k] === 'number' ? v[k] : undefined)
};
for (const [file, names] of [
  ['projection/WorkStepPresentation.ets', 'WorkStepPresentation'],
  ['projection/ConversationProjection.ets', 'ConversationProjector, ConversationItemKind'],
  ['projection/ConversationFeed.ets', 'ConversationFeed']
]) {
  runInNewContext(stripTypeScriptTypes(load(file)) + ';globalThis.api={...(globalThis.api||{}),' +
    names.split(', ').map(name => name + ':' + name).join(',') + '};', ctx);
}
const { ConversationProjector, ConversationFeed } = ctx.api;

const record = (state, type, extra = {}) => {
  state.seq += 1;
  return { sessionId: 's', seq: state.seq, time: 1700000000 + state.seq, event: Object.assign({ type, turn: 1, step: 1 }, extra) };
};

/** 一个典型回合：流式正文 → 工具调用 → 最终正文。 */
function projectTurn() {
  const state = { seq: 0 };
  const projector = new ConversationProjector({});
  for (const event of [
    record(state, 'user/message', { text: '帮我改一下' }),
    record(state, 'assistant/chunk', { chunkType: 'text-delta', text: '我先读文件' }),
    record(state, 'tool/call', { callId: 'c1', name: 'read', arguments: { path: '/a.ts' } }),
    record(state, 'tool/result', { callId: 'c1', preview: 'ok' }),
    record(state, 'assistant/message', { text: '改好了，改动如下。' }),
    record(state, 'turn/end', { reason: 'completed' })
  ]) {
    projector.fold(event);
  }
  return projector.items;
}

test('最终正文在回合行之后仍然可见（四档展示策略）', () => {
  const items = projectTurn();
  const kinds = items.map(item => item.kind).join(',');
  assert.equal(items[items.length - 1].kind, 'ASSISTANT', '最终正文应排在回合过程条目之后: ' + kinds);
  for (const mode of ['standard', 'compact', 'detailed', 'verbose']) {
    const rows = ConversationFeed.build(items, false);
    ConversationFeed.applyWorkStepPolicy(rows, mode, 'completion');
    const turnIndex = rows.findIndex(row => row.kind === 'TURN');
    const answerIndex = rows.findIndex(row => row.kind === 'ASSISTANT' && row.text.length > 0);
    assert.ok(answerIndex >= 0, mode + ': 回合收工后必须能看到最终正文, rows=' + rows.map(row => row.kind).join(','));
    assert.equal(rows[answerIndex].text, '改好了，改动如下。', mode + ': 正文内容');
    if (turnIndex >= 0) {
      assert.ok(answerIndex > turnIndex, mode + ': 最终正文要排在「已完成」之后');
    }
  }
});
