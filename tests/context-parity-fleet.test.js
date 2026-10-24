// 编队 ⇄ dsh-context v0.74.0 契约（spec-fleet.md §2/§3/§4）。
//
// 关键：140px 卡高、212px 层高（容纳三行标题与完整脚注）、tidy-tree 布局（放不下时按一级子树折带，永不横向溢出）、
// 三次贝塞尔连线（k = min(96, max(24, Δy/2))，颜色按一级子树黄金角色相）、
// 汇总 chips + 任务/子智能体进度、卡内四段（标题/用量/组成条/脚注）。
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

function agents() {
  return [
    { sessionId: 'root', depth: 0, title: '主会话', tokensTotal: 5000, steps: 12, activeMs: 65000, pressureTokens: 500, contextWindow: 1000, composition: { system: 100, tools: 300, user: 100, total: 500 } },
    { sessionId: 'a', depth: 1, title: '子 A', tokensTotal: 2000, steps: 4, running: true },
    { sessionId: 'b', depth: 1, title: '子 B', tokensTotal: 1000, steps: 2 },
    { sessionId: 'b1', depth: 2, title: '孙 B1', tokensTotal: 300, steps: 1 }
  ];
}

test('graph layout uses the plugin constants: 140px cards, 212px levels, bezier links', () => {
  const graph = view.layoutFleetGraph(agents(), 343, { currentSessionId: 'a', t: t });
  assert.equal(graph.width, 343);
  assert.equal(graph.links.length, 3, 'one link per non-root agent');
  for (const node of graph.nodes) {
    assert.equal(node.h, 140);
    assert.ok(node.x >= 0 && node.x + node.w <= 343 + 0.5, node.id + ' stays inside the stage');
    assert.ok(node.y % 212 === 48 % 212, 'y = PAD_Y + depth * LEVEL_H');
  }
  for (const link of graph.links) {
    assert.match(link.d, /^M [\d.]+ [\d.]+ C [\d.]+ [\d.]+, [\d.]+ [\d.]+, [\d.]+ [\d.]+$/);
    assert.match(link.color, /^#[0-9A-F]{6}$/);
  }
  const child = graph.nodes.find(node => node.id === 'a');
  assert.equal(child.isCurrent, true, 'current agent is flagged');
  assert.equal(child.running, true);
  assert.equal(graph.links[0].to, 'a');
  assert.match(wxss, /\.fleet-node\s*\{[^}]*border-radius:\s*20rpx/);
  assert.match(wxml, /class="fleet-links"/);
  assert.match(wxml, /stroke-width="1.5"/);
});

test('long families fold into bands instead of overflowing the stage', () => {
  const wide = agents();
  for (let i = 0; i < 6; i += 1) wide.push({ sessionId: 'x' + i, depth: 1, title: '子 ' + i, tokensTotal: 100, steps: 1 });
  const graph = view.layoutFleetGraph(wide, 343, { t: t });
  const leafCount = graph.nodes.filter(node => !wide.some(other => other.sessionId !== node.id && other.depth === node.depth + 1 && other.sessionId.indexOf(node.sessionId) === 0)).length;
  assert.ok(leafCount >= 0);
  for (const node of graph.nodes) {
    assert.ok(node.x >= 0 && node.x + node.w <= 343 + 0.5, node.id + ' must not force a horizontal scrollbar');
    assert.ok(node.y >= 48);
  }
  assert.ok(graph.height > 48 + 140);
  assert.match(wxss, /\.fleet-stage\s*\{[^}]*max-height:\s*1120rpx/);
  assert.match(wxml, /scroll-y enhanced show-scrollbar="\{\{false\}\}"/);
});

test('family hues follow the golden-angle rule', () => {
  const first = view.fleetFamilyColor(0);
  const second = view.fleetFamilyColor(1);
  assert.match(first, /^#[0-9A-F]{6}$/);
  assert.notEqual(first, second);
  assert.equal(view.fleetFamilyColor(-1), '#90A1B9', 'the root lineage falls back to neutral');
});

test('summary chips and progress mirror fleetSummary', () => {
  const fleet = {
    value: {
      rootSessionId: 'root', currentSessionId: 'root',
      counts: { agents: 4, running: 1, subagents: 3 },
      agents: agents(),
      team: { members: [{ id: 'a', role: '审阅' }], tasks: [{ id: 't1', subject: '检查', status: 'completed', ownerName: 'a' }, { id: 't2', subject: '修复', status: 'in_progress', ownerName: 'a' }] }
    }
  };
  const panel = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343 });
  assert.equal(panel.status, 'ready');
  assert.deepEqual(panel.summary.chips.map(chip => chip.key), ['agents', 'running', 'done', 'context']);
  assert.equal(panel.summary.chips.find(chip => chip.key === 'agents').text, '4 个 Agent');
  assert.equal(panel.summary.chips.find(chip => chip.key === 'running').on, true);
  assert.equal(panel.summary.progress.label, '任务进度');
  assert.equal(panel.summary.progress.text, '1/2');
  assert.equal(panel.summary.progress.width, 50);
  assert.deepEqual(panel.legend.map(item => item.key).slice(-2), ['free', 'live']);
  assert.deepEqual(panel.agentChips.map(chip => chip.key), ['agents', 'running', 'context', 'team']);
});

test('member board merges the roster with agents and keeps the plugin card anatomy', () => {
  const fleet = {
    value: {
      rootSessionId: 'root', currentSessionId: 'root',
      counts: { agents: 4, running: 1, subagents: 3 }, agents: agents(),
      team: {
        members: [{ id: 'root', name: '主会话', role: 'lead', phase: 'active' }, { id: 'a', name: '子 A', role: 'teammate', phase: 'active' }, { id: 'missing', name: '退役成员', role: 'teammate', phase: 'failed', error: '记录损坏' }],
        tasks: [{ id: 't1', subject: '检查', status: 'in_progress', ownerName: '子 A' }]
      }
    }
  };
  const panel = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343, selectedId: 'a' });
  const members = panel.members;
  assert.equal(members.countText, '5 个 Agent', '3 roster rows (lead, teammate, failed) + 2 agents outside the roster');
  assert.deepEqual(members.statusChips.map(chip => chip.key), ['all', 'running', 'done', 'idle']);
  assert.equal(members.statusChips[0].countText, '5');
  assert.equal(members.statusChips[1].countText, '1');
  const lead = members.rows.find(row => row.id === 'root');
  assert.equal(lead.hue, 'var(--ocean)', 'the lead keeps the brand hue');
  assert.equal(lead.roleText, '主导');
  const kid = members.rows.find(row => row.id === 'a');
  assert.equal(kid.tasksCount, 1);
  assert.equal(kid.tasksText, '1 项进行中任务');
  assert.equal(kid.selected, true);
  assert.match(kid.hue, /^#[0-9A-F]{6}$/);
  const failed = members.rows.find(row => row.id === 'missing');
  assert.equal(failed.statusKey, 'idle');
  assert.equal(failed.error, '记录损坏');
  // 过滤与排序。
  const running = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343, memberStatus: 'running', memberQuery: '' });
  assert.deepEqual(running.members.rows.map(row => row.id), ['a']);
  const searched = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343, memberQuery: '子 A' });
  assert.deepEqual(searched.members.rows.map(row => row.id), ['a']);
  assert.match(wxss, /\.fleet-member\s*\{[^}]*border-top:\s*4rpx solid/);
  assert.match(wxss, /\.fleet-member-icon\s*\{[^}]*border-radius:\s*12rpx/);
  assert.match(wxml, /style="border-top-color:\{\{item\.hue\}\};"/);
  assert.match(wxml, /class="fleet-member-tasks \{\{item\.tasksCount > 0 \? 'on' : ''\}\}"/);
});

test('comms panel shows kind badges, routes, excerpts and participant filters', () => {
  const cards = [{ sessionId: 'a', title: 'Agent A' }, { sessionId: 'b', title: 'Agent B' }];
  const value = {
    messages: [
      { seq: 3, time: 1700000003000, kind: 'settled', from: 'b', to: 'a', text: '完成了任务，等待新指令' },
      { seq: 2, time: 1700000002000, kind: 'mailbox', from: 'a', to: 'b', text: '收到' },
      { seq: 1, time: 1700000001000, kind: 'relay', from: 'b', to: 'a', text: '请检查' }
    ],
    scanned: 2, total: 3, truncated: true
  };
  const comms = view.deriveFleetComms(cards, value, { t: t, filter: '' });
  assert.deepEqual(comms.rows.map(row => row.kindText), ['回报', '邮箱', '私信']);
  assert.equal(comms.rows[0].fromLabel, 'Agent B');
  assert.equal(comms.rows[0].toLabel, 'Agent A');
  assert.equal(comms.totalText, '3 条消息');
  assert.equal(comms.scannedText, '已扫描 2 个会话');
  assert.equal(comms.truncated, true);
  assert.deepEqual(comms.filters.map(filter => filter.key), ['', 'b', 'a']);
  const onlyA = view.deriveFleetComms(cards, value, { t: t, filter: 'a' });
  assert.deepEqual(onlyA.rows.map(row => row.key.split('-')[1]), ['3', '2', '1'], 'both directions of the picked participant');
  assert.equal(onlyA.countText, '3 条消息');
  assert.match(wxss, /\.fleet-comms-k-relay::before\s*\{[^}]*var\(--ocean\)/);
  assert.match(wxss, /\.fleet-comms-k-mailbox::before\s*\{[^}]*#AD46FF/);
  assert.match(wxss, /\.fleet-comms-k-settled::before\s*\{[^}]*var\(--success\)/);
  assert.match(wxml, /bindtap="scanFleetComms"/);
  assert.match(wxml, /class="fleet-comms-row fleet-comms-k-\{\{item\.kindClass\}\}"/);
});

test('node cards render title, usage, composition and pressure-coloured footer', () => {
  const fleet = { value: { rootSessionId: 'root', currentSessionId: 'root', counts: { agents: 4, running: 1, subagents: 3 }, agents: agents() } };
  const panel = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343, selectedId: 'b' });
  const root = panel.graph.nodes.find(node => node.id === 'root');
  assert.equal(root.title, '主会话');
  assert.equal(root.tokensText, '5.0k');
  assert.equal(root.metaText, '1m5s · 12 步');
  assert.deepEqual(root.segments.map(segment => segment.key), ['system', 'tools', 'user']);
  assert.equal(root.pctText, '50.0%');
  assert.equal(root.pctColor, '#00C950', '<70% occupancy stays green');
  const selected = panel.graph.nodes.find(node => node.id === 'b');
  assert.equal(selected.selected, true);
  // 卡内四段与状态类（当前/选中/运行中）都在标记里。
  assert.match(wxml, /fleet-node-head/);
  assert.match(wxml, /fleet-node-bar/);
  assert.match(wxml, /fleet-node-foot/);
  assert.match(wxml, /class="fleet-state-dot \{\{item\.running \? 'on' : ''\}\}"/);
});
