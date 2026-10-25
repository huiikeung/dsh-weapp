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
const sessionJs = fs.readFileSync(path.join(root, 'pages/session/session.js'), 'utf8');
function expandIncludes(file) {
  const source = fs.readFileSync(file, 'utf8');
  return source.replace(/<include\s+src="([^"]+)"\s*\/>/g, (_match, includePath) =>
    expandIncludes(path.resolve(path.dirname(file), includePath)));
}
const wxml = expandIncludes(path.join(root, 'pages/session/session.wxml'));
const view = require(path.join(root, 'utils/context-view'));

const t = (key, values) => (values
  ? Object.keys(values).reduce((text, name) => text.split('{' + name + '}').join(String(values[name])), key)
  : key);

function agents() {
  return [
    { sessionId: 'root', depth: 0, title: '主会话', tokensTotal: 5000, steps: 12, activeMs: 65000, pressureTokens: 500, contextWindow: 1000, composition: { system: 100, tools: 300, user: 100, total: 500 } },
    { sessionId: 'a', depth: 1, title: '子 A', tokensTotal: 2000, steps: 4, running: true, lastAnswer: '已完成性能回归分析，正在汇总原因。' },
    { sessionId: 'b', depth: 1, title: '子 B', tokensTotal: 1000, steps: 2, completed: true },
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
    // 连线由 canvas 绘制：需要可直接喂给 bezierCurveTo 的控制点
    assert.equal(link.p.length, 8, 'link exposes bezier control points');
    for (const value of link.p) assert.ok(Number.isFinite(value), 'bezier points are numeric');
  }
  const child = graph.nodes.find(node => node.id === 'a');
  assert.equal(child.isCurrent, true, 'current agent is flagged');
  assert.equal(child.running, true);
  assert.equal(graph.links[0].to, 'a');
  assert.match(wxss, /\.fleet-node\s*\{[^}]*border-radius:\s*20rpx/);
  // WXML 的 <svg>/<path> 在小程序里不渲染、canvas 是原生组件不跟随滚动，
  // 连线改成离屏画布导出图片（<image> 是普通元素，随内容滚动）。
  assert.match(wxml, /class="fleet-links-image"/);
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
  // Only the DSH completion signal counts; running work is not estimated as half complete.
  assert.equal(panel.summary.progress.width, 50);
  assert.equal(panel.summary.progress.complete, false);
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
  assert.equal(kid.answerLabel, '最新回报');
  assert.equal(kid.answerText, '已完成性能回归分析，正在汇总原因。');
  assert.match(kid.metaText, /^2\.0k · /, 'member usage follows the compact DSH metric line without inventing a tok suffix');
  assert.equal(kid.selected, true);
  assert.match(kid.hue, /^#[0-9A-F]{6}$/);
  const failed = members.rows.find(row => row.id === 'missing');
  assert.equal(failed.statusKey, 'idle');
  assert.equal(failed.error, '记录损坏');
  assert.deepEqual(members.groups.map(group => [group.key, group.title, group.countText]), [
    ['team', '团队成员', '3'], ['agents', '其他 Agent', '2']
  ]);
  assert.equal(members.sortLabel, '派生顺序');
  assert.equal(members.sortOptions.find(option => option.active).key, 'derived');
  // 过滤与排序。
  const running = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343, memberStatus: 'running', memberQuery: '' });
  assert.deepEqual(running.members.rows.map(row => row.id), ['a']);
  const searched = view.buildFleetPanel(fleet, { t: t, connected: true, hasSession: true, stageWidth: 343, memberQuery: '子 A' });
  assert.deepEqual(searched.members.rows.map(row => row.id), ['a']);
  assert.match(wxss, /\.fleet-member\s*\{[^}]*border-top:\s*4rpx solid/);
  assert.match(wxss, /\.fleet-member-icon,\s*\.fleet-task-icon\s*\{[^}]*border-radius:\s*11rpx/);
  // 任务行也带图标盒与状态点
  assert.match(wxml, /wx:if="\{\{item\.kind === 'agent'\}\}" class="fleet-task-icon"/);
  assert.match(wxml, /class="fleet-member-dot \{\{member\.stateKind\}\}"/);
  assert.match(wxml, /class="fleet-task-dot \{\{item\.stateKind\}\}"/);
  // DSH's live-state dot sits beside the member identity, not over the avatar glyph.
  assert.match(wxml, /fleet-member-role[\s\S]{0,180}fleet-member-dot/);
  assert.ok(wxml.includes('class="fleet-workspace"'));
  assert.ok(wxml.includes('class="fleet-board-column"'));
  assert.ok(wxml.includes('class="ctx-card fleet-comms"'));
  assert.match(wxml, /fleet-network\{\{theme === 'dark' \? '-dark' : ''\}\}\.svg/);
  assert.match(wxml, /fleet-comms\{\{theme === 'dark' \? '-dark' : ''\}\}\.svg/);
  assert.match(wxss, /@media\s*\(min-width:\s*860px\)[\s\S]*\.fleet-workspace\s*\{[^}]*display:\s*grid/);
  // 状态点已经从图标角上挪出来，老的 .fleet-member-state 样式整组退役。
  assert.ok(!wxml.includes('fleet-member-state'), 'no markup references the retired dot class');
  assert.ok(!wxss.includes('.fleet-member-state'), 'its dead CSS is gone too');
  assert.match(wxml, /fleet-member-group-head/);
  assert.match(wxml, /fleet-member-answer-text/);
  assert.match(wxml, /class="fleet-member-sort \{\{fleetMemberSortOpen \? 'open' : ''\}\}" catchtap="openFleetMemberSort"/);
  assert.match(wxml, /class="fleet-sort-menu"[\s\S]*fleet-sort-option/);
  assert.doesNotMatch(wxml, /fleet-sort-modal|<picker[^>]*fleet-member-sort/, 'member sorting is an anchored dropdown, not a modal or bottom picker');
  assert.match(wxss, /\.fleet-member-group-head\s*\{[^}]*border-bottom:\s*1rpx dashed/);
  assert.match(wxss, /\.fleet-sort-menu\s*\{[^}]*position:\s*absolute[^}]*top:\s*calc\(100% \+ 8rpx\)/);
  // lead 的上边框用墨黑（var(--ink），浅色主题即黑）；其余成员沿用家族色相
  assert.match(wxml, /style="border-top-color:\{\{member\.kind === 'lead' \? 'var\(--ink\)' : member\.hue\}\};"/);
  assert.match(wxml, /class="fleet-member-tasks \{\{member\.tasksCount > 0 \? 'on' : ''\}\}"/);
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
  assert.equal(comms.rows[0].fromId, 'b');
  assert.equal(comms.rows[0].toId, 'a');
  assert.deepEqual(comms.filters.map(filter => filter.key), ['', 'b', 'a']);
  const onlyA = view.deriveFleetComms(cards, value, { t: t, filter: 'a' });
  assert.deepEqual(onlyA.rows.map(row => row.key.split('-')[1]), ['3', '2', '1'], 'both directions of the picked participant');
  assert.equal(onlyA.countText, '3 条消息');
  const stale = view.deriveFleetComms(cards, value, { t: t, stale: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.staleText, '有新动态');
  const namedSender = view.deriveFleetComms(cards, {
    messages: [{ seq: 4, time: 1700000004000, kind: 'mailbox', fromName: '历史成员', to: 'a', text: '回报内容' }],
    scanned: 2, total: 1
  }, { t: t, filter: '' });
  assert.equal(namedSender.rows[0].fromLabel, '历史成员', 'mailbox senders without an attested id keep their durable sender name');
  assert.match(wxss, /\.fleet-comms-k-relay::before\s*\{[^}]*var\(--ocean\)/);
  assert.match(wxss, /\.fleet-comms-k-mailbox::before\s*\{[^}]*#AD46FF/);
  assert.match(wxss, /\.fleet-comms-k-settled::before\s*\{[^}]*var\(--success\)/);
  assert.match(wxml, /bindtap="scanFleetComms"/);
  assert.match(wxml, /class="fleet-comms-row fleet-comms-k-\{\{item\.kindClass\}\}"/);
  assert.match(wxml, /class="fleet-comms-party" data-id="\{\{item\.fromId\}\}" bindtap="setFleetCommsFilter"/);
  assert.match(wxml, /class="fleet-comms-arrow" aria-hidden="true"/);
  assert.doesNotMatch(wxml, /\{\{item\.fromLabel\}\} → \{\{item\.toLabel\}\}/, 'routes use the custom drawn arrow instead of a text glyph');
  assert.match(wxss, /\.fleet-comms-arrow-shaft\s*\{[^}]*border-top/);
  assert.match(wxss, /\.fleet-comms-arrow::after\s*\{[^}]*border-left/);
  assert.match(sessionJs, /this\._fleetCommsAsOfSeq !== \(fleet && fleet\.asOfSeq\)/, 'new fleet activity marks the scanned timeline stale');
  assert.match(sessionJs, /this\._fleetCommsGeneration !== requestGeneration/, 'late scans from a previous session cannot replace current comms');
  const sessionReset = sessionJs.slice(sessionJs.indexOf('const sessionChanged'), sessionJs.indexOf('const trendAutoOverviewPatch'));
  assert.match(sessionReset, /this\._fleetComms = null;[\s\S]*fleetCommsState: 'idle'/, 'switching sessions clears the previous conversation timeline');
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
  // 左上角状态图标：运行中转圈 / 完成绿点 / 失败红点 / 空闲灰圈
  assert.match(wxml, /class="fleet-node-state \{\{item\.stateKind\}\}"/);
  assert.match(wxss, /\.fleet-node-state\.running::after,[\s\S]*?animation: fleet-spin 1\.5s linear infinite/);
  assert.match(wxss, /\.fleet-node-state\.done::after,[\s\S]*?background: var\(--success\)/);
});
