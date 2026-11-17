/**
 * WireGuard 所需的加密原语（ArkTS 实现）：
 * - ChaCha20-Poly1305 AEAD（RFC 8439）
 * - BLAKE2s 及 HMAC-BLAKE2s
 *
 * 现有 Sodium.ets 提供 Curve25519 与 Poly1305 核心，这里补齐 WireGuard 独有部分。
 */

import { onetimeauth } from './Sodium';

const SIGMA: string = 'expand 32-byte k';

function rotl(v: number, c: number): number {
  return ((v << c) | (v >>> (32 - c))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 7);
}

function loadU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function storeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

/** ChaCha20 块函数：输入 32 字节密钥、12 字节 nonce、32 位计数器，输出 64 字节 */
function chacha20Block(key: Uint8Array, nonce: Uint8Array, counter: number): Uint8Array {
  const init: Uint32Array = new Uint32Array(16);
  // "expand 32-byte k" 的 ASCII 字节（ArkTS 不支持数组展开）
  const sigmaBytes: Uint8Array = new Uint8Array([
    0x65, 0x78, 0x70, 0x61, 0x6e, 0x64, 0x20, 0x33,
    0x32, 0x2d, 0x62, 0x79, 0x74, 0x65, 0x20, 0x6b
  ]);
  init[0] = loadU32(sigmaBytes, 0);
  init[1] = loadU32(sigmaBytes, 4);
  init[2] = loadU32(sigmaBytes, 8);
  init[3] = loadU32(sigmaBytes, 12);
  for (let i = 0; i < 8; i++) {
    init[4 + i] = loadU32(key, i * 4);
  }
  init[12] = counter >>> 0;
  init[13] = loadU32(nonce, 0);
  init[14] = loadU32(nonce, 4);
  init[15] = loadU32(nonce, 8);

  const s: Uint32Array = new Uint32Array(init);
  for (let round = 0; round < 10; round++) {
    quarterRound(s, 0, 4, 8, 12);
    quarterRound(s, 1, 5, 9, 13);
    quarterRound(s, 2, 6, 10, 14);
    quarterRound(s, 3, 7, 11, 15);
    quarterRound(s, 0, 5, 10, 15);
    quarterRound(s, 1, 6, 11, 12);
    quarterRound(s, 2, 7, 8, 13);
    quarterRound(s, 3, 4, 9, 14);
  }
  const out: Uint8Array = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    storeU32(out, i * 4, (s[i] + init[i]) >>> 0);
  }
  return out;
}

/** ChaCha20 流加密（RFC 8439 计数器从 1 开始用于数据） */
export function chacha20Xor(key: Uint8Array, nonce: Uint8Array, counter: number, input: Uint8Array): Uint8Array {
  const out: Uint8Array = new Uint8Array(input.length);
  let ctr: number = counter;
  for (let off = 0; off < input.length; off += 64) {
    const block: Uint8Array = chacha20Block(key, nonce, ctr);
    const n: number = Math.min(64, input.length - off);
    for (let i = 0; i < n; i++) {
      out[off + i] = input[off + i] ^ block[i];
    }
    ctr = (ctr + 1) >>> 0;
  }
  return out;
}

/** ChaCha20-Poly1305 AEAD 加密（RFC 8439 §2.8） */
export function aeadSeal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  const otk: Uint8Array = chacha20Block(key, nonce, 0).subarray(0, 32);
  const cipher: Uint8Array = chacha20Xor(key, nonce, 1, plaintext);
  const mac: Uint8Array = new Uint8Array(aad.length + pad16(aad.length) + cipher.length + pad16(cipher.length) + 16);
  let p: number = 0;
  mac.set(aad, p);
  p += aad.length + pad16(aad.length);
  mac.set(cipher, p);
  p += cipher.length + pad16(cipher.length);
  const lenBlock: Uint8Array = new Uint8Array(16);
  storeU32(lenBlock, 0, aad.length >>> 0);
  storeU32(lenBlock, 4, Math.floor(aad.length / 0x100000000));
  storeU32(lenBlock, 8, cipher.length >>> 0);
  storeU32(lenBlock, 12, Math.floor(cipher.length / 0x100000000));
  mac.set(lenBlock, p);
  const tag: Uint8Array = new Uint8Array(16);
  onetimeauth(tag, 0, mac, 0, mac.length, otk);
  const out: Uint8Array = new Uint8Array(cipher.length + 16);
  out.set(cipher, 0);
  out.set(tag, cipher.length);
  return out;
}

function pad16(n: number): number {
  const r: number = n % 16;
  return r === 0 ? 0 : 16 - r;
}

/** 恒定时间比较 */
function equalCt(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff: number = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** ChaCha20-Poly1305 AEAD 解密 */
export function aeadOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Uint8Array | undefined {
  if (sealed.length < 16) {
    return undefined;
  }
  const cipher: Uint8Array = sealed.subarray(0, sealed.length - 16);
  const tag: Uint8Array = sealed.subarray(sealed.length - 16);
  const otk: Uint8Array = chacha20Block(key, nonce, 0).subarray(0, 32);
  const mac: Uint8Array = new Uint8Array(aad.length + pad16(aad.length) + cipher.length + pad16(cipher.length) + 16);
  let p: number = 0;
  mac.set(aad, p);
  p += aad.length + pad16(aad.length);
  mac.set(cipher, p);
  p += cipher.length + pad16(cipher.length);
  const lenBlock: Uint8Array = new Uint8Array(16);
  storeU32(lenBlock, 0, aad.length >>> 0);
  storeU32(lenBlock, 4, 0);
  storeU32(lenBlock, 8, cipher.length >>> 0);
  storeU32(lenBlock, 12, 0);
  mac.set(lenBlock, p);
  const expect: Uint8Array = new Uint8Array(16);
  onetimeauth(expect, 0, mac, 0, mac.length, otk);
  if (!equalCt(tag, expect)) {
    return undefined;
  }
  return chacha20Xor(key, nonce, 1, cipher);
}

// ── BLAKE2s（RFC 7693，WireGuard 用来做 KDF 与 MAC） ──
const B2S_IV: number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
];

const B2S_SIGMA: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]
];

function rotr32(v: number, c: number): number {
  return ((v >>> c) | (v << (32 - c))) >>> 0;
}

function blake2sCompress(h: Uint32Array, block: Uint8Array, t: number, last: boolean): void {
  const v: Uint32Array = new Uint32Array(16);
  for (let i = 0; i < 8; i++) {
    v[i] = h[i];
    v[i + 8] = B2S_IV[i];
  }
  v[12] = (v[12] ^ (t >>> 0)) >>> 0;
  v[13] = (v[13] ^ Math.floor(t / 0x100000000)) >>> 0;
  if (last) {
    v[14] = (~v[14]) >>> 0;
  }
  const m: Uint32Array = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    m[i] = loadU32(block, i * 4);
  }
  for (let r = 0; r < 10; r++) {
    const s: number[] = B2S_SIGMA[r];
    const g = (a: number, b: number, c: number, d: number, x: number, y: number): void => {
      v[a] = (v[a] + v[b] + x) >>> 0;
      v[d] = rotr32(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) >>> 0;
      v[b] = rotr32(v[b] ^ v[c], 12);
      v[a] = (v[a] + v[b] + y) >>> 0;
      v[d] = rotr32(v[d] ^ v[a], 8);
      v[c] = (v[c] + v[d]) >>> 0;
      v[b] = rotr32(v[b] ^ v[c], 7);
    };
    g(0, 4, 8, 12, m[s[0]], m[s[1]]);
    g(1, 5, 9, 13, m[s[2]], m[s[3]]);
    g(2, 6, 10, 14, m[s[4]], m[s[5]]);
    g(3, 7, 11, 15, m[s[6]], m[s[7]]);
    g(0, 5, 10, 15, m[s[8]], m[s[9]]);
    g(1, 6, 11, 12, m[s[10]], m[s[11]]);
    g(2, 7, 8, 13, m[s[12]], m[s[13]]);
    g(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) {
    h[i] = (h[i] ^ v[i] ^ v[i + 8]) >>> 0;
  }
}

/** BLAKE2s 哈希，支持 1..32 字节输出 */
export function blake2s(input: Uint8Array, outLen: number = 32): Uint8Array {
  const h: Uint32Array = new Uint32Array(B2S_IV);
  h[0] = (h[0] ^ (0x01010000 ^ outLen)) >>> 0;
  let t: number = 0;
  let off: number = 0;
  while (off + 64 < input.length) {
    t += 64;
    blake2sCompress(h, input.subarray(off, off + 64), t, false);
    off += 64;
  }
  const rest: number = input.length - off;
  const block: Uint8Array = new Uint8Array(64);
  block.set(input.subarray(off, off + rest));
  t += rest;
  blake2sCompress(h, block, t, true);
  const out: Uint8Array = new Uint8Array(outLen);
  const full: Uint8Array = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    storeU32(full, i * 4, h[i]);
  }
  out.set(full.subarray(0, outLen));
  return out;
}

/** HMAC-BLAKE2s（WireGuard 的 mac1/mac2 用） */
export function hmacBlake2s(key: Uint8Array, data: Uint8Array, outLen: number = 32): Uint8Array {
  const blockSize: number = 64;
  const keyBlock: Uint8Array = new Uint8Array(blockSize);
  if (key.length > blockSize) {
    keyBlock.set(blake2s(key, 32));
  } else {
    keyBlock.set(key);
  }
  const ipad: Uint8Array = new Uint8Array(blockSize);
  const opad: Uint8Array = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = keyBlock[i] ^ 0x36;
    opad[i] = keyBlock[i] ^ 0x5c;
  }
  const inner: Uint8Array = new Uint8Array(blockSize + data.length);
  inner.set(ipad, 0);
  inner.set(data, blockSize);
  const innerHash: Uint8Array = blake2s(inner, 32);
  const outer: Uint8Array = new Uint8Array(blockSize + 32);
  outer.set(opad, 0);
  outer.set(innerHash, blockSize);
  return blake2s(outer, outLen);
}

/** 自检：与 RFC 8439 / RFC 7693 已知向量比对 */
export function wireGuardSelfTest(): boolean {
  // RFC 8439 §2.4.2 ChaCha20 块测试
  const key: Uint8Array = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = i;
  }
  const nonce: Uint8Array = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0x4a, 0, 0, 0, 0]);
  const block: Uint8Array = chacha20Block(key, nonce, 1);
  const expectFirst: number[] = [0x22, 0x4f, 0x51, 0xf3, 0x40, 0x1b, 0xd9, 0xe1];
  let ok1: boolean = true;
  for (let i = 0; i < 8; i++) {
    if (block[i] !== expectFirst[i]) {
      ok1 = false;
    }
  }
  // RFC 7693 附录 B：BLAKE2s("abc") = 508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982
  const abc: Uint8Array = new Uint8Array([0x61, 0x62, 0x63]);
  const hash: Uint8Array = blake2s(abc, 32);
  const expectHash: number[] = [0x50, 0x8c, 0x5e, 0x8c, 0x32, 0x7c, 0x14, 0xe2];
  let ok2: boolean = true;
  for (let i = 0; i < 8; i++) {
    if (hash[i] !== expectHash[i]) {
      ok2 = false;
    }
  }
  return ok1 && ok2;
}
