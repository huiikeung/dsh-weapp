// Installs the cost meter bridge into a deployed dsh-plugin-weapp-gateway package.
// The standalone bridge folds the host session logs directly (no dependency on a
// host-side costMeter service) and serves the mobile wire as
// { type:'cost-meter', action, ... } -> { kind:'cost-meter', action, summary }.
// Restart DSH after installing so the gateway loads the patched module.
// Usage: node scripts/install-cost-meter-bridge.cjs <absolute gateway package> [--check]
const fs = require('node:fs');
const path = require('node:path');

function once(source, before, after) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw Error('Unsupported gateway source; nothing changed: ' + before.slice(0, 80));
  return source.replace(before, after);
}

function normalizeLineEndings(str) {
  return str.replace(/\r\n/g, '\n');
}

function transform(source) {
  source = normalizeLineEndings(source);

  // 1. Add import for cost meter bridge
  source = once(source,
    "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'",
    "import { handleWorkspaceChanges, WORKSPACE_CHANGES_TYPES } from './workspace-changes-bridge.mjs'\nimport { handleCostMeter, COST_METER_REQUEST_TYPES } from './cost-meter-bridge.mjs'");

  // 2. Add cost meter handler in the message routing (after clawbot-control check)
  source = once(source,
    "  if (msg.type === 'clawbot-control') return handleClawbotControl(pluginContext?.clawbotService, msg)",
    "  if (msg.type === 'clawbot-control') return handleClawbotControl(pluginContext?.clawbotService, msg)\n  if (COST_METER_REQUEST_TYPES.has(msg.type)) return handleCostMeter(api, msg)");

  // 3. (removed) No external costMeter service injection: the standalone bridge
  //    folds host session logs itself, so no ctx.inject(['costMeter']) is added.

  // 4. Add COST_METER_REQUEST_TYPES to the request type check
  source = once(source,
    "ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {",
    "ACCOUNT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type)) {");

  // 5. Add cost-meter check to deviceId requirement
  source = once(source,
    "if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {",
    "if ((ACCOUNT_REQUEST_TYPES.has(msg.type) || COST_METER_REQUEST_TYPES.has(msg.type) || WORKSPACE_CHANGES_TYPES.has(msg.type) || CONTEXT_REQUEST_TYPES.has(msg.type) || PLUGIN_REQUEST_TYPES.has(msg.type) || msg.type === 'clawbot-control') && !ws.deviceId) {");

  // 6. Advertise capability unconditionally (the bridge is standalone)
  source = once(source,
    "...(api.workspaceChanges ? ['workspace-changes-v1'] : []),\n              ...(api.account ? ['account-v1'] : []),",
    "...(api.workspaceChanges ? ['workspace-changes-v1'] : []),\n              ...(api.account ? ['account-v1'] : []),\n              'cost-meter-v1',");

  return source;
}

function install(root, checkOnly = false) {
  if (!root || !path.isAbsolute(root)) throw Error('An absolute gateway package directory is required');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!['dsh-plugin-weapp-gateway', 'dsh-plugin-mobile-gateway'].includes(manifest.name)) throw Error('Unsupported gateway');
  const index = path.join(root, 'lib/index.mjs'), bridge = path.join(root, 'lib/cost-meter-bridge.mjs');
  const original = fs.readFileSync(index, 'utf8'), updated = transform(original);
  const previousBridge = fs.existsSync(bridge) ? fs.readFileSync(bridge, 'utf8') : null;
  const nextBridge = fs.readFileSync(path.join(__dirname, 'lib/cost-meter-bridge.mjs'), 'utf8');
  const changes = (original !== updated ? 1 : 0) + (previousBridge !== nextBridge ? 1 : 0);
  if (checkOnly) return { compatible: true, changes };
  if (!changes) return { updated: 0, restartRequired: false };
  const stamp = Date.now();
  fs.writeFileSync(index + '.before-cost-meter-' + stamp, original, { flag: 'wx' });
  if (previousBridge !== null) fs.writeFileSync(bridge + '.before-cost-meter-' + stamp, previousBridge, { flag: 'wx' });
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