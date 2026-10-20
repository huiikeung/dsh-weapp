// Encodes the official contour frames as a compact fixed-size GIF.
// Usage: node scripts/generate-official-sway.cjs <alpha-index bytes> [side] [frames] [output directory]
// Source/license and rasterization details: docs/status-appearance.md.
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
const side = Number(process.argv[3] || 72), count = Number(process.argv[4] || 150);
const output = process.argv[5] || path.join(__dirname, '../miniprogram/assets/icons');
if (!input || !Number.isInteger(side) || side < 1 || !Number.isInteger(count) || count < 1) throw Error('Invalid input, frame size or frame count');
const pixels = fs.readFileSync(input), frameSize = side * side;
if (pixels.length !== frameSize * count) throw Error('Expected ' + count + ' full ' + side + 'px frames');
function lzw(input) {
  let dictionary, next, size;
  const reset = () => { dictionary = new Map(); next = 6; size = 3; };
  reset();
  const bytes = []; let bits = 0, buffer = 0;
  function emit(code) {
    buffer |= code << bits; bits += size;
    while (bits >= 8) { bytes.push(buffer & 255); buffer >>>= 8; bits -= 8; }
  }
  emit(4);
  let current = input[0];
  for (let i = 1; i < input.length; i++) {
    const value = input[i], key = current * 256 + value;
    if (dictionary.has(key)) { current = dictionary.get(key); continue; }
    emit(current);
    // Encoder adds an entry one code ahead of the GIF decoder.
    if (next >= (1 << size) && size < 12) size++;
    if (next < 4096) dictionary.set(key, next++);
    else { emit(4); reset(); }
    current = value;
  }
  emit(current);
  if (next >= (1 << size) && size < 12) size++;
  emit(5);
  if (bits) bytes.push(buffer & 255);
  const blocks = [Buffer.from([2])];
  for (let i = 0; i < bytes.length; i += 255) { const chunk = bytes.slice(i, i + 255); blocks.push(Buffer.from([chunk.length]), Buffer.from(chunk)); }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}
const word = n => [n & 255, n >> 8];
for (const [theme, color] of [['light',[87,101,184]], ['dark',[181,160,242]]]) {
  const blocks = [Buffer.from('GIF89a'), Buffer.from([...word(side),...word(side),0x80,0,0,0,0,0,...color]), Buffer.from([0x21,0xff,11]), Buffer.from('NETSCAPE2.0'), Buffer.from([3,1,0,0,0])];
  for (let i = 0; i < count; i++) {
    // Cumulative rounding preserves the upstream 4-second cycle exactly.
    const delay = Math.round((i + 1) * 400 / count) - Math.round(i * 400 / count);
    blocks.push(Buffer.from([0x21,0xf9,4,9,...word(delay),0,0,0x2c,0,0,0,0,...word(side),...word(side),0]));
    blocks.push(lzw(pixels.subarray(i * frameSize, (i + 1) * frameSize)));
  }
  blocks.push(Buffer.from([0x3b]));
  const result = Buffer.concat(blocks);
  fs.writeFileSync(path.join(output,'official-sway-' + theme + '.gif'), result);
  console.log(theme, result.length, 'bytes;', count, 'frames; 4000 ms');
}
