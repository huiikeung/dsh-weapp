const haptics = require('../../utils/haptics');
const { t: uiText } = require('../../utils/ui-preferences');
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const util = require('../../utils/util');
const labels = require('../../utils/labels');
const hostsLib = require('../../utils/hosts');
const { workspacePopoverLayout } = require('../../utils/workspace-popover');
const directoryBrowse = require('../../utils/directory-browse');
const settingsGlassStylePreference = require('../../utils/settings-glass-style-pref');
const settingsGlassPreference = require('../../utils/settings-glass-pref');
const quotaSidebarGlassPreference = require('../../utils/quota-sidebar-glass-pref');
const homeAnimationPreference = require('../../utils/home-animation-pref');
const initialHomeAnimationEnabled = homeAnimationPreference.enabled();
const costView = require('../../utils/cost-view');
const publicAccessPrompt = require('../../utils/public-access-prompt');
const { connectionView } = require('../../utils/connection-status');
const { createSessionWarmup } = require('../../utils/session-warmup');
const { classifyEndpoint } = require('../../utils/route-table');

const HOME_SESSION_REFRESH_MS = 1800;
const SESSION_SWIPE_ACTION_RPX = 300; // 两个 150rpx 操作钮
const HOME_WINDOW_BG = '#07182B';
const HOME_DRAWER_DARK_BG = '#141518';

/** 首页窗口/状态栏底色：抽屉打开时跟随抽屉，关闭时保持深海蓝。 */
function homeWindowBackground(dark, open) {
  if (open) return dark ? HOME_DRAWER_DARK_BG : '#FFFFFF';
  return HOME_WINDOW_BG;
}

/** 主机线路族：已连接的那台取真实线路（lan/public/relay），其余按档案地址推断（局域网优先）。 */
function hostLinkKind(profile, app) {
  if (!profile) return '';
  if (app && profile.id === app.activeID && app.connection === 'connected' && store.client && store.client.routeKind) {
    return store.client.routeKind;
  }
  const kinds = [];
  (profile.endpoints || []).forEach((endpoint) => {
    const kind = classifyEndpoint(endpoint);
    if (kind && kinds.indexOf(kind) < 0) kinds.push(kind);
  });
  if (kinds.indexOf('lan') >= 0) return 'lan';
  if (kinds.indexOf('public') >= 0) return 'public';
  return '';
}

function hostLinkView(kind) {
  if (kind === 'lan') return { label: uiText('局域网'), className: 'is-lan', dotClass: 'link-lan' };
  if (kind === 'public' || kind === 'relay') return { label: uiText('公网'), className: 'is-public', dotClass: 'link-public' };
  return { label: '', className: '', dotClass: '' };
}

/** 会话操作菜单：锚定被长按的那一行（与工作区选择一致）。 */
function sessionMenuLayout(rect, windowInfo, navigationBottom) {
  const info = windowInfo || {};
  const windowWidth = info.windowWidth || 375;
  const windowHeight = info.windowHeight || 667;
  const scale = windowWidth / 750;
  const edge = 8;
  const width = Math.min(240, Math.max(200, windowWidth * 0.6), windowWidth - edge * 2);
  const height = 84 * scale * 2 + 32 * scale;
  const safeTop = Math.max(edge, (navigationBottom || info.statusBarHeight || 44) + 8);
  const safeBottom = Math.min(windowHeight, (info.safeArea && info.safeArea.bottom) || windowHeight) - edge;
  const centerX = rect ? rect.left + rect.width / 2 : windowWidth / 2;
  const centerY = rect ? rect.top + rect.height / 2 : safeTop + height / 2;
  const left = Math.max(edge, Math.min(centerX - width / 2, windowWidth - edge - width));
  const top = Math.max(safeTop, Math.min(centerY - height / 2, safeBottom - height));
  return {
    popLeft: left, popTop: top, popWidth: width, popHeight: height,
    popOriginY: Math.max(0, Math.min(height, centerY - top))
  };
}

const ALL_SESSIONS_SECTION_LIMIT = 5;
const UNGROUPED_SECTION_ID = '__ungrouped__';

/** 工作区卡片/分区头里的会话数：「1 个会话」/「N 个会话」（对齐 iOS WorkspaceSessionCopy.count）。 */
function homeSessionCountLabel(count) {
  return count === 1 ? uiText('1 个会话') : uiText('{n} 个会话', { n: count });
}

/** 分区无障碍标签（对齐 iOS WorkspaceSessionCopy.sectionAccessibility）。 */
function sectionAriaLabel(title, countLabel) {
  return uiText('工作区 {title}，{countLabel}', { title: title, countLabel: countLabel });
}

/** 分区折叠开关文案（对齐 iOS WorkspaceSessionCopy.expand / 「收起」）。 */
function homeSectionExpandLabel(remaining) {
  return remaining === 1 ? uiText('展开其余 1 个会话') : uiText('展开其余 {n} 个会话', { n: remaining });
}

/** 分区标题：优先工作区标题，其次路径最后一段，最后兜底「工作区」。 */
function workspaceSectionTitle(workspace) {
  const title = workspace && workspace.title ? String(workspace.title).trim() : '';
  if (title) return title;
  const parts = (workspace && workspace.path ? String(workspace.path) : '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : uiText('工作区');
}

/** 会话排序：正在运行的排最前，其余按最近更新在前，同时间按 sessionId 升序。 */
function compareSessionRecency(a, b) {
  const runDiff = (b.running ? 1 : 0) - (a.running ? 1 : 0);
  if (runDiff) return runDiff;
  const diff = (b.updatedAt || 0) - (a.updatedAt || 0);
  if (diff) return diff;
  const left = String(a.sessionId || '');
  const right = String(b.sessionId || '');
  return left < right ? -1 : (left > right ? 1 : 0);
}

/** 会话行视图模型（与「最近会话」行完全一致，供两种模式共用）。 */
function sessionItemView(s) {
  return {
    sessionId: s.sessionId,
    updatedAt: s.updatedAt || 0,
    running: s.running,
    hasUnread: s.hasUnread,
    // 完成后 24h 内显示绿点；一旦完成之后被看过（本机 openSession 或电脑端
    // 经网关订阅/读取，见 store.lastOpenedAt）就立刻置灰。
    recentlyCompleted: (function () {
      if (s.running) return false;
      var done = Number(s.completedAt) || 0;
      if (!done || Date.now() - done >= 24 * 60 * 60 * 1000) return false;
      var seen = Math.max(Number(s.lastOpenedAt) || 0, Number(s.viewedAt) || 0);
      return seen < done;
    })(),
    agentPreset: s.agentPreset,
    displayTitle: s.title || util.sessionIdLabel(s.sessionId),
    idLabel: String(s.sessionId || '').slice(0, 16),
    timeLabel: util.formatRelativeTime(s.updatedAt)
  };
}

Page({
  data: {
    oceanActive: true,
    oceanReducedMotion: !initialHomeAnimationEnabled,
    homeAnimationEnabled: initialHomeAnimationEnabled,
    pairMenuVisible: false,
    manualSheetOpen: false,
    manualSheetExpanded: false,
    manualInputFocused: false,
    pairingText: '',
    pairingResult: '',
    pairingResultClass: '',
    pairingConnecting: false,
    dirSheetOpen: false,
    dirCreateOpen: false,
    dirCreateName: '',
    dirCreateBusy: false,
    dirLoading: false,
    dirCreatingWs: false,
    dirCreatingDir: false,
    dirPath: '',
    dirCrumbs: [],
    dirCrumbTrail: [],
    dirCrumbIntoView: '',
    dirHome: '',
    dirRootPath: '',
    parentPath: null,
    dirShowHidden: false,
    dirHiddenCount: 0,
    dirVisibleEntries: [],
    dirLocationsOpen: false,
    dirVolumes: [],
    dirVolumesLoading: false,
    dirVolumesLoaded: false,
    dirVolumesError: '',
    dirJumpOpen: false,
    dirJumpValue: '',
    dirJumpError: '',
    dirEntries: [],
    dirError: '',
    currentWorkspace: {},
    displaySessions: [],
    displayEntries: [],
    allWorkspacesSelected: false,
    expandedSectionIds: [],
    searchQuery: '',
    connectionLabel: uiText('未连接'),
    connectionClass: 'disconnected',
    connectionHintIsError: false,
    hostLabel: uiText('选择主机'),
    hostKindIcon: 'desktop-white.png',
    hostOnline: false,
    hostRows: [],
    hostSheetOpen: false,
    ...settingsGlassStylePreference.view(),
    quotaSidebarGlass: quotaSidebarGlassPreference.read(),
    hostDeleteOpen: false,
    hostDeleteCount: 0,
    hostDeleteTitle: '',
    hostDeleteNames: '',
    hostSheetExpanded: false,
    hostEditMode: false,
    hostSelection: [],
    hostEditOpen: false,
    editingHostId: '',
    editingGatewayName: '',
    editAlias: '',
    editKind: 'desktopcomputer',
    kindMenuOpen: false,
    hostEditKb: 0,
    workspacePickerOpen: false,
    sheetTheme: 'dark',
    themeClass: 'theme-dark',
    pageStyle: 'background-color: #07182B;',
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
    homeScrollStored: 0,
    drawerDragging: false,
    drawerAnim: true,
    drawerW: 280,
    drawerX: -280,
    contentX: 0,
    contentCornerRadius: 0,
    maskOpacity: 0,
    contentShifted: false,
    costDashboard: null,
    costSidebar: null,
    costSections: [],
    costCardError: '',
    publicAccessDialog: null,
    publicAccessDialogOpen: false,
    // 会话操作：长按锚点弹窗 + 左滑手势
    sessionMenuOpen: false,
    sessionMenuId: '',
    sessionMenuTitle: '',
    swipeId: '',
    swipeOffset: 0,
    swiping: false
  },

  onUiLocaleChange() { this.syncFromStore({ app: store.state, session: store.sessionState }); },
  onHomeScroll(e) {
    const top = Number(e && e.detail && e.detail.scrollTop);
    if (Number.isFinite(top)) this._homeScrollTop = top;
  },

  onLoad() {
    // 抽屉宽度：min(屏宽 × 0.76, 360pt)（对齐 iOS drawerWidth）
    try {
      const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.drawerW = Math.min(Math.round((info.windowWidth || 375) * 0.76), 360);
      this.statusBarH = info.statusBarHeight || 44;
      this._windowWidth = info.windowWidth || 375;
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
    // 左滑操作区宽度换算成 px，供手势阈值使用
    this._swipeActionPx = SESSION_SWIPE_ACTION_RPX * ((this._windowWidth || 375) / 750);
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
    this.unsubscribe = store.subscribe((snapshot) => {
      this.syncFromStore(snapshot);
    });
    // 从会话页原地替换回来时恢复首页滚动位置，避免看起来像重新加载
    try {
      const app = getApp();
      const restore = app && app.globalData && app.globalData.homeRestore;
      if (restore && Number.isFinite(restore.scrollTop)) {
        app.globalData.homeRestore = null;
        this._homeScrollTop = restore.scrollTop;
        this.setData({ homeScrollStored: restore.scrollTop });
      }
    } catch (_) { /* 忽略 */ }
    // 首帧先出骨架，列表等重活放到 nextTick，减少进入首页时的掉帧
    const renderStore = () => this.syncFromStore({ app: store.state, session: store.sessionState });
    if (typeof wx.nextTick === 'function') wx.nextTick(renderStore); else renderStore();
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
    const resolved = theme.resolveTheme();
    // themeClass 驱动 app.wxss 的语义变量（--surface/--text/--border…）。
    // 首页早先只切 drawer-dark，手动深色下变量仍是浅色值，额度卡片等
    // 用 var() 的组件会变成深字深底；这里补上类名切换。
    this.setData({
      sheetTheme: resolved,
      themeClass: 'theme-' + resolved,
      pageStyle: 'background-color: ' + homeWindowBackground(resolved === 'dark', this.data.drawerOpen) + ';'
    });
  },

  onPublicAccessDialogConfirm() { publicAccessPrompt.resolvePublicAccessDialog(this); },

  onHide() {
    if (this._sessionWarmup) this._sessionWarmup.stop();
    this._homeHidden = true;
    this._homeVisible = false;
    this.stopSessionStatusPolling();
    this.stopHostProbeTimer();
    store.stopHostProbes();
    this._workspacePickerRequest = null;
    this.setData({ oceanActive: false, workspacePickerOpen: false, hostSheetOpen: false,
      drawerAnim: false, drawerOpen: false, drawerDragging: false,
      drawerX: -(this.drawerW || this.data.drawerW), contentX: 0, maskOpacity: 0, contentShifted: false });
    this.statusBarFront = false;
  },

  onShow() {
    this._homeHidden = false;
    this.setData(Object.assign(settingsGlassStylePreference.view({ light: String(this.data.themeClass || '').indexOf('light') >= 0 }), { quotaSidebarGlass: quotaSidebarGlassPreference.read(), settingsGlassEnabled: settingsGlassPreference.read() }));
    this._homeVisible = true;
    this._openingSettings = false;
    this._openingSession = false;
    this.closeSwipe();
    if (this.data.sessionMenuOpen) this.closeSessionMenu();
    // 从设置页返回时额度开关可能已变化：仅当成本显示配置的签名变了才失效，
    // 否则保留 30s 短缓存（无谓清掉会让每次返回首页都重新等网关扫描）。
    if (this._costMeterSig && this._costMeterSig !== this.costSettingsSignature()) {
      this._costMeterCache = null;
      this._costMeterAttempt = null;
    }
    const creator = store.state.pendingPluginCreator || store.state.pendingAgentPresetCreator;
    if (creator) {
      store.state.pendingPluginCreator = null;
      store.state.pendingAgentPresetCreator = null;
      const owner = store.state.activeID || store.state.gatewayId || store.state.endpoint || '';
      if (creator.owner === owner && store.state.connection === 'connected') {
        const creation = store.createAndOpenSession(creator.workspaceId, 'cordis');
        wx.navigateTo({ url: '/pages/session/session', animationType: 'none', animationDuration: 0 });
        creation.catch(() => {});
      }
    }
    // 从设置页返回时同步外观模式（手动浅色/深色切换不走 onThemeChange）
    this.applySheetTheme();
    let settings = {};
    try { settings = typeof wx.getSystemSetting === 'function' ? wx.getSystemSetting() : {}; } catch (e) { /* 保留动态背景默认。 */ }
    const homeAnimationEnabled = homeAnimationPreference.enabled();
    this.setData({ oceanActive: true, drawerAnim: true, homeAnimationEnabled,
      oceanReducedMotion: !homeAnimationEnabled || settings.enableReduceMotion === true });
    // 从配对页跳回时刷新一次列表
    if (store.state.connection === 'connected') {
      store.client.requestWorkspaces();
      this.refreshHomeSessionStatus();
      this.loadCostMeterSummary();
    }
    this.syncFromStore({ app: store.state, session: store.sessionState });
  },

  onUnload() {
    if (this._sessionWarmup) this._sessionWarmup.stop();
    this._homeHidden = true;
    this._homeVisible = false;
    this._workspacePickerRequest = null;
    this.stopSessionStatusPolling();
    this.stopHostProbeTimer();
    store.stopHostProbes();
    if (this.unsubscribe) this.unsubscribe();
  },

  syncFromStore(snapshot) {
    // Stream updates still enter the store, but hidden pages must not rebuild lists.
    if (this._homeHidden) return;
    this._lastSyncSnapshot = snapshot;
    const app = snapshot.app;
    const conn = app.connection;
    this.syncSessionStatusPolling(conn === 'connected');
    if (this._costMeterConn !== conn) {
      this._costMeterConn = conn;
      this._costMeterCache = null;
      this._costMeterAttempt = null;
      this._costBridgeRetry = null;
      if (conn !== 'connected' && (this.data.costDashboard || this.data.costSidebar || this.data.costCardError)) {
        this.setData({ costDashboard: null, costSidebar: null, costSections: [], costCardError: '' });
      }
    }
    if (this._scanRelayPending && (conn === 'connected' || conn === 'failed')) {
      this._scanRelayPending = false;
      if (conn === 'failed') publicAccessPrompt.showPublicAccessFailure(app.connectionMessage, app.connectionErrorCode);
    }
    if (conn === 'connected' || this.data.costDashboard || this.data.costCardError || this._costMeterInFlight) {
      this.loadCostMeterSummary();
    }
    // 对齐 dsh-mobile WorkspaceView + WorkspaceSessionList：
    // 先限定历史可见性和归档状态，再按工作区归属筛选，最后应用搜索结果。
    const workspaces = app.workspaces || [];
    const rawSessions = app.sessions || [];
    const archivedIds = new Set(app.archivedSessionIds || []);
    const visibleSessions = rawSessions.filter((s) => (
      s.hasConversation !== false && !s.blank && !archivedIds.has(s.sessionId)
    ));
    const isAll = app.isAllWorkspacesSelected === true;
    const isUngrouped = !isAll && app.isUngroupedWorkspaceSelected === true;
    // 预建归属索引：同一会话只归第一个工作区（对齐 iOS WorkspaceSessionListInput.project）。
    const ownerOf = {};
    const sectionTitles = {};
    workspaces.forEach((w) => {
      sectionTitles[w.workspaceId] = workspaceSectionTitle(w);
      (w.sessionIds || []).forEach((id) => { if (ownerOf[id] === undefined) ownerOf[id] = w.workspaceId; });
    });
    const current = (!isAll && !isUngrouped) ? (workspaces.find((w) => w.workspaceId === app.currentWorkspaceId)
      || workspaces[0]
      || null) : null;
    const ungroupedSessions = visibleSessions.filter((s) => ownerOf[s.sessionId] === undefined);
    let scopedSource;
    if (isAll) {
      scopedSource = visibleSessions;
    } else if (isUngrouped) {
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
      // 对齐 WorkspaceSessionList：网关正文命中、标题、会话 ID 三者任一匹配即可。
      scopedSource = scopedSource.filter((s) => (
        resultIds.has(s.sessionId)
        || String(s.title || '').toLowerCase().indexOf(queryLower) >= 0
        || String(s.sessionId || '').toLowerCase().indexOf(queryLower) >= 0
      ));
    }
    scopedSource = scopedSource.slice().sort(compareSessionRecency);

    // 展开状态跟随主机：换主机后工作区可能同名但语义不同，清空避免串用。
    const hostKey = app.activeID || app.endpoint || '';
    if (this._expandedSectionsHostKey !== hostKey) {
      this._expandedSectionsHostKey = hostKey;
      this.expandedSectionIds = [];
    }
    const expandedSectionIds = Array.isArray(this.expandedSectionIds)
      ? this.expandedSectionIds
      : (Array.isArray(this.data.expandedSectionIds) ? this.data.expandedSectionIds : []);
    let displaySessions = [];
    let displayEntries = [];
    if (isAll) {
      // 全部会话：按工作区分区；每区默认折叠到 5 条，展开状态各自独立。
      const groups = new Map();
      scopedSource.forEach((s) => {
        const sectionId = ownerOf[s.sessionId] !== undefined ? ownerOf[s.sessionId] : UNGROUPED_SECTION_ID;
        if (!groups.has(sectionId)) groups.set(sectionId, []);
        groups.get(sectionId).push(s);
      });
      const ordered = Array.from(groups.keys()).sort((a, b) => {
        // 全部会话视图里，「未分组」固定排最后（不参与运行中置顶和时间排序）。
        if (a === UNGROUPED_SECTION_ID) return 1;
        if (b === UNGROUPED_SECTION_ID) return -1;
        const left = groups.get(a)[0] || {};
        const right = groups.get(b)[0] || {};
        const runDiff = (right.running ? 1 : 0) - (left.running ? 1 : 0);
        if (runDiff) return runDiff;
        const diff = (right.updatedAt || 0) - (left.updatedAt || 0);
        if (diff) return diff;
        return a < b ? -1 : (a > b ? 1 : 0);
      });
      let rowIndex = 0;
      ordered.forEach((sectionId, sectionIndex) => {
        const rows = groups.get(sectionId);
        const expanded = expandedSectionIds.indexOf(sectionId) >= 0;
        const title = sectionTitles[sectionId] !== undefined ? sectionTitles[sectionId] : uiText('未分组');
        const countLabel = homeSessionCountLabel(rows.length);
        displayEntries.push({
          type: 'section',
          key: 'section-' + sectionId,
          sectionId: sectionId,
          title: title,
          count: rows.length,
          countLabel: countLabel,
          sectionLabel: sectionAriaLabel(title, countLabel),
          first: sectionIndex === 0
        });
        const shown = expanded ? rows : rows.slice(0, ALL_SESSIONS_SECTION_LIMIT);
        shown.forEach((s) => {
          const item = sessionItemView(s);
          item.index = rowIndex;
          rowIndex += 1;
          displaySessions.push(item);
          displayEntries.push(Object.assign({ type: 'session', key: 'session-' + s.sessionId }, item));
        });
        if (rows.length > ALL_SESSIONS_SECTION_LIMIT) {
          const remaining = rows.length - ALL_SESSIONS_SECTION_LIMIT;
          displayEntries.push({
            type: 'toggle',
            key: 'toggle-' + sectionId,
            sectionId: sectionId,
            remaining: remaining,
            expanded: expanded,
            label: expanded ? uiText('收起') : homeSectionExpandLabel(remaining)
          });
        }
      });
    } else {
      displaySessions = scopedSource.slice(0, 12).map((s, index) => {
        const item = sessionItemView(s);
        item.index = index;
        return item;
      });
      displayEntries = displaySessions.map((item) => Object.assign({ type: 'session', key: 'session-' + item.sessionId }, item));
    }

    if (store.warmSessionCache) {
      if (!this._sessionWarmup) this._sessionWarmup = createSessionWarmup({
        load: (id, current) => store.warmSessionCache(id, current)
      });
      const s = snapshot.session || {};
      this._sessionWarmup.update(app.activeID || app.endpoint || '', displaySessions,
        !s.running && !s.historyPaging && s.historyState !== 'requested');
    }
    const hostCompatibilityError = !!app.coreCompatibilityError;
    const currentWorkspace = isAll ? {
      title: uiText('全部会话'),
      path: homeSessionCountLabel(visibleSessions.length),
      workspaceId: '',
      ungrouped: false,
      all: true
    } : isUngrouped ? {
      title: uiText('未分组'),
      path: ungroupedSessions.length + uiText(' 个未归属会话'),
      workspaceId: '',
      ungrouped: true
    } : current ? {
      title: current.title,
      path: current.path || uiText('通过 Weapp Gateway 连接'),
      workspaceId: current.workspaceId,
      ungrouped: false
    } : {
      title: 'DeepseekHarnessProject',
      path: uiText('通过 Weapp Gateway 连接'),
      workspaceId: '',
      ungrouped: false
    };

    const connection = connectionView(app);
    const connectionHint = !!app.connectionMessage && conn !== 'connected';
    this.setHomePatch({
      currentWorkspace: currentWorkspace,
      currentWorkspaceId: currentWorkspace.workspaceId,
      allWorkspacesSelected: isAll,
      expandedSectionIds: expandedSectionIds,
      displaySessions: displaySessions,
      displayEntries: displayEntries,
      connectionLabel: hostCompatibilityError ? uiText('服务异常') : connection.label,
      connectionClass: hostCompatibilityError ? 'failed' : connection.key,
      connectionHintIsError: !hostCompatibilityError && connectionHint && conn !== 'connecting',
      homeDataHint: hostCompatibilityError
        ? uiText('NAS 端 Mobile Gateway 与 DSH 版本不兼容，请升级服务端后重试')
        : (connectionHint ? app.connectionMessage : ''),
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
  setHomePatch(values) {
    const patch = {};
    Object.keys(values).forEach(key => {
      if (JSON.stringify(this.data[key]) !== JSON.stringify(values[key])) patch[key] = values[key];
    });
    if (Object.keys(patch).length) this.setData(patch);
  },

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
    // 主机点按真实连接状态着色：已连接按线路族（局域网绿 / 公网蓝）、连接故障橙、断链红，其余熄灭。
    const connection = connectionView(app);
    const isOnline = connection.connected;
    const activeLink = hostLinkView(hostLinkKind(active, app));
    const hostDotClass = isOnline
      ? (activeLink.dotClass || 'on')
      : (connection.key === 'failed' || connection.key === 'dropped' ? connection.key : '');
    this.setHomePatch({
      hostLabel: active ? hostsLib.displayName(active) : uiText('选择主机'),
      hostKindIcon: hostsLib.kindIconFile(active ? active.deviceKind : 'desktopcomputer'),
      hostOnline: active ? (onlineIDs.indexOf(active.id) >= 0 || isOnline) : false,
      hostDotClass: hostDotClass,
      hostRows: rows.map((p) => {
        const online = onlineIDs.indexOf(p.id) >= 0 || (p.id === app.activeID && isOnline);
        const link = hostLinkView(hostLinkKind(p, app));
        return {
          id: p.id,
          displayName: hostsLib.displayName(p),
          kindIcon: hostsLib.kindIconFile(p.deviceKind),
          online: online,
          linkLabel: link.label,
          linkClass: link.className,
          dotClass: online ? (link.dotClass || 'on') : '',
          subLabel: (p.id === app.activeID || isOnline) ? uiText('当前主机 · 已连接') : uiText('点击连接'),
          isActive: p.id === app.activeID,
          selected: selected.indexOf(p.id) >= 0
        };
      })
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

  syncSessionStatusPolling(connected) {
    if (!this._homeVisible || !connected) {
      this.stopSessionStatusPolling();
      return;
    }
    this.scheduleSessionStatusPoll();
  },

  scheduleSessionStatusPoll() {
    if (!this._homeVisible || store.state.connection !== 'connected' || this._sessionStatusPollTimer) return;
    this._sessionStatusPollTimer = setTimeout(() => {
      this._sessionStatusPollTimer = null;
      if (!this._homeVisible || store.state.connection !== 'connected') return;
      if (this._sessionStatusRequest) {
        this.scheduleSessionStatusPoll();
        return;
      }
      this.refreshHomeSessionStatus();
    }, HOME_SESSION_REFRESH_MS);
  },

  refreshHomeSessionStatus() {
    if (!this._homeVisible || store.state.connection !== 'connected') return;
    if (this._sessionStatusRequest) return;
    const client = store.client;
    const generation = client.connectGeneration;
    let request;
    try {
      request = client.requestSessions();
    } catch (error) {
      this.scheduleSessionStatusPoll();
      return;
    }
    const token = { request, client, generation };
    this._sessionStatusRequest = token;
    this.scheduleSessionStatusPoll();
    Promise.resolve(request).then(() => {}, () => {}).then(() => {
      if (this._sessionStatusRequest !== token) return;
      this._sessionStatusRequest = null;
      if (client === store.client && generation === client.connectGeneration) {
        this.scheduleSessionStatusPoll();
      }
    });
  },

  stopSessionStatusPolling() {
    if (this._sessionStatusPollTimer) {
      clearTimeout(this._sessionStatusPollTimer);
      this._sessionStatusPollTimer = null;
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
      hostEditKb: 0,
      editingHostId: id,
      editingGatewayName: profile.gatewayName || uiText('未命名主机'),
      editAlias: profile.alias || '',
      editKind: profile.deviceKind,
      kindMenuOpen: false
    });
  },

  onHostAliasInput(e) {
    this.setData({ editAlias: e.detail.value });
  },

  // 键盘弹起时把编辑卡片整体抬到键盘上方，保证「取消 / 保存」始终可见。
  onHostEditKeyboard(e) {
    const height = Math.max(0, Number((e.detail && e.detail.height) || 0));
    if (height !== this.data.hostEditKb) this.setData({ hostEditKb: height });
  },

  toggleKindMenu() {
    this.setData({ kindMenuOpen: !this.data.kindMenuOpen });
  },

  closeKindMenu() {
    if (this.data.kindMenuOpen) this.setData({ kindMenuOpen: false });
  },

  setHostKind(e) {
    this.setData({ editKind: e.currentTarget.dataset.kind, kindMenuOpen: false });
  },

  cancelHostEdit() {
    this.setData({ hostEditOpen: false, hostEditKb: 0, kindMenuOpen: false });
  },

  saveHostEdit() {
    store.editHost(this.data.editingHostId, this.data.editAlias, this.data.editKind);
    this.setData({ hostEditOpen: false, hostEditKb: 0 });
  },

  deleteHosts() {
    const selected = this.data.hostSelection || [];
    if (!selected.length) return;
    const rows = (this.data.hostRows || []).filter((row) => selected.indexOf(row.id) >= 0);
    this.setData({
      hostDeleteOpen: true,
      hostDeleteCount: selected.length,
      hostDeleteTitle: selected.length === 1 ? uiText('删除主机？') : uiText('批量删除主机？'),
      hostDeleteNames: rows.map((row) => row.name).filter(Boolean).join('、')
    });
  },

  cancelDeleteHosts() {
    this.setData({ hostDeleteOpen: false });
  },

  confirmDeleteHosts() {
    const selected = this.data.hostSelection || [];
    this.setData({ hostDeleteOpen: false });
    if (!selected.length) return;
    if (typeof wx.showLoading === 'function') wx.showLoading({ title: uiText('正在移除设备'), mask: true });
    const removal = typeof store.forgetHosts === 'function'
      ? store.forgetHosts(selected)
      : Promise.resolve().then(() => { store.removeHosts(selected); return { removed: selected.length, failed: 0 }; });
    Promise.resolve(removal).then((result) => {
      if (typeof wx.hideLoading === 'function') wx.hideLoading();
      this.setData({ hostSelection: [], hostEditMode: false });
      if (result && result.failed) {
        wx.showToast({ title: uiText('主机离线或网关需更新，记录未同步'), icon: 'none', duration: 3000 });
      } else {
        wx.showToast({ title: uiText('已删除'), icon: 'success' });
      }
    }).catch((error) => {
      if (typeof wx.hideLoading === 'function') wx.hideLoading();
      wx.showToast({ title: error && error.message || uiText('移除设备失败'), icon: 'none' });
    });
  },

  onSearchInput(e) {
    const value = e.detail.value;
    this.closeSwipe();
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
      // 「全部会话」是弹窗第一行，布局高度按工作区数 +1 计算。
      const layout = workspacePopoverLayout(rect, windowInfo, rows.length + 1, this.topbarTop + this.topbarH);
      this.setData(Object.assign({
        workspacePickerOpen: true,
        pickerWorkspaces: rows,
        currentWorkspaceId: this.data.currentWorkspace.workspaceId || st.currentWorkspaceId || '',
        allWorkspacesSelected: st.isAllWorkspacesSelected === true,
        pairMenuVisible: false
      }, layout));
    };
    try {
      wx.createSelectorQuery().in(this).select('.workspace-card').boundingClientRect(show).exec();
    } catch (e) {
      show(null);
    }
  },

  /** 弹窗顶部「全部会话」：跨工作区分组视图（对齐 iOS workspaceCard Menu 第一项）。 */
  selectAll() {
    store.setAllWorkspaces();
    this.setData({ workspacePickerOpen: false, allWorkspacesSelected: true });
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

  /** 全部会话分区折叠开关：只翻转目标分区，其他分区保持不变。 */
  toggleSessionSection(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const sectionId = dataset.id;
    if (!sectionId) return;
    const expanded = Array.isArray(this.expandedSectionIds) ? this.expandedSectionIds.slice() : [];
    const at = expanded.indexOf(sectionId);
    if (at >= 0) expanded.splice(at, 1); else expanded.push(sectionId);
    this.expandedSectionIds = expanded;
    this.setData({ expandedSectionIds: expanded, swipeId: '', swipeOffset: 0 });
    const snapshot = this._lastSyncSnapshot || { app: store.state, session: store.sessionState };
    this.syncFromStore(snapshot);
  },

  // ---------- 目录浏览器弹层（对齐 dsh-mobile v1.6.0 WorkspaceDirectoryBrowserSheet） ----------
  // 浏览范围是整个宿主机：面包屑可回到「电脑」根与「主目录」，位置面板可切到其他盘/卷，
  // 也能直接输入绝对路径。隐藏目录默认收起（与 dsh 客户端的浏览选择器一致）。

  openDirSheet() {
    this.closeWorkspacePicker();
    let showHidden = false;
    try { showHidden = wx.getStorageSync('workspaceDirShowHidden') === true; } catch (e) { showHidden = false; }
    this._dirVolumeToken = (this._dirVolumeToken || 0) + 1;
    this.setData({
      dirSheetOpen: true,
      dirEntries: [],
      dirVisibleEntries: [],
      dirCrumbTrail: [],
      dirCrumbs: [],
      dirRootPath: '',
      dirHome: '',
      parentPath: null,
      dirPath: '',
      dirShowHidden: showHidden,
      dirHiddenCount: 0,
      dirLoading: true,
      dirError: '',
      dirLocationsOpen: false,
      dirVolumes: [],
      dirVolumesLoading: false,
      dirVolumesLoaded: false,
      dirVolumesError: '',
      dirJumpOpen: false,
      dirJumpValue: '',
      dirJumpError: ''
    });
    this.browseDirs(null);
  },

  closeDirSheet() {
    this._dirVolumeToken = (this._dirVolumeToken || 0) + 1;
    this.setData({ dirSheetOpen: false, dirLocationsOpen: false, dirJumpOpen: false });
  },

  /** 把网关帧转成路径、面包屑与可见列表；隐藏目录按当前开关过滤。 */
  applyDirFrame(frame, requestedPath) {
    const rawList = (frame && (frame.entries || frame.items)) || [];
    const entries = rawList
      .map((item) => ({
        name: item.name || item.title || '',
        path: item.path || '',
        hidden: item.hidden === true
      }))
      .filter((item) => item.name && item.path)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const crumbs = (frame && Array.isArray(frame.crumbs)) ? frame.crumbs : [];
    const home = (frame && typeof frame.home === 'string') ? frame.home : '';
    const showHidden = this.data.dirShowHidden === true;
    const visible = directoryBrowse.visibleDirectoryEntries(entries, showHidden);
    const trail = directoryBrowse.directoryCrumbTrail(crumbs, { root: uiText('电脑'), home: uiText('主目录') }, home);
    this.setData({
      dirEntries: entries,
      dirVisibleEntries: visible,
      dirCrumbs: crumbs,
      dirCrumbTrail: trail,
      dirCrumbIntoView: trail.length ? 'dir-crumb-' + (trail.length - 1) : '',
      dirHome: home || this.data.dirHome,
      dirRootPath: trail.length ? trail[0].path : this.data.dirRootPath,
      parentPath: directoryBrowse.directoryParentPath(crumbs),
      dirShowHidden: showHidden,
      dirHiddenCount: entries.length - visible.length,
      dirPath: (frame && frame.path) || requestedPath || '',
      dirLoading: false,
      dirError: ''
    });
    if (this._dirVolumesPending) {
      this._dirVolumesPending = false;
      this.setData({ dirVolumesLoading: false });
      if (this.data.dirLocationsOpen) this.loadDirVolumes();
    }
    return entries.length;
  },

  browseDirs(path) {
    if (store.state.connection !== 'connected') {
      this.setData({ dirLoading: false, dirError: uiText('请先连接鲸尾 Harness') });
      return;
    }
    this.setData({ dirLoading: true, dirError: '' });
    store.client.requestDirectories(path)
      .then((frame) => { this.applyDirFrame(frame, path); })
      .catch((err) => {
        this.setData({ dirLoading: false, dirError: (err && err.message) || uiText('读取目录失败') });
      });
  },

  openDirEntry(e) {
    const item = this.data.dirVisibleEntries[e.currentTarget.dataset.index];
    if (!item || this.data.dirLoading) return;
    this.browseDirs(item.path);
  },

  goParentDir() {
    if (this.data.dirLoading || !this.data.parentPath) return;
    this.browseDirs(this.data.parentPath);
  },

  /** 跳到面包屑上的某一级。 */
  selectDirCrumb(e) {
    const path = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.path : '';
    if (!path || this.data.dirLoading || path === this.data.dirPath) return;
    haptics.tick();
    this.browseDirs(path);
  },

  toggleDirHidden() {
    const next = this.data.dirShowHidden !== true;
    try { wx.setStorageSync('workspaceDirShowHidden', next); } catch (e) { /* 只影响本机偏好 */ }
    const visible = directoryBrowse.visibleDirectoryEntries(this.data.dirEntries, next);
    haptics.tick();
    this.setData({
      dirShowHidden: next,
      dirVisibleEntries: visible,
      dirHiddenCount: this.data.dirEntries.length - visible.length
    });
  },

  // ---------- 位置面板：电脑 / 主目录 / 其他盘 ----------

  openDirLocations() {
    if (!this.data.dirHome) {
      // 首屏目录还没回来时先等它确定主机是 POSIX 还是 Windows。
      this._dirVolumesPending = true;
      this.setData({ dirLocationsOpen: true, dirVolumesLoading: true, dirVolumesLoaded: false });
      return;
    }
    this.setData({ dirLocationsOpen: true });
    this.loadDirVolumes();
  },

  closeDirLocations() {
    this._dirVolumeToken = (this._dirVolumeToken || 0) + 1;
    this.setData({ dirLocationsOpen: false, dirVolumesLoading: false });
  },

  selectDirLocation(e) {
    const path = (e && e.currentTarget && e.currentTarget.dataset) ? e.currentTarget.dataset.path : '';
    if (!path) return;
    this._dirVolumeToken = (this._dirVolumeToken || 0) + 1;
    this.setData({ dirLocationsOpen: false, dirVolumesLoading: false });
    haptics.tick();
    this.browseDirs(path);
  },

  /** 读取某一层目录（供位置面板探测盘符/卷使用，不与浏览请求并发）。 */
  requestDirEntries(path) {
    return store.client.requestDirectories(path).then((frame) => {
      const rawList = (frame && (frame.entries || frame.items)) || [];
      return rawList
        .map((item) => ({ name: item.name || item.title || '', path: item.path || '' }))
        .filter((item) => item.name && item.path);
    });
  },

  /**
   * 懒加载其他盘/卷：
   * - POSIX 主机依次探测 /Volumes、/mnt、/media（macOS 外接盘、Linux 挂载点）；
   * - Windows 主机按 C:–Z: 顺序探测存在的盘符。
   * 目录请求同类串行，避免把正在浏览的请求顶掉。
   */
  loadDirVolumes() {
    if (this.data.dirVolumesLoaded || this.data.dirVolumesLoading) return;
    const token = (this._dirVolumeToken = (this._dirVolumeToken || 0) + 1);
    const home = this.data.dirHome || this.data.dirPath || '';
    const posix = home.charAt(0) === '/';
    const cacheKey = home + '|' + (posix ? 'posix' : 'win');
    if (this._dirVolumeCache && this._dirVolumeCache.key === cacheKey) {
      this.setData({ dirVolumesLoading: false, dirVolumesLoaded: true, dirVolumes: this._dirVolumeCache.volumes.slice() });
      return;
    }
    this.setData({ dirVolumesLoading: true, dirVolumesError: '' });
    const finish = (volumes) => {
      if (this._dirVolumeToken !== token) return;
      this._dirVolumeCache = { key: cacheKey, volumes: volumes.slice() };
      this.setData({ dirVolumesLoading: false, dirVolumesLoaded: true, dirVolumes: volumes });
    };
    if (posix) {
      const bases = ['/Volumes', '/mnt', '/media'];
      const found = [];
      const seen = {};
      const step = (index) => {
        if (this._dirVolumeToken !== token) return;
        if (index >= bases.length) { finish(found); return; }
        this.requestDirEntries(bases[index]).then((entries) => {
          entries.forEach((entry) => {
            if (seen[entry.path]) return;
            seen[entry.path] = true;
            found.push({ name: entry.name, path: entry.path });
          });
          step(index + 1);
        }, () => step(index + 1));
      };
      step(0);
      return;
    }
    const letters = [];
    for (let code = 67; code <= 90; code++) letters.push(String.fromCharCode(code));
    const skip = ((home.match(/^([A-Za-z]):/) || [])[1] || '').toUpperCase();
    const found = [];
    const step = (index) => {
      if (this._dirVolumeToken !== token) return;
      if (index >= letters.length) { finish(found); return; }
      const letter = letters[index];
      if (letter === skip) { step(index + 1); return; }
      const path = letter + ':\\';
      this.requestDirEntries(path).then(() => {
        found.push({ name: letter + ':', path: path });
        if (this._dirVolumeToken === token) this.setData({ dirVolumes: found.slice() });
        step(index + 1);
      }, () => step(index + 1));
    };
    step(0);
  },

  // ---------- 手动输入绝对路径 ----------

  openDirJump() {
    this.setData({ dirJumpOpen: true, dirJumpValue: this.data.dirPath || '', dirJumpError: '' });
  },

  closeDirJump() {
    this.setData({ dirJumpOpen: false, dirJumpValue: '', dirJumpError: '' });
  },

  onDirJumpInput(e) {
    this.setData({ dirJumpValue: (e && e.detail && e.detail.value) || '', dirJumpError: '' });
  },

  submitDirJump() {
    const result = directoryBrowse.normalizeDirectoryInput(this.data.dirJumpValue, this.data.dirHome);
    if (result.error) {
      this.setData({ dirJumpError: result.error === 'empty' ? uiText('请输入绝对路径') : uiText('请输入以 / 或盘符开头的绝对路径') });
      return;
    }
    this.setData({ dirJumpOpen: false, dirJumpValue: '', dirJumpError: '' });
    this.browseDirs(result.path);
  },

  /** 新建文件夹：底部弹窗（透明玻璃面板），不再用系统 showModal。 */
  newDirectory() {
    if (this.data.dirLoading || this.data.dirCreatingWs || this.data.dirCreatingDir || !this.data.dirPath) return;
    this.setData({ dirCreateOpen: true, dirCreateName: '', dirCreateBusy: false });
  },
  closeDirCreate() {
    if (this.data.dirCreateBusy) return;
    this.setData({ dirCreateOpen: false, dirCreateName: '' });
  },
  onDirCreateInput(e) { this.setData({ dirCreateName: (e && e.detail && e.detail.value) || '' }); },
  confirmDirCreate() {
    if (this.data.dirCreateBusy) return;
    const name = String(this.data.dirCreateName || '').trim();
    if (!name) { wx.showToast({ title: uiText('请输入文件夹名称'), icon: 'none' }); return; }
    if (!this.data.dirPath) return;
    const parent = this.data.dirPath;
    this.setData({ dirCreateBusy: true, dirCreatingDir: true });
    store.client.createDirectory(parent, name)
      .then(() => {
        this.setData({ dirCreateBusy: false, dirCreatingDir: false, dirCreateOpen: false, dirCreateName: '' });
        this.browseDirs(parent);
      })
      .catch((err) => {
        this.setData({ dirCreateBusy: false, dirCreatingDir: false });
        wx.showToast({ title: err.message || uiText('创建失败'), icon: 'none' });
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
    // 全部会话跨工作区展示时没有可归属的工作区：先提示选择具体工作区。
    if (store.state.isAllWorkspacesSelected === true) {
      wx.showModal({
        title: uiText('请先选择工作区'),
        content: uiText('请先选择一个具体工作区，再创建新会话。'),
        showCancel: false,
        confirmText: uiText('知道了')
      });
      return;
    }
    if (store.state.connection !== 'connected') {
      wx.showToast({ title: uiText('请先连接 Gateway'), icon: 'none' });
      return;
    }
    // 乐观创建：先进入会话页，后台创建结果由会话页呈现
    const workspaceId = this.data.currentWorkspace.workspaceId || store.state.currentWorkspaceId;
    const creation = store.createAndOpenSession(workspaceId);
    wx.navigateTo({ url: '/pages/session/session', animationType: 'none', animationDuration: 0 });
    creation.catch(() => {}); // 失败状态已写入 store，由会话页显示重试入口
  },

  openSession(e) {
    if (this._openingSession) return;
    // 左滑展开时，先点一行收回操作
    if (this.data.swipeId) {
      this.closeSwipe();
      return;
    }
    const { id, title, preset } = e.currentTarget.dataset;
    if (!id) {
      wx.showToast({ title: uiText('会话 ID 不可用'), icon: 'none' });
      return;
    }
    // 先停掉全屏海洋帧生成，避免它与会话首屏抢主线程和 setData 桥接。
    this._openingSession = true;
    if (this._sessionWarmup) this._sessionWarmup.stop();
    this._homeHidden = true;
    const ocean = this.selectComponent && this.selectComponent('#home-ocean');
    if (ocean) ocean.pause();
    this.setData({ oceanActive: false });
    // Hydrate before navigation: cache restore and the history request start on
    // the tap event, so the session page can reuse rows during its first layout.
    // The page detects the matching active session and skips a second openSession.
    store.openSession(id, title || '', preset || null);
    const query = ['id=' + encodeURIComponent(id), 'reopen=1'];
    if (preset) query.push('preset=' + encodeURIComponent(preset));
    wx.navigateTo({ url: '/pages/session/session?' + query.join('&'), animationType: 'none', animationDuration: 0, fail: () => {
      this._openingSession = false; this._homeHidden = false;
      this.setData({ oceanActive: true });
      this.syncFromStore({ app: store.state, session: store.sessionState });
    } });
  },

  /** 长按会话行：该行隐藏，菜单原地弹出。 */
  sessionActions(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.displaySessions[index];
    if (!item) return;
    this.closeSwipe();
    const request = {};
    this._sessionMenuRequest = request;
    let windowInfo = {};
    try {
      windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    } catch (err) { /* Use phone-safe defaults when window metrics are unavailable. */ }
    // 选择器失败时用长按触点当锚点，不回落到屏幕中间。
    const touch = e.touches && e.touches[0] ? e.touches[0] : null;
    const touchRect = touch ? {
      left: touch.clientX - 140, top: touch.clientY - 24, width: 280, height: 48
    } : null;
    const show = (rect) => {
      if (this._sessionMenuRequest !== request) return;
      this._sessionMenuRequest = null;
      const anchor = rect || touchRect;
      const layout = sessionMenuLayout(anchor, windowInfo, this.topbarTop + this.topbarH);
      this.setData(Object.assign({
        sessionMenuOpen: true,
        sessionMenuId: item.sessionId,
        sessionMenuTitle: item.displayTitle || item.sessionId,
        pairMenuVisible: false
      }, layout));
    };
    try {
      wx.createSelectorQuery().in(this).select('#session-row-' + index).boundingClientRect(show).exec();
    } catch (err) {
      show(null);
    }
  },

  closeSessionMenu() {
    this._sessionMenuRequest = null;
    this.setData({ sessionMenuOpen: false });
  },

  sessionMenuAction(e) {
    const action = (e.currentTarget.dataset || {}).action;
    const id = this.data.sessionMenuId;
    const item = (this.data.displaySessions || []).find((session) => session && session.sessionId === id) || null;
    this.setData({ sessionMenuOpen: false });
    if (!item) return;
    if (action === 'rename') this.renameSession(item);
    else this.archiveSession(item);
  },

  archiveSession(item) {
    if (!item) return;
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

  // ---------- 会话行左滑手势 ----------

  closeSwipe() {
    if (!this.data.swipeId && !this.data.swipeOffset) return;
    this.setData({ swipeId: '', swipeOffset: 0 });
  },

  onSessionTouchStart(e) {
    const touch = e.touches && e.touches[0];
    const dataset = e.currentTarget.dataset || {};
    if (!touch || !dataset.id) return;
    this._rowGesture = null;
    this._swipe = {
      id: dataset.id,
      index: Number(dataset.index) || 0,
      x: touch.clientX,
      y: touch.clientY,
      dx: 0,
      horizontal: false,
      decided: false,
      // 手势开始时操作按钮是否已展开：决定这次手势要不要让位给抽屉
      openAtStart: !!this.data.swipeId
    };
  },

  onSessionTouchMove(e) {
    const swipe = this._swipe;
    const touch = e.touches && e.touches[0];
    if (!swipe || !touch) return;
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!swipe.decided) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      swipe.decided = true;
      swipe.horizontal = Math.abs(dx) > Math.abs(dy);
      if (swipe.horizontal) this.setData({ swiping: true });
    }
    if (!swipe.horizontal) return;
    swipe.dx = dx;
    const max = this._swipeActionPx || 200;
    const offset = Math.max(0, Math.min(max, -dx));
    if (offset > 6) this.setData({ swipeId: swipe.id, swipeOffset: offset });
    else if (this.data.swipeId) this.setData({ swipeId: '', swipeOffset: 0 });
  },

  onSessionTouchEnd() {
    const swipe = this._swipe;
    this._swipe = null;
    const max = this._swipeActionPx || 200;
    const open = !!swipe && swipe.horizontal && swipe.dx <= -max * 0.3;
    if (swipe) this._rowGesture = { openAtStart: swipe.openAtStart === true, openAtEnd: open };
    this.setData({
      swiping: false,
      swipeId: open ? swipe.id : '',
      swipeOffset: open ? max : 0
    });
  },

  // 手势被系统取消（来电、手势识别抢占）时清状态并收回操作，避免滚动锁死
  onSessionTouchCancel() {
    this._swipe = null;
    this._rowGesture = null;
    this.setData({ swiping: false, swipeId: '', swipeOffset: 0 });
  },

  sessionSwipeAction(e) {
    const dataset = e.currentTarget.dataset || {};
    const item = this.data.displaySessions[dataset.index];
    this.closeSwipe();
    if (!item) return;
    if (dataset.action === 'rename') this.renameSession(item);
    else this.archiveSession(item);
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
        this._scanRelayPending = !!publicAccessPrompt.managedRelayPayload(res.result);
        const result = store.pairWithPayload(res.result);
        if (result.ok) {
          wx.showToast({ title: uiText('连接中…'), icon: 'none' });
        } else {
          this._scanRelayPending = false;
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
    this.setData({ pairMenuVisible: false, manualSheetOpen: true, manualSheetExpanded: false, manualInputFocused: false, pairingText: '', pairingResult: '', pairingResultClass: '', pairingConnecting: false });
  },

  closeManualSheet() {
    this.setData({ manualSheetOpen: false, manualSheetExpanded: false, manualInputFocused: false });
  },

  // 输入框聚焦时高亮边框，避免在深色半透明弹层里看不清输入区域。
  onManualInputFocus() {
    if (!this.data.manualInputFocused) this.setData({ manualInputFocused: true });
  },

  onManualInputBlur() {
    if (this.data.manualInputFocused) this.setData({ manualInputFocused: false });
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
    if (this._openingSettings) return;
    this._openingSettings = true;
    this._homeHidden = true;
    const ocean = this.selectComponent && this.selectComponent('#home-ocean');
    if (ocean) ocean.pause();
    this.setData({ oceanActive: false });
    // Navigate first; reset the covered drawer in onHide, without its 60ms timer.
    wx.navigateTo({ url: '/pages/settings/settings', fail: () => {
      this._openingSettings = false; this._homeHidden = false;
      this.setData({ oceanActive: true });
      this.syncFromStore({ app: store.state, session: store.sessionState });
    } });
  },

  openSessionSettings() {
    wx.navigateTo({ url: '/pages/session-settings/session-settings' });
  },

  // ---------- 侧边栏（对齐 dsh-mobile WorkspaceView drawer 交互） ----------

  applyDrawer(progress) {
    const w = this.drawerW;
    const p = Math.max(0, Math.min(1, Number(progress) || 0));
    // 压暗对齐 iOS：progress 过 45% 后才渐入，smoothstep 缓动，峰值 0.16。
    // 遮罩在内容层内，随页面一起浮在侧栏之上；侧栏本身保持原亮度。
    const dimProgress = Math.max(0, Math.min(1, (p - 0.45) / 0.55));
    const maskOpacity = 0.16 * dimProgress * dimProgress * (3 - 2 * dimProgress);
    this.setData({
      drawerOpen: p > 0.5,
      drawerX: -w + w * p,
      contentX: w * p,
      contentCornerRadius: 48 * p,
      maskOpacity,
      contentShifted: p > 0.02
    });
    // 状态栏底色跟随抽屉：深色抽屉和插件页同为 #141518，浅色抽屉为白底；
    // 其余状态保持首页深海蓝。拖拽按帧触发，只在开/合状态切换时调用一次。
    const open = p > 0.5;
    if (this.statusBarFront !== open) {
      this.statusBarFront = open;
      const darkTheme = this.data.themeClass === 'theme-dark';
      const windowBg = homeWindowBackground(darkTheme, open);
      this.setData({ pageStyle: 'background-color: ' + windowBg + ';' });
      if (typeof wx.setNavigationBarColor === 'function') {
        // 状态栏前景与底色保持同一套：深色抽屉白字，浅色抽屉黑字；关闭时深海蓝底白字。
        const lightChrome = open && !darkTheme;
        try {
          wx.setNavigationBarColor({
            frontColor: lightChrome ? '#000000' : '#ffffff',
            backgroundColor: windowBg,
            fail: function () { /* 部分环境不支持，忽略 */ }
          });
        } catch (e) { /* 忽略 */ }
      }
    }
  },

  /** 震动反馈：等级由全局设置决定（设置 → 震动反馈）。 */
  hapticLight() {
    haptics.vibrate();
  },

  openDrawer() {
    if (!this.data.drawerOpen) {
      this.hapticLight();
      this.setData({ pairMenuVisible: false });
      this.applyDrawer(1);
    }
    this.loadCostMeterSummary();
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
    // 行内手势（按钮已展开时开始，或手势结束时展开）优先：这次右滑只归操作按钮，
    // 不再顺手把左侧栏打开。
    const rowGesture = this._rowGesture;
    this._rowGesture = null;
    if (rowGesture && (rowGesture.openAtStart || rowGesture.openAtEnd)) return;
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
  },

  openCostDetail(component) {
    this.resetDrawerInstant();
    const key = typeof component === 'string' ? component : '';
    wx.navigateTo({ url: '/pages/cost-meter/cost-meter' + (key ? '?component=' + encodeURIComponent(key) : '') });
  },

  /** 点击左侧栏额度卡里的某个模块：打开额度页并定位到该模块的单独设置。 */
  onSidebarPartTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    this.openCostDetail(key || '');
  },

  onCostCardTap() { this.loadCostMeterSummary(true); },

  /** 侧栏额度卡：未连接时点一下直接重连。 */
  retryGatewayConnection() {
    this._costBridgeRetry = null;
    this._costMeterAttempt = null;
    if (store.state.connection !== 'connected') store.reconnectWithSaved();
    this.loadCostMeterSummary(true);
  },

  /** 刷新额度卡片；连接建立后和打开抽屉时都会触发。 */
  loadCostMeterSummary(force) {
    if (this._homeHidden) return;
    if (store.state.connection !== 'connected') {
      if (this._costMeterInFlight) {
        this._costMeterInFlight = null;
        this._costMeterGeneration = (this._costMeterGeneration || 0) + 1;
        this._costMeterAttempt = null;
      }
      this.setData({ costDashboard: null, costSidebar: null, costSections: [], costCardError: '' });
      return;
    }
    const capabilities = store.state.gatewayCapabilities || [];
    if (!capabilities.includes('cost-meter-v1')) {
      if (this._costMeterInFlight) {
        this._costMeterInFlight = null;
        this._costMeterGeneration = (this._costMeterGeneration || 0) + 1;
      }
      this._costMeterAttempt = null;
      this.setData({ costDashboard: null, costSidebar: null, costSections: [], costCardError: uiText('当前网关尚未开放此功能，请更新网关后重试。') });
      return;
    }

    const owner = costOwnerKey();
    const now = Date.now();
    if (this._costMeterOwner !== owner) {
      this._costMeterOwner = owner;
      this._costMeterCache = null;
      this._costMeterAttempt = null;
      this.setData({ costDashboard: null, costSidebar: null, costSections: [], costCardError: '' });
    }
    const cached = this._costMeterCache;
    if (!force && cached && cached.owner === owner && now - cached.at < 30000) {
      this.applyQuotaFrame(cached.dashboard, cached.summary);
      return;
    }
    // 内存缓存没命中：先用落盘的上次快照顶上，后台再拉新的（网关扫描要好几秒）。
    if (!force) {
      const disk = this.readCostMeterCache(owner);
      if (disk) {
        this._costMeterCache = { owner: owner, at: now - 20000, dashboard: disk.dashboard, summary: disk.summary };
        this.applyQuotaFrame(disk.dashboard, disk.summary);
      }
    }
    const attempted = this._costMeterAttempt;
    if (!force && attempted && attempted.owner === owner && now - attempted.at < 5000) return;
    if (this._costMeterInFlight && this._costMeterInFlight.owner === owner) return;

    const request = { owner, generation: this._costMeterGeneration || 0 };
    this._costMeterInFlight = request;
    this._costMeterAttempt = { owner, at: now };
    this.setData({ costCardError: '' });
    store.client.requestCostMeter(force ? 'refresh' : 'summary').then((frame) => {
      if (this._homeHidden || this._costMeterInFlight !== request || request.generation !== (this._costMeterGeneration || 0) ||
          store.state.connection !== 'connected' || owner !== costOwnerKey()) return;
      this._costMeterCache = { owner, at: Date.now(), dashboard: frame && frame.dashboard, summary: frame && frame.summary };
      this.writeCostMeterCache(owner, frame && frame.dashboard, frame && frame.summary);
      // 排序键同时从 dashboard.settings 与 config 两处取，兼容未下发到 dashboard 的旧网关。
      this._sidebarOrder = (frame && frame.config && Array.isArray(frame.config.sidebarOrder))
        ? frame.config.sidebarOrder
        : (frame && frame.dashboard && frame.dashboard.settings && Array.isArray(frame.dashboard.settings.sidebarOrder)
          ? frame.dashboard.settings.sidebarOrder : null);
      this.applyQuotaFrame(frame && frame.dashboard, frame && frame.summary);
    }).catch((error) => {
      if (this._homeHidden || this._costMeterInFlight !== request || request.generation !== (this._costMeterGeneration || 0) ||
          store.state.connection !== 'connected' || owner !== costOwnerKey()) return;
      // 已有卡片就保留（可能是瞬时失败），只有完全没数据时才显示提示。
      if (this.data.costSidebar) return;
      // DSH 刚重启时网关插件可能还在注册费用桥：自动补一次，避免卡片一直停在不可用。
      if (error && error.code === 'cost-meter-unavailable' && this._costBridgeRetry !== owner) {
        this._costBridgeRetry = owner;
        setTimeout(() => {
          if (this._homeHidden || owner !== costOwnerKey() || store.state.connection !== 'connected') return;
          this._costMeterAttempt = null;
          this.loadCostMeterSummary(true);
        }, 1500);
        return;
      }
      this.setData({ costCardError: error.code === 'cost-meter-unavailable' ? uiText('费用服务暂不可用，请重启 DSH 后重试') : uiText('额度数据暂不可用') });
    }).finally(() => {
      if (this._costMeterInFlight === request) this._costMeterInFlight = null;
    });
  },

  /** 按排序键取侧栏模型中的对应项，供 WXML 的 sections 渲染使用。 */
  planOf(key) {
    const id = String(key || '').slice(5);
    return (this.data.costSidebar && this.data.costSidebar.plans || []).find(item => item.id === id) || {};
  },
  gatewayOf(key) {
    const id = String(key || '').slice(8);
    return (this.data.costSidebar && this.data.costSidebar.gateway || []).find(item => item.id === id) || { accounts: [] };
  },
  customOf(key) {
    const index = Number(String(key || '').slice(7));
    return (this.data.costSidebar && this.data.costSidebar.custom || [])[index] || {};
  },

  /** 额度卡磁盘缓存：下次打开立即可见，后台再刷新。 */
  readCostMeterCache(owner) {
    try {
      const raw = wx.getStorageSync('dsh_cost_cache.' + String(owner || 'default'));
      if (!raw) return null;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && parsed.dashboard) return { dashboard: parsed.dashboard, summary: parsed.summary || null };
    } catch (e) { /* 缓存损坏则忽略 */ }
    return null;
  },

  /** 成本显示配置签名：用于判断返回首页时是否需要作废额度短缓存。 */
  costSettingsSignature() {
    const view = this.data.costDashboard;
    const settings = view && view.settings ? view.settings : null;
    const display = settings && settings.display ? settings.display : null;
    if (!display) return '';
    return [display.sidebarVisible, display.sidebarStyle, display.sidebarTodayMetric,
      display.peakStyle, display.peakTimeDisplay, display.sidebarTodayBalanceInline,
      settings && settings.sidebarOrder ? JSON.stringify(settings.sidebarOrder) : ''].join('|');
  },

  /** 落盘前脱敏：凭据引用、请求头与 source 密钥都不进入普通页面缓存。 */
  sanitizeCostDashboard(dashboard) {
    if (!dashboard || typeof dashboard !== 'object') return dashboard;
    const clone = JSON.parse(JSON.stringify(dashboard));
    const settings = clone.settings;
    if (settings && typeof settings === 'object') {
      // 自定义余额/网关配额的请求头可能含 {{TOKEN}} 模板，网关未来版本可能内联真实值。
      (settings.customBalances || []).forEach((entry) => { if (entry && entry.request) entry.request = { url: entry.request.url, method: entry.request.method }; });
      const sources = settings.gatewayQuotas && settings.gatewayQuotas.sources;
      (sources || []).forEach((entry) => { if (entry && entry.request) entry.request = { url: entry.request.url, method: entry.request.method }; });
      ['balance', 'goQuota'].forEach((key) => {
        if (settings[key]) { delete settings[key].accessKeyId; delete settings[key].secretAccessKey; delete settings[key].apiKey; delete settings[key].token; }
      });
    }
    return clone;
  },

  writeCostMeterCache(owner, dashboard, summary) {
    try {
      if (!dashboard) return;
      wx.setStorageSync('dsh_cost_cache.' + String(owner || 'default'), JSON.stringify({
        dashboard: this.sanitizeCostDashboard(dashboard), summary: summary || null, savedAt: Date.now()
      }));
    } catch (e) { /* 存储失败不阻断 */ }
  },

  applyQuotaFrame(dashboard, summary) {
    const view = costView.normalizeQuotaDashboard(dashboard, summary);
    if (!view) {
      if (this.data.costDashboard || this.data.costSidebar) this.setData({ costDashboard: null, costSidebar: null, costSections: [] });
      return;
    }
    const visible = view.display && view.display.sidebarVisible === true;
    const sidebar = visible ? costView.quotaSidebarModel(view, view.display.sidebarStyle) : null;
    const nextSidebar = sidebar && !sidebar.empty ? sidebar : null;
    // 按网关下发的 sidebarOrder 摊平成分区序列，侧栏按这个顺序渲染。
    const order = Array.isArray(this._sidebarOrder)
      ? this._sidebarOrder
      : (dashboard && dashboard.settings && dashboard.settings.sidebarOrder);
    const sections = nextSidebar ? costView.quotaSidebarSections(nextSidebar, order) : [];
    this._costBridgeRetry = null;
    this._costMeterSig = this.costSettingsSignature();
    if (JSON.stringify(this.data.costDashboard) !== JSON.stringify(view)
      || JSON.stringify(this.data.costSidebar) !== JSON.stringify(nextSidebar)
      || JSON.stringify(this.data.costSections) !== JSON.stringify(sections)) {
      this.setData({ costDashboard: view, costSidebar: nextSidebar, costSections: sections, costCardError: '' });
    }
  },
});

function shortPath(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : path;
}

function costOwnerKey() {
  return costView.dashboardOwner(store.state);
}

