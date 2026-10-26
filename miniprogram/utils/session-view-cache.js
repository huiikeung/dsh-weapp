// Inactive text projections only: never retain page instances or live requests.
const entries = new Map();
const MAX_ENTRIES = 4;
const MAX_BYTES = 6 * 1024 * 1024;
let bytes = 0;
let epoch = 0;

function estimate(value) {
  const seen = new Set(), pending = [value];
  let size = 0, visits = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++visits > 60000 || size > MAX_BYTES) return Infinity;
    if (typeof item === 'string') { size += item.length * 2 + 16; continue; }
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item); size += 64;
    if (Object.prototype.toString.call(item) === '[object Map]') item.forEach((v, k) => pending.push(k, v));
    else Object.keys(item).forEach(k => { size += k.length * 2 + 16; pending.push(item[k]); });
  }
  return size;
}

function remove(key) {
  const old = entries.get(key);
  if (old) bytes -= old.bytes;
  entries.delete(key);
}

function put(key, value, generation) {
  if (!key || generation !== epoch) return;
  remove(key);
  const cost = estimate(value);
  if (cost > MAX_BYTES) return;
  entries.set(key, { value, bytes: cost }); bytes += cost;
  while (entries.size > MAX_ENTRIES || bytes > MAX_BYTES) remove(entries.keys().next().value);
}

function take(key) {
  const hit = entries.get(key);
  remove(key);
  return hit ? hit.value : null;
}

function clear() { entries.clear(); bytes = 0; epoch += 1; }

module.exports = { put, take, clear, generation: () => epoch,
  stats: () => ({ entries: entries.size, estimatedBytes: bytes }), MAX_ENTRIES, MAX_BYTES };
