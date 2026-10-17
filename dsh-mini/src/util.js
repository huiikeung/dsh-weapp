// Small shared helpers. Zero dependencies.
import crypto from 'node:crypto';
import { resolve as resolvePath, isAbsolute } from 'node:path';

export const nowIso = () => new Date().toISOString();

export function genId(prefix = 's') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Truncate text keeping head+tail with an omission marker (UTF-8 safe: operates on code units at whole-string level). */
export function truncateMiddle(text, headChars, tailChars, marker) {
  if (text.length <= headChars + tailChars) return { text, truncated: false };
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(-tailChars) : '';
  const omitted = text.length - headChars - tailChars;
  const sep = (!head.endsWith('\n') ? '\n' : '') + marker.replace('{n}', String(omitted)) + (!tail.startsWith('\n') ? '\n' : '');
  return { text: head + sep + tail, truncated: true };
}

/** Best-effort single-line render of arbitrary values for logs. */
export function preview(value, max = 200) {
  let s;
  try { s = typeof value === 'string' ? value : JSON.stringify(value); } catch { s = String(value); }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export class Fail extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Sleep that short-circuits (resolves early) when signal aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); };
    const t = setTimeout(done, ms);
    if (signal) {
      if (signal.aborted) return done();
      signal.addEventListener('abort', done, { once: true });
    }
  });
}

/** Jittered exponential backoff: 500ms → 10s, ±10% (mirrors dsh-llm-retry defaults). */
export function backoffDelay(attempt, { base = 500, cap = 10000, jitter = 0.1 } = {}) {
  const raw = Math.min(cap, base * 2 ** (attempt - 1));
  const j = raw * jitter;
  return Math.round(raw - j + Math.random() * j * 2);
}

/** Canonicalize a path and ensure it stays under root. Returns absolute path or throws Fail('PATH_OUTSIDE_WORKSPACE'). */
export function underRoot(root, p) {
  const abs = isAbsolute(p) ? resolvePath(p) : resolvePath(root, p);
  const r = root.endsWith('/') ? root : root + '/';
  if (abs !== root && !abs.startsWith(r)) {
    throw new Fail('PATH_OUTSIDE_WORKSPACE', `Refused: ${abs} is outside the workspace root ${root} (workspace-write policy).`);
  }
  return abs;
}
