// Event-sourced session store: one JSON event per line, append-only, fsync per batch.
// Mirrors dsh-session-persistence-jsonl semantics in miniature:
//   - lazy materialization (create() does not touch disk until first append)
//   - torn trailing line is dropped on replay (crash recovery), history before it is kept
//   - events carry a monotonic seq assigned by the store (never by callers)
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { nowIso, genId } from './util.js';

export class Session {
  constructor(root, id) {
    this.root = root;              // directory holding all sessions
    this.id = id;                  // session id == file basename
    this.file = path.join(root, `${id}.jsonl`);
    this.events = [];              // canonical in-memory copy (source of truth for replay/derive)
    this.seq = 0;
    this.fh = null;                // append handle
    this.recoveredTornLine = false;
  }

  /** Open existing session by id, or create a new one (id optional). */
  static async open(root, id) {
    await fsp.mkdir(root, { recursive: true });
    const s = new Session(root, id || genId('session'));
    if (fs.existsSync(s.file)) await s.#load();
    return s;
  }

  async #load() {
    const raw = await fsp.readFile(this.file, 'utf8');
    const lines = raw.split('\n');
    // Torn-line recovery: only the LAST line may be partial (crash mid-write). Everything before must parse.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === '') continue;
      let evt;
      try { evt = JSON.parse(line); }
      catch {
        const isLast = i === lines.length - 1 || (i === lines.length - 2 && lines[lines.length - 1] === '');
        if (isLast) { this.recoveredTornLine = true; break; }
        throw new Error(`Corruption in ${this.file} at line ${i + 1}: intermediate line failed to parse (refusing to continue).`);
      }
      this.events.push(evt);
      if (typeof evt.seq === 'number' && evt.seq > this.seq) this.seq = evt.seq;
    }
  }

  /** Append one event; fsyncs before resolving (persist-before-proceed). */
  async append(type, data) {
    if (!this.fh) this.fh = await fsp.open(this.file, 'a');
    const evt = { seq: ++this.seq, time: nowIso(), type, data };
    this.events.push(evt);
    await this.fh.write(JSON.stringify(evt) + '\n', null, 'utf8');
    await this.fh.sync(); // fsync: durable before we show/act on it
    return evt;
  }

  async flush() { if (this.fh) { await this.fh.sync(); } }

  async close() { if (this.fh) { await this.fh.sync(); await this.fh.close(); this.fh = null; } }
}

/** List sessions with a cheap projection: id, mtime, first user message as title. */
export async function listSessions(root) {
  let names = [];
  try { names = await fsp.readdir(root); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const full = path.join(root, name);
    const st = await fsp.stat(full);
    let title = '';
    try {
      const raw = await fsp.readFile(full, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'user/message') { title = String(evt.data?.content || '').slice(0, 60); break; }
        } catch { /* skip */ }
      }
    } catch { /* unreadable: skip title */ }
    out.push({ id: name.replace(/\.jsonl$/, ''), mtime: st.mtime.toISOString(), title });
  }
  out.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return out;
}
