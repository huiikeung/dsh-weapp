'use strict';
// 在 DSH 所在电脑运行：只访问本机网关，并通过 HTTPS 出站访问管理台。
const fs = require('node:fs');
const { validDays } = require('./durations.cjs');
const reportOffsets = new Map();
function validateConfig(config) {
  const server = new URL(config.server), gateway = new URL(config.gateway);
  const local = server.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname);
  if ((!local && server.protocol !== 'https:') || server.origin !== config.server || server.username || server.password) throw new Error('server must be an HTTPS origin');
  if (gateway.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(gateway.hostname) || gateway.username || gateway.password || gateway.pathname !== '/' || gateway.search || gateway.hash) throw new Error('gateway must be an HTTP loopback origin');
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.token || '')) throw new Error('Invalid connector token');
  return { server: server.origin, gateway: gateway.origin, token: config.token };
}
async function jsonRequest(url, options = {}) {
  const res = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.code || 'HTTP_' + res.status);
  return data;
}
async function tick(config, request = jsonRequest) {
  let status;
  try {
    const raw = await request(config.gateway + '/mgw/status');
    status = { gatewayEnabled: raw.gatewayEnabled, pairingMode: raw.pairingMode, connectedClients: raw.connectedClients, managedPairingVersion: raw.managedPairingVersion === 1 ? 1 : 0,
      relay: raw.relay && { nodeId: raw.relay.nodeId, relay: raw.relay.relay, agentPubKey: raw.relay.agentPubKey } };
  } catch { status = { gatewayEnabled: false, pairingMode: 'offline' }; }
  const post = (route, data) => request(config.server + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token }, body: JSON.stringify(data) });
  let pairings = [];
  if (status.managedPairingVersion === 1) {
    const report = await request(config.gateway + '/mgw/managed-pairings');
    const items = Array.isArray(report.items) ? report.items : [];
    const offset = (reportOffsets.get(config.gateway) || 0) < items.length ? reportOffsets.get(config.gateway) || 0 : 0;
    pairings = items.slice(offset, offset + 30).map(r => ({ id: r.id, status: r.status, days: r.days, expiresAt: r.expiresAt, accessExpiresAt: r.accessExpiresAt, deviceId: r.deviceId || null }));
    reportOffsets.set(config.gateway, offset + 30);
  }
  const result = await post('/connector/poll', { status, pairings });
  for (const id of Array.isArray(result.revocations) ? result.revocations.slice(0, 10) : []) {
    if (status.managedPairingVersion !== 1 || !/^[a-f0-9-]{36}$/.test(id)) continue;
    await request(config.gateway + '/mgw/managed-pairings/' + id + '/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.gateway }, body: '{}' });
  }
  if (!result.task) return;
  if (result.task.type !== 'create-pairing' || !/^[a-f0-9-]{36}$/.test(result.task.id || '')) throw new Error('INVALID_TASK');
  let reply;
  try {
    if (!status.gatewayEnabled || status.pairingMode !== 'relay') throw new Error('GATEWAY_NOT_READY');
    const policy = result.task.managedAccess;
    if (policy && (status.managedPairingVersion !== 1 || policy.id !== result.task.id || !validDays(policy.days))) throw new Error('INVALID_ACCESS_POLICY');
    const pair = await request(config.gateway + '/mgw/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.gateway }, body: JSON.stringify(policy ? { managedAccess: { id: policy.id, days: policy.days } } : {}) });
    reply = { id: result.task.id, ok: true, qrPayload: pair.qrPayload };
  } catch { reply = { id: result.task.id, ok: false }; }
  await post('/connector/result', reply);
}
if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node connector.cjs /absolute/path/connector.json');
  const config = validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
  (async () => {
    console.log('DSH pairing connector started; credentials and pairing contents are never logged');
    let wasFailed = false;
    while (!stopping) {
      try { await tick(config); if (wasFailed) console.log('Connector recovered'); wasFailed = false; }
      catch { if (!wasFailed) console.error('Connector unavailable: check server URL, token, and local DSH port'); wasFailed = true; }
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  })().catch(() => { console.error('Connector stopped'); process.exitCode = 1; });
}
module.exports = { validateConfig, tick };
