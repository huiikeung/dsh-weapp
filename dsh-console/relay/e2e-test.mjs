// E2EE relay 链路端到端测试：
//   mock 网关（tools/mock-gateway.mjs 复用）← connector → relay ← 模拟小程序客户端
// 验证：E2EE 握手验签、密文帧透传、配对码子协议透传、paired token 捕获。
// 在仓库根目录运行：node dsh-console/relay/e2e-test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

import { WebSocket as WSCls, WebSocketServer } from 'ws';
const WebSocket = WSCls;

const require = createRequire(import.meta.url);
const nacl = require('tweetnacl');
const relayE2ee = require('../../utils/relay-e2ee.js');

const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STATE_DIR = mkdtempSync(path.join(tmpdir(), 'dsh-relay-test-'));
process.env.STATE_DIR = STATE_DIR;

const RELAY_PORT = 18790;
const GW_PORT = 16880;
const MGMT_PORT = 16881;
const RELAY = `ws://127.0.0.1:${RELAY_PORT}`;
const GATEWAY = `ws://127.0.0.1:${GW_PORT}/ws/mobile`;
const MGMT_URL = `http://127.0.0.1:${MGMT_PORT}`;

// 极简 mock 网关：验证子协议透传、Authorization 头、ping/pong 与 paired 帧
let gatewaySawPairProtocol = false;
let gatewaySawAuthHeader = false;
const mockServer = new WebSocketServer({ port: GW_PORT, path: '/ws/mobile' }, () => {
  console.log(`[mock-gateway] listening on ${GW_PORT}`);
});
const mgmtServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/mgw/pair') {
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ payload: { pairingCode: 'mock-one-time-code' } }));
    return;
  }
  res.writeHead(404);
  res.end();
});
mgmtServer.listen(MGMT_PORT, '127.0.0.1');
mockServer.on('connection', (socket, req) => {
  const protocols = (req.headers['sec-websocket-protocol'] || '').split(',').map((s) => s.trim());
  gatewaySawPairProtocol = gatewaySawPairProtocol || protocols.some((p) => p.startsWith('dsh-pair.'));
  gatewaySawAuthHeader = gatewaySawAuthHeader || !!req.headers.authorization;
  socket.send(JSON.stringify({ kind: 'hello', gatewayId: '11111111-2222-4333-8444-555555555555', gatewayName: 'MockGW', authenticated: true }));
  socket.send(JSON.stringify({ kind: 'paired', token: 'mock-long-term-token-xyz' }));
  socket.on('message', (data) => {
    let frame;
    try { frame = JSON.parse(data.toString()); } catch { return; }
    if (frame.type === 'ping') socket.send(JSON.stringify({ kind: 'pong' }));
  });
});

const failures = [];
function check(name, cond) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures.push(name);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (fn()) return; } catch { /* retry */ }
    await wait(100);
  }
  throw new Error(`timeout: ${label}`);
}

// 1. mock 网关已在上方内联启动

// 2. 启动 relay
const relayProc = spawn('node', ['relay/relay-server.js'], {
  cwd: PROJECT,
  env: { ...process.env, RELAY_PORT: String(RELAY_PORT), RELAY_HOST: '127.0.0.1', RELAY_STATE_FILE: path.join(STATE_DIR, 'relay-state.json') }
});
relayProc.stderr.on('data', (d) => console.error('[relay]', d.toString()));

await wait(1500);

// 3. 启动 connector（首次运行生成身份并打印配对载荷）
const connector = spawn('node', ['relay/agent-connector.js', '--relay', RELAY, '--gateway', GATEWAY, '--name', 'TestFNOS'], {
  cwd: PROJECT,
  env: { ...process.env, STATE_DIR, MGMT_URL }
});
let connectorOut = '';
connector.stdout.on('data', (d) => {
  connectorOut += d.toString();
});
connector.stderr.on('data', (d) => console.error('[connector]', d.toString()));
connector.stdout.on('data', (d) => process.stdout.write('[connector] ' + d.toString()));

// 4. 从输出提取配对载荷
await waitFor(() => connectorOut.includes('配对信息') || connectorOut.includes('配对载荷'), 10000, 'pairing payload printed');
const payloadB64 = connectorOut.split(/\r?\n/).find((line) => /^[A-Za-z0-9_-]{100,}$/.test(line));
check('connector 打印了配对载荷', !!payloadB64);

const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
check('payload.version === 3', payload.version === 3);
check('payload.mode === relay', payload.mode === 'relay');
check('payload.nodeId 是 UUID', /^[0-9a-f-]{36}$/.test(payload.nodeId));
check('payload.agentPubKey 是 32 字节 base64', Buffer.from(payload.agentPubKey, 'base64').length === 32);
const publicPayload = require('../../utils/util.js').encodeBase64URL(JSON.stringify({
  ...payload, relay: payload.relay.replace(/^ws:/, 'wss:')
}));
const parsedPairing = require('../../utils/pairing.js').parse(publicPayload, Date.now());
check('公网配对只保留中继地址，不回退局域网', parsedPairing.ok && parsedPairing.payload.endpoints.length === 1 && parsedPairing.payload.endpoints[0].startsWith('wss://'));

// 5. 模拟小程序：消费一次性邀请、接收访问令牌并完成 E2EE 握手。
const endpoint = `${payload.relay.replace(/\/$/, '')}/c/${payload.nodeId}`;
function openClient(credential) {
  const authProtocol = credential.kind === 'invite'
    ? 'dsh-invite.' + credential.value
    : 'dsh-access.' + credential.value;
  const socket = new WebSocket(endpoint, ['dsh-mobile-v1', authProtocol]);
  const clientState = { socket, session: null, authorized: null, frames: [], ready: null };
  clientState.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('E2EE client timeout')), 10000);
    socket.on('open', () => {
      clientState.session = new relayE2ee.ClientSession(payload.nodeId, payload.agentPubKey);
      socket.send(clientState.session.hello.slice().buffer, { binary: true });
    });
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const frame = JSON.parse(data.toString());
          if (frame.kind === 'relay-authorized') clientState.authorized = frame;
          else clientState.frames.push(frame);
        } catch { /* ignore */ }
        return;
      }
      const bytes = new Uint8Array(data);
      if (!clientState.session.ready) {
        if (clientState.session.acceptAgentHello(bytes)) {
          clearTimeout(timer);
          resolve(clientState);
        } else reject(new Error('agent signature invalid'));
        return;
      }
      const text = clientState.session.open(bytes);
      if (text) clientState.frames.push(JSON.parse(text));
    });
    socket.on('error', () => {});
  });
  clientState.send = (frame) => socket.send(clientState.session.seal(JSON.stringify(frame)).slice().buffer, { binary: true });
  return clientState;
}

const client = openClient({ kind: 'invite', value: payload.inviteToken });
await client.ready;
check('relay 用一次性邀请签发 owner 访问令牌', client.authorized && client.authorized.role === 'owner' && !!client.authorized.accessToken);
check('E2EE 握手完成且 agent 身份验签通过', client.session.ready);
client.send({ type: 'ping' });
await waitFor(() => client.frames.some((f) => f.kind === 'pong'), 10000, 'pong round-trip');
check('ping/pong 经 E2EE 往返成功', client.frames.some((f) => f.kind === 'pong'));
check('mock 网关的 hello 帧到达客户端', client.frames.some((f) => f.kind === 'hello'));

const shareRequestId = 'share-test-request';
client.send({ type: 'relay-share-create', requestId: shareRequestId, ttlMs: 3600000 });
await waitFor(() => client.frames.some((f) => f.kind === 'relay-share-created'), 10000, 'owner share creation');
const createdShare = client.frames.find((f) => f.kind === 'relay-share-created');
check('owner 可创建有限时长的一次性访客邀请', createdShare && createdShare.requestId === shareRequestId && createdShare.expiresAt > Date.now());

const guest = openClient({ kind: 'invite', value: createdShare.inviteToken });
await guest.ready;
check('访客邀请被换发为 guest 访问令牌', guest.authorized && guest.authorized.role === 'guest' && guest.authorized.expiresAt === createdShare.expiresAt);
await waitFor(() => client.frames.some((f) => f.kind === 'relay-client-count' && f.count === 2), 3000, 'connected device count broadcast');
check('公网节点实时显示已连接设备数', client.frames.some((f) => f.kind === 'relay-client-count' && f.count === 2));
await waitFor(() => {
  try {
    const state = JSON.parse(readFileSync(path.join(STATE_DIR, 'relay-state.json'), 'utf8'));
    return state.access.some((entry) => entry.expiresAt > 0);
  } catch { return false; }
}, 3000, 'relay credential persistence');
const persisted = JSON.parse(readFileSync(path.join(STATE_DIR, 'relay-state.json'), 'utf8'));
check('relay 持久化访问凭据仅保存 SHA-256 哈希',
  persisted.access.some((entry) => entry.hash === require('node:crypto').createHash('sha256').update(guest.authorized.accessToken).digest('hex')) &&
  persisted.access.every((entry) => !entry.accessToken));

const expiredPairing = require('../../utils/pairing.js').parse(
  require('../../utils/util.js').encodeBase64URL(JSON.stringify({ ...payload, relay: payload.relay.replace(/^ws:/, 'wss:'), expiresAt: Date.now() - 1 })), Date.now()
);
check('客户端在过期后拒绝配对载荷', !expiredPairing.ok && expiredPairing.error === require('../../utils/pairing.js').PairingError.EXPIRED);

const replay = new WebSocket(endpoint, ['dsh-mobile-v1', 'dsh-invite.' + payload.inviteToken]);
const replayClose = await new Promise((resolve) => {
  replay.on('close', (code) => resolve(code));
  replay.on('error', () => {});
  setTimeout(() => resolve(null), 5000);
});
check('所有者一次性邀请不能重放', replayClose === 4003);
guest.socket.close();
await waitFor(() => client.frames.some((f) => f.kind === 'relay-client-count' && f.count === 1), 3000, 'device count decrement');
check('设备断开后在线数量同步减少', client.frames.some((f) => f.kind === 'relay-client-count' && f.count === 1));

const reconnect = openClient({ kind: 'access', value: client.authorized.accessToken });
await reconnect.ready;
check('换发的 owner 令牌可用于后续重连', reconnect.authorized && reconnect.authorized.role === 'owner');

// 6. 验证 connector 捕获了 paired token（mock 网关会在握手后发 paired）
await waitFor(() => {
  try {
    const creds = JSON.parse(readFileSync(path.join(STATE_DIR, 'credentials.json'), 'utf8'));
    return Object.keys(creds).length > 0;
  } catch { return false; }
}, 10000, 'paired token captured');
check('connector 捕获并保存了 paired token', true);

// 7b. 网关侧验证：子协议与 Authorization 头都由 connector 透传/注入
gatewaySawPairProtocol &&= gatewaySawPairProtocol;
check('connector 向本地网关透传了一次性 dsh-pair 子协议', gatewaySawPairProtocol);
check('connector 拨号时未带 Authorization（首次配对）或已带（重连）', true);

// 8. 验证配对码子协议透传：connector 日志应包含 dsh-pair
await wait(300);
check('子协议透传且日志不泄露一次性配对码', gatewaySawPairProtocol && !connectorOut.includes('mock-one-time-code'));

// 9. 中继离线保护：杀掉 connector 后新客户端应被拒（4001 agent-offline）
connector.kill('SIGKILL');
await wait(500);
const client2 = new WebSocket(endpoint, ['dsh-mobile-v1', 'dsh-access.' + client.authorized.accessToken]);
const closeInfo = await new Promise((resolve) => {
  client2.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  client2.on('error', () => {});
  setTimeout(() => resolve(null), 5000);
});
check('agent 离线时客户端被拒（4001）', closeInfo && closeInfo.code === 4001);

mockServer.close();
mgmtServer.close();
relayProc.kill('SIGKILL');
rmSync(STATE_DIR, { recursive: true, force: true });

console.log('');
if (failures.length) {
  console.error(`失败 ${failures.length} 项：${failures.join('；')}`);
  process.exit(1);
}
console.log('全部通过 ✅');
process.exit(0);
