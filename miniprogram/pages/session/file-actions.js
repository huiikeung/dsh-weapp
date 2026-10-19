const store = require('../../utils/store');
const { t } = require('../../utils/ui-preferences');
const { describe } = require('../../utils/file-deliverables');
const { downloadFile, removeFile, fsCall } = require('../../utils/file-download');
const TEXT_LIMIT = 128 * 1024;

module.exports = {
  findPresentedFile(e) {
    const key = e.currentTarget.dataset.key;
    for (const row of this.data.rows) {
      const file = (row.files || []).find(item => item.key === key);
      if (file && file.sessionId === store.sessionState.sessionId) return file;
    }
    return null;
  },

  toggleFileCards(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ fileExpanded: Object.assign({}, this.data.fileExpanded, { [key]: !this.data.fileExpanded[key] }) });
  },

  showFileActions(e) {
    const file = this.findPresentedFile(e);
    if (file) this.setData({ fileSheet: file });
  },
  closeFileActions() { this.setData({ fileSheet: null }); },
  closeFilePreview() { this.setData({ filePreview: null }); },
  copyPresentedPath() {
    if (this.data.fileSheet) wx.setClipboardData({ data: this.data.fileSheet.path });
    this.closeFileActions();
  },
  openPresentedFile(e) {
    const file = this.findPresentedFile(e);
    if (file) return this.presentFile(file, 'preview');
  },
  previewSelectedFile() {
    const file = this.data.fileSheet; this.closeFileActions();
    if (file) return this.presentFile(file, 'preview');
  },
  shareSelectedFile() {
    const file = this.data.fileSheet || this.data.filePreview;
    if (!file) return;
    // Use the verified preview download in the tap handler: no second network trip
    // and no lost user gesture when opening WeChat's recipient picker.
    const local = this.cachedPresentedFile(file);
    if (local) return this.shareLocalFile(file, local);
    return this.presentFile(file, 'share');
  },
  cachedPresentedFile(file) {
    if (this._unloaded || file.sessionId !== store.sessionState.sessionId) return null;
    const files = this._localPresentedFiles || [];
    for (let index = files.length - 1; index >= 0; index--) {
      const local = files[index];
      if (local.sessionId === file.sessionId && local.path === file.path && local.key === file.key &&
        local.seq === file.seq && (!file.localPath || local.localPath === file.localPath) &&
        local.client === store.client && local.generation === (store.client && store.client.connectGeneration)) return local;
    }
    return null;
  },
  shareLocalFile(file, local) {
    if (this._fileShare || this._unloaded || file.sessionId !== store.sessionState.sessionId) return;
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showModal({ title: t('文件转发失败'), content: t('当前微信版本不支持转发文件，请升级微信'), showCancel: false });
      return;
    }
    const request = { local }; this._fileShare = request;
    this.setData({ fileSharingKey: file.key });
    const current = () => !this._unloaded && file.sessionId === store.sessionState.sessionId &&
      local.client === store.client && local.generation === (store.client && store.client.connectGeneration);
    const finish = () => {
      if (this._fileShare === request) {
        this._fileShare = null;
        if (!this._unloaded) this.setData({ fileSharingKey: '' });
      }
      if (request.removeAfter) void removeFile(local.localPath);
    };
    const fail = error => {
      if (!current()) return;
      const message = String(error && (error.errMsg || error.message) || '');
      if (/cancel/i.test(message)) return;
      if (/gesture|user.*tap/i.test(message)) {
        // Keep the cached file and the button; the next tap invokes sharing directly.
        if (!this.data.filePreview) this.setData({ fileSheet: file });
        wx.showToast({ title: t('文件已准备好，请再次点击转发'), icon: 'none' });
        return;
      }
      if (/no such file|not exist|file not found/i.test(message)) {
        this._localPresentedFiles = (this._localPresentedFiles || []).filter(item => item !== local);
        void removeFile(local.localPath);
      }
      wx.showModal({ title: t('文件转发失败'),
        content: t('请在手机微信中重试转发。') + (message ? '\n' + message : ''), showCancel: false });
    };
    try {
      wx.shareFileMessage({ filePath: local.localPath, fileName: file.name,
        success: () => { if (current()) this.closeFileActions(); }, fail, complete: finish });
    } catch (error) { fail(error); finish(); }
  },

  cancelFileDownload() {
    if (this._fileJob) this._fileJob.cancelled = true;
  },
  disposePresentedFiles() {
    this.cancelFileDownload();
    (this._localPresentedFiles || []).forEach(file => {
      if (this._fileShare && this._fileShare.local === file) this._fileShare.removeAfter = true;
      else void removeFile(file.localPath);
    });
    this._localPresentedFiles = [];
  },

  async presentFile(source, action) {
    if (source.sessionId !== store.sessionState.sessionId || this._unloaded) return;
    if (this._fileJob) { wx.showToast({ title: t('文件正在下载，请稍候'), icon: 'none' }); return; }
    if (action === 'share') {
      const cached = this.cachedPresentedFile(source);
      if (cached) return this.shareLocalFile(describe(source), cached);
    }
    const file = describe(source), client = store.client, sessionId = source.sessionId;
    if (!client) { wx.showModal({ title: t('文件打开失败'), content: t('请先连接网关后重试'), showCancel: false }); return; }
    const generation = client.connectGeneration;
    const current = () => !this._unloaded && !this._voiceHidden &&
      client === store.client && generation === client.connectGeneration && sessionId === store.sessionState.sessionId;
    const job = {}; this._fileJob = job;
    this.setData({ fileBusyKey: file.key, fileProgress: 0 });
    try {
      const listed = (store.state.sessions || []).find(item => item.sessionId === sessionId || item.id === sessionId);
      const local = await downloadFile(client, file, { job, cwd: store.sessionState.cwd || (listed && listed.cwd),
        isCurrent: current, onProgress: percent => {
          if (current() && percent !== this.data.fileProgress) this.setData({ fileProgress: percent });
        } });
      if (!current() || job.cancelled) { await removeFile(local.localPath); return; }
      if (!this._localPresentedFiles) this._localPresentedFiles = [];
      local.client = client; local.generation = generation;
      this._localPresentedFiles.push(local);
      // Keep a bounded set for native previews; no unbounded user-data cache.
      while (this._localPresentedFiles.length > 3) {
        const index = this._localPresentedFiles.findIndex(item => item !== local &&
          (!this._fileShare || item !== this._fileShare.local) &&
          (!this.data.filePreview || item.localPath !== this.data.filePreview.localPath));
        if (index < 0) break;
        void removeFile(this._localPresentedFiles.splice(index, 1)[0].localPath);
      }
      const fail = error => {
        if (current() && !/cancel/i.test(error && error.errMsg || '')) wx.showModal({ title: t('文件暂时无法预览'),
          content: t('可以通过文件菜单转发文件，再使用支持此格式的应用打开。'), showCancel: false });
      };
      if (action === 'share' || file.previewKind === 'file') {
        if (!this.data.filePreview) this.setData({ fileSheet: file });
        this.shareLocalFile(file, local);
      } else if (file.previewKind === 'image') {
        wx.previewImage({ current: local.localPath, urls: [local.localPath], fail });
      } else if (file.previewKind === 'document') {
        wx.openDocument({ filePath: local.localPath, fileType: file.extension, showMenu: true, fail });
      } else {
        const result = local.size ? await fsCall(wx.getFileSystemManager(), 'readFile', { filePath: local.localPath,
          encoding: 'utf8', position: 0, length: Math.min(local.size, TEXT_LIMIT) }) : { data: '' };
        // Text only: never execute HTML/SVG/JS delivered by an agent.
        if (current() && !job.cancelled) this.setData({ filePreview: Object.assign({}, file, { text: result.data, localPath: local.localPath,
          truncated: local.size > TEXT_LIMIT, sourceCode: /^(html?|svg|js)$/.test(file.extension) }) });
      }
    } catch (error) {
      if (current() && !job.cancelled && !error.cancelled) {
        const messages = { 'file-not-found': '文件已移动或删除，请让 DSH 重新生成',
          'file-not-allowed': '文件不在当前会话工作目录内', 'file-download-disabled': '当前网关未开启文件下载',
          'file-workspace-unavailable': '无法确定会话工作目录，请刷新会话后重试' };
        wx.showModal({ title: t('文件打开失败'), content: t(messages[error.code]) || error.message || t('文件下载失败，请重试'), showCancel: false });
      }
    } finally {
      if (this._fileJob === job) {
        this._fileJob = null;
        if (!this._unloaded) this.setData({ fileBusyKey: '', fileProgress: 0 });
      }
    }
  }
};
