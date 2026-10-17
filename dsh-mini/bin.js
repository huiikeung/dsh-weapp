#!/usr/bin/env node
// dsh-mini CLI — entry modes mirror dsh's surface shapes in miniature:
//   dsh-mini "task"              headless: one fresh session, run the task, print, exit
//   dsh-mini                     interactive REPL in one session
//   dsh-mini --resume <id>       resume a persisted session (crash-safe)
//   dsh-mini --resume <id> "task"  resume AND immediately run a task
//   dsh-mini --list              list sessions
//   dsh-mini --mock [task]       use the scripted LLM (offline demo/tests)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import process from 'node:process';
import { Session, listSessions } from './src/session.js';
import { createLlm } from './src/llm.js';
import { createMockLlm } from './src/llm-mock.js';
import { ToolRegistry, bashTool, fsTools } from './src/tools.js';
import { buildSystemPrompt } from './src/prompt.js';
import { runTurn, consoleEcho } from './src/loop.js';
import { genId } from './src/util.js';

const HOME = path.join(process.cwd(), '.dsh-mini');
const SESSIONS = path.join(HOME, 'sessions');
const SPILL = path.join(HOME, 'spill');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--resume' || a === '--session') args.resume = argv[++i];
    else if (a === '--list') args.list = true;
    else if (a === '--mock') args.mock = true;
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--api-key') args.apiKey = argv[++i];
    else if (a === '--max-turns') args.maxTurns = Number(argv[++i]) || 32;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function printHelp() {
  console.log(`dsh-mini — minimal DeepSeek-Harness-style agent kernel

Usage:
  node bin.js "task"            run one task in a fresh session (headless)
  node bin.js                   interactive session
  node bin.js --resume <id> ["task"]   resume a persisted session
  node bin.js --list            list sessions
  node bin.js --mock ["task"]   offline demo with a scripted model

Options:
  --model <name>     model name (default deepseek-chat)
  --api-key <key>    else env DEEPSEEK_API_KEY
  --max-turns <n>    interactive turn budget (default 32)
  --verbose          log every session event to stderr

Interactive commands: /help /exit /sessions /resume <id> /new /stats`);
}

async function makeLlm(args) {
  if (args.mock) {
    // Scripted demo: look at the manifest, then answer. Proves the loop/tools/persistence offline.
    return createMockLlm({
      turns: [
        {
          blocks: [
            { type: 'text', text: 'Let me look at the project manifest first.' },
            { type: 'tool_use', id: 'demo-1', name: 'read', input: { file_path: 'package.json' } },
          ],
          stopReason: 'tool_use',
        },
        {
          blocks: [
            { type: 'text', text: 'This is dsh-mini — a minimal DeepSeek-Harness-style agent kernel: event-sourced JSONL sessions, streaming LLM client, six tools, durable retries. (mock mode: scripted response, no model called)' },
          ],
          stopReason: 'end_turn',
        },
      ],
    });
  }
  return createLlm({
    apiKey: args.apiKey || process.env.DEEPSEEK_API_KEY,
    model: args.model || process.env.MINI_MODEL || 'deepseek-chat',
  });
}

function makeTools() {
  const registry = new ToolRegistry();
  registry.register(bashTool({ cwd: process.cwd() }));
  for (const t of fsTools({ cwd: process.cwd() })) registry.register(t);
  return registry;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();

  if (args.list) {
    const rows = await listSessions(SESSIONS);
    if (!rows.length) return console.log('no sessions yet');
    for (const r of rows) console.log(`${r.id}  ${r.mtime}  ${r.title}`);
    return;
  }

  const llm = await makeLlm(args);
  const tools = makeTools();
  const system = buildSystemPrompt({ cwd: process.cwd(), model: llm.model });
  const session = await Session.open(SESSIONS, args.resume);
  await session.append('session/start', { cwd: process.cwd(), model: llm.model, resumed: !!args.resume && session.events.length > 0 });

  const echo = consoleEcho({ verbose: args.verbose });
  const ac = new AbortController();
  const onSigint = () => { ac.abort(); };
  process.on('SIGINT', onSigint);

  const task = args._.join(' ').trim();
  try {
    if (task) {
      // headless / one-shot
      const res = await runTurn({ session, llm, tools, system, input: task, spillDir: path.join(SPILL, session.id), signal: ac.signal, onText: echo.onText, onEvent: echo.onEvent });
      footer(session, res);
      process.exitCode = res.status === 'end_turn' ? 0 : 1;
      return;
    }
    // interactive REPL
    console.log(`dsh-mini ready — session ${session.id} (${session.events.length} events). Ctrl-C once to stop the current turn, twice to exit.`);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '› ' });
    let turnsLeft = args.maxTurns || 32;
    rl.prompt();
    for await (const line of rl) {
      const text = line.trim();
      if (!text) { rl.prompt(); continue; }
      if (text === '/exit' || text === '/quit') break;
      if (text === '/help') { printHelp(); rl.prompt(); continue; }
      if (text === '/sessions') { for (const r of await listSessions(SESSIONS)) console.log(`${r.id}  ${r.mtime}  ${r.title}`); rl.prompt(); continue; }
      if (text === '/stats') { console.log(`session ${session.id}: ${session.events.length} events, seq ${session.seq}, torn-line recovered: ${session.recoveredTornLine}`); rl.prompt(); continue; }
      if (text === '/new') {
        await session.close();
        const fresh = await Session.open(SESSIONS, genId('session'));
        await fresh.append('session/start', { cwd: process.cwd(), model: llm.model });
        Object.assign(session, { id: fresh.id, file: fresh.file, events: fresh.events, seq: fresh.seq, fh: fresh.fh });
        console.log(`started ${session.id}`);
        rl.prompt();
        continue;
      }
      if (text.startsWith('/resume ')) {
        const id = text.split(/\s+/)[1];
        await session.close();
        const target = await Session.open(SESSIONS, id);
        Object.assign(session, { id: target.id, file: target.file, events: target.events, seq: target.seq, fh: target.fh });
        console.log(`resumed ${session.id} (${session.events.length} events)`);
        rl.prompt();
        continue;
      }
      if (--turnsLeft < 0) { console.log('turn budget exhausted; /exit or raise --max-turns'); rl.prompt(); continue; }
      const res = await runTurn({ session, llm, tools, system, input: text, spillDir: path.join(SPILL, session.id), signal: ac.signal, onText: echo.onText, onEvent: echo.onEvent });
      if (res.status === 'error') console.log(`\n[turn failed: ${res.code}]`);
      if (res.status === 'cancelled') console.log('\n[turn cancelled — queued history kept]');
      footer(session, res);
      rl.prompt();
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    await session.close();
  }
}

function footer(session, res) {
  console.log(`\n— session ${session.id} · ${session.events.length} events · turn ${res.status}`);
}

main().catch((err) => {
  console.error(`fatal: ${err.message}`);
  process.exit(1);
});
