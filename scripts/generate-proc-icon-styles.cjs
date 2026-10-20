#!/usr/bin/env node
/**
 * Execution-loader icon animations (32x32, 72 frames / 4000 ms).
 *
 * Generates the six alternative styles for the square loader that sits in
 * front of the running process title (".proc-loader", 2x2 blinking cells):
 *
 *   miniprogram/assets/icons/proc-icon-<id>-<light|dark>.gif
 *
 * ids: terra, morph, grid, orbit, ripple, wave.
 *
 * Contract:
 *   GIF89a, 32 x 32 px, exactly 72 frames, 4000 ms cumulative delays,
 *   Netscape loop-forever, transparent index 0, 4-entry global color table
 *   [transparent, ink, 60% ink, 30% ink], LZW min code size 2 (clear 4, EOI 5).
 *   Neutral grayscale ink (execution icons are intentionally monochrome, no
 *   hue; every palette entry has R = G = B). Light on #FFFFFF: ink rgb(108,108,108),
 *   tone2 rgb(166,166,166), tone3 rgb(211,211,211). Dark on #000000: ink
 *   rgb(150,150,150), tone2 rgb(90,90,90), tone3 rgb(45,45,45).
 *   Each GIF <= 7 KB, all twelve <= 90 KB total.
 *   Displayed at 32rpx = 16 px, so 32 px is exactly 2x.
 *
 * Rendering: dots are rasterised into a 4x supersampled alpha coverage buffer,
 * composited ("over", single ink), downsampled, then quantised to the 3 ink
 * tones. Every animation is parameterised by loop phase u = frame / FRAMES so
 * the 4000 ms loop is seamless by construction.
 *
 * terra / morph are adapted from TerraWork's libs/thinking-orbs.js, a vanilla
 * canvas port of Jakub Antalik's thinking-orbs (MIT), at the 20 px preset:
 *   terra -> globe/"searching" (lat/lon dot shell + rotating scan highlight);
 *   morph -> shaping (circle -> triangle -> square, HOLD 1.4 / MORPH 0.9 /
 *            spread 1.45, 18 dots).
 * Geometry follows the 20 px preset scaled into the 32 px canvas; only the
 * timeline is retimed onto the 4 s loop (TerraWork itself runs free), so the
 * globe's density is trimmed a little and its radii get a small 18 px
 * legibility boost. The generator emits its own frames and does not ship the
 * library.
 *
 * No npm dependencies. GIF LZW encoder/decoder below are self-contained.
 *
 * Usage: node scripts/generate-proc-icon-styles.cjs [--out <dir>]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// contract
// ---------------------------------------------------------------------------
const SIZE = 32;
const FRAMES = 72;
const TOTAL_MS = 4000;
const SS = 4; // supersampling factor for anti-aliasing
const MAX_BYTES = 7 * 1024; // hard per-file cap
const MAX_TOTAL_BYTES = 90 * 1024; // hard cap for all twelve files
const IDS = ['terra', 'morph', 'grid', 'orbit', 'ripple', 'wave'];
// Execution icons are intentionally monochrome: neutral grayscale ink with no
// hue, so every palette entry is strictly R = G = B. Values are explicit (not
// derived from a tinted base) and chosen per theme for contrast on #FFFFFF /
// #000000.
const THEMES = {
  light: {
    ink: [108, 108, 108],
    tone2: [166, 166, 166],
    tone3: [211, 211, 211],
    bg: [255, 255, 255]
  },
  dark: {
    ink: [150, 150, 150],
    tone2: [90, 90, 90],
    tone3: [45, 45, 45],
    bg: [0, 0, 0]
  }
};

// ---------------------------------------------------------------------------
// tiny raster: supersampled alpha coverage, single ink
// ---------------------------------------------------------------------------
class Surface {
  constructor() {
    this.w = SIZE * SS;
    this.h = SIZE * SS;
    this.buf = new Float32Array(this.w * this.h);
    this.alpha = new Float32Array(SIZE * SIZE);
  }
  clear() {
    this.buf.fill(0);
  }
  /** Composite one anti-aliased dot of radius r at (x,y) with opacity a. */
  dot(x, y, r, a = 1) {
    if (!(r > 0) || !(a > 0)) return;
    const W = this.w, H = this.h, buf = this.buf;
    const cx = x * SS, cy = y * SS, R = r * SS;
    const x0 = Math.max(0, Math.floor(cx - R - 0.5));
    const x1 = Math.min(W - 1, Math.ceil(cx + R + 0.5));
    const y0 = Math.max(0, Math.floor(cy - R - 0.5));
    const y1 = Math.min(H - 1, Math.ceil(cy + R + 0.5));
    const R2 = R * R;
    const solid = a >= 1;
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      if (dy * dy > R2) continue;
      const row = py * W;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        if (dx * dx + dy * dy > R2) continue;
        const i = row + px;
        if (solid) buf[i] = 1;
        else buf[i] = a + buf[i] * (1 - a);
      }
    }
  }
  /** Downsample coverage and quantise alpha into toner levels. */
  toIndices(tones) {
    const n = SIZE * SIZE, acc = this.alpha;
    acc.fill(0);
    const rowLen = this.w;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        let s = 0;
        for (let sy = 0; sy < SS; sy++) {
          const base = (y * SS + sy) * rowLen + x * SS;
          for (let sx = 0; sx < SS; sx++) s += this.buf[base + sx];
        }
        acc[y * SIZE + x] = s / (SS * SS);
      }
    }
    const out = new Uint8Array(n);
    if (tones === 3) {
      // nearest of {0, 30%, 60%, 100%} ink
      for (let i = 0; i < n; i++) {
        const a = acc[i];
        out[i] = a >= 0.80 ? 1 : a >= 0.47 ? 2 : a >= 0.20 ? 3 : 0;
      }
    } else {
      // nearest of {0, 60%, 100%} ink
      for (let i = 0; i < n; i++) {
        const a = acc[i];
        out[i] = a >= 0.75 ? 1 : a >= 0.38 ? 2 : 0;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// GIF encoder (GIF89a, 4-entry palette, LZW min code size 2)
// ---------------------------------------------------------------------------
function lzwEncode(indices) {
  let dictionary, next, size;
  const reset = () => {
    dictionary = new Map();
    next = 6;
    size = 3;
  };
  reset();
  const bytes = [];
  let bits = 0, buffer = 0;
  const emit = (code) => {
    buffer |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  emit(4); // clear code
  let current = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const value = indices[i], key = current * 256 + value;
    if (dictionary.has(key)) {
      current = dictionary.get(key);
      continue;
    }
    emit(current);
    // The decoder's dictionary lags the encoder by one entry.
    if (next >= (1 << size) && size < 12) size++;
    if (next < 4096) dictionary.set(key, next++);
    else {
      emit(4);
      reset();
    }
    current = value;
  }
  emit(current);
  if (next >= (1 << size) && size < 12) size++;
  emit(5); // end of information
  if (bits) bytes.push(buffer & 255);
  const blocks = [Buffer.from([2])]; // LZW minimum code size
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    blocks.push(Buffer.from([chunk.length]), Buffer.from(chunk));
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

/** Independent GIF LZW decoder, used to prove the encoder round-trips. */
function lzwDecode(data, minCodeSize = 2) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let size = minCodeSize + 1, next = eoi + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[eoi] = [];
    size = minCodeSize + 1;
    next = eoi + 1;
  };
  reset();
  let bitPos = 0, totalBits = data.length * 8, prev = null;
  const out = [];
  const readCode = () => {
    if (bitPos + size > totalBits) return -1;
    let code = 0;
    for (let i = 0; i < size; i++) {
      const byte = data[((bitPos + i) >> 3)];
      if ((byte >> ((bitPos + i) & 7)) & 1) code |= 1 << i;
    }
    bitPos += size;
    return code;
  };
  for (;;) {
    const code = readCode();
    if (code < 0 || code === eoi) break;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    let entry;
    if (code < next && dict[code]) entry = dict[code];
    else if (code === next && prev) entry = prev.concat(prev[0]);
    else throw new Error('bad LZW code ' + code);
    for (const v of entry) out.push(v);
    if (prev) {
      if (next < 4096) {
        dict[next++] = prev.concat(entry[0]);
        if (next === (1 << size) && size < 12) size++;
      }
    }
    prev = entry;
  }
  return Uint8Array.from(out);
}

function buildGif(frames, theme) {
  const pal = THEMES[theme];
  const entries = [[0, 0, 0], pal.ink, pal.tone2, pal.tone3];
  const word = (n) => [n & 255, (n >> 8) & 255];
  const parts = [];
  parts.push(Buffer.from('GIF89a'));
  // logical screen descriptor: 32x32, 4-entry global color table, bg index 0
  parts.push(Buffer.from([...word(SIZE), ...word(SIZE), 0x81, 0, 0]));
  parts.push(Buffer.from(entries.flat()));
  // Netscape application extension: loop forever
  parts.push(Buffer.from([0x21, 0xff, 11]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  for (let i = 0; i < FRAMES; i++) {
    // GIF delays are centiseconds; cumulative rounding keeps the 4 s loop exact
    const cs = TOTAL_MS / 10;
    const delay = Math.round(((i + 1) * cs) / FRAMES) - Math.round((i * cs) / FRAMES);
    // graphic control: disposal 2 (restore to background), transparent index 0
    parts.push(Buffer.from([0x21, 0xf9, 4, 9, ...word(delay), 0, 0]));
    parts.push(Buffer.from([0x2c, 0, 0, 0, 0, ...word(SIZE), ...word(SIZE), 0]));
    parts.push(lzwEncode(frames[i]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// self verification: parse our own file, decode every frame, compare
// ---------------------------------------------------------------------------
function parseGif(buf) {
  if (buf.subarray(0, 6).toString('latin1') !== 'GIF89a') throw new Error('not GIF89a');
  const width = buf.readUInt16LE(6), height = buf.readUInt16LE(8);
  const packed = buf[10];
  const gctBits = (packed & 0x07) + 1;
  const gctLen = 1 << gctBits;
  let at = 13;
  const gct = [];
  for (let i = 0; i < gctLen; i++, at += 3) gct.push([buf[at], buf[at + 1], buf[at + 2]]);
  let loop = null, delay = 0, frames = 0, transparent = null, disposal = null;
  const indices = [];
  while (at < buf.length) {
    const marker = buf[at];
    if (marker === 0x3b) {
      at++;
      break;
    }
    if (marker === 0x21) {
      const type = buf[at + 1];
      at += 2;
      if (type === 0xf9) {
        const blockSize = buf[at]; // 4
        const packedGCE = buf[at + 1];
        disposal = (packedGCE >> 2) & 7;
        transparent = packedGCE & 1 ? buf[at + 4] : null;
        delay += buf.readUInt16LE(at + 2) * 10;
        at += 1 + blockSize + 1;
      } else if (type === 0xff) {
        const len = buf[at];
        const app = buf.subarray(at + 1, at + 1 + len).toString('latin1');
        at += 1 + len;
        const sub = [];
        while (buf[at]) {
          sub.push(buf.subarray(at + 1, at + 1 + buf[at]));
          at += 1 + buf[at];
        }
        at++;
        if (app === 'NETSCAPE2.0') loop = sub[0].readUInt16LE(1);
      } else {
        while (buf[at]) at += buf[at] + 1;
        at++;
      }
    } else if (marker === 0x2c) {
      const fw = buf.readUInt16LE(at + 5), fh = buf.readUInt16LE(at + 7);
      const lct = buf[at + 9];
      at += 10;
      if (lct) throw new Error('unexpected local color table');
      const minCode = buf[at++];
      const chunks = [];
      while (buf[at]) {
        chunks.push(buf.subarray(at + 1, at + 1 + buf[at]));
        at += 1 + buf[at];
      }
      at++;
      const data = Buffer.concat(chunks);
      const decoded = lzwDecode(data, minCode);
      if (decoded.length !== fw * fh) throw new Error('frame ' + frames + ' decoded ' + decoded.length + ' px');
      indices.push(decoded);
      frames++;
    } else {
      throw new Error('unexpected GIF block 0x' + marker.toString(16) + ' at ' + at);
    }
  }
  return { width, height, gct, loop, delay, frames, transparent, disposal, indices, end: at };
}

/** Validate one encoded GIF and the exact pixel indices that went into it. */
function verifyGif(file, theme, expectedFrames) {
  const buf = fs.readFileSync(file);
  const g = parseGif(buf);
  const fail = (msg) => {
    throw new Error(file + ': ' + msg);
  };
  if (g.width !== SIZE || g.height !== SIZE) fail('size ' + g.width + 'x' + g.height);
  if (g.frames !== FRAMES) fail('frames ' + g.frames);
  if (g.delay !== TOTAL_MS) fail('duration ' + g.delay);
  if (g.loop !== 0) fail('loop ' + g.loop);
  if (g.transparent !== 0) fail('transparent index ' + g.transparent);
  if (g.disposal !== 2) fail('disposal ' + g.disposal);
  if (g.gct.length !== 4) fail('GCT entries ' + g.gct.length);
  const pal = THEMES[theme];
  const want = [[0, 0, 0], pal.ink, pal.tone2, pal.tone3];
  for (let i = 0; i < 4; i++) {
    if (g.gct[i].join() !== want[i].join()) fail('palette[' + i + '] ' + g.gct[i].join());
  }
  for (let i = 0; i < FRAMES; i++) {
    const a = g.indices[i], b = expectedFrames[i];
    if (a.length !== b.length) fail('frame ' + i + ' length');
    for (let p = 0; p < a.length; p++) {
      if (a[p] !== b[p]) fail('frame ' + i + ' pixel ' + p + ': ' + a[p] + ' != ' + b[p]);
    }
  }
  return { bytes: buf.length, frames: g.frames, duration: g.delay };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
/** TerraWork's 3D projection helper. */
function makeProj(yaw, tilt, cx, cy, scale) {
  const st = Math.sin(tilt), ct = Math.cos(tilt), sy = Math.sin(yaw), cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}
/** Points evenly spaced by arc length along a polyline. */
function samplePath(points, count) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push(len);
    total += len;
  }
  const out = [];
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    let i = 0, acc = 0;
    while (i < segs.length - 1 && acc + segs[i] < target) {
      acc += segs[i];
      i++;
    }
    const a = points[i], b = points[(i + 1) % points.length];
    const f = segs[i] ? Math.min(1, (target - acc) / segs[i]) : 0;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}
/** Dense polyline for a rounded rectangle outline. */
function roundedSquarePath(cx, cy, half, radius, stepsPerCorner = 6) {
  const r = Math.min(radius, half);
  const pts = [];
  const corners = [
    [cx + half - r, cy - half + r, -Math.PI / 2],
    [cx + half - r, cy + half - r, 0],
    [cx - half + r, cy + half - r, Math.PI / 2],
    [cx - half + r, cy - half + r, Math.PI]
  ];
  for (const [ccx, ccy, start] of corners) {
    for (let s = 0; s <= stepsPerCorner; s++) {
      const a = start + (s / stepsPerCorner) * (Math.PI / 2);
      pts.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]);
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// style 1: terra — TerraWork globe ("searching" state), 20 px preset
// ---------------------------------------------------------------------------
/**
 * TerraWork resolvePreset('searching', 20) semantics, reproduced explicitly:
 *   PRESETS.globe['20'] = { speed: 2.665, count: 0.105, size: 1.75,
 *                           extra: { scanMul: 4.335, dimBase: 0.45 } }
 *   scaleCounts (sqrt scaling, paired): latRings = 6, lonDensity = 14
 *   scaleRadii: rBase 0.6*1.75, rDepth 1.7*1.75, rBoost 1.75
 *   rsPow = 0.6 with radiusScale(size) = (size / 300) ^ 0.6
 *
 * A latitude/longitude dot shell + a rotating scan highlight: this is the
 * hint that reads as a "dotted sphere" rather than random scatter at 18 px.
 *
 * Timeline is retimed onto the 4 s loop. TerraWork runs free; here one loop
 * must close exactly, so each component gets an integer number of cycles per
 * loop: yaw 1 turn, tilt wobble 1 cycle, scan highlight 2 sweeps.
 * Depth is mapped onto the 3 ink tones (far = 30% tone, mid = 60% tone,
 * front/scan = full ink) and radii get a small 18 px legibility boost.
 */
const GLOBE = (() => {
  const preset = { speed: 2.665, count: 0.105, size: 1.75 };
  const sqrtCount = Math.sqrt(preset.count);
  return {
    // 20 px preset gives latRings 6 / lonDensity 14; trimmed ~30% so the
    // 3-tone globe fits the per-file cap without losing the shell structure.
    latRings: Math.max(2, Math.round(17 * sqrtCount) - 1),
    lonDensity: Math.max(2, Math.round(44 * sqrtCount) - 8),
    rs: Math.pow(20 / 300, 0.6),
    R: (20 / 2) * 0.82,
    scale: SIZE / 20, // logical 20 px -> 32 px canvas
    rBase: 0.6 * preset.size,
    rDepth: 1.7 * preset.size,
    rBoost: 1.0 * preset.size,
    rMin: 0.3,
    inkFar: 0.62,
    inkSpan: 0.54,
    dimBase: 0.45,
    // 3-tone remap of TerraWork's alpha/whiteness, tuned so the shell reads at
    // 18 px: far dots stay visible as 30%, front as 60%/ink, scan as ink.
    toneK: 2.0,
    toneOffset: 0.42, // 3-tone remap: far-hemisphere dots at 60% tone
    toneGain: 0.55, // front hemisphere / scan highlight reach full ink
    scanBoost: 0.40,
    radiusBoost: 0.85
  };
})();
function terraDots(u) {
  const G = GLOBE;
  const yaw = TAU * u; // 1 turn per loop
  const tilt = 0.4 + 0.06 * Math.sin(TAU * u); // 1 wobble cycle per loop
  const scan = TAU * 2 * u; // 2 highlight sweeps per loop
  const pt = makeProj(yaw, tilt, 10, 10, G.R); // logical 20 px coords
  const dots = [];
  for (let li = 0; li <= G.latRings; li++) {
    const lat = -Math.PI / 2 + (li / G.latRings) * Math.PI;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    const lonCount = Math.max(1, Math.round(Math.abs(cosLat) * G.lonDensity));
    for (let lj = 0; lj < lonCount; lj++) {
      const lon = (lj / lonCount) * TAU;
      const p = pt(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
      const depth = (p[2] + 1) / 2; // 0 far .. 1 near
      // TerraWork: highlight tracks lon + spin; exponential angular falloff
      const d = Math.atan2(Math.sin(lon + yaw - scan), Math.cos(lon + yaw - scan));
      const boost = Math.exp(-(d * d) / 0.18) * Math.max(0, p[2]);
      const rLogical = (G.rBase + G.rDepth * depth + G.rBoost * boost) * G.rs;
      const w = G.inkFar - G.inkSpan * depth;
      const alpha = G.dimBase + (1 - G.dimBase) * Math.min(1, boost);
      const tone = clamp(G.toneOffset + G.toneGain * (alpha * (1 - w) * G.toneK) + G.scanBoost * boost, 0, 1);
      dots.push({
        x: SIZE / 2 + (p[0] - 10) * G.scale,
        y: SIZE / 2 + (p[1] - 10) * G.scale,
        r: Math.max(G.rMin, rLogical) * G.scale * G.radiusBoost,
        a: tone
      });
    }
  }
  return dots;
}

// ---------------------------------------------------------------------------
// style 2: morph — TerraWork shaping ("shaping" state), 20 px preset
// ---------------------------------------------------------------------------
const MORPH = (() => {
  const count = 0.53, size = 1.011, spread = 1.45;
  return {
    iconD: count,
    rDot: 0.021 * size * 0.85,
    spread,
    // 18 dots at the 20 px preset; trimmed to 13 for the 7 KB file cap.
    n: Math.max(6, Math.round(34 * count * 0.72)),
    rScale: 0.85,
    HOLD: 1.4,
    MORPH: 0.9,
    cycle: (1.4 + 0.9) * 3,
    scale: SIZE / 20
  };
})();
function polyPath(verts) {
  const V = verts.length, L = [];
  let total = 0;
  for (let i = 0; i < V; i++) {
    const a = verts[i], b = verts[(i + 1) % V];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    L.push(l);
    total += l;
  }
  return (f) => {
    let target = f * total, i = 0;
    while (i < V - 1 && target > L[i]) {
      target -= L[i];
      i++;
    }
    const a = verts[i], b = verts[(i + 1) % V];
    const ff = L[i] ? Math.min(1, target / L[i]) : 0;
    return [a[0] + (b[0] - a[0]) * ff, a[1] + (b[1] - a[1]) * ff];
  };
}
const MORPH_SHAPES = [
  (f) => {
    const a = -Math.PI / 2 + f * TAU;
    return [Math.cos(a) * 0.24, Math.sin(a) * 0.24];
  },
  polyPath([[0.0, -0.26], [0.24, 0.16], [-0.24, 0.16]]),
  polyPath([[0, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]])
];
function morphDots(u) {
  const M = MORPH;
  // one complete circle -> triangle -> square -> circle cycle per 4 s loop
  const t = u * M.cycle;
  const tc = t % M.cycle;
  const k = Math.floor(tc / (M.HOLD + M.MORPH));
  const local = tc - k * (M.HOLD + M.MORPH);
  const m = local > M.HOLD ? smoothstep(0, 1, (local - M.HOLD) / M.MORPH) : 0;
  const sprd = M.spread;
  const pA = MORPH_SHAPES[k], pB = MORPH_SHAPES[(k + 1) % 3];
  const SAMPLES = 160;
  const pts = [];
  for (let i = 0; i < SAMPLES; i++) {
    const f = i / SAMPLES;
    const a = pA(f), b = pB(f);
    pts.push([(a[0] + (b[0] - a[0]) * m) * sprd, (a[1] + (b[1] - a[1]) * m) * sprd]);
  }
  // TerraWork samples the shape uniformly by parameter, not by arc length
  const n = M.n;
  const re = M.rDot * 1.35 * sprd;
  const pulse = 1 + 0.02 * Math.sin(local * 3.1);
  const dots = [];
  const c = SIZE / 2;
  for (let k2 = 0; k2 < n; k2++) {
    const f = k2 / n;
    const segF = f * SAMPLES;
    const i = Math.floor(segF), frac = segF - i;
    const a = pts[i], b = pts[(i + 1) % SAMPLES];
    const x = (a[0] + (b[0] - a[0]) * frac) * pulse;
    const y = (a[1] + (b[1] - a[1]) * frac) * pulse;
    dots.push({ x: c + x * 20 * M.scale, y: c + y * 20 * M.scale, r: Math.max(0.7, re * 20 * M.scale), a: 1 });
  }
  return dots;
}

// ---------------------------------------------------------------------------
// style 3: grid — breathing 3x3 dot grid with a diagonal wave
// ---------------------------------------------------------------------------
const GRID = {
  pos: [0.19, 0.5, 0.81].map((v) => v * SIZE),
  baseR: SIZE * 0.0445,
  ampR: SIZE * 0.0215,
  cycles: 2,
  diagDelay: 0.8
};
function gridDots(u) {
  const g = GRID;
  const dots = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const phase = TAU * g.cycles * u - (i + j) * g.diagDelay;
      const w = 0.5 + 0.5 * Math.sin(phase); // 0..1
      const r = g.baseR + g.ampR * w;
      const a = 0.55 + 0.45 * w; // 2-tone friendly: 60% ink .. ink
      dots.push({ x: g.pos[i], y: g.pos[j], r, a });
    }
  }
  return dots;
}

// ---------------------------------------------------------------------------
// style 4: orbit — one light dot with trailing ghosts circling a rounded square
// ---------------------------------------------------------------------------
const ORBIT = {
  half: SIZE * 0.341,
  radius: SIZE * 0.156,
  trackDots: 9,
  trailLags: [0.055, 0.11, 0.165],
  trailRadius: [SIZE * 0.061, SIZE * 0.05, SIZE * 0.041],
  trailTone: [0.85, 0.6, 0.5]
};
const ORBIT_TRACK_R = SIZE * 0.026;
const ORBIT_HEAD_R = SIZE * 0.075;
function orbitDots(u) {
  const o = ORBIT;
  const path = roundedSquarePath(SIZE / 2, SIZE / 2, o.half, o.radius, 5);
  const dots = [];
  // uniform dotted track in the light tone: always shows the rounded square
  for (const [x, y] of samplePath(path, o.trackDots)) dots.push({ x, y, r: ORBIT_TRACK_R, a: 0.5 });
  // trail: a few clearly separated dots behind the head, shrinking + dimming
  for (let k = 0; k < o.trailLags.length; k++) {
    const [x, y] = sampleAtPhase(path, u - o.trailLags[k]);
    dots.push({ x, y, r: o.trailRadius[k], a: o.trailTone[k] });
  }
  // head
  const [hx, hy] = sampleAtPhase(path, u);
  dots.push({ x: hx, y: hy, r: ORBIT_HEAD_R, a: 1 });
  return dots;
}
/** Point at a normalised phase along a closed path (0..1), by arc length. */
function sampleAtPhase(path, phase) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push(len);
    total += len;
  }
  const target = (((phase % 1) + 1) % 1) * total;
  let i = 0, acc = 0;
  while (i < segs.length - 1 && acc + segs[i] < target) {
    acc += segs[i];
    i++;
  }
  const a = path[i], b = path[(i + 1) % path.length];
  const f = segs[i] ? Math.min(1, (target - acc) / segs[i]) : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

// ---------------------------------------------------------------------------
// style 5: ripple — three staggered dotted rounded-square rings
// ---------------------------------------------------------------------------
const RIPPLE = { rings: 3, dotR: 1.08, spacing: 6.2, halfMin: 2.1, halfMax: 10.7, cornerMax: 5.3 };
function rippleDots(u) {
  const rp = RIPPLE;
  const dots = [];
  for (let j = 0; j < rp.rings; j++) {
    const life = (u + j / rp.rings) % 1;
    const expand = 1 - Math.pow(1 - life, 2); // ease-out
    const half = rp.halfMin + (rp.halfMax - rp.halfMin) * expand;
    const corner = Math.max(1.6, rp.cornerMax * expand);
    const path = roundedSquarePath(SIZE / 2, SIZE / 2, half, corner, 4);
    let perimeter = 0;
    for (let i = 0; i < path.length; i++) {
      const a = path[i], b = path[(i + 1) % path.length];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const count = clamp(Math.round(perimeter / rp.spacing), 6, 30);
    // fade in quickly, fade out over the second half of the life
    const a = Math.min(1, life / 0.10) * (1 - smoothstep(0.45, 1, life));
    if (a <= 0.02) continue;
    for (const [x, y] of samplePath(path, count)) {
      dots.push({ x, y, r: rp.dotR, a: a * (0.7 + 0.3 * (1 - life)) });
    }
  }
  return dots;
}

// ---------------------------------------------------------------------------
// style 6: wave — five vertical dot columns, equalizer heights
// ---------------------------------------------------------------------------
const WAVE = {
  cols: [0.178, 0.372, 0.566, 0.761, 0.956].map((v) => v * SIZE),
  rows: [-1, 0, 1],
  rowGap: 3.6,
  dotR: 1.38,
  baseH: 6.4,
  amp: 3.4
};
function waveDots(u) {
  const w = WAVE;
  const dots = [];
  for (let i = 0; i < w.cols.length; i++) {
    const h =
      w.baseH +
      w.amp * Math.sin(TAU * 2 * u + i * 0.95) +
      1.7 * Math.sin(TAU * 3 * u + i * 1.7);
    for (const row of w.rows) {
      const d = Math.abs(row) * w.rowGap;
      const f = clamp((h - d) / 2.6, 0, 1); // soft bar top/bottom
      if (f < 0.22) continue;
      dots.push({
        x: w.cols[i],
        y: SIZE / 2 + row * w.rowGap,
        r: w.dotR * (0.35 + 0.65 * f),
        a: 1
      });
    }
  }
  return dots;
}

// ---------------------------------------------------------------------------
// style registry
// ---------------------------------------------------------------------------
const RENDER = {
  terra: { tones: 3, dots: terraDots, note: 'TerraWork globe (searching) @20px preset, retimed to 4 s' },
  morph: { tones: 2, dots: morphDots, note: 'TerraWork shaping @20px preset, retimed to 4 s' },
  grid: { tones: 2, dots: gridDots, note: '3x3 breathing dot grid + diagonal wave' },
  orbit: { tones: 3, dots: orbitDots, note: 'light dot circling a dotted rounded-square track' },
  ripple: { tones: 2, dots: rippleDots, note: '3 staggered rounded-square dot rings' },
  wave: { tones: 2, dots: waveDots, note: '5-column dotted equalizer' }
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  let outDir = path.join(__dirname, '..', 'miniprogram', 'assets', 'icons');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) outDir = path.resolve(args[++i]);
    else throw new Error('unknown argument ' + args[i]);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const report = [];
  let totalBytes = 0;
  for (const id of IDS) {
    const style = RENDER[id];
    for (const theme of ['light', 'dark']) {
      const surface = new Surface();
      const frames = [];
      for (let f = 0; f < FRAMES; f++) {
        const u = f / FRAMES;
        surface.clear();
        for (const d of style.dots(u)) surface.dot(d.x, d.y, d.r, d.a);
        frames.push(surface.toIndices(style.tones));
      }
      const buf = buildGif(frames, theme);
      const file = path.join(outDir, 'proc-icon-' + id + '-' + theme + '.gif');
      fs.writeFileSync(file, buf);
      const check = verifyGif(file, theme, frames);
      totalBytes += check.bytes;
      report.push({ id, theme, bytes: check.bytes, tones: style.tones, note: style.note });
      const state = check.bytes <= MAX_BYTES ? 'OK  ' : 'OVER';
      console.log(
        id.padEnd(6),
        theme.padEnd(5),
        String(check.bytes).padStart(6) + ' B',
        state,
        String(style.tones) + ' tones',
        '|', check.frames, 'frames', check.duration + ' ms',
        '| verified'
      );
    }
  }
  console.log('total:', totalBytes, 'B (', (totalBytes / 1024).toFixed(1), 'KB /', MAX_TOTAL_BYTES / 1024, 'KB cap )');
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('total bytes over cap');
  for (const r of report) if (r.bytes > MAX_BYTES) throw new Error(r.id + '-' + r.theme + ' over per-file cap');
}

if (require.main === module) main();
module.exports = { SIZE, FRAMES, TOTAL_MS, THEMES, IDS, buildGif, parseGif, lzwEncode, lzwDecode, Surface, RENDER };
