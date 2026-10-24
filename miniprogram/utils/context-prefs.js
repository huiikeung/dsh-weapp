// dsh-context 的 per-user 上下文偏好（趋势粒度/模式/耗时曲线、对比基线、文件活动排序）。
// 只影响新打开的上下文面板；与 context-panels-pref（标签页显隐）分开保存。
const KEY = 'dsh_context_prefs';
const DEFAULTS = { trendGroupBy: 'step', trendDisplayMode: 'total', trendShowDuration: true, fileSort: 'count', base: 'step' };
const GROUP_BY = ['step', 'turn'];
const MODES = ['total', 'delta'];
const FILE_SORTS = ['count', 'lines', 'latest', 'path', 'name'];

function normalize(value) {
  const source = value !== null && typeof value === 'object' ? value : {};
  return {
    trendGroupBy: GROUP_BY.indexOf(source.trendGroupBy) >= 0 ? source.trendGroupBy : DEFAULTS.trendGroupBy,
    trendDisplayMode: MODES.indexOf(source.trendDisplayMode) >= 0 ? source.trendDisplayMode : DEFAULTS.trendDisplayMode,
    trendShowDuration: typeof source.trendShowDuration === 'boolean' ? source.trendShowDuration : DEFAULTS.trendShowDuration,
    fileSort: FILE_SORTS.indexOf(source.fileSort) >= 0 ? source.fileSort : DEFAULTS.fileSort,
    base: source.base === 'turn' ? 'turn' : DEFAULTS.base
  };
}

function read() {
  try { return normalize(wx.getStorageSync(KEY)); } catch (_) { return Object.assign({}, DEFAULTS); }
}

function set(patch) {
  const merged = normalize(Object.assign(read(), patch !== null && typeof patch === 'object' ? patch : {}));
  wx.setStorageSync(KEY, merged);
  return merged;
}

module.exports = { KEY, DEFAULTS, normalize, read, set };
