const util = require('../../utils/util');

function mentionSessionCandidates(sessions, options) {
  const currentSessionId = String(options.currentSessionId || '');
  const current = (sessions || []).find(item => item && String(item.sessionId || item.id || '') === currentSessionId) || {};
  const currentCwd = current.cwd || '';
  const seen = new Set();
  const rows = [];
  (Array.isArray(sessions) ? sessions : []).forEach((session, index) => {
    if (!session) return;
    const id = String(session.sessionId || session.id || '');
    if (!id || id === currentSessionId || seen.has(id)
      || session.blank === true || session.hasConversation === false) return;
    seen.add(id);
    const child = (session.parentSessionId || session.parentId) === currentSessionId;
    const title = String((child && session.displayTitle) || session.title || session.displayTitle || session.name || id);
    const cwd = String(session.cwd || session.workingDirectory || '');
    rows.push({
      id,
      title,
      detail: cwd && cwd !== currentCwd ? cwd : util.formatRelativeTime(Number(session.updatedAt) || 0),
      searchText: [title, id, cwd].join(' ').toLocaleLowerCase(),
      group: child ? 'subagents' : 'sessions',
      sameWorkspace: !!currentCwd && cwd === currentCwd,
      updatedAt: Number(session.updatedAt) || 0,
      key: 'session:' + id + ':' + index
    });
  });
  return rows.sort((a, b) => Number(b.sameWorkspace) - Number(a.sameWorkspace)
    || b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
}

module.exports = ({ store, composerMenu, uiText }) => ({
  trackFileMention(text, cursor) {
    // 传入的就是 textarea 当前显示值：顺手刷新镜像，插入 / 钻取都按它定位。
    this._composerDisplay = String(text == null ? '' : text);
    const mention = composerMenu.referenceAtCursor(text, cursor);
    if (!mention || this.data.tab !== 'conversation') {
      if (this.data.fileMentionOpen || this._activeFileMention) this.closeFileMention();
      return;
    }
    const path = String(mention.query || '').replace(/\\/g, '/');
    const slash = path.lastIndexOf('/');
    const directory = slash >= 0 ? path.slice(0, slash) : '';
    const filter = slash >= 0 ? path.slice(slash + 1) : path;
    this._activeFileMention = Object.assign({}, mention, { query: path, directory, filter });
    const quoted = mention.quoted === true;
    const sessions = !directory && !quoted
      ? mentionSessionCandidates(store.state && store.state.sessions, {
        currentSessionId: store.sessionState && store.sessionState.sessionId
      }).filter(item => !filter || item.searchText.includes(filter.toLocaleLowerCase()))
      : [];
    const sessionGroups = [
      { key: 'subagents', label: uiText('子智能体'), items: sessions.filter(item => item.group === 'subagents') },
      { key: 'sessions', label: uiText('对话'), items: sessions.filter(item => item.group === 'sessions') }
    ].filter(group => group.items.length);
    this.setData({ fileMentionOpen: true, fileMentionPathLabel: directory || uiText('工作区根目录'), fileMentionQuery: filter, fileMentionError: '', fileMentionSessionGroups: sessionGroups });
    if (this._fileMentionSessionId === store.sessionState.sessionId && this._fileMentionDirectory === directory && Array.isArray(this._fileMentionSourceEntries)) {
      this.filterFileMentionEntries(filter);
      return;
    }
    this.loadFileMentionDirectory(directory);
  },

  loadFileMentionDirectory(directory) {
    const sessionId = (store.sessionState && store.sessionState.sessionId) || '';
    if (!sessionId) {
      this.setData({ fileMentionLoading: false, fileMentionEntries: [], fileMentionError: uiText('请先打开一个会话') });
      return;
    }
    if (!store.state || store.state.connection !== 'connected') {
      this.setData({ fileMentionLoading: false, fileMentionEntries: [], fileMentionError: uiText('请先连接鲸尾 Harness') });
      return;
    }
    const request = this._fileMentionRequest = {};
    const target = String(directory || '');
    this._fileMentionSessionId = sessionId;
    this._fileMentionDirectory = target;
    this._fileMentionSourceEntries = null;
    this.setData({ fileMentionLoading: true, fileMentionEntries: [], fileMentionError: '' });
    store.client.requestFileList(sessionId, target || null).then(frame => {
      if (this._unloaded || this._fileMentionRequest !== request || !this.data.fileMentionOpen
        || !this._activeFileMention || this._activeFileMention.directory !== target
        || store.sessionState.sessionId !== sessionId) return;
      this._fileMentionSourceEntries = (frame && (frame.entries || frame.items) || []).map((item, index) => {
        const name = item.name || item.title || '';
        const kind = item.kind === 'dir' || item.kind === 'directory' ? 'dir' : 'file';
        const itemPath = String(item.path || (target ? target + '/' : '') + name).replace(/\\/g, '/');
        return { name, path: itemPath, kind, iconFile: kind === 'dir' ? 'menu-folder.svg' : 'menu-chat-file.svg', key: itemPath + ':' + index };
      });
      this.setData({ fileMentionLoading: false, fileMentionPathLabel: target || uiText('工作区根目录'), fileMentionError: '' });
      this.filterFileMentionEntries(this._activeFileMention.filter);
    }).catch(err => {
      if (this._unloaded || this._fileMentionRequest !== request || !this.data.fileMentionOpen
        || !this._activeFileMention || this._activeFileMention.directory !== target) return;
      this.setData({ fileMentionLoading: false, fileMentionEntries: [], fileMentionError: err.message || uiText('读取目录失败') });
    });
  },

  filterFileMentionEntries(query) {
    const filter = String(query || '').toLocaleLowerCase();
    const source = this._fileMentionSourceEntries || [];
    const entries = source.filter(item => !filter || item.name.toLocaleLowerCase().includes(filter));
    this.setData({ fileMentionEntries: entries, fileMentionLoading: false });
  },

  closeFileMention() {
    this._fileMentionRequest = null;
    this._activeFileMention = null;
    this._fileMentionSourceEntries = null;
    this._fileMentionDirectory = null;
    this._fileMentionSessionId = null;
    if (this.data.fileMentionOpen || this.data.fileMentionEntries.length || this.data.fileMentionError) {
      this.setData({ fileMentionOpen: false, fileMentionEntries: [], fileMentionSessionGroups: [], fileMentionLoading: false, fileMentionError: '', fileMentionPathLabel: '', fileMentionQuery: '' });
    }
  },

  selectFileMention(e) {
    const active = this._activeFileMention;
    const index = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    const item = (this.data.fileMentionEntries || [])[index];
    if (!active || !item) return;
    if (item.id) {
      this.insertFileMention(composerMenu.sessionReference(item.id, item.title));
      return;
    }
    const isDirectory = item.kind === 'dir';
    const reference = composerMenu.fileReference(item.path + (isDirectory ? '/' : ''));
    if (reference) this.insertFileMention(reference);
  },

  selectSessionMention(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset || {};
    this.insertFileMention(composerMenu.sessionReference(dataset.id, dataset.title));
  },

  insertFileMention(reference) {
    const active = this._activeFileMention;
    if (!active || !reference) return;
    // 选中的引用是完整 token：显示值里换成一个零宽占位符，chip 行渲染图标 + 标题，
    // 草稿仍保存原始引用文本（active.start/end 都是显示值坐标）。
    const parsed = composerMenu.parseReferences(reference);
    if (!parsed.refs.length) return;
    const display = this.composerDisplay();
    const refs = (this.data.composerRefs || []).slice();
    const before = display.slice(0, active.start).split(composerMenu.REF_PLACEHOLDER).length - 1;
    const nextDisplay = display.slice(0, active.start) + composerMenu.REF_PLACEHOLDER + display.slice(active.end);
    const nextRefs = refs.slice(0, before).concat(composerMenu.referenceChips(parsed.refs), refs.slice(before));
    // 指令 token 不在显示值里：拼回原始草稿时补上，setComposerValue 再替 chip 剥掉。
    const slash = this.composerSlash();
    const next = (slash ? slash.token + ' ' : '') + composerMenu.displayToDraft(nextDisplay, nextRefs);
    const cursor = active.start + 1;
    this.closeFileMention();
    this._draftRevision = (this._draftRevision || 0) + 1;
    this._composerCursor = cursor;
    this.setComposerValue(next, { draft: next, composerCursor: cursor, canSend: !!next.trim() || this.data.images.length > 0, composerFocus: true });
    this.syncCommandMenu(next, store.sessionState);
  },

  drillFileMention(e) {
    const active = this._activeFileMention;
    const index = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    const item = (this.data.fileMentionEntries || [])[index];
    if (!active || !item || item.kind !== 'dir') return;
    const path = item.path.replace(/\\/g, '/') + '/';
    const prefix = composerMenu.fileReferencePrefix(path, active.quoted);
    if (!prefix) return;
    const quoted = prefix.startsWith('@"');
    // 半开引用 token 还没选完文件：保持字面文本留在显示值里，@ 菜单继续跟着它。
    const reference = prefix + (quoted ? '"' : '');
    const display = this.composerDisplay();
    const nextDisplay = display.slice(0, active.start) + reference + display.slice(active.end);
    const cursor = active.start + reference.length - (quoted ? 1 : 0);
    this._draftRevision = (this._draftRevision || 0) + 1;
    this._composerCursor = cursor;
    this.setComposerDisplay(nextDisplay, this.data.composerRefs || [], { composerCursor: cursor, composerFocus: true }, this.composerSlash());
    this.trackFileMention(nextDisplay, cursor);
  },

  retryFileMention() {
    if (this._activeFileMention) this.loadFileMentionDirectory(this._activeFileMention.directory);
  }
});
