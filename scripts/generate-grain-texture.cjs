'use strict';
// Deterministic 12x12 grayscale film-grain tile for the home background (base64 budget).
// The uploaded WXSS carries an inlined base64 copy; re-run and paste it there.
// The WebGL shader's own grain is lost to JPEG frame encoding, so the page
// layers this tile over the frames instead (see ocean-background.wxss).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 12;
const OUT = path.join(__dirname, '..', 'resources', 'artwork', 'ocean', 'grain.png');

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

// Deterministic xorshift32 so repeated runs produce the same asset.
let state = 0x9E3779B9;
function random() {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5; state >>>= 0;
  return state / 0x100000000;
}

const raw = Buffer.alloc((SIZE + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    // Mean 128 (overlay-blend neutral) with ~±34 spread.
    const value = Math.max(0, Math.min(255, Math.round(128 + (random() - 0.5) * 68)));
    raw[y * (SIZE + 1) + 1 + x] = value;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit grayscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log('grain texture ' + SIZE + 'x' + SIZE + ' · ' + png.length + ' bytes · base64 ' + png.toString('base64').length + ' chars');
