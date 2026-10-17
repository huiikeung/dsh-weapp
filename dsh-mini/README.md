# dsh-mini

Minimal DeepSeek-Harness-style agent kernel — a study clone of DSH's core workflow in ~700 lines, **zero dependencies** (Node ≥ 20 built-ins only).

## What it mirrors from DSH

| DSH concept | dsh-mini implementation |
|---|---|
| Event-sourced sessions (dsh-session-persistence-jsonl) | one JSON event per line, `seq` + `time`, append + **fsync before proceeding** |
| Torn-line crash recovery | trailing partial line dropped on replay; intermediate corruption is fatal |
| turn/step machine (dsh-agent-loop) | `turn/start → [stream → persist assistant once → run tools → persist results]* → turn/end` |
| Accept ≠ commit | abort during pre-step phases ⇒ prompt never lands in history |
| Stream is UI sugar | streamed chunks are echoed but only the complete message is persisted |
| Durable retries (dsh-llm-retry) | `llm/retry` event logged **before** the backoff sleep; 5 attempts, 500ms→10s ±10% jitter, Retry-After honored |
| Stable error codes (dsh-llm) | AUTH / RATE_LIMIT / SERVER / TIMEOUT / TRANSPORT / EMPTY_RESPONSE / REQUEST |
| Crash synthesis | resumed turns answer orphaned `tool_use` with `TOOL_OUTCOME_UNKNOWN` (retry only if idempotent) |
| Spill policy (dsh-spill-policy) | tool output >12k chars → head+tail inline, full text spilled to `.dsh-mini/spill/` |
| fs-observation policy | `write` requires prior read of existing files; creation counts as observation |
| workspace-write fence | `write`/`edit`/`glob`/`grep` refuse paths outside the workspace root (fail-closed) |
| Cancellation keeps history | Ctrl-C once: turn cancelled, streamed text kept, queue intact |

## Usage

```bash
export DEEPSEEK_API_KEY=sk-…        # required unless --mock

node bin.js "explain this repo"     # headless: fresh session, run, exit
node bin.js                         # interactive (· /help /sessions /stats /new /resume <id>)
node bin.js --resume <id> "task"    # resume a persisted session
node bin.js --list                  # list sessions
node bin.js --mock "demo"           # offline scripted demo (no model called)

npm test                            # 11-test suite: tools, persistence, retries, crash-resume
```

Options: `--model <name>` (default `deepseek-chat`), `--api-key`, `--max-turns`, `--verbose`.

## Layout

```
bin.js            CLI entry (headless / REPL / resume / list / mock)
src/session.js    JSONL event store (append+fsync, torn-line recovery, replay)
src/llm.js        DeepSeek /v1/messages SSE client; terminal-finish guarantee; collector()
src/llm-mock.js   scripted LLM for tests/offline
src/tools.js      defineTool + registry (schema validation) + bash/read/write/edit/glob/grep
src/context.js    spill policy (head/tail + full-output file)
src/prompt.js     system prompt assembly (ordered sections)
src/loop.js       turn/step machine + deriveMessages() + durable retry + cancel
test/run-tests.js test suite (plain node:assert)
```

## Deliberately out of scope (next phases)

- sandbox-exec / approval waterfall (phase 3 in the roadmap)
- prompt-in-history KV-cache reconciliation (currently `system` is a request field)
- parallel tool pool, steer/queue inbox, plan mode, goal driver, subagents, compaction, web GUI

## Notes

- Sessions live in `.dsh-mini/sessions/` relative to the directory you launch from.
- The LLM wire format is Anthropic-compatible (`/v1/messages`), same as DSH's DeepSeek adapter; any OpenAI-compatible Anthropic endpoint can be substituted via `DEEPSEEK_BASE_URL`.
