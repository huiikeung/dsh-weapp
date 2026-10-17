// Node 侧协议解码冒烟测试
// 与 entry/src/main/ets/protocol/GatewayFrameCodec.ets 保持同源逻辑（纯 TS 子集），
// 在没有 DevEco SDK 的机器上验证归一化行为；正式校验仍以 DevEco 编译为准。
//
// 运行：node entry/src/test/GatewayFrameCodec.test.mjs
// 说明：.mjs 直接内联最小实现，改动 codec 后需同步本文件。

import assert from 'node:assert';

// ---- 与 codec 同源的辅助 ----
const isObj = (v) => v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (o, k) => (isObj(o) && typeof o[k] === 'string' ? o[k] : undefined);
const num = (o, k) => (isObj(o) && typeof o[k] === 'number' ? o[k] : undefined);
const bool = (o, k) => (isObj(o) && typeof o[k] === 'boolean' ? o[k] : undefined);

function decodeFrame(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('invalid JSON');
  }
  if (!isObj(parsed) || typeof parsed.kind !== 'string' || parsed.kind.length === 0) {
    throw new Error('frame missing string kind');
  }
  return parsed;
}

function normalizeEventSource(v) {
  if (typeof v === 'string') return v;
  return isObj(v) && typeof v.kind === 'string' ? v.kind : undefined;
}

const isErrorValue = (v) => !(v === undefined || v === null || v === false);

function textBlocks(value) {
  const list = Array.isArray(value) ? value : (value?.content ?? []);
  return list.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('');
}

function normalized(type, data) {
  const base = { turn: num(data, 'turn'), step: num(data, 'step') };
  switch (type) {
    case 'user/message':
      return { type, ...base, text: textBlocks(data.content), source: normalizeEventSource(data.source?.kind) };
    case 'assistant/chunk': {
      const chunk = data.chunk;
      const chunkType = chunk?.type;
      return {
        type, ...base,
        text: chunk?.text,
        chunkType,
        tool: chunkType === 'tool-call-delta'
          ? { id: chunk.id, name: chunk.name, argumentsDelta: chunk.argumentsDelta }
          : undefined,
        finish: { kind: chunk?.reason?.kind }
      };
    }
    case 'assistant/message': {
      const blocks = data.message?.content ?? [];
      return {
        type, ...base,
        text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
        reasoning: blocks.filter((b) => b.type === 'reasoning').map((b) => b.text ?? '').join(''),
        toolCalls: blocks.filter((b) => b.type === 'tool-call' && b.id && b.name)
          .map((b) => ({ id: b.id, name: b.name, arguments: b.arguments })),
        interrupted: data.interrupted
      };
    }
    case 'tool/result': {
      let isError = isErrorValue(data.error);
      if (!isError) {
        for (const block of (data.message?.content ?? [])) {
          if (block?.type === 'tool-result' && block.isError === true) { isError = true; break; }
        }
      }
      return { type, ...base, isError, callId: data.message?.source?.callId };
    }
    case 'session/title':
      return { type, ...base, text: data.title };
    default:
      return { type, ...base, isError: isErrorValue(data.error) };
  }
}

// ---- 用例 ----

// 1. 合法帧
const hello = decodeFrame('{"kind":"hello","protocol":3,"dshVersion":"1.2.0","sessionId":"s1"}');
assert.equal(hello.kind, 'hello');
assert.equal(hello.protocol, 3);

// 2. kind 缺失 → fail-closed
assert.throws(() => decodeFrame('{"protocol":3}'), /kind/);

// 3. kind 非 string → fail-closed
assert.throws(() => decodeFrame('{"kind":42}'), /kind/);

// 4. JSON 语法错误
assert.throws(() => decodeFrame('{oops'), /JSON/);

// 5. source 归一化：对象 { kind } 与字符串
assert.equal(normalizeEventSource({ kind: 'user' }), 'user');
assert.equal(normalizeEventSource('agent'), 'agent');
assert.equal(normalizeEventSource({ foo: 1 }), undefined);

// 6. user/message 归一化
const um = normalized('user/message', {
  content: [{ type: 'text', text: '你好' }, { type: 'image', attachment: {} }],
  source: { kind: 'user' }
});
assert.equal(um.text, '你好');
assert.equal(um.source, 'user');

// 7. assistant/chunk tool-call-delta
const chunk = normalized('assistant/chunk', {
  turn: 2, step: 1,
  chunk: { type: 'tool-call-delta', id: 't1', name: 'bash', argumentsDelta: '{"cmd":', reason: { kind: 'tool-calls' } }
});
assert.equal(chunk.tool.name, 'bash');
assert.equal(chunk.finish.kind, 'tool-calls');

// 8. assistant/message blocks 拆分
const am = normalized('assistant/message', {
  message: { content: [
    { type: 'text', text: 'a' }, { type: 'reasoning', text: 'think' }, { type: 'text', text: 'b' },
    { type: 'tool-call', id: 'c1', name: 'read', arguments: { path: '/x' } }
  ], usage: { totalTokens: 10 } },
  interrupted: true
});
assert.equal(am.text, 'ab');
assert.equal(am.reasoning, 'think');
assert.equal(am.toolCalls.length, 1);
assert.equal(am.toolCalls[0].arguments.path, '/x');
assert.equal(am.interrupted, true);

// 9. tool/result isError 判定
const tr1 = normalized('tool/result', { message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', isError: true }] } });
assert.equal(tr1.isError, true);
const tr2 = normalized('tool/result', { message: { content: [{ type: 'tool-result', isError: false }] } });
assert.equal(tr2.isError, false);
const tr3 = normalized('tool/result', { error: 'boom' });
assert.equal(tr3.isError, true);

// 10. session/title
assert.equal(normalized('session/title', { title: '新会话' }).text, '新会话');

console.log('GatewayFrameCodec smoke tests: all passed ✔');
