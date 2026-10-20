const fs = require('node:fs');
const path = require('node:path');
const cases = `    // Keep live file declarations equivalent to durable history.
    case 'workspace/changes':
      return Object.assign(base, { event: { type: event.type, turn: d.turn } })
    case 'deliverables/presented':
      return Object.assign(base, { event: { type: event.type, turn: d.turn, callId: d.callId,
        files: (Array.isArray(d.files) ? d.files : []).filter(file => file && typeof file.path === 'string').map(file => ({
          path: file.path, ...(typeof file.description === 'string' ? { description: file.description } : {}),
        })),
      } })
`;
function transform(source) {
  const start = source.indexOf('function buildWireEvent(session, event) {');
  const end = source.indexOf('function parseWireImages(', start);
  if (start < 0 || end < 0) throw Error('Unsupported gateway event encoder; nothing changed');
  const block = source.slice(start, end);
  if (block.includes(cases)) return source;
  const anchor = "    case 'turn/start':";
  if (block.split(anchor).length !== 2 || /case ['"](?:deliverables\/presented|workspace\/changes)['"]/.test(block)) {
    throw Error('Existing or incompatible file event handling; inspect before updating');
  }
  return source.slice(0, start) + block.replace(anchor, cases + anchor) + source.slice(end);
}
function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway package');
  const target = path.join(root, 'lib/index.mjs');
  const original = fs.readFileSync(target, 'utf8'), updated = transform(original);
  if (checkOnly) return { compatible: true, changes: Number(original !== updated) };
  if (original === updated) return { updated: 0, restartRequired: false };
  const backup = target + '.before-live-files-' + Date.now();
  fs.writeFileSync(backup, original, { flag: 'wx' });
  try { fs.writeFileSync(target, updated); } catch (error) { fs.writeFileSync(target, original); throw error; }
  return { updated: 1, restartRequired: true, backup };
}
if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { transform, install };
