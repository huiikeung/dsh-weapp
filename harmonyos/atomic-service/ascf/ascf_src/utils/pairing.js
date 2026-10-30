const { t: uiText } = require('./ui-preferences');
// Parse shared v2/v3 pairing payloads for the ASCF runtime.
// ASCF merges usable WSS routes, including but not limited to miniProgramRoute;
// it never trusts that field to replace other available direct routes.
// v3 relay payloads retain their expiry, pairing/invite credential, and key checks.

const { decodeBase64URL } = require('./util')
const routeTable = require('./route-table');

// 主机平台/设备类型是可选的附加字段：新版中继连接器会带 hostPlatform，
// 网关插件后续也可以直接带 deviceKind；老载荷没有这些字段也能正常配对。
function deviceFields(payload) {
  const kind = payload && (payload.deviceKind === 'server.rack' || payload.deviceKind === 'desktopcomputer')
    ? payload.deviceKind : null;
  const platform = payload && typeof payload.hostPlatform === 'string'
    ? payload.hostPlatform.trim().slice(0, 32) || null : null;
  return { deviceKind: kind, hostPlatform: platform };
}

const PairingError = {
  INVALID_BASE64: uiText('配对内容不是有效的 Base64URL 字符串。'),
  INVALID_JSON: uiText('Base64URL 解码后的内容不是有效的鲸尾 Harness 配对 JSON。'),
  UNSUPPORTED_VERSION: uiText('不支持的配对协议版本，当前客户端需要 version 2 或 3。'),
  INVALID_ENDPOINT: uiText('二维码中没有可用的 WSS 直连或中继地址。'),
  INVALID_RELAY: uiText('二维码中的中继地址或节点信息无效。'),
  MISSING_RELAY_AUTH: uiText('配对信息缺少有效的一次性凭据，请在 DSH 插件中重新生成二维码。'),
  INVALID_CODE: uiText('二维码中的一次性 pairingCode 无效。'),
  EXPIRED: uiText('二维码配对码已经过期，请重新生成。')
};

function parse(rawValue, nowMs) {
  const trimmed = String(rawValue || '').trim();
  const jsonText = decodeBase64URL(trimmed);
  if (jsonText === null) return failure(PairingError.INVALID_BASE64);

  let payload;
  try {
    payload = JSON.parse(jsonText);
  } catch (e) {
    return failure(PairingError.INVALID_JSON);
  }

  const now = nowMs || Date.now();
  if (payload && payload.version === 3 && payload.mode === 'relay') {
    return parseRelayPayload(payload, now);
  }
  if (!payload || payload.version !== 2) return failure(PairingError.UNSUPPORTED_VERSION);
  return parseV2Payload(payload, now);
}

function mergeRouteTables(tables) {
  const result = { lan: [], public: [], relay: null };
  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i] || {};
    for (const family of ['public', 'lan']) {
      const list = Array.isArray(table[family]) ? table[family] : [];
      for (let j = 0; j < list.length; j += 1) {
        if (result.lan.length + result.public.length >= routeTable.MAX_ENDPOINTS) break;
        const endpoint = routeTable.normalizeASCFEndpoint(list[j]);
        if (!endpoint) continue;
        const kind = routeTable.classifyEndpoint(endpoint);
        const target = kind === 'lan' ? result.lan : result.public;
        if (kind && target.indexOf(endpoint) < 0) target.push(endpoint);
      }
    }
    if (!result.relay && table.relay) result.relay = routeTable.normalizeRelay(table.relay);
  }
  return result;
}

function parseV2Payload(payload, now) {
  const code = String(payload.pairingCode || '');
  if (!code || code.indexOf(',') >= 0 || /\s/.test(code) || /[\x00-\x1f\x7f]/.test(code)) {
    return failure(PairingError.INVALID_CODE);
  }
  const expiresAt = Number(payload.expiresAt || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return failure(PairingError.EXPIRED);

  const tables = [
    routeTable.parseRouteTable({ routes: payload.routes }),
    routeTable.parseRouteTable({ publicUrl: payload.publicUrl, endpoints: payload.endpoints })
  ];
  let invalidOptionalRoute = false;
  const hasMiniProgramRoute = Object.prototype.hasOwnProperty.call(payload, 'miniProgramRoute');
  const miniRoute = payload.miniProgramRoute;
  if (hasMiniProgramRoute) {
    if (!miniRoute || typeof miniRoute !== 'object' || Array.isArray(miniRoute)) {
      invalidOptionalRoute = true;
    } else if (miniRoute.mode === 'direct') {
      tables.push(routeTable.parseRouteTable({ routes: miniRoute.routes }));
      tables.push(routeTable.parseRouteTable({ publicUrl: miniRoute.publicUrl, endpoints: miniRoute.endpoints }));
    } else if (miniRoute.mode === 'relay') {
      const relayResult = parseRelayPayload({
        ...miniRoute,
        version: 3,
        pairingCode: code,
        expiresAt: expiresAt,
        gatewayName: miniRoute.gatewayName || payload.gatewayName,
        gatewayId: payload.gatewayId
      }, now);
      if (relayResult.ok) tables.push(relayResult.payload.routeTable);
      else invalidOptionalRoute = true;
    } else {
      invalidOptionalRoute = true;
    }
  }

  const table = mergeRouteTables(tables);
  const candidates = routeTable.orderCandidates(table, { client: 'ascf' });
  if (!candidates.length) {
    return failure(invalidOptionalRoute ? PairingError.INVALID_RELAY : PairingError.INVALID_ENDPOINT);
  }

  const endpoints = candidates.map(candidate => candidate.endpoint);
  const relayOnly = candidates.length === 1 && candidates[0].kind === 'relay' ? table.relay : null;
  if (relayOnly) {
    return {
      ok: true,
      payload: {
        version: 2,
        mode: 'relay',
        relay: relayOnly.relay,
        nodeId: relayOnly.nodeId,
        agentPubKey: relayOnly.agentPubKey,
        inviteToken: relayOnly.inviteToken,
        authMode: relayOnly.authMode,
        role: relayOnly.role,
        accessExpiresAt: relayOnly.accessExpiresAt,
        publicUrl: relayOnly.endpoint,
        pairingCode: code,
        expiresAt: expiresAt,
        gatewayId: payload.gatewayId || relayOnly.nodeId,
        gatewayName: payload.gatewayName || relayOnly.gatewayName,
        endpoints: endpoints,
        routeTable: table,
        ...deviceFields(payload)
      }
    };
  }

  return {
    ok: true,
    payload: {
      version: 2,
      publicUrl: endpoints[0],
      pairingCode: code,
      expiresAt: expiresAt,
      gatewayId: payload.gatewayId || null,
      gatewayName: payload.gatewayName || null,
      endpoints: endpoints,
      routeTable: table,
      ...deviceFields(payload)
    }
  };
}

function parseRelayPayload(payload, now) {
  const normalized = routeTable.normalizeRelay(payload);
  if (!normalized) return failure(PairingError.INVALID_RELAY);
  const relay = normalized.relay;
  const nodeId = normalized.nodeId;
  const agentPubKey = normalized.agentPubKey;
  const inviteToken = String(payload.inviteToken || '').trim();
  const pairingCode = String(payload.pairingCode || '').trim();
  const expiresAt = Number(payload.expiresAt || 0);
  // 两种 v3 凭据不能混用：新版 relay 邀请，或插件 0.8.x 网关配对码。
  // 网关配对码只在 E2EE 验签之后传递，不能交给中继自动授权。
  if (inviteToken ? !/^[A-Za-z0-9_-]{32,128}$/.test(inviteToken)
    : !/^[A-Za-z0-9_-]{16,128}$/.test(pairingCode)) {
    return failure(PairingError.MISSING_RELAY_AUTH);
  }
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return failure(PairingError.EXPIRED);
  const endpoint = relay.replace(/\/$/, '') + '/c/' + nodeId;
  return {
    ok: true,
    payload: {
      version: 3,
      mode: 'relay',
      publicUrl: endpoint,
      relay: relay,
      nodeId: nodeId,
      agentPubKey: agentPubKey,
      inviteToken: inviteToken || null,
      authMode: inviteToken ? 'invite' : 'gateway',
      role: payload.role === 'owner' ? 'owner' : 'guest',
      pairingCode: inviteToken ? null : pairingCode,
      expiresAt: expiresAt,
      gatewayId: nodeId,
      accessExpiresAt: Number.isSafeInteger(payload.accessExpiresAt) && payload.accessExpiresAt > now ? payload.accessExpiresAt : null,
      accessDays: [3, 7, 30, 180, 365].includes(payload.accessDays) ? payload.accessDays : null,
      gatewayName: payload.gatewayName || null,
      endpoints: [endpoint],
      // v3 中继载荷只有公网一条线路：小程序与 App 都只连中继地址。
      routeTable: { lan: [], public: [], relay: routeTable.normalizeRelay(payload) },
      ...deviceFields(payload)
    }
  };
}

function failure(message) {
  return { ok: false, error: message };
}

module.exports = { parse, PairingError };
