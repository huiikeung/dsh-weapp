const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

function setup(files, stored) {
  const removed = [];
  const storage = Object.assign({}, stored);
  global.wx = {
    env: { USER_DATA_PATH: '/user' },
    getStorageInfoSync: () => ({ keys: Object.keys(storage), currentSize: 2, limitSize: 10240 }),
    getStorageSync: (key) => storage[key],
    removeStorageSync: (key) => { delete storage[key]; removed.push('storage:' + key); },
    getFileSystemManager: () => ({
      readdirSync: (dir) => Object.keys(files[dir] || {}),
      statSync: (path) => ({ size: lookup(files, path) }),
      unlink: (options) => { removed.push(options.filePath); delete lookupFile(files, options.filePath); options.complete && options.complete(); }
    })
  };
  function lookup(map, path) {
    const parts = path.split('/');
    const name = parts.pop();
    const dir = parts.join('/');
    return (map[dir] || {})[name] || 0;
  }
  function lookupFile(map, path) {
    const parts = path.split('/');
    const name = parts.pop();
    const dir = parts.join('/');
    if (map[dir]) delete map[dir][name];
  }
  return { removed, storage };
}

function fixture() {
  return {
    '/user': { 'dsh-file-abc': 200, 'dsh-file-xyz.part': 50, 'clawbot-login-1.png': 30, 'unrelated.txt': 999, 'dsh-file-def': 40 },
    '/user/dsh-attachment-cache': { 'img-1.jpg': 100 }
  };
}

const modulePath = path.join(__dirname, '..', 'miniprogram', 'pages', 'settings', 'utils', 'storage-usage.js');

test('collect aggregates the four local cache categories and the storage quota', () => {
  setup(fixture(), { 'dsh_session_cache.s1': '0123456789', 'dsh_home_cache.home': '01234',
    'dsh_context_cache.context': '12345678', 'dsh_history_page.page': '1234', 'dsh_other.pref': 'ignored' });
  delete require.cache[require.resolve(modulePath)];
  const storageUsage = require(modulePath);
  const usage = storageUsage.collect();
  const byKey = {};
  for (const cat of usage.categories) byKey[cat.key] = cat;
  assert.equal(byKey.chats.bytes, 27, 'session, home, context and paged history cache strings');
  assert.equal(byKey.images.bytes, 100);
  assert.equal(byKey.files.bytes, 240, 'dsh-file-* without .part');
  assert.equal(byKey.temporary.bytes, 80, '.part + clawbot leftovers');
  assert.equal(usage.totalBytes, 447);
  assert.equal(usage.totalText, '447 B');
  assert.ok(usage.gradient.includes('#3D7AC7'), 'chats segment in conic gradient');
  assert.equal(usage.storageText, '2 KB / 10 MB');
  assert.equal(storageUsage.formatBytes(0), '0 KB');
  assert.equal(storageUsage.formatBytes(1536), '1.5 KB');
  assert.equal(storageUsage.formatBytes(3 * 1024 * 1024), '3 MB');
});

test('clearCategory removes only the picked category and reports freed bytes', async () => {
  const files = fixture();
  const env = setup(files, {
    'dsh_session_cache.s1': '0123456789',
    'dsh_context_cache.context': '12345678',
    'dsh_history_page.page': '1234',
    'dsh_other.pref': 'kept'
  });
  delete require.cache[require.resolve(modulePath)];
  const storageUsage = require(modulePath);
  const freed = await storageUsage.clearCategory('chats');
  assert.equal(freed, 22);
  assert.ok(env.removed.includes('storage:dsh_session_cache.s1'));
  assert.ok(env.removed.includes('storage:dsh_context_cache.context'));
  assert.ok(env.removed.includes('storage:dsh_history_page.page'));
  assert.equal(env.storage['dsh_other.pref'], 'kept', 'unrelated keys survive');

  const freedFiles = await storageUsage.clearCategory('files');
  assert.equal(freedFiles, 240);
  assert.ok(env.removed.includes('/user/dsh-file-abc'));
  assert.ok(env.removed.includes('/user/dsh-file-def'));
  assert.ok(!env.removed.includes('/user/dsh-file-xyz.part'), '.part belongs to temporary');
  assert.ok(!env.removed.includes('/user/dsh-attachment-cache/img-1.jpg'), 'images untouched');
});
