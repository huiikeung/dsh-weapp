// Build-time rasterization of upstream vector, not a runtime image download.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
async function main() {
  if (!process.argv[2]) throw new Error('Pass upstream HeroWhaleMask SVG path');
  const size = 60;
  const { data } = await sharp(process.argv[2], { density: 600 }).resize(size, size, { fit: 'contain', background: '#000000' }).flatten({ background: '#000000' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return 0;
    const i = (y * size + x) * 3;
    return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  };
  const particles = [];
  // Match CoreGraphics bottom-up backing row traversal; SVG coordinates stay upright.
  for (let y = size - 1; y >= 0; y--) for (let x = 0; x < size; x++) {
    const luminance = luma(x, y);
    if (luminance <= 0.2) continue;
    let neighbour = false, missing = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if ((dx || dy) && luma(x + dx, y + dy) > 0.2) neighbour = true;
    if (!neighbour) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && luma(x + dx, y + dy) <= 0.2) missing++;
    const nx = (x + 0.5) / size, ny = (y + 0.5) / size;
    particles.push([nx, ny, luminance, missing / 8, particles.length, Math.max(0, 1 - Math.hypot(nx - 0.3, ny - 0.28) / 0.92)].map(n => +n.toFixed(6)));
  }
  fs.writeFileSync(path.join(__dirname, '../miniprogram/utils/ocean-particles.js'), '// Generated from dsh-mobile HeroWhaleMask (MIT). See THIRD_PARTY_NOTICES.md.\nmodule.exports = ' + JSON.stringify(particles) + ';\n');
  console.log('Generated ' + particles.length + ' whale particles');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
