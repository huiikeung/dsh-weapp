const fs = require('node:fs');
const path = require('node:path');
function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Unsupported gateway source; nothing changed: ' + before.slice(0, 80));
  return source.replace(before, after);
}
function transform(source) {
  source = once(source, "import { handlePluginQuery, PLUGIN_REQUEST_TYPES } from './plugin-management.mjs'",
    "import { handlePluginQuery, PLUGIN_REQUEST_TYPES } from './plugin-management.mjs'\nimport { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'");
  source = once(source, '  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)',
    '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)\n  if (PLUGIN_REQUEST_TYPES.has(msg.type)) return handlePluginQuery(api, msg, pluginContext)');
  source = once(source, '    const api = createDshHostAdapter(ctx.typertGateway)',
    "    const api = createDshHostAdapter(ctx.typertGateway)\n    // Optional lifecycle-bound service: old hosts retain all existing gateway features.\n    ctx.inject(['workspaceChanges'], changesCtx => {\n      api.workspaceChanges = changesCtx.workspaceChanges\n      changesCtx.effect(() => () => { api.workspaceChanges = undefined })\n    })");
  source = once(source, '                       PLUGIN_REQUEST_TYPES.has(msg.type)) {',
    '                       WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {');
  source = once(source, '              if (PLUGIN_REQUEST_TYPES.has(msg.type) && !ws.deviceId) {',
    '              if ((WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) && !ws.deviceId) {');
  source = once(source, "              ...(options.fileDownloadsEnabled ? ['file-downloads'] : []),",
    "              ...(options.fileDownloadsEnabled ? ['file-downloads'] : []),\n              ...(api.workspaceChanges ? ['workspace-changes-v1'] : []),");
  return source;
}
function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway');
  const index = path.join(root, 'lib/index.mjs'), bridge = path.join(root, 'lib/workspace-changes-bridge.mjs');
  const original = fs.readFileSync(index, 'utf8'), updated = transform(original);
  const previousBridge = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : null;
  const nextBridge = fs.readFileSync(path.join(__dirname, 'lib/workspace-changes-bridge.mjs'), 'utf8');
  const changes = (original !== updated ? 1 : 0) + (previousBridge !== nextBridge ? 1 : 0);
  if (checkOnly) return { compatible: true, changes };
  if (!changes) return { updated: 0, restartRequired: false };
  const stamp = Date.now();
  fs.writeFileSync(index + '.before-workspace-changes-' + stamp, original, { flag: 'wx' });
  if (previousBridge !== null) fs.writeFileSync(bridge + '.before-workspace-changes-' + stamp, previousBridge, { flag: 'wx' });
  try { fs.writeFileSync(bridge, nextBridge); fs.writeFileSync(index, updated); }
  catch (error) { fs.writeFileSync(index, original); if (previousBridge !== null) fs.writeFileSync(bridge, previousBridge); else if (fs.existsSync(bridge)) fs.unlinkSync(bridge); throw error; }
  return { updated: changes, restartRequired: true };
}
if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { transform, install };
