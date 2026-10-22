'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createManagedRegistry, enforceManagedAccess } = require('../gateway/managed-devices.cjs');
const { patchGateway } = require('../gateway/install.cjs');
const { DAY, DURATIONS } = require('../durations.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-managed-expiry-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'new-folder/policy.json'); let time = Date.now();
  const codes = new Map(), devices = new Map();
  const base = {
    createPairing() { const p = { id: crypto.randomUUID(), code: crypto.randomBytes(32).toString('base64url'), expiresAt: time + 300000 }; codes.set(p.code, p); return p; },
    claimPairing(code, clientId) { const p = codes.get(code); if (!p || p.expiresAt <= time) return; codes.delete(code); let device = [...devices.values()].find(d => d.clientId === clientId); if (!device) { device = { id: p.id, clientId }; devices.set(p.id, device); } device.token = crypto.randomBytes(32).toString('base64url'); return { device, token: device.token }; },
    authenticate(token) { return [...devices.values()].find(d => d.token === token); },
    connected(id) { return devices.has(id); }, revoke(id) { return devices.delete(id); }
  };
  const create = () => createManagedRegistry(base, file, () => time);
  return { create, base, file, advance(ms) { time += ms; }, now: () => time };
}
test('all five durations enforce expiration across reconnects and active sockets without long timeout overflow', t => {
  const f = fixture(t), registry = f.create();
  for (const duration of DURATIONS) {
    const p = registry.createPairing(undefined, { id: crypto.randomUUID(), days: duration.days });
    assert.equal(p.accessExpiresAt, f.now() + duration.days * DAY);
    const claimed = registry.claimPairing(p.code, 'client-' + duration.days);
    assert.ok(registry.authenticate(claimed.token));
    if (duration.days === 365) {
      f.advance(364 * DAY); assert.ok(registry.authenticate(claimed.token));
      f.advance(DAY); assert.equal(registry.authenticate(claimed.token), undefined);
      assert.equal(registry.connected(claimed.device.id), false);
      const actions = []; enforceManagedAccess(registry, [{ deviceId: claimed.device.id, close: (...args) => actions.push(args[0]), terminate: () => actions.push('terminated') }]);
      assert.deepEqual(actions, [4003, 'terminated']);
    }
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});
test('restart retains active expiry and invalidates unclaimed codes without storing tokens', t => {
  const f = fixture(t), registry = f.create();
  const p = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 3 });
  const claimed = registry.claimPairing(p.code, 'client-one');
  const pending = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 7 });
  const disk = fs.readFileSync(f.file, 'utf8'); assert.equal(disk.includes(p.code), false); assert.equal(disk.includes(claimed.token), false);
  const restarted = f.create(); assert.ok(restarted.authenticate(claimed.token));
  assert.equal(restarted.managedPairings().find(r => r.id === pending.managedPairingId).status, 'expired');
  assert.equal(restarted.claimPairing(pending.code, 'stale-client'), undefined, 'Restarted wrapper must never treat a managed code as unrestricted');
  f.advance(3 * DAY); assert.equal(restarted.authenticate(claimed.token), undefined);
  assert.equal(restarted.managedPairings().find(r => r.id === p.managedPairingId).status, 'expired');
});
test('revocation blocks unused codes, revokes active credentials and does not cancel newer re-pairings', t => {
  const f = fixture(t), registry = f.create();
  const pending = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 3 });
  registry.revokeManaged(pending.managedPairingId); assert.equal(registry.claimPairing(pending.code, 'one'), undefined);
  const first = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 7 });
  registry.claimPairing(first.code, 'shared');
  const second = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 30 });
  const active = registry.claimPairing(second.code, 'shared');
  registry.revokeManaged(first.managedPairingId); assert.ok(registry.authenticate(active.token));
  registry.revokeManaged(second.managedPairingId); assert.equal(registry.authenticate(active.token), undefined);
});
test('legacy devices remain valid and malformed policies or state fail closed', t => {
  const f = fixture(t), registry = f.create();
  const p = registry.createPairing(); const claimed = registry.claimPairing(p.code, 'legacy');
  f.advance(366 * DAY); assert.ok(registry.authenticate(claimed.token));
  assert.throws(() => registry.createPairing(undefined, { id: crypto.randomUUID(), days: 90 }));
  const id = crypto.randomUUID(); registry.createPairing(undefined, { id, days: 180 });
  assert.throws(() => registry.createPairing(undefined, { id, days: 180 }));
  fs.writeFileSync(f.file, '{broken'); assert.throws(() => f.create(), /refusing to bypass/);
  assert.throws(() => patchGateway('unsupported gateway version'), /Unsupported/);
});
test('legacy re-pairing cannot bypass an existing expired managed device policy', t => {
  const f = fixture(t), registry = f.create();
  const managed = registry.createPairing(undefined, { id: crypto.randomUUID(), days: 3 });
  registry.claimPairing(managed.code, 'managed-client');
  f.advance(3 * DAY);
  const legacy = registry.createPairing();
  assert.equal(registry.claimPairing(legacy.code, 'managed-client'), undefined);
});
