const desktop = require('./assets/plugin-artwork/desktop/manifest');
// 缺图标的插件用 DSH 客户端同款默认彩色图标（蓝点方块），与试验性插件同一套视觉。
const PLUGIN_DEFAULT = '/assets/plugin-artwork/desktop/plugin-default.svg';
function artworkFor(name, row = false) {
  return desktop[name] || PLUGIN_DEFAULT;
}
function imageSource(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('https://') || ['svg+xml', 'png', 'jpeg', 'webp', 'gif'].some(type => lower.startsWith('data:image/' + type + ';')) || value.startsWith('/assets/')) return value;
  return null;
}
module.exports = { artworkFor, imageSource };
