'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createService } = require('../server.cjs');
const { DEFAULT_TEMPLATE_ID, createWechatNotificationSender, templateData, formatDuration, formatTokens, formatCacheHitRate, formatCombinedMetrics } = require('../notifications.cjs');

test('deployment artifacts include the notification sender module', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '../Dockerfile'), 'utf8');
  const deployGuide = fs.readFileSync(path.join(__dirname, '../README-deploy.md'), 'utf8');
  assert.match(dockerfile, /announcements\.cjs notifications\.cjs/);
  assert.match(deployGuide, /tar -czf[^\n]*announcements\.cjs notifications\.cjs/);
});

test('mini-program template ID travels with the ticket and is used for sending', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-id-'));
  const calls = [];
  const openid = 'wechat-verified-id';
  const stateFile = path.join(dir, 'state.json');
  const identityKey = crypto.createHash('sha256').update(openid).digest('hex');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 2, codes: {}, redemptions: {}, access: {}, engagement: {
    identities: { [identityKey]: { openid, deviceId: 'WX-' + 'D'.repeat(24), createdAt: Date.now(), lastSeenAt: Date.now() } },
    invites: {}, visitors: {}, rewards: {}, moments: {}, rules: { enabled: false, tiers: [{ from: 1, days: 3 }, { from: 11, days: 7 }, { from: 16, days: 30 }], momentsDays: 3 },
  } }));
  const server = createService({
    stateFile, adminOpenIds: ['fixture-admin-openid'], exchangeCode: async code => 'wechat-verified-' + code,
    sendNotification: async (openid, context) => { calls.push({ openid, ...context }); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'id' }) }).then(r => r.json());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
  const miniTemplateId = 'QvgkQ88HKFdTNPJVOp0EdHDbWk9lt9WDKfbb95z-AAU';
  const issued = await fetch(base + '/notifications/tickets', { method: 'POST', headers, body: JSON.stringify({ templateId: miniTemplateId }) });
  assert.equal(issued.status, 201);
  const ticket = (await issued.json()).ticket;
  // 服务端把模板 ID 存进票据状态
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(Object.values(persisted.notificationTickets)[0].templateId, miniTemplateId);
  await fetch(base + '/notifications/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, sessionId: 'template-session', status: 'completed' }),
  });
  assert.equal(calls[0].templateId, miniTemplateId);
  // 非法的模板 ID 在申请票据时就被拒绝
  const bad = await fetch(base + '/notifications/tickets', { method: 'POST', headers, body: JSON.stringify({ templateId: 'bad' }) });
  assert.equal(bad.status, 400);
});

test('authenticated mini-program receives one-time ticket and gateway completion is idempotent', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-test-'));
  const calls = [];
  const openid = 'wechat-verified-alice';
  const stateFile = path.join(dir, 'state.json');
  const identityKey = crypto.createHash('sha256').update(openid).digest('hex');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 2, codes: {}, redemptions: {}, access: {}, engagement: {
    identities: { [identityKey]: { openid, deviceId: 'WX-' + 'A'.repeat(24), createdAt: Date.now(), lastSeenAt: Date.now() } },
    invites: {}, visitors: {}, rewards: {}, moments: {}, rules: { enabled: false, tiers: [{ from: 1, days: 3 }, { from: 11, days: 7 }, { from: 16, days: 30 }], momentsDays: 3 },
  } }));
  const server = createService({
    stateFile, adminOpenIds: ['fixture-admin-openid'], exchangeCode: async code => 'wechat-verified-' + code,
    sendNotification: async (openid, context) => { calls.push({ openid, ...context }); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'alice' }) }).then(r => r.json());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
  const issued = await fetch(base + '/notifications/tickets', { method: 'POST', headers, body: '{}' });
  assert.equal(issued.status, 201);
  const ticket = (await issued.json()).ticket;
  assert.match(ticket, /^[A-Za-z0-9_-]{43}$/);
  const complete = () => fetch(base + '/notifications/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, sessionId: 'fixture-session', status: 'completed' }),
  });
  assert.equal((await complete()).status, 200);
  const duplicate = await complete();
  assert.deepEqual(await duplicate.json(), { sent: true, duplicate: true });
  assert.deepEqual(calls, [{ openid: 'wechat-verified-alice', sessionId: 'fixture-session' }]);
  const forged = await fetch(base + '/notifications/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: 'x'.repeat(43), sessionId: 'fixture-session', status: 'completed' }) });
  assert.equal(forged.status, 404);
});

test('notification tickets survive service restarts and remain bound to one session', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-restart-test-'));
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 2, codes: {}, redemptions: {}, access: {}, engagement: {
    identities: {}, invites: {}, visitors: {}, rewards: {}, moments: {},
    rules: { enabled: false, tiers: [{ from: 1, days: 3 }, { from: 11, days: 7 }, { from: 16, days: 30 }], momentsDays: 3 },
  } }));
  const calls = [];
  const servers = [];
  const start = async () => {
    const server = createService({
      stateFile, adminOpenIds: ['fixture-admin-openid'], exchangeCode: async code => 'wechat-verified-' + code,
      sendNotification: async (openid, context) => { calls.push({ openid, ...context }); },
    });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + server.address().port;
  };
  const stop = async server => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  t.after(async () => {
    for (const server of servers) if (server.listening) await stop(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  let base = await start();
  const login = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'restart-alice' }) }).then(r => r.json());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
  const issued = await fetch(base + '/notifications/tickets', { method: 'POST', headers, body: '{}' });
  const ticket = (await issued.json()).ticket;
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const ticketRecord = Object.values(persisted.notificationTickets)[0];
  assert.equal(ticketRecord.status, 'issued');
  // Simulate a crash after recording the in-flight delivery but before the result.
  ticketRecord.status = 'sending';
  fs.writeFileSync(stateFile, JSON.stringify(persisted));

  await stop(servers.at(-1));
  base = await start();
  const complete = (sessionId = 'session-after-restart') => fetch(base + '/notifications/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, sessionId, status: 'completed' }),
  });
  assert.equal((await complete()).status, 200);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(stateFile, 'utf8')).notificationTickets)[0].status, 'sent');
  assert.deepEqual(calls, [{ openid: 'wechat-verified-restart-alice', sessionId: 'session-after-restart' }]);
  assert.equal((await complete('different-session')).status, 409);

  await stop(servers.at(-1));
  base = await start();
  const duplicate = await complete();
  assert.deepEqual(await duplicate.json(), { sent: true, duplicate: true });
  assert.equal(calls.length, 1);
});

test('ticket delivery retries transient failures without sending task content', async () => {
  let time = Date.parse('2026-10-21T10:00:00Z');
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed.pathname, body: options.body ? JSON.parse(options.body) : null });
    if (parsed.pathname.endsWith('/cgi-bin/token')) return { ok: true, json: async () => ({ access_token: 'fixture-access-token', expires_in: 7200 }) };
    if (parsed.pathname.endsWith('/wxaapi/newtmpl/gettemplate')) return { ok: true, json: async () => ({ data: [{ priTmplId: DEFAULT_TEMPLATE_ID, content: '任务{{thing1.DATA}}\n时间{{time2.DATA}}' }] }) };
    return { ok: true, json: async () => ({ errcode: 0 }) };
  };
  const sender = createWechatNotificationSender({ getWechatConfig: async () => ({ appId: 'wx-fixture', appSecret: 'secret-fixture' }), fetchImpl, now: () => time });
  assert.deepEqual(await sender('verified-openid', { sessionId: 'session 123' }), { sent: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.touser, 'verified-openid');
  assert.equal(calls[2].body.page, 'pages/session/session?id=session%20123');
  assert.deepEqual(calls[2].body.data, { thing1: { value: '任务已完成' }, time2: { value: '2026-10-21 18:00' } });
  assert.equal(JSON.stringify(calls[2].body).includes('用户的任务原文'), false);
  assert.deepEqual(templateData('完成{{phrase1.DATA}} {{date2.DATA}}', () => time), { phrase1: { value: '已完成' }, date2: { value: '2026-10-21' } });
});

test('sender sends with the template ID carried by the ticket, not the built-in default', async () => {
  const time = Date.parse('2026-10-21T10:00:00Z');
  const ticketTemplateId = 'B'.repeat(43);
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed.pathname, body: options.body ? JSON.parse(options.body) : null });
    if (parsed.pathname.endsWith('/cgi-bin/token')) return { ok: true, json: async () => ({ access_token: 'fixture-access-token', expires_in: 7200 }) };
    if (parsed.pathname.endsWith('/wxaapi/newtmpl/gettemplate')) return { ok: true, json: async () => ({ data: [{ priTmplId: ticketTemplateId, content: '任务{{thing1.DATA}}' }] }) };
    return { ok: true, json: async () => ({ errcode: 0 }) };
  };
  const sender = createWechatNotificationSender({ getWechatConfig: async () => ({ appId: 'wx-fixture', appSecret: 'secret-fixture' }), fetchImpl, now: () => time });
  await sender('verified-openid', { sessionId: 's', templateId: ticketTemplateId });
  const send = calls.find(call => call.url.endsWith('/cgi-bin/message/subscribe/send'));
  assert.equal(send.body.template_id, ticketTemplateId);
  assert.notEqual(send.body.template_id, DEFAULT_TEMPLATE_ID);
});

test('templateData fills custom fields with real task metrics', () => {
  // 微信公众号实际关键词：任务名称、Token、任务结果（组合时长+缓存命中率）
  const content = '{{thing1.DATA}}\n\n任务名称：{{thing2.DATA}}\nToken：{{number3.DATA}}\n任务结果：{{thing4.DATA}}\n完成时间：{{time5.DATA}}';
  const metrics = { taskName: '重构通知模块', durationMs: 150000, tokens: 12345, cacheHitRate: 0.85 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.equal(data.thing1.value, '任务已完成'); // 无上下文，回退默认
  assert.equal(data.thing2.value, '重构通知模块');
  assert.equal(data.number3.value, '12345'); // number 字段只能是纯数字
  assert.equal(data.thing4.value, '时长2m30s · 缓存命中85%');
  assert.equal(data.time5.value, '2026-10-21 18:00');
});

test('templateData maps WeChat keywords with combined metrics in task result', () => {
  // 微信公众号实际关键词：任务名称、Token、任务结果
  const content = '{{thing1.DATA}}\n任务名称：{{thing2.DATA}}\nToken：{{number3.DATA}}\n任务结果：{{thing4.DATA}}';
  const metrics = { taskName: '代码审查', durationMs: 95000, tokens: 8765, cacheHitRate: 0.72 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.equal(data.thing2.value, '代码审查');
  assert.equal(data.number3.value, '8765');
  assert.equal(data.thing4.value, '时长1m35s · 缓存命中72%');
});

test('templateData uses remark field for combined metrics when no task result', () => {
  // 没有「任务结果」关键词时，用「备注」放组合指标
  const content = '{{thing1.DATA}}\n任务名称：{{thing2.DATA}}\nToken：{{number3.DATA}}\n备注：{{thing4.DATA}}';
  const metrics = { taskName: '数据分析', durationMs: 45000, tokens: 3200, cacheHitRate: 0.91 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.equal(data.thing2.value, '数据分析');
  assert.equal(data.number3.value, '3200');
  assert.equal(data.thing4.value, '时长45.0s · 缓存命中91%');
});

test('templateData gives dedicated fields priority over combined fields', () => {
  // 同时选了「任务结果」和「完成率」时，完成率必须拿到真实百分比，
  // 任务结果只放剩余指标（时长），不能把缓存命中率抢占掉。
  const content = '任务名称：{{thing1.DATA}}\nToken：{{number2.DATA}}\n任务结果：{{thing3.DATA}}\n完成率：{{number4.DATA}}';
  const metrics = { taskName: '重构通知模块', durationMs: 150000, tokens: 12345, cacheHitRate: 0.85 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.equal(data.thing1.value, '重构通知模块');
  assert.equal(data.number2.value, '12345');
  assert.equal(data.number4.value, '85');
  assert.equal(data.thing3.value, '时长2m30s');
});

test('templateData keeps numeric fields valid for WeChat validation', () => {
  // number/amount 只能放数字；phrase 最多 5 字符；character_string 允许字母符号。
  const content = 'Token：{{number1.DATA}}\n完成率：{{number2.DATA}}\n备注：{{phrase3.DATA}}';
  const metrics = { taskName: '任务', durationMs: 150000, tokens: 12345, cacheHitRate: 0.85 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.match(data.number1.value, /^\d+$/);
  assert.match(data.number2.value, /^\d+$/);
  assert.ok(data.phrase3.value.length <= 5);
});

test('Token uses compact formatting only when the WeChat field accepts character strings', () => {
  const metrics = { tokens: 12345 };
  const compact = templateData('Token：{{character_string1.DATA}}', () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  const numeric = templateData('Token：{{number1.DATA}}', () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.equal(compact.character_string1.value, '12.3K');
  assert.equal(numeric.number1.value, '12345');
});

test('templateData renders the requested completion reminder layout', () => {
  const content = '任务名称：{{thing1.DATA}}\nToken：{{character_string2.DATA}}\n任务结果：{{thing3.DATA}}\n完成时间：{{time4.DATA}}';
  const metrics = { taskName: '重构通知模块', durationMs: 150000, tokens: 12345, cacheHitRate: 0.85 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.deepEqual(data, {
    thing1: { value: '重构通知模块' },
    character_string2: { value: '12.3K' },
    thing3: { value: '时长2m30s · 缓存命中85%' },
    time4: { value: '2026-10-21 18:00' },
  });
});

test('templateData falls back to generic keywords for other templates', () => {
  // 通用关键词回退：耗时、消耗、缓存命中
  const content = '任务{{thing1.DATA}}已完成\n耗时{{character_string2.DATA}}\n消耗{{number3.DATA}} tokens\n缓存命中率{{character_string4.DATA}}';
  const metrics = { taskName: '测试任务', durationMs: 30000, tokens: 500, cacheHitRate: 0.9 };
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'), metrics);
  assert.equal(data.thing1.value, '测试任务');
  assert.equal(data.character_string2.value, '30.0s');
  assert.equal(data.number3.value, '500');
  assert.equal(data.character_string4.value, '90%');
});

test('templateData falls back to defaults when no metrics provided', () => {
  const content = '任务{{thing1.DATA}}已完成\nToken：{{number2.DATA}}\n耗时{{character_string3.DATA}}';
  const data = templateData(content, () => Date.parse('2026-10-21T10:00:00Z'));
  assert.equal(data.thing1.value, '任务已完成');
  assert.equal(data.number2.value, '0');
  assert.equal(data.character_string3.value, 'TASK_DONE');
});

test('templateData truncates long task names to field limits', () => {
  const longName = '这是一个非常非常非常非常非常非常非常非常非常长的任务名称需要截断处理';
  const data = templateData('任务名称：{{thing1.DATA}}', () => Date.parse('2026-10-21T10:00:00Z'), { taskName: longName });
  assert.ok(data.thing1.value.length <= 20);
  assert.ok(data.thing1.value.endsWith('…'));
});

test('formatDuration formats milliseconds to human-readable strings', () => {
  assert.equal(formatDuration(5000), '5.0s');
  assert.equal(formatDuration(45000), '45.0s');
  assert.equal(formatDuration(150000), '2m30s');
  assert.equal(formatDuration(3600000), '60m0s');
  assert.equal(formatDuration(0), '0.0s');
});

test('formatTokens formats token counts compactly', () => {
  assert.equal(formatTokens(500), '500');
  assert.equal(formatTokens(1500), '1.5K');
  assert.equal(formatTokens(12345), '12.3K');
  assert.equal(formatTokens(1500000), '1.5M');
});

test('formatCacheHitRate formats rate as percentage', () => {
  assert.equal(formatCacheHitRate(0.85), '85%');
  assert.equal(formatCacheHitRate(0), '0%');
  assert.equal(formatCacheHitRate(1), '100%');
  assert.equal(formatCacheHitRate(1.5), '100%'); // clamped
});

test('formatCombinedMetrics combines duration and cache hit rate with labels', () => {
  assert.equal(
    formatCombinedMetrics({ durationMs: 150000, tokens: 12345, cacheHitRate: 0.85 }),
    '时长2m30s · Token12.3K · 缓存命中85%'
  );
  assert.equal(
    formatCombinedMetrics({ durationMs: 45000, cacheHitRate: 0.91 }),
    '时长45.0s · 缓存命中91%'
  );
  assert.equal(
    formatCombinedMetrics({ durationMs: 150000, tokens: 12345, cacheHitRate: 0.85 }, ['tokens']),
    '时长2m30s · 缓存命中85%'
  );
  assert.equal(formatCombinedMetrics({}), '');
});

test('gateway completion with metrics passes them to notification sender', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-metrics-test-'));
  const calls = [];
  const openid = 'wechat-verified-metrics';
  const stateFile = path.join(dir, 'state.json');
  const identityKey = crypto.createHash('sha256').update(openid).digest('hex');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 2, codes: {}, redemptions: {}, access: {}, engagement: {
    identities: { [identityKey]: { openid, deviceId: 'WX-' + 'B'.repeat(24), createdAt: Date.now(), lastSeenAt: Date.now() } },
    invites: {}, visitors: {}, rewards: {}, moments: {}, rules: { enabled: false, tiers: [{ from: 1, days: 3 }, { from: 11, days: 7 }, { from: 16, days: 30 }], momentsDays: 3 },
  } }));
  const server = createService({
    stateFile, adminOpenIds: ['fixture-admin-openid'], exchangeCode: async code => 'wechat-verified-' + code,
    sendNotification: async (openid, context) => { calls.push({ openid, ...context }); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'metrics' }) }).then(r => r.json());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
  const issued = await fetch(base + '/notifications/tickets', { method: 'POST', headers, body: '{}' });
  const ticket = (await issued.json()).ticket;
  const complete = await fetch(base + '/notifications/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticket, sessionId: 'metrics-session', status: 'completed',
      taskName: '分析代码库', durationMs: 95000, tokens: 8765, cacheHitRate: 0.72,
    }),
  });
  assert.equal(complete.status, 200);
  assert.deepEqual(calls, [{
    openid: 'wechat-verified-metrics',
    sessionId: 'metrics-session',
    taskName: '分析代码库',
    durationMs: 95000,
    tokens: 8765,
    cacheHitRate: 0.72,
  }]);
});

test('gateway completion without metrics sends only sessionId', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notify-nometrics-test-'));
  const calls = [];
  const openid = 'wechat-verified-nometrics';
  const stateFile = path.join(dir, 'state.json');
  const identityKey = crypto.createHash('sha256').update(openid).digest('hex');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 2, codes: {}, redemptions: {}, access: {}, engagement: {
    identities: { [identityKey]: { openid, deviceId: 'WX-' + 'C'.repeat(24), createdAt: Date.now(), lastSeenAt: Date.now() } },
    invites: {}, visitors: {}, rewards: {}, moments: {}, rules: { enabled: false, tiers: [{ from: 1, days: 3 }, { from: 11, days: 7 }, { from: 16, days: 30 }], momentsDays: 3 },
  } }));
  const server = createService({
    stateFile, adminOpenIds: ['fixture-admin-openid'], exchangeCode: async code => 'wechat-verified-' + code,
    sendNotification: async (openid, context) => { calls.push({ openid, ...context }); },
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'nometrics' }) }).then(r => r.json());
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token };
  const issued = await fetch(base + '/notifications/tickets', { method: 'POST', headers, body: '{}' });
  const ticket = (await issued.json()).ticket;
  const complete = await fetch(base + '/notifications/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket, sessionId: 'plain-session', status: 'completed' }),
  });
  assert.equal(complete.status, 200);
  assert.deepEqual(calls, [{ openid: 'wechat-verified-nometrics', sessionId: 'plain-session' }]);
});
