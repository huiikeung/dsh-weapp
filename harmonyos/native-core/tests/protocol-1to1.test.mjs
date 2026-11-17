import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import[\s\S]*?;$/gm, '').replace(/^export \{[^}]*\};$/gm, '').replace(/export /g, '');
const context = { Map, Object, JSON, Number, Error, Date, Uint8Array,
  util: { Base64Helper: class { decodeSync(v) { return Uint8Array.from(Buffer.from(v, 'base64')); } },
    Type: { BASIC: 0 }, TextDecoder: { create: () => ({ decodeToString: bytes => new TextDecoder().decode(bytes) }) } } };
runInNewContext(stripTypeScriptTypes(load('../src/main/ets/protocol/GatewayRequest.ets'), { mode: 'transform' }) +
  ';' + stripTypeScriptTypes(load('../src/main/ets/protocol/GatewayFrameCodec.ets')) +
  ';' + stripTypeScriptTypes(load('../src/main/ets/protocol/PairingPayload.ets')) +
  ';globalThis.api = { GatewayRequestFactory, GatewayRequestLanes, GatewayRequestLanePolicy, parsePairingPayload };', context);
const { GatewayRequestFactory: f, GatewayRequestLanes: L, GatewayRequestLanePolicy: p, parsePairingPayload: parse } = context.api;
const wire = request => JSON.parse(request.payload);
const qr = payload => Buffer.from(JSON.stringify(payload)).toString('base64url');
const payload = { version: 2, publicUrl: 'ws://192.168.1.1:3081/ws/mobile', pairingCode: 'abc', expiresAt: 2000,
  gatewayId: '12345678-1234-4234-8234-123456789abc', endpoints: ['wss://host.example/ws/mobile'] };
test('lane coalesces only queued requests, FIFO preserves order, busy rejects', () => {
  const lanes = new L(); const a = f.simple('a', 'same'); const b = f.simple('b', 'same'); const c = f.simple('c', 'same');
  assert.equal(lanes.submit(a).status, 'active'); assert.equal(lanes.submit(b).status, 'queued');
  const result = lanes.submit(c); assert.equal(result.cancelled[0], b); assert.equal(lanes.active('same'), a);
  assert.equal(lanes.submit(f.make('d', 'same', {}, undefined, undefined, p.REJECT_IF_BUSY)).status, 'busy');
  const fifo = f.make('e', 'same', {}, undefined, undefined, p.FIFO); lanes.submit(fifo);
  assert.equal(lanes.complete('same'), c); assert.equal(lanes.complete('same'), fifo); assert.equal(lanes.complete('same'), undefined);
});
test('wire metadata, correlation and history cursor follow KMP contract', () => {
  const h = f.history('s', 12, 50, 1000, 'conversation', 3, true);
  assert.deepEqual(wire(h), { type: 'history', sessionId: 's', maxMessages: 50, beforeSeq: 12, historyFormatVersion: 3, maxBytes: 1000, view: 'conversation' });
  assert.equal(h.isBackgroundHistory, true); assert.equal(h.targetSessionId, 's');
  assert.throws(() => f.history('s', 12));
  const q = f.queueUpdate('s', 'item', 'steer'); assert.equal(q.correlationId, 'item'); assert.equal(q.responseKind, 'queue-item-updated');
  assert.equal(wire(q).action, 'steer'); assert.throws(() => f.queueUpdate('s', 'item', 'bad'));
  assert.equal(f.ping().responseKind, 'pong'); assert.equal(wire(f.subscribe()).type, 'unsubscribe');
  const update = f.pluginUpdate('id', 'pkg', '1'); assert.equal(update.timeoutMilliseconds, 600000); assert.equal(wire(update).registry, null);
});
test('client ping uses pong lane and releases it after response', async () => {
  const sockets = [];
  const noop = { prepareGateway() {}, clearPendingPrompts() {}, resumeAfterConnect() {}, consume() {} };
  const ctx = { Map, Object, JSON, Number, Math, Date, Error, Uint8Array, Promise,
    setTimeout, clearTimeout, KEY_CONNECTION: 'state',
    Logger: { info() {}, warn() {}, error() {} }, AppStorage: { setOrCreate() {}, get() {} },
    webSocket: { createWebSocket() { const s = { handlers: {}, sent: [], on(k, fn) { this.handlers[k] = fn; },
      off() {}, close() {}, connect() {}, send(text, cb) { this.sent.push(text); cb(null); } }; sockets.push(s); return s; } },
    SessionStore: { get: () => noop }, PluginStore: { get: () => noop }, ScheduleStore: { get: () => noop },
    CredentialStore: { get: () => ({ list: () => [], save() {} }) },
    PreferencesStore: { get: () => ({ getString: () => 'device', putString() {} }) },
    GatewayRequests: new Proxy({}, { get: () => () => '{}' }), decodeFrame: JSON.parse,
    matchesResponse: (req, frame) => frame.kind === req.matchType && (!req.hasRequestId || frame.requestId === req.id), NotificationService: {} };
  const source = load('../src/main/ets/protocol/GatewayRequest.ets') + '\n' + load('../src/main/ets/network/GatewayClient.ets');
  runInNewContext(stripTypeScriptTypes(source, { mode: 'transform' }) + ';globalThis.client = GatewayClient.get(); globalThis.GatewayRequestFactory = GatewayRequestFactory;', ctx);
  ctx.client.connect({ wsUrl: 'ws://localhost/ws', pairCode: '', leaseToken: '', inviteToken: '', accessToken: '', token: 'token' });
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'hello' }));
  const first = ctx.client.ping();
  await assert.rejects(ctx.client.ping(), /busy/);
  assert.equal(JSON.parse(sockets[0].sent.at(-1)).type, 'ping');
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'pong' }));
  assert.equal((await first).kind, 'pong');
  const next = ctx.client.ping(); sockets[0].handlers.message(null, JSON.stringify({ kind: 'pong' })); await next;
  const open = ctx.client.openFileDownload('s', '/file');
  const sent = JSON.parse(sockets[0].sent.at(-1));
  assert.equal(sent.type, 'file-download-open'); assert.equal(sent.sessionId, 's');
  await assert.rejects(ctx.client.openFileDownload('s', '/other'), /busy/);
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'file-download-opened', requestId: 'wrong' }));
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'file-download-opened', requestId: sent.requestId }));
  assert.equal((await open).requestId, sent.requestId);
  const list1 = ctx.client.requestFileList('s', '/one');
  const listFrame1 = JSON.parse(sockets[0].sent.at(-1));
  const list2 = ctx.client.requestFileList('s', '/two');
  const list2Rejected = assert.rejects(list2, /coalesced/);
  const list3 = ctx.client.requestFileList('s', '/three');
  await list2Rejected;
  assert.equal(JSON.parse(sockets[0].sent.at(-1)).path, '/one');
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'file-list', requestId: listFrame1.requestId }));
  await list1; await new Promise(resolve => setImmediate(resolve));
  const listFrame3 = JSON.parse(sockets[0].sent.at(-1)); assert.equal(listFrame3.path, '/three');
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'file-list', requestId: listFrame1.requestId }));
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'file-list', requestId: listFrame3.requestId })); await list3;
  const answer = ctx.client.request(JSON.stringify({ type: 'question-answer', requestId: 'answer-1', rpcId: 'rpc-1', sessionId: 's', answers: [] }), 'question-response');
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'error', requestId: 'wrong', requestType: 'question-answer', message: 'wrong owner' }));
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'error', requestId: 'answer-1', requestType: 'question-answer', message: 'expected failure' }));
  await assert.rejects(answer, /expected failure/);
  const pluginFactory = ctx.GatewayRequestFactory;
  const plugin1 = ctx.client.requestGateway(pluginFactory.pluginBundleSetEnabled('plugin-1', 'pkg1', true));
  const plugin2 = ctx.client.requestGateway(pluginFactory.pluginBundleSetEnabled('plugin-2', 'pkg2', false));
  assert.equal(JSON.parse(sockets[0].sent.at(-1)).requestId, 'plugin-1');
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'plugin-bundle-set-enabled', requestId: 'plugin-1' }));
  await plugin1; await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(sockets[0].sent.at(-1)).requestId, 'plugin-2');
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'error', requestId: 'wrong', requestType: 'plugin-bundle-set-enabled' }));
  sockets[0].handlers.message(null, JSON.stringify({ kind: 'plugin-bundle-set-enabled', requestId: 'plugin-2' }));
  await plugin2;
  const active = ctx.client.requestFileList('s', '/active');
  const queued = ctx.client.requestFileList('s', '/queued');
  const activeRejected = assert.rejects(active, /断开/); const queuedRejected = assert.rejects(queued, /断开/);
  ctx.client.disconnect(); await Promise.all([activeRejected, queuedRejected]);
  ctx.client.connect({ wsUrl: 'ws://localhost/ws', pairCode: '', leaseToken: '', inviteToken: '', accessToken: '', token: 'token' });
  sockets[1].handlers.message(null, JSON.stringify({ kind: 'hello' }));
  await assert.rejects(ctx.client.ping(1), /timeout/);
  assert.equal(ctx.client.isConnected(), false);
  sockets[1].handlers.message(null, JSON.stringify({ kind: 'pong' }));
  await assert.rejects(ctx.client.ping(), /not connected/);
  ctx.client.disconnect();
});
test('P0 message, question and approval wire semantics', () => {
  const msg = f.message('ignored', [{ mediaType: 'image/png', base64Data: 'abc', name: 'pic' }], 's', 'w', 'UTC', 'steer', ['r'], 'id', [{ type: 'quote', text: 'quoted' }]);
  assert.deepEqual(wire(msg), { type: 'message', sessionId: 's', requestId: 'id', files: [{ receiptId: 'r' }], textParts: [{ type: 'quote', text: 'quoted' }], images: [{ mediaType: 'image/png', data: 'abc', name: 'pic' }], mode: 'steer', clientTimeZone: 'UTC' });
  assert.equal(msg.correlationId, 'id'); assert.equal(msg.lanePolicy, p.REJECT_IF_BUSY);
  assert.throws(() => f.message('', [], 's', undefined, 'UTC', 'queue', ['r', 'r'], 'id'));
  assert.throws(() => f.message('', [], undefined, undefined, 'UTC', 'queue', ['r'], 'id'));
  assert.throws(() => f.message('', [], 's', undefined, 'UTC', 'queue', [], undefined, [{ type: 'quote', text: ' ' }]));
  assert.deepEqual(wire(f.questionAnswer('rpc', 's', [{ id: 'q', selected: ['a'], custom: '  extra  ' }, { id: 'q2', selected: [], custom: ' ' }])),
    { type: 'question-answer', rpcId: 'rpc', sessionId: 's', answers: [{ id: 'q', selected: ['a'], custom: 'extra' }, { id: 'q2', selected: [] }] });
  assert.equal(f.approvalResponse('rpc', 's', 'a', 'rejected').correlationId, 'rpc');
  assert.throws(() => f.approvalResponse('rpc', 's', 'a', 'always'));
});
test('P0 file and session requests carry exact correlation fields', () => {
  const list = f.fileList('s', ' ', 'r'); assert.deepEqual(wire(list), { type: 'file-list', sessionId: 's', requestId: 'r' });
  assert.equal(list.correlationId, 'r'); assert.equal(list.lanePolicy, p.COALESCE_LATEST);
  const open = f.fileDownloadOpen('s', '/a', 'r'); assert.equal(open.responseKind, 'file-download-opened');
  const read = f.fileDownloadRead('t', 64); assert.deepEqual(wire(read), { type: 'file-download-read', transferId: 't', offset: 64 });
  assert.equal(read.correlationId, 't'); assert.equal(f.fileDownloadCancel('t').responseKind, 'file-download-cancelled');
  assert.equal(f.sessionControl('tasks', 's').targetSessionId, 's');
  assert.deepEqual(wire(f.selectModel('s', 'p', 'm', ' ')), { type: 'select-model', sessionId: 's', provider: 'p', model: 'm' });
  assert.equal(f.setPermission('s', 'allow').lanePolicy, p.REJECT_IF_BUSY);
});
test('schedule and plugin factories preserve KMP fields and validation', () => {
  assert.deepEqual(wire(f.hostScheduleList('r', false, 20, 2)), { type: 'schedule-list', requestId: 'r', active: false, limit: 20, offset: 2 });
  assert.throws(() => f.hostScheduleList('r', undefined, 501)); assert.throws(() => f.scheduleView(' ', 'id'));
  const create = f.scheduleCreate('r', '  title ', 'prompt', { kind: 'at' });
  assert.equal(wire(create).title, 'title'); assert.equal(create.lanePolicy, p.REJECT_IF_BUSY);
  assert.throws(() => f.scheduleCreate('r', '  ', 'prompt', {}));
  assert.deepEqual(wire(f.scheduleEdit('r', 's', null, { active: true })), { type: 'schedule-edit', requestId: 'r', id: 's', action: 'update', expectedUpdatedAt: null, patch: { active: true } });
  assert.throws(() => f.scheduleEdit('r', 's', null, {})); assert.throws(() => f.scheduleDeleteInactive('r', false));
  assert.equal(wire(f.scheduleDeleteInactive('r', true)).confirm, true);
  assert.equal(f.pluginEntrySetEnabled('r', 'entry', false).lanePolicy, p.FIFO);
  assert.equal(f.pluginVersions('r', 'pkg').correlationId, 'r'); assert.throws(() => f.pluginDetail('', 'pkg', 'en'));
});
test('remaining session, goal, slash and queue factories preserve response correlation', () => {
  assert.deepEqual(wire(f.renameSession('s', ' title ')), { type: 'session-rename', sessionId: 's', title: 'title' });
  assert.equal(f.archiveSession('s').responseKind, 'session-archived');
  assert.equal(f.sessionCancel('s').lanePolicy, p.REJECT_IF_BUSY);
  assert.deepEqual(wire(f.editGoal('s', { id: 'g', revision: 2 }, ' objective ', 4)),
    { type: 'goal-edit', sessionId: 's', ref: { id: 'g', revision: 2 }, objective: 'objective', maxGoalRounds: 4 });
  assert.throws(() => f.goalAction('bad', 's', { id: 'g', revision: 1 }));
  assert.equal(f.goalAction('goal-pause', 's', { id: 'g', revision: 1 }).responseKind, 'goal-pause');
  assert.deepEqual(wire(f.slashCommands('s', 'en')), { type: 'commands', sessionId: 's', locale: 'en' });
  assert.equal(f.slashCommandOptions('s', 'cmd').correlationId, 'cmd');
  assert.equal(f.selectSlashCommandOption('s', 'cmd', 'opt').responseKind, 'command-selected');
  assert.deepEqual(wire(f.queueEdit('s', 'item', 'req', 'text')), { type: 'queue-update', sessionId: 's', itemId: 'item', requestId: 'req', action: 'edit', text: 'text' });
});
test('pairing enforces required URL, identity, endpoint types and expiry', () => {
  assert.equal(parse(qr(payload), 1000).ok, true);
  assert.equal(parse(qr({ ...payload, expiresAt: 1000 }), 1000).ok, false);
  assert.equal(parse(qr({ ...payload, publicUrl: undefined }), 1000).ok, false);
  assert.equal(parse(qr({ ...payload, gatewayId: 'invalid' }), 1000).ok, false);
  assert.equal(parse(qr({ ...payload, endpoints: ['ws://8.8.8.8/ws'] }), 1000).ok, false);
  assert.equal(parse(qr({ ...payload, endpoints: [{ url: 'wss://host/ws' }] }), 1000).ok, false);
  assert.equal(parse(qr(payload) + '=', 1000).ok, false);
});
