const { t: uiText } = require('../../../utils/ui-preferences');
// Execution icon styles for the running process head.
// terra/morph reference TerraWork thinking-orbs (MIT); see docs/licenses/thinking-orbs.txt.
// This module never changes process titles, steps, timing, or gateway settings.
const KEY = 'procIconStyle';
const DEFAULT = 'spin-ring';
const OPTIONS = [
  { id: 'spin-ring', label: uiText('旋转圆环'), detail: uiText('圆环缺口旋转 · 经典 spinner · 默认') },
  { id: 'cells', label: uiText('格子'), detail: uiText('方形四格依次闪动') },
  { id: 'terra', label: uiText('思考球'), detail: uiText('点阵球体旋转 · 参考 TerraWork') },
  { id: 'morph', label: uiText('变形方'), detail: uiText('圆 · 三角 · 方形的点阵变形') },
  { id: 'grid', label: uiText('点阵'), detail: uiText('九宫格呼吸脉冲') },
  { id: 'orbit', label: uiText('轨道'), detail: uiText('光点沿方形轨道环绕') },
  { id: 'ripple', label: uiText('波纹'), detail: uiText('方形波纹向外扩散') },
  { id: 'wave', label: uiText('声波'), detail: uiText('等宽声波起伏') },
  { id: 'pulse-ring', label: uiText('脉冲环'), detail: uiText('单个圆环放大淡出 · 最克制') },
  { id: 'breathe-bars', label: uiText('呼吸条'), detail: uiText('三根竖条正弦呼吸') },
  { id: 'spin-square', label: uiText('旋方'), detail: uiText('方框旋转并带一个角点') },
  { id: 'typing-dots', label: uiText('打字点'), detail: uiText('三点依次点亮 · 经典加载') },
  { id: 'scan-line', label: uiText('扫描线'), detail: uiText('方框内横线往返扫描') }
];
function normalize(id) { return OPTIONS.some(item => item.id === id) ? id : DEFAULT; }
function read() { try { return normalize(has.getStorageSync(KEY)); } catch (_) { return DEFAULT; } }
function save(id) { const value = normalize(id); has.setStorageSync(KEY, value); return value; }
function selected(id) { return OPTIONS.find(item => item.id === normalize(id)); }
function view(id) {
  const item = selected(id);
  return { procIconStyle: item.id, procIconLabel: uiText(item.label) };
}
function choices() { return OPTIONS.map(item => ({ ...item, label: uiText(item.label), detail: uiText(item.detail) })); }
module.exports = { KEY, OPTIONS, normalize, read, save, selected, view, choices };
