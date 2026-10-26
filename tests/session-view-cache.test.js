const test = require('node:test');
const assert = require('node:assert/strict');
const cache = require('../miniprogram/utils/session-view-cache');

test('inactive views are count and byte bounded and old epochs cannot repopulate them', () => {
  cache.clear();
  const epoch = cache.generation();
  for (let i = 0; i < 8; i++) cache.put(String(i), { text: String(i) }, epoch);
  assert.equal(cache.stats().entries, cache.MAX_ENTRIES);
  assert.equal(cache.take('0'), null);
  assert.equal(cache.take('7').text, '7');
  assert.equal(cache.take('7'), null, 'ownership transfers to the active page');
  cache.put('huge', { text: 'x'.repeat(cache.MAX_BYTES) }, epoch);
  assert.equal(cache.take('huge'), null);
  assert.ok(cache.stats().estimatedBytes <= cache.MAX_BYTES);
  cache.clear(); cache.put('late', {}, epoch);
  assert.equal(cache.stats().entries, 0);
});

test('cyclic shared references are bounded without JSON serialization', () => {
  cache.clear(); const value = { text: 'hello' }; value.self = value;
  cache.put('cycle', value, cache.generation());
  assert.equal(cache.take('cycle'), value);
});

test('maps from another execution realm count toward the byte budget', () => {
  cache.clear();
  const map = require('node:vm').runInNewContext('new Map([["huge", "x".repeat(7000000)]])');
  cache.put('foreign', { projected: map }, cache.generation());
  assert.equal(cache.take('foreign'), null);
});
