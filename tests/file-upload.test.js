const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { uploadFile, MAX_BYTES } = require('../miniprogram/pages/session/utils/file-upload');
function fixture(data = Buffer.from('external document'), fileName = 'report.pdf') {
  const calls = [], reads = []; let current = true, closed = 0, sha;
  const fs = {
    stat: o => o.success({ stats: { size: data.length } }),
    open: o => o.success({ fd: 'f' }),
    read: o => { reads.push(o.length); new Uint8Array(o.arrayBuffer).set(data.subarray(o.position, o.position + o.length)); o.success({ bytesRead: o.length, arrayBuffer: o.arrayBuffer }); },
    close: o => { closed++; o.success({}); }
  };
  const client = { connectGeneration: 1, async requestUpload(action, payload) {
    calls.push([action, payload]);
    if (action === 'open') { sha = payload.sha256; return { sessionId: 's', uploadId: 'u', size: data.length, chunkBytes: 7 }; }
    if (action === 'chunk') return { sessionId: 's', uploadId: 'u', nextOffset: payload.offset + Buffer.from(payload.data, 'base64').length };
    if (action === 'finish') return { sessionId: 's', uploadId: 'u', sha256: sha, receiptId: 'r', file: { attachmentId: 'a', name: 'report.pdf', bytes: data.length } };
    return {};
  } };
  const api = { getFileSystemManager: () => fs, arrayBufferToBase64: bytes => Buffer.from(bytes).toString('base64') };
  const run = () => uploadFile(client, { tempPath: '/tmp/report', name: fileName }, { api, sessionId: 's', isCurrent: () => current });
  return { run, fs, client, calls, reads, stop: () => { current = false; }, closed: () => closed };
}
test('files upload in bounded chunks with SHA256 and validated receipts', async () => {
  const f = fixture(); const result = await f.run();
  assert.equal(result.receiptId, 'r');
  assert.equal(f.calls[0][1].sha256, crypto.createHash('sha256').update('external document').digest('hex'));
  assert.equal(f.calls.at(-1)[0], 'finish'); assert.equal(f.closed(), 1);
  assert.ok(f.reads.every(size => size <= 65536));
  assert.equal(Buffer.concat(f.calls.filter(c => c[0] === 'chunk').map(c => Buffer.from(c[1].data, 'base64'))).toString(), 'external document');
});
test('empty files complete without chunk requests', async () => {
  const f = fixture(Buffer.alloc(0)); await f.run();
  assert.deepEqual(f.calls.map(c => c[0]), ['open', 'finish']);
});
test('oversized files never open a remote upload', async () => {
  const f = fixture(); f.fs.stat = o => o.success({ stats: { size: MAX_BYTES + 1 } });
  await assert.rejects(f.run(), /50 MB/); assert.equal(f.calls.length, 0);
});
test('invalid filenames reject path separators and control characters before upload', async () => {
  for (const name of ['../report.pdf', 'folder\\report.pdf', 'bad\0name.pdf', 'bad\x1fname.pdf', 'bad\x7fname.pdf']) {
    const f = fixture(undefined, name);
    await assert.rejects(f.run(), /文件名无效/);
    assert.equal(f.calls.length, 0);
  }
});
test('bad offsets, checksum and host changes cancel uploads without returning receipts', async () => {
  for (const kind of ['offset', 'checksum', 'session']) {
    const f = fixture(), original = f.client.requestUpload;
    f.client.requestUpload = async (action, payload) => {
      const result = await original(action, payload);
      if (kind === 'offset' && action === 'chunk') result.nextOffset++;
      if (kind === 'checksum' && action === 'finish') result.sha256 = 'bad';
      if (kind === 'session' && action === 'open') f.stop();
      return result;
    };
    await assert.rejects(f.run()); assert.equal(f.closed(), 1);
    assert.equal(f.calls.at(-1)[0], 'cancel');
  }
});
test('short local reads reject and close descriptors', async () => {
  const f = fixture(); f.fs.read = o => o.success({ bytesRead: 0, arrayBuffer: o.arrayBuffer });
  await assert.rejects(f.run()); assert.equal(f.closed(), 1); assert.equal(f.calls.length, 0);
});
test('upload RPCs only accept their own request ID, response kind and session', async () => {
  const { GatewayClient } = require('../miniprogram/utils/gateway');
  const client = new GatewayClient(), sent = []; client.send = payload => { sent.push(payload); return true; };
  const promise = client.requestUpload('open', { sessionId: 's', name: 'a' });
  client.resolveCorrelated({ kind: 'file-upload-opened', requestId: 'other', sessionId: 's' });
  assert.equal(Object.keys(client.pendingRequests).length, 1);
  client.resolveCorrelated({ kind: 'history', requestId: sent[0].requestId, sessionId: 's' });
  assert.equal(Object.keys(client.pendingRequests).length, 1);
  client.resolveCorrelated({ kind: 'file-upload-opened', requestId: sent[0].requestId, sessionId: 's', uploadId: 'u' });
  assert.equal((await promise).uploadId, 'u');
  const bad = client.requestUpload('finish', { sessionId: 's', uploadId: 'u' });
  client.resolveCorrelated({ kind: 'file-upload-completed', requestId: sent.at(-1).requestId, sessionId: 'wrong' });
  await assert.rejects(bad);
  const ack = client.requestUpload('message', { sessionId: 's', files: [{ receiptId: 'r' }] });
  assert.equal(sent.at(-1).type, 'message');
  client.resolveCorrelated({ kind: 'sent', requestId: sent.at(-1).requestId, sessionId: 's' });
  await ack; assert.equal(Object.keys(client.pendingRequests).length, 0);
});
