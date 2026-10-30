const store = require('../../utils/store');
const { t } = require('../../utils/ui-preferences');
const { describe } = require('./utils/file-deliverables');
const filePreview = require('./utils/file-preview');
const { downloadFile, removeFile } = require('./utils/file-download');

// 这个 mixin 既被页面加载，也被 Node 测试直接 require；后者没有全局 wx，
// 所以一律走守卫访问，别用 `typeof wx.x`（引用未声明变量仍会抛）。
function wxApi() { return typeof has !== 'undefined' ? has : null; }

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

  canShareFiles() { const api = wxApi(); return !!api && typeof api.shareFileMessage === 'function'; },

  /** 统一入口：待发送文件 / 已发送消息附件 / 交付文件都打开同一个底部弹窗。 */
  openFileSheet(source, options = {}) {
    if (this._unloaded || !source) return null;
    const file = filePreview.openSheet(source, options);
    const api = wxApi();
    const sheet = Object.assign({}, file, { canShare: !!file.localPath && !!api && typeof api.shareFileMessage === 'function' });
    this.setData({ filePreview: sheet, fileSharingKey: '' });
    // 本地文件（输入框临时文件、已缓存附件）直接可看；网关文件按需拉取，
    // 文档类不预下载——正文交给微信查看器，等用户点「用微信打开」再传。
    if (file.localPath && file.previewKind === 'text') this.loadFileSheetText(sheet, api);
    else if (!file.localPath && file.sessionId && file.path && file.previewKind !== 'document' && file.previewKind !== 'file') this.presentFile(file, 'preview');
    return sheet;
  },

  patchFileSheet(key, patch) {
    if (this._unloaded || !this.data.filePreview || this.data.filePreview.key !== key) return;
    this.setData({ filePreview: Object.assign({}, this.data.filePreview, patch) });
  },

  loadFileSheetText(sheet, api) {
    if (!sheet || !sheet.localPath) return;
    filePreview.readLocalText(api || wxApi(), sheet.localPath, sheet.size)
      .then(result => this.patchFileSheet(sheet.key, result))
      .catch(() => this.patchFileSheet(sheet.key, { error: t('文件暂时无法预览') }));
  },

  openPresentedFile(e) {
    const file = this.findPresentedFile(e);
    if (file) return this.openFileSheet(file, { origin: 'delivered' });
  },
  closeFilePreview() { this.setData({ filePreview: null }); },
  copyPresentedPath() {
    const sheet = this.data.filePreview;
    if (sheet && sheet.path) has.setClipboardData({ data: sheet.path });
    this.setData({ filePreview: null });
  },

  /** 弹窗主操作：按类型分别内嵌渲染、复制、调起微信查看器或转发。 */
  filePreviewPrimary() {
    const sheet = this.data.filePreview;
    if (!sheet || this.data.fileBusyKey) return;
    if (sheet.selection) return this.copyTextSelection();
    if (sheet.previewKind === 'text') return sheet.localPath ? this.copyTextSelection() : this.presentFile(sheet, 'preview');
    if (sheet.previewKind === 'image') {
      if (!sheet.localPath) return this.presentFile(sheet, 'open');
      const api = wxApi();
      if (api && typeof api.previewImage === 'function') api.previewImage({ current: sheet.localPath, urls: [sheet.localPath] });
      return;
    }
    if (sheet.previewKind === 'document') {
      if (!sheet.localPath) return this.presentFile(sheet, 'open');
      return this.openNativeDocument(sheet);
    }
    return this.shareSelectedFile();
  },

  openNativeDocument(sheet) {
    const api = wxApi();
    if (!api || typeof api.openDocument !== 'function') return;
    const fail = error => {
      if (/cancel/i.test((error && (error.errMsg || error.message)) || '')) return;
      api.showModal({ title: t('文件暂时无法预览'),
        content: t('可以通过文件菜单转发文件，再使用支持此格式的应用打开。'), showCancel: false });
    };
    api.openDocument({ filePath: sheet.localPath, fileType: filePreview.openDocumentType(sheet.extension), showMenu: true, fail });
  },

  shareSelectedFile() {
    const file = this.data.filePreview;
    if (!file) return;
    const local = this.cachedPresentedFile(file);
    if (local) return this.shareLocalFile(file, local);
    // 输入框里的临时文件本机就在，直接转发，不必走网关下载。
    if (file.localPath && !file.sessionId) return this.shareLocalFile(file, { localPath: file.localPath });
    return this.presentFile(file, 'share');
  },
  cachedPresentedFile(file) {
    if (this._unloaded || (file.sessionId && file.sessionId !== store.sessionState.sessionId)) return null;
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
    if (this._fileShare || this._unloaded) return;
    if (file.sessionId && file.sessionId !== store.sessionState.sessionId) return;
    if (typeof has.shareFileMessage !== 'function') {
      has.showModal({ title: t('文件转发失败'), content: t('当前微信版本不支持转发文件，请升级微信'), showCancel: false });
      return;
    }
    const request = { local }; this._fileShare = request;
    this.setData({ fileSharingKey: file.key });
    const current = () => !this._unloaded && (!local.client ||
      (local.client === store.client && local.generation === (store.client && store.client.connectGeneration)));
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
        has.showToast({ title: t('文件已准备好，请再次点击转发'), icon: 'none' });
        return;
      }
      if (/no such file|not exist|file not found/i.test(message)) {
        this._localPresentedFiles = (this._localPresentedFiles || []).filter(item => item !== local);
        void removeFile(local.localPath);
      }
      has.showModal({ title: t('文件转发失败'),
        content: t('请在手机微信中重试转发。') + (message ? '\n' + message : ''), showCancel: false });
    };
    try {
      has.shareFileMessage({ filePath: local.localPath, fileName: file.name,
        success: () => { if (current()) this.closeFilePreview(); }, fail, complete: finish });
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
    if (this._fileJob) { has.showToast({ title: t('文件正在下载，请稍候'), icon: 'none' }); return; }
    if (action === 'share') {
      const cached = this.cachedPresentedFile(source);
      if (cached) return this.shareLocalFile(describe(source), cached);
    }
    const file = describe(source), client = store.client, sessionId = source.sessionId;
    if (!client) { has.showModal({ title: t('文件打开失败'), content: t('请先连接网关后重试'), showCancel: false }); return; }
    const generation = client.connectGeneration;
    const current = () => !this._unloaded && !this._voiceHidden &&
      client === store.client && generation === client.connectGeneration && sessionId === store.sessionState.sessionId;
    const job = {}; this._fileJob = job;
    this.setData({ fileBusyKey: file.key, fileProgress: 0 });
    this.patchFileSheet(file.key, { error: '' });
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
      const revealed = filePreview.reveal(file, local);
      revealed.canShare = this.canShareFiles();
      this.setData({ filePreview: revealed });
      if (action === 'share' || revealed.previewKind === 'file') return this.shareLocalFile(file, local);
      if (action === 'open') {
        if (revealed.previewKind === 'document') return this.openNativeDocument(revealed);
        if (revealed.previewKind === 'image') return has.previewImage({ current: local.localPath, urls: [local.localPath] });
      }
      if (revealed.previewKind === 'text') return this.loadFileSheetText(revealed);
    } catch (error) {
      if (current() && !job.cancelled && !error.cancelled) {
        const messages = { 'file-not-found': '文件已移动或删除，请让 DSH 重新生成',
          'file-not-allowed': '文件不在当前会话工作目录内', 'file-download-disabled': '当前网关未开启文件下载',
          'file-workspace-unavailable': '无法确定会话工作目录，请刷新会话后重试' };
        const note = t(messages[error.code]) || error.message || t('文件下载失败，请重试');
        if (this.data.filePreview && this.data.filePreview.key === file.key) this.setData({ filePreview: Object.assign({}, this.data.filePreview, { error: note }) });
        else has.showModal({ title: t('文件打开失败'), content: note, showCancel: false });
      }
    } finally {
      if (this._fileJob === job) {
        this._fileJob = null;
        if (!this._unloaded) this.setData({ fileBusyKey: '', fileProgress: 0 });
      }
    }
  }
};
