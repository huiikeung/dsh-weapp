const { t: uiText } = require('./ui-preferences');
// Execution icon styles for the running process head.
// terra/morph reference TerraWork thinking-orbs (MIT); see docs/licenses/thinking-orbs.txt.
// This module never changes process titles, steps, timing, or gateway settings.
const KEY = 'procIconStyle';
const OPTIONS = [
  { id: 'cells', label: uiText('格子'), detail: uiText('方形四格依次闪动 · 默认'), file: '' },
  { id: 'terra', label: uiText('思考球'), detail: uiText('点阵球体旋转 · 参考 TerraWork'), file: 'proc-icon-terra' },
  { id: 'morph', label: uiText('变形方'), detail: uiText('圆 · 三角 · 方形的点阵变形'), file: 'proc-icon-morph' },
  { id: 'grid', label: uiText('点阵'), detail: uiText('九宫格呼吸脉冲'), file: 'proc-icon-grid' },
  { id: 'orbit', label: uiText('轨道'), detail: uiText('光点沿方形轨道环绕'), file: 'proc-icon-orbit' },
  { id: 'ripple', label: uiText('波纹'), detail: uiText('方形波纹向外扩散'), file: 'proc-icon-ripple' },
  { id: 'wave', label: uiText('声波'), detail: uiText('等宽声波起伏'), file: 'proc-icon-wave' }
];
function normalize(id) { return OPTIONS.some(item => item.id === id) ? id : 'cells'; }
function read() { try { return normalize(wx.getStorageSync(KEY)); } catch (_) { return 'cells'; } }
function save(id) { const value = normalize(id); wx.setStorageSync(KEY, value); return value; }
function selected(id) { return OPTIONS.find(item => item.id === normalize(id)); }
function view(id) {
  const item = selected(id);
  return { procIconStyle: item.id, procIconLabel: uiText(item.label), procIconFile: item.file };
}
function choices() { return OPTIONS.map(item => ({ ...item, label: uiText(item.label), detail: uiText(item.detail) })); }
module.exports = { KEY, OPTIONS, normalize, read, save, selected, view, choices };
