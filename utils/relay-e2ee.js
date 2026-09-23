// DSH Weapp Relay E2EE v1 —— 小程序端实现。
// 协议与 agent-connector（relay/agent-connector.js）镜像，加密原语与
// dsh-wechat-remote 的 e2ee-session 一致：tweetnacl box（X25519 ECDH）
// + secretbox（XSalsa20-Poly1305）+ Ed25519 身份签名。
//
// 握手流程：
//   客户端 → 中继 → agent：ClientHello [0x01][临时公钥32][随机16]
//   agent → 客户端：        AgentHello  [0x02][临时公钥32][身份签名64]
//     签名覆盖 transcript = hash(PROTOCOL || nodeId || clientHello || agentEphPub)，
//     客户端用配对载荷里的 agentPubKey（Ed25519）验签，防中继中间人。
//   双方用 nacl.box.before 求共享密钥，经 transcript 派生：
//     key     = hash('KDF' || shared || transcript)
//     prefixes= hash(key || 'nonce-prefix')  → 客户端发送前缀[0..15]，agent 发送前缀[16..31]
//   数据包：[0x03][counter u64 BE][secretbox(0x03 || utf8帧, nonce=txPrefix||counter, key)]
// 中继只转发二进制密文，无法解密任何业务帧。

const nacl = require('./nacl.min');

const PROTOCOL = 'dsh-weapp-e2ee-v1';
const PACKET_CLIENT_HELLO = 1;
const PACKET_AGENT_HELLO = 2;
const PACKET_SEALED = 3;
const CLEAR_DATA = 3;

function concat() {
  let total = 0;
  for (let i = 0; i < arguments.length; i += 1) total += arguments[i].length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < arguments.length; i += 1) {
    out.set(arguments[i], offset);
    offset += arguments[i].length;
  }
  return out;
}

function utf8(text) {
  // 小程序基础库不保证 TextEncoder，手工实现 UTF-8 编码。
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      out.push(
        0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63), 0x80 | (code & 63)
      );
    }
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let code;
    if (b < 0x80) {
      code = b; i += 1;
    } else if (b < 0xe0) {
      code = ((b & 31) << 6) | (bytes[i + 1] & 63); i += 2;
    } else if (b < 0xf0) {
      code = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3;
    } else {
      code = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) |
        ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4;
    }
    if (code >= 0x10000) {
      code -= 0x10000;
      out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
    } else {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

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

function transcriptHash(nodeId, clientHello, agentEphPub) {
  return nacl.hash(concat(utf8(PROTOCOL + '\0'), utf8(nodeId), clientHello, agentEphPub));
}

/** 客户端会话：发起握手、验签、加解密。 */
class ClientSession {
  constructor(nodeId, agentPubKeyB64) {
    this.nodeId = nodeId;
    this.agentIdentityPub = nacl.util ? null : null; // 占位，实际用 b64 解码
    this.agentIdentityPub = decodeBase64(agentPubKeyB64);
    this.ephemeral = nacl.box.keyPair();
    this.rxCounter = 0;
    this.txCounter = 0;
    this.ready = false;
    this.hello = concat(
      new Uint8Array([PACKET_CLIENT_HELLO]),
      this.ephemeral.publicKey,
      nacl.randomBytes(16)
    );
  }

  /** 处理 AgentHello；成功返回 true。 */
  acceptAgentHello(packet) {
    if (!packet || packet.length !== 1 + 32 + 64 || packet[0] !== PACKET_AGENT_HELLO) return false;
    const agentEphPub = packet.subarray(1, 33);
    const signature = packet.subarray(33, 97);
    const transcript = transcriptHash(this.nodeId, this.hello, agentEphPub);
    if (!this.agentIdentityPub || this.agentIdentityPub.length !== 32) return false;
    if (!nacl.sign.detached.verify(transcript, signature, this.agentIdentityPub)) return false;

    const shared = nacl.box.before(agentEphPub, this.ephemeral.secretKey);
    const key = nacl.hash(concat(utf8(PROTOCOL + '-KDF\0'), shared, transcript)).subarray(0, 32); // SHA-512 取前 32 字节
    const material = nacl.hash(concat(key, utf8('nonce-prefix')));
    this.txPrefix = material.subarray(0, 16);   // 客户端发送前缀
    this.rxPrefix = material.subarray(16, 32);  // agent 发送前缀
    this.key = key;
    this.ready = true;
    return true;
  }

  /** 明文帧文本 → 密文包（Uint8Array）。 */
  seal(text) {
    if (!this.ready) throw new Error('E2EE 会话未就绪');
    if (this.txCounter >= Number.MAX_SAFE_INTEGER) throw new Error('E2EE counter exhausted');
    const counter = this.txCounter;
    this.txCounter += 1;
    const clear = concat(new Uint8Array([CLEAR_DATA]), utf8(text));
    const sealed = nacl.secretbox(clear, concat(this.txPrefix, counterBytes(counter)), this.key);
    return concat(new Uint8Array([PACKET_SEALED]), counterBytes(counter), sealed);
  }

  /** 密文包 → 明文帧文本；失败返回 null。 */
  open(packet) {
    if (!this.ready || !packet || packet.length < 1 + 8 + 17 || packet[0] !== PACKET_SEALED) return null;
    const counter = readCounter(packet, 1);
    if (counter < this.rxCounter) return null; // 严格递增，拒绝重放
    const clear = nacl.secretbox.open(packet.subarray(9), concat(this.rxPrefix, counterBytes(counter)), this.key);
    if (!clear || clear.length < 1 || clear[0] !== CLEAR_DATA) return null;
    this.rxCounter = counter + 1;
    return utf8Decode(clear.subarray(1));
  }
}

// ---------- Base64（小程序无 atob/btoa，手工实现） ----------

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64(input) {
  const text = String(input || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < text.length; i += 1) {
    const idx = B64_CHARS.indexOf(text[i]);
    if (idx < 0) return null;
    acc = (acc << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

module.exports = {
  ClientSession: ClientSession,
  utf8: utf8,
  utf8Decode: utf8Decode,
  concat: concat,
  decodeBase64: decodeBase64,
  PROTOCOL: PROTOCOL
};
