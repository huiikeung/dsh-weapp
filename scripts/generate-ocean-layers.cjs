'use strict';
// Builds the static layers of the home ocean background, so the first painted
// frame already looks like the shader's t=0 field at device resolution:
//   resources/artwork/ocean/fluid-poster.jpg  - t=0 fluid field (WXSS base plate)
//   resources/artwork/ocean/grid-tile.svg     - 13-cell technical-grid square tile
// Both are inlined as base64 in components/ocean-background/ocean-background.wxss
// (same convention as the film-grain tile). Re-run this script and paste the two
// printed data URIs back into the WXSS when the shader or grid geometry changes.
//
// Usage: node scripts/generate-ocean-layers.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'resources', 'artwork', 'ocean');
const WIDTH = 390;
const HEIGHT = 844;
const POSTER_SCALE = 2;
const POSTER_QUALITY = 0.80;

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];
const browser = candidates.find(candidate => { try { fs.accessSync(candidate); return true; } catch (error) { return false; } });
if (!browser) throw new Error('no headless browser found; adapt the candidate list');

function shaderSource() {
  const source = fs.readFileSync(path.join(ROOT, 'miniprogram', 'utils', 'ocean-renderer.js'), 'utf8');
  const match = source.match(/const FRAGMENT = ([\x60'\"])([\s\S]*?)\1;/);
  if (!match) throw new Error('FRAGMENT not found in ocean-renderer.js');
  return match[2];
}

function renderPoster() {
  const fragment = shaderSource();
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#07182b}</style></head><body>' +
    '<pre id="out"></pre><script>' +
    'const FRAGMENT = ' + JSON.stringify(fragment) + ';' +
    'const VERTEX = \'attribute vec2 aPosition; void main(){ gl_Position=vec4(aPosition,0.0,1.0); }\';' +
    'function render(){' +
    '  const W = ' + WIDTH + ', H = ' + HEIGHT + ', S = ' + POSTER_SCALE + ';' +
    '  const canvas = document.createElement("canvas");' +
    '  canvas.width = W * S; canvas.height = H * S;' +
    '  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false });' +
    '  if (!gl) { document.getElementById("out").textContent = "ERROR:no-gl"; return; }' +
    '  function sh(type, source) { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }' +
    '  const p = gl.createProgram();' +
    '  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERTEX));' +
    '  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAGMENT));' +
    '  gl.linkProgram(p);' +
    '  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));' +
    '  gl.useProgram(p);' +
    '  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);' +
    '  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);' +
    '  const loc = gl.getAttribLocation(p, "aPosition"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);' +
    '  gl.uniform2f(gl.getUniformLocation(p, "uSize"), W, H);' +
    '  gl.uniform2f(gl.getUniformLocation(p, "uBufferSize"), canvas.width, canvas.height);' +
    '  gl.uniform1f(gl.getUniformLocation(p, "uTime"), 0);' +
    '  gl.viewport(0, 0, canvas.width, canvas.height);' +
    '  gl.drawArrays(gl.TRIANGLES, 0, 6);' +
    '  const out = document.createElement("canvas"); out.width = W; out.height = H;' +
    '  const ctx = out.getContext("2d");' +
    '  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";' +
    '  ctx.filter = "blur(0.35px)";' +
    '  ctx.drawImage(canvas, 0, 0, W, H);' +
    '  document.getElementById("out").textContent = out.toDataURL("image/jpeg", ' + POSTER_QUALITY + ');' +
    '}' +
    'try { render(); } catch (error) { document.getElementById("out").textContent = "ERROR:" + error.message; }' +
    '</scr' + 'ipt></body></html>';
  const page = path.join(os.tmpdir(), 'ocean-poster-gen.html');
  fs.writeFileSync(page, html);
  const dom = execFileSync(browser, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--dump-dom', 'file://' + page], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const match = dom.match(/data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/);
  if (!match) { const err = dom.match(/ERROR:[^<]*/); throw new Error('poster render failed: ' + (err ? err[0] : 'no data URI').slice(0, 300)); }
  return match[1];
}

function gridTile() {
  const SPACING = 42, CELLS = 13, SIZE = SPACING * CELLS, DOT = 2.2;
  const rects = [];
  for (let row = 0; row < CELLS; row += 1) {
    const column = (row * 4) % CELLS; // (row*11 + col*7) % 13 === 0
    const x = column * SPACING - DOT / 2, y = row * SPACING - DOT / 2;
    const xs = x < 0 ? [x, x + SIZE] : [x];
    const ys = y < 0 ? [y, y + SIZE] : [y];
    for (const px of xs) for (const py of ys) rects.push('<rect x="' + (+px.toFixed(2)) + '" y="' + (+py.toFixed(2)) + '" width="' + DOT + '" height="' + DOT + '"/>');
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SIZE + '" height="' + SIZE + '" viewBox="0 0 ' + SIZE + ' ' + SIZE + '"><g fill="#FFFFFF" fill-opacity="0.085">' + rects.join('') + '</g></svg>';
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const poster = renderPoster();
const posterBytes = Buffer.from(poster, 'base64');
fs.writeFileSync(path.join(OUT_DIR, 'fluid-poster.jpg'), posterBytes);
const tile = gridTile();
fs.writeFileSync(path.join(OUT_DIR, 'grid-tile.svg'), tile);
const tileBase64 = Buffer.from(tile, 'utf8').toString('base64');
console.log('fluid-poster.jpg ' + posterBytes.length + ' bytes (base64 ' + poster.length + ' chars)');
console.log('grid-tile.svg ' + tile.length + ' bytes (base64 ' + tileBase64.length + ' chars)');
fs.writeFileSync(path.join(OUT_DIR, 'layers.json'), JSON.stringify({ posterBase64: poster, gridTileBase64: tileBase64 }));
console.log('data URIs also saved to resources/artwork/ocean/layers.json');
console.log('POSTER_B64_START');
console.log(poster);
console.log('POSTER_B64_END');
console.log('GRID_B64_START');
console.log(tileBase64);
console.log('GRID_B64_END');
