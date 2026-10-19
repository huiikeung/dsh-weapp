const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const util = require('../../utils/util');
const labels = require('../../utils/labels');
const hostsLib = require('../../utils/hosts');
const { workspacePopoverLayout } = require('../../utils/workspace-popover');

const CONNECTION_LABELS = {
  disconnected: uiText('未连接'),
  connecting: uiText('连接中'),
  connected: uiText('已连接'),
  failed: uiText('连接失败')
};

Page({
  data: {
    oceanActive: true,
    oceanReducedMotion: false,
    pairMenuVisible: false,
    manualSheetOpen: false,
    manualSheetExpanded: false,
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
    connectionLabel: uiText('未连接'),
    connectionClass: 'disconnected',
    hostLabel: uiText('选择主机'),
    hostKindIcon: 'desktop-white.png',
    hostOnline: false,
    hostRows: [],
    hostSheetOpen: false,
    hostSheetExpanded: false,
    hostEditMode: false,
    hostSelection: [],
    hostEditOpen: false,
    editingHostId: '',
    editingGatewayName: '',
    editAlias: '',
    editKind: 'desktopcomputer',
    workspacePickerOpen: false,
    sheetTheme: 'dark',
    pickerWorkspaces: [],
    popLeft: 16,
    popTop: 140,
    popWidth: 300,
    popHeight: 240,
    popOriginY: 120,
    currentWorkspaceId: '',
    homeDataHint: '',
    emptySessionsText: uiText('暂无已知会话。连接服务后创建第一个任务。'),
    // 侧边栏（对齐 dsh-mobile WorkspaceView drawer）
    drawerOpen: false,
    drawerDragging: false,
    drawerAnim: true,
    drawerW: 280,
    drawerX: -280,
    contentX: 0,
    maskOpacity: 0,
    contentShifted: false
  },

  onUiLocaleChange() { this.syncFromStore({ app: store.state, session: store.sessionState }); },
  onLoad() {
    // 抽屉宽度：min(屏宽 × 0.76, 360pt)（对齐 iOS drawerWidth）
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.drawerW = Math.min(Math.round((info.windowWidth || 375) * 0.76), 360);
      this.statusBarH = info.statusBarHeight || 44;
      // 系统外观：抽屉打开时据此切换状态栏字色（浅色模式抽屉为白底）
      try {
        const sys = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
        this.systemTheme = sys.theme || 'light';
      } catch (e2) {
        this.systemTheme = 'light';
      }
    } catch (e) {
      this.drawerW = 280;
      this.statusBarH = 44;
      this.systemTheme = 'light';
    }
    // 胶囊按钮矩形：品牌行与其同行对齐。
    // 底条上下各多铺 6px：滚动内容不会从胶囊行缝隙里透出。
    let rect = null;
    try {
      rect = typeof wx.getMenuButtonBoundingClientRect === 'function'
        ? wx.getMenuButtonBoundingClientRect() : null;
    } catch (e2) { rect = null; }
    const capTop = rect && rect.top ? rect.top : this.statusBarH + 4;
    const capH = rect && rect.height ? rect.height : 32;
    this.topbarTop = Math.max(capTop - 6, 0);
    this.topbarH = capH + 12;
    // 抽屉字标（48rpx = 24px 高）与首页品牌行/胶囊垂直居中对齐
    this.drawerTopPad = Math.max(capTop + Math.max((capH - 24) / 2, 0), 8);
    this.setData({
      drawerW: this.drawerW,
      drawerX: -this.drawerW,
      // 自定义导航：topbar 提升到与右上角胶囊同一行（导航区内），
      // 内容从 topbar 下方开始滚动。
      topbarTop: this.topbarTop,
      topbarHeight: this.topbarH,
      homePadTop: this.topbarTop + this.topbarH + 14,
      drawerTopPad: this.drawerTopPad
    });
    // 让背景网格的横线正好穿过品牌行中心（对齐参考图构图）
    try {
      const centerPx = this.topbarTop + this.topbarH / 2;
      const winW = (typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo().windowWidth : 375) || 375;
      const centerRpx = centerPx * 750 / winW;
      const grid = 84;                     // .deep-grid 的网格间距
      // 网格横线自顶部每 84rpx 一条；正向下移 (center % 84) 正好让一条线穿过中心
      const offset = (centerRpx % grid + grid) % grid;
      this.setData({ gridOffsetY: Math.round(offset * 100) / 100 });
    } catch (e) { /* 布局异常时保持默认 */ }

    this.unsubscribe = store.subscribe((snapshot) => {
      this.syncFromStore(snapshot);
    });
    this.syncFromStore({ app: store.state, session: store.sessionState });
    // 弹窗主题：跟随系统外观（浅色弹窗 / 深色弹窗），首页背景保持深海
    this.applySheetTheme();
    if (typeof wx.onThemeChange === 'function' && !getApp()._homeThemeWatched) {
      const app = getApp();
      app._homeThemeWatched = true;
      wx.onThemeChange(() => {
        const pages = getCurrentPages();
        pages.forEach((p) => {
          if (p && typeof p.applySheetTheme === 'function') p.applySheetTheme();
        });
      });
    }
  },

  applySheetTheme() {
    this.setData({ sheetTheme: theme.resolveTheme() });
  },

  onHide() {
    this._workspacePickerRequest = null;
    this.setData({ oceanActive: false, workspacePickerOpen: false });
  },

  onShow() {
    const creator = store.state.pendingPluginCreator;
    if (creator) {
      store.state.pendingPluginCreator = null;
      const owner = store.state.activeID || store.state.gatewayId || store.state.endpoint || '';
      if (creator.owner === owner && store.state.connection === 'connected') {
        const creation = store.createAndOpenSession(creator.workspaceId, 'cordis');
        wx.navigateTo({ url: '/pages/session/session' });
        creation.catch(() => {});
      }
    }
    // 从设置页返回时同步外观模式（手动浅色/深色切换不走 onThemeChange）
    this.applySheetTheme();
    let settings = {};
    try { settings = typeof wx.getSystemSetting === 'function' ? wx.getSystemSetting() : {}; } catch (e) { /* 保留动态背景默认。 */ }
    this.setData({ oceanActive: true, oceanReducedMotion: settings.enableReduceMotion === true });
    // 从配对页跳回时刷新一次列表
    if (store.state.connection === 'connected') {
      store.client.requestWorkspaces();
      store.client.requestSessions();
    }
    this.syncHostUI(store.state);
  },

  onUnload() {
    this._workspacePickerRequest = null;
    this.stopHostProbeTimer();
    store.stopHostProbes();
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore(snapshot) {
    const app = snapshot.app;
    const conn = app.connection;
    // 对齐 dsh-mobile WorkspaceView.displayedSessions：
    // 先限定历史可见性和归档状态，再按工作区归属筛选，最后应用搜索结果。
    const workspaces = app.workspaces || [];
    const rawSessions = app.sessions || [];
    const archivedIds = new Set(app.archivedSessionIds || []);
    const visibleSessions = rawSessions.filter((s) => (
      s.hasConversation !== false && !s.blank && !archivedIds.has(s.sessionId)
    ));
    const isUngrouped = app.isUngroupedWorkspaceSelected === true;
    const current = isUngrouped ? null : (workspaces.find((w) => w.workspaceId === app.currentWorkspaceId)
      || workspaces[0]
      || null);
    const groupedIds = new Set();
    workspaces.forEach((w) => (w.sessionIds || []).forEach((id) => groupedIds.add(id)));
    const ungroupedSessions = visibleSessions.filter((s) => !groupedIds.has(s.sessionId));
    let scopedSource;
    if (isUngrouped) {
      scopedSource = ungroupedSessions;
    } else if (current) {
      const workspaceIds = new Set(current.sessionIds || []);
      scopedSource = visibleSessions.filter((s) => workspaceIds.has(s.sessionId));
    } else {
      scopedSource = visibleSessions;
    }

    const query = String(app.searchQuery || '').trim();
    if (query) {
      const resultIds = new Set((app.searchResults || []).map((item) => item.sessionId));
      const queryLower = query.toLowerCase();
      scopedSource = scopedSource.filter((s) => (
        resultIds.has(s.sessionId) || String(s.title || '').toLowerCase().indexOf(queryLower) >= 0
      ));
    }

    const displaySessions = scopedSource
      .filter((s) => !s.blank)
      .map((s) => ({
        sessionId: s.sessionId,
        updatedAt: s.updatedAt || 0,
        running: s.running,
        hasUnread: s.hasUnread,
        agentPreset: s.agentPreset,
        displayTitle: s.title || util.sessionIdLabel(s.sessionId),
        idLabel: String(s.sessionId || '').slice(0, 16),
        timeLabel: util.formatRelativeTime(s.updatedAt)
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 12);

    const usingCachedHome = !!(
      (app.lastSessionsFrame && app.lastSessionsFrame.cached) ||
      (app.lastWorkspacesFrame && app.lastWorkspacesFrame.cached)
    );
    const hostCompatibilityError = !!app.coreCompatibilityError;
    const currentWorkspace = isUngrouped ? {
      title: uiText('未分组'),
      path: ungroupedSessions.length + uiText(' 个未归属会话'),
      workspaceId: '',
      ungrouped: true
    } : current ? {
      title: current.title,
      path: current.path || uiText('通过 Mobile Gateway 连接'),
      workspaceId: current.workspaceId,
      ungrouped: false
    } : {
      title: 'DeepseekHarnessProject',
      path: uiText('通过 Mobile Gateway 连接'),
      workspaceId: '',
      ungrouped: false
    };

    this.setData({
      currentWorkspace: currentWorkspace,
      currentWorkspaceId: currentWorkspace.workspaceId,
      displaySessions: displaySessions,
      connectionLabel: hostCompatibilityError ? uiText('服务异常') : (uiText(CONNECTION_LABELS[conn] || conn)),
      connectionClass: hostCompatibilityError ? 'failed' : conn,
      homeDataHint: hostCompatibilityError
        ? uiText('NAS 端 Mobile Gateway 与 DSH 版本不兼容，请升级服务端后重试')
        : (usingCachedHome ? uiText('正在显示上次成功加载的数据') : ''),
      emptySessionsText: query
        ? uiText('没有找到匹配的会话。')
        : (hostCompatibilityError
          ? uiText('主机已连接，但服务端读取工作区和会话失败。请升级 NAS 上的 Mobile Gateway 与 DSH。')
          : (isUngrouped ? uiText('暂无未分组会话。不属于任何工作区的历史会话会显示在这里。')
            : uiText('暂无已知会话。连接服务后创建第一个任务。')))
    });
    // 手动配对弹窗：连接成功后自动收起（对齐 dsh-mobile 配对完成反馈）
    if (this.data.manualSheetOpen && conn === 'connected' && this.data.pairingConnecting) {
      this.setData({ manualSheetOpen: false, pairingConnecting: false });
      wx.showToast({ title: uiText('配对成功'), icon: 'success' });
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
      hostLabel: active ? hostsLib.displayName(active) : uiText('选择主机'),
      hostKindIcon: hostsLib.kindIconFile(active ? active.deviceKind : 'desktopcomputer'),
      hostOnline: active ? (onlineIDs.indexOf(active.id) >= 0 || isOnline) : false,
      hostRows: rows.map((p) => ({
        id: p.id,
        displayName: hostsLib.displayName(p),
        kindIcon: hostsLib.kindIconFile(p.deviceKind),
        online: onlineIDs.indexOf(p.id) >= 0 || (p.id === app.activeID && isOnline),
        subLabel: (p.id === app.activeID || isOnline) ? uiText('当前主机 · 已连接') : uiText('点击连接'),
        isActive: p.id === app.activeID,
        selected: selected.indexOf(p.id) >= 0
      }))
    });
  },

  openHostSwitcher() {
    this.setData({ hostSheetOpen: true, hostSheetExpanded: false, hostEditMode: false, hostSelection: [] });
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
      hostSheetExpanded: false,
      hostEditMode: false,
      hostSelection: [],
      hostEditOpen: false
    });
  },

  /* 抓手拖拽/点击：上滑或点按展开到近全屏，下滑或再次点按收回紧凑 */
  onHostSheetGrabStart(e) {
    this._hostGrab = { y: e.touches[0].clientY, moved: false, base: this.data.hostSheetExpanded, applied: null };
  },

  onHostSheetGrabMove(e) {
    const g = this._hostGrab;
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (Math.abs(dy) < 24) return;
    const expand = dy < 0;
    if (g.applied !== expand) {
      g.applied = expand;
      g.moved = true;
      this.setData({ hostSheetExpanded: expand });
    }
  },

  onHostSheetGrabEnd() {
    const g = this._hostGrab;
    this._hostGrab = null;
    if (g && !g.moved) {
      this.setData({ hostSheetExpanded: !g.base });
    }
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
      editingGatewayName: profile.gatewayName || uiText('未命名主机'),
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
      title: count === 1 ? uiText('删除主机？') : uiText('批量删除主机？'),
      content: uiText('从 App 移除选中的 ') + count + uiText(' 台主机及连接凭证；网关上的会话和工作区不会被删除。再次连接需重新配对。'),
      confirmText: uiText('删除'),
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
    if (this.data.workspacePickerOpen || this._workspacePickerRequest) return;
    const request = {};
    this._workspacePickerRequest = request;
    const st = store.state;
    const workspaces = st.workspaces || [];
    const rows = workspaces.map((w) => ({
      workspaceId: w.workspaceId,
      title: w.title || uiText('工作区'),
      path: w.path || (((w.sessionIds || []).length) + uiText(' 个会话')),
      ungrouped: false
    }));
    let windowInfo = {};
    try {
      windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (e) { /* Use phone-safe defaults when window metrics are unavailable. */ }
    const show = (rect) => {
      if (this._workspacePickerRequest !== request) return;
      this._workspacePickerRequest = null;
      const layout = workspacePopoverLayout(rect, windowInfo, rows.length, this.topbarTop + this.topbarH);
      this.setData(Object.assign({
        workspacePickerOpen: true,
        pickerWorkspaces: rows,
        currentWorkspaceId: this.data.currentWorkspace.workspaceId || st.currentWorkspaceId || '',
        pairMenuVisible: false
      }, layout));
    };
    try {
      wx.createSelectorQuery().in(this).select('.workspace-card').boundingClientRect(show).exec();
    } catch (e) {
      show(null);
    }
  },

  selectUngrouped() {
    store.setCurrentWorkspace(null);
    this.setData({ workspacePickerOpen: false });
  },

  closeWorkspacePicker() {
    this._workspacePickerRequest = null;
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
      this.setData({ dirLoading: false, dirError: uiText('请先连接驭鲸 Harness') });
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
        this.setData({ dirLoading: false, dirError: err.message || uiText('读取目录失败') });
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
      title: uiText('新建文件夹'),
      content: uiText('将在当前目录中创建一个新的子文件夹。'),
      editable: true,
      placeholderText: uiText('文件夹名称'),
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
            wx.showToast({ title: err.message || uiText('创建失败'), icon: 'none' });
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
        wx.showToast({ title: uiText('工作区已就绪'), icon: 'success' });
        setTimeout(() => {
          store.client.requestWorkspaces();
        }, 300);
        this.setData({ dirCreatingWs: false, dirSheetOpen: false });
      })
      .catch((err) => {
        this.setData({ dirCreatingWs: false });
        wx.showToast({ title: err.message || uiText('创建失败'), icon: 'none' });
      });
  },

  newSession() {
    if (store.state.connection !== 'connected') {
      wx.showToast({ title: uiText('请先连接 Gateway'), icon: 'none' });
      return;
    }
    // 乐观创建：先进入会话页，后台创建结果由会话页呈现
    const workspaceId = this.data.currentWorkspace.workspaceId || store.state.currentWorkspaceId;
    const creation = store.createAndOpenSession(workspaceId);
    wx.navigateTo({ url: '/pages/session/session' });
    creation.catch(() => {}); // 失败状态已写入 store，由会话页显示重试入口
  },

  openSession(e) {
    const { id, title, preset } = e.currentTarget.dataset;
    if (!id) {
      wx.showToast({ title: uiText('会话 ID 不可用'), icon: 'none' });
      return;
    }
    store.openSession(id, title, preset);
    wx.navigateTo({ url: '/pages/session/session?id=' + encodeURIComponent(id) });
  },

  sessionActions(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.displaySessions[index];
    if (!item) return;
    const self = this;
    wx.showActionSheet({
      itemList: [uiText('重命名'), uiText('归档会话')],
      success(res) {
        if (res.tapIndex === 0) {
          self.renameSession(item);
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: uiText('归档会话'),
            content: uiText('归档后会话将从列表隐藏，可在 WebUI 中恢复。'),
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
      title: uiText('重命名会话'),
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
          wx.showToast({ title: uiText('连接中…'), icon: 'none' });
        } else {
          wx.showToast({ title: result.error || uiText('配对失败'), icon: 'none' });
        }
      },
      fail: (err) => {
        const msg = err && err.errMsg ? err.errMsg : '';
        if (msg.indexOf('permission') >= 0 || msg.indexOf('auth') >= 0) {
          wx.showToast({ title: uiText('需要摄像头权限，请在设置中开启'), icon: 'none' });
        } else if (msg.indexOf('cancel') < 0) {
          wx.showToast({ title: uiText('扫码失败：') + msg, icon: 'none' });
        }
      }
    });
  },

  /** 配置引导：进入「添加节点」三步说明页 */
  openPairGuide() {
    this.setData({ pairMenuVisible: false });
    wx.navigateTo({ url: '/pages/add-node/add-node' });
  },

  pairByManual() {
    this.setData({ pairMenuVisible: false, manualSheetOpen: true, manualSheetExpanded: false, pairingText: '', pairingResult: '', pairingResultClass: '', pairingConnecting: false });
  },

  closeManualSheet() {
    this.setData({ manualSheetOpen: false, manualSheetExpanded: false });
  },

  /* 手动配对弹层抓手：上滑/点按展开到顶栏之下，下滑/再点收回紧凑 */
  onManualSheetGrabStart(e) {
    this._manualGrab = { y: e.touches[0].clientY, moved: false, base: this.data.manualSheetExpanded, applied: null };
  },

  onManualSheetGrabMove(e) {
    const g = this._manualGrab;
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (Math.abs(dy) < 24) return;
    const expand = dy < 0;
    if (g.applied !== expand) {
      g.applied = expand;
      g.moved = true;
      this.setData({ manualSheetExpanded: expand });
    }
  },

  onManualSheetGrabEnd() {
    const g = this._manualGrab;
    this._manualGrab = null;
    if (g && !g.moved) {
      this.setData({ manualSheetExpanded: !g.base });
    }
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
      this.setData({ pairingResult: result.error || uiText('配对信息无效'), pairingResultClass: 'error' });
      return;
    }
    this.setData({ pairingConnecting: true, pairingResult: uiText('连接中…'), pairingResultClass: 'connecting' });
  },

  openSettings() {
    this.resetDrawerInstant();
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  openSessionSettings() {
    wx.navigateTo({ url: '/pages/session-settings/session-settings' });
  },

  // ---------- 侧边栏（对齐 dsh-mobile WorkspaceView drawer 交互） ----------

  applyDrawer(progress) {
    const w = this.drawerW;
    this.setData({
      drawerOpen: progress > 0.5,
      drawerX: -w + w * progress,
      contentX: w * progress,
      maskOpacity: 0.16 * progress,
      contentShifted: progress > 0.02
    });
    // 状态栏字色跟随抽屉底色：浅色模式抽屉为白底 → 黑字；其余白字（navy/深色底）。
    // 拖拽按帧触发，只在开/合状态切换时调用一次。
    const open = progress > 0.5;
    if (this.statusBarFront !== open && typeof wx.setNavigationBarColor === 'function') {
      this.statusBarFront = open;
      const darkChrome = this.systemTheme === 'dark' || open;
      try {
        wx.setNavigationBarColor({
          frontColor: darkChrome ? '#ffffff' : '#000000',
          backgroundColor: open && this.systemTheme !== 'dark' ? '#ffffff' : '#07182B',
          fail: function () { /* 部分环境不支持，忽略 */ }
        });
      } catch (e) { /* 忽略 */ }
    }
  },

  openDrawer() {
    if (this.data.drawerOpen) return;
    this.setData({ pairMenuVisible: false });
    this.applyDrawer(1);
  },

  closeDrawer() {
    if (!this.data.drawerOpen && !this.data.drawerDragging) return;
    this.setData({ drawerDragging: false });
    this.applyDrawer(0);
  },

  noop() {},

  /** 内容区右滑打开（iOS DrawerGesture：水平位移显著时触发）。 */
  onContentTouchStart(e) {
    const t = e.touches && e.touches[0];
    this.contentGesture = t ? { x: t.clientX, y: t.clientY } : null;
  },

  onContentTouchEnd(e) {
    const start = this.contentGesture;
    this.contentGesture = null;
    if (!start || this.data.drawerOpen) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this.openDrawer();
    }
  },

  /** 抽屉上拖拽关闭（iOS drawerDrag）。 */
  onDrawerTouchStart(e) {
    const t = e.touches && e.touches[0];
    this.drawerGesture = t ? { x: t.clientX, y: t.clientY, moved: false } : null;
  },

  onDrawerTouchMove(e) {
    const g = this.drawerGesture;
    if (!g) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (!g.moved) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) { this.drawerGesture = null; return; }
      g.moved = true;
      this.setData({ drawerDragging: true, pairMenuVisible: false });
    }
    const progress = Math.min(1, Math.max(0, 1 + dx / this.drawerW));
    this.applyDrawer(progress);
  },

  onDrawerTouchEnd() {
    const g = this.drawerGesture;
    this.drawerGesture = null;
    if (!g || !g.moved) return;
    // drawerX = -W + W·p → p = (drawerX + W) / W
    const progress = (this.data.drawerX + this.drawerW) / this.drawerW;
    this.setData({ drawerDragging: false });
    this.applyDrawer(progress > 0.5 ? 1 : 0);
  },

  /** 抽屉项：跳转后无动画复位（对齐 iOS selectDrawerItem）。 */
  resetDrawerInstant() {
    this.setData({ drawerAnim: false });
    this.applyDrawer(0);
    setTimeout(() => this.setData({ drawerAnim: true }), 60);
  },

  openPlugins() {
    this.resetDrawerInstant();
    wx.navigateTo({ url: '/pages/plugins/plugins' });
  },

  openScheduledTasks() {
    this.resetDrawerInstant();
    wx.navigateTo({ url: '/pages/schedule/schedule' });
  }
});

function shortPath(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : path;
}
