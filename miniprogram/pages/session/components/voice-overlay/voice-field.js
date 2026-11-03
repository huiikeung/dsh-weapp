// Deterministic 45 x 13 particle field from DSH iOS VoiceRipplePanel.swift.
const TAU = Math.PI * 2;
const seed = (index, salt) => { const value = Math.sin(index * 127.1 + salt) * 43758.5453; return value - Math.floor(value); };
function paletteInk(theme, cancel) {
  return theme === 'dark' ? (cancel ? [250,229,235] : [227,240,255]) : (cancel ? [100,36,52] : [23,60,101]);
}
function createField(width, height) {
  const pitch = Math.min(6.4, (width - 48) / 45);
  return Array.from({ length: 585 }, (_, i) => {
    const column = i % 45, edge = Math.sin(column / 44 * Math.PI);
    return { i, column, edge, row: (Math.floor(i / 45) / 12 - 0.5),
      x: 16 + seed(i, 1) * (width - 32), y: height * (0.16 + seed(i, 8) * 0.79),
      targetX: (width - pitch * 44) / 2 + column * pitch,
      sx: 0.16 + seed(i, 3) * 0.18, sy: 0.12 + seed(i, 4) * 0.16,
      dx: seed(i, 10) * TAU, dy: seed(i, 11) * TAU, phase: seed(i, 9) * TAU, freePhase: seed(i, 12) * TAU,
      radius: 0.7 + seed(i, 5) * 0.8, alpha: 0.12 + seed(i, 6) * 0.26,
      pulse: 0.30 + seed(i, 13) * 0.20, shimmer: 0.24 + seed(i, 14) * 0.18,
      waveRadius: 0.8 + edge * 0.5 + (seed(i, 5) - 0.5) * 0.12,
      waveAlpha: 0.26 + edge * 0.4 + (seed(i, 6) - 0.5) * 0.06 };
  });
}
function drawField(ctx, particles, levels, gathering, time, height) {
  const free = 1 - gathering;
  for (const p of particles) {
    const waveHeight = 5 + (levels[p.column] || 0) * 56 * (0.35 + 0.65 * p.edge);
    const driftX = Math.sin(time * p.sx + p.i) * 14 + Math.cos(time * 0.19 + p.dx) * 5;
    const driftY = Math.cos(time * p.sy + p.i) * 12 + Math.sin(time * 0.17 + p.dy) * 4;
    const x = (p.x + driftX) * free + p.targetX * gathering;
    const y = (p.y + driftY) * free + (height * 0.68 + p.row * waveHeight) * gathering;
    const radius = p.radius * (1 + Math.sin(time * p.pulse + p.freePhase) * 0.18) * free
      + p.waveRadius * (1 + Math.sin(time * Math.PI / 10 + p.phase) * 0.025) * gathering;
    ctx.globalAlpha = p.alpha * (0.72 + Math.cos(time * p.shimmer + p.freePhase * 1.7) * 0.28) * free
      + p.waveAlpha * (0.98 + Math.cos(time * Math.PI / 10 + p.phase * 1.7) * 0.02) * gathering;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
module.exports = { createField, drawField, paletteInk };
