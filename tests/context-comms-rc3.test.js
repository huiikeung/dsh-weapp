// DSH rc.3 comms: `send_message` names the recipient (`target`) instead of the
// legacy session-id field (`agent_id`). The scan must still surface the relay
// rows and resolve the teammate name through the roster the client forwards.
const test = require('node:test');
const assert = require('node:assert/strict');

async function loadBridge() {
  return import('../scripts/lib/context-bridge.mjs');
}

function sendMessageEvents(callId, target, message) {
  return [
    {
      seq: 10,
      time: 1000,
      type: 'tool/call',
      data: { turn: 1, step: 1, callId, name: 'send_message', arguments: JSON.stringify({ target, message }) }
    },
    {
      seq: 11,
      time: 1100,
      type: 'tool/result',
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          source: { kind: 'tool', callId },
          toolCallId: callId,
          isError: false,
          content: [{ type: 'text', text: '{"sent":true}' }]
        }
      }
    }
  ];
}

test('buildCommsValue reads rc.3 target names and resolves them through the roster', async () => {
  const bridge = await loadBridge();
  const sessions = [
    { id: 'root', title: '主会话', events: sendMessageEvents('call_1', '阿青', '帮我修一下') },
    {
      id: 'child',
      title: '子会话',
      parentSessionId: 'root',
      mode: 'continuable',
      events: [{ seq: 12, time: 1200, type: 'turn/end', data: { reason: { kind: 'completed' } } }]
    }
  ];
  const members = [{ id: 'child', name: '阿青' }];
  const resolveTarget = (name) => (members.find((member) => member.name === name) || {}).id || '';
  const value = bridge.buildCommsValue(sessions, { resolveTarget });
  const relay = value.messages.find((message) => message.kind === 'relay');
  assert.ok(relay, 'the send_message relay row is visible');
  assert.equal(relay.from, 'root');
  assert.equal(relay.to, 'child');
  assert.equal(relay.toName, '阿青');
  assert.equal(relay.text, '帮我修一下');

  // Without a roster name the row must still render instead of disappearing.
  const unresolved = bridge.buildCommsValue(sessions);
  const row = unresolved.messages.find((message) => message.kind === 'relay');
  assert.ok(row);
  assert.equal(row.to, '阿青');
  assert.equal(row.toName, '阿青');
});

test('the same relay seen in sender and recipient logs collapses to one row', async () => {
  const bridge = await loadBridge();
  const recipientEvents = [{
    seq: 12,
    time: 1150,
    type: 'user/message',
    data: {
      source: { kind: 'agent-message', senderSessionId: 'root' },
      content: [{ type: 'text', text: 'Agent root sent a message: 同步一下进度' }]
    }
  }];
  const value = bridge.buildCommsValue([
    { id: 'root', events: sendMessageEvents('call_1', '阿青', '同步一下进度') },
    { id: 'child', title: '子会话', events: recipientEvents }
  ], { resolveTarget: (name) => (name === '阿青' ? 'child' : '') });
  assert.equal(value.messages.length, 1, 'sender tool/call and recipient injection are the same message');
  assert.equal(value.messages[0].kind, 'relay');
  assert.equal(value.messages[0].text, '同步一下进度');
});

test('legacy send_message agent_id rows keep their family membership guard', async () => {
  const bridge = await loadBridge();
  const legacyEvents = [
    {
      seq: 1,
      time: 1000,
      type: 'tool/call',
      data: { callId: 'call_legacy', name: 'send_message', arguments: JSON.stringify({ agent_id: 'child', message: 'hello' }) }
    },
    {
      seq: 2,
      time: 1001,
      type: 'tool/result',
      data: { message: { source: { callId: 'call_legacy' }, toolCallId: 'call_legacy', isError: false } }
    }
  ];
  const inside = bridge.buildCommsValue([{ id: 'root', events: legacyEvents }, { id: 'child', events: [] }]);
  assert.equal(inside.messages.length, 1);
  assert.equal(inside.messages[0].to, 'child');
  const outside = bridge.buildCommsValue([{ id: 'root', events: legacyEvents }]);
  assert.equal(outside.messages.length, 0, 'a legacy target outside the family stays filtered');
});

test('context-comms handler forwards the roster resolver and parent address', async () => {
  const bridge = await loadBridge();
  const historyCalls = [];
  const api = {
    sessions: {
      history: async (payload) => {
        historyCalls.push(payload);
        return {
          kind: 'history',
          title: payload.sessionId,
          events: sendMessageEvents('call_1', '阿青', '同步一下进度')
        };
      }
    }
  };
  const frame = await bridge.handleContextComms(api, {
    type: 'context-comms',
    sessionIds: ['root', 'child'],
    sessions: [{ id: 'child', parentSessionId: 'root', mode: 'continuable' }],
    members: [{ id: 'child', name: '阿青' }]
  });
  assert.equal(frame.kind, 'context-comms');
  assert.deepEqual(historyCalls.map((call) => call.sessionId), ['root', 'child']);
  assert.deepEqual(historyCalls[1], { sessionId: 'child', maxMessages: 400, parentSessionId: 'root', mode: 'continuable' });
  const relay = frame.value.messages.find((message) => message.kind === 'relay');
  assert.equal(relay.to, 'child');
  assert.equal(relay.toName, '阿青');
  assert.equal(frame.value.scanned, 2);
});
