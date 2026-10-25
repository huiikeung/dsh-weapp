const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = ['pages/session/session.wxss', 'pages/home/home.wxss', 'pages/session/session.wxml'];
function compact(source, file) {
  // Preserve quoted CSS data and literal template text.
  const stripped = file.endsWith('.wxss')
    ? source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g, token => token.startsWith('/*') ? ' ' : token)
    : source.replace(/<!--[\s\S]*?-->/g, '');
  return stripped.split('\n').map(line => file.endsWith('.wxss') ? line.trim() : line.replace(/^\s+(?=<)/, ''))
    .filter(line => line.trim()).join('\n') + '\n';
}
function build() {
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, 'resources/runtime-markup', file), 'utf8');
    const output = path.join(root, 'miniprogram', file);
    const content = compact(source, file);
    if (fs.readFileSync(output, 'utf8') !== content) fs.writeFileSync(output, content);
  }
}
if (require.main === module) build();
module.exports = { files, compact, build };
