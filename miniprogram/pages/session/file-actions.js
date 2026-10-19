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
    this.closeFileActions();
    if (file) return this.presentFile(file, 'share');
  },

  cancelFileDownload() {
    if (this._fileJob) this._fileJob.cancelled = true;
  },
  disposePresentedFiles() {
    this.cancelFileDownload();
    (this._localPresentedFiles || []).forEach(file => { void removeFile(file.localPath); });
    this._localPresentedFiles = [];
  },

  async presentFile(source, action) {
    if (this._fileJob || source.sessionId !== store.sessionState.sessionId || this._unloaded) return;
    const file = describe(source), client = store.client, sessionId = source.sessionId;
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
      this._localPresentedFiles.push(local);
      // Keep a bounded set for native previews; no unbounded user-data cache.
      while (this._localPresentedFiles.length > 3) void removeFile(this._localPresentedFiles.shift().localPath);
      const fail = error => {
        if (current() && !/cancel/i.test(error && error.errMsg || '')) wx.showModal({ title: t('文件暂时无法预览'),
          content: t('可以通过文件菜单转发文件，再使用支持此格式的应用打开。'), showCancel: false });
      };
      if (action === 'share' || file.previewKind === 'file') {
        if (typeof wx.shareFileMessage !== 'function') throw Error(t('当前微信版本不支持转发文件，请升级微信'));
        wx.shareFileMessage({ filePath: local.localPath, fileName: file.name, fail });
      } else if (file.previewKind === 'image') {
        wx.previewImage({ current: local.localPath, urls: [local.localPath], fail });
      } else if (file.previewKind === 'document') {
        wx.openDocument({ filePath: local.localPath, fileType: file.extension, showMenu: true, fail });
      } else {
        const result = local.size ? await fsCall(wx.getFileSystemManager(), 'readFile', { filePath: local.localPath,
          encoding: 'utf8', position: 0, length: Math.min(local.size, TEXT_LIMIT) }) : { data: '' };
        // Text only: never execute HTML/SVG/JS delivered by an agent.
        if (current() && !job.cancelled) this.setData({ filePreview: Object.assign({}, file, { text: result.data,
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
