const { t: uiText } = require('./ui-preferences');
// 配对载荷解析：兼容两种格式。
// v2（直连，与 iOS PairingPayloadParser 对齐）：WebUI 生成的二维码是 Base64URL(JSON)：
//   { version, publicUrl, pairingCode, expiresAt, gatewayId?, gatewayName?, endpoints? }
// v3（公网中继 + E2EE，由 relay/agent-connector.js 生成）：
//   { version:3, mode:'relay', relay, nodeId, agentPubKey, inviteToken, expiresAt }
//   公网模式只连接 relay + '/c/' + nodeId，不回落到局域网地址。

const { decodeBase64URL } = require('./util');

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
  INVALID_ENDPOINT: uiText('二维码中的 publicUrl 不是有效的 WebSocket 地址。'),
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

  // ---- v3：公网中继 + E2EE ----
  if (payload && payload.version === 3 && payload.mode === 'relay') {
    return parseRelayPayload(payload, nowMs || Date.now());
  }

  if (!payload || payload.version !== 2) return failure(PairingError.UNSUPPORTED_VERSION);

  const endpoint = String(payload.publicUrl || '');
  const scheme = endpoint.split('://')[0].toLowerCase();
  const rest = endpoint.split('://')[1] || '';
  if ((scheme !== 'ws' && scheme !== 'wss') || !rest.split('/')[0]) {
    return failure(PairingError.INVALID_ENDPOINT);
  }

  const code = String(payload.pairingCode || '');
  if (!code || code.indexOf(',') >= 0 || /\s/.test(code) || /[\x00-\x1f\x7f]/.test(code)) {
    return failure(PairingError.INVALID_CODE);
  }

  const now = nowMs || Date.now();
  const expiresAt = Number(payload.expiresAt || 0);
  if (!(expiresAt > now)) return failure(PairingError.EXPIRED);

  return {
    ok: true,
    payload: {
      version: payload.version,
      publicUrl: endpoint,
      pairingCode: code,
      expiresAt: expiresAt,
      gatewayId: payload.gatewayId || null,
      gatewayName: payload.gatewayName || null,
      endpoints: Array.isArray(payload.endpoints) ? payload.endpoints : [],
      ...deviceFields(payload)
    }
  };
}

function parseRelayPayload(payload, now) {
  const relay = String(payload.relay || '').trim();
  const nodeId = String(payload.nodeId || '').trim();
  const agentPubKey = String(payload.agentPubKey || '').trim();
  const inviteToken = String(payload.inviteToken || '').trim();
  const pairingCode = String(payload.pairingCode || '').trim();
  const expiresAt = Number(payload.expiresAt || 0);
  if (!/^wss:\/\/[^/?#@\s]+(?:\/[^?#\s]*)?$/.test(relay) ||
      !/^[A-Za-z0-9_-]{8,128}$/.test(nodeId) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(agentPubKey)) {
    return failure(PairingError.INVALID_RELAY);
  }
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
      ...deviceFields(payload)
    }
  };
}

function failure(message) {
  return { ok: false, error: message };
}

module.exports = { parse, PairingError };
