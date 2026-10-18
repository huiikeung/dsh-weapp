'use strict';
// Explicit opt-in: reads installed SOURCE, never its state or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { install } = require('../gateway/install.cjs');
const { createManagedRegistry, enforceManagedAccess } = require('../gateway/managed-devices.cjs');
const source = process.env.DSH_GATEWAY_SOURCE;
test('installed gateway source accepts extension on a temporary copy and real registry enforces expiry', { skip: !source }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-gateway-compat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'lib'));
  for (const file of ['package.json', 'lib/index.mjs', 'lib/devices.js']) fs.copyFileSync(path.join(source, file), path.join(dir, file));
  const original = fs.readFileSync(path.join(source, 'lib/index.mjs'), 'utf8');
  install(dir);
  execFileSync(process.execPath, ['--check', path.join(dir, 'lib/index.mjs')]);
  const patched = fs.readFileSync(path.join(dir, 'lib/index.mjs'), 'utf8');
  assert.match(patched, /managedPairingVersion: 1/);
  assert.match(patched, /managedExpiryTimer/);
  install(dir); assert.equal(fs.readFileSync(path.join(dir, 'lib/index.mjs'), 'utf8'), patched);
  assert.equal(fs.readFileSync(path.join(source, 'lib/index.mjs'), 'utf8'), original, 'Never modify the installed source');
  const { createRegistry } = require(path.join(dir, 'lib/devices.js'));
  let time = Date.now(); const file = path.join(dir, 'fixture-devices.json'), policyFile = file + '.managed-access.json';
  let registry = createManagedRegistry(createRegistry(file), policyFile, () => time);
  const legacy = registry.claimPairing(registry.createPairing().code, 'legacy-client');
  for (const days of [3, 7, 30, 180, 365]) {
    time = Date.now();
    const p = registry.createPairing(undefined, { id: crypto.randomUUID(), days });
    const claimed = registry.claimPairing(p.code, 'managed-client-' + days);
    assert.ok(registry.authenticate(claimed.token));
    registry = createManagedRegistry(createRegistry(file), policyFile, () => time);
    assert.ok(registry.authenticate(claimed.token), 'Restart preserves active credential');
    time = p.accessExpiresAt; assert.equal(registry.authenticate(claimed.token), undefined);
    let terminated = false; enforceManagedAccess(registry, [{ deviceId: claimed.device.id, close() {}, terminate() { terminated = true; } }]);
    assert.equal(terminated, true);
  }
  assert.ok(registry.authenticate(legacy.token), 'Legacy devices retain existing behavior');
  time = Date.now();
  const p = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 7 });
  const claimed = registry.claimPairing(p.code, 'revoke-fixture'); registry.revokeManaged(p.managedPairingId);
  assert.equal(registry.authenticate(claimed.token), undefined);
});
