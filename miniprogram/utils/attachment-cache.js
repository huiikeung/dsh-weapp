// 会话历史只带图片 attachmentId，不内联字节；回显必须按需读取并落到本地文件。
// 这里以 attachmentId 为键把图片写进 USER_DATA_PATH，进程内记住路径，
// 重新渲染/切回会话时直接用本地文件，避免每次进来都重复向网关拉 Base64。
const { t } = require('./ui-preferences');

const DIR_NAME = 'dsh-attachment-cache';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_CACHED_FILES = 200;
const PRUNE_INTERVAL = 5 * 60 * 1000;
const EXTENSIONS = ['jpg', 'png', 'gif', 'webp', 'heic', 'bmp'];
const MEDIA_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic', 'image/bmp': 'bmp'
};

const memory = new Map();     // attachmentId -> 本地文件路径
const absent = new Set();     // 已确认本地不存在的 id，避免每帧同步 stat
const inflight = new Map();   // attachmentId -> 进行中的 Promise
const MAX_CONCURRENT = 3;     // 协议允许 2–4 个附件请求并发
let activeRequests = 0;
const waiters = [];
let lastPruneAt = 0;

/** 限流并发，避免一次性几十张图同时打网关。 */
function withSlot(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeRequests += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        activeRequests -= 1;
        const next = waiters.shift();
        if (next) next();
      });
    };
    if (activeRequests < MAX_CONCURRENT) run();
    else waiters.push(run);
  });
}

function defaultApi(options) {
  const given = options && options.api;
  if (given) return given;
  return typeof wx !== 'undefined' ? wx : null;
}

function usable(api) {
  return !!(api && api.env && api.env.USER_DATA_PATH && typeof api.getFileSystemManager === 'function');
}

function fsCall(fs, method, options) {
  return new Promise((resolve, reject) => fs[method](Object.assign({}, options, { success: resolve, fail: reject })));
}

function idOf(ref) {
  const id = ref && (ref.attachmentId || ref.id);
  return id ? String(id) : '';
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function extOf(mediaType, name) {
  const media = String(mediaType || '').toLowerCase().split(';')[0].trim();
  if (MEDIA_EXT[media]) return MEDIA_EXT[media];
  const match = String(name || '').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  const ext = match && match[1].toLowerCase();
  return EXTENSIONS.indexOf(ext) >= 0 ? ext : 'jpg';
}

function dirPath(api) {
  return api.env.USER_DATA_PATH + '/' + DIR_NAME;
}

function targetPath(api, ref) {
  return dirPath(api) + '/' + safeId(idOf(ref)) + '.' + extOf(ref && ref.mediaType, ref && ref.name);
}

function ensureDir(api) {
  try { api.getFileSystemManager().mkdirSync(dirPath(api), true); } catch (_) { /* 目录已存在 */ }
}

/** 同步查询本地缓存：命中返回文件路径，否则返回 ''。 */
function localPath(ref, options) {
  const api = defaultApi(options);
  const id = idOf(ref);
  if (!usable(api) || !id) return '';
  if (memory.has(id)) return memory.get(id);
  if (absent.has(id)) return '';
  const fs = api.getFileSystemManager();
  const base = dirPath(api) + '/' + safeId(id);
  const preferred = extOf(ref.mediaType, ref.name);
  const candidates = [preferred].concat(EXTENSIONS.filter((ext) => ext !== preferred));
  for (let i = 0; i < candidates.length; i += 1) {
    const path = base + '.' + candidates[i];
    try {
      fs.accessSync(path);
      memory.set(id, path);
      return path;
    } catch (_) { /* 试下一个扩展名 */ }
  }
  absent.add(id);
  return '';
}

function remember(ref, path) {
  const id = idOf(ref);
  if (!id || !path) return path;
  memory.set(id, path);
  absent.delete(id);
  return path;
}

/** 超过上限时清掉最旧且当前不在内存索引里的缓存文件，失败不影响主流程。 */
function prune(api) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL) return;
  const fs = api.getFileSystemManager();
  if (typeof fs.readdir !== 'function') return;
  lastPruneAt = now;
  const dir = dirPath(api);
  fsCall(fs, 'readdir', { dirPath: dir }).then((res) => {
    const files = (res && res.files) || [];
    if (files.length <= MAX_CACHED_FILES) return null;
    const protectedNames = new Set();
    memory.forEach((path) => protectedNames.add(String(path).split('/').pop()));
    const stale = files.filter((name) => !protectedNames.has(name));
    if (!stale.length) return null;
    return Promise.all(stale.slice(0, Math.max(0, files.length - MAX_CACHED_FILES))
      .map((name) => fsCall(fs, 'unlink', { filePath: dir + '/' + name }).catch(() => {})));
  }).catch(() => {});
}

/**
 * 拉取一张图片并写入本地缓存。同 id 并发调用复用同一个 Promise；
 * 不同图片最多 3 个并发（协议建议 2–4），明显加快多图会话的首屏。
 */
function fetchImage(client, sessionId, ref, options) {
  const api = defaultApi(options);
  const id = idOf(ref);
  if (!usable(api) || !client || typeof client.requestAttachment !== 'function') {
    return Promise.reject(new Error(t('图片附件缓存不可用')));
  }
  if (!sessionId || !id) return Promise.reject(new Error(t('图片附件信息不完整')));
  const cached = localPath(ref, { api: api });
  if (cached) return Promise.resolve(cached);
  if (inflight.has(id)) return inflight.get(id);
  const run = withSlot(() => client.requestAttachment(sessionId, id)).then((frame) => {
    if (!frame || typeof frame.data !== 'string' || !frame.data) throw new Error(t('附件数据为空'));
    const attachment = frame.attachment || {};
    const bytes = Number(attachment.bytes);
    if (bytes > MAX_IMAGE_BYTES) throw new Error(t('图片过大，无法自动显示'));
    const path = targetPath(api, {
      attachmentId: id,
      mediaType: attachment.mediaType || (ref && ref.mediaType),
      name: attachment.name || (ref && ref.name)
    });
    ensureDir(api);
    return fsCall(api.getFileSystemManager(), 'writeFile', {
      filePath: path, data: frame.data, encoding: 'base64'
    }).then(() => {
      remember(ref, path);
      prune(api);
      return path;
    });
  });
  const tracked = run.finally(() => { inflight.delete(id); });
  inflight.set(id, tracked);
  return tracked;
}

/** 把本机刚选中的临时图片复制进缓存，避免为自己的图片再向网关拉一遍。 */
function adoptFromFile(ref, tempPath, options) {
  const api = defaultApi(options);
  const id = idOf(ref);
  if (!usable(api) || !id || !tempPath) return Promise.reject(new Error(t('图片附件缓存不可用')));
  const cached = localPath(ref, { api: api });
  if (cached) return Promise.resolve(cached);
  if (inflight.has(id)) return inflight.get(id);
  ensureDir(api);
  const path = targetPath(api, ref);
  const run = withSlot(() => fsCall(api.getFileSystemManager(), 'copyFile', {
    srcPath: tempPath, destPath: path
  })).then(() => {
    remember(ref, path);
    prune(api);
    return path;
  });
  const tracked = run.finally(() => { inflight.delete(id); });
  inflight.set(id, tracked);
  return tracked;
}

function reset() {
  memory.clear();
  absent.clear();
  inflight.clear();
  activeRequests = 0;
  waiters.length = 0;
  lastPruneAt = 0;
}

module.exports = {
  localPath,
  fetchImage,
  adoptFromFile,
  targetPath,
  extOf,
  MAX_IMAGE_BYTES,
  _reset: reset
};
