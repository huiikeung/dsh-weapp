// 玻璃 UI 的可调参数：透明度、模糊、亮边强度、圆角。
// 全部存在一条记录里，页面读取 view() 得到可直接绑到 CSS 变量的值。
// V4：滑杆数值保持 10% 起，但实际玻璃亮度按原来 4% 那档压暗（顶部 = 数值×0.4，底部再 ×0.4）。
const KEY = 'settingsGlassStyleV4';
const DEFAULTS = { alpha: 10, blur: 8, edge: 38, radius: 32, brightness: 100, native: 50 };
const LIMITS = { alpha: [4, 40], blur: [2, 24], edge: [10, 70], radius: [20, 40], brightness: [40, 160], native: [0, 100] };
const FIELDS = ['alpha', 'blur', 'edge', 'radius', 'brightness', 'native'];

function clampField(field, value) {
  const range = LIMITS[field];
  const n = Number(value);
  const fallback = DEFAULTS[field];
  if (!range) return fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(range[0], Math.min(range[1], Math.round(n)));
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const next = {};
  for (const field of FIELDS) next[field] = clampField(field, source[field]);
  return next;
}

function read() {
  let stored;
  try { stored = wx.getStorageSync(KEY); } catch (_) { stored = null; }
  if (typeof stored === 'string' && stored) {
    try { stored = JSON.parse(stored); } catch (_) { stored = null; }
  }
  return normalize(stored);
}

function set(patch) {
  const next = normalize(Object.assign(read(), patch));
  try { wx.setStorageSync(KEY, next); } catch (_) { /* 保持内存值 */ }
  return next;
}

/** 1rpx 实际像素：CSS 变量里的 rpx 不会被 WXSS 换算，模糊/圆角必须下发 px。 */
function rpxScale() {
  try {
    const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = info && info.windowWidth ? info.windowWidth : 375;
    return width / 750;
  } catch (_) {
    return 0.5;
  }
}

/** 原生背景亮度调色：50 = 主题默认，越小越暗、越大越亮。 */
function nativePalette(value, light) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const mix = (base, target, t) => base.map((c, i) => Math.round(c + (target[i] - c) * t));
  const rgb = (color) => 'rgb(' + color[0] + ', ' + color[1] + ', ' + color[2] + ')';
  const base = light ? [255, 255, 255] : [28, 28, 30];
  const bgBase = light ? [255, 255, 255] : [0, 0, 0];
  // 深色模式允许明显压暗；浅色模式只在白与浅灰之间变化，不会变暗成灰黑
  const darken = v < 50 ? (50 - v) / 50 * (light ? 0.13 : 0.55) : 0;
  const lighten = v > 50 ? (v - 50) / 50 * (light ? 0 : 0.30) : 0;
  const surface = lighten ? mix(base, [255, 255, 255], lighten) : mix(base, [0, 0, 0], darken);
  const bg = lighten ? mix(bgBase, [255, 255, 255], lighten * 0.8) : mix(bgBase, [0, 0, 0], darken * 0.8);
  const rawFill = light
    ? 0.05 + darken * 0.50
    : 0.06 + lighten * 0.16 - darken * 0.045;
  const fillAlpha = Math.max(0.01, Math.min(0.5, rawFill));
  const fill = light ? 'rgba(16, 19, 24, ' + fillAlpha.toFixed(3) + ')' : 'rgba(255, 255, 255, ' + fillAlpha.toFixed(3) + ')';
  return { surface: rgb(surface), bg: rgb(bg), fill };
}

function px(value, scale) {
  const v = Number((value * scale).toFixed(2));
  return (Number.isInteger(v) ? String(v) : String(v)) + 'px';
}

/** 派生 CSS 变量：滑杆 10% 对应原来 4% 那档亮度（顶部 0.04、底部 0.016），亮度滑杆再整体提亮/压暗。 */
function view(style) {
  const s = normalize(style === undefined ? read() : Object.assign(read(), style));
  const factor = s.brightness / 100;
  const scale = rpxScale();
  const topPct = s.alpha * 0.4 * factor;
  const bottomPct = topPct * 0.4;
  return {
    glassAlpha: s.alpha,
    glassBlur: s.blur,
    glassEdge: s.edge,
    glassRadius: s.radius,
    glassBrightness: s.brightness,
    glassAlphaTop: (topPct / 100).toFixed(3),
    glassAlphaBottom: (bottomPct / 100).toFixed(3),
    glassAlphaTopPct: Math.round(topPct * 10) / 10,
    glassAlphaBottomPct: Math.round(bottomPct * 10) / 10,
    glassEdgeAlpha: (s.edge / 100).toFixed(2),
    glassBlurSheet: px(s.blur, scale),
    glassBlurCard: px(Math.max(1, s.blur * 0.375), scale),
    glassRadiusSheet: px(s.radius, scale),
    glassRadiusCard: px(s.radius * 36 / 32, scale),
    glassRadiusChoice: px(s.radius * 2, scale),
    glassBackdropBrightness: factor.toFixed(2),
    nativeBgValue: s.native,
    ...(() => {
      const light = !!(style && style.light);
      const p = nativePalette(s.native, light);
      return { nativeSurfaceColor: p.surface, nativeBgColor: p.bg, nativeFillColor: p.fill };
    })(),
    /* 直接下发给玻璃样式弹窗的 inline style：不依赖 CSS 变量是否被 WebView 解析 */
    glassSurfaceStyle: [
      'background: linear-gradient(165deg, rgba(255, 255, 255, ' + (topPct / 100).toFixed(3) + '), rgba(255, 255, 255, ' + (bottomPct / 100).toFixed(3) + '));',
      'border: 1px solid rgba(255, 255, 255, ' + (s.edge / 100).toFixed(2) + ');',
      'border-radius: ' + px(s.radius, scale) + ';',
      'box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 ' + px(12, scale) + ' ' + px(48, scale) + ' rgba(3, 14, 30, 0.26);',
      'backdrop-filter: blur(' + px(s.blur, scale) + ') brightness(' + factor.toFixed(2) + ');',
      '-webkit-backdrop-filter: blur(' + px(s.blur, scale) + ') brightness(' + factor.toFixed(2) + ');'
    ].join(' ')
  };
}

/** 恢复默认参数。 */
function reset() {
  return set(DEFAULTS);
}

module.exports = { KEY, DEFAULTS, LIMITS, read, set, view, reset, nativePalette };
