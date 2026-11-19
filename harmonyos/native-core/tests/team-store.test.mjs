import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/main/ets/state/TeamStore.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const code = stripTypeScriptTypes(source) + ';globalThis.TeamStore = TeamStore;';
const storage = new Map();

function setup() {
  const AppStorage = { setOrCreate: (key, value) => { storage.set(key, value); } };
  const context = { AppStorage, Logger: { info() {}, warn() {} }, Map, Array, Object, JSON, Number, String, Math };
  runInNewContext(code, context);
  return context.TeamStore.get();
}

const projection = (seq, members, tasks) => ({ asOfSeq: seq, values: { agentTeam: { members, tasks, failure: '' } } });
const lead = { id: 'lead', name: 'Lead', role: 'lead', phase: 'active' };
const worker = { id: 'worker-1', name: 'Worker', role: 'teammate', phase: 'active', provider: 'deepseek' };

test('projection builds team snapshot', () => {
  const store = setup();
  store.ingestProjection('lead', projection(7, [lead, worker], []));
  assert.equal(store.visible(), true);
  assert.equal(store.memberList().length, 2);
  assert.equal(store.memberList()[0].id, 'lead');
  assert.equal(store.memberList()[1].statusLabel, '成员');
});

test('single lead without tasks is not visible', () => {
  const store = setup();
  store.ingestProjection('lead', projection(3, [lead], []));
  assert.equal(store.visible(), false);
});

test('team events merge after baseline and deleted tasks drop out', () => {
  const store = setup();
  store.ingestProjection('lead', projection(5, [lead], []));
  store.ingestEvent('team/member', 6, { type: 'team/member', data: { version: 2, teamId: 'lead', member: worker } });
  assert.equal(store.memberList().length, 2);
  store.ingestEvent('team/task', 7, { type: 'team/task', data: { version: 2, teamId: 'lead',
    task: { id: 't1', subject: 'Ship it', description: 'desc', status: 'in_progress', ownerId: 'worker-1', blockedBy: ['t0'] } } });
  assert.equal(store.taskList().length, 1);
  assert.equal(store.taskList()[0].ownerId, 'worker-1');
  store.ingestEvent('team/task', 8, { type: 'team/task', data: { version: 2, teamId: 'lead',
    task: { id: 't1', subject: 'Ship it', status: 'deleted' } } });
  assert.equal(store.taskList().length, 0);
});

test('stale events below baseline and other team ids are ignored', () => {
  const store = setup();
  store.ingestProjection('lead', projection(10, [lead], []));
  store.ingestEvent('team/member', 4, { type: 'team/member', data: { version: 2, teamId: 'lead', member: worker } });
  store.ingestEvent('team/member', 12, { type: 'team/member', data: { version: 2, teamId: 'other', member: worker } });
  assert.equal(store.memberList().length, 1);
});

test('opening a member keeps the team, unrelated session clears it', () => {
  const store = setup();
  store.ingestProjection('lead', projection(2, [lead, worker], []));
  store.activate('worker-1');
  assert.equal(store.visible(), true);
  store.activate('other');
  assert.equal(store.visible(), false);
  assert.equal(store.memberList().length, 0);
});

// ==================== 子智能体（subagentCatalog） ====================
// DSH 端「智能体」多数是 spawn 出来的子智能体，走独立投影而不是 agentTeam.members；
// 只解析 agentTeam 会出现「桌面端 6 个、手机只显示 1 个」。

const catalog = (seq, children) => ({ asOfSeq: seq, values: { subagentCatalog: children } });
const child = (id, mode, label) => ({ id, mode, label });

test('subagent catalog projection shows up as members', () => {
  const store = setup();
  store.ingestProjection('lead', catalog(4, [child('c1', 'one-shot', 'Researcher'), child('c2', 'continuable', 'Coder')]));
  assert.equal(store.childList().length, 2);
  // 只有子智能体也要显示协作入口
  assert.equal(store.visible(), true);
  // 子智能体并入成员列表：面板仍是「成员 N」，DSH 端 6 个智能体要都能显示
  assert.equal(store.memberList().length, 2);
  const coder = store.memberList().find((one) => one.id === 'c2');
  assert.equal(coder.name, 'Coder');
  assert.equal(coder.description, '可继续子智能体');
  assert.equal(coder.canOpen, false);
});

test('unknown child mode and missing label fall back', () => {
  const store = setup();
  store.ingestProjection('lead', catalog(2, [{ id: 'abcdef123', mode: 'weird' }]));
  assert.equal(store.childList().length, 1);
  assert.equal(store.childList()[0].mode, 'unknown');
  assert.equal(store.childList()[0].statusLabel, '子智能体');
  assert.equal(store.childList()[0].label, 'abcdef12');
});

test('subagent/catalog events merge after baseline and ignore stale seq', () => {
  const store = setup();
  store.ingestProjection('lead', catalog(5, [child('c1', 'one-shot', 'A')]));
  store.ingestEvent('subagent/catalog', 6, { type: 'subagent/catalog', data: { version: 0, childId: 'c2', mode: 'continuable', label: 'B' } });
  assert.equal(store.childList().length, 2);
  store.ingestEvent('subagent/catalog', 4, { type: 'subagent/catalog', data: { version: 0, childId: 'c3', mode: 'one-shot', label: 'C' } });
  assert.equal(store.childList().length, 2);
});

test('agentTeam and subagentCatalog stay independent', () => {
  const store = setup();
  store.ingestProjection('lead', {
    asOfSeq: 9,
    values: { agentTeam: { members: [lead, worker], tasks: [], failure: '' }, subagentCatalog: [child('c1', 'one-shot', 'A')] }
  });
  // 2 个团队成员 + 1 个子智能体，全都进成员列表
  assert.equal(store.memberList().length, 3);
  assert.equal(store.childList().length, 1);
});

test('catalog without agentTeam still publishes children and resets on other session', () => {
  const store = setup();
  store.ingestProjection('lead', catalog(3, [child('c1', 'one-shot', 'A')]));
  assert.equal(store.leadSessionId(), 'lead');
  store.activate('other');
  assert.equal(store.childList().length, 0);
});
