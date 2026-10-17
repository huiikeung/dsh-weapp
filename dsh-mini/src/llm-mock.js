// Scripted LLM for tests/offline demos: streams a prearranged sequence of assistant turns.
// Each script entry: { blocks: [contentBlocks], stopReason: 'tool_use'|'end_turn' }
import { LlmError } from './llm.js';

export function createMockLlm({ turns = [], failWith = null } = {}) {
  let i = 0;
  return {
    model: 'mock-model',
    async *stream({ signal }) {
      if (signal?.aborted) { yield { kind: 'aborted' }; return; }
      await new Promise((r) => setTimeout(r, 5)); // simulate latency
      if (failWith) {
        yield { kind: 'error', code: failWith.code || 'SERVER', message: failWith.message || 'mock failure' };
        return;
      }
      const turn = turns[i];
      if (!turn) {
        yield { kind: 'error', code: 'EMPTY_RESPONSE', message: 'mock script exhausted' };
        return;
      }
      i++;
      let index = 0;
      for (const block of turn.blocks) {
        if (block.type === 'text') {
          yield { kind: 'block-start', index, block: { type: 'text' } };
          for (const piece of chunkString(block.text)) yield { kind: 'text-delta', text: piece };
          yield { kind: 'block-stop', index };
        } else if (block.type === 'tool_use') {
          yield { kind: 'block-start', index, block: { type: 'tool_use', id: block.id, name: block.name } };
          const json = JSON.stringify(block.input);
          for (const piece of chunkString(json)) yield { kind: 'toolinput-delta', index, partial: piece };
          yield { kind: 'block-stop', index };
        }
        index++;
      }
      yield { kind: 'finish', stopReason: turn.stopReason || 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } };
    },
  };
}

function chunkString(s, n = 7) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

// Re-export so tests can assert against the same error shape.
export { LlmError };
