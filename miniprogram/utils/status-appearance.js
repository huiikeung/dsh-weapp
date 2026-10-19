const { t: uiText } = require('./ui-preferences');
// Color presets adapted from 01Virex/dsh-status-rotator (MIT).
// This module never changes phrases, elapsed time, or gateway settings.
const KEY = 'statusAppearance';
const OPTIONS = [
  { id: 'classic', label: uiText('经典流光'), detail: uiText('日夜自适应 · 彩虹渐变'), light: ['#d92b4b','#c2410c','#a16207','#15803d','#0e7490','#6d28d9','#be185d'], dark: ['#ff5f6d','#ffc371','#ffdd55','#7dff7d','#5fd4ff','#a78bfa','#ff8adb'], speed: 4 },
  { id: 'neon', label: uiText('霓虹'), detail: uiText('青紫粉渐变 · 柔和呼吸'), light: ['#0e7490','#7c3aed','#be185d'], dark: ['#22d3ee','#a78bfa','#f472b6'], speed: 3 },
  { id: 'terminal', label: uiText('终端'), detail: uiText('绿色流光 · 等宽字体'), light: ['#15803d','#166534'], dark: ['#4ade80','#86efac'], speed: 6 },
  { id: 'candy', label: uiText('糖果'), detail: uiText('暖色渐变 · 柔和呼吸'), light: ['#be123c','#b45309','#be185d'], dark: ['#fb7185','#fbbf24','#f472b6'], speed: 5 },
  { id: 'glitch', label: uiText('故障'), detail: uiText('红青流光 · 轻量错色'), light: ['#d92b4b','#0e7490'], dark: ['#ff5f6d','#5fd4ff'], speed: 2 },
  // DSH theme: label-deep-diving and label-deep-diving-shimmer, sRGB mixes.
  { id: 'original', label: uiText('简约'), detail: uiText('客户端默认配色 · 安静清晰'), light: ['rgb(52.4,93.7,186.2)','rgb(35.6,61.3,127.8)','rgb(52.4,93.7,186.2)'], dark: ['rgb(125.15,153.8,222.5)','rgb(138.25,187.55,253.7)','rgb(125.15,153.8,222.5)'], speed: 2.2 }
];
function normalize(id) { return OPTIONS.some(item => item.id === id) ? id : 'classic'; }
function read() { try { return normalize(wx.getStorageSync(KEY)); } catch (_) { return 'classic'; } }
function save(id) { const value = normalize(id); wx.setStorageSync(KEY, value); return value; }
function selected(id) { return OPTIONS.find(item => item.id === normalize(id)); }
function style(item, mode) {
  const colors = mode === 'dark' ? item.dark : item.light;
  return 'background-image:linear-gradient(90deg,' + colors.concat(colors[0]).join(',') + ');animation-duration:' + item.speed + 's;animation-direction:' + (['terminal','glitch'].includes(item.id) ? 'reverse' : 'normal') + ';';
}
function view(id) {
  const item = selected(id);
  return { statusAppearance: item.id, statusAppearanceLabel: uiText(item.label), statusLightStyle: style(item, 'light'), statusDarkStyle: style(item, 'dark') };
}
function choices() { return OPTIONS.map(item => ({ ...item, label: uiText(item.label), detail: uiText(item.detail), lightStyle: style(item, 'light'), darkStyle: style(item, 'dark') })); }
module.exports = { KEY, OPTIONS, normalize, read, save, selected, view, choices };
