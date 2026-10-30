// 对话卡片（任务 / 排队 / 目标）的外观参数：浅色、深色各存一套，互不影响。
// 浅色：悬浮 / 底色 / 顶部光线 / 柔光 / 描边 / 圆角；深色：悬浮 / 底色 / 描边 / 圆角。
const KEY = 'sessionCardStyleV2';
const LEGACY_KEY = 'sessionCardStyleV1';
const MODES = ['light', 'dark'];
const FIELDS = ['float', 'fill', 'light', 'glow', 'edge', 'radius'];
const LIMITS = { float: [0, 100], fill: [40, 100], light: [0, 60], glow: [0, 100], edge: [0, 80], radius: [20, 48] };
const DEFAULTS = {
  light: { float: 20, fill: 86, light: 20, glow: 50, edge: 38, radius: 36 },
  // 深色第一版磨砂：中性暗底 62%、细描边、无柔光
  dark: { float: 20, fill: 62, light: 20, glow: 0, edge: 38, radius: 36 }
};

function clampField(field, value, fallback) {
  const range = LIMITS[field];
  if (!range) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(range[0], Math.min(range[1], Math.round(n)));
}

function normalizeMode(mode, raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const base = DEFAULTS[mode] || DEFAULTS.light;
  const next = {};
  for (const field of FIELDS) next[field] = clampField(field, source[field], base[field]);
  return next;
}

function normalize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return { light: normalizeMode('light', source.light), dark: normalizeMode('dark', source.dark) };
}

function readStored(key) {
  try {
    let stored = wx.getStorageSync(key);
    if (typeof stored === 'string' && stored) stored = JSON.parse(stored);
    return stored && typeof stored === 'object' ? stored : null;
  } catch (_) { return null; }
}

function read() {
  const stored = readStored(KEY);
  if (stored) return normalize(stored);
  // 旧版只有一套参数：浅色沿用，深色把旧值搬到「悬浮 / 描边 / 圆角」，底色用深色默认
  const legacy = readStored(LEGACY_KEY);
  if (!legacy) return normalize(null);
  return normalize({
    light: legacy,
    dark: { float: legacy.float, edge: legacy.edge, radius: legacy.radius, fill: DEFAULTS.dark.fill, glow: 0 }
  });
}

function persist(all) {
  try { wx.setStorageSync(KEY, all); } catch (_) { /* 保持内存值 */ }
  return all;
}

/** 更新某一模式的参数；patch 只写传入字段，其余保持当前值。 */
function set(mode, patch) {
  const all = read();
  const target = MODES.indexOf(mode) >= 0 ? mode : 'light';
  all[target] = normalizeMode(target, Object.assign({}, all[target], patch || {}));
  return persist(all);
}

/** 重置某一模式；不传模式时两套一起重置。 */
function reset(mode) {
  const all = read();
  const targets = MODES.indexOf(mode) >= 0 ? [mode] : MODES;
  for (const target of targets) all[target] = normalizeMode(target, null);
  return persist(all);
}

/** 悬浮滑杆 -> CSS 阴影；0 表示完全不悬浮。factor 用于预览放大（真实卡片始终 1）。 */
function floatShadow(value, factor) {
  const n = clampField('float', value, DEFAULTS.light.float);
  if (!n) return '0 0 0 rgba(0, 0, 0, 0)';
  const k = Number(factor) > 0 ? Number(factor) : 1;
  const y = Math.round(n * 0.05 * k * 10) / 10;
  const blur = Math.round(n * 0.2 * k);
  const alpha = Math.min(0.32, Math.round(n * 0.00175 * k * 1000) / 1000);
  return '0 ' + y + 'rpx ' + blur + 'rpx rgba(7, 24, 43, ' + alpha + ')';
}

function previewOf(value) {
  const m = normalizeMode('light', value);
  return {
    cardEdgePreview: 'rgba(255, 255, 255, ' + Math.min(0.85, m.edge / 100 * 0.30 * 3).toFixed(2) + ')',
    cardFillPreview: 'rgba(126, 142, 168, ' + (0.10 + m.fill / 100 * 0.28).toFixed(2) + ')',
    cardGlowTopPreview: 'rgba(255, 255, 255, ' + Math.min(0.95, 0.30 + (m.light / 60) * 0.60).toFixed(2) + ')',
    cardGlowBottomPreview: 'rgba(255, 255, 255, ' + Math.min(0.95, m.glow / 100 * 0.70).toFixed(2) + ')',
    cardGlowAllPreview: 'rgba(255, 255, 255, ' + Math.min(0.9, m.glow / 100 * 0.60).toFixed(2) + ')',
    cardFloatPreview: floatShadow(m.float, 4)
  };
}

function modeVars(mode, s) {
  const isLight = mode === 'light';
  return {
    floatShadow: floatShadow(s.float),
    edgeColor: 'rgba(255, 255, 255, ' + (s.edge / 100 * 0.30).toFixed(3) + ')',
    fillAlpha: (s.fill / 100).toFixed(2),
    glowTop: (0.30 + (s.light / 60) * 0.60).toFixed(2),
    glowBottom: (s.glow / 100 * 0.70).toFixed(2),
    glowAll: (s.glow / 100 * 0.60).toFixed(2),
    radiusRpx: s.radius + 'rpx',
    isLight
  };
}

/**
 * 生成设置页 / 对话页需要的全部字段。
 * mode: 当前正在编辑的模式（默认浅色）；draft: 拖动中的临时值，只影响当前模式。
 */
function view(mode, draft) {
  const all = read();
  const activeMode = MODES.indexOf(mode) >= 0 ? mode : 'light';
  const draftMode = MODES.indexOf(draft && draft.mode) >= 0 ? draft.mode : activeMode;
  const draftPatch = draft && draft.patch ? draft.patch : null;
  const activeValues = normalizeMode(draftMode, Object.assign({}, all[draftMode], draftPatch || {}));
  const lightVars = modeVars('light', all.light);
  const darkVars = modeVars('dark', all.dark);
  const p = previewOf(activeValues);
  return {
    cardStyleMode: draftMode,
    // 当前模式的滑杆值
    cardFloat: activeValues.float,
    cardFill: activeValues.fill,
    cardLight: activeValues.light,
    cardGlow: activeValues.glow,
    cardEdge: activeValues.edge,
    cardRadius: activeValues.radius,
    // 当前模式的预览
    cardPreviewStyle: draftMode === 'light'
      ? 'background: ' + p.cardFillPreview + '; box-shadow: inset 0 6px 16px ' + p.cardGlowTopPreview
        + ', inset 0 -6px 16px ' + p.cardGlowBottomPreview + ', inset 0 0 22px ' + p.cardGlowAllPreview
        + ', inset 0 0 0 1px ' + p.cardEdgePreview + ', ' + p.cardFloatPreview + ';'
      : 'background: rgba(44, 45, 49, ' + (activeValues.fill / 100).toFixed(2) + '); box-shadow: inset 0 0 0 1px '
        + 'rgba(255, 255, 255, ' + (activeValues.edge / 100 * 0.30 * 3).toFixed(2) + '), ' + floatShadow(activeValues.float, 4) + ';',
    // 对话页：浅色 / 深色两套 CSS 变量
    cardLightFloatShadow: lightVars.floatShadow,
    cardLightEdgeColor: lightVars.edgeColor,
    cardLightFillAlpha: lightVars.fillAlpha,
    cardLightGlowTop: lightVars.glowTop,
    cardLightGlowBottom: lightVars.glowBottom,
    cardLightGlowAll: lightVars.glowAll,
    cardLightRadiusRpx: lightVars.radiusRpx,
    cardDarkFloatShadow: darkVars.floatShadow,
    cardDarkEdgeColor: darkVars.edgeColor,
    cardDarkFillAlpha: darkVars.fillAlpha,
    cardDarkRadiusRpx: darkVars.radiusRpx,
    cardRadiusRpx: lightVars.radiusRpx,
    cardFloatMin: LIMITS.float[0], cardFloatMax: LIMITS.float[1],
    cardFillMin: LIMITS.fill[0], cardFillMax: LIMITS.fill[1],
    cardLightMin: LIMITS.light[0], cardLightMax: LIMITS.light[1],
    cardGlowMin: LIMITS.glow[0], cardGlowMax: LIMITS.glow[1],
    cardEdgeMin: LIMITS.edge[0], cardEdgeMax: LIMITS.edge[1],
    cardRadiusMin: LIMITS.radius[0], cardRadiusMax: LIMITS.radius[1]
  };
}

module.exports = {
  KEY, LEGACY_KEY, DEFAULTS, LIMITS, MODES, FIELDS,
  read, set, reset, view, floatShadow, normalize, normalizeMode
};
