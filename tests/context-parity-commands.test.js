// 命令执行卡 ⇄ dsh-context v0.74.0 契约（spec-fleet.md §10 的可落地部分）。
//
// 宿主横切：tool/call ↔ tool/result 配对成命令账本（参数、耗时、退出码/信号/超时、
// 输出字符、stderr、后台），客户端做 KPI、筛选 chips（全部/失败/慢/后台）、
// 命令行、展开详情（完整命令 + facts + 复制 + 在浏览器定位）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'miniprogram');
const wxss = fs.readFileSync(path.join(root, 'pages/session/session.wxss'), 'utf8');
const wxml = fs.readFileSync(path.join(root, 'pages/session/session.wxml'), 'utf8');
const view = require(path.join(root, 'utils/context-view'));

const t = (key, values) => (values
  ? Object.keys(values).reduce((text, name) => text.split('{' + name + '}').join(String(values[name])), key)
  : key);

function value() {
  return {
    commandStats: { runs: 4, failed: 2, ms: 12000, bg: 1 },
    commands: [
      { seq: 11, time: 1700000001000, name: 'bash', command: 'make test', durationMs: 5000, status: 'ok', exit: 0, outChars: 1200 },
      { seq: 15, time: 1700000005000, name: 'bash', command: 'sleep 10 && exit 2', durationMs: 6000, status: 'failed', exit: 2, stderr: true, description: '长任务' },
      { seq: 21, time: 1700000009000, name: 'bash', command: 'npm run dev', durationMs: 800, status: 'ok', background: true },
      { seq: 25, time: 1700000013000, name: 'bash', command: 'kill -9', durationMs: 200, status: 'killed', signal: 'SIGKILL', timedOut: true }
    ]
  };
}

test('KPI, filter chips and status glyphs mirror the plugin card', () => {
  const commands = view.deriveCommands(value(), t, {});
  assert.deepEqual(commands.kpi.map(item => [item.key, item.valueText]), [['runs', '4'], ['failed', '2'], ['ms', '12.0s'], ['bg', '1']]);
  assert.deepEqual(commands.chunks.map(chip => chip.key), ['all', 'failed', 'slow', 'background']);
  assert.deepEqual(commands.chunks.map(chip => chip.countText), ['4', '2', '2', '1']);
  assert.equal(commands.countText, '4 次执行');
  const failed = view.deriveCommands(value(), t, { filter: 'failed' });
  assert.deepEqual(failed.rows.map(row => row.seq), [25, 15], 'newest first, non-ok only');
  const slow = view.deriveCommands(value(), t, { filter: 'slow' });
  assert.deepEqual(slow.rows.map(row => row.seq), [15, 11]);
  const bg = view.deriveCommands(value(), t, { filter: 'background' });
  assert.deepEqual(bg.rows.map(row => row.seq), [21]);
  assert.equal(commands.rows[0].statusGlyph, '✕');
  assert.equal(commands.rows[0].statusClass, 'killed');
  assert.equal(commands.rows[1].statusGlyph, '✓');
  assert.equal(commands.rows[1].durationText, '800ms');
});

test('expanded rows expose facts, full command text and actions', () => {
  const base = view.deriveCommands(value(), t, {});
  const target = base.rows.find(item => item.seq === 15);
  const expanded = view.deriveCommands(value(), t, { expandedId: target.key });
  const row = expanded.rows.find(item => item.seq === 15);
  assert.equal(row.expanded, true);
  assert.equal(row.commandText, 'sleep 10 && exit 2');
  assert.equal(row.description, '长任务');
  assert.match(row.factsText, /退出码 2/);
  assert.match(row.factsText, /stderr/);
  const timedOut = expanded.rows.find(item => item.seq === 25);
  assert.match(timedOut.factsText, /信号 SIGKILL/);
  assert.match(timedOut.factsText, /超时/);
  assert.match(wxss, /\.ctx-cmd-ok\s*\{[^}]*var\(--success\)/);
  assert.match(wxss, /\.ctx-cmd-failed, \.ctx-cmd-killed\s*\{[^}]*#E5484D/);
  assert.match(wxss, /\.ctx-cmd-code\s*\{[^}]*white-space:\s*pre-wrap/);
  assert.match(wxml, /id="ctxCommandCard"/);
  assert.match(wxml, /catchtap="copyContextCommand"/);
  assert.match(wxml, /catchtap="locateContextCommand" data-seq="\{\{item\.seq\}\}"/);
  assert.match(wxml, /class="ctx-cmd-status ctx-cmd-\{\{item\.statusClass\}\}"/);
});

test('panel wires the ledger into the context panel and page handlers exist', () => {
  const panel = view.buildPanel({ value: Object.assign({
    v: 1, current: {}, counts: {}, requests: [], events: [], surface: [],
    usage: null, breakdown: null, stats: null
  }, value()) }, { t: t, connected: true, hasSession: true });
  assert.equal(panel.status, 'ready');
  assert.equal(panel.commands.available, true);
  assert.equal(panel.commands.rows.length, 4);
  const session = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
  assert.match(session, /setContextCommandFilter\(e\)/);
  assert.match(session, /toggleContextCommand\(e\)/);
  assert.match(session, /copyContextCommand\(e\)/);
  assert.match(session, /locateContextCommand\(e\)[\s\S]*?setContextBrowser\(seq, \['tool'\], false\)/);
});
