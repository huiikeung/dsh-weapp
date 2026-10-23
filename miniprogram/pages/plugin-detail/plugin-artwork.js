const desktop = require('./assets/plugin-artwork/desktop/manifest');
const builtins = {
  shell: '/assets/icons/dsh-bash.svg',
  'agent-loop': '/assets/icons/dsh-agent.svg',
  subagent: '/assets/icons/dsh-team.svg',
  'web-search': '/assets/icons/dsh-search.svg'
};
function artworkFor(name, row = false) {
  return desktop[name] || builtins[name] || (row ? builtins.subagent : '/assets/icons/dsh-plugin.svg');
}
function imageSource(value) {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('https://') || ['svg+xml', 'png', 'jpeg', 'webp', 'gif'].some(type => lower.startsWith('data:image/' + type + ';')) || value.startsWith('/assets/')) return value;
  return null;
}
module.exports = { artworkFor, imageSource };
