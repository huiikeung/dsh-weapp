// Tool registry + built-in tools, mirroring dsh-tools in miniature:
//   - defineTool: { name, description, parameters(JSON Schema), execute(args, exec) -> {text, isError?} }
//   - registry validates args against the schema before execute; invalid input becomes a normal
//     error RESULT for the model (it must not end the turn).
//   - exec.signal is honored for cooperative cancellation.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { Fail, underRoot, preview } from './util.js';

export function defineTool(def) { return def; }

export class ToolRegistry {
  constructor() { this.tools = new Map(); this.readFiles = new Set(); } // readFiles: fs-observation-lite

  register(tool) {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  schemas() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /** Mark a file as observed (read/written) so later edit/write may target it. */
  observe(absPath) { this.readFiles.add(absPath); }
  observed(absPath) { return this.readFiles.has(absPath); }

  async execute(name, args, exec) {
    const started = Date.now();
    const tool = this.tools.get(name);
    if (!tool) {
      return { text: `Error: UNKNOWN_TOOL "${name}". Available: ${[...this.tools.keys()].join(', ')}`, isError: true, durationMs: 0 };
    }
    try { args = validateArgs(tool, args); }
    catch (err) {
      return { text: `Error: invalid arguments for ${name}: ${err.message}`, isError: true, durationMs: 0 };
    }
    try {
      const out = await tool.execute(args, exec);
      return { text: out.text, isError: !!out.isError, durationMs: Date.now() - started };
    } catch (err) {
      // Tools never throw outwards: failures become results the model can interpret.
      const code = err instanceof Fail ? err.code : 'TOOL_ERROR';
      return { text: `Error (${code}): ${err.message}`, isError: true, durationMs: Date.now() - started };
    }
  }
}

function validateArgs(tool, args) {
  args = args && typeof args === 'object' ? args : {};
  const schema = tool.parameters || {};
  const required = schema.required || [];
  for (const key of required) {
    if (args[key] === undefined) throw new Fail('INVALID_ARGS', `missing required argument "${key}"`);
  }
  const props = schema.properties || {};
  for (const [key, val] of Object.entries(args)) {
    const p = props[key];
    if (!p) continue;
    if (p.type === 'string' && typeof val !== 'string') throw new Fail('INVALID_ARGS', `"${key}" must be a string`);
    if (p.type === 'number' && typeof val !== 'number') throw new Fail('INVALID_ARGS', `"${key}" must be a number`);
    if (p.type === 'boolean' && typeof val !== 'boolean') throw new Fail('INVALID_ARGS', `"${key}" must be a boolean`);
  }
  return args;
}

/* ------------------------------------------------------------------ bash */

export function bashTool({ cwd, defaultTimeoutMs = 60_000, maxOutputChars = 60_000 }) {
  return defineTool({
    name: 'bash',
    description: 'Run a bash command (fresh shell per call; cwd/env persist nothing). Nonzero exits are results to interpret. Returns stdout, stderr and an "[exit code: N]" marker.',
    parameters: {
      type: 'object',
      required: ['command'],
      properties: {
        command: { type: 'string', description: 'The bash command to execute.' },
        timeoutMs: { type: 'number', description: `Max runtime in ms (default ${defaultTimeoutMs}).` },
      },
    },
    async execute(args, exec) {
      const timeoutMs = Math.max(1000, Math.min(600_000, args.timeoutMs || defaultTimeoutMs));
      return new Promise((resolve) => {
        const child = spawn('bash', ['-c', args.command], {
          cwd,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '', errText = '', killed = false;
        const cap = 200_000;
        child.stdout.on('data', (d) => { if (out.length < cap) out += d; });
        child.stderr.on('data', (d) => { if (errText.length < cap) errText += d; });
        const timer = setTimeout(() => {
          killed = true;
          child.kill('SIGTERM');
          setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
        }, timeoutMs);
        const onAbort = () => { killed = true; try { child.kill('SIGKILL'); } catch { /* gone */ } };
        exec.signal?.addEventListener('abort', onAbort, { once: true });
        const finish = (code) => {
          clearTimeout(timer);
          exec.signal?.removeEventListener('abort', onAbort);
          let text = '';
          if (out.trim()) text += out;
          if (errText.trim()) text += (text ? '\n' : '') + '[stderr]\n' + errText;
          if (killed && exec.signal?.aborted) { resolve({ text: (text ? text + '\n' : '') + 'Error: aborted by user', isError: true }); return; }
          if (killed) text += (text ? '\n' : '') + `Error: command timed out after ${timeoutMs}ms and was killed`;
          text += (text ? '\n' : '') + `[exit code: ${code ?? 'null'}]`;
          if (text.length > maxOutputChars) {
            const cut = text.length - maxOutputChars;
            text = text.slice(0, maxOutputChars) + `\n… [${cut} more chars truncated]`;
          }
          resolve({ text });
        };
        child.on('error', (err) => { clearTimeout(timer); resolve({ text: `Error: spawn failed: ${err.message}`, isError: true }); });
        child.on('close', finish);
      });
    },
  });
}

/* -------------------------------------------------------------------- fs */

const READ_LINE_CAP = 2000;
const READ_LINE_CHARS = 2000;

export function fsTools({ cwd }) {
  const read = defineTool({
    name: 'read',
    description: 'Read a UTF-8 text file with line numbers. Use offset/limit to page through large files.',
    parameters: {
      type: 'object',
      required: ['file_path'],
      properties: {
        file_path: { type: 'string', description: 'Path (absolute, or relative to the workspace root).' },
        offset: { type: 'number', description: '1-based first line to return.' },
        limit: { type: 'number', description: `Max lines (default ${READ_LINE_CAP}).` },
      },
    },
    async execute(args, exec) {
      const abs = underRoot(cwd, args.file_path);
      const raw = await fsp.readFile(abs, 'utf8');
      const lines = raw.split('\n');
      const start = Math.max(1, args.offset || 1);
      const end = Math.min(lines.length, start + (args.limit || READ_LINE_CAP) - 1);
      const out = [];
      for (let i = start; i <= end; i++) {
        let line = lines[i - 1];
        if (line.length > READ_LINE_CHARS) line = line.slice(0, READ_LINE_CHARS) + '…';
        out.push(`${i}: ${line}`);
      }
      exec?.registry?.observe?.(abs);
      const more = end < lines.length ? `\n\n(Showing lines ${start}-${end} of ${lines.length}. Use offset=${end + 1} to continue.)` : '';
      return { text: `<path>${abs}</path>\n${out.join('\n')}${more}` };
    },
  });

  const write = defineTool({
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file. Reading the existing file first is REQUIRED when overwriting (fs-observation policy).',
    parameters: {
      type: 'object',
      required: ['file_path', 'content'],
      properties: {
        file_path: { type: 'string', description: 'Target path (absolute or relative to workspace root).' },
        content: { type: 'string', description: 'Full file content.' },
      },
    },
    async execute(args, exec) {
      const abs = underRoot(cwd, args.file_path);
      let exists = false;
      try { exists = fs.existsSync(abs) && (await fsp.stat(abs)).isFile(); } catch { exists = false; }
      if (exists && !exec.registry.observed(abs)) {
        return {
          text: `Error: FS_OBSERVATION_REQUIRED — ${abs} exists but has not been read in this session. Call read first (policies require observing before overwriting).`,
          isError: true,
        };
      }
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, args.content, 'utf8');
      exec.registry.observe(abs);
      return { text: `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${abs}` };
    },
  });

  const edit = defineTool({
    name: 'edit',
    description: 'Replace literal text in a file. The file must have been read first; old_string must match exactly once unless replace_all.',
    parameters: {
      type: 'object',
      required: ['file_path', 'old_string', 'new_string'],
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string', description: 'Literal text to replace.' },
        new_string: { type: 'string', description: 'Replacement text (empty string deletes).' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
      },
    },
    async execute(args, exec) {
      const abs = underRoot(cwd, args.file_path);
      if (!exec.registry.observed(abs)) {
        return { text: `Error: FS_OBSERVATION_REQUIRED — read ${abs} before editing.`, isError: true };
      }
      const raw = await fsp.readFile(abs, 'utf8');
      const occurrences = raw.split(args.old_string).length - 1;
      if (occurrences === 0) return { text: `Error: old_string not found in ${abs}. Copy the exact text (whitespace matters).`, isError: true };
      if (occurrences > 1 && !args.replace_all) {
        return { text: `Error: old_string appears ${occurrences} times. Add more surrounding context to make it unique, or pass replace_all: true.`, isError: true };
      }
      const next = args.replace_all
        ? raw.split(args.old_string).join(args.new_string)
        : raw.replace(args.old_string, args.new_string);
      await fsp.writeFile(abs, next, 'utf8');
      return { text: `Edited ${abs}: ${occurrences === 1 ? '1 occurrence' : `${occurrences} occurrences`} replaced.` };
    },
  });

  const glob = defineTool({
    name: 'glob',
    description: 'Find files by glob pattern (** and * supported). Skips .git and node_modules. Returns up to 100 paths, newest first.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'Glob like "src/**/*.js" or "*.json".' },
        path: { type: 'string', description: 'Directory to search (default: workspace root).' },
      },
    },
    async execute(args) {
      const base = underRoot(cwd, args.path || '.');
      const re = globToRegExp(args.pattern);
      const results = [];
      await walk(base, base, re, results);
      results.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const paths = results.slice(0, 100).map((r) => r.path);
      const note = results.length > 100 ? `\n\n(+${results.length - 100} more; refine the pattern.)` : '';
      return { text: paths.length ? paths.join('\n') + note : `No matches for ${args.pattern}` };
    },
  });

  const grep = defineTool({
    name: 'grep',
    description: 'Search file contents with a regular expression. Returns matching lines with numbers, capped at 250 matches.',
    parameters: {
      type: 'object',
      required: ['pattern'],
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression.' },
        path: { type: 'string', description: 'File or directory to search (default: workspace root).' },
        include: { type: 'string', description: 'Glob filter for files, e.g. "*.js".' },
      },
    },
    async execute(args) {
      let re;
      try { re = new RegExp(args.pattern); } catch (err) { return { text: `Error: bad regex: ${err.message}`, isError: true }; }
      const base = underRoot(cwd, args.path || '.');
      const includeRe = args.include ? globToRegExp(args.include, { basenameOnly: true }) : null;
      const matches = [];
      const st = await fsp.stat(base);
      if (st.isFile()) {
        await searchFile(base, re, matches);
      } else {
        await walkFiles(base, async (p) => {
          if (matches.length >= 250) return;
          if (includeRe && !includeRe.test(path.basename(p))) return;
          await searchFile(p, re, matches);
        });
      }
      if (!matches.length) return { text: `No matches for /${args.pattern}/` };
      const byFile = new Map();
      for (const m of matches) {
        if (!byFile.has(m.file)) byFile.set(m.file, []);
        byFile.get(m.file).push(m);
      }
      let out = '';
      for (const [file, ms] of byFile) {
        out += `${file}\n${ms.map((m) => `  ${m.line}: ${m.text}`).join('\n')}\n`;
      }
      if (matches.length >= 250) out += `\n(capped at 250 matches; narrow the search.)`;
      return { text: out.trimEnd() };
    },
  });

  return [read, write, edit, glob, grep];
}

async function searchFile(p, re, matches) {
  let raw;
  try {
    const st = await fsp.stat(p);
    if (st.size > 2_000_000) return;
    raw = await fsp.readFile(p, 'utf8');
  } catch { return; } // binary or unreadable: skip
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length && matches.length < 250; i++) {
    if (re.test(lines[i])) {
      let text = lines[i];
      if (text.length > 500) text = text.slice(0, 500) + '…';
      matches.push({ file: p, line: i + 1, text });
    }
  }
}

async function walkFiles(dir, fn, depth = 0) {
  if (depth > 12) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.dsh-reference') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, fn, depth + 1);
    else if (e.isFile()) { await fn(p); if (false) break; }
  }
}

async function walk(root, dir, re, results, depth = 0) {
  if (depth > 12 || results.length > 400) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.dsh-reference') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, p, re, results, depth + 1);
    else if (e.isFile()) {
      const rel = path.relative(root, p);
      if (re.test(rel)) {
        let mtimeMs = 0;
        try { mtimeMs = (await fsp.stat(p)).mtimeMs; } catch { /* gone */ }
        results.push({ path: rel, mtimeMs });
      }
    }
  }
}

/** Minimal glob → RegExp: ** crosses dirs, * within a segment, ? one char. */
export function globToRegExp(glob, { basenameOnly = false } = {}) {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // '**' or '**/'
        if (glob[i + 2] === '/') { src += '(?:.*/)?'; i += 2; } else { src += '.*'; i += 1; }
      } else src += '[^/]*';
    } else if (c === '?') src += '[^/]';
    else src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(basenameOnly ? `^${src}$` : `^${src}$`);
}
