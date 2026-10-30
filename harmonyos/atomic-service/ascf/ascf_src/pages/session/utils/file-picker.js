'use strict';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
let sequence = 0;

function fsCall(fs, method, options) {
  return new Promise((resolve, reject) => fs[method](Object.assign({}, options, { success: resolve, fail: reject })));
}

function extensionOf(name, type) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  const ext = match ? match[1].toLowerCase() : '';
  if (type === 'image') return /^(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(ext) ? ext : '';
  return ext || 'bin';
}

function uniqueId() {
  sequence = (sequence + 1) % 0x1000000;
  return Date.now().toString(36) + '-' + sequence.toString(36);
}

function cleanupStagedFiles(api, files) {
  const fs = api && typeof api.getFileSystemManager === 'function' ? api.getFileSystemManager() : null;
  if (!fs || typeof fs.unlink !== 'function') return Promise.resolve();
  const paths = (Array.isArray(files) ? files : []).filter(file => file && file.staged === true
    && typeof file.tempPath === 'string' && file.tempPath.startsWith('internal://cache/dsh-picker-'));
  return paths.reduce((chain, file) => chain.then(() => fsCall(fs, 'unlink', { filePath: file.tempPath }).catch(() => {})), Promise.resolve());
}

async function stageFiles(api, selected, options = {}) {
  if (!api || typeof api.getFileSystemManager !== 'function') throw new Error('File system unavailable');
  const fs = api.getFileSystemManager();
  if (typeof fs.copyFile !== 'function') throw new Error('File copy is unavailable');
  const type = options.type === 'image' ? 'image' : 'file';
  const maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
    ? options.maxBytes : (type === 'image' ? MAX_IMAGE_BYTES : MAX_FILE_BYTES);
  const makeId = typeof options.idFactory === 'function' ? options.idFactory : uniqueId;
  const files = [];
  let skipped = false;
  for (const item of Array.isArray(selected) ? selected : []) {
    const size = Number(item && item.size);
    const srcPath = String(item && (item.path || item.tempFilePath) || '');
    const name = String(item && item.name || 'file').replace(/[\\/\x00-\x1f:*?"<>|]/g, '_').slice(-180) || 'file';
    const ext = extensionOf(name, type);
    if (!srcPath || !Number.isSafeInteger(size) || size < 0 || size > maxBytes || !ext) {
      skipped = true;
      continue;
    }
    const id = String(makeId()).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    const tempPath = 'internal://cache/dsh-picker-' + id + '.' + ext;
    try {
      await fsCall(fs, 'copyFile', { srcPath, destPath: tempPath });
      files.push({ id, name, size, extension: ext, tempPath, staged: true });
    } catch (_) {
      skipped = true;
      await cleanupStagedFiles(api, [{ staged: true, tempPath }]);
    }
  }
  return { files, skipped };
}

function chooseAndStage(api, options = {}) {
  return new Promise((resolve, reject) => {
    if (!api || typeof api.chooseFile !== 'function') {
      reject(new Error('ASCF file picker is unavailable'));
      return;
    }
    const type = options.type === 'image' ? 'image' : 'file';
    try {
      api.chooseFile({ type, count: options.count, success: result => {
        stageFiles(api, result && result.tempFiles, options).then(resolve, reject);
      }, fail: reject });
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { MAX_FILE_BYTES, MAX_IMAGE_BYTES, stageFiles, chooseAndStage, cleanupStagedFiles };
