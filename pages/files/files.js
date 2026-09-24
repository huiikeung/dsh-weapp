const store = require('../../utils/store');
const util = require('../../utils/util');
const theme = require('../../utils/theme');

Page({
  data: {
    mode: 'browser', // browser | picker
    displayPath: '工作区根目录',
    isRoot: true,
    entries: [],
    loading: true,
    error: ''
  },

  onLoad(options) {
    theme.applyTo(this);
    this.mode = (options && options.mode) || 'browser';
    this.sessionId = store.sessionState.sessionId;
    this.workspaceRoot = this.resolveWorkspaceRoot();
    this.relPath = null; // 相对工作区根的路径，null = 根
    this.setData({ mode: this.mode });
    this.load(null);
  },

  /** 当前会话所属工作区的绝对路径（用于展示）。 */
  resolveWorkspaceRoot() {
    const ws = (store.state.workspaces || []).find(
      (w) => w.workspaceId === store.state.currentWorkspaceId
    );
    return (ws && ws.path) || '';
  },

  /** 相对路径 → 展示用绝对路径。 */
  absolutePath(rel) {
    if (!rel || rel === '.') return this.workspaceRoot || '工作区根目录';
    return this.workspaceRoot ? this.workspaceRoot + '/' + rel : rel;
  },

  load(relPath) {
    if (!this.sessionId) {
      this.setData({ loading: false, error: '请先打开一个会话', entries: [] });
      return;
    }
    if (store.state.connection !== 'connected') {
      this.setData({ loading: false, error: '请先连接 DeepSeek Harness', entries: [] });
      return;
    }
    this.relPath = relPath || null;
    this.setData({ loading: true, error: '' });
    store.client.requestFileList(this.sessionId, relPath)
      .then((frame) => {
        if (!frame) return;
        const entries = (frame.entries || frame.items || []).map((item) => ({
          name: item.name || item.title || '',
          path: item.path || '',
          kind: item.kind === 'dir' || item.kind === 'directory' ? 'dir' : 'file',
          iconFile: entryIconFile(item),
          subLabel: describeEntry(item)
        }));
        this.relPath = frame.path || this.relPath || null;
        this.setData({
          entries: entries,
          isRoot: !this.relPath || this.relPath === '.' || this.relPath === '/',
          displayPath: this.absolutePath(this.relPath),
          loading: false
        });
      })
      .catch((err) => {
        this.setData({ loading: false, error: err.message || '读取目录失败' });
      });
  },

  openEntry(e) {
    const item = this.data.entries[e.currentTarget.dataset.index];
    if (!item) return;
    if (item.kind === 'dir') {
      this.load(item.path);
      return;
    }
    wx.showModal({
      title: item.name,
      content: item.path,
      showCancel: this.data.mode === 'picker',
      confirmText: this.data.mode === 'picker' ? '用作工作区' : '知道了',
      success: (res) => {
        if (res.confirm && this.data.mode === 'picker') {
          this.createWorkspace(item.path);
        }
      }
    });
  },

  goUp() {
    const rel = this.relPath;
    if (!rel || rel === '.' || rel === '/') {
      this.load(null);
      return;
    }
    const idx = rel.lastIndexOf('/');
    this.load(idx > 0 ? rel.substring(0, idx) : null);
  },

  newDirectory() {
    const self = this;
    wx.showModal({
      title: '新建目录',
      editable: true,
      placeholderText: '目录名',
      success(res) {
        if (res.confirm && res.content && res.content.trim()) {
          store.client.createDirectory(self.relPath || '', res.content.trim())
            .then(() => {
              wx.showToast({ title: '已创建', icon: 'success' });
              self.load(self.relPath);
            })
            .catch((err) => {
              wx.showToast({ title: err.message || '创建失败', icon: 'none' });
            });
        }
      }
    });
  },

  useThisDirectory() {
    this.createWorkspace(this.relPath || '');
  },

  createWorkspace(path) {
    if (!path) {
      wx.showToast({ title: '请选择具体目录', icon: 'none' });
      return;
    }
    const self = this;
    store.client.createWorkspace(path)
      .then(() => {
        wx.showToast({ title: '工作区已就绪', icon: 'success' });
        setTimeout(() => {
          store.client.requestWorkspaces();
          wx.navigateBack();
        }, 400);
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '创建失败', icon: 'none' });
      });
  }
});

function entryIconFile(item) {
  if (item.kind === 'dir' || item.kind === 'directory') return 'ic-dir-folder-blue.png';
  const ext = (item.name || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'].indexOf(ext) >= 0) return 'photo-ocean.png';
  if (['md', 'doc', 'docx', 'rtf', 'pages'].indexOf(ext) >= 0) return 'doc-richtext-ocean.png';
  if (['txt', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'csv'].indexOf(ext) >= 0) return 'doc-text-ocean.png';
  if (['zip', 'tar', 'gz', '7z', 'rar', 'pkg', 'dmg'].indexOf(ext) >= 0) return 'box-ocean.png';
  return 'doc-ocean.png';
}

function describeEntry(item) {
  const parts = [];
  if (item.kind !== 'dir' && item.kind !== 'directory' && item.bytes !== undefined && item.bytes !== null) {
    parts.push(util.formatBytes(item.bytes));
  }
  if (item.modifiedAt) parts.push(formatDate(item.modifiedAt));
  if (item.hidden) parts.push('隐藏');
  return parts.join(' · ');
}

function formatDate(epoch) {
  const ms = typeof epoch === 'string' ? parseInt(epoch, 10) : epoch;
  if (!ms || isNaN(ms)) return '';
  const d = new Date(ms * (ms < 1e12 ? 1000 : 1));
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
