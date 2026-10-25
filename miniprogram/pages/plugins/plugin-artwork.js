const desktop = require('./assets/plugin-artwork/desktop/manifest');
// DSH PluginArtworkDefault, including its original 36px viewBox whitespace.
const PLUGIN_DEFAULT = '/assets/plugin-artwork/desktop/plugin-default.svg';
function artworkFor(name, row = false) {
  return desktop[name] || PLUGIN_DEFAULT;
}
function imageSource(value) {
  if (typeof value !== 'string') return null;
  if (/^\s*<svg[\s>]/i.test(value)) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(value.trim());
  const lower = value.toLowerCase();
  if (lower.startsWith('https://') || ['svg+xml', 'png', 'jpeg', 'webp', 'gif'].some(type => lower.startsWith('data:image/' + type + ';')) || value.startsWith('/assets/')) return value;
  return null;
}
module.exports = { artworkFor, imageSource };
