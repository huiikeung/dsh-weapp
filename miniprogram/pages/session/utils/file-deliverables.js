const { t } = require('../../../utils/ui-preferences');
const IMAGE = /^(png|jpe?g|gif|webp|bmp)$/i;
const DOCUMENT = /^(pdf|docx?|xlsx?|pptx?)$/i;
const TEXT = /^(md|markdown|txt|html?|css|wxss|wxml|wxs|vue|svelte|scss|less|js|jsx|mjs|cjs|ts|tsx|json|jsonl|csv|log|ya?ml|xml|svg|py|sh|sql|swift|kt|java|c|h|cpp|rs|go|toml|ini)$/i;
// html/svg/js 只作为纯文本展示，绝不执行。
const SOURCE = /^(html?|svg|js)$/i;
// 微信 openDocument 只认这些类型；其余交给转发，避免必然失败的调用。
const OPEN_TYPES = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'];
const TYPE_LABELS = { pdf: 'PDF', doc: 'Word 文档', docx: 'Word 文档', xls: 'Excel 表格', xlsx: 'Excel 表格',
  csv: 'CSV 表格', ppt: '演示文稿', pptx: '演示文稿', md: 'Markdown', markdown: 'Markdown', txt: '文本文档',
  png: '图片', jpg: '图片', jpeg: '图片', gif: '图片', webp: '图片', bmp: '图片', html: 'HTML', json: 'JSON',
  js: 'JavaScript', ts: 'TypeScript', log: '日志' };
const KIND_LABELS = { image: '图片', pdf: 'PDF', document: '文档', table: '表格', slides: '演示文稿', code: '代码', file: '文件' };

function extensionOf(name) {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// 历史里的图片附件常常只有 mediaType（没有文件名），按它反推扩展名才能认出是图片。
function extensionOfMediaType(mediaType) {
  const match = /^image\/([a-z0-9.+-]+)$/i.exec(String(mediaType || ''));
  if (!match) return '';
  const value = match[1].toLowerCase();
  return value === 'jpeg' ? 'jpg' : value === 'svg+xml' ? 'svg' : value;
}

function classify(extension) {
  return { kind: IMAGE.test(extension) ? 'image' : extension === 'pdf' ? 'pdf'
      : /^(docx?|md|markdown|txt)$/.test(extension) ? 'document'
      : /^(xlsx?|csv)$/.test(extension) ? 'table'
      : /^pptx?$/.test(extension) ? 'slides' : TEXT.test(extension) ? 'code' : 'file',
    previewKind: IMAGE.test(extension) ? 'image' : DOCUMENT.test(extension) ? 'document'
      : TEXT.test(extension) ? 'text' : 'file',
    sourceCode: SOURCE.test(extension) };
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024) return value + ' B';
  if (value < 1048576) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + ' KB';
  return (value / 1048576).toFixed(value < 10485760 ? 1 : 0) + ' MB';
}

/** 归一成卡片与预览弹窗共用的文件描述：待发送文件、消息附件、交付文件同一份规则。
 *  分类以 path 为准，没有 path 时才看文件名，再用 mediaType 兜底（历史图片只有它）。 */
function describe(file) {
  const extension = extensionOfMediaType(file.mediaType) || extensionOf(file.path || file.name);
  const info = classify(extension);
  const name = file.name || String(file.path || '').replace(/\\/g, '/').split('/').pop()
    || (info.previewKind === 'image' ? '图片' : '文件');
  const size = Number.isFinite(file.size) ? file.size : Number.isFinite(file.bytes) ? file.bytes : 0;
  return Object.assign({}, file, { name, extension, icon: '/assets/icons/deliverable-' + info.kind + '.svg',
    previewKind: info.previewKind, sourceCode: info.sourceCode,
    typeLabel: TYPE_LABELS[extension] || KIND_LABELS[info.kind] || '文件',
    size, sizeLabel: formatBytes(size), localPath: file.localPath || file.tempPath || '',
    key: file.key || file.id || file.attachmentId || file.path || name, canCopyPath: !!file.path,
    subtitle: file.description || (extension ? extension.toUpperCase() + ' · ' : '') + t('点击预览文件') });
}

// Absolute declarations may be converted only against the owning session's cwd.
// The gateway performs the final realpath/symlink containment check.
function relativePath(path, cwd) {
  if (typeof path !== 'string' || !path || /[\x00-\x1f]/.test(path)) throw Error(t('文件路径无效'));
  let value = path.replace(/\\/g, '/');
  if (value.split('/').includes('..') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw Error(t('文件路径无效'));
  const absolute = value.startsWith('/') || /^[A-Za-z]:/.test(value);
  if (absolute) {
    let root = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!root && cwd !== '/') throw Error(t('无法确定会话工作目录，请刷新会话后重试'));
    const prefix = root + '/';
    const windows = /^[A-Za-z]:/.test(root);
    if (!(windows ? value.toLowerCase().startsWith(prefix.toLowerCase()) : value.startsWith(prefix))) throw Error(t('文件不在当前会话工作目录内'));
    value = value.slice(prefix.length);
  }
  value = value.split('/').filter(part => part && part !== '.').join('/');
  if (!value || value.includes(':')) throw Error(t('文件路径无效'));
  return value;
}

module.exports = { describe, relativePath, classify, formatBytes, extensionOf, extensionOfMediaType, OPEN_TYPES };
