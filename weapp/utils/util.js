// 通用工具：时间格式化、Base64URL 解码、JSON 展示、ID 生成。

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 会话列表用的相对时间：40 分钟前 / 1 小时前 / 昨天 / 日期。 */
function formatRelativeTime(timestampMs) {
  if (!timestampMs) return '';
  const now = Date.now();
  const diff = now - timestampMs;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return Math.floor(diff / minute) + ' 分钟前';
  if (diff < day) return Math.floor(diff / hour) + ' 小时前';
  const date = new Date(timestampMs);
  const today = new Date();
  const yesterday = new Date(today.getTime() - day);
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  return (date.getMonth() + 1) + ' 月 ' + date.getDate() + ' 日';
}

/** 轨迹/详情用的绝对时间 HH:MM:SS。 */
function formatClock(timestamp) {
  if (!timestamp) return '';
  const ms = timestamp > 10000000000 ? timestamp : timestamp * 1000;
  const d = new Date(ms);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

/** 事件时间戳归一化：网关混用秒与毫秒。 */
function eventDateMs(time) {
  if (!time) return Date.now();
  return time > 10000000000 ? time : time * 1000;
}

/** 会话 ID 展示前缀：session-b129c50b。 */
function sessionIdLabel(sessionId) {
  if (!sessionId) return '';
  const parts = String(sessionId).split(/[-_]/);
  return parts.length > 1 ? 'session-' + parts[parts.length - 1].slice(0, 8) : 'session-' + String(sessionId).slice(0, 8);
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 严格的 Base64URL 解码（无填充、无等号），与 iOS PairingPayloadParser 一致。 */
function decodeBase64URL(value) {
  if (!value) return null;
  if (value.indexOf('=') >= 0) return null;
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) return null;
  if (value.length % 4 === 1) return null;
  let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  base64 += new Array(padLen + 1).join('=');
  try {
    return base64ToArrayUtf8(base64);
  } catch (e) {
    return null;
  }
}

function base64ToArrayUtf8(base64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = {};
  for (let i = 0; i < chars.length; i += 1) lookup[chars[i]] = i;
  let bufferLength = base64.length * 0.75;
  if (base64[base64.length - 1] === '=') {
    bufferLength -= 1;
    if (base64[base64.length - 2] === '=') bufferLength -= 1;
  }
  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const encoded1 = lookup[base64[i]];
    const encoded2 = lookup[base64[i + 1]];
    const encoded3 = lookup[base64[i + 2]];
    const encoded4 = lookup[base64[i + 3]];
    bytes[p] = (encoded1 << 2) | (encoded2 >> 4);
    p += 1;
    bytes[p] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    p += 1;
    bytes[p] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    p += 1;
  }
  return utf8BytesToString(bytes);
}

function utf8BytesToString(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 1;
    } else if (byte < 0xf0) {
      out += String.fromCharCode(((byte & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 2;
    } else {
      const codePoint = ((byte & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      const offset = codePoint - 0x10000;
      out += String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
      i += 3;
    }
  }
  return out;
}

/** JSONValue 的展示文本；供应商把 tool 参数塞成 JSON 字符串时先解一层。 */
function jsonDisplayText(value, pretty) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') ||
        (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']')) {
      try {
        const parsed = JSON.parse(trimmed);
        return pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
      } catch (e) { /* 保留原文 */ }
    }
    return value;
  }
  try {
    return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

/** 事件预览：轨迹行里的一行摘要。 */
function oneLine(text, limit) {
  if (!text) return '';
  const single = String(text).replace(/\s+/g, ' ').trim();
  const max = limit || 40;
  return single.length > max ? single.slice(0, max) + '…' : single;
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = {
  formatRelativeTime,
  formatClock,
  eventDateMs,
  sessionIdLabel,
  uuid,
  decodeBase64URL,
  jsonDisplayText,
  oneLine,
  formatBytes
};
