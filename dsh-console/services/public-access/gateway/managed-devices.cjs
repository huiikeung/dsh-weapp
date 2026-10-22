'use strict';
// Wrap the existing DSH registry without reading or exposing its tokens.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { DAY, validDays } = require('../durations.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function createManagedRegistry(base, file, now = Date.now) {
  let state = { version: 1, records: {} };
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (state.version !== 1 || !state.records || Array.isArray(state.records)) throw new Error('Invalid managed access state');
    for (const [id, r] of Object.entries(state.records)) if (!uuid.test(id) || !validDays(r.days) || !Number.isSafeInteger(r.accessExpiresAt) || !Number.isSafeInteger(r.expiresAt) || !['pending', 'active', 'expired', 'revoked', 'superseded'].includes(r.status) || (r.status === 'active' && !uuid.test(r.deviceId))) throw new Error('Invalid managed access record');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read managed access state; refusing to bypass expiry'); }
  // Digests are safe to persist and stop a stale base registry from accepting
  // a revoked/restarted managed code as an unrestricted legacy pairing.
  const pending = new Map(Object.values(state.records).filter(r => r.codeHash).map(r => [r.codeHash, r.id]));
  function save(change) {
    const next = JSON.parse(JSON.stringify(state)); change(next);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(next), { flag: 'wx', mode: 0o600 });
      const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file); state = next;
    } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }
  // Original pairing credentials are memory-only; never revive them after restart.
  if (Object.values(state.records).some(r => r.status === 'pending')) save(s => { for (const r of Object.values(s.records)) if (r.status === 'pending') r.status = 'expired'; });
  const alive = r => r.status === 'active' && r.accessExpiresAt > now();
  function isAllowed(deviceId) {
    const records = Object.values(state.records).filter(r => r.deviceId === deviceId && r.status !== 'superseded');
    return records.length === 0 || records.some(alive);
  }
  function managedPairings() {
    const time = now();
    return Object.values(state.records).map(r => ({ id: r.id, status: r.status === 'active' && r.accessExpiresAt <= time || r.status === 'pending' && r.expiresAt <= time ? 'expired' : r.status,
      days: r.days, expiresAt: r.expiresAt, accessExpiresAt: r.accessExpiresAt, deviceId: r.deviceId || null }));
  }
  return { ...base, isAllowed, managedPairings,
    createPairing(name, policy) {
      if (!policy) return base.createPairing(name);
      if (!validDays(policy.days) || !uuid.test(policy.id || '')) throw new TypeError('Invalid managed pairing duration or request ID');
      if (state.records[policy.id]) throw new TypeError('Pairing request already handled');
      if (Object.keys(state.records).length >= 10000) throw new TypeError('Managed pairing history is full; archive before issuing more');
      const pairing = base.createPairing(name), accessExpiresAt = now() + policy.days * DAY;
      const codeHash = hash(pairing.code);
      save(s => { s.records[policy.id] = { id: policy.id, days: policy.days, expiresAt: pairing.expiresAt, accessExpiresAt, status: 'pending', deviceId: null, codeHash }; });
      pending.set(codeHash, policy.id);
      return { ...pairing, managedPairingId: policy.id, accessDays: policy.days, accessExpiresAt };
    },
    claimPairing(code, clientId, name) {
      const key = typeof code === 'string' ? hash(code) : '', id = pending.get(key);
      if (!id) {
        const claimed = base.claimPairing(code, clientId, name);
        if (claimed && !isAllowed(claimed.device.id)) { base.revoke(claimed.device.id); return undefined; }
        return claimed;
      }
      const record = state.records[id];
      if (record.status !== 'pending' || record.expiresAt <= now() || record.accessExpiresAt <= now()) return undefined;
      const claimed = base.claimPairing(code, clientId, name);
      if (!claimed) return undefined;
      pending.delete(key);
      try {
        save(s => {
          for (const r of Object.values(s.records)) if (r.deviceId === claimed.device.id && r.id !== id) r.status = 'superseded';
          Object.assign(s.records[id], { status: 'active', deviceId: claimed.device.id });
        });
      } catch (error) { base.revoke(claimed.device.id); throw error; }
      return { ...claimed, device: { ...claimed.device, accessExpiresAt: record.accessExpiresAt } };
    },
    authenticate(...args) { const device = base.authenticate(...args); return device && isAllowed(device.id) ? device : undefined; },
    connected(id) { return isAllowed(id) && base.connected(id); },
    revokeManaged(id) {
      const record = state.records[id];
      if (!record) return false;
      save(s => { s.records[id].status = 'revoked'; });
      // Do not revoke a device that has since paired under a newer grant.
      if (record.deviceId && !isAllowed(record.deviceId)) base.revoke(record.deviceId);
      return true;
    },
    revoke(id) {
      save(s => { for (const r of Object.values(s.records)) if (r.deviceId === id && r.status === 'active') r.status = 'revoked'; });
      return base.revoke(id);
    }
  };
}
function enforceManagedAccess(registry, clients) {
  for (const client of clients) if (client.deviceId && !registry.isAllowed(client.deviceId)) {
    client.close(4003, 'access-expired-or-revoked');
    client.terminate();
  }
}
module.exports = { createManagedRegistry, enforceManagedAccess };
