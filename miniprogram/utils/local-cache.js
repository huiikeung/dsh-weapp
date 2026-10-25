// Shared bounded L1/L2 cache for non-secret, UI-restorable data.
function utf8ByteLength(value) {
  const text = String(value);
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function createLocalCache(options) {
  const opts = options || {};
  const prefix = String(opts.prefix || 'dsh_cache');
  const version = Number(opts.version) || 1;
  const maxEntries = Math.max(1, Number(opts.maxEntries) || 20);
  const maxBytes = Math.max(1024, Number(opts.maxBytes) || 500000);
  const storage = opts.storage || (typeof wx !== 'undefined' ? wx : null);
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;
  const memory = new Map();
  const writes = new Map();

  function storageKey(key) {
    return prefix + '.' + encodeURIComponent(String(key));
  }

  function remember(key, value) {
    memory.delete(key);
    memory.set(key, value);
    while (memory.size > maxEntries) memory.delete(memory.keys().next().value);
  }

  function readIndex() {
    if (!storage) return [];
    try {
      let index = storage.getStorageSync(prefix + '.index') || [];
      if (typeof index === 'string') index = JSON.parse(index);
      return Array.isArray(index) ? index.filter(item => typeof item === 'string' && item.indexOf(prefix + '.') === 0) : [];
    } catch (_error) { return []; }
  }

  function touchDisk(key) {
    if (!storage) return;
    try {
      const fullKey = storageKey(key);
      const index = readIndex().filter(item => item !== fullKey);
      index.unshift(fullKey);
      storage.setStorageSync(prefix + '.index', JSON.stringify(index));
    } catch (_error) { /* cache bookkeeping must not block rendering */ }
  }

  function get(key, normalize) {
    key = String(key);
    if (memory.has(key)) {
      const value = memory.get(key);
      remember(key, value);
      touchDisk(key);
      return value;
    }
    if (!storage) return null;
    try {
      const raw = storage.getStorageSync(storageKey(key));
      if (!raw) return null;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // Raw objects are accepted for one-time migration from the previous cache format.
      if (!parsed || (parsed.cacheVersion != null && parsed.cacheVersion !== version)) return null;
      const value = parsed.cacheVersion == null ? parsed : parsed.value;
      const result = normalize ? normalize(value) : value;
      if (result == null) return null;
      remember(key, result);
      touchDisk(key);
      return result;
    } catch (_error) { return null; }
  }

  function persist(key, value, serialize) {
    writes.delete(key);
    if (!storage) return;
    try {
      const storedValue = serialize ? serialize(value) : value;
      const payload = JSON.stringify({ cacheVersion: version, savedAt: Date.now(), value: storedValue });
      if (utf8ByteLength(payload) > maxBytes) return;
      const fullKey = storageKey(key);
      storage.setStorageSync(fullKey, payload);
      const index = readIndex().filter(item => item !== fullKey);
      index.unshift(fullKey);
      while (index.length > maxEntries) {
        const evicted = index.pop();
        try { storage.removeStorageSync(evicted); } catch (_error) { /* best effort eviction */ }
      }
      storage.setStorageSync(prefix + '.index', JSON.stringify(index));
    } catch (_error) { /* storage failure must not block conversation updates */ }
  }

  function set(key, value, options) {
    key = String(key);
    const opts = options || {};
    remember(key, value);
    if (!storage) return;
    if (opts.immediate === true) {
      if (writes.has(key)) cancel(writes.get(key));
      writes.delete(key);
      persist(key, value, opts.serialize);
      return;
    }
    if (writes.has(key)) cancel(writes.get(key));
    writes.set(key, schedule(function () {
      persist(key, value, opts.serialize);
    }, Math.max(0, Number(opts.delayMs) || 0)));
  }

  function remove(key) {
    key = String(key);
    memory.delete(key);
    if (writes.has(key)) cancel(writes.get(key));
    writes.delete(key);
    if (!storage) return;
    try {
      const fullKey = storageKey(key);
      storage.removeStorageSync(fullKey);
      storage.setStorageSync(prefix + '.index', JSON.stringify(readIndex().filter(item => item !== fullKey)));
    } catch (_error) { /* best effort */ }
  }

  function clear() {
    writes.forEach(timer => cancel(timer));
    writes.clear();
    memory.clear();
    if (!storage) return;
    try {
      const keys = new Set(readIndex());
      if (typeof storage.getStorageInfoSync === 'function') {
        const info = storage.getStorageInfoSync();
        (info && info.keys || []).filter(key => key.indexOf(prefix + '.') === 0).forEach(key => keys.add(key));
      }
      keys.forEach(key => storage.removeStorageSync(key));
      storage.removeStorageSync(prefix + '.index');
    } catch (_error) { /* best effort */ }
  }

  return { get, set, remove, clear, storageKey, memory };
}

module.exports = { createLocalCache, utf8ByteLength };
