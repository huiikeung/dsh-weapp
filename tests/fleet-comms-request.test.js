// Fleet comms plumbing: the panel exposes the roster used to resolve rc.3
// send_message names, the client forwards it with the scan, and the member/task
// toolbars stay transparent (no surface fill behind search/sort/idle-task chips).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GatewayClient } = require('../miniprogram/utils/gateway');
const view = require('../miniprogram/utils/context-view');

const t = (value) => value;

test('fleet panel exposes the comms roster (team members first, card titles next)', () => {
  const panel = view.buildFleetPanel({
    value: {
      rootSessionId: 'root',
      currentSessionId: 'root',
      agents: [
        { sessionId: 'root', depth: 0, title: '主会话', isRoot: true, isCurrent: true },
        { sessionId: 'child', parentSessionId: 'root', origin: 'subagent', depth: 1, title: '子会话', label: '修复 i18n' }
      ],
      team: {
        members: [{ id: 'child', name: 'baseline-i18n', role: 'teammate', phase: 'active' }],
        tasks: []
      }
    }
  }, { t, connected: true, hasSession: true, stageWidth: 360 });
  assert.deepEqual(panel.commsMembers.slice(0, 2), [
    { id: 'child', name: 'baseline-i18n' },
    { id: 'root', name: '主会话' }
  ]);
});

test('context-comms request forwards parent addresses and the roster', () => {
  const client = Object.create(GatewayClient.prototype);
  client.pendingRequests = {};
  const sent = [];
  client.send = (frame) => { sent.push(frame); return true; };
  client.requestContextComms(['root', 'child'], [{ id: 'child', parentSessionId: 'root', mode: 'continuable' }], [
    { id: 'child', name: 'baseline-i18n', extra: 'drop-me' },
    { id: '', name: 'bad' }
  ]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'context-comms');
  assert.deepEqual(sent[0].sessionIds, ['root', 'child']);
  assert.deepEqual(sent[0].sessions, [{ id: 'child', parentSessionId: 'root', mode: 'continuable' }]);
  assert.deepEqual(sent[0].members, [{ id: 'child', name: 'baseline-i18n' }]);
  // Drop the outstanding correlation timer so the test process can exit.
  Object.keys(client.pendingRequests).forEach((key) => {
    if (client.pendingRequests[key] && client.pendingRequests[key].timer) {
      clearTimeout(client.pendingRequests[key].timer);
    }
    delete client.pendingRequests[key];
  });
});

test('comms rows label routes with roster names before generic titles', () => {
  const panel = view.buildFleetPanel({
    value: {
      rootSessionId: 'root',
      currentSessionId: 'root',
      agents: [
        { sessionId: 'root', depth: 0, title: '补全上下文洞察模块', isRoot: true, isCurrent: true },
        { sessionId: 'child', parentSessionId: 'root', origin: 'subagent', depth: 1, title: 'Baseline fixes' }
      ],
      team: { members: [{ id: 'child', name: 'baseline-i18n', role: 'teammate', phase: 'active' }], tasks: [] }
    }
  }, {
    t,
    connected: true,
    hasSession: true,
    stageWidth: 360,
    commsValue: {
      v: 1,
      scanned: 2,
      total: 1,
      messages: [{ seq: 1, time: Date.now(), kind: 'relay', from: 'child', to: 'root', text: 'done' }]
    }
  });
  assert.equal(panel.comms.rows.length, 1);
  assert.equal(panel.comms.rows[0].fromLabel, 'baseline-i18n');
  assert.ok(panel.comms.filters.some((filter) => filter.label === 'baseline-i18n'));
});

test('fleet member/task controls use transparent surfaces', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/session/session.wxss'), 'utf8');
  const rules = [
    /\.fleet-member-toolbar \.ctx-br-search\s*\{[^}]*background:\s*transparent/,
    /\.fleet-member-sort\s*\{[^}]*background:\s*transparent/,
    /\.fleet-member-tasks\s*\{[^}]*background:\s*transparent/,
    /\.fleet-task-search\s*\{[^}]*background:\s*transparent/
  ];
  for (const rule of rules) assert.match(css, rule);
});
