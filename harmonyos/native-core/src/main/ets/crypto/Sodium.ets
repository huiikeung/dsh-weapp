import { cryptoFramework } from '@kit.CryptoArchitectureKit';
import { Logger } from '../common/Logger';

/**
 * NaCl 兼容的最小密码学实现（box / secretbox）。
 * 移植自 tweetnacl（public domain）的参考实现，算法与线上中继保持一致：
 *   box = X25519 + HSalsa20 预计算 + XSalsa20-Poly1305
 * 随机数使用鸿蒙 cryptoFramework。
 */

function ld32(x: Uint8Array, i: number): number {
  let u: number = x[i + 3] & 0xff;
  u = (u << 8) | (x[i + 2] & 0xff);
  u = (u << 8) | (x[i + 1] & 0xff);
  return (u << 8) | (x[i] & 0xff);
}

function st32(x: Uint8Array, i: number, u: number): void {
  for (let j = 0; j < 4; j++) {
    x[i + j] = u & 0xff;
    u >>>= 8;
  }
}

function L32(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

const SIGMA: Uint8Array = new Uint8Array([101, 120, 112, 97, 110, 100, 32, 51, 50, 45, 98, 121, 116, 101, 32, 107]);
const ZERO16: Uint8Array = new Uint8Array(16);
const ZERO32: Uint8Array = new Uint8Array(32);
const NINE: Uint8Array = new Uint8Array(32);
NINE[0] = 9;

function gf(): Float64Array {
  return new Float64Array(16);
}

function core(out: Uint8Array, inp: Uint8Array, k: Uint8Array, c: Uint8Array, h: boolean): void {
  const x: Int32Array = new Int32Array(16);
  const y: Int32Array = new Int32Array(16);
  const w: Int32Array = new Int32Array(16);
  const t: Int32Array = new Int32Array(4);
  for (let i = 0; i < 4; i++) {
    x[5 * i] = ld32(c, 4 * i);
    x[1 + i] = ld32(k, 4 * i);
    x[6 + i] = ld32(inp, 4 * i);
    x[11 + i] = ld32(k, 16 + 4 * i);
  }
  for (let i = 0; i < 16; i++) {
    y[i] = x[i];
  }
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 4; j++) {
      for (let m = 0; m < 4; m++) {
        t[m] = x[(5 * j + 4 * m) % 16];
      }
      t[1] ^= L32((t[0] + t[3]) | 0, 7);
      t[2] ^= L32((t[1] + t[0]) | 0, 9);
      t[3] ^= L32((t[2] + t[1]) | 0, 13);
      t[0] ^= L32((t[3] + t[2]) | 0, 18);
      for (let m = 0; m < 4; m++) {
        w[4 * j + (j + m) % 4] = t[m];
      }
    }
    for (let m = 0; m < 16; m++) {
      x[m] = w[m];
    }
  }
  if (h) {
    for (let i = 0; i < 16; i++) {
      x[i] = (x[i] + y[i]) | 0;
    }
    for (let i = 0; i < 4; i++) {
      x[5 * i] = (x[5 * i] - ld32(c, 4 * i)) | 0;
      x[6 + i] = (x[6 + i] - ld32(inp, 4 * i)) | 0;
    }
    for (let i = 0; i < 4; i++) {
      st32(out, 4 * i, x[5 * i]);
      st32(out, 16 + 4 * i, x[6 + i]);
    }
  } else {
    for (let i = 0; i < 16; i++) {
      st32(out, 4 * i, (x[i] + y[i]) | 0);
    }
  }
}

export function coreSalsa20(out: Uint8Array, inp: Uint8Array, k: Uint8Array): void {
  core(out, inp, k, SIGMA, false);
}

export function coreHsalsa20(out: Uint8Array, inp: Uint8Array, k: Uint8Array): void {
  core(out, inp, k, SIGMA, true);
}

function streamSalsa20Xor(c: Uint8Array, cpos: number, m: Uint8Array | undefined, mpos: number,
                         b: number, n: Uint8Array, k: Uint8Array): void {
  const z: Uint8Array = new Uint8Array(16);
  const x: Uint8Array = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    z[i] = n[i];
  }
  let remaining: number = b;
  let cposCur: number = cpos;
  let mposCur: number = mpos;
  while (remaining >= 64) {
    coreSalsa20(x, z, k);
    for (let i = 0; i < 64; i++) {
      const plain: number = m !== undefined ? m[mposCur + i] : 0;
      c[cposCur + i] = plain ^ x[i];
    }
    let u: number = 1;
    for (let i = 8; i < 16; i++) {
      u = (u + (z[i] & 0xff)) | 0;
      z[i] = u & 0xff;
      u = u >>> 8;
    }
    remaining -= 64;
    cposCur += 64;
    if (m !== undefined) {
      mposCur += 64;
    }
  }
  if (remaining > 0) {
    coreSalsa20(x, z, k);
    for (let i = 0; i < remaining; i++) {
      const plain: number = m !== undefined ? m[mposCur + i] : 0;
      c[cposCur + i] = plain ^ x[i];
    }
  }
}

function stream(c: Uint8Array, cpos: number, d: number, n: Uint8Array, k: Uint8Array): void {
  const s: Uint8Array = new Uint8Array(32);
  coreHsalsa20(s, n, k);
  streamSalsa20Xor(c, cpos, undefined, 0, d, n.subarray(16), s);
}

function streamXor(c: Uint8Array, cpos: number, m: Uint8Array, mpos: number, d: number,
                   n: Uint8Array, k: Uint8Array): void {
  const s: Uint8Array = new Uint8Array(32);
  coreHsalsa20(s, n, k);
  streamSalsa20Xor(c, cpos, m, mpos, d, n.subarray(16), s);
}

function add1305(h: Int32Array, c: Int32Array): void {
  let u: number = 0;
  for (let j = 0; j < 17; j++) {
    u = (u + ((h[j] + c[j]) | 0)) | 0;
    h[j] = u & 255;
    u = u >>> 8;
  }
}

const MINUSP: Int32Array = new Int32Array([5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252]);

export function onetimeauth(out: Uint8Array, outpos: number, m: Uint8Array, mpos: number,
                            n: number, k: Uint8Array): void {
  const x: Int32Array = new Int32Array(17);
  const r: Int32Array = new Int32Array(17);
  const h: Int32Array = new Int32Array(17);
  const c: Int32Array = new Int32Array(17);
  const g: Int32Array = new Int32Array(17);
  for (let j = 0; j < 16; j++) {
    r[j] = k[j];
  }
  r[3] &= 15;
  r[4] &= 252;
  r[7] &= 15;
  r[8] &= 252;
  r[11] &= 15;
  r[12] &= 252;
  r[15] &= 15;

  let remaining: number = n;
  let mposCur: number = mpos;
  while (remaining > 0) {
    for (let j = 0; j < 17; j++) {
      c[j] = 0;
    }
    let jmax: number = 0;
    for (let j = 0; j < 16 && j < remaining; j++) {
      c[j] = m[mposCur + j];
      jmax = j + 1;
    }
    c[jmax] = 1;
    mposCur += jmax;
    remaining -= jmax;
    add1305(h, c);
    for (let i = 0; i < 17; i++) {
      let acc: number = 0;
      for (let j = 0; j < 17; j++) {
        const mult: number = j <= i ? r[i - j] : ((320 * r[i + 17 - j]) | 0);
        acc = (acc + (h[j] * mult)) | 0;
      }
      x[i] = acc;
    }
    for (let i = 0; i < 17; i++) {
      h[i] = x[i];
    }
    let u: number = 0;
    for (let j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u = u >>> 8;
    }
    u = (u + h[16]) | 0;
    h[16] = u & 3;
    u = (5 * (u >>> 2)) | 0;
    for (let j = 0; j < 16; j++) {
      u = (u + h[j]) | 0;
      h[j] = u & 255;
      u = u >>> 8;
    }
    u = (u + h[16]) | 0;
    h[16] = u;
  }

  for (let j = 0; j < 17; j++) {
    g[j] = h[j];
  }
  add1305(h, MINUSP);
  const s: number = (-(h[16] >>> 7)) | 0;
  for (let j = 0; j < 17; j++) {
    h[j] ^= s & (g[j] ^ h[j]);
  }
  for (let j = 0; j < 16; j++) {
    c[j] = k[j + 16];
  }
  c[16] = 0;
  add1305(h, c);
  for (let j = 0; j < 16; j++) {
    out[outpos + j] = h[j];
  }
}

function verify16(x: Uint8Array, xi: number, y: Uint8Array, yi: number): number {
  let d: number = 0;
  for (let i = 0; i < 16; i++) {
    d |= x[xi + i] ^ y[yi + i];
  }
  return (1 & ((d - 1) >>> 8)) - 1;
}

function onetimeauthVerify(h: Uint8Array, hpos: number, m: Uint8Array, mpos: number,
                           n: number, k: Uint8Array): number {
  const x: Uint8Array = new Uint8Array(16);
  onetimeauth(x, 0, m, mpos, n, k);
  return verify16(h, hpos, x, 0);
}

export function secretbox(c: Uint8Array, m: Uint8Array, d: number, n: Uint8Array, k: Uint8Array): number {
  if (d < 32) {
    return -1;
  }
  streamXor(c, 0, m, 0, d, n, k);
  onetimeauth(c, 16, c, 32, d - 32, c);
  for (let i = 0; i < 16; i++) {
    c[i] = 0;
  }
  return 0;
}

export function secretboxOpen(m: Uint8Array, c: Uint8Array, d: number, n: Uint8Array, k: Uint8Array): number {
  const x: Uint8Array = new Uint8Array(32);
  if (d < 32) {
    return -1;
  }
  stream(x, 0, 32, n, k);
  if (onetimeauthVerify(c, 16, c, 32, d - 32, x) !== 0) {
    return -1;
  }
  streamXor(m, 0, c, 0, d, n, k);
  for (let i = 0; i < 32; i++) {
    m[i] = 0;
  }
  return 0;
}

function car25519(o: Float64Array): void {
  for (let i = 0; i < 16; i++) {
    o[i] += 65536;
    const c: number = Math.floor(o[i] / 65536);
    o[(i + 1) * (i < 15 ? 1 : 0)] += c - 1 + 37 * (c - 1) * (i === 15 ? 1 : 0);
    o[i] -= c * 65536;
  }
}

function sel25519(p: Float64Array, q: Float64Array, b: number): void {
  const c: number = ~(b - 1);
  for (let i = 0; i < 16; i++) {
    const t: number = c & (p[i] ^ q[i]);
    p[i] ^= t;
    q[i] ^= t;
  }
}

function pack25519(o: Uint8Array, n: Float64Array): void {
  const m: Float64Array = gf();
  const t: Float64Array = gf();
  for (let i = 0; i < 16; i++) {
    t[i] = n[i];
  }
  car25519(t);
  car25519(t);
  car25519(t);
  for (let j = 0; j < 2; j++) {
    m[0] = t[0] - 0xffed;
    for (let i = 1; i < 15; i++) {
      m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
      m[i - 1] &= 0xffff;
    }
    m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
    const b: number = (m[15] >> 16) & 1;
    m[14] &= 0xffff;
    sel25519(t, m, 1 - b);
  }
  for (let i = 0; i < 16; i++) {
    o[2 * i] = t[i] & 0xff;
    o[2 * i + 1] = t[i] >> 8;
  }
}

function unpack25519(o: Float64Array, n: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    o[i] = n[2 * i] + (n[2 * i + 1] << 8);
  }
  o[15] &= 0x7fff;
}

function addGf(o: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let i = 0; i < 16; i++) {
    o[i] = (a[i] + b[i]) | 0;
  }
}

function subGf(o: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let i = 0; i < 16; i++) {
    o[i] = (a[i] - b[i]) | 0;
  }
}

function mulGf(o: Float64Array, a: Float64Array, b: Float64Array): void {
  const t: Float64Array = new Float64Array(31);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      t[i + j] += a[i] * b[j];
    }
  }
  for (let i = 0; i < 15; i++) {
    t[i] += 38 * t[i + 16];
  }
  for (let i = 0; i < 16; i++) {
    o[i] = t[i];
  }
  car25519(o);
  car25519(o);
}

function sqGf(o: Float64Array, a: Float64Array): void {
  mulGf(o, a, a);
}

function inv25519(o: Float64Array, i: Float64Array): void {
  const c: Float64Array = gf();
  for (let a = 0; a < 16; a++) {
    c[a] = i[a];
  }
  for (let a = 253; a >= 0; a--) {
    sqGf(c, c);
    if (a !== 2 && a !== 4) {
      mulGf(c, c, i);
    }
  }
  for (let a = 0; a < 16; a++) {
    o[a] = c[a];
  }
}

const C121665: Float64Array = (() => {
  const t: Float64Array = gf();
  t[0] = 0xdb41;
  t[1] = 1;
  return t;
})();

export function scalarmult(q: Uint8Array, n: Uint8Array, p: Uint8Array): void {
  const z: Uint8Array = new Uint8Array(32);
  const x: Float64Array = new Float64Array(80);
  const a: Float64Array = gf();
  const b: Float64Array = gf();
  const c: Float64Array = gf();
  const d: Float64Array = gf();
  const e: Float64Array = gf();
  const f: Float64Array = gf();
  for (let i = 0; i < 31; i++) {
    z[i] = n[i];
  }
  z[31] = (n[31] & 127) | 64;
  z[0] &= 248;
  unpack25519(x, p);
  for (let i = 0; i < 16; i++) {
    b[i] = x[i];
    d[i] = 0;
    a[i] = 0;
    c[i] = 0;
  }
  a[0] = 1;
  d[0] = 1;
  for (let i = 254; i >= 0; i--) {
    const r: number = (z[i >>> 3] >>> (i & 7)) & 1;
    sel25519(a, b, r);
    sel25519(c, d, r);
    addGf(e, a, c);
    subGf(a, a, c);
    addGf(c, b, d);
    subGf(b, b, d);
    sqGf(d, e);
    sqGf(f, a);
    mulGf(a, c, a);
    mulGf(c, b, e);
    addGf(e, a, c);
    subGf(a, a, c);
    sqGf(b, a);
    subGf(c, d, f);
    mulGf(a, c, C121665);
    addGf(a, a, d);
    mulGf(c, c, a);
    mulGf(a, d, f);
    mulGf(d, b, x);
    sqGf(b, e);
    sel25519(a, b, r);
    sel25519(c, d, r);
  }
  for (let i = 0; i < 16; i++) {
    x[i + 16] = a[i];
    x[i + 32] = c[i];
    x[i + 48] = b[i];
    x[i + 64] = d[i];
  }
  const x32: Float64Array = x.subarray(32);
  const x16: Float64Array = x.subarray(16);
  inv25519(x32, x32);
  mulGf(x16, x16, x32);
  pack25519(q, x16);
}

export function scalarmultBase(q: Uint8Array, n: Uint8Array): void {
  scalarmult(q, n, NINE);
}

export function randomBytes(length: number): Uint8Array {
  const random = cryptoFramework.createRandom();
  const blob = random.generateRandomSync(length);
  return blob.data;
}

export interface BoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function boxKeyPair(): BoxKeyPair {
  const secretKey: Uint8Array = randomBytes(32);
  const publicKey: Uint8Array = new Uint8Array(32);
  scalarmultBase(publicKey, secretKey);
  return { publicKey: publicKey, secretKey: secretKey };
}

/** 预计算共享密钥（box 的 beforenm）。 */
export function boxBeforenm(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
  const shared: Uint8Array = new Uint8Array(32);
  const key: Uint8Array = new Uint8Array(32);
  scalarmult(shared, secretKey, publicKey);
  coreHsalsa20(key, ZERO16, shared);
  return key;
}

export function box(message: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array,
                    secretKey: Uint8Array): Uint8Array {
  const key: Uint8Array = boxBeforenm(publicKey, secretKey);
  // NaCl 约定：明文前补 32 字节零，输出再跳过前 16 字节。
  const padded: Uint8Array = new Uint8Array(message.length + 32);
  padded.set(message, 32);
  const sealed: Uint8Array = new Uint8Array(padded.length);
  secretbox(sealed, padded, sealed.length, nonce, key);
  return sealed.subarray(16);
}

export function boxOpen(cipher: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array,
                        secretKey: Uint8Array): Uint8Array | undefined {
  const key: Uint8Array = boxBeforenm(publicKey, secretKey);
  const padded: Uint8Array = new Uint8Array(cipher.length + 16);
  padded.set(cipher, 16);
  const plain: Uint8Array = new Uint8Array(cipher.length + 16);
  if (secretboxOpen(plain, padded, padded.length, nonce, key) !== 0) {
    return undefined;
  }
  return plain.subarray(32);
}

export function selfTest(): boolean {
  const aliceSk: Uint8Array = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
  const bobSk: Uint8Array = new Uint8Array([255, 254, 253, 252, 251, 250, 249, 248, 247, 246, 245, 244, 243, 242, 241, 240, 239, 238, 237, 236, 235, 234, 233, 232, 231, 230, 229, 228, 227, 226, 225, 224]);
  const bobPk: Uint8Array = new Uint8Array([62, 188, 182, 146, 20, 147, 68, 220, 84, 229, 129, 96, 207, 144, 190, 217, 238, 161, 221, 20, 232, 28, 142, 145, 222, 85, 122, 247, 215, 175, 217, 21]);
  const expectedPk: Uint8Array = new Uint8Array([143, 64, 197, 173, 182, 143, 37, 98, 74, 229, 178, 20, 234, 118, 122, 110, 201, 77, 130, 157, 61, 123, 94, 26, 209, 186, 111, 62, 33, 56, 40, 95]);
  const nonce: Uint8Array = new Uint8Array([200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223]);
  const message: Uint8Array = new Uint8Array([119, 104, 97, 108, 101, 116, 97, 105, 108, 45, 114, 101, 108, 97, 121, 45, 104, 101, 108, 108, 111, 45, 118, 101, 99, 116, 111, 114]);
  const expectedBox: Uint8Array = new Uint8Array([4, 78, 32, 65, 106, 196, 128, 161, 161, 43, 90, 170, 56, 171, 5, 185, 67, 222, 180, 148, 248, 219, 64, 73, 205, 117, 159, 23, 143, 191, 230, 11, 115, 212, 95, 9, 225, 135, 12, 117, 120, 201, 203, 63]);

  const derivedPk: Uint8Array = new Uint8Array(32);
  scalarmultBase(derivedPk, aliceSk);
  let pkOk: boolean = true;
  for (let i = 0; i < 32; i++) {
    if (derivedPk[i] !== expectedPk[i]) {
      pkOk = false;
      break;
    }
  }

  const sealed: Uint8Array = box(message, nonce, bobPk, aliceSk);
  let boxOk: boolean = sealed.length === expectedBox.length;
  if (boxOk) {
    for (let i = 0; i < expectedBox.length; i++) {
      if (sealed[i] !== expectedBox[i]) {
        boxOk = false;
        break;
      }
    }
  }

  const alicePk: Uint8Array = new Uint8Array(32);
  scalarmultBase(alicePk, aliceSk);
  const opened: Uint8Array | undefined = boxOpen(sealed, nonce, alicePk, bobSk);
  let openOk: boolean = opened !== undefined && opened.length === message.length;
  if (openOk && opened !== undefined) {
    for (let i = 0; i < message.length; i++) {
      if (opened[i] !== message[i]) {
        openOk = false;
        break;
      }
    }
  }

  Logger.info('sodium self-test pk=' + pkOk + ' box=' + boxOk + ' open=' + openOk);
  return pkOk && boxOk && openOk;
}
