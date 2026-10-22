'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const protocol = require('../miniprogram/utils/protocol');
const attachmentCache = require('../miniprogram/utils/attachment-cache');

const ROOT = '/tmp/dsh-attachment-page-test';
const CACHE_DIR = ROOT + '/dsh-attachment-cache';

function applyPatch(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined) return;
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let parent = data;
    parts.slice(0, -1).forEach((part, i) => {
      if (parent[part] == null) parent[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      parent = parent[part];
    });
    parent[parts.at(-1)] = JSON.parse(JSON.stringify(value));
  });
}

function fakeFileSystem(seed = {}) {
  const files = new Map(Object.entries(seed).map(([key, value]) => [key, Buffer.from(value)]));
  const fs = {
    mkdirSync() {},
    accessSync(target) {
      if (!files.has(target)) { const error = new Error('access:fail no such file'); error.errMsg = 'access:fail no such file'; throw error; }
    },
    writeFile(options) {
      files.set(options.filePath, options.encoding === 'base64' ? Buffer.from(options.data, 'base64') : options.data);
      options.success({});
    },
    copyFile(options) {
      if (!files.has(options.srcPath)) return options.fail({ errMsg: 'copyFile:fail no such file' });
      files.set(options.destPath, files.get(options.srcPath));
      options.success({});
    },
    unlink(options) { files.delete(options.filePath); options.success({}); }
  };
  return { files, fs };
}

function fixture(options = {}) {
  attachmentCache._reset();
  const disk = fakeFileSystem(options.seed);
  const previews = [], toasts = [];
  const requests = [];
  const wx = {
    env: { USER_DATA_PATH: ROOT },
    getFileSystemManager: () => disk.fs,
    nextTick: (fn) => fn(),
    previewImage: (opts) => previews.push(opts),
    showToast: (opts) => toasts.push(opts),
    showModal: () => {},
    createSelectorQuery: undefined
  };
  const store = {
    state: { connection: 'connected', sessions: [] },
    sessionState: { sessionId: 's1', rows: [], running: false },
    client: {
      requestAttachment(sessionId, attachmentId) {
        requests.push([sessionId, attachmentId]);
        if (options.reject) return Promise.reject(new Error('attachment failed'));
        return Promise.resolve({ kind: 'attachment', attachment: { attachmentId, mediaType: 'image/png', bytes: 2 }, data: Buffer.from('hi').toString('base64') });
      }
    },
    beginNativeOverlay() {}, endNativeOverlay() {}, nativeOverlayActive: () => false,
    setTrajectoryActive() {}, setContextActive() {}, setFleetActive() {},
    appendLocalUserRow() {}
  };
  let definition;
  const filename = path.join(__dirname, '../miniprogram/pages/session/session.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    Page: (value) => { definition = value; },
    Date, console, setTimeout, clearTimeout, setInterval, clearInterval,
    wx,
    require(name) {
      if (name.endsWith('/store')) return store;
      if (name.endsWith('/markdown')) return { parse: () => [] };
      return require(path.resolve(path.dirname(filename), name));
    }
  });
  const data = JSON.parse(JSON.stringify(definition.data));
  const patches = [];
  const page = Object.assign({}, definition, {
    _unloaded: false,
    data,
    setData(patch, callback) { patches.push(patch); applyPatch(data, patch); if (callback) callback(); },
    scheduleHistoryFormatting() {}, measureConversationWindow() {},
    syncRunningStrip() {}, updateDockInset() {}
  });
  return { page, store, wx, patches, previews, toasts, requests, disk };
}

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test('a history image in a visible row is fetched once and patched into images and stack copies', async () => {
  const f = fixture();
  f.page.data.rows = [{
    key: 'u-1', kind: 'user',
    images: [{ attachmentId: 'sha-1', mediaType: 'image/png' }],
    stackImages: [{ attachmentId: 'sha-1', mediaType: 'image/png', style: 'left:0rpx' }]
  }];
  f.page.collectAttachmentThumbs();
  await tick();
  const expected = CACHE_DIR + '/sha-1.png';
  assert.deepEqual(f.requests, [['s1', 'sha-1']]);
  assert.equal(f.page.data.rows[0].images[0].localUrl, expected);
  assert.equal(f.page.data.rows[0].stackImages[0].localUrl, expected);
  assert.ok(f.patches.some((patch) => Object.keys(patch).some((key) => key.startsWith('rows[0]'))));
  assert.deepEqual(f.disk.files.get(expected), Buffer.from('hi'));

  // 下一次渲染（例如重新进入会话）直接从缓存补路径，不再请求网关。
  const decorated = f.page.decorateRowImages([{ attachmentId: 'sha-1', mediaType: 'image/png' }]);
  assert.equal(decorated[0].localUrl, expected);
  assert.equal(f.requests.length, 1);
});

test('optimistic pending rows are skipped; the echoed server id adopts the temp file without a request', async () => {
  const temp = 'wxfile://tmp/selected-image.jpg';
  const f = fixture({ seed: { [temp]: 'local-bytes' } });
  f.page.data.rows = [{
    key: 'local-1', kind: 'user', pending: true,
    images: [{ attachmentId: 'client-uuid', mediaType: 'image/jpeg', localUrl: temp, tempPath: temp }]
  }];
  f.page.collectAttachmentThumbs();
  await tick();
  assert.deepEqual(f.requests, [], 'never cache the optimistic row under a client-side id');

  f.page.data.rows = [{
    key: 'u-2', kind: 'user',
    images: [{ attachmentId: 'sha-2', mediaType: 'image/jpeg', localUrl: temp, tempPath: temp }]
  }];
  f.page.collectAttachmentThumbs();
  await tick();
  const expected = CACHE_DIR + '/sha-2.jpg';
  assert.deepEqual(f.requests, [], 'local temp bytes are copied, not downloaded again');
  assert.deepEqual(f.disk.files.get(expected), Buffer.from('local-bytes'));
  assert.equal(f.page.data.rows[0].images[0].localUrl, expected);
});

test('failed thumbnails back off, and a reconnect reset retries them', async () => {
  const f = fixture({ reject: true });
  f.page.data.rows = [{ key: 'u-1', kind: 'user', images: [{ attachmentId: 'sha-bad', mediaType: 'image/png' }] }];
  f.page.collectAttachmentThumbs();
  await tick();
  assert.equal(f.requests.length, 1);
  f.page.collectAttachmentThumbs();
  await tick();
  assert.equal(f.requests.length, 1, 'failed ids wait before retrying');

  f.page._thumbFailed = null;
  f.page.collectAttachmentThumbs();
  await tick();
  assert.equal(f.requests.length, 2, 'a reconnect clears the backoff');
});

test('previewAttachment reuses the cached file and fills the row', async () => {
  const f = fixture();
  f.page.data.rows = [{ key: 'u-1', kind: 'user', images: [{ attachmentId: 'sha-3', mediaType: 'image/png' }] }];
  f.page.previewAttachment({ currentTarget: { dataset: { id: 'sha-3' } } });
  await tick();
  const expected = CACHE_DIR + '/sha-3.png';
  assert.equal(f.previews.length, 1);
  assert.equal(f.previews[0].urls.length, 1);
  assert.equal(f.previews[0].urls[0], expected);
  assert.equal(f.page.data.rows[0].images[0].localUrl, expected);

  f.page.previewAttachment({ currentTarget: { dataset: { id: 'sha-3' } } });
  assert.equal(f.requests.length, 1, 'a second tap previews the local file without the gateway');
  assert.equal(f.previews[1].urls[0], expected);
});

test('a conversation synced from history auto-loads image thumbs without a tap', async () => {
  const f = fixture();
  const events = [{
    seq: 1, type: 'user/message',
    data: { content: [
      { type: 'text', text: '看这张图' },
      { type: 'image', attachment: { attachmentId: 'sha-history', mediaType: 'image/png', name: 'shot.png' } }
    ] }
  }];
  f.store.sessionState.rows = protocol.buildRows(events, 's1');
  f.store.sessionState.historyState = 'loaded:1ev';
  f.store.sessionState.running = false;
  f.store.client.requestSessionAgentPreset = () => Promise.resolve({});
  f.page.syncFromStoreInner({ app: f.store.state, session: f.store.sessionState });
  const userRow = f.page.data.rows.find((row) => row.kind === 'user');
  assert.ok(userRow, 'the user image message is rendered');
  assert.equal(userRow.images[0].localUrl, undefined, 'history only carries attachmentId first');
  await tick(160);
  const expected = CACHE_DIR + '/sha-history.png';
  assert.deepEqual(f.requests, [['s1', 'sha-history']]);
  assert.equal(userRow.images[0].localUrl, expected);
  assert.ok(f.disk.files.has(expected));
});

test('gateway echo keeps the locally sent image visible instead of blanking it', () => {
  const agg = protocol.newAggregator();
  protocol.applyEvent(agg, protocol.normalizeRawEvent({ seq: 1, type: 'user/message', data: { content: 'look' } }, 's1'));
  agg.rows.push({
    kind: 'user', key: 'local-1', title: '你', text: 'look', pending: true, seq: 9e9,
    images: [{ attachmentId: 'client-uuid', name: 'image', mediaType: 'image/jpeg', localUrl: 'wxfile://tmp/2.jpg', tempPath: 'wxfile://tmp/2.jpg' }]
  });
  protocol.applyEvent(agg, protocol.normalizeRawEvent({
    seq: 2, type: 'user/message',
    data: { content: [
      { type: 'text', text: 'look' },
      { type: 'image', attachment: { attachmentId: 'sha-2', mediaType: 'image/jpeg', name: 'IMG_2.JPG' } }
    ] }
  }, 's1'));
  const row = agg.rows[agg.rows.length - 1];
  assert.equal(row.pending, false);
  assert.equal(row.key, 'u-2');
  assert.equal(row.images.length, 1);
  assert.equal(row.images[0].attachmentId, 'sha-2');
  assert.equal(row.images[0].localUrl, 'wxfile://tmp/2.jpg');
  assert.equal(row.images[0].tempPath, 'wxfile://tmp/2.jpg');
});
