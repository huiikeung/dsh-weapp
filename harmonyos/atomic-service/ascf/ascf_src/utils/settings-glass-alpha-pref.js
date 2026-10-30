// 兼容旧引用：玻璃透明度现在同属 settings-glass-style-pref 的一组参数。
const stylePref = require('./settings-glass-style-pref');

const KEY = stylePref.KEY;
const DEFAULT = stylePref.DEFAULTS.alpha; // 4%（与顶部 10% 对应的基准值）
const MIN = stylePref.LIMITS.alpha[0];
const MAX = stylePref.LIMITS.alpha[1];

function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT;
  return Math.max(MIN, Math.min(MAX, Math.round(n)));
}

function read() { return stylePref.read().alpha; }

function set(value) {
  stylePref.set({ alpha: clamp(value) });
  return stylePref.read().alpha;
}

function view(value) {
  return stylePref.view(value === undefined ? undefined : { alpha: clamp(value) });
}

module.exports = { KEY, DEFAULT, MIN, MAX, read, set, view };
