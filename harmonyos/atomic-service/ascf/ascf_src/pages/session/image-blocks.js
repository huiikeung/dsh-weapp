// Markdown 图片块：把助手消息里的 ![](src) 变成可显示的内容。
// - http(s) / data URI 直接交给 <image>；
// - 工作区相对路径走网关文件下载（和「交付文件」同一条链路），落到本地后渲染；
// - 下载结果写入持久索引，重新进入会话/翻回历史时直接复用，不再重复下载；
// - 历史行到达时就低优先级预取，等滚动到可见位置通常已经就绪。
const store = require('../../utils/store');
const { downloadFile, MAX_CONCURRENT_DOWNLOADS } = require('./utils/file-download');

const REMOTE = /^(?:https?:\/\/|data:image\/)/i;
const IMAGE_MARK = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const STORAGE_KEY = 'dsh.mdImage.index.v1';
const MAX_INDEX_ENTRIES = 48;
const MAX_PREFETCH_QUEUE = 24;
const PREFETCH_SCAN_ROWS = 80;

function wxApi() {
  return typeof has !== 'undefined' ? has : null;
}

function readIndex() {
  const api = wxApi();
  if (!api || typeof api.getStorageSync !== 'function') return {};
  try {
    const saved = api.getStorageSync(STORAGE_KEY);
    return saved && typeof saved === 'object' ? saved : {};
  } catch (_error) {
    return {};
  }
}

function fileExists(path) {
  const api = wxApi();
  if (!api || !api.getFileSystemManager || !path) return false;
  try {
    api.getFileSystemManager().accessSync(path);
    return true;
  } catch (_error) {
    return false;
  }
}

function unlink(path) {
  const api = wxApi();
  if (!api || !api.getFileSystemManager || !path) return;
  try {
    api.getFileSystemManager().unlink({ filePath: path, fail() {} });
  } catch (_error) { /* 忽略清理失败 */ }
}

module.exports = {
  /** 渲染前给图片块打上状态；需要下载的排队。重复调用是幂等的。 */
  prepareImageBlocks(blocks) {
    if (!Array.isArray(blocks) || !blocks.length) return blocks;
    const sessionId = store.sessionState && store.sessionState.sessionId;
    if (this._mdImageSession !== sessionId) {
      this.disposeMarkdownImages();
      this._mdImageSession = sessionId;
    }
    for (const block of blocks) {
      if (!block || block.type !== 'image') continue;
      if (block.imageState && block.imageState !== 'pending') continue;
      const src = String(block.src || '').trim();
      if (!src) { block.imageState = 'missing'; continue; }
      if (REMOTE.test(src)) { block.imageState = 'remote'; continue; }
      const indexKey = this.markdownImageKey(src);
      const cached = this.markdownImageCache().get(src) || this.readImageIndexEntry(indexKey);
      if (cached && cached.path) {
        if (fileExists(cached.path)) {
          this.markdownImageCache().set(src, cached);
          block.localPath = cached.path;
          block.imageState = 'local';
          this.touchImageIndexEntry(indexKey, cached);
          continue;
        }
        this.dropImageIndexEntry(indexKey);
      }
      if (cached && cached.failed) { block.imageState = 'missing'; continue; }
      if (cached && cached.pending) { block.imageState = 'pending'; continue; }
      this.markdownImageCache().set(src, { pending: true });
      block.imageState = 'pending';
      this.queueMarkdownImage(src, true);
    }
    return blocks;
  },

  /** 历史行入库时预取：只做正则扫描，不解析 Markdown，不阻塞渲染。 */
  prefetchImageMarkdown(rows) {
    if (!Array.isArray(rows) || !rows.length) return;
    const sessionId = store.sessionState && store.sessionState.sessionId;
    if (!sessionId) return;
    if (this._mdImageSession !== sessionId) {
      this.disposeMarkdownImages();
      this._mdImageSession = sessionId;
    }
    const start = Math.max(0, rows.length - PREFETCH_SCAN_ROWS);
    for (let index = rows.length - 1; index >= start; index -= 1) {
      const row = rows[index];
      const text = row && row.kind === 'assistant' ? row.text : '';
      if (!text || text.indexOf('![') < 0) continue;
      IMAGE_MARK.lastIndex = 0;
      let match;
      while ((match = IMAGE_MARK.exec(text))) {
        const src = String(match[1] || '').trim();
        if (!src || REMOTE.test(src)) continue;
        const indexKey = this.markdownImageKey(src);
        if (this.markdownImageCache().has(src) || this.readImageIndexEntry(indexKey)) continue;
        this.queueMarkdownImage(src, false);
      }
    }
    if (!this._mdImagePumping && ((this._mdImageUrgent && this._mdImageUrgent.length)
      || (this._mdImageQueue && this._mdImageQueue.length))) this.pumpMarkdownImages();
  },

  markdownImageKey(src) {
    const sessionId = (store.sessionState && store.sessionState.sessionId) || '';
    return String(sessionId) + '|' + src;
  },

  markdownImageCache() {
    if (!this._mdImageCache) this._mdImageCache = new Map();
    return this._mdImageCache;
  },

  imageIndex() {
    if (!this._mdImageIndex) this._mdImageIndex = readIndex();
    return this._mdImageIndex;
  },

  readImageIndexEntry(key) {
    const entry = this.imageIndex()[key];
    if (!entry || typeof entry.path !== 'string') return null;
    return entry;
  },

  writeImageIndexEntry(key, entry) {
    const index = this.imageIndex();
    index[key] = entry;
    const keys = Object.keys(index);
    if (keys.length > MAX_INDEX_ENTRIES) {
      keys.sort((a, b) => (Number(index[a].ts) || 0) - (Number(index[b].ts) || 0));
      for (const stale of keys.slice(0, keys.length - MAX_INDEX_ENTRIES)) {
        const path = index[stale] && index[stale].path;
        delete index[stale];
        if (path) unlink(path);
      }
    }
    this.saveImageIndex();
  },

  touchImageIndexEntry(key, entry) {
    const index = this.imageIndex();
    if (!index[key]) return;
    index[key] = Object.assign({}, index[key], entry, { ts: Date.now() });
    this.saveImageIndex();
  },

  dropImageIndexEntry(key) {
    const index = this.imageIndex();
    if (!index[key]) return;
    delete index[key];
    this.saveImageIndex();
  },

  saveImageIndex() {
    const api = wxApi();
    if (!api || typeof api.setStorageSync !== 'function') return;
    try { api.setStorageSync(STORAGE_KEY, this.imageIndex()); } catch (_error) { /* 存储满时忽略 */ }
  },

  queueMarkdownImage(src, urgent) {
    if (!this._mdImageQueue) this._mdImageQueue = [];
    if (!this._mdImageUrgent) this._mdImageUrgent = [];
    if (!this._mdImageQueued) this._mdImageQueued = new Set();
    if (this._mdImageQueued.has(src)) return;
    this._mdImageQueued.add(src);
    if (urgent) {
      this._mdImageUrgent.push(src);
    } else {
      if (this._mdImageQueue.length >= MAX_PREFETCH_QUEUE) { this._mdImageQueued.delete(src); return; }
      this._mdImageQueue.push(src);
    }
    if (!this._mdImagePumping) this.pumpMarkdownImages();
  },

  /**
   * 图片下载池：网关允许最多 4 条并发传输，这里也用小池并发 —— 对话里连续产出
   * 多张图时一张张串行下会让后面的图干等。回合进行中只放行可见图片（urgent）。
   */
  async pumpMarkdownImages() {
    if (this._mdImagePumping) return;
    this._mdImagePumping = true;
    try {
      while (!this._unloaded) {
        const urgent = this._mdImageUrgent && this._mdImageUrgent.length;
        // 回合进行中不抢流式通道：可见图片优先，后台预取等回合结束再说。
        if (!urgent && store.sessionState && store.sessionState.running) break;
        const src = urgent ? this._mdImageUrgent.shift() : (this._mdImageQueue && this._mdImageQueue.shift());
        if (!src) break;
        this._mdImageQueued.delete(src);
        if (!this._mdImageInflight) this._mdImageInflight = new Set();
        const flight = this.downloadMarkdownImage(src).finally(() => {
          this._mdImageInflight.delete(flight);
        });
        this._mdImageInflight.add(flight);
        // 池满（或下载被并发上限拒绝）时等一张腾出位置，避免把请求堆在网关门口。
        if (this._mdImageInflight.size >= MAX_CONCURRENT_DOWNLOADS) await flight;
      }
      if (this._mdImageInflight && this._mdImageInflight.size) await Promise.all(this._mdImageInflight);
    } finally {
      this._mdImagePumping = false;
    }
  },

  async downloadMarkdownImage(src) {
    const client = store.client;
    const sessionId = store.sessionState && store.sessionState.sessionId;
    const cache = this.markdownImageCache();
    if (!client || !sessionId) {
      cache.set(src, { failed: true });
      this.applyMarkdownImageState(src, { imageState: 'missing' });
      return;
    }
    try {
      const local = await downloadFile(client, { sessionId, path: src.replace(/^\.\//, '') }, {
        cwd: store.sessionState.cwd,
        isCurrent: () => !this._unloaded && sessionId === (store.sessionState && store.sessionState.sessionId)
      });
      if (this._unloaded || sessionId !== (store.sessionState && store.sessionState.sessionId)) return;
      const entry = { path: local.localPath, ts: Date.now() };
      cache.set(src, entry);
      this.writeImageIndexEntry(this.markdownImageKey(src), entry);
      this.applyMarkdownImageState(src, { imageState: 'local', localPath: local.localPath });
    } catch (_error) {
      cache.set(src, { failed: true });
      this.applyMarkdownImageState(src, { imageState: 'missing' });
    }
  },

  /** 把某张图片的最终状态写回当前已渲染的行（按 src 匹配）。 */
  applyMarkdownImageState(src, patch) {
    if (this._unloaded) return;
    const rows = this.data.rows || [];
    const next = {};
    rows.forEach((row, rowIndex) => {
      const apply = (blocks, path) => {
        if (!Array.isArray(blocks)) return;
        blocks.forEach((block, blockIndex) => {
          if (!block || block.type !== 'image' || block.src !== src || block.imageState !== 'pending') return;
          Object.keys(patch).forEach((key) => {
            next[path + '[' + blockIndex + '].' + key] = patch[key];
          });
          block.imageState = patch.imageState;
          if (patch.localPath) block.localPath = patch.localPath;
        });
      };
      apply(row && row.blocks, 'rows[' + rowIndex + '].blocks');
      (row && row.children || []).forEach((child, childIndex) => {
        apply(child && child.blocks, 'rows[' + rowIndex + '].children[' + childIndex + '].blocks');
      });
    });
    if (Object.keys(next).length) this.setData(next);
  },

  previewMarkdownImage(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const src = dataset.src;
    if (!src || typeof has === 'undefined' || typeof has.previewImage !== 'function') return;
    let blocks = [];
    for (const row of this.data.rows || []) {
      if (row && row.key === dataset.key) { blocks = row.blocks || []; break; }
      const child = row && (row.children || []).find(item => item && item.key === dataset.key);
      if (child) { blocks = child.blocks || []; break; }
    }
    // 同一消息里的图片都进预览列表（已下载的用本地路径，其余用原始 src），支持左右滑动。
    const urls = [];
    blocks.forEach((block) => {
      if (!block || block.type !== 'image') return;
      const url = (block.imageState === 'local' && block.localPath) || block.src || '';
      if (url && urls.indexOf(url) < 0) urls.push(url);
    });
    const current = (blocks.find((block) => block && block.type === 'image'
      && (block.localPath === src || block.src === src)) || {}).localPath || src;
    if (urls.indexOf(current) < 0) urls.unshift(current);
    has.previewImage({ current, urls });
  },

  /** 只清内存状态；已下载的文件保留在持久索引里，下次直接命中。 */
  disposeMarkdownImages() {
    if (this._mdImageCache) this._mdImageCache.clear();
    this._mdImageUrgent = [];
    this._mdImageQueue = [];
    this._mdImageQueued = new Set();
    this._mdImageInflight = new Set();
    this._mdImageSession = null;
  }
};
