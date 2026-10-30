const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, secureRandomBytes } = require('../ascf/ascf_src/utils/crypto');
const nacl = require('../ascf/ascf_src/utils/nacl.min');
const { ClientSession, concat, utf8, utf8Decode, PROTOCOL } = require('../ascf/ascf_src/utils/relay-e2ee');
const { GatewayClient } = require('../ascf/ascf_src/utils/gateway');

const material = offset => Uint8Array.from({ length: 48 }, (_, i) => (offset + i) & 255);
const tick = () => new Promise(resolve => setImmediate(resolve));
const nodeId = 'node-example';
const endpoint = 'wss://relay.example.test/c/node-example';
const relayOptions = { pairingCode: 'pair-code', relay: {
  nodeId, agentPubKey: Buffer.alloc(32, 7).toString('base64'), authMode: 'gateway'
} };

function installRuntime(t, behavior) {
  const requests = [];
  const sockets = [];
  global.has = {
    getStorageSync: () => 'fixture-device',
    setStorageSync() {},
    getDeviceInfo: () => ({ brand: 'Test', model: 'Device' }),
    getRandomValues(options) { requests.push(options); },
    connectSocket(options) {
      const handlers = {};
      const socket = {
        options, sent: [], closed: false,
        onOpen(fn) { handlers.open = fn; if (behavior && behavior.openSynchronously) fn(); },
        onMessage(fn) { handlers.message = fn; },
        onError(fn) { handlers.error = fn; },
        onClose(fn) { handlers.close = fn; },
        send(options) { this.sent.push(options); },
        close() { this.closed = true; },
        open() { handlers.open(); },
        message(data) { handlers.message({ data }); }
      };
      sockets.push(socket);
      return socket;
    }
  };
  t.after(() => { delete global.has; });
  return { requests, sockets };
}

function success(request, bytes) {
  request.success({ randomValues: bytes.buffer });
}

function installFakeTimers(t) {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = [];
  global.setTimeout = (callback, delay) => {
    const timer = { callback, delay, cleared: false };
    timers.push(timer);
    return timer;
  };
  global.clearTimeout = timer => { if (timer) timer.cleared = true; };
  t.after(() => { global.setTimeout = originalSetTimeout; global.clearTimeout = originalClearTimeout; });
  return { timers, fire(timer) { timer.callback(); } };
}

test('secure random is asynchronous, validates ArrayBuffer, and never exposes a weak sync fallback', async t => {
  const { requests } = installRuntime(t);
  assert.throws(() => randomBytes(32), /unavailable/);
  assert.throws(() => nacl.randomBytes(16), /unavailable/);
  assert.throws(() => nacl.box.keyPair(), /unavailable/);
  assert.throws(() => new ClientSession(nodeId, '', material(1)), /secure asynchronous/);
  const pending = secureRandomBytes(48);
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(requests[0].length, 48);
  const source = material(3);
  success(requests[0], source);
  const bytes = await pending;
  assert.deepEqual(bytes, source);
  source.fill(0);
  assert.notDeepEqual(bytes, source, 'returned bytes are an independent copy');
  const crossRealm = require('node:vm').runInNewContext('new Uint8Array([1, 2, 3]).buffer');
  const crossRealmPending = secureRandomBytes(3);
  requests[1].success({ randomValues: crossRealm });
  assert.deepEqual(await crossRealmPending, new Uint8Array([1, 2, 3]));
  await assert.rejects(secureRandomBytes(0), /length/);
});

test('missing, failing, throwing, malformed, and late random responses fail closed', async t => {
  installRuntime(t);
  delete global.has.getRandomValues;
  await assert.rejects(secureRandomBytes(48), /unavailable/);
  global.has.getRandomValues = options => options.fail({ errMsg: 'failure' });
  await assert.rejects(ClientSession.create(nodeId, ''), /failed/);
  global.has.getRandomValues = () => { throw new Error('failure'); };
  await assert.rejects(secureRandomBytes(48), /failed/);
  for (const randomValues of [undefined, new ArrayBuffer(47), new Uint8Array(48), 'not a buffer',
    { byteLength: 48, [Symbol.toStringTag]: 'ArrayBuffer' }]) {
    global.has.getRandomValues = options => options.success({ randomValues });
    await assert.rejects(secureRandomBytes(48), /Invalid secure random values/);
  }
  let timeout, request;
  const set = global.setTimeout, clear = global.clearTimeout;
  try {
    global.setTimeout = fn => { timeout = fn; return 123; };
    global.clearTimeout = () => {};
    global.has.getRandomValues = options => { request = options; };
    const pending = secureRandomBytes(48);
    timeout();
    await assert.rejects(pending, /timed out/);
    success(request, material(4));
  } finally {
    global.setTimeout = set;
    global.clearTimeout = clear;
  }
});

test('concurrent sessions use distinct supplied bytes and complete the actual E2EE protocol', async t => {
  const { requests } = installRuntime(t);
  nacl.setPRNG(() => { throw new Error('unexpected synchronous random call'); });
  const identity = nacl.sign.keyPair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 31));
  const agent = nacl.box.keyPair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, i) => i + 61));
  const publicKey = Buffer.from(identity.publicKey).toString('base64');
  const first = ClientSession.create(nodeId, publicKey);
  const second = ClientSession.create(nodeId, publicKey);
  const a = material(10), b = material(90);
  assert.equal(requests.length, 2);
  success(requests[1], b);
  success(requests[0], a);
  const [clientA, clientB] = await Promise.all([first, second]);
  assert.deepEqual(clientA.ephemeral.secretKey, a.slice(0, 32));
  assert.deepEqual(clientB.ephemeral.secretKey, b.slice(0, 32));
  assert.deepEqual(clientA.hello.subarray(33), a.slice(32));
  assert.deepEqual(clientB.hello.subarray(33), b.slice(32));
  assert.deepEqual(clientA.hello.subarray(1, 33), nacl.scalarMult.base(a.slice(0, 32)));
  assert.notDeepEqual(clientA.hello, clientB.hello);
  assert.throws(() => nacl.randomBytes(1), /unexpected synchronous/);

  const transcript = nacl.hash(concat(utf8(PROTOCOL + '\0'), utf8(nodeId), clientA.hello, agent.publicKey));
  const signature = nacl.sign.detached(transcript, identity.secretKey);
  assert.equal(clientA.acceptAgentHello(concat(new Uint8Array([2]), agent.publicKey, signature)), true);
  const hostShared = nacl.box.before(clientA.ephemeral.publicKey, agent.secretKey);
  const hostKey = nacl.hash(concat(utf8(PROTOCOL + '-KDF\0'), hostShared, transcript)).subarray(0, 32);
  assert.deepEqual(clientA.key, hostKey);
  const packet = clientA.seal('secure frame');
  const clear = nacl.secretbox.open(packet.subarray(9), concat(clientA.txPrefix, new Uint8Array(8)), hostKey);
  assert.equal(clear[0], 3);
  assert.equal(utf8Decode(clear.subarray(1)), 'secure frame');
});

test('gateway rejects non-WSS before dialing and permits WSS for platform validation', t => {
  const { sockets } = installRuntime(t);
  let failure = '';
  const client = new GatewayClient({ onState(state, message) { if (state === 'failed') failure = message; } });
  t.after(() => client.disconnect());
  for (const endpoint of ['ws://public.example.test/ws/mobile', 'http://example.test', '']) {
    client.connectTransport(endpoint);
    assert.equal(client.state, 'failed');
    assert.match(failure, /wss:\/\//i);
    assert.match(failure, /配置/);
    assert.equal(sockets.length, 0);
  }
  client.connectTransport('ws://192.168.1.10/ws/mobile');
  assert.equal(client.state, 'connecting');
  assert.equal(sockets.length, 1);
  client.disconnect();
  client.connectTransport('wss://gateway.example.test/ws/mobile');
  assert.equal(client.state, 'connecting');
  assert.equal(sockets.length, 2);
});

test('gateway waits for random bytes and fails closed on missing or failed source', async t => {
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  assert.equal(client.state, 'connecting');
  assert.equal(sockets[0].sent.length, 0);
  requests[0].fail({ errMsg: 'failed' });
  await tick();
  assert.equal(client.state, 'failed');
  assert.equal(client.wantsConnection, false);
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets[0].sent.length, 0);
  delete global.has.getRandomValues;
  client.connect(endpoint, relayOptions);
  sockets[1].open();
  await tick();
  assert.equal(client.state, 'failed');
  assert.equal(sockets[1].sent.length, 0);
});

test('gateway sends a valid encrypted pairing after the signed agent hello', async t => {
  const clock = installFakeTimers(t);
  const { requests, sockets } = installRuntime(t);
  const identity = nacl.sign.keyPair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 9));
  const agent = nacl.box.keyPair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, i) => i + 49));
  const options = { pairingCode: 'pair-code', relay: {
    nodeId, agentPubKey: Buffer.from(identity.publicKey).toString('base64'), authMode: 'gateway'
  } };
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, options);
  sockets[0].open();
  const handshakeTimer = client.timeoutTimer;
  success(requests[0], material(7));
  await tick();
  const hello = new Uint8Array(sockets[0].sent[0].data);
  const transcript = nacl.hash(concat(utf8(PROTOCOL + '\0'), utf8(nodeId), hello, agent.publicKey));
  const signature = nacl.sign.detached(transcript, identity.secretKey);
  sockets[0].message(concat(new Uint8Array([2]), agent.publicKey, signature).buffer);
  assert.equal(sockets[0].sent.length, 2);
  assert.equal(client.state, 'connecting');
  const key = nacl.hash(concat(utf8(PROTOCOL + '-KDF\0'),
    nacl.box.before(hello.subarray(1, 33), agent.secretKey), transcript)).subarray(0, 32);
  const prefixes = nacl.hash(concat(key, utf8('nonce-prefix')));
  const authPacket = new Uint8Array(sockets[0].sent[1].data);
  const authClear = nacl.secretbox.open(authPacket.subarray(9), concat(prefixes.subarray(0, 16), new Uint8Array(8)), key);
  assert.equal(authClear[0], 3);
  const auth = JSON.parse(utf8Decode(authClear.subarray(1)));
  assert.equal(auth.type, 'relay-auth');
  assert.equal(auth.pairingCode, 'pair-code');
  const counter = new Uint8Array(8);
  const pairedClear = concat(new Uint8Array([3]), utf8(JSON.stringify({ kind: 'paired', token: 'device-token' })));
  const pairedPacket = concat(new Uint8Array([3]), counter,
    nacl.secretbox(pairedClear, concat(prefixes.subarray(16, 32), counter), key));
  sockets[0].message(pairedPacket.buffer);
  assert.equal(client.pairingCode, null);
  assert.equal(client.timeoutTimer, handshakeTimer);
  counter[7] = 1;
  const helloClear = concat(new Uint8Array([3]), utf8(JSON.stringify({ kind: 'hello' })));
  const hostPacket = concat(new Uint8Array([3]), counter,
    nacl.secretbox(helloClear, concat(prefixes.subarray(16, 32), counter), key));
  sockets[0].message(hostPacket.buffer);
  assert.equal(client.state, 'connected');
  assert.equal(client.timeoutTimer, null);
  clock.fire(handshakeTimer);
  assert.equal(client.state, 'connected');
  assert.equal(sockets[0].closed, false);
});

test('reconnect ignores stale success and failure and requests new randomness', async t => {
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  client.connect(endpoint, relayOptions);
  sockets[1].open();
  client.connect(endpoint, relayOptions);
  sockets[2].open();
  assert.equal(requests.length, 3);
  requests[0].fail({ errMsg: 'old failure' });
  success(requests[1], material(11));
  success(requests[2], material(101));
  await tick();
  assert.equal(client.state, 'connecting');
  assert.equal(sockets[0].sent.length, 0);
  assert.equal(sockets[1].sent.length, 0);
  assert.equal(sockets[2].sent.length, 1);
  assert.deepEqual(new Uint8Array(sockets[2].sent[0].data).subarray(33), material(101).slice(32));
  assert.deepEqual(client.relaySession.ephemeral.secretKey, material(101).slice(0, 32));
});

test('parallel gateways and duplicate open events do not share or reuse random material', async t => {
  const { requests, sockets } = installRuntime(t);
  const a = new GatewayClient(), b = new GatewayClient();
  t.after(() => { a.disconnect(); b.disconnect(); });
  a.connect(endpoint, relayOptions);
  b.connect(endpoint, relayOptions);
  sockets[0].open();
  sockets[0].open();
  sockets[1].open();
  assert.equal(requests.length, 2);
  success(requests[1], material(80));
  success(requests[0], material(20));
  await tick();
  assert.equal(sockets[0].sent.length, 1);
  assert.equal(sockets[1].sent.length, 1);
  assert.deepEqual(a.relaySession.ephemeral.secretKey, material(20).slice(0, 32));
  assert.deepEqual(b.relaySession.ephemeral.secretKey, material(80).slice(0, 32));
});


test('unopened transport times out without discarding an unconfirmed pairing code', t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  const timer = client.timeoutTimer;
  assert.equal(timer.delay, 30000);
  clock.fire(timer);
  assert.equal(client.state, 'failed');
  assert.equal(sockets[0].closed, true);
  assert.equal(client.timeoutTimer, null);
  assert.equal(client.pairingCode, 'pair-code');
  assert.equal(client.wantsConnection, false);
});

test('opened relay without AgentHello times out and preserves an unconfirmed pairing code', async t => {
  const clock = installFakeTimers(t);
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  const timer = client.timeoutTimer;
  assert.equal(timer.delay, 30000);
  success(requests[0], material(2));
  await tick();
  assert.equal(sockets[0].sent.length, 1);
  clock.fire(timer);
  assert.equal(client.state, 'failed');
  assert.equal(sockets[0].closed, true);
  assert.equal(client.pairingCode, 'pair-code');
  assert.equal(client.timeoutTimer, null);
});


test('a random callback delivered after a handshake timeout cannot send or revive the socket', async t => {
  const clock = installFakeTimers(t);
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  const timer = client.timeoutTimer;
  clock.fire(timer);
  assert.equal(client.state, 'failed');
  success(requests[0], material(27));
  await tick();
  assert.equal(client.state, 'failed');
  assert.equal(client.socketTask, null);
  assert.equal(client.relaySession, null);
  assert.equal(sockets[0].sent.length, 0);
  assert.equal(client.pairingCode, 'pair-code');
});

test('paired confirmation consumes the code but cannot cancel waiting for gateway hello', async t => {
  const clock = installFakeTimers(t);
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  success(requests[0], material(4));
  await tick();
  const timer = client.timeoutTimer;
  client.handleFrame(JSON.stringify({ kind: 'paired', token: 'device-token' }));
  assert.equal(client.pairingCode, null);
  assert.equal(client.lastConnectOpts.token, 'device-token');
  assert.equal(client.state, 'connecting');
  assert.equal(client.timeoutTimer, timer);
  clock.fire(timer);
  assert.equal(client.state, 'failed');
  assert.equal(client.wantsConnection, true);
  assert.ok(client.reconnectTimer);
});



test('relay authorization does not suppress an unfinished E2EE handshake timeout', async t => {
  const clock = installFakeTimers(t);
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, { relay: { nodeId, agentPubKey: Buffer.alloc(32, 7).toString('base64'),
    authMode: 'invite', inviteToken: 'fixture-invite' } });
  sockets[0].open();
  success(requests[0], material(16));
  await tick();
  const timer = client.timeoutTimer;
  sockets[0].message(JSON.stringify({ kind: 'relay-authorized', accessToken: 'relay-token' }));
  assert.equal(client.relayAccessToken, 'relay-token');
  assert.equal(client.timeoutTimer, timer);
  clock.fire(timer);
  assert.equal(client.state, 'failed');
  assert.equal(sockets[0].closed, true);
  assert.ok(client.reconnectTimer);
});

test('a verified AgentHello without a gateway hello still times out', async t => {
  const clock = installFakeTimers(t);
  const { requests, sockets } = installRuntime(t);
  const identity = nacl.sign.keyPair.fromSeed(Uint8Array.from({ length: 32 }, (_, i) => i + 21));
  const agent = nacl.box.keyPair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, i) => i + 71));
  const options = { pairingCode: 'pair-code', relay: {
    nodeId, agentPubKey: Buffer.from(identity.publicKey).toString('base64'), authMode: 'gateway'
  } };
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, options);
  sockets[0].open();
  success(requests[0], material(17));
  await tick();
  const hello = new Uint8Array(sockets[0].sent[0].data);
  const transcript = nacl.hash(concat(utf8(PROTOCOL + '\0'), utf8(nodeId), hello, agent.publicKey));
  const signature = nacl.sign.detached(transcript, identity.secretKey);
  sockets[0].message(concat(new Uint8Array([2]), agent.publicKey, signature).buffer);
  assert.equal(client.relaySession.ready, true);
  assert.equal(sockets[0].sent.length, 2);
  const timer = client.timeoutTimer;
  client.handleFrame(JSON.stringify({ kind: 'event', seq: 1 }));
  assert.equal(client.timeoutTimer, timer);
  clock.fire(timer);
  assert.equal(client.state, 'failed');
  assert.equal(sockets[0].closed, true);
  assert.equal(client.pairingCode, 'pair-code');
});

test('an invalid AgentHello is rejected before encrypted credentials are sent', async t => {
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  success(requests[0], material(23));
  await tick();
  const invalidHello = new Uint8Array(97);
  invalidHello[0] = 2;
  sockets[0].message(invalidHello.buffer);
  assert.equal(client.state, 'failed');
  assert.equal(client.timeoutTimer, null);
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets[0].sent.length, 1);
});

test('direct connection clears its timer when it becomes connected', t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect('wss://gateway.example.test/ws/mobile', { token: 'saved-token' });
  const beforeOpen = client.timeoutTimer;
  sockets[0].open();
  const afterOpen = clock.timers[clock.timers.length - 1];
  assert.equal(client.state, 'connected');
  assert.equal(client.timeoutTimer, null);
  clock.fire(beforeOpen);
  clock.fire(afterOpen);
  assert.equal(client.state, 'connected');
  assert.equal(sockets[0].closed, false);
});

test('cancelled stage and old socket timers cannot break a later connection', t => {
  const clock = installFakeTimers(t);
  const { sockets, requests } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  const firstStage = client.timeoutTimer;
  sockets[0].open();
  const firstHandshake = client.timeoutTimer;
  clock.fire(firstStage);
  assert.equal(client.state, 'connecting');
  assert.equal(sockets[0].closed, false);
  client.connect(endpoint, relayOptions);
  const secondStage = client.timeoutTimer;
  clock.fire(firstHandshake);
  assert.equal(client.state, 'connecting');
  assert.equal(client.socketTask, sockets[1]);
  assert.equal(sockets[1].closed, false);
  client.disconnect();
  clock.fire(secondStage);
  assert.equal(client.state, 'disconnected');
  requests[0].fail({ errMsg: 'cancelled' });
});

test('timeout falls back with the same unconfirmed code to the next route', t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, { ...relayOptions, endpointCandidates: ['wss://backup.example.test/ws/mobile'] });
  clock.fire(client.timeoutTimer);
  assert.equal(client.state, 'connecting');
  assert.equal(client.pairingCode, 'pair-code');
  const fallback = clock.timers.find(timer => timer.delay === 0 && !timer.cleared);
  assert.ok(fallback);
  clock.fire(fallback);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].options.url, 'wss://backup.example.test/ws/mobile');
  assert.ok(sockets[1].options.protocols.includes('dsh-pair.pair-code'));
  assert.equal(client.timeoutTimer.delay, 8000);
  clock.fire(client.timeoutTimer);
  assert.equal(client.state, 'failed');
  assert.equal(client.pairingCode, 'pair-code');
});

test('a cancelled fallback cannot reconnect after the user disconnects', t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, { ...relayOptions, endpointCandidates: ['wss://backup.example.test/ws/mobile'] });
  clock.fire(client.timeoutTimer);
  const fallback = clock.timers.find(timer => timer.delay === 0 && !timer.cleared);
  assert.ok(fallback);
  client.disconnect();
  clock.fire(fallback);
  assert.equal(client.state, 'disconnected');
  assert.equal(sockets.length, 1);
});


test('a synchronous socket open does not leave a new connection timer behind', t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t, { openSynchronously: true });
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect('wss://gateway.example.test/ws/mobile', { pairingCode: 'pair-code' });
  assert.equal(client.state, 'connected');
  assert.equal(client.timeoutTimer, null);
  assert.equal(clock.timers.length, 1);
  clock.fire(clock.timers[0]);
  assert.equal(client.state, 'connected');
  assert.equal(sockets[0].closed, false);
});

test('waiting for a user prompt has no active socket timer and ignores an old timer', async t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t);
  const accessApi = require('../ascf/ascf_src/utils/access-api');
  const prompt = require('../ascf/ascf_src/utils/public-access-prompt');
  const originals = { isManagedRelay: accessApi.isManagedRelay, cachedLease: accessApi.cachedLease,
    publicLease: accessApi.publicLease, prompt: prompt.promptFirstAuthorizedUse };
  t.after(() => {
    accessApi.isManagedRelay = originals.isManagedRelay;
    accessApi.cachedLease = originals.cachedLease;
    accessApi.publicLease = originals.publicLease;
    prompt.promptFirstAuthorizedUse = originals.prompt;
  });
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  const oldTimer = client.timeoutTimer;
  let proceed;
  accessApi.isManagedRelay = () => true;
  accessApi.cachedLease = () => null;
  accessApi.publicLease = () => Promise.resolve({ token: 'lease', expiresAt: Date.now() + 60000 });
  prompt.promptFirstAuthorizedUse = callback => { proceed = callback; };
  await client.connect(endpoint, relayOptions);
  assert.equal(client.state, 'connecting');
  assert.equal(client.socketTask, null);
  assert.equal(client.timeoutTimer, null);
  clock.fire(oldTimer);
  assert.equal(client.state, 'connecting');
  assert.equal(typeof proceed, 'function');
  proceed();
  assert.equal(sockets.length, 2);
  assert.equal(client.state, 'connecting');
  assert.ok(client.timeoutTimer);
});

test('a pending fallback cannot replace a newer explicit connection', t => {
  const clock = installFakeTimers(t);
  const { sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, { ...relayOptions, endpointCandidates: ['wss://backup.example.test/ws/mobile'] });
  clock.fire(client.timeoutTimer);
  const fallback = clock.timers.find(timer => timer.delay === 0 && !timer.cleared);
  client.connect('wss://new.example.test/ws/mobile', { token: 'saved-token' });
  clock.fire(fallback);
  assert.equal(client.endpoint, 'wss://new.example.test/ws/mobile');
  assert.equal(client.socketTask, sockets[1]);
  assert.equal(sockets.length, 2);
});

test('asynchronous failure to send the hello closes the current connection', async t => {
  const { requests, sockets } = installRuntime(t);
  const client = new GatewayClient();
  t.after(() => client.disconnect());
  client.connect(endpoint, relayOptions);
  sockets[0].open();
  success(requests[0], material(5));
  await tick();
  sockets[0].sent[0].fail({ errMsg: 'send failed' });
  assert.equal(client.state, 'failed');
  assert.equal(sockets[0].closed, true);
});
