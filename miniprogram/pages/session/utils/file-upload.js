const SHA256 = require('./file-sha256');
const { t } = require('../../../utils/ui-preferences');
const MAX_BYTES = 50 * 1024 * 1024;
const READ_BYTES = 64 * 1024;
const call = (fs, method, options) => new Promise((resolve, reject) =>
  fs[method](Object.assign({}, options, { success: resolve, fail: reject })));

function hasInvalidFileNameCharacter(name) {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code <= 31 || code === 127 || name[i] === '/' || name[i] === '\\') return true;
  }
  return false;
}

async function uploadFile(client, file, options) {
  const { api, sessionId, isCurrent, onProgress } = options;
  const fs = api.getFileSystemManager(), generation = client.connectGeneration;
  let fd, uploadId, completed = false;
  const check = () => {
    if (client.connectGeneration !== generation || !isCurrent()) throw Error(t('连接或会话已变化，请重新发送'));
  };
  const read = async (position, length) => {
    check();
    const result = await call(fs, 'read', { fd, arrayBuffer: new ArrayBuffer(length), offset: 0, position, length });
    check();
    if (result.bytesRead !== length) throw Error(t('文件读取失败，请重新选择'));
    return new Uint8Array(result.arrayBuffer);
  };
  try {
    check();
    const name = String(file.name || 'file');
    if (!name.trim() || name.length > 255 || hasInvalidFileNameCharacter(name) || name === '.' || name === '..') throw Error(t('文件名无效'));
    const stat = await call(fs, 'stat', { path: file.tempPath });
    const size = stat.stats && stat.stats.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES) throw Error(t('外部文件不能超过 50 MB'));
    fd = (await call(fs, 'open', { filePath: file.tempPath, flag: 'r' })).fd;
    const digest = new SHA256();
    for (let offset = 0; offset < size; offset += READ_BYTES) digest.update(await read(offset, Math.min(READ_BYTES, size - offset)));
    check(); const sha256 = digest.hex();
    const opened = await client.requestUpload('open', { sessionId, name, size, sha256 });
    uploadId = opened.uploadId; check();
    if (opened.sessionId !== sessionId || typeof uploadId !== 'string' || !uploadId || opened.size !== size
      || !Number.isSafeInteger(opened.chunkBytes) || opened.chunkBytes < 1 || opened.chunkBytes > 4 * 1024 * 1024
      || (opened.maxBytes != null && size > opened.maxBytes)) throw Error(t('文件上传响应无效'));
    const chunkBytes = Math.min(READ_BYTES, opened.chunkBytes);
    for (let offset = 0; offset < size;) {
      const bytes = await read(offset, Math.min(chunkBytes, size - offset));
      const frame = await client.requestUpload('chunk', { sessionId, uploadId, offset, data: api.arrayBufferToBase64(bytes.buffer) });
      check(); offset += bytes.length;
      if (frame.sessionId !== sessionId || frame.uploadId !== uploadId || frame.nextOffset !== offset) throw Error(t('文件上传响应无效'));
      if (onProgress) onProgress(Math.floor(offset / size * 100));
    }
    const frame = await client.requestUpload('finish', { sessionId, uploadId });
    check();
    if (frame.sessionId !== sessionId || frame.uploadId !== uploadId || typeof frame.receiptId !== 'string' || !frame.receiptId
      || String(frame.sha256).toLowerCase() !== sha256 || !frame.file || !frame.file.attachmentId
      || frame.file.bytes !== size || !frame.file.name) throw Error(t('文件上传校验失败，请重试'));
    completed = true;
    return { receiptId: frame.receiptId, file: frame.file };
  } finally {
    if (fd != null) await call(fs, 'close', { fd }).catch(() => {});
    if (!completed && uploadId && client.connectGeneration === generation)
      client.requestUpload('cancel', { sessionId, uploadId }).catch(() => {});
  }
}
module.exports = { uploadFile, MAX_BYTES };
