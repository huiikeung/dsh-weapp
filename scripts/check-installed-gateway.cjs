'use strict';
// Local, read-only business smoke test. Its temporary paired device is revoked
// in finally; no credentials, session bodies or configuration values are logged.
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');

async function check({ gateway, management, publicEndpoint = false }) {
  if (!path.isAbsolute(gateway || '')) throw new Error('Absolute --gateway directory required');
  const base = new URL(management);
  if (base.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('--management must be a loopback HTTP origin');
  }
  const WebSocket = createRequire(path.join(gateway, 'package.json'))('ws');
  const report = {};
  let socket, client, deviceId, pairingId;
  const previousWx = global.wx;
  const pending = new Set();
  async function http(route, body) {
    const response = await fetch(new URL(route, base), {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(10000),
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    if (!response.ok) throw new Error(route + ': HTTP ' + response.status);
    return response.json();
  }
  function wait(match) {
    return new Promise((resolve, reject) => {
      const item = { match, resolve(value) { clearTimeout(item.timer); pending.delete(item); resolve(value); },
        reject(error) { clearTimeout(item.timer); pending.delete(item); reject(error); } };
      item.timer = setTimeout(() => item.reject(new Error('Gateway response timeout')), 15000);
      pending.add(item);
    });
  }
  async function query(type, extra = {}) {
    const requestId = randomUUID();
    const response = wait(frame => frame.requestId === requestId || frame.kind === type
      || (frame.kind === 'error' && (frame.requestType === type || frame.message === 'unknown message type: ' + type)));
    if (!client.send({ type, requestId, ...extra })) throw new Error('Mini-program client send failed');
    const frame = await response;
    if (frame.kind === 'error') throw new Error(type + ': ' + (frame.code || 'unsupported/error'));
    return frame;
  }
  try {
    const status = await http('/mgw/status');
    assert.equal(status.requireAuth, true, 'Gateway authentication must remain enabled');
    assert.equal(status.gatewayEnabled, true, 'Gateway is disabled');
    report.gatewayVersion = status.version;
    report.pairingMode = status.pairingMode || 'direct';
    report.relayConnectorRunning = !!status.relayConnector?.running;
    const directUrl = publicEndpoint ? status.cloudflare?.publicUrl || status.publicUrl : null;
    if (publicEndpoint && (!directUrl || new URL(directUrl).protocol !== 'wss:')) {
      throw new Error('No configured secure public endpoint; nothing changed');
    }
    const pair = await http('/mgw/pair', {});
    pairingId = pair.pairing?.id;
    const url = directUrl ? new URL(directUrl) : new URL(status.wsPath || '/ws/mobile', base);
    if (!directUrl) url.protocol = 'ws:';
    report.transport = directUrl ? 'public-wss' : 'loopback-ws';
    const storage = new Map([['dsh_device_id', 'gateway-check-' + randomUUID()]]);
    global.wx = {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      getSystemInfoSync: () => ({ language: 'zh', brand: 'Gateway', model: 'compatibility check' }),
      connectSocket(options) {
        socket = new WebSocket(options.url, options.protocols, { headers: options.header });
        return {
          onOpen: callback => socket.on('open', callback),
          onMessage: callback => socket.on('message', (data, binary) => callback({
            data: binary ? Uint8Array.from(data).buffer : data.toString()
          })),
          onError: callback => socket.on('error', () => callback({ errMsg: 'WebSocket failed' })),
          onClose: callback => socket.on('close', (code, reason) => callback({ code, reason: reason.toString() })),
          send({ data, success, fail }) { socket.send(data, error => error ? fail?.({ errMsg: 'Send failed' }) : success?.()); },
          close() { socket.terminate(); }
        };
      }
    };
    const { GatewayClient } = require('../miniprogram/utils/gateway');
    const paired = wait(frame => frame.kind === 'paired');
    client = new GatewayClient({
      onFrame(frame) {
        if (frame.kind === 'paired') deviceId = frame.device?.id || frame.deviceId;
        for (const item of [...pending]) if (item.match(frame)) item.resolve(frame);
      },
      onState(state) {
        if (state === 'failed') for (const item of [...pending]) item.reject(new Error('Mini-program connection failed'));
      }
    });
    client.connect(url.href, { pairingCode: pair.payload.pairingCode });
    const identity = await paired;
    deviceId = deviceId || identity.device?.id || identity.deviceId || pairingId;
    assert.equal(identity.device?.name, 'Gateway compatibility check', 'Gateway must persist the mini-program device name');
    report.deviceNameReported = true;
    report.paired = true;
    report.client = 'miniprogram/utils/gateway.js (Node transport shim)';
    const workspaces = await query('workspaces');
    report.workspaces = workspaces.items?.length ?? workspaces.workspaces?.length ?? 0;
    const sessions = await query('sessions');
    const items = sessions.items || sessions.sessions || [];
    report.sessions = items.length;
    report.runningSessions = items.filter(item => item.running === true).length;
    const chosen = items.find(item => item.title === '测试') || items[0];
    if (chosen) {
      const sessionId = chosen.sessionId || chosen.id;
      const history = await query('history', { sessionId, maxMessages: 4, view: 'conversation' });
      const recent = Array.isArray(history.events) ? history.events : [];
      const recentSeqs = recent.map(event => event.seq).filter(Number.isSafeInteger);
      assert.ok(recent.length > 0, 'The selected non-empty session must return recent history');
      assert.ok(recentSeqs.length > 0, 'The history tail must include sequence numbers');
      assert.deepEqual(recentSeqs, [...recentSeqs].sort((a, b) => a - b),
        'The history tail must be ordered from oldest to newest');
      assert.equal(history.historyFormatVersion, 4, 'History cursors require Session V4');

      // Re-read the tail and request a page immediately before it. This exercises
      // the exact versioned cursor path used by upward scrolling without logging
      // session titles or message bodies.
      const refreshed = await query('history', { sessionId, maxMessages: 4, view: 'conversation' });
      const refreshedSeqs = (refreshed.events || []).map(event => event.seq).filter(Number.isSafeInteger);
      assert.ok(refreshedSeqs.length > 0, 'A refreshed tail must still contain recent events');
      assert.ok(Math.max(...refreshedSeqs) >= Math.max(...recentSeqs),
        'A refreshed history tail must not move behind the first tail');
      const beforeSeq = recentSeqs[0];
      const older = await query('history', { sessionId, beforeSeq, historyFormatVersion: 4,
        maxMessages: 4, maxBytes: 256 * 1024, view: 'conversation' });
      assert.equal(older.beforeSeq, beforeSeq, 'Even an empty history page must echo its cursor');
      const olderSeqs = (older.events || []).map(event => event.seq).filter(Number.isSafeInteger);
      assert.ok(olderSeqs.every(seq => seq < beforeSeq), 'A history page must contain only events before its cursor');
      const latestSeq = Math.max(...recentSeqs);
      const snapshotReply = wait(frame => frame.kind === 'session-snapshot' && frame.sessionId === sessionId);
      assert.ok(client.subscribe(sessionId, latestSeq), 'The client must send a cursor-based session subscription');
      const snapshot = await snapshotReply;
      assert.equal(snapshot.resumeFromSeq, latestSeq, 'The gateway must acknowledge the requested resume cursor');
      assert.ok(Number.isSafeInteger(snapshot.resumeToSeq) && snapshot.resumeToSeq >= latestSeq,
        'The gateway must calibrate resumption against a current host cursor');
      assert.ok(['replayed', 'snapshot', 'invalid'].includes(snapshot.recovery),
        'The gateway must identify whether resume used replay or snapshot recovery');
      report.resume = { recovery: snapshot.recovery, fromSeq: snapshot.resumeFromSeq, toSeq: snapshot.resumeToSeq };
      report.history = { events: recent.length, latestSeq,
        olderPageEvents: olderSeqs.length, cursorEchoed: true, format: history.historyFormatVersion };
    }
    const host = await query('host');
    report.hostVersion = host.version || host.dshVersion;
    await query('models'); report.models = true;
    const catalog = await query('plugin-catalog');
    report.plugins = catalog.bundles?.length ?? 0;
    const settings = await query('plugin-settings');
    report.settings = Array.isArray(settings.namespaces);
    const indexes = await client.requestPlugin('plugin-market-indexes', {}, 15000);
    report.marketIndexes = Array.isArray(indexes.result);
    const translation = await client.requestPlugin('plugin-translation-limits', {}, 15000);
    report.translationLimits = translation.result !== undefined;
    const search = (settings.namespaces || []).find(item => ['web-search-deepseek', 'web-deepseek-api'].includes(item.ns));
    if (search) {
      const credential = await client.requestPlugin('plugin-credential-describe', { ref: search.value?.apiKeyEnv || 'DEEPSEEK_API_KEY' }, 15000);
      assert.equal(typeof credential.result?.configured, 'boolean');
      assert.deepEqual(Object.keys(credential.result).sort(), ['configured', 'writable']);
      report.credentialMetadataOnly = true;
    }
    // The context dashboard is an optional gateway bridge: an old/unpatched
    // gateway answers unknown-command, so the probe is advisory only.
    if (chosen) {
      try {
        const dashboard = await query('context-dashboard', { sessionId: chosen.sessionId || chosen.id });
        report.contextDashboard = dashboard.value !== undefined && dashboard.value.v === 1;
      } catch (_) {
        report.contextDashboard = false;
      }
    }
    return report;
  } catch (error) {
    error.report = report;
    throw error;
  } finally {
    if (client) client.disconnect();
    if (socket) socket.terminate();
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
    for (const item of [...pending]) item.reject(new Error('Gateway check closed'));
    if (deviceId || pairingId) {
      const result = await http('/mgw/devices/' + encodeURIComponent(deviceId || pairingId) + '/revoke', {});
      assert.equal(result.revoked, true, 'Temporary probe credential must be revoked');
      report.temporaryDeviceRevoked = true;
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  check({ gateway: option('--gateway'), management: option('--management'), publicEndpoint: args.includes('--public') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(JSON.stringify({ error: error.message, completed: error.report }, null, 2)); process.exitCode = 1; });
}
module.exports = { check };
