#!/usr/bin/env node
// Generates the crisp whale-dot layers for the home ocean background.
//
// Source: miniprogram/utils/ocean-particles.js, produced by
// scripts/generate-ocean-mask.cjs from the native HeroWhaleMask (MIT, see
// THIRD_PARTY_NOTICES.md). Each entry is [x, y, luminance, edge, phase, light]
// with x/y normalised inside the native 60x60 sampling square.
//
// Two files are emitted so the tail can be animated independently in CSS
// without masks or duplicated pixels:
//   whale-body.svg : dots left of x = 0.55 of the square (static + shimmer)
//   whale-tail.svg : dots right of x = 0.55 (skewY sway + shimmer)
// The split is exactly between two particle columns (lattice positions are odd
// integers in the 120 unit space, the seam is 66), so no dot is cut in half.
//
// The drawing math mirrors dsh-mobile's HarnessWhaleField
// (DeepSeekHarnessMobile/Components/HarnessAnimatedBackground.swift):
//   dot side (pt) = max(1.45, S / 220) * (0.72 + luminance * 0.58)
//   alpha         = clamp(0.10 + luminance * 0.38, 0, 1)
//   colour        = (0.73 + 0.15 * light, 0.79 + 0.12 * light, 0.92 + 0.08 * light)
// where S is the whale square side. The component stretches the assets over a
// 115vw x 115vw box, i.e. S = 115vw, so the dot side relative to the square is
// device independent: (60/220) * (0.72 + luminance * 0.58) units of the 60
// unit square. The component also applies opacity 0.56 + mix-blend-mode: screen,
// so the assets carry only the per-dot alpha, never the layer opacity.
//
// Size accounting (WeChat caps packaged images/audio at 200 KiB total):
//   - viewBox space is 120 units: every particle centre sits on a half unit of
//     the 60 unit square ((i + 0.5) / 60), which is an exact odd integer there,
//     so positions are lossless and need no decimals.
//   - dots in one luminance bucket share alpha + side, so they are drawn as one
//     <path>: "M45 67h.02" is a 0.02 unit stub with a round cap, i.e. a ~0.45 unit
//     capsule centred on the integer lattice point. One command per dot keeps the
//     stream at ~10 bytes/dot; the round cap matches the native 18% rounded-rect
//     dot better than a butt-capped square. ("--variant=square" still emits the
//     butt-capped squares, for comparison only.)
//   - width/height are the device pixel size of the layer on a 390pt phone
//     (390 * 1.15 * 3dpr = 1345.5 -> 1344 for the full square). Some runtimes
//     rasterise an SVG image at its intrinsic size before scaling; naming the
//     device size keeps that path crisp. Consumers override the size from CSS.
//   - luminance is bucketed (24 bands) which quantises alpha to ~0.013 and the
//     dot side to ~0.01 unit (~0.1 device pixel at DPR 3), far below the
//     per-dot alpha noise of the native renderer.
//
// Usage:
//   node scripts/generate-ocean-whale-asset.cjs            # write both shipped layers
//   node scripts/generate-ocean-whale-asset.cjs --check    # fail if either is stale
//   node scripts/generate-ocean-whale-asset.cjs --variant=square --out=preview/whale-asset/whale-dots-square.svg
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PARTICLES = path.join(ROOT, 'miniprogram/utils/ocean-particles.js');
const OUT_DIR = path.join(ROOT, 'miniprogram/assets/ocean');
const FILES = [
  { key: 'body', file: path.join(OUT_DIR, 'whale-body.svg'), minX: 0 },
  { key: 'tail', file: path.join(OUT_DIR, 'whale-tail.svg'), minX: 66 }
];
const FULL_MAX_X = 120;

// Native constants (HarnessWhaleField).
const MASK_THRESHOLD = 0.2;      // WhaleParticleMask::makeParticles luminance gate
const SIZE_BASE = 60 / 220;      // max(1.45, S/220) in units of the 60 unit square
const SIZE_LUM_GAIN = 0.58;
const SIZE_MIN = 0.72;
const ALPHA_BASE = 0.10;
const ALPHA_LUM_GAIN = 0.38;
const RED_BASE = 0.73, RED_LIGHT = 0.15;
const GREEN_BASE = 0.79, GREEN_LIGHT = 0.12;
const BLUE_BASE = 0.92, BLUE_LIGHT = 0.08;

// Encoding knobs.
const UNITS = 120;               // 2x the 60 unit square -> exact half unit lattice
const BUCKETS = 24;              // luminance bands (alpha step ~0.013)
const SIZE_DECIMALS = 2;         // dot side quantisation in 120 unit space
// Native dots are rounded rects (18% corner radius). "square" keeps the full
// sharp square the brief calls for; "round" swaps the butt cap for a round cap
// on a 0.02 unit stub, producing a capsule/circle that is closer to the
// SwiftUI rounded rect at the cost of a slightly softer edge.
const VARIANTS = {
  round: { linecap: 'round', stub: 0.02, decimals: SIZE_DECIMALS },
  square: { linecap: 'butt', stub: 0, decimals: SIZE_DECIMALS }
};
const DEFAULT_VARIANT = 'round';
// 115vw x 3dpr on a 390pt phone -> the intrinsic (device) size of the full layer.
const INTRINSIC_SIZE = 1344;

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);
const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
// Shortest SVG-safe number: no leading zero, no trailing zeros.
const num = (value, digits) => String(round(value, digits)).replace(/^(-?)0\./, '$1.');
const hex = value => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');

function arg(name) {
  const prefix = '--' + name + '=';
  const match = process.argv.slice(2).find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : '';
}

function collect() {
  const particles = require(PARTICLES);
  if (!Array.isArray(particles) || !particles.length) throw new Error('No whale particles found');
  const step = (1 - MASK_THRESHOLD) / BUCKETS;
  const buckets = new Map();
  let sumRed = 0, sumGreen = 0, sumBlue = 0, sumWeight = 0;
  for (const [x, y, luminance, edge, phase, light] of particles) {
    const lum = clamp01(luminance);
    const boundedLight = clamp01(light);
    const alpha = clamp01(ALPHA_BASE + lum * ALPHA_LUM_GAIN);
    const side = SIZE_BASE * (SIZE_MIN + lum * SIZE_LUM_GAIN) * (UNITS / 60);
    sumRed += (RED_BASE + RED_LIGHT * boundedLight) * alpha;
    sumGreen += (GREEN_BASE + GREEN_LIGHT * boundedLight) * alpha;
    sumBlue += (BLUE_BASE + BLUE_LIGHT * boundedLight) * alpha;
    sumWeight += alpha;
    const band = Math.min(BUCKETS - 1, Math.max(0, Math.floor((lum - MASK_THRESHOLD) / step)));
    let bucket = buckets.get(band);
    if (!bucket) buckets.set(band, (bucket = { band, alphaSum: 0, sideSum: 0, dots: [] }));
    bucket.alphaSum += alpha;
    bucket.sideSum += side;
    // Exact half-unit lattice positions: (i + 0.5) / 60 * 120 = 2i + 1.
    bucket.dots.push([Math.round(x * UNITS), Math.round(y * UNITS)]);
  }
  const bands = [...buckets.values()].sort((a, b) => b.band - a.band);
  for (const bucket of bands) {
    bucket.alpha = bucket.alphaSum / bucket.dots.length;
    bucket.side = round(bucket.sideSum / bucket.dots.length, SIZE_DECIMALS);
    bucket.dots.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  }
  // Alpha weighted so the brightest dots dominate the tint, like the native
  // per-dot colour does: light only shifts the dots between warm and cool by
  // +-0.05 per channel, which is below one JPEG/AA step once screened.
  return {
    bands,
    count: particles.length,
    colour: '#' + hex(sumRed / sumWeight) + hex(sumGreen / sumWeight) + hex(sumBlue / sumWeight)
  };
}

// Builds one SVG for the x range [minX, maxX) of the 120 unit square.
function build({ bands, count, colour }, variantName, minX, maxX) {
  const variant = VARIANTS[variantName];
  if (!variant) throw new Error('Unknown variant: ' + variantName);
  const stub = variant.stub ? 'h' + num(variant.stub, variant.decimals) : '';
  const visible = bands
    .map(bucket => ({ ...bucket, dots: bucket.dots.filter(([x]) => x >= minX && x < maxX) }))
    .filter(bucket => bucket.dots.length);
  const body = visible.map(bucket => {
    const w = num(bucket.side, variant.decimals);
    // Butt caps need a segment as long as the dot; round caps only need a stub,
    // the caps themselves supply the width.
    const segment = stub || 'h' + w;
    const parts = [];
    for (const [x, y] of bucket.dots) parts.push('M' + x + ' ' + y + segment);
    // A butt-capped stroke starts at the left edge, so the bucket shifts it by
    // half a dot to centre it on the lattice point; round caps already centre.
    const transform = variant.stub ? '' : ' transform="translate(' + num(-bucket.side / 2, variant.decimals) + ')"';
    return '<path' + transform + ' stroke-width="' + w +
      '" stroke-opacity="' + num(bucket.alpha, variant.decimals) + '" d="' + parts.join('') + '"/>';
  });
  const widthUnits = maxX - minX;
  const intrinsicWidth = Math.round(INTRINSIC_SIZE * widthUnits / UNITS);
  const range = minX === 0 && maxX === UNITS ? 'the full square' : 'x ' + minX + '-' + maxX + ' of ' + UNITS;
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + minX + ' 0 ' + widthUnits + ' ' + UNITS +
    '" width="' + intrinsicWidth + '" height="' + INTRINSIC_SIZE + '" fill="none" stroke="' + colour +
    '" stroke-linecap="' + variant.linecap + '">\n' +
    '<!-- Generated by scripts/generate-ocean-whale-asset.cjs from miniprogram/utils/ocean-particles.js.\n' +
    '     ' + body.reduce((sum, path) => sum + (path.match(/M/g) || []).length, 0) + ' of ' + count +
    ' dots, ' + range + ', native HarnessWhaleField geometry.\n' +
    '     Layer opacity/blend and per-layer CSS motion are applied by the component. -->\n' +
    body.join('\n') + '\n</svg>\n';
}

function main() {
  const variantName = arg('variant') || DEFAULT_VARIANT;
  const out = arg('out');
  const data = collect();
  const args = process.argv.slice(2);
  if (out) {
    const target = path.resolve(ROOT, out);
    const svg = build(data, variantName, 0, FULL_MAX_X);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, svg);
    console.log(JSON.stringify({ file: path.relative(ROOT, target), variant: variantName, bytes: Buffer.byteLength(svg), dots: data.count, sha256: crypto.createHash('sha256').update(svg).digest('hex').slice(0, 16) }, null, 2));
    return;
  }
  const outputs = FILES.map(({ key, file, minX }) => ({
    key,
    file,
    svg: build(data, variantName, minX, minX === 0 ? FILES[1].minX : FULL_MAX_X)
  }));
  if (args.includes('--check')) {
    let stale = false;
    for (const output of outputs) {
      const current = fs.existsSync(output.file) ? fs.readFileSync(output.file, 'utf8') : '';
      if (current !== output.svg) {
        console.error(path.relative(ROOT, output.file) + ' is stale; run node scripts/generate-ocean-whale-asset.cjs');
        stale = true;
      }
    }
    if (stale) { process.exitCode = 1; return; }
    console.log('up to date: ' + outputs.map(output => path.relative(ROOT, output.file) + ' ' + Buffer.byteLength(output.svg) + ' B').join(', '));
    return;
  }
  if (fs.existsSync(path.join(OUT_DIR, 'whale-dots.svg'))) fs.unlinkSync(path.join(OUT_DIR, 'whale-dots.svg'));
  for (const output of outputs) {
    fs.mkdirSync(path.dirname(output.file), { recursive: true });
    fs.writeFileSync(output.file, output.svg);
    console.log(JSON.stringify({
      file: path.relative(ROOT, output.file),
      variant: variantName,
      bytes: Buffer.byteLength(output.svg),
      sha256: crypto.createHash('sha256').update(output.svg).digest('hex').slice(0, 16)
    }));
  }
}

main();
