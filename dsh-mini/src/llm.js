// Provider-neutral-ish LLM client for DeepSeek's Anthropic-compatible endpoint,
// mirroring dsh-llm + dsh-llm-deepseek in miniature:
//   - stream() yields token-level chunks and ends with EXACTLY ONE terminal chunk:
//       {kind:'finish', stopReason, usage} | {kind:'error', code, message} | {kind:'aborted'}
//   - stable error codes for routing (AUTH / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT / EMPTY_RESPONSE / REQUEST)
//   - retry policy is owned here (dsh-llm-retry): retryable codes, backoff, Retry-After honored by caller
import { Fail } from './util.js';

export const RETRYABLE = new Set(['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE']);

export class LlmError extends Error {
  constructor(code, message, { retryAfterMs = null } = {}) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

const DEFAULT_BASE = 'https://api.deepseek.com/anthropic';

export function createLlm({ apiKey, baseUrl, model = 'deepseek-chat', maxTokens = 8192, streamIdleTimeoutMs = 300_000 }) {
  const base = (baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

  if (!apiKey) {
    // fail-closed: no key, no silent degradation
    throw new Fail('MISSING_CREDENTIAL', 'DEEPSEEK_API_KEY is not set. Export it or pass --api-key (see README).');
  }

  /**
   * Stream one assistant turn.
   * @returns {AsyncGenerator<Chunk>} chunks: block-start | text-delta | thinking-delta | toolinput-delta | block-stop | finish(terminal)
   */
  async function* stream({ system, messages, tools, signal }) {
    let res;
    const started = Date.now();
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, system, messages, tools }),
      });
    } catch (err) {
      if (signal?.aborted) { yield { kind: 'aborted' }; return; }
      yield { kind: 'error', code: 'TRANSPORT', message: `connect failed: ${err.message}` };
      return;
    }

    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      const retryAfter = res.headers.get('retry-after');
      const retryAfterMs = retryAfter ? (Number.isNaN(Number(retryAfter)) ? null : Number(retryAfter) * 1000) : null;
      const code = res.status === 401 || res.status === 403 ? 'AUTH'
        : res.status === 429 ? 'RATE_LIMIT'
        : res.status >= 500 ? 'SERVER'
        : 'REQUEST';
      yield { kind: 'error', code, message: `HTTP ${res.status}: ${body.slice(0, 500)}`, retryAfterMs };
      return;
    }

    // SSE parse
    let reader;
    try { reader = res.body.getReader(); } catch {
      yield { kind: 'error', code: 'TRANSPORT', message: 'response body unreadable' };
      return;
    }
    const decoder = new TextDecoder();
    let buf = '';
    let sawStop = false;
    let sawBlock = false;
    let usage = null;
    let stopReason = null;

    const idle = { ms: streamIdleTimeoutMs };
    try {
      while (true) {
        if (signal?.aborted) { yield { kind: 'aborted' }; return; }
        const timer = new Promise((resolve) => {
          const t = setTimeout(() => resolve('idle'), idle.ms);
          if (typeof t.unref === 'function') t.unref();
        });
        const race = await Promise.race([reader.read(), timer]);
        if (race === 'idle') { yield { kind: 'error', code: 'TIMEOUT', message: `stream idle > ${idle.ms}ms` }; return; }
        const { done, value } = race;
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          switch (evt.type) {
            case 'message_start':
              usage = evt.message?.usage || usage;
              break;
            case 'content_block_start':
              sawBlock = true;
              yield { kind: 'block-start', index: evt.index, block: evt.content_block };
              break;
            case 'content_block_delta': {
              const d = evt.delta || {};
              if (d.type === 'text_delta') yield { kind: 'text-delta', text: d.text };
              else if (d.type === 'thinking_delta') yield { kind: 'thinking-delta', text: d.thinking };
              else if (d.type === 'input_json_delta') yield { kind: 'toolinput-delta', index: evt.index, partial: d.partial_json };
              break;
            }
            case 'content_block_stop':
              yield { kind: 'block-stop', index: evt.index };
              break;
            case 'message_delta':
              stopReason = evt.delta?.stop_reason || stopReason;
              if (evt.usage) usage = { ...usage, ...evt.usage };
              break;
            case 'message_stop':
              sawStop = true;
              break;
            case 'error':
              yield { kind: 'error', code: evt.error?.type === 'overloaded_error' ? 'RATE_LIMIT' : 'SERVER', message: evt.error?.message || 'stream error event' };
              return;
            case 'ping':
              break;
            default:
              break;
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) { yield { kind: 'aborted' }; return; }
      yield { kind: 'error', code: 'TRANSPORT', message: `stream read failed: ${err.message}` };
      return;
    }

    if (!sawStop || (!sawBlock && !stopReason)) {
      yield { kind: 'error', code: 'EMPTY_RESPONSE', message: `stream ended without message_stop (after ${Date.now() - started}ms)` };
      return;
    }
    yield { kind: 'finish', stopReason: stopReason || 'end_turn', usage }; // the one terminal chunk
  }

  return { model, stream };
}

/** Assemble streaming chunks into complete message content blocks. Shared by real and mock loops. */
export function collector() {
  const blocks = [];           // finished content blocks (text/thinking/tool_use)
  const open = new Map();      // index -> mutable block
  let stopReason = null;
  let usage = null;

  return {
    get blocks() { return blocks; },
    get stopReason() { return stopReason; },
    get usage() { return usage; },
    /** Feed one non-terminal chunk; returns text to echo (or null). */
    add(chunk) {
      switch (chunk.kind) {
        case 'block-start': {
          const b = chunk.block;
          if (b.type === 'text') open.set(chunk.index, { type: 'text', text: '' });
          else if (b.type === 'thinking') open.set(chunk.index, { type: 'thinking', thinking: '' });
          else if (b.type === 'tool_use') open.set(chunk.index, { type: 'tool_use', id: b.id, name: b.name, input: '' });
          return null;
        }
        case 'text-delta': {
          for (const b of open.values()) if (b.type === 'text') { b.text += chunk.text; return chunk.text; }
          blocks.push({ type: 'text', text: chunk.text });
          return chunk.text;
        }
        case 'thinking-delta': {
          for (const b of open.values()) if (b.type === 'thinking') { b.thinking += chunk.text; }
          return null;
        }
        case 'toolinput-delta': {
          const b = open.get(chunk.index);
          if (b && b.type === 'tool_use') b.input += chunk.partial || '';
          return null;
        }
        case 'block-stop': {
          const b = open.get(chunk.index);
          if (b) {
            if (b.type === 'tool_use') {
              try { b.input = b.input ? JSON.parse(b.input) : {}; }
              catch { b.input = {}; b.parseError = true; }
            }
            blocks.push(b);
            open.delete(chunk.index);
          }
          return null;
        }
        case 'finish': {
          stopReason = chunk.stopReason;
          usage = chunk.usage || usage;
          return null;
        }
        default:
          return null;
      }
    },
  };
}
