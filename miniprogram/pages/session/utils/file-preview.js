// 统一文件预览弹窗的状态 helpers。分类规则不在重复实现，统一走
// file-deliverables.describe：待发送文件、已发送消息附件、交付文件共用一份口径。
const { describe, formatBytes, OPEN_TYPES } = require('./file-deliverables');
const TEXT_LIMIT = 128 * 1024;

/** 主操作文案：有本地文件才能「查看原图 / 复制」，文档始终走微信查看器。 */
function primaryLabel(previewKind, hasLocal) {
  if (previewKind === 'document') return '用微信打开';
  if (previewKind === 'image') return hasLocal ? '查看原图' : '预览文件';
  if (previewKind === 'text') return hasLocal ? '复制' : '预览文件';
  return '转发到微信';
}

/** 打开弹窗的初始态：本地文件（输入框临时文件、已缓存附件）直接可看，其余等主操作触发下载。 */
function openSheet(source, options = {}) {
  const file = describe(source);
  return Object.assign({}, file, { origin: options.origin || 'message',
    text: '', truncated: false, error: '', canShare: false,
    primary: primaryLabel(file.previewKind, !!file.localPath) });
}

/** 下载完成后的可读态：正文按类型分别由页面填充（文本异步读、图片直接渲染）。 */
function reveal(file, local) {
  const size = Number.isFinite(local.size) ? local.size : file.size;
  return Object.assign({}, file, { localPath: local.localPath, size, sizeLabel: formatBytes(size),
    text: '', truncated: false, error: '', primary: primaryLabel(file.previewKind, true) });
}

function readLocalText(api, filePath, size) {
  if (!api || typeof api.getFileSystemManager !== 'function') return Promise.reject(new Error('file system unavailable'));
  if (!filePath || !size) return Promise.resolve({ text: '', truncated: false });
  return new Promise((resolve, reject) => {
    api.getFileSystemManager().readFile({ filePath, encoding: 'utf8', position: 0, length: Math.min(size, TEXT_LIMIT),
      success: result => resolve({ text: String(result.data || ''), truncated: size > TEXT_LIMIT }), fail: reject });
  });
}

function openDocumentType(extension) { return OPEN_TYPES.includes(extension) ? extension : ''; }

module.exports = { TEXT_LIMIT, primaryLabel, openSheet, reveal, readLocalText, openDocumentType };
