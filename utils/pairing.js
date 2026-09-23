// 配对载荷解析：兼容两种格式。
// v2（直连，与 iOS PairingPayloadParser 对齐）：WebUI 生成的二维码是 Base64URL(JSON)：
//   { version, publicUrl, pairingCode, expiresAt, gatewayId?, gatewayName?, endpoints? }
// v3（公网中继 + E2EE，由 relay/agent-connector.js 生成）：
//   { version:3, mode:'relay', relay, nodeId, agentPubKey, gatewayName?, gatewayUrl? }
//   小程序实际连接 relay + '/c/' + nodeId，经 E2EE 握手后由 fnOS 连接器桥接本地网关。

const { decodeBase64URL } = require('./util');

const PairingError = {
  INVALID_BASE64: '配对内容不是有效的 Base64URL 字符串。',
  INVALID_JSON: 'Base64URL 解码后的内容不是有效的 DeepSeek Harness 配对 JSON。',
  UNSUPPORTED_VERSION: '不支持的配对协议版本，当前客户端需要 version 2 或 3。',
  INVALID_ENDPOINT: '二维码中的 publicUrl 不是有效的 WebSocket 地址。',
  INVALID_RELAY: '二维码中的中继地址或节点信息无效。',
  INVALID_CODE: '二维码中的一次性 pairingCode 无效。',
  EXPIRED: '二维码配对码已经过期，请在 WebUI 中重新生成。'
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
    return parseRelayPayload(payload);
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
      endpoints: Array.isArray(payload.endpoints) ? payload.endpoints : []
    }
  };
}

function parseRelayPayload(payload) {
  const relay = String(payload.relay || '').trim();
  const nodeId = String(payload.nodeId || '').trim();
  const agentPubKey = String(payload.agentPubKey || '').trim();
  if (!/^wss:\/\//.test(relay)) return failure(PairingError.INVALID_RELAY);
  if (!nodeId || !agentPubKey) return failure(PairingError.INVALID_RELAY);
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
      pairingCode: null,
      expiresAt: Number(payload.expiresAt || 0) || Infinity,
      gatewayId: nodeId,
      gatewayName: payload.gatewayName || null,
      endpoints: [endpoint],
      gatewayUrl: payload.gatewayUrl || null
    }
  };
}

function failure(message) {
  return { ok: false, error: message };
}

module.exports = { parse, PairingError };
