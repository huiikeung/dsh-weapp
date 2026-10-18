// DSH Weapp Relay. Routes only authenticated, end-to-end encrypted client pipes.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const publicAccess = require('./public-access').createPublicAccessVerifier();

const PORT = Number(process.env.RELAY_PORT || 8787);
const HOST = process.env.RELAY_HOST || '127.0.0.1';
const AGENT_PING_MS = 25_000;
const AGENT_PONG_TIMEOUT_MS = 50_000;
const BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const MIN_INVITE_TTL_MS = 5 * 60 * 1000;
const MAX_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 兑换码：所有者签发的续期凭证
const MIN_CODE_ACCESS_MS = 60 * 60 * 1000;                 // 至少续 1 小时
const MAX_CODE_ACCESS_MS = 365 * 24 * 60 * 60 * 1000;      // 最多续 1 年
const MIN_CODE_TTL_MS = 10 * 60 * 1000;                    // 兑换码本身最短 10 分钟
const MAX_CODE_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CODE_USES = 500;
const CODE_LENGTH = 10;
// 去掉 0/O/1/I 等易混字符
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STATE_FILE = process.env.RELAY_STATE_FILE || path.join(__dirname, 'relay-state.json');

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return {
      invites: new Map((saved.invites || []).map((row) => [row.hash, row])),
      access: new Map((saved.access || []).map((row) => [row.hash, row])),
      owners: new Map(saved.owners || []),
      codes: new Map((saved.codes || []).map((row) => [row.hash, row]))
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[relay] state load failed:', error.message);
    return { invites: new Map(), access: new Map(), owners: new Map(), codes: new Map() };
  }
}

const authState = loadState();
const agents = new Map();
let saveTimer = null;

function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const temp = STATE_FILE + '.tmp';
    const data = JSON.stringify({
      invites: Array.from(authState.invites.entries()).map(([hash, value]) => ({ hash, ...value })),
      access: Array.from(authState.access.entries()).map(([hash, value]) => ({ hash, ...value })),
      owners: Array.from(authState.owners.entries()),
      codes: Array.from(authState.codes.entries()).map(([hash, value]) => ({ hash, ...value }))
    });
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(temp, data, { mode: 0o600 });
      fs.renameSync(temp, STATE_FILE);
    } catch (error) {
      console.error('[relay] state save failed:', error.message);
      try { fs.unlinkSync(temp); } catch (ignored) { /* best effort */ }
    }
  }, 50);
}

function log(message) {
  console.log(`[relay ${new Date().toISOString()}] ${message}`);
}

function token() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function issueInvite(nodeId, role, ttlMs) {
  const inviteToken = token();
  const expiresAt = Date.now() + ttlMs;
  authState.invites.set(tokenHash(inviteToken), { nodeId, role, expiresAt });
  saveState();
  return { inviteToken, expiresAt };
}

// Existing persisted invites are hashed. Keep the bootstrap token only in
// process memory and reissue after expiry; it is delivered only to the agent.
const bootstrapTokens = new Map();
function createBootstrapInvite(nodeId, state) {
  if (authState.owners.has(nodeId) || !state.socket || state.socket.readyState !== 1) return;
  const prior = bootstrapTokens.get(nodeId);
  if (prior && prior.expiresAt > Date.now()) {
    state.socket.send(JSON.stringify({ kind: 'pairing-offer', ...prior }));
    return;
  }
  const offer = issueInvite(nodeId, 'owner', BOOTSTRAP_TTL_MS);
  bootstrapTokens.set(nodeId, offer);
  state.socket.send(JSON.stringify({ kind: 'pairing-offer', ...offer }));
}

function randomCode(length) {
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i += 1) {
    // 拒绝采样，避免取模偏差
    const value = bytes[i];
    if (value >= 224) continue;
    out += CODE_ALPHABET[value % CODE_ALPHABET.length];
  }
  return out.length === length ? out : randomCode(length);
}

/** 生成一枚兑换码：redeem 后给当前访客增加 accessTtlMs 有效期 */
function issueCode(nodeId, accessTtlMs, uses, codeTtlMs) {
  const code = randomCode(CODE_LENGTH);
  const expiresAt = Date.now() + codeTtlMs;
  const record = {
    nodeId,
    accessTtlMs,
    uses,
    used: 0,
    expiresAt,
    createdAt: Date.now()
  };
  authState.codes.set(tokenHash(code), record);
  saveState();
  return { code, expiresAt, accessTtlMs, uses };
}

/** 兑换：扩展该访客访问凭证的有效期，返回新的到期时间 */
function redeemCode(nodeId, code, credentialHash, clientState) {
  const hash = tokenHash(code);
  const record = authState.codes.get(hash);
  if (!record || record.nodeId !== nodeId) return { ok: false, reason: 'invalid' };
  if (record.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  if (record.used >= record.uses) return { ok: false, reason: 'exhausted' };
  const credential = authState.access.get(credentialHash);
  if (!credential || credential.nodeId !== nodeId) return { ok: false, reason: 'no-credential' };
  const now = Date.now();
  const base = Math.max(Number(credential.expiresAt) || 0, now);
  const next = Math.min(base + record.accessTtlMs, now + MAX_CODE_ACCESS_MS * 2);
  credential.expiresAt = next;
  authState.access.set(credentialHash, credential);
  record.used += 1;
  if (record.used >= record.uses) authState.codes.delete(hash);
  else authState.codes.set(hash, record);
  if (clientState) {
    clientState.expiresAt = next;
    if (clientState.expiresTimer) clearTimeout(clientState.expiresTimer);
    clientState.expiresTimer = setTimeout(() => close(clientState.socket, 4003, 'access-expired'),
      Math.max(1, next - Date.now()));
  }
  saveState();
  return { ok: true, expiresAt: next, remainingUses: Math.max(0, record.uses - record.used) };
}

function cleanupExpired() {
  const now = Date.now();
  let changed = false;
  for (const [hash, invite] of authState.invites) {
    if (invite.expiresAt <= now) { authState.invites.delete(hash); changed = true; }
  }
  for (const [hash, credential] of authState.access) {
    if (credential.expiresAt && credential.expiresAt <= now) {
      authState.access.delete(hash);
      if (authState.owners.get(credential.nodeId) === hash) authState.owners.delete(credential.nodeId);
      changed = true;
    }
  }
  for (const [hash, record] of authState.codes) {
    if (record.expiresAt <= now || record.used >= record.uses) {
      authState.codes.delete(hash);
      changed = true;
    }
  }
  if (changed) saveState();
}

function parsePath(url) {
  const match = /^\/(a|c)\/([A-Za-z0-9_-]{8,128})$/.exec(url || '');
  return match ? { kind: match[1], nodeId: match[2] } : null;
}

function close(socket, code, reason) {
  try { socket.close(code, reason); } catch (error) { /* already closing */ }
}

function broadcastClientCount(state) {
  const count = Array.from(state.clients.values()).filter((client) => client.socket.readyState === 1).length;
  const frame = JSON.stringify({ kind: 'relay-client-count', count });
  for (const client of state.clients.values()) {
    if (client.socket.readyState === 1) client.socket.send(frame);
  }
}

function authenticateClient(nodeId, protocols) {
  cleanupExpired();
  const inviteProtocol = protocols.find((value) => value.startsWith('dsh-invite.'));
  const accessProtocol = protocols.find((value) => value.startsWith('dsh-access.'));
  if (inviteProtocol) {
    const rawToken = inviteProtocol.slice('dsh-invite.'.length);
    const hash = tokenHash(rawToken);
    const invite = authState.invites.get(hash);
    if (!invite || invite.nodeId !== nodeId || invite.expiresAt <= Date.now()) return null;
    authState.invites.delete(hash);
    const accessToken = token();
    const credential = {
      nodeId,
      role: invite.role,
      expiresAt: invite.role === 'owner' ? 0 : invite.expiresAt
    };
    const accessHash = tokenHash(accessToken);
    authState.access.set(accessHash, credential);
    if (invite.role === 'owner') authState.owners.set(nodeId, accessHash);
    saveState();
    return { ...credential, accessToken };
  }
  if (accessProtocol) {
    const accessToken = accessProtocol.slice('dsh-access.'.length);
    const credential = authState.access.get(tokenHash(accessToken));
    if (!credential || credential.nodeId !== nodeId ||
        (credential.expiresAt && credential.expiresAt <= Date.now())) return null;
    return { ...credential, accessToken };
  }
  return null;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dsh-weapp-relay\n');
    return;
  }
  res.writeHead(404);
  res.end('not-found');
});

const wss = new WebSocketServer({
  server,
  handleProtocols: (protocols) => {
    const first = protocols instanceof Set ? protocols.values().next().value : protocols[0];
    return first || false;
  }
});

wss.on('connection', async (socket, req) => {
  const route = parsePath(req.url);
  if (!route) return close(socket, 4000, 'bad-route');

  if (route.kind === 'a') {
    const existing = agents.get(route.nodeId);
    if (existing && existing.socket.readyState === 1) close(existing.socket, 4009, 'replaced');
    const state = { socket, clients: new Map(), pongTimer: null, gatewayAuth: req.headers['x-dsh-gateway-auth'] === '1' };
    agents.set(route.nodeId, state);
    log(`node ${route.nodeId}: agent registered`);
    createBootstrapInvite(route.nodeId, state);
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const splitAt = data.indexOf(10);
        if (splitAt < 1 || splitAt > 64) return;
        const bridgeId = data.subarray(0, splitAt).toString('ascii');
        const client = state.clients.get(bridgeId);
        if (client && client.socket.readyState === 1) {
          client.socket.send(data.subarray(splitAt + 1), { binary: true });
        }
        return;
      }
      let frame;
      try { frame = JSON.parse(data.toString('utf8')); } catch (error) { return; }
      if (frame.kind === 'invite-create') {
        const client = state.clients.get(frame.bridgeId);
        if (!client || client.role !== 'owner' || client.socket.readyState !== 1) return;
        const ttl = Number(frame.ttlMs);
        if (!Number.isFinite(ttl) || ttl < MIN_INVITE_TTL_MS || ttl > MAX_INVITE_TTL_MS) {
          socket.send(JSON.stringify({ kind: 'invite-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '邀请有效期必须在 5 分钟到 7 天之间' }));
          return;
        }
        const invite = issueInvite(route.nodeId, 'guest', ttl);
        socket.send(JSON.stringify({ kind: 'invite-created', bridgeId: frame.bridgeId,
          requestId: frame.requestId, ...invite }));
        log(`node ${route.nodeId}: guest invite created, expires=${invite.expiresAt}`);
        return;
      }
      if (frame.kind === 'code-create') {
        const client = state.clients.get(frame.bridgeId);
        if (!client || client.role !== 'owner' || client.socket.readyState !== 1) {
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '只有所有者可以生成兑换码' }));
          return;
        }
        const accessTtlMs = Number(frame.accessTtlMs);
        const uses = Number(frame.uses);
        const codeTtlMs = Number(frame.codeTtlMs) || 30 * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(accessTtlMs) || accessTtlMs < MIN_CODE_ACCESS_MS || accessTtlMs > MAX_CODE_ACCESS_MS) {
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '续期时长需在 1 小时到 1 年之间' }));
          return;
        }
        if (!Number.isFinite(uses) || uses < 1 || uses > MAX_CODE_USES) {
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '兑换次数需在 1 到 ' + MAX_CODE_USES + ' 次之间' }));
          return;
        }
        if (codeTtlMs < MIN_CODE_TTL_MS || codeTtlMs > MAX_CODE_TTL_MS) {
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '兑换码有效期不合法' }));
          return;
        }
        const issued = issueCode(route.nodeId, accessTtlMs, uses, codeTtlMs);
        socket.send(JSON.stringify({ kind: 'code-created', bridgeId: frame.bridgeId,
          requestId: frame.requestId, ...issued }));
        log(`node ${route.nodeId}: redeem code issued, access=${accessTtlMs}ms uses=${uses}`);
        return;
      }
      if (frame.kind === 'code-redeem') {
        const client = state.clients.get(frame.bridgeId);
        if (!client || client.socket.readyState !== 1) {
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '连接已失效，请重连后再兑换' }));
          return;
        }
        if (client.role === 'owner') {
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: '所有者账号无需兑换' }));
          return;
        }
        const result = redeemCode(route.nodeId, String(frame.code || '').trim().toUpperCase(),
          client.credentialHash, client);
        if (!result.ok) {
          const messages = {
            invalid: '兑换码无效',
            expired: '兑换码已过期',
            exhausted: '兑换码已被用完',
            'no-credential': '当前访问凭证不可续期，请重新配对'
          };
          socket.send(JSON.stringify({ kind: 'code-error', bridgeId: frame.bridgeId,
            requestId: frame.requestId, message: messages[result.reason] || '兑换失败' }));
          return;
        }
        socket.send(JSON.stringify({ kind: 'code-redeemed', bridgeId: frame.bridgeId,
          requestId: frame.requestId, expiresAt: result.expiresAt, remainingUses: result.remainingUses }));
        log(`node ${route.nodeId}: code redeemed, expires=${new Date(result.expiresAt).toISOString()}`);
        return;
      }
      if (frame.kind === 'client-ready' && frame.bridgeId) {
        const client = state.clients.get(frame.bridgeId);
        if (client && client.socket.readyState === 1) client.ready = true;
      }
      if (frame.kind === 'client-close' && frame.bridgeId) {
        const client = state.clients.get(frame.bridgeId);
        if (client) close(client.socket, 4001, 'gateway-closed');
        state.clients.delete(frame.bridgeId);
      }
    });

    socket.on('close', () => {
      log(`node ${route.nodeId}: agent disconnected`);
      if (agents.get(route.nodeId) === state) agents.delete(route.nodeId);
      for (const client of state.clients.values()) close(client.socket, 4001, 'agent-offline');
      state.clients.clear();
      if (state.pongTimer) clearInterval(state.pongTimer);
    });
    socket.on('error', () => {});

    state.pongTimer = setInterval(() => {
      if (socket.readyState !== 1) { clearInterval(state.pongTimer); return; }
      if (!socket.isAlive) { socket.terminate(); return; }
      socket.isAlive = false;
      socket.ping();
      createBootstrapInvite(route.nodeId, state);
    }, AGENT_PING_MS);
    return;
  }

  const agent = agents.get(route.nodeId);
  if (!agent || agent.socket.readyState !== 1) return close(socket, 4001, 'agent-offline');

  const requestedProtocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const deviceId = String(req.headers['x-dsh-device-id'] || '').slice(0, 128);
  const leaseProtocol = requestedProtocols.find(value => value.startsWith('dsh-public.'));
  const leaseToken = leaseProtocol ? leaseProtocol.slice('dsh-public.'.length) : '';
  // ClientHello can arrive while the HTTP authorization check is in flight.
  // Keep a bounded buffer; nothing is forwarded before service authorization.
  const early = []; let earlyBytes = 0;
  const buffer = (data, binary) => { earlyBytes += data.length; if (earlyBytes > 65536) socket.terminate(); else early.push([data, binary]); };
  socket.on('error', () => {});
  socket.on('message', buffer);
  let serviceGrant;
  try { serviceGrant = await publicAccess.verify(leaseToken, route.nodeId, deviceId); }
  catch (error) { socket.removeListener('message', buffer); return close(socket, 4003, ['public-lease-expired', 'public-access-expired', 'public-access-required'].includes(error.message) ? error.message : 'public-access-unavailable'); }
  if (socket.readyState !== 1 || agents.get(route.nodeId) !== agent) { socket.removeListener('message', buffer); return close(socket, 4001, 'agent-offline'); }
  const gatewayAuth = requestedProtocols.includes('dsh-gateway-auth');
  // Older connectors auto-pair any accepted pipe. They must never accept a
  // service-only lease as permission to access the user's DSH.
  if (gatewayAuth && !agent.gatewayAuth) { socket.removeListener('message', buffer); return close(socket, 4004, 'gateway-auth-upgrade-required'); }
  // A service lease buys transport, NEVER access to a DSH device. In gateway
  // mode that second check is performed inside E2EE by the user's plugin.
  const authorization = gatewayAuth && serviceGrant ? { role: 'gateway', expiresAt: 0 } : authenticateClient(route.nodeId, requestedProtocols);
  if (!authorization) { socket.removeListener('message', buffer); return close(socket, 4003, 'invite-required'); }

  const publicProtocols = requestedProtocols.filter((value) =>
    !value.startsWith('dsh-invite.') && !value.startsWith('dsh-access.') && !value.startsWith('dsh-public.') && value !== 'dsh-gateway-auth'
  );
  const bridgeId = crypto.randomUUID();
  const clientState = {
    socket,
    credentialHash: tokenHash(authorization.accessToken || ''),
    role: authorization.role,
    expiresAt: authorization.expiresAt,
    deviceId,
    ready: false
  };
  agent.clients.set(bridgeId, clientState);

  if (publicProtocols.length && typeof socket.handleSubprotocol === 'function') {
    socket.handleSubprotocol(publicProtocols[0]);
  } else if (publicProtocols.length) {
    try { socket.setSubprotocol?.(publicProtocols[0]); } catch (error) { /* optional */ }
  }

  // This authorization frame contains only a relay credential, never DSH data.
  socket.send(JSON.stringify({ kind: 'relay-authorized', accessToken: authorization.accessToken,
    role: authorization.role, expiresAt: authorization.expiresAt || null,
    clientCount: agent.clients.size }));
  agent.socket.send(JSON.stringify({ kind: 'client-open', bridgeId,
    protocols: publicProtocols, deviceId: clientState.deviceId, ...(gatewayAuth ? { authMode: 'gateway' } : {}) }));
  broadcastClientCount(agent);

  if (clientState.expiresAt) {
    clientState.expiresTimer = setTimeout(() => close(socket, 4003, 'access-expired'),
      Math.max(1, clientState.expiresAt - Date.now()));
  }

  let checking = false, accessTimer;
  if (serviceGrant) {
    // Recheck live permissions (including removed admin roles). On service
    // failure, fail closed; do not silently turn this into a free relay.
    accessTimer = setInterval(async () => {
      if (checking || socket.readyState !== 1) return;
      checking = true;
      try { serviceGrant = await publicAccess.verify(leaseToken, route.nodeId, deviceId); }
      catch (error) { close(socket, 4003, error.message === 'public-lease-expired' ? error.message : 'public-access-expired'); }
      finally { checking = false; }
    }, 30000);
    const expire = () => {
      if (socket.readyState !== 1) return;
      if (serviceGrant.expiresAt <= Date.now()) return close(socket, 4003, 'public-lease-expired');
      clientState.publicExpiryTimer = setTimeout(expire, Math.min(serviceGrant.expiresAt - Date.now(), 2147483647));
    };
    expire();
  }
  const forward = (data, isBinary) => {
    if (serviceGrant && serviceGrant.expiresAt <= Date.now()) return close(socket, 4003, 'public-lease-expired');
    if (!isBinary || agent.socket.readyState !== 1) return;
    agent.socket.send(Buffer.concat([Buffer.from(bridgeId + '\n', 'ascii'), Buffer.from(data)]), { binary: true });
  };
  socket.removeListener('message', buffer);
  socket.on('message', forward);
  for (const [data, binary] of early) forward(data, binary);
  socket.on('close', () => {
    clearInterval(accessTimer);
    clearTimeout(clientState.publicExpiryTimer);
    if (clientState.expiresTimer) clearTimeout(clientState.expiresTimer);
    agent.clients.delete(bridgeId);
    if (agent.socket.readyState === 1) agent.socket.send(JSON.stringify({ kind: 'client-close', bridgeId }));
    broadcastClientCount(agent);
  });
  socket.on('error', () => {});
  log(`node ${route.nodeId}: ${authorization.role} client connected (${bridgeId})`);
});

server.listen(PORT, HOST, () => log(`listening on ${HOST}:${PORT}`));
