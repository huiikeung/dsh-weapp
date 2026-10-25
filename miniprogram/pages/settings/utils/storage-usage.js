// 本机缓存统计与清理（对齐 dsh-mobile SettingsView.StorageSpaceView）。
// 四类：聊天记录（storage 会话缓存）、图片（附件文件缓存）、
// 文件预览（会话下载的文件）、临时文件（.part / 配对二维码等残留）。
const IMAGE_DIR = 'dsh-attachment-cache';

const CATEGORIES = [
  { key: 'chats', title: '聊天记录', detail: '会话列表与正文缓存', color: '#3D7AC7', icon: '/assets/icons/menu-chat-image.svg' },
  { key: 'images', title: '图片', detail: '聊天中下载的图片', color: '#3BA38C', icon: '/assets/icons/menu-image.svg' },
  { key: 'files', title: '文件预览', detail: '会话中下载的文件', color: '#DBA347', icon: '/assets/icons/menu-chat-file.svg' },
  { key: 'temporary', title: '临时文件', detail: '未完成的下载与临时副本', color: '#A182C2', icon: '/assets/icons/menu-folder.svg' }
];

function api() { return typeof wx !== 'undefined' ? wx : null; }
function fs() { const w = api(); return w && typeof w.getFileSystemManager === 'function' ? w.getFileSystemManager() : null; }
function baseDir() { const w = api(); return w && w.env && w.env.USER_DATA_PATH ? w.env.USER_DATA_PATH : ''; }
function entries(path) { try { const list = fs().readdirSync(path); return Array.isArray(list) ? list : []; } catch (e) { return []; } }
function fileSize(path) { try { return fs().statSync(path).size || 0; } catch (e) { return 0; } }
function dirBytes(path) { return entries(path).reduce((sum, name) => sum + fileSize(path + '/' + name), 0); }

function storageKeys() {
  const w = api();
  try { return w.getStorageInfoSync().keys || []; } catch (e) { return []; }
}

function collect() {
  const base = baseDir();
  const usage = { chats: 0, images: 0, files: 0, temporary: 0 };
  if (base) {
    usage.images = dirBytes(base + '/' + IMAGE_DIR);
    for (const name of entries(base)) {
      if (name.indexOf('dsh-file-') === 0) {
        if (name.slice(-5) === '.part') usage.temporary += fileSize(base + '/' + name);
        else usage.files += fileSize(base + '/' + name);
      } else if (name.indexOf('clawbot-login-') === 0) {
        usage.temporary += fileSize(base + '/' + name);
      }
    }
  }
  for (const key of storageKeys()) {
    if (key.indexOf('dsh_session_cache.') === 0 || key.indexOf('dsh_home_cache.') === 0
      || key.indexOf('dsh_context_cache.') === 0 || key.indexOf('dsh_history_page.') === 0) {
      try { usage.chats += String(wx.getStorageSync(key)).length; } catch (e) { /* 忽略单项 */ }
    }
  }
  let quota = null;
  const w = api();
  try {
    const info = w.getStorageInfoSync();
    quota = { current: info.currentSize * 1024, limit: info.limitSize * 1024 };
  } catch (e) { /* 配额不可用则隐藏 */ }
  const totalBytes = usage.chats + usage.images + usage.files + usage.temporary;
  let cursor = 0;
  const stops = [];
  CATEGORIES.forEach((cat) => {
    if (!(totalBytes > 0) || usage[cat.key] <= 0) return;
    const from = (cursor / totalBytes) * 100;
    cursor += usage[cat.key];
    const to = (cursor / totalBytes) * 100;
    stops.push(cat.color + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%');
    // 段间留 1.2% 透明缝，环形图读作分段圆环而不是连续色带（iOS angularInset）。
    stops.push('transparent ' + to.toFixed(2) + '% ' + Math.min(100, to + 1.2).toFixed(2) + '%');
  });
  const gradient = stops.join(',');
  const categories = CATEGORIES.map((cat) => ({
    key: cat.key, title: cat.title, detail: cat.detail, color: cat.color, icon: cat.icon,
    bytes: usage[cat.key], bytesText: formatBytes(usage[cat.key]),
    pctText: totalBytes > 0 && usage[cat.key] > 0 ? Math.round((usage[cat.key] / totalBytes) * 100) + '%' : ''
  }));
  return {
    categories, totalBytes, totalText: formatBytes(totalBytes), gradient,
    storageText: quota ? formatBytes(quota.current) + ' / ' + formatBytes(quota.limit) : ''
  };
}

/** 清理指定类别，返回释放的字节数（估算）。 */
function clearCategory(key) {
  const base = baseDir();
  let freed = 0;
  const unlink = (path) => new Promise((resolve) => {
    const manager = fs();
    try { freed += fileSize(path); } catch (e) { /* 已消失 */ }
    if (!manager) { resolve(); return; }
    manager.unlink({ filePath: path, complete: () => resolve() });
  });
  if (key === 'chats') {
    for (const storageKey of storageKeys()) {
      if (storageKey.indexOf('dsh_session_cache.') !== 0 && storageKey.indexOf('dsh_home_cache.') !== 0
        && storageKey.indexOf('dsh_context_cache.') !== 0 && storageKey.indexOf('dsh_history_page.') !== 0) continue;
      const w = api();
      try { freed += String(w.getStorageSync(storageKey)).length; } catch (e) { /* 忽略 */ }
      try { w.removeStorageSync(storageKey); } catch (e) { /* 忽略 */ }
    }
    return Promise.resolve(freed);
  }
  if (!base) return Promise.resolve(0);
  let paths = [];
  if (key === 'images') paths = entries(base + '/' + IMAGE_DIR).map((name) => base + '/' + IMAGE_DIR + '/' + name);
  else if (key === 'files') paths = entries(base).filter((name) => name.indexOf('dsh-file-') === 0 && name.slice(-5) !== '.part').map((name) => base + '/' + name);
  else if (key === 'temporary') paths = entries(base).filter((name) => name.slice(-5) === '.part' || name.indexOf('clawbot-login-') === 0).map((name) => base + '/' + name);
  return paths.reduce((chain, path) => chain.then(() => unlink(path)), Promise.resolve()).then(() => {
    if (key === 'images') {
      // 附件模块的内存索引指向已删除的文件，重置后按需重建。
      try { require('../../../utils/attachment-cache')._reset(); } catch (e) { /* 忽略 */ }
    }
    return freed;
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 KB';
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1024) return (kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10) + ' KB';
  const mb = kb / 1024;
  if (mb < 1024) return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + ' MB';
  return Math.round(mb / 102.4) / 10 + ' GB';
}

module.exports = { collect, clearCategory, formatBytes, CATEGORIES };
