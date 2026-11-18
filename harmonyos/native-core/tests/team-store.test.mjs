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
