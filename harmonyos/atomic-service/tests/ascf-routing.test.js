const test = require('node:test');
const assert = require('node:assert/strict');

const previousHas = global.has;
global.has = { getStorageSync: () => undefined, connectSocket() {} };

const runtime = require('../ascf/ascf_src/utils/runtime');
const routeTable = require('../ascf/ascf_src/utils/route-table');
const { parse, PairingError } = require('../ascf/ascf_src/utils/pairing');

const now = 1_800_000_000_000;
const direct = 'wss://gateway.example.test/ws/mobile';
const secondDirect = 'wss://backup.example.test/ws/mobile';
const localWss = 'wss://192.168.1.10:3081/ws/mobile';
const localWs = 'ws://192.168.1.10:3081/ws/mobile';
const relay = 'wss://relay.example.test/relay';
const nodeId = 'node_12345678';
const agentPubKey = Buffer.alloc(32, 7).toString('base64');
const pairingCode = 'pairing-code-1234567890';
const future = now + 60_000;
const raw = payload => Buffer.from(JSON.stringify(payload)).toString('base64url');
const relayRoute = fields => ({ relay, nodeId, agentPubKey, authMode: 'gateway', ...fields });

function v2(fields = {}) {
  return {
    version: 2,
    publicUrl: direct,
    endpoints: [direct],
    pairingCode,
    expiresAt: future,
    gatewayId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ...fields
  };
}

test('ASCF identifies separately and never inherits native route capabilities', () => {
  global.wx = { getAccountInfoSync: () => ({ miniProgram: { appId: 'wx-test' } }) };
  global.has = { getStorageSync: () => undefined, connectSocket() {} };
  assert.equal(runtime.isASCFRuntime(), true);
  assert.equal(runtime.isWeChatMiniProgram(), false);
  assert.equal(runtime.clientKind(), 'ascf');
  assert.deepEqual(routeTable.allowedFamilies(runtime.clientKind()), ['public', 'lan', 'relay']);
  delete global.wx;
});

test('ASCF candidates keep configured WSS direct routes and filter ws or malformed URLs', () => {
  const table = routeTable.parseRouteTable({
    routes: {
      public: [direct, localWs, 'ws://public.example.test/ws', 'wss://user:pass@bad.example/ws', 'wss://bad.example/ws?token=x', 'wss://bad host.example/ws', 'wss://bad-port.example:70000/ws'],
      lan: [localWs, localWss]
    }
  });
  const candidates = routeTable.orderCandidates(table, { client: 'ascf' });
  assert.deepEqual(candidates.map(item => item.endpoint), [direct, localWss]);
  assert.deepEqual(candidates.map(item => item.kind), ['public', 'lan']);

  const configuredHost = 'wss://unlisted-here.example.test/ws/mobile';
  assert.equal(routeTable.orderCandidates({ public: [configuredHost] }, { client: 'ascf' })[0].endpoint, configuredHost,
    'the client filters URL syntax only and leaves developer-center domain authorization to platform configuration');
});

test('ASCF preferred endpoint is normalized and accepted only when present in the route set', () => {
  const table = { public: [direct, secondDirect], lan: [localWss], relay: relayRoute() };
  assert.deepEqual(
    routeTable.orderCandidates(table, { client: 'ascf', preferred: secondDirect }).map(item => item.endpoint),
    [secondDirect, direct, localWss, relay + '/c/' + nodeId]
  );
  assert.deepEqual(
    routeTable.orderCandidates(table, { client: 'ascf', preferred: localWs }).map(item => item.endpoint),
    [direct, secondDirect, localWss, relay + '/c/' + nodeId]
  );
  assert.deepEqual(
    routeTable.orderCandidates(table, { client: 'ascf', preferred: 'wss://not-in-pairing.example/ws' }).map(item => item.endpoint),
    [direct, secondDirect, localWss, relay + '/c/' + nodeId]
  );
  const preferredRelay = routeTable.orderCandidates(table, {
    client: 'ascf', preferred: relay + '/c/' + nodeId
  });
  assert.equal(preferredRelay[0].kind, 'relay');
  assert.equal(preferredRelay[0].relay.agentPubKey, agentPubKey);
});

test('ASCF orders direct WSS before a validated relay fallback', () => {
  const candidates = routeTable.orderCandidates({
    public: [direct, localWs],
    lan: [localWss],
    relay: relayRoute()
  }, { client: 'ascf' });
  assert.deepEqual(candidates.map(item => item.endpoint), [direct, localWss, relay + '/c/' + nodeId]);
  assert.equal(candidates[2].kind, 'relay');
  assert.equal(candidates[2].relay.agentPubKey, agentPubKey);
  assert.deepEqual(routeTable.orderCandidates({ public: ['ws://192.168.1.2/ws'] }, { client: 'ascf' }), []);
  assert.deepEqual(routeTable.orderCandidates(null, { client: 'ascf' }), []);
});

test('v2 merges ASCF WSS routes without letting miniProgramRoute replace a direct route', () => {
  const parsed = parse(raw(v2({
    routes: { public: [direct, secondDirect], lan: [localWs] },
    miniProgramRoute: { mode: 'direct', publicUrl: 'wss://wechat-route.example.test/ws/mobile' }
  })), now);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.publicUrl, direct);
  assert.deepEqual(parsed.payload.endpoints, [direct, secondDirect, 'wss://wechat-route.example.test/ws/mobile']);
  assert.equal(parsed.payload.pairingCode, pairingCode);
  assert.equal(parsed.payload.expiresAt, future);
});

test('v2 can fall back to a WSS miniProgramRoute when root routes are ws-only', () => {
  const parsed = parse(raw(v2({
    publicUrl: localWs,
    endpoints: [localWs],
    miniProgramRoute: {
      mode: 'direct',
      publicUrl: 'wss://configured.example.test/ws/mobile',
      endpoints: ['wss://configured.example.test/ws/mobile', localWs]
    }
  })), now);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.payload.endpoints, ['wss://configured.example.test/ws/mobile']);
  assert.equal(parsed.payload.endpoints.some(endpoint => endpoint.startsWith('ws://')), false);
});

test('v2 includes a validated mini relay as fallback after direct WSS and ignores a bad relay beside a good route', () => {
  const parsed = parse(raw(v2({ miniProgramRoute: { mode: 'relay', ...relayRoute() } })), now);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.mode, undefined);
  assert.deepEqual(parsed.payload.endpoints, [direct, relay + '/c/' + nodeId]);
  const candidates = routeTable.orderCandidates(parsed.payload.routeTable, { client: runtime.clientKind() });
  assert.equal(candidates[1].kind, 'relay');
  assert.equal(candidates[1].relay.agentPubKey, agentPubKey);
  assert.equal(parsed.payload.pairingCode, pairingCode);

  const badRelay = parse(raw(v2({ miniProgramRoute: { mode: 'relay', ...relayRoute({ agentPubKey: 'bad' }) } })), now);
  assert.equal(badRelay.ok, true, 'a malformed optional relay must not displace a usable direct route');
  assert.deepEqual(badRelay.payload.endpoints, [direct]);
  assert.equal(badRelay.payload.routeTable.relay, null);
});

test('v2 relay-only pairing retains relay mode and credential checks', () => {
  const parsed = parse(raw(v2({
    publicUrl: localWs,
    endpoints: [localWs],
    miniProgramRoute: { mode: 'relay', ...relayRoute() }
  })), now);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.mode, 'relay');
  assert.equal(parsed.payload.publicUrl, relay + '/c/' + nodeId);
  assert.equal(parsed.payload.pairingCode, pairingCode);
  assert.equal(parsed.payload.agentPubKey, agentPubKey);

  const badKey = parse(raw(v2({
    publicUrl: localWs,
    endpoints: [localWs],
    miniProgramRoute: { mode: 'relay', ...relayRoute({ agentPubKey: 'invalid' }) }
  })), now);
  assert.equal(badKey.ok, false);
  assert.equal(badKey.error, PairingError.INVALID_RELAY);
});

test('v3 relay keeps expiry, pairing code, invite, and key validation', () => {
  const valid = parse(raw({
    version: 3,
    mode: 'relay',
    ...relayRoute({ pairingCode, expiresAt: future })
  }), now);
  assert.equal(valid.ok, true);
  assert.equal(valid.payload.publicUrl, relay + '/c/' + nodeId);
  assert.equal(valid.payload.pairingCode, pairingCode);
  assert.equal(valid.payload.routeTable.relay.agentPubKey, agentPubKey);

  const inviteToken = 'i'.repeat(40);
  const invite = parse(raw({
    version: 3, mode: 'relay', ...relayRoute({ inviteToken, expiresAt: future })
  }), now);
  assert.equal(invite.ok, true);
  assert.equal(invite.payload.inviteToken, inviteToken);
  assert.equal(invite.payload.routeTable.relay.inviteToken, inviteToken);

  assert.equal(parse(raw({ version: 3, mode: 'relay', ...relayRoute({ agentPubKey: 'bad', pairingCode, expiresAt: future }) }), now).error,
    PairingError.INVALID_RELAY);
  assert.equal(parse(raw({ version: 3, mode: 'relay', ...relayRoute({ relay: 'wss://relay.example.test:70000', pairingCode, expiresAt: future }) }), now).error,
    PairingError.INVALID_RELAY);
  assert.equal(parse(raw({ version: 3, mode: 'relay', ...relayRoute({ pairingCode: 'short', expiresAt: future }) }), now).error,
    PairingError.MISSING_RELAY_AUTH);
  assert.equal(parse(raw({ version: 3, mode: 'relay', ...relayRoute({ pairingCode, expiresAt: now }) }), now).error,
    PairingError.EXPIRED);
});

test('empty WSS candidate sets and expired or invalid v2 pairing data fail closed', () => {
  assert.deepEqual(routeTable.orderCandidates({}, { client: 'ascf' }), []);
  assert.equal(parse(raw(v2({ publicUrl: localWs, endpoints: [localWs] })), now).error, PairingError.INVALID_ENDPOINT);
  assert.equal(parse(raw(v2({ pairingCode: 'has,comma' })), now).error, PairingError.INVALID_CODE);
  assert.equal(parse(raw(v2({ expiresAt: now })), now).error, PairingError.EXPIRED);
});

test('test module restores the Harmony API stub', () => {
  if (previousHas === undefined) delete global.has;
  else global.has = previousHas;
});
