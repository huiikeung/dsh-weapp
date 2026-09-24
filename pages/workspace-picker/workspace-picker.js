const store = require('../../utils/store');
const theme = require('../../utils/theme');

// 对齐 dsh-mobile v1.6.0 WorkspaceDirectoryBrowserSheet：
// 远端目录浏览 + 新建文件夹 + 在当前目录创建工作区。
Page({
  data: {
    dirPath: '',
    dirCrumbs: [],
    dirEntries: [],
    dirLoading: false,
    dirError: '',
    dirCreatingWs: false,
    dirCreatingDir: false,
    parentPath: null,
    scrollInto: ''
  },

  onLoad() {
    theme.applyTo(this);
    this.loadRoot();
  },

  loadRoot() {
    if (store.state.connection !== 'connected') {
      this.setData({ dirLoading: false, dirError: '请先连接 DeepSeek Harness', dirEntries: [] });
      return;
    }
    this.setData({ dirLoading: true, dirError: '', dirEntries: [] });
    store.client.requestDirectories(null)
      .then((frame) => this.applyFrame(frame, null))
      .catch((err) => this.setData({ dirLoading: false, dirError: err.message || '读取目录失败' }));
  },

  applyFrame(frame, requestedPath) {
    if (!frame) return;
    const entries = (frame.entries || [])
      .map((item) => ({
        name: item.name,
        path: item.path,
        hidden: item.hidden === true,
        highlight: false
      }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const crumbs = frame.crumbs || [];
    const parentPath = crumbs.length > 1 ? crumbs[crumbs.length - 2].path : null;
    this.setData({
      dirEntries: entries,
      dirCrumbs: crumbs,
      dirPath: frame.path || requestedPath || '',
      parentPath,
      dirLoading: false
    });
  },

  browseTo(path) {
    if (this.data.dirLoading || this.data.dirCreatingWs || this.data.dirCreatingDir) return;
    if (store.state.connection !== 'connected') {
      this.setData({ dirLoading: false, dirError: '请先连接 DeepSeek Harness' });
      return;
    }
    this.setData({ dirLoading: true, dirError: '' });
    store.client.requestDirectories(path)
      .then((frame) => this.applyFrame(frame, path))
      .catch((err) => this.setData({ dirLoading: false, dirError: err.message || '读取目录失败' }));
  },

  openDirEntry(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.dirEntries[index];
    if (!item) return;
    this.browseTo(item.path);
  },

  goParentDir() {
    if (this.data.dirLoading) return;
    const parent = this.data.parentPath;
    if (parent) {
      this.browseTo(parent);
    } else {
      this.loadRoot();
    }
  },

  newDirectory() {
    if (this.data.dirLoading || this.data.dirCreatingWs || this.data.dirCreatingDir || !this.data.dirPath) return;
    const self = this;
    wx.showModal({
      title: '新建文件夹',
      content: '将在当前目录中创建一个新的子文件夹。',
      editable: true,
      placeholderText: '文件夹名称',
      success(res) {
        if (!res.confirm || !res.content || !res.content.trim()) return;
        const parent = self.data.dirPath;
        self.setData({ dirCreatingDir: true });
        store.client.createDirectory(parent, res.content.trim())
          .then(() => {
            self.setData({ dirCreatingDir: false });
            // 创建后刷新当前目录并高亮新目录
            self._createdPath = (parent === '/' ? '' : parent) + '/' + res.content.trim();
            self.browseTo(parent);
            self.highlightCreated();
          })
          .catch((err) => {
            self.setData({ dirCreatingDir: false });
            wx.showToast({ title: err.message || '创建失败', icon: 'none' });
          });
      }
    });
  },

  highlightCreated() {
    const path = this._createdPath;
    if (!path) return;
    const entries = this.data.dirEntries.map((item) => ({
      ...item,
      highlight: item.path === path
    }));
    const index = entries.findIndex((item) => item.path === path);
    this.setData({
      dirEntries: entries,
      scrollInto: index >= 0 ? 'dir-' + index : ''
    });
    if (index >= 0) {
      setTimeout(() => {
        const clear = this.data.dirEntries.map((item) => ({ ...item, highlight: false }));
        this.setData({ dirEntries: clear });
      }, 1600);
    }
    this._createdPath = null;
  },

  createWorkspaceHere() {
    const path = this.data.dirPath;
    if (!path || this.data.dirCreatingWs || this.data.dirCreatingDir || this.data.dirLoading) return;
    this.setData({ dirCreatingWs: true });
    store.client.createWorkspace(path)
      .then(() => {
        wx.showToast({ title: '工作区已就绪', icon: 'success' });
        setTimeout(() => {
          store.client.requestWorkspaces();
          wx.navigateBack();
        }, 500);
      })
      .catch((err) => {
        this.setData({ dirCreatingWs: false });
        wx.showToast({ title: err.message || '创建失败', icon: 'none' });
      });
  },

  goBack() {
    wx.navigateBack();
  }
});
