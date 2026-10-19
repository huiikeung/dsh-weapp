const { t } = require('./ui-preferences');
const IMAGE = /^(png|jpe?g|gif|webp|bmp)$/i;
const DOCUMENT = /^(pdf|docx?|xlsx?|pptx?)$/i;
const TEXT = /^(md|markdown|txt|html?|css|wxss|wxml|wxs|vue|svelte|scss|less|js|jsx|mjs|cjs|ts|tsx|json|jsonl|csv|log|ya?ml|xml|svg|py|sh|sql|swift|kt|java|c|h|cpp|rs|go|toml|ini)$/i;

function describe(file) {
  const name = String(file.path || '').replace(/\\/g, '/').split('/').pop();
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const kind = IMAGE.test(extension) ? 'image' : extension === 'pdf' ? 'pdf'
    : /^(docx?|md|markdown|txt)$/.test(extension) ? 'document'
    : /^(xlsx?|csv)$/.test(extension) ? 'table'
    : /^(pptx?)$/.test(extension) ? 'slides'
    : TEXT.test(extension) ? 'code' : 'file';
  return Object.assign({}, file, { name, extension, icon: '/assets/icons/deliverable-' + kind + '.svg',
    previewKind: IMAGE.test(extension) ? 'image' : DOCUMENT.test(extension) ? 'document' : TEXT.test(extension) ? 'text' : 'file',
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

module.exports = { describe, relativePath };
