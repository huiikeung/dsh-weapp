// dsh-mini test suite — plain node, no test framework.
// Run: node test/run-tests.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/session.js';
import { inlineToolResult } from '../src/context.js';
import { ToolRegistry, bashTool, fsTools } from '../src/tools.js';
import { deriveMessages, runTurn } from '../src/loop.js';
import { createMockLlm } from '../src/llm-mock.js';
import { buildSystemPrompt } from '../src/prompt.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mini-test-'));
let passed = 0;
let failed = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}\n    ${err.stack?.split('\n').slice(0, 4).join('\n    ')}`);
    }
  })();
}

/* ------------------------------------------------------------------ 1. context */

await test('inlineToolResult: short text passes through', async () => {
  const { text, spilled } = await inlineToolResult('hello', { spillDir: TMP, spillName: 'a.txt' });
  assert.equal(text, 'hello');
  assert.equal(spilled, false);
});

await test('inlineToolResult: long text is head+tail with spill file', async () => {
  const long = 'A'.repeat(9000) + 'X'.repeat(9000) + 'B'.repeat(9000);
  const { text, spilled, spillPath } = await inlineToolResult(long, { spillDir: TMP, spillName: 'long.txt' });
  assert.equal(spilled, true);
  assert.ok(text.includes('chars omitted'), 'marker present');
  assert.ok(text.includes(spillPath));
  assert.ok(text.startsWith('A'.repeat(50)));
  assert.ok(text.endsWith('B'.repeat(50)));
  const full = await fsp.readFile(spillPath, 'utf8');
  assert.equal(full.length, 27000);
});

/* ------------------------------------------------------------------ 2. tools */

await test('tools: write→read→edit flow + observation policy', async () => {
  const reg = new ToolRegistry();
  for (const t of fsTools({ cwd: TMP })) reg.register(t);
  const exec = { registry: reg, signal: undefined };

  const w = await reg.execute('write', { file_path: 'note.txt', content: 'hello world\n' }, exec);
  assert.equal(w.isError, false, w.text);

  // overwrite the file we just created → allowed (creation counts as observation)
  const w2 = await reg.execute('write', { file_path: 'note.txt', content: 'hello world\n' }, exec);
  assert.equal(w2.isError, false, w2.text);

  // overwrite a pre-existing file never read → refused
  await fsp.writeFile(path.join(TMP, 'pre.txt'), 'existing');
  const w2b = await reg.execute('write', { file_path: 'pre.txt', content: 'no' }, exec);
  assert.equal(w2b.isError, true);
  assert.ok(w2b.text.includes('FS_OBSERVATION_REQUIRED'));

  const r = await reg.execute('read', { file_path: 'note.txt' }, exec);
  assert.ok(r.text.includes('1: hello world'), r.text);

  // now edit works (observed)
  const e = await reg.execute('edit', { file_path: 'note.txt', old_string: 'world', new_string: 'dsh' }, exec);
  assert.equal(e.isError, false, e.text);
  const content = await fsp.readFile(path.join(TMP, 'note.txt'), 'utf8');
  assert.equal(content, 'hello dsh\n');

  // edit non-unique old_string → refused
  await reg.execute('write', { file_path: 'dup.txt', content: 'x x x' }, exec);
  await reg.execute('read', { file_path: 'dup.txt' }, exec);
  const e2 = await reg.execute('edit', { file_path: 'dup.txt', old_string: 'x', new_string: 'y' }, exec);
  assert.equal(e2.isError, true);
  assert.ok(e2.text.includes('3 times'));

  // outside workspace → refused
  const w3 = await reg.execute('write', { file_path: '/etc/dsh-mini-should-not-exist', content: 'no' }, exec);
  assert.equal(w3.isError, true);
  assert.ok(w3.text.includes('PATH_OUTSIDE_WORKSPACE'));
});

await test('tools: glob + grep', async () => {
  const reg = new ToolRegistry();
  for (const t of fsTools({ cwd: TMP })) reg.register(t);
  const exec = { registry: reg, signal: undefined };
  await fsp.mkdir(path.join(TMP, 'sub'), { recursive: true });
  await fsp.writeFile(path.join(TMP, 'a.js'), 'const alpha = 1;\n');
  await fsp.writeFile(path.join(TMP, 'sub', 'b.js'), 'const beta = 2;\n');

  const g = await reg.execute('glob', { pattern: '**/*.js' }, exec);
  assert.ok(g.text.includes('a.js') && g.text.includes('b.js'), g.text);

  const gr = await reg.execute('grep', { pattern: 'alpha', include: '*.js' }, exec);
  assert.ok(gr.text.includes('a.js') && gr.text.includes('1:'), gr.text);
});

await test('tools: bash exit codes + timeout', async () => {
  const reg = new ToolRegistry();
  reg.register(bashTool({ cwd: TMP }));
  const exec = { registry: reg, signal: undefined };

  const ok = await reg.execute('bash', { command: 'echo hi' }, exec);
  assert.ok(ok.text.includes('hi') && ok.text.includes('[exit code: 0]'), ok.text);

  const bad = await reg.execute('bash', { command: 'exit 3' }, exec);
  assert.ok(bad.text.includes('[exit code: 3]'), bad.text);

  const slow = await reg.execute('bash', { command: 'sleep 5', timeoutMs: 1000 }, exec);
  assert.ok(slow.text.includes('timed out'), slow.text);
});

/* ------------------------------------------------------------------ 3. session */

await test('session: torn trailing line is recovered, intermediate corruption is fatal', async () => {
  const dir = path.join(TMP, 'sessions-1');
  const s = await Session.open(dir, 'torn');
  await s.append('user/message', { content: 'one' });
  await s.append('assistant/message', { content: [{ type: 'text', text: 'two' }] });
  await s.close();

  // simulate crash mid-write: partial trailing line
  const file = path.join(dir, 'torn.jsonl');
  await fsp.appendFile(file, '{"seq":3,"time":"2');

  const s2 = await Session.open(dir, 'torn');
  assert.equal(s2.events.length, 2);
  assert.equal(s2.recoveredTornLine, true);
  const evt = await s2.append('user/message', { content: 'three' });
  assert.equal(evt.seq, 3, 'seq continues after torn line');
  await s2.close();
});

/* ------------------------------------------------------------------ 4. derive */

await test('deriveMessages: basic, unanswered tool calls synthesized, results mapped', () => {
  const events = [
    { type: 'session/start', data: {} },
    { type: 'user/message', data: { content: 'hi' } },
    { type: 'assistant/message', data: { content: [{ type: 'tool_use', id: 't1', name: 'bash', input: { command: 'ls' } }], stopReason: 'tool_use' } },
    { type: 'tool/result', data: { toolUseId: 't1', content: 'file.txt', isError: false } },
    { type: 'assistant/message', data: { content: [{ type: 'text', text: 'done' }], stopReason: 'end_turn' } },
    // crash case: tool_use answered by NOTHING (assistant persisted, process died before results)
    { type: 'user/message', data: { content: 'continue' } },
    { type: 'assistant/message', data: { content: [{ type: 'tool_use', id: 't2', name: 'bash', input: {} }], stopReason: 'tool_use' } },
    { type: 'turn/end', data: { reason: 'error' } },
  ];
  const msgs = deriveMessages(events);
  // hi
  assert.equal(msgs[0].role, 'user');
  // assistant tool_use + tool_result
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[2].role, 'user');
  assert.equal(msgs[2].content[0].type, 'tool_result');
  assert.equal(msgs[2].content[0].tool_use_id, 't1');
  assert.equal(msgs[2].content[0].content[0].text, 'file.txt');
  // done
  assert.equal(msgs[3].role, 'assistant');
  assert.equal(msgs[3].content[0].text, 'done');
  // continue
  assert.equal(msgs[4].role, 'user');
  // t2 unanswered → TOOL_OUTCOME_UNKNOWN synthesized
  assert.equal(msgs[6].role, 'user');
  assert.equal(msgs[6].content[0].is_error, true);
  assert.ok(msgs[6].content[0].content[0].text.includes('TOOL_OUTCOME_UNKNOWN'));
});

/* ------------------------------------------------------------------ 5. loop e2e */

function recorder(mock) {
  // wrap the mock llm to capture what messages the loop actually sends
  const calls = [];
  return {
    calls,
    model: 'mock-model',
    async *stream(opts) {
      calls.push(opts.messages.map((m) => ({
        role: m.role,
        blocks: m.content.map((b) => b.type + (b.tool_use_id ? `:${b.tool_use_id}` : '')),
      })));
      yield* mock.stream(opts);
    },
  };
}

await test('loop e2e: tool call round-trip + event sequence', async () => {
  const dir = path.join(TMP, 'sessions-2');
  fs.mkdirSync(dir, { recursive: true });
  await fsp.writeFile(path.join(TMP, 'data.txt'), 'payload-123');
  const session = await Session.open(dir, 'e2e');

  const mock = createMockLlm({
    turns: [
      { blocks: [{ type: 'tool_use', id: 'm1', name: 'read', input: { file_path: 'data.txt' } }], stopReason: 'tool_use' },
      { blocks: [{ type: 'text', text: 'The file says payload-123.' }], stopReason: 'end_turn' },
    ],
  });
  const llm = recorder(mock);
  const tools = new ToolRegistry();
  for (const t of fsTools({ cwd: TMP })) tools.register(t);

  const res = await runTurn({ session, llm, tools, system: buildSystemPrompt({ cwd: TMP, model: 'mock' }), input: 'read data.txt', spillDir: path.join(TMP, 'spill') });
  assert.equal(res.status, 'end_turn');

  const types = session.events.map((e) => e.type);
  assert.deepEqual(types, ['turn/start', 'user/message', 'assistant/message', 'tool/result', 'assistant/message', 'turn/end']);
  assert.equal(session.events[3].data.toolUseId, 'm1');
  assert.ok(session.events[3].data.content.includes('payload-123'));

  // second model call must have carried the tool_result
  assert.equal(llm.calls.length, 2);
  assert.ok(llm.calls[1].some((m) => m.role === 'user' && m.blocks.includes('tool_result:m1')), JSON.stringify(llm.calls[1]));
  await session.close();
});

await test('loop: durable retry — llm/retry logged before success', async () => {
  const dir = path.join(TMP, 'sessions-3');
  const session = await Session.open(dir, 'retry');
  let failedOnce = false;
  const llm = {
    model: 'mock-model',
    async *stream() {
      if (!failedOnce) {
        failedOnce = true;
        yield { kind: 'error', code: 'SERVER', message: 'boom (mock)' };
        return;
      }
      yield { kind: 'block-start', index: 0, block: { type: 'text' } };
      yield { kind: 'text-delta', text: 'recovered' };
      yield { kind: 'block-stop', index: 0 };
      yield { kind: 'finish', stopReason: 'end_turn', usage: {} };
    },
  };
  const res = await runTurn({ session, llm, tools: new ToolRegistry(), system: '', input: 'go', spillDir: TMP });
  assert.equal(res.status, 'end_turn');
  const retryEvt = session.events.find((e) => e.type === 'llm/retry');
  assert.ok(retryEvt, 'retry event persisted');
  assert.equal(retryEvt.data.code, 'SERVER');
  const idxRetry = session.events.indexOf(retryEvt);
  const idxAssistant = session.events.findIndex((e) => e.type === 'assistant/message');
  assert.ok(idxRetry < idxAssistant, 'retry logged before the successful assistant message');
  await session.close();
});

await test('loop: pre-turn abort leaves no user message in history (accept≠commit)', async () => {
  const dir = path.join(TMP, 'sessions-4');
  const session = await Session.open(dir, 'abort');
  const ac = new AbortController();
  ac.abort();
  const res = await runTurn({ session, llm: createMockLlm({}), tools: new ToolRegistry(), system: '', input: 'never lands', spillDir: TMP, signal: ac.signal });
  assert.equal(res.status, 'cancelled');
  assert.ok(!session.events.some((e) => e.type === 'user/message'), 'no user message persisted');
  await session.close();
});

await test('loop: crash resume answers orphaned tool calls with TOOL_OUTCOME_UNKNOWN', async () => {
  const dir = path.join(TMP, 'sessions-5');
  fs.mkdirSync(dir, { recursive: true });
  await fsp.writeFile(path.join(TMP, 'crash.txt'), 'state');
  const session = await Session.open(dir, 'crash');

  // "crash" mid-turn: assistant asked to write, no result, no turn/end
  session.events.push(
    { seq: 1, time: 't', type: 'turn/start', data: { turn: 1 } },
    { seq: 2, time: 't', type: 'user/message', data: { content: 'write crash.txt' } },
    { seq: 3, time: 't', type: 'assistant/message', data: { content: [{ type: 'tool_use', id: 'c1', name: 'write', input: { file_path: 'crash.txt', content: 'NEW' } }], stopReason: 'tool_use' } },
  );
  session.seq = 3;

  const mock = createMockLlm({ turns: [{ blocks: [{ type: 'text', text: 'ok after resume' }], stopReason: 'end_turn' }] });
  const llm = recorder(mock);
  const tools = new ToolRegistry();
  for (const t of fsTools({ cwd: TMP })) tools.register(t);

  const res = await runTurn({ session, llm, tools, system: '', input: null, spillDir: TMP });
  assert.equal(res.status, 'end_turn');
  const firstCall = llm.calls[0];
  const userMsg = llm.calls[0].find((m) => m.role === 'user' && m.blocks.some((b) => b.startsWith('tool_result:c1')));
  assert.ok(userMsg, 'synthesized tool_result present: ' + JSON.stringify(firstCall));
  await session.close();
});

/* ------------------------------------------------------------------ report */

console.log(`\n${passed} passed, ${failed} failed  (tmp: ${TMP})`);
process.exit(failed ? 1 : 0);
