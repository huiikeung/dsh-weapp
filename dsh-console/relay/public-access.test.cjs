'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { WebSocket, WebSocketServer } = require('ws');
const { createService } = require('../services/public-access/server.cjs');
const { ClientSession } = require('../../utils/relay-e2ee');
const ROOT = path.resolve(__dirname, '..');
const SECRET = 'fixture-internal-secret-never-production';
const DAY = 86400000;
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function waitFor(fn, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (!fn()) { if (Date.now() > deadline) throw new Error('Test condition timed out'); await new Promise(r => setTimeout(r, 25)); }
}
test('paid own-device relay: both credentials required, E2EE works, expired reconnect denied', { timeout: 25000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-public-e2e-'));
  let clock = Date.now(), gatewayDials = 0, pairCalls = 0, debugAuthDisabled = false;
  const children = [], sockets = [];
  const consoleServer = createService({ stateFile: path.join(dir, 'access.json'), relayAuthSecret: SECRET,
    adminOpenIds: ['fixture-admin'], exchangeCode: async code => code === 'admin' ? 'fixture-admin' : 'fixture-user', now: () => clock });
  const consolePort = await listen(consoleServer);
  const api = async (route, token, body) => {
    const response = await fetch('http://127.0.0.1:' + consolePort + route, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ...await response.json(), status: response.status };
  };
  const gatewayServer = http.createServer();
  const gateway = new WebSocketServer({ noServer: true });
  gatewayServer.on('upgrade', (req, socket, head) => {
    gatewayDials++;
    const allowed = req.headers.authorization === 'Bearer fixture-device-token-1234567890' ||
      String(req.headers['sec-websocket-protocol']).includes('dsh-pair.fixture-device-pairing-1234567890');
    if (!allowed && !debugAuthDisabled) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    gateway.handleUpgrade(req, socket, head, ws => {
      sockets.push(ws);
      ws.send(JSON.stringify({ kind: 'paired', token: 'fixture-device-token-1234567890' }));
      ws.send(JSON.stringify({ kind: 'hello', authenticated: allowed }));
      ws.on('message', () => ws.send(JSON.stringify({ kind: 'pong' })));
    });
  });
  const gatewayPort = await listen(gatewayServer);
  const mgmt = http.createServer((req, res) => {
    if (req.url === '/mgw/pair') pairCalls++;
    req.resume(); res.writeHead(req.url === '/mgw/relay' ? 200 : 404, { 'Content-Type': 'application/json' }); res.end('{}');
  });
  const mgmtPort = await listen(mgmt);
  const portProbe = http.createServer(); const relayPort = await listen(portProbe); await new Promise(r => portProbe.close(r));
  const start = (file, env) => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child); child.stdout.on('data', () => {}); child.stderr.on('data', () => {}); return child;
  };
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    for (const child of children) { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } }
    for (const server of [consoleServer, gatewayServer, mgmt]) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    gateway.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
  start('relay/relay-server.js', { RELAY_HOST: '127.0.0.1', RELAY_PORT: String(relayPort), RELAY_STATE_FILE: path.join(dir, 'relay.json'),
    RELAY_REQUIRE_PUBLIC_ACCESS: 'true', RELAY_AUTH_SECRET: SECRET, RELAY_AUTH_URL: 'http://127.0.0.1:' + consolePort + '/internal/relay/authorize' });
  let healthy = false;
  const healthDeadline = Date.now() + 6000;
  while (!healthy && Date.now() < healthDeadline) {
    try { healthy = (await fetch('http://127.0.0.1:' + relayPort + '/health')).ok; } catch {}
    if (!healthy) await new Promise(r => setTimeout(r, 25));
  }
  assert.equal(healthy, true, 'Relay starts within deadline');
  start('relay/agent-connector.js', { RELAY_URL: 'ws://127.0.0.1:' + relayPort, GATEWAY_URL: 'ws://127.0.0.1:' + gatewayPort,
    STATE_DIR: path.join(dir, 'identity'), MGMT_URL: 'http://127.0.0.1:' + mgmtPort });
  await waitFor(() => fs.existsSync(path.join(dir, 'identity/identity.json')) && fs.existsSync(path.join(dir, 'relay.json')));
  const identity = JSON.parse(fs.readFileSync(path.join(dir, 'identity/identity.json'), 'utf8'));
  const endpoint = 'ws://127.0.0.1:' + relayPort + '/c/' + identity.nodeId;
  const headers = { 'X-DSH-Device-ID': 'fixture-phone-123' };
  async function rejected(protocols, expected) {
    const ws = new WebSocket(endpoint, protocols, { headers }); sockets.push(ws); ws.on('error', () => {});
    const [code] = await once(ws, 'close'); assert.equal(code, expected);
  }
  await rejected(['dsh-mobile-v1', 'dsh-gateway-auth'], 4003);
  assert.equal(gatewayDials, 0);
  const admin = await api('/session', null, { code: 'admin' });
  const user = await api('/session', null, { code: 'user' });
  const input = { nodeId: identity.nodeId, deviceId: headers['X-DSH-Device-ID'] };
  assert.equal((await api('/public-access/lease', user.token, input)).status, 403);
  const code = await api('/admin/codes', admin.token, { days: 3, uses: 1 });
  const redeemed = await api('/redemptions', user.token, { code: code.code });
  assert.equal(redeemed.status, 200);
  const lease = await api('/public-access/lease', user.token, input);
  await rejected(['dsh-mobile-v1', 'dsh-gateway-auth', 'dsh-public.' + 'x'.repeat(43)], 4003);
  // No gateway marker/invite must not treat a paid subscription as device auth.
  await rejected(['dsh-mobile-v1', 'dsh-public.' + lease.token], 4003);
  async function encryptedClient(ticket, credential) {
    const ws = new WebSocket(endpoint, ['dsh-mobile-v1', 'dsh-gateway-auth', 'dsh-public.' + ticket.token], { headers }); sockets.push(ws);
    const session = new ClientSession(identity.nodeId, identity.signPublicKey), frames = [];
    ws.on('error', () => {});
    const closed = new Promise(resolve => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
    ws.on('open', () => ws.send(Buffer.from(session.hello)));
    ws.on('message', (data, binary) => {
      if (!binary) return;
      if (!session.ready) { assert.equal(session.acceptAgentHello(new Uint8Array(data)), true); ws.send(Buffer.from(session.seal(JSON.stringify({ type: 'relay-auth', ...credential })))); return; }
      frames.push(JSON.parse(session.open(new Uint8Array(data))));
    });
    return { ws, session, frames, closed };
  }
  const bad = await encryptedClient(lease, { token: 'fixture-wrong-device-token-123' });
  await waitFor(() => bad.frames.some(f => f.kind === 'relay-auth-error'));
  bad.ws.terminate(); assert.equal(pairCalls, 0, 'Invalid device token must never auto-pair');
  debugAuthDisabled = true;
  const insecure = await encryptedClient(lease, { token: 'fixture-wrong-device-token-123' });
  await waitFor(() => insecure.frames.some(f => f.kind === 'relay-auth-error'));
  assert.equal(insecure.frames.some(f => f.kind === 'hello' || f.kind === 'paired'), false, 'Debug auth-off gateway must not leak frames or device tokens');
  insecure.ws.terminate(); debugAuthDisabled = false;
  const valid = await encryptedClient(lease, { pairingCode: 'fixture-device-pairing-1234567890' });
  await waitFor(() => valid.frames.some(f => f.kind === 'hello'));
  valid.ws.send(Buffer.from(valid.session.seal(JSON.stringify({ type: 'ping' }))));
  await waitFor(() => valid.frames.some(f => f.kind === 'pong'));
  assert.equal(valid.frames.some(f => f.kind === 'paired'), true, 'Valid device token is released after authenticated hello');
  assert.equal(pairCalls, 0, 'Service cannot obtain a pairing code on behalf of a stranger');
  valid.ws.terminate();
  // Advance the service clock to verify expiry on reconnect without waiting days.
  clock = redeemed.expiresAt - 900;
  const nearUser = await api('/session', null, { code: 'user' });
  const nearLease = await api('/public-access/lease', nearUser.token, input);
  const stateFile = path.join(dir, 'access.json');
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(Object.values(saved.access)[0].expiresAt === redeemed.expiresAt);
  assert.equal(nearLease.expiresAt, redeemed.expiresAt);
  clock += 1000;
  const expired = await api('/internal/relay/authorize', SECRET, { ...input, token: nearLease.token });
  assert.equal(expired.status, 401);
  await rejected(['dsh-mobile-v1', 'dsh-gateway-auth', 'dsh-public.' + nearLease.token], 4003);
  const renewed = await api('/session', null, { code: 'admin' });
  const renewalCode = await api('/admin/codes', renewed.token, { days: 7, uses: 1 });
  const newUser = await api('/session', null, { code: 'user' });
  assert.equal((await api('/redemptions', newUser.token, { code: renewalCode.code })).status, 200);
  assert.equal((await api('/public-access/lease', newUser.token, input)).status, 201);
});

test('already-open relay socket closes at real account expiry; device identity survives', { timeout: 10000 }, async t => {
  const crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-expiry-e2e-'));
  const expiry = Date.now() + 2200;
  const stateFile = path.join(dir, 'access.json');
  const accountId = crypto.createHash('sha256').update('fixture-user').digest('hex');
  fs.writeFileSync(stateFile, JSON.stringify({ version: 2, codes: {}, redemptions: {}, access: { [accountId]: { expiresAt: expiry } } }));
  const service = createService({ stateFile, relayAuthSecret: SECRET, adminOpenIds: ['fixture-admin'], exchangeCode: async () => 'fixture-user' });
  const servicePort = await listen(service);
  const freePort = http.createServer(); const port = await listen(freePort); await new Promise(r => freePort.close(r));
  const sockets = [];
  const child = spawn(process.execPath, ['relay/relay-server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, RELAY_HOST: '127.0.0.1', RELAY_PORT: String(port), RELAY_STATE_FILE: path.join(dir, 'relay.json'),
    RELAY_REQUIRE_PUBLIC_ACCESS: 'true', RELAY_AUTH_SECRET: SECRET, RELAY_AUTH_URL: 'http://127.0.0.1:' + servicePort + '/internal/relay/authorize'
  } });
  let listening = false; child.stdout.on('data', data => { if (data.toString().includes('listening')) listening = true; }); child.stderr.on('data', () => {});
  t.after(async () => {
    sockets.forEach(ws => ws.terminate());
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    service.closeAllConnections(); await new Promise(r => service.close(r)); fs.rmSync(dir, { recursive: true, force: true });
  });
  await waitFor(() => listening);
  const nodeId = 'fixture-users-own-node';
  const agent = new WebSocket('ws://127.0.0.1:' + port + '/a/' + nodeId, { headers: { 'X-DSH-Gateway-Auth': '1' } }); sockets.push(agent);
  await once(agent, 'open');
  const login = await (await fetch('http://127.0.0.1:' + servicePort + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'fixture' }) })).json();
  const input = { nodeId, deviceId: 'fixture-real-phone' };
  const lease = await (await fetch('http://127.0.0.1:' + servicePort + '/public-access/lease', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + login.token }, body: JSON.stringify(input) })).json();
  assert.equal(lease.expiresAt, expiry);
  const client = new WebSocket('ws://127.0.0.1:' + port + '/c/' + nodeId, ['dsh-mobile-v1', 'dsh-gateway-auth', 'dsh-public.' + lease.token], { headers: { 'X-DSH-Device-ID': input.deviceId } }); sockets.push(client);
  let authorized = false;
  client.on('message', (data, binary) => { if (!binary && JSON.parse(data).kind === 'relay-authorized') authorized = true; });
  const [code, reason] = await once(client, 'close');
  assert.equal(authorized, true, 'Socket must have been admitted before expiry');
  assert.equal(code, 4003); assert.equal(reason.toString(), 'public-lease-expired');
  assert.ok(Date.now() >= expiry && Date.now() < expiry + 1500);
  assert.equal(agent.readyState, WebSocket.OPEN, 'Subscription expiry must not disconnect the owner computer');
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, 'utf8')).access[accountId], { expiresAt: expiry });
});
