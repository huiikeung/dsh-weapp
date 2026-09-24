const store = require('../../utils/store');
const util = require('../../utils/util');
const labels = require('../../utils/labels');
const hostsLib = require('../../utils/hosts');

const CONNECTION_LABELS = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  failed: '连接失败'
};

Page({
  data: {
    pairMenuVisible: false,
    manualSheetOpen: false,
    pairingText: '',
    pairingResult: '',
    pairingResultClass: '',
    pairingConnecting: false,
    dirSheetOpen: false,
    dirLoading: false,
    dirCreatingWs: false,
    dirCreatingDir: false,
    dirPath: '',
    dirCrumbs: [],
    dirEntries: [],
    dirError: '',
    currentWorkspace: {},
    displaySessions: [],
    searchQuery: '',
    connectionLabel: '未连接',
    connectionClass: 'disconnected',
    hostLabel: '选择主机',
    hostKindIcon: 'desktop-white.png',
    hostOnline: false,
    hostRows: [],
    hostSheetOpen: false,
    hostEditMode: false,
    hostSelection: [],
    hostEditOpen: false,
    editingHostId: '',
    editingGatewayName: '',
    editAlias: '',
    editKind: 'desktopcomputer',
    workspacePickerOpen: false,
    pickerWorkspaces: [],
    currentWorkspaceId: ''
  },

  onLoad() {
    this.unsubscribe = store.subscribe((snapshot) => {
      this.syncFromStore(snapshot);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  onShow() {
    // 从配对页跳回时刷新一次列表
    if (store.state.connection === 'connected') {
      store.client.requestWorkspaces();
      store.client.requestSessions();
    }
    this.syncHostUI(store.state);
  },

  onUnload() {
    this.stopHostProbeTimer();
    store.stopHostProbes();
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore(snapshot) {
    const app = snapshot.app;
    const conn = app.connection;
    // 对齐 dsh-mobile workspaceScopedSessions：选中工作区优先，否则回退第一个
    const workspaces = app.workspaces || [];
    const current = workspaces.find((w) => w.workspaceId === app.currentWorkspaceId) || workspaces[0] || null;
    const query = app.searchQuery;
    const source = query && app.searchResults
      ? app.searchResults.map((item) => {
          const base = (app.sessions || []).find((s) => s.sessionId === item.sessionId) || {};
          return Object.assign({}, base, {
            sessionId: item.sessionId,
            snippet: item.snippet,
            searchIcon: item.kind === 'tool' ? 'wrench-orange' : 'bubble-gray'
          });
        })
      : app.sessions || [];

    // 工作区声明了 sessionIds 时按其过滤；未声明（旧网关）则保持全量展示
    let scopedSource = source;
    if (current && Array.isArray(current.sessionIds)) {
      scopedSource = source.filter((s) => current.sessionIds.indexOf(s.sessionId) >= 0);
    }

    const displaySessions = scopedSource
      .filter((s) => !s.blank)
      .map((s) => ({
        sessionId: s.sessionId,
        updatedAt: s.updatedAt || 0,
        running: s.running,
        agentPreset: s.agentPreset,
        displayTitle: s.title || s.snippet || util.sessionIdLabel(s.sessionId),
        idLabel: util.sessionIdLabel(s.sessionId),
        cwd: s.cwd ? shortPath(s.cwd) : '',
        timeLabel: util.formatRelativeTime(s.updatedAt)
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    this.setData({
      currentWorkspace: current ? {
        title: current.title,
        path: shortPath(current.path),
        workspaceId: current.workspaceId
      } : {},
      displaySessions: displaySessions,
      connectionLabel: CONNECTION_LABELS[conn] || conn,
      connectionClass: conn
    });
    // 手动配对弹窗：连接成功后自动收起（对齐 dsh-mobile 配对完成反馈）
    if (this.data.manualSheetOpen && conn === 'connected' && this.data.pairingConnecting) {
      this.setData({ manualSheetOpen: false, pairingConnecting: false });
      wx.showToast({ title: '配对成功', icon: 'success' });
    }
    this.syncHostUI(app);
  },

  /** 切换主机 UI（GatewaySwitcherBar/Sheet 对齐）。 */
  syncHostUI(app) {
    let profiles = app.profiles || [];
    const conn = app.connection;
    // 兜底：已连接但 profiles 为空时（relay 重连未收到 hello），
    // 用网关连接状态合成一条主机行，确保弹层始终显示当前设备
    if (!profiles.length && conn === 'connected' && app.gatewayName) {
      profiles = [{
        id: app.activeID || '__active__',
        gatewayName: app.gatewayName,
        alias: '',
        deviceKind: 'desktopcomputer',
        endpoints: app.endpoint ? [app.endpoint] : []
      }];
    }
    const active = profiles.find((p) => p.id === app.activeID) || profiles[0] || null;
    const onlineIDs = app.onlineIDs || [];
    const selected = this.data.hostSelection || [];
    const rows = [];
    if (active) rows.push(active);
    profiles.forEach((p) => {
      if (!active || p.id !== active.id) rows.push(p);
    });
    const isOnline = conn === 'connected';
    this.setData({
      hostLabel: active ? hostsLib.displayName(active) : '选择主机',
      hostKindIcon: hostsLib.kindIconFile(active ? active.deviceKind : 'desktopcomputer'),
      hostOnline: active ? (onlineIDs.indexOf(active.id) >= 0 || isOnline) : false,
      hostRows: rows.map((p) => ({
        id: p.id,
        displayName: hostsLib.displayName(p),
        kindIcon: hostsLib.kindIconFile(p.deviceKind),
        online: onlineIDs.indexOf(p.id) >= 0 || (p.id === app.activeID && isOnline),
        subLabel: (p.id === app.activeID || isOnline) ? '当前主机 · 已连接' : '点击连接',
        isActive: p.id === app.activeID,
        selected: selected.indexOf(p.id) >= 0
      }))
    });
  },

  openHostSwitcher() {
    this.setData({ hostSheetOpen: true, hostEditMode: false, hostSelection: [] });
    this.syncHostUI(store.state);
    store.refreshHostPresence();
    this.stopHostProbeTimer();
    this.hostSheetTimer = setInterval(() => {
      store.refreshHostPresence();
    }, 30000);
  },

  closeHostSwitcher() {
    this.stopHostProbeTimer();
    store.stopHostProbes();
    this.setData({
      hostSheetOpen: false,
      hostEditMode: false,
      hostSelection: [],
      hostEditOpen: false
    });
  },

  stopHostProbeTimer() {
    if (this.hostSheetTimer) {
      clearInterval(this.hostSheetTimer);
      this.hostSheetTimer = null;
    }
  },

  toggleHostEditMode() {
    this.setData({ hostEditMode: !this.data.hostEditMode, hostSelection: [] });
  },

  pickHost(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.hostEditMode) {
      this.toggleHostSelectById(id);
      return;
    }
    store.selectHost(id);
    this.closeHostSwitcher();
  },

  toggleHostSelect(e) {
    this.toggleHostSelectById(e.currentTarget.dataset.id);
  },

  toggleHostSelectById(id) {
    const sel = this.data.hostSelection.slice();
    const index = sel.indexOf(id);
    if (index >= 0) sel.splice(index, 1);
    else sel.push(id);
    this.setData({ hostSelection: sel });
    this.syncHostUI(store.state);
  },

  editHostOpen(e) {
    const id = e.currentTarget.dataset.id;
    const profile = (store.state.profiles || []).find((p) => p.id === id);
    if (!profile) return;
    this.setData({
      hostEditOpen: true,
      editingHostId: id,
      editingGatewayName: profile.gatewayName || '未命名主机',
      editAlias: profile.alias || '',
      editKind: profile.deviceKind
    });
  },

  onHostAliasInput(e) {
    this.setData({ editAlias: e.detail.value });
  },

  setHostKind(e) {
    this.setData({ editKind: e.currentTarget.dataset.kind });
  },

  cancelHostEdit() {
    this.setData({ hostEditOpen: false });
  },

  saveHostEdit() {
    store.editHost(this.data.editingHostId, this.data.editAlias, this.data.editKind);
    this.setData({ hostEditOpen: false });
  },

  deleteHosts() {
    const count = this.data.hostSelection.length;
    if (!count) return;
    wx.showModal({
      title: count === 1 ? '删除主机？' : '批量删除主机？',
      content: '从 App 移除选中的 ' + count + ' 台主机及连接凭证；网关上的会话和工作区不会被删除。再次连接需重新配对。',
      confirmText: '删除',
      confirmColor: '#FF3B30',
      success: (res) => {
        if (!res.confirm) return;
        store.removeHosts(this.data.hostSelection);
        this.setData({ hostSelection: [], hostEditMode: false });
      }
    });
  },

  onSearchInput(e) {
    const value = e.detail.value;
    this.setData({ searchQuery: value });
    store.updateSearch(value.trim());
  },

  openWorkspacePicker() {
    this.setData({
      workspacePickerOpen: true,
      pickerWorkspaces: store.state.workspaces || [],
      currentWorkspaceId: store.state.currentWorkspaceId || ''
    });
  },

  closeWorkspacePicker() {
    this.setData({ workspacePickerOpen: false });
  },

  selectWorkspace(e) {
    store.setCurrentWorkspace(e.currentTarget.dataset.id);
    this.setData({ workspacePickerOpen: false });
  },

  // ---------- 目录浏览器弹层（对齐 dsh-mobile v1.6.0 WorkspaceDirectoryBrowserSheet） ----------

  openDirSheet() {
    this.closeWorkspacePicker();
    this.setData({ dirSheetOpen: true, dirEntries: [], dirPath: '', dirLoading: true, dirError: '' });
    this.browseDirs(null);
  },

  closeDirSheet() {
    this.setData({ dirSheetOpen: false });
  },

  browseDirs(path) {
    if (store.state.connection !== 'connected') {
      this.setData({ dirLoading: false, dirError: '请先连接 DeepSeek Harness' });
      return;
    }
    this.setData({ dirLoading: true, dirError: '' });
    store.client.requestDirectories(path)
      .then((frame) => {
        const entries = (frame.entries || frame.items || [])
          .map((item) => ({
            name: item.name || item.title || '',
            path: item.path || '',
            hidden: item.hidden === true
          }))
          .filter((item) => item.name && item.path)
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        const crumbs = frame.crumbs || [];
        this.setData({
          dirEntries: entries,
          dirCrumbs: crumbs,
          dirPath: frame.path || path || '',
          dirLoading: false
        });
      })
      .catch((err) => {
        this.setData({ dirLoading: false, dirError: err.message || '读取目录失败' });
      });
  },

  openDirEntry(e) {
    const item = this.data.dirEntries[e.currentTarget.dataset.index];
    if (!item || this.data.dirLoading) return;
    this.browseDirs(item.path);
  },

  goParentDir() {
    const crumbs = this.data.dirCrumbs;
    if (this.data.dirLoading) return;
    if (crumbs.length > 1) {
      this.browseDirs(crumbs[crumbs.length - 2].path);
    } else {
      this.browseDirs(null);
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
            self.browseDirs(parent);
          })
          .catch((err) => {
            self.setData({ dirCreatingDir: false });
            wx.showToast({ title: err.message || '创建失败', icon: 'none' });
          });
      }
    });
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
        }, 300);
        this.setData({ dirCreatingWs: false, dirSheetOpen: false });
      })
      .catch((err) => {
        this.setData({ dirCreatingWs: false });
        wx.showToast({ title: err.message || '创建失败', icon: 'none' });
      });
  },

  newSession() {
    if (store.state.connection !== 'connected') {
      wx.showToast({ title: '请先连接 Gateway', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '创建会话…' });
    store.createAndOpenSession(store.state.currentWorkspaceId)
      .then(() => {
        wx.hideLoading();
        wx.navigateTo({ url: '/pages/session/session' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '创建失败', icon: 'none' });
      });
  },

  openSession(e) {
    const { id, title, preset } = e.currentTarget.dataset;
    store.openSession(id, title, preset);
    wx.navigateTo({ url: '/pages/session/session' });
  },

  sessionActions(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.displaySessions[index];
    if (!item) return;
    const self = this;
    wx.showActionSheet({
      itemList: ['重命名', '归档会话'],
      success(res) {
        if (res.tapIndex === 0) {
          self.renameSession(item);
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '归档会话',
            content: '归档后会话将从列表隐藏，可在 WebUI 中恢复。',
            success(r) {
              if (r.confirm) {
                store.client.archiveSession(item.sessionId);
                setTimeout(() => store.client.requestSessions(), 500);
              }
            }
          });
        }
      }
    });
  },

  renameSession(item) {
    wx.showModal({
      title: '重命名会话',
      editable: true,
      placeholderText: item.displayTitle,
      success(res) {
        if (res.confirm && res.content && res.content.trim()) {
          store.client.renameSession(item.sessionId, res.content.trim());
          setTimeout(() => store.client.requestSessions(), 500);
        }
      }
    });
  },

  togglePairMenu() {
    this.setData({ pairMenuVisible: !this.data.pairMenuVisible });
  },

  closePairMenu() {
    this.setData({ pairMenuVisible: false });
  },

  // 对齐 dsh-mobile：扫码后直接用一次性配对信息发起配对
  pairByScan() {
    this.setData({ pairMenuVisible: false });
    wx.scanCode({
      onlyFromCamera: true,
      success: (res) => {
        const result = store.pairWithPayload(res.result);
        if (result.ok) {
          wx.showToast({ title: '连接中…', icon: 'none' });
        } else {
          wx.showToast({ title: result.error || '配对失败', icon: 'none' });
        }
      },
      fail: (err) => {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('permission') >= 0 || msg.indexOf('auth') >= 0) {
          wx.showToast({ title: '需要摄像头权限，请在设置中开启', icon: 'none' });
        } else if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: '扫码失败：' + msg, icon: 'none' });
        }
      }
    });
  },

  pairByManual() {
    this.setData({ pairMenuVisible: false, manualSheetOpen: true, pairingText: '', pairingResult: '', pairingResultClass: '', pairingConnecting: false });
  },

  closeManualSheet() {
    this.setData({ manualSheetOpen: false });
  },

  onPairingTextInput(e) {
    this.setData({ pairingText: e.detail.value, pairingResult: '', pairingResultClass: '' });
  },

  // 对齐 dsh-mobile ManualGatewayPairingSheet：提交一次性配对信息
  connectManualPairing() {
    const raw = String(this.data.pairingText || '').trim();
    if (!raw || this.data.pairingConnecting) return;
    const result = store.pairWithPayload(raw);
    if (!result.ok) {
      this.setData({ pairingResult: result.error || '配对信息无效', pairingResultClass: 'error' });
      return;
    }
    this.setData({ pairingConnecting: true, pairingResult: '连接中…', pairingResultClass: 'connecting' });
  },

  openSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  }
});

function shortPath(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : path;
}
