'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {GatewayClient}=require('../miniprogram/utils/gateway');

// 回归测试：GatewayClient.state 是字符串（'disconnected'|'connecting'|'connected'|'failed'），
// requestCostMeter 曾误写成 this.state.connection，字符串没有该属性，永远读出 undefined，
// 于是即使已连接也每次抛「未连接」，额度卡片与额度页一直显示数据不可用。
test('requestCostMeter reads the string connection state, not a store object', async () => {
  const client = Object.create(GatewayClient.prototype);
  client.pendingRequests = {};
  const sent = [];
  client.send = (frame) => { sent.push(frame); return true; };
  client.state = 'connected';

  const pending = client.requestCostMeter('summary');
  assert.equal(sent.length, 1, '已连接时必须真的把请求发出去');
  assert.equal(sent[0].type, 'cost-meter');
  assert.equal(sent[0].action, 'summary');
  assert.ok(sent[0].requestId, '请求必须带 requestId');

  client.resolveCorrelated({ kind: 'cost-meter', requestId: sent[0].requestId, action: 'summary', dashboard: { currency: 'USD' } });
  const frame = await pending;
  assert.equal(frame.kind, 'cost-meter');
  assert.equal(frame.dashboard.currency, 'USD');
});

test('requestCostMeter still refuses to send while disconnected', async () => {
  const client = Object.create(GatewayClient.prototype);
  client.pendingRequests = {};
  let sent = 0;
  client.send = () => { sent++; return true; };
  client.state = 'disconnected';

  await assert.rejects(() => client.requestCostMeter('summary'), /未连接/);
  assert.equal(sent, 0, '未连接时不得发送任何帧');
});

test('requestCostMeter default action is summary and payload merges', async () => {
  const client = Object.create(GatewayClient.prototype);
  client.pendingRequests = {};
  const sent = [];
  client.send = (frame) => { sent.push(frame); return true; };
  client.state = 'connected';

  const pending = client.requestCostMeter(undefined, { source: 'gateway:one' });
  assert.equal(sent[0].action, 'summary');
  assert.equal(sent[0].source, 'gateway:one');
  client.resolveCorrelated({ kind: 'cost-meter', requestId: sent[0].requestId, action: 'summary' });
  await pending;
});

test('requestCostMeter rejects when the gateway answers with an error frame', async () => {
  const client = Object.create(GatewayClient.prototype);
  client.pendingRequests = {};
  const sent = [];
  client.send = (frame) => { sent.push(frame); return true; };
  client.state = 'connected';

  const pending = client.requestCostMeter('summary');
  client.resolveCorrelated({ kind: 'error', requestId: sent[0].requestId, code: 'cost-meter-dashboard-error', message: '额度数据读取失败' });
  await assert.rejects(() => pending, (error) => {
    assert.equal(error.code, 'cost-meter-dashboard-error');
    assert.match(error.message, /额度数据读取失败/);
    return true;
  });
});
