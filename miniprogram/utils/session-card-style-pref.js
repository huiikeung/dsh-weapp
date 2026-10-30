// 对话卡片（任务 / 排队 / 目标）的外观参数：悬浮强度、顶部光线、环形描边、圆角。
// 与玻璃样式一样存成一条记录，页面读取 view() 得到可直接绑到 CSS 变量的值。
const KEY = 'sessionCardStyleV1';
const DEFAULTS = { float: 20, light: 20, edge: 38, radius: 36 };
const LIMITS = { float: [0, 100], light: [0, 60], edge: [0, 80], radius: [20, 48] };
const FIELDS = ['float', 'light', 'edge', 'radius'];

function clampField(field, value) {
  const range = LIMITS[field];
  if (!range) return DEFAULTS[field];
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS[field];
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

function reset() {
  return set(DEFAULTS);
}

/** 悬浮滑杆 -> CSS 阴影；0 表示完全不悬浮。 */
function floatShadow(value) {
  const n = clampField('float', value);
  if (!n) return '0 0 0 rgba(0, 0, 0, 0)';
  const y = Math.round(n * 0.05 * 10) / 10;
  const blur = Math.round(n * 0.2);
  const alpha = Math.round(n * 0.00175 * 1000) / 1000;
  return '0 ' + y + 'rpx ' + blur + 'rpx rgba(7, 24, 43, ' + alpha + ')';
}

/** 派生 CSS 变量：悬浮阴影、顶部光线、环形描边、圆角。 */
function view(style) {
  const s = normalize(style === undefined ? read() : Object.assign(read(), style));
  return {
    cardFloat: s.float,
    cardLight: s.light,
    cardEdge: s.edge,
    cardRadius: s.radius,
    cardFloatShadow: floatShadow(s.float),
    cardEdgeColor: 'rgba(255, 255, 255, ' + (s.edge / 100).toFixed(2) + ')',
    cardLightColor: 'rgba(255, 255, 255, ' + (s.light * 0.0025).toFixed(3) + ')',
    cardRadiusRpx: s.radius + 'rpx',
    cardFloatMin: LIMITS.float[0], cardFloatMax: LIMITS.float[1],
    cardLightMin: LIMITS.light[0], cardLightMax: LIMITS.light[1],
    cardEdgeMin: LIMITS.edge[0], cardEdgeMax: LIMITS.edge[1],
    cardRadiusMin: LIMITS.radius[0], cardRadiusMax: LIMITS.radius[1]
  };
}

module.exports = { KEY, DEFAULTS, LIMITS, read, set, reset, view, floatShadow, normalize };
