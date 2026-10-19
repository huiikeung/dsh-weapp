// DSH Weapp Agent Connector —— 运行在 fnOS/电脑上。
//
// 1. 出站 wss 连接中继注册 nodeId（不开任何入站端口，与 dsh-wechat-remote 的
//    outbound-only relay 思路一致）；
// 2. 收到 client-open 后，按客户端请求的子协议拨本地网关
//    ws://127.0.0.1:<port>/ws/mobile（配对码经 Sec-WebSocket-Protocol 透传）；
// 3. E2EE：完成 ClientHello/AgentHello 握手并验签客户端身份后，
//    解密小程序帧转发给本地网关，网关回帧加密后经中继回传。
//
// 用法：node agent-connector.js --relay wss://<你的域名> [--gateway ws://<fnOS内网IP>:3081/ws/mobile]
// 首次运行生成 ~/.dsh-weapp-relay/identity.json（nodeId + Ed25519 身份密钥），
// 并打印配对载荷（Base64URL），可直接做成二维码或粘到小程序手动配对。

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
let nacl;
try { nacl = require('tweetnacl'); } catch { nacl = require('./vendor/tweetnacl.js'); }
const WebSocket = require('ws');

// ---------- 配置 ----------

function arg(name, fallback) {
  const idx = process.argv.indexOf('--' + name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const configuredRelay = (process.env.RELAY_URL || arg('relay', '')).replace(/\/$/, '');
// Built-in service routing, not a secret. Preserve third-party relay settings.
const RELAY = ['', 'wss://relay.ahwe.top', 'wss://relay.ahwe.top/relay'].includes(configuredRelay)
  ? 'wss://dsh.ahwe.top/relay' : configuredRelay;
const GATEWAY = process.env.GATEWAY_URL || arg('gateway', 'ws://127.0.0.1:3081/ws/mobile');
const STATE_DIR = process.env.STATE_DIR || path.join(os.homedir(), '.dsh-weapp-relay');
const GATEWAY_NAME = process.env.GATEWAY_NAME || arg('name', 'fnOS DSH');
const MGMT_URL = process.env.MGMT_URL || arg('mgmt', 'http://127.0.0.1:2298');

if (!/^wss?:\/\//.test(RELAY)) {
  console.error('用法：node agent-connector.js --relay wss://<中继域名> [--gateway ws://<fnOS内网IP>:3081/ws/mobile]');
  process.exit(1);
}

// Keep the plugin's single-instance contract and its existing identity folder.
fs.mkdirSync(STATE_DIR, { recursive: true });
const lockFile = path.join(STATE_DIR, 'connector.lock');
let previous;
try { previous = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch {}
if (previous && Number.isInteger(previous.pid) && previous.pid !== process.pid) {
  let alive = false;
  try { process.kill(previous.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
  if (alive) { console.error('Another connector owns this identity; stop it before starting another.'); process.exit(1); }
}
fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 });
process.on('exit', () => {
  try { if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid === process.pid) fs.unlinkSync(lockFile); } catch {}
});

// ---------- 身份 ----------

const PROTOCOL = 'dsh-weapp-e2ee-v1';
const PACKET_CLIENT_HELLO = 1;
const PACKET_AGENT_HELLO = 2;
const PACKET_SEALED = 3;
const CLEAR_DATA = 3;

function loadIdentity() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, 'identity.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.nodeId && saved.signSecretKey && saved.signPublicKey) return saved;
  } catch (e) { /* 首次运行 */ }
  const keyPair = nacl.sign.keyPair();
  const identity = {
    nodeId: crypto.randomUUID(),
    deviceId: crypto.randomUUID(),
    signPublicKey: Buffer.from(keyPair.publicKey).toString('base64'),
    signSecretKey: Buffer.from(keyPair.secretKey).toString('base64')
  };
  fs.writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
  return identity;
}

const identity = loadIdentity();

// 网关长期凭据：E2EE 解密后的 paired 帧中提取，重连拨号时注入 Authorization。
// 仅存于 fnOS 本机（与 iOS 存 Keychain 同一信任边界）。
function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'credentials.json'), 'utf8'));
  } catch (e) { return {}; }
}
function saveCreds(creds) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, 'credentials.json'), JSON.stringify(creds, null, 2), { mode: 0o600 });
  } catch (e) { /* 忽略 */ }
}
function captureToken(text, deviceId) {
  try {
    const frame = JSON.parse(text);
    if (frame && frame.kind === 'paired' && frame.token) {
      const creds = loadCreds();
      const key = deviceId || GATEWAY;
      if (creds[key] !== frame.token) {
        creds[key] = frame.token;
        saveCreds(creds);
        log('已保存网关长期凭据（用于重连）');
      }
    }
  } catch (e) { /* 非 JSON 帧 */ }
}

// ---------- E2EE（与小程序端 utils/relay-e2ee.js 镜像） ----------

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function utf8(text) { return new TextEncoder().encode(text); }
function utf8Decode(bytes) { return new TextDecoder().decode(bytes); }

function counterBytes(value) {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i -= 1) { out[i] = v & 255; v = Math.floor(v / 256); }
  return out;
}

function readCounter(bytes, offset) {
  let value = 0;
  for (let i = 0; i < 8; i += 1) value = value * 256 + bytes[offset + i];
  return value;
}

class AgentSession {
  constructor(nodeId, identitySecretKey) {
    this.nodeId = nodeId;
    this.identitySecretKey = identitySecretKey;
    this.ephemeral = nacl.box.keyPair();
    this.rxCounter = 0;
    this.txCounter = 0;
    this.ready = false;
  }

  /** 输入 ClientHello，返回 AgentHello 二进制；失败返回 null。 */
  acceptClientHello(packet) {
    if (!packet || packet.length !== 1 + 32 + 16 || packet[0] !== PACKET_CLIENT_HELLO) return null;
    const clientEphPub = packet.subarray(1, 33);
    const agentEphPub = this.ephemeral.publicKey;
    const transcript = nacl.hash(concat(utf8(PROTOCOL + '\0'), utf8(this.nodeId), packet, agentEphPub));
    const signature = nacl.sign.detached(transcript, this.identitySecretKey);
    const shared = nacl.box.before(clientEphPub, this.ephemeral.secretKey);
    const key = nacl.hash(concat(utf8(PROTOCOL + '-KDF\0'), shared, transcript)).subarray(0, 32); // SHA-512 取前 32 字节
    const material = nacl.hash(concat(key, utf8('nonce-prefix')));
    this.txPrefix = material.subarray(16, 32); // agent 发送前缀
    this.rxPrefix = material.subarray(0, 16);  // 客户端发送前缀
    this.key = key;
    this.ready = true;
    return concat(new Uint8Array([PACKET_AGENT_HELLO]), agentEphPub, signature);
  }

  seal(text) {
    if (!this.ready) throw new Error('E2EE 会话未就绪');
    const counter = this.txCounter;
    this.txCounter += 1;
    const clear = concat(new Uint8Array([CLEAR_DATA]), utf8(text));
    const sealed = nacl.secretbox(clear, concat(this.txPrefix, counterBytes(counter)), this.key);
    return concat(new Uint8Array([PACKET_SEALED]), counterBytes(counter), sealed);
  }

  open(packet) {
    if (!this.ready || !packet || packet.length < 9 + 17 || packet[0] !== PACKET_SEALED) return null;
    const counter = readCounter(packet, 1);
    if (counter < this.rxCounter) return null;
    const clear = nacl.secretbox.open(packet.subarray(9), concat(this.rxPrefix, counterBytes(counter)), this.key);
    if (!clear || clear.length < 1 || clear[0] !== CLEAR_DATA) return null;
    this.rxCounter = counter + 1;
    return utf8Decode(clear.subarray(1));
  }
}

// ---------- 中继连接 ----------

let relaySocket = null;
let relayBackoff = 1000;
let relayWants = true;

function connectRelay() {
  if (!relayWants) return;
  log(`连接中继 ${RELAY}/a/${identity.nodeId}`);
  const ws = new WebSocket(`${RELAY.replace(/\/$/, '')}/a/${identity.nodeId}`, { headers: { 'X-DSH-Gateway-Auth': '1' } });
  relaySocket = ws;

  ws.on('open', () => {
    log('已注册到中继');
    relayBackoff = 1000;
    printPairingPayload();
    // Preserve the plugin's QR generation: it needs this connector's identity.
    fetch(MGMT_URL.replace(/\/$/, '') + '/mgw/relay', {
      method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Origin: new URL(MGMT_URL).origin },
      body: JSON.stringify({ relay: RELAY.replace(/\/$/, ''), nodeId: identity.nodeId,
        agentPubKey: identity.signPublicKey, gatewayName: GATEWAY_NAME })
    }).then(response => { if (!response.ok) throw new Error('registration rejected'); })
      .catch(() => log('插件身份注册未完成，请确认本机管理端口；既有配对信息不变'));
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      handleRelayBinary(data);
      return;
    }
    let frame;
    try { frame = JSON.parse(data.toString('utf8')); } catch (e) { return; }
    if (frame.kind === 'pairing-offer') printPairingPayload(frame);
    if (frame.kind === 'client-open') handleClientOpen(frame, ws).catch((error) => {
      log(`建立客户端管道失败: ${error.message}`);
    });
    if (frame.kind === 'client-close') handleClientClose(frame);
    if (frame.kind === 'code-created' || frame.kind === 'code-error' || frame.kind === 'code-redeemed') {
      const pipe = pipes.get(frame.bridgeId);
      if (pipe && pipe.session.ready) {
        const kinds = {
          'code-created': 'relay-code-created',
          'code-error': 'relay-code-error',
          'code-redeemed': 'relay-code-redeemed'
        };
        const response = Object.assign({ kind: kinds[frame.kind], requestId: frame.requestId }, frame);
        delete response.kind_original;
        response.kind = kinds[frame.kind];
        sendPipeFrame(ws, frame.bridgeId, pipe.session.seal(JSON.stringify(response)));
      }
    }
    if (frame.kind === 'invite-created' || frame.kind === 'invite-error') {
      const pipe = pipes.get(frame.bridgeId);
      if (pipe && pipe.session.ready) {
        const response = frame.kind === 'invite-created'
          ? { kind: 'relay-share-created', requestId: frame.requestId,
            inviteToken: frame.inviteToken, expiresAt: frame.expiresAt }
          : { kind: 'relay-share-error', requestId: frame.requestId, message: frame.message };
        sendPipeFrame(ws, frame.bridgeId, pipe.session.seal(JSON.stringify(response)));
      }
    }
  });

  ws.on('close', () => {
    for (const [bridgeId, pipe] of pipes) if (pipe.agentWs === ws) handleClientClose({ bridgeId });
    log('与中继断开，准备重连');
    setTimeout(connectRelay, relayBackoff);
    relayBackoff = Math.min(relayBackoff * 2, 30000);
  });
  ws.on('error', (err) => log('中继连接错误: ' + err.message));
}

// ---------- 管道 ----------

const pipes = new Map(); // bridgeId → { session, gateway, agentWs }

function normalizeDeviceName(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f\ufffd]/.test(value)) return '';
  return value.trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/, '');
}

// Only a gateway-authenticated device id may be renamed. Never trust an id
// supplied by the phone or the public relay; the name arrives inside E2EE.
async function updateDeviceName(pipe, name) {
  if (name !== undefined) pipe.phoneDeviceName = normalizeDeviceName(name);
  if (!pipe.authenticatedDeviceId || !pipe.phoneDeviceName || pipe.renamingDevice
      || pipe.savedDeviceName === pipe.phoneDeviceName) return;
  const targetName = pipe.phoneDeviceName;
  pipe.renamingDevice = true;
  try {
    const response = await fetch(MGMT_URL.replace(/\/$/, '') + '/mgw/devices/'
      + encodeURIComponent(pipe.authenticatedDeviceId) + '/rename', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: targetName })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    pipe.savedDeviceName = targetName;
  } catch (error) { log('设备名称更新失败: ' + error.message); }
  finally { pipe.renamingDevice = false; }
  if (pipe.phoneDeviceName !== targetName) void updateDeviceName(pipe);
}

function captureDeviceIdentity(pipe, text) {
  let message; try { message = JSON.parse(text); } catch { return; }
  if (message.kind !== 'hello' || message.authenticated !== true
      || !message.device || typeof message.device.id !== 'string') return;
  pipe.authenticatedDeviceId = message.device.id;
  pipe.savedDeviceName = message.device.name;
  void updateDeviceName(pipe);
}

async function requestPairingCode(deviceName) {
  try {
    const response = await fetch(MGMT_URL.replace(/\/$/, '') + '/mgw/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: deviceName || 'WeChat mini-program' })
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const pairingCode = data && data.payload && data.payload.pairingCode;
    if (!pairingCode) throw new Error('配对码缺失');
    return pairingCode;
  } catch (error) {
    log('无法获取一次性配对码: ' + error.message);
    return null;
  }
}

async function handleClientOpen(frame, agentWs) {
  const bridgeId = frame.bridgeId;
  const session = new AgentSession(identity.nodeId, Buffer.from(identity.signSecretKey, 'base64'));
  const protocols = Array.isArray(frame.protocols) ? frame.protocols.slice() : ['dsh-mobile-v1'];
  const deviceId = String(frame.deviceId || crypto.randomUUID()).slice(0, 128);
  const pipe = { session, gateway: null, agentWs, deviceId, gatewayReady: false, queue: [] };
  // Register before any network await: the client may send ClientHello as
  // soon as its WebSocket opens, before /mgw/pair responds.
  pipes.set(bridgeId, pipe);
  if (frame.authMode === 'gateway') {
    // Wait for the phone's encrypted one-time pairing code or device token.
    // A paid relay lease is not a device credential. Never auto-pair here.
    pipe.requiresDeviceAuth = true;
    pipe.authTimer = setTimeout(() => {
      if (pipes.get(bridgeId) !== pipe || pipe.gatewayReady) return;
      handleClientClose({ bridgeId });
      if (agentWs.readyState === WebSocket.OPEN) agentWs.send(JSON.stringify({ kind: 'client-close', bridgeId }));
    }, 15000);
    return;
  }
  const creds = loadCreds();
  const token = creds[deviceId] || creds[GATEWAY];
  const headers = {
    'X-DSH-Channel': 'miniprogram',
    'X-DSH-Device-ID': deviceId
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  else {
    const pairingCode = await requestPairingCode(deviceId);
    if (!pairingCode) {
      pipes.delete(bridgeId);
      agentWs.send(JSON.stringify({ kind: 'client-close', bridgeId }));
      return;
    }
    protocols.push('dsh-pair.' + pairingCode);
  }
  // ws v8：子协议必须作为第二个位置参数，放 options.protocols 会被忽略
  const gateway = new WebSocket(GATEWAY, protocols.filter(Boolean), { headers });
  pipe.gateway = gateway;
  log(`管道 ${bridgeId}: 拨本地网关 ${GATEWAY}`);

  gateway.on('open', () => {
    pipe.gatewayReady = true;
    agentWs.send(JSON.stringify({ kind: 'client-ready', bridgeId }), { binary: false });
    log(`管道 ${bridgeId}: 本地网关已连接，协议=${gateway.protocol || '(默认)'}`);
    // 排队的已解密帧
    for (const text of pipe.queue) gateway.send(text);
    pipe.queue = [];
  });

  gateway.on('message', (data) => {
    const text = data.toString('utf8');
    captureToken(text, deviceId);
    captureDeviceIdentity(pipe, text);
    if (!session.ready) return;
    try {
      sendPipeFrame(agentWs, bridgeId, session.seal(text));
    } catch (e) {
      log(`管道 ${bridgeId}: 加密发送失败 ${e.message}`);
    }
  });

  gateway.on('close', (code, reason) => {
    log(`管道 ${bridgeId}: 本地网关关闭 ${code} ${reason.toString()}`);
    pipes.delete(bridgeId);
    if (agentWs.readyState === WebSocket.OPEN) {
      agentWs.send(JSON.stringify({ kind: 'client-close', bridgeId }), { binary: false });
    }
  });
  gateway.on('error', (err) => log(`管道 ${bridgeId}: 网关错误 ${err.message}`));

  // 等待 ClientHello：在中继 socket 的二进制消息里路由（见下方 handleRelayBinary）
  pipe.pendingHello = true;
}

function sendPipeFrame(agentWs, bridgeId, payload) {
  if (agentWs.readyState !== WebSocket.OPEN) return;
  agentWs.send(Buffer.concat([Buffer.from(bridgeId + '\n', 'ascii'), Buffer.from(payload)]), { binary: true });
}

function handleClientClose(frame) {
  const pipe = pipes.get(frame.bridgeId);
  if (pipe) clearTimeout(pipe.authTimer);
  if (pipe && pipe.gateway) {
    try { pipe.gateway.terminate(); } catch (e) { /* 忽略 */ }
  }
  pipes.delete(frame.bridgeId);
}

function authenticateGateway(pipe, bridgeId, frame) {
  if (pipe.authStarted || !frame || frame.type !== 'relay-auth') return;
  pipe.authStarted = true;
  const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,512}$/.test(value);
  if (!(valid(frame.token) !== valid(frame.pairingCode))) {
    sendPipeFrame(pipe.agentWs, bridgeId, pipe.session.seal(JSON.stringify({ kind: 'relay-auth-error', message: '设备配对凭据无效，请重新扫码' })));
    return;
  }
  const protocols = ['dsh-mobile-v1'];
  const headers = { 'X-DSH-Channel': 'miniprogram', 'X-DSH-Device-ID': pipe.deviceId };
  const deviceName = normalizeDeviceName(frame.deviceName);
  if (deviceName) {
    pipe.phoneDeviceName = deviceName;
    headers['X-DSH-Device-Name'] = Buffer.from(deviceName, 'utf8').toString('base64');
  }
  if (valid(frame.token)) headers.Authorization = 'Bearer ' + frame.token;
  else protocols.push('dsh-pair.' + frame.pairingCode);
  const gateway = pipe.gateway = new WebSocket(GATEWAY, protocols, { headers });
  const pending = []; let pendingBytes = 0;
  const rejectDevice = () => {
    if (pipes.get(bridgeId) !== pipe) return;
    sendPipeFrame(pipe.agentWs, bridgeId, pipe.session.seal(JSON.stringify({ kind: 'relay-auth-error', message: 'DSH 未确认设备认证，请重新扫码并检查网关认证设置' })));
    handleClientClose({ bridgeId });
  };
  gateway.on('open', () => {
    if (pipes.get(bridgeId) !== pipe) return gateway.terminate();
    // A local debug gateway may accept WS even with an invalid token. Wait for
    // its authenticated hello before exposing data or forwarding any commands.
  });
  gateway.on('message', data => {
    if (pipes.get(bridgeId) !== pipe) return;
    const text = data.toString('utf8');
    if (!pipe.gatewayReady) {
      let message; try { message = JSON.parse(text); } catch { return rejectDevice(); }
      if (message.kind !== 'hello') {
        // The gateway emits the new device token immediately before hello.
        // Hold it until the same connection confirms successful authentication.
        pendingBytes += data.length;
        if (message.kind !== 'paired' || pendingBytes > 65536) return rejectDevice();
        pending.push(text); return;
      }
      if (message.authenticated !== true) return rejectDevice();
      captureDeviceIdentity(pipe, text);
      pipe.gatewayReady = true; clearTimeout(pipe.authTimer);
      pipe.agentWs.send(JSON.stringify({ kind: 'client-ready', bridgeId }));
      for (const paired of pending) sendPipeFrame(pipe.agentWs, bridgeId, pipe.session.seal(paired));
      pending.length = 0;
    }
    sendPipeFrame(pipe.agentWs, bridgeId, pipe.session.seal(text));
  });
  gateway.on('close', () => {
    clearTimeout(pipe.authTimer); pipes.delete(bridgeId);
    if (pipe.agentWs.readyState === WebSocket.OPEN) pipe.agentWs.send(JSON.stringify({ kind: 'client-close', bridgeId }));
  });
  gateway.on('error', () => {
    if (pipe.agentWs.readyState === WebSocket.OPEN) sendPipeFrame(pipe.agentWs, bridgeId, pipe.session.seal(JSON.stringify({ kind: 'relay-auth-error', message: '设备配对失败，请在 DSH 重新生成二维码' })));
  });
}

// Relay binary envelopes carry a bridge id so multiple phones can share a node.
function handleRelayBinary(data) {
  const bytes = Buffer.from(data);
  const splitAt = bytes.indexOf(10);
  if (splitAt < 1 || splitAt > 64) return;
  const bridgeId = bytes.subarray(0, splitAt).toString('ascii');
  const packet = new Uint8Array(bytes.subarray(splitAt + 1));
  const pipe = pipes.get(bridgeId);
  if (!pipe) return;
  if (packet.length && packet[0] === PACKET_CLIENT_HELLO && !pipe.session.ready) {
    const hello = pipe.session.acceptClientHello(packet);
    if (hello) {
      sendPipeFrame(pipe.agentWs, bridgeId, hello);
      log(`管道 ${bridgeId}: E2EE 握手完成`);
    } else {
      log(`管道 ${bridgeId}: ClientHello 无效`);
    }
    return;
  }
  if (pipe.session.ready && packet[0] === PACKET_SEALED) {
    const text = pipe.session.open(packet);
    if (text === null) {
      log(`管道 ${bridgeId}: 密文解密失败，关闭管道`);
      try { pipe.gateway.close(4002, 'e2ee-decrypt-failed'); } catch (error) { /* ignore */ }
      pipes.delete(bridgeId);
      return;
    }
    let frame;
    try { frame = JSON.parse(text); } catch (error) { frame = null; }
    if (frame && frame.type === 'device-info') {
      // Compatibility with already-installed clients and legacy invite mode.
      // Cache early reports until the gateway confirms this pipe's identity.
      void updateDeviceName(pipe, frame.model);
      return;
    }
    if (pipe.requiresDeviceAuth) {
      if (!pipe.authStarted) { authenticateGateway(pipe, bridgeId, frame); return; }
      if (frame && frame.type === 'relay-auth') return;
      if (pipe.gatewayReady && pipe.gateway.readyState === WebSocket.OPEN) pipe.gateway.send(text);
      return;
    }
    if (frame && frame.type === 'relay-share-create') {
      pipe.agentWs.send(JSON.stringify({ kind: 'invite-create', bridgeId,
        requestId: frame.requestId, ttlMs: frame.ttlMs }));
      return;
    }
    if (frame && frame.type === 'relay-code-create') {
      pipe.agentWs.send(JSON.stringify({ kind: 'code-create', bridgeId,
        requestId: frame.requestId, accessTtlMs: frame.accessTtlMs,
        uses: frame.uses, codeTtlMs: frame.codeTtlMs }));
      return;
    }
    if (frame && frame.type === 'relay-code-redeem') {
      pipe.agentWs.send(JSON.stringify({ kind: 'code-redeem', bridgeId,
        requestId: frame.requestId, code: String(frame.code || '') }));
      return;
    }
    captureToken(text, pipe.deviceId);
    if (pipe.gatewayReady && pipe.gateway.readyState === WebSocket.OPEN) pipe.gateway.send(text);
    else pipe.queue.push(text);
  }
}

// ---------- 配对载荷 ----------

function pairingPayload(offer) {
  const payload = {
    version: 3,
    mode: 'relay',
    relay: RELAY.replace(/\/$/, ''),
    nodeId: identity.nodeId,
    agentPubKey: identity.signPublicKey,
    gatewayName: GATEWAY_NAME,
    gatewayUrl: GATEWAY,
    inviteToken: offer.inviteToken,
    expiresAt: offer.expiresAt,
    role: 'owner'
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

let printedAt = 0;
function printPairingPayload(offer) {
  if (!offer || !offer.inviteToken || !(Number(offer.expiresAt) > Date.now())) return;
  if (Date.now() - printedAt < 5000) return;
  printedAt = Date.now();
  console.log('\n===== 首次所有者配对信息（限时一次性使用）=====');
  console.log(pairingPayload(offer));
  console.log(`有效期至 ${new Date(offer.expiresAt).toLocaleString()}`);
  console.log('=============================================\n');
}

function log(message) {
  console.log(`[connector ${new Date().toISOString()}] ${message}`);
}

// ---------- 主流程 ----------

process.on('SIGINT', () => {
  relayWants = false;
  log('退出');
  process.exit(0);
});
process.on('SIGTERM', () => { relayWants = false; process.exit(0); });

connectRelay();
