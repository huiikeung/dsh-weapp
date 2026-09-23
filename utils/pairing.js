// 配对载荷解析：与 iOS PairingPayloadParser 严格对齐。
// WebUI 生成的二维码内容是 Base64URL(JSON)：
// { version, publicUrl, pairingCode, expiresAt, gatewayId?, gatewayName?, endpoints? }

const { decodeBase64URL } = require('./util');

const PairingError = {
  INVALID_BASE64: '配对内容不是有效的 Base64URL 字符串。',
  INVALID_JSON: 'Base64URL 解码后的内容不是有效的 DeepSeek Harness 配对 JSON。',
  UNSUPPORTED_VERSION: '不支持的配对协议版本，当前客户端需要 version 2。',
  INVALID_ENDPOINT: '二维码中的 publicUrl 不是有效的 WebSocket 地址。',
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

function failure(message) {
  return { ok: false, error: message };
}

module.exports = { parse, PairingError };
