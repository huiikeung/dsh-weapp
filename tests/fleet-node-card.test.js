const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadView() {
  const file = path.resolve(__dirname, '../miniprogram/pages/session/utils/context-view.js');
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    module: mod, exports: mod.exports, console, Date, Object, Array, String, Number,
    Math, JSON, RegExp, Error, isNaN, parseInt, parseFloat,
    require: (name) => require(path.resolve(path.dirname(file), name)),
  });
  return mod.exports;
}

const t = (s) => s;
const layout = (agents, cardOf = () => null) =>
  loadView().layoutFleetGraph(agents, 360, { currentSessionId: 'root', selectedId: '', cardOf, t });

test('the card foot always carries duration and steps, even without a fleet card', () => {
  const graph = layout([{
    sessionId: 'root', phase: 'done', steps: 1500, tokensTotal: 723_700_000,
    subagentTiming: { settledMs: (5 * 3600 + 55 * 60) * 1000 },
  }]);
  // 设计稿左下角就是「5h55m · 1500 步」：步数是计数，不做 1.5k 压缩。
  assert.equal(graph.nodes[0].metaText, '5h55m · 1500 步');
});

test('duration uses DSH timing data and does not estimate from unrelated stats', () => {
  const viaTimeline = layout([{ sessionId: 'root', phase: 'done', steps: 12, contextTimeline: { timing: { wallMs: 95_000 } } }]);
  assert.equal(viaTimeline.nodes[0].metaText, '1m35s · 12 步');

  const missing = layout([{ sessionId: 'root', phase: 'done', steps: 3, stats: { llmMs: 60_000, toolMs: 60_000 } }]);
  assert.equal(missing.nodes[0].metaText, '— · 3 步');
});

test('subagent task labels take precedence over generic session titles', () => {
  const panel = loadView().buildFleetPanel({ value: {
    rootSessionId: 'root', currentSessionId: 'root',
    agents: [
      { sessionId: 'root', depth: 0, title: 'Root' },
      { sessionId: 'child', depth: 1, origin: 'subagent', title: 'Conversation', label: 'Analyze client perf regressions' }
    ]
  } }, { t, connected: true, hasSession: true, stageWidth: 360 });
  assert.equal(panel.graph.nodes.find(node => node.id === 'child').title, 'Analyze client perf regressions');
});

test('a short final leaf row is centered in the graph stage', () => {
  const graph = layout([
    { sessionId: 'a', depth: 0, title: 'A' },
    { sessionId: 'b', depth: 0, title: 'B' },
    { sessionId: 'c', depth: 0, title: 'C' }
  ]);
  const last = graph.nodes.find(node => node.id === 'c');
  assert.equal(last.y, graph.nodes[0].y + loadView().FLEET_LEVEL_H);
  assert.equal(last.x + last.w / 2, graph.width / 2);
});

test('the status dot matches the design ratio and keeps every state colour', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  const dot = css.match(/\.fleet-node-state,\s*\.fleet-member-dot,\s*\.fleet-task-dot\s*\{([^}]*)\}/)[1];
  // 设计稿：卡片 140px 高时圆点 9px -> 18rpx（20rpx 偏大）。
  assert.match(dot, /width:\s*18rpx/, 'the dot is 18rpx wide');
  assert.match(dot, /height:\s*18rpx/, 'the dot is 18rpx tall');
  assert.match(css, /\.fleet-node-state\.done::after,[\s\S]*?background:\s*var\(--success\)/, 'finished agents use the compact DSH green core');
  assert.match(css, /\.fleet-node-state\.running::after,[\s\S]*?animation:\s*fleet-spin 1\.5s linear infinite/, 'running agents spin');
  assert.match(css, /\.fleet-node-state::after,[\s\S]*?inset:\s*20%/, 'static states use DSH-sized inner dots');
});

test('the Agent Network keeps its outer border without a nested graph frame', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  assert.match(css, /\.ctx-card\.fleet-graph-card\s*\{[^}]*border:\s*1rpx solid var\(--border\)/,
    'the outer Agent Network panel retains its border');
  assert.match(css, /\.fleet-graph-card \.fleet-stage\s*\{[^}]*border:\s*0[^}]*background:\s*transparent/,
    'the graph canvas does not draw a second frame inside the panel');
});

test('the task board card renders subject, body and meta', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  let row = wxml.slice(wxml.indexOf('wx:for="{{fleetPanel.team.tasks}}"'));
  row = row.slice(0, row.indexOf('</view>', row.indexOf('fleet-task-foot')) + 8);
  assert.match(row, /class="fleet-task-subject">\{\{item\.subject\}\}<\/text>/, 'the card has a subject line');
  assert.match(row, /wx:if="\{\{item\.bodyText\}\}" class="fleet-task-body">[\s\S]*?\{\{item\.bodyText\}\}<\/text>/,
    'the body renders under the subject when the gateway forwards it');
  assert.match(row, /item\.modelText/, 'delegated-agent tasks include their reported model when present');
  assert.match(wxss, /\.fleet-task-body\s*\{[^}]*line-clamp:\s*2/, 'the body clamps to two lines');
  // 网关侧必须透传 description，否则 bodyText 恒为空。
  const bridge = fs.readFileSync(path.resolve(__dirname, '../../dsh-plugin-weapp-gateway/lib/context-bridge.mjs'), 'utf8');
  assert.match(bridge, /entry\.description = task\.description\.slice\(0, TEAM_TASK_DESCRIPTION_MAX\)/,
    'the gateway forwards the host task description');
});
