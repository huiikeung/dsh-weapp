'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const attachmentCache = require('../miniprogram/utils/attachment-cache');

const ROOT = '/tmp/dsh-attachment-test';

function memoryFs() {
  const files = new Map();
  const fs = {
    mkdirSync() {},
    accessSync(path) {
      if (!files.has(path)) { const error = new Error('access:fail no such file'); error.errMsg = 'access:fail no such file'; throw error; }
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
  return { files, api: { env: { USER_DATA_PATH: ROOT }, getFileSystemManager: () => fs } };
}

function frame(data, mediaType = 'image/png') {
  return { kind: 'attachment', attachment: { mediaType, bytes: Buffer.byteLength(data) }, data: Buffer.from(data).toString('base64') };
}

test('history image bytes are written to USER_DATA_PATH once and reused', async () => {
  attachmentCache._reset();
  const store = memoryFs();
  let requests = 0;
  const client = {
    requestAttachment(sessionId, id) {
      requests += 1;
      assert.equal(sessionId, 's1');
      assert.equal(id, 'sha-img-1');
      return Promise.resolve(frame('bytes'));
    }
  };
  const ref = { attachmentId: 'sha-img-1', mediaType: 'image/png', name: 'IMG_1.PNG' };
  assert.equal(attachmentCache.localPath(ref, { api: store.api }), '');
  const path = await attachmentCache.fetchImage(client, 's1', ref, { api: store.api });
  assert.equal(path, ROOT + '/dsh-attachment-cache/sha-img-1.png');
  assert.deepEqual(store.files.get(path), Buffer.from('bytes'));
  assert.equal(attachmentCache.localPath(ref, { api: store.api }), path);

  assert.equal(await attachmentCache.fetchImage(client, 's1', ref, { api: store.api }), path);
  assert.equal(requests, 1, 'a second render must not hit the gateway again');
});

test('requests are serialized by the gateway single-lane rule and deduplicated per id', async () => {
  attachmentCache._reset();
  const store = memoryFs();
  const order = [];
  let active = 0, maxActive = 0;
  const client = {
    requestAttachment(sessionId, id) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(id);
      return Promise.resolve().then(() => {
        active -= 1;
        return frame('x' + id);
      });
    }
  };
  const first = attachmentCache.fetchImage(client, 's1', { attachmentId: 'a', mediaType: 'image/jpeg' }, { api: store.api });
  const same = attachmentCache.fetchImage(client, 's1', { attachmentId: 'a', mediaType: 'image/jpeg' }, { api: store.api });
  const second = attachmentCache.fetchImage(client, 's1', { attachmentId: 'b', mediaType: 'image/jpeg' }, { api: store.api });
  assert.equal(first, same, 'concurrent calls share one promise');
  const paths = await Promise.all([first, same, second]);
  assert.equal(maxActive, 1, 'attachment requests must not overlap');
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(paths[0], paths[1]);
  assert.notEqual(paths[0], paths[2]);
});

test('a locally selected temp image is copied into the cache instead of refetched', async () => {
  attachmentCache._reset();
  const store = memoryFs();
  store.files.set('wxfile://tmp/IMG_2.JPG', Buffer.from('local'));
  let requests = 0;
  const client = { requestAttachment() { requests += 1; return Promise.reject(new Error('unexpected')); } };
  const ref = { attachmentId: 'sha-img-2', mediaType: 'image/jpeg', name: 'IMG_2.JPG' };
  const path = await attachmentCache.adoptFromFile(ref, 'wxfile://tmp/IMG_2.JPG', { api: store.api });
  assert.equal(path, ROOT + '/dsh-attachment-cache/sha-img-2.jpg');
  assert.deepEqual(store.files.get(path), Buffer.from('local'));
  assert.equal(await attachmentCache.adoptFromFile(ref, 'wxfile://tmp/IMG_2.JPG', { api: store.api }), path);
  assert.equal(requests, 0);
});

test('missing temp files reject so the caller can fall back to the gateway copy', async () => {
  attachmentCache._reset();
  const store = memoryFs();
  await assert.rejects(attachmentCache.adoptFromFile({ attachmentId: 'gone', mediaType: 'image/png' }, 'wxfile://tmp/gone.png', { api: store.api }));
  assert.equal(store.files.size, 0);
});

test('corrupt, empty and oversized frames are rejected without leaving a file', async () => {
  attachmentCache._reset();
  const store = memoryFs();
  const base = { requestAttachment: () => Promise.resolve({ kind: 'attachment', attachment: { bytes: 1 }, data: '' }) };
  await assert.rejects(attachmentCache.fetchImage(base, 's1', { attachmentId: 'empty', mediaType: 'image/png' }, { api: store.api }), /附件数据为空/);
  const corrupt = { requestAttachment: () => Promise.resolve(null) };
  await assert.rejects(attachmentCache.fetchImage(corrupt, 's1', { attachmentId: 'null', mediaType: 'image/png' }, { api: store.api }));
  const huge = { requestAttachment: () => Promise.resolve({ kind: 'attachment', attachment: { bytes: attachmentCache.MAX_IMAGE_BYTES + 1 }, data: 'YQ==' }) };
  await assert.rejects(attachmentCache.fetchImage(huge, 's1', { attachmentId: 'huge', mediaType: 'image/png' }, { api: store.api }), /图片过大/);
  assert.equal(store.files.size, 0);
  assert.equal(attachmentCache.localPath({ attachmentId: 'huge' }, { api: store.api }), '');
});

test('extension follows media type and falls back to the attachment name', () => {
  attachmentCache._reset();
  assert.equal(attachmentCache.extOf('image/jpeg', 'photo.HEIC'), 'jpg');
  assert.equal(attachmentCache.extOf('', 'photo.webp'), 'webp');
  assert.equal(attachmentCache.extOf('image/unknown', 'photo'), 'jpg');
  assert.equal(attachmentCache.targetPath({ env: { USER_DATA_PATH: '/tmp' } }, { attachmentId: 'a/b', mediaType: 'image/gif' }), '/tmp/dsh-attachment-cache/a_b.gif');
});

test('unusable runtimes and missing attachment ids are harmless', async () => {
  attachmentCache._reset();
  assert.equal(attachmentCache.localPath({ attachmentId: 'a' }), '');
  assert.equal(attachmentCache.localPath(null), '');
  await assert.rejects(attachmentCache.fetchImage({}, '', { attachmentId: 'a' }, { api: {} }));
  await assert.rejects(attachmentCache.adoptFromFile({ attachmentId: 'a' }, '', { api: {} }));
});
