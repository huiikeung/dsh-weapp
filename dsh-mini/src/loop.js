// The turn/step machine, miniature dsh-agent-loop:
//   turn/start → [step: LLM stream → persist assistant ONCE complete → execute tools → persist results]* → turn/end
//   - persist-before-act: every durable state change hits the log (fsync) before the next action
//   - durable-before-wait: retry decisions and backoff sleeps are LOGGED first, then awaited
//   - crash semantics: unanswered tool_use calls are answered on the next resume with
//     TOOL_OUTCOME_UNKNOWN (only idempotent/read-only retries allowed) — deriveMessages()
//   - cancellation: cooperative via AbortSignal; streamed text already delivered is kept
import { LlmError, RETRYABLE, collector } from './llm.js';
import { nowIso, sleep, backoffDelay, preview } from './util.js';
import { inlineToolResult } from './context.js';

const MAX_RETRIES = 5;
const MAX_STEPS_PER_TURN = 48;

/* ------------------------------------------------------- history replay */

/** Rebuild Anthropic `messages` from session events, synthesizing results for unanswered tool calls. */
export function deriveMessages(events) {
  const messages = [];
  let openAssistant = null;   // assistant content blocks awaiting tool results
  let openResults = new Map(); // tool_use_id -> tool_result block

  const flush = () => {
    if (!openAssistant) return;
    messages.push({ role: 'assistant', content: openAssistant });
    const toolUses = openAssistant.filter((b) => b.type === 'tool_use');
    if (toolUses.length) {
      const content = [];
      for (const block of toolUses) {
        const got = openResults.get(block.id);
        if (got) content.push(got);
        else {
          content.push({
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: true,
            content: [{ type: 'text', text: 'Error (TOOL_OUTCOME_UNKNOWN): the process was interrupted while this tool ran. Its outcome is unknown — only retry if the operation is read-only or idempotent; otherwise verify current state first.' }],
          });
        }
      }
      messages.push({ role: 'user', content });
    }
    openAssistant = null;
    openResults = new Map();
  };

  for (const evt of events) {
    switch (evt.type) {
      case 'user/message':
        flush();
        messages.push({ role: 'user', content: [{ type: 'text', text: String(evt.data?.content ?? '') }] });
        break;
      case 'assistant/message':
        flush();
        openAssistant = (evt.data?.content || []).filter((b) => ['text', 'thinking', 'tool_use'].includes(b.type));
        break;
      case 'tool/result':
        if (openAssistant) {
          openResults.set(evt.data?.toolUseId, {
            type: 'tool_result',
            tool_use_id: evt.data?.toolUseId,
            is_error: !!evt.data?.isError,
            content: [{ type: 'text', text: String(evt.data?.content ?? '') }],
          });
        }
        break;
      default:
        break; // session/start, turn/*, llm/retry, … are not model-visible
    }
  }
  flush();
  return messages;
}

/* ------------------------------------------------------------ turn loop */

/**
 * Run one turn to completion.
 * @returns {{status:'end_turn'|'cancelled'|'error'|'max_steps', text?, code?}}
 */
export async function runTurn({ session, llm, tools, system, input, spillDir, signal, onText, onEvent }) {
  const emit = (type, data) => { onEvent?.({ type, data }); return session.append(type, data); };
  await emit('turn/start', { turn: countTurns(session.events) + 1 });

  // Accept ≠ commit: an abort during pre-step phases means the prompt never lands in history.
  if (signal?.aborted) return await finish(session, emit, 'cancelled');
  if (input && String(input).trim()) {
    await emit('user/message', { content: String(input) });
  }

  let step = 0;
  while (true) {
    if (signal?.aborted) return await finish(session, emit, 'cancelled');
    if (++step > MAX_STEPS_PER_TURN) return await finish(session, emit, 'max_steps');

    const messages = deriveMessages(session.events);
    const col = collector();
    let terminal = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      terminal = await streamOnce({ llm, system, messages, tools, signal, col, onText });
      if (terminal.kind === 'finish') break;
      if (terminal.kind === 'aborted') {
        await keepStreamedText(session, emit, col);
        return await finish(session, emit, 'cancelled');
      }
      // error terminal
      const retryable = RETRYABLE.has(terminal.code);
      if (retryable && attempt < MAX_RETRIES) {
        const delayMs = terminal.retryAfterMs ?? backoffDelay(attempt);
        // durable-before-wait: log the retry, THEN sleep
        await emit('llm/retry', { attempt, code: terminal.code, message: terminal.message, delayMs });
        try { await sleep(delayMs, signal); } catch { /* aborted during backoff */ }
        if (signal?.aborted) return await finish(session, emit, 'cancelled');
        continue;
      }
      await emit('llm/error', { code: terminal.code, message: terminal.message });
      return await finish(session, emit, 'error', terminal.code);
    }

    // Success: persist the complete assistant message exactly once.
    const blocks = col.blocks;
    await emit('assistant/message', {
      content: blocks,
      stopReason: col.stopReason,
      usage: col.usage,
      model: llm.model,
    });

    const calls = blocks.filter((b) => b.type === 'tool_use');
    if (col.stopReason !== 'tool_use' || calls.length === 0) {
      return await finish(session, emit, 'end_turn');
    }

    // Execute tool calls sequentially (exclusive-barrier semantics; parallel pool is a later upgrade).
    for (const call of calls) {
      if (signal?.aborted) {
        await emit('tool/result', {
          toolUseId: call.id, name: call.name,
          content: 'Error (ABORTED_BEFORE_DISPATCH): cancelled before this call ran.',
          isError: true,
        });
        continue;
      }
      onEvent?.({ type: 'tool/call', data: { name: call.name, args: call.input } });
      const exec = { signal, registry: tools };
      const result = await tools.execute(call.name, call.input, exec);
      const inlined = await inlineToolResult(result.text, {
        spillDir,
        spillName: `${session.id}-${call.id}.txt`,
      });
      if (inlined.spilled) onEvent?.({ type: 'context/truncated', data: { name: call.name, spillPath: inlined.spillPath } });
      await emit('tool/result', {
        toolUseId: call.id,
        name: call.name,
        content: inlined.text,
        isError: result.isError,
        durationMs: result.durationMs,
      });
    }
  }
}

async function streamOnce({ llm, system, messages, tools, signal, col, onText }) {
  let terminal = null;
  try {
    for await (const chunk of llm.stream({ system, messages, tools: tools.schemas(), signal })) {
      if (chunk.kind === 'finish' || chunk.kind === 'error' || chunk.kind === 'aborted') { terminal = chunk; break; }
      const echo = col.add(chunk);
      if (echo && onText) onText(echo);
    }
  } catch (err) {
    // fetch abort throws inside the generator body in some runtimes; normalize:
    if (signal?.aborted) return { kind: 'aborted' };
    terminal = { kind: 'error', code: err instanceof LlmError ? err.code : 'TRANSPORT', message: err.message };
  }
  if (!terminal) terminal = { kind: 'error', code: 'EMPTY_RESPONSE', message: 'stream ended without terminal chunk' };
  col.add(terminal.kind === 'finish' ? terminal : { kind: 'finish', stopReason: null }); // settle open blocks
  return terminal;
}

/** Preserve text already streamed to the user (dsh cancellation semantics). */
async function keepStreamedText(session, emit, col) {
  const texts = col.blocks.filter((b) => b.type === 'text' && b.text.trim());
  if (texts.length) {
    await emit('assistant/message', {
      content: texts,
      stopReason: 'aborted',
      usage: null,
      model: 'partial',
    });
  }
}

function countTurns(events) {
  return events.filter((e) => e.type === 'turn/start').length;
}

async function finish(session, emit, reason, code) {
  await emit('turn/end', { reason, ...(code ? { code } : {}), time: nowIso() });
  return { status: reason, code };
}

/** Console echo helper: stream text + tool lines to a terminal. */
export function consoleEcho({ verbose = false } = {}) {
  let inText = false;
  return {
    onText(delta) {
      if (!inText) { inText = true; process.stdout.write('\n'); }
      process.stdout.write(delta);
    },
    onEvent(evt) {
      if (evt.type === 'tool/call') {
        if (inText) { process.stdout.write('\n'); inText = false; }
        console.log(`\n→ ${evt.data.name}(${preview(evt.data.args, 120)})`);
      } else if (evt.type === 'llm/retry') {
        console.log(`  retry #${evt.data.attempt} after ${evt.data.code} in ${evt.data.delayMs}ms — ${preview(evt.data.message, 120)}`);
      } else if (evt.type === 'context/truncated') {
        console.log(`  (tool output truncated; full text at ${evt.data.spillPath})`);
      } else if (evt.type === 'turn/end') {
        if (inText) { process.stdout.write('\n'); inText = false; }
      } else if (verbose) {
        console.log(`  [${evt.type}]`);
      }
    },
  };
}
