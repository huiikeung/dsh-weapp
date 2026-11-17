/**
 * WireGuard 协议核心（Noise IK 握手 + 传输数据）。
 *
 * 参考 WireGuard 白皮书与 Go 实现的 wireguard-go/device/noise-protocol.go。
 * 依赖：
 * - WireGuardCrypto.ets 的 aeadSeal/aeadOpen、blake2s、hmacBlake2s
 * - Sodium.ets 的 Curve25519 scalarmult / scalarmultBase
 */

import { aeadOpen, aeadSeal, blake2s, hmacBlake2s } from './WireGuardCrypto';
import { scalarmult, scalarmultBase } from './Sodium';

/** 消息类型 */
export const WG_MSG_HANDSHAKE_INITIATION: number = 1;
export const WG_MSG_HANDSHAKE_RESPONSE: number = 2;
export const WG_MSG_COOKIE_REPLY: number = 3;
export const WG_MSG_TRANSPORT_DATA: number = 4;

/** 消息长度 */
export const WG_INITIATION_LEN: number = 148;
export const WG_RESPONSE_LEN: number = 92;
export const WG_COOKIE_LEN: number = 64;
export const WG_TRANSPORT_HEADER_LEN: number = 16;
export const WG_TRANSPORT_MIN_LEN: number = 32;

/** 密钥与标签长度 */
export const WG_KEY_LEN: number = 32;
export const WG_TAG_LEN: number = 16;
export const WG_HASH_LEN: number = 32;
export const WG_TIMESTAMP_LEN: number = 12;

/** 握手构造常量（ASCII） */
const CONSTRUCTION: string = 'Noise_IKpsk2_25519_ChaChaPoly_BLAKE2s';
const IDENTIFIER: string = 'WireGuard v1 zx2c4 Jason@zx2c4.com';

function asciiBytes(s: string): Uint8Array {
  const out: Uint8Array = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = s.charCodeAt(i) & 0xff;
  }
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out: Uint8Array = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** MixHash: hash = BLAKE2s(hash || data) */
export function mixHash(hash: Uint8Array, data: Uint8Array): Uint8Array {
  return blake2s(concat(hash, data), WG_HASH_LEN);
}

/** KDF1：单输出 */
export function kdf1(key: Uint8Array, input: Uint8Array): Uint8Array {
  return hmacBlake2s(key, input, WG_HASH_LEN);
}

/** KDF2：两输出（WireGuard 的 KDF 链） */
export function kdf2(key: Uint8Array, input: Uint8Array): WireGuardKdfResult {
  const t0: Uint8Array = hmacBlake2s(key, input, WG_HASH_LEN);
  const t1: Uint8Array = hmacBlake2s(key, concat(t0, new Uint8Array([0x01])), WG_HASH_LEN);
  const t2: Uint8Array = hmacBlake2s(key, concat(t1, new Uint8Array([0x02])), WG_HASH_LEN);
  return { first: t1, second: t2 };
}

/** KDF3：三输出 */
export function kdf3(key: Uint8Array, input: Uint8Array): WireGuardKdf3Result {
  const t0: Uint8Array = hmacBlake2s(key, input, WG_HASH_LEN);
  const t1: Uint8Array = hmacBlake2s(key, concat(t0, new Uint8Array([0x01])), WG_HASH_LEN);
  const t2: Uint8Array = hmacBlake2s(key, concat(t1, new Uint8Array([0x02])), WG_HASH_LEN);
  const t3: Uint8Array = hmacBlake2s(key, concat(t2, new Uint8Array([0x03])), WG_HASH_LEN);
  return { first: t1, second: t2, third: t3 };
}

export interface WireGuardKdfResult {
  first: Uint8Array;
  second: Uint8Array;
}

export interface WireGuardKdf3Result {
  first: Uint8Array;
  second: Uint8Array;
  third: Uint8Array;
}

/** 握手状态：Initiator 与 Responder 共用 */
export class WireGuardHandshake {
  hash: Uint8Array = new Uint8Array(WG_HASH_LEN);
  chainKey: Uint8Array = new Uint8Array(WG_HASH_LEN);
  localEphemeralPrivate: Uint8Array = new Uint8Array(WG_KEY_LEN);
  localEphemeralPublic: Uint8Array = new Uint8Array(WG_KEY_LEN);
  remoteEphemeralPublic: Uint8Array = new Uint8Array(WG_KEY_LEN);
  localStaticPrivate: Uint8Array = new Uint8Array(WG_KEY_LEN);
  localStaticPublic: Uint8Array = new Uint8Array(WG_KEY_LEN);
  remoteStaticPublic: Uint8Array = new Uint8Array(WG_KEY_LEN);
  /** sender/receiver index */
  localIndex: number = 0;
  remoteIndex: number = 0;

  /** 初始化：hash = HASH(CONSTRUCTION) */
  init(): void {
    this.hash = blake2s(asciiBytes(CONSTRUCTION), WG_HASH_LEN);
    const identifierHash: Uint8Array = blake2s(asciiBytes(IDENTIFIER), WG_HASH_LEN);
    this.hash = mixHash(this.hash, identifierHash);
    this.chainKey = this.hash.slice(0);
  }

  /** 混合公钥到 hash（MixHash） */
  mixHashPublic(pub: Uint8Array): void {
    this.hash = mixHash(this.hash, pub);
  }

  /** MixKey：chainKey, key = KDF2(chainKey, input) */
  mixKey(input: Uint8Array): Uint8Array {
    const res: WireGuardKdfResult = kdf2(this.chainKey, input);
    this.chainKey = res.second;
    return res.second;
  }

  /** 生成临时密钥对 */
  generateEphemeral(): void {
    this.localEphemeralPrivate = new Uint8Array(WG_KEY_LEN);
    for (let i = 0; i < WG_KEY_LEN; i++) {
      this.localEphemeralPrivate[i] = Math.floor(Math.random() * 256);
    }
    // clamp（Curve25519 标准做法）
    this.localEphemeralPrivate[0] &= 248;
    this.localEphemeralPrivate[31] &= 127;
    this.localEphemeralPrivate[31] |= 64;
    this.localEphemeralPublic = new Uint8Array(WG_KEY_LEN);
    scalarmultBase(this.localEphemeralPublic, this.localEphemeralPrivate);
  }

  /** DH 计算 */
  dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    const out: Uint8Array = new Uint8Array(WG_KEY_LEN);
    scalarmult(out, privateKey, publicKey);
    return out;
  }
}

/** 握手初始化消息（148 字节） */
export class WireGuardInitiation {
  static build(handshake: WireGuardHandshake, senderIndex: number, timestamp: Uint8Array): Uint8Array {
    const msg: Uint8Array = new Uint8Array(WG_INITIATION_LEN);
    msg[0] = WG_MSG_HANDSHAKE_INITIATION;
    // reserved 1..3 = 0
    msg[4] = senderIndex & 0xff;
    msg[5] = (senderIndex >>> 8) & 0xff;
    msg[6] = (senderIndex >>> 16) & 0xff;
    msg[7] = (senderIndex >>> 24) & 0xff;

    // e
    msg.set(handshake.localEphemeralPublic, 8);
    handshake.mixKey(handshake.localEphemeralPublic);
    handshake.mixHashPublic(handshake.localEphemeralPublic);

    // es: DH(localEphemeral, remoteStatic)
    const es: Uint8Array = handshake.dh(handshake.localEphemeralPrivate, handshake.remoteStaticPublic);
    const keyEs: Uint8Array = handshake.mixKey(es);
    handshake.hash = mixHash(handshake.hash, es);

    // s: 加密本机静态公钥
    const encryptedStatic: Uint8Array = aeadSeal(keyEs, new Uint8Array(12), handshake.localStaticPublic, handshake.hash);
    msg.set(encryptedStatic, 40);
    handshake.hash = mixHash(handshake.hash, encryptedStatic);

    // ss: DH(localStatic, remoteStatic)
    const ss: Uint8Array = handshake.dh(handshake.localStaticPrivate, handshake.remoteStaticPublic);
    const keySs: Uint8Array = handshake.mixKey(ss);
    handshake.hash = mixHash(handshake.hash, ss);

    // timestamp
    const encryptedTimestamp: Uint8Array = aeadSeal(keySs, new Uint8Array(12), timestamp, handshake.hash);
    msg.set(encryptedTimestamp, 88);
    handshake.hash = mixHash(handshake.hash, encryptedTimestamp);

    // mac1/mac2 先留空（需要 responder 静态公钥，由上层计算）
    return msg;
  }
}

/** 传输数据包封装（type 4） */
export class WireGuardTransport {
  /** 构造 transport 数据包：header(16) + AEAD(plaintext) */
  static seal(
    receiverIndex: number,
    counter: number,
    key: Uint8Array,
    plaintext: Uint8Array
  ): Uint8Array {
    const header: Uint8Array = new Uint8Array(WG_TRANSPORT_HEADER_LEN);
    header[0] = WG_MSG_TRANSPORT_DATA;
    header[4] = receiverIndex & 0xff;
    header[5] = (receiverIndex >>> 8) & 0xff;
    header[6] = (receiverIndex >>> 16) & 0xff;
    header[7] = (receiverIndex >>> 24) & 0xff;
    header[8] = counter & 0xff;
    header[9] = (counter >>> 8) & 0xff;
    header[10] = (counter >>> 16) & 0xff;
    header[11] = (counter >>> 24) & 0xff;
    header[12] = (counter >>> 32) & 0xff;
    header[13] = (counter >>> 40) & 0xff;
    header[14] = (counter >>> 48) & 0xff;
    header[15] = (counter >>> 56) & 0xff;

    const nonce: Uint8Array = new Uint8Array(12);
    nonce.set(header.subarray(8, 16), 0);
    nonce[4] = 0;
    nonce[5] = 0;
    nonce[6] = 0;
    nonce[7] = 0;

    const sealed: Uint8Array = aeadSeal(key, nonce, plaintext, new Uint8Array(0));
    const out: Uint8Array = new Uint8Array(WG_TRANSPORT_HEADER_LEN + sealed.length);
    out.set(header, 0);
    out.set(sealed, WG_TRANSPORT_HEADER_LEN);
    return out;
  }

  /** 解 transport 数据包，返回明文的 IP 包 */
  static open(key: Uint8Array, packet: Uint8Array): Uint8Array | undefined {
    if (packet.length < WG_TRANSPORT_MIN_LEN) {
      return undefined;
    }
    if (packet[0] !== WG_MSG_TRANSPORT_DATA) {
      return undefined;
    }
    const nonce: Uint8Array = new Uint8Array(12);
    nonce.set(packet.subarray(8, 16), 0);
    const sealed: Uint8Array = packet.subarray(WG_TRANSPORT_HEADER_LEN);
    return aeadOpen(key, nonce, sealed, new Uint8Array(0));
  }
}
