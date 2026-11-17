import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/main/ets/common/AttachmentCache.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const code = stripTypeScriptTypes(source) + ';globalThis.AttachmentCache = AttachmentCache;';

function setup(entries = {}) {
  const opened = [];
  const fileIo = {
    async listFile() { return Object.keys(entries); },
    async stat(path) {
      if (!(path.split('/').pop() in entries)) throw new Error('not found');
      return entries[path.split('/').pop()];
    },
    async unlink() {}
  };
  const context = {
    filesDir: '/private/data',
    startAbility: async want => { opened.push(want); },
    fileIo,
    encodeURIComponent,
    Error,
    Promise
  };
  runInNewContext(code, context);
  return { cache: context.AttachmentCache, context, opened };
}

const file = size => ({ size, isDirectory: () => false });
const directory = () => ({ size: 0, isDirectory: () => true });

test('cache listing excludes active partial downloads and directories', async () => {
  const s = setup({ 'report.pdf': file(25), '.active.part': file(2), folder: directory() });
  const entries = await s.cache.list(s.context);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, '/private/data/dsh-downloads/report.pdf');
  assert.equal(entries[0].name, 'report.pdf');
  assert.equal(entries[0].bytes, 25);
});

test('external open is limited to direct regular cache files and encodes URI', async () => {
  const s = setup({ 'my report.pdf': file(12) });
  await s.cache.openExternally(s.context, '/private/data/dsh-downloads/my report.pdf', 'application/pdf');
  assert.equal(s.opened.length, 1);
  assert.equal(s.opened[0].uri, 'file:///private/data/dsh-downloads/my%20report.pdf');
  assert.equal(s.opened[0].type, 'application/pdf');
});

test('external open rejects traversal, nested paths, and directories', async () => {
  const s = setup({ folder: directory() });
  await assert.rejects(s.cache.openExternally(s.context, '/private/data/private.txt', 'text/plain'), /路径无效/);
  await assert.rejects(s.cache.openExternally(s.context, '/private/data/dsh-downloads/../private.txt', 'text/plain'), /路径无效/);
  await assert.rejects(s.cache.openExternally(s.context, '/private/data/dsh-downloads/nested/file.txt', 'text/plain'), /路径无效/);
  await assert.rejects(s.cache.openExternally(s.context, '/private/data/dsh-downloads/folder', 'text/plain'), /不能打开目录/);
  assert.equal(s.opened.length, 0);
});

test('invalid MIME types fall back to a wildcard', async () => {
  const s = setup({ 'file.bin': file(1) });
  await s.cache.openExternally(s.context, '/private/data/dsh-downloads/file.bin', 'text/plain\nmalicious');
  assert.equal(s.opened[0].type, '*/*');
});
