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
  const touches = new Set();
  const warming = new Map();
  let touchTimer = null;

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

  function flushTouches() {
    touchTimer = null;
    if (!storage || !touches.size) return;
    try {
      const previous = readIndex();
      // Reads of memory-only entries must not create phantom disk entries.
      const recent = [...touches].reverse().filter(key => previous.includes(key));
      const index = recent.concat(previous.filter(key => !touches.has(key)));
      storage.setStorageSync(prefix + '.index', JSON.stringify(index));
    } catch (_error) { /* cache bookkeeping must not block rendering */ }
    touches.clear();
  }

  function touchDisk(key) {
    if (!storage) return;
    const fullKey = storageKey(key);
    touches.delete(fullKey); touches.add(fullKey);
    if (touchTimer === null) touchTimer = schedule(flushTouches, 500);
  }

  function decode(raw, normalize) {
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || (parsed.cacheVersion != null && parsed.cacheVersion !== version)) return null;
    const value = parsed.cacheVersion == null ? parsed : parsed.value;
    return normalize ? normalize(value) : value;
  }

  // Disk-only warm-up: no network, subscription or visible session mutation.
  function warm(key, normalize, isCurrent) {
    key = String(key);
    if (memory.has(key)) return Promise.resolve(true);
    if (!storage || typeof storage.getStorage !== 'function') return Promise.resolve(false);
    if (warming.has(key)) return warming.get(key).promise;
    const ticket = {};
    ticket.promise = new Promise(resolve => { ticket.resolve = resolve; });
    warming.set(key, ticket);
    const finish = raw => {
      let loaded = false;
      try {
        if (warming.get(key) === ticket && (!isCurrent || isCurrent())) {
          const value = decode(raw, normalize);
          if (value != null) { remember(key, value); loaded = true; }
        }
      } catch (_error) { /* malformed cache is a miss */ }
      if (warming.get(key) === ticket) warming.delete(key);
      ticket.resolve(loaded);
    };
    try { storage.getStorage({ key: storageKey(key), success: result => finish(result.data), fail: () => finish(null) }); }
    catch (_error) { finish(null); }
    return ticket.promise;
  }

  function cancelWarm(key) {
    const ticket = warming.get(key);
    if (ticket) { warming.delete(key); ticket.resolve(false); }
  }

  function get(key, normalize) {
    key = String(key);
    if (memory.has(key)) {
      const value = memory.get(key);
      remember(key, value);
      touchDisk(key);
      return value;
    }
    cancelWarm(key);
    if (!storage) return null;
    try {
      const raw = storage.getStorageSync(storageKey(key));
      const result = decode(raw, normalize);
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
      if (touchTimer !== null) { cancel(touchTimer); touchTimer = null; }
      flushTouches();
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
    cancelWarm(key);
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
    cancelWarm(key);
    touches.delete(storageKey(key));
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
    [...warming.keys()].forEach(cancelWarm);
    if (touchTimer !== null) cancel(touchTimer);
    touchTimer = null; touches.clear();
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

  return { get, warm, set, remove, clear, storageKey, memory };
}

module.exports = { createLocalCache, utf8ByteLength };
