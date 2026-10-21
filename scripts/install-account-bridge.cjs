// Installs the account bridge into a deployed dsh-plugin-weapp-gateway package.
// The bridge proxies the Host's DeepSeek account projection (accountController)
// to the mobile wire as { type:'account' } -> { kind:'account', state, profile, balance }.
// Restart DSH after installing so the gateway loads the patched module.
// Usage: node scripts/install-account-bridge.cjs <absolute gateway package> [--check]
const fs = require('node:fs');
const path = require('node:path');

function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Unsupported gateway source; nothing changed: ' + before.slice(0, 80));
  return source.replace(before, after);
}

function transform(source) {
  source = once(source,
    "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'",
    "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'\nimport { handleAccount, ACCOUNT_REQUEST_TYPES } from './account-bridge.mjs'");
  source = once(source,
    '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)',
    '  if (WORKSPACE_CHANGES_TYPES.has(msg.type)) return handleWorkspaceChanges(api, msg)\n  if (ACCOUNT_REQUEST_TYPES.has(msg.type)) return handleAccount(api, msg)');
  source = once(source,
    '    const api = createDshHostAdapter(ctx.typertGateway)',
    '    const api = createDshHostAdapter(ctx.typertGateway)\n' +
    '    // Optional lifecycle-bound service: hosts without the DeepSeek account bundle keep working.\n' +
    "    ctx.inject(['accountController'], accountCtx => {\n" +
    '      api.account = accountCtx.accountController\n' +
    '      accountCtx.effect(() => () => { api.account = undefined })\n' +
    '    })');
  source = once(source,
    '                       WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {',
    '                       ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {');
  source = once(source,
    "              if ((WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {",
    "              if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {");
  source = once(source,
    "              ...(api.workspaceChanges ? ['workspace-changes-v1'] : []),",
    "              ...(api.workspaceChanges ? ['workspace-changes-v1'] : []),\n              ...(api.account ? ['account-v1'] : []),");
  return source;
}

function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway');
  const index = path.join(root, 'lib/index.mjs'), bridge = path.join(root, 'lib/account-bridge.mjs');
  const original = fs.readFileSync(index, 'utf8'), updated = transform(original);
  const previousBridge = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : null;
  const nextBridge = fs.readFileSync(path.join(__dirname, 'lib/account-bridge.mjs'), 'utf8');
  const changes = (original !== updated ? 1 : 0) + (previousBridge !== nextBridge ? 1 : 0);
  if (checkOnly) return { compatible: true, changes };
  if (!changes) return { updated: 0, restartRequired: false };
  const stamp = Date.now();
  fs.writeFileSync(index + '.before-account-' + stamp, original, { flag: 'wx' });
  if (previousBridge !== null) fs.writeFileSync(bridge + '.before-account-' + stamp, previousBridge, { flag: 'wx' });
  try { fs.writeFileSync(bridge, nextBridge); fs.writeFileSync(index, updated); }
  catch (error) {
    fs.writeFileSync(index, original);
    if (previousBridge !== null) fs.writeFileSync(bridge, previousBridge); else if (fs.existsSync(bridge)) fs.unlinkSync(bridge);
    throw error;
  }
  return { updated: changes, restartRequired: true };
}

if (require.main === module) {
  try { console.log(JSON.stringify(install(process.argv[2], process.argv.includes('--check')))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { transform, install };
