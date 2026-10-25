const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalCache, utf8ByteLength } = require('../miniprogram/utils/local-cache');

function fixture(options = {}) {
  const storage = new Map(), timers = new Map();
  let serial = 0;
  const cache = createLocalCache({ prefix: 'cache', version: 3, maxEntries: 2,
    storage: {
      getStorageSync: key => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: key => storage.delete(key)
    },
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout(id) { timers.delete(id); },
    ...options
  });
  return { cache, storage, flush() { [...timers.values()].forEach(fn => fn()); timers.clear(); } };
}

test('local cache debounces writes and shares bounded memory with persistent LRU', () => {
  const f = fixture();
  f.cache.set('a', { value: 1 }, { delayMs: 20 });
  f.cache.set('a', { value: 2 }, { delayMs: 20 });
  assert.equal(f.storage.size, 0);
  f.flush();
  assert.equal(f.cache.get('a').value, 2);

  f.cache.set('b', { value: 3 }); f.flush();
  f.cache.get('a');
  f.cache.set('c', { value: 4 }); f.flush();
  assert.equal(f.storage.has(f.cache.storageKey('a')), true, 'recently read entry stays in disk LRU');
  assert.equal(f.storage.has(f.cache.storageKey('b')), false, 'least recently used disk entry is evicted');
  assert.equal(f.cache.memory.size, 2);
});

test('cache validates versions, normalizes old raw entries, and clear cancels pending writes', () => {
  const f = fixture();
  f.storage.set(f.cache.storageKey('legacy'), JSON.stringify({ ok: true }));
  assert.equal(f.cache.get('legacy', value => value.ok ? value : null).ok, true);

  f.storage.set(f.cache.storageKey('stale'), JSON.stringify({ cacheVersion: 2, value: { ok: false } }));
  assert.equal(f.cache.get('stale'), null);

  f.cache.set('pending', { ok: true }, { delayMs: 10 });
  f.cache.clear(); f.flush();
  assert.equal(f.cache.memory.size, 0);
  assert.equal(f.storage.has(f.cache.storageKey('pending')), false);
});

test('persistent limits count UTF-8 bytes rather than JavaScript characters', () => {
  const f = fixture({ maxBytes: 1024 });
  const text = '消息🙂';
  assert.equal(utf8ByteLength(text), 10);
  f.cache.set('oversized', { text: '中'.repeat(600) }); f.flush();
  assert.equal(f.storage.has(f.cache.storageKey('oversized')), false);
});
