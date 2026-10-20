const desktop = require('./assets/plugin-artwork/desktop/manifest');
const prefix = '/pages/plugins/assets/plugin-artwork/';
const builtins = { shell: 'shell', 'agent-loop': 'agent-loop', subagent: 'subagent', 'web-search': 'web-search' };
function artworkFor(name, row = false) {
  return desktop[name] ? desktop[name].replace('/assets/plugin-artwork/', prefix) : prefix + (builtins[name] || (row ? 'subagent' : 'default')) + '.png';
}
function imageSource(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('https://') || ['svg+xml', 'png', 'jpeg', 'webp', 'gif'].some(type => lower.startsWith('data:image/' + type + ';')) || value.startsWith('/assets/')) return value;
  return null;
}
module.exports = { artworkFor, imageSource };
