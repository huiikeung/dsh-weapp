import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
const source = readFileSync(new URL('../src/main/ets/common/AttachmentTransfer.ets', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/export /g, '');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function setup(frames) {
  const files = new Map(), writes = [], unlinked = [];
  let cancelled = 0, current = '', generation = 1;
  const fileIo = { OpenMode: { READ_WRITE: 2, CREATE: 64, TRUNC: 512 }, mkdir: async () => {},
    open: async path => { current = path; files.set(path, Buffer.alloc(0)); return { fd: 1 }; },
    write: async (_fd, buffer, options) => { writes.push(options); files.set(current, Buffer.concat([files.get(current), Buffer.from(buffer)])); return buffer.byteLength; },
    close: async () => {}, rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from); },
    unlink: async path => { unlinked.push(path); files.delete(path); } };
  const client = { openFileDownload: async () => ({ transferId: 't', sessionId: 's', path: 'x', size: 4, chunkBytes: 2, name: 'x' }),
    readFileDownload: async () => { const frame = frames.shift(); return typeof frame === 'function' ? frame() : frame; },
    cancelFileDownload: async () => { cancelled++; }, isConnected: () => true, generation: () => generation };
  const context = { fileIo, hash: { hash: async path => digest(files.get(path)) },
    randomBytes: n => new Uint8Array(n).fill(7), base64Decode: s => new Uint8Array(Buffer.from(s, 'base64')),
    Uint8Array, Number, Date, Error, JSON, Math, RegExp };
  runInNewContext(stripTypeScriptTypes(source) + ';globalThis.download = downloadAttachment;', context);
  return { download: () => context.download({ filesDir: '/app' }, client, 's', 'x'), files, writes, unlinked,
    reconnect: () => { generation++; }, get cancelled() { return cancelled; } };
}
test('writes successive chunks sequentially and verifies digest', async () => {
  const s = setup([{ transferId: 't', offset: 0, data: 'YWI=', eof: false },
    { transferId: 't', offset: 2, data: 'Y2Q=', eof: true, sha256: digest(Buffer.from('abcd')) }]);
  const result = await s.download();
  assert.equal(s.files.get(result.localPath).toString(), 'abcd');
  assert.equal(s.writes.length, 2); assert.equal(s.writes[1].offset, undefined);
});
test('invalid base64 cancels and deletes only temporary file', async () => {
  const s = setup([{ transferId: 't', offset: 0, data: '!!!', eof: false }]);
  await assert.rejects(s.download());
  assert.equal(s.cancelled, 1); assert.equal(s.unlinked.length, 1); assert.match(s.unlinked[0], /\.part$/);
});
test('connection change during read discards temporary file without cancelling new gateway', async () => {
  let s;
  s = setup([() => { s.reconnect(); return { transferId: 't', offset: 0, data: 'YWI=', eof: false }; }]);
  await assert.rejects(s.download(), /连接已变化/);
  assert.equal(s.files.size, 0); assert.equal(s.cancelled, 0);
});
test('hash mismatch never publishes final file', async () => {
  const s = setup([{ transferId: 't', offset: 0, data: 'YWI=', eof: false },
    { transferId: 't', offset: 2, data: 'Y2Q=', eof: true, sha256: '0'.repeat(64) }]);
  await assert.rejects(s.download()); assert.equal(s.files.size, 0); assert.equal(s.cancelled, 1);
});
