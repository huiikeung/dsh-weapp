'use strict';
// Explicit opt-in deployment helper. Does not restart DSH or modify credentials.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MARKER = '// whale-managed-pairing-v1';
function patchGateway(source) {
  if (source.includes(MARKER)) return source;
  function replace(before, after) {
    if (source.split(before).length !== 2) throw new Error('Unsupported gateway source; expected one matching lifecycle anchor');
    source = source.replace(before, after);
  }
  replace("import devicesModule from './devices.js'", "import devicesModule from './devices.js'\nimport managedAccessModule from './managed-access/gateway/managed-devices.cjs'\n" + MARKER);
  replace('const registry = createRegistry(deviceFile, { pairingTtlMs: options.pairingTtlMs })', 'const registry = managedAccessModule.createManagedRegistry(createRegistry(deviceFile, { pairingTtlMs: options.pairingTtlMs }), deviceFile + ".managed-access.json")');
  replace('const clients = new Set()', 'const clients = new Set()\n    const managedExpiryTimer = setInterval(() => managedAccessModule.enforceManagedAccess(registry, clients), 1000)\n    managedExpiryTimer.unref?.()');
  replace('pairingTtlMs: options.pairingTtlMs,', 'pairingTtlMs: options.pairingTtlMs,\n              managedPairingVersion: 1,');
  replace("} else if (req.method === 'POST' && p === '/mgw/pair') {", "} else if (req.method === 'GET' && p === '/mgw/managed-pairings') {\n            sendJson(res, 200, { items: registry.managedPairings() })\n          } else if (req.method === 'POST' && p.startsWith('/mgw/managed-pairings/') && p.endsWith('/revoke') && p.split('/').length === 5) {\n            await readBody(req)\n            const revoked = registry.revokeManaged(p.split('/')[3])\n            managedAccessModule.enforceManagedAccess(registry, clients)\n            sendJson(res, revoked ? 200 : 404, { revoked })\n          } else if (req.method === 'POST' && p === '/mgw/pair') {");
  replace('const pairing = registry.createPairing()', 'const pairing = registry.createPairing(undefined, body.managedAccess)');
  replace('gatewayUrl: advertisedGatewayUrl,', 'gatewayUrl: advertisedGatewayUrl,\n                ...(pairing.managedPairingId ? { managedPairingId: pairing.managedPairingId, accessDays: pairing.accessDays, accessExpiresAt: pairing.accessExpiresAt } : {}),');
  replace('if ((requireAuth || transport.lan === true) && !device) {', "if ((requireAuth || transport.lan === true || relayState.pairingMode === 'relay') && !device) {");
  replace('wss.handleUpgrade(req, socket, head, (ws) => {', "if (credential && !device) { rejectUpgrade(socket, 401, 'invalid or expired device credential'); return }\n        wss.handleUpgrade(req, socket, head, (ws) => {");
  replace("ws.on('message', (data) => {", "ws.on('message', (data) => {\n            if (ws.deviceId && !registry.isAllowed(ws.deviceId)) { ws.terminate(); return }");
  replace('clearInterval(fileTransferExpiryTimer)', 'clearInterval(fileTransferExpiryTimer)\n      clearInterval(managedExpiryTimer)');
  return source;
}
function install(root) {
  if (!root || !path.isAbsolute(root)) throw new Error('Pass the absolute dsh-plugin-weapp-gateway directory');
  const target = path.join(root, 'lib/index.mjs');
  const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (packageInfo.name !== 'dsh-plugin-weapp-gateway') throw new Error('Target is not the DSH miniapp gateway');
  const source = fs.readFileSync(target, 'utf8'), output = patchGateway(source);
  if (output === source) { console.log('Managed pairing extension already installed; no changes'); return; }
  // Validate every anchor before modifying any installed file.
  const backup = target + '.before-managed-access-' + crypto.randomUUID();
  fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  const folder = path.join(root, 'lib/managed-access/gateway');
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'managed-devices.cjs'), path.join(folder, 'managed-devices.cjs'));
  fs.copyFileSync(path.join(__dirname, '../durations.cjs'), path.join(folder, '../durations.cjs'));
  const temp = target + '.managed-' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, output, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
  fs.renameSync(temp, target);
  console.log('Managed pairing extension installed. Original entrypoint backup: ' + backup);
  console.log('Restart DSH only after active conversations finish. Existing devices and credentials were not changed.');
}
if (require.main === module) { try { install(process.argv[2]); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { patchGateway, install };
